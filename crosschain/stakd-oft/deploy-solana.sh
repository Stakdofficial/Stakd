#!/bin/bash
# Deploys the LayerZero OFT program to Solana mainnet.
# ~2.9 SOL stays as permanent program rent; a similar upload buffer is refunded afterwards.
# The priority fee is pinned, never scaled by network conditions.
set -e
cd "$(dirname "$0")" || exit 1
echo "working dir: $(pwd)"
echo "wallet : $(solana address -k .keys/solana-mainnet.json)"
echo "balance: $(solana balance -k .keys/solana-mainnet.json -u mainnet-beta)"
echo "program: $(solana address -k target/deploy/oft-keypair.json)"
echo "deploying to Solana mainnet, this takes a few minutes..."
solana program deploy --program-id target/deploy/oft-keypair.json target/deploy/oft.so -u mainnet-beta -k .keys/solana-mainnet.json --with-compute-unit-price 20000
echo "balance after: $(solana balance -k .keys/solana-mainnet.json -u mainnet-beta)"
