"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CreditsBar, useCredits } from "@/components/games/CreditsBar";
import { SlotReels } from "@/components/games/SlotReels";
import { SlotSymbol } from "@/components/games/SlotSymbols";
import { awardCredits, spendCredits } from "@/lib/credits";
import { slotAudio } from "@/lib/slotAudio";
import {
  LINES_3X3_5,
  evaluateSpin,
  makeStrips,
  randomStops,
  type SpinResult,
} from "@/lib/slotEngine";

/** Classic Joker 27 / Kris Kros style — 3 válce, 5 linií */
const BETS = [10, 20, 50, 100, 200, 500];
const LINES = 5;
const ROWS = 3;
const REELS = 3;

const WEIGHTS: Record<string, number> = {
  joker: 2,
  kriskros: 2,
  seven: 3,
  bar: 4,
  bell: 5,
  watermelon: 6,
  grapes: 7,
  orange: 8,
  plum: 8,
  cherry: 9,
  lemon: 9,
};

/** paytable[symbol][count] × lineBet — classic 3-of-kind (index 3) */
const PAYTABLE: Record<string, number[]> = {
  joker: [0, 0, 0, 100],
  seven: [0, 0, 0, 80],
  bar: [0, 0, 0, 40],
  bell: [0, 0, 0, 30],
  watermelon: [0, 0, 0, 24],
  grapes: [0, 0, 0, 20],
  orange: [0, 0, 0, 16],
  plum: [0, 0, 0, 16],
  cherry: [0, 0, 8, 12], // 2× cherry also pays
  lemon: [0, 0, 0, 12],
};

/** 3× Kris Kros anywhere → free spins / scatter pay (× total bet) */
const SCATTER_PAYS: Record<number, number> = { 3: 5 };

type Meta = { wasFs: boolean; fsLeft: number };

