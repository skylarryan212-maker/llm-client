export const runtime = "nodejs";

import { NextResponse } from "next/server";

import { TEST_USER_ID } from "@/lib/appConfig";
import {
  normalizeConversationMeta,
  type ConversationMeta,
  type ConversationRow,
} from "@/lib/conversations";
import { getServerSupabaseClient } from "@/lib/serverSupabase";

type PostgrestLikeError = {
  code?: string | number | null;
  message?: string | null;
  details?: string | null;
};

type PostgrestErrorContainer = PostgrestLikeError & {
  cause?: unknown;
  error?: unknown;
};

function extractPostgrestError(error: unknown): PostgrestLikeError | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const candidate = error as PostgrestErrorContainer;

  if (candidate.code || candidate.message || candidate.details) {
    return candidate;
  }

  if ("cause" in candidate && candidate.cause) {
    const nested = extractPostgrestError(candidate.cause);
    if (nested) {
      return nested;
    }
  }

  if ("error" in candidate && candidate.error) {
    const nested = extractPostgrestError(candidate.error);
    if (nested) {
      return nested;
    }
  }

  return null;
}

function isMissingMetadataColumn(error: unknown) {
  const pgError = extractPostgrestError(error);
  if (!pgError) {
    return false;
  }

  if (pgError.code && pgError.code.toString() === "42703") {
    return true;
  }

  const combinedMessage = `${pgError.message ?? ""} ${pgError.details ?? ""}`
    .toLowerCase()
    .trim();

  return Boolean(
    combinedMessage &&
      combinedMessage.includes("metadata") &&
      combinedMessage.includes("column")
  );
}

export async function GET() {
  try {
    const supabase = getServerSupabaseClient();
    const selectWithMetadata = "id, title, project_id, created_at, metadata";
    const selectWithoutMetadata = "id, title, project_id, created_at";

    const runConversationQuery = async (selectColumns: string) => {
      const { data, error } = await supabase
        .from("conversations")
        .select(selectColumns)
        .eq("user_id", TEST_USER_ID)
        .order("created_at", { ascending: false });

      if (error) {
        throw error;
      }

      return Array.isArray(data) ? (data as ConversationRow[]) : [];
    };

    let rows: ConversationRow[] = [];

    try {
      rows = await runConversationQuery(selectWithMetadata);
    } catch (error) {
      if (!isMissingMetadataColumn(error)) {
        throw error;
      }

      console.warn(
        "[CONVERSATIONS_API] Metadata column missing; retrying without it",
        error
      );
      rows = await runConversationQuery(selectWithoutMetadata);
    }

    const normalized = rows
      .map((row) => normalizeConversationMeta(row))
      .filter((row): row is ConversationMeta => Boolean(row));

    return NextResponse.json({ conversations: normalized });
  } catch (error) {
    console.error("[CONVERSATIONS_API] Failed to load conversations", error);
    return NextResponse.json(
      { error: "Unable to load conversations" },
      { status: 500 }
    );
  }
}
