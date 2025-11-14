import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const body = await req.json();
  const userMessage = body.message || "";

  return NextResponse.json({
    reply: "Test mode reply — no GPT yet.",
  });
}
