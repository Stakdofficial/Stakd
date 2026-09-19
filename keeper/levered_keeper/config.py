from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

from .strategy import Params

# Robinhood Chain (4663). Everything the keeper touches lives on this one chain: no bridges.
ROBINHOOD_CHAIN_ID = 4663
USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"  # Lighter perp collateral (asset 3)
USDG_ASSET_ID = 3
V4_QUOTER = "0x8dc178efb8111bb0973dd9d722ebeff267c98f94"


@dataclass(frozen=True)
class Config:
    rpc_url: str
    factory: str
    keeper_private_key: str
    lighter_eth_private_key: str
    lighter_url: str
    lighter_master_account_index: int
    lighter_master_api_key_index: int
    lighter_master_api_private_key: str
    params: Params
    min_margin_eth: float  # don't deposit smaller amounts (Lighter needs >= $10 orders to be useful)
    min_fee_eth: float  # collect hook fees once a coin has this much pending
    min_claim_eth: float  # pay out creator / platform shares once this much is owed
    max_slippage: float  # Lighter market orders
    swap_slippage: float  # Uniswap v4 swaps
    leverage_headroom: float
    tick_seconds: int
    state_path: Path
    dry_run: bool
    max_drawdown: float
    alert_webhook_url: str
    min_gas_eth: float

    withdraw_mode: str = "secure"  # Lighter on Robinhood pays withdrawals out on Robinhood Chain itself


def _get(name: str, default: str | None = None) -> str:
    value = os.getenv(name, default)
    if value is None or value == "":
        raise SystemExit(f"missing required env var {name}")
    return value


def load() -> Config:
    load_dotenv(os.getenv("LEVERED_ENV_FILE", ".env"))
    keeper_pk = _get("KEEPER_PRIVATE_KEY")
    return Config(
        rpc_url=_get("ROBINHOOD_RPC_URL", "https://rpc.mainnet.chain.robinhood.com"),
        factory=os.getenv("LEVERED_FACTORY", ""),
        keeper_private_key=keeper_pk,
        lighter_eth_private_key=os.getenv("LIGHTER_ETH_PRIVATE_KEY") or keeper_pk,
        lighter_url=_get("LIGHTER_URL", "https://api.rh.lighter.xyz"),
        lighter_master_account_index=int(os.getenv("LIGHTER_MASTER_ACCOUNT_INDEX") or -1),
        lighter_master_api_key_index=int(_get("LIGHTER_MASTER_API_KEY_INDEX", "3")),
        lighter_master_api_private_key=os.getenv("LIGHTER_MASTER_API_PRIVATE_KEY", ""),
        params=Params(
            rebalance_band=float(_get("REBALANCE_BAND", "0.10")),
            min_order_usd=float(_get("MIN_ORDER_USD", "10")),
            take_profit_trigger=float(_get("TAKE_PROFIT_TRIGGER", "0.10")),
            take_profit_fraction=float(_get("TAKE_PROFIT_FRACTION", "0.50")),
            buyback_share=float(_get("BUYBACK_SHARE", "0.75")),
            min_buyback_usd=float(_get("MIN_BUYBACK_USD", "5")),
        ),
        min_margin_eth=float(_get("MIN_MARGIN_ETH", "0.005")),
        min_fee_eth=float(_get("MIN_FEE_ETH", "0.0005")),
        min_claim_eth=float(_get("MIN_CLAIM_ETH", "0.001")),
        max_slippage=float(_get("MAX_SLIPPAGE", "0.005")),
        swap_slippage=float(_get("SWAP_SLIPPAGE", "0.02")),
        leverage_headroom=float(_get("LEVERAGE_HEADROOM", "2")),
        tick_seconds=int(_get("TICK_SECONDS", "60")),
        state_path=Path(_get("STATE_PATH", "keeper-state.robinhood.json")),
        dry_run=_get("DRY_RUN", "true").lower() == "true",
        max_drawdown=float(_get("MAX_DRAWDOWN", "0.35")),
        alert_webhook_url=os.getenv("ALERT_WEBHOOK_URL", ""),
        min_gas_eth=float(_get("MIN_GAS_ETH", "0.001")),
    )
