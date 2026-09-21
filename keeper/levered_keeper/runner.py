"""Keeper loop for Levered on Robinhood Chain. Everything happens on one chain; there are no bridges.

Per coin, every tick:

  fees      hook.collectFees                ETH trading fees → treasury (60% margin / 30% platform / 10% creator)
            hook.collectCrossChainFees      fees from bridged buys → treasury, where the 60% is burn fuel, not margin
            hook.collectDefendFees          fees charged in defend mode (price fell 20% from its high) → burn fuel too
            treasury.claim*Fees             pay platform and creator shares once they add up
  burn      treasury.buybackAndBurn         spend whatever burn fuel is waiting; a bridged buy has no withdrawal
                                            behind it, so this is what turns its fee into a burn
  margin    treasury.depositMargin          ETH → USDG on Uniswap v4 → Lighter deposit (credits the operator account)
            deposit: minted → crediting (moved into the coin's sub-account) → credited (equity visible)
  trade     rebalance the sub-account toward equity × weight × leverage per leg
  profit    equity above high-water mark → trim positions, withdraw 75% of realized profit as USDG
            withdrawal: pending → withdrawn (Lighter → keeper wallet on Robinhood Chain)
                        → minted (USDG sent to the treasury) → done (treasury.buybackAndBurn: USDG → ETH → coin, burned)
"""

from __future__ import annotations

import asyncio
import logging
import time

from web3 import Web3
from web3.logs import DISCARD

from . import config as config_mod
from .alerts import Alerter
from .chain import Robinhood, from_usdg, to_eth, to_usdg
from .lighter_ops import LighterOps
from .state import CoinState, State, Transfer
from .strategy import Leg, close_all_orders, drawdown_breached, market_leverage_setting, rebalance_orders, take_profit

log = logging.getLogger("levered.keeper")

RESET_MARK = -1.0  # high-water mark sentinel: adopt current equity on the next tick (set by `resume`)


