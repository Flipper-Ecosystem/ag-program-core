# Flipper Shared Route - Mainnet Guide

Complete guide for executing swaps through Flipper's `shared_route` instruction with Jupiter integration on Solana mainnet.

## Prerequisites

### 1. Node.js Version
```bash
# Install Node.js 18 or higher
nvm install 18
nvm use 18
```

### 2. Solana Wallet
You need a Solana wallet with:
- Minimum **0.015 SOL** (0.01 for swap + network fees)
- Wallet keypair file location: `~/.config/solana/id.json`

Check your balance:
```bash
solana balance
```

If you need to use a different wallet:
```bash
solana config set --keypair /path/to/your/wallet.json
```

### 3. Install Dependencies
```bash
npm install
```

## Quick Start

### Step 1: Check Setup

Verify your Flipper setup on mainnet:

```bash
npm run mainnet:check-shared-route
```

**Expected output:**
```
✅ Adapter Registry exists and is valid
✅ WSOL account: [your_address]
✅ USDC account: [your_address]
✅ Vault accounts created
```

### Step 2: Wrap SOL (Optional)

If you don't have enough wrapped SOL (WSOL):

```bash
npm run mainnet:check-shared-route -- --wrap
```

This wraps 0.01 SOL to WSOL for testing.

### Step 3: Execute Swap

Run the shared route swap:

```bash
npm run mainnet:test-shared-route
```

**What happens:**
1. Fetches quote from Jupiter API
2. Creates/verifies token accounts
3. Wraps SOL to WSOL if needed
4. Executes swap via `shared_route` instruction
5. Displays transaction results

## Swap Parameters

Default configuration in `test_shared_route_jupiter.ts`:

```typescript
const inputAmount = 10_000_000;      // 0.01 SOL (9 decimals)
const slippageBps = 50;              // 0.5% slippage
const platformFeeBps = 0;            // 0% platform fee
```

### Customize Swap Amount

Edit the script to change swap parameters:

```typescript
// Example: Swap 0.1 SOL instead of 0.01
const inputAmount = 100_000_000;  // 0.1 SOL
```

### Change Token Pair

Currently configured for **SOL → USDC**. To swap different tokens:

```typescript
const INPUT_MINT = new PublicKey("YourInputTokenMint");
const OUTPUT_MINT = new PublicKey("YourOutputTokenMint");
```

## Understanding the Flow

### 1. Quote Fetching
```
User → Jupiter API → Get best route and price
```

### 2. Transaction Execution
```
1. Transfer WSOL from user to source vault
2. Flipper calls Jupiter via CPI
3. Jupiter executes optimal swap route
4. Transfer output tokens to user
5. Update balances
```

### 3. Accounts Structure
```
User Accounts:
├── WSOL Token Account (input)
└── USDC Token Account (output)

Vault Accounts (PDA-owned):
├── Source Vault (WSOL)
├── Destination Vault (USDC)
└── Platform Fee Account (USDC)
```

## Configuration Details

### RPC Endpoint

Default: `https://api.mainnet-beta.solana.com`

For better performance, use a custom RPC:

```bash
export RPC_URL="https://your-rpc-endpoint.com"
npm run mainnet:test-shared-route
```

