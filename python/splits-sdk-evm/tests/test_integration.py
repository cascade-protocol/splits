"""Integration tests for Cascade Splits EVM SDK.

These tests run against an Anvil fork of Base Sepolia.
Requires Foundry installed: https://getfoundry.sh

Run with: pytest tests/test_integration.py -m integration
"""

import secrets

import pytest
from web3 import AsyncWeb3

from cascade_splits_evm import (
    AsyncCascadeSplitsClient,
    EnsureParams,
    Recipient,
    ensure_split,
    execute_split,
    get_split_factory_address,
)

from .conftest import fund_with_usdc, get_usdc_balance

pytestmark = pytest.mark.integration


@pytest.fixture
def client(anvil_fork, test_account):
    """Create a test client connected to Anvil fork."""
    return AsyncCascadeSplitsClient(
        rpc_url=anvil_fork,
        private_key=test_account["private_key"],
        chain_id=84532,  # Base Sepolia
    )


@pytest.mark.asyncio
async def test_ensure_split_creates_new_split(client, alice, bob) -> None:
    """Test creating a new split on forked Base Sepolia."""
    unique_id = secrets.token_bytes(32)

    result = await client.ensure_split(
        unique_id=unique_id,
        recipients=[
            Recipient(address=alice, share=60),
            Recipient(address=bob, share=40),
        ],
    )

    assert result.status == "CREATED"
    assert result.split is not None
    assert result.split.startswith("0x")
    assert result.signature is not None


@pytest.mark.asyncio
async def test_ensure_split_idempotent(client, alice, bob) -> None:
    """Test that ensure_split is idempotent (same params returns NO_CHANGE)."""
    unique_id = b"idempotency-test-12345".ljust(32, b"\x00")

    recipients = [
        Recipient(address=alice, share=60),
        Recipient(address=bob, share=40),
    ]

    # First call - creates the split
    result1 = await client.ensure_split(unique_id=unique_id, recipients=recipients)
    assert result1.status in ("CREATED", "NO_CHANGE")

    # Second call - should return NO_CHANGE
    result2 = await client.ensure_split(unique_id=unique_id, recipients=recipients)
    assert result2.status == "NO_CHANGE"
    assert result2.split == result1.split


@pytest.mark.asyncio
async def test_predict_split_address(client, alice, bob) -> None:
    """Test that predicted address matches actual created address."""
    unique_id = secrets.token_bytes(32)
    recipients = [
        Recipient(address=alice, share=60),
        Recipient(address=bob, share=40),
    ]

    # Predict address first
    predicted = await client.predict_split_address(
        unique_id=unique_id,
        recipients=recipients,
    )

    # Create the split
    result = await client.ensure_split(
        unique_id=unique_id,
        recipients=recipients,
    )

    assert result.status == "CREATED"
    assert result.split == predicted


@pytest.mark.asyncio
async def test_is_cascade_split(client, alice, bob) -> None:
    """Test checking if an address is a valid Cascade split."""
    unique_id = secrets.token_bytes(32)
    result = await client.ensure_split(
        unique_id=unique_id,
        recipients=[
            Recipient(address=alice, share=60),
            Recipient(address=bob, share=40),
        ],
    )

    assert result.status == "CREATED"
    assert result.split is not None

    # Check that it's a valid split
    is_split = await client.is_cascade_split(result.split)
    assert is_split is True

    # Check that a random address is not a split
    is_not_split = await client.is_cascade_split(alice)
    assert is_not_split is False


@pytest.mark.asyncio
async def test_get_split_config(client, alice, bob) -> None:
    """Test getting the configuration of a created split."""
    unique_id = b"config-test-12345678".ljust(32, b"\x00")
    recipients = [
        Recipient(address=alice, share=60),
        Recipient(address=bob, share=40),
    ]

    # Ensure split exists
    result = await client.ensure_split(unique_id=unique_id, recipients=recipients)
    assert result.status in ("CREATED", "NO_CHANGE")
    assert result.split is not None

    # Get config
    config = await client.get_split_config(result.split)
    assert config is not None
    assert len(config.recipients) == 2
    assert config.recipients[0].percentage_bps == 5940  # 60 * 99
    assert config.recipients[1].percentage_bps == 3960  # 40 * 99


