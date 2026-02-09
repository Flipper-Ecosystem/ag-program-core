import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Keypair, PublicKey, Connection } from "@solana/web3.js";
import FLIPPER_IDL from "../../target/idl/flipper.json";
import fs from "fs";

/**
 * Script to change Vault Authority Admin on Mainnet
 *
 * This changes the admin of the Vault Authority account using Global Manager privileges.
 * Only the current Global Manager can execute this operation.
 *
 * Usage:
 * NEW_ADMIN_PUBKEY=<new_admin_address> ts-node scripts/mainnet/change_vault_authority_admin.ts
 *
 * IMPORTANT:
 * - The wallet must be the CURRENT Global Manager (fpp-staging)
 * - This operation requires Global Manager authority
 * - The new admin will have control over vault operations
 * - Verify the new admin address multiple times before executing
 *
 * Best Practice:
 * - Document the change in your records
 * - Verify the new admin address is correct
 * - The new admin should be a secure multisig for production
 */

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

async function changeVaultAuthorityAdmin() {
  console.log("🔄 Changing Vault Authority Admin on Mainnet...\n");
  console.log("⚠️  WARNING: This is a critical operation!");
  console.log("⚠️  Only the Global Manager can execute this!");
  console.log("⚠️  The new admin will control vault operations!\n");

  // Get new admin from environment variable
  const newAdminPubkeyEnv = process.env.NEW_ADMIN_PUBKEY;
  if (!newAdminPubkeyEnv) {
    console.error(
      "❌ ERROR: NEW_ADMIN_PUBKEY environment variable is required"
    );
    console.log("\nUsage:");
    console.log(
      "NEW_ADMIN_PUBKEY=<new_admin_address> ts-node scripts/mainnet/change_vault_authority_admin.ts\n"
    );
    process.exit(1);
  }

  const newAdminPublicKey = new PublicKey(newAdminPubkeyEnv);

  console.log("📍 Configuration:");
  console.log("   RPC Endpoint:", RPC_ENDPOINT);
  console.log("   Global Manager (wallet):", wallet.publicKey.toBase58());
  console.log("   New Vault Authority Admin:", newAdminPublicKey.toBase58());
  console.log("   Program ID:", flipperProgram.programId.toBase58());

  // Derive PDAs
  const [vaultAuthorityPda, vaultAuthorityBump] =
    PublicKey.findProgramAddressSync(
      [Buffer.from("vault_authority")],
      flipperProgram.programId
    );

  const [globalManagerPda, globalManagerBump] =
    PublicKey.findProgramAddressSync(
      [Buffer.from("global_manager")],
      flipperProgram.programId
    );

  console.log("   Vault Authority PDA:", vaultAuthorityPda.toBase58());
  console.log("   Vault Authority Bump:", vaultAuthorityBump);
  console.log("   Global Manager PDA:", globalManagerPda.toBase58());
  console.log("   Global Manager Bump:", globalManagerBump, "\n");

  // Check if global manager exists and verify current manager
  try {
    const existingGlobalManager = await (
      flipperProgram.account as any
    ).globalManager.fetch(globalManagerPda);
    console.log("📊 Current Global Manager:");
    console.log("   Manager:", existingGlobalManager.manager.toBase58());
    console.log("   Bump:", existingGlobalManager.bump, "\n");

    if (
      existingGlobalManager.manager.toBase58() !== wallet.publicKey.toBase58()
    ) {
      console.error("❌ ERROR: Your wallet is not the current Global Manager!");
      console.log(
        "   Current Manager:",
        existingGlobalManager.manager.toBase58()
      );
      console.log("   Your Wallet:", wallet.publicKey.toBase58());
      console.log(
        "\n💡 Only the Global Manager can change the Vault Authority Admin\n"
      );
      process.exit(1);
    }

    console.log("✅ Verified: Wallet is the current Global Manager\n");
  } catch (error) {
    console.error("❌ ERROR: Global Manager does not exist!");
    console.log(
      "\n💡 You need to create it first using create_global_manager.ts\n"
    );
    process.exit(1);
  }

  // Check current vault authority state
  try {
    const existingVaultAuth = await (
      flipperProgram.account as any
    ).vaultAuthority.fetch(vaultAuthorityPda);
    console.log("📊 Current Vault Authority:");
    console.log("   Admin:", existingVaultAuth.admin.toBase58());
    console.log("   Bump:", existingVaultAuth.bump, "\n");

    if (existingVaultAuth.admin.toBase58() === newAdminPublicKey.toBase58()) {
      console.log("⚠️  WARNING: New admin is the same as current admin");
      console.log("   No change needed. Exiting...\n");
      process.exit(0);
    }
  } catch (error) {
    console.error("❌ ERROR: Vault Authority does not exist!");
    console.log(
      "\n💡 You need to create it first using create_vault_authority.ts\n"
    );
    process.exit(1);
  }

  // Confirm with user
  console.log("⚠️  Please confirm the following:");
  console.log("   - You have verified the NEW admin address is correct");
  console.log("   - The new admin will have control over vault operations");
  console.log("   - The new admin address is a secure multisig (recommended)");
  console.log("   - You have documented this change in your records");
  console.log(`   - New Admin: ${newAdminPublicKey.toBase58()}\n`);

  if (process.env.SKIP_CONFIRMATION !== "true") {
    console.log("💡 Set SKIP_CONFIRMATION=true to skip this check\n");
    console.log("Waiting 10 seconds before proceeding...");
    console.log("⚠️  Press Ctrl+C to cancel if you're not sure!\n");
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }

  try {
    console.log("📝 Creating change Vault Authority Admin transaction...");

    const tx = await flipperProgram.methods
      .changeVaultAuthorityAdmin()
      .accounts({
        vaultAuthority: vaultAuthorityPda,
        globalManager: globalManagerPda,
        manager: wallet.publicKey,
        newAdmin: newAdminPublicKey,
      })
      .rpc();

    console.log("✅ Vault Authority Admin changed successfully!");
    console.log("   Transaction:", tx);
    console.log("   Explorer:", `https://solscan.io/tx/${tx}`);

    // Verify the change
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const updatedVaultAuth = await (
      flipperProgram.account as any
    ).vaultAuthority.fetch(vaultAuthorityPda);

    console.log("\n📊 Updated Vault Authority Account:");
    console.log("   Address:", vaultAuthorityPda.toBase58());
    console.log("   New Admin:", updatedVaultAuth.admin.toBase58());
    console.log("   Bump:", updatedVaultAuth.bump);

    if (updatedVaultAuth.admin.toBase58() !== newAdminPublicKey.toBase58()) {
      console.log("\n❌ ERROR: Admin address mismatch!");
      console.log("   Expected:", newAdminPublicKey.toBase58());
      console.log("   Got:", updatedVaultAuth.admin.toBase58());
    } else {
      console.log(
        "\n✅ Verification passed: Vault Authority Admin changed successfully"
      );
    }

    console.log("\n🎯 Important Notes:");
    console.log("   1. Document this change in your records");
    console.log("   2. The new admin now controls vault operations");
    console.log("   3. Operators can still create vaults (if authorized)");
    console.log("   4. Only Global Manager can change the admin again");
    console.log("\n⚠️  If the new admin is a multisig:");
    console.log("   - Verify all signers have access");
    console.log("   - Test the multisig before performing critical operations");
    console.log("   - Keep the credentials extremely secure");
  } catch (error: any) {
    console.error("\n❌ Error changing Vault Authority Admin:");
    console.error(error);

    if (error.message?.includes("UnauthorizedGlobalManager")) {
      console.log("\n💡 Your wallet is not authorized as Global Manager");
      console.log("   Only the Global Manager can perform this operation");
    } else if (error.message?.includes("GlobalManagerNotInitialized")) {
      console.log("\n💡 Global Manager is not initialized");
      console.log("   Create it first using create_global_manager.ts");
    } else if (error.message?.includes("VaultAuthorityNotInitialized")) {
      console.log("\n💡 Vault Authority is not initialized");
      console.log("   Create it first using create_vault_authority.ts");
    }

    process.exit(1);
  }
}

// Run the function
changeVaultAuthorityAdmin()
  .then(() => {
    console.log("\n✅ Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Script failed:", error);
    process.exit(1);
  });
