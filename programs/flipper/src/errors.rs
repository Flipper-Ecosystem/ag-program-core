use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Empty route")]
    EmptyRoute = 6000,
    #[msg("Slippage tolerance exceeded")]
    SlippageToleranceExceeded = 6001,
    #[msg("Invalid calculation")]
    InvalidCalculation = 6002,
    #[msg("Not enough percent to 100")]
    NotEnoughPercent = 6005,
    #[msg("Invalid slippage")]
    InvalidSlippage = 6004,
    #[msg("Not Enough Account keys")]
    NotEnoughAccountKeys = 6008,
    #[msg("Swap not supported")]
    SwapNotSupported = 6016,
    #[msg("Invalid input index")]
    InvalidInputIndex = 6006,
    #[msg("Invalid output index")]
    InvalidOutputIndex = 6007,
    #[msg("Invalid authority")]
    InvalidAuthority = 6019,
    #[msg("Invalid pool address")]
    InvalidPoolAddress = 6020,
    #[msg("Invalid CPI interface")]
    InvalidCpiInterface = 6021,
}