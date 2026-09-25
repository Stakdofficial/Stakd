"""Fee sweeps the keeper runs every tick, against a fake hook (no chain, no Lighter)."""

from types import SimpleNamespace

from levered_keeper.chain import to_eth
from levered_keeper.runner import Keeper

POOL = b"\x01" * 32
WEI = 10**18


class Call:
    def __init__(self, value=None, error=None, name=""):
        self.value, self.error, self.name = value, error, name

    def call(self):
        if self.error:
            raise self.error
        return self.value


class FakeHook:
    def __init__(self, defend_pending=None, has_defend=True, creator_pending=None, has_creator=True,
                 vol_pending=None, has_vol=True):
        self.calls = []
        self.defend_pending = defend_pending
        self.has_defend = has_defend
        self.creator_pending = creator_pending
        self.has_creator = has_creator
        self.vol_pending = vol_pending
        self.has_vol = has_vol
        self.functions = self

    def pendingVolatilityFees(self, pool_id):
        self.calls.append("pendingVolatilityFees")
        if not self.has_vol:
            return Call(error=ValueError("execution reverted"))
        return Call(self.vol_pending)

    def collectVolatilityFees(self, pool_id):
        return Call(name="collectVolatilityFees")

    def pendingDefendFees(self, pool_id):
        self.calls.append("pendingDefendFees")
        if not self.has_defend:
            return Call(error=ValueError("execution reverted"))
        return Call(self.defend_pending)

    def collectDefendFees(self, pool_id):
        return Call(name="collectDefendFees")

    def pendingCreatorFees(self, pool_id):
        self.calls.append("pendingCreatorFees")
        if not self.has_creator:
            return Call(error=ValueError("execution reverted"))
        return Call(self.creator_pending)

    def collectCreatorFees(self, pool_id):
        return Call(name="collectCreatorFees")


class FakeChain:
    def __init__(self, hook):
        self.hook = hook
        self.sent = []

    def send(self, fn, label, account=None):
        self.sent.append((fn.name, label))
        return "0xtx", None


def keeper_with(hook, min_burn_eth=0.00001, min_fee_eth=0.0005):
    k = Keeper.__new__(Keeper)  # skip __init__: no RPC, no Lighter
    k.chain = FakeChain(hook)
    k.cfg = SimpleNamespace(min_burn_eth=min_burn_eth, min_fee_eth=min_fee_eth)
    k._missing_buckets = set()
    k._no_burner = False
    return k


