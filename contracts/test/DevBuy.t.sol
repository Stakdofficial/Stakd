// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {LeveredFactory} from "../src/LeveredFactory.sol";
import {LeveredToken} from "../src/LeveredToken.sol";
import {LeveredTreasury} from "../src/LeveredTreasury.sol";
import {StakdLaunchQuoter, IStartTick} from "../src/StakdLaunchQuoter.sol";
import {LeveredTestBase} from "./Levered.t.sol";

/// @notice The creator's own first buy, made inside the launch transaction so no bot can get there first.
contract DevBuyTest is LeveredTestBase {
    StakdLaunchQuoter quoter;

    function setUp() public override {
        super.setUp();
        quoter = new StakdLaunchQuoter(IStartTick(address(factory)));
    }

    function _params() internal view returns (LeveredFactory.CreateParams memory p) {
        p = LeveredFactory.CreateParams({
            name: "Dev Buy",
            symbol: "DEVB",
            legs: _lvrdLegs(),
            feeBps: FEE_BPS,
            minDevTokens: 0, creatorHandle: ""
        });
    }

    function _launchWith(uint256 ethIn, uint256 minOut) internal returns (LeveredToken tok, LeveredTreasury t) {
        LeveredFactory.CreateParams memory p = _params();
        p.minDevTokens = minOut;
        vm.deal(creator, creator.balance + ethIn);
        vm.prank(creator);
        (, address token, address treasury) = factory.createCoin{value: ethIn}(p);
        return (LeveredToken(token), LeveredTreasury(payable(treasury)));
    }

    function test_launchingWithNoEthBuysNothing() public {
        (LeveredToken tok,) = _launchWith(0, 0);
        assertEq(tok.balanceOf(creator), 0, "no ETH sent, no coins");
        // Launch burns the rounding dust, so the supply lands a hair under a billion.
        assertApproxEqRel(tok.totalSupply(), 1_000_000_000e18, 0.0001e18);
    }

    function test_theCreatorGetsCoinsInTheLaunchTransaction() public {
        (LeveredToken tok,) = _launchWith(1 ether, 0);
        assertGt(tok.balanceOf(creator), 0, "the creator holds coins straight after launching");
    }

    function test_theQuoteMatchesWhatTheyActuallyGet() public {
        uint256 quoted = quoter.quoteLaunchBuy(1 ether, FEE_BPS);
        (LeveredToken tok,) = _launchWith(1 ether, 0);
        uint256 got = tok.balanceOf(creator);
        assertGt(quoted, 0);
        assertApproxEqRel(got, quoted, 0.0001e18, "the quote is what they actually get");
    }

    function test_aBiggerBuyGetsMoreCoinsButAWorsePrice() public {
        uint256 small = quoter.quoteLaunchBuy(0.1 ether, FEE_BPS);
        uint256 big = quoter.quoteLaunchBuy(1 ether, FEE_BPS);
        assertGt(big, small, "more ETH buys more coins");
        assertLt(big, small * 10, "but ten times the ETH buys less than ten times the coins");
    }

    function test_theBoundIsRespected() public {
        uint256 quoted = quoter.quoteLaunchBuy(1 ether, FEE_BPS);
        vm.expectRevert(); // asking for more than the pool can give
        _launchWith(1 ether, quoted * 2);
    }

    function test_theDevBuyPaysTheSameFeeAsAnyoneElse() public {
        (LeveredToken tok, LeveredTreasury t) = _launchWith(1 ether, 0);
        PoolId id = _poolId(tok);
        // The coin's fee and the creator fee both land, exactly as on a normal buy.
        assertEq(hook.pendingFees(id), 1 ether * uint256(FEE_BPS) / 10_000, "the coin's fee was charged");
        assertEq(hook.pendingCreatorFees(id), 0.01 ether, "and the creator's 1%");
        assertEq(address(t).balance, 0, "nothing has been swept yet");
    }

    function test_nobodyCanTradeBeforeTheCreatorDoes() public {
        // The pool does not exist until createCoin returns, so the dev buy is always the first trade.
        (LeveredToken tok,) = _launchWith(1 ether, 0);
        PoolId id = _poolId(tok);
        (, uint16 feeBps) = hook.pools(id);
        assertEq(feeBps, FEE_BPS);
        assertGt(tok.balanceOf(creator), 0);
        assertEq(tok.balanceOf(address(factory)), 0, "the factory keeps nothing");
    }

    function test_theRestOfTheSupplyIsStillInThePool() public {
        (LeveredToken tok,) = _launchWith(1 ether, 0);
        uint256 held = tok.balanceOf(creator);
        assertLt(held, tok.totalSupply() / 2, "a 1 ETH buy is nowhere near half the supply");
    }
}
