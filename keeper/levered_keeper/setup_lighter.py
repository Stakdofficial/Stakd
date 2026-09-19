"""One-time: register an API key on the operator's Lighter master account (mirrors lighter-python system_setup.py)."""

from __future__ import annotations

import asyncio
import os

import lighter
from dotenv import load_dotenv
from eth_account import Account


async def register_api_key() -> None:
    load_dotenv(os.getenv("LEVERED_ENV_FILE", ".env"))
    url = os.getenv("LIGHTER_URL", "https://mainnet.zklighter.elliot.ai")
    eth_key = os.getenv("LIGHTER_ETH_PRIVATE_KEY") or os.environ["KEEPER_PRIVATE_KEY"]
    key_index = int(os.getenv("LIGHTER_MASTER_API_KEY_INDEX", "3"))
    l1 = Account.from_key(eth_key).address

    api = lighter.ApiClient(configuration=lighter.Configuration(host=url))
    try:
        try:
            accounts = await lighter.AccountApi(api).accounts_by_l1_address(l1_address=l1)
        except lighter.ApiException as e:
            raise SystemExit(f"No Lighter account for {l1}. Deposit once at app.lighter.xyz with this wallet first. ({e.reason})")
        master = min(accounts.sub_accounts, key=lambda a: int(a.index)).index

        private_key, public_key, err = lighter.create_api_key()
        if err:
            raise SystemExit(err)
        signer = lighter.SignerClient(url=url, account_index=master, api_private_keys={key_index: private_key})
        _, err = await signer.change_api_key(eth_private_key=eth_key, new_pubkey=public_key, api_key_index=key_index)
        if err:
            raise SystemExit(f"change_api_key failed: {err}")
        await asyncio.sleep(10)
        err = signer.check_client()
        await signer.close()
        if err:
            raise SystemExit(f"key not active yet: {err}")

        print("Add to keeper/.env (keep it secret):")
        print(f"LIGHTER_MASTER_ACCOUNT_INDEX={master}")
        print(f"LIGHTER_MASTER_API_KEY_INDEX={key_index}")
        print(f"LIGHTER_MASTER_API_PRIVATE_KEY={private_key}")
    finally:
        await api.close()
