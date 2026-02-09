import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Keypair, PublicKey, Connection, SystemProgram } from "@solana/web3.js";
import FLIPPER_IDL from "../../target/idl/flipper.json";
import fs from "fs";

/**
 * Script to migrate the VaultAuthority account on Mainnet.
 *
 * After upgrading the program to a version that stores jupiter_program_id in VaultAuthority,
 * this script must be called once to:
 *   1. Realloc the VaultAuthority account (from 41 to 73 bytes) — requires vault authority admin
 *   2. Set the Jupiter program ID — requires Global Manager
 *
 * Without this migration, any shared instruction (shared_route, shared_route_and_create_order,
 * shared_execute_limit_order) will fail with InvalidJupiterProgram.
 *
 * Usage:
 *   ts-node scripts/mainnet/migrate_vault_authority.ts
 *
 * Environment variables:
 *   RPC_ENDPOINT        - Custom RPC endpoint (default: mainnet-beta)
 *   SKIP_CONFIRMATION   - Set to "true" to skip the 5-second wait
 *
 * The wallet used must be:
 *   - The vault authority admin (for step 1: realloc)
 *   - The Global Manager (for step 2: set Jupiter program ID)
 */

const JUPITER_V6_PROGRAM_ID = new PublicKey(
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"
);

// Function to load keypair for mainnet wallet
const loadKeypair = (): Keypair => {
  const keypairPath = process.env.HOME + "/.config/solana/fpp-staging.json";
  if (fs.existsSync(keypairPath)) {
    const secretKey = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
  }
  throw new Error(
    "Keypair file not found at ~/.config/solana/fpp-staging.json"
  );
};

// Configure connection to Solana Mainnet
const RPC_ENDPOINT =
  process.env.RPC_ENDPOINT || "https://api.mainnet-beta.solana.com";
const connection = new Connection(RPC_ENDPOINT, "confirmed");

// Create wallet and provider for Anchor
const wallet = new anchor.Wallet(loadKeypair());
const provider = new AnchorProvider(connection, wallet, {
  commitment: "confirmed",
});
anchor.setProvider(provider);

// Load program
const flipperProgram = new Program(FLIPPER_IDL, provider);

