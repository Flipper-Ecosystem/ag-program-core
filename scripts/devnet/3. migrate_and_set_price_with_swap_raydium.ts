import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, Connection, SystemProgram } from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createMint,
    mintTo,
    getAssociatedTokenAddressSync,
    createAssociatedTokenAccount,
} from "@solana/spl-token";
import MOCK_RAYDIUM_IDL from "../../target/idl/mock_raydium.json";
import fs from "fs";

// Load or generate keypair
const loadKeypair = (): Keypair => {
    const keypairPath = process.env.HOME + "/.config/solana/id.json";
    if (fs.existsSync(keypairPath)) {
        const secretKey = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
        return Keypair.fromSecretKey(Uint8Array.from(secretKey));
    }
    console.warn("Keypair file not found, generating a new one for localnet.");
    return Keypair.generate();
};

// Configure connection to Solana Devnet
const connection = new Connection("https://api.devnet.solana.com", "confirmed");

// Create wallet and provider
const wallet = new anchor.Wallet(loadKeypair());
const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
});
anchor.setProvider(provider);

// Load mock Raydium program
const mockRaydiumProgram = new Program(MOCK_RAYDIUM_IDL as any, provider);

// Shared variables
let admin: Keypair;
let tokenAMint: PublicKey;
let tokenBMint: PublicKey;
let poolState: PublicKey;
let poolAuthority: PublicKey;
let tokenAVault: PublicKey;
let tokenBVault: PublicKey;

