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
  evaluateGrid,
  evaluateSpin,
  makeStrips,
  randomStops,
  type SpinResult,
} from "@/lib/slotEngine";

const BETS = [10, 20, 50, 100, 250, 500];
const LINES = 10;
const ROWS = 3;

const WEIGHTS: Record<string, number> = {
  book: 3,
  explorer: 4,
  ankh: 6,
  scarab: 7,
  A: 10,
  K: 11,
  Q: 12,
  J: 13,
  "10": 14,
};

const PAYTABLE: Record<string, number[]> = {
  book: [0, 0, 0, 20, 200, 2000],
  explorer: [0, 0, 0, 20, 40, 200],
  ankh: [0, 0, 0, 15, 30, 160],
  scarab: [0, 0, 0, 15, 25, 100],
  A: [0, 0, 0, 10, 25, 75],
  K: [0, 0, 0, 5, 20, 50],
  Q: [0, 0, 0, 5, 15, 40],
  J: [0, 0, 0, 5, 15, 25],
  "10": [0, 0, 0, 5, 15, 25],
};

const SCATTER_PAYS: Record<number, number> = { 3: 2, 4: 20, 5: 200 };
const SPECIALS = ["explorer", "ankh", "scarab", "A", "K", "Q", "J", "10"] as const;

function expandGrid(grid: string[][], special: string): string[][] {
  return grid.map((col) => (col.includes(special) ? [special, special, special] : [...col]));
}

type Meta = { wasFs: boolean; special: string | null; fsLeft: number };

