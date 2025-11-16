export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import type { Response as OpenAIResponse } from "openai/resources/responses/responses";
import type { SourceChip } from "@/lib/chatTypes";

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable");
  }
  return new OpenAI({ apiKey });
}

function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Missing Supabase configuration");
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });
}

type HistoryMessage = {
  role: "user" | "assistant";
  content: string;
};
type PersistedHistoryRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type ModelMode = "auto" | "nano" | "mini" | "full";
type ModelKey = Exclude<ModelMode, "auto">;
type ReasoningEffortSetting =
  | "auto"
  | "none"
  | "low"
  | "medium"
  | "high";
type VerbositySetting = "auto" | "low" | "medium" | "high";
type ConcreteReasoningEffort = Exclude<ReasoningEffortSetting, "auto">;
type ConcreteVerbosity = Exclude<VerbositySetting, "auto">;

export type RankedSource = {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  sourceType: "official" | "news" | "reference" | "other";
  published: string | null;
  confidenceScore: number;
};

type SearchRecord = {
  query: string;
  summary: string;
  rankedSources: RankedSource[];
  rawResults?: RankedSource[];
  fromCache?: boolean;
};

type SearchStatusEvent =
  | { type: "search-start"; query: string }
  | { type: "search-complete"; query: string; results?: number }
  | { type: "search-error"; query: string; message?: string };

type ResponseMetadata = {
  usedModel: string;
  usedModelMode: ModelKey;
  requestedModelMode: ModelMode;
  usedWebSearch: boolean;
  searchRecords: SearchRecord[];
  sources: SourceChip[];
};

const MODEL_MAP: Record<ModelKey, string> = {
  nano: "gpt-5-nano-2025-08-07",
  mini: "gpt-5-mini-2025-08-07",
  full: "gpt-5.1-2025-11-13",
};

const MODEL_CAPABILITIES: Record<ModelKey, { supportsReasoning: boolean; supportsVerbosity: boolean }> = {
  nano: { supportsReasoning: true, supportsVerbosity: true },
  mini: { supportsReasoning: true, supportsVerbosity: true },
  full: { supportsReasoning: true, supportsVerbosity: true },
};

const ROUTER_DEFAULTS: Record<ModelKey, { reasoning: ConcreteReasoningEffort; verbosity: ConcreteVerbosity }> = {
  nano: { reasoning: "none", verbosity: "low" },
  mini: { reasoning: "low", verbosity: "medium" },
  full: { reasoning: "medium", verbosity: "medium" },
};

const BASE_SYSTEM_PROMPT =
  "You are a web-connected assistant with access to the `web_search` tool for live information.\n" +
  "Follow these rules:\n" +
  "- Use internal knowledge for timeless concepts, math, or historical context.\n" +
  "- For questions about current events, market conditions, weather, schedules, releases, or other fast-changing facts, prefer calling `web_search` to gather fresh data.\n" +
  "- When `web_search` returns results, treat them as live, up-to-date sources. Summarize them, cite domains inline using (Source: domain.com), and close with a short Sources list that repeats the referenced domains.\n" +
  "- Never claim you lack internet access or that your knowledge is outdated in a turn where tool outputs were provided.\n" +
  "- If the tool returns little or no information, acknowledge that gap before relying on older knowledge.\n" +
  "- Do not send capability or identity questions to `web_search`; answer those directly.\n" +
  "- Keep answers clear and grounded, blending background context with any live data you retrieved.";

const FORCE_WEB_SEARCH_PROMPT =
  "The user explicitly requested live web search. Ensure you call the `web_search` tool for this turn unless it would clearly be redundant.";

const LIVE_DATA_HINTS = [
  "current",
  "today",
  "tonight",
  "latest",
  "recent",
  "breaking",
  "news",
  "update",
  "updated",
  "now",
  "right now",
  "this week",
  "this month",
  "this year",
  "price",
  "prices",
  "market",
  "stock",
  "stocks",
  "quote",
  "report",
  "earnings",
  "forecast",
  "weather",
  "temperature",
  "release",
  "launch",
  "trend",
];

