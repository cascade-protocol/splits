// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.30;

/// @dev Recipients array length not in [1, 20] range
error InvalidRecipientCount(uint256 count, uint256 min, uint256 max);

/// @dev Recipient percentages don't sum to 9900 bps (99%)
error InvalidSplitTotal(uint256 actual, uint256 expected);

/// @dev Same recipient address appears multiple times
error DuplicateRecipient(address recipient, uint256 firstIndex, uint256 duplicateIndex);

/// @dev Recipient or feeWallet address is zero
error ZeroAddress(uint256 index);

/// @dev Recipient has 0 bps allocation
error ZeroPercentage(uint256 index);

/// @dev Caller not authorized for this operation
error Unauthorized(address caller, address expected);

/// @dev No pending authority transfer to accept
error NoPendingTransfer();

/// @dev Split with identical params already deployed at this address
error SplitAlreadyExists(address predicted);

/// @dev Implementation address has no deployed code
error InvalidImplementation(address implementation);

/// @dev Reentrant call detected
error Reentrancy();
