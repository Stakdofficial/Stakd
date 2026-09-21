// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {MessagingFee, MessagingReceipt, MessagingParams, Origin} from
    "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";
import {StakdOFTAdapter} from "../src/StakdOFTAdapter.sol";
import {RateLimiter} from "@layerzerolabs/oapp-evm/contracts/oapp/utils/RateLimiter.sol";
import {EnforcedOptionParam} from "@layerzerolabs/oapp-evm/contracts/oapp/libs/OAppOptionsType3.sol";

contract MockCoin is ERC20 {
    constructor() ERC20("Stakd Coin", "ALPHA") {
        _mint(msg.sender, 1_000_000_000e18);
    }
}

/// @notice Just enough of LayerZero's EndpointV2 for the adapter to quote and send.
contract MockEndpoint {
    uint256 public constant FEE = 0.003 ether;
    uint32 public immutable eid = 1;

    uint32 public lastDstEid;
    bytes public lastMessage;
    uint256 public lastValue;
    mapping(address => address) public delegates;

    function setDelegate(address delegate) external {
        delegates[msg.sender] = delegate;
    }

    function quote(MessagingParams calldata, address) external pure returns (MessagingFee memory) {
        return MessagingFee(FEE, 0);
    }

    function send(MessagingParams calldata params, address) external payable returns (MessagingReceipt memory r) {
        require(msg.value >= FEE, "fee too low");
        lastDstEid = params.dstEid;
        lastMessage = params.message;
        lastValue = msg.value;
        r.guid = keccak256(abi.encode(params.dstEid, params.message));
        r.fee = MessagingFee(FEE, 0);
    }
}

