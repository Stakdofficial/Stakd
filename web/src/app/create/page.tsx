"use client";

import { useRouter } from "next/navigation";
import { type ReactElement, useMemo, useState } from "react";
import { decodeEventLog, formatUnits, parseEther } from "viem";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { avgLeverage, Basket } from "@/components/Basket";
import { DcLogo, FomoLogo, GhLogo, TgLogo, WalletLogo, XLogo } from "@/components/BrandLogos";
import { ImagePicker } from "@/components/ImagePicker";
import { factoryAbi, hookAbi, launchQuoterAbi, treasuryAbi } from "@/lib/abis";
import { fomoHandle } from "@/lib/fomo";
import { profileLink } from "@/lib/links";
import { chain, FACTORY, FOMO_ENABLED, LAUNCH_QUOTER, metadataAbi, metadataFor, TELEGRAM_ENABLED, TOKEN_DECIMALS } from "@/lib/config";
import { useMarkets, type Leg } from "@/lib/hooks";
import { formatUsd, type LighterMarket } from "@/lib/lighter";

type DraftLeg = { marketId: number; isLong: boolean; weight: number; leverage: number };

const MAX_LEGS = 6;
// Where a coin's 1% creator fee can be pointed.
type FeeTarget = "me" | "x" | "github" | "discord" | "telegram" | "fomo";
type FeeTargetOption = { key: FeeTarget; label: string; Icon: (p: { s?: number }) => ReactElement };
const ALL_FEE_TARGETS: FeeTargetOption[] = [
  { key: "me", label: "Me", Icon: WalletLogo },
  { key: "x", label: "X", Icon: XLogo },
  { key: "github", label: "GitHub", Icon: GhLogo },
  { key: "discord", label: "Discord", Icon: DcLogo },
  { key: "telegram", label: "Telegram", Icon: TgLogo },
  { key: "fomo", label: "Fomo", Icon: FomoLogo },
];
const FEE_TARGETS = ALL_FEE_TARGETS.filter(
  (t) => (t.key !== "telegram" || TELEGRAM_ENABLED) && (t.key !== "fomo" || FOMO_ENABLED),
);
const FEE_ICONS: Partial<Record<FeeTarget, (p: { s?: number }) => ReactElement>> = {
  x: XLogo,
  github: GhLogo,
  discord: DcLogo,
  telegram: TgLogo,
  fomo: FomoLogo,
};
// Lighter's Robinhood exchange market ids.
const DEFAULT_LEGS: DraftLeg[] = [
  { marketId: 26, isLong: true, weight: 40, leverage: 2 }, // SPY
  { marketId: 1, isLong: true, weight: 30, leverage: 2 }, // BTC
  { marketId: 0, isLong: true, weight: 30, leverage: 2 }, // ETH
];

