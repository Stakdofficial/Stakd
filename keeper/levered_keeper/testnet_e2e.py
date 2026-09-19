"""End-to-end check of the keeper's Lighter trading path on Lighter testnet (no Arc, no bridging).

Uses the same LighterOps and strategy code as the live keeper:
  faucet → API key on master → sub-account + key → fund it → set leverage → open basket → rebalance is a no-op
  → trim for a profit withdrawal → flatten → sweep back to master.

    .venv/bin/python -m levered_keeper.testnet_e2e
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from pathlib import Path
from types import SimpleNamespace

import lighter
import requests
from dotenv import load_dotenv
from eth_account import Account

from .lighter_ops import LighterOps
from .strategy import Leg, Params, close_all_orders, market_leverage_setting, rebalance_orders, target_notionals

URL = "https://testnet.zklighter.elliot.ai"
KEY_FILE = Path("lighter-testnet-keys.json")
MASTER_KEY_INDEX = 3
MARGIN = 150.0  # USDC moved into the test coin's sub-account

# Lighter testnet perps: BTC 4096, ETH 4095, SOL 4097.
LEGS = [Leg(4096, True, 4000, 20), Leg(4095, True, 3000, 20), Leg(4097, False, 3000, 20)]

log = logging.getLogger("e2e")
results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    log.info("%s %s %s", "PASS" if ok else "FAIL", name, detail)


def save_keys(data: dict) -> None:
    fd = os.open(KEY_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(data, f, indent=2)


async def wait_for(predicate, timeout=60, every=3):
    deadline = time.time() + timeout
    while time.time() < deadline:
        value = await predicate()
        if value:
            return value
        await asyncio.sleep(every)
    return None


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    load_dotenv()
    eth_key = os.getenv("LIGHTER_ETH_PRIVATE_KEY") or os.environ["KEEPER_PRIVATE_KEY"]
    l1 = Account.from_key(eth_key).address

    requests.get(f"{URL}/api/v1/faucet", params={"l1_address": l1}, timeout=30)
    api = lighter.ApiClient(configuration=lighter.Configuration(host=URL))
    accounts = lighter.AccountApi(api)
    master_index = min(int(a.index) for a in (await accounts.accounts_by_l1_address(l1_address=l1)).sub_accounts)
    check("faucet account exists", True, f"master account {master_index}")

    keys = json.loads(KEY_FILE.read_text()) if KEY_FILE.exists() else {}
    if keys.get("master_index") != master_index:
        private_key, public_key, err = lighter.create_api_key()
        signer = lighter.SignerClient(url=URL, account_index=master_index, api_private_keys={MASTER_KEY_INDEX: private_key})
        _, err = await signer.change_api_key(eth_private_key=eth_key, new_pubkey=public_key, api_key_index=MASTER_KEY_INDEX)
        check("register master API key", err is None, str(err or ""))
        await asyncio.sleep(10)
        err = signer.check_client()
        check("master API key active", err is None, str(err or ""))
        await signer.close()
        keys = {"master_index": master_index, "master_key": private_key}
        save_keys(keys)

    cfg = SimpleNamespace(
        lighter_url=URL,
        lighter_eth_private_key=eth_key,
        lighter_master_account_index=master_index,
        lighter_master_api_key_index=MASTER_KEY_INDEX,
        lighter_master_api_private_key=keys["master_key"],
        dry_run=False,
        max_slippage=0.02,
        withdraw_mode="secure",
    )
    ops = LighterOps(cfg)
    params = Params(min_order_usd=10)
    try:
        # ---- sub-account for the coin
        if "sub_index" not in keys:
            sub, key_index, sub_key = await ops.create_sub_account()
            keys.update(sub_index=sub, sub_key_index=key_index, sub_key=sub_key)
            save_keys(keys)
        sub = keys["sub_index"]
        signer = ops.signer_for(sub, keys["sub_key_index"], keys["sub_key"])
        check("sub-account with its own API key", signer.check_client() is None, f"sub-account {sub}")

        # ---- margin in
        before = await ops.snapshot(sub)
        if before.equity < MARGIN * 0.5:
            await ops.fund_sub_account(sub, MARGIN)
        funded = await wait_for(lambda: _equity_at_least(ops, sub, MARGIN * 0.5))
        check("master → sub-account transfer", funded is not None, f"equity {funded}")

        markets = await ops.markets()
        check("testnet markets listed", all(l.market_id in markets for l in LEGS), ", ".join(markets[l.market_id].symbol for l in LEGS if l.market_id in markets))

        # ---- open the basket
        snap = await ops.snapshot(sub)
        for leg in LEGS:
            await ops.ensure_leverage(signer, leg.market_id, market_leverage_setting(leg, markets[leg.market_id]))
        orders = rebalance_orders(LEGS, markets, snap.positions, snap.equity, params)
        for o in orders:
            await ops.place(signer, o, markets[o.market_id])
        opened = await wait_for(lambda: _has_positions(ops, sub, len(LEGS)), timeout=60)
        snap = await ops.snapshot(sub)
        targets = target_notionals(LEGS, snap.equity)
        detail = []
        all_close = opened is not None
        for leg in LEGS:
            m = markets[leg.market_id]
            actual = snap.positions.get(leg.market_id, 0.0) * m.price
            target = targets[leg.market_id]
            detail.append(f"{m.symbol} {actual:+.1f}/{target:+.1f}")
            if target == 0 or (actual > 0) != (target > 0) or abs(actual - target) > 0.2 * abs(target):
                all_close = False
        check("basket opened at weight × leverage (±20%)", all_close, "; ".join(detail))

        # ---- no churn when already on target
        again = rebalance_orders(LEGS, markets | {k: v for k, v in (await ops.markets()).items()}, snap.positions, snap.equity, params)
        check("rebalance is a no-op on target", len(again) == 0, f"{len(again)} orders")

        # ---- trim for a pretend profit withdrawal of 30%
        withdraw = snap.equity * 0.3
        trims = rebalance_orders(LEGS, markets, snap.positions, snap.equity - withdraw, params)
        for o in trims:
            await ops.place(signer, o, markets[o.market_id])
        await asyncio.sleep(6)
        trimmed = await ops.snapshot(sub)
        gross_before = sum(abs(s * markets[m].price) for m, s in snap.positions.items())
        gross_after = sum(abs(s * markets[m].price) for m, s in trimmed.positions.items())
        check("take-profit trim reduces exposure (reduce-only)", all(o.reduce_only for o in trims) and gross_after < gross_before * 0.85,
              f"gross {gross_before:.1f} → {gross_after:.1f}")

        # ---- emergency flatten
        for o in close_all_orders(markets, trimmed.positions, Params(min_order_usd=0)):
            await ops.place(signer, o, markets[o.market_id])
        flat = await wait_for(lambda: _is_flat(ops, sub, markets), timeout=60)
        final = await ops.snapshot(sub)
        check("flatten closes every position", flat is not None, f"left {final.positions}")

        # ---- margin back to master (profit path starts with this)
        back = round(final.available * 0.5, 2)
        master_before = (await ops.snapshot(master_index)).available
        await ops.sweep_to_master(signer, back)
        moved = await wait_for(lambda: _available_at_least(ops, master_index, master_before + back * 0.9))
        check("sub-account → master transfer", moved is not None, f"{back:.2f} USDC")
    finally:
        await ops.close()
        await api.close()

    print("\n==== Lighter testnet end-to-end ====")
    for name, ok, detail in results:
        print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")
    print(f"{sum(ok for _, ok, _ in results)}/{len(results)} passed")


async def _equity_at_least(ops, index, amount):
    s = await ops.snapshot(index)
    return round(s.equity, 2) if s.equity >= amount else None


async def _available_at_least(ops, index, amount):
    s = await ops.snapshot(index)
    return s.available if s.available >= amount else None


async def _has_positions(ops, index, n):
    s = await ops.snapshot(index)
    return s.positions if len(s.positions) >= n else None


async def _is_flat(ops, index, markets):
    s = await ops.snapshot(index)
    return True if all(abs(size * markets[m].price) < 1 for m, size in s.positions.items()) else None


if __name__ == "__main__":
    asyncio.run(main())
