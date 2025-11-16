export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import {
  GoogleSearchRequestError,
  MissingGoogleConfigError,
  googleSearch,
  peekCachedSearch,
} from "@/lib/googleSearch";
import type { GoogleSearchResult } from "@/lib/googleSearch";
import type { SourceChip } from "@/lib/chatTypes";
import {
  planSearchQuery,
  normalizeAndRankSources,
  type RankedSource,
} from "@/lib/searchPlanner";

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

type SearchRecord = {
  query: string;
  rawResults: GoogleSearchResult[];
  rankedSources: RankedSource[];
  summary: string;
  fromCache: boolean;
};

type SearchBudget = { remaining: number };
type SearchSequenceTracker = { value: number };

type SearchDebugLogger = {
  step: (stepNumber: number, message: string, meta?: Record<string, unknown>) => void;
};

type ResponseMetadata = {
  usedModel: string;
  usedModelMode: ModelMode;
  requestedModelMode: ModelMode;
  usedWebSearch: boolean;
  searchRecords: SearchRecord[];
  sources: SourceChip[];
};

const MODEL_MAP = {
  nano: "gpt-5-nano-2025-08-07",
  mini: "gpt-5-mini-2025-08-07",
  full: "gpt-5.1-2025-11-13",
} as const;

const GOOGLE_SEARCH_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "google_search",
    description: "Search the web using Google Custom Search",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The query to send to Google Custom Search",
        },
      },
      required: ["query"],
    },
  },
};

