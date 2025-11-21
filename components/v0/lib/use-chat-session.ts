"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { DEFAULT_AGENT_ID } from "@/lib/agents";
import {
  createConversationRecord,
  type ConversationMeta,
  normalizeConversationMeta,
} from "@/lib/conversations";
import type { FileAttachment, ImageAttachment, Source, SourceChip } from "@/lib/chatTypes";
import { type ModelFamily, type ReasoningEffort, type SpeedMode } from "@/lib/modelConfig";

const DEFAULT_MODEL: ModelFamily = "gpt-5.1";
const DEFAULT_SPEED: SpeedMode = "auto";

export type MessageMetadata = {
  usedModel?: string;
  usedModelMode?: string;
  usedModelFamily?: ModelFamily;
  requestedModelMode?: string;
  requestedModelFamily?: ModelFamily;
  speedMode?: SpeedMode;
  reasoningEffort?: ReasoningEffort;
  usedWebSearch?: boolean;
  searchRecords?: Array<Record<string, unknown>>;
  sources?: SourceChip[];
  citations?: Source[];
  files?: FileAttachment[];
  attachments?: ImageAttachment[];
  generationType?: "text" | "image";
  generatedImages?: Array<{ id: string; dataUrl?: string; url?: string; model?: string; prompt?: string }>;
  imagePrompt?: string;
  imageModelLabel?: string;
  searchedSiteLabel?: string;
  searchedDomains?: string[];
  thinkingDurationMs?: number;
  thinking?: { effort?: ReasoningEffort | null; durationMs?: number; durationSeconds?: number };
};

export type ChatMessage = {
  id?: string;
  persistedId?: string;
  role: "user" | "assistant";
  content: string;
  metadata?: MessageMetadata | null;
  usedModel?: string;
  usedModelFamily?: ModelFamily;
  requestedModelFamily?: ModelFamily;
  speedMode?: SpeedMode;
  reasoningEffort?: ReasoningEffort;
  attachments?: ImageAttachment[];
  files?: FileAttachment[];
};

type SendState = {
  messages: ChatMessage[];
  conversations: ConversationMeta[];
  selectedConversationId: string | null;
  isStreaming: boolean;
  isLoadingMessages: boolean;
  sendMessage: (text: string) => Promise<void>;
  selectConversation: (id: string) => void;
  startNewChat: () => void;
  refreshConversations: () => Promise<void>;
};

