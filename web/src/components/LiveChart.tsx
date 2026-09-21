"use client";

import { useEffect, useState } from "react";

/**
 * Live candlestick chart for a coin's Uniswap v4 pool, embedded from DEX Screener.
 * DEX Screener indexes Robinhood Chain v4 pools by pool id, so every Stakd coin gets a chart once it has traded.
 * Brand-new pools may not be indexed yet; we check the public API first and show a note instead of a broken frame.
 */

const CHAIN = "robinhood";
const HEIGHT = 440;
const FOOTER = 40;

type Status = "loading" | "ready" | "missing";

export function LiveChart({ poolId }: { poolId: `0x${string}` }) {
  const [status, setStatus] = useState<Status>("loading");
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const read = () => setDark(root.dataset.theme === "dark");
    read();
    const obs = new MutationObserver(read);
    obs.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    fetch(`https://api.dexscreener.com/latest/dex/pairs/${CHAIN}/${poolId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setStatus(d?.pairs?.length || d?.pair ? "ready" : "missing");
      })
      .catch(() => {
        // If the check itself fails (network, rate limit), still try the chart.
        if (!cancelled) setStatus("ready");
      });
    return () => {
      cancelled = true;
    };
  }, [poolId]);

  const pageUrl = `https://dexscreener.com/${CHAIN}/${poolId}`;
  const embedUrl = `${pageUrl}?embed=1&loadChartSettings=0&trades=0&tabs=0&info=0&chartLeftToolbar=0&chartDefaultOnMobile=1&chartTheme=${dark ? "dark" : "light"}&theme=${dark ? "dark" : "light"}&chartStyle=1&chartType=usd&interval=15`;

  return (
    <div className="card stack">
      <h3>Live chart</h3>
      {status === "missing" ? (
        <div className="muted small" style={{ padding: "32px 0", textAlign: "center" }}>
          The live chart appears once DEX Screener picks up this pool, usually within minutes of the first trades.
        </div>
      ) : (
        <div style={{ position: "relative", width: "100%", height: HEIGHT, borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)" }}>
          {status === "loading" ? (
            <div className="muted small" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
              Loading chart…
            </div>
          ) : (
            <iframe
              key={dark ? "dark" : "light"}
              src={embedUrl}
              title="Live price chart"
              loading="lazy"
              // The embed ends in a ~40px "Tracked by" footer; render it past the clipped bottom edge.
              style={{ width: "100%", height: HEIGHT + FOOTER, border: 0, display: "block" }}
            />
          )}
        </div>
      )}
    </div>
  );
}