class Keeper:
    def __init__(self, cfg: config_mod.Config):
        self.cfg = cfg
        self.chain = Robinhood(cfg)
        self.lighter = LighterOps(cfg)
        self.state = State.load(cfg.state_path)
        self.alerts = Alerter(cfg.alert_webhook_url)
        self._no_crosschain_bucket = False  # set once the hook proves it is the pre-cross-chain one
        self._no_defend_bucket = False  # set once the hook proves it predates defend mode

    def save(self) -> None:
        if not self.cfg.dry_run:
            self.state.save(self.cfg.state_path)

    # ------------------------------------------------------------------ loop

    async def run(self, once: bool = False) -> None:
        while True:
            try:
                await self.tick()
            except Exception as e:
                log.exception("tick failed")
                self.alerts.send("tick", f"tick failed: {e!r}"[:500])
            if once:
                return
            await asyncio.sleep(self.cfg.tick_seconds)

    async def tick(self) -> None:
        self.check_gas()
        markets = await self.lighter.markets()
        for coin in self.chain.coins():
            key = coin["token"].lower()
            cs = self.state.coins.setdefault(key, CoinState(token=coin["token"], treasury=coin["treasury"]))
            try:
                await self.process_coin(cs, markets, coin["pool_id"])
            except Exception as e:
                log.exception("coin %s failed", coin["token"])
                self.alerts.send(f"coin:{key}", f"coin {coin['token']} failed: {e!r}"[:500])
            finally:
                self.save()

    async def process_coin(self, cs: CoinState, markets, pool_id: bytes) -> None:
        treasury = self.chain.treasury(cs.treasury)
        await self.ensure_sub_account(cs, treasury)
        self.collect_fees(pool_id)
        self.collect_crosschain_fees(pool_id)
        self.collect_defend_fees(pool_id)
        self.claim_fee_shares(treasury)
        self.burn_pending(cs, treasury)
        # Margin stays in the treasury until the coin has a Lighter sub-account to hand it to.
        if not cs.halted and cs.sub_account_index is not None:
            self.deposit_margin(cs, treasury)
        await self.advance_deposits(cs)
        if not cs.halted:
            await self.trade(cs, treasury, markets)
        await self.advance_withdrawals(cs, treasury)

    def check_gas(self) -> None:
        eth = to_eth(self.chain.w3.eth.get_balance(self.chain.account.address))
        if eth < self.cfg.min_gas_eth:
            self.alerts.send("gas", f"keeper gas low on Robinhood Chain: {eth:.5f} ETH at {self.chain.account.address}")

    # ------------------------------------------------------------------ setup

    async def ensure_sub_account(self, cs: CoinState, treasury) -> None:
        if cs.sub_account_index is None:
            # Lighter caps sub-accounts per master account and a treasury's account can never change,
            # so a coin only gets one once it has earned enough fees for its first margin deposit.
            amount, _ = self.margin_available(treasury)
            if to_eth(amount) < self.cfg.min_margin_eth:
                return
            if self.cfg.dry_run:
                log.info("[dry-run] would set up a Lighter sub-account for %s", cs.token)
                return
            spare = await self.lighter.spare_sub_account(self.sub_accounts_in_use())
            try:
                if spare is not None:
                    cs.sub_account_index, cs.api_key_index, cs.api_private_key = await self.lighter.adopt_sub_account(spare)
                else:
                    cs.sub_account_index, cs.api_key_index, cs.api_private_key = await self.lighter.create_sub_account()
            except RuntimeError as e:
                if "too many sub accounts" not in str(e):
                    raise
                self.alerts.send("lighter:slots", f"no Lighter sub-account left for {cs.token}; its margin waits in the treasury")
                return
            self.save()
        if not treasury.functions.lighterAccountSet().call():
            self.chain.send(treasury.functions.setLighterAccount(cs.sub_account_index), f"setLighterAccount {cs.sub_account_index}")

    def sub_accounts_in_use(self) -> set[int]:
        """Sub-accounts claimed by any coin, in keeper state or bound on-chain."""
        used = {cs.sub_account_index for cs in self.state.coins.values() if cs.sub_account_index is not None}
        for coin in self.chain.coins():
            treasury = self.chain.treasury(coin["treasury"])
            if treasury.functions.lighterAccountSet().call():
                used.add(treasury.functions.lighterAccountIndex().call())
        return used

    def signer(self, cs: CoinState):
        return self.lighter.signer_for(cs.sub_account_index, cs.api_key_index, cs.api_private_key)

    # ------------------------------------------------------------------ fees and margin

    def collect_fees(self, pool_id: bytes) -> None:
        """Pay the hook's accrued ETH trading fees into the treasury (anyone may call; the keeper does it routinely)."""
        pending = self.chain.hook.functions.pendingFees(pool_id).call()
        if to_eth(pending) >= self.cfg.min_fee_eth:
            self.chain.send(self.chain.hook.functions.collectFees(pool_id), f"collectFees {to_eth(pending):.5f} ETH")

    def collect_crosschain_fees(self, pool_id: bytes) -> None:
        """Sweep fees from buys that arrived over a bridge. The hook keeps them in a separate bucket because they
        fund buyback-and-burn instead of the portfolio, so they need their own sweep: collectFees never sees them."""
        if self._no_crosschain_bucket:
            return
        try:
            pending = self.chain.hook.functions.pendingCrossChainFees(pool_id).call()
        except Exception:
            # The hook of the original factory predates the cross-chain bucket. The ABI is shared between both
            # keepers, so only the call itself can tell them apart; stop asking once it has answered.
            self._no_crosschain_bucket = True
            log.info("hook has no cross-chain fee bucket; skipping cross-chain sweeps")
            return
        if to_eth(pending) >= self.cfg.min_burn_eth:
            self.chain.send(
                self.chain.hook.functions.collectCrossChainFees(pool_id),
                f"collectCrossChainFees {to_eth(pending):.6f} ETH → burn",
            )

    def collect_defend_fees(self, pool_id: bytes) -> None:
        """Sweep fees charged while the coin was in defend mode. Like cross-chain fees they are burn fuel, kept in
        their own bucket by the hook, so they need their own sweep."""
        if self._no_defend_bucket:
            return
        try:
            pending = self.chain.hook.functions.pendingDefendFees(pool_id).call()
        except Exception:
            # Hooks deployed before defend mode have no such bucket; the ABI is shared, so only the call can tell.
            self._no_defend_bucket = True
            log.info("hook has no defend-mode fee bucket; skipping defend sweeps")
            return
        if to_eth(pending) >= self.cfg.min_burn_eth:
            self.chain.send(
                self.chain.hook.functions.collectDefendFees(pool_id),
                f"collectDefendFees {to_eth(pending):.6f} ETH → burn",
            )

    def burn_pending(self, cs: CoinState, treasury) -> None:
        """Burn whatever burn fuel is waiting. Profit withdrawals run their own burn when they land, but a
        cross-chain fee has no withdrawal behind it, so this step is what makes those burns happen at all."""
        amount = treasury.functions.pendingBuyback().call()
        if to_eth(amount) < self.cfg.min_burn_eth:
            return
        min_tokens = int(self.chain.quote_buy(cs.token, amount) * (1 - 2 * self.cfg.swap_slippage))
        # Nothing is being converted from USDG on this path, so there is no ETH-out floor to set for that leg.
        self.chain.send(treasury.functions.buybackAndBurn(0, min_tokens), f"buybackAndBurn ~{to_eth(amount):.6f} ETH")

    def claim_fee_shares(self, treasury) -> None:
        if to_eth(treasury.functions.protocolOwed().call()) >= self.cfg.min_claim_eth:
            self.chain.send(treasury.functions.claimProtocolFees(), "claimProtocolFees")
        if to_eth(treasury.functions.creatorOwed().call()) >= self.cfg.min_claim_eth:
            self.chain.send(treasury.functions.claimCreatorFees(), "claimCreatorFees")

    def margin_available(self, treasury) -> tuple[int, int]:
        """(ETH depositable now under the lifetime cap, ETH in the margin reserve); nothing while launches are paused."""
        if self.chain.factory.functions.paused().call():
            return 0, 0
        reserve = treasury.functions.marginReserve().call()
        room = self.chain.factory.functions.marginCapPerCoin().call() - treasury.functions.totalMarginDeposited().call()
        return min(reserve, max(room, 0)), reserve

    def deposit_margin(self, cs: CoinState, treasury) -> None:
        amount, reserve = self.margin_available(treasury)
        if to_eth(amount) < self.cfg.min_margin_eth:
            if reserve > amount and to_eth(reserve) >= self.cfg.min_margin_eth:
                self.alerts.send(f"cap:{cs.token}", f"coin {cs.token} hit its margin cap; {to_eth(reserve):.4f} ETH waiting")
            return
        quote = self.chain.quote_eth_to_usdg(amount)
        min_out = int(quote * (1 - self.cfg.swap_slippage))
        tx, receipt = self.chain.send(
            treasury.functions.depositMargin(amount, min_out), f"depositMargin {to_eth(amount):.5f} ETH (~{to_usdg(quote):.2f} USDG)"
        )
        usdg = to_usdg(quote)
        if receipt is not None:
            events = treasury.events.MarginDeposited().process_receipt(receipt, errors=DISCARD)
            if events:
                usdg = to_usdg(events[0]["args"]["usdg"])
        cs.deposits.append(Transfer(amount=usdg, status="minted", source_tx=tx, created_at=time.time()))

    async def advance_deposits(self, cs: CoinState) -> None:
        # Lighter credits the operator's master account; hand deposits to the coin's sub-account oldest first.
        for d in cs.deposits:
            if d.status != "minted":
                continue
            master = await self.lighter.snapshot(self.cfg.lighter_master_account_index)
            if master.available < d.amount * 0.99:
                return
            credited = min(d.amount, master.available)
            before = await self.lighter.snapshot(cs.sub_account_index)
            await self.lighter.fund_sub_account(cs.sub_account_index, credited)
            # The high-water mark only rises once Lighter shows the new equity (see `settle_credits`); raising it
            # now would read as a loss while the transfer is still settling and trip the drawdown stop.
            d.amount, d.status, d.expect_equity = credited, "crediting", before.equity + credited
            log.info("sent %.2f USDG margin to sub-account %s", credited, cs.sub_account_index)

    # ------------------------------------------------------------------ Lighter: trading

    async def trade(self, cs: CoinState, treasury, markets) -> None:
        if cs.sub_account_index is None:
            return
        legs = [Leg(m, long_, w, lev) for (m, long_, w, lev) in treasury.functions.legs().call()]
        missing = [leg.market_id for leg in legs if leg.market_id not in markets]
        if missing:
            log.warning("coin %s: markets %s not active on Lighter, skipping trade", cs.token, missing)
            return

        snap = await self.lighter.snapshot(cs.sub_account_index)
        if not self.settle_credits(cs, snap.equity):
            log.info("coin %s: margin transfer still settling on Lighter; skipping risk checks this tick", cs.token)
            return
        if cs.high_water_mark == RESET_MARK:
            cs.high_water_mark = snap.equity
            log.info("coin %s: high-water mark reset to current equity %.2f", cs.token, snap.equity)
        if drawdown_breached(snap.equity, cs.high_water_mark, self.cfg.max_drawdown):
            reason = f"drawdown stop: equity {snap.equity:.2f} is more than {self.cfg.max_drawdown:.0%} below mark {cs.high_water_mark:.2f}"
            await self.flatten_coin(cs, markets, reason)
            return
        if snap.equity < self.cfg.params.min_order_usd:
            return

        pending = sum(w.amount for w in cs.withdrawals if w.status == "pending")
        if pending == 0:
            decision = take_profit(snap.equity, cs.high_water_mark, self.cfg.params)
            if decision:
                log.info(
                    "coin %s: equity %.2f > mark %.2f, realizing %.2f, withdrawing %.2f for buyback",
                    cs.token, snap.equity, cs.high_water_mark, decision.realized, decision.withdraw,
                )
                cs.withdrawals.append(Transfer(amount=decision.withdraw, status="pending", created_at=time.time()))
                cs.high_water_mark = decision.new_high_water_mark
                pending = decision.withdraw

        signer = self.signer(cs)
        for leg in legs:
            await self.lighter.ensure_leverage(signer, leg.market_id, market_leverage_setting(leg, markets[leg.market_id], self.cfg.leverage_headroom))

        # Size to equity minus any profit about to leave, so trimming frees the collateral to withdraw.
        orders = rebalance_orders(legs, markets, snap.positions, snap.equity - pending, self.cfg.params)
        for order in orders:
            try:
                await self.lighter.place(signer, order, markets[order.market_id])
            except RuntimeError as e:  # e.g. equity markets outside trading hours
                log.warning("coin %s: %s", cs.token, e)

    def settle_credits(self, cs: CoinState, equity: float) -> bool:
        """Fold landed margin transfers into the high-water mark. False while any transfer is still in flight."""
        settled = True
        for d in cs.deposits:
            if d.status != "crediting":
                continue
            if equity >= d.expect_equity * 0.98:
                if cs.high_water_mark != RESET_MARK:
                    cs.high_water_mark += d.amount
                d.status = "credited"
                log.info("coin %s: %.2f USDG margin landed, mark now %.2f", cs.token, d.amount, cs.high_water_mark)
            else:
                settled = False
        return settled

    async def flatten_coin(self, cs: CoinState, markets, reason: str) -> None:
        """Close every position in the coin's sub-account and stop trading it until `resume`."""
        cs.halted, cs.halt_reason = True, reason
        self.save()
        self.alerts.send(f"halt:{cs.token}", f"coin {cs.token} halted, closing positions — {reason}")
        if cs.sub_account_index is None:
            return
        snap = await self.lighter.snapshot(cs.sub_account_index)
        signer = self.signer(cs)
        for order in close_all_orders(markets, snap.positions, self.cfg.params):
            try:
                await self.lighter.place(signer, order, markets[order.market_id])
            except RuntimeError as e:
                self.alerts.send(f"flatten:{cs.token}:{order.market_id}", f"coin {cs.token}: could not close market {order.market_id}: {e}")

    # ------------------------------------------------------------------ profits home

    async def advance_withdrawals(self, cs: CoinState, treasury) -> None:
        for w in cs.withdrawals:
            if w.status == "pending":
                snap = await self.lighter.snapshot(cs.sub_account_index)
                if snap.available < w.amount:
                    continue
                await self.lighter.sweep_to_master(self.signer(cs), w.amount)
                await self.lighter.withdraw_from_master(w.amount)
                w.status = "withdrawn"

            elif w.status == "withdrawn":
                # Withdrawals from every coin land in the Lighter account owner's wallet; only forward what has arrived.
                # Compare in USDG units: Lighter pays out whole 6-dp units, and the float amount can carry dust.
                payout = self.chain.payout_account
                if self.chain.usdg_balance(payout.address) < from_usdg(w.amount):
                    continue
                w.source_tx, _ = self.chain.send(
                    self.chain.usdg.functions.transfer(Web3.to_checksum_address(cs.treasury), from_usdg(w.amount)),
                    f"profit {w.amount:.2f} USDG → treasury",
                    account=payout,
                )
                w.status = "minted"

            if w.status == "minted":
                usdg = self.chain.usdg_balance(cs.treasury)
                eth_from_usdg = self.chain.quote_usdg_to_eth(usdg)
                spend = treasury.functions.pendingBuyback().call() + eth_from_usdg
                if spend == 0:
                    continue
                min_eth = int(eth_from_usdg * (1 - self.cfg.swap_slippage))
                min_tokens = int(self.chain.quote_buy(cs.token, spend) * (1 - 2 * self.cfg.swap_slippage))
                self.chain.send(treasury.functions.buybackAndBurn(min_eth, min_tokens), f"buybackAndBurn ~{to_eth(spend):.5f} ETH")
                w.status = "done"
            self.save()


