"use client";

interface ConversationTabProps {
  onDiffOpen: () => void;
}

export default function ConversationTab({ onDiffOpen }: ConversationTabProps) {
  return (
    <div className="p-6 text-left">
      <div className="flex min-h-96 items-center justify-center">
        <div className="max-w-sm text-center">
          <h3 className="mb-2 text-lg font-semibold text-white">Give Codex a task</h3>
          <p className="mb-6 text-sm text-zinc-400">
            Describe what you want changed in your codebase.
          </p>
          <div className="space-y-2 text-left">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Example prompts</p>
            <ul className="space-y-1 text-xs text-zinc-400">
              <li>• Refactor the Agents Catalog layout.</li>
              <li>• Remove gradients from all UI cards.</li>
              <li>• Split sidebar navigation into components.</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="mx-auto mt-8 max-w-3xl space-y-6">
        <div className="text-sm text-zinc-400">
          Worked for <span className="font-semibold text-white">11m</span>
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-white">Summary</h4>
          <ul className="space-y-2 text-sm text-zinc-200">
            <li className="flex gap-2">
              <span className="text-blue-400">•</span>
              <span>
                Refactored the main chat experience into a reusable MainApp shell that knows whether the current route is / or /agents, adds an Agents button to the sidebar.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="text-blue-400">•</span>
              <span>
                Swapped the primary content area to render the catalog when isAgentsView is true and introduced a lightweight /agents page that simply reuses the shared shell.
              </span>
            </li>
          </ul>
        </div>

        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-white">Testing</h4>
          <div className="flex items-center gap-2 text-sm text-zinc-200">
            <svg className="h-4 w-4 text-green-400" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            npm run lint
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-white/10">
          <button className="flex w-full items-center justify-between bg-[#111116] px-4 py-3 text-left text-sm font-semibold text-white">
            <span className="flex items-center gap-2">
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M5.5 13a3.5 3.5 0 01-.369-6.98 4 4 0 117.753-1.3A4.5 4.5 0 1113.5 13H11V9.413l1.293 1.293a1 1 0 001.414-1.414l-3-3a1 1 0 00-1.414 0l-3 3a1 1 0 001.414 1.414L9 9.414V13H5.5z" />
              </svg>
              Files (5)
            </span>
            <svg className="h-4 w-4 text-zinc-500" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          <div className="divide-y divide-white/5 bg-[#0d0d12]">
            {[
              { file: "app/agents/page.tsx", status: "New" },
              { file: "app/page.tsx", status: "+43 -3" },
              { file: "components/agents/AgentCard.tsx", status: "New" },
              { file: "components/agents/AgentTag.tsx", status: "New" },
              { file: "components/agents/AgentsCatalog.tsx", status: "New" },
            ].map((entry) => (
              <div key={entry.file} className="flex items-center justify-between px-4 py-3 text-sm text-zinc-200">
                <span className="font-mono text-xs">{entry.file}</span>
                <span className="rounded-full bg-white/5 px-2 py-1 text-[11px] text-zinc-300">{entry.status}</span>
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={onDiffOpen}
          className="rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
        >
          View Diff
        </button>
      </div>
    </div>
  );
}
