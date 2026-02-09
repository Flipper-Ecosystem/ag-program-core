import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  Connection,
  AddressLookupTableProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import FLIPPER_IDL from "../../target/idl/flipper.json";
import fs from "fs";

// Function to load keypair for mainnet wallet
const loadKeypair = (): Keypair => {
  const keypairPath = process.env.HOME + "/.config/solana/fpp-staging.json";
  if (fs.existsSync(keypairPath)) {
    const secretKey = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
  }
  throw new Error("Keypair file not found at " + keypairPath);
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

/**
 * Получает все Address Lookup Tables, принадлежащие указанному authority
 */
async function getAddressLookupTablesByAuthority(
  authority: PublicKey
): Promise<PublicKey[]> {
  console.log(
    "🔍 Searching for Address Lookup Tables owned by:",
    authority.toBase58()
  );

  // Получаем все аккаунты программы Address Lookup Table
  const programId = new PublicKey(
    "AddressLookupTab1e1111111111111111111111111"
  );

  try {
    const accounts = await connection.getProgramAccounts(programId, {
      filters: [
        {
          memcmp: {
            offset: 22, // Offset для authority в структуре AddressLookupTable
            bytes: authority.toBase58(),
          },
        },
      ],
    });

    console.log(`   Found ${accounts.length} Address Lookup Table(s)\n`);

    return accounts.map((account) => account.pubkey);
  } catch (error) {
    console.error("❌ Error fetching Address Lookup Tables:", error);
    throw error;
  }
}

/**
 * Передает authority для Address Lookup Table новому оператору
 */
async function transferALTAuthority(
  altAddress: PublicKey,
  currentAuthority: Keypair,
  newAuthority: PublicKey
): Promise<string> {
  try {
    // Получаем информацию о текущем состоянии таблицы
    const lookupTableAccount = await connection.getAddressLookupTable(
      altAddress
    );

    if (!lookupTableAccount.value) {
      throw new Error(
        `Address Lookup Table ${altAddress.toBase58()} not found`
      );
    }

    console.log(
      `   Current authority: ${
        lookupTableAccount.value.state.authority?.toBase58() || "None (frozen)"
      }`
    );
    console.log(
      `   Addresses in table: ${lookupTableAccount.value.state.addresses.length}`
    );

    // Проверяем, что таблица не заморожена
    if (!lookupTableAccount.value.state.authority) {
      console.log("   ⚠️  Table is frozen, cannot transfer authority");
      return "skipped";
    }

    // Создаем инструкцию для передачи authority
    const setAuthorityIx = AddressLookupTableProgram.setAuthority({
      lookupTable: altAddress,
      authority: currentAuthority.publicKey,
      newAuthority: newAuthority,
    });

    // Получаем последний blockhash
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash();

    // Создаем сообщение транзакции
    const messageV0 = new TransactionMessage({
      payerKey: currentAuthority.publicKey,
      recentBlockhash: blockhash,
      instructions: [setAuthorityIx],
    }).compileToV0Message();

    // Создаем версионную транзакцию
    const transaction = new VersionedTransaction(messageV0);

    // Подписываем транзакцию
    transaction.sign([currentAuthority]);

    // Отправляем транзакцию
    const signature = await connection.sendTransaction(transaction);

    // Ждем подтверждения
    await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    });

    console.log(`   ✅ Authority transferred successfully!`);
    console.log(`   Transaction: ${signature}\n`);

    return signature;
  } catch (error: any) {
    console.error(`   ❌ Failed to transfer authority: ${error.message}\n`);
    throw error;
  }
}

