"""
Contract addresses for Cascade Splits on supported chains.
"""

from typing import Dict

# Deployed SplitFactory contract addresses per chain.
# Deterministic addresses (same on ALL EVM chains via CREATE2).
SPLIT_FACTORY_ADDRESSES: Dict[int, str] = {
    # Base mainnet (chain ID: 8453)
    8453: "0x946Cd053514b1Ab7829dD8fEc85E0ade5550dcf7",
    
    # Base Sepolia testnet (chain ID: 84532)
    84532: "0x946Cd053514b1Ab7829dD8fEc85E0ade5550dcf7",
}

# USDC contract addresses per chain.
USDC_ADDRESSES: Dict[int, str] = {
    # Base mainnet
    8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    
    # Base Sepolia testnet
    84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
}

# Supported chain IDs
SUPPORTED_CHAIN_IDS = [8453, 84532]


def get_split_factory_address(chain_id: int) -> str:
    """
    Get the SplitFactory address for a given chain ID.
    
    Args:
        chain_id: The chain ID (8453 for Base mainnet, 84532 for Base Sepolia)
        
    Returns:
        The factory contract address
        
    Raises:
        ValueError: If chain is not supported
    """
    address = SPLIT_FACTORY_ADDRESSES.get(chain_id)
    if not address:
        raise ValueError(
            f"SplitFactory not deployed on chain {chain_id}. "
            f"Supported chains: Base (8453), Base Sepolia (84532)"
        )
    return address


def get_usdc_address(chain_id: int) -> str:
    """
    Get the USDC address for a given chain ID.
    
    Args:
        chain_id: The chain ID
        
    Returns:
        The USDC contract address
        
    Raises:
        ValueError: If chain is not supported
    """
    address = USDC_ADDRESSES.get(chain_id)
    if not address:
        raise ValueError(
            f"USDC not configured for chain {chain_id}. "
            f"Supported chains: Base (8453), Base Sepolia (84532)"
        )
    return address


def is_supported_chain(chain_id: int) -> bool:
    """
    Check if a chain is supported.
    
    Args:
        chain_id: The chain ID to check
        
    Returns:
        True if supported, False otherwise
    """
    return chain_id in SPLIT_FACTORY_ADDRESSES
