"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
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

const TEST_USER_ID = "test-user-1";

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

export default function Home() {
  // ------------------------------------------------------------
  // STATE
  // ------------------------------------------------------------

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);

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

  // autoscroll anchor
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

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
  useEffect(() => {
    if (!selectedConversationId) {
      setMessages([]);
      return;
    }

    (async () => {
      setIsLoadingMessages(true);
      const { data, error } = await supabase
        .from("messages")
        .select("role, content, created_at")
        .eq("conversation_id", selectedConversationId)
        .order("created_at", { ascending: true });

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
      setIsLoadingMessages(false);
    })();
  }, [selectedConversationId]);

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

  const inProjectView = viewMode === "project" && selectedProjectId;

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

    // history snapshot BEFORE adding new user message
    const historySnapshot = messages;

    try {
      if (!conversationId) {
        const conv = await createConversation("New chat", selectedProjectId);
        conversationId = conv.id;
        setSelectedConversationId(conv.id);
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
          history: historySnapshot,
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
          const chunk = decoder.decode(value, { stream: true });
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
      setMessages([]);
      setViewMode("chat");
      if (!global) setSelectedProjectId(projectId);
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

    setConversations((prev) => prev.filter((c) => c.id !== id));

    if (selectedConversationId === id) {
      setSelectedConversationId(null);
      setMessages([]);
    }
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
  }

  // ------------------------------------------------------------
  // RENDER
  // ------------------------------------------------------------
  return (
    <div className="flex h-screen bg-[#212121] text-zinc-100">
      {/* Sidebar */}
      <aside className="hidden md:flex w-64 flex-col border-r border-[#202123] bg-[#181818]">
        <div className="px-3 py-3">
          <button
            onClick={() => handleNewChat(true)}
            className="flex items-center gap-2 w-full rounded-md bg-[#202123] hover:bg-[#26272b] px-3 py-2 text-sm text-zinc-100"
          >
            <span className="text-lg leading-none">＋</span>
            <span>New chat</span>
          </button>
        </div>

        {/* Projects */}
        <div className="px-3 mt-1 flex items-center justify-between text-[11px] font-semibold text-zinc-500 uppercase">
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
            <div className="text-[11px] text-zinc-500 px-1 py-2">
              No projects yet.
            </div>
          )}

          {sortedProjects.map((p) => (
            <button
              key={p.id}
              className={`w-full text-left rounded-md px-3 py-2 text-sm ${
                selectedProjectId === p.id && viewMode === "project"
                  ? "bg-[#202123] text-zinc-100"
                  : "text-zinc-300 hover:bg-[#202123]"
              }`}
              onClick={() => {
                setSelectedProjectId(p.id);
                setViewMode("project");
              }}
            >
              {p.name}
            </button>
          ))}
        </div>

        {/* All chats */}
        <div className="px-3 mt-4 text-[11px] font-semibold text-zinc-500 uppercase">
          All chats
        </div>

        <div className="mt-1 flex-1 overflow-y-auto px-2 pb-4 space-y-1">
          {sortedConversations.length === 0 && (
            <div className="text-[11px] text-zinc-500 px-1 py-2">
              No chats yet.
            </div>
          )}

          {sortedConversations.map((c) => (
            <button
              key={c.id}
              className={`w-full text-left rounded-md px-3 py-2 text-sm ${
                selectedConversationId === c.id && viewMode === "chat"
                  ? "bg-[#202123] text-zinc-100"
                  : "text-zinc-300 hover:bg-[#202123]"
              }`}
              onClick={() => {
                setSelectedConversationId(c.id);
                setViewMode("chat");
              }}
            >
              {c.title || "Untitled chat"}
            </button>
          ))}
        </div>

        <div className="px-3 py-3 border-t border-[#202123] text-xs text-zinc-500">
          LLM Client · dev build
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col bg-[#212121]">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-[#202123]">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">LLM Client</span>

            {viewMode === "chat" && currentConversation && (
              <span className="hidden sm:inline text-xs text-zinc-500">
                {currentConversation.title || "Untitled chat"}
              </span>
            )}

            {inProjectView && currentProject && (
              <span className="hidden sm:inline text-xs text-zinc-500">
                Project · {currentProject.name}
              </span>
            )}
          </div>

          {/* Rename/Delete in header */}
          {viewMode === "chat" && currentConversation && (
            <div className="hidden sm:flex items-center gap-2 text-[11px] text-zinc-400">
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
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <div className="max-w-3xl mx-auto">
              <h1 className="text-lg font-semibold mb-4">
                {currentProject.name}
              </h1>

              <button
                onClick={() => handleNewChat(false)}
                className="w-full rounded-2xl bg-[#181818] px-4 py-3 text-sm text-zinc-300 hover:bg-[#202123] mb-6"
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
                    className="flex items-center justify-between rounded-xl bg-[#181818] px-4 py-3 text-sm hover:bg-[#202123]"
                  >
                    <button
                      className="flex-1 text-left"
                      onClick={() => {
                        setSelectedConversationId(c.id);
                        setViewMode("chat");
                      }}
                    >
                      <div className="font-medium text-zinc-100">
                        {c.title || "Untitled chat"}
                      </div>
                    </button>

                    <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                      <button
                        onClick={() => renameConversation(c.id)}
                        className="hover:text-zinc-200"
                      >
                        Rename
                      </button>

                      <span>·</span>

                      <select
                        className="bg-transparent border border-[#3f3f46] rounded-md px-1 py-0.5"
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
            <div className="flex-1 overflow-y-auto px-4 py-6">
              <div className="max-w-2xl mx-auto flex flex-col space-y-3">
                {isLoadingMessages && (
                  <div className="text-xs text-zinc-500 text-center mb-2">
                    Loading messages...
                  </div>
                )}

                {!isLoadingMessages && messages.length === 0 && (
                  <div className="text-sm text-zinc-400 text-center mt-10">
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
                      className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${
                        m.role === "user"
                          ? "bg-[#1e4fd8] text-white"
                          : "bg-[#202123] text-zinc-100"
                      }`}
                    >
                      {m.role === "assistant" ? (
                        <div className="markdown-body">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm, remarkBreaks]}
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
            <div className="border-t border-[#202123] bg-[#212121] px-4 py-3">
              <div className="max-w-2xl mx-auto flex items-center gap-2">
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
                  className="rounded-2xl bg-[#1e4fd8] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50 hover:bg-[#2658e4]"
                >
                  Send
                </button>
              </div>
            </div>
          </>
        )}
      </main>

      {/* PROJECT MODAL */}
      {showProjectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="w-full max-w-md bg-[#181818] border border-[#3f3f46] rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">New project</h2>
              <button
                onClick={() => setShowProjectModal(false)}
                className="text-zinc-400 hover:text-zinc-200 text-lg"
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
                className="px-3 py-1.5 rounded-md text-xs text-zinc-300 hover:bg-[#26272b]"
              >
                Cancel
              </button>

              <button
                onClick={handleCreateProject}
                disabled={!newProjectName.trim()}
                className="px-3 py-1.5 rounded-md bg-[#1e4fd8] text-white text-xs disabled:opacity-50 hover:bg-[#2658e4]"
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
