"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { supabase } from "@/lib/supabaseClient";
import { TEST_USER_ID } from "@/lib/appConfig";
import {
  normalizeConversationMeta,
  type ConversationMeta,
} from "@/lib/conversations";
import type { Project } from "@/lib/projects";

const ConversationsContext = createContext<ConversationsContextValue | null>(null);

type ConversationsContextValue = {
  conversations: ConversationMeta[];
  setConversations: React.Dispatch<React.SetStateAction<ConversationMeta[]>>;
  projects: Project[];
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>;
  refreshConversations: () => Promise<void>;
};

export function ConversationsProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);

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

  const refreshConversations = useCallback(async () => {
    const loadedConversations = await loadConversationsForUser(TEST_USER_ID);
    setConversations(loadedConversations);
  }, [loadConversationsForUser]);

  useEffect(() => {
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
        setConversations(loadedConversations);
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
  }, [loadConversationsForUser, loadProjectsForUser]);

  const value = useMemo<ConversationsContextValue>(
    () => ({
      conversations,
      setConversations,
      projects,
      setProjects,
      refreshConversations,
    }),
    [conversations, projects, refreshConversations]
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
