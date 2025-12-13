import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createMint,
    mintTo,
    getAssociatedTokenAddressSync,
    getAccount,
    getOrCreateAssociatedTokenAccount,
    createAssociatedTokenAccount,
} from "@solana/spl-token";
import { assert } from "chai";
import { Flipper } from "../target/types/flipper";

describe("Meteora Adapter - End to End Tests for Swaps", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = anchor.workspace.Flipper as Program<Flipper>;
    const mockMeteoraProgram = anchor.workspace.MockMeteoraSwap;

    let wallet: anchor.Wallet;
    let user: PublicKey;
    let vaultAuthority: PublicKey;
    let vaultAuthorityBump: number;
    let adapterRegistry: PublicKey;
    let adapterRegistryBump: number;
    let tokenXMint: PublicKey;
    let tokenYMint: PublicKey;
    let userTokenXAccount: PublicKey;
    let userTokenYAccount: PublicKey;
    let inputVault: PublicKey;
    let outputVault: PublicKey;
    let platformFeeAccount: PublicKey;
    let mockMeteoraProgramId: PublicKey;
    let meteoraPoolInfo: PublicKey;
    let meteoraPoolState: PublicKey;
    let meteoraReserveX: PublicKey;
    let meteoraReserveY: PublicKey;
    let meteoraOracle: PublicKey;
    let meteoraBinArray0: PublicKey;
    let meteoraBinArray1: PublicKey;
    let meteoraBinArray2: PublicKey;
    let meteoraEventAuthority: PublicKey;
    let meteoraBitmapExtension: PublicKey;

    function getSwapTypeBytes(swapType: any): Buffer {
        const bytes = Buffer.alloc(32, 0);
        if ("meteora" in swapType) bytes[0] = 19; // Meteora swap type encoded as 19
        return bytes;
    }

    before(async () => {
        wallet = provider.wallet as anchor.Wallet;
        user = wallet.publicKey; // Use wallet.publicKey for consistency

        // Derive PDAs
        [adapterRegistry, adapterRegistryBump] = await PublicKey.findProgramAddressSync(
            [Buffer.from("adapter_registry")],
            program.programId
        );
        [vaultAuthority, vaultAuthorityBump] = await PublicKey.findProgramAddressSync(
            [Buffer.from("vault_authority")],
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
        tokenXMint = await createMint(provider.connection, wallet.payer, wallet.publicKey, null, 9);
        tokenYMint = await createMint(provider.connection, wallet.payer, wallet.publicKey, null, 9);

        // Create user token accounts for wallet.publicKey
        userTokenXAccount = getAssociatedTokenAddressSync(
            tokenXMint,
            wallet.publicKey,
            false,
            TOKEN_PROGRAM_ID
        );
        userTokenYAccount = getAssociatedTokenAddressSync(
            tokenYMint,
            wallet.publicKey,
            false,
            TOKEN_PROGRAM_ID
        );

        // Ensure user token accounts exist and have sufficient tokens
        try {
            await getAccount(provider.connection, userTokenXAccount);
        } catch (e) {
            await createAssociatedTokenAccount(provider.connection, wallet.payer, tokenXMint, wallet.publicKey);
            await mintTo(provider.connection, wallet.payer, tokenXMint, userTokenXAccount, wallet.publicKey, 10_000_000_000_000);
        }

        try {
            await getAccount(provider.connection, userTokenYAccount);
        } catch (e) {
            await createAssociatedTokenAccount(provider.connection, wallet.payer, tokenYMint, wallet.publicKey);
            await mintTo(provider.connection, wallet.payer, tokenYMint, userTokenYAccount, wallet.publicKey, 10_000_000_000_000);
        }

        // Create vault accounts
        inputVault = await getOrCreateAssociatedTokenAccount(
            provider.connection,
            wallet.payer,
            tokenXMint,
            vaultAuthority,
            true
        ).then((acc) => acc.address);

        outputVault = await getOrCreateAssociatedTokenAccount(
            provider.connection,
            wallet.payer,
            tokenYMint,
            vaultAuthority,
            true
        ).then((acc) => acc.address);

        // Create platform fee account
        platformFeeAccount = await getOrCreateAssociatedTokenAccount(
            provider.connection,
            wallet.payer,
            tokenYMint,
            vaultAuthority,
            true
        ).then((acc) => acc.address);

        // Initialize mock Meteora pool
        mockMeteoraProgramId = mockMeteoraProgram.programId;

        // Derive meteoraPoolState as a PDA
        [meteoraPoolState] = await PublicKey.findProgramAddressSync(
            [Buffer.from("lb_pair"), tokenXMint.toBuffer(), tokenYMint.toBuffer()],
            mockMeteoraProgramId
        );

        meteoraReserveX = await getOrCreateAssociatedTokenAccount(
            provider.connection,
            wallet.payer,
            tokenXMint,
            meteoraPoolState,
            true
        ).then((acc) => acc.address);

        meteoraReserveY = await getOrCreateAssociatedTokenAccount(
            provider.connection,
            wallet.payer,
            tokenYMint,
            meteoraPoolState,
            true
        ).then((acc) => acc.address);

        // Derive meteoraOracle as a PDA
        [meteoraOracle] = await PublicKey.findProgramAddressSync(
            [Buffer.from("oracle"), meteoraPoolState.toBuffer()],
            mockMeteoraProgramId
        );

        meteoraBinArray0 = Keypair.generate().publicKey;
        meteoraBinArray1 = Keypair.generate().publicKey;
        meteoraBinArray2 = Keypair.generate().publicKey;
        meteoraBitmapExtension = Keypair.generate().publicKey;
        [meteoraEventAuthority] = await PublicKey.findProgramAddressSync(
            [Buffer.from("__event_authority")],
            mockMeteoraProgramId
        );

        // Initialize pool with wallet.publicKey as user
        await mockMeteoraProgram.methods
            .initializePool(new BN(10_000_000_000), new BN(10_000_000_000))
            .accounts({
                lbPair: meteoraPoolState,
                reserveX: meteoraReserveX,
                reserveY: meteoraReserveY,
                tokenXMint: tokenXMint,
                tokenYMint: tokenYMint,
                tokenXProgram: TOKEN_PROGRAM_ID,
                tokenYProgram: TOKEN_PROGRAM_ID,
                oracle: meteoraOracle,
                user: wallet.publicKey,
                userTokenX: userTokenXAccount,
                userTokenY: userTokenYAccount,
                program: SystemProgram.programId,
                associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
            })
            .signers([wallet.payer])
            .rpc();


        // Check if adapter registry exists
        const registryInfo = await provider.connection.getAccountInfo(adapterRegistry);
        if (!registryInfo) {
            // Include wallet.publicKey in the operators list during initialization
            await program.methods
                .initializeAdapterRegistry([], [wallet.publicKey])
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

        await program.methods
            .configureAdapter({
                name: "meteora",
                programId: mockMeteoraProgramId,
                swapType: { meteora: {} }
            })
            .accounts({ adapterRegistry, operator: wallet.publicKey })
            .signers([wallet.payer])
            .rpc();



        // Initialize pool info
        [meteoraPoolInfo] = PublicKey.findProgramAddressSync(
            [Buffer.from("pool_info"), getSwapTypeBytes({ meteora: {} }), meteoraPoolState.toBuffer()],
            program.programId
        );

        await program.methods
            .initializePoolInfo({ meteora: {} }, meteoraPoolState)
            .accounts({
                poolInfo: meteoraPoolInfo,
                adapterRegistry,
                payer: wallet.publicKey,
                operator: wallet.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([wallet.payer])
            .rpc();
    });

    it("should execute a single-step Meteora swap successfully", async () => {
        const inAmount = new BN(1000);
        const quotedOutAmount = new BN(900);
        const slippageBps = 100; // 1%
        const platformFeeBps = 50; // 0.5%

        const routePlan = [
            {
                swap: { meteora: {} },
                inputIndex: 0,
                outputIndex: 21, // Adjusted to account for inputVault/outputVault
                percent: 100,
            },
        ];

        // Prepare remaining accounts for Meteora swap, including inputVault and outputVault
        const remainingAccounts = [
            { pubkey: inputVault, isWritable: true, isSigner: false }, // 0: inputVault (for adapter)
            { pubkey: meteoraPoolInfo, isWritable: true, isSigner: false }, // 1: pool_info
            { pubkey: meteoraPoolState, isWritable: true, isSigner: false }, // 2: lb_pair
            { pubkey: meteoraBitmapExtension, isWritable: true, isSigner: false }, // 3: bin_array_bitmap_extension
            { pubkey: meteoraReserveX, isWritable: true, isSigner: false }, // 4: reserve_x
            { pubkey: meteoraReserveY, isWritable: true, isSigner: false }, // 5: reserve_y
            { pubkey: inputVault, isWritable: true, isSigner: false }, // 6: user_token_in
            { pubkey: outputVault, isWritable: true, isSigner: false }, // 7: user_token_out
            { pubkey: tokenXMint, isWritable: false, isSigner: false }, // 8: token_x_mint
            { pubkey: tokenYMint, isWritable: false, isSigner: false }, // 9: token_y_mint
            { pubkey: meteoraOracle, isWritable: true, isSigner: false }, // 10: oracle
            { pubkey: Keypair.generate().publicKey, isWritable: true, isSigner: false }, // 11: host_fee_in
            { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false }, // 12: token_x_program
            { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false }, // 13: token_y_program
            { pubkey: Keypair.generate().publicKey, isWritable: false, isSigner: false }, // 14: memo_program
            { pubkey: meteoraEventAuthority, isWritable: false, isSigner: false }, // 15: event_authority
            { pubkey: mockMeteoraProgramId, isWritable: false, isSigner: false }, // 16: program (CPI event, readonly)
            { pubkey: meteoraBinArray0, isWritable: true, isSigner: false }, // 17: bin_array_0
            { pubkey: meteoraBinArray1, isWritable: true, isSigner: false }, // 18: bin_array_1
            { pubkey: meteoraBinArray2, isWritable: true, isSigner: false }, // 19: bin_array_2
            { pubkey: mockMeteoraProgramId, isWritable: false, isSigner: false }, // 20: program ID (readonly, для CPI)
            { pubkey: outputVault, isWritable: true, isSigner: false }, // 21: output vault
        ];

        const initialSourceBalance = (await getAccount(provider.connection, userTokenXAccount)).amount;
        const initialDestinationBalance = (await getAccount(provider.connection, userTokenYAccount)).amount;

        await program.methods
            .route(routePlan, inAmount, quotedOutAmount, slippageBps, platformFeeBps)
            .accounts({
                adapterRegistry,
                vaultAuthority,
                inputTokenProgram: TOKEN_PROGRAM_ID,
                outputTokenProgram: TOKEN_PROGRAM_ID,
                userTransferAuthority: wallet.publicKey,
                userSourceTokenAccount: userTokenXAccount,
                userDestinationTokenAccount: userTokenYAccount,
                sourceMint: tokenXMint,
                destinationMint: tokenYMint,
                platformFeeAccount,
                systemProgram: SystemProgram.programId,
            })
            .remainingAccounts(remainingAccounts)
            .signers([wallet.payer])
            .rpc();

        const finalSourceBalance = (await getAccount(provider.connection, userTokenXAccount)).amount;
        const finalDestinationBalance = (await getAccount(provider.connection, userTokenYAccount)).amount;

        // Validate source token balance decreased by input amount
        assert.equal(
            finalSourceBalance.toString(),
            (initialSourceBalance - BigInt(inAmount.toString())).toString(),
            "Source token balance should decrease by input amount"
        );

        // Validate destination token balance increased
        assert(
            finalDestinationBalance > initialDestinationBalance,
            "Destination token balance should increase"
        );

        // Validate slippage protection
        const minSwapOut = quotedOutAmount
            .mul(new BN(10000 - slippageBps))
            .div(new BN(10000));
        assert(
            finalDestinationBalance >= initialDestinationBalance + BigInt(minSwapOut.toString()),
            "Output amount should meet minimum after slippage"
        );
    });
});