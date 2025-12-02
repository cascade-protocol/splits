// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.30;

import {SplitConfigImpl} from "../src/SplitConfigImpl.sol";
import {SplitFactory} from "../src/SplitFactory.sol";
import {Script, console} from "forge-std/Script.sol";

/// @title Deploy
/// @notice Deployment script for Cascade Splits EVM contracts
/// @dev Uses CREATE2 via deterministic deployment for consistent addresses across chains
///
/// Usage:
///   # Dry run (no broadcast)
///   forge script script/Deploy.s.sol:Deploy --rpc-url base_sepolia
///
///   # Deploy to Base Sepolia with verification
///   forge script script/Deploy.s.sol:Deploy --rpc-url base_sepolia --broadcast --verify
///
///   # Deploy to Base Mainnet with verification
///   forge script script/Deploy.s.sol:Deploy --rpc-url base --broadcast --verify
///
/// Environment variables required:
///   - PRIVATE_KEY: Deployer private key
///   - FEE_WALLET: Protocol fee wallet address
///   - BASESCAN_API_KEY: For contract verification (optional but recommended)
///
contract Deploy is Script {
    /// @notice Salt for deterministic deployment
    bytes32 public constant SALT = keccak256("cascade-splits-v1");

    function run() external {
        // Load environment variables
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address feeWallet = vm.envAddress("FEE_WALLET");

        console.log("=== Deployment Configuration ===");
        console.log("Deployer:", vm.addr(deployerKey));
        console.log("Fee Wallet:", feeWallet);
        console.log("Chain ID:", block.chainid);

        vm.startBroadcast(deployerKey);

        // 1. Deploy implementation
        SplitConfigImpl impl = new SplitConfigImpl{salt: SALT}();
        console.log("\nSplitConfigImpl deployed to:", address(impl));

        // 2. Deploy factory
        SplitFactory factory = new SplitFactory{salt: SALT}(address(impl), feeWallet);
        console.log("SplitFactory deployed to:", address(factory));

        vm.stopBroadcast();

        // Verification info
        console.log("\n=== Deployment Summary ===");
        console.log("SplitConfigImpl:", address(impl));
        console.log("SplitFactory:", address(factory));
        console.log("Authority:", factory.authority());
        console.log("Fee Wallet:", factory.feeWallet());

        // Manual verification commands (if --verify flag wasn't used)
        console.log("\n=== Manual Verification Commands ===");
        console.log(
            "forge verify-contract", address(impl), "src/SplitConfigImpl.sol:SplitConfigImpl --chain-id", block.chainid
        );
        console.log(
            "forge verify-contract", address(factory), "src/SplitFactory.sol:SplitFactory --chain-id", block.chainid
        );
    }
}

/// @title DeployTestnet
/// @notice Testnet deployment with mock fee wallet
contract DeployTestnet is Script {
    bytes32 public constant SALT = keccak256("cascade-splits-testnet-v1");

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("Deploying to testnet...");
        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerKey);

        // Deploy implementation
        SplitConfigImpl impl = new SplitConfigImpl{salt: SALT}();
        console.log("SplitConfigImpl:", address(impl));

        // Deploy factory (deployer is both authority and fee wallet for testing)
        SplitFactory factory = new SplitFactory{salt: SALT}(address(impl), deployer);
        console.log("SplitFactory:", address(factory));

        vm.stopBroadcast();
    }
}
