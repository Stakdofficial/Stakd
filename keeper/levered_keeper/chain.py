"""Robinhood Chain side: Levered contracts, USDG, and Uniswap v4 quotes."""

from __future__ import annotations

import json
import logging
from pathlib import Path

from eth_account import Account
from web3 import Web3
from web3.contract import Contract

from .config import ROBINHOOD_CHAIN_ID, USDG, V4_QUOTER, Config

log = logging.getLogger(__name__)

ABI_DIR = Path(__file__).resolve().parents[2] / "abi"
ZERO = "0x0000000000000000000000000000000000000000"

ERC20_ABI = json.loads(
    '[{"name":"balanceOf","type":"function","stateMutability":"view","inputs":[{"name":"a","type":"address"}],"outputs":[{"type":"uint256"}]},'
    '{"name":"transfer","type":"function","stateMutability":"nonpayable","inputs":[{"name":"to","type":"address"},{"name":"v","type":"uint256"}],"outputs":[{"type":"bool"}]}]'
)
V4_QUOTER_ABI = json.loads(
    '[{"name":"quoteExactInputSingle","type":"function","stateMutability":"nonpayable","inputs":[{"name":"params","type":"tuple","components":['
    '{"name":"poolKey","type":"tuple","components":[{"name":"currency0","type":"address"},{"name":"currency1","type":"address"},{"name":"fee","type":"uint24"},{"name":"tickSpacing","type":"int24"},{"name":"hooks","type":"address"}]},'
    '{"name":"zeroForOne","type":"bool"},{"name":"exactAmount","type":"uint128"},{"name":"hookData","type":"bytes"}]}],'
    '"outputs":[{"name":"amountOut","type":"uint256"},{"name":"gasEstimate","type":"uint256"}]}]'
)


def to_eth(wei: int) -> float:
    return wei / 1e18


def to_usdg(units: int) -> float:
    return units / 1e6


def from_usdg(amount: float) -> int:
    return int(amount * 1e6)


def _abi(name: str) -> list:
    return json.loads((ABI_DIR / f"{name}.json").read_text())


class Robinhood:
    """Web3 connection to Robinhood Chain plus the keeper's signer."""

    def __init__(self, cfg: Config):
        self.w3 = Web3(Web3.HTTPProvider(cfg.rpc_url))
        self.account = Account.from_key(cfg.keeper_private_key)
        # Lighter pays withdrawals to the L1 address that owns the Lighter account, which can differ from the keeper.
        self.payout_account = Account.from_key(cfg.lighter_eth_private_key)
        self.dry_run = cfg.dry_run
        self.factory = self.contract(cfg.factory, _abi("LeveredFactory"))
        self.hook = self.contract(self.factory.functions.hook().call(), _abi("LeveredHook"))
        self.quoter = self.contract(V4_QUOTER, V4_QUOTER_ABI)
        self.usdg = self.contract(USDG, ERC20_ABI)

    def contract(self, address: str, abi: list) -> Contract:
        return self.w3.eth.contract(address=Web3.to_checksum_address(address), abi=abi)

    def send(self, fn, label: str, account=None) -> tuple[str, dict | None]:
        if self.dry_run:
            log.info("[dry-run] %s", label)
            return "", None
        account = account or self.account
        tx = fn.build_transaction(
            {
                "from": account.address,
                "nonce": self.w3.eth.get_transaction_count(account.address, "pending"),
                "chainId": ROBINHOOD_CHAIN_ID,
            }
        )
        signed = account.sign_transaction(tx)
        tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=300)
        if receipt.status != 1:
            raise RuntimeError(f"{label} reverted: {tx_hash.to_0x_hex()}")
        log.info("%s ok: %s", label, tx_hash.to_0x_hex())
        return tx_hash.to_0x_hex(), receipt

    def coins(self) -> list[dict]:
        out = []
        for i in range(self.factory.functions.coinCount().call()):
            token, treasury, pool_id, creator, _ = self.factory.functions.coin(i).call()
            out.append({"id": i, "token": token, "treasury": treasury, "pool_id": pool_id, "creator": creator})
        return out

    def treasuries_of(self, factory: str) -> list[str]:
        """Treasuries of another Stakd factory (one that shares this keeper's Lighter master account)."""
        f = self.contract(factory, _abi("LeveredFactory"))
        return [f.functions.coin(i).call()[1] for i in range(f.functions.coinCount().call())]

    def token(self, address: str) -> Contract:
        return self.contract(address, _abi("LeveredToken"))

    def treasury(self, address: str) -> Contract:
        return self.contract(address, _abi("LeveredTreasury"))

    def usdg_balance(self, owner: str | None = None) -> int:
        return self.usdg.functions.balanceOf(Web3.to_checksum_address(owner or self.account.address)).call()

    # ------------------------------------------------------------------ Uniswap v4 quotes

    def _quote(self, key: tuple, zero_for_one: bool, amount: int) -> int:
        if amount == 0:
            return 0
        out, _ = self.quoter.functions.quoteExactInputSingle((key, zero_for_one, amount, b"")).call()
        return out

    def margin_pool_key(self) -> tuple:
        cfg = self.factory.functions.marginConfig().call()
        # (lighter, lighterAccount, assetIndex, routeType, usdg, poolFee, poolTickSpacing, poolHooks)
        return (ZERO, cfg[4], cfg[5], cfg[6], cfg[7])

    def quote_eth_to_usdg(self, wei: int) -> int:
        return self._quote(self.margin_pool_key(), True, wei)

    def quote_usdg_to_eth(self, units: int) -> int:
        return self._quote(self.margin_pool_key(), False, units)

    def quote_buy(self, token: str, wei: int) -> int:
        key = self.factory.functions.poolKeyOf(Web3.to_checksum_address(token)).call()
        return self._quote(key, True, wei)
