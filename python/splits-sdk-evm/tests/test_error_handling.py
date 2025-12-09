"""Tests for error handling and classification in Cascade Splits SDK.

These tests verify that the SDK correctly classifies different error types
so clients can implement appropriate retry logic.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from web3.exceptions import ContractLogicError, Web3Exception

from cascade_splits_evm import EnsureParams, Recipient
from cascade_splits_evm.ensure import ensure_split
from cascade_splits_evm.execute import execute_split


class _AsyncChainId:
    """Awaitable that returns chain_id each time it's awaited."""

    def __init__(self, chain_id: int):
        self._chain_id = chain_id

    def __await__(self):
        async def _coro():
            return self._chain_id

        return _coro().__await__()


def _create_mock_w3(chain_id: int = 8453):
    """Create a mock AsyncWeb3 instance with proper async chain_id."""
    mock_w3 = MagicMock()
    # Create a mock eth that has chain_id as an awaitable
    mock_eth = MagicMock()
    mock_eth.chain_id = _AsyncChainId(chain_id)
    mock_w3.eth = mock_eth
    return mock_w3


class TestEnsureSplitErrorHandling:
    """Tests for ensure_split error classification."""

    @pytest.mark.asyncio
    async def test_contract_logic_error_returns_transaction_reverted(self) -> None:
        """ContractLogicError should map to reason='transaction_reverted'."""
        mock_w3 = _create_mock_w3()
        mock_account = MagicMock()
        mock_account.address = "0x1234567890123456789012345678901234567890"

        # Mock factory contract to raise ContractLogicError
        mock_factory = MagicMock()
        mock_factory.functions.predictSplitAddress.return_value.call = AsyncMock(
            side_effect=ContractLogicError("execution reverted: InvalidRecipientCount")
        )
        mock_w3.eth.contract.return_value = mock_factory

        with patch(
            "cascade_splits_evm.ensure.AsyncWeb3.to_checksum_address",
            side_effect=lambda x: x,
        ):
            result = await ensure_split(
                mock_w3,
                mock_account,
                "0xFactory",
                EnsureParams(
                    unique_id=b"test-id".ljust(32, b"\x00"),
                    recipients=[
                        Recipient(address="0xAlice", share=60),
                        Recipient(address="0xBob", share=40),
                    ],
                ),
            )

        assert result.status == "FAILED"
        assert result.reason == "transaction_reverted"
        assert "InvalidRecipientCount" in result.message

    @pytest.mark.asyncio
    async def test_web3_rejected_error_returns_wallet_rejected(self) -> None:
        """Web3Exception with 'rejected' should map to reason='wallet_rejected'."""
        mock_w3 = _create_mock_w3()
        mock_account = MagicMock()
        mock_account.address = "0x1234567890123456789012345678901234567890"

        mock_factory = MagicMock()
        mock_factory.functions.predictSplitAddress.return_value.call = AsyncMock(
            side_effect=Web3Exception("Transaction rejected by user")
        )
        mock_w3.eth.contract.return_value = mock_factory

        with patch(
            "cascade_splits_evm.ensure.AsyncWeb3.to_checksum_address",
            side_effect=lambda x: x,
        ):
            result = await ensure_split(
                mock_w3,
                mock_account,
                "0xFactory",
                EnsureParams(
                    unique_id=b"test-id".ljust(32, b"\x00"),
                    recipients=[
                        Recipient(address="0xAlice", share=60),
                        Recipient(address="0xBob", share=40),
                    ],
                ),
            )

        assert result.status == "FAILED"
        assert result.reason == "wallet_rejected"

    @pytest.mark.asyncio
    async def test_web3_denied_error_returns_wallet_rejected(self) -> None:
        """Web3Exception with 'denied' should map to reason='wallet_rejected'."""
        mock_w3 = _create_mock_w3()
        mock_account = MagicMock()
        mock_account.address = "0x1234567890123456789012345678901234567890"

        mock_factory = MagicMock()
        mock_factory.functions.predictSplitAddress.return_value.call = AsyncMock(
            side_effect=Web3Exception("User denied transaction signature")
        )
        mock_w3.eth.contract.return_value = mock_factory

        with patch(
            "cascade_splits_evm.ensure.AsyncWeb3.to_checksum_address",
            side_effect=lambda x: x,
        ):
            result = await ensure_split(
                mock_w3,
                mock_account,
                "0xFactory",
                EnsureParams(
                    unique_id=b"test-id".ljust(32, b"\x00"),
                    recipients=[
                        Recipient(address="0xAlice", share=60),
                        Recipient(address="0xBob", share=40),
                    ],
                ),
            )

        assert result.status == "FAILED"
        assert result.reason == "wallet_rejected"

    @pytest.mark.asyncio
    async def test_web3_gas_error_returns_insufficient_gas(self) -> None:
        """Web3Exception with 'gas' should map to reason='insufficient_gas'."""
        mock_w3 = _create_mock_w3()
        mock_account = MagicMock()
        mock_account.address = "0x1234567890123456789012345678901234567890"

        mock_factory = MagicMock()
        mock_factory.functions.predictSplitAddress.return_value.call = AsyncMock(
            side_effect=Web3Exception("insufficient gas for transaction")
        )
        mock_w3.eth.contract.return_value = mock_factory

        with patch(
            "cascade_splits_evm.ensure.AsyncWeb3.to_checksum_address",
            side_effect=lambda x: x,
        ):
            result = await ensure_split(
                mock_w3,
                mock_account,
                "0xFactory",
                EnsureParams(
                    unique_id=b"test-id".ljust(32, b"\x00"),
                    recipients=[
                        Recipient(address="0xAlice", share=60),
                        Recipient(address="0xBob", share=40),
                    ],
                ),
            )

        assert result.status == "FAILED"
        assert result.reason == "insufficient_gas"

    @pytest.mark.asyncio
    async def test_web3_insufficient_funds_error_returns_insufficient_gas(self) -> None:
        """Web3Exception with 'insufficient' should map to reason='insufficient_gas'."""
        mock_w3 = _create_mock_w3()
        mock_account = MagicMock()
        mock_account.address = "0x1234567890123456789012345678901234567890"

        mock_factory = MagicMock()
        mock_factory.functions.predictSplitAddress.return_value.call = AsyncMock(
            side_effect=Web3Exception("insufficient funds for transfer")
        )
        mock_w3.eth.contract.return_value = mock_factory

        with patch(
            "cascade_splits_evm.ensure.AsyncWeb3.to_checksum_address",
            side_effect=lambda x: x,
        ):
            result = await ensure_split(
                mock_w3,
                mock_account,
                "0xFactory",
                EnsureParams(
                    unique_id=b"test-id".ljust(32, b"\x00"),
                    recipients=[
                        Recipient(address="0xAlice", share=60),
                        Recipient(address="0xBob", share=40),
                    ],
                ),
            )

        assert result.status == "FAILED"
        assert result.reason == "insufficient_gas"

    @pytest.mark.asyncio
    async def test_generic_web3_error_returns_transaction_failed(self) -> None:
        """Generic Web3Exception should map to reason='transaction_failed'."""
        mock_w3 = _create_mock_w3()
        mock_account = MagicMock()
        mock_account.address = "0x1234567890123456789012345678901234567890"

        mock_factory = MagicMock()
        mock_factory.functions.predictSplitAddress.return_value.call = AsyncMock(
            side_effect=Web3Exception("Unknown network error")
        )
        mock_w3.eth.contract.return_value = mock_factory

        with patch(
            "cascade_splits_evm.ensure.AsyncWeb3.to_checksum_address",
            side_effect=lambda x: x,
        ):
            result = await ensure_split(
                mock_w3,
                mock_account,
                "0xFactory",
                EnsureParams(
                    unique_id=b"test-id".ljust(32, b"\x00"),
                    recipients=[
                        Recipient(address="0xAlice", share=60),
                        Recipient(address="0xBob", share=40),
                    ],
                ),
            )

        assert result.status == "FAILED"
        assert result.reason == "transaction_failed"

    @pytest.mark.asyncio
    async def test_generic_exception_returns_transaction_failed(self) -> None:
        """Generic Exception should map to reason='transaction_failed'."""
        mock_w3 = _create_mock_w3()
        mock_account = MagicMock()
        mock_account.address = "0x1234567890123456789012345678901234567890"

        mock_factory = MagicMock()
        mock_factory.functions.predictSplitAddress.return_value.call = AsyncMock(
            side_effect=RuntimeError("Unexpected error")
        )
        mock_w3.eth.contract.return_value = mock_factory

        with patch(
            "cascade_splits_evm.ensure.AsyncWeb3.to_checksum_address",
            side_effect=lambda x: x,
        ):
            result = await ensure_split(
                mock_w3,
                mock_account,
                "0xFactory",
                EnsureParams(
                    unique_id=b"test-id".ljust(32, b"\x00"),
                    recipients=[
                        Recipient(address="0xAlice", share=60),
                        Recipient(address="0xBob", share=40),
                    ],
                ),
            )

        assert result.status == "FAILED"
        assert result.reason == "transaction_failed"
        assert "Unexpected error" in result.message


