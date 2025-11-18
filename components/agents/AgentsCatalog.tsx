import { AgentCard } from "./AgentCard";

const AGENT_FILTERS = ["All", "Coding", "Research", "Productivity", "Analysis"];

const FEATURED_AGENTS = [
  {
    id: "code-navigator",
    name: "Code Navigator",
    description:
      "Understands large repositories, prepares refactors, and highlights risky areas before you touch the keyboard.",
    tags: ["Context aware", "Diff ready", "TypeScript"],
    iconLabel: "CN",
    iconHint: "Repo intelligence",
  },
  {
    id: "brief-writer",
    name: "Brief Writer",
    description:
      "Turns rough meeting notes into concise briefs with callouts, blockers, and stakeholder-ready summaries.",
    tags: ["Summaries", "Narratives", "Meetings"],
    iconLabel: "BW",
    iconHint: "Writing",
  },
  {
    id: "launch-analyst",
    name: "Launch Analyst",
    description:
      "Monitors launches across sources, surfaces sentiment, and prepares talking points for leadership updates.",
    tags: ["Signals", "Dashboards", "Live tracking"],
    iconLabel: "LA",
    iconHint: "Monitoring",
  },
  {
    id: "market-notes",
    name: "Market Notes",
    description:
      "Tracks macro data, compares prior periods, and ships annotated briefs for quick investor check-ins.",
    tags: ["Finance", "Comparisons", "Summaries"],
    iconLabel: "MN",
    iconHint: "Markets",
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
