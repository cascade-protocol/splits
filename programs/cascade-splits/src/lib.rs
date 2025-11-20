use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;
mod utils;

use instructions::*;

declare_id!("SPL1T3rERcu6P6dyBiG7K8LUr21CssZqDAszwANzNMB");

// Security contact information (embedded on-chain)
#[cfg(not(feature = "no-entrypoint"))]
solana_security_txt::security_txt! {
    name: "Cascade Splits",
    project_url: "https://cascade-protocol.xyz",
    contacts: "email:hello@cascade-protocol.xyz,link:https://github.com/cascade-protocol/splits/security",
    policy: "https://github.com/cascade-protocol/splits/blob/main/SECURITY.md",
    source_code: "https://github.com/cascade-protocol/splits",
    source_release: "v0.2.0"
}

#[program]
pub mod cascade_splits {
    use super::*;

    /// Initializes the protocol configuration
    /// Can only be called once by the program's upgrade authority
    pub fn initialize_protocol(ctx: Context<InitializeProtocol>, fee_wallet: Pubkey) -> Result<()> {
        instructions::initialize_protocol::handler(ctx, fee_wallet)
    }

    /// Updates the protocol fee wallet
    /// Only callable by current protocol authority
    pub fn update_protocol_config(
        ctx: Context<UpdateProtocolConfig>,
        new_fee_wallet: Pubkey,
    ) -> Result<()> {
        instructions::update_protocol_config::handler(ctx, new_fee_wallet)
    }

    /// Proposes protocol authority transfer to a new address (two-step pattern)
    /// Only callable by current protocol authority
    /// New authority must call accept_protocol_authority to complete
    pub fn transfer_protocol_authority(
        ctx: Context<TransferProtocolAuthority>,
        new_authority: Pubkey,
    ) -> Result<()> {
        instructions::transfer_protocol_authority::handler(ctx, new_authority)
    }

    /// Accepts a pending protocol authority transfer
    /// Only callable by the pending authority
    pub fn accept_protocol_authority(ctx: Context<AcceptProtocolAuthority>) -> Result<()> {
        instructions::accept_protocol_authority::handler(ctx)
    }

    /// Creates a new split configuration with vault
    /// Validates recipient ATAs on-chain (defense in depth)
    pub fn create_split_config<'info>(
        ctx: Context<'_, '_, 'info, 'info, CreateSplitConfig<'info>>,
        mint: Pubkey,
        recipients: Vec<RecipientInput>,
    ) -> Result<()> {
        instructions::create_split_config::handler(ctx, mint, recipients)
    }

    /// Executes a payment split with self-healing unclaimed recovery
    /// Permissionless - anyone can call
    pub fn execute_split<'info>(
        ctx: Context<'_, '_, 'info, 'info, ExecuteSplit<'info>>,
    ) -> Result<()> {
        instructions::execute_split::handler(ctx)
    }

    /// Updates split configuration with new recipients
    /// Only callable by authority, requires vault empty
    pub fn update_split_config<'info>(
        ctx: Context<'_, '_, 'info, 'info, UpdateSplitConfig<'info>>,
        new_recipients: Vec<RecipientInput>,
    ) -> Result<()> {
        instructions::update_split_config::handler(ctx, new_recipients)
    }

    /// Closes split config and recovers rent
    /// Requires vault empty and all unclaimed cleared
    pub fn close_split_config(ctx: Context<CloseSplitConfig>) -> Result<()> {
        instructions::close_split_config::handler(ctx)
    }
}
