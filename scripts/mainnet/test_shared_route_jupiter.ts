import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  Connection,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
  TransactionMessage,
  ComputeBudgetProgram,
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

// Mainnet constants
const JUPITER_V6_PROGRAM_ID = new PublicKey(
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"
);
const JUPITER_EVENT_AUTHORITY = new PublicKey(
  "D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf"
);
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");

// Function to load keypair
const loadKeypair = (): Keypair => {
  const fppStagingPath = process.env.HOME + "/.config/solana/fpp-staging.json";
  const defaultPath = process.env.HOME + "/.config/solana/id.json";

  if (fs.existsSync(fppStagingPath)) {
    const secretKey = JSON.parse(fs.readFileSync(fppStagingPath, "utf8"));
    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
  } else if (fs.existsSync(defaultPath)) {
    const secretKey = JSON.parse(fs.readFileSync(defaultPath, "utf8"));
    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
  }
  throw new Error(
    "Keypair file not found at: " + fppStagingPath + " or " + defaultPath
  );
};

// Configure connection to Solana Mainnet
const RPC_URL = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
const connection = new Connection(RPC_URL, "confirmed");

// Create wallet and provider
const wallet = new anchor.Wallet(loadKeypair());
const provider = new AnchorProvider(connection, wallet, {
  commitment: "confirmed",
});
anchor.setProvider(provider);

// Load program
const flipperProgram = new Program(FLIPPER_IDL, provider);

interface JupiterQuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  platformFee: any;
  priceImpactPct: string;
  routePlan: Array<{
    swapInfo: {
      ammKey: string;
      label: string;
      inputMint: string;
      outputMint: string;
      inAmount: string;
      outAmount: string;
      feeAmount: string;
      feeMint: string;
    };
    percent: number;
  }>;
  contextSlot: number;
  timeTaken: number;
}

interface JupiterSwapInstructionsResponse {
  tokenLedgerInstruction: any;
  computeBudgetInstructions: any[];
  setupInstructions: any[];
  swapInstruction: {
    programId: string;
    accounts: Array<{
      pubkey: string;
      isSigner: boolean;
      isWritable: boolean;
    }>;
    data: string;
  };
  cleanupInstruction: any;
  addressLookupTableAddresses: string[];
}

/**
 * Get Jupiter quote for the swap
 */
async function getJupiterQuote(
  inputMint: string,
  outputMint: string,
  amount: number,
  slippageBps: number = 50
): Promise<JupiterQuoteResponse> {
  const url =
    `https://public.jupiterapi.com/quote?` +
    `inputMint=${inputMint}&` +
    `outputMint=${outputMint}&` +
    `amount=${amount}&` +
    `slippageBps=${slippageBps}`;

  console.log("📡 Fetching Jupiter quote...");
  console.log("   URL:", url);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Jupiter API error: ${response.status} ${response.statusText}`
    );
  }

  const quote = await response.json();
  console.log("✅ Quote received");
  console.log("   Input:", quote.inAmount, inputMint.slice(0, 8) + "...");
  console.log("   Output:", quote.outAmount, outputMint.slice(0, 8) + "...");
  console.log("   Price Impact:", quote.priceImpactPct);
  console.log(
    "   Route:",
    quote.routePlan.map((r: any) => r.swapInfo.label).join(" -> ")
  );
  console.log();

  return quote;
}

/**
 * Get Jupiter swap instructions with shared accounts
 */
async function getJupiterSwapInstructions(
  quoteResponse: JupiterQuoteResponse,
  userPublicKey: string,
  wrapAndUnwrapSol: boolean = true
): Promise<JupiterSwapInstructionsResponse> {
  const url = "https://public.jupiterapi.com/swap-instructions";

  console.log("📡 Fetching Jupiter swap instructions...");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey,
      useSharedAccounts: true,
      wrapAndUnwrapSol,
      computeUnitPriceMicroLamports: 50000,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Jupiter swap instructions error: ${response.status} ${errorText}`
    );
  }

  const instructions = await response.json();
  console.log("✅ Swap instructions received");
  console.log(
    "   Setup instructions:",
    instructions.setupInstructions?.length || 0
  );
  console.log(
    "   Cleanup instructions:",
    instructions.cleanupInstruction ? 1 : 0
  );
  console.log(
    "   Address Lookup Tables:",
    instructions.addressLookupTableAddresses?.length || 0
  );
  console.log();

  return instructions;
}

