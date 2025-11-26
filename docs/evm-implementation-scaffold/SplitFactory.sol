// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {SplitConfig} from "./SplitConfig.sol";

/**
 * @title SplitFactory
 * @notice Factory for deploying SplitConfig clones with deterministic addresses
 * @dev Uses EIP-1167 minimal proxies for gas-efficient deployment (~60k gas)
 *
 * Naming aligned with Solana implementation for cross-chain parity.
 *
 * Key features:
 * - Deterministic addresses via CREATE2 (predictable before deployment)
 * - Protocol configuration (fee wallet)
 * - Two-step authority transfer for protocol admin
 */
contract SplitFactory {
    using Clones for address;

    // ============ State ============

    address public immutable implementation;

    /// @notice Protocol fee wallet
    address public feeWallet;

    /// @notice Protocol authority
    address public authority;

    /// @notice Pending authority for two-step transfer
    address public pendingAuthority;

    // Track deployed splits
    mapping(bytes32 => address) public splits;
    uint256 public totalSplits;

    // ============ Events ============

    event ProtocolConfigCreated(
        address indexed authority,
        address indexed feeWallet
    );

    event ProtocolConfigUpdated(
        address indexed oldFeeWallet,
        address indexed newFeeWallet
    );

    event ProtocolAuthorityTransferProposed(
        address indexed currentAuthority,
        address indexed pendingAuthority
    );

    event ProtocolAuthorityTransferAccepted(
        address indexed oldAuthority,
        address indexed newAuthority
    );

    event SplitConfigCreated(
        address indexed splitConfig,
        address indexed configAuthority,
        address indexed token,
        bytes32 uniqueId,
        SplitConfig.Recipient[] recipients
    );

    // ============ Errors ============

    error ZeroAddress();
    error SplitAlreadyExists();
    error Unauthorized();
    error NoPendingTransfer();
    error NotPendingAuthority();

    // ============ Modifiers ============

    modifier onlyAuthority() {
        if (msg.sender != authority) revert Unauthorized();
        _;
    }

    // ============ Constructor ============

    constructor(address _feeWallet) {
        if (_feeWallet == address(0)) revert ZeroAddress();

        implementation = address(new SplitConfig());
        feeWallet = _feeWallet;
        authority = msg.sender;

        emit ProtocolConfigCreated(msg.sender, _feeWallet);
    }

    // ============ Split Config Instructions ============

    /**
     * @notice Create a new split configuration
     * @dev Deploys a minimal proxy clone with deterministic address
     * @param configAuthority Address that will control the split config
     * @param token ERC20 token the split will accept
     * @param uniqueId Unique identifier (use random bytes32 for uniqueness)
     * @param recipients Array of recipients with their percentage basis points (must sum to 9900)
     * @return splitConfig Address of the deployed split
     */
    function createSplitConfig(
        address configAuthority,
        address token,
        bytes32 uniqueId,
        SplitConfig.Recipient[] calldata recipients
    ) external returns (address splitConfig) {
        bytes32 salt = _computeSalt(configAuthority, token, uniqueId);

        // Check if split already exists
        if (splits[salt] != address(0)) revert SplitAlreadyExists();

        // Deploy clone
        splitConfig = implementation.cloneDeterministic(salt);

        // Initialize
        SplitConfig(splitConfig).initialize(configAuthority, token, uniqueId, recipients);

        // Track
        splits[salt] = splitConfig;
        totalSplits++;

        emit SplitConfigCreated(splitConfig, configAuthority, token, uniqueId, recipients);
    }

    /**
     * @notice Compute split address before deployment
     */
    function computeSplitAddress(
        address configAuthority,
        address token,
        bytes32 uniqueId
    ) external view returns (address) {
        bytes32 salt = _computeSalt(configAuthority, token, uniqueId);
        return implementation.predictDeterministicAddress(salt, address(this));
    }

    /**
     * @notice Check if a split exists for given parameters
     */
    function splitExists(
        address configAuthority,
        address token,
        bytes32 uniqueId
    ) external view returns (bool) {
        bytes32 salt = _computeSalt(configAuthority, token, uniqueId);
        return splits[salt] != address(0);
    }

    /**
     * @notice Get split address for given parameters (returns zero if not deployed)
     */
    function getSplit(
        address configAuthority,
        address token,
        bytes32 uniqueId
    ) external view returns (address) {
        bytes32 salt = _computeSalt(configAuthority, token, uniqueId);
        return splits[salt];
    }

    // ============ Protocol Config Instructions ============

    /**
     * @notice Update protocol fee wallet
     * @param newFeeWallet New address to receive protocol fees
     */
    function updateProtocolConfig(address newFeeWallet) external onlyAuthority {
        if (newFeeWallet == address(0)) revert ZeroAddress();

        address oldFeeWallet = feeWallet;
        feeWallet = newFeeWallet;

        emit ProtocolConfigUpdated(oldFeeWallet, newFeeWallet);
    }

    /**
     * @notice Propose transfer of protocol authority to a new address
     * @dev Two-step transfer: propose, then accept
     * @param newAuthority Address to receive authority (or address(0) to cancel)
     */
    function transferProtocolAuthority(address newAuthority) external onlyAuthority {
        pendingAuthority = newAuthority;

        emit ProtocolAuthorityTransferProposed(authority, newAuthority);
    }

    /**
     * @notice Accept a pending protocol authority transfer
     * @dev Must be called by the pending authority
     */
    function acceptProtocolAuthority() external {
        if (pendingAuthority == address(0)) revert NoPendingTransfer();
        if (msg.sender != pendingAuthority) revert NotPendingAuthority();

        address oldAuthority = authority;
        authority = pendingAuthority;
        pendingAuthority = address(0);

        emit ProtocolAuthorityTransferAccepted(oldAuthority, authority);
    }

    // ============ Internal ============

    function _computeSalt(
        address configAuthority,
        address token,
        bytes32 uniqueId
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(configAuthority, token, uniqueId));
    }
}
