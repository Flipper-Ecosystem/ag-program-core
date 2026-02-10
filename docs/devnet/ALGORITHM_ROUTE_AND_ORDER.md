# Algorithm for Using the `shared_route_and_create_order` Instruction

## Overview

The `shared_route_and_create_order` instruction combines a Jupiter CPI swap with limit order creation. This allows a user to execute in a single transaction:
1. Exchange tokens via Jupiter
2. Automatically create a limit order with the received tokens for a reverse swap

## Workflow Diagram

```
User Source Tokens (50 SOL)
         |
    Jupiter Swap
         |
Swap Output (75 USDT) -> Order Input Vault
         |
   Create Limit Order
   (Wait for trigger: 5% profit)
         |
When triggered: USDT -> SOL (52.5 SOL)
```

## Instruction Structure

### Main Components

1. **Vault Authority** - PDA managing all vaults
2. **Limit Order** - order account (created via `init_limit_order`)
3. **User Accounts** - user's token accounts
4. **Swap Vaults** - temporary storage for the swap
5. **Jupiter Program** - program for executing the swap via CPI

### Instruction Parameters

```rust
pub fn shared_route_and_create_order(
    order_nonce: u64,              // Unique order identifier
    swap_route_plan: Vec<RoutePlanStep>, // Jupiter route plan
    swap_in_amount: u64,           // Number of input tokens for the swap
    swap_quoted_out_amount: u64,   // Expected number of output tokens
    swap_slippage_bps: u16,        // Allowed slippage for the swap (0.5% = 50 bps)
    platform_fee_bps: u8,          // Platform fee (0.5% = 50)
    order_min_output_amount: u64,  // Minimum token amount for the order
    order_trigger_price_bps: u32,  // Trigger price (5% = 500 bps)
    order_expiry: i64,             // Order expiration time (Unix timestamp)
    order_slippage_bps: u16,       // Allowed slippage for the order
) -> Result<(u64, Pubkey)>
```

## Step-by-Step Guide

### Step 1: Initialize the Limit Order Account

Before calling `shared_route_and_create_order`, you must initialize the limit order:

```typescript
const orderNonce = new BN(Date.now());

// Derive limit order PDA
const [limitOrder] = PublicKey.findProgramAddressSync(
    [
        Buffer.from("limit_order"),
        user.publicKey.toBuffer(),
        orderNonce.toArrayLike(Buffer, "le", 8),
    ],
    program.programId
);

// Derive order vault PDA (will store swap tokens)
const [orderVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("order_vault"), limitOrder.toBuffer()],
    program.programId
);

// Initialize the limit order account
await program.methods
    .initLimitOrder(orderNonce, 0) // 0 = standard size, 14 for Token-2022 with extensions
    .accounts({
        vaultAuthority,
        limitOrder,
        inputVault: orderVault,
        inputMint: destinationMint, // Mint of tokens to be received from the swap
        inputTokenProgram: TOKEN_PROGRAM_ID,
        creator: user.publicKey,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .signers([user])
    .rpc();
```

### Step 2: Prepare Parameters

```typescript
// Swap parameters
const swapInAmount = new BN(50_000_000); // 50 SOL (6 decimals)
const swapQuotedOutAmount = new BN(75_000_000); // 75 USDT (expected output)
const swapSlippageBps = 50; // 0.5% slippage
const platformFeeBps = 0; // 0% fee (or any value)

// Limit order parameters
const orderMinOutputAmount = new BN(50_000_000); // Minimum 50 SOL back
const orderTriggerPriceBps = 500; // Trigger at 5% profit (75 USDT -> 52.5 SOL)
const orderExpiry = new BN(Math.floor(Date.now() / 1000) + 3600); // 1 hour
const orderSlippageBps = 100; // 1% slippage for order execution

// Route plan for Jupiter
const routePlan = [
    {
        swap: { raydium: {} }, // Swap type (Raydium in this example)
        percent: 100,          // Use 100% of input tokens
        inputIndex: 0,         // Input vault index in remainingAccounts
        outputIndex: 1,        // Output vault index in remainingAccounts
    }
];
```

### Step 3: Prepare Remaining Accounts for Jupiter

```typescript
// Get the list of accounts for the Jupiter swap
// This may include liquidity pools, oracles, and other DEX-specific accounts
const jupiterAccounts = [
    { pubkey: liquidityPool, isSigner: false, isWritable: true },
    { pubkey: poolAuthority, isSigner: false, isWritable: false },
    // ... other accounts required for Jupiter
];
```

### Step 4: Execute the Instruction

