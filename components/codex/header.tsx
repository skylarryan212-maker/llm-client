"use client";

export default function Header() {
  return (
    <header className="border-b border-[#2a2a2a] bg-[#212121] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            Agent
          </p>
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold text-white">Codex</h1>
            <p className="text-sm text-zinc-400">
              Purpose-built for repo-wide refactors, debugging, and diffs.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <span className="rounded-full border border-white/10 px-3 py-1 text-white/80">
            Preview
          </span>
        </div>
      </div>
    </header>
  );
}
