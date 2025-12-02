// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.30;

import {SplitConfigImpl} from "../src/SplitConfigImpl.sol";
import {SplitFactory} from "../src/SplitFactory.sol";
import {Recipient} from "../src/Types.sol";
import {Test} from "forge-std/Test.sol";

// Solady's MockERC20 - no need to reinvent the wheel
import {MockERC20} from "solady/../test/utils/mocks/MockERC20.sol";

/// @title BaseTest
/// @notice Shared test harness for Cascade Splits EVM tests
abstract contract BaseTest is Test {
    // =========================================================================
    // Contracts
    // =========================================================================

    SplitFactory public factory;
    SplitConfigImpl public implementation;
    MockERC20 public token;

    // =========================================================================
    // Addresses
    // =========================================================================

    address public deployer;
    address public protocolAuthority;
    address public feeWallet;

    address public alice;
    address public bob;
    address public charlie;
    address public dave;
    address public eve;

    // =========================================================================
    // Constants
    // =========================================================================

    uint16 public constant PROTOCOL_FEE_BPS = 100; // 1%
    uint16 public constant REQUIRED_SPLIT_TOTAL = 9900; // 99%
    uint8 public constant MAX_RECIPIENTS = 20;

    // =========================================================================
    // Setup
    // =========================================================================

    function setUp() public virtual {
        // Create labeled addresses
        deployer = makeAddr("deployer");
        protocolAuthority = makeAddr("protocolAuthority");
        feeWallet = makeAddr("feeWallet");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");
        dave = makeAddr("dave");
        eve = makeAddr("eve");

        // Deploy mock token (USDC-like)
        token = new MockERC20("USD Coin", "USDC", 6);

        // Deploy implementation
        implementation = new SplitConfigImpl();

        // Deploy factory with explicit authority (required for CREATE2 compatibility)
        factory = new SplitFactory(address(implementation), feeWallet, protocolAuthority);
    }

    // =========================================================================
    // Recipient Helpers
    // =========================================================================

    /// @notice Create a simple 2-recipient split (49.5% each)
    function _twoRecipients() internal view returns (Recipient[] memory) {
        Recipient[] memory r = new Recipient[](2);
        r[0] = Recipient({addr: alice, percentageBps: 4950});
        r[1] = Recipient({addr: bob, percentageBps: 4950});
        return r;
    }

    /// @notice Create a 3-recipient split (33% each)
    function _threeRecipients() internal view returns (Recipient[] memory) {
        Recipient[] memory r = new Recipient[](3);
        r[0] = Recipient({addr: alice, percentageBps: 3300});
        r[1] = Recipient({addr: bob, percentageBps: 3300});
        r[2] = Recipient({addr: charlie, percentageBps: 3300});
        return r;
    }

    /// @notice Create a single recipient (99%)
    function _singleRecipient() internal view returns (Recipient[] memory) {
        Recipient[] memory r = new Recipient[](1);
        r[0] = Recipient({addr: alice, percentageBps: 9900});
        return r;
    }

    /// @notice Create max recipients (20 x 4.95%)
    function _maxRecipients() internal pure returns (Recipient[] memory) {
        Recipient[] memory r = new Recipient[](20);
        for (uint160 i; i < 20; i++) {
            r[i] = Recipient({addr: address(0x1000 + i), percentageBps: 495}); // 4.95% each = 99%
        }
        return r;
    }

    /// @notice Create recipients with custom percentages (must sum to 9900)
    function _customRecipients(
        address[] memory addrs,
        uint16[] memory bps
    ) internal pure returns (Recipient[] memory) {
        require(addrs.length == bps.length, "Length mismatch");
        Recipient[] memory r = new Recipient[](addrs.length);
        for (uint256 i; i < addrs.length; i++) {
            r[i] = Recipient({addr: addrs[i], percentageBps: bps[i]});
        }
        return r;
    }

    // =========================================================================
    // Token Helpers
    // =========================================================================

    /// @notice Fund a split contract with tokens
    function _fundSplit(
        address split,
        uint256 amount
    ) internal {
        token.mint(split, amount);
    }

    /// @notice Get token balance
    function _balance(
        address account
    ) internal view returns (uint256) {
        return token.balanceOf(account);
    }

    // =========================================================================
    // Mock Helpers (for simulating failures)
    // =========================================================================

    /// @notice Mock token transfer to always fail for a specific recipient
    /// @dev Use this to simulate blocklisted addresses
    function _mockTransferFail(
        address recipient
    ) internal {
        // Mock transfer(recipient, *) to return false
        vm.mockCall(address(token), abi.encodeWithSelector(token.transfer.selector, recipient), abi.encode(false));
    }

    /// @notice Mock token transfer to revert for a specific recipient
    function _mockTransferRevert(
        address recipient
    ) internal {
        vm.mockCallRevert(address(token), abi.encodeWithSelector(token.transfer.selector, recipient), "Blocklisted");
    }

    /// @notice Clear all mocks
    function _clearMocks() internal {
        vm.clearMockedCalls();
    }

    // =========================================================================
    // Assertion Helpers
    // =========================================================================

    /// @notice Assert that percentages sum to 9900
    function _assertValidTotal(
        Recipient[] memory recipients
    ) internal pure {
        uint256 total;
        for (uint256 i; i < recipients.length; i++) {
            total += recipients[i].percentageBps;
        }
        assertEq(total, REQUIRED_SPLIT_TOTAL, "Recipients must sum to 9900 bps");
    }
}
