"""
Contract ABIs for Cascade Splits EVM contracts.

Derived from contracts/src/SplitFactory.sol and contracts/src/SplitConfigImpl.sol.
"""

# SplitFactory ABI
SPLIT_FACTORY_ABI = [
    # Read functions
    {
        "type": "function",
        "name": "PROTOCOL_FEE_BPS",
        "inputs": [],
        "outputs": [{"type": "uint16"}],
        "stateMutability": "view",
    },
    {
        "type": "function",
        "name": "REQUIRED_SPLIT_TOTAL",
        "inputs": [],
        "outputs": [{"type": "uint16"}],
        "stateMutability": "view",
    },
    {
        "type": "function",
        "name": "MIN_RECIPIENTS",
        "inputs": [],
        "outputs": [{"type": "uint8"}],
        "stateMutability": "view",
    },
    {
        "type": "function",
        "name": "MAX_RECIPIENTS",
        "inputs": [],
        "outputs": [{"type": "uint8"}],
        "stateMutability": "view",
    },
    {
        "type": "function",
        "name": "INITIAL_IMPLEMENTATION",
        "inputs": [],
        "outputs": [{"type": "address"}],
        "stateMutability": "view",
    },
    {
        "type": "function",
        "name": "currentImplementation",
        "inputs": [],
        "outputs": [{"type": "address"}],
        "stateMutability": "view",
    },
    {
        "type": "function",
        "name": "feeWallet",
        "inputs": [],
        "outputs": [{"type": "address"}],
        "stateMutability": "view",
    },
    {
        "type": "function",
        "name": "authority",
        "inputs": [],
        "outputs": [{"type": "address"}],
        "stateMutability": "view",
    },
    {
        "type": "function",
        "name": "pendingAuthority",
        "inputs": [],
        "outputs": [{"type": "address"}],
        "stateMutability": "view",
    },
    {
        "type": "function",
        "name": "predictSplitAddress",
        "inputs": [
            {"name": "authority_", "type": "address"},
            {"name": "token", "type": "address"},
            {"name": "uniqueId", "type": "bytes32"},
            {
                "name": "recipients",
                "type": "tuple[]",
                "components": [
                    {"name": "addr", "type": "address"},
                    {"name": "percentageBps", "type": "uint16"},
                ],
            },
        ],
        "outputs": [{"type": "address"}],
        "stateMutability": "view",
    },
    # Write functions
    {
        "type": "function",
        "name": "createSplitConfig",
        "inputs": [
            {"name": "authority_", "type": "address"},
            {"name": "token", "type": "address"},
            {"name": "uniqueId", "type": "bytes32"},
            {
                "name": "recipients",
                "type": "tuple[]",
                "components": [
                    {"name": "addr", "type": "address"},
                    {"name": "percentageBps", "type": "uint16"},
                ],
            },
        ],
        "outputs": [{"name": "split", "type": "address"}],
        "stateMutability": "nonpayable",
    },
    # Events
    {
        "type": "event",
        "name": "SplitConfigCreated",
        "inputs": [
            {"name": "split", "type": "address", "indexed": True},
            {"name": "authority", "type": "address", "indexed": True},
            {"name": "token", "type": "address", "indexed": True},
            {"name": "uniqueId", "type": "bytes32", "indexed": False},
            {
                "name": "recipients",
                "type": "tuple[]",
                "indexed": False,
                "components": [
                    {"name": "addr", "type": "address"},
                    {"name": "percentageBps", "type": "uint16"},
                ],
            },
        ],
    },
]

# SplitConfigImpl ABI
SPLIT_CONFIG_IMPL_ABI = [
    # Read functions
    {
        "type": "function",
        "name": "PROTOCOL_INDEX",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
        "stateMutability": "view",
    },
    {
        "type": "function",
        "name": "factory",
        "inputs": [],
        "outputs": [{"type": "address"}],
        "stateMutability": "view",
    },
    {
        "type": "function",
        "name": "authority",
        "inputs": [],
        "outputs": [{"type": "address"}],
        "stateMutability": "view",
    },
    {
        "type": "function",
        "name": "token",
        "inputs": [],
        "outputs": [{"type": "address"}],
        "stateMutability": "view",
    },
    {
        "type": "function",
        "name": "uniqueId",
        "inputs": [],
        "outputs": [{"type": "bytes32"}],
        "stateMutability": "view",
    },
    {
        "type": "function",
        "name": "getRecipientCount",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
        "stateMutability": "view",
    },
    {
        "type": "function",
        "name": "getRecipients",
        "inputs": [],
        "outputs": [
            {
                "type": "tuple[]",
                "components": [
                    {"name": "addr", "type": "address"},
                    {"name": "percentageBps", "type": "uint16"},
                ],
            },
        ],
        "stateMutability": "view",
    },
    {
        "type": "function",
        "name": "isCascadeSplitConfig",
        "inputs": [],
        "outputs": [{"type": "bool"}],
        "stateMutability": "pure",
    },
    {
        "type": "function",
        "name": "totalUnclaimed",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
        "stateMutability": "view",
    },
    {
        "type": "function",
        "name": "hasPendingFunds",
        "inputs": [],
        "outputs": [{"type": "bool"}],
        "stateMutability": "view",
    },
    {
        "type": "function",
        "name": "pendingAmount",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
        "stateMutability": "view",
    },
    {
        "type": "function",
        "name": "getBalance",
        "inputs": [],
        "outputs": [{"type": "uint256"}],
        "stateMutability": "view",
    },
    {
        "type": "function",
        "name": "previewExecution",
        "inputs": [],
        "outputs": [
            {"name": "recipientAmounts", "type": "uint256[]"},
            {"name": "protocolFee", "type": "uint256"},
            {"name": "available", "type": "uint256"},
            {"name": "pendingRecipientAmounts", "type": "uint256[]"},
            {"name": "pendingProtocolAmount", "type": "uint256"},
        ],
        "stateMutability": "view",
    },
    # Write functions
    {
        "type": "function",
        "name": "executeSplit",
        "inputs": [],
        "outputs": [],
        "stateMutability": "nonpayable",
    },
    # Events
    {
        "type": "event",
        "name": "SplitExecuted",
        "inputs": [
            {"name": "totalAmount", "type": "uint256", "indexed": False},
            {"name": "protocolFee", "type": "uint256", "indexed": False},
            {"name": "unclaimedCleared", "type": "uint256", "indexed": False},
            {"name": "newUnclaimed", "type": "uint256", "indexed": False},
        ],
    },
    {
        "type": "event",
        "name": "TransferFailed",
        "inputs": [
            {"name": "recipient", "type": "address", "indexed": True},
            {"name": "amount", "type": "uint256", "indexed": False},
            {"name": "isProtocol", "type": "bool", "indexed": False},
        ],
    },
    {
        "type": "event",
        "name": "UnclaimedCleared",
        "inputs": [
            {"name": "recipient", "type": "address", "indexed": True},
            {"name": "amount", "type": "uint256", "indexed": False},
            {"name": "isProtocol", "type": "bool", "indexed": False},
        ],
    },
]

# ERC20 ABI (minimal for balance checks)
ERC20_ABI = [
    {
        "type": "function",
        "name": "balanceOf",
        "inputs": [{"name": "account", "type": "address"}],
        "outputs": [{"type": "uint256"}],
        "stateMutability": "view",
    },
    {
        "type": "function",
        "name": "decimals",
        "inputs": [],
        "outputs": [{"type": "uint8"}],
        "stateMutability": "view",
    },
]
