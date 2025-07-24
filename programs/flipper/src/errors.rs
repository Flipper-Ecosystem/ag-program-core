use anchor_lang::prelude::*;

// Defines error codes for the Solana program
// Used to handle various failure cases during swap and adapter operations
#[error_code]
pub enum ErrorCode {
    // Route has no steps defined
    #[msg("Empty route")]
    EmptyRoute = 6000,
    // Output amount is below the acceptable slippage threshold
    #[msg("Slippage tolerance exceeded")]
    SlippageToleranceExceeded = 6001,
    // Calculation (e.g., amount or percentage) resulted in an invalid value
    #[msg("Invalid calculation")]
    InvalidCalculation = 6002,
    // Sum of route step percentages does not equal 100
    #[msg("Not enough percent to 100")]
    NotEnoughPercent = 6005,
    // Slippage value exceeds maximum allowed (10,000 basis points)
    #[msg("Invalid slippage")]
    InvalidSlippage = 6004,
    // Insufficient account keys provided for the operation
    #[msg("Not Enough Account keys")]
    NotEnoughAccountKeys = 6008,
    // Specified swap type is not supported by the adapter registry
    #[msg("Swap not supported")]
    SwapNotSupported = 6016,
    // Invalid input index in route plan
    #[msg("Invalid input index")]
    InvalidInputIndex = 6006,
    // Invalid output index in route plan
    #[msg("Invalid output index")]
    InvalidOutputIndex = 6007,
    // Authority account is not authorized for the operation
    #[msg("Invalid authority")]
    InvalidAuthority = 6019,
    // Pool address is not valid for the adapter
    #[msg("Invalid pool address")]
    InvalidPoolAddress = 6020,
    // CPI program ID does not match expected adapter program ID
    #[msg("Invalid CPI interface")]
    InvalidCpiInterface = 6021,
}