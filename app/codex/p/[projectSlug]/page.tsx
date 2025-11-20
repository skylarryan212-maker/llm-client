"use client";

import { MainApp } from "../../../page";

export default function CodexProjectPage({
  params,
}: {
  params: { projectSlug: string };
}) {
  return (
    <MainApp
      mode="codex"
      initialPrimaryView="chat"
      routeProjectId={params.projectSlug}
    />
  );
}
