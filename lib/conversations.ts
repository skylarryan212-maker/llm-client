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
  const hasMetadata = !!(metadata && Object.keys(metadata).length > 0);
  const payload = hasMetadata
    ? { ...basePayload, metadata }
    : basePayload;
  const selectColumns = "id, title, project_id, created_at, metadata";

  const insertConversation = async (body: Record<string, unknown>) =>
    supabase.from("conversations").insert(body).select(selectColumns).single();

  let { data, error } = await insertConversation(payload);

  if (error && hasMetadata) {
    const message = String(error.message || "").toLowerCase();
    const mentionsMetadata = message.includes("metadata");
    if (mentionsMetadata) {
      console.warn(
        "Retrying conversation insert without metadata column support",
        error
      );
      const fallback = await insertConversation(basePayload);
      data = fallback.data;
      error = fallback.error;
    }
  }

  if (error || !data) {
    throw error || new Error("Conversation not created");
  }

  return {
    ...(data as ConversationMeta),
    metadata: (data as ConversationMeta).metadata ?? null,
  };
}
