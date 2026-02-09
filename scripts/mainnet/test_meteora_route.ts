import * as anchor from "@coral-xyz/anchor";
import { Program, BN, AnchorProvider } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  Connection,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  getAccount,
  createSyncNativeInstruction,
} from "@solana/spl-token";
import FLIPPER_IDL from "../../target/idl/flipper.json";
import fs from "fs";

// Function to load keypair for mainnet wallet
const loadKeypair = (): Keypair => {
  const keypairPath = process.env.HOME + "/.config/solana/fpp-staging.json";
  if (fs.existsSync(keypairPath)) {
    const secretKey = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
  }
  throw new Error(`Keypair file not found at ${keypairPath}`);
};

// Configure connection to Solana Mainnet
const connection = new Connection(
  "https://api.mainnet-beta.solana.com",
  "confirmed"
);

// Create wallet and provider for Anchor
const wallet = new anchor.Wallet(loadKeypair());
const provider = new AnchorProvider(connection, wallet, {
  commitment: "confirmed",
});
anchor.setProvider(provider);

// Load program
const flipperProgram = new Program(FLIPPER_IDL, provider);

// Mainnet constants
const METEORA_DLMM_PROGRAM_ID = new PublicKey(
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo"
);
const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

// Meteora pool addresses from the log
const METEORA_LB_PAIR = new PublicKey(
  "HTvjzsfX3yU6BUodCjZ5vZkUrAxMDTrBs3CJaq43ashR"
);
const METEORA_BIN_ARRAY_BITMAP_EXT = new PublicKey(
  "9HcJeBEsq5px2bYZbdo7vzQWVsPK3SHTkchy42hBn7HC"
);
const METEORA_RESERVE_X = new PublicKey(
  "H7j5NPopj3tQvDg4N8CxwtYciTn3e8AEV6wSVrxpyDUc"
);
const METEORA_RESERVE_Y = new PublicKey(
  "HbYjRzx7teCxqW3unpXBEcNHhfVZvW2vW9MQ99TkizWt"
);
const METEORA_ORACLE = new PublicKey(
  "EgEYXef2FCoEYLHJJW74dMbom1atLXo6KwPuA6mSATYA"
);
const METEORA_HOST_FEE_IN = new PublicKey(
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo"
);
const METEORA_EVENT_AUTHORITY = new PublicKey(
  "D1ZN9Wj1fRSUQfCjhvnu1hqDMT7hzjzBBpi12nVniYD6"
);
const METEORA_BIN_ARRAYS = [
  new PublicKey("3G3mGvCHG8aAQnwoV2Fyaxj41vuFwbYmuUMys4Uu7ug1"), // bin_array #17
  new PublicKey("3jLP2PgHYj1rboZpdWiftpbx6wEfd4mHCSLxte8WHduf"), // bin_array #18
  new PublicKey("EZXDZv2vd3VPm7axRkU2g1XXnbbUMCJMZFEWs5r9SA2X"), // bin_array #19
  new PublicKey("36NqA3ZFmztXc6MtJjyZzVigodcQZnuug72BtnVdD8gN"), // bin_array #20
];
const PLATFORM_FEE_ACCOUNT = new PublicKey(
  "BHbNdVGbHSxskzafynuc9p1zT8WM7sGiJUPV4q8szxQB"
);

function getSwapTypeBytes(swapType: any): Buffer {
  const bytes = Buffer.alloc(32, 0);
  if ("meteora" in swapType) bytes[0] = 19; // Meteora swap type encoded as 19
  return bytes;
}

