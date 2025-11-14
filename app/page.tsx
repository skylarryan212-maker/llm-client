"use client";

import { useEffect, useMemo, useState } from "react";
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

function latestConvTimeForProject(
  projectId: string,
  convs: ConversationMeta[]
): string | null {
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

  // Load projects + conversations on mount
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
        const newest = [...(convData as ConversationMeta[])].sort((a, b) =>
          (b.created_at || "").localeCompare(a.created_at || "")
        )[0];
        setSelectedConversationId(newest.id);
        setSelectedProjectId(newest.project_id);
        setViewMode("chat");
      }
    })();
  }, []);

  // Load messages when conversation changes
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
          })) as ChatMessage[]
        );
      }
      setIsLoadingMessages(false);
    })();
  }, [selectedConversationId]);

  // Derived sorted lists
  const sortedConversations = useMemo(() => {
    return [...conversations].sort((a, b) =>
      (b.created_at || "").localeCompare(a.created_at || "")
    );
  }, [conversations]);

  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      const lastA =
        latestConvTimeForProject(a.id, conversations) || a.created_at || "";
      const lastB =
        latestConvTimeForProject(b.id, conversations) || b.created_at || "";
      return lastB.localeCompare(lastA);
    });
  }, [projects, conversations]);

  const currentConversation = useMemo(
    () => conversations.find((c) => c.id === selectedConversationId) || null,
    [conversations, selectedConversationId]
  );

  const currentProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

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

    if (error || !data) {
      console.error("Create conversation error", error);
      throw error || new Error("No conversation created");
    }

    setConversations((prev) => [data as ConversationMeta, ...prev]);
    return data as ConversationMeta;
  }

  async function sendMessage() {
    if (!input.trim() || isSending) return;

    let conversationId = selectedConversationId;
    const text = input.trim();
    setInput("");
    setIsSending(true);

    try {
      // Ensure there is a conversation
      if (!conversationId) {
        const conv = await createConversation("New chat", selectedProjectId);
        conversationId = conv.id;
        setSelectedConversationId(conv.id);
      }

      const userMessage: ChatMessage = { role: "user", content: text };
      setMessages((prev) => [...prev, userMessage]);

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, conversationId }),
      });

      const data = await res.json();

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: data.reply ?? "Test mode reply — no GPT yet.",
      };

      setMessages((prev) => [...prev, assistantMessage]);

      // bump conversation "activity" locally by updating created_at to now string
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? { ...c, created_at: new Date().toISOString() }
            : c
        )
      );
    } catch (err) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Error talking to backend (still in test mode).",
        },
      ]);
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

  async function handleNewChat(global = false) {
    try {
      const projectId = global ? null : selectedProjectId;
      const conv = await createConversation("New chat", projectId);
      setSelectedConversationId(conv.id);
      setViewMode("chat");
      setMessages([]);
      if (!global) {
        setSelectedProjectId(projectId);
      }
    } catch (e) {
      // already logged
    }
  }

  async function handleCreateProject() {
    const name = newProjectName.trim();
    if (!name) return;

    const { data, error } = await supabase
      .from("projects")
      .insert({
        user_id: TEST_USER_ID,
        name,
      })
      .select("id, name, created_at")
      .single();

    if (error || !data) {
      console.error("Create project error", error);
      return;
    }

    setProjects((prev) => [data as Project, ...prev]);
    setSelectedProjectId(data.id);
    setShowProjectModal(false);
    setNewProjectName("");
    setViewMode("project");
  }

  async function renameConversation(id: string) {
    const target =
      conversations.find((c) => c.id === id)?.title || "Untitled chat";
    const nextTitle =
      typeof window !== "undefined"
        ? window.prompt("Rename chat:", target)
        : null;
    if (!nextTitle || !nextTitle.trim()) return;

    const title = nextTitle.trim();

    const { error } = await supabase
      .from("conversations")
      .update({ title })
      .eq("id", id);

    if (error) {
      console.error("Rename conversation error", error);
      return;
    }

    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title } : c))
    );
  }

  async function deleteConversation(id: string) {
    if (
      typeof window !== "undefined" &&
      !window.confirm("Delete this chat and its messages?")
    ) {
      return;
    }

    await supabase.from("messages").delete().eq("conversation_id", id);
    await supabase.from("conversations").delete().eq("id", id);

    setConversations((prev) => prev.filter((c) => c.id !== id));

    if (selectedConversationId === id) {
      setSelectedConversationId(null);
      setMessages([]);
    }
  }

  async function moveConversation(id: string, newProjectId: string | null) {
    const { error } = await supabase
      .from("conversations")
      .update({ project_id: newProjectId })
      .eq("id", id);

    if (error) {
      console.error("Move conversation error", error);
      return;
    }

    setConversations((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, project_id: newProjectId } : c
      )
    );
  }

  const projectChats = useMemo(
    () =>
      selectedProjectId
        ? sortedConversations.filter((c) => c.project_id === selectedProjectId)
        : [],
    [sortedConversations, selectedProjectId]
  );

  const inProjectView = viewMode === "project" && selectedProjectId;

  return (
    <div className="flex h-screen bg-[#212121] text-zinc-100">
      {/* Sidebar */}
      <aside className="hidden md:flex w-64 flex-col border-r border-[#202123] bg-[#181818]">
        {/* Top new chat button (global) */}
        <div className="px-3 py-3">
          <button
            type="button"
            onClick={() => handleNewChat(true)}
            className="flex items-center gap-2 w-full rounded-md bg-[#202123] hover:bg-[#26272b] px-3 py-2 text-sm text-zinc-100"
          >
            <span className="text-lg leading-none">＋</span>
            <span>New chat</span>
          </button>
        </div>

        {/* Projects header */}
        <div className="px-3 mt-1 flex items-center justify-between text-[11px] font-semibold text-zinc-500 tracking-wide uppercase">
          <span>Projects</span>
          <button
            type="button"
            onClick={() => setShowProjectModal(true)}
            className="text-xs text-zinc-400 hover:text-zinc-200"
          >
            + New
          </button>
        </div>

        {/* Projects list */}
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

        {/* Chats section (always "All chats") */}
        <div className="px-3 mt-4 text-[11px] font-semibold text-zinc-500 tracking-wide uppercase">
          All chats
        </div>
        <div className="mt-1 flex-1 overflow-y-auto px-2 pb-4 space-y-1">
          {sortedConversations.length === 0 && (
            <div className="text-[11px] text-zinc-500 px-1 py-2">
              No chats yet. Click &ldquo;New chat&rdquo; to start.
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

      {/* Main area */}
      <main className="flex-1 flex flex-col bg-[#212121]">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-[#202123] bg-[#212121]">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-zinc-100">
              LLM Client
            </span>
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
          <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-[11px] font-medium text-amber-300">
            Test mode · no GPT calls
          </span>
        </header>

        {/* Main content: project view OR chat view */}
        {inProjectView && currentProject ? (
          // PROJECT VIEW
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <div className="max-w-3xl mx-auto">
              <h1 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <span className="text-zinc-100">{currentProject.name}</span>
              </h1>

              <div className="mb-6">
                <button
                  type="button"
                  onClick={() => handleNewChat(false)}
                  className="flex items-center justify-between w-full rounded-2xl bg-[#181818] px-4 py-3 text-sm text-zinc-300 hover:bg-[#202123]"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg leading-none">＋</span>
                    <span>New chat in {currentProject.name}</span>
                  </div>
                </button>
              </div>

              <div className="space-y-2">
                {projectChats.length === 0 && (
                  <div className="text-sm text-zinc-500">
                    No chats in this project yet.
                  </div>
                )}
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
                        type="button"
                        onClick={() => renameConversation(c.id)}
                        className="hover:text-zinc-200"
                      >
                        Rename
                      </button>
                      <span>·</span>
                      <div className="relative">
                        {/* Move options as simple dropdown-ish list */}
                        <select
                          className="bg-transparent text-[11px] border border-[#3f3f46] rounded-md px-1 py-0.5"
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
                      </div>
                      <span>·</span>
                      <button
                        type="button"
                        onClick={() => deleteConversation(c.id)}
                        className="hover:text-red-400"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          // CHAT VIEW
          <>
            <div className="flex-1 overflow-y-auto px-4 py-6">
              <div className="max-w-2xl mx-auto flex flex-col space-y-3">
                {isLoadingMessages && (
                  <div className="text-xs text-zinc-500 text-center mb-2">
                    Loading messages...
                  </div>
                )}

                {!isLoadingMessages && messages.length === 0 && (
                  <div className="text-sm text-zinc-400 text-center mt-10">
                    Start chatting with your future LLM client. Right now
                    everything runs in{" "}
                    <span className="font-semibold text-zinc-200">
                      test mode
                    </span>{" "}
                    with fake replies and Supabase logging.
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
                      {m.content}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Input */}
            <div className="border-t border-[#202123] bg-[#212121] px-4 py-3">
              <div className="max-w-2xl mx-auto">
                <div className="flex gap-2 items-center">
                  <input
                    className="flex-1 rounded-2xl border border-[#3f3f46] bg-[#303030] px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-[#1e4fd8]"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type a message..."
                  />
                  <button
                    onClick={sendMessage}
                    disabled={isSending || !input.trim()}
                    className="rounded-2xl bg-[#1e4fd8] px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#2658e4]"
                  >
                    Send
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-center text-zinc-500">
                  This build logs messages to Supabase and returns a fixed test
                  reply. OpenAI models and routing come later.
                </p>
              </div>
            </div>
          </>
        )}
      </main>

      {/* New Project modal */}
      {showProjectModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50 z-50">
          <div className="w-full max-w-md rounded-xl bg-[#181818] border border-[#3f3f46] p-4 shadow-lg">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-zinc-100">
                New project
              </h2>
              <button
                type="button"
                onClick={() => setShowProjectModal(false)}
                className="text-zinc-400 hover:text-zinc-200 text-lg leading-none"
              >
                ×
              </button>
            </div>
            <input
              className="w-full rounded-md border border-[#3f3f46] bg-[#303030] px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-[#1e4fd8]"
              placeholder="Project name"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
            />
            <p className="mt-2 text-[11px] text-zinc-500">
              Projects keep related chats together. You can add more features
              later like files and custom settings.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowProjectModal(false)}
                className="px-3 py-1.5 text-xs rounded-md text-zinc-300 hover:bg-[#26272b]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateProject}
                disabled={!newProjectName.trim()}
                className="px-3 py-1.5 text-xs rounded-md bg-[#1e4fd8] text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-[#2658e4]"
              >
                Create project
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
