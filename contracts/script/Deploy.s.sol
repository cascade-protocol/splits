// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.30;

import {SplitConfigImpl} from "../src/SplitConfigImpl.sol";
import {SplitFactory} from "../src/SplitFactory.sol";
import {Script, console} from "forge-std/Script.sol";

/// @title Deploy
/// @notice Deterministic deployment script for Cascade Splits EVM contracts
/// @dev Deploys to the SAME addresses on ALL EVM chains using CREATE2.
///
///      Uses Arachnid's deterministic deployer (0x4e59b44847b379578588920cA78FbF26c0B4956C)
///      which exists on all major EVM chains. Combined with foundry.toml settings:
///      - bytecode_hash = "none"
///      - cbor_metadata = false
///      - always_use_create_2_factory = true
///
/// DETERMINISTIC ADDRESSES (same on ALL networks):
///   SplitConfigImpl: 0xF9ad695ecc76c4b8E13655365b318d54E4131EA6
///   SplitFactory:    0x946Cd053514b1Ab7829dD8fEc85E0ade5550dcf7
///
/// Usage:
///   forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify
///
/// Environment variables:
///   - PRIVATE_KEY: Deployer private key (must have ETH for gas)
///   - ETHERSCAN_API_KEY: For contract verification
///
/// For local testing, use LocalValidation.s.sol instead.
///
contract Deploy is Script {
    // =========================================================================
    // DETERMINISTIC DEPLOYMENT CONSTANTS
    // DO NOT CHANGE - these values determine the final addresses
    // =========================================================================

    /// @notice Salt for deterministic CREATE2 deployment
    bytes32 public constant SALT = keccak256("cascade-splits-v1");

    /// @notice Initial authority (hardcoded for same address everywhere)
    /// @dev Can be transferred post-deployment via SplitFactory.transferProtocolAuthority()
    address public constant INITIAL_AUTHORITY = 0xf1EDbaF36b4C76baA06D418F018E327Add62eb02;

    /// @notice Initial fee wallet (hardcoded for same address everywhere)
    /// @dev Can be updated post-deployment via SplitFactory.updateProtocolConfig()
    address public constant INITIAL_FEE_WALLET = 0xf1EDbaF36b4C76baA06D418F018E327Add62eb02;

    // =========================================================================
    // EXPECTED ADDRESSES (for verification)
    // =========================================================================

    address public constant EXPECTED_IMPL = 0xF9ad695ecc76c4b8E13655365b318d54E4131EA6;
    address public constant EXPECTED_FACTORY = 0x946Cd053514b1Ab7829dD8fEc85E0ade5550dcf7;

    // =========================================================================
    // DEPLOYMENT
    // =========================================================================

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("=== Cascade Splits Deployment ===");
        console.log("Chain ID:", block.chainid);
        console.log("Deployer:", deployer);
        console.log("");
        console.log("Expected addresses:");
        console.log("  SplitConfigImpl:", EXPECTED_IMPL);
        console.log("  SplitFactory:", EXPECTED_FACTORY);
        console.log("");

        vm.startBroadcast(deployerKey);

        // Deploy implementation
        SplitConfigImpl impl = new SplitConfigImpl{salt: SALT}();
        require(address(impl) == EXPECTED_IMPL, "SplitConfigImpl address mismatch!");
        console.log("[OK] SplitConfigImpl:", address(impl));

        // Deploy factory (authority passed explicitly for CREATE2 compatibility)
        SplitFactory factory = new SplitFactory{salt: SALT}(address(impl), INITIAL_FEE_WALLET, INITIAL_AUTHORITY);
        require(address(factory) == EXPECTED_FACTORY, "SplitFactory address mismatch!");
        console.log("[OK] SplitFactory:", address(factory));

        vm.stopBroadcast();

        // Log final state
        console.log("");
        console.log("=== Deployment Complete ===");
        console.log("Authority:", factory.authority());
        console.log("Fee Wallet:", factory.feeWallet());
        console.log("Implementation:", factory.currentImplementation());
    }

    /// @notice Preview addresses without deploying
    function predictAddresses() external pure {
        console.log("=== Cascade Splits Deterministic Addresses ===");
        console.log("");
        console.log("These addresses are IDENTICAL on all EVM chains:");
        console.log("  SplitConfigImpl:", EXPECTED_IMPL);
        console.log("  SplitFactory:", EXPECTED_FACTORY);
        console.log("");
        console.log("Initial Authority:", INITIAL_AUTHORITY);
        console.log("(Transferable via SplitFactory.transferProtocolAuthority)");
        console.log("");
        console.log("Initial Fee Wallet:", INITIAL_FEE_WALLET);
        console.log("(Updateable via SplitFactory.updateProtocolConfig)");
    }
}
