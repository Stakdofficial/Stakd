"use client";

import Link from "next/link";
import { DcLogo, FomoLogo, GhLogo, TgLogo, XLogo } from "@/components/BrandLogos";
import { CoinTile } from "@/components/CoinTile";
import { LogoMark } from "@/components/Logo";
import { MarketTiles } from "@/components/home/MarketTiles";
import { BasketShowcase } from "@/components/landing/BasketShowcase";
import { Reveal } from "@/components/landing/motion";
import { SolanaRoutes } from "@/components/landing/SolanaRoutes";
import { Ticker } from "@/components/landing/Ticker";
import { FACTORY, FOMO_ENABLED, TELEGRAM_ENABLED } from "@/lib/config";
import { FAQ } from "@/lib/faq";
import { useCoins, useEthPrice, useMarkets } from "@/lib/hooks";
import { usd, usePlatformStats } from "@/lib/stats";

const FEE_PLATFORMS = [
  { label: "X", Icon: XLogo },
  { label: "GitHub", Icon: GhLogo },
  { label: "Discord", Icon: DcLogo },
  ...(TELEGRAM_ENABLED ? [{ label: "Telegram", Icon: TgLogo }] : []),
  ...(FOMO_ENABLED ? [{ label: "Fomo", Icon: FomoLogo }] : []),
];

