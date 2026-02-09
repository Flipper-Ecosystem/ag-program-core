import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  Connection,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAccount } from "@solana/spl-token";
import FLIPPER_IDL from "../../target/idl/flipper.json";
import MOCK_JUPITER_IDL from "../../target/idl/mock_jupiter.json";
import fs from "fs";

// Load configuration
const configPath = "./scripts/devnet/jupiter_test_config.json";
if (!fs.existsSync(configPath)) {
  console.error("❌ Configuration file not found!");
  console.log(
    "   Please run: ts-node scripts/devnet/4.setup_shared_jupiter_environment.ts"
  );
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

// Function to load keypair
const loadKeypair = (): Keypair => {
  // Try to load fpp-staging.json first, fallback to id.json
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

// Configure connection to Solana Devnet
const connection = new Connection("https://api.devnet.solana.com", "confirmed");

// Create wallet and provider
const wallet = new anchor.Wallet(loadKeypair());
const provider = new AnchorProvider(connection, wallet, {
  commitment: "confirmed",
});
anchor.setProvider(provider);

// Load programs
const flipperProgram = new Program(FLIPPER_IDL, provider);
const mockJupiterProgram = new Program(MOCK_JUPITER_IDL, provider);

function formatTokenAmount(amount: bigint, decimals: number = 6): string {
  const divisor = BigInt(10 ** decimals);
  const wholePart = amount / divisor;
  const fractionalPart = amount % divisor;
  return `${wholePart}.${fractionalPart.toString().padStart(decimals, "0")}`;
}

async function checkAccountStatus() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║         JUPITER SHARED - ACCOUNT STATUS CHECKER            ║");
  console.log(
    "╚════════════════════════════════════════════════════════════╝\n"
  );

  // Load addresses
  const vaultAuthority = new PublicKey(config.vaultAuthority);
  const adapterRegistry = new PublicKey(config.adapterRegistry);
  const sourceMint = new PublicKey(config.sourceMint);
  const destinationMint = new PublicKey(config.destinationMint);
  const sourceVault = new PublicKey(config.sourceVault);
  const destinationVault = new PublicKey(config.destinationVault);
  const platformFeeAccount = new PublicKey(config.platformFeeAccount);

  const testAddressOwner = new PublicKey(config.testAddress.owner);
  const testAddressSourceTokenAccount = new PublicKey(
    config.testAddress.sourceTokenAccount
  );
  const testAddressDestinationTokenAccount = new PublicKey(
    config.testAddress.destinationTokenAccount
  );

  const providerOwner = new PublicKey(config.provider.owner);
  const providerSourceTokenAccount = new PublicKey(
    config.provider.sourceTokenAccount
  );
  const providerDestinationTokenAccount = new PublicKey(
    config.provider.destinationTokenAccount
  );

  try {
    // Check programs
    console.log("📦 PROGRAMS\n");
    console.log(`Flipper Program:`);
    console.log(`  Address: ${flipperProgram.programId.toBase58()}`);
    const flipperAccount = await connection.getAccountInfo(
      flipperProgram.programId
    );
    console.log(
      `  Status: ${flipperAccount ? "✅ Deployed" : "❌ Not found"}\n`
    );

    console.log(`Mock Jupiter Program:`);
    console.log(`  Address: ${mockJupiterProgram.programId.toBase58()}`);
    const jupiterAccount = await connection.getAccountInfo(
      mockJupiterProgram.programId
    );
    console.log(
      `  Status: ${jupiterAccount ? "✅ Deployed" : "❌ Not found"}\n`
    );

    // Check PDAs
    console.log("🔑 PROGRAM DERIVED ADDRESSES (PDAs)\n");

    console.log(`Vault Authority:`);
    console.log(`  Address: ${vaultAuthority.toBase58()}`);
    const vaultAuthorityAccount = await connection.getAccountInfo(
      vaultAuthority
    );
    if (vaultAuthorityAccount) {
      console.log(`  Status: ✅ Initialized`);
      console.log(`  Owner: ${vaultAuthorityAccount.owner.toBase58()}`);
      console.log(`  Data size: ${vaultAuthorityAccount.data.length} bytes\n`);
    } else {
      console.log(`  Status: ❌ Not initialized\n`);
    }

    console.log(`Adapter Registry:`);
    console.log(`  Address: ${adapterRegistry.toBase58()}`);
    const adapterRegistryAccount = await connection.getAccountInfo(
      adapterRegistry
    );
    if (adapterRegistryAccount) {
      console.log(`  Status: ✅ Initialized`);
      console.log(`  Owner: ${adapterRegistryAccount.owner.toBase58()}`);
      console.log(`  Data size: ${adapterRegistryAccount.data.length} bytes\n`);
    } else {
      console.log(`  Status: ❌ Not initialized\n`);
    }

    // Check Mints
    console.log("🪙 TOKEN MINTS\n");

    console.log(`Source Mint:`);
    console.log(`  Address: ${sourceMint.toBase58()}`);
    const sourceMintAccount = await connection.getAccountInfo(sourceMint);
    console.log(
      `  Status: ${sourceMintAccount ? "✅ Created" : "❌ Not found"}\n`
    );

    console.log(`Destination Mint:`);
    console.log(`  Address: ${destinationMint.toBase58()}`);
    const destMintAccount = await connection.getAccountInfo(destinationMint);
    console.log(
      `  Status: ${destMintAccount ? "✅ Created" : "❌ Not found"}\n`
    );

    // Check Vaults
    console.log("🏦 TOKEN VAULTS\n");

    console.log(`Source Vault:`);
    console.log(`  Address: ${sourceVault.toBase58()}`);
    try {
      const sourceVaultAccount = await getAccount(connection, sourceVault);
      console.log(`  Status: ✅ Created`);
      console.log(
        `  Balance: ${formatTokenAmount(sourceVaultAccount.amount)} tokens`
      );
      console.log(`  Owner: ${sourceVaultAccount.owner.toBase58()}\n`);
    } catch (e) {
      console.log(`  Status: ❌ Not found\n`);
    }

    console.log(`Destination Vault:`);
    console.log(`  Address: ${destinationVault.toBase58()}`);
    try {
      const destVaultAccount = await getAccount(connection, destinationVault);
      console.log(`  Status: ✅ Created`);
      console.log(
        `  Balance: ${formatTokenAmount(destVaultAccount.amount)} tokens`
      );
      console.log(`  Owner: ${destVaultAccount.owner.toBase58()}\n`);
    } catch (e) {
      console.log(`  Status: ❌ Not found\n`);
    }

    // Platform Fee Account
    console.log("💰 PLATFORM FEE ACCOUNT\n");
    console.log(`  Address: ${platformFeeAccount.toBase58()}`);
    try {
      const feeAccount = await getAccount(connection, platformFeeAccount);
      console.log(`  Status: ✅ Created`);
      console.log(`  Balance: ${formatTokenAmount(feeAccount.amount)} tokens`);
      console.log(`  Owner: ${feeAccount.owner.toBase58()}\n`);
    } catch (e) {
      console.log(`  Status: ❌ Not found\n`);
    }

    // Test Address Accounts
    console.log("👤 TEST ADDRESS ACCOUNTS\n");
    console.log(`Owner: ${testAddressOwner.toBase58()}`);

    const testSOLBalance = await connection.getBalance(testAddressOwner);
    console.log(`SOL Balance: ${testSOLBalance / LAMPORTS_PER_SOL} SOL\n`);

    console.log(`Source Token Account:`);
    console.log(`  Address: ${testAddressSourceTokenAccount.toBase58()}`);
    try {
      const testSourceAccount = await getAccount(
        connection,
        testAddressSourceTokenAccount
      );
      console.log(`  Status: ✅ Created`);
      console.log(
        `  Balance: ${formatTokenAmount(testSourceAccount.amount)} tokens\n`
      );
    } catch (e) {
      console.log(`  Status: ❌ Not found\n`);
    }

    console.log(`Destination Token Account:`);
    console.log(`  Address: ${testAddressDestinationTokenAccount.toBase58()}`);
    try {
      const testDestAccount = await getAccount(
        connection,
        testAddressDestinationTokenAccount
      );
      console.log(`  Status: ✅ Created`);
      console.log(
        `  Balance: ${formatTokenAmount(testDestAccount.amount)} tokens\n`
      );
    } catch (e) {
      console.log(`  Status: ❌ Not found\n`);
    }

    // Provider Accounts
    console.log("👤 PROVIDER (WALLET) ACCOUNTS\n");
    console.log(`Owner: ${providerOwner.toBase58()}`);

    const providerSOLBalance = await connection.getBalance(providerOwner);
    console.log(`SOL Balance: ${providerSOLBalance / LAMPORTS_PER_SOL} SOL\n`);

    console.log(`Source Token Account:`);
    console.log(`  Address: ${providerSourceTokenAccount.toBase58()}`);
    try {
      const providerSourceAccount = await getAccount(
        connection,
        providerSourceTokenAccount
      );
      console.log(`  Status: ✅ Created`);
      console.log(
        `  Balance: ${formatTokenAmount(providerSourceAccount.amount)} tokens\n`
      );
    } catch (e) {
      console.log(`  Status: ❌ Not found\n`);
    }

    console.log(`Destination Token Account:`);
    console.log(`  Address: ${providerDestinationTokenAccount.toBase58()}`);
    try {
      const providerDestAccount = await getAccount(
        connection,
        providerDestinationTokenAccount
      );
      console.log(`  Status: ✅ Created`);
      console.log(
        `  Balance: ${formatTokenAmount(providerDestAccount.amount)} tokens\n`
      );
    } catch (e) {
      console.log(`  Status: ❌ Not found\n`);
    }

    console.log("═".repeat(60));
    console.log("✅ Account status check completed!");
    console.log("═".repeat(60));
    console.log("\n💡 Use this information to verify your test environment\n");
  } catch (error: any) {
    console.error("\n❌ Error checking account status:", error);
    throw error;
  }
}

// Main execution
(async () => {
  try {
    await checkAccountStatus();
  } catch (error: any) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
})();
