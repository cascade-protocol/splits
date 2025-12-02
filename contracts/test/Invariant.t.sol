// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.30;

import {SplitConfigImpl} from "../src/SplitConfigImpl.sol";
import {SplitFactory} from "../src/SplitFactory.sol";
import {Recipient} from "../src/Types.sol";
import {Test, console} from "forge-std/Test.sol";
import {MockERC20} from "solady/../test/utils/mocks/MockERC20.sol";

/// @title SplitHandler
/// @notice Handler contract for invariant testing - performs random actions
contract SplitHandler is Test {
    SplitFactory public factory;
    SplitConfigImpl public split;
    MockERC20 public token;
    address public feeWallet;

    // Ghost variables for tracking
    uint256 public ghostTotalDeposited;
    uint256 public ghostTotalDistributed;
    uint256 public ghostExecutionCount;

    constructor(
        SplitFactory _factory,
        SplitConfigImpl _split,
        MockERC20 _token,
        address _feeWallet
    ) {
        factory = _factory;
        split = _split;
        token = _token;
        feeWallet = _feeWallet;
    }

    /// @notice Deposit random amount to split
    function deposit(
        uint256 amount
    ) external {
        amount = bound(amount, 0, 10_000_000e6); // 0 to 10M tokens
        if (amount == 0) return;

        token.mint(address(split), amount);
        ghostTotalDeposited += amount;
    }

    /// @notice Execute split (permissionless)
    function execute() external {
        uint256 balanceBefore = split.getBalance();

        split.executeSplit();

        ghostExecutionCount++;

        // Track what was distributed (balance change)
        uint256 balanceAfter = split.getBalance();

        if (balanceBefore > balanceAfter) {
            ghostTotalDistributed += (balanceBefore - balanceAfter);
        }
    }

    /// @notice Simulate failed transfer by mocking (for unclaimed testing)
    function depositWithFailedTransfer(
        uint256 amount,
        uint256 recipientIndex
    ) external {
        amount = bound(amount, 1e6, 1_000_000e6); // 1 to 1M tokens
        recipientIndex = bound(recipientIndex, 0, split.getRecipientCount() - 1);

        token.mint(address(split), amount);
        ghostTotalDeposited += amount;

        // Get recipient address
        Recipient[] memory recipients = split.getRecipients();
        address recipient = recipients[recipientIndex].addr;

        // Mock transfer to fail
        vm.mockCall(
            address(token), abi.encodeWithSignature("transfer(address,uint256)", recipient, 0), abi.encode(false)
        );

        // Execute - recipient's transfer will fail
        split.executeSplit();

        vm.clearMockedCalls();
        ghostExecutionCount++;
    }
}

