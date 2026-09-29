import { defineChain, erc20Abi, type Address } from "viem";

/** The public RPC, plus any private one set in RPC_URL. Server code and the /api/rpc proxy read these, newest first. */
export const SERVER_RPC_URLS = [process.env.RPC_URL, "https://rpc.mainnet.chain.robinhood.com"].filter(
  (u): u is string => !!u,
);

/**
 * Robinhood Chain: Arbitrum Orbit L2, ETH gas.
 *
 * The browser goes through /api/rpc on our own origin: some edges of the public RPC send the CORS header twice, which
 * browsers reject, and the page would then read nothing from the chain. Server-side code calls the upstream directly,
 * where CORS does not apply. NEXT_PUBLIC_RPC_URL still overrides the browser side if it is set.
 */
export const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        typeof window === "undefined"
          ? SERVER_RPC_URLS[0]
          : (process.env.NEXT_PUBLIC_RPC_URL ?? "/api/rpc"),
      ],
    },
  },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
  // Without this every read is its own request: the coin list alone is ~10 calls per coin, which buries the
  // RPC proxy once there are a few dozen coins. Multicall3 is at the usual address on Robinhood Chain.
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

export const chain = robinhood;

/**
 * The factory new coins launch from. v2 coins can also be bought from other chains, and those buys send the
 * coin's fee share to buyback & burn instead of its portfolio.
 */
export const FACTORY = (process.env.NEXT_PUBLIC_FACTORY_ADDRESS ?? "0x0000000000000000000000000000000000000000") as Address;

/**
 * Factories that came before. Their coins keep trading exactly as they always have — a launched coin's hook can
 * never change — so the site keeps reading them; it just does not launch new coins there.
 */
export const LEGACY_FACTORIES = (process.env.NEXT_PUBLIC_LEGACY_FACTORIES ?? "0x019e1242e8d4b76Bc0A1dca1B912daA04323d355")
  .split(",")
  .map((a) => a.trim())
  .filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a) && a.toLowerCase() !== (process.env.NEXT_PUBLIC_FACTORY_ADDRESS ?? "").toLowerCase()) as Address[];

/** Every factory the site reads from, newest first. */
export const ALL_FACTORIES = [FACTORY, ...LEGACY_FACTORIES] as Address[];
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
/**
 * Where cross-chain buys land. A buyer on another chain sends funds to a one-time address derived from their
 * order; filling it buys the coin here and sends the coin's fee share to buyback & burn.
 */
export const ORDER_FACTORY = (process.env.NEXT_PUBLIC_ORDER_FACTORY ?? "0x5Ab981B9565F0Ec3d0Dfc26Bd6957D7Dac507594") as Address;

/**
 * An order factory buys through one cross-chain router, which serves one Stakd factory. Older factories that have
 * their own keep them here as `factory:orderFactory` pairs (`NEXT_PUBLIC_FACTORY_ORDER_FACTORIES`); the current
 * factory uses `ORDER_FACTORY`. A factory with neither has no Solana route.
 */
const ORDER_FACTORY_BY_FACTORY: Record<string, Address> = Object.fromEntries(
  (process.env.NEXT_PUBLIC_FACTORY_ORDER_FACTORIES ?? "")
    .split(",")
    .map((pair) => pair.trim().split(":"))
    .filter(([f, o]) => /^0x[0-9a-fA-F]{40}$/.test(f ?? "") && /^0x[0-9a-fA-F]{40}$/.test(o ?? ""))
    .map(([f, o]) => [f.toLowerCase(), o as Address]),
);

export function orderFactoryFor(factory: Address | undefined): Address | undefined {
  if (!factory) return undefined;
  if (factory.toLowerCase() === FACTORY.toLowerCase()) return ORDER_FACTORY;
  return ORDER_FACTORY_BY_FACTORY[factory.toLowerCase()];
}

