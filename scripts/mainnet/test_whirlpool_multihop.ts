import * as anchor from "@coral-xyz/anchor";
import { Program, BN, AnchorProvider } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  Connection,
  Transaction,
  VersionedTransaction,
  AddressLookupTableProgram,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  createSyncNativeInstruction,
} from "@solana/spl-token";
import FLIPPER_IDL from "../../target/idl/flipper.json";
import fs from "fs";

// Function to load keypair for mainnet wallet
const loadKeypair = (): Keypair => {
  const keypairPath = process.env.HOME + "/.config/solana/fpp-staging.json";
  if (fs.existsSync(keypairPath)) {
    const secretKey = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
  }
  throw new Error(`Keypair file not found at ${keypairPath}`);
};

// Configure connection to Solana Mainnet
const connection = new Connection(
  "https://api.mainnet-beta.solana.com",
  "confirmed"
);

// Create wallet and provider for Anchor
const wallet = new anchor.Wallet(loadKeypair());
const provider = new AnchorProvider(connection, wallet, {
  commitment: "confirmed",
});
anchor.setProvider(provider);

// Load program
const flipperProgram = new Program(FLIPPER_IDL, provider);

// Mainnet constants
const WHIRLPOOL_PROGRAM_ID = new PublicKey(
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"
);
const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const PUMP_MINT = new PublicKey("pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn");
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const ORCA_MINT = new PublicKey("orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE");

// Whirlpool addresses from the log
// Step 0: SOL -> PUMP (Whirlpool V2)
const WHIRLPOOL_1 = new PublicKey(
  "BofA2ViUSudPBTUms2KRuG6AHNeMawjNfwqTJDgx5BKW"
);
const POOL_INFO_1 = new PublicKey(
  "4EcJMTCubP3NNF8XxWQbpfBHUmp9xM5QkcjPtW2JAEXa"
);
const TICK_ARRAY_0_1 = new PublicKey(
  "8EV1x6gWz3eXzJzekmKGo1tnds6JWNJRriHi8JywZX3E"
);
const TICK_ARRAY_1_1 = new PublicKey(
  "ECX85P5RzQfCV8jW3VuPAncnckkViEBgXuyhqCn3aSNo"
);
const TICK_ARRAY_2_1 = new PublicKey(
  "Es2kN9ZRTXGRTKuDhXPw7yqEd5ytJEV1qpi58VgfNPh5"
);
const ORACLE_1 = new PublicKey("9UXyKABdsimsf8qz4BLxP3d4QaL6rDQLbnMYBhjL6y8d");
const TOKEN_VAULT_A_1 = new PublicKey(
  "BkSYpPsv11UPDLonxBZf2mFndfuN2MrDwYt4gjDEnk8D"
);
const TOKEN_VAULT_B_1 = new PublicKey(
  "2wcLHj441NnqiUon4LcmMo6dGAUqwEW84nfFKnfuTnPt"
);

// Step 1: PUMP -> USDC (Whirlpool V2) - THIS IS WHERE THE ERROR OCCURS
const WHIRLPOOL_2 = new PublicKey(
  "DjJVnaiJYFjb76m4B4tdVJjxqyhRpb9yjjtCag5hbM2N"
);
const POOL_INFO_2 = new PublicKey(
  "9HdTTBzVTnmgSwBE1T3bAhj6FW54nqUZy71j5Rm46s1c"
);
const TICK_ARRAY_0_2 = new PublicKey(
  "6NBVKRprS3tRLJbzjwsudhG6wyCeZcAKuDQE4kEM5THt"
);
const TICK_ARRAY_1_2 = new PublicKey(
  "AmKR35tU6GG7Lx4h4dwWqukSmgHwsLJhXQ75yz2bge7c"
);
const TICK_ARRAY_2_2 = new PublicKey(
  "6R2C4iaa3PcG9RYtk4ZDMkDcLYimw8YepjxJ8khY21bU"
);
const ORACLE_2 = new PublicKey("83WWULZaHbjby5kx6tf7u5ecKiEK87nEDWqRtaUEZA8k");
const TOKEN_VAULT_A_2 = new PublicKey(
  "Ep1tN5xnXxJXxLbHQgFoPqFLtfk22LWtbtiywLr7PzM5"
);
const TOKEN_VAULT_B_2 = new PublicKey(
  "139uvUuFK8F4msmrhdVcpBvzPapEKfc8G6FCuaXkWdNP"
);