function generateLocalId(prefix: string) {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function mapMessageRow(row: unknown): ChatMessage | null {
  if (!row || typeof row !== "object") return null;
  const { id, role, content, metadata } = row as {
    id?: unknown;
    role?: unknown;
    content?: unknown;
    metadata?: unknown;
  };
  if (role !== "user" && role !== "assistant") return null;
  if (typeof content !== "string") return null;

  const safeMetadata =
    metadata && typeof metadata === "object"
      ? (metadata as MessageMetadata)
      : null;

  const attachments = Array.isArray((safeMetadata as MessageMetadata | null)?.attachments)
    ? (safeMetadata as MessageMetadata).attachments
    : Array.isArray((safeMetadata as MessageMetadata | null)?.files)
      ? []
      : undefined;

  return {
    id: typeof id === "string" ? id : undefined,
    persistedId: typeof id === "string" ? id : undefined,
    role,
    content,
    metadata: safeMetadata,
    usedModel: safeMetadata?.usedModel,
    usedModelFamily: safeMetadata?.usedModelFamily,
    requestedModelFamily: safeMetadata?.requestedModelFamily,
    speedMode: safeMetadata?.speedMode,
    reasoningEffort: safeMetadata?.reasoningEffort,
    attachments,
    files: safeMetadata?.files,
  };
}

export function useChatSession(): SendState {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  const refreshConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations");
      if (!res.ok) return;
      const payload = (await res.json()) as { conversations?: unknown };
      const list = Array.isArray(payload.conversations)
        ? (payload.conversations as ConversationMeta[])
        : [];
      const normalized = list
        .map((conv) => normalizeConversationMeta(conv))
        .filter((conv): conv is ConversationMeta => Boolean(conv));
      setConversations(normalized);
      if (!selectedConversationId && normalized.length > 0) {
        setSelectedConversationId(normalized[0].id);
      }
    } catch (error) {
      console.error("[V0_CHAT] Failed to load conversations", error);
    }
  }, [selectedConversationId]);

  const loadMessages = useCallback(async (conversationId: string) => {
    setIsLoadingMessages(true);
    try {
      const res = await fetch(`/api/messages?conversationId=${encodeURIComponent(conversationId)}`);
      if (!res.ok) {
        setMessages([]);
        return;
      }
      const payload = (await res.json()) as { messages?: unknown };
      const parsed = Array.isArray(payload.messages)
        ? (payload.messages as unknown[])
            .map((row) => mapMessageRow(row))
            .filter((msg): msg is ChatMessage => Boolean(msg))
        : [];
      setMessages(parsed);
    } catch (error) {
      console.error("[V0_CHAT] Failed to load messages", error);
      setMessages([]);
    } finally {
      setIsLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  useEffect(() => {
    if (selectedConversationId) {
      void loadMessages(selectedConversationId);
    }
  }, [selectedConversationId, loadMessages]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const selectConversation = useCallback((id: string) => {
    if (!id) return;
    abortControllerRef.current?.abort();
    setIsStreaming(false);
    setSelectedConversationId(id);
  }, []);

  const startNewChat = useCallback(() => {
    abortControllerRef.current?.abort();
    setMessages([]);
    setSelectedConversationId(null);
    setIsStreaming(false);
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      let conversationId = selectedConversationId;
      if (!conversationId) {
        try {
          const conversation = await createConversationRecord({
            title: trimmed.slice(0, 80) || "New chat",
            projectId: null,
            metadata: null,
          });
          conversationId = conversation.id;
          setSelectedConversationId(conversationId);
          setConversations((prev) => [conversation, ...prev]);
        } catch (error) {
          console.error("[V0_CHAT] Failed to create conversation", error);
          return;
        }
      }

      const userMessageId = generateLocalId("user");
      const assistantMessageId = generateLocalId("assistant");

      setMessages((prev) => [
        ...prev,
        { id: userMessageId, role: "user", content: trimmed },
        {
          id: assistantMessageId,
          role: "assistant",
          content: "",
          metadata: { requestedModelFamily: DEFAULT_MODEL, speedMode: DEFAULT_SPEED },
          requestedModelFamily: DEFAULT_MODEL,
          speedMode: DEFAULT_SPEED,
        },
      ]);

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsStreaming(true);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            conversationId,
            modelFamily: DEFAULT_MODEL,
            speedMode: DEFAULT_SPEED,
            agentId: DEFAULT_AGENT_ID,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error("Chat request failed");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let finished = false;

        while (!finished) {
          const { value, done } = await reader.read();
          if (value) {
            buffer += decoder.decode(value, { stream: !done });
            let newlineIndex = buffer.indexOf("\n");
            while (newlineIndex !== -1) {
              const line = buffer.slice(0, newlineIndex).trim();
              buffer = buffer.slice(newlineIndex + 1);
              if (line) {
                try {
                  const payload = JSON.parse(line) as Record<string, unknown>;
                  if (payload.meta) {
                    const meta = payload.meta as MessageMetadata & {
                      assistantMessageRowId?: string;
                      userMessageRowId?: string;
                    };
                    setMessages((prev) =>
                      prev.map((msg) => {
                        if (msg.id === userMessageId && meta.userMessageRowId) {
                          return { ...msg, persistedId: meta.userMessageRowId };
                        }
                        if (msg.id !== assistantMessageId) return msg;
                        const mergedMetadata: MessageMetadata = {
                          ...(msg.metadata || {}),
                          ...meta,
                        };
                        return {
                          ...msg,
                          persistedId: meta.assistantMessageRowId || msg.persistedId,
                          metadata: mergedMetadata,
                          usedModel: meta.usedModel ?? msg.usedModel,
                          usedModelFamily: meta.usedModelFamily ?? msg.usedModelFamily,
                          requestedModelFamily:
                            meta.requestedModelFamily ?? msg.requestedModelFamily ?? DEFAULT_MODEL,
                          speedMode: meta.speedMode ?? msg.speedMode ?? DEFAULT_SPEED,
                          reasoningEffort: meta.reasoningEffort ?? msg.reasoningEffort,
                          attachments: mergedMetadata.attachments ?? msg.attachments,
                          files: mergedMetadata.files ?? msg.files,
                        };
                      })
                    );
                  }
                  if (typeof payload.token === "string") {
                    const token = payload.token as string;
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === assistantMessageId
                          ? { ...msg, content: `${msg.content}${token}` }
                          : msg
                      )
                    );
                  }
                  if (payload.done) {
                    finished = true;
                    break;
                  }
                } catch (error) {
                  console.warn("[V0_CHAT] Failed to parse stream chunk", error);
                }
              }
              newlineIndex = buffer.indexOf("\n");
            }
          }
          if (done) {
            finished = true;
          }
        }
      } catch (error) {
        console.error("[V0_CHAT] Chat request failed", error);
      } finally {
        setIsStreaming(false);
        abortControllerRef.current = null;
      }
    },
    [selectedConversationId]
  );

  return {
    messages,
    conversations,
    selectedConversationId,
    isStreaming,
    isLoadingMessages,
    sendMessage,
    selectConversation,
    startNewChat,
    refreshConversations,
  };
}
