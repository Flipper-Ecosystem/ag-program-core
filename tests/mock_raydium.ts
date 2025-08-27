import * as anchor from "@coral-xyz/anchor";
import { Program, BN, web3 } from "@coral-xyz/anchor";
import { MockRaydiumSwap } from "../target/types/mock_raydium_swap";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    createMint,
    mintTo,
    createAssociatedTokenAccount,
} from "@solana/spl-token";
import { assert } from "chai";

describe("mock-raydium-swap", () => {
    // Configure the client to use the local cluster
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = anchor.workspace.MockRaydiumSwap as Program<MockRaydiumSwap>;
    const wallet = provider.wallet as anchor.Wallet;

    // Keypairs and accounts
    let tokenAMint: PublicKey;
    let tokenBMint: PublicKey;
    let userTokenAAccount: PublicKey;
    let userTokenBAccount: PublicKey;
    let tokenAVault: PublicKey;
    let tokenBVault: PublicKey;
    let poolState: PublicKey;
    let authority: PublicKey;

    // Test constants
    const INITIAL_TOKEN_A_AMOUNT = new BN(1000000);
    const INITIAL_TOKEN_B_AMOUNT = new BN(2000000);
    const SWAP_AMOUNT_IN = new BN(100000);
    const MINIMUM_AMOUNT_OUT = new BN(180000);

    before(async () => {
        // Verify local validator is running
        try {
            await provider.connection.getVersion();
        } catch (err) {
            throw new Error("Local Solana validator not running. Start with `solana-test-validator`.");
        }

        // Create token mints
        tokenAMint = await createMint(
            provider.connection,
            wallet.payer,
            wallet.publicKey,
            null,
            6
        );
        tokenBMint = await createMint(
            provider.connection,
            wallet.payer,
            wallet.publicKey,
            null,
            6
        );

        // Derive pool state and authority PDA
        [poolState] = await PublicKey.findProgramAddress(
            [
                Buffer.from("pool_state"),
                tokenAMint.toBuffer(),
                tokenBMint.toBuffer(),
            ],
            program.programId
        );

        [authority] = await PublicKey.findProgramAddress(
            [Buffer.from("authority"), poolState.toBuffer()],
            program.programId
        );

        // Create user token accounts
        userTokenAAccount = await createAssociatedTokenAccount(
            provider.connection,
            wallet.payer,
            tokenAMint,
            wallet.publicKey
        );
        userTokenBAccount = await createAssociatedTokenAccount(
            provider.connection,
            wallet.payer,
            tokenBMint,
            wallet.publicKey
        );

        // Derive vault token account addresses (will be created by program via init_if_needed)
        tokenAVault = await getAssociatedTokenAddress(
            tokenAMint,
            authority,
            true, // Allow owner off-curve (PDA)
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        tokenBVault = await getAssociatedTokenAddress(
            tokenBMint,
            authority,
            true, // Allow owner off-curve (PDA)
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        // Mint initial tokens to user
        await mintTo(
            provider.connection,
            wallet.payer,
            tokenAMint,
            userTokenAAccount,
            wallet.publicKey,
            INITIAL_TOKEN_A_AMOUNT.toNumber() * 2
        );
        await mintTo(
            provider.connection,
            wallet.payer,
            tokenBMint,
            userTokenBAccount,
            wallet.publicKey,
            INITIAL_TOKEN_B_AMOUNT.toNumber() * 2
        );
    });

    it("Initializes the pool", async () => {
        await program.methods
            .initializePool(INITIAL_TOKEN_A_AMOUNT, INITIAL_TOKEN_B_AMOUNT)
            .accounts({
                user: wallet.publicKey,
                poolState,
                authority,
                userTokenA: userTokenAAccount,
                userTokenB: userTokenBAccount,
                tokenAVault,
                tokenBVault,
                tokenAMint,
                tokenBMint,
                tokenAProgram: TOKEN_PROGRAM_ID,
                tokenBProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        // Verify pool state
        const poolStateAccount = await program.account.poolState.fetch(poolState);
        assert.equal(
            poolStateAccount.tokenAVault.toBase58(),
            tokenAVault.toBase58(),
            "Token A vault mismatch"
        );
        assert.equal(
            poolStateAccount.tokenBVault.toBase58(),
            tokenBVault.toBase58(),
            "Token B vault mismatch"
        );
        assert.equal(
            poolStateAccount.tokenAVaultAmount.toNumber(),
            INITIAL_TOKEN_A_AMOUNT.toNumber(),
            "Token A amount mismatch"
        );
        assert.equal(
            poolStateAccount.tokenBVaultAmount.toNumber(),
            INITIAL_TOKEN_B_AMOUNT.toNumber(),
            "Token B amount mismatch"
        );

        // Verify token vault balances
        const tokenAVaultBalance = await provider.connection.getTokenAccountBalance(tokenAVault);
        const tokenBVaultBalance = await provider.connection.getTokenAccountBalance(tokenBVault);
        assert.equal(
            tokenAVaultBalance.value.uiAmount,
            INITIAL_TOKEN_A_AMOUNT.toNumber() / 1_000_000,
            "Token A vault balance mismatch"
        );
        assert.equal(
            tokenBVaultBalance.value.uiAmount,
            INITIAL_TOKEN_B_AMOUNT.toNumber() / 1_000_000,
            "Token B vault balance mismatch"
        );
    });

    it("Initializes user token accounts", async () => {
        // Create new user token accounts to test init_if_needed
        const newUser = Keypair.generate();
        const newUserTokenAAccount = await getAssociatedTokenAddress(
            tokenAMint,
            newUser.publicKey,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        const newUserTokenBAccount = await getAssociatedTokenAddress(
            tokenBMint,
            newUser.publicKey,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        // Fund the new user with some SOL for account creation
        const fundTx = new web3.Transaction().add(
            web3.SystemProgram.transfer({
                fromPubkey: wallet.publicKey,
                toPubkey: newUser.publicKey,
                lamports: web3.LAMPORTS_PER_SOL,
            })
        );
        await provider.sendAndConfirm(fundTx, [wallet.payer]);

        await program.methods
            .initializeUserTokenAccounts()
            .accounts({
                user: newUser.publicKey,
                userTokenA: newUserTokenAAccount,
                userTokenB: newUserTokenBAccount,
                tokenAMint,
                tokenBMint,
                tokenAProgram: TOKEN_PROGRAM_ID,
                tokenBProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                rent: web3.SYSVAR_RENT_PUBKEY,
            })
            .signers([newUser])
            .rpc();

        // Verify accounts exist
        const userTokenABalance = await provider.connection.getTokenAccountBalance(newUserTokenAAccount);
        const userTokenBBalance = await provider.connection.getTokenAccountBalance(newUserTokenBAccount);
        assert.isNotNull(userTokenABalance, "User token A account not found");
        assert.isNotNull(userTokenBBalance, "User token B account not found");
    });

    it("Performs a swap (Token A to Token B)", async () => {
        const observationState = Keypair.generate();

        const initialUserTokenABalance = await provider.connection.getTokenAccountBalance(userTokenAAccount);
        const initialUserTokenBBalance = await provider.connection.getTokenAccountBalance(userTokenBAccount);

        await program.methods
            .swapBaseInput(SWAP_AMOUNT_IN, MINIMUM_AMOUNT_OUT)
            .accounts({
                payer: wallet.publicKey,
                authority,
                ammConfig: Keypair.generate().publicKey,
                poolState,
                inputTokenAccount: userTokenAAccount,
                outputTokenAccount: userTokenBAccount,
                tokenAVault,
                tokenBVault,
                inputTokenProgram: TOKEN_PROGRAM_ID,
                outputTokenProgram: TOKEN_PROGRAM_ID,
                inputTokenMint: tokenAMint,
                outputTokenMint: tokenBMint,
                observationState: observationState.publicKey,
            })
            .rpc();

        // Verify pool state after swap
        const poolStateAccount = await program.account.poolState.fetch(poolState);
        const expectedTokenAAmount = INITIAL_TOKEN_A_AMOUNT.add(SWAP_AMOUNT_IN);
        assert.equal(
            poolStateAccount.tokenAVaultAmount.toNumber(),
            expectedTokenAAmount.toNumber(),
            "Token A vault amount incorrect after swap"
        );

        // Verify user balances after swap
        const finalUserTokenABalance = await provider.connection.getTokenAccountBalance(userTokenAAccount);
        const finalUserTokenBBalance = await provider.connection.getTokenAccountBalance(userTokenBAccount);

        assert.isBelow(
            finalUserTokenABalance.value.uiAmount,
            initialUserTokenABalance.value.uiAmount,
            "User token A balance should decrease"
        );
        assert.isAbove(
            finalUserTokenBBalance.value.uiAmount,
            initialUserTokenBBalance.value.uiAmount,
            "User token B balance should increase"
        );
    });

    it("Fails with zero input amount", async () => {
        try {
            await program.methods
                .swapBaseInput(new BN(0), MINIMUM_AMOUNT_OUT)
                .accounts({
                    payer: wallet.publicKey,
                    authority,
                    ammConfig: Keypair.generate().publicKey,
                    poolState,
                    inputTokenAccount: userTokenAAccount,
                    outputTokenAccount: userTokenBAccount,
                    tokenAVault,
                    tokenBVault,
                    inputTokenProgram: TOKEN_PROGRAM_ID,
                    outputTokenProgram: TOKEN_PROGRAM_ID,
                    inputTokenMint: tokenAMint,
                    outputTokenMint: tokenBMint,
                    observationState: Keypair.generate().publicKey,
                })
                .rpc();
            assert.fail("Swap with zero amount should fail");
        } catch (err) {
            assert.include(err.toString(), "Amount cannot be zero");
        }
    });

    it("Fails with insufficient minimum amount out", async () => {
        const excessiveMinimumAmountOut = new BN(999999999);
        try {
            await program.methods
                .swapBaseInput(SWAP_AMOUNT_IN, excessiveMinimumAmountOut)
                .accounts({
                    payer: wallet.publicKey,
                    authority,
                    ammConfig: Keypair.generate().publicKey,
                    poolState,
                    inputTokenAccount: userTokenAAccount,
                    outputTokenAccount: userTokenBAccount,
                    tokenAVault,
                    tokenBVault,
                    inputTokenProgram: TOKEN_PROGRAM_ID,
                    outputTokenProgram: TOKEN_PROGRAM_ID,
                    inputTokenMint: tokenAMint,
                    outputTokenMint: tokenBMint,
                    observationState: Keypair.generate().publicKey,
                })
                .rpc();
            assert.fail("Swap with excessive minimum amount out should fail");
        } catch (err) {
            assert.include(err.toString(), "Output amount is less than minimum specified");
        }
    });
});