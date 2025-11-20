"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { supabase } from "@/lib/supabaseClient";
import { TEST_USER_ID } from "@/lib/appConfig";
import {
  normalizeConversationMeta,
  type ConversationMeta,
} from "@/lib/conversations";
import type { Project } from "@/lib/projects";
import type { ChatMessage } from "@/lib/chatTypes";

type MessagesByConversationId = Record<string, ChatMessage[]>;

const DEFAULT_CONVERSATION_TITLE = "New chat";

type ConversationsContextValue = {
  conversations: ConversationMeta[];
  setConversations: Dispatch<SetStateAction<ConversationMeta[]>>;
  projects: Project[];
  setProjects: Dispatch<SetStateAction<Project[]>>;
  refreshConversations: () => Promise<void>;
  selectedConversationId: string | null;
  setSelectedConversationId: Dispatch<SetStateAction<string | null>>;
  selectedProjectId: string | null;
  setSelectedProjectId: Dispatch<SetStateAction<string | null>>;
  pendingNewChat: boolean;
  setPendingNewChat: Dispatch<SetStateAction<boolean>>;
  pendingNewChatIsGlobal: boolean;
  setPendingNewChatIsGlobal: Dispatch<SetStateAction<boolean>>;
  pendingNewChatProjectId: string | null;
  setPendingNewChatProjectId: Dispatch<SetStateAction<string | null>>;
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setMessagesForConversation: (
    conversationId: string,
    updater: SetStateAction<ChatMessage[]>
  ) => void;
  appendMessages: (conversationId: string, newMessages: ChatMessage[]) => void;
  messagesByConversationId: MessagesByConversationId;
};

const ConversationsContext = createContext<ConversationsContextValue | null>(null);


