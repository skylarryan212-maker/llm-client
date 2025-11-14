"use client";

import { useState } from "react";

export default function Home() {
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState("");

  async function sendMessage() {
    if (!input.trim()) return;

    const userMessage = { role: "user", content: input };
    setMessages((prev) => [...prev, userMessage]);

    setInput("");

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: input }),
    });

    const data = await res.json();

    const assistantMessage = {
      role: "assistant",
      content: data.reply,
    };

    setMessages((prev) => [...prev, assistantMessage]);
  }

  return (
    <div className="flex flex-col h-screen max-w-lg mx-auto p-4">
      <div className="flex-1 overflow-y-auto mb-4 space-y-2">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`p-3 rounded-lg ${
              m.role === "user"
                ? "bg-blue-500 text-white self-end"
                : "bg-gray-200 text-black"
            }`}
          >
            {m.content}
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          className="flex-1 border border-gray-300 p-2 rounded"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Type a message..."
        />
        <button
          onClick={sendMessage}
          className="bg-black text-white px-4 py-2 rounded"
        >
          Send
        </button>
      </div>
    </div>
  );
}
