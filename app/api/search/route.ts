export const runtime = "edge";

import { NextResponse } from "next/server";
import {
  GoogleSearchRequestError,
  MissingGoogleConfigError,
  googleSearch,
} from "@/lib/googleSearch";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const query = typeof body?.query === "string" ? body.query.trim() : "";

    if (!query) {
      return NextResponse.json({ error: "Missing query" }, { status: 400 });
    }

    const results = await googleSearch(query);

    return NextResponse.json({ results }, { status: 200 });
  } catch (error) {
    if (error instanceof MissingGoogleConfigError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const message =
      error instanceof GoogleSearchRequestError
        ? error.message
        : "Google search failed";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
