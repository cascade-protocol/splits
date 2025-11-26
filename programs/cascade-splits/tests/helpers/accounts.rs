//! Account creation helpers for Mollusk tests
//!
//! NOTE: This is written for mollusk-svm 0.5.1 with solana-sdk 2.2
//! In 0.5.1, all imports come from solana_sdk::* (not modular crates like solana_pubkey)
//! Token accounts MUST have owner explicitly set to spl_token::id()

use {
    mollusk_svm::Mollusk,
    // 0.5.1: All types from solana_sdk, not modular crates
    solana_sdk::{
        account::Account, bpf_loader_upgradeable, program_pack::Pack, pubkey::Pubkey, rent::Rent,
        system_program,
    },
    spl_associated_token_account::get_associated_token_address,
    spl_token::state::{Account as TokenAccount, AccountState, Mint},
};

/// Create a system-owned account with given lamports
pub fn system_account(lamports: u64) -> Account {
    Account {
        lamports,
        data: vec![],
        owner: system_program::id(),
        executable: false,
        rent_epoch: 0,
    }
}

/// Create an uninitialized account (for init)
pub fn uninitialized_account() -> Account {
    Account {
        lamports: 0,
        data: vec![],
        owner: system_program::id(),
        executable: false,
        rent_epoch: 0,
    }
}

/// Create a program-owned account with data
pub fn program_account(lamports: u64, data: Vec<u8>, owner: Pubkey) -> Account {
    Account {
        lamports,
        data,
        owner,
        executable: false,
        rent_epoch: 0,
    }
}

/// Create a mock program_data account for BPF upgradeable loader
/// This simulates the UpgradeableLoaderState::ProgramData layout
pub fn program_data_account(upgrade_authority: Pubkey) -> Account {
    // UpgradeableLoaderState::ProgramData layout:
    // - 4 bytes: discriminant (3 for ProgramData)
    // - 8 bytes: slot
    // - 1 byte: Option discriminant for upgrade_authority (1 = Some)
    // - 32 bytes: upgrade_authority pubkey
    let mut data = vec![0u8; 45];
    data[0] = 3; // ProgramData discriminant
                 // bytes 1-11: slot (zero)
    data[12] = 1; // Some(upgrade_authority)
    data[13..45].copy_from_slice(&upgrade_authority.to_bytes());

    Account {
        lamports: 1_000_000,
        data,
        owner: bpf_loader_upgradeable::id(),
        executable: false,
        rent_epoch: 0,
    }
}

/// Create a mint account
///
/// NOTE (0.5.1): Must explicitly set owner to spl_token::id()
/// This was made more automatic in 0.6.1, but 0.5.1 requires explicit setup
pub fn mint_account(
    mint_authority: Option<Pubkey>,
    decimals: u8,
    supply: u64,
    rent: &Rent,
) -> Account {
    let mut data = vec![0u8; Mint::LEN];
    Mint::pack(
        Mint {
            mint_authority: mint_authority.into(),
            supply,
            decimals,
            is_initialized: true,
            freeze_authority: None.into(),
        },
        &mut data,
    )
    .unwrap();

    Account {
        lamports: rent.minimum_balance(Mint::LEN),
        data,
        // 0.5.1: MUST explicitly set owner to Token program
        owner: spl_token::id(),
        executable: false,
        rent_epoch: 0,
    }
}

/// Create a token account
///
/// NOTE (0.5.1): Must explicitly set owner to spl_token::id()
/// This was made more automatic in 0.6.1, but 0.5.1 requires explicit setup
pub fn token_account(mint: Pubkey, token_owner: Pubkey, amount: u64, rent: &Rent) -> Account {
    let mut data = vec![0u8; TokenAccount::LEN];
    TokenAccount::pack(
        TokenAccount {
            mint,
            owner: token_owner,
            amount,
            delegate: None.into(),
            state: AccountState::Initialized,
            is_native: None.into(),
            delegated_amount: 0,
            close_authority: None.into(),
        },
        &mut data,
    )
    .unwrap();

    Account {
        lamports: rent.minimum_balance(TokenAccount::LEN),
        data,
        // 0.5.1: MUST explicitly set owner to Token program
        owner: spl_token::id(),
        executable: false,
        rent_epoch: 0,
    }
}

/// Derive ATA address
pub fn derive_ata(wallet: &Pubkey, mint: &Pubkey) -> Pubkey {
    get_associated_token_address(wallet, mint)
}

/// Get rent from Mollusk
pub fn get_rent(mollusk: &Mollusk) -> Rent {
    mollusk.sysvars.rent.clone()
}

/// Create a system program account tuple for test setup
pub fn system_program_account() -> (Pubkey, Account) {
    (
        system_program::id(),
        Account {
            lamports: 1,
            data: vec![],
            owner: solana_sdk::native_loader::id(),
            executable: true,
            rent_epoch: 0,
        },
    )
}

/// Create a token program account tuple for test setup
pub fn token_program_account() -> (Pubkey, Account) {
    (
        spl_token::id(),
        Account {
            lamports: 1,
            data: vec![],
            owner: solana_sdk::native_loader::id(),
            executable: true,
            rent_epoch: 0,
        },
    )
}
