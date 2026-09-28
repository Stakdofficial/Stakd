"use client";

import Link from "next/link";
import { formatUnits } from "viem";
import { avgLeverage, Basket } from "@/components/Basket";
import { DcLogo, FomoLogo, GhLogo, TgLogo, XLogo } from "@/components/BrandLogos";
import { ETH_DECIMALS, FACTORY, FACTORY_VERSION, FOMO_ENABLED, TELEGRAM_ENABLED } from "@/lib/config";
import { useCoins, useMarkets, type CoinSummary } from "@/lib/hooks";
import { formatUsd } from "@/lib/lighter";
import { BasketShowcase } from "@/components/landing/BasketShowcase";
import { Flywheel } from "@/components/landing/Flywheel";
import { HeroCard } from "@/components/landing/HeroCard";
import { PlatformStats } from "@/components/landing/PlatformStats";
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
              <a href="#creator-fees" className="pill">
                <span className="pill-dot" /> New · Send your 1% to any {FOMO_ENABLED ? "social or Fomo" : "social"} account
              </a>
            </Reveal>
            <Reveal delay={80}>
              <h1 className="display">
                Launch a coin with its own <span className="gradient-text">leveraged portfolio</span>
              </h1>
            </Reveal>
            <Reveal delay={160}>
              <p className="lead">
                Pick up to six stock or crypto markets. Trading fees become margin, the portfolio trades perps on
                Lighter, and profits buy back and burn your coin. You earn 1% of every trade, in ETH.
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
              {["Creators earn 1%", "Paired with ETH", "No ETH to launch", "Liquidity locked forever", "75% of profit burned", "Stop-loss built in", "Buyable with SOL"].map((t) => (
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

      <PlatformStats />

      <section className="section" id="creator-fees">
        <Reveal className="section-head">
          <span className="eyebrow">New · live on mainnet</span>
          <h2 className="section-title">Send your 1% to anyone</h2>
          <p className="lead center">
            The creator fee doesn&apos;t have to come to you. Point it at a friend, a dev, a community or a trader, by
            their username. Every buy and sell pays them 1% in ETH from the very first trade.
          </p>
        </Reveal>
        <Reveal delay={80} className="fee-targets">
          {FEE_PLATFORMS.map(({ label, Icon }) => (
            <span key={label} className="fee-target">
              <Icon s={16} /> {label}
            </span>
          ))}
        </Reveal>
        <div className="v3-grid">
          {FEE_REDIRECT.map((f, i) => (
            <Reveal key={f.tag} delay={120 + i * 80} className={`v3-card${f.creator ? " creator" : ""}`}>
              <span className="v3-tag">{f.tag}</span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
              <div className="v3-spec">{f.spec}</div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={360} className="routes-note">
          The launcher keeps none of it, and neither do we. Where the fee goes is set at launch and can&apos;t be changed.
        </Reveal>
      </section>

      <section className="section" id="hook-v3">
        <Reveal className="section-head">
          <span className="eyebrow">Smart fees · live on mainnet</span>
          <h2 className="section-title">The fee that fights back, and pays creators</h2>
          <p className="lead center">
            Every coin reads the market on every swap. Creators get paid, bots pay the most, wild candles burn
            $STAKD, and when the chart bleeds, fees turn into burns.
          </p>
        </Reveal>
        <div className="v3-grid">
          {V3.map((f, i) => (
            <Reveal key={f.tag} delay={i * 80} className={`v3-card${f.creator ? " creator" : ""}`}>
              <span className="v3-tag">{f.tag}</span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
              <div className="v3-spec">{f.spec}</div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={320} className="routes-note">
          The coin&apos;s own fee never goes above 5%, so a trade costs at most 6% with the creator&apos;s 1%. Coins launched
          before Hook v3 keep the rules they launched with.
        </Reveal>
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
          <p>Launch in a minute. From the very first trade, fees fund the portfolio and 1% goes to you.</p>
          <Link href="/create" className="btn btn-white btn-lg">
            Launch a coin →
          </Link>
        </Reveal>
      </section>
    </>
  );
}

const FEE_PLATFORMS = [
  { label: "X", Icon: XLogo },
  { label: "GitHub", Icon: GhLogo },
  { label: "Discord", Icon: DcLogo },
  ...(TELEGRAM_ENABLED ? [{ label: "Telegram", Icon: TgLogo }] : []),
  ...(FOMO_ENABLED ? [{ label: "Fomo", Icon: FomoLogo }] : []),
];

const FEE_REDIRECT: { tag: string; title: string; body: string; spec: string; creator?: boolean }[] = [
  {
    tag: "Socials",
    title: TELEGRAM_ENABLED ? "Pay any X, GitHub, Discord or Telegram handle" : "Pay any X, GitHub or Discord handle",
    body: `Type a username when you launch. The fee piles up for them in the coin's treasury until they sign in with that account and pick a wallet. They don't need a wallet first.`,
    spec: "sign in to claim · locked to their account",
    creator: true,
  },
  ...(FOMO_ENABLED
    ? [
        {
          tag: "Fomo",
          title: "Straight into a Fomo balance",
          body: "Type a fomo.family username and we find their wallet. Every trade pays it directly, landing in their Fomo app. Nothing to claim, nothing to sign.",
          spec: "no claiming · paid automatically",
        },
      ]
    : []),
  {
    tag: "Safe by design",
    title: "Nobody can redirect it",
    body: "A username can be renamed, but the fee stays with the account that first claims it. Once a coin launches, its fee target is locked for good.",
    spec: "set at launch · can't be changed",
  },
];

const V3: { tag: string; title: string; body: string; spec: string; creator?: boolean }[] = [
  {
    tag: "Creator fee",
    title: "Creators earn 1% of every trade",
    body: "Every buy and sell — including buys from Solana — pays the coin's creator 1% in ETH, on top of the coin's fee. The portfolio, platform and burns keep their full share.",
    spec: "1% · in ETH · paid out automatically",
    creator: true,
  },
  {
    tag: "Defend mode",
    title: "The chart bleeds. The fees burn.",
    body: "When the price falls 20% below its high, the coin's share of every fee goes straight to buyback & burn for six hours instead of the portfolio. Traders pay nothing extra.",
    spec: "−20% trigger · 6h · 60% → burn",
  },
  {
    tag: "Bot tax",
    title: "Flip in 15 seconds, pay the max",
    body: "Selling within 15 seconds of your own buy pays the full 5% coin fee, so sandwich bots and instant round trips fund the coin. Hold a moment longer and you pay the normal fee.",
    spec: "15s window · 5% on the flip",
  },
  {
    tag: "Volatility fee",
    title: "Wild candles burn $STAKD",
    body: "The coin's fee rises with recent price movement and fades back as the market calms. The coin's share of that extra fee is split in two: half buys back and burns the coin, half buys back and burns $STAKD.",
    spec: "+0.05% per 1% move · up to +2% · ½ burns $STAKD",
  },
];

const FAQ: [string, string][] = [
  [
    "Where does the margin come from?",
    "From trading fees. Every buy and sell pays the coin's fee (1–5%) in ETH through a Uniswap v4 hook. 60% is swapped to USDG and deposited into Lighter as the coin's trading margin, and 40% goes to the platform.",
  ],
  [
    "Do creators earn anything?",
    "Yes, on coins launched with Hook v3 or later. Every buy and sell pays 1% in ETH on top of the coin's fee. By default it goes to the launcher's wallet, but it can be pointed at any X, GitHub, Discord, Telegram or Fomo account instead.",
  ],
  [
    "How does someone collect a creator fee sent to their account?",
    "For X, GitHub, Discord and Telegram, they sign in on the Claim page with that account and pick a wallet. Until then the ETH waits in the coin's treasury, and nobody else can take it. For Fomo there's nothing to claim: the fee is paid straight into their Fomo wallet on Robinhood Chain.",
  ],
  [
    "Why did my sell cost more than the usual fee?",
    "On Hook v3 coins the fee reacts to the market: selling within 15 seconds of your own buy pays the 5% maximum, and fast-moving prices add up to 2%. Wait a moment for the normal fee.",
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
    "Every portfolio has a stop-loss. If it falls 35% below its high, the keeper closes every position and pauses the coin. At 2x that's roughly a 17% market drop, well before liquidation. What's left stays in the coin's account. Burns only come from profit above the previous high.",
  ],
  [
    "When does profit get burned?",
    "When the portfolio is 10% above its previous high, the keeper locks in half of that gain and withdraws 75% of it to buy back and burn the coin. The rest stays in the portfolio.",
  ],
  [
    "Do I need ETH to launch a coin?",
    "No. The whole 1B supply goes into a Uniswap v4 pool as single-sided liquidity starting at a ~$2.5k market cap (about 0.9 ETH), locked forever. Buyers' ETH fills the pool as they trade. You only pay gas.",
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
            <span className="row" style={{ gap: 6 }}>
              {coin.factory.toLowerCase() === FACTORY.toLowerCase() && <span className="ver-badge">{FACTORY_VERSION}</span>}
              <span className="chip chip-soft">{avgLeverage(coin.legs).toFixed(1)}x</span>
            </span>
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
