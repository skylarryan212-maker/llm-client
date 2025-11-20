"use client";

import { MainApp } from "../page";

export default function CodexPage() {
  // Codex is controlled via mode = "codex"
  // Primary view can stay "chat" (default)
  return <MainApp mode="codex" />;
}
