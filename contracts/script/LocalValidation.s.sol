// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.30;

import {SplitConfigImpl} from "../src/SplitConfigImpl.sol";
import {SplitFactory} from "../src/SplitFactory.sol";
import {Recipient} from "../src/Types.sol";
import {Script, console} from "forge-std/Script.sol";
import {MockERC20} from "solady/../test/utils/mocks/MockERC20.sol";

/// @title LocalValidation
/// @notice Comprehensive local net validation script
contract LocalValidation is Script {
    // Contracts
    SplitConfigImpl public implementation;
    SplitFactory public factory;
    MockERC20 public usdc;

    // Addresses
    address public deployer;
    address public alice;
    address public bob;
    address public charlie;

    // Constants
    uint256 constant AMOUNT = 1000e6; // 1000 USDC

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        deployer = vm.addr(deployerKey);
        alice = address(0xA11CE);
        bob = address(0xB0B);
        charlie = address(0xC4A711E);

        console.log("=== LOCAL VALIDATION TEST SUITE ===");
        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerKey);

        // Phase 1: Deploy all contracts
        _phase1Deploy();

        // Phase 2: Factory functions
        _phase2FactoryFunctions();

        // Phase 3: Clone view functions
        _phase3CloneViewFunctions();

        // Phase 4: E2E execution
        _phase4E2eExecution();

        // Phase 5: Edge cases
        _phase5EdgeCases();

        vm.stopBroadcast();

        console.log("\n=== ALL TESTS PASSED ===");
    }

    function _phase1Deploy() internal {
        console.log("\n--- Phase 1: Deployment ---");

        // Deploy mock USDC
        usdc = new MockERC20("USD Coin", "USDC", 6);
        console.log("MockERC20 (USDC):", address(usdc));

        // Deploy implementation
        implementation = new SplitConfigImpl();
        console.log("SplitConfigImpl:", address(implementation));

        // Deploy factory
        factory = new SplitFactory(address(implementation), deployer);
        console.log("SplitFactory:", address(factory));

        // Verify factory state
        require(factory.authority() == deployer, "Authority mismatch");
        require(factory.feeWallet() == deployer, "FeeWallet mismatch");
        require(factory.currentImplementation() == address(implementation), "Impl mismatch");
        require(factory.INITIAL_IMPLEMENTATION() == address(implementation), "Initial impl mismatch");

        console.log("[OK] Phase 1: All deployments verified");
    }

    function _phase2FactoryFunctions() internal {
        console.log("\n--- Phase 2: Factory Functions ---");

        // 2.1 Test predictSplitAddress
        Recipient[] memory recipients = new Recipient[](2);
        recipients[0] = Recipient({addr: alice, percentageBps: 4950});
        recipients[1] = Recipient({addr: bob, percentageBps: 4950});
        bytes32 uniqueId = keccak256("test-split-1");

        address predicted = factory.predictSplitAddress(deployer, address(usdc), uniqueId, recipients);
        console.log("Predicted address:", predicted);

        // 2.2 Create split
        address split = factory.createSplitConfig(deployer, address(usdc), uniqueId, recipients);
        console.log("Actual address:", split);
        require(split == predicted, "Address prediction failed");
        console.log("[OK] Address prediction matches");

        // 2.3 Test duplicate rejection
        bool duplicateReverted = false;
        try factory.createSplitConfig(deployer, address(usdc), uniqueId, recipients) {
        // Should not reach here
        }
        catch {
            duplicateReverted = true;
        }
        require(duplicateReverted, "Duplicate should revert");
        console.log("[OK] Duplicate rejection works");

        // 2.4 Test updateProtocolConfig
        address newFeeWallet = address(0xFEE);
        factory.updateProtocolConfig(newFeeWallet);
        require(factory.feeWallet() == newFeeWallet, "FeeWallet update failed");
        console.log("[OK] FeeWallet updated to:", newFeeWallet);

        // Restore fee wallet for later tests
        factory.updateProtocolConfig(deployer);

        // 2.5 Test upgradeImplementation
        SplitConfigImpl newImpl = new SplitConfigImpl();
        factory.upgradeImplementation(address(newImpl));
        require(factory.currentImplementation() == address(newImpl), "Impl upgrade failed");
        require(factory.INITIAL_IMPLEMENTATION() == address(implementation), "Initial should not change");
        console.log("[OK] Implementation upgraded");

        // Restore original impl
        factory.upgradeImplementation(address(implementation));

        // 2.6-2.7 Test authority transfer
        address newAuthority = address(0x1234);
        factory.transferProtocolAuthority(newAuthority);
        require(factory.pendingAuthority() == newAuthority, "Pending authority not set");
        console.log("[OK] Authority transfer initiated");

        // Cancel by setting to zero
        factory.transferProtocolAuthority(address(0));
        require(factory.pendingAuthority() == address(0), "Cancel failed");
        console.log("[OK] Authority transfer cancelled");

        console.log("[OK] Phase 2: All factory functions verified");
    }

    function _phase3CloneViewFunctions() internal {
        console.log("\n--- Phase 3: Clone View Functions ---");

        // Create a fresh split for testing
        Recipient[] memory recipients = new Recipient[](2);
        recipients[0] = Recipient({addr: alice, percentageBps: 4950});
        recipients[1] = Recipient({addr: bob, percentageBps: 4950});
        bytes32 uniqueId = keccak256("test-split-view");

        address splitAddr = factory.createSplitConfig(deployer, address(usdc), uniqueId, recipients);
        SplitConfigImpl split = SplitConfigImpl(splitAddr);
        console.log("Split created at:", splitAddr);

        // 3.1 isCascadeSplitConfig
        require(split.isCascadeSplitConfig(), "Not a cascade split");
        console.log("[OK] isCascadeSplitConfig() = true");

        // 3.2 factory()
        require(split.factory() == address(factory), "Factory mismatch");
        console.log("[OK] factory() matches");

        // 3.3 authority()
        require(split.authority() == deployer, "Authority mismatch");
        console.log("[OK] authority() matches");

        // 3.4 token()
        require(split.token() == address(usdc), "Token mismatch");
        console.log("[OK] token() matches");

        // 3.5 uniqueId()
        require(split.uniqueId() == uniqueId, "UniqueId mismatch");
        console.log("[OK] uniqueId() matches");

        // 3.6 getRecipientCount()
        require(split.getRecipientCount() == 2, "Recipient count mismatch");
        console.log("[OK] getRecipientCount() = 2");

        // 3.7 getRecipients()
        Recipient[] memory stored = split.getRecipients();
        require(stored.length == 2, "Recipients length mismatch");
        require(stored[0].addr == alice, "Recipient 0 addr mismatch");
        require(stored[0].percentageBps == 4950, "Recipient 0 bps mismatch");
        require(stored[1].addr == bob, "Recipient 1 addr mismatch");
        require(stored[1].percentageBps == 4950, "Recipient 1 bps mismatch");
        console.log("[OK] getRecipients() matches");

        // 3.8 Balance functions (should be 0)
        require(split.getBalance() == 0, "Balance should be 0");
        require(split.pendingAmount() == 0, "Pending should be 0");
        require(split.totalUnclaimed() == 0, "Unclaimed should be 0");
        require(!split.hasPendingFunds(), "Should not have pending funds");
        console.log("[OK] Balance functions return 0");

        console.log("[OK] Phase 3: All clone view functions verified");
    }

    function _phase4E2eExecution() internal {
        console.log("\n--- Phase 4: E2E Execution ---");

        // Create split
        Recipient[] memory recipients = new Recipient[](2);
        recipients[0] = Recipient({addr: alice, percentageBps: 4950});
        recipients[1] = Recipient({addr: bob, percentageBps: 4950});
        bytes32 uniqueId = keccak256("test-split-e2e");

        address splitAddr = factory.createSplitConfig(deployer, address(usdc), uniqueId, recipients);
        SplitConfigImpl split = SplitConfigImpl(splitAddr);
        console.log("E2E Split:", splitAddr);

        // 4.1-4.2 Fund split
        usdc.mint(splitAddr, AMOUNT);
        console.log("[OK] Minted", AMOUNT / 1e6, "USDC to split");

        // 4.3 getBalance
        require(split.getBalance() == AMOUNT, "Balance mismatch");
        console.log("[OK] getBalance() =", split.getBalance() / 1e6, "USDC");

        // 4.4 hasPendingFunds
        require(split.hasPendingFunds(), "Should have pending funds");
        console.log("[OK] hasPendingFunds() = true");

        // 4.5 pendingAmount
        require(split.pendingAmount() == AMOUNT, "Pending mismatch");
        console.log("[OK] pendingAmount() =", split.pendingAmount() / 1e6, "USDC");

        // 4.6 previewExecution
        (
            uint256[] memory amounts,
            uint256 protocolFee,
            uint256 available,
            uint256[] memory pendingRecipient,
            uint256 pendingProtocol
        ) = split.previewExecution();

        require(available == AMOUNT, "Available mismatch");
        require(amounts[0] == 495e6, "Alice amount mismatch");
        require(amounts[1] == 495e6, "Bob amount mismatch");
        require(protocolFee == 10e6, "Protocol fee mismatch");
        require(pendingRecipient[0] == 0, "Pending recipient 0 should be 0");
        require(pendingProtocol == 0, "Pending protocol should be 0");
        console.log("[OK] previewExecution() correct: Alice=495, Bob=495, Fee=10");

        // Record balances before
        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256 bobBefore = usdc.balanceOf(bob);
        uint256 feeWalletBefore = usdc.balanceOf(deployer);

        // 4.7 executeSplit
        split.executeSplit();
        console.log("[OK] executeSplit() succeeded");

        // 4.8 Verify balances
        require(usdc.balanceOf(alice) - aliceBefore == 495e6, "Alice balance wrong");
        require(usdc.balanceOf(bob) - bobBefore == 495e6, "Bob balance wrong");
        require(usdc.balanceOf(deployer) - feeWalletBefore == 10e6, "FeeWallet balance wrong");
        console.log("[OK] Balances verified: Alice +495, Bob +495, Fee +10");

        // 4.9-4.10 Post-execution state
        require(split.getBalance() == 0, "Balance should be 0 after");
        require(split.totalUnclaimed() == 0, "Unclaimed should be 0 after");
        console.log("[OK] Split emptied completely");

        console.log("[OK] Phase 4: E2E execution verified");
    }

    function _phase5EdgeCases() internal {
        console.log("\n--- Phase 5: Edge Cases ---");

        // 5.1 Execute with 0 balance
        Recipient[] memory recipients = new Recipient[](2);
        recipients[0] = Recipient({addr: alice, percentageBps: 4950});
        recipients[1] = Recipient({addr: bob, percentageBps: 4950});
        bytes32 uniqueId = keccak256("test-split-edge-zero");

        address splitAddr = factory.createSplitConfig(deployer, address(usdc), uniqueId, recipients);
        SplitConfigImpl split = SplitConfigImpl(splitAddr);

        // Execute with 0 balance - should succeed
        split.executeSplit();
        console.log("[OK] Execute with 0 balance succeeds");

        // 5.2 Max recipients (20)
        Recipient[] memory maxRecipients = new Recipient[](20);
        for (uint160 i = 0; i < 20; i++) {
            maxRecipients[i] = Recipient({addr: address(0x1000 + i), percentageBps: 495});
        }
        bytes32 maxId = keccak256("test-split-max");
        address maxSplit = factory.createSplitConfig(deployer, address(usdc), maxId, maxRecipients);
        SplitConfigImpl maxConfig = SplitConfigImpl(maxSplit);

        require(maxConfig.getRecipientCount() == 20, "Max recipients count wrong");
        console.log("[OK] Max recipients (20) works");

        // Fund and execute max split
        usdc.mint(maxSplit, AMOUNT);
        maxConfig.executeSplit();
        require(maxConfig.getBalance() == 0, "Max split not emptied");
        console.log("[OK] Max split execution works");

        // 5.3 Execute twice in a row
        bytes32 twiceId = keccak256("test-split-twice");
        address twiceSplit = factory.createSplitConfig(deployer, address(usdc), twiceId, recipients);
        SplitConfigImpl twiceConfig = SplitConfigImpl(twiceSplit);

        usdc.mint(twiceSplit, 100e6);
        twiceConfig.executeSplit();
        usdc.mint(twiceSplit, 200e6);
        twiceConfig.executeSplit();
        require(twiceConfig.getBalance() == 0, "Twice split not emptied");
        console.log("[OK] Double execution works");

        console.log("[OK] Phase 5: Edge cases verified");
    }
}
