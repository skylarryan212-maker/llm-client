"use client";

export default function TaskPanel() {
  return (
    <section className="hidden w-80 min-w-[260px] flex-col gap-8 border-r border-white/5 bg-[#09090d] p-6 text-left lg:flex">
      <div className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">Task</h2>
        <div className="rounded-2xl border border-white/10 bg-[#0f0f15] p-4 text-sm text-zinc-200">
          Refactor the Agents Catalog layout to use shared card components and improve responsive design on mobile devices.
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">Context</h2>
        <div className="space-y-3 rounded-2xl border border-white/10 bg-[#0f0f15] p-4">
          <div>
            <p className="text-xs uppercase text-zinc-500">Repo</p>
            <p className="font-mono text-sm text-zinc-200">skylarryan212/llm-client</p>
          </div>
          <div>
            <p className="text-xs uppercase text-zinc-500">Branch</p>
            <p className="font-mono text-sm text-zinc-200">main</p>
          </div>
          <div>
            <p className="text-xs uppercase text-zinc-500">Relevant directories</p>
            <p className="font-mono text-sm text-zinc-200">/app/agents, /components/agents</p>
          </div>
        </div>
      </div>
    </section>
  );
}
