# Change Vault Authority and Add Operator Script

This script performs two operations in sequence:
1. Changes the vault authority admin to a new address
2. Adds that new address as an operator to the adapter registry

## Prerequisites

- Solana CLI configured with your keypair at `~/.config/solana/id.json`
- Current admin authority (your wallet must be the current admin)
- Sufficient SOL in your wallet for transaction fees
- Environment variables configured in `.env` file

## Configuration

### Environment Variables

Add the following to your `.env` file:

```bash
NEW_VAULT_AUTHORITY_ADDRESS=8cJXGoV8FCwNqbcjstCiAxdW3miy2xsBvuXSn3s64GrG
```

Replace the address with your desired new vault authority address.

## Usage

### Option 1: Using npm script (recommended)

```bash
npm run devnet:change-authority
```

### Option 2: Direct execution

```bash
ts-node scripts/devnet/change_vault_authority_and_add_operator.ts
```

## What the Script Does

### Step 1: Change Vault Authority
- Derives the vault authority PDA
- Calls `changeVaultAuthorityAdmin` instruction
- Transfers admin rights from your wallet to the new address

### Step 2: Add Operator
- Derives the adapter registry PDA
- Calls `addOperator` instruction
- Adds the new address as an authorized operator

## Output

The script will show:
- Current admin address
- New vault authority address
- Vault authority PDA
- Adapter registry PDA
- Transaction signatures for both operations
- Success/failure status

## Example Output

```
============================================================
🚀 Starting vault authority change and operator addition
============================================================

🔐 Changing vault authority on devnet...

New vault authority address: 8cJXGoV8FCwNqbcjstCiAxdW3miy2xsBvuXSn3s64GrG
Current admin: YourWalletAddress...

Vault authority PDA: VaultAuthorityPDA...

✅ Vault authority changed successfully!
Transaction signature: 5x...

------------------------------------------------------------

👤 Adding operator on devnet...

Adapter registry PDA: AdapterRegistryPDA...
Adding operator: 8cJXGoV8FCwNqbcjstCiAxdW3miy2xsBvuXSn3s64GrG

✅ Operator added successfully!
Transaction signature: 3y...

============================================================
🎉 All operations completed successfully!
============================================================
```

## Troubleshooting

### "NEW_VAULT_AUTHORITY_ADDRESS environment variable is not set"
- Make sure you have a `.env` file in the project root
- Check that the variable is correctly set in the `.env` file

### "Access Denied" or "Unauthorized"
- Ensure your wallet (`id.json`) is the current admin of the vault authority
- Check that you have sufficient SOL for transaction fees

### Transaction Fails
- Verify the network is accessible (devnet)
- Check that the program is deployed on devnet
- Ensure the new address is a valid Solana public key

## Security Notes

⚠️ **Important**: This operation transfers admin rights. Make sure you:
- Trust the new authority address
- Have verified the address is correct (no typos)
- Understand this is a sensitive operation
- Keep a backup of the old authority if needed

## Related Scripts

- `add_operator.ts` - Only adds an operator
- `change_vault_authority_admun.ts` - Only changes vault authority
- This script combines both operations for convenience
