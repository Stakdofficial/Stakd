"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { ALL_FACTORIES, FACTORY, isHiddenCoin, METADATA, metadataAbi } from "./config";
import { factoryAbi, tokenAbi, treasuryAbi } from "./abis";
import type { LighterAccount, LighterMarket } from "./lighter";

export type Leg = { marketId: number; isLong: boolean; weightBps: number; leverageX10: number };

export type CoinSummary = {
  token: Address;
  treasury: Address;
  poolId: `0x${string}`;
  creator: Address;
  createdAt: number;
  name: string;
  symbol: string;
  totalSupply: bigint;
  legs: Leg[];
  marginReserve: bigint;
  totalMarginDeposited: bigint;
  totalBuybackEth: bigint;
  totalTokensBurned: bigint;
  lighterAccountSet: boolean;
  lighterAccountIndex: bigint;
  /** Creator-set logo from StakdMetadata, if they added one. */
  image?: string;
};

export function useMarkets() {
  return useQuery({
    queryKey: ["lighter-markets"],
    queryFn: async () => {
      const res = await fetch("/api/lighter/markets");
      if (!res.ok) throw new Error("Could not load Lighter markets");
      const { markets } = (await res.json()) as { markets: LighterMarket[] };
      return { list: markets, byId: new Map(markets.map((m) => [m.marketId, m])) };
    },
    staleTime: 30_000,
  });
}

export function useEthPrice() {
  return useQuery({
    queryKey: ["eth-price"],
    queryFn: async () => {
      const res = await fetch("/api/eth-price");
      if (!res.ok) throw new Error("price unavailable");
      return ((await res.json()) as { usd: number }).usd;
    },
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

export function useLighterAccount(index: bigint | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["lighter-account", index?.toString()],
    queryFn: async () => {
      const res = await fetch(`/api/lighter/account/${index}`);
      if (!res.ok) throw new Error("Could not load Lighter account");
      return (await res.json()) as LighterAccount;
    },
    enabled: enabled && index !== undefined,
    refetchInterval: 15_000,
  });
}

const TREASURY_FIELDS = [
  "legs",
  "marginReserve",
  "totalMarginDeposited",
  "totalBuybackEth",
  "totalTokensBurned",
  "lighterAccountSet",
  "lighterAccountIndex",
] as const;

/**
 * Loads coins (newest first) with token metadata and treasury stats.
 * Reads every factory, not just the current one: a coin launched from an older factory keeps trading under the
 * rules it launched with, so it belongs in the list just the same.
 */
export function useCoins(limit = 48) {
  const pages = useReadContracts({
    allowFailure: true,
    contracts: ALL_FACTORIES.map((address) => ({
      address,
      abi: factoryAbi,
      functionName: "coins" as const,
      args: [0n, BigInt(limit)] as const,
    })),
  });
  const page = {
    data: pages.data?.flatMap((r) => (r.status === "success" ? r.result : [])),
    isLoading: pages.isLoading,
    isSuccess: pages.isSuccess,
    error: pages.error,
  };
  // Hidden coins are dropped before the detail reads, so they cost no RPC calls either.
  const base = (page.data ?? [])
    .filter((c) => !isHiddenCoin(c.token))
    .slice()
    .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
    .slice(0, limit);

  const details = useReadContracts({
    allowFailure: false,
    contracts: base.flatMap((c) => [
      { address: c.token, abi: tokenAbi, functionName: "name" },
      { address: c.token, abi: tokenAbi, functionName: "symbol" },
      { address: c.token, abi: tokenAbi, functionName: "totalSupply" },
      ...TREASURY_FIELDS.map((functionName) => ({ address: c.treasury, abi: treasuryAbi, functionName })),
    ]),
    query: { enabled: base.length > 0, refetchInterval: 20_000 },
  });

  // Profiles are optional, so failures here must never break the list.
  const metas = useReadContracts({
    allowFailure: true,
    contracts: base.map((c) => ({ address: METADATA, abi: metadataAbi, functionName: "metadata" as const, args: [c.token] })),
    query: { enabled: base.length > 0, refetchInterval: 60_000 },
  });

  const per = 3 + TREASURY_FIELDS.length;
  const coins: CoinSummary[] | undefined = details.data
    ? base.map((c, i) => {
        const r = details.data.slice(i * per, i * per + per) as unknown[];
        return {
          token: c.token,
          treasury: c.treasury,
          poolId: c.poolId,
          creator: c.creator,
          createdAt: Number(c.createdAt),
          name: r[0] as string,
          symbol: r[1] as string,
          totalSupply: r[2] as bigint,
          legs: (r[3] as readonly Leg[]).map((l) => ({ ...l })),
          marginReserve: r[4] as bigint,
          totalMarginDeposited: r[5] as bigint,
          totalBuybackEth: r[6] as bigint,
          totalTokensBurned: r[7] as bigint,
          lighterAccountSet: r[8] as boolean,
          lighterAccountIndex: r[9] as bigint,
          image: (metas.data?.[i]?.result as { image?: string } | undefined)?.image || undefined,
        };
      })
    : base.length === 0 && page.isSuccess
      ? []
      : undefined;

  return { coins, isLoading: page.isLoading || details.isLoading, error: page.error ?? details.error };
}

/**
 * Which factory launched this coin.
 * Coins from older factories keep working under the rules they launched with, so every page that needs a
 * coin's hook, router or pool has to ask the factory that actually created it — not whichever one is current.
 */
export function useCoinFactory(token: Address) {
  const ids = useReadContracts({
    allowFailure: true,
    contracts: ALL_FACTORIES.map((address) => ({
      address,
      abi: factoryAbi,
      functionName: "coinIdOf" as const,
      args: [token] as const,
    })),
    query: { enabled: /^0x[0-9a-fA-F]{40}$/.test(token) },
  });

  const i = ids.data?.findIndex((r) => r.status === "success" && (r.result as bigint) > 0n) ?? -1;
  return {
    factory: i >= 0 ? ALL_FACTORIES[i] : undefined,
    isLegacy: i > 0,
    isLoading: ids.isLoading,
  };
}
