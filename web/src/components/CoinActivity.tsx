"use client";

import { useState } from "react";
import { formatUnits, parseAbiItem, type Address, type Hex } from "viem";
import { usePublicClient } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { ETH_DECIMALS, explorerAddress, explorerTx, POOL_MANAGER, TOKEN_DECIMALS } from "@/lib/config";
import { formatUsd } from "@/lib/lighter";

/**
 * Recent trades and top holders for a coin.
 * Trades come straight from the PoolManager's Swap events for the coin's pool; the trader is the transaction
 * sender, since the event's `sender` is the router. Holders come from /api/holders (GoPlus, cached server-side).
 */

const swapEvent = parseAbiItem(
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
);

// Every burn this coin has ever done: profit, or a fee from a buy that came from another chain, spent on
// buying the coin back and destroying it.
const burnEvent = parseAbiItem("event BuybackAndBurn(uint256 ethSpent, uint256 tokensBurned)");

// Robinhood Chain makes ~10 blocks a second. Look back ~5.5h first, then ~28h if the coin is quiet.
const WINDOWS = [200_000n, 1_000_000n];
const MAX_TRADES = 25;

// Addresses that hold tokens but are not people.
const PINKLOCK = "0xbe0b139abc90723af76a89d3051f60ba1b64c8d9";
const PLATFORM = "0x2dd3f57b811ab39832f202af27367b1b04fe27b2";

type Trade = { hash: Hex; side: "buy" | "sell"; eth: number; tokens: number; trader: Address; time: number };
type Burn = { hash: Hex; eth: number; tokens: number; time: number };
type Holder = { address: string; percent: number; isContract: boolean; isLocked: boolean };

export function CoinActivity({
  token,
  poolId,
  symbol,
  usdPerEth,
  creator,
  treasury,
}: {
  token: Address;
  poolId: Hex;
  symbol: string;
  usdPerEth: number;
  creator: Address;
  treasury: Address;
}) {
  const [tab, setTab] = useState<"trades" | "burns" | "holders">("trades");
  return (
    <div className="card stack">
      <div className="spread">
        <h3>Activity</h3>
        <div className="toggle" style={{ width: 300 }}>
          <button className={tab === "trades" ? "on" : ""} onClick={() => setTab("trades")}>
            Trades
          </button>
          <button className={tab === "burns" ? "on" : ""} onClick={() => setTab("burns")}>
            Burns
          </button>
          <button className={tab === "holders" ? "on" : ""} onClick={() => setTab("holders")}>
            Holders
          </button>
        </div>
      </div>
      {tab === "trades" ? (
        <Trades poolId={poolId} symbol={symbol} usdPerEth={usdPerEth} />
      ) : tab === "burns" ? (
        <Burns treasury={treasury} symbol={symbol} usdPerEth={usdPerEth} />
      ) : (
        <Holders token={token} creator={creator} treasury={treasury} />
      )}
    </div>
  );
}

