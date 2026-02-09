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
import MOCK_JUPITER_IDL from "../../target/idl/mock_jupiter.json";
import * as dotenv from "dotenv";
import fs from "fs";

// Load environment variables
dotenv.config();

// Function to load or generate a keypair for the wallet
const loadKeypair = (): Keypair => {
  // Use id.json since vault authority was created with it
  const defaultPath = process.env.HOME + "/.config/solana/id.json";

  if (fs.existsSync(defaultPath)) {
    console.log("📝 Using id.json keypair (vault authority admin)");
    const secretKey = JSON.parse(fs.readFileSync(defaultPath, "utf8"));
    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
  }

  throw new Error("id.json keypair not found at: " + defaultPath);
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
const mockJupiterProgram = new Program(MOCK_JUPITER_IDL, provider);

// Test address from environment variable
const TEST_ADDRESS = new PublicKey(
  process.env.TEST_ADDRESS || "CqN8BpNFhFZDnbLdpUaLUEHGrFymnP8TBcCfQhC8pFYA"
);

// Shared variables
let admin: Keypair;
let operator: Keypair;
let vaultAuthority: PublicKey;
let adapterRegistry: PublicKey;
let sourceMint: PublicKey;
let destinationMint: PublicKey;
let sourceVault: PublicKey;
let destinationVault: PublicKey;
let platformFeeAccount: PublicKey;

// Token accounts for test address
let testAddressSourceTokenAccount: PublicKey;
let testAddressDestinationTokenAccount: PublicKey;

// Token accounts for wallet.provider
let providerSourceTokenAccount: PublicKey;
let providerDestinationTokenAccount: PublicKey;

// Wait for transaction confirmation
async function waitForConfirmation(ms: number = 2000) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function setupEnvironment() {
  try {
    console.log("🚀 Starting Shared Jupiter Environment Setup on Devnet...\n");

    admin = wallet.payer;
    operator = Keypair.generate();

    console.log("📍 Addresses:");
    console.log("   Admin/Provider:", admin.publicKey.toBase58());
    console.log("   Test Address:", TEST_ADDRESS.toBase58());
    console.log("   Operator:", operator.publicKey.toBase58());
    console.log("   Flipper Program:", flipperProgram.programId.toBase58());
    console.log(
      "   Mock Jupiter Program:",
      mockJupiterProgram.programId.toBase58(),
      "\n"
    );

    // Check admin balance
    const adminBalance = await connection.getBalance(admin.publicKey);
    console.log("💰 Admin balance:", adminBalance / 1e9, "SOL");

    if (adminBalance < 3_000_000_000) {
      console.error("❌ Insufficient admin balance. Need at least 3 SOL");
      console.log("   Run: solana airdrop 5 --url devnet");
      process.exit(1);
    }

    // Fund operator
    console.log("\n💸 Funding operator account...");
    const transferToOperatorTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: operator.publicKey,
        lamports: 1_000_000_000, // 1 SOL
      })
    );
    await provider.sendAndConfirm(transferToOperatorTx, [wallet.payer]);
    console.log("✅ Transferred 1 SOL to operator");
    await waitForConfirmation(2000);

    // Derive PDAs
    [vaultAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_authority")],
      flipperProgram.programId
    );

    [adapterRegistry] = PublicKey.findProgramAddressSync(
      [Buffer.from("adapter_registry")],
      flipperProgram.programId
    );

    console.log("\n🔑 PDAs:");
    console.log("   Vault Authority:", vaultAuthority.toBase58());
    console.log("   Adapter Registry:", adapterRegistry.toBase58(), "\n");

    // Check and create vault authority if needed
    console.log("🔧 Setting up vault authority...");
    const vaultAuthorityInfo = await connection.getAccountInfo(vaultAuthority);
    if (!vaultAuthorityInfo) {
      await flipperProgram.methods
        .createVaultAuthority()
        .accounts({
          vaultAuthority,
          payer: wallet.publicKey,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([wallet.payer])
        .rpc();
      console.log("✅ Created vault authority");
      await waitForConfirmation(3000);
    } else {
      console.log("✅ Vault authority already exists");
    }

    // Check and create adapter registry if needed
    console.log("⚙️ Setting up adapter registry...");
    const registryInfo = await connection.getAccountInfo(adapterRegistry);
    if (!registryInfo) {
      await flipperProgram.methods
        .initializeAdapterRegistry([], [operator.publicKey])
        .accounts({
          adapterRegistry,
          authority: admin.publicKey,
          payer: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([wallet.payer])
        .rpc();
      console.log("✅ Initialized adapter registry with operator");
      await waitForConfirmation(3000);
    } else {
      console.log("✅ Adapter registry already exists");
    }

    // Create mints
    console.log("\n🪙 Creating token mints...");
    sourceMint = await createMint(
      connection,
      wallet.payer,
      wallet.publicKey, // Use wallet.publicKey as mint authority
      null,
      6, // 6 decimals like in test
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );
    console.log("   Source Mint:", sourceMint.toBase58());
    await waitForConfirmation(3000);

    destinationMint = await createMint(
      connection,
      wallet.payer,
      wallet.publicKey, // Use wallet.publicKey as mint authority
      null,
      6, // 6 decimals like in test
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );
    console.log("   Destination Mint:", destinationMint.toBase58(), "\n");
    await waitForConfirmation(3000);

    // Derive vault addresses
    [sourceVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), sourceMint.toBuffer()],
      flipperProgram.programId
    );

    [destinationVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), destinationMint.toBuffer()],
      flipperProgram.programId
    );

    console.log("🏦 Vault addresses:");
    console.log("   Source Vault:", sourceVault.toBase58());
    console.log("   Destination Vault:", destinationVault.toBase58(), "\n");

    // Create or check vaults
    console.log("🏦 Setting up token vaults...");

    // Check if source vault exists
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
            admin: admin.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([wallet.payer])
          .rpc();
        console.log("   ✅ Created source vault");
        await waitForConfirmation(3000);
      } catch (e: any) {
        console.log("   ⚠️ Source vault creation error:", e.message);
        console.log("   Continuing anyway...");
      }
    } else {
      console.log("   ✅ Source vault already exists");
    }

    // Check if destination vault exists
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
            admin: admin.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([wallet.payer])
          .rpc();
        console.log("   ✅ Created destination vault");
        await waitForConfirmation(3000);
      } catch (e: any) {
        console.log("   ⚠️ Destination vault creation error:", e.message);
        console.log("   Continuing anyway...");
      }
    } else {
      console.log("   ✅ Destination vault already exists");
    }

    // Create platform fee account
    console.log("\n💰 Setting up platform fee account...");
    const platformFeeAccountInfo = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      destinationMint,
      vaultAuthority,
      true // allowOwnerOffCurve for PDA
    );
    platformFeeAccount = platformFeeAccountInfo.address;
    console.log("✅ Platform fee account ready");
    console.log("   Platform Fee Account:", platformFeeAccount.toBase58());
    await waitForConfirmation(2000);

    // Create token accounts for TEST_ADDRESS
    console.log(
      "\n👤 Creating token accounts for test address:",
      TEST_ADDRESS.toBase58()
    );
    const testAddressSourceAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      sourceMint,
      TEST_ADDRESS
    );
    testAddressSourceTokenAccount = testAddressSourceAccount.address;
    console.log(
      "   ✅ Source token account:",
      testAddressSourceTokenAccount.toBase58()
    );
    await waitForConfirmation(2000);

    const testAddressDestAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      destinationMint,
      TEST_ADDRESS
    );
    testAddressDestinationTokenAccount = testAddressDestAccount.address;
    console.log(
      "   ✅ Destination token account:",
      testAddressDestinationTokenAccount.toBase58()
    );
    await waitForConfirmation(2000);

    // Create token accounts for provider (wallet)
    console.log(
      "\n👤 Creating token accounts for provider:",
      wallet.publicKey.toBase58()
    );
    const providerSourceAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      sourceMint,
      wallet.publicKey
    );
    providerSourceTokenAccount = providerSourceAccount.address;
    console.log(
      "   ✅ Source token account:",
      providerSourceTokenAccount.toBase58()
    );
    await waitForConfirmation(2000);

    const providerDestAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      destinationMint,
      wallet.publicKey
    );
    providerDestinationTokenAccount = providerDestAccount.address;
    console.log(
      "   ✅ Destination token account:",
      providerDestinationTokenAccount.toBase58()
    );
    await waitForConfirmation(2000);

    // Mint tokens
    console.log("\n🎁 Minting tokens...");

    // Mint to test address
    console.log("   Minting to test address...");
    await mintTo(
      connection,
      wallet.payer,
      sourceMint,
      testAddressSourceTokenAccount,
      wallet.payer, // Use wallet.payer as mint authority
      1_000_000_000, // 1000 tokens (6 decimals)
      [],
      undefined,
      TOKEN_PROGRAM_ID
    );
    console.log("   ✅ Minted 1000 source tokens to test address");
    await waitForConfirmation(2000);

    // Mint to provider
    console.log("   Minting to provider...");
    await mintTo(
      connection,
      wallet.payer,
      sourceMint,
      providerSourceTokenAccount,
      wallet.payer, // Use wallet.payer as mint authority
      1_000_000_000, // 1000 tokens
      [],
      undefined,
      TOKEN_PROGRAM_ID
    );
    console.log("   ✅ Minted 1000 source tokens to provider");
    await waitForConfirmation(2000);

    // Mint to destination vault for Jupiter mock swaps
    console.log("   Minting to destination vault for Jupiter mock...");
    try {
      await mintTo(
        connection,
        wallet.payer,
        destinationMint,
        destinationVault,
        wallet.payer, // Use wallet.payer as mint authority
        10_000_000_000, // 10,000 tokens for testing
        [],
        undefined,
        TOKEN_PROGRAM_ID
      );
      console.log("   ✅ Minted 10,000 destination tokens to vault");
      await waitForConfirmation(2000);
    } catch (e: any) {
      console.log("   ⚠️ Could not mint to destination vault:", e.message);
      console.log("   This may be because:");
      console.log("      - Vault was created with different mint");
      console.log("      - You don't have mint authority");
      console.log(
        "   Continuing anyway - tests may need existing vault balance"
      );
    }

    // Check final balances
    console.log("\n💰 Final balances:");
    try {
      const testSourceBal = await getAccount(
        connection,
        testAddressSourceTokenAccount
      );
      console.log("   Test address source:", testSourceBal.amount.toString());
    } catch (e) {
      console.log("   Test address source: ERROR");
    }

    try {
      const providerSourceBal = await getAccount(
        connection,
        providerSourceTokenAccount
      );
      console.log("   Provider source:", providerSourceBal.amount.toString());
    } catch (e) {
      console.log("   Provider source: ERROR");
    }

    try {
      const destVaultBal = await getAccount(connection, destinationVault);
      console.log("   Destination vault:", destVaultBal.amount.toString());
    } catch (e) {
      console.log("   Destination vault: ERROR");
    }

    // Print summary
    console.log("\n" + "=".repeat(60));
    console.log("✅ SETUP COMPLETED!");
    console.log("=".repeat(60));
    console.log("\n📋 Summary:");
    console.log("   Flipper Program:", flipperProgram.programId.toBase58());
    console.log(
      "   Mock Jupiter Program:",
      mockJupiterProgram.programId.toBase58()
    );
    console.log("   Vault Authority:", vaultAuthority.toBase58());
    console.log("   Adapter Registry:", adapterRegistry.toBase58());
    console.log("   Source Mint:", sourceMint.toBase58());
    console.log("   Destination Mint:", destinationMint.toBase58());
    console.log("   Source Vault:", sourceVault.toBase58());
    console.log("   Destination Vault:", destinationVault.toBase58());
    console.log("\n👤 Test Address Accounts:");
    console.log("   Owner:", TEST_ADDRESS.toBase58());
    console.log(
      "   Source Token Account:",
      testAddressSourceTokenAccount.toBase58()
    );
    console.log(
      "   Destination Token Account:",
      testAddressDestinationTokenAccount.toBase58()
    );
    console.log("\n👤 Provider Accounts:");
    console.log("   Owner:", wallet.publicKey.toBase58());
    console.log(
      "   Source Token Account:",
      providerSourceTokenAccount.toBase58()
    );
    console.log(
      "   Destination Token Account:",
      providerDestinationTokenAccount.toBase58()
    );
    console.log("\n💡 Next Steps:");
    console.log("   1. Run test script: npm run devnet:test-route");
    console.log("   2. Run limit order test: npm run devnet:test-limit-orders");
    console.log("   3. Or verify all: npm run devnet:verify");
    console.log("\n");

    // Save configuration to file
    const config = {
      flipperProgramId: flipperProgram.programId.toBase58(),
      mockJupiterProgramId: mockJupiterProgram.programId.toBase58(),
      vaultAuthority: vaultAuthority.toBase58(),
      adapterRegistry: adapterRegistry.toBase58(),
      sourceMint: sourceMint.toBase58(),
      destinationMint: destinationMint.toBase58(),
      sourceVault: sourceVault.toBase58(),
      destinationVault: destinationVault.toBase58(),
      platformFeeAccount: platformFeeAccount.toBase58(),
      testAddress: {
        owner: TEST_ADDRESS.toBase58(),
        sourceTokenAccount: testAddressSourceTokenAccount.toBase58(),
        destinationTokenAccount: testAddressDestinationTokenAccount.toBase58(),
      },
      provider: {
        owner: wallet.publicKey.toBase58(),
        sourceTokenAccount: providerSourceTokenAccount.toBase58(),
        destinationTokenAccount: providerDestinationTokenAccount.toBase58(),
      },
    };

    fs.writeFileSync(
      "./scripts/devnet/jupiter_test_config.json",
      JSON.stringify(config, null, 2)
    );
    console.log(
      "💾 Configuration saved to: scripts/devnet/jupiter_test_config.json\n"
    );
  } catch (error: any) {
    console.error("\n❌ Error during setup:", error);
    throw error;
  }
}

// Main execution
(async () => {
  try {
    await setupEnvironment();
  } catch (error: any) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
})();
