# Jupiter API to Flipper Adapter Guide

This guide shows how to adapt Jupiter's `/swap-instructions` API response for use with Flipper's `shared_route` instruction.

## Overview

Jupiter's `/swap-instructions` endpoint (with `useSharedAccounts: true`) returns everything needed for a swap, but you need to adapt it for Flipper's vault-based architecture.

```
┌─────────────────────┐
│  Jupiter API        │
│  /swap-instructions │
└──────────┬──────────┘
           │
           ▼
    ┌──────────────┐
    │   Adapter    │  ← This guide
    │   Functions  │
    └──────┬───────┘
           │
           ▼
┌─────────────────────┐
│  Flipper Program    │
│  shared_route       │
└─────────────────────┘
```

## Step 1: Get Jupiter API Response

### Request Example

```typescript
import { PublicKey } from "@solana/web3.js";

// Your vault authority PDA
const [vaultAuthority] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault_authority")],
  flipperProgramId
);

// Step 1: Get quote
const quoteResponse = await fetch(
  `https://quote-api.jup.ag/v6/quote?` +
  `inputMint=${inputMint.toString()}&` +
  `outputMint=${outputMint.toString()}&` +
  `amount=${amount}&` +
  `slippageBps=50`
).then(r => r.json());

// Step 2: Get swap instructions
const swapInstructions = await fetch(
  'https://quote-api.jup.ag/v6/swap-instructions',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey: vaultAuthority.toString(), // ← Use vault authority!
      useSharedAccounts: true,                  // ← REQUIRED
      wrapAndUnwrapSol: true,
      computeUnitPriceMicroLamports: 1000
    })
  }
).then(r => r.json());
```

### Response Structure

```json
{
  "tokenLedgerInstruction": null,
  "computeBudgetInstructions": [
    {
      "programId": "ComputeBudget111111111111111111111111111111",
      "accounts": [],
      "data": "K1FqzA=="
    }
  ],
  "setupInstructions": [],
  "swapInstruction": {
    "programId": "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
    "accounts": [
      {
        "pubkey": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        "isSigner": false,
        "isWritable": false
      },
      // ... ~15-30 more accounts
    ],
    "data": "wSCbM0HWnIEABQAAAGQAAAAAAAAAAGAPAAAAAAAAMgA=" // base64
  },
  "cleanupInstruction": null,
  "otherInstructions": [],
  "addressLookupTableAddresses": [
    "D9pEt6QuP9yZMX3zRPGb7tRbZx6eVTaRCzeYUPHVqEb6"
  ]
}
```

## Step 2: Extract Required Data

### 2.1 Instruction Data (base64 → Buffer)

```typescript
/**
 * Extract and decode instruction data
 */
function extractInstructionData(swapInstructions: any): Buffer {
  const instructionDataBase64 = swapInstructions.swapInstruction.data;
  const instructionData = Buffer.from(instructionDataBase64, 'base64');
  
  console.log("Instruction data length:", instructionData.length);
  console.log("Instruction data (hex):", instructionData.toString('hex'));
  
  return instructionData;
}
```

### 2.2 Extract Amounts from Quote

```typescript
import { BN } from "@coral-xyz/anchor";

/**
 * Extract swap amounts from quote response
 */
