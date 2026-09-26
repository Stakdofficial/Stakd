"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { formatUnits, type Address } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { DcLogo, GhLogo, LOGOS, TgLogo, XLogo } from "@/components/BrandLogos";
import { treasuryAbi } from "@/lib/abis";
import { ETH_DECIMALS, explorerAddress, TELEGRAM_ENABLED } from "@/lib/config";
import { useCoins, useEthPrice, type CoinSummary } from "@/lib/hooks";
import { formatUsd } from "@/lib/lighter";

/** Privy's names for the accounts someone can log in with, mapped to the prefixes coins are launched with. */
const PLATFORMS: Record<string, string> = {
  twitter_oauth: "x",
  github_oauth: "github",
  discord_oauth: "discord",
  telegram: "telegram",
};
const ZERO = "0x0000000000000000000000000000000000000000";
/** Only name Telegram once it is really switched on, so we never invite a login that does not exist. */
const PLATFORM_LIST = TELEGRAM_ENABLED ? "X, GitHub, Discord or Telegram" : "X, GitHub or Discord";


type Claimable = { coin: CoinSummary; handle: string; owed: bigint; bound: boolean };

export default function ClaimPage() {
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy();
  const { address } = useAccount();
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const coins = useCoins(200);
  const usdPerEth = useEthPrice().data ?? 0;
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const mine = ((user?.linkedAccounts ?? []) as { type: string; username?: string }[])
    .map((a) => (PLATFORMS[a.type] && a.username ? `${PLATFORMS[a.type]}:${a.username.toLowerCase()}` : null))
    .filter((h): h is string => !!h);

  const claimable = useQuery({
    queryKey: ["claimable", mine.join(","), coins.coins?.length ?? 0],
    enabled: !!client && mine.length > 0 && (coins.coins?.length ?? 0) > 0,
    queryFn: async (): Promise<Claimable[]> => {
      const out: Claimable[] = [];
      for (const coin of coins.coins ?? []) {
        // Coins launched before this feature have no handle at all and answer with a revert.
        const handle = (await client!
          .readContract({ address: coin.treasury, abi: treasuryAbi, functionName: "creatorHandle" })
          .catch(() => "")) as string;
        if (!handle || !mine.includes(handle.toLowerCase())) continue;
        const [owed, creator] = await Promise.all([
          client!.readContract({ address: coin.treasury, abi: treasuryAbi, functionName: "creatorOwed" }),
          client!.readContract({ address: coin.treasury, abi: treasuryAbi, functionName: "creator" }),
        ]);
        out.push({ coin, handle, owed: owed as bigint, bound: (creator as Address) !== ZERO });
      }
      return out;
    },
  });

  const rows = claimable.data ?? [];
  const totalOwed = rows.reduce((s, r) => s + r.owed, 0n);

  async function claim(c: Claimable) {
    if (!address) return setNote({ kind: "err", text: "Connect the wallet you want to be paid into first." });
    setBusy(c.coin.token);
    setNote(null);
    try {
      const accessToken = await getAccessToken();
      const res = await fetch("/api/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessToken, treasury: c.coin.treasury, handle: c.handle, payout: address }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not sign that claim.");

      if (!c.bound) {
        await writeContractAsync({
          address: c.coin.treasury,
          abi: treasuryAbi,
          functionName: "bindCreator",
          args: [address, data.subject, BigInt(data.deadline), data.proof],
        });
      }
      await writeContractAsync({ address: c.coin.treasury, abi: treasuryAbi, functionName: "claimCreatorFees" });
      setNote({ kind: "ok", text: `Paid out $${c.coin.symbol}. It keeps paying this wallet from now on.` });
      claimable.refetch();
    } catch (e) {
      setNote({ kind: "err", text: e instanceof Error ? e.message : "Something went wrong." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <main>
      <section className="hero">
        <h1>
          Someone launched a coin <span>for you</span>
        </h1>
        <p>
          Anyone on Stakd can point a coin&apos;s 1% creator fee at your {PLATFORM_LIST} account. It piles up from the
          first trade whether you know about it or not. Sign in to collect it.
        </p>
        <div className="claim-platforms">
          <span className="chip"><XLogo s={15} /> X</span>
          <span className="chip"><GhLogo s={15} /> GitHub</span>
          <span className="chip"><DcLogo s={15} /> Discord</span>
          {TELEGRAM_ENABLED && (
            <span className="chip"><TgLogo s={15} /> Telegram</span>
          )}
        </div>
      </section>

      {!ready ? (
        <div className="card"><p className="muted">Loading…</p></div>
      ) : !authenticated ? (
        <>
          <div className="card claim-signin">
            <h3>Sign in to see what you&apos;re owed</h3>
            <p className="muted small">
              We only read which account you are. No wallet or seed phrase needed — one is made for you if you
              don&apos;t have one.
            </p>
            <button className="btn btn-primary btn-block" onClick={login}>
              Continue with {PLATFORM_LIST}
            </button>
          </div>
          <div className="steps claim-steps">
            <div className="step"><b>01</b>Someone launches a coin and points its 1% at your handle.</div>
            <div className="step"><b>02</b>Every buy and sell pays you, in ETH, from the first block.</div>
            <div className="step"><b>03</b>You sign in here and name the wallet it should go to.</div>
            <div className="step"><b>04</b>It keeps paying that wallet forever. Nobody else can claim it.</div>
          </div>
        </>
      ) : (
        <div className="stack">
          <div className="card spread claim-who">
            <div>
              <div className="small muted">Signed in as</div>
              <div className="claim-handles">
                {mine.length ? (
                  mine.map((h) => {
                    const Logo = LOGOS[h.split(":")[0]] ?? XLogo;
                    return (
                      <span className="chip" key={h}>
                        <Logo s={14} /> {h.split(":")[1]}
                      </span>
                    );
                  })
                ) : (
                  <span className="muted">No social account linked to this login.</span>
                )}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              {totalOwed > 0n && (
                <div className="claim-total">
                  <div className="small muted">Waiting for you</div>
                  <strong className="mono">{Number(formatUnits(totalOwed, ETH_DECIMALS)).toFixed(5)} ETH</strong>
                </div>
              )}
              <button className="btn btn-outline btn-sm" onClick={logout}>Sign out</button>
            </div>
          </div>

          {!address && (
            <div className="card card-soft">
              <strong>Connect a wallet</strong>
              <p className="muted small">That is where the ETH is sent. Use the button at the top right.</p>
            </div>
          )}

          {note && (
            <div className="card card-soft" style={{ borderColor: note.kind === "err" ? "var(--red, #f87171)" : undefined }}>
              {note.text}
            </div>
          )}

          {claimable.isLoading && <div className="card"><p className="muted">Checking every coin for your handle…</p></div>}

          {!claimable.isLoading && rows.length === 0 && (
            <div className="card claim-empty">
              <h3>Nothing yet</h3>
              <p className="muted">
                No coin has been pointed at {mine.length ? mine.map((h) => h.split(":")[1]).join(" or ") : "your accounts"} so
                far. If someone launches one, it will show up here on its own.
              </p>
            </div>
          )}

          {rows.map((c) => {
            const Logo = LOGOS[c.handle.split(":")[0]] ?? XLogo;
            const eth = Number(formatUnits(c.owed, ETH_DECIMALS));
            return (
              <div className="card spread claim-row" key={c.coin.token}>
                <div>
                  <strong>
                    {c.coin.name} <span className="muted">·</span> ${c.coin.symbol}
                  </strong>
                  <div className="small muted claim-row-sub">
                    <span className="chip chip-soft"><Logo s={13} /> {c.handle.split(":")[1]}</span>
                    <a href={explorerAddress(c.coin.treasury)} target="_blank" rel="noreferrer">treasury</a>
                    {c.bound && <span className="chip chip-soft">already yours</span>}
                  </div>
                </div>
                <div className="claim-amount">
                  <div className="mono claim-eth">{eth.toFixed(5)} ETH</div>
                  {usdPerEth > 0 && <div className="small muted">{formatUsd(eth * usdPerEth)}</div>}
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={busy === c.coin.token || c.owed === 0n}
                    onClick={() => claim(c)}
                  >
                    {busy === c.coin.token ? "Claiming…" : c.owed === 0n ? "Nothing owed" : c.bound ? "Withdraw" : "Claim"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
