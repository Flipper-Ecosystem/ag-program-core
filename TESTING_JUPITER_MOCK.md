# Testing Jupiter Integration with Mock on Devnet

This guide explains how to test Jupiter swap integration using the mock Jupiter program on devnet. When you receive a response from Jupiter API, you need to adapt it to work with the mock program.

## Overview

The Flipper program integrates with Jupiter aggregator using the `shared_accounts_route` pattern. For devnet testing, we use a mock Jupiter program that simulates the same CPI interface.

## Architecture

```
┌─────────────────┐
│   Your Client   │
│   (TypeScript)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐         CPI          ┌──────────────────┐
│     Flipper     ├──────────────────────►│  Mock Jupiter    │
│     Program     │                       │     Program      │
└─────────────────┘                       └──────────────────┘
```

## Step 1: Get Jupiter API Response

There are two approaches to get swap data from Jupiter API:

### Method A: Quote API (Simple)

First, query the Jupiter API to get swap route data:

```bash
curl -X GET "https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000&slippageBps=50"
```

**Example Response:**
```json
{
  "inputMint": "So11111111111111111111111111111111111111112",
  "inAmount": "1000000",
  "outputMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "outAmount": "150000",
  "otherAmountThreshold": "148500",
  "swapMode": "ExactIn",
  "slippageBps": 50,
  "platformFee": null,
  "priceImpactPct": "0.01",
  "routePlan": [
    {
      "swapInfo": {
        "ammKey": "HJPjoWUrhoZzkNfRpHuieeFk9WcZWjwy6PBjZ81ngndJ",
        "label": "Raydium",
        "inputMint": "So11111111111111111111111111111111111111112",
        "outputMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        "inAmount": "1000000",
        "outAmount": "150000",
        "feeAmount": "25",
        "feeMint": "So11111111111111111111111111111111111111112"
      },
      "percent": 100
    }
  ],
  "contextSlot": 245678901,
  "timeTaken": 0.123
}
```

### Method B: Swap Instructions API (Advanced - with useSharedAccounts)

For production use with `shared_accounts_route`, use the `/swap-instructions` endpoint:

**Step 1: Get Quote**
```bash
curl -X GET "https://quote-api.jup.ag/v6/quote?\
inputMint=So11111111111111111111111111111111111111112&\
outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&\
amount=1000000&\
slippageBps=50"
```

**Step 2: Get Swap Instructions with Shared Accounts**
```bash
curl -X POST "https://quote-api.jup.ag/v6/swap-instructions" \
  -H "Content-Type: application/json" \
  -d '{
    "quoteResponse": {/* paste quote response here */},
    "userPublicKey": "YourWalletPublicKey",
    "useSharedAccounts": true,
    "wrapAndUnwrapSol": true,
    "computeUnitPriceMicroLamports": 1000
  }'
```

**Example Swap Instructions Response:**
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
      {
        "pubkey": "D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf",
        "isSigner": false,
        "isWritable": false
      },
      {
        "pubkey": "YourWalletPublicKey",
        "isSigner": true,
        "isWritable": false
      },
      // ... more accounts (typically 15+ accounts for shared_accounts_route)
    ],
    "data": "wSCbM0HWnIEABQAAAGQAAAAAAAAAAGAPAAAAAAAAMgA="
  },
  "cleanupInstruction": null,
  "otherInstructions": [],
  "addressLookupTableAddresses": [
    "D9pEt6QuP9yZMX3zRPGb7tRbZx6eVTaRCzeYUPHVqEb6",
    "5Z66YYYaTmmx1R4mATAGLSc8aV4Vfy5tNdJQzk1GP9RF"
  ]
}
```

**Step 3: Extract Data for Mock Adaptation**

From the `swapInstruction`, you need:
- `data` field: This is the base64-encoded instruction data for `shared_accounts_route`
- `accounts` array: List of all accounts required for the swap

```typescript
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

/**
 * Extract and decode Jupiter swap instruction data
 */
async function adaptJupiterSwapInstructionsForMock(
  swapInstructionsResponse: any,
  quoteResponse: any
) {
  const swapInstruction = swapInstructionsResponse.swapInstruction;
  
  // 1. Decode the instruction data (base64)
  const instructionData = Buffer.from(swapInstruction.data, 'base64');
  
  console.log("Jupiter instruction data (base64):", swapInstruction.data);
  console.log("Jupiter instruction data (hex):", instructionData.toString('hex'));
  console.log("Jupiter instruction data length:", instructionData.length);
  
  // 2. Extract discriminator (first 8 bytes)
  const discriminator = instructionData.slice(0, 8);
  console.log("Discriminator:", discriminator.toString('hex'));
  
  // 3. The rest is the serialized arguments
  // For mock, we'll rebuild this data using our encoder
  
  // 4. Extract route plan from quote
  const routePlan = quoteResponse.routePlan.map((step: any, index: number) => ({
    swap: getSwapVariant(step.swapInfo.label),
    percent: step.percent,
    inputIndex: index,
    outputIndex: index + 1
  }));
  
  // 5. Build mock instruction data
  const mockInstructionData = buildJupiterCpiInstructionData(
    mockJupiterProgram,
    0, // id
    routePlan,
    new BN(quoteResponse.inAmount),
    new BN(quoteResponse.outAmount),
    quoteResponse.slippageBps,
    0 // platformFeeBps
  );
  
  return {
    originalData: instructionData,
    mockData: mockInstructionData,
    accounts: swapInstruction.accounts,
    routePlan,
    inAmount: new BN(quoteResponse.inAmount),
    outAmount: new BN(quoteResponse.outAmount),
    slippageBps: quoteResponse.slippageBps
  };
}

/**
 * Complete example: From Jupiter API to Mock execution
 */
