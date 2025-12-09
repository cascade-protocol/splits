"""
Cascade Splits EVM SDK

Non-custodial payment splitting on Base (EVM).
Automatically distribute incoming payments to multiple recipients.

Usage:
    from cascade_splits_evm import CascadeSplitsClient, Recipient

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

from ._exceptions import (
    CascadeSplitsError,
    ChainNotSupportedError,
    ConfigurationError,
    InsufficientGasError,
    TransactionError,
    TransactionRejectedError,
    TransactionRevertedError,
)
from ._version import __version__
from .client import CascadeSplitsClient
from .constants import (
    SPLIT_FACTORY_ADDRESSES,
    SUPPORTED_CHAIN_IDS,
    USDC_ADDRESSES,
    get_split_factory_address,
    get_usdc_address,
    is_supported_chain,
)
from .helpers import (
    get_split_balance,
    get_split_config,
    has_pending_funds,
    is_cascade_split,
    preview_execution,
    to_evm_recipient,
    to_evm_recipients,
)
from .types import (
    EnsureResult,
    EnsureStatus,
    EvmRecipient,
    ExecuteResult,
    ExecuteStatus,
    ExecutionPreview,
    FailedReason,
    Recipient,
    SkippedReason,
    SplitConfig,
)

__all__ = [
    # Version
    "__version__",
    # Client
    "CascadeSplitsClient",
    # Types
    "Recipient",
    "EvmRecipient",
    "SplitConfig",
    "EnsureResult",
    "ExecuteResult",
    "ExecutionPreview",
    "EnsureStatus",
    "ExecuteStatus",
    "FailedReason",
    "SkippedReason",
    # Constants
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
    # Exceptions
    "CascadeSplitsError",
    "ConfigurationError",
    "ChainNotSupportedError",
    "TransactionError",
    "TransactionRejectedError",
    "TransactionRevertedError",
    "InsufficientGasError",
]