export default function Home() {
  const { coins, isLoading, error } = useCoins();
  const markets = useMarkets();
  const stats = usePlatformStats();
  const ethUsd = useEthPrice().data;
  const s = stats.data;
  const unconfigured = /^0x0+$/.test(FACTORY);
  const handle = FOMO_ENABLED ? "DegenCapitalLLC" : "someone";

  // Busiest coins first on the homepage; the full list lives on /coins.
  const featured = [...(coins ?? [])]
    .sort((a, b) => (s?.perCoin?.[b.token.toLowerCase()]?.volumeEth ?? 0) - (s?.perCoin?.[a.token.toLowerCase()]?.volumeEth ?? 0))
    .slice(0, 6);

  return (
    <div className="home">
      {/* HERO */}
      <section className="bleed h-hero">
        <div className="h-mesh" aria-hidden>
          <span />
          <span />
          <span />
        </div>
        <div className="container h-hero-in">
          <div>
            <Reveal>
              <Link href="#creators" className="h-kicker">
                <b>NEW</b> Send your 1% to any {FOMO_ENABLED ? "social or Fomo" : "social"} account
              </Link>
            </Reveal>
            <Reveal delay={80}>
              <h1 className="h-title">
                Every coin
                <br />
                gets a
                <br />
                <span className="gradient-text">hedge fund.</span>
              </h1>
            </Reveal>
            <Reveal delay={160}>
              <p className="h-sub">
                Launch a token on Robinhood Chain that <strong>trades its own portfolio</strong> of stocks and crypto,
                and <strong>burns itself</strong> with every profit.
              </p>
            </Reveal>
            <Reveal delay={240} className="h-ctas">
              <Link href="/create" className="btn btn-primary btn-lg shine">
                Launch your coin →
              </Link>
              <Link href="/coins" className="btn btn-outline btn-lg">
                Explore coins
              </Link>
            </Reveal>
            <Reveal delay={320} className="h-proof">
              <div>
                <b>{s ? s.coins : "—"}</b>coins live
              </div>
              <div>
                <b>{s && ethUsd ? usd(s.volumeEth * ethUsd) : "—"}</b>traded
              </div>
              <div>
                <b>{s && ethUsd ? usd(s.buybackEth * ethUsd) : "—"}</b>bought &amp; burned
              </div>
            </Reveal>
          </div>
          <div className="h-orbit" aria-hidden>
            <div className="ring" />
            <div className="ring r2" />
            <div className="core">
              <LogoMark size={180} />
            </div>
            <div className="sat s1">
              <span className="up">▲ NVDA</span> 40% · 2x
            </div>
            <div className="sat s2">
              <span className="up">▲ BTC</span> 30% · 3x
            </div>
            <div className="sat s3">
              <span className="dn">▼ TSLA</span> 30% · 2x
            </div>
            <div className="sat s4">
              <span className="f">🔥 profit → burn</span>
            </div>
          </div>
        </div>
      </section>

      <section className="bleed ticker-band">
        <Ticker />
      </section>

      {/* HOW */}
      <section className="section" id="how">
        <Reveal className="h-head center">
          <span className="eyebrow">How it works</span>
          <h2 className="h-h2">
            Three moves.
            <br />
            Then it runs itself.
          </h2>
          <p className="h-lede">You design the fund once. After that, every trade on your coin feeds it, and every win shrinks the supply.</p>
        </Reveal>
        <div className="steps3">
          <Reveal className="step">
            <span className="n">1</span>
            <div className="viz legs-demo">
              <span>▲ SPY 40%</span>
              <span>▲ BTC 30%</span>
              <span className="s">▼ TSLA 30%</span>
            </div>
            <h3>Pick the portfolio</h3>
            <p>Up to 6 stock or crypto markets from 50+ on Lighter. Long or short, 1–10x. It&apos;s locked on-chain at launch.</p>
          </Reveal>
          <Reveal className="step" delay={100}>
            <span className="n">2</span>
            <div className="viz">
              <div className="row">
                <span>every trade · 1–5% fee</span>
                <b>in ETH</b>
              </div>
              <div className="split">
                <i />
                <i />
              </div>
              <div className="row">
                <span>
                  <b>60%</b> → the fund
                </span>
                <span>40% platform</span>
              </div>
            </div>
            <h3>Trades fund it</h3>
            <p>Every buy and sell pays a fee in ETH. Most of it becomes trading margin in your coin&apos;s own Lighter account.</p>
          </Reveal>
          <Reveal className="step" delay={200}>
            <span className="n">3</span>
            <div className="viz">
              <div className="flame">75%</div>
              <div className="row">
                <span>of realized profit</span>
                <b>→ buy &amp; burn</b>
              </div>
            </div>
            <h3>Profits burn it</h3>
            <p>When the fund makes money, the profit buys your coin off the market and destroys it. Supply only goes down.</p>
          </Reveal>
        </div>
      </section>

      {/* SMART FEES */}
      <section className="section" id="fees">
        <Reveal className="h-head center">
          <span className="eyebrow">Smart fees · live on mainnet</span>
          <h2 className="h-h2">
            The fee that
            <br />
            fights back.
          </h2>
          <p className="h-lede">
            Every coin reads the market on every swap. Creators get paid, bots pay the most, wild candles burn $STAKD, and
            when the chart bleeds, fees turn into burns.
          </p>
        </Reveal>
        <div className="fees4">
          {FEES.map((f, i) => (
            <Reveal key={f.tag} delay={i * 80} className={`fx ${f.tone}`}>
              <span className="tag">{f.tag}</span>
              <div className="big">{f.big}</div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
              <div className="spec">{f.spec}</div>
            </Reveal>
          ))}
        </div>
        <Reveal className="h-note">
          A coin&apos;s own fee never goes above 5%, so a trade costs at most 6% with the creator&apos;s 1%. Coins launched
          before Hook v3 keep the rules they launched with.
        </Reveal>
      </section>

      {/* BUILT IN */}
      <section className="section" id="features">
        <Reveal className="h-head">
          <span className="eyebrow">Built in</span>
          <h2 className="h-h2 left">
            Everything a coin
            <br />
            never had.
          </h2>
        </Reveal>
        <div className="bento">
          <Reveal className="tile t-a">
            <MarketTiles markets={markets.data?.list} />
            <h3>Stocks, crypto and commodities in one coin.</h3>
            <p>Your coin can be long the S&amp;P 500 and short Tesla at the same time, traded as perps on Lighter.</p>
          </Reveal>
          <Reveal className="tile t-b">
            <div className="gauge">
              <i />
            </div>
            <div className="gl">
              <span>0%</span>
              <span>stop ~17%</span>
              <span>liq ~50%</span>
            </div>
            <h3>Stop-loss built in.</h3>
            <p>At −35% from its high the fund closes every position. At 2x that&apos;s long before liquidation.</p>
          </Reveal>
          <Reveal className="tile t-c t-fire">
            <div className="big fire">½</div>
            <h3>Wild candles burn $STAKD.</h3>
            <p>Half of every volatility fee buys and burns $STAKD, from every coin.</p>
          </Reveal>
          <Reveal className="tile t-d">
            <div className="big">0</div>
            <h3>ETH to launch.</h3>
            <p>The whole supply goes into the pool. You only pay gas.</p>
          </Reveal>
          <Reveal className="tile t-e t-sol">
            <div className="big sm">SOL→</div>
            <h3>Buy from Solana.</h3>
            <p>Pay in SOL, land on Robinhood Chain in seconds. Those fees go straight to burns.</p>
          </Reveal>
          <Reveal className="tile t-f">
            <div className="big">∞</div>
            <h3>Liquidity locked forever.</h3>
            <p>Nobody can pull the pool. Not the creator, not us.</p>
          </Reveal>
        </div>
      </section>

      {/* DESIGN THE BASKET */}
      <section className="section split-section" id="basket">
        <Reveal className="split-copy">
          <span className="eyebrow">Design the basket</span>
          <h2 className="h-h2 left">Any mix of stocks and crypto, long or short.</h2>
          <p className="h-lede">
            Build from 50+ Lighter perpetuals, from SPY and NVDA to BTC, gold and oil. Set each weight and 1–10x leverage.
            Once the coin launches, its basket is stored on-chain and can&apos;t be changed.
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

      {/* CREATORS */}
      <section className="section" id="creators">
        <div className="fee-split">
          <Reveal>
            <span className="eyebrow">Creator fee</span>
            <h2 className="h-h2 left">
              Pay anyone.
              <br />
              By username.
            </h2>
            <p className="h-lede">
              Every trade pays 1% in ETH. Keep it, or send it to a dev, a friend, a community or a trader, just by typing
              their handle.
            </p>
            <ul className="bul">
              <li>
                <b>X, GitHub, Discord{TELEGRAM_ENABLED ? ", Telegram" : ""}:</b> they sign in to claim. No wallet needed
                first.
              </li>
              {FOMO_ENABLED && (
                <li>
                  <b>Fomo:</b> paid straight into their Fomo balance. Nothing to claim.
                </li>
              )}
              <li>
                <b>Locked at launch.</b> Nobody can redirect it later, not even us.
              </li>
            </ul>
          </Reveal>
          <Reveal delay={150} className="handle-card">
            <div className="hc-top">
              <span>Who gets the 1%</span>
              <span>example</span>
            </div>
            <div className="plats">
              <span className="plat">Me</span>
              {FEE_PLATFORMS.map(({ label, Icon }) => (
                <span key={label} className={`plat ${label === (FOMO_ENABLED ? "Fomo" : "X") ? "on" : ""}`}>
                  <Icon s={13} /> {label}
                </span>
              ))}
            </div>
            <div className="hfield">
              <span className="at">@</span>
              {handle}
              <span className="cur" />
            </div>
            <div className="payline">
              {[
                ["buy 0.42 ETH", "+0.0042"],
                ["sell 1.18 ETH", "+0.0118"],
                ["buy 2.60 ETH", "+0.0260"],
              ].map(([a, b]) => (
                <div key={a} className="pl">
                  <span>{a}</span>
                  <b>
                    {b} → @{handle}
                  </b>
                </div>
              ))}
            </div>
            <Link href="/claim" className="hc-claim">
              Someone pointed a fee at you? Claim it →
            </Link>
          </Reveal>
        </div>
      </section>

      {/* RECEIPTS */}
      <section className="section" id="numbers">
        <Reveal className="h-head">
          <span className="eyebrow">
            <span className="live-dot" /> On-chain, right now
          </span>
          <h2 className="h-h2 left">
            Receipts, not
            <br />
            promises.
          </h2>
        </Reveal>
        {stats.isError ? (
          <div className="card empty">Stats are taking a moment to load. Try again shortly.</div>
        ) : (
          <Reveal className="nums">
            {RECEIPTS.map(([k, key, c]) => {
              const e = s?.[key];
              return (
                <div key={k} className="num">
                  <b className={c}>{e !== undefined && ethUsd ? usd(e * ethUsd) : "…"}</b>
                  <em>{e !== undefined ? `${e.toLocaleString("en-US", { maximumFractionDigits: e >= 100 ? 0 : 2 })} ETH` : " "}</em>
                  <span>{k}</span>
                </div>
              );
            })}
            <div className="num">
              <b>{s ? s.trades.toLocaleString("en-US") : "…"}</b>
              <em>{s ? `${s.coins} coins` : " "}</em>
              <span>Trades made</span>
            </div>
          </Reveal>
        )}
        {s?.stakdBurnEth ? (
          <p className="h-note left">
            Burns include {s.stakdBurnEth.toLocaleString("en-US", { maximumFractionDigits: 2 })} ETH of $STAKD bought back
            from volatility fees. Read live from Robinhood Chain
            {ethUsd ? ` · ETH at $${Math.round(ethUsd).toLocaleString("en-US")}` : ""}.
          </p>
        ) : null}
      </section>

      {/* SOLANA */}
      <section className="section" id="solana">
        <Reveal className="h-head center">
          <span className="eyebrow">Live on mainnet</span>
          <h2 className="h-h2">Buy with SOL. Supply burns.</h2>
          <p className="h-lede">
            Coins launched on Stakd can be bought from Solana. Pay in SOL and it arrives on Robinhood Chain in seconds. You
            pay the same fee either way; what changes is where that fee goes.
          </p>
        </Reveal>
        <Reveal delay={120}>
          <SolanaRoutes />
        </Reveal>
        <Reveal delay={200} className="h-note">
          The contract routes the fee by who made the swap, so a cross-chain buy funds burns instead of the portfolio.
          Enforced in code, not by policy.
        </Reveal>
      </section>

      {/* COINS */}
      <section className="section" id="coins">
        <Reveal className="spread-head">
          <div>
            <span className="eyebrow">Coins</span>
            <h2 className="h-h2 left">Launched on Stakd</h2>
          </div>
          <Link href="/coins" className="btn btn-outline">
            See all {coins ? coins.length : ""} coins →
          </Link>
        </Reveal>
        {unconfigured ? (
          <div className="card empty">Coins will appear here once the launchpad contracts are live on Robinhood Chain.</div>
        ) : error ? (
          <div className="alert alert-error">{error.message.split("\n")[0]}</div>
        ) : isLoading || !coins ? (
          <div className="empty">Loading coins…</div>
        ) : coins.length === 0 ? (
          <div className="card empty">
            No coins yet. <Link href="/create">Launch the first one →</Link>
          </div>
        ) : (
          <div className="ct-grid">
            {featured.map((c) => (
              <CoinTile key={c.token} coin={c} markets={markets.data?.byId} volume={s?.perCoin?.[c.token.toLowerCase()]} ethUsd={ethUsd} />
            ))}
          </div>
        )}
      </section>

      {/* FAQ */}
      <section className="section faq-section" id="faq">
        <Reveal className="h-head center">
          <span className="eyebrow">Questions</span>
          <h2 className="h-h2">Good to know.</h2>
        </Reveal>
        <div className="faq">
          {FAQ.map(([q, a], i) => (
            <Reveal key={q} delay={i * 50}>
              <details className="faq-item">
                <summary>{q}</summary>
                <p className="muted">{a}</p>
              </details>
            </Reveal>
          ))}
        </div>
      </section>

      {/* FINAL */}
      <section className="section h-final">
        <div className="glow" aria-hidden />
        <Reveal>
          <h2>
            Your coin.
            <br />
            <span className="gradient-text">Your fund.</span>
          </h2>
        </Reveal>
        <Reveal delay={100}>
          <p className="h-lede">Launch in a minute. From the very first trade, it starts working.</p>
        </Reveal>
        <Reveal delay={180}>
          <Link href="/create" className="btn btn-primary btn-lg shine">
            Launch a coin →
          </Link>
        </Reveal>
      </section>
    </div>
  );
}