async function transferAllALTAuthorities() {
  console.log(
    "🚀 Transferring all Address Lookup Table authorities on mainnet...\n"
  );

  // Получаем адрес нового authority из переменной окружения
  const newAuthorityPubkey = process.env.NEW_AUTHORITY_PUBKEY;

  if (!newAuthorityPubkey) {
    throw new Error(
      "NEW_AUTHORITY_PUBKEY environment variable is required.\n" +
        "Usage: NEW_AUTHORITY_PUBKEY=<new_authority_address> npx ts-node scripts/mainnet/transfer_alt_authority.ts"
    );
  }

  const newAuthority = new PublicKey(newAuthorityPubkey);

  console.log("📍 Configuration:");
  console.log("   Current Authority:", wallet.publicKey.toBase58());
  console.log("   New Authority:", newAuthority.toBase58());
  console.log("");

  // Получаем все ALT, принадлежащие текущему authority
  const altAddresses = await getAddressLookupTablesByAuthority(
    wallet.publicKey
  );

  if (altAddresses.length === 0) {
    console.log("ℹ️  No Address Lookup Tables found for current authority.");
    console.log("   Nothing to transfer.\n");
    return;
  }

  console.log("📋 Address Lookup Tables to transfer:");
  altAddresses.forEach((alt, idx) => {
    console.log(`   ${idx + 1}. ${alt.toBase58()}`);
  });
  console.log("");

  // Переменные для отслеживания результатов
  const results: { address: string; status: string; signature?: string }[] = [];

  // Передаем authority для каждой таблицы
  console.log("⚙️  Starting authority transfer...\n");

  for (let i = 0; i < altAddresses.length; i++) {
    const altAddress = altAddresses[i];
    console.log(
      `📍 Processing ALT ${i + 1}/${
        altAddresses.length
      }: ${altAddress.toBase58()}`
    );

    try {
      const signature = await transferALTAuthority(
        altAddress,
        wallet.payer,
        newAuthority
      );

      results.push({
        address: altAddress.toBase58(),
        status: signature === "skipped" ? "skipped" : "success",
        signature: signature !== "skipped" ? signature : undefined,
      });
    } catch (error: any) {
      results.push({
        address: altAddress.toBase58(),
        status: "failed",
      });
    }
  }

  // Выводим сводку результатов
  console.log("═══════════════════════════════════════════════════════════");
  console.log("📊 Transfer Summary:");
  console.log("═══════════════════════════════════════════════════════════");

  const successful = results.filter((r) => r.status === "success").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const failed = results.filter((r) => r.status === "failed").length;

  console.log(`   Total ALTs processed: ${results.length}`);
  console.log(`   ✅ Successfully transferred: ${successful}`);
  console.log(`   ⚠️  Skipped (frozen): ${skipped}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log("");

  if (successful > 0) {
    console.log("✅ Successfully transferred ALTs:");
    results
      .filter((r) => r.status === "success")
      .forEach((r) => {
        console.log(`   • ${r.address}`);
        console.log(`     TX: ${r.signature}`);
      });
    console.log("");
  }

  if (skipped > 0) {
    console.log("⚠️  Skipped ALTs (frozen):");
    results
      .filter((r) => r.status === "skipped")
      .forEach((r) => console.log(`   • ${r.address}`));
    console.log("");
  }

  if (failed > 0) {
    console.log("❌ Failed ALTs:");
    results
      .filter((r) => r.status === "failed")
      .forEach((r) => console.log(`   • ${r.address}`));
    console.log("");
  }

  // Верификация результатов
  if (successful > 0) {
    console.log("🔍 Verifying authority transfer...\n");

    for (const result of results.filter((r) => r.status === "success")) {
      try {
        const altAddress = new PublicKey(result.address);
        const lookupTableAccount = await connection.getAddressLookupTable(
          altAddress
        );

        if (lookupTableAccount.value) {
          const currentAuth = lookupTableAccount.value.state.authority;
          const isCorrect = currentAuth?.equals(newAuthority);

          if (isCorrect) {
            console.log(`   ✅ ${result.address} - Authority verified`);
          } else {
            console.log(`   ⚠️  ${result.address} - Authority mismatch!`);
            console.log(`      Expected: ${newAuthority.toBase58()}`);
            console.log(`      Got: ${currentAuth?.toBase58() || "None"}`);
          }
        }
      } catch (error: any) {
        console.log(
          `   ❌ ${result.address} - Verification failed: ${error.message}`
        );
      }
    }
    console.log("");
  }

  if (failed === 0 && successful > 0) {
    console.log(
      "🎉 All Address Lookup Table authorities transferred successfully!\n"
    );
  } else if (failed > 0) {
    console.log(
      "⚠️  Some transfers failed. Please review the failed ALTs and retry if needed.\n"
    );
    process.exit(1);
  }
}

// Main execution
(async () => {
  try {
    await transferAllALTAuthorities();
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
})();
