"""Lighter side: sub-accounts, positions, orders, transfers and withdrawals via the official SDK."""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass

import lighter
from eth_account import Account

from .config import Config
from .strategy import Market, Order

log = logging.getLogger(__name__)

API_KEY_INDEX = 3  # indices 0-2 are left for the Lighter web and mobile apps


@dataclass(frozen=True)
class AccountSnapshot:
    equity: float  # total asset value, USDC
    available: float  # free collateral, USDC
    positions: dict[int, float]  # signed base size per market


class LighterOps:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.api = lighter.ApiClient(configuration=lighter.Configuration(host=cfg.lighter_url))
        self.accounts = lighter.AccountApi(self.api)
        self.orders = lighter.OrderApi(self.api)
        self.info = lighter.InfoApi(self.api)
        self.bridge = lighter.BridgeApi(self.api)
        self.l1_address = Account.from_key(cfg.lighter_eth_private_key).address
        self.master = self._signer(cfg.lighter_master_account_index, cfg.lighter_master_api_key_index, cfg.lighter_master_api_private_key)
        self._signers: dict[int, lighter.SignerClient] = {}
        self._leverage_set: set[tuple[int, int]] = set()

    def _signer(self, account_index: int, key_index: int, private_key: str) -> lighter.SignerClient:
        return lighter.SignerClient(url=self.cfg.lighter_url, account_index=account_index, api_private_keys={key_index: private_key})

    def signer_for(self, account_index: int, key_index: int, private_key: str) -> lighter.SignerClient:
        if account_index not in self._signers:
            self._signers[account_index] = self._signer(account_index, key_index, private_key)
        return self._signers[account_index]

    async def close(self) -> None:
        for s in [self.master, *self._signers.values()]:
            await s.close()
        await self.api.close()

    # ------------------------------------------------------------------ read

    async def markets(self) -> dict[int, Market]:
        resp = await self.orders.order_book_details()
        out = {}
        for d in resp.order_book_details:
            if d.status != "active":
                continue
            out[d.market_id] = Market(
                market_id=d.market_id,
                symbol=d.symbol,
                price=float(d.last_trade_price),
                size_decimals=d.size_decimals,
                price_decimals=d.price_decimals,
                min_base_amount=float(d.min_base_amount),
                min_quote_amount=float(d.min_quote_amount),
                max_leverage=10_000 / d.min_initial_margin_fraction if d.min_initial_margin_fraction else 1,
            )
        return out

    async def snapshot(self, account_index: int) -> AccountSnapshot:
        resp = await self.accounts.account(by="index", value=str(account_index))
        acct = resp.accounts[0]
        positions = {p.market_id: float(p.position) * (1 if p.sign >= 0 else -1) for p in acct.positions if float(p.position) != 0}
        return AccountSnapshot(float(acct.total_asset_value), float(acct.available_balance), positions)

    # ------------------------------------------------------------------ sub-accounts

    async def create_sub_account(self) -> tuple[int, int, str]:
        """Creates a sub-account and registers a fresh API key on it. Returns (index, key index, private key)."""
        before = {a.index for a in (await self.accounts.accounts_by_l1_address(l1_address=self.l1_address)).sub_accounts}
        _, _, err = await self.master.create_sub_account()
        if err:
            raise RuntimeError(f"create_sub_account: {err}")

        new_index = None
        for _ in range(30):
            await asyncio.sleep(2)
            after = {a.index for a in (await self.accounts.accounts_by_l1_address(l1_address=self.l1_address)).sub_accounts}
            fresh = after - before
            if fresh:
                new_index = max(fresh)
                break
        if new_index is None:
            raise RuntimeError("sub-account did not appear")

        private_key, public_key, err = lighter.create_api_key()
        if err:
            raise RuntimeError(f"create_api_key: {err}")
        signer = self._signer(new_index, API_KEY_INDEX, private_key)
        _, err = await signer.change_api_key(eth_private_key=self.cfg.lighter_eth_private_key, new_pubkey=public_key, api_key_index=API_KEY_INDEX)
        if err:
            raise RuntimeError(f"change_api_key: {err}")
        self._signers[new_index] = signer
        log.info("created Lighter sub-account %s", new_index)
        return new_index, API_KEY_INDEX, private_key

    # ------------------------------------------------------------------ money movement

    async def _transfer(self, signer: lighter.SignerClient, to_account: int, amount: float) -> None:
        if self.cfg.dry_run:
            log.info("[dry-run] Lighter transfer %.2f USDC %s -> %s", amount, signer.account_index, to_account)
            return
        auth, err = signer.create_auth_token_with_expiry()
        if err:
            raise RuntimeError(err)
        fee = (await self.info.transfer_fee_info(authorization=auth, account_index=signer.account_index, to_account_index=to_account)).transfer_fee_usdc
        _, _, err = await signer.transfer_same_master_account(
            to_account_index=to_account,
            asset_id=signer.ASSET_ID_USDC,
            route_from=signer.ROUTE_PERP,
            route_to=signer.ROUTE_PERP,
            amount=amount,
            fee=fee,
            memo="0x" + "00" * 32,
        )
        if err:
            raise RuntimeError(f"transfer: {err}")

    async def fund_sub_account(self, sub_account: int, amount: float) -> None:
        await self._transfer(self.master, sub_account, amount)

    async def sweep_to_master(self, sub_signer: lighter.SignerClient, amount: float) -> None:
        await self._transfer(sub_signer, self.cfg.lighter_master_account_index, amount)

    async def withdraw_from_master(self, amount: float) -> None:
        """Send USDG from the master account to the operator's wallet on Robinhood Chain (Lighter's L1 there)."""
        if self.cfg.dry_run:
            log.info("[dry-run] Lighter %s withdraw %.2f USDC", self.cfg.withdraw_mode, amount)
            return
        if self.cfg.withdraw_mode == "fast":
            await self._fast_withdraw(amount)
            return
        _, _, err = await self.master.withdraw(asset_id=self.master.ASSET_ID_USDC, route_type=self.master.ROUTE_PERP, amount=amount)
        if err:
            raise RuntimeError(f"withdraw: {err}")

    async def _fast_withdraw(self, amount: float) -> None:
        # Mirrors examples/transfers/withdraw_fast.py in lighter-python.
        m = self.master
        auth, err = m.create_auth_token_with_expiry()
        if err:
            raise RuntimeError(err)
        info = await self.bridge.fastwithdraw_info(account_index=m.account_index, authorization=auth)
        fee = (await self.info.transfer_fee_info(authorization=auth, account_index=m.account_index, to_account_index=info.to_account_index)).transfer_fee_usdc
        memo = (bytes.fromhex(self.l1_address[2:].lower()) + b"\x00" * 12).hex()
        api_key_index, nonce = m.nonce_manager.next_nonce()
        _, tx_info, _, err = m.sign_transfer(
            eth_private_key=self.cfg.lighter_eth_private_key,
            to_account_index=info.to_account_index,
            asset_id=m.ASSET_ID_USDC,
            route_from=m.ROUTE_PERP,
            route_to=m.ROUTE_PERP,
            usdc_amount=int(amount * 10**6),
            fee=fee,
            memo=memo,
            api_key_index=api_key_index,
            nonce=nonce,
        )
        if err:
            raise RuntimeError(f"sign fast withdraw: {err}")
        resp = await self.bridge.fastwithdraw(tx_info=tx_info, to_address=self.l1_address, authorization=auth)
        if resp.code != 200:
            raise RuntimeError(f"fast withdraw: {json.dumps(resp.to_dict())}")

    # ------------------------------------------------------------------ trading

    async def ensure_leverage(self, signer: lighter.SignerClient, market_id: int, leverage: int) -> None:
        key = (signer.account_index, market_id)
        if key in self._leverage_set:
            return
        if not self.cfg.dry_run:
            _, _, err = await signer.update_leverage(market_id, signer.CROSS_MARGIN_MODE, leverage)
            if err:
                raise RuntimeError(f"update_leverage {market_id}: {err}")
        self._leverage_set.add(key)

    async def place(self, signer: lighter.SignerClient, order: Order, market: Market) -> None:
        side = "SELL" if order.is_ask else "BUY"
        size = order.base_amount / 10**market.size_decimals
        log.info("%s %s %s (~$%.2f)%s", side, size, market.symbol, order.notional_usd, " reduce-only" if order.reduce_only else "")
        if self.cfg.dry_run:
            return
        _, _, err = await signer.create_market_order_limited_slippage(
            market_index=order.market_id,
            client_order_index=int(time.time() * 1000) % 2**48,
            base_amount=order.base_amount,
            max_slippage=self.cfg.max_slippage,
            is_ask=order.is_ask,
            reduce_only=order.reduce_only,
        )
        if err:
            raise RuntimeError(f"order {market.symbol}: {err}")
