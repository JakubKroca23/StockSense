import Image from "next/image";
import { SENSE_GREEN } from "@/components/SenseEye";

const SENSE_TURQUOISE = "#2ec4c8";

/** StockSense wordmark — eye + Stock + sen$e (−10 %, s = výška e, $ = 2. s) */
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
          style={{
            color: "#fff",
            fontSize: stockSize,
            letterSpacing: "0.08em",
          }}
        >
          Stock
        </span>
        <span
          className="brand-logo__sense"
          style={{
            color: SENSE_TURQUOISE,
            fontSize: senseSize,
            letterSpacing: "0.06em",
            textShadow: `0 0 12px ${SENSE_TURQUOISE}66`,
            // první s (= výška e); druhé s = velké $
            marginLeft: "-0.92em",
            position: "relative",
            top: "0.48em",
            display: "inline-block",
          }}
        >
          sen
          <span
            className="brand-logo__sense-dollar"
            style={{
              color: SENSE_GREEN,
              fontSize: "1.65em",
              fontWeight: 700,
              letterSpacing: 0,
              display: "inline-block",
              lineHeight: 1,
              verticalAlign: "baseline",
              margin: "0 -0.02em",
              position: "relative",
              top: "-0.22em",
              textShadow: `0 0 14px ${SENSE_GREEN}88`,
            }}
          >
            $
          </span>
          e
        </span>
      </span>
    </span>
  );
}
