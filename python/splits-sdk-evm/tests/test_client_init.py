"""Tests for client initialization.

These tests verify that clients fail fast with clear errors on invalid configuration.
"""

from unittest.mock import MagicMock, patch

import pytest

from cascade_splits_evm import (
    SPLIT_FACTORY_ADDRESSES,
    AsyncCascadeSplitsClient,
    CascadeSplitsClient,
    ChainNotSupportedError,
)


class TestAsyncClientInitialization:
    """Tests for AsyncCascadeSplitsClient initialization."""

    def test_async_client_rejects_unsupported_chain(self) -> None:
        """Should raise ChainNotSupportedError for unsupported chains."""
        with pytest.raises(ChainNotSupportedError) as exc_info:
            AsyncCascadeSplitsClient(
                rpc_url="https://mainnet.infura.io",
                private_key="0x" + "ab" * 32,
                chain_id=1,  # Ethereum mainnet - not supported
            )

        assert exc_info.value.chain_id == 1
        assert "1" in str(exc_info.value)

    def test_async_client_rejects_arbitrum(self) -> None:
        """Should reject Arbitrum (not yet supported)."""
        with pytest.raises(ChainNotSupportedError) as exc_info:
            AsyncCascadeSplitsClient(
                rpc_url="https://arb1.arbitrum.io/rpc",
                private_key="0x" + "ab" * 32,
                chain_id=42161,  # Arbitrum One
            )

        assert exc_info.value.chain_id == 42161

    def test_async_client_rejects_polygon(self) -> None:
        """Should reject Polygon (not yet supported)."""
        with pytest.raises(ChainNotSupportedError) as exc_info:
            AsyncCascadeSplitsClient(
                rpc_url="https://polygon-rpc.com",
                private_key="0x" + "ab" * 32,
                chain_id=137,  # Polygon mainnet
            )

        assert exc_info.value.chain_id == 137

    def test_async_client_uses_default_factory_address(self) -> None:
        """Should use default factory address when not provided."""
        with patch("cascade_splits_evm.async_client.AsyncWeb3") as mock_web3_class:
            mock_w3 = MagicMock()
            mock_web3_class.return_value = mock_w3
            mock_web3_class.AsyncHTTPProvider.return_value = MagicMock()
            mock_web3_class.to_checksum_address = lambda x: x

            with patch("cascade_splits_evm.async_client.Account") as mock_account_class:
                mock_account = MagicMock()
                mock_account.address = "0x1234567890123456789012345678901234567890"
                mock_account_class.from_key.return_value = mock_account

                client = AsyncCascadeSplitsClient(
                    rpc_url="https://mainnet.base.org",
                    private_key="0x" + "ab" * 32,
                    chain_id=8453,
                    # No factory_address provided
                )

                assert client.factory_address == SPLIT_FACTORY_ADDRESSES[8453]

    def test_async_client_accepts_custom_factory_address(self) -> None:
        """Should use custom factory address when provided."""
        custom_factory = "0xCustomFactory123456789012345678901234567"

        with patch("cascade_splits_evm.async_client.AsyncWeb3") as mock_web3_class:
            mock_w3 = MagicMock()
            mock_web3_class.return_value = mock_w3
            mock_web3_class.AsyncHTTPProvider.return_value = MagicMock()
            mock_web3_class.to_checksum_address = lambda x: x

            with patch("cascade_splits_evm.async_client.Account") as mock_account_class:
                mock_account = MagicMock()
                mock_account.address = "0x1234567890123456789012345678901234567890"
                mock_account_class.from_key.return_value = mock_account

                client = AsyncCascadeSplitsClient(
                    rpc_url="https://mainnet.base.org",
                    private_key="0x" + "ab" * 32,
                    chain_id=8453,
                    factory_address=custom_factory,
                )

                assert client.factory_address == custom_factory

    def test_async_client_default_chain_is_base_mainnet(self) -> None:
        """Default chain_id should be Base mainnet (8453)."""
        with patch("cascade_splits_evm.async_client.AsyncWeb3") as mock_web3_class:
            mock_w3 = MagicMock()
            mock_web3_class.return_value = mock_w3
            mock_web3_class.AsyncHTTPProvider.return_value = MagicMock()
            mock_web3_class.to_checksum_address = lambda x: x

            with patch("cascade_splits_evm.async_client.Account") as mock_account_class:
                mock_account = MagicMock()
                mock_account.address = "0x1234567890123456789012345678901234567890"
                mock_account_class.from_key.return_value = mock_account

                client = AsyncCascadeSplitsClient(
                    rpc_url="https://mainnet.base.org",
                    private_key="0x" + "ab" * 32,
                    # No chain_id - should default to 8453
                )

                assert client.chain_id == 8453


