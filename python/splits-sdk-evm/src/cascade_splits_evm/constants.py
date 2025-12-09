"""Contract addresses and chain constants for Cascade Splits EVM SDK."""

from ._exceptions import ChainNotSupportedError

# Deployed SplitFactory contract addresses per chain.
# Deterministic addresses (same on ALL EVM chains via CREATE2).
SPLIT_FACTORY_ADDRESSES: dict[int, str] = {
    8453: "0x946Cd053514b1Ab7829dD8fEc85E0ade5550dcf7",  # Base mainnet
    84532: "0x946Cd053514b1Ab7829dD8fEc85E0ade5550dcf7",  # Base Sepolia
}

# USDC contract addresses per chain.
USDC_ADDRESSES: dict[int, str] = {
    8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",  # Base mainnet
    84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",  # Base Sepolia
}

# Supported chain IDs
SUPPORTED_CHAIN_IDS: list[int] = [8453, 84532]

# Recipient limits (enforced by contract)
MIN_RECIPIENTS = 1
MAX_RECIPIENTS = 20


def get_split_factory_address(chain_id: int) -> str:
    """Get the SplitFactory address for a given chain ID."""
    address = SPLIT_FACTORY_ADDRESSES.get(chain_id)
    if not address:
        raise ChainNotSupportedError(chain_id)
    return address


def get_usdc_address(chain_id: int) -> str:
    """Get the USDC address for a given chain ID."""
    address = USDC_ADDRESSES.get(chain_id)
    if not address:
        raise ChainNotSupportedError(chain_id)
    return address


def is_supported_chain(chain_id: int) -> bool:
    """Check if a chain is supported."""
    return chain_id in SPLIT_FACTORY_ADDRESSES
