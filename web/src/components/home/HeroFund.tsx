"use client";

import Link from "next/link";
import type { CoinSummary } from "@/lib/hooks";
import { useLighterAccount } from "@/lib/hooks";
import { formatUsd } from "@/lib/lighter";
import { burnedPct, legRing, pct, usd, type PlatformStats } from "@/lib/stats";

/**
 * The hero's live exhibit: the busiest coin that is actually trading, with its real Lighter fund — equity, open
 * positions and P&L — and two more real coins stacked behind it.
 */
export function HeroFund({ coins, stats, ethUsd }: { coins?: CoinSummary[]; stats?: PlatformStats; ethUsd?: number }) {
  const vol = (c: CoinSummary) => stats?.perCoin?.[c.token.toLowerCase()]?.volumeEth ?? 0;
  const ranked = [...(coins ?? [])].filter((c) => c.lighterAccountSet).sort((a, b) => vol(b) - vol(a));
  const lead = ranked[0];
  const behind = ranked.slice(1, 3);
  const account = useLighterAccount(lead?.lighterAccountIndex, !!lead);
  const fund = account.data;
  const pnl = fund?.positions.reduce((s, p) => s + p.unrealizedPnl, 0) ?? 0;

  if (!lead) return <div className="hf hf-skeleton" aria-hidden />;

  return (
    <div className="hf">
      {behind.map((c, i) => (
        <Link key={c.token} href={`/coin/${c.token}`} className={`hf-ghost g${i}`} aria-label={`$${c.symbol}`}>
          <Avatar coin={c} size={40} />
          <b>${c.symbol}</b>
          <span className="fire">{pct(burnedPct(c))} burned</span>
        </Link>
      ))}

      <Link href={`/coin/${lead.token}`} className="hf-card">
        <div className="hf-top">
          <Avatar coin={lead} size={58} />
          <div className="hf-id">
            <b>${lead.symbol}</b>
            <span>{lead.name}</span>
          </div>
          <span className="hf-live">
            <i /> live fund
          </span>
        </div>

        <div className="hf-eq">
          <span>Fund value</span>
          <b>{fund ? formatUsd(fund.equity) : "…"}</b>
          {fund && (
            <em className={pnl >= 0 ? "up" : "dn"}>
              {pnl >= 0 ? "▲" : "▼"} {formatUsd(Math.abs(pnl))} open P&amp;L
            </em>
          )}
        </div>

        <div className="hf-pos">
          {(fund?.positions ?? []).slice(0, 4).map((p) => {
            const long = p.size >= 0;
            return (
              <div key={p.marketId}>
                <span className={`side ${long ? "l" : "s"}`}>{long ? "LONG" : "SHORT"}</span>
                <b>{p.symbol}</b>
                <span className="val">{formatUsd(p.value)}</span>
                <span className={`pnl ${p.unrealizedPnl >= 0 ? "up" : "dn"}`}>
                  {p.unrealizedPnl >= 0 ? "+" : "−"}
                  {formatUsd(Math.abs(p.unrealizedPnl))}
                </span>
              </div>
            );
          })}
          {!fund && <div className="hf-wait">Reading positions from Lighter…</div>}
        </div>

        <div className="hf-foot">
          <div>
            <span>Volume</span>
            <b>{ethUsd ? usd(vol(lead) * ethUsd) : "—"}</b>
          </div>
          <div>
            <span>Burned</span>
            <b className="fire">{pct(burnedPct(lead))}</b>
          </div>
          <div className="go">View coin →</div>
        </div>
      </Link>
    </div>
  );
}

function Avatar({ coin, size }: { coin: CoinSummary; size: number }) {
  return (
    <span className="hf-av" style={{ width: size, height: size, background: legRing(coin.legs) }}>
      {coin.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={coin.image} alt="" />
      ) : (
        <em>{coin.symbol.slice(0, 2)}</em>
      )}
    </span>
  );
}
