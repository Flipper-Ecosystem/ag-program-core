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
import FLIPPER_IDL from "../target/idl/flipper.json";
import MOCK_RAYDIUM_IDL from "../target/idl/mock_raydium.json";
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
const connection = new Connection("http://127.0.0.1:8899", "confirmed");

// Create wallet and provider for Anchor
const wallet = new anchor.Wallet(loadKeypair());
const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
});
anchor.setProvider(provider);

// Load programs
const flipperProgram = new Program(FLIPPER_IDL, provider);
const mockRaydiumProgram = new Program(MOCK_RAYDIUM_IDL, provider);

// Shared variables
let admin: Keypair;
let user: Keypair;
let treasury: Keypair;
let vaultAuthority: PublicKey;
let vaultAuthorityBump: number;
let adapterRegistry: PublicKey;
let adapterRegistryBump: number;
let sourceMint: PublicKey;
let destinationMint: PublicKey;
let userSourceTokenAccount: PublicKey;
let userDestinationTokenAccount: PublicKey;
let inputVault: PublicKey;
let outputVault: PublicKey;
let platformFeeAccount: PublicKey;
let mockRaydiumProgramId: PublicKey;
let raydiumPoolInfo: PublicKey;
let raydiumAmmConfig: PublicKey;
let raydiumPoolState: PublicKey;
let raydiumPoolAuthority: PublicKey;
let raydiumTokenAVault: PublicKey;
let raydiumTokenBVault: PublicKey;
let raydiumObservationState: PublicKey;

// Helper function for swapType bytes
function getSwapTypeBytes(swapType: any): Buffer {
    const bytes = Buffer.alloc(32, 0);
    if ("raydium" in swapType) bytes[0] = 7;
    else if ("whirlpool" in swapType) {
        bytes[0] = 17;
        bytes[1] = swapType.whirlpool.aToB ? 1 : 0;
    } else if ("meteora" in swapType) bytes[0] = 8;
    return bytes;
}

