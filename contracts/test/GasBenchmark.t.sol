// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {SplitConfigImpl} from "../src/SplitConfigImpl.sol";
import {SplitFactory} from "../src/SplitFactory.sol";
import {Recipient} from "../src/Types.sol";
import {MockERC20} from "solady/../test/utils/mocks/MockERC20.sol";

contract GasBenchmark is Test {
    SplitFactory factory;
    MockERC20 usdc;
    address authority = address(0xA0A0);
    address feeWallet = address(0xFEE0);
    
    function setUp() public {
        SplitConfigImpl impl = new SplitConfigImpl();
        factory = new SplitFactory(address(impl), feeWallet, authority);
        usdc = new MockERC20("USDC", "USDC", 6);
    }
    
    function _makeRecipients(uint256 count) internal pure returns (Recipient[] memory) {
        Recipient[] memory r = new Recipient[](count);
        uint16 bps = uint16(9900 / count);
        for (uint160 i = 0; i < count; i++) {
            r[i] = Recipient({addr: address(0x1000 + i), percentageBps: bps});
        }
        return r;
    }
    
    function test_Gas_Create_2_Recipients() public {
        uint256 gas = gasleft();
        factory.createSplitConfig(authority, address(usdc), bytes32("2"), _makeRecipients(2));
        console.log("createSplitConfig (2 recipients):", gas - gasleft());
    }
    
    function test_Gas_Create_5_Recipients() public {
        uint256 gas = gasleft();
        factory.createSplitConfig(authority, address(usdc), bytes32("5"), _makeRecipients(5));
        console.log("createSplitConfig (5 recipients):", gas - gasleft());
    }
    
    function test_Gas_Create_10_Recipients() public {
        uint256 gas = gasleft();
        factory.createSplitConfig(authority, address(usdc), bytes32("10"), _makeRecipients(10));
        console.log("createSplitConfig (10 recipients):", gas - gasleft());
    }
    
    function test_Gas_Create_20_Recipients() public {
        uint256 gas = gasleft();
        factory.createSplitConfig(authority, address(usdc), bytes32("20"), _makeRecipients(20));
        console.log("createSplitConfig (20 recipients):", gas - gasleft());
    }
    
    function test_Gas_Execute_2_Recipients() public {
        address split = factory.createSplitConfig(authority, address(usdc), bytes32("e2"), _makeRecipients(2));
        usdc.mint(split, 1000e6);
        uint256 gas = gasleft();
        SplitConfigImpl(split).executeSplit();
        console.log("executeSplit (2 recipients):", gas - gasleft());
    }
    
    function test_Gas_Execute_5_Recipients() public {
        address split = factory.createSplitConfig(authority, address(usdc), bytes32("e5"), _makeRecipients(5));
        usdc.mint(split, 1000e6);
        uint256 gas = gasleft();
        SplitConfigImpl(split).executeSplit();
        console.log("executeSplit (5 recipients):", gas - gasleft());
    }
    
    function test_Gas_Execute_10_Recipients() public {
        address split = factory.createSplitConfig(authority, address(usdc), bytes32("e10"), _makeRecipients(10));
        usdc.mint(split, 1000e6);
        uint256 gas = gasleft();
        SplitConfigImpl(split).executeSplit();
        console.log("executeSplit (10 recipients):", gas - gasleft());
    }
    
    function test_Gas_Execute_20_Recipients() public {
        address split = factory.createSplitConfig(authority, address(usdc), bytes32("e20"), _makeRecipients(20));
        usdc.mint(split, 1000e6);
        uint256 gas = gasleft();
        SplitConfigImpl(split).executeSplit();
        console.log("executeSplit (20 recipients):", gas - gasleft());
    }
}
