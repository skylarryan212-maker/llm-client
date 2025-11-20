"use client";

import { useEffect, useState } from "react";

import { ChatComposer } from "@/components/v0/components/chat-composer";
import { ChatHeader } from "@/components/v0/components/chat-header";
import { ChatMessage } from "@/components/v0/components/chat-message";
import { ChatSidebar } from "@/components/v0/components/chat-sidebar";
import { SettingsModal } from "@/components/v0/components/settings-modal";
import { Button } from "@/components/v0/components/ui/button";
import { ScrollArea } from "@/components/v0/components/ui/scroll-area";

type DemoMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
};

function V0ChatPage() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [messages, setMessages] = useState<DemoMessage[]>([
    { id: "1", role: "assistant", content: "Welcome to the new V0 UI preview." },
    { id: "2", role: "user", content: "This is a demo message." },
  ]);

  useEffect(() => {
    console.log("Loaded V0 preview");
  }, []);

  const handleSubmit = (text: string) => {
    if (!text.trim()) return;

    const newMessage: DemoMessage = {
      id: `${Date.now()}`,
      role: "user",
      content: text,
    };

    setMessages((prev) => [...prev, newMessage]);
    console.log("V0 composer submit:", text);
  };

  return (
    <div className="flex h-screen bg-black text-zinc-50">
      <ChatSidebar
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen((prev) => !prev)}
        conversations={[]}
        selectedChatId={undefined}
        onChatSelect={() => {}}
        onNewChat={() => {}}
        onNewProject={() => {}}
        onProjectSelect={() => {}}
        selectedProjectId={undefined}
        onSettingsOpen={() => setIsSettingsOpen(true)}
      />

      <div className="flex flex-1 flex-col bg-background">
        <ChatHeader
          title="V0 preview"
          onMenuClick={() => setIsSidebarOpen((prev) => !prev)}
          isSidebarOpen={isSidebarOpen}
        />

        <ScrollArea className="flex-1">
          <div className="mx-auto flex max-w-3xl flex-col gap-2 py-4">
            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                role={message.role}
                content={message.content}
                model={message.role === "assistant" ? "GPT-4" : undefined}
              />
            ))}
          </div>
        </ScrollArea>

        <div className="border-t border-border px-3 py-2 sm:px-4">
          <div className="flex items-center justify-between pb-2 text-xs text-muted-foreground">
            <span>Try out the composer below. Messages are local only.</span>
            <Button variant="ghost" size="sm" onClick={() => setIsSettingsOpen(true)}>
              Settings
            </Button>
          </div>
          <ChatComposer onSubmit={handleSubmit} />
        </div>
      </div>

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );
}

export default function V0RootPage() {
  return <V0ChatPage />;
}
