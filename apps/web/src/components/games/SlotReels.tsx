"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type Props = {
  /** 5 reels × 3 rows of symbol ids */
  grid: string[][];
  spinning: boolean;
  /** per-reel spin phase 0..1 while spinning */
  renderSymbol: (id: string, opts: { size: "sm" | "md" }) => ReactNode;
  highlight?: boolean[][];
  className?: string;
  theme?: "dazzle" | "book";
};

const ROW_H = 72;

export function SlotReels({
  grid,
  spinning,
  renderSymbol,
  highlight,
  className = "",
  theme = "dazzle",
}: Props) {
  const [offsets, setOffsets] = useState(() => grid.map(() => 0));
  const [blur, setBlur] = useState(false);
  const raf = useRef<number>(0);
  const start = useRef(0);

  useEffect(() => {
    if (!spinning) {
      cancelAnimationFrame(raf.current);
      setBlur(false);
      setOffsets(grid.map(() => 0));
      return;
    }
    setBlur(true);
    start.current = performance.now();
    const tick = (t: number) => {
      const elapsed = t - start.current;
      setOffsets(
        grid.map((_, i) => {
          const speed = 18 + i * 3.5;
          return -((elapsed / 16) * speed) % (ROW_H * 8);
        })
      );
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [spinning, grid]);

  const strips = useMemo(() => {
    return grid.map((col) => {
      // duplicate column for seamless spin illusion
      const loop = [...col, ...col, ...col, ...col, ...col, ...col];
      return loop;
    });
  }, [grid]);

  return (
    <div className={`slot-reels slot-reels--${theme} ${className}`}>
      <div className="slot-reels__frame">
        {strips.map((strip, ri) => (
          <div key={ri} className="slot-reel">
            <div
              className={`slot-reel__window ${blur && spinning ? "is-spinning" : ""}`}
            >
              <div
                className="slot-reel__strip"
                style={{
                  transform: spinning
                    ? `translateY(${offsets[ri]}px)`
                    : "translateY(0)",
                }}
              >
                {(spinning ? strip : grid[ri]).map((sym, si) => {
                  const row = spinning ? si % 3 : si;
                  const lit = !spinning && highlight?.[ri]?.[row];
                  return (
                    <div
                      key={`${ri}-${si}-${sym}`}
                      className={`slot-cell ${lit ? "is-win" : ""}`}
                      style={{ height: ROW_H }}
                    >
                      {renderSymbol(sym, { size: "md" })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
