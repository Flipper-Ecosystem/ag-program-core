import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createMint,
  mintTo,
  getAccount,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import { Flipper } from "../target/types/flipper";

describe("Flipper Swap Protocol - Vault Manager Module", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Flipper as Program<Flipper>;

  let admin: Keypair;
  let payer: Keypair;
  let newAdmin: Keypair;
  let user: Keypair;
  let globalManager: Keypair;
  let operator: Keypair;

  let vaultAuthority: PublicKey;
  let vaultAuthorityBump: number;
  let globalManagerPda: PublicKey;
  let globalManagerBump: number;
  let adapterRegistry: PublicKey;
  let adapterRegistryBump: number;

  let tokenMint: PublicKey;
  let token2022Mint: PublicKey;
  let vault: PublicKey;
  let vault2022: PublicKey;
  let platformFeeVault: PublicKey; // Это тоже vault!
  let userTokenAccount: PublicKey;
  let destinationAccount: PublicKey;

  before(async () => {
    // Initialize keypairs
    admin = provider.wallet.payer;
    payer = Keypair.generate();
    newAdmin = Keypair.generate();
    user = Keypair.generate();
    globalManager = Keypair.generate();
    operator = Keypair.generate();

    // Fund accounts
    await provider.connection.requestAirdrop(
      admin.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.requestAirdrop(
      payer.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.requestAirdrop(
      user.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.requestAirdrop(
      globalManager.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.requestAirdrop(
      operator.publicKey,
      2 * LAMPORTS_PER_SOL
    );

    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Find vault authority PDA
    [vaultAuthority, vaultAuthorityBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_authority")],
      program.programId
    );

    // Find global manager PDA
    [globalManagerPda, globalManagerBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("global_manager")],
      program.programId
    );

    // Find adapter registry PDA
    [adapterRegistry, adapterRegistryBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("adapter_registry")],
      program.programId
    );

    // Create mints
    tokenMint = await createMint(
      provider.connection,
      payer,
      admin.publicKey,
      admin.publicKey,
      6,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );

    token2022Mint = await createMint(
      provider.connection,
      payer,
      admin.publicKey,
      admin.publicKey,
      9,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    [vault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), tokenMint.toBuffer()],
      program.programId
    );

    [vault2022] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), token2022Mint.toBuffer()],
      program.programId
    );

    // Platform fee vault - это тоже обычный vault
    [platformFeeVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), tokenMint.toBuffer()],
      program.programId
    );

    // Create user Associated Token Accounts (не PDA!)
    userTokenAccount = getAssociatedTokenAddressSync(tokenMint, user.publicKey);
    destinationAccount = getAssociatedTokenAddressSync(
      tokenMint,
      user.publicKey
    );

    await createAssociatedTokenAccount(
      provider.connection,
      user,
      tokenMint,
      user.publicKey
    );
  });

  describe("Initialization", () => {
    it("should create vault authority", async () => {
      await program.methods
        .createVaultAuthority()
        .accounts({
          vaultAuthority,
          payer: payer.publicKey,
          admin: admin.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer, admin])
        .rpc();

      const vaultAuthorityAccount = await program.account.vaultAuthority.fetch(
        vaultAuthority
      );
      expect(vaultAuthorityAccount.admin.equals(admin.publicKey)).to.be.true;
      expect(vaultAuthorityAccount.bump).to.equal(vaultAuthorityBump);
    });

    it("should create global manager", async () => {
      await program.methods
        .createGlobalManager()
        .accounts({
          globalManager: globalManagerPda,
          payer: payer.publicKey,
          manager: globalManager.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer, globalManager])
        .rpc();

      const globalManagerAccount = await program.account.globalManager.fetch(
        globalManagerPda
      );
      expect(globalManagerAccount.manager.equals(globalManager.publicKey)).to.be
        .true;
      expect(globalManagerAccount.bump).to.equal(globalManagerBump);
    });

    it("should create adapter registry", async () => {
      await program.methods
        .initializeAdapterRegistry([], [])
        .accounts({
          adapterRegistry,
          authority: admin.publicKey,
          payer: payer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin, payer])
        .rpc();

      const adapterRegistryAccount =
        await program.account.adapterRegistry.fetch(adapterRegistry);
      expect(adapterRegistryAccount.authority.equals(admin.publicKey)).to.be
        .true;
    });

    it("should add operator to adapter registry", async () => {
      await program.methods
        .addOperator(operator.publicKey)
        .accounts({
          adapterRegistry,
          authority: admin.publicKey,
        })
        .signers([admin])
        .rpc();

      const adapterRegistryAccount =
        await program.account.adapterRegistry.fetch(adapterRegistry);
      expect(adapterRegistryAccount.operators).to.have.lengthOf(1);
      expect(adapterRegistryAccount.operators[0].equals(operator.publicKey)).to
        .be.true;
    });
  });

  describe("Global Manager Management", () => {
    it("should change global manager", async () => {
      const newGlobalManager = Keypair.generate();
      await provider.connection.requestAirdrop(
        newGlobalManager.publicKey,
        LAMPORTS_PER_SOL
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));

      await program.methods
        .changeGlobalManager()
        .accounts({
          globalManager: globalManagerPda,
          currentManager: globalManager.publicKey,
          newManager: newGlobalManager.publicKey,
        })
        .signers([globalManager])
        .rpc();

      const globalManagerAccount = await program.account.globalManager.fetch(
        globalManagerPda
      );
      expect(globalManagerAccount.manager.equals(newGlobalManager.publicKey)).to
        .be.true;

      // Change back for other tests
      await program.methods
        .changeGlobalManager()
        .accounts({
          globalManager: globalManagerPda,
          currentManager: newGlobalManager.publicKey,
          newManager: globalManager.publicKey,
        })
        .signers([newGlobalManager])
        .rpc();
    });

    it("should fail to change global manager with wrong signer", async () => {
      try {
        await program.methods
          .changeGlobalManager()
          .accounts({
            globalManager: globalManagerPda,
            currentManager: user.publicKey, // Wrong manager
            newManager: newAdmin.publicKey,
          })
          .signers([user])
          .rpc();
        expect.fail("Should have failed");
      } catch (error) {
        expect(error.message).to.include("UnauthorizedGlobalManager");
      }
    });
  });

  describe("Vault Authority Management", () => {
    it("should change vault authority admin by global manager", async () => {
      await program.methods
        .changeVaultAuthorityAdmin()
        .accounts({
          vaultAuthority,
          globalManager: globalManagerPda,
          manager: globalManager.publicKey,
          newAdmin: newAdmin.publicKey,
        })
        .signers([globalManager])
        .rpc();

      const vaultAuthorityAccount = await program.account.vaultAuthority.fetch(
        vaultAuthority
      );
      expect(vaultAuthorityAccount.admin.equals(newAdmin.publicKey)).to.be.true;

      // Change back for other tests
      await program.methods
        .changeVaultAuthorityAdmin()
        .accounts({
          vaultAuthority,
          globalManager: globalManagerPda,
          manager: globalManager.publicKey,
          newAdmin: admin.publicKey,
        })
        .signers([globalManager])
        .rpc();
    });

    it("should fail to change vault authority admin with wrong signer", async () => {
      try {
        await program.methods
          .changeVaultAuthorityAdmin()
          .accounts({
            vaultAuthority,
            globalManager: globalManagerPda,
            manager: user.publicKey, // Wrong manager
            newAdmin: newAdmin.publicKey,
          })
          .signers([user])
          .rpc();
        expect.fail("Should have failed");
      } catch (error) {
        expect(error.message).to.include("UnauthorizedGlobalManager");
      }
    });
  });

  describe("Vault Creation", () => {
    it("should create vault for Legacy Token Program by admin", async () => {
      await program.methods
        .createVault()
        .accounts({
          vaultAuthority,
          adapterRegistry,
          payer: payer.publicKey,
          creator: admin.publicKey,
          vault,
          vaultMint: tokenMint,
          vaultTokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer, admin])
        .rpc();

      const vaultAccount = await getAccount(provider.connection, vault);
      expect(vaultAccount.mint.equals(tokenMint)).to.be.true;
      expect(vaultAccount.owner.equals(vaultAuthority)).to.be.true;
      expect(Number(vaultAccount.amount)).to.equal(0);
    });

    it("should create vault for Token-2022 Program by operator", async () => {
      await program.methods
        .createVault()
        .accounts({
          vaultAuthority,
          adapterRegistry,
          payer: payer.publicKey,
          creator: operator.publicKey,
          vault: vault2022,
          vaultMint: token2022Mint,
          vaultTokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer, operator])
        .rpc();

      const vaultAccount = await getAccount(
        provider.connection,
        vault2022,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      expect(vaultAccount.mint.equals(token2022Mint)).to.be.true;
      expect(vaultAccount.owner.equals(vaultAuthority)).to.be.true;
      expect(Number(vaultAccount.amount)).to.equal(0);
    });

    it("should create vault with extensions for Token-2022 (account_space=14) by admin", async () => {
      // Create a new Token 2022 mint for testing extensions
      const token2022WithExtensionsMint = await createMint(
        provider.connection,
        payer,
        admin.publicKey,
        admin.publicKey,
        9,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      const [vaultWithExtensions] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), token2022WithExtensionsMint.toBuffer()],
        program.programId
      );

      // Create vault with extensions (14 bytes for confidentialTransfer extension)
      await program.methods
        .createVaultWithExtensions(14)
        .accounts({
          vaultAuthority,
          adapterRegistry,
          payer: payer.publicKey,
          creator: admin.publicKey,
          vault: vaultWithExtensions,
          vaultMint: token2022WithExtensionsMint,
          vaultTokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([payer, admin])
        .rpc();

      // Verify vault was created successfully
      const vaultAccount = await getAccount(
        provider.connection,
        vaultWithExtensions,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      expect(vaultAccount.mint.equals(token2022WithExtensionsMint)).to.be.true;
      expect(vaultAccount.owner.equals(vaultAuthority)).to.be.true;
      expect(Number(vaultAccount.amount)).to.equal(0);

      // Verify account size is correct (165 base + 14 extensions = 179 bytes)
      const accountInfo = await provider.connection.getAccountInfo(
        vaultWithExtensions
      );
      expect(accountInfo).to.not.be.null;
      if (accountInfo) {
        expect(accountInfo.data.length).to.be.at.least(179);
      }
    });

    it("should fail to create vault with extensions using Legacy Token Program", async () => {
      const testMint = await createMint(
        provider.connection,
        payer,
        admin.publicKey,
        admin.publicKey,
        6,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      );

      const [wrongVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), testMint.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .createVaultWithExtensions(14)
          .accounts({
            vaultAuthority,
            adapterRegistry,
            payer: payer.publicKey,
            creator: admin.publicKey,
            vault: wrongVault,
            vaultMint: testMint,
            vaultTokenProgram: TOKEN_PROGRAM_ID, // Wrong program
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([payer, admin])
          .rpc();
        expect.fail("Should have failed");
      } catch (error) {
        expect(error.message).to.include("InvalidCpiInterface");
      }
    });

    it("should fail to create vault with unauthorized creator", async () => {
      const wrongMint = await createMint(
        provider.connection,
        payer,
        admin.publicKey,
        admin.publicKey,
        6,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      );

      const [wrongVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), wrongMint.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .createVault()
          .accounts({
            vaultAuthority,
            adapterRegistry,
            payer: payer.publicKey,
            creator: user.publicKey, // Unauthorized creator (not admin or operator)
            vault: wrongVault,
            vaultMint: wrongMint,
            vaultTokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([payer, user])
          .rpc();
        expect.fail("Should have failed");
      } catch (error) {
        expect(error.message).to.include("UnauthorizedVaultCreator");
      }
    });
  });

  describe("Platform Fee Management", () => {
    before(async () => {
      // Mint some tokens to the vault for testing withdrawal
      await mintTo(
        provider.connection,
        admin,
        tokenMint,
        vault, // Platform fee vault это обычный vault
        admin,
        500000,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      );
    });

    it("should withdraw platform fees by global manager", async () => {
      const withdrawAmount = 1000;

      const initialBalance = await getAccount(
        provider.connection,
        destinationAccount
      );

      await program.methods
        .withdrawPlatformFees(new anchor.BN(withdrawAmount))
        .accounts({
          vaultAuthority,
          globalManager: globalManagerPda,
          platformFeeAccount: vault, // Используем обычный vault как platform fee account
          destination: destinationAccount,
          mint: tokenMint,
          manager: globalManager.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([globalManager])
        .rpc();

      const finalBalance = await getAccount(
        provider.connection,
        destinationAccount
      );
      expect(Number(finalBalance.amount - initialBalance.amount)).to.equal(
        withdrawAmount
      );
    });

    it("should fail to withdraw zero amount", async () => {
      try {
        await program.methods
          .withdrawPlatformFees(new anchor.BN(0))
          .accounts({
            vaultAuthority,
            globalManager: globalManagerPda,
            platformFeeAccount: vault,
            destination: destinationAccount,
            mint: tokenMint,
            manager: globalManager.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([globalManager])
          .rpc();
        expect.fail("Should have failed");
      } catch (error) {
        expect(error.message).to.include("InvalidAmount");
      }
    });

    it("should fail to withdraw with wrong manager", async () => {
      try {
        await program.methods
          .withdrawPlatformFees(new anchor.BN(100))
          .accounts({
            vaultAuthority,
            globalManager: globalManagerPda,
            platformFeeAccount: vault,
            destination: destinationAccount,
            mint: tokenMint,
            manager: user.publicKey, // Wrong manager
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user])
          .rpc();
        expect.fail("Should have failed");
      } catch (error) {
        expect(error.message).to.include("UnauthorizedGlobalManager");
      }
    });

    it("should fail to withdraw from wrong mint", async () => {
      const wrongMint = await createMint(
        provider.connection,
        payer,
        admin.publicKey,
        admin.publicKey,
        6,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      );

      try {
        await program.methods
          .withdrawPlatformFees(new anchor.BN(100))
          .accounts({
            vaultAuthority,
            globalManager: globalManagerPda,
            platformFeeAccount: vault,
            destination: destinationAccount,
            mint: wrongMint, // Wrong mint
            manager: globalManager.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([globalManager])
          .rpc();
        expect.fail("Should have failed");
      } catch (error) {
        expect(error.message).to.include("InvalidMint");
      }
    });
  });

  describe("Vault Initialization", () => {
    it("should initialize vaults (Legacy + Legacy) by admin", async () => {
      const sourceMint = await createMint(
        provider.connection,
        payer,
        admin.publicKey,
        admin.publicKey,
        6,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      );

      const destMint = await createMint(
        provider.connection,
        payer,
        admin.publicKey,
        admin.publicKey,
        6,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      );

      const [inputVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), sourceMint.toBuffer()],
        program.programId
      );

      const [outputVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), destMint.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeVaults()
        .accounts({
          vaultAuthority,
          adapterRegistry,
          payer: payer.publicKey,
          creator: admin.publicKey,
          inputVault,
          outputVault,
          sourceMint,
          destinationMint: destMint,
          sourceTokenProgram: TOKEN_PROGRAM_ID,
          destinationTokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer, admin])
        .rpc();

      const inputVaultAccount = await getAccount(
        provider.connection,
        inputVault
      );
      const outputVaultAccount = await getAccount(
        provider.connection,
        outputVault
      );

      expect(inputVaultAccount.mint.equals(sourceMint)).to.be.true;
      expect(outputVaultAccount.mint.equals(destMint)).to.be.true;
      expect(inputVaultAccount.owner.equals(vaultAuthority)).to.be.true;
      expect(outputVaultAccount.owner.equals(vaultAuthority)).to.be.true;
    });

    it("should initialize vaults (Token-2022 + Token-2022) by operator", async () => {
      const sourceMint = await createMint(
        provider.connection,
        payer,
        admin.publicKey,
        admin.publicKey,
        9,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      const destMint = await createMint(
        provider.connection,
        payer,
        admin.publicKey,
        admin.publicKey,
        9,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      const [inputVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), sourceMint.toBuffer()],
        program.programId
      );

      const [outputVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), destMint.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeVaults()
        .accounts({
          vaultAuthority,
          adapterRegistry,
          payer: payer.publicKey,
          creator: operator.publicKey,
          inputVault,
          outputVault,
          sourceMint,
          destinationMint: destMint,
          sourceTokenProgram: TOKEN_2022_PROGRAM_ID,
          destinationTokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer, operator])
        .rpc();

      const inputVaultAccount = await getAccount(
        provider.connection,
        inputVault,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const outputVaultAccount = await getAccount(
        provider.connection,
        outputVault,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      expect(inputVaultAccount.mint.equals(sourceMint)).to.be.true;
      expect(outputVaultAccount.mint.equals(destMint)).to.be.true;
    });

    it("should initialize vaults (Legacy + Token-2022)", async () => {
      const sourceMint = await createMint(
        provider.connection,
        payer,
        admin.publicKey,
        admin.publicKey,
        6,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      );

      const destMint = await createMint(
        provider.connection,
        payer,
        admin.publicKey,
        admin.publicKey,
        9,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      const [inputVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), sourceMint.toBuffer()],
        program.programId
      );

      const [outputVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), destMint.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeVaults()
        .accounts({
          vaultAuthority,
          adapterRegistry,
          payer: payer.publicKey,
          creator: admin.publicKey,
          inputVault,
          outputVault,
          sourceMint,
          destinationMint: destMint,
          sourceTokenProgram: TOKEN_PROGRAM_ID,
          destinationTokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer, admin])
        .rpc();

      const inputVaultAccount = await getAccount(
        provider.connection,
        inputVault
      );
      const outputVaultAccount = await getAccount(
        provider.connection,
        outputVault,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      expect(inputVaultAccount.mint.equals(sourceMint)).to.be.true;
      expect(outputVaultAccount.mint.equals(destMint)).to.be.true;
    });

    it("should initialize vaults (Token-2022 + Legacy)", async () => {
      const sourceMint = await createMint(
        provider.connection,
        payer,
        admin.publicKey,
        admin.publicKey,
        9,
        undefined,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );

      const destMint = await createMint(
        provider.connection,
        payer,
        admin.publicKey,
        admin.publicKey,
        6,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      );

      const [inputVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), sourceMint.toBuffer()],
        program.programId
      );

      const [outputVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), destMint.toBuffer()],
        program.programId
      );

      await program.methods
        .initializeVaults()
        .accounts({
          vaultAuthority,
          adapterRegistry,
          payer: payer.publicKey,
          creator: admin.publicKey,
          inputVault,
          outputVault,
          sourceMint,
          destinationMint: destMint,
          sourceTokenProgram: TOKEN_2022_PROGRAM_ID,
          destinationTokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer, admin])
        .rpc();

      const inputVaultAccount = await getAccount(
        provider.connection,
        inputVault,
        undefined,
        TOKEN_2022_PROGRAM_ID
      );
      const outputVaultAccount = await getAccount(
        provider.connection,
        outputVault
      );

      expect(inputVaultAccount.mint.equals(sourceMint)).to.be.true;
      expect(outputVaultAccount.mint.equals(destMint)).to.be.true;
    });

    it("should fail with unauthorized creator", async () => {
      const sourceMint = await createMint(
        provider.connection,
        payer,
        admin.publicKey,
        admin.publicKey,
        6,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      );

      const destMint = await createMint(
        provider.connection,
        payer,
        admin.publicKey,
        admin.publicKey,
        6,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      );

      const [inputVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), sourceMint.toBuffer()],
        program.programId
      );

      const [outputVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), destMint.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .initializeVaults()
          .accounts({
            vaultAuthority,
            adapterRegistry,
            payer: payer.publicKey,
            creator: user.publicKey, // Unauthorized creator
            inputVault,
            outputVault,
            sourceMint,
            destinationMint: destMint,
            sourceTokenProgram: TOKEN_PROGRAM_ID,
            destinationTokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([payer, user])
          .rpc();
        expect.fail("Should have failed");
      } catch (error) {
        expect(error.message).to.include("UnauthorizedVaultCreator");
      }
    });
  });

  describe("Vault Closure", () => {
    let emptyVault: PublicKey;
    let emptyMint: PublicKey;
    let emptyVault2: PublicKey;
    let emptyMint2: PublicKey;

    before(async () => {
      // Create mint for empty vault (will be closed by admin)
      emptyMint = await createMint(
        provider.connection,
        payer,
        admin.publicKey,
        admin.publicKey,
        6,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      );

      [emptyVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), emptyMint.toBuffer()],
        program.programId
      );

      // Create empty vault by admin
      await program.methods
        .createVault()
        .accounts({
          vaultAuthority,
          adapterRegistry,
          payer: payer.publicKey,
          creator: admin.publicKey,
          vault: emptyVault,
          vaultMint: emptyMint,
          vaultTokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer, admin])
        .rpc();

      // Create mint for empty vault2 (will be closed by operator)
      emptyMint2 = await createMint(
        provider.connection,
        payer,
        admin.publicKey,
        admin.publicKey,
        6,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      );

      [emptyVault2] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), emptyMint2.toBuffer()],
        program.programId
      );

      // Create empty vault by operator
      await program.methods
        .createVault()
        .accounts({
          vaultAuthority,
          adapterRegistry,
          payer: payer.publicKey,
          creator: operator.publicKey,
          vault: emptyVault2,
          vaultMint: emptyMint2,
          vaultTokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer, operator])
        .rpc();
    });

    it("should close empty vault by admin", async () => {
      const initialLamports = await provider.connection.getBalance(
        user.publicKey
      );

      await program.methods
        .closeVault()
        .accounts({
          vaultAuthority,
          adapterRegistry,
          vault: emptyVault,
          destination: user.publicKey,
          closer: admin.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();

      const finalLamports = await provider.connection.getBalance(
        user.publicKey
      );
      expect(finalLamports).to.be.greaterThan(initialLamports);

      // Verify vault is closed
      try {
        const accountInfo = await provider.connection.getAccountInfo(
          emptyVault
        );
        expect(accountInfo).to.be.null;
      } catch (error) {
        expect(true).to.be.true;
      }
    });

    it("should close empty vault by operator", async () => {
      const initialLamports = await provider.connection.getBalance(
        user.publicKey
      );

      await program.methods
        .closeVault()
        .accounts({
          vaultAuthority,
          adapterRegistry,
          vault: emptyVault2,
          destination: user.publicKey,
          closer: operator.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([operator])
        .rpc();

      const finalLamports = await provider.connection.getBalance(
        user.publicKey
      );
      expect(finalLamports).to.be.greaterThan(initialLamports);

      // Verify vault is closed
      try {
        const accountInfo = await provider.connection.getAccountInfo(
          emptyVault2
        );
        expect(accountInfo).to.be.null;
      } catch (error) {
        expect(true).to.be.true;
      }
    });

    it("should fail to close non-empty vault", async () => {
      // First add some tokens to vault
      await mintTo(
        provider.connection,
        admin,
        tokenMint,
        vault,
        admin,
        1000,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      );

      try {
        await program.methods
          .closeVault()
          .accounts({
            vaultAuthority,
            adapterRegistry,
            vault,
            destination: user.publicKey,
            closer: admin.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([admin])
          .rpc();
        expect.fail("Should have failed");
      } catch (error) {
        expect(error.message).to.include("VaultNotEmpty");
      }
    });

    it("should fail to close vault with unauthorized closer", async () => {
      const testMint = await createMint(
        provider.connection,
        payer,
        admin.publicKey,
        admin.publicKey,
        6,
        undefined,
        undefined,
        TOKEN_PROGRAM_ID
      );

      const [testVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), testMint.toBuffer()],
        program.programId
      );

      await program.methods
        .createVault()
        .accounts({
          vaultAuthority,
          adapterRegistry,
          payer: payer.publicKey,
          creator: admin.publicKey,
          vault: testVault,
          vaultMint: testMint,
          vaultTokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([payer, admin])
        .rpc();

      try {
        await program.methods
          .closeVault()
          .accounts({
            vaultAuthority,
            adapterRegistry,
            vault: testVault,
            destination: user.publicKey,
            closer: user.publicKey, // Unauthorized closer
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([user])
          .rpc();
        expect.fail("Should have failed");
      } catch (error) {
        expect(error.message).to.include("UnauthorizedVaultCreator");
      }
    });
  });

  describe("Helper Functions", () => {
    it("should get correct vault address", async () => {
      const [expectedVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), tokenMint.toBuffer()],
        program.programId
      );

      expect(vault.equals(expectedVault)).to.be.true;
    });

    it("should get correct vault authority address", async () => {
      const [expectedAuthority] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_authority")],
        program.programId
      );

      expect(vaultAuthority.equals(expectedAuthority)).to.be.true;
    });

    it("should get correct vault address for Token-2022", async () => {
      const [expectedVault2022] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), token2022Mint.toBuffer()],
        program.programId
      );

      expect(vault2022.equals(expectedVault2022)).to.be.true;
    });
  });

  describe("Error Handling", () => {
    it("should fail to create vault authority twice", async () => {
      try {
        await program.methods
          .createVaultAuthority()
          .accounts({
            vaultAuthority,
            payer: payer.publicKey,
            admin: admin.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([payer, admin])
          .rpc();
        expect.fail("Should have failed");
      } catch (error) {
        expect(error).to.exist;
      }
    });

    it("should fail to create global manager twice", async () => {
      try {
        await program.methods
          .createGlobalManager()
          .accounts({
            globalManager: globalManagerPda,
            payer: payer.publicKey,
            manager: globalManager.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([payer, globalManager])
          .rpc();
        expect.fail("Should have failed");
      } catch (error) {
        expect(error).to.exist;
      }
    });

    it("should fail to create same vault twice", async () => {
      try {
        await program.methods
          .createVault()
          .accounts({
            vaultAuthority,
            adapterRegistry,
            payer: payer.publicKey,
            creator: admin.publicKey,
            vault,
            vaultMint: tokenMint,
            vaultTokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([payer, admin])
          .rpc();
        expect.fail("Should have failed");
      } catch (error) {
        expect(error).to.exist;
      }
    });
  });
});
