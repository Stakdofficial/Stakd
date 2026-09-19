"""Keeper ledger persisted as JSON.

Lighter credits every CCTP deposit and withdrawal to the operator's master account, so the
keeper has to remember which coin each in-flight transfer belongs to.
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path


@dataclass
class Transfer:
    amount: float  # USDC
    status: str  # see runner.py for the lifecycle of each kind
    source_tx: str = ""
    message: str = ""
    attestation: str = ""
    created_at: float = 0.0
    expect_equity: float = 0.0  # deposits: sub-account equity that confirms the transfer landed


@dataclass
class CoinState:
    token: str
    treasury: str
    sub_account_index: int | None = None
    api_key_index: int | None = None
    api_private_key: str | None = None
    high_water_mark: float = 0.0
    halted: bool = False  # set by the drawdown stop or `flatten`; cleared by `resume`
    halt_reason: str = ""
    deposits: list[Transfer] = field(default_factory=list)
    withdrawals: list[Transfer] = field(default_factory=list)


@dataclass
class State:
    coins: dict[str, CoinState] = field(default_factory=dict)  # keyed by lowercase token address

    @classmethod
    def load(cls, path: Path) -> "State":
        if not path.exists():
            return cls()
        raw = json.loads(path.read_text())
        coins = {}
        for key, c in raw.get("coins", {}).items():
            c["deposits"] = [Transfer(**t) for t in c.get("deposits", [])]
            c["withdrawals"] = [Transfer(**t) for t in c.get("withdrawals", [])]
            coins[key] = CoinState(**c)
        return cls(coins=coins)

    def save(self, path: Path) -> None:
        tmp = path.with_suffix(".tmp")
        # Holds Lighter API private keys: owner-only permissions.
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(asdict(self), f, indent=2)
        os.replace(tmp, path)
