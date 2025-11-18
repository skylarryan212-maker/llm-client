"use client";

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  condensed?: boolean;
}

const chats = [
  { id: 1, title: "Refactor Agents Catalog", active: true },
  { id: 2, title: "Fix Auth Flow", active: false },
  { id: 3, title: "Database Migration", active: false },
];

function AgentsMiniIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <rect x="3.5" y="3.5" width="9" height="9" rx="2" />
      <path d="M11 11L20 20" />
      <path d="M15.5 20H20V15.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M6 6l12 12" />
      <path d="M18 6l-12 12" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

export default function Sidebar({ isOpen, onToggle, condensed }: SidebarProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <aside
      className={`${condensed ? "w-48" : "w-64"} flex flex-col overflow-hidden border-r border-white/5 bg-[#0b0b10] transition-all`}
    >
      <div className="flex items-center gap-2 border-b border-white/5 px-4 py-4">
        <button className="flex flex-1 items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-sm text-zinc-100 hover:bg-white/10">
          <AgentsMiniIcon />
          {!condensed && <span>Agents</span>}
        </button>
        {!condensed && (
          <button
            onClick={onToggle}
            className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white/10 hover:text-white"
            aria-label="Close sidebar"
          >
            <CloseIcon />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mb-4 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-zinc-500">
          {!condensed && <span>Current Chats</span>}
          {!condensed && (
            <button className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-300 transition hover:bg-white/10 hover:text-white">
              <PlusIcon />
            </button>
          )}
        </div>

        <div className="space-y-2">
          {chats.map((chat) => (
            <div
              key={chat.id}
              className={`rounded-xl border px-3 py-3 text-sm transition ${
                chat.active
                  ? "border-white/20 bg-white/5 text-white"
                  : "border-white/5 bg-[#0f0f15] text-zinc-300 hover:bg-white/5"
              }`}
            >
              <p className={`${condensed ? "text-xs" : "text-sm"} truncate`}>{chat.title}</p>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
