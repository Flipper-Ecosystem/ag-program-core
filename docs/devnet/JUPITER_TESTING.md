# Jupiter Shared Functions - Devnet Testing Scripts

This directory contains scripts for setting up and testing the Flipper protocol's shared Jupiter CPI functions on Devnet.

## Overview

These scripts create a complete testing environment for the shared Jupiter integration, including:
- Test token mints and vaults
- Token accounts for specific test addresses
- Mock Jupiter program configuration
- Comprehensive testing for `shared_route` and shared limit orders

## Prerequisites

1. Solana CLI installed and configured
2. Wallet with devnet SOL (at least 5 SOL recommended)
3. Node.js and TypeScript installed
4. Anchor framework installed

## NPM Commands (Quick Reference)

```bash
npm run devnet:setup-jupiter      # Setup test environment
npm run devnet:verify              # Verify configuration & integration test
npm run devnet:test-route          # Test shared_route
npm run devnet:test-limit-orders   # Test limit orders
npm run devnet:check-status        # Check account status
npm run devnet:test-all            # Run all tests sequentially
```

## Setup

1. Ensure your Solana CLI is configured for devnet:
```bash
solana config set --url devnet
solana config get
```

2. Check your wallet balance and request airdrop if needed:
```bash
solana balance
solana airdrop 5  # Request 5 SOL if balance is low
```

3. Build the programs:
```bash
anchor build
```

4. Deploy the programs to devnet:
```bash
anchor deploy --provider.cluster devnet
```

## Scripts

### 4. Setup Shared Jupiter Environment
**File:** `4.setup_shared_jupiter_environment.ts`

**Purpose:** Creates the complete test environment including:
- Vault authority and adapter registry
- Source and destination token mints (6 decimals)
- Token vaults for both mints
- Platform fee account
- Token accounts for test address `CqN8BpNFhFZDnbLdpUaLUEHGrFymnP8TBcCfQhC8pFYA`
- Token accounts for wallet.provider
- Mints test tokens to all accounts

**Run:**
```bash
ts-node scripts/devnet/4.setup_shared_jupiter_environment.ts
```

**Output:** 
- Creates all necessary accounts and PDAs
- Saves configuration to `jupiter_test_config.json`
- Displays summary of all created accounts

---

### 5. Test Shared Route with Jupiter
**File:** `5.test_shared_route_jupiter.ts`

**Purpose:** Tests the `shared_route` instruction with Jupiter CPI (mock)

**Features:**
- Loads configuration from setup script
- Creates mock liquidity pool
- Executes a swap via `shared_route`
- Verifies token balances before and after
- Confirms Jupiter mock integration works

**Run:**
```bash
ts-node scripts/devnet/5.test_shared_route_jupiter.ts
```

**What it tests:**
- User token transfer to vault
- Jupiter CPI call execution
- Output tokens received by user
- Balance verification

---

### 6. Test Shared Limit Orders
**File:** `6.test_shared_limit_orders_jupiter.ts`

**Purpose:** Tests limit order creation, cancellation, and execution flow with Jupiter

**Features:**
- **Test 1: Create Limit Order**
  - Initializes limit order PDA
  - Creates order with parameters
  - Verifies tokens locked in order vault
  
- **Test 2: Cancel Limit Order**
  - Cancels an existing order
  - Verifies tokens refunded to user
  - Checks order status changed
  
- **Test 3: Execute Limit Order (Flow Demonstration)**
  - Shows execution setup
  - Demonstrates operator role requirement

**Run:**
```bash
ts-node scripts/devnet/6.test_shared_limit_orders_jupiter.ts
```

---

### 7. Verify Jupiter Mock Configuration
**File:** `7.verify_jupiter_mock_config.ts`

**Purpose:** Comprehensive verification and integration test

**Features:**
- **Configuration Verification:**
  - Checks all programs deployed
  - Verifies PDAs initialized
  - Confirms mints created
  - Validates vaults exist with balances
  - Checks token accounts for both provider and test address
  - Verifies platform fee account

- **Integration Test:**
  - Performs actual swap via `shared_route`
  - Verifies end-to-end functionality
  - Confirms Jupiter mock works correctly

**Run:**
```bash
ts-node scripts/devnet/7.verify_jupiter_mock_config.ts
# Or using npm:
npm run devnet:verify
```

**Output:**
- Detailed verification report
- Pass/fail status for each check
- Integration test results
- Recommendations for next steps

---

### 8. Check Account Status
**File:** `8.check_account_status.ts`

**Purpose:** Quick status check of all created accounts

**Features:**
- Displays status of all programs
- Shows PDA initialization status
- Lists token mint information
- Shows vault balances
- Displays user account balances (both test address and provider)
- Shows SOL balances

