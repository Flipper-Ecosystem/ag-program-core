# Flipper Protocol - Events & Error Codes

## Events

Events are emitted during program execution for off-chain indexing and monitoring.

### Adapter Registry Events

#### `AdapterConfigured`
Emitted when an adapter is registered or updated.

| Field | Type | Description |
|-------|------|-------------|
| `program_id` | `Pubkey` | DEX program ID |
| `swap_type` | `Swap` | Swap enum variant |

#### `AdapterDisabled`
Emitted when an adapter is removed from the registry.

| Field | Type | Description |
|-------|------|-------------|
| `swap_type` | `Swap` | Disabled swap type |

#### `PoolInitialized`
Emitted when a new pool is registered.

| Field | Type | Description |
|-------|------|-------------|
| `swap_type` | `Swap` | Parent adapter swap type |
| `pool_address` | `Pubkey` | Pool address |

#### `PoolDisabled`
Emitted when a pool is disabled.

| Field | Type | Description |
|-------|------|-------------|
| `swap_type` | `Swap` | Parent adapter swap type |
| `pool_address` | `Pubkey` | Disabled pool address |

#### `AuthorityChanged`
Emitted when the registry authority is transferred.

| Field | Type | Description |
|-------|------|-------------|
| `old_authority` | `Pubkey` | Previous authority |
| `new_authority` | `Pubkey` | New authority |

#### `OperatorAdded`
Emitted when an operator is added to the registry.

| Field | Type | Description |
|-------|------|-------------|
| `operator` | `Pubkey` | Added operator's public key |

#### `OperatorRemoved`
Emitted when an operator is removed from the registry.

| Field | Type | Description |
|-------|------|-------------|
| `operator` | `Pubkey` | Removed operator's public key |

#### `RegistryReset`
Emitted when the registry is reset.

| Field | Type | Description |
|-------|------|-------------|
| `authority` | `Pubkey` | Authority that triggered the reset |

---

### Vault & Manager Events

#### `GlobalManagerChanged`
Emitted when the Global Manager role is transferred.

| Field | Type | Description |
|-------|------|-------------|
| `old_manager` | `Pubkey` | Previous manager |
| `new_manager` | `Pubkey` | New manager |

#### `VaultAuthorityAdminChanged`
Emitted when the vault authority admin is changed.

| Field | Type | Description |
|-------|------|-------------|
| `old_admin` | `Pubkey` | Previous admin |
| `new_admin` | `Pubkey` | New admin |
| `changed_by` | `Pubkey` | Global Manager who made the change |

---

### Swap Events

#### `SwapEvent`
Emitted for each individual swap step in a route.

| Field | Type | Description |
|-------|------|-------------|
| `amm` | `Pubkey` | DEX program ID |
| `input_mint` | `Pubkey` | Input token mint |
| `input_amount` | `u64` | Input amount |
| `output_mint` | `Pubkey` | Output token mint |
| `output_amount` | `u64` | Output amount |

#### `RouterSwapEvent`
Emitted once per complete route swap (aggregated result).

| Field | Type | Description |
|-------|------|-------------|
| `sender` | `Pubkey` | User who initiated the swap |
| `recipient` | `Pubkey` | User receiving output tokens |
| `input_mint` | `Pubkey` | Input token mint |
| `output_mint` | `Pubkey` | Output token mint |
| `input_amount` | `u64` | Total input amount |
| `output_amount` | `u64` | Final output (after fees) |
| `fee_amount` | `u64` | Platform fee collected |
| `fee_account` | `Option<Pubkey>` | Fee destination account |
| `slippage_bps` | `u16` | Slippage tolerance used |

#### `FeeEvent`
Emitted when a platform fee is collected.

| Field | Type | Description |
|-------|------|-------------|
| `account` | `Pubkey` | Fee recipient account |
| `mint` | `Pubkey` | Token mint of the fee |
| `amount` | `u64` | Fee amount |

---

### Limit Order Events

#### `LimitOrderCreated`
Emitted when a limit order is created (parameters set, tokens locked).

