import type { Metadata } from "next";
import { chain, explorerAddress, FACTORY } from "@/lib/config";

export const metadata: Metadata = {
  title: "Whitepaper",
  description:
    "The Stakd whitepaper: coins on Robinhood Chain backed by their own leveraged portfolio, funded by ETH trading fees, with profits used to buy back and burn supply.",
};

const HOOK = "0xF6fBD259Fd80be4Dc9131eFd7Ed6F2089aA6E0cC";
const ROUTER = "0x15E2Db8885A9Fa6E5d79c4875687898FDf4E88e3";
const PLATFORM = "0x2DD3f57B811aB39832F202Af27367B1B04fE27b2";
const STAKD = "0x2854Cf9f6C3DF1eEdCa72CD141e282AC167d1E6A";
const PINKLOCK = "https://www.pinksale.finance/pinklock/robinhood/record/1001031";

const CONTRACTS: [string, string][] = [
  ["Stakd Factory", FACTORY],
  ["Stakd Hook (Uniswap v4)", HOOK],
  ["Stakd Router", ROUTER],
  ["STAKD token", STAKD],
  ["Platform wallet", PLATFORM],
  ["Uniswap v4 PoolManager", "0x8366a39CC670B4001A1121B8F6A443A643e40951"],
  ["USDG (Lighter margin asset)", "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"],
  ["Lighter deposit contract", "0x94bAB9693Ba2f6358507eFfcbd372b0660AFfF9d"],
];

const NAV: [string, string][] = [
  ["abstract", "Abstract"],
  ["problem", "1. Motivation"],
  ["design", "2. Design overview"],
  ["launch", "3. Launch & liquidity"],
  ["fees", "4. Fee mechanism"],
  ["portfolio", "5. Leverage portfolio"],
  ["burn", "6. Profit, buyback & burn"],
  ["controls", "7. Risk controls"],
  ["stakd", "8. The STAKD token"],
  ["trust", "9. Security & trust model"],
  ["contracts", "10. Contracts"],
  ["roadmap", "11. Roadmap"],
  ["risks", "12. Risks & disclaimer"],
];

const link = { color: "var(--blue-600)", fontWeight: 600 } as const;