async function executeJupiterSwapFromAPI(
  userPublicKey: PublicKey,
  inputMint: PublicKey,
  outputMint: PublicKey,
  amount: number
) {
  // 1. Get quote
  const quoteResponse = await fetch(
    `https://quote-api.jup.ag/v6/quote?` +
    `inputMint=${inputMint.toString()}&` +
    `outputMint=${outputMint.toString()}&` +
    `amount=${amount}&` +
    `slippageBps=50`
  ).then(r => r.json());
  
  console.log("✅ Got quote:", quoteResponse.outAmount, "output tokens");
  
  // 2. Get swap instructions with shared accounts
  const swapInstructionsResponse = await fetch(
    'https://quote-api.jup.ag/v6/swap-instructions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey: userPublicKey.toString(),
        useSharedAccounts: true, // ← IMPORTANT: Use shared_accounts_route
        wrapAndUnwrapSol: true,
        computeUnitPriceMicroLamports: 1000
      })
    }
  ).then(r => r.json());
  
  console.log("✅ Got swap instructions");
  console.log("   Accounts count:", swapInstructionsResponse.swapInstruction.accounts.length);
  console.log("   Instruction data (base64):", swapInstructionsResponse.swapInstruction.data);
  
  // 3. Adapt for mock
  const adaptedData = await adaptJupiterSwapInstructionsForMock(
    swapInstructionsResponse,
    quoteResponse
  );
  
  console.log("✅ Adapted for mock:");
  console.log("   Route plan steps:", adaptedData.routePlan.length);
  console.log("   Mock data length:", adaptedData.mockData.length);
  
  // 4. Build remaining accounts for mock
  // NOTE: For mock, we use simplified accounts, not the full Jupiter accounts
  const remainingAccounts = buildJupiterRemainingAccounts({
    tokenProgram: TOKEN_PROGRAM_ID,
    jupiterProgramAuthority: mockJupiterProgram.programId,
    vaultAuthority,
    vaultSource: sourceVault,
    vaultDestination: destinationVault,
    sourceMint: inputMint,
    destinationMint: outputMint,
    platformFeeOrPlaceholder: SystemProgram.programId,
    token2022OrPlaceholder: SystemProgram.programId,
    eventAuthority: new PublicKey("D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf"),
    jupiterProgram: mockJupiterProgram.programId,
    mockPool,
    mockPoolAuthority
  });
  
  // 5. Execute swap via Flipper's shared_route
  const tx = await flipperProgram.methods
    .sharedRoute(
      adaptedData.inAmount,
      adaptedData.outAmount,
      adaptedData.slippageBps,
      0, // platformFeeBps
      adaptedData.mockData
    )
    .accounts({
      vaultAuthority,
      userSourceTokenAccount,
      userDestinationTokenAccount,
      vaultSource: sourceVault,
      vaultDestination: destinationVault,
      sourceMint: inputMint,
      destinationMint: outputMint,
      inputTokenProgram: TOKEN_PROGRAM_ID,
      outputTokenProgram: TOKEN_PROGRAM_ID,
      userTransferAuthority: userPublicKey,
      platformFeeAccount,
      jupiterProgram: mockJupiterProgram.programId,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(remainingAccounts)
    .signers([wallet.payer])
    .rpc();
  
  console.log("✅ Swap executed:", tx);
  return tx;
}
```

### Using Vault Authority and Vault Token Accounts

**Important**: When integrating with Flipper, you need to use **vault authority PDA** and **vault token accounts** instead of user wallet and user token accounts.

#### Step 1: Get Swap Instructions with Vault Authority

When calling `/swap-instructions`, use the **vault authority PDA** as `userPublicKey`:

```typescript
import { PublicKey } from "@solana/web3.js";

// 1. Derive vault authority PDA
const [vaultAuthority, vaultAuthorityBump] = PublicKey.findProgramAddressSync(
  [Buffer.from("vault_authority")],
  flipperProgramId
);

// 2. Get your vault token accounts
const sourceVault = /* your vault's source token account */;
const destinationVault = /* your vault's destination token account */;

// 3. Call Jupiter API with vault authority
const swapInstructionsResponse = await fetch(
  'https://quote-api.jup.ag/v6/swap-instructions',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey: vaultAuthority.toString(), // ← Use vault authority, not user wallet!
      useSharedAccounts: true,
      wrapAndUnwrapSol: true,
      computeUnitPriceMicroLamports: 1000
    })
  }
).then(r => r.json());

console.log("✅ Got swap instructions for vault authority:", vaultAuthority.toString());
```

#### Step 2: Replace Token Accounts in Response

Jupiter API returns token accounts based on `userPublicKey` (vault authority), but you may need to map them to actual vault token accounts:

```typescript
/**
 * Replace token accounts in Jupiter instruction accounts array
 */
function replaceTokenAccountsInJupiterInstruction(
  jupiterAccounts: Array<{pubkey: string, isSigner: boolean, isWritable: boolean}>,
  sourceVault: PublicKey,
  destinationVault: PublicKey,
  vaultAuthority: PublicKey
): Array<{pubkey: PublicKey, isSigner: boolean, isWritable: boolean}> {
  
  // Find and replace source/destination token accounts
  return jupiterAccounts.map((acc, index) => {
    const pubkey = new PublicKey(acc.pubkey);
    
    // Index 2 should be vault authority (already correct from API)
    if (index === 2) {
      console.log(`Account ${index}: Vault Authority (from API) = ${pubkey.toString()}`);
      return {
        pubkey: vaultAuthority,
        isSigner: false, // Will be set by Flipper's CPI logic
        isWritable: acc.isWritable
      };
    }
    
    // Index 3: user_source_token_account - replace with vault source
    if (index === 3) {
      console.log(`Account ${index}: Source token (replacing with vault) = ${sourceVault.toString()}`);
      return {
        pubkey: sourceVault,
        isSigner: false,
        isWritable: true
      };
    }
    
    // Index 6: user_destination_token_account - replace with vault destination
    if (index === 6) {
      console.log(`Account ${index}: Destination token (replacing with vault) = ${destinationVault.toString()}`);
      return {
        pubkey: destinationVault,
        isSigner: false,
        isWritable: true
      };
    }
    
    // Keep other accounts as-is
    return {
      pubkey,
      isSigner: acc.isSigner,
      isWritable: acc.isWritable
    };
  });
}

// Usage
const adaptedAccounts = replaceTokenAccountsInJupiterInstruction(
  swapInstructionsResponse.swapInstruction.accounts,
  sourceVault,
  destinationVault,
  vaultAuthority
);
```

#### Step 3: Build Flipper Instruction with Adapted Accounts

```typescript
/**
 * Helper: Extract mint address from token account
 */
async function getMintFromTokenAccount(
  connection: Connection,
  tokenAccount: PublicKey
): Promise<PublicKey> {
  const accountInfo = await connection.getAccountInfo(tokenAccount);
  if (!accountInfo) {
    throw new Error(`Token account not found: ${tokenAccount.toString()}`);
  }
  
  // Token account data layout: mint is at bytes 0-32
  const mintPubkey = new PublicKey(accountInfo.data.slice(0, 32));
  return mintPubkey;
}

/**
 * Complete example: Call Flipper with vault authority and vault token accounts
 */
