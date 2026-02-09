import * as anchor from "@coral-xyz/anchor";
import { Program, BN, web3 } from "@coral-xyz/anchor";
import { MockRaydium } from "../target/types/mock_raydium";
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

describe("Mock Raydium Swap", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.MockRaydium as Program<MockRaydium>;
  const wallet = provider.wallet as anchor.Wallet;

  // Token mints and accounts
  let tokenAMint: PublicKey; // Legacy Token
  let tokenBMint: PublicKey; // Legacy Token
  let token2022AMint: PublicKey; // Token-2022
  let token2022BMint: PublicKey; // Token-2022
  let userTokenAAccount: PublicKey;
  let userTokenBAccount: PublicKey;
  let userToken2022AAccount: PublicKey;
  let userToken2022BAccount: PublicKey;
  let tokenAVaultTokenToToken: PublicKey;
  let tokenBVaultTokenToToken: PublicKey;
  let tokenAVaultTokenTo2022: PublicKey;
  let tokenBVaultTokenTo2022: PublicKey;
  let tokenAVault2022To2022: PublicKey;
  let tokenBVault2022To2022: PublicKey;
  let tokenAVault2022ToToken: PublicKey;
  let tokenBVault2022ToToken: PublicKey;
  let poolStateTokenToToken: PublicKey;
  let poolStateTokenTo2022: PublicKey;
  let poolState2022To2022: PublicKey;
  let poolState2022ToToken: PublicKey;
  let authorityTokenToToken: PublicKey;
  let authorityTokenTo2022: PublicKey;
  let authority2022To2022: PublicKey;
  let authority2022ToToken: PublicKey;

  // Test constants
  const INITIAL_TOKEN_A_AMOUNT = new BN(1000000);
  const INITIAL_TOKEN_B_AMOUNT = new BN(2000000);
  const SWAP_AMOUNT_IN = new BN(100000);
  const MINIMUM_AMOUNT_OUT = new BN(180000);

  before(async () => {
    // Verify local validator is running
    try {
      await provider.connection.getVersion();
    } catch (err) {
      throw new Error(
        "Local Solana validator not running. Start with `solana-test-validator`."
      );
    }

    // Create token mints (Legacy and Token-2022)
    tokenAMint = await createMint(
      provider.connection,
      wallet.payer,
      wallet.publicKey,
      null,
      6,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );
    tokenBMint = await createMint(
      provider.connection,
      wallet.payer,
      wallet.publicKey,
      null,
      6,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );
    token2022AMint = await createMint(
      provider.connection,
      wallet.payer,
      wallet.publicKey,
      null,
      6,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    token2022BMint = await createMint(
      provider.connection,
      wallet.payer,
      wallet.publicKey,
      null,
      6,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Derive pool state and authority PDAs for each pool
    // Authority is shared across all pools (uses fixed seeds)
    [authorityTokenToToken] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_and_lp_mint_auth_seed")],
      program.programId
    );

    [poolStateTokenToToken] = PublicKey.findProgramAddressSync(
      [Buffer.from("pool_state"), tokenAMint.toBuffer(), tokenBMint.toBuffer()],
      program.programId
    );

    [poolStateTokenTo2022] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool_state"),
        tokenAMint.toBuffer(),
        token2022BMint.toBuffer(),
      ],
      program.programId
    );
    authorityTokenTo2022 = authorityTokenToToken; // Same authority

    [poolState2022To2022] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool_state"),
        token2022AMint.toBuffer(),
        token2022BMint.toBuffer(),
      ],
      program.programId
    );
    authority2022To2022 = authorityTokenToToken; // Same authority

    [poolState2022ToToken] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool_state"),
        token2022AMint.toBuffer(),
        tokenBMint.toBuffer(),
      ],
      program.programId
    );
    authority2022ToToken = authorityTokenToToken; // Same authority

    // Create user token accounts
    userTokenAAccount = await createAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      tokenAMint,
      wallet.publicKey,
      undefined,
      TOKEN_PROGRAM_ID
    );
    userTokenBAccount = await createAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      tokenBMint,
      wallet.publicKey,
      undefined,
      TOKEN_PROGRAM_ID
    );
    userToken2022AAccount = await createAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      token2022AMint,
      wallet.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    userToken2022BAccount = await createAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      token2022BMint,
      wallet.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Derive vault token account addresses
    tokenAVaultTokenToToken = await getAssociatedTokenAddress(
      tokenAMint,
      authorityTokenToToken,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    tokenBVaultTokenToToken = await getAssociatedTokenAddress(
      tokenBMint,
      authorityTokenToToken,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    tokenAVaultTokenTo2022 = await getAssociatedTokenAddress(
      tokenAMint,
      authorityTokenTo2022,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    tokenBVaultTokenTo2022 = await getAssociatedTokenAddress(
      token2022BMint,
      authorityTokenTo2022,
      true,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    tokenAVault2022To2022 = await getAssociatedTokenAddress(
      token2022AMint,
      authority2022To2022,
      true,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    tokenBVault2022To2022 = await getAssociatedTokenAddress(
      token2022BMint,
      authority2022To2022,
      true,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    tokenAVault2022ToToken = await getAssociatedTokenAddress(
      token2022AMint,
      authority2022ToToken,
      true,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    tokenBVault2022ToToken = await getAssociatedTokenAddress(
      tokenBMint,
      authority2022ToToken,
      true,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // Mint tokens with enough amounts for all tests
    const MINT_AMOUNT = INITIAL_TOKEN_A_AMOUNT.toNumber() * 10;

    await mintTo(
      provider.connection,
      wallet.payer,
      tokenAMint,
      userTokenAAccount,
      wallet.publicKey,
      MINT_AMOUNT,
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
      INITIAL_TOKEN_B_AMOUNT.toNumber() * 10,
      [],
      undefined,
      TOKEN_PROGRAM_ID
    );
    await mintTo(
      provider.connection,
      wallet.payer,
      token2022AMint,
      userToken2022AAccount,
      wallet.publicKey,
      MINT_AMOUNT,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    await mintTo(
      provider.connection,
      wallet.payer,
      token2022BMint,
      userToken2022BAccount,
      wallet.publicKey,
      INITIAL_TOKEN_B_AMOUNT.toNumber() * 10,
      [],
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
  });

  async function initializePool(
    poolState: PublicKey,
    authority: PublicKey,
    tokenAMint: PublicKey,
    tokenBMint: PublicKey,
    userTokenAAccount: PublicKey,
    userTokenBAccount: PublicKey,
    tokenAVault: PublicKey,
    tokenBVault: PublicKey,
    tokenAProgram: PublicKey,
    tokenBProgram: PublicKey
  ) {
    await program.methods
      .initializePool(INITIAL_TOKEN_A_AMOUNT, INITIAL_TOKEN_B_AMOUNT)
      .accounts({
        user: wallet.publicKey,
        poolState,
        authority,
        userTokenA: userTokenAAccount,
        userTokenB: userTokenBAccount,
        tokenAVault,
        tokenBVault,
        tokenAMint,
        tokenBMint,
        tokenAProgram,
        tokenBProgram,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Verify pool state
    const poolStateAccount = await program.account.poolState.fetch(poolState);
    assert.equal(
      poolStateAccount.tokenAVault.toBase58(),
      tokenAVault.toBase58(),
      "Token A vault mismatch"
    );
    assert.equal(
      poolStateAccount.tokenBVault.toBase58(),
      tokenBVault.toBase58(),
      "Token B vault mismatch"
    );
  }

  async function performSwap(
    poolState: PublicKey,
    authority: PublicKey,
    inputTokenAccount: PublicKey,
    outputTokenAccount: PublicKey,
    tokenAVault: PublicKey,
    tokenBVault: PublicKey,
    inputTokenMint: PublicKey,
    inputTokenProgram: PublicKey,
    outputTokenMint: PublicKey,
    outputTokenProgram: PublicKey
  ) {
    const observationState = Keypair.generate();
    const initialInputBalance =
      await provider.connection.getTokenAccountBalance(inputTokenAccount);
    const initialOutputBalance =
      await provider.connection.getTokenAccountBalance(outputTokenAccount);

    await program.methods
      .swapBaseInput(SWAP_AMOUNT_IN, MINIMUM_AMOUNT_OUT)
      .accounts({
        payer: wallet.publicKey,
        authority,
        ammConfig: Keypair.generate().publicKey,
        poolState,
        inputTokenAccount,
        outputTokenAccount,
        tokenAVault,
        tokenBVault,
        inputTokenProgram,
        outputTokenProgram,
        inputTokenMint,
        outputTokenMint,
        observationState: observationState.publicKey,
      })
      .rpc();

    // Verify balances changed
    const finalInputBalance = await provider.connection.getTokenAccountBalance(
      inputTokenAccount
    );
    const finalOutputBalance = await provider.connection.getTokenAccountBalance(
      outputTokenAccount
    );
    assert.isBelow(
      finalInputBalance.value.uiAmount,
      initialInputBalance.value.uiAmount,
      "Input token balance should decrease"
    );
    assert.isAbove(
      finalOutputBalance.value.uiAmount,
      initialOutputBalance.value.uiAmount,
      "Output token balance should increase"
    );
  }

  it("Initializes pool and swaps Token to Token", async () => {
    await initializePool(
      poolStateTokenToToken,
      authorityTokenToToken,
      tokenAMint,
      tokenBMint,
      userTokenAAccount,
      userTokenBAccount,
      tokenAVaultTokenToToken,
      tokenBVaultTokenToToken,
      TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID
    );

    await performSwap(
      poolStateTokenToToken,
      authorityTokenToToken,
      userTokenAAccount,
      userTokenBAccount,
      tokenAVaultTokenToToken,
      tokenBVaultTokenToToken,
      tokenAMint,
      TOKEN_PROGRAM_ID,
      tokenBMint,
      TOKEN_PROGRAM_ID
    );
  });

  it("Initializes pool and swaps Token to Token-2022", async () => {
    await initializePool(
      poolStateTokenTo2022,
      authorityTokenTo2022,
      tokenAMint,
      token2022BMint,
      userTokenAAccount,
      userToken2022BAccount,
      tokenAVaultTokenTo2022,
      tokenBVaultTokenTo2022,
      TOKEN_PROGRAM_ID,
      TOKEN_2022_PROGRAM_ID
    );

    await performSwap(
      poolStateTokenTo2022,
      authorityTokenTo2022,
      userTokenAAccount,
      userToken2022BAccount,
      tokenAVaultTokenTo2022,
      tokenBVaultTokenTo2022,
      tokenAMint,
      TOKEN_PROGRAM_ID,
      token2022BMint,
      TOKEN_2022_PROGRAM_ID
    );
  });

  it("Initializes pool and swaps Token-2022 to Token-2022", async () => {
    await initializePool(
      poolState2022To2022,
      authority2022To2022,
      token2022AMint,
      token2022BMint,
      userToken2022AAccount,
      userToken2022BAccount,
      tokenAVault2022To2022,
      tokenBVault2022To2022,
      TOKEN_2022_PROGRAM_ID,
      TOKEN_2022_PROGRAM_ID
    );

    await performSwap(
      poolState2022To2022,
      authority2022To2022,
      userToken2022AAccount,
      userToken2022BAccount,
      tokenAVault2022To2022,
      tokenBVault2022To2022,
      token2022AMint,
      TOKEN_2022_PROGRAM_ID,
      token2022BMint,
      TOKEN_2022_PROGRAM_ID
    );
  });

  it("Initializes pool and swaps Token-2022 to Token", async () => {
    await initializePool(
      poolState2022ToToken,
      authority2022ToToken,
      token2022AMint,
      tokenBMint,
      userToken2022AAccount,
      userTokenBAccount,
      tokenAVault2022ToToken,
      tokenBVault2022ToToken,
      TOKEN_2022_PROGRAM_ID,
      TOKEN_PROGRAM_ID
    );

    await performSwap(
      poolState2022ToToken,
      authority2022ToToken,
      userToken2022AAccount,
      userTokenBAccount,
      tokenAVault2022ToToken,
      tokenBVault2022ToToken,
      token2022AMint,
      TOKEN_2022_PROGRAM_ID,
      tokenBMint,
      TOKEN_PROGRAM_ID
    );
  });
});
