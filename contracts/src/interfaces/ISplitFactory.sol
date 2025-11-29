// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.30;

import {Recipient} from "../Types.sol";

/// @title ISplitFactory
/// @notice Factory interface for SplitConfig to read protocol configuration
interface ISplitFactory {
    /// @notice Returns the protocol fee wallet address
    function feeWallet() external view returns (address);

    /// @notice Returns the current implementation used for new splits
    function currentImplementation() external view returns (address);

    /// @notice Returns the protocol authority address
    function authority() external view returns (address);

    /// @notice Creates a new split configuration
    /// @param authority_ Address that owns the split (can be any address, enables sponsored creation)
    /// @param token ERC20 token address (e.g., USDC)
    /// @param uniqueId Unique identifier (enables multiple splits per authority/token pair)
    /// @param recipients Array of recipients with percentage allocations (must sum to 9900 bps)
    /// @return split Deployed split clone address
    function createSplitConfig(
        address authority_,
        address token,
        bytes32 uniqueId,
        Recipient[] calldata recipients
    ) external returns (address split);

    /// @notice Computes the deterministic address for a split with given parameters
    /// @param authority_ The split authority
    /// @param token The token address
    /// @param uniqueId The unique identifier
    /// @param recipients The recipients array
    /// @return The predicted split address
    function predictSplitAddress(
        address authority_,
        address token,
        bytes32 uniqueId,
        Recipient[] calldata recipients
    ) external view returns (address);
}
