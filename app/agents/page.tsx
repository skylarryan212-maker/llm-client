"use client";

import { MainApp } from "../page";

export default function AgentsPage() {
  // Agents view is controlled via PrimaryView = "agents"
  return <MainApp initialPrimaryView="agents" />;
}
