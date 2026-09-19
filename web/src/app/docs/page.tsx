import type { Metadata } from "next";
import Link from "next/link";
import { chain, explorerAddress, FACTORY } from "@/lib/config";

export const metadata: Metadata = {
  title: "Docs",
  description: "How Stakd coins, fees, leverage portfolios and buyback-and-burns work on Robinhood Chain.",
};

const HOOK = "0xF6fBD259Fd80be4Dc9131eFd7Ed6F2089aA6E0cC";
const ROUTER = "0x15E2Db8885A9Fa6E5d79c4875687898FDf4E88e3";
const PLATFORM = "0x2DD3f57B811aB39832F202Af27367B1B04fE27b2";

const CONTRACTS: [string, string, string][] = [
  ["Stakd Factory", FACTORY, "Launches coins, holds the rules (fee range, split, margin cap)"],
  ["Stakd Hook", HOOK, "Uniswap v4 hook that takes the trading fee in ETH"],
  ["Stakd Router", ROUTER, "Buys and sells coins; used by the website and buybacks"],
  ["Platform wallet", PLATFORM, "Receives 40% of every coin's fees"],
  ["Uniswap v4 PoolManager", "0x8366a39CC670B4001A1121B8F6A443A643e40951", "Where every coin's ETH pool lives"],
  ["USDG", "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", "Dollar token Lighter uses as trading margin"],
  ["Lighter deposit contract", "0x94bAB9693Ba2f6358507eFfcbd372b0660AFfF9d", "Receives each coin's margin"],
];

const NAV: [string, [string, string][]][] = [
  ["Getting started", [["overview", "Overview"], ["how-it-works", "How it works"], ["launch", "Launch a coin"], ["trade", "Buy & sell"]]],
  ["Mechanics", [["fees", "Fees"], ["portfolio", "Leverage portfolio"], ["profit", "Profit, buyback & burn"], ["losses", "Losses & safety stop"]]],
  ["Reference", [["security", "Security & trust"], ["contracts", "Contracts"], ["risks", "Risks"]]],
];

