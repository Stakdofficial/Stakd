// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {LeveredTest} from "./Levered.t.sol";
import {LeveredFactory} from "../src/LeveredFactory.sol";
import {LeveredToken} from "../src/LeveredToken.sol";
import {LeveredTreasury} from "../src/LeveredTreasury.sol";

/// Each coin remembers which Lighter account its margin belongs to, so the platform can run several master
/// accounts at once and a later change can never strand a coin's money in an account it does not trade on.
/// The keeper picks the account, but only from the owner's list — a stolen keeper key must not be able to
/// point a coin's margin at itself.
contract LighterOwnerTest is LeveredTest {
    address constant MASTER_A = address(0xA11CE);
    address constant MASTER_B = address(0xB0B);
    address constant SCAMMER = address(0xBAD);

    function _allow(address who) internal {
        vm.prank(owner);
        factory.setLighterOwner(who, true);
    }

    // ---------------------------------------------------------------- the guard

    function test_keeperCannotBindToAnUnapprovedAccount() public {
        (, LeveredTreasury t) = _create();
        vm.prank(keeper);
        vm.expectRevert(LeveredTreasury.LighterOwnerNotAllowed.selector);
        t.setLighterAccount(1, SCAMMER);
    }

    /// The whole point: even with the keeper key, margin cannot be sent anywhere the owner has not approved.
    function test_stolenKeeperKeyCannotRedirectMargin() public {
        _allow(MASTER_A);
        (, LeveredTreasury t) = _create();

        vm.prank(keeper);
        vm.expectRevert(LeveredTreasury.LighterOwnerNotAllowed.selector);
        t.setLighterAccount(1, SCAMMER);

        // and once it is bound properly, the keeper cannot move it either
        vm.prank(keeper);
        t.setLighterAccount(1, MASTER_A);
        assertEq(t.lighterOwner(), MASTER_A);

        vm.prank(keeper);
        vm.expectRevert(LeveredTreasury.AlreadySet.selector);
        t.setLighterAccount(2, SCAMMER);
        assertEq(t.lighterOwner(), MASTER_A, "owner must be unchanged");
    }

    function test_onlyKeeperMayBind() public {
        _allow(MASTER_A);
        (, LeveredTreasury t) = _create();
        vm.prank(trader);
        vm.expectRevert(LeveredTreasury.OnlyKeeper.selector);
        t.setLighterAccount(1, MASTER_A);
    }

    /// A launcher or trader has no way to influence the account, at launch or afterwards.
    function test_creatorCannotBindOrRebind() public {
        _allow(MASTER_A);
        (, LeveredTreasury t) = _create();
        vm.prank(creator);
        vm.expectRevert(LeveredTreasury.OnlyKeeper.selector);
        t.setLighterAccount(1, MASTER_A);

        vm.prank(keeper);
        t.setLighterAccount(1, MASTER_A);

        vm.prank(creator);
        vm.expectRevert(LeveredTreasury.OnlyKeeper.selector);
        t.setLighterAccount(9, SCAMMER);
    }

    // ---------------------------------------------------------------- several masters at once

    /// Two coins on the same factory, bound to different masters. This is what removes the 8-per-factory ceiling.
    function test_twoCoinsOnDifferentMasters() public {
        _allow(MASTER_A);
        _allow(MASTER_B);

        (, LeveredTreasury a) = _create();
        (, LeveredTreasury b) = _create();

        vm.prank(keeper);
        a.setLighterAccount(11, MASTER_A);
        vm.prank(keeper);
        b.setLighterAccount(22, MASTER_B);

        assertEq(a.lighterOwner(), MASTER_A);
        assertEq(b.lighterOwner(), MASTER_B);
        assertEq(a.lighterAccountIndex(), 11);
        assertEq(b.lighterAccountIndex(), 22);
    }

    /// Withdrawing an owner from the list stops new coins using it; a coin already bound to it is untouched.
    function test_revokingAnOwnerLeavesBoundCoinsAlone() public {
        _allow(MASTER_A);
        (, LeveredTreasury bound) = _create();
        vm.prank(keeper);
        bound.setLighterAccount(11, MASTER_A);

        vm.prank(owner);
        factory.setLighterOwner(MASTER_A, false);

        assertEq(bound.lighterOwner(), MASTER_A, "already-bound coin keeps its account");

        (, LeveredTreasury fresh) = _create();
        vm.prank(keeper);
        vm.expectRevert(LeveredTreasury.LighterOwnerNotAllowed.selector);
        fresh.setLighterAccount(12, MASTER_A);
    }

    function test_onlyOwnerManagesTheList() public {
        vm.prank(keeper);
        vm.expectRevert();
        factory.setLighterOwner(SCAMMER, true);

        vm.prank(trader);
        vm.expectRevert();
        factory.setLighterOwner(SCAMMER, true);

        assertFalse(factory.isLighterOwner(SCAMMER));
    }

    // ---------------------------------------------------------------- deposits follow the coin

    /// The reason all of this exists: a coin's margin must keep going to the account it trades on, even after
    /// the platform's shared default has moved on to a different master.
    function test_depositGoesToTheCoinsOwnAccountNotTheFactoryDefault() public {
        _allow(MASTER_A);
        (LeveredToken tok, LeveredTreasury t) = _create();
        vm.prank(keeper);
        t.setLighterAccount(11, MASTER_A);

        _buy(trader, tok, 3 ether);
        vm.prank(keeper);
        hook.collectFees(_poolId(tok));

        uint256 reserve = t.marginReserve();
        assertGt(reserve, 0, "expected margin to have accrued");

        vm.recordLogs();
        vm.prank(keeper);
        t.depositMargin(reserve, 0);

        // MarginDeposited reports where the money actually went; the address is indexed, so read it from topics
        address to;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == keccak256("MarginDeposited(uint256,uint256,address)")) {
                to = address(uint160(uint256(logs[i].topics[1])));
            }
        }
        assertEq(to, MASTER_A, "deposit must follow the coin, not the factory default");
    }
}
