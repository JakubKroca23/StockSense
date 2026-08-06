"use client";

import Link from "next/link";
import { CreditsBar } from "@/components/games/CreditsBar";

const GAMES = [
  {
    href: "/zabava/sense-me",
    title: "Sense Me",
    blurb: "Klasický Joker 27 / Kris Kros — 3 válce, joker wild, kris-kros free spins.",
    badge: "Joker 27",
    tone: "dazzle" as const,
  },
  {
    href: "/zabava/book-of-sense",
    title: "Book of Sense",
    blurb: "Kniha Sense — expanding special symbol, free spins a zlatý book wild.",
    badge: "Book",
    tone: "book" as const,
  },
];

export default function ZabavaPage() {
  return (
    <div className="zabava-hub space-y-5">
      <section className="rise flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="display text-3xl sm:text-4xl">Zábava</h1>
          <p className="muted mt-1 max-w-xl">
            Herní koutek StockSense — virtuální Sense Coins, žádné reálné sázky.
          </p>
        </div>
        <CreditsBar />
      </section>

      <div className="zabava-grid">
        {GAMES.map((g) => (
          <Link key={g.href} href={g.href} className={`zabava-card zabava-card--${g.tone}`}>
            <span className="zabava-card__badge">{g.badge}</span>
            <h2 className="display text-2xl">{g.title}</h2>
            <p className="muted text-sm leading-relaxed">{g.blurb}</p>
            <span className="zabava-card__cta">Hrát →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
