import { NextResponse } from "next/server";
import { createPublicClient, formatUnits, http, parseAbiItem, type Address, type Hex } from "viem";
import { factoryAbi, treasuryAbi } from "@/lib/abis";
import { ALL_FACTORIES, chain, isHiddenCoin, POOL_MANAGER } from "@/lib/config";

/**
 * Platform-wide totals for the landing page, read straight from the chain across every Stakd factory. Volume is not
 * stored on-chain, so it is summed from the pools' Swap events; the whole response is cached for 5 minutes.
 */
export const revalidate = 300;

const client = createPublicClient({ chain, transport: http() });
const swapEvent = parseAbiItem(
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
);
// Robinhood Chain makes ~10 blocks a second; the RPC serves ~1M blocks per getLogs call.
const CHUNK = 1_000_000n;
const BLOCKS_PER_SECOND = 10n;

type Coin = { token: Address; treasury: Address; poolId: Hex; createdAt: bigint };

const eth = (wei: bigint) => Number(formatUnits(wei, 18));

export async function GET() {
  try {
    const pages = await Promise.all(
      ALL_FACTORIES.map((address) =>
        client.readContract({ address, abi: factoryAbi, functionName: "coins", args: [0n, 1000n] }).catch(() => [] as readonly Coin[]),
      ),
    );
    const coins = (pages.flat() as readonly Coin[]).filter((c) => !isHiddenCoin(c.token));

    // One read per treasury per field; the response is cached, so this runs at most every few minutes.
    const sum = async (functionName: "totalFeesReceived" | "totalMarginDeposited" | "totalBuybackEth" | "totalCreatorFees") => {
      const res = await Promise.all(
        coins.map((c) =>
          // Treasuries from before Hook v3 have no creator-fee counter, so a failed read counts as zero.
          client.readContract({ address: c.treasury, abi: treasuryAbi, functionName }).catch(() => 0n),
        ),
      );
      return res.reduce((s, r) => s + (r as bigint), 0n);
    };
    const [fees, margin, buyback, creator] = await Promise.all([
      sum("totalFeesReceived"),
      sum("totalMarginDeposited"),
      sum("totalBuybackEth"),
      sum("totalCreatorFees"),
    ]);

    // Volume: every swap's ETH leg, from the oldest coin's launch to now.
    let volume = 0n;
    let trades = 0;
    if (coins.length) {
      const head = await client.getBlock();
      const oldest = coins.reduce((m, c) => (c.createdAt < m ? c.createdAt : m), coins[0].createdAt);
      const back = (head.timestamp - oldest + 3600n) * BLOCKS_PER_SECOND;
      const start = head.number > back ? head.number - back : 0n;
      const ids = coins.map((c) => c.poolId);
      const ranges: [bigint, bigint][] = [];
      for (let from = start; from <= head.number; from += CHUNK) {
        ranges.push([from, from + CHUNK - 1n > head.number ? head.number : from + CHUNK - 1n]);
      }
      const logs = await Promise.all(
        ranges.map(([fromBlock, toBlock]) =>
          client.getLogs({ address: POOL_MANAGER, event: swapEvent, args: { id: ids }, fromBlock, toBlock }),
        ),
      );
      for (const l of logs.flat()) {
        const a = l.args.amount0 ?? 0n;
        volume += a < 0n ? -a : a;
        trades++;
      }
    }

    return NextResponse.json({
      coins: coins.length,
      trades,
      volumeEth: eth(volume),
      feesEth: eth(fees + creator),
      creatorEth: eth(creator),
      marginEth: eth(margin),
      buybackEth: eth(buyback),
      updatedAt: Date.now(),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.split("\n")[0] }, { status: 502 });
  }
}
