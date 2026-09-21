#!/bin/bash
# Resumes the interrupted Solana mainnet deploy using the buffer that already holds the rent.
# The 38 failed writes were blockhash expiries on the public RPC, not a problem with the program.
set -e
cd "$(dirname "$0")" || exit 1
BUFFER_KEY=".keys/buffer-recovered.json"

if [ ! -f "$BUFFER_KEY" ]; then
  echo "Recovering the buffer keypair. Paste the 12-word phrase when asked (it is the one printed earlier),"
  echo "then press enter twice at the passphrase prompt."
  solana-keygen recover -o "$BUFFER_KEY" prompt://
fi

echo "buffer : $(solana address -k "$BUFFER_KEY")"
echo "wallet : $(solana balance -k .keys/solana-mainnet.json -u mainnet-beta)"
echo "resuming deploy (more retries, slower pace so blockhashes do not expire)..."
solana program deploy --program-id target/deploy/oft-keypair.json --buffer "$BUFFER_KEY" target/deploy/oft.so -u mainnet-beta -k .keys/solana-mainnet.json --with-compute-unit-price 50000 --max-sign-attempts 60
echo "balance after: $(solana balance -k .keys/solana-mainnet.json -u mainnet-beta)"
