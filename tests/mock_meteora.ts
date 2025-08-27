import * as anchor from "@coral-xyz/anchor";
import { Program, BN, web3 } from "@coral-xyz/anchor";
import { MockMeteoraSwap } from "../target/types/mock_meteora_swap";
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

describe("mock-meteora-swap", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = anchor.workspace.MockMeteoraSwap as Program<MockMeteoraSwap>;
    const wallet = provider.wallet as anchor.Wallet;

    // Token mints and accounts
    let tokenXMint: PublicKey; // Legacy Token
    let tokenYMint: PublicKey; // Legacy Token
    let token2022XMint: PublicKey; // Token-2022
    let token2022YMint: PublicKey; // Token-2022
    let userTokenXAccount: PublicKey;
    let userTokenYAccount: PublicKey;
    let userToken2022XAccount: PublicKey;
    let userToken2022YAccount: PublicKey;

    // Pool states and authorities
    let lbPairTokenToToken: PublicKey;
    let lbPairTokenTo2022: PublicKey;
    let lbPair2022To2022: PublicKey;
    let lbPair2022ToToken: PublicKey;

    // Reserves
    let reserveXTokenToToken: PublicKey;
    let reserveYTokenToToken: PublicKey;
    let reserveXTokenTo2022: PublicKey;
    let reserveYTokenTo2022: PublicKey;
    let reserveX2022To2022: PublicKey;
    let reserveY2022To2022: PublicKey;
    let reserveX2022ToToken: PublicKey;
    let reserveY2022ToToken: PublicKey;

    // Oracles
    let oracleTokenToToken: PublicKey;
    let oracleTokenTo2022: PublicKey;
    let oracle2022To2022: PublicKey;
    let oracle2022ToToken: PublicKey;

    // Test constants
    const INITIAL_TOKEN_X_AMOUNT = new BN(1000000);
    const INITIAL_TOKEN_Y_AMOUNT = new BN(2000000);
    const SWAP_AMOUNT_IN = new BN(100000);
    const MIN_AMOUNT_OUT = new BN(180000);

    before(async () => {
        // Verify local validator is running
        try {
            await provider.connection.getVersion();
        } catch (err) {
            throw new Error("Local Solana validator not running. Start with `solana-test-validator`.");
        }

        // Create token mints (Legacy and Token-2022)
        tokenXMint = await createMint(
            provider.connection,
            wallet.payer,
            wallet.publicKey,
            null,
            6,
            undefined,
            undefined,
            TOKEN_PROGRAM_ID
        );
        tokenYMint = await createMint(
            provider.connection,
            wallet.payer,
            wallet.publicKey,
            null,
            6,
            undefined,
            undefined,
            TOKEN_PROGRAM_ID
        );
        token2022XMint = await createMint(
            provider.connection,
            wallet.payer,
            wallet.publicKey,
            null,
            6,
            undefined,
            undefined,
            TOKEN_2022_PROGRAM_ID
        );
        token2022YMint = await createMint(
            provider.connection,
            wallet.payer,
            wallet.publicKey,
            null,
            6,
            undefined,
            undefined,
            TOKEN_2022_PROGRAM_ID
        );

        // Derive lb_pair PDAs for each pool type
        [lbPairTokenToToken] = await PublicKey.findProgramAddress(
            [Buffer.from("lb_pair"), tokenXMint.toBuffer(), tokenYMint.toBuffer()],
            program.programId
        );
        [lbPairTokenTo2022] = await PublicKey.findProgramAddress(
            [Buffer.from("lb_pair"), tokenXMint.toBuffer(), token2022YMint.toBuffer()],
            program.programId
        );
        [lbPair2022To2022] = await PublicKey.findProgramAddress(
            [Buffer.from("lb_pair"), token2022XMint.toBuffer(), token2022YMint.toBuffer()],
            program.programId
        );
        [lbPair2022ToToken] = await PublicKey.findProgramAddress(
            [Buffer.from("lb_pair"), token2022XMint.toBuffer(), tokenYMint.toBuffer()],
            program.programId
        );

        // Derive oracle PDAs
        [oracleTokenToToken] = await PublicKey.findProgramAddress(
            [Buffer.from("oracle"), lbPairTokenToToken.toBuffer()],
            program.programId
        );
        [oracleTokenTo2022] = await PublicKey.findProgramAddress(
            [Buffer.from("oracle"), lbPairTokenTo2022.toBuffer()],
            program.programId
        );
        [oracle2022To2022] = await PublicKey.findProgramAddress(
            [Buffer.from("oracle"), lbPair2022To2022.toBuffer()],
            program.programId
        );
        [oracle2022ToToken] = await PublicKey.findProgramAddress(
            [Buffer.from("oracle"), lbPair2022ToToken.toBuffer()],
            program.programId
        );

        // Create user token accounts
        userTokenXAccount = await createAssociatedTokenAccount(
            provider.connection,
            wallet.payer,
            tokenXMint,
            wallet.publicKey,
            undefined,
            TOKEN_PROGRAM_ID
        );
        userTokenYAccount = await createAssociatedTokenAccount(
            provider.connection,
            wallet.payer,
            tokenYMint,
            wallet.publicKey,
            undefined,
            TOKEN_PROGRAM_ID
        );
        userToken2022XAccount = await createAssociatedTokenAccount(
            provider.connection,
            wallet.payer,
            token2022XMint,
            wallet.publicKey,
            undefined,
            TOKEN_2022_PROGRAM_ID
        );
        userToken2022YAccount = await createAssociatedTokenAccount(
            provider.connection,
            wallet.payer,
            token2022YMint,
            wallet.publicKey,
            undefined,
            TOKEN_2022_PROGRAM_ID
        );

        // Derive reserve token account addresses
        reserveXTokenToToken = await getAssociatedTokenAddress(
            tokenXMint,
            lbPairTokenToToken,
            true,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        reserveYTokenToToken = await getAssociatedTokenAddress(
            tokenYMint,
            lbPairTokenToToken,
            true,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        reserveXTokenTo2022 = await getAssociatedTokenAddress(
            tokenXMint,
            lbPairTokenTo2022,
            true,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        reserveYTokenTo2022 = await getAssociatedTokenAddress(
            token2022YMint,
            lbPairTokenTo2022,
            true,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        reserveX2022To2022 = await getAssociatedTokenAddress(
            token2022XMint,
            lbPair2022To2022,
            true,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        reserveY2022To2022 = await getAssociatedTokenAddress(
            token2022YMint,
            lbPair2022To2022,
            true,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        reserveX2022ToToken = await getAssociatedTokenAddress(
            token2022XMint,
            lbPair2022ToToken,
            true,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        reserveY2022ToToken = await getAssociatedTokenAddress(
            tokenYMint,
            lbPair2022ToToken,
            true,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );

        // Mint tokens with enough amounts for all tests
        const MINT_AMOUNT = INITIAL_TOKEN_X_AMOUNT.toNumber() * 10;

        await mintTo(
            provider.connection,
            wallet.payer,
            tokenXMint,
            userTokenXAccount,
            wallet.publicKey,
            MINT_AMOUNT,
            [],
            undefined,
            TOKEN_PROGRAM_ID
        );
        await mintTo(
            provider.connection,
            wallet.payer,
            tokenYMint,
            userTokenYAccount,
            wallet.publicKey,
            INITIAL_TOKEN_Y_AMOUNT.toNumber() * 10,
            [],
            undefined,
            TOKEN_PROGRAM_ID
        );
        await mintTo(
            provider.connection,
            wallet.payer,
            token2022XMint,
            userToken2022XAccount,
            wallet.publicKey,
            MINT_AMOUNT,
            [],
            undefined,
            TOKEN_2022_PROGRAM_ID
        );
        await mintTo(
            provider.connection,
            wallet.payer,
            token2022YMint,
            userToken2022YAccount,
            wallet.publicKey,
            INITIAL_TOKEN_Y_AMOUNT.toNumber() * 10,
            [],
            undefined,
            TOKEN_2022_PROGRAM_ID
        );
    });

    async function initializePool(
        lbPair: PublicKey,
        oracle: PublicKey,
        tokenXMint: PublicKey,
        tokenYMint: PublicKey,
        userTokenXAccount: PublicKey,
        userTokenYAccount: PublicKey,
        reserveX: PublicKey,
        reserveY: PublicKey,
        tokenXProgram: PublicKey,
        tokenYProgram: PublicKey
    ) {


        await program.methods
            .initializePool(INITIAL_TOKEN_X_AMOUNT, INITIAL_TOKEN_Y_AMOUNT)
            .accounts({
                user: wallet.publicKey,
                lbPair,
                userTokenX: userTokenXAccount,
                userTokenY: userTokenYAccount,
                reserveX,
                reserveY,
                oracle,
                tokenXMint,
                tokenYMint,
                tokenXProgram,
                tokenYProgram,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        // Verify lb_pair state
        const lbPairAccount = await program.account.lbPair.fetch(lbPair);
        assert.equal(
            lbPairAccount.reserveX.toBase58(),
            reserveX.toBase58(),
            "Reserve X mismatch"
        );
        assert.equal(
            lbPairAccount.reserveY.toBase58(),
            reserveY.toBase58(),
            "Reserve Y mismatch"
        );
        assert.equal(
            lbPairAccount.tokenXVaultAmount.toNumber(),
            INITIAL_TOKEN_X_AMOUNT.toNumber(),
            "Token X amount mismatch"
        );
        assert.equal(
            lbPairAccount.tokenYVaultAmount.toNumber(),
            INITIAL_TOKEN_Y_AMOUNT.toNumber(),
            "Token Y amount mismatch"
        );
    }

    async function performSwap(
        lbPair: PublicKey,
        oracle: PublicKey,
        reserveX: PublicKey,
        reserveY: PublicKey,
        userTokenInAccount: PublicKey,
        userTokenOutAccount: PublicKey,
        tokenXMint: PublicKey,
        tokenYMint: PublicKey,
        tokenXProgram: PublicKey,
        tokenYProgram: PublicKey
    ) {
        const remainingAccountsInfo = {
            slices: []
        };

        await program.methods
            .swap2(SWAP_AMOUNT_IN, MIN_AMOUNT_OUT, remainingAccountsInfo)
            .accounts({
                lbPair,
                binArrayBitmapExtension: Keypair.generate().publicKey,
                reserveX,
                reserveY,
                userTokenIn: userTokenInAccount,
                userTokenOut: userTokenOutAccount,
                tokenXMint,
                tokenYMint,
                oracle,
                hostFeeIn: Keypair.generate().publicKey,
                user: wallet.publicKey,
                tokenXProgram,
                tokenYProgram,
                memoProgram: Keypair.generate().publicKey,
                eventAuthority: (await PublicKey.findProgramAddress(
                    [Buffer.from("__event_authority")],
                    program.programId
                ))[0],
                program: SystemProgram.programId,
            })
            .rpc();
    }

    it("Initializes user token accounts", async () => {
        const newUser = Keypair.generate();
        const newUserTokenXAccount = await getAssociatedTokenAddress(
            tokenXMint,
            newUser.publicKey,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        const newUserTokenYAccount = await getAssociatedTokenAddress(
            tokenYMint,
            newUser.publicKey,
            false,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        const newUserToken2022XAccount = await getAssociatedTokenAddress(
            token2022XMint,
            newUser.publicKey,
            false,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        const newUserToken2022YAccount = await getAssociatedTokenAddress(
            token2022YMint,
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
                userTokenX: newUserTokenXAccount,
                userTokenY: newUserTokenYAccount,
                tokenXMint: tokenXMint,
                tokenYMint: tokenYMint,
                tokenXProgram: TOKEN_PROGRAM_ID,
                tokenYProgram: TOKEN_PROGRAM_ID,
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
                userTokenX: newUserToken2022XAccount,
                userTokenY: newUserToken2022YAccount,
                tokenXMint: token2022XMint,
                tokenYMint: token2022YMint,
                tokenXProgram: TOKEN_2022_PROGRAM_ID,
                tokenYProgram: TOKEN_2022_PROGRAM_ID,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
                rent: web3.SYSVAR_RENT_PUBKEY,
            })
            .signers([newUser])
            .rpc();
    });

    it("Initializes pool and swaps Token to Token", async () => {
        await initializePool(
            lbPairTokenToToken,
            oracleTokenToToken,
            tokenXMint,
            tokenYMint,
            userTokenXAccount,
            userTokenYAccount,
            reserveXTokenToToken,
            reserveYTokenToToken,
            TOKEN_PROGRAM_ID,
            TOKEN_PROGRAM_ID
        );

        await performSwap(
            lbPairTokenToToken,
            oracleTokenToToken,
            reserveXTokenToToken,
            reserveYTokenToToken,
            userTokenXAccount,
            userTokenYAccount,
            tokenXMint,
            tokenYMint,
            TOKEN_PROGRAM_ID,
            TOKEN_PROGRAM_ID
        );
    });

    it("Initializes pool and swaps Token to Token-2022", async () => {
        await initializePool(
            lbPairTokenTo2022,
            oracleTokenTo2022,
            tokenXMint,
            token2022YMint,
            userTokenXAccount,
            userToken2022YAccount,
            reserveXTokenTo2022,
            reserveYTokenTo2022,
            TOKEN_PROGRAM_ID,
            TOKEN_2022_PROGRAM_ID
        );

        await performSwap(
            lbPairTokenTo2022,
            oracleTokenTo2022,
            reserveXTokenTo2022,
            reserveYTokenTo2022,
            userTokenXAccount,
            userToken2022YAccount,
            tokenXMint,
            token2022YMint,
            TOKEN_PROGRAM_ID,
            TOKEN_2022_PROGRAM_ID
        );
    });

    it("Initializes pool and swaps Token-2022 to Token-2022", async () => {
        await initializePool(
            lbPair2022To2022,
            oracle2022To2022,
            token2022XMint,
            token2022YMint,
            userToken2022XAccount,
            userToken2022YAccount,
            reserveX2022To2022,
            reserveY2022To2022,
            TOKEN_2022_PROGRAM_ID,
            TOKEN_2022_PROGRAM_ID
        );

        await performSwap(
            lbPair2022To2022,
            oracle2022To2022,
            reserveX2022To2022,
            reserveY2022To2022,
            userToken2022XAccount,
            userToken2022YAccount,
            token2022XMint,
            token2022YMint,
            TOKEN_2022_PROGRAM_ID,
            TOKEN_2022_PROGRAM_ID
        );
    });

    it("Initializes pool and swaps Token-2022 to Token", async () => {
        await initializePool(
            lbPair2022ToToken,
            oracle2022ToToken,
            token2022XMint,
            tokenYMint,
            userToken2022XAccount,
            userTokenYAccount,
            reserveX2022ToToken,
            reserveY2022ToToken,
            TOKEN_2022_PROGRAM_ID,
            TOKEN_PROGRAM_ID
        );

        await performSwap(
            lbPair2022ToToken,
            oracle2022ToToken,
            reserveX2022ToToken,
            reserveY2022ToToken,
            userToken2022XAccount,
            userTokenYAccount,
            token2022XMint,
            tokenYMint,
            TOKEN_2022_PROGRAM_ID,
            TOKEN_PROGRAM_ID
        );
    });

    it("Fails with zero input amount (Token to Token)", async () => {
        const remainingAccountsInfo = { slices: [] };

        try {
            await program.methods
                .swap2(new BN(0), MIN_AMOUNT_OUT, remainingAccountsInfo)
                .accounts({
                    lbPair: lbPairTokenToToken,
                    binArrayBitmapExtension: Keypair.generate().publicKey,
                    reserveX: reserveXTokenToToken,
                    reserveY: reserveYTokenToToken,
                    userTokenIn: userTokenXAccount,
                    userTokenOut: userTokenYAccount,
                    tokenXMint,
                    tokenYMint,
                    oracle: oracleTokenToToken,
                    hostFeeIn: Keypair.generate().publicKey,
                    user: wallet.publicKey,
                    tokenXProgram: TOKEN_PROGRAM_ID,
                    tokenYProgram: TOKEN_PROGRAM_ID,
                    memoProgram: Keypair.generate().publicKey,
                    eventAuthority: (await PublicKey.findProgramAddress(
                        [Buffer.from("__event_authority")],
                        program.programId
                    ))[0],
                    program: SystemProgram.programId,
                })
                .rpc();
            assert.fail("Swap with zero amount should fail");
        } catch (err) {
            assert.include(err.toString(), "Amount cannot be zero");
        }
    });
});