function extractAmounts(quoteResponse: any) {
  const inAmount = new BN(quoteResponse.inAmount);
  const outAmount = new BN(quoteResponse.outAmount);
  const slippageBps = quoteResponse.slippageBps;
  
  console.log("In amount:", inAmount.toString());
  console.log("Out amount:", outAmount.toString());
  console.log("Slippage (bps):", slippageBps);
  
  return { inAmount, outAmount, slippageBps };
}
```

### 2.3 Extract and Adapt Accounts

#### Understanding Shared Accounts in Jupiter

When you use `useSharedAccounts: true`, Jupiter returns accounts in a special format for the `shared_accounts_route` instruction:

**What Jupiter Does:**
1. Takes your `userPublicKey` (vault authority in our case)
2. Derives Associated Token Accounts (ATAs) for input/output mints
3. Returns accounts array with **program accounts already included** for DEX interactions
4. Accounts at indices 4-5 are program-owned accounts for intermediate swap steps
5. All DEX-specific accounts (pools, authorities) are already in the array

**Example Jupiter Response Accounts:**
```
Index 0: Token Program
Index 1: Jupiter Program Authority (PDA)
Index 2: User Authority (your vaultAuthority)
Index 3: User Source Token Account (ATA for vaultAuthority + inputMint)
Index 4: Program Source Token Account (Jupiter's internal account for swap) ← Program account
Index 5: Program Destination Token Account (Jupiter's internal account) ← Program account
Index 6: User Destination Token Account (ATA for vaultAuthority + outputMint)
Index 7: Source Mint
Index 8: Destination Mint
Index 9+: DEX-specific accounts (pools, authorities, etc.)
```

**Why You Need to Replace Accounts:**

Even though Jupiter returns ATAs based on `vaultAuthority`, **these may not be your actual vault token accounts**:

- Jupiter derives ATAs programmatically: `getAssociatedTokenAddress(mint, vaultAuthority)`
- Your vault token accounts might be:
  - Custom PDAs (not standard ATAs)
  - Pre-existing accounts created separately
  - Using different seeds or derivation

**What to Keep vs Replace:**

✅ **Keep as-is (from Jupiter):**
- Index 0: Token Program
- Index 1: Jupiter Program Authority
- Index 2: Vault Authority (already correct)
- Index 4-5: Program accounts (Jupiter manages these) ← **These are already program accounts!**
- Index 7-8: Mints
- Index 9+: DEX accounts (pools, authorities)

❌ **Replace with your actual accounts:**
- Index 3: User Source → Your actual `sourceVault`
- Index 6: User Destination → Your actual `destinationVault`

**Critical**: Indices 4 and 5 are already **program-owned accounts** managed by Jupiter. You don't touch these - Jupiter handles them internally for the swap routing.

#### Visual Account Flow

```
Jupiter API Response                    Adapter Action              Flipper Execution
═══════════════════                    ═══════════════             ═════════════════

[0] Token Program          ────────────► Keep as-is ────────────► [0] Token Program
[1] Jupiter PDA            ────────────► Keep as-is ────────────► [1] Jupiter PDA
[2] Vault Authority        ────────────► Keep as-is ────────────► [2] Vault Authority (signer)
[3] ATA(vault+input)       ──────┐                    
                                  │      Replace!
                                  └────► sourceVault ──────────► [3] Your Source Vault
[4] Jupiter Program Account ────────────► Keep as-is ────────────► [4] Jupiter manages
[5] Jupiter Program Account ────────────► Keep as-is ────────────► [5] Jupiter manages
[6] ATA(vault+output)      ──────┐
                                  │      Replace!
                                  └────► destinationVault ──────► [6] Your Dest Vault
[7] Source Mint            ────────────► Keep as-is ────────────► [7] Source Mint
[8] Destination Mint       ────────────► Keep as-is ────────────► [8] Dest Mint
[9+] DEX accounts          ────────────► Keep as-is ────────────► [9+] Pool, authorities, etc.

                                        Only Replace User Accounts!
                                        Program Accounts = Unchanged
```

#### Code Implementation

```typescript
/**
 * Map Jupiter account indices to Flipper requirements
 */
const JUPITER_ACCOUNT_INDICES = {
  TOKEN_PROGRAM: 0,           // Token Program
  JUPITER_PROGRAM_PDA: 1,     // Jupiter's PDA
  USER_AUTHORITY: 2,          // Vault authority (correct from API)
  USER_SOURCE: 3,             // ← Replace with vault source
  PROGRAM_SOURCE: 4,          // Usually same as index 3
  PROGRAM_DESTINATION: 5,     // Usually same as index 6
  USER_DESTINATION: 6,        // ← Replace with vault destination
  SOURCE_MINT: 7,             // Source mint
  DESTINATION_MINT: 8,        // Destination mint
  // ... rest are DEX-specific accounts
};

/**
 * Replace token accounts in Jupiter response
 */
function replaceTokenAccounts(
  jupiterAccounts: Array<{pubkey: string, isSigner: boolean, isWritable: boolean}>,
  vaultAuthority: PublicKey,
  sourceVault: PublicKey,
  destinationVault: PublicKey
): Array<{pubkey: PublicKey, isSigner: boolean, isWritable: boolean}> {
  
  return jupiterAccounts.map((acc, index) => {
    let pubkey = new PublicKey(acc.pubkey);
    
    // Replace specific indices with vault accounts
    switch (index) {
      case JUPITER_ACCOUNT_INDICES.USER_AUTHORITY:
        // Should already be vaultAuthority from API, but verify
        if (!pubkey.equals(vaultAuthority)) {
          console.warn(`Warning: Index ${index} expected ${vaultAuthority.toString()}, got ${pubkey.toString()}`);
          pubkey = vaultAuthority;
        }
        console.log(`[${index}] Vault Authority: ${pubkey.toString()}`);
        break;
        
      case JUPITER_ACCOUNT_INDICES.USER_SOURCE:
        console.log(`[${index}] Source (replacing): ${acc.pubkey} → ${sourceVault.toString()}`);
        pubkey = sourceVault;
        break;
        
      case JUPITER_ACCOUNT_INDICES.PROGRAM_SOURCE:
        // IMPORTANT: This is Jupiter's program account - DON'T replace!
        // Jupiter manages this internally for routing
        console.log(`[${index}] Program Source (Jupiter managed): ${pubkey.toString()}`);
        // Keep as-is from Jupiter
        break;
        
      case JUPITER_ACCOUNT_INDICES.PROGRAM_DESTINATION:
        // IMPORTANT: This is Jupiter's program account - DON'T replace!
        // Jupiter manages this internally for routing
        console.log(`[${index}] Program Destination (Jupiter managed): ${pubkey.toString()}`);
        // Keep as-is from Jupiter
        break;
        
      case JUPITER_ACCOUNT_INDICES.USER_DESTINATION:
        console.log(`[${index}] Destination (replacing): ${acc.pubkey} → ${destinationVault.toString()}`);
        pubkey = destinationVault;
        break;
        
      default:
        console.log(`[${index}] Keep as-is: ${pubkey.toString()} (${acc.isSigner ? 'signer' : 'read-only'})`);
    }
    
    return {
      pubkey,
      isSigner: acc.isSigner,
      isWritable: acc.isWritable
    };
  });
}
```

## Step 3: Build Flipper Instruction

### 3.1 Get Required Accounts

```typescript
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { SystemProgram } from "@solana/web3.js";

/**
 * Prepare all accounts needed for Flipper's shared_route
 */
async function prepareFlipperAccounts(
  connection: Connection,
  flipperProgramId: PublicKey,
  wallet: PublicKey,
  sourceVault: PublicKey,
  destinationVault: PublicKey
) {
  // 1. Vault authority PDA
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority")],
    flipperProgramId
  );
  
  // 2. Platform fee account
  const [platformFeeAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("platform_fee")],
    flipperProgramId
  );
  
  // 3. Get mints from vault token accounts
  const sourceMint = await getMintFromTokenAccount(connection, sourceVault);
  const destinationMint = await getMintFromTokenAccount(connection, destinationVault);
  
  // 4. User's destination token account (for receiving output)
  const userDestinationTokenAccount = getAssociatedTokenAddressSync(
    destinationMint,
    wallet
  );
  
  return {
    vaultAuthority,
    platformFeeAccount,
    sourceMint,
    destinationMint,
    userDestinationTokenAccount
  };
}