function Trades({ poolId, symbol, usdPerEth }: { poolId: Hex; symbol: string; usdPerEth: number }) {
  const client = usePublicClient();
  const trades = useQuery({
    queryKey: ["trades", poolId],
    enabled: !!client,
    refetchInterval: 15_000,
    queryFn: async (): Promise<Trade[]> => {
      if (!client) return [];
      const head = await client.getBlockNumber();
      let logs: Awaited<ReturnType<typeof client.getLogs<typeof swapEvent>>> = [];
      for (const w of WINDOWS) {
        logs = await client.getLogs({ address: POOL_MANAGER, event: swapEvent, args: { id: poolId }, fromBlock: head > w ? head - w : 0n, toBlock: head });
        if (logs.length >= MAX_TRADES) break;
      }
      const recent = logs.slice(-MAX_TRADES).reverse();
      const blocks = [...new Set(recent.map((l) => l.blockNumber))];
      const [txs, blockTimes] = await Promise.all([
        Promise.all(recent.map((l) => client.getTransaction({ hash: l.transactionHash }))),
        Promise.all(blocks.map((b) => client.getBlock({ blockNumber: b }).then((blk) => [b, Number(blk.timestamp)] as const))),
      ]);
      const timeOf = new Map(blockTimes);
      return recent.map((l, i) => {
        // Deltas are from the swapper's side: negative means paid into the pool. ETH is currency0.
        const a0 = l.args.amount0 ?? 0n;
        const a1 = l.args.amount1 ?? 0n;
        const abs = (v: bigint) => (v < 0n ? -v : v);
        return {
          hash: l.transactionHash,
          side: a0 < 0n ? "buy" : "sell",
          eth: Number(formatUnits(abs(a0), ETH_DECIMALS)),
          tokens: Number(formatUnits(abs(a1), TOKEN_DECIMALS)),
          trader: txs[i].from,
          time: timeOf.get(l.blockNumber) ?? 0,
        };
      });
    },
  });

  if (trades.isLoading) return <div className="muted small">Loading trades…</div>;
  if (trades.error) return <div className="muted small">Could not load trades right now.</div>;
  if (!trades.data?.length) return <div className="muted small">No trades yet.</div>;

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Value</th>
            <th>ETH</th>
            <th>{symbol}</th>
            <th>Trader</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {trades.data.map((t) => (
            <tr key={t.hash + t.tokens}>
              <td className={t.side === "buy" ? "pos" : "neg"}>
                <strong>{t.side === "buy" ? "Buy" : "Sell"}</strong>
              </td>
              <td>{usdPerEth ? formatUsd(t.eth * usdPerEth) : "—"}</td>
              <td className="mono">{t.eth.toLocaleString("en-US", { maximumFractionDigits: 4 })}</td>
              <td className="mono">{t.tokens.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 })}</td>
              <td>
                <a href={explorerAddress(t.trader)} target="_blank" rel="noreferrer" className="mono" style={{ color: "var(--blue-600)" }}>
                  {short(t.trader)}
                </a>
              </td>
              <td>
                <a href={explorerTx(t.hash)} target="_blank" rel="noreferrer" className="muted">
                  {ago(t.time)}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Burns({ treasury, symbol, usdPerEth }: { treasury: Address; symbol: string; usdPerEth: number }) {
  const client = usePublicClient();
  const burns = useQuery({
    queryKey: ["burns", treasury],
    enabled: !!client && !!treasury,
    refetchInterval: 30_000,
    queryFn: async (): Promise<Burn[]> => {
      if (!client) return [];
      const head = await client.getBlockNumber();
      let logs: Awaited<ReturnType<typeof client.getLogs<typeof burnEvent>>> = [];
      for (const w of WINDOWS) {
        logs = await client.getLogs({ address: treasury, event: burnEvent, fromBlock: head > w ? head - w : 0n, toBlock: head });
        if (logs.length) break;
      }
      const recent = logs.slice(-MAX_TRADES).reverse();
      const blocks = [...new Set(recent.map((l) => l.blockNumber))];
      const times = new Map(
        await Promise.all(blocks.map((b) => client.getBlock({ blockNumber: b }).then((blk) => [b, Number(blk.timestamp)] as const))),
      );
      return recent.map((l) => ({
        hash: l.transactionHash,
        eth: Number(formatUnits(l.args.ethSpent ?? 0n, ETH_DECIMALS)),
        tokens: Number(formatUnits(l.args.tokensBurned ?? 0n, TOKEN_DECIMALS)),
        time: times.get(l.blockNumber) ?? 0,
      }));
    },
  });

  if (burns.isLoading) return <div className="muted small">Loading burns…</div>;
  if (burns.error) return <div className="muted small">Could not load burns right now.</div>;
  if (!burns.data?.length)
    return (
      <div className="muted small">
        No burns yet. Burns happen when the portfolio takes a profit, or when someone buys this coin from another
        chain — those fees buy the coin back and destroy it.
      </div>
    );

  const total = burns.data.reduce((sum, b) => sum + b.tokens, 0);

  return (
    <div className="table-wrap">
      <div className="small" style={{ marginBottom: 8 }}>
        <strong>{total.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 })}</strong> {symbol} burned in
        the last {burns.data.length} {burns.data.length === 1 ? "burn" : "burns"} — gone for good, supply only goes down.
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Value</th>
            <th>ETH spent</th>
            <th>{symbol} burned</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {burns.data.map((b) => (
            <tr key={b.hash + b.tokens}>
              <td className="pos">
                <strong>Burn</strong>
              </td>
              <td>{usdPerEth ? formatUsd(b.eth * usdPerEth) : "—"}</td>
              <td className="mono">{b.eth.toLocaleString("en-US", { maximumFractionDigits: 6 })}</td>
              <td className="mono">{b.tokens.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 })}</td>
              <td>
                <a href={explorerTx(b.hash)} target="_blank" rel="noreferrer" className="muted">
                  {ago(b.time)}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Holders({ token, creator, treasury }: { token: Address; creator: Address; treasury: Address }) {
  const holders = useQuery({
    queryKey: ["holders", token],
    refetchInterval: 120_000,
    queryFn: async (): Promise<{ count: number; holders: Holder[] }> => {
      const r = await fetch(`/api/holders/${token}`);
      if (!r.ok) throw new Error("holders unavailable");
      return r.json();
    },
  });

  if (holders.isLoading) return <div className="muted small">Loading holders…</div>;
  if (holders.error || !holders.data) return <div className="muted small">Could not load holders right now.</div>;
  if (!holders.data.holders.length) return <div className="muted small">Holder data appears shortly after launch.</div>;

  const label = (a: string, h: Holder) => {
    const x = a.toLowerCase();
    if (x === POOL_MANAGER.toLowerCase()) return "Uniswap v4 pool";
    if (x === PINKLOCK) return "PinkLock (locked)";
    if (x === creator.toLowerCase()) return "Creator";
    if (x === treasury.toLowerCase()) return "Treasury";
    if (x === PLATFORM) return "Stakd";
    return h.isLocked ? "Locked" : "";
  };

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="muted small">
        {holders.data.count.toLocaleString("en-US")} holders · top {holders.data.holders.length} shown · updates every few minutes
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Holder</th>
              <th />
              <th style={{ width: "38%" }}>Share</th>
            </tr>
          </thead>
          <tbody>
            {holders.data.holders.map((h, i) => (
              <tr key={h.address}>
                <td className="muted">{i + 1}</td>
                <td>
                  <a href={explorerAddress(h.address)} target="_blank" rel="noreferrer" className="mono" style={{ color: "var(--blue-600)" }}>
                    {short(h.address)}
                  </a>
                </td>
                <td>{label(h.address, h) && <span className="chip chip-soft">{label(h.address, h)}</span>}</td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--border)", overflow: "hidden" }}>
                      <div style={{ width: `${Math.min(100, h.percent * 100)}%`, height: "100%", background: "var(--blue-500)" }} />
                    </div>
                    <span className="mono small" style={{ minWidth: 56, textAlign: "right" }}>
                      {(h.percent * 100).toFixed(2)}%
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function short(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function ago(ts: number) {
  if (!ts) return "—";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