async function executeFlipperSwapWithJupiterAPI(
  connection: Connection,
  flipperProgram: Program,
  wallet: Keypair,
  quoteResponse: any,
  // Vault accounts
  vaultAuthority: PublicKey,
  sourceVault: PublicKey,
  destinationVault: PublicKey,
  // User accounts (for receiving output)
  userDestinationTokenAccount: PublicKey
) {
  // 1. Get swap instructions with vault authority
  const swapInstructionsResponse = await fetch(
    'https://quote-api.jup.ag/v6/swap-instructions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse,
        userPublicKey: vaultAuthority.toString(), // Use vault authority!
        useSharedAccounts: true,
        wrapAndUnwrapSol: true,
      })
    }
  ).then(r => r.json());

  // 2. Extract instruction data (use as-is for production Jupiter)
  const jupiterInstructionData = Buffer.from(
    swapInstructionsResponse.swapInstruction.data,
    'base64'
  );

  // 3. Replace token accounts with vault accounts
  const adaptedAccounts = replaceTokenAccountsInJupiterInstruction(
    swapInstructionsResponse.swapInstruction.accounts,
    sourceVault,
    destinationVault,
    vaultAuthority
  );

  // 4. Get platform fee account
  const [platformFeeAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("platform_fee")],
    flipperProgram.programId
  );

  // 5. Get mints from token accounts
  const sourceMint = await getMintFromTokenAccount(connection, sourceVault);
  const destinationMint = await getMintFromTokenAccount(connection, destinationVault);

  // 6. Build Flipper instruction
  const tx = await flipperProgram.methods
    .sharedRoute(
      new BN(quoteResponse.inAmount),
      new BN(quoteResponse.outAmount),
      quoteResponse.slippageBps,
      0, // platformFeeBps
      jupiterInstructionData // Use real Jupiter instruction data
    )
    .accounts({
      vaultAuthority,
      userSourceTokenAccount: sourceVault, // Note: Using vault as "user" source
      userDestinationTokenAccount,         // Real user destination for receiving tokens
      vaultSource: sourceVault,
      vaultDestination: destinationVault,
      sourceMint,
      destinationMint,
      inputTokenProgram: TOKEN_PROGRAM_ID,
      outputTokenProgram: TOKEN_PROGRAM_ID,
      userTransferAuthority: wallet.publicKey,
      platformFeeAccount,
      jupiterProgram: new PublicKey("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"), // Real Jupiter
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(
      adaptedAccounts.map(acc => ({
        pubkey: acc.pubkey,
        isSigner: acc.isSigner,
        isWritable: acc.isWritable
      }))
    )
    .signers([wallet])
    .rpc();

  console.log("✅ Flipper swap executed with vault authority:", tx);
  return tx;
}
```

#### Important Notes

1. **Vault Authority as userPublicKey**
   - Jupiter API expects a signer address
   - Use vault authority PDA (derived from Flipper program)
   - Jupiter will build token accounts based on this address

2. **Token Account Replacement**
   - Jupiter API returns ATAs derived from vault authority
   - You need to replace them with your actual vault token accounts
   - Typically: indices 3 (source) and 6 (destination)

3. **Account Verification**
   - Always verify account indices match your expectations
   - Log accounts before executing to debug issues
   - Different routes may have slightly different account structures

4. **Testing Strategy**
   ```typescript
   // Step 1: Test with mock on devnet
   await executeFlipperSwapWithMock(/* ... */);
   
   // Step 2: Test with real Jupiter on devnet (if available)
   await executeFlipperSwapWithJupiterAPI(/* ... with devnet tokens */);
   
   // Step 3: Deploy to mainnet
   await executeFlipperSwapWithJupiterAPI(/* ... with mainnet tokens */);
   ```

### Comparing Jupiter Production vs Mock Accounts

When using `useSharedAccounts: true`, Jupiter returns many accounts. Here's how they map:

**Production Jupiter Accounts** (from `/swap-instructions`):
```javascript
swapInstruction.accounts = [
  { pubkey: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", isSigner: false, isWritable: false },  // 0: Token Program
  { pubkey: "D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf", isSigner: false, isWritable: false },  // 1: Jupiter PDA
  { pubkey: "UserWalletPublicKey", isSigner: true, isWritable: false },                            // 2: User authority
  { pubkey: "UserSourceTokenAccount", isSigner: false, isWritable: true },                         // 3: User source
  { pubkey: "JupiterProgramSourceAccount", isSigner: false, isWritable: true },                    // 4: Program source
  { pubkey: "JupiterProgramDestAccount", isSigner: false, isWritable: true },                      // 5: Program destination
  { pubkey: "UserDestTokenAccount", isSigner: false, isWritable: true },                           // 6: User destination
  // ... more accounts for specific DEX interactions
];
```

**Mock Jupiter Accounts** (simplified for testing):
```javascript
remainingAccounts = [
  { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },           // 0: Token Program
  { pubkey: mockJupiterProgram.programId, isSigner: false, isWritable: false }, // 1: Mock Jupiter (placeholder PDA)
  { pubkey: vaultAuthority, isSigner: false, isWritable: false },              // 2: Flipper's vault authority (PDA)
  { pubkey: vaultSource, isSigner: false, isWritable: true },                  // 3: Vault source
  { pubkey: vaultSource, isSigner: false, isWritable: true },                  // 4: Program source (same as vault)
  { pubkey: vaultDestination, isSigner: false, isWritable: true },             // 5: Program destination (same as vault)
  { pubkey: vaultDestination, isSigner: false, isWritable: true },             // 6: Vault destination
  { pubkey: sourceMint, isSigner: false, isWritable: false },                  // 7: Source mint
  { pubkey: destinationMint, isSigner: false, isWritable: false },             // 8: Destination mint
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },     // 9: Platform fee (placeholder)
  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },     // 10: Token-2022 (placeholder)
  { pubkey: eventAuthority, isSigner: false, isWritable: false },              // 11: Event authority
  { pubkey: mockJupiterProgram.programId, isSigner: false, isWritable: false }, // 12: Jupiter program
  { pubkey: mockPool, isSigner: false, isWritable: true },                     // 13: Mock liquidity pool
  { pubkey: mockPoolAuthority, isSigner: false, isWritable: false },           // 14: Mock pool authority
];
```

### Key Differences

| Aspect | Production (with useSharedAccounts) | Mock (for devnet testing) |
|--------|-------------------------------------|---------------------------|
| **Instruction Data** | Base64-encoded Borsh serialized data | Same format, rebuilt with mock encoder |
| **Account Count** | 15-30+ accounts (depends on route) | 15 accounts (fixed, simplified) |
| **User Authority** | Index 2: Real user wallet | Index 2: Flipper's vault authority PDA |
| **Pool Accounts** | Real DEX pool accounts | Mock pool + mock authority |
| **Address Lookup Tables** | Required for production | Not used in mock |

### Production Migration Checklist

When moving from mock to production Jupiter with `useSharedAccounts: true`:

1. **Replace Mock Program ID** with real Jupiter: `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4`

2. **Use Real Instruction Data** from `/swap-instructions` API response

3. **Use Real Accounts** from `swapInstruction.accounts` array

4. **Handle Address Lookup Tables**:
   ```typescript
   const lookupTables = await Promise.all(
     swapInstructionsResponse.addressLookupTableAddresses.map(
       address => connection.getAddressLookupTable(new PublicKey(address))
     )
   );
   ```

5. **Build Transaction with Versioned Transaction**:
   ```typescript
   import { VersionedTransaction, TransactionMessage } from '@solana/web3.js';
   
   const message = TransactionMessage.compile({
     payerKey: wallet.publicKey,
     recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
     instructions: [
       ...swapInstructionsResponse.computeBudgetInstructions,
       ...swapInstructionsResponse.setupInstructions,
       flipperSwapInstruction,
       ...swapInstructionsResponse.cleanupInstructions
     ]
   });
   
   const versionedTx = new VersionedTransaction(message);
   ```

## Step 2: Transform for Mock Jupiter

### 2.1 Build Route Plan

The mock expects a simplified route plan structure:

```typescript
import { BN } from "@coral-xyz/anchor";

// From Jupiter API response
const jupiterResponse = {
  inAmount: "1000000",
  outAmount: "150000",
  slippageBps: 50,
  routePlan: [
    {
      swapInfo: {
        label: "Raydium",  // or "Orca Whirlpool", "Meteora", etc.
        // ... other fields
      },
      percent: 100
    }
  ]
};

