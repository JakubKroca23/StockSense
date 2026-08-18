import Image from "next/image";

const STOCK_LETTERS = [
  { ch: "S", rotate: -8 },
  { ch: "T", rotate: 6 },
  { ch: "O", rotate: -4 },
  { ch: "C", rotate: 9 },
  { ch: "K", rotate: -6 },
] as const;

const TRADING_LETTERS = [
  { ch: "T", rotate: -7 },
  { ch: "R", rotate: 5 },
  { ch: "A", rotate: -4 },
  { ch: "D", rotate: 8 },
  { ch: "I", rotate: -6 },
  { ch: "N", rotate: 5 },
  { ch: "G", rotate: -7 },
] as const;

export type LogoVariant = "stocksense" | "trading-vision";

const VARIANTS = {
  stocksense: {
    title: "StockSense",
    letters: STOCK_LETTERS,
    tagline: "sense",
  },
  "trading-vision": {
    title: "Trading Vision",
    letters: TRADING_LETTERS,
    tagline: "vision",
  },
} as const;

/** Wordmark — oko + pootočený název + tagline v rámečku */
export function StockSenseLogo({
  className = "",
  height = 36,
  title,
  variant = "stocksense",
}: {
  className?: string;
  height?: number;
  title?: string;
  variant?: LogoVariant;
}) {
  const cfg = VARIANTS[variant];
  const eyeH = Math.round(height * 0.7);
  const eyeW = Math.round(eyeH * (229 / 108));
  const stockSize = Math.round(height * (variant === "trading-vision" ? 0.4 : 0.46));
  const gap = Math.round(height * 0.1);

  return (
    <span
      className={`brand-logo__mark inline-flex items-center ${className}`}
      style={{ height, gap }}
      role="img"
      aria-label={title ?? cfg.title}
    >
      <Image
        src="/logo-eye-transparent.png"
        alt=""
        width={eyeW}
        height={eyeH}
        className="brand-logo__eye"
        priority
      />
      <span className="brand-logo__word" style={{ fontSize: stockSize }}>
        <span className="brand-logo__stock">
          {cfg.letters.map(({ ch, rotate }) => (
            <span
              key={`${ch}-${rotate}`}
              className="brand-logo__stock-letter"
              style={{ transform: `rotate(${rotate}deg)` }}
            >
              {ch}
            </span>
          ))}
        </span>
        <span className="brand-logo__sense">{cfg.tagline}</span>
      </span>
    </span>
  );
}
