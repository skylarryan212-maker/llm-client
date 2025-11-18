"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { ConversationMeta } from "@/lib/conversations";

type ConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
};

interface ConversationPanelProps {
  messages: ConversationMessage[];
  isLoading: boolean;
  isStreaming: boolean;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onPromptInsert: (value: string) => void;
  error?: string | null;
  activeConversation?: ConversationMeta | null;
}

const EXAMPLE_PROMPTS = [
  "Refactor the Agents catalog layout.",
  "Remove gradients from all UI cards.",
  "Split the sidebar into composable components.",
];

export default function ConversationPanel({
  messages,
  isLoading,
  isStreaming,
  inputValue,
  onInputChange,
  onSend,
  onPromptInsert,
  error,
  activeConversation,
}: ConversationPanelProps) {
  const [activeTab, setActiveTab] = useState<"conversation" | "diff">(
    "conversation"
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (activeTab !== "conversation") return;
    const container = scrollRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages, activeTab, isStreaming]);

  const conversationTitle = useMemo(() => {
    return activeConversation?.title?.trim() || "Untitled Codex chat";
  }, [activeConversation]);

  const disableSend = !inputValue.trim() || isStreaming;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!disableSend) {
        onSend();
      }
    }
  };

  const renderEmptyState = () => (
    <div className="mx-auto max-w-md rounded-2xl border border-dashed border-white/15 bg-[#13131a] p-6 text-center">
      <h3 className="text-lg font-semibold text-white">Give Codex a task</h3>
      <p className="mt-2 text-sm text-zinc-400">
        Describe what you want changed in your codebase.
      </p>
      <div className="mt-6 space-y-2 text-left text-sm text-zinc-400">
        {EXAMPLE_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onPromptInsert(prompt)}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left text-zinc-200 transition hover:border-white/20"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );

  const renderMessages = () => {
    if (isLoading) {
      return (
        <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-400">
          Loading conversation…
        </div>
      );
    }
    if (messages.length === 0) {
      return renderEmptyState();
    }
    return messages.map((message) => {
      const isUser = message.role === "user";
      return (
        <div
          key={message.id}
          className={`max-w-3xl rounded-2xl border px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? "ml-auto border-white/20 bg-white/10 text-white"
              : "mr-auto border-white/10 bg-[#11111a] text-zinc-100"
          }`}
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            {isUser ? "You" : "Codex"}
          </div>
          <div className="mt-1 whitespace-pre-wrap">
            {message.content || (message.pending ? "…" : "")}
          </div>
          {message.pending && (
            <div className="mt-2 text-xs text-zinc-400">Sending…</div>
          )}
        </div>
      );
    });
  };

  const diffPanel = (
    <div className="flex h-full flex-col px-6 py-6">
      <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-6 text-center text-sm text-zinc-400">
        No changes to show yet. Diff previews will appear here once Codex proposes edits.
      </div>
    </div>
  );

  return (
    <div className="flex flex-1 flex-col bg-[#09090f]">
      <div className="border-b border-white/10 px-6 py-3">
        <div className="flex items-center gap-4 text-sm">
          {(["conversation", "diff"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`pb-1 text-sm font-medium transition ${
                activeTab === tab
                  ? "text-white"
                  : "text-zinc-500 hover:text-zinc-200"
              }`}
            >
              {tab === "conversation" ? "Conversation" : "Diff"}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs uppercase tracking-wide text-zinc-500">
          {conversationTitle}
        </p>
      </div>

      {activeTab === "conversation" ? (
        <div className="flex h-full flex-col">
          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-6 py-6">
            {renderMessages()}
          </div>
          <div className="border-t border-white/10 bg-[#09090f] px-6 py-4">
            {error && (
              <div className="mb-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </div>
            )}
            <div className="rounded-2xl border border-white/10 bg-[#11111a] p-4">
              <textarea
                value={inputValue}
                onChange={(event) => onInputChange(event.target.value)}
                onKeyDown={handleKeyDown}
                rows={3}
                className="w-full resize-none bg-transparent text-sm text-white placeholder:text-zinc-500 focus:outline-none"
                placeholder="Describe a refactor, bug fix, or new feature"
              />
              <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
                <span>Press Enter to send, Shift + Enter for newline.</span>
                <button
                  type="button"
                  onClick={onSend}
                  disabled={disableSend}
                  className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black transition disabled:opacity-50"
                >
                  {isStreaming ? "Sending…" : "Send"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        diffPanel
      )}
    </div>
  );
}
