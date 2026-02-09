import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import idl from "../../target/idl/flipper.json";

/**
 * Script to check Vault Authority and Global Manager status on Mainnet
 *
 * This script displays the current state of both critical accounts:
 * - Vault Authority (controls vault operations)
 * - Global Manager (can change Vault Authority admin)
 *
 * Usage:
 * ts-node scripts/mainnet/check_vault_and_global_manager.ts
 *
 * Optional environment variables:
 * - RPC_ENDPOINT: Custom RPC endpoint (default: mainnet-beta)
 */

const RPC_ENDPOINT =
  process.env.RPC_ENDPOINT || "https://api.mainnet-beta.solana.com";

async function check() {
  console.log("🔍 Checking Vault Authority and Global Manager on Mainnet...\n");
  console.log("📍 Configuration:");
  console.log("   RPC Endpoint:", RPC_ENDPOINT);

  const connection = new Connection(RPC_ENDPOINT);
  const program = new anchor.Program(
    idl as anchor.Idl,
    {
      connection,
    } as any
  );

  console.log("   Program ID:", program.programId.toBase58());
  console.log();

  // Derive PDAs
  const [vaultAuthority, vaultAuthorityBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority")],
    program.programId
  );

  const [globalManager, globalManagerBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_manager")],
    program.programId
  );

  const [adapterRegistry, adapterRegistryBump] =
    PublicKey.findProgramAddressSync(
      [Buffer.from("adapter_registry")],
      program.programId
    );

  console.log("📋 PDA Addresses:");
  console.log(
    "   Vault Authority:",
    vaultAuthority.toBase58(),
    `(bump: ${vaultAuthorityBump})`
  );
  console.log(
    "   Global Manager:",
    globalManager.toBase58(),
    `(bump: ${globalManagerBump})`
  );
  console.log(
    "   Adapter Registry:",
    adapterRegistry.toBase58(),
    `(bump: ${adapterRegistryBump})`
  );
  console.log();

  // Check Vault Authority
  console.log("━".repeat(80));
  console.log("📦 VAULT AUTHORITY");
  console.log("━".repeat(80));
  try {
    const vaultAuthAccount = await (
      program.account as any
    ).vaultAuthority.fetch(vaultAuthority);
    console.log("✅ Status: Initialized");
    console.log("   Admin:", vaultAuthAccount.admin.toBase58());
    console.log("   Bump:", vaultAuthAccount.bump);
    console.log();
    console.log("   ℹ️  The admin can:");
    console.log("      - Create vaults (if also an operator)");
    console.log("      - Close vaults (if also an operator)");
    console.log("      - Control vault operations");
    console.log();
    console.log("   ⚠️  The admin can be changed by:");
    console.log("      - Global Manager only");
  } catch (e) {
    console.log("❌ Status: Not Initialized");
    console.log("   The Vault Authority account does not exist yet.");
    console.log(
      "   💡 Create it using: ts-node scripts/mainnet/create_vault_authority.ts"
    );
  }
  console.log();

  // Check Global Manager
  console.log("━".repeat(80));
  console.log("🌍 GLOBAL MANAGER");
  console.log("━".repeat(80));
  try {
    const globalManagerAccount = await (
      program.account as any
    ).globalManager.fetch(globalManager);
    console.log("✅ Status: Initialized");
    console.log("   Manager:", globalManagerAccount.manager.toBase58());
    console.log("   Bump:", globalManagerAccount.bump);
    console.log();
    console.log("   ℹ️  The manager can:");
    console.log("      - Change Vault Authority Admin");
    console.log("      - Change Global Manager (transfer control)");
    console.log("      - Withdraw platform fees");
    console.log();
    console.log("   ⚠️  This is the highest authority in the system!");
  } catch (e) {
    console.log("❌ Status: Not Initialized");
    console.log("   The Global Manager account does not exist yet.");
    console.log(
      "   💡 Create it using: ts-node scripts/mainnet/create_global_manager.ts"
    );
  }
  console.log();

  // Check Adapter Registry
  console.log("━".repeat(80));
  console.log("🔧 ADAPTER REGISTRY");
  console.log("━".repeat(80));
  try {
    const adapterRegAccount = await (
      program.account as any
    ).adapterRegistry.fetch(adapterRegistry);
    console.log("✅ Status: Initialized");
    console.log("   Authority:", adapterRegAccount.authority.toBase58());
    console.log("   Bump:", adapterRegAccount.bump);
    console.log();
    console.log("   📋 Operators:");
    let operatorCount = 0;
    adapterRegAccount.operators.forEach((op: any, idx: number) => {
      // Skip default/empty pubkeys (all 1s)
      if (op.toString() !== "11111111111111111111111111111111") {
        operatorCount++;
        console.log(`      [${idx}] ${op.toBase58()}`);
      }
    });

    if (operatorCount === 0) {
      console.log("      (No operators registered)");
    }

    console.log();
    console.log("   ℹ️  Operators can:");
    console.log("      - Create vaults for any mint");
    console.log("      - Close empty vaults");
    console.log("      - Perform vault operations");
  } catch (e) {
    console.log("❌ Status: Not Initialized");
    console.log("   The Adapter Registry account does not exist yet.");
    console.log(
      "   💡 Initialize it using: ts-node scripts/mainnet/initialize_adapter_registry.ts"
    );
  }
  console.log();

  // Summary
  console.log("━".repeat(80));
  console.log("📊 SUMMARY");
  console.log("━".repeat(80));
  console.log("Key Operations:");
  console.log("   • Change Vault Authority Admin:");
  console.log(
    "     NEW_ADMIN_PUBKEY=<addr> ts-node scripts/mainnet/change_vault_authority_admin.ts"
  );
  console.log();
  console.log("   • Change Global Manager:");
  console.log(
    "     NEW_MANAGER_PUBKEY=<addr> ts-node scripts/mainnet/change_global_manager.ts"
  );
  console.log();
  console.log("   • Add Operator:");
  console.log(
    "     OPERATOR_PUBKEY=<addr> ts-node scripts/mainnet/add_operator.ts"
  );
  console.log();
  console.log("   • Remove Operator:");
  console.log(
    "     OPERATOR_PUBKEY=<addr> ts-node scripts/mainnet/remove_operator.ts"
  );
  console.log();
}

check()
  .then(() => {
    console.log("✅ Check completed successfully\n");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Check failed:", error);
    process.exit(1);
  });
