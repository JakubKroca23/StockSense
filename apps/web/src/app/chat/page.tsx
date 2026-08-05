"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { AdvisorReplyCard } from "@/components/AdvisorReplyCard";
import { SymbolAutocomplete } from "@/components/SymbolAutocomplete";
import { ChatMessage, ChatSession, ChatSessionStatus, ChatTurn } from "@/lib/types";

type PromptIdea = {
  id: string;
  label: string;
  hint: string;
  needsSymbol?: boolean;
  build: (symbol: string) => string;
};

/** Dotazy laděné na data + strukturovanou odpověď (Shrnutí / Analýza / Pre-závěr / Rizika). */
const PROMPT_IDEAS: PromptIdea[] = [
  {
    id: "pre-zaver",
    label: "Pre-závěr teď",
    hint: "Nejpřesnější basic",
    needsSymbol: true,
    build: (s) =>
      `Na základě dodaných dat pro ${s} uveď aktuální pre-závěr (koupit / prodat / držet / tradovat), score/confidence pokud jsou v kontextu, entry/stop/cíle pokud existují, a 3 konkrétní věci které musím sledovat. Nevymýšlej čísla mimo kontext.`,
  },
  {
    id: "bull-base-bear",
    label: "Bull / base / bear",
    hint: "Scénáře",
    needsSymbol: true,
    build: (s) =>
      `Pro ${s} sestav 3 scénáře bull / base / bear. U každého uveď spouštěč, pravděpodobný vývoj a invalidaci. Opírej se jen o data a tipy v kontextu.`,
  },
  {
    id: "rizika",
    label: "Rizika a invalidace",
    hint: "Risk-first",
    needsSymbol: true,
    build: (s) =>
      `Pro ${s} vypiš klíčová rizika, co by tip/setup zrušilo (invalidace), a jak poznám že se setup kazí. Buď konkrétní a stručný podle kontextu.`,
  },
  {
    id: "horizonty",
    label: "Horizonty",
    hint: "Swing vs long",
    needsSymbol: true,
    build: (s) =>
      `Porovnej ${s} napříč horizonty: intraday / swing / position / long-term. U každého řekni bias, jestli dává smysl obchodovat teď, a proč. Jen z kontextu.`,
  },
  {
    id: "tip-vs-data",
    label: "Tip vs data",
    hint: "Kontrola tipu",
    needsSymbol: true,
    build: (s) =>
      `Pokud je v kontextu aktivní tip pro ${s}, shrň ho a ověř jestli sedí s cenou/fundamenty/data quality. Co souhlasí, co nesedí, co chybí.`,
  },
  {
    id: "makro",
    label: "Makro bias",
    hint: "Bez tickeru OK",
    build: () =>
      `Podle top tipů a dostupného kontextu shrň aktuální tržní bias (risk-on / risk-off), co podporuje a co ohrožuje setupy. Nevymýšlej makro čísla, která nejsou v kontextu.`,
  },
  {
    id: "portfolio-check",
    label: "Kontrola portfolia",
    hint: "Z tipů dne",
    build: () =>
      `Z top tipů v kontextu vyber 3 nejdůležitější akce pro dnešek (co sledovat / kde být opatrný). U každé uveď symbol, akci a důvod z dat.`,
  },
  {
    id: "co-dal",
    label: "Co dál sledovat",
    hint: "Checklist",
    needsSymbol: true,
    build: (s) =>
      `Pro ${s} sestav krátký checklist na příští 24–72h: co má potvrdit long bias, co short bias, a při jakém levelu setup odpadá. Jen z kontextu.`,
  },
];

const STATUS_LABEL: Record<ChatSessionStatus, string> = {
  open: "Otevřené",
  minimized: "Minimalizované",
  saved: "Uložené",
  closed: "Zavřené",
};

function sortSessions(rows: ChatSession[]) {
  return [...rows].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );
}

