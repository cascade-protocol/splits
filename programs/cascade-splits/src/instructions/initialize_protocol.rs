use anchor_lang::prelude::*;

use crate::{
    constants::PROTOCOL_CONFIG_SIZE,
    errors::ErrorCode,
    events::ProtocolConfigCreated,
    state::ProtocolConfig,
    ID,
};

#[derive(Accounts)]
pub struct InitializeProtocol<'info> {
    #[account(
        init,
        payer = authority,
        space = PROTOCOL_CONFIG_SIZE,
        seeds = [b"protocol_config"],
        bump
    )]
    pub protocol_config: AccountLoader<'info, ProtocolConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: The program's executable data account - validated in handler
    #[account(
        constraint = program_data.owner == &anchor_lang::solana_program::bpf_loader_upgradeable::id()
            @ ErrorCode::Unauthorized
    )]
    pub program_data: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

/// Initializes the protocol configuration
/// Can only be called once by the program's upgrade authority
pub fn handler(ctx: Context<InitializeProtocol>, fee_wallet: Pubkey) -> Result<()> {
    // Validate fee wallet is not zero address
    require!(fee_wallet != Pubkey::default(), ErrorCode::ZeroAddress);

    // Verify program_data is the correct PDA for our program
    let (expected_program_data, _) = Pubkey::find_program_address(
        &[ID.as_ref()],
        &anchor_lang::solana_program::bpf_loader_upgradeable::id(),
    );
    require!(
        ctx.accounts.program_data.key() == expected_program_data,
        ErrorCode::Unauthorized
    );

    // Deserialize program data to get upgrade authority
    let program_data_account = &ctx.accounts.program_data;
    let data = program_data_account.try_borrow_data()?;

    // Check minimum size for UpgradeableLoaderState::ProgramData
    require!(data.len() >= 45, ErrorCode::Unauthorized);

    // Parse upgrade authority (starts at offset 13, 32 bytes for pubkey, 1 byte for Option discriminant)
    // UpgradeableLoaderState::ProgramData layout:
    // - 4 bytes: discriminant
    // - 8 bytes: slot
    // - 1 byte: Option discriminant for upgrade_authority
    // - 32 bytes: upgrade_authority pubkey (if Some)
    let upgrade_authority_option = data[12];
    require!(upgrade_authority_option == 1, ErrorCode::Unauthorized); // Must have upgrade authority

    let upgrade_authority = Pubkey::try_from(&data[13..45])
        .map_err(|_| ErrorCode::Unauthorized)?;

    require!(
        upgrade_authority == ctx.accounts.authority.key(),
        ErrorCode::Unauthorized
    );

    let protocol_config = &mut ctx.accounts.protocol_config.load_init()?;

    protocol_config.authority = ctx.accounts.authority.key();
    protocol_config.pending_authority = Pubkey::default(); // No pending transfer initially
    protocol_config.fee_wallet = fee_wallet;
    protocol_config.bump = ctx.bumps.protocol_config;

    emit!(ProtocolConfigCreated {
        authority: ctx.accounts.authority.key(),
        fee_wallet,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
