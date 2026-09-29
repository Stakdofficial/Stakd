"use client";

import type { LighterMarket } from "@/lib/lighter";

// Markets shown on the homepage tile, in order; Lighter lists gold as XAU.
const SHOW: { s: string; name: string; kind: string; logo?: string; mark?: string; c: [string, string] }[] = [
  { s: "SPY", name: "S&P 500", kind: "stock", mark: "S&P", c: ["#1e40af", "#3b82f6"] },
  { s: "NVDA", name: "Nvidia", kind: "stock", logo: "nvidia", c: ["#3f7d12", "#76b900"] },
  { s: "BTC", name: "Bitcoin", kind: "crypto", logo: "bitcoin", c: ["#c2650a", "#f7931a"] },
  { s: "XAU", name: "Gold", kind: "commodity", mark: "Au", c: ["#a47a12", "#e6b422"] },
  { s: "AAPL", name: "Apple", kind: "stock", logo: "apple", c: ["#3a3f4b", "#8e96a5"] },
  { s: "ETH", name: "Ether", kind: "crypto", logo: "ethereum", c: ["#3c3c8d", "#7b83eb"] },
  { s: "TSLA", name: "Tesla", kind: "stock", logo: "tesla", c: ["#8f1d21", "#e82127"] },
];

const money = (v: number) =>
  "$" + v.toLocaleString("en-US", { minimumFractionDigits: v >= 1000 ? 0 : 2, maximumFractionDigits: v >= 1000 ? 0 : 2 });

/** Live Lighter prices for a handful of well-known markets, with the day's move and range. */
export function MarketTiles({ markets }: { markets?: LighterMarket[] }) {
  const bySym = new Map((markets ?? []).map((m) => [m.symbol, m]));
  const shown = new Set(SHOW.map((x) => x.s));
  const more = (markets ?? [])
    .filter((m) => !shown.has(m.symbol))
    .sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0))
    .slice(0, 8);
  return (
    <div className="mkts">
      {SHOW.map((x) => {
        const m = bySym.get(x.s);
        const ch = m?.change24h ?? 0;
        const lo = m?.low24h || m?.price || 0;
        const hi = m?.high24h || m?.price || 0;
        const pos = m ? Math.max(4, Math.min(96, ((m.price - lo) / (hi - lo || 1)) * 100)) : 50;
        return (
          <div key={x.s} className={`mk k-${x.kind}`}>
            <div className="mk-top">
              <span className={`ico ${x.logo ? "" : "txt"}`} style={{ background: `linear-gradient(145deg, ${x.c[1]}, ${x.c[0]})` }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {x.logo ? <img src={`/markets/${x.logo}.svg`} alt="" /> : x.mark}
              </span>
              <span className="mk-nm">
                <b>{x.s === "XAU" ? "GOLD" : x.s}</b>
                <small>{x.name}</small>
              </span>
              <em className="kind">{x.kind}</em>
            </div>
            <div className="px">
              <strong>{m ? money(m.price) : "—"}</strong>
              {m && (
                <span className={`chg ${ch >= 0 ? "u" : "d"}`}>
                  {ch >= 0 ? "▲" : "▼"} {Math.abs(ch).toFixed(2)}%
                </span>
              )}
            </div>
            <div className="rng">
              <div className="bar">
                <i style={{ left: `${pos}%` }} />
              </div>
              <div className="lh">
                <span>L {m ? money(lo) : "—"}</span>
                <span>H {m ? money(hi) : "—"}</span>
              </div>
            </div>
          </div>
        );
      })}
      <div className="mk more">
        <div className="n">
          +{Math.max(0, (markets?.length ?? 57) - SHOW.length)}
          <small>more markets on Lighter</small>
        </div>
        <div className="tk">
          {more.map((m) => (
            <span key={m.symbol}>{m.symbol}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
