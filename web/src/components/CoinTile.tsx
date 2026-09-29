"use client";

import Link from "next/link";
import { FACTORY, FACTORY_VERSION } from "@/lib/config";
import type { CoinSummary } from "@/lib/hooks";
import type { LighterMarket } from "@/lib/lighter";
import { burnedPct, coinLeverage, legRing, marketCapUsd, pct, usd, type CoinVolume } from "@/lib/stats";

/** One coin as a card: its portfolio ring and picture, legs, dollar volume and market cap, and how much it has burned. */
export function CoinTile({
  coin,
  markets,
  volume,
  ethUsd,
}: {
  coin: CoinSummary;
  markets?: Map<number, LighterMarket>;
  volume?: CoinVolume;
  ethUsd?: number;
}) {
  const burned = burnedPct(coin);
  const trading = coin.totalMarginDeposited > 0n;
  const mcap = marketCapUsd(coin, volume, ethUsd);
  return (
    <Link href={`/coin/${coin.token}`} className="ct">
      <div className="ct-top">
        <div className="ct-ring" style={{ background: legRing(coin.legs) }}>
          {coin.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coin.image} alt="" loading="lazy" />
          ) : (
            <span>{coin.symbol.slice(0, 2)}</span>
          )}
        </div>
        <div className="ct-name">
          <b>${coin.symbol}</b>
          <span>
            {coin.name}
            {coin.factory.toLowerCase() === FACTORY.toLowerCase() && <em>{FACTORY_VERSION}</em>}
          </span>
        </div>
        <div className="ct-lev">
          {coinLeverage(coin.legs).toFixed(1)}x<small>leverage</small>
        </div>
      </div>
      <div className="ct-legs">
        {coin.legs.slice(0, 3).map((l) => (
          <span key={l.marketId} className={l.isLong ? "" : "s"}>
            {l.isLong ? "▲" : "▼"} {markets?.get(l.marketId)?.symbol ?? `#${l.marketId}`}
            <b>
              {l.weightBps / 100}%·{l.leverageX10 / 10}x
            </b>
          </span>
        ))}
        {coin.legs.length > 3 && <span className="more">+{coin.legs.length - 3}</span>}
      </div>
      <div className="ct-money">
        <div>
          <span>Volume</span>
          <b>{volume && ethUsd ? usd(volume.volumeEth * ethUsd) : "—"}</b>
        </div>
        <div>
          <span>Mkt cap</span>
          <b>{usd(mcap)}</b>
        </div>
        <div>
          <span>Trades</span>
          <b>{volume?.trades ? volume.trades.toLocaleString("en-US") : "—"}</b>
        </div>
      </div>
      <div className="ct-foot">
        <div className="ct-burn">
          <div className="t">
            <span>burned</span>
            <b>{pct(burned)}</b>
          </div>
          <div className="track">
            <i style={{ width: `${Math.min(100, Math.max(burned > 0 ? 2 : 0, burned * 5))}%` }} />
          </div>
        </div>
        <span className={`ct-status ${trading ? "live" : ""}`}>{trading ? "Trading" : "Collecting"}</span>
      </div>
    </Link>
  );
}
