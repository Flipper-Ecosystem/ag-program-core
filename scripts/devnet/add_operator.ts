import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, Connection, SystemProgram, Transaction } from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createMint,
    mintTo,
    getAssociatedTokenAddressSync,
    createAssociatedTokenAccount,
    getAccount,
    getOrCreateAssociatedTokenAccount
} from "@solana/spl-token";
import FLIPPER_IDL from "../../target/idl/flipper.json";
import MOCK_RAYDIUM_IDL from "../../target/idl/mock_raydium.json";
import fs from "fs";

// Function to load or generate a keypair for the wallet
const loadKeypair = (): Keypair => {
    const keypairPath = process.env.HOME + "/.config/solana/id.json";
    if (fs.existsSync(keypairPath)) {
        const secretKey = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
        return Keypair.fromSecretKey(Uint8Array.from(secretKey));
    }
    console.warn("Keypair file not found, generating a new one for localnet.");
    return Keypair.generate();
};

// Configure connection to Solana Localnet
const connection = new Connection("https://api.devnet.solana.com", "confirmed");

// Create wallet and provider for Anchor
// Create wallet and provider for Anchor
const wallet = new anchor.Wallet(loadKeypair());
const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
});
anchor.setProvider(provider);

// Load programs
const flipperProgram = new Program(FLIPPER_IDL, provider);

let operator: PublicKey;
let adapterRegistry: PublicKey;
let adapterRegistryBump: number;

async function addOperator() {
    console.log("🚀 Add operator on devnet...\n");
    operator = new PublicKey("8cJXGoV8FCwNqbcjstCiAxdW3miy2xsBvuXSn3s64GrG");

    [adapterRegistry, adapterRegistryBump] = PublicKey.findProgramAddressSync(
        [Buffer.from("adapter_registry")],
        flipperProgram.programId
    );

    const txSignature  = await flipperProgram.methods.addOperator(operator).
    accounts({
        adapterRegistry,
        authority:wallet.publicKey,
    }).signers([wallet.payer]).rpc()

    console.log("✅ Transaction signature:", txSignature, "\n");
}

// Main execution
(async () => {
    try {
        await addOperator();
    } catch (error) {
        console.error("Fatal error:", error);
        process.exit(1);
    }
})();