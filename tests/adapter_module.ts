import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, web3, BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, createAccount, mintTo, getAccount } from "@solana/spl-token";
import { assert } from "chai";
import { Flipper } from "../target/types/flipper";

describe("Flipper Swap Protocol - Adapter Module", () => {
    // Configure the client to use the local cluster
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    const program = anchor.workspace.Flipper as Program<Flipper>;

    // Test variables
    let adapterRegistry: PublicKey;
    let initialAuthority: Keypair;
    let currentAuthority: Keypair;
    let payer: Keypair;
    let operator: Keypair;
    let unauthorized: Keypair;
    let sourceMint: PublicKey;
    let destinationMint: PublicKey;
    let userSourceTokenAccount: PublicKey;
    let userDestinationTokenAccount: PublicKey;
    let raydiumProgramId: PublicKey;
    let whirlpoolProgramId: PublicKey;
    let poolAddress: PublicKey;
    let newPoolAddress: PublicKey;
    let tokenVaultA: PublicKey;
    let tokenVaultB: PublicKey;
    let ammConfig: PublicKey;
    let poolAuthority: PublicKey;
    let tickArray0: PublicKey;
    let tickArray1: PublicKey;
    let tickArray2: PublicKey;
    let oracle: PublicKey;
    let bump: number;
    let isRegistryInitialized = false;

    before(async () => {
        try {
            initialAuthority = Keypair.generate();
            currentAuthority = initialAuthority; // Track current authority
            payer = Keypair.generate();
            operator = Keypair.generate();
            unauthorized = Keypair.generate();

            // Fund the payer account with SOL
            const airdropSignature = await provider.connection.requestAirdrop(
                payer.publicKey,
                50_000_000_000 // 50 SOL to cover account creation
            );
            await provider.connection.confirmTransaction(airdropSignature);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for airdrop confirmation

            // Derive adapter registry PDA
            [adapterRegistry, bump] = await PublicKey.findProgramAddress(
                [Buffer.from("adapter_registry")],
                program.programId
            );
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
            // Generate program IDs and mock accounts for testing
            raydiumProgramId = Keypair.generate().publicKey;
            whirlpoolProgramId = Keypair.generate().publicKey;
            poolAddress = Keypair.generate().publicKey;
            newPoolAddress = Keypair.generate().publicKey;
            tokenVaultA = Keypair.generate().publicKey;
            tokenVaultB = Keypair.generate().publicKey;
            ammConfig = Keypair.generate().publicKey;
            poolAuthority = Keypair.generate().publicKey;
            tickArray0 = Keypair.generate().publicKey;
            tickArray1 = Keypair.generate().publicKey;
            tickArray2 = Keypair.generate().publicKey;
            oracle = Keypair.generate().publicKey;

            // Check if adapter_registry account exists
            const accountInfo = await provider.connection.getAccountInfo(adapterRegistry);
            if (!accountInfo && !isRegistryInitialized) {
                // Initialize adapter registry if it doesn't exist
                await program.methods
                    .initializeAdapterRegistry(
                        [
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
                        ],
                        [operator.publicKey]
                    )
                    .accounts({
                        adapterRegistry,
                        payer: payer.publicKey,
                        authority: initialAuthority.publicKey,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([payer, initialAuthority])
                    .rpc();
                isRegistryInitialized = true;
            } else {
                // Fetch current authority from adapter_registry
                const registryAccount = await program.account.adapterRegistry.fetch(adapterRegistry);
                const currentAuthorityPubkey = registryAccount.authority;

                // Use the current authority for reset (default to initialAuthority if not changed)
                const authorityToUse = currentAuthorityPubkey.equals(initialAuthority.publicKey)
                    ? initialAuthority
                    : currentAuthority;

                // Reset adapter registry state
                await program.methods
                    .resetAdapterRegistry(
                        [
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
                        ],
                        [operator.publicKey]
                    )
                    .accounts({
                        adapterRegistry,
                        authority: currentAuthorityPubkey,
                    })
                    .signers([authorityToUse])
                    .rpc();
            }

            // Create mints and token accounts for swap tests
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
        assert.equal(registryAccount.authority.toString(), initialAuthority.publicKey.toString());
        assert.equal(registryAccount.operators.length, 1);
        assert.equal(registryAccount.operators[0].toString(), operator.publicKey.toString());
        assert.equal(registryAccount.supportedAdapters.length, 2);
        assert.equal(registryAccount.supportedAdapters[0].name, "Raydium");
        assert.equal(registryAccount.supportedAdapters[1].name, "Whirlpool");
    });

    it("Configures a new adapter as operator", async () => {
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
                    operator: operator.publicKey,
                })
                .signers([operator])
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

    it("Fails to configure adapter with unauthorized account", async () => {
        const newProgramId = Keypair.generate().publicKey;
        const newAdapter = {
            name: "UnauthorizedAdapter",
            programId: newProgramId,
            swapType: { raydium: {} },
            poolAddresses: [poolAddress],
        };

        try {
            await program.methods
                .configureAdapter(newAdapter)
                .accounts({
                    adapterRegistry,
                    operator: unauthorized.publicKey,
                })
                .signers([unauthorized])
                .rpc();
            assert.fail("Should have failed with unauthorized account");
        } catch (error) {
            if (error instanceof anchor.web3.SendTransactionError) {
                const logs = await error.getLogs(provider.connection);
                console.error("Transaction failed in unauthorized configureAdapter test. Logs:", logs);
            }
            assert.include(error.message, "InvalidOperator");
        }
    });

    it("Disables an adapter as operator", async () => {
        try {
            await program.methods
                .disableAdapter({ raydium: {} })
                .accounts({
                    adapterRegistry,
                    operator: operator.publicKey,
                })
                .signers([operator])
                .rpc();

            const registryAccount = await program.account.adapterRegistry.fetch(adapterRegistry);
            const raydiumAdapter = registryAccount.supportedAdapters.find(a => a.name === "Raydium");
            assert.isUndefined(raydiumAdapter);
        } catch (error) {
            if (error instanceof anchor.web3.SendTransactionError) {
                const logs = await error.getLogs(provider.connection);
                console.error("Transaction failed in disableAdapter test. Logs:", logs);
            }
            throw error;
        }
    });

    it("Fails to disable adapter with unauthorized account", async () => {
        try {
            await program.methods
                .disableAdapter({ raydium: {} })
                .accounts({
                    adapterRegistry,
                    operator: unauthorized.publicKey,
                })
                .signers([unauthorized])
                .rpc();
            assert.fail("Should have failed with unauthorized account");
        } catch (error) {
            if (error instanceof anchor.web3.SendTransactionError) {
                const logs = await error.getLogs(provider.connection);
                console.error("Transaction failed in unauthorized disableAdapter test. Logs:", logs);
            }
            assert.include(error.message, "InvalidOperator");
        }
    });

    it("Disables a pool address as operator", async () => {
        try {
            await program.methods
                .disablePool({ raydium: {} }, poolAddress)
                .accounts({
                    adapterRegistry,
                    operator: operator.publicKey,
                })
                .signers([operator])
                .rpc();

            const registryAccount = await program.account.adapterRegistry.fetch(adapterRegistry);
            const raydiumAdapter = registryAccount.supportedAdapters.find(a => a.name === "Raydium");
            assert.isDefined(raydiumAdapter);
            assert.equal(raydiumAdapter.poolAddresses.length, 0);
        } catch (error) {
            if (error instanceof anchor.web3.SendTransactionError) {
                const logs = await error.getLogs(provider.connection);
                console.error("Transaction failed in disablePool test. Logs:", logs);
            }
            throw error;
        }
    });

    it("Fails to disable pool with unauthorized account", async () => {
        try {
            await program.methods
                .disablePool({ raydium: {} }, poolAddress)
                .accounts({
                    adapterRegistry,
                    operator: unauthorized.publicKey,
                })
                .signers([unauthorized])
                .rpc();
            assert.fail("Should have failed with unauthorized account");
        } catch (error) {
            if (error instanceof anchor.web3.SendTransactionError) {
                const logs = await error.getLogs(provider.connection);
                console.error("Transaction failed in unauthorized disablePool test. Logs:", logs);
            }
            assert.include(error.message, "InvalidOperator");
        }
    });

    it("Adds a new pool address as operator", async () => {
        try {
            await program.methods
                .addPoolAddress({ raydium: {} }, newPoolAddress)
                .accounts({
                    adapterRegistry,
                    operator: operator.publicKey,
                })
                .signers([operator])
                .rpc();

            const registryAccount = await program.account.adapterRegistry.fetch(adapterRegistry);
            const raydiumAdapter = registryAccount.supportedAdapters.find(a => a.name === "Raydium");
            assert.isDefined(raydiumAdapter);
            assert.isTrue(raydiumAdapter.poolAddresses.some(addr => addr.equals(newPoolAddress)));
        } catch (error) {
            if (error instanceof anchor.web3.SendTransactionError) {
                const logs = await error.getLogs(provider.connection);
                console.error("Transaction failed in addPoolAddress test. Logs:", logs);
            }
            throw error;
        }
    });

    it("Fails to add pool address with unauthorized account", async () => {
        try {
            await program.methods
                .addPoolAddress({ raydium: {} }, newPoolAddress)
                .accounts({
                    adapterRegistry,
                    operator: unauthorized.publicKey,
                })
                .signers([unauthorized])
                .rpc();
            assert.fail("Should have failed with unauthorized account");
        } catch (error) {
            if (error instanceof anchor.web3.SendTransactionError) {
                const logs = await error.getLogs(provider.connection);
                console.error("Transaction failed in unauthorized addPoolAddress test. Logs:", logs);
            }
            assert.include(error.message, "InvalidOperator");
        }
    });

    it("Adds an operator as authority", async () => {
        const newOperator = Keypair.generate();
        try {
            await program.methods
                .addOperator(newOperator.publicKey)
                .accounts({
                    adapterRegistry,
                    authority: currentAuthority.publicKey,
                })
                .signers([currentAuthority])
                .rpc();

            const registryAccount = await program.account.adapterRegistry.fetch(adapterRegistry);
            assert.isTrue(registryAccount.operators.some(op => op.equals(newOperator.publicKey)));
        } catch (error) {
            if (error instanceof anchor.web3.SendTransactionError) {
                const logs = await error.getLogs(provider.connection);
                console.error("Transaction failed in addOperator test. Logs:", logs);
            }
            throw error;
        }
    });

    it("Fails to add operator with unauthorized account", async () => {
        const newOperator = Keypair.generate();
        try {
            await program.methods
                .addOperator(newOperator.publicKey)
                .accounts({
                    adapterRegistry,
                    authority: unauthorized.publicKey,
                })
                .signers([unauthorized])
                .rpc();
            assert.fail("Should have failed with unauthorized account");
        } catch (error) {
            if (error instanceof anchor.web3.SendTransactionError) {
                const logs = await error.getLogs(provider.connection);
                console.error("Transaction failed in unauthorized addOperator test. Logs:", logs);
            }
            assert.include(error.message, "InvalidAuthority");
        }
    });

    it("Removes an operator as authority", async () => {
        try {
            await program.methods
                .removeOperator(operator.publicKey)
                .accounts({
                    adapterRegistry,
                    authority: currentAuthority.publicKey,
                })
                .signers([currentAuthority])
                .rpc();

            const registryAccount = await program.account.adapterRegistry.fetch(adapterRegistry);
            assert.isFalse(registryAccount.operators.some(op => op.equals(operator.publicKey)));
        } catch (error) {
            if (error instanceof anchor.web3.SendTransactionError) {
                const logs = await error.getLogs(provider.connection);
                console.error("Transaction failed in removeOperator test. Logs:", logs);
            }
            throw error;
        }
    });

    it("Fails to remove operator with unauthorized account", async () => {
        try {
            await program.methods
                .removeOperator(operator.publicKey)
                .accounts({
                    adapterRegistry,
                    authority: unauthorized.publicKey,
                })
                .signers([unauthorized])
                .rpc();
            assert.fail("Should have failed with unauthorized account");
        } catch (error) {
            if (error instanceof anchor.web3.SendTransactionError) {
                const logs = await error.getLogs(provider.connection);
                console.error("Transaction failed in unauthorized removeOperator test. Logs:", logs);
            }
            assert.include(error.message, "InvalidAuthority");
        }
    });

    it("Changes authority", async () => {
        const newAuthority = Keypair.generate();
        try {
            await program.methods
                .changeAuthority()
                .accounts({
                    adapterRegistry,
                    authority: currentAuthority.publicKey,
                    newAuthority: newAuthority.publicKey,
                })
                .signers([currentAuthority])
                .rpc();

            const registryAccount = await program.account.adapterRegistry.fetch(adapterRegistry);
            assert.equal(registryAccount.authority.toString(), newAuthority.publicKey.toString());
            currentAuthority = newAuthority; // Update current authority
        } catch (error) {
            if (error instanceof anchor.web3.SendTransactionError) {
                const logs = await error.getLogs(provider.connection);
                console.error("Transaction failed in changeAuthority test. Logs:", logs);
            }
            throw error;
        }
    });

    it("Fails to change authority with unauthorized account", async () => {
        const newAuthority = Keypair.generate();
        try {
            await program.methods
                .changeAuthority()
                .accounts({
                    adapterRegistry,
                    authority: unauthorized.publicKey,
                    newAuthority: newAuthority.publicKey,
                })
                .signers([unauthorized])
                .rpc();
            assert.fail("Should have failed with unauthorized account");
        } catch (error) {
            if (error instanceof anchor.web3.SendTransactionError) {
                const logs = await error.getLogs(provider.connection);
                console.error("Transaction failed in unauthorized changeAuthority test. Logs:", logs);
            }
            assert.include(error.message, "InvalidAuthority");
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