// Step 2: USDC -> ORCA (Whirlpool V1)
const WHIRLPOOL_3 = new PublicKey(
  "5Z66YYYaTmmx1R4mATAGLSc8aV4Vfy5tNdJQzk1GP9RF"
);
const POOL_INFO_3 = new PublicKey(
  "F3QK459DeMJzhWtfhnuaf4WZGxEQusZKnMv3ka1mdhbV"
);
const TICK_ARRAY_0_3 = new PublicKey(
  "7pTLnNa84sgav2qeU3vNbf6R9a9CcKrHdwJg5jihaHhx"
);
const TICK_ARRAY_1_3 = new PublicKey(
  "6Kt8Ss5C1MruKNVZVkr7TztnJ8PGTaPySMgfaDNSNevi"
);
const TICK_ARRAY_2_3 = new PublicKey(
  "CvKbGH2WJoQXsohf1SxT4c9he7RrsKAF8TSZifyJbuuM"
);
const ORACLE_3 = new PublicKey("GXcffFhSX1eq6Xq1iFhQMYDpNokHMvbuGV8etg6XQLiu");
const TOKEN_VAULT_A_3 = new PublicKey(
  "AGsWEmKndNhRbSFWtrcDVrsxfoM71j8pVmvGuEwJX8a1"
);
const TOKEN_VAULT_B_3 = new PublicKey(
  "2kSYyDFRQpWaouveza4JbyGKBVtd3im8E6wQnPYiwgH9"
);

const PLATFORM_FEE_ACCOUNT = new PublicKey(
  "3Ahw4EGFeq1oVa882GNisGYDVn8667qbrAu9tg9sJmJ3"
);

function getSwapTypeBytes(swapType: any): Buffer {
  const bytes = Buffer.alloc(32, 0);
  if ("whirlpool" in swapType) {
    bytes[0] = 17; // Whirlpool swap type (used for both SwapV2 and regular Swap)
    if (swapType.whirlpool.aToB !== undefined) {
      bytes[1] = swapType.whirlpool.aToB ? 1 : 0;
    }
  }
  return bytes;
}

