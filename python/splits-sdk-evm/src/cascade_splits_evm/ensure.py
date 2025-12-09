"""Standalone ensure_split operation for Cascade Splits."""

from eth_account.signers.local import LocalAccount
from web3 import AsyncWeb3
from web3.exceptions import ContractLogicError, Web3Exception

from .abi import SPLIT_FACTORY_ABI
from .async_helpers import (
    DEFAULT_GAS_CREATE,
    build_tx_params,
    get_default_token,
    to_evm_recipients,
)
from .constants import MAX_RECIPIENTS, MIN_RECIPIENTS
from .types import EnsureParams, EnsureResult


async def ensure_split(
    w3: AsyncWeb3,
    account: LocalAccount,
    factory_address: str,
    params: EnsureParams,
) -> EnsureResult:
    """
    Idempotent split creation.

    - If split doesn't exist: creates it and returns CREATED
    - If split exists with same params: returns NO_CHANGE
    - If creation fails: returns FAILED with details

    Note: Unlike Solana, EVM splits are immutable (cannot update recipients).

    Args:
        w3: AsyncWeb3 instance connected to the chain
        account: Account to sign the transaction
        factory_address: The split factory contract address
        params: EnsureParams with unique_id, recipients, optional authority/token

    Returns:
        EnsureResult with status CREATED, NO_CHANGE, or FAILED

    Example:
        >>> from web3 import AsyncWeb3
        >>> from eth_account import Account
        >>> from cascade_splits_evm import ensure_split, EnsureParams, Recipient
        >>>
        >>> w3 = AsyncWeb3(AsyncWeb3.AsyncHTTPProvider("https://mainnet.base.org"))
        >>> account = Account.from_key("0x...")
        >>> factory = "0x946Cd053514b1Ab7829dD8fEc85E0ade5550dcf7"
        >>>
        >>> result = await ensure_split(w3, account, factory, EnsureParams(
        ...     unique_id=b"my-split-id",
        ...     recipients=[
        ...         Recipient(address="0xAlice...", share=60),
        ...         Recipient(address="0xBob...", share=40),
        ...     ]
        ... ))
    """
    factory_address = AsyncWeb3.to_checksum_address(factory_address)
    chain_id = await w3.eth.chain_id

    # Resolve defaults
    authority = AsyncWeb3.to_checksum_address(params.authority or account.address)
    token = AsyncWeb3.to_checksum_address(params.token or get_default_token(chain_id))

    # Pad/truncate unique_id to 32 bytes
    unique_id = params.unique_id
    if len(unique_id) < 32:
        unique_id = unique_id.ljust(32, b"\x00")
    elif len(unique_id) > 32:
        unique_id = unique_id[:32]

    # Validate recipient count
    recipient_count = len(params.recipients)
    if not (MIN_RECIPIENTS <= recipient_count <= MAX_RECIPIENTS):
        msg = f"Recipients: expected {MIN_RECIPIENTS}-{MAX_RECIPIENTS}, got {recipient_count}"
        return EnsureResult(status="FAILED", reason="transaction_failed", message=msg)

    # Convert recipients
    try:
        evm_recipients = to_evm_recipients(params.recipients)
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
        factory = w3.eth.contract(address=factory_address, abi=SPLIT_FACTORY_ABI)
        recipient_tuples = [(r.addr, r.percentage_bps) for r in evm_recipients]

        # Predict address
        predicted = await factory.functions.predictSplitAddress(
            authority,
            token,
            unique_id,
            recipient_tuples,
        ).call()

        # Check if already deployed
        code = await w3.eth.get_code(predicted)
        if code and len(code) > 0:
            return EnsureResult(status="NO_CHANGE", split=predicted)

        # Build transaction with gas options
        contract_call = factory.functions.createSplitConfig(authority, token, unique_id, recipient_tuples)
        tx_params = await build_tx_params(
            w3,
            account.address,
            chain_id,
            DEFAULT_GAS_CREATE,
            gas_options=params.gas,
            contract_call=contract_call,
        )
        tx = await contract_call.build_transaction(tx_params)

        # Sign and send
        signed = account.sign_transaction(tx)
        tx_hash = await w3.eth.send_raw_transaction(signed.raw_transaction)

        # Wait for confirmation
        await w3.eth.wait_for_transaction_receipt(tx_hash)

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
        message = str(e).lower()
        if "rejected" in message or "denied" in message:
            return EnsureResult(
                status="FAILED",
                reason="wallet_rejected",
                message="Transaction rejected",
            )
        if "gas" in message or "insufficient" in message:
            return EnsureResult(
                status="FAILED",
                reason="insufficient_gas",
                message=str(e),
            )
        return EnsureResult(
            status="FAILED",
            reason="transaction_failed",
            message=str(e),
        )
    except Exception as e:
        # Unexpected errors (network issues, etc.)
        return EnsureResult(
            status="FAILED",
            reason="transaction_failed",
            message=str(e),
        )
