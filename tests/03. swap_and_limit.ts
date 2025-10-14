import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, Transaction } from "@solana/web3.js";
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
import { assert } from "chai";
import { Flipper } from "../target/types/flipper";

describe("Flipper Swap Protocol - End to End Tests for Swaps and Limit Orders", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = anchor.workspace.Flipper as Program<Flipper>;

    // Shared variables
    let wallet: anchor.Wallet;
    let admin: Keypair;
    let user: Keypair;
    let treasury: Keypair;
    let vaultAuthority: PublicKey;
    let vaultAuthorityBump: number;
    let adapterRegistry: PublicKey;
    let adapterRegistryBump: number;
    let sourceMint: PublicKey;
    let intermediateMint: PublicKey;
    let destinationMint: PublicKey;
    let userSourceTokenAccount: PublicKey;
    let userIntermediateTokenAccount: PublicKey;
    let userDestinationTokenAccount: PublicKey;
    let inputVault: PublicKey;
    let intermediateVault: PublicKey;
    let outputVault: PublicKey;
    let platformFeeAccount: PublicKey;
    let mockRaydiumProgramId: PublicKey;
    let mockWhirlpoolProgramId: PublicKey;
    let mockMeteoraProgramId: PublicKey;
    let raydiumPoolInfo: PublicKey;
    let whirlpoolPoolInfo: PublicKey;
    let meteoraPoolInfo: PublicKey;
    let raydiumAmmConfig: PublicKey;
    let raydiumPoolState: PublicKey;
    let whirlpoolPoolState: PublicKey;
    let meteoraPoolState: PublicKey;
    let raydiumPoolAuthority: PublicKey;
    let raydiumTokenAVault: PublicKey;
    let raydiumTokenBVault: PublicKey;
    let raydiumObservationState: PublicKey;
    let whirlpoolTokenVaultA: PublicKey;
    let whirlpoolTokenVaultB: PublicKey;
    let whirlpoolOracle: PublicKey;
    let whirlpoolTickArray: PublicKey;
    let meteoraReserveX: PublicKey;
    let meteoraReserveY: PublicKey;
    let meteoraOracle: PublicKey;
    let meteoraBinArray: PublicKey;

    // Mock programs
    const mockRaydiumProgram = anchor.workspace.MockRaydium;
    const mockWhirlpoolProgram = anchor.workspace.MockWhirlpoolSwap;
    const mockMeteoraProgram = anchor.workspace.MockMeteoraSwap;

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

    before(async () => {
        wallet = provider.wallet as anchor.Wallet;
        admin = wallet.payer;
        user = Keypair.generate();
        treasury = Keypair.generate();

        // Fund user
        await provider.connection.requestAirdrop(user.publicKey, 10_000_000_000);
        await provider.connection.requestAirdrop(treasury.publicKey, 10_000_000_000);

        await new Promise(resolve => setTimeout(resolve, 1000));

        // PDAs
        [vaultAuthority, vaultAuthorityBump] = PublicKey.findProgramAddressSync([Buffer.from("vault_authority")], program.programId);

        // Fund vault_authority with SOL
        const fundTx = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: wallet.payer.publicKey,
                toPubkey: vaultAuthority,
                lamports: 10_000_000_000
            })
        );
        await provider.sendAndConfirm(fundTx, [wallet.payer]);

        [adapterRegistry, adapterRegistryBump] = PublicKey.findProgramAddressSync([Buffer.from("adapter_registry")], program.programId);

        // Create vault authority
        await program.methods
            .createVaultAuthority()
            .accounts({
                vaultAuthority,
                payer: wallet.publicKey,
                admin: admin.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([wallet.payer])
            .rpc();

        // Mints
        sourceMint = await createMint(provider.connection, wallet.payer, wallet.publicKey, null, 9, undefined, undefined, TOKEN_PROGRAM_ID);
        intermediateMint = await createMint(provider.connection, wallet.payer, wallet.publicKey, null, 9, undefined, undefined, TOKEN_PROGRAM_ID);
        destinationMint = await createMint(provider.connection, wallet.payer, wallet.publicKey, null, 9, undefined, undefined, TOKEN_PROGRAM_ID);

        // Vaults
        [inputVault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), sourceMint.toBuffer()], program.programId);
        [intermediateVault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), intermediateMint.toBuffer()], program.programId);
        [outputVault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), destinationMint.toBuffer()], program.programId);

        // Create vaults
        for (const [vault, mint] of [[inputVault, sourceMint], [intermediateVault, intermediateMint], [outputVault, destinationMint]]) {
            await program.methods
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
        }

        // User accounts
        userSourceTokenAccount = await createAssociatedTokenAccount(provider.connection, user, sourceMint, user.publicKey);
        userIntermediateTokenAccount = await createAssociatedTokenAccount(provider.connection, user, intermediateMint, user.publicKey);
        userDestinationTokenAccount = await createAssociatedTokenAccount(provider.connection, user, destinationMint, user.publicKey);

        // Mint to user and vaults
        await mintTo(provider.connection, wallet.payer, sourceMint, userSourceTokenAccount, wallet.publicKey, 1_000_000_000_000);
        await mintTo(provider.connection, wallet.payer, sourceMint, inputVault, wallet.publicKey, 1_000_000_000_000);
        await mintTo(provider.connection, wallet.payer, intermediateMint, intermediateVault, wallet.publicKey, 1_000_000_000_000);
        await mintTo(provider.connection, wallet.payer, destinationMint, outputVault, wallet.publicKey, 1_000_000_000_000);

        // Platform fee account
        const tokenAccount = await getOrCreateAssociatedTokenAccount(
            provider.connection,
            wallet.payer,
            destinationMint,
            vaultAuthority,
            true,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );



        platformFeeAccount = tokenAccount.address;

        // Setup mocks and adapters
        mockRaydiumProgramId = mockRaydiumProgram.programId;
        mockWhirlpoolProgramId = mockWhirlpoolProgram.programId;
        mockMeteoraProgramId = mockMeteoraProgram.programId;

        const raydiumAmmConfigKeypair = Keypair.generate();
        raydiumAmmConfig = raydiumAmmConfigKeypair.publicKey;

        await program.methods
            .initializeAdapterRegistry([], [])
            .accounts({
                adapterRegistry,
                payer: wallet.publicKey,
                operator: wallet.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([wallet.payer])
            .rpc();

        await program.methods
            .configureAdapter({ name: "raydium", programId: mockRaydiumProgramId, swapType: { raydium: {} } })
            .accounts({ adapterRegistry, operator: wallet.publicKey })
            .signers([wallet.payer])
            .rpc();
        await program.methods
            .configureAdapter({ name: "whirlpool", programId: mockWhirlpoolProgramId, swapType: { whirlpool: { aToB: true } } })
            .accounts({ adapterRegistry, operator: wallet.publicKey })
            .signers([wallet.payer])
            .rpc();
        await program.methods
            .configureAdapter({ name: "meteora", programId: mockMeteoraProgramId, swapType: { meteora: {} } })
            .accounts({ adapterRegistry, operator: wallet.publicKey })
            .signers([wallet.payer])
            .rpc();

        // Setup mock pools
        // Raydium: source -> destination
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

        // Derive vault accounts
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

        // Create observation state account
        const observationKeypair = Keypair.generate();
        raydiumObservationState = observationKeypair.publicKey;

        // Create user token accounts for pool
        const userTokenAAccount = await createAssociatedTokenAccount(
            provider.connection,
            wallet.payer,
            tokenAMint,
            wallet.publicKey,
            undefined,
            TOKEN_PROGRAM_ID
        );
        const userTokenBAccount = await createAssociatedTokenAccount(
            provider.connection,
            wallet.payer,
            tokenBMint,
            wallet.publicKey,
            undefined,
            TOKEN_PROGRAM_ID
        );

        // Mint tokens
        await mintTo(
            provider.connection,
            wallet.payer,
            tokenAMint,
            userTokenAAccount,
            wallet.publicKey,
            1_000_000_000_000,
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
            1_000_000_000_000,
            [],
            undefined,
            TOKEN_PROGRAM_ID
        );

        // Initialize pool
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

        [raydiumPoolInfo] = PublicKey.findProgramAddressSync(
            [Buffer.from("pool_info"), getSwapTypeBytes({ raydium: {} }), raydiumPoolState.toBuffer()],
            program.programId
        );
        await program.methods
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


        const poolStateAccount = await program.account.poolInfo.fetch(raydiumPoolInfo);

    });

    it("1. Simple single-hop swap with Raydium adapter", async () => {
        const inAmount = new BN(100_000_000);
        const quotedOutAmount = new BN(90_000_000);

        const slippageBps = 100;
        const platformFeeBps = 0;

        const routePlan = [{ swap: { raydium: {} }, percent: 100, inputIndex: 0, outputIndex: 13 }];


        const inputPoolVault = sourceMint.toString() < destinationMint.toString() ? raydiumTokenAVault : raydiumTokenBVault;

        const outputPoolVault = sourceMint.toString() < destinationMint.toString() ? raydiumTokenBVault : raydiumTokenAVault;

        const remainingAccounts = [
            { pubkey: inputVault, isWritable: true, isSigner: false }, // index 0: input_vault
            { pubkey: raydiumPoolInfo, isWritable: true, isSigner: false }, // index 1: pool_info
            { pubkey: raydiumPoolAuthority, isWritable: false, isSigner: false }, // index 2
            { pubkey: raydiumAmmConfig, isWritable: false, isSigner: false }, // index 3
            { pubkey: raydiumPoolState, isWritable: true, isSigner: false }, // index 4
            { pubkey: inputPoolVault, isWritable: true, isSigner: false }, // index 5
            { pubkey: outputPoolVault, isWritable: true, isSigner: false }, // index 6
            { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false }, // index 7
            { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false }, // index 8
            { pubkey: sourceMint, isWritable: false, isSigner: false }, // index 9
            { pubkey: destinationMint, isWritable: false, isSigner: false }, // index 10
            { pubkey: raydiumObservationState, isWritable: true, isSigner: false }, // index 11
            { pubkey: mockRaydiumProgramId, isWritable: false, isSigner: false }, // index 12:  program id
            { pubkey: outputVault, isWritable: true, isSigner: false }, // index 13: output vault
        ];

        const initialSource = (await getAccount(provider.connection, userSourceTokenAccount)).amount;
        const initialDest = (await getAccount(provider.connection, userDestinationTokenAccount)).amount;

        await program.methods
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

        const finalSource = (await getAccount(provider.connection, userSourceTokenAccount)).amount;
        const finalDest = (await getAccount(provider.connection, userDestinationTokenAccount)).amount;

        // Конвертируем BN в BigInt для операций
        const inAmountBN = BigInt(inAmount.toString());

        // Расчет ожидаемого выходного количества с учетом slippage
        const minOutAmount = quotedOutAmount.mul(new BN(10000 - slippageBps)).div(new BN(10000));
        const expectedOutAmount = BigInt(minOutAmount.toString());
        
        assert.equal(
            finalSource.toString(),
            (initialSource - inAmountBN).toString(),
            "Source balance incorrect"
        );

        assert(
            finalDest > (initialDest + expectedOutAmount),
            "Destination balance incorrect"
        );
    });
});