async function migrateVaultAuthority() {
  console.log(
    "=== Migrate VaultAuthority: realloc + set Jupiter program ===\n"
  );

  console.log("Configuration:");
  console.log("  RPC Endpoint:", RPC_ENDPOINT);
  console.log("  Wallet:", wallet.publicKey.toBase58());
  console.log("  Program ID:", flipperProgram.programId.toBase58());
  console.log("  Jupiter V6 Program ID:", JUPITER_V6_PROGRAM_ID.toBase58());
  console.log();

  // Derive PDAs
  const [vaultAuthority, vaultAuthorityBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority")],
    flipperProgram.programId
  );

  const [globalManager] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_manager")],
    flipperProgram.programId
  );

  console.log("PDA Addresses:");
  console.log(
    "  Vault Authority:",
    vaultAuthority.toBase58(),
    `(bump: ${vaultAuthorityBump})`
  );
  console.log("  Global Manager:", globalManager.toBase58());
  console.log();

  // ========== PRE-FLIGHT CHECKS ==========

  // Check VaultAuthority exists
  const vaultAuthorityInfo = await connection.getAccountInfo(vaultAuthority);
  if (!vaultAuthorityInfo) {
    console.error("ERROR: VaultAuthority account not found on-chain.");
    console.log("  Run create_vault_authority.ts first.\n");
    process.exit(1);
  }

  console.log("Current VaultAuthority on-chain:");
  console.log("  Data length:", vaultAuthorityInfo.data.length, "bytes");
  console.log("  Lamports:", vaultAuthorityInfo.lamports);

  let vaultAuthorityAccount: any;
  try {
    vaultAuthorityAccount = await (
      flipperProgram.account as any
    ).vaultAuthority.fetch(vaultAuthority);
    console.log("  Admin:", vaultAuthorityAccount.admin.toBase58());
    console.log("  Bump:", vaultAuthorityAccount.bump);
    if (vaultAuthorityAccount.jupiterProgramId) {
      console.log(
        "  Jupiter Program ID:",
        vaultAuthorityAccount.jupiterProgramId.toBase58()
      );
    }
  } catch (error: any) {
    console.warn(
      "  WARNING: Could not deserialize with new IDL (expected before migration)."
    );
    console.log("  Proceeding with migration anyway.\n");
  }

  // Verify wallet is the vault authority admin (for step 1)
  const isAdmin =
    vaultAuthorityAccount &&
    vaultAuthorityAccount.admin.equals(wallet.publicKey);

  console.log();
  console.log("Authorization check (Step 1 - Migrate/Realloc):");
  console.log("  Is admin:", isAdmin);

  if (!isAdmin) {
    console.error("\nERROR: Wallet is not the vault authority admin.");
    console.log("  Wallet:", wallet.publicKey.toBase58());
    console.log("  Admin:", vaultAuthorityAccount?.admin?.toBase58());
    process.exit(1);
  }

  // Check GlobalManager for step 2
  let globalManagerAccount: any;
  try {
    globalManagerAccount = await (
      flipperProgram.account as any
    ).globalManager.fetch(globalManager);
  } catch (error: any) {
    console.error("ERROR: Could not fetch GlobalManager.");
    console.log("  Run create_global_manager.ts first.\n");
    process.exit(1);
  }

  const isGlobalManager = globalManagerAccount.manager.equals(wallet.publicKey);
  console.log("\nAuthorization check (Step 2 - Set Jupiter Program):");
  console.log("  Global Manager:", globalManagerAccount.manager.toBase58());
  console.log("  Is Global Manager:", isGlobalManager);

  if (!isGlobalManager) {
    console.error("\nERROR: Wallet is not the Global Manager.");
    console.log("  Wallet:", wallet.publicKey.toBase58());
    console.log("  Expected:", globalManagerAccount.manager.toBase58());
    process.exit(1);
  }

  // Check if migration is already done
  const alreadyMigrated = vaultAuthorityInfo.data.length >= 73;
  const jupiterAlreadySet =
    vaultAuthorityAccount?.jupiterProgramId &&
    !vaultAuthorityAccount.jupiterProgramId.equals(PublicKey.default) &&
    vaultAuthorityAccount.jupiterProgramId.equals(JUPITER_V6_PROGRAM_ID);

  if (alreadyMigrated && jupiterAlreadySet) {
    console.log("\nMigration already completed:");
    console.log(
      "  Data length:",
      vaultAuthorityInfo.data.length,
      "bytes (>= 73)"
    );
    console.log(
      "  Jupiter Program ID:",
      vaultAuthorityAccount.jupiterProgramId.toBase58()
    );
    console.log("No action needed.\n");
    return;
  }

  // Confirmation wait
  if (process.env.SKIP_CONFIRMATION !== "true") {
    console.log("\nSet SKIP_CONFIRMATION=true to skip this wait.");
    console.log("Waiting 5 seconds before proceeding...");
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  // ========== STEP 1: MIGRATE (REALLOC) ==========

  if (!alreadyMigrated) {
    console.log(
      "\n--- Step 1: Migrate VaultAuthority (realloc 41 -> 73 bytes) ---"
    );
    try {
      const txSignature = await flipperProgram.methods
        .migrateVaultAuthority(JUPITER_V6_PROGRAM_ID)
        .accounts({
          vaultAuthority,
          admin: wallet.publicKey,
          payer: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([wallet.payer])
        .rpc();

      console.log("Transaction sent:", txSignature);
      console.log("Explorer: https://solscan.io/tx/" + txSignature);
    } catch (error: any) {
      console.error("ERROR: Migration (realloc) transaction failed:");
      console.error(error);
      process.exit(1);
    }

    // Wait for confirmation
    console.log("Waiting for confirmation...");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Verify realloc
    const updatedInfo = await connection.getAccountInfo(vaultAuthority);
    console.log("  New data length:", updatedInfo?.data.length, "bytes");
    if (updatedInfo && updatedInfo.data.length >= 73) {
      console.log("  Step 1 completed successfully.\n");
    } else {
      console.error("  ERROR: Data length is still less than 73 bytes.");
      process.exit(1);
    }
  } else {
    console.log(
      "\n--- Step 1: SKIPPED (already migrated, data length:",
      vaultAuthorityInfo.data.length,
      "bytes) ---\n"
    );
  }

  // ========== STEP 2: SET JUPITER PROGRAM ID ==========

  console.log("--- Step 2: Set Jupiter Program ID ---");
  console.log("  Setting to:", JUPITER_V6_PROGRAM_ID.toBase58());

  try {
    const txSignature = await flipperProgram.methods
      .setJupiterProgram(JUPITER_V6_PROGRAM_ID)
      .accounts({
        vaultAuthority,
        globalManager,
        manager: wallet.publicKey,
      })
      .signers([wallet.payer])
      .rpc();

    console.log("Transaction sent:", txSignature);
    console.log("Explorer: https://solscan.io/tx/" + txSignature);
  } catch (error: any) {
    console.error("ERROR: Set Jupiter Program transaction failed:");
    console.error(error);
    process.exit(1);
  }

  // Wait for confirmation
  console.log("Waiting for confirmation...");
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // ========== FINAL VERIFICATION ==========

  console.log("\n--- Final Verification ---");
  try {
    const finalAccount = await (
      flipperProgram.account as any
    ).vaultAuthority.fetch(vaultAuthority);
    const finalInfo = await connection.getAccountInfo(vaultAuthority);

    console.log("  Data length:", finalInfo?.data.length, "bytes");
    console.log("  Admin:", finalAccount.admin.toBase58());
    console.log("  Bump:", finalAccount.bump);
    console.log(
      "  Jupiter Program ID:",
      finalAccount.jupiterProgramId.toBase58()
    );

    if (finalAccount.jupiterProgramId.equals(JUPITER_V6_PROGRAM_ID)) {
      console.log("\nMigration completed successfully!");
      console.log("  Jupiter program ID is set correctly.\n");
    } else {
      console.error("\nWARNING: Jupiter program ID mismatch!");
      console.log("  Expected:", JUPITER_V6_PROGRAM_ID.toBase58());
      console.log("  Got:", finalAccount.jupiterProgramId.toBase58());
      process.exit(1);
    }
  } catch (error: any) {
    console.error("ERROR: Final verification failed:", error);
    process.exit(1);
  }
}

// Main execution
(async () => {
  try {
    await migrateVaultAuthority();
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
})();
