"use client";

import { useMemo, useState } from "react";
import { formatUnits, type Address, type Hex } from "viem";
import { useAccount, useReadContract, useWriteContract, usePublicClient } from "wagmi";
import { chain, explorerAddress, orderFactoryAbi } from "@/lib/config";

/**
 * Buying this coin with SOL.
 *
 * Fast bridges move value quickly but will not call a contract on arrival, so the order is encoded in an
 * address instead: send funds there and the order can be filled by anyone, on the buyer's terms. Change any
 * detail and it is a different address, so an order cannot be altered once it has been quoted.
 *
 * The fee is the same as buying here — the difference is where it goes: a cross-chain buy's share of the fee
 * buys the coin back and burns it, rather than funding the coin's portfolio.
 */
export function BuyFromSolana({ token, symbol, orderFactory: ORDER_FACTORY }: { token: Address; symbol: string; orderFactory: Address }) {
  const { address, isConnected } = useAccount();
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // One order per wallet per hour: the deadline is part of the address, so it has to be stable while the buyer
  // bridges, and it doubles as the window after which the funds can only go back to them.
  const deadline = useMemo(() => BigInt(Math.floor(Date.now() / 1000 / 3600) * 3600 + 7200), []);

  const order = useMemo(
    () =>
      ({
        token,
        minTokensOut: 0n,
        to: `0x${(address ?? "0x0000000000000000000000000000000000000000").slice(2).padStart(64, "0")}` as Hex,
        dstEid: 0,
        bridgeFee: 0n,
        deadline,
        refundTo: (address ?? "0x0000000000000000000000000000000000000000") as Address,
        salt: `0x${"0".repeat(63)}1` as Hex,
      }) as const,
    [token, address, deadline],
  );

  const orderAddress = useReadContract({
    address: ORDER_FACTORY,
    abi: orderFactoryAbi,
    functionName: "orderAddress",
    args: [order],
    query: { enabled: !!address },
  });

  const pending = useReadContract({
    address: ORDER_FACTORY,
    abi: orderFactoryAbi,
    functionName: "pending",
    args: [order],
    query: { enabled: !!address && !!orderAddress.data, refetchInterval: 6_000 },
  });

  const waiting = pending.data ?? 0n;
  // Relay's own chain ids: 792703809 is Solana, 4663 is Robinhood Chain. Naming both pins the route so the
  // page opens on the right pair rather than whatever the user last used.
  const relayUrl = orderAddress.data
    ? `https://relay.link/bridge/robinhood?fromChainId=792703809&toChainId=${chain.id}&toAddress=${orderAddress.data}`
    : "https://relay.link";

  async function complete() {
    if (!orderAddress.data || !client) return;
    setBusy(true);
    setMsg(null);
    try {
      const hash = await writeContractAsync({ address: ORDER_FACTORY, abi: orderFactoryAbi, functionName: "fill", args: [order] });
      await client.waitForTransactionReceipt({ hash });
      setMsg({ ok: true, text: `Bought ${symbol}. The fee from this buy burns supply.` });
      pending.refetch();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message.split("\n")[0].slice(0, 140) });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="btn ghost" style={{ width: "100%", marginTop: 10 }} onClick={() => setOpen(true)}>
        Buy with SOL instead →
      </button>
    );
  }

  return (
    <div className="stack" style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
      <div className="spread">
        <strong>Buy with SOL</strong>
        <button className="btn ghost small" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>

      {!isConnected ? (
        <div className="muted small">Connect a wallet first — it is where your {symbol} will be sent.</div>
      ) : (
        <>
          <ol className="small stack" style={{ paddingLeft: 18, gap: 8 }}>
            <li>
              <a href={relayUrl} target="_blank" rel="noreferrer" style={{ color: "var(--blue-600)", fontWeight: 600 }}>
                Open Relay
              </a>{" "}
              and pay with SOL from your Solana wallet. It arrives as ETH on {chain.name} in seconds — Relay does the
              swap, so there is nothing to paste: the link already names the order address below as the recipient.
              <div className="mono" style={{ wordBreak: "break-all", marginTop: 6 }}>
                {orderAddress.data ? (
                  <a href={explorerAddress(orderAddress.data)} target="_blank" rel="noreferrer" style={{ color: "var(--blue-600)" }}>
                    {orderAddress.data}
                  </a>
                ) : (
                  "…"
                )}
              </div>
              <div className="muted" style={{ marginTop: 4 }}>
                This is a {chain.name} address, not a Solana one — your SOL never goes to it directly.
              </div>
            </li>
            <li>
              Come back and complete the purchase. The {symbol} goes to your wallet, and this buy&apos;s fee{" "}
              <strong>buys the coin back and burns it</strong> instead of funding the portfolio.
            </li>
          </ol>

          <div className="spread small">
            <span className="muted">Waiting at your order address</span>
            <span className="mono">{Number(formatUnits(waiting, 18)).toLocaleString("en-US", { maximumFractionDigits: 6 })} ETH</span>
          </div>

          <button className="btn" disabled={busy || waiting === 0n} onClick={complete} style={{ width: "100%" }}>
            {busy ? "Buying…" : waiting === 0n ? "Waiting for your SOL…" : `Complete purchase of ${symbol}`}
          </button>

          {msg && (
            <div className={`small ${msg.ok ? "pos" : "neg"}`} style={{ wordBreak: "break-word" }}>
              {msg.text}
            </div>
          )}

          <div className="muted small">
            The address is built from your order, so nobody can change where the coins go. If it is not filled by{" "}
            {new Date(Number(deadline) * 1000).toLocaleTimeString()}, the ETH can only be returned to you.
          </div>
        </>
      )}
    </div>
  );
}