# ---------------------------------------------------------------------- CLI helpers


async def status(cfg: config_mod.Config) -> None:
    keeper = Keeper(cfg)
    try:
        for coin in keeper.chain.coins():
            t = keeper.chain.treasury(coin["treasury"])
            sym = keeper.chain.token(coin["token"]).functions.symbol().call()
            cs = keeper.state.coins.get(coin["token"].lower())
            print(f"\n{sym}  token {coin['token']}")
            print(f"  fees received    {to_eth(t.functions.totalFeesReceived().call()):.5f} ETH")
            print(f"  margin reserve   {to_eth(t.functions.marginReserve().call()):.5f} ETH")
            print(f"  margin deposited {to_eth(t.functions.totalMarginDeposited().call()):.5f} ETH ({to_usdg(t.functions.totalUsdgDeposited().call()):.2f} USDG)")
            print(f"  bought back      {to_eth(t.functions.totalBuybackEth().call()):.5f} ETH")
            if cs and cs.sub_account_index is not None:
                snap = await keeper.lighter.snapshot(cs.sub_account_index)
                print(f"  lighter account  {cs.sub_account_index}  equity {snap.equity:.2f}  mark {cs.high_water_mark:.2f}  halted {cs.halted}")
                print(f"  positions        {snap.positions}")
    finally:
        await keeper.lighter.close()


async def flatten(cfg: config_mod.Config, token: str | None) -> None:
    """Emergency stop: close positions and halt one coin, or every coin."""
    keeper = Keeper(cfg)
    try:
        markets = await keeper.lighter.markets()
        for key, cs in keeper.state.coins.items():
            if token and key != token.lower():
                continue
            await keeper.flatten_coin(cs, markets, "manual flatten")
            print(f"halted {cs.token}")
        keeper.save()
    finally:
        await keeper.lighter.close()


def resume(cfg: config_mod.Config, token: str) -> None:
    """Restart a halted coin. Its high-water mark resets to current equity, so recovery profits count."""
    state = State.load(cfg.state_path)
    cs = state.coins.get(token.lower())
    if cs is None:
        raise SystemExit(f"unknown coin {token}")
    cs.halted, cs.halt_reason = False, ""
    cs.high_water_mark = RESET_MARK
    state.save(cfg.state_path)
    print(f"resumed {cs.token}; its high-water mark resets to current equity on the next tick")
