"""High-level client for Cascade Splits EVM SDK."""

from typing import TypeVar

from eth_account import Account
from eth_account.signers.local import LocalAccount
from web3 import Web3
from web3.exceptions import ContractLogicError, Web3Exception

from ._exceptions import ChainNotSupportedError
from .abi import SPLIT_CONFIG_IMPL_ABI, SPLIT_FACTORY_ABI
from .constants import (
    MAX_RECIPIENTS,
    MIN_RECIPIENTS,
    get_split_factory_address,
    get_usdc_address,
    is_supported_chain,
)
from .helpers import (
    DEFAULT_GAS_CREATE,
    DEFAULT_GAS_EXECUTE,
    build_tx_params,
    to_evm_recipients,
)
from .helpers import (
    get_split_balance as _get_split_balance,
)
from .helpers import (
    get_split_config as _get_split_config,
)
from .helpers import (
    has_pending_funds as _has_pending_funds,
)
from .helpers import (
    is_cascade_split as _is_cascade_split,
)
from .helpers import (
    preview_execution as _preview_execution,
)
from .types import (
    EnsureResult,
    ExecuteResult,
    ExecutionPreview,
    GasOptions,
    Recipient,
    SplitConfig,
)

_T = TypeVar("_T", EnsureResult, ExecuteResult)


class CascadeSplitsClient:
    """
    High-level client for Cascade Splits on Base.

    Example:
        >>> from cascade_splits_evm import CascadeSplitsClient, Recipient
        >>>
        >>> client = CascadeSplitsClient(
        ...     rpc_url="https://mainnet.base.org",
        ...     private_key="0x...",
        ... )
        >>>
        >>> result = client.ensure_split(
        ...     unique_id=b"my-unique-split-id",
        ...     recipients=[
        ...         Recipient(address="0xAlice...", share=60),
        ...         Recipient(address="0xBob...", share=40),
        ...     ]
        ... )
        >>>
        >>> if result.status == "CREATED":
        ...     print(f"Split created at {result.split}")
    """

    def __init__(
        self,
        rpc_url: str,
        private_key: str,
        chain_id: int = 8453,
        factory_address: str | None = None,
    ) -> None:
        """
        Initialize the Cascade Splits client.

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

        self.w3 = Web3(Web3.HTTPProvider(rpc_url))
        self.account: LocalAccount = Account.from_key(private_key)
        self.chain_id = chain_id

        # Get factory address
        self.factory_address = Web3.to_checksum_address(
            factory_address or get_split_factory_address(chain_id)
        )

        # Initialize factory contract
        self.factory = self.w3.eth.contract(
            address=self.factory_address,
            abi=SPLIT_FACTORY_ABI,
        )

        # Default token (USDC)
        self.default_token = Web3.to_checksum_address(get_usdc_address(chain_id))

    @property
    def address(self) -> str:
        """Get the wallet address."""
        return self.account.address

    def ensure_split(
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
        # Resolve defaults
        authority = Web3.to_checksum_address(authority or self.account.address)
        token = Web3.to_checksum_address(token or self.default_token)

        # Pad/truncate unique_id to 32 bytes
        if len(unique_id) < 32:
            unique_id = unique_id.ljust(32, b"\x00")
        elif len(unique_id) > 32:
            unique_id = unique_id[:32]

        # Validate recipient count
        recipient_count = len(recipients)
        if not (MIN_RECIPIENTS <= recipient_count <= MAX_RECIPIENTS):
            msg = f"Recipients: expected {MIN_RECIPIENTS}-{MAX_RECIPIENTS}, got {recipient_count}"
            return EnsureResult(status="FAILED", reason="transaction_failed", message=msg)

        # Convert recipients
        try:
            evm_recipients = to_evm_recipients(recipients)
        except ValueError as e:
            return EnsureResult(
                status="FAILED",
                reason="transaction_failed",
                message=str(e),
            )

        # Validate total (should be 9900 bps = 99%)
        total_bps = sum(r.percentage_bps for r in evm_recipients)
        if total_bps != 9900:
            return EnsureResult(
                status="FAILED",
                reason="transaction_failed",
                message=f"Recipients must sum to 9900 bps (99%), got {total_bps}",
            )

        try:
            # Predict address
            recipient_tuples = [(r.addr, r.percentage_bps) for r in evm_recipients]
            predicted = self.factory.functions.predictSplitAddress(
                authority,
                token,
                unique_id,
                recipient_tuples,
            ).call()

            # Check if already deployed
            code = self.w3.eth.get_code(predicted)
            if code and len(code) > 0:
                return EnsureResult(status="NO_CHANGE", split=predicted)

            # Build transaction with gas options
            contract_call = self.factory.functions.createSplitConfig(
                authority, token, unique_id, recipient_tuples
            )
            tx_params = build_tx_params(
                self.w3, self.account.address, self.chain_id, DEFAULT_GAS_CREATE,
                gas_options=gas, contract_call=contract_call,
            )
            tx = contract_call.build_transaction(tx_params)

            # Sign and send
            signed = self.account.sign_transaction(tx)
            tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)

            # Wait for confirmation
            self.w3.eth.wait_for_transaction_receipt(tx_hash)

            return EnsureResult(
                status="CREATED",
                split=predicted,
                signature=tx_hash.hex(),
            )

        except ContractLogicError as e:
            return EnsureResult(
                status="FAILED",
                reason="transaction_reverted",
                message=str(e),
            )
        except Web3Exception as e:
            return self._handle_web3_error(e, EnsureResult)
        except Exception as e:
            return EnsureResult(
                status="FAILED",
                reason="transaction_failed",
                message=str(e),
            )

    def execute_split(
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
        split_address = Web3.to_checksum_address(split_address)

        try:
            # Check if valid split
            if not _is_cascade_split(self.w3, split_address):
                return ExecuteResult(status="SKIPPED", reason="not_a_split")

            # Check balance threshold
            if min_balance is not None:
                balance = _get_split_balance(self.w3, split_address)
                if balance < min_balance:
                    return ExecuteResult(status="SKIPPED", reason="below_threshold")

            # Check pending funds
            if not _has_pending_funds(self.w3, split_address):
                return ExecuteResult(status="SKIPPED", reason="no_pending_funds")

            # Create contract instance
            split_contract = self.w3.eth.contract(
                address=split_address,
                abi=SPLIT_CONFIG_IMPL_ABI,
            )

            # Build transaction with gas options
            contract_call = split_contract.functions.executeSplit()
            tx_params = build_tx_params(
                self.w3, self.account.address, self.chain_id, DEFAULT_GAS_EXECUTE,
                gas_options=gas, contract_call=contract_call,
            )
            tx = contract_call.build_transaction(tx_params)

            # Sign and send
            signed = self.account.sign_transaction(tx)
            tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)

            # Wait for confirmation
            self.w3.eth.wait_for_transaction_receipt(tx_hash)

            return ExecuteResult(status="EXECUTED", signature=tx_hash.hex())

        except ContractLogicError as e:
            return ExecuteResult(
                status="FAILED",
                reason="transaction_reverted",
                message=str(e),
            )
        except Web3Exception as e:
            return self._handle_web3_error(e, ExecuteResult)
        except Exception as e:
            return ExecuteResult(
                status="FAILED",
                reason="transaction_failed",
                message=str(e),
            )

    def is_cascade_split(self, address: str) -> bool:
        """Check if an address is a valid Cascade split."""
        return _is_cascade_split(self.w3, address)

    def get_split_balance(self, split_address: str) -> int:
        """Get the token balance of a split (in smallest unit)."""
        return _get_split_balance(self.w3, split_address)

    def get_split_config(self, split_address: str) -> SplitConfig | None:
        """Get the configuration of a split. Returns None if not a valid split."""
        return _get_split_config(self.w3, split_address)

    def preview_execution(self, split_address: str) -> ExecutionPreview:
        """Preview what would happen if the split is executed."""
        return _preview_execution(self.w3, split_address)

    def predict_split_address(
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
        authority = Web3.to_checksum_address(authority or self.account.address)
        token = Web3.to_checksum_address(token or self.default_token)

        # Pad unique_id
        if len(unique_id) < 32:
            unique_id = unique_id.ljust(32, b"\x00")
        elif len(unique_id) > 32:
            unique_id = unique_id[:32]

        evm_recipients = to_evm_recipients(recipients)
        recipient_tuples = [(r.addr, r.percentage_bps) for r in evm_recipients]

        return self.factory.functions.predictSplitAddress(
            authority,
            token,
            unique_id,
            recipient_tuples,
        ).call()

    @staticmethod
    def _handle_web3_error(e: Web3Exception, result_class: type[_T]) -> _T:
        """Map Web3Exception to appropriate result type."""
        message = str(e).lower()

        if "rejected" in message or "denied" in message:
            return result_class(
                status="FAILED",
                reason="wallet_rejected",
                message="Transaction rejected",
            )

        if "gas" in message or "insufficient" in message:
            return result_class(
                status="FAILED",
                reason="insufficient_gas",
                message=str(e),
            )

        return result_class(
            status="FAILED",
            reason="transaction_failed",
            message=str(e),
        )
