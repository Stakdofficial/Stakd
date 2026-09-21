import { createPublicClient, formatUnits, http, type Address, type Hex } from "viem";
import { factoryAbi, hookAbi, tokenAbi, treasuryAbi } from "@/lib/abis";
import { ALL_FACTORIES, chain, metadataAbi, metadataFor, POOL_MANAGER, poolManagerAbi, TOKEN_DECIMALS } from "@/lib/config";
import type { Leg } from "@/lib/hooks";
import { ethPerToken, POOL_STATE_SLOTS, poolStateSlot, sqrtPriceFromSlots } from "@/lib/pool";

/** Server-side snapshot of a coin for share cards and link previews. Returns null for tokens not launched on Stakd. */

const LIGHTER_URL = process.env.LIGHTER_URL ?? "https://api.rh.lighter.xyz";
const client = createPublicClient({ chain, transport: http() });

export type CoinSummary = {
  name: string;
  symbol: string;
  image: string;
  priceUsd: number;
  marketCapUsd: number;
  feePct: number;
  /** The creator fee paid on top of the coin's fee (Hook v3 coins); 0 on older hooks. */
  creatorPct: number;
  feesEth: number;
  feesUsd: number;
  burned: number;
  legs: { symbol: string; isLong: boolean; weightPct: number; leverage: number }[];
};

export async function getCoinSummary(token: Address): Promise<CoinSummary | null> {
  // A coin keeps the factory it launched from, so look in every factory, newest first.
  let FACTORY: Address | undefined;
  let id = 0n;
  for (const f of ALL_FACTORIES) {
    id = await client.readContract({ address: f, abi: factoryAbi, functionName: "coinIdOf", args: [token] }).catch(() => 0n);
    if (id) {
      FACTORY = f;
      break;
    }
  }
  if (!FACTORY || !id) return null;
  const [coin, hook] = await Promise.all([
    client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "coin", args: [id - 1n] }),
    client.readContract({ address: FACTORY, abi: factoryAbi, functionName: "hook" }),
  ]);
  const { treasury, poolId } = coin as { treasury: Address; poolId: Hex };

  const read = <T,>(p: Parameters<typeof client.readContract>[0]) => client.readContract(p) as Promise<T>;
  const [name, symbol, supply, pool, legs, fees, burned, slots, meta] = await Promise.all([
    read<string>({ address: token, abi: tokenAbi, functionName: "name" }),
    read<string>({ address: token, abi: tokenAbi, functionName: "symbol" }),
    read<bigint>({ address: token, abi: tokenAbi, functionName: "totalSupply" }),
    read<readonly [Address, number]>({ address: hook as Address, abi: hookAbi, functionName: "pools", args: [poolId] }),
    read<readonly Leg[]>({ address: treasury, abi: treasuryAbi, functionName: "legs" }),
    read<bigint>({ address: treasury, abi: treasuryAbi, functionName: "totalFeesReceived" }),
    read<bigint>({ address: treasury, abi: treasuryAbi, functionName: "totalTokensBurned" }),
    read<readonly Hex[]>({ address: POOL_MANAGER, abi: poolManagerAbi, functionName: "extsload", args: [poolStateSlot(poolId), POOL_STATE_SLOTS] }),
    read<{ image?: string }>({ address: metadataFor(FACTORY), abi: metadataAbi, functionName: "metadata", args: [token] }),
  ]);

  const [usdPerEth, markets, creatorBps] = await Promise.all([
    ethUsd(),
    marketSymbols(),
    // Older hooks have no creator fee, and the call reverts.
    read<number>({ address: hook as Address, abi: hookAbi, functionName: "CREATOR_FEE_BPS" }).catch(() => 0),
  ]);
  const priceUsd = ethPerToken(sqrtPriceFromSlots(slots)) * usdPerEth;
  const feesEth = Number(formatUnits(fees, 18));
  return {
    name,
    symbol,
    image: await cardImage(meta.image ?? ""),
    priceUsd,
    marketCapUsd: priceUsd * Number(formatUnits(supply, TOKEN_DECIMALS)),
    feePct: pool[1] / 100,
    creatorPct: Number(creatorBps) / 100,
    feesEth,
    feesUsd: feesEth * usdPerEth,
    burned: Number(formatUnits(burned, TOKEN_DECIMALS)),
    legs: legs.map((l) => ({
      symbol: markets.get(l.marketId) ?? `#${l.marketId}`,
      isLong: l.isLong,
      weightPct: l.weightBps / 100,
      leverage: l.leverageX10 / 10,
    })),
  };
}

/**
 * The card renderer only draws PNG and JPEG. Logos uploaded on Stakd are WebP data URIs, so convert them;
 * anything unusable falls back to the coin's initials.
 */
async function cardImage(image: string): Promise<string> {
  if (/^data:image\/(png|jpe?g);base64,/i.test(image)) return image;
  const webp = image.match(/^data:image\/webp;base64,(.+)$/i);
  if (!webp) return "";
  try {
    const sharp = (await import("sharp")).default;
    const png = await sharp(Buffer.from(webp[1], "base64")).resize(224, 224, { fit: "cover" }).png().toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return "";
  }
}

async function ethUsd(): Promise<number> {
  try {
    const r = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", { next: { revalidate: 60 } });
    return Number((await r.json()).data.amount) || 0;
  } catch {
    return 0;
  }
}

async function marketSymbols(): Promise<Map<number, string>> {
  try {
    const r = await fetch(`${LIGHTER_URL}/api/v1/orderBookDetails?filter=perp`, { next: { revalidate: 3600 } });
    const body = await r.json();
    return new Map((body.order_book_details ?? []).map((d: { market_id: number; symbol: string }) => [d.market_id, d.symbol]));
  } catch {
    return new Map();
  }
}
