"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CreditsSnapshot,
  TOP_UP_PACKS,
  getCredits,
  subscribeCredits,
  topUpCredits,
} from "@/lib/credits";
import { slotAudio } from "@/lib/slotAudio";

export function useCredits() {
  const [snap, setSnap] = useState<CreditsSnapshot>(() =>
    typeof window === "undefined"
      ? { balance: 10_000, lifetimeWon: 0, lifetimeSpent: 0 }
      : getCredits()
  );

  useEffect(() => {
    setSnap(getCredits());
    return subscribeCredits(setSnap);
  }, []);

  const topUp = useCallback((amount: number) => {
    slotAudio.coin();
    setSnap(topUpCredits(amount));
  }, []);

  return { ...snap, topUp, packs: TOP_UP_PACKS };
}

export function CreditsBar({ compact }: { compact?: boolean }) {
  const { balance, topUp, packs } = useCredits();
  const [open, setOpen] = useState(false);

  return (
    <div className={`credits-bar ${compact ? "credits-bar--compact" : ""}`}>
      <div className="credits-bar__balance" title="Sense Coins">
        <span className="credits-bar__coin" aria-hidden>
          SC
        </span>
        <span className="credits-bar__amount tabular-nums">{balance.toLocaleString("cs-CZ")}</span>
      </div>
      <button type="button" className="btn btn-primary text-xs" onClick={() => setOpen((v) => !v)}>
        Doplnit
      </button>
      {open && (
        <div className="credits-bar__packs">
          {packs.map((p) => (
            <button
              key={p.id}
              type="button"
              className="btn text-xs"
              onClick={() => {
                topUp(p.amount);
                setOpen(false);
              }}
            >
              +{p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
