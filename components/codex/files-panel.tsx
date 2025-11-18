"use client";

export default function FilesPanel() {
  const sections = [
    {
      title: "Work summary",
      body: "Codex will summarize its plan and recent updates once it starts editing files.",
    },
    {
      title: "Tracked files",
      body: "No files to display yet. When Codex modifies your repo, the touched files will appear here.",
    },
    {
      title: "Checks",
      body: "Status checks and diff previews will show here after Codex proposes changes.",
    },
  ];

  return (
    <aside className="hidden w-80 flex-col border-l border-[#202123] bg-[#181818] p-4 text-sm text-zinc-200 lg:flex">
      <div className="space-y-4">
        {sections.map((section) => (
          <section
            key={section.title}
            className="rounded-xl border border-[#2f2f32] bg-[#212126] p-4"
          >
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {section.title}
            </h3>
            <p className="mt-2 text-sm text-zinc-400">{section.body}</p>
          </section>
        ))}
      </div>
    </aside>
  );
}
