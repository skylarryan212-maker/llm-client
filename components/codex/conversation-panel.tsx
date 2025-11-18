"use client";

import ConversationTab from "./conversation-tab";
import DiffViewerTab from "./diff-viewer-tab";

interface ConversationPanelProps {
  diffOpen: boolean;
  onDiffOpen: () => void;
  onDiffClose: () => void;
}

function IconPlus() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function IconChevron() {
  return (
    <svg
      className="h-3 w-3 text-zinc-500"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function IconMic() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
    >
      <path d="M12 15a3 3 0 0 0 3-3V7a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z" />
      <path d="M19 11a7 7 0 0 1-14 0" />
      <path d="M12 19v3" />
    </svg>
  );
}

function IconArrow() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12l7-7 7 7" />
      <path d="M12 5v14" />
    </svg>
  );
}

export default function ConversationPanel({ diffOpen, onDiffOpen, onDiffClose }: ConversationPanelProps) {
  if (diffOpen) {
    return <DiffViewerTab onClose={onDiffClose} />;
  }

  return (
    <section className="flex flex-1 min-w-0 flex-col bg-[#050509] text-white">
      <div className="flex-1 overflow-y-auto">
        <ConversationTab onDiffOpen={onDiffOpen} />
      </div>

      <div className="border-t border-white/10 bg-[#050509] p-4">
        <div className="flex flex-col rounded-2xl border border-white/10 bg-[#0d0d12] px-4 py-4">
          <textarea
            placeholder="Ask a question with /plan"
            rows={3}
            className="w-full resize-none bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
          />

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-300 transition hover:bg-white/10 hover:text-white" aria-label="Add attachment">
                <IconPlus />
              </button>

              <div className="hidden h-6 w-px bg-white/10 sm:block" />

              {["llm-client", "main", "1x"].map((label) => (
                <button
                  key={label}
                  className="flex items-center gap-2 rounded-full px-3 py-1 text-sm text-zinc-200 transition hover:bg-white/10"
                  type="button"
                >
                  <span>{label}</span>
                  <IconChevron />
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-300 transition hover:bg-white/10 hover:text-white" aria-label="Use voice">
                <IconMic />
              </button>
              <button className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-black transition hover:bg-white/90" aria-label="Send">
                <IconArrow />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
