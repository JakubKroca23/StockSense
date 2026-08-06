/** Deterministic slot math — grid is source of truth for wins. */

export type Payline = number[]; // row per reel (0 = top)

export type LineWin = {
  lineIndex: number;
  symbol: string;
  count: number;
  /** paytable multiplier (× line bet) */
  mult: number;
  /** absolute credit win for this line */
  amount: number;
  /** cells [reel][row] that form the win */
  cells: { reel: number; row: number }[];
};

export type SpinResult = {
  /** grid[reel][row] */
  grid: string[][];
  /** stop index on each reel strip (top visible) */
  stops: number[];
  lineWins: LineWin[];
  scatterCount: number;
  scatterWin: number;
  totalWin: number;
  /** highlight mask grid[reel][row] */
  highlight: boolean[][];
};

export const LINES_5X3_10: Payline[] = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
  [0, 1, 1, 1, 0],
];

/** Build a weighted strip for one reel */
export function makeStrip(weights: Record<string, number>, length = 32): string[] {
  const bag: string[] = [];
  for (const [sym, w] of Object.entries(weights)) {
    for (let i = 0; i < Math.max(1, Math.round(w)); i++) bag.push(sym);
  }
  const strip: string[] = [];
  for (let i = 0; i < length; i++) {
    strip.push(bag[Math.floor(Math.random() * bag.length)]);
  }
  return strip;
}

export function makeStrips(
  weights: Record<string, number>,
  reelCount: number,
  length = 32
): string[][] {
  return Array.from({ length: reelCount }, () => makeStrip(weights, length));
}

export function windowFromStop(strip: string[], stop: number, rows: number): string[] {
  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    out.push(strip[(stop + r) % strip.length]);
  }
  return out;
}

export function gridFromStops(strips: string[][], stops: number[], rows: number): string[][] {
  return strips.map((strip, i) => windowFromStop(strip, stops[i], rows));
}

export function randomStops(strips: string[][]): number[] {
  return strips.map((s) => Math.floor(Math.random() * s.length));
}

/**
 * Evaluate left-to-right paylines.
 * paytable[symbol][count] = multiplier of lineBet (count 3..5 typically).
 * Wild substitutes for any non-scatter; scatter never pays on lines.
 */
export function evalPaylines(
  grid: string[][],
  lines: Payline[],
  paytable: Record<string, number[]>,
  lineBet: number,
  wild?: string,
  scatter?: string
): LineWin[] {
  const wins: LineWin[] = [];
  const reels = grid.length;

  lines.forEach((line, lineIndex) => {
    if (line.length !== reels) return;
    const cells = line.map((row, reel) => ({
      reel,
      row,
      sym: grid[reel][row],
    }));

    // Pick paying symbol: first non-wild non-scatter, else wild
    let symbol: string | null = null;
    for (const c of cells) {
      if (scatter && c.sym === scatter) {
        // scatter on line breaks classic fruit pays from that point — treat as non-match
        break;
      }
      if (wild && c.sym === wild) continue;
      symbol = c.sym;
      break;
    }
    if (!symbol) {
      // all wilds (or wilds then scatter)
      if (wild && cells.every((c) => c.sym === wild)) symbol = wild;
      else return;
    }
    if (scatter && symbol === scatter) return;

    let count = 0;
    for (const c of cells) {
      if (c.sym === symbol || (wild && c.sym === wild)) count += 1;
      else break;
    }
    if (count < 3) return;

    const table = paytable[symbol];
    if (!table) return;
    const mult = table[count] ?? table[count - 1] ?? 0;
    if (mult <= 0) return;

    wins.push({
      lineIndex,
      symbol,
      count,
      mult,
      amount: Math.floor(mult * lineBet),
      cells: cells.slice(0, count).map((c) => ({ reel: c.reel, row: c.row })),
    });
  });

  return wins;
}

export function countSymbol(grid: string[][], symbol: string): number {
  let n = 0;
  for (const col of grid) for (const s of col) if (s === symbol) n += 1;
  return n;
}

export function buildHighlight(reels: number, rows: number, wins: LineWin[]): boolean[][] {
  const hl = Array.from({ length: reels }, () => Array.from({ length: rows }, () => false));
  for (const w of wins) {
    for (const c of w.cells) hl[c.reel][c.row] = true;
  }
  return hl;
}

export function evaluateSpin(opts: {
  strips: string[][];
  stops: number[];
  rows: number;
  lines: Payline[];
  paytable: Record<string, number[]>;
  /** bet per line */
  lineBet: number;
  /** total bet (for scatter) */
  totalBet: number;
  wild?: string;
  scatter?: string;
  /** scatterCount -> multiplier of totalBet */
  scatterPays?: Record<number, number>;
  winMultiplier?: number;
}): SpinResult {
  const grid = gridFromStops(opts.strips, opts.stops, opts.rows);
  return evaluateGrid({ ...opts, grid, stops: opts.stops });
}

export function evaluateGrid(opts: {
  grid: string[][];
  stops?: number[];
  lines: Payline[];
  paytable: Record<string, number[]>;
  lineBet: number;
  totalBet: number;
  wild?: string;
  scatter?: string;
  scatterPays?: Record<number, number>;
  winMultiplier?: number;
}): SpinResult {
  const {
    grid,
    lines,
    paytable,
    lineBet,
    totalBet,
    wild,
    scatter,
    scatterPays,
    winMultiplier = 1,
  } = opts;

  const lineWins = evalPaylines(grid, lines, paytable, lineBet, wild, scatter).map((w) => ({
    ...w,
    amount: Math.floor(w.amount * winMultiplier),
  }));

  let scatterCount = 0;
  let scatterWin = 0;
  if (scatter && scatterPays) {
    scatterCount = countSymbol(grid, scatter);
    const sm = scatterPays[scatterCount] || 0;
    if (sm > 0) scatterWin = Math.floor(sm * totalBet * winMultiplier);
  }

  const lineTotal = lineWins.reduce((s, w) => s + w.amount, 0);
  const totalWin = lineTotal + scatterWin;

  const highlight = buildHighlight(grid.length, grid[0]?.length || 3, lineWins);
  if (scatter && scatterWin > 0) {
    for (let r = 0; r < grid.length; r++) {
      for (let row = 0; row < grid[r].length; row++) {
        if (grid[r][row] === scatter) highlight[r][row] = true;
      }
    }
  }

  return {
    grid,
    stops: opts.stops ?? grid.map(() => 0),
    lineWins,
    scatterCount,
    scatterWin,
    totalWin,
    highlight,
  };
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