```typescript
const result = await program.methods
    .sharedRouteAndCreateOrder(
        orderNonce,
        routePlan,
        swapInAmount,
        swapQuotedOutAmount,
        swapSlippageBps,
        platformFeeBps,
        orderMinOutputAmount,
        orderTriggerPriceBps,
        orderExpiry,
        orderSlippageBps
    )
    .accounts({
        vaultAuthority,
        limitOrder,
        userInputAccount: userSourceTokenAccount,      // Source of SOL for the swap
        userDestinationAccount: userSourceTokenAccount, // Destination for SOL after order execution
        swapSourceVault: sourceVault,                  // Vault for input tokens (SOL)
        swapDestinationVault: orderVault,              // Vault for output tokens (USDT) = order input vault
        swapInputMint: sourceMint,                     // SOL mint
        swapOutputMint: destinationMint,               // USDT mint
        inputTokenProgram: TOKEN_PROGRAM_ID,
        outputTokenProgram: TOKEN_PROGRAM_ID,
        platformFeeAccount: null,                      // Or fee account
        jupiterProgram: jupiterProgramId,              // Jupiter V6 program ID
        creator: user.publicKey,
        systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(jupiterAccounts)
    .signers([user])
    .rpc();

console.log("Swap completed and limit order created");
console.log("Transaction:", result);
```

## What Happens Inside the Instruction

### Stage 1: Parameter Validation
- Validates all input parameters
- Checks that the limit order is in `Init` status
- Checks that the destination vault matches the order's input vault

### Stage 2: Transfer Tokens from User to Vault
```rust
// User Source Account -> Swap Source Vault
transfer_checked(swap_in_amount)
```

### Stage 3: Execute Jupiter CPI Swap
```rust
// Swap Source Vault -> Swap Destination Vault (via Jupiter)
invoke_signed(jupiter_route_instruction)
```

### Stage 4: Collect Platform Fee (if specified)
```rust
// Swap Destination Vault -> Platform Fee Account
transfer_checked(fee_amount)
```

### Stage 5: Check Slippage
```rust
require!(swap_output >= min_acceptable_output)
```

### Stage 6: Create Limit Order
```rust
// Update limit order parameters
order.input_mint = swap_output_mint;     // USDT
order.output_mint = swap_input_mint;     // SOL (reverse swap)
order.input_amount = swap_output_amount; // Tokens in vault
order.status = OrderStatus::Open;        // Order is active
```

### Stage 7: Emit Events
```rust
emit_cpi!(RouterSwapEvent { ... });
emit_cpi!(LimitOrderCreated { ... });
emit_cpi!(RouteAndCreateOrderEvent { ... });
```

## Usage Example

```typescript
// 1. SOL -> USDT via Jupiter
// 2. Create limit order: USDT -> SOL with 5% profit

const orderNonce = new BN(Date.now());
const swapAmount = new BN(50_000_000); // 50 SOL

// Initialize limit order
await initLimitOrder(orderNonce, destinationMint);

// Execute swap + create order
await program.methods
    .sharedRouteAndCreateOrder(
        orderNonce,
        routePlan,
        swapAmount,
        new BN(75_000_000),  // Expect 75 USDT
        50,                  // 0.5% slippage for swap
        0,                   // 0% fee
        new BN(50_000_000),  // Minimum 50 SOL back
        500,                 // Trigger at 5% profit
        expiry,
        100                  // 1% slippage for order
    )
    .accounts({ ... })
    .remainingAccounts(jupiterAccounts)
    .signers([user])
    .rpc();

// Result:
// - 50 SOL -> 75 USDT (via Jupiter)
// - Limit order created: 75 USDT -> SOL (will execute at trigger)
```

## Important Notes

### Requirements
1. **Limit order must be initialized** via `init_limit_order` before calling
2. **Limit order status must be Init** (not Open, not Filled, not Cancelled)
3. **Swap destination vault = Order input vault** (same account)
4. **User input account** must have enough tokens for the swap
5. **Jupiter accounts** must be correctly specified in remainingAccounts

### Constraints
- `swap_slippage_bps` <= 10,000 (100%)
- `order_trigger_price_bps` > 0 and <= 100,000 (1000%)
- `order_slippage_bps` <= 10,000 (100%)
- `order_expiry` > current time
- Always creates a `TakeProfit` order (for reverse swap with profit)

### Errors
- `InvalidOrderStatus` - limit order not in Init status
- `InvalidTriggerPrice` - invalid trigger price (0 or > 100,000)
- `InvalidSlippage` - slippage exceeds 100%
- `InvalidExpiry` - expiration time is in the past
- `InvalidVaultAddress` - destination vault doesn't match order input vault
- `SlippageToleranceExceeded` - actual slippage exceeded the allowed amount

## Advantages

1. **Atomicity** - swap and order creation in a single transaction
2. **Automation** - no need to manually create an order after the swap
3. **Security** - tokens are immediately protected in the vault until order execution
4. **Efficiency** - saves on fees (one transaction instead of two)
5. **Flexibility** - supports any tokens (SPL Token and Token-2022)

## Related Instructions

- `init_limit_order` - initialize limit order account
- `shared_route` - simple swap via Jupiter without order creation
- `shared_execute_limit_order` - execute an order via Jupiter CPI
- `cancel_limit_order` - cancel an order by the user

## Additional Resources

- Jupiter V6 Documentation: https://station.jup.ag/docs/apis/swap-api
- Flipper Program: `fLpRcgQSJxKeeUogb6M7bWe1iyYQbahjGXGwr4HgHit`
- Tests: `tests/07. shared_jupiter_instructions.ts`
