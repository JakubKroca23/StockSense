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

export const navIcons = {
  "/": IconHome,
  "/cryptosense": IconCrypto,
} as const;
