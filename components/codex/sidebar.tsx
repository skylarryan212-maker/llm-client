"use client";

import type { ConversationMeta } from "@/lib/conversations";

interface SidebarProps {
  conversations: ConversationMeta[];
  selectedConversationId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onAgentsClick: () => void;
  isCreating?: boolean;
  streamingConversationId?: string | null;
}

function formatTimestamp(value?: string | null) {
  if (!value) return "Recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Recently";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

export default function Sidebar({
  conversations,
  selectedConversationId,
  onSelect,
  onCreate,
  onAgentsClick,
  isCreating,
  streamingConversationId,
}: SidebarProps) {
  return (
    <aside className="flex w-72 flex-col border-r border-white/10 bg-[#0a0a10] text-sm">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <button
          type="button"
          onClick={onAgentsClick}
          className="flex flex-1 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-left text-white transition hover:border-white/20"
        >
          <span className="text-xs uppercase tracking-wide text-zinc-400">
            Agents
          </span>
        </button>
        <button
          type="button"
          aria-label="New Codex chat"
          onClick={onCreate}
          disabled={isCreating}
          className="ml-3 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-lg text-zinc-400 transition hover:text-white disabled:opacity-50"
        >
          +
        </button>
      </div>

      <div className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Current chats
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-4 pb-4">
        {conversations.length === 0 && (
          <div className="rounded-lg border border-dashed border-white/10 bg-white/5 p-4 text-xs text-zinc-400">
            No Codex chats yet. Start one to keep it pinned here.
          </div>
        )}
        {conversations.map((conversation) => {
          const isActive = conversation.id === selectedConversationId;
          const isStreaming =
            streamingConversationId &&
            streamingConversationId === conversation.id;
          return (
            <button
              key={conversation.id}
              type="button"
              onClick={() => onSelect(conversation.id)}
              className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                isActive
                  ? "border-white/15 bg-white/10 text-white"
                  : "border-white/10 bg-transparent text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">
                  {conversation.title?.trim() || "Untitled Codex chat"}
                </span>
                <span className="text-xs text-zinc-500">
                  {formatTimestamp(conversation.created_at)}
                </span>
              </div>
              {isStreaming && (
                <div className="mt-1 text-xs text-white">
                  Working...
                </div>
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
