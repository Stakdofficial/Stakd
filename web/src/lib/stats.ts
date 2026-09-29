"use client";

import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { TOTAL_SUPPLY } from "@/lib/config";
import type { CoinSummary } from "@/lib/hooks";

export type CoinVolume = { volumeEth: number; trades: number; sqrtPriceX96: string | null };

export type PlatformStats = {
  coins: number;
  trades: number;
  volumeEth: number;
  feesEth: number;
  creatorEth: number;
  marginEth: number;
  buybackEth: number;
  coinBuybackEth?: number;
  stakdBurnEth?: number;
  /** keyed by lower-cased token address */
  perCoin?: Record<string, CoinVolume>;
  updatedAt: number;
};

/** Platform totals and per-coin volume, read from the chain by /api/stats (cached there for a few minutes). */
export function usePlatformStats() {
  return useQuery({
    queryKey: ["platform-stats"],
    queryFn: async () => {
      const res = await fetch("/api/stats");
      if (!res.ok) throw new Error("stats unavailable");
      return (await res.json()) as PlatformStats;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/** Every coin mints exactly TOTAL_SUPPLY and can only burn, so what is missing from it has been burned. */
export function burnedPct(c: Pick<CoinSummary, "totalSupply">): number {
  if (c.totalSupply >= TOTAL_SUPPLY) return 0;
  return Number(((TOTAL_SUPPLY - c.totalSupply) * 1_000_000n) / TOTAL_SUPPLY) / 10_000;
}

/** Market cap in USD from the last swap's price. ETH is always currency0, so sqrtPrice² is tokens per ETH. */
export function marketCapUsd(c: Pick<CoinSummary, "totalSupply">, v: CoinVolume | undefined, ethUsd: number | undefined): number | undefined {
  if (!v?.sqrtPriceX96 || !ethUsd) return undefined;
  const sp = Number(v.sqrtPriceX96) / 2 ** 96;
  const tokensPerEth = sp * sp;
  if (!tokensPerEth) return undefined;
  const supply = Number(formatUnits(c.totalSupply, 18));
  return (supply / tokensPerEth) * ethUsd;
}

export const usd = (v: number | undefined, compact = true): string => {
  if (v === undefined || !Number.isFinite(v) || v === 0) return "—";
  if (compact && v >= 1e6) return "$" + (v / 1e6).toFixed(2) + "M";
  if (compact && v >= 1e4) return "$" + (v / 1e3).toFixed(1) + "K";
  return "$" + v.toLocaleString("en-US", { maximumFractionDigits: v < 10 ? 2 : 0 });
};

export const pct = (p: number): string => (p <= 0 ? "0%" : p < 0.01 ? "<0.01%" : p.toFixed(2) + "%");

/** A coin's average leverage from its legs. */
export const coinLeverage = (legs: CoinSummary["legs"]) => legs.reduce((s, l) => s + (l.weightBps / 10_000) * (l.leverageX10 / 10), 0);

export const RING_COLORS = ["#60a5fa", "#7dd3fc", "#2563eb", "#93c5fd", "#38bdf8", "#1d4ed8"];

/** A conic-gradient ring of a coin's legs: blues for longs, red for shorts, sized by weight. */
export function legRing(legs: CoinSummary["legs"]): string {
  const total = legs.reduce((s, l) => s + l.weightBps, 0) || 1;
  let a = 0;
  return `conic-gradient(${legs
    .map((l, i) => {
      const s = a;
      a += (l.weightBps / total) * 360;
      return `${l.isLong ? RING_COLORS[i % RING_COLORS.length] : "#ff5c6c"} ${s}deg ${a}deg`;
    })
    .join(",")})`;
}
