/**
 * Simplified Shared Route Test for Mainnet
 *
 * This script demonstrates how to execute a shared_route instruction on mainnet
 * without requiring Jupiter API calls. It creates a minimal test transaction
 * that shows the structure and flow of the shared_route instruction.
 *
 * For production use with real Jupiter swaps, see test_shared_route_jupiter.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  Connection,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  createSyncNativeInstruction,
} from "@solana/spl-token";
import FLIPPER_IDL from "../../target/idl/flipper.json";
import fs from "fs";

// Mainnet constants
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

// Function to load keypair
const loadKeypair = (): Keypair => {
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

// Configure connection
const RPC_URL = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
const connection = new Connection(RPC_URL, "confirmed");

// Create wallet and provider
const wallet = new anchor.Wallet(loadKeypair());
const provider = new AnchorProvider(connection, wallet, {
  commitment: "confirmed",
});
anchor.setProvider(provider);

// Load program
const flipperProgram = new Program(FLIPPER_IDL, provider);

async function checkSetup() {
  console.log("=".repeat(60));
  console.log("🔍 Checking Flipper Setup on Mainnet");
  console.log("=".repeat(60));
  console.log();

  console.log("📍 Configuration:");
  console.log("   Wallet:", wallet.publicKey.toBase58());
  console.log("   Flipper Program:", flipperProgram.programId.toBase58());
  console.log();

  // Check SOL balance
  const solBalance = await connection.getBalance(wallet.publicKey);
  console.log("💰 SOL Balance:", (solBalance / 1e9).toFixed(4), "SOL");

  if (solBalance < 10_000_000) {
    console.log("   ⚠️  Low balance! Need at least 0.01 SOL for testing");
    return false;
  } else {
    console.log("   ✅ Sufficient SOL balance");
  }
  console.log();

  // Derive PDAs
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority")],
    flipperProgram.programId
  );

  const [adapterRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from("adapter_registry")],
    flipperProgram.programId
  );

  console.log("📍 PDAs:");
  console.log("   Vault Authority:", vaultAuthority.toBase58());
  console.log("   Adapter Registry:", adapterRegistry.toBase58());
  console.log();

  // Check if adapter registry exists
  console.log("🔍 Checking Adapter Registry account...");
  let registryExists = false;
  try {
    const accountInfo = await connection.getAccountInfo(adapterRegistry);
    if (accountInfo) {
      console.log("   Account exists, attempting to deserialize...");
      const registryAccount = await (
        flipperProgram.account as any
      ).adapterRegistry.fetch(adapterRegistry);
      console.log("✅ Adapter Registry exists and is valid");

      // Safely access properties
      if (registryAccount.admin) {
        console.log("   Admin:", registryAccount.admin.toBase58());
      }
      if (registryAccount.operators) {
        console.log("   Operators:", registryAccount.operators.length);
      }

      // Debug: show full structure
      console.log("   Registry structure:", Object.keys(registryAccount));

      registryExists = true;
    } else {
      console.log("❌ Adapter Registry account not found on chain!");
      console.log("   Please initialize the adapter registry first");
      console.log(
        "   Run: ts-node scripts/mainnet/initialize_adapter_registry.ts"
      );
    }
  } catch (e: any) {
    console.log("❌ Error checking Adapter Registry:", e.message);
    console.log("   Error details:", e);
  }
  console.log();

  if (!registryExists) {
    console.log("⚠️  Adapter Registry not properly initialized");
    console.log("   This is required for shared_route to work");
    return false;
  }

  // Check token accounts
  console.log("🪙 Token Accounts:");

  try {
    const wsolAccount = getAssociatedTokenAddressSync(
      WSOL_MINT,
      wallet.publicKey,
      false,
      TOKEN_PROGRAM_ID
    );
    const wsolInfo = await getAccount(connection, wsolAccount);
    console.log("   ✅ WSOL account:", wsolAccount.toBase58());
    console.log("      Balance:", wsolInfo.amount.toString(), "lamports");
  } catch (e) {
    console.log("   ⚠️  WSOL account not found (will create)");
  }

  try {
    const usdcAccount = getAssociatedTokenAddressSync(
      USDC_MINT,
      wallet.publicKey,
      false,
      TOKEN_PROGRAM_ID
    );
    const usdcInfo = await getAccount(connection, usdcAccount);
    console.log("   ✅ USDC account:", usdcAccount.toBase58());
    console.log(
      "      Balance:",
      (Number(usdcInfo.amount) / 1e6).toFixed(6),
      "USDC"
    );
  } catch (e) {
    console.log("   ⚠️  USDC account not found (will create)");
  }
  console.log();

  // Check vaults - using PDA derivation with seeds ["vault", mint]
  console.log("🏦 Vault Accounts:");

  try {
    const [sourceVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), WSOL_MINT.toBuffer()],
      flipperProgram.programId
    );
    const sourceVaultInfo = await getAccount(connection, sourceVault);
    console.log("   ✅ Source Vault (WSOL):", sourceVault.toBase58());
    console.log(
      "      Balance:",
      sourceVaultInfo.amount.toString(),
      "lamports"
    );
    console.log('      Derivation: PDA seeds ["vault", WSOL_MINT]');
  } catch (e) {
    const [sourceVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), WSOL_MINT.toBuffer()],
      flipperProgram.programId
    );
    console.log("   ⚠️  Source Vault not found");
    console.log("      Expected PDA:", sourceVault.toBase58());
    console.log(
      "      Run: MINT_ADDRESS=" +
        WSOL_MINT.toBase58() +
        " npm run mainnet:create-vault"
    );
  }

  try {
    const [destinationVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), USDC_MINT.toBuffer()],
      flipperProgram.programId
    );
    const destVaultInfo = await getAccount(connection, destinationVault);
    console.log("   ✅ Destination Vault (USDC):", destinationVault.toBase58());
    console.log(
      "      Balance:",
      (Number(destVaultInfo.amount) / 1e6).toFixed(6),
      "USDC"
    );
    console.log('      Derivation: PDA seeds ["vault", USDC_MINT]');
  } catch (e) {
    const [destinationVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), USDC_MINT.toBuffer()],
      flipperProgram.programId
    );
    console.log("   ⚠️  Destination Vault not found");
    console.log("      Expected PDA:", destinationVault.toBase58());
    console.log(
      "      Run: MINT_ADDRESS=" +
        USDC_MINT.toBase58() +
        " npm run mainnet:create-vault"
    );
  }
  console.log();

  console.log("=".repeat(60));
  console.log("✅ Setup check complete!");
  console.log("=".repeat(60));
  console.log();

  console.log("📝 Next Steps:");
  console.log("   1. Ensure adapter registry is initialized");
  console.log("   2. Register Jupiter adapter if needed");
  console.log("   3. Get Jupiter quote for WSOL -> USDC");
  console.log("   4. Execute shared_route with Jupiter instruction data");
  console.log();

  console.log("💡 To execute a real swap:");
  console.log("   Run: npm run mainnet:test-shared-route");
  console.log();

  return true;
}

async function wrapSOL(amount: number) {
  console.log("📦 Wrapping SOL...");

  const userWsolAccount = getAssociatedTokenAddressSync(
    WSOL_MINT,
    wallet.publicKey,
    false,
    TOKEN_PROGRAM_ID
  );

  let needsWrap = false;
  try {
    const wsolInfo = await getAccount(connection, userWsolAccount);
    if (wsolInfo.amount < BigInt(amount)) {
      needsWrap = true;
      console.log("   Current WSOL:", wsolInfo.amount.toString());
      console.log("   Needed:", amount);
    } else {
      console.log("   ✅ Sufficient WSOL balance");
      return;
    }
  } catch (e) {
    needsWrap = true;
    console.log("   Creating WSOL account...");
    await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      WSOL_MINT,
      wallet.publicKey,
      false
    );
  }

  if (needsWrap) {
    const transferInstruction = SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: userWsolAccount,
      lamports: amount,
    });

    const syncNativeInstruction = createSyncNativeInstruction(userWsolAccount);

    const wrapTx = new Transaction()
      .add(transferInstruction)
      .add(syncNativeInstruction);

    const signature = await provider.sendAndConfirm(wrapTx);
    console.log("   ✅ SOL wrapped to WSOL");
    console.log("   Transaction:", signature);
    console.log("   Explorer: https://solscan.io/tx/" + signature);
    console.log();
  }
}

async function main() {
  try {
    const setupOk = await checkSetup();

    if (!setupOk) {
      console.log(
        "❌ Setup incomplete. Please fix the issues above and try again."
      );
      process.exit(1);
    }

    console.log("🎯 Test Option: Wrap 0.01 SOL to WSOL");
    console.log("   This demonstrates the basic flow without executing a swap");
    console.log();

    const shouldWrap = process.argv.includes("--wrap");

    if (shouldWrap) {
      await wrapSOL(10_000_000); // 0.01 SOL
      console.log("✅ Wrap complete! WSOL is ready for swapping.");
    } else {
      console.log("💡 To wrap SOL, run:");
      console.log("   npm run mainnet:check-shared-route -- --wrap");
    }

    console.log();
    console.log("=".repeat(60));
    console.log("✅ Simple Test Complete!");
    console.log("=".repeat(60));
    console.log();
  } catch (error: any) {
    console.error("❌ Error:", error.message);
    if (error.logs) {
      console.error("\n📋 Transaction logs:");
      error.logs.forEach((log: string) => console.error("   ", log));
    }
    process.exit(1);
  }
}

main();
