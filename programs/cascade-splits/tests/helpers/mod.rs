//! Test helpers for Cascade Splits Mollusk tests
//!
//! NOTE: This module is written for mollusk-svm 0.5.1 with solana-sdk 2.2
//! Key differences from 0.7.x:
//! - All imports from solana_sdk::* (not modular crates like solana_pubkey)
//! - Token accounts MUST have owner explicitly set to spl_token::id()

pub mod accounts;
pub mod instructions;
pub mod serialization;

pub use accounts::*;
pub use instructions::*;
pub use serialization::*;

use mollusk_svm::Mollusk;
use mollusk_svm_programs_token::{associated_token, token};

/// Setup Mollusk for testing (without Token program)
///
/// Uses SBF_OUT_DIR to tell Mollusk where to find the program binary.
/// For Anchor workspace: tests are in programs/cascade-splits/tests,
/// binary is at workspace_root/target/deploy/
pub fn setup_mollusk() -> Mollusk {
    // Set SBF_OUT_DIR to the deploy directory
    // From programs/cascade-splits/, go up 2 levels to workspace root
    let deploy_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent() // programs/
        .unwrap()
        .parent() // workspace root
        .unwrap()
        .join("target/deploy");

    std::env::set_var("SBF_OUT_DIR", deploy_dir);

    // Just pass the program name, Mollusk will find it via SBF_OUT_DIR
    Mollusk::new(&instructions::PROGRAM_ID, "cascade_splits")
}

/// Setup Mollusk with Token and Associated Token programs for testing
///
/// This loads both SPL Token and ATA programs, enabling:
/// - Token transfers (execute_split)
/// - ATA creation (create_split_config vault)
pub fn setup_mollusk_with_token() -> Mollusk {
    let mut mollusk = setup_mollusk();
    token::add_program(&mut mollusk);
    associated_token::add_program(&mut mollusk);
    mollusk
}
