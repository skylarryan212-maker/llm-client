"use client";

export default function DiffTab() {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#0d0d12]">
      <div className="border-b border-white/5 bg-[#111116] px-4 py-3">
        <p className="font-mono text-xs text-zinc-300">components/agents/AgentCard.tsx</p>
      </div>
      <div className="space-y-0 font-mono text-xs">
        {[1, 2, 3, 4, 5, 6, 7].map((line) => (
          <div key={line} className="flex px-4 py-1 text-zinc-400">
            <span className="mr-3 w-6 select-none text-right text-zinc-600">{line}</span>
            <span>{`Line ${line}`}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
