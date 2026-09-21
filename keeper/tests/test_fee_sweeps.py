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
    def __init__(self, defend_pending=None, has_defend=True, creator_pending=None, has_creator=True):
        self.calls = []
        self.defend_pending = defend_pending
        self.has_defend = has_defend
        self.creator_pending = creator_pending
        self.has_creator = has_creator
        self.functions = self

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