export const orderFactoryAbi = [
  {
    type: "function",
    name: "orderAddress",
    stateMutability: "view",
    inputs: [
      {
        name: "o",
        type: "tuple",
        components: [
          { name: "token", type: "address" },
          { name: "minTokensOut", type: "uint256" },
          { name: "to", type: "bytes32" },
          { name: "dstEid", type: "uint32" },
          { name: "bridgeFee", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "refundTo", type: "address" },
          { name: "salt", type: "bytes32" },
        ],
      },
    ],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "pending",
    stateMutability: "view",
    inputs: [
      {
        name: "o",
        type: "tuple",
        components: [
          { name: "token", type: "address" },
          { name: "minTokensOut", type: "uint256" },
          { name: "to", type: "bytes32" },
          { name: "dstEid", type: "uint32" },
          { name: "bridgeFee", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "refundTo", type: "address" },
          { name: "salt", type: "bytes32" },
        ],
      },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "fill",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "o",
        type: "tuple",
        components: [
          { name: "token", type: "address" },
          { name: "minTokensOut", type: "uint256" },
          { name: "to", type: "bytes32" },
          { name: "dstEid", type: "uint32" },
          { name: "bridgeFee", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "refundTo", type: "address" },
          { name: "salt", type: "bytes32" },
        ],
      },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/**
 * What to call the current factory on a coin card. Each new factory is the next version, so this counts the legacy
 * ones rather than hard-coding a number that goes stale the next time we deploy.
 */
/** Prices the creator's optional buy at launch. */
export const LAUNCH_QUOTER = (process.env.NEXT_PUBLIC_LAUNCH_QUOTER ??
  "0x2247e2d6F68cF5A8187FE8518fB7B1031D0a25FE") as Address;

export const FACTORY_VERSION = process.env.NEXT_PUBLIC_FACTORY_VERSION ?? `v${LEGACY_FACTORIES.length + 1}`;

/**
 * Official $STAKD is burned from two places. Its own treasury burns it like any other coin, and since Hook v4 the
 * StakdBurner burns it too: half of every other coin's volatility fee is sent there, spent on $STAKD and destroyed.
 * The burner is not a treasury, so anything counting $STAKD burns has to ask it as well.
 */
/** Every Stakd coin mints exactly this and can only ever burn, so supply missing from it is supply burned. */
export const TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n;

export const STAKD_TOKEN = (process.env.NEXT_PUBLIC_STAKD_TOKEN ??
  "0x2854Cf9f6C3DF1eEdCa72CD141e282AC167d1E6A") as Address;
export const STAKD_BURNER = (process.env.NEXT_PUBLIC_STAKD_BURNER ??
  "0xe61BF093B0A6ca647c23C9B59e94Fa495b8cC1E5") as Address;

/** The burner that destroys `token`, when that token is the one $STAKD burner burns. */
export function burnerFor(token: Address | undefined): Address | undefined {
  if (!token || !STAKD_BURNER || !STAKD_TOKEN) return undefined;
  return token.toLowerCase() === STAKD_TOKEN.toLowerCase() ? STAKD_BURNER : undefined;
}

export const stakdBurnerAbi = [
  { type: "function", name: "totalBurned", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalEthSpent", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
] as const;

export const METADATA = (process.env.NEXT_PUBLIC_METADATA_ADDRESS ?? "0xa55D5E6E5e80C22Ad09e7743E95D2152C09d800B") as Address;

/**
 * A metadata contract only accepts profiles for coins of the one factory it was deployed for, so factories launched
 * later bring their own. `NEXT_PUBLIC_FACTORY_METADATA` lists them as `factory:metadata` pairs; any factory not
 * listed falls back to `METADATA`.
 */
const METADATA_BY_FACTORY: Record<string, Address> = Object.fromEntries(
  (process.env.NEXT_PUBLIC_FACTORY_METADATA ?? "")
    .split(",")
    .map((pair) => pair.trim().split(":"))
    .filter(([f, m]) => /^0x[0-9a-fA-F]{40}$/.test(f ?? "") && /^0x[0-9a-fA-F]{40}$/.test(m ?? ""))
    .map(([f, m]) => [f.toLowerCase(), m as Address]),
);

/**
 * Each factory's own metadata contract, read from the contracts themselves (`factory()` on each StakdMetadata), so the
 * site finds every coin's profile even when NEXT_PUBLIC_FACTORY_METADATA is missing an entry. The first factory has
 * two: METADATA (where its profiles are written) and an older one some profiles still live in, so reads try both.
 */
const KNOWN_METADATA: Record<string, Address[]> = {
  "0x80a1f3fc990a82cc37096697c174300ace606ba8": ["0xb393D9AFEec7e5d0157Ac1868C57e0a9224A39d3"], // v6
  "0xa6291c7011f48fbc6aad1b46f451f4ce79163d71": ["0x154212b63cb12d9a70ed12369ed1e81c319083fd"], // v5
  "0x007e97e52a6109eb27ddaaf6cb075fb9d604a3a0": ["0x363bd69779489b1746a2cfa22d5368e5204ebcab"], // v4
  "0xf1311a0f1f47e970db7b0d277d831b196582cdfd": ["0xc28A2243c7Bc3c8Dca67CAc86B97ae612806F3e7"], // v3
};
const EXTRA_METADATA: Record<string, Address[]> = {
  "0x019e1242e8d4b76bc0a1dca1b912daa04323d355": ["0xa55D5E6E5e80C22Ad09e7743E95D2152C09d800B", "0xc988d3111df8ed2c9fe82ae0411055506b7c0d26"], // v1
};

/** Where a coin's profile is written: the configured contract for its factory, else the known one, else METADATA. */
export function metadataFor(factory: Address | undefined): Address {
  const f = factory?.toLowerCase();
  return (f && (METADATA_BY_FACTORY[f] || KNOWN_METADATA[f]?.[0])) || METADATA;
}

/** Every contract a coin's profile might be in, the write target first. Reads try them in order. */
export function metadataCandidates(factory: Address | undefined): Address[] {
  const f = factory?.toLowerCase() ?? "";
  const all = [metadataFor(factory), ...(KNOWN_METADATA[f] ?? []), ...(EXTRA_METADATA[f] ?? [])];
  return all.filter((a, i) => all.findIndex((b) => b.toLowerCase() === a.toLowerCase()) === i);
}

/** A profile image we can actually show: an image data URI or an http(s)/ipfs URL that isn't a social post link. */
export function usableImage(src: string | undefined): string | undefined {
  const s = src?.trim();
  if (!s) return undefined;
  if (s.startsWith("data:image/")) return s;
  if (!/^(https?:|ipfs:)/i.test(s)) return undefined;
  if (/^https?:\/\/(www\.)?(x|twitter)\.com\//i.test(s)) return undefined;
  return s.replace(/^ipfs:\/\//i, "https://ipfs.io/ipfs/");
}

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

/** Telegram creator-fee targets, gated until Telegram is enabled in the Privy dashboard. */
export const TELEGRAM_ENABLED = process.env.NEXT_PUBLIC_PRIVY_TELEGRAM === "1";

/** Fomo creator-fee targets (a username plus that user's Fomo wallet), gated until switched on. */
export const FOMO_ENABLED = process.env.NEXT_PUBLIC_FOMO_FEES === "1";
