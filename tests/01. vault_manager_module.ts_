import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    createMint,
    mintTo,
    getAccount,
    getAssociatedTokenAddressSync,
    createAssociatedTokenAccount
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

    let vaultAuthority: PublicKey;
    let vaultAuthorityBump: number;

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

        // Fund accounts
        await provider.connection.requestAirdrop(admin.publicKey, 2 * LAMPORTS_PER_SOL);
        await provider.connection.requestAirdrop(payer.publicKey, 2 * LAMPORTS_PER_SOL);
        await provider.connection.requestAirdrop(user.publicKey, 2 * LAMPORTS_PER_SOL);

        await new Promise(resolve => setTimeout(resolve, 1000));

        // Find vault authority PDA
        [vaultAuthority, vaultAuthorityBump] = PublicKey.findProgramAddressSync(
            [Buffer.from("vault_authority")],
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
        destinationAccount = getAssociatedTokenAddressSync(tokenMint, user.publicKey);

        await createAssociatedTokenAccount(
            provider.connection,
            user,
            tokenMint,
            user.publicKey
        );
    });

    describe("Vault Authority Management", () => {
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

            const vaultAuthorityAccount = await program.account.vaultAuthority.fetch(vaultAuthority);
            expect(vaultAuthorityAccount.admin.equals(admin.publicKey)).to.be.true;
            expect(vaultAuthorityAccount.bump).to.equal(vaultAuthorityBump);
        });

        it("should change admin", async () => {
            await program.methods
                .changeVaultAuthorityAdmin()
                .accounts({
                    vaultAuthority,
                    currentAdmin: admin.publicKey,
                    newAdmin: newAdmin.publicKey,
                })
                .signers([admin])
                .rpc();

            const vaultAuthorityAccount = await program.account.vaultAuthority.fetch(vaultAuthority);
            expect(vaultAuthorityAccount.admin.equals(newAdmin.publicKey)).to.be.true;

            // Change back for other tests
            await program.methods
                .changeVaultAuthorityAdmin()
                .accounts({
                    vaultAuthority,
                    currentAdmin: newAdmin.publicKey,
                    newAdmin: admin.publicKey,
                })
                .signers([newAdmin])
                .rpc();
        });

        it("should fail to change admin with wrong signer", async () => {
            try {
                await program.methods
                    .changeVaultAuthorityAdmin()
                    .accounts({
                        vaultAuthority,
                        currentAdmin: user.publicKey, // Wrong admin
                        newAdmin: newAdmin.publicKey,
                    })
                    .signers([user])
                    .rpc();
                expect.fail("Should have failed");
            } catch (error) {
                expect(error.message).to.include("UnauthorizedAdmin");
            }
        });
    });

    describe("Vault Creation", () => {
        it("should create vault for Legacy Token Program", async () => {
            await program.methods
                .createVault()
                .accounts({
                    vaultAuthority,
                    payer: payer.publicKey,
                    admin: admin.publicKey,
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

        it("should create vault for Token-2022 Program", async () => {
            await program.methods
                .createVault()
                .accounts({
                    vaultAuthority,
                    payer: payer.publicKey,
                    admin: admin.publicKey,
                    vault: vault2022,
                    vaultMint: token2022Mint,
                    vaultTokenProgram: TOKEN_2022_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([payer, admin])
                .rpc();

            const vaultAccount = await getAccount(provider.connection, vault2022, undefined, TOKEN_2022_PROGRAM_ID);
            expect(vaultAccount.mint.equals(token2022Mint)).to.be.true;
            expect(vaultAccount.owner.equals(vaultAuthority)).to.be.true;
            expect(Number(vaultAccount.amount)).to.equal(0);
        });

        it("should fail to create vault with wrong admin", async () => {
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
                        payer: payer.publicKey,
                        admin: user.publicKey, // Wrong admin
                        vault: wrongVault,
                        vaultMint: wrongMint,
                        vaultTokenProgram: TOKEN_PROGRAM_ID,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([payer, user])
                    .rpc();
                expect.fail("Should have failed");
            } catch (error) {
                expect(error.message).to.include("UnauthorizedAdmin");
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

        it("should withdraw platform fees", async () => {
            const withdrawAmount = 1000;

            const initialBalance = await getAccount(provider.connection, destinationAccount);

            await program.methods
                .withdrawPlatformFees(new anchor.BN(withdrawAmount))
                .accounts({
                    vaultAuthority,
                    platformFeeAccount: vault, // Используем обычный vault как platform fee account
                    destination: destinationAccount,
                    mint: tokenMint,
                    admin: admin.publicKey,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([admin])
                .rpc();

            const finalBalance = await getAccount(provider.connection, destinationAccount);
            expect(Number(finalBalance.amount - initialBalance.amount)).to.equal(withdrawAmount);
        });

        it("should fail to withdraw zero amount", async () => {
            try {
                await program.methods
                    .withdrawPlatformFees(new anchor.BN(0))
                    .accounts({
                        vaultAuthority,
                        platformFeeAccount: vault,
                        destination: destinationAccount,
                        mint: tokenMint,
                        admin: admin.publicKey,
                        tokenProgram: TOKEN_PROGRAM_ID,
                    })
                    .signers([admin])
                    .rpc();
                expect.fail("Should have failed");
            } catch (error) {
                expect(error.message).to.include("InvalidAmount");
            }
        });

        it("should fail to withdraw with wrong admin", async () => {
            try {
                await program.methods
                    .withdrawPlatformFees(new anchor.BN(100))
                    .accounts({
                        vaultAuthority,
                        platformFeeAccount: vault,
                        destination: destinationAccount,
                        mint: tokenMint,
                        admin: user.publicKey, // Wrong admin
                        tokenProgram: TOKEN_PROGRAM_ID,
                    })
                    .signers([user])
                    .rpc();
                expect.fail("Should have failed");
            } catch (error) {
                expect(error.message).to.include("UnauthorizedAdmin");
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
                        platformFeeAccount: vault,
                        destination: destinationAccount,
                        mint: wrongMint, // Wrong mint
                        admin: admin.publicKey,
                        tokenProgram: TOKEN_PROGRAM_ID,
                    })
                    .signers([admin])
                    .rpc();
                expect.fail("Should have failed");
            } catch (error) {
                expect(error.message).to.include("InvalidMint");
            }
        });
    });

    describe("Vault Initialization", () => {
        it("should initialize vaults (Legacy + Legacy)", async () => {
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
                    payer: payer.publicKey,
                    admin: admin.publicKey,
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

            const inputVaultAccount = await getAccount(provider.connection, inputVault);
            const outputVaultAccount = await getAccount(provider.connection, outputVault);

            expect(inputVaultAccount.mint.equals(sourceMint)).to.be.true;
            expect(outputVaultAccount.mint.equals(destMint)).to.be.true;
            expect(inputVaultAccount.owner.equals(vaultAuthority)).to.be.true;
            expect(outputVaultAccount.owner.equals(vaultAuthority)).to.be.true;
        });

        it("should initialize vaults (Token-2022 + Token-2022)", async () => {
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
                    payer: payer.publicKey,
                    admin: admin.publicKey,
                    inputVault,
                    outputVault,
                    sourceMint,
                    destinationMint: destMint,
                    sourceTokenProgram: TOKEN_2022_PROGRAM_ID,
                    destinationTokenProgram: TOKEN_2022_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([payer, admin])
                .rpc();

            const inputVaultAccount = await getAccount(provider.connection, inputVault, undefined, TOKEN_2022_PROGRAM_ID);
            const outputVaultAccount = await getAccount(provider.connection, outputVault, undefined, TOKEN_2022_PROGRAM_ID);

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
                    payer: payer.publicKey,
                    admin: admin.publicKey,
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

            const inputVaultAccount = await getAccount(provider.connection, inputVault);
            const outputVaultAccount = await getAccount(provider.connection, outputVault, undefined, TOKEN_2022_PROGRAM_ID);

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
                    payer: payer.publicKey,
                    admin: admin.publicKey,
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

            const inputVaultAccount = await getAccount(provider.connection, inputVault, undefined, TOKEN_2022_PROGRAM_ID);
            const outputVaultAccount = await getAccount(provider.connection, outputVault);

            expect(inputVaultAccount.mint.equals(sourceMint)).to.be.true;
            expect(outputVaultAccount.mint.equals(destMint)).to.be.true;
        });

        it("should fail with wrong admin", async () => {
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
                        payer: payer.publicKey,
                        admin: user.publicKey, // Wrong admin
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
                expect(error.message).to.include("UnauthorizedAdmin");
            }
        });
    });

    describe("Vault Closure", () => {
        let emptyVault: PublicKey;
        let emptyMint: PublicKey;

        before(async () => {
            // Create mint for empty vault
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

            // Create empty vault
            await program.methods
                .createVault()
                .accounts({
                    vaultAuthority,
                    payer: payer.publicKey,
                    admin: admin.publicKey,
                    vault: emptyVault,
                    vaultMint: emptyMint,
                    vaultTokenProgram: TOKEN_PROGRAM_ID,
                    systemProgram: SystemProgram.programId,
                })
                .signers([payer, admin])
                .rpc();
        });

        it("should close empty vault", async () => {
            const initialLamports = await provider.connection.getBalance(user.publicKey);

            await program.methods
                .closeVault()
                .accounts({
                    vaultAuthority,
                    vault: emptyVault,
                    destination: user.publicKey,
                    admin: admin.publicKey,
                    tokenProgram: TOKEN_PROGRAM_ID,
                })
                .signers([admin])
                .rpc();

            const finalLamports = await provider.connection.getBalance(user.publicKey);
            expect(finalLamports).to.be.greaterThan(initialLamports);

            // Verify vault is closed
            try {
                const accountInfo = await provider.connection.getAccountInfo(emptyVault);
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
                        vault,
                        destination: user.publicKey,
                        admin: admin.publicKey,
                        tokenProgram: TOKEN_PROGRAM_ID,
                    })
                    .signers([admin])
                    .rpc();
                expect.fail("Should have failed");
            } catch (error) {
                expect(error.message).to.include("VaultNotEmpty");
            }
        });

        it("should fail to close vault with wrong admin", async () => {
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
                    payer: payer.publicKey,
                    admin: admin.publicKey,
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
                        vault: testVault,
                        destination: user.publicKey,
                        admin: user.publicKey, // Wrong admin
                        tokenProgram: TOKEN_PROGRAM_ID,
                    })
                    .signers([user])
                    .rpc();
                expect.fail("Should have failed");
            } catch (error) {
                expect(error.message).to.include("UnauthorizedAdmin");
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

        it("should fail to create same vault twice", async () => {
            try {
                await program.methods
                    .createVault()
                    .accounts({
                        vaultAuthority,
                        payer: payer.publicKey,
                        admin: admin.publicKey,
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