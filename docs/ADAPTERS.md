# Flipper Protocol - DEX Adapter System

## Overview

Flipper uses a pluggable adapter system to integrate with multiple DEX protocols. Each adapter implements the `DexAdapter` trait and handles the protocol-specific CPI calls, account validation, and swap execution.

Additionally, Jupiter V6 is integrated as a **liquidity provider** via CPI through a separate instruction path (`shared_route`), giving users access to Jupiter's full 120+ DEX aggregation while Flipper maintains vault custody and fee collection.

## Adapter Architecture

```
                        DexAdapter Trait
                             |
              +--------------+--------------+
              |              |              |
        RaydiumAdapter WhirlpoolAdapter MeteoraAdapter
              |              |              |
         Raydium AMM    Orca Whirlpool  Meteora DLMM
        (swap_base_    (swapV2)         (swap2)
         input)
```

Separately:

```
Jupiter V6 (Liquidity Provider)
    |
    +-- shared_route instruction
    |   (CPI to shared_accounts_route)
    |
    +-- shared_route_and_create_order
    |   (CPI + limit order creation)
    |
    +-- shared_execute_limit_order
        (CPI for limit order execution)
```

## DexAdapter Trait

All on-chain DEX adapters implement this trait:

```rust
pub trait DexAdapter {
    /// Execute a swap via CPI to the DEX program
    fn execute_swap(ctx: &AdapterContext, amount: u64) -> Result<()>;

    /// Validate that the provided accounts match expected structure
    fn validate_accounts(ctx: &AdapterContext) -> Result<()>;

    /// Validate that the CPI program ID matches the registered adapter
    fn validate_cpi(ctx: &AdapterContext, expected_program_id: &Pubkey) -> Result<()>;
}
```

## On-Chain DEX Adapters

### Raydium Adapter

Integrates with Raydium AMM V4 protocol.

**CPI Instruction**: `swap_base_input`
**Discriminator**: `[143, 190, 90, 218, 196, 30, 51, 222]`

**Required Accounts** (11):

| # | Account | Writable | Description |
|---|---------|----------|-------------|
| 0 | Pool Info | No | Raydium pool info |
| 1 | Authority | No | Pool authority PDA |
| 2 | AMM Config | No | AMM configuration |
| 3 | Pool State | Yes | Pool state account |
| 4 | Input Vault | Yes | Pool's input token vault |
| 5 | Output Vault | Yes | Pool's output token vault |
| 6 | Observation | Yes | Oracle observation account |
| 7 | Input Token Program | No | SPL Token or Token 2022 |
| 8 | Output Token Program | No | SPL Token or Token 2022 |
| 9 | Input Mint | No | Input token mint |
| 10 | Output Mint | No | Output token mint |

**Swap Flow**:
1. Validate pool accounts and CPI program
2. Build `swap_base_input` instruction with amount and minimum output (0)
3. Execute CPI with vault authority PDA as signer

---

### Whirlpool Adapter (Orca)

Integrates with Orca Whirlpool concentrated liquidity protocol.

**CPI Instruction**: `swapV2`
**Discriminator**: `[43, 4, 237, 11, 26, 201, 30, 98]`

**Required Accounts** (15+):

| # | Account | Writable | Description |
|---|---------|----------|-------------|
| 0 | Token Program A | No | Token program for token A |
| 1 | Token Program B | No | Token program for token B |
| 2 | Memo Program | No | SPL Memo program |
| 3 | Token Authority | No | Vault authority PDA |
| 4 | Whirlpool | Yes | Pool state |
| 5 | Token Mint A | No | Mint for token A |
| 6 | Token Mint B | No | Mint for token B |
| 7 | Token Owner A | Yes | Token account for A |
| 8 | Token Vault A | Yes | Pool vault for A |
| 9 | Token Owner B | Yes | Token account for B |
| 10 | Token Vault B | Yes | Pool vault for B |
| 11 | Tick Array 0 | Yes | First tick array |
| 12 | Tick Array 1 | Yes | Second tick array |
| 13 | Tick Array 2 | Yes | Third tick array |
| 14 | Oracle | Yes | Price oracle |
| 15+ | Supplemental Tick Arrays | Yes | Additional tick arrays (optional) |

**Direction Handling**: The `a_to_b` parameter determines swap direction. When `a_to_b = false`, the adapter swaps token account indices to route B -> A.

---

### Meteora Adapter