// Transform to mock format
const mockRoutePlan = jupiterResponse.routePlan.map((step, index) => ({
  swap: getSwapVariant(step.swapInfo.label),  // Map label to swap type
  percent: step.percent,
  inputIndex: index,
  outputIndex: index + 1
}));

// Helper function to map DEX label to swap variant
function getSwapVariant(label: string): object {
  const labelLower = label.toLowerCase();
  
  if (labelLower.includes("raydium")) {
    return { raydium: {} };
  } else if (labelLower.includes("whirlpool") || labelLower.includes("orca")) {
    return { whirlpool: {} };
  } else if (labelLower.includes("meteora")) {
    return { meteora: {} };
  } else {
    // Default to Raydium for unknown DEXes
    return { raydium: {} };
  }
}

// Example result
const routePlan = [
  {
    swap: { raydium: {} },
    percent: 100,
    inputIndex: 0,
    outputIndex: 1
  }
];
```

### 2.2 Build Instruction Data

Use Anchor's encoder to properly serialize the instruction data:

```typescript
import { Program } from "@coral-xyz/anchor";

/**
 * Builds Jupiter instruction data using Anchor encoder
 */
function buildJupiterCpiInstructionData(
  mockJupiterProgram: Program,
  id: number,
  routePlan: { swap: object; percent: number; inputIndex: number; outputIndex: number }[],
  inAmount: BN,
  quotedOutAmount: BN,
  slippageBps: number,
  platformFeeBps: number
): Buffer {
  // Use Anchor's encoder to properly serialize the instruction
  const data = mockJupiterProgram.coder.instruction.encode("sharedAccountsRoute", {
    id,
    routePlan,
    inAmount,
    quotedOutAmount,
    slippageBps,
    platformFeeBps
  });
  
  return Buffer.from(data);
}

// Usage
const inAmount = new BN(jupiterResponse.inAmount);
const quotedOutAmount = new BN(jupiterResponse.outAmount);
const slippageBps = jupiterResponse.slippageBps;
const platformFeeBps = 0;  // Set your platform fee (0-100 bps)

const instructionData = buildJupiterCpiInstructionData(
  mockJupiterProgram,
  0,  // id: can be any u8 value
  routePlan,
  inAmount,
  quotedOutAmount,
  slippageBps,
  platformFeeBps
);
```

### 2.3 Build Remaining Accounts

The mock Jupiter requires specific accounts in a specific order:

```typescript
import { PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

/**
 * Builds remaining accounts array for Jupiter CPI
 */
function buildJupiterRemainingAccounts(params: {
  tokenProgram: PublicKey;
  jupiterProgramAuthority: PublicKey;  // Mock Jupiter program ID
  vaultAuthority: PublicKey;           // Your Flipper vault authority PDA
  vaultSource: PublicKey;              // Vault source token account
  vaultDestination: PublicKey;         // Vault destination token account
  sourceMint: PublicKey;
  destinationMint: PublicKey;
  platformFeeOrPlaceholder: PublicKey;
  token2022OrPlaceholder: PublicKey;
  eventAuthority: PublicKey;
  jupiterProgram: PublicKey;           // Mock Jupiter program ID
  mockPool: PublicKey;                 // Mock liquidity pool
  mockPoolAuthority: PublicKey;        // Mock pool authority (wallet for testing)
}) {
  return [
    { pubkey: params.tokenProgram, isSigner: false, isWritable: false },              // 0: Token program
    { pubkey: params.jupiterProgramAuthority, isSigner: false, isWritable: false },   // 1: Jupiter PDA (placeholder)
    { pubkey: params.vaultAuthority, isSigner: false, isWritable: false },            // 2: Vault authority (Flipper PDA)
    { pubkey: params.vaultSource, isSigner: false, isWritable: true },                // 3: User source
    { pubkey: params.vaultSource, isSigner: false, isWritable: true },                // 4: Program source (same)
    { pubkey: params.vaultDestination, isSigner: false, isWritable: true },           // 5: Program destination (same)
    { pubkey: params.vaultDestination, isSigner: false, isWritable: true },           // 6: User destination (same)
    { pubkey: params.sourceMint, isSigner: false, isWritable: false },                // 7: Source mint
    { pubkey: params.destinationMint, isSigner: false, isWritable: false },           // 8: Destination mint
    { pubkey: params.platformFeeOrPlaceholder, isSigner: false, isWritable: false },  // 9: Platform fee account
    { pubkey: params.token2022OrPlaceholder, isSigner: false, isWritable: false },    // 10: Token-2022 program
    { pubkey: params.eventAuthority, isSigner: false, isWritable: false },            // 11: Event authority
    { pubkey: params.jupiterProgram, isSigner: false, isWritable: false },            // 12: Jupiter program
    { pubkey: params.mockPool, isSigner: false, isWritable: true },                   // 13: Mock pool
    { pubkey: params.mockPoolAuthority, isSigner: false, isWritable: false },         // 14: Mock pool authority
  ];
}
```

## Step 3: Execute Transaction

### 3.1 Simple Swap Example

```typescript
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

async function executeJupiterSwap(
  flipperProgram: Program,
  mockJupiterProgram: Program,
  jupiterApiResponse: any  // Response from Jupiter API
) {
  // 1. Transform Jupiter response to mock format
  const routePlan = transformRoutePlan(jupiterApiResponse.routePlan);
  
  // 2. Build instruction data
  const data = buildJupiterCpiInstructionData(
    mockJupiterProgram,
    0,
    routePlan,
    new BN(jupiterApiResponse.inAmount),
    new BN(jupiterApiResponse.outAmount),
    jupiterApiResponse.slippageBps,
    0  // platformFeeBps
  );
  
  // 3. Derive vault authority PDA
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority")],
    flipperProgram.programId
  );
  
  // 4. Get token accounts (you need to create these)
  const sourceMint = new PublicKey(jupiterApiResponse.inputMint);
  const destinationMint = new PublicKey(jupiterApiResponse.outputMint);
  
  const userSourceTokenAccount = /* your user's source token account */;
  const userDestinationTokenAccount = /* your user's dest token account */;
  const sourceVault = /* vault's source token account */;
  const destinationVault = /* vault's dest token account */;
  
  // 5. Setup mock pool (for testing only)
  const mockPool = /* create and fund mock liquidity pool */;
  const mockPoolAuthority = /* wallet.publicKey */;
  
  // 6. Build remaining accounts
  const remainingAccounts = buildJupiterRemainingAccounts({
    tokenProgram: TOKEN_PROGRAM_ID,
    jupiterProgramAuthority: mockJupiterProgram.programId,
    vaultAuthority,
    vaultSource: sourceVault,
    vaultDestination: destinationVault,
    sourceMint,
    destinationMint,
    platformFeeOrPlaceholder: SystemProgram.programId, // placeholder
    token2022OrPlaceholder: SystemProgram.programId,   // placeholder
    eventAuthority: new PublicKey("D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf"), // placeholder
    jupiterProgram: mockJupiterProgram.programId,
    mockPool,
    mockPoolAuthority
  });
  
  // 7. Execute shared_route instruction
  const tx = await flipperProgram.methods
    .sharedRoute(
      new BN(jupiterApiResponse.inAmount),
      new BN(jupiterApiResponse.outAmount),
      jupiterApiResponse.slippageBps,
      0, // platformFeeBps
      data
    )
    .accounts({
      vaultAuthority,
      userSourceTokenAccount,
      userDestinationTokenAccount,
      vaultSource: sourceVault,
      vaultDestination: destinationVault,
      sourceMint,
      destinationMint,
      inputTokenProgram: TOKEN_PROGRAM_ID,
      outputTokenProgram: TOKEN_PROGRAM_ID,
      userTransferAuthority: wallet.publicKey,
      platformFeeAccount: platformFeeAccount,
      jupiterProgram: mockJupiterProgram.programId,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(remainingAccounts)
    .signers([wallet.payer])
    .rpc();
  
  console.log("✅ Swap executed:", tx);
}
```

### 3.2 Swap and Create Limit Order Example

```typescript
async function executeSwapAndCreateOrder(
  flipperProgram: Program,
  mockJupiterProgram: Program,
  jupiterApiResponse: any,
  orderParams: {
    minOutputAmount: BN;
    triggerPriceBps: number;
    orderType: { takeProfit: {} } | { stopLoss: {} };
    expiresAt: BN | null;
  }
) {
  // Same setup as above...
  const data = buildJupiterCpiInstructionData(/* ... */);
  const remainingAccounts = buildJupiterRemainingAccounts(/* ... */);
  
  // Derive order account PDA
  const orderIndex = new BN(Date.now()); // Unique order index
  const [limitOrderAccount] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("limit_order"),
      wallet.publicKey.toBuffer(),
      orderIndex.toArrayLike(Buffer, "le", 8)
    ],
    flipperProgram.programId
  );
  
  // Derive order vault PDA
  const [orderVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("order_vault"), limitOrderAccount.toBuffer()],
    flipperProgram.programId
  );
  
  // Execute shared_route_and_create_order
  const tx = await flipperProgram.methods
    .sharedRouteAndCreateOrder(
      new BN(jupiterApiResponse.inAmount),
      new BN(jupiterApiResponse.outAmount),
      jupiterApiResponse.slippageBps,
      0, // platformFeeBps
      data,
      orderIndex,
      orderParams.minOutputAmount,
      orderParams.triggerPriceBps,
      orderParams.orderType,
      orderParams.expiresAt
    )
    .accounts({
      creator: wallet.publicKey,
      limitOrderAccount,
      orderVault,
      vaultAuthority,
      // ... same accounts as sharedRoute
    })
    .remainingAccounts(remainingAccounts)
    .signers([wallet.payer])
    .rpc();
  
  console.log("✅ Swap and order created:", tx);
}
```

## Step 4: Key Differences from Production

| Aspect | Production (Jupiter) | Devnet (Mock) |
|--------|---------------------|---------------|
| **Program ID** | `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4` | Your mock program ID |
| **Accounts** | Real Jupiter accounts from API | Mock pool + mock authority |
| **Route Plan** | Complex multi-hop routes | Simplified single-hop |
| **Liquidity** | Real DEX liquidity | Mock pool (funded manually) |
| **Slippage** | Real market conditions | Simulated (configurable) |
| **Instruction Data** | Full discriminator + args | Same format (Anchor encoded) |

## Step 5: Complete Working Example

See these files for complete working examples:

1. **Basic Swap Test**: `tests/07. shared_jupiter_instructions.ts`
   - Shows how to execute a simple swap
   - Demonstrates instruction data building
   - Includes balance verification

2. **Devnet Script**: `scripts/devnet/5.test_shared_route_jupiter.ts`
   - Complete devnet integration example
   - Shows pool setup and funding
   - Configuration management

3. **Mock Jupiter Program**: `programs/mock_jupiter/src/lib.rs`
   - Mock implementation of `shared_accounts_route`
   - Shows expected account structure
   - Validation logic

## Troubleshooting

### Common Issues

1. **`InstructionDidNotDeserialize` error**
   - **Cause**: Incorrect instruction data format
   - **Fix**: Always use `mockJupiterProgram.coder.instruction.encode()`

2. **`InvalidAuthority` error**
   - **Cause**: Vault authority not marked as signer
   - **Fix**: Ensure vault authority is in remaining accounts at index 2

3. **`Signer privilege escalated` error**
   - **Cause**: Mock pool authority not marked as signer
   - **Fix**: Ensure wallet is a signer in the transaction

4. **`AccountBorrowFailed` error**
   - **Cause**: Account borrowed twice
   - **Fix**: Check for duplicate accounts in remaining accounts

### Debugging Tips

```typescript
// Log instruction data
console.log("Instruction data length:", data.length);
console.log("Instruction data (hex):", data.toString('hex'));

