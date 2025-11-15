"use client";

import {
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeRaw from "rehype-raw";
import { supabase } from "../lib/supabaseClient";

type SearchSource = {
  title: string;
  link: string;
  displayLink: string;
  snippet: string;
};

type SearchRecord = {
  query: string;
  summary: string;
  results: SearchSource[];
};

type ChatMessage = {
  id?: string;
  role: "user" | "assistant";
  content: string;
  usedModel?: string;
  usedModelMode?: ModelMode;
  usedWebSearch?: boolean;
  searchRecords?: SearchRecord[];
};

type Project = {
  id: string;
  name: string;
  created_at?: string;
};

type ConversationMeta = {
  id: string;
  title: string | null;
  project_id: string | null;
  created_at?: string;
};

type ViewMode = "chat" | "project";

type ModelMode = "auto" | "nano" | "mini" | "full";

const TEST_USER_ID = "test-user-1";

const MODEL_SEGMENTS: { value: ModelMode; label: string; hint: string }[] = [
  { value: "auto", label: "Auto", hint: "Router" },
  { value: "nano", label: "Fast", hint: "Nano" },
  { value: "mini", label: "Normal", hint: "Mini" },
  { value: "full", label: "Deep", hint: "5.1" },
];

const MODEL_NAME_MAP: Record<Exclude<ModelMode, "auto">, string> = {
  nano: "gpt-5-nano-2025-08-07",
  mini: "gpt-5-mini-2025-08-07",
  full: "gpt-5.1-2025-11-13",
};

function createLocalId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

const markdownComponents: Components = {
  p: ({ children }) => <p className="mb-2 leading-relaxed">{children}</p>,
  ul: ({ children }) => (
    <ul className="mb-2 list-disc space-y-1 pl-5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 list-decimal space-y-1 pl-5">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  code({ inline, children }: { inline?: boolean; children?: ReactNode }) {
    if (inline) {
      return (
        <code className="rounded-md bg-[#2d2d30] px-1.5 py-0.5 text-[13px]">
          {children}
        </code>
      );
    }
    return (
      <pre className="mt-2 overflow-x-auto rounded-lg bg-[#111111] px-3 py-2 text-[13px]">
        <code>{children}</code>
      </pre>
    );
  },
};

function latestConvTimeForProject(projectId: string, convs: ConversationMeta[]) {
  const filtered = convs.filter(
    (c) => c.project_id === projectId && c.created_at
  );
  if (filtered.length === 0) return null;
  return filtered.reduce((max, c) => {
    const t = c.created_at!;
    if (!max) return t;
    return t > max ? t : max;
  }, filtered[0].created_at!);
}

function getNewestConversation(conversations: ConversationMeta[]) {
  if (conversations.length === 0) return null;
  return [...conversations].sort((a, b) =>
    (b.created_at || "").localeCompare(a.created_at || "")
  )[0];
}

export default function Home() {
  // ------------------------------------------------------------
  // STATE
  // ------------------------------------------------------------

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [modelMode, setModelMode] = useState<ModelMode>("auto");
  const [forceWebSearch, setForceWebSearch] = useState(false);

  const [projects, setProjects] = useState<Project[]>([]);
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null
  );
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);

  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("chat");

  const [showProjectModal, setShowProjectModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const skipAutoLoadRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [activeAssistantMessageId, setActiveAssistantMessageId] =
    useState<string | null>(null);
  const [expandedSourcesId, setExpandedSourcesId] = useState<string | null>(
    null
  );
  const [openModelMenuId, setOpenModelMenuId] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  function scrollToBottom(opts: { behavior?: ScrollBehavior } = {}) {
    const el = chatContainerRef.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: opts.behavior ?? "smooth",
    });
  }

  function handleJumpToBottom() {
    scrollToBottom({ behavior: "smooth" });
    setAutoScrollEnabled(true);
    setShowScrollButton(false);
  }

  // ------------------------------------------------------------
  // INITIAL LOAD: projects + conversations
  // ------------------------------------------------------------
  useEffect(() => {
    (async () => {
      const { data: projData } = await supabase
        .from("projects")
        .select("id, name, created_at")
        .eq("user_id", TEST_USER_ID);

      const { data: convData } = await supabase
        .from("conversations")
        .select("id, title, project_id, created_at")
        .eq("user_id", TEST_USER_ID);

      setProjects((projData || []) as Project[]);
      setConversations((convData || []) as ConversationMeta[]);

      if (convData && convData.length > 0) {
        const newest = [...convData].sort((a, b) =>
          (b.created_at || "").localeCompare(a.created_at || "")
        )[0];

        setSelectedConversationId(newest.id);
        setSelectedProjectId(newest.project_id);
        setViewMode("chat");
      }
    })();
  }, []);

  // ------------------------------------------------------------
  // LOAD MESSAGES
  // ------------------------------------------------------------
  const loadMessages = useCallback(
    async (conversationId: string, opts: { silent?: boolean } = {}) => {
      if (!conversationId) return;
      if (!opts.silent) setIsLoadingMessages(true);

      const { data, error } = await supabase
        .from("messages")
        .select("id, role, content, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      if (selectedConversationId !== conversationId) {
        if (!opts.silent) setIsLoadingMessages(false);
        return;
      }

      if (skipAutoLoadRef.current === conversationId) {
        skipAutoLoadRef.current = null;
        if (!opts.silent) setIsLoadingMessages(false);
        return;
      }

      if (error) {
        console.error("Load messages error", error);
        setMessages([]);
      } else {
        setMessages(
          (data || []).map((m) => ({
            id: (m as { id?: string }).id,
            role: m.role,
            content: m.content,
          }))
        );
      }

      if (!opts.silent) setIsLoadingMessages(false);
    },
    [selectedConversationId]
  );

  useEffect(() => {
    if (!selectedConversationId) {
      setMessages([]);
      return;
    }

    loadMessages(selectedConversationId);
  }, [selectedConversationId, loadMessages]);

  // ------------------------------------------------------------
  // AUTOSCROLL WHEN MESSAGES CHANGE
  // ------------------------------------------------------------
  useEffect(() => {
    if (!autoScrollEnabled) return;
    scrollToBottom({ behavior: isStreaming ? "smooth" : "auto" });
  }, [messages, autoScrollEnabled, isStreaming]);

  useEffect(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    const handleScroll = () => {
      const distanceFromBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight;
      const nearBottom = distanceFromBottom < 120;
      setAutoScrollEnabled(nearBottom);
      setShowScrollButton(!nearBottom);
    };
    handleScroll();
    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxHeight = 168;
    const nextHeight = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [input]);

  useEffect(() => {
    const handleWindowClick = () => setOpenModelMenuId(null);
    window.addEventListener("click", handleWindowClick);
    return () => window.removeEventListener("click", handleWindowClick);
  }, []);

  // ------------------------------------------------------------
  // MEMOIZED SORTED LISTS
  // ------------------------------------------------------------
  const sortedConversations = useMemo(
    () =>
      [...conversations].sort((a, b) =>
        (b.created_at || "").localeCompare(a.created_at || "")
      ),
    [conversations]
  );

  const sortedProjects = useMemo(
    () =>
      [...projects].sort((a, b) => {
        const lastA =
          latestConvTimeForProject(a.id, conversations) || a.created_at || "";
        const lastB =
          latestConvTimeForProject(b.id, conversations) || b.created_at || "";
        return lastB.localeCompare(lastA);
      }),
    [projects, conversations]
  );

  const currentConversation = conversations.find(
    (c) => c.id === selectedConversationId
  );
  const currentProject = projects.find((p) => p.id === selectedProjectId);

  const projectChats = useMemo(
    () =>
      selectedProjectId
        ? sortedConversations.filter((c) => c.project_id === selectedProjectId)
        : [],
    [sortedConversations, selectedProjectId]
  );

  const inProjectView = viewMode === "project" && !!selectedProjectId;
  const canSendMessage = input.trim().length > 0;

  // ------------------------------------------------------------
  // HELPERS
  // ------------------------------------------------------------
  const handleConversationSelect = (id: string) => {
    const convo = conversations.find((c) => c.id === id);
    setSelectedConversationId(id);
    setSelectedProjectId(convo?.project_id ?? null);
    setViewMode("chat");
    setSidebarOpen(false);
  };

  const handleProjectSelect = (id: string) => {
    setSelectedProjectId(id);
    setViewMode("project");
    setSidebarOpen(false);
  };

  const refreshConversations = useCallback(async () => {
    const { data } = await supabase
      .from("conversations")
      .select("id, title, project_id, created_at")
      .eq("user_id", TEST_USER_ID);

    if (Array.isArray(data)) {
      setConversations(data as ConversationMeta[]);
    }
  }, []);

  // ------------------------------------------------------------
  // CREATE CONVERSATION
  // ------------------------------------------------------------
  async function createConversation(
    initialTitle: string,
    projectId: string | null
  ) {
    const { data, error } = await supabase
      .from("conversations")
      .insert({
        user_id: TEST_USER_ID,
        title: initialTitle,
        project_id: projectId,
      })
      .select("id, title, project_id, created_at")
      .single();

    if (error || !data) throw error || new Error("Conversation not created");

    setConversations((prev) => [data, ...prev]);
    return data;
  }

  type SendMessageOptions = {
    messageOverride?: string;
    modelOverride?: ModelMode;
  };

  // ------------------------------------------------------------
  // SEND MESSAGE — STREAMING
  // ------------------------------------------------------------
  async function sendMessage(options?: SendMessageOptions) {
    const sourceText = options?.messageOverride ?? input;
    if (!sourceText.trim() || isStreaming) return;

    let conversationId = selectedConversationId;
    let assistantMessageId: string | null = null;
    const text = sourceText.trim();
    const chosenMode = options?.modelOverride ?? modelMode;
    if (!options?.messageOverride) {
      setInput("");
    }
    setIsStreaming(true);

    try {
      if (!conversationId) {
        const conv = await createConversation("New chat", selectedProjectId);
        conversationId = conv.id;
        setSelectedConversationId(conv.id);
        setSelectedProjectId(conv.project_id ?? selectedProjectId ?? null);
        setViewMode("chat");
        skipAutoLoadRef.current = conv.id;
      }

      const userMessageId = createLocalId();
      const assistantId = createLocalId();
      assistantMessageId = assistantId;
      setActiveAssistantMessageId(assistantId);

      // user msg + empty assistant bubble for streaming
      setMessages((prev) => [
        ...prev,
        { id: userMessageId, role: "user", content: text },
        { id: assistantId, role: "assistant", content: "" },
      ]);

      const shouldForceWebSearch = forceWebSearch;
      setForceWebSearch(false);

      abortControllerRef.current?.abort();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          conversationId,
          modelMode: chosenMode,
          forceWebSearch: shouldForceWebSearch,
        }),
        signal: abortController.signal,
      });

      if (!res.ok || !res.body) throw new Error("Stream failed");

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
                const payload = JSON.parse(line);
                if (payload.meta) {
                  const meta = payload.meta as {
                    usedModel?: string;
                    usedModelMode?: ModelMode;
                    usedWebSearch?: boolean;
                    searchRecords?: SearchRecord[];
                  };
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMessageId
                        ? {
                            ...msg,
                            usedModel: meta.usedModel,
                            usedModelMode: meta.usedModelMode,
                            usedWebSearch: meta.usedWebSearch,
                            searchRecords: meta.searchRecords || [],
                          }
                        : msg
                    )
                  );
                } else if (typeof payload.token === "string") {
                  const token = payload.token as string;
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMessageId
                        ? { ...msg, content: msg.content + token }
                        : msg
                    )
                  );
                } else if (payload.done) {
                  finished = true;
                }
              } catch (err) {
                console.warn("Failed to parse stream chunk", err);
              }
            }
            newlineIndex = buffer.indexOf("\n");
          }
        }

        if (done) {
          finished = true;
        }
      }

      // bump last activity timestamp
      if (conversationId) {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === conversationId
              ? { ...c, created_at: new Date().toISOString() }
              : c
          )
        );
      }

      refreshConversations();
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        console.warn("Chat request aborted");
      } else {
        console.error(error);
        if (assistantMessageId) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId
                ? { ...msg, content: "Error contacting GPT. Try again." }
                : msg
            )
          );
        }
      }
    } finally {
      abortControllerRef.current = null;
      setIsStreaming(false);
      setActiveAssistantMessageId((current) =>
        assistantMessageId && current === assistantMessageId ? null : current
      );
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  async function handleRetryWithModel(targetMode: ModelMode) {
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    setModelMode(targetMode);
    setOpenModelMenuId(null);
    await sendMessage({
      messageOverride: lastUser.content,
      modelOverride: targetMode,
    });
  }

  function handleStopGeneration() {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
  }

  async function handleCopyMessage(message: ChatMessage, fallbackId?: string) {
    if (!message.content) return;
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.id ?? fallbackId ?? null);
      setTimeout(() => setCopiedMessageId(null), 1500);
    } catch (err) {
      console.error("Copy failed", err);
    }
  }

  // ------------------------------------------------------------
  // PROJECTS + CHAT MGMT
  // ------------------------------------------------------------
  async function handleNewChat(global = false) {
    const projectId = global ? null : selectedProjectId;
    try {
      const conv = await createConversation("New chat", projectId);
      setSelectedConversationId(conv.id);
      setSelectedProjectId(conv.project_id ?? projectId ?? null);
      setMessages([]);
      setViewMode("chat");
      setSidebarOpen(false);
    } catch {
      // noop
    }
  }

  async function handleCreateProject() {
    const name = newProjectName.trim();
    if (!name) return;

    const { data, error } = await supabase
      .from("projects")
      .insert({ user_id: TEST_USER_ID, name })
      .select("id, name, created_at")
      .single();

    if (!error && data) {
      setProjects((prev) => [data, ...prev]);
      setSelectedProjectId(data.id);
      setViewMode("project");
      setShowProjectModal(false);
      setNewProjectName("");
    }
  }

  async function renameConversation(id: string) {
    const oldTitle =
      conversations.find((c) => c.id === id)?.title || "Untitled chat";

    const nextTitle = window.prompt("Rename chat:", oldTitle);
    if (!nextTitle || !nextTitle.trim()) return;

    await supabase
      .from("conversations")
      .update({ title: nextTitle.trim() })
      .eq("id", id);

    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title: nextTitle.trim() } : c))
    );
  }

  async function deleteConversation(id: string) {
    if (!window.confirm("Delete this chat?")) return;

    await supabase.from("messages").delete().eq("conversation_id", id);
    await supabase.from("conversations").delete().eq("id", id);

    setConversations((prev) => {
      const filtered = prev.filter((c) => c.id !== id);
      if (selectedConversationId === id) {
        const fallback = getNewestConversation(filtered);
        if (fallback) {
          setSelectedConversationId(fallback.id);
          setSelectedProjectId(fallback.project_id);
          setViewMode("chat");
        } else {
          setSelectedConversationId(null);
          setMessages([]);
        }
      }
      return filtered;
    });
  }

  async function moveConversation(id: string, newProjectId: string | null) {
    await supabase
      .from("conversations")
      .update({ project_id: newProjectId })
      .eq("id", id);

    setConversations((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, project_id: newProjectId } : c
      )
    );

    if (selectedConversationId === id) {
      setSelectedProjectId(newProjectId);
    }
  }

  // ------------------------------------------------------------
  // SIDEBAR CONTENT (shared between desktop + mobile)
  // ------------------------------------------------------------
  const SidebarSections = () => (
    <>
      <div className="px-3 py-3">
        <button
          onClick={() => handleNewChat(true)}
          className="flex w-full items-center gap-2 rounded-md bg-[#202123] px-3 py-2 text-sm text-zinc-100 hover:bg-[#26272b]"
        >
          <span className="text-lg leading-none">＋</span>
          <span>New chat</span>
        </button>
      </div>

      {/* Projects */}
      <div className="mt-1 flex items-center justify-between px-3 text-[11px] font-semibold uppercase text-zinc-500">
        <span>Projects</span>
        <button
          onClick={() => setShowProjectModal(true)}
          className="text-xs text-zinc-400 hover:text-zinc-200"
        >
          + New
        </button>
      </div>

      <div className="mt-1 flex flex-col gap-1 px-2">
        {sortedProjects.length === 0 && (
          <div className="px-1 py-2 text-[11px] text-zinc-500">No projects yet.</div>
        )}

        {sortedProjects.map((p) => (
          <button
            key={p.id}
            className={`w-full rounded-md px-3 py-2 text-left text-sm ${
              selectedProjectId === p.id && viewMode === "project"
                ? "bg-[#202123] text-zinc-100"
                : "text-zinc-300 hover:bg-[#202123]"
            }`}
            onClick={() => handleProjectSelect(p.id)}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* All chats */}
      <div className="mt-4 px-3 text-[11px] font-semibold uppercase text-zinc-500">
        All chats
      </div>

      <div className="mt-1 flex-1 space-y-1 overflow-y-auto px-2 pb-4">
        {sortedConversations.length === 0 && (
          <div className="px-1 py-2 text-[11px] text-zinc-500">No chats yet.</div>
        )}

        {sortedConversations.map((c) => {
          const isActive = selectedConversationId === c.id && viewMode === "chat";
          return (
            <div
              key={c.id}
              className={`group flex items-center rounded-md px-2 text-sm ${
                isActive
                  ? "bg-[#202123] text-zinc-100"
                  : "text-zinc-300 hover:bg-[#202123]"
              }`}
            >
              <button
                className="flex-1 truncate px-1 py-2 text-left"
                onClick={() => handleConversationSelect(c.id)}
              >
                {c.title || "Untitled chat"}
              </button>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  deleteConversation(c.id);
                }}
                aria-label="Delete chat"
                className="ml-1 rounded-md p-1 text-xs text-zinc-500 transition hover:text-red-400"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      <div className="border-t border-[#202123] px-3 py-3 text-xs text-zinc-500">
        LLM Client · dev build
      </div>
    </>
  );

  // ------------------------------------------------------------
  // RENDER
  // ------------------------------------------------------------
  return (
    <div className="flex h-screen min-h-0 bg-[#212121] text-zinc-100">
      {/* Desktop Sidebar */}
      <aside className="hidden w-64 min-h-0 flex-col border-r border-[#202123] bg-[#181818] md:flex">
        <SidebarSections />
      </aside>

      {/* Mobile sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="flex w-64 flex-col border-r border-[#202123] bg-[#181818]">
            <div className="flex items-center justify-between border-b border-[#202123] px-3 py-3">
              <span className="text-sm font-semibold">Menu</span>
              <button
                onClick={() => setSidebarOpen(false)}
                className="text-sm text-zinc-400 hover:text-zinc-200"
              >
                Close
              </button>
            </div>
            <SidebarSections />
          </div>
          <button
            className="flex-1 bg-black/40"
            aria-label="Close sidebar"
            onClick={() => setSidebarOpen(false)}
          />
        </div>
      )}

      {/* Main Content */}
      <main className="flex flex-1 min-h-0 flex-col bg-[#212121]">
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between border-b border-[#202123] px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              className="rounded-md border border-[#2f2f32] px-2 py-1 text-sm text-zinc-300 hover:bg-[#2a2a2e] md:hidden"
              onClick={() => setSidebarOpen(true)}
            >
              ☰
            </button>
            <span className="text-sm font-semibold">LLM Client</span>

            {viewMode === "chat" && currentConversation && (
              <span className="hidden text-xs text-zinc-500 sm:inline">
                {currentConversation.title || "Untitled chat"}
              </span>
            )}

            {inProjectView && currentProject && (
              <span className="hidden text-xs text-zinc-500 sm:inline">
                Project · {currentProject.name}
              </span>
            )}
          </div>

          {/* Rename/Delete/Move in header */}
          {viewMode === "chat" && currentConversation && (
            <div className="flex items-center gap-2 text-[11px] text-zinc-400">
              <select
                value={currentConversation.project_id || ""}
                onChange={(e) =>
                  moveConversation(
                    currentConversation.id,
                    e.target.value === "" ? null : e.target.value
                  )
                }
                className="rounded-md border border-[#3f3f46] bg-transparent px-2 py-1 text-[11px] text-zinc-300"
              >
                <option value="">No project</option>
                {sortedProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => renameConversation(currentConversation.id)}
                className="hover:text-zinc-200"
              >
                Rename
              </button>
              <span>·</span>
              <button
                onClick={() => deleteConversation(currentConversation.id)}
                className="hover:text-red-400"
              >
                Delete
              </button>
            </div>
          )}
        </header>

        {/* PROJECT VIEW */}
        {inProjectView && currentProject ? (
          <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-6">
            <div className="mx-auto max-w-3xl">
              <h1 className="mb-4 text-lg font-semibold">
                {currentProject.name}
              </h1>

              <button
                onClick={() => handleNewChat(false)}
                className="mb-6 w-full rounded-2xl bg-[#181818] px-4 py-3 text-sm text-zinc-300 hover:bg-[#202123]"
              >
                ＋ New chat in {currentProject.name}
              </button>

              {projectChats.length === 0 && (
                <div className="text-sm text-zinc-500">
                  No chats in this project yet.
                </div>
              )}

              <div className="space-y-2">
                {projectChats.map((c) => (
                  <div
                    key={c.id}
                    className="space-y-2 rounded-xl bg-[#181818] px-4 py-3 text-sm hover:bg-[#202123]"
                  >
                    <div className="flex items-center gap-2">
                      <button
                        className="flex-1 text-left"
                        onClick={() => {
                          handleConversationSelect(c.id);
                          setSidebarOpen(false);
                        }}
                      >
                        <div className="font-medium text-zinc-100">
                          {c.title || "Untitled chat"}
                        </div>
                      </button>

                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          deleteConversation(c.id);
                        }}
                        aria-label="Delete chat"
                        className="rounded-md p-1 text-xs text-zinc-500 transition hover:text-red-400"
                      >
                        ×
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                      <button
                        onClick={() => renameConversation(c.id)}
                        className="hover:text-zinc-200"
                      >
                        Rename
                      </button>

                      <span>·</span>

                      <select
                        className="rounded-md border border-[#3f3f46] bg-transparent px-1 py-0.5"
                        value={c.project_id || ""}
                        onChange={(e) =>
                          moveConversation(
                            c.id,
                            e.target.value === "" ? null : e.target.value
                          )
                        }
                      >
                        <option value="">No project</option>
                        {sortedProjects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>

                      <span>·</span>

                      <button
                        onClick={() => deleteConversation(c.id)}
                        className="hover:text-red-400"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="h-10" />
            </div>
          </div>
        ) : (
          /* CHAT VIEW */
          <>
            {/* Messages */}
            <div className="relative flex-1 min-h-0">
              <div
                ref={chatContainerRef}
                className="flex h-full flex-col overflow-y-auto overflow-x-hidden px-4 py-6 pb-32"
              >
                <div className="mx-auto flex max-w-2xl flex-col space-y-4 pb-6">
                  {isLoadingMessages && (
                    <div className="mb-2 text-center text-xs text-zinc-500">
                      Loading messages...
                    </div>
                  )}

                  {!isLoadingMessages && messages.length === 0 && (
                    <div className="mt-10 text-center text-sm text-zinc-400">
                      Start chatting — GPT-5.1 chat is streaming live.
                    </div>
                  )}

                  {messages.map((m, i) => {
                    const messageId = m.id ?? `msg-${i}`;
                    const isAssistant = m.role === "assistant";
                    const hasSources = Boolean(
                      isAssistant &&
                        m.usedWebSearch &&
                        (m.searchRecords?.length || 0) > 0
                    );
                    const isStreamingAssistantMessage =
                      isAssistant &&
                      activeAssistantMessageId === messageId;

                    return (
                      <div
                        key={messageId}
                        className={`flex ${
                          isAssistant ? "justify-start" : "justify-end"
                        }`}
                      >
                        <div
                          className={`relative max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed md:max-w-[70%] ${
                            isAssistant
                              ? "bg-[#202123] text-zinc-100"
                              : "bg-[#1e4fd8] text-white"
                          }`}
                        >
                          {isAssistant ? (
                            <>
                              <div className="space-y-3 text-[15px] leading-relaxed">
                                <div className="prose prose-invert max-w-none text-sm">
                                  <ReactMarkdown
                                    remarkPlugins={[remarkGfm, remarkBreaks]}
                                    rehypePlugins={[rehypeRaw]}
                                    components={markdownComponents}
                                  >
                                    {m.content}
                                  </ReactMarkdown>
                                </div>
                              </div>

                              {!isStreamingAssistantMessage && (
                                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                                  <button
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleCopyMessage(m, messageId);
                                    }}
                                    className="rounded-full border border-[#3a3a3f] px-3 py-1 text-xs text-zinc-300 hover:border-[#5c5cf5]"
                                  >
                                    {copiedMessageId === messageId ? "Copied" : "Copy"}
                                  </button>

                                  {hasSources && (
                                    <>
                                      <span
                                        className="h-4 w-px bg-[#38383d]"
                                        aria-hidden
                                      />
                                      <button
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setExpandedSourcesId((prev) =>
                                            prev === messageId ? null : messageId
                                          );
                                        }}
                                        className="rounded-full border border-[#35353a] px-3 py-1 text-xs text-zinc-300 hover:border-[#5c5cf5]"
                                        aria-expanded={expandedSourcesId === messageId}
                                      >
                                        {expandedSourcesId === messageId
                                          ? "Hide sources"
                                          : "Sources"}
                                      </button>
                                    </>
                                  )}

                                  {m.usedModel && (
                                    <>
                                      <span
                                        className="h-4 w-px bg-[#38383d]"
                                        aria-hidden
                                      />
                                      <div className="relative">
                                        <button
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setOpenModelMenuId((prev) =>
                                              prev === messageId ? null : messageId
                                            );
                                          }}
                                          className="rounded-full border border-[#3a3a40] px-3 py-1 text-[11px] text-zinc-200 hover:border-[#5c5cf5]"
                                        >
                                          {m.usedModel}
                                        </button>

                                        {openModelMenuId === messageId && (
                                          <div className="absolute right-0 z-20 mt-2 w-60 rounded-2xl border border-[#2d2d33] bg-[#101014] p-2 text-left text-xs shadow-2xl">
                                            {(Object.entries(
                                              MODEL_NAME_MAP
                                            ) as [Exclude<ModelMode, "auto">, string][]).map(
                                              ([mode, name]) => (
                                                <button
                                                  key={mode}
                                                  onClick={(event) => {
                                                    event.stopPropagation();
                                                    handleRetryWithModel(mode);
                                                  }}
                                                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[12px] text-zinc-200 hover:bg-[#1b1b21]"
                                                >
                                                  <span>Retry with {name}</span>
                                                  {m.usedModelMode === mode && (
                                                    <span className="text-[10px] text-zinc-500">
                                                      current
                                                    </span>
                                                  )}
                                                </button>
                                              )
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    </>
                                  )}
                                </div>
                              )}

                              {hasSources &&
                                expandedSourcesId === messageId &&
                                !isStreamingAssistantMessage && (
                                <div className="mt-3 space-y-3 rounded-2xl border border-[#2f2f36] bg-[#141417] p-3 text-[13px] text-zinc-200">
                                  {m.searchRecords?.map((record, idx) => (
                                    <div key={`${record.query}-${idx}`} className="space-y-2">
                                      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                                        {record.query}
                                      </div>
                                      {record.results.length === 0 ? (
                                        <p className="text-[12px] text-zinc-400">
                                          {record.summary}
                                        </p>
                                      ) : (
                                        <div className="space-y-2">
                                          {record.results.map((result, sourceIdx) => (
                                            <div
                                              key={`${result.link}-${sourceIdx}`}
                                              className="rounded-xl bg-[#1b1b20] p-2"
                                            >
                                              <div className="text-[13px] font-semibold text-zinc-100">
                                                {result.title}
                                              </div>
                                              <div className="text-[11px] text-zinc-500">
                                                {result.displayLink}
                                              </div>
                                              <p className="mt-1 text-[12px] text-zinc-300">
                                                {result.snippet}
                                              </p>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </>
                          ) : (
                            m.content
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {showScrollButton && (
                <button
                  onClick={handleJumpToBottom}
                  className="pointer-events-auto absolute bottom-24 left-1/2 z-20 -translate-x-1/2 rounded-full border border-white/10 bg-[#15151a]/90 px-4 py-2 text-sm text-white shadow-xl transition hover:bg-[#1f1f25]"
                  aria-label="Jump to latest message"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
              )}
            </div>

            {/* Input */}
            <div className="shrink-0 border-t border-[#202123] bg-[#212121] px-4 py-3">
              <div className="mx-auto flex max-w-2xl flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-[#35353a] bg-[#1a1b1f] p-1">
                    {MODEL_SEGMENTS.map((segment) => {
                      const isActive = modelMode === segment.value;
                      return (
                        <button
                          key={segment.value}
                          className={`rounded-xl px-3 py-1 text-left text-[11px] font-medium transition ${
                            isActive
                              ? "bg-[#1e4fd8] text-white shadow-inner"
                              : "text-zinc-400 hover:text-zinc-200"
                          }`}
                          onClick={() => setModelMode(segment.value)}
                          aria-pressed={isActive}
                        >
                          <div>{segment.label}</div>
                          <div className="text-[10px] font-normal text-zinc-300/70">
                            {segment.hint}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <button
                    onClick={() => setForceWebSearch((prev) => !prev)}
                    aria-pressed={forceWebSearch}
                    className={`flex items-center gap-1 rounded-2xl border px-3 py-1 text-[11px] font-medium transition ${
                      forceWebSearch
                        ? "border-[#1e4fd8] bg-[#1e4fd8]/20 text-[#8ab4ff]"
                        : "border-[#3f3f46] text-zinc-400 hover:text-zinc-200"
                    }`}
                    title="Force a web search before answering"
                  >
                    <span className="text-base leading-none">🌐</span> Web search
                  </button>
                </div>

                <div className="flex items-center">
                  <div className="flex w-full items-center gap-2 rounded-full border border-[#3f3f46] bg-[#2c2c31] px-2 py-2 text-sm shadow-[0_0_0_1px_rgba(0,0,0,0.45)]">
                    <button
                      type="button"
                      aria-label="Insert content"
                      onClick={() => textareaRef.current?.focus()}
                      className="flex h-11 w-11 items-center justify-center rounded-full bg-[#3a3a40] text-white/80 transition hover:bg-[#4b4b52]"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        className="h-5 w-5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                      >
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    </button>

                    <div className="flex-1 px-1">
                      <textarea
                        ref={textareaRef}
                        className="max-h-40 min-h-[48px] w-full resize-none border-none bg-transparent px-0 text-[15px] leading-6 text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-0"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Message the assistant…"
                        rows={1}
                      />
                    </div>

                    <button
                      type="button"
                      aria-label="Voice input (coming soon)"
                      onClick={() => textareaRef.current?.focus()}
                      className="flex h-11 w-11 items-center justify-center rounded-full text-white/70 transition hover:text-white"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        className="h-5 w-5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.8}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 4a2.5 2.5 0 0 0-2.5 2.5v5A2.5 2.5 0 0 0 12 14.5a2.5 2.5 0 0 0 2.5-2.5v-5A2.5 2.5 0 0 0 12 4Z" />
                        <path d="M19 11.5a7 7 0 0 1-14 0" />
                        <path d="M12 18.5v2" />
                      </svg>
                    </button>

                    <button
                      type="button"
                      onClick={
                        isStreaming ? handleStopGeneration : () => sendMessage()
                      }
                      disabled={!isStreaming && !canSendMessage}
                      className={`ml-1 flex h-12 w-12 items-center justify-center rounded-full bg-[#00a86b] text-white shadow-lg transition focus:outline-none ${
                        isStreaming
                          ? "hover:bg-[#00915c]"
                          : "hover:bg-[#00bf78] disabled:opacity-50"
                      }`}
                      aria-label={isStreaming ? "Stop response" : "Send message"}
                    >
                      {isStreaming ? (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          className="h-4 w-4"
                          fill="currentColor"
                        >
                          <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />
                        </svg>
                      ) : (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          className="h-4 w-4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M12 19V5" />
                          <path d="M6 11l6-6 6 6" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </main>

      {/* PROJECT MODAL */}
      {showProjectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl border border-[#3f3f46] bg-[#181818] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">New project</h2>
              <button
                onClick={() => setShowProjectModal(false)}
                className="text-lg text-zinc-400 hover:text-zinc-200"
              >
                ×
              </button>
            </div>

            <input
              className="w-full rounded-md border border-[#3f3f46] bg-[#303030] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Project name"
            />

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowProjectModal(false)}
                className="rounded-md px-3 py-1.5 text-xs text-zinc-300 hover:bg-[#26272b]"
              >
                Cancel
              </button>

              <button
                onClick={handleCreateProject}
                disabled={!newProjectName.trim()}
                className="rounded-md bg-[#1e4fd8] px-3 py-1.5 text-xs text-white hover:bg-[#2658e4] disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