// Wait for confirmation
async function waitForConfirmation(ms: number = 2000) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function createRaydiumPoolWithCustomPrice() {
    try {
        console.log("🚀 Starting Raydium Pool Creation with Custom Price...\n");

        admin = wallet.payer;
        console.log("📍 Admin address:", admin.publicKey.toBase58());

        // Check admin balance
        const adminBalance = await connection.getBalance(admin.publicKey);
        console.log("💰 Admin balance:", adminBalance / 1e9, "SOL");

        if (adminBalance < 3_000_000_000) {
            console.error("❌ Insufficient admin balance. Need at least 3 SOL");
            console.log("   Run: solana airdrop 5 --url devnet");
            process.exit(1);
        }

        // Create token mints
        console.log("🪙 Creating token mints...");
        tokenAMint = await createMint(
            connection,
            wallet.payer,
            wallet.publicKey,
            null,
            9,
            undefined,
            undefined,
            TOKEN_PROGRAM_ID
        );
        await waitForConfirmation(3000);

        tokenBMint = await createMint(
            connection,
            wallet.payer,
            wallet.publicKey,
            null,
            9,
            undefined,
            undefined,
            TOKEN_PROGRAM_ID
        );
        await waitForConfirmation(3000);

        console.log("   Token A Mint:", tokenAMint.toBase58());
        console.log("   Token B Mint:", tokenBMint.toBase58(), "\n");

        // Derive pool addresses (tokens must be sorted)
        const [sortedTokenAMint, sortedTokenBMint] = tokenAMint.toString() < tokenBMint.toString()
            ? [tokenAMint, tokenBMint]
            : [tokenBMint, tokenAMint];

        [poolState] = PublicKey.findProgramAddressSync(
            [Buffer.from("pool_state"), sortedTokenAMint.toBuffer(), sortedTokenBMint.toBuffer()],
            mockRaydiumProgram.programId
        );
        [poolAuthority] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault_and_lp_mint_auth_seed")],
            mockRaydiumProgram.programId
        );

        console.log("🔑 Pool Authority (PDA):", poolAuthority.toBase58());

        // Get vault addresses using sorted tokens
        tokenAVault = getAssociatedTokenAddressSync(
            sortedTokenAMint,
            poolAuthority,
            true,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        await waitForConfirmation(3000);

        tokenBVault = getAssociatedTokenAddressSync(
            sortedTokenBMint,
            poolAuthority,
            true,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        await waitForConfirmation(3000);

        console.log("🏦 Token vaults:");
        console.log("   Token A Vault:", tokenAVault.toBase58());
        console.log("   Token B Vault:", tokenBVault.toBase58(), "\n");

        // Create user token accounts
        console.log("👤 Creating user token accounts...");
        const userTokenAAccount = await createAssociatedTokenAccount(
            connection,
            wallet.payer,
            sortedTokenAMint,
            wallet.publicKey,
            undefined,
            TOKEN_PROGRAM_ID,
            undefined
        );
        await waitForConfirmation(3000);

        const userTokenBAccount = await createAssociatedTokenAccount(
            connection,
            wallet.payer,
            sortedTokenBMint,
            wallet.publicKey,
            undefined,
            TOKEN_PROGRAM_ID,
            undefined
        );
        await waitForConfirmation(3000);
        console.log("✅ User token accounts created\n");

        // Mint tokens to user accounts
        console.log("🎁 Minting tokens...");
        await mintTo(
            connection,
            wallet.payer,
            sortedTokenAMint,
            userTokenAAccount,
            wallet.publicKey,
            1_000_000_000_000,
            [],
            undefined,
            TOKEN_PROGRAM_ID
        );
        await waitForConfirmation(3000);

        await mintTo(
            connection,
            wallet.payer,
            sortedTokenBMint,
            userTokenBAccount,
            wallet.publicKey,
            1_000_000_000_000,
            [],
            undefined,
            TOKEN_PROGRAM_ID
        );
        await waitForConfirmation(3000);
        console.log("✅ Tokens minted\n");

        // Initialize Raydium pool
        console.log("🏊 Initializing Raydium pool...");
        const tx = await mockRaydiumProgram.methods
            .initializePool(new BN(1_000_000_000), new BN(1_000_000_000))
            .accounts({
                user: wallet.publicKey,
                poolState: poolState,
                authority: poolAuthority,
                userTokenA: userTokenAAccount,
                userTokenB: userTokenBAccount,
                tokenAVault: tokenAVault,
                tokenBVault: tokenBVault,
                tokenAMint: sortedTokenAMint,
                tokenBMint: sortedTokenBMint,
                tokenAProgram: TOKEN_PROGRAM_ID,
                tokenBProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .signers([wallet.payer])
            .rpc();
        console.log("   Transaction:", tx);
        await waitForConfirmation(3000);
        console.log("✅ Raydium pool initialized\n");

        // Set custom price (2 Token B per 1 Token A)
        const customPrice = new BN(2_000_000_000);
        console.log("💰 Setting custom price...");
        const priceTx = await mockRaydiumProgram.methods
            .setMockPrice(customPrice)
            .accounts({
                user: wallet.publicKey,
                poolState: poolState,
                tokenAMint: sortedTokenAMint,
                tokenBMint: sortedTokenBMint,
            })
            .signers([wallet.payer])
            .rpc();
        console.log("   Transaction:", priceTx);
        await waitForConfirmation(2000);
        console.log("✅ Custom price set:", customPrice.toString(), "\n");

        // Enable custom price mode
        console.log("🔧 Enabling custom price mode...");
        const modeTx = await mockRaydiumProgram.methods
            .setMode(true)
            .accounts({
                user: wallet.publicKey,
                poolState: poolState,
                tokenAMint: sortedTokenAMint,
                tokenBMint: sortedTokenBMint,
            })
            .signers([wallet.payer])
            .rpc();
        console.log("   Transaction:", modeTx);
        await waitForConfirmation(2000);
        console.log("✅ Custom price mode enabled\n");

        console.log("🎉 Raydium pool creation with custom price completed successfully!");
        console.log("\n📋 Summary:");
        console.log("   Pool State:", poolState.toBase58());
        console.log("   Token A Mint:", sortedTokenAMint.toBase58());
        console.log("   Token B Mint:", sortedTokenBMint.toBase58());
        console.log("   Token A Vault:", tokenAVault.toBase58());
        console.log("   Token B Vault:", tokenBVault.toBase58());
    } catch (error) {
        console.error("❌ Error during pool creation:", error);
        throw error;
    }
}

// Main execution
(async () => {
    try {
        await createRaydiumPoolWithCustomPrice();
    } catch (error) {
        console.error("Fatal error:", error);
        process.exit(1);
    }
})();