type SearchStatusEvent =
  | { type: "search-start"; query: string }
  | { type: "search-complete"; query: string; results?: number }
  | { type: "search-error"; query: string; message?: string };

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

    // Load the persisted history so the model gets consistent context.
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

    const { model: resolvedModelKey, titleSuggestion } = await selectModelKey({
      openai,
      history: historyForModel,
      userText,
      requestedMode: modelMode,
      requestTitle: needsTitle && modelMode === "auto",
    });

    let routerTitlePromise: Promise<string | null> | null = null;
    if (needsTitle && titleSuggestion) {
      routerTitlePromise = applyTitleSuggestion({
        supabase,
        conversationId,
        suggestedTitle: titleSuggestion,
      });
    }

    let manualTitlePromise: Promise<string | null> | null = null;
    if (needsTitle && !titleSuggestion && modelMode !== "auto") {
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

    const historyMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
      historyForModel.map((message) => ({
        role: message.role,
        content: message.content,
      }));

    const baseMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content:
          "You are a web-connected assistant. You can call `google_search` to fetch up-to-date information from the public internet.\n" +
          "Rules:\n" +
          "1. Call google_search whenever the user asks for current, changing, or post-training facts (recent releases, weather, markets, local info, breaking news, etc.). Keep each query short and human-like.\n" +
          "2. The tool returns live sources that override your training data. When those results exist you must use them, cite them inline (Source: domain.com), and end with a Sources section that repeats the same domains. Never claim you cannot browse the web or that your knowledge is out of date in those turns.\n" +
          "3. You may refine at most two google_search calls per user request. If the limit is hit, answer with the information you already have and explain the constraint.\n" +
          "4. Never send meta/capability/model questions to google_search—answer those from internal knowledge.\n" +
          "5. Blend internal knowledge with tool data: use background knowledge for stable context, but rely on live sources for time-sensitive specifics and never contradict high-confidence tool data.\n" +
          "6. If tool results are empty or insufficient, say so before falling back to general knowledge.",
      },
      ...historyMessages,
      ...(isRetryRequest ? [] : ([{ role: "user", content: userText }] as const)),
    ];

    const messagesWithTools: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      ...baseMessages,
    ];
    const searchRecords: SearchRecord[] = [];
    const recordSearch = (record: SearchRecord) => {
      searchRecords.push({
        query: record.query,
        summary: record.summary,
        rawResults: record.rawResults.slice(0, 5),
        rankedSources: record.rankedSources.slice(0, 5),
        fromCache: record.fromCache,
      });
    };

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

    const plannerView = planSearchQuery(userText, { userText });
    const searchLogger = createSearchDebugLogger({
      conversationId,
      userText,
    });
    const plannerAllowsSearch = !plannerView.skipSearch && plannerView.intent !== "meta";
    searchLogger.step(1, "Planner intent", {
      reason: plannerView.reason,
      topic: plannerView.topic ?? "general",
      preferRecent: plannerView.preferRecent,
      intent: plannerView.intent,
    });

    const searchBudget: SearchBudget = { remaining: 2 };
    const searchSequence: SearchSequenceTracker = { value: 0 };
    const shouldForceSearch = Boolean(
      forceWebSearch && plannerAllowsSearch && Boolean(plannerView.query)
    );
    searchLogger.step(
      2,
      shouldForceSearch
        ? "User forced pre-search"
        : "Model will decide on tool calls",
      shouldForceSearch
        ? {
            query: plannerView.query,
            preferRecent: plannerView.preferRecent,
          }
        : undefined
    );

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

        try {
          if (shouldForceSearch && plannerView.query) {
            await injectManualSearchResult(
              messagesWithTools,
              plannerView.query,
              {
                preferRecent: plannerView.preferRecent,
                onSearchRecord: recordSearch,
                onSearchStatus: sendStatusUpdate,
                searchBudget,
                searchLogger,
                reason: forceWebSearch
                  ? "user-forced pre-search"
                  : "intent planner",
                searchSequence,
              }
            );
          }

          await runToolCallLoop({
            openai,
            model: MODEL_MAP[resolvedModelKey],
            messages: messagesWithTools,
            onSearchRecord: recordSearch,
            onSearchStatus: sendStatusUpdate,
            searchBudget,
            searchLogger,
            searchSequence,
            userText,
          });

          console.log(
  `[toolLoop] webUsed=${searchRecords.length > 0} model=${resolvedModelKey}`
);

// Start from the tool-augmented messages
const finalMessages = [...messagesWithTools];

// If any web search actually ran, make it *impossible* for the model
// to claim it has no web access or only stale knowledge.
if (searchRecords.length > 0) {
  finalMessages.push({
    role: "system",
    content:
      "You have successfully called the `google_search` tool and received up-to-date web " +
      "results for this user request. You MUST treat those tool results as live data and " +
      "the primary evidence for your answer. You are not allowed to say that you cannot " +
      "browse the web, that you lack live data, or that your knowledge only goes up to " +
      "a past cutoff date when answering this question. Use the tool results, cite them, " +
      "and only use your internal knowledge for background context.",
  });
}

const postSearchDirective = createPostSearchDirective(searchRecords);
if (postSearchDirective) {
  finalMessages.push({
    role: "system",
    content: postSearchDirective,
  });
}


          const stream = await openai.chat.completions.create({
            model: MODEL_MAP[resolvedModelKey],
            messages: finalMessages,
            stream: true,
            tools: [GOOGLE_SEARCH_TOOL],
            tool_choice: "none",
          });

          const usedWebSearch = searchRecords.length > 0;
          const sources = buildSourceChips(searchRecords);
          responseMetadata = {
            usedModel: MODEL_MAP[resolvedModelKey],
            usedModelMode: resolvedModelKey,
            requestedModelMode: modelMode,
            usedWebSearch,
            searchRecords,
            sources,
          };

          if (usedWebSearch) {
            const groundedDomains = searchRecords
              .flatMap((record) =>
                record.rankedSources.slice(0, 2).map((source) => source.domain)
              )
              .filter(Boolean);
            searchLogger.step(8, "Live data will override training data", {
              domains: groundedDomains,
            });
            const groundingSummary = searchRecords
              .map((record) => {
                const domains = record.rankedSources
                  .slice(0, 2)
                  .map((source) => source.domain)
                  .join(", ");
                return `${record.query}: ${domains}`;
              })
              .join(" | ");
            searchLogger.step(9, "Answer grounded in", {
              summary: groundingSummary || "live data available",
            });
          } else {
            searchLogger.step(8, "No live web sources used", {
              reason: plannerAllowsSearch ? "model skipped" : plannerView.reason,
            });
            searchLogger.step(9, "Answer relies on internal knowledge", {
              summary: "no web citations",
            });
          }

          enqueueJson({
            meta: {
              ...responseMetadata,
              assistantMessageRowId: assistantRowId,
              userMessageRowId: userRowId,
            },
          });

          for await (const chunk of stream) {
            const token = chunk.choices[0]?.delta?.content;
            if (token) {
              fullAssistantMessage += token;
              enqueueJson({ token });
            }
          }
        } catch (err) {
          console.error("Stream error:", err);
          enqueueJson({ error: "upstream_error" });
        } finally {
          enqueueJson({ done: true });
          if (assistantRowId) {
            try {
              const updatePayload: {
                content: string;
                metadata?: typeof responseMetadata;
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

type SelectModelArgs = {
  openai: OpenAI;
  history: HistoryMessage[];
  userText: string;
  requestedMode: ModelMode;
  requestTitle?: boolean;
};

type SelectModelResult = {
  model: keyof typeof MODEL_MAP;
  titleSuggestion?: string | null;
};

async function selectModelKey({
  openai,
  history,
  userText,
  requestedMode,
  requestTitle = false,
}: SelectModelArgs): Promise<SelectModelResult> {
  if (requestedMode === "nano" || requestedMode === "mini" || requestedMode === "full") {
    return { model: requestedMode };
  }

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL_MAP.nano,
      messages: [
        {
          role: "system",
          content:
            'Given the user message and recent context, respond with minified JSON {\"mode\":\"nano|mini|full\",\"title\":\"...\"}. "mode" selects the response model: nano for trivial or short questions, mini for most normal questions, full for complex or high-stakes reasoning. If a title is not needed, set "title" to an empty string. When a title is requested, keep it to 3-8 words with no punctuation, emojis, or filler.',
        },
        {
          role: "user",
          content: buildRouterPrompt(history, userText, requestTitle),
        },
      ],
    });

    const content = completion.choices[0]?.message?.content?.trim() ?? "";
    const parsed = parseRouterResponse(content);
    if (parsed?.mode) {
      return {
        model: parsed.mode,
        titleSuggestion: requestTitle ? parsed.title ?? "" : undefined,
      };
    }
  } catch (error) {
    console.warn("Model router failed, defaulting to mini", error);
  }

  return { model: "mini", titleSuggestion: null };
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

Respond with JSON containing keys \"mode\" and \"title\". ${titleDirective}`;
}

function parseRouterResponse(content: string) {
  try {
    const parsed = JSON.parse(content);
    const rawMode = typeof parsed.mode === "string" ? parsed.mode.toLowerCase() : "";
    const title = typeof parsed.title === "string" ? parsed.title : "";
    if (rawMode === "nano" || rawMode === "mini" || rawMode === "full") {
      return { mode: rawMode as keyof typeof MODEL_MAP, title };
    }
  } catch {
    // ignore
  }

  const normalized = content.trim().toLowerCase();
  if (normalized === "nano" || normalized === "mini" || normalized === "full") {
    return { mode: normalized as keyof typeof MODEL_MAP, title: "" };
  }
  return null;
}

type ToolLoopArgs = {
  openai: OpenAI;
  model: string;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  onSearchRecord?: (record: SearchRecord) => void;
  onSearchStatus?: (status: SearchStatusEvent) => void;
  searchBudget: SearchBudget;
  searchLogger: SearchDebugLogger;
  searchSequence: SearchSequenceTracker;
  userText: string;
};

async function runToolCallLoop({
  openai,
  model,
  messages,
  onSearchRecord,
  onSearchStatus,
  searchBudget,
  searchLogger,
  searchSequence,
  userText,
}: ToolLoopArgs): Promise<void> {
  const MAX_ITERATIONS = 2;
  const searchCache = new Map<
    string,
    {
      message: OpenAI.Chat.Completions.ChatCompletionMessageParam;
      record: SearchRecord | null;
    }
  >();

  for (let i = 0; i < MAX_ITERATIONS; i += 1) {
    const completion = await openai.chat.completions.create({
      model,
      messages,
      tools: [GOOGLE_SEARCH_TOOL],
      tool_choice: "auto",
    });

    const choice = completion.choices[0];
    const toolCalls = choice?.message?.tool_calls;

    if (!toolCalls || toolCalls.length === 0) {
      break;
    }

    messages.push({
      role: "assistant",
      content: choice.message?.content ?? "",
      tool_calls: toolCalls,
    });

    let iterationDidSearch = false;
    let iterationFoundUsableResults = false;

    for (const toolCall of toolCalls) {
      if (
        toolCall.type !== "function" ||
        toolCall.function?.name !== "google_search"
      ) {
        continue;
      }

      let rawQuery = "";
      try {
        const args = JSON.parse(toolCall.function?.arguments || "{}");
        if (typeof args?.query === "string") {
          rawQuery = args.query;
        }
      } catch (error) {
        console.warn("Failed to parse google_search arguments", error);
      }

      const plan = planSearchQuery(rawQuery || userText, { userText });
      if (plan.skipSearch || plan.intent === "meta") {
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id ?? `tool-${Date.now()}`,
          content:
            plan.intent === "meta"
              ? "Web search skipped: capability and model questions must be answered without google_search."
              : `Web search skipped: ${plan.reason ?? "unable to prepare a query"}. Answer using existing information.`,
        });
        continue;
      }

      const normalizedQuery = plan.query.trim();
      if (!normalizedQuery) {
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id ?? `tool-${Date.now()}`,
          content: "Web search skipped: normalized query was empty.",
        });
        continue;
      }

      const cacheKey = normalizedQuery.toLowerCase();
      const cached = cacheKey && searchCache.has(cacheKey)
        ? searchCache.get(cacheKey)
        : null;

      if (
        cached &&
        cached.record &&
        cached.record.rankedSources.length > 0 &&
        cacheKey
      ) {
        messages.push(cached.message);
        continue;
      }

      const { message: toolResponse, record } = await createToolResponseMessage(
        toolCall.id ?? `tool-${Date.now()}`,
        normalizedQuery,
        {
          preferRecent: plan.preferRecent,
          onSearchStatus,
          searchBudget,
          searchLogger,
          reason: plan.reason ?? "model-request",
          searchSequence,
        }
      );
      if (record && onSearchRecord) {
        onSearchRecord(record);
      }
      if (record && record.rankedSources.length > 0 && cacheKey) {
        searchCache.set(cacheKey, { message: toolResponse, record });
      }
      if (record) {
        iterationDidSearch = true;
        if (record.rankedSources.length > 0) {
          iterationFoundUsableResults = true;
        }
      }
      messages.push(toolResponse);
    }

    if (!iterationDidSearch) {
      break;
    }
    if (iterationFoundUsableResults) {
      break;
    }
  }
}

