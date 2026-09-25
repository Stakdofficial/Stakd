"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { formatUnits, type Address } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { treasuryAbi } from "@/lib/abis";
import { ETH_DECIMALS, explorerAddress } from "@/lib/config";
import { useCoins, type CoinSummary } from "@/lib/hooks";

/** Privy's names for the accounts someone can log in with, mapped to the prefixes coins are launched with. */
const PLATFORMS: Record<string, string> = { twitter_oauth: "x", github_oauth: "github", discord_oauth: "discord" };

type Claimable = { coin: CoinSummary; handle: string; owed: bigint; claimed: boolean };

export default function ClaimPage() {
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy();
  const { address } = useAccount();
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const coins = useCoins(200);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Every handle this person is signed in as, e.g. ["x:alex", "github:alex"].
  const mine = ((user?.linkedAccounts ?? []) as { type: string; username?: string }[])
    .map((a) => (PLATFORMS[a.type] && a.username ? `${PLATFORMS[a.type]}:${a.username.toLowerCase()}` : null))
    .filter((h): h is string => !!h);

  const claimable = useQuery({
    queryKey: ["claimable", mine.join(","), coins.coins?.length ?? 0],
    enabled: !!client && mine.length > 0 && (coins.coins?.length ?? 0) > 0,
    queryFn: async (): Promise<Claimable[]> => {
      const out: Claimable[] = [];
      for (const coin of coins.coins ?? []) {
        // Coins launched before this existed have no handle and answer with a revert.
        const handle = await client!
          .readContract({ address: coin.treasury, abi: treasuryAbi, functionName: "creatorHandle" })
          .catch(() => "");
        if (!handle || !mine.includes((handle as string).toLowerCase())) continue;
        const [owed, creator] = await Promise.all([
          client!.readContract({ address: coin.treasury, abi: treasuryAbi, functionName: "creatorOwed" }),
          client!.readContract({ address: coin.treasury, abi: treasuryAbi, functionName: "creator" }),
        ]);
        out.push({ coin, handle: handle as string, owed: owed as bigint, claimed: (creator as Address) !== "0x0000000000000000000000000000000000000000" });
      }
      return out;
    },
  });

  async function claim(c: Claimable) {
    if (!address) return setNote("Connect the wallet you want to be paid into first.");
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

      await writeContractAsync({
        address: c.coin.treasury,
        abi: treasuryAbi,
        functionName: "bindCreator",
        args: [address, data.subject, BigInt(data.deadline), data.proof],
      });
      await writeContractAsync({ address: c.coin.treasury, abi: treasuryAbi, functionName: "claimCreatorFees" });
      setNote(`Paid out ${c.coin.symbol}. It will keep paying this wallet from now on.`);
      claimable.refetch();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  if (!ready) return <main className="wrap"><p className="muted">Loading…</p></main>;

  return (
    <main className="wrap stack">
      <div>
        <h1>Claim your creator fees</h1>
        <p className="muted">
          Anyone can launch a coin on Stakd and send its 1% creator fee to your X, GitHub or Discord account. Sign in
          with that account to see what is waiting for you, and name the wallet it should go to.
        </p>
      </div>

      {!authenticated ? (
        <div className="card stack">
          <p>Sign in with the account a coin was launched for.</p>
          <button className="primary" onClick={login}>Sign in with X, GitHub or Discord</button>
        </div>
      ) : (
        <div className="stack">
          <div className="card spread">
            <div>
              <div className="small muted">Signed in as</div>
              <strong>{mine.length ? mine.join(" · ") : "no social account linked"}</strong>
            </div>
            <button onClick={logout}>Sign out</button>
          </div>

          {!address && <div className="card"><p className="muted">Connect a wallet above — that is where the ETH will be sent.</p></div>}
          {note && <div className="card"><p>{note}</p></div>}

          {claimable.isLoading && <p className="muted">Looking for coins pointed at you…</p>}
          {claimable.data?.length === 0 && (
            <div className="card"><p className="muted">Nothing is pointed at your accounts yet.</p></div>
          )}

          {claimable.data?.map((c) => (
            <div className="card spread" key={c.coin.token}>
              <div>
                <strong>{c.coin.name} · ${c.coin.symbol}</strong>
                <div className="small muted">
                  fees for {c.handle} ·{" "}
                  <a href={explorerAddress(c.coin.treasury)} target="_blank" rel="noreferrer">treasury</a>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="mono"><strong>{Number(formatUnits(c.owed, ETH_DECIMALS)).toFixed(5)} ETH</strong></div>
                <button className="primary" disabled={busy === c.coin.token} onClick={() => claim(c)}>
                  {busy === c.coin.token ? "Claiming…" : c.claimed ? "Withdraw" : "Claim"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
