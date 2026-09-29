"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CoinTile } from "@/components/CoinTile";
import { useCoins, useEthPrice, useMarkets } from "@/lib/hooks";
import { burnedPct, marketCapUsd, pct, usd, usePlatformStats } from "@/lib/stats";

type Filter = "all" | "vol" | "trading" | "burning" | "stocks" | "short";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Newest" },
  { key: "vol", label: "Top volume" },
  { key: "trading", label: "Trading" },
  { key: "burning", label: "Burning" },
  { key: "stocks", label: "Has stocks" },
  { key: "short", label: "Has shorts" },
];

/** Every coin launched on Stakd: a podium of the biggest burners, then a searchable, filterable grid. */
export default function CoinsPage() {
  const { coins, isLoading, error } = useCoins();
  const markets = useMarkets();
  const stats = usePlatformStats();
  const ethUsd = useEthPrice().data;
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const per = stats.data?.perCoin;
  const byId = markets.data?.byId;

  const podium = useMemo(() => [...(coins ?? [])].sort((a, b) => burnedPct(b) - burnedPct(a)).slice(0, 3), [coins]);

  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    const out = (coins ?? []).filter((c) => {
      const syms = c.legs.map((l) => byId?.get(l.marketId)?.symbol ?? "");
      if (filter === "vol" && !((per?.[c.token.toLowerCase()]?.volumeEth ?? 0) > 0)) return false;
      if (filter === "trading" && c.totalMarginDeposited === 0n) return false;
      if (filter === "burning" && burnedPct(c) <= 0) return false;
      if (filter === "stocks" && !c.legs.some((l) => byId?.get(l.marketId)?.kind === "stock")) return false;
      if (filter === "short" && !c.legs.some((l) => !l.isLong)) return false;
      if (query && !`${c.name} ${c.symbol} ${syms.join(" ")}`.toLowerCase().includes(query)) return false;
      return true;
    });
    if (filter === "vol") out.sort((a, b) => (per?.[b.token.toLowerCase()]?.volumeEth ?? 0) - (per?.[a.token.toLowerCase()]?.volumeEth ?? 0));
    else out.sort((a, b) => b.createdAt - a.createdAt);
    return out;
  }, [coins, filter, q, per, byId]);

  return (
    <div className="home coins-page">
      <div className="cp-head">
        <div>
          <span className="eyebrow">Live market</span>
          <h1 className="cp-title">
            Every coin.
            <br />
            <span className="gradient-text">Every fund.</span>
          </h1>
        </div>
        <p className="h-lede">
          Each coin below runs its own leveraged portfolio. Tap one to see what it&apos;s holding and how much of itself it
          has burned.
        </p>
      </div>

      {error ? (
        <div className="alert alert-error">{error.message.split("\n")[0]}</div>
      ) : isLoading || !coins ? (
        <div className="empty">Loading coins…</div>
      ) : coins.length === 0 ? (
        <div className="card empty">
          No coins yet. <Link href="/create">Launch the first one →</Link>
        </div>
      ) : (
        <>
          <div className="podium-title">
            <h2>🔥 Top burners</h2>
            <span>share of supply destroyed</span>
          </div>
          <div className="podium">
            {podium.map((c, i) => {
              const v = per?.[c.token.toLowerCase()];
              return (
                <Link key={c.token} href={`/coin/${c.token}`} className="pod">
                  <span className="rank">#{i + 1}</span>
                  {c.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="pic" src={c.image} alt="" />
                  )}
                  <div className="tk">${c.symbol}</div>
                  <div className="nm">{c.name}</div>
                  <div className="pct">{pct(burnedPct(c))}</div>
                  <div className="lbl">of its supply burned</div>
                  <div className="vol">
                    {v && ethUsd ? usd(v.volumeEth * ethUsd) : "—"} traded · {usd(marketCapUsd(c, v, ethUsd))} mkt cap
                  </div>
                </Link>
              );
            })}
          </div>

          <div className="cp-bar">
            <label className="cp-search">
              <span aria-hidden>⌕</span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search coins, tickers or markets (e.g. NVDA)" />
            </label>
            <div className="cp-filters" role="tablist">
              {FILTERS.map((f) => (
                <button key={f.key} role="tab" aria-selected={filter === f.key} className={filter === f.key ? "on" : ""} onClick={() => setFilter(f.key)}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {list.length ? (
            <div className="ct-grid">
              {list.map((c) => (
                <CoinTile key={c.token} coin={c} markets={byId} volume={per?.[c.token.toLowerCase()]} ethUsd={ethUsd} />
              ))}
            </div>
          ) : (
            <div className="card empty">No coins match that.</div>
          )}
          <p className="h-note left">
            {coins.length} coins · volume and market cap read from Robinhood Chain{stats.isLoading ? " (loading…)" : ""}.
          </p>
        </>
      )}
    </div>
  );
}
