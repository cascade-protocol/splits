// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.30;

import {Recipient} from "../Types.sol";

/// @title ISplitConfigImpl
/// @notice Interface for interacting with deployed split configurations
/// @dev Use this interface for SDK integrations and cross-contract calls
interface ISplitConfigImpl {
    // =========================================================================
    // Events
    // =========================================================================

    /// @notice Emitted when split is executed
    event SplitExecuted(uint256 totalAmount, uint256 protocolFee, uint256 unclaimedCleared, uint256 newUnclaimed);

    /// @notice Emitted when a transfer fails
    event TransferFailed(address indexed recipient, uint256 amount, bool isProtocol);

    /// @notice Emitted when previously unclaimed funds are successfully delivered
    event UnclaimedCleared(address indexed recipient, uint256 amount, bool isProtocol);

    // =========================================================================
    // Immutable Args Readers
    // =========================================================================

    /// @notice Returns the factory address that deployed this split
    function factory() external view returns (address);

    /// @notice Returns the split authority (namespace/creator)
    function authority() external view returns (address);

    /// @notice Returns the token address this split distributes
    function token() external view returns (address);

    /// @notice Returns the unique identifier for this split
    function uniqueId() external view returns (bytes32);

    /// @notice Returns the number of recipients (derived from code size)
    function getRecipientCount() external view returns (uint256);

    /// @notice Returns all configured recipients
    function getRecipients() external view returns (Recipient[] memory);

    /// @notice Returns true (for Cascade Split detection)
    function isCascadeSplitConfig() external pure returns (bool);

    // =========================================================================
    // View Functions
    // =========================================================================

    /// @notice Returns total unclaimed across all recipients + protocol
    function totalUnclaimed() external view returns (uint256);

    /// @notice Returns true if there are pending funds to distribute
    function hasPendingFunds() external view returns (bool);

    /// @notice Returns amount available for next execution
    function pendingAmount() external view returns (uint256);

    /// @notice Returns total token balance held by this contract
    function getBalance() external view returns (uint256);

    /// @notice Preview complete execution outcome including pending unclaimed
    /// @return recipientAmounts Amount each recipient would receive from new funds
    /// @return protocolFee Amount protocol would receive from new funds (1% + dust)
    /// @return available Total new funds being distributed
    /// @return pendingRecipientAmounts Unclaimed amounts per recipient that would be retried
    /// @return pendingProtocolAmount Unclaimed protocol fee that would be retried
    function previewExecution()
        external
        view
        returns (
            uint256[] memory recipientAmounts,
            uint256 protocolFee,
            uint256 available,
            uint256[] memory pendingRecipientAmounts,
            uint256 pendingProtocolAmount
        );

    // =========================================================================
    // External Functions
    // =========================================================================

    /// @notice Distributes available balance to recipients and protocol
    /// @dev Automatically retries any pending unclaimed transfers
    function executeSplit() external;
}