function PromptChips({
  ideas,
  symbol,
  busy,
  compact,
  onPick,
}: {
  ideas: PromptIdea[];
  symbol: string;
  busy: boolean;
  compact?: boolean;
  onPick: (idea: PromptIdea) => void;
}) {
  return (
    <div className={compact ? "grid gap-1.5" : "grid gap-2 sm:grid-cols-2 lg:grid-cols-4"}>
      {ideas.map((idea) => {
        const locked = Boolean(idea.needsSymbol && !symbol.trim());
        return (
          <button
            key={idea.id}
            type="button"
            disabled={busy}
            onClick={() => onPick(idea)}
            className={`prompt-chip text-left ${compact ? "prompt-chip--compact" : ""} ${
              locked ? "prompt-chip--locked" : ""
            }`}
            title={locked ? "Nejdřív vyber symbol" : idea.label}
          >
            <span className="prompt-chip__label">{idea.label}</span>
            {!compact && (
              <span className="prompt-chip__hint">
                {idea.hint}
                {idea.needsSymbol ? " · potřebuje symbol" : ""}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default function ChatPage() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [symbol, setSymbol] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const ideas = useMemo(() => PROMPT_IDEAS, []);
  const active = useMemo(
    () => sessions.find((s) => s.id === activeId) ?? null,
    [sessions, activeId]
  );
  const minimized = useMemo(
    () => sessions.filter((s) => s.status === "minimized"),
    [sessions]
  );
  const sidebarGroups = useMemo(() => {
    const open = sessions.filter((s) => s.status === "open");
    const saved = sessions.filter((s) => s.status === "saved");
    const closed = showClosed ? sessions.filter((s) => s.status === "closed") : [];
    return [
      { key: "open" as const, title: "Aktivní", items: open },
      { key: "saved" as const, title: "Uložené", items: saved },
      ...(showClosed ? [{ key: "closed" as const, title: "Zavřené", items: closed }] : []),
    ];
  }, [sessions, showClosed]);

  const isMinimizedView = active?.status === "minimized";
  const hasMessages = messages.length > 0;

  const refreshSessions = useCallback(async (includeClosed = showClosed) => {
    const rows = await apiFetch<ChatSession[]>(
      `/chat/sessions${includeClosed ? "?include_closed=true" : ""}`
    );
    setSessions(sortSessions(rows));
    return rows;
  }, [showClosed]);

  const loadSession = useCallback(async (session: ChatSession) => {
    let current = session;
    if (session.status === "closed") {
      current = await apiFetch<ChatSession>(`/chat/sessions/${session.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "open" }),
      });
      setSessions((prev) => sortSessions(prev.map((s) => (s.id === current.id ? current : s))));
    }
    setActiveId(current.id);
    setSymbol(current.symbol || "");
    setHint(null);
    setSaveOpen(false);
    const history = await apiFetch<ChatMessage[]>(`/chat/history?session_id=${current.id}`);
    setMessages(history);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await apiFetch<ChatSession[]>("/chat/sessions");
        if (cancelled) return;
        setSessions(sortSessions(rows));
        const prefer =
          rows.find((s) => s.status === "open") ||
          rows.find((s) => s.status === "minimized") ||
          rows.find((s) => s.status === "saved") ||
          null;
        if (prefer) {
          setActiveId(prefer.id);
          setSymbol(prefer.symbol || "");
          const history = await apiFetch<ChatMessage[]>(`/chat/history?session_id=${prefer.id}`);
          if (!cancelled) setMessages(history);
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
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy, isMinimizedView]);

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
      setSaveOpen(false);
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }

  async function patchSession(
    id: number,
    body: Partial<ChatSession> & { status?: ChatSessionStatus; title?: string; symbol?: string | null }
  ) {
    const updated = await apiFetch<ChatSession>(`/chat/sessions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    setSessions((prev) => sortSessions(prev.map((s) => (s.id === id ? updated : s))));
    return updated;
  }

  async function minimizeActive() {
    if (!activeId) return;
    await patchSession(activeId, { status: "minimized" });
  }

  async function closeActive() {
    if (!activeId) return;
    const closingId = activeId;
    await patchSession(closingId, { status: "closed" });
    const remaining = (await refreshSessions(showClosed)).filter((s) => s.id !== closingId);
    const next =
      remaining.find((s) => s.status === "open") ||
      remaining.find((s) => s.status === "saved") ||
      remaining.find((s) => s.status === "minimized") ||
      null;
    if (next) {
      if (next.status === "minimized") await restoreSession(next);
      else await loadSession(next);
    } else {
      setActiveId(null);
      setMessages([]);
    }
  }

  async function saveActive() {
    if (!activeId) return;
    const title =
      saveTitle.trim() ||
      active?.title ||
      (messages.find((m) => m.role === "user")?.content.slice(0, 64) ?? "Uložený chat");
    await patchSession(activeId, { status: "saved", title });
    setSaveOpen(false);
    setSaveTitle("");
  }

  async function restoreSession(session: ChatSession) {
    const updated = await patchSession(session.id, { status: "open" });
    await loadSession(updated);
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

  function useIdea(idea: PromptIdea) {
    if (idea.needsSymbol && !symbol.trim()) {
      setHint("Nejdřív vyber symbol.");
      return;
    }
    void sendMessage(idea.build(symbol.trim().toUpperCase()));
  }

  async function toggleClosed() {
    const next = !showClosed;
    setShowClosed(next);
    try {
      await refreshSessions(next);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="flex flex-col gap-4 min-h-[70vh]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="display text-3xl">AI rádce</h1>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void startNewChat()}>
          Nový chat
        </button>
      </div>

      <div className="chat-layout">
        <aside className="card chat-sidebar p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="advisor-card__eyebrow">Historie</p>
            <button type="button" className="btn text-xs px-2 py-1" onClick={() => void toggleClosed()}>
              {showClosed ? "Skrýt zavřené" : "Zavřené"}
            </button>
          </div>
          {loading && <p className="muted text-sm">Načítám…</p>}
          {!loading && sessions.filter((s) => s.status !== "minimized").length === 0 && (
            <p className="muted text-sm">Zatím žádné chaty.</p>
          )}
          {sidebarGroups.map((group) =>
            group.items.length === 0 ? null : (
              <div key={group.key} className="space-y-1.5">
                <p className="text-xs muted uppercase tracking-wide">{group.title}</p>
                {group.items.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`chat-session-item ${activeId === s.id ? "chat-session-item--active" : ""}`}
                    onClick={() =>
                      void (s.status === "minimized" ? restoreSession(s) : loadSession(s))
                    }
                  >
                    <span className="chat-session-item__title">{s.title}</span>
                    <span className="chat-session-item__meta">
                      {STATUS_LABEL[s.status]}
                      {s.symbol ? ` · ${s.symbol}` : ""}
                    </span>
                  </button>
                ))}
              </div>
            )
          )}

          {hasMessages && !isMinimizedView && (
            <div className="space-y-2 pt-2 border-t border-[var(--line)]">
              <PromptChips
                ideas={ideas}
                symbol={symbol}
                busy={busy}
                compact
                onPick={useIdea}
              />
              {hint && <p className="text-xs text-[var(--warn)]">{hint}</p>}
            </div>
          )}
        </aside>

        <div className="chat-main space-y-3 min-w-0">
          {active && (
            <div className="card p-3 flex flex-wrap items-center gap-2 justify-between">
              <div className="min-w-0">
                <p className="font-semibold truncate">{active.title}</p>
                <p className="muted text-xs">
                  {STATUS_LABEL[active.status]}
                  {active.symbol ? ` · ${active.symbol}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn"
                  disabled={busy || !activeId}
                  onClick={() => {
                    setSaveTitle(active.title === "Nový chat" ? "" : active.title);
                    setSaveOpen((v) => !v);
                  }}
                >
                  Uložit
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy || !activeId || active.status === "minimized"}
                  onClick={() => void minimizeActive()}
                >
                  Minimalizovat
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy || !activeId}
                  onClick={() => void closeActive()}
                >
                  Zavřít
                </button>
              </div>
            </div>
          )}

          {saveOpen && active && (
            <div className="card p-3 flex flex-wrap gap-2 items-center">
              <input
                className="input flex-1 min-w-[180px]"
                placeholder="Název uloženého chatu"
                value={saveTitle}
                onChange={(e) => setSaveTitle(e.target.value)}
              />
              <button type="button" className="btn btn-primary" onClick={() => void saveActive()}>
                Potvrdit uložení
              </button>
              <button type="button" className="btn" onClick={() => setSaveOpen(false)}>
                Zrušit
              </button>
            </div>
          )}

          {isMinimizedView ? (
            <div className="advisor-card p-5">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => active && void restoreSession(active)}
              >
                Obnovit chat
              </button>
            </div>
          ) : (
            <>
              {!hasMessages && (
                <div className="space-y-2">
                  <PromptChips ideas={ideas} symbol={symbol} busy={busy} onPick={useIdea} />
                  {hint && <p className="text-sm text-[var(--warn)]">{hint}</p>}
                </div>
              )}

              {minimized.length > 0 && (
                <div className="chat-minibar chat-minibar--pills">
                  <div className="chat-minibar__list">
                    {minimized.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className="chat-minibar__chip"
                        onClick={() => void restoreSession(s)}
                        title="Obnovit chat"
                      >
                        <span className="chat-minibar__title">{s.title}</span>
                        {s.symbol && <span className="badge">{s.symbol}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="card flex-1 space-y-4 overflow-y-auto p-4 max-h-[48vh]">
                {messages.length === 0 && (
                  <p className="muted text-sm">Vyber návrh nebo napiš otázku.</p>
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

              <form onSubmit={onSubmit} className="grid gap-2 sm:grid-cols-[180px_1fr_auto]">
                <SymbolAutocomplete value={symbol} onChange={setSymbol} placeholder="Symbol" />
                <input
                  className="input"
                  placeholder="Nebo napiš vlastní otázku…"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  required
                />
                <button className="btn btn-primary" disabled={busy}>
                  {busy ? "…" : "Odeslat"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
