"use client";

import { MainApp } from "../../page";

export default function ProjectPage({
  params,
}: {
  params: { projectSlug: string };
}) {
  const projectSlug = params?.projectSlug;
  return (
    <MainApp
      initialPrimaryView="chat"
      routeConversationId={null}
      routeProjectSlug={projectSlug ?? null}
    />
  );
}
