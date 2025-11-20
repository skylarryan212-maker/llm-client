"use client";

import { MainApp } from "../../page";

export default function ProjectPage({ params }: { params: { projectSlug: string } }) {
  const projectId = params.projectSlug;
  return (
    <MainApp
      initialPrimaryView="chat"
      routeProjectId={projectId}
    />
  );
}
