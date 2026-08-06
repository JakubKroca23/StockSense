"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SlotSymbol } from "@/components/games/SlotSymbols";

export const ROW_H = 76;

type Props = {
  strips: string[][];
  stops: number[];
  targetStops: number[] | null;
  spinning: boolean;
  rows?: number;
  highlight?: boolean[][];
  theme?: "dazzle" | "book";
  className?: string;
  onReelStop?: (reelIndex: number) => void;
  onAllStopped?: () => void;
};

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

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

    const startTime = performance.now();
    const baseDuration = 1700;
    const stagger = 320;
    const extraLoops = strips.map((_, i) => 5 + i);

    const tick = (now: number) => {
      let complete = true;
      const nextY: number[] = [];
      const nextBusy: boolean[] = [];

      for (let i = 0; i < strips.length; i++) {
        const len = strips[i].length;
        const dur = baseDuration + i * stagger;
        const t = Math.min(1, Math.max(0, (now - startTime) / dur));
        const e = easeOutCubic(t);
        const from = stops[i];
        const to = targetStops[i];
        let delta = (to - from + len) % len;
        if (delta === 0) delta = len;
        const travel = extraLoops[i] * len + delta;
        nextY[i] = -(from * ROW_H + travel * ROW_H * e);
        const done = t >= 1;
        nextBusy[i] = !done;
        if (!done) complete = false;
        if (done && !finished.current[i]) {
          finished.current[i] = true;
          nextY[i] = -(to + extraLoops[i] * len) * ROW_H;
          onReelStopRef.current?.(i);
        }
      }

      setOffsets(nextY);
      setBusy(nextBusy);

      if (!complete) {
        raf.current = requestAnimationFrame(tick);
      } else if (!allDone.current) {
        allDone.current = true;
        // seamless snap to base copy (same symbols)
        setOffsets(targetStops.map((s) => -s * ROW_H));
        setBusy(strips.map(() => false));
        onAllStoppedRef.current?.();
      }
    };

    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [spinning, targetStops, stops, strips]);

  const renderStrips = useMemo(
    () => strips.map((strip) => [...strip, ...strip, ...strip, ...strip, ...strip]),
    [strips]
  );

  return (
    <div className={`slot-reels slot-reels--${theme} ${className}`}>
      <div className="slot-reels__frame">
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
