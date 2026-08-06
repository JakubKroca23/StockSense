"use client";

import { FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { AdvisorReplyCard } from "@/components/AdvisorReplyCard";
import { SymbolAutocomplete } from "@/components/SymbolAutocomplete";
import { ChatMessage, ChatSession, ChatTurn } from "@/lib/types";

function sortSessions(rows: ChatSession[]) {
  return [...rows].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );
}

function SaveIcon({ filled }: { filled?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 3.5h11.2L19.5 6.8V20a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 20V5A1.5 1.5 0 0 1 5 3.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        fill={filled ? "currentColor" : "none"}
        opacity={filled ? 0.22 : 1}
      />
      <path
        d="M7.5 3.5V8.2h7.2V3.5M7.5 20.5v-6.2h9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M9.2 5.8h3.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="muted">Načítám Sense…</div>}>
      <ChatPageInner />
    </Suspense>
  );
}

function ChatPageInner() {
  const searchParams = useSearchParams();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [symbol, setSymbol] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const [showSaved, setShowSaved] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const active = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? null,
    [sessions, activeId]
  );
  const savedSessions = useMemo(
    () => sessions.filter((s) => s.status === "saved"),
    [sessions]
  );
  const saved = active?.status === "saved";

  const refreshSessions = useCallback(async () => {
    const rows = await apiFetch<ChatSession[]>("/chat/sessions");
    setSessions(sortSessions(rows));
    return rows;
  }, []);

  const loadSession = useCallback(async (session: ChatSession) => {
    setActiveId(session.id);
    setSymbol(session.symbol || "");
    setHint(null);
    const history = await apiFetch<ChatMessage[]>(`/chat/history?session_id=${session.id}`);
    setMessages(history);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await apiFetch<ChatSession[]>("/chat/sessions");
        if (cancelled) return;
        setSessions(sortSessions(rows));

        const qSymbol = (searchParams.get("symbol") || "").trim().toUpperCase();
        const fresh = searchParams.get("fresh") === "1";

        if (qSymbol) {
          setSymbol(qSymbol);
          let session: ChatSession | null = null;
          if (fresh) {
            session = await apiFetch<ChatSession>("/chat/sessions", {
              method: "POST",
              body: JSON.stringify({ title: `Sense ${qSymbol}`, symbol: qSymbol }),
            });
          } else {
            session =
              rows.find(
                (s) =>
                  (s.symbol || "").toUpperCase() === qSymbol &&
                  (s.status === "open" || s.status === "saved")
              ) || null;
            if (!session) {
              session = await apiFetch<ChatSession>("/chat/sessions", {
                method: "POST",
                body: JSON.stringify({ title: `Sense ${qSymbol}`, symbol: qSymbol }),
              });
            }
          }
          if (!session || cancelled) return;
          setSessions((prev) =>
            sortSessions([session!, ...prev.filter((s) => s.id !== session!.id)])
          );
          setActiveId(session.id);
          const history = await apiFetch<ChatMessage[]>(`/chat/history?session_id=${session.id}`);
          if (!cancelled) setMessages(history);
        } else {
          const prefer =
            rows.find((s) => s.status === "open") ||
            rows.find((s) => s.status === "saved") ||
            null;
          if (prefer) {
            setActiveId(prefer.id);
            setSymbol(prefer.symbol || "");
            const history = await apiFetch<ChatMessage[]>(
              `/chat/history?session_id=${prefer.id}`
            );
            if (!cancelled) setMessages(history);
          }
        }
      } catch {
        /* empty */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function startNewChat() {
    setBusy(true);
    try {
      const session = await apiFetch<ChatSession>("/chat/sessions", {
        method: "POST",
        body: JSON.stringify({ title: "Nový chat", symbol: symbol || null }),
      });
      setSessions((prev) => sortSessions([session, ...prev.filter((s) => s.id !== session.id)]));
      setActiveId(session.id);
      setMessages([]);
      setHint(null);
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }

  async function saveActive() {
    if (!activeId || !active) return;
    const updated = await apiFetch<ChatSession>(`/chat/sessions/${activeId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: saved ? "open" : "saved" }),
    });
    setSessions((prev) => sortSessions(prev.map((s) => (s.id === activeId ? updated : s))));
    if (!saved) setShowSaved(true);
  }

  async function closeActive() {
    if (!activeId) return;
    const closingId = activeId;
    await apiFetch(`/chat/sessions/${closingId}`, { method: "DELETE" });
    const remaining = (await refreshSessions()).filter((s) => s.id !== closingId);
    const next =
      remaining.find((s) => s.status === "open") ||
      remaining.find((s) => s.status === "saved") ||
      null;
    if (next) {
      await loadSession(next);
    } else {
      setActiveId(null);
      setMessages([]);
      setHint(null);
    }
  }

  async function sendMessage(message: string) {
    const content = message.trim();
    if (!content || busy) return;
    setBusy(true);
    setHint(null);
    const optimistic: ChatMessage = {
      id: Date.now(),
      role: "user",
      content,
      created_at: new Date().toISOString(),
      session_id: activeId,
    };
    setMessages((m) => [...m, optimistic]);
    setText("");
    try {
      const turn = await apiFetch<ChatTurn>("/chat", {
        method: "POST",
        body: JSON.stringify({
          message: content,
          symbol: symbol || null,
          session_id: activeId,
        }),
      });
      setSessions((prev) =>
        sortSessions([turn.session, ...prev.filter((s) => s.id !== turn.session.id)])
      );
      setActiveId(turn.session.id);
      setMessages((m) => {
        const withoutOptimistic = m.filter((x) => x.id !== optimistic.id);
        return [...withoutOptimistic, turn.user_message, turn.assistant_message];
      });
    } catch (err) {
      setMessages((m) => [
        ...m.filter((x) => x.id !== optimistic.id),
        optimistic,
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

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await sendMessage(text);
  }

  const windowTitle = active?.title || "Nový chat";

  return (
    <div className="chat-page">
      <div className="chat-stack space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="advisor-card__eyebrow">Analýzy</p>
          <button
            type="button"
            className={`btn text-xs px-2 py-1 ${showSaved ? "btn-primary" : ""}`}
            onClick={() => setShowSaved((v) => !v)}
          >
            Uložené{savedSessions.length ? ` (${savedSessions.length})` : ""}
          </button>
        </div>

        {showSaved && (
          <section className="card chat-saved-panel p-3 space-y-2">
            <p className="text-xs muted uppercase tracking-wide">Uložené</p>
            {loading && <p className="muted text-sm">Načítám…</p>}
            {!loading && savedSessions.length === 0 && (
              <p className="muted text-sm">Zatím žádné uložené analýzy. Ulož chat diskétou.</p>
            )}
            <div className="chat-saved-grid">
              {savedSessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`chat-session-item ${
                    activeId === s.id ? "chat-session-item--active" : ""
                  }`}
                  onClick={() => void loadSession(s)}
                >
                  <span className="chat-session-item__title">{s.title}</span>
                  {s.symbol && <span className="chat-session-item__meta">{s.symbol}</span>}
                </button>
              ))}
            </div>
          </section>
        )}

        {hint && <p className="text-sm text-[var(--warn)]">{hint}</p>}

        <div className={`chat-window ${messages.length > 0 ? "chat-window--tall" : ""}`}>
          <div className="chat-titlebar">
            <div className="chat-titlebar__left min-w-0">
              <span className="chat-titlebar__title truncate">{windowTitle}</span>
              {active?.symbol && <span className="badge">{active.symbol}</span>}
            </div>
            <div className="chat-titlebar__center">
              <button
                type="button"
                className="btn btn-primary chat-titlebar__new"
                disabled={busy}
                onClick={() => void startNewChat()}
              >
                Nový chat
              </button>
            </div>
            <div className="chat-titlebar__actions">
              <button
                type="button"
                className={`chat-icon-btn chat-icon-btn--save ${saved ? "is-active" : ""}`}
                disabled={busy || !activeId}
                title={saved ? "Odebrat z uložených" : "Uložit"}
                aria-label={saved ? "Odebrat z uložených" : "Uložit"}
                onClick={() => void saveActive()}
              >
                <SaveIcon filled={saved} />
              </button>
              <button
                type="button"
                className="chat-icon-btn chat-icon-btn--close"
                disabled={busy || !activeId}
                title="Zavřít a smazat"
                aria-label="Zavřít a smazat"
                onClick={() => void closeActive()}
              >
                <CloseIcon />
              </button>
            </div>
          </div>

          <div className="chat-window__body space-y-4 overflow-y-auto p-4">
            {messages.length === 0 && (
              <p className="muted text-sm">Napiš otázku k analýze.</p>
            )}

            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="chat-user-bubble rise">
                  {m.content}
                </div>
              ) : (
                <AdvisorReplyCard
                  key={m.id}
                  content={m.content}
                  symbol={symbol || active?.symbol || undefined}
                  createdAt={m.created_at}
                />
              )
            )}

            {busy && <div className="advisor-card p-4 muted text-sm">Připravuji analýzu…</div>}
            <div ref={bottomRef} />
          </div>

          <form
            onSubmit={onSubmit}
            className="chat-window__composer grid gap-2 sm:grid-cols-[180px_1fr_auto] p-3"
          >
            <SymbolAutocomplete value={symbol} onChange={setSymbol} placeholder="Symbol" />
            <input
              className="input"
              placeholder="Napiš otázku…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              required
            />
            <button className="btn btn-primary" disabled={busy}>
              {busy ? "…" : "Odeslat"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