@pytest.mark.asyncio
async def test_standalone_ensure_split(anvil_fork, test_account, alice, bob) -> None:
    """Test using standalone ensure_split function."""
    from eth_account import Account
    from web3 import AsyncWeb3

    w3 = AsyncWeb3(AsyncWeb3.AsyncHTTPProvider(anvil_fork))
    account = Account.from_key(test_account["private_key"])
    factory = get_split_factory_address(84532)

    unique_id = secrets.token_bytes(32)

    result = await ensure_split(
        w3,
        account,
        factory,
        EnsureParams(
            unique_id=unique_id,
            recipients=[
                Recipient(address=alice, share=60),
                Recipient(address=bob, share=40),
            ],
        ),
    )

    assert result.status == "CREATED"
    assert result.split is not None


# =============================================================================
# execute_split Tests
# =============================================================================


@pytest.mark.asyncio
async def test_execute_split_distributes_funds(anvil_fork, test_account, alice, bob) -> None:
    """Test that execute_split correctly distributes funds to recipients."""
    w3 = AsyncWeb3(AsyncWeb3.AsyncHTTPProvider(anvil_fork))

    client = AsyncCascadeSplitsClient(
        rpc_url=anvil_fork,
        private_key=test_account["private_key"],
        chain_id=84532,
    )

    # Create a split: Alice 60%, Bob 40%
    unique_id = secrets.token_bytes(32)
    ensure_result = await client.ensure_split(
        unique_id=unique_id,
        recipients=[
            Recipient(address=alice, share=60),
            Recipient(address=bob, share=40),
        ],
    )
    assert ensure_result.status == "CREATED"
    split_address = ensure_result.split

    # Record initial balances
    alice_before = await get_usdc_balance(w3, alice)
    bob_before = await get_usdc_balance(w3, bob)

    # Fund the split with 100 USDC (100_000_000 = 100 * 10^6)
    fund_amount = 100_000_000
    await fund_with_usdc(w3, split_address, fund_amount)

    # Verify split has the funds
    split_balance = await client.get_split_balance(split_address)
    assert split_balance == fund_amount

    # Execute the split
    exec_result = await client.execute_split(split_address)
    assert exec_result.status == "EXECUTED"
    assert exec_result.signature is not None

    # Verify distribution:
    # - Alice gets 60% of 99% = 59.4% = 59_400_000
    # - Bob gets 40% of 99% = 39.6% = 39_600_000
    # - Protocol gets 1% + dust = ~1_000_000
    alice_after = await get_usdc_balance(w3, alice)
    bob_after = await get_usdc_balance(w3, bob)

    alice_received = alice_after - alice_before
    bob_received = bob_after - bob_before

    # Allow small rounding differences
    assert alice_received == 59_400_000, f"Alice received {alice_received}, expected 59_400_000"
    assert bob_received == 39_600_000, f"Bob received {bob_received}, expected 39_600_000"

    # Split should now be empty (or have dust)
    split_balance_after = await client.get_split_balance(split_address)
    assert split_balance_after == 0


@pytest.mark.asyncio
async def test_execute_split_skips_no_pending_funds(client, alice, bob) -> None:
    """Test that execute_split returns SKIPPED when split has no pending funds."""
    # Create a split but don't fund it
    unique_id = secrets.token_bytes(32)
    ensure_result = await client.ensure_split(
        unique_id=unique_id,
        recipients=[
            Recipient(address=alice, share=60),
            Recipient(address=bob, share=40),
        ],
    )
    assert ensure_result.status == "CREATED"

    # Try to execute - should skip because no funds
    exec_result = await client.execute_split(ensure_result.split)
    assert exec_result.status == "SKIPPED"
    assert exec_result.reason == "no_pending_funds"


@pytest.mark.asyncio
async def test_execute_split_skips_invalid_address(client, alice) -> None:
    """Test that execute_split returns SKIPPED for non-split addresses."""
    # Try to execute on Alice's address (not a split)
    exec_result = await client.execute_split(alice)
    assert exec_result.status == "SKIPPED"
    assert exec_result.reason == "not_a_split"