// Verify remaining accounts
remainingAccounts.forEach((acc, idx) => {
  console.log(`Account ${idx}:`, acc.pubkey.toString());
  console.log(`  Signer: ${acc.isSigner}, Writable: ${acc.isWritable}`);
});

// Check balances before/after
const balanceBefore = await connection.getTokenAccountBalance(tokenAccount);
// ... execute transaction
const balanceAfter = await connection.getTokenAccountBalance(tokenAccount);
console.log("Balance change:", balanceAfter.value.amount - balanceBefore.value.amount);
```

## Migration to Production

When moving from mock to production Jupiter:

1. **Replace Program ID**: Change `mockJupiterProgram.programId` to `JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4`

2. **Use Real Route Data**: Replace mock route plan with actual Jupiter API response

3. **Update Remaining Accounts**: Use accounts from Jupiter API `/swap` endpoint

4. **Remove Mock Pool Setup**: No need to create/fund mock pools

5. **Test on Mainnet-fork first**: Use Solana mainnet-fork for final testing before production

## Rust Client Integration

### Setup Dependencies

Add these dependencies to your `Cargo.toml`:

```toml
[dependencies]
anchor-client = "0.30.1"
anchor-lang = "0.30.1"
solana-sdk = "1.18.0"
solana-client = "1.18.0"
spl-token = "4.0.0"
anyhow = "1.0"
```

### Step 1: Define Client Structures

```rust
use anchor_client::solana_sdk::{
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    system_program,
    instruction::{AccountMeta, Instruction},
};
use anchor_client::{Client, Cluster, Program};
use anchor_lang::prelude::*;
use anyhow::Result;

// Define the route plan structure (matches IDL)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RoutePlanStep {
    pub swap: SwapType,
    pub percent: u8,
    pub input_index: u8,
    pub output_index: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub enum SwapType {
    Saber,
    SaberAddDecimalsDeposit,
    SaberAddDecimalsWithdraw,
    TokenSwap,
    Sencha,
    Step,
    Cropper,
    Raydium,
    Crema,
    Lifinity,
    Mercurial,
    Cykura,
    Serum,
    MarinadeDeposit,
    MarinadeUnstake,
    Aldrin,
    AldrinV2,
    Whirlpool,
    Invariant,
    Meteora,
    GooseFX,
    DeltaFi,
    Balansol,
    MarcoPolo,
    Dradex,
    LifinityV2,
    RaydiumClmm,
    Openbook,
    Phoenix,
    Symmetry,
    TokenSwapV2,
    HeliumTreasuryManagementRedeemV0,
    StakeDexStakeWrappedSol,
    StakeDexSwapViaStake,
    GooseFXV2,
    Perps,
    PerpsAddLiquidity,
    PerpsRemoveLiquidity,
    MeteoraMultiSwap,
}

