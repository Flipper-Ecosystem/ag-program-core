import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Keypair, PublicKey, Connection } from "@solana/web3.js";
import FLIPPER_IDL from "../../target/idl/flipper.json";
import fs from "fs";

// Function to load keypair for mainnet wallet
const loadKeypair = (): Keypair => {
  const keypairPath = process.env.HOME + "/.config/solana/fpp-staging.json";
  if (fs.existsSync(keypairPath)) {
    const secretKey = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
  }
  throw new Error("Keypair file not found at " + keypairPath);
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

let adapterRegistry: PublicKey;
let adapterRegistryBump: number;

async function removeOperator() {
  console.log("🚀 Removing operator on mainnet...\n");

  // Get operator address from environment variable
  const operatorPubkey = process.env.OPERATOR_PUBKEY;

  if (!operatorPubkey) {
    throw new Error(
      "OPERATOR_PUBKEY environment variable is required.\n" +
        "Usage: OPERATOR_PUBKEY=<operator_address> ts-node remove_operator.ts"
    );
  }

  const operator = new PublicKey(operatorPubkey);

  console.log("📍 Configuration:");
  console.log("   Authority:", wallet.publicKey.toBase58());
  console.log("   Operator to remove:", operator.toBase58(), "\n");

  // Derive adapter registry PDA
  [adapterRegistry, adapterRegistryBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("adapter_registry")],
    flipperProgram.programId
  );

  console.log("📍 Adapter Registry PDA:", adapterRegistry.toBase58(), "\n");

  // Check current registry state
  let registryAccount;
  try {
    registryAccount = await (
      flipperProgram.account as any
    ).adapterRegistry.fetch(adapterRegistry);
    console.log("📊 Current registry state:");
    console.log("   Authority:", registryAccount.authority.toBase58());
    console.log(
      "   Current operators:",
      registryAccount.operators.map((op: PublicKey) => op.toBase58()).join(", ")
    );
    console.log("");
  } catch (error: any) {
    console.error("❌ Failed to fetch adapter registry. Is it initialized?");
    throw error;
  }

  // Check if operator exists
  const operatorExists = registryAccount.operators.some((op: PublicKey) =>
    op.equals(operator)
  );
  if (!operatorExists) {
    console.warn("⚠️  Operator not found in the registry!");
    console.log(
      "   Current operators:",
      registryAccount.operators.map((op: PublicKey) => op.toBase58()).join(", ")
    );
    console.log("   No action needed.\n");
    return;
  }

  // Remove operator
  console.log("⚙️  Removing operator...");
  try {
    const txSignature = await flipperProgram.methods
      .removeOperator(operator)
      .accounts({
        adapterRegistry,
        authority: wallet.publicKey,
      })
      .signers([wallet.payer])
      .rpc();

    console.log("✅ Operator removed successfully!");
    console.log("   Transaction signature:", txSignature);
    console.log("");
  } catch (error) {
    console.error("❌ Failed to remove operator:", error);
    throw error;
  }

  // Verify the removal
  try {
    registryAccount = await (
      flipperProgram.account as any
    ).adapterRegistry.fetch(adapterRegistry);
    console.log("✅ Verification - Updated registry state:");
    console.log("   Authority:", registryAccount.authority.toBase58());
    console.log(
      "   Current operators:",
      registryAccount.operators.map((op: PublicKey) => op.toBase58()).join(", ")
    );

    const operatorStillExists = registryAccount.operators.some(
      (op: PublicKey) => op.equals(operator)
    );

    if (!operatorStillExists) {
      console.log("\n🎉 Operator removed successfully!\n");
    } else {
      console.warn(
        "\n⚠️  Operator still exists in registry after removal. Something went wrong.\n"
      );
    }
  } catch (error) {
    console.error("❌ Failed to verify operator removal:", error);
    throw error;
  }
}

// Main execution
(async () => {
  try {
    await removeOperator();
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
})();
