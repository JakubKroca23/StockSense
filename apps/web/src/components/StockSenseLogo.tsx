import Image from "next/image";

const STOCK_LETTERS = [
  { ch: "S", rotate: -8 },
  { ch: "T", rotate: 6 },
  { ch: "O", rotate: -4 },
  { ch: "C", rotate: 9 },
  { ch: "K", rotate: -6 },
] as const;

/** StockSense wordmark — oko + pootočený STOCK + sense v rámečku */
export function StockSenseLogo({
  className = "",
  height = 36,
  title = "StockSense",
}: {
  className?: string;
  height?: number;
  title?: string;
}) {
  const eyeH = Math.round(height * 0.7);
  const eyeW = Math.round(eyeH * (229 / 108));
  const stockSize = Math.round(height * 0.58);
  const gap = Math.round(height * 0.1);

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
          {STOCK_LETTERS.map(({ ch, rotate }) => (
            <span
              key={`${ch}-${rotate}`}
              className="brand-logo__stock-letter"
              style={{ transform: `rotate(${rotate}deg)` }}
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