/**
 * Helper: Get mint from token account
 */
async function getMintFromTokenAccount(
  connection: Connection,
  tokenAccount: PublicKey
): Promise<PublicKey> {
  const accountInfo = await connection.getAccountInfo(tokenAccount);
  if (!accountInfo) {
    throw new Error(`Token account not found: ${tokenAccount.toString()}`);
  }
  
  // Mint is at bytes 0-32 in token account data
  const mintPubkey = new PublicKey(accountInfo.data.slice(0, 32));
  return mintPubkey;
}
```

### 3.2 Build and Execute Transaction

```typescript
import { Program } from "@coral-xyz/anchor";

/**
 * Complete adapter function: Jupiter API → Flipper execution
 */
async function executeFlipperSwapFromJupiterAPI(
  connection: Connection,
  flipperProgram: Program,
  wallet: Keypair,
  // Jupiter API responses
  quoteResponse: any,
  swapInstructions: any,
  // Vault accounts
  sourceVault: PublicKey,
  destinationVault: PublicKey
) {
  console.log("🔄 Adapting Jupiter response for Flipper...\n");
  
  // Step 1: Extract instruction data
  const instructionData = extractInstructionData(swapInstructions);
  
  // Step 2: Extract amounts
  const { inAmount, outAmount, slippageBps } = extractAmounts(quoteResponse);
  
  // Step 3: Prepare Flipper accounts
  const accounts = await prepareFlipperAccounts(
    connection,
    flipperProgram.programId,
    wallet.publicKey,
    sourceVault,
    destinationVault
  );
  
  console.log("✅ Prepared accounts:");
  console.log("   Vault authority:", accounts.vaultAuthority.toString());
  console.log("   Source vault:", sourceVault.toString());
  console.log("   Destination vault:", destinationVault.toString());
  console.log("   User destination:", accounts.userDestinationTokenAccount.toString());
  console.log("");
  
  // Step 4: Replace token accounts in Jupiter's accounts array
  const adaptedAccounts = replaceTokenAccounts(
    swapInstructions.swapInstruction.accounts,
    accounts.vaultAuthority,
    sourceVault,
    destinationVault
  );
  
  console.log(`✅ Adapted ${adaptedAccounts.length} accounts\n`);
  
  // Step 5: Build remaining accounts for Flipper
  const remainingAccounts = adaptedAccounts.map(acc => ({
    pubkey: acc.pubkey,
    isSigner: acc.isSigner,
    isWritable: acc.isWritable
  }));
  
  // Step 6: Execute Flipper's shared_route instruction
  console.log("🚀 Executing Flipper swap...");
  
  const tx = await flipperProgram.methods
    .sharedRoute(
      inAmount,
      outAmount,
      slippageBps,
      0, // platformFeeBps
      instructionData
    )
    .accounts({
      vaultAuthority: accounts.vaultAuthority,
      userSourceTokenAccount: sourceVault,
      userDestinationTokenAccount: accounts.userDestinationTokenAccount,
      vaultSource: sourceVault,
      vaultDestination: destinationVault,
      sourceMint: accounts.sourceMint,
      destinationMint: accounts.destinationMint,
      inputTokenProgram: TOKEN_PROGRAM_ID,
      outputTokenProgram: TOKEN_PROGRAM_ID,
      userTransferAuthority: wallet.publicKey,
      platformFeeAccount: accounts.platformFeeAccount,
      jupiterProgram: new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"),
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(remainingAccounts)
    .signers([wallet])
    .rpc();
  
  console.log("✅ Swap executed successfully!");
  console.log("   Transaction:", tx);
  
  return tx;
}
```

## Step 4: Complete Working Example

### Full Integration Script

```typescript
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet, BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

/**
 * Main function: Complete Jupiter → Flipper flow
 */
async function main() {
  // Setup
  const connection = new Connection("https://api.mainnet-beta.solana.com");
  const wallet = Keypair.fromSecretKey(/* your keypair */);
  const provider = new AnchorProvider(connection, new Wallet(wallet), {});
  
  const flipperProgramId = new PublicKey("YOUR_FLIPPER_PROGRAM_ID");
  const flipperProgram = new Program(/* your IDL */, flipperProgramId, provider);
  
  // Your vault token accounts
  const sourceVault = new PublicKey("YOUR_SOURCE_VAULT");
  const destinationVault = new PublicKey("YOUR_DESTINATION_VAULT");
  
  // Token mints
  const inputMint = new PublicKey("So11111111111111111111111111111111111111112"); // SOL
  const outputMint = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"); // USDC
  const amount = 1_000_000; // 1 SOL (9 decimals)
  
  console.log("=== Jupiter → Flipper Adapter ===\n");
  
  // Derive vault authority
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority")],
    flipperProgramId
  );
  
  console.log("1️⃣ Getting quote from Jupiter API...");
  const quoteResponse = await fetch(
    `https://quote-api.jup.ag/v6/quote?` +
    `inputMint=${inputMint.toString()}&` +
    `outputMint=${outputMint.toString()}&` +
    `amount=${amount}&` +
    `slippageBps=50`
  ).then(r => r.json());
  
  console.log(`   ✅ Quote: ${quoteResponse.inAmount} → ${quoteResponse.outAmount}`);
  console.log(`   Route: ${quoteResponse.routePlan.length} step(s)\n`);
  
  console.log("2️⃣ Getting swap instructions with vault authority...");
  const swapInstructions = await fetch(
    'https://quote-api.jup.ag/v6/swap-instructions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey: vaultAuthority.toString(),
        useSharedAccounts: true,
        wrapAndUnwrapSol: true,
        computeUnitPriceMicroLamports: 1000
      })
    }
  ).then(r => r.json());
  
  console.log(`   ✅ Got ${swapInstructions.swapInstruction.accounts.length} accounts`);
  console.log(`   Instruction data length: ${Buffer.from(swapInstructions.swapInstruction.data, 'base64').length} bytes\n`);
  
  console.log("3️⃣ Adapting and executing via Flipper...");
  const signature = await executeFlipperSwapFromJupiterAPI(
    connection,
    flipperProgram,
    wallet,
    quoteResponse,
    swapInstructions,
    sourceVault,
    destinationVault
  );
  
  console.log("\n✅ Complete!");
  console.log(`   Explorer: https://solscan.io/tx/${signature}`);
}

