import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Keypair, PublicKey, Connection } from "@solana/web3.js";
import FLIPPER_IDL from "../../target/idl/flipper.json";
import fs from "fs";

/**
 * Script to check if Global Manager exists and who is the current manager
 *
 * Usage:
 * ts-node scripts/mainnet/check_global_manager.ts
 *
 * Or for devnet:
 * RPC_ENDPOINT=https://api.devnet.solana.com ts-node scripts/mainnet/check_global_manager.ts
 */

// Function to load keypair (optional for this script)
const loadKeypair = (): Keypair => {
  const keypairPath = process.env.HOME + "/.config/solana/fpp-staging.json";
  const idPath = process.env.HOME + "/.config/solana/id.json";

  if (fs.existsSync(keypairPath)) {
    const secretKey = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
  } else if (fs.existsSync(idPath)) {
    const secretKey = JSON.parse(fs.readFileSync(idPath, "utf8"));
    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
  }

  // Generate temporary keypair if no wallet found (we only need to read data)
  return Keypair.generate();
};

// Configure connection
const RPC_ENDPOINT =
  process.env.RPC_ENDPOINT || "https://api.mainnet-beta.solana.com";
const connection = new Connection(RPC_ENDPOINT, "confirmed");

// Create wallet and provider
const wallet = new anchor.Wallet(loadKeypair());
const provider = new AnchorProvider(connection, wallet, {
  commitment: "confirmed",
});
anchor.setProvider(provider);

// Load program
const flipperProgram = new Program(FLIPPER_IDL, provider);

async function checkGlobalManager() {
  console.log("🔍 Checking Global Manager status...\n");
  console.log("📍 Configuration:");
  console.log("   RPC Endpoint:", RPC_ENDPOINT);
  console.log("   Program ID:", flipperProgram.programId.toBase58());
  console.log("   Your Wallet:", wallet.publicKey.toBase58(), "\n");

  // Derive global manager PDA
  const [globalManagerPda, globalManagerBump] =
    PublicKey.findProgramAddressSync(
      [Buffer.from("global_manager")],
      flipperProgram.programId
    );

  console.log("📊 Global Manager PDA:");
  console.log("   Address:", globalManagerPda.toBase58());
  console.log("   Bump:", globalManagerBump, "\n");

  // Check if global manager exists
  try {
    const globalManager = await (
      flipperProgram.account as any
    ).globalManager.fetch(globalManagerPda);

    console.log("✅ Global Manager EXISTS!\n");
    console.log("📋 Details:");
    console.log("   Current Manager:", globalManager.manager.toBase58());
    console.log("   Bump:", globalManager.bump);

    // Check if current wallet is the manager
    if (globalManager.manager.toBase58() === wallet.publicKey.toBase58()) {
      console.log("\n✅ Your wallet IS the current Global Manager!");
      console.log("   You can:");
      console.log("   - Change vault authority admin");
      console.log("   - Withdraw platform fees");
      console.log("   - Change global manager to another address");
      console.log("\n💡 To change manager:");
      console.log(
        "   NEW_MANAGER_PUBKEY=<address> ts-node scripts/mainnet/change_global_manager.ts"
      );
    } else {
      console.log("\n⚠️  Your wallet is NOT the current Global Manager");
      console.log("   Current Manager:", globalManager.manager.toBase58());
      console.log("   Your Wallet:", wallet.publicKey.toBase58());
      console.log("\n   Only the current manager can:");
      console.log("   - Change vault authority admin");
      console.log("   - Withdraw platform fees");
      console.log("   - Transfer manager role");
    }

    // Check account info
    const accountInfo = await connection.getAccountInfo(globalManagerPda);
    if (accountInfo) {
      console.log("\n📦 Account Info:");
      console.log("   Owner:", accountInfo.owner.toBase58());
      console.log("   Lamports:", accountInfo.lamports / 1e9, "SOL");
      console.log("   Data Length:", accountInfo.data.length, "bytes");
    }
  } catch (error: any) {
    console.log("❌ Global Manager DOES NOT EXIST\n");
    console.log("💡 To create Global Manager:");
    console.log(
      "   MANAGER_PUBKEY=<manager_address> ts-node scripts/mainnet/create_global_manager.ts"
    );
    console.log("\n⚠️  IMPORTANT:");
    console.log("   - This can only be done ONCE");
    console.log("   - First person to call it becomes the manager");
    console.log("   - Use a multisig address for production");
    console.log("\n   If no MANAGER_PUBKEY is set, your wallet will be used:");
    console.log("   ts-node scripts/mainnet/create_global_manager.ts");
  }

  console.log("\n" + "=".repeat(60));
}

// Run the function
checkGlobalManager()
  .then(() => {
    console.log("\n✅ Check completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
