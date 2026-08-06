"use client";

const KEY = "stocksense_sense_coins_v1";
const START = 10_000;

export type CreditsSnapshot = {
  balance: number;
  lifetimeWon: number;
  lifetimeSpent: number;
};

function read(): CreditsSnapshot {
  if (typeof window === "undefined") {
    return { balance: START, lifetimeWon: 0, lifetimeSpent: 0 };
  }
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { balance: START, lifetimeWon: 0, lifetimeSpent: 0 };
    const parsed = JSON.parse(raw) as Partial<CreditsSnapshot>;
    return {
      balance: Math.max(0, Number(parsed.balance) || START),
      lifetimeWon: Math.max(0, Number(parsed.lifetimeWon) || 0),
      lifetimeSpent: Math.max(0, Number(parsed.lifetimeSpent) || 0),
    };
  } catch {
    return { balance: START, lifetimeWon: 0, lifetimeSpent: 0 };
  }
}

function write(snap: CreditsSnapshot) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(snap));
  window.dispatchEvent(new CustomEvent("sense-credits", { detail: snap }));
}

export function getCredits(): CreditsSnapshot {
  return read();
}

export function subscribeCredits(cb: (s: CreditsSnapshot) => void): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<CreditsSnapshot>).detail;
    cb(detail ?? read());
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb(read());
  };
  window.addEventListener("sense-credits", handler);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener("sense-credits", handler);
    window.removeEventListener("storage", onStorage);
  };
}

export function topUpCredits(amount: number): CreditsSnapshot {
  const cur = read();
  const next = { ...cur, balance: cur.balance + Math.max(0, Math.floor(amount)) };
  write(next);
  return next;
}

export function spendCredits(amount: number): CreditsSnapshot | null {
  const cur = read();
  const cost = Math.max(0, Math.floor(amount));
  if (cur.balance < cost) return null;
  const next = {
    balance: cur.balance - cost,
    lifetimeSpent: cur.lifetimeSpent + cost,
    lifetimeWon: cur.lifetimeWon,
  };
  write(next);
  return next;
}

export function awardCredits(amount: number): CreditsSnapshot {
  const cur = read();
  const win = Math.max(0, Math.floor(amount));
  const next = {
    balance: cur.balance + win,
    lifetimeWon: cur.lifetimeWon + win,
    lifetimeSpent: cur.lifetimeSpent,
  };
  write(next);
  return next;
}

export const TOP_UP_PACKS = [
  { id: "small", label: "5 000 SC", amount: 5_000 },
  { id: "mid", label: "25 000 SC", amount: 25_000 },
  { id: "big", label: "100 000 SC", amount: 100_000 },
] as const;
