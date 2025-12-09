/**
 * Hand-written ABIs for Cascade Splits EVM contracts.
 * Derived from contracts/src/SplitFactory.sol and contracts/src/SplitConfigImpl.sol.
 *
 * Using `as const` for full viem type inference - no codegen required.
 */

export const splitFactoryAbi = [
  // Read functions
  {
    type: "function",
    name: "PROTOCOL_FEE_BPS",
    inputs: [],
    outputs: [{ type: "uint16" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "REQUIRED_SPLIT_TOTAL",
    inputs: [],
    outputs: [{ type: "uint16" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "MIN_RECIPIENTS",
    inputs: [],
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "MAX_RECIPIENTS",
    inputs: [],
    outputs: [{ type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "INITIAL_IMPLEMENTATION",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "currentImplementation",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "feeWallet",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "authority",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "pendingAuthority",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "predictSplitAddress",
    inputs: [
      { name: "authority_", type: "address" },
      { name: "token", type: "address" },
      { name: "uniqueId", type: "bytes32" },
      {
        name: "recipients",
        type: "tuple[]",
        components: [
          { name: "addr", type: "address" },
          { name: "percentageBps", type: "uint16" },
        ],
      },
    ],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  // Write functions
  {
    type: "function",
    name: "createSplitConfig",
    inputs: [
      { name: "authority_", type: "address" },
      { name: "token", type: "address" },
      { name: "uniqueId", type: "bytes32" },
      {
        name: "recipients",
        type: "tuple[]",
        components: [
          { name: "addr", type: "address" },
          { name: "percentageBps", type: "uint16" },
        ],
      },
    ],
    outputs: [{ name: "split", type: "address" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "updateProtocolConfig",
    inputs: [{ name: "newFeeWallet", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "upgradeImplementation",
    inputs: [{ name: "newImplementation", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "transferProtocolAuthority",
    inputs: [{ name: "newAuthority", type: "address" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "acceptProtocolAuthority",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // Events
  {
    type: "event",
    name: "ProtocolConfigCreated",
    inputs: [
      { name: "authority", type: "address", indexed: true },
      { name: "feeWallet", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "ProtocolConfigUpdated",
    inputs: [
      { name: "oldFeeWallet", type: "address", indexed: true },
      { name: "newFeeWallet", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "ProtocolAuthorityTransferProposed",
    inputs: [
      { name: "currentAuthority", type: "address", indexed: true },
      { name: "pendingAuthority", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "ProtocolAuthorityTransferAccepted",
    inputs: [
      { name: "oldAuthority", type: "address", indexed: true },
      { name: "newAuthority", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "ImplementationUpgraded",
    inputs: [
      { name: "oldImplementation", type: "address", indexed: true },
      { name: "newImplementation", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "SplitConfigCreated",
    inputs: [
      { name: "split", type: "address", indexed: true },
      { name: "authority", type: "address", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "uniqueId", type: "bytes32", indexed: false },
      {
        name: "recipients",
        type: "tuple[]",
        indexed: false,
        components: [
          { name: "addr", type: "address" },
          { name: "percentageBps", type: "uint16" },
        ],
      },
    ],
  },
  // Errors
  {
    type: "error",
    name: "DuplicateRecipient",
    inputs: [
      { name: "addr", type: "address" },
      { name: "firstIndex", type: "uint256" },
      { name: "secondIndex", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "InvalidImplementation",
    inputs: [{ name: "implementation", type: "address" }],
  },
  {
    type: "error",
    name: "InvalidRecipientCount",
    inputs: [
      { name: "count", type: "uint256" },
      { name: "min", type: "uint256" },
      { name: "max", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "InvalidSplitTotal",
    inputs: [
      { name: "total", type: "uint256" },
      { name: "required", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "NoPendingTransfer",
    inputs: [],
  },
  {
    type: "error",
    name: "SplitAlreadyExists",
    inputs: [{ name: "split", type: "address" }],
  },
  {
    type: "error",
    name: "Unauthorized",
    inputs: [
      { name: "caller", type: "address" },
      { name: "expected", type: "address" },
    ],
  },
  {
    type: "error",
    name: "ZeroAddress",
    inputs: [{ name: "index", type: "uint256" }],
  },
  {
    type: "error",
    name: "ZeroPercentage",
    inputs: [{ name: "index", type: "uint256" }],
  },
] as const;

export const splitConfigImplAbi = [
  // Read functions
  {
    type: "function",
    name: "PROTOCOL_INDEX",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "factory",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "authority",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "token",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "uniqueId",
    inputs: [],
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getRecipientCount",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getRecipients",
    inputs: [],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "addr", type: "address" },
          { name: "percentageBps", type: "uint16" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isCascadeSplitConfig",
    inputs: [],
    outputs: [{ type: "bool" }],
    stateMutability: "pure",
  },
  {
    type: "function",
    name: "totalUnclaimed",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hasPendingFunds",
    inputs: [],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "pendingAmount",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getBalance",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "previewExecution",
    inputs: [],
    outputs: [
      {
        name: "recipientAmounts",
        type: "uint256[]",
      },
      { name: "protocolFee", type: "uint256" },
      { name: "available", type: "uint256" },
      {
        name: "pendingRecipientAmounts",
        type: "uint256[]",
      },
      { name: "pendingProtocolAmount", type: "uint256" },
    ],
    stateMutability: "view",
  },
  // Write functions
  {
    type: "function",
    name: "executeSplit",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // Events
  {
    type: "event",
    name: "SplitExecuted",
    inputs: [
      { name: "totalAmount", type: "uint256", indexed: false },
      { name: "protocolFee", type: "uint256", indexed: false },
      { name: "unclaimedCleared", type: "uint256", indexed: false },
      { name: "newUnclaimed", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "TransferFailed",
    inputs: [
      { name: "recipient", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "isProtocol", type: "bool", indexed: false },
    ],
  },
  {
    type: "event",
    name: "UnclaimedCleared",
    inputs: [
      { name: "recipient", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "isProtocol", type: "bool", indexed: false },
    ],
  },
] as const;
