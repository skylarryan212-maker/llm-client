"use client";

import ConversationTab from "./conversation-tab";

interface DiffViewerTabProps {
  onClose: () => void;
}

export default function DiffViewerTab({ onClose }: DiffViewerTabProps) {
  return (
    <div className="flex flex-1 overflow-hidden bg-[#050509] text-white">
      <div className="hidden w-96 border-r border-white/5 bg-[#09090d] lg:flex">
        <div className="flex-1 overflow-y-auto">
          <ConversationTab onDiffOpen={() => {}} />
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-3">
          <span className="text-sm font-semibold">Diff</span>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-300 transition hover:bg-white/10 hover:text-white"
            aria-label="Close diff view"
          >
            <svg
              className="h-5 w-5"
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

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {["app/agents/page.tsx", "app/page.tsx"].map((file, index) => (
            <div key={file} className="rounded-2xl border border-white/10 bg-[#0d0d12]">
              <div className="flex items-center justify-between border-b border-white/5 px-4 py-3 text-sm">
                <div className="flex items-center gap-2 text-zinc-200">
                  <svg className="h-4 w-4 text-zinc-400" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4z" />
                  </svg>
                  <span className="font-mono text-xs">{file}</span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-green-400">+{index === 0 ? 7 : 43}</span>
                  <span className="text-red-400">-{index === 0 ? 0 : 3}</span>
                </div>
              </div>

              <div className="flex divide-x divide-white/5 font-mono text-xs">
                {["old", "new"].map((side) => (
                  <div key={side} className="flex-1 overflow-x-auto">
                    {[1, 2, 3, 4, 5, 6, 7].map((line) => {
                      const highlight = side === "new" && line === 6;
                      return (
                        <div
                          key={`${side}-${line}`}
                          className={`flex px-4 py-1 ${highlight ? "bg-green-500/10 text-green-400" : "text-zinc-400 hover:bg-white/5"}`}
                        >
                          <span className="mr-3 w-6 select-none text-right text-zinc-500">{line}</span>
                          <span>
                            {highlight
                              ? side === "new"
                                ? "+ export function AgentTag() {}"
                                : "export const Agent = ()"
                              : side === "old"
                              ? "export const Agent = ()"
                              : "export const Agent = ()"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