| Field | Type | Description |
|-------|------|-------------|
| `order` | `Pubkey` | Order account address |
| `creator` | `Pubkey` | Order creator |
| `input_mint` | `Pubkey` | Token being sold |
| `output_mint` | `Pubkey` | Token being bought |
| `input_amount` | `u64` | Locked token amount |
| `min_output_amount` | `u64` | Minimum acceptable output |
| `trigger_price_bps` | `u32` | Trigger price (basis points) |
| `trigger_type` | `u8` | 0 = TakeProfit, 1 = StopLoss |
| `expiry` | `i64` | Expiration Unix timestamp |

#### `LimitOrderExecuted`
Emitted when a limit order is successfully executed.

| Field | Type | Description |
|-------|------|-------------|
| `order` | `Pubkey` | Order account address |
| `executor` | `Pubkey` | Operator who executed |
| `input_amount` | `u64` | Input amount swapped |
| `output_amount` | `u64` | Output amount received |
| `fee_amount` | `u64` | Platform fee collected |
| `trigger_type` | `u8` | Trigger type used |
| `min_output_amount` | `u64` | Minimum output requirement |

#### `LimitOrderSwapEvent`
Detailed swap event for limit order execution.

| Field | Type | Description |
|-------|------|-------------|
| `order` | `Pubkey` | Order account |
| `sender` | `Pubkey` | Order creator |
| `recipient` | `Pubkey` | User destination account |
| `executor` | `Pubkey` | Operator who executed |
| `input_mint` | `Pubkey` | Input token mint |
| `output_mint` | `Pubkey` | Output token mint |
| `input_amount` | `u64` | Input amount |
| `output_amount` | `u64` | Output amount (after fees) |
| `fee_amount` | `u64` | Platform fee |
| `fee_account` | `Option<Pubkey>` | Fee destination |
| `trigger_type` | `u8` | Trigger type |

#### `LimitOrderCancelled`
Emitted when a limit order is cancelled.

| Field | Type | Description |
|-------|------|-------------|
| `order` | `Pubkey` | Order account |
| `creator` | `Pubkey` | Order creator |

#### `LimitOrderClosed`
Emitted when a filled/cancelled order account is closed.

| Field | Type | Description |
|-------|------|-------------|
| `order` | `Pubkey` | Order account |
| `closer` | `Pubkey` | Operator who closed |
| `status` | `u8` | Final order status |

#### `RouteAndCreateOrderEvent`
Emitted for atomic swap + order creation.

| Field | Type | Description |
|-------|------|-------------|
| `order` | `Pubkey` | Created order account |
| `swap_input_mint` | `Pubkey` | Swap input token |
| `swap_input_amount` | `u64` | Swap input amount |
| `swap_output_amount` | `u64` | Swap output amount |
| `fee_amount` | `u64` | Fee collected on swap |
| `order_input_amount` | `u64` | Tokens locked in order |

---

## Error Codes

### Route & Swap Errors (6000-6059)

| Code | Name | Description |
|------|------|-------------|
| 6000 | `EmptyRoute` | Route plan has no steps |
| 6001 | `SlippageToleranceExceeded` | Actual output below minimum after slippage |
| 6002 | `InvalidCalculation` | Arithmetic error in calculations |
| 6004 | `InvalidSlippage` | Slippage value out of valid range |
| 6005 | `NotEnoughPercent` | Route step percentages don't sum to 100 |
| 6006 | `InvalidInputIndex` | Input index out of bounds |
| 6007 | `InvalidOutputIndex` | Output index out of bounds |
| 6008 | `NotEnoughAccountKeys` | Insufficient remaining accounts |
| 6053 | `InvalidAmount` | Amount is 0 or invalid |
| 6054 | `InvalidPercent` | Percentage out of valid range |
| 6055 | `InvalidAccountIndex` | Account index out of bounds |
| 6056 | `InvalidMultiHopRoute` | Multi-hop route configuration invalid |
| 6057 | `InvalidPartialSwapPercent` | Partial swap percentages invalid |
| 6058 | `InsufficientDexesForPartialSwap` | Not enough DEXes for partial swap |
| 6059 | `NoOutputProduced` | Swap produced zero output |

