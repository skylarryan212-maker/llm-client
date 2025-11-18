"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CODEX_AGENT_ID, agentIdFromMetadata } from "@/lib/agents";
import { TEST_USER_ID } from "@/lib/appConfig";
import {
  createConversationRecord,
  type ConversationMeta,
} from "@/lib/conversations";
import { supabase } from "@/lib/supabaseClient";

type CodexMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  persistedId?: string | null;
  pending?: boolean;
};

type MessageRow = {
  id?: string;
  role: "user" | "assistant";
  content?: string | null;
};

type LoadMessagesOptions = {
  silent?: boolean;
};

const CODEX_CHAT_TITLE = "New Codex chat";

function buildLocalId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useCodexChat() {
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);
  const [messagesByConversation, setMessagesByConversation] = useState(
    () => new Map<string, CodexMessage[]>()
  );
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingConversationId, setStreamingConversationId] = useState<
    string | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastLoadTargetRef = useRef<string | null>(null);

  const setConversationMessages = useCallback(
    (
      conversationId: string,
      updater: CodexMessage[] | ((prev: CodexMessage[]) => CodexMessage[])
    ) => {
      setMessagesByConversation((prev) => {
        const next = new Map(prev);
        const previousMessages = next.get(conversationId) ?? [];
        const nextMessages =
          typeof updater === "function"
            ? (updater as (prev: CodexMessage[]) => CodexMessage[])(
                previousMessages
              )
            : updater;
        next.set(conversationId, nextMessages);
        return next;
      });
    },
    []
  );

  const loadConversations = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, title, project_id, created_at, metadata")
        .eq("user_id", TEST_USER_ID)
        .order("created_at", { ascending: false });
      if (error) {
        throw error;
      }
      const codexConversations = (data || []).filter((conversation) =>
        agentIdFromMetadata((conversation as ConversationMeta).metadata) ===
        CODEX_AGENT_ID
      ) as ConversationMeta[];
      setConversations(codexConversations);
      if (!selectedConversationId && codexConversations.length > 0) {
        setSelectedConversationId(codexConversations[0].id);
      } else if (
        selectedConversationId &&
        !codexConversations.some((conversation) =>
          conversation.id === selectedConversationId
        )
      ) {
        setSelectedConversationId(codexConversations[0]?.id ?? null);
      }
    } catch (err) {
      console.error("Failed to load Codex conversations", err);
    }
  }, [selectedConversationId]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  const loadMessages = useCallback(
    async (conversationId: string, options: LoadMessagesOptions = {}) => {
      if (!conversationId) return;
      if (!options.silent) {
        setIsLoadingMessages(true);
      }
      lastLoadTargetRef.current = conversationId;
      try {
        const response = await fetch(
          `/api/messages?conversationId=${encodeURIComponent(conversationId)}`,
          { cache: "no-store" }
        );
        if (!response.ok) {
          throw new Error(
            `Failed to load Codex messages (${response.status} ${response.statusText})`
          );
        }
        const payload = (await response.json()) as {
          messages?: MessageRow[];
        };
        const rows = Array.isArray(payload.messages)
          ? payload.messages
          : [];
        const normalized = rows.map((row) => ({
          id: row.id ?? buildLocalId("message"),
          role: row.role,
          content: row.content ?? "",
          persistedId: row.id ?? null,
          pending: false,
        }));
        if (lastLoadTargetRef.current === conversationId) {
          setConversationMessages(conversationId, normalized);
        }
      } catch (err) {
        console.error("Failed to load Codex messages", err);
        if (lastLoadTargetRef.current === conversationId) {
          setConversationMessages(conversationId, []);
        }
      } finally {
        if (!options.silent) {
          setIsLoadingMessages(false);
        }
      }
    },
    [setConversationMessages]
  );

  useEffect(() => {
    if (!selectedConversationId) {
      setIsLoadingMessages(false);
      return;
    }
    void loadMessages(selectedConversationId);
  }, [loadMessages, selectedConversationId]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const createNewConversation = useCallback(async () => {
    const record = await createConversationRecord({
      title: CODEX_CHAT_TITLE,
      projectId: null,
      metadata: { agentId: CODEX_AGENT_ID },
    });
    setConversations((prev) => [record, ...prev.filter((c) => c.id !== record.id)]);
    setSelectedConversationId(record.id);
    setConversationMessages(record.id, []);
    void loadConversations();
    return record;
  }, [loadConversations, setConversationMessages]);

  const selectConversation = useCallback(
    (conversationId: string) => {
      if (!conversationId) {
        setSelectedConversationId(null);
        return;
      }
      if (conversationId === selectedConversationId) {
        void loadMessages(conversationId, { silent: true });
        return;
      }
      setSelectedConversationId(conversationId);
    },
    [loadMessages, selectedConversationId]
  );

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) {
        return;
      }
      setError(null);
      let targetConversationId = selectedConversationId;
      if (!targetConversationId) {
        const conversation = await createNewConversation();
        targetConversationId = conversation.id;
      }
      if (!targetConversationId) {
        return;
      }
      setConversations((prev) => {
        const index = prev.findIndex((conv) => conv.id === targetConversationId);
        if (index <= 0) {
          return prev;
        }
        const copy = [...prev];
        const [current] = copy.splice(index, 1);
        return [current, ...copy];
      });
      setSelectedConversationId(targetConversationId);
      const userTempId = buildLocalId("user");
      const assistantTempId = buildLocalId("assistant");
      setConversationMessages(targetConversationId, (prev) => [
        ...prev,
        { id: userTempId, role: "user", content: trimmed, pending: true },
        { id: assistantTempId, role: "assistant", content: "", pending: true },
      ]);
      setIsStreaming(true);
      setStreamingConversationId(targetConversationId);
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: trimmed,
            conversationId: targetConversationId,
            modelFamily: "auto",
            speedMode: "auto",
            agentId: CODEX_AGENT_ID,
          }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          throw new Error("Stream failed");
        }
        const reader = response.body.getReader();
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
                  const payload = JSON.parse(line) as {
                    token?: string;
                    done?: boolean;
                    error?: string;
                  };
                  if (payload.error) {
                    throw new Error(payload.error);
                  }
                  if (typeof payload.token === "string") {
                    setConversationMessages(targetConversationId, (prev) =>
                      prev.map((msg) =>
                        msg.id === assistantTempId
                          ? { ...msg, content: msg.content + payload.token }
                          : msg
                      )
                    );
                  }
                  if (payload.done) {
                    finished = true;
                  }
                } catch (streamError) {
                  console.warn("Unable to parse Codex stream payload", streamError);
                }
              }
              newlineIndex = buffer.indexOf("\n");
            }
          }
          if (done) {
            finished = true;
          }
        }
      } catch (err) {
        if ((err as DOMException)?.name === "AbortError") {
          return;
        }
        console.error("Codex send error", err);
        setError("Codex couldn't finish that request. Try again.");
      } finally {
        setIsStreaming(false);
        setStreamingConversationId(null);
        abortControllerRef.current = null;
        setConversationMessages(targetConversationId, (prev) =>
          prev.map((msg) => {
            if (msg.id === userTempId || msg.id === assistantTempId) {
              return { ...msg, pending: false };
            }
            return msg;
          })
        );
        await loadMessages(targetConversationId, { silent: true });
        void loadConversations();
      }
    },
    [
      createNewConversation,
      isStreaming,
      loadConversations,
      loadMessages,
      selectedConversationId,
      setConversationMessages,
    ]
  );

  const messages = useMemo(() => {
    if (!selectedConversationId) {
      return [] as CodexMessage[];
    }
    return messagesByConversation.get(selectedConversationId) ?? [];
  }, [messagesByConversation, selectedConversationId]);

  return {
    conversations,
    selectedConversationId,
    selectConversation,
    createNewConversation,
    messages,
    isLoadingMessages,
    isStreaming,
    streamingConversationId,
    sendMessage,
    error,
    setError,
  };
}
