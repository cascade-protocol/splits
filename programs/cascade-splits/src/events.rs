use anchor_lang::prelude::*;

#[event]
pub struct ProtocolConfigCreated {
    pub authority: Pubkey,
    pub fee_wallet: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct ProtocolConfigUpdated {
    pub authority: Pubkey,
    pub old_fee_wallet: Pubkey,
    pub new_fee_wallet: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct ProtocolAuthorityTransferProposed {
    pub authority: Pubkey,
    pub pending_authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct ProtocolAuthorityTransferAccepted {
    pub old_authority: Pubkey,
    pub new_authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct SplitConfigCreated {
    pub config: Pubkey,
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub unique_id: Pubkey,
    pub recipient_count: u8,
    pub timestamp: i64,
}

#[event]
pub struct SplitExecuted {
    pub config: Pubkey,
    pub vault: Pubkey,
    pub total_amount: u64,
    pub recipients_distributed: u64,
    pub protocol_fee: u64,
    pub held_as_unclaimed: u64,
    pub unclaimed_cleared: u64,
    pub protocol_unclaimed_cleared: u64,
    pub executor: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct SplitConfigUpdated {
    pub config: Pubkey,
    pub authority: Pubkey,
    pub old_recipient_count: u8,
    pub new_recipient_count: u8,
    pub timestamp: i64,
}

#[event]
pub struct SplitConfigClosed {
    pub config: Pubkey,
    pub authority: Pubkey,
    pub rent_recovered: u64,
    pub timestamp: i64,
}
