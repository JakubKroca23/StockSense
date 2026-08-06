import Image from "next/image";

const STOCK_LETTERS = [
  { ch: "S", rotate: -8, y: 3 },
  { ch: "t", rotate: 6, y: -4 },
  { ch: "o", rotate: -4, y: 5 },
  { ch: "c", rotate: 9, y: -2 },
  { ch: "k", rotate: -6, y: 4 },
] as const;

/** StockSense wordmark — oko + rozházený Stock + sense v rámečku */
export function StockSenseLogo({
  className = "",
  height = 36,
  title = "StockSense",
}: {
  className?: string;
  height?: number;
  title?: string;
}) {
  const eyeH = Math.round(height * 0.92);
  const eyeW = Math.round(eyeH * (229 / 108));
  const stockSize = Math.round(height * 0.78);
  const gap = Math.round(height * 0.12);

  return (
    <span
      className={`brand-logo__mark inline-flex items-center ${className}`}
      style={{ height, gap }}
      role="img"
      aria-label={title}
    >
      <Image
        src="/logo-eye-transparent.png"
        alt=""
        width={eyeW}
        height={eyeH}
        className="brand-logo__eye"
        priority
      />
      <span className="brand-logo__word">
        <span className="brand-logo__stock" style={{ fontSize: stockSize }}>
          {STOCK_LETTERS.map(({ ch, rotate, y }) => (
            <span
              key={`${ch}-${rotate}`}
              className="brand-logo__stock-letter"
              style={{ transform: `translateY(${y}px) rotate(${rotate}deg)` }}
            >
              {ch}
            </span>
          ))}
        </span>
        <span className="brand-logo__sense">sense</span>
      </span>
    </span>
  );
}
