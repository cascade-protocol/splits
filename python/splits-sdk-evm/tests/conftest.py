"""Pytest configuration and fixtures for Cascade Splits SDK tests."""

import subprocess
import time
from contextlib import asynccontextmanager

import pytest
from web3 import AsyncWeb3, Web3

# Anvil's pre-funded test accounts (same as Hardhat/Foundry)
# Private keys are well-known - DO NOT use on mainnet
ANVIL_ACCOUNTS = [
    {
        "address": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        "private_key": "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    },
    {
        "address": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        "private_key": "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    },
    {
        "address": "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
        "private_key": "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
    },
]


def _wait_for_anvil(url: str, timeout: float = 10.0) -> bool:
    """Wait for Anvil to be ready."""
    import socket
    from urllib.parse import urlparse

    parsed = urlparse(url)
    host = parsed.hostname or "localhost"
    port = parsed.port or 8545

    start = time.time()
    while time.time() - start < timeout:
        try:
            with socket.create_connection((host, port), timeout=1):
                return True
        except OSError:
            time.sleep(0.1)
    return False


@pytest.fixture(scope="session")
def anvil_fork():
    """
    Spin up Anvil forking Base Sepolia for integration tests.

    Requires Foundry to be installed: https://getfoundry.sh

    The fork gives us:
    - Real EVM execution
    - Already-deployed factory contract
    - Pre-funded test accounts
    - No gas costs
    """
    rpc_url = "http://localhost:8545"

    # Check if Anvil is available
    try:
        subprocess.run(["anvil", "--version"], capture_output=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        pytest.skip("Anvil not installed. Run: curl -L https://foundry.paradigm.xyz | bash")

    # Start Anvil forking Base Sepolia
    proc = subprocess.Popen(
        [
            "anvil",
            "--fork-url",
            "https://sepolia.base.org",
            "--port",
            "8545",
            "--silent",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    # Wait for Anvil to be ready
    if not _wait_for_anvil(rpc_url):
        proc.terminate()
        pytest.fail("Anvil failed to start")

    yield rpc_url

    # Cleanup
    proc.terminate()
    proc.wait(timeout=5)


@pytest.fixture
def test_account():
    """Get a pre-funded test account."""
    return ANVIL_ACCOUNTS[0]


@pytest.fixture
def alice():
    """Get Alice's address (recipient)."""
    return ANVIL_ACCOUNTS[1]["address"]


@pytest.fixture
def bob():
    """Get Bob's address (recipient)."""
    return ANVIL_ACCOUNTS[2]["address"]


# Base Sepolia USDC address
BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"

# ERC20 ABI for balance checks
ERC20_BALANCE_ABI = [
    {
        "type": "function",
        "name": "balanceOf",
        "inputs": [{"name": "account", "type": "address"}],
        "outputs": [{"type": "uint256"}],
        "stateMutability": "view",
    },
]


def _compute_balance_slot(address: str, mapping_slot: int = 0) -> str:
    """
    Compute storage slot for ERC20 balances mapping.

    For `mapping(address => uint256) balances` at slot N:
    slot = keccak256(abi.encode(address, N))
    """
    # Pad address to 32 bytes (left-padded with zeros)
    address_bytes = bytes.fromhex(address[2:].lower().zfill(64))
    # Pad slot to 32 bytes
    slot_bytes = mapping_slot.to_bytes(32, "big")
    # Concatenate and hash
    data = address_bytes + slot_bytes
    slot_hash = Web3.keccak(data)
    # anvil_setStorageAt requires 0x prefix
    return "0x" + slot_hash.hex()


async def fund_with_usdc(w3, address: str, amount: int, usdc_address: str = BASE_SEPOLIA_USDC) -> None:
    """
    Fund an address with USDC using Anvil's setStorageAt cheatcode.

    Args:
        w3: AsyncWeb3 instance connected to Anvil
        address: Address to fund
        amount: Amount in USDC smallest units (6 decimals, so 1_000_000 = 1 USDC)
        usdc_address: USDC contract address
    """
    # USDC uses slot 0 for balances mapping (standard ERC20 pattern)
    # Try slot 0 first, then slot 9 (Circle's USDC uses slot 9)
    for slot in [0, 9]:
        storage_slot = _compute_balance_slot(address, slot)
        # Encode amount as 32-byte hex
        amount_hex = "0x" + amount.to_bytes(32, "big").hex()

        await w3.provider.make_request(
            "anvil_setStorageAt",
            [usdc_address, storage_slot, amount_hex],
        )

        # Verify balance was set
        usdc = w3.eth.contract(address=Web3.to_checksum_address(usdc_address), abi=ERC20_BALANCE_ABI)
        balance = await usdc.functions.balanceOf(Web3.to_checksum_address(address)).call()
        if balance == amount:
            return

    raise RuntimeError(f"Failed to set USDC balance for {address}")


def fund_with_usdc_sync(w3, address: str, amount: int, usdc_address: str = BASE_SEPOLIA_USDC) -> None:
    """
    Sync version of fund_with_usdc for sync Web3 instance.
    """
    for slot in [0, 9]:
        storage_slot = _compute_balance_slot(address, slot)
        amount_hex = "0x" + amount.to_bytes(32, "big").hex()

        w3.provider.make_request(
            "anvil_setStorageAt",
            [usdc_address, storage_slot, amount_hex],
        )

        usdc = w3.eth.contract(address=Web3.to_checksum_address(usdc_address), abi=ERC20_BALANCE_ABI)
        balance = usdc.functions.balanceOf(Web3.to_checksum_address(address)).call()
        if balance == amount:
            return

    raise RuntimeError(f"Failed to set USDC balance for {address}")


async def get_usdc_balance(w3, address: str, usdc_address: str = BASE_SEPOLIA_USDC) -> int:
    """Get USDC balance of an address."""
    usdc = w3.eth.contract(address=Web3.to_checksum_address(usdc_address), abi=ERC20_BALANCE_ABI)
    return await usdc.functions.balanceOf(Web3.to_checksum_address(address)).call()


def get_usdc_balance_sync(w3, address: str, usdc_address: str = BASE_SEPOLIA_USDC) -> int:
    """Sync version of get_usdc_balance."""
    usdc = w3.eth.contract(address=Web3.to_checksum_address(usdc_address), abi=ERC20_BALANCE_ABI)
    return usdc.functions.balanceOf(Web3.to_checksum_address(address)).call()


@asynccontextmanager
async def async_w3(rpc_url: str):
    """Context manager for AsyncWeb3 that properly closes the session."""
    w3 = AsyncWeb3(AsyncWeb3.AsyncHTTPProvider(rpc_url))
    try:
        yield w3
    finally:
        await w3.provider.disconnect()
