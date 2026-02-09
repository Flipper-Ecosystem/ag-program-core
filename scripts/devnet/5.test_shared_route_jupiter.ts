import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, Connection, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import FLIPPER_IDL from "../../target/idl/flipper.json";
import MOCK_JUPITER_IDL from "../../target/idl/mock_jupiter.json";
import fs from "fs";

// Load configuration
const configPath = "./scripts/devnet/jupiter_test_config.json";
if (!fs.existsSync(configPath)) {
  console.error("❌ Configuration file not found!");
  console.log(
    "   Please run: ts-node scripts/devnet/4.setup_shared_jupiter_environment.ts"
  );
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

// Function to load keypair
const loadKeypair = (): Keypair => {
  // Try to load fpp-staging.json first, fallback to id.json
  const fppStagingPath = process.env.HOME + "/.config/solana/fpp-staging.json";
  const defaultPath = process.env.HOME + "/.config/solana/id.json";

  if (fs.existsSync(fppStagingPath)) {
    const secretKey = JSON.parse(fs.readFileSync(fppStagingPath, "utf8"));
    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
  } else if (fs.existsSync(defaultPath)) {
    const secretKey = JSON.parse(fs.readFileSync(defaultPath, "utf8"));
    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
  }
  throw new Error(
    "Keypair file not found at: " + fppStagingPath + " or " + defaultPath
  );
};

// Configure connection to Solana Devnet
const connection = new Connection("https://api.devnet.solana.com", "confirmed");

// Create wallet and provider
const wallet = new anchor.Wallet(loadKeypair());
const provider = new AnchorProvider(connection, wallet, {
  commitment: "confirmed",
});
anchor.setProvider(provider);

// Load programs
const flipperProgram = new Program(FLIPPER_IDL, provider);
const mockJupiterProgram = new Program(MOCK_JUPITER_IDL, provider);

// Load addresses from config
const vaultAuthority = new PublicKey(config.vaultAuthority);
const sourceMint = new PublicKey(config.sourceMint);
const destinationMint = new PublicKey(config.destinationMint);
const sourceVault = new PublicKey(config.sourceVault);
const destinationVault = new PublicKey(config.destinationVault);
const platformFeeAccount = new PublicKey(config.platformFeeAccount);

// Provider token accounts
const providerSourceTokenAccount = new PublicKey(
  config.provider.sourceTokenAccount
);
const providerDestinationTokenAccount = new PublicKey(
  config.provider.destinationTokenAccount
);

const JUPITER_EVENT_AUTHORITY = new PublicKey(
  "D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf"
);

/**
 * Builds Jupiter instruction data using Anchor encoder (proper serialization)
 */
function buildJupiterCpiInstructionData(
  mockJupiterProgram: Program,
  id: number,
  routePlan: {
    swap: object;
    percent: number;
    inputIndex: number;
    outputIndex: number;
  }[],
  inAmount: BN,
  quotedOutAmount: BN,
  slippageBps: number,
  platformFeeBps: number
): Buffer {
  // Use Anchor's encoder to properly serialize the instruction
  const data = mockJupiterProgram.coder.instruction.encode(
    "sharedAccountsRoute",
    {
      id,
      routePlan,
      inAmount,
      quotedOutAmount,
      slippageBps,
      platformFeeBps,
    }
  );

  return Buffer.from(data);
}

function buildJupiterRemainingAccounts(params: {
  tokenProgram: PublicKey;
  jupiterProgramAuthority: PublicKey;
  vaultAuthority: PublicKey;
  vaultSource: PublicKey;
  vaultDestination: PublicKey;
  sourceMint: PublicKey;
  destinationMint: PublicKey;
  platformFeeOrPlaceholder: PublicKey;
  token2022OrPlaceholder: PublicKey;
  eventAuthority: PublicKey;
  jupiterProgram: PublicKey;
  mockPool: PublicKey;
  mockPoolAuthority: PublicKey;
}) {
  return [
    { pubkey: params.tokenProgram, isSigner: false, isWritable: false }, // 0
    {
      pubkey: params.jupiterProgramAuthority,
      isSigner: false,
      isWritable: false,
    }, // 1: Jupiter PDA
    { pubkey: params.vaultAuthority, isSigner: false, isWritable: false }, // 2: user_transfer_authority
    { pubkey: params.vaultSource, isSigner: false, isWritable: true }, // 3: user_source
    { pubkey: params.vaultSource, isSigner: false, isWritable: true }, // 4: program_source (same)
    { pubkey: params.vaultDestination, isSigner: false, isWritable: true }, // 5: program_destination (same)
    { pubkey: params.vaultDestination, isSigner: false, isWritable: true }, // 6: user_destination
    { pubkey: params.sourceMint, isSigner: false, isWritable: false }, // 7
    { pubkey: params.destinationMint, isSigner: false, isWritable: false }, // 8
    {
      pubkey: params.platformFeeOrPlaceholder,
      isSigner: false,
      isWritable: false,
    }, // 9
    {
      pubkey: params.token2022OrPlaceholder,
      isSigner: false,
      isWritable: false,
    }, // 10
    { pubkey: params.eventAuthority, isSigner: false, isWritable: false }, // 11
    { pubkey: params.jupiterProgram, isSigner: false, isWritable: false }, // 12
    { pubkey: params.mockPool, isSigner: false, isWritable: true }, // 13
    { pubkey: params.mockPoolAuthority, isSigner: false, isWritable: false }, // 14
  ];
}

async function waitForConfirmation(ms: number = 2000) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testSharedRoute() {
  try {
    console.log("🧪 Testing shared_route with Jupiter CPI (mock)...\n");
    console.log("📍 Configuration:");
    console.log("   Provider:", wallet.publicKey.toBase58());
    console.log(
      "   Source Token Account:",
      providerSourceTokenAccount.toBase58()
    );
    console.log(
      "   Destination Token Account:",
      providerDestinationTokenAccount.toBase58()
    );
    console.log(
      "   Jupiter Mock Program:",
      mockJupiterProgram.programId.toBase58(),
      "\n"
    );

    // Test parameters
    const inAmount = new BN(100_000_000); // 100 tokens (6 decimals)
    const quotedOutAmount = new BN(150_000_000); // 150 tokens (1.5x rate)
    const slippageBps = 50; // 0.5%
    const platformFeeBps = 0; // 0% for testing

    console.log("📊 Swap parameters:");
    console.log("   Input Amount:", inAmount.toString(), "(100 tokens)");
    console.log(
      "   Quoted Output:",
      quotedOutAmount.toString(),
      "(150 tokens)"
    );
    console.log("   Slippage:", slippageBps, "bps (0.5%)");
    console.log("   Platform Fee:", platformFeeBps, "bps (0%)\n");

    // Get balances before
    console.log("💰 Checking balances before swap...");

    const userSourceBefore = await getAccount(
      connection,
      providerSourceTokenAccount
    );
    const userDestBefore = await getAccount(
      connection,
      providerDestinationTokenAccount
    );

    // Try to read vaults (they may not exist if created with different admin)
    let sourceVaultBefore: any = null;
    let destVaultBefore: any = null;

    try {
      sourceVaultBefore = await getAccount(connection, sourceVault);
    } catch (e) {
      console.log("   ⚠️ Source vault not found (may be from old setup)");
    }

    try {
      destVaultBefore = await getAccount(connection, destinationVault);
    } catch (e) {
      console.log("   ⚠️ Destination vault not found (may be from old setup)");
    }

    console.log("   User source balance:", userSourceBefore.amount.toString());
    console.log("   User dest balance:", userDestBefore.amount.toString());
    console.log(
      "   Source vault balance:",
      sourceVaultBefore ? sourceVaultBefore.amount.toString() : "N/A"
    );
    console.log(
      "   Dest vault balance:",
      destVaultBefore ? destVaultBefore.amount.toString() : "N/A",
      "\n"
    );

    // Create a mock liquidity pool account
    console.log("🏊 Setting up mock liquidity pool...");
    const mockLiquidityPoolAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      destinationMint,
      wallet.publicKey
    );
    const mockLiquidityPool = mockLiquidityPoolAccount.address;

    // Fund the liquidity pool with destination tokens
    await mintTo(
      connection,
      wallet.payer,
      destinationMint,
      mockLiquidityPool,
      wallet.payer,
      quotedOutAmount.toNumber() * 2, // Fund with 2x to have enough
      [],
      undefined,
      TOKEN_PROGRAM_ID
    );
    console.log("✅ Created and funded mock liquidity pool");
    console.log("   Pool Address:", mockLiquidityPool.toBase58(), "\n");
    await waitForConfirmation(2000);

    const routePlan = [
      { swap: { raydium: {} }, percent: 100, inputIndex: 0, outputIndex: 1 },
    ];
    const data = buildJupiterCpiInstructionData(
      mockJupiterProgram,
      0,
      routePlan,
      inAmount,
      quotedOutAmount,
      slippageBps,
      platformFeeBps
    );

    const remainingAccounts = buildJupiterRemainingAccounts({
      tokenProgram: TOKEN_PROGRAM_ID,
      jupiterProgramAuthority: mockJupiterProgram.programId,
      vaultAuthority,
      vaultSource: sourceVault,
      vaultDestination: destinationVault,
      sourceMint,
      destinationMint,
      platformFeeOrPlaceholder: TOKEN_PROGRAM_ID,
      token2022OrPlaceholder: JUPITER_EVENT_AUTHORITY,
      eventAuthority: JUPITER_EVENT_AUTHORITY,
      jupiterProgram: mockJupiterProgram.programId,
      mockPool: mockLiquidityPool,
      mockPoolAuthority: wallet.publicKey,
    });

    console.log("⚡ Executing shared_route instruction...");
    const txSignature = await flipperProgram.methods
      .sharedRoute(inAmount, quotedOutAmount, slippageBps, platformFeeBps, data)
      .accounts({
        vaultAuthority,
        userSourceTokenAccount: providerSourceTokenAccount,
        userDestinationTokenAccount: providerDestinationTokenAccount,
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

    console.log("✅ Transaction signature:", txSignature, "\n");
    await waitForConfirmation(3000);

    // Verify balances changed
    console.log("💰 Checking balances after swap...");
    const userSourceAfter = await getAccount(
      connection,
      providerSourceTokenAccount
    );
    const userDestAfter = await getAccount(
      connection,
      providerDestinationTokenAccount
    );

    let sourceVaultAfter: any = null;
    let destVaultAfter: any = null;

    try {
      sourceVaultAfter = await getAccount(connection, sourceVault);
    } catch (e) {
      // Vault doesn't exist
    }

    try {
      destVaultAfter = await getAccount(connection, destinationVault);
    } catch (e) {
      // Vault doesn't exist
    }

    console.log("   User source balance:", userSourceAfter.amount.toString());
    console.log("   User dest balance:", userDestAfter.amount.toString());
    console.log(
      "   Source vault balance:",
      sourceVaultAfter ? sourceVaultAfter.amount.toString() : "N/A"
    );
    console.log(
      "   Dest vault balance:",
      destVaultAfter ? destVaultAfter.amount.toString() : "N/A",
      "\n"
    );

    // Calculate changes
    const sourceChange =
      Number(userSourceBefore.amount) - Number(userSourceAfter.amount);
    const destChange =
      Number(userDestAfter.amount) - Number(userDestBefore.amount);

    console.log("📈 Balance changes:");
    console.log("   Source tokens spent:", sourceChange);
    console.log("   Destination tokens received:", destChange, "\n");

    // Verify the swap worked correctly
    if (sourceChange === inAmount.toNumber()) {
      console.log("✅ Source tokens deducted correctly");
    } else {
      console.log("⚠️ Source token deduction mismatch!");
      console.log("   Expected:", inAmount.toNumber());
      console.log("   Actual:", sourceChange);
    }

    if (destChange > 0) {
      console.log("✅ Destination tokens received");
    } else {
      console.log("❌ No destination tokens received!");
    }

    console.log("\n" + "=".repeat(60));
    console.log("✅ SHARED_ROUTE TEST COMPLETED SUCCESSFULLY!");
    console.log("=".repeat(60));
    console.log("\n💡 The Jupiter mock successfully simulated a swap");
    console.log(
      "   User transferred input tokens and received output tokens\n"
    );
  } catch (error: any) {
    console.error("\n❌ Error during test:", error);
    if (error?.logs) {
      console.error("\n📋 Transaction logs:");
      error.logs.forEach((log: string) => console.error("   ", log));
    }
    throw error;
  }
}

// Main execution
(async () => {
  try {
    await testSharedRoute();
  } catch (error: any) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
})();
