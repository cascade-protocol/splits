// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.30;

import {SplitConfigImpl} from "../src/SplitConfigImpl.sol";
import {SplitFactory} from "../src/SplitFactory.sol";
import {Recipient} from "../src/Types.sol";
import {BaseTest} from "./Base.t.sol";

contract SplitConfigImplTest is BaseTest {
    SplitConfigImpl public split;

    function setUp() public override {
        super.setUp();

        // Create a default split for testing
        Recipient[] memory recipients = _twoRecipients();
        bytes32 uniqueId = keccak256("test-split");
        address splitAddr = factory.createSplitConfig(alice, address(token), uniqueId, recipients);
        split = SplitConfigImpl(splitAddr);
    }

    // =========================================================================
    // Immutable Args Tests
    // =========================================================================

    function test_ImmutableArgs_ReadCorrectly() public view {
        assertEq(split.factory(), address(factory));
        assertEq(split.authority(), alice);
        assertEq(split.token(), address(token));
        assertEq(split.uniqueId(), keccak256("test-split"));
    }

    function test_GetRecipientCount_DerivedFromCodeSize() public view {
        assertEq(split.getRecipientCount(), 2);
    }

    function test_GetRecipients_ReturnsAll() public view {
        Recipient[] memory recipients = split.getRecipients();
        assertEq(recipients.length, 2);
        assertEq(recipients[0].addr, alice);
        assertEq(recipients[0].percentageBps, 4950);
        assertEq(recipients[1].addr, bob);
        assertEq(recipients[1].percentageBps, 4950);
    }

    function test_IsCascadeSplitConfig_ReturnsTrue() public view {
        assertTrue(split.isCascadeSplitConfig());
    }

    // =========================================================================
    // Balance & View Tests
    // =========================================================================

    function test_GetBalance_ReturnsTokenBalance() public {
        assertEq(split.getBalance(), 0);

        _fundSplit(address(split), 1000e6);
        assertEq(split.getBalance(), 1000e6);
    }

    function test_GetBalance_ReturnsZeroOnFailure() public {
        // Create split with a token that has no balanceOf function (no code)
        address noCodeToken = makeAddr("noCodeToken");

        Recipient[] memory recipients = _twoRecipients();
        bytes32 uniqueId = keccak256("no-code-token-test");
        address splitAddr = factory.createSplitConfig(alice, noCodeToken, uniqueId, recipients);
        SplitConfigImpl noCodeSplit = SplitConfigImpl(splitAddr);

        // _getBalance should return 0 when staticcall fails (no code at address)
        assertEq(noCodeSplit.getBalance(), 0);
    }

    function test_GetBalance_ReturnsZeroOnInvalidReturnData() public {
        // Deploy a mock that returns invalid (too short) data
        InvalidBalanceOfToken invalidToken = new InvalidBalanceOfToken();

        Recipient[] memory recipients = _twoRecipients();
        bytes32 uniqueId = keccak256("invalid-balance-test");
        address splitAddr = factory.createSplitConfig(alice, address(invalidToken), uniqueId, recipients);
        SplitConfigImpl invalidSplit = SplitConfigImpl(splitAddr);

        // _getBalance should return 0 when return data is too short (< 32 bytes)
        assertEq(invalidSplit.getBalance(), 0);
    }

    function test_TotalUnclaimed_ReturnsZeroWhenEmpty() public view {
        assertEq(split.totalUnclaimed(), 0);
    }

    function test_PendingAmount_CalculatesCorrectly() public {
        _fundSplit(address(split), 1000e6);
        assertEq(split.pendingAmount(), 1000e6);
        assertEq(split.hasPendingFunds(), true);
    }

    function test_PreviewExecution_MatchesActualExecution() public {
        _fundSplit(address(split), 1000e6);

        (
            uint256[] memory amounts,
            uint256 fee,
            uint256 available,
            uint256[] memory pendingRecipientAmounts,
            uint256 pendingProtocolAmount
        ) = split.previewExecution();

        assertEq(available, 1000e6);
        assertEq(amounts.length, 2);
        assertEq(amounts[0], 495e6); // 49.5%
        assertEq(amounts[1], 495e6); // 49.5%
        assertEq(fee, 10e6); // 1% (remainder)
        // No pending unclaimed
        assertEq(pendingRecipientAmounts.length, 2);
        assertEq(pendingRecipientAmounts[0], 0);
        assertEq(pendingRecipientAmounts[1], 0);
        assertEq(pendingProtocolAmount, 0);
    }

    function test_PreviewExecution_WithPendingUnclaimed() public {
        _fundSplit(address(split), 1000e6);

        // Mock alice and feeWallet transfers to fail
        _mockTransferFail(alice);
        _mockTransferFail(feeWallet);

        split.executeSplit();

        // Verify unclaimed exists (alice's 495e6 + protocol's 10e6)
        assertEq(split.totalUnclaimed(), 505e6);

        // Add more funds for preview
        _fundSplit(address(split), 500e6);

        // Preview should show both pending unclaimed AND new distribution
        (
            uint256[] memory amounts,
            uint256 fee,
            uint256 available,
            uint256[] memory pendingRecipientAmounts,
            uint256 pendingProtocolAmount
        ) = split.previewExecution();

        // New distribution from 500e6
        assertEq(available, 500e6);
        assertEq(amounts[0], 247_500_000); // 49.5% of 500e6 = 247.5e6
        assertEq(amounts[1], 247_500_000); // 49.5% of 500e6 = 247.5e6
        assertEq(fee, 5e6); // 1% of 500e6 = 5e6

        // Pending unclaimed from failed transfers
        assertEq(pendingRecipientAmounts[0], 495e6); // alice's unclaimed
        assertEq(pendingRecipientAmounts[1], 0); // bob had no failure
        assertEq(pendingProtocolAmount, 10e6); // protocol's unclaimed
    }

    // =========================================================================
    // executeSplit Tests
    // =========================================================================

    function test_ExecuteSplit_DistributesFunds() public {
        _fundSplit(address(split), 1000e6);

        split.executeSplit();

        // Check balances
        assertEq(_balance(alice), 495e6); // 49.5%
        assertEq(_balance(bob), 495e6); // 49.5%
        assertEq(_balance(feeWallet), 10e6); // 1%
        assertEq(split.getBalance(), 0);
    }

    function test_ExecuteSplit_HandlesZeroBalance() public {
        // Should not revert, just emit event with zeros
        split.executeSplit();

        assertEq(_balance(alice), 0);
        assertEq(_balance(bob), 0);
        assertEq(_balance(feeWallet), 0);
    }

    function test_ExecuteSplit_ProtocolGetsDust() public {
        // 100 tokens with 3 recipients at 33% each = 99 tokens to recipients
        Recipient[] memory recipients = _threeRecipients();
        bytes32 uniqueId = keccak256("dust-test");
        address splitAddr = factory.createSplitConfig(alice, address(token), uniqueId, recipients);
        SplitConfigImpl dustSplit = SplitConfigImpl(splitAddr);

        _fundSplit(splitAddr, 100e6);
        dustSplit.executeSplit();

        // 33% of 100 = 33 each
        assertEq(_balance(alice), 33e6);
        assertEq(_balance(bob), 33e6);
        assertEq(_balance(charlie), 33e6);
        // Protocol gets 1% = 1 (no dust in this case because 99 = 33*3)
        assertEq(_balance(feeWallet), 1e6);
    }

    function test_ExecuteSplit_IdempotentMultipleCalls() public {
        _fundSplit(address(split), 1000e6);
        split.executeSplit();

        uint256 aliceBalance = _balance(alice);
        uint256 bobBalance = _balance(bob);
        uint256 feeBalance = _balance(feeWallet);

        // Second call should be no-op
        split.executeSplit();

        assertEq(_balance(alice), aliceBalance);
        assertEq(_balance(bob), bobBalance);
        assertEq(_balance(feeWallet), feeBalance);
    }

    function test_ExecuteSplit_SingleRecipient() public {
        Recipient[] memory recipients = _singleRecipient();
        bytes32 uniqueId = keccak256("single-test");
        address splitAddr = factory.createSplitConfig(alice, address(token), uniqueId, recipients);

        token.mint(splitAddr, 1000e6);
        SplitConfigImpl(splitAddr).executeSplit();

        assertEq(_balance(alice), 990e6); // 99%
        assertEq(_balance(feeWallet), 10e6); // 1%
    }

    function test_ExecuteSplit_MaxRecipients() public {
        Recipient[] memory recipients = _maxRecipients();
        bytes32 uniqueId = keccak256("max-test");
        address splitAddr = factory.createSplitConfig(alice, address(token), uniqueId, recipients);

        token.mint(splitAddr, 10_000e6);
        SplitConfigImpl(splitAddr).executeSplit();

        // Each recipient gets 4.95% = 495e6
        for (uint160 i; i < 20; i++) {
            assertEq(_balance(address(0x1000 + i)), 495e6);
        }
        // Protocol gets 1% = 100e6
        assertEq(_balance(feeWallet), 100e6);
    }

    // =========================================================================
    // Self-Healing Tests
    // =========================================================================

    function test_SelfHealing_StoresUnclaimedOnFailure() public {
        _fundSplit(address(split), 1000e6);

        // Mock alice's transfer to fail
        _mockTransferFail(alice);

        split.executeSplit();

        // Alice's share should be unclaimed
        assertEq(split.totalUnclaimed(), 495e6);
        // Bob and protocol should have received their shares
        assertEq(_balance(bob), 495e6);
        assertEq(_balance(feeWallet), 10e6);
    }

    function test_SelfHealing_ClearsUnclaimedOnSuccess() public {
        _fundSplit(address(split), 1000e6);

        // Mock alice's transfer to fail
        _mockTransferFail(alice);
        split.executeSplit();

        assertEq(split.totalUnclaimed(), 495e6);

        // Clear mock and retry
        _clearMocks();
        split.executeSplit();

        // Now alice should have received her share
        assertEq(_balance(alice), 495e6);
        assertEq(split.totalUnclaimed(), 0);
    }

    function test_SelfHealing_ProtocolFeeUnclaimed() public {
        _fundSplit(address(split), 1000e6);

        // Mock feeWallet transfer to fail
        _mockTransferFail(feeWallet);

        split.executeSplit();

        // Recipients should have received their shares
        assertEq(_balance(alice), 495e6);
        assertEq(_balance(bob), 495e6);
        // Protocol fee should be unclaimed
        assertEq(split.totalUnclaimed(), 10e6);
    }

    function test_SelfHealing_ProtocolFeeRecovery() public {
        _fundSplit(address(split), 1000e6);

        // Mock feeWallet transfer to fail
        _mockTransferFail(feeWallet);
        split.executeSplit();

        // Update fee wallet and retry
        address newFeeWallet = makeAddr("newFeeWallet");
        vm.prank(protocolAuthority);
        factory.updateProtocolConfig(newFeeWallet);

        _clearMocks();
        split.executeSplit();

        // New fee wallet should have received the unclaimed fee
        assertEq(_balance(newFeeWallet), 10e6);
        assertEq(split.totalUnclaimed(), 0);
    }

    function test_SelfHealing_RevertingTransfer() public {
        _fundSplit(address(split), 1000e6);

        // Mock alice's transfer to revert
        _mockTransferRevert(alice);

        split.executeSplit();

        // Alice's share should be unclaimed
        assertEq(split.totalUnclaimed(), 495e6);
        // Bob and protocol should have received their shares
        assertEq(_balance(bob), 495e6);
        assertEq(_balance(feeWallet), 10e6);
    }

    // =========================================================================
    // Event Tests
    // =========================================================================

    function test_ExecuteSplit_EmitsEvent() public {
        _fundSplit(address(split), 1000e6);

        vm.expectEmit(true, true, true, true);
        emit SplitConfigImpl.SplitExecuted(
            1000e6, // totalDistributed
            10e6, // protocolFee
            0, // unclaimedCleared
            0 // newUnclaimed
        );

        split.executeSplit();
    }

    function test_TransferFailed_EmitsEvent() public {
        _fundSplit(address(split), 1000e6);
        _mockTransferFail(alice);

        vm.expectEmit(true, true, true, true);
        emit SplitConfigImpl.TransferFailed(alice, 495e6, false);

        split.executeSplit();
    }

    function test_UnclaimedCleared_EmitsEvent() public {
        _fundSplit(address(split), 1000e6);

        // Mock alice's transfer to fail
        _mockTransferFail(alice);
        split.executeSplit();

        // Verify unclaimed exists
        assertEq(split.totalUnclaimed(), 495e6);

        // Clear mock and retry - should emit UnclaimedCleared
        _clearMocks();

        vm.expectEmit(true, true, true, true);
        emit SplitConfigImpl.UnclaimedCleared(alice, 495e6, false);

        split.executeSplit();

        // Verify unclaimed is cleared
        assertEq(split.totalUnclaimed(), 0);
    }

    function test_UnclaimedCleared_ProtocolFee_EmitsEvent() public {
        _fundSplit(address(split), 1000e6);

        // Mock feeWallet transfer to fail
        _mockTransferFail(feeWallet);
        split.executeSplit();

        // Verify unclaimed exists
        assertEq(split.totalUnclaimed(), 10e6);

        // Update fee wallet and clear mock
        address newFeeWallet = makeAddr("newFeeWallet");
        vm.prank(protocolAuthority);
        factory.updateProtocolConfig(newFeeWallet);
        _clearMocks();

        vm.expectEmit(true, true, true, true);
        emit SplitConfigImpl.UnclaimedCleared(newFeeWallet, 10e6, true);

        split.executeSplit();

        // Verify unclaimed is cleared
        assertEq(split.totalUnclaimed(), 0);
    }

    // =========================================================================
    // Fuzz Tests
    // =========================================================================

    function testFuzz_ExecuteSplit_AnyAmount(
        uint256 amount
    ) public {
        amount = bound(amount, 1, 1e24); // 1 wei to 1M tokens

        _fundSplit(address(split), amount);
        split.executeSplit();

        // Verify all funds distributed (allowing for rounding)
        uint256 totalDistributed = _balance(alice) + _balance(bob) + _balance(feeWallet);
        assertEq(totalDistributed, amount);
    }

    function testFuzz_ExecuteSplit_MultipleDeposits(
        uint256 amount1,
        uint256 amount2
    ) public {
        amount1 = bound(amount1, 1, 1e18);
        amount2 = bound(amount2, 1, 1e18);

        _fundSplit(address(split), amount1);
        split.executeSplit();

        uint256 aliceAfterFirst = _balance(alice);
        uint256 bobAfterFirst = _balance(bob);

        _fundSplit(address(split), amount2);
        split.executeSplit();

        // Verify second distribution added to balances
        assertTrue(_balance(alice) > aliceAfterFirst || amount2 < 3);
        assertTrue(_balance(bob) > bobAfterFirst || amount2 < 3);
    }

    // =========================================================================
    // Retry Phase Tests (TransferFailed on retry)
    // =========================================================================

    function test_RetryPhase_EmitsTransferFailedOnPersistentFailure() public {
        _fundSplit(address(split), 1000e6);

        // First execution: alice fails
        _mockTransferFail(alice);
        split.executeSplit();

        // Verify alice has unclaimed
        assertEq(split.totalUnclaimed(), 495e6);

        // Fund more and execute again WITHOUT clearing mock
        // This tests that the retry also emits TransferFailed
        _fundSplit(address(split), 1000e6);

        vm.expectEmit(true, true, true, true);
        emit SplitConfigImpl.TransferFailed(alice, 495e6, false); // Retry failure

        split.executeSplit();

        // Alice's unclaimed should now be doubled (old 495 + new 495)
        assertEq(split.totalUnclaimed(), 990e6);
    }

    function test_RetryPhase_ProtocolFeeEmitsTransferFailedOnPersistentFailure() public {
        _fundSplit(address(split), 1000e6);

        // First execution: feeWallet fails
        _mockTransferFail(feeWallet);
        split.executeSplit();

        // Verify protocol has unclaimed
        assertEq(split.totalUnclaimed(), 10e6);

        // Execute again WITHOUT clearing mock - retry should emit TransferFailed
        vm.expectEmit(true, true, true, true);
        emit SplitConfigImpl.TransferFailed(feeWallet, 10e6, true); // isProtocol = true

        split.executeSplit();
    }

    // =========================================================================
    // Dust & Small Amount Tests
    // =========================================================================

    function test_Dust_VerySmallAmount_AllToProtocol() public {
        // Test spec example: 4 wei split among recipients at 49.5% each
        // floor(4 * 4950 / 10000) = floor(1.98) = 1 each
        // Recipients: 1 + 1 = 2, Protocol: 4 - 2 = 2

        _fundSplit(address(split), 4);
        split.executeSplit();

        assertEq(_balance(alice), 1); // floor(4 * 4950 / 10000) = 1
        assertEq(_balance(bob), 1); // floor(4 * 4950 / 10000) = 1
        assertEq(_balance(feeWallet), 2); // remainder
    }

    function test_Dust_TinyAmountZeroToRecipients() public {
        // 1 wei: floor(1 * 4950 / 10000) = 0 for each recipient
        // Protocol gets entire amount

        _fundSplit(address(split), 1);
        split.executeSplit();

        assertEq(_balance(alice), 0);
        assertEq(_balance(bob), 0);
        assertEq(_balance(feeWallet), 1);
    }

    function test_Dust_ManyRecipientsSmallAmount() public {
        // Create split with 5 recipients at 19.8% each = 99%
        Recipient[] memory recipients = new Recipient[](5);
        for (uint160 i; i < 5; i++) {
            recipients[i] = Recipient({addr: address(0x2000 + i), percentageBps: 1980}); // 19.8%
        }
        bytes32 uniqueId = keccak256("dust-many-recipients");
        address splitAddr = factory.createSplitConfig(alice, address(token), uniqueId, recipients);

        // 4 wei among 5 recipients: floor(4 * 1980 / 10000) = 0 each
        token.mint(splitAddr, 4);
        SplitConfigImpl(splitAddr).executeSplit();

        // All recipients get 0, protocol gets all 4
        for (uint160 i; i < 5; i++) {
            assertEq(_balance(address(0x2000 + i)), 0);
        }
        assertEq(_balance(feeWallet), 4);
    }

    function testFuzz_Dust_ProtocolGetsRemainder(
        uint256 amount
    ) public {
        // For any amount, protocol should get at least 1% (due to remainder calculation)
        amount = bound(amount, 100, 1e24); // At least 100 base units for meaningful test

        _fundSplit(address(split), amount);
        split.executeSplit();

        uint256 aliceShare = _balance(alice);
        uint256 bobShare = _balance(bob);
        uint256 protocolShare = _balance(feeWallet);

        // Total should equal input
        assertEq(aliceShare + bobShare + protocolShare, amount);

        // Protocol should get at least 1% (remainder always >= 1%)
        assertGe(protocolShare, amount / 100);
    }

    // =========================================================================
    // Invariant Tests
    // =========================================================================

    function test_Invariant_BalanceGteUnclaimed() public {
        _fundSplit(address(split), 1000e6);

        // Mock alice's transfer to fail
        _mockTransferFail(alice);
        split.executeSplit();

        // Invariant: balance >= totalUnclaimed
        assertGe(split.getBalance(), split.totalUnclaimed());

        // Add more funds
        _fundSplit(address(split), 500e6);

        // Still holds
        assertGe(split.getBalance(), split.totalUnclaimed());

        // Execute again (retry still fails)
        split.executeSplit();

        // Still holds
        assertGe(split.getBalance(), split.totalUnclaimed());
    }

    function test_Invariant_BitmapSyncWithMapping() public {
        _fundSplit(address(split), 1000e6);

        // Mock alice's transfer to fail
        _mockTransferFail(alice);
        split.executeSplit();

        // Unclaimed should be > 0
        uint256 unclaimed = split.totalUnclaimed();
        assertGt(unclaimed, 0);

        // Clear mock and retry
        _clearMocks();
        split.executeSplit();

        // After clearing, unclaimed should be 0
        assertEq(split.totalUnclaimed(), 0);
    }

    function testFuzz_Invariant_RecipientsSum99Percent(
        uint8 recipientCount,
        uint256 seed
    ) public {
        recipientCount = uint8(bound(recipientCount, 1, 20));

        // Generate random recipients that sum to 9900
        Recipient[] memory recipients = new Recipient[](recipientCount);
        uint256 remaining = 9900;

        for (uint256 i; i < recipientCount; i++) {
            // forge-lint: disable-next-line(unsafe-typecast)
            address addr = address(uint160(uint256(keccak256(abi.encode(seed, i, "addr")))));
            vm.assume(addr != address(0));

            uint16 bps;
            if (i == recipientCount - 1) {
                // forge-lint: disable-next-line(unsafe-typecast)
                bps = uint16(remaining); // Safe: remaining starts at 9900 and only decreases
            } else {
                uint256 maxBps = remaining - (recipientCount - i - 1);
                // forge-lint: disable-next-line(unsafe-typecast)
                bps = uint16(bound(uint256(keccak256(abi.encode(seed, i, "bps"))), 1, maxBps));
                remaining -= bps;
            }
            recipients[i] = Recipient({addr: addr, percentageBps: bps});
        }

        bytes32 uniqueId = keccak256(abi.encode(seed, "invariant-test"));
        address splitAddr = factory.createSplitConfig(alice, address(token), uniqueId, recipients);
        SplitConfigImpl testSplit = SplitConfigImpl(splitAddr);

        // Verify invariant: recipients sum to 9900
        Recipient[] memory stored = testSplit.getRecipients();
        uint256 total;
        for (uint256 i; i < stored.length; i++) {
            total += stored[i].percentageBps;
        }
        assertEq(total, 9900);
    }

    // =========================================================================
    // Reentrancy Protection Tests
    // =========================================================================

    function test_Reentrancy_ExecuteSplitBlocked() public {
        // Deploy malicious token that attempts reentrancy
        ReentrantToken maliciousToken = new ReentrantToken();

        // Create split with malicious token
        Recipient[] memory recipients = _twoRecipients();
        bytes32 uniqueId = keccak256("reentrancy-test");

        // Deploy new factory with implementation for this token
        SplitFactory testFactory = new SplitFactory(address(implementation), feeWallet);
        address splitAddr = testFactory.createSplitConfig(alice, address(maliciousToken), uniqueId, recipients);
        SplitConfigImpl reentrantSplit = SplitConfigImpl(splitAddr);

        // Configure malicious token to attempt reentrancy
        maliciousToken.setSplitToAttack(splitAddr);
        maliciousToken.mint(splitAddr, 1000e18);

        // Execute should complete without reentrancy succeeding
        // The reentrancy guard uses Solady's selector 0xab143c06
        reentrantSplit.executeSplit();

        // Verify the attack was blocked - check that reentrancy attempt counter is > 0
        // but funds were only distributed once
        assertGt(maliciousToken.reentrancyAttempts(), 0, "Attack should have been attempted");

        // Balance should be 0 after successful execution (not doubled/tripled from reentrancy)
        assertEq(maliciousToken.balanceOf(splitAddr), 0, "Split should be empty");
    }
}

