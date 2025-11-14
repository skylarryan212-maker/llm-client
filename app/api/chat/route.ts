import { NextResponse } from "next/server";
import { supabase } from "../../../lib/supabaseClient";

const TEST_USER_ID = "test-user-1";

export async function POST(req: Request) {
  const { message, conversationId } = await req.json();

  const userMessage = (message || "").toString().trim();

  if (!userMessage) {
    return NextResponse.json(
      { reply: "Message is empty." },
      { status: 400 }
    );
  }

  if (!conversationId) {
    return NextResponse.json(
      { reply: "No conversation selected." },
      { status: 400 }
    );
  }

  const replyText = "Test mode reply — no GPT yet.";

  const { error } = await supabase.from("messages").insert([
    {
      user_id: TEST_USER_ID,
      conversation_id: conversationId,
      role: "user",
      content: userMessage,
    },
    {
      user_id: TEST_USER_ID,
      conversation_id: conversationId,
      role: "assistant",
      content: replyText,
    },
  ]);

  if (error) {
    console.error("Supabase insert error:", error);
  }

  return NextResponse.json({ reply: replyText });
}
