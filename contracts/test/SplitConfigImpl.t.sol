// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.30;

import {SplitConfigImpl} from "../src/SplitConfigImpl.sol";
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
        for (uint256 i; i < 20; i++) {
            assertEq(_balance(address(uint160(0x1000 + i))), 495e6);
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

    function testFuzz_ExecuteSplit_AnyAmount(uint256 amount) public {
        amount = bound(amount, 1, 1e24); // 1 wei to 1M tokens

        _fundSplit(address(split), amount);
        split.executeSplit();

        // Verify all funds distributed (allowing for rounding)
        uint256 totalDistributed = _balance(alice) + _balance(bob) + _balance(feeWallet);
        assertEq(totalDistributed, amount);
    }

    function testFuzz_ExecuteSplit_MultipleDeposits(uint256 amount1, uint256 amount2) public {
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
}
