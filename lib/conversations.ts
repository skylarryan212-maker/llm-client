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
  const payload: Record<string, unknown> = {
    user_id: TEST_USER_ID,
    title,
    project_id: projectId,
  };

  if (metadata && Object.keys(metadata).length > 0) {
    payload.metadata = metadata;
  }

  const { data, error } = await supabase
    .from("conversations")
    .insert(payload)
    .select("id, title, project_id, created_at, metadata")
    .single();

  if (error || !data) {
    throw error || new Error("Conversation not created");
  }

  return {
    ...(data as ConversationMeta),
    metadata: (data as ConversationMeta).metadata ?? null,
  };
}
