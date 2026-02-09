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

async function replaceOperator() {
  console.log("🚀 Replacing operator on mainnet...\n");

  // Get old and new operator addresses from environment variables
  const oldOperatorPubkey = process.env.OLD_OPERATOR_PUBKEY;
  const newOperatorPubkey = process.env.NEW_OPERATOR_PUBKEY;

  if (!oldOperatorPubkey || !newOperatorPubkey) {
    throw new Error(
      "Both OLD_OPERATOR_PUBKEY and NEW_OPERATOR_PUBKEY environment variables are required.\n" +
        "Usage: OLD_OPERATOR_PUBKEY=<old_address> NEW_OPERATOR_PUBKEY=<new_address> ts-node replace_operator.ts"
    );
  }

  const oldOperator = new PublicKey(oldOperatorPubkey);
  const newOperator = new PublicKey(newOperatorPubkey);

  console.log("📍 Configuration:");
  console.log("   Authority:", wallet.publicKey.toBase58());
  console.log("   Old Operator (to remove):", oldOperator.toBase58());
  console.log("   New Operator (to add):", newOperator.toBase58(), "\n");

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

  // Verify that the old operator exists
  const oldOperatorExists = registryAccount.operators.some((op: PublicKey) =>
    op.equals(oldOperator)
  );
  if (!oldOperatorExists) {
    console.warn(
      "⚠️  Old operator not found in the registry. Skipping removal."
    );
    console.log(
      "   Current operators:",
      registryAccount.operators.map((op: PublicKey) => op.toBase58()).join(", ")
    );
  } else {
    // Step 1: Remove old operator
    console.log("⚙️  Step 1: Removing old operator...");
    try {
      const removeTxSignature = await flipperProgram.methods
        .removeOperator(oldOperator)
        .accounts({
          adapterRegistry,
          authority: wallet.publicKey,
        })
        .signers([wallet.payer])
        .rpc();

      console.log("✅ Old operator removed successfully!");
      console.log("   Transaction signature:", removeTxSignature);
      console.log("");
    } catch (error) {
      console.error("❌ Failed to remove old operator:", error);
      throw error;
    }
  }

  // Step 2: Add new operator
  console.log("⚙️  Step 2: Adding new operator...");
  try {
    const addTxSignature = await flipperProgram.methods
      .addOperator(newOperator)
      .accounts({
        adapterRegistry,
        authority: wallet.publicKey,
      })
      .signers([wallet.payer])
      .rpc();

    console.log("✅ New operator added successfully!");
    console.log("   Transaction signature:", addTxSignature);
    console.log("");
  } catch (error) {
    console.error("❌ Failed to add new operator:", error);
    throw error;
  }

  // Verify the replacement
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

    const newOperatorExists = registryAccount.operators.some((op: PublicKey) =>
      op.equals(newOperator)
    );
    const oldOperatorStillExists = registryAccount.operators.some(
      (op: PublicKey) => op.equals(oldOperator)
    );

    if (newOperatorExists && !oldOperatorStillExists) {
      console.log("\n🎉 Operator replacement completed successfully!\n");
    } else {
      console.warn("\n⚠️  Operator replacement may have issues:");
      if (!newOperatorExists) {
        console.warn("   - New operator not found in registry");
      }
      if (oldOperatorStillExists) {
        console.warn("   - Old operator still exists in registry");
      }
      console.log("");
    }
  } catch (error) {
    console.error("❌ Failed to verify operator replacement:", error);
    throw error;
  }
}

// Main execution
(async () => {
  try {
    await replaceOperator();
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
})();
