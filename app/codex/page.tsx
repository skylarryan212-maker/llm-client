"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import ConversationPanel from "@/components/codex/conversation-panel";
import FilesPanel from "@/components/codex/files-panel";
import Header from "@/components/codex/header";
import Sidebar from "@/components/codex/sidebar";
import { useCodexChat } from "@/hooks/useCodexChat";

export default function CodexPage() {
  const router = useRouter();
  const [inputValue, setInputValue] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const {
    conversations,
    selectedConversationId,
    selectConversation,
    createNewConversation,
    messages,
    isLoadingMessages,
    isStreaming,
    streamingConversationId,
    sendMessage,
    error,
    setError,
  } = useCodexChat();

  const activeConversation = conversations.find(
    (conversation) => conversation.id === selectedConversationId
  );

  const handleSend = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    await sendMessage(trimmed);
    setInputValue("");
  };

  const handleCreateConversation = async () => {
    setIsCreating(true);
    try {
      await createNewConversation();
      setInputValue("");
      setError(null);
    } finally {
      setIsCreating(false);
    }
  };

  const handleInputChange = (value: string) => {
    if (error) {
      setError(null);
    }
    setInputValue(value);
  };

  const handlePromptInsert = (prompt: string) => {
    setInputValue(prompt);
    setError(null);
  };

  return (
    <div className="flex h-screen flex-col bg-[#212121] text-zinc-100">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          conversations={conversations}
          selectedConversationId={selectedConversationId}
          onSelect={selectConversation}
          onCreate={handleCreateConversation}
          onAgentsClick={() => router.push("/agents")}
          isCreating={isCreating}
          streamingConversationId={streamingConversationId}
        />
        <ConversationPanel
          messages={messages}
          isLoading={isLoadingMessages}
          isStreaming={isStreaming}
          inputValue={inputValue}
          onInputChange={handleInputChange}
          onSend={handleSend}
          onPromptInsert={handlePromptInsert}
          error={error}
          activeConversation={activeConversation}
        />
        <FilesPanel />
      </div>
    </div>
  );
}