main().catch(console.error);
```

## Step 5: Verification and Testing

### Check Balances Before/After

```typescript
async function verifySwap(
  connection: Connection,
  sourceVault: PublicKey,
  destinationVault: PublicKey,
  userDestination: PublicKey,
  expectedInAmount: BN,
  expectedMinOutAmount: BN
) {
  // Get balances before
  const sourceBalanceBefore = await connection.getTokenAccountBalance(sourceVault);
  const destBalanceBefore = await connection.getTokenAccountBalance(destinationVault);
  const userDestBalanceBefore = await connection.getTokenAccountBalance(userDestination);
  
  console.log("Before swap:");
  console.log("  Source vault:", sourceBalanceBefore.value.uiAmount);
  console.log("  Dest vault:", destBalanceBefore.value.uiAmount);
  console.log("  User dest:", userDestBalanceBefore.value.uiAmount);
  
  // ... execute swap ...
  
  // Get balances after
  const sourceBalanceAfter = await connection.getTokenAccountBalance(sourceVault);
  const destBalanceAfter = await connection.getTokenAccountBalance(destinationVault);
  const userDestBalanceAfter = await connection.getTokenAccountBalance(userDestination);
  
  console.log("\nAfter swap:");
  console.log("  Source vault:", sourceBalanceAfter.value.uiAmount);
  console.log("  Dest vault:", destBalanceAfter.value.uiAmount);
  console.log("  User dest:", userDestBalanceAfter.value.uiAmount);
  
  // Verify changes
  const sourceChange = new BN(sourceBalanceBefore.value.amount).sub(
    new BN(sourceBalanceAfter.value.amount)
  );
  const userDestChange = new BN(userDestBalanceAfter.value.amount).sub(
    new BN(userDestBalanceBefore.value.amount)
  );
  
  console.log("\nChanges:");
  console.log("  Source deducted:", sourceChange.toString());
  console.log("  User received:", userDestChange.toString());
  
  // Assertions
  if (!sourceChange.eq(expectedInAmount)) {
    throw new Error(`Source change mismatch: expected ${expectedInAmount.toString()}, got ${sourceChange.toString()}`);
  }
  
  if (userDestChange.lt(expectedMinOutAmount)) {
    throw new Error(`Output too low: expected at least ${expectedMinOutAmount.toString()}, got ${userDestChange.toString()}`);
  }
  
  console.log("\n✅ Verification passed!");
}
```

### Debug Account Mapping

```typescript
/**
 * Debug helper: Print account mapping comparison
 */
