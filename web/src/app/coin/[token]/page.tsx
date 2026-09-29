"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { formatUnits, isAddress, parseUnits, type Address } from "viem";
import { useAccount, useBalance, usePublicClient, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { CopyAddress } from "@/components/CopyAddress";
import { avgLeverage, Basket, legLabel } from "@/components/Basket";
import { ImagePicker } from "@/components/ImagePicker";
import { PriceCurve } from "@/components/PriceCurve";
import { LiveChart } from "@/components/LiveChart";
import { BuyFromSolana } from "@/components/BuyFromSolana";
import { CoinActivity } from "@/components/CoinActivity";
import { useQuery } from "@tanstack/react-query";
import { profileLink, xHandle } from "@/lib/links";
import { factoryAbi, hookAbi, routerAbi, tokenAbi, treasuryAbi } from "@/lib/abis";
import { burnerFor, chain, erc20Abi, TOTAL_SUPPLY, ETH_DECIMALS, explorerAddress, isHiddenCoin, metadataAbi, metadataCandidates, metadataFor, orderFactoryFor, POOL_MANAGER, poolManagerAbi, quoterAbi, stakdBurnerAbi, TOKEN_DECIMALS, usableImage, V4_QUOTER } from "@/lib/config";
import { useCoinFactory, useEthPrice, useLighterAccount, useMarkets, type Leg } from "@/lib/hooks";
import { formatUsd } from "@/lib/lighter";
import { decodePoolState, ethPerToken, POOL_STATE_SLOTS, poolStateSlot, sqrtPriceFromSlots } from "@/lib/pool";
import { legRing, pct, usd as usdFmt, usePlatformStats } from "@/lib/stats";

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
  const metaAll = useReadContracts({
    allowFailure: true,
    contracts: metadataCandidates(coinFactory).map((address) => ({ address, abi: metadataAbi, functionName: "metadata" as const, args: [token] })),
    query: { enabled: !!coinFactory },
  });
  const platform = usePlatformStats();
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

  // $STAKD is burned by the hook's burner as well as by its own treasury, so its total is the two added up.
  const burnerBurned = useReadContract({
    address: burnerFor(token),
    abi: stakdBurnerAbi,
    functionName: "totalBurned",
    query: { enabled: !!burnerFor(token), retry: false, refetchInterval: 20_000 },
  });

  // Hook v3 treasuries track the creator's 1%; older ones have no such counter, so a failed read means none.
  const creatorPaid = useReadContract({
    address: treasury,
    abi: treasuryAbi,
    functionName: "totalCreatorFees",
    query: { enabled: !!treasury, retry: false, refetchInterval: 20_000 },
  });

  const lighter = useLighterAccount(info.data?.[11] as bigint | undefined, !!info.data?.[10]);

  if (id.isSuccess && id.data === 0n) return <div className="card empty">This token was not launched on Stakd.</div>;
  if (!info.data || !coin.data) return <div className="empty">Loading…</div>;

  const [name, symbol, supply, poolInfo, legsRaw, reserve, fees, bridged, bought, burned, accountSet, accountIndex, pendingFees, slots] =
    info.data as unknown as [
      string, string, bigint, readonly [Address, number], readonly Leg[], bigint, bigint, bigint, bigint, bigint, boolean, bigint, bigint, readonly `0x${string}`[],
    ];
  // Every coin mints exactly TOTAL_SUPPLY and can only ever burn, so supply missing from it is supply burned —
  // whoever burned it. Adding the treasury's own count to one burner missed $STAKD's other burners, and would
  // have gone stale again with every new factory.
  const burnedTotal = TOTAL_SUPPLY > supply ? TOTAL_SUPPLY - supply : 0n;
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

  type P = { image: string; description: string; telegram: string; x: string; website: string };
  const profiles = (metaAll.data ?? []).map((r) => r.result as P | undefined);
  // The write target comes first, so a creator's latest save wins; older contracts only fill in what it lacks.
  const profile = profiles.find((m) => m && (m.image || m.description || m.x || m.telegram || m.website)) ?? profiles[0];
  const image = usableImage(profile?.image);
  const socials = [
    { label: "Telegram", href: profileLink(profile?.telegram, "telegram") },
    { label: xHandle(profile?.x) ? `@${xHandle(profile?.x)}` : "X", href: profileLink(profile?.x, "x") },
    { label: "Website", href: profileLink(profile?.website, "website") },
  ].filter((l): l is { label: string; href: string } => !!l.href);
  const isCreator = !!address && !!coin.data?.creator && address.toLowerCase() === coin.data.creator.toLowerCase();

  const volume = platform.data?.perCoin?.[token.toLowerCase()];
  const mcapUsd = price * Number(formatUnits(supply, TOKEN_DECIMALS));
  const burnedP = Number((burnedTotal * 1_000_000n) / TOTAL_SUPPLY) / 10_000;
  const fundUsd = lighter.data?.equity;

  return (
    <div className="cpg">
      <div className="cpg-top">
        <div className="cpg-id">
          <div className="cpg-ring" style={{ background: legRing(legs) }}>
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image} alt="" />
            ) : (
              <span>{symbol.slice(0, 2)}</span>
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 className="cpg-tk">${symbol}</h1>
            <div className="cpg-meta">
              <span className="cpg-name">{name}</span>
              <CopyAddress address={token} label={`Copy ${symbol} contract address`} />
              <a href={explorerAddress(token)} target="_blank" rel="noreferrer">
                Explorer
              </a>
              {socials.map((l) => (
                <a key={l.label} href={l.href} target="_blank" rel="noreferrer">
                  {l.label}
                </a>
              ))}
              <span className={`cpg-status ${status.live ? "live" : ""}`}>{status.live ? "● Trading" : "Collecting fees"}</span>
            </div>
          </div>
        </div>
        <div className="cpg-price">
          <div className="mono">{formatUsd(price, price < 0.01 ? 8 : 4)}</div>
          <div className="muted small">market cap {formatUsd(mcapUsd, 0)}</div>
          <ShareButtons token={token} name={name} symbol={symbol} handle={xHandle(profile?.x)} />
        </div>
      </div>

      <div className="cpg-kpis">
        <div>
          <span>Market cap</span>
          <b>{usdFmt(mcapUsd)}</b>
          <small>live price</small>
        </div>
        <div>
          <span>Volume</span>
          <b>{volume && usdPerEth ? usdFmt(volume.volumeEth * usdPerEth) : platform.isLoading ? "…" : "—"}</b>
          <small>{volume ? `${volume.trades.toLocaleString("en-US")} trades` : "all time"}</small>
        </div>
        <div>
          <span>Fund value</span>
          <b>{fundUsd !== undefined ? formatUsd(fundUsd) : bridged > 0n && usdPerEth ? usdFmt(ethNum(bridged) * usdPerEth) : "—"}</b>
          <small>{fundUsd !== undefined ? "live on Lighter" : bridged > 0n ? "margin sent" : "not trading yet"}</small>
        </div>
        <div>
          <span>Burned</span>
          <b className="fire">{pct(burnedP)}</b>
          <small>of supply</small>
        </div>
      </div>

      <div className="cpg-body">
        <div className="stack">
          <div className="card card-soft row small">
            <span className={`status-dot ${status.live ? "live" : ""}`} />
            {status.text}
          </div>

          {isHiddenCoin(token) && <div className="alert small">This coin is not listed on Stakd. You reached it by direct link.</div>}

          {profile?.description && <div className="card stack small coin-description">{profile.description}</div>}

          {isCreator && <ProfileEditor token={token} metadata={METADATA} current={profile} onSaved={() => metaAll.refetch()} />}

          {poolId && <LiveChart poolId={poolId} />}

          <div className="card stack cpg-fund">
            <div className="spread">
              <h3>The fund</h3>
              <span className="chip chip-soft">{avgLeverage(legs).toFixed(2)}x effective</span>
            </div>
            <div className="cpg-fund-in">
              <div className="cpg-eq" style={{ background: legRing(legs) }}>
                <div>
                  <b>{fundUsd !== undefined ? formatUsd(fundUsd) : "—"}</b>
                  <span>fund value</span>
                </div>
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
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
              </div>
            </div>
            {accountSet && (
              <div className="cpg-lighter">
                <i />
                <span>
                  Lighter account <b>#{accountIndex.toString()}</b>
                  {lighter.data && (
                    <>
                      {" "}
                      · equity <b>{formatUsd(lighter.data.equity)}</b>
                    </>
                  )}
                </span>
                <Link href={`/lighter/${accountIndex.toString()}?coin=${encodeURIComponent(symbol)}`}>View positions on Lighter →</Link>
              </div>
            )}
            <div className="cpg-rules">
              <div>
                <b className="up">+10%</b>
                <p>above its high → half the gain is locked in, and 75% of that buys and burns the coin</p>
              </div>
              <div>
                <b className="dn">−35%</b>
                <p>from its high → every position closes and the fund pauses</p>
              </div>
            </div>
          </div>

          {usdPerEth > 0 && <PriceCurve poolTokens={poolTokens} poolUsdc={poolEth * usdPerEth} launchSupply={1_000_000_000} />}

          {poolId && treasury && (
            <CoinActivity token={token} poolId={poolId} symbol={symbol} usdPerEth={usdPerEth} creator={coin.data.creator} treasury={treasury} />
          )}

          <div className="stats" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
            <Stat k="Fees earned" v={ethStr(fees) + usd(fees)} />
            <Stat k="Margin sent to Lighter" v={ethStr(bridged) + usd(bridged)} />
            <Stat k="Waiting for Lighter" v={ethStr(reserve) + usd(reserve)} />
            <Stat k="Bought back" v={ethStr(bought) + usd(bought)} />
            <Stat k="Burned" v={`${compact(burnedTotal)} ${symbol}`} />
            <Stat k="Fees waiting to collect" v={ethStr(pendingFees) + usd(pendingFees)} />
            {creatorPaid.data !== undefined && <Stat k="Earned by creator (1%)" v={ethStr(creatorPaid.data) + usd(creatorPaid.data)} />}
          </div>
        </div>

        <aside className="cpg-side">
          <TradePanel token={token} symbol={symbol} feeBps={feeBps} poolKey={poolKey.data} hook={hookAddress.data} poolId={poolId} />
          <div className="card cpg-burn">
            <span className="eyebrow">Burned so far</span>
            <div className="pctbig">{pct(burnedP)}</div>
            <p className="muted small">
              {compact(burnedTotal)} {symbol} destroyed forever
            </p>
          </div>
          <div className="card cpg-facts">
            {[
              ["Leverage", `${avgLeverage(legs).toFixed(2)}x`],
              ["Trading fee", `${feeBps / 100}%`],
              ["Supply", "1,000,000,000"],
              ["Liquidity", "locked forever"],
              ["Paired with", "ETH"],
              ["Profit burned", "75%"],
              ["Stop-loss", "−35% from high"],
            ].map(([k, v]) => (
              <div key={k}>
                <span>{k}</span>
                <b>{v}</b>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

function ShareButtons({ token, name, symbol, handle }: { token: Address; name: string; symbol: string; handle?: string }) {
  const url = `https://www.stakd.tech/coin/${token}`;
  // Tag the coin's own X account when it has one, so every share credits the creator.
  const text = `${name} ($${symbol})${handle ? ` by @${handle}` : ""} is a coin with its own leveraged portfolio on @StakdOfficial`;
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
        // Store full links, so every reader sees the same thing.
        args: [
          token,
          {
            ...form,
            telegram: profileLink(form.telegram, "telegram") ?? form.telegram.trim(),
            x: profileLink(form.x, "x") ?? form.x.trim(),
            website: profileLink(form.website, "website") ?? form.website.trim(),
          },
        ],
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
