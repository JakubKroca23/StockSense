"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { DataQualityBadge } from "@/components/DataQualityBadge";
import { Report, actionLabel, horizonLabel } from "@/lib/types";

type TipCard = {
  symbol: string;
  name?: string;
  action: string;
  horizon?: string;
  score: number;
  confidence?: number;
  stop?: number | null;
  target_1?: number | null;
  entry_low?: number | null;
  entry_high?: number | null;
  narrative?: string;
  data_quality?: string;
};

type MacroPoint = { series_id: string; name: string; value: number };
type PortfolioCard = {
  symbol: string;
  qty: number;
  avg_cost: number;
  is_paper?: boolean;
  asset_class?: string;
};

function parseSections(md: string): { title: string; body: string }[] {
  const text = (md || "").replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  const parts = text.split(/\n(?=##\s+)/);
  const sections: { title: string; body: string }[] = [];
  for (const part of parts) {
    const lines = part.trim().split("\n");
    const first = lines[0]?.trim() || "";
    if (first.startsWith("## ")) {
      sections.push({
        title: first.replace(/^##\s+/, "").replace(/^\d+[.)]\s*/, ""),
        body: lines.slice(1).join("\n").trim(),
      });
    } else if (!sections.length) {
      sections.push({ title: "Sense shrnutí", body: part.trim() });
    } else {
      sections[sections.length - 1].body += "\n\n" + part.trim();
    }
  }
  return sections.filter((s) => s.body || s.title);
}

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

function SectionBody({ body }: { body: string }) {
  const lines = body.split("\n");
  const nodes: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (!list.length) return;
    nodes.push(
      <ul key={`ul-${nodes.length}`} className="report-prose__list">
        {list.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ul>
    );
    list = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (/^[-*•]\s+/.test(line)) {
      list.push(line.replace(/^[-*•]\s+/, ""));
      continue;
    }
    flush();
    nodes.push(
      <p key={`p-${nodes.length}`} className="report-prose__p">
        {renderInline(line)}
      </p>
    );
  }
  flush();
  return <>{nodes}</>;
}

function ActionBars({ byAction }: { byAction: Record<string, number> }) {
  const entries = Object.entries(byAction);
  const max = Math.max(1, ...entries.map(([, n]) => n));
  const color: Record<string, string> = {
    long: "var(--ok)",
    short: "var(--danger)",
    hold: "var(--warn)",
    sell: "var(--accent-2)",
  };
  if (!entries.length) return <p className="muted text-sm">Žádné aktivní tipy.</p>;
  return (
    <div className="report-bars">
      {entries.map(([action, count]) => (
        <div key={action} className="report-bars__row">
          <span className="report-bars__label">
            {actionLabel[action as keyof typeof actionLabel] || action}
          </span>
          <div className="report-bars__track">
            <div
              className="report-bars__fill"
              style={{
                width: `${(count / max) * 100}%`,
                background: color[action] || "var(--accent)",
              }}
            />
          </div>
          <span className="report-bars__val">{count}</span>
        </div>
      ))}
    </div>
  );
}

function ScoreRing({ score, label }: { score: number; label: string }) {
  const clamped = Math.max(-100, Math.min(100, score));
  const pct = (clamped + 100) / 200;
  const r = 36;
  const c = 2 * Math.PI * r;
  const up = score >= 0;
  return (
    <div className="report-ring">
      <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden>
        <circle cx="48" cy="48" r={r} fill="none" stroke="var(--line)" strokeWidth="8" opacity="0.5" />
        <circle
          cx="48"
          cy="48"
          r={r}
          fill="none"
          stroke={up ? "var(--ok)" : "var(--danger)"}
          strokeWidth="8"
          strokeDasharray={`${pct * c} ${c}`}
          strokeLinecap="round"
          transform="rotate(-90 48 48)"
        />
      </svg>
      <div className="report-ring__center">
        <strong className={up ? "is-up" : "is-down"}>{score.toFixed(0)}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

export function DailyReportView({ report }: { report: Report }) {
  const meta = report.meta || {};
  const tipCount = Number(meta.tip_count || 0);
  const positionCount = Number(meta.position_count || 0);
  const avgScore = Number(meta.avg_score || 0);
  const avgConf = Number(meta.avg_confidence || 0);
  const byAction = (meta.by_action || {}) as Record<string, number>;
  const tips = (meta.tips || []) as TipCard[];
  const macro = (meta.macro || []) as MacroPoint[];
  const portfolio = (meta.portfolio || []) as PortfolioCard[];
  const focus = (meta.focus_symbols || []) as string[];
  const briefing = String(meta.briefing_cs || "");
  const sections = parseSections(report.content_md);

  return (
    <article className="report-page rise">
      <header className="report-hero">
        <div className="report-hero__glow" aria-hidden />
        <div className="report-hero__top">
          <span className="badge">Sense denní</span>
          <time className="muted text-xs">
            {new Date(report.created_at).toLocaleString("cs-CZ")}
          </time>
        </div>
        <h2 className="report-hero__title">{report.title}</h2>
        {briefing && <p className="report-hero__lead">{briefing}</p>}
        {focus.length > 0 && (
          <div className="report-hero__focus">
            Fokus:{" "}
            {focus.map((s) => (
              <Link key={s} href={`/instrument/${s}`} className="badge">
                {s}
              </Link>
            ))}
          </div>
        )}
      </header>

      <div className="report-kpi">
        <div className="report-kpi__card">
          <span className="report-kpi__label">Aktivní tipy</span>
          <strong className="report-kpi__value">{tipCount}</strong>
        </div>
        <div className="report-kpi__card">
          <span className="report-kpi__label">Pozice</span>
          <strong className="report-kpi__value">{positionCount}</strong>
        </div>
        <div className="report-kpi__card report-kpi__card--ring">
          <ScoreRing score={avgScore} label="avg score" />
        </div>
        <div className="report-kpi__card">
          <span className="report-kpi__label">Avg confidence</span>
          <strong className="report-kpi__value">{(avgConf * 100).toFixed(0)}%</strong>
        </div>
      </div>

      <div className="report-grid">
        <section className="report-panel">
          <h3 className="report-panel__title">Skladba tipů</h3>
          <ActionBars byAction={byAction} />
        </section>

        <section className="report-panel">
          <h3 className="report-panel__title">Makro snapshot</h3>
          {macro.length === 0 ? (
            <p className="muted text-sm">Bez makro dat.</p>
          ) : (
            <div className="report-macro">
              {macro.map((m) => (
                <div key={m.series_id} className="report-macro__item">
                  <span className="report-macro__name">{m.name}</span>
                  <strong className="report-macro__val">
                    {typeof m.value === "number" ? m.value.toLocaleString("cs-CZ") : m.value}
                  </strong>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {tips.length > 0 && (
        <section className="report-panel">
          <h3 className="report-panel__title">Top tipy ke sledování</h3>
          <div className="report-tips">
            {tips.map((t) => (
              <Link
                key={`${t.symbol}-${t.score}`}
                href={`/instrument/${t.symbol}`}
                className="report-tip"
              >
                <div className="report-tip__head">
                  <div>
                    <strong>{t.symbol}</strong>
                    <span className={`badge ${t.action}`}>
                      {actionLabel[t.action as keyof typeof actionLabel] || t.action}
                    </span>
                    {t.horizon && (
                      <span className="badge">
                        {horizonLabel[t.horizon as keyof typeof horizonLabel] || t.horizon}
                      </span>
                    )}
                  </div>
                  <div className="report-tip__score">
                    <span>{t.score.toFixed(0)}</span>
                    <small>score</small>
                  </div>
                </div>
                {t.narrative && <p className="report-tip__text">{t.narrative}</p>}
                <div className="report-tip__meta">
                  <span>
                    Entry {t.entry_low?.toFixed?.(2) ?? "—"}–{t.entry_high?.toFixed?.(2) ?? "—"}
                  </span>
                  <span>Stop {t.stop?.toFixed?.(2) ?? "—"}</span>
                  <span>TP {t.target_1?.toFixed?.(2) ?? "—"}</span>
                  {t.data_quality && <DataQualityBadge quality={t.data_quality} compact />}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {portfolio.length > 0 && (
        <section className="report-panel">
          <h3 className="report-panel__title">Portfolio přehled</h3>
          <div className="report-portfolio">
            {portfolio.map((p) => (
              <Link key={p.symbol} href={`/instrument/${p.symbol}`} className="report-pos">
                <strong>{p.symbol}</strong>
                <span className="muted text-xs">
                  {p.qty} @ {p.avg_cost}
                  {p.is_paper ? " · paper" : ""}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {sections.length > 0 && (
        <section className="report-panel report-panel--prose">
          <h3 className="report-panel__title">Sense narativ</h3>
          <div className="report-sections">
            {sections.map((s) => (
              <div key={s.title} className="report-section">
                <h4 className="report-section__title">{s.title}</h4>
                <SectionBody body={s.body} />
              </div>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
