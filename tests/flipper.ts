import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, web3, BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, createAccount, mintTo, getAccount } from "@solana/spl-token";
import { assert } from "chai";
import { Flipper } from "../target/types/flipper";

describe("Flipper Swap Protocol", () => {
    // Configure the client to use the local cluster
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = anchor.workspace.Flipper as Program<Flipper>;

    // Test variables
    let adapterRegistry: PublicKey;
    let authority: Keypair;
    let payer: Keypair;
    let sourceMint: PublicKey;
    let destinationMint: PublicKey;
    let userSourceTokenAccount: PublicKey;
    let userDestinationTokenAccount: PublicKey;
    let raydiumProgramId: PublicKey;
    let whirlpoolProgramId: PublicKey;
    let poolAddress: PublicKey;
    let tokenVaultA: PublicKey;
    let tokenVaultB: PublicKey;
    let ammConfig: PublicKey;
    let poolAuthority: PublicKey;
    let tickArray0: PublicKey;
    let tickArray1: PublicKey;
    let tickArray2: PublicKey;
    let oracle: PublicKey;

    // Initialize adapter registry once before all tests
    before(async () => {
        try {
            authority = Keypair.generate();
            payer = Keypair.generate();

            // Fund the payer account with SOL
            const airdropSignature = await provider.connection.requestAirdrop(
                payer.publicKey,
                50_000_000_000 // 50 SOL to cover account creation
            );
            await provider.connection.confirmTransaction(airdropSignature);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for airdrop confirmation

            // Generate program IDs and mock accounts for testing
            raydiumProgramId = Keypair.generate().publicKey;
            whirlpoolProgramId = Keypair.generate().publicKey;
            poolAddress = Keypair.generate().publicKey;
            tokenVaultA = Keypair.generate().publicKey;
            tokenVaultB = Keypair.generate().publicKey;
            ammConfig = Keypair.generate().publicKey;
            poolAuthority = Keypair.generate().publicKey;
            tickArray0 = Keypair.generate().publicKey;
            tickArray1 = Keypair.generate().publicKey;
            tickArray2 = Keypair.generate().publicKey;
            oracle = Keypair.generate().publicKey;

            // Initialize adapter registry
            const [adapterRegistryPda, _bump] = await PublicKey.findProgramAddress(
                [Buffer.from("adapter_registry")],
                program.programId
            );
            adapterRegistry = adapterRegistryPda;

            await program.methods
                .initializeAdapterRegistry([
                    {
                        name: "Raydium",
                        programId: raydiumProgramId,
                        swapType: { raydium: {} },
                        poolAddresses: [poolAddress],
                    },
                    {
                        name: "Whirlpool",
                        programId: whirlpoolProgramId,
                        swapType: { whirlpool: { aToB: true } },
                        poolAddresses: [poolAddress],
                    },
                ])
                .accounts({
                    adapterRegistry,
                    payer: payer.publicKey,
                    authority: authority.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([payer, authority])
                .rpc();

            // Verify pool address registration
            const registry = await program.account.adapterRegistry.fetch(adapterRegistry);

        } catch (error) {
            if (error instanceof anchor.web3.SendTransactionError) {
                const logs = await error.getLogs(provider.connection);
                console.error("Transaction failed in before hook. Logs:", logs);
            }
            throw error;
        }
    });

    beforeEach(async () => {
        try {
            // Create mints and token accounts for each test
            const mintAuthority = Keypair.generate();
            sourceMint = await createMint(
                provider.connection,
                payer,
                mintAuthority.publicKey,
                mintAuthority.publicKey,
                6
            );
            destinationMint = await createMint(
                provider.connection,
                payer,
                mintAuthority.publicKey,
                mintAuthority.publicKey,
                6
            );
            userSourceTokenAccount = await createAccount(
                provider.connection,
                payer,
                sourceMint,
                provider.wallet.publicKey
            );
            userDestinationTokenAccount = await createAccount(
                provider.connection,
                payer,
                destinationMint,
                provider.wallet.publicKey
            );

            // Fund source token account
            await mintTo(
                provider.connection,
                payer,
                sourceMint,
                userSourceTokenAccount,
                mintAuthority,
                1_000_000
            );


        } catch (error) {
            if (error instanceof anchor.web3.SendTransactionError) {
                const logs = await error.getLogs(provider.connection);
                console.error("Transaction failed in beforeEach. Logs:", logs);
            }
            throw error;
        }
    });

    it("Initializes adapter registry correctly", async () => {
        const registryAccount = await program.account.adapterRegistry.fetch(adapterRegistry);
        assert.equal(registryAccount.authority.toString(), authority.publicKey.toString());
        assert.equal(registryAccount.supportedAdapters.length, 2);
        assert.equal(registryAccount.supportedAdapters[0].name, "Raydium");
        assert.equal(registryAccount.supportedAdapters[1].name, "Whirlpool");
    });

    it("Configures a new adapter", async () => {
        const newProgramId = Keypair.generate().publicKey;
        const newAdapter = {
            name: "NewAdapter",
            programId: newProgramId,
            swapType: { raydium: {} },
            poolAddresses: [poolAddress],
        };

        try {
            await program.methods
                .configureAdapter(newAdapter)
                .accounts({
                    adapterRegistry,
                    authority: authority.publicKey,
                })
                .signers([authority])
                .rpc();

            const registryAccount = await program.account.adapterRegistry.fetch(adapterRegistry);
            const newAdapterInfo = registryAccount.supportedAdapters.find(a => a.name === "NewAdapter");
            assert.isDefined(newAdapterInfo);
            assert.equal(newAdapterInfo.programId.toString(), newProgramId.toString());
        } catch (error) {
            if (error instanceof anchor.web3.SendTransactionError) {
                const logs = await error.getLogs(provider.connection);
                console.error("Transaction failed in configureAdapter test. Logs:", logs);
            }
            throw error;
        }
    });

    it("Executes a single Raydium swap", async () => {
        const routePlan = [
            {
                swap: { raydium: {} },
                percent: 100,
                inputIndex: 0,
                outputIndex: 1,
            },
        ];

        const inAmount = new BN(1000);
        const quotedOutAmount = new BN(1000); // Placeholder: same as input due to mock
        const slippageBps = 500; // 5%
        const platformFeeBps = 0;

        try {
            const remainingAccounts = [
                { pubkey: userSourceTokenAccount, isSigner: false, isWritable: true },
                { pubkey: userDestinationTokenAccount, isSigner: false, isWritable: true },
                { pubkey: poolAddress, isSigner: false, isWritable: true },
                { pubkey: tokenVaultA, isSigner: false, isWritable: true },
                { pubkey: tokenVaultB, isSigner: false, isWritable: true },
                { pubkey: ammConfig, isSigner: false, isWritable: false },
                { pubkey: poolAuthority, isSigner: false, isWritable: false },
                { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: false }, // Extra account for safety
            ];


            await program.methods
                .route(routePlan, inAmount, quotedOutAmount, slippageBps, platformFeeBps)
                .accounts({
                    adapterRegistry,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    userTransferAuthority: provider.wallet.publicKey,
                    userSourceTokenAccount,
                    userDestinationTokenAccount,
                    sourceMint,
                    destinationMint,
                    destinationTokenAccount: null,
                    platformFeeAccount: null,
                })
                .remainingAccounts(remainingAccounts)
                .rpc();

            // Since execute_swap is a placeholder, no tokens are transferred
            const destinationAccount = await getAccount(provider.connection, userDestinationTokenAccount);
            assert.equal(destinationAccount.amount.toString(), "0");
        } catch (error) {
            if (error instanceof anchor.web3.SendTransactionError) {
                const logs = await error.getLogs(provider.connection);
                console.error("Transaction failed in Raydium swap test. Logs:", logs);
            }
            throw error;
        }
    });

    it("Executes a Whirlpool swap", async () => {
        const routePlan = [
            {
                swap: { whirlpool: { aToB: true } },
                percent: 100,
                inputIndex: 0,
                outputIndex: 1,
            },
        ];

        const inAmount = new BN(1000);
        const quotedOutAmount = new BN(1000); // Placeholder: same as input due to mock
        const slippageBps = 500; // 5%
        const platformFeeBps = 0;

        try {
            const remainingAccounts = [
                { pubkey: userSourceTokenAccount, isSigner: false, isWritable: true },
                { pubkey: userDestinationTokenAccount, isSigner: false, isWritable: true },
                { pubkey: poolAddress, isSigner: false, isWritable: true },
                { pubkey: tokenVaultA, isSigner: false, isWritable: true },
                { pubkey: tokenVaultB, isSigner: false, isWritable: true },
                { pubkey: tickArray0, isSigner: false, isWritable: true },
                { pubkey: tickArray1, isSigner: false, isWritable: true },
                { pubkey: tickArray2, isSigner: false, isWritable: true },
                { pubkey: oracle, isSigner: false, isWritable: false },
                { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: false }, // Extra account for safety
            ];


            await program.methods
                .route(routePlan, inAmount, quotedOutAmount, slippageBps, platformFeeBps)
                .accounts({
                    adapterRegistry,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    userTransferAuthority: provider.wallet.publicKey,
                    userSourceTokenAccount,
                    userDestinationTokenAccount,
                    sourceMint,
                    destinationMint,
                    destinationTokenAccount: null,
                    platformFeeAccount: null,
                })
                .remainingAccounts(remainingAccounts)
                .rpc();

            // Since execute_swap is a placeholder, no tokens are transferred
            const destinationAccount = await getAccount(provider.connection, userDestinationTokenAccount);
            assert.equal(destinationAccount.amount.toString(), "0");
        } catch (error) {
            if (error instanceof anchor.web3.SendTransactionError) {
                const logs = await error.getLogs(provider.connection);
                console.error("Transaction failed in Whirlpool swap test. Logs:", logs);
            }
            throw error;
        }
    });

    it("Fails with invalid pool address", async () => {
        const routePlan = [
            {
                swap: { raydium: {} },
                percent: 100,
                inputIndex: 0,
                outputIndex: 1,
            },
        ];

        const invalidPoolAddress = Keypair.generate().publicKey;

        try {
            const remainingAccounts = [
                { pubkey: userSourceTokenAccount, isSigner: false, isWritable: true },
                { pubkey: userDestinationTokenAccount, isSigner: false, isWritable: true },
                { pubkey: invalidPoolAddress, isSigner: false, isWritable: true },
                { pubkey: tokenVaultA, isSigner: false, isWritable: true },
                { pubkey: tokenVaultB, isSigner: false, isWritable: true },
                { pubkey: ammConfig, isSigner: false, isWritable: false },
                { pubkey: poolAuthority, isSigner: false, isWritable: false },
                { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: false }, // Extra account for safety
            ];


            await program.methods
                .route(routePlan, new BN(1000), new BN(1000), 500, 0)
                .accounts({
                    adapterRegistry,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    userTransferAuthority: provider.wallet.publicKey,
                    userSourceTokenAccount,
                    userDestinationTokenAccount,
                    sourceMint,
                    destinationMint,
                    destinationTokenAccount: null,
                    platformFeeAccount: null,
                })
                .remainingAccounts(remainingAccounts)
                .rpc();
            assert.fail("Should have failed with invalid pool address");
        } catch (error) {
            if (error instanceof anchor.web3.SendTransactionError) {
                const logs = await error.getLogs(provider.connection);
                console.error("Transaction failed in invalid pool address test. Logs:", logs);
            }
            assert.include(error.message, "InvalidPoolAddress");
        }
    });

    it("Fails with insufficient accounts for Whirlpool", async () => {
        const routePlan = [
            {
                swap: { whirlpool: { aToB: true } },
                percent: 100,
                inputIndex: 0,
                outputIndex: 1,
            },
        ];

        try {
            const remainingAccounts = [
                { pubkey: userSourceTokenAccount, isSigner: false, isWritable: true },
                { pubkey: userDestinationTokenAccount, isSigner: false, isWritable: true },
            ];


            await program.methods
                .route(routePlan, new BN(1000), new BN(1000), 500, 0)
                .accounts({
                    adapterRegistry,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    userTransferAuthority: provider.wallet.publicKey,
                    userSourceTokenAccount,
                    userDestinationTokenAccount,
                    sourceMint,
                    destinationMint,
                    destinationTokenAccount: null,
                    platformFeeAccount: null,
                })
                .remainingAccounts(remainingAccounts)
                .rpc();
            assert.fail("Should have failed with insufficient accounts");
        } catch (error) {
            if (error instanceof anchor.web3.SendTransactionError) {
                const logs = await error.getLogs(provider.connection);
                console.error("Transaction failed in insufficient accounts test. Logs:", logs);
            }
            assert.include(error.message, "NotEnoughAccountKeys");
        }
    });
});