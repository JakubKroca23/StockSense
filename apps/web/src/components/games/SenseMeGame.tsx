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

/** Dazzle Me–inspired gem cascade feel — Sense green dazzle */
const SYMBOLS = ["eye", "gemG", "gemB", "gemP", "star", "A", "K", "Q", "J", "scatter"] as const;
type Sym = (typeof SYMBOLS)[number];

const WEIGHTS: Record<Sym, number> = {
  eye: 4,
  gemG: 8,
  gemB: 9,
  gemP: 9,
  star: 10,
  A: 14,
  K: 14,
  Q: 15,
  J: 16,
  scatter: 3,
};

/** pays for 3 / 4 / 5 of a kind (index 2,3,4) — per line × bet/10 */
const PAYS: Record<string, number[]> = {
  eye: [0, 0, 25, 80, 250],
  gemG: [0, 0, 15, 50, 150],
  gemB: [0, 0, 12, 40, 120],
  gemP: [0, 0, 12, 40, 120],
  star: [0, 0, 10, 30, 90],
  A: [0, 0, 8, 20, 60],
  K: [0, 0, 6, 18, 50],
  Q: [0, 0, 5, 15, 40],
  J: [0, 0, 5, 12, 35],
};

const WILD = "eye";
const SCATTER = "scatter";

function randomGrid(): string[][] {
  return Array.from({ length: 5 }, () =>
    Array.from({ length: 3 }, () => weightedPick(WEIGHTS))
  );
}

function SymbolGlyph({ id, size }: { id: string; size: "sm" | "md" }) {
  const cls = `slot-glyph slot-glyph--${id} slot-glyph--${size}`;
  const label: Record<string, string> = {
    eye: "◎",
    gemG: "◆",
    gemB: "◈",
    gemP: "◇",
    star: "✦",
    A: "A",
    K: "K",
    Q: "Q",
    J: "J",
    scatter: "✧",
  };
  return (
    <span className={cls} data-sym={id}>
      <span className="slot-glyph__face">{label[id] || id}</span>
    </span>
  );
}

export function SenseMeGame() {
  const { balance } = useCredits();
  const [bet, setBet] = useState(50);
  const [grid, setGrid] = useState<string[][]>(() => randomGrid());
  const [spinning, setSpinning] = useState(false);
  const [lastWin, setLastWin] = useState(0);
  const [msg, setMsg] = useState("Sense Me — roztoč reels");
  const [freeSpins, setFreeSpins] = useState(0);
  const [fsMult, setFsMult] = useState(1);
  const [highlight, setHighlight] = useState<boolean[][] | undefined>();
  const [muted, setMuted] = useState(false);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    slotAudio.setMuted(muted);
  }, [muted]);

  const lineBet = bet / 10;

  const evaluate = useCallback(
    (g: string[][], inFs: boolean, mult: number) => {
      let total = 0;
      const hl = Array.from({ length: 5 }, () => [false, false, false]);
      for (const line of CLASSIC_10_LINES) {
        const hit = evalLine(g, line, WILD, PAYS);
        if (!hit) continue;
        total += hit.winMult * lineBet * (inFs ? mult : 1);
        line.forEach((row, reel) => {
          if (reel < hit.count) hl[reel][row] = true;
        });
      }
      const sc = countScatters(g, SCATTER);
      if (sc >= 3) {
        total += lineBet * (sc === 3 ? 20 : sc === 4 ? 80 : 200) * (inFs ? mult : 1);
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
    setMsg(inFs ? `Free spin · ×${fsMult}` : "Točí se…");
    slotAudio.spinStart();

    const tick = window.setInterval(() => slotAudio.reelTick(), 90);
    await sleep(1400 + Math.random() * 600);
    window.clearInterval(tick);

    const next = randomGrid();
    setGrid(next);
    setSpinning(false);
    slotAudio.reelStop();

    const { total, hl, scatters } = evaluate(next, inFs, fsMult);
    setHighlight(hl);

    if (scatters >= 3) {
      const add = scatters === 3 ? 10 : scatters === 4 ? 15 : 20;
      const nextMult = inFs ? Math.min(fsMult + 1, 5) : 1;
      setFreeSpins((n) => n + add);
      setFsMult(nextMult);
      setMsg(`Free spins +${add}${inFs ? ` · multi ×${nextMult}` : ""}!`);
      slotAudio.freeSpin();
      setFlash(true);
      setTimeout(() => setFlash(false), 700);
    }

    if (total > 0) {
      awardCredits(total);
      setLastWin(total);
      setMsg(total >= bet * 10 ? `Velká výhra ${total.toLocaleString("cs-CZ")} SC!` : `Výhra ${total.toLocaleString("cs-CZ")} SC`);
      if (total >= bet * 10) slotAudio.winBig();
      else slotAudio.winSmall();
      setFlash(true);
      setTimeout(() => setFlash(false), 500);
    } else if (scatters < 3) {
      setMsg(inFs && freeSpins <= 1 ? "Free spins hotovo" : "Bez výhry");
      if (!inFs) slotAudio.lose();
    }

    if (inFs && freeSpins <= 1 && scatters < 3) {
      setFsMult(1);
    }
  }, [spinning, freeSpins, bet, fsMult, evaluate]);

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

      <p className="game-tagline">Dazzle energie · Sense styl · 5×3 · 10 linií</p>

      <div className="slot-cabinet slot-cabinet--dazzle">
        <div className="slot-cabinet__glow" aria-hidden />
        <SlotReels
          grid={grid}
          spinning={spinning}
          theme="dazzle"
          highlight={highlight}
          renderSymbol={(id, opts) => <SymbolGlyph id={id} size={opts.size} />}
        />
        <div className="slot-payline-hint muted text-xs">Wild ◎ · Scatter ✧ = free spins</div>
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
            className="slot-spin slot-spin--dazzle"
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
