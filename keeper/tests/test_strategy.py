from levered_keeper.strategy import (
    Leg,
    close_all_orders,
    drawdown_breached,
    Market,
    Params,
    market_leverage_setting,
    rebalance_orders,
    take_profit,
    target_notionals,
)

LVRD = [
    Leg(market_id=128, is_long=True, weight_bps=4000, leverage_x10=20),  # SPY
    Leg(market_id=1, is_long=True, weight_bps=3000, leverage_x10=20),  # BTC
    Leg(market_id=0, is_long=True, weight_bps=3000, leverage_x10=20),  # ETH
]

MARKETS = {
    128: Market(128, "SPY", 600.0, 3, 2, 0.001, 10, 20),
    1: Market(1, "BTC", 100_000.0, 5, 1, 0.0002, 10, 50),
    0: Market(0, "ETH", 4_000.0, 4, 2, 0.005, 10, 50),
    110: Market(110, "NVDA", 180.0, 2, 2, 0.1, 10, 10),
}


def test_target_notionals_for_lvrd():
    t = target_notionals(LVRD, 185.99)
    assert round(t[128], 2) == round(185.99 * 0.4 * 2, 2)
    assert round(sum(t.values()), 2) == round(185.99 * 2, 2)


def test_shorts_are_negative():
    t = target_notionals([Leg(128, False, 10_000, 30)], 100)
    assert t[128] == -300


def test_opens_all_legs_from_flat():
    orders = rebalance_orders(LVRD, MARKETS, {}, 1_000, Params())
    by_market = {o.market_id: o for o in orders}
    assert set(by_market) == {128, 1, 0}
    assert all(not o.is_ask and not o.reduce_only for o in orders)
    assert abs(by_market[128].notional_usd - 800) < 1
    assert by_market[1].base_amount == 600  # 0.006 BTC at 5 size decimals


def test_small_drift_is_ignored():
    positions = {128: 800 / 600, 1: 600 / 100_000, 0: 600 / 4_000}
    assert rebalance_orders(LVRD, MARKETS, positions, 1_030, Params()) == []


def test_trim_is_reduce_only():
    positions = {128: 800 / 600, 1: 600 / 100_000, 0: 600 / 4_000}
    orders = rebalance_orders(LVRD, MARKETS, positions, 500, Params())
    assert len(orders) == 3
    assert all(o.is_ask and o.reduce_only for o in orders)


def test_closes_markets_outside_basket():
    orders = rebalance_orders(LVRD, MARKETS, {110: 5.0}, 0, Params())
    assert len(orders) == 1 and orders[0].market_id == 110 and orders[0].is_ask and orders[0].reduce_only


def test_below_exchange_minimum_is_dropped():
    assert rebalance_orders([Leg(1, True, 10_000, 10)], MARKETS, {}, 5, Params(min_order_usd=1)) == []


def test_leverage_setting_has_headroom_and_respects_cap():
    assert market_leverage_setting(LVRD[0], MARKETS[128]) == 4
    assert market_leverage_setting(Leg(110, True, 10_000, 100), MARKETS[110]) == 10


def test_take_profit():
    assert take_profit(1_050, 1_000, Params()) is None
    d = take_profit(1_200, 1_000, Params())
    assert d.realized == 100 and d.withdraw == 75 and d.new_high_water_mark == 1_125
    assert take_profit(1_020, 1_000, Params(take_profit_trigger=0.01)) is None  # 7.5 USD < min buyback


def test_drawdown_breached():
    assert not drawdown_breached(700, 1_000, 0.35)
    assert drawdown_breached(640, 1_000, 0.35)
    assert not drawdown_breached(10, 0, 0.35)  # no mark yet
    assert not drawdown_breached(10, 1_000, 0)  # disabled


def test_close_all_flattens_longs_and_shorts():
    orders = close_all_orders(MARKETS, {128: 1.5, 1: -0.01}, Params())
    by = {o.market_id: o for o in orders}
    assert by[128].is_ask and by[128].reduce_only
    assert not by[1].is_ask and by[1].reduce_only


def test_margin_credit_waits_for_lighter_before_raising_mark():
    from types import SimpleNamespace
    from levered_keeper.runner import Keeper
    from levered_keeper.state import CoinState, Transfer

    cs = CoinState(token="0x1", treasury="0x2", high_water_mark=20.0)
    cs.deposits.append(Transfer(amount=33.0, status="crediting", expect_equity=53.0))
    keeper = SimpleNamespace()

    # Lighter still shows the old equity: nothing settles, and the mark is untouched (no false drawdown).
    assert Keeper.settle_credits(keeper, cs, 20.0) is False
    assert cs.high_water_mark == 20.0

    # Transfer visible: mark rises by the deposit.
    assert Keeper.settle_credits(keeper, cs, 52.9) is True
    assert cs.high_water_mark == 53.0 and cs.deposits[0].status == "credited"


def test_rounds_up_to_exchange_minimum_when_close():
    eth = Market(0, "ETH", 2455.01, 4, 2, 0.005, 10, 50)
    # $12.22 target is 0.00498 ETH, just under the 0.005 minimum: open 0.005 instead of skipping.
    orders = rebalance_orders([Leg(0, True, 3000, 20)], {0: eth}, {}, 20.37, Params())
    assert len(orders) == 1 and orders[0].base_amount == 50 and not orders[0].is_ask
    # Far below the minimum ($3 target): still skipped.
    assert rebalance_orders([Leg(0, True, 3000, 20)], {0: eth}, {}, 5.0, Params()) == []
