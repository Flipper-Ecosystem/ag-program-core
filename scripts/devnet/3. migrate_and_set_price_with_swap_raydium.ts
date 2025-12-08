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
    getAccount,
} from "@solana/spl-token";
import FLIPPER_IDL from "../../target/idl/flipper.json";
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

// Load programs
const flipperProgram = new Program(FLIPPER_IDL as any, provider);
const mockRaydiumProgram = new Program(MOCK_RAYDIUM_IDL as any, provider);

// Shared variables
let admin: Keypair;
let user: Keypair;
let tokenAMint: PublicKey;
let tokenBMint: PublicKey;
let poolState: PublicKey;
let poolAuthority: PublicKey;
let tokenAVault: PublicKey;
let tokenBVault: PublicKey;
let sortedTokenAMint: PublicKey;
let sortedTokenBMint: PublicKey;
let userTokenAAccount: PublicKey;
let userTokenBAccount: PublicKey;
let raydiumAmmConfig: PublicKey;
let raydiumObservationState: PublicKey;
let vaultAuthority: PublicKey;
let adapterRegistry: PublicKey;
let inputVault: PublicKey;
let outputVault: PublicKey;
let platformFeeAccount: PublicKey;
let raydiumPoolInfo: PublicKey;

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

// Wait for confirmation
async function waitForConfirmation(ms: number = 2000) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function createRaydiumPoolWithCustomPrice() {
    try {
        console.log("🚀 Starting Raydium Pool Creation with Custom Price...\n");

        admin = wallet.payer;
        user = Keypair.generate();
        console.log("📍 Admin address:", admin.publicKey);
        console.log("📍 User address:", user.publicKey);

        // Check admin balance
        const adminBalance = await connection.getBalance(admin.publicKey);
        console.log("💰 Admin balance:", adminBalance / 1e9, "SOL");

        /*if (adminBalance < 3_000_000_000) {
            console.error("❌ Insufficient admin balance. Need at least 3 SOL");
            console.log("   Run: solana airdrop 5 --url devnet");
            process.exit(1);
        }*/

        // Transfer SOL to user
        console.log("\n💸 Transferring SOL to user...");
        const transferToUserTx = new anchor.web3.Transaction().add(
            SystemProgram.transfer({
                fromPubkey: admin.publicKey,
                toPubkey: user.publicKey,
                lamports: 500_000_000, // 1 SOL
            })
        );
        await provider.sendAndConfirm(transferToUserTx, [wallet.payer]);
        console.log("✅ Transferred 0.5 SOL to user");
        await waitForConfirmation(2000);

        // Derive existing PDAs
        [vaultAuthority] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault_authority")],
            flipperProgram.programId
        );

        [adapterRegistry] = PublicKey.findProgramAddressSync(
            [Buffer.from("adapter_registry")],
            flipperProgram.programId
        );

        console.log("📌 Using existing Flipper infrastructure:");
        console.log("   Vault Authority:", vaultAuthority);
        console.log("   Adapter Registry:", adapterRegistry);

        // Create token mints
        console.log("\n🪙 Creating token mints...");
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

        console.log("   Token A Mint:", tokenAMint);
        console.log("   Token B Mint:", tokenBMint);

        // Sort tokens
        [sortedTokenAMint, sortedTokenBMint] = tokenAMint.toString() < tokenBMint.toString()
            ? [tokenAMint, tokenBMint]
            : [tokenBMint, tokenAMint];

        console.log("\n🔄 Sorted tokens:");
        console.log("   Sorted Token A:", sortedTokenAMint);
        console.log("   Sorted Token B:", sortedTokenBMint);

        // Derive vaults for Flipper
        [inputVault] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault"), sortedTokenAMint.toBuffer()],
            flipperProgram.programId
        );
        [outputVault] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault"), sortedTokenBMint.toBuffer()],
            flipperProgram.programId
        );

        // Create vaults
        console.log("\n🏦 Creating Flipper token vaults...");
        for (const [vault, mint, name] of [
            [inputVault, sortedTokenAMint, "Input"],
            [outputVault, sortedTokenBMint, "Output"]
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
            await waitForConfirmation(3000);
            console.log(`   ✅ ${name} vault created: ${vault}`);
        }

        // Mint tokens to vaults
        console.log("\n🎁 Minting tokens to vaults...");
        await mintTo(connection, wallet.payer, sortedTokenAMint, inputVault, wallet.publicKey, 1_000_000_000_000);
        await waitForConfirmation(3000);
        await mintTo(connection, wallet.payer, sortedTokenBMint, outputVault, wallet.publicKey, 1_000_000_000_000);
        await waitForConfirmation(3000);
        console.log("✅ Tokens minted to vaults");

        // Create platform fee account
        platformFeeAccount = getAssociatedTokenAddressSync(
            sortedTokenBMint,
            vaultAuthority,
            true,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        console.log("   Platform Fee Account:", platformFeeAccount);

        // Derive pool addresses (Raydium)
        [poolState] = PublicKey.findProgramAddressSync(
            [Buffer.from("pool_state"), sortedTokenAMint.toBuffer(), sortedTokenBMint.toBuffer()],
            mockRaydiumProgram.programId
        );
        [poolAuthority] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault_and_lp_mint_auth_seed")],
            mockRaydiumProgram.programId
        );

        console.log("\n🔑 Raydium Pool Info:");
        console.log("   Pool State:", poolState);
        console.log("   Pool Authority:", poolAuthority);

        // Get vault addresses
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

        console.log("   Token A Vault:", tokenAVault);
        console.log("   Token B Vault:", tokenBVault);

        // Create user token accounts
        console.log("\n👤 Creating user token accounts...");
        userTokenAAccount = await createAssociatedTokenAccount(
            connection,
            user,
            sortedTokenAMint,
            user.publicKey,
            undefined,
            TOKEN_PROGRAM_ID,
            undefined
        );
        await waitForConfirmation(3000);

        userTokenBAccount = await createAssociatedTokenAccount(
            connection,
            user,
            sortedTokenBMint,
            user.publicKey,
            undefined,
            TOKEN_PROGRAM_ID,
            undefined
        );
        await waitForConfirmation(3000);
        console.log("✅ User token accounts created");
        console.log("   User Token A Account:", userTokenAAccount);
        console.log("   User Token B Account:", userTokenBAccount);

        // Mint tokens to user accounts
        console.log("\n🎁 Minting tokens to user...");
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
        console.log("✅ Tokens minted to user Token A account");


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
        console.log("✅ Tokens minted to user (both Token A and Token B)");

        // Initialize Raydium pool
        console.log("\n🏊 Initializing Raydium pool...");
        const tx = await mockRaydiumProgram.methods
            .initializePool(new BN(1_000_000_000), new BN(1_000_000_000))
            .accounts({
                user: user.publicKey,  // Изменено
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
            .signers([user])  // Изменено
            .rpc();
        console.log("   Transaction:", tx);
        await waitForConfirmation(3000);
        console.log("✅ Raydium pool initialized");

        // Set custom price (2 Token B per 1 Token A)
        const customPrice = new BN(2_000_000_000);
        console.log("\n💰 Setting custom price (1 Token A = 2 Token B)...");
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
        console.log("✅ Custom price set");

        // Enable custom price mode
        console.log("\n🔧 Enabling custom price mode...");
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
        console.log("✅ Custom price mode enabled");

        // Setup additional accounts for swap
        raydiumAmmConfig = Keypair.generate().publicKey;
        raydiumObservationState = Keypair.generate().publicKey;

        // Initialize pool info
        [raydiumPoolInfo] = PublicKey.findProgramAddressSync(
            [Buffer.from("pool_info"), getSwapTypeBytes({ raydium: {} }), poolState.toBuffer()],
            flipperProgram.programId
        );

        console.log("\n📋 Initializing pool info...");
        await flipperProgram.methods
            .initializePoolInfo({ raydium: {} }, poolState)
            .accounts({
                poolInfo: raydiumPoolInfo,
                adapterRegistry,
                payer: wallet.publicKey,
                operator: wallet.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([wallet.payer])
            .rpc();
        await waitForConfirmation(3000);
        console.log("✅ Pool info initialized:", raydiumPoolInfo);

        console.log("\n🎉 Setup completed successfully!");
    } catch (error) {
        console.error("❌ Error during setup:", error);
        throw error;
    }
}

async function executeRouteSwap() {
    try {
        console.log("\n\n🔄 Executing route swap with custom price...\n");

        const inAmount = new BN(100_000_000); // 0.1 Token A
        const quotedOutAmount = new BN(180_000_000); // Expecting ~0.2 Token B (with custom price 1:2)
        const slippageBps = 100; // 1%
        const platformFeeBps = 0;

        const routePlan = [
            { swap: { raydium: {} }, percent: 100, inputIndex: 0, outputIndex: 13 }
        ];

        const remainingAccounts = [
            { pubkey: inputVault, isWritable: true, isSigner: false },
            { pubkey: raydiumPoolInfo, isWritable: true, isSigner: false },
            { pubkey: poolAuthority, isWritable: false, isSigner: false },
            { pubkey: raydiumAmmConfig, isWritable: false, isSigner: false },
            { pubkey: poolState, isWritable: true, isSigner: false },
            { pubkey: tokenAVault, isWritable: true, isSigner: false },
            { pubkey: tokenBVault, isWritable: true, isSigner: false },
            { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
            { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
            { pubkey: sortedTokenAMint, isWritable: false, isSigner: false },
            { pubkey: sortedTokenBMint, isWritable: false, isSigner: false },
            { pubkey: raydiumObservationState, isWritable: true, isSigner: false },
            { pubkey: mockRaydiumProgram.programId, isWritable: false, isSigner: false },
            { pubkey: outputVault, isWritable: true, isSigner: false },
        ];

        // Get initial balances
        const initialInput = (await getAccount(connection, userTokenAAccount)).amount;
        const initialOutput = (await getAccount(connection, userTokenBAccount)).amount;

        console.log("📊 Initial balances:");
        console.log("   Token A (input):", initialInput.toString());
        console.log("   Token B (output):", initialOutput.toString());

        // Execute route swap
        console.log("\n⚡ Executing route transaction...");
        const txSignature = await flipperProgram.methods
            .route(routePlan, inAmount, quotedOutAmount, slippageBps, platformFeeBps)
            .accounts({
                adapterRegistry,
                vaultAuthority,
                inputTokenProgram: TOKEN_PROGRAM_ID,
                outputTokenProgram: TOKEN_PROGRAM_ID,
                userTransferAuthority: user.publicKey,
                userSourceTokenAccount: userTokenAAccount,
                userDestinationTokenAccount: userTokenBAccount,
                sourceMint: sortedTokenAMint,
                destinationMint: sortedTokenBMint,
                platformFeeAccount,
                systemProgram: SystemProgram.programId
            })
            .remainingAccounts(remainingAccounts)
            .signers([user])
            .rpc();

        await waitForConfirmation(3000);
        console.log("✅ Route transaction signature:", txSignature);

        // Get final balances
        const finalInput = (await getAccount(connection, userTokenAAccount)).amount;
        const finalOutput = (await getAccount(connection, userTokenBAccount)).amount;

        console.log("\n📊 Final balances:");
        console.log("   Token A (input):", finalInput.toString());
        console.log("   Token B (output):", finalOutput.toString());

        // Calculate results
        const spent = initialInput - finalInput;
        const received = finalOutput - initialOutput;
        const minOutAmount = quotedOutAmount.mul(new BN(10000 - slippageBps)).div(new BN(10000));

        console.log("\n✨ Swap results:");
        console.log("   Spent:", spent.toString(), "Token A");
        console.log("   Received:", received.toString(), "Token B");
        console.log("   Expected min:", minOutAmount.toString(), "Token B");
        console.log("   Exchange rate: 1 Token A =", (Number(received) / Number(spent)).toFixed(4), "Token B");

        if (spent === BigInt(inAmount.toString()) && received >= BigInt(minOutAmount.toString())) {
            console.log("\n✅ Route swap completed successfully with custom price!");
        } else {
            console.log("\n⚠️ Route swap completed but results don't match expectations");
        }
    } catch (error) {
        console.error("❌ Error during route swap execution:", error);
        throw error;
    }
}

// Main execution
(async () => {
    try {
        await createRaydiumPoolWithCustomPrice();
        await executeRouteSwap();
    } catch (error) {
        console.error("Fatal error:", error);
        process.exit(1);
    }
})();