"use client";

export function SenseBriefing({
  briefingCs,
  briefingTitle,
  briefingAt,
  onGenerateBriefing,
  briefingBusy,
}: {
  briefingCs?: string | null;
  briefingTitle?: string | null;
  briefingAt?: string | null;
  onGenerateBriefing?: () => void;
  briefingBusy?: boolean;
}) {
  return (
    <section className="card p-4 sm:p-5 home-briefing rise">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h1 className="home-chart-title">Sense briefing</h1>
        {onGenerateBriefing && (
          <button
            type="button"
            className="btn btn-primary text-xs px-2 py-1"
            disabled={briefingBusy}
            onClick={onGenerateBriefing}
          >
            {briefingBusy ? "Generuji…" : "Vygenerovat teď"}
          </button>
        )}
      </div>
      {briefingAt && (
        <p className="muted text-xs mb-2">
          Poslední běh: {new Date(briefingAt).toLocaleString("cs-CZ")}
          {briefingTitle ? ` · ${briefingTitle}` : ""}
        </p>
      )}
      {!briefingAt && !briefingCs && (
        <p className="muted text-sm mb-2">
          Zatím žádný denní Sense — vygeneruj teď nebo počkej na cron 8:30.
        </p>
      )}
      {briefingCs ? (
        <p className="home-briefing__text">{briefingCs}</p>
      ) : (
        !briefingBusy && <p className="muted text-sm">Briefing bude tady po úspěšném reportu.</p>
      )}
    </section>
  );
}
