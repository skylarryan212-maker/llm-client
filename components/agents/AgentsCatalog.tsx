import { AgentCard } from "./AgentCard";

const AGENT_FILTERS = ["All", "Coding", "Research", "Productivity", "Analysis"];

const FEATURED_AGENTS = [
  {
    id: "codex",
    name: "Codex",
    description:
      "Deep code assistant for debugging, refactoring, repo analysis, and large-scale project modifications.",
    tags: ["Coding", "Refactors", "TypeScript"],
    iconLabel: "CX",
    iconHint: "Code intelligence",
  },
  {
    id: "market-agent",
    name: "Market Agent",
    description:
      "Volatility-aware market watcher for intraday monitoring, pre-open predictions, and end-of-day summaries.",
    tags: ["Markets", "Live monitoring", "Summaries"],
    iconLabel: "MA",
    iconHint: "Financial analysis",
  },
  {
    id: "automation-builder",
    name: "Automation Builder",
    description:
      "Creates task workflows, scripts, and automations. Converts your instructions into repeatable, executable processes.",
    tags: ["Automation", "Workflows", "Scripting"],
    iconLabel: "AB",
    iconHint: "Process builder",
  },
  {
    id: "data-interpreter",
    name: "Data Interpreter",
    description:
      "Processes spreadsheets and datasets to surface trends, detect anomalies, and generate charts and interpretations.",
    tags: ["Data", "Charts", "Analytics"],
    iconLabel: "DI",
    iconHint: "Data analysis"
  },
];

export function AgentsCatalog() {
  return (
    <section className="flex flex-1 flex-col overflow-y-auto px-4 py-6 md:px-8">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <div className="space-y-3">
          <p className="text-[12px] uppercase tracking-wide text-zinc-500">Catalog</p>
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold text-white md:text-3xl">Agents</h1>
            <p className="text-sm text-zinc-400">
              Choose a specialized assistant that matches your workflow. Catalog previews are read-only for now.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {AGENT_FILTERS.map((filter, index) => (
              <button
                key={filter}
                type="button"
                className={`rounded-full border border-[#2a2a30] px-3 py-1 text-xs font-medium transition ${
                  index === 0
                    ? "bg-[#202123] text-zinc-100"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {filter}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {FEATURED_AGENTS.map((agent) => (
            <AgentCard key={agent.id} {...agent} />
          ))}
        </div>
      </div>
    </section>
  );
}