impl SwapType {
    /// Map DEX label from Jupiter API to SwapType enum
    pub fn from_label(label: &str) -> Self {
        let label_lower = label.to_lowercase();
        if label_lower.contains("raydium") {
            SwapType::Raydium
        } else if label_lower.contains("whirlpool") || label_lower.contains("orca") {
            SwapType::Whirlpool
        } else if label_lower.contains("meteora") {
            SwapType::Meteora
        } else if label_lower.contains("serum") {
            SwapType::Serum
        } else {
            // Default to Raydium for testing
            SwapType::Raydium
        }
    }
}
```

### Step 2: Build Instruction Data

```rust
/// Build Jupiter instruction data using Borsh serialization
pub fn build_jupiter_instruction_data(
    id: u8,
    route_plan: Vec<RoutePlanStep>,
    in_amount: u64,
    quoted_out_amount: u64,
    slippage_bps: u16,
    platform_fee_bps: u8,
) -> Result<Vec<u8>> {
    // Get discriminator for "shared_accounts_route" instruction
    // SHA256("global:shared_accounts_route")[..8]
    let discriminator: [u8; 8] = [193, 32, 155, 51, 65, 214, 156, 129];
    
    let mut data = Vec::new();
    
    // Add discriminator
    data.extend_from_slice(&discriminator);
    
    // Serialize arguments using Borsh
    id.serialize(&mut data)?;
    route_plan.serialize(&mut data)?;
    in_amount.serialize(&mut data)?;
    quoted_out_amount.serialize(&mut data)?;
    slippage_bps.serialize(&mut data)?;
    platform_fee_bps.serialize(&mut data)?;
    
    Ok(data)
}

/// Transform Jupiter API route plan to mock format
pub fn transform_route_plan(
    jupiter_route: &serde_json::Value
) -> Result<Vec<RoutePlanStep>> {
    let route_plan = jupiter_route["routePlan"]
        .as_array()
        .ok_or_else(|| anyhow::anyhow!("Missing routePlan in response"))?;
    
    let mut steps = Vec::new();
    
    for (index, step) in route_plan.iter().enumerate() {
        let label = step["swapInfo"]["label"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("Missing label"))?;
        
        let percent = step["percent"]
            .as_u64()
            .ok_or_else(|| anyhow::anyhow!("Missing percent"))? as u8;
        
        steps.push(RoutePlanStep {
            swap: SwapType::from_label(label),
            percent,
            input_index: index as u8,
            output_index: (index + 1) as u8,
        });
    }
    
    Ok(steps)
}
```

### Step 3: Build Remaining Accounts

```rust
/// Build remaining accounts for Jupiter CPI
pub fn build_jupiter_remaining_accounts(
    token_program: Pubkey,
    jupiter_program_authority: Pubkey,
    vault_authority: Pubkey,
    vault_source: Pubkey,
    vault_destination: Pubkey,
    source_mint: Pubkey,
    destination_mint: Pubkey,
    platform_fee_or_placeholder: Pubkey,
    token_2022_or_placeholder: Pubkey,
    event_authority: Pubkey,
    jupiter_program: Pubkey,
    mock_pool: Pubkey,
    mock_pool_authority: Pubkey,
) -> Vec<AccountMeta> {
    vec![
        AccountMeta::new_readonly(token_program, false),              // 0: Token program
        AccountMeta::new_readonly(jupiter_program_authority, false),  // 1: Jupiter PDA
        AccountMeta::new_readonly(vault_authority, false),            // 2: Vault authority (Flipper PDA)
        AccountMeta::new(vault_source, false),                        // 3: User source
        AccountMeta::new(vault_source, false),                        // 4: Program source
        AccountMeta::new(vault_destination, false),                   // 5: Program destination
        AccountMeta::new(vault_destination, false),                   // 6: User destination
        AccountMeta::new_readonly(source_mint, false),                // 7: Source mint
        AccountMeta::new_readonly(destination_mint, false),           // 8: Destination mint
        AccountMeta::new_readonly(platform_fee_or_placeholder, false),// 9: Platform fee
        AccountMeta::new_readonly(token_2022_or_placeholder, false),  // 10: Token-2022
        AccountMeta::new_readonly(event_authority, false),            // 11: Event authority
        AccountMeta::new_readonly(jupiter_program, false),            // 12: Jupiter program
        AccountMeta::new(mock_pool, false),                           // 13: Mock pool
        AccountMeta::new_readonly(mock_pool_authority, false),        // 14: Mock pool authority
    ]
}
```

### Step 4: Execute Transaction

```rust
use anchor_client::solana_sdk::commitment_config::CommitmentConfig;

/// Execute Jupiter swap using Flipper's shared_route instruction
pub async fn execute_jupiter_swap(
    client: &Client,
    flipper_program_id: Pubkey,
    mock_jupiter_program_id: Pubkey,
    payer: &Keypair,
    jupiter_api_response: &serde_json::Value,
    // Token accounts
    user_source_token_account: Pubkey,
    user_destination_token_account: Pubkey,
    source_vault: Pubkey,
    destination_vault: Pubkey,
    // Mock pool for testing
    mock_pool: Pubkey,
    mock_pool_authority: Pubkey,
) -> Result<String> {
    // 1. Parse Jupiter API response
    let in_amount = jupiter_api_response["inAmount"]
        .as_str()
        .and_then(|s| s.parse::<u64>().ok())
        .ok_or_else(|| anyhow::anyhow!("Invalid inAmount"))?;
    
    let quoted_out_amount = jupiter_api_response["outAmount"]
        .as_str()
        .and_then(|s| s.parse::<u64>().ok())
        .ok_or_else(|| anyhow::anyhow!("Invalid outAmount"))?;
    
    let slippage_bps = jupiter_api_response["slippageBps"]
        .as_u64()
        .ok_or_else(|| anyhow::anyhow!("Invalid slippageBps"))? as u16;
    
    // 2. Transform route plan
    let route_plan = transform_route_plan(jupiter_api_response)?;
    
    // 3. Build instruction data
    let instruction_data = build_jupiter_instruction_data(
        0,  // id
        route_plan,
        in_amount,
        quoted_out_amount,
        slippage_bps,
        0,  // platform_fee_bps
    )?;
    
    // 4. Derive PDAs
    let (vault_authority, _bump) = Pubkey::find_program_address(
        &[b"vault_authority"],
        &flipper_program_id,
    );
    
    let (platform_fee_account, _) = Pubkey::find_program_address(
        &[b"platform_fee"],
        &flipper_program_id,
    );
    
    // 5. Get mints
    let source_mint = get_mint_from_token_account(client, &user_source_token_account).await?;
    let destination_mint = get_mint_from_token_account(client, &user_destination_token_account).await?;
    
    // 6. Build remaining accounts
    let remaining_accounts = build_jupiter_remaining_accounts(
        spl_token::id(),
        mock_jupiter_program_id,
        vault_authority,
        source_vault,
        destination_vault,
        source_mint,
        destination_mint,
        system_program::id(), // placeholder
        system_program::id(), // placeholder
        Pubkey::new_from_array([0; 32]), // event authority placeholder
        mock_jupiter_program_id,
        mock_pool,
        mock_pool_authority,
    );
    
    // 7. Get Flipper program
    let program = client.program(flipper_program_id)?;
    
    // 8. Build and send transaction
    let tx = program
        .request()
        .accounts(flipper::accounts::SharedRoute {
            vault_authority,
            user_source_token_account,
            user_destination_token_account,
            vault_source: source_vault,
            vault_destination: destination_vault,
            source_mint,
            destination_mint,
            input_token_program: spl_token::id(),
            output_token_program: spl_token::id(),
            user_transfer_authority: payer.pubkey(),
            platform_fee_account,
            jupiter_program: mock_jupiter_program_id,
            system_program: system_program::id(),
        })
        .args(flipper::instruction::SharedRoute {
            in_amount,
            quoted_out_amount,
            slippage_bps,
            platform_fee_bps: 0,
            data: instruction_data,
        })
        .accounts(remaining_accounts)
        .signer(payer)
        .send()?;
    
    println!("✅ Transaction signature: {}", tx);
    Ok(tx.to_string())
}

