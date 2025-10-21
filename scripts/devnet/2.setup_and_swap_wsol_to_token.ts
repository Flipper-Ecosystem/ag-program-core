import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, Connection, SystemProgram, LAMPORTS_PER_SOL, Transaction } from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    NATIVE_MINT,
    createMint,
    mintTo,
    getAssociatedTokenAddressSync,
    createAssociatedTokenAccount,
    getAccount,
    createSyncNativeInstruction,
    getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import FLIPPER_IDL from "../../target/idl/flipper.json";
import MOCK_RAYDIUM_IDL from "../../target/idl/mock_raydium.json";
import fs from "fs";

// Load keypair from file
const loadKeypair = (): Keypair => {
    const keypairPath = process.env.HOME + "/.config/solana/id.json";
    if (fs.existsSync(keypairPath)) {
        const secretKey = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
        return Keypair.fromSecretKey(Uint8Array.from(secretKey));
    }
    console.error("❌ Keypair file not found at:", keypairPath);
    process.exit(1);
};

// Connect to Solana Devnet
const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const wallet = new anchor.Wallet(loadKeypair());
const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
anchor.setProvider(provider);

// Load programs
const flipperProgram = new Program(FLIPPER_IDL, provider);
const mockRaydiumProgram = new Program(MOCK_RAYDIUM_IDL, provider);

// Wait for transaction confirmation
const waitForConfirmation = (ms: number = 2000) => new Promise(resolve => setTimeout(resolve, ms));

// Get swap type bytes for Raydium
function getSwapTypeBytes(swapType: any): Buffer {
    const bytes = Buffer.alloc(32, 0);
    if ("raydium" in swapType) bytes[0] = 7;
    return bytes;
}

// Helper function to wrap SOL to WSOL
async function wrapSol(
    connection: Connection,
    payer: Keypair,
    wsolAccount: PublicKey,
    amountInSol: number
): Promise<string> {
    const lamports = amountInSol * LAMPORTS_PER_SOL;

    const tx = new Transaction().add(
        // Transfer SOL to WSOL account
        SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: wsolAccount,
            lamports,
        }),
        // Sync native to update WSOL balance
        createSyncNativeInstruction(wsolAccount)
    );

    const signature = await provider.sendAndConfirm(tx, [payer]);
    return signature;
}

