"use client";

import { use } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { explorerAddress } from "@/lib/config";
import { useLighterAccount } from "@/lib/hooks";
import { formatUsd } from "@/lib/lighter";

const LIGHTER_API = "https://api.rh.lighter.xyz";

const price = (n: number) => (n >= 1000 ? formatUsd(n, 2) : n >= 1 ? formatUsd(n, 3) : formatUsd(n, 6));
const signedUsd = (n: number) => `${n >= 0 ? "+" : "−"}${formatUsd(Math.abs(n))}`;
const pnlColor = (n: number) => (n >= 0 ? "var(--green)" : "var(--red)");

/**
 * A coin's portfolio as Lighter shows it, read live from Lighter's Robinhood Chain exchange. That exchange numbers
 * its accounts separately from Lighter mainnet, so explorers that only index mainnet (LighterData, app.lighter.xyz)
 * show an unrelated account under the same number; this page is the one that reads the right exchange.
 */
export default function LighterAccountPage({ params }: { params: Promise<{ index: string }> }) {
  const { index } = use(params);
  const coin = useSearchParams().get("coin");
  const valid = /^\d+$/.test(index);
  const account = useLighterAccount(valid ? BigInt(index) : undefined, valid);
  const a = account.data;

  if (!valid) return <div className="card empty">That is not a Lighter account number.</div>;

  const positions = a?.positions ?? [];
  const exposure = positions.reduce((s, p) => s + Math.abs(p.value), 0);
  const upnl = positions.reduce((s, p) => s + p.unrealizedPnl, 0);
  const funding = positions.reduce((s, p) => s + (p.fundingPaid ?? 0), 0);

  return (
    <div className="stack">
      <div className="spread" style={{ flexWrap: "wrap", gap: 12 }}>
        <div>
          <span className="eyebrow">Lighter · Robinhood Chain exchange</span>
          <h1 style={{ margin: "6px 0 0" }}>{coin ? `$${coin} portfolio` : "Lighter account"}</h1>
          <div className="muted small" style={{ marginTop: 6 }}>
            Account #{index}
            {a?.owner && (
              <>
                {" · owner "}
                <a href={explorerAddress(a.owner)} target="_blank" rel="noreferrer" style={{ color: "var(--blue-600)" }}>
                  {a.owner.slice(0, 6)}…{a.owner.slice(-4)}
                </a>
              </>
            )}
          </div>
        </div>
        <span className="pill">
          <span className="pill-dot" /> Live · refreshes every 15s
        </span>
      </div>

      {account.isError ? (
        <div className="alert alert-error">Lighter isn&apos;t responding right now. Try again in a moment.</div>
      ) : !a ? (
        <div className="empty">Loading positions from Lighter…</div>
      ) : (
        <>
          <div className="stats" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
            <Stat k="Equity" v={formatUsd(a.equity)} />
            <Stat k="Available" v={formatUsd(a.available)} />
            <Stat k="Margin used" v={a.initialMargin !== undefined ? formatUsd(a.initialMargin) : "—"} />
            <Stat k="Leverage" v={a.equity > 0 ? `${(exposure / a.equity).toFixed(2)}x` : "—"} />
            <Stat k="Unrealized PnL" v={signedUsd(upnl)} color={pnlColor(upnl)} />
            <Stat k="Funding" v={funding <= 0 ? `+${formatUsd(-funding)} received` : `${formatUsd(funding)} paid`} />
          </div>

          <div className="card stack">
            <div className="spread">
              <strong>Positions ({positions.length})</strong>
              <span className="muted small">Exposure {formatUsd(exposure)}</span>
            </div>
            {positions.length === 0 ? (
              <div className="empty">No open positions.</div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Market</th>
                      <th>Side</th>
                      <th>Size</th>
                      <th>Value</th>
                      <th>Entry</th>
                      <th>Mark</th>
                      <th>Unrealized PnL</th>
                      <th>Liq. price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((p) => {
                      const size = Math.abs(p.size);
                      const mark = size > 0 ? Math.abs(p.value) / size : 0;
                      const cost = p.entryPrice * size;
                      const pct = cost > 0 ? (p.unrealizedPnl / cost) * 100 : 0;
                      return (
                        <tr key={p.marketId}>
                          <td>
                            <b>{p.symbol}</b>
                          </td>
                          <td style={{ color: p.size >= 0 ? "var(--green)" : "var(--red)", fontWeight: 700 }}>{p.size >= 0 ? "Long" : "Short"}</td>
                          <td className="mono">
                            {size.toLocaleString("en-US", { maximumFractionDigits: 6 })} {p.symbol}
                          </td>
                          <td className="mono">{formatUsd(Math.abs(p.value))}</td>
                          <td className="mono">{price(p.entryPrice)}</td>
                          <td className="mono">{price(mark)}</td>
                          <td className="mono" style={{ color: pnlColor(p.unrealizedPnl), fontWeight: 700 }}>
                            {signedUsd(p.unrealizedPnl)} ({pct >= 0 ? "+" : ""}
                            {pct.toFixed(2)}%)
                          </td>
                          <td className="mono">{p.liquidationPrice ? price(p.liquidationPrice) : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      <div className="card muted small stack" style={{ gap: 6 }}>
        <div>
          Read live from Lighter&apos;s Robinhood Chain exchange.{" "}
          <a href={`${LIGHTER_API}/api/v1/account?by=index&value=${index}`} target="_blank" rel="noreferrer" style={{ color: "var(--blue-600)" }}>
            Raw account data →
          </a>
        </div>
        <div>
          Looking this number up on LighterData or app.lighter.xyz shows a different account: those read Lighter mainnet,
          which numbers its accounts separately.
        </div>
        {coin && (
          <div>
            <Link href="/#coins" style={{ color: "var(--blue-600)" }}>
              ← Back to coins
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v" style={color ? { color } : undefined}>
        {v}
      </div>
    </div>
  );
}
