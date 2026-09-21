# Stakd cross-chain — Phase 0 (testnet proof)

Goal: prove **one coin, one supply, two chains** before writing any production contract.

- **Robinhood Chain** — the coin trades in Uniswap v4, the fee is paid in ETH, 60% funds the leveraged portfolio, profit buys back and burns. (Unchanged, already live on mainnet.)
- **Solana** — the coin trades on an SPL DEX, the fee is paid **in the coin** (Token-2022 transfer fee), swept and burned. No bridging, no selling.
- **LayerZero OFT** keeps a single global supply across both chains: burn on the source chain, mint on the destination.

Nothing here touches mainnet, $STAKD, or real funds.

## Status

| Step | State |
|---|---|
| Solana fee → burn proof (local validator) | ✅ PASS — supply fell by exactly the fees collected |
| LayerZero deployed on Robinhood Chain | ✅ mainnet EID 30416, testnet EID 40451 |
| Token-2022 allowed by LayerZero OFT | ✅ in MABA mode, while the OFT's own fee stays 0 (ours is) |
| Project scaffolded + EVM contracts compiled | ✅ |
| Solana OFT program built (`target/deploy/oft.so`) | ✅ |
| Solana OFT program deployed to devnet | ✅ `EcZMksyExkyHwANu9k2FEK5S4a6XZaVM8dBc9dDVsUJW` |
| Token-2022 mint + OFT Store on devnet | ✅ LayerZero accepts a Token-2022 fee mint (MABA mode) |
| EVM OFT deployed to Robinhood testnet | ✅ `0x9F0045e5f84878DC0eF8114624B605dC465f98cf` |
| Peers wired both directions | ✅ |
| Fee-burn on the LIVE devnet mint | ✅ PASS — 10,000 → 9,953.05, burned exactly the fees |
| Burn on send (Robinhood testnet) | ✅ 1,750 sXTEST burned across 3 sends |
| Mint on arrival (Solana) | ✅ 300 burned on RH testnet → 300 minted on Solana |
| Automatic delivery by LayerZero's executor | ✅ a later 100 arrived with no manual step |
| Trade → fee → burn on the **bridged** tokens | ✅ 300 → 297.45, burned exactly the 2.55 collected |
| Global supply accounting | ✅ exact: 997,850 (RH) + 397.45 (Solana) = 998,247.45 |

## Addresses to fund (testnet only — throwaway keys)

| Chain | Address | Faucet |
|---|---|---|
| Robinhood testnet | `0x338FF1A91F4C31cdd2B33309ad423C8272f147d2` | https://faucet.chainstack.com/robinhood-chain-testnet-faucet |
| Solana devnet (~5 SOL) | `BDupHEBHzvh9FDvY824N9UcqiKvRQ7tudgU9bJo4GRCk` | https://faucet.solana.com (devnet) |

Keys live in `stakd-oft/.env` and `stakd-oft/.keys/` (both gitignored).

## Network facts (from LayerZero's metadata API)

| | Robinhood testnet | Solana devnet |
|---|---|---|
| EID | 40451 | 40168 |
| Chain id | 46630 | — |
| RPC | https://rpc.testnet.chain.robinhood.com | https://api.devnet.solana.com |
| EndpointV2 | `0x3aCAAf60502791D199a5a5F0B173D78229eBFe32` | `76y77prsiCMvXMjuoZ5VRrhG5qYBrUMYTE5WgHqgjEn6` |
| SendUln302 | `0x45841dd1ca50265da7614fc43a361e526c0e6160` | `7a4WjyR8VZ7yZz5XJAKm39BUGn5iT9CKcv2pmG9tdXVH` |
| LayerZero Labs DVN | `0xa78a78a13074ed93ad447a26ec57121f29e8fec2` | `4VDjp6XQaxoZf5RGwiPU9NR1EXSZn2TP4ATMmiSzLfhb` |

Explorer: https://explorer.testnet.chain.robinhood.com

## Runbook