function debugAccountMapping(
  jupiterAccounts: Array<{pubkey: string, isSigner: boolean, isWritable: boolean}>,
  adaptedAccounts: Array<{pubkey: PublicKey, isSigner: boolean, isWritable: boolean}>
) {
  console.log("\n=== Account Mapping Debug ===");
  console.log("Index | Jupiter Account                               | Adapted Account                               | Changed?");
  console.log("------|-----------------------------------------------|-----------------------------------------------|----------");
  
  for (let i = 0; i < Math.max(jupiterAccounts.length, adaptedAccounts.length); i++) {
    const jupAcc = jupiterAccounts[i];
    const adaptedAcc = adaptedAccounts[i];
    
    if (jupAcc && adaptedAcc) {
      const changed = jupAcc.pubkey !== adaptedAcc.pubkey.toString();
      const marker = changed ? "✓ REPLACED" : "";
      console.log(
        `${i.toString().padStart(5)} | ${jupAcc.pubkey.slice(0, 44)} | ${adaptedAcc.pubkey.toString().slice(0, 44)} | ${marker}`
      );
    }
  }
  console.log("========================================\n");
}
```

## Common Issues and Solutions

### Issue 1: Account Mismatch

**Error**: `Program log: AnchorError occurred. Error Code: ConstraintTokenOwner`

**Cause**: Token account owner doesn't match vault authority

**Solution**: 
```typescript
// Verify vault token accounts are owned by vault authority
const sourceVaultInfo = await connection.getParsedAccountInfo(sourceVault);
const owner = sourceVaultInfo.value.data.parsed.info.owner;

