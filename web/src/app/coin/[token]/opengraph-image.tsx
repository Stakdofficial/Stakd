import { ImageResponse } from "next/og";
import { isAddress, type Address } from "viem";
import { getCoinSummary } from "@/lib/coinSummary";

// Share card for a coin: shown as the link preview on X and other apps, and downloadable from the coin page.
export const alt = "Coin on Stakd";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 300;

const BG = "linear-gradient(160deg, #0d2a5c 0%, #0a1a45 45%, #08163b 100%)";

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const coin = isAddress(token) ? await getCoinSummary(token as Address).catch(() => null) : null;

  if (!coin) {
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: BG, color: "#fff" }}>
          <Brand size={72} />
        </div>
      ),
      size,
    );
  }

  const stats = [
    { k: "Market cap", v: usd(coin.marketCapUsd) },
    { k: "Fees earned", v: usd(coin.feesUsd) },
    { k: "Trading fee", v: `${coin.feePct}% in ETH` },
    { k: "Burned", v: coin.burned > 0 ? compact(coin.burned) : "Soon" },
  ];

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: "56px 64px", background: BG, color: "#fff", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Brand size={34} />
          <div style={{ display: "flex", padding: "8px 18px", borderRadius: 999, border: "1.5px solid rgba(125,211,252,.45)", color: "#7dd3fc", fontSize: 18, fontWeight: 700, letterSpacing: 2 }}>
            ROBINHOOD CHAIN
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 28, marginTop: 52 }}>
          {coin.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coin.image} width={112} height={112} style={{ borderRadius: 28, objectFit: "cover" }} alt="" />
          ) : (
            <div style={{ width: 112, height: 112, borderRadius: 28, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg,#1e40af,#0b1f4d)", fontSize: 44, fontWeight: 800 }}>
              {coin.symbol.slice(0, 2)}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div style={{ display: "flex", fontSize: 64, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1.5 }}>{coin.name}</div>
            <div style={{ display: "flex", fontSize: 30, color: "#93b4e0", marginTop: 6 }}>{`$${coin.symbol}`}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <div style={{ fontSize: 22, color: "#93b4e0" }}>Price</div>
            <div style={{ fontSize: 48, fontWeight: 800 }}>{price(coin.priceUsd)}</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 36, flexWrap: "wrap" }}>
          <div style={{ display: "flex", fontSize: 20, color: "#93b4e0", alignItems: "center", marginRight: 6 }}>Portfolio</div>
          {coin.legs.map((l) => (
            <div
              key={l.symbol}
              style={{
                display: "flex",
                padding: "10px 18px",
                borderRadius: 999,
                fontSize: 22,
                fontWeight: 700,
                background: l.isLong ? "rgba(16,185,129,.16)" : "rgba(239,68,68,.16)",
                color: l.isLong ? "#6ee7b7" : "#fca5a5",
              }}
            >
              {`${l.isLong ? "Long" : "Short"} ${l.symbol} · ${l.weightPct}% · ${l.leverage}x`}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 16, marginTop: "auto" }}>
          {stats.map((s) => (
            <div key={s.k} style={{ display: "flex", flexDirection: "column", flex: 1, padding: "20px 24px", borderRadius: 20, background: "rgba(5,14,38,.6)", border: "1.5px solid rgba(147,197,253,.18)" }}>
              <div style={{ fontSize: 18, color: "#93b4e0" }}>{s.k}</div>
              <div style={{ fontSize: 32, fontWeight: 800, marginTop: 6 }}>{s.v}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 22, fontSize: 20, color: "#7ea3d4" }}>
          <div style={{ display: "flex" }}>A coin with its own leveraged portfolio</div>
          <div style={{ display: "flex", color: "#bfdbfe" }}>stakd.tech</div>
        </div>
      </div>
    ),
    size,
  );
}

function Brand({ size }: { size: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: size * 0.4 }}>
      <svg width={size * 1.2} height={size * 1.2} viewBox="8 7 24 26">
        <path d="M9 26.5 20 21l11 5.5L20 32z" fill="#3b82f6" />
        <path d="M9 20 20 14.5 31 20 20 25.5z" fill="#60a5fa" />
        <path d="M9 13.5 20 8l11 5.5L20 19z" fill="#7dd3fc" />
      </svg>
      <div style={{ display: "flex", fontSize: size, fontWeight: 800, letterSpacing: -1 }}>Stakd</div>
    </div>
  );
}

function usd(n: number) {
  if (!n) return "$0";
  return "$" + n.toLocaleString("en-US", { notation: n >= 10_000 ? "compact" : "standard", maximumFractionDigits: n >= 10_000 ? 1 : 0 });
}

function price(n: number) {
  if (!n) return "—";
  return "$" + (n < 0.01 ? n.toPrecision(3) : n.toFixed(4));
}

function compact(n: number) {
  return n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
}