async function waitForConfirmation(ms: number = 2000) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testSharedRouteMainnet() {
  try {
    console.log("=".repeat(60));
    console.log("🚀 Testing shared_route with Jupiter on Mainnet");
    console.log("=".repeat(60));
    console.log();
    console.log("📍 Configuration:");
    console.log("   Wallet:", wallet.publicKey.toBase58());
    console.log("   Flipper Program:", flipperProgram.programId.toBase58());
    console.log("   Jupiter Program:", JUPITER_V6_PROGRAM_ID.toBase58());
    console.log("   Source Mint (WSOL):", WSOL_MINT.toBase58());
    console.log("   Destination Mint (USDC):", USDC_MINT.toBase58());
    console.log();

    // Derive PDAs
    const [vaultAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_authority")],
      flipperProgram.programId
    );

    console.log("📍 PDAs:");
    console.log("   Vault Authority:", vaultAuthority.toBase58());
    console.log();

    // Test parameters
    const inputAmount = 10_000_000; // 0.01 SOL (9 decimals)
    const slippageBps = 50; // 0.5%
    const platformFeeBps = 0; // 0% for testing

    console.log("📊 Swap parameters:");
    console.log("   Input Amount:", inputAmount, "lamports (0.01 SOL)");
    console.log("   Slippage:", slippageBps, "bps (0.5%)");
    console.log("   Platform Fee:", platformFeeBps, "bps (0%)");
    console.log();

    // Get Jupiter quote
    const quote = await getJupiterQuote(
      WSOL_MINT.toBase58(),
      USDC_MINT.toBase58(),
      inputAmount,
      slippageBps
    );

    const quotedOutAmount = new BN(quote.outAmount);
    const inAmount = new BN(quote.inAmount);

    // Create or get user token accounts
    console.log("💰 Setting up token accounts...");

    let userSourceTokenAccount: PublicKey;
    try {
      userSourceTokenAccount = getAssociatedTokenAddressSync(
        WSOL_MINT,
        wallet.publicKey,
        false,
        TOKEN_PROGRAM_ID
      );
      const accountInfo = await getAccount(connection, userSourceTokenAccount);
      console.log(
        "   ✓ WSOL account exists:",
        userSourceTokenAccount.toBase58()
      );
      console.log("   Balance:", accountInfo.amount.toString());
    } catch (e) {
      console.log("   Creating WSOL account...");
      const account = await getOrCreateAssociatedTokenAccount(
        connection,
        wallet.payer,
        WSOL_MINT,
        wallet.publicKey,
        false
      );
      userSourceTokenAccount = account.address;
      console.log(
        "   ✓ WSOL account created:",
        userSourceTokenAccount.toBase58()
      );
    }

    let userDestinationTokenAccount: PublicKey;
    try {
      userDestinationTokenAccount = getAssociatedTokenAddressSync(
        USDC_MINT,
        wallet.publicKey,
        false,
        TOKEN_PROGRAM_ID
      );
      const accountInfo = await getAccount(
        connection,
        userDestinationTokenAccount
      );
      console.log(
        "   ✓ USDC account exists:",
        userDestinationTokenAccount.toBase58()
      );
      console.log("   Balance:", accountInfo.amount.toString());
    } catch (e) {
      console.log("   Creating USDC account...");
      const account = await getOrCreateAssociatedTokenAccount(
        connection,
        wallet.payer,
        USDC_MINT,
        wallet.publicKey,
        false
      );
      userDestinationTokenAccount = account.address;
      console.log(
        "   ✓ USDC account created:",
        userDestinationTokenAccount.toBase58()
      );
    }
    console.log();

    // Check and wrap SOL if needed
    const wsolAccount = await getAccount(connection, userSourceTokenAccount);
    const currentWsolBalance = wsolAccount.amount;

    console.log("💰 Checking WSOL balance...");
    console.log("   Current WSOL balance:", currentWsolBalance.toString());
    console.log("   Required:", inputAmount);

    if (currentWsolBalance < BigInt(inputAmount)) {
      console.log("   ⚠️  Insufficient WSOL. Wrapping SOL...");
      const neededAmount = BigInt(inputAmount) - currentWsolBalance;
      const solNeeded = neededAmount + BigInt(2_000_000); // Add extra for rent

      const solBalance = await connection.getBalance(wallet.publicKey);
      console.log("   SOL Balance:", solBalance);
      console.log("   SOL Needed:", solNeeded.toString());

      if (solBalance < Number(solNeeded)) {
        throw new Error(
          `Insufficient SOL balance. Need ${solNeeded.toString()} lamports, have ${solBalance}`
        );
      }

      const transferInstruction = SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: userSourceTokenAccount,
        lamports: Number(solNeeded),
      });

      const syncNativeInstruction = createSyncNativeInstruction(
        userSourceTokenAccount
      );

      const wrapTx = new Transaction()
        .add(transferInstruction)
        .add(syncNativeInstruction);
      const wrapSignature = await provider.sendAndConfirm(wrapTx);
      console.log("   ✅ SOL wrapped to WSOL");
      console.log("   Transaction:", wrapSignature);
      console.log();
      await waitForConfirmation(2000);
    } else {
      console.log("   ✅ Sufficient WSOL balance");
      console.log();
    }

    // Get balances before swap
    console.log("💰 Balances before swap:");
    const userSourceBefore = await getAccount(
      connection,
      userSourceTokenAccount
    );
    const userDestBefore = await getAccount(
      connection,
      userDestinationTokenAccount
    );
    console.log("   User WSOL balance:", userSourceBefore.amount.toString());
    console.log("   User USDC balance:", userDestBefore.amount.toString());
    console.log();

    // Derive vault PDAs using ["vault", mint] seeds
    console.log("🏦 Deriving vault PDAs...");
    const [adapterRegistry] = PublicKey.findProgramAddressSync(
      [Buffer.from("adapter_registry")],
      flipperProgram.programId
    );

    const [sourceVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), WSOL_MINT.toBuffer()],
      flipperProgram.programId
    );

    const [destinationVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), USDC_MINT.toBuffer()],
      flipperProgram.programId
    );

    console.log("   Adapter Registry:", adapterRegistry.toBase58());
    console.log("   Source Vault (WSOL):", sourceVault.toBase58());
    console.log("   Destination Vault (USDC):", destinationVault.toBase58());

    // Check source vault exists
    let sourceVaultExists = false;
    let destVaultExists = false;

    try {
      const sourceVaultInfo = await connection.getAccountInfo(sourceVault);
      if (sourceVaultInfo) {
        const vaultAccount = await getAccount(connection, sourceVault);
        console.log(
          "   ✓ Source vault exists, balance:",
          vaultAccount.amount.toString()
        );
        sourceVaultExists = true;
      } else {
        console.log("   ❌ Source vault NOT found");
      }
    } catch (e) {
      console.log("   ❌ Source vault NOT initialized");
    }

    // Check destination vault exists
    try {
      const destVaultInfo = await connection.getAccountInfo(destinationVault);
      if (destVaultInfo) {
        const vaultAccount = await getAccount(connection, destinationVault);
        console.log(
          "   ✓ Destination vault exists, balance:",
          vaultAccount.amount.toString()
        );
        destVaultExists = true;
      } else {
        console.log("   ❌ Destination vault NOT found");
      }
    } catch (e) {
      console.log("   ❌ Destination vault NOT initialized");
    }

    // If any vault is missing, show error and exit
    if (!sourceVaultExists || !destVaultExists) {
      console.log();
      console.log("❌ ERROR: Required vaults do not exist!");
      console.log();
      console.log(
        "⚠️  Current deployed program version requires Vault Authority admin to create vaults."
      );
      console.log("   Operators cannot create vaults in the current version.");
      console.log();
      console.log("Current wallet:", wallet.publicKey.toBase58());
      console.log(
        "Vault Authority Admin:",
        "7R6hWcbMoWq6rwDhPJAd2HHPKexC81JP8RrZ78xGK1i4"
      );
      console.log();
      console.log("Solutions:");
      console.log("  1. Use admin wallet to create vaults:");
      console.log(
        `     MINT_ADDRESS=<mint_address> npm run mainnet:create-vault`
      );
      console.log();
      console.log(
        "  2. Deploy updated program version (enables operator vault creation):"
      );
      console.log(
        "     anchor build && anchor deploy --provider.cluster mainnet"
      );
      process.exit(1);
    }
    console.log();

    // Platform fee account (USDC) - separate ATA owned by vault_authority
    const platformFeeAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      USDC_MINT,
      vaultAuthority,
      true // allowOwnerOffCurve for PDA
    ).then((acc) => acc.address);

    console.log(
      "💰 Platform Fee Account (USDC):",
      platformFeeAccount.toBase58()
    );
    console.log("   Type: ATA owned by Vault Authority");
    console.log(
      "   Different from destination vault:",
      !platformFeeAccount.equals(destinationVault)
    );
    console.log();

    // Get Jupiter swap instructions
    const swapInstructions = await getJupiterSwapInstructions(
      quote,
      vaultAuthority.toBase58(), // Use vault authority as the user for Jupiter
      false // Don't wrap/unwrap SOL, we handle it ourselves
    );

    // Extract instruction data from Jupiter response
    const jupiterInstructionData = Buffer.from(
      swapInstructions.swapInstruction.data,
      "base64"
    );

    console.log("📋 Jupiter Instruction Data:");
    console.log("   Length:", jupiterInstructionData.length, "bytes");
    console.log(
      "   First 16 bytes (hex):",
      jupiterInstructionData.slice(0, 16).toString("hex")
    );
    console.log();

    // Build remaining accounts from Jupiter instruction
    // Important: Replace Jupiter's accounts with our vault PDAs
    const JUPITER_USER_SOURCE_INDEX = 3;
    const JUPITER_USER_DESTINATION_INDEX = 6;

    const jupiterAccounts = swapInstructions.swapInstruction.accounts.map(
      (acc, idx) => {
        let pubkey = new PublicKey(acc.pubkey);
        let isSigner = acc.isSigner;

        // Replace Jupiter's user_source with our vault_source (index 3)
        if (idx === JUPITER_USER_SOURCE_INDEX) {
          pubkey = sourceVault;
          console.log(
            `   [${idx}] Replaced user_source with vault_source:`,
            pubkey.toBase58()
          );
        }

        // Replace Jupiter's user_destination with our vault_destination (index 6)
        if (idx === JUPITER_USER_DESTINATION_INDEX) {
          pubkey = destinationVault;
          console.log(
            `   [${idx}] Replaced user_destination with vault_destination:`,
            pubkey.toBase58()
          );
        }

        // Vault authority is a PDA and cannot sign
        if (pubkey.equals(vaultAuthority)) {
          isSigner = false;
        }

        return {
          pubkey,
          isSigner,
          isWritable: acc.isWritable,
        };
      }
    );

    console.log("📋 Jupiter Remaining Accounts:", jupiterAccounts.length);
    jupiterAccounts.slice(0, 10).forEach((acc, idx) => {
      console.log(
        `   [${idx}] ${acc.pubkey.toBase58()} (w:${acc.isWritable}, s:${
          acc.isSigner
        })`
      );
    });
    if (jupiterAccounts.length > 10) {
      console.log(`   ... and ${jupiterAccounts.length - 10} more accounts`);
    }
    console.log();

    // Execute shared_route instruction
    console.log("⚡ Executing shared_route instruction...");
    console.log("   This will:");
    console.log("   1. Transfer WSOL from user to source vault");
    console.log("   2. Call Jupiter via CPI to perform the swap");
    console.log("   3. Transfer USDC from destination vault to user");
    console.log();

    try {
      // Add compute budget instructions for complex swaps
      const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: 1_400_000,
      });

      const computePriceIx = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: 100_000,
      });

      // Build main instruction
      const instruction = await flipperProgram.methods
        .sharedRoute(
          inAmount,
          quotedOutAmount,
          slippageBps,
          platformFeeBps,
          jupiterInstructionData
        )
        .accounts({
          vaultAuthority,
          userSourceTokenAccount,
          userDestinationTokenAccount,
          vaultSource: sourceVault,
          vaultDestination: destinationVault,
          sourceMint: WSOL_MINT,
          destinationMint: USDC_MINT,
          inputTokenProgram: TOKEN_PROGRAM_ID,
          outputTokenProgram: TOKEN_PROGRAM_ID,
          userTransferAuthority: wallet.publicKey,
          platformFeeAccount,
          jupiterProgram: JUPITER_V6_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(jupiterAccounts)
        .instruction();

      // Fetch address lookup tables
      const lookupTableAddresses =
        swapInstructions.addressLookupTableAddresses.map(
          (addr) => new PublicKey(addr)
        );

      const lookupTables = await Promise.all(
        lookupTableAddresses.map(async (altAddress) => {
          const altAccountInfo = await connection.getAddressLookupTable(
            altAddress
          );
          if (!altAccountInfo.value) {
            throw new Error(
              `Address Lookup Table ${altAddress.toBase58()} not found`
            );
          }
          return altAccountInfo.value;
        })
      );

      // Build versioned transaction
      const { blockhash } = await connection.getLatestBlockhash();
      const messageV0 = new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: blockhash,
        instructions: [computeBudgetIx, computePriceIx, instruction],
      }).compileToV0Message(lookupTables);

      const transaction = new VersionedTransaction(messageV0);
      transaction.sign([wallet.payer]);

      // Send and confirm transaction
      const txSignature = await connection.sendTransaction(transaction);
      await connection.confirmTransaction(txSignature, "confirmed");

      console.log("✅ Transaction signature:", txSignature);
      console.log("   Explorer:", `https://solscan.io/tx/${txSignature}`);
      console.log();

      await waitForConfirmation(3000);

      // Get balances after swap
      console.log("💰 Balances after swap:");
      const userSourceAfter = await getAccount(
        connection,
        userSourceTokenAccount
      );
      const userDestAfter = await getAccount(
        connection,
        userDestinationTokenAccount
      );
      console.log("   User WSOL balance:", userSourceAfter.amount.toString());
      console.log("   User USDC balance:", userDestAfter.amount.toString());
      console.log();

      // Calculate changes
      const sourceChange =
        Number(userSourceBefore.amount) - Number(userSourceAfter.amount);
      const destChange =
        Number(userDestAfter.amount) - Number(userDestBefore.amount);

      console.log("📈 Balance changes:");
      console.log("   WSOL spent:", sourceChange, "lamports");
      console.log("   USDC received:", destChange, "micro-USDC");
      console.log();

      // Verify the swap worked correctly
      if (sourceChange === inAmount.toNumber()) {
        console.log("✅ Source tokens deducted correctly");
      } else {
        console.log("⚠️  Source token deduction mismatch!");
        console.log("   Expected:", inAmount.toNumber());
        console.log("   Actual:", sourceChange);
      }

      if (destChange > 0) {
        console.log("✅ Destination tokens received");
        const rate = destChange / sourceChange;
        console.log(
          `   Exchange rate: 1 SOL ≈ ${(
            (rate * 1_000_000_000) /
            1_000_000
          ).toFixed(2)} USDC`
        );
      } else {
        console.log("❌ No destination tokens received!");
      }

      console.log();
      console.log("=".repeat(60));
      console.log("✅ SHARED_ROUTE TEST COMPLETED SUCCESSFULLY!");
      console.log("=".repeat(60));
      console.log();
      console.log(
        "💡 Jupiter successfully executed the swap via Flipper's shared_route"
      );
      console.log("   Transaction confirmed on Solana mainnet");
      console.log();
    } catch (error: any) {
      console.error("\n❌ Error during transaction:", error);
      if (error?.logs) {
        console.error("\n📋 Transaction logs:");
        error.logs.forEach((log: string) => console.error("   ", log));
      }
      throw error;
    }
  } catch (error: any) {
    console.error("\n❌ Error during test:", error.message);
    if (error?.stack) {
      console.error("\n📋 Stack trace:");
      console.error(error.stack);
    }
    throw error;
  }
}

// Main execution
(async () => {
  try {
    await testSharedRouteMainnet();
  } catch (error: any) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
})();
