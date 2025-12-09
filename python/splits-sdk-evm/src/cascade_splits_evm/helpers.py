"""Helper functions for Cascade Splits EVM SDK."""

from web3 import Web3

from .abi import SPLIT_CONFIG_IMPL_ABI
from .types import EvmRecipient, ExecutionPreview, Recipient, SplitConfig


def to_evm_recipient(recipient: Recipient) -> EvmRecipient:
    """
    Convert a Recipient (share 1-100) to EvmRecipient (basis points).

    The protocol takes 1% fee, so percentageBps = share * 99.

    Example:
        >>> to_evm_recipient(Recipient(address="0xAlice...", share=50))
        EvmRecipient(addr="0xAlice...", percentage_bps=4950)
    """
    return EvmRecipient(
        addr=recipient.address,
        percentage_bps=recipient.share * 99,  # 1% protocol fee
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


def is_cascade_split(w3: Web3, address: str) -> bool:
    """Check if an address is a valid Cascade split."""
    try:
        contract = w3.eth.contract(
            address=Web3.to_checksum_address(address),
            abi=SPLIT_CONFIG_IMPL_ABI,
        )
        return contract.functions.isCascadeSplitConfig().call()
    except Exception:
        return False


def get_split_balance(w3: Web3, split_address: str) -> int:
    """
    Get the token balance of a split.

    Returns:
        Balance in token's smallest unit (e.g., 6 decimals for USDC)
    """
    contract = w3.eth.contract(
        address=Web3.to_checksum_address(split_address),
        abi=SPLIT_CONFIG_IMPL_ABI,
    )
    return contract.functions.getBalance().call()


def has_pending_funds(w3: Web3, split_address: str) -> bool:
    """Check if a split has pending funds to distribute."""
    contract = w3.eth.contract(
        address=Web3.to_checksum_address(split_address),
        abi=SPLIT_CONFIG_IMPL_ABI,
    )
    return contract.functions.hasPendingFunds().call()


def get_split_config(w3: Web3, split_address: str) -> SplitConfig:
    """Get the configuration of a split."""
    contract = w3.eth.contract(
        address=Web3.to_checksum_address(split_address),
        abi=SPLIT_CONFIG_IMPL_ABI,
    )

    authority = contract.functions.authority().call()
    token = contract.functions.token().call()
    unique_id = contract.functions.uniqueId().call()
    raw_recipients = contract.functions.getRecipients().call()

    recipients = [EvmRecipient(addr=r[0], percentage_bps=r[1]) for r in raw_recipients]

    return SplitConfig(
        authority=authority,
        token=token,
        unique_id=unique_id,
        recipients=recipients,
    )


def preview_execution(w3: Web3, split_address: str) -> ExecutionPreview:
    """Preview what would happen if the split is executed."""
    contract = w3.eth.contract(
        address=Web3.to_checksum_address(split_address),
        abi=SPLIT_CONFIG_IMPL_ABI,
    )

    result = contract.functions.previewExecution().call()

    return ExecutionPreview(
        recipient_amounts=list(result[0]),
        protocol_fee=result[1],
        available=result[2],
        pending_recipient_amounts=list(result[3]),
        pending_protocol_amount=result[4],
    )


def get_pending_amount(w3: Web3, split_address: str) -> int:
    """Get the pending amount to be distributed."""
    contract = w3.eth.contract(
        address=Web3.to_checksum_address(split_address),
        abi=SPLIT_CONFIG_IMPL_ABI,
    )
    return contract.functions.pendingAmount().call()


def get_total_unclaimed(w3: Web3, split_address: str) -> int:
    """Get the total unclaimed amount (failed transfers)."""
    contract = w3.eth.contract(
        address=Web3.to_checksum_address(split_address),
        abi=SPLIT_CONFIG_IMPL_ABI,
    )
    return contract.functions.totalUnclaimed().call()
