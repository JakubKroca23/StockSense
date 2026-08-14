"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { pixelToPoint, pointToPixel, priceToY } from "@/lib/chart/coords";
import type { ChartDrawing, ChartPoint, DrawTool } from "@/lib/chart/types";

function uid() {
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function readColor() {
  return getComputedStyle(document.documentElement).getPropertyValue("--sense").trim() || "#5dde8a";
}

export function ChartDrawOverlay({
  chart,
  series,
  wrap,
  tool,
  drawings,
  onChange,
  clipRight,
}: {
  chart: IChartApi | null;
  series: ISeriesApi<"Candlestick"> | null;
  wrap: HTMLDivElement | null;
  tool: DrawTool;
  drawings: ChartDrawing[];
  onChange: (next: ChartDrawing[]) => void;
  clipRight?: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<{ a: ChartPoint; b: ChartPoint; kind: DrawTool } | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const drawingsRef = useRef(drawings);
  drawingsRef.current = drawings;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [, bump] = useState(0);
  const redraw = useCallback(() => bump((n) => n + 1), []);

  useEffect(() => {
    if (!chart) return;
    const onRange = () => redraw();
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    chart.subscribeCrosshairMove(onRange);
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chart.unsubscribeCrosshairMove(onRange);
    };
  }, [chart, redraw]);

  const toLocal = (e: { clientX: number; clientY: number }) => {
    if (!wrap) return null;
    const r = wrap.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const capture = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (toolRef.current === "none" || !chart || !series) return;
    const loc = toLocal(e);
    if (!loc) return;
    if (clipRight != null && loc.x > clipRight) return;
    const pt = pixelToPoint(chart, series, loc.x, loc.y);
    if (!pt) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
    const kind = toolRef.current;
    if (kind === "hline") {
      onChangeRef.current([
        ...drawingsRef.current,
        { id: uid(), kind: "hline", price: pt.price, color: readColor() },
      ]);
      return;
    }
    setDraft({ a: pt, b: pt, kind });
  };

  const move = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!draftRef.current || !chart || !series) return;
    const loc = toLocal(e);
    if (!loc) return;
    const pt = pixelToPoint(chart, series, loc.x, loc.y);
    if (!pt) return;
    setDraft((d) => (d ? { ...d, b: pt } : d));
  };

  const release = () => {
    const d = draftRef.current;
    setDraft(null);
    if (!d || d.kind === "none" || d.kind === "hline") return;
    if (d.kind === "trend" || d.kind === "ray" || d.kind === "rect") {
      onChangeRef.current([
        ...drawingsRef.current,
        { id: uid(), kind: d.kind, a: d.a, b: d.b, color: readColor() },
      ]);
    }
  };

  const w = wrap?.clientWidth || 0;
  const h = wrap?.clientHeight || 0;
  const items = draft
    ? [
        ...drawings,
        draft.kind === "hline"
          ? ({ id: "draft", kind: "hline", price: draft.b.price, color: readColor() } as ChartDrawing)
          : ({
              id: "draft",
              kind: draft.kind as "trend" | "ray" | "rect",
              a: draft.a,
              b: draft.b,
              color: readColor(),
            } as ChartDrawing),
      ]
    : drawings;

  const active = tool !== "none";
  const clipW = clipRight != null && clipRight > 0 ? clipRight : w;

  return (
    <svg
      ref={svgRef}
      className={`chart-draw ${active ? "is-active" : ""}`}
      width={w}
      height={h}
      viewBox={`0 0 ${Math.max(1, w)} ${Math.max(1, h)}`}
      onPointerDown={capture}
      onPointerMove={move}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <clipPath id="chart-draw-clip">
        <rect x={0} y={0} width={Math.max(1, clipW)} height={Math.max(1, h)} />
      </clipPath>
      <g clipPath="url(#chart-draw-clip)">
        if (!chart || !series) return null;
        if (d.kind === "hline") {
          const y = priceToY(series, d.price);
          if (y == null) return null;
          const x2 = clipRight ?? w;
          return (
            <line
              key={d.id}
              x1={0}
              x2={x2}
              y1={y}
              y2={y}
              stroke={d.color}
              strokeWidth={1.25}
              strokeDasharray="5 4"
              vectorEffect="non-scaling-stroke"
            />
          );
        }
        const a = pointToPixel(chart, series, d.a);
        const b = pointToPixel(chart, series, d.b);
        if (!a || !b) return null;
        if (d.kind === "rect") {
          const x = Math.min(a.x, b.x);
          const y = Math.min(a.y, b.y);
          return (
            <rect
              key={d.id}
              x={x}
              y={y}
              width={Math.max(1, Math.abs(b.x - a.x))}
              height={Math.max(1, Math.abs(b.y - a.y))}
              fill={`${d.color}22`}
              stroke={d.color}
              strokeWidth={1.2}
              vectorEffect="non-scaling-stroke"
            />
          );
        }
        let x2 = b.x;
        let y2 = b.y;
        if (d.kind === "ray" && a.x !== b.x) {
          const slope = (b.y - a.y) / (b.x - a.x);
          const edge = b.x >= a.x ? (clipRight ?? w) : 0;
          x2 = edge;
          y2 = a.y + slope * (edge - a.x);
        }
        return (
          <line
            key={d.id}
            x1={a.x}
            y1={a.y}
            x2={x2}
            y2={y2}
            stroke={d.color}
            strokeWidth={1.35}
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      </g>
    </svg>
  );
}
