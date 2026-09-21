#!/bin/bash
# Abandons the deploy and reclaims the 2.9 SOL sitting in the buffer.
set -e
cd "$(dirname "$0")" || exit 1
solana program close 7T4p7Q3ovS92r6kKfPGDZPR8WEDe8gCRnK4A9Jk11Z6L --recipient $(solana address -k .keys/solana-mainnet.json) -u mainnet-beta -k .keys/solana-mainnet.json --bypass-warning
echo "balance after: $(solana balance -k .keys/solana-mainnet.json -u mainnet-beta)"
