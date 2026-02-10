# Flipper Protocol Architecture

## System Overview

Flipper is a Solana DEX aggregator that provides two primary swap execution paths:

1. **Direct Adapter Route** (`route` instruction) - Executes swaps directly through on-chain DEX adapters (Raydium, Whirlpool, Meteora) with the program managing vault accounts and executing CPI calls to each DEX protocol.

2. **Jupiter CPI Route** (`shared_route` instruction) - Delegates swap execution to Jupiter V6 aggregator via CPI, treating Jupiter as an additional liquidity provider. Jupiter handles route optimization across 120+ DEXes while Flipper manages vault custody and fee collection.

Both paths share the same vault infrastructure, fee system, and access control layer.

## Module Architecture

```
programs/flipper/src/
|
+-- lib.rs                          # Program entry point, instruction dispatch
+-- state.rs                        # Account structs, events, types, Swap enum
+-- errors.rs                       # Error codes (50+ error types)
|
+-- adapters/                       # DEX adapter implementations
|   +-- mod.rs                      # DexAdapter trait definition
|   +-- raydium.rs                  # Raydium AMM adapter (swap_base_input)
|   +-- whirlpool.rs                # Orca Whirlpool adapter (swapV2)
|   +-- meteora.rs                  # Meteora DLMM adapter (swap2)
|
+-- instructions/
    +-- adapter_registry_module/    # Adapter & operator management
    +-- vault_manager_module/       # Vault lifecycle & global manager
    +-- swap_processor_module/      # Direct route swap processing
    +-- route_validator_module/     # Route plan validation
    +-- route_executor_module/      # Route plan execution engine
    +-- limit_orders_module/        # Limit order lifecycle
    +-- shared_route_module/        # Jupiter CPI integration
    +-- shared_limit_orders_module/ # Jupiter CPI for limit order execution
    +-- adapter_connector_module/   # Adapter factory (swap type -> adapter)
```

## Core Components

### 1. Adapter Registry

The adapter registry is the central configuration store for supported DEX protocols. It maintains:
- A list of registered adapters (name, program ID, swap type)
- A list of authorized operators
- The registry authority (admin)

Each adapter has associated `PoolInfo` accounts that track individual pools and their enabled/disabled status.

**PDA Seed**: `["adapter_registry"]`

### 2. Vault System

Flipper uses PDA-owned vaults to temporarily hold tokens during swaps. This ensures atomic execution and prevents partial failures.

**Vault Authority PDA Seed**: `["vault_authority"]`
**Vault PDA Seed**: `["vault", mint_address]`

The vault authority PDA signs CPI transfers, ensuring only the program can move tokens in and out of vaults.

Flow:
```
1. User tokens -> Source Vault (transfer_checked)
2. Source Vault -> DEX Pool (CPI swap via adapter)
3. DEX Pool -> Destination Vault (CPI swap output)
4. Destination Vault -> User (transfer_checked, minus fees)
```

### 3. Global Manager

The Global Manager is the super-admin account with critical permissions:
- Withdraw accumulated platform fees
- Change the Vault Authority admin
- Transfer the Global Manager role to a new address

**PDA Seed**: `["global_manager"]`

### 4. Route Execution Engine

The route execution engine supports three swap patterns:

#### Simple Swap
A single DEX swap from input to output.
```
Token A --[DEX]--> Token B
```

#### Partial Swap
Split input across multiple DEXes for better execution.
```
Token A --[50% Raydium]--+
         [50% Meteora]---+--> Token B
```

#### Multi-Hop Swap
Chain multiple swaps through intermediate tokens.
```
Token A --[Raydium]--> Token B --[Whirlpool]--> Token C
```

### 5. Jupiter Integration

Jupiter V6 is integrated as an additional liquidity provider, not as a replacement for the adapter system. The integration uses Jupiter's `shared_accounts_route` instruction via CPI.

**How it works:**
1. Flipper receives the swap request with Jupiter route data
2. Transfers user tokens into the source vault
3. Calls Jupiter's `shared_accounts_route` via CPI, passing vault accounts
4. Jupiter executes the optimized swap route across its supported DEXes
5. Flipper collects output tokens in the destination vault
6. Applies platform fees and transfers the remainder to the user

**Key validation:**
- Verifies Jupiter program ID matches the configured `jupiter_program_id`
- Validates that Jupiter's source/destination accounts match Flipper's vaults
- Ensures vault authority PDA is the transfer authority in Jupiter accounts

### 6. Limit Order System

Flipper supports conditional limit orders with two trigger types:

- **TakeProfit** - Execute when the output amount meets or exceeds the target
- **StopLoss** - Execute when conditions indicate a stop-loss trigger

