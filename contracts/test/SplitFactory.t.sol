// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.30;

import {
    DuplicateRecipient,
    InvalidImplementation,
    InvalidRecipientCount,
    InvalidSplitTotal,
    NoPendingTransfer,
    SplitAlreadyExists,
    Unauthorized,
    ZeroAddress,
    ZeroPercentage
} from "../src/Errors.sol";
import {SplitConfigImpl} from "../src/SplitConfigImpl.sol";
import {SplitFactory} from "../src/SplitFactory.sol";
import {Recipient} from "../src/Types.sol";
import {BaseTest} from "./Base.t.sol";

contract SplitFactoryTest is BaseTest {
    // =========================================================================
    // Constructor Tests
    // =========================================================================

    function test_Constructor_SetsInitialValues() public view {
        assertEq(factory.authority(), protocolAuthority);
        assertEq(factory.feeWallet(), feeWallet);
        assertEq(factory.initialImplementation(), address(implementation));
        assertEq(factory.currentImplementation(), address(implementation));
        assertEq(factory.pendingAuthority(), address(0));
    }

    function test_Constructor_EmitsEvent() public {
        vm.expectEmit(true, true, false, false);
        emit SplitFactory.ProtocolConfigCreated(address(this), feeWallet);
        new SplitFactory(address(implementation), feeWallet);
    }

    function test_Constructor_RevertsOnZeroImplementation() public {
        vm.expectRevert(abi.encodeWithSelector(ZeroAddress.selector, 0));
        new SplitFactory(address(0), feeWallet);
    }

    function test_Constructor_RevertsOnZeroFeeWallet() public {
        vm.expectRevert(abi.encodeWithSelector(ZeroAddress.selector, 1));
        new SplitFactory(address(implementation), address(0));
    }

    function test_Constructor_RevertsOnNoCodeImplementation() public {
        // Create an address with no code (just an EOA)
        address noCodeAddr = makeAddr("noCodeImplementation");

        vm.expectRevert(abi.encodeWithSelector(InvalidImplementation.selector, noCodeAddr));
        new SplitFactory(noCodeAddr, feeWallet);
    }

    // =========================================================================
    // createSplitConfig Tests
    // =========================================================================

    function test_CreateSplitConfig_DeploysClone() public {
        Recipient[] memory recipients = _twoRecipients();
        bytes32 uniqueId = keccak256("test-split-1");

        address split = factory.createSplitConfig(alice, address(token), uniqueId, recipients);

        // Verify clone is deployed
        assertTrue(split != address(0));
        assertTrue(split.code.length > 0);

        // Verify it's a Cascade split
        SplitConfigImpl splitConfig = SplitConfigImpl(split);
        assertTrue(splitConfig.isCascadeSplitConfig());
    }

    function test_CreateSplitConfig_SetsImmutableArgs() public {
        Recipient[] memory recipients = _twoRecipients();
        bytes32 uniqueId = keccak256("test-split-2");

        address split = factory.createSplitConfig(alice, address(token), uniqueId, recipients);
        SplitConfigImpl splitConfig = SplitConfigImpl(split);

        // Verify immutable args
        assertEq(splitConfig.factory(), address(factory));
        assertEq(splitConfig.authority(), alice);
        assertEq(splitConfig.token(), address(token));
        assertEq(splitConfig.uniqueId(), uniqueId);

        // Verify recipients
        Recipient[] memory storedRecipients = splitConfig.getRecipients();
        assertEq(storedRecipients.length, 2);
        assertEq(storedRecipients[0].addr, recipients[0].addr);
        assertEq(storedRecipients[0].percentageBps, recipients[0].percentageBps);
        assertEq(storedRecipients[1].addr, recipients[1].addr);
        assertEq(storedRecipients[1].percentageBps, recipients[1].percentageBps);
    }

    function test_CreateSplitConfig_EmitsEvent() public {
        Recipient[] memory recipients = _twoRecipients();
        bytes32 uniqueId = keccak256("test-split-3");

        // Predict the split address first
        address predictedSplit = factory.predictSplitAddress(alice, address(token), uniqueId, recipients);

        vm.expectEmit(true, true, true, true);
        emit SplitFactory.SplitConfigCreated(predictedSplit, alice, address(token), uniqueId, recipients);

        factory.createSplitConfig(alice, address(token), uniqueId, recipients);
    }

    function test_CreateSplitConfig_DeterministicAddress() public {
        Recipient[] memory recipients = _twoRecipients();
        bytes32 uniqueId = keccak256("test-split-4");

        address predicted = factory.predictSplitAddress(alice, address(token), uniqueId, recipients);
        address actual = factory.createSplitConfig(alice, address(token), uniqueId, recipients);

        assertEq(predicted, actual);
    }

    function test_CreateSplitConfig_RevertsOnZeroRecipients() public {
        Recipient[] memory recipients = new Recipient[](0);
        bytes32 uniqueId = keccak256("test-split-5");

        vm.expectRevert(abi.encodeWithSelector(InvalidRecipientCount.selector, 0, 1, 20));
        factory.createSplitConfig(alice, address(token), uniqueId, recipients);
    }

    function test_CreateSplitConfig_RevertsOnTooManyRecipients() public {
        Recipient[] memory recipients = new Recipient[](21);
        for (uint256 i; i < 21; i++) {
            recipients[i] = Recipient(address(uint160(0x1000 + i)), 471); // ~4.71% each
        }
        bytes32 uniqueId = keccak256("test-split-6");

        vm.expectRevert(abi.encodeWithSelector(InvalidRecipientCount.selector, 21, 1, 20));
        factory.createSplitConfig(alice, address(token), uniqueId, recipients);
    }

    function test_CreateSplitConfig_RevertsOnInvalidTotal() public {
        Recipient[] memory recipients = new Recipient[](2);
        recipients[0] = Recipient(alice, 5000); // 50%
        recipients[1] = Recipient(bob, 5000); // 50% = 100% total (should be 99%)
        bytes32 uniqueId = keccak256("test-split-7");

        vm.expectRevert(abi.encodeWithSelector(InvalidSplitTotal.selector, 10_000, 9900));
        factory.createSplitConfig(alice, address(token), uniqueId, recipients);
    }

    function test_CreateSplitConfig_RevertsOnDuplicateRecipient() public {
        Recipient[] memory recipients = new Recipient[](2);
        recipients[0] = Recipient(alice, 4950);
        recipients[1] = Recipient(alice, 4950); // Duplicate!
        bytes32 uniqueId = keccak256("test-split-8");

        vm.expectRevert(abi.encodeWithSelector(DuplicateRecipient.selector, alice, 0, 1));
        factory.createSplitConfig(alice, address(token), uniqueId, recipients);
    }

    function test_CreateSplitConfig_RevertsOnZeroAddress() public {
        Recipient[] memory recipients = new Recipient[](2);
        recipients[0] = Recipient(address(0), 4950); // Zero address!
        recipients[1] = Recipient(bob, 4950);
        bytes32 uniqueId = keccak256("test-split-9");

        vm.expectRevert(abi.encodeWithSelector(ZeroAddress.selector, 0));
        factory.createSplitConfig(alice, address(token), uniqueId, recipients);
    }

    function test_CreateSplitConfig_RevertsOnZeroPercentage() public {
        Recipient[] memory recipients = new Recipient[](2);
        recipients[0] = Recipient(alice, 0); // Zero percentage!
        recipients[1] = Recipient(bob, 9900);
        bytes32 uniqueId = keccak256("test-split-10");

        vm.expectRevert(abi.encodeWithSelector(ZeroPercentage.selector, 0));
        factory.createSplitConfig(alice, address(token), uniqueId, recipients);
    }

    function test_CreateSplitConfig_RevertsOnZeroToken() public {
        Recipient[] memory recipients = _twoRecipients();
        bytes32 uniqueId = keccak256("test-split-11");

        vm.expectRevert(abi.encodeWithSelector(ZeroAddress.selector, 0));
        factory.createSplitConfig(alice, address(0), uniqueId, recipients);
    }

    function test_CreateSplitConfig_RevertsOnDuplicate() public {
        Recipient[] memory recipients = _twoRecipients();
        bytes32 uniqueId = keccak256("test-split-12");

        // First creation succeeds
        address split = factory.createSplitConfig(alice, address(token), uniqueId, recipients);

        // Second creation with same params fails
        vm.expectRevert(abi.encodeWithSelector(SplitAlreadyExists.selector, split));
        factory.createSplitConfig(alice, address(token), uniqueId, recipients);
    }

    function test_CreateSplitConfig_AllowsDifferentUniqueId() public {
        Recipient[] memory recipients = _twoRecipients();

        address split1 = factory.createSplitConfig(alice, address(token), keccak256("id-1"), recipients);
        address split2 = factory.createSplitConfig(alice, address(token), keccak256("id-2"), recipients);

        assertTrue(split1 != split2);
    }

    function test_CreateSplitConfig_SingleRecipient() public {
        Recipient[] memory recipients = _singleRecipient();
        bytes32 uniqueId = keccak256("test-split-single");

        address split = factory.createSplitConfig(alice, address(token), uniqueId, recipients);
        SplitConfigImpl splitConfig = SplitConfigImpl(split);

        assertEq(splitConfig.getRecipientCount(), 1);
    }

    function test_CreateSplitConfig_MaxRecipients() public {
        Recipient[] memory recipients = _maxRecipients();
        bytes32 uniqueId = keccak256("test-split-max");

        address split = factory.createSplitConfig(alice, address(token), uniqueId, recipients);
        SplitConfigImpl splitConfig = SplitConfigImpl(split);

        assertEq(splitConfig.getRecipientCount(), 20);
    }

    // =========================================================================
    // updateProtocolConfig Tests
    // =========================================================================

    function test_UpdateProtocolConfig_UpdatesFeeWallet() public {
        address newFeeWallet = makeAddr("newFeeWallet");

        vm.prank(protocolAuthority);
        factory.updateProtocolConfig(newFeeWallet);

        assertEq(factory.feeWallet(), newFeeWallet);
    }

    function test_UpdateProtocolConfig_EmitsEvent() public {
        address newFeeWallet = makeAddr("newFeeWallet");

        vm.expectEmit(true, true, false, false);
        emit SplitFactory.ProtocolConfigUpdated(feeWallet, newFeeWallet);

        vm.prank(protocolAuthority);
        factory.updateProtocolConfig(newFeeWallet);
    }

    function test_UpdateProtocolConfig_RevertsOnUnauthorized() public {
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, alice, protocolAuthority));
        vm.prank(alice);
        factory.updateProtocolConfig(alice);
    }

    function test_UpdateProtocolConfig_RevertsOnZeroAddress() public {
        vm.expectRevert(abi.encodeWithSelector(ZeroAddress.selector, 0));
        vm.prank(protocolAuthority);
        factory.updateProtocolConfig(address(0));
    }

    // =========================================================================
    // Authority Transfer Tests
    // =========================================================================

    function test_TransferProtocolAuthority_SetsPending() public {
        vm.prank(protocolAuthority);
        factory.transferProtocolAuthority(alice);

        assertEq(factory.pendingAuthority(), alice);
    }

    function test_AcceptProtocolAuthority_TransfersAuthority() public {
        vm.prank(protocolAuthority);
        factory.transferProtocolAuthority(alice);

        vm.prank(alice);
        factory.acceptProtocolAuthority();

        assertEq(factory.authority(), alice);
        assertEq(factory.pendingAuthority(), address(0));
    }

    function test_AcceptProtocolAuthority_RevertsOnUnauthorized() public {
        vm.prank(protocolAuthority);
        factory.transferProtocolAuthority(alice);

        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, bob, alice));
        vm.prank(bob);
        factory.acceptProtocolAuthority();
    }

    function test_AcceptProtocolAuthority_RevertsOnNoPending() public {
        vm.expectRevert(NoPendingTransfer.selector);
        vm.prank(alice);
        factory.acceptProtocolAuthority();
    }

    function test_TransferProtocolAuthority_EmitsEvent() public {
        vm.expectEmit(true, true, false, false);
        emit SplitFactory.ProtocolAuthorityTransferProposed(protocolAuthority, alice);

        vm.prank(protocolAuthority);
        factory.transferProtocolAuthority(alice);
    }

    function test_AcceptProtocolAuthority_EmitsEvent() public {
        vm.prank(protocolAuthority);
        factory.transferProtocolAuthority(alice);

        vm.expectEmit(true, true, false, false);
        emit SplitFactory.ProtocolAuthorityTransferAccepted(protocolAuthority, alice);

        vm.prank(alice);
        factory.acceptProtocolAuthority();
    }

    function test_TransferProtocolAuthority_CanOverwrite() public {
        vm.prank(protocolAuthority);
        factory.transferProtocolAuthority(alice);
        assertEq(factory.pendingAuthority(), alice);

        vm.prank(protocolAuthority);
        factory.transferProtocolAuthority(bob);
        assertEq(factory.pendingAuthority(), bob);
    }

    function test_TransferProtocolAuthority_RevertsOnUnauthorized() public {
        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, alice, protocolAuthority));
        vm.prank(alice);
        factory.transferProtocolAuthority(bob);
    }

    function test_TransferProtocolAuthority_CancelBySettingZero() public {
        // Initiate transfer
        vm.prank(protocolAuthority);
        factory.transferProtocolAuthority(alice);
        assertEq(factory.pendingAuthority(), alice);

        // Cancel by setting to address(0)
        vm.prank(protocolAuthority);
        factory.transferProtocolAuthority(address(0));
        assertEq(factory.pendingAuthority(), address(0));

        // Now alice cannot accept
        vm.expectRevert(NoPendingTransfer.selector);
        vm.prank(alice);
        factory.acceptProtocolAuthority();

        // Authority remains unchanged
        assertEq(factory.authority(), protocolAuthority);
    }

    // =========================================================================
    // Implementation Upgrade Tests
    // =========================================================================

    function test_UpgradeImplementation_Updates() public {
        SplitConfigImpl newImpl = new SplitConfigImpl();

        vm.prank(protocolAuthority);
        factory.upgradeImplementation(address(newImpl));

        assertEq(factory.currentImplementation(), address(newImpl));
        // Initial implementation remains unchanged
        assertEq(factory.initialImplementation(), address(implementation));
    }

    function test_UpgradeImplementation_EmitsEvent() public {
        SplitConfigImpl newImpl = new SplitConfigImpl();

        vm.expectEmit(true, true, false, false);
        emit SplitFactory.ImplementationUpgraded(address(implementation), address(newImpl));

        vm.prank(protocolAuthority);
        factory.upgradeImplementation(address(newImpl));
    }

    function test_UpgradeImplementation_RevertsOnUnauthorized() public {
        SplitConfigImpl newImpl = new SplitConfigImpl();

        vm.expectRevert(abi.encodeWithSelector(Unauthorized.selector, alice, protocolAuthority));
        vm.prank(alice);
        factory.upgradeImplementation(address(newImpl));
    }

    function test_UpgradeImplementation_RevertsOnZeroAddress() public {
        vm.expectRevert(abi.encodeWithSelector(ZeroAddress.selector, 0));
        vm.prank(protocolAuthority);
        factory.upgradeImplementation(address(0));
    }

    function test_UpgradeImplementation_RevertsOnNoCode() public {
        address noCode = makeAddr("noCode");

        vm.expectRevert(abi.encodeWithSelector(InvalidImplementation.selector, noCode));
        vm.prank(protocolAuthority);
        factory.upgradeImplementation(noCode);
    }

    function test_UpgradeImplementation_NewSplitsUseNewImpl() public {
        // Deploy new implementation
        SplitConfigImpl newImpl = new SplitConfigImpl();

        // Upgrade factory
        vm.prank(protocolAuthority);
        factory.upgradeImplementation(address(newImpl));

        // Create split with new implementation
        Recipient[] memory recipients = _twoRecipients();
        address split = factory.createSplitConfig(alice, address(token), keccak256("new-impl"), recipients);

        // Verify split works
        SplitConfigImpl splitConfig = SplitConfigImpl(split);
        assertTrue(splitConfig.isCascadeSplitConfig());
        assertEq(splitConfig.getRecipientCount(), 2);
    }

    function test_UpgradeImplementation_OldSplitsStillWork() public {
        // Create split with initial implementation
        Recipient[] memory recipients = _twoRecipients();
        address oldSplit = factory.createSplitConfig(alice, address(token), keccak256("old-impl"), recipients);

        // Upgrade factory
        SplitConfigImpl newImpl = new SplitConfigImpl();
        vm.prank(protocolAuthority);
        factory.upgradeImplementation(address(newImpl));

        // Old split still works
        SplitConfigImpl splitConfig = SplitConfigImpl(oldSplit);
        assertTrue(splitConfig.isCascadeSplitConfig());

        // Fund and execute
        token.mint(oldSplit, 1000e6);
        splitConfig.executeSplit();
        assertEq(token.balanceOf(alice), 495e6);
    }

    // =========================================================================
    // Fuzz Tests
    // =========================================================================

    function testFuzz_UpdateProtocolConfig(address newFeeWallet) public {
        vm.assume(newFeeWallet != address(0));

        vm.prank(protocolAuthority);
        factory.updateProtocolConfig(newFeeWallet);

        assertEq(factory.feeWallet(), newFeeWallet);
    }

    function testFuzz_CreateSplitConfig_ValidRecipients(uint8 recipientCount, uint256 seed) public {
        recipientCount = uint8(bound(recipientCount, 1, 20));

        // Generate random recipients that sum to 9900
        Recipient[] memory recipients = new Recipient[](recipientCount);
        uint256 remaining = 9900;

        for (uint256 i; i < recipientCount; i++) {
            address addr = address(uint160(uint256(keccak256(abi.encode(seed, i)))));
            vm.assume(addr != address(0));

            uint16 bps;
            if (i == recipientCount - 1) {
                bps = uint16(remaining);
            } else {
                // Random bps between 1 and remaining - (remaining recipients need at least 1 each)
                uint256 maxBps = remaining - (recipientCount - i - 1);
                bps = uint16(bound(uint256(keccak256(abi.encode(seed, i, "bps"))), 1, maxBps));
                remaining -= bps;
            }

            recipients[i] = Recipient(addr, bps);
        }

        bytes32 uniqueId = keccak256(abi.encode(seed, "uniqueId"));

        address split = factory.createSplitConfig(alice, address(token), uniqueId, recipients);
        assertTrue(split != address(0));
    }
}