class TestSyncClientInitialization:
    """Tests for CascadeSplitsClient initialization."""

    def test_sync_client_rejects_unsupported_chain(self) -> None:
        """Should raise ChainNotSupportedError for unsupported chains."""
        with pytest.raises(ChainNotSupportedError) as exc_info:
            CascadeSplitsClient(
                rpc_url="https://mainnet.infura.io",
                private_key="0x" + "ab" * 32,
                chain_id=1,  # Ethereum mainnet - not supported
            )

        assert exc_info.value.chain_id == 1

    def test_sync_client_rejects_optimism(self) -> None:
        """Should reject Optimism (not yet supported)."""
        with pytest.raises(ChainNotSupportedError) as exc_info:
            CascadeSplitsClient(
                rpc_url="https://mainnet.optimism.io",
                private_key="0x" + "ab" * 32,
                chain_id=10,  # Optimism mainnet
            )

        assert exc_info.value.chain_id == 10

    def test_sync_client_uses_default_factory_address(self) -> None:
        """Should use default factory address when not provided."""
        with patch("cascade_splits_evm.client.Web3") as mock_web3_class:
            mock_w3 = MagicMock()
            mock_web3_class.return_value = mock_w3
            mock_web3_class.HTTPProvider.return_value = MagicMock()
            mock_web3_class.to_checksum_address = lambda x: x

            with patch("cascade_splits_evm.client.Account") as mock_account_class:
                mock_account = MagicMock()
                mock_account.address = "0x1234567890123456789012345678901234567890"
                mock_account_class.from_key.return_value = mock_account

                client = CascadeSplitsClient(
                    rpc_url="https://sepolia.base.org",
                    private_key="0x" + "ab" * 32,
                    chain_id=84532,  # Base Sepolia
                )

                assert client.factory_address == SPLIT_FACTORY_ADDRESSES[84532]

    def test_sync_client_accepts_custom_factory_address(self) -> None:
        """Should use custom factory address when provided."""
        custom_factory = "0xCustomFactory123456789012345678901234567"

        with patch("cascade_splits_evm.client.Web3") as mock_web3_class:
            mock_w3 = MagicMock()
            mock_web3_class.return_value = mock_w3
            mock_web3_class.HTTPProvider.return_value = MagicMock()
            mock_web3_class.to_checksum_address = lambda x: x

            with patch("cascade_splits_evm.client.Account") as mock_account_class:
                mock_account = MagicMock()
                mock_account.address = "0x1234567890123456789012345678901234567890"
                mock_account_class.from_key.return_value = mock_account

                client = CascadeSplitsClient(
                    rpc_url="https://sepolia.base.org",
                    private_key="0x" + "ab" * 32,
                    chain_id=84532,
                    factory_address=custom_factory,
                )

                assert client.factory_address == custom_factory


class TestClientAddressProperty:
    """Tests for client address property."""

    def test_async_client_exposes_wallet_address(self) -> None:
        """Async client should expose wallet address."""
        with patch("cascade_splits_evm.async_client.AsyncWeb3") as mock_web3_class:
            mock_w3 = MagicMock()
            mock_web3_class.return_value = mock_w3
            mock_web3_class.AsyncHTTPProvider.return_value = MagicMock()
            mock_web3_class.to_checksum_address = lambda x: x

            with patch("cascade_splits_evm.async_client.Account") as mock_account_class:
                mock_account = MagicMock()
                mock_account.address = "0xWalletAddress12345678901234567890123456"
                mock_account_class.from_key.return_value = mock_account

                client = AsyncCascadeSplitsClient(
                    rpc_url="https://mainnet.base.org",
                    private_key="0x" + "ab" * 32,
                    chain_id=8453,
                )

                assert client.address == "0xWalletAddress12345678901234567890123456"

    def test_sync_client_exposes_wallet_address(self) -> None:
        """Sync client should expose wallet address."""
        with patch("cascade_splits_evm.client.Web3") as mock_web3_class:
            mock_w3 = MagicMock()
            mock_web3_class.return_value = mock_w3
            mock_web3_class.HTTPProvider.return_value = MagicMock()
            mock_web3_class.to_checksum_address = lambda x: x

            with patch("cascade_splits_evm.client.Account") as mock_account_class:
                mock_account = MagicMock()
                mock_account.address = "0xWalletAddress12345678901234567890123456"
                mock_account_class.from_key.return_value = mock_account

                client = CascadeSplitsClient(
                    rpc_url="https://mainnet.base.org",
                    private_key="0x" + "ab" * 32,
                    chain_id=8453,
                )

                assert client.address == "0xWalletAddress12345678901234567890123456"


class TestChainNotSupportedError:
    """Tests for ChainNotSupportedError exception."""

    def test_error_includes_chain_id(self) -> None:
        """Error should include the unsupported chain ID."""
        error = ChainNotSupportedError(12345)

        assert error.chain_id == 12345
        assert "12345" in str(error)

    def test_error_message_is_clear(self) -> None:
        """Error message should be clear and actionable."""
        error = ChainNotSupportedError(1)

        message = str(error)
        assert "not supported" in message.lower() or "1" in message
