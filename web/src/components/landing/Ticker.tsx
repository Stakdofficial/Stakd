"use client";

import { useMarkets } from "@/lib/hooks";
import { formatUsd } from "@/lib/lighter";

const FEATURED = ["SPY", "QQQ", "NVDA", "TSLA", "AAPL", "MSFT", "META", "AMZN", "GOOGL", "COIN", "BTC", "ETH", "SOL", "HYPE", "XRP", "XAU", "WTI", "DOGE"];

/** Infinite scrolling strip of live Lighter perp prices. */
export function Ticker() {
  const { data } = useMarkets();
  const items = FEATURED.map((s) => data?.list.find((m) => m.symbol === s)).filter((m) => m !== undefined);
  const list = items.length ? items : FEATURED.map((symbol) => ({ symbol, price: 0, kind: "other" as const, marketId: 0, maxLeverage: 0 }));

  return (
    <div className="ticker" aria-label="Live Lighter perpetual prices">
      <div className="ticker-track">
        {[0, 1].map((copy) => (
          <div className="ticker-group" key={copy} aria-hidden={copy === 1}>
            {list.map((m) => (
              <span className="ticker-item" key={`${copy}-${m.symbol}`}>
                <span className={`ticker-kind ${m.kind}`}>{m.kind === "stock" ? "STOCK" : m.kind === "crypto" ? "CRYPTO" : "PERP"}</span>
                <b>{m.symbol}</b>
                <span className="mono muted">{m.price ? formatUsd(m.price, m.price < 1 ? 4 : 2) : "—"}</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
