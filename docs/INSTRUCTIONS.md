# Flipper Protocol - Instruction Reference

Complete reference for all program instructions organized by module.

## Adapter Registry Module

Instructions for managing the DEX adapter registry, operators, and pool configurations.

### `initialize_adapter_registry`

Initializes the adapter registry PDA with supported adapters and operators.

| Parameter | Type | Description |
|-----------|------|-------------|
| `adapters` | `Vec<AdapterInfo>` | List of adapters to register |
| `operators` | `Vec<Pubkey>` | List of initial operators |

**Authority**: Transaction signer becomes the registry authority.
**PDA**: `["adapter_registry"]`

---

### `configure_adapter`

Adds or updates a DEX adapter in the registry.

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `String` | Adapter display name |
| `program_id` | `Pubkey` | DEX program ID |
| `swap_type` | `Swap` | Swap enum variant |

**Authority**: Registry authority or operator.

---

### `initialize_pool_info`

Creates a `PoolInfo` account for a specific pool under an adapter.

| Parameter | Type | Description |
|-----------|------|-------------|
| `swap_type` | `Swap` | Adapter swap type |
| `pool_address` | `Pubkey` | Pool address to register |

**Authority**: Registry authority or operator.
**PDA**: `["pool_info", swap_type_bytes, pool_address]`

---

### `add_operator`

Adds a new operator to the adapter registry.

| Parameter | Type | Description |
|-----------|------|-------------|
| `operator` | `Pubkey` | Operator public key to add |

**Authority**: Registry authority only.

---

### `remove_operator`

Removes an operator from the adapter registry.

| Parameter | Type | Description |
|-----------|------|-------------|
| `operator` | `Pubkey` | Operator public key to remove |

**Authority**: Registry authority only.

---

### `disable_adapter`

Disables (removes) an adapter from the registry.

| Parameter | Type | Description |
|-----------|------|-------------|
| `swap_type` | `Swap` | Swap type to disable |

**Authority**: Registry authority or operator.

---

### `disable_pool`

Disables a specific pool by setting `enabled = false`.

| Parameter | Type | Description |
|-----------|------|-------------|
| (none) | - | Pool identified by account |

**Authority**: Registry authority or operator.

---

### `change_authority`

Transfers the registry authority to a new address.

| Parameter | Type | Description |
|-----------|------|-------------|
| `new_authority` | `Pubkey` | New authority address |

**Authority**: Current registry authority.

---

### `reset_adapter_registry`

Resets the registry with a new set of adapters and operators.

| Parameter | Type | Description |
|-----------|------|-------------|
| `adapters` | `Vec<AdapterInfo>` | New adapter list |
| `operators` | `Vec<Pubkey>` | New operator list |

**Authority**: Registry authority.

---

### `migrate_adapter_registry`

Migration instruction to store the bump seed in the registry account.

**Authority**: Registry authority.

---

## Vault Manager Module

Instructions for managing the vault system, global manager, and platform fees.

### `create_global_manager`

Creates the Global Manager PDA. The first caller becomes the manager.

| Parameter | Type | Description |
|-----------|------|-------------|
| `manager` | `Pubkey` | Manager address (can be multisig) |

**PDA**: `["global_manager"]`
**Note**: Can only be called once. Critical to call immediately after deployment.

---

### `change_global_manager`

Transfers the Global Manager role to a new address. Irreversible.

| Parameter | Type | Description |
|-----------|------|-------------|
| `new_manager` | `Pubkey` | New manager address |

**Authority**: Current Global Manager.

---

### `create_vault_authority`

Creates the Vault Authority PDA that owns all token vaults.

| Parameter | Type | Description |
|-----------|------|-------------|
| `admin` | `Pubkey` | Admin address for the vault authority |

**PDA**: `["vault_authority"]`

---

### `create_vault`

Creates a token vault for a specific mint, owned by the vault authority PDA.

| Parameter | Type | Description |
|-----------|------|-------------|
| `mint` | `Pubkey` | Token mint for the vault |

**PDA**: `["vault", mint_address]`
**Authority**: Admin or operator.

---

### `create_vault_with_extensions`

Creates a vault for Token 2022 mints with extensions support.

| Parameter | Type | Description |
|-----------|------|-------------|
| `mint` | `Pubkey` | Token 2022 mint |

**Authority**: Admin or operator.

---

### `close_vault`

Closes an empty vault and reclaims rent.

**Authority**: Admin.
**Requirement**: Vault balance must be zero.

---

### `initialize_vaults`

Batch-initializes input and output vaults for a swap pair.

| Parameter | Type | Description |
|-----------|------|-------------|
| `input_mint` | `Pubkey` | Input token mint |
| `output_mint` | `Pubkey` | Output token mint |

**Authority**: Admin or operator.

---

### `change_vault_authority_admin`

Changes the vault authority admin. Only callable by the Global Manager.

| Parameter | Type | Description |
|-----------|------|-------------|
| `new_admin` | `Pubkey` | New admin address |

**Authority**: Global Manager only.

---

### `migrate_vault_authority`

Migration instruction to add `jupiter_program_id` field to the vault authority.

**Authority**: Admin.

---

### `set_jupiter_program`

Sets the Jupiter program ID in the vault authority for CPI validation.

| Parameter | Type | Description |
|-----------|------|-------------|
| `jupiter_program_id` | `Pubkey` | Jupiter V6 program ID |

**Authority**: Global Manager only.

---

### `withdraw_platform_fees`

Withdraws accumulated platform fees from a vault to a designated account.

| Parameter | Type | Description |
|-----------|------|-------------|
| `amount` | `u64` | Amount to withdraw |

**Authority**: Global Manager only.

---

## Swap Processor Module

