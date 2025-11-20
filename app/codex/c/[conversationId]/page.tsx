"use client";

import { MainApp } from "../../../page";

export default function CodexConversationPage({
  params,
}: {
  params: { conversationId: string };
}) {
  return (
    <MainApp
      mode="codex"
      initialPrimaryView="chat"
      routeConversationId={params.conversationId}
    />
  );
}
