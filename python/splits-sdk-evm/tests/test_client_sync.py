"""Tests for sync CascadeSplitsClient.

These tests verify that the sync client has parity with the async client
for validation and error handling.
"""

from unittest.mock import MagicMock, patch

import pytest

from cascade_splits_evm import CascadeSplitsClient, ChainNotSupportedError, Recipient


class TestSyncClientInitialization:
    """Tests for sync client initialization."""

    def test_sync_client_init_validates_chain(self) -> None:
        """Sync client should reject unsupported chain IDs."""
        with pytest.raises(ChainNotSupportedError) as exc_info:
            CascadeSplitsClient(
                rpc_url="https://mainnet.infura.io",
                private_key="0x" + "ab" * 32,
                chain_id=1,  # Ethereum mainnet - not supported
            )
        assert exc_info.value.chain_id == 1

    def test_sync_client_accepts_base_mainnet(self) -> None:
        """Sync client should accept Base mainnet."""
        with patch.object(CascadeSplitsClient, "__init__", lambda self, **kwargs: None):
            # Just verify no exception is raised during validation
            pass

        # Actually test with mocked Web3
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
                    rpc_url="https://mainnet.base.org",
                    private_key="0x" + "ab" * 32,
                    chain_id=8453,  # Base mainnet
                )

                assert client.chain_id == 8453

    def test_sync_client_accepts_base_sepolia(self) -> None:
        """Sync client should accept Base Sepolia."""
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

                assert client.chain_id == 84532


class TestSyncClientEnsureSplitValidation:
    """Tests for sync client ensure_split validation."""

    def test_sync_ensure_fails_empty_recipients(self) -> None:
        """Sync client should fail with empty recipients."""
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
                )

                result = client.ensure_split(
                    unique_id=b"test",
                    recipients=[],  # Empty!
                )

                assert result.status == "FAILED"
                assert result.message is not None
                assert "1-20" in result.message or "Recipients" in result.message

    def test_sync_ensure_fails_too_many_recipients(self) -> None:
        """Sync client should fail with more than 20 recipients."""
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
                )

                # 21 recipients
                recipients = [Recipient(address=f"0x{i:040x}", share=4) for i in range(20)]
                recipients.append(Recipient(address=f"0x{20:040x}", share=20))

                result = client.ensure_split(
                    unique_id=b"test",
                    recipients=recipients,
                )

                assert result.status == "FAILED"

    def test_sync_ensure_fails_shares_not_100(self) -> None:
        """Sync client should fail when shares don't sum to 100."""
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
                )

                result = client.ensure_split(
                    unique_id=b"test",
                    recipients=[
                        Recipient(address="0xAlice", share=60),
                        Recipient(address="0xBob", share=30),  # Only 90%!
                    ],
                )

                assert result.status == "FAILED"
                assert result.message is not None
                assert "100" in result.message or "sum" in result.message.lower()


class TestSyncClientExecuteSplitValidation:
    """Tests for sync client execute_split validation."""

    def test_sync_execute_skips_non_split(self) -> None:
        """Sync client should skip execution on non-split addresses."""
        with patch("cascade_splits_evm.client.Web3") as mock_web3_class:
            mock_w3 = MagicMock()
            mock_web3_class.return_value = mock_w3
            mock_web3_class.HTTPProvider.return_value = MagicMock()
            mock_web3_class.to_checksum_address = lambda x: x

            # Mock is_cascade_split to return False
            mock_contract = MagicMock()
            mock_contract.functions.isCascadeSplitConfig.return_value.call.return_value = False
            mock_w3.eth.contract.return_value = mock_contract

            with patch("cascade_splits_evm.client.Account") as mock_account_class:
                mock_account = MagicMock()
                mock_account.address = "0x1234567890123456789012345678901234567890"
                mock_account_class.from_key.return_value = mock_account

                with patch(
                    "cascade_splits_evm.helpers.Web3.to_checksum_address",
                    side_effect=lambda x: x,
                ):
                    client = CascadeSplitsClient(
                        rpc_url="https://sepolia.base.org",
                        private_key="0x" + "ab" * 32,
                        chain_id=84532,
                    )

                    result = client.execute_split("0xNotASplit")

                    assert result.status == "SKIPPED"
                    assert result.reason == "not_a_split"

    def test_sync_execute_skips_no_pending_funds(self) -> None:
        """Sync client should skip when no pending funds."""
        with patch("cascade_splits_evm.client.Web3") as mock_web3_class:
            mock_w3 = MagicMock()
            mock_web3_class.return_value = mock_w3
            mock_web3_class.HTTPProvider.return_value = MagicMock()
            mock_web3_class.to_checksum_address = lambda x: x

            # Mock is_cascade_split to return True, but no pending funds
            mock_contract = MagicMock()
            mock_contract.functions.isCascadeSplitConfig.return_value.call.return_value = True
            mock_contract.functions.hasPendingFunds.return_value.call.return_value = False
            mock_w3.eth.contract.return_value = mock_contract

            with patch("cascade_splits_evm.client.Account") as mock_account_class:
                mock_account = MagicMock()
                mock_account.address = "0x1234567890123456789012345678901234567890"
                mock_account_class.from_key.return_value = mock_account

                with patch(
                    "cascade_splits_evm.helpers.Web3.to_checksum_address",
                    side_effect=lambda x: x,
                ):
                    client = CascadeSplitsClient(
                        rpc_url="https://sepolia.base.org",
                        private_key="0x" + "ab" * 32,
                        chain_id=84532,
                    )

                    result = client.execute_split("0xValidSplit")

                    assert result.status == "SKIPPED"
                    assert result.reason == "no_pending_funds"

    def test_sync_execute_skips_below_threshold(self) -> None:
        """Sync client should skip when balance is below min_balance."""
        with patch("cascade_splits_evm.client.Web3") as mock_web3_class:
            mock_w3 = MagicMock()
            mock_web3_class.return_value = mock_w3
            mock_web3_class.HTTPProvider.return_value = MagicMock()
            mock_web3_class.to_checksum_address = lambda x: x

            # Mock is_cascade_split to return True, with low balance
            mock_contract = MagicMock()
            mock_contract.functions.isCascadeSplitConfig.return_value.call.return_value = True
            mock_contract.functions.getBalance.return_value.call.return_value = 1_000_000  # 1 USDC
            mock_w3.eth.contract.return_value = mock_contract

            with patch("cascade_splits_evm.client.Account") as mock_account_class:
                mock_account = MagicMock()
                mock_account.address = "0x1234567890123456789012345678901234567890"
                mock_account_class.from_key.return_value = mock_account

                with patch(
                    "cascade_splits_evm.helpers.Web3.to_checksum_address",
                    side_effect=lambda x: x,
                ):
                    client = CascadeSplitsClient(
                        rpc_url="https://sepolia.base.org",
                        private_key="0x" + "ab" * 32,
                        chain_id=84532,
                    )

                    result = client.execute_split(
                        "0xValidSplit",
                        min_balance=10_000_000,  # 10 USDC threshold
                    )

                    assert result.status == "SKIPPED"
                    assert result.reason == "below_threshold"