### `route`

Executes a multi-step swap route through on-chain DEX adapters.

| Parameter | Type | Description |
|-----------|------|-------------|
| `route_plan` | `Vec<RoutePlanStep>` | Ordered list of swap steps |
| `in_amount` | `u64` | Total input amount |
| `quoted_out_amount` | `u64` | Expected output amount |
| `slippage_bps` | `u16` | Slippage tolerance (basis points) |
| `platform_fee_bps` | `u8` | Platform fee (basis points) |

**Caller**: Any user.
**Flow**: Validates route -> transfers user tokens to vault -> executes each swap step via adapter CPI -> deducts fees -> transfers output to user.

---

## Shared Route Module (Jupiter Integration)

### `shared_route`

Executes a swap via Jupiter V6 CPI (`shared_accounts_route`). Jupiter acts as an additional liquidity provider.

| Parameter | Type | Description |
|-----------|------|-------------|
| `route_plan` | `Vec<RoutePlanStep>` | Jupiter route plan |
| `in_amount` | `u64` | Input amount |
| `quoted_out_amount` | `u64` | Expected output |
| `slippage_bps` | `u16` | Slippage tolerance |
| `platform_fee_bps` | `u8` | Platform fee |

**Caller**: Any user.
**Flow**: Transfers user tokens to vault -> CPI to Jupiter `shared_accounts_route` -> collects output in vault -> deducts fees -> transfers to user.

---

### `shared_route_and_create_order`

Atomically executes a Jupiter CPI swap and creates a limit order with the output tokens.

| Parameter | Type | Description |
|-----------|------|-------------|
| `order_nonce` | `u64` | Unique order identifier |
| `swap_route_plan` | `Vec<RoutePlanStep>` | Jupiter route plan |
| `swap_in_amount` | `u64` | Input amount for swap |
| `swap_quoted_out_amount` | `u64` | Expected swap output |
| `swap_slippage_bps` | `u16` | Swap slippage tolerance |
| `platform_fee_bps` | `u8` | Platform fee |
| `order_min_output_amount` | `u64` | Minimum output for order execution |
| `order_trigger_price_bps` | `u32` | Trigger price in basis points |
| `order_expiry` | `i64` | Order expiration (Unix timestamp) |
| `order_slippage_bps` | `u16` | Order execution slippage |

**Caller**: Any user.

---

## Limit Orders Module

### `init_limit_order`

Initializes a limit order account and its input vault. Must be called before `create_limit_order`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `nonce` | `u64` | Unique nonce for PDA derivation |
| `extra_space` | `u16` | Extra space for Token 2022 extensions (0 for standard, 14 for extensions) |

**PDA**: `["limit_order", creator, nonce]`
**Order Vault PDA**: `["order_vault", limit_order]`

---

### `create_limit_order`

Sets parameters on an initialized limit order and locks tokens in the order vault.

| Parameter | Type | Description |
|-----------|------|-------------|
| `input_amount` | `u64` | Amount of tokens to lock |
| `min_output_amount` | `u64` | Minimum acceptable output |
| `trigger_price_bps` | `u32` | Trigger price (basis points) |
| `trigger_type` | `TriggerType` | `TakeProfit` or `StopLoss` |
| `expiry` | `i64` | Expiration Unix timestamp |
| `slippage_bps` | `u16` | Slippage tolerance |

**Caller**: Order creator.
**Requirement**: Order must be in `Init` status.

---

### `execute_limit_order`

Executes a limit order by swapping locked tokens through the adapter route.

| Parameter | Type | Description |
|-----------|------|-------------|
| `route_plan` | `Vec<RoutePlanStep>` | Swap route to execute |
| `platform_fee_bps` | `u8` | Platform fee |

**Caller**: Authorized operator only.
**Requirements**: Order must be `Open`, not expired, trigger conditions met.

---

### `shared_execute_limit_order`

Executes a limit order using Jupiter CPI instead of direct adapter routing.

| Parameter | Type | Description |
|-----------|------|-------------|
| `route_plan` | `Vec<RoutePlanStep>` | Jupiter route plan |
| `quoted_out_amount` | `u64` | Expected output |
| `slippage_bps` | `u16` | Slippage tolerance |
| `platform_fee_bps` | `u8` | Platform fee |

**Caller**: Authorized operator only.

---

### `cancel_limit_order`

Cancels an open limit order and refunds locked tokens to the creator.

**Caller**: Order creator only.
**Requirement**: Order must be `Open` status.

---

### `cancel_expired_limit_order_by_operator`

Allows an operator to cancel an expired limit order and refund tokens to the creator.

**Caller**: Authorized operator.
**Requirement**: Order must be `Open` and past its expiry time.

---

### `close_limit_order_by_operator`

Closes a filled or cancelled limit order account and reclaims rent to the creator.

**Caller**: Authorized operator.
**Requirement**: Order must be in `Filled` or `Cancelled` status.

---

### `route_and_create_order`

Atomically executes a direct adapter swap and creates a limit order with the output.

| Parameter | Type | Description |
|-----------|------|-------------|
| `order_nonce` | `u64` | Unique order identifier |
| `route_plan` | `Vec<RoutePlanStep>` | Direct swap route plan |
| `in_amount` | `u64` | Input amount |
| `quoted_out_amount` | `u64` | Expected output |
| `slippage_bps` | `u16` | Slippage tolerance |
| `platform_fee_bps` | `u8` | Platform fee |
| `order_min_output_amount` | `u64` | Minimum output for order |
| `order_trigger_price_bps` | `u32` | Trigger price |
| `order_expiry` | `i64` | Order expiration |
| `order_slippage_bps` | `u16` | Order slippage |

**Caller**: Any user.
