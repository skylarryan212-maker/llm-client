"use client";

import { useState } from "react";
import Header from "@/components/codex/header";
import Sidebar from "@/components/codex/sidebar";
import TaskPanel from "@/components/codex/task-panel";
import ConversationPanel from "@/components/codex/conversation-panel";
import FilesPanel from "@/components/codex/files-panel";

export default function CodexPage() {
  const [leftOpen, setLeftOpen] = useState(true);
  const [diffOpen, setDiffOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(true);

  return (
    <div className="flex min-h-screen flex-col bg-[#050509] text-zinc-100">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        {leftOpen && !diffOpen && (
          <Sidebar isOpen={leftOpen} onToggle={() => setLeftOpen(false)} condensed={diffOpen} />
        )}

        {!leftOpen && !diffOpen && (
          <button
            onClick={() => setLeftOpen(true)}
            className="flex h-full w-12 items-center justify-center border-r border-white/5 bg-[#09090d] text-zinc-400 transition hover:bg-[#0f0f15] hover:text-white"
            aria-label="Open sidebar"
          >
            ☰
          </button>
        )}

        <div className="flex flex-1 overflow-hidden bg-[#050509]">
          {!diffOpen && <TaskPanel />}
          <ConversationPanel diffOpen={diffOpen} onDiffOpen={() => setDiffOpen(true)} onDiffClose={() => setDiffOpen(false)} />
          {!diffOpen && filesOpen && <FilesPanel isOpen={filesOpen} onToggle={() => setFilesOpen(false)} />}

          {!diffOpen && !filesOpen && (
            <button
              onClick={() => setFilesOpen(true)}
              className="hidden w-10 items-center justify-center border-l border-white/5 bg-[#09090d] text-xs uppercase tracking-wide text-zinc-400 transition hover:bg-[#0f0f15] hover:text-white lg:flex"
            >
              Show
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
