import Image from "next/image";
import type { ReactNode } from "react";

type IconProps = { size?: number; className?: string };

/** Default size matches Analýza eye width */
export const NAV_ICON_SIZE = 22;
export const RAIL_ICON_SIZE = 28;

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
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`nav-item__icon ${className}`}
      aria-hidden
    >
      {children}
    </svg>
  );
}

/** Home — dům / přehled */
export function IconHome(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 11.2 12 3.8l8.5 7.4" />
      <path d="M6 10.6V20h12V10.6" />
      <path d="M10 20v-5.2h4V20" />
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

/** Desk — svíčky (výchozí ikona nového symbolu) */
export function IconDesk(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4.5 19.5V6.8" />
      <path d="M4.5 19.5H19.5" />
      <path d="M8 16V10M8 10V8M8 16v2" />
      <path d="M12.5 14.5V7.5M12.5 7.5V5.5M12.5 14.5v2" />
      <path d="M17 15.5V11M17 11V9.5M17 15.5v1.5" />
    </Svg>
  );
}

/** Oil — kapka WTI */
export function IconOil(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.2s-6.2 7.1-6.2 11.1A6.2 6.2 0 0 0 12 20.5a6.2 6.2 0 0 0 6.2-6.2C18.2 10.3 12 3.2 12 3.2Z" />
      <path d="M10.2 14.6c.45 1.35 1.55 2 2.7 2" />
    </Svg>
  );
}

/** BTC — bitcoin desk */
export function IconBtc(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M10.8 6.4v1.5M13.5 6.4v1.5M10.8 16.1v1.5M13.5 16.1v1.5" />
      <path d="M9.4 8.15h3.55c1.72 0 2.8.88 2.8 2.18 0 1.18-.82 1.95-2.22 2.18" />
      <path d="M9.4 12.5h4.25c1.88 0 3 .95 3 2.28 0 1.42-1.22 2.28-3.18 2.28H9.4" />
      <path d="M9.4 8.15v9" />
    </Svg>
  );
}

/** Gold — slitina / ingot */
export function IconGold(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6.2 14.8 8.6 8.4h6.8l2.4 6.4H6.2Z" />
      <path d="M4.5 18.2h15l-1.4-3.4H5.9L4.5 18.2Z" />
      <path d="M10.2 11.2h3.6" />
    </Svg>
  );
}

/** Nastavení — plné zelené ozubené kolo */
export function IconSettings({ size = NAV_ICON_SIZE, className = "" }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`nav-item__icon nav-icon__gear ${className}`}
      aria-hidden
    >
      <path
        fill="currentColor"
        d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.07 7.07 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.8 2h-3.6a.5.5 0 0 0-.49.42l-.36 2.54c-.59.24-1.13.55-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.81 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.93 14.1a.5.5 0 0 0-.12.64l1.92 3.32c.13.23.4.32.64.22l2.39-.96c.5.39 1.04.7 1.63.94l.36 2.54c.05.24.25.42.49.42h3.6c.24 0 .44-.18.49-.42l.36-2.54c.59-.24 1.13-.55 1.63-.94l2.39.96c.24.1.51 0 .64-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"
      />
    </svg>
  );
}

/** Mobilní burger */
export function IconMenu({ size = NAV_ICON_SIZE, className = "" }: IconProps) {
  return (
    <Svg {...{ size, className }}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  );
}

export function IconClose({ size = NAV_ICON_SIZE, className = "" }: IconProps) {
  return (
    <Svg {...{ size, className }}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

export function IconSun(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3.6" />
      <path d="M12 3.2v1.8M12 19v1.8M4.9 4.9l1.3 1.3M17.8 17.8l1.3 1.3M3.2 12h1.8M19 12h1.8M4.9 19.1l1.3-1.3M17.8 6.2l1.3-1.3" />
    </Svg>
  );
}

export function IconMoon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M16.4 13.6A6.2 6.2 0 0 1 10.2 5.2 6.4 6.4 0 1 0 18.8 14a6.1 6.1 0 0 1-2.4-.4Z" />
    </Svg>
  );
}

/** Kreslení — tužka */
export function IconDraw(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 20h4L19.2 8.8a2.1 2.1 0 0 0-3-3L5 16.1V20Z" />
      <path d="M14.4 6.6 17.4 9.6" />
    </Svg>
  );
}

export const navIcons: Record<string, (p: IconProps) => ReactNode> = {
  "/": IconHome,
  "/desk/btc": IconBtc,
  "/btc": IconBtc,
  "/desk/oil": IconOil,
  "/oil": IconOil,
  "/desk/gold": IconGold,
  "/gold": IconGold,
};
