import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Keypair, PublicKey, Connection } from "@solana/web3.js";
import FLIPPER_IDL from "../../target/idl/flipper.json";
import MOCK_METEORA_IDL from "../../target/idl/mock_meteora.json";
import MOCK_WHIRLPOOLS_IDL from "../../target/idl/mock_whirlpools.json";
import fs from "fs";

// Function to load or generate a keypair for the wallet
const loadKeypair = (): Keypair => {
    const keypairPath = process.env.HOME + "/.config/solana/id.json";
    if (fs.existsSync(keypairPath)) {
        const secretKey = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
        return Keypair.fromSecretKey(Uint8Array.from(secretKey));
    }
    console.warn("Keypair file not found, generating a new one.");
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
const mockMeteoraProgram = new Program(MOCK_METEORA_IDL, provider);
const mockWhirlpoolsProgram = new Program(MOCK_WHIRLPOOLS_IDL, provider);

let adapterRegistry: PublicKey;
let adapterRegistryBump: number;

async function registerAdapters() {
    console.log("🚀 Registering Meteora and Whirlpool adapters on devnet...\n");

    // Derive adapter registry PDA
    [adapterRegistry, adapterRegistryBump] = PublicKey.findProgramAddressSync(
        [Buffer.from("adapter_registry")],
        flipperProgram.programId
    );

    console.log("📍 Adapter Registry:", adapterRegistry.toBase58(), "\n");

    // Get program IDs
    const meteoraProgramId = mockMeteoraProgram.programId;
    const whirlpoolProgramId = mockWhirlpoolsProgram.programId;

    console.log("📍 Program IDs:");
    console.log("   Meteora:", meteoraProgramId.toBase58());
    console.log("   Whirlpool:", whirlpoolProgramId.toBase58(), "\n");

    // Register Meteora adapter
    console.log("🔌 Registering Meteora adapter...");
    try {
        const meteoraTxSignature = await flipperProgram.methods
            .configureAdapter({
                name: "meteora",
                programId: meteoraProgramId,
                swapType: { meteora: {} }
            })
            .accounts({
                adapterRegistry,
                operator: wallet.publicKey
            })
            .signers([wallet.payer])
            .rpc();

        console.log("✅ Meteora adapter registered");
        console.log("   Transaction signature:", meteoraTxSignature, "\n");
    } catch (error) {
        console.error("❌ Failed to register Meteora adapter:", error);
        throw error;
    }

    // Register Whirlpool adapter with aToB: true
    console.log("🔌 Registering Whirlpool adapter (aToB: true)...");
    try {
        const whirlpoolTrueTxSignature = await flipperProgram.methods
            .configureAdapter({
                name: "whirlpool",
                programId: whirlpoolProgramId,
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
                programId: whirlpoolProgramId,
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