**Run:**
```bash
ts-node scripts/devnet/8.check_account_status.ts
# Or using npm:
npm run devnet:check-status
```

**Use case:** Quick health check of your test environment without running full tests

---

## Complete Testing Workflow

### Quick Start with NPM Scripts

```bash
# Run all tests automatically
npm run devnet:test-all

# Or step-by-step:
npm run devnet:setup-jupiter      # 1. Setup environment
npm run devnet:verify              # 2. Verify configuration
npm run devnet:test-route          # 3. Test shared route
npm run devnet:test-limit-orders   # 4. Test limit orders
npm run devnet:check-status        # 5. Check account status
```

### Step-by-step guide (using ts-node):

1. **Setup Environment**
   ```bash
   ts-node scripts/devnet/4.setup_shared_jupiter_environment.ts
   # Or: npm run devnet:setup-jupiter
   ```
   This creates all necessary accounts and saves configuration.

2. **Verify Configuration**
   ```bash
   ts-node scripts/devnet/7.verify_jupiter_mock_config.ts
   # Or: npm run devnet:verify
   ```
   This ensures everything is set up correctly and performs a test swap.

3. **Test Shared Route**
   ```bash
   ts-node scripts/devnet/5.test_shared_route_jupiter.ts
   # Or: npm run devnet:test-route
   ```
   Test the main swap functionality.

4. **Test Limit Orders**
   ```bash
   ts-node scripts/devnet/6.test_shared_limit_orders_jupiter.ts
   # Or: npm run devnet:test-limit-orders
   ```
   Test limit order creation, cancellation, and execution flow.

5. **Check Account Status**
   ```bash
   ts-node scripts/devnet/8.check_account_status.ts
   # Or: npm run devnet:check-status
   ```
   Quick health check of all accounts.

## Configuration File

After running the setup script, a configuration file is created at:
```
scripts/devnet/jupiter_test_config.json
```

This file contains all the addresses needed for testing:
- Program IDs
- PDAs (vault authority, adapter registry)
- Token mints
- Vaults
- Token accounts for test address and provider

## Test Accounts

### Test Address
**Address:** `CqN8BpNFhFZDnbLdpUaLUEHGrFymnP8TBcCfQhC8pFYA`
- Source token account created
- Destination token account created
- Funded with 1000 source tokens

### Provider (Wallet)
**Address:** Loaded from `~/.config/solana/id.json`
- Source token account created
- Destination token account created
- Funded with 1000 source tokens

## Token Details

### Source Mint
- Decimals: 6
- Initial supply: Minted to user accounts and vaults

### Destination Mint
- Decimals: 6
- Initial supply: Minted to destination vault (10,000 tokens for testing)

## Troubleshooting

### Insufficient Balance Error
```
❌ Insufficient admin balance. Need at least 3 SOL
```
**Solution:** Request airdrop:
```bash
solana airdrop 5
```

### Configuration File Not Found
```
❌ Configuration file not found!
```
**Solution:** Run the setup script first:
```bash
ts-node scripts/devnet/4.setup_shared_jupiter_environment.ts
```

### Account Already Exists Errors
These are usually not critical. The scripts handle existing accounts gracefully.

### Transaction Confirmation Timeouts
If you get timeout errors, try increasing the wait time in the scripts or check devnet status:
```bash
solana cluster-version
```

## Understanding the Tests

### Shared Route Flow
1. User approves token transfer
2. Flipper transfers input tokens from user to vault
3. Flipper calls Jupiter mock via CPI
4. Jupiter mock simulates swap
5. Output tokens transferred to user

### Limit Order Flow
1. User creates limit order with parameters
2. Input tokens locked in order vault
3. Operator monitors trigger conditions
4. When triggered, operator executes via `shared_execute_limit_order`
5. Jupiter CPI performs swap
6. Output tokens sent to user

## Notes

- All tests use the Mock Jupiter program, not the real Jupiter aggregator
- The mock simulates swap behavior for testing purposes
- Platform fees are set to 0 in these tests for simplicity
- Slippage tolerance is set to reasonable test values

## Next Steps

After successful testing on devnet:
1. Test with various input amounts
2. Test error conditions (insufficient balance, expired orders, etc.)
3. Test with platform fees enabled
4. Test multi-hop routes
5. Prepare for mainnet deployment

## Support

If you encounter issues:
1. Check Solana devnet status
2. Ensure sufficient SOL balance
3. Verify programs are deployed correctly
4. Review transaction logs for detailed errors
5. Check that Anchor.toml points to devnet

## Related Files

- Test file: `tests/07. shared_jupiter_instructions.ts`
- Program: `programs/flipper/src/instructions/shared_*_module/`
- Mock Jupiter: `programs/mock_jupiter/`

---

**Last Updated:** 2026-01-28
