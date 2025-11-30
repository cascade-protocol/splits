// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.30;

/// @notice Recipient configuration for a split
/// @param addr Recipient address
/// @param percentageBps Percentage in basis points (1-9900, representing 0.01%-99%)
struct Recipient {
    address addr;
    uint16 percentageBps;
}