async function injectManualSearchResult(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  query: string,
  options: {
    preferRecent?: boolean;
    onSearchRecord?: (record: SearchRecord) => void;
    onSearchStatus?: (status: SearchStatusEvent) => void;
    searchBudget: SearchBudget;
    searchLogger: SearchDebugLogger;
    reason: string;
    searchSequence: SearchSequenceTracker;
  }
) {
  const trimmed = query.trim();
  if (!trimmed) {
    return;
  }

  const toolCallId = `forced-search-${Date.now()}`;
  messages.push({
    role: "assistant",
    content: "",
    tool_calls: [
      {
        id: toolCallId,
        type: "function",
        function: {
          name: "google_search",
          arguments: JSON.stringify({ query: trimmed }),
        },
      },
    ],
  });

  const { message: toolResponse, record } = await createToolResponseMessage(
    toolCallId,
    trimmed,
    {
      preferRecent: options.preferRecent,
      onSearchStatus: options.onSearchStatus,
      searchBudget: options.searchBudget,
      searchLogger: options.searchLogger,
      reason: options.reason,
      searchSequence: options.searchSequence,
    }
  );
  if (record && options.onSearchRecord) {
    options.onSearchRecord(record);
  }
  messages.push(toolResponse);
}

async function createToolResponseMessage(
  toolCallId: string,
  query: string,
  options: {
    preferRecent?: boolean;
    onSearchStatus?: (status: SearchStatusEvent) => void;
    searchBudget?: SearchBudget;
    searchLogger?: SearchDebugLogger;
    reason?: string;
    searchSequence?: SearchSequenceTracker;
  } = {}
): Promise<{
  message: OpenAI.Chat.Completions.ChatCompletionMessageParam;
  record: SearchRecord | null;
}> {
  const trimmed = query.trim();
  if (!trimmed) {
    return {
      message: {
        role: "tool",
        tool_call_id: toolCallId,
        content: "Web search skipped: missing query.",
      },
      record: null,
    };
  }

  try {
    const preferRecent = Boolean(options.preferRecent);
    const searchBudget = options.searchBudget;
    const searchLogger = options.searchLogger;
    const cachedAvailability = peekCachedSearch(trimmed, preferRecent);
    if (searchBudget && searchBudget.remaining <= 0 && !cachedAvailability) {
      searchLogger?.step(3, "Cache unavailable and budget exhausted", {
        query: trimmed,
      });
      return {
        message: {
          role: "tool",
          tool_call_id: toolCallId,
          content:
            "Web search skipped: the maximum of two google_search calls was reached. Answer using existing live sources or background knowledge.",
        },
        record: null,
      };
    }

    options.onSearchStatus?.({ type: "search-start", query: trimmed });
    const searchIndex = options.searchSequence
      ? (options.searchSequence.value += 1)
      : 1;
    const searchResponse = await googleSearch(trimmed, {
      preferRecent,
    });
    if (!searchResponse.fromCache && searchBudget) {
      searchBudget.remaining = Math.max(0, searchBudget.remaining - 1);
    }

    if (searchIndex === 1) {
      searchLogger?.step(
        3,
        searchResponse.fromCache ? "Cache hit" : "Cache miss",
        {
          query: trimmed,
          preferRecent,
          cacheAgeMs: searchResponse.cacheAgeMs,
        }
      );
    } else if (searchIndex === 2) {
      searchLogger?.step(5, "Second query executed", {
        reason: options.reason ?? "follow-up",
      });
      searchLogger?.step(6, "Refined query", {
        query: trimmed,
        cacheHit: searchResponse.fromCache,
        cacheAgeMs: searchResponse.cacheAgeMs,
      });
    }

    const rankedSources = normalizeAndRankSources(searchResponse.results);

    if (searchIndex === 1) {
      const domains = rankedSources.slice(0, 3).map((source) => source.domain);
      searchLogger?.step(4, "Result count and domains", {
        query: trimmed,
        resultCount: rankedSources.length,
        domains,
      });
    }

    if (rankedSources.length) {
      searchLogger?.step(7, "High-confidence sources", {
        sources: rankedSources
          .slice(0, 3)
          .map(
            (source) =>
              `${source.domain}:${source.sourceType}:${source.confidenceScore.toFixed(2)}`
          ),
      });
    }

    const summary = formatSearchSummary(trimmed, rankedSources, {
      preferRecent,
      fromCache: searchResponse.fromCache,
    });
    console.log(
      `[googleSearch] query="${trimmed}" preferRecent=${preferRecent} results=${rankedSources.length}`
    );
    options.onSearchStatus?.({
      type: "search-complete",
      query: trimmed,
      results: rankedSources.length,
    });
    return {
      message: {
        role: "tool",
        tool_call_id: toolCallId,
        content: summary,
      },
      record: {
        query: trimmed,
        rawResults: searchResponse.results,
        rankedSources,
        summary,
        fromCache: searchResponse.fromCache,
      },
    };
  } catch (error) {
    const message =
      error instanceof MissingGoogleConfigError
        ? error.message
        : error instanceof GoogleSearchRequestError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Unknown Google search error";

    console.warn(`Google search skipped: ${message}`);
    options.onSearchStatus?.({
      type: "search-error",
      query: trimmed,
      message,
    });
    return {
      message: {
        role: "tool",
        tool_call_id: toolCallId,
        content: `Web search failed: ${message}`,
      },
      record: null,
    };
  }
}

