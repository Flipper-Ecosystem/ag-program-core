import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Keypair, PublicKey, Connection, SystemProgram } from "@solana/web3.js";
import FLIPPER_IDL from "../../target/idl/flipper.json";
import fs from "fs";

/**
 * Script to create Global Manager on Mainnet
 *
 * IMPORTANT: This should be run IMMEDIATELY after contract deployment!
 * The caller (fpp-staging) will become the Global Manager.
 *
 * Global Manager has critical permissions:
 * 1. Withdraw platform fees
 * 2. Change VaultAuthority admin
 * 3. Change itself to another address
 *
 * Usage:
 * ts-node scripts/mainnet/create_global_manager.ts
 *
 * The fpp-staging wallet will be set as manager.
 * You can later change it to a multisig using change_global_manager.ts
 *
 * Best Practice:
 * - Keep the fpp-staging private keys secure
 * - Document the manager address
 * - Consider changing to multisig later
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

async function createGlobalManager() {
  console.log("🔐 Creating Global Manager on Mainnet...\n");
  console.log("⚠️  WARNING: This is a critical operation!");
  console.log("⚠️  The caller (fpp-staging) will become the Global Manager!");
  console.log(
    "⚠️  Global Manager controls platform fees and vault authority admin.\n"
  );

  // Manager is always the wallet (fpp-staging address)
  const managerPublicKey = wallet.publicKey;

  console.log("📍 Configuration:");
  console.log("   RPC Endpoint:", RPC_ENDPOINT);
  console.log("   Payer/Manager:", wallet.publicKey.toBase58());
  console.log("   Program ID:", flipperProgram.programId.toBase58());

  // Derive global manager PDA
  const [globalManagerPda, globalManagerBump] =
    PublicKey.findProgramAddressSync(
      [Buffer.from("global_manager")],
      flipperProgram.programId
    );

  console.log("   Global Manager PDA:", globalManagerPda.toBase58());
  console.log("   Bump:", globalManagerBump, "\n");

  // Check if global manager already exists
  try {
    const existingManager = await (
      flipperProgram.account as any
    ).globalManager.fetch(globalManagerPda);
    console.log("❌ ERROR: Global Manager already exists!");
    console.log("   Current Manager:", existingManager.manager.toBase58());
    console.log(
      "\n💡 If you want to change the manager, use change_global_manager.ts script\n"
    );
    process.exit(1);
  } catch (error) {
    // Account doesn't exist, which is what we want
    console.log("✅ Global Manager PDA is available (not yet created)\n");
  }

  // Confirm with user
  console.log("⚠️  Please confirm the following:");
  console.log("   - Your fpp-staging wallet will become the Global Manager");
  console.log("   - You understand this is a one-time operation");
  console.log("   - You have backed up the fpp-staging private keys");
  console.log(
    "   - You can change to multisig later using change_global_manager.ts\n"
  );

  if (process.env.SKIP_CONFIRMATION !== "true") {
    console.log("💡 Set SKIP_CONFIRMATION=true to skip this check\n");
    console.log("Waiting 5 seconds before proceeding...");
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  try {
    console.log("📝 Creating Global Manager transaction...");

    const tx = await flipperProgram.methods
      .createGlobalManager()
      .accounts({
        globalManager: globalManagerPda,
        payer: wallet.publicKey,
        manager: managerPublicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("✅ Global Manager created successfully!");
    console.log("   Transaction:", tx);
    console.log("   Explorer:", `https://solscan.io/tx/${tx}`);

    // Verify the account was created correctly
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const globalManagerAccount = await (
      flipperProgram.account as any
    ).globalManager.fetch(globalManagerPda);

    console.log("\n📊 Global Manager Account:");
    console.log("   Address:", globalManagerPda.toBase58());
    console.log("   Manager:", globalManagerAccount.manager.toBase58());
    console.log("   Bump:", globalManagerAccount.bump);

    if (
      globalManagerAccount.manager.toBase58() !== managerPublicKey.toBase58()
    ) {
      console.log("\n❌ ERROR: Manager address mismatch!");
      console.log("   Expected:", managerPublicKey.toBase58());
      console.log("   Got:", globalManagerAccount.manager.toBase58());
    } else {
      console.log("\n✅ Verification passed: Manager address is correct");
    }

    console.log("\n🎯 Next Steps:");
    console.log("   1. Document the manager address and keep it safe");
    console.log("   2. Consider changing to multisig for production:");
    console.log(
      "      NEW_MANAGER_PUBKEY=<multisig> ts-node scripts/mainnet/change_global_manager.ts"
    );
    console.log("   3. Create Vault Authority using create_vault_authority.ts");
    console.log("   4. Initialize adapter registry");
  } catch (error: any) {
    console.error("\n❌ Error creating Global Manager:");
    console.error(error);

    if (error.message?.includes("already in use")) {
      console.log("\n💡 The Global Manager account already exists.");
      console.log("   Someone else may have created it first!");
    }

    process.exit(1);
  }
}

// Run the function
createGlobalManager()
  .then(() => {
    console.log("\n✅ Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Script failed:", error);
    process.exit(1);
  });
