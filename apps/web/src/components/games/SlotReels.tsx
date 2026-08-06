"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SlotSymbol } from "@/components/games/SlotSymbols";

export const ROW_H = 84;

type Props = {
  strips: string[][];
  stops: number[];
  targetStops: number[] | null;
  spinning: boolean;
  rows?: number;
  highlight?: boolean[][];
  theme?: "dazzle" | "book" | "joker";
  className?: string;
  onReelStop?: (reelIndex: number) => void;
  onAllStopped?: () => void;
};

function easeOutQuart(t: number) {
  return 1 - Math.pow(1 - t, 4);
}

/**
 * Reel strip stays filled for the whole spin:
 * we only travel within pre-rendered copies (never past the strip end).
 */
export function SlotReels({
  strips,
  stops,
  targetStops,
  spinning,
  rows = 3,
  highlight,
  theme = "dazzle",
  className = "",
  onReelStop,
  onAllStopped,
}: Props) {
  const [offsets, setOffsets] = useState(() => stops.map((s) => -s * ROW_H));
  const [busy, setBusy] = useState<boolean[]>(() => strips.map(() => false));
  const raf = useRef(0);
  const finished = useRef<boolean[]>([]);
  const allDone = useRef(false);
  const onReelStopRef = useRef(onReelStop);
  const onAllStoppedRef = useRef(onAllStopped);
  onReelStopRef.current = onReelStop;
  onAllStoppedRef.current = onAllStopped;

  // How many full strip loops each reel travels (kept small + matched to copies)
  const extraLoops = useMemo(
    () => strips.map((_, i) => 2 + i), // 2,3,4…
    [strips]
  );
  const copies = useMemo(() => Math.max(...extraLoops, 1) + 2, [extraLoops]);

  useEffect(() => {
    if (spinning) return;
    setOffsets(stops.map((s) => -s * ROW_H));
    setBusy(strips.map(() => false));
  }, [stops, spinning, strips]);

  useEffect(() => {
    if (!spinning || !targetStops) return;

    allDone.current = false;
    finished.current = strips.map(() => false);
    setBusy(strips.map(() => true));

    // Start from current visible stop (first copy)
    setOffsets(stops.map((s) => -s * ROW_H));

    const startTime = performance.now();
    const baseDuration = 1400;
    const stagger = 380;

    const tick = (now: number) => {
      let complete = true;
      const nextY: number[] = [];
      const nextBusy: boolean[] = [];

      for (let i = 0; i < strips.length; i++) {
        const len = strips[i].length;
        const dur = baseDuration + i * stagger;
        const t = Math.min(1, Math.max(0, (now - startTime) / dur));
        const e = easeOutQuart(t);
        const from = stops[i];
        const to = targetStops[i];
        let delta = (to - from + len) % len;
        if (delta === 0) delta = len;
        const loops = extraLoops[i];
        const travel = loops * len + delta;

        // Land on the `to` index inside copy `loops` → still inside rendered range
        const y = -(from + travel * e) * ROW_H;
        nextY[i] = y;
        const done = t >= 1;
        nextBusy[i] = !done;
        if (!done) complete = false;

        if (done && !finished.current[i]) {
          finished.current[i] = true;
          // Exact land on same symbols in copy `loops` (no blank gap)
          nextY[i] = -(to + loops * len) * ROW_H;
          onReelStopRef.current?.(i);
        }
      }

      setOffsets(nextY);
      setBusy(nextBusy);

      if (!complete) {
        raf.current = requestAnimationFrame(tick);
      } else if (!allDone.current) {
        allDone.current = true;
        // Invisible normalize: same symbols, first copy
        setOffsets(targetStops.map((s) => -s * ROW_H));
        setBusy(strips.map(() => false));
        onAllStoppedRef.current?.();
      }
    };

    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [spinning, targetStops, stops, strips, extraLoops]);

  const renderStrips = useMemo(
    () =>
      strips.map((strip) => {
        const out: string[] = [];
        for (let c = 0; c < copies; c++) out.push(...strip);
        return out;
      }),
    [strips, copies]
  );

  return (
    <div className={`slot-reels slot-reels--${theme} ${className}`}>
      <div
        className="slot-reels__frame"
        style={{ gridTemplateColumns: `repeat(${strips.length}, 1fr)` }}
      >
        {renderStrips.map((strip, ri) => {
          const stop = !busy[ri] && targetStops ? targetStops[ri] : stops[ri];
          const len = strips[ri].length;
          return (
            <div key={ri} className="slot-reel">
              <div
                className={`slot-reel__window ${busy[ri] ? "is-spinning" : ""}`}
                style={{ height: ROW_H * rows }}
              >
                <div
                  className="slot-reel__strip"
                  style={{ transform: `translate3d(0, ${offsets[ri]}px, 0)` }}
                >
                  {strip.map((sym, si) => {
                    const logical = si % len;
                    const rowInWindow = (logical - (stop % len) + len) % len;
                    const lit =
                      !busy[ri] &&
                      rowInWindow < rows &&
                      !!highlight?.[ri]?.[rowInWindow];
                    return (
                      <div
                        key={`${ri}-${si}`}
                        className={`slot-cell ${lit ? "is-win" : ""}`}
                        style={{ height: ROW_H }}
                      >
                        <SlotSymbol id={sym} />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
