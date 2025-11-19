import { supabase } from "./supabaseClient";
import { TEST_USER_ID } from "./appConfig";

export type ConversationMeta = {
  id: string;
  title: string | null;
  project_id: string | null;
  created_at?: string;
  metadata?: Record<string, unknown> | null;
};

type ConversationRow = {
  id?: unknown;
  title?: unknown;
  project_id?: unknown;
  created_at?: unknown;
  metadata?: unknown;
};

export function normalizeConversationMeta(
  raw: ConversationRow | null | undefined
): ConversationMeta | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const { id, title, project_id, created_at, metadata } = raw;
  if (typeof id !== "string") {
    return null;
  }

  const normalizedTitle =
    typeof title === "string" ? title : title === null ? null : null;

  const normalizedProjectId =
    typeof project_id === "string"
      ? project_id
      : project_id === null
        ? null
        : null;

  const normalizedMetadata =
    metadata && typeof metadata === "object"
      ? (metadata as Record<string, unknown>)
      : metadata === null
        ? null
        : null;

  const normalizedCreatedAt =
    typeof created_at === "string" ? created_at : undefined;

  return {
    id,
    title: normalizedTitle,
    project_id: normalizedProjectId,
    created_at: normalizedCreatedAt,
    metadata: normalizedMetadata,
  };
}

type CreateConversationArgs = {
  title: string;
  projectId: string | null;
  metadata?: Record<string, unknown> | null;
};

const LOCAL_ONLY_FLAG_KEY = "_localOnly";

const buildLocalConversationRecord = (
  title: string,
  projectId: string | null,
  metadata?: Record<string, unknown> | null
): ConversationMeta => {
  const fallbackId =
    typeof globalThis !== "undefined" &&
    globalThis.crypto &&
    typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const metadataWithFlag: Record<string, unknown> = {
    ...(metadata ?? {}),
    [LOCAL_ONLY_FLAG_KEY]: true,
  };
  return {
    id: fallbackId,
    title,
    project_id: projectId,
    created_at: new Date().toISOString(),
    metadata: metadataWithFlag,
  };
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

  try {
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

    const normalized = normalizeConversationMeta(data as ConversationRow);
    if (!normalized) {
      throw new Error("Conversation not created");
    }

    return normalized;
  } catch (error) {
    console.error("[CONVERSATION_CREATE] Failed to insert conversation", error);
    return buildLocalConversationRecord(title, projectId, metadata);
  }
}