contract StakdOFTAdapterTest is Test {
    MockCoin coin;
    MockEndpoint endpoint;
    StakdOFTAdapter adapter;

    address owner = makeAddr("owner");
    address router = makeAddr("router"); // stands in for StakdCrossChainRouter
    address solanaBuyer = makeAddr("solanaBuyer");
    uint32 constant SOLANA_EID = 30168;

    function setUp() public {
        coin = new MockCoin();
        endpoint = new MockEndpoint();
        adapter = new StakdOFTAdapter(address(coin), address(endpoint), owner);

        // LayerZero refuses to message a chain with no configured peer.
        vm.prank(owner);
        adapter.setPeer(SOLANA_EID, bytes32(uint256(1)));

        // Limits fail closed, so a working adapter must have one. Generous here; small in production at first.
        RateLimiter.RateLimitConfig[] memory limits = new RateLimiter.RateLimitConfig[](1);
        limits[0] = RateLimiter.RateLimitConfig({dstEid: SOLANA_EID, limit: 1_000_000e18, window: 1 hours});
        vm.prank(owner);
        adapter.setRateLimits(limits);
        vm.prank(owner);
        adapter.setInboundRateLimit(SOLANA_EID, 1_000_000e18, 1 hours);

        // Execution options must exist, or the message would never be delivered.
        vm.prank(owner);
        adapter.setEnforcedOptions(_enforced());

        coin.transfer(router, 10_000e18);
        vm.prank(router);
        coin.approve(address(adapter), type(uint256).max);
    }

    function _enforced() internal view returns (EnforcedOptionParam[] memory p) {
        p = new EnforcedOptionParam[](1);
        p[0] = EnforcedOptionParam({eid: SOLANA_EID, msgType: 1, options: hex"00030100110100000000000000000000000000030d40"});
    }

    function _to32(address a) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(a)));
    }

    function test_locksExactlyWhatItBridges() public {
        vm.deal(router, 1 ether);
        vm.prank(router);
        adapter.sendTokens{value: 0.01 ether}(address(coin), 1_000e18, _to32(solanaBuyer), SOLANA_EID);

        // Supply is unchanged on this chain — the coins are locked, not burned, so the two chains share one supply.
        assertEq(coin.totalSupply(), 1_000_000_000e18, "total supply untouched");
        assertEq(coin.balanceOf(address(adapter)), 1_000e18, "coins locked here");
        assertEq(coin.balanceOf(router), 9_000e18, "router spent exactly what it bridged");
    }

    function test_onlyChargesTheLayerZeroFeeAndRefundsTheRest() public {
        vm.deal(router, 1 ether);
        uint256 before = router.balance;

        vm.prank(router);
        adapter.sendTokens{value: 0.01 ether}(address(coin), 1_000e18, _to32(solanaBuyer), SOLANA_EID);

        assertEq(endpoint.lastValue(), endpoint.FEE(), "endpoint got exactly the quoted fee");
        assertEq(router.balance, before - endpoint.FEE(), "everything else came back");
    }

    function test_rejectsTooSmallABridgeFee() public {
        vm.deal(router, 1 ether);
        vm.expectRevert(
            abi.encodeWithSelector(StakdOFTAdapter.InsufficientBridgeFee.selector, 0.0001 ether, endpoint.FEE())
        );
        vm.prank(router);
        adapter.sendTokens{value: 0.0001 ether}(address(coin), 1_000e18, _to32(solanaBuyer), SOLANA_EID);
    }

    function test_rejectsTheWrongCoin() public {
        MockCoin other = new MockCoin();
        vm.deal(router, 1 ether);
        vm.expectRevert(StakdOFTAdapter.WrongToken.selector);
        vm.prank(router);
        adapter.sendTokens{value: 0.01 ether}(address(other), 1_000e18, _to32(solanaBuyer), SOLANA_EID);
    }

    function test_quoteMatchesWhatItCharges() public view {
        assertEq(adapter.quoteBridge(1_000e18, _to32(solanaBuyer), SOLANA_EID), endpoint.FEE(), "quote is honest");
    }

    function test_theCoinItselfIsUnchanged() public {
        // The adapter holds no power over the coin: no mint, no burn, no fee, no pause.
        vm.deal(router, 1 ether);
        vm.prank(router);
        adapter.sendTokens{value: 0.01 ether}(address(coin), 1_000e18, _to32(solanaBuyer), SOLANA_EID);

        assertEq(adapter.token(), address(coin), "adapter points at the coin");
        assertEq(coin.totalSupply(), 1_000_000_000e18, "supply fixed");
    }

    function test_strangersCannotDrainTheLockbox() public {
        vm.deal(router, 1 ether);
        vm.prank(router);
        adapter.sendTokens{value: 0.01 ether}(address(coin), 1_000e18, _to32(solanaBuyer), SOLANA_EID);

        // Locked coins can only leave by a verified message from the far chain, which only the endpoint delivers.
        address thief = makeAddr("thief");
        vm.prank(thief);
        vm.expectRevert();
        adapter.lzReceive(
            Origin({srcEid: SOLANA_EID, sender: bytes32(uint256(1)), nonce: 1}),
            bytes32(0),
            abi.encodePacked(_to32(thief), uint64(1_000e6)),
            thief,
            ""
        );
        assertEq(coin.balanceOf(address(adapter)), 1_000e18, "lockbox intact");
    }

    // ---------------------------------------------------------------- rate limiting

    function _limit(uint256 amount, uint64 window) internal view returns (RateLimiter.RateLimitConfig[] memory c) {
        c = new RateLimiter.RateLimitConfig[](1);
        c[0] = RateLimiter.RateLimitConfig({dstEid: SOLANA_EID, limit: uint192(amount), window: window});
    }

    function test_rateLimitCapsHowMuchCanLeavePerWindow() public {
        vm.prank(owner);
        adapter.setRateLimits(_limit(1_500e18, 1 hours));

        vm.deal(router, 1 ether);
        vm.prank(router);
        adapter.sendTokens{value: 0.01 ether}(address(coin), 1_000e18, _to32(solanaBuyer), SOLANA_EID);

        // The next 1,000 would breach the 1,500 hourly cap.
        vm.expectRevert(RateLimiter.RateLimitExceeded.selector);
        vm.prank(router);
        adapter.sendTokens{value: 0.01 ether}(address(coin), 1_000e18, _to32(solanaBuyer), SOLANA_EID);

        assertEq(coin.balanceOf(address(adapter)), 1_000e18, "only the allowed amount crossed");
    }

    function test_rateLimitRefillsOverTime() public {
        vm.prank(owner);
        adapter.setRateLimits(_limit(1_500e18, 1 hours));

        vm.deal(router, 1 ether);
        vm.prank(router);
        adapter.sendTokens{value: 0.01 ether}(address(coin), 1_000e18, _to32(solanaBuyer), SOLANA_EID);

        skip(1 hours);

        vm.prank(router);
        adapter.sendTokens{value: 0.01 ether}(address(coin), 1_000e18, _to32(solanaBuyer), SOLANA_EID);
        assertEq(coin.balanceOf(address(adapter)), 2_000e18, "window refilled");
    }

    function test_onlyOwnerCanChangeRateLimits() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        adapter.setRateLimits(_limit(type(uint192).max, 1 hours));
    }

    /// Sending with no execution options would lock the coins here and never deliver them.
    function test_refusesToSendWithoutExecutionOptions() public {
        StakdOFTAdapter bare = new StakdOFTAdapter(address(coin), address(endpoint), owner);
        vm.prank(owner);
        bare.setPeer(SOLANA_EID, bytes32(uint256(1)));
        RateLimiter.RateLimitConfig[] memory limits = new RateLimiter.RateLimitConfig[](1);
        limits[0] = RateLimiter.RateLimitConfig({dstEid: SOLANA_EID, limit: 1_000_000e18, window: 1 hours});
        vm.prank(owner);
        bare.setRateLimits(limits);

        vm.deal(router, 1 ether);
        vm.expectRevert(StakdOFTAdapter.NoEnforcedOptions.selector);
        vm.prank(router);
        bare.sendTokens{value: 0.01 ether}(address(coin), 1_000e18, _to32(solanaBuyer), SOLANA_EID);
        assertEq(coin.balanceOf(address(bare)), 0, "no coins locked by a message that cannot be delivered");
    }

    /// Coins leaving must not eat the budget for coins coming home.
    function test_outboundTrafficDoesNotBlockRedemptions() public {
        // Tight outbound budget, separate inbound budget.
        RateLimiter.RateLimitConfig[] memory limits = new RateLimiter.RateLimitConfig[](1);
        limits[0] = RateLimiter.RateLimitConfig({dstEid: SOLANA_EID, limit: 1_000e18, window: 1 hours});
        vm.prank(owner);
        adapter.setRateLimits(limits);

        vm.deal(router, 1 ether);
        vm.prank(router);
        adapter.sendTokens{value: 0.01 ether}(address(coin), 1_000e18, _to32(solanaBuyer), SOLANA_EID);

        // Outbound is now exhausted...
        vm.expectRevert(RateLimiter.RateLimitExceeded.selector);
        vm.prank(router);
        adapter.sendTokens{value: 0.01 ether}(address(coin), 1e18, _to32(solanaBuyer), SOLANA_EID);

        // ...but inbound capacity is untouched, so redemptions still work.
        assertEq(adapter.inboundCapacity(SOLANA_EID), 1_000_000e18, "inbound budget is its own");
    }

    function test_inboundLimitIsSetSeparatelyAndByOwnerOnly() public {
        vm.prank(makeAddr("stranger"));
        vm.expectRevert();
        adapter.setInboundRateLimit(SOLANA_EID, type(uint256).max, 1 hours);
    }
}
