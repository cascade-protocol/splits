// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

/**
 * @title SplitConfig
 * @notice Non-custodial payment splitting for x402 micropayments
 * @dev Deployed as EIP-1167 minimal proxy clones via SplitFactory
 *
 * Naming aligned with Solana implementation for cross-chain parity.
 *
 * Design:
 * - Receives payments directly (use address as x402 payTo)
 * - Anyone can call executeSplit() to distribute funds
 * - 1% protocol fee, recipients share remaining 99%
 * - Self-healing: failed transfers go to unclaimed, auto-retry on next execute
 */
contract SplitConfig is Initializable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint16 public constant PROTOCOL_FEE_BPS = 100; // 1%
    uint16 public constant REQUIRED_SPLIT_TOTAL = 9900; // 99%
    uint8 public constant MIN_RECIPIENTS = 1;
    uint8 public constant MAX_RECIPIENTS = 20;

    // ============ Structs ============

    /// @notice Recipient configuration
    struct Recipient {
        address addr;
        uint16 percentageBps; // 1-9900
    }

    // ============ State ============

    address public factory;
    address public authority;
    address public token;
    bytes32 public uniqueId;

    Recipient[] internal _recipients;

    // Self-healing: track failed transfers
    mapping(address => uint256) public unclaimedAmounts;
    address[] internal _unclaimedRecipients;
    uint256 public protocolUnclaimed;

    // ============ Events ============

    event SplitConfigCreated(
        address indexed splitConfig,
        address indexed authority,
        address indexed token,
        bytes32 uniqueId
    );

    event SplitExecuted(
        address indexed splitConfig,
        uint256 totalAmount,
        uint256 recipientsDistributed,
        uint256 protocolFee,
        uint256 heldAsUnclaimed,
        uint256 unclaimedCleared,
        uint256 protocolUnclaimedCleared,
        address executor
    );

    event SplitConfigUpdated(
        address indexed splitConfig,
        Recipient[] recipients
    );

    event AuthorityTransferred(
        address indexed splitConfig,
        address indexed oldAuthority,
        address indexed newAuthority
    );

    // ============ Errors ============

    error InvalidRecipientCount();
    error InvalidSplitTotal();
    error DuplicateRecipient();
    error ZeroAddress();
    error ZeroPercentage();
    error SplitNotEmpty();
    error UnclaimedNotEmpty();
    error Unauthorized();

    // ============ Modifiers ============

    modifier onlyAuthority() {
        if (msg.sender != authority) revert Unauthorized();
        _;
    }

    // ============ Initialization ============

    /**
     * @notice Initialize the split config (called by factory on clone deployment)
     * @param _authority Address that controls this split config
     * @param _token ERC20 token this split accepts
     * @param _uniqueId Unique identifier for deterministic addressing
     * @param _recipientList Array of recipients with their percentage basis points
     */
    function initialize(
        address _authority,
        address _token,
        bytes32 _uniqueId,
        Recipient[] calldata _recipientList
    ) external initializer {
        if (_authority == address(0) || _token == address(0)) revert ZeroAddress();

        factory = msg.sender;
        authority = _authority;
        token = _token;
        uniqueId = _uniqueId;

        _setRecipients(_recipientList);
    }

    // ============ Core Instructions ============

    /**
     * @notice Distribute balance to recipients
     * @dev Permissionless - anyone can trigger distribution
     *      Self-healing: also attempts to clear any pending unclaimed amounts
     */
    function executeSplit() external nonReentrant {
        uint256 balance = IERC20(token).balanceOf(address(this));
        uint256 totalUnclaimed = _getTotalUnclaimed();
        uint256 available = balance > totalUnclaimed ? balance - totalUnclaimed : 0;

        uint256 recipientsDistributed;
        uint256 protocolFee;
        uint256 heldAsUnclaimed;
        uint256 unclaimedCleared;
        uint256 protocolUnclaimedCleared;

        // Distribute new funds
        if (available > 0) {
            protocolFee = (available * PROTOCOL_FEE_BPS) / 10000;
            uint256 distributable = available - protocolFee;

            for (uint256 i = 0; i < _recipients.length; i++) {
                uint256 share = (distributable * _recipients[i].percentageBps) / REQUIRED_SPLIT_TOTAL;

                if (_safeTransfer(_recipients[i].addr, share)) {
                    recipientsDistributed += share;
                } else {
                    _addUnclaimed(_recipients[i].addr, share);
                    heldAsUnclaimed += share;
                }
            }

            // Protocol fee (remainder goes to protocol to handle dust)
            uint256 currentBalance = IERC20(token).balanceOf(address(this));
            uint256 protocolAmount = currentBalance - totalUnclaimed - heldAsUnclaimed;
            if (!_safeTransfer(_getFeeWallet(), protocolAmount)) {
                protocolUnclaimed += protocolAmount;
            }
        }

        // Self-healing: attempt to clear unclaimed
        (unclaimedCleared, protocolUnclaimedCleared) = _clearUnclaimed();

        emit SplitExecuted(
            address(this),
            available,
            recipientsDistributed,
            protocolFee,
            heldAsUnclaimed,
            unclaimedCleared,
            protocolUnclaimedCleared,
            msg.sender
        );
    }

    /**
     * @notice Update recipient configuration
     * @dev Split must be empty (execute pending splits first)
     * @param _recipientList New recipient array
     */
    function updateSplitConfig(Recipient[] calldata _recipientList) external onlyAuthority {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance > 0) revert SplitNotEmpty();
        if (_getTotalUnclaimed() > 0) revert UnclaimedNotEmpty();

        // Clear existing recipients
        delete _recipients;

        _setRecipients(_recipientList);

        emit SplitConfigUpdated(address(this), _recipientList);
    }

    /**
     * @notice Transfer authority to new address
     * @param newAuthority New authority address
     */
    function transferAuthority(address newAuthority) external onlyAuthority {
        if (newAuthority == address(0)) revert ZeroAddress();

        address oldAuthority = authority;
        authority = newAuthority;

        emit AuthorityTransferred(address(this), oldAuthority, newAuthority);
    }

    // ============ View Functions ============

    /**
     * @notice Get all recipients
     */
    function getRecipients() external view returns (Recipient[] memory) {
        return _recipients;
    }

    /**
     * @notice Get recipient count
     */
    function getRecipientCount() external view returns (uint256) {
        return _recipients.length;
    }

    /**
     * @notice Preview execution distribution
     */
    function previewExecution() external view returns (
        uint256[] memory recipientAmounts,
        uint256 protocolAmount,
        uint256 available
    ) {
        uint256 balance = IERC20(token).balanceOf(address(this));
        uint256 totalUnclaimed = _getTotalUnclaimed();
        available = balance > totalUnclaimed ? balance - totalUnclaimed : 0;

        if (available == 0) {
            return (new uint256[](_recipients.length), 0, 0);
        }

        protocolAmount = (available * PROTOCOL_FEE_BPS) / 10000;
        uint256 distributable = available - protocolAmount;

        recipientAmounts = new uint256[](_recipients.length);
        for (uint256 i = 0; i < _recipients.length; i++) {
            recipientAmounts[i] = (distributable * _recipients[i].percentageBps) / REQUIRED_SPLIT_TOTAL;
        }
    }

    /**
     * @notice Check if split has pending funds
     */
    function hasPendingFunds() external view returns (bool) {
        uint256 balance = IERC20(token).balanceOf(address(this));
        uint256 totalUnclaimed = _getTotalUnclaimed();
        return balance > totalUnclaimed;
    }

    /**
     * @notice Get amount available for next execution
     */
    function pendingAmount() external view returns (uint256) {
        uint256 balance = IERC20(token).balanceOf(address(this));
        uint256 totalUnclaimed = _getTotalUnclaimed();
        return balance > totalUnclaimed ? balance - totalUnclaimed : 0;
    }

    /**
     * @notice Check if this is a Cascade Split
     */
    function isCascadeSplitConfig() external pure returns (bool) {
        return true;
    }

    /**
     * @notice Get split balance
     */
    function getBalance() external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    // ============ Internal Functions ============

    function _setRecipients(Recipient[] calldata _recipientList) internal {
        if (_recipientList.length < MIN_RECIPIENTS || _recipientList.length > MAX_RECIPIENTS) {
            revert InvalidRecipientCount();
        }

        uint256 totalBps;

        for (uint256 i = 0; i < _recipientList.length; i++) {
            if (_recipientList[i].addr == address(0)) revert ZeroAddress();
            if (_recipientList[i].percentageBps == 0) revert ZeroPercentage();

            // Check for duplicates
            for (uint256 j = 0; j < i; j++) {
                if (_recipientList[j].addr == _recipientList[i].addr) {
                    revert DuplicateRecipient();
                }
            }

            totalBps += _recipientList[i].percentageBps;
            _recipients.push(_recipientList[i]);
        }

        if (totalBps != REQUIRED_SPLIT_TOTAL) revert InvalidSplitTotal();
    }

    function _safeTransfer(address to, uint256 amount) internal returns (bool) {
        if (amount == 0) return true;

        try IERC20(token).transfer(to, amount) returns (bool success) {
            return success;
        } catch {
            return false;
        }
    }

    function _addUnclaimed(address recipient, uint256 amount) internal {
        if (unclaimedAmounts[recipient] == 0) {
            _unclaimedRecipients.push(recipient);
        }
        unclaimedAmounts[recipient] += amount;
    }

    function _clearUnclaimed() internal returns (uint256 cleared, uint256 protocolCleared) {
        // Try to clear recipient unclaimed
        for (uint256 i = _unclaimedRecipients.length; i > 0; i--) {
            address recipient = _unclaimedRecipients[i - 1];
            uint256 amount = unclaimedAmounts[recipient];

            if (_safeTransfer(recipient, amount)) {
                cleared += amount;
                unclaimedAmounts[recipient] = 0;
                _unclaimedRecipients[i - 1] = _unclaimedRecipients[_unclaimedRecipients.length - 1];
                _unclaimedRecipients.pop();
            }
        }

        // Try to clear protocol unclaimed
        if (protocolUnclaimed > 0) {
            if (_safeTransfer(_getFeeWallet(), protocolUnclaimed)) {
                protocolCleared = protocolUnclaimed;
                protocolUnclaimed = 0;
            }
        }
    }

    function _getTotalUnclaimed() internal view returns (uint256 total) {
        for (uint256 i = 0; i < _unclaimedRecipients.length; i++) {
            total += unclaimedAmounts[_unclaimedRecipients[i]];
        }
        total += protocolUnclaimed;
    }

    function _getFeeWallet() internal view returns (address) {
        return ISplitFactory(factory).feeWallet();
    }
}

interface ISplitFactory {
    function feeWallet() external view returns (address);
}