async function setupPoolAndSwap() {
    try {
        console.log("🚀 Starting Raydium Pool Setup with WSOL and New Token\n");

        const payer = wallet.payer;
        const user = Keypair.generate();

        console.log("📍 Addresses:");
        console.log("   Payer:", payer.publicKey.toBase58());
        console.log("   User:", user.publicKey.toBase58());

        // Check payer balance
        const payerBalance = await connection.getBalance(payer.publicKey);
        console.log("💰 Payer balance:", payerBalance / LAMPORTS_PER_SOL, "SOL\n");

        if (payerBalance < 0.5 * LAMPORTS_PER_SOL) {
            console.error("❌ Insufficient payer balance. Need at least 0.5 SOL");
            process.exit(1);
        }

        // Transfer SOL to user (reduced from 2 to 0.3 SOL)
        console.log("💸 Transferring SOL to user...");
        const transferTx = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: payer.publicKey,
                toPubkey: user.publicKey,
                lamports: 0.3 * LAMPORTS_PER_SOL, // Send 0.3 SOL to user
            })
        );
        await provider.sendAndConfirm(transferTx, [payer]);
        await waitForConfirmation(2000);

        const userBalance = await connection.getBalance(user.publicKey);
        console.log("✅ User received:", userBalance / LAMPORTS_PER_SOL, "SOL\n");

        // ===== 1. Create new token mint =====
        console.log("🪙 Creating new token mint...");
        const newTokenMint = await createMint(
            connection,
            payer,
            payer.publicKey,
            null,
            9,
            undefined,
            undefined,
            TOKEN_PROGRAM_ID
        );
        await waitForConfirmation(3000);
        console.log("   New Token Mint:", newTokenMint.toBase58(), "\n");

        // ===== 2. Create token accounts for user =====
        console.log("👤 Creating user token accounts...");

        // WSOL account (Native SOL wrapped)
        const userWsolAccount = await createAssociatedTokenAccount(
            connection,
            user,
            NATIVE_MINT,
            user.publicKey,
            undefined,
            TOKEN_PROGRAM_ID,
            undefined
        );
        await waitForConfirmation(2000);

        // New Token account
        const userNewTokenAccount = await createAssociatedTokenAccount(
            connection,
            user,
            newTokenMint,
            user.publicKey,
            undefined,
            TOKEN_PROGRAM_ID,
            undefined
        );
        await waitForConfirmation(2000);
        console.log("✅ User token accounts created\n");

        // ===== 3. Wrap SOL to WSOL for user (reduced from 1 to 0.1 SOL) =====
        console.log("🔄 Wrapping SOL to WSOL for user...");
        await wrapSol(connection, user, userWsolAccount, 0.1); // Wrap 0.1 SOL
        await waitForConfirmation(2000);

        const userWsolBalance = (await getAccount(connection, userWsolAccount)).amount;
        console.log("✅ User WSOL balance:", userWsolBalance.toString(), "\n");

        // ===== 4. Mint new tokens to user =====
        console.log("🎁 Minting new tokens to user...");
        await mintTo(
            connection,
            payer,
            newTokenMint,
            userNewTokenAccount,
            payer.publicKey,
            10_000_000_000_000 // 10,000 tokens
        );
        await waitForConfirmation(3000);
        console.log("✅ Minted 10,000 new tokens\n");

        // ===== 5. Setup Raydium Pool =====
        console.log("🏊 Setting up Raydium pool...");

        const mockRaydiumProgramId = mockRaydiumProgram.programId;

        // EXPLICITLY set WSOL as Token A, new token as Token B (NO SORTING)
        const tokenAMint = NATIVE_MINT; // WSOL is always Token A
        const tokenBMint = newTokenMint; // New token is always Token B

        console.log("   Token A (WSOL):", tokenAMint.toBase58());
        console.log("   Token B (New Token):", tokenBMint.toBase58(), "\n");

        // Derive pool PDAs
        const [raydiumPoolState] = PublicKey.findProgramAddressSync(
            [Buffer.from("pool_state"), tokenAMint.toBuffer(), tokenBMint.toBuffer()],
            mockRaydiumProgramId
        );

        const [raydiumPoolAuthority] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault_and_lp_mint_auth_seed")],
            mockRaydiumProgramId
        );

        console.log("   Pool State:", raydiumPoolState.toBase58());
        console.log("   Pool Authority (PDA):", raydiumPoolAuthority.toBase58(), "\n");

        // Create payer token accounts first (for adding liquidity)
        console.log("💧 Creating payer token accounts for liquidity...");

        // For WSOL (Token A) - use getOrCreateAssociatedTokenAccount
        const payerWsolAccountInfo = await getOrCreateAssociatedTokenAccount(
            connection,
            payer,
            NATIVE_MINT,
            payer.publicKey,
            false, // allowOwnerOffCurve
            undefined, // commitment
            undefined, // confirmOptions
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        const payerTokenAAccount = payerWsolAccountInfo.address; // WSOL = Token A
        await waitForConfirmation(2000);

        // For new token (Token B)
        const payerTokenBAccount = await createAssociatedTokenAccount(
            connection,
            payer,
            newTokenMint,
            payer.publicKey,
            undefined,
            TOKEN_PROGRAM_ID,
            undefined
        );
        await waitForConfirmation(2000);

        console.log("✅ Payer token accounts created\n");

        // Add liquidity to payer accounts (reduced from 1 SOL to 0.5 SOL)
        console.log("💰 Funding payer accounts...");

        // Fund Token A (WSOL) - reduced from 1 to 0.5 SOL
        await wrapSol(connection, payer, payerTokenAAccount, 0.5); // Wrap 0.5 SOL
        await waitForConfirmation(2000);
        console.log("✅ Wrapped 0.5 SOL to WSOL (Token A)");

        // Fund Token B (New Token) - reduced from 1,000 to 500 tokens
        await mintTo(connection, payer, tokenBMint, payerTokenBAccount, payer.publicKey, 500_000_000_000); // 500 tokens
        await waitForConfirmation(2000);
        console.log("✅ Minted 500 new tokens (Token B)");

        console.log();

        // Get vault addresses (they will be created by the initialize_pool instruction)
        const raydiumTokenAVault = getAssociatedTokenAddressSync(
            tokenAMint,
            raydiumPoolAuthority,
            true, // allowOwnerOffCurve = true for PDA
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        const raydiumTokenBVault = getAssociatedTokenAddressSync(
            tokenBMint,
            raydiumPoolAuthority,
            true, // allowOwnerOffCurve = true for PDA
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        const raydiumObservationState = Keypair.generate().publicKey;

        // Initialize Raydium pool (reduced liquidity: 0.5 SOL and 500 tokens)
        console.log("⚙️ Initializing Raydium pool...");
        await mockRaydiumProgram.methods
            .initializePool(new BN(500_000_000), new BN(500_000_000_000)) // 0.5 WSOL and 500 tokens
            .accounts({
                user: payer.publicKey,
                poolState: raydiumPoolState,
                authority: raydiumPoolAuthority,
                userTokenA: payerTokenAAccount,
                userTokenB: payerTokenBAccount,
                tokenAVault: raydiumTokenAVault,
                tokenBVault: raydiumTokenBVault,
                tokenAMint,
                tokenBMint,
                tokenAProgram: TOKEN_PROGRAM_ID,
                tokenBProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .signers([payer])
            .rpc();
        await waitForConfirmation(3000);
        console.log("✅ Raydium pool initialized");
        console.log("   Pool: 0.5 WSOL (Token A) ↔ 500 New Token (Token B)\n");

        // ===== 6. Initialize Pool Info in Flipper =====
        const [vaultAuthority] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault_authority")],
            flipperProgram.programId
        );

        const [adapterRegistry] = PublicKey.findProgramAddressSync(
            [Buffer.from("adapter_registry")],
            flipperProgram.programId
        );

        const [raydiumPoolInfo] = PublicKey.findProgramAddressSync(
            [Buffer.from("pool_info"), getSwapTypeBytes({ raydium: {} }), raydiumPoolState.toBuffer()],
            flipperProgram.programId
        );

        console.log("⚙️ Initializing pool info in Flipper...");
        await flipperProgram.methods
            .initializePoolInfo({ raydium: {} }, raydiumPoolState)
            .accounts({
                poolInfo: raydiumPoolInfo,
                adapterRegistry,
                payer: payer.publicKey,
                operator: payer.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([payer])
            .rpc();
        await waitForConfirmation(3000);
        console.log("✅ Pool info initialized\n");

        // ===== 7. Create Platform Fee Account =====
        console.log("💼 Creating platform fee account...");

        const platformFeeAccount = getAssociatedTokenAddressSync(
            newTokenMint,
            vaultAuthority,
            true, // allowOwnerOffCurve = true for PDA
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        // Create the platform fee account using getOrCreateAssociatedTokenAccount
        await getOrCreateAssociatedTokenAccount(
            connection,
            payer,
            newTokenMint,
            vaultAuthority,
            true, // allowOwnerOffCurve = true for PDA
            undefined,
            undefined,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        await waitForConfirmation(2000);
        console.log("✅ Platform fee account created:", platformFeeAccount.toBase58(), "\n");

        // ===== 8. Execute Swap =====
        console.log("🔄 Executing swap: WSOL → New Token\n");

        const [inputVault] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault"), NATIVE_MINT.toBuffer()],
            flipperProgram.programId
        );

        const [outputVault] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault"), newTokenMint.toBuffer()],
            flipperProgram.programId
        );

        // Reduced swap amount from 0.1 to 0.01 WSOL
        const inAmount = new BN(10_000_000); // 0.01 WSOL
        const quotedOutAmount = new BN(9_000_000); // Expected ~9 tokens (with slippage)
        const slippageBps = 100;
        const platformFeeBps = 0;

        const routePlan = [
            { swap: { raydium: {} }, percent: 100, inputIndex: 0, outputIndex: 13 }
        ];

        // Since WSOL is Token A and New Token is Token B:
        // Swapping WSOL → New Token means: Token A vault → Token B vault
        const inputPoolVault = raydiumTokenAVault;  // WSOL vault
        const outputPoolVault = raydiumTokenBVault; // New Token vault

        console.log("   Input (WSOL) vault:", inputPoolVault.toBase58());
        console.log("   Output (New Token) vault:", outputPoolVault.toBase58());
        console.log("   Swap amount: 0.01 WSOL\n");

        const raydiumAmmConfig = Keypair.generate().publicKey;

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
            { pubkey: NATIVE_MINT, isWritable: false, isSigner: false },
            { pubkey: newTokenMint, isWritable: false, isSigner: false },
            { pubkey: raydiumObservationState, isWritable: true, isSigner: false },
            { pubkey: mockRaydiumProgramId, isWritable: false, isSigner: false },
            { pubkey: outputVault, isWritable: true, isSigner: false },
        ];

        // Get initial balances
        const initialWsol = (await getAccount(connection, userWsolAccount)).amount;
        const initialNewToken = (await getAccount(connection, userNewTokenAccount)).amount;

        console.log("📊 Initial balances:");
        console.log("   WSOL:", initialWsol.toString());
        console.log("   New Token:", initialNewToken.toString(), "\n");

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
                userSourceTokenAccount: userWsolAccount,
                userDestinationTokenAccount: userNewTokenAccount,
                sourceMint: NATIVE_MINT,
                destinationMint: newTokenMint,
                platformFeeAccount,
                systemProgram: SystemProgram.programId
            })
            .remainingAccounts(remainingAccounts)
            .signers([user])
            .rpc();

        await waitForConfirmation(3000);
        console.log("✅ Swap completed! Signature:", txSignature, "\n");

        // Get final balances
        const finalWsol = (await getAccount(connection, userWsolAccount)).amount;
        const finalNewToken = (await getAccount(connection, userNewTokenAccount)).amount;

        console.log("📊 Final balances:");
        console.log("   WSOL:", finalWsol.toString());
        console.log("   New Token:", finalNewToken.toString(), "\n");

        console.log("✨ Swap results:");
        console.log("   Spent WSOL:", (initialWsol - finalWsol).toString());
        console.log("   Received New Token:", (finalNewToken - initialNewToken).toString());
        console.log("\n✅ All operations completed successfully!");

    } catch (error) {
        console.error("❌ Error:", error);
        throw error;
    }
}

// Run the script
(async () => {
    try {
        await setupPoolAndSwap();
    } catch (error) {
        console.error("Fatal error:", error);
        process.exit(1);
    }
})();