/// Helper: Get mint from token account
async fn get_mint_from_token_account(
    client: &Client,
    token_account: &Pubkey,
) -> Result<Pubkey> {
    let account = client.program(spl_token::id())?
        .rpc()
        .get_account(token_account)?;
    
    let token_account_data = spl_token::state::Account::unpack(&account.data)?;
    Ok(token_account_data.mint)
}
```

### Step 5: Complete Example with Setup

```rust
use anchor_client::solana_sdk::commitment_config::CommitmentConfig;

#[tokio::main]
async fn main() -> Result<()> {
    // 1. Setup client
    let payer = Keypair::from_bytes(&[/* your keypair bytes */])?;
    let client = Client::new_with_options(
        Cluster::Devnet,
        &payer,
        CommitmentConfig::confirmed(),
    );
    
    // 2. Program IDs
    let flipper_program_id = "YourFlipperProgramId".parse::<Pubkey>()?;
    let mock_jupiter_program_id = "YourMockJupiterProgramId".parse::<Pubkey>()?;
    
    // 3. Query Jupiter API
    let jupiter_response = reqwest::get(
        "https://quote-api.jup.ag/v6/quote?\
         inputMint=So11111111111111111111111111111111111111112&\
         outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&\
         amount=1000000&\
         slippageBps=50"
    )
    .await?
    .json::<serde_json::Value>()
    .await?;
    
    println!("Jupiter API Response: {}", serde_json::to_string_pretty(&jupiter_response)?);
    
    // 4. Setup token accounts (you need to create these)
    let user_source_token_account = "YourSourceTokenAccount".parse()?;
    let user_destination_token_account = "YourDestTokenAccount".parse()?;
    let source_vault = "SourceVault".parse()?;
    let destination_vault = "DestVault".parse()?;
    
    // 5. Setup mock pool (for devnet testing only)
    let mock_pool = "MockPoolAddress".parse()?;
    let mock_pool_authority = payer.pubkey();
    
    // 6. Execute swap
    let signature = execute_jupiter_swap(
        &client,
        flipper_program_id,
        mock_jupiter_program_id,
        &payer,
        &jupiter_response,
        user_source_token_account,
        user_destination_token_account,
        source_vault,
        destination_vault,
        mock_pool,
        mock_pool_authority,
    ).await?;
    
    println!("✅ Swap executed successfully!");
    println!("   Signature: {}", signature);
    
    Ok(())
}
```

### Step 6: Swap and Create Limit Order

```rust
/// Execute swap and create limit order
pub async fn execute_swap_and_create_order(
    client: &Client,
    flipper_program_id: Pubkey,
    mock_jupiter_program_id: Pubkey,
    payer: &Keypair,
    jupiter_api_response: &serde_json::Value,
    // Order parameters
    order_index: u64,
    min_output_amount: u64,
    trigger_price_bps: u16,
    order_type: OrderType,
    expires_at: Option<i64>,
    // ... other accounts
) -> Result<String> {
    // Build instruction data (same as above)
    let instruction_data = build_jupiter_instruction_data(/* ... */)?;
    
    // Derive order account PDA
    let (limit_order_account, _) = Pubkey::find_program_address(
        &[
            b"limit_order",
            payer.pubkey().as_ref(),
            &order_index.to_le_bytes(),
        ],
        &flipper_program_id,
    );
    
    // Derive order vault PDA
    let (order_vault, _) = Pubkey::find_program_address(
        &[b"order_vault", limit_order_account.as_ref()],
        &flipper_program_id,
    );
    
    let program = client.program(flipper_program_id)?;
    
    let tx = program
        .request()
        .accounts(flipper::accounts::SharedRouteAndCreateOrder {
            creator: payer.pubkey(),
            limit_order_account,
            order_vault,
            vault_authority,
            // ... other accounts (same as SharedRoute)
        })
        .args(flipper::instruction::SharedRouteAndCreateOrder {
            in_amount,
            quoted_out_amount,
            slippage_bps,
            platform_fee_bps: 0,
            data: instruction_data,
            order_index,
            min_output_amount,
            trigger_price_bps,
            order_type,
            expires_at,
        })
        .accounts(remaining_accounts)
        .signer(payer)
        .send()?;
    
    println!("✅ Swap and order created: {}", tx);
    Ok(tx.to_string())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub enum OrderType {
    TakeProfit,
    StopLoss,
}
```

### Testing Tips for Rust

```rust
#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_build_instruction_data() {
        let route_plan = vec![
            RoutePlanStep {
                swap: SwapType::Raydium,
                percent: 100,
                input_index: 0,
                output_index: 1,
            }
        ];
        
        let data = build_jupiter_instruction_data(
            0,
            route_plan,
            1_000_000,
            150_000,
            50,
            0,
        ).unwrap();
        
        // Verify discriminator
        assert_eq!(&data[0..8], &[193, 32, 155, 51, 65, 214, 156, 129]);
        println!("Instruction data length: {}", data.len());
        println!("Instruction data (hex): {}", hex::encode(&data));
    }
    
    #[test]
    fn test_transform_route_plan() {
        let jupiter_response = serde_json::json!({
            "routePlan": [
                {
                    "swapInfo": {
                        "label": "Raydium"
                    },
                    "percent": 100
                }
            ]
        });
        
        let route_plan = transform_route_plan(&jupiter_response).unwrap();
        assert_eq!(route_plan.len(), 1);
        assert_eq!(route_plan[0].percent, 100);
    }
}
```

### Step 7: Using Vault Authority in Rust

When calling Jupiter API from Rust, you need to use vault authority PDA:

```rust
use reqwest;
use serde_json::json;