const META_QUESTION_PATTERNS = [
  /\b(?:can|could|would) you (?:browse|access|use) (?:the )?(?:internet|web)/i,
  /\b(?:do|can) you have internet/i,
  /\bwhat(?:'s| is) your knowledge cutoff/i,
  /\bwhen were you (?:trained|last updated)/i,
  /\bare you able to search/i,
  /\bwhat model are you/i,
  /\bhow do your tools work/i,
];

const PLACEHOLDER_TITLES = [
  "",
  "new chat",
  "untitled chat",
  "conversation with assistant",
  "chat with assistant",
];

function isPlaceholderTitle(value: string | null | undefined) {
  const normalized = (value || "").trim().toLowerCase();
  return PLACEHOLDER_TITLES.includes(normalized);
}

function normalizeGeneratedTitle(input: string | null | undefined) {
  const cleaned = (input || "")
    .replace(/["'“”‘’]+/g, "")
    .replace(/[.!?,:;]+$/g, "")
    .trim();
  if (!cleaned) {
    return null;
  }
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const truncated = words.slice(0, 8).join(" ");
  if (!truncated) return null;
  const normalized = truncated.trim();
  if (isPlaceholderTitle(normalized)) {
    return null;
  }
  return normalized;
}

function parseReasoningSetting(value: unknown): ReasoningEffortSetting {
  const allowed: ReasoningEffortSetting[] = [
    "auto",
    "none",
    "low",
    "medium",
    "high",
  ];
  if (typeof value === "string") {
    const normalized = value.toLowerCase() as ReasoningEffortSetting;
    if (allowed.includes(normalized)) {
      return normalized;
    }
  }
  return "auto";
}

function parseVerbositySetting(value: unknown): VerbositySetting {
  const allowed: VerbositySetting[] = ["auto", "low", "medium", "high"];
  if (typeof value === "string") {
    const normalized = value.toLowerCase() as VerbositySetting;
    if (allowed.includes(normalized)) {
      return normalized;
    }
  }
  return "auto";
}

function resolveReasoningSetting(
  requested: ReasoningEffortSetting,
  fallback: ConcreteReasoningEffort
): ConcreteReasoningEffort {
  return requested === "auto" ? fallback : requested;
}

function resolveVerbositySetting(
  requested: VerbositySetting,
  fallback: ConcreteVerbosity
): ConcreteVerbosity {
  return requested === "auto" ? fallback : requested;
}

function shouldAllowWebSearch({
  userText,
  forceWebSearch,
}: {
  userText: string;
  forceWebSearch: boolean;
}) {
  if (forceWebSearch) {
    return true;
  }
  const trimmed = userText.trim();
  if (!trimmed) {
    return false;
  }
  if (META_QUESTION_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return false;
  }
  const lower = trimmed.toLowerCase();
  return LIVE_DATA_HINTS.some((hint) => lower.includes(hint));
}

function buildSourceChips(records: SearchRecord[], maxSources = 4): SourceChip[] {
  if (!records.length) {
    return [];
  }
  const chips: SourceChip[] = [];
  const seen = new Set<string>();
  let nextId = 1;

  for (const record of records) {
    for (const result of record.rankedSources) {
      const rawUrl = (result.url || "").trim();
      if (!rawUrl) {
        continue;
      }
      const url = normalizeSourceUrl(rawUrl);
      const domain =
        extractDomainFromUrl(url) ||
        result.domain ||
        url;
      const normalizedDomain = domain.toLowerCase();
      if (seen.has(normalizedDomain)) {
        continue;
      }
      chips.push({
        id: nextId,
        title: result.title?.trim() || domain,
        url,
        domain,
      });
      seen.add(normalizedDomain);
      nextId += 1;
      if (chips.length >= maxSources) {
        return chips;
      }
    }
  }

  return chips;
}

function normalizeSourceUrl(input: string) {
  if (!input) {
    return "";
  }
  try {
    return new URL(input).toString();
  } catch {
    try {
      return new URL(`https://${input}`).toString();
    } catch {
      return input;
    }
  }
}

function extractDomainFromUrl(input: string) {
  if (!input) {
    return null;
  }
  try {
    const host = new URL(input).hostname;
    return host.replace(/^www\./i, "");
  } catch {
    if (!/^https?:/i.test(input)) {
      try {
        const host = new URL(`https://${input}`).hostname;
        return host.replace(/^www\./i, "");
      } catch {
        // fall through
      }
    }
    const sanitized = input
      .replace(/^https?:\/\//i, "")
      .split("/")[0]
      .trim();
    return sanitized || null;
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const userText = (body.message ?? "").toString().trim();
    const conversationId = (body.conversationId ?? "").toString();
    const requestedModeRaw =
      typeof body.modelMode === "string" ? body.modelMode : "auto";
    const allowedModes: ModelMode[] = ["auto", "nano", "mini", "full"];
    const modelMode = allowedModes.includes(requestedModeRaw as ModelMode)
      ? (requestedModeRaw as ModelMode)
      : "auto";
    const forceWebSearch = Boolean(body.forceWebSearch);
    const reasoningSetting = parseReasoningSetting(body.reasoningEffort);
    const verbositySetting = parseVerbositySetting(body.verbosity);
    const retryAssistantMessageId =
      typeof body.retryAssistantMessageId === "string" &&
      body.retryAssistantMessageId.trim().length > 0
        ? body.retryAssistantMessageId.trim()
        : null;
    let retryUserMessageId =
      typeof body.retryUserMessageId === "string" &&
      body.retryUserMessageId.trim().length > 0
        ? body.retryUserMessageId.trim()
        : null;

    if (!userText) {
      return NextResponse.json(
        { error: "Empty message" },
        { status: 400 }
      );
    }

    if (!conversationId) {
      return NextResponse.json(
        { error: "Missing conversation" },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    const { data: historyRows, error: historyError } = await supabase
      .from("messages")
      .select("id, role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(40);

    if (historyError) {
      console.error("Failed to load history", historyError);
      return NextResponse.json(
        { error: "Unable to load conversation history" },
        { status: 500 }
      );
    }

    const validHistoryRows: PersistedHistoryRow[] = (historyRows || [])
      .filter(
        (m): m is {
          id: string;
          role: "user" | "assistant";
          content: string;
        } =>
          !!m &&
          typeof m.id === "string" &&
          typeof m.content === "string" &&
          (m.role === "user" || m.role === "assistant")
      )
      .map((m) => ({ id: m.id, role: m.role, content: m.content }));

    const isRetryRequest = Boolean(retryAssistantMessageId);

    if (isRetryRequest && !retryAssistantMessageId) {
      return NextResponse.json(
        { error: "Missing retry message id" },
        { status: 400 }
      );
    }

    let historyRowsForModel = validHistoryRows;

    if (isRetryRequest && retryAssistantMessageId) {
      const assistantIndex = validHistoryRows.findIndex(
        (row) => row.id === retryAssistantMessageId
      );

      if (assistantIndex === -1) {
        return NextResponse.json(
          { error: "Assistant message not found" },
          { status: 404 }
        );
      }

      if (!retryUserMessageId) {
        for (let i = assistantIndex - 1; i >= 0; i -= 1) {
          if (validHistoryRows[i].role === "user") {
            retryUserMessageId = validHistoryRows[i].id;
            break;
          }
        }
      }

      if (!retryUserMessageId) {
        return NextResponse.json(
          { error: "Unable to identify user message for retry" },
          { status: 400 }
        );
      }

      const userIndex = validHistoryRows.findIndex(
        (row) => row.id === retryUserMessageId
      );

      if (userIndex === -1) {
        return NextResponse.json(
          { error: "User message not found for retry" },
          { status: 404 }
        );
      }

      historyRowsForModel = validHistoryRows.slice(0, userIndex + 1);
    }

    const historyForModel: HistoryMessage[] = historyRowsForModel.map(
      (message) => ({
        role: message.role,
        content: message.content,
      })
    );

    const { data: conversationRow } = await supabase
      .from("conversations")
      .select("title")
      .eq("id", conversationId)
      .single();

    const existingConversationTitle = (conversationRow?.title || "").trim();
    const hasAssistantHistory = historyForModel.some(
      (msg) => msg.role === "assistant"
    );
    const needsTitle =
      !hasAssistantHistory && isPlaceholderTitle(existingConversationTitle);

    let userRowId: string | null = null;
    let assistantRowId: string | null = null;

    if (isRetryRequest && retryAssistantMessageId) {
      assistantRowId = retryAssistantMessageId;
      userRowId = retryUserMessageId ?? null;
      try {
        await supabase
          .from("messages")
          .update({ content: "", metadata: null })
          .eq("id", assistantRowId)
          .eq("conversation_id", conversationId);
      } catch (error) {
        console.warn("Failed to clear assistant message before retry", error);
      }
    } else {
      const { data: userRow, error: userInsertError } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversationId,
          role: "user",
          content: userText,
        })
        .select("id")
        .single();

      if (userInsertError) {
        console.error("Failed to persist user message", userInsertError);
      }

      userRowId = userRow?.id ?? null;

      const { data: assistantRow, error: assistantInsertError } =
        await supabase
          .from("messages")
          .insert({
            conversation_id: conversationId,
            role: "assistant",
            content: "",
          })
          .select("id")
          .single();

      if (assistantInsertError) {
        console.error("Failed to seed assistant message", assistantInsertError);
      }

      assistantRowId = assistantRow?.id ?? null;
    }

    const openai = getOpenAIClient();

    const routerResult = await routeModel({
      openai,
      history: historyForModel,
      userText,
      requestedMode: modelMode,
      requestTitle: needsTitle && modelMode === "auto",
    });

    let routerTitlePromise: Promise<string | null> | null = null;
    if (needsTitle && routerResult.titleSuggestion) {
      routerTitlePromise = applyTitleSuggestion({
        supabase,
        conversationId,
        suggestedTitle: routerResult.titleSuggestion,
      });
    }

    let manualTitlePromise: Promise<string | null> | null = null;
    if (needsTitle && !routerResult.titleSuggestion && modelMode !== "auto") {
      manualTitlePromise = requestNanoTitle({
        openai,
        userMessage: userText,
      }).then((maybeTitle) =>
        maybeTitle
          ? applyTitleSuggestion({
              supabase,
              conversationId,
              suggestedTitle: maybeTitle,
            })
          : null
      );
    }

    const historyMessages = historyForModel.map((message) => ({
      role: message.role,
      content: message.content,
    }));

    const allowWebSearch = shouldAllowWebSearch({
      userText,
      forceWebSearch,
    });

    const systemMessages = [
      { role: "system" as const, content: BASE_SYSTEM_PROMPT },
      ...(forceWebSearch ? ([
        { role: "system" as const, content: FORCE_WEB_SEARCH_PROMPT },
      ] as const) : []),
    ];

    const requestMessages = [
      ...systemMessages,
      ...historyMessages,
      ...(isRetryRequest ? [] : ([{ role: "user" as const, content: userText }] as const)),
    ];

    const targetModelKey = routerResult.modelKey;
    const targetModel = MODEL_MAP[targetModelKey];
    const resolvedReasoning = resolveReasoningSetting(
      reasoningSetting,
      routerResult.defaultReasoningEffort
    );
    const resolvedVerbosity = resolveVerbositySetting(
      verbositySetting,
      routerResult.defaultVerbosity
    );
    const modelSupportsReasoning = MODEL_CAPABILITIES[targetModelKey].supportsReasoning;
    const modelSupportsVerbosity = MODEL_CAPABILITIES[targetModelKey].supportsVerbosity;

    const encoder = new TextEncoder();
    const historyForTitle = isRetryRequest
      ? historyForModel
      : [...historyForModel, { role: "user" as const, content: userText }];
    const firstUserMessage = historyForTitle.find(
      (msg) => msg.role === "user"
    )?.content;
    const isFirstAssistantResponse = !historyForModel.some(
      (msg) => msg.role === "assistant"
    );

    if (isFirstAssistantResponse) {
      void ensureChatTitle({
        openai,
        supabase,
        conversationId,
        userMessage: firstUserMessage ?? userText,
        assistantMessage: null,
        allowUserOnly: true,
      });
    }

    const readable = new ReadableStream({
      async start(controller) {
        const enqueueJson = (payload: Record<string, unknown>) => {
          controller.enqueue(
            encoder.encode(`${JSON.stringify(payload)}\n`)
          );
        };
        const sendStatusUpdate = (status: SearchStatusEvent) => {
          enqueueJson({ status });
        };
        const announceTitle = (promise: Promise<string | null> | null) => {
          promise
            ?.then((title) => {
              if (title) {
                enqueueJson({ title });
              }
            })
            .catch((err) =>
              console.warn("Unable to announce title update", err)
            );
        };
        let fullAssistantMessage = "";
        let responseMetadata: ResponseMetadata | null = null;

        announceTitle(routerTitlePromise);
        announceTitle(manualTitlePromise);

        enqueueJson({
          meta: {
            requestedModelMode: modelMode,
            assistantMessageRowId: assistantRowId,
            userMessageRowId: userRowId,
          },
        });

        try {
          const responseStream = await openai.responses.stream({
            model: targetModel,
            input: requestMessages,
            stream: true,
            tools: allowWebSearch ? ([{ type: "web_search" as const }] as const) : undefined,
            include: allowWebSearch
              ? [
                  "web_search_call.results",
                  "web_search_call.action.sources",
                ]
              : undefined,
            reasoning:
              modelSupportsReasoning
                ? { effort: resolvedReasoning }
                : undefined,
            text:
              modelSupportsVerbosity
                ? { verbosity: resolvedVerbosity }
                : undefined,
          });

          for await (const event of responseStream) {
            if (event.type === "response.output_text.delta") {
              const token = event.delta;
              if (token) {
                fullAssistantMessage += token;
                enqueueJson({ token });
              }
            } else if (
              event.type === "response.web_search_call.in_progress" ||
              event.type === "response.web_search_call.searching"
            ) {
              sendStatusUpdate({
                type: "search-start",
                query: "web search",
              });
            } else if (event.type === "response.web_search_call.completed") {
              sendStatusUpdate({
                type: "search-complete",
                query: "web search",
              });
            }
          }

          const finalResponse = await responseStream.finalResponse();
          if (finalResponse.output_text) {
            fullAssistantMessage = finalResponse.output_text;
          }
          const searchMetadata = extractSearchMetadata(finalResponse);
          const usedWebSearch = searchMetadata.records.length > 0;
          const sources = buildSourceChips(searchMetadata.records);
          if (searchMetadata.failed) {
            sendStatusUpdate({
              type: "search-error",
              query: "web search",
              message: "Web search failed; using prior knowledge.",
            });
          }
          responseMetadata = {
            usedModel: targetModel,
            usedModelMode: targetModelKey,
            requestedModelMode: modelMode,
            usedWebSearch,
            searchRecords: searchMetadata.records,
            sources,
          };

          enqueueJson({
            meta: responseMetadata,
          });
        } catch (err) {
          console.error("Stream error:", err);
          enqueueJson({ error: "upstream_error" });
        } finally {
          enqueueJson({ done: true });
          if (assistantRowId) {
            try {
              const updatePayload: {
                content: string;
                metadata?: ResponseMetadata;
              } = { content: fullAssistantMessage };

              if (responseMetadata) {
                updatePayload.metadata = responseMetadata;
              }

              await supabase
                .from("messages")
                .update(updatePayload)
                .eq("id", assistantRowId);
            } catch (persistErr) {
              console.error("Failed to persist assistant response", persistErr);
            }
          }

          if (isFirstAssistantResponse && fullAssistantMessage.trim()) {
            await ensureChatTitle({
              openai,
              supabase,
              conversationId,
              userMessage: firstUserMessage ?? userText,
              assistantMessage: fullAssistantMessage,
            });
          }

          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (error: unknown) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: "Server error calling OpenAI" },
      { status: 500 }
    );
  }
}

type RouteModelArgs = {
  openai: OpenAI;
  history: HistoryMessage[];
  userText: string;
  requestedMode: ModelMode;
  requestTitle?: boolean;
};

type RoutedModelConfig = {
  modelKey: ModelKey;
  defaultReasoningEffort: ConcreteReasoningEffort;
  defaultVerbosity: ConcreteVerbosity;
  titleSuggestion?: string | null;
};

async function routeModel({
  openai,
  history,
  userText,
  requestedMode,
  requestTitle = false,
}: RouteModelArgs): Promise<RoutedModelConfig> {
  if (requestedMode === "nano" || requestedMode === "mini" || requestedMode === "full") {
    return {
      modelKey: requestedMode,
      defaultReasoningEffort: ROUTER_DEFAULTS[requestedMode].reasoning,
      defaultVerbosity: ROUTER_DEFAULTS[requestedMode].verbosity,
    };
  }

  try {
    const response = await openai.responses.create({
      model: MODEL_MAP.nano,
      input: [
        {
          role: "system",
          content:
            'Given the user message and recent context, respond with minified JSON {"mode":"nano|mini|full","title":"..."}. "mode" selects the response model: nano for trivial or short questions, mini for most normal questions, full for complex or high-stakes reasoning. If a title is not needed, set "title" to an empty string. When a title is requested, keep it to 3-8 words with no punctuation, emojis, or filler.',
        },
        {
          role: "user",
          content: buildRouterPrompt(history, userText, requestTitle),
        },
      ],
    });
    const content = response.output_text?.trim() ?? "";
    const parsed = parseRouterResponse(content);
    if (parsed?.mode) {
      return {
        modelKey: parsed.mode,
        defaultReasoningEffort: ROUTER_DEFAULTS[parsed.mode].reasoning,
        defaultVerbosity: ROUTER_DEFAULTS[parsed.mode].verbosity,
        titleSuggestion: requestTitle ? parsed.title ?? "" : undefined,
      };
    }
  } catch (error) {
    console.warn("Model router failed, defaulting to mini", error);
  }

  return {
    modelKey: "mini",
    defaultReasoningEffort: ROUTER_DEFAULTS.mini.reasoning,
    defaultVerbosity: ROUTER_DEFAULTS.mini.verbosity,
    titleSuggestion: null,
  };
}

function buildRouterPrompt(
  history: HistoryMessage[],
  userText: string,
  requestTitle: boolean
) {
  const recent = history.slice(-6).map((message) => {
    const speaker = message.role === "user" ? "User" : "Assistant";
    return `${speaker}: ${message.content}`;
  });

  const recentBlock = recent.length > 0 ? recent.join("\n") : "(no prior messages)";

  const titleDirective = requestTitle
    ? "Provide a concise chat title in the `title` field based solely on the latest user request."
    : "Set `title` to an empty string.";

  return `Recent conversation:
${recentBlock}

Latest user request:
${userText}

Respond with JSON containing keys "mode" and "title". ${titleDirective}`;
}

function parseRouterResponse(content: string) {
  try {
    const parsed = JSON.parse(content);
    const rawMode = typeof parsed.mode === "string" ? parsed.mode.toLowerCase() : "";
    const title = typeof parsed.title === "string" ? parsed.title : "";
    if (rawMode === "nano" || rawMode === "mini" || rawMode === "full") {
      return { mode: rawMode as ModelKey, title };
    }
  } catch {
    // ignore
  }

  const normalized = content.trim().toLowerCase();
  if (normalized === "nano" || normalized === "mini" || normalized === "full") {
    return { mode: normalized as ModelKey, title: "" };
  }
  return null;
}

function extractSearchMetadata(response: OpenAIResponse) {
  const records: SearchRecord[] = [];
  let failed = false;
  const outputs = Array.isArray(response.output) ? response.output : [];
  for (const item of outputs) {
    if (!item || typeof item !== "object") {
      continue;
    }
    if ((item as { type?: string }).type !== "web_search_call") {
      continue;
    }
    const call = item as Record<string, any>;
    if (call.status === "failed") {
      failed = true;
    }
    const actions = Array.isArray(call.actions) ? call.actions : [];
    const searchAction = actions.find(
      (action) => action && typeof action === "object" && action.type === "search"
    ) as { query?: string; sources?: Array<{ url?: string }> } | undefined;
    const query =
      typeof call.query === "string"
        ? call.query
        : typeof searchAction?.query === "string"
          ? searchAction.query
          : "web search";
    const rawResults = extractWebSearchResults(call);
    const rankedSources: RankedSource[] = rawResults.length
      ? rawResults
      : buildSourcesFromAction(searchAction);
    const summaryParts: string[] = [];
    summaryParts.push(`Query: ${query}`);
    if (rankedSources.length > 0) {
      summaryParts.push(
        `Found ${rankedSources.length} source${rankedSources.length === 1 ? "" : "s"}`
      );
    } else if (call.status === "failed") {
      summaryParts.push("Search failed");
    } else {
      summaryParts.push("No sources returned");
    }
    records.push({
      query,
      summary: summaryParts.join(". "),
      rankedSources,
      rawResults,
      fromCache: false,
    });
  }
  return { records, failed };
}

function extractWebSearchResults(call: Record<string, any>) {
  const candidates = [
    call.results,
    call.output?.results,
    call.data?.results,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate
        .map((result) => normalizeWebSearchResult(result))
        .filter((result): result is RankedSource => Boolean(result));
    }
  }
  return [] as RankedSource[];
}

function buildSourcesFromAction(
  action: { sources?: Array<{ url?: string }> } | undefined
): RankedSource[] {
  if (!action?.sources) {
    return [];
  }
  return action.sources
    .map((source): RankedSource | null => {
      const url = typeof source?.url === "string" ? source.url : "";
      if (!url) {
        return null;
      }
      const domain = extractDomainFromUrl(url) || url;
      return {
        title: domain,
        url,
        snippet: "",
        domain,
        sourceType: "other",
        published: null,
        confidenceScore: 0.5,
      } satisfies RankedSource;
    })
    .filter((item): item is RankedSource => item !== null);
}

function normalizeWebSearchResult(result: unknown): RankedSource | null {
  if (!result || typeof result !== "object") {
    return null;
  }
  const data = result as Record<string, any>;
  const url =
    typeof data.url === "string"
      ? data.url
      : typeof data.link === "string"
        ? data.link
        : "";
  if (!url) {
    return null;
  }
  const title =
    typeof data.title === "string"
      ? data.title
      : typeof data.name === "string"
        ? data.name
        : url;
  const snippet =
    typeof data.snippet === "string"
      ? data.snippet
      : typeof data.excerpt === "string"
        ? data.excerpt
        : typeof data.summary === "string"
          ? data.summary
          : "";
  const published =
    typeof data.published_at === "string"
      ? data.published_at
      : typeof data.date === "string"
        ? data.date
        : null;
  const domain =
    extractDomainFromUrl(url) ||
    (typeof data.domain === "string" ? data.domain : undefined) ||
    (typeof data.site === "string" ? data.site : undefined) ||
    url;
  const sourceTypeRaw =
    typeof data.source_type === "string"
      ? data.source_type.toLowerCase()
      : "";
  const sourceType: RankedSource["sourceType"] =
    sourceTypeRaw === "official" ||
    sourceTypeRaw === "news" ||
    sourceTypeRaw === "reference"
      ? (sourceTypeRaw as RankedSource["sourceType"])
      : "other";
  const confidenceRaw =
    typeof data.score === "number"
      ? data.score
      : typeof data.confidence === "number"
        ? data.confidence
        : 0.5;
  return {
    title,
    url,
    snippet,
    domain,
    sourceType,
    published,
    confidenceScore: clampConfidence(confidenceRaw),
  };
}

function clampConfidence(value: number) {
  if (Number.isNaN(value)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, value));
}

async function ensureChatTitle({
  openai,
  supabase,
  conversationId,
  userMessage,
  assistantMessage,
  allowUserOnly = false,
}: {
  openai: OpenAI;
  supabase: ReturnType<typeof getSupabaseClient>;
  conversationId: string;
  userMessage: string;
  assistantMessage: string | null;
  allowUserOnly?: boolean;
}) {
  const trimmedAssistant = (assistantMessage || "").trim();
  const trimmedUser = userMessage.trim();

  if (!trimmedUser) {
    return;
  }

  if (!trimmedAssistant && !allowUserOnly) {
    return;
  }

  const { data: conversation, error } = await supabase
    .from("conversations")
    .select("title")
    .eq("id", conversationId)
    .single();

  if (error) {
    console.warn("Unable to load conversation for title", error);
    return;
  }

  const existingTitle = (conversation?.title || "").trim();
  if (existingTitle && existingTitle !== "New chat" && existingTitle !== "Untitled chat") {
    return;
  }

  const titleModelKey: ModelKey = "nano";

  try {
    const response = await openai.responses.create({
      model: MODEL_MAP[titleModelKey],
      input: [
        {
          role: "system",
          content:
            "You write ultra-short, specific chat titles (3-8 words). Avoid punctuation, quotes, emojis, and filler phrases. Respond with the title only.",
        },
        trimmedAssistant
          ? {
              role: "user" as const,
              content: `User message:\n${trimmedUser}\n\nAssistant reply:\n${trimmedAssistant}\n\nTitle:`,
            }
          : {
              role: "user" as const,
              content: `User message:\n${trimmedUser}\n\nTitle:`,
            },
      ],
      reasoning: { effort: "none" },
      text: { verbosity: "low" },
    });

    const rawTitle = response.output_text?.trim() || "";
    const normalized = normalizeGeneratedTitle(rawTitle);
    if (!normalized) {
      return;
    }

    await supabase
      .from("conversations")
      .update({ title: normalized })
      .eq("id", conversationId);
  } catch (err) {
    console.warn("Title generation failed", err);
  }
}

async function requestNanoTitle({
  openai,
  userMessage,
}: {
  openai: OpenAI;
  userMessage: string;
}): Promise<string | null> {
  try {
    const response = await openai.responses.create({
      model: MODEL_MAP.nano,
      input: [
        {
          role: "system",
          content:
            "You create short chat titles (3-8 words) from a single user prompt. Avoid punctuation, emojis, and filler words. Respond with the title only.",
        },
        {
          role: "user",
          content: `User message:\n${userMessage}\n\nTitle:`,
        },
      ],
      reasoning: { effort: "none" },
      text: { verbosity: "low" },
    });

    return response.output_text?.trim() || null;
  } catch (error) {
    console.warn("Nano title request failed", error);
    return null;
  }
}

async function applyTitleSuggestion({
  supabase,
  conversationId,
  suggestedTitle,
}: {
  supabase: ReturnType<typeof getSupabaseClient>;
  conversationId: string;
  suggestedTitle?: string | null;
}): Promise<string | null> {
  const normalized = normalizeGeneratedTitle(suggestedTitle);
  if (!normalized) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from("conversations")
      .select("title")
      .eq("id", conversationId)
      .single();

    if (error) {
      console.warn("Unable to load conversation for title update", error);
      return null;
    }

    if (!isPlaceholderTitle(data?.title)) {
      return null;
    }

    await supabase
      .from("conversations")
      .update({ title: normalized })
      .eq("id", conversationId);

    return normalized;
  } catch (error) {
    console.warn("Failed to apply title suggestion", error);
    return null;
  }
}
