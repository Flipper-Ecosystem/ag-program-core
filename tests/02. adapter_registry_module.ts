import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, web3, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
  getMinimumBalanceForRentExemptAccount,
} from "@solana/spl-token";
import { assert } from "chai";
import { Flipper } from "../target/types/flipper";

describe("Flipper Swap Protocol - Adapter Registry Module", () => {
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
  let vaultAuthority: PublicKey;
  let inputVault: PublicKey;
  let outputVault: PublicKey;
  let vaultAuthorityBump: number;
  let inputVaultBump: number;
  let outputVaultBump: number;
  let bump: number;
  let isRegistryInitialized = false;

  // Helper function to generate swapType bytes matching Rust to_bytes
  function getSwapTypeBytes(swapType: any): Buffer {
    const bytes = Buffer.alloc(32, 0); // Initialize 32-byte array with zeros
    if ("raydium" in swapType) {
      bytes[0] = 7; // Raydium variant index
    } else if ("whirlpool" in swapType) {
      bytes[0] = 17; // Whirlpool variant index
      bytes[1] = swapType.whirlpool.aToB ? 1 : 0; // aToB boolean
    }
    return bytes;
  }

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

      // Fund the operator account with SOL
      const operatorAirdropSignature = await provider.connection.requestAirdrop(
        operator.publicKey,
        5_000_000_000 // 5 SOL
      );
      await provider.connection.confirmTransaction(operatorAirdropSignature);

      await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for airdrop confirmation

      // Derive adapter registry PDA
      [adapterRegistry, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from("adapter_registry")],
        program.programId
      );

      // Derive vault authority PDA
      [vaultAuthority, vaultAuthorityBump] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_authority")],
        program.programId
      );

      // Create mints
      sourceMint = await createMint(
        provider.connection,
        payer,
        payer.publicKey,
        null,
        9
      );
      destinationMint = await createMint(
        provider.connection,
        payer,
        payer.publicKey,
        null,
        9
      );

      // Derive vault PDAs
      [inputVault, inputVaultBump] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), sourceMint.toBuffer()],
        program.programId
      );
      [outputVault, outputVaultBump] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), destinationMint.toBuffer()],
        program.programId
      );

      // Create user token accounts
      userSourceTokenAccount = await createAssociatedTokenAccount(
        provider.connection,
        payer,
        sourceMint,
        provider.wallet.publicKey
      );
      userDestinationTokenAccount = await createAssociatedTokenAccount(
        provider.connection,
        payer,
        destinationMint,
        provider.wallet.publicKey
      );

      // Mint tokens to user account
      await mintTo(
        provider.connection,
        payer,
        sourceMint,
        userSourceTokenAccount,
        payer,
        1000000
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

      const vaultAuthorityInfo = await provider.connection.getAccountInfo(
        vaultAuthority
      );
      if (!vaultAuthorityInfo) {
        await program.methods
          .createVaultAuthority()
          .accounts({
            vaultAuthority,
            payer: payer.publicKey,
            admin: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([payer, provider.wallet.payer])
          .rpc();
      }

      const inputVaultAccountInfo = await provider.connection.getAccountInfo(
        inputVault
      );
      const outputVaultAccountInfo = await provider.connection.getAccountInfo(
        outputVault
      );

      if (!inputVaultAccountInfo) {
        await program.methods
          .createVault()
          .accounts({
            vaultAuthority,
            payer: payer.publicKey,
            admin: provider.wallet.publicKey,
            vault: inputVault,
            vaultMint: sourceMint,
            vaultTokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([payer, provider.wallet.payer])
          .rpc();
      }

      if (!outputVaultAccountInfo) {
        await program.methods
          .createVault()
          .accounts({
            vaultAuthority,
            payer: payer.publicKey,
            admin: provider.wallet.publicKey,
            vault: outputVault,
            vaultMint: destinationMint,
            vaultTokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([payer, provider.wallet.payer])
          .rpc();
      }

      // Check if adapter_registry account exists
      const accountInfo = await provider.connection.getAccountInfo(
        adapterRegistry
      );
      if (!accountInfo && !isRegistryInitialized) {
        // Initialize adapter registry if it doesn't exist
        await program.methods
          .initializeAdapterRegistry(
            [
              {
                name: "Raydium",
                programId: raydiumProgramId,
                swapType: { raydium: {} },
              },
              {
                name: "Whirlpool",
                programId: whirlpoolProgramId,
                swapType: { whirlpool: { aToB: true } },
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
      } else if (accountInfo) {
        // Fetch current authority from adapter_registry
        const registryAccount = await program.account.adapterRegistry.fetch(
          adapterRegistry
        );
        const currentAuthorityPubkey = registryAccount.authority;

        // Use the current authority for reset
        const authorityToUse = currentAuthorityPubkey.equals(
          initialAuthority.publicKey
        )
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
              },
              {
                name: "Whirlpool",
                programId: whirlpoolProgramId,
                swapType: { whirlpool: { aToB: true } },
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
    } catch (error) {
      if (error instanceof anchor.web3.SendTransactionError) {
        const logs = await error.getLogs(provider.connection);
        console.error("Transaction failed in beforeEach hook. Logs:", logs);
      }
      throw error;
    }
  });

  it("Initializes adapter registry correctly", async () => {
    const registryAccount = await program.account.adapterRegistry.fetch(
      adapterRegistry
    );
    assert.equal(
      registryAccount.authority.toString(),
      initialAuthority.publicKey.toString()
    );
    assert.equal(registryAccount.operators.length, 1);
    assert.equal(
      registryAccount.operators[0].toString(),
      operator.publicKey.toString()
    );
    assert.equal(registryAccount.supportedAdapters.length, 2);
    assert.equal(registryAccount.supportedAdapters[0].name, "Raydium");
    assert.equal(registryAccount.supportedAdapters[1].name, "Whirlpool");
  });

  it("Initializes pool info for Raydium", async () => {
    try {
      const swapTypeBytes = getSwapTypeBytes({ raydium: {} });
      const [poolInfo, poolBump] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool_info"), swapTypeBytes, poolAddress.toBuffer()],
        program.programId
      );

      await program.methods
        .initializePoolInfo({ raydium: {} }, poolAddress)
        .accounts({
          poolInfo,
          adapterRegistry,
          payer: payer.publicKey,
          operator: operator.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer, operator])
        .rpc();

      const poolInfoAccount = await program.account.poolInfo.fetch(poolInfo);
      assert.equal(
        poolInfoAccount.poolAddress.toBase58(),
        poolAddress.toBase58()
      );
      assert.isTrue(poolInfoAccount.enabled);
      assert.deepEqual(poolInfoAccount.adapterSwapType, { raydium: {} });
    } catch (error) {
      if (error instanceof anchor.web3.SendTransactionError) {
        const logs = await error.getLogs(provider.connection);
        console.error(
          "Transaction failed in Raydium pool info test. Logs:",
          logs
        );
      }
      throw error;
    }
  });

  it("Initializes pool info for Whirlpool", async () => {
    try {
      const swapTypeBytes = getSwapTypeBytes({ whirlpool: { aToB: true } });
      const [poolInfo, poolBump] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool_info"), swapTypeBytes, poolAddress.toBuffer()],
        program.programId
      );

      await program.methods
        .initializePoolInfo({ whirlpool: { aToB: true } }, poolAddress)
        .accounts({
          poolInfo,
          adapterRegistry,
          payer: payer.publicKey,
          operator: operator.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer, operator])
        .rpc();

      const poolInfoAccount = await program.account.poolInfo.fetch(poolInfo);
      assert.equal(
        poolInfoAccount.poolAddress.toBase58(),
        poolAddress.toBase58()
      );
      assert.isTrue(poolInfoAccount.enabled);
      assert.deepEqual(poolInfoAccount.adapterSwapType, {
        whirlpool: { aToB: true },
      });
    } catch (error) {
      if (error instanceof anchor.web3.SendTransactionError) {
        const logs = await error.getLogs(provider.connection);
        console.error(
          "Transaction failed in Whirlpool pool info test. Logs:",
          logs
        );
      }
      throw error;
    }
  });

  /*it("Executes a Whirlpool swap", async () => {
        try {
            // Initialize PoolInfo account
            const swapTypeBytes = getSwapTypeBytes({ whirlpool: { aToB: true } });
            const [poolInfo, poolBump] = PublicKey.findProgramAddressSync(
                [Buffer.from("pool_info"), swapTypeBytes, poolAddress.toBuffer()],
                program.programId
            );

            await program.methods
                .initializePoolInfo({ whirlpool: { aToB: true } }, poolAddress)
                .accounts({
                    poolInfo,
                    adapterRegistry,
                    payer: payer.publicKey,
                    operator: operator.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([payer, operator])
                .rpc();

            // Mint tokens to inputVault for testing
            await mintTo(
                provider.connection,
                payer,
                sourceMint,
                inputVault,
                payer,
                1000
            );

            const routePlan = [
                {
                    swap: { whirlpool: { aToB: true } },
                    percent: 100,
                    inputIndex: 0,
                    outputIndex: 3, // Adjusted for poolInfo and pool account
                },
            ];

            const inAmount = new BN(1000);
            const quotedOutAmount = new BN(1000); // Placeholder: same as input due to mock
            const slippageBps = 500; // 5%
            const platformFeeBps = 0;

            const remainingAccounts = [
                { pubkey: inputVault, isSigner: false, isWritable: true }, // input_index: 0
                { pubkey: poolInfo, isSigner: false, isWritable: false }, // input_index + 1
                { pubkey: poolAddress, isSigner: false, isWritable: true }, // input_index + 2
                { pubkey: outputVault, isSigner: false, isWritable: true }, // output_index: 3
                { pubkey: tokenVaultA, isSigner: false, isWritable: true },
                { pubkey: tokenVaultB, isSigner: false, isWritable: true },
                { pubkey: tickArray0, isSigner: false, isWritable: true },
                { pubkey: tickArray1, isSigner: false, isWritable: true },
                { pubkey: tickArray2, isSigner: false, isWritable: true },
                { pubkey: oracle, isSigner: false, isWritable: true },
            ];

            await program.methods
                .route(routePlan, inAmount, quotedOutAmount, slippageBps, platformFeeBps)
                .accounts({
                    adapterRegistry,
                    vaultAuthority,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    userTransferAuthority: provider.wallet.publicKey,
                    userSourceTokenAccount,
                    userDestinationTokenAccount,
                    sourceMint,
                    destinationMint,
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
        try {
            // Initialize PoolInfo account
            const swapTypeBytes = getSwapTypeBytes({ raydium: {} });
            const [poolInfo, poolBump] = PublicKey.findProgramAddressSync(
                [Buffer.from("pool_info"), swapTypeBytes, poolAddress.toBuffer()],
                program.programId
            );

            await program.methods
                .initializePoolInfo({ raydium: {} }, poolAddress)
                .accounts({
                    poolInfo,
                    adapterRegistry,
                    payer: payer.publicKey,
                    operator: operator.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([payer, operator])
                .rpc();

            // Mint tokens to inputVault for testing
            await mintTo(
                provider.connection,
                payer,
                sourceMint,
                inputVault,
                payer,
                1000
            );

            const routePlan = [
                {
                    swap: { raydium: {} },
                    percent: 100,
                    inputIndex: 0,
                    outputIndex: 3, // Adjusted for poolInfo and pool account
                },
            ];

            const invalidPoolAddress = Keypair.generate().publicKey;

            const remainingAccounts = [
                { pubkey: inputVault, isSigner: false, isWritable: true }, // input_index: 0
                { pubkey: poolInfo, isSigner: false, isWritable: false }, // input_index + 1
                { pubkey: invalidPoolAddress, isSigner: false, isWritable: true }, // input_index + 2
                { pubkey: outputVault, isSigner: false, isWritable: true }, // output_index: 3
                { pubkey: tokenVaultA, isSigner: false, isWritable: true },
                { pubkey: tokenVaultB, isSigner: false, isWritable: true },
                { pubkey: ammConfig, isSigner: false, isWritable: false },
                { pubkey: poolAuthority, isSigner: false, isWritable: false },
            ];

            await program.methods
                .route(routePlan, new BN(1000), new BN(1000), 500, 0)
                .accounts({
                    adapterRegistry,
                    vaultAuthority,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    userTransferAuthority: provider.wallet.publicKey,
                    userSourceTokenAccount,
                    userDestinationTokenAccount,
                    sourceMint,
                    destinationMint,
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
        try {
            // Initialize PoolInfo account
            const swapTypeBytes = getSwapTypeBytes({ whirlpool: { aToB: true } });
            const [poolInfo, poolBump] = PublicKey.findProgramAddressSync(
                [Buffer.from("pool_info"), swapTypeBytes, poolAddress.toBuffer()],
                program.programId
            );

            await program.methods
                .initializePoolInfo({ whirlpool: { aToB: true } }, poolAddress)
                .accounts({
                    poolInfo,
                    adapterRegistry,
                    payer: payer.publicKey,
                    operator: operator.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([payer, operator])
                .rpc();

            const routePlan = [
                {
                    swap: { whirlpool: { aToB: true } },
                    percent: 100,
                    inputIndex: 0,
                    outputIndex: 1,
                },
            ];

            const remainingAccounts = [
                { pubkey: userSourceTokenAccount, isSigner: false, isWritable: true },
                { pubkey: userDestinationTokenAccount, isSigner: false, isWritable: true },
            ];

            await program.methods
                .route(routePlan, new BN(1000), new BN(1000), 500, 0)
                .accounts({
                    adapterRegistry,
                    vaultAuthority,
                    tokenProgram: TOKEN_PROGRAM_ID,
                    userTransferAuthority: provider.wallet.publicKey,
                    userSourceTokenAccount,
                    userDestinationTokenAccount,
                    sourceMint,
                    destinationMint,
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
    });*/

  it("Configures a new adapter as operator", async () => {
    const newProgramId = Keypair.generate().publicKey;
    const newAdapter = {
      name: "NewAdapter",
      programId: newProgramId,
      swapType: { raydium: {} },
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

      const registryAccount = await program.account.adapterRegistry.fetch(
        adapterRegistry
      );
      const newAdapterInfo = registryAccount.supportedAdapters.find(
        (a) => a.name === "NewAdapter"
      );
      assert.isDefined(newAdapterInfo);
      assert.equal(
        newAdapterInfo.programId.toString(),
        newProgramId.toString()
      );
    } catch (error) {
      if (error instanceof anchor.web3.SendTransactionError) {
        const logs = await error.getLogs(provider.connection);
        console.error(
          "Transaction failed in configureAdapter test. Logs:",
          logs
        );
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
        console.error(
          "Transaction failed in unauthorized configureAdapter test. Logs:",
          logs
        );
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

      const registryAccount = await program.account.adapterRegistry.fetch(
        adapterRegistry
      );
      const raydiumAdapter = registryAccount.supportedAdapters.find(
        (a) => a.name === "Raydium"
      );
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
        console.error(
          "Transaction failed in unauthorized disableAdapter test. Logs:",
          logs
        );
      }
      assert.include(error.message, "InvalidOperator");
    }
  });

  it("Disables a pool address as operator", async () => {
    try {
      // Сначала инициализируем pool info
      const swapTypeBytes = getSwapTypeBytes({ raydium: {} });
      const [poolInfo, poolBump] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool_info"), swapTypeBytes, poolAddress.toBuffer()],
        program.programId
      );

      await program.methods
        .initializePoolInfo({ raydium: {} }, poolAddress)
        .accounts({
          poolInfo,
          adapterRegistry,
          payer: payer.publicKey,
          operator: operator.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer, operator])
        .rpc();

      // Теперь отключаем pool
      await program.methods
        .disablePool({ raydium: {} }, poolAddress)
        .accounts({
          poolInfo,
          adapterRegistry,
          operator: operator.publicKey,
        })
        .signers([operator])
        .rpc();

      const poolInfoAccount = await program.account.poolInfo.fetch(poolInfo);
      assert.isFalse(poolInfoAccount.enabled);
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
      // Инициализируем pool info
      const swapTypeBytes = getSwapTypeBytes({ raydium: {} });
      const [poolInfo, poolBump] = PublicKey.findProgramAddressSync(
        [Buffer.from("pool_info"), swapTypeBytes, poolAddress.toBuffer()],
        program.programId
      );

      await program.methods
        .initializePoolInfo({ raydium: {} }, poolAddress)
        .accounts({
          poolInfo,
          adapterRegistry,
          payer: payer.publicKey,
          operator: operator.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer, operator])
        .rpc();

      await program.methods
        .disablePool({ raydium: {} }, poolAddress)
        .accounts({
          poolInfo,
          adapterRegistry,
          operator: unauthorized.publicKey,
        })
        .signers([unauthorized])
        .rpc();
      assert.fail("Should have failed with unauthorized account");
    } catch (error) {
      if (error instanceof anchor.web3.SendTransactionError) {
        const logs = await error.getLogs(provider.connection);
        console.error(
          "Transaction failed in unauthorized disablePool test. Logs:",
          logs
        );
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

      const registryAccount = await program.account.adapterRegistry.fetch(
        adapterRegistry
      );
      assert.isTrue(
        registryAccount.operators.some((op) => op.equals(newOperator.publicKey))
      );
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
        console.error(
          "Transaction failed in unauthorized addOperator test. Logs:",
          logs
        );
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

      const registryAccount = await program.account.adapterRegistry.fetch(
        adapterRegistry
      );
      assert.isFalse(
        registryAccount.operators.some((op) => op.equals(operator.publicKey))
      );
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
        console.error(
          "Transaction failed in unauthorized removeOperator test. Logs:",
          logs
        );
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

      const registryAccount = await program.account.adapterRegistry.fetch(
        adapterRegistry
      );
      assert.equal(
        registryAccount.authority.toString(),
        newAuthority.publicKey.toString()
      );

      const wallet = provider.wallet as anchor.Wallet;
      await program.methods
        .changeAuthority()
        .accounts({
          adapterRegistry,
          authority: newAuthority.publicKey,
          newAuthority: wallet.publicKey,
        })
        .signers([newAuthority])
        .rpc();

      currentAuthority = wallet.payer;
    } catch (error) {
      if (error instanceof anchor.web3.SendTransactionError) {
        const logs = await error.getLogs(provider.connection);
        console.error(
          "Transaction failed in changeAuthority test. Logs:",
          logs
        );
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
        console.error(
          "Transaction failed in unauthorized changeAuthority test. Logs:",
          logs
        );
      }
      assert.include(error.message, "InvalidAuthority");
    }
  });
});
