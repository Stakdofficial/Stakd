"""Move funds from another chain into ETH on Robinhood Chain with Relay (relay.link).

    LEVERED_ENV_FILE=.env.robinhood .venv/bin/python -m levered_keeper.relay_to_robinhood arc 25
    LEVERED_ENV_FILE=.env.robinhood .venv/bin/python -m levered_keeper.relay_to_robinhood base 0.001

`arc` amounts are USDC; `base`, `arbitrum` and `ethereum` amounts are ETH.
"""

from __future__ import annotations

import os
import sys
import time

import requests
from dotenv import load_dotenv
from eth_account import Account
from web3 import Web3

ROBINHOOD = (4663, "https://rpc.mainnet.chain.robinhood.com")
NATIVE = "0x0000000000000000000000000000000000000000"
ORIGINS = {
    # name: (chain id, rpc, currency, decimals, symbol)
    "arc": (5042, "https://rpc.mainnet.arc.io", "0x3600000000000000000000000000000000000000", 6, "USDC"),
    "base": (8453, "https://mainnet.base.org", NATIVE, 18, "ETH"),
    "arbitrum": (42161, "https://arb1.arbitrum.io/rpc", NATIVE, 18, "ETH"),
    "ethereum": (1, "https://ethereum-rpc.publicnode.com", NATIVE, 18, "ETH"),
}


def send_step(w3: Web3, acct, chain_id: int, d: dict) -> str:
    tx = {
        "from": acct.address,
        "to": Web3.to_checksum_address(d["to"]),
        "value": int(d.get("value") or 0),
        "data": d.get("data") or "0x",
        "nonce": w3.eth.get_transaction_count(acct.address, "pending"),
        "chainId": chain_id,
    }
    tx["gas"] = int(w3.eth.estimate_gas(tx) * 1.25)
    base_fee = w3.eth.get_block("latest").get("baseFeePerGas")
    if base_fee is not None:
        tip = int(d.get("maxPriorityFeePerGas") or 1_000_000)
        tx["maxPriorityFeePerGas"] = tip
        tx["maxFeePerGas"] = base_fee * 2 + tip
    else:
        tx["gasPrice"] = w3.eth.gas_price
    h = w3.eth.send_raw_transaction(acct.sign_transaction(tx).raw_transaction)
    r = w3.eth.wait_for_transaction_receipt(h, timeout=300)
    if r.status != 1:
        raise SystemExit(f"transaction failed: {h.to_0x_hex()}")
    return h.to_0x_hex()


def main() -> None:
    load_dotenv(os.getenv("LEVERED_ENV_FILE", ".env.robinhood"))
    if len(sys.argv) < 3 or sys.argv[1] not in ORIGINS:
        raise SystemExit("usage: relay_to_robinhood <arc|base|arbitrum|ethereum> <amount>")
    origin, amount = sys.argv[1], float(sys.argv[2])
    chain_id, rpc, currency, decimals, symbol = ORIGINS[origin]
    acct = Account.from_key(os.environ["KEEPER_PRIVATE_KEY"])
    src, rh = Web3(Web3.HTTPProvider(rpc)), Web3(Web3.HTTPProvider(ROBINHOOD[1]))
    units = int(amount * 10**decimals)

    rh_before = rh.eth.get_balance(acct.address)
    print(f"wallet {acct.address}\n  Robinhood ETH now {rh_before / 1e18:.6f}")

    quote = requests.post(
        "https://api.relay.link/quote",
        json={
            "user": acct.address,
            "recipient": acct.address,
            "originChainId": chain_id,
            "destinationChainId": ROBINHOOD[0],
            "originCurrency": currency,
            "destinationCurrency": NATIVE,
            "amount": str(units),
            "tradeType": "EXACT_INPUT",
        },
        timeout=30,
    ).json()
    if "details" not in quote:
        raise SystemExit(f"Relay quote failed: {quote}")
    out = quote["details"]["currencyOut"]
    print(f"Relay quote: {amount} {symbol} on {origin} → {float(out['amountFormatted']):.6f} ETH on Robinhood Chain (~${float(out['amountUsd']):.2f})")

    for step in quote["steps"]:
        for item in step["items"]:
            d = item["data"]
            if int(d["chainId"]) != chain_id:
                raise SystemExit(f"unexpected step on chain {d['chainId']}")
            print(f"  {step['id']}: {send_step(src, acct, chain_id, d)}")

    print("waiting for ETH on Robinhood Chain…")
    for _ in range(90):
        now = rh.eth.get_balance(acct.address)
        if now > rh_before:
            print(f"  ✅ Robinhood ETH {now / 1e18:.6f}")
            return
        time.sleep(5)
    print("  not arrived yet — check relay.link with the transaction hash above")


if __name__ == "__main__":
    main()
