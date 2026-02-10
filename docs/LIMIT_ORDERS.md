# Flipper Protocol - Limit Order System

## Overview

Flipper supports conditional limit orders that allow users to lock tokens and define trigger conditions for automatic execution. Orders can be executed through either the direct adapter route or Jupiter CPI.

## Order Types

### TakeProfit

Executes when the swap output meets or exceeds the minimum output amount. Used to lock in profits when a token reaches a target price.

### StopLoss

Executes when market conditions indicate a stop-loss trigger. Used to limit losses when a token falls below a threshold.

## Order Lifecycle

```
                    +------------------+
                    |   init_limit_    |
                    |   order()        |
                    +--------+---------+
                             |
                    +--------v---------+
                    |      Init        |
                    |  (account only)  |
                    +--------+---------+
                             |
                    +--------v---------+
                    |   create_limit_  |
                    |   order()        |
                    +--------+---------+
                             |
                    +--------v---------+
                    |      Open        |
                    | (tokens locked)  |
                    +--------+---------+
                             |
               +-------------+-------------+
               |                           |
    +----------v-----------+    +----------v-----------+
    |  execute_limit_      |    |  cancel_limit_       |
    |  order() / shared_   |    |  order() /           |
    |  execute_limit_      |    |  cancel_expired_     |
    |  order()             |    |  by_operator()       |
    +----------+-----------+    +----------+-----------+
               |                           |
    +----------v-----------+    +----------v-----------+
    |      Filled          |    |     Cancelled        |
    | (tokens swapped)     |    |  (tokens refunded)   |
    +----------+-----------+    +----------+-----------+
               |                           |
               +-------------+-------------+
                             |
                    +--------v---------+
                    |  close_limit_    |
                    |  order_by_       |
                    |  operator()      |
                    +--------+---------+
                             |
                    +--------v---------+
                    |  Account Closed  |
                    | (rent reclaimed) |
                    +------------------+
```

## Creating a Limit Order

### Step 1: Initialize the Order Account

```typescript
const orderNonce = new BN(Date.now());

// Derive limit order PDA
const [limitOrder] = PublicKey.findProgramAddressSync(
    [
        Buffer.from("limit_order"),
        user.publicKey.toBuffer(),
        orderNonce.toArrayLike(Buffer, "le", 8),
    ],
    programId
);

// Derive order vault PDA
const [orderVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("order_vault"), limitOrder.toBuffer()],
    programId
);

await program.methods
    .initLimitOrder(orderNonce, 0) // 0 = standard, 14 = Token 2022 extensions
    .accounts({
        vaultAuthority,
        limitOrder,
        inputVault: orderVault,
        inputMint: tokenMint,
        inputTokenProgram: TOKEN_PROGRAM_ID,
        creator: user.publicKey,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
    })
    .signers([user])
    .rpc();
```

### Step 2: Set Parameters and Lock Tokens

```typescript
await program.methods
    .createLimitOrder(
        new BN(100_000_000),    // input_amount: 100 tokens
        new BN(50_000_000),     // min_output_amount: 50 tokens
        500,                     // trigger_price_bps: 5% trigger
        { takeProfit: {} },      // trigger_type
        new BN(expiry),          // expiry: Unix timestamp
        100                      // slippage_bps: 1%
    )
    .accounts({
        vaultAuthority,
        limitOrder,
        inputVault: orderVault,
        userInputAccount: userTokenAccount,
        inputMint: tokenMint,
        inputTokenProgram: TOKEN_PROGRAM_ID,
        creator: user.publicKey,
    })
    .signers([user])
    .rpc();
```

## Executing a Limit Order

Only authorized operators can execute limit orders. Execution can use either path:

### Via Direct Adapter Route

```typescript
await program.methods
    .executeLimitOrder(routePlan, platformFeeBps)
    .accounts({
        vaultAuthority,
        adapterRegistry,
        limitOrder,
        inputVault: orderVault,
        userDestinationAccount,
        operator: operatorKeypair.publicKey,
        // ... vault and token accounts
    })
    .remainingAccounts(dexAccounts)
    .signers([operatorKeypair])
    .rpc();
```

