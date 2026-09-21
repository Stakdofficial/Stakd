"use client";

import { use, useEffect, useState } from "react";
import { formatUnits, isAddress, parseUnits, type Address } from "viem";
import { useAccount, useBalance, usePublicClient, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { avgLeverage, Basket, legLabel } from "@/components/Basket";
import { ImagePicker } from "@/components/ImagePicker";
import { PriceCurve } from "@/components/PriceCurve";
import { LiveChart } from "@/components/LiveChart";
import { BuyFromSolana } from "@/components/BuyFromSolana";
import { CoinActivity } from "@/components/CoinActivity";
import { useQuery } from "@tanstack/react-query";
import { factoryAbi, hookAbi, routerAbi, tokenAbi, treasuryAbi } from "@/lib/abis";
import { chain, erc20Abi, ETH_DECIMALS, explorerAddress, isHiddenCoin, metadataAbi, metadataFor, orderFactoryFor, POOL_MANAGER, poolManagerAbi, quoterAbi, TOKEN_DECIMALS, V4_QUOTER } from "@/lib/config";
import { useCoinFactory, useEthPrice, useLighterAccount, useMarkets, type Leg } from "@/lib/hooks";
import { formatUsd } from "@/lib/lighter";
import { decodePoolState, ethPerToken, POOL_STATE_SLOTS, poolStateSlot, sqrtPriceFromSlots } from "@/lib/pool";

const ethNum = (v: bigint | undefined) => Number(formatUnits(v ?? 0n, ETH_DECIMALS));
const ethStr = (v: bigint | undefined) => `${ethNum(v).toLocaleString("en-US", { maximumFractionDigits: 4 })} ETH`;
const compact = (v: bigint | undefined, decimals = TOKEN_DECIMALS) =>
  Number(formatUnits(v ?? 0n, decimals)).toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 });

