"""
Type definitions for Cascade Splits Python SDK.
"""

from dataclasses import dataclass
from typing import Optional, List, Literal, Union


@dataclass
class Recipient:
    """
    A recipient with a share percentage (1-100).
    
    Shares must sum to exactly 100 across all recipients.
    Protocol takes 1% fee, so each share represents (share * 0.99)% of funds.
    
    Example:
        Recipient(address="0xAlice...", share=60)  # 60% of 99% = 59.4%
    """
    address: str
    share: int  # 1-100, total must equal 100


@dataclass
class EvmRecipient:
    """
    On-chain recipient format with basis points.
    
    This is the format used by the smart contracts.
    Use to_evm_recipient() to convert from Recipient.
    """
    addr: str
    percentage_bps: int  # Basis points (share * 99)


@dataclass
class SplitConfig:
    """
    Configuration for a payment split.
    """
    authority: str
    token: str
    unique_id: bytes
    recipients: List[EvmRecipient]


# Result status types
EnsureStatus = Literal["CREATED", "NO_CHANGE", "FAILED"]
ExecuteStatus = Literal["EXECUTED", "SKIPPED", "FAILED"]
FailedReason = Literal[
    "wallet_rejected",
    "wallet_disconnected", 
    "network_error",
    "transaction_failed",
    "transaction_reverted",
    "insufficient_gas",
]
SkippedReason = Literal[
    "not_found",
    "not_a_split",
    "below_threshold",
    "no_pending_funds",
]


@dataclass
class EnsureResult:
    """
    Result of ensure_split operation.
    
    status: CREATED | NO_CHANGE | FAILED
    """
    status: EnsureStatus
    split: Optional[str] = None
    signature: Optional[str] = None
    reason: Optional[Union[FailedReason, str]] = None
    message: Optional[str] = None


@dataclass
class ExecuteResult:
    """
    Result of execute_split operation.
    
    status: EXECUTED | SKIPPED | FAILED
    """
    status: ExecuteStatus
    signature: Optional[str] = None
    reason: Optional[Union[FailedReason, SkippedReason, str]] = None
    message: Optional[str] = None


@dataclass
class ExecutionPreview:
    """
    Preview of what would happen if split is executed.
    """
    recipient_amounts: List[int]
    protocol_fee: int
    available: int
    pending_recipient_amounts: List[int]
    pending_protocol_amount: int
