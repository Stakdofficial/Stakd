import { encodePacked, keccak256, pad, toHex, type Hex } from "viem";

const Q96 = 2n ** 96n;
const POOLS_SLOT = 6n;
const LIQUIDITY_OFFSET = 3n;

/** Storage slot range [slot0 … liquidity] of a pool inside the v4 PoolManager (mirrors StateLibrary). */
export function poolStateSlot(poolId: Hex): Hex {
  return keccak256(encodePacked(["bytes32", "bytes32"], [poolId, pad(toHex(POOLS_SLOT), { size: 32 })]));
}

export const POOL_STATE_SLOTS = LIQUIDITY_OFFSET + 1n;

export type PoolState = {
  sqrtPriceX96: bigint;
  liquidity: bigint;
  /** Virtual reserves in raw units: the pool trades like x·y = L² within its (single) position. */
  tokenReserve: bigint;
  ethReserve: bigint;
};

export function decodePoolState(slots: readonly Hex[], tokenIsCurrency0: boolean): PoolState | null {
  const slot0 = BigInt(slots[0]);
  const sqrtPriceX96 = slot0 & ((1n << 160n) - 1n);
  const liquidity = BigInt(slots[Number(LIQUIDITY_OFFSET)]) & ((1n << 128n) - 1n);
  if (sqrtPriceX96 === 0n || liquidity === 0n) return null;
  const reserve0 = (liquidity * Q96) / sqrtPriceX96;
  const reserve1 = (liquidity * sqrtPriceX96) / Q96;
  return {
    sqrtPriceX96,
    liquidity,
    tokenReserve: tokenIsCurrency0 ? reserve0 : reserve1,
    ethReserve: tokenIsCurrency0 ? reserve1 : reserve0,
  };
}

/** Exact-in quote against the virtual reserves, with the hook's ETH fee applied on the ETH leg. */
export function quote(state: PoolState, side: "buy" | "sell", amountIn: bigint, feeBps: number): bigint {
  const k = state.tokenReserve * state.ethReserve;
  if (amountIn === 0n || k === 0n) return 0n;
  if (side === "buy") {
    const net = (amountIn * BigInt(10_000 - feeBps)) / 10_000n;
    return state.tokenReserve - k / (state.ethReserve + net);
  }
  const gross = state.ethReserve - k / (state.tokenReserve + amountIn);
  return (gross * BigInt(10_000 - feeBps)) / 10_000n;
}

/** slot0's sqrtPriceX96. Present even when the pool has no active liquidity (price sitting at a range edge). */
export function sqrtPriceFromSlots(slots: readonly Hex[]): bigint {
  if (!slots?.length) return 0n;
  return BigInt(slots[0]) & ((1n << 160n) - 1n);
}

/**
 * ETH per whole coin, derived from price alone.
 * currency0 is native ETH and currency1 is the coin, so (sqrtP / 2^96)^2 is coin-per-ETH.
 * Works at launch, where all liquidity sits above the current tick and the reserve model reads zero.
 */
export function ethPerToken(sqrtPriceX96: bigint): number {
  if (sqrtPriceX96 <= 0n) return 0;
  const r = Number(sqrtPriceX96) / Number(Q96);
  const coinPerEth = r * r;
  return coinPerEth > 0 ? 1 / coinPerEth : 0;
}
