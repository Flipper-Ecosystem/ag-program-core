import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Keypair, PublicKey, Connection, SystemProgram } from "@solana/web3.js";
import FLIPPER_IDL from "../../target/idl/flipper.json";
import fs from "fs";

// Function to load keypair for mainnet wallet
const loadKeypair = (): Keypair => {
    // Use the wallet path from Anchor.toml or default to staging wallet
    const keypairPath = process.env.WALLET_PATH || process.env.HOME + "/.config/solana/flpp-staging.json";
    if (fs.existsSync(keypairPath)) {
        const secretKey = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
        return Keypair.fromSecretKey(Uint8Array.from(secretKey));
    }
    throw new Error(`Keypair file not found at ${keypairPath}. Please set WALLET_PATH environment variable or place wallet at default location.`);
};

// Configure connection to Solana Mainnet
const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

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

async function initializeAdapterRegistry() {
    console.log("🚀 Initializing adapter registry on mainnet...\n");

    // Get operator from environment variable or use wallet as default
    const operatorPubkey = process.env.OPERATOR_PUBKEY;
    if (!operatorPubkey) {
        throw new Error("OPERATOR_PUBKEY environment variable is required. Set it to the operator's public key.");
    }
    const operator = new PublicKey(operatorPubkey);

    console.log("📍 Configuration:");
    console.log("   Authority:", wallet.publicKey.toBase58());
    console.log("   Operator:", operator.toBase58(), "\n");

    // Derive adapter registry PDA
    [adapterRegistry, adapterRegistryBump] = PublicKey.findProgramAddressSync(
        [Buffer.from("adapter_registry")],
        flipperProgram.programId
    );

    console.log("📍 Adapter Registry PDA:", adapterRegistry.toBase58(), "\n");

    // Check if adapter registry already exists
    try {
        const registryAccount = await (flipperProgram.account as any).adapterRegistry.fetch(adapterRegistry);
        console.log("⚠️  Adapter registry already exists!");
        console.log("   Current authority:", registryAccount.authority.toBase58());
        console.log("   Current operators:", registryAccount.operators.map((op: PublicKey) => op.toBase58()));
        console.log("\n   Use manage_operator.ts to add/remove operators instead.\n");
        return;
    } catch (error: any) {
        if (!error.message.includes("Account does not exist")) {
            throw error;
        }
        // Account doesn't exist, proceed with initialization
    }

    // Initialize adapter registry with empty adapters and operator
    console.log("⚙️  Initializing adapter registry...");
    try {
        const txSignature = await flipperProgram.methods
            .initializeAdapterRegistry([], [operator])
            .accounts({
                adapterRegistry,
                payer: wallet.publicKey,
                authority: wallet.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([wallet.payer])
            .rpc();

        console.log("✅ Adapter registry initialized successfully!");
        console.log("   Transaction signature:", txSignature);
        console.log("   Authority:", wallet.publicKey.toBase58());
        console.log("   Operator:", operator.toBase58(), "\n");
    } catch (error) {
        console.error("❌ Failed to initialize adapter registry:", error);
        throw error;
    }

    // Verify initialization
    try {
        const registryAccount = await (flipperProgram.account as any).adapterRegistry.fetch(adapterRegistry);
        console.log("✅ Verification:");
        console.log("   Authority:", registryAccount.authority.toBase58());
        console.log("   Operators:", registryAccount.operators.map((op: PublicKey) => op.toBase58()));
        console.log("   Supported adapters:", registryAccount.supportedAdapters.length, "\n");
    } catch (error) {
        console.error("❌ Failed to verify adapter registry:", error);
        throw error;
    }

    console.log("🎉 Adapter registry initialization completed!\n");
}

// Main execution
(async () => {
    try {
        await initializeAdapterRegistry();
    } catch (error) {
        console.error("Fatal error:", error);
        process.exit(1);
    }
})();