export default function CoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = use(params);
  const token = (isAddress(raw) ? raw : "0x0000000000000000000000000000000000000000") as Address;
  const { address } = useAccount();
  const markets = useMarkets();
  const ethPrice = useEthPrice();

  // A coin keeps the factory it launched from: its hook, router and pool all belong to that one.
  const { factory: coinFactory } = useCoinFactory(token);
  const FACTORY = coinFactory ?? ("0x0000000000000000000000000000000000000000" as Address);
  const id = useReadContract({
    address: FACTORY,
    abi: factoryAbi,
    functionName: "coinIdOf",
    args: [token],
    query: { enabled: !!coinFactory },
  });
  const coin = useReadContract({
    address: FACTORY,
    abi: factoryAbi,
    functionName: "coin",
    args: [(id.data ?? 1n) - 1n],
    query: { enabled: !!id.data },
  });
  const treasury = coin.data?.treasury;

  const hookAddress = useReadContract({ address: FACTORY, abi: factoryAbi, functionName: "hook", query: { enabled: !!coinFactory } });
  const poolKey = useReadContract({ address: FACTORY, abi: factoryAbi, functionName: "poolKeyOf", args: [token], query: { enabled: !!coinFactory } });
  const METADATA = metadataFor(coinFactory);
  const meta = useReadContract({ address: METADATA, abi: metadataAbi, functionName: "metadata", args: [token], query: { enabled: !!coinFactory } });
  const poolId = coin.data?.poolId;

  const info = useReadContracts({
    allowFailure: false,
    contracts: [
      { address: token, abi: tokenAbi, functionName: "name" },
      { address: token, abi: tokenAbi, functionName: "symbol" },
      { address: token, abi: tokenAbi, functionName: "totalSupply" },
      { address: hookAddress.data!, abi: hookAbi, functionName: "pools", args: [poolId!] },
      { address: treasury!, abi: treasuryAbi, functionName: "legs" },
      { address: treasury!, abi: treasuryAbi, functionName: "marginReserve" },
      { address: treasury!, abi: treasuryAbi, functionName: "totalFeesReceived" },
      { address: treasury!, abi: treasuryAbi, functionName: "totalMarginDeposited" },
      { address: treasury!, abi: treasuryAbi, functionName: "totalBuybackEth" },
      { address: treasury!, abi: treasuryAbi, functionName: "totalTokensBurned" },
      { address: treasury!, abi: treasuryAbi, functionName: "lighterAccountSet" },
      { address: treasury!, abi: treasuryAbi, functionName: "lighterAccountIndex" },
      { address: hookAddress.data!, abi: hookAbi, functionName: "pendingFees", args: [poolId!] },
      { address: POOL_MANAGER, abi: poolManagerAbi, functionName: "extsload", args: [poolId ? poolStateSlot(poolId) : "0x", POOL_STATE_SLOTS] },
    ],
    query: { enabled: !!treasury && !!hookAddress.data && !!poolId, refetchInterval: 10_000 },
  });

  const lighter = useLighterAccount(info.data?.[11] as bigint | undefined, !!info.data?.[10]);

  if (id.isSuccess && id.data === 0n) return <div className="card empty">This token was not launched on Stakd.</div>;
  if (!info.data || !coin.data) return <div className="empty">Loading…</div>;

  const [name, symbol, supply, poolInfo, legsRaw, reserve, fees, bridged, bought, burned, accountSet, accountIndex, pendingFees, slots] =
    info.data as unknown as [
      string, string, bigint, readonly [Address, number], readonly Leg[], bigint, bigint, bigint, bigint, bigint, boolean, bigint, bigint, readonly `0x${string}`[],
    ];
  const feeBps = poolInfo[1];
  const pool = decodePoolState(slots, false); // native ETH is always currency0
  const legs = legsRaw.map((l) => ({ ...l }));
  const byId = markets.data?.byId;
  const poolTokens = pool ? Number(formatUnits(pool.tokenReserve, TOKEN_DECIMALS)) : 0;
  const usdPerEth = ethPrice.data ?? 0;
  const poolEth = pool ? Number(formatUnits(pool.ethReserve, ETH_DECIMALS)) : 0;
  // Price comes from slot0, not the reserve model: at launch every token sits above the current
  // tick, so active liquidity (and therefore the virtual reserves) reads zero while the price is real.
  const price = ethPerToken(sqrtPriceFromSlots(slots)) * usdPerEth;
  const usd = (v: bigint | undefined) => (usdPerEth ? ` · ${formatUsd(ethNum(v) * usdPerEth)}` : "");
  const positions = lighter.data?.positions ?? [];

  const status =
    bridged === 0n
      ? { live: false, text: "Collecting fees for the first margin deposit" }
      : positions.length === 0
        ? { live: false, text: `First ${ethStr(bridged)} margin deposit confirmed · positions are being opened` }
        : { live: true, text: `Trading ${positions.length} of ${legs.length} positions on Lighter` };

  const profile = meta.data as { image: string; description: string; telegram: string; x: string; website: string } | undefined;
  const socials = [
    { label: "Telegram", href: profile?.telegram },
    { label: "X", href: profile?.x },
    { label: "Website", href: profile?.website },
  ].filter((l): l is { label: string; href: string } => !!l.href && /^https?:\/\//i.test(l.href));
  const isCreator = !!address && !!coin.data?.creator && address.toLowerCase() === coin.data.creator.toLowerCase();

  return (
    <div className="two-col">
      <div className="stack">
        <div className="row">
          <div className="avatar" style={{ width: 56, height: 56, fontSize: 20, overflow: "hidden", padding: 0 }}>
            {profile?.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.image} alt="" width={56} height={56} style={{ width: 56, height: 56, objectFit: "cover" }} />
            ) : (
              symbol.slice(0, 2)
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1>{name}</h1>
            <div className="muted">
              ${symbol} ·{" "}
              <a href={explorerAddress(token)} target="_blank" rel="noreferrer" className="mono" style={{ color: "var(--blue-600)" }}>
                {token.slice(0, 6)}…{token.slice(-4)}
              </a>
              {socials.map((l) => (
                <span key={l.label}>
                  {" · "}
                  <a href={l.href} target="_blank" rel="noreferrer" style={{ color: "var(--blue-600)", fontWeight: 600 }}>
                    {l.label}
                  </a>
                </span>
              ))}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 24, fontWeight: 700 }} className="mono">
              {formatUsd(price, price < 0.01 ? 8 : 4)}
            </div>
            <div className="muted small">market cap {formatUsd(price * Number(formatUnits(supply, TOKEN_DECIMALS)), 0)}</div>
            <ShareButtons token={token} name={name} symbol={symbol} />
          </div>
        </div>

        <div className="card card-soft row small">
          <span className={`status-dot ${status.live ? "live" : ""}`} />
          {status.text}
        </div>

        {isHiddenCoin(token) && (
          <div className="alert small">This coin is not listed on Stakd. You reached it by direct link.</div>
        )}

        {profile?.description && <div className="card stack small coin-description">{profile.description}</div>}

        {isCreator && <ProfileEditor token={token} metadata={METADATA} current={profile} onSaved={() => meta.refetch()} />}

        {poolId && <LiveChart poolId={poolId} />}

        {usdPerEth > 0 && <PriceCurve poolTokens={poolTokens} poolUsdc={poolEth * usdPerEth} launchSupply={1_000_000_000} />}

        <div className="card stack">
          <div className="spread">
            <h3>Portfolio</h3>
            <span className="chip chip-soft">{avgLeverage(legs).toFixed(2)}x effective</span>
          </div>
          <Basket legs={legs} markets={byId} />
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Side</th>
                  <th>Weight</th>
                  <th>Leverage</th>
                  <th>Position</th>
                  <th>Unrealized PnL</th>
                </tr>
              </thead>
              <tbody>
                {legs.map((l) => {
                  const p = positions.find((x) => x.marketId === l.marketId);
                  return (
                    <tr key={l.marketId}>
                      <td>
                        <strong>{legLabel(l, byId)}</strong>
                      </td>
                      <td className={l.isLong ? "pos" : "neg"}>{l.isLong ? "Long" : "Short"}</td>
                      <td>{l.weightBps / 100}%</td>
                      <td>{l.leverageX10 / 10}x</td>
                      <td>{p ? formatUsd(p.value) : <span className="muted">Pending</span>}</td>
                      <td className={p ? (p.unrealizedPnl >= 0 ? "pos" : "neg") : "muted"}>{p ? formatUsd(p.unrealizedPnl) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {accountSet && (
            <div className="muted small">
              Lighter account #{accountIndex.toString()}
              {lighter.data && ` · equity ${formatUsd(lighter.data.equity)}`}
            </div>
          )}
        </div>

        {poolId && treasury && (
          <CoinActivity token={token} poolId={poolId} symbol={symbol} usdPerEth={usdPerEth} creator={coin.data.creator} treasury={treasury} />
        )}

        <div className="stats" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          <Stat k="Fees earned" v={ethStr(fees) + usd(fees)} />
          <Stat k="Margin sent to Lighter" v={ethStr(bridged) + usd(bridged)} />
          <Stat k="Waiting for Lighter" v={ethStr(reserve) + usd(reserve)} />
          <Stat k="Bought back" v={ethStr(bought) + usd(bought)} />
          <Stat k="Burned" v={`${compact(burned)} ${symbol}`} />
          <Stat k="Fees waiting to collect" v={ethStr(pendingFees) + usd(pendingFees)} />
        </div>
      </div>

      <aside style={{ position: "sticky", top: 88 }}>
        <TradePanel token={token} symbol={symbol} feeBps={feeBps} poolKey={poolKey.data} hook={hookAddress.data} poolId={poolId} />
      </aside>
    </div>
  );
}

function ShareButtons({ token, name, symbol }: { token: Address; name: string; symbol: string }) {
  const url = `https://www.stakd.tech/coin/${token}`;
  const text = `${name} ($${symbol}) is a coin with its own leveraged portfolio on @StakdOfficial`;
  const intent = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  return (
    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
      <a href={intent} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm">
        Share on X
      </a>
      <a href={`/coin/${token}/opengraph-image`} download={`${symbol}-stakd.png`} className="btn btn-outline btn-sm">
        Share card
      </a>
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

type PoolKeyTuple = { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address };

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

function TradePanel({
  token,
  symbol,
  feeBps,
  poolKey,
  hook,
  poolId,
}: {
  token: Address;
  symbol: string;
  feeBps: number;
  poolKey: PoolKeyTuple | undefined;
  hook: Address | undefined;
  poolId: `0x${string}` | undefined;
}) {
  const { address, isConnected, chainId } = useAccount();
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Trade through the router belonging to this coin's own factory, not whichever factory is current.
  const { factory: coinFactory } = useCoinFactory(token);
  // Solana buys go through the order factory of the coin's own factory; factories without one have no Solana route.
  const orderFactory = orderFactoryFor(coinFactory);
  const router = useReadContract({
    address: coinFactory ?? ("0x0000000000000000000000000000000000000000" as Address),
    abi: factoryAbi,
    functionName: "router",
    query: { enabled: !!coinFactory },
  });
  const decIn = side === "buy" ? ETH_DECIMALS : TOKEN_DECIMALS;
  const decOut = side === "buy" ? TOKEN_DECIMALS : ETH_DECIMALS;

  let amountIn = 0n;
  try {
    amountIn = parseUnits(amount || "0", decIn);
  } catch {}

  const ethBalance = useBalance({ address, query: { enabled: !!address, refetchInterval: 15_000 } });
  const tokenBalance = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address!],
    query: { enabled: !!address, refetchInterval: 15_000 },
  });
  const balIn = side === "buy" ? ethBalance.data?.value : tokenBalance.data;

  // The fee right now: the creator's fee plus the volatility fee, 5% on a sell right after your own buy, and whether
  // defend mode is sending the coin's share to buyback & burn. Hooks from before these features revert on
  // `currentFee`, so a failed read falls back to the fixed fee.
  const liveFee = useReadContracts({
    allowFailure: false,
    contracts: [
      { address: hook!, abi: hookAbi, functionName: "currentFee", args: [poolId!, false, address ?? ZERO_ADDRESS] },
      { address: hook!, abi: hookAbi, functionName: "currentFee", args: [poolId!, true, address ?? ZERO_ADDRESS] },
    ],
    query: { enabled: !!hook && !!poolId, refetchInterval: 10_000, retry: false },
  });
  const [buyFee, sellFee] = (liveFee.data as readonly (readonly [number, boolean])[] | undefined) ?? [
    [feeBps, false],
    [feeBps, false],
  ];
  const fee = side === "buy" ? buyFee[0] : sellFee[0];
  // Hooks with a creator fee quote it inside `currentFee`; older hooks have none.
  const creatorFee = useReadContract({
    address: hook,
    abi: hookAbi,
    functionName: "CREATOR_FEE_BPS",
    query: { enabled: !!hook && !!liveFee.data, retry: false },
  });
  const creatorBps = liveFee.data ? (creatorFee.data ?? 0) : 0;
  const volatilityBps = Math.max(0, buyFee[0] - creatorBps - feeBps);
  const quickFlip = side === "sell" && sellFee[0] > buyFee[0];
  const defending = buyFee[1];

  // Quote through the v4 Quoter, which simulates the pool *and* the hook, so the ETH fee is included.
  // The old reserve model broke at launch: all liquidity sits above the current tick, so it read zero
  // and disabled buying on every freshly launched coin.
  const [debouncedIn, setDebouncedIn] = useState(0n);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedIn(amountIn), 250);
    return () => clearTimeout(t);
  }, [amountIn]);

  const quoteQuery = useQuery({
    queryKey: ["quote", token, side, debouncedIn.toString(), address],
    queryFn: async () => {
      if (!client || !poolKey) return 0n;
      try {
        const { result } = await client.simulateContract({
          // The hook prices a sell right after your own buy higher, so quote as the wallet that will trade.
          account: address,
          address: V4_QUOTER,
          abi: quoterAbi,
          functionName: "quoteExactInputSingle",
          args: [{ poolKey, zeroForOne: side === "buy", exactAmount: debouncedIn, hookData: "0x" }],
        });
        return (result as readonly [bigint, bigint])[0];
      } catch {
        // The pool cannot fill this size — e.g. selling before anyone has bought.
        return 0n;
      }
    },
    enabled: !!client && !!poolKey && debouncedIn > 0n,
    staleTime: 10_000,
  });

  const quoting = debouncedIn !== amountIn || quoteQuery.isFetching;
  const expectedOut = quoteQuery.data ?? 0n;
  const minOut = (expectedOut * 97n) / 100n;

  async function trade() {
    if (!address || !client || !router.data) return;
    setMsg(null);
    try {
      let hash: `0x${string}`;
      if (side === "buy") {
        setBusy("Confirm swap…");
        hash = await writeContractAsync({ address: router.data, abi: routerAbi, functionName: "buy", args: [token, minOut, address], value: amountIn });
      } else {
        const allowance = await client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [address, router.data] });
        if (allowance < amountIn) {
          setBusy("Approve in wallet…");
          const h = await writeContractAsync({ address: token, abi: erc20Abi, functionName: "approve", args: [router.data, amountIn] });
          await client.waitForTransactionReceipt({ hash: h });
        }
        setBusy("Confirm swap…");
        hash = await writeContractAsync({ address: router.data, abi: routerAbi, functionName: "sell", args: [token, amountIn, minOut, address] });
      }
      setBusy("Swapping…");
      await client.waitForTransactionReceipt({ hash });
      setMsg({ ok: true, text: side === "buy" ? `Bought ${symbol}` : `Sold ${symbol}` });
      setAmount("");
      ethBalance.refetch();
      tokenBalance.refetch();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message.split("\n")[0] });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card stack">
      <div className="toggle">
        <button className={side === "buy" ? "on-long" : ""} onClick={() => setSide("buy")}>
          Buy
        </button>
        <button className={side === "sell" ? "on-short" : ""} onClick={() => setSide("sell")}>
          Sell
        </button>
      </div>
      <div>
        <div className="spread">
          <label className="label">You pay ({side === "buy" ? "ETH" : symbol})</label>
          {balIn !== undefined && (
            <button
              className="muted small"
              style={{ border: 0, background: "none", cursor: "pointer", padding: 0 }}
              onClick={() => setAmount(formatUnits(balIn, decIn))}
            >
              Balance {Number(formatUnits(balIn, decIn)).toLocaleString("en-US", { maximumFractionDigits: 4 })}
            </button>
          )}
        </div>
        <input className="input mono" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
      </div>
      <div className="spread small">
        <span className="muted">You receive (est.)</span>
        <span className="mono">
          {quoting && amountIn > 0n
            ? "…"
            : expectedOut > 0n
              ? Number(formatUnits(expectedOut, decOut)).toLocaleString("en-US", { maximumFractionDigits: 6 })
              : "—"}{" "}
          {side === "buy" ? symbol : "ETH"}
        </span>
      </div>
      <div className="spread small">
        <span className="muted">Trading fee</span>
        <span>
          {fee / 100}% in ETH → {defending ? "buyback & burn" : "portfolio"}
          {creatorBps > 0 ? ` + creator` : ""}
        </span>
      </div>
      {creatorBps > 0 && <div className="muted small">Includes {creatorBps / 100}% to the coin&apos;s creator.</div>}
      {quickFlip ? (
        <div className="muted small">Selling within 15 seconds of your own buy costs {fee / 100}%. Wait a moment for the normal fee.</div>
      ) : (
        volatilityBps > 0 && (
          <div className="muted small">
            Includes a {volatilityBps / 100}% volatility fee while the price is moving fast. It fades as trading calms down.
          </div>
        )
      )}
      {defending && (
        <div className="alert small">
          Defend mode is on: the price fell 20% from its high, so the coin&apos;s share of every fee buys back and burns {symbol}.
        </div>
      )}
      {msg && <div className={`alert small ${msg.ok ? "" : "alert-error"}`}>{msg.text}</div>}
      <button
        className="btn btn-primary btn-block"
        disabled={
          !isConnected ||
          chainId !== chain.id ||
          amountIn === 0n ||
          !!busy ||
          quoting ||
          expectedOut === 0n ||
          (balIn !== undefined && amountIn > balIn)
        }
        onClick={trade}
      >
        {busy ??
          (!isConnected
            ? "Connect wallet"
            : balIn !== undefined && amountIn > balIn
              ? "Insufficient balance"
              : quoting && amountIn > 0n
                ? "Quoting…"
                : amountIn > 0n && expectedOut === 0n
                  ? "No liquidity for this size"
                  : side === "buy"
                    ? `Buy ${symbol}`
                    : `Sell ${symbol}`)}
      </button>
      {side === "buy" && orderFactory && <BuyFromSolana token={token} symbol={symbol} orderFactory={orderFactory} />}
    </div>
  );
}

