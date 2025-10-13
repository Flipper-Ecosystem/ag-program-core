import * as anchor from "@coral-xyz/anchor";
import { Program, BN, web3 } from "@coral-xyz/anchor";
import { MockRaydiumSwap } from "../target/types/mock_raydium_swap";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    createMint,
    mintTo,
    createAssociatedTokenAccount,
} from "@solana/spl-token";
import { assert } from "chai";

describe("mock-raydium-swap", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = anchor.workspace.MockRaydiumSwap as Program<MockRaydiumSwap>;
    const wallet = provider.wallet as anchor.Wallet;

    // Token mints and accounts
    let tokenAMint: PublicKey; // Legacy Token
    let tokenBMint: PublicKey; // Legacy Token
    let token2022AMint: PublicKey; // Token-2022
    let token2022BMint: PublicKey; // Token-2022
    let userTokenAAccount: PublicKey;
    let userTokenBAccount: PublicKey;
    let userToken2022AAccount: PublicKey;
    let userToken2022BAccount: PublicKey;
    let tokenAVaultTokenToToken: PublicKey;
    let tokenBVaultTokenToToken: PublicKey;
    let tokenAVaultTokenTo2022: PublicKey;
    let tokenBVaultTokenTo2022: PublicKey;
    let tokenAVault2022To2022: PublicKey;
    let tokenBVault2022To2022: PublicKey;
    let tokenAVault2022ToToken: PublicKey;
    let tokenBVault2022ToToken: PublicKey;
    let poolStateTokenToToken: PublicKey;
    let poolStateTokenTo2022: PublicKey;
    let poolState2022To2022: PublicKey;
    let poolState2022ToToken: PublicKey;
    let authorityTokenToToken: PublicKey;
    let authorityTokenTo2022: PublicKey;
    let authority2022To2022: PublicKey;
    let authority2022ToToken: PublicKey;

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

        // Create token mints (Legacy and Token-2022)
        tokenAMint = await createMint(
            provider.connection,
            wallet.payer,
            wallet.publicKey,
            null,
            6,
            undefined,
            undefined,
            TOKEN_PROGRAM_ID
        );
        tokenBMint = await createMint(
            provider.connection,
            wallet.payer,
            wallet.publicKey,
            null,
            6,
            undefined,
            undefined,
            TOKEN_PROGRAM_ID
        );
        token2022AMint = await createMint(
            provider.connection,
            wallet.payer,
            wallet.publicKey,
            null,
            6,
            undefined,
            undefined,
            TOKEN_2022_PROGRAM_ID
        );
        token2022BMint = await createMint(
            provider.connection,
            wallet.payer,
            wallet.publicKey,
            null,
            6,
            undefined,
            undefined,
            TOKEN_2022_PROGRAM_ID
        );

        // Derive pool state and authority PDAs for each pool
        [poolStateTokenToToken] = PublicKey.findProgramAddressSync(
            [Buffer.from("pool_state"), tokenAMint.toBuffer(), tokenBMint.toBuffer()],
            program.programId
        );
        [authorityTokenToToken] = PublicKey.findProgramAddressSync(
            [Buffer.from("authority"), poolStateTokenToToken.toBuffer()],
            program.programId
        );

        [poolStateTokenTo2022] = PublicKey.findProgramAddressSync(
            [Buffer.from("pool_state"), tokenAMint.toBuffer(), token2022BMint.toBuffer()],
            program.programId
        );
        [authorityTokenTo2022] = PublicKey.findProgramAddressSync(
            [Buffer.from("authority"), poolStateTokenTo2022.toBuffer()],
            program.programId
        );

        [poolState2022To2022] = PublicKey.findProgramAddressSync(
            [Buffer.from("pool_state"), token2022AMint.toBuffer(), token2022BMint.toBuffer()],
            program.programId
        );
        [authority2022To2022] = PublicKey.findProgramAddressSync(
            [Buffer.from("authority"), poolState2022To2022.toBuffer()],
            program.programId
        );

        [poolState2022ToToken] = PublicKey.findProgramAddressSync(
            [Buffer.from("pool_state"), token2022AMint.toBuffer(), tokenBMint.toBuffer()],
            program.programId
        );
        [authority2022ToToken] = PublicKey.findProgramAddressSync(
            [Buffer.from("authority"), poolState2022ToToken.toBuffer()],
            program.programId
        );

        // Create user token accounts
        userTokenAAccount = await createAssociatedTokenAccount(
            provider.connection,
            wallet.payer,
            tokenAMint,
            wallet.publicKey,
            undefined,
            TOKEN_PROGRAM_ID
        );
        userTokenBAccount = await createAssociatedTokenAccount(
            provider.connection,
            wallet.payer,
            tokenBMint,
            wallet.publicKey,
            undefined,
            TOKEN_PROGRAM_ID
        );
        userToken2022AAccount = await createAssociatedTokenAccount(
            provider.connection,
            wallet.payer,
            token2022AMint,
            wallet.publicKey,
            undefined,
            TOKEN_2022_PROGRAM_ID
        );
        userToken2022BAccount = await createAssociatedTokenAccount(
            provider.connection,
            wallet.payer,
            token2022BMint,
            wallet.publicKey,
            undefined,
            TOKEN_2022_PROGRAM_ID
        );

        // Derive vault token account addresses (created by program via init_if_needed)
        tokenAVaultTokenToToken = await getAssociatedTokenAddress(
            tokenAMint,
            authorityTokenToToken,
            true,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        tokenBVaultTokenToToken = await getAssociatedTokenAddress(
            tokenBMint,
            authorityTokenToToken,
            true,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        tokenAVaultTokenTo2022 = await getAssociatedTokenAddress(
            tokenAMint,
            authorityTokenTo2022,
            true,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        tokenBVaultTokenTo2022 = await getAssociatedTokenAddress(
            token2022BMint,
            authorityTokenTo2022,
            true,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        tokenAVault2022To2022 = await getAssociatedTokenAddress(
            token2022AMint,
            authority2022To2022,
            true,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        tokenBVault2022To2022 = await getAssociatedTokenAddress(
            token2022BMint,
            authority2022To2022,
            true,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        tokenAVault2022ToToken = await getAssociatedTokenAddress(
            token2022AMint,
            authority2022ToToken,
            true,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        tokenBVault2022ToToken = await getAssociatedTokenAddress(
            tokenBMint,
            authority2022ToToken,
            true,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        // Mint tokens with enough amounts for all tests including multiple pool initializations
        const MINT_AMOUNT = INITIAL_TOKEN_A_AMOUNT.toNumber() * 10; // Увеличиваем количество

        await mintTo(
            provider.connection,
            wallet.payer,
            tokenAMint,
            userTokenAAccount,
            wallet.publicKey,
            MINT_AMOUNT,
            [],
            undefined,
            TOKEN_PROGRAM_ID
        );
        await mintTo(
            provider.connection,
            wallet.payer,
            tokenBMint,
            userTokenBAccount,
            wallet.publicKey,
            INITIAL_TOKEN_B_AMOUNT.toNumber() * 10,
            [],
            undefined,
            TOKEN_PROGRAM_ID
        );
        await mintTo(
            provider.connection,
            wallet.payer,
            token2022AMint,
            userToken2022AAccount,
            wallet.publicKey,
            MINT_AMOUNT,
            [],
            undefined,
            TOKEN_2022_PROGRAM_ID
        );
        await mintTo(
            provider.connection,
            wallet.payer,
            token2022BMint,
            userToken2022BAccount,
            wallet.publicKey,
            INITIAL_TOKEN_B_AMOUNT.toNumber() * 10,
            [],
            undefined,
            TOKEN_2022_PROGRAM_ID
        );

    });

    async function initializePool(
        poolState: PublicKey,
        authority: PublicKey,
        tokenAMint: PublicKey,
        tokenBMint: PublicKey,
        userTokenAAccount: PublicKey,
        userTokenBAccount: PublicKey,
        tokenAVault: PublicKey,
        tokenBVault: PublicKey,
        tokenAProgram: PublicKey,
        tokenBProgram: PublicKey,
    ) {
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
                tokenAProgram,
                tokenBProgram,
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
    }

    async function performSwap(
        poolState: PublicKey,
        authority: PublicKey,
        inputTokenAccount: PublicKey,
        outputTokenAccount: PublicKey,
        tokenAVault: PublicKey,
        tokenBVault: PublicKey,
        inputTokenMint: PublicKey,
        inputTokenProgram: PublicKey,
        outputTokenMint: PublicKey,
        outputTokenProgram: PublicKey
    ) {
        const observationState = Keypair.generate();
        const initialInputBalance = await provider.connection.getTokenAccountBalance(inputTokenAccount);
        const initialOutputBalance = await provider.connection.getTokenAccountBalance(outputTokenAccount);

        await program.methods
            .swapBaseInput(SWAP_AMOUNT_IN, MINIMUM_AMOUNT_OUT)
            .accounts({
                payer: wallet.publicKey,
                authority,
                ammConfig: Keypair.generate().publicKey,
                poolState,
                inputTokenAccount,
                outputTokenAccount,
                tokenAVault,
                tokenBVault,
                inputTokenProgram,
                outputTokenProgram,
                inputTokenMint,
                outputTokenMint,
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
        const finalInputBalance = await provider.connection.getTokenAccountBalance(inputTokenAccount);
        const finalOutputBalance = await provider.connection.getTokenAccountBalance(outputTokenAccount);
        assert.isBelow(
            finalInputBalance.value.uiAmount,
            initialInputBalance.value.uiAmount,
            "Input token balance should decrease"
        );
        assert.isAbove(
            finalOutputBalance.value.uiAmount,
            initialOutputBalance.value.uiAmount,
            "Output token balance should increase"
        );
    }

    it("Initializes user token accounts", async () => {
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
        const newUserToken2022AAccount = await getAssociatedTokenAddress(
            token2022AMint,
            newUser.publicKey,
            false,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        const newUserToken2022BAccount = await getAssociatedTokenAddress(
            token2022BMint,
            newUser.publicKey,
            false,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        // Fund the new user with SOL
        const fundTx = new web3.Transaction().add(
            web3.SystemProgram.transfer({
                fromPubkey: wallet.publicKey,
                toPubkey: newUser.publicKey,
                lamports: web3.LAMPORTS_PER_SOL,
            })
        );
        await provider.sendAndConfirm(fundTx, [wallet.payer]);

        // Initialize legacy token accounts
        await program.methods
            .initializeUserTokenAccounts()
            .accounts({
                user: newUser.publicKey,
                userTokenA: newUserTokenAAccount,
                userTokenB: newUserTokenBAccount,
                tokenAMint: tokenAMint,
                tokenBMint: tokenBMint,
                tokenAProgram: TOKEN_PROGRAM_ID,
                tokenBProgram: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                rent: web3.SYSVAR_RENT_PUBKEY,
            })
            .signers([newUser])
            .rpc();

        // Verify legacy token accounts
        const userTokenABalance = await provider.connection.getTokenAccountBalance(newUserTokenAAccount);
        const userTokenBBalance = await provider.connection.getTokenAccountBalance(newUserTokenBAccount);
        assert.isNotNull(userTokenABalance, "User token A account not found");
        assert.isNotNull(userTokenBBalance, "User token B account not found");

        // Initialize Token-2022 accounts
        await program.methods
            .initializeUserTokenAccounts()
            .accounts({
                user: newUser.publicKey,
                userTokenA: newUserToken2022AAccount,
                userTokenB: newUserToken2022BAccount,
                tokenAMint: token2022AMint,
                tokenBMint: token2022BMint,
                tokenAProgram: TOKEN_2022_PROGRAM_ID,
                tokenBProgram: TOKEN_2022_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                rent: web3.SYSVAR_RENT_PUBKEY,
            })
            .signers([newUser])
            .rpc();

        // Verify Token-2022 accounts
        const userToken2022ABalance = await provider.connection.getTokenAccountBalance(newUserToken2022AAccount);
        const userToken2022BBalance = await provider.connection.getTokenAccountBalance(newUserToken2022BAccount);
        assert.isNotNull(userToken2022ABalance, "User Token-2022 A account not found");
        assert.isNotNull(userToken2022BBalance, "User Token-2022 B account not found");
    });

    it("Initializes pool and swaps Token to Token", async () => {
        await initializePool(
            poolStateTokenToToken,
            authorityTokenToToken,
            tokenAMint,
            tokenBMint,
            userTokenAAccount,
            userTokenBAccount,
            tokenAVaultTokenToToken,
            tokenBVaultTokenToToken,
            TOKEN_PROGRAM_ID,
            TOKEN_PROGRAM_ID
        );

        await performSwap(
            poolStateTokenToToken,
            authorityTokenToToken,
            userTokenAAccount,
            userTokenBAccount,
            tokenAVaultTokenToToken,
            tokenBVaultTokenToToken,
            tokenAMint,
            TOKEN_PROGRAM_ID,
            tokenBMint,
            TOKEN_PROGRAM_ID
        );
    });

    it("Initializes pool and swaps Token to Token-2022", async () => {
        await initializePool(
            poolStateTokenTo2022,
            authorityTokenTo2022,
            tokenAMint,
            token2022BMint,
            userTokenAAccount,
            userToken2022BAccount,
            tokenAVaultTokenTo2022,
            tokenBVaultTokenTo2022,
            TOKEN_PROGRAM_ID,
            TOKEN_2022_PROGRAM_ID
        );

        await performSwap(
            poolStateTokenTo2022,
            authorityTokenTo2022,
            userTokenAAccount,
            userToken2022BAccount,
            tokenAVaultTokenTo2022,
            tokenBVaultTokenTo2022,
            tokenAMint,
            TOKEN_PROGRAM_ID,
            token2022BMint,
            TOKEN_2022_PROGRAM_ID
        );
    });

    it("Initializes pool and swaps Token-2022 to Token-2022", async () => {
        await initializePool(
            poolState2022To2022,
            authority2022To2022,
            token2022AMint,
            token2022BMint,
            userToken2022AAccount,
            userToken2022BAccount,
            tokenAVault2022To2022,
            tokenBVault2022To2022,
            TOKEN_2022_PROGRAM_ID,
            TOKEN_2022_PROGRAM_ID
        );

        await performSwap(
            poolState2022To2022,
            authority2022To2022,
            userToken2022AAccount,
            userToken2022BAccount,
            tokenAVault2022To2022,
            tokenBVault2022To2022,
            token2022AMint,
            TOKEN_2022_PROGRAM_ID,
            token2022BMint,
            TOKEN_2022_PROGRAM_ID
        );
    });

    it("Initializes pool and swaps Token-2022 to Token", async () => {
        await initializePool(
            poolState2022ToToken,
            authority2022ToToken,
            token2022AMint,
            tokenBMint,
            userToken2022AAccount,
            userTokenBAccount,
            tokenAVault2022ToToken,
            tokenBVault2022ToToken,
            TOKEN_2022_PROGRAM_ID,
            TOKEN_PROGRAM_ID
        );

        await performSwap(
            poolState2022ToToken,
            authority2022ToToken,
            userToken2022AAccount,
            userTokenBAccount,
            tokenAVault2022ToToken,
            tokenBVault2022ToToken,
            token2022AMint,
            TOKEN_2022_PROGRAM_ID,
            tokenBMint,
            TOKEN_PROGRAM_ID
        );
    });

    it("Fails with zero input amount (Token to Token)", async () => {
        try {
            await program.methods
                .swapBaseInput(new BN(0), MINIMUM_AMOUNT_OUT)
                .accounts({
                    payer: wallet.publicKey,
                    authority: authorityTokenToToken,
                    ammConfig: Keypair.generate().publicKey,
                    poolState: poolStateTokenToToken,
                    inputTokenAccount: userTokenAAccount,
                    outputTokenAccount: userTokenBAccount,
                    tokenAVault: tokenAVaultTokenToToken,
                    tokenBVault: tokenBVaultTokenToToken,
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

    it("Fails with insufficient minimum amount out (Token to Token)", async () => {
        const excessiveMinimumAmountOut = new BN(999999999);
        try {
            await program.methods
                .swapBaseInput(SWAP_AMOUNT_IN, excessiveMinimumAmountOut)
                .accounts({
                    payer: wallet.publicKey,
                    authority: authorityTokenToToken,
                    ammConfig: Keypair.generate().publicKey,
                    poolState: poolStateTokenToToken,
                    inputTokenAccount: userTokenAAccount,
                    outputTokenAccount: userTokenBAccount,
                    tokenAVault: tokenAVaultTokenToToken,
                    tokenBVault: tokenBVaultTokenToToken,
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