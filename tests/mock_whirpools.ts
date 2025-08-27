import * as anchor from "@coral-xyz/anchor";
import { Program, BN, web3 } from "@coral-xyz/anchor";
import { MockWhirlpoolSwap } from "../target/types/mock_whirlpool_swap";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    createMint,
    mintTo,
} from "@solana/spl-token";
import { assert } from "chai";

describe("mock-whirlpool-swap", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = anchor.workspace.MockWhirlpoolSwap as Program<MockWhirlpoolSwap>;
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
    let whirlpoolTokenToToken: PublicKey;
    let whirlpoolTokenTo2022: PublicKey;
    let whirlpool2022To2022: PublicKey;
    let whirlpool2022ToToken: PublicKey;

    // Test constants
    const INITIAL_TOKEN_A_AMOUNT = new BN(1000000);
    const INITIAL_TOKEN_B_AMOUNT = new BN(2000000);
    const SWAP_AMOUNT = new BN(100000);
    const OTHER_AMOUNT_THRESHOLD = new BN(180000);
    const SQRT_PRICE_LIMIT = new BN(4295048016);

    before(async () => {
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

        // Derive whirlpool PDAs for each pool
        [whirlpoolTokenToToken] = await PublicKey.findProgramAddress(
            [Buffer.from("whirlpool"), tokenAMint.toBuffer(), tokenBMint.toBuffer()],
            program.programId
        );
        [whirlpoolTokenTo2022] = await PublicKey.findProgramAddress(
            [Buffer.from("whirlpool"), tokenAMint.toBuffer(), token2022BMint.toBuffer()],
            program.programId
        );
        [whirlpool2022To2022] = await PublicKey.findProgramAddress(
            [Buffer.from("whirlpool"), token2022AMint.toBuffer(), token2022BMint.toBuffer()],
            program.programId
        );
        [whirlpool2022ToToken] = await PublicKey.findProgramAddress(
            [Buffer.from("whirlpool"), token2022AMint.toBuffer(), tokenBMint.toBuffer()],
            program.programId
        );

        // Derive user token account addresses (will be created by program)
        userTokenAAccount = await getAssociatedTokenAddress(
            tokenAMint,
            wallet.publicKey,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        userTokenBAccount = await getAssociatedTokenAddress(
            tokenBMint,
            wallet.publicKey,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        userToken2022AAccount = await getAssociatedTokenAddress(
            token2022AMint,
            wallet.publicKey,
            false,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        userToken2022BAccount = await getAssociatedTokenAddress(
            token2022BMint,
            wallet.publicKey,
            false,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        // Derive vault token account addresses
        tokenAVaultTokenToToken = await getAssociatedTokenAddress(
            tokenAMint,
            whirlpoolTokenToToken,
            true,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        tokenBVaultTokenToToken = await getAssociatedTokenAddress(
            tokenBMint,
            whirlpoolTokenToToken,
            true,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        tokenAVaultTokenTo2022 = await getAssociatedTokenAddress(
            tokenAMint,
            whirlpoolTokenTo2022,
            true,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        tokenBVaultTokenTo2022 = await getAssociatedTokenAddress(
            token2022BMint,
            whirlpoolTokenTo2022,
            true,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        tokenAVault2022To2022 = await getAssociatedTokenAddress(
            token2022AMint,
            whirlpool2022To2022,
            true,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        tokenBVault2022To2022 = await getAssociatedTokenAddress(
            token2022BMint,
            whirlpool2022To2022,
            true,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        tokenAVault2022ToToken = await getAssociatedTokenAddress(
            token2022AMint,
            whirlpool2022ToToken,
            true,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        tokenBVault2022ToToken = await getAssociatedTokenAddress(
            tokenBMint,
            whirlpool2022ToToken,
            true,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
    });

    async function createUserTokenAccountsAndMint(
        tokenMintA: PublicKey,
        tokenMintB: PublicKey,
        userTokenAAccount: PublicKey,
        userTokenBAccount: PublicKey,
        tokenProgramA: PublicKey,
        tokenProgramB: PublicKey
    ) {
        // Create user token accounts through our program
        await program.methods
            .initializeUserTokenAccounts()
            .accounts({
                user: wallet.publicKey,
                userTokenA: userTokenAAccount,
                userTokenB: userTokenBAccount,
                tokenMintA,
                tokenMintB,
                tokenProgramA,
                tokenProgramB,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                rent: web3.SYSVAR_RENT_PUBKEY,
            })
            .rpc();

        // Now mint tokens to the created accounts
        await mintTo(
            provider.connection,
            wallet.payer,
            tokenMintA,
            userTokenAAccount,
            wallet.publicKey,
            INITIAL_TOKEN_A_AMOUNT.toNumber() * 10,
            [],
            undefined,
            tokenProgramA
        );
        await mintTo(
            provider.connection,
            wallet.payer,
            tokenMintB,
            userTokenBAccount,
            wallet.publicKey,
            INITIAL_TOKEN_B_AMOUNT.toNumber() * 10,
            [],
            undefined,
            tokenProgramB
        );
    }

    async function initializePool(
        whirlpool: PublicKey,
        tokenMintA: PublicKey,
        tokenMintB: PublicKey,
        userTokenAAccount: PublicKey,
        userTokenBAccount: PublicKey,
        tokenVaultA: PublicKey,
        tokenVaultB: PublicKey,
        tokenProgramA: PublicKey,
        tokenProgramB: PublicKey
    ) {


        await program.methods
            .initializePool(INITIAL_TOKEN_A_AMOUNT, INITIAL_TOKEN_B_AMOUNT)
            .accounts({
                user: wallet.publicKey,
                whirlpool,
                userTokenA: userTokenAAccount,
                userTokenB: userTokenBAccount,
                tokenVaultA,
                tokenVaultB,
                tokenMintA,
                tokenMintB,
                tokenProgramA,
                tokenProgramB,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        // Verify whirlpool state
        const whirlpoolAccount = await program.account.whirlpool.fetch(whirlpool);
        assert.equal(
            whirlpoolAccount.tokenVaultA.toBase58(),
            tokenVaultA.toBase58(),
            "Token A vault mismatch"
        );
        assert.equal(
            whirlpoolAccount.tokenVaultB.toBase58(),
            tokenVaultB.toBase58(),
            "Token B vault mismatch"
        );

    }

    async function performSwap(
        whirlpool: PublicKey,
        tokenOwnerAccountA: PublicKey,
        tokenOwnerAccountB: PublicKey,
        tokenVaultA: PublicKey,
        tokenVaultB: PublicKey,
        tokenMintA: PublicKey,
        tokenProgramA: PublicKey,
        tokenMintB: PublicKey,
        tokenProgramB: PublicKey
    ) {
        const oracle = Keypair.generate();
        const initialInputBalance = await provider.connection.getTokenAccountBalance(tokenOwnerAccountA);
        const initialOutputBalance = await provider.connection.getTokenAccountBalance(tokenOwnerAccountB);

        await program.methods
            .swapV2(SWAP_AMOUNT, OTHER_AMOUNT_THRESHOLD, SQRT_PRICE_LIMIT, true, true, null)
            .accounts({
                tokenProgramA: tokenProgramA,
                tokenProgramB: tokenProgramB,
                memoProgram: Keypair.generate().publicKey,
                tokenAuthority: wallet.publicKey,
                whirlpool,
                tokenOwnerAccountA,
                tokenOwnerAccountB,
                tokenVaultA,
                tokenVaultB,
                oracle: oracle.publicKey,
                tokenMintA,
                tokenMintB,
            })
            .rpc();

        // Verify user balances after swap
        const finalInputBalance = await provider.connection.getTokenAccountBalance(tokenOwnerAccountA);
        const finalOutputBalance = await provider.connection.getTokenAccountBalance(tokenOwnerAccountB);
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
                tokenMintA: tokenAMint,
                tokenMintB: tokenBMint,
                tokenProgramA: TOKEN_PROGRAM_ID,
                tokenProgramB: TOKEN_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                rent: web3.SYSVAR_RENT_PUBKEY,
            })
            .signers([newUser])
            .rpc();

        // Initialize Token-2022 accounts
        await program.methods
            .initializeUserTokenAccounts()
            .accounts({
                user: newUser.publicKey,
                userTokenA: newUserToken2022AAccount,
                userTokenB: newUserToken2022BAccount,
                tokenMintA: token2022AMint,
                tokenMintB: token2022BMint,
                tokenProgramA: TOKEN_2022_PROGRAM_ID,
                tokenProgramB: TOKEN_2022_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                rent: web3.SYSVAR_RENT_PUBKEY,
            })
            .signers([newUser])
            .rpc();

        // Verify token accounts exist
        const userTokenABalance = await provider.connection.getTokenAccountBalance(newUserTokenAAccount);
        const userTokenBBalance = await provider.connection.getTokenAccountBalance(newUserTokenBAccount);
        const userToken2022ABalance = await provider.connection.getTokenAccountBalance(newUserToken2022AAccount);
        const userToken2022BBalance = await provider.connection.getTokenAccountBalance(newUserToken2022BAccount);

        assert.isNotNull(userTokenABalance);
        assert.isNotNull(userTokenBBalance);
        assert.isNotNull(userToken2022ABalance);
        assert.isNotNull(userToken2022BBalance);
    });

    it("Initializes pool and swaps Token to Token", async () => {
        // 1. First create user token accounts and mint tokens
        await createUserTokenAccountsAndMint(
            tokenAMint,
            tokenBMint,
            userTokenAAccount,
            userTokenBAccount,
            TOKEN_PROGRAM_ID,
            TOKEN_PROGRAM_ID
        );

        // 2. Then initialize pool
        await initializePool(
            whirlpoolTokenToToken,
            tokenAMint,
            tokenBMint,
            userTokenAAccount,
            userTokenBAccount,
            tokenAVaultTokenToToken,
            tokenBVaultTokenToToken,
            TOKEN_PROGRAM_ID,
            TOKEN_PROGRAM_ID,
            "Token to Token"
        );

        // 3. Finally perform swap
        await performSwap(
            whirlpoolTokenToToken,
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
        // Create user accounts if they don't exist yet
        try {
            await provider.connection.getTokenAccountBalance(userToken2022BAccount);
        } catch {
            await createUserTokenAccountsAndMint(
                tokenAMint,
                token2022BMint,
                userTokenAAccount,
                userToken2022BAccount,
                TOKEN_PROGRAM_ID,
                TOKEN_2022_PROGRAM_ID
            );
        }

        await initializePool(
            whirlpoolTokenTo2022,
            tokenAMint,
            token2022BMint,
            userTokenAAccount,
            userToken2022BAccount,
            tokenAVaultTokenTo2022,
            tokenBVaultTokenTo2022,
            TOKEN_PROGRAM_ID,
            TOKEN_2022_PROGRAM_ID,
            "Token to Token-2022"
        );

        await performSwap(
            whirlpoolTokenTo2022,
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
        // Create user accounts for Token-2022
        try {
            await provider.connection.getTokenAccountBalance(userToken2022AAccount);
        } catch {
            await createUserTokenAccountsAndMint(
                token2022AMint,
                token2022BMint,
                userToken2022AAccount,
                userToken2022BAccount,
                TOKEN_2022_PROGRAM_ID,
                TOKEN_2022_PROGRAM_ID
            );
        }

        await initializePool(
            whirlpool2022To2022,
            token2022AMint,
            token2022BMint,
            userToken2022AAccount,
            userToken2022BAccount,
            tokenAVault2022To2022,
            tokenBVault2022To2022,
            TOKEN_2022_PROGRAM_ID,
            TOKEN_2022_PROGRAM_ID,
            "Token-2022 to Token-2022"
        );

        await performSwap(
            whirlpool2022To2022,
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
        // Create mixed accounts if needed
        try {
            await provider.connection.getTokenAccountBalance(userToken2022AAccount);
        } catch {
            await createUserTokenAccountsAndMint(
                token2022AMint,
                tokenBMint,
                userToken2022AAccount,
                userTokenBAccount,
                TOKEN_2022_PROGRAM_ID,
                TOKEN_PROGRAM_ID
            );
        }

        await initializePool(
            whirlpool2022ToToken,
            token2022AMint,
            tokenBMint,
            userToken2022AAccount,
            userTokenBAccount,
            tokenAVault2022ToToken,
            tokenBVault2022ToToken,
            TOKEN_2022_PROGRAM_ID,
            TOKEN_PROGRAM_ID,
            "Token-2022 to Token"
        );

        await performSwap(
            whirlpool2022ToToken,
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
                .swapV2(new BN(0), OTHER_AMOUNT_THRESHOLD, SQRT_PRICE_LIMIT, true, true, null)
                .accounts({
                    tokenProgramA: TOKEN_PROGRAM_ID,
                    tokenProgramB: TOKEN_PROGRAM_ID,
                    memoProgram: Keypair.generate().publicKey,
                    tokenAuthority: wallet.publicKey,
                    whirlpool: whirlpoolTokenToToken,
                    tokenOwnerAccountA: userTokenAAccount,
                    tokenOwnerAccountB: userTokenBAccount,
                    tokenVaultA: tokenAVaultTokenToToken,
                    tokenVaultB: tokenBVaultTokenToToken,
                    oracle: Keypair.generate().publicKey,
                    tokenMintA: tokenAMint,
                    tokenMintB: tokenBMint,
                })
                .rpc();
            assert.fail("Swap with zero amount should fail");
        } catch (err) {
            assert.include(err.toString(), "Amount cannot be zero");
        }
    });

    it("Fails with insufficient minimum amount out (Token to Token)", async () => {
        const excessiveThreshold = new BN(999999999);
        try {
            await program.methods
                .swapV2(SWAP_AMOUNT, excessiveThreshold, SQRT_PRICE_LIMIT, true, true, null)
                .accounts({
                    tokenProgramA: TOKEN_PROGRAM_ID,
                    tokenProgramB: TOKEN_PROGRAM_ID,
                    memoProgram: Keypair.generate().publicKey,
                    tokenAuthority: wallet.publicKey,
                    whirlpool: whirlpoolTokenToToken,
                    tokenOwnerAccountA: userTokenAAccount,
                    tokenOwnerAccountB: userTokenBAccount,
                    tokenVaultA: tokenAVaultTokenToToken,
                    tokenVaultB: tokenBVaultTokenToToken,
                    oracle: Keypair.generate().publicKey,
                    tokenMintA: tokenAMint,
                    tokenMintB: tokenBMint,
                })
                .rpc();
            assert.fail("Swap with excessive minimum amount out should fail");
        } catch (err) {
            assert.include(err.toString(), "Output amount is less than minimum specified");
        }
    });
});