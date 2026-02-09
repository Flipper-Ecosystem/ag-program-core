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
} from "@solana/spl-token";
import { assert } from "chai";
import { Flipper } from "../target/types/flipper";

describe("Flipper Swap Protocol - Raydium Swap and Limit Orders", () => {
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
  let destinationMint: PublicKey;
  let userSourceTokenAccount: PublicKey;
  let userDestinationTokenAccount: PublicKey;
  let inputVault: PublicKey;
  let outputVault: PublicKey;
  let platformFeeAccount: PublicKey;
  let mockRaydiumProgramId: PublicKey;
  let raydiumPoolInfo: PublicKey;
  let raydiumAmmConfig: PublicKey;
  let raydiumPoolState: PublicKey;
  let raydiumPoolAuthority: PublicKey;
  let raydiumTokenAVault: PublicKey;
  let raydiumTokenBVault: PublicKey;
  let raydiumObservationState: PublicKey;

  // Mock programs
  const mockRaydiumProgram = anchor.workspace.MockRaydium;

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

    [outputVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), destinationMint.toBuffer()],
      program.programId
    );

    // Create vaults
    for (const [vault, mint] of [
      [inputVault, sourceMint],
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

    userDestinationTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      user,
      destinationMint,
      user.publicKey
    );

    // Mint to user and vaults
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
      destinationMint,
      outputVault,
      wallet.publicKey,
      1_000_000_000_000
    );

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
          op.equals(wallet.publicKey)
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

    // Configure Raydium adapter
    await program.methods
      .configureAdapter({
        name: "raydium",
        programId: mockRaydiumProgramId,
        swapType: { raydium: {} },
      })
      .accounts({
        adapterRegistry,
        operator: wallet.publicKey,
      })
      .signers([wallet.payer])
      .rpc();

    // Setup mock pools
    // Raydium: source -> destination
    const [tokenAMint, tokenBMint] =
      sourceMint.toString() < destinationMint.toString()
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

    //console.log("✓ Setup complete");
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
      sourceMint.toString() < destinationMint.toString()
        ? raydiumTokenAVault
        : raydiumTokenBVault;

    const outputPoolVault =
      sourceMint.toString() < destinationMint.toString()
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

    // Convert BN to BigInt for operations
    const inAmountBN = BigInt(inAmount.toString());

    // Calculate expected output with slippage
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
      finalDest > initialDest + expectedOutAmount,
      "Destination balance incorrect"
    );

    //console.log("✓ Single-hop swap completed successfully");
  });

  it("2. Create limit order (Take Profit)", async () => {
    const nonce = new BN(Date.now());
    const inputAmount = new BN(50_000_000);
    const minOutputAmount = new BN(45_000_000);
    const triggerPriceBps = 1000; // 10% price increase
    const triggerType = { takeProfit: {} };
    const expiry = new BN(Math.floor(Date.now() / 1000) + 3600); // 1 hour
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

    //console.log("✓ Limit order created successfully");
  });

  it("3. Execute limit order when trigger met", async () => {
    const nonce = new BN(Date.now());
    const inputAmount = new BN(50_000_000);
    const minOutputAmount = new BN(30_000_000);
    const triggerPriceBps = 500; // 5% price increase
    const triggerType = { takeProfit: {} };
    const expiry = new BN(Math.floor(Date.now() / 1000) + 3600);
    const slippageBps = 300;

    // Create order
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

    // Execute order
    const quotedOutAmount = new BN(39_486_167);
    const platformFeeBps = 10; // 0.1%

    const routePlan = [
      { swap: { raydium: {} }, percent: 100, inputIndex: 0, outputIndex: 13 },
    ];

    const inputPoolVault =
      sourceMint.toString() < destinationMint.toString()
        ? raydiumTokenAVault
        : raydiumTokenBVault;
    const outputPoolVault =
      sourceMint.toString() < destinationMint.toString()
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
        inputMint: sourceMint, // For createLimitOrder: order.input_mint = sourceMint
        outputMint: destinationMint, // For createLimitOrder: order.output_mint = destinationMint
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

    //console.log("✓ Limit order executed successfully");
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

    // Create order
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

    // Cancel order
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

    //console.log("✓ Limit order cancelled successfully");
  });

  it("5. Route and create order (swap then create limit order)", async () => {
    const swapInAmount = new BN(100_000_000); // 100 source tokens
    const swapQuotedOutAmount = new BN(10_000_000); // ~10 destination tokens expected
    const swapSlippageBps = 100; // 1% slippage for swap
    const swapPlatformFeeBps = 50; // 0.5% platform fee

    // Parameters for limit order
    const orderNonce = new BN(Date.now());
    const orderMinOutputAmount = new BN(85_000_000); // baseline for trigger
    const orderTriggerPriceBps = 500; // 5% price increase for take profit
    const orderExpiry = new BN(Math.floor(Date.now() / 1000) + 7200); // 2 hours
    const orderSlippageBps = 300; // 3% slippage for order execution

    // Derive accounts
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

    // Route plan for swap source -> destination
    const routePlan = [
      { swap: { raydium: {} }, percent: 100, inputIndex: 0, outputIndex: 13 },
    ];

    const inputPoolVault =
      sourceMint.toString() < destinationMint.toString()
        ? raydiumTokenAVault
        : raydiumTokenBVault;
    const outputPoolVault =
      sourceMint.toString() < destinationMint.toString()
        ? raydiumTokenBVault
        : raydiumTokenAVault;

    // Remaining accounts for swap
    const remainingAccounts = [
      { pubkey: inputVault, isWritable: true, isSigner: false }, // index 0: temp input vault
      { pubkey: raydiumPoolInfo, isWritable: true, isSigner: false }, // index 1
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
      { pubkey: mockRaydiumProgramId, isWritable: false, isSigner: false }, // index 12
      { pubkey: orderVault, isWritable: true, isSigner: false }, // index 13: output goes to order vault
    ];

    // Initial balances
    const initialSourceBalance = (
      await getAccount(provider.connection, userSourceTokenAccount)
    ).amount;
    const initialDestBalance = (
      await getAccount(provider.connection, userDestinationTokenAccount)
    ).amount;

    // Execute route_and_create_order
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

    //console.log("✓ Route and create order completed successfully");
  });

  it("6. Stop Loss order - execute when price drops", async () => {
    const nonce = new BN(Date.now());
    const inputAmount = new BN(50_000_000);
    const minOutputAmount = new BN(33_000_000); // baseline price
    const triggerPriceBps = 500; // 5% price drop
    const triggerType = { stopLoss: {} }; // Stop Loss order
    const expiry = new BN(Math.floor(Date.now() / 1000) + 3600);
    const slippageBps = 300;

    // Create order
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

    // Execute order with price drop
    // For StopLoss: price_ratio <= 10000 - trigger_price_bps (9500)
    // price_ratio = (quotedOutAmount * 10000) / minOutputAmount
    // So: quotedOutAmount <= 9500 * minOutputAmount / 10000 = 9500 * 33_000_000 / 10000 = 31_350_000
    // Use a value that clearly satisfies the trigger condition
    const quotedOutAmount = new BN(27_000_000); // Less than 31_350_000 to trigger StopLoss
    const platformFeeBps = 10;

    const routePlan = [
      { swap: { raydium: {} }, percent: 100, inputIndex: 0, outputIndex: 13 },
    ];

    const inputPoolVault =
      sourceMint.toString() < destinationMint.toString()
        ? raydiumTokenAVault
        : raydiumTokenBVault;
    const outputPoolVault =
      sourceMint.toString() < destinationMint.toString()
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

    // Verify trigger logic before execution
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

    //console.log("✓ Stop loss order executed successfully");
  });
});
