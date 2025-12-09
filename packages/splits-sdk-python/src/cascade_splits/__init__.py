"""
Cascade Splits Python SDK

Non-custodial payment splitting on Base (EVM).
Automatically distribute incoming payments to multiple recipients.

Usage:
    from cascade_splits import CascadeSplitsClient, Recipient

    client = CascadeSplitsClient(
        rpc_url="https://mainnet.base.org",
        private_key="0x...",
    )

    result = client.ensure_split(
        unique_id=b"my-unique-id-here",
        recipients=[
            Recipient(address="0xAlice...", share=60),
            Recipient(address="0xBob...", share=40),
        ]
    )
"""

from cascade_splits.types import (
    Recipient,
    EvmRecipient,
    EnsureResult,
    ExecuteResult,
    ExecutionPreview,
    SplitConfig,
)
from cascade_splits.addresses import (
    SPLIT_FACTORY_ADDRESSES,
    USDC_ADDRESSES,
    SUPPORTED_CHAIN_IDS,
    get_split_factory_address,
    get_usdc_address,
    is_supported_chain,
)
from cascade_splits.client import CascadeSplitsClient
from cascade_splits.helpers import (
    to_evm_recipient,
    to_evm_recipients,
    is_cascade_split,
    get_split_balance,
    get_split_config,
    has_pending_funds,
    preview_execution,
)

__version__ = "0.1.0"

__all__ = [
    # Client
    "CascadeSplitsClient",
    # Types
    "Recipient",
    "EvmRecipient",
    "EnsureResult",
    "ExecuteResult",
    "ExecutionPreview",
    "SplitConfig",
    # Addresses
    "SPLIT_FACTORY_ADDRESSES",
    "USDC_ADDRESSES",
    "SUPPORTED_CHAIN_IDS",
    "get_split_factory_address",
    "get_usdc_address",
    "is_supported_chain",
    # Helpers
    "to_evm_recipient",
    "to_evm_recipients",
    "is_cascade_split",
    "get_split_balance",
    "get_split_config",
    "has_pending_funds",
    "preview_execution",
]
