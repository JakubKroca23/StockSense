"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CreditsBar, useCredits } from "@/components/games/CreditsBar";
import { SlotReels } from "@/components/games/SlotReels";
import { awardCredits, spendCredits } from "@/lib/credits";
import { slotAudio } from "@/lib/slotAudio";
import {
  CLASSIC_10_LINES,
  countScatters,
  evalLine,
  sleep,
  weightedPick,
} from "@/lib/slotMath";

const BETS = [10, 20, 50, 100, 250, 500];

const SYMBOLS = ["book", "explorer", "ankh", "scarab", "A", "K", "Q", "J", "10"] as const;
type Sym = (typeof SYMBOLS)[number];

const WEIGHTS: Record<Sym, number> = {
  book: 3,
  explorer: 5,
  ankh: 8,
  scarab: 9,
  A: 13,
  K: 14,
  Q: 15,
  J: 16,
  "10": 17,
};

const PAYS: Record<string, number[]> = {
  book: [0, 0, 20, 200, 2000],
  explorer: [0, 0, 20, 40, 200],
  ankh: [0, 0, 15, 30, 160],
  scarab: [0, 0, 15, 25, 100],
  A: [0, 0, 10, 25, 75],
  K: [0, 0, 5, 20, 50],
  Q: [0, 0, 5, 15, 40],
  J: [0, 0, 5, 15, 25],
  "10": [0, 0, 5, 15, 25],
};

const SPECIALS: Sym[] = ["explorer", "ankh", "scarab", "A", "K", "Q", "J", "10"];
const BOOK = "book";

function randomGrid(): string[][] {
  return Array.from({ length: 5 }, () =>
    Array.from({ length: 3 }, () => weightedPick(WEIGHTS))
  );
}

function SymbolGlyph({ id, size }: { id: string; size: "sm" | "md" }) {
  const map: Record<string, string> = {
    book: "B",
    explorer: "◎",
    ankh: "†",
    scarab: "◆",
    A: "A",
    K: "K",
    Q: "Q",
    J: "J",
    "10": "10",
  };
  return (
    <span className={`slot-glyph slot-glyph--book-${id} slot-glyph--${size}`} data-sym={id}>
      <span className="slot-glyph__face">{map[id] || id}</span>
    </span>
  );
}

function expandSymbol(grid: string[][], special: string): string[][] {
  const has = grid.some((col) => col.includes(special));
  if (!has) return grid;
  return grid.map((col) => (col.includes(special) ? [special, special, special] : [...col]));
}

