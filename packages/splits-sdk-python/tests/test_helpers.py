"""
Unit tests for Cascade Splits Python SDK.
"""

import pytest
from cascade_splits import (
    Recipient,
    EvmRecipient,
    get_split_factory_address,
    get_usdc_address,
    is_supported_chain,
    to_evm_recipient,
    to_evm_recipients,
    SPLIT_FACTORY_ADDRESSES,
    USDC_ADDRESSES,
    SUPPORTED_CHAIN_IDS,
)


class TestAddresses:
    """Tests for address utilities."""
    
    def test_get_factory_address_base_mainnet(self):
        """Test factory address for Base mainnet."""
        address = get_split_factory_address(8453)
        assert address == "0x946Cd053514b1Ab7829dD8fEc85E0ade5550dcf7"
    
    def test_get_factory_address_base_sepolia(self):
        """Test factory address for Base Sepolia."""
        address = get_split_factory_address(84532)
        assert address == "0x946Cd053514b1Ab7829dD8fEc85E0ade5550dcf7"
    
    def test_get_factory_address_unsupported_chain(self):
        """Test factory address for unsupported chain raises error."""
        with pytest.raises(ValueError, match="SplitFactory not deployed"):
            get_split_factory_address(1)  # Ethereum mainnet not supported
    
    def test_get_usdc_address_base_mainnet(self):
        """Test USDC address for Base mainnet."""
        address = get_usdc_address(8453)
        assert address == "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    
    def test_get_usdc_address_base_sepolia(self):
        """Test USDC address for Base Sepolia."""
        address = get_usdc_address(84532)
        assert address == "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
    
    def test_is_supported_chain(self):
        """Test chain support detection."""
        assert is_supported_chain(8453) is True
        assert is_supported_chain(84532) is True
        assert is_supported_chain(1) is False
        assert is_supported_chain(42161) is False
    
    def test_supported_chain_ids(self):
        """Test supported chain IDs list."""
        assert 8453 in SUPPORTED_CHAIN_IDS
        assert 84532 in SUPPORTED_CHAIN_IDS
        assert len(SUPPORTED_CHAIN_IDS) == 2


class TestRecipientConversion:
    """Tests for recipient conversion utilities."""
    
    def test_to_evm_recipient(self):
        """Test single recipient conversion."""
        recipient = Recipient(address="0xAlice", share=50)
        evm_recipient = to_evm_recipient(recipient)
        
        assert evm_recipient.addr == "0xAlice"
        assert evm_recipient.percentage_bps == 4950  # 50 * 99
    
    def test_to_evm_recipient_100_share(self):
        """Test 100% share conversion."""
        recipient = Recipient(address="0xBob", share=100)
        evm_recipient = to_evm_recipient(recipient)
        
        assert evm_recipient.percentage_bps == 9900  # 100 * 99
    
    def test_to_evm_recipient_1_share(self):
        """Test 1% share conversion."""
        recipient = Recipient(address="0xCharlie", share=1)
        evm_recipient = to_evm_recipient(recipient)
        
        assert evm_recipient.percentage_bps == 99  # 1 * 99
    
    def test_to_evm_recipients(self):
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
    
    def test_to_evm_recipients_invalid_sum(self):
        """Test that invalid share sum raises error."""
        recipients = [
            Recipient(address="0xAlice", share=60),
            Recipient(address="0xBob", share=30),  # Only 90, not 100
        ]
        
        with pytest.raises(ValueError, match="must sum to 100"):
            to_evm_recipients(recipients)
    
    def test_to_evm_recipients_three_way_split(self):
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
    """Tests for type definitions."""
    
    def test_recipient_dataclass(self):
        """Test Recipient dataclass."""
        recipient = Recipient(address="0xTest", share=50)
        assert recipient.address == "0xTest"
        assert recipient.share == 50
    
    def test_evm_recipient_dataclass(self):
        """Test EvmRecipient dataclass."""
        recipient = EvmRecipient(addr="0xTest", percentage_bps=4950)
        assert recipient.addr == "0xTest"
        assert recipient.percentage_bps == 4950


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
