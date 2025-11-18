"use client";

interface FilesPanelProps {
  isOpen: boolean;
  onToggle: () => void;
}

export default function FilesPanel({ isOpen, onToggle }: FilesPanelProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <aside className="hidden w-72 min-w-[240px] flex-col border-l border-white/5 bg-[#09090d] text-left lg:flex">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-4">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">Changes</h2>
        <button
          onClick={onToggle}
          className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition hover:bg-white/10 hover:text-white"
          aria-label="Close changes panel"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6 6l12 12" />
            <path d="M18 6l-12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Files touched</h3>
          {[
            { file: "components/agents/AgentCard.tsx", badge: "modified" },
            { file: "app/agents/page.tsx", badge: "new" },
            { file: "styles/agents.css", badge: "modified" },
          ].map((item) => (
            <div key={item.file} className="flex items-center justify-between rounded-2xl border border-white/10 bg-[#0f0f15] px-3 py-2 text-xs text-zinc-200">
              <span className="font-mono truncate">{item.file}</span>
              <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-zinc-300">{item.badge}</span>
            </div>
          ))}
        </div>

        <div className="my-5 h-px bg-white/10" />

        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Change summary</h3>
          <ul className="space-y-2 text-sm text-zinc-200">
            <li className="flex gap-2">
              <span className="text-blue-400">•</span>
              <span>Removed heavy shadows from agent cards.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-blue-400">•</span>
              <span>Normalized sidebar button typography.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-blue-400">•</span>
              <span>Extracted shared card component.</span>
            </li>
            <li className="flex gap-2">
              <span className="text-blue-400">•</span>
              <span>Improved responsive grid layout for mobile.</span>
            </li>
          </ul>
        </div>
      </div>
    </aside>
  );
}
