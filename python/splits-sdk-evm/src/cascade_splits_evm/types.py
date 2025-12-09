"""Type definitions for cascade-splits-evm SDK."""

from typing import Literal

from pydantic import BaseModel, Field


class Recipient(BaseModel):
    """
    A recipient with a share percentage (1-100).

    Shares must sum to exactly 100 across all recipients.
    Protocol takes 1% fee, so each share represents (share * 0.99)% of funds.

    Example:
        Recipient(address="0xAlice...", share=60)  # 60% of 99% = 59.4%
    """

    address: str
    share: int = Field(ge=1, le=100)

    model_config = {"frozen": True}


class EvmRecipient(BaseModel):
    """
    On-chain recipient format with basis points.

    This is the format used by the smart contracts.
    Use to_evm_recipient() to convert from Recipient.
    """

    addr: str
    percentage_bps: int = Field(ge=1, le=9900)

    model_config = {"frozen": True}


class SplitConfig(BaseModel):
    """Configuration for a payment split."""

    authority: str
    token: str
    unique_id: bytes
    recipients: list[EvmRecipient]

    model_config = {"frozen": True}


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


class EnsureResult(BaseModel):
    """
    Result of ensure_split operation.

    status: CREATED | NO_CHANGE | FAILED
    """

    status: EnsureStatus
    split: str | None = None
    signature: str | None = None
    reason: FailedReason | str | None = None
    message: str | None = None

    model_config = {"frozen": True}


class ExecuteResult(BaseModel):
    """
    Result of execute_split operation.

    status: EXECUTED | SKIPPED | FAILED
    """

    status: ExecuteStatus
    signature: str | None = None
    reason: FailedReason | SkippedReason | str | None = None
    message: str | None = None

    model_config = {"frozen": True}


class ExecutionPreview(BaseModel):
    """Preview of what would happen if split is executed."""

    recipient_amounts: list[int]
    protocol_fee: int
    available: int
    pending_recipient_amounts: list[int]
    pending_protocol_amount: int

    model_config = {"frozen": True}
