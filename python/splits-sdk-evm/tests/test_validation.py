"""Tests for input validation in Cascade Splits SDK.

These tests verify that the SDK properly validates inputs before
sending transactions to prevent wasted gas and confusing on-chain reverts.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from cascade_splits_evm import EnsureParams, Recipient
from cascade_splits_evm.ensure import ensure_split


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
    mock_eth = MagicMock()
    mock_eth.chain_id = _AsyncChainId(chain_id)
    mock_w3.eth = mock_eth
    return mock_w3


class TestRecipientCountValidation:
    """Tests for recipient count validation."""

    @pytest.mark.asyncio
    async def test_ensure_fails_empty_recipients(self) -> None:
        """Empty recipients list should fail with clear message."""
        mock_w3 = _create_mock_w3()
        mock_account = MagicMock()
        mock_account.address = "0x1234567890123456789012345678901234567890"

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
                    recipients=[],  # Empty!
                ),
            )

        assert result.status == "FAILED"
        assert result.reason == "transaction_failed"
        assert result.message is not None
        assert "1-20" in result.message or "Recipients" in result.message

    @pytest.mark.asyncio
    async def test_ensure_fails_too_many_recipients(self) -> None:
        """More than 20 recipients should fail."""
        mock_w3 = _create_mock_w3()
        mock_account = MagicMock()
        mock_account.address = "0x1234567890123456789012345678901234567890"

        # Create 21 recipients (each with ~4.76% share to sum to 100)
        # This won't actually sum to 100, so we'll use different shares
        recipients = []
        for i in range(21):
            recipients.append(Recipient(address=f"0x{i:040x}", share=4))
        # Adjust last one to make it sum to 100
        recipients[-1] = Recipient(address=f"0x{20:040x}", share=20)  # 20 * 4 + 20 = 100

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
                    recipients=recipients,  # 21 recipients!
                ),
            )

        assert result.status == "FAILED"
        assert result.reason == "transaction_failed"
        assert result.message is not None
        assert "21" in result.message or "20" in result.message

    @pytest.mark.asyncio
    async def test_ensure_accepts_single_recipient(self) -> None:
        """Single recipient with 100% share should work."""
        mock_w3 = _create_mock_w3()
        mock_w3.eth.get_code = AsyncMock(return_value=b"")  # Not deployed yet
        mock_w3.eth.get_transaction_count = AsyncMock(return_value=0)
        mock_w3.eth.send_raw_transaction = AsyncMock(return_value=b"0x" + b"ab" * 32)
        mock_w3.eth.wait_for_transaction_receipt = AsyncMock(return_value={"status": 1})

        mock_account = MagicMock()
        mock_account.address = "0x1234567890123456789012345678901234567890"
        mock_account.sign_transaction.return_value = MagicMock(raw_transaction=b"signed")

        mock_factory = MagicMock()
        mock_factory.functions.predictSplitAddress.return_value.call = AsyncMock(return_value="0xPredictedSplit")
        mock_factory.functions.createSplitConfig.return_value.build_transaction = AsyncMock(
            return_value={"gas": 300000}
        )
        mock_w3.eth.contract.return_value = mock_factory

        with (
            patch(
                "cascade_splits_evm.ensure.AsyncWeb3.to_checksum_address",
                side_effect=lambda x: x,
            ),
            patch(
                "cascade_splits_evm.async_helpers.AsyncWeb3.to_checksum_address",
                side_effect=lambda x: x,
            ),
        ):
            result = await ensure_split(
                mock_w3,
                mock_account,
                "0xFactory",
                EnsureParams(
                    unique_id=b"test-id".ljust(32, b"\x00"),
                    recipients=[
                        Recipient(address="0xSingleRecipient", share=100),
                    ],
                ),
            )

        assert result.status == "CREATED"
        assert result.split == "0xPredictedSplit"

    @pytest.mark.asyncio
    async def test_ensure_accepts_max_recipients(self) -> None:
        """Exactly 20 recipients should work."""
        mock_w3 = _create_mock_w3()
        mock_w3.eth.get_code = AsyncMock(return_value=b"")
        mock_w3.eth.get_transaction_count = AsyncMock(return_value=0)
        mock_w3.eth.send_raw_transaction = AsyncMock(return_value=b"0x" + b"ab" * 32)
        mock_w3.eth.wait_for_transaction_receipt = AsyncMock(return_value={"status": 1})

        mock_account = MagicMock()
        mock_account.address = "0x1234567890123456789012345678901234567890"
        mock_account.sign_transaction.return_value = MagicMock(raw_transaction=b"signed")

        mock_factory = MagicMock()
        mock_factory.functions.predictSplitAddress.return_value.call = AsyncMock(return_value="0xPredictedSplit")
        mock_factory.functions.createSplitConfig.return_value.build_transaction = AsyncMock(
            return_value={"gas": 300000}
        )
        mock_w3.eth.contract.return_value = mock_factory

        # Create exactly 20 recipients: 19 with 5% each + 1 with 5% = 100%
        recipients = [Recipient(address=f"0x{i:040x}", share=5) for i in range(20)]

        with (
            patch(
                "cascade_splits_evm.ensure.AsyncWeb3.to_checksum_address",
                side_effect=lambda x: x,
            ),
            patch(
                "cascade_splits_evm.async_helpers.AsyncWeb3.to_checksum_address",
                side_effect=lambda x: x,
            ),
        ):
            result = await ensure_split(
                mock_w3,
                mock_account,
                "0xFactory",
                EnsureParams(
                    unique_id=b"test-id".ljust(32, b"\x00"),
                    recipients=recipients,
                ),
            )

        assert result.status == "CREATED"


class TestShareValidation:
    """Tests for share percentage validation."""

    @pytest.mark.asyncio
    async def test_ensure_fails_shares_not_100(self) -> None:
        """Shares not summing to 100 should fail."""
        mock_w3 = _create_mock_w3()
        mock_account = MagicMock()
        mock_account.address = "0x1234567890123456789012345678901234567890"

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
                        Recipient(address="0xBob", share=30),  # Only 90%, not 100!
                    ],
                ),
            )

        assert result.status == "FAILED"
        assert result.reason == "transaction_failed"
        assert result.message is not None
        assert "100" in result.message or "sum" in result.message.lower()

    @pytest.mark.asyncio
    async def test_ensure_fails_shares_over_100(self) -> None:
        """Shares summing to more than 100 should fail."""
        mock_w3 = _create_mock_w3()
        mock_account = MagicMock()
        mock_account.address = "0x1234567890123456789012345678901234567890"

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
                        Recipient(address="0xBob", share=50),  # 110%, too much!
                    ],
                ),
            )

        assert result.status == "FAILED"
        assert result.reason == "transaction_failed"


class TestUniqueIdHandling:
    """Tests for unique_id padding and truncation."""

    @pytest.mark.asyncio
    async def test_short_unique_id_is_padded(self) -> None:
        """Short unique_id should be padded to 32 bytes."""
        mock_w3 = _create_mock_w3()
        mock_w3.eth.get_code = AsyncMock(return_value=b"")
        mock_w3.eth.get_transaction_count = AsyncMock(return_value=0)
        mock_w3.eth.send_raw_transaction = AsyncMock(return_value=b"0x" + b"ab" * 32)
        mock_w3.eth.wait_for_transaction_receipt = AsyncMock(return_value={"status": 1})

        mock_account = MagicMock()
        mock_account.address = "0x1234567890123456789012345678901234567890"
        mock_account.sign_transaction.return_value = MagicMock(raw_transaction=b"signed")

        captured_unique_id = None

        def capture_predict_call(*args):
            nonlocal captured_unique_id
            # args[2] is uniqueId in predictSplitAddress(authority, token, uniqueId, recipients)
            captured_unique_id = args[2]
            mock_result = MagicMock()
            mock_result.call = AsyncMock(return_value="0xPredictedSplit")
            return mock_result

        mock_factory = MagicMock()
        mock_factory.functions.predictSplitAddress.side_effect = capture_predict_call
        mock_factory.functions.createSplitConfig.return_value.build_transaction = AsyncMock(
            return_value={"gas": 300000}
        )
        mock_w3.eth.contract.return_value = mock_factory

        with (
            patch(
                "cascade_splits_evm.ensure.AsyncWeb3.to_checksum_address",
                side_effect=lambda x: x,
            ),
            patch(
                "cascade_splits_evm.async_helpers.AsyncWeb3.to_checksum_address",
                side_effect=lambda x: x,
            ),
        ):
            result = await ensure_split(
                mock_w3,
                mock_account,
                "0xFactory",
                EnsureParams(
                    unique_id=b"short",  # Only 5 bytes!
                    recipients=[
                        Recipient(address="0xAlice", share=60),
                        Recipient(address="0xBob", share=40),
                    ],
                ),
            )

        assert result.status == "CREATED"
        # Verify the unique_id was padded to 32 bytes
        assert captured_unique_id is not None
        assert len(captured_unique_id) == 32
        assert captured_unique_id.startswith(b"short")
        assert captured_unique_id == b"short" + b"\x00" * 27

    @pytest.mark.asyncio
    async def test_long_unique_id_is_truncated(self) -> None:
        """Long unique_id should be truncated to 32 bytes."""
        mock_w3 = _create_mock_w3()
        mock_w3.eth.get_code = AsyncMock(return_value=b"")
        mock_w3.eth.get_transaction_count = AsyncMock(return_value=0)
        mock_w3.eth.send_raw_transaction = AsyncMock(return_value=b"0x" + b"ab" * 32)
        mock_w3.eth.wait_for_transaction_receipt = AsyncMock(return_value={"status": 1})

        mock_account = MagicMock()
        mock_account.address = "0x1234567890123456789012345678901234567890"
        mock_account.sign_transaction.return_value = MagicMock(raw_transaction=b"signed")

        captured_unique_id = None

        def capture_predict_call(*args):
            nonlocal captured_unique_id
            captured_unique_id = args[2]
            mock_result = MagicMock()
            mock_result.call = AsyncMock(return_value="0xPredictedSplit")
            return mock_result

        mock_factory = MagicMock()
        mock_factory.functions.predictSplitAddress.side_effect = capture_predict_call
        mock_factory.functions.createSplitConfig.return_value.build_transaction = AsyncMock(
            return_value={"gas": 300000}
        )
        mock_w3.eth.contract.return_value = mock_factory

        long_id = b"this-is-a-very-long-unique-id-that-exceeds-32-bytes"
        assert len(long_id) > 32

        with (
            patch(
                "cascade_splits_evm.ensure.AsyncWeb3.to_checksum_address",
                side_effect=lambda x: x,
            ),
            patch(
                "cascade_splits_evm.async_helpers.AsyncWeb3.to_checksum_address",
                side_effect=lambda x: x,
            ),
        ):
            result = await ensure_split(
                mock_w3,
                mock_account,
                "0xFactory",
                EnsureParams(
                    unique_id=long_id,  # More than 32 bytes!
                    recipients=[
                        Recipient(address="0xAlice", share=60),
                        Recipient(address="0xBob", share=40),
                    ],
                ),
            )

        assert result.status == "CREATED"
        # Verify the unique_id was truncated to 32 bytes
        assert captured_unique_id is not None
        assert len(captured_unique_id) == 32
        assert captured_unique_id == long_id[:32]

    @pytest.mark.asyncio
    async def test_exact_32_byte_unique_id_unchanged(self) -> None:
        """Exactly 32-byte unique_id should be used as-is."""
        mock_w3 = _create_mock_w3()
        mock_w3.eth.get_code = AsyncMock(return_value=b"")
        mock_w3.eth.get_transaction_count = AsyncMock(return_value=0)
        mock_w3.eth.send_raw_transaction = AsyncMock(return_value=b"0x" + b"ab" * 32)
        mock_w3.eth.wait_for_transaction_receipt = AsyncMock(return_value={"status": 1})

        mock_account = MagicMock()
        mock_account.address = "0x1234567890123456789012345678901234567890"
        mock_account.sign_transaction.return_value = MagicMock(raw_transaction=b"signed")

        captured_unique_id = None

        def capture_predict_call(*args):
            nonlocal captured_unique_id
            captured_unique_id = args[2]
            mock_result = MagicMock()
            mock_result.call = AsyncMock(return_value="0xPredictedSplit")
            return mock_result

        mock_factory = MagicMock()
        mock_factory.functions.predictSplitAddress.side_effect = capture_predict_call
        mock_factory.functions.createSplitConfig.return_value.build_transaction = AsyncMock(
            return_value={"gas": 300000}
        )
        mock_w3.eth.contract.return_value = mock_factory

        exact_32 = b"exactly-32-bytes-long-id-here!!!"  # 32 bytes
        assert len(exact_32) == 32

        with (
            patch(
                "cascade_splits_evm.ensure.AsyncWeb3.to_checksum_address",
                side_effect=lambda x: x,
            ),
            patch(
                "cascade_splits_evm.async_helpers.AsyncWeb3.to_checksum_address",
                side_effect=lambda x: x,
            ),
        ):
            result = await ensure_split(
                mock_w3,
                mock_account,
                "0xFactory",
                EnsureParams(
                    unique_id=exact_32,
                    recipients=[
                        Recipient(address="0xAlice", share=60),
                        Recipient(address="0xBob", share=40),
                    ],
                ),
            )

        assert result.status == "CREATED"
        assert captured_unique_id == exact_32
