export const runtime = "edge";

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

const MODEL_MAP = {
  nano: "gpt-5.1-nano",
  mini: "gpt-5.1-mini",
  full: "gpt-5.1",
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

    const resolvedModelKey = await selectModelKey({
      openai,
      history: historyForModel,
      userText,
      requestedMode: modelMode,
    });

    const historyMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
      historyForModel.map((message) => ({
        role: message.role,
        content: message.content,
      }));

    const baseMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content:
          "You are a helpful assistant inside a custom LLM client. Use the conversation history to respond naturally. Be concise by default unless the user asks for detail. Cite sources when referencing web results.",
      },
      ...historyMessages,
      { role: "user", content: userText },
    ];

    const messagesWithTools: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      ...baseMessages,
    ];

    const shouldForceSearch = forceWebSearch || shouldSearchWeb(userText);
    if (shouldForceSearch) {
      await injectManualSearchResult(messagesWithTools, deriveSearchQuery(userText));
    }

    await runToolCallLoop({
      openai,
      model: MODEL_MAP[resolvedModelKey],
      messages: messagesWithTools,
    });

    const stream = await openai.chat.completions.create({
      model: MODEL_MAP[resolvedModelKey],
      messages: messagesWithTools,
      stream: true,
      tools: [GOOGLE_SEARCH_TOOL],
      tool_choice: "none",
    });

    const encoder = new TextEncoder();
    let fullAssistantMessage = "";

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const token = chunk.choices[0]?.delta?.content;
            if (token) {
              fullAssistantMessage += token;
              controller.enqueue(encoder.encode(token));
            }
          }
        } catch (err) {
          console.error("Stream error:", err);
        } finally {
          if (assistantRow?.id) {
            try {
              await supabase
                .from("messages")
                .update({ content: fullAssistantMessage })
                .eq("id", assistantRow.id);
            } catch (persistErr) {
              console.error("Failed to persist assistant response", persistErr);
            }
          }
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
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
};

async function selectModelKey({
  openai,
  history,
  userText,
  requestedMode,
}: SelectModelArgs): Promise<keyof typeof MODEL_MAP> {
  if (requestedMode === "nano" || requestedMode === "mini" || requestedMode === "full") {
    return requestedMode;
  }

  try {
    const completion = await openai.chat.completions.create({
      model: MODEL_MAP.nano,
      messages: [
        {
          role: "system",
          content:
            "Given the user message and recent context, output ONLY one of: nano, mini, full. Use nano for trivial / short questions, mini for most normal questions, full for complex, multi-step, or high-stakes reasoning.",
        },
        {
          role: "user",
          content: buildRouterPrompt(history, userText),
        },
      ],
      temperature: 0,
    });

    const choice = completion.choices[0]?.message?.content?.trim().toLowerCase();
    if (choice === "nano" || choice === "mini" || choice === "full") {
      return choice;
    }
  } catch (error) {
    console.warn("Model router failed, defaulting to mini", error);
  }

  return "mini";
}

function buildRouterPrompt(history: HistoryMessage[], userText: string) {
  const recent = history.slice(-6).map((message) => {
    const speaker = message.role === "user" ? "User" : "Assistant";
    return `${speaker}: ${message.content}`;
  });

  const recentBlock = recent.length > 0 ? recent.join("\n") : "(no prior messages)";

  return `Recent conversation:\n${recentBlock}\n\nLatest user request:\n${userText}\n\nRespond with one word: nano, mini, or full.`;
}

type ToolLoopArgs = {
  openai: OpenAI;
  model: string;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
};

async function runToolCallLoop({
  openai,
  model,
  messages,
}: ToolLoopArgs): Promise<void> {
  const MAX_ITERATIONS = 3;

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

    for (const toolCall of toolCalls) {
      if (toolCall.type !== "function" || toolCall.function?.name !== "google_search") {
        continue;
      }

      const query = parseSearchQuery(toolCall.function?.arguments);
      const toolResponse = await createToolResponseMessage(
        toolCall.id ?? `tool-${Date.now()}`,
        query
      );
      messages.push(toolResponse);
    }
  }
}

async function injectManualSearchResult(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  query: string
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

  const toolResponse = await createToolResponseMessage(toolCallId, trimmed);
  messages.push(toolResponse);
}

function parseSearchQuery(rawArgs: string | undefined) {
  if (!rawArgs) return "";
  try {
    const parsed = JSON.parse(rawArgs) as { query?: unknown };
    return typeof parsed.query === "string" ? parsed.query : "";
  } catch (error) {
    console.warn("Failed to parse google_search arguments", error);
    return "";
  }
}

async function createToolResponseMessage(
  toolCallId: string,
  query: string
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam> {
  const trimmed = query.trim();
  if (!trimmed) {
    return {
      role: "tool",
      tool_call_id: toolCallId,
      content: "Web search skipped: missing query.",
    };
  }

  try {
    const results = await googleSearch(trimmed);
    const summary = formatSearchSummary(trimmed, results);
    return {
      role: "tool",
      tool_call_id: toolCallId,
      content: summary,
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

    return {
      role: "tool",
      tool_call_id: toolCallId,
      content: `Web search failed: ${message}`,
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