async function main() {
  console.log("🚀 Testing Meteora Route on Mainnet\n");
  console.log("📍 Configuration:");
  console.log("   Wallet:", wallet.publicKey.toBase58());
  console.log("   Program ID:", flipperProgram.programId.toBase58());
  console.log("   Meteora Program ID:", METEORA_DLMM_PROGRAM_ID.toBase58());
  console.log("   Memo Program ID:", MEMO_PROGRAM_ID.toBase58());
  console.log("   WSOL Mint:", WSOL_MINT.toBase58());
  console.log("   USDC Mint:", USDC_MINT.toBase58());
  console.log("   LB Pair:", METEORA_LB_PAIR.toBase58());
  console.log("   Bin Arrays:", METEORA_BIN_ARRAYS.length, "\n");

  // Derive PDAs
  const [adapterRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from("adapter_registry")],
    flipperProgram.programId
  );
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority")],
    flipperProgram.programId
  );

  // Derive pool info PDA
  const [meteoraPoolInfo] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("pool_info"),
      getSwapTypeBytes({ meteora: {} }),
      METEORA_LB_PAIR.toBuffer(),
    ],
    flipperProgram.programId
  );

  console.log("📍 PDAs:");
  console.log("   Adapter Registry:", adapterRegistry.toBase58());
  console.log("   Vault Authority:", vaultAuthority.toBase58());
  console.log("   Pool Info:", meteoraPoolInfo.toBase58(), "\n");

  // Create or get user token accounts for WSOL and USDC
  console.log("💰 Creating user token accounts...");
  let userWsolAccount: PublicKey;
  let userUsdcAccount: PublicKey;

  try {
    userWsolAccount = getAssociatedTokenAddressSync(
      WSOL_MINT,
      wallet.publicKey,
      false,
      TOKEN_PROGRAM_ID
    );
    const wsolAccountInfo = await getAccount(connection, userWsolAccount);
    console.log("   ✓ WSOL account exists:", userWsolAccount.toBase58());
    console.log("   Balance:", wsolAccountInfo.amount.toString());
  } catch (e) {
    console.log("   Creating WSOL account...");
    const wsolAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      WSOL_MINT,
      wallet.publicKey,
      false
    );
    userWsolAccount = wsolAccount.address;
    console.log("   ✓ WSOL account created:", userWsolAccount.toBase58());
  }

  try {
    userUsdcAccount = getAssociatedTokenAddressSync(
      USDC_MINT,
      wallet.publicKey,
      false,
      TOKEN_PROGRAM_ID
    );
    const usdcAccountInfo = await getAccount(connection, userUsdcAccount);
    console.log("   ✓ USDC account exists:", userUsdcAccount.toBase58());
    console.log("   Balance:", usdcAccountInfo.amount.toString());
  } catch (e) {
    console.log("   Creating USDC account...");
    const usdcAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      USDC_MINT,
      wallet.publicKey,
      false
    );
    userUsdcAccount = usdcAccount.address;
    console.log("   ✓ USDC account created:", userUsdcAccount.toBase58());
  }
  console.log();

  // Create vault accounts
  console.log("🏦 Creating vault accounts...");
  const inputVault = await getOrCreateAssociatedTokenAccount(
    connection,
    wallet.payer,
    WSOL_MINT,
    vaultAuthority,
    true
  ).then((acc) => acc.address);

  const outputVault = await getOrCreateAssociatedTokenAccount(
    connection,
    wallet.payer,
    USDC_MINT,
    vaultAuthority,
    true
  ).then((acc) => acc.address);

  console.log("   Input Vault (WSOL):", inputVault.toBase58());
  console.log("   Output Vault (USDC):", outputVault.toBase58());
  console.log();

  // Platform fee account (from log)
  console.log("💰 Platform Fee Account:");
  console.log("   Address:", PLATFORM_FEE_ACCOUNT.toBase58());
  try {
    const platformFeeAccountInfo = await getAccount(
      connection,
      PLATFORM_FEE_ACCOUNT
    );
    console.log("   Balance:", platformFeeAccountInfo.amount.toString());
  } catch (e) {
    console.log("   ⚠️  Platform fee account not found or not accessible");
  }
  console.log();

  // Check if PoolInfo exists, if not initialize it
  console.log("🔍 Checking PoolInfo...");
  try {
    const poolInfoAccount = await (
      flipperProgram.account as any
    ).poolInfo.fetch(meteoraPoolInfo);
    console.log("   ✓ PoolInfo already exists");
    console.log("   Enabled:", poolInfoAccount.enabled);
    console.log("   Pool Address:", poolInfoAccount.poolAddress.toBase58());
    console.log(
      "   Swap Type:",
      JSON.stringify(poolInfoAccount.adapterSwapType)
    );
  } catch (e: any) {
    if (e.message && e.message.includes("Account does not exist")) {
      console.log("   ⚠️  PoolInfo does not exist, initializing...");
      try {
        const initTxSignature = await flipperProgram.methods
          .initializePoolInfo({ meteora: {} }, METEORA_LB_PAIR)
          .accounts({
            poolInfo: meteoraPoolInfo,
            adapterRegistry,
            payer: wallet.publicKey,
            operator: wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([wallet.payer])
          .rpc();

        console.log("   ✓ PoolInfo initialized");
        console.log("   Transaction:", initTxSignature);
        console.log("   Explorer:", `https://solscan.io/tx/${initTxSignature}`);
      } catch (initError: any) {
        console.error(
          "   ❌ Failed to initialize PoolInfo:",
          initError.message
        );
        throw initError;
      }
    } else {
      throw e;
    }
  }
  console.log();

  // Prepare route plan
  const routePlan = [
    {
      swap: { meteora: {} },
      inputIndex: 0,
      outputIndex: 22, // Output vault index (after bin arrays and second program_id)
      percent: 100,
    },
  ];

  // Prepare remaining accounts for Meteora swap2 instruction (with memo_program)
  // Order according to adapter expectations:
  // [0] Input Vault
  // [1] Pool Info
  // [2] LB Pair
  // [3] Bin Array Bitmap Extension
  // [4] Reserve X
  // [5] Reserve Y
  // [6] Vault X (pool token_x) - user_token_in
  // [7] Vault Y (pool token_y) - user_token_out
  // [8] Token X Mint
  // [9] Token Y Mint
  // [10] Oracle
  // [11] Host Fee In
  // [12] Token X Program
  // [13] Token Y Program
  // [14] Memo Program (NEW in swap2)
  // [15] Event Authority
  // [16] Program (first program_id)
  // [17-20] Bin Arrays (4 штуки, между двумя program_id)
  // [21] Program ID (second program_id - marks end of bin arrays)
  // [22] Output Vault
  const remainingAccounts = [
    { pubkey: inputVault, isWritable: true, isSigner: false }, // 0: inputVault
    { pubkey: meteoraPoolInfo, isWritable: false, isSigner: false }, // 1: pool_info
    { pubkey: METEORA_LB_PAIR, isWritable: true, isSigner: false }, // 2: lb_pair
    { pubkey: METEORA_BIN_ARRAY_BITMAP_EXT, isWritable: true, isSigner: false }, // 3: bin_array_bitmap_extension
    { pubkey: METEORA_RESERVE_X, isWritable: true, isSigner: false }, // 4: reserve_x
    { pubkey: METEORA_RESERVE_Y, isWritable: true, isSigner: false }, // 5: reserve_y
    { pubkey: inputVault, isWritable: true, isSigner: false }, // 6: user_token_in (vault X)
    { pubkey: outputVault, isWritable: true, isSigner: false }, // 7: user_token_out (vault Y)
    { pubkey: WSOL_MINT, isWritable: false, isSigner: false }, // 8: token_x_mint
    { pubkey: USDC_MINT, isWritable: false, isSigner: false }, // 9: token_y_mint
    { pubkey: METEORA_ORACLE, isWritable: true, isSigner: false }, // 10: oracle
    { pubkey: METEORA_HOST_FEE_IN, isWritable: true, isSigner: false }, // 11: host_fee_in
    { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false }, // 12: token_x_program
    { pubkey: TOKEN_PROGRAM_ID, isWritable: false, isSigner: false }, // 13: token_y_program
    { pubkey: MEMO_PROGRAM_ID, isWritable: false, isSigner: false }, // 14: memo_program (NEW in swap2)
    { pubkey: METEORA_EVENT_AUTHORITY, isWritable: false, isSigner: false }, // 15: event_authority
    { pubkey: METEORA_DLMM_PROGRAM_ID, isWritable: false, isSigner: false }, // 16: program (first program_id)
    // Bin arrays (4 штуки, между двумя program_id)
    { pubkey: METEORA_BIN_ARRAYS[0], isWritable: true, isSigner: false }, // 17: bin_array #17
    { pubkey: METEORA_BIN_ARRAYS[1], isWritable: true, isSigner: false }, // 18: bin_array #18
    { pubkey: METEORA_BIN_ARRAYS[2], isWritable: true, isSigner: false }, // 19: bin_array #19
    { pubkey: METEORA_BIN_ARRAYS[3], isWritable: true, isSigner: false }, // 20: bin_array #20
    { pubkey: METEORA_DLMM_PROGRAM_ID, isWritable: false, isSigner: false }, // 21: program ID (second program_id - marks end of bin arrays)
    { pubkey: outputVault, isWritable: true, isSigner: false }, // 22: output vault
  ];

  console.log("📋 Route Plan:");
  console.log("   Swap: Meteora DLMM (swap2)");
  console.log("   Input Index: 0");
  console.log("   Output Index: 22");
  console.log("   Percent: 100%");
  console.log();

  console.log("📋 Remaining Accounts:", remainingAccounts.length);
  remainingAccounts.forEach((acc, idx) => {
    console.log(
      `   [${idx}] ${acc.pubkey.toBase58()} (writable: ${
        acc.isWritable
      }, signer: ${acc.isSigner})`
    );
  });
  console.log();

  // Get initial balances
  let initialWsolBalance: bigint;
  let initialUsdcBalance: bigint;

  try {
    const wsolAccountInfo = await getAccount(connection, userWsolAccount);
    initialWsolBalance = wsolAccountInfo.amount;
  } catch (e) {
    console.log("   ⚠️  WSOL account not found, initializing with 0");
    initialWsolBalance = BigInt(0);
  }

  try {
    const usdcAccountInfo = await getAccount(connection, userUsdcAccount);
    initialUsdcBalance = usdcAccountInfo.amount;
  } catch (e) {
    console.log("   ⚠️  USDC account not found, initializing with 0");
    initialUsdcBalance = BigInt(0);
  }

  console.log("💰 Initial Balances:");
  console.log("   WSOL:", initialWsolBalance.toString());
  console.log("   USDC:", initialUsdcBalance.toString());
  console.log();

  // Swap parameters
  const inAmount = new BN(1_000_000); // 0.001 WSOL (9 decimals)
  const quotedOutAmount = new BN(121_931); // Expected USDC output (6 decimals)
  const slippageBps = 50; // 0.5%
  const platformFeeBps = 0; // 0%

  console.log("🔄 Swap Parameters:");
  console.log("   Input Amount:", inAmount.toString(), "WSOL");
  console.log("   Quoted Output:", quotedOutAmount.toString(), "USDC");
  console.log("   Slippage:", slippageBps, "bps (0.5%)");
  console.log("   Platform Fee:", platformFeeBps, "bps");
  console.log();

  // Check if user has enough WSOL balance, if not, wrap SOL to WSOL
  if (initialWsolBalance < BigInt(inAmount.toString())) {
    console.log("⚠️  Insufficient WSOL balance. Wrapping SOL to WSOL...");
    const neededAmount = BigInt(inAmount.toString()) - initialWsolBalance;
    const solNeeded = neededAmount + BigInt(2_000_000); // Add extra for rent and fees

    // Check SOL balance
    const solBalance = await connection.getBalance(wallet.publicKey);
    console.log("   SOL Balance:", solBalance);
    console.log("   SOL Needed:", solNeeded.toString());

    if (solBalance < Number(solNeeded)) {
      throw new Error(
        `Insufficient SOL balance. Need ${solNeeded.toString()} lamports, have ${solBalance}`
      );
    }

    // Transfer SOL to WSOL account
    const transferInstruction = SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: userWsolAccount,
      lamports: Number(solNeeded),
    });

    // Sync native instruction to wrap SOL to WSOL
    const syncNativeInstruction = createSyncNativeInstruction(userWsolAccount);

    const wrapTx = new Transaction()
      .add(transferInstruction)
      .add(syncNativeInstruction);
    const wrapSignature = await provider.sendAndConfirm(wrapTx);
    console.log("   ✓ SOL wrapped to WSOL");
    console.log("   Transaction:", wrapSignature);

    // Update balance
    const updatedWsolAccount = await getAccount(connection, userWsolAccount);
    initialWsolBalance = updatedWsolAccount.amount;
    console.log("   Updated WSOL Balance:", initialWsolBalance.toString());
    console.log();
  }

  // Execute route
  console.log("⚡ Executing route...");
  try {
    const txSignature = await flipperProgram.methods
      .route(routePlan, inAmount, quotedOutAmount, slippageBps, platformFeeBps)
      .accounts({
        adapterRegistry,
        vaultAuthority,
        inputTokenProgram: TOKEN_PROGRAM_ID,
        outputTokenProgram: TOKEN_PROGRAM_ID,
        userTransferAuthority: wallet.publicKey,
        userSourceTokenAccount: userWsolAccount,
        userDestinationTokenAccount: userUsdcAccount,
        sourceMint: WSOL_MINT,
        destinationMint: USDC_MINT,
        platformFeeAccount: PLATFORM_FEE_ACCOUNT,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(remainingAccounts)
      .signers([wallet.payer])
      .rpc();

    console.log("✅ Route executed successfully!");
    console.log("   Transaction signature:", txSignature);
    console.log("   Explorer:", `https://solscan.io/tx/${txSignature}`);
    console.log();

    // Get final balances
    const finalWsolBalance = (await getAccount(connection, userWsolAccount))
      .amount;
    const finalUsdcBalance = (await getAccount(connection, userUsdcAccount))
      .amount;

    console.log("💰 Final Balances:");
    console.log("   WSOL:", finalWsolBalance.toString());
    console.log("   USDC:", finalUsdcBalance.toString());
    console.log();

    console.log("📊 Balance Changes:");
    console.log("   WSOL:", (finalWsolBalance - initialWsolBalance).toString());
    console.log("   USDC:", (finalUsdcBalance - initialUsdcBalance).toString());
    console.log();

    const wsolDiff = Number(finalWsolBalance - initialWsolBalance);
    const usdcDiff = Number(finalUsdcBalance - initialUsdcBalance);

    if (wsolDiff < 0 && usdcDiff > 0) {
      console.log("✅ Swap completed successfully!");
      console.log(`   Swapped ${Math.abs(wsolDiff)} WSOL for ${usdcDiff} USDC`);
    } else {
      console.log("⚠️  Unexpected balance changes");
    }
  } catch (error: any) {
    console.error("❌ Route execution failed:");
    console.error("   Error:", error.message);
    if (error.logs) {
      console.error("   Logs:");
      error.logs.forEach((log: string) => console.error("     ", log));
    }
    throw error;
  }
}

// Main execution
(async () => {
  try {
    await main();
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
})();
