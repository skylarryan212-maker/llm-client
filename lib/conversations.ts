import type { PostgrestError } from "@supabase/supabase-js";

import { supabase } from "./supabaseClient";
import { TEST_USER_ID } from "./appConfig";

export type ConversationMeta = {
  id: string;
  title: string | null;
  project_id: string | null;
  created_at?: string;
  metadata?: Record<string, unknown> | null;
};

type CreateConversationArgs = {
  title: string;
  projectId: string | null;
  metadata?: Record<string, unknown> | null;
};

export async function createConversationRecord({
  title,
  projectId,
  metadata,
}: CreateConversationArgs): Promise<ConversationMeta> {
  const basePayload: Record<string, unknown> = {
    user_id: TEST_USER_ID,
    title,
    project_id: projectId,
  };
  const metadataPayload =
    metadata && Object.keys(metadata).length > 0 ? { ...metadata } : null;

  async function insertConversation(
    payload: Record<string, unknown>,
    { includeMetadataColumn = true }: { includeMetadataColumn?: boolean } = {}
  ): Promise<ConversationMeta> {
    const selectColumns = includeMetadataColumn
      ? "id, title, project_id, created_at, metadata"
      : "id, title, project_id, created_at";
    const { data, error } = await supabase
      .from("conversations")
      .insert(payload)
      .select(selectColumns)
      .single();

    if (error || !data) {
      throw error || new Error("Conversation not created");
    }

    const record = data as ConversationMeta;
    if (includeMetadataColumn) {
      return record;
    }
    return {
      ...record,
      metadata: record.metadata ?? null,
    };
  }

  async function insertWithColumnFallback(
    payload: Record<string, unknown>,
    metadataForReturn: Record<string, unknown> | null
  ) {
    try {
      return await insertConversation(payload);
    } catch (error) {
      if (!shouldRetryWithoutMetadata(error)) {
        throw error;
      }

      console.warn(
        "Conversation metadata column missing, retrying without metadata"
      );
      const record = await insertConversation(payload, {
        includeMetadataColumn: false,
      });
      if (metadataForReturn) {
        return {
          ...record,
          metadata: metadataForReturn,
        };
      }
      return record;
    }
  }

  if (!metadataPayload) {
    return insertWithColumnFallback(basePayload, null);
  }

  return insertWithColumnFallback(
    {
      ...basePayload,
      metadata: metadataPayload,
    },
    metadataPayload
  );
}

function shouldRetryWithoutMetadata(error: unknown): error is PostgrestError {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as Partial<PostgrestError> & { message?: string };
  const errorCode = typeof candidate.code === "string"
    ? candidate.code.trim().toUpperCase()
    : null;
  if (errorCode === "42703") {
    // 42703 => undefined column
    return true;
  }
  const segments = [candidate.message, candidate.details, candidate.hint]
    .filter((segment): segment is string => typeof segment === "string")
    .map((segment) => segment.toLowerCase());
  if (segments.length === 0) {
    return false;
  }
  return segments.some((segment) => {
    if (!segment.includes("metadata")) {
      return false;
    }
    return (
      segment.includes("does not exist") ||
      segment.includes("missing") ||
      segment.includes("unknown") ||
      segment.includes("column")
    );
  });
}
