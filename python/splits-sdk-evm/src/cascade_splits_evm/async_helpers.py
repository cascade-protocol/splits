"""Async helper functions for Cascade Splits EVM SDK."""

from typing import cast

from eth_typing import ChecksumAddress
from web3 import AsyncWeb3
from web3.contract.async_contract import AsyncContractFunction

from .abi import SPLIT_CONFIG_IMPL_ABI, SPLIT_FACTORY_ABI
from .constants import get_usdc_address
from .types import EvmRecipient, ExecutionPreview, GasOptions, Recipient, SplitConfig

# Type alias for transaction params
TxParams = dict[str, int | str]

# Default gas limits for operations
DEFAULT_GAS_CREATE = 300_000
DEFAULT_GAS_EXECUTE = 600_000
DEFAULT_PRIORITY_FEE = 1_000_000_000  # 1 gwei


def to_evm_recipient(recipient: Recipient) -> EvmRecipient:
    """
    Convert a Recipient (share 1-100) to EvmRecipient (basis points).

    The protocol takes 1% fee, so percentageBps = share * 99.
    """
    return EvmRecipient(
        addr=recipient.address,
        percentage_bps=recipient.share * 99,
    )


def to_evm_recipients(recipients: list[Recipient]) -> list[EvmRecipient]:
    """
    Convert a list of Recipients to EvmRecipients.

    Raises:
        ValueError: If shares don't sum to 100
    """
    total = sum(r.share for r in recipients)
    if total != 100:
        raise ValueError(f"Recipient shares must sum to 100, got {total}")

    return [to_evm_recipient(r) for r in recipients]


def get_default_token(chain_id: int) -> str:
    """Get the default token (USDC) address for a chain."""
    return get_usdc_address(chain_id)


async def build_tx_params(
    w3: AsyncWeb3,
    sender: ChecksumAddress | str,
    chain_id: int,
    default_gas: int,
    gas_options: GasOptions | None = None,
    contract_call: AsyncContractFunction | None = None,
) -> TxParams:
    """
    Build transaction parameters with gas options.

    Handles:
    - Gas estimation (with 20% buffer) when estimate_gas=True
    - EIP-1559 type 2 transactions when max_fee_per_gas is set
    - Fallback to legacy transactions otherwise

    Args:
        w3: AsyncWeb3 instance
        sender: Sender address
        chain_id: Chain ID
        default_gas: Default gas limit if not estimating
        gas_options: Optional gas configuration
        contract_call: Contract function call for estimation (required if estimate_gas=True)

    Returns:
        Transaction parameters dict
    """
    nonce = await w3.eth.get_transaction_count(cast(ChecksumAddress, sender))

    tx_params: TxParams = {
        "from": sender,
        "nonce": nonce,
        "chainId": chain_id,
    }

    opts = gas_options or GasOptions()

    # Determine gas limit
    if opts.gas_limit is not None:
        tx_params["gas"] = opts.gas_limit
    elif opts.estimate_gas and contract_call is not None:
        estimated = await contract_call.estimate_gas({"from": sender})
        tx_params["gas"] = int(estimated * 1.2)  # 20% buffer
    else:
        tx_params["gas"] = default_gas

    # EIP-1559 or legacy
    if opts.max_fee_per_gas is not None:
        tx_params["type"] = "0x2"
        tx_params["maxFeePerGas"] = opts.max_fee_per_gas
        tx_params["maxPriorityFeePerGas"] = (
            opts.max_priority_fee_per_gas if opts.max_priority_fee_per_gas is not None else DEFAULT_PRIORITY_FEE
        )

    return tx_params


async def is_cascade_split(w3: AsyncWeb3, address: str) -> bool:
    """Check if an address is a valid Cascade split."""
    try:
        contract = w3.eth.contract(
            address=AsyncWeb3.to_checksum_address(address),
            abi=SPLIT_CONFIG_IMPL_ABI,
        )
        return await contract.functions.isCascadeSplitConfig().call()
    except Exception:
        return False


