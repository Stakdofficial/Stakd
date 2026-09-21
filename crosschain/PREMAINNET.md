# Cross-chain: what must be true before mainnet

Nothing here is optional. The bridge holds real coins, and a mistake in it is not recoverable the way a
front-end bug is.

## 1. Audit

- Scope: `StakdCrossChainRouter`, `StakdOFTAdapter`, and the changes to `LeveredHook`, `LeveredTreasury`,
  `LeveredFactory`, plus the Solana OFT program and its configuration.
- The auditor should be told explicitly: **this fee-routing behaviour is new** (buys through the cross-chain
  router send the coin's fee share to buyback & burn instead of the portfolio), and asked to check that no one
  can get normal buys classified as cross-chain or the reverse.
- Fix findings, then re-review. Do not start step 3 until this is closed.

## 2. Testnet dress rehearsal

Repeat the Phase 0 run (see `PHASE0.md`) with these contracts, not just the example ones:

- [ ] Launch a coin through the factory on Robinhood testnet
- [ ] Deploy the router + adapter (`script/DeployCrossChain.s.sol`)
- [ ] Set rate limits — **nothing can bridge until this is done**, the limits fail closed
- [ ] Buy through the router; check the fee landed in the cross-chain bucket, not the portfolio
- [ ] Collect and burn; check total supply fell by exactly the burn
- [ ] Bridge to Solana; check what left equals what arrived
- [ ] Bridge back; check the lockbox unlocks the same amount
- [ ] Trade on Solana; check the Token-2022 fee is swept and burned
- [ ] Reconcile: RH supply + Solana supply = starting supply − everything burned. To the token.
- [ ] Break it on purpose: underpay the bridge fee, exceed the rate limit, send to a far chain with no adapter
      configured, and kill the bridge mid-flow. Confirm each one fails cleanly with funds recoverable.

## 3. Mainnet, in this order

1. Deploy router + adapter. Do **not** wire them yet.
2. Configure the adapter, in this order. Each one is required — the live chain refuses the next step without it:
   - `adapter.setPeer(dstEid, solanaOftStore)`
   - `adapter.setEnforcedOptions(...)` — the real endpoint rejects **empty** options outright
     (`LZ_ULN_InvalidWorkerOptions`), and the adapter now refuses to send without them
   - `endpoint.setConfig(...)` for the pathway's **DVNs and executor** — without this the endpoint will not even
     quote ("Please set your OApp's DVNs and/or Executor"). Verified against mainnet in `CrossChainFork.t.sol`.
   - `adapter.setRateLimits(...)` (outbound) **and** `adapter.setInboundRateLimit(...)` — both fail closed, so
     until each is set nothing moves in that direction. Start small, e.g. 0.5% of supply per hour.
3. Move the adapter's ownership to a **multisig**, not a single key. See the trust note below.
4. `factory.setCrosschainRouter(router)` — **one-time and irreversible**, so check the address twice.
5. `router.setTrustedSource(bridge, true)` for the real bridge composer only.
6. Launch one small coin with it first. Leave it running for a week before anything larger.

## Who has to be trusted, and with what

Write this down publicly rather than letting people assume it is trustless.

| Role | Can do | Cannot do |
|---|---|---|
| Factory owner | Set the cross-chain router **once**, then never again | Change an existing coin's fee, basket or pool |
| Router owner | Choose which bridges may route buys, and which adapter a coin uses; sweep dust | Take ETH, or take coins from a buy in progress |
| Adapter owner (LayerZero delegate) | Set peers, options, verifier config and rate limits | — but see below |

**The rate limits do not bound the owner.** They bound a bug, a broken verifier or a hostile far-chain peer to
one window's worth of damage. They do not bound whoever holds the owner key, because that same key can raise the
limit and then unlock the lockbox. This is stated plainly in the contract header too.

**The adapter owner is the sharp edge.** In any LayerZero OApp, whoever holds the delegate role can point the
adapter at a peer they control, and a malicious peer can unlock the coins held in the lockbox. That is inherent
to the standard, not something this code adds. It must be a multisig, ideally with a timelock, and it should be
stated plainly in the whitepaper rather than discovered by someone later.

Rate limits bound the damage from every path above: whatever goes wrong, only one window's worth can move.

## What is already proven

- The mechanism works end to end on testnet — see `PHASE0.md` (burn on one chain, mint on the other, one supply,
  trade, fee taken in the coin, swept, burned).
- The fee split is covered by tests in `contracts/test/CrossChain*.t.sol` and `OFTAdapter.t.sol`, including that
  the trader pays the same either way, that the two fee buckets never mix, and that rate limits hold.

## What is not proven

- That there are no bugs. Five real ones were found in this code *after* it first looked finished, including a
  path that would have sent coins to an address nobody controls. That is what the audit is for.