export default function Whitepaper() {
  return (
    <div className="docs whitepaper">
      <nav className="docs-nav" aria-label="Whitepaper sections">
        <div className="group">Whitepaper</div>
        {NAV.map(([id, label]) => (
          <a key={id} href={`#${id}`}>
            {label}
          </a>
        ))}
        <a href="/stakd-whitepaper.pdf" download style={{ ...link, marginTop: 12 }}>
          Download PDF ↓
        </a>
      </nav>

      <article className="docs-body">
        <section id="abstract">
          <span className="eyebrow">Stakd whitepaper · v1.0 · September 2026</span>
          <h1>Stakd: coins backed by their own leveraged portfolio</h1>
          <p>
            Stakd is a token launchpad on <b>{chain.name}</b> in which every coin owns a leveraged trading portfolio. Each coin
            trades against native ETH in a Uniswap v4 pool. A Uniswap v4 hook charges a trading fee in ETH on every buy and
            sell. 60% of that fee becomes margin for the coin&apos;s own basket of perpetual futures on Lighter&apos;s Robinhood
            exchange, and 40% goes to the platform. When the basket makes a profit, 75% of the realized profit is used to buy the
            coin back from its pool and burn it.
          </p>
          <p>
            The result is a coin whose trading activity funds a real portfolio, and whose portfolio gains permanently reduce its
            supply. Every coin launches with no ETH, a fixed supply of 1,000,000,000 tokens and liquidity that can never be
            removed.
          </p>
          <div className="docs-callout">
            <b>In one line:</b> trading the coin → ETH fees → leverage portfolio → profits → buy back &amp; burn the coin.
          </div>
        </section>

        <section id="problem">
          <h2>1. Motivation</h2>
          <p>
            Most launchpad tokens have no link between their trading activity and anything of value. Fees go to the platform or
            the creator, liquidity can often be pulled, and holders rely on attention alone.
          </p>
          <p>Stakd is designed around three ideas:</p>
          <ul>
            <li>
              <b>Fees should work for holders.</b> Most of each coin&apos;s fees fund a portfolio that belongs to that coin, not to
              the creator.
            </li>
            <li>
              <b>Gains should reduce supply.</b> Portfolio profit is used to buy and burn the coin, so supply can only go down.
            </li>
            <li>
              <b>Rules should be fixed.</b> A coin&apos;s fee, basket and liquidity are set at launch and enforced by contracts.
            </li>
          </ul>
        </section>

        <section id="design">
          <h2>2. Design overview</h2>
          <p>
            Everything runs on one chain, {chain.name} (chain ID {chain.id}), with no bridges. The system has five parts:
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><b>Factory</b></td>
                  <td>Creates coins, pools and treasuries, stores each coin&apos;s basket, and owns all pool liquidity.</td>
                </tr>
                <tr>
                  <td><b>Hook</b></td>
                  <td>Uniswap v4 hook attached to every Stakd pool. Charges the coin&apos;s fee in ETH on each swap.</td>
                </tr>
                <tr>
                  <td><b>Treasury</b></td>
                  <td>One per coin. Receives fees, splits them, deposits margin and performs buyback-and-burn.</td>
                </tr>
                <tr>
                  <td><b>Router</b></td>
                  <td>Executes buys and sells for the website and buybacks.</td>
                </tr>
                <tr>
                  <td><b>Keeper</b></td>
                  <td>Automated off-chain service that collects fees, manages positions on Lighter and returns profit.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <ol className="docs-steps">
            <li><b>Launch.</b> A creator picks a basket and a fee. The coin goes live in a Uniswap v4 ETH pool.</li>
            <li><b>Trade.</b> Every buy and sell pays the coin&apos;s fee in ETH to the hook.</li>
            <li><b>Fund.</b> 60% of fees are swapped to USDG and deposited into Lighter as the coin&apos;s margin. 40% goes to the platform.</li>
            <li><b>Trade the basket.</b> The keeper holds the basket&apos;s positions at their target weights and leverage.</li>
            <li><b>Burn.</b> Realized profit returns on-chain and is used to buy and burn the coin.</li>
          </ol>
        </section>

        <section id="launch">
          <h2>3. Launch &amp; liquidity</h2>
          <p>A creator launches a coin by calling the factory with a name, a ticker, a basket and a fee. The factory then:</p>
          <ol>
            <li>Mints exactly <b>1,000,000,000</b> tokens. The token has no mint function, so no more can ever be created.</li>
            <li>
              Creates a Uniswap v4 pool pairing the coin with native ETH and attaches the Stakd hook.
            </li>
            <li>
              Adds the <b>entire supply</b> as single-sided liquidity starting from a market cap of roughly $2,500 (about 0.9 ETH).
            </li>
          </ol>
          <p>
            There is no presale, no bonding curve and no migration step. The coin is tradable on Uniswap v4 from the first block,
            and every buyer purchases from the same price curve. The creator needs no ETH, only gas.
          </p>
          <h3>Liquidity is locked forever</h3>
          <p>
            Uniswap v4 does not issue LP tokens. The liquidity position is owned directly by the factory contract, and the factory
            has no function that removes liquidity. Neither the platform, the creator nor anyone else can withdraw it. This is
            equivalent to burned LP, enforced by code.
          </p>
          <h3>The basket</h3>
          <ul>
            <li>1 to 6 markets from Lighter&apos;s Robinhood exchange, such as SPY, QQQ, NVDA, TSLA, BTC and ETH.</li>
            <li>Each market is long or short, with its own weight and leverage from 1x to 10x.</li>
            <li>Weights must add up to 100%, and each market can appear only once.</li>
            <li>The basket is stored on-chain at launch and can never be changed.</li>
          </ul>
        </section>

        <section id="fees">
          <h2>4. Fee mechanism</h2>
          <p>
            The creator chooses a fee between <b>1% and 5%</b> at launch. It cannot be changed afterwards. The hook enforces a
            hard maximum of 5%, and on coins launched with the newest hook the fee also responds to the market within that cap
            (see <a href="#market-fees" style={link}>market-aware fees</a> below). Those coins also pay their creator a
            separate <b>1% creator fee</b> on every trade, so the most any trade can cost is 6%.
          </p>
          <ul>
            <li>The fee is always taken in <b>ETH</b>, never in the coin, so fee collection never creates sell pressure.</li>
            <li>
              Because the fee lives in the pool&apos;s hook, it applies to every trade, including trades routed through aggregators,
              bots and other apps.
            </li>
            <li>Accrued fees can be collected by anyone and are paid only to that coin&apos;s treasury.</li>
          </ul>
          <p>
            <b>Creator fee.</b> On coins launched with the newest hook, every buy and sell also pays <b>1% in ETH to the
            coin&apos;s creator</b>, on top of the coin&apos;s fee. It is kept apart from the split below, so the portfolio,
            the platform and buybacks receive exactly what they did before. Buys from other chains pay it too. Creators claim
            it from the coin&apos;s treasury, and only the creator can receive it.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Share</th>
                  <th>Destination</th>
                  <th>Example: 1 ETH of fees</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><b>60%</b></td>
                  <td>The coin&apos;s leverage portfolio on Lighter</td>
                  <td>0.6 ETH</td>
                </tr>
                <tr>
                  <td><b>40%</b></td>
                  <td>Platform wallet (development, operations, infrastructure)</td>
                  <td>0.4 ETH</td>
                </tr>
                <tr>
                  <td><b>0%</b></td>
                  <td>Creator (new coins also pay a separate 1% creator fee, above)</td>
                  <td>0 ETH</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            The platform can adjust the split for coins launched in the future, but at least 50% of every coin&apos;s fees must go
            to its portfolio. The split of an existing coin is not changed by this.
          </p>
          <h3>Buys that arrive from another chain</h3>
          <p>
            Coins launched with cross-chain support can also be bought from another chain. Those buys go through the Stakd
            cross-chain router, which spends the buyer&apos;s bridged ETH in the same Uniswap v4 pool as everyone else. The
            buyer pays the <strong>same fee</strong> — there is no second charge for arriving from elsewhere.
          </p>
          <p>
            The only difference is where the coin&apos;s share of that fee goes. For a cross-chain buy it is used immediately to
            <strong> buy the coin back and burn it</strong>, instead of funding the portfolio. The creator and platform shares are
            unchanged. The hook tells the two apart by which contract made the swap, so this is enforced by the contracts rather
            than by policy, and the cross-chain router address is set once and fixed forever.
          </p>
          <p>
            This applies only to coins launched with this version of the hook. Coins already live keep exactly the rules they
            launched with, because their hook can never be changed.
          </p>
          <h3 id="market-fees">Market-aware fees</h3>
          <p>
            Coins launched with the newest hook keep the creator&apos;s fee as their <b>base</b>, and the hook adjusts it to the
            market on every swap. All of it is enforced in the hook, applies to every trade, and never takes the coin&apos;s fee
            above 5%.
          </p>
          <ul>
            <li>
              <b>Volatility fee.</b> Recent price movement adds up to 2% on top of the base, about 0.05% for every 1% the price has
              moved. The movement counted halves every 15 minutes, so the fee returns to the base as trading calms down. Pushing the
              price and pulling it back within the same second adds nothing.
            </li>
            <li>
              <b>Quick-flip fee.</b> Selling within 15 seconds of your own buy pays the 5% maximum. It targets sandwich bots and
              instant round trips; anyone who holds for longer pays the normal fee.
            </li>
            <li>
              <b>Defend mode.</b> When the price falls 20% below its high, the coin&apos;s share of fees goes straight to
              buyback &amp; burn for the next 6 hours instead of funding the portfolio. Traders pay nothing extra, and the creator and
              platform shares are unchanged. Another 20% fall from there starts it again.
            </li>
          </ul>
        </section>

        <section id="portfolio">
          <h2>5. Leverage portfolio</h2>
          <p>
            Each coin&apos;s margin is swapped from ETH to USDG in the deepest Uniswap v4 ETH/USDG pool on {chain.name} and deposited
            into Lighter&apos;s contract. Every coin has its own Lighter sub-account, fully separated from every other coin.
          </p>
          <h3>Position sizing</h3>
          <p>
            Each position is sized as <b>equity × weight × leverage</b>. As fees keep arriving, positions grow in the same
            proportions.
          </p>
          <div className="docs-callout">
            <b>Example:</b> $1,000 of equity with a basket of 40% long SPY, 30% long BTC and 30% long ETH at 2x gives positions of
            $800 SPY, $600 BTC and $600 ETH.
          </div>
          <h3>Rebalancing</h3>
          <p>
            When any position drifts more than 10% away from its target size, the keeper trades it back. The keeper follows the
            on-chain basket exactly. It does not choose markets, predict prices or use AI.
          </p>
        </section>

        <section id="burn">
          <h2>6. Profit, buyback &amp; burn</h2>
          <p>
            The keeper tracks each portfolio&apos;s <b>high-water mark</b>: all margin deposited plus any gains already kept. New fee
            deposits raise the mark by the same amount, so incoming fees are never counted as profit.
          </p>
          <p>When a portfolio&apos;s equity rises more than <b>10% above its mark</b>:</p>
          <ol>
            <li><b>50%</b> of the gain above the mark is realized by trimming positions.</li>
            <li><b>75%</b> of the realized amount is withdrawn from Lighter to {chain.name}.</li>
            <li>The treasury swaps it to ETH, buys the coin from its own pool and <b>burns</b> it.</li>
            <li>The remainder stays in the portfolio, and the mark moves up so the same profit is never counted twice.</li>
          </ol>
          <div className="docs-callout">
            <b>Example:</b> a portfolio with a $1,000 mark reaches $1,200. The gain is $200, $100 is realized, and $75 is used to
            buy back and burn the coin.
          </div>
          <p>
            The treasury contract only lets returned profit be used for buyback-and-burn. It cannot be withdrawn to any wallet.
            Very small buybacks are grouped until they reach a minimum size so gas does not eat into them.
          </p>
        </section>

        <section id="controls">
          <h2>7. Risk controls</h2>
          <ul>
            <li>
              <b>Drawdown stop.</b> If a portfolio falls 35% below its mark, the keeper closes all of its positions and pauses its
              trading. The coin keeps trading normally.
            </li>
            <li>
              <b>Fees while paused.</b> Fees are still charged. The portfolio share builds up in the coin&apos;s treasury and cannot
              be spent elsewhere. It is deposited again when trading resumes, with the mark reset to current equity.
            </li>
            <li>
              <b>Margin cap.</b> Each coin can send at most 1 ETH of margin in total by default, adjustable by the platform.
            </li>
            <li>
              <b>Timelock.</b> Any change to where margin is sent requires a public two-day waiting period.
            </li>
            <li>
              <b>Pause.</b> The platform can pause new launches and new margin deposits in an emergency. Pausing cannot touch pool
              liquidity or existing funds.
            </li>
          </ul>
        </section>

        <section id="stakd">
          <h2>8. The STAKD token</h2>
          <p>
            STAKD is the official token of the Stakd platform. It was launched through the Stakd factory on 18 September 2026 and
            follows exactly the same rules as every other Stakd coin.
          </p>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                <tr>
                  <td><b>Contract</b></td>
                  <td>
                    <a href={explorerAddress(STAKD)} target="_blank" rel="noreferrer">
                      <code>{STAKD}</code>
                    </a>
                  </td>
                </tr>
                <tr><td><b>Chain</b></td><td>{chain.name} (chain ID {chain.id})</td></tr>
                <tr><td><b>Supply</b></td><td>1,000,000,000 fixed, 18 decimals, no mint function</td></tr>
                <tr><td><b>Trading fee</b></td><td>2.5% in ETH on every buy and sell</td></tr>
                <tr><td><b>Basket</b></td><td>2x long SPY 34% · 2x short BTC 33% · 2x long ETH 33%</td></tr>
                <tr><td><b>Pool</b></td><td>Uniswap v4 STAKD/ETH, liquidity locked forever</td></tr>
              </tbody>
            </table>
          </div>
          <h3>Distribution</h3>
          <p>
            100% of STAKD was placed in the Uniswap v4 pool at launch. There was no presale, private sale or investor allocation,
            and no tokens were reserved for the team. Any STAKD held by the team was bought from the pool like everyone else.
            Part of the team&apos;s holdings is locked on PinkLock:{" "}
            <a href={PINKLOCK} target="_blank" rel="noreferrer" style={link}>view lock</a>.
          </p>
          <h3>Supply over time</h3>
          <p>
            STAKD&apos;s supply can only decrease. Every buyback-and-burn from its portfolio permanently removes tokens from
            circulation.
          </p>
        </section>

        <section id="trust">
          <h2>9. Security &amp; trust model</h2>
          <h3>Enforced by the contracts</h3>
          <ul>
            <li>Fees can only be paid into the coin&apos;s treasury.</li>
            <li>The platform share can only go to the platform wallet.</li>
            <li>Margin can only be swapped to USDG and deposited into Lighter.</li>
            <li>Returned profit can only buy back and burn the coin.</li>
            <li>Pool liquidity can never be removed.</li>
            <li>A coin&apos;s basket and fee can never be changed after launch.</li>
          </ul>
          <h3>What holders trust Stakd for</h3>
          <p>
            Positions on Lighter are held in an account operated by Stakd and managed by the Stakd keeper. The contracts restrict
            where funds can move on-chain, but the trading itself happens off-chain on Lighter. Holders therefore rely on Stakd to
            run the keeper correctly and to return profits for burns. Every step is visible: margin deposits, positions, profit
            withdrawals and burns can all be checked on the coin&apos;s page and on the block explorer.
          </p>
        </section>

        <section id="contracts">
          <h2>10. Contracts</h2>
          <p>All contracts are deployed on {chain.name} mainnet (chain ID {chain.id}).</p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Contract</th>
                  <th>Address</th>
                </tr>
              </thead>
              <tbody>
                {CONTRACTS.map(([name, address]) => (
                  <tr key={name}>
                    <td><b>{name}</b></td>
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

        <section id="roadmap">
          <h2>11. Roadmap</h2>
          <p>Planned next steps. Timing and scope may change.</p>
          <ul>
            <li>Move ownership of the factory to a multisig wallet.</li>
            <li>External security audit of the contracts.</li>
            <li>Listings and launchpad integrations with data platforms and trading bots.</li>
            <li>A developer SDK for launching and trading Stakd coins.</li>
            <li>More Lighter markets available for baskets.</li>
            <li>Richer coin pages with portfolio performance history and burn history.</li>
          </ul>
        </section>

        <section id="risks">
          <h2>12. Risks &amp; disclaimer</h2>
          <ul>
            <li>Leverage magnifies losses. Positions can be liquidated and a portfolio can go to zero.</li>
            <li>Stock markets on Lighter follow a limited trading schedule, so positions may not rebalance at all times.</li>
            <li>The keeper must stay online, and Lighter is a third-party exchange with its own risks.</li>
            <li>The contracts have not yet been externally audited.</li>
            <li>Buybacks only happen when a portfolio is in profit. There is no guarantee of profit or of any burn.</li>
          </ul>
          <div className="docs-callout warn">
            This document describes how Stakd works. It is not financial advice or an offer of any investment. Coins launched on
            Stakd, including STAKD, are highly speculative and can lose all of their value.
          </div>
        </section>
      </article>
    </div>
  );
}