/// @notice Malicious ERC20 that attempts reentrancy during transfer
contract ReentrantToken {
    mapping(address => uint256) public balanceOf;
    address public splitToAttack;
    uint256 public reentrancyAttempts;

    function setSplitToAttack(
        address split
    ) external {
        splitToAttack = split;
    }

    function mint(
        address to,
        uint256 amount
    ) external {
        balanceOf[to] += amount;
    }

    function transfer(
        address to,
        uint256 amount
    ) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;

        // Attempt reentrancy when called from the split
        if (msg.sender == splitToAttack && splitToAttack != address(0)) {
            reentrancyAttempts++;
            // Try to re-enter executeSplit - should fail silently due to reentrancy guard
            try SplitConfigImpl(splitToAttack).executeSplit() {
                // If we get here, reentrancy protection failed!
                revert("Reentrancy attack succeeded - this should not happen");
            } catch {
                // Expected: reentrancy guard blocks the call
            }
        }

        return true;
    }
}

/// @notice Token mock that returns invalid (too short) data from balanceOf
contract InvalidBalanceOfToken {
    // Returns only 16 bytes instead of 32 - triggers data.length < 32 check
    fallback() external {
        // Return exactly 16 bytes (less than the required 32 for uint256)
        assembly {
            mstore(0x00, 0x00000000000000000000000000001000)
            return(0x10, 0x10) // Return 16 bytes starting at offset 0x10
        }
    }
}