const RECEIPTS: [string, "volumeEth" | "feesEth" | "marginEth" | "buybackEth" | "creatorEth", string][] = [
  ["Total trading volume", "volumeEth", ""],
  ["Fees earned", "feesEth", "blue"],
  ["Sent to Lighter as margin", "marginEth", ""],
  ["Bought back & burned", "buybackEth", "fire"],
  ["Paid to creators", "creatorEth", "gold"],
];

const FEES: { tag: string; big: string; title: string; body: string; spec: string; tone: string }[] = [
  {
    tag: "Creator fee",
    big: "1%",
    title: "Creators earn on every trade.",
    body: "Every buy and sell, including buys from Solana, pays the creator 1% in ETH on top of the coin's fee. The fund, platform and burns keep their full share.",
    spec: "1% · in ETH · paid automatically",
    tone: "gold",
  },
  {
    tag: "Defend mode",
    big: "−20%",
    title: "The chart bleeds. The fees burn.",
    body: "When the price falls 20% below its high, the coin's share of every fee goes straight to buyback & burn for six hours. Traders pay nothing extra.",
    spec: "−20% trigger · 6h · 60% → burn",
    tone: "red",
  },
  {
    tag: "Bot tax",
    big: "15s",
    title: "Flip fast, pay the max.",
    body: "Selling within 15 seconds of your own buy pays the full 5% coin fee, so sandwich bots and instant round trips fund the coin. Wait a moment and you pay normal.",
    spec: "15s window · 5% on the flip",
    tone: "blue",
  },
  {
    tag: "Volatility fee",
    big: "+2%",
    title: "Wild candles burn $STAKD.",
    body: "The fee rises with price movement and fades as it calms. The coin's share of that extra is split: half burns the coin, half buys and burns $STAKD.",
    spec: "+0.05% per 1% move · up to +2%",
    tone: "fire",
  },
];
