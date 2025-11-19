"use client";

import { MainApp } from "../../page";

export default function ConversationPage({
  params,
}: {
  params: { conversationId: string };
}) {
  const conversationId = params?.conversationId;
  return (
    <MainApp initialPrimaryView="chat" routeConversationId={conversationId ?? null} />
  );
}
