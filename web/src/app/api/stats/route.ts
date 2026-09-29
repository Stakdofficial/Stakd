import { NextResponse } from "next/server";
import { createPublicClient, formatUnits, http, parseAbi, parseAbiItem, type Address, type Hex } from "viem";
import { factoryAbi, treasuryAbi } from "@/lib/abis";
import { ALL_FACTORIES, chain, isHiddenCoin, POOL_MANAGER, STAKD_BURNER } from "@/lib/config";

/**
 * Platform-wide totals for the landing page, read straight from the chain across every Stakd factory. Volume is not
 * stored on-chain, so it is summed from the pools' Swap events; the whole response is cached for 5 minutes.
 */
// Computed on request, never at build time (reading every swap can outlast the build's time limit), and cached by
// the CDN for five minutes so the chain is read at most that often.
export const dynamic = "force-dynamic";
const CACHE = { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" };

const client = createPublicClient({ chain, transport: http() });
const swapEvent = parseAbiItem(
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
);
// Robinhood Chain makes ~10 blocks a second. The RPC serves ~1M blocks per getLogs call, but only 100k once a query
// asks for many pool ids at once, so a range it refuses is retried in 100k slices.
const CHUNK = 1_000_000n;
const SMALL_CHUNK = 100_000n;
const BLOCKS_PER_SECOND = 10n;

// Each factory since Hook v4 sends half of every coin's volatility fee to its own StakdBurner, which buys $STAKD and
// burns it. That is a buyback too, but it never passes through a treasury, so it is counted separately.
const burnerAbi = parseAbi(["function stakdBurner() view returns (address)", "function totalEthSpent() view returns (uint256)"]);
const ZERO = "0x0000000000000000000000000000000000000000";

type Coin = { token: Address; treasury: Address; poolId: Hex; createdAt: bigint };
type SwapLog = { args: { id?: Hex; amount0?: bigint; sqrtPriceX96?: bigint } };

async function swapLogs(ids: Hex[], fromBlock: bigint, toBlock: bigint): Promise<SwapLog[]> {
  try {
    return await client.getLogs({ address: POOL_MANAGER, event: swapEvent, args: { id: ids }, fromBlock, toBlock });
  } catch (e) {
    if (toBlock - fromBlock < SMALL_CHUNK || !/only \d+ are allowed|block range|too many/i.test((e as Error).message)) throw e;
    // A few slices at a time: firing them all at once gets the public RPC to rate-limit us instead.
    const slices: [bigint, bigint][] = [];
    for (let from = fromBlock; from <= toBlock; from += SMALL_CHUNK) slices.push([from, from + SMALL_CHUNK - 1n > toBlock ? toBlock : from + SMALL_CHUNK - 1n]);
    const out: SwapLog[] = [];
    for (let i = 0; i < slices.length; i += 4) {
      const batch = await Promise.all(slices.slice(i, i + 4).map(([a, b]) => swapLogs(ids, a, b)));
      out.push(...batch.flat());
    }
    return out;
  }
}

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
    const stakdBurned = async () => {
      const found = await Promise.all(
        ALL_FACTORIES.map((address) => client.readContract({ address, abi: burnerAbi, functionName: "stakdBurner" }).catch(() => null)),
      );
      const burners = new Set([STAKD_BURNER, ...found].filter((b): b is Address => !!b && b !== ZERO).map((b) => b.toLowerCase()));
      const spent = await Promise.all(
        [...burners].map((address) =>
          client.readContract({ address: address as Address, abi: burnerAbi, functionName: "totalEthSpent" }).catch(() => 0n),
        ),
      );
      return spent.reduce((s, r) => s + r, 0n);
    };
    const [fees, margin, buyback, creator, stakdBurn] = await Promise.all([
      sum("totalFeesReceived"),
      sum("totalMarginDeposited"),
      sum("totalBuybackEth"),
      sum("totalCreatorFees"),
      stakdBurned(),
    ]);

    // Volume: every swap's ETH leg, from the oldest coin's launch to now.
    let volume = 0n;
    let trades = 0;
    // Per coin as well, for the coins page: ETH volume, trade count and the last swap's price.
    const perPool = new Map<string, { vol: bigint; trades: number; sqrtPriceX96: bigint }>();
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
      const logs = await Promise.all(ranges.map(([fromBlock, toBlock]) => swapLogs(ids, fromBlock, toBlock)));
      for (const l of logs.flat()) {
        const a = l.args.amount0 ?? 0n;
        const abs = a < 0n ? -a : a;
        volume += abs;
        trades++;
        const id = (l.args.id ?? "0x").toLowerCase();
        const p = perPool.get(id) ?? { vol: 0n, trades: 0, sqrtPriceX96: 0n };
        p.vol += abs;
        p.trades++;
        p.sqrtPriceX96 = l.args.sqrtPriceX96 ?? p.sqrtPriceX96; // logs arrive in block order, so the last one wins
        perPool.set(id, p);
      }
    }

    return NextResponse.json({
      coins: coins.length,
      trades,
      volumeEth: eth(volume),
      feesEth: eth(fees + creator),
      creatorEth: eth(creator),
      marginEth: eth(margin),
      buybackEth: eth(buyback + stakdBurn),
      coinBuybackEth: eth(buyback),
      stakdBurnEth: eth(stakdBurn),
      // keyed by token address; price is the last swap's sqrtPriceX96 (ETH is currency0), as a decimal string
      perCoin: Object.fromEntries(
        coins.map((c) => {
          const p = perPool.get(c.poolId.toLowerCase());
          return [c.token.toLowerCase(), { volumeEth: p ? eth(p.vol) : 0, trades: p?.trades ?? 0, sqrtPriceX96: p ? p.sqrtPriceX96.toString() : null }];
        }),
      ),
      updatedAt: Date.now(),
    }, { headers: CACHE });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.split("\n")[0] }, { status: 502 });
  }
}