```bash
cd "crosschain/stakd-oft"

# 0. the fee-burn proof (local validator, free, no funds needed)
solana-test-validator -r --ledger /tmp/stakd-ledger --quiet &
npx ts-node tasks/stakd/feeBurn.ts --rpc http://127.0.0.1:8899 --keypair .keys/devnet.json

# 1. deploy the LayerZero OFT program to devnet (~3.9 SOL)
solana program deploy --program-id target/deploy/oft-keypair.json target/deploy/oft.so \
  -u devnet -k .keys/devnet.json

# 2. create the Token-2022 mint that charges the Solana-side trading fee
npx ts-node tasks/stakd/createMint.ts --rpc https://api.devnet.solana.com \
  --keypair .keys/devnet.json --fee-bps 300

# 3. hand the mint to the OFT Store (MABA mode — the only mode that allows Token-2022)
npx hardhat lz:oft:solana:create --eid 40168 --program-id <OFT_PROGRAM_ID> \
  --mint <MINT> --token-program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb \
  --additional-minters <OUR_WALLET> --name "Stakd Cross Test" --symbol sXTEST

# 4. deploy the EVM side on Robinhood testnet
npx hardhat lz:deploy --networks robinhood-testnet

# 5. wire both sides (peers, DVNs, executor, enforced options)
npx hardhat lz:oapp:wire --oapp-config layerzero.config.ts

# 6. send across and watch the supply move
npx hardhat lz:oft:send --src-eid 40451 --dst-eid 40168 --amount 100 --to <SOLANA_ADDR>
npx ts-node tasks/stakd/feeBurn.ts --rpc https://api.devnet.solana.com \
  --keypair .keys/devnet.json --mint <MINT>   # trade + sweep + burn on the real mint
```

## Root cause found: the Solana build toolchain

`lz_receive` failed with `OFTError::Paused` even though the store was not paused. The program
was miscompiled: inside the instruction body it read `token_mint`, `bump` and `paused` as
garbage, while the raw account bytes (logged from the same instruction) were correct, and
Anchor's own `bump = oft_store.bump` seeds constraint — which reads the same field — passed.

**Fix:** build with platform-tools **v1.48** instead of the installed v1.52 (rustc 1.89):

```bash
cd programs/oft
OFT_ID=<PROGRAM_ID> cargo build-sbf --tools-version v1.48 --sbf-out-dir ../../target/deploy
```

With that build everything worked first try, including LayerZero's executor delivering by itself.
`anchor build` uses whatever platform-tools is installed, so pin the version for every build.

Ruled out along the way (all checked, none were the cause): a paused flag, Anchor 0.31 vs 0.32,
LayerZero's SDK-created store, the SPL multisig mint authority, account ordering, and a stale
deployment (the deployed binary hashed identical to the local build).

## Also learned

- **LayerZero's executor does not run the Robinhood-testnet → Solana-devnet route.** The DVN
  *did* verify (Solana showed `inboundNonce: 1`), but nothing executed. LayerZero Scan does not
  index Robinhood testnet at all. Robinhood **mainnet** has 14 DVNs and a deployed executor, so
  this is a testnet gap, not a mainnet one.
- **`clear` is not delivery.** Clearing a verified message consumes the nonce *without* minting,
  which is how the first 1,000 test tokens were lost. Use `lz_receive`, not `clear`.

## What Phase 0 answers

1. Does a Token-2022 fee mint work as a LayerZero OFT? (the "limited support" warning in their docs)
2. Does bridging avoid the transfer fee, so moving chains isn't taxed — only trading is?
3. Does burning on Solana reduce the same global supply the EVM side sees?

**All three are answered yes.** A Token-2022 mint with a 3% transfer fee works as a LayerZero
OFT; bridging is *not* taxed by that fee (300 sent → exactly 300 minted), only trading is; and
burning on Solana reduced the one shared supply.

## Known constraints found so far

- **Token-2022 + OFT only works in MABA mode**, so the mint must be created first and its authority handed over. A plain OFT can't use a custom token program.
- **LayerZero's own OFT fee must stay 0**, or transfer fees need extra testing. Ours is 0.
- **Token-2022 accounts need more rent** than SPL ones, so the enforced `value` for messages into Solana was raised from 2039280 to 3000000 lamports.
- **Deploying the Solana program costs ~3.9 SOL** in rent, on devnet and on mainnet.
- Robinhood testnet has **no official faucet** in the docs; third-party faucets (Chainstack, Chainlink) work.
