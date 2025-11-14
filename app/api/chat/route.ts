export const runtime = "edge";

import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

type HistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const userText = (body.message ?? "").toString().trim();
    const conversationId = (body.conversationId ?? "").toString();

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

    const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
      {
        role: "system",
        content:
          "You are a helpful assistant inside a custom LLM client. Use the conversation history to respond naturally. Be concise by default unless the user asks for detail.",
      },
      ...historyForModel,
      { role: "user", content: userText },
    ];

    // ⚡ Fast streaming GPT-5.1 chat model
    const stream = await client.chat.completions.create({
      model: "gpt-5-mini-2025-08-07",
      messages,
      stream: true,
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
