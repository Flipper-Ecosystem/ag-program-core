use anchor_lang::prelude::*;

// Defines error codes for the Solana program
// Used to handle various failure cases during swap and adapter operations
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
    #[msg("Not enough account keys")]
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
    #[msg("Pool already exists")]
    PoolAlreadyExists = 6022,
    #[msg("Pool not found")]
    PoolNotFound = 6023,
    #[msg("Invalid operator")]
    InvalidOperator = 6024,
    #[msg("Operator already exists")]
    OperatorAlreadyExists = 6026,
    #[msg("Operator not found")]
    OperatorNotFound = 6027,
    #[msg("Invalid mint account")]
    InvalidMint = 6028,
    #[msg("Vault not found")]
    VaultNotFound = 6029,
    #[msg("Pool account not found")]
    PoolAccountNotFound = 6039,
    #[msg("Invalid vault owner")]
    InvalidVaultOwner = 6040,
    #[msg("Vault is not empty")]
    VaultNotEmpty = 6041,
    #[msg("Unauthorized admin")]
    UnauthorizedAdmin = 6042,
    #[msg("Too many vaults requested")]
    TooManyVaults = 6043,
    #[msg("Insufficient accounts provided")]
    InsufficientAccounts = 6044,
    #[msg("Invalid mint account")]
    InvalidMintAccount = 6045,
    #[msg("Invalid vault address")]
    InvalidVaultAddress = 6046,
    #[msg("Vault authority not initialized")]
    VaultAuthorityNotInitialized = 6047,
}