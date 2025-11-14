import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q");

    if (!q) {
      return NextResponse.json({ error: "Missing ?q=" }, { status: 400 });
    }

    const apiKey = process.env.GOOGLE_API_KEY;
    const cx = process.env.GOOGLE_CX;

    if (!apiKey || !cx) {
      return NextResponse.json(
        { error: "Missing GOOGLE_API_KEY or GOOGLE_CX" },
        { status: 500 }
      );
    }

    const url =
      `https://www.googleapis.com/customsearch/v1?` +
      `key=${apiKey}&cx=${cx}&q=${encodeURIComponent(q)}`;

    const googleRes = await fetch(url);
    const data = await googleRes.json();

    return NextResponse.json(data);
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Google search failed" },
      { status: 500 }
    );
  }
}