class TestExecuteSplitErrorHandling:
    """Tests for execute_split error classification."""

    @pytest.mark.asyncio
    async def test_contract_logic_error_returns_transaction_reverted(self) -> None:
        """ContractLogicError should map to reason='transaction_reverted'."""
        mock_w3 = _create_mock_w3()
        mock_w3.eth.get_transaction_count = AsyncMock(return_value=0)
        mock_account = MagicMock()
        mock_account.address = "0x1234567890123456789012345678901234567890"

        # Mock is_cascade_split to return True
        mock_contract = MagicMock()
        mock_contract.functions.isCascadeSplitConfig.return_value.call = AsyncMock(return_value=True)
        mock_contract.functions.hasPendingFunds.return_value.call = AsyncMock(return_value=True)
        mock_contract.functions.executeSplit.return_value.build_transaction = AsyncMock(
            side_effect=ContractLogicError("execution reverted: NoPendingFunds")
        )
        mock_w3.eth.contract.return_value = mock_contract

        with patch(
            "cascade_splits_evm.execute.AsyncWeb3.to_checksum_address",
            side_effect=lambda x: x,
        ), patch(
            "cascade_splits_evm.async_helpers.AsyncWeb3.to_checksum_address",
            side_effect=lambda x: x,
        ):
            result = await execute_split(
                mock_w3,
                mock_account,
                "0xSplit",
            )

        assert result.status == "FAILED"
        assert result.reason == "transaction_reverted"

    @pytest.mark.asyncio
    async def test_web3_rejected_error_returns_wallet_rejected(self) -> None:
        """Web3Exception with 'rejected' should map to reason='wallet_rejected'."""
        mock_w3 = _create_mock_w3()
        mock_w3.eth.get_transaction_count = AsyncMock(return_value=0)
        mock_account = MagicMock()
        mock_account.address = "0x1234567890123456789012345678901234567890"

        mock_contract = MagicMock()
        mock_contract.functions.isCascadeSplitConfig.return_value.call = AsyncMock(return_value=True)
        mock_contract.functions.hasPendingFunds.return_value.call = AsyncMock(return_value=True)
        mock_contract.functions.executeSplit.return_value.build_transaction = AsyncMock(
            side_effect=Web3Exception("Transaction rejected")
        )
        mock_w3.eth.contract.return_value = mock_contract

        with patch(
            "cascade_splits_evm.execute.AsyncWeb3.to_checksum_address",
            side_effect=lambda x: x,
        ), patch(
            "cascade_splits_evm.async_helpers.AsyncWeb3.to_checksum_address",
            side_effect=lambda x: x,
        ):
            result = await execute_split(
                mock_w3,
                mock_account,
                "0xSplit",
            )

        assert result.status == "FAILED"
        assert result.reason == "wallet_rejected"

    @pytest.mark.asyncio
    async def test_web3_gas_error_returns_insufficient_gas(self) -> None:
        """Web3Exception with 'gas' should map to reason='insufficient_gas'."""
        mock_w3 = _create_mock_w3()
        mock_w3.eth.get_transaction_count = AsyncMock(return_value=0)
        mock_account = MagicMock()
        mock_account.address = "0x1234567890123456789012345678901234567890"

        mock_contract = MagicMock()
        mock_contract.functions.isCascadeSplitConfig.return_value.call = AsyncMock(return_value=True)
        mock_contract.functions.hasPendingFunds.return_value.call = AsyncMock(return_value=True)
        mock_contract.functions.executeSplit.return_value.build_transaction = AsyncMock(
            side_effect=Web3Exception("out of gas")
        )
        mock_w3.eth.contract.return_value = mock_contract

        with patch(
            "cascade_splits_evm.execute.AsyncWeb3.to_checksum_address",
            side_effect=lambda x: x,
        ), patch(
            "cascade_splits_evm.async_helpers.AsyncWeb3.to_checksum_address",
            side_effect=lambda x: x,
        ):
            result = await execute_split(
                mock_w3,
                mock_account,
                "0xSplit",
            )

        assert result.status == "FAILED"
        assert result.reason == "insufficient_gas"

    @pytest.mark.asyncio
    async def test_generic_exception_returns_transaction_failed(self) -> None:
        """Generic Exception should map to reason='transaction_failed'."""
        mock_w3 = _create_mock_w3()
        mock_w3.eth.get_transaction_count = AsyncMock(return_value=0)
        mock_account = MagicMock()
        mock_account.address = "0x1234567890123456789012345678901234567890"

        mock_contract = MagicMock()
        mock_contract.functions.isCascadeSplitConfig.return_value.call = AsyncMock(return_value=True)
        mock_contract.functions.hasPendingFunds.return_value.call = AsyncMock(return_value=True)
        mock_contract.functions.executeSplit.return_value.build_transaction = AsyncMock(
            side_effect=RuntimeError("Connection lost")
        )
        mock_w3.eth.contract.return_value = mock_contract

        with patch(
            "cascade_splits_evm.execute.AsyncWeb3.to_checksum_address",
            side_effect=lambda x: x,
        ), patch(
            "cascade_splits_evm.async_helpers.AsyncWeb3.to_checksum_address",
            side_effect=lambda x: x,
        ):
            result = await execute_split(
                mock_w3,
                mock_account,
                "0xSplit",
            )

        assert result.status == "FAILED"
        assert result.reason == "transaction_failed"
        assert "Connection lost" in result.message