async function main() {
  console.log("🚀 Testing Whirlpool Multihop Route on Mainnet\n");
  console.log("📍 Configuration:");
  console.log("   Wallet:", wallet.publicKey.toBase58());
  console.log("   Program ID:", flipperProgram.programId.toBase58());
  console.log("   Whirlpool Program ID:", WHIRLPOOL_PROGRAM_ID.toBase58());
  console.log("   Memo Program ID:", MEMO_PROGRAM_ID.toBase58());
  console.log("   WSOL Mint:", WSOL_MINT.toBase58());
  console.log("   PUMP Mint:", PUMP_MINT.toBase58());
  console.log("   USDC Mint:", USDC_MINT.toBase58());
  console.log("   ORCA Mint:", ORCA_MINT.toBase58(), "\n");

  // Derive PDAs
  const [adapterRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from("adapter_registry")],
    flipperProgram.programId
  );
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority")],
    flipperProgram.programId
  );

  // Pool Info PDAs from the log (these are already PDA addresses, not pool addresses)
  // POOL_INFO_1, POOL_INFO_2, POOL_INFO_3 are the PoolInfo PDA addresses from the log
  const poolInfo1 = POOL_INFO_1; // 4EcJMTCubP3NNF8XxWQbpfBHUmp9xM5QkcjPtW2JAEXa
  const poolInfo2 = POOL_INFO_2; // 9HdTTBzVTnmgSwBE1T3bAhj6FW54nqUZy71j5Rm46s1c
  const poolInfo3 = POOL_INFO_3; // F3QK459DeMJzhWtfhnuaf4WZGxEQusZKnMv3ka1mdhbV

  console.log("📍 PDAs:");
  console.log("   Adapter Registry:", adapterRegistry.toBase58());
  console.log("   Vault Authority:", vaultAuthority.toBase58());
  console.log("   Pool Info 1:", poolInfo1.toBase58());
  console.log("   Pool Info 2:", poolInfo2.toBase58());
  console.log("   Pool Info 3:", poolInfo3.toBase58(), "\n");

  // Create user token accounts (only source and destination)
  console.log("💰 Creating user token accounts...");

  // User source token account (WSOL) - input
  let userSourceTokenAccount: PublicKey;
  try {
    userSourceTokenAccount = getAssociatedTokenAddressSync(
      WSOL_MINT,
      wallet.publicKey,
      false,
      TOKEN_PROGRAM_ID
    );
    const wsolAccountInfo = await getAccount(
      connection,
      userSourceTokenAccount
    );
    console.log(
      "   ✓ User Source Token Account (WSOL) exists:",
      userSourceTokenAccount.toBase58()
    );
    console.log("   Balance:", wsolAccountInfo.amount.toString());
  } catch (e) {
    console.log("   Creating User Source Token Account (WSOL)...");
    const wsolAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      WSOL_MINT,
      wallet.publicKey,
      false
    );
    userSourceTokenAccount = wsolAccount.address;
    console.log(
      "   ✓ User Source Token Account (WSOL) created:",
      userSourceTokenAccount.toBase58()
    );
  }

  // User destination token account (ORCA) - output
  let userDestinationTokenAccount: PublicKey;
  try {
    userDestinationTokenAccount = getAssociatedTokenAddressSync(
      ORCA_MINT,
      wallet.publicKey,
      false,
      TOKEN_PROGRAM_ID
    );
    const orcaAccountInfo = await getAccount(
      connection,
      userDestinationTokenAccount
    );
    console.log(
      "   ✓ User Destination Token Account (ORCA) exists:",
      userDestinationTokenAccount.toBase58()
    );
    console.log("   Balance:", orcaAccountInfo.amount.toString());
  } catch (e) {
    console.log("   Creating User Destination Token Account (ORCA)...");
    const orcaAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      ORCA_MINT,
      wallet.publicKey,
      false
    );
    userDestinationTokenAccount = orcaAccount.address;
    console.log(
      "   ✓ User Destination Token Account (ORCA) created:",
      userDestinationTokenAccount.toBase58()
    );
  }
  console.log();

  // Vault accounts from the log (already exist)
  // [0] Input Vault (WSOL)
  const inputVault = new PublicKey(
    "A4LX43GLT2cmu2vubqZbVp93Nn5awYyG9CUs2TBd6tWG"
  );
  // [17] Intermediate Vault 1 (PUMP) - output of step 0, input of step 1
  const intermediateVault1 = new PublicKey(
    "ByDNvRjARxzvS9CE8kYTWJmobZ9VA34nR3CyopLhEx7e"
  );
  // [35] Intermediate Vault 2 (USDC) - output of step 1, input of step 2
  const intermediateVault2 = new PublicKey(
    "BuDCga2qoU2Ny4PC4w1d3cBcQ87e459AsSP2gotBsNTZ"
  );
  // [53] Output Vault (ORCA) - output of step 2
  const outputVault = new PublicKey(
    "A7pXj1YWvrS4qsGzjTHQ8unPSibrEPA3mYVvxWhKwuct"
  );

  console.log("🏦 Vault accounts (from log):");
  console.log("   Input Vault (WSOL):", inputVault.toBase58());
  console.log("   Intermediate Vault 1 (PUMP):", intermediateVault1.toBase58());
  console.log("   Intermediate Vault 2 (USDC):", intermediateVault2.toBase58());
  console.log("   Output Vault (ORCA):", outputVault.toBase58());
  console.log();

  // Token owner accounts from the log (vault accounts that receive tokens)
  // Step 0: SOL -> PUMP
  const tokenOwnerAccountA1 = new PublicKey(
    "91bUbswo6Di8235jAPwim1At4cPZLbG2pkpneyqKg4NQ"
  ); // WSOL vault
  const tokenOwnerAccountB1 = new PublicKey(
    "C4rYb1s9Rbn4ndZT4qxRk1bgsCdcZnSkmL8WgzuRSMUz"
  ); // PUMP vault

  // Step 1: PUMP -> USDC
  const tokenOwnerAccountA2 = new PublicKey(
    "C4rYb1s9Rbn4ndZT4qxRk1bgsCdcZnSkmL8WgzuRSMUz"
  ); // PUMP vault
  const tokenOwnerAccountB2 = new PublicKey(
    "Gjmjory7TWKJXD2Jc6hKzAG991wWutFhtbXudzJqgx3p"
  ); // USDC vault

  // Step 2: USDC -> ORCA
  const tokenOwnerAccountA3 = new PublicKey(
    "HxWUAKCojAhvkNZRy2X4cqkKeMUyYcvDmZsvWkzJYUQs"
  ); // USDC vault
  const tokenOwnerAccountB3 = new PublicKey(
    "Gjmjory7TWKJXD2Jc6hKzAG991wWutFhtbXudzJqgx3p"
  ); // ORCA vault

  // Check if PoolInfo exists, if not initialize them
  console.log("🔍 Checking PoolInfo accounts...");
  // Note: aToB direction is determined by the swap direction in the route plan
  // Step 0: SOL -> PUMP (a_to_b = true), pool address = WHIRLPOOL_1
  // Step 1: PUMP -> USDC (a_to_b = true), pool address = WHIRLPOOL_2
  // Step 2: USDC -> ORCA (a_to_b = false, swapping B -> A), pool address = WHIRLPOOL_3
  const poolInfosToCheck: Array<[PublicKey, PublicKey, any]> = [
    [poolInfo1, WHIRLPOOL_1, { whirlpool: { aToB: true } }],
    [poolInfo2, WHIRLPOOL_2, { whirlpool: { aToB: true } }],
    [poolInfo3, WHIRLPOOL_3, { whirlpool: { aToB: false } }],
  ];

  for (const [poolInfo, poolAddress, swapType] of poolInfosToCheck) {
    try {
      const poolInfoAccount = await (
        flipperProgram.account as any
      ).poolInfo.fetch(poolInfo);
      console.log(`   ✓ PoolInfo ${poolInfo.toBase58()} already exists`);
      console.log(`     Enabled: ${poolInfoAccount.enabled}`);
      console.log(
        `     Pool Address: ${poolInfoAccount.poolAddress.toBase58()}`
      );
    } catch (e: any) {
      if (e.message && e.message.includes("Account does not exist")) {
        console.log(
          `   ⚠️  PoolInfo ${poolInfo.toBase58()} does not exist, initializing...`
        );
        try {
          const initTxSignature = await flipperProgram.methods
            .initializePoolInfo(swapType, poolAddress)
            .accounts({
              poolInfo: poolInfo,
              adapterRegistry,
              payer: wallet.publicKey,
              operator: wallet.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([wallet.payer])
            .rpc();

          console.log(`   ✓ PoolInfo initialized`);
          console.log(`   Transaction: ${initTxSignature}`);
        } catch (initError: any) {
          console.error(
            `   ❌ Failed to initialize PoolInfo: ${initError.message}`
          );
          throw initError;
        }
      } else {
        throw e;
      }
    }
  }
  console.log();

  // Prepare route plan
  // Step 0: SOL -> PUMP (input_index=0, output_index=17, a_to_b=true)
  // Step 1: PUMP -> USDC (input_index=18, output_index=35, a_to_b=true)
  // Step 2: USDC -> ORCA (input_index=36, output_index=53, a_to_b=false)
  // Note: All steps use Swap::Whirlpool type, but SwapV2 uses different discriminator
  const routePlan = [
    {
      swap: { whirlpool: { aToB: true } },
      inputIndex: 0,
      outputIndex: 17,
      percent: 100,
    },
    {
      swap: { whirlpool: { aToB: true } },
      inputIndex: 18,
      outputIndex: 35,
      percent: 100,
    },
    {
      swap: { whirlpool: { aToB: false } },
      inputIndex: 36,
      outputIndex: 53,
      percent: 100,
    },
  ];

  // Prepare remaining accounts
  // Structure for each Whirlpool swap:
  // [0] Input Vault
  // [1] Pool Info
  // [2] Token Program A
  // [3] Token Program B
  // [4] Memo Program
  // [5] Whirlpool
  // [6] Token Mint A
  // [7] Token Mint B
  // [8] Token Owner Account A
  // [9] Token Vault A
  // [10] Token Owner Account B
  // [11] Token Vault B
  // [12] Tick Array 0
  // [13] Tick Array 1
  // [14] Tick Array 2
  // [15] Oracle
  // [16] Program ID
  // [17] Output Vault (intermediate or final)

  const remainingAccounts = [
    // Step 0: SOL -> PUMP (Whirlpool V2)
    { pubkey: inputVault, isWritable: true, isSigner: false }, // 0: input vault
    { pubkey: poolInfo1, isWritable: false, isSigner: false }, // 1: pool_info
    { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false }, // 2: token_program_a
    { pubkey: TOKEN_2022_PROGRAM_ID, isWritable: false, isSigner: false }, // 3: token_program_b
    { pubkey: MEMO_PROGRAM_ID, isWritable: false, isSigner: false }, // 4: memo_program
    { pubkey: WHIRLPOOL_1, isWritable: true, isSigner: false }, // 5: whirlpool
    { pubkey: WSOL_MINT, isWritable: false, isSigner: false }, // 6: token_mint_a
    { pubkey: PUMP_MINT, isWritable: false, isSigner: false }, // 7: token_mint_b
    { pubkey: tokenOwnerAccountA1, isWritable: true, isSigner: false }, // 8: token_owner_account_a
    { pubkey: TOKEN_VAULT_A_1, isWritable: true, isSigner: false }, // 9: token_vault_a
    { pubkey: tokenOwnerAccountB1, isWritable: true, isSigner: false }, // 10: token_owner_account_b
    { pubkey: TOKEN_VAULT_B_1, isWritable: true, isSigner: false }, // 11: token_vault_b
    { pubkey: TICK_ARRAY_0_1, isWritable: true, isSigner: false }, // 12: tick_array_0
    { pubkey: TICK_ARRAY_1_1, isWritable: true, isSigner: false }, // 13: tick_array_1
    { pubkey: TICK_ARRAY_2_1, isWritable: true, isSigner: false }, // 14: tick_array_2
    { pubkey: ORACLE_1, isWritable: true, isSigner: false }, // 15: oracle
    { pubkey: WHIRLPOOL_PROGRAM_ID, isWritable: false, isSigner: false }, // 16: program
    { pubkey: intermediateVault1, isWritable: true, isSigner: false }, // 17: output vault (PUMP)

    // Step 1: PUMP -> USDC (Whirlpool V2) - ERROR OCCURS HERE
    { pubkey: intermediateVault1, isWritable: true, isSigner: false }, // 18: input vault (PUMP)
    { pubkey: poolInfo2, isWritable: false, isSigner: false }, // 19: pool_info
    { pubkey: TOKEN_2022_PROGRAM_ID, isWritable: false, isSigner: false }, // 20: token_program_a
    { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false }, // 21: token_program_b
    { pubkey: MEMO_PROGRAM_ID, isWritable: false, isSigner: false }, // 22: memo_program
    { pubkey: WHIRLPOOL_2, isWritable: true, isSigner: false }, // 23: whirlpool
    { pubkey: PUMP_MINT, isWritable: false, isSigner: false }, // 24: token_mint_a
    { pubkey: USDC_MINT, isWritable: false, isSigner: false }, // 25: token_mint_b
    { pubkey: tokenOwnerAccountA2, isWritable: true, isSigner: false }, // 26: token_owner_account_a
    { pubkey: TOKEN_VAULT_A_2, isWritable: true, isSigner: false }, // 27: token_vault_a
    { pubkey: tokenOwnerAccountB2, isWritable: true, isSigner: false }, // 28: token_owner_account_b
    { pubkey: TOKEN_VAULT_B_2, isWritable: true, isSigner: false }, // 29: token_vault_b
    { pubkey: TICK_ARRAY_0_2, isWritable: true, isSigner: false }, // 30: tick_array_0
    { pubkey: TICK_ARRAY_1_2, isWritable: true, isSigner: false }, // 31: tick_array_1
    { pubkey: TICK_ARRAY_2_2, isWritable: true, isSigner: false }, // 32: tick_array_2
    { pubkey: ORACLE_2, isWritable: true, isSigner: false }, // 33: oracle
    { pubkey: WHIRLPOOL_PROGRAM_ID, isWritable: false, isSigner: false }, // 34: program
    { pubkey: intermediateVault2, isWritable: true, isSigner: false }, // 35: output vault (USDC)

    // Step 2: USDC -> ORCA (Whirlpool V1)
    { pubkey: intermediateVault2, isWritable: true, isSigner: false }, // 36: input vault (USDC)
    { pubkey: poolInfo3, isWritable: false, isSigner: false }, // 37: pool_info
    { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false }, // 38: token_program_a
    { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false }, // 39: token_program_b
    { pubkey: MEMO_PROGRAM_ID, isWritable: false, isSigner: false }, // 40: memo_program
    { pubkey: WHIRLPOOL_3, isWritable: true, isSigner: false }, // 41: whirlpool
    { pubkey: USDC_MINT, isWritable: false, isSigner: false }, // 42: token_mint_a
    { pubkey: ORCA_MINT, isWritable: false, isSigner: false }, // 43: token_mint_b
    { pubkey: tokenOwnerAccountA3, isWritable: true, isSigner: false }, // 44: token_owner_account_a
    { pubkey: TOKEN_VAULT_A_3, isWritable: true, isSigner: false }, // 45: token_vault_a
    { pubkey: tokenOwnerAccountB3, isWritable: true, isSigner: false }, // 46: token_owner_account_b
    { pubkey: TOKEN_VAULT_B_3, isWritable: true, isSigner: false }, // 47: token_vault_b
    { pubkey: TICK_ARRAY_0_3, isWritable: true, isSigner: false }, // 48: tick_array_0
    { pubkey: TICK_ARRAY_1_3, isWritable: true, isSigner: false }, // 49: tick_array_1
    { pubkey: TICK_ARRAY_2_3, isWritable: true, isSigner: false }, // 50: tick_array_2
    { pubkey: ORACLE_3, isWritable: true, isSigner: false }, // 51: oracle
    { pubkey: WHIRLPOOL_PROGRAM_ID, isWritable: false, isSigner: false }, // 52: program
    { pubkey: outputVault, isWritable: true, isSigner: false }, // 53: output vault (ORCA)
  ];

  console.log("📋 Route Plan:");
  routePlan.forEach((step, idx) => {
    console.log(
      `   Step ${idx}: swap=${JSON.stringify(step.swap)}, input_index=${
        step.inputIndex
      }, output_index=${step.outputIndex}, percent=${step.percent}`
    );
  });
  console.log();

  console.log("📋 Remaining Accounts:", remainingAccounts.length);
  remainingAccounts.forEach((acc, idx) => {
    console.log(
      `   [${idx}] ${acc.pubkey.toBase58()} (writable: ${
        acc.isWritable
      }, signer: ${acc.isSigner})`
    );
  });
  console.log();

  // Get initial balances
  let initialWsolBalance: bigint;
  let initialOrcaBalance: bigint;

  try {
    const wsolAccountInfo = await getAccount(
      connection,
      userSourceTokenAccount
    );
    initialWsolBalance = wsolAccountInfo.amount;
  } catch (e) {
    console.log("   ⚠️  WSOL account not found, initializing with 0");
    initialWsolBalance = BigInt(0);
  }

  try {
    const orcaAccountInfo = await getAccount(
      connection,
      userDestinationTokenAccount
    );
    initialOrcaBalance = orcaAccountInfo.amount;
  } catch (e) {
    console.log("   ⚠️  ORCA account not found, initializing with 0");
    initialOrcaBalance = BigInt(0);
  }

  console.log("💰 Initial Balances:");
  console.log("   WSOL:", initialWsolBalance.toString());
  console.log("   ORCA:", initialOrcaBalance.toString());
  console.log();

  // Swap parameters
  const inAmount = new BN(1_000_000); // 0.001 WSOL (9 decimals)
  const quotedOutAmount = new BN(316_178); // Expected ORCA output (from log)
  const slippageBps = 50; // 0.5%
  const platformFeeBps = 0; // 0%

  console.log("🔄 Swap Parameters:");
  console.log("   Input Amount:", inAmount.toString(), "WSOL");
  console.log("   Quoted Output:", quotedOutAmount.toString(), "ORCA");
  console.log("   Slippage:", slippageBps, "bps (0.5%)");
  console.log("   Platform Fee:", platformFeeBps, "bps");
  console.log();

  // Check if user has enough WSOL balance, if not, wrap SOL to WSOL
  if (initialWsolBalance < BigInt(inAmount.toString())) {
    console.log("⚠️  Insufficient WSOL balance. Wrapping SOL to WSOL...");
    const neededAmount = BigInt(inAmount.toString()) - initialWsolBalance;
    const solNeeded = neededAmount + BigInt(2_000_000); // Add extra for rent and fees

    const solBalance = await connection.getBalance(wallet.publicKey);
    console.log("   SOL Balance:", solBalance);
    console.log("   SOL Needed:", solNeeded.toString());

    if (solBalance < Number(solNeeded)) {
      throw new Error(
        `Insufficient SOL balance. Need ${solNeeded.toString()} lamports, have ${solBalance}`
      );
    }

    const transferInstruction = SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: userSourceTokenAccount,
      lamports: Number(solNeeded),
    });

    const syncNativeInstruction = createSyncNativeInstruction(
      userSourceTokenAccount
    );

    const wrapTx = new Transaction()
      .add(transferInstruction)
      .add(syncNativeInstruction);
    const wrapSignature = await provider.sendAndConfirm(wrapTx);
    console.log("   ✓ SOL wrapped to WSOL");
    console.log("   Transaction:", wrapSignature);

    const updatedWsolAccount = await getAccount(
      connection,
      userSourceTokenAccount
    );
    initialWsolBalance = updatedWsolAccount.amount;
    console.log("   Updated WSOL Balance:", initialWsolBalance.toString());
    console.log();
  }

  // Address Lookup Tables
  const addressLookupTables: PublicKey[] = [
    new PublicKey("FZM4c37i2MQLtBUxVcFpUkTZwuG7tyJPQRBZDNCNV3kN"),
  ];

  console.log("📋 Address Lookup Tables:");
  addressLookupTables.forEach((alt, idx) => {
    console.log(`   [${idx}] ${alt.toBase58()}`);
  });
  console.log();

  // Execute route
  console.log("⚡ Executing route...");
  try {
    // Build instruction
    const instruction = await flipperProgram.methods
      .route(routePlan, inAmount, quotedOutAmount, slippageBps, platformFeeBps)
      .accounts({
        adapterRegistry,
        vaultAuthority,
        inputTokenProgram: TOKEN_PROGRAM_ID,
        outputTokenProgram: TOKEN_PROGRAM_ID,
        userTransferAuthority: wallet.publicKey,
        userSourceTokenAccount: userSourceTokenAccount,
        userDestinationTokenAccount: userDestinationTokenAccount,
        sourceMint: WSOL_MINT,
        destinationMint: ORCA_MINT,
        platformFeeAccount: PLATFORM_FEE_ACCOUNT,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(remainingAccounts)
      .instruction();

    // Fetch address lookup tables
    const lookupTables = await Promise.all(
      addressLookupTables.map(async (altAddress) => {
        const altAccountInfo = await connection.getAddressLookupTable(
          altAddress
        );
        if (!altAccountInfo.value) {
          throw new Error(
            `Address Lookup Table ${altAddress.toBase58()} not found`
          );
        }
        return altAccountInfo.value;
      })
    );

    // Build versioned transaction
    const { blockhash } = await connection.getLatestBlockhash();
    const messageV0 = new anchor.web3.TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: blockhash,
      instructions: [instruction],
    }).compileToV0Message(lookupTables);

    const transaction = new VersionedTransaction(messageV0);
    transaction.sign([wallet.payer]);

    // Send and confirm transaction
    const txSignature = await connection.sendTransaction(transaction);
    await connection.confirmTransaction(txSignature, "confirmed");

    console.log("✅ Route executed successfully!");
    console.log("   Transaction signature:", txSignature);
    console.log("   Explorer:", `https://solscan.io/tx/${txSignature}`);
    console.log();

    const finalWsolBalance = (
      await getAccount(connection, userSourceTokenAccount)
    ).amount;
    const finalOrcaBalance = (
      await getAccount(connection, userDestinationTokenAccount)
    ).amount;

    console.log("💰 Final Balances:");
    console.log("   WSOL:", finalWsolBalance.toString());
    console.log("   ORCA:", finalOrcaBalance.toString());
    console.log();

    console.log("📊 Balance Changes:");
    console.log("   WSOL:", (finalWsolBalance - initialWsolBalance).toString());
    console.log("   ORCA:", (finalOrcaBalance - initialOrcaBalance).toString());
    console.log();

    const wsolDiff = Number(finalWsolBalance - initialWsolBalance);
    const orcaDiff = Number(finalOrcaBalance - initialOrcaBalance);

    if (wsolDiff < 0 && orcaDiff > 0) {
      console.log("✅ Swap completed successfully!");
      console.log(`   Swapped ${Math.abs(wsolDiff)} WSOL for ${orcaDiff} ORCA`);
    } else {
      console.log("⚠️  Unexpected balance changes");
    }
  } catch (error: any) {
    console.error("❌ Route execution failed:");
    console.error("   Error:", error.message);
    if (error.logs) {
      console.error("   Logs:");
      error.logs.forEach((log: string) => console.error("     ", log));
    }
    throw error;
  }
}

// Main execution
(async () => {
  try {
    await main();
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
})();
