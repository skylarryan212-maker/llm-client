"use client";

const actionButtonClass =
  "flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-sm text-zinc-100 transition hover:bg-white/10";

export default function Header() {
  return (
    <header className="border-b border-white/10 bg-[#0b0b10] px-6 py-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5 text-left">
          <h1 className="text-xl font-semibold text-white">Codex</h1>
          <p className="text-sm text-zinc-400">
            Code assistant for debugging, refactors, and repo-wide changes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button className={actionButtonClass}>
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
            >
              <rect x="3" y="4" width="18" height="4" rx="1" />
              <path d="M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
              <path d="M10 12h4" />
            </svg>
            Archive
          </button>
          <button className={actionButtonClass}>
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
            Share
          </button>
          <button className={`${actionButtonClass} pr-2`}>
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M9 19c-4 1-4-2-6-2" />
              <path d="M15 19c4 1 4-2 6-2" />
              <path d="M9 15c0 1-1 2-2 2" />
              <path d="M15 15c0 1 1 2 2 2" />
              <path d="M8 13a4 4 0 0 1 8 0v1" />
            </svg>
            View PR
            <svg
              className="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          <button className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-300 transition hover:bg-white/10 hover:text-white">
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 16v-5a6 6 0 0 0-12 0v5" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              <path d="M2 16h20" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
