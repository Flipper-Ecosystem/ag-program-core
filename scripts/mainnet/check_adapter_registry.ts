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

  const [adapterRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from("adapter_registry")],
    program.programId
  );

  console.log("Adapter Registry PDA:", adapterRegistry.toBase58());

  const info = await connection.getAccountInfo(adapterRegistry);
  if (info) {
    console.log("✅ Adapter Registry exists");
    console.log("   Owner:", info.owner.toBase58());
    console.log("   Data length:", info.data.length);
  } else {
    console.log("❌ Adapter Registry NOT found - needs to be initialized");
    console.log(
      "   Run: ts-node scripts/mainnet/initialize_adapter_registry.ts"
    );
  }
}

check().catch(console.error);
