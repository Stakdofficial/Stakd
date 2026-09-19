import { defineChain, erc20Abi, type Address } from "viem";

/** Robinhood Chain: Arbitrum Orbit L2, ETH gas. Browsers use the public RPC; the keeper uses a private one. */
export const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});

export const chain = robinhood;

export const FACTORY = (process.env.NEXT_PUBLIC_FACTORY_ADDRESS ?? "0x0000000000000000000000000000000000000000") as Address;
export const ETH_DECIMALS = 18;
export const TOKEN_DECIMALS = 18;

// Uniswap v4 PoolManager on Robinhood Chain; override for a local chain.
export const POOL_MANAGER = (process.env.NEXT_PUBLIC_POOL_MANAGER ?? "0x8366a39CC670B4001A1121B8F6A443A643e40951") as Address;

export const poolManagerAbi = [
  {
    type: "function",
    name: "extsload",
    stateMutability: "view",
    inputs: [
      { name: "startSlot", type: "bytes32" },
      { name: "nSlots", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bytes32[]" }],
  },
] as const;

export { erc20Abi };

export function explorerTx(hash: string) {
  return `${chain.blockExplorers.default.url}/tx/${hash}`;
}

export function explorerAddress(address: string) {
  return `${chain.blockExplorers.default.url}/address/${address}`;
}

/** Uniswap v4 Quoter. Simulates the swap through the pool *and* the hook, so quotes include the ETH fee. */
export const V4_QUOTER = (process.env.NEXT_PUBLIC_V4_QUOTER ?? "0x8dc178efb8111bb0973dd9d722ebeff267c98f94") as Address;

export const quoterAbi = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          {
            name: "poolKey",
            type: "tuple",
            components: [
              { name: "currency0", type: "address" },
              { name: "currency1", type: "address" },
              { name: "fee", type: "uint24" },
              { name: "tickSpacing", type: "int24" },
              { name: "hooks", type: "address" },
            ],
          },
          { name: "zeroForOne", type: "bool" },
          { name: "exactAmount", type: "uint128" },
          { name: "hookData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

/** Optional per-coin profile (logo, description, socials). Written by the coin's creator. */
export const METADATA = (process.env.NEXT_PUBLIC_METADATA_ADDRESS ?? "0xa55D5E6E5e80C22Ad09e7743E95D2152C09d800B") as Address;

const META_TUPLE = {
  name: "m",
  type: "tuple",
  components: [
    { name: "image", type: "string" },
    { name: "description", type: "string" },
    { name: "telegram", type: "string" },
    { name: "x", type: "string" },
    { name: "website", type: "string" },
  ],
} as const;

export const metadataAbi = [
  {
    type: "function",
    name: "metadata",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ ...META_TUPLE, name: "" }],
  },
  {
    type: "function",
    name: "creatorOf",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "setMetadata",
    stateMutability: "nonpayable",
    inputs: [{ name: "token", type: "address" }, META_TUPLE],
    outputs: [],
  },
] as const;

/**
 * Coins kept off the public list (test launches, abandoned coins).
 * Their pages still work by direct link so the creator can manage them.
 * Override with NEXT_PUBLIC_HIDDEN_COINS as a comma-separated list.
 */
const DEFAULT_HIDDEN = [
  "0x1fA52F8dC5c66e4D47062f675E862330b21b35DB", // STKTEST - first test launch
  "0x0D514f7b9b3f7a872198abf4F65D29A224f58DE4", // TEST - second test launch
].join(",");

export const HIDDEN_COINS = new Set(
  (process.env.NEXT_PUBLIC_HIDDEN_COINS ?? DEFAULT_HIDDEN)
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean),
);

export function isHiddenCoin(token: string) {
  return HIDDEN_COINS.has(token.toLowerCase());
}
