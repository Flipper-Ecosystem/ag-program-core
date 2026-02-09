import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Keypair, PublicKey, Connection, SystemProgram } from "@solana/web3.js";
import FLIPPER_IDL from "../../target/idl/flipper.json";
import fs from "fs";

/**
 * Script to create Vault Authority on Mainnet
 *
 * Vault Authority controls all vaults in the system.
 * The admin of Vault Authority can:
 * - Create new vaults
 * - Close empty vaults
 *
 * The Global Manager can change the Vault Authority admin.
 *
 * Usage:
 * ADMIN_PUBKEY=<admin_address> ts-node scripts/mainnet/create_vault_authority.ts
 *
 * If ADMIN_PUBKEY is not set, the wallet will be used as admin.
 *
 * Best Practice:
 * - For production, use the same multisig as Global Manager
 * - Or use a separate admin key for vault operations
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

async function createVaultAuthority() {
  console.log("🏛️  Creating Vault Authority on Mainnet...\n");

  // Get admin from environment variable or use wallet as default
  let adminPublicKey: PublicKey;
  const adminPubkeyEnv = process.env.ADMIN_PUBKEY;

  if (adminPubkeyEnv) {
    adminPublicKey = new PublicKey(adminPubkeyEnv);
    console.log("📍 Using admin from ADMIN_PUBKEY environment variable");
  } else {
    adminPublicKey = wallet.publicKey;
    console.log("⚠️  No ADMIN_PUBKEY set, using wallet as admin");
    console.log(
      "💡 For production, consider using the same multisig as Global Manager!"
    );
  }

  console.log("\n📍 Configuration:");
  console.log("   RPC Endpoint:", RPC_ENDPOINT);
  console.log("   Payer:", wallet.publicKey.toBase58());
  console.log("   Admin:", adminPublicKey.toBase58());
  console.log("   Program ID:", flipperProgram.programId.toBase58());

  // Derive vault authority PDA
  const [vaultAuthorityPda, vaultAuthorityBump] =
    PublicKey.findProgramAddressSync(
      [Buffer.from("vault_authority")],
      flipperProgram.programId
    );

  console.log("   Vault Authority PDA:", vaultAuthorityPda.toBase58());
  console.log("   Bump:", vaultAuthorityBump, "\n");

  // Check if vault authority already exists
  try {
    const existingAuthority = await (
      flipperProgram.account as any
    ).vaultAuthority.fetch(vaultAuthorityPda);
    console.log("❌ ERROR: Vault Authority already exists!");
    console.log("   Current Admin:", existingAuthority.admin.toBase58());
    console.log(
      "\n💡 If you want to change the admin, the Global Manager must use change_vault_authority_admin\n"
    );
    process.exit(1);
  } catch (error) {
    console.log("✅ Vault Authority PDA is available (not yet created)\n");
  }

  // Verify Global Manager exists (recommended but not required)
  try {
    const [globalManagerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_manager")],
      flipperProgram.programId
    );
    const globalManager = await (
      flipperProgram.account as any
    ).globalManager.fetch(globalManagerPda);
    console.log("✅ Global Manager exists:", globalManager.manager.toBase58());
    console.log(
      "💡 Global Manager can change Vault Authority admin later if needed\n"
    );
  } catch (error) {
    console.log("⚠️  WARNING: Global Manager does not exist yet!");
    console.log("💡 Consider creating it first for better security\n");
  }

  if (process.env.SKIP_CONFIRMATION !== "true") {
    console.log("💡 Set SKIP_CONFIRMATION=true to skip this check\n");
    console.log("Waiting 5 seconds before proceeding...");
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  try {
    console.log("📝 Creating Vault Authority transaction...");

    const tx = await flipperProgram.methods
      .createVaultAuthority()
      .accounts({
        vaultAuthority: vaultAuthorityPda,
        payer: wallet.publicKey,
        admin: adminPublicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("✅ Vault Authority created successfully!");
    console.log("   Transaction:", tx);
    console.log("   Explorer:", `https://solscan.io/tx/${tx}`);

    // Verify the account
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const vaultAuthorityAccount = await (
      flipperProgram.account as any
    ).vaultAuthority.fetch(vaultAuthorityPda);

    console.log("\n📊 Vault Authority Account:");
    console.log("   Address:", vaultAuthorityPda.toBase58());
    console.log("   Admin:", vaultAuthorityAccount.admin.toBase58());
    console.log("   Bump:", vaultAuthorityAccount.bump);

    if (vaultAuthorityAccount.admin.toBase58() !== adminPublicKey.toBase58()) {
      console.log("\n❌ ERROR: Admin address mismatch!");
    } else {
      console.log("\n✅ Verification passed: Admin address is correct");
    }

    console.log("\n🎯 Next Steps:");
    console.log("   1. Admin can now create vaults for token pairs");
    console.log("   2. Initialize adapter registry if not done yet");
    console.log("   3. Register DEX adapters (Raydium, Whirlpool, Meteora)");
    console.log("   4. Add operators to adapter registry");
  } catch (error: any) {
    console.error("\n❌ Error creating Vault Authority:");
    console.error(error);
    process.exit(1);
  }
}

// Run the function
createVaultAuthority()
  .then(() => {
    console.log("\n✅ Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Script failed:", error);
    process.exit(1);
  });
