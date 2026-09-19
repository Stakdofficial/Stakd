# Stakd

**Coins backed by their own leveraged portfolio, on Robinhood Chain.**

Stakd is a coin launchpad on Robinhood Chain. Every coin trades against native ETH in a Uniswap v4 pool and funds
its own on-chain trading portfolio. A Uniswap v4 hook takes each coin's trading fee in ETH. Most of that fee becomes
margin for leveraged perpetual positions on [Lighter](https://lighter.xyz), and realized profits are used to buy
back and burn the coin.

- **Free to launch.** Creators need no ETH. The full supply is deposited as single-sided liquidity.
- **Liquidity locked forever.** The factory owns the position and has no way to remove it.
- **Fees in ETH, never in tokens.** The creator sets a fixed fee between 1% and 5%, charged on both buys and sells.
- **A transparent basket.** Each coin stores its strategy on-chain (1–6 markets, long or short, 1–10x), and it
  can't be changed after launch.
- **Deflationary by design.** 75% of realized trading profit buys back the coin and burns it.

---

## How it works

```
                           Robinhood Chain (4663)
 trader ──ETH──► Uniswap v4 ETH/COIN pool ── LeveredHook takes fee in ETH ──► LeveredTreasury
                                                                               │ 40% → platform
                                                                               │ 60% → margin
                                      Uniswap v4 ETH/USDG pool ◄── depositMargin┘
                                                 │ USDG
                                                 ▼
                                Lighter deposit contract → coin's trading sub-account
                                                                               │ perps: SPY, BTC, ETH…
                     buyback & burn ◄── ETH ◄── v4 ◄── USDG ◄── 75% of realized profit
```

1. **Launch.** `createCoin` mints a fixed supply of 1,000,000,000 tokens and adds all of it as single-sided
   liquidity to a Uniswap v4 ETH/COIN pool. The coin's basket and fee rate are stored on-chain.
2. **Trade.** `LeveredHook` takes the fee from the ETH side of every swap, including swaps routed through other
   apps. Anyone can call `collectFees` to send accrued fees to the coin's treasury.
3. **Split.** The treasury sends 40% to the platform and keeps 60% as trading margin.
4. **Margin.** `depositMargin` swaps ETH to USDG through Uniswap v4 and deposits it into Lighter for the coin's
   sub-account.
5. **Trading.** The keeper sizes each position as `equity × weight × leverage` and rebalances when positions drift
   more than 10% from their targets.
6. **Buyback and burn.** When the portfolio reaches 10% above its high-water mark, the keeper realizes profit and
   sends 75% of it back on-chain. There, `buybackAndBurn` buys the coin and burns it.

## Repository layout

| Path | Description |
| --- | --- |
| [`contracts/`](contracts) | Solidity smart contracts (Foundry) |
| [`keeper/`](keeper) | Python service that collects fees, manages margin, trades on Lighter and runs buybacks |
| [`web/`](web) | Next.js app for launching, browsing and trading coins |
| [`abi/`](abi) | Contract ABIs used by the keeper |

### Contracts

| Contract | Role |
| --- | --- |
| `LeveredFactory` | Launches coins, creates and seeds their v4 pools, and holds the locked liquidity |
| `LeveredHook` | Uniswap v4 hook that charges the creator-set trading fee in ETH |
| `LeveredTreasury` | Per-coin treasury that splits fees, deposits margin and runs buyback-and-burn |
| `LeveredRouter` | Simple buy/sell router for ETH ⇄ coin swaps |
| `LeveredToken` | Fixed-supply, burnable ERC-20 |
| `StakdMetadata` | Optional coin profile: logo, description and social links |

## Deployments

**Robinhood Chain mainnet (chain ID 4663)**

| Contract | Address |
| --- | --- |
| LeveredFactory | [`0x019e1242e8d4b76Bc0A1dca1B912daA04323d355`](https://robinhoodchain.blockscout.com/address/0x019e1242e8d4b76Bc0A1dca1B912daA04323d355) |
| LeveredHook | [`0xf6fbd259fd80be4dc9131efd7ed6f2089aa6e0cc`](https://robinhoodchain.blockscout.com/address/0xf6fbd259fd80be4dc9131efd7ed6f2089aa6e0cc) |
| LeveredRouter | [`0x15e2db8885a9fa6e5d79c4875687898fdf4e88e3`](https://robinhoodchain.blockscout.com/address/0x15e2db8885a9fa6e5d79c4875687898fdf4e88e3) |
| StakdMetadata | [`0xa55D5E6E5e80C22Ad09e7743E95D2152C09d800B`](https://robinhoodchain.blockscout.com/address/0xa55D5E6E5e80C22Ad09e7743E95D2152C09d800B) |
| Uniswap v4 PoolManager | [`0x8366a39CC670B4001A1121B8F6A443A643e40951`](https://robinhoodchain.blockscout.com/address/0x8366a39CC670B4001A1121B8F6A443A643e40951) |

## Uniswap v4 hook

`LeveredHook` uses the `beforeSwap`, `afterSwap`, `beforeSwapReturnDelta` and `afterSwapReturnDelta` permissions.

- The fee is charged **only on the ETH side** of a swap and never on the token side.
- If ETH is the specified amount, the fee is taken in `beforeSwap`. If ETH is the unspecified amount, it is taken in
  `afterSwap`.
- The fee rate is fixed for each pool when the pool is registered, capped at 5%, and can't be changed afterwards.
- Accrued fees are held as PoolManager ERC-6909 claims. Anyone can call `collectFees` to pay them out.
- The hook does not use dynamic fees and does not change liquidity or price.

## Safety and guardrails

- Liquidity is permanently locked in each coin's pool.
- Coin baskets and fee rates can't be changed after launch.
- Margin can only go to Lighter through the configured pool. Platform fees can only go to the platform wallet.
  Returned profit can only be used for buyback-and-burn.
- `marginCapPerCoin` caps how much margin each coin can deposit over its lifetime.
- Changing where margin is sent requires a 2-day timelock (`proposeMarginConfig` → `executeMarginConfig`).
- The owner can pause new launches and new margin deposits.
- The keeper stops trading and closes all positions if a coin's portfolio falls 35% from its peak.

**Trust model.** The contracts limit what the keeper can do on-chain. Positions on Lighter are managed by the
operator's account, so holders rely on the operator for off-chain trading.

## Getting started

### Requirements

- [Foundry](https://book.getfoundry.sh/)
- Node.js 20+ and [pnpm](https://pnpm.io/)
- Python 3.11+

### Contracts

```bash
cd contracts
npm install
forge install foundry-rs/forge-std uniswap/v4-core --no-git
forge build
forge test
```

To run the fork tests against live Robinhood Chain contracts:

```bash
ROBINHOOD_FORK_URL=<rpc-url> forge test --match-contract RobinhoodForkTest -vv
```

### Keeper

```bash
cd keeper
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env.robinhood        # then fill in your own values
LEVERED_ENV_FILE=.env.robinhood .venv/bin/python -m levered_keeper once
```

Keep `DRY_RUN=true` until you have checked the configuration.

### Web app

```bash
cd web
pnpm install
cp .env.example .env.local
pnpm dev
```

## Configuration

Each package has an `.env.example` listing every setting it reads. Copy it to a local `.env` file and fill in
your own values. Never commit files that contain private keys or API keys, and never put secrets in `NEXT_PUBLIC_*`
variables, because those are exposed to the browser.

## Disclaimer

This software is experimental. Leveraged trading carries significant risk, including the total loss of margin.
Nothing in this repository is financial advice. The contracts have not been independently audited. Use at your own
risk.
