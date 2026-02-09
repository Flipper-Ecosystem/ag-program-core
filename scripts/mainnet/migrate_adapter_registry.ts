import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Keypair, PublicKey, Connection, SystemProgram } from "@solana/web3.js";
import FLIPPER_IDL from "../../target/idl/flipper.json";
import fs from "fs";

/**
 * Script to migrate the AdapterRegistry account on Mainnet.
 *
 * After upgrading the program to a version that stores the PDA bump in AdapterRegistry,
 * this script must be called once to:
 *   1. Realloc the account by 1 byte (from 1048 to 1049 bytes)
 *   2. Write the correct bump value into the account data
 *
 * Without this migration, any instruction that uses `bump = adapter_registry.bump`
 * (e.g. CreateVault, CloseVault, InitializeVaults, CreateVaultWithExtensions) will fail.
 *
 * Usage:
 *   ts-node scripts/mainnet/migrate_adapter_registry.ts
 *   # or
 *   npm run mainnet:migrate-registry
 *
 * The wallet used must be the current authority of the AdapterRegistry.
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

async function migrateAdapterRegistry() {
  console.log("=== Migrate AdapterRegistry: write PDA bump ===\n");

  console.log("Configuration:");
  console.log("  RPC Endpoint:", RPC_ENDPOINT);
  console.log("  Authority (wallet):", wallet.publicKey.toBase58());
  console.log("  Program ID:", flipperProgram.programId.toBase58());

  // Derive adapter registry PDA
  const [adapterRegistry, adapterRegistryBump] =
    PublicKey.findProgramAddressSync(
      [Buffer.from("adapter_registry")],
      flipperProgram.programId
    );

  console.log("  Adapter Registry PDA:", adapterRegistry.toBase58());
  console.log("  Expected bump:", adapterRegistryBump, "\n");

  // Fetch current account state
  const accountInfo = await connection.getAccountInfo(adapterRegistry);
  if (!accountInfo) {
    console.error("ERROR: AdapterRegistry account not found on-chain.");
    console.log("  Run initialize_adapter_registry.ts first.\n");
    process.exit(1);
  }

  console.log("Current on-chain account:");
  console.log("  Owner:", accountInfo.owner.toBase58());
  console.log("  Data length:", accountInfo.data.length, "bytes");
  console.log("  Lamports:", accountInfo.lamports);

  // Try to fetch via Anchor to inspect fields
  let registryAccount: any;
  try {
    registryAccount = await (
      flipperProgram.account as any
    ).adapterRegistry.fetch(adapterRegistry);
    console.log("  Authority:", registryAccount.authority.toBase58());
    console.log("  Operators:", registryAccount.operators.length);
    console.log(
      "  Supported adapters:",
      registryAccount.supportedAdapters.length
    );
    console.log("  Current bump value:", registryAccount.bump, "\n");
  } catch (error: any) {
    console.warn(
      "  WARNING: Could not deserialize with new IDL (expected if bump field is missing)."
    );
    console.log("  Proceeding with migration anyway.\n");
  }

  // Verify authority
  if (registryAccount && !registryAccount.authority.equals(wallet.publicKey)) {
    console.error("ERROR: Wallet is not the authority of the AdapterRegistry.");
    console.log("  Current authority:", registryAccount.authority.toBase58());
    console.log("  Wallet:", wallet.publicKey.toBase58());
    process.exit(1);
  }

  // Check if migration is already done
  if (registryAccount && registryAccount.bump === adapterRegistryBump) {
    console.log(
      "Migration already completed. Bump is correct:",
      registryAccount.bump
    );
    console.log("No action needed.\n");
    return;
  }

  // Confirmation wait
  if (process.env.SKIP_CONFIRMATION !== "true") {
    console.log("Set SKIP_CONFIRMATION=true to skip this wait.\n");
    console.log("Waiting 5 seconds before proceeding...");
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  // Execute migration
  console.log("Executing migrateAdapterRegistry instruction...");
  try {
    const txSignature = await flipperProgram.methods
      .migrateAdapterRegistry()
      .accounts({
        adapterRegistry,
        payer: wallet.publicKey,
        authority: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([wallet.payer])
      .rpc();

    console.log("Transaction sent:", txSignature);
    console.log("Explorer: https://solscan.io/tx/" + txSignature + "\n");
  } catch (error: any) {
    console.error("ERROR: Migration transaction failed:");
    console.error(error);
    process.exit(1);
  }

  // Wait for confirmation and verify
  console.log("Waiting for confirmation...");
  await new Promise((resolve) => setTimeout(resolve, 3000));

  try {
    const updatedAccount = await (
      flipperProgram.account as any
    ).adapterRegistry.fetch(adapterRegistry);
    const updatedInfo = await connection.getAccountInfo(adapterRegistry);

    console.log("\nVerification after migration:");
    console.log("  Data length:", updatedInfo?.data.length, "bytes");
    console.log("  Authority:", updatedAccount.authority.toBase58());
    console.log("  Operators:", updatedAccount.operators.length);
    console.log(
      "  Supported adapters:",
      updatedAccount.supportedAdapters.length
    );
    console.log("  Bump:", updatedAccount.bump);

    if (updatedAccount.bump === adapterRegistryBump) {
      console.log("\nMigration completed successfully! Bump is correct.\n");
    } else {
      console.error("\nWARNING: Bump mismatch after migration!");
      console.log("  Expected:", adapterRegistryBump);
      console.log("  Got:", updatedAccount.bump);
      process.exit(1);
    }
  } catch (error: any) {
    console.error("ERROR: Verification failed:", error);
    process.exit(1);
  }
}

// Main execution
(async () => {
  try {
    await migrateAdapterRegistry();
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
})();