export function SenseMeGame() {
  const { balance } = useCredits();
  const [bet, setBet] = useState(50);
  const strips = useMemo(() => makeStrips(WEIGHTS, REELS, 24), []);
  const [stops, setStops] = useState(() => randomStops(strips));
  const [targetStops, setTargetStops] = useState<number[] | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [highlight, setHighlight] = useState<boolean[][] | undefined>();
  const [lastWin, setLastWin] = useState(0);
  const [msg, setMsg] = useState("Sense Me — Joker 27 / Kris Kros");
  const [freeSpins, setFreeSpins] = useState(0);
  const [muted, setMuted] = useState(false);
  const [flash, setFlash] = useState(false);

  const pendingRef = useRef<SpinResult | null>(null);
  const metaRef = useRef<Meta>({ wasFs: false, fsLeft: 0 });

  useEffect(() => {
    slotAudio.setMuted(muted);
  }, [muted]);

  const lineBet = bet / LINES;
  const inFs = freeSpins > 0;

  const settle = useCallback(
    (result: SpinResult, meta: Meta) => {
      setStops(result.stops);
      setTargetStops(null);
      setHighlight(result.highlight);
      setLastWin(result.totalWin);

      let nextFs = meta.wasFs ? meta.fsLeft - 1 : 0;

      if (result.scatterCount >= 3) {
        nextFs = (meta.wasFs ? meta.fsLeft - 1 : 0) + 7;
        setMsg(`KRIS KROS ×3 → +7 free spins!`);
        slotAudio.freeSpin();
        setFlash(true);
        setTimeout(() => setFlash(false), 700);
      }

      if (result.totalWin > 0) {
        awardCredits(result.totalWin);
        const linesDesc = result.lineWins
          .slice(0, 3)
          .map((w) => `L${w.lineIndex + 1} ${w.count}×${w.symbol}`)
          .join(" · ");
        if (result.scatterCount < 3) {
          setMsg(
            `Výhra ${result.totalWin.toLocaleString("cs-CZ")} SC` +
              (linesDesc ? ` · ${linesDesc}` : "")
          );
        }
        if (result.totalWin >= bet * 10) slotAudio.winBig();
        else slotAudio.winSmall();
        setFlash(true);
        setTimeout(() => setFlash(false), 450);
      } else if (result.scatterCount < 3) {
        setMsg(meta.wasFs && meta.fsLeft <= 1 ? "Free spins hotovo" : "Bez výhry");
        if (!meta.wasFs) slotAudio.lose();
      }

      setFreeSpins(nextFs);
      pendingRef.current = null;
      setSpinning(false);
    },
    [bet]
  );

  const spin = useCallback(() => {
    if (spinning) return;
    const wasFs = freeSpins > 0;
    if (!wasFs && !spendCredits(bet)) {
      setMsg("Nedostatek Sense Coins — doplň menu");
      slotAudio.lose();
      return;
    }

    const nextStops = randomStops(strips);
    const result = evaluateSpin({
      strips,
      stops: nextStops,
      rows: ROWS,
      lines: LINES_3X3_5,
      paytable: PAYTABLE,
      lineBet,
      totalBet: bet,
      wild: "joker",
      scatter: "kriskros",
      scatterPays: SCATTER_PAYS,
    });

    metaRef.current = { wasFs, fsLeft: freeSpins };
    pendingRef.current = result;
    setHighlight(undefined);
    setLastWin(0);
    setTargetStops(nextStops);
    setSpinning(true);
    setMsg(wasFs ? `Free spin (${freeSpins})` : "Točí se…");
    slotAudio.spinStart();
  }, [spinning, freeSpins, bet, strips, lineBet]);

  const onReelStop = useCallback((i: number) => {
    slotAudio.reelStop();
    if (i > 0) slotAudio.reelTick();
  }, []);

  const onAllStopped = useCallback(() => {
    const result = pendingRef.current;
    if (!result) return;
    settle(result, metaRef.current);
  }, [settle]);

  const betIdx = BETS.indexOf(bet);

  return (
    <div className={`sense-me sense-me--joker ${flash ? "is-flash" : ""}`}>
      <div className="game-topbar">
        <Link href="/zabava" className="btn text-xs">
          ← Zábava
        </Link>
        <h1 className="game-title game-title--dazzle">Sense Me</h1>
        <CreditsBar compact />
      </div>
      <p className="game-tagline">Klasika Joker 27 · Kris Kros · 3 válce · 5 linií</p>

      <div className="slot-cabinet slot-cabinet--dazzle slot-cabinet--joker">
        <div className="slot-cabinet__glow" aria-hidden />
        <div className="joker-badge" aria-hidden>
          JOKER 27
        </div>
        <SlotReels
          strips={strips}
          stops={stops}
          targetStops={targetStops}
          spinning={spinning}
          highlight={highlight}
          theme="joker"
          onReelStop={onReelStop}
          onAllStopped={onAllStopped}
        />
        <div className="slot-payline-hint muted text-xs">
          Joker = wild · 3× Kris Kros = free spins · výhra zleva po linii
        </div>
      </div>

      <div className="slot-hud">
        <div className="slot-hud__msg">{msg}</div>
        <div className="slot-hud__stats">
          <span>
            Sázka <strong className="tabular-nums">{bet}</strong> SC
          </span>
          <span>
            Výhra <strong className="tabular-nums text-[var(--sense)]">{lastWin}</strong>
          </span>
          {freeSpins > 0 && <span className="slot-hud__fs">FS {freeSpins}</span>}
          <span className="muted tabular-nums">{balance.toLocaleString("cs-CZ")} SC</span>
        </div>
        <div className="slot-controls">
          <button
            type="button"
            className="btn"
            disabled={spinning || betIdx <= 0 || inFs}
            onClick={() => {
              slotAudio.click();
              setBet(BETS[Math.max(0, betIdx - 1)]);
            }}
          >
            −
          </button>
          <button type="button" className="slot-spin slot-spin--dazzle" disabled={spinning} onClick={spin}>
            {spinning ? "…" : freeSpins > 0 ? "FREE" : "SPIN"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={spinning || betIdx >= BETS.length - 1 || inFs}
            onClick={() => {
              slotAudio.click();
              setBet(BETS[Math.min(BETS.length - 1, betIdx + 1)]);
            }}
          >
            +
          </button>
          <button
            type="button"
            className="btn text-xs"
            onClick={() => {
              setMuted((m) => !m);
              slotAudio.click();
            }}
          >
            {muted ? "Zvuk off" : "Zvuk"}
          </button>
        </div>
      </div>

      <details className="slot-paytable card p-3 text-sm">
        <summary className="cursor-pointer">Paytable (× line bet = sázka/5)</summary>
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
          {Object.entries(PAYTABLE).map(([k, v]) => (
            <div key={k} className="flex items-center gap-2 muted">
              <span className="slot-sym slot-sym--mini">
                <SlotSymbol id={k} />
              </span>
              <span>
                {v[2] ? `2×${v[2]} · ` : ""}3×{v[3]}
              </span>
            </div>
          ))}
          <div className="flex items-center gap-2 muted col-span-2">
            <span className="slot-sym slot-sym--mini">
              <SlotSymbol id="kriskros" />
            </span>
            <span>3× kdekoli = 5× sázka + 7 free spins</span>
          </div>
        </div>
      </details>
    </div>
  );
}
