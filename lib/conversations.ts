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
    payload: Record<string, unknown>
  ): Promise<ConversationMeta> {
    const { data, error } = await supabase
      .from("conversations")
      .insert(payload)
      .select("id, title, project_id, created_at, metadata")
      .single();

    if (error || !data) {
      throw error || new Error("Conversation not created");
    }

    return data as ConversationMeta;
  }

  if (!metadataPayload) {
    return insertConversation(basePayload);
  }

  try {
    return await insertConversation({
      ...basePayload,
      metadata: metadataPayload,
    });
  } catch (error) {
    if (!shouldRetryWithoutMetadata(error)) {
      throw error;
    }

    console.warn(
      "Conversation metadata column missing, retrying without metadata"
    );
    const record = await insertConversation(basePayload);
    return {
      ...record,
      metadata: metadataPayload,
    };
  }
}

function shouldRetryWithoutMetadata(error: unknown): error is PostgrestError {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as Partial<PostgrestError> & { message?: string };
  const segments = [candidate.message, candidate.details, candidate.hint]
    .filter((segment): segment is string => typeof segment === "string")
    .map((segment) => segment.toLowerCase());
  if (segments.length === 0) {
    return false;
  }
  return segments.some(
    (segment) =>
      segment.includes("metadata") &&
      (segment.includes("does not exist") || segment.includes("column"))
  );
}
