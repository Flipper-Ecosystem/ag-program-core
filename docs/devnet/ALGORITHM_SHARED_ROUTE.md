# Algorithm for Testing the `5.test_shared_route_jupiter.ts` Script

## Overview

This script tests the `shared_route` instruction of the Flipper program, which performs a token swap via a CPI call to the mock Jupiter program.

---

## Stage 1: Initialization and Configuration Loading

### Lines 17-25: Loading Configuration
- **What happens**: Reads the `jupiter_test_config.json` file containing addresses of previously created accounts
- **Who is responsible**: The `4.setup_shared_jupiter_environment.ts` script should have created this config
- **Config contents**: vaultAuthority, mints, vaults, token accounts, platformFeeAccount

### Lines 28-41: Loading Keypair
- **What happens**: Loads the user's keypair from file
- **Priority**: First tries `fpp-staging.json`, then falls back to `id.json`
- **Who is this**: The user on whose behalf the swap will be executed

### Lines 43-55: Connecting to Devnet
- **What happens**: Creates a connection to Solana devnet, wallet, and provider
- **Programs loaded**: Flipper and Mock Jupiter via their IDLs

---

## Stage 2: Preparing for the Swap

### Lines 58-67: Loading Addresses
**Loaded from config**:
- `vaultAuthority` - PDA that controls vaults
- `sourceMint`, `destinationMint` - tokens for the exchange
- `sourceVault`, `destinationVault` - Flipper token vaults
- `platformFeeAccount` - platform fee account
- Provider's token accounts

### Lines 84-93: Swap Parameters
- **inAmount**: 100 tokens (100,000,000 accounting for 6 decimals)
- **quotedOutAmount**: 150 tokens (expected output, rate 1:1.5)
- **slippageBps**: 50 basis points = 0.5% slippage
- **platformFeeBps**: 0% fee for testing

---

## Stage 3: Checking Balances BEFORE the Swap

### Lines 95-120: Reading Balances

**User balances read**:
- `providerSourceTokenAccount` - user's source token balance
- `providerDestinationTokenAccount` - user's destination token balance

**Vault balances read** (if they exist):
- `sourceVault` - source tokens in vault
- `destinationVault` - destination tokens in vault

**Error handling**: If vaults don't exist, shows "N/A" instead of crashing

---

## Stage 4: Creating Mock Liquidity Pool

### Lines 122-146: Preparing the "Liquidity Pool"
- **What is created**: Associated Token Account for destination tokens
- **Owner**: wallet.publicKey (our user)
- **Purpose**: Mock Jupiter will "provide" tokens from this pool
- **Funding**: Mints `quotedOutAmount * 2` destination tokens into this account
- **Who is responsible**: This simulates a real DEX liquidity pool

---

## Stage 5: Executing shared_route

### Lines 148-156: Swap Route

```javascript
routePlan = [{
    swap: { raydium: {} },  // Swap type (irrelevant in test)
    percent: 100,           // Use 100% of input tokens
    inputIndex: 0,          // Input token index
    outputIndex: 1          // Output token index
}]
```

### Lines 158-191: Calling the shared_route Instruction

**Called by**: Our user (wallet.payer)

#### What happens inside the Flipper program:

1. **Validates parameters**: amount, slippage, route plan
2. **Transfers source tokens**: from user to sourceVault
3. **Makes CPI call to Jupiter**: calls mock Jupiter program
4. **Jupiter CPI**:
   - Gets destination tokens from mock liquidity pool
   - Transfers them to Flipper's destinationVault
5. **Flipper transfers back**: from destinationVault to user
6. **Applies fee**: if platformFeeBps > 0

#### Accounts (participants):

- `vaultAuthority` - PDA authorization for vaults
- `userSourceTokenAccount` - source of user's tokens
- `userDestinationTokenAccount` - destination for user's tokens
- `vaultSource` - temporary storage for input tokens
- `vaultDestination` - temporary storage for output tokens
- `platformFeeAccount` - destination for platform fees
- `jupiterProgram` - mock Jupiter program for CPI

#### RemainingAccounts (additional accounts for Jupiter):

- `[0] mockLiquidityPool` - where Jupiter gets tokens from
- `[1] wallet.publicKey` - authority for transfer

---

## Stage 6: Verifying Results

### Lines 193-194: Waiting for Confirmation
- 3-second pause to ensure the transaction is processed

### Lines 196-219: Reading Balances AFTER the Swap
- All balances are read again (user and vaults)
- Compared with balances BEFORE the swap

### Lines 221-242: Calculating Changes

```javascript
sourceChange = balance_before - balance_after  // Amount spent
destChange = balance_after - balance_before     // Amount received
```

**Checks**:
1. `sourceChange === inAmount` - source tokens were debited correctly
2. `destChange > 0` - destination tokens were received

---

## Stage 7: Result

### Lines 244-248: Successful Result
- Displays a success message
- Shows that mock Jupiter correctly processed the swap

### Lines 250-257: Error Handling
- If something went wrong, displays transaction logs
- Helps understand at which stage the error occurred

---

## Key Participants

1. **User (wallet.payer)** - swap initiator, token owner
2. **Flipper program** - swap coordinator, manages vaults
3. **Mock Jupiter program** - simulates DEX, performs the actual exchange
4. **Vault Authority (PDA)** - has permissions to manage vaults
5. **Source/Destination Vaults** - temporary token storage
6. **Mock Liquidity Pool** - source of destination tokens for the swap

---

## Expected Result

- User spends 100 source tokens
- User receives ~150 destination tokens (minus slippage)
- Vaults remain with a balance of 0 (or minimal rent-exempt amount)
- Platform receives a fee (if platformFeeBps > 0)

---

## Running the Test

```bash
# Make sure the setup has been executed
npm run devnet:setup-jupiter

# Create vaults (if not already created)
npm run devnet:create-vaults

# Run the test
npm run devnet:test-route
```

---

## Possible Issues

### TokenAccountNotFoundError
- **Cause**: Vaults not created or created by a different admin
- **Solution**: Run `npm run devnet:create-vaults` with id.json

### Insufficient funds
- **Cause**: User doesn't have enough source tokens
- **Solution**: Run setup again to refill balances

### UnauthorizedAdmin
- **Cause**: Trying to use vaults created by a different keypair
- **Solution**: Use the same keypair that created the vault authority
