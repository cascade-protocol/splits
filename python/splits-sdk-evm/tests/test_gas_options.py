"""Tests for GasOptions and build_tx_params functionality.

These tests verify that gas configuration is handled correctly to prevent
stuck/failed transactions or overpaying on mainnet.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from cascade_splits_evm.async_helpers import (
    DEFAULT_GAS_CREATE,
    DEFAULT_GAS_EXECUTE,
    DEFAULT_PRIORITY_FEE,
    build_tx_params,
)
from cascade_splits_evm.types import GasOptions


class TestBuildTxParamsDefaults:
    """Tests for default gas behavior."""

    @pytest.mark.asyncio
    async def test_default_gas_limit_for_create(self) -> None:
        """Should use DEFAULT_GAS_CREATE when no options provided."""
        mock_w3 = MagicMock()
        mock_w3.eth.get_transaction_count = AsyncMock(return_value=5)

        params = await build_tx_params(
            mock_w3,
            "0xSender",
            8453,
            DEFAULT_GAS_CREATE,
            gas_options=None,
        )

        assert params["gas"] == DEFAULT_GAS_CREATE
        assert params["gas"] == 300_000

    @pytest.mark.asyncio
    async def test_default_gas_limit_for_execute(self) -> None:
        """Should use DEFAULT_GAS_EXECUTE when no options provided."""
        mock_w3 = MagicMock()
        mock_w3.eth.get_transaction_count = AsyncMock(return_value=5)

        params = await build_tx_params(
            mock_w3,
            "0xSender",
            8453,
            DEFAULT_GAS_EXECUTE,
            gas_options=None,
        )

        assert params["gas"] == DEFAULT_GAS_EXECUTE
        assert params["gas"] == 600_000

    @pytest.mark.asyncio
    async def test_nonce_is_fetched(self) -> None:
        """Should fetch nonce from chain."""
        mock_w3 = MagicMock()
        mock_w3.eth.get_transaction_count = AsyncMock(return_value=42)

        params = await build_tx_params(
            mock_w3,
            "0xSender",
            8453,
            DEFAULT_GAS_CREATE,
        )

        mock_w3.eth.get_transaction_count.assert_called_once_with("0xSender")
        assert params["nonce"] == 42

    @pytest.mark.asyncio
    async def test_chain_id_is_set(self) -> None:
        """Should set chainId in params."""
        mock_w3 = MagicMock()
        mock_w3.eth.get_transaction_count = AsyncMock(return_value=0)

        params = await build_tx_params(
            mock_w3,
            "0xSender",
            84532,  # Base Sepolia
            DEFAULT_GAS_CREATE,
        )

        assert params["chainId"] == 84532

    @pytest.mark.asyncio
    async def test_from_address_is_set(self) -> None:
        """Should set from address in params."""
        mock_w3 = MagicMock()
        mock_w3.eth.get_transaction_count = AsyncMock(return_value=0)

        params = await build_tx_params(
            mock_w3,
            "0x1234567890123456789012345678901234567890",
            8453,
            DEFAULT_GAS_CREATE,
        )

        assert params["from"] == "0x1234567890123456789012345678901234567890"


class TestGasLimitOverride:
    """Tests for custom gas limit."""

    @pytest.mark.asyncio
    async def test_custom_gas_limit_override(self) -> None:
        """Should use custom gas_limit when provided."""
        mock_w3 = MagicMock()
        mock_w3.eth.get_transaction_count = AsyncMock(return_value=0)

        params = await build_tx_params(
            mock_w3,
            "0xSender",
            8453,
            DEFAULT_GAS_CREATE,
            gas_options=GasOptions(gas_limit=500_000),
        )

        assert params["gas"] == 500_000

    @pytest.mark.asyncio
    async def test_gas_limit_overrides_estimation(self) -> None:
        """gas_limit should take precedence over estimate_gas."""
        mock_w3 = MagicMock()
        mock_w3.eth.get_transaction_count = AsyncMock(return_value=0)

        mock_contract_call = MagicMock()
        mock_contract_call.estimate_gas = AsyncMock(return_value=100_000)

        params = await build_tx_params(
            mock_w3,
            "0xSender",
            8453,
            DEFAULT_GAS_CREATE,
            gas_options=GasOptions(gas_limit=250_000, estimate_gas=True),
            contract_call=mock_contract_call,
        )

        # gas_limit should win
        assert params["gas"] == 250_000
        # estimate_gas should not be called
        mock_contract_call.estimate_gas.assert_not_called()


class TestGasEstimation:
    """Tests for dynamic gas estimation."""

    @pytest.mark.asyncio
    async def test_gas_estimation_with_buffer(self) -> None:
        """Should add 20% buffer to estimated gas."""
        mock_w3 = MagicMock()
        mock_w3.eth.get_transaction_count = AsyncMock(return_value=0)

        mock_contract_call = MagicMock()
        mock_contract_call.estimate_gas = AsyncMock(return_value=100_000)

        params = await build_tx_params(
            mock_w3,
            "0xSender",
            8453,
            DEFAULT_GAS_CREATE,
            gas_options=GasOptions(estimate_gas=True),
            contract_call=mock_contract_call,
        )

        # 100_000 * 1.2 = 120_000
        assert params["gas"] == 120_000
        mock_contract_call.estimate_gas.assert_called_once_with({"from": "0xSender"})

    @pytest.mark.asyncio
    async def test_gas_estimation_rounds_down(self) -> None:
        """Should round down buffered gas estimate."""
        mock_w3 = MagicMock()
        mock_w3.eth.get_transaction_count = AsyncMock(return_value=0)

        mock_contract_call = MagicMock()
        mock_contract_call.estimate_gas = AsyncMock(return_value=123_456)

        params = await build_tx_params(
            mock_w3,
            "0xSender",
            8453,
            DEFAULT_GAS_CREATE,
            gas_options=GasOptions(estimate_gas=True),
            contract_call=mock_contract_call,
        )

        # 123_456 * 1.2 = 148147.2, should be int
        assert params["gas"] == 148147
        assert isinstance(params["gas"], int)

    @pytest.mark.asyncio
    async def test_estimation_requires_contract_call(self) -> None:
        """Should use default gas if estimate_gas=True but no contract_call."""
        mock_w3 = MagicMock()
        mock_w3.eth.get_transaction_count = AsyncMock(return_value=0)

        params = await build_tx_params(
            mock_w3,
            "0xSender",
            8453,
            DEFAULT_GAS_CREATE,
            gas_options=GasOptions(estimate_gas=True),
            contract_call=None,  # No contract call!
        )

        # Falls back to default
        assert params["gas"] == DEFAULT_GAS_CREATE


class TestEIP1559Params:
    """Tests for EIP-1559 transaction parameters."""

    @pytest.mark.asyncio
    async def test_eip1559_sets_type_2(self) -> None:
        """Should set type=0x2 for EIP-1559 transactions."""
        mock_w3 = MagicMock()
        mock_w3.eth.get_transaction_count = AsyncMock(return_value=0)

        params = await build_tx_params(
            mock_w3,
            "0xSender",
            8453,
            DEFAULT_GAS_CREATE,
            gas_options=GasOptions(max_fee_per_gas=50_000_000_000),  # 50 gwei
        )

        assert params["type"] == "0x2"

    @pytest.mark.asyncio
    async def test_eip1559_max_fee_is_set(self) -> None:
        """Should set maxFeePerGas."""
        mock_w3 = MagicMock()
        mock_w3.eth.get_transaction_count = AsyncMock(return_value=0)

        params = await build_tx_params(
            mock_w3,
            "0xSender",
            8453,
            DEFAULT_GAS_CREATE,
            gas_options=GasOptions(max_fee_per_gas=50_000_000_000),
        )

        assert params["maxFeePerGas"] == 50_000_000_000

    @pytest.mark.asyncio
    async def test_eip1559_default_priority_fee(self) -> None:
        """Should use default priority fee (1 gwei) when not specified."""
        mock_w3 = MagicMock()
        mock_w3.eth.get_transaction_count = AsyncMock(return_value=0)

        params = await build_tx_params(
            mock_w3,
            "0xSender",
            8453,
            DEFAULT_GAS_CREATE,
            gas_options=GasOptions(max_fee_per_gas=50_000_000_000),
        )

        assert params["maxPriorityFeePerGas"] == DEFAULT_PRIORITY_FEE
        assert params["maxPriorityFeePerGas"] == 1_000_000_000  # 1 gwei

    @pytest.mark.asyncio
    async def test_eip1559_custom_priority_fee(self) -> None:
        """Should use custom priority fee when specified."""
        mock_w3 = MagicMock()
        mock_w3.eth.get_transaction_count = AsyncMock(return_value=0)

        params = await build_tx_params(
            mock_w3,
            "0xSender",
            8453,
            DEFAULT_GAS_CREATE,
            gas_options=GasOptions(
                max_fee_per_gas=50_000_000_000,
                max_priority_fee_per_gas=2_000_000_000,  # 2 gwei
            ),
        )

        assert params["maxPriorityFeePerGas"] == 2_000_000_000

    @pytest.mark.asyncio
    async def test_no_eip1559_without_max_fee(self) -> None:
        """Should not set EIP-1559 params without max_fee_per_gas."""
        mock_w3 = MagicMock()
        mock_w3.eth.get_transaction_count = AsyncMock(return_value=0)

        params = await build_tx_params(
            mock_w3,
            "0xSender",
            8453,
            DEFAULT_GAS_CREATE,
            gas_options=GasOptions(
                max_priority_fee_per_gas=2_000_000_000,  # Only priority fee, no max fee
            ),
        )

        # Should not be type 2 without max_fee_per_gas
        assert "type" not in params
        assert "maxFeePerGas" not in params
        assert "maxPriorityFeePerGas" not in params


class TestGasOptionsModel:
    """Tests for GasOptions Pydantic model."""

    def test_gas_options_defaults(self) -> None:
        """Default GasOptions should have sensible defaults."""
        opts = GasOptions()

        assert opts.estimate_gas is False
        assert opts.gas_limit is None
        assert opts.max_fee_per_gas is None
        assert opts.max_priority_fee_per_gas is None

    def test_gas_options_frozen(self) -> None:
        """GasOptions should be immutable."""
        from pydantic import ValidationError

        opts = GasOptions(gas_limit=100_000)

        with pytest.raises(ValidationError):
            opts.gas_limit = 200_000  # type: ignore

    def test_gas_options_all_fields(self) -> None:
        """Should accept all gas options."""
        opts = GasOptions(
            estimate_gas=True,
            gas_limit=500_000,
            max_fee_per_gas=100_000_000_000,
            max_priority_fee_per_gas=5_000_000_000,
        )

        assert opts.estimate_gas is True
        assert opts.gas_limit == 500_000
        assert opts.max_fee_per_gas == 100_000_000_000
        assert opts.max_priority_fee_per_gas == 5_000_000_000
