import { NextResponse } from "next/server";
import OpenAI from "openai";
import { supabase } from "c:/Users/sdsry/llm-client/lib/supabaseClient"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// TEMP: single fake user
const TEST_USER_ID = "test-user-1";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const userText = (body.message ?? "").toString().trim();

    if (!userText) {
      return NextResponse.json(
        { error: "Empty message" },
        { status: 400 }
      );
    }

    // --- 1) Find or create a conversation for this user ---
    const { data: convRow, error: convSelectError } = await supabase
      .from("conversations")
      .select("id")
      .eq("user_id", TEST_USER_ID)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (convSelectError) {
      console.error("Supabase select conversation error:", convSelectError);
    }

    let conversationId = convRow?.id;

    if (!conversationId) {
      const { data: newConv, error: convInsertError } = await supabase
        .from("conversations")
        .insert({
          user_id: TEST_USER_ID,
          title: userText.slice(0, 60) || "New chat",
        })
        .select("id")
        .single();

      if (convInsertError) {
        console.error("Supabase create conversation error:", convInsertError);
      }

      conversationId = newConv?.id;
    }

    // --- 2) Log user message ---
    if (conversationId) {
      const { error: msgInsertError } = await supabase.from("messages").insert([
        {
          user_id: TEST_USER_ID,
          conversation_id: conversationId,
          role: "user",
          content: userText,
        },
      ]);

      if (msgInsertError) {
        console.error("Supabase insert user message error:", msgInsertError);
      }
    }

    // --- 3) Call OpenAI (non-streaming for now) ---
    const completion = await openai.chat.completions.create({
      // Use a model that actually exists for you:
      // e.g. "gpt-4.1-mini" or "gpt-4o-mini"
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant.",
        },
        {
          role: "user",
          content: userText,
        },
      ],
    });

    const replyText =
      completion.choices[0]?.message?.content ??
      "I couldn't generate a reply.";

    // --- 4) Log assistant message ---
    if (conversationId) {
      const { error: assistantInsertError } = await supabase
        .from("messages")
        .insert([
          {
            user_id: TEST_USER_ID,
            conversation_id: conversationId,
            role: "assistant",
            content: replyText,
          },
        ]);

      if (assistantInsertError) {
        console.error(
          "Supabase insert assistant message error:",
          assistantInsertError
        );
      }
    }

    // --- 5) Return JSON to the frontend ---
    return NextResponse.json({ reply: replyText });
  } catch (error: any) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: "Server error calling OpenAI" },
      { status: 500 }
    );
  }
}
