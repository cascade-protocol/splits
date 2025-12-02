// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.30;

import {SplitConfigImpl} from "../src/SplitConfigImpl.sol";
import {SplitFactory} from "../src/SplitFactory.sol";
import {Recipient} from "../src/Types.sol";
import {Test, console} from "forge-std/Test.sol";

/// @title ForkTest
/// @notice Fork tests against real Base Sepolia USDC
/// @dev Run with: forge test --match-contract ForkTest --fork-url $BASE_SEPOLIA_RPC_URL
contract ForkTest is Test {
    // Base Sepolia USDC (Circle's official testnet USDC)
    // Source: https://developers.circle.com/stablecoins/docs/usdc-on-test-networks
    address constant USDC_BASE_SEPOLIA = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    SplitFactory public factory;
    SplitConfigImpl public implementation;

    address public deployer;
    address public feeWallet;
    address public alice;
    address public bob;

    function setUp() public {
        // Skip if not running fork test
        if (block.chainid != 84_532) {
            // Base Sepolia chain ID
            return;
        }

        deployer = makeAddr("deployer");
        feeWallet = makeAddr("feeWallet");
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        // Deploy contracts
        vm.startPrank(deployer);
        implementation = new SplitConfigImpl();
        factory = new SplitFactory(address(implementation), feeWallet);
        vm.stopPrank();
    }

    /// @notice Skip modifier for fork tests
    modifier onlyFork() {
        if (block.chainid != 84_532) {
            console.log("Skipping fork test - not on Base Sepolia (chainid:", block.chainid, ")");
            return;
        }
        _;
    }

    function test_Fork_CreateSplitWithRealUSDC() public onlyFork {
        Recipient[] memory recipients = new Recipient[](2);
        recipients[0] = Recipient({addr: alice, percentageBps: 4950});
        recipients[1] = Recipient({addr: bob, percentageBps: 4950});

        bytes32 uniqueId = keccak256(abi.encode(block.timestamp, "fork-test"));

        address split = factory.createSplitConfig(alice, USDC_BASE_SEPOLIA, uniqueId, recipients);

        // Verify split was created correctly
        SplitConfigImpl splitConfig = SplitConfigImpl(split);
        assertEq(splitConfig.token(), USDC_BASE_SEPOLIA);
        assertEq(splitConfig.getRecipientCount(), 2);
        assertTrue(splitConfig.isCascadeSplitConfig());

        console.log("Split created at:", split);
    }

    function test_Fork_ExecuteSplitWithRealUSDC() public onlyFork {
        // Create split
        Recipient[] memory recipients = new Recipient[](2);
        recipients[0] = Recipient({addr: alice, percentageBps: 4950});
        recipients[1] = Recipient({addr: bob, percentageBps: 4950});

        bytes32 uniqueId = keccak256(abi.encode(block.timestamp, "fork-exec-test"));
        address split = factory.createSplitConfig(alice, USDC_BASE_SEPOLIA, uniqueId, recipients);
        SplitConfigImpl splitConfig = SplitConfigImpl(split);

        // Deal USDC to the split (fork cheatcode)
        // This simulates someone sending USDC to the split address
        deal(USDC_BASE_SEPOLIA, split, 1000e6);

        // Verify balance
        assertEq(splitConfig.getBalance(), 1000e6);

        // Execute split
        splitConfig.executeSplit();

        // Verify distribution
        assertEq(_usdcBalance(alice), 495e6); // 49.5%
        assertEq(_usdcBalance(bob), 495e6); // 49.5%
        assertEq(_usdcBalance(feeWallet), 10e6); // 1%
        assertEq(splitConfig.getBalance(), 0);

        console.log("Fork test passed - USDC distributed correctly");
    }

    function test_Fork_ViewFunctionsWithRealUSDC() public onlyFork {
        // Create split
        Recipient[] memory recipients = new Recipient[](2);
        recipients[0] = Recipient({addr: alice, percentageBps: 4950});
        recipients[1] = Recipient({addr: bob, percentageBps: 4950});

        bytes32 uniqueId = keccak256(abi.encode(block.timestamp, "fork-view-test"));
        address split = factory.createSplitConfig(alice, USDC_BASE_SEPOLIA, uniqueId, recipients);
        SplitConfigImpl splitConfig = SplitConfigImpl(split);

        // Deal USDC
        deal(USDC_BASE_SEPOLIA, split, 1000e6);

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
    }

    /// @dev Helper to get USDC balance
    function _usdcBalance(
        address account
    ) internal view returns (uint256) {
        (bool success, bytes memory data) =
            USDC_BASE_SEPOLIA.staticcall(abi.encodeWithSignature("balanceOf(address)", account));
        require(success, "balanceOf failed");
        return abi.decode(data, (uint256));
    }
}
