import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Keypair, PublicKey, Connection, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAccount } from "@solana/spl-token";
import FLIPPER_IDL from "../../target/idl/flipper.json";
import fs from "fs";

// Load configuration
const configPath = "./scripts/devnet/jupiter_test_config.json";
if (!fs.existsSync(configPath)) {
  console.error("❌ Configuration file not found!");
  console.log("   Please run setup first: npm run devnet:setup-jupiter");
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

// ALWAYS use id.json for this script (it has admin rights)
const loadKeypair = (): Keypair => {
  const idJsonPath = process.env.HOME + "/.config/solana/id.json";

  if (fs.existsSync(idJsonPath)) {
    console.log("📝 Using id.json keypair (admin)");
    const secretKey = JSON.parse(fs.readFileSync(idJsonPath, "utf8"));
    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
  }
  throw new Error("id.json keypair not found at: " + idJsonPath);
};

// Configure connection to Solana Devnet
const connection = new Connection("https://api.devnet.solana.com", "confirmed");

// Create wallet and provider
const wallet = new anchor.Wallet(loadKeypair());
const provider = new AnchorProvider(connection, wallet, {
  commitment: "confirmed",
});
anchor.setProvider(provider);

// Load program
const flipperProgram = new Program(FLIPPER_IDL, provider);

// Load addresses from config
const vaultAuthority = new PublicKey(config.vaultAuthority);
const sourceMint = new PublicKey(config.sourceMint);
const destinationMint = new PublicKey(config.destinationMint);
const sourceVault = new PublicKey(config.sourceVault);
const destinationVault = new PublicKey(config.destinationVault);

async function createVaults() {
  try {
    console.log("🏦 Creating vaults with id.json admin...\n");
    console.log("📍 Configuration:");
    console.log("   Admin:", wallet.publicKey.toBase58());
    console.log("   Vault Authority:", vaultAuthority.toBase58());
    console.log("   Source Mint:", sourceMint.toBase58());
    console.log("   Destination Mint:", destinationMint.toBase58());
    console.log("   Source Vault:", sourceVault.toBase58());
    console.log("   Destination Vault:", destinationVault.toBase58(), "\n");

    // Check admin balance
    const adminBalance = await connection.getBalance(wallet.publicKey);
    console.log("💰 Admin balance:", adminBalance / 1e9, "SOL\n");

    if (adminBalance < 0.1 * 1e9) {
      console.error("❌ Insufficient balance. Need at least 0.1 SOL");
      process.exit(1);
    }

    // Check if source vault exists
    console.log("🔍 Checking source vault...");
    const sourceVaultInfo = await connection.getAccountInfo(sourceVault);
    if (!sourceVaultInfo) {
      console.log("   Creating source vault...");
      try {
        await flipperProgram.methods
          .createVault()
          .accounts({
            vaultAuthority,
            vault: sourceVault,
            vaultMint: sourceMint,
            vaultTokenProgram: TOKEN_PROGRAM_ID,
            payer: wallet.publicKey,
            admin: wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([wallet.payer])
          .rpc();
        console.log("   ✅ Created source vault");
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (e: any) {
        console.error("   ❌ Failed to create source vault:", e.message);
        throw e;
      }
    } else {
      console.log("   ✅ Source vault already exists");
    }

    // Verify source vault
    try {
      const sourceVaultAccount = await getAccount(connection, sourceVault);
      console.log("   ✅ Source vault verified");
      console.log("      Mint:", sourceVaultAccount.mint.toBase58());
      console.log("      Owner:", sourceVaultAccount.owner.toBase58());
      console.log("      Balance:", sourceVaultAccount.amount.toString(), "\n");
    } catch (e: any) {
      console.error("   ❌ Source vault verification failed:", e.message);
      throw e;
    }

    // Check if destination vault exists
    console.log("🔍 Checking destination vault...");
    const destVaultInfo = await connection.getAccountInfo(destinationVault);
    if (!destVaultInfo) {
      console.log("   Creating destination vault...");
      try {
        await flipperProgram.methods
          .createVault()
          .accounts({
            vaultAuthority,
            vault: destinationVault,
            vaultMint: destinationMint,
            vaultTokenProgram: TOKEN_PROGRAM_ID,
            payer: wallet.publicKey,
            admin: wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([wallet.payer])
          .rpc();
        console.log("   ✅ Created destination vault");
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (e: any) {
        console.error("   ❌ Failed to create destination vault:", e.message);
        throw e;
      }
    } else {
      console.log("   ✅ Destination vault already exists");
    }

    // Verify destination vault
    try {
      const destVaultAccount = await getAccount(connection, destinationVault);
      console.log("   ✅ Destination vault verified");
      console.log("      Mint:", destVaultAccount.mint.toBase58());
      console.log("      Owner:", destVaultAccount.owner.toBase58());
      console.log("      Balance:", destVaultAccount.amount.toString(), "\n");
    } catch (e: any) {
      console.error("   ❌ Destination vault verification failed:", e.message);
      throw e;
    }

    console.log("=".repeat(60));
    console.log("✅ VAULTS CREATED SUCCESSFULLY!");
    console.log("=".repeat(60));
    console.log("\n💡 Next steps:");
    console.log("   1. Run test: npm run devnet:test-route");
    console.log("   2. Or verify: npm run devnet:check-status\n");
  } catch (error: any) {
    console.error("\n❌ Error:", error);
    process.exit(1);
  }
}

// Main execution
(async () => {
  try {
    await createVaults();
  } catch (error: any) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
})();