Recommended RPC providers:
- [Helius](https://helius.dev/)
- [QuickNode](https://www.quicknode.com/)
- [Alchemy](https://www.alchemy.com/)

### Wallet Configuration

The scripts automatically load your wallet from:
1. `~/.config/solana/id.json` (default)

To use a different wallet, modify this line in the scripts:

```typescript
const loadKeypair = (): Keypair => {
    const keypairPath = process.env.HOME + "/.config/solana/YOUR_WALLET.json";
    // ...
}
```

## Troubleshooting

### Insufficient Balance

**Error:** `Insufficient SOL balance`

**Solution:**
```bash
# Check balance
solana balance

# Request airdrop on devnet (not mainnet)
solana airdrop 1

# Or transfer SOL to your wallet
```

### Node Version Error

**Error:** `SyntaxError: Unexpected token '?'`

**Solution:**
```bash
node --version  # Should be 18.x or higher
nvm use 18
```

### Jupiter API Error

**Error:** `fetch failed` or `ENOTFOUND`

**Solution:** The script uses `https://public.jupiterapi.com` which is currently working. If you encounter issues:

1. Check internet connection
2. Verify DNS resolution: `nslookup public.jupiterapi.com`
3. Try with VPN if behind firewall

### Transaction Failed

**Check transaction logs:**

The error output includes transaction logs. Common issues:

1. **Slippage too low** - Increase `slippageBps`:
   ```typescript
   const slippageBps = 100; // 1% slippage
   ```

2. **Insufficient pool liquidity** - Try smaller amounts

3. **Invalid account** - Run setup check:
   ```bash
   npm run mainnet:check-shared-route
   ```

## Advanced Usage

### Using Address Lookup Tables (ALT)

For complex swaps with many accounts, ALTs reduce transaction size:

```typescript
const addressLookupTables: PublicKey[] = [
    new PublicKey("YourALTAddress"),
];
```

The script automatically uses ALTs provided by Jupiter.

### Monitoring Transactions

View your transaction on Solscan:
```
https://solscan.io/tx/YOUR_SIGNATURE
```

Or use Solana Explorer:
```
https://explorer.solana.com/tx/YOUR_SIGNATURE
```

### Multiple Swaps

Execute multiple swaps in sequence:

```bash
# Swap 1
npm run mainnet:test-shared-route

# Check balance
npm run mainnet:check-shared-route

# Swap 2
npm run mainnet:test-shared-route
```

## Example Output

Successful swap output:

```
============================================================
🚀 Testing shared_route with Jupiter on Mainnet
============================================================

📡 Fetching Jupiter quote...
✅ Quote received
   Input: 10000000 (0.01 SOL)
   Output: 915000 (0.915 USDC)
   Route: Raydium

⚡ Executing shared_route instruction...
✅ Transaction signature: 3TAEfXc2TYUxzzaTrgWmUaF78Bpj8bXVqqnecFDEQwFUAqobQ88JWzzN7DVPhn7p66d7GZkiFjsiw5w2roLDuYkq
   Explorer: https://solscan.io/tx/3TAEfXc2...

📈 Balance changes:
   WSOL spent: 10000000 lamports
   USDC received: 915000 micro-USDC
   Exchange rate: 1 SOL ≈ 91.50 USDC

✅ SHARED_ROUTE TEST COMPLETED SUCCESSFULLY!
```

## Architecture

### Program Structure
```
Flipper Program (fLpRcgQSJxKeeUogb6M7bWe1iyYQbahjGXGwr4HgHit)
├── shared_route instruction
│   ├── Validates inputs
│   ├── Transfers tokens to vault
│   ├── Calls Jupiter via CPI
│   └── Transfers output tokens to user
└── PDAs
    ├── vault_authority (manages vaults)
    └── adapter_registry (manages adapters)
```

### Jupiter Integration
```
Jupiter V6 (JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4)
├── Quote API: Get optimal route
├── Swap Instructions API: Get transaction data
└── On-chain program: Execute swap
```

## Security Notes

### ⚠️ Important
- This executes **real transactions** on Solana mainnet
- Real SOL and tokens are transferred
- Always test with **small amounts** first
- Transaction fees apply (~0.00001-0.0001 SOL)

### Best Practices
1. Start with minimum amounts (0.01 SOL)
2. Verify transaction on explorer
3. Check balances before and after
4. Use appropriate slippage tolerance
5. Monitor for frontrunning on large swaps

## Files Overview

### Scripts
- `check_shared_route_setup.ts` - Verify setup and balances
- `test_shared_route_jupiter.ts` - Execute swap with Jupiter

### Documentation
- `MAINNET_SHARED_ROUTE_GUIDE.md` - This file (general guide)
- `README_JUPITER_SHARED_ROUTE.md` - Technical details
- `QUICK_START_SHARED_ROUTE.md` - Quick reference

### Configuration
- `.nvmrc` - Node.js version specification
- `package.json` - NPM scripts and dependencies

## Available Commands

```bash
# Check setup and balances
npm run mainnet:check-shared-route

# Wrap SOL to WSOL
npm run mainnet:check-shared-route -- --wrap

# Execute swap
npm run mainnet:test-shared-route

# Check global manager
npm run mainnet:check-manager
```

## Network Fees

Typical costs per transaction:

| Operation | Cost (SOL) |
|-----------|------------|
| Check setup | ~0.000005 |
| Wrap SOL | ~0.00001 |
| Swap transaction | ~0.00005 |
| Create token account | ~0.00203 |

**Total first-time cost:** ~0.002-0.003 SOL  
**Subsequent swaps:** ~0.00005 SOL

## Support Resources

- [Flipper Documentation](../../README.md)
- [Jupiter Adapter Guide](../../JUPITER_TO_FLIPPER_ADAPTER.md)
- [Solana Documentation](https://docs.solana.com/)
- [Jupiter Documentation](https://station.jup.ag/docs/)

## FAQ

### Q: Can I swap tokens other than SOL/USDC?
**A:** Yes, modify the mint addresses in the script. Ensure both tokens have sufficient liquidity on Jupiter.

### Q: What's the minimum swap amount?
**A:** Technically no minimum, but very small amounts may fail due to insufficient output after fees. Recommended minimum: 0.001 SOL.

### Q: How does Jupiter choose the route?
**A:** Jupiter's aggregator analyzes all available DEXs and finds the best price considering liquidity, fees, and slippage.

### Q: Can I cancel a pending transaction?
**A:** No, Solana transactions are atomic. They either complete or fail. If stuck, it will timeout after ~60 seconds.

### Q: Are there any limits?
**A:** Limits depend on:
- Pool liquidity (larger swaps may have higher slippage)
- Your wallet balance
- Transaction size (1232 bytes max, ALTs help reduce size)

## Next Steps

After successful testing:

1. **Integrate into your application**
   - Import the swap logic
   - Add error handling
   - Implement retry mechanisms

2. **Add monitoring**
   - Track transaction success rates
   - Monitor gas costs
   - Alert on failures

3. **Optimize parameters**
   - Adjust slippage for your use case
   - Fine-tune for different market conditions
   - Consider platform fees

4. **Scale up**
   - Test with production amounts
   - Implement rate limiting
   - Add logging and metrics

---

**Version:** 1.0  
**Last Updated:** 2026-02-05  
**Tested With:** Node.js 18.20.8, Solana 1.18.x

For issues or questions, check the troubleshooting section or review transaction logs on Solscan.
