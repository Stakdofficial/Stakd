"use client";

import { useQuery } from "@tanstack/react-query";
import { useEthPrice } from "@/lib/hooks";
import { Reveal } from "./motion";

type Stats = {
  coins: number;
  trades: number;
  volumeEth: number;
  feesEth: number;
  creatorEth: number;
  marginEth: number;
  buybackEth: number;
  updatedAt: number;
};

const ethStr = (v: number) => `${v.toLocaleString("en-US", { maximumFractionDigits: v >= 100 ? 0 : v >= 10 ? 1 : 2 })} ETH`;
const usdStr = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD", notation: v >= 100_000 ? "compact" : "standard", maximumFractionDigits: v >= 100_000 ? 1 : 0 });

/** Live platform totals across every Stakd factory, read from the chain by /api/stats. */
export function PlatformStats() {
  const stats = useQuery({
    queryKey: ["platform-stats"],
    queryFn: async () => {
      const res = await fetch("/api/stats");
      if (!res.ok) throw new Error("stats unavailable");
      return (await res.json()) as Stats;
    },
    refetchInterval: 60_000,
  });
  const usd = useEthPrice().data ?? 0;
  const s = stats.data;

  const tiles: { k: string; v: string; sub?: string }[] = s
    ? [
        { k: "Coins launched", v: s.coins.toLocaleString("en-US"), sub: `${s.trades.toLocaleString("en-US")} trades` },
        { k: "Trading volume", v: ethStr(s.volumeEth), sub: usd ? usdStr(s.volumeEth * usd) : undefined },
        { k: "Fees earned", v: ethStr(s.feesEth), sub: usd ? usdStr(s.feesEth * usd) : undefined },
        { k: "Sent to Lighter", v: ethStr(s.marginEth), sub: usd ? `${usdStr(s.marginEth * usd)} of trading margin` : "trading margin" },
        { k: "Bought back & burned", v: ethStr(s.buybackEth), sub: usd ? usdStr(s.buybackEth * usd) : undefined },
        { k: "Paid to creators", v: ethStr(s.creatorEth), sub: usd ? usdStr(s.creatorEth * usd) : undefined },
      ]
    : [];

  return (
    <section className="section" id="stats">
      <Reveal className="section-head">
        <span className="eyebrow">
          <span className="live-dot" /> Live on-chain
        </span>
        <h2 className="section-title">Stakd by the numbers</h2>
        <p className="lead center">Every figure is read from Robinhood Chain across all Stakd coins, and refreshes every few minutes.</p>
      </Reveal>
      {stats.isError ? (
        <div className="card empty">Stats are taking a moment to load. Try again shortly.</div>
      ) : !s ? (
        <div className="empty">Loading live stats…</div>
      ) : (
        <div className="platform-stats">
          {tiles.map((t, i) => (
            <Reveal key={t.k} delay={i * 70} className="platform-stat">
              <div className="k">{t.k}</div>
              <div className="v">{t.v}</div>
              {t.sub && <div className="sub">{t.sub}</div>}
            </Reveal>
          ))}
        </div>
      )}
    </section>
  );
}
