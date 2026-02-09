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
const adapterRegistry = new PublicKey(config.adapterRegistry);
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

// Test address token accounts
const testAddressSourceTokenAccount = new PublicKey(
  config.testAddress.sourceTokenAccount
);
const testAddressDestinationTokenAccount = new PublicKey(
  config.testAddress.destinationTokenAccount
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
    { pubkey: params.vaultSource, isSigner: false, isWritable: true }, // 4: program_source
    { pubkey: params.vaultDestination, isSigner: false, isWritable: true }, // 5: program_destination
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

async function verifyConfiguration() {
  console.log("🔍 Verifying Jupiter Mock Configuration...\n");
  console.log("=".repeat(60));

  let passed = 0;
  let failed = 0;

  // Check 1: Verify programs exist
  console.log("\n📦 1. Checking Programs...");
  try {
    const flipperAccount = await connection.getAccountInfo(
      flipperProgram.programId
    );
    const jupiterAccount = await connection.getAccountInfo(
      mockJupiterProgram.programId
    );

    if (flipperAccount && flipperAccount.executable) {
      console.log(
        "   ✅ Flipper program:",
        flipperProgram.programId.toBase58()
      );
      passed++;
    } else {
      console.log("   ❌ Flipper program not found or not executable");
      failed++;
    }

    if (jupiterAccount && jupiterAccount.executable) {
      console.log(
        "   ✅ Mock Jupiter program:",
        mockJupiterProgram.programId.toBase58()
      );
      passed++;
    } else {
      console.log("   ❌ Mock Jupiter program not found or not executable");
      failed++;
    }
  } catch (e: any) {
    console.log("   ❌ Error checking programs:", e.message);
    failed += 2;
  }

  // Check 2: Verify PDAs
  console.log("\n🔑 2. Checking PDAs...");
  try {
    const vaultAuthorityAccount = await connection.getAccountInfo(
      vaultAuthority
    );
    const adapterRegistryAccount = await connection.getAccountInfo(
      adapterRegistry
    );

    if (vaultAuthorityAccount) {
      console.log("   ✅ Vault authority:", vaultAuthority.toBase58());
      passed++;
    } else {
      console.log("   ❌ Vault authority not initialized");
      failed++;
    }

    if (adapterRegistryAccount) {
      console.log("   ✅ Adapter registry:", adapterRegistry.toBase58());
      passed++;
    } else {
      console.log("   ❌ Adapter registry not initialized");
      failed++;
    }
  } catch (e: any) {
    console.log("   ❌ Error checking PDAs:", e.message);
    failed += 2;
  }

  // Check 3: Verify Mints
  console.log("\n🪙 3. Checking Token Mints...");
  try {
    const sourceAccount = await connection.getAccountInfo(sourceMint);
    const destAccount = await connection.getAccountInfo(destinationMint);

    if (sourceAccount) {
      console.log("   ✅ Source mint:", sourceMint.toBase58());
      passed++;
    } else {
      console.log("   ❌ Source mint not found");
      failed++;
    }

    if (destAccount) {
      console.log("   ✅ Destination mint:", destinationMint.toBase58());
      passed++;
    } else {
      console.log("   ❌ Destination mint not found");
      failed++;
    }
  } catch (e: any) {
    console.log("   ❌ Error checking mints:", e.message);
    failed += 2;
  }

  // Check 4: Verify Vaults
  console.log("\n🏦 4. Checking Token Vaults...");
  try {
    const sourceVaultAccount = await getAccount(connection, sourceVault);
    const destVaultAccount = await getAccount(connection, destinationVault);

    console.log("   ✅ Source vault:", sourceVault.toBase58());
    console.log("      Balance:", sourceVaultAccount.amount.toString());
    passed++;

    console.log("   ✅ Destination vault:", destinationVault.toBase58());
    console.log("      Balance:", destVaultAccount.amount.toString());
    passed++;
  } catch (e: any) {
    console.log("   ❌ Error checking vaults:", e.message);
    failed += 2;
  }

  // Check 5: Verify Provider Token Accounts
  console.log("\n👤 5. Checking Provider Token Accounts...");
  console.log("   Provider:", wallet.publicKey.toBase58());
  try {
    const providerSourceAccount = await getAccount(
      connection,
      providerSourceTokenAccount
    );
    const providerDestAccount = await getAccount(
      connection,
      providerDestinationTokenAccount
    );

    console.log(
      "   ✅ Source token account:",
      providerSourceTokenAccount.toBase58()
    );
    console.log("      Balance:", providerSourceAccount.amount.toString());
    passed++;

    console.log(
      "   ✅ Destination token account:",
      providerDestinationTokenAccount.toBase58()
    );
    console.log("      Balance:", providerDestAccount.amount.toString());
    passed++;
  } catch (e: any) {
    console.log("   ❌ Error checking provider token accounts:", e.message);
    failed += 2;
  }

  // Check 6: Verify Test Address Token Accounts
  console.log("\n👤 6. Checking Test Address Token Accounts...");
  console.log("   Test Address:", config.testAddress.owner);
  try {
    const testSourceAccount = await getAccount(
      connection,
      testAddressSourceTokenAccount
    );
    const testDestAccount = await getAccount(
      connection,
      testAddressDestinationTokenAccount
    );

    console.log(
      "   ✅ Source token account:",
      testAddressSourceTokenAccount.toBase58()
    );
    console.log("      Balance:", testSourceAccount.amount.toString());
    passed++;

    console.log(
      "   ✅ Destination token account:",
      testAddressDestinationTokenAccount.toBase58()
    );
    console.log("      Balance:", testDestAccount.amount.toString());
    passed++;
  } catch (e: any) {
    console.log("   ❌ Error checking test address token accounts:", e.message);
    failed += 2;
  }

  // Check 7: Verify Platform Fee Account
  console.log("\n💰 7. Checking Platform Fee Account...");
  try {
    const feeAccount = await getAccount(connection, platformFeeAccount);
    console.log("   ✅ Platform fee account:", platformFeeAccount.toBase58());
    console.log("      Balance:", feeAccount.amount.toString());
    passed++;
  } catch (e: any) {
    console.log("   ❌ Error checking platform fee account:", e.message);
    failed++;
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("📊 VERIFICATION SUMMARY");
  console.log("=".repeat(60));
  console.log(`   ✅ Passed: ${passed}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`   📈 Total: ${passed + failed}`);

  if (failed === 0) {
    console.log("\n🎉 ALL CHECKS PASSED! Configuration is ready for testing.");
    return true;
  } else {
    console.log("\n⚠️ Some checks failed. Please review the setup.");
    return false;
  }
}

async function performIntegrationTest() {
  console.log("\n\n🧪 Performing Integration Test...\n");
  console.log("=".repeat(60));

  try {
    // Test parameters
    const inAmount = new BN(10_000_000); // 10 tokens
    const quotedOutAmount = new BN(15_000_000); // 15 tokens
    const slippageBps = 50;
    const platformFeeBps = 0;

    console.log("\n📊 Test swap parameters:");
    console.log("   Input Amount:", inAmount.toString(), "(10 tokens)");
    console.log("   Quoted Output:", quotedOutAmount.toString(), "(15 tokens)");
    console.log("   Slippage:", slippageBps, "bps");
    console.log("   Platform Fee:", platformFeeBps, "bps\n");

    // Get balances before
    const providerSourceBefore = await getAccount(
      connection,
      providerSourceTokenAccount
    );
    const providerDestBefore = await getAccount(
      connection,
      providerDestinationTokenAccount
    );

    console.log("💰 Balances before test swap:");
    console.log("   Source:", providerSourceBefore.amount.toString());
    console.log("   Destination:", providerDestBefore.amount.toString(), "\n");

    // Create mock liquidity pool
    console.log("🏊 Setting up mock liquidity pool...");
    const mockLiquidityPoolAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      destinationMint,
      wallet.publicKey
    );
    const mockLiquidityPool = mockLiquidityPoolAccount.address;

    await mintTo(
      connection,
      wallet.payer,
      destinationMint,
      mockLiquidityPool,
      wallet.payer,
      quotedOutAmount.toNumber() * 2,
      [],
      undefined,
      TOKEN_PROGRAM_ID
    );
    console.log("✅ Mock pool ready\n");
    await waitForConfirmation(2000);

    console.log("⚡ Executing test swap via shared_route...");
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

    console.log("✅ Test swap completed");
    console.log("   Transaction:", txSignature, "\n");
    await waitForConfirmation(3000);

    // Verify results
    const providerSourceAfter = await getAccount(
      connection,
      providerSourceTokenAccount
    );
    const providerDestAfter = await getAccount(
      connection,
      providerDestinationTokenAccount
    );

    console.log("💰 Balances after test swap:");
    console.log("   Source:", providerSourceAfter.amount.toString());
    console.log("   Destination:", providerDestAfter.amount.toString(), "\n");

    const sourceChange =
      Number(providerSourceBefore.amount) - Number(providerSourceAfter.amount);
    const destChange =
      Number(providerDestAfter.amount) - Number(providerDestBefore.amount);

    console.log("📈 Changes:");
    console.log("   Source spent:", sourceChange);
    console.log("   Destination received:", destChange, "\n");

    if (sourceChange === inAmount.toNumber() && destChange > 0) {
      console.log("✅ Integration test PASSED!");
      console.log("   Jupiter mock is working correctly with shared_route\n");
      return true;
    } else {
      console.log("❌ Integration test FAILED!");
      console.log("   Expected source change:", inAmount.toNumber());
      console.log("   Actual source change:", sourceChange);
      console.log("   Destination change:", destChange, "\n");
      return false;
    }
  } catch (error: any) {
    console.error("\n❌ Integration test error:", error);
    if (error?.logs) {
      console.error("\n📋 Transaction logs:");
      error.logs.forEach((log: string) => console.error("   ", log));
    }
    return false;
  }
}

// Main execution
(async () => {
  try {
    console.log(
      "╔════════════════════════════════════════════════════════════╗"
    );
    console.log(
      "║     JUPITER MOCK CONFIGURATION VERIFICATION TOOL           ║"
    );
    console.log(
      "╚════════════════════════════════════════════════════════════╝\n"
    );

    // Step 1: Verify configuration
    const configValid = await verifyConfiguration();

    if (!configValid) {
      console.log(
        "\n⚠️ Configuration verification failed. Please fix issues before testing."
      );
      process.exit(1);
    }

    // Step 2: Perform integration test
    const testPassed = await performIntegrationTest();

    // Final summary
    console.log("\n" + "=".repeat(60));
    console.log("🏁 FINAL RESULTS");
    console.log("=".repeat(60));

    if (configValid && testPassed) {
      console.log("\n✅ ALL VERIFICATIONS PASSED!");
      console.log(
        "\n💡 Your devnet environment is fully configured and working:"
      );
      console.log("   ✅ Flipper program deployed and functional");
      console.log("   ✅ Mock Jupiter program deployed and functional");
      console.log("   ✅ All PDAs and accounts properly initialized");
      console.log("   ✅ Token accounts created and funded");
      console.log("   ✅ Shared route integration working correctly");
      console.log("\n🚀 You can now proceed with full testing!");
      console.log("\nNext steps:");
      console.log("   • Test more complex swaps");
      console.log("   • Test limit orders");
      console.log("   • Test with different token amounts");
      console.log("   • Test error conditions\n");
    } else {
      console.log("\n⚠️ VERIFICATION INCOMPLETE");
      console.log("   Please review the errors above and fix the issues.\n");
      process.exit(1);
    }
  } catch (error: any) {
    console.error("\n❌ Fatal error:", error);
    process.exit(1);
  }
})();
