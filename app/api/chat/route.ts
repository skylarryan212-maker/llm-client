export const runtime = "edge";

import { NextResponse } from "next/server";
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type HistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const userText = (body.message ?? "").toString().trim();
    const history = Array.isArray(body.history) ? (body.history as HistoryMessage[]) : [];

    if (!userText) {
      return NextResponse.json(
        { error: "Empty message" },
        { status: 400 }
      );
    }

    // Build the message list with recent history
    const historyForModel = history
      .filter(
        (m) =>
          m &&
          typeof m.content === "string" &&
          (m.role === "user" || m.role === "assistant")
      )
      .slice(-20); // last 20 messages

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

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const token = chunk.choices[0]?.delta?.content;
            if (token) {
              controller.enqueue(encoder.encode(token));
            }
          }
        } catch (err) {
          console.error("Stream error:", err);
        } finally {
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
  } catch (error: any) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: "Server error calling OpenAI" },
      { status: 500 }
    );
  }
}