// Wait for transaction confirmation
async function waitForConfirmation(ms: number = 2000) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function setupProgram() {
    try {
        console.log("🚀 Starting Flipper Swap Protocol setup on Localnet...\n");

        admin = wallet.payer;
        user = Keypair.generate();
        treasury = Keypair.generate();

        console.log("📍 Wallet addresses:");
        console.log("   Admin:", admin.publicKey.toBase58());
        console.log("   User:", user.publicKey.toBase58());
        console.log("   Treasury:", treasury.publicKey.toBase58(), "\n");

        // Fund user and treasury
        console.log("💰 Requesting airdrops...");
        await connection.requestAirdrop(user.publicKey, 10_000_000_000);
        await connection.requestAirdrop(treasury.publicKey, 10_000_000_000);
        await waitForConfirmation();
        console.log("✅ Airdrops completed\n");

        // Derive PDAs
        [vaultAuthority, vaultAuthorityBump] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault_authority")],
            flipperProgram.programId
        );

        // Fund vault_authority with SOL
        console.log("💸 Funding vault authority...");
        const fundTx = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: wallet.payer.publicKey,
                toPubkey: vaultAuthority,
                lamports: 10_000_000_000
            })
        );
        await provider.sendAndConfirm(fundTx, [wallet.payer]);
        console.log("✅ Vault authority funded\n");

        [adapterRegistry, adapterRegistryBump] = PublicKey.findProgramAddressSync(
            [Buffer.from("adapter_registry")],
            flipperProgram.programId
        );

        // Create vault authority
        console.log("🔧 Creating vault authority...");
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
        console.log("✅ Vault authority created\n");

        // Create mints
        console.log("🪙 Creating token mints...");
        sourceMint = await createMint(
            connection,
            wallet.payer,
            wallet.publicKey,
            null,
            9,
            undefined,
            undefined,
            TOKEN_PROGRAM_ID
        );
        destinationMint = await createMint(
            connection,
            wallet.payer,
            wallet.publicKey,
            null,
            9,
            undefined,
            undefined,
            TOKEN_PROGRAM_ID
        );
        console.log("   Source Mint:", sourceMint.toBase58());
        console.log("   Destination Mint:", destinationMint.toBase58(), "\n");

        // Derive vault addresses
        [inputVault] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault"), sourceMint.toBuffer()],
            flipperProgram.programId
        );
        [outputVault] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault"), destinationMint.toBuffer()],
            flipperProgram.programId
        );

        // Create vaults
        console.log("🏦 Creating token vaults...");
        for (const [vault, mint, name] of [
            [inputVault, sourceMint, "Input"],
            [outputVault, destinationMint, "Output"]
        ]) {
            await flipperProgram.methods
                .createVault()
                .accounts({
                    vaultAuthority,
                    payer: wallet.publicKey,
                    admin: admin.publicKey,
                    vault,
                    vaultMint: mint,
                    vaultTokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([wallet.payer])
                .rpc();
            console.log(`   ✅ ${name} vault created`);
        }
        console.log();

        // Create user token accounts
        console.log("👤 Creating user token accounts...");
        userSourceTokenAccount = await createAssociatedTokenAccount(
            connection,
            user,              // payer
            sourceMint,        // mint
            user.publicKey,    // owner
            undefined,         // allowOwnerOffCurve (optional)
            TOKEN_PROGRAM_ID,  // programId
            undefined
        );
        userDestinationTokenAccount = await createAssociatedTokenAccount(
            connection,
            user,
            destinationMint,
            user.publicKey,
            undefined,         // allowOwnerOffCurve (optional)
            TOKEN_PROGRAM_ID,  // programId
            undefined
        );
        console.log("✅ User token accounts created\n");

        // Mint tokens to user and vaults
        console.log("🎁 Minting tokens...");
        await mintTo(connection, wallet.payer, sourceMint, userSourceTokenAccount, wallet.publicKey, 1_000_000_000_000);
        await mintTo(connection, wallet.payer, sourceMint, inputVault, wallet.publicKey, 1_000_000_000_000);
        await mintTo(connection, wallet.payer, destinationMint, outputVault, wallet.publicKey, 1_000_000_000_000);
        console.log("✅ Tokens minted\n");

        // Create platform fee account
        const tokenAccount = await getOrCreateAssociatedTokenAccount(
            connection,
            wallet.payer,
            destinationMint,
            vaultAuthority,
            true,
            undefined,
            undefined,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        platformFeeAccount = tokenAccount.address;

        // Setup mock Raydium
        mockRaydiumProgramId = mockRaydiumProgram.programId;
        raydiumAmmConfig = Keypair.generate().publicKey;

        // Initialize adapter registry
        console.log("⚙️ Initializing adapter registry...");
        await flipperProgram.methods
            .initializeAdapterRegistry([], [])
            .accounts({
                adapterRegistry,
                payer: wallet.publicKey,
                operator: wallet.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([wallet.payer])
            .rpc();
        console.log("✅ Adapter registry initialized\n");

        // Configure Raydium adapter
        console.log("🔌 Configuring Raydium adapter...");
        await flipperProgram.methods
            .configureAdapter({
                name: "raydium",
                programId: mockRaydiumProgramId,
                swapType: { raydium: {} }
            })
            .accounts({ adapterRegistry, operator: wallet.publicKey })
            .signers([wallet.payer])
            .rpc();
        console.log("✅ Raydium adapter configured\n");

        // Setup Raydium pool
        console.log("🏊 Setting up Raydium pool...");
        const [tokenAMint, tokenBMint] = sourceMint.toString() < destinationMint.toString()
            ? [sourceMint, destinationMint]
            : [destinationMint, sourceMint];

        [raydiumPoolState] = PublicKey.findProgramAddressSync(
            [Buffer.from("pool_state"), tokenAMint.toBuffer(), tokenBMint.toBuffer()],
            mockRaydiumProgramId
        );
        [raydiumPoolAuthority] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault_and_lp_mint_auth_seed")],
            mockRaydiumProgramId
        );

        raydiumTokenAVault = getAssociatedTokenAddressSync(
            tokenAMint,
            raydiumPoolAuthority,
            true,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        raydiumTokenBVault = getAssociatedTokenAddressSync(
            tokenBMint,
            raydiumPoolAuthority,
            true,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        raydiumObservationState = Keypair.generate().publicKey;

        // Create user token accounts for pool
        const userTokenAAccount = await createAssociatedTokenAccount(
            connection,
            wallet.payer,
            tokenAMint,
            wallet.publicKey,
            undefined,         // commitment
            TOKEN_PROGRAM_ID,
            undefined         // allowOwnerOffCurve
        );

        const userTokenBAccount = await createAssociatedTokenAccount(
            connection,
            wallet.payer,
            tokenBMint,
            wallet.publicKey,
            undefined,         // commitment
            TOKEN_PROGRAM_ID,
            undefined         // allowOwnerOffCurve
        );

        // Mint tokens to pool accounts
        await mintTo(connection, wallet.payer, tokenAMint, userTokenAAccount, wallet.publicKey, 1_000_000_000_000, [], undefined, TOKEN_PROGRAM_ID);
        await mintTo(connection, wallet.payer, tokenBMint, userTokenBAccount, wallet.publicKey, 1_000_000_000_000, [], undefined, TOKEN_PROGRAM_ID);

        // Initialize Raydium pool
        await mockRaydiumProgram.methods
            .initializePool(new BN(1_000_000_000), new BN(1_000_000_000))
            .accounts({
                user: wallet.publicKey,
                poolState: raydiumPoolState,
                authority: raydiumPoolAuthority,
                userTokenA: userTokenAAccount,
                userTokenB: userTokenBAccount,
                tokenAVault: raydiumTokenAVault,
                tokenBVault: raydiumTokenBVault,
                tokenAMint: tokenAMint,
                tokenBMint: tokenBMint,
                tokenAProgram: TOKEN_PROGRAM_ID,
                tokenBProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .signers([wallet.payer])
            .rpc();
        console.log("✅ Raydium pool initialized\n");

        // Initialize pool info
        [raydiumPoolInfo] = PublicKey.findProgramAddressSync(
            [Buffer.from("pool_info"), getSwapTypeBytes({ raydium: {} }), raydiumPoolState.toBuffer()],
            flipperProgram.programId
        );
        await flipperProgram.methods
            .initializePoolInfo({ raydium: {} }, raydiumPoolState)
            .accounts({
                poolInfo: raydiumPoolInfo,
                adapterRegistry,
                payer: wallet.publicKey,
                operator: wallet.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([wallet.payer])
            .rpc();
        console.log("✅ Pool info initialized\n");

        console.log("🎉 Setup completed successfully!\n");
    } catch (error) {
        console.error("❌ Error during setup:", error);
        throw error;
    }
}

async function executeSwap() {
    try {
        console.log("🔄 Executing single-hop swap with Raydium adapter...\n");

        const inAmount = new BN(100_000_000);
        const quotedOutAmount = new BN(90_000_000);
        const slippageBps = 100;
        const platformFeeBps = 0;

        const routePlan = [
            { swap: { raydium: {} }, percent: 100, inputIndex: 0, outputIndex: 13 }
        ];

        const inputPoolVault = sourceMint.toString() < destinationMint.toString()
            ? raydiumTokenAVault
            : raydiumTokenBVault;
        const outputPoolVault = sourceMint.toString() < destinationMint.toString()
            ? raydiumTokenBVault
            : raydiumTokenAVault;

        const remainingAccounts = [
            { pubkey: inputVault, isWritable: true, isSigner: false },
            { pubkey: raydiumPoolInfo, isWritable: true, isSigner: false },
            { pubkey: raydiumPoolAuthority, isWritable: false, isSigner: false },
            { pubkey: raydiumAmmConfig, isWritable: false, isSigner: false },
            { pubkey: raydiumPoolState, isWritable: true, isSigner: false },
            { pubkey: inputPoolVault, isWritable: true, isSigner: false },
            { pubkey: outputPoolVault, isWritable: true, isSigner: false },
            { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
            { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
            { pubkey: sourceMint, isWritable: false, isSigner: false },
            { pubkey: destinationMint, isWritable: false, isSigner: false },
            { pubkey: raydiumObservationState, isWritable: true, isSigner: false },
            { pubkey: mockRaydiumProgramId, isWritable: false, isSigner: false },
            { pubkey: outputVault, isWritable: true, isSigner: false },
        ];

        // Get initial balances
        const initialSource = (await getAccount(connection, userSourceTokenAccount)).amount;
        const initialDest = (await getAccount(connection, userDestinationTokenAccount)).amount;

        console.log("📊 Initial balances:");
        console.log("   Source:", initialSource.toString());
        console.log("   Destination:", initialDest.toString(), "\n");

        // Execute swap
        console.log("⚡ Executing swap transaction...");
        const txSignature = await flipperProgram.methods
            .route(routePlan, inAmount, quotedOutAmount, slippageBps, platformFeeBps)
            .accounts({
                adapterRegistry,
                vaultAuthority,
                inputTokenProgram: TOKEN_PROGRAM_ID,
                outputTokenProgram: TOKEN_PROGRAM_ID,
                userTransferAuthority: user.publicKey,
                userSourceTokenAccount,
                userDestinationTokenAccount,
                sourceMint,
                destinationMint,
                platformFeeAccount,
                systemProgram: SystemProgram.programId
            })
            .remainingAccounts(remainingAccounts)
            .signers([user])
            .rpc();

        console.log("✅ Swap transaction signature:", txSignature, "\n");

        // Get final balances
        const finalSource = (await getAccount(connection, userSourceTokenAccount)).amount;
        const finalDest = (await getAccount(connection, userDestinationTokenAccount)).amount;

        console.log("📊 Final balances:");
        console.log("   Source:", finalSource.toString());
        console.log("   Destination:", finalDest.toString(), "\n");

        // Calculate expected values
        const inAmountBN = BigInt(inAmount.toString());
        const minOutAmount = quotedOutAmount.mul(new BN(10000 - slippageBps)).div(new BN(10000));
        const expectedOutAmount = BigInt(minOutAmount.toString());

        console.log("✨ Swap results:");
        console.log("   Spent:", (initialSource - finalSource).toString());
        console.log("   Received:", (finalDest - initialDest).toString());
        console.log("   Expected min:", expectedOutAmount.toString());

        if (finalSource === (initialSource - inAmountBN) && finalDest > (initialDest + expectedOutAmount)) {
            console.log("\n✅ Swap completed successfully!");
        } else {
            console.log("\n⚠️ Swap completed but balances don't match expectations");
        }
    } catch (error) {
        console.error("❌ Error during swap execution:", error);
        throw error;
    }
}

// Main execution
(async () => {
    try {
        await setupProgram();
        await executeSwap();
    } catch (error) {
        console.error("Fatal error:", error);
        process.exit(1);
    }
})();