"""Custom exceptions for cascade-splits-evm SDK."""


class CascadeSplitsError(Exception):
    """Base exception for cascade-splits-evm."""


class ConfigurationError(CascadeSplitsError):
    """Invalid configuration (missing RPC URL, private key, etc.)."""


class ChainNotSupportedError(CascadeSplitsError):
    """Unsupported chain ID."""

    def __init__(self, chain_id: int) -> None:
        super().__init__(f"Chain {chain_id} is not supported")
        self.chain_id = chain_id


class TransactionError(CascadeSplitsError):
    """Transaction failed."""


class TransactionRejectedError(TransactionError):
    """Transaction was rejected by the wallet."""


class TransactionRevertedError(TransactionError):
    """Transaction reverted on-chain."""


class InsufficientGasError(TransactionError):
    """Insufficient gas for transaction."""
