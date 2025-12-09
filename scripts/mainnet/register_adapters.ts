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
    console.warn("Keypair file not found, generating a new one for localnet.");
    return Keypair.generate();
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

// Mainnet program IDs
// Raydium CPMM (Constant Product Market Maker)
const RAYDIUM_CPMM_PROGRAM_ID = new PublicKey(
    process.env.RAYDIUM_CPMM_PROGRAM_ID || "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"
);

// Meteora DLMM (Dynamic Liquidity Market Maker)
const METEORA_DLMM_PROGRAM_ID = new PublicKey(
    process.env.METEORA_DLMM_PROGRAM_ID || "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo"
);

// Whirlpool (Orca)
const WHIRLPOOL_PROGRAM_ID = new PublicKey(
    process.env.WHIRLPOOL_PROGRAM_ID || "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"
);

let adapterRegistry: PublicKey;
let adapterRegistryBump: number;

async function registerAdapters() {
    console.log("🚀 Registering adapters on mainnet...\n");

    // Derive adapter registry PDA
    [adapterRegistry, adapterRegistryBump] = PublicKey.findProgramAddressSync(
        [Buffer.from("adapter_registry")],
        flipperProgram.programId
    );

    console.log("📍 Configuration:");
    console.log("   Adapter Registry:", adapterRegistry.toBase58());
    console.log("   Operator:", wallet.publicKey.toBase58());
    console.log("\n📍 Program IDs:");
    console.log("   Raydium CPMM:", RAYDIUM_CPMM_PROGRAM_ID.toBase58());
    console.log("   Meteora DLMM:", METEORA_DLMM_PROGRAM_ID.toBase58());
    console.log("   Whirlpool:", WHIRLPOOL_PROGRAM_ID.toBase58(), "\n");

    // Check if adapter registry exists
    try {
        const registryAccount = await (flipperProgram.account as any).adapterRegistry.fetch(adapterRegistry);
        console.log("📋 Current registry state:");
        console.log("   Authority:", registryAccount.authority.toBase58());
        console.log("   Operators:", registryAccount.operators.map((op: PublicKey) => op.toBase58()));
        console.log("   Supported adapters:", registryAccount.supportedAdapters.length, "\n");
    } catch (error: any) {
        if (error.message.includes("Account does not exist")) {
            throw new Error("Adapter registry does not exist. Please run initialize_adapter_registry.ts first.");
        }
        throw error;
    }

    // Register Raydium CPMM adapter
    console.log("🔌 Registering Raydium CPMM adapter...");
    try {
        const raydiumTxSignature = await flipperProgram.methods
            .configureAdapter({
                name: "raydium",
                programId: RAYDIUM_CPMM_PROGRAM_ID,
                swapType: { raydium: {} }
            })
            .accounts({
                adapterRegistry,
                operator: wallet.publicKey
            })
            .signers([wallet.payer])
            .rpc();

        console.log("✅ Raydium CPMM adapter registered");
        console.log("   Transaction signature:", raydiumTxSignature, "\n");
    } catch (error) {
        console.error("❌ Failed to register Raydium CPMM adapter:", error);
        throw error;
    }

    // Register Meteora DLMM adapter
    console.log("🔌 Registering Meteora DLMM adapter...");
    try {
        const meteoraTxSignature = await flipperProgram.methods
            .configureAdapter({
                name: "meteora",
                programId: METEORA_DLMM_PROGRAM_ID,
                swapType: { meteora: {} }
            })
            .accounts({
                adapterRegistry,
                operator: wallet.publicKey
            })
            .signers([wallet.payer])
            .rpc();

        console.log("✅ Meteora DLMM adapter registered");
        console.log("   Transaction signature:", meteoraTxSignature, "\n");
    } catch (error) {
        console.error("❌ Failed to register Meteora DLMM adapter:", error);
        throw error;
    }

    // Register Whirlpool adapter with aToB: true
    console.log("🔌 Registering Whirlpool adapter (aToB: true)...");
    try {
        const whirlpoolTrueTxSignature = await flipperProgram.methods
            .configureAdapter({
                name: "whirlpool",
                programId: WHIRLPOOL_PROGRAM_ID,
                swapType: { whirlpool: { aToB: true } }
            })
            .accounts({
                adapterRegistry,
                operator: wallet.publicKey
            })
            .signers([wallet.payer])
            .rpc();

        console.log("✅ Whirlpool adapter registered (aToB: true)");
        console.log("   Transaction signature:", whirlpoolTrueTxSignature, "\n");
    } catch (error) {
        console.error("❌ Failed to register Whirlpool adapter (aToB: true):", error);
        throw error;
    }

    // Register Whirlpool adapter with aToB: false
    console.log("🔌 Registering Whirlpool adapter (aToB: false)...");
    try {
        const whirlpoolFalseTxSignature = await flipperProgram.methods
            .configureAdapter({
                name: "whirlpool",
                programId: WHIRLPOOL_PROGRAM_ID,
                swapType: { whirlpool: { aToB: false } }
            })
            .accounts({
                adapterRegistry,
                operator: wallet.publicKey
            })
            .signers([wallet.payer])
            .rpc();

        console.log("✅ Whirlpool adapter registered (aToB: false)");
        console.log("   Transaction signature:", whirlpoolFalseTxSignature, "\n");
    } catch (error) {
        console.error("❌ Failed to register Whirlpool adapter (aToB: false):", error);
        throw error;
    }

    // Verify final state
    try {
        const registryAccount = await (flipperProgram.account as any).adapterRegistry.fetch(adapterRegistry);
        console.log("✅ Final registry state:");
        console.log("   Supported adapters:", registryAccount.supportedAdapters.length);
        registryAccount.supportedAdapters.forEach((adapter: any) => {
            console.log(`   - ${JSON.stringify(adapter.swapType)}: ${adapter.programId.toBase58()}`);
        });
        console.log();
    } catch (error) {
        console.error("❌ Failed to verify final state:", error);
        throw error;
    }

    console.log("🎉 All adapters registered successfully!\n");
}

// Main execution
(async () => {
    try {
        await registerAdapters();
    } catch (error) {
        console.error("Fatal error:", error);
        process.exit(1);
    }
})();