export function BookOfSenseGame() {
  const { balance } = useCredits();
  const [bet, setBet] = useState(50);
  const strips = useMemo(() => makeStrips(WEIGHTS, 5, 36), []);
  const [stops, setStops] = useState(() => randomStops(strips));
  const [targetStops, setTargetStops] = useState<number[] | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [highlight, setHighlight] = useState<boolean[][] | undefined>();
  const [lastWin, setLastWin] = useState(0);
  const [msg, setMsg] = useState("Book of Sense — otevři knihu");
  const [freeSpins, setFreeSpins] = useState(0);
  const [special, setSpecial] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [flash, setFlash] = useState(false);
  const [expanding, setExpanding] = useState(false);
  /** Override grid display after expand (stops stay for reel position) */
  const [displayGrid, setDisplayGrid] = useState<string[][] | null>(null);

  const pendingRef = useRef<SpinResult | null>(null);
  const metaRef = useRef<Meta>({ wasFs: false, special: null, fsLeft: 0 });

  useEffect(() => {
    slotAudio.setMuted(muted);
  }, [muted]);

  const lineBet = bet / LINES;
  const inFs = freeSpins > 0;

  const settle = useCallback(
    async (base: SpinResult, meta: Meta) => {
      let result = base;
      setStops(base.stops);
      setTargetStops(null);

      if (meta.wasFs && meta.special) {
        const expanded = expandGrid(base.grid, meta.special);
        if (JSON.stringify(expanded) !== JSON.stringify(base.grid)) {
          setExpanding(true);
          slotAudio.expand();
          setDisplayGrid(expanded);
          await new Promise((r) => setTimeout(r, 650));
          result = evaluateGrid({
            grid: expanded,
            stops: base.stops,
            lines: LINES_5X3_10,
            paytable: PAYTABLE,
            lineBet,
            totalBet: bet,
            wild: "book",
            scatter: "book",
            scatterPays: SCATTER_PAYS,
          });
          setExpanding(false);
        }
      }

      setHighlight(result.highlight);
      setLastWin(result.totalWin);

      let nextFs = meta.wasFs ? meta.fsLeft - 1 : 0;
      let nextSpecial = meta.special;

      if (result.scatterCount >= 3 && !meta.wasFs) {
        nextSpecial = SPECIALS[Math.floor(Math.random() * SPECIALS.length)];
        nextFs = 10;
        setMsg(`10 free spins · expanding: ${nextSpecial}`);
        slotAudio.freeSpin();
        setFlash(true);
        setTimeout(() => setFlash(false), 800);
      } else if (result.scatterCount >= 3 && meta.wasFs) {
        nextFs = meta.fsLeft - 1 + 10;
        setMsg("Retrigger +10 free spins!");
        slotAudio.freeSpin();
      }

      if (result.totalWin > 0) {
        awardCredits(result.totalWin);
        const linesDesc = result.lineWins
          .slice(0, 3)
          .map((w) => `L${w.lineIndex + 1} ${w.count}×${w.symbol}`)
          .join(" · ");
        if (!(result.scatterCount >= 3 && !meta.wasFs)) {
          setMsg(
            `Výhra ${result.totalWin.toLocaleString("cs-CZ")} SC` +
              (linesDesc ? ` · ${linesDesc}` : "")
          );
        }
        if (result.totalWin >= bet * 12) slotAudio.winBig();
        else slotAudio.winSmall();
        setFlash(true);
        setTimeout(() => setFlash(false), 450);
      } else if (result.scatterCount < 3) {
        setMsg(meta.wasFs && meta.fsLeft <= 1 ? "Kniha zavřena" : "Bez výhry");
        if (!meta.wasFs) slotAudio.lose();
      }

      if (nextFs <= 0) nextSpecial = null;
      setFreeSpins(nextFs);
      setSpecial(nextSpecial);
      pendingRef.current = null;
      setSpinning(false);
    },
    [bet, lineBet]
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
      lines: LINES_5X3_10,
      paytable: PAYTABLE,
      lineBet,
      totalBet: bet,
      wild: "book",
      scatter: "book",
      scatterPays: SCATTER_PAYS,
    });

    metaRef.current = { wasFs, special, fsLeft: freeSpins };
    pendingRef.current = result;
    setDisplayGrid(null);
    setHighlight(undefined);
    setLastWin(0);
    setTargetStops(nextStops);
    setSpinning(true);
    setMsg(wasFs ? `Free spin · ${special}` : "Listování…");
    slotAudio.spinStart();
  }, [spinning, freeSpins, bet, strips, lineBet, special]);

  const onReelStop = useCallback((i: number) => {
    if (i === 0) slotAudio.reelStop();
    else slotAudio.reelTick();
  }, []);

  const onAllStopped = useCallback(() => {
    const result = pendingRef.current;
    if (!result) return;
    void settle(result, metaRef.current);
  }, [settle]);

  const betIdx = BETS.indexOf(bet);

  // Optional overlay when expanded — render static cells over reels
  const overlay = displayGrid;

  return (
    <div className={`book-sense ${flash ? "is-flash" : ""} ${expanding ? "is-expanding" : ""}`}>
      <div className="game-topbar">
        <Link href="/zabava" className="btn text-xs">
          ← Zábava
        </Link>
        <h1 className="game-title game-title--book">Book of Sense</h1>
        <CreditsBar compact />
      </div>
      <p className="game-tagline">5 válců · 10 linií · Book = wild + scatter · expanding FS</p>

      <div className="slot-cabinet slot-cabinet--book">
        <div className="slot-cabinet__glow" aria-hidden />
        {special && freeSpins > 0 && (
          <div className="book-special-banner">
            Expanding: <span className="slot-sym slot-sym--mini"><SlotSymbol id={special} /></span> {special}
          </div>
        )}
        <div className="slot-reels-wrap">
          <SlotReels
            strips={strips}
            stops={stops}
            targetStops={targetStops}
            spinning={spinning}
            highlight={overlay ? undefined : highlight}
            theme="book"
            onReelStop={onReelStop}
            onAllStopped={onAllStopped}
          />
          {overlay && (
            <div className="slot-expand-overlay" aria-hidden>
              {overlay.map((col, ri) => (
                <div key={ri} className="slot-expand-overlay__col">
                  {col.map((sym, row) => (
                    <div
                      key={`${ri}-${row}`}
                      className={`slot-cell ${highlight?.[ri]?.[row] ? "is-win" : ""} is-expand`}
                      style={{ height: 76 }}
                    >
                      <SlotSymbol id={sym} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="slot-payline-hint muted text-xs">
          Book platí jako wild i scatter · 3+ knihy spouští free spins
        </div>
      </div>

      <div className="slot-hud">
        <div className="slot-hud__msg">{msg}</div>
        <div className="slot-hud__stats">
          <span>
            Sázka <strong className="tabular-nums">{bet}</strong> SC
          </span>
          <span>
            Výhra <strong className="tabular-nums text-[var(--warn)]">{lastWin}</strong>
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
          <button type="button" className="slot-spin slot-spin--book" disabled={spinning} onClick={spin}>
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
        <summary className="cursor-pointer">Paytable</summary>
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
