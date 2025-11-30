// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.30;

import {LibClone} from "solady/utils/LibClone.sol";

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
} from "./Errors.sol";
import {Recipient} from "./Types.sol";
import {ISplitFactory} from "./interfaces/ISplitFactory.sol";

/// @title SplitFactory
/// @notice Factory for deploying Cascade Split configurations as EIP-1167 clones
/// @dev Supports versioned implementations for safe iteration during active development
contract SplitFactory is ISplitFactory {
    // =========================================================================
    // Constants
    // =========================================================================

    /// @notice Protocol fee in basis points (1%)
    uint16 public constant PROTOCOL_FEE_BPS = 100;

    /// @notice Required total percentage for recipients (99%)
    uint16 public constant REQUIRED_SPLIT_TOTAL = 9900;

    /// @notice Minimum number of recipients
    uint8 public constant MIN_RECIPIENTS = 1;

    /// @notice Maximum number of recipients
    uint8 public constant MAX_RECIPIENTS = 20;

    // =========================================================================
    // Immutables
    // =========================================================================

    /// @notice Initial implementation address (set at deployment, never changes)
    address public immutable initialImplementation;

    // =========================================================================
    // Storage
    // =========================================================================

    /// @notice Current implementation used for new splits (can be upgraded)
    address public currentImplementation;

    /// @notice Protocol fee wallet address
    address public feeWallet;

    /// @notice Protocol authority (can upgrade implementation and update fee wallet)
    address public authority;

    /// @notice Pending authority for two-step transfer
    address public pendingAuthority;

    // =========================================================================
    // Events
    // =========================================================================

    /// @notice Emitted when factory is deployed
    event ProtocolConfigCreated(address indexed authority, address indexed feeWallet);

    /// @notice Emitted when fee wallet is updated
    event ProtocolConfigUpdated(address indexed oldFeeWallet, address indexed newFeeWallet);

    /// @notice Emitted when authority transfer is initiated
    event ProtocolAuthorityTransferProposed(address indexed currentAuthority, address indexed pendingAuthority);

    /// @notice Emitted when authority transfer is completed
    event ProtocolAuthorityTransferAccepted(address indexed oldAuthority, address indexed newAuthority);

    /// @notice Emitted when implementation is upgraded for future splits
    event ImplementationUpgraded(address indexed oldImplementation, address indexed newImplementation);

    /// @notice Emitted when a new split is deployed
    event SplitConfigCreated(
        address indexed split,
        address indexed authority,
        address indexed token,
        bytes32 uniqueId,
        Recipient[] recipients
    );

    // =========================================================================
    // Modifiers
    // =========================================================================

    modifier onlyAuthority() {
        if (msg.sender != authority) revert Unauthorized(msg.sender, authority);
        _;
    }

    // =========================================================================
    // Constructor
    // =========================================================================

    /// @notice Deploys the factory with initial implementation and fee wallet
    /// @param initialImplementation_ The initial SplitConfigImpl address
    /// @param feeWallet_ The protocol fee wallet address
    constructor(address initialImplementation_, address feeWallet_) {
        if (initialImplementation_ == address(0)) revert ZeroAddress(0);
        if (initialImplementation_.code.length == 0) revert InvalidImplementation(initialImplementation_);
        if (feeWallet_ == address(0)) revert ZeroAddress(1);

        initialImplementation = initialImplementation_;
        currentImplementation = initialImplementation_;
        feeWallet = feeWallet_;
        authority = msg.sender;

        emit ProtocolConfigCreated(msg.sender, feeWallet_);
    }

    // =========================================================================
    // External Functions
    // =========================================================================

    /// @inheritdoc ISplitFactory
    function createSplitConfig(
        address authority_,
        address token,
        bytes32 uniqueId,
        Recipient[] calldata recipients
    ) external returns (address split) {
        // Validate token address
        if (token == address(0)) revert ZeroAddress(0);

        // Validate recipients (count, total bps, no duplicates, no zero addresses/percentages)
        _validateRecipients(recipients);

        // Build immutable args data
        bytes memory data = _buildImmutableArgs(authority_, token, uniqueId, recipients);

        // Compute salt from (authority, token, uniqueId)
        bytes32 salt = _computeSalt(authority_, token, uniqueId);

        // Deploy clone with LibClone.createDeterministicClone (handles collision detection)
        bool alreadyDeployed;
        (alreadyDeployed, split) = LibClone.createDeterministicClone(currentImplementation, data, salt);

        // Check for collision
        if (alreadyDeployed) revert SplitAlreadyExists(split);

        // Emit SplitConfigCreated event
        emit SplitConfigCreated(split, authority_, token, uniqueId, recipients);
    }

    /// @inheritdoc ISplitFactory
    function predictSplitAddress(
        address authority_,
        address token,
        bytes32 uniqueId,
        Recipient[] calldata recipients
    ) external view returns (address) {
        // Build immutable args data (same as createSplitConfig)
        bytes memory data = _buildImmutableArgs(authority_, token, uniqueId, recipients);

        // Compute salt
        bytes32 salt = _computeSalt(authority_, token, uniqueId);

        // Return predicted deterministic address
        return LibClone.predictDeterministicAddress(currentImplementation, data, salt, address(this));
    }

    /// @notice Updates the protocol fee wallet
    /// @param newFeeWallet The new fee wallet address
    function updateProtocolConfig(address newFeeWallet) external onlyAuthority {
        if (newFeeWallet == address(0)) revert ZeroAddress(0);
        address oldFeeWallet = feeWallet;
        feeWallet = newFeeWallet;
        emit ProtocolConfigUpdated(oldFeeWallet, newFeeWallet);
    }

    /// @notice Upgrades the implementation for future splits
    /// @param newImplementation The new implementation address
    function upgradeImplementation(address newImplementation) external onlyAuthority {
        if (newImplementation == address(0)) revert ZeroAddress(0);
        if (newImplementation.code.length == 0) revert InvalidImplementation(newImplementation);
        address oldImplementation = currentImplementation;
        currentImplementation = newImplementation;
        emit ImplementationUpgraded(oldImplementation, newImplementation);
    }

    /// @notice Initiates two-step authority transfer
    /// @param newAuthority The proposed new authority (set to address(0) to cancel)
    function transferProtocolAuthority(address newAuthority) external onlyAuthority {
        pendingAuthority = newAuthority;
        emit ProtocolAuthorityTransferProposed(authority, newAuthority);
    }

    /// @notice Completes authority transfer (must be called by pending authority)
    function acceptProtocolAuthority() external {
        if (msg.sender != pendingAuthority) revert Unauthorized(msg.sender, pendingAuthority);
        if (pendingAuthority == address(0)) revert NoPendingTransfer();
        address oldAuthority = authority;
        authority = pendingAuthority;
        pendingAuthority = address(0);
        emit ProtocolAuthorityTransferAccepted(oldAuthority, authority);
    }

    // =========================================================================
    // Internal Functions
    // =========================================================================

    /// @dev Validates recipients array
    function _validateRecipients(Recipient[] calldata recipients) internal pure {
        uint256 count = recipients.length;

        // 1. Check count in [MIN_RECIPIENTS, MAX_RECIPIENTS]
        if (count < MIN_RECIPIENTS || count > MAX_RECIPIENTS) {
            revert InvalidRecipientCount(count, MIN_RECIPIENTS, MAX_RECIPIENTS);
        }

        uint256 total;
        for (uint256 i; i < count;) {
            address addr = recipients[i].addr;
            uint16 bps = recipients[i].percentageBps;

            // 4. Check no zero addresses
            if (addr == address(0)) {
                revert ZeroAddress(i);
            }

            // 5. Check no zero percentages
            if (bps == 0) {
                revert ZeroPercentage(i);
            }

            // 3. Check no duplicates (O(n²) but max 20 recipients)
            for (uint256 j; j < i;) {
                if (recipients[j].addr == addr) {
                    revert DuplicateRecipient(addr, j, i);
                }
                unchecked {
                    ++j;
                }
            }

            total += bps;
            unchecked {
                ++i;
            }
        }

        // 2. Check total == REQUIRED_SPLIT_TOTAL
        if (total != REQUIRED_SPLIT_TOTAL) {
            revert InvalidSplitTotal(total, REQUIRED_SPLIT_TOTAL);
        }
    }

    /// @dev Builds immutable args for clone
    /// @dev Layout: factory (20) + authority (20) + token (20) + uniqueId (32) + recipients (22 each)
    function _buildImmutableArgs(
        address authority_,
        address token,
        bytes32 uniqueId,
        Recipient[] calldata recipients
    ) internal view returns (bytes memory data) {
        // Start with fixed fields
        data = abi.encodePacked(
            address(this), // factory (20 bytes)
            authority_, // authority (20 bytes)
            token, // token (20 bytes)
            uniqueId // uniqueId (32 bytes)
        );

        // Append each recipient (22 bytes each: address + uint16)
        uint256 count = recipients.length;
        for (uint256 i; i < count;) {
            data = abi.encodePacked(data, recipients[i].addr, recipients[i].percentageBps);
            unchecked {
                ++i;
            }
        }
    }

    /// @dev Computes salt for CREATE2
    function _computeSalt(address authority_, address token, bytes32 uniqueId) internal pure returns (bytes32) {
        return keccak256(abi.encode(authority_, token, uniqueId));
    }
}
