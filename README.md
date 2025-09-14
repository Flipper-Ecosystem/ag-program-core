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

