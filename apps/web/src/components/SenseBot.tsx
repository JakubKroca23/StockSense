"use client";

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useScreenContext } from "@/components/ScreenContext";
import { ChatMessage, ChatSession, ChatTurn } from "@/lib/types";

function sortSessions(rows: ChatSession[]) {
  return [...rows].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );
}

export function SenseBot() {
  const { screenContextText, screen } = useScreenContext();
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [booting, setBooting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const loadBotSession = useCallback(async () => {
    setBooting(true);
    try {
      const rows = await apiFetch<ChatSession[]>("/chat/sessions");
      const sorted = sortSessions(rows);
      let bot =
        sorted.find(
          (s) =>
            s.status === "open" &&
            (s.title.toLowerCase().includes("sense bot") || !s.symbol)
        ) || sorted.find((s) => s.status === "open");

      if (!bot) {
        bot = await apiFetch<ChatSession>("/chat/sessions", {
          method: "POST",
          body: JSON.stringify({ title: "Sense bot" }),
        });
      }
      setSessionId(bot.id);
      const history = await apiFetch<ChatMessage[]>(`/chat/history?session_id=${bot.id}`);
      setMessages(history);
    } catch {
      setMessages([]);
      setSessionId(null);
    } finally {
      setBooting(false);
    }
  }, []);

  useEffect(() => {
    if (open) void loadBotSession();
  }, [open, loadBotSession]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (e.target instanceof Node && !root.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open, busy]);

  async function clearHistory() {
    if (busy) return;
    const ok = window.confirm("Smazat historii Sense botu?");
    if (!ok) return;
    setBusy(true);
    try {
      if (sessionId != null) {
        await apiFetch(`/chat/sessions/${sessionId}`, { method: "DELETE" });
      }
      const bot = await apiFetch<ChatSession>("/chat/sessions", {
        method: "POST",
        body: JSON.stringify({ title: "Sense bot" }),
      });
      setSessionId(bot.id);
      setMessages([]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          id: Date.now(),
          role: "assistant",
          content: err instanceof Error ? err.message : "Smazání selhalo",
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function send(message: string) {
    const content = message.trim();
    if (!content || busy) return;
    setBusy(true);
    const optimistic: ChatMessage = {
      id: Date.now(),
      role: "user",
      content,
      created_at: new Date().toISOString(),
      session_id: sessionId,
    };
    setMessages((m) => [...m, optimistic]);
    setText("");
    try {
      const turn = await apiFetch<ChatTurn>("/chat", {
        method: "POST",
        body: JSON.stringify({
          message: content,
          symbol: screen.symbol || null,
          session_id: sessionId,
          screen_context: screenContextText,
          mode: "bot",
        }),
      });
      setSessionId(turn.session.id);
      setMessages((m) => {
        const without = m.filter((x) => x.id !== optimistic.id);
        return [...without, turn.user_message, turn.assistant_message];
      });
    } catch (err) {
      setMessages((m) => [
        ...m.filter((x) => x.id !== optimistic.id),
        optimistic,
        {
          id: Date.now() + 1,
          role: "assistant",
          content: err instanceof Error ? err.message : "Sense bot selhal",
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(text);
  }

  return (
    <div ref={rootRef} className={`sense-bot ${open ? "is-open" : ""}`}>
      {open && (
        <div className="sense-bot__panel card" role="dialog" aria-label="Sense bot">
          <header className="sense-bot__head">
            <div className="sense-bot__brand">
              <Image
                src="/logo-eye-transparent.png"
                alt=""
                width={28}
                height={14}
                className="sense-bot__eye"
              />
              <div>
                <p className="sense-bot__title">sense bot</p>
                <p className="sense-bot__sub muted">
                  {screen.title || screen.page}
                  {screen.symbol ? ` · ${screen.symbol}` : ""}
                </p>
              </div>
            </div>
            <div className="sense-bot__actions">
              <button
                type="button"
                className="sense-bot__icon-btn"
                onClick={() => void clearHistory()}
                disabled={busy || booting}
                title="Smazat historii"
              >
                Smazat
              </button>
              <button
                type="button"
                className="sense-bot__icon-btn"
                onClick={() => setOpen(false)}
                aria-label="Zavřít"
              >
                ✕
              </button>
            </div>
          </header>

          <div className="sense-bot__messages">
            {booting && <p className="muted text-sm px-1">Načítám historii…</p>}
            {!booting && messages.length === 0 && (
              <p className="muted text-sm px-1 leading-relaxed">
                Ahoj — jsem Sense bot. Vidím obrazovku a mám přehled o 24/7 liquidity intel
                (hypotézy, winrate, poslední LLM analýzy). Zeptej se třeba: „co našel intel?“
                nebo „jak si vedou hypotézy?“
              </p>
            )}
            {messages.map((m) => (
              <div
                key={m.id}
                className={`sense-bot__bubble ${m.role === "user" ? "is-user" : "is-bot"}`}
              >
                {m.content}
              </div>
            ))}
            {busy && <p className="muted text-xs px-1">Sense přemýšlí…</p>}
            <div ref={bottomRef} />
          </div>

          <form className="sense-bot__composer" onSubmit={onSubmit}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="např. co našel liquidity intel?"
              disabled={busy}
              aria-label="Zpráva pro Sense bot"
            />
            <button type="submit" className="btn" disabled={busy || !text.trim()}>
              Odeslat
            </button>
          </form>
        </div>
      )}

      <button
        type="button"
        className="sense-bot__fab"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Zavřít Sense bot" : "Otevřít Sense bot"}
      >
        <Image
          src="/logo-eye-transparent.png"
          alt=""
          width={32}
          height={15}
          className="sense-bot__fab-eye"
        />
        <span className="sense-bot__fab-brand">
          <span className="sense-bot__fab-bot">BOT</span>
        </span>
      </button>
    </div>
  );
}
