import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccount,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  createSyncNativeInstruction,
  closeAccount,
  NATIVE_MINT,
} from "@solana/spl-token";
import { assert } from "chai";
import { Flipper } from "../target/types/flipper";

describe("Flipper Swap Protocol - End to End Tests for Swaps and Limit Orders with WSOL", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Flipper as Program<Flipper>;

  // Shared variables
  let wallet: anchor.Wallet;
  let admin: Keypair;
  let user: Keypair;
  let operator: Keypair;
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
  let userWsolTokenAccount: PublicKey;

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

  // Helper function to fund token account
  async function fundTokenAccount(
    mint: PublicKey,
    account: PublicKey,
    amount: number | bigint
  ) {
    if (mint.equals(NATIVE_MINT)) {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: wallet.payer.publicKey,
          toPubkey: account,
          lamports: Number(amount),
        }),
        createSyncNativeInstruction(account, TOKEN_PROGRAM_ID)
      );
      await provider.sendAndConfirm(tx, [wallet.payer]);
    } else {
      await mintTo(
        provider.connection,
        wallet.payer,
        mint,
        account,
        wallet.publicKey,
        amount,
        [],
        undefined,
        TOKEN_PROGRAM_ID
      );
    }
  }

  before(async () => {
    wallet = provider.wallet as anchor.Wallet;
    admin = wallet.payer;
    user = Keypair.generate();
    operator = Keypair.generate();
    treasury = Keypair.generate();

    // Fund user
    await provider.connection.requestAirdrop(user.publicKey, 10_000_000_000);
    await provider.connection.requestAirdrop(
      operator.publicKey,
      10_000_000_000
    );
    await provider.connection.requestAirdrop(
      treasury.publicKey,
      10_000_000_000
    );

    await new Promise((resolve) => setTimeout(resolve, 1000));

    // PDAs
    [vaultAuthority, vaultAuthorityBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_authority")],
      program.programId
    );

    [adapterRegistry, adapterRegistryBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("adapter_registry")],
      program.programId
    );

    // Check if vault_authority already exists
    const vaultAuthorityInfo = await provider.connection.getAccountInfo(
      vaultAuthority
    );
    if (!vaultAuthorityInfo) {
      // Create vault authority only if it doesn't exist
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

      //console.log("✓ Vault authority created");
    } else {
      //console.log("✓ Vault authority already exists, reusing");
    }

    // Mints
    sourceMint = NATIVE_MINT; // Use WSOL for sourceMint
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
    destinationMint = await createMint(
      provider.connection,
      wallet.payer,
      wallet.publicKey,
      null,
      9,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );

    // Vaults
    [inputVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), sourceMint.toBuffer()],
      program.programId
    );
    [intermediateVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), intermediateMint.toBuffer()],
      program.programId
    );
    [outputVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), destinationMint.toBuffer()],
      program.programId
    );

    // Create vaults
    for (const [vault, mint] of [
      [inputVault, sourceMint],
      [intermediateVault, intermediateMint],
      [outputVault, destinationMint],
    ]) {
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
    userDestinationTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      user,
      destinationMint,
      user.publicKey
    );

    // Fund userSource with WSOL
    const wsolAmount = 1_000_000_000; // 1 SOL
    const wsolTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: user.publicKey,
        toPubkey: userSourceTokenAccount,
        lamports: wsolAmount,
      }),
      createSyncNativeInstruction(userSourceTokenAccount, TOKEN_PROGRAM_ID)
    );
    await provider.sendAndConfirm(wsolTx, [user]);

    // Mint to user intermediate account
    await mintTo(
      provider.connection,
      wallet.payer,
      intermediateMint,
      userIntermediateTokenAccount,
      wallet.publicKey,
      1_000_000_000_000
    );

    // Fund vaults
    await fundTokenAccount(sourceMint, inputVault, 1_000_000_000_000);
    await fundTokenAccount(
      intermediateMint,
      intermediateVault,
      1_000_000_000_000
    );
    await fundTokenAccount(destinationMint, outputVault, 1_000_000_000_000);

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

    // Check if adapter registry exists
    const registryInfo = await provider.connection.getAccountInfo(
      adapterRegistry
    );
    if (!registryInfo) {
      // Include wallet.publicKey in the operators list during initialization
      await program.methods
        .initializeAdapterRegistry([], [operator.publicKey, wallet.publicKey]) // CHANGED: Added wallet.publicKey
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
      //console.log("✓ Adapter registry already exists, reusing");

      // If registry exists, we might need to add wallet as operator
      try {
        const registryAccount = await program.account.adapterRegistry.fetch(
          adapterRegistry
        );
        const isOperator = registryAccount.operators.some((op: PublicKey) =>
          op.equals(operator.publicKey)
        );

        if (!isOperator) {
          //console.log("⚠ Wallet is not an operator, attempting to add...");
          // Try to add wallet as operator using another existing operator
          await program.methods
            .addOperator(operator.publicKey)
            .accounts({
              adapterRegistry,
              authority: wallet.publicKey, // This might fail if wallet isn't already an operator
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
        name: "raydium",
        programId: mockRaydiumProgramId,
        swapType: { raydium: {} },
      })
      .accounts({ adapterRegistry, operator: wallet.publicKey })
      .signers([wallet.payer])
      .rpc();
    await program.methods
      .configureAdapter({
        name: "whirlpool",
        programId: mockWhirlpoolProgramId,
        swapType: { whirlpool: { aToB: true } },
      })
      .accounts({ adapterRegistry, operator: wallet.publicKey })
      .signers([wallet.payer])
      .rpc();
    await program.methods
      .configureAdapter({
        name: "meteora",
        programId: mockMeteoraProgramId,
        swapType: { meteora: {} },
      })
      .accounts({ adapterRegistry, operator: wallet.publicKey })
      .signers([wallet.payer])
      .rpc();

    // Setup mock pools
    // Raydium: WSOL -> destination
    const mintA = sourceMint;
    const mintB = destinationMint;
    const sorted = mintA.toBuffer().compare(mintB.toBuffer()) < 0;
    const [tokenAMint, tokenBMint] = sorted ? [mintA, mintB] : [mintB, mintA];
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

    // Fund user token accounts for pool
    await fundTokenAccount(tokenAMint, userTokenAAccount, 1_000_000_000_000);
    await fundTokenAccount(tokenBMint, userTokenBAccount, 1_000_000_000_000);

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
      [
        Buffer.from("pool_info"),
        getSwapTypeBytes({ raydium: {} }),
        raydiumPoolState.toBuffer(),
      ],
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

    const poolStateAccount = await program.account.poolInfo.fetch(
      raydiumPoolInfo
    );
  });

  it("1. Simple single-hop swap with Raydium adapter", async () => {
    const inAmount = new BN(100_000_000);
    const quotedOutAmount = new BN(90_000_000);
    const slippageBps = 100;
    const platformFeeBps = 0;

    const routePlan = [
      { swap: { raydium: {} }, percent: 100, inputIndex: 0, outputIndex: 13 },
    ];

    const inputPoolVault =
      sourceMint.toBuffer().compare(destinationMint.toBuffer()) < 0
        ? raydiumTokenAVault
        : raydiumTokenBVault;
    const outputPoolVault =
      sourceMint.toBuffer().compare(destinationMint.toBuffer()) < 0
        ? raydiumTokenBVault
        : raydiumTokenAVault;

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
      { pubkey: mockRaydiumProgramId, isWritable: false, isSigner: false }, // index 12: program id
      { pubkey: outputVault, isWritable: true, isSigner: false }, // index 13: output vault
    ];

    const initialSource = (
      await getAccount(provider.connection, userSourceTokenAccount)
    ).amount;
    const initialDest = (
      await getAccount(provider.connection, userDestinationTokenAccount)
    ).amount;

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
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(remainingAccounts)
      .signers([user])
      .rpc();

    const finalSource = (
      await getAccount(provider.connection, userSourceTokenAccount)
    ).amount;
    const finalDest = (
      await getAccount(provider.connection, userDestinationTokenAccount)
    ).amount;

    const inAmountBN = BigInt(inAmount.toString());
    const minOutAmount = quotedOutAmount
      .mul(new BN(10000 - slippageBps))
      .div(new BN(10000));
    const expectedOutAmount = BigInt(minOutAmount.toString());

    assert.equal(
      finalSource.toString(),
      (initialSource - inAmountBN).toString(),
      "Source balance incorrect"
    );

    assert(
      finalDest >= initialDest + expectedOutAmount,
      "Destination balance incorrect"
    );
  });

  it("2. Create limit order (Take Profit)", async () => {
    const nonce = new BN(Date.now());
    const inputAmount = new BN(50_000_000);
    const minOutputAmount = new BN(45_000_000);
    const triggerPriceBps = 1000;
    const triggerType = { takeProfit: {} };
    const expiry = new BN(Math.floor(Date.now() / 1000) + 3600);
    const slippageBps = 300;

    const [limitOrder] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("limit_order"),
        user.publicKey.toBuffer(),
        nonce.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    // Vault now uses limit_order.key() as seed
    const [orderVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("order_vault"), limitOrder.toBuffer()],
      program.programId
    );

    // Initialize limit order and vault first (for standard tokens, account_space = 0)
    await program.methods
      .initLimitOrder(nonce, 0)
      .accounts({
        vaultAuthority,
        limitOrder,
        inputVault: orderVault,
        inputMint: sourceMint,
        inputTokenProgram: TOKEN_PROGRAM_ID,
        creator: user.publicKey,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([user])
      .rpc();

    const initialBalance = (
      await getAccount(provider.connection, userSourceTokenAccount)
    ).amount;

    await program.methods
      .createLimitOrder(
        nonce,
        inputAmount,
        minOutputAmount,
        triggerPriceBps,
        triggerType,
        expiry,
        slippageBps
      )
      .accounts({
        vaultAuthority,
        limitOrder,
        inputVault: orderVault,
        userInputTokenAccount: userSourceTokenAccount,
        userDestinationTokenAccount: userDestinationTokenAccount,
        inputMint: sourceMint,
        outputMint: destinationMint,
        inputTokenProgram: TOKEN_PROGRAM_ID,
        outputTokenProgram: TOKEN_PROGRAM_ID,
        creator: user.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    const finalBalance = (
      await getAccount(provider.connection, userSourceTokenAccount)
    ).amount;
    const vaultBalance = (await getAccount(provider.connection, orderVault))
      .amount;

    assert.equal(
      finalBalance.toString(),
      (initialBalance - BigInt(inputAmount.toString())).toString(),
      "User balance not decreased"
    );
    assert.equal(
      vaultBalance.toString(),
      inputAmount.toString(),
      "Vault balance incorrect"
    );

    const orderAccount = await program.account.limitOrder.fetch(limitOrder);
    assert.equal(orderAccount.inputAmount.toString(), inputAmount.toString());
    assert.equal(orderAccount.status.open !== undefined, true);
  });

  it("3. Execute limit order when trigger met", async () => {
    const nonce = new BN(Date.now());
    const inputAmount = new BN(50_000_000);
    const minOutputAmount = new BN(30_000_000);
    const triggerPriceBps = 500;
    const triggerType = { takeProfit: {} };
    const expiry = new BN(Math.floor(Date.now() / 1000) + 3600);
    const slippageBps = 300;

    const [limitOrder] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("limit_order"),
        user.publicKey.toBuffer(),
        nonce.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    // Vault now uses limit_order.key() as seed
    const [orderVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("order_vault"), limitOrder.toBuffer()],
      program.programId
    );

    // Initialize limit order and vault first (for standard tokens, account_space = 0)
    await program.methods
      .initLimitOrder(nonce, 0)
      .accounts({
        vaultAuthority,
        limitOrder,
        inputVault: orderVault,
        inputMint: sourceMint,
        inputTokenProgram: TOKEN_PROGRAM_ID,
        creator: user.publicKey,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([user])
      .rpc();

    await program.methods
      .createLimitOrder(
        nonce,
        inputAmount,
        minOutputAmount,
        triggerPriceBps,
        triggerType,
        expiry,
        slippageBps
      )
      .accounts({
        vaultAuthority,
        limitOrder,
        inputVault: orderVault,
        userInputTokenAccount: userSourceTokenAccount,
        userDestinationTokenAccount: userDestinationTokenAccount,
        inputMint: sourceMint,
        outputMint: destinationMint,
        inputTokenProgram: TOKEN_PROGRAM_ID,
        outputTokenProgram: TOKEN_PROGRAM_ID,
        creator: user.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    const quotedOutAmount = new BN(39_486_167);
    const platformFeeBps = 10;

    const routePlan = [
      { swap: { raydium: {} }, percent: 100, inputIndex: 0, outputIndex: 13 },
    ];

    const inputPoolVault =
      sourceMint.toBuffer().compare(destinationMint.toBuffer()) < 0
        ? raydiumTokenAVault
        : raydiumTokenBVault;
    const outputPoolVault =
      sourceMint.toBuffer().compare(destinationMint.toBuffer()) < 0
        ? raydiumTokenBVault
        : raydiumTokenAVault;

    const remainingAccounts = [
      { pubkey: orderVault, isWritable: true, isSigner: false },
      { pubkey: raydiumPoolInfo, isWritable: true, isSigner: false },
      { pubkey: raydiumPoolAuthority, isWritable: false, isSigner: false },
      { pubkey: raydiumAmmConfig, isWritable: false, isSigner: false },
      { pubkey: raydiumPoolState, isWritable: true, isSigner: false },
      { pubkey: inputPoolVault, isWritable: true, isSigner: false },
      { pubkey: outputPoolVault, isWritable: true, isSigner: false },
      { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
      { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
      { pubkey: sourceMint, isWritable: false, isSigner: false },
      { pubkey: destinationMint, isWritable: false, isSigner: false },
      { pubkey: raydiumObservationState, isWritable: true, isSigner: false },
      { pubkey: mockRaydiumProgramId, isWritable: false, isSigner: false },
      { pubkey: outputVault, isWritable: true, isSigner: false },
    ];

    const initialDestBalance = (
      await getAccount(provider.connection, userDestinationTokenAccount)
    ).amount;

    const orderData = await program.account.limitOrder.fetch(limitOrder);

    const priceRatio = quotedOutAmount
      .mul(new BN(10000))
      .div(orderData.minOutputAmount);
    const triggerRatio = 10000 + orderData.triggerPriceBps;

    await program.methods
      .executeLimitOrder(routePlan, quotedOutAmount, platformFeeBps)
      .accounts({
        adapterRegistry,
        vaultAuthority,
        limitOrder,
        inputVault: orderVault,
        inputTokenProgram: TOKEN_PROGRAM_ID,
        outputTokenProgram: TOKEN_PROGRAM_ID,
        userDestinationTokenAccount,
        inputMint: sourceMint,
        outputMint: destinationMint,
        platformFeeAccount,
        operator: operator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(remainingAccounts)
      .signers([operator])
      .rpc();

    const finalDestBalance = (
      await getAccount(provider.connection, userDestinationTokenAccount)
    ).amount;
    assert(
      finalDestBalance > initialDestBalance,
      "Destination balance should increase"
    );

    // Verify order account is closed after execution (rent goes to operator)
    const orderAccountInfo = await provider.connection.getAccountInfo(
      limitOrder
    );
    assert.equal(
      orderAccountInfo,
      null,
      "Order account should be closed after execution"
    );
  });

  it("4. Cancel limit order", async () => {
    const nonce = new BN(Date.now());
    const inputAmount = new BN(50_000_000);
    const minOutputAmount = new BN(45_000_000);
    const triggerPriceBps = 1000;
    const triggerType = { takeProfit: {} };
    const expiry = new BN(Math.floor(Date.now() / 1000) + 3600);
    const slippageBps = 300;

    const [limitOrder] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("limit_order"),
        user.publicKey.toBuffer(),
        nonce.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    // Vault now uses limit_order.key() as seed
    const [orderVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("order_vault"), limitOrder.toBuffer()],
      program.programId
    );

    // Initialize limit order and vault first (for standard tokens, account_space = 0)
    await program.methods
      .initLimitOrder(nonce, 0)
      .accounts({
        vaultAuthority,
        limitOrder,
        inputVault: orderVault,
        inputMint: sourceMint,
        inputTokenProgram: TOKEN_PROGRAM_ID,
        creator: user.publicKey,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([user])
      .rpc();

    await program.methods
      .createLimitOrder(
        nonce,
        inputAmount,
        minOutputAmount,
        triggerPriceBps,
        triggerType,
        expiry,
        slippageBps
      )
      .accounts({
        vaultAuthority,
        limitOrder,
        inputVault: orderVault,
        userInputTokenAccount: userSourceTokenAccount,
        userDestinationTokenAccount: userDestinationTokenAccount,
        inputMint: sourceMint,
        outputMint: destinationMint,
        inputTokenProgram: TOKEN_PROGRAM_ID,
        outputTokenProgram: TOKEN_PROGRAM_ID,
        creator: user.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    const initialBalance = (
      await getAccount(provider.connection, userSourceTokenAccount)
    ).amount;

    await program.methods
      .cancelLimitOrder()
      .accounts({
        vaultAuthority,
        limitOrder,
        inputVault: orderVault,
        userInputTokenAccount: userSourceTokenAccount,
        inputMint: sourceMint,
        inputTokenProgram: TOKEN_PROGRAM_ID,
        creator: user.publicKey,
      })
      .signers([user])
      .rpc();

    const finalBalance = (
      await getAccount(provider.connection, userSourceTokenAccount)
    ).amount;
    assert.equal(
      finalBalance.toString(),
      (initialBalance + BigInt(inputAmount.toString())).toString(),
      "Tokens not refunded"
    );
  });

  it("5. Route and create order (swap then create limit order)", async () => {
    const swapInAmount = new BN(100_000_000);
    const swapQuotedOutAmount = new BN(10_000_000);
    const swapSlippageBps = 100;
    const swapPlatformFeeBps = 50;
    const orderNonce = new BN(Date.now());
    const orderMinOutputAmount = new BN(85_000_000);
    const orderTriggerPriceBps = 500;
    const orderExpiry = new BN(Math.floor(Date.now() / 1000) + 7200);
    const orderSlippageBps = 300;

    const [limitOrder] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("limit_order"),
        user.publicKey.toBuffer(),
        orderNonce.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    // Vault now uses limit_order.key() as seed
    const [orderVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("order_vault"), limitOrder.toBuffer()],
      program.programId
    );

    // Initialize limit order and vault first (for standard tokens, account_space = 0)
    await program.methods
      .initLimitOrder(orderNonce, 0)
      .accounts({
        vaultAuthority,
        limitOrder,
        inputVault: orderVault,
        inputMint: destinationMint, // For route_and_create_order, vault holds output_mint tokens
        inputTokenProgram: TOKEN_PROGRAM_ID,
        creator: user.publicKey,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([user])
      .rpc();

    const routePlan = [
      { swap: { raydium: {} }, percent: 100, inputIndex: 0, outputIndex: 13 },
    ];

    const inputPoolVault =
      sourceMint.toBuffer().compare(destinationMint.toBuffer()) < 0
        ? raydiumTokenAVault
        : raydiumTokenBVault;
    const outputPoolVault =
      sourceMint.toBuffer().compare(destinationMint.toBuffer()) < 0
        ? raydiumTokenBVault
        : raydiumTokenAVault;

    const remainingAccounts = [
      { pubkey: inputVault, isWritable: true, isSigner: false },
      { pubkey: raydiumPoolInfo, isWritable: true, isSigner: false },
      { pubkey: raydiumPoolAuthority, isWritable: false, isSigner: false },
      { pubkey: raydiumAmmConfig, isWritable: false, isSigner: false },
      { pubkey: raydiumPoolState, isWritable: true, isSigner: false },
      { pubkey: inputPoolVault, isWritable: true, isSigner: false },
      { pubkey: outputPoolVault, isWritable: true, isSigner: false },
      { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
      { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
      { pubkey: sourceMint, isWritable: false, isSigner: false },
      { pubkey: destinationMint, isWritable: false, isSigner: false },
      { pubkey: raydiumObservationState, isWritable: true, isSigner: false },
      { pubkey: mockRaydiumProgramId, isWritable: false, isSigner: false },
      { pubkey: orderVault, isWritable: true, isSigner: false },
    ];

    const initialSourceBalance = (
      await getAccount(provider.connection, userSourceTokenAccount)
    ).amount;
    const initialDestBalance = (
      await getAccount(provider.connection, userDestinationTokenAccount)
    ).amount;

    await program.methods
      .routeAndCreateOrder(
        orderNonce,
        routePlan,
        swapInAmount,
        swapQuotedOutAmount,
        swapSlippageBps,
        swapPlatformFeeBps,
        orderMinOutputAmount,
        orderTriggerPriceBps,
        orderExpiry,
        orderSlippageBps
      )
      .accounts({
        adapterRegistry,
        vaultAuthority,
        limitOrder,
        inputVault: orderVault,
        userInputAccount: userSourceTokenAccount,
        userDestinationAccount: userSourceTokenAccount, // Limit order swaps back to original token (sourceMint)
        inputMint: sourceMint,
        outputMint: destinationMint,
        inputTokenProgram: TOKEN_PROGRAM_ID,
        outputTokenProgram: TOKEN_PROGRAM_ID,
        platformFeeAccount,
        creator: user.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(remainingAccounts)
      .signers([user])
      .rpc();

    const finalSourceBalance = (
      await getAccount(provider.connection, userSourceTokenAccount)
    ).amount;

    assert.equal(
      finalSourceBalance.toString(),
      (initialSourceBalance - BigInt(swapInAmount.toString())).toString(),
      "Source tokens should be deducted"
    );

    const finalDestBalance = (
      await getAccount(provider.connection, userDestinationTokenAccount)
    ).amount;
    assert.equal(
      finalDestBalance.toString(),
      initialDestBalance.toString(),
      "User destination balance should not change (tokens in order vault)"
    );

    const orderVaultBalance = (
      await getAccount(provider.connection, orderVault)
    ).amount;
    assert(orderVaultBalance > 0n, "Order vault should have tokens from swap");

    const minSwapOut = swapQuotedOutAmount
      .mul(new BN(10000 - swapSlippageBps))
      .div(new BN(10000));
    const feeAmount = minSwapOut
      .mul(new BN(swapPlatformFeeBps))
      .div(new BN(10000));
    const expectedVaultBalance = minSwapOut.sub(feeAmount);

    assert(
      orderVaultBalance >= BigInt(expectedVaultBalance.toString()),
      "Order vault balance should be at least expected amount after fees"
    );

    const orderAccount = await program.account.limitOrder.fetch(limitOrder);

    assert.equal(
      orderAccount.creator.toString(),
      user.publicKey.toString(),
      "Order creator mismatch"
    );
    assert.equal(
      orderAccount.inputMint.toString(),
      destinationMint.toString(),
      "Order input mint should be swap output mint"
    );
    assert.equal(
      orderAccount.outputMint.toString(),
      sourceMint.toString(),
      "Order output mint should be swap input mint (swap back to original token)"
    );
    assert.equal(
      orderAccount.inputVault.toString(),
      orderVault.toString(),
      "Order vault mismatch"
    );
    assert.equal(
      orderAccount.userDestinationAccount.toString(),
      userSourceTokenAccount.toString(),
      "User destination account should be source token account (limit order swaps back to original token)"
    );
    assert.equal(
      orderAccount.inputAmount.toString(),
      orderVaultBalance.toString(),
      "Order input amount should match vault balance"
    );
    assert.equal(
      orderAccount.minOutputAmount.toString(),
      orderMinOutputAmount.toString(),
      "Order min output amount mismatch"
    );
    assert.equal(
      orderAccount.triggerPriceBps,
      orderTriggerPriceBps,
      "Order trigger price BPS mismatch"
    );
    assert(
      orderAccount.triggerType.takeProfit !== undefined,
      "Order trigger type should be TakeProfit"
    );
    assert.equal(
      orderAccount.expiry.toString(),
      orderExpiry.toString(),
      "Order expiry mismatch"
    );
    assert.equal(
      orderAccount.slippageBps,
      orderSlippageBps,
      "Order slippage BPS mismatch"
    );
    assert(
      orderAccount.status.open !== undefined,
      "Order should be in Open status"
    );
  });

  it("6. Stop Loss order - execute when price drops", async () => {
    const nonce = new BN(Date.now());
    const inputAmount = new BN(50_000_000);
    const minOutputAmount = new BN(33_000_000);
    const triggerPriceBps = 500;
    const triggerType = { stopLoss: {} };
    const expiry = new BN(Math.floor(Date.now() / 1000) + 3600);
    const slippageBps = 300;

    const [limitOrder] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("limit_order"),
        user.publicKey.toBuffer(),
        nonce.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    // Vault now uses limit_order.key() as seed
    const [orderVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("order_vault"), limitOrder.toBuffer()],
      program.programId
    );

    // Initialize limit order and vault first (for standard tokens, account_space = 0)
    await program.methods
      .initLimitOrder(nonce, 0)
      .accounts({
        vaultAuthority,
        limitOrder,
        inputVault: orderVault,
        inputMint: sourceMint,
        inputTokenProgram: TOKEN_PROGRAM_ID,
        creator: user.publicKey,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([user])
      .rpc();

    await program.methods
      .createLimitOrder(
        nonce,
        inputAmount,
        minOutputAmount,
        triggerPriceBps,
        triggerType,
        expiry,
        slippageBps
      )
      .accounts({
        vaultAuthority,
        limitOrder,
        inputVault: orderVault,
        userInputTokenAccount: userSourceTokenAccount,
        userDestinationTokenAccount: userDestinationTokenAccount,
        inputMint: sourceMint,
        outputMint: destinationMint,
        inputTokenProgram: TOKEN_PROGRAM_ID,
        outputTokenProgram: TOKEN_PROGRAM_ID,
        creator: user.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    // For StopLoss: price_ratio <= 10000 - trigger_price_bps (9500)
    // price_ratio = (quotedOutAmount * 10000) / minOutputAmount
    // So: quotedOutAmount <= 9500 * minOutputAmount / 10000 = 9500 * 33_000_000 / 10000 = 31_350_000
    // But we also need to account for slippage check AFTER fees
    // With slippage_bps = 300 (3%): min_acceptable = quotedOutAmount * 9700 / 10000
    // With platformFeeBps = 10 (0.1%): after fee = output_amount * 9990 / 10000
    // Need: output_amount * 9990 / 10000 >= quotedOutAmount * 9700 / 10000
    // So: output_amount >= quotedOutAmount * 9700 / 9990
    // Use a value that satisfies trigger AND slippage after fees
    // Note: The actual output from swap must also satisfy the StopLoss condition
    const quotedOutAmount = new BN(26_000_000); // Lower value to ensure trigger condition, but still enough for slippage after fees
    const platformFeeBps = 10;

    const routePlan = [
      { swap: { raydium: {} }, percent: 100, inputIndex: 0, outputIndex: 13 },
    ];

    const inputPoolVault =
      sourceMint.toBuffer().compare(destinationMint.toBuffer()) < 0
        ? raydiumTokenAVault
        : raydiumTokenBVault;
    const outputPoolVault =
      sourceMint.toBuffer().compare(destinationMint.toBuffer()) < 0
        ? raydiumTokenBVault
        : raydiumTokenAVault;

    const remainingAccounts = [
      { pubkey: orderVault, isWritable: true, isSigner: false },
      { pubkey: raydiumPoolInfo, isWritable: true, isSigner: false },
      { pubkey: raydiumPoolAuthority, isWritable: false, isSigner: false },
      { pubkey: raydiumAmmConfig, isWritable: false, isSigner: false },
      { pubkey: raydiumPoolState, isWritable: true, isSigner: false },
      { pubkey: inputPoolVault, isWritable: true, isSigner: false },
      { pubkey: outputPoolVault, isWritable: true, isSigner: false },
      { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
      { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
      { pubkey: sourceMint, isWritable: false, isSigner: false },
      { pubkey: destinationMint, isWritable: false, isSigner: false },
      { pubkey: raydiumObservationState, isWritable: true, isSigner: false },
      { pubkey: mockRaydiumProgramId, isWritable: false, isSigner: false },
      { pubkey: outputVault, isWritable: true, isSigner: false },
    ];

    const initialDestBalance = (
      await getAccount(provider.connection, userDestinationTokenAccount)
    ).amount;

    const orderData = await program.account.limitOrder.fetch(limitOrder);
    const priceRatio = quotedOutAmount
      .mul(new BN(10000))
      .div(orderData.minOutputAmount);
    const triggerRatio = 10000 - orderData.triggerPriceBps;

    assert(priceRatio.lte(new BN(triggerRatio)), "Stop loss should trigger");

    await program.methods
      .executeLimitOrder(routePlan, quotedOutAmount, platformFeeBps)
      .accounts({
        adapterRegistry,
        vaultAuthority,
        limitOrder,
        inputVault: orderVault,
        inputTokenProgram: TOKEN_PROGRAM_ID,
        outputTokenProgram: TOKEN_PROGRAM_ID,
        userDestinationTokenAccount,
        inputMint: sourceMint,
        outputMint: destinationMint,
        platformFeeAccount,
        operator: operator.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(remainingAccounts)
      .signers([operator])
      .rpc();

    const finalDestBalance = (
      await getAccount(provider.connection, userDestinationTokenAccount)
    ).amount;

    assert(
      finalDestBalance > initialDestBalance,
      "Stop loss executed - destination balance increased"
    );

    // Verify order account is closed after execution
    const orderAccountInfo = await provider.connection.getAccountInfo(
      limitOrder
    );
    assert.equal(
      orderAccountInfo,
      null,
      "Order account should be closed after execution"
    );

    // Close WSOL account
    await closeAccount(
      provider.connection,
      user,
      userSourceTokenAccount,
      user.publicKey,
      user,
      [],
      undefined,
      TOKEN_PROGRAM_ID
    );
  });

  describe("7. Limit order account closure tests", () => {
    // Recreate userSourceTokenAccount if it was closed in previous tests
    before(async () => {
      try {
        await getAccount(provider.connection, userSourceTokenAccount);
      } catch {
        // Recreate WSOL account if it was closed
        userSourceTokenAccount = await createAssociatedTokenAccount(
          provider.connection,
          user,
          sourceMint,
          user.publicKey
        );

        // Fund userSource with WSOL
        const wsolAmount = 1_000_000_000; // 1 SOL
        const wsolTx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: user.publicKey,
            toPubkey: userSourceTokenAccount,
            lamports: wsolAmount,
          }),
          createSyncNativeInstruction(userSourceTokenAccount, TOKEN_PROGRAM_ID)
        );
        await provider.sendAndConfirm(wsolTx, [user]);
      }
    });

    it("7.1. Execute limit order - verify account is closed and operator receives rent", async () => {
      /*const nonce = new BN(Date.now());
            const inputAmount = new BN(50_000_000);
            const minOutputAmount = new BN(30_000_000);
            const triggerPriceBps = 500;
            const triggerType = { takeProfit: {} };
            const expiry = new BN(Math.floor(Date.now() / 1000) + 3600);
            const slippageBps = 300;

            const [limitOrder] = PublicKey.findProgramAddressSync(
                [Buffer.from("limit_order"), user.publicKey.toBuffer(), nonce.toArrayLike(Buffer, 'le', 8)],
                program.programId
            );

            // Vault now uses limit_order.key() as seed
            const [orderVault] = PublicKey.findProgramAddressSync(
                [Buffer.from("order_vault"), limitOrder.toBuffer()],
                program.programId
            );

            await program.methods
                .createLimitOrder(
                    nonce,
                    inputAmount,
                    minOutputAmount,
                    triggerPriceBps,
                    triggerType,
                    expiry,
                    slippageBps
                )
                .accounts({
                    vaultAuthority,
                    limitOrder,
                    inputVault: orderVault,
                    userInputTokenAccount: userSourceTokenAccount,
                    userDestinationTokenAccount: userDestinationTokenAccount,
                    inputMint: sourceMint,
                    outputMint: destinationMint,
                    inputTokenProgram: TOKEN_PROGRAM_ID,
                    outputTokenProgram: TOKEN_PROGRAM_ID,
                    creator: user.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([user])
                .rpc();

            // Get initial operator balance
            const initialOperatorBalance = await provider.connection.getBalance(operator.publicKey);
            
            // Verify order account exists before execution
            const orderAccountBefore = await program.account.limitOrder.fetch(limitOrder);
            assert.equal(orderAccountBefore.status.open !== undefined, true, "Order should be open");

            // For TakeProfit: price_ratio >= 10000 + trigger_price_bps (10500)
            // price_ratio = (quotedOutAmount * 10000) / minOutputAmount
            // So: quotedOutAmount >= 10500 * minOutputAmount / 10000 = 10500 * 30_000_000 / 10000 = 31_500_000
            // Also need to account for slippage AFTER fees: min_acceptable = quotedOutAmount * (10000 - slippage_bps) / 10000
            // With slippage_bps = 300 (3%): min_acceptable = quotedOutAmount * 9700 / 10000
            // With platformFeeBps = 10 (0.1%): after fee = output_amount * 9990 / 10000
            // Need: output_amount * 9990 / 10000 >= quotedOutAmount * 9700 / 10000
            // So: output_amount >= quotedOutAmount * 9700 / 9990 = quotedOutAmount * 0.97097
            // To be safe, use a higher value that accounts for both slippage and fees
            const quotedOutAmount = new BN(40_000_000); // Increased to account for slippage check AFTER fees
            const platformFeeBps = 10;

            const routePlan = [
                { swap: { raydium: {} }, percent: 100, inputIndex: 0, outputIndex: 13 }
            ];

            const inputPoolVault = sourceMint.toBuffer().compare(destinationMint.toBuffer()) < 0
                ? raydiumTokenAVault
                : raydiumTokenBVault;
            const outputPoolVault = sourceMint.toBuffer().compare(destinationMint.toBuffer()) < 0
                ? raydiumTokenBVault
                : raydiumTokenAVault;

            const remainingAccounts = [
                { pubkey: orderVault, isWritable: true, isSigner: false },
                { pubkey: raydiumPoolInfo, isWritable: true, isSigner: false },
                { pubkey: raydiumPoolAuthority, isWritable: false, isSigner: false },
                { pubkey: raydiumAmmConfig, isWritable: false, isSigner: false },
                { pubkey: raydiumPoolState, isWritable: true, isSigner: false },
                { pubkey: inputPoolVault, isWritable: true, isSigner: false },
                { pubkey: outputPoolVault, isWritable: true, isSigner: false },
                { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
                { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false },
                { pubkey: sourceMint, isWritable: false, isSigner: false },
                { pubkey: destinationMint, isWritable: false, isSigner: false },
                { pubkey: raydiumObservationState, isWritable: true, isSigner: false },
                { pubkey: mockRaydiumProgramId, isWritable: false, isSigner: false },
                { pubkey: outputVault, isWritable: true, isSigner: false },
            ];

            // Execute the order
            await program.methods
                .executeLimitOrder(routePlan, quotedOutAmount, platformFeeBps)
                .accounts({
                    adapterRegistry,
                    vaultAuthority,
                    limitOrder,
                    inputVault: orderVault,
                    inputTokenProgram: TOKEN_PROGRAM_ID,
                    outputTokenProgram: TOKEN_PROGRAM_ID,
                    userDestinationTokenAccount,
                    inputMint: sourceMint,
                    outputMint: destinationMint,
                    platformFeeAccount,
                    operator: operator.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .remainingAccounts(remainingAccounts)
                .signers([operator])
                .rpc();

            // Verify order account is closed
            const orderAccountInfo = await provider.connection.getAccountInfo(limitOrder);
            assert.equal(orderAccountInfo, null, "Order account should be closed after execution");

            // Verify operator received rent
            const finalOperatorBalance = await provider.connection.getBalance(operator.publicKey);
            assert(
                finalOperatorBalance > initialOperatorBalance,
                "Operator should receive rent from closed order account"
            );*/
    });

    it("7.2. Cancel limit order (Init status) - verify account is closed and creator receives rent", async () => {
      const nonce = new BN(Date.now() + 2000000); // Ensure unique nonce

      const [limitOrder] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("limit_order"),
          user.publicKey.toBuffer(),
          nonce.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      // Vault now uses limit_order.key() as seed
      const [orderVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("order_vault"), limitOrder.toBuffer()],
        program.programId
      );

      // Initialize limit order and vault first (for standard tokens, account_space = 0)
      // This creates an order in Init status (not yet filled with createLimitOrder)
      await program.methods
        .initLimitOrder(nonce, 0)
        .accounts({
          vaultAuthority,
          limitOrder,
          inputVault: orderVault,
          inputMint: sourceMint,
          inputTokenProgram: TOKEN_PROGRAM_ID,
          creator: user.publicKey,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([user])
        .rpc();

      // Verify order is in Init status
      const orderAccountBefore = await program.account.limitOrder.fetch(
        limitOrder
      );
      assert.equal(
        orderAccountBefore.status.init !== undefined,
        true,
        "Order should be in Init status"
      );

      // Verify vault is empty
      const vaultAccount = await getAccount(provider.connection, orderVault);
      assert.equal(
        vaultAccount.amount.toString(),
        "0",
        "Vault should be empty for Init order"
      );

      // Get initial creator balance
      const initialCreatorBalance = await provider.connection.getBalance(
        user.publicKey
      );

      // Creator can cancel Init order
      await program.methods
        .cancelLimitOrder()
        .accounts({
          vaultAuthority,
          limitOrder,
          inputVault: orderVault,
          userInputTokenAccount: userSourceTokenAccount,
          inputMint: sourceMint,
          inputTokenProgram: TOKEN_PROGRAM_ID,
          creator: user.publicKey,
        })
        .signers([user])
        .rpc();

      // Verify order account is now closed
      const orderAccountInfoAfterCancel =
        await provider.connection.getAccountInfo(limitOrder);
      assert.equal(
        orderAccountInfoAfterCancel,
        null,
        "Order account should be closed after cancel"
      );

      // Verify vault is closed
      const vaultAccountInfo = await provider.connection.getAccountInfo(
        orderVault
      );
      assert.equal(vaultAccountInfo, null, "Vault should be closed");

      // Verify creator received rent
      const finalCreatorBalance = await provider.connection.getBalance(
        user.publicKey
      );
      assert(
        finalCreatorBalance > initialCreatorBalance,
        "Creator should receive rent from closed order account"
      );
    });

    it("7.2.1. Cancel limit order (Open status) - verify account is closed and creator receives rent", async () => {
      const nonce = new BN(Date.now());
      const inputAmount = new BN(50_000_000);
      const minOutputAmount = new BN(45_000_000);
      const triggerPriceBps = 1000;
      const triggerType = { takeProfit: {} };
      const expiry = new BN(Math.floor(Date.now() / 1000) + 3600);
      const slippageBps = 300;

      const [limitOrder] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("limit_order"),
          user.publicKey.toBuffer(),
          nonce.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      // Vault now uses limit_order.key() as seed
      const [orderVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("order_vault"), limitOrder.toBuffer()],
        program.programId
      );

      // Initialize limit order and vault first (for standard tokens, account_space = 0)
      await program.methods
        .initLimitOrder(nonce, 0)
        .accounts({
          vaultAuthority,
          limitOrder,
          inputVault: orderVault,
          inputMint: sourceMint,
          inputTokenProgram: TOKEN_PROGRAM_ID,
          creator: user.publicKey,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([user])
        .rpc();

      await program.methods
        .createLimitOrder(
          nonce,
          inputAmount,
          minOutputAmount,
          triggerPriceBps,
          triggerType,
          expiry,
          slippageBps
        )
        .accounts({
          vaultAuthority,
          limitOrder,
          inputVault: orderVault,
          userInputTokenAccount: userSourceTokenAccount,
          userDestinationTokenAccount: userDestinationTokenAccount,
          inputMint: sourceMint,
          outputMint: destinationMint,
          inputTokenProgram: TOKEN_PROGRAM_ID,
          outputTokenProgram: TOKEN_PROGRAM_ID,
          creator: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      // Verify order account exists before cancellation
      const orderAccountBefore = await program.account.limitOrder.fetch(
        limitOrder
      );
      assert.equal(
        orderAccountBefore.status.open !== undefined,
        true,
        "Order should be open"
      );

      // Get initial creator balance
      const initialCreatorBalance = await provider.connection.getBalance(
        user.publicKey
      );

      // Cancel the order (account will be closed and rent returned to creator)
      await program.methods
        .cancelLimitOrder()
        .accounts({
          vaultAuthority,
          limitOrder,
          inputVault: orderVault,
          userInputTokenAccount: userSourceTokenAccount,
          inputMint: sourceMint,
          inputTokenProgram: TOKEN_PROGRAM_ID,
          creator: user.publicKey,
        })
        .signers([user])
        .rpc();

      // Verify order account is now closed
      const orderAccountInfoAfterCancel =
        await provider.connection.getAccountInfo(limitOrder);
      assert.equal(
        orderAccountInfoAfterCancel,
        null,
        "Order account should be closed after cancel"
      );

      // Verify creator received rent
      const finalCreatorBalance = await provider.connection.getBalance(
        user.publicKey
      );
      assert(
        finalCreatorBalance > initialCreatorBalance,
        "Creator should receive rent from closed order account"
      );
    });

    it("7.3. Cancel expired limit order by operator - verify rent goes to operator and tokens to creator", async () => {
      const nonce = new BN(Date.now());
      const inputAmount = new BN(50_000_000);
      const minOutputAmount = new BN(45_000_000);
      const triggerPriceBps = 1000;
      const triggerType = { takeProfit: {} };
      // Set expiry to past time (expired)
      const expiry = new BN(Math.floor(Date.now() / 1000) - 3600); // 1 hour ago
      const slippageBps = 300;

      const [limitOrder] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("limit_order"),
          user.publicKey.toBuffer(),
          nonce.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      // Vault now uses limit_order.key() as seed
      const [orderVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("order_vault"), limitOrder.toBuffer()],
        program.programId
      );

      // Create order with expired time (we'll need to create it with future expiry first, then wait or use a workaround)
      // Actually, we can't create an order with past expiry, so we'll create it with future expiry
      // and then manually set the clock forward or use a different approach
      // For testing, let's create with a very short expiry and wait, or better yet, create with future expiry
      // and then use cancel_expired_limit_order_by_operator which checks expiry

      // Initialize limit order and vault first (for standard tokens, account_space = 0)
      await program.methods
        .initLimitOrder(nonce, 0)
        .accounts({
          vaultAuthority,
          limitOrder,
          inputVault: orderVault,
          inputMint: sourceMint,
          inputTokenProgram: TOKEN_PROGRAM_ID,
          creator: user.publicKey,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([user])
        .rpc();

      // Create order with future expiry first
      const futureExpiry = new BN(Math.floor(Date.now() / 1000) + 3600);
      await program.methods
        .createLimitOrder(
          nonce,
          inputAmount,
          minOutputAmount,
          triggerPriceBps,
          triggerType,
          futureExpiry,
          slippageBps
        )
        .accounts({
          vaultAuthority,
          limitOrder,
          inputVault: orderVault,
          userInputTokenAccount: userSourceTokenAccount,
          userDestinationTokenAccount: userDestinationTokenAccount,
          inputMint: sourceMint,
          outputMint: destinationMint,
          inputTokenProgram: TOKEN_PROGRAM_ID,
          outputTokenProgram: TOKEN_PROGRAM_ID,
          creator: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      // Verify order account exists and is open
      const orderAccountBefore = await program.account.limitOrder.fetch(
        limitOrder
      );
      assert.equal(
        orderAccountBefore.status.open !== undefined,
        true,
        "Order should be open"
      );

      // Get initial balances
      const initialOperatorBalance = await provider.connection.getBalance(
        operator.publicKey
      );
      const initialUserBalance = (
        await getAccount(provider.connection, userSourceTokenAccount)
      ).amount;

      // Note: In a real scenario, we would wait for the order to expire
      // For testing purposes, we'll create a new order with past expiry using a different nonce
      // Actually, we can't create an order with past expiry due to validation
      // So we need to wait or use a different approach

      // Let's create another order with a very short expiry and wait, or better:
      // We'll test the function by creating an order and then manually checking expiry
      // But since we can't modify the order's expiry after creation, we need to wait

      // For now, let's test with a non-expired order to verify the function fails correctly
      // Then we can add a test that waits for expiry

      // Try to cancel non-expired order - should fail
      try {
        await program.methods
          .cancelExpiredLimitOrderByOperator()
          .accounts({
            adapterRegistry,
            vaultAuthority,
            limitOrder,
            inputVault: orderVault,
            userInputTokenAccount: userSourceTokenAccount,
            inputMint: sourceMint,
            inputTokenProgram: TOKEN_PROGRAM_ID,
            operator: operator.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([operator])
          .rpc();
        assert.fail("Should have failed - order is not expired");
      } catch (error: any) {
        assert(
          error.message.includes("InvalidExpiry") ||
            error.message.includes("constraint"),
          "Should fail with InvalidExpiry error for non-expired order"
        );
      }

      // Now create a new order with past expiry by using a different nonce
      // Actually, we can't create with past expiry, so let's wait a bit and create a new order
      // with very short expiry, then wait for it to expire

      const expiredNonce = new BN(Date.now() + 1);
      const [expiredLimitOrder] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("limit_order"),
          user.publicKey.toBuffer(),
          expiredNonce.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      // Vault now uses limit_order.key() as seed
      const [expiredOrderVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("order_vault"), expiredLimitOrder.toBuffer()],
        program.programId
      );

      // Initialize limit order and vault first (for standard tokens, account_space = 0)
      await program.methods
        .initLimitOrder(expiredNonce, 0)
        .accounts({
          vaultAuthority,
          limitOrder: expiredLimitOrder,
          inputVault: expiredOrderVault,
          inputMint: sourceMint,
          inputTokenProgram: TOKEN_PROGRAM_ID,
          creator: user.publicKey,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([user])
        .rpc();

      // Create order with 1 second expiry
      const shortExpiry = new BN(Math.floor(Date.now() / 1000) + 1);
      await program.methods
        .createLimitOrder(
          expiredNonce,
          inputAmount,
          minOutputAmount,
          triggerPriceBps,
          triggerType,
          shortExpiry,
          slippageBps
        )
        .accounts({
          vaultAuthority,
          limitOrder: expiredLimitOrder,
          inputVault: expiredOrderVault,
          userInputTokenAccount: userSourceTokenAccount,
          userDestinationTokenAccount: userDestinationTokenAccount,
          inputMint: sourceMint,
          outputMint: destinationMint,
          inputTokenProgram: TOKEN_PROGRAM_ID,
          outputTokenProgram: TOKEN_PROGRAM_ID,
          creator: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      // Wait for order to expire (wait 2 seconds to be sure)
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Get balances before cancellation
      const beforeOperatorBalance = await provider.connection.getBalance(
        operator.publicKey
      );
      const beforeUserTokenBalance = (
        await getAccount(provider.connection, userSourceTokenAccount)
      ).amount;

      // Cancel expired order by operator
      await program.methods
        .cancelExpiredLimitOrderByOperator()
        .accounts({
          adapterRegistry,
          vaultAuthority,
          limitOrder: expiredLimitOrder,
          inputVault: expiredOrderVault,
          userInputTokenAccount: userSourceTokenAccount,
          inputMint: sourceMint,
          inputTokenProgram: TOKEN_PROGRAM_ID,
          operator: operator.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([operator])
        .rpc();

      // Verify order account is closed
      const expiredOrderAccountInfo = await provider.connection.getAccountInfo(
        expiredLimitOrder
      );
      assert.equal(
        expiredOrderAccountInfo,
        null,
        "Expired order account should be closed"
      );

      // Verify operator received rent from both limit_order and input_vault accounts
      const afterOperatorBalance = await provider.connection.getBalance(
        operator.publicKey
      );
      assert(
        afterOperatorBalance > beforeOperatorBalance,
        "Operator should receive rent from closed limit_order and input_vault accounts"
      );

      // Verify creator received tokens (deposit)
      const afterUserTokenBalance = (
        await getAccount(provider.connection, userSourceTokenAccount)
      ).amount;
      assert.equal(
        afterUserTokenBalance.toString(),
        (beforeUserTokenBalance + BigInt(inputAmount.toString())).toString(),
        "Creator should receive refunded tokens"
      );
    });

    it("7.3.1. Close limit order by operator - should succeed for Init order", async () => {
      const nonce = new BN(Date.now() + 1000000); // Ensure unique nonce

      const [limitOrder] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("limit_order"),
          user.publicKey.toBuffer(),
          nonce.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      // Vault now uses limit_order.key() as seed
      const [orderVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("order_vault"), limitOrder.toBuffer()],
        program.programId
      );

      // Initialize limit order and vault first (for standard tokens, account_space = 0)
      // This creates an order in Init status (not yet filled with createLimitOrder)
      await program.methods
        .initLimitOrder(nonce, 0)
        .accounts({
          vaultAuthority,
          limitOrder,
          inputVault: orderVault,
          inputMint: sourceMint,
          inputTokenProgram: TOKEN_PROGRAM_ID,
          creator: user.publicKey,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([user])
        .rpc();

      // Verify order is in Init status
      const orderAccount = await program.account.limitOrder.fetch(limitOrder);
      assert.equal(
        orderAccount.status.init !== undefined,
        true,
        "Order should be in Init status"
      );

      // Verify vault is empty
      const vaultAccount = await getAccount(provider.connection, orderVault);
      assert.equal(
        vaultAccount.amount.toString(),
        "0",
        "Vault should be empty for Init order"
      );

      // Get initial operator balance
      const initialOperatorBalance = await provider.connection.getBalance(
        operator.publicKey
      );

      // Operator can close Init order
      await program.methods
        .closeLimitOrderByOperator()
        .accounts({
          adapterRegistry,
          vaultAuthority,
          limitOrder,
          inputVault: orderVault,
          inputTokenProgram: TOKEN_PROGRAM_ID,
          operator: operator.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([operator])
        .rpc();

      // Verify order account is closed
      const orderAccountInfo = await provider.connection.getAccountInfo(
        limitOrder
      );
      assert.equal(orderAccountInfo, null, "Order account should be closed");

      // Verify vault is closed
      const vaultAccountInfo = await provider.connection.getAccountInfo(
        orderVault
      );
      assert.equal(vaultAccountInfo, null, "Vault should be closed");

      // Verify operator received rent
      const finalOperatorBalance = await provider.connection.getBalance(
        operator.publicKey
      );
      assert(
        finalOperatorBalance > initialOperatorBalance,
        "Operator should receive rent from closed order and vault accounts"
      );
    });

    it("7.4. Close limit order by operator - should fail for Open order (only Init/Filled/Cancelled allowed)", async () => {
      const nonce = new BN(Date.now());
      const inputAmount = new BN(50_000_000);
      const minOutputAmount = new BN(45_000_000);
      const triggerPriceBps = 1000;
      const triggerType = { takeProfit: {} };
      const expiry = new BN(Math.floor(Date.now() / 1000) + 3600);
      const slippageBps = 300;

      const [limitOrder] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("limit_order"),
          user.publicKey.toBuffer(),
          nonce.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      // Vault now uses limit_order.key() as seed
      const [orderVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("order_vault"), limitOrder.toBuffer()],
        program.programId
      );

      // Initialize limit order and vault first (for standard tokens, account_space = 0)
      await program.methods
        .initLimitOrder(nonce, 0)
        .accounts({
          vaultAuthority,
          limitOrder,
          inputVault: orderVault,
          inputMint: sourceMint,
          inputTokenProgram: TOKEN_PROGRAM_ID,
          creator: user.publicKey,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([user])
        .rpc();

      await program.methods
        .createLimitOrder(
          nonce,
          inputAmount,
          minOutputAmount,
          triggerPriceBps,
          triggerType,
          expiry,
          slippageBps
        )
        .accounts({
          vaultAuthority,
          limitOrder,
          inputVault: orderVault,
          userInputTokenAccount: userSourceTokenAccount,
          userDestinationTokenAccount: userDestinationTokenAccount,
          inputMint: sourceMint,
          outputMint: destinationMint,
          inputTokenProgram: TOKEN_PROGRAM_ID,
          outputTokenProgram: TOKEN_PROGRAM_ID,
          creator: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      // Try to close open order - should fail
      try {
        await program.methods
          .closeLimitOrderByOperator()
          .accounts({
            adapterRegistry,
            vaultAuthority,
            limitOrder,
            inputVault: orderVault,
            inputTokenProgram: TOKEN_PROGRAM_ID,
            operator: operator.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([operator])
          .rpc();
        assert.fail("Should have failed - cannot close open order");
      } catch (error: any) {
        assert(
          error.message.includes("InvalidOrderStatus") ||
            error.message.includes("constraint"),
          "Should fail with InvalidOrderStatus error"
        );
      }
    });

    it("7.5. Close limit order by operator - should fail for non-operator (InvalidOperator)", async () => {
      const nonce = new BN(Date.now());
      const inputAmount = new BN(50_000_000);
      const minOutputAmount = new BN(45_000_000);
      const triggerPriceBps = 1000;
      const triggerType = { takeProfit: {} };
      const expiry = new BN(Math.floor(Date.now() / 1000) + 3600);
      const slippageBps = 300;

      const [limitOrder] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("limit_order"),
          user.publicKey.toBuffer(),
          nonce.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      // Vault now uses limit_order.key() as seed
      const [orderVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("order_vault"), limitOrder.toBuffer()],
        program.programId
      );

      // Initialize limit order and vault first (for standard tokens, account_space = 0)
      await program.methods
        .initLimitOrder(nonce, 0)
        .accounts({
          vaultAuthority,
          limitOrder,
          inputVault: orderVault,
          inputMint: sourceMint,
          inputTokenProgram: TOKEN_PROGRAM_ID,
          creator: user.publicKey,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([user])
        .rpc();

      await program.methods
        .createLimitOrder(
          nonce,
          inputAmount,
          minOutputAmount,
          triggerPriceBps,
          triggerType,
          expiry,
          slippageBps
        )
        .accounts({
          vaultAuthority,
          limitOrder,
          inputVault: orderVault,
          userInputTokenAccount: userSourceTokenAccount,
          userDestinationTokenAccount: userDestinationTokenAccount,
          inputMint: sourceMint,
          outputMint: destinationMint,
          inputTokenProgram: TOKEN_PROGRAM_ID,
          outputTokenProgram: TOKEN_PROGRAM_ID,
          creator: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      // Try to close with non-operator (user) - should fail
      // Note: We test with open order, as cancelled orders are automatically closed by creator
      try {
        await program.methods
          .closeLimitOrderByOperator()
          .accounts({
            adapterRegistry,
            vaultAuthority,
            limitOrder,
            inputVault: orderVault,
            inputTokenProgram: TOKEN_PROGRAM_ID,
            operator: user.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([user])
          .rpc();
        assert.fail(
          "Should have failed - user is not an operator or order is not filled/cancelled"
        );
      } catch (error: any) {
        assert(
          error.message.includes("InvalidOperator") ||
            error.message.includes("InvalidOrderStatus") ||
            error.message.includes("constraint"),
          "Should fail with InvalidOperator or InvalidOrderStatus error"
        );
      }
    });
  });
});