### Adapter & Pool Errors (6016-6052)

| Code | Name | Description |
|------|------|-------------|
| 6016 | `SwapNotSupported` | Swap type not registered in registry |
| 6019 | `InvalidAuthority` | Caller is not the authority |
| 6020 | `InvalidPoolAddress` | Pool address doesn't match |
| 6021 | `InvalidCpiInterface` | CPI program ID doesn't match adapter |
| 6022 | `PoolAlreadyExists` | Pool already registered |
| 6023 | `PoolNotFound` | Pool not found in registry |
| 6024 | `InvalidOperator` | Caller is not an authorized operator |
| 6026 | `OperatorAlreadyExists` | Operator already in registry |
| 6027 | `OperatorNotFound` | Operator not in registry |
| 6028 | `InvalidMint` | Invalid mint account |
| 6029 | `VaultNotFound` | Token vault not found |
| 6039 | `PoolAccountNotFound` | Pool account doesn't exist |
| 6040 | `InvalidVaultOwner` | Vault not owned by vault authority |
| 6041 | `VaultNotEmpty` | Vault still has tokens (can't close) |
| 6042 | `UnauthorizedAdmin` | Not the vault authority admin |
| 6043 | `TooManyVaults` | Exceeded vault limit |
| 6044 | `InsufficientAccounts` | Not enough accounts provided |
| 6045 | `InvalidMintAccount` | Mint account data invalid |
| 6046 | `InvalidVaultAddress` | Vault address doesn't match expected PDA |
| 6047 | `VaultAuthorityNotInitialized` | Vault authority PDA not created |
| 6048 | `InvalidAccount` | General invalid account |
| 6049 | `PoolDisabled` | Pool is disabled |
| 6050 | `InvalidTokenProgram` | Wrong token program for this mint |
| 6051 | `InvalidPlatformFeeOwner` | Fee account owner mismatch |
| 6052 | `InvalidPlatformFeeMint` | Fee account mint mismatch |

### Limit Order Errors (6060+)

| Code | Name | Description |
|------|------|-------------|
| 6060 | `InvalidOrderStatus` | Order not in expected status |
| 6061 | `OrderExpired` | Order past expiry time |
| 6062 | `InvalidExpiry` | Expiry time is in the past |
| - | `OrderAlreadyFilled` | Order was already executed |
| - | `OrderAlreadyCancelled` | Order was already cancelled |
| - | `InsufficientVaultBalance` | Not enough tokens in vault |
| - | `OraclePriceNotInRange` | Oracle price outside trigger range |
| - | `MarketConditionsNotMet` | Market conditions don't satisfy trigger |
| - | `TriggerPriceNotMet` | Trigger price not reached |
| - | `InvalidTriggerPrice` | Trigger price is 0 or > 100,000 |
| - | `InsufficientOutputAmount` | Output below minimum |
| - | `StopLossPriceNotReached` | Stop-loss condition not met |
| - | `InsufficientFunds` | Not enough funds |

### Global Manager Errors

| Code | Name | Description |
|------|------|-------------|
| - | `GlobalManagerNotInitialized` | Global manager PDA not created |
| - | `UnauthorizedGlobalManager` | Caller is not the global manager |
| - | `UnauthorizedVaultCreator` | Not admin or operator |

### Jupiter CPI Errors

| Code | Name | Description |
|------|------|-------------|
| - | `JupiterProgramAuthorityMismatch` | Jupiter's authority != vault authority PDA |
| - | `JupiterProgramSourceMismatch` | Jupiter's source != source vault |
| - | `JupiterProgramDestinationMismatch` | Jupiter's destination != destination vault |
| - | `NotEnoughJupiterAccounts` | Less than 13 remaining accounts |
| - | `InvalidJupiterProgram` | Program ID doesn't match configured Jupiter |
