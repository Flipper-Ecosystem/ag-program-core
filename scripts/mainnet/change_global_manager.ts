import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Keypair, PublicKey, Connection, SystemProgram } from "@solana/web3.js";
import FLIPPER_IDL from "../../target/idl/flipper.json";
import fs from "fs";

/**
 * Script to change Global Manager on Mainnet
 *
 * This transfers Global Manager role to a new address.
 * Only the current Global Manager can execute this operation.
 *
 * Usage:
 * NEW_MANAGER_PUBKEY=<new_manager_address> ts-node scripts/mainnet/change_global_manager.ts
 *
 * IMPORTANT:
 * - The wallet must be the CURRENT Global Manager
 * - The new manager should be a multisig for production
 * - This is irreversible (unless the new manager changes it back)
 *
 * Best Practice:
 * - Change to a multisig address as soon as possible after deployment
 * - Document the change in your records
 * - Verify the new manager address multiple times
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

async function changeGlobalManager() {
  console.log("🔄 Changing Global Manager on Mainnet...\n");
  console.log("⚠️  WARNING: This is a critical operation!");
  console.log("⚠️  Only the current Global Manager can execute this!");
  console.log("⚠️  This transfer is irreversible!\n");

  // Get new manager from environment variable
  const newManagerPubkeyEnv = process.env.NEW_MANAGER_PUBKEY;
  if (!newManagerPubkeyEnv) {
    console.error(
      "❌ ERROR: NEW_MANAGER_PUBKEY environment variable is required"
    );
    console.log("\nUsage:");
    console.log(
      "NEW_MANAGER_PUBKEY=<new_manager_address> ts-node scripts/mainnet/change_global_manager.ts\n"
    );
    process.exit(1);
  }

  const newManagerPublicKey = new PublicKey(newManagerPubkeyEnv);

  console.log("📍 Configuration:");
  console.log("   RPC Endpoint:", RPC_ENDPOINT);
  console.log("   Current Manager (wallet):", wallet.publicKey.toBase58());
  console.log("   New Manager:", newManagerPublicKey.toBase58());
  console.log("   Program ID:", flipperProgram.programId.toBase58());

  // Derive global manager PDA
  const [globalManagerPda, globalManagerBump] =
    PublicKey.findProgramAddressSync(
      [Buffer.from("global_manager")],
      flipperProgram.programId
    );

  console.log("   Global Manager PDA:", globalManagerPda.toBase58());
  console.log("   Bump:", globalManagerBump, "\n");

  // Check if global manager exists and verify current manager
  try {
    const existingManager = await (
      flipperProgram.account as any
    ).globalManager.fetch(globalManagerPda);
    console.log("📊 Current Global Manager:");
    console.log("   Manager:", existingManager.manager.toBase58());
    console.log("   Bump:", existingManager.bump, "\n");

    if (existingManager.manager.toBase58() !== wallet.publicKey.toBase58()) {
      console.error("❌ ERROR: Your wallet is not the current Global Manager!");
      console.log("   Current Manager:", existingManager.manager.toBase58());
      console.log("   Your Wallet:", wallet.publicKey.toBase58());
      console.log(
        "\n💡 Only the current Global Manager can change to a new manager\n"
      );
      process.exit(1);
    }

    if (existingManager.manager.toBase58() === newManagerPublicKey.toBase58()) {
      console.log("⚠️  WARNING: New manager is the same as current manager");
      console.log("   No change needed. Exiting...\n");
      process.exit(0);
    }

    console.log("✅ Verified: Wallet is the current Global Manager\n");
  } catch (error) {
    console.error("❌ ERROR: Global Manager does not exist!");
    console.log(
      "\n💡 You need to create it first using create_global_manager.ts\n"
    );
    process.exit(1);
  }

  // Confirm with user
  console.log("⚠️  Please confirm the following:");
  console.log("   - You have verified the NEW manager address is correct");
  console.log("   - You understand this transfer is irreversible");
  console.log("   - The new manager address is a multisig (recommended)");
  console.log("   - You have documented this change in your records");
  console.log(`   - New Manager: ${newManagerPublicKey.toBase58()}\n`);

  if (process.env.SKIP_CONFIRMATION !== "true") {
    console.log("💡 Set SKIP_CONFIRMATION=true to skip this check\n");
    console.log("Waiting 10 seconds before proceeding...");
    console.log("⚠️  Press Ctrl+C to cancel if you're not sure!\n");
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }

  try {
    console.log("📝 Creating change Global Manager transaction...");

    const tx = await flipperProgram.methods
      .changeGlobalManager()
      .accounts({
        globalManager: globalManagerPda,
        currentManager: wallet.publicKey,
        newManager: newManagerPublicKey,
      })
      .rpc();

    console.log("✅ Global Manager changed successfully!");
    console.log("   Transaction:", tx);
    console.log("   Explorer:", `https://solscan.io/tx/${tx}`);

    // Verify the change
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const updatedManager = await (
      flipperProgram.account as any
    ).globalManager.fetch(globalManagerPda);

    console.log("\n📊 Updated Global Manager Account:");
    console.log("   Address:", globalManagerPda.toBase58());
    console.log("   New Manager:", updatedManager.manager.toBase58());
    console.log("   Bump:", updatedManager.bump);

    if (updatedManager.manager.toBase58() !== newManagerPublicKey.toBase58()) {
      console.log("\n❌ ERROR: Manager address mismatch!");
      console.log("   Expected:", newManagerPublicKey.toBase58());
      console.log("   Got:", updatedManager.manager.toBase58());
    } else {
      console.log("\n✅ Verification passed: Manager changed successfully");
    }

    console.log("\n🎯 Important Notes:");
    console.log("   1. Document this change in your records");
    console.log("   2. The old manager (your wallet) no longer has control");
    console.log("   3. Only the new manager can make future changes");
    console.log("   4. Keep the new manager's credentials extremely secure");
    console.log("\n⚠️  If the new manager is a multisig:");
    console.log("   - Verify all signers have access");
    console.log("   - Test the multisig before performing critical operations");
  } catch (error: any) {
    console.error("\n❌ Error changing Global Manager:");
    console.error(error);

    if (error.message?.includes("UnauthorizedGlobalManager")) {
      console.log(
        "\n💡 Your wallet is not authorized to change the Global Manager"
      );
      console.log(
        "   Only the current Global Manager can perform this operation"
      );
    }

    process.exit(1);
  }
}

// Run the function
changeGlobalManager()
  .then(() => {
    console.log("\n✅ Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Script failed:", error);
    process.exit(1);
  });