export default function CreatePage() {
  const router = useRouter();
  const { address, isConnected, chainId } = useAccount();
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const markets = useMarkets();

  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [legs, setLegs] = useState<DraftLeg[]>(DEFAULT_LEGS);
  const [feePct, setFeePct] = useState(2);
  // The creator's own first buy, made in the launch transaction itself.
  const [devBuy, setDevBuy] = useState("");
  // Point the 1% at someone's social account instead of your own wallet.
  const [feePlatform, setFeePlatform] = useState<FeeTarget>("me");
  const [feeHandle, setFeeHandle] = useState("");
  // Fomo has no login to prove a username, so a Fomo target also names the Fomo wallet the fee is paid to.
  const [feeWallet, setFeeWallet] = useState("");
  const [fomoLookup, setFomoLookup] = useState<{ busy?: boolean; note?: string; warn?: boolean } | null>(null);
  const creatorHandle =
    feePlatform === "me" || !feeHandle.trim()
      ? ""
      : feePlatform === "fomo"
        ? (fomoHandle(feeHandle, feeWallet) ?? "")
        : `${feePlatform}:${feeHandle.trim().replace(/^@/, "").toLowerCase()}`;
  // Optional profile, written to StakdMetadata right after the launch transaction.
  const [profile, setProfile] = useState({ image: "", description: "", telegram: "", x: "", website: "" });
  const hasProfile = Object.values(profile).some((v) => v.trim() !== "");
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const protocolBps = useReadContract({ address: FACTORY, abi: factoryAbi, functionName: "protocolShareBps" });
  const creatorBps = useReadContract({ address: FACTORY, abi: factoryAbi, functionName: "creatorShareBps" });
  const launchOpen = useReadContract({ address: FACTORY, abi: factoryAbi, functionName: "launchOpen" });
  const paused = useReadContract({ address: FACTORY, abi: factoryAbi, functionName: "paused" });
  const isLauncher = useReadContract({
    address: FACTORY,
    abi: factoryAbi,
    functionName: "isLauncher",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: !!address },
  });
  const canLaunch = !paused.data && (launchOpen.data === true || isLauncher.data === true);
  const protocolPct = protocolBps.data !== undefined ? protocolBps.data / 100 : 40;
  const creatorPct = creatorBps.data !== undefined ? creatorBps.data / 100 : 0;
  const marginPct = 100 - creatorPct - protocolPct;
  // Hooks with a creator fee pay the creator a fixed cut of every trade on top of the coin's fee. Older hooks have
  // no such constant, so a failed read means there is none.
  const hook = useReadContract({ address: FACTORY, abi: factoryAbi, functionName: "hook" });
  const creatorFeeBps = useReadContract({
    address: hook.data,
    abi: hookAbi,
    functionName: "CREATOR_FEE_BPS",
    query: { enabled: !!hook.data, retry: false },
  });
  const creatorFeePct = creatorFeeBps.data ? creatorFeeBps.data / 100 : 0;

  const totalWeight = legs.reduce((s, l) => s + l.weight, 0);
  const chainLegs: Leg[] = legs.map((l) => ({
    marketId: l.marketId,
    isLong: l.isLong,
    weightBps: Math.round(l.weight * 100),
    leverageX10: Math.round(l.leverage * 10),
  }));

  const problems = useMemo(() => {
    const p: string[] = [];
    if (paused.data) p.push("Launches are paused right now");
    else if (address && launchOpen.data === false && isLauncher.data === false) p.push("Launches are invite-only during the pilot");
    if (!name.trim()) p.push("Add a name");
    if (!symbol.trim()) p.push("Add a ticker");
    if (totalWeight !== 100) p.push(`Weights add up to ${totalWeight}%, need 100%`);
    if (new Set(legs.map((l) => l.marketId)).size !== legs.length) p.push("Each market can only appear once");
    // Without this a half-filled Fomo target would quietly launch with the fee going to the launcher instead.
    if (feePlatform === "fomo" && !creatorHandle) p.push("Add the Fomo username and their Robinhood Chain wallet");
    return p;
  }, [name, symbol, totalWeight, legs, paused.data, launchOpen.data, isLauncher.data, address, feePlatform, creatorHandle]);

  function update(i: number, patch: Partial<DraftLeg>) {
    setLegs((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  function addLeg() {
    const used = new Set(legs.map((l) => l.marketId));
    const next = markets.data?.list.find((m) => !used.has(m.marketId));
    if (next) setLegs((ls) => [...ls, { marketId: next.marketId, isLong: true, weight: 0, leverage: 2 }]);
  }

  function balanceWeights() {
    const even = Math.floor(100 / legs.length);
    setLegs((ls) => ls.map((l, i) => ({ ...l, weight: i === 0 ? 100 - even * (ls.length - 1) : even })));
  }

  const devBuyWei = (() => {
    const n = Number(devBuy);
    return devBuy.trim() !== "" && Number.isFinite(n) && n > 0 ? parseEther(devBuy.trim()) : 0n;
  })();

  const devQuote = useReadContract({
    address: LAUNCH_QUOTER,
    abi: launchQuoterAbi,
    functionName: "quoteLaunchBuy",
    args: [devBuyWei, Math.round(feePct * 100)],
    query: { enabled: devBuyWei > 0n },
  });

  const devTokens = devQuote.data as bigint | undefined;
  const devSupplyPct = devTokens ? (Number(formatUnits(devTokens, TOKEN_DECIMALS)) / 1_000_000_000) * 100 : 0;

  /** Fill in a Fomo user's wallet from their username. A button, not on every keystroke: lookups are scarce. */
  async function findFomoWallet() {
    const handle = feeHandle.trim().replace(/^@/, "");
    if (!handle) return;
    setFomoLookup({ busy: true, note: "Looking up their Fomo wallet…" });
    try {
      for (let i = 0; i < 8; i++) {
        const res = await fetch(`/api/fomo?handle=${encodeURIComponent(handle)}`);
        const data = await res.json();
        if (!res.ok) return setFomoLookup({ note: data.error ?? "Lookup failed. Paste their wallet instead.", warn: true });
        if (data.wallet) {
          setFeeWallet(data.wallet);
          return setFomoLookup(
            data.onRobinhood
              ? { note: `Found @${handle}'s Fomo wallet.` }
              : { note: `Found a wallet for @${handle}, but it is not set up as a Fomo wallet on Robinhood Chain yet. Check it with them before launching.`, warn: true },
          );
        }
        await new Promise((r) => setTimeout(r, 5000)); // the directory is still resolving it
      }
      setFomoLookup({ note: "Still looking — try again in a minute, or paste their wallet.", warn: true });
    } catch {
      setFomoLookup({ note: "Lookup failed. Paste their wallet instead.", warn: true });
    }
  }

  async function launch() {
    if (!address || !client) return;
    setError(null);
    try {
      setStep("Confirm launch in your wallet…");
      const hash = await writeContractAsync({
        address: FACTORY,
        abi: factoryAbi,
        functionName: "createCoin",
        args: [
          {
            name: name.trim(),
            symbol: symbol.trim().toUpperCase(),
            legs: chainLegs,
            feeBps: Math.round(feePct * 100),
            // 2% of slippage room: the quote uses the lowest possible fee, the coin may charge more.
            minDevTokens: devTokens ? (devTokens * 90n) / 100n : 0n,
            creatorHandle,
          },
        ],
        value: devBuyWei,
      });
      setStep("Launching on Robinhood Chain…");
      const receipt = await client.waitForTransactionReceipt({ hash });

      let launched: `0x${string}` | null = null;
      let treasury: `0x${string}` | null = null;
      for (const log of receipt.logs) {
        try {
          const ev = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics });
          if (ev.eventName === "CoinCreated") {
            launched = ev.args.token as `0x${string}`;
            treasury = ev.args.treasury as `0x${string}`;
            break;
          }
        } catch {
          // not a factory event
        }
      }

      // A Fomo fee names its wallet in the handle, so it can be pointed there straight away instead of waiting
      // for a claim. Skipping this loses nothing: the keeper does the same thing on its next pass.
      if (treasury && feePlatform === "fomo" && creatorHandle) {
        try {
          const res = await fetch("/api/claim", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ treasury, handle: creatorHandle }),
          });
          const data = await res.json();
          if (res.ok) {
            setStep("Confirm sending the creator fee to Fomo…");
            const h = await writeContractAsync({
              address: treasury,
              abi: treasuryAbi,
              functionName: "bindCreator",
              args: [data.payout, data.subject, BigInt(data.deadline), data.proof],
            });
            await client.waitForTransactionReceipt({ hash: h });
          }
        } catch {
          // The coin is live either way.
        }
      }

      // The profile lives in its own contract, so it needs a second (optional) transaction.
      if (launched && hasProfile) {
        try {
          setStep("Confirm your coin profile…");
          const h = await writeContractAsync({
            address: metadataFor(FACTORY),
            abi: metadataAbi,
            functionName: "setMetadata",
            args: [
              launched,
              {
                image: profile.image.trim(),
                description: profile.description.trim(),
                telegram: profileLink(profile.telegram, "telegram") ?? profile.telegram.trim(),
                x: profileLink(profile.x, "x") ?? profile.x.trim(),
                website: profileLink(profile.website, "website") ?? profile.website.trim(),
              },
            ],
          });
          setStep("Saving profile…");
          await client.waitForTransactionReceipt({ hash: h });
        } catch {
          // The coin is already live; the profile can be added later from its page.
        }
      }

      router.push(launched ? `/coin/${launched}` : "/");
    } catch (e) {
      setError((e as Error).message.split("\n")[0]);
    } finally {
      setStep(null);
    }
  }

  const byId = markets.data?.byId;
  const grouped = useMemo(() => groupMarkets(markets.data?.list ?? []), [markets.data]);

  return (
    <div className="two-col">
      <div className="stack">
        <div>
          <h1>Create a coin</h1>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            Design the basket your coin&apos;s fees will trade on Lighter.
          </p>
        </div>

        {creatorFeePct > 0 && (
          <div className="earn-banner">
            <strong>+{creatorFeePct}%</strong>
            <span>
              You earn {creatorFeePct}% of every buy and sell on your coin, in ETH — paid out automatically, for as long as
              it trades. New coins also get defend mode, the bot tax and the volatility fee.
            </span>
          </div>
        )}

        <div className="card grid" style={{ gridTemplateColumns: "2fr 1fr" }}>
          <div>
            <label className="label">Name</label>
            <input className="input" value={name} maxLength={32} placeholder="My Coin" onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label">Ticker</label>
            <input
              className="input mono"
              value={symbol}
              maxLength={10}
              placeholder="COIN"
              onChange={(e) => setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            />
          </div>
        </div>

        <div className="card stack">
          <div className="spread">
            <h3>Profile</h3>
            <span className="muted small">Optional</span>
          </div>
          <div className="muted small">
            Logo and links shown on your coin&apos;s page. You can skip all of this and add it later.
          </div>
          <div>
            <label className="label">Logo</label>
            <ImagePicker value={profile.image} onChange={(v) => setProfile({ ...profile, image: v })} />
          </div>
          <div>
            <div className="spread">
              <label className="label">Description</label>
              <span className="muted small">{profile.description.length}/600</span>
            </div>
            <textarea
              className="input textarea"
              value={profile.description}
              maxLength={600}
              rows={4}
              placeholder="What is this coin about? Plain text, emojis and line breaks are fine."
              onChange={(e) => setProfile({ ...profile, description: e.target.value })}
            />
          </div>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <label className="label">Telegram</label>
              <input
                className="input"
                value={profile.telegram}
                maxLength={200}
                placeholder="https://t.me/…"
                onChange={(e) => setProfile({ ...profile, telegram: e.target.value })}
              />
            </div>
            <div>
              <label className="label">X</label>
              <input
                className="input"
                value={profile.x}
                maxLength={200}
                placeholder="https://x.com/…"
                onChange={(e) => setProfile({ ...profile, x: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="label">Website</label>
            <input
              className="input"
              value={profile.website}
              maxLength={200}
              placeholder="https://…"
              onChange={(e) => setProfile({ ...profile, website: e.target.value })}
            />
          </div>
          {hasProfile && (
            <div className="muted small">Saving the profile is a second, separate wallet confirmation after the launch.</div>
          )}
        </div>

        <div className="card stack">
          <div className="spread">
            <h3>Basket</h3>
            <div className="row">
              <button className="btn btn-outline btn-sm" onClick={balanceWeights}>
                Equal weights
              </button>
              <button className="btn btn-outline btn-sm" onClick={addLeg} disabled={legs.length >= MAX_LEGS || !markets.data}>
                + Add market
              </button>
            </div>
          </div>

          {markets.error && <div className="alert alert-error">Could not load Lighter markets.</div>}

          {legs.map((leg, i) => {
            const market = byId?.get(leg.marketId);
            const maxLev = Math.min(10, market?.maxLeverage ?? 10);
            return (
              <div className="leg-row" key={i}>
                <div className="leg-market">
                  <label className="label">Market</label>
                  <select className="select" value={leg.marketId} onChange={(e) => update(i, { marketId: Number(e.target.value) })}>
                    {!byId?.has(leg.marketId) && <option value={leg.marketId}>#{leg.marketId}</option>}
                    {grouped.map(([group, list]) => (
                      <optgroup key={group} label={group}>
                        {list.map((m) => (
                          <option key={m.marketId} value={m.marketId}>
                            {m.symbol} · {formatUsd(m.price, m.price < 1 ? 4 : 2)}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Side</label>
                  <div className="toggle">
                    <button className={leg.isLong ? "on-long" : ""} onClick={() => update(i, { isLong: true })}>
                      Long
                    </button>
                    <button className={!leg.isLong ? "on-short" : ""} onClick={() => update(i, { isLong: false })}>
                      Short
                    </button>
                  </div>
                </div>
                <div>
                  <label className="label">Weight %</label>
                  <input
                    className="input mono"
                    type="number"
                    min={1}
                    max={100}
                    value={leg.weight}
                    onChange={(e) => update(i, { weight: Math.max(0, Math.min(100, Math.round(Number(e.target.value)))) })}
                  />
                </div>
                <div>
                  <label className="label">Leverage {leg.leverage.toFixed(1)}x</label>
                  <input
                    type="range"
                    min={1}
                    max={maxLev}
                    step={0.5}
                    value={leg.leverage}
                    onChange={(e) => update(i, { leverage: Number(e.target.value) })}
                    style={{ height: 42 }}
                  />
                </div>
                <button className="icon-btn" aria-label="Remove market" disabled={legs.length === 1} onClick={() => setLegs((ls) => ls.filter((_, j) => j !== i))}>
                  ×
                </button>
              </div>
            );
          })}

          <div className="spread small">
            <span className={totalWeight === 100 ? "muted" : "neg"}>Total weight {totalWeight}%</span>
            <span className="muted">
              {legs.length}/{MAX_LEGS} markets · effective {avgLeverage(chainLegs).toFixed(2)}x
            </span>
          </div>
        </div>

        <div className="card grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
          <div>
            <label className="label">Trading fee {feePct}%</label>
            <input type="range" min={1} max={5} step={0.5} value={feePct} onChange={(e) => setFeePct(Number(e.target.value))} />
            <div className="muted small">
              1%–5%, paid in ETH on every buy and sell
              {creatorFeePct > 0 ? ` · traders pay ${feePct + creatorFeePct}% including your ${creatorFeePct}%` : ""}
            </div>
          </div>
          <div>
            <label className="label">Who gets the 1% creator fee</label>
            <div className="toggle grid2" style={{ width: "100%", marginBottom: 10 }}>
              {FEE_TARGETS.map(({ key, label, Icon }) => (
                <button key={key} className={feePlatform === key ? "on" : ""} onClick={() => setFeePlatform(key)}>
                  <Icon s={14} />
                  {label}
                </button>
              ))}
            </div>
            {feePlatform !== "me" && (
              <div className="field" style={feePlatform === "fomo" ? { marginBottom: 8 } : undefined}>
                <span className="field-prefix">{FEE_ICONS[feePlatform]?.({ s: 15 })}</span>
                <input
                  className="input"
                  style={{ paddingLeft: 36 }}
                  placeholder={feePlatform === "discord" ? "username" : "@username"}
                  value={feeHandle}
                  onChange={(e) => {
                    setFeeHandle(e.target.value.replace(/[^A-Za-z0-9_.@-]/g, ""));
                    if (feePlatform === "fomo") {
                      setFeeWallet("");
                      setFomoLookup(null);
                    }
                  }}
                />
              </div>
            )}
            {feePlatform === "fomo" && (
              <>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <input
                    className="input mono"
                    style={{ flex: 1 }}
                    placeholder="Their Fomo wallet, 0x…"
                    value={feeWallet}
                    onChange={(e) => setFeeWallet(e.target.value.trim())}
                  />
                  <button className="btn btn-outline btn-sm" disabled={!feeHandle.trim() || fomoLookup?.busy} onClick={findFomoWallet}>
                    Find wallet
                  </button>
                </div>
                {fomoLookup?.note && (
                  <div className="small" style={{ marginBottom: 8, color: fomoLookup.warn ? "var(--red)" : undefined }}>
                    {fomoLookup.note}
                  </div>
                )}
              </>
            )}
            <div className="muted small">
              {feePlatform === "fomo" ? (
                <>
                  Type their fomo.family username and press Find wallet, or paste the Robinhood Chain address from their
                  Fomo app. Every trade pays that wallet 1% in ETH, landing in their Fomo balance — you keep none of it.
                  Double-check it: the wallet can never be changed after launch.
                </>
              ) : creatorHandle ? (
                <>
                  Every trade pays <strong>{creatorHandle}</strong> 1% in ETH — you keep none of it. They claim it by
                  signing in with that account; until then it waits in the coin&apos;s treasury.
                </>
              ) : (
                "By default the 1% comes to your wallet. You can point it at someone else's account instead."
              )}
            </div>
          </div>
          <div>
            <label className="label">Buy your own coin at launch (optional)</label>
            <div className="field">
              <input
                className="input"
                style={{ paddingRight: 48 }}
                inputMode="decimal"
                placeholder="0.0"
                value={devBuy}
                onChange={(e) => setDevBuy(e.target.value.replace(/[^0-9.]/g, ""))}
              />
              <span className="field-suffix">ETH</span>
            </div>
            <div className="muted small">
              {devBuyWei > 0n && devTokens ? (
                <>
                  You get about{" "}
                  <strong>
                    {Number(formatUnits(devTokens, TOKEN_DECIMALS)).toLocaleString("en-US", {
                      maximumFractionDigits: 0,
                    })}
                  </strong>{" "}
                  {symbol.trim().toUpperCase() || "tokens"} · {devSupplyPct.toFixed(2)}% of supply
                </>
              ) : (
                "Bought in the same transaction that launches the coin, so nobody can get in ahead of you. Pays the same fee as any other buy."
              )}
            </div>
          </div>
          <div>
            <label className="label">Where fees go</label>
            <div style={{ fontWeight: 700, fontSize: 15, padding: "10px 0" }}>
              {marginPct}% portfolio · {protocolPct}% platform{creatorPct > 0 ? ` · ${creatorPct}% you` : ""}
            </div>
            <div className="muted small">
              {creatorFeePct > 0 ? `Plus ${creatorFeePct}% of every trade to you, in ETH` : "All fees are paid in ETH"}
            </div>
          </div>
          <div>
            <label className="label">Liquidity</label>
            <div className="alert small" style={{ padding: "10px 12px" }}>
              <b>No ETH needed.</b> The full supply goes into a Uniswap v4 ETH pool, locked forever.
            </div>
          </div>
        </div>
      </div>

      <aside className="card stack" style={{ position: "sticky", top: 88 }}>
        <div className="row">
          <div className="avatar" style={{ overflow: "hidden", padding: 0 }}>
            {profile.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              (symbol || "??").slice(0, 2)
            )}
          </div>
          <div>
            <strong>{name || "Your coin"}</strong>
            <div className="muted small">${symbol || "TICKER"} on {chain.name}</div>
          </div>
        </div>
        <Basket legs={chainLegs} markets={byId} />
        <div className="divider" />
        <Summary label="Supply" value="1,000,000,000" />
        <Summary label="ETH to launch" value="0 · gas only" />
        <Summary label="Fee split" value={`${marginPct}% portfolio · ${protocolPct}% platform${creatorPct > 0 ? ` · ${creatorPct}% you` : ""}`} />
        {creatorFeePct > 0 && <Summary label="You earn" value={`${creatorFeePct}% of every buy and sell, in ETH`} />}
        <Summary label="Exposure per $100 margin" value={formatUsd(avgLeverage(chainLegs) * 100)} />
        <Summary label="Profit to buyback & burn" value="75%" />
        <div className="divider" />

        {problems.length > 0 && <div className="alert small">{problems[0]}</div>}
        {error && <div className="alert alert-error small">{error}</div>}

        {!isConnected ? (
          <div className="alert small">Connect a wallet to launch.</div>
        ) : chainId !== chain.id ? (
          <div className="alert small">Switch your wallet to {chain.name}.</div>
        ) : null}

        <button className="btn btn-primary btn-block" disabled={!isConnected || chainId !== chain.id || !canLaunch || problems.length > 0 || !!step} onClick={launch}>
          {step ?? "Launch coin"}
        </button>
        <p className="muted small" style={{ margin: 0 }}>
          Perpetuals are high risk. Positions can be liquidated and margin lost.
        </p>
      </aside>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="spread small">
      <span className="muted">{label}</span>
      <span style={{ fontWeight: 600, textAlign: "right" }}>{value}</span>
    </div>
  );
}

function groupMarkets(list: LighterMarket[]): [string, LighterMarket[]][] {
  const groups: Record<string, LighterMarket[]> = { Crypto: [], Stocks: [], Other: [] };
  for (const m of list) groups[m.kind === "stock" ? "Stocks" : m.kind === "crypto" ? "Crypto" : "Other"].push(m);
  return Object.entries(groups).filter(([, l]) => l.length > 0);
}
