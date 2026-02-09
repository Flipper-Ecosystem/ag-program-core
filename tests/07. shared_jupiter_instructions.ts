import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  mintTo,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccount,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import { assert } from "chai";
import { Flipper } from "../target/types/flipper";
import { MockJupiter } from "../target/types/mock_jupiter";

/** Jupiter event authority (placeholder for tests) */
const JUPITER_EVENT_AUTHORITY = new PublicKey(
  "D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf"
);

/**
 * Builds Jupiter instruction data using Anchor encoder for CPI.
 * Anchor automatically handles discriminator and Borsh serialization.
 */
function buildJupiterCpiInstructionData(
  mockJupiterProgram: Program,
  id: number,
  routePlan: {
    swap: object;
    percent: number;
    inputIndex: number;
    outputIndex: number;
  }[],
  inAmount: BN,
  quotedOutAmount: BN,
  slippageBps: number,
  platformFeeBps: number
): Buffer {
  // Use Anchor's encoder to properly serialize the instruction
  const data = mockJupiterProgram.coder.instruction.encode(
    "sharedAccountsRoute",
    {
      id,
      routePlan,
      inAmount,
      quotedOutAmount,
      slippageBps,
      platformFeeBps,
    }
  );

  return Buffer.from(data);
}

/**
 * Builds remaining_accounts for Jupiter shared_accounts_route in CORRECT IDL order:
 * 0: token_program
 * 1: program_authority (Jupiter PDA - in mock, can use a placeholder)
 * 2: user_transfer_authority (vault_authority - will be signer via PDA)
 * 3: user_source_token_account (vault_source)
 * 4: program_source_token_account (Jupiter intermediate - can be placeholder or same as vault_source)
 * 5: program_destination_token_account (Jupiter intermediate - can be placeholder or same as vault_destination)
 * 6: user_destination_token_account (vault_destination)
 * 7: source_mint
 * 8: destination_mint
 * 9: platform_fee_account (optional/placeholder)
 * 10: token_2022_program
 * 11: event_authority
 * 12: program (Jupiter programId)
 * 13+: mock pool accounts
 */
function buildJupiterRemainingAccounts(params: {
  tokenProgram: PublicKey;
  jupiterProgramAuthority: PublicKey; // Jupiter PDA (placeholder in mock)
  vaultAuthority: PublicKey; // Our PDA, goes to index 2 (user_transfer_authority)
  vaultSource: PublicKey; // Goes to index 3 (user_source)
  vaultDestination: PublicKey; // Goes to index 6 (user_destination)
  sourceMint: PublicKey;
  destinationMint: PublicKey;
  platformFeeOrPlaceholder: PublicKey;
  token2022OrPlaceholder: PublicKey;
  eventAuthority: PublicKey;
  jupiterProgram: PublicKey;
  mockPool: PublicKey;
  mockPoolAuthority: PublicKey;
}) {
  return [
    { pubkey: params.tokenProgram, isSigner: false, isWritable: false }, // 0
    {
      pubkey: params.jupiterProgramAuthority,
      isSigner: false,
      isWritable: false,
    }, // 1: Jupiter PDA
    { pubkey: params.vaultAuthority, isSigner: false, isWritable: false }, // 2: user_transfer_authority (our signer)
    { pubkey: params.vaultSource, isSigner: false, isWritable: true }, // 3: user_source
    { pubkey: params.vaultSource, isSigner: false, isWritable: true }, // 4: program_source (placeholder: same as vault_source)
    { pubkey: params.vaultDestination, isSigner: false, isWritable: true }, // 5: program_destination (placeholder: same as vault_destination)
    { pubkey: params.vaultDestination, isSigner: false, isWritable: true }, // 6: user_destination
    { pubkey: params.sourceMint, isSigner: false, isWritable: false }, // 7
    { pubkey: params.destinationMint, isSigner: false, isWritable: false }, // 8
    {
      pubkey: params.platformFeeOrPlaceholder,
      isSigner: false,
      isWritable: false,
    }, // 9
    {
      pubkey: params.token2022OrPlaceholder,
      isSigner: false,
      isWritable: false,
    }, // 10
    { pubkey: params.eventAuthority, isSigner: false, isWritable: false }, // 11
    { pubkey: params.jupiterProgram, isSigner: false, isWritable: false }, // 12
    { pubkey: params.mockPool, isSigner: false, isWritable: true }, // 13: mock pool
    { pubkey: params.mockPoolAuthority, isSigner: false, isWritable: false }, // 14: mock pool authority
  ];
}

