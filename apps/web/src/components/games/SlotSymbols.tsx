"use client";

import { useId, type ReactNode } from "react";

function Frame({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 64 64" className="slot-svg" aria-hidden>
      {children}
    </svg>
  );
}

export function SymCherry() {
  const id = useId().replace(/:/g, "");
  return (
    <Frame>
      <defs>
        <radialGradient id={`${id}-g`} cx="35%" cy="30%" r="60%">
          <stop offset="0%" stopColor="#ff8a8a" />
          <stop offset="55%" stopColor="#e12222" />
          <stop offset="100%" stopColor="#8b0000" />
        </radialGradient>
      </defs>
      <path d="M28 28 C24 14 18 10 14 8" stroke="#3d9e3d" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M36 28 C40 14 48 10 52 9" stroke="#3d9e3d" strokeWidth="3" fill="none" strokeLinecap="round" />
      <ellipse cx="42" cy="14" rx="6" ry="3.5" fill="#4caf50" stroke="#fff" strokeWidth="1.5" transform="rotate(-25 42 14)" />
      <circle cx="24" cy="40" r="12" fill={`url(#${id}-g)`} stroke="#fff" strokeWidth="2.2" />
      <circle cx="40" cy="42" r="12" fill={`url(#${id}-g)`} stroke="#fff" strokeWidth="2.2" />
      <ellipse cx="20" cy="34" rx="4" ry="2.5" fill="#fff" opacity="0.45" />
      <ellipse cx="36" cy="36" rx="4" ry="2.5" fill="#fff" opacity="0.45" />
    </Frame>
  );
}

export function SymLemon() {
  const id = useId().replace(/:/g, "");
  return (
    <Frame>
      <defs>
        <radialGradient id={`${id}-g`} cx="35%" cy="30%" r="65%">
          <stop offset="0%" stopColor="#fff59d" />
          <stop offset="50%" stopColor="#ffd54f" />
          <stop offset="100%" stopColor="#f9a825" />
        </radialGradient>
      </defs>
      <ellipse cx="32" cy="34" rx="20" ry="16" fill={`url(#${id}-g)`} stroke="#fff" strokeWidth="2.2" />
      <path d="M32 16 C34 12 36 10 38 9" stroke="#4caf50" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <ellipse cx="24" cy="28" rx="5" ry="3" fill="#fff" opacity="0.4" />
    </Frame>
  );
}

export function SymOrange() {
  const id = useId().replace(/:/g, "");
  return (
    <Frame>
      <defs>
        <radialGradient id={`${id}-g`} cx="32%" cy="28%" r="65%">
          <stop offset="0%" stopColor="#ffcc80" />
          <stop offset="45%" stopColor="#ff9800" />
          <stop offset="100%" stopColor="#e65100" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="36" r="18" fill={`url(#${id}-g)`} stroke="#fff" strokeWidth="2.2" />
      <path d="M32 18 C34 12 38 10 42 10" stroke="#2e7d32" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <ellipse cx="40" cy="14" rx="6" ry="3" fill="#66bb6a" stroke="#fff" strokeWidth="1.4" transform="rotate(20 40 14)" />
      <ellipse cx="24" cy="28" rx="5" ry="3" fill="#fff" opacity="0.4" />
    </Frame>
  );
}

export function SymPlum() {
  const id = useId().replace(/:/g, "");
  return (
    <Frame>
      <defs>
        <radialGradient id={`${id}-g`} cx="32%" cy="28%" r="65%">
          <stop offset="0%" stopColor="#e1bee7" />
          <stop offset="40%" stopColor="#ab47bc" />
          <stop offset="100%" stopColor="#6a1b9a" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="36" r="17" fill={`url(#${id}-g)`} stroke="#fff" strokeWidth="2.2" />
      <path d="M32 19 C33 13 36 11 40 10" stroke="#2e7d32" strokeWidth="2.3" fill="none" strokeLinecap="round" />
      <ellipse cx="38" cy="14" rx="5.5" ry="2.8" fill="#66bb6a" stroke="#fff" strokeWidth="1.3" />
      <ellipse cx="24" cy="28" rx="4.5" ry="2.8" fill="#fff" opacity="0.4" />
    </Frame>
  );
}

