"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type ShowLeg = { sym: string; long: boolean; w: number; lev: number };
const BASKETS: { name: string; ticker: string; tagline: string; legs: ShowLeg[] }[] = [
  {
    name: "Index + Crypto",
    ticker: "idx",
    tagline: "S&P 500 with bitcoin and ether, 2x long",
    legs: [
      { sym: "SPY", long: true, w: 40, lev: 2 },
      { sym: "BTC", long: true, w: 30, lev: 2 },
      { sym: "ETH", long: true, w: 30, lev: 2 },
    ],
  },
  {
    name: "AI vs Market",
    ticker: "ai",
    tagline: "Long AI leaders, short the S&P 500",
    legs: [
      { sym: "NVDA", long: true, w: 35, lev: 3 },
      { sym: "AMD", long: true, w: 15, lev: 3 },
      { sym: "MSFT", long: true, w: 10, lev: 2 },
      { sym: "SPY", long: false, w: 40, lev: 2 },
    ],
  },
  {
    name: "Hard Assets",
    ticker: "hard",
    tagline: "Gold, bitcoin and oil",
    legs: [
      { sym: "XAU", long: true, w: 40, lev: 3 },
      { sym: "BTC", long: true, w: 40, lev: 2 },
      { sym: "WTI", long: true, w: 20, lev: 2 },
    ],
  },
  {
    name: "Mega-cap Tech",
    ticker: "tech",
    tagline: "Six mega-cap stocks, equal weight",
    legs: ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META"].map((sym, i) => ({ sym, long: true, w: i < 4 ? 17 : 16, lev: 2 })),
  },
];

export function BasketShowcase() {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setI((x) => (x + 1) % BASKETS.length), 3600);
    return () => clearInterval(id);
  }, [paused]);

  const b = BASKETS[i];
  const eff = b.legs.reduce((s, l) => s + (l.w / 100) * l.lev, 0);

  return (
    <div className="showcase" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="showcase-tabs" role="tablist">
        {BASKETS.map((x, j) => (
          <button key={x.ticker} role="tab" aria-selected={i === j} className={i === j ? "on" : ""} onClick={() => setI(j)}>
            {x.name}
            {i === j && !paused && <span className="tab-progress" key={`p-${i}`} />}
          </button>
        ))}
      </div>

      <div className="showcase-card" key={b.ticker}>
        <div className="spread">
          <div className="row">
            <div className="avatar basket-icon" aria-hidden>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="m7 15 4-4 3 3 6-6" /></svg>
            </div>
            <div>
              <strong style={{ fontSize: 18 }}>{b.name}</strong>
              <div className="muted small">{b.tagline}</div>
            </div>
          </div>
          <span className="chip chip-soft mono">{eff.toFixed(1)}x effective</span>
        </div>

        <div className="showcase-legs">
          {b.legs.map((l, j) => (
            <div className="showcase-leg" key={l.sym} style={{ animationDelay: `${j * 70}ms` }}>
              <span className={`chip ${l.long ? "chip-long" : "chip-short"}`} style={{ width: 64, justifyContent: "center" }}>
                {l.long ? "LONG" : "SHORT"}
              </span>
              <b className="leg-sym">{l.sym}</b>
              <div className="bar grow">
                <div className={l.long ? "" : "short"} style={{ width: `${l.w * 2}%`, animationDelay: `${120 + j * 70}ms` }} />
              </div>
              <span className="mono small" style={{ width: 70, textAlign: "right" }}>
                {l.w}% · {l.lev}x
              </span>
            </div>
          ))}
        </div>

        <div className="spread small" style={{ marginTop: 20 }}>
          <span className="muted">Every $100 of margin → ${(eff * 100).toFixed(0)} of exposure</span>
          <Link href="/create" className="link-arrow">
            Build your own →
          </Link>
        </div>
      </div>
    </div>
  );
}