async def get_split_balance(w3: AsyncWeb3, split_address: str) -> int:
    """
    Get the token balance of a split.

    Returns:
        Balance in token's smallest unit (e.g., 6 decimals for USDC)
    """
    contract = w3.eth.contract(
        address=AsyncWeb3.to_checksum_address(split_address),
        abi=SPLIT_CONFIG_IMPL_ABI,
    )
    return await contract.functions.getBalance().call()


async def has_pending_funds(w3: AsyncWeb3, split_address: str) -> bool:
    """Check if a split has pending funds to distribute."""
    contract = w3.eth.contract(
        address=AsyncWeb3.to_checksum_address(split_address),
        abi=SPLIT_CONFIG_IMPL_ABI,
    )
    return await contract.functions.hasPendingFunds().call()


async def get_pending_amount(w3: AsyncWeb3, split_address: str) -> int:
    """Get the pending amount to be distributed."""
    contract = w3.eth.contract(
        address=AsyncWeb3.to_checksum_address(split_address),
        abi=SPLIT_CONFIG_IMPL_ABI,
    )
    return await contract.functions.pendingAmount().call()


async def get_total_unclaimed(w3: AsyncWeb3, split_address: str) -> int:
    """Get the total unclaimed amount (failed transfers)."""
    contract = w3.eth.contract(
        address=AsyncWeb3.to_checksum_address(split_address),
        abi=SPLIT_CONFIG_IMPL_ABI,
    )
    return await contract.functions.totalUnclaimed().call()


async def get_split_config(w3: AsyncWeb3, split_address: str) -> SplitConfig | None:
    """Get the configuration of a split. Returns None if not a valid split."""
    try:
        contract = w3.eth.contract(
            address=AsyncWeb3.to_checksum_address(split_address),
            abi=SPLIT_CONFIG_IMPL_ABI,
        )

        is_valid = await contract.functions.isCascadeSplitConfig().call()
        if not is_valid:
            return None

        authority = await contract.functions.authority().call()
        token = await contract.functions.token().call()
        unique_id = await contract.functions.uniqueId().call()
        raw_recipients = await contract.functions.getRecipients().call()

        recipients = [EvmRecipient(addr=r[0], percentage_bps=r[1]) for r in raw_recipients]

        return SplitConfig(
            authority=authority,
            token=token,
            unique_id=unique_id,
            recipients=recipients,
        )
    except Exception:
        return None


async def preview_execution(w3: AsyncWeb3, split_address: str) -> ExecutionPreview:
    """Preview what would happen if the split is executed."""
    contract = w3.eth.contract(
        address=AsyncWeb3.to_checksum_address(split_address),
        abi=SPLIT_CONFIG_IMPL_ABI,
    )

    result = await contract.functions.previewExecution().call()

    return ExecutionPreview(
        recipient_amounts=list(result[0]),
        protocol_fee=result[1],
        available=result[2],
        pending_recipient_amounts=list(result[3]),
        pending_protocol_amount=result[4],
    )


async def predict_split_address(
    w3: AsyncWeb3,
    factory_address: str,
    authority: str,
    token: str,
    unique_id: bytes,
    recipients: list[EvmRecipient],
) -> str:
    """
    Predict the deterministic address of a split before creation.

    Args:
        w3: AsyncWeb3 instance
        factory_address: The split factory contract address
        authority: The authority address for the split
        token: The token address (e.g., USDC)
        unique_id: Unique identifier (32 bytes)
        recipients: List of EvmRecipients with percentage_bps

    Returns:
        Predicted split address
    """
    factory = w3.eth.contract(
        address=AsyncWeb3.to_checksum_address(factory_address),
        abi=SPLIT_FACTORY_ABI,
    )

    recipient_tuples = [(r.addr, r.percentage_bps) for r in recipients]

    return await factory.functions.predictSplitAddress(
        AsyncWeb3.to_checksum_address(authority),
        AsyncWeb3.to_checksum_address(token),
        unique_id,
        recipient_tuples,
    ).call()
