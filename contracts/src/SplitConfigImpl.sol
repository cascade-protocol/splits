// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.30;

import {ReentrancyGuardTransient} from "solady/utils/ReentrancyGuardTransient.sol";

import {Recipient} from "./Types.sol";
import {ISplitFactory} from "./interfaces/ISplitFactory.sol";

/// @title SplitConfigImpl
/// @notice Implementation contract for Cascade Split configurations
/// @dev Deployed as EIP-1167 clones with immutable args encoded in bytecode
contract SplitConfigImpl is ReentrancyGuardTransient {
    // =========================================================================
    // Constants
    // =========================================================================

    /// @notice Bitmap index for protocol fee
    /// @dev Must equal MAX_RECIPIENTS (20). Recipients use indices 0-19.
    uint256 public constant PROTOCOL_INDEX = 20;

    /// @notice Basis points divisor
    uint256 private constant BPS_DIVISOR = 10_000;

    // =========================================================================
    // Clone Bytecode Offsets
    // =========================================================================
    // Immutable args are stored after the 0x2d (45 byte) proxy prefix
    // Layout: factory (20) + authority (20) + token (20) + uniqueId (32) + recipients (22 each)

    uint256 private constant _PROXY_PREFIX = 0x2d;
    uint256 private constant _FACTORY_OFFSET = 0;
    uint256 private constant _AUTHORITY_OFFSET = 20;
    uint256 private constant _TOKEN_OFFSET = 40;
    uint256 private constant _UNIQUE_ID_OFFSET = 60;
    uint256 private constant _RECIPIENTS_OFFSET = 92;
    uint256 private constant _RECIPIENT_SIZE = 22; // address (20) + uint16 (2)
    uint256 private constant _FIXED_ARGS_SIZE = 92; // factory + authority + token + uniqueId

    // =========================================================================
    // Storage
    // =========================================================================

    /// @dev Bitmap tracking which indices have unclaimed amounts (bits 0-20)
    uint256 private _unclaimedBitmap;

    /// @dev Mapping from index to unclaimed amount
    mapping(uint256 => uint256) private _unclaimedByIndex;

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
    // Solady ReentrancyGuardTransient Override
    // =========================================================================

    /// @dev Always use transient storage for reentrancy guard (Base L2 supports EIP-1153)
    function _useTransientReentrancyGuardOnlyOnMainnet() internal pure override returns (bool) {
        return false;
    }

    // =========================================================================
    // Immutable Args Readers (via EXTCODECOPY)
    // =========================================================================

    /// @notice Returns the factory address
    function factory() public view returns (address result) {
        assembly {
            extcodecopy(address(), 0x00, 0x2d, 0x20)
            result := shr(96, mload(0x00))
        }
    }

    /// @notice Returns the split authority
    function authority() public view returns (address result) {
        assembly {
            extcodecopy(address(), 0x00, add(0x2d, 20), 0x20)
            result := shr(96, mload(0x00))
        }
    }

    /// @notice Returns the token address
    function token() public view returns (address result) {
        assembly {
            extcodecopy(address(), 0x00, add(0x2d, 40), 0x20)
            result := shr(96, mload(0x00))
        }
    }

    /// @notice Returns the unique identifier
    function uniqueId() public view returns (bytes32 result) {
        assembly {
            extcodecopy(address(), 0x00, add(0x2d, 60), 0x20)
            result := mload(0x00)
        }
    }

    /// @notice Returns the number of recipients (derived from code size)
    function getRecipientCount() public view returns (uint256) {
        return (address(this).code.length - _PROXY_PREFIX - _FIXED_ARGS_SIZE) / _RECIPIENT_SIZE;
    }

    /// @notice Returns all configured recipients
    function getRecipients() public view returns (Recipient[] memory recipients) {
        uint256 count = getRecipientCount();
        recipients = new Recipient[](count);
        for (uint256 i; i < count;) {
            (address addr, uint16 bps) = _getRecipient(i);
            recipients[i] = Recipient(addr, bps);
            unchecked {
                ++i;
            }
        }
    }

    /// @notice Returns true (for Cascade Split detection)
    function isCascadeSplitConfig() external pure returns (bool) {
        return true;
    }

    // =========================================================================
    // View Functions
    // =========================================================================

    /// @notice Returns total unclaimed across all recipients + protocol
    function totalUnclaimed() public view returns (uint256 total) {
        uint256 bitmap = _unclaimedBitmap;
        if (bitmap == 0) return 0;

        for (uint256 i; i < 21;) {
            if (bitmap & (1 << i) != 0) {
                total += _unclaimedByIndex[i];
            }
            unchecked {
                ++i;
            }
        }
    }

    /// @notice Returns true if there are pending funds to distribute
    function hasPendingFunds() public view returns (bool) {
        return pendingAmount() > 0;
    }

    /// @notice Returns amount available for next execution
    function pendingAmount() public view returns (uint256) {
        return getBalance() - totalUnclaimed();
    }

    /// @notice Returns total token balance held by this contract
    function getBalance() public view returns (uint256) {
        return _getBalance(token());
    }

    /// @dev Internal balance check with cached token address
    function _getBalance(address tokenAddr) internal view returns (uint256) {
        (bool success, bytes memory data) =
            tokenAddr.staticcall(abi.encodeWithSignature("balanceOf(address)", address(this)));
        if (!success || data.length < 32) return 0;
        return abi.decode(data, (uint256));
    }

    /// @notice Preview complete execution outcome including pending unclaimed
    /// @return recipientAmounts Amount each recipient would receive from new funds
    /// @return protocolFee Amount protocol would receive from new funds (1% + dust)
    /// @return available Total new funds being distributed
    /// @return pendingRecipientAmounts Unclaimed amounts per recipient that would be retried
    /// @return pendingProtocolAmount Unclaimed protocol fee that would be retried
    function previewExecution()
        public
        view
        returns (
            uint256[] memory recipientAmounts,
            uint256 protocolFee,
            uint256 available,
            uint256[] memory pendingRecipientAmounts,
            uint256 pendingProtocolAmount
        )
    {
        uint256 count = getRecipientCount();
        recipientAmounts = new uint256[](count);
        pendingRecipientAmounts = new uint256[](count);

        // Calculate pending unclaimed amounts
        uint256 bitmap = _unclaimedBitmap;
        if (bitmap != 0) {
            for (uint256 i; i < count;) {
                if (bitmap & (1 << i) != 0) {
                    pendingRecipientAmounts[i] = _unclaimedByIndex[i];
                }
                unchecked {
                    ++i;
                }
            }
            if (bitmap & (1 << PROTOCOL_INDEX) != 0) {
                pendingProtocolAmount = _unclaimedByIndex[PROTOCOL_INDEX];
            }
        }

        // Calculate new distribution
        available = pendingAmount();
        if (available == 0) return (recipientAmounts, 0, 0, pendingRecipientAmounts, pendingProtocolAmount);

        uint256 distributed;
        for (uint256 i; i < count;) {
            (, uint16 bps) = _getRecipient(i);
            recipientAmounts[i] = (available * bps) / BPS_DIVISOR;
            distributed += recipientAmounts[i];
            unchecked {
                ++i;
            }
        }

        protocolFee = available - distributed; // 1% + dust
    }

    // =========================================================================
    // External Functions
    // =========================================================================

    /// @notice Distributes available balance to recipients and protocol
    /// @dev Automatically retries any pending unclaimed transfers
    function executeSplit() external nonReentrant {
        // Cache immutable args and external calls once
        address tokenAddr = token();
        address feeWalletAddr = ISplitFactory(factory()).feeWallet();

        // Step 1-2: Clear pending unclaimed
        uint256 unclaimedCleared = _clearPendingUnclaimed(tokenAddr, feeWalletAddr);

        // Step 3: Calculate available (balance - unclaimed)
        uint256 available = _getBalance(tokenAddr) - totalUnclaimed();

        // Step 4: Distribute if available > 0
        (uint256 totalDistributed, uint256 protocolFee, uint256 newUnclaimed) =
            _distribute(available, tokenAddr, feeWalletAddr);

        // Step 5: Emit event
        emit SplitExecuted(totalDistributed, protocolFee, unclaimedCleared, newUnclaimed);
    }

    /// @dev Retries all pending unclaimed transfers
    /// @param tokenAddr Cached token address
    /// @param feeWalletAddr Cached fee wallet address
    /// @return cleared Total amount successfully cleared
    function _clearPendingUnclaimed(address tokenAddr, address feeWalletAddr) internal returns (uint256 cleared) {
        uint256 bitmap = _unclaimedBitmap;
        if (bitmap == 0) return 0;

        for (uint256 i; i < 21;) {
            if (bitmap & (1 << i) != 0) {
                uint256 amount = _unclaimedByIndex[i];
                bool isProtocol = i == PROTOCOL_INDEX;
                address to = isProtocol ? feeWalletAddr : _getRecipientAddress(i);

                if (_trySafeTransfer(tokenAddr, to, amount)) {
                    _unclaimedByIndex[i] = 0;
                    _unclaimedBitmap &= ~(1 << i);
                    cleared += amount;
                    emit UnclaimedCleared(to, amount, isProtocol);
                } else {
                    // Retry failed again - emit for monitoring/indexing
                    emit TransferFailed(to, amount, isProtocol);
                }
            }
            unchecked {
                ++i;
            }
        }
    }

    /// @dev Distributes available amount to recipients and protocol
    /// @param available Amount to distribute
    /// @param tokenAddr Cached token address
    /// @param feeWalletAddr Cached fee wallet address
    function _distribute(
        uint256 available,
        address tokenAddr,
        address feeWalletAddr
    ) internal returns (uint256 totalDistributed, uint256 protocolFee, uint256 newUnclaimed) {
        if (available == 0) return (0, 0, 0);

        uint256 count = getRecipientCount();
        uint256 distributed;

        // Distribute to recipients
        for (uint256 i; i < count;) {
            (address to, uint16 bps) = _getRecipient(i);
            uint256 amount = (available * bps) / BPS_DIVISOR;

            if (amount > 0) {
                distributed += amount;
                if (_safeTransferWithFallback(tokenAddr, to, amount, i)) {
                    totalDistributed += amount;
                } else {
                    newUnclaimed += amount;
                }
            }
            unchecked {
                ++i;
            }
        }

        // Protocol gets remainder (1% + dust)
        protocolFee = available - distributed;
        if (protocolFee > 0) {
            if (_safeTransferWithFallback(tokenAddr, feeWalletAddr, protocolFee, PROTOCOL_INDEX)) {
                totalDistributed += protocolFee;
            } else {
                newUnclaimed += protocolFee;
            }
        }
    }

    /// @dev Gets recipient address by index (for unclaimed clearing)
    function _getRecipientAddress(uint256 index) internal view returns (address addr) {
        (addr,) = _getRecipient(index);
    }

    // =========================================================================
    // Internal Functions
    // =========================================================================

    /// @dev Reads a recipient from clone bytecode
    function _getRecipient(uint256 index) internal view returns (address addr, uint16 bps) {
        uint256 offset = _PROXY_PREFIX + _RECIPIENTS_OFFSET + (index * _RECIPIENT_SIZE);
        assembly {
            extcodecopy(address(), 0x00, offset, 0x20)
            addr := shr(96, mload(0x00))
            extcodecopy(address(), 0x00, add(offset, 20), 0x20)
            bps := shr(240, mload(0x00))
        }
    }

    /// @dev Attempts ERC20 transfer without reverting. Returns success status.
    /// @dev Follows Solady's SafeTransferLib pattern for robust token handling.
    /// @param tokenAddr The ERC20 token address
    /// @param to Recipient address
    /// @param amount Amount to transfer
    /// @return success True if transfer succeeded
    function _trySafeTransfer(address tokenAddr, address to, uint256 amount) internal returns (bool success) {
        /// @solidity memory-safe-assembly
        assembly {
            // Store transfer(address,uint256) selector and arguments
            mstore(0x14, to) // Store `to` at offset 0x14 (right-padded in 32 bytes)
            mstore(0x34, amount) // Store `amount` at offset 0x34
            mstore(0x00, 0xa9059cbb000000000000000000000000) // transfer(address,uint256) selector

            // Call token.transfer(to, amount)
            // calldata starts at 0x10 (selector at 0x10-0x14, to at 0x14-0x34, amount at 0x34-0x54)
            success := call(gas(), tokenAddr, 0, 0x10, 0x44, 0x00, 0x20)

            // Check return value:
            // - If call failed (success=0), check if it's because there's no code at tokenAddr
            // - If call succeeded, check return data:
            //   - No return data (USDT style): success
            //   - Return data == true: success
            //   - Return data == false or other: failure
            if iszero(and(eq(mload(0x00), 1), success)) {
                // Success if: call succeeded AND (no code at token OR returndata is empty OR returned true)
                success := lt(or(iszero(extcodesize(tokenAddr)), returndatasize()), success)
            }

            // Restore the part of the free memory pointer that was overwritten
            mstore(0x34, 0)
        }
    }

    /// @dev Attempts transfer with self-healing fallback
    /// @param tokenAddr The ERC20 token address
    /// @param to Recipient address
    /// @param amount Amount to transfer
    /// @param index Bitmap index for unclaimed tracking
    /// @return success True if transfer succeeded
    function _safeTransferWithFallback(
        address tokenAddr,
        address to,
        uint256 amount,
        uint256 index
    ) internal returns (bool success) {
        success = _trySafeTransfer(tokenAddr, to, amount);

        if (!success) {
            // Record as unclaimed for retry on next execution
            _unclaimedByIndex[index] += amount;
            _unclaimedBitmap |= (1 << index);
            emit TransferFailed(to, amount, index == PROTOCOL_INDEX);
        }
    }
}
