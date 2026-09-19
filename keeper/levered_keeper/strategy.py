"""Pure portfolio math. No I/O, so it can be unit tested and reasoned about in isolation."""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class Leg:
    market_id: int
    is_long: bool
    weight_bps: int
    leverage_x10: int

    @property
    def leverage(self) -> float:
        return self.leverage_x10 / 10


@dataclass(frozen=True)
class Market:
    market_id: int
    symbol: str
    price: float
    size_decimals: int
    price_decimals: int
    min_base_amount: float
    min_quote_amount: float
    max_leverage: float


@dataclass(frozen=True)
class Order:
    market_id: int
    is_ask: bool  # True = sell
    base_amount: int  # integer units, scaled by 10**size_decimals
    reduce_only: bool
    notional_usd: float


@dataclass(frozen=True)
class Params:
    rebalance_band: float = 0.10  # ignore drift smaller than 10% of a leg's target notional
    min_order_usd: float = 10.0
    take_profit_trigger: float = 0.10  # act once equity is 10% above the high-water mark
    take_profit_fraction: float = 0.50  # realize half of the gain above the mark
    buyback_share: float = 0.75  # of realized profit, withdrawn for buyback and burn
    min_buyback_usd: float = 10.0


def target_notionals(legs: list[Leg], equity: float) -> dict[int, float]:
    """Signed USD exposure per market: equity x weight x leverage, negative for shorts."""
    out: dict[int, float] = {}
    for leg in legs:
        notional = equity * leg.weight_bps / 10_000 * leg.leverage
        out[leg.market_id] = notional if leg.is_long else -notional
    return out


def market_leverage_setting(leg: Leg, market: Market, headroom: float = 2.0) -> int:
    """Per-market cross leverage to configure on Lighter.

    Each leg only uses `weight` of the account's equity, so the market's own leverage cap
    must sit above the leg's leverage or the order would fail the initial-margin check.
    """
    return max(1, min(math.floor(market.max_leverage), math.ceil(leg.leverage * headroom)))


def rebalance_orders(
    legs: list[Leg],
    markets: dict[int, Market],
    positions: dict[int, float],  # signed base size per market
    equity: float,
    params: Params,
) -> list[Order]:
    orders: list[Order] = []
    targets = target_notionals(legs, equity)
    for market_id, target in targets.items():
        m = markets[market_id]
        current = positions.get(market_id, 0.0) * m.price
        delta = target - current
        threshold = max(params.min_order_usd, params.rebalance_band * abs(target))
        if abs(delta) < threshold:
            continue
        orders.append(_order_for_delta(m, current, delta))

    # Close positions in markets that are no longer part of the basket.
    for market_id, size in positions.items():
        if market_id in targets or size == 0:
            continue
        m = markets.get(market_id)
        if m is None:
            continue
        current = size * m.price
        if abs(current) >= params.min_order_usd:
            orders.append(_order_for_delta(m, current, -current))

    return [o for o in orders if o.base_amount > 0]


# A target just under the exchange minimum is rounded up to it rather than skipped (small baskets would
# otherwise never open a leg). 15% keeps the extra exposure small.
MIN_SIZE_ROUND_UP = 0.15


def _order_for_delta(m: Market, current: float, delta: float) -> Order:
    scale = 10**m.size_decimals
    base = math.floor(abs(delta) / m.price * scale)
    if base / scale < m.min_base_amount or base / scale * m.price < m.min_quote_amount:
        min_base = max(m.min_base_amount, m.min_quote_amount / m.price)
        min_units = math.ceil(min_base * scale - 1e-9)
        reduces = current != 0 and (current > 0) == (delta < 0)
        if not reduces and min_units / scale * m.price <= abs(delta) * (1 + MIN_SIZE_ROUND_UP):
            base = min_units
        else:
            base = 0
    is_ask = delta < 0
    # Pure reductions (no flip through zero) are reduce-only so they can never add exposure.
    reduce_only = current != 0 and (current > 0) == is_ask and abs(delta) <= abs(current)
    return Order(m.market_id, is_ask, base, reduce_only, base / scale * m.price)


@dataclass(frozen=True)
class ProfitDecision:
    realized: float  # profit locked in this round
    withdraw: float  # sent home for buyback and burn
    new_high_water_mark: float


def take_profit(equity: float, high_water_mark: float, params: Params) -> ProfitDecision | None:
    """Decide whether to lock in gains above the high-water mark.

    `high_water_mark` is net of deposits: it rises by every margin deposit and by the
    equity left behind after each profit-take, so fee inflows are never mistaken for profit.
    """
    if high_water_mark <= 0 or equity <= high_water_mark * (1 + params.take_profit_trigger):
        return None
    realized = (equity - high_water_mark) * params.take_profit_fraction
    withdraw = realized * params.buyback_share
    if withdraw < params.min_buyback_usd:
        return None
    return ProfitDecision(realized, withdraw, equity - withdraw)


def drawdown_breached(equity: float, high_water_mark: float, max_drawdown: float) -> bool:
    """True once equity has fallen `max_drawdown` below the high-water mark (e.g. 0.35 = 35%)."""
    return high_water_mark > 0 and max_drawdown > 0 and equity < high_water_mark * (1 - max_drawdown)


def close_all_orders(markets: dict[int, Market], positions: dict[int, float], params: Params) -> list[Order]:
    """Reduce-only orders that flatten every open position."""
    return rebalance_orders([], markets, positions, 0.0, params)
