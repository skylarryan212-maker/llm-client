"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import "@/components/v0/styles/globals.css";

import { ChatComposer } from "@/components/v0/components/chat-composer";
import { ChatHeader } from "@/components/v0/components/chat-header";
import { ChatMessage } from "@/components/v0/components/chat-message";
import { ChatSidebar } from "@/components/v0/components/chat-sidebar";
import { SettingsModal } from "@/components/v0/components/settings-modal";
import { ThemeProvider } from "@/components/v0/components/theme-provider";
import { Button } from "@/components/v0/components/ui/button";
import { ScrollArea } from "@/components/v0/components/ui/scroll-area";
import { useChatSession } from "@/components/v0/lib/use-chat-session";

export default function V0RootPage() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const {
    messages,
    conversations,
    selectedConversationId,
    sendMessage,
    selectConversation,
    startNewChat,
  } = useChatSession();

  const sidebarConversations = useMemo(
    () =>
      conversations.map((conv) => ({
        id: conv.id,
        title: conv.title || "Untitled chat",
        timestamp: conv.created_at ?? "",
      })),
    [conversations]
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <div className="flex h-screen bg-black text-zinc-50">
        <ChatSidebar
          isOpen={isSidebarOpen}
          onToggle={() => setIsSidebarOpen((prev) => !prev)}
          conversations={sidebarConversations}
          selectedChatId={selectedConversationId ?? undefined}
          onChatSelect={(id) => selectConversation(id)}
          onNewChat={() => startNewChat()}
          onNewProject={() => {}}
          onProjectSelect={() => {}}
          selectedProjectId={undefined}
          onSettingsOpen={() => setIsSettingsOpen(true)}
        />

        <div className="flex flex-1 flex-col bg-background">
          <ChatHeader
            title="LLM Client V0"
            onMenuClick={() => setIsSidebarOpen((prev) => !prev)}
            isSidebarOpen={isSidebarOpen}
          />

          <ScrollArea className="flex-1">
            <div className="mx-auto flex max-w-3xl flex-col gap-2 py-4">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
                  <p>Start a conversation to see responses stream in.</p>
                  <p className="text-xs text-muted-foreground">
                    Conversations sync with the same backend used by the classic UI.
                  </p>
                </div>
              ) : (
                messages.map((message) => {
                  const primaryModel =
                    message.usedModel ?? message.metadata?.usedModel ?? message.metadata?.imageModelLabel;
                  const primaryImage = message.metadata?.generatedImages?.[0]?.dataUrl;
                  const hasSources = Boolean(
                    (message.metadata?.sources && message.metadata.sources.length > 0) ||
                      (message.metadata?.citations && message.metadata.citations.length > 0)
                  );
                  return (
                    <ChatMessage
                      key={message.id ?? `${message.role}-${message.content.slice(0, 16)}`}
                      role={message.role}
                      content={message.content}
                      model={primaryModel}
                      hasImage={Boolean(message.metadata?.generationType === "image" && primaryImage)}
                      imageUrl={primaryImage}
                      hasSources={hasSources}
                    />
                  );
                })
              )}
            </div>
          </ScrollArea>

          <div className="border-t border-border px-3 py-2 sm:px-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2 text-xs text-muted-foreground">
              <span>Messages use the same /api/chat pipeline as the legacy UI.</span>
              <div className="flex items-center gap-2">
                <Link href="/" className="text-xs text-muted-foreground underline">
                  Back to classic UI
                </Link>
                <Button variant="ghost" size="sm" onClick={() => setIsSettingsOpen(true)}>
                  Settings
                </Button>
              </div>
            </div>
            <ChatComposer onSubmit={(value) => void sendMessage(value)} />
          </div>
        </div>

        <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      </div>
    </ThemeProvider>
  );
}