if (owner !== vaultAuthority.toString()) {
  throw new Error(`Source vault owner mismatch: expected ${vaultAuthority.toString()}, got ${owner}`);
}
```

### Issue 2: Insufficient Balance

**Error**: `Program log: Error: insufficient funds`

**Cause**: Source vault doesn't have enough tokens

**Solution**:
```typescript
// Check balance before swap
const balance = await connection.getTokenAccountBalance(sourceVault);
const balanceBN = new BN(balance.value.amount);

if (balanceBN.lt(inAmount)) {
  throw new Error(`Insufficient balance: have ${balanceBN.toString()}, need ${inAmount.toString()}`);
}
```

### Issue 3: Wrong Account Indices

**Error**: `Program log: AnchorError: InvalidAccountData`

**Cause**: Account indices don't match Jupiter's expected structure

**Solution**:
```typescript
// Log all accounts before executing
console.log("Remaining accounts:");
remainingAccounts.forEach((acc, idx) => {
  console.log(`  [${idx}] ${acc.pubkey.toString()}`);
  console.log(`       signer: ${acc.isSigner}, writable: ${acc.isWritable}`);
});
```

## Testing Strategy

### 1. Test with Mock on Devnet

First, verify your adapter logic with mock Jupiter:

```bash
# Use mock Jupiter on devnet
anchor test --skip-build
```

### 2. Test with Real Jupiter on Devnet

If Jupiter supports devnet tokens, test with small amounts:

```typescript
const amount = 0.01 * 10**9; // 0.01 SOL
```

### 3. Test on Mainnet Fork

Use Solana mainnet fork for final testing:

```bash
solana-test-validator --clone-address JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 --url https://api.mainnet-beta.solana.com
```

### 4. Production Deployment

Start with small amounts and gradually increase:

```typescript
// Start small
const testAmount = 0.1 * 10**9; // 0.1 SOL

// Monitor first few swaps
const signature = await executeFlipperSwapFromJupiterAPI(/* ... */);
await confirmTransaction(connection, signature);
await verifySwap(/* ... */);
```

## Summary

**Key Steps:**
1. ✅ Call Jupiter API with `vaultAuthority` as `userPublicKey`
2. ✅ Set `useSharedAccounts: true` in request
3. ✅ Extract instruction data (base64 → Buffer)
4. ✅ Replace token accounts at indices 3 and 6 with vault accounts
5. ✅ Pass adapted accounts to Flipper's `shared_route`
6. ✅ Verify balances before/after

**Critical Points:**
- Always use `vaultAuthority` PDA, not user wallet
- Replace token accounts (indices 3, 6) with vault token accounts
- Keep other accounts from Jupiter response as-is
- Test thoroughly before production

**Resources:**
- Jupiter API Docs: https://station.jup.ag/docs/apis/swap-api
- Flipper Program: See `programs/flipper/src/instructions/shared_route_module/`
- Tests: See `tests/07. shared_jupiter_instructions.ts`
