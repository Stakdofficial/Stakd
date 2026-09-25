// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {LeveredFactory} from "../src/LeveredFactory.sol";
import {LeveredToken} from "../src/LeveredToken.sol";
import {LeveredTreasury} from "../src/LeveredTreasury.sol";
import {LeveredTestBase} from "./Levered.t.sol";

/// @notice Pointing a coin's 1% creator fee at someone's social account. Anyone can name anyone; the fee waits in
///         the treasury until that person proves who they are, and the first to prove it keeps it for good.
contract CreatorHandleTest is LeveredTestBase {
    uint256 signerKey = 0xA11CE;
    address signer;
    address alice = makeAddr("alice");
    address aliceWallet = makeAddr("aliceWallet");
    address impostor = makeAddr("impostor");

    bytes32 constant ALICE_ID = keccak256("x:44196397");
    bytes32 constant OTHER_ID = keccak256("x:99999999");

    function setUp() public override {
        super.setUp();
        signer = vm.addr(signerKey);
        vm.prank(owner);
        factory.setClaimSigner(signer);
    }

    function _launchFor(string memory handle) internal returns (LeveredToken tok, LeveredTreasury t) {
        LeveredFactory.CreateParams memory p = LeveredFactory.CreateParams({
            name: "Handle Coin",
            symbol: "HNDL",
            legs: _lvrdLegs(),
            feeBps: FEE_BPS,
            minDevTokens: 0,
            creatorHandle: handle
        });
        vm.prank(creator);
        (, address token, address treasury) = factory.createCoin(p);
        return (LeveredToken(token), LeveredTreasury(payable(treasury)));
    }

    function _proof(LeveredTreasury t, string memory handle, bytes32 subject, address payout, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(block.chainid, address(t), handle, subject, payout, deadline))
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    // ---------------------------------------------------------------- the ordinary case still works

    function test_aCoinWithNoHandleStillPaysItsLauncher() public {
        (LeveredToken tok, LeveredTreasury t) = _launchFor("");
        assertEq(t.creator(), creator, "the launcher is the creator, as before");
        _buy(trader, tok, 1 ether);
        hook.collectCreatorFees(_poolId(tok));
        uint256 owed = t.creatorOwed();
        assertGt(owed, 0);
        t.claimCreatorFees();
        assertEq(creator.balance, owed);
    }

    // ---------------------------------------------------------------- pointing at a handle

    function test_pointingAtAHandleLeavesNobodyToPayYet() public {
        (LeveredToken tok, LeveredTreasury t) = _launchFor("x:someone");
        assertEq(t.creator(), address(0), "nobody owns it yet");
        assertEq(t.creatorHandle(), "x:someone");

        _buy(trader, tok, 1 ether);
        hook.collectCreatorFees(_poolId(tok));
        assertGt(t.creatorOwed(), 0, "the fee still accrues");

        vm.expectRevert(LeveredTreasury.NotClaimedYet.selector);
        t.claimCreatorFees();
    }

    function test_theLauncherKeepsNothingWhenTheyPointItAtSomeoneElse() public {
        (LeveredToken tok, LeveredTreasury t) = _launchFor("x:someone");
        _buy(trader, tok, 1 ether);
        hook.collectCreatorFees(_poolId(tok));
        uint256 before = creator.balance;
        vm.expectRevert(LeveredTreasury.NotClaimedYet.selector);
        t.claimCreatorFees();
        assertEq(creator.balance, before, "the launcher cannot take it");
    }

    function test_provingTheHandlePaysOutTheWholeBacklog() public {
        (LeveredToken tok, LeveredTreasury t) = _launchFor("x:alice");
        _buy(trader, tok, 1 ether);
        hook.collectCreatorFees(_poolId(tok));
        uint256 owed = t.creatorOwed();

        uint256 deadline = block.timestamp + 1 hours;
        t.bindCreator(aliceWallet, ALICE_ID, deadline, _proof(t, "x:alice", ALICE_ID, aliceWallet, deadline));
        assertEq(t.creator(), aliceWallet);
        assertEq(t.creatorSubject(), ALICE_ID);

        t.claimCreatorFees();
        assertEq(aliceWallet.balance, owed, "everything that accrued while they were away");
    }

    function test_feesKeepFlowingAfterTheyClaim() public {
        (LeveredToken tok, LeveredTreasury t) = _launchFor("x:alice");
        uint256 deadline = block.timestamp + 1 hours;
        t.bindCreator(aliceWallet, ALICE_ID, deadline, _proof(t, "x:alice", ALICE_ID, aliceWallet, deadline));

        _buy(trader, tok, 1 ether);
        hook.collectCreatorFees(_poolId(tok));
        t.claimCreatorFees();
        assertGt(aliceWallet.balance, 0, "later fees go straight to them");
    }

    // ---------------------------------------------------------------- who cannot take it

    function test_anImpostorWithoutAProofGetsNothing() public {
        (, LeveredTreasury t) = _launchFor("x:alice");
        uint256 deadline = block.timestamp + 1 hours;
        vm.expectRevert(LeveredTreasury.BadProof.selector);
        t.bindCreator(impostor, ALICE_ID, deadline, hex"00");
    }

    function test_aProofSignedByTheWrongKeyIsRefused() public {
        (, LeveredTreasury t) = _launchFor("x:alice");
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            keccak256(abi.encode(block.chainid, address(t), "x:alice", ALICE_ID, impostor, deadline))
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBEEF, digest); // not the claim signer
        vm.expectRevert(LeveredTreasury.BadProof.selector);
        t.bindCreator(impostor, ALICE_ID, deadline, abi.encodePacked(r, s, v));
    }

    function test_aProofForAnotherCoinCannotBeReplayedHere() public {
        (, LeveredTreasury a) = _launchFor("x:alice");
        (, LeveredTreasury b) = _launchFor("x:alice");
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory forA = _proof(a, "x:alice", ALICE_ID, aliceWallet, deadline);
        vm.expectRevert(LeveredTreasury.BadProof.selector);
        b.bindCreator(aliceWallet, ALICE_ID, deadline, forA);
    }

    function test_anExpiredProofIsRefused() public {
        (, LeveredTreasury t) = _launchFor("x:alice");
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory proof = _proof(t, "x:alice", ALICE_ID, aliceWallet, deadline);
        vm.warp(deadline + 1);
        vm.expectRevert(LeveredTreasury.ProofExpired.selector);
        t.bindCreator(aliceWallet, ALICE_ID, deadline, proof);
    }

    function test_theFirstAccountToProveItKeepsItForever() public {
        (, LeveredTreasury t) = _launchFor("x:alice");
        uint256 deadline = block.timestamp + 1 hours;
        t.bindCreator(aliceWallet, ALICE_ID, deadline, _proof(t, "x:alice", ALICE_ID, aliceWallet, deadline));

        // Someone who later owns the same username — a rename, a recycled handle — cannot take it over.
        vm.expectRevert(LeveredTreasury.WrongAccount.selector);
        t.bindCreator(impostor, OTHER_ID, deadline, _proof(t, "x:alice", OTHER_ID, impostor, deadline));
        assertEq(t.creator(), aliceWallet);
    }

    function test_theOwnerCanMoveTheirPayoutWallet() public {
        (, LeveredTreasury t) = _launchFor("x:alice");
        uint256 deadline = block.timestamp + 1 hours;
        t.bindCreator(aliceWallet, ALICE_ID, deadline, _proof(t, "x:alice", ALICE_ID, aliceWallet, deadline));

        address newWallet = makeAddr("aliceNewWallet");
        t.bindCreator(newWallet, ALICE_ID, deadline, _proof(t, "x:alice", ALICE_ID, newWallet, deadline));
        assertEq(t.creator(), newWallet, "same person, new wallet");
    }

    function test_aPlainWalletCoinHasNothingToClaim() public {
        (, LeveredTreasury t) = _launchFor("");
        uint256 deadline = block.timestamp + 1 hours;
        vm.expectRevert(LeveredTreasury.AlreadySet.selector);
        t.bindCreator(impostor, ALICE_ID, deadline, _proof(t, "", ALICE_ID, impostor, deadline));
    }

    function test_githubAndDiscordWorkTheSameWay() public {
        (, LeveredTreasury gh) = _launchFor("github:torvalds");
        (, LeveredTreasury dc) = _launchFor("discord:1234567890");
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 ghId = keccak256("github:1024025");
        bytes32 dcId = keccak256("discord:1234567890");

        gh.bindCreator(aliceWallet, ghId, deadline, _proof(gh, "github:torvalds", ghId, aliceWallet, deadline));
        dc.bindCreator(aliceWallet, dcId, deadline, _proof(dc, "discord:1234567890", dcId, aliceWallet, deadline));
        assertEq(gh.creator(), aliceWallet);
        assertEq(dc.creator(), aliceWallet);
    }

    function test_unclaimedFeesJustWait() public {
        (LeveredToken tok, LeveredTreasury t) = _launchFor("x:ghost");
        _buy(trader, tok, 1 ether);
        hook.collectCreatorFees(_poolId(tok));
        uint256 owed = t.creatorOwed();

        vm.warp(block.timestamp + 3650 days); // ten years later, still nobody
        assertEq(t.creatorOwed(), owed, "the ETH is still there, untouched");
        vm.expectRevert(LeveredTreasury.NotClaimedYet.selector);
        t.claimCreatorFees();
    }
}