export function BookOfSenseGame() {
  const { balance } = useCredits();
  const [bet, setBet] = useState(50);
  const [grid, setGrid] = useState<string[][]>(() => randomGrid());
  const [spinning, setSpinning] = useState(false);
  const [lastWin, setLastWin] = useState(0);
  const [msg, setMsg] = useState("Book of Sense — otevři knihu");
  const [freeSpins, setFreeSpins] = useState(0);
  const [special, setSpecial] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<boolean[][] | undefined>();
  const [muted, setMuted] = useState(false);
  const [expanding, setExpanding] = useState(false);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    slotAudio.setMuted(muted);
  }, [muted]);

  const lineBet = bet / 10;

  const evaluate = useCallback(
    (g: string[][]) => {
      let total = 0;
      const hl = Array.from({ length: 5 }, () => [false, false, false]);
      for (const line of CLASSIC_10_LINES) {
        const hit = evalLine(g, line, BOOK, PAYS);
        if (!hit) continue;
        total += hit.winMult * lineBet;
        line.forEach((row, reel) => {
          if (reel < hit.count) hl[reel][row] = true;
        });
      }
      const sc = countScatters(g, BOOK);
      if (sc >= 3) {
        total += lineBet * (sc === 3 ? 20 : sc === 4 ? 200 : 2000);
      }
      return { total: Math.floor(total), hl, scatters: sc };
    },
    [lineBet]
  );

  const spin = useCallback(async () => {
    if (spinning) return;
    const inFs = freeSpins > 0;
    if (!inFs) {
      const spent = spendCredits(bet);
      if (!spent) {
        setMsg("Nedostatek Sense Coins — doplň menu");
        slotAudio.lose();
        return;
      }
    } else {
      setFreeSpins((n) => n - 1);
    }

    setSpinning(true);
    setHighlight(undefined);
    setLastWin(0);
    setExpanding(false);
    setMsg(inFs ? `Free spin · special ${special}` : "Listování…");
    slotAudio.spinStart();

    const tick = window.setInterval(() => slotAudio.reelTick(), 95);
    await sleep(1500 + Math.random() * 500);
    window.clearInterval(tick);

    let next = randomGrid();
    setGrid(next);
    setSpinning(false);
    slotAudio.reelStop();

    // Expanding special during free spins
    if (inFs && special) {
      const before = next.map((c) => [...c]);
      next = expandSymbol(before, special);
      if (JSON.stringify(before) !== JSON.stringify(next)) {
        setExpanding(true);
        slotAudio.expand();
        await sleep(550);
        setGrid(next);
        await sleep(350);
        setExpanding(false);
      }
    }

    const { total, hl, scatters } = evaluate(next);
    setHighlight(hl);

    if (scatters >= 3 && !inFs) {
      const chosen = SPECIALS[Math.floor(Math.random() * SPECIALS.length)];
      setSpecial(chosen);
      setFreeSpins(10);
      setMsg(`10 free spins · expanding: ${chosen}`);
      slotAudio.freeSpin();
      setFlash(true);
      setTimeout(() => setFlash(false), 800);
    } else if (scatters >= 3 && inFs) {
      setFreeSpins((n) => n + 10);
      setMsg("Retrigger +10 free spins!");
      slotAudio.freeSpin();
    }

    if (total > 0) {
      awardCredits(total);
      setLastWin(total);
      setMsg(
        total >= bet * 15
          ? `Epická výhra ${total.toLocaleString("cs-CZ")} SC!`
          : `Výhra ${total.toLocaleString("cs-CZ")} SC`
      );
      if (total >= bet * 15) slotAudio.winBig();
      else slotAudio.winSmall();
      setFlash(true);
      setTimeout(() => setFlash(false), 500);
    } else if (scatters < 3) {
      setMsg(inFs && freeSpins <= 1 ? "Kniha zavřena" : "Bez výhry");
      if (!inFs) slotAudio.lose();
    }

    if (inFs && freeSpins <= 1 && scatters < 3) {
      setSpecial(null);
    }
  }, [spinning, freeSpins, bet, special, evaluate]);

  const betIdx = BETS.indexOf(bet);

  return (
    <div className={`book-sense ${flash ? "is-flash" : ""} ${expanding ? "is-expanding" : ""}`}>
      <div className="game-topbar">
        <Link href="/zabava" className="btn text-xs">
          ← Zábava
        </Link>
        <h1 className="game-title game-title--book">Book of Sense</h1>
        <CreditsBar compact />
      </div>

      <p className="game-tagline">Kniha Sense · expanding special · 5×3 · 10 linií</p>

      <div className="slot-cabinet slot-cabinet--book">
        <div className="slot-cabinet__glow" aria-hidden />
        {special && freeSpins > 0 && (
          <div className="book-special-banner">
            Expanding: <SymbolGlyph id={special} size="sm" /> {special}
          </div>
        )}
        <SlotReels
          grid={grid}
          spinning={spinning}
          theme="book"
          highlight={highlight}
          renderSymbol={(id, opts) => <SymbolGlyph id={id} size={opts.size} />}
        />
        <div className="slot-payline-hint muted text-xs">
          Book (B) = Wild + Scatter · 3+ = free spins
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
            disabled={spinning || betIdx <= 0}
            onClick={() => {
              slotAudio.click();
              setBet(BETS[Math.max(0, betIdx - 1)]);
            }}
          >
            −
          </button>
          <button
            type="button"
            className="slot-spin slot-spin--book"
            disabled={spinning}
            onClick={() => void spin()}
          >
            {spinning ? "…" : freeSpins > 0 ? "FREE" : "SPIN"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={spinning || betIdx >= BETS.length - 1}
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
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs muted">
          {Object.entries(PAYS).map(([k, v]) => (
            <div key={k} className="flex items-center gap-2">
              <SymbolGlyph id={k} size="sm" />
              <span>
                3×{v[2]} · 4×{v[3]} · 5×{v[4]}
              </span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