type Profile = { image: string; description: string; telegram: string; x: string; website: string };

const EMPTY_PROFILE: Profile = { image: "", description: "", telegram: "", x: "", website: "" };

/** Creator-only profile editor. Every field is optional; blank fields simply clear. */
function ProfileEditor({
  token,
  metadata,
  current,
  onSaved,
}: {
  token: Address;
  metadata: Address;
  current: Profile | undefined;
  onSaved: () => void;
}) {
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Profile>(current ?? EMPTY_PROFILE);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (current) setForm(current);
  }, [current]);

  const fields: { key: keyof Profile; label: string; placeholder: string }[] = [
    { key: "telegram", label: "Telegram", placeholder: "https://t.me/…" },
    { key: "x", label: "X", placeholder: "https://x.com/…" },
    { key: "website", label: "Website", placeholder: "https://…" },
  ];

  async function save() {
    setMsg(null);
    setBusy(true);
    try {
      const hash = await writeContractAsync({
        address: metadata,
        abi: metadataAbi,
        functionName: "setMetadata",
        args: [token, form],
      });
      await client?.waitForTransactionReceipt({ hash });
      setMsg({ ok: true, text: "Profile saved" });
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message.split("\n")[0] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card stack">
      <div className="spread">
        <h3>Coin profile</h3>
        <button className="btn btn-outline btn-sm" onClick={() => setOpen((v) => !v)}>
          {open ? "Close" : "Edit"}
        </button>
      </div>
      <div className="muted small">Only you can edit this — you launched the coin. Everything here is optional.</div>
      {open && (
        <>
          <div>
            <label className="label">Logo</label>
            <ImagePicker value={form.image} onChange={(v) => setForm({ ...form, image: v })} />
          </div>
          <div>
            <div className="spread">
              <label className="label">Description</label>
              <span className="muted small">{form.description.length}/600</span>
            </div>
            <textarea
              className="input textarea"
              value={form.description}
              maxLength={600}
              rows={4}
              placeholder="What is this coin about? Plain text, emojis and line breaks are fine."
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          {fields.map((f) => (
            <div key={f.key}>
              <label className="label">{f.label}</label>
              <input
                className="input"
                placeholder={f.placeholder}
                value={form[f.key]}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
              />
            </div>
          ))}
          {msg && <div className={`alert small ${msg.ok ? "" : "alert-error"}`}>{msg.text}</div>}
          <button className="btn btn-primary btn-block" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save profile"}
          </button>
        </>
      )}
    </div>
  );
}