export function SymWatermelon() {
  const id = useId().replace(/:/g, "");
  return (
    <Frame>
      <defs>
        <radialGradient id={`${id}-g`} cx="40%" cy="35%" r="60%">
          <stop offset="0%" stopColor="#a5d6a7" />
          <stop offset="50%" stopColor="#43a047" />
          <stop offset="100%" stopColor="#1b5e20" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="34" r="18" fill={`url(#${id}-g)`} stroke="#fff" strokeWidth="2.2" />
      <path d="M18 22 Q32 28 46 22" stroke="#2e7d32" strokeWidth="3" fill="none" opacity="0.55" />
      <path d="M16 34 Q32 40 48 34" stroke="#2e7d32" strokeWidth="3" fill="none" opacity="0.45" />
      <path d="M18 46 Q32 50 46 46" stroke="#2e7d32" strokeWidth="3" fill="none" opacity="0.4" />
      <ellipse cx="24" cy="26" rx="5" ry="3" fill="#fff" opacity="0.35" />
    </Frame>
  );
}

export function SymGrapes() {
  const id = useId().replace(/:/g, "");
  return (
    <Frame>
      <defs>
        <radialGradient id={`${id}-g`} cx="35%" cy="30%" r="60%">
          <stop offset="0%" stopColor="#ce93d8" />
          <stop offset="55%" stopColor="#7b1fa2" />
          <stop offset="100%" stopColor="#4a148c" />
        </radialGradient>
      </defs>
      <path d="M28 14 C22 10 16 12 14 16" stroke="#2e7d32" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <ellipse cx="20" cy="14" rx="6" ry="3" fill="#66bb6a" stroke="#fff" strokeWidth="1.3" transform="rotate(-30 20 14)" />
      {[
        [26, 28],
        [36, 28],
        [46, 30],
        [22, 38],
        [32, 38],
        [42, 40],
        [28, 48],
        [38, 50],
      ].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="7" fill={`url(#${id}-g)`} stroke="#fff" strokeWidth="1.6" />
      ))}
    </Frame>
  );
}

