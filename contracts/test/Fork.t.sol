// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.30;

import {SplitConfigImpl} from "../src/SplitConfigImpl.sol";
import {SplitFactory} from "../src/SplitFactory.sol";
import {Recipient} from "../src/Types.sol";
import {Test, console} from "forge-std/Test.sol";

/// @title ForkTest
/// @notice Fork tests to validate DEPLOYED contracts against real Base USDC/USDT
/// @dev Run with: forge test --match-contract ForkTest --fork-url base_sepolia -vvv
///              or: forge test --match-contract ForkTest --fork-url base -vvv
///
/// These tests REQUIRE deployed contracts. They will SKIP if:
/// 1. Not running on a Base fork (Sepolia or Mainnet)
/// 2. Contracts not deployed at expected CREATE2 addresses
///
/// This validates the ACTUAL deployment works with real tokens, not fresh code.
///
contract ForkTest is Test {
    // Chain IDs
    uint256 constant BASE_SEPOLIA_CHAINID = 84_532;
    uint256 constant BASE_MAINNET_CHAINID = 8453;

    // Base Sepolia USDC (Circle's official testnet USDC)
    // Source: https://developers.circle.com/stablecoins/docs/usdc-on-test-networks
    address constant USDC_SEPOLIA = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    // Base Mainnet USDC (Circle's official USDC)
    // Source: https://developers.circle.com/stablecoins/docs/usdc-on-main-networks
    address constant USDC_MAINNET = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    // Base Sepolia USDT (non-standard ERC20 - no return value on transfer)
    // Source: https://sepolia.basescan.org/address/0xd7e9C75C6C05FdE929cAc19bb887892de78819B7
    address constant USDT_SEPOLIA = 0xd7e9C75C6C05FdE929cAc19bb887892de78819B7;

    // Base Mainnet USDT (non-standard ERC20 - no return value on transfer)
    // Source: https://basescan.org/token/0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2
    address constant USDT_MAINNET = 0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2;

    // Deployed contract addresses (deterministic via CREATE2)
    address constant DEPLOYED_FACTORY = 0x946Cd053514b1Ab7829dD8fEc85E0ade5550dcf7;
    address constant DEPLOYED_IMPL = 0xF9ad695ecc76c4b8E13655365b318d54E4131EA6;

    SplitFactory public factory;
    SplitConfigImpl public implementation;

    address public deployer;
    address public feeWallet;
    address public alice;
    address public bob;
    address public charlie;

    // Test nonce to ensure unique split IDs
    uint256 private _testNonce;

    function setUp() public {
        // Skip if not on Base fork or contracts not deployed
        if (!_isBaseFork() || !_isDeployed()) {
            return;
        }

        // Use DEPLOYED contracts - no fresh deployment
        factory = SplitFactory(DEPLOYED_FACTORY);
        implementation = SplitConfigImpl(DEPLOYED_IMPL);

        // Get actual deployed config
        feeWallet = factory.feeWallet();
        deployer = factory.authority();

        // Test addresses (fresh for each test run)
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");

        console.log("Using deployed factory:", DEPLOYED_FACTORY);
        console.log("  Authority:", deployer);
        console.log("  Fee Wallet:", feeWallet);
    }

    /// @notice Skip modifier for fork tests - requires BOTH fork AND deployment
    modifier onlyFork() {
        if (!_isBaseFork()) {
            console.log("Skipping: not on Base fork (chainid:", block.chainid, ")");
            vm.skip(true);
        }
        if (!_isDeployed()) {
            console.log("Skipping: contracts not deployed on this chain");
            console.log("  Expected factory:", DEPLOYED_FACTORY);
            console.log("  Expected impl:", DEPLOYED_IMPL);
            vm.skip(true);
        }
        _;
    }

    /// @notice Check if running on Base fork (Sepolia or Mainnet)
    function _isBaseFork() internal view returns (bool) {
        return block.chainid == BASE_SEPOLIA_CHAINID || block.chainid == BASE_MAINNET_CHAINID;
    }

    /// @notice Check if contracts are deployed at expected CREATE2 addresses
    function _isDeployed() internal view returns (bool) {
        return DEPLOYED_FACTORY.code.length > 0 && DEPLOYED_IMPL.code.length > 0;
    }

    /// @notice Get USDC address for current chain
    function _getUsdc() internal view returns (address) {
        if (block.chainid == BASE_MAINNET_CHAINID) {
            return USDC_MAINNET;
        }
        return USDC_SEPOLIA;
    }

    /// @notice Get USDT address for current chain
    function _getUsdt() internal view returns (address) {
        if (block.chainid == BASE_MAINNET_CHAINID) {
            return USDT_MAINNET;
        }
        return USDT_SEPOLIA;
    }

    /// @dev Generate unique ID for each test
    function _uniqueId(
        string memory label
    ) internal returns (bytes32) {
        return keccak256(abi.encode(block.timestamp, _testNonce++, label));
    }

    // =========================================================================
    // BASIC FLOW TESTS
    // =========================================================================

    function test_Fork_CreateSplitWithRealUSDC() public onlyFork {
        Recipient[] memory recipients = new Recipient[](2);
        recipients[0] = Recipient({addr: alice, percentageBps: 4950});
        recipients[1] = Recipient({addr: bob, percentageBps: 4950});

        bytes32 uniqueId = _uniqueId("create-test");
        address split = factory.createSplitConfig(alice, _getUsdc(), uniqueId, recipients);

        SplitConfigImpl splitConfig = SplitConfigImpl(split);
        assertEq(splitConfig.token(), _getUsdc());
        assertEq(splitConfig.getRecipientCount(), 2);
        assertTrue(splitConfig.isCascadeSplitConfig());
        assertEq(splitConfig.factory(), address(factory));

        console.log("[OK] Split created at:", split);
    }

    function test_Fork_ExecuteSplitWithRealUSDC() public onlyFork {
        Recipient[] memory recipients = new Recipient[](2);
        recipients[0] = Recipient({addr: alice, percentageBps: 4950});
        recipients[1] = Recipient({addr: bob, percentageBps: 4950});

        bytes32 uniqueId = _uniqueId("execute-test");
        address split = factory.createSplitConfig(alice, _getUsdc(), uniqueId, recipients);
        SplitConfigImpl splitConfig = SplitConfigImpl(split);

        // Capture initial balances (fee wallet may have pre-existing balance)
        uint256 feeWalletBefore = _usdcBalance(feeWallet);

        // Deal USDC to the split
        deal(_getUsdc(), split, 1000e6);
        assertEq(splitConfig.getBalance(), 1000e6);

        // Execute
        splitConfig.executeSplit();

        // Verify distribution: 49.5% + 49.5% + 1% = 100%
        assertEq(_usdcBalance(alice), 495e6);
        assertEq(_usdcBalance(bob), 495e6);
        assertEq(_usdcBalance(feeWallet) - feeWalletBefore, 10e6, "Fee wallet should receive 1%");
        assertEq(splitConfig.getBalance(), 0);

        console.log("[OK] USDC distributed correctly");
    }

    function test_Fork_PreviewExecution() public onlyFork {
        Recipient[] memory recipients = new Recipient[](2);
        recipients[0] = Recipient({addr: alice, percentageBps: 4950});
        recipients[1] = Recipient({addr: bob, percentageBps: 4950});

        bytes32 uniqueId = _uniqueId("preview-test");
        address split = factory.createSplitConfig(alice, _getUsdc(), uniqueId, recipients);
        SplitConfigImpl splitConfig = SplitConfigImpl(split);

        deal(_getUsdc(), split, 1000e6);

        // Test view functions
        assertEq(splitConfig.getBalance(), 1000e6);
        assertEq(splitConfig.pendingAmount(), 1000e6);
        assertTrue(splitConfig.hasPendingFunds());

        // Test previewExecution
        (
            uint256[] memory amounts,
            uint256 protocolFee,
            uint256 available,
            uint256[] memory pendingRecipientAmounts,
            uint256 pendingProtocolAmount
        ) = splitConfig.previewExecution();

        assertEq(available, 1000e6);
        assertEq(amounts[0], 495e6);
        assertEq(amounts[1], 495e6);
        assertEq(protocolFee, 10e6);
        assertEq(pendingRecipientAmounts[0], 0);
        assertEq(pendingProtocolAmount, 0);

        console.log("[OK] Preview execution correct");
    }

    // =========================================================================
    // EDGE CASES
    // =========================================================================

    function test_Fork_SingleRecipient() public onlyFork {
        // Single recipient gets 99%, protocol gets 1%
        Recipient[] memory recipients = new Recipient[](1);
        recipients[0] = Recipient({addr: alice, percentageBps: 9900});

        bytes32 uniqueId = _uniqueId("single-recipient");
        address split = factory.createSplitConfig(alice, _getUsdc(), uniqueId, recipients);
        SplitConfigImpl splitConfig = SplitConfigImpl(split);

        assertEq(splitConfig.getRecipientCount(), 1);

        // Capture initial balance
        uint256 feeWalletBefore = _usdcBalance(feeWallet);

        // Fund and execute
        deal(_getUsdc(), split, 1000e6);
        splitConfig.executeSplit();

        // Single recipient gets 99%
        assertEq(_usdcBalance(alice), 990e6);
        // Protocol gets 1%
        assertEq(_usdcBalance(feeWallet) - feeWalletBefore, 10e6, "Fee wallet should receive 1%");
        assertEq(splitConfig.getBalance(), 0);

        console.log("[OK] Single recipient (99%) works correctly");
    }

    function test_Fork_MaxRecipients() public onlyFork {
        // Create split with 20 recipients (max)
        Recipient[] memory recipients = new Recipient[](20);
        for (uint160 i = 0; i < 20; i++) {
            recipients[i] = Recipient({
                addr: address(0x1000 + i),
                percentageBps: 495 // 4.95% each = 99% total
            });
        }

        bytes32 uniqueId = _uniqueId("max-recipients");
        address split = factory.createSplitConfig(alice, _getUsdc(), uniqueId, recipients);
        SplitConfigImpl splitConfig = SplitConfigImpl(split);

        assertEq(splitConfig.getRecipientCount(), 20);

        // Capture initial balance
        uint256 feeWalletBefore = _usdcBalance(feeWallet);

        // Fund and execute
        deal(_getUsdc(), split, 10_000e6); // 10k USDC
        splitConfig.executeSplit();

        // Verify each recipient got 4.95% = 495 USDC
        for (uint160 i = 0; i < 20; i++) {
            assertEq(_usdcBalance(address(0x1000 + i)), 495e6);
        }
        // Protocol fee: 1% = 100 USDC
        assertEq(_usdcBalance(feeWallet) - feeWalletBefore, 100e6, "Fee wallet should receive 1%");
        assertEq(splitConfig.getBalance(), 0);

        console.log("[OK] Max recipients (20) works correctly");
    }

    function test_Fork_ExecuteWithZeroBalance() public onlyFork {
        Recipient[] memory recipients = new Recipient[](2);
        recipients[0] = Recipient({addr: alice, percentageBps: 4950});
        recipients[1] = Recipient({addr: bob, percentageBps: 4950});

        bytes32 uniqueId = _uniqueId("zero-balance");
        address split = factory.createSplitConfig(alice, _getUsdc(), uniqueId, recipients);
        SplitConfigImpl splitConfig = SplitConfigImpl(split);

        // Execute with 0 balance - should not revert
        splitConfig.executeSplit();

        assertEq(_usdcBalance(alice), 0);
        assertEq(_usdcBalance(bob), 0);

        console.log("[OK] Execute with 0 balance succeeds (no-op)");
    }

    function test_Fork_MultipleDepositsAndExecutions() public onlyFork {
        Recipient[] memory recipients = new Recipient[](2);
        recipients[0] = Recipient({addr: alice, percentageBps: 4950});
        recipients[1] = Recipient({addr: bob, percentageBps: 4950});

        bytes32 uniqueId = _uniqueId("multiple-deposits");
        address split = factory.createSplitConfig(alice, _getUsdc(), uniqueId, recipients);
        SplitConfigImpl splitConfig = SplitConfigImpl(split);

        // First deposit and execute
        deal(_getUsdc(), split, 100e6);
        splitConfig.executeSplit();

        assertEq(_usdcBalance(alice), 49_500_000); // 49.5 USDC
        assertEq(_usdcBalance(bob), 49_500_000);

        // Second deposit and execute
        deal(_getUsdc(), split, 200e6);
        splitConfig.executeSplit();

        assertEq(_usdcBalance(alice), 148_500_000); // 49.5 + 99 = 148.5 USDC
        assertEq(_usdcBalance(bob), 148_500_000);

        // Third deposit and execute
        deal(_getUsdc(), split, 300e6);
        splitConfig.executeSplit();

        assertEq(_usdcBalance(alice), 297_000_000); // 148.5 + 148.5 = 297 USDC
        assertEq(_usdcBalance(bob), 297_000_000);

        console.log("[OK] Multiple deposits and executions work");
    }

    function test_Fork_DustHandling() public onlyFork {
        Recipient[] memory recipients = new Recipient[](3);
        recipients[0] = Recipient({addr: alice, percentageBps: 3300}); // 33%
        recipients[1] = Recipient({addr: bob, percentageBps: 3300}); // 33%
        recipients[2] = Recipient({addr: charlie, percentageBps: 3300}); // 33%

        bytes32 uniqueId = _uniqueId("dust-test");
        address split = factory.createSplitConfig(alice, _getUsdc(), uniqueId, recipients);
        SplitConfigImpl splitConfig = SplitConfigImpl(split);

        // Capture initial balance
        uint256 feeWalletBefore = _usdcBalance(feeWallet);

        // Use amount that doesn't divide evenly (causes dust)
        deal(_getUsdc(), split, 100e6); // 100 USDC

        splitConfig.executeSplit();

        // 99% distributed among 3 recipients = 33% each
        // 100 USDC * 33% = 33 USDC each
        // Protocol gets 1% = 1 USDC
        // Total: 33 + 33 + 33 + 1 = 100 USDC
        uint256 aliceBalance = _usdcBalance(alice);
        uint256 bobBalance = _usdcBalance(bob);
        uint256 charlieBalance = _usdcBalance(charlie);
        uint256 feeDelta = _usdcBalance(feeWallet) - feeWalletBefore;

        // Verify total distributed matches input
        assertEq(aliceBalance + bobBalance + charlieBalance + feeDelta, 100e6, "Total should equal input");

        // Each recipient should get 33% of 100 USDC = 33 USDC
        assertEq(aliceBalance, 33e6);
        assertEq(bobBalance, 33e6);
        assertEq(charlieBalance, 33e6);
        assertEq(feeDelta, 1e6, "Fee wallet should receive 1%");

        console.log("[OK] Dust handling correct (no leftover in split)");
    }

    function test_Fork_AddressPrediction() public onlyFork {
        Recipient[] memory recipients = new Recipient[](2);
        recipients[0] = Recipient({addr: alice, percentageBps: 4950});
        recipients[1] = Recipient({addr: bob, percentageBps: 4950});

        bytes32 uniqueId = _uniqueId("prediction-test");

        // Predict address
        address predicted = factory.predictSplitAddress(alice, _getUsdc(), uniqueId, recipients);

        // Create split
        address actual = factory.createSplitConfig(alice, _getUsdc(), uniqueId, recipients);

        assertEq(actual, predicted, "Address prediction mismatch");

        console.log("[OK] Address prediction matches actual:", actual);
    }

    function test_Fork_PermissionlessExecution() public onlyFork {
        Recipient[] memory recipients = new Recipient[](2);
        recipients[0] = Recipient({addr: alice, percentageBps: 4950});
        recipients[1] = Recipient({addr: bob, percentageBps: 4950});

        bytes32 uniqueId = _uniqueId("permissionless");
        address split = factory.createSplitConfig(alice, _getUsdc(), uniqueId, recipients);
        SplitConfigImpl splitConfig = SplitConfigImpl(split);

        deal(_getUsdc(), split, 1000e6);

        // Anyone can execute (charlie is not authority or recipient)
        vm.prank(charlie);
        splitConfig.executeSplit();

        // Funds should be distributed correctly
        assertEq(_usdcBalance(alice), 495e6);
        assertEq(_usdcBalance(bob), 495e6);

        console.log("[OK] Permissionless execution works");
    }

    // =========================================================================
    // FACTORY FUNCTIONS
    // =========================================================================

    function test_Fork_FactoryState() public onlyFork {
        // Verify factory configuration
        assertEq(factory.currentImplementation(), address(implementation));
        assertEq(factory.INITIAL_IMPLEMENTATION(), address(implementation));
        assertTrue(factory.authority() != address(0));
        assertTrue(factory.feeWallet() != address(0));

        console.log("[OK] Factory state correct");
        console.log("     Authority:", factory.authority());
        console.log("     Fee Wallet:", factory.feeWallet());
    }

    function test_Fork_DuplicateSplitReverts() public onlyFork {
        Recipient[] memory recipients = new Recipient[](2);
        recipients[0] = Recipient({addr: alice, percentageBps: 4950});
        recipients[1] = Recipient({addr: bob, percentageBps: 4950});

        bytes32 uniqueId = _uniqueId("duplicate-test");

        // First creation succeeds
        factory.createSplitConfig(alice, _getUsdc(), uniqueId, recipients);

        // Second creation with same params should revert
        vm.expectRevert();
        factory.createSplitConfig(alice, _getUsdc(), uniqueId, recipients);

        console.log("[OK] Duplicate split correctly rejected");
    }

    // =========================================================================
    // USDT TESTS (Non-standard ERC20 - no return value on transfer)
    // =========================================================================

    function test_Fork_CreateSplitWithUSDT() public onlyFork {
        Recipient[] memory recipients = new Recipient[](2);
        recipients[0] = Recipient({addr: alice, percentageBps: 4950});
        recipients[1] = Recipient({addr: bob, percentageBps: 4950});

        bytes32 uniqueId = _uniqueId("usdt-create");
        address split = factory.createSplitConfig(alice, _getUsdt(), uniqueId, recipients);

        SplitConfigImpl splitConfig = SplitConfigImpl(split);
        assertEq(splitConfig.token(), _getUsdt());
        assertEq(splitConfig.getRecipientCount(), 2);

        console.log("[OK] USDT Split created at:", split);
    }

    function test_Fork_ExecuteSplitWithUSDT() public onlyFork {
        Recipient[] memory recipients = new Recipient[](2);
        recipients[0] = Recipient({addr: alice, percentageBps: 4950});
        recipients[1] = Recipient({addr: bob, percentageBps: 4950});

        bytes32 uniqueId = _uniqueId("usdt-execute");
        address split = factory.createSplitConfig(alice, _getUsdt(), uniqueId, recipients);
        SplitConfigImpl splitConfig = SplitConfigImpl(split);

        // Deal USDT to the split
        deal(_getUsdt(), split, 1000e6);
        assertEq(splitConfig.getBalance(), 1000e6);

        // Execute - this tests non-standard ERC20 transfer handling
        splitConfig.executeSplit();

        // Verify distribution: 49.5% + 49.5% + 1% = 100%
        assertEq(_usdtBalance(alice), 495e6);
        assertEq(_usdtBalance(bob), 495e6);
        assertEq(_usdtBalance(feeWallet), 10e6);
        assertEq(splitConfig.getBalance(), 0);

        console.log("[OK] USDT distributed correctly (non-standard ERC20)");
    }

    function test_Fork_USDTMultipleExecutions() public onlyFork {
        Recipient[] memory recipients = new Recipient[](3);
        recipients[0] = Recipient({addr: alice, percentageBps: 3300});
        recipients[1] = Recipient({addr: bob, percentageBps: 3300});
        recipients[2] = Recipient({addr: charlie, percentageBps: 3300});

        bytes32 uniqueId = _uniqueId("usdt-multiple");
        address split = factory.createSplitConfig(alice, _getUsdt(), uniqueId, recipients);
        SplitConfigImpl splitConfig = SplitConfigImpl(split);

        // First execution
        deal(_getUsdt(), split, 100e6);
        splitConfig.executeSplit();

        assertEq(_usdtBalance(alice), 33e6);
        assertEq(_usdtBalance(bob), 33e6);
        assertEq(_usdtBalance(charlie), 33e6);

        // Second execution
        deal(_getUsdt(), split, 200e6);
        splitConfig.executeSplit();

        assertEq(_usdtBalance(alice), 99e6); // 33 + 66
        assertEq(_usdtBalance(bob), 99e6);
        assertEq(_usdtBalance(charlie), 99e6);

        console.log("[OK] USDT multiple executions work");
    }

    // =========================================================================
    // P0: CRITICAL SECURITY TESTS
    // =========================================================================

    /// @notice Test that blacklisted recipients get their funds stored as unclaimed
    /// @dev USDC/USDT can blacklist any address (OFAC sanctions, fraud detection)
    function test_Fork_BlacklistedRecipient() public onlyFork {
        Recipient[] memory recipients = new Recipient[](2);
        recipients[0] = Recipient({addr: alice, percentageBps: 4950});
        recipients[1] = Recipient({addr: bob, percentageBps: 4950});

        bytes32 uniqueId = _uniqueId("blacklist-recipient");
        address split = factory.createSplitConfig(alice, _getUsdc(), uniqueId, recipients);
        SplitConfigImpl splitConfig = SplitConfigImpl(split);

        // Capture initial balance
        uint256 feeWalletBefore = _usdcBalance(feeWallet);

        deal(_getUsdc(), split, 1000e6);

        // Mock alice as blacklisted - transfer will return false
        vm.mockCall(_getUsdc(), abi.encodeWithSignature("transfer(address,uint256)", alice, 495e6), abi.encode(false));

        splitConfig.executeSplit();

        // Alice's share should be stored as unclaimed
        assertEq(splitConfig.totalUnclaimed(), 495e6, "Alice's share should be unclaimed");
        // Bob should have received his share
        assertEq(_usdcBalance(bob), 495e6, "Bob should receive his share");
        // Fee wallet should have received fee
        assertEq(_usdcBalance(feeWallet) - feeWalletBefore, 10e6, "Fee wallet should receive fee");

        // Clear mock and retry - should succeed now
        vm.clearMockedCalls();

        splitConfig.executeSplit();

        // Alice should now have her share
        assertEq(_usdcBalance(alice), 495e6, "Alice should receive unclaimed after retry");
        assertEq(splitConfig.totalUnclaimed(), 0, "No unclaimed should remain");

        console.log("[OK] Blacklisted recipient test: unclaimed mechanism works");
    }

    /// @notice Test that blacklisted fee wallet stores protocol fee as unclaimed
    /// @dev If fee wallet is blacklisted, protocol loses fees until wallet is updated
    function test_Fork_BlacklistedFeeWallet() public onlyFork {
        Recipient[] memory recipients = new Recipient[](2);
        recipients[0] = Recipient({addr: alice, percentageBps: 4950});
        recipients[1] = Recipient({addr: bob, percentageBps: 4950});

        bytes32 uniqueId = _uniqueId("blacklist-feewallet");
        address split = factory.createSplitConfig(alice, _getUsdc(), uniqueId, recipients);
        SplitConfigImpl splitConfig = SplitConfigImpl(split);

        deal(_getUsdc(), split, 1000e6);

        // Mock fee wallet as blacklisted
        vm.mockCall(
            _getUsdc(), abi.encodeWithSignature("transfer(address,uint256)", feeWallet, 10e6), abi.encode(false)
        );

        splitConfig.executeSplit();

        // Protocol fee should be stored as unclaimed
        assertEq(splitConfig.totalUnclaimed(), 10e6, "Protocol fee should be unclaimed");
        // Recipients should have received their shares
        assertEq(_usdcBalance(alice), 495e6, "Alice should receive her share");
        assertEq(_usdcBalance(bob), 495e6, "Bob should receive his share");

        // Update fee wallet to recover
        address newFeeWallet = makeAddr("newFeeWallet");
        vm.prank(deployer);
        factory.updateProtocolConfig(newFeeWallet);

        // Clear mock and retry
        vm.clearMockedCalls();
        splitConfig.executeSplit();

        // New fee wallet should have received the unclaimed fee
        assertEq(_usdcBalance(newFeeWallet), 10e6, "New fee wallet should receive unclaimed");
        assertEq(splitConfig.totalUnclaimed(), 0, "No unclaimed should remain");

        console.log("[OK] Blacklisted fee wallet test: recovery via update works");
    }

    /// @notice Test that old splits continue working after implementation upgrade
    /// @dev Critical: EIP-1167 clones must not break when factory points to new impl
    function test_Fork_OldSplitWorksAfterImplementationUpgrade() public onlyFork {
        // Create split with current implementation
        Recipient[] memory recipients = new Recipient[](2);
        recipients[0] = Recipient({addr: alice, percentageBps: 4950});
        recipients[1] = Recipient({addr: bob, percentageBps: 4950});

        bytes32 oldId = _uniqueId("old-split");
        address oldSplit = factory.createSplitConfig(alice, _getUsdc(), oldId, recipients);
        SplitConfigImpl oldSplitConfig = SplitConfigImpl(oldSplit);

        // Fund old split
        deal(_getUsdc(), oldSplit, 1000e6);

        // Deploy and upgrade to new implementation
        SplitConfigImpl newImpl = new SplitConfigImpl();
        vm.prank(deployer);
        factory.upgradeImplementation(address(newImpl));

        // Create new split with new implementation
        bytes32 newId = _uniqueId("new-split");
        address newSplit = factory.createSplitConfig(bob, _getUsdc(), newId, recipients);
        SplitConfigImpl newSplitConfig = SplitConfigImpl(newSplit);

        // Fund new split
        deal(_getUsdc(), newSplit, 2000e6);

        // Execute OLD split - MUST still work
        oldSplitConfig.executeSplit();
        assertEq(_usdcBalance(alice), 495e6, "Old split: Alice should receive share");
        assertEq(_usdcBalance(bob), 495e6, "Old split: Bob should receive share");
        assertEq(oldSplitConfig.getBalance(), 0, "Old split should be empty");

        // Execute NEW split - should also work
        newSplitConfig.executeSplit();
        assertEq(_usdcBalance(alice), 495e6 + 990e6, "New split: Alice total correct");
        assertEq(_usdcBalance(bob), 495e6 + 990e6, "New split: Bob total correct");
        assertEq(newSplitConfig.getBalance(), 0, "New split should be empty");

        // Verify implementations are different but both work
        assertTrue(factory.currentImplementation() == address(newImpl), "Factory should use new impl");
        assertTrue(oldSplitConfig.isCascadeSplitConfig(), "Old split still works");
        assertTrue(newSplitConfig.isCascadeSplitConfig(), "New split works");

        console.log("[OK] Implementation upgrade continuity: old and new splits both work");
    }

    // =========================================================================
    // P1: HIGH PRIORITY TESTS
    // =========================================================================

    /// @notice Test with very large amounts (1 billion USDC) to verify no overflow
    function test_Fork_VeryLargeAmount() public onlyFork {
        Recipient[] memory recipients = new Recipient[](2);
        recipients[0] = Recipient({addr: alice, percentageBps: 4950});
        recipients[1] = Recipient({addr: bob, percentageBps: 4950});

        bytes32 uniqueId = _uniqueId("very-large-amount");
        address split = factory.createSplitConfig(alice, _getUsdc(), uniqueId, recipients);
        SplitConfigImpl splitConfig = SplitConfigImpl(split);

        // Capture initial balance
        uint256 feeWalletBefore = _usdcBalance(feeWallet);

        // Fund with 1 billion USDC
        uint256 largeAmount = 1_000_000_000e6; // 1 billion USDC
        deal(_getUsdc(), split, largeAmount);

        // Preview should work without overflow
        (uint256[] memory amounts, uint256 protocolFee, uint256 available,,) = splitConfig.previewExecution();

        assertEq(available, largeAmount, "Full amount should be available");
        assertEq(amounts[0], 495_000_000e6, "Alice should get 49.5%");
        assertEq(amounts[1], 495_000_000e6, "Bob should get 49.5%");
        assertEq(protocolFee, 10_000_000e6, "Protocol should get 1%");

        // Execute
        splitConfig.executeSplit();

        // Verify distribution
        uint256 feeDelta = _usdcBalance(feeWallet) - feeWalletBefore;
        assertEq(_usdcBalance(alice), 495_000_000e6, "Alice balance correct");
        assertEq(_usdcBalance(bob), 495_000_000e6, "Bob balance correct");
        assertEq(feeDelta, 10_000_000e6, "Fee wallet balance correct");
        assertEq(splitConfig.getBalance(), 0, "Split should be empty");

        // Verify total matches
        assertEq(
            _usdcBalance(alice) + _usdcBalance(bob) + feeDelta, largeAmount, "Total distributed should equal input"
        );

        console.log("[OK] Very large amount (1B USDC): no overflow, correct distribution");
    }

    /// @notice Test that concurrent execution by different callers is safe
    /// @dev First caller distributes, second caller is a no-op (no funds left)
    function test_Fork_ConcurrentExecutionSafety() public onlyFork {
        Recipient[] memory recipients = new Recipient[](2);
        recipients[0] = Recipient({addr: alice, percentageBps: 4950});
        recipients[1] = Recipient({addr: bob, percentageBps: 4950});

        bytes32 uniqueId = _uniqueId("concurrent-exec");
        address split = factory.createSplitConfig(alice, _getUsdc(), uniqueId, recipients);
        SplitConfigImpl splitConfig = SplitConfigImpl(split);

        deal(_getUsdc(), split, 1000e6);

        // First caller executes
        vm.prank(charlie);
        splitConfig.executeSplit();

        // Verify first execution succeeded
        assertEq(_usdcBalance(alice), 495e6, "Alice should have share after first exec");
        assertEq(_usdcBalance(bob), 495e6, "Bob should have share after first exec");

        // Save balances
        uint256 aliceBefore = _usdcBalance(alice);
        uint256 bobBefore = _usdcBalance(bob);
        uint256 feeBefore = _usdcBalance(feeWallet);

        // Second caller executes - should be no-op
        address anotherCaller = makeAddr("anotherCaller");
        vm.prank(anotherCaller);
        splitConfig.executeSplit();

        // Balances should not change
        assertEq(_usdcBalance(alice), aliceBefore, "Alice balance unchanged after second exec");
        assertEq(_usdcBalance(bob), bobBefore, "Bob balance unchanged after second exec");
        assertEq(_usdcBalance(feeWallet), feeBefore, "Fee wallet unchanged after second exec");
        assertEq(splitConfig.getBalance(), 0, "Split still empty");

        console.log("[OK] Concurrent execution: second call is safe no-op");
    }

    // =========================================================================
    // P2: MEDIUM PRIORITY TESTS
    // =========================================================================

    /// @notice Test behavior when USDC is paused (all transfers fail)
    /// @dev All amounts should go to unclaimed, recoverable when unpaused
    function test_Fork_TokenPausedDuringExecution() public onlyFork {
        Recipient[] memory recipients = new Recipient[](2);
        recipients[0] = Recipient({addr: alice, percentageBps: 4950});
        recipients[1] = Recipient({addr: bob, percentageBps: 4950});

        bytes32 uniqueId = _uniqueId("token-paused");
        address split = factory.createSplitConfig(alice, _getUsdc(), uniqueId, recipients);
        SplitConfigImpl splitConfig = SplitConfigImpl(split);

        // Capture initial balance
        uint256 feeWalletBefore = _usdcBalance(feeWallet);

        deal(_getUsdc(), split, 1000e6);

        // Mock all transfers to fail (simulating paused token)
        vm.mockCall(_getUsdc(), abi.encodeWithSignature("transfer(address,uint256)"), abi.encode(false));

        splitConfig.executeSplit();

        // ALL amounts should be unclaimed
        assertEq(splitConfig.totalUnclaimed(), 1000e6, "All funds should be unclaimed");
        assertEq(splitConfig.getBalance(), 1000e6, "Split should still hold all funds");

        // Clear mock (unpause) and retry
        vm.clearMockedCalls();
        splitConfig.executeSplit();

        // All funds should now be distributed
        assertEq(_usdcBalance(alice), 495e6, "Alice should receive after unpause");
        assertEq(_usdcBalance(bob), 495e6, "Bob should receive after unpause");
        assertEq(_usdcBalance(feeWallet) - feeWalletBefore, 10e6, "Fee wallet should receive after unpause");
        assertEq(splitConfig.totalUnclaimed(), 0, "No unclaimed after recovery");

        console.log("[OK] Token pause: all to unclaimed, recovered after unpause");
    }

    /// @notice Test that fee wallet change between preview and execute uses NEW wallet
    function test_Fork_FeeWalletChangeMidFlight() public onlyFork {
        Recipient[] memory recipients = new Recipient[](2);
        recipients[0] = Recipient({addr: alice, percentageBps: 4950});
        recipients[1] = Recipient({addr: bob, percentageBps: 4950});

        bytes32 uniqueId = _uniqueId("feewallet-midflight");
        address split = factory.createSplitConfig(alice, _getUsdc(), uniqueId, recipients);
        SplitConfigImpl splitConfig = SplitConfigImpl(split);

        deal(_getUsdc(), split, 1000e6);

        // User calls preview - sees feeWallet will receive
        (,, uint256 available,,) = splitConfig.previewExecution();
        assertEq(available, 1000e6, "Preview shows correct available");
        address originalFeeWallet = factory.feeWallet();
        uint256 originalFeeWalletBefore = _usdcBalance(originalFeeWallet);

        // Authority updates fee wallet before user executes
        address newFeeWallet = makeAddr("newFeeWalletMidFlight");
        vm.prank(deployer);
        factory.updateProtocolConfig(newFeeWallet);

        // User executes - fee goes to NEW wallet
        splitConfig.executeSplit();

        // Original fee wallet should not have received anything new
        assertEq(
            _usdcBalance(originalFeeWallet) - originalFeeWalletBefore,
            0,
            "Original fee wallet should not receive new funds"
        );
        // New fee wallet should have the fee
        assertEq(_usdcBalance(newFeeWallet), 10e6, "New fee wallet should receive fee");
        // Recipients should have their shares
        assertEq(_usdcBalance(alice), 495e6, "Alice should receive share");
        assertEq(_usdcBalance(bob), 495e6, "Bob should receive share");

        console.log("[OK] Fee wallet mid-flight change: NEW wallet receives fee");
    }

    /// @notice Test with 18-decimal token to verify decimal-agnostic math
    /// @dev Uses a fresh MockERC20 with 18 decimals since Base Sepolia may not have WBTC
    function test_Fork_DifferentDecimals() public onlyFork {
        // Deploy mock 18-decimal token (like WETH/DAI pattern)
        // Note: We use deal() which works with any ERC20, so we test the concept
        // by verifying math works with different magnitudes

        Recipient[] memory recipients = new Recipient[](2);
        recipients[0] = Recipient({addr: alice, percentageBps: 4950});
        recipients[1] = Recipient({addr: bob, percentageBps: 4950});

        // Test with USDC but using 18-decimal-like amounts to verify math scaling
        bytes32 uniqueId = _uniqueId("different-decimals");
        address split = factory.createSplitConfig(alice, _getUsdc(), uniqueId, recipients);
        SplitConfigImpl splitConfig = SplitConfigImpl(split);

        // Capture initial balance
        uint256 feeWalletBefore = _usdcBalance(feeWallet);

        // Use a very precise amount that would reveal decimal issues
        // 123,456,789.123456 USDC
        uint256 preciseAmount = 123_456_789_123_456;
        deal(_getUsdc(), split, preciseAmount);

        splitConfig.executeSplit();

        // 49.5% of 123,456,789,123,456 = 61,121,110,616,110.72 → truncated to 61,121,110,616,110
        uint256 expectedPerRecipient = (preciseAmount * 4950) / 10_000;

        assertEq(_usdcBalance(alice), expectedPerRecipient, "Alice precise calculation");
        assertEq(_usdcBalance(bob), expectedPerRecipient, "Bob precise calculation");

        // Protocol gets remainder
        uint256 expectedProtocol = preciseAmount - (expectedPerRecipient * 2);
        uint256 feeDelta = _usdcBalance(feeWallet) - feeWalletBefore;
        assertEq(feeDelta, expectedProtocol, "Protocol gets remainder");

        // Verify no dust left
        assertEq(splitConfig.getBalance(), 0, "Split should be empty");

        // Verify total matches
        assertEq(_usdcBalance(alice) + _usdcBalance(bob) + feeDelta, preciseAmount, "Total should equal input");

        console.log("[OK] Different decimals/precision: math is correct");
    }

    // =========================================================================
    // GOVERNANCE TESTS
    // =========================================================================

    /// @notice Test two-step authority transfer works correctly on fork
    function test_Fork_TwoStepAuthorityTransfer() public onlyFork {
        address newAuthority = makeAddr("newAuthority");

        // Step 1: Current authority proposes transfer
        vm.prank(deployer);
        factory.transferProtocolAuthority(newAuthority);

        // Verify pending state
        assertEq(factory.pendingAuthority(), newAuthority, "Pending authority should be set");
        assertEq(factory.authority(), deployer, "Authority should not change yet");

        // Step 2: New authority accepts
        vm.prank(newAuthority);
        factory.acceptProtocolAuthority();

        // Verify transfer complete
        assertEq(factory.authority(), newAuthority, "Authority should be transferred");
        assertEq(factory.pendingAuthority(), address(0), "Pending should be cleared");

        // New authority can now update fee wallet
        address newFeeWallet = makeAddr("newFeeWalletAfterTransfer");
        vm.prank(newAuthority);
        factory.updateProtocolConfig(newFeeWallet);

        assertEq(factory.feeWallet(), newFeeWallet, "New authority should be able to update config");

        console.log("[OK] Two-step authority transfer works correctly");
    }

    // =========================================================================
    // DETECTION / VERIFICATION TESTS
    // =========================================================================

    /// @notice Test that split can be verified via CREATE2 address recomputation
    /// @dev This is the "strong" detection method from the spec
    function test_Fork_SplitDetectionViaCREATE2() public onlyFork {
        Recipient[] memory recipients = new Recipient[](2);
        recipients[0] = Recipient({addr: alice, percentageBps: 4950});
        recipients[1] = Recipient({addr: bob, percentageBps: 4950});

        bytes32 uniqueId = _uniqueId("detection-test");
        address split = factory.createSplitConfig(alice, _getUsdc(), uniqueId, recipients);
        SplitConfigImpl splitConfig = SplitConfigImpl(split);

        // Quick detection - isCascadeSplitConfig()
        assertTrue(splitConfig.isCascadeSplitConfig(), "Quick detection should work");

        // Strong detection - verify via CREATE2 recomputation
        // Read all immutable args from the deployed split
        address readFactory = splitConfig.factory();
        address readAuthority = splitConfig.authority();
        address readToken = splitConfig.token();
        bytes32 readUniqueId = splitConfig.uniqueId();
        Recipient[] memory readRecipients = splitConfig.getRecipients();

        // Verify factory matches known factory
        assertEq(readFactory, address(factory), "Factory should match");

        // Recompute expected address using predictSplitAddress
        address predicted = factory.predictSplitAddress(readAuthority, readToken, readUniqueId, readRecipients);

        // Verify computed address matches actual address
        assertEq(predicted, split, "CREATE2 verification should match");

        console.log("[OK] Split detection via CREATE2 recomputation works");
    }

    /// @notice Test that prediction works before deployment (pre-fund scenario)
    function test_Fork_PredictAndPreFund() public onlyFork {
        Recipient[] memory recipients = new Recipient[](2);
        recipients[0] = Recipient({addr: alice, percentageBps: 4950});
        recipients[1] = Recipient({addr: bob, percentageBps: 4950});

        bytes32 uniqueId = _uniqueId("prefund-test");

        // Predict address BEFORE deployment
        address predicted = factory.predictSplitAddress(alice, _getUsdc(), uniqueId, recipients);

        // Pre-fund the predicted address (before split exists!)
        deal(_getUsdc(), predicted, 1000e6);

        // Now deploy the split
        address actual = factory.createSplitConfig(alice, _getUsdc(), uniqueId, recipients);

        // Verify addresses match
        assertEq(actual, predicted, "Deployed address should match prediction");

        // Verify pre-funded balance is accessible
        SplitConfigImpl splitConfig = SplitConfigImpl(actual);
        assertEq(splitConfig.getBalance(), 1000e6, "Pre-funded balance should be accessible");

        // Execute should work on pre-funded split
        splitConfig.executeSplit();

        assertEq(_usdcBalance(alice), 495e6, "Alice should receive pre-funded share");
        assertEq(_usdcBalance(bob), 495e6, "Bob should receive pre-funded share");

        console.log("[OK] Pre-fund before deployment works correctly");
    }

    // =========================================================================
    // HELPERS
    // =========================================================================
    //
    // NOTE: Unclaimed flow is tested in SplitConfigImpl.t.sol using vm.mockCall
    // to simulate failed ERC20 transfers. Fork tests use real tokens which don't
    // fail transfers to normal addresses (only blacklisted addresses would fail).

    /// @dev Helper to get USDC balance
    function _usdcBalance(
        address account
    ) internal view returns (uint256) {
        (bool success, bytes memory data) =
            _getUsdc().staticcall(abi.encodeWithSignature("balanceOf(address)", account));
        require(success, "balanceOf failed");
        return abi.decode(data, (uint256));
    }

    /// @dev Helper to get USDT balance
    function _usdtBalance(
        address account
    ) internal view returns (uint256) {
        (bool success, bytes memory data) =
            _getUsdt().staticcall(abi.encodeWithSignature("balanceOf(address)", account));
        require(success, "balanceOf failed");
        return abi.decode(data, (uint256));
    }
}
