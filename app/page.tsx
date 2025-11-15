"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { supabase } from "../lib/supabaseClient";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
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
  { value: "mini", label: "Balanced", hint: "Mini" },
  { value: "full", label: "Max", hint: "Full" },
];

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

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mt-4 mb-2 text-xl font-semibold text-zinc-100">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-4 mb-2 text-lg font-semibold text-zinc-100">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-3 mb-2 text-base font-semibold text-zinc-100">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="my-2 leading-relaxed text-zinc-100">{children}</p>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-[#8ab4ff] underline decoration-[#8ab4ff]/60"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="my-3 list-disc space-y-1 pl-6 text-zinc-200">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-3 list-decimal space-y-1 pl-6 text-zinc-200">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  code({ inline, children }: { inline?: boolean; children?: ReactNode }) {
    if (inline) {
      return (
        <code className="rounded-md bg-[#2d2d30] px-1.5 py-0.5 text-[13px] text-zinc-100">
          {children}
        </code>
      );
    }
    return (
      <pre className="mt-3 overflow-x-auto rounded-xl border border-[#2e2e32] bg-[#151515] p-4 text-[13px] leading-relaxed text-zinc-100">
        <code>{children}</code>
      </pre>
    );
  },
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-4 border-[#3b3b3f] pl-4 text-zinc-300">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-xl border border-[#2e2e32]">
      <table className="w-full border-collapse text-left text-sm text-zinc-200">
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-[#2e2e32] bg-[#1f1f23] px-3 py-2 text-sm font-medium text-zinc-100">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-[#2e2e32] px-3 py-2 text-sm text-zinc-200">{children}</td>
  ),
};

export default function Home() {
  // ------------------------------------------------------------
  // STATE
  // ------------------------------------------------------------

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
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

  // autoscroll anchor
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const skipAutoLoadRef = useRef<string | null>(null);

  function scrollToBottom() {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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
        .select("role, content, created_at")
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
    scrollToBottom();
  }, [messages]);

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

  // ------------------------------------------------------------
  // SEND MESSAGE — STREAMING
  // ------------------------------------------------------------
  async function sendMessage() {
    if (!input.trim() || isSending) return;

    let conversationId = selectedConversationId;
    const text = input.trim();
    setInput("");
    setIsSending(true);

    try {
      if (!conversationId) {
        const conv = await createConversation("New chat", selectedProjectId);
        conversationId = conv.id;
        setSelectedConversationId(conv.id);
        setSelectedProjectId(conv.project_id ?? selectedProjectId ?? null);
        setViewMode("chat");
        skipAutoLoadRef.current = conv.id;
      }

      // user msg + empty assistant bubble for streaming
      setMessages((prev) => [
        ...prev,
        { role: "user", content: text },
        { role: "assistant", content: "" },
      ]);

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          conversationId,
          modelMode,
          forceWebSearch,
        }),
      });

      if (!res.ok || !res.body) throw new Error("Stream failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          const chunk = decoder.decode(value, { stream: !doneReading });
          if (chunk) {
            setMessages((prev) => {
              const updated = [...prev];
              const idx = updated.length - 1;
              if (idx >= 0 && updated[idx].role === "assistant") {
                updated[idx] = {
                  ...updated[idx],
                  content: updated[idx].content + chunk,
                };
              }
              return updated;
            });
          }
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
        await loadMessages(conversationId, { silent: true });
      }
    } catch (error) {
      console.error(error);
      setMessages((prev) => {
        const updated = [...prev];
        const idx = updated.length - 1;
        if (
          idx >= 0 &&
          updated[idx].role === "assistant" &&
          updated[idx].content === ""
        ) {
          updated[idx].content = "Error contacting GPT. Try again.";
          return updated;
        }
        return [
          ...prev,
          { role: "assistant", content: "Error contacting GPT. Try again." },
        ];
      });
    } finally {
      setIsSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
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
    <div className="flex h-screen min-h-0 overflow-hidden bg-[#212121] text-zinc-100">
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
      <main className="flex flex-1 min-h-0 flex-col overflow-hidden bg-[#212121]">
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
            <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-6">
              <div className="mx-auto flex max-w-2xl flex-col space-y-4">
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

                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={`flex ${
                      m.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed md:max-w-[70%] ${
                        m.role === "user"
                          ? "bg-[#1e4fd8] text-white"
                          : "bg-[#202123] text-zinc-100"
                      }`}
                    >
                      {m.role === "assistant" ? (
                        <div className="space-y-3 text-[15px] leading-relaxed">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm, remarkBreaks]}
                            components={markdownComponents}
                          >
                            {m.content}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        m.content
                      )}
                    </div>
                  </div>
                ))}

                {/* Auto-scroll anchor */}
                <div ref={messagesEndRef} />
              </div>
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

                <div className="flex items-center gap-2">
                  <input
                    className="flex-1 rounded-2xl border border-[#3f3f46] bg-[#303030] px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-[#1e4fd8]"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type a message…"
                  />

                  <button
                    onClick={sendMessage}
                    disabled={isSending || !input.trim()}
                    className="rounded-2xl bg-[#1e4fd8] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#2658e4] disabled:opacity-50"
                  >
                    Send
                  </button>
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