### Via Jupiter CPI

```typescript
await program.methods
    .sharedExecuteLimitOrder(
        routePlan,
        quotedOutAmount,
        slippageBps,
        platformFeeBps
    )
    .accounts({
        vaultAuthority,
        adapterRegistry,
        limitOrder,
        inputVault: orderVault,
        userDestinationAccount,
        jupiterProgram: JUPITER_PROGRAM_ID,
        operator: operatorKeypair.publicKey,
        // ... vault and token accounts
    })
    .remainingAccounts(jupiterAccounts)
    .signers([operatorKeypair])
    .rpc();
```

## Cancelling a Limit Order

### By the Creator

The order creator can cancel at any time while the order is `Open`:

```typescript
await program.methods
    .cancelLimitOrder()
    .accounts({
        vaultAuthority,
        limitOrder,
        inputVault: orderVault,
        userInputAccount: userTokenAccount,
        inputMint: tokenMint,
        inputTokenProgram: TOKEN_PROGRAM_ID,
        creator: user.publicKey,
    })
    .signers([user])
    .rpc();
```

### Expired Orders by Operator

Operators can cancel expired orders on behalf of the creator:

```typescript
await program.methods
    .cancelExpiredLimitOrderByOperator()
    .accounts({
        vaultAuthority,
        adapterRegistry,
        limitOrder,
        inputVault: orderVault,
        userInputAccount: creatorTokenAccount,
        inputMint: tokenMint,
        inputTokenProgram: TOKEN_PROGRAM_ID,
        operator: operatorKeypair.publicKey,
    })
    .signers([operatorKeypair])
    .rpc();
```

## Closing an Order

After an order is `Filled` or `Cancelled`, an operator can close the account to reclaim rent:

```typescript
await program.methods
    .closeLimitOrderByOperator()
    .accounts({
        limitOrder,
        inputVault: orderVault,
        creator: creatorPubkey,  // Rent goes to creator
        operator: operatorKeypair.publicKey,
        adapterRegistry,
        vaultAuthority,
    })
    .signers([operatorKeypair])
    .rpc();
```

## Atomic Swap + Order Creation

Both execution paths support atomic swap-and-create-order in a single transaction:

### `route_and_create_order` (Direct Adapters)

Executes a direct adapter swap and uses the output tokens to create a limit order.

### `shared_route_and_create_order` (Jupiter CPI)

Executes a Jupiter CPI swap and uses the output tokens to create a limit order.

This is useful for strategies like:
1. Swap SOL -> USDT via Jupiter
2. Automatically create a limit order: USDT -> SOL at 5% profit target

## Parameter Constraints

| Parameter | Constraint |
|-----------|-----------|
| `trigger_price_bps` | > 0 and <= 100,000 (0.01% to 1000%) |
| `slippage_bps` | <= 10,000 (max 100%) |
| `expiry` | Must be in the future |
| `input_amount` | Must be > 0 |
| `min_output_amount` | Must be > 0 |

## Token 2022 Support

Limit orders support Token 2022 mints with extensions. Pass `extra_space = 14` when calling `init_limit_order` for Token 2022 tokens with extensions (e.g., confidential transfers).

## Error Codes

| Error | Description |
|-------|-------------|
| `InvalidOrderStatus` | Order not in expected status for this operation |
| `OrderExpired` | Order has passed its expiry time |
| `InvalidExpiry` | Expiry time is in the past |
| `OrderAlreadyFilled` | Order was already executed |
| `OrderAlreadyCancelled` | Order was already cancelled |
| `TriggerPriceNotMet` | Current conditions don't meet the trigger |
| `InsufficientOutputAmount` | Swap output below minimum |
| `InvalidTriggerPrice` | Trigger price is 0 or exceeds maximum |
| `InsufficientVaultBalance` | Not enough tokens in order vault |
