"""Unit tests for Cascade Splits EVM SDK."""

import pytest
from pydantic import ValidationError

from cascade_splits_evm import (
    SUPPORTED_CHAIN_IDS,
    ChainNotSupportedError,
    EvmRecipient,
    Recipient,
    get_split_factory_address,
    get_usdc_address,
    is_supported_chain,
    to_evm_recipient,
    to_evm_recipients,
)


class TestConstants:
    """Tests for address and chain constants."""

    def test_get_factory_address_base_mainnet(self) -> None:
        """Test factory address for Base mainnet."""
        address = get_split_factory_address(8453)
        assert address == "0x946Cd053514b1Ab7829dD8fEc85E0ade5550dcf7"

    def test_get_factory_address_base_sepolia(self) -> None:
        """Test factory address for Base Sepolia."""
        address = get_split_factory_address(84532)
        assert address == "0x946Cd053514b1Ab7829dD8fEc85E0ade5550dcf7"

    def test_get_factory_address_unsupported_chain(self) -> None:
        """Test factory address for unsupported chain raises error."""
        with pytest.raises(ChainNotSupportedError):
            get_split_factory_address(1)  # Ethereum mainnet not supported

    def test_get_usdc_address_base_mainnet(self) -> None:
        """Test USDC address for Base mainnet."""
        address = get_usdc_address(8453)
        assert address == "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"

    def test_get_usdc_address_base_sepolia(self) -> None:
        """Test USDC address for Base Sepolia."""
        address = get_usdc_address(84532)
        assert address == "0x036CbD53842c5426634e7929541eC2318f3dCF7e"

    def test_is_supported_chain(self) -> None:
        """Test chain support detection."""
        assert is_supported_chain(8453) is True
        assert is_supported_chain(84532) is True
        assert is_supported_chain(1) is False
        assert is_supported_chain(42161) is False

    def test_supported_chain_ids(self) -> None:
        """Test supported chain IDs list."""
        assert 8453 in SUPPORTED_CHAIN_IDS
        assert 84532 in SUPPORTED_CHAIN_IDS
        assert len(SUPPORTED_CHAIN_IDS) == 2


class TestRecipientConversion:
    """Tests for recipient conversion utilities."""

    def test_to_evm_recipient(self) -> None:
        """Test single recipient conversion."""
        recipient = Recipient(address="0xAlice", share=50)
        evm_recipient = to_evm_recipient(recipient)

        assert evm_recipient.addr == "0xAlice"
        assert evm_recipient.percentage_bps == 4950  # 50 * 99

    def test_to_evm_recipient_100_share(self) -> None:
        """Test 100% share conversion."""
        recipient = Recipient(address="0xBob", share=100)
        evm_recipient = to_evm_recipient(recipient)

        assert evm_recipient.percentage_bps == 9900  # 100 * 99

    def test_to_evm_recipient_1_share(self) -> None:
        """Test 1% share conversion."""
        recipient = Recipient(address="0xCharlie", share=1)
        evm_recipient = to_evm_recipient(recipient)

        assert evm_recipient.percentage_bps == 99  # 1 * 99

    def test_to_evm_recipients(self) -> None:
        """Test multiple recipients conversion."""
        recipients = [
            Recipient(address="0xAlice", share=60),
            Recipient(address="0xBob", share=40),
        ]
        evm_recipients = to_evm_recipients(recipients)

        assert len(evm_recipients) == 2
        assert evm_recipients[0].percentage_bps == 5940  # 60 * 99
        assert evm_recipients[1].percentage_bps == 3960  # 40 * 99

        # Total should be 9900 (99%)
        total = sum(r.percentage_bps for r in evm_recipients)
        assert total == 9900

    def test_to_evm_recipients_invalid_sum(self) -> None:
        """Test that invalid share sum raises error."""
        recipients = [
            Recipient(address="0xAlice", share=60),
            Recipient(address="0xBob", share=30),  # Only 90, not 100
        ]

        with pytest.raises(ValueError, match="must sum to 100"):
            to_evm_recipients(recipients)

    def test_to_evm_recipients_three_way_split(self) -> None:
        """Test three-way split conversion."""
        recipients = [
            Recipient(address="0xAlice", share=50),
            Recipient(address="0xBob", share=30),
            Recipient(address="0xCharlie", share=20),
        ]
        evm_recipients = to_evm_recipients(recipients)

        assert len(evm_recipients) == 3
        total = sum(r.percentage_bps for r in evm_recipients)
        assert total == 9900


class TestTypes:
    """Tests for Pydantic models."""

    def test_recipient_model(self) -> None:
        """Test Recipient model."""
        recipient = Recipient(address="0xTest", share=50)
        assert recipient.address == "0xTest"
        assert recipient.share == 50

    def test_recipient_frozen(self) -> None:
        """Test Recipient is immutable."""
        recipient = Recipient(address="0xTest", share=50)
        with pytest.raises(ValidationError):
            recipient.share = 60  # type: ignore[misc]

    def test_evm_recipient_model(self) -> None:
        """Test EvmRecipient model."""
        recipient = EvmRecipient(addr="0xTest", percentage_bps=4950)
        assert recipient.addr == "0xTest"
        assert recipient.percentage_bps == 4950

    def test_recipient_share_validation(self) -> None:
        """Test share must be between 1-100."""
        with pytest.raises(ValidationError):
            Recipient(address="0xTest", share=0)  # Too low

        with pytest.raises(ValidationError):
            Recipient(address="0xTest", share=101)  # Too high


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
