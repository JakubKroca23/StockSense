"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CreditsBar, useCredits } from "@/components/games/CreditsBar";
import { SlotReels } from "@/components/games/SlotReels";
import { SlotSymbol } from "@/components/games/SlotSymbols";
import { awardCredits, spendCredits } from "@/lib/credits";
import { slotAudio } from "@/lib/slotAudio";
import {
  LINES_5X3_10,
  evaluateSpin,
  makeStrips,
  randomStops,
  type SpinResult,
} from "@/lib/slotEngine";

const BETS = [10, 20, 50, 100, 250, 500];
const LINES = 10;
const ROWS = 3;

const WEIGHTS: Record<string, number> = {
  eye: 2,
  seven: 2,
  bell: 3,
  scatter: 2,
  watermelon: 5,
  grapes: 6,
  orange: 7,
  plum: 7,
  cherry: 8,
  lemon: 8,
};

const PAYTABLE: Record<string, number[]> = {
  eye: [0, 0, 0, 40, 120, 400],
  seven: [0, 0, 0, 30, 100, 300],
  bell: [0, 0, 0, 20, 60, 160],
  watermelon: [0, 0, 0, 15, 40, 100],
  grapes: [0, 0, 0, 12, 35, 80],
  orange: [0, 0, 0, 10, 25, 60],
  plum: [0, 0, 0, 10, 25, 60],
  cherry: [0, 0, 0, 8, 20, 50],
  lemon: [0, 0, 0, 8, 20, 50],
};

const SCATTER_PAYS: Record<number, number> = { 3: 2, 4: 10, 5: 50 };

type Meta = { wasFs: boolean; mult: number; fsLeft: number };

export function SenseMeGame() {
  const { balance } = useCredits();
  const [bet, setBet] = useState(50);
  const strips = useMemo(() => makeStrips(WEIGHTS, 5, 36), []);
  const [stops, setStops] = useState(() => randomStops(strips));
  const [targetStops, setTargetStops] = useState<number[] | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [highlight, setHighlight] = useState<boolean[][] | undefined>();
  const [lastWin, setLastWin] = useState(0);
  const [msg, setMsg] = useState("Sense Me — roztoč válce");
  const [freeSpins, setFreeSpins] = useState(0);
  const [fsMult, setFsMult] = useState(1);
  const [muted, setMuted] = useState(false);
  const [flash, setFlash] = useState(false);

  const pendingRef = useRef<SpinResult | null>(null);
  const metaRef = useRef<Meta>({ wasFs: false, mult: 1, fsLeft: 0 });

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
      let nextMult = meta.mult;

      if (result.scatterCount >= 3) {
        const add = result.scatterCount === 3 ? 10 : result.scatterCount === 4 ? 15 : 20;
        nextFs = (meta.wasFs ? meta.fsLeft - 1 : 0) + add;
        nextMult = meta.wasFs ? Math.min(meta.mult + 1, 5) : 1;
        setMsg(
          `Scatter ×${result.scatterCount} → +${add} FS${meta.wasFs ? ` · multi ×${nextMult}` : ""}`
        );
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
              (linesDesc ? ` · ${linesDesc}` : "") +
              (result.scatterWin ? ` · scatter ${result.scatterWin}` : "")
          );
        }
        if (result.totalWin >= bet * 8) slotAudio.winBig();
        else slotAudio.winSmall();
        setFlash(true);
        setTimeout(() => setFlash(false), 450);
      } else if (result.scatterCount < 3) {
        setMsg(meta.wasFs && meta.fsLeft <= 1 ? "Free spins hotovo" : "Bez výhry");
        if (!meta.wasFs) slotAudio.lose();
      }

      setFreeSpins(nextFs);
      setFsMult(nextFs > 0 ? nextMult : 1);
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
    const mult = wasFs ? fsMult : 1;
    const result = evaluateSpin({
      strips,
      stops: nextStops,
      rows: ROWS,
      lines: LINES_5X3_10,
      paytable: PAYTABLE,
      lineBet,
      totalBet: bet,
      wild: "eye",
      scatter: "scatter",
      scatterPays: SCATTER_PAYS,
      winMultiplier: mult,
    });

    metaRef.current = { wasFs, mult, fsLeft: freeSpins };
    pendingRef.current = result;
    setHighlight(undefined);
    setLastWin(0);
    setTargetStops(nextStops);
    setSpinning(true);
    setMsg(wasFs ? `Free spin · ×${mult}` : "Točí se…");
    slotAudio.spinStart();
  }, [spinning, freeSpins, bet, strips, fsMult, lineBet]);

  const onReelStop = useCallback((i: number) => {
    if (i === 0) slotAudio.reelStop();
    else slotAudio.reelTick();
  }, []);

  const onAllStopped = useCallback(() => {
    const result = pendingRef.current;
    if (!result) return;
    settle(result, metaRef.current);
  }, [settle]);

  const betIdx = BETS.indexOf(bet);

  return (
    <div className={`sense-me ${flash ? "is-flash" : ""}`}>
      <div className="game-topbar">
        <Link href="/zabava" className="btn text-xs">
          ← Zábava
        </Link>
        <h1 className="game-title game-title--dazzle">Sense Me</h1>
        <CreditsBar compact />
      </div>
      <p className="game-tagline">5 válců · 10 linií · Wild oko · Scatter hvězda</p>

      <div className="slot-cabinet slot-cabinet--dazzle">
        <div className="slot-cabinet__glow" aria-hidden />
        <SlotReels
          strips={strips}
          stops={stops}
          targetStops={targetStops}
          spinning={spinning}
          highlight={highlight}
          theme="dazzle"
          onReelStop={onReelStop}
          onAllStopped={onAllStopped}
        />
        <div className="slot-payline-hint muted text-xs">
          Výhra zleva doprava po linii · zvýrazněné = výherní symboly
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
          {freeSpins > 0 && (
            <span className="slot-hud__fs">
              FS {freeSpins} · ×{fsMult}
            </span>
          )}
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
        <summary className="cursor-pointer">Paytable (násobek line bet = sázka/10)</summary>
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
          {Object.entries(PAYTABLE).map(([k, v]) => (
            <div key={k} className="flex items-center gap-2 muted">
              <span className="slot-sym slot-sym--mini">
                <SlotSymbol id={k} />
              </span>
              <span>
                3×{v[3]} · 4×{v[4]} · 5×{v[5]}
              </span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
