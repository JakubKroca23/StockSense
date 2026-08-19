import Image from "next/image";

/** StockSense mark — jen oko */
export function StockSenseLogo({
  className = "",
  height = 36,
  title = "StockSense",
}: {
  className?: string;
  height?: number;
  title?: string;
}) {
  const eyeW = Math.round(height * (229 / 108));

  return (
    <span
      className={`brand-logo__mark inline-flex items-center ${className}`}
      style={{ height }}
      role="img"
      aria-label={title}
    >
      <Image
        src="/logo-eye-transparent.png"
        alt=""
        width={eyeW}
        height={height}
        className="brand-logo__eye"
        priority
      />
    </span>
  );
}
