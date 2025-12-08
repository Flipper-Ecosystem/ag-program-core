import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Keypair, PublicKey, Connection } from "@solana/web3.js";
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

async function addOperator() {
    console.log("🚀 Adding operator to adapter registry on mainnet...\n");

    // Get operator from environment variable
    const operatorPubkey = process.env.OPERATOR_PUBKEY;
    if (!operatorPubkey) {
        throw new Error("OPERATOR_PUBKEY environment variable is required. Set it to the operator's public key.");
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

    // Check if adapter registry exists
    try {
        const registryAccount = await (flipperProgram.account as any).adapterRegistry.fetch(adapterRegistry);
        console.log("📋 Current registry state:");
        console.log("   Authority:", registryAccount.authority.toBase58());
        console.log("   Current operators:", registryAccount.operators.map((op: PublicKey) => op.toBase58()));
        console.log("   Supported adapters:", registryAccount.supportedAdapters.length, "\n");

        // Check if operator already exists
        if (registryAccount.operators.some((op: PublicKey) => op.equals(operator))) {
            console.log("⚠️  Operator already exists in registry!\n");
            return;
        }
    } catch (error: any) {
        if (error.message.includes("Account does not exist")) {
            throw new Error("Adapter registry does not exist. Please run initialize_adapter_registry.ts first.");
        }
        throw error;
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
        console.log("   Transaction signature:", txSignature, "\n");
    } catch (error) {
        console.error("❌ Failed to add operator:", error);
        throw error;
    }

    // Verify addition
    try {
        const registryAccount = await (flipperProgram.account as any).adapterRegistry.fetch(adapterRegistry);
        console.log("✅ Verification:");
        console.log("   Operators:", registryAccount.operators.map((op: PublicKey) => op.toBase58()), "\n");
    } catch (error) {
        console.error("❌ Failed to verify operator addition:", error);
        throw error;
    }

    console.log("🎉 Operator management completed!\n");
}

async function removeOperator() {
    console.log("🚀 Removing operator from adapter registry on mainnet...\n");

    // Get operator from environment variable
    const operatorPubkey = process.env.OPERATOR_PUBKEY;
    if (!operatorPubkey) {
        throw new Error("OPERATOR_PUBKEY environment variable is required. Set it to the operator's public key.");
    }
    const operator = new PublicKey(operatorPubkey);

    console.log("📍 Configuration:");
    console.log("   Authority:", wallet.publicKey.toBase58());
    console.log("   Operator to remove:", operator.toBase58(), "\n");

    // Derive adapter registry PDA
    [adapterRegistry, adapterRegistryBump] = PublicKey.findProgramAddressSync(
        [Buffer.from("adapter_registry")],
        flipperProgram.programId
    );

    console.log("📍 Adapter Registry PDA:", adapterRegistry.toBase58(), "\n");

    // Check if adapter registry exists
    try {
        const registryAccount = await (flipperProgram.account as any).adapterRegistry.fetch(adapterRegistry);
        console.log("📋 Current registry state:");
        console.log("   Authority:", registryAccount.authority.toBase58());
        console.log("   Current operators:", registryAccount.operators.map((op: PublicKey) => op.toBase58()));
        console.log("   Supported adapters:", registryAccount.supportedAdapters.length, "\n");

        // Check if operator exists
        if (!registryAccount.operators.some((op: PublicKey) => op.equals(operator))) {
            console.log("⚠️  Operator does not exist in registry!\n");
            return;
        }
    } catch (error: any) {
        if (error.message.includes("Account does not exist")) {
            throw new Error("Adapter registry does not exist. Please run initialize_adapter_registry.ts first.");
        }
        throw error;
    }

    // Remove operator
    console.log("⚙️  Removing operator...");
    try {
        const txSignature = await flipperProgram.methods
            .removeOperator(operator)
            .accounts({
                adapterRegistry,
                authority: wallet.publicKey,
            })
            .signers([wallet.payer])
            .rpc();

        console.log("✅ Operator removed successfully!");
        console.log("   Transaction signature:", txSignature, "\n");
    } catch (error) {
        console.error("❌ Failed to remove operator:", error);
        throw error;
    }

    // Verify removal
    try {
        const registryAccount = await (flipperProgram.account as any).adapterRegistry.fetch(adapterRegistry);
        console.log("✅ Verification:");
        console.log("   Operators:", registryAccount.operators.map((op: PublicKey) => op.toBase58()), "\n");
    } catch (error) {
        console.error("❌ Failed to verify operator removal:", error);
        throw error;
    }

    console.log("🎉 Operator management completed!\n");
}

// Main execution
(async () => {
    try {
        const action = process.env.ACTION || process.argv[2];
        
        if (!action || (action !== "add" && action !== "remove")) {
            console.error("❌ Invalid action. Use 'add' or 'remove'.");
            console.log("\nUsage:");
            console.log("  ACTION=add OPERATOR_PUBKEY=<pubkey> ts-node manage_operator.ts");
            console.log("  ACTION=remove OPERATOR_PUBKEY=<pubkey> ts-node manage_operator.ts");
            console.log("\nOr:");
            console.log("  ts-node manage_operator.ts add <operator_pubkey>");
            console.log("  ts-node manage_operator.ts remove <operator_pubkey>");
            process.exit(1);
        }

        // Get operator from command line argument if not in env
        if (!process.env.OPERATOR_PUBKEY && process.argv[3]) {
            process.env.OPERATOR_PUBKEY = process.argv[3];
        }

        if (action === "add") {
            await addOperator();
        } else if (action === "remove") {
            await removeOperator();
        }
    } catch (error) {
        console.error("Fatal error:", error);
        process.exit(1);
    }
})();

