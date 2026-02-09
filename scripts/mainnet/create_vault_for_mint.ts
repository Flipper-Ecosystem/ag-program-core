/**
 * Create Vault for a specific mint
 *
 * This script creates a vault for a given token mint. Only Vault Authority admin or authorized operators can create vaults.
 *
 * Usage:
 * MINT_ADDRESS=<mint_pubkey> ts-node scripts/mainnet/create_vault_for_mint.ts
 *
 * Example:
 * MINT_ADDRESS=So11111111111111111111111111111111111111112 ts-node scripts/mainnet/create_vault_for_mint.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAccount } from "@solana/spl-token";
import * as fs from "fs";
import idl from "../../target/idl/flipper.json";
import * as dotenv from "dotenv";

dotenv.config();

const MAINNET_RPC =
  process.env.MAINNET_RPC || "https://api.mainnet-beta.solana.com";
const MINT_ADDRESS = process.env.MINT_ADDRESS;

// Function to load keypair
const loadKeypair = (): Keypair => {
  const fppStagingPath = process.env.HOME + "/.config/solana/fpp-staging.json";
  const defaultPath = process.env.HOME + "/.config/solana/id.json";

  if (fs.existsSync(fppStagingPath)) {
    const secretKey = JSON.parse(fs.readFileSync(fppStagingPath, "utf8"));
    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
  } else if (fs.existsSync(defaultPath)) {
    const secretKey = JSON.parse(fs.readFileSync(defaultPath, "utf8"));
    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
  }
  throw new Error(
    "Keypair file not found at: " + fppStagingPath + " or " + defaultPath
  );
};

async function createVaultForMint() {
  console.log("============================================================");
  console.log("🏦 Create Vault for Token Mint on Mainnet");
  console.log("============================================================\n");

  // Validation
  if (!MINT_ADDRESS) {
    console.log("❌ ERROR: MINT_ADDRESS environment variable is required\n");
    console.log("Usage:");
    console.log("  MINT_ADDRESS=<mint_pubkey> npm run mainnet:create-vault\n");
    console.log("Examples:");
    console.log(
      "  MINT_ADDRESS=So11111111111111111111111111111111111111112 npm run mainnet:create-vault  # WSOL"
    );
    console.log(
      "  MINT_ADDRESS=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v npm run mainnet:create-vault  # USDC"
    );
    process.exit(1);
  }

  const mintPubkey = new PublicKey(MINT_ADDRESS);

  // Setup
  const connection = new Connection(MAINNET_RPC, "confirmed");
  const wallet = new anchor.Wallet(loadKeypair());
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  const flipperProgram = new anchor.Program(idl as anchor.Idl, provider);

  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority")],
    flipperProgram.programId
  );

  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), mintPubkey.toBuffer()],
    flipperProgram.programId
  );

  console.log("📍 Configuration:");
  console.log("   Admin Wallet:", wallet.publicKey.toBase58());
  console.log("   Mint:", mintPubkey.toBase58());
  console.log("   Vault PDA:", vault.toBase58());
  console.log("   Vault Authority:", vaultAuthority.toBase58());
  console.log();

  // Check if vault already exists
  try {
    const vaultInfo = await connection.getAccountInfo(vault);
    if (vaultInfo) {
      const vaultAccount = await getAccount(connection, vault);
      console.log("⚠️  Vault already exists!");
      console.log("   Balance:", vaultAccount.amount.toString());
      console.log("   Owner:", vaultAccount.owner.toBase58());
      process.exit(0);
    }
  } catch (e) {
    // Vault doesn't exist, continue
  }

  // Check authorization
  try {
    const vaultAuthAccount = await (
      flipperProgram.account as any
    ).vaultAuthority.fetch(vaultAuthority);

    const isAdmin = vaultAuthAccount.admin.equals(wallet.publicKey);

    console.log("🔐 Authorization check:");
    console.log("   Vault Authority Admin:", vaultAuthAccount.admin.toBase58());
    console.log("   Is current wallet admin?", isAdmin ? "✅ Yes" : "❌ No");
    console.log();

    if (!isAdmin) {
      console.log(
        "❌ ERROR: Current wallet is not authorized to create vaults"
      );
      console.log("   Only Vault Authority admin can create vaults");
      console.log(
        "   Current deployed program version uses admin-only authorization"
      );
      process.exit(1);
    }
  } catch (e) {
    console.log("❌ Error checking authorization:", e);
    process.exit(1);
  }

  // Create vault
  console.log("🏗️  Creating vault...");
  try {
    const tx = await flipperProgram.methods
      .createVault()
      .accounts({
        vaultAuthority,
        vault,
        vaultMint: mintPubkey,
        vaultTokenProgram: TOKEN_PROGRAM_ID,
        payer: wallet.publicKey,
        admin: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([wallet.payer])
      .rpc();

    console.log("✅ Vault created successfully!");
    console.log("   Transaction:", tx);
    console.log(`   Explorer: https://solscan.io/tx/${tx}`);
    console.log();

    // Verify
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const vaultAccount = await getAccount(connection, vault);
    console.log("📊 Vault details:");
    console.log("   Address:", vault.toBase58());
    console.log("   Mint:", vaultAccount.mint.toBase58());
    console.log("   Owner:", vaultAccount.owner.toBase58());
    console.log("   Balance:", vaultAccount.amount.toString());
  } catch (error: any) {
    console.log("❌ Error creating vault:");
    console.error(error);
    process.exit(1);
  }
}

createVaultForMint()
  .then(() => {
    console.log("\n✅ Script completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Script failed:", error);
    process.exit(1);
  });
