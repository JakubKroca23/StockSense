import Image from "next/image";
import { SENSE_GREEN } from "@/components/SenseEye";

/** StockSense wordmark — eye + Stock + $ense (Sense smaller, lower, left) */
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
  const eyeW = Math.round(eyeH * (247 / 129));
  const stockSize = Math.round(height * 0.72);
  const senseSize = Math.round(stockSize * 0.72);
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
          paddingRight: "0.15em",
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
            color: SENSE_GREEN,
            fontSize: senseSize,
            letterSpacing: "0.06em",
            textShadow: `0 0 12px ${SENSE_GREEN}66`,
            marginLeft: "-0.12em",
            position: "relative",
            top: "0.28em",
            display: "inline-block",
          }}
        >
          $ense
        </span>
      </span>
    </span>
  );
}
