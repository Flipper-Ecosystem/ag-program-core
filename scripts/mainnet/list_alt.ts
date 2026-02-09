import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { Keypair, PublicKey, Connection } from "@solana/web3.js";
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
  console.log("");

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

    return accounts.map((account) => account.pubkey);
  } catch (error) {
    console.error("❌ Error fetching Address Lookup Tables:", error);
    throw error;
  }
}

/**
 * Получает детальную информацию об Address Lookup Table
 */
async function getALTDetails(altAddress: PublicKey) {
  try {
    const lookupTableAccount = await connection.getAddressLookupTable(
      altAddress
    );

    if (!lookupTableAccount.value) {
      return null;
    }

    return {
      address: altAddress.toBase58(),
      authority:
        lookupTableAccount.value.state.authority?.toBase58() || "Frozen",
      deactivationSlot:
        lookupTableAccount.value.state.deactivationSlot.toString(),
      lastExtendedSlot:
        lookupTableAccount.value.state.lastExtendedSlot.toString(),
      lastExtendedSlotStartIndex:
        lookupTableAccount.value.state.lastExtendedSlotStartIndex,
      addressesCount: lookupTableAccount.value.state.addresses.length,
      addresses: lookupTableAccount.value.state.addresses.map((addr) =>
        addr.toBase58()
      ),
    };
  } catch (error: any) {
    return {
      address: altAddress.toBase58(),
      error: error.message,
    };
  }
}

async function listALTs() {
  console.log("🚀 Listing Address Lookup Tables on mainnet...\n");

  // Опционально: можно указать другой authority через env variable
  const targetAuthorityStr = process.env.TARGET_AUTHORITY;
  const targetAuthority = targetAuthorityStr
    ? new PublicKey(targetAuthorityStr)
    : wallet.publicKey;

  console.log("📍 Configuration:");
  console.log("   Searching for ALTs owned by:", targetAuthority.toBase58());
  console.log("");

  // Получаем все ALT, принадлежащие authority
  const altAddresses = await getAddressLookupTablesByAuthority(targetAuthority);

  if (altAddresses.length === 0) {
    console.log("ℹ️  No Address Lookup Tables found for this authority.\n");
    return;
  }

  console.log(`✅ Found ${altAddresses.length} Address Lookup Table(s)\n`);
  console.log("═══════════════════════════════════════════════════════════");

  // Получаем детальную информацию для каждой таблицы
  for (let i = 0; i < altAddresses.length; i++) {
    const altAddress = altAddresses[i];
    console.log(`\n📍 ALT #${i + 1}: ${altAddress.toBase58()}`);
    console.log("─────────────────────────────────────────────────────────");

    const details = await getALTDetails(altAddress);

    if (!details) {
      console.log("   ❌ Failed to fetch details");
      continue;
    }

    if ("error" in details) {
      console.log(`   ❌ Error: ${details.error}`);
      continue;
    }

    console.log(`   Authority: ${details.authority}`);
    console.log(`   Addresses count: ${details.addressesCount}`);
    console.log(
      `   Deactivation slot: ${
        details.deactivationSlot === "18446744073709551615"
          ? "Not deactivated"
          : details.deactivationSlot
      }`
    );
    console.log(`   Last extended slot: ${details.lastExtendedSlot}`);

    if (details.addressesCount > 0) {
      console.log(`\n   📋 Addresses in table (first 10):`);
      const displayAddresses = details.addresses.slice(0, 10);
      displayAddresses.forEach((addr, idx) => {
        console.log(`      ${idx + 1}. ${addr}`);
      });

      if (details.addressesCount > 10) {
        console.log(`      ... and ${details.addressesCount - 10} more`);
      }
    }
  }

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("\n📊 Summary:");
  console.log(`   Total ALTs: ${altAddresses.length}`);
  console.log(`   Authority: ${targetAuthority.toBase58()}`);
  console.log("");

  // Выводим список адресов в удобном формате для копирования
  if (altAddresses.length > 0) {
    console.log("📋 ALT addresses (comma-separated for easy copying):");
    console.log(altAddresses.map((alt) => alt.toBase58()).join(","));
    console.log("");
  }
}

// Main execution
(async () => {
  try {
    await listALTs();
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
})();
