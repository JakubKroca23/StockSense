import Image from "next/image";
import type { ReactNode } from "react";

type IconProps = { size?: number; className?: string };

/** Default size matches Analýza eye width */
export const NAV_ICON_SIZE = 20;

function Svg({
  size = NAV_ICON_SIZE,
  className = "",
  children,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.85"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`nav-item__icon ${className}`}
      aria-hidden
    >
      {children}
    </svg>
  );
}

/** Home — trh / denní přehled */
export function IconHome(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" />
      <path d="M8.5 14.5h3M13 12.2l1.6 2.3H17" />
    </Svg>
  );
}

/** Analýza / Sense — oko z loga aplikace */
export function IconAnalysis({ size = NAV_ICON_SIZE, className = "" }: IconProps) {
  const h = Math.round(size * (108 / 229));
  return (
    <Image
      src="/logo-eye-transparent.png"
      alt=""
      width={size}
      height={Math.max(h, 11)}
      className={`nav-item__icon nav-icon__eye ${className}`}
    />
  );
}

/** Tipy — historie / úspěšnost */
export function IconTips(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4.5 19.5V6.8" />
      <path d="M4.5 19.5H19.5" />
      <path d="M7.5 15.2V11.5" />
      <path d="M11.5 15.2V8.2" />
      <path d="M15.5 15.2V10" />
      <path d="M8.8 6.2 12.2 4.5 16.8 7.2" />
    </Svg>
  );
}

/** CryptoSense — mince / crypto */
export function IconCrypto(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.2v9.6M9.2 9.2c.7-.55 1.55-.85 2.8-.85 1.7 0 2.85.7 2.85 1.95S13.7 12.2 12 12.2 9.15 12.85 9.15 14.1c0 1.25 1.2 2 2.95 2 1.25 0 2.15-.35 2.8-.95" />
    </Svg>
  );
}

/** Nastavení */
export function IconSettings(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 3.2v2.4M12 18.4V20.8M4.5 6.3l1.7 1.7M17.8 15.9l1.7 1.7M3.2 12h2.4M18.4 12h2.4M4.5 17.7l1.7-1.7M17.8 8.1l1.7-1.7" />
    </Svg>
  );
}

export const navIcons = {
  "/": IconHome,
  "/tips": IconTips,
  "/chat": IconAnalysis,
  "/cryptosense": IconCrypto,
} as const;
