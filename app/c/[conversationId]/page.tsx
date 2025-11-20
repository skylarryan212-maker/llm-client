"use client";

import { MainApp } from "../../page";

export default function ConversationPage() {
  // For now, we are NOT using the URL param to drive state.
  // We just render the normal chat experience.
  return <MainApp initialPrimaryView="chat" />;
}
