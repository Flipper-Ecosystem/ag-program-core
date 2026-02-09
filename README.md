[![CI](https://github.com/Flipper-Ecosystem/ag-program-core/actions/workflows/ci.yml/badge.svg)](https://github.com/Flipper-Ecosystem/ag-program-core/actions/workflows/ci.yml)

## Installation

### Prerequisites
Before setting up the project, ensure the following tools are installed:
- **Rust**: Required for Solana and Anchor development. Install with:
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  ```
- **Agave CLI**: A Solana client implementation providing tools like `solana-test-validator`. Install the latest stable version (e.g., v2.0.5):
  ```bash
  cargo install --git https://github.com/anza-xyz/agave --tag v2.0.5 --locked solana
  ```
    - **Note**: Agave is a community-driven Solana client maintained by Anza, offering the same functionality as the Solana CLI for this project.
    - After installation, verify the version:
      ```bash
      solana --version
      ```
      This should display the installed version (e.g., `solana-cli 2.0.5`).
- **Node.js**: Necessary for Anchor's JavaScript dependencies. Install via `nvm` or your package manager:
  ```bash
  sudo apt install nodejs  # On Ubuntu/Debian
  ```
- **Yarn**: Preferred package manager for Anchor projects. Install globally:
  ```bash
  npm install -g yarn
  ```

### Install Anchor Framework with AVM
The Anchor Version Manager (AVM) simplifies managing Anchor versions, ensuring compatibility with Solana programs. Follow these steps to install Anchor:

1. **Install AVM**:
   ```bash
   cargo install anchor-version-manager
   ```

2. **Install Anchor**:
   Use AVM to install the latest Anchor version (or specify a version, e.g., `0.30.0`):
   ```bash
   avm install latest
   ```

3. **Activate Anchor Version**:
   Set the installed version as the active one:
   ```bash
   avm use latest
   ```

4. **Verify Installation**:
   Check that Anchor is installed correctly:
   ```bash
   anchor --version
   ```
   This should display the Anchor version (e.g., `anchor-cli 0.30.0`).

### Set Up Solana Keys and Configuration
To interact with the Solana blockchain, you need to configure the Agave CLI, generate keypairs, and sync Anchor keys for development and deployment. Follow these steps:

1. **Verify Agave CLI Installation**:
   Confirm that the Agave CLI is installed and check the version:
   ```bash
   solana --version
   ```
   This should display the installed version (e.g., `solana-cli 2.0.5`).

2. **Configure Agave CLI for Local Development**:
   Set the Agave CLI to use the local cluster for testing:
   ```bash
   solana config set --url http://localhost:8899
   ```
   For deployment to devnet or mainnet, use:
   ```bash
   solana config set --url https://api.devnet.solana.com  # For devnet
   solana config set --url https://api.mainnet-beta.solana.com  # For mainnet
   ```

3. **Generate a Solana Keypair**:
   Create a new keypair for your Solana wallet, which will be used to sign transactions and deploy programs:
   ```bash
   solana-keygen new --outfile ~/.config/solana/id.json
   ```
    - This generates a keypair at `~/.config/solana/id.json`.
    - Save the mnemonic phrase securely, as it is required to recover the keypair.
    - To verify the keypair, check your public key:
      ```bash
      solana-keygen pubkey
      ```

4. **Fund the Keypair (Local or Devnet)**:
    - **For local testing**: Start a local validator and request an airdrop to fund your wallet:
      ```bash
      solana-test-validator &  # Run in background
      solana airdrop 10  # Request 10 SOL
      ```
    - **For devnet**: Request an airdrop (limited to 2 SOL per request):
      ```bash
      solana airdrop 2
      ```
    - Verify the balance:
      ```bash
      solana balance
      ```

5. **Sync Anchor Keys**:
   Anchor uses a keypair for program deployment. Sync the Solana keypair with Anchor to ensure consistency:
    - **Set the Anchor wallet**: Update the Anchor configuration to use the Solana keypair:
      ```bash
      anchor keys sync
      ```
      This command ensures the keypair in `~/.config/solana/id.json` is copied to the Anchor project directory (e.g., `target/deploy/<program-name>-keypair.json`).
    - **Verify the program keypair**: Check the generated keypair for your program:
      ```bash
      solana-keygen pubkey target/deploy/<program-name>-keypair.json
      ```
      Replace `<program-name>` with your Anchor program's name (defined in `Anchor.toml`).

6. **Optional: Import an Existing Keypair**:
   If you have an existing Solana keypair, import it to `~/.config/solana/id.json`:
   ```bash
   solana-keygen recover --outfile ~/.config/solana/id.json
   ```
   Enter the mnemonic phrase when prompted, then sync with Anchor:
   ```bash
   anchor keys sync
   ```

## Building the Project

To build the Solana prediction market program, follow these steps:

1. **Clone the Repository**:
   ```bash
   git clone <repository-url>
   cd <repository-folder>
   ```

2. **Install JavaScript Dependencies**:
   Anchor projects require Node.js dependencies for testing and deployment. Install them using Yarn:
   ```bash
   yarn install
   ```

3. **Build the Program**:
   Compile the Rust-based Solana program using Anchor:
   ```bash
   anchor build
   ```
    - This generates the program's IDL (Interface Definition Language) in `target/idl/`.
    - The compiled program binary is stored in `target/deploy/`.
    - Ensure the Agave CLI is configured to use the local cluster (`solana config set --url http://localhost:8899`) if testing locally.

## Deploying the Project

1. **Start local validator**:

  In separate window:
  ```bash
    solana-test-validator 
  ```

2. **Deploy the Program**:
  Deploy Rust-based Solana program using Anchor:
   ```bash
   anchor deploy
   ```
   
   **For upgrading an existing program on mainnet/devnet:**
   
   If you encounter "Error processing Instruction 2: custom program error: 0x1", it usually means:
   1. **Program size increased**: The new program is larger than the current allocation. Extend the program account first:
      ```bash
      # Check current program size
      solana program show fLpRcgQSJxKeeUogb6M7bWe1iyYQbahjGXGwr4HgHit --url mainnet-beta
      
      # Extend program account (add ~100KB buffer for safety)
      solana program extend fLpRcgQSJxKeeUogb6M7bWe1iyYQbahjGXGwr4HgHit 100000 --url mainnet-beta --keypair ~/.config/solana/fpp-staging.json
      ```
   
   2. **Then upgrade**:
      ```bash
      anchor upgrade target/deploy/flipper.so --program-id fLpRcgQSJxKeeUogb6M7bWe1iyYQbahjGXGwr4HgHit
      ```
   
   **Alternative**: Use the helper script:
   ```bash
   ./scripts/extend_and_upgrade.sh
   ```

## Updating IDL on Solscan

After deploying or upgrading your program, you may want to update the IDL (Interface Definition Language) on Solscan so that transactions and program interactions are displayed correctly.

**Method 1: Upload IDL On-Chain (Recommended)**

Solscan automatically detects IDLs that are stored on-chain. To upload/update your IDL:

1. **First time initialization** (if IDL was never uploaded):
   ```bash
   anchor idl init \
     --filepath target/idl/flipper.json \
     fLpRcgQSJxKeeUogb6M7bWe1iyYQbahjGXGwr4HgHit \
     --provider.cluster mainnet \
     --provider.wallet ~/.config/solana/fpp-staging.json
   ```

2. **Updating existing IDL**:
   ```bash
   anchor idl upgrade \
     --filepath target/idl/flipper.json \
     fLpRcgQSJxKeeUogb6M7bWe1iyYQbahjGXGwr4HgHit \
     --provider.cluster mainnet \
     --provider.wallet ~/.config/solana/fpp-staging.json
   ```

**Using the helper script**:
```bash
# For first time initialization
./scripts/update_idl.sh init

# For updating existing IDL
./scripts/update_idl.sh upgrade
```

**Method 2: Manual Upload on Solscan**

If the on-chain method doesn't work, you can manually upload the IDL:
1. Go to [Solscan](https://solscan.io) and create/login to your account
2. Navigate to your program page: `https://solscan.io/account/fLpRcgQSJxKeeUogb6M7bWe1iyYQbahjGXGwr4HgHit`
3. Look for an "Upload IDL" or "Verify Program" option in your profile
4. Upload the `target/idl/flipper.json` file

**Note**: Make sure to run `anchor build` first to generate the latest IDL file before uploading.

---

## Mainnet Scripts and Operator Management

The project includes comprehensive scripts for managing operators and Address Lookup Tables (ALT) on mainnet.

### Available Scripts

#### 1. Interactive ALT Manager
Use the interactive bash script for easy access to all ALT and operator management functions:
```bash
./scripts/mainnet/alt_manager.sh
```

This provides a user-friendly menu interface for:
- Viewing and managing Address Lookup Tables
- Adding, removing, and replacing operators
- Transferring ALT authority to new operators

#### 2. Command-line Scripts
For automation and CI/CD, use the TypeScript scripts directly:

**Address Lookup Tables:**
```bash
# List all ALT owned by current authority
npx ts-node scripts/mainnet/list_alt.ts

# Transfer all ALT to new authority
NEW_AUTHORITY_PUBKEY=<address> npx ts-node scripts/mainnet/transfer_alt_authority.ts

# Transfer specific ALT
NEW_AUTHORITY_PUBKEY=<address> ALT_ADDRESSES=<addr1,addr2> \
  npx ts-node scripts/mainnet/transfer_alt_authority_specific.ts
```

**Operator Management:**
```bash
# Add operator
OPERATOR_PUBKEY=<address> npx ts-node scripts/mainnet/add_operator.ts

# Remove operator
OPERATOR_PUBKEY=<address> npx ts-node scripts/mainnet/remove_operator.ts

# Replace operator
OLD_OPERATOR_PUBKEY=<old> NEW_OPERATOR_PUBKEY=<new> \
  npx ts-node scripts/mainnet/replace_operator.ts
```

### Documentation

For detailed documentation, examples, and troubleshooting:
- **Detailed Guide**: See [scripts/mainnet/README_OPERATORS.md](scripts/mainnet/README_OPERATORS.md)
- **Quick Reference**: See [scripts/mainnet/QUICK_REFERENCE.md](scripts/mainnet/QUICK_REFERENCE.md)

### Prerequisites for Mainnet Scripts

- Authority keypair file at: `~/.config/solana/fpp-staging.json`
- Sufficient SOL balance for transactions
- Node.js and npm/npx installed