**Lifecycle:**
```
Init (account created) -> Open (parameters set, tokens locked)
                            |
                    +-------+--------+
                    |                |
              Filled (executed)   Cancelled (refunded)
                    |                |
                    +-------+--------+
                            |
                     Closed (account freed)
```

Orders support both the direct adapter route and Jupiter CPI for execution.

### 7. Token 2022 Support

The protocol fully supports Token 2022 (SPL Token Extensions):
- `CreateVaultWithExtensions` for vaults with Token 2022 mints
- Separate token program routing for Token 2022 vs SPL Token
- Extension-aware limit order initialization (extra space allocation)

## Data Flow Diagrams

### Direct Route Swap

```
User                    Flipper Program              DEX (e.g. Raydium)
  |                          |                            |
  |-- route(params) -------->|                            |
  |                          |-- validate_route() ------->|
  |                          |-- transfer user->vault --->|
  |                          |                            |
  |                          |-- CPI: swap_base_input --->|
  |                          |<-- output tokens ---------|
  |                          |                            |
  |                          |-- deduct platform fee ---->|
  |                          |-- transfer vault->user --->|
  |<-- output tokens --------|                            |
```

### Jupiter Shared Route

```
User                    Flipper Program              Jupiter V6
  |                          |                            |
  |-- shared_route() ------->|                            |
  |                          |-- transfer user->vault --->|
  |                          |                            |
  |                          |-- CPI: shared_accounts_ -->|
  |                          |     route()                |
  |                          |                     +------+------+
  |                          |                     | Raydium     |
  |                          |                     | Whirlpool   |
  |                          |                     | Meteora     |
  |                          |                     | 120+ DEXes  |
  |                          |                     +------+------+
  |                          |<-- output tokens ---------|
  |                          |                            |
  |                          |-- deduct platform fee ---->|
  |                          |-- transfer vault->user --->|
  |<-- output tokens --------|                            |
```

### Limit Order Execution

```
User                    Flipper Program              Operator Bot
  |                          |                            |
  |-- init_limit_order() --->|                            |
  |-- create_limit_order() ->|                            |
  |                          |-- lock tokens in vault --->|
  |                          |                            |
  |                          |     (time passes...)       |
  |                          |                            |
  |                          |<-- execute_limit_order() --|
  |                          |-- check trigger conditions |
  |                          |-- execute swap (CPI) ----->|
  |                          |-- transfer to user ------->|
  |<-- output tokens --------|                            |
```

## Security Model

### Access Control Matrix

| Operation | Global Manager | Admin | Operator | User |
|-----------|:-------------:|:-----:|:--------:|:----:|
| Create Global Manager | First caller | - | - | - |
| Change Global Manager | Yes | - | - | - |
| Withdraw Platform Fees | Yes | - | - | - |
| Change Vault Authority Admin | Yes | - | - | - |
| Create/Close Vaults | - | Yes | Yes | - |
| Change Registry Authority | - | Yes | - | - |
| Add/Remove Operators | - | Yes | - | - |
| Configure Adapters | - | Yes | Yes | - |
| Enable/Disable Pools | - | Yes | Yes | - |
| Execute Route Swap | - | - | - | Yes |
| Execute Jupiter Shared Route | - | - | - | Yes |
| Create Limit Order | - | - | - | Yes |
| Cancel Own Limit Order | - | - | - | Yes |
| Execute Limit Order | - | - | Yes | - |
| Cancel Expired Order | - | - | Yes | - |
| Close Filled/Cancelled Order | - | - | Yes | - |

### PDA Authority Model

All vault operations use PDA-signed CPIs. The vault authority PDA (`["vault_authority"]`) is the owner of all token vaults, ensuring:
- Only the program can move tokens in/out of vaults
- Atomic swap execution (all-or-nothing)
- No unauthorized token access

### Slippage Protection

Every swap includes a `slippage_bps` parameter (basis points). The program verifies that actual output meets the minimum expected after slippage tolerance:

```
min_output = quoted_output * (10000 - slippage_bps) / 10000
require!(actual_output >= min_output)
```

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@coral-xyz/anchor` | ^0.31.1 | Anchor framework |
| `@solana/web3.js` | ^1.95.3 | Solana web3 |
| `@solana/spl-token` | ^0.4.9 | SPL Token operations |

## Program IDs

| Program | ID |
|---------|-----|
| Flipper | `fLpRcgQSJxKeeUogb6M7bWe1iyYQbahjGXGwr4HgHit` |
| Jupiter V6 | `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` |
| Raydium AMM | Protocol-specific |
| Whirlpool (Orca) | Protocol-specific |
| Meteora DLMM | Protocol-specific |
