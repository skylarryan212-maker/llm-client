"use client";

const actionButtonClass =
  "flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-zinc-300 transition hover:text-white";

export default function Header() {
  return (
    <header className="border-b border-white/10 bg-[#0f0f15] px-6 py-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-white">Codex</h1>
          <p className="text-sm text-zinc-400">
            Code assistant for debugging, refactors, and repo-wide changes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button type="button" className={actionButtonClass}>
            Archive
          </button>
          <button type="button" className={actionButtonClass}>
            Share
          </button>
          <button type="button" className={`${actionButtonClass} pr-2`}>
            View PR
            <span aria-hidden className="text-lg leading-none text-zinc-500">
              ▾
            </span>
          </button>
          <button
            type="button"
            aria-label="Notifications"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 text-zinc-400 transition hover:text-white"
          >
            •
          </button>
        </div>
      </div>
    </header>
  );
}
