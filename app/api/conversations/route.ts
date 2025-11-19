export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { TEST_USER_ID } from "@/lib/appConfig";
import {
  normalizeConversationMeta,
  type ConversationMeta,
} from "@/lib/conversations";
import { getServerSupabaseClient } from "@/lib/serverSupabase";

function isMissingMetadataColumn(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const pgError = error as { code?: string; message?: string; details?: string };
  if (pgError.code && pgError.code.toString() === "42703") {
    return true;
  }
  const combinedMessage = `${pgError.message ?? ""} ${pgError.details ?? ""}`
    .toLowerCase()
    .trim();
  return combinedMessage.includes("metadata") &&
    combinedMessage.includes("column")
    ? true
    : false;
}

export async function GET() {
  try {
    const supabase = getServerSupabaseClient();
    const selectWithMetadata = "id, title, project_id, created_at, metadata";
    const selectWithoutMetadata = "id, title, project_id, created_at";

    const fetchConversations = async (selectColumns: string) =>
      supabase
        .from("conversations")
        .select(selectColumns)
        .eq("user_id", TEST_USER_ID)
        .order("created_at", { ascending: false });

    let { data, error } = await fetchConversations(selectWithMetadata);

    if (error && isMissingMetadataColumn(error)) {
      console.warn(
        "[CONVERSATIONS_API] Metadata column missing; retrying without it"
      );
      const fallback = await fetchConversations(selectWithoutMetadata);
      data = fallback.data;
      error = fallback.error;
    }

    if (error) {
      console.error("[CONVERSATIONS_API] Failed to load conversations", error);
      return NextResponse.json(
        { error: "Unable to load conversations" },
        { status: 500 }
      );
    }

    const rows = Array.isArray(data) ? data : [];
    const normalized = rows
      .map((row) => normalizeConversationMeta(row))
      .filter((row): row is ConversationMeta => Boolean(row));

    return NextResponse.json({ conversations: normalized });
  } catch (error) {
    console.error("[CONVERSATIONS_API] Unexpected error", error);
    return NextResponse.json(
      { error: "Unable to load conversations" },
      { status: 500 }
    );
  }
}