export default function Docs() {
  return (
    <div className="docs">
      <nav className="docs-nav" aria-label="Docs sections">
        {NAV.map(([group, items]) => (
          <div key={group} style={{ display: "contents" }}>
            <div className="group">{group}</div>
            {items.map(([id, label]) => (
              <a key={id} href={`#${id}`}>
                {label}
              </a>
            ))}
          </div>
        ))}
      </nav>

      <article className="docs-body">
        <section id="overview">
          <span className="eyebrow">Stakd docs</span>
          <h1>Coins backed by a leveraged portfolio</h1>
          <p>
            Stakd is a launchpad on <b>{chain.name} mainnet</b>. Anyone can launch a coin and give it a portfolio of up to six
            stock or crypto positions — for example 2x long SPY, BTC and ETH. Every trade of the coin pays a small fee in ETH.
            Most of that fee funds the portfolio on <b>Lighter</b>, and when the portfolio makes money, profits buy the coin
            back and burn it.
          </p>
          <div className="docs-callout">
            <b>In one line:</b> trading the coin → ETH fees → leverage portfolio → profits → buy back & burn the coin.
          </div>
        </section>

        <section id="how-it-works">
          <h2>How it works</h2>
          <ol className="docs-steps">
            <li>
              <b>Launch.</b> A creator picks a basket and a fee. The coin goes live in a Uniswap v4 pool paired with ETH. No ETH is
              needed to launch.
            </li>
            <li>
              <b>Trade.</b> People buy and sell the coin with ETH. Every trade pays the coin&apos;s fee in ETH.
            </li>
            <li>
              <b>Fund.</b> 60% of fees become margin: swapped to USDG on Uniswap and deposited into Lighter. 40% goes to the
              platform.
            </li>
            <li>
              <b>Trade the portfolio.</b> An automated keeper opens and maintains the basket&apos;s positions on Lighter.
            </li>
            <li>
              <b>Burn.</b> When the portfolio is in profit, 75% of realized profit buys the coin and burns it.
            </li>
          </ol>
        </section>

        <section id="launch">
          <h2>Launch a coin</h2>
          <p>
            Go to <Link href="/create" style={{ color: "var(--blue-600)", fontWeight: 600 }}>Create coin</Link>, connect a wallet on{" "}
            {chain.name}, and choose:
          </p>
          <ul>
            <li>
              <b>Name and ticker.</b>
            </li>
            <li>
              <b>Basket:</b> 1–6 Lighter markets (stocks like SPY, NVDA, TSLA or crypto like BTC, ETH), each long or short, with a
              weight (all weights add to 100%) and 1x–10x leverage. The basket is saved on-chain and can never be changed.
            </li>
            <li>
              <b>Trading fee:</b> 1%–5%, charged on every buy and every sell.
            </li>
          </ul>
          <h3>What every coin gets</h3>
          <ul>
            <li>
              <b>Fixed supply:</b> 1,000,000,000 tokens. Nobody can mint more.
            </li>
            <li>
              <b>Locked liquidity:</b> the whole supply goes into the pool from a ~$5K starting market cap. The liquidity is owned
              by the factory contract, which has no way to remove it.
            </li>
            <li>
              <b>No ETH to launch:</b> you only pay gas. Buyers&apos; ETH fills the pool as they trade.
            </li>
          </ul>
        </section>

        <section id="trade">
          <h2>Buy &amp; sell</h2>
          <p>
            Each coin page has a buy/sell panel. Buying spends ETH; selling returns ETH. The page shows the expected amount and
            protects you with a 3% slippage limit. Because coins live in standard Uniswap v4 pools, the fee applies no matter
            which app or router you trade through.
          </p>
        </section>

        <section id="fees">
          <h2>Fees</h2>
          <p>
            The fee is set by the creator between <b>1% and 5%</b> and is always taken <b>in ETH</b>, never in tokens, on both buys
            and sells.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Share</th>
                  <th>Goes to</th>
                  <th>Example: $100 of fees</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <b>60%</b>
                  </td>
                  <td>The coin&apos;s leverage portfolio on Lighter</td>
                  <td>$60</td>
                </tr>
                <tr>
                  <td>
                    <b>40%</b>
                  </td>
                  <td>Platform wallet</td>
                  <td>$40</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section id="portfolio">
          <h2>Leverage portfolio</h2>
          <p>
            Each coin has its own Lighter sub-account, fully separate from every other coin. The keeper sizes each position as
            <b> margin × weight × leverage</b> and rebalances when a position drifts more than 10% from target.
          </p>
          <div className="docs-callout">
            <b>Example:</b> $200 margin, basket 40% SPY / 30% BTC / 30% ETH at 2x → SPY $160, BTC $120, ETH $120.
          </div>
          <p>
            New fees keep flowing in, so positions grow over time in the same proportions. Margin is sent in batches, and each
            coin can send at most 1 ETH of margin in total (the platform can raise this cap).
          </p>
        </section>

        <section id="profit">
          <h2>Profit, buyback &amp; burn</h2>
          <p>
            The keeper tracks the portfolio&apos;s high point (all margin deposited plus past gains). When the portfolio is more than
            10% above it:
          </p>
          <ol>
            <li>Half of the gain is realized by trimming positions.</li>
            <li>
              <b>75%</b> of the realized profit is withdrawn from Lighter, swapped to ETH, used to buy the coin, and the coins are
              burned.
            </li>
            <li>25% stays in the portfolio as extra margin.</li>
          </ol>
          <p>New fee deposits raise the high point too, so fees are never mistaken for profit.</p>
        </section>

        <section id="losses">
          <h2>Losses &amp; safety stop</h2>
          <ul>
            <li>If the portfolio is down, no buybacks happen until it recovers above its high point.</li>
            <li>Positions shrink automatically as margin shrinks, and new fees rebuild them.</li>
            <li>
              <b>Safety stop:</b> if the portfolio falls 35% below its high point, the keeper closes all positions and pauses that
              coin&apos;s trading. The coin itself keeps trading normally.
            </li>
          </ul>
          <div className="docs-callout warn">Leveraged positions can lose money and can be liquidated. A portfolio can go to zero.</div>
        </section>

        <section id="security">
          <h2>Security &amp; trust</h2>
          <h3>Enforced by the contracts</h3>
          <ul>
            <li>Fees can only be paid into that coin&apos;s treasury.</li>
            <li>The platform share can only go to the platform wallet.</li>
            <li>Margin can only be swapped to USDG and deposited into Lighter.</li>
            <li>Returned profit can only buy back and burn the coin — it cannot be withdrawn.</li>
            <li>Pool liquidity can never be removed.</li>
            <li>Changing where margin goes requires a public 2-day waiting period.</li>
          </ul>
          <h3>What you trust Stakd for</h3>
          <p>
            Positions on Lighter are run by the Stakd operator&apos;s keeper and account. Stakd runs the keeper; it follows each
            coin&apos;s on-chain basket and does not choose trades.
          </p>
        </section>

        <section id="contracts">
          <h2>Contracts</h2>
          <p>All on {chain.name} mainnet (chain ID {chain.id}).</p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Contract</th>
                  <th>Address</th>
                </tr>
              </thead>
              <tbody>
                {CONTRACTS.map(([name, address, what]) => (
                  <tr key={name}>
                    <td>
                      <b>{name}</b>
                      <div className="muted small">{what}</div>
                    </td>
                    <td>
                      <a href={explorerAddress(address)} target="_blank" rel="noreferrer">
                        <code>{address}</code>
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="risks">
          <h2>Risks</h2>
          <ul>
            <li>Leverage magnifies losses; positions can be liquidated.</li>
            <li>Stock markets on Lighter trade on a 24/5 schedule; positions may not rebalance on weekends.</li>
            <li>The keeper must stay online; Lighter itself is a third-party exchange.</li>
            <li>The contracts have not yet been externally audited.</li>
            <li>Nothing here is financial advice. Coins can lose all value.</li>
          </ul>
        </section>
      </article>
    </div>
  );
}
