import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import idl from "../../target/idl/flipper.json";

async function check() {
  const connection = new Connection("https://api.mainnet-beta.solana.com");
  const program = new anchor.Program(
    idl as anchor.Idl,
    {
      connection,
    } as any
  );

  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority")],
    program.programId
  );

  const [adapterRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from("adapter_registry")],
    program.programId
  );

  console.log("Vault Authority PDA:", vaultAuthority.toBase58());
  console.log("Adapter Registry PDA:", adapterRegistry.toBase58());
  console.log();

  try {
    const vaultAuthAccount = await (
      program.account as any
    ).vaultAuthority.fetch(vaultAuthority);
    console.log("✅ Vault Authority:");
    console.log("   Admin:", vaultAuthAccount.admin.toBase58());
  } catch (e) {
    console.log("❌ Vault Authority not found");
  }

  try {
    const adapterRegAccount = await (
      program.account as any
    ).adapterRegistry.fetch(adapterRegistry);
    console.log("\n✅ Adapter Registry:");
    console.log("   Operators:");
    adapterRegAccount.operators.forEach((op: any, idx: number) => {
      if (op.toString() !== "11111111111111111111111111111111") {
        console.log(`   [${idx}] ${op.toBase58()}`);
      }
    });
  } catch (e) {
    console.log("❌ Adapter Registry not found");
  }
}

check().catch(console.error);
