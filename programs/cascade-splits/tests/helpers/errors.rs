//! Error code re-exports from the program
//!
//! We re-export the program's ErrorCode enum for use in tests.
//! Anchor custom errors start at 6000.

pub use cascade_splits::errors::ErrorCode;

/// Convert ErrorCode to u32 for ProgramError::Custom
pub fn error_code(code: ErrorCode) -> u32 {
    // Anchor error codes start at 6000
    6000 + code as u32
}
