# Suppress websockets deprecation warning from web3.py (ethereum/web3.py#3530)
# web3.py unconditionally imports LegacyWebSocketProvider even for HTTP-only usage.
# This will be fixed in web3.py v8. Remove this filter after upgrading.
import warnings

warnings.filterwarnings(
    "ignore",
    message="websockets.legacy is deprecated",
    category=DeprecationWarning,
    module=r"websockets\.legacy",
)

"""
Cascade Splits EVM SDK

Non-custodial payment splitting on Base (EVM).
Automatically distribute incoming payments to multiple recipients.

Usage (async - recommended):
    import asyncio
    from cascade_splits_evm import AsyncCascadeSplitsClient, Recipient

    async def main():
        client = AsyncCascadeSplitsClient(
            rpc_url="https://mainnet.base.org",
            private_key="0x...",
        )

        result = await client.ensure_split(
            unique_id=b"my-unique-id-here",
            recipients=[
                Recipient(address="0xAlice...", share=60),
                Recipient(address="0xBob...", share=40),
            ]
        )

    asyncio.run(main())

Usage (sync):
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

Low-level async functions:
    from cascade_splits_evm import ensure_split, execute_split
    from web3 import AsyncWeb3
    from eth_account import Account

    w3 = AsyncWeb3(AsyncWeb3.AsyncHTTPProvider(rpc_url))
    account = Account.from_key("0x...")
    result = await ensure_split(w3, account, factory_address, params)
"""

# Async helpers (for use with AsyncWeb3)
from . import async_helpers
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

# ABIs (for advanced usage)
from .abi import SPLIT_CONFIG_IMPL_ABI, SPLIT_FACTORY_ABI

# Async client (recommended)
from .async_client import AsyncCascadeSplitsClient

# Sync client (for simple scripts)
from .client import CascadeSplitsClient

# Constants
from .constants import (
    MAX_RECIPIENTS,
    MIN_RECIPIENTS,
    SPLIT_FACTORY_ADDRESSES,
    SUPPORTED_CHAIN_IDS,
    USDC_ADDRESSES,
    get_split_factory_address,
    get_usdc_address,
    is_supported_chain,
)

# Standalone async operations
from .ensure import ensure_split
from .execute import execute_split

# Sync helpers (for use with sync Web3)
from .helpers import (
    get_default_token,
    get_pending_amount,
    get_split_balance,
    get_split_config,
    get_total_unclaimed,
    has_pending_funds,
    is_cascade_split,
    predict_split_address,
    preview_execution,
    to_evm_recipient,
    to_evm_recipients,
)

# Types
from .types import (
    EnsureParams,
    EnsureResult,
    EnsureStatus,
    EvmRecipient,
    ExecuteOptions,
    ExecuteResult,
    ExecuteStatus,
    ExecutionPreview,
    FailedReason,
    GasOptions,
    Recipient,
    SkippedReason,
    SplitConfig,
)

__all__ = [
    # Version
    "__version__",
    # Clients
    "AsyncCascadeSplitsClient",
    "CascadeSplitsClient",
    # Standalone operations
    "ensure_split",
    "execute_split",
    # Types
    "Recipient",
    "EvmRecipient",
    "SplitConfig",
    "EnsureParams",
    "EnsureResult",
    "ExecuteOptions",
    "ExecuteResult",
    "ExecutionPreview",
    "EnsureStatus",
    "ExecuteStatus",
    "FailedReason",
    "SkippedReason",
    "GasOptions",
    # Constants
    "SPLIT_FACTORY_ADDRESSES",
    "USDC_ADDRESSES",
    "SUPPORTED_CHAIN_IDS",
    "MIN_RECIPIENTS",
    "MAX_RECIPIENTS",
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
    "get_pending_amount",
    "get_total_unclaimed",
    "preview_execution",
    "predict_split_address",
    "get_default_token",
    # ABIs
    "SPLIT_FACTORY_ABI",
    "SPLIT_CONFIG_IMPL_ABI",
    # Async helpers module
    "async_helpers",
    # Exceptions
    "CascadeSplitsError",
    "ConfigurationError",
    "ChainNotSupportedError",
    "TransactionError",
    "TransactionRejectedError",
    "TransactionRevertedError",
    "InsufficientGasError",
]
