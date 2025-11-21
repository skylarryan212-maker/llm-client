"use client";

import Link from "next/link";
import { useState } from "react";

import "@/components/v0/styles/globals.css";

import { ChatSidebar } from "@/components/v0/components/chat-sidebar";
import { ThemeProvider } from "@/components/v0/components/theme-provider";
import { Button } from "@/components/v0/components/ui/button";
import { ScrollArea } from "@/components/v0/components/ui/scroll-area";

export default function V0AgentsPage() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <div className="flex h-screen bg-background text-foreground">
        <ChatSidebar
          isOpen={isSidebarOpen}
          onToggle={() => setIsSidebarOpen((prev) => !prev)}
          onNewChat={() => {}}
          onNewProject={() => {}}
          onProjectSelect={() => {}}
          selectedProjectId={undefined}
          onSettingsOpen={() => {}}
        />

        <div className="flex flex-1 flex-col bg-background">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                onClick={() => setIsSidebarOpen((prev) => !prev)}
              >
                <span className="sr-only">Toggle sidebar</span>
                ☰
              </Button>
              <div>
                <p className="text-sm font-semibold">Agents</p>
                <p className="text-xs text-muted-foreground">Coming soon to the V0 experience.</p>
              </div>
            </div>
            <Link href="/v0" className="text-xs text-muted-foreground underline">
              Back to chat
            </Link>
          </div>

          <ScrollArea className="flex-1">
            <div className="mx-auto max-w-4xl p-6 text-sm text-muted-foreground">
              <p className="mb-4">
                The V0 agents directory will live here. In the meantime you can continue to browse agents in the
                classic interface.
              </p>
              <Link href="/agents" className="text-primary underline">
                Open classic agents page
              </Link>
            </div>
          </ScrollArea>
        </div>
      </div>
    </ThemeProvider>
  );
}
