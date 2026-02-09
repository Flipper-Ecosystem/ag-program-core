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
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccount,
  getAccount,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import FLIPPER_IDL from "../../target/idl/flipper.json";
import fs from "fs";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Function to load or generate a keypair for the wallet
const loadKeypair = (): Keypair => {
  const keypairPath = process.env.HOME + "/.config/solana/id.json";
  if (fs.existsSync(keypairPath)) {
    const secretKey = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
  }
  console.warn("Keypair file not found, generating a new one for devnet.");
  return Keypair.generate();
};

// Configure connection to Solana Devnet
const connection = new Connection("https://api.devnet.solana.com", "confirmed");

// Create wallet and provider for Anchor
const wallet = new anchor.Wallet(loadKeypair());
const provider = new AnchorProvider(connection, wallet, {
  commitment: "confirmed",
});
anchor.setProvider(provider);

// Load programs
const flipperProgram = new Program(FLIPPER_IDL, provider);

let newOperator: PublicKey;
let vault_authority: PublicKey;
let vault_authorityBump: number;
let adapterRegistry: PublicKey;
let adapterRegistryBump: number;

async function changeVaultAuthority() {
  console.log("🔐 Changing vault authority on devnet...\n");

  // Get new operator address from environment variable
  const newOperatorAddress = process.env.NEW_VAULT_AUTHORITY_ADDRESS;
  if (!newOperatorAddress) {
    throw new Error(
      "NEW_VAULT_AUTHORITY_ADDRESS environment variable is not set"
    );
  }

  newOperator = new PublicKey(newOperatorAddress);
  console.log(`New vault authority address: ${newOperator.toBase58()}`);
  console.log(`Current admin: ${wallet.publicKey.toBase58()}\n`);

  [vault_authority, vault_authorityBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority")],
    flipperProgram.programId
  );

  console.log(`Vault authority PDA: ${vault_authority.toBase58()}\n`);

  const txSignature = await flipperProgram.methods
    .changeVaultAuthorityAdmin()
    .accounts({
      vault_authority,
      currentAdmin: wallet.publicKey,
      newAdmin: newOperator,
    })
    .signers([wallet.payer])
    .rpc();

  console.log("✅ Vault authority changed successfully!");
  console.log(`Transaction signature: ${txSignature}\n`);

  return txSignature;
}

async function addOperator() {
  console.log("👤 Adding operator on devnet...\n");

  [adapterRegistry, adapterRegistryBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("adapter_registry")],
    flipperProgram.programId
  );

  console.log(`Adapter registry PDA: ${adapterRegistry.toBase58()}`);
  console.log(`Adding operator: ${newOperator.toBase58()}\n`);

  const txSignature = await flipperProgram.methods
    .addOperator(newOperator)
    .accounts({
      adapterRegistry,
      authority: wallet.publicKey,
    })
    .signers([wallet.payer])
    .rpc();

  console.log("✅ Operator added successfully!");
  console.log(`Transaction signature: ${txSignature}\n`);

  return txSignature;
}

// Main execution
(async () => {
  try {
    console.log("=".repeat(60));
    console.log("🚀 Starting vault authority change and operator addition");
    console.log("=".repeat(60));
    console.log();

    // Step 1: Change vault authority
    await changeVaultAuthority();

    console.log("-".repeat(60));
    console.log();

    // Step 2: Add as operator
    await addOperator();

    console.log("=".repeat(60));
    console.log("🎉 All operations completed successfully!");
    console.log("=".repeat(60));
  } catch (error) {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  }
})();