/// Call Jupiter swap-instructions API with vault authority
pub async fn get_jupiter_swap_instructions_with_vault(
    vault_authority: &Pubkey,
    quote_response: &serde_json::Value,
) -> Result<serde_json::Value> {
    let client = reqwest::Client::new();
    
    let request_body = json!({
        "quoteResponse": quote_response,
        "userPublicKey": vault_authority.to_string(), // Use vault authority!
        "useSharedAccounts": true,
        "wrapAndUnwrapSol": true,
        "computeUnitPriceMicroLamports": 1000
    });
    
    let response = client
        .post("https://quote-api.jup.ag/v6/swap-instructions")
        .json(&request_body)
        .send()
        .await?
        .json::<serde_json::Value>()
        .await?;
    
    Ok(response)
}

/// Replace token accounts in Jupiter accounts array
pub fn replace_token_accounts(
    jupiter_accounts: &[serde_json::Value],
    source_vault: Pubkey,
    destination_vault: Pubkey,
    vault_authority: Pubkey,
) -> Result<Vec<AccountMeta>> {
    let mut accounts = Vec::new();
    
    for (index, acc) in jupiter_accounts.iter().enumerate() {
        let pubkey_str = acc["pubkey"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("Missing pubkey"))?;
        let mut pubkey = Pubkey::from_str(pubkey_str)?;
        let is_signer = acc["isSigner"].as_bool().unwrap_or(false);
        let is_writable = acc["isWritable"].as_bool().unwrap_or(false);
        
        // Replace token accounts
        match index {
            2 => {
                // Vault authority (should already be correct from API)
                pubkey = vault_authority;
                println!("Account {}: Vault Authority = {}", index, pubkey);
            }
            3 => {
                // Source token account - replace with vault source
                pubkey = source_vault;
                println!("Account {}: Source Vault = {}", index, pubkey);
            }
            6 => {
                // Destination token account - replace with vault destination
                pubkey = destination_vault;
                println!("Account {}: Destination Vault = {}", index, pubkey);
            }
            _ => {}
        }
        
        let account_meta = if is_writable {
            if is_signer {
                AccountMeta::new(pubkey, true)
            } else {
                AccountMeta::new(pubkey, false)
            }
        } else {
            if is_signer {
                AccountMeta::new_readonly(pubkey, true)
            } else {
                AccountMeta::new_readonly(pubkey, false)
            }
        };
        
        accounts.push(account_meta);
    }
    
    Ok(accounts)
}

/// Complete example: Execute swap with vault authority
pub async fn execute_flipper_swap_with_jupiter_api(
    client: &Client,
    flipper_program_id: Pubkey,
    payer: &Keypair,
    quote_response: &serde_json::Value,
    // Vault accounts
    vault_authority: Pubkey,
    source_vault: Pubkey,
    destination_vault: Pubkey,
    // User accounts
    user_destination_token_account: Pubkey,
) -> Result<String> {
    // 1. Get swap instructions with vault authority
    println!("🔄 Calling Jupiter API with vault authority: {}", vault_authority);
    let swap_instructions = get_jupiter_swap_instructions_with_vault(
        &vault_authority,
        quote_response,
    ).await?;
    
    // 2. Extract instruction data (base64 decoded)
    let instruction_data_b64 = swap_instructions["swapInstruction"]["data"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("Missing instruction data"))?;
    let instruction_data = base64::decode(instruction_data_b64)?;
    
    println!("✅ Got instruction data, length: {}", instruction_data.len());
    
    // 3. Replace token accounts
    let jupiter_accounts = swap_instructions["swapInstruction"]["accounts"]
        .as_array()
        .ok_or_else(|| anyhow::anyhow!("Missing accounts array"))?;
    
    let remaining_accounts = replace_token_accounts(
        jupiter_accounts,
        source_vault,
        destination_vault,
        vault_authority,
    )?;
    
    println!("✅ Replaced token accounts, total accounts: {}", remaining_accounts.len());
    
    // 4. Parse amounts from quote
    let in_amount = quote_response["inAmount"]
        .as_str()
        .and_then(|s| s.parse::<u64>().ok())
        .ok_or_else(|| anyhow::anyhow!("Invalid inAmount"))?;
    
    let out_amount = quote_response["outAmount"]
        .as_str()
        .and_then(|s| s.parse::<u64>().ok())
        .ok_or_else(|| anyhow::anyhow!("Invalid outAmount"))?;
    
    let slippage_bps = quote_response["slippageBps"]
        .as_u64()
        .ok_or_else(|| anyhow::anyhow!("Invalid slippageBps"))? as u16;
    
    // 5. Get mints
    let source_mint = get_mint_from_token_account(client, &source_vault).await?;
    let destination_mint = get_mint_from_token_account(client, &destination_vault).await?;
    
    // 6. Get platform fee account
    let (platform_fee_account, _) = Pubkey::find_program_address(
        &[b"platform_fee"],
        &flipper_program_id,
    );
    
    // 7. Build and send transaction
    let program = client.program(flipper_program_id)?;
    let jupiter_program_id = Pubkey::from_str("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4")?;
    
    let tx = program
        .request()
        .accounts(flipper::accounts::SharedRoute {
            vault_authority,
            user_source_token_account: source_vault,
            user_destination_token_account,
            vault_source: source_vault,
            vault_destination: destination_vault,
            source_mint,
            destination_mint,
            input_token_program: spl_token::id(),
            output_token_program: spl_token::id(),
            user_transfer_authority: payer.pubkey(),
            platform_fee_account,
            jupiter_program: jupiter_program_id,
            system_program: system_program::id(),
        })
        .args(flipper::instruction::SharedRoute {
            in_amount,
            quoted_out_amount: out_amount,
            slippage_bps,
            platform_fee_bps: 0,
            data: instruction_data,
        })
        .accounts(remaining_accounts)
        .signer(payer)
        .send()?;
    
    println!("✅ Swap executed with vault authority: {}", tx);
    Ok(tx.to_string())
}
```

**Required dependencies for Rust:**

```toml
[dependencies]
reqwest = { version = "0.11", features = ["json"] }
serde_json = "1.0"
base64 = "0.21"
```

### Common Rust-Specific Issues

1. **Borsh Serialization Order**
   - Ensure your struct fields match the IDL order exactly
   - Use `#[derive(AnchorSerialize, AnchorDeserialize)]`

2. **Account Ordering**
   - Double-check remaining accounts order matches TypeScript examples
   - Use explicit indices in comments

3. **Discriminator Calculation**
   - Use the correct discriminator from IDL: `[193, 32, 155, 51, 65, 214, 156, 129]`
   - Or calculate: `sha256("global:shared_accounts_route")[..8]`

4. **PDA Derivation**
   - Use exact same seeds as in the program: `b"vault_authority"`, `b"order_vault"`, etc.

### Full Working Example Repository

For a complete Rust client example, see:
- `programs/flipper/src/instructions/shared_route_module/mod.rs` - Server-side implementation
- Create a new `client-rust/` directory in your project for Rust client code

## Additional Resources

- [Jupiter API Documentation](https://station.jup.ag/docs/apis/swap-api)
- [Anchor Documentation](https://www.anchor-lang.com/)
- [Solana CPI Guide](https://docs.solana.com/developing/programming-model/calling-between-programs)

## Support

For issues or questions:
- Check test files in `tests/07. shared_jupiter_instructions.ts`
- Review devnet scripts in `scripts/devnet/`
- Consult mock implementation in `programs/mock_jupiter/src/lib.rs`
