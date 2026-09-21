#!/bin/bash
# Lets Relay's solver call StakdCrossChainRouter, so a buy paid for in SOL lands as a real buy on
# Robinhood Chain with its fee going to buyback & burn.
#
# What trusting this address can and cannot do:
#   CAN : call buyAndDeliver, i.e. make buys whose fee burns supply instead of funding the portfolio
#   CANNOT: take ETH or coins — the router holds nothing between calls and sends coins to the buyer
# Worst case if Relay's solver key were ever compromised: buys get routed through us that burn fees.
# Not a theft path.
set -e
cd "$(dirname "$0")" || exit 1
set -a; . ./.env.robinhood; set +a
ROUTER=0x20f9dd2e73EBe62dAC629d37b6D0B94EC41Fd4ed
SOLVER=0x6085932878d587332419ac976fc13d98eba6fdab   # Relay solver seen paying out on Robinhood Chain
cast send $ROUTER "setTrustedSource(address,bool)" $SOLVER true \
  --rpc-url "$ROBINHOOD_RPC_URL" --private-key "$DEPLOYER_PRIVATE_KEY"
echo "trusted now: $(cast call $ROUTER 'isTrustedSource(address)(bool)' $SOLVER --rpc-url "$ROBINHOOD_RPC_URL")"
