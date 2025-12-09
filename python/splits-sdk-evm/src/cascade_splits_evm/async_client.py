"""Async high-level client for Cascade Splits EVM SDK."""

from eth_account import Account
from eth_account.signers.local import LocalAccount
from web3 import AsyncWeb3

from ._exceptions import ChainNotSupportedError
from .async_helpers import (
    get_pending_amount as _get_pending_amount,
)
from .async_helpers import (
    get_split_balance as _get_split_balance,
)
from .async_helpers import (
    get_split_config as _get_split_config,
)
from .async_helpers import (
    get_total_unclaimed as _get_total_unclaimed,
)
from .async_helpers import (
    has_pending_funds as _has_pending_funds,
)
from .async_helpers import (
    is_cascade_split as _is_cascade_split,
)
from .async_helpers import (
    predict_split_address as _predict_split_address,
)
from .async_helpers import (
    preview_execution as _preview_execution,
)
from .async_helpers import (
    to_evm_recipients,
)
from .constants import get_split_factory_address, get_usdc_address, is_supported_chain
from .ensure import ensure_split as _ensure_split
from .execute import execute_split as _execute_split
from .types import (
    EnsureParams,
    EnsureResult,
    ExecuteOptions,
    ExecuteResult,
    ExecutionPreview,
    GasOptions,
    Recipient,
    SplitConfig,
)


class AsyncCascadeSplitsClient:
    """
    Async high-level client for Cascade Splits on Base.

    Example:
        >>> import asyncio
        >>> from cascade_splits_evm import AsyncCascadeSplitsClient, Recipient
        >>>
        >>> async def main():
        ...     client = AsyncCascadeSplitsClient(
        ...         rpc_url="https://mainnet.base.org",
        ...         private_key="0x...",
        ...     )
        ...
        ...     result = await client.ensure_split(
        ...         unique_id=b"my-unique-split-id",
        ...         recipients=[
        ...             Recipient(address="0xAlice...", share=60),
        ...             Recipient(address="0xBob...", share=40),
        ...         ]
        ...     )
        ...
        ...     if result.status == "CREATED":
        ...         print(f"Split created at {result.split}")
        >>>
        >>> asyncio.run(main())
    """

    def __init__(
        self,
        rpc_url: str,
        private_key: str,
        chain_id: int = 8453,
        factory_address: str | None = None,
    ) -> None:
        """
        Initialize the async Cascade Splits client.

        Args:
            rpc_url: RPC endpoint URL
            private_key: Private key for signing transactions
            chain_id: Chain ID (8453 for Base mainnet, 84532 for Base Sepolia)
            factory_address: Custom factory address (uses default if not provided)

        Raises:
            ChainNotSupportedError: If chain_id is not supported
        """
        if not is_supported_chain(chain_id):
            raise ChainNotSupportedError(chain_id)

        self.w3 = AsyncWeb3(AsyncWeb3.AsyncHTTPProvider(rpc_url))
        self.account: LocalAccount = Account.from_key(private_key)
        self.chain_id = chain_id

        # Get factory address
        self.factory_address = AsyncWeb3.to_checksum_address(factory_address or get_split_factory_address(chain_id))

        # Default token (USDC)
        self.default_token = AsyncWeb3.to_checksum_address(get_usdc_address(chain_id))

    async def close(self) -> None:
        """Close the underlying HTTP session."""
        await self.w3.provider.disconnect()

    async def __aenter__(self) -> "AsyncCascadeSplitsClient":
        """Enter async context manager."""
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """Exit async context manager and close session."""
        await self.close()

    @property
    def address(self) -> str:
        """Get the wallet address."""
        return self.account.address

    async def ensure_split(
        self,
        unique_id: bytes,
        recipients: list[Recipient],
        authority: str | None = None,
        token: str | None = None,
        gas: GasOptions | None = None,
    ) -> EnsureResult:
        """
        Create a split if it doesn't exist (idempotent).

        Args:
            unique_id: Unique identifier for this split (32 bytes)
            recipients: List of recipients with shares (must sum to 100)
            authority: Authority address (defaults to wallet address)
            token: Token address (defaults to USDC)
            gas: Gas options (estimation, EIP-1559 fees)

        Returns:
            EnsureResult with status CREATED, NO_CHANGE, or FAILED
        """
        return await _ensure_split(
            self.w3,
            self.account,
            self.factory_address,
            EnsureParams(
                unique_id=unique_id,
                recipients=recipients,
                authority=authority,
                token=token,
                gas=gas,
            ),
        )

    async def execute_split(
        self,
        split_address: str,
        min_balance: int | None = None,
        gas: GasOptions | None = None,
    ) -> ExecuteResult:
        """
        Execute split distribution (permissionless).

        Anyone can call this to distribute funds in the split.

        Args:
            split_address: Address of the split to execute
            min_balance: Minimum balance required (skip if below)
            gas: Gas options (estimation, EIP-1559 fees)

        Returns:
            ExecuteResult with status EXECUTED, SKIPPED, or FAILED
        """
        options = ExecuteOptions(min_balance=min_balance, gas=gas)
        return await _execute_split(self.w3, self.account, split_address, options)

    async def is_cascade_split(self, address: str) -> bool:
        """Check if an address is a valid Cascade split."""
        return await _is_cascade_split(self.w3, address)

    async def get_split_balance(self, split_address: str) -> int:
        """Get the token balance of a split (in smallest unit)."""
        return await _get_split_balance(self.w3, split_address)

    async def get_split_config(self, split_address: str) -> SplitConfig | None:
        """Get the configuration of a split."""
        return await _get_split_config(self.w3, split_address)

    async def has_pending_funds(self, split_address: str) -> bool:
        """Check if a split has pending funds to distribute."""
        return await _has_pending_funds(self.w3, split_address)

    async def get_pending_amount(self, split_address: str) -> int:
        """Get the pending amount to be distributed."""
        return await _get_pending_amount(self.w3, split_address)

    async def get_total_unclaimed(self, split_address: str) -> int:
        """Get the total unclaimed amount (failed transfers)."""
        return await _get_total_unclaimed(self.w3, split_address)

    async def preview_execution(self, split_address: str) -> ExecutionPreview:
        """Preview what would happen if the split is executed."""
        return await _preview_execution(self.w3, split_address)

    async def predict_split_address(
        self,
        unique_id: bytes,
        recipients: list[Recipient],
        authority: str | None = None,
        token: str | None = None,
    ) -> str:
        """
        Predict the address of a split before creation.

        Args:
            unique_id: Unique identifier (32 bytes)
            recipients: List of recipients with shares
            authority: Authority address (defaults to wallet)
            token: Token address (defaults to USDC)

        Returns:
            Predicted split address
        """
        authority = AsyncWeb3.to_checksum_address(authority or self.account.address)
        token = AsyncWeb3.to_checksum_address(token or self.default_token)

        # Pad unique_id
        if len(unique_id) < 32:
            unique_id = unique_id.ljust(32, b"\x00")
        elif len(unique_id) > 32:
            unique_id = unique_id[:32]

        evm_recipients = to_evm_recipients(recipients)

        return await _predict_split_address(
            self.w3,
            self.factory_address,
            authority,
            token,
            unique_id,
            evm_recipients,
        )
