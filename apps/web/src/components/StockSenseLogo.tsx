import Image from "next/image";
import { SENSE_GREEN } from "@/components/SenseEye";

/** StockSense wordmark — eye + Stock + sense (−10 %, 2. s mírně větší) */
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
  // původní artwork oka z loga (aspect ~229×108)
  const eyeW = Math.round(eyeH * (229 / 108));
  const stockSize = Math.round(height * 0.72);
  // Sense o 10 % menší než dřívější poměr k Stock
  const senseSize = Math.round(stockSize * 0.72 * 0.9);
  const gap = Math.round(height * 0.14);

  return (
    <span
      className={`inline-flex items-center ${className}`}
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
      <span
        className="brand-logo__word"
        style={{
          fontFamily: "var(--font-brand), Space Grotesk, sans-serif",
          fontWeight: 600,
          lineHeight: 1,
          position: "relative",
          // prostor pro Sense posunuté dolů
          paddingBottom: "0.35em",
          paddingRight: "0.05em",
        }}
      >
        <span
          className="brand-logo__stock"
          style={{
            color: "#fff",
            fontFamily: "var(--font-logo-hand), Caveat Brush, cursive",
            fontSize: Math.round(stockSize * 1.22),
            fontWeight: 400,
            letterSpacing: "0.02em",
            lineHeight: 0.85,
            display: "inline-block",
            transform: "rotate(-2deg)",
            transformOrigin: "left center",
          }}
        >
          Stock
        </span>
        <span
          className="brand-logo__sense"
          style={{
            color: SENSE_GREEN,
            fontSize: senseSize,
            fontWeight: 400,
            letterSpacing: "0.02em",
            textShadow: `0 0 10px ${SENSE_GREEN}55, 0 0 18px ${SENSE_GREEN}33`,
            // sense: druhé s mírně větší (sdílí „s“ se Stocks)
            marginLeft: "-0.92em",
            position: "relative",
            top: "0.48em",
            display: "inline-block",
          }}
        >
          sen
          <span
            className="brand-logo__sense-s"
            style={{
              fontSize: "1.2em",
              fontWeight: 500,
              letterSpacing: 0,
              display: "inline-block",
              lineHeight: 1,
              verticalAlign: "baseline",
              margin: "0 -0.06em 0 -0.14em",
              position: "relative",
              top: "-0.12em",
            }}
          >
            s
          </span>
          e
        </span>
      </span>
    </span>
  );
}
