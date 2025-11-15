export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";
import {
  GoogleSearchRequestError,
  MissingGoogleConfigError,
  googleSearch,
} from "@/lib/googleSearch";
import type { GoogleSearchResult } from "@/lib/googleSearch";

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

type ModelMode = "auto" | "nano" | "mini" | "full";

type SearchRecord = {
  query: string;
  results: GoogleSearchResult[];
  summary: string;
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

const SEARCH_KEYWORDS = [
  "search the web",
  "google this",
  "look this up",
  "search online",
  "search google",
  "use google",
  "browse the web",
  "check the web",
];

type SearchStatusEvent =
  | { type: "search-start"; query: string }
  | { type: "search-complete"; query: string; results?: number }
  | { type: "search-error"; query: string; message?: string };

const RECENT_QUERY_KEYWORDS = [
  "today",
  "tonight",
  "current",
  "latest",
  "right now",
  "breaking",
  "news",
  "this week",
  "this month",
  "price",
  "prices",
  "stock",
  "stocks",
  "earnings",
  "forecast",
  "version",
  "update",
  "release",
];

function needsRecentResults(query: string) {
  const normalized = query.toLowerCase();
  return RECENT_QUERY_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function shouldSearchWeb(userText: string) {
  const normalized = userText.toLowerCase();
  return SEARCH_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function deriveSearchQuery(userText: string) {
  let query = userText
    .replace(/search( the)? (web|internet|online)/gi, "")
    .replace(/google (this|it)/gi, "")
    .replace(/look this up/gi, "")
    .replace(/use google/gi, "")
    .replace(/browse the web/gi, "")
    .replace(/check the web/gi, "")
    .trim();

  if (!query) {
    query = userText.trim();
  }

  return query;
}

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
      .select("role, content")
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

    const historyForModel = (historyRows || []).filter(
      (m): m is HistoryMessage =>
        !!m &&
        typeof m.content === "string" &&
        (m.role === "user" || m.role === "assistant")
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

    const { error: userInsertError } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        role: "user",
        content: userText,
      });

    if (userInsertError) {
      console.error("Failed to persist user message", userInsertError);
    }

    const { data: assistantRow, error: assistantInsertError } = await supabase
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
          "You are a helpful assistant inside a custom LLM client. You can access up-to-date Google search results via the google_search tool—treat them as real-time information, integrate them naturally, and cite sources when referencing them. Never claim you lack internet access, cannot browse, or are not up to date when tool results are provided. If search returns nothing useful, explain that briefly and rely on prior knowledge. Use conversation history, stay concise unless more detail is requested, and remain helpful and factual.",
      },
      ...historyMessages,
      { role: "user", content: userText },
    ];

    const messagesWithTools: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      ...baseMessages,
    ];
    const searchRecords: SearchRecord[] = [];
    const recordSearch = (record: SearchRecord) => {
      searchRecords.push({
        query: record.query,
        summary: record.summary,
        results: record.results.slice(0, 5),
      });
    };

    const encoder = new TextEncoder();
    const firstUserMessage = [
      ...historyForModel,
      { role: "user" as const, content: userText },
    ].find((msg) => msg.role === "user")?.content;
    const isFirstAssistantResponse = !historyForModel.some(
      (msg) => msg.role === "assistant"
    );

    const shouldForceSearch = forceWebSearch || shouldSearchWeb(userText);

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
        let responseMetadata: {
          usedModel: string;
          usedModelMode: ModelMode;
          requestedModelMode: ModelMode;
          usedWebSearch: boolean;
          searchRecords: SearchRecord[];
        } | null = null;

        announceTitle(routerTitlePromise);
        announceTitle(manualTitlePromise);

        try {
          if (shouldForceSearch) {
            await injectManualSearchResult(
              messagesWithTools,
              deriveSearchQuery(userText),
              recordSearch,
              sendStatusUpdate
            );
          }

          await runToolCallLoop({
            openai,
            model: MODEL_MAP[resolvedModelKey],
            messages: messagesWithTools,
            onSearchRecord: recordSearch,
            onSearchStatus: sendStatusUpdate,
          });

          const stream = await openai.chat.completions.create({
            model: MODEL_MAP[resolvedModelKey],
            messages: messagesWithTools,
            stream: true,
            tools: [GOOGLE_SEARCH_TOOL],
            tool_choice: "none",
          });

          const usedWebSearch = searchRecords.length > 0;
          responseMetadata = {
            usedModel: MODEL_MAP[resolvedModelKey],
            usedModelMode: resolvedModelKey,
            requestedModelMode: modelMode,
            usedWebSearch,
            searchRecords,
          };

          enqueueJson({
            meta: {
              ...responseMetadata,
              assistantMessageRowId: assistantRow?.id ?? null,
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
          if (assistantRow?.id) {
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
                .eq("id", assistantRow.id);
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
              modelMode,
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
};

async function runToolCallLoop({
  openai,
  model,
  messages,
  onSearchRecord,
  onSearchStatus,
}: ToolLoopArgs): Promise<void> {
  const MAX_ITERATIONS = 3;
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

    let sufficientResultsFound = false;

    for (const toolCall of toolCalls) {
      if (
        toolCall.type !== "function" ||
        toolCall.function?.name !== "google_search"
      ) {
        continue;
      }

      let query = "";
      try {
        const args = JSON.parse(toolCall.function?.arguments || "{}");
        if (typeof args?.query === "string") {
          query = args.query;
        }
      } catch (error) {
        console.warn("Failed to parse google_search arguments", error);
      }

      const trimmed = query.trim();
      const normalized = trimmed.toLowerCase();
      const cached =
        normalized && searchCache.has(normalized)
          ? searchCache.get(normalized)
          : null;

      if (
        cached &&
        cached.record &&
        cached.record.results.length > 0 &&
        normalized
      ) {
        messages.push(cached.message);
        continue;
      }

      const preferFreshResults = needsRecentResults(trimmed);
      const { message: toolResponse, record } = await createToolResponseMessage(
        toolCall.id ?? `tool-${Date.now()}`,
        trimmed,
        {
          preferFreshResults,
          onSearchStatus,
        }
      );
      if (record && onSearchRecord) {
        onSearchRecord(record);
      }
      if (record && record.results.length > 0 && normalized) {
        searchCache.set(normalized, { message: toolResponse, record });
      }
      if (record?.results?.length && record.results.length >= 3) {
        sufficientResultsFound = true;
      }
      messages.push(toolResponse);
    }

    if (sufficientResultsFound) {
      break;
    }
  }
}

async function injectManualSearchResult(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  query: string,
  onSearchRecord?: (record: SearchRecord) => void,
  onSearchStatus?: (status: SearchStatusEvent) => void
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
      preferFreshResults: needsRecentResults(trimmed),
      onSearchStatus,
    }
  );
  if (record && onSearchRecord) {
    onSearchRecord(record);
  }
  messages.push(toolResponse);
}

async function createToolResponseMessage(
  toolCallId: string,
  query: string,
  options: {
    preferFreshResults?: boolean;
    onSearchStatus?: (status: SearchStatusEvent) => void;
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
    options.onSearchStatus?.({ type: "search-start", query: trimmed });
    const results = await googleSearch(trimmed, {
      preferFreshResults: options.preferFreshResults,
    });
    const summary = formatSearchSummary(trimmed, results);
    console.info(
      `Google search: query='${trimmed}' results=${results.length}`
    );
    options.onSearchStatus?.({
      type: "search-complete",
      query: trimmed,
      results: results.length,
    });
    return {
      message: {
        role: "tool",
        tool_call_id: toolCallId,
        content: summary,
      },
      record: {
        query: trimmed,
        results,
        summary,
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

function formatSearchSummary(query: string, results: GoogleSearchResult[]) {
  if (!results.length) {
    return `Web search results for "${query}":\nNo results found.`;
  }

  const lines = results.slice(0, 5).map((item, index) => {
    const snippet = item.snippet?.replace(/\s+/g, " ") ?? "";
    return `${index + 1}. ${item.title} (${item.displayLink}) - ${snippet}`;
  });

  return `Web search results for "${query}":\n${lines.join("\n")}\nUse the numbered results above to ground your response.`;
}

async function ensureChatTitle({
  openai,
  supabase,
  conversationId,
  userMessage,
  assistantMessage,
  modelMode,
}: {
  openai: OpenAI;
  supabase: ReturnType<typeof getSupabaseClient>;
  conversationId: string;
  userMessage: string;
  assistantMessage: string;
  modelMode: ModelMode;
}) {
  const trimmedAssistant = assistantMessage.trim();
  const trimmedUser = userMessage.trim();

  if (!trimmedAssistant || !trimmedUser) {
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

  const titleModelKey: keyof typeof MODEL_MAP =
    modelMode === "nano"
      ? "nano"
      : modelMode === "mini"
        ? "mini"
        : modelMode === "full"
          ? "mini"
          : "nano";

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
        {
          role: "user",
          content: `User message:\n${trimmedUser}\n\nAssistant reply:\n${trimmedAssistant}\n\nTitle:`,
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
