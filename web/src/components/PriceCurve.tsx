"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatUsd } from "@/lib/lighter";

/**
 * Market cap along the coin's Uniswap V2 constant-product curve.
 *
 * With x tokens and y ETH in the pool (valued here in USD), k = x·y and the spot price is k / x².
 * x-axis: share of launch supply bought out of the pool. y-axis: market cap (price × launch supply), log scale,
 * because a constant-product curve spans four orders of magnitude between launch and 99% sold.
 */

const MAX_SOLD = 0.99;
const HEIGHT = 260;
const PAD = { top: 16, right: 16, bottom: 28, left: 64 };
const LINE = "#2563eb";
const MARKER = "#0ea5e9";

type Props = {
  poolTokens: number; // whole tokens in the pool
  poolUsdc: number; // ETH in the pool, in USD
  launchSupply: number;
};

export function PriceCurve({ poolTokens, poolUsdc, launchSupply }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null); // sold fraction under the cursor

  useEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, e.contentRect.width)));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const k = poolTokens * poolUsdc;
  const S = launchSupply;
  const soldNow = Math.min(MAX_SOLD, Math.max(0, 1 - poolTokens / S));

  const capAt = (f: number) => (k / (S * (1 - f)) ** 2) * S;
  const usdcToReach = (f: number) => Math.max(0, k / (S * (1 - f)) - poolUsdc);

  const start = capAt(0);
  const ceiling = capAt(MAX_SOLD);
  const now = capAt(soldNow);

  const innerW = width - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const logMin = Math.log10(start);
  const logMax = Math.log10(ceiling);
  const xOf = (f: number) => PAD.left + (f / MAX_SOLD) * innerW;
  const yOf = (cap: number) => PAD.top + innerH - ((Math.log10(cap) - logMin) / (logMax - logMin)) * innerH;

  const { line, area, ticks } = useMemo(() => {
    // A pool with no liquidity yet gives k = 0, so logMin/logMax are -Infinity and the
    // decade loop below would never advance. Bail out before building the path.
    if (!(k > 0 && S > 0) || !Number.isFinite(logMin) || !Number.isFinite(logMax) || logMax <= logMin) {
      return { line: "", area: "", ticks: [] as number[] };
    }
    const pts: string[] = [];
    for (let i = 0; i <= 120; i++) {
      const f = (i / 120) * MAX_SOLD;
      pts.push(`${xOf(f).toFixed(1)},${yOf(capAt(f)).toFixed(1)}`);
    }
    const baseline = PAD.top + innerH;
    const decades: number[] = [];
    for (let d = Math.ceil(logMin); d <= Math.floor(logMax); d++) decades.push(10 ** d);
    return {
      line: `M${pts.join("L")}`,
      area: `M${xOf(0)},${baseline}L${pts.join("L")}L${xOf(MAX_SOLD)},${baseline}Z`,
      ticks: decades,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k, S, width]);

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const f = ((e.clientX - rect.left) / rect.width) * MAX_SOLD;
    setHover(Math.min(MAX_SOLD, Math.max(0, f)));
  }

  if (!(k > 0 && S > 0)) return null;

  const hoverCap = hover !== null ? capAt(hover) : null;
  const tipLeft = hover !== null ? Math.min(Math.max(xOf(hover), PAD.left + 90), width - PAD.right - 90) : 0;

  return (
    <div className="card stack">
      <div className="spread">
        <h3>Price curve</h3>
        <span className="muted small mono">{(soldNow * 100).toFixed(1)}% of supply bought</span>
      </div>

      <div ref={wrap} style={{ position: "relative" }}>
        <svg width={width} height={HEIGHT} role="img" aria-label={`Market cap curve from ${formatUsd(start, 0)} to ${formatUsd(ceiling, 0)}; currently ${formatUsd(now, 0)}`} style={{ display: "block" }}>
          <defs>
            <linearGradient id="curve-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={LINE} stopOpacity="0.16" />
              <stop offset="100%" stopColor={LINE} stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={yOf(t)} y2={yOf(t)} stroke="var(--border)" strokeDasharray="3 4" />
              <text x={PAD.left - 8} y={yOf(t)} dy="0.32em" textAnchor="end" className="chart-axis">
                {compactUsd(t)}
              </text>
            </g>
          ))}
          <line x1={PAD.left} x2={width - PAD.right} y1={PAD.top + innerH} y2={PAD.top + innerH} stroke="var(--border-strong)" />
          {[0, 0.25, 0.5, 0.75, MAX_SOLD].map((f) => (
            <text key={f} x={xOf(f)} y={HEIGHT - 8} textAnchor={f === 0 ? "start" : f === MAX_SOLD ? "end" : "middle"} className="chart-axis">
              {Math.round(f * 100)}%
            </text>
          ))}

          <path d={area} fill="url(#curve-fill)" />
          <path d={line} fill="none" stroke={LINE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

          {/* current position */}
          <line x1={xOf(soldNow)} x2={xOf(soldNow)} y1={PAD.top} y2={PAD.top + innerH} stroke={MARKER} strokeWidth={2} strokeDasharray="4 4" />
          <circle cx={xOf(soldNow)} cy={yOf(now)} r={6} fill={MARKER} stroke="var(--surface)" strokeWidth={2} />
          <text
            x={xOf(soldNow) + 10}
            y={PAD.top + 10}
            className="chart-label"
            textAnchor={soldNow > 0.8 ? "end" : "start"}
            dx={soldNow > 0.8 ? -20 : 0}
          >
            Now · {compactUsd(now)}
          </text>

          {hover !== null && hoverCap !== null && (
            <g pointerEvents="none">
              <line x1={xOf(hover)} x2={xOf(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--text-muted)" strokeOpacity={0.4} />
              <circle cx={xOf(hover)} cy={yOf(hoverCap)} r={4} fill={LINE} stroke="var(--surface)" strokeWidth={2} />
            </g>
          )}

          <rect
            x={PAD.left}
            y={PAD.top}
            width={innerW}
            height={innerH}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>

        {hover !== null && hoverCap !== null && (
          <div className="chart-tip" style={{ left: tipLeft, top: 8 }}>
            <div className="mono" style={{ fontWeight: 700 }}>{compactUsd(hoverCap)} market cap</div>
            <div className="muted">{(hover * 100).toFixed(1)}% of supply bought</div>
            <div className="muted">price {formatUsd(hoverCap / S, hoverCap / S < 0.01 ? 8 : 4)}</div>
            {hover > soldNow && <div className="muted">{compactUsd(usdcToReach(hover))} more buys to reach</div>}
          </div>
        )}
      </div>

      <div className="spread small mono">
        <span className="muted">{compactUsd(start)} start</span>
        <span>{compactUsd(usdcToReach(MAX_SOLD))} to 99%</span>
        <span className="muted">{compactUsd(ceiling)} at 99%</span>
      </div>
      <div className="progress" aria-hidden>
        <div style={{ width: `${(soldNow / MAX_SOLD) * 100}%` }} />
      </div>
    </div>
  );
}

function compactUsd(n: number) {
  return "$" + n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: n < 1000 ? 2 : 2 });
}
