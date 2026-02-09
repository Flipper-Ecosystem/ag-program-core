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

async function addOperator() {
  console.log("🚀 Adding operator on mainnet...\n");

  // Get operator address from environment variable
  const operatorPubkey = process.env.OPERATOR_PUBKEY;

  if (!operatorPubkey) {
    throw new Error(
      "OPERATOR_PUBKEY environment variable is required.\n" +
        "Usage: OPERATOR_PUBKEY=<operator_address> ts-node add_operator.ts"
    );
  }

  const operator = new PublicKey(operatorPubkey);

  console.log("📍 Configuration:");
  console.log("   Authority:", wallet.publicKey.toBase58());
  console.log("   Operator to add:", operator.toBase58(), "\n");

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

  // Check if operator already exists
  const operatorExists = registryAccount.operators.some((op: PublicKey) =>
    op.equals(operator)
  );
  if (operatorExists) {
    console.warn("⚠️  Operator already exists in the registry!");
    console.log("   No action needed.\n");
    return;
  }

  // Add operator
  console.log("⚙️  Adding operator...");
  try {
    const txSignature = await flipperProgram.methods
      .addOperator(operator)
      .accounts({
        adapterRegistry,
        authority: wallet.publicKey,
      })
      .signers([wallet.payer])
      .rpc();

    console.log("✅ Operator added successfully!");
    console.log("   Transaction signature:", txSignature);
    console.log("");
  } catch (error) {
    console.error("❌ Failed to add operator:", error);
    throw error;
  }

  // Verify the addition
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

    const operatorNowExists = registryAccount.operators.some((op: PublicKey) =>
      op.equals(operator)
    );

    if (operatorNowExists) {
      console.log("\n🎉 Operator added successfully!\n");
    } else {
      console.warn(
        "\n⚠️  Operator not found in registry after addition. Something went wrong.\n"
      );
    }
  } catch (error) {
    console.error("❌ Failed to verify operator addition:", error);
    throw error;
  }
}

// Main execution
(async () => {
  try {
    await addOperator();
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
})();
