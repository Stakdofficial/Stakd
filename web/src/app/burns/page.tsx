"use client";

import { formatUnits, parseAbiItem, type Address } from "viem";
import { usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ETH_DECIMALS, explorerTx, TOKEN_DECIMALS } from "@/lib/config";
import { useCoins, useEthPrice, type CoinSummary } from "@/lib/hooks";
import { formatUsd } from "@/lib/lighter";

/**
 * Proof of burn: every buyback-and-burn ever made, read from the treasuries' BuybackAndBurn events.
 * Nothing here comes from our database — each row links to the transaction on the explorer.
 */

const burnEvent = parseAbiItem("event BuybackAndBurn(uint256 ethSpent, uint256 tokensBurned)");

// Robinhood Chain makes ~10 blocks a second; the RPC serves ~1M blocks (~28h) per request.
const CHUNK = 1_000_000n;
const MAX_CHUNKS = 8n; // ~9 days, comfortably past the first Stakd launch

type Burn = { key: string; treasury: Address; eth: number; tokens: number; block: bigint; hash: `0x${string}` };

export default function BurnsPage() {
  const client = usePublicClient();
  const coins = useCoins();
  const ethPrice = useEthPrice();
  const usdPerEth = ethPrice.data ?? 0;
  const list = coins.coins ?? [];
  const treasuries = list.map((c: CoinSummary) => c.treasury);

  const burns = useQuery({
    queryKey: ["burns", treasuries.join(",")],
    enabled: !!client && treasuries.length > 0,
    refetchInterval: 60_000,
    queryFn: async (): Promise<Burn[]> => {
      if (!client) return [];
      const head = await client.getBlockNumber();
      const out: Burn[] = [];
      for (let i = 0n; i < MAX_CHUNKS; i++) {
        const toBlock = head - i * CHUNK;
        if (toBlock <= 0n) break;
        const fromBlock = toBlock > CHUNK ? toBlock - CHUNK : 0n;
        const logs = await client.getLogs({ address: treasuries, event: burnEvent, fromBlock, toBlock });
        for (const l of logs) {
          out.push({
            key: `${l.transactionHash}-${l.logIndex}`,
            treasury: l.address as Address,
            eth: Number(formatUnits(l.args.ethSpent ?? 0n, ETH_DECIMALS)),
            tokens: Number(formatUnits(l.args.tokensBurned ?? 0n, TOKEN_DECIMALS)),
            block: l.blockNumber,
            hash: l.transactionHash,
          });
        }
        if (fromBlock === 0n) break;
      }
      return out.sort((a, b) => Number(b.block - a.block));
    },
  });

  const byTreasury = new Map<string, CoinSummary>(list.map((c: CoinSummary) => [c.treasury.toLowerCase(), c]));
  const rows = burns.data ?? [];
  const totalEth = rows.reduce((s, b) => s + b.eth, 0);
  const coinsWithBurns = new Set(rows.map((b) => b.treasury.toLowerCase())).size;
  // Supply burned is per coin, so totals are shown per coin rather than added together.
  const perCoin = list
    .map((c: CoinSummary) => ({ coin: c, burned: Number(formatUnits(c.totalTokensBurned, TOKEN_DECIMALS)), eth: Number(formatUnits(c.totalBuybackEth, ETH_DECIMALS)) }))
    .filter((x: { burned: number }) => x.burned > 0)
    .sort((a: { eth: number }, b: { eth: number }) => b.eth - a.eth);

  return (
    <div className="stack">
      <div className="stack" style={{ gap: 6 }}>
        <h1>Proof of burn</h1>
        <p className="muted">
          Every Stakd coin puts 75% of its portfolio profits into buying itself back and burning the tokens. Every burn below is a real
          transaction on Robinhood Chain. Click any row to check it on the explorer.
        </p>
      </div>

      <div className="stats" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
        <Stat k="Burns so far" v={burns.isLoading ? "…" : rows.length.toLocaleString("en-US")} />
        <Stat k="ETH spent on buybacks" v={`${totalEth.toLocaleString("en-US", { maximumFractionDigits: 4 })} ETH`} />
        <Stat k="Value bought back" v={usdPerEth ? formatUsd(totalEth * usdPerEth) : "—"} />
        <Stat k="Coins that have burned" v={`${coinsWithBurns} of ${list.length}`} />
      </div>

      {perCoin.length > 0 && (
        <div className="card stack">
          <h3>Burned per coin</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Coin</th>
                  <th>Tokens burned</th>
                  <th>Share of supply</th>
                  <th>ETH spent</th>
                </tr>
              </thead>
              <tbody>
                {perCoin.map(({ coin, burned, eth }) => (
                  <tr key={coin.token}>
                    <td>
                      <Link href={`/coin/${coin.token}`} style={{ color: "var(--blue-600)", fontWeight: 700 }}>
                        {coin.symbol}
                      </Link>
                    </td>
                    <td className="mono">{burned.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 })}</td>
                    <td className="mono">{((burned / Number(formatUnits(coin.totalSupply, TOKEN_DECIMALS))) * 100).toFixed(3)}%</td>
                    <td className="mono">{eth.toLocaleString("en-US", { maximumFractionDigits: 5 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card stack">
        <h3>Burn history</h3>
        {burns.isLoading ? (
          <div className="muted small">Reading burns from the chain…</div>
        ) : rows.length === 0 ? (
          <div className="muted small">
            No burns yet. A coin burns once its portfolio is 10% above its high-water mark, and 75% of that profit buys the coin back.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Coin</th>
                  <th>Tokens burned</th>
                  <th>ETH spent</th>
                  <th>Value</th>
                  <th>Proof</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => {
                  const coin = byTreasury.get(b.treasury.toLowerCase());
                  return (
                    <tr key={b.key}>
                      <td>
                        {coin ? (
                          <Link href={`/coin/${coin.token}`} style={{ color: "var(--blue-600)", fontWeight: 700 }}>
                            {coin.symbol}
                          </Link>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="mono">{b.tokens.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 })}</td>
                      <td className="mono">{b.eth.toLocaleString("en-US", { maximumFractionDigits: 5 })}</td>
                      <td>{usdPerEth ? formatUsd(b.eth * usdPerEth) : "—"}</td>
                      <td>
                        <a href={explorerTx(b.hash)} target="_blank" rel="noreferrer" style={{ color: "var(--blue-600)" }}>
                          View transaction ↗
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="stat card" style={{ boxShadow: "none" }}>
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}
