"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { ChatMessage } from "@/lib/types";

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [symbol, setSymbol] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiFetch<ChatMessage[]>("/chat/history").then(setMessages).catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    const optimistic: ChatMessage = {
      id: Date.now(),
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    setText("");
    try {
      const reply = await apiFetch<ChatMessage>("/chat", {
        method: "POST",
        body: JSON.stringify({ message: optimistic.content, symbol: symbol || null }),
      });
      setMessages((m) => [...m, reply]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          id: Date.now() + 1,
          role: "assistant",
          content: err instanceof Error ? err.message : "Chat selhal",
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 min-h-[70vh]">
      <div>
        <h1 className="display text-3xl">AI rádce</h1>
        <p className="muted">Česky, s kontextem tipů a dat — čísla nevymýšlí.</p>
      </div>
      <div className="card flex-1 p-4 space-y-3 overflow-y-auto max-h-[60vh]">
        {messages.length === 0 && <p className="muted">Zeptej se na ticker, tip nebo makro.</p>}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`rounded-2xl px-4 py-3 max-w-[90%] whitespace-pre-wrap ${
              m.role === "user"
                ? "ml-auto bg-[color-mix(in_srgb,var(--accent)_18%,transparent)]"
                : "bg-[var(--bg-soft)]"
            }`}
          >
            {m.content}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={onSubmit} className="grid gap-2 sm:grid-cols-[120px_1fr_auto]">
        <input className="input" placeholder="Symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
        <input className="input" placeholder="Zpráva…" value={text} onChange={(e) => setText(e.target.value)} required />
        <button className="btn btn-primary" disabled={busy}>{busy ? "…" : "Odeslat"}</button>
      </form>
    </div>
  );
}