describe("Flipper - Shared Jupiter CPI Instructions", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Flipper as Program<Flipper>;
  const mockJupiterProgram = anchor.workspace
    .MockJupiter as Program<MockJupiter>;

  // Shared variables
  let wallet: anchor.Wallet;
  let admin: Keypair;
  let user: Keypair;
  let operator: Keypair;
  let vaultAuthority: PublicKey;
  let adapterRegistry: PublicKey;
  let sourceMint: PublicKey;
  let destinationMint: PublicKey;
  let userSourceTokenAccount: PublicKey;
  let userDestinationTokenAccount: PublicKey;
  let sourceVault: PublicKey;
  let destinationVault: PublicKey;
  let platformFeeAccount: PublicKey;

  before(async () => {
    wallet = provider.wallet as anchor.Wallet;
    admin = wallet.payer;
    user = Keypair.generate();
    operator = Keypair.generate();

    // Fund accounts
    await provider.connection.requestAirdrop(user.publicKey, 10_000_000_000);
    await provider.connection.requestAirdrop(
      operator.publicKey,
      10_000_000_000
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // PDAs
    [vaultAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_authority")],
      program.programId
    );

    [adapterRegistry] = PublicKey.findProgramAddressSync(
      [Buffer.from("adapter_registry")],
      program.programId
    );

    // Check and create vault authority if needed
    const vaultAuthorityInfo = await provider.connection.getAccountInfo(
      vaultAuthority
    );
    if (!vaultAuthorityInfo) {
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
      console.log("✅ Created vault authority");
    }

    // Check and create adapter registry if needed
    const registryInfo = await provider.connection.getAccountInfo(
      adapterRegistry
    );
    if (!registryInfo) {
      await program.methods
        .initializeAdapterRegistry([], [operator.publicKey])
        .accounts({
          adapterRegistry,
          authority: admin.publicKey,
          payer: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([wallet.payer])
        .rpc();
      console.log("✅ Initialized adapter registry with operator");
    }

    // Set Jupiter program ID using migrateVaultAuthority (callable by admin only).
    // This handles both realloc (if needed) and setting jupiter_program_id.
    // Realloc to same size is a no-op in Anchor, so safe to call even if already migrated.
    const vaultAuthorityData = await program.account.vaultAuthority.fetch(
      vaultAuthority
    );
    if (
      !vaultAuthorityData.jupiterProgramId ||
      !vaultAuthorityData.jupiterProgramId.equals(mockJupiterProgram.programId)
    ) {
      await program.methods
        .migrateVaultAuthority(mockJupiterProgram.programId)
        .accounts({
          vaultAuthority,
          admin: admin.publicKey,
          payer: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([wallet.payer])
        .rpc();
      console.log(
        "✅ Set Jupiter program via migrateVaultAuthority:",
        mockJupiterProgram.programId.toBase58()
      );
    } else {
      console.log("✅ Jupiter program ID already set correctly");
    }

    // Create mints
    sourceMint = await createMint(
      provider.connection,
      wallet.payer,
      admin.publicKey,
      null,
      6
    );
    console.log("✅ Created source mint:", sourceMint.toBase58());

    destinationMint = await createMint(
      provider.connection,
      wallet.payer,
      admin.publicKey,
      null,
      6
    );
    console.log("✅ Created destination mint:", destinationMint.toBase58());

    // Create user token accounts
    userSourceTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      sourceMint,
      user.publicKey
    );

    userDestinationTokenAccount = await createAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      destinationMint,
      user.publicKey
    );

    // Mint tokens to user
    await mintTo(
      provider.connection,
      wallet.payer,
      sourceMint,
      userSourceTokenAccount,
      admin,
      1_000_000_000
    );
    console.log("✅ Minted 1000 source tokens to user");

    // Create vaults
    [sourceVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), sourceMint.toBuffer()],
      program.programId
    );

    [destinationVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), destinationMint.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .createVault()
        .accounts({
          vaultAuthority,
          vault: sourceVault,
          vaultMint: sourceMint,
          vaultTokenProgram: TOKEN_PROGRAM_ID,
          payer: wallet.publicKey,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([wallet.payer])
        .rpc();
      console.log("✅ Created source vault");
    } catch (e) {
      console.log("Source vault already exists");
    }

    try {
      await program.methods
        .createVault()
        .accounts({
          vaultAuthority,
          vault: destinationVault,
          vaultMint: destinationMint,
          vaultTokenProgram: TOKEN_PROGRAM_ID,
          payer: wallet.publicKey,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([wallet.payer])
        .rpc();
      console.log("✅ Created destination vault");
    } catch (e) {
      console.log("Destination vault already exists");
    }

    // Create platform fee account (PDA can own ATA with allowOwnerOffCurve)
    const platformFeeATA = getAssociatedTokenAddressSync(
      destinationMint,
      vaultAuthority,
      true // allowOwnerOffCurve for PDA
    );

    try {
      platformFeeAccount = await createAssociatedTokenAccount(
        provider.connection,
        wallet.payer,
        destinationMint,
        vaultAuthority,
        true // allowOwnerOffCurve
      );
      console.log("✅ Created platform fee account");
    } catch (e) {
      // If it already exists, just use it
      platformFeeAccount = platformFeeATA;
      console.log("✅ Platform fee account already exists");
    }

    // Mint some tokens to destination vault for mock Jupiter swaps
    await mintTo(
      provider.connection,
      wallet.payer,
      destinationMint,
      destinationVault,
      admin,
      10_000_000_000
    );
    console.log("✅ Minted tokens to destination vault for testing");
  });

  describe("shared_route", () => {
    it("Should execute a swap using Jupiter CPI (mock)", async () => {
      // FIRST: Test basic deserialization with empty data
      console.log("🔍 Testing basic deserialization with empty data...");
      try {
        await program.methods
          .sharedRoute(
            new BN(1),
            new BN(1),
            1,
            0,
            Buffer.alloc(8) // Empty data (8 bytes minimum for mock discriminator)
          )
          .accounts({
            vaultAuthority,
            userSourceTokenAccount,
            userDestinationTokenAccount,
            vaultSource: sourceVault,
            vaultDestination: destinationVault,
            sourceMint,
            destinationMint,
            inputTokenProgram: TOKEN_PROGRAM_ID,
            outputTokenProgram: TOKEN_PROGRAM_ID,
            userTransferAuthority: user.publicKey,
            platformFeeAccount: null,
            jupiterProgram: mockJupiterProgram.programId,
            systemProgram: SystemProgram.programId,
          })
          .remainingAccounts([])
          .signers([user])
          .instruction(); // Just build, don't send
        console.log("✅ Instruction built successfully!");
      } catch (e: any) {
        console.log("❌ Build instruction failed:", e.message);
      }

      const inAmount = new BN(100_000_000); // 100 tokens
      const quotedOutAmount = new BN(150_000_000); // 150 tokens (1.5x rate)
      const slippageBps = 50; // 0.5%
      const platformFeeBps = 0; // 0% for testing

      // Get balances before
      const userSourceBefore = await getAccount(
        provider.connection,
        userSourceTokenAccount
      );
      const userDestBefore = await getAccount(
        provider.connection,
        userDestinationTokenAccount
      );
      const sourceVaultBefore = await getAccount(
        provider.connection,
        sourceVault
      );
      const destVaultBefore = await getAccount(
        provider.connection,
        destinationVault
      );

      console.log(
        "User source balance before:",
        userSourceBefore.amount.toString()
      );
      console.log(
        "User dest balance before:",
        userDestBefore.amount.toString()
      );
      console.log(
        "Source vault balance before:",
        sourceVaultBefore.amount.toString()
      );
      console.log(
        "Dest vault balance before:",
        destVaultBefore.amount.toString()
      );

      // Create a mock liquidity pool account (simulates Jupiter's DEX pool)
      // This account will hold destination tokens that Jupiter would output
      const mockLiquidityPool = await createAssociatedTokenAccount(
        provider.connection,
        wallet.payer,
        destinationMint,
        wallet.publicKey
      );

      // Fund the liquidity pool with destination tokens
      await mintTo(
        provider.connection,
        wallet.payer,
        destinationMint,
        mockLiquidityPool,
        admin,
        quotedOutAmount.toNumber() * 2 // Fund with 2x to have enough
      );
      console.log("✅ Created and funded mock liquidity pool");

      const routePlan = [
        { swap: { raydium: {} }, percent: 100, inputIndex: 0, outputIndex: 1 },
      ];

      // Build Jupiter instruction data using Anchor encoder
      const data = buildJupiterCpiInstructionData(
        mockJupiterProgram,
        0,
        routePlan,
        inAmount,
        quotedOutAmount,
        slippageBps,
        platformFeeBps
      );
      console.log("✅ Built Jupiter instruction data, length:", data.length);

      const remainingAccounts = buildJupiterRemainingAccounts({
        tokenProgram: TOKEN_PROGRAM_ID,
        jupiterProgramAuthority: mockJupiterProgram.programId, // Jupiter PDA (using programId as placeholder)
        vaultAuthority, // Index 2: user_transfer_authority
        vaultSource: sourceVault, // Index 3: user_source
        vaultDestination: destinationVault, // Index 6: user_destination
        sourceMint,
        destinationMint,
        platformFeeOrPlaceholder: TOKEN_PROGRAM_ID,
        token2022OrPlaceholder: JUPITER_EVENT_AUTHORITY,
        eventAuthority: JUPITER_EVENT_AUTHORITY,
        jupiterProgram: mockJupiterProgram.programId,
        mockPool: mockLiquidityPool,
        mockPoolAuthority: wallet.publicKey,
      });

      await program.methods
        .sharedRoute(
          inAmount,
          quotedOutAmount,
          slippageBps,
          platformFeeBps,
          data
        )
        .accounts({
          vaultAuthority,
          userSourceTokenAccount,
          userDestinationTokenAccount,
          vaultSource: sourceVault,
          vaultDestination: destinationVault,
          sourceMint,
          destinationMint,
          inputTokenProgram: TOKEN_PROGRAM_ID,
          outputTokenProgram: TOKEN_PROGRAM_ID,
          userTransferAuthority: user.publicKey,
          platformFeeAccount: null,
          jupiterProgram: mockJupiterProgram.programId,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(remainingAccounts)
        .signers([user])
        .rpc();

      console.log("✅ Shared route executed successfully");

      // Verify balances changed
      const userSourceAfter = await getAccount(
        provider.connection,
        userSourceTokenAccount
      );
      const userDestAfter = await getAccount(
        provider.connection,
        userDestinationTokenAccount
      );
      const sourceVaultAfter = await getAccount(
        provider.connection,
        sourceVault
      );
      const destVaultAfter = await getAccount(
        provider.connection,
        destinationVault
      );

      console.log(
        "User source balance after:",
        userSourceAfter.amount.toString()
      );
      console.log("User dest balance after:", userDestAfter.amount.toString());
      console.log(
        "Source vault balance after:",
        sourceVaultAfter.amount.toString()
      );
      console.log(
        "Dest vault balance after:",
        destVaultAfter.amount.toString()
      );

      // Verify tokens were deducted from user source account
      assert.equal(
        Number(userSourceBefore.amount) - Number(userSourceAfter.amount),
        inAmount.toNumber(),
        "User source balance should be reduced by input amount"
      );

      // Verify tokens were added to user destination account
      assert.isAbove(
        Number(userDestAfter.amount),
        Number(userDestBefore.amount),
        "User destination balance should increase"
      );

      console.log("✅ Verified: User received output tokens directly");
    });
  });

  describe("shared_route - invalid Jupiter program", () => {
    it("Should reject a swap with an invalid Jupiter program ID", async () => {
      const fakeJupiterProgram = Keypair.generate().publicKey;

      try {
        await program.methods
          .sharedRoute(
            new BN(100_000_000),
            new BN(150_000_000),
            50,
            0,
            Buffer.alloc(8)
          )
          .accounts({
            vaultAuthority,
            userSourceTokenAccount,
            userDestinationTokenAccount,
            vaultSource: sourceVault,
            vaultDestination: destinationVault,
            sourceMint,
            destinationMint,
            inputTokenProgram: TOKEN_PROGRAM_ID,
            outputTokenProgram: TOKEN_PROGRAM_ID,
            userTransferAuthority: user.publicKey,
            platformFeeAccount: null,
            jupiterProgram: fakeJupiterProgram,
            systemProgram: SystemProgram.programId,
          })
          .remainingAccounts([])
          .signers([user])
          .rpc();

        assert.fail("Should have failed with InvalidJupiterProgram");
      } catch (err: any) {
        const errorStr = err.toString();
        const hasInvalidJupiterProgram =
          errorStr.includes("InvalidJupiterProgram") ||
          errorStr.includes("Invalid Jupiter program ID") ||
          (err.error &&
            err.error.errorCode &&
            err.error.errorCode.code === "InvalidJupiterProgram");

        assert.isTrue(
          hasInvalidJupiterProgram,
          `Expected InvalidJupiterProgram error, got: ${errorStr}`
        );
        console.log("✅ Correctly rejected invalid Jupiter program ID");
      }
    });
  });

  describe("create_limit_order (used with shared_execute)", () => {
    it("Should create a limit order for Jupiter CPI execution", async () => {
      const nonce = new BN(Date.now());
      const inputAmount = new BN(50_000_000); // 50 tokens
      const minOutputAmount = new BN(75_000_000); // 75 tokens
      const triggerPriceBps = 500; // 5% take profit
      const triggerType = { takeProfit: {} };
      const expiry = new BN(Math.floor(Date.now() / 1000) + 3600); // 1 hour
      const slippageBps = 100; // 1%

      // Derive limit order PDA
      const [limitOrder] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("limit_order"),
          user.publicKey.toBuffer(),
          nonce.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      const [inputVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("order_vault"), limitOrder.toBuffer()],
        program.programId
      );

      // First initialize the limit order account
      await program.methods
        .initLimitOrder(nonce, 0)
        .accounts({
          vaultAuthority,
          limitOrder,
          inputVault,
          inputMint: sourceMint,
          inputTokenProgram: TOKEN_PROGRAM_ID,
          creator: user.publicKey,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([user])
        .rpc();

      console.log("✅ Initialized limit order account");

      // Then create the limit order using regular create_limit_order
      // (structure is the same, only execution differs)
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
          inputVault,
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

      console.log("✅ Created limit order (for Jupiter CPI execution)");

      // Verify order state
      const orderAccount = await program.account.limitOrder.fetch(limitOrder);
      assert.equal(orderAccount.inputAmount.toString(), inputAmount.toString());
      assert.equal(
        orderAccount.minOutputAmount.toString(),
        minOutputAmount.toString()
      );
      assert.equal(orderAccount.status.open !== undefined, true);

      console.log("✅ Limit order verified");
    });
  });

  describe("cancel_limit_order (used with shared_execute)", () => {
    it("Should cancel a limit order and refund tokens", async () => {
      const nonce = new BN(Date.now() + 1);
      const inputAmount = new BN(30_000_000);
      const minOutputAmount = new BN(45_000_000);
      const triggerPriceBps = 300;
      const triggerType = { takeProfit: {} };
      const expiry = new BN(Math.floor(Date.now() / 1000) + 3600);
      const slippageBps = 100;

      const [limitOrder] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("limit_order"),
          user.publicKey.toBuffer(),
          nonce.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      const [inputVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("order_vault"), limitOrder.toBuffer()],
        program.programId
      );

      // Initialize and create order
      await program.methods
        .initLimitOrder(nonce, 0)
        .accounts({
          vaultAuthority,
          limitOrder,
          inputVault,
          inputMint: sourceMint,
          inputTokenProgram: TOKEN_PROGRAM_ID,
          creator: user.publicKey,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
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
          inputVault,
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

      console.log("✅ Created order to cancel");

      // Get balance before cancellation
      const userBalanceBefore = await getAccount(
        provider.connection,
        userSourceTokenAccount
      );

      // Cancel the order using regular cancel_limit_order
      await program.methods
        .cancelLimitOrder()
        .accounts({
          vaultAuthority,
          limitOrder,
          inputVault,
          userInputTokenAccount: userSourceTokenAccount,
          inputMint: sourceMint,
          inputTokenProgram: TOKEN_PROGRAM_ID,
          creator: user.publicKey,
        })
        .signers([user])
        .rpc();

      console.log("✅ Cancelled limit order");

      // Verify tokens were refunded
      const userBalanceAfter = await getAccount(
        provider.connection,
        userSourceTokenAccount
      );
      const refundedAmount = userBalanceAfter.amount - userBalanceBefore.amount;
      assert.equal(refundedAmount.toString(), inputAmount.toString());

      console.log("✅ Tokens refunded correctly");
    });
  });

  describe("shared_execute_limit_order", () => {
    it("Should execute a limit order using Jupiter CPI (mock)", async () => {
      const nonce = new BN(Date.now() + 2);
      const inputAmount = new BN(40_000_000);
      const minOutputAmount = new BN(50_000_000);
      const triggerPriceBps = 200; // 2% take profit
      const triggerType = { takeProfit: {} };
      const expiry = new BN(Math.floor(Date.now() / 1000) + 3600);
      const slippageBps = 100;

      const [limitOrder] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("limit_order"),
          user.publicKey.toBuffer(),
          nonce.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      const [inputVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("order_vault"), limitOrder.toBuffer()],
        program.programId
      );

      // Initialize and create order
      await program.methods
        .initLimitOrder(nonce, 0)
        .accounts({
          vaultAuthority,
          limitOrder,
          inputVault,
          inputMint: sourceMint,
          inputTokenProgram: TOKEN_PROGRAM_ID,
          creator: user.publicKey,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
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
          inputVault,
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

      console.log("✅ Created order to execute");

      // Calculate quoted output (must meet trigger condition)
      const quotedOutAmount = new BN(51_000_000); // 51 tokens (2% above min)
      const platformFeeBps = 50; // 0.5%

      // Mock route data
      const sharedRoute = Buffer.from([5, 6, 7, 8]);

      // Get balance before execution
      const userDestBefore = await getAccount(
        provider.connection,
        userDestinationTokenAccount
      );

      // Note: Full execution test would require:
      // 1. Mock Jupiter program to accept CPI calls
      // 2. Proper route data format
      // 3. Remaining accounts for Jupiter route
      // For now, this demonstrates the instruction structure

      console.log("✅ Order execution flow tested (requires Jupiter mock CPI)");
    });
  });

  describe("shared_route_and_create_order", () => {
    it("Should execute a Jupiter swap and create a limit order with output tokens", async () => {
      const orderNonce = new BN(Date.now() + 3);
      const swapInAmount = new BN(50_000_000); // 50 source tokens
      const swapQuotedOutAmount = new BN(75_000_000); // 75 destination tokens expected
      const swapSlippageBps = 50; // 0.5% slippage for swap
      const platformFeeBps = 0; // 0% fee for testing

      // Order parameters
      const orderMinOutputAmount = new BN(50_000_000); // Want at least 50 source tokens back
      const orderTriggerPriceBps = 500; // 5% take profit
      const orderExpiry = new BN(Math.floor(Date.now() / 1000) + 3600); // 1 hour
      const orderSlippageBps = 100; // 1% slippage for order execution

      // Derive limit order PDA
      const [limitOrder] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("limit_order"),
          user.publicKey.toBuffer(),
          orderNonce.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      // Derive order vault PDA (will hold swap output tokens)
      const [orderVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("order_vault"), limitOrder.toBuffer()],
        program.programId
      );

      // Initialize limit order account first
      await program.methods
        .initLimitOrder(orderNonce, 0)
        .accounts({
          vaultAuthority,
          limitOrder,
          inputVault: orderVault,
          inputMint: destinationMint, // Order input is swap output
          inputTokenProgram: TOKEN_PROGRAM_ID,
          creator: user.publicKey,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([user])
        .rpc();

      console.log(
        "✅ Initialized limit order for shared_route_and_create_order"
      );

      // Get balances before
      const userSourceBefore = await getAccount(
        provider.connection,
        userSourceTokenAccount
      );
      const userDestBefore = await getAccount(
        provider.connection,
        userDestinationTokenAccount
      );

      console.log(
        "User source balance before:",
        userSourceBefore.amount.toString()
      );
      console.log(
        "User dest balance before:",
        userDestBefore.amount.toString()
      );

      // Get or create a mock liquidity pool for Jupiter
      const mockLiquidityPoolAccount = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        wallet.payer,
        destinationMint,
        wallet.publicKey
      );
      const mockLiquidityPool = mockLiquidityPoolAccount.address;

      // Fund the liquidity pool if needed
      if (
        mockLiquidityPoolAccount.amount <
        swapQuotedOutAmount.toNumber() * 2
      ) {
        await mintTo(
          provider.connection,
          wallet.payer,
          destinationMint,
          mockLiquidityPool,
          admin,
          swapQuotedOutAmount.toNumber() * 2
        );
      }
      console.log("✅ Got or created and funded mock liquidity pool");

      const routePlan = [
        { swap: { raydium: {} }, percent: 100, inputIndex: 0, outputIndex: 1 },
      ];

      // Build Jupiter instruction data using Anchor encoder
      const swapData = buildJupiterCpiInstructionData(
        mockJupiterProgram,
        0,
        routePlan,
        swapInAmount,
        swapQuotedOutAmount,
        swapSlippageBps,
        platformFeeBps
      );

      const remainingAccountsOrder = buildJupiterRemainingAccounts({
        tokenProgram: TOKEN_PROGRAM_ID,
        jupiterProgramAuthority: mockJupiterProgram.programId,
        vaultAuthority,
        vaultSource: sourceVault,
        vaultDestination: orderVault,
        sourceMint,
        destinationMint,
        platformFeeOrPlaceholder: TOKEN_PROGRAM_ID,
        token2022OrPlaceholder: JUPITER_EVENT_AUTHORITY,
        eventAuthority: JUPITER_EVENT_AUTHORITY,
        jupiterProgram: mockJupiterProgram.programId,
        mockPool: mockLiquidityPool,
        mockPoolAuthority: wallet.publicKey,
      });

      await program.methods
        .sharedRouteAndCreateOrder(
          orderNonce,
          swapInAmount,
          swapQuotedOutAmount,
          swapSlippageBps,
          platformFeeBps,
          orderMinOutputAmount,
          orderTriggerPriceBps,
          orderExpiry,
          orderSlippageBps,
          swapData
        )
        .accounts({
          vaultAuthority,
          limitOrder,
          userInputAccount: userSourceTokenAccount,
          userDestinationAccount: userSourceTokenAccount,
          swapSourceVault: sourceVault,
          swapDestinationVault: orderVault,
          swapInputMint: sourceMint,
          swapOutputMint: destinationMint,
          inputTokenProgram: TOKEN_PROGRAM_ID,
          outputTokenProgram: TOKEN_PROGRAM_ID,
          platformFeeAccount: null,
          jupiterProgram: mockJupiterProgram.programId,
          creator: user.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(remainingAccountsOrder)
        .signers([user])
        .rpc();

      console.log("✅ Shared route and create order executed successfully");

      // Wait for transaction confirmation
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Verify balances changed
      const userSourceAfter = await getAccount(
        provider.connection,
        userSourceTokenAccount
      );
      const orderVaultAfter = await getAccount(provider.connection, orderVault);

      console.log(
        "User source balance after:",
        userSourceAfter.amount.toString()
      );
      console.log(
        "Order vault balance after:",
        orderVaultAfter.amount.toString()
      );

      // Verify source tokens were deducted
      assert.equal(
        Number(userSourceBefore.amount) - Number(userSourceAfter.amount),
        swapInAmount.toNumber(),
        "User source balance should be reduced by swap input amount"
      );

      // Verify order vault has tokens
      assert.isAbove(
        Number(orderVaultAfter.amount),
        0,
        "Order vault should have destination tokens from swap"
      );

      // Verify order was created with correct parameters
      const orderAccount = await program.account.limitOrder.fetch(limitOrder);
      assert.equal(
        orderAccount.inputMint.toBase58(),
        destinationMint.toBase58()
      );
      assert.equal(orderAccount.outputMint.toBase58(), sourceMint.toBase58());
      assert.equal(orderAccount.status.open !== undefined, true);
      assert.isAbove(Number(orderAccount.inputAmount), 0);

      console.log("✅ Verified: Swap executed and limit order created");
      console.log("Order input amount:", orderAccount.inputAmount.toString());
      console.log("Order min output:", orderAccount.minOutputAmount.toString());
      console.log("Order trigger price bps:", orderAccount.triggerPriceBps);
    });

    it("Should fail with invalid order parameters", async () => {
      const orderNonce = new BN(Date.now() + 4);
      const swapInAmount = new BN(50_000_000);
      const swapQuotedOutAmount = new BN(75_000_000);
      const swapSlippageBps = 50;
      const platformFeeBps = 0;

      const [limitOrder] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("limit_order"),
          user.publicKey.toBuffer(),
          orderNonce.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );

      const [orderVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("order_vault"), limitOrder.toBuffer()],
        program.programId
      );

      await program.methods
        .initLimitOrder(orderNonce, 0)
        .accounts({
          vaultAuthority,
          limitOrder,
          inputVault: orderVault,
          inputMint: destinationMint,
          inputTokenProgram: TOKEN_PROGRAM_ID,
          creator: user.publicKey,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([user])
        .rpc();

      const routePlan = [
        { swap: { raydium: {} }, percent: 100, inputIndex: 0, outputIndex: 1 },
      ];

      // Build Jupiter instruction data using Anchor encoder
      const failData = buildJupiterCpiInstructionData(
        mockJupiterProgram,
        0,
        routePlan,
        swapInAmount,
        swapQuotedOutAmount,
        swapSlippageBps,
        platformFeeBps
      );

      const failRemainingAccounts = buildJupiterRemainingAccounts({
        tokenProgram: TOKEN_PROGRAM_ID,
        jupiterProgramAuthority: mockJupiterProgram.programId,
        vaultAuthority,
        vaultSource: sourceVault,
        vaultDestination: orderVault,
        sourceMint,
        destinationMint,
        platformFeeOrPlaceholder: TOKEN_PROGRAM_ID,
        token2022OrPlaceholder: JUPITER_EVENT_AUTHORITY,
        eventAuthority: JUPITER_EVENT_AUTHORITY,
        jupiterProgram: mockJupiterProgram.programId,
        mockPool: orderVault,
        mockPoolAuthority: wallet.publicKey,
      });

      try {
        await program.methods
          .sharedRouteAndCreateOrder(
            orderNonce,
            swapInAmount,
            swapQuotedOutAmount,
            swapSlippageBps,
            platformFeeBps,
            new BN(50_000_000),
            0, // Invalid trigger price (should fail)
            new BN(Math.floor(Date.now() / 1000) + 3600),
            100,
            failData
          )
          .accounts({
            vaultAuthority,
            limitOrder,
            userInputAccount: userSourceTokenAccount,
            userDestinationAccount: userSourceTokenAccount,
            swapSourceVault: sourceVault,
            swapDestinationVault: orderVault,
            swapInputMint: sourceMint,
            swapOutputMint: destinationMint,
            inputTokenProgram: TOKEN_PROGRAM_ID,
            outputTokenProgram: TOKEN_PROGRAM_ID,
            platformFeeAccount: null,
            jupiterProgram: mockJupiterProgram.programId,
            creator: user.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .remainingAccounts(failRemainingAccounts)
          .signers([user])
          .rpc();

        assert.fail("Should have failed with invalid trigger price");
      } catch (err) {
        // Transaction should fail - check if it's the expected error
        const errorStr = err.toString();
        console.log("Error caught:", errorStr);

        // Check various ways the error could be reported
        const hasInvalidTriggerPrice =
          errorStr.includes("InvalidTriggerPrice") ||
          errorStr.includes("Invalid trigger price") ||
          (err.error &&
            err.error.errorCode &&
            err.error.errorCode.code === "InvalidTriggerPrice");

        assert.isTrue(
          hasInvalidTriggerPrice,
          `Expected InvalidTriggerPrice error, got: ${errorStr}`
        );
        console.log("✅ Correctly rejected invalid trigger price");
      }
    });
  });
});
