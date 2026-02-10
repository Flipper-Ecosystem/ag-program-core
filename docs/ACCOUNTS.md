# Flipper Protocol - Account Structures & PDAs

## Account Types

### AdapterRegistry

Stores the adapter registry configuration including supported DEX adapters and authorized operators.

```rust
#[account]
pub struct AdapterRegistry {
    pub authority: Pubkey,                      // Account authorized to manage the registry
    pub operators: Vec<Pubkey>,                 // Authorized operator public keys
    pub supported_adapters: Vec<AdapterInfo>,   // List of registered DEX adapters
    pub bump: u8,                               // PDA bump seed
}
```

**PDA Derivation**: `["adapter_registry"]`

**Methods**:
- `is_supported_adapter(swap)` - Check if a swap type is registered
- `get_adapter_program_id(swap)` - Get the program ID for a swap type
- `is_authorized_operator(key)` - Check if a pubkey is an operator or authority

---

### PoolInfo

Tracks an individual liquidity pool registered under an adapter.

```rust
#[account]
pub struct PoolInfo {
    pub adapter_swap_type: Swap,    // Swap type of the parent adapter
    pub pool_address: Pubkey,       // Pool public key
    pub enabled: bool,              // Whether this pool is active
}
```

**PDA Derivation**: `["pool_info", swap_type_bytes, pool_address]`

---

### VaultAuthority

The PDA that owns all token vaults in the system. Acts as the signer for all vault token transfers.

```rust
#[account]
pub struct VaultAuthority {
    pub admin: Pubkey,              // Admin who can manage vaults
    pub bump: u8,                   // PDA bump seed
    pub jupiter_program_id: Pubkey, // Configured Jupiter program ID for CPI validation
}
```

**PDA Derivation**: `["vault_authority"]`

---

### GlobalManager

Super-admin account with the highest level of control over the protocol.

```rust
#[account]
pub struct GlobalManager {
    pub manager: Pubkey,    // Manager public key (multisig recommended)
    pub bump: u8,           // PDA bump seed
}
```

**PDA Derivation**: `["global_manager"]`

---

### LimitOrder

Stores all state for a single limit order.

```rust
#[account]
pub struct LimitOrder {
    pub creator: Pubkey,                // Order creator
    pub input_mint: Pubkey,             // Token to sell
    pub output_mint: Pubkey,            // Token to buy
    pub input_vault: Pubkey,            // Vault holding locked tokens
    pub user_destination_account: Pubkey, // Where output tokens go
    pub input_amount: u64,              // Locked token amount
    pub min_output_amount: u64,         // Minimum acceptable output
    pub trigger_price_bps: u32,         // Trigger price in basis points
    pub trigger_type: TriggerType,      // TakeProfit or StopLoss
    pub expiry: i64,                    // Unix timestamp expiration
    pub status: OrderStatus,            // Current order status
    pub slippage_bps: u16,              // Slippage tolerance
    pub bump: u8,                       // PDA bump seed
}
```

**PDA Derivation**: `["limit_order", creator, nonce_le_bytes]`
**Account Size**: `8 + 193` bytes (anchor discriminator + data)

---

## Token Vault PDAs

Token vaults are Associated Token Accounts owned by the vault authority PDA.

**Vault PDA**: `["vault", mint_address]`

The vault authority PDA is the `authority` for all vault token accounts, enabling PDA-signed token transfers via CPI.

---

## Order Vault PDA

Each limit order has its own dedicated vault for locked tokens.

**PDA Derivation**: `["order_vault", limit_order_address]`

---

## Supporting Types

### AdapterInfo

```rust
pub struct AdapterInfo {
    pub name: String,           // Display name (e.g., "Raydium")
    pub program_id: Pubkey,     // DEX program ID
    pub swap_type: Swap,        // Swap enum variant
}
```

### RoutePlanStep

```rust
pub struct RoutePlanStep {
    pub swap: Swap,         // DEX swap type for this step
    pub percent: u8,        // Percentage of input (0-100)
    pub input_index: u8,    // Index of input token in remaining accounts
    pub output_index: u8,   // Index of output token in remaining accounts
}
```

### RemainingAccountsInfo

Used for Jupiter and Whirlpool swaps that require dynamic remaining accounts.

```rust
pub struct RemainingAccountsInfo {
    pub slices: Vec<RemainingAccountsSlice>,
}

pub struct RemainingAccountsSlice {
    pub accounts_type: u8,
    pub length: u8,
}
```

---

## Enums

### TriggerType

```rust
pub enum TriggerType {
    TakeProfit,     // Execute when output >= target
    StopLoss,       // Execute on stop-loss condition
}
```

### OrderStatus

```rust
pub enum OrderStatus {
    Init,           // Account created, parameters not set
    Open,           // Active, tokens locked, waiting for trigger
    Filled,         // Successfully executed
    Cancelled,      // Cancelled by creator or operator (expired)
}
```

### Side

Used by orderbook-based DEXes (Serum, OpenBook, Phoenix, etc.).

```rust
pub enum Side {
    Bid,    // Buy order
    Ask,    // Sell order
}
```

### Swap

Enum with 124+ variants representing every supported DEX protocol and swap type. Key variants include:

| Variant | Description |
|---------|-------------|
| `Raydium` | Raydium AMM V4 |
| `RaydiumClmm` | Raydium Concentrated Liquidity |
| `RaydiumCP` | Raydium Constant Product |
| `Whirlpool { a_to_b }` | Orca Whirlpool |
| `WhirlpoolSwapV2 { a_to_b, remaining_accounts_info }` | Orca Whirlpool V2 |
| `Meteora` | Meteora AMM |
| `MeteoraDlmm` | Meteora DLMM |
| `MeteoraDlmmSwapV2 { remaining_accounts_info }` | Meteora DLMM V2 |
| `MeteoraDammV2` | Meteora DAMM V2 |
| `Serum { side }` | Serum DEX |
| `OpenBookV2 { side }` | OpenBook V2 |
| `Phoenix { side }` | Phoenix DEX |

See `programs/flipper/src/state.rs` for the complete enum definition.

---

## PDA Summary

| Account | Seeds | Description |
|---------|-------|-------------|
| Adapter Registry | `["adapter_registry"]` | DEX adapter configuration |
| Pool Info | `["pool_info", swap_bytes, pool_pubkey]` | Individual pool tracking |
| Vault Authority | `["vault_authority"]` | Owner of all token vaults |
| Global Manager | `["global_manager"]` | Super-admin account |
| Token Vault | `["vault", mint_pubkey]` | Token storage vault |
| Limit Order | `["limit_order", creator, nonce_bytes]` | Limit order state |
| Order Vault | `["order_vault", limit_order_pubkey]` | Limit order token vault |