export function SymSeven() {
  const id = useId().replace(/:/g, "");
  return (
    <Frame>
      <defs>
        <linearGradient id={`${id}-a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ff8a80" />
          <stop offset="45%" stopColor="#e53935" />
          <stop offset="100%" stopColor="#b71c1c" />
        </linearGradient>
        <linearGradient id={`${id}-b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffe082" />
          <stop offset="100%" stopColor="#ff8f00" />
        </linearGradient>
      </defs>
      <path
        d="M16 14 H48 L28 54 H20 L36 22 H16 Z"
        fill={`url(#${id}-a)`}
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <path
        d="M18 16 H46 L28 50 H24 L38 22 H18 Z"
        fill="none"
        stroke={`url(#${id}-b)`}
        strokeWidth="2"
        opacity="0.9"
      />
    </Frame>
  );
}

export function SymBell() {
  const id = useId().replace(/:/g, "");
  return (
    <Frame>
      <defs>
        <linearGradient id={`${id}-g`} x1="0.3" y1="0" x2="0.7" y2="1">
          <stop offset="0%" stopColor="#ffe082" />
          <stop offset="50%" stopColor="#ffc107" />
          <stop offset="100%" stopColor="#ff8f00" />
        </linearGradient>
      </defs>
      <path
        d="M32 10 C22 10 18 22 18 34 L14 42 H50 L46 34 C46 22 42 10 32 10 Z"
        fill={`url(#${id}-g)`}
        stroke="#fff"
        strokeWidth="2.2"
      />
      <rect x="28" y="8" width="8" height="6" rx="2" fill="#ffb300" stroke="#fff" strokeWidth="1.4" />
      <circle cx="32" cy="48" r="5" fill="#ffca28" stroke="#fff" strokeWidth="1.8" />
      <ellipse cx="26" cy="24" rx="4" ry="6" fill="#fff" opacity="0.35" />
    </Frame>
  );
}

export function SymSenseEye() {
  const id = useId().replace(/:/g, "");
  return (
    <Frame>
      <defs>
        <filter id={`${id}-f`}>
          <feGaussianBlur stdDeviation="1.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <radialGradient id={`${id}-g`} cx="35%" cy="30%" r="65%">
          <stop offset="0%" stopColor="#b9ffd6" />
          <stop offset="55%" stopColor="#5dde8a" />
          <stop offset="100%" stopColor="#1b7a45" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="26" fill="#0d1a14" stroke="#5dde8a" strokeWidth="2" opacity="0.35" />
      <g filter={`url(#${id}-f)`} fill="none" stroke="#5dde8a" strokeLinecap="round" strokeWidth="3">
        <path d="M12 30 C20 18 28 14 40 16 C48 18 54 24 56 28" />
        <path d="M14 34 C22 44 32 48 44 44 C50 42 54 38 56 34" />
      </g>
      <circle cx="34" cy="32" r="7" fill={`url(#${id}-g)`} stroke="#fff" strokeWidth="1.8" />
      <circle cx="36" cy="30" r="2" fill="#fff" opacity="0.7" />
    </Frame>
  );
}

export function SymStarScatter() {
  const id = useId().replace(/:/g, "");
  return (
    <Frame>
      <defs>
        <radialGradient id={`${id}-g`} cx="40%" cy="35%" r="60%">
          <stop offset="0%" stopColor="#fff9c4" />
          <stop offset="45%" stopColor="#ffd54f" />
          <stop offset="100%" stopColor="#ff8f00" />
        </radialGradient>
      </defs>
      <path
        d="M32 8 L36.5 24 L54 24 L40 34 L45 50 L32 40 L19 50 L24 34 L10 24 L27.5 24 Z"
        fill={`url(#${id}-g)`}
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="30" r="4" fill="#fffde7" opacity="0.55" />
    </Frame>
  );
}

export function SymBook() {
  const id = useId().replace(/:/g, "");
  return (
    <Frame>
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffe082" />
          <stop offset="50%" stopColor="#f0c14a" />
          <stop offset="100%" stopColor="#a67c00" />
        </linearGradient>
      </defs>
      <path
        d="M14 12 H34 C42 12 48 16 50 22 V52 C46 48 40 46 34 46 H14 Z"
        fill={`url(#${id}-g)`}
        stroke="#fff"
        strokeWidth="2.2"
      />
      <path d="M14 12 V46" stroke="#8d6e00" strokeWidth="3" strokeLinecap="round" />
      <circle cx="32" cy="30" r="6" fill="#5dde8a" stroke="#fff" strokeWidth="1.6" />
      <path d="M29 30 H35 M32 27 V33" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
    </Frame>
  );
}

export function SymAnkh() {
  const id = useId().replace(/:/g, "");
  return (
    <Frame>
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffe082" />
          <stop offset="100%" stopColor="#c9a227" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="18" r="9" fill="none" stroke={`url(#${id}-g)`} strokeWidth="5" />
      <circle cx="32" cy="18" r="9" fill="none" stroke="#fff" strokeWidth="1.8" />
      <rect x="14" y="26" width="36" height="5" rx="2" fill={`url(#${id}-g)`} stroke="#fff" strokeWidth="1.5" />
      <rect x="29" y="30" width="6" height="24" rx="2" fill={`url(#${id}-g)`} stroke="#fff" strokeWidth="1.5" />
    </Frame>
  );
}

export function SymScarab() {
  const id = useId().replace(/:/g, "");
  return (
    <Frame>
      <defs>
        <radialGradient id={`${id}-g`} cx="40%" cy="30%" r="60%">
          <stop offset="0%" stopColor="#80cbc4" />
          <stop offset="50%" stopColor="#00897b" />
          <stop offset="100%" stopColor="#004d40" />
        </radialGradient>
      </defs>
      <ellipse cx="32" cy="34" rx="16" ry="18" fill={`url(#${id}-g)`} stroke="#fff" strokeWidth="2.2" />
      <path d="M32 18 V50" stroke="#004d40" strokeWidth="2" opacity="0.5" />
      <path d="M20 28 Q32 34 44 28" stroke="#004d40" strokeWidth="1.8" fill="none" opacity="0.45" />
      <circle cx="26" cy="28" r="3" fill="#e0f2f1" />
      <circle cx="38" cy="28" r="3" fill="#e0f2f1" />
      <path d="M22 14 Q18 10 14 12" stroke="#00897b" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M42 14 Q46 10 50 12" stroke="#00897b" strokeWidth="2.2" fill="none" strokeLinecap="round" />
    </Frame>
  );
}

export function SymExplorer() {
  const id = useId().replace(/:/g, "");
  return (
    <Frame>
      <defs>
        <radialGradient id={`${id}-g`} cx="35%" cy="30%" r="60%">
          <stop offset="0%" stopColor="#b9ffd6" />
          <stop offset="55%" stopColor="#5dde8a" />
          <stop offset="100%" stopColor="#1b5e3a" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="20" fill="#142218" stroke="#fff" strokeWidth="2" />
      <circle cx="32" cy="32" r="12" fill={`url(#${id}-g)`} stroke="#fff" strokeWidth="2" />
      <circle cx="32" cy="32" r="5" fill="#0a1510" stroke="#5dde8a" strokeWidth="1.5" />
      <circle cx="35" cy="29" r="2" fill="#fff" opacity="0.7" />
    </Frame>
  );
}

export function SymBar() {
  const id = useId().replace(/:/g, "");
  return (
    <Frame>
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#eceff1" />
          <stop offset="45%" stopColor="#90a4ae" />
          <stop offset="100%" stopColor="#455a64" />
        </linearGradient>
      </defs>
      <rect x="8" y="20" width="48" height="24" rx="4" fill={`url(#${id}-g)`} stroke="#fff" strokeWidth="2.2" />
      <text
        x="32"
        y="38"
        textAnchor="middle"
        fontFamily="Space Grotesk, sans-serif"
        fontWeight="800"
        fontSize="16"
        fill="#fff"
        letterSpacing="1"
      >
        BAR
      </text>
    </Frame>
  );
}

export function SymJoker() {
  const id = useId().replace(/:/g, "");
  return (
    <Frame>
      <defs>
        <radialGradient id={`${id}-g`} cx="35%" cy="30%" r="65%">
          <stop offset="0%" stopColor="#ffe082" />
          <stop offset="50%" stopColor="#ff5252" />
          <stop offset="100%" stopColor="#b71c1c" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="24" fill={`url(#${id}-g)`} stroke="#fff" strokeWidth="2.4" />
      <circle cx="32" cy="28" r="10" fill="#fff3e0" stroke="#fff" strokeWidth="1.5" />
      <circle cx="28" cy="26" r="1.8" fill="#212121" />
      <circle cx="36" cy="26" r="1.8" fill="#212121" />
      <path d="M26 32 Q32 38 38 32" stroke="#c62828" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M18 14 Q22 8 28 12" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M46 14 Q42 8 36 12" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <text
        x="32"
        y="52"
        textAnchor="middle"
        fontFamily="Space Grotesk, sans-serif"
        fontWeight="800"
        fontSize="9"
        fill="#fff"
      >
        JOKER
      </text>
    </Frame>
  );
}

export function SymKrisKros() {
  const id = useId().replace(/:/g, "");
  return (
    <Frame>
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#b9ffd6" />
          <stop offset="50%" stopColor="#5dde8a" />
          <stop offset="100%" stopColor="#1b7a45" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="52" height="52" rx="12" fill={`url(#${id}-g)`} stroke="#fff" strokeWidth="2.4" />
      <path
        d="M18 18 L46 46 M46 18 L18 46"
        stroke="#fff"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path
        d="M18 18 L46 46 M46 18 L18 46"
        stroke="#0a3d22"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <text
        x="32"
        y="36"
        textAnchor="middle"
        fontFamily="Space Grotesk, sans-serif"
        fontWeight="800"
        fontSize="8"
        fill="#04140a"
      >
        KRIS
      </text>
    </Frame>
  );
}

export function SymRoyal({ letter }: { letter: string }) {
  const id = useId().replace(/:/g, "");
  const colors: Record<string, [string, string]> = {
    A: ["#90caf9", "#1565c0"],
    K: ["#ce93d8", "#6a1b9a"],
    Q: ["#f48fb1", "#ad1457"],
    J: ["#80cbc4", "#00695c"],
    "10": ["#ffcc80", "#ef6c00"],
  };
  const [a, b] = colors[letter] || ["#b0bec5", "#455a64"];
  return (
    <Frame>
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={a} />
          <stop offset="100%" stopColor={b} />
        </linearGradient>
      </defs>
      <rect x="10" y="10" width="44" height="44" rx="10" fill={`url(#${id}-g)`} stroke="#fff" strokeWidth="2.4" />
      <text
        x="32"
        y="40"
        textAnchor="middle"
        fontFamily="Space Grotesk, IBM Plex Sans, sans-serif"
        fontWeight="800"
        fontSize={letter === "10" ? "20" : "26"}
        fill="#fff"
        stroke="#000"
        strokeWidth="0.6"
      >
        {letter}
      </text>
    </Frame>
  );
}

const MAP: Record<string, () => ReactNode> = {
  cherry: () => <SymCherry />,
  lemon: () => <SymLemon />,
  orange: () => <SymOrange />,
  plum: () => <SymPlum />,
  watermelon: () => <SymWatermelon />,
  grapes: () => <SymGrapes />,
  seven: () => <SymSeven />,
  bell: () => <SymBell />,
  bar: () => <SymBar />,
  joker: () => <SymJoker />,
  kriskros: () => <SymKrisKros />,
  eye: () => <SymSenseEye />,
  scatter: () => <SymStarScatter />,
  book: () => <SymBook />,
  ankh: () => <SymAnkh />,
  scarab: () => <SymScarab />,
  explorer: () => <SymExplorer />,
  A: () => <SymRoyal letter="A" />,
  K: () => <SymRoyal letter="K" />,
  Q: () => <SymRoyal letter="Q" />,
  J: () => <SymRoyal letter="J" />,
  "10": () => <SymRoyal letter="10" />,
};

export function SlotSymbol({ id, className = "" }: { id: string; className?: string }) {
  const Comp = MAP[id];
  return (
    <span className={`slot-sym ${className}`} data-sym={id}>
      {Comp ? <Comp /> : <span className="slot-sym__fallback">{id}</span>}
    </span>
  );
}
