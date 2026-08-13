"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { GoldVwapChart, MidasAnchor } from "@/components/GoldVwapChart";
import type { ChartBar } from "@/components/PriceChart";
import { useScreenContext } from "@/components/ScreenContext";

type GoldMidasResponse = {
  symbol: string;
  label: string;
  note: string;
  interval: string;
  lookback: string;
  fib_levels: number[];
  bars_count: number;
  anchors_count: number;
  as_of: string;
  price: number | null;
  change_pct_window: number | null;
  ohlcv: ChartBar[];
  anchors: MidasAnchor[];
};

function fmtPrice(n: number | null | undefined) {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function fmtPct(n: number | null | undefined) {
  if (n == null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export default function GoldPage() {
  const { setScreen } = useScreenContext();
  const [data, setData] = useState<GoldMidasResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showMidas, setShowMidas] = useState(true);
  const [showOuter, setShowOuter] = useState(true);
  const [fillOpacity, setFillOpacity] = useState(0.03);
  const [chartExpanded, setChartExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<GoldMidasResponse>("/gold/midas?lookback=7d&max_points=140");
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Načtení zlata selhalo");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setScreen({
      page: "gold",
      title: "Gold — Anchored VWAP Midas",
      symbol: data?.symbol || "GC=F",
      detail: data
        ? `1m × ${data.lookback}, ${data.anchors_count} hodinových kotev VWAP, Fib σ 0.618 / 1.618 / 2.618`
        : "Heatmapa ukotvených VWAP pásem na zlatě",
    });
  }, [setScreen, data]);

  useEffect(() => {
    if (!chartExpanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setChartExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [chartExpanded]);

  const up = (data?.change_pct_window ?? 0) >= 0;

  return (
    <div className="gold-page">
      <header className="gold-page__intro">
        <div>
          <h1 className="gold-page__title">Gold</h1>
          <p className="gold-page__sub muted">
            Custom Anchored VWAP Midas — až 168 hodinových kotev s Fibonacci σ pásmy na 1m svíčkách.
          </p>
        </div>
        <button
          type="button"
          className="chart-chip chart-chip--soft"
          onClick={() => void load()}
          disabled={loading}
          title="Obnovit data"
        >
          {loading ? "Načítám…" : "↻ Obnovit"}
        </button>
      </header>

      {error && (
        <p className="card gold-page__error" role="alert">
          {error}
        </p>
      )}

      <section
        className={`card instrument-chart gold-page__chart ${chartExpanded ? "is-expanded" : ""}`}
      >
        <div className="instrument-chart__bar cryptosense__meta">
          <div className="cryptosense__meta-row cryptosense__meta-row--data">
            <span className="badge">{data?.symbol || "GC=F"}</span>
            <span className="cryptosense__px">{fmtPrice(data?.price)}</span>
            <span className={`cryptosense__chg ${up ? "is-up" : "is-down"}`}>
              {fmtPct(data?.change_pct_window)}
            </span>
            <span className="badge">1m · 7d</span>
            {data && (
              <span className="badge">
                {data.anchors_count} kotev · {data.bars_count} bars
              </span>
            )}
          </div>

          <div className="cryptosense__meta-row cryptosense__meta-row--tools">
            <button
              type="button"
              className={`chart-chip chart-chip--soft ${chartExpanded ? "is-active" : ""}`}
              onClick={() => setChartExpanded((v) => !v)}
              aria-pressed={chartExpanded}
            >
              {chartExpanded ? "Zmenšit" : "Maximalizovat"}
            </button>
            <button
              type="button"
              className={`chart-chip chart-chip--soft ${showMidas ? "is-active" : ""}`}
              onClick={() => setShowMidas((v) => !v)}
              title="Překryv Anchored VWAP Midas"
            >
              Midas
            </button>
            <button
              type="button"
              className={`chart-chip chart-chip--soft ${showOuter ? "is-active" : ""}`}
              onClick={() => setShowOuter((v) => !v)}
              disabled={!showMidas}
              title="Pásma 1.618 / 2.618 σ"
            >
              Outer σ
            </button>
            <label
              className={`cryptosense__heat-opacity ${showMidas ? "is-on" : "is-off"}`}
              title="Průhlednost výplně 0.618"
            >
              <span className="muted">α</span>
              <input
                type="range"
                min={1}
                max={8}
                step={0.5}
                value={fillOpacity * 100}
                onChange={(e) => setFillOpacity(Number(e.target.value) / 100)}
                disabled={!showMidas}
                aria-label="Průhlednost Midas výplně"
              />
            </label>
          </div>
        </div>

        <div className="instrument-chart__stage crypto-chart-stage gold-page__chart-pane">
          {data?.ohlcv?.length ? (
            <GoldVwapChart
              bars={data.ohlcv}
              anchors={data.anchors}
              showMidas={showMidas}
              showOuterBands={showOuter}
              fillOpacity={fillOpacity}
            />
          ) : (
            <div className="muted p-6 text-sm">
              {loading ? "Stahuji 1m zlato a počítám VWAP kotvy…" : "Žádná OHLCV data."}
            </div>
          )}
        </div>
      </section>

      <section className="gold-page__legend card">
        <h2 className="gold-page__legend-title">Jak číst indikátor</h2>
        <ul className="gold-page__legend-list">
          <li>
            <span className="gold-swatch gold-swatch--fill" />
            Vnitřní pásmo ±0.618 σ — modrá výplň (překrývající se kotvy tvoří heatmapu)
          </li>
          <li>
            <span className="gold-swatch gold-swatch--up" />
            Horní ±1.618 / ±2.618 σ — zelené linky
          </li>
          <li>
            <span className="gold-swatch gold-swatch--down" />
            Spodní ±1.618 / ±2.618 σ — červené linky
          </li>
        </ul>
        {data?.note && <p className="muted text-xs gold-page__note">{data.note}</p>}
      </section>
    </div>
  );
}