function createSearchDebugLogger({
  conversationId,
  userText,
}: {
  conversationId: string;
  userText: string;
}): SearchDebugLogger {
  const suffix = conversationId ? conversationId.slice(-6) : "unknown";
  const snippet = userText ? userText.replace(/\s+/g, " ").slice(0, 32) : "";
  const prefix = snippet
    ? `[searchDebug:${suffix}:${snippet}]`
    : `[searchDebug:${suffix}]`;
  return {
    step(stepNumber, message, meta) {
      if (meta) {
        console.log(`${prefix} STEP ${stepNumber}: ${message}`, meta);
      } else {
        console.log(`${prefix} STEP ${stepNumber}: ${message}`);
      }
    },
  };
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

function buildSourceChips(
  records: SearchRecord[],
  maxSources = 4
): SourceChip[] {
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

function createPostSearchDirective(records: SearchRecord[]) {
  if (!records.length) {
    return null;
  }
  const summaries = records.map((record, index) => {
    if (!record.rankedSources.length) {
      return `${index + 1}. Query "${record.query}" returned no usable live sources.`;
    }
    const firstDomain =
      record.rankedSources[0]?.domain ||
      extractDomainFromUrl(record.rankedSources[0]?.url || "") ||
      "the listed sites";
    const count = Math.min(record.rankedSources.length, 5);
    return `${index + 1}. Query "${record.query}" produced ${count} ranked source${count === 1 ? "" : "s"} (e.g., ${firstDomain}).`;
  });

  return (
    "Live google_search data is available for this reply.\n" +
    `${summaries.join("\n")}\n` +
    "Use the ranked sources as authoritative: mention them inline with (Source: domain.com) style hints and end with a Sources section that repeats the same domains. Never claim to lack internet access when these results exist, and if they felt insufficient, say so explicitly before falling back to general knowledge."
  );
}

function formatSearchSummary(
  query: string,
  results: RankedSource[],
  options: { preferRecent: boolean; fromCache: boolean }
) {
  const headerLines = [
    "google_search complete:",
    `Normalized query: "${query}"`,
    `Source: ${options.fromCache ? "cache (recent)" : "live web"}`,
    `Recency bias: ${options.preferRecent ? "enabled" : "standard"}`,
    "Treat these sources as fresher than your training data and cite them inline using (Source: domain.com) hints before ending with a Sources section.",
  ];

  if (!results.length) {
    return (
      `${headerLines.join("\n")}\nNo ranked results were returned. Tell the user the live search was empty before relying on general knowledge.`
    );
  }

  const lines = results.slice(0, 5).map((item, index) => {
    const snippet = item.snippet || "";
    const published = item.published ? ` (${item.published})` : "";
    const confidence = `${Math.round(item.confidenceScore * 100)}%`;
    return `${index + 1}. ${item.title} — ${item.domain}${published} [confidence ${confidence}]: ${snippet}`;
  });

  return (
    `${headerLines.join("\n")}\nTop sources:\n${lines.join("\n")}\nUse these domains for inline citations and mention if the evidence felt incomplete before relying on background knowledge.`
  );
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

  const titleModelKey: keyof typeof MODEL_MAP = "nano";

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL_MAP[titleModelKey],
      max_completion_tokens: 32,
      temperature: 1,
      messages: [
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
    });

    const rawTitle = completion.choices[0]?.message?.content?.trim() || "";
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
    const completion = await openai.chat.completions.create({
      model: MODEL_MAP.nano,
      max_completion_tokens: 24,
      temperature: 1,
      messages: [
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
    });

    return completion.choices[0]?.message?.content?.trim() || null;
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

