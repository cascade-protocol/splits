"""Tests for async helper functions."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from cascade_splits_evm import Recipient
from cascade_splits_evm.async_helpers import (
    get_default_token,
    get_pending_amount,
    get_split_balance,
    get_split_config,
    get_total_unclaimed,
    has_pending_funds,
    is_cascade_split,
    predict_split_address,
    preview_execution,
    to_evm_recipient,
    to_evm_recipients,
)
from cascade_splits_evm.types import EvmRecipient


class TestAsyncHelpers:
    """Tests for async helper functions."""

    def test_to_evm_recipient(self) -> None:
        """Test converting Recipient to EvmRecipient."""
        recipient = Recipient(address="0xAlice", share=50)
        evm_recipient = to_evm_recipient(recipient)

        assert evm_recipient.addr == "0xAlice"
        assert evm_recipient.percentage_bps == 4950  # 50 * 99

    def test_to_evm_recipients_valid(self) -> None:
        """Test converting list of Recipients."""
        recipients = [
            Recipient(address="0xAlice", share=60),
            Recipient(address="0xBob", share=40),
        ]
        evm_recipients = to_evm_recipients(recipients)

        assert len(evm_recipients) == 2
        assert evm_recipients[0].percentage_bps == 5940  # 60 * 99
        assert evm_recipients[1].percentage_bps == 3960  # 40 * 99

    def test_to_evm_recipients_invalid_sum(self) -> None:
        """Test that invalid sum raises ValueError."""
        recipients = [
            Recipient(address="0xAlice", share=60),
            Recipient(address="0xBob", share=30),  # Sum = 90, not 100
        ]

        with pytest.raises(ValueError, match="must sum to 100"):
            to_evm_recipients(recipients)

    def test_get_default_token_base_mainnet(self) -> None:
        """Test getting default token for Base mainnet."""
        token = get_default_token(8453)
        assert token == "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"  # Base USDC

    def test_get_default_token_base_sepolia(self) -> None:
        """Test getting default token for Base Sepolia."""
        token = get_default_token(84532)
        assert token == "0x036CbD53842c5426634e7929541eC2318f3dCF7e"  # Sepolia USDC


class TestAsyncContractCalls:
    """Tests for async contract call functions."""

    @pytest.mark.asyncio
    async def test_is_cascade_split_true(self) -> None:
        """Test is_cascade_split returns True for valid split."""
        mock_w3 = MagicMock()
        mock_contract = MagicMock()
        mock_contract.functions.isCascadeSplitConfig.return_value.call = AsyncMock(
            return_value=True
        )
        mock_w3.eth.contract.return_value = mock_contract
        mock_w3.to_checksum_address = lambda x: x

        # Patch AsyncWeb3.to_checksum_address
        with patch(
            "cascade_splits_evm.async_helpers.AsyncWeb3.to_checksum_address",
            return_value="0xSplit",
        ):
            result = await is_cascade_split(mock_w3, "0xSplit")

        assert result is True

    @pytest.mark.asyncio
    async def test_is_cascade_split_false_on_error(self) -> None:
        """Test is_cascade_split returns False on error."""
        mock_w3 = MagicMock()
        mock_w3.eth.contract.side_effect = Exception("Not a split")

        with patch(
            "cascade_splits_evm.async_helpers.AsyncWeb3.to_checksum_address",
            return_value="0xNotASplit",
        ):
            result = await is_cascade_split(mock_w3, "0xNotASplit")

        assert result is False

    @pytest.mark.asyncio
    async def test_get_split_balance(self) -> None:
        """Test getting split balance."""
        mock_w3 = MagicMock()
        mock_contract = MagicMock()
        mock_contract.functions.getBalance.return_value.call = AsyncMock(return_value=1000000)
        mock_w3.eth.contract.return_value = mock_contract

        with patch(
            "cascade_splits_evm.async_helpers.AsyncWeb3.to_checksum_address",
            return_value="0xSplit",
        ):
            result = await get_split_balance(mock_w3, "0xSplit")

        assert result == 1000000

    @pytest.mark.asyncio
    async def test_has_pending_funds(self) -> None:
        """Test checking for pending funds."""
        mock_w3 = MagicMock()
        mock_contract = MagicMock()
        mock_contract.functions.hasPendingFunds.return_value.call = AsyncMock(return_value=True)
        mock_w3.eth.contract.return_value = mock_contract

        with patch(
            "cascade_splits_evm.async_helpers.AsyncWeb3.to_checksum_address",
            return_value="0xSplit",
        ):
            result = await has_pending_funds(mock_w3, "0xSplit")

        assert result is True

    @pytest.mark.asyncio
    async def test_get_pending_amount(self) -> None:
        """Test getting pending amount."""
        mock_w3 = MagicMock()
        mock_contract = MagicMock()
        mock_contract.functions.pendingAmount.return_value.call = AsyncMock(return_value=500000)
        mock_w3.eth.contract.return_value = mock_contract

        with patch(
            "cascade_splits_evm.async_helpers.AsyncWeb3.to_checksum_address",
            return_value="0xSplit",
        ):
            result = await get_pending_amount(mock_w3, "0xSplit")

        assert result == 500000

    @pytest.mark.asyncio
    async def test_get_total_unclaimed(self) -> None:
        """Test getting total unclaimed."""
        mock_w3 = MagicMock()
        mock_contract = MagicMock()
        mock_contract.functions.totalUnclaimed.return_value.call = AsyncMock(return_value=100000)
        mock_w3.eth.contract.return_value = mock_contract

        with patch(
            "cascade_splits_evm.async_helpers.AsyncWeb3.to_checksum_address",
            return_value="0xSplit",
        ):
            result = await get_total_unclaimed(mock_w3, "0xSplit")

        assert result == 100000

    @pytest.mark.asyncio
    async def test_preview_execution(self) -> None:
        """Test previewing execution."""
        mock_w3 = MagicMock()
        mock_contract = MagicMock()
        mock_contract.functions.previewExecution.return_value.call = AsyncMock(
            return_value=(
                [500000, 300000],  # recipient_amounts
                10000,  # protocol_fee
                810000,  # available
                [0, 0],  # pending_recipient_amounts
                0,  # pending_protocol_amount
            )
        )
        mock_w3.eth.contract.return_value = mock_contract

        with patch(
            "cascade_splits_evm.async_helpers.AsyncWeb3.to_checksum_address",
            return_value="0xSplit",
        ):
            result = await preview_execution(mock_w3, "0xSplit")

        assert result.recipient_amounts == [500000, 300000]
        assert result.protocol_fee == 10000
        assert result.available == 810000

    @pytest.mark.asyncio
    async def test_get_split_config(self) -> None:
        """Test getting split config."""
        mock_w3 = MagicMock()
        mock_contract = MagicMock()

        # Setup mock calls
        mock_contract.functions.isCascadeSplitConfig.return_value.call = AsyncMock(
            return_value=True
        )
        mock_contract.functions.authority.return_value.call = AsyncMock(return_value="0xAuthority")
        mock_contract.functions.token.return_value.call = AsyncMock(return_value="0xToken")
        mock_contract.functions.uniqueId.return_value.call = AsyncMock(return_value=b"unique-id")
        mock_contract.functions.getRecipients.return_value.call = AsyncMock(
            return_value=[("0xAlice", 5940), ("0xBob", 3960)]
        )
        mock_w3.eth.contract.return_value = mock_contract

        with patch(
            "cascade_splits_evm.async_helpers.AsyncWeb3.to_checksum_address",
            return_value="0xSplit",
        ):
            result = await get_split_config(mock_w3, "0xSplit")

        assert result is not None
        assert result.authority == "0xAuthority"
        assert result.token == "0xToken"
        assert len(result.recipients) == 2

    @pytest.mark.asyncio
    async def test_get_split_config_invalid_returns_none(self) -> None:
        """Test get_split_config returns None for invalid split."""
        mock_w3 = MagicMock()
        mock_contract = MagicMock()
        mock_contract.functions.isCascadeSplitConfig.return_value.call = AsyncMock(
            return_value=False
        )
        mock_w3.eth.contract.return_value = mock_contract

        with patch(
            "cascade_splits_evm.async_helpers.AsyncWeb3.to_checksum_address",
            return_value="0xNotASplit",
        ):
            result = await get_split_config(mock_w3, "0xNotASplit")

        assert result is None

    @pytest.mark.asyncio
    async def test_predict_split_address(self) -> None:
        """Test predicting split address."""
        mock_w3 = MagicMock()
        mock_factory = MagicMock()
        mock_factory.functions.predictSplitAddress.return_value.call = AsyncMock(
            return_value="0xPredictedAddress"
        )
        mock_w3.eth.contract.return_value = mock_factory

        recipients = [
            EvmRecipient(addr="0xAlice", percentage_bps=5940),
            EvmRecipient(addr="0xBob", percentage_bps=3960),
        ]

        with patch(
            "cascade_splits_evm.async_helpers.AsyncWeb3.to_checksum_address",
            side_effect=lambda x: x,
        ):
            result = await predict_split_address(
                mock_w3,
                "0xFactory",
                "0xAuthority",
                "0xToken",
                b"unique-id".ljust(32, b"\x00"),
                recipients,
            )

        assert result == "0xPredictedAddress"
