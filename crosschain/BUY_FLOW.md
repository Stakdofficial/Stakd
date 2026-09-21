# Buying a Stakd coin from Solana — how the transaction is built and signed

The rule this whole design follows: **the user's funds move from the user's wallet, signed by the user.**
We never hold their SOL, and they never hand us a key. Everything below serves that.

## The default: the user signs everything

For an ordinary buy, nothing on Solana needs Stakd's authority. The user pays SOL, the bridge carries it, and
`StakdCrossChainRouter` does the buy on Robinhood Chain. So the simplest flow is also the safest:

```
client: "buy 2 SOL of $ALPHA, deliver to my wallet"
  -> API builds the transaction (instructions only, no signature)
  -> client's wallet signs
  -> client sends it to Solana
```

One key involved — theirs. If our API is ever compromised, the worst it can do is propose a transaction their
wallet will show them before they approve it.

## When we co-sign (partial signing)

Our signature earns its place in exactly two cases:

1. **We pay the network fee**, so someone holding only SOL-less assets, or a brand-new wallet, can still trade.
2. **A Stakd program on Solana** has to authorise something in the same transaction.

Then the flow becomes:

```
client: action + params            (never a serialized transaction)
  -> API builds every instruction itself
  -> API signs as FEE PAYER only
  -> partially signed tx returned to the client
  -> client's wallet signs for their funds
  -> client sends it to Solana
```

Both signatures are required, so neither side can execute it alone.

## The part that is actually dangerous

It is not the user's step. **We sign first**, so if the API can be talked into building a harmful transaction,
we have signed it ourselves. The build endpoint is the sensitive surface, and these rules are not optional:

- **Never accept a transaction from the client.** Take an action and parameters (`buy`, `coin`, `amount`,
  `recipient`) and build every instruction server-side. The moment we deserialize a client-supplied transaction
  and sign it, we have given away the key.
- **Validate every parameter against what we know**: the coin must be one the factory launched, the amount must
  be inside a sane range, the recipient must be the wallet that asked.
- **Pin the instruction list.** Exactly the instructions we intend, nothing appended, plus an explicit
  compute-unit price. Never a "scale factor" that multiplies with network conditions — a 570-transaction deploy
  at a bad price is how a routine job turns into a multi-SOL bill.
- **Let it expire.** A blockhash is good for ~60–90 seconds; that is the right TTL. Durable nonces only if a
  longer window is genuinely needed, and then with replay handled deliberately.
- **Rate-limit the endpoint.** Every call spends our key's authority, so treat it like a faucet, not a webhook.
- **Give the signing key nothing worth stealing.** Fee-payer authority only. Never the mint authority, never the
  freeze authority (our coins have none), never the fee-withdraw authority, never a treasury.

## What the user sees

Their wallet simulates the transaction and shows the effects before they approve. That is their protection, and
it only works if the transaction is small and legible: a swap, a transfer, a bridge call. Long opaque
instruction lists teach people to click through warnings, so keep it short even when a shortcut would be easier.

## Related

- The on-chain side of a cross-chain buy: `contracts/src/StakdCrossChainRouter.sol`
- What must be true before any of this touches mainnet: `PREMAINNET.md`
- What is already proven, and where: `PHASE0.md`
