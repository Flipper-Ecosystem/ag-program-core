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

describe("Flipper Swap Protocol - Whirlpools Swap and Limit Orders", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = anchor.workspace.Flipper as Program<Flipper>;

    let wallet: anchor.Wallet;
    let user: Keypair;
    let operator: Keypair;
    let vaultAuthority: PublicKey;
    let adapterRegistry: PublicKey;
    let sourceMint: PublicKey;
    let intermediateMint: PublicKey;
    let userSourceTokenAccount: PublicKey;
    let userIntermediateTokenAccount: PublicKey;
    let inputVault: PublicKey;
    let intermediateVault: PublicKey;
    let platformFeeAccount: PublicKey;
    let mockWhirlpoolProgramId: PublicKey;

    const mockWhirlpoolProgram = anchor.workspace.MockWhirlpoolSwap;

    function getSwapTypeBytes(swapType: any): Buffer {
        const bytes = Buffer.alloc(32, 0);
        if ("whirlpool" in swapType) {
            bytes[0] = 17;
            bytes[1] = swapType.whirlpool.aToB ? 1 : 0;
        }
        return bytes;
    }

    before(async () => {
        wallet = provider.wallet as anchor.Wallet;
        user = Keypair.generate();
        operator = Keypair.generate();

        // Fund accounts
        await provider.connection.requestAirdrop(user.publicKey, 10_000_000_000);
        await provider.connection.requestAirdrop(operator.publicKey, 10_000_000_000);
        await new Promise(resolve => setTimeout(resolve, 1000));

        // PDAs
        [vaultAuthority] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault_authority")],
            program.programId
        );

        [adapterRegistry] = PublicKey.findProgramAddressSync(
            [Buffer.from("adapter_registry")],
            program.programId
        );

        // Check if vault_authority already exists
        const vaultAuthorityInfo = await provider.connection.getAccountInfo(vaultAuthority);
        if (!vaultAuthorityInfo) {
            // Create vault authority only if it doesn't exist
            await program.methods
                .createVaultAuthority()
                .accounts({
                    vaultAuthority,
                    payer: wallet.publicKey,
                    admin: wallet.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([wallet.payer])
                .rpc();
            //console.log("✓ Vault authority created");
        } else {
            //console.log("✓ Vault authority already exists");
        }

        // Create mints
        sourceMint = await createMint(
            provider.connection,
            wallet.payer,
            wallet.publicKey,
            null,
            9,
            undefined,
            undefined,
            TOKEN_PROGRAM_ID
        );

        intermediateMint = await createMint(
            provider.connection,
            wallet.payer,
            wallet.publicKey,
            null,
            9,
            undefined,
            undefined,
            TOKEN_PROGRAM_ID
        );

        // Create vaults
        [inputVault] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault"), sourceMint.toBuffer()],
            program.programId
        );

        [intermediateVault] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault"), intermediateMint.toBuffer()],
            program.programId
        );

        // Create vaults
        for (const [vault, mint] of [[inputVault, sourceMint], [intermediateVault, intermediateMint]]) {
            await program.methods
                .createVault()
                .accounts({
                    vaultAuthority,
                    payer: wallet.publicKey,
                    admin: wallet.publicKey,
                    vault,
                    vaultMint: mint,
                    vaultTokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([wallet.payer])
                .rpc();
        }

        // User accounts
        userSourceTokenAccount = await createAssociatedTokenAccount(
            provider.connection,
            user,
            sourceMint,
            user.publicKey
        );

        userIntermediateTokenAccount = await createAssociatedTokenAccount(
            provider.connection,
            user,
            intermediateMint,
            user.publicKey
        );

        // Mint tokens to user and vaults
        await mintTo(
            provider.connection,
            wallet.payer,
            sourceMint,
            userSourceTokenAccount,
            wallet.publicKey,
            1_000_000_000_000
        );

        await mintTo(
            provider.connection,
            wallet.payer,
            sourceMint,
            inputVault,
            wallet.publicKey,
            1_000_000_000_000
        );

        await mintTo(
            provider.connection,
            wallet.payer,
            intermediateMint,
            intermediateVault,
            wallet.publicKey,
            1_000_000_000_000
        );

        // Platform fee account
        const tokenAccount = await getOrCreateAssociatedTokenAccount(
            provider.connection,
            wallet.payer,
            intermediateMint,
            vaultAuthority,
            true,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        platformFeeAccount = tokenAccount.address;

        // Setup adapter registry
        mockWhirlpoolProgramId = mockWhirlpoolProgram.programId;

        // Check if adapter registry exists
        const registryInfo = await provider.connection.getAccountInfo(adapterRegistry);
        if (!registryInfo) {
            // Include wallet.publicKey in the operators list during initialization
            await program.methods
                .initializeAdapterRegistry([], [operator.publicKey, wallet.publicKey])
                .accounts({
                    adapterRegistry,
                    payer: wallet.publicKey,
                    operator: wallet.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([wallet.payer])
                .rpc();
            //console.log("✓ Adapter registry initialized");
        } else {
            //console.log("✓ Adapter registry already exists");

            // If registry exists, we might need to add wallet as operator
            try {
                const registryAccount = await program.account.adapterRegistry.fetch(adapterRegistry);
                const isOperator = registryAccount.operators.some(
                    (op: PublicKey) => op.equals(wallet.publicKey)
                );

                if (!isOperator) {
                    //console.log("⚠ Wallet is not an operator, attempting to add...");
                    await program.methods
                        .addOperator(wallet.publicKey)
                        .accounts({
                            adapterRegistry,
                            authority: wallet.publicKey,
                        })
                        .signers([wallet.payer])
                        .rpc();
                    //console.log("✓ Wallet added as operator");
                }
            } catch (e) {
                //console.log("Note: Could not verify/add operator status:", e.message);
            }
        }

        // Configure whirlpool adapter
        await program.methods
            .configureAdapter({
                name: "whirlpool",
                programId: mockWhirlpoolProgramId,
                swapType: { whirlpool: { aToB: true } }
            })
            .accounts({
                adapterRegistry,
                operator: wallet.publicKey
            })
            .signers([wallet.payer])
            .rpc();


        // Configure whirlpool adapter
        await program.methods
            .configureAdapter({
                name: "whirlpool",
                programId: mockWhirlpoolProgramId,
                swapType: { whirlpool: { aToB: false } }
            })
            .accounts({
                adapterRegistry,
                operator: wallet.publicKey
            })
            .signers([wallet.payer])
            .rpc();

        //console.log("✓ Whirlpool adapter configured");
    });

    it("1. Single-hop swap with Whirlpool adapter (with supplemental tick arrays)", async () => {
        // ФИКСИРУЕМ направление: всегда свапаем A->B (aToB = true)
        // Для этого sourceMint должен быть меньше intermediateMint

        // Пересоздаем минты если нужно, чтобы sourceMint < intermediateMint
        let actualSourceMint = sourceMint;
        let actualIntermediateMint = intermediateMint;
        let actualInputVault = inputVault;
        let actualIntermediateVault = intermediateVault;
        let actualUserSourceTokenAccount = userSourceTokenAccount;
        let actualUserIntermediateTokenAccount = userIntermediateTokenAccount;

        // Если порядок неправильный, меняем местами
        if (sourceMint.toString() > intermediateMint.toString()) {
            //console.log("Swapping source and intermediate to ensure A->B direction");
            actualSourceMint = intermediateMint;
            actualIntermediateMint = sourceMint;
            actualInputVault = intermediateVault;
            actualIntermediateVault = inputVault;
            actualUserSourceTokenAccount = userIntermediateTokenAccount;
            actualUserIntermediateTokenAccount = userSourceTokenAccount;
        }

        const tokenAMint = actualSourceMint;
        const tokenBMint = actualIntermediateMint;


        const tokenAccount = await getOrCreateAssociatedTokenAccount(
            provider.connection,
            wallet.payer,
            actualIntermediateMint,
            vaultAuthority,
            true,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
        );
        
        platformFeeAccount = tokenAccount.address;

        const aToB = true; // Всегда A->B

        //console.log(`Swap direction: A->B (FIXED)`);
        //console.log(`Source mint (swapping FROM):`, actualSourceMint.toString());
        //console.log(`Intermediate mint (swapping TO):`, actualIntermediateMint.toString());
        //console.log(`Token A:`, tokenAMint.toString());
        //console.log(`Token B:`, tokenBMint.toString());

        const [whirlpoolPoolState] = PublicKey.findProgramAddressSync(
            [Buffer.from("whirlpool"), tokenAMint.toBuffer(), tokenBMint.toBuffer()],
            mockWhirlpoolProgramId
        );

        // Derive all tick array addresses
        const [tickArray0] = PublicKey.findProgramAddressSync(
            [Buffer.from("tick_array"), whirlpoolPoolState.toBuffer(), Buffer.from(new Int32Array([-100]).buffer)],
            mockWhirlpoolProgramId
        );
        const [tickArray1] = PublicKey.findProgramAddressSync(
            [Buffer.from("tick_array"), whirlpoolPoolState.toBuffer(), Buffer.from(new Int32Array([0]).buffer)],
            mockWhirlpoolProgramId
        );
        const [tickArray2] = PublicKey.findProgramAddressSync(
            [Buffer.from("tick_array"), whirlpoolPoolState.toBuffer(), Buffer.from(new Int32Array([100]).buffer)],
            mockWhirlpoolProgramId
        );

        // Supplemental tick arrays
        const [supplementalTickArray0] = PublicKey.findProgramAddressSync(
            [Buffer.from("tick_array"), whirlpoolPoolState.toBuffer(), Buffer.from(new Int32Array([-200]).buffer)],
            mockWhirlpoolProgramId
        );
        const [supplementalTickArray1] = PublicKey.findProgramAddressSync(
            [Buffer.from("tick_array"), whirlpoolPoolState.toBuffer(), Buffer.from(new Int32Array([200]).buffer)],
            mockWhirlpoolProgramId
        );
        const [supplementalTickArray2] = PublicKey.findProgramAddressSync(
            [Buffer.from("tick_array"), whirlpoolPoolState.toBuffer(), Buffer.from(new Int32Array([300]).buffer)],
            mockWhirlpoolProgramId
        );

        const whirlpoolTokenVaultA = getAssociatedTokenAddressSync(
            tokenAMint,
            whirlpoolPoolState,
            true,
            TOKEN_PROGRAM_ID
        );
        const whirlpoolTokenVaultB = getAssociatedTokenAddressSync(
            tokenBMint,
            whirlpoolPoolState,
            true,
            TOKEN_PROGRAM_ID
        );

        // Get wallet's token accounts
        const walletTokenA = getAssociatedTokenAddressSync(
            tokenAMint,
            wallet.publicKey,
            false,
            TOKEN_PROGRAM_ID
        );
        const walletTokenB = getAssociatedTokenAddressSync(
            tokenBMint,
            wallet.publicKey,
            false,
            TOKEN_PROGRAM_ID
        );

        // Check if pool exists
        let poolExists = false;
        try {
            await mockWhirlpoolProgram.account.whirlpool.fetch(whirlpoolPoolState);
            poolExists = true;
            //console.log("✓ Whirlpool pool already exists");
        } catch (e) {
            //console.log("Initializing new Whirlpool pool");
        }

        if (!poolExists) {
            // Make sure wallet has the tokens
            try {
                await getAccount(provider.connection, walletTokenA);
            } catch (e) {
                await createAssociatedTokenAccount(
                    provider.connection,
                    wallet.payer,
                    tokenAMint,
                    wallet.publicKey
                );
                await mintTo(
                    provider.connection,
                    wallet.payer,
                    tokenAMint,
                    walletTokenA,
                    wallet.publicKey,
                    10_000_000_000_000
                );
            }

            try {
                await getAccount(provider.connection, walletTokenB);
            } catch (e) {
                await createAssociatedTokenAccount(
                    provider.connection,
                    wallet.payer,
                    tokenBMint,
                    wallet.publicKey
                );
                await mintTo(
                    provider.connection,
                    wallet.payer,
                    tokenBMint,
                    walletTokenB,
                    wallet.publicKey,
                    10_000_000_000_000
                );
            }

            // Verify balances
            const walletTokenAInfo = await getAccount(provider.connection, walletTokenA);
            const walletTokenBInfo = await getAccount(provider.connection, walletTokenB);

            if (walletTokenAInfo.amount < 1_000_000_000n) {
                await mintTo(
                    provider.connection,
                    wallet.payer,
                    tokenAMint,
                    walletTokenA,
                    wallet.publicKey,
                    10_000_000_000_000
                );
            }

            if (walletTokenBInfo.amount < 1_000_000_000n) {
                await mintTo(
                    provider.connection,
                    wallet.payer,
                    tokenBMint,
                    walletTokenB,
                    wallet.publicKey,
                    10_000_000_000_000
                );
            }

            // Initialize pool
            await mockWhirlpoolProgram.methods
                .initializePool(new BN(1_000_000_000), new BN(1_000_000_000))
                .accounts({
                    user: wallet.publicKey,
                    whirlpool: whirlpoolPoolState,
                    tickArray0,
                    tickArray1,
                    tickArray2,
                    userTokenA: walletTokenA,
                    userTokenB: walletTokenB,
                    tokenVaultA: whirlpoolTokenVaultA,
                    tokenVaultB: whirlpoolTokenVaultB,
                    tokenMintA: tokenAMint,
                    tokenMintB: tokenBMint,
                    tokenProgramA: TOKEN_PROGRAM_ID,
                    tokenProgramB: TOKEN_PROGRAM_ID,
                    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([wallet.payer])
                .rpc();

            //console.log("✓ Whirlpool pool initialized");
        }

        // Create supplemental tick arrays
        for (const [tickArray, startTick] of [
            [supplementalTickArray0, -200],
            [supplementalTickArray1, 200],
            [supplementalTickArray2, 300]
        ]) {
            try {
                const accountInfo = await provider.connection.getAccountInfo(tickArray);
                if (!accountInfo) {
                    await mockWhirlpoolProgram.methods
                        .initializeSupplementalTickArray(startTick)
                        .accounts({
                            payer: wallet.publicKey,
                            whirlpool: whirlpoolPoolState,
                            tickArray,
                            systemProgram: SystemProgram.programId,
                        })
                        .signers([wallet.payer])
                        .rpc();
                    //console.log(`✓ Supplemental tick array at tick ${startTick} created`);
                } else {
                    //console.log(`✓ Supplemental tick array at tick ${startTick} already exists`);
                }
            } catch (e) {
                //console.log(`Note: Could not create supplemental tick array at ${startTick}: ${e.message}`);
            }
        }

        // Initialize pool info
        const [whirlpoolPoolInfo] = PublicKey.findProgramAddressSync(
            [Buffer.from("pool_info"), getSwapTypeBytes({ whirlpool: { aToB: true } }), whirlpoolPoolState.toBuffer()],
            program.programId
        );

        try {
            await program.account.poolInfo.fetch(whirlpoolPoolInfo);
            //console.log("✓ Pool info already exists");
        } catch (e) {
            await program.methods
                .initializePoolInfo({ whirlpool: { aToB: true } }, whirlpoolPoolState)
                .accounts({
                    poolInfo: whirlpoolPoolInfo,
                    adapterRegistry,
                    payer: wallet.publicKey,
                    operator: wallet.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([wallet.payer])
                .rpc();
            //console.log("✓ Pool info initialized");
        }

        // Execute swap
        const inAmount = new BN(100_000_000);
        const quotedOutAmount = new BN(90_000_000);
        const slippageBps = 100;
        const platformFeeBps = 0;

        const routePlan = [{
            swap: { whirlpool: { aToB: true } },
            percent: 100,
            inputIndex: 0,
            outputIndex: 20
        }];

        const whirlpoolOracle = Keypair.generate().publicKey;

        // Для aToB=true: свапаем A->B
        // token_owner_account_a = inputVault (содержит tokenA)
        // token_owner_account_b = intermediateVault (содержит tokenB)
        const tokenOwnerAccountA = actualInputVault;
        const tokenOwnerAccountB = actualIntermediateVault;

        // Ensure vaults have sufficient balance for the swap
        // actualInputVault should contain tokenAMint (which is actualSourceMint)
        // Check and fund actualInputVault if needed
        try {
            const vaultBalance = await getAccount(provider.connection, actualInputVault);
            if (vaultBalance.amount < BigInt(inputAmount.toString())) {
                // actualInputVault is a vault for actualSourceMint, which equals tokenAMint
                await mintTo(
                    provider.connection,
                    wallet.payer,
                    actualSourceMint, // This equals tokenAMint
                    actualInputVault,
                    wallet.publicKey,
                    1_000_000_000_000
                );
            }
        } catch (e) {
            // Vault might not exist, create and fund it
            await mintTo(
                provider.connection,
                wallet.payer,
                actualSourceMint, // This equals tokenAMint
                actualInputVault,
                wallet.publicKey,
                1_000_000_000_000
            );
        }

        //console.log(`token_owner_account_a (tokenA): ${tokenOwnerAccountA.toString()}`);
        //console.log(`token_owner_account_b (tokenB): ${tokenOwnerAccountB.toString()}`);

        const remainingAccounts = [
            { pubkey: actualInputVault, isWritable: true, isSigner: false },           // 0: input vault
            { pubkey: whirlpoolPoolInfo, isWritable: true, isSigner: false },    // 1: pool_info
            { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },    // 2: token_program_a
            { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },    // 3: token_program_b
            { pubkey: PublicKey.default, isWritable: false, isSigner: false },   // 4: memo_program
            { pubkey: whirlpoolPoolState, isWritable: true, isSigner: false },   // 5: whirlpool
            { pubkey: tokenAMint, isWritable: false, isSigner: false },          // 6: token_mint_a
            { pubkey: tokenBMint, isWritable: false, isSigner: false },          // 7: token_mint_b
            { pubkey: tokenOwnerAccountA, isWritable: true, isSigner: false },   // 8: token_owner_account_a
            { pubkey: whirlpoolTokenVaultA, isWritable: true, isSigner: false }, // 9: token_vault_a
            { pubkey: tokenOwnerAccountB, isWritable: true, isSigner: false },   // 10: token_owner_account_b
            { pubkey: whirlpoolTokenVaultB, isWritable: true, isSigner: false }, // 11: token_vault_b
            { pubkey: tickArray0, isWritable: true, isSigner: false },           // 12: tick_array_0
            { pubkey: tickArray1, isWritable: true, isSigner: false },           // 13: tick_array_1
            { pubkey: tickArray2, isWritable: true, isSigner: false },           // 14: tick_array_2
            { pubkey: whirlpoolOracle, isWritable: false, isSigner: false },     // 15: oracle
            { pubkey: supplementalTickArray0, isWritable: true, isSigner: false }, // 16
            { pubkey: supplementalTickArray1, isWritable: true, isSigner: false }, // 17
            { pubkey: supplementalTickArray2, isWritable: true, isSigner: false }, // 18
            { pubkey: mockWhirlpoolProgramId, isWritable: false, isSigner: false }, // 19: whirlpool program
            { pubkey: actualIntermediateVault, isWritable: true, isSigner: false },    // 20: output vault
        ];

        const initialSource = (await getAccount(provider.connection, actualUserSourceTokenAccount)).amount;
        const initialIntermediate = (await getAccount(provider.connection, actualUserIntermediateTokenAccount)).amount;

        //console.log("Initial source balance:", initialSource.toString());
        //console.log("Initial intermediate balance:", initialIntermediate.toString());

        await program.methods
            .route(routePlan, inAmount, quotedOutAmount, slippageBps, platformFeeBps)
            .accounts({
                adapterRegistry,
                vaultAuthority,
                inputTokenProgram: TOKEN_PROGRAM_ID,
                outputTokenProgram: TOKEN_PROGRAM_ID,
                userTransferAuthority: user.publicKey,
                userSourceTokenAccount: actualUserSourceTokenAccount,
                userDestinationTokenAccount: actualUserIntermediateTokenAccount,
                sourceMint: actualSourceMint,
                destinationMint: actualIntermediateMint,
                platformFeeAccount,
                systemProgram: SystemProgram.programId
            })
            .remainingAccounts(remainingAccounts)
            .signers([user])
            .rpc();

        const finalSource = (await getAccount(provider.connection, actualUserSourceTokenAccount)).amount;
        const finalIntermediate = (await getAccount(provider.connection, actualUserIntermediateTokenAccount)).amount;

        //console.log("Final source balance:", finalSource.toString());
        //console.log("Final intermediate balance:", finalIntermediate.toString());

        assert.equal(
            finalSource.toString(),
            (initialSource - BigInt(inAmount.toString())).toString(),
            "Source balance incorrect"
        );

        assert(finalIntermediate > initialIntermediate, "Intermediate balance should increase");

        const minSwapOut = quotedOutAmount
            .mul(new BN(10000 - slippageBps))
            .div(new BN(10000));

        assert(
            finalIntermediate >= initialIntermediate + BigInt(minSwapOut.toString()),
            "Output amount should meet minimum"
        );

        //console.log("✓ Whirlpool swap with supplemental tick arrays completed successfully");
    });
});