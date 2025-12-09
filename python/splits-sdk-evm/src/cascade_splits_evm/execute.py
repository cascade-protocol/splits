"""Standalone execute_split operation for Cascade Splits."""

from eth_account.signers.local import LocalAccount
from web3 import AsyncWeb3
from web3.exceptions import ContractLogicError, Web3Exception

from .abi import SPLIT_CONFIG_IMPL_ABI
from .async_helpers import (
    DEFAULT_GAS_EXECUTE,
    build_tx_params,
    get_split_balance,
    has_pending_funds,
    is_cascade_split,
)
from .types import ExecuteOptions, ExecuteResult


async def execute_split(
    w3: AsyncWeb3,
    account: LocalAccount,
    split_address: str,
    options: ExecuteOptions | None = None,
) -> ExecuteResult:
    """
    Execute split distribution.

    - If split doesn't exist or isn't valid: returns SKIPPED
    - If balance is below threshold: returns SKIPPED
    - If no pending funds: returns SKIPPED
    - On success: returns EXECUTED with transaction hash
    - On failure: returns FAILED with details

    This is a permissionless operation - anyone can call it.

    Args:
        w3: AsyncWeb3 instance connected to the chain
        account: Account to sign the transaction
        split_address: Address of the split to execute
        options: Optional ExecuteOptions with min_balance threshold

    Returns:
        ExecuteResult with status EXECUTED, SKIPPED, or FAILED

    Example:
        >>> from web3 import AsyncWeb3
        >>> from eth_account import Account
        >>> from cascade_splits_evm import execute_split, ExecuteOptions
        >>>
        >>> w3 = AsyncWeb3(AsyncWeb3.AsyncHTTPProvider("https://mainnet.base.org"))
        >>> account = Account.from_key("0x...")
        >>>
        >>> result = await execute_split(
        ...     w3, account, "0xSplitAddress...",
        ...     ExecuteOptions(min_balance=1_000_000)  # 1 USDC minimum
        ... )
    """
    split_address = AsyncWeb3.to_checksum_address(split_address)
    chain_id = await w3.eth.chain_id

    try:
        # Check if valid split
        if not await is_cascade_split(w3, split_address):
            return ExecuteResult(status="SKIPPED", reason="not_a_split")

        # Check balance threshold
        if options and options.min_balance is not None:
            balance = await get_split_balance(w3, split_address)
            if balance < options.min_balance:
                return ExecuteResult(status="SKIPPED", reason="below_threshold")

        # Check pending funds
        if not await has_pending_funds(w3, split_address):
            return ExecuteResult(status="SKIPPED", reason="no_pending_funds")

        # Create contract instance
        split_contract = w3.eth.contract(
            address=split_address,
            abi=SPLIT_CONFIG_IMPL_ABI,
        )

        # Build transaction with gas options
        contract_call = split_contract.functions.executeSplit()
        gas_opts = options.gas if options else None
        tx_params = await build_tx_params(
            w3,
            account.address,
            chain_id,
            DEFAULT_GAS_EXECUTE,
            gas_options=gas_opts,
            contract_call=contract_call,
        )
        tx = await contract_call.build_transaction(tx_params)

        # Sign and send
        signed = account.sign_transaction(tx)
        tx_hash = await w3.eth.send_raw_transaction(signed.raw_transaction)

        # Wait for confirmation
        await w3.eth.wait_for_transaction_receipt(tx_hash)

        return ExecuteResult(status="EXECUTED", signature=tx_hash.hex())

    except ContractLogicError as e:
        return ExecuteResult(
            status="FAILED",
            reason="transaction_reverted",
            message=str(e),
        )
    except Web3Exception as e:
        message = str(e).lower()
        if "rejected" in message or "denied" in message:
            return ExecuteResult(
                status="FAILED",
                reason="wallet_rejected",
                message="Transaction rejected",
            )
        if "gas" in message or "insufficient" in message:
            return ExecuteResult(
                status="FAILED",
                reason="insufficient_gas",
                message=str(e),
            )
        return ExecuteResult(
            status="FAILED",
            reason="transaction_failed",
            message=str(e),
        )
    except Exception as e:
        # Unexpected errors (network issues, etc.)
        return ExecuteResult(
            status="FAILED",
            reason="transaction_failed",
            message=str(e),
        )
