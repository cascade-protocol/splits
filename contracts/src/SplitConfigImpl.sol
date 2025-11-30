// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.30;

import {Reentrancy} from "./Errors.sol";
import {Recipient} from "./Types.sol";
import {ISplitFactory} from "./interfaces/ISplitFactory.sol";

/// @title SplitConfigImpl
/// @notice Implementation contract for Cascade Split configurations
/// @dev Deployed as EIP-1167 clones with immutable args encoded in bytecode
contract SplitConfigImpl {
    // =========================================================================
    // Constants
    // =========================================================================

    /// @notice Bitmap index for protocol fee (recipients use 0-19)
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

    // =========================================================================
    // Modifiers
    // =========================================================================

    /// @dev Transient storage reentrancy guard (EIP-1153)
    modifier nonReentrant() {
        assembly {
            if tload(0) { revert(0, 0) }
            tstore(0, 1)
        }
        _;
        assembly {
            tstore(0, 0)
        }
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

    /// @notice Preview what executeSplit would distribute without executing
    /// @return recipientAmounts Amount each recipient would receive
    /// @return protocolFee Amount protocol would receive (1% + dust)
    /// @return available Total amount being distributed
    function previewExecution()
        public
        view
        returns (uint256[] memory recipientAmounts, uint256 protocolFee, uint256 available)
    {
        uint256 count = getRecipientCount();
        recipientAmounts = new uint256[](count);

        available = pendingAmount();
        if (available == 0) return (recipientAmounts, 0, 0);

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
                address to = i == PROTOCOL_INDEX ? feeWalletAddr : _getRecipientAddress(i);

                if (_attemptTransfer(tokenAddr, to, amount)) {
                    _unclaimedByIndex[i] = 0;
                    _unclaimedBitmap &= ~(1 << i);
                    cleared += amount;
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

    /// @dev Attempts a transfer without recording unclaimed on failure
    function _attemptTransfer(address tokenAddr, address to, uint256 amount) internal returns (bool) {
        (bool ok, bytes memory data) = tokenAddr.call(abi.encodeWithSignature("transfer(address,uint256)", to, amount));
        return ok && (data.length == 0 || abi.decode(data, (bool)));
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
        (bool ok, bytes memory data) = tokenAddr.call(abi.encodeWithSignature("transfer(address,uint256)", to, amount));

        success = ok && (data.length == 0 || abi.decode(data, (bool)));

        if (!success) {
            _unclaimedByIndex[index] += amount;
            _unclaimedBitmap |= (1 << index);
            emit TransferFailed(to, amount, index == PROTOCOL_INDEX);
        }
    }
}
