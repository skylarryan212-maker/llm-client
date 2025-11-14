import { NextResponse } from "next/server";
import { supabase } from "../../../lib/supabaseClient";

export async function POST(req: Request) {
  const { message } = await req.json();

  const userMessage = (message || "").toString().trim();
  if (!userMessage) {
    return NextResponse.json({ reply: "Message is empty." }, { status: 400 });
  }

  const replyText = "Test mode reply — no GPT yet.";
  const userId = "test-user-1"; // temporary hardcoded user

  // Save both user and assistant messages
  const { error } = await supabase.from("messages").insert([
    {
      user_id: userId,
      role: "user",
      content: userMessage,
    },
    {
      user_id: userId,
      role: "assistant",
      content: replyText,
    },
  ]);

  if (error) {
    console.error("Supabase insert error:", error);
    // we still respond even if DB write fails
  }

  return NextResponse.json({ reply: replyText });
}
