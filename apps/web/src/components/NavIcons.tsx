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

/** Portfolio — aktiva / držba */
export function IconPortfolio(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3.5" y="7" width="17" height="12.5" rx="2" />
      <path d="M8.5 7V5.8A2.3 2.3 0 0 1 10.8 3.5h2.4A2.3 2.3 0 0 1 15.5 5.8V7" />
      <path d="M3.5 12h17" />
      <circle cx="12" cy="15.8" r="1.35" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Watchlist — sledované tickery */
export function IconWatchlist(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.8 13.95 9.1h5.45l-4.4 3.35 1.65 5.35L12 14.7 7.35 17.8l1.65-5.35-4.4-3.35h5.45L12 3.8Z" />
    </Svg>
  );
}

/** Analýza / Sense — oko z loga aplikace */
export function IconAnalysis({ size = NAV_ICON_SIZE, className = "" }: IconProps) {
  const h = Math.round(size * (129 / 247));
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

/** Reporty — shrnutí / dokument */
export function IconReports(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M7 3.5h7.2L19 8.3V20a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5Z" />
      <path d="M14.2 3.5V8.3H19" />
      <path d="M8.5 12h7M8.5 15.5h7M8.5 19h4.2" />
    </Svg>
  );
}

/** Alerty — upozornění */
export function IconAlerts(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6.2 17.2h11.6" />
      <path d="M7.4 17.2a4.4 4.4 0 0 1-1-2.7V11a5.6 5.6 0 1 1 11.2 0v3.5c0 .97.34 1.9.96 2.7" />
      <path d="M10 17.2a2 2 0 0 0 4 0" />
    </Svg>
  );
}

/** Zábava — hry */
export function IconFun(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="4" y="5" width="16" height="14" rx="2.5" />
      <circle cx="9" cy="11" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="15" cy="11" r="1.4" fill="currentColor" stroke="none" />
      <path d="M8 15.2c.9.9 2.1 1.3 4 1.3s3.1-.4 4-1.3" />
      <path d="M12 5V3.5" />
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
  "/portfolio": IconPortfolio,
  "/watchlist": IconWatchlist,
  "/chat": IconAnalysis,
  "/reports": IconReports,
  "/alerts": IconAlerts,
  "/zabava": IconFun,
  "/settings": IconSettings,
} as const;
