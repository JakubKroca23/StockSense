import Image from "next/image";

/** StockSense mark — jen logo oka */
export function StockSenseLogo({
  className = "",
  height = 36,
  title = "StockSense",
}: {
  className?: string;
  height?: number;
  title?: string;
}) {
  // oko vyplní výšku (trochu větší než dřív 0.92)
  const eyeH = height;
  const eyeW = Math.round(eyeH * (229 / 108));

  return (
    <span
      className={`inline-flex items-center ${className}`}
      style={{ height }}
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
    </span>
  );
}