/// @title InvariantTest
/// @notice Stateful invariant tests for SplitConfigImpl
/// @dev Run with: forge test --match-contract InvariantTest -vvv
contract InvariantTest is Test {
    SplitFactory public factory;
    SplitConfigImpl public implementation;
    SplitConfigImpl public split;
    MockERC20 public token;
    SplitHandler public handler;

    address public authority;
    address public feeWallet;
    address public alice;
    address public bob;
    address public charlie;

    function setUp() public {
        authority = makeAddr("authority");
        feeWallet = makeAddr("feeWallet");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");

        // Deploy contracts
        token = new MockERC20("USDC", "USDC", 6);
        implementation = new SplitConfigImpl();
        factory = new SplitFactory(address(implementation), feeWallet, authority);

        // Create a split with 3 recipients
        Recipient[] memory recipients = new Recipient[](3);
        recipients[0] = Recipient({addr: alice, percentageBps: 3300}); // 33%
        recipients[1] = Recipient({addr: bob, percentageBps: 3300}); // 33%
        recipients[2] = Recipient({addr: charlie, percentageBps: 3300}); // 33%

        address splitAddr =
            factory.createSplitConfig(authority, address(token), keccak256("invariant-test"), recipients);
        split = SplitConfigImpl(splitAddr);

        // Create handler
        handler = new SplitHandler(factory, split, token, feeWallet);

        // Target only the handler
        targetContract(address(handler));
    }

    // =========================================================================
    // INVARIANTS
    // =========================================================================

    /// @notice Balance must always be >= totalUnclaimed
    /// @dev Invariant from spec: "Contract holds at least enough for all unclaimed"
    function invariant_BalanceGteUnclaimed() public view {
        uint256 balance = split.getBalance();
        uint256 unclaimed = split.totalUnclaimed();

        assertGe(balance, unclaimed, "Invariant violated: balance < totalUnclaimed");
    }

    /// @notice Recipient percentages must sum to 9900 (99%)
    /// @dev Invariant from spec: "sum(percentageBps) == 9900"
    function invariant_RecipientsSumTo99Percent() public view {
        Recipient[] memory recipients = split.getRecipients();
        uint256 total;

        for (uint256 i; i < recipients.length; i++) {
            total += recipients[i].percentageBps;
        }

        assertEq(total, 9900, "Invariant violated: recipients don't sum to 99%");
    }

    /// @notice Recipient count must be between 1 and 20
    /// @dev Invariant from spec: "recipientCount >= 1 && <= 20"
    function invariant_RecipientCountInRange() public view {
        uint256 count = split.getRecipientCount();

        assertGe(count, 1, "Invariant violated: count < 1");
        assertLe(count, 20, "Invariant violated: count > 20");
    }

    /// @notice pendingAmount = balance - totalUnclaimed
    function invariant_PendingAmountCorrect() public view {
        uint256 balance = split.getBalance();
        uint256 unclaimed = split.totalUnclaimed();
        uint256 pending = split.pendingAmount();

        assertEq(pending, balance - unclaimed, "Invariant violated: pendingAmount != balance - unclaimed");
    }

    /// @notice hasPendingFunds consistency
    function invariant_HasPendingFundsConsistency() public view {
        bool hasPending = split.hasPendingFunds();
        uint256 pending = split.pendingAmount();

        if (hasPending) {
            assertGt(pending, 0, "Invariant violated: hasPendingFunds but pendingAmount == 0");
        } else {
            assertEq(pending, 0, "Invariant violated: !hasPendingFunds but pendingAmount > 0");
        }
    }

    /// @notice No tokens are lost (accounting invariant)
    /// @dev Total deposited should equal total distributed + current balance
    function invariant_NoTokensLost() public view {
        uint256 deposited = handler.ghostTotalDeposited();
        uint256 currentBalance = split.getBalance();

        // Get all recipient balances
        uint256 aliceBalance = token.balanceOf(alice);
        uint256 bobBalance = token.balanceOf(bob);
        uint256 charlieBalance = token.balanceOf(charlie);
        uint256 feeBalance = token.balanceOf(feeWallet);

        uint256 totalOutflows = aliceBalance + bobBalance + charlieBalance + feeBalance;
        uint256 totalAccounted = totalOutflows + currentBalance;

        assertEq(totalAccounted, deposited, "Invariant violated: tokens lost or created");
    }

    /// @notice Immutable args are actually immutable
    function invariant_ImmutableArgsUnchanged() public view {
        assertEq(split.factory(), address(factory), "Factory changed!");
        assertEq(split.authority(), authority, "Authority changed!");
        assertEq(split.token(), address(token), "Token changed!");
    }

    // =========================================================================
    // CALL SUMMARY (for debugging)
    // =========================================================================

    function invariant_callSummary() public view {
        console.log("------- Invariant Test Summary -------");
        console.log("Total deposited:", handler.ghostTotalDeposited());
        console.log("Total distributed:", handler.ghostTotalDistributed());
        console.log("Execution count:", handler.ghostExecutionCount());
        console.log("Current balance:", split.getBalance());
        console.log("Total unclaimed:", split.totalUnclaimed());
        console.log("Pending amount:", split.pendingAmount());
    }
}