Integrates with Meteora DLMM (Dynamic Liquidity Market Maker) protocol.

**CPI Instruction**: `swap2`
**Discriminator**: `[65, 75, 63, 76, 235, 91, 91, 136]`

**Required Accounts** (16+):

| # | Account | Writable | Description |
|---|---------|----------|-------------|
| 0 | LB Pair | Yes | Liquidity pair state |
| 1 | Bin Array Bitmap Extension | No | Bitmap extension (optional) |
| 2 | Reserve X | Yes | Pool reserve for token X |
| 3 | Reserve Y | Yes | Pool reserve for token Y |
| 4 | User Token In | Yes | User's input token account |
| 5 | User Token Out | Yes | User's output token account |
| 6 | Token X Mint | No | Token X mint |
| 7 | Token Y Mint | No | Token Y mint |
| 8 | Oracle | Yes | Oracle account |
| 9 | Host Fee In | No | Host fee account |
| 10 | User | No | Vault authority PDA (signer) |
| 11 | Token X Program | No | Token program for X |
| 12 | Token Y Program | No | Token program for Y |
| 13 | Event Authority | No | Event authority PDA |
| 14 | Program | No | Meteora program ID |
| 15 | Remaining | No | (reserved) |
| 16+ | Bin Arrays | Yes | Dynamic bin arrays (up to 5) |

**Dynamic Bin Arrays**: The adapter handles up to 5 bin array accounts appended after the fixed accounts.

---

## Jupiter Integration (Liquidity Provider)

Jupiter V6 is not a traditional adapter - it is integrated as a **liquidity provider** through a separate instruction path. This allows Flipper to leverage Jupiter's aggregation of 120+ DEXes while maintaining its own vault custody and fee model.

### How Jupiter CPI Works

```
User Request
    |
    v
Flipper shared_route instruction
    |
    +-- 1. Transfer user tokens -> Source Vault
    |
    +-- 2. Build Jupiter shared_accounts_route CPI
    |       - Vault Authority PDA as transfer authority
    |       - Source Vault as user source
    |       - Destination Vault as user destination
    |
    +-- 3. CPI to Jupiter V6
    |       Jupiter routes across 120+ DEXes:
    |       Raydium, Orca, Meteora, Phoenix,
    |       OpenBook, Lifinity, and more...
    |
    +-- 4. Collect output in Destination Vault
    |
    +-- 5. Apply platform fee
    |
    +-- 6. Transfer output -> User
```

### Account Validation

The shared route module validates that Jupiter's remaining accounts match Flipper's vaults:

| Jupiter Account Index | Must Match |
|----------------------|------------|
| Index 2 (transfer authority) | Vault Authority PDA |
| Index 3 (user source) | Source Vault |
| Index 6 (user destination) | Destination Vault |

**Minimum accounts**: 13 (Jupiter's `shared_accounts_route` requires at least 13 base accounts)

### Jupiter Program ID Configuration

The Jupiter program ID is stored in the `VaultAuthority` account and set via the `set_jupiter_program` instruction (Global Manager only). All CPI calls validate against this stored ID.

### Supported Jupiter Instructions

| Flipper Instruction | Jupiter CPI | Purpose |
|-------------------|-------------|---------|
| `shared_route` | `shared_accounts_route` | Standard swap |
| `shared_route_and_create_order` | `shared_accounts_route` | Swap + limit order |
| `shared_execute_limit_order` | `shared_accounts_route` | Limit order execution |

---

## Adapter Connector

The adapter connector module provides a factory function to get the correct adapter implementation based on the `Swap` type:

```rust
pub fn get_adapter(swap: &Swap) -> Box<dyn DexAdapter> {
    match swap {
        Swap::Raydium | Swap::RaydiumClmm | ... => Box::new(RaydiumAdapter),
        Swap::Whirlpool { .. } | Swap::WhirlpoolSwapV2 { .. } => Box::new(WhirlpoolAdapter),
        Swap::Meteora | Swap::MeteoraDlmm | ... => Box::new(MeteoraAdapter),
        _ => // unsupported
    }
}
```

## Adding a New Adapter

To add support for a new DEX protocol:

1. Create a new adapter file in `programs/flipper/src/adapters/`
2. Implement the `DexAdapter` trait
3. Add new `Swap` enum variant(s) in `state.rs`
4. Register the adapter in the `get_adapter` connector
5. Register via `configure_adapter` instruction on-chain
6. Initialize pools via `initialize_pool_info`