@pytest.mark.asyncio
async def test_execute_split_respects_min_balance(anvil_fork, test_account, alice, bob) -> None:
    """Test that execute_split respects min_balance threshold."""
    w3 = AsyncWeb3(AsyncWeb3.AsyncHTTPProvider(anvil_fork))

    client = AsyncCascadeSplitsClient(
        rpc_url=anvil_fork,
        private_key=test_account["private_key"],
        chain_id=84532,
    )

    # Create a split
    unique_id = secrets.token_bytes(32)
    ensure_result = await client.ensure_split(
        unique_id=unique_id,
        recipients=[
            Recipient(address=alice, share=60),
            Recipient(address=bob, share=40),
        ],
    )
    assert ensure_result.status == "CREATED"
    split_address = ensure_result.split

    # Fund with small amount (1 USDC = 1_000_000)
    await fund_with_usdc(w3, split_address, 1_000_000)

    # Try to execute with min_balance of 10 USDC - should skip
    exec_result = await client.execute_split(split_address, min_balance=10_000_000)
    assert exec_result.status == "SKIPPED"
    assert exec_result.reason == "below_threshold"

    # Execute without min_balance - should work
    exec_result = await client.execute_split(split_address)
    assert exec_result.status == "EXECUTED"


@pytest.mark.asyncio
async def test_standalone_execute_split(anvil_fork, test_account, alice, bob) -> None:
    """Test using standalone execute_split function."""
    from eth_account import Account

    w3 = AsyncWeb3(AsyncWeb3.AsyncHTTPProvider(anvil_fork))
    account = Account.from_key(test_account["private_key"])
    factory = get_split_factory_address(84532)

    # Create split using standalone function
    unique_id = secrets.token_bytes(32)
    ensure_result = await ensure_split(
        w3,
        account,
        factory,
        EnsureParams(
            unique_id=unique_id,
            recipients=[
                Recipient(address=alice, share=60),
                Recipient(address=bob, share=40),
            ],
        ),
    )
    assert ensure_result.status == "CREATED"
    split_address = ensure_result.split

    # Fund the split
    await fund_with_usdc(w3, split_address, 10_000_000)  # 10 USDC

    # Execute using standalone function
    exec_result = await execute_split(w3, account, split_address)
    assert exec_result.status == "EXECUTED"
    assert exec_result.signature is not None


@pytest.mark.asyncio
async def test_full_split_lifecycle(anvil_fork, test_account, alice, bob) -> None:
    """Test complete split lifecycle: create → fund → execute → verify → re-execute (no-op)."""
    w3 = AsyncWeb3(AsyncWeb3.AsyncHTTPProvider(anvil_fork))

    client = AsyncCascadeSplitsClient(
        rpc_url=anvil_fork,
        private_key=test_account["private_key"],
        chain_id=84532,
    )

    # 1. Create split
    unique_id = secrets.token_bytes(32)
    ensure_result = await client.ensure_split(
        unique_id=unique_id,
        recipients=[
            Recipient(address=alice, share=70),
            Recipient(address=bob, share=30),
        ],
    )
    assert ensure_result.status == "CREATED"
    split_address = ensure_result.split

    # 2. Verify it's a valid split
    assert await client.is_cascade_split(split_address) is True

    # 3. Check config
    config = await client.get_split_config(split_address)
    assert config is not None
    assert len(config.recipients) == 2
    assert config.recipients[0].percentage_bps == 6930  # 70 * 99
    assert config.recipients[1].percentage_bps == 2970  # 30 * 99

    # 4. Fund the split
    await fund_with_usdc(w3, split_address, 50_000_000)  # 50 USDC

    # 5. Preview execution
    preview = await client.preview_execution(split_address)
    assert preview.available == 50_000_000
    assert preview.recipient_amounts[0] == 34_650_000  # 70% of 99%
    assert preview.recipient_amounts[1] == 14_850_000  # 30% of 99%

    # 6. Execute
    alice_before = await get_usdc_balance(w3, alice)
    bob_before = await get_usdc_balance(w3, bob)

    exec_result = await client.execute_split(split_address)
    assert exec_result.status == "EXECUTED"

    alice_after = await get_usdc_balance(w3, alice)
    bob_after = await get_usdc_balance(w3, bob)

    assert alice_after - alice_before == 34_650_000
    assert bob_after - bob_before == 14_850_000

    # 7. Try to execute again - should skip (no pending funds)
    exec_result2 = await client.execute_split(split_address)
    assert exec_result2.status == "SKIPPED"
    assert exec_result2.reason == "no_pending_funds"

    # 8. Fund again and execute again
    await fund_with_usdc(w3, split_address, 20_000_000)  # 20 USDC
    exec_result3 = await client.execute_split(split_address)
    assert exec_result3.status == "EXECUTED"
