// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {SplitConfig} from "../src/SplitConfig.sol";
import {SplitFactory} from "../src/SplitFactory.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

contract SplitConfigTest is Test {
    SplitFactory factory;
    MockUSDC usdc;

    address feeWallet = makeAddr("feeWallet");
    address authority = makeAddr("authority");
    address platform = makeAddr("platform");
    address merchant = makeAddr("merchant");
    address payer = makeAddr("payer");

    function setUp() public {
        factory = new SplitFactory(feeWallet);
        usdc = new MockUSDC();

        // Fund payer
        usdc.mint(payer, 1_000_000e6); // 1M USDC
    }

    // ============ Factory Tests ============

    function test_createSplitConfig() public {
        SplitConfig.Recipient[] memory recipients = new SplitConfig.Recipient[](2);
        recipients[0] = SplitConfig.Recipient(platform, 900);   // 9%
        recipients[1] = SplitConfig.Recipient(merchant, 9000);  // 90%

        bytes32 uniqueId = keccak256("test-split-1");

        // Predict address before deployment
        address predicted = factory.computeSplitAddress(authority, address(usdc), uniqueId);

        // Create split config
        address splitConfig = factory.createSplitConfig(authority, address(usdc), uniqueId, recipients);

        // Verify deterministic address
        assertEq(splitConfig, predicted);

        // Verify configuration
        SplitConfig sc = SplitConfig(splitConfig);
        assertEq(sc.authority(), authority);
        assertEq(sc.token(), address(usdc));
        assertEq(sc.getRecipientCount(), 2);
    }

    function test_cannotCreateDuplicateSplitConfig() public {
        SplitConfig.Recipient[] memory recipients = new SplitConfig.Recipient[](1);
        recipients[0] = SplitConfig.Recipient(merchant, 9900);

        bytes32 uniqueId = keccak256("duplicate-test");

        factory.createSplitConfig(authority, address(usdc), uniqueId, recipients);

        vm.expectRevert(SplitFactory.SplitAlreadyExists.selector);
        factory.createSplitConfig(authority, address(usdc), uniqueId, recipients);
    }

    // ============ Execution Tests ============

    function test_executeSplit() public {
        // Setup split: 9% platform, 90% merchant, 1% protocol
        SplitConfig.Recipient[] memory recipients = new SplitConfig.Recipient[](2);
        recipients[0] = SplitConfig.Recipient(platform, 900);
        recipients[1] = SplitConfig.Recipient(merchant, 9000);

        address splitConfig = factory.createSplitConfig(
            authority,
            address(usdc),
            keccak256("execute-test"),
            recipients
        );

        // Send 100 USDC to split
        vm.prank(payer);
        usdc.transfer(splitConfig, 100e6);

        // Execute split
        SplitConfig(splitConfig).executeSplit();

        // Verify distribution
        assertApproxEqAbs(usdc.balanceOf(platform), 9e6, 1e4);      // ~9 USDC
        assertApproxEqAbs(usdc.balanceOf(merchant), 90e6, 1e4);     // ~90 USDC
        assertApproxEqAbs(usdc.balanceOf(feeWallet), 1e6, 1e4);     // ~1 USDC
    }

    function test_multipleExecutions() public {
        SplitConfig.Recipient[] memory recipients = new SplitConfig.Recipient[](1);
        recipients[0] = SplitConfig.Recipient(merchant, 9900);

        address splitConfig = factory.createSplitConfig(
            authority,
            address(usdc),
            keccak256("multi-exec"),
            recipients
        );

        // First payment
        vm.prank(payer);
        usdc.transfer(splitConfig, 100e6);
        SplitConfig(splitConfig).executeSplit();

        uint256 merchantBal1 = usdc.balanceOf(merchant);

        // Second payment
        vm.prank(payer);
        usdc.transfer(splitConfig, 50e6);
        SplitConfig(splitConfig).executeSplit();

        uint256 merchantBal2 = usdc.balanceOf(merchant);

        // Merchant received both payments
        assertGt(merchantBal2, merchantBal1);
        assertApproxEqAbs(merchantBal2, 148.5e6, 1e4); // 99% of 150
    }

    function test_idempotentExecution() public {
        SplitConfig.Recipient[] memory recipients = new SplitConfig.Recipient[](1);
        recipients[0] = SplitConfig.Recipient(merchant, 9900);

        address splitConfig = factory.createSplitConfig(
            authority,
            address(usdc),
            keccak256("idempotent"),
            recipients
        );

        vm.prank(payer);
        usdc.transfer(splitConfig, 100e6);

        // Execute multiple times
        SplitConfig(splitConfig).executeSplit();
        uint256 bal1 = usdc.balanceOf(merchant);

        SplitConfig(splitConfig).executeSplit();
        uint256 bal2 = usdc.balanceOf(merchant);

        SplitConfig(splitConfig).executeSplit();
        uint256 bal3 = usdc.balanceOf(merchant);

        // Balance doesn't change after first execution
        assertEq(bal1, bal2);
        assertEq(bal2, bal3);
    }

    // ============ Preview Tests ============

    function test_previewExecution() public {
        SplitConfig.Recipient[] memory recipients = new SplitConfig.Recipient[](2);
        recipients[0] = SplitConfig.Recipient(platform, 900);
        recipients[1] = SplitConfig.Recipient(merchant, 9000);

        address splitConfig = factory.createSplitConfig(
            authority,
            address(usdc),
            keccak256("preview"),
            recipients
        );

        vm.prank(payer);
        usdc.transfer(splitConfig, 100e6);

        (uint256[] memory amounts, uint256 protocolFee, uint256 available) =
            SplitConfig(splitConfig).previewExecution();

        assertEq(available, 100e6);
        assertEq(protocolFee, 1e6); // 1%
        assertEq(amounts.length, 2);
        assertApproxEqAbs(amounts[0], 9e6, 1e4);  // Platform
        assertApproxEqAbs(amounts[1], 90e6, 1e4); // Merchant
    }

    function test_hasPendingFunds() public {
        SplitConfig.Recipient[] memory recipients = new SplitConfig.Recipient[](1);
        recipients[0] = SplitConfig.Recipient(merchant, 9900);

        address splitConfig = factory.createSplitConfig(
            authority,
            address(usdc),
            keccak256("pending"),
            recipients
        );

        // Initially no pending
        assertFalse(SplitConfig(splitConfig).hasPendingFunds());

        // After deposit
        vm.prank(payer);
        usdc.transfer(splitConfig, 100e6);
        assertTrue(SplitConfig(splitConfig).hasPendingFunds());
        assertEq(SplitConfig(splitConfig).pendingAmount(), 100e6);

        // After execution
        SplitConfig(splitConfig).executeSplit();
        assertFalse(SplitConfig(splitConfig).hasPendingFunds());
    }

    // ============ Update Tests ============

    function test_updateSplitConfig() public {
        SplitConfig.Recipient[] memory recipients = new SplitConfig.Recipient[](1);
        recipients[0] = SplitConfig.Recipient(merchant, 9900);

        address splitConfig = factory.createSplitConfig(
            authority,
            address(usdc),
            keccak256("update"),
            recipients
        );

        // Update to new recipients
        SplitConfig.Recipient[] memory newRecipients = new SplitConfig.Recipient[](2);
        newRecipients[0] = SplitConfig.Recipient(platform, 4950);
        newRecipients[1] = SplitConfig.Recipient(merchant, 4950);

        vm.prank(authority);
        SplitConfig(splitConfig).updateSplitConfig(newRecipients);

        assertEq(SplitConfig(splitConfig).getRecipientCount(), 2);
    }

    function test_cannotUpdateWithBalance() public {
        SplitConfig.Recipient[] memory recipients = new SplitConfig.Recipient[](1);
        recipients[0] = SplitConfig.Recipient(merchant, 9900);

        address splitConfig = factory.createSplitConfig(
            authority,
            address(usdc),
            keccak256("update-fail"),
            recipients
        );

        // Send funds
        vm.prank(payer);
        usdc.transfer(splitConfig, 100e6);

        // Try to update
        vm.prank(authority);
        vm.expectRevert(SplitConfig.SplitNotEmpty.selector);
        SplitConfig(splitConfig).updateSplitConfig(recipients);
    }

    // ============ Authority Tests ============

    function test_transferAuthority() public {
        SplitConfig.Recipient[] memory recipients = new SplitConfig.Recipient[](1);
        recipients[0] = SplitConfig.Recipient(merchant, 9900);

        address splitConfig = factory.createSplitConfig(
            authority,
            address(usdc),
            keccak256("auth-transfer"),
            recipients
        );

        address newAuthority = makeAddr("newAuth");

        vm.prank(authority);
        SplitConfig(splitConfig).transferAuthority(newAuthority);

        assertEq(SplitConfig(splitConfig).authority(), newAuthority);
    }

    function test_onlyAuthorityCanUpdate() public {
        SplitConfig.Recipient[] memory recipients = new SplitConfig.Recipient[](1);
        recipients[0] = SplitConfig.Recipient(merchant, 9900);

        address splitConfig = factory.createSplitConfig(
            authority,
            address(usdc),
            keccak256("auth-only"),
            recipients
        );

        vm.prank(payer); // Not authority
        vm.expectRevert(SplitConfig.Unauthorized.selector);
        SplitConfig(splitConfig).updateSplitConfig(recipients);
    }

    // ============ Protocol Authority Tests ============

    function test_transferProtocolAuthority() public {
        address newAuthority = makeAddr("newProtocolAuth");

        // Step 1: Propose transfer
        factory.transferProtocolAuthority(newAuthority);
        assertEq(factory.pendingAuthority(), newAuthority);

        // Step 2: Accept transfer
        vm.prank(newAuthority);
        factory.acceptProtocolAuthority();

        assertEq(factory.authority(), newAuthority);
        assertEq(factory.pendingAuthority(), address(0));
    }

    function test_updateProtocolConfig() public {
        address newFeeWallet = makeAddr("newFeeWallet");

        factory.updateProtocolConfig(newFeeWallet);

        assertEq(factory.feeWallet(), newFeeWallet);
    }

    // ============ Validation Tests ============

    function test_invalidRecipientCount() public {
        SplitConfig.Recipient[] memory recipients = new SplitConfig.Recipient[](0);

        vm.expectRevert(SplitConfig.InvalidRecipientCount.selector);
        factory.createSplitConfig(authority, address(usdc), keccak256("invalid"), recipients);
    }

    function test_invalidSplitTotal() public {
        SplitConfig.Recipient[] memory recipients = new SplitConfig.Recipient[](1);
        recipients[0] = SplitConfig.Recipient(merchant, 10000); // 100%, should be 99%

        vm.expectRevert(SplitConfig.InvalidSplitTotal.selector);
        factory.createSplitConfig(authority, address(usdc), keccak256("invalid-total"), recipients);
    }

    function test_duplicateRecipient() public {
        SplitConfig.Recipient[] memory recipients = new SplitConfig.Recipient[](2);
        recipients[0] = SplitConfig.Recipient(merchant, 4950);
        recipients[1] = SplitConfig.Recipient(merchant, 4950); // Duplicate

        vm.expectRevert(SplitConfig.DuplicateRecipient.selector);
        factory.createSplitConfig(authority, address(usdc), keccak256("dup"), recipients);
    }

    // ============ x402 Detection Tests ============

    function test_isCascadeSplitConfig() public {
        SplitConfig.Recipient[] memory recipients = new SplitConfig.Recipient[](1);
        recipients[0] = SplitConfig.Recipient(merchant, 9900);

        address splitConfig = factory.createSplitConfig(
            authority,
            address(usdc),
            keccak256("detection"),
            recipients
        );

        assertTrue(SplitConfig(splitConfig).isCascadeSplitConfig());
    }

    // ============ Gas Benchmarks ============

    function test_gas_createSplitConfig() public {
        SplitConfig.Recipient[] memory recipients = new SplitConfig.Recipient[](2);
        recipients[0] = SplitConfig.Recipient(platform, 900);
        recipients[1] = SplitConfig.Recipient(merchant, 9000);

        uint256 gasBefore = gasleft();
        factory.createSplitConfig(authority, address(usdc), keccak256("gas-create"), recipients);
        uint256 gasUsed = gasBefore - gasleft();

        console2.log("Gas used for createSplitConfig (2 recipients):", gasUsed);
        assertLt(gasUsed, 200_000); // Should be under 200k
    }

    function test_gas_executeSplit() public {
        SplitConfig.Recipient[] memory recipients = new SplitConfig.Recipient[](2);
        recipients[0] = SplitConfig.Recipient(platform, 900);
        recipients[1] = SplitConfig.Recipient(merchant, 9000);

        address splitConfig = factory.createSplitConfig(
            authority,
            address(usdc),
            keccak256("gas-exec"),
            recipients
        );

        vm.prank(payer);
        usdc.transfer(splitConfig, 100e6);

        uint256 gasBefore = gasleft();
        SplitConfig(splitConfig).executeSplit();
        uint256 gasUsed = gasBefore - gasleft();

        console2.log("Gas used for executeSplit (2 recipients):", gasUsed);
        assertLt(gasUsed, 150_000); // Should be under 150k
    }

    function test_gas_executeSplit_20recipients() public {
        SplitConfig.Recipient[] memory recipients = new SplitConfig.Recipient[](20);
        for (uint i = 0; i < 20; i++) {
            recipients[i] = SplitConfig.Recipient(
                address(uint160(i + 1000)),
                495 // 4.95% each = 99% total
            );
        }

        address splitConfig = factory.createSplitConfig(
            authority,
            address(usdc),
            keccak256("gas-exec-20"),
            recipients
        );

        vm.prank(payer);
        usdc.transfer(splitConfig, 100e6);

        uint256 gasBefore = gasleft();
        SplitConfig(splitConfig).executeSplit();
        uint256 gasUsed = gasBefore - gasleft();

        console2.log("Gas used for executeSplit (20 recipients):", gasUsed);
        assertLt(gasUsed, 500_000); // Should be under 500k
    }
}