export function ConversationsProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(
    null
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [pendingNewChat, setPendingNewChat] = useState(false);
  const [pendingNewChatIsGlobal, setPendingNewChatIsGlobal] = useState(false);
  const [pendingNewChatProjectId, setPendingNewChatProjectId] = useState<
    string | null
  >(null);
  const [messagesByConversationId, setMessagesByConversationId] = useState<
    MessagesByConversationId
  >({});
  const [draftMessages, setDraftMessages] = useState<ChatMessage[]>([]);

  const loadConversationsForUser = useCallback(async (userId: string) => {
    if (!userId) {
      return [] as ConversationMeta[];
    }

    try {
      const response = await fetch(`/api/conversations?userId=${encodeURIComponent(userId)}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        console.warn("Failed to load conversations", {
          status: response.status,
          statusText: response.statusText,
        });
        return [] as ConversationMeta[];
      }

      const payload = (await response.json()) as { conversations?: ConversationMeta[] };
      const rows = Array.isArray(payload.conversations) ? payload.conversations : [];
      const normalized = rows
        .map((row) => normalizeConversationMeta(row))
        .filter((row): row is ConversationMeta => Boolean(row));
      return normalized;
    } catch (error) {
      console.warn("Failed to load conversations", error);
      return [] as ConversationMeta[];
    }
  }, []);

  const mergeConversationLists = useCallback(
    (
      existing: ConversationMeta[],
      incoming: ConversationMeta[]
    ): ConversationMeta[] => {
      if (existing.length === 0) {
        return incoming;
      }

      const existingMap = new Map(existing.map((conv) => [conv.id, conv]));
      const merged = incoming.map((conv) => {
        const current = existingMap.get(conv.id);
        if (!current) {
          return conv;
        }

        const incomingTitle =
          typeof conv.title === "string" ? conv.title.trim() : "";
        const currentTitle =
          typeof current.title === "string" ? current.title.trim() : "";
        const resolvedTitle = (() => {
          if (incomingTitle && incomingTitle !== DEFAULT_CONVERSATION_TITLE) {
            return incomingTitle;
          }
          if (currentTitle && (!incomingTitle || incomingTitle === DEFAULT_CONVERSATION_TITLE)) {
            return currentTitle;
          }
          if (incomingTitle) return incomingTitle;
          if (currentTitle) return currentTitle;
          return null;
        })();

        const incomingProjectId =
          typeof conv.project_id === "string"
            ? conv.project_id
            : conv.project_id === null
              ? null
              : undefined;
        const resolvedProjectId =
          incomingProjectId === undefined
            ? current.project_id ?? null
            : incomingProjectId ?? current.project_id ?? null;
        const resolvedMetadata = conv.metadata ?? current.metadata;

        return {
          ...current,
          ...conv,
          title: resolvedTitle,
          project_id: resolvedProjectId,
          metadata: resolvedMetadata,
        };
      });

      existing.forEach((conv) => {
        if (!incoming.find((next) => next.id === conv.id)) {
          merged.push(conv);
        }
      });

      return merged;
    },
    []
  );

  const loadProjectsForUser = useCallback(async (userId: string) => {
    if (!userId) {
      return [] as Project[];
    }

    try {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, created_at")
        .eq("user_id", userId);

      if (error) {
        console.warn("Failed to load projects", error);
        return [] as Project[];
      }

      return (data || []) as Project[];
    } catch (error) {
      console.warn("Failed to load projects", error);
      return [] as Project[];
    }
  }, []);

  const messages = useMemo<ChatMessage[]>(() => {
    if (!selectedConversationId) {
      return draftMessages;
    }
    return messagesByConversationId[selectedConversationId] ?? [];
  }, [draftMessages, messagesByConversationId, selectedConversationId]);

  const setMessagesForConversation = useCallback(
    (conversationId: string, updater: React.SetStateAction<ChatMessage[]>) => {
      setMessagesByConversationId((prev) => {
        const current = prev[conversationId] ?? [];
        const nextValue = typeof updater === "function" ? (updater as (value: ChatMessage[]) => ChatMessage[])(current) : updater;
        if (nextValue === current) {
          return prev;
        }
        return { ...prev, [conversationId]: nextValue };
      });
    },
    []
  );

  const setMessages = useCallback<Dispatch<SetStateAction<ChatMessage[]>>>(
    (updater) => {
      if (selectedConversationId) {
        setMessagesForConversation(selectedConversationId, updater);
        return;
      }
      setDraftMessages((prev) =>
        typeof updater === "function"
          ? (updater as (value: ChatMessage[]) => ChatMessage[])(prev)
          : updater
      );
    },
    [selectedConversationId, setMessagesForConversation]
  );

  const appendMessages = useCallback(
    (conversationId: string, newMessages: ChatMessage[]) => {
      setMessagesForConversation(conversationId, (prev) => [...prev, ...newMessages]);
    },
    [setMessagesForConversation]
  );

  const refreshConversations = useCallback(async () => {
    const loadedConversations = await loadConversationsForUser(TEST_USER_ID);
    setConversations((prev) => mergeConversationLists(prev, loadedConversations));
  }, [loadConversationsForUser, mergeConversationLists]);

  useEffect(() => {
    if (!TEST_USER_ID) {
      return;
    }

    let cancelled = false;

    async function bootstrap() {
      try {
        const [loadedProjects, loadedConversations] = await Promise.all([
          loadProjectsForUser(TEST_USER_ID),
          loadConversationsForUser(TEST_USER_ID),
        ]);

        if (cancelled) {
          return;
        }

        setProjects(loadedProjects);
        setConversations((prev) => mergeConversationLists(prev, loadedConversations));
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to bootstrap chat data", error);
        }
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [
    loadConversationsForUser,
    loadProjectsForUser,
    mergeConversationLists,
  ]);

  useEffect(() => {
    const handle = setTimeout(() => {
      void refreshConversations();
    }, 0);

    return () => clearTimeout(handle);
  }, [refreshConversations]);

  // eslint-disable-next-line react-hooks/preserve-manual-memoization
  const value = useMemo<ConversationsContextValue>(
    () => ({
      conversations,
      setConversations,
      projects,
      setProjects,
      refreshConversations,
      selectedConversationId,
      setSelectedConversationId,
      selectedProjectId,
      setSelectedProjectId,
      pendingNewChat,
      setPendingNewChat,
      pendingNewChatIsGlobal,
      setPendingNewChatIsGlobal,
      pendingNewChatProjectId,
      setPendingNewChatProjectId,
      messages,
      setMessages,
      setMessagesForConversation,
      appendMessages,
      messagesByConversationId,
    }),
    [
      appendMessages,
      conversations,
      messages,
      messagesByConversationId,
      pendingNewChat,
      pendingNewChatIsGlobal,
      pendingNewChatProjectId,
      projects,
      refreshConversations,
      selectedConversationId,
      selectedProjectId,
      setMessages,
      setMessagesForConversation,
    ]
  );

  return (
    <ConversationsContext.Provider value={value}>
      {children}
    </ConversationsContext.Provider>
  );
}

export function useConversationsStore() {
  const context = useContext(ConversationsContext);
  if (!context) {
    throw new Error("useConversationsStore must be used within a ConversationsProvider");
  }
  return context;
}