def test_defend_fees_are_swept_once_they_add_up():
    k = keeper_with(FakeHook(defend_pending=WEI // 100))
    k.collect_defend_fees(POOL)
    assert [name for name, _ in k.chain.sent] == ["collectDefendFees"]
    assert "0.010000 ETH" in k.chain.sent[0][1]


def test_dust_waits():
    k = keeper_with(FakeHook(defend_pending=WEI // 10**6), min_burn_eth=0.001)
    k.collect_defend_fees(POOL)
    assert k.chain.sent == []


def test_nothing_pending_sends_nothing():
    k = keeper_with(FakeHook(defend_pending=0))
    k.collect_defend_fees(POOL)
    assert k.chain.sent == []


def test_old_hook_without_defend_mode_is_asked_once():
    hook = FakeHook(has_defend=False)
    k = keeper_with(hook)
    k.collect_defend_fees(POOL)
    k.collect_defend_fees(POOL)
    assert hook.calls == ["pendingDefendFees"]
    assert k._missing_buckets == {"Defend"}
    assert k.chain.sent == []


def test_creator_fees_are_swept_to_the_treasury():
    k = keeper_with(FakeHook(creator_pending=WEI // 1000))
    k.collect_creator_fees(POOL)
    assert [name for name, _ in k.chain.sent] == ["collectCreatorFees"]
    assert "→ creator" in k.chain.sent[0][1]


def test_small_creator_fees_wait_for_the_fee_threshold():
    k = keeper_with(FakeHook(creator_pending=WEI // 10**5), min_fee_eth=0.0005)
    k.collect_creator_fees(POOL)
    assert k.chain.sent == []


def test_old_hook_without_creator_fee_is_asked_once_and_defend_still_works():
    hook = FakeHook(has_creator=False, defend_pending=WEI // 100)
    k = keeper_with(hook)
    k.collect_creator_fees(POOL)
    k.collect_creator_fees(POOL)
    k.collect_defend_fees(POOL)
    assert hook.calls == ["pendingCreatorFees", "pendingDefendFees"]
    assert [name for name, _ in k.chain.sent] == ["collectDefendFees"]


def test_to_eth_matches_threshold_units():
    assert to_eth(WEI) == 1


# ---------------------------------------------------------------------- sub-accounts shared across factories

from pathlib import Path  # noqa: E402

from levered_keeper.state import CoinState, State  # noqa: E402


class FakeTreasury:
    def __init__(self, bound):
        self.bound = bound
        self.functions = self

    def lighterAccountSet(self):
        return Call(self.bound is not None)

    def lighterAccountIndex(self):
        return Call(self.bound)


class SubAccountChain:
    def __init__(self, own, siblings):
        self.own, self.siblings = own, siblings  # treasury address -> bound index (or None)

    def coins(self):
        return [{"treasury": t} for t in self.own]

    def treasuries_of(self, factory):
        return list(self.siblings[factory])

    def treasury(self, address):
        return FakeTreasury({**self.own, **{k: v for s in self.siblings.values() for k, v in s.items()}}[address])


def test_sub_accounts_of_sibling_factories_are_never_adopted(tmp_path: Path):
    sibling_state = tmp_path / "sibling.json"
    s = State()
    s.coins["0xc"] = CoinState(token="0xc", treasury="0xtc", sub_account_index=9)  # claimed, not yet bound on-chain
    s.save(sibling_state)

    k = Keeper.__new__(Keeper)
    k.state = State()
    k.state.coins["0xa"] = CoinState(token="0xa", treasury="0xta", sub_account_index=3)
    k.chain = SubAccountChain(own={"0xta": 3, "0xtx": None}, siblings={"0xF2": {"0xt2": 7, "0xt3": None}})
    k.cfg = SimpleNamespace(sibling_factories=("0xF2",), sibling_state_paths=(sibling_state, tmp_path / "missing.json"))
    assert k.sub_accounts_in_use() == {3, 7, 9}


# --------------------------------------------------------------- the volatility bucket and the $STAKD burn


class FakeBurner:
    def __init__(self, address="0xB0"):
        self.address = address
        self.burned_with = []
        self.functions = self

    def burn(self, min_tokens):
        self.burned_with.append(min_tokens)
        return Call(name="burn")


class BurnerChain(FakeChain):
    """A chain whose factory has a burner holding `balance` wei, quoting `quote` tokens for it."""

    def __init__(self, hook, burner=None, balance=0, quote=0, quote_error=None):
        super().__init__(hook)
        self._burner = burner
        self._quote = quote
        self._quote_error = quote_error
        self.w3 = SimpleNamespace(eth=SimpleNamespace(get_balance=lambda _addr: balance))

    def stakd_burner(self):
        if self._burner == "reverts":
            raise ValueError("execution reverted")
        return self._burner

    def quote_stakd_buy(self, burner, wei):
        if self._quote_error:
            raise self._quote_error
        return self._quote


def burner_keeper(chain, min_burn_eth=0.00001, swap_slippage=0.01):
    k = Keeper.__new__(Keeper)
    k.chain = chain
    k.cfg = SimpleNamespace(min_burn_eth=min_burn_eth, min_fee_eth=0.0005, swap_slippage=swap_slippage)
    k._missing_buckets = set()
    k._no_burner = False
    return k


def test_volatility_fees_are_swept_to_the_treasury():
    k = keeper_with(FakeHook(vol_pending=WEI // 100))
    k.collect_volatility_fees(POOL)
    assert [name for name, _ in k.chain.sent] == ["collectVolatilityFees"]
    assert "burns the coin and $STAKD" in k.chain.sent[0][1]


def test_old_hook_without_the_volatility_bucket_is_asked_once():
    hook = FakeHook(has_vol=False)
    k = keeper_with(hook)
    k.collect_volatility_fees(POOL)
    k.collect_volatility_fees(POOL)
    assert hook.calls == ["pendingVolatilityFees"]
    assert k._missing_buckets == {"Volatility"}
    assert k.chain.sent == []


def test_burner_spends_its_balance_with_a_slippage_bound():
    burner = FakeBurner()
    k = burner_keeper(BurnerChain(FakeHook(), burner, balance=WEI // 10, quote=1_000_000))
    k.burn_stakd()
    assert [name for name, _ in k.chain.sent] == ["burn"]
    assert burner.burned_with == [980_000]  # the quote minus twice the slippage


def test_burner_waits_while_it_holds_only_dust():
    burner = FakeBurner()
    k = burner_keeper(BurnerChain(FakeHook(), burner, balance=1, quote=1), min_burn_eth=0.001)
    k.burn_stakd()
    assert k.chain.sent == []
    assert burner.burned_with == []


def test_factory_without_a_burner_is_asked_once():
    chain = BurnerChain(FakeHook(), burner=None, balance=WEI)
    k = burner_keeper(chain)
    k.burn_stakd()
    k.burn_stakd()
    assert k._no_burner is True
    assert k.chain.sent == []


def test_older_factory_that_reverts_is_asked_once():
    k = burner_keeper(BurnerChain(FakeHook(), burner="reverts", balance=WEI))
    k.burn_stakd()
    k.burn_stakd()
    assert k._no_burner is True
    assert k.chain.sent == []


def test_a_failed_quote_skips_the_burn_instead_of_burning_blind():
    burner = FakeBurner()
    chain = BurnerChain(FakeHook(), burner, balance=WEI, quote_error=ValueError("no route"))
    k = burner_keeper(chain)
    k.burn_stakd()
    assert k.chain.sent == []
    assert burner.burned_with == []
    assert k._no_burner is False  # it will try again next tick


# --------------------------------------------------------------- pausing one coin


class TickChain(FakeChain):
    def __init__(self, coins):
        super().__init__(FakeHook())
        self._coins = coins
        self.w3 = SimpleNamespace(eth=SimpleNamespace(get_balance=lambda _a: 10**18))
        self.account = SimpleNamespace(address="0xkeeper")

    def coins(self):
        return self._coins

    def stakd_burner(self):
        return None


def tick_keeper(coins, skip=()):
    import asyncio

    k = Keeper.__new__(Keeper)
    k.chain = TickChain(coins)
    k.cfg = SimpleNamespace(min_burn_eth=1, min_fee_eth=1, swap_slippage=0.01, min_gas_eth=0,
                            skip_coins=frozenset(s.lower() for s in skip))
    k._missing_buckets = set()
    k._no_burner = False
    k._skipped_said = set()
    k.state = SimpleNamespace(coins={})
    k.alerts = SimpleNamespace(send=lambda *_: None)
    k.lighter = SimpleNamespace(markets=lambda: asyncio.sleep(0, result={}))
    k.processed = []

    async def process_coin(cs, markets, pool_id):
        k.processed.append(cs.token)

    k.process_coin = process_coin
    k.check_gas = lambda: None
    k.save = lambda: None
    return k


COINS = [
    {"token": "0xAAA", "treasury": "0xT1", "pool_id": b"\x01" * 32},
    {"token": "0xBBB", "treasury": "0xT2", "pool_id": b"\x02" * 32},
]


def test_every_coin_runs_when_nothing_is_paused():
    import asyncio

    k = tick_keeper(COINS)
    asyncio.run(k.tick())
    assert k.processed == ["0xAAA", "0xBBB"]


def test_a_paused_coin_is_left_alone_and_the_rest_carry_on():
    import asyncio

    k = tick_keeper(COINS, skip=["0xaaa"])
    asyncio.run(k.tick())
    assert k.processed == ["0xBBB"]


def test_a_paused_coin_keeps_its_place_in_state():
    import asyncio

    k = tick_keeper(COINS, skip=["0xaaa"])
    asyncio.run(k.tick())
    # It never entered state this tick, so nothing was rewritten; its sub-account stays reserved on disk.
    assert "0xaaa" not in k.state.coins


# --------------------------------------------------------------- the shared-wallet nonce race


def test_nonce_race_errors_are_recognised():
    from levered_keeper.chain import _is_nonce_race

    assert _is_nonce_race(ValueError("{'code': -32000, 'message': 'nonce too low: address 0xE6a4, tx: 3838 state: 3839'}"))
    assert _is_nonce_race(ValueError("already known"))
    assert _is_nonce_race(ValueError("replacement transaction underpriced"))
    assert not _is_nonce_race(ValueError("execution reverted: MarginCapReached"))
    assert not _is_nonce_race(ValueError("insufficient funds for gas"))


def test_the_nonce_lock_is_per_wallet_and_exclusive():
    import os
    from levered_keeper.chain import _nonce_lock

    # Taking it twice in a row works; the point is that it is released, not held forever.
    for _ in range(2):
        with _nonce_lock("0xAbC"):
            pass
    # Two different wallets never block each other.
    with _nonce_lock("0xAbC"):
        with _nonce_lock("0xDeF"):
            pass


def test_a_failing_stakd_burn_does_not_kill_the_tick():
    import asyncio

    k = tick_keeper(COINS)

    def boom():
        raise RuntimeError("nonce too low")

    k.burn_stakd = boom
    sent = []
    k.alerts = SimpleNamespace(send=lambda key, msg: sent.append(key))
    asyncio.run(k.tick())
    assert k.processed == ["0xAAA", "0xBBB"]  # every coin still ran
    assert sent == ["stakd:burn"]  # and the failure was reported, not swallowed


# --------------------------------------------------------------- a dropped connection is not an answer


def test_only_a_revert_means_the_feature_is_missing():
    from levered_keeper.chain import looks_unsupported

    assert looks_unsupported(ValueError("execution reverted"))
    assert looks_unsupported(ValueError("Could not decode contract function call"))
    # Transport trouble says nothing about whether the contract has the function.
    assert not looks_unsupported(ConnectionError("Connection aborted., ConnectionResetError(54, 'Connection reset by peer')"))
    assert not looks_unsupported(TimeoutError("read timed out"))
    assert not looks_unsupported(ValueError("502 Bad Gateway"))


def test_a_dropped_connection_does_not_disable_the_bucket_for_good():
    hook = FakeHook(defend_pending=WEI // 100)

    calls = {"n": 0}

    def flaky(pool_id):
        calls["n"] += 1
        if calls["n"] == 1:
            return Call(error=ConnectionError("Connection reset by peer"))
        return Call(WEI // 100)

    hook.pendingDefendFees = flaky
    k = keeper_with(hook)
    k.collect_defend_fees(POOL)          # connection drops
    assert k._missing_buckets == set()   # not written off
    assert k.chain.sent == []
    k.collect_defend_fees(POOL)          # next tick works
    assert [name for name, _ in k.chain.sent] == ["collectDefendFees"]


def test_a_dropped_connection_does_not_disable_the_stakd_burn_for_good():
    burner = FakeBurner()
    chain = BurnerChain(FakeHook(), burner, balance=WEI // 10, quote=1_000_000)
    calls = {"n": 0}

    def flaky():
        calls["n"] += 1
        if calls["n"] == 1:
            raise ConnectionError("Connection reset by peer")
        return burner

    chain.stakd_burner = flaky
    k = burner_keeper(chain)
    k.burn_stakd()
    assert k._no_burner is False   # it will try again
    assert k.chain.sent == []
    k.burn_stakd()
    assert [name for name, _ in k.chain.sent] == ["burn"]
