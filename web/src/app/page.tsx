"use client";

import Link from "next/link";
import { formatUnits } from "viem";
import { avgLeverage, Basket } from "@/components/Basket";
import { ETH_DECIMALS, FACTORY } from "@/lib/config";
import { useCoins, useMarkets, type CoinSummary } from "@/lib/hooks";
import { formatUsd } from "@/lib/lighter";
import { BasketShowcase } from "@/components/landing/BasketShowcase";
import { Flywheel } from "@/components/landing/Flywheel";
import { HeroCard } from "@/components/landing/HeroCard";
import { SolanaRoutes } from "@/components/landing/SolanaRoutes";
import { CountUp, Reveal } from "@/components/landing/motion";
import { Ticker } from "@/components/landing/Ticker";

const eth = (v: bigint) => `${Number(formatUnits(v, ETH_DECIMALS)).toLocaleString("en-US", { maximumFractionDigits: 4 })} ETH`;

export default function Home() {
  const { coins, isLoading, error } = useCoins();
  const markets = useMarkets();
  const unconfigured = /^0x0+$/.test(FACTORY);

  return (
    <>
      <section className="bleed landing-hero">
        <div className="hero-bg" aria-hidden>
          <div className="blob blob-1" />
          <div className="blob blob-2" />
          <div className="blob blob-3" />
          <div className="hero-grid" />
        </div>
        <div className="container hero-split">
          <div className="hero-copy">
            <Reveal>
              <span className="pill">
                <span className="pill-dot" /> Live on Robinhood Chain mainnet · trades on Lighter
              </span>
            </Reveal>
            <Reveal delay={80}>
              <h1 className="display">
                Launch a coin with its own <span className="gradient-text">leveraged portfolio</span>
              </h1>
            </Reveal>
            <Reveal delay={160}>
              <p className="lead">
                Pick up to six stock or crypto markets. Trading fees become margin, the portfolio trades perps on
                Lighter, and profits buy back and burn your coin.
              </p>
            </Reveal>
            <Reveal delay={240} className="hero-ctas">
              <Link href="/create" className="btn btn-primary btn-lg shine">
                Launch a coin →
              </Link>
              <a href="#coins" className="btn btn-outline btn-lg">
                Explore coins
              </a>
            </Reveal>
            <Reveal delay={320} className="hero-trust">
              {["Paired with ETH", "No ETH to launch", "Liquidity locked forever", "75% of profit burned", "Buyable with SOL"].map((t) => (
                <span key={t} className="trust-item">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="m20 6-11 11-5-5" />
                  </svg>
                  {t}
                </span>
              ))}
            </Reveal>
          </div>
          <HeroCard />
        </div>
      </section>

      <section className="bleed ticker-band">
        <Ticker />
      </section>

      <section className="section">
        <Reveal className="section-head">
          <span className="eyebrow">How it works</span>
          <h2 className="section-title">A flywheel that burns supply</h2>
          <p className="lead center">Trading activity funds the portfolio, and the portfolio&apos;s profits shrink the supply.</p>
        </Reveal>
        <Flywheel />
      </section>

      <section className="section split-section">
        <Reveal className="split-copy">
          <span className="eyebrow">Design the basket</span>
          <h2 className="section-title left">Any mix of stocks and crypto, long or short</h2>
          <p className="lead">
            Build from 50+ Lighter perpetuals, from SPY and NVDA to BTC, gold and oil. Set each weight and 1–10x
            leverage. Once the coin launches, its basket is stored on-chain and can&apos;t be changed.
          </p>
          <ul className="checks">
            <li>Up to 6 markets per coin</li>
            <li>Long or short on every leg</li>
            <li>Its own Lighter sub-account, rebalanced automatically</li>
          </ul>
        </Reveal>
        <Reveal delay={120}>
          <BasketShowcase />
        </Reveal>
      </section>

      <section className="section">
        <Reveal className="section-head">
          <span className="eyebrow">New · live on mainnet</span>
          <h2 className="section-title">Buy with SOL. Supply burns.</h2>
          <p className="lead center">
            Coins launched on Stakd can be bought from Solana — pay in SOL and it arrives on Robinhood Chain in
            seconds. You pay the same fee either way. What changes is where that fee goes.
          </p>
        </Reveal>
        <Reveal delay={120}>
          <SolanaRoutes />
        </Reveal>
        <Reveal delay={200} className="routes-note">
          The contract routes the fee by who made the swap, so a cross-chain buy funds burns instead of the
          portfolio. Enforced in code, not by policy.
        </Reveal>
      </section>

      <section className="section">
        <div className="stat-band">
          {[
            { v: 50, suffix: "+", k: "Perp markets to pick from" },
            { v: 6, k: "Markets per basket" },
            { v: 10, suffix: "x", k: "Max leverage per leg" },
            { v: 75, suffix: "%", k: "Of realized profit burned" },
          ].map((s, i) => (
            <Reveal key={s.k} delay={i * 90} className="stat-big">
              <div className="stat-num gradient-text">
                <CountUp value={s.v} suffix={s.suffix} />
              </div>
              <div className="muted">{s.k}</div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="section" id="coins">
        <Reveal className="spread" style={{ marginBottom: 20 }}>
          <div>
            <span className="eyebrow">Coins</span>
            <h2 className="section-title left">Launched on Stakd</h2>
          </div>
          {coins && <span className="muted small">{coins.length} launched</span>}
        </Reveal>
      {unconfigured ? (
        <div className="card empty">
          Coins will appear here once the launchpad contracts are live on Robinhood Chain.
        </div>
      ) : error ? (
        <div className="alert alert-error">{error.message.split("\n")[0]}</div>
      ) : isLoading || !coins ? (
        <div className="empty">Loading coins…</div>
      ) : coins.length === 0 ? (
        <div className="card empty">
          No coins yet. <Link href="/create" style={{ color: "var(--blue-600)", fontWeight: 600 }}>Launch the first one →</Link>
        </div>
      ) : (
        <div className="coin-grid">
          {coins.map((c) => (
            <CoinCard key={c.token} coin={c} markets={markets.data?.byId} />
          ))}
        </div>
      )}
      </section>

      <section className="section faq-section">
        <Reveal className="section-head">
          <span className="eyebrow">FAQ</span>
          <h2 className="section-title">Good to know</h2>
        </Reveal>
        <div className="faq">
          {FAQ.map(([q, a], i) => (
            <Reveal key={q} delay={i * 60}>
              <details className="faq-item">
                <summary>{q}</summary>
                <p className="muted">{a}</p>
              </details>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="section">
        <Reveal className="cta-band">
          <div className="cta-glow" aria-hidden />
          <h2>Your basket. Your coin.</h2>
          <p>Launch in a minute. Fees start funding the portfolio from the very first trade.</p>
          <Link href="/create" className="btn btn-white btn-lg">
            Launch a coin →
          </Link>
        </Reveal>
      </section>
    </>
  );
}

const FAQ: [string, string][] = [
  [
    "Where does the margin come from?",
    "From trading fees. Every buy and sell pays the coin's fee (1–5%) in ETH through a Uniswap v4 hook. 60% is swapped to USDG and deposited into Lighter as the coin's trading margin, and 40% goes to the platform.",
  ],
  [
    "Who places the trades?",
    "A keeper bot run by the operator. It opens each leg at equity × weight × leverage in the coin's own Lighter sub-account, rebalances when positions drift, and takes partial profits.",
  ],
  [
    "What stops the keeper from taking the ETH?",
    "The treasury contract. Margin can only be swapped to USDG and deposited into Lighter, fee shares can only go to the creator and the platform, and returned profit can only buy back and burn the coin. Positions on Lighter do rely on trusting the operator.",
  ],
  [
    "What happens if the portfolio loses?",
    "Leveraged perps can lose margin or be liquidated. Burns only happen from realized profit above the high-water mark, so there are no buybacks while the portfolio is below its previous high.",
  ],
  [
    "Do I need ETH to launch a coin?",
    "No. The whole 1B supply goes into a Uniswap v4 pool as single-sided liquidity starting at a ~$5k market cap, locked forever. Buyers' ETH fills the pool as they trade. You only pay gas.",
  ],
  [
    "Why can stock legs sit idle?",
    "Lighter's equity perps trade 24/5. Outside market hours the keeper waits and opens or rebalances those legs once trading resumes.",
  ],
];

function CoinCard({ coin, markets }: { coin: CoinSummary; markets?: Map<number, import("@/lib/lighter").LighterMarket> }) {
  const status = coin.totalMarginDeposited === 0n ? "Collecting fees" : `${eth(coin.totalMarginDeposited)} margin deposited`;
  return (
    <Link href={`/coin/${coin.token}`} className="card coin-card stack">
      <div className="row">
        <div className="avatar" style={{ overflow: "hidden", padding: 0 }}>
          {coin.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coin.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            coin.symbol.slice(0, 2)
          )}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="spread">
            <strong>{coin.name}</strong>
            <span className="chip chip-soft">{avgLeverage(coin.legs).toFixed(1)}x</span>
          </div>
          <div className="muted small">
            ${coin.symbol} · {status}
          </div>
        </div>
      </div>
      <Basket legs={coin.legs} markets={markets} />
      <div className="stats">
        <div className="stat">
          <div className="k">Margin sent</div>
          <div className="v">{eth(coin.totalMarginDeposited)}</div>
        </div>
        <div className="stat">
          <div className="k">Pending</div>
          <div className="v">{eth(coin.marginReserve)}</div>
        </div>
        <div className="stat">
          <div className="k">Bought back</div>
          <div className="v">{eth(coin.totalBuybackEth)}</div>
        </div>
      </div>
    </Link>
  );
}
