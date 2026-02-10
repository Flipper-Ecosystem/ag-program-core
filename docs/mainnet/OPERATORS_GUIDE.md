# Mainnet Operator Management Scripts

These scripts are designed for managing operators and Address Lookup Tables (ALT) on mainnet.

> **New here?** Start with [README.md](README.md) or [QUICK_REFERENCE.md](QUICK_REFERENCE.md)

## Prerequisites

- Ensure you have an authority keypair file at: `~/.config/solana/fpp-staging.json`
- Ensure all dependencies are installed: `npm install`
- Ensure you have sufficient SOL balance for transactions

## Available Scripts

### 1. add_operator.ts - Add a New Operator

Adds a new operator to the adapter registry.

**Usage:**

```bash
OPERATOR_PUBKEY=<operator_public_key> npx ts-node scripts/mainnet/add_operator.ts
```

**Example:**

```bash
OPERATOR_PUBKEY=8cJXGoV8FCwNqbcjstCiAxdW3miy2xsBvuXSn3s64GrG npx ts-node scripts/mainnet/add_operator.ts
```

**What the script does:**
- Checks the current state of the adapter registry
- Checks if the operator already exists
- Adds the operator to the registry
- Verifies successful addition

---

### 2. remove_operator.ts - Remove an Operator

Removes an operator from the adapter registry.

**Usage:**

```bash
OPERATOR_PUBKEY=<operator_public_key> npx ts-node scripts/mainnet/remove_operator.ts
```

**Example:**

```bash
OPERATOR_PUBKEY=8cJXGoV8FCwNqbcjstCiAxdW3miy2xsBvuXSn3s64GrG npx ts-node scripts/mainnet/remove_operator.ts
```

**What the script does:**
- Checks the current state of the adapter registry
- Checks if the operator exists
- Removes the operator from the registry
- Verifies successful removal

---

### 3. replace_operator.ts - Replace an Operator

Removes the old operator and adds a new one in a single operation.

**Usage:**

```bash
OLD_OPERATOR_PUBKEY=<old_public_key> NEW_OPERATOR_PUBKEY=<new_public_key> npx ts-node scripts/mainnet/replace_operator.ts
```

**Example:**

```bash
OLD_OPERATOR_PUBKEY=8cJXGoV8FCwNqbcjstCiAxdW3miy2xsBvuXSn3s64GrG \
NEW_OPERATOR_PUBKEY=9dKLmNpvXZfGkjRt3Hq7YzLpMnUwZxEaBcRfTyGhJkWs \
npx ts-node scripts/mainnet/replace_operator.ts
```

**What the script does:**
- Checks the current state of the adapter registry
- Removes the old operator (if it exists)
- Adds the new operator
- Verifies successful replacement

---

### 4. transfer_alt_authority.ts - Transfer All Address Lookup Table Rights

Finds all Address Lookup Tables (ALT) belonging to the current authority and transfers management rights to a new operator.

**Usage:**

```bash
NEW_AUTHORITY_PUBKEY=<new_authority_public_key> npx ts-node scripts/mainnet/transfer_alt_authority.ts
```

**Example:**

```bash
NEW_AUTHORITY_PUBKEY=9dKLmNpvXZfGkjRt3Hq7YzLpMnUwZxEaBcRfTyGhJkWs npx ts-node scripts/mainnet/transfer_alt_authority.ts
```

**What the script does:**
- Searches for all Address Lookup Tables belonging to the current authority
- For each table, checks the current state (whether it's frozen)
- Transfers management rights to the new authority
- Verifies successful transfer
- Displays a detailed summary of all operations

**Important notes:**
- The script skips frozen tables, as their authority cannot be changed
- Each table is transferred in a separate transaction
- The script automatically verifies all changes after completion
- If a transfer fails for any table, the script continues with the remaining ones

---

### 5. transfer_alt_authority_specific.ts - Transfer Specific Address Lookup Table Rights

Transfers management rights for a specified list of Address Lookup Tables to a new operator.

**Usage:**

```bash
NEW_AUTHORITY_PUBKEY=<new_authority_public_key> \
ALT_ADDRESSES=<addr1,addr2,addr3> \
npx ts-node scripts/mainnet/transfer_alt_authority_specific.ts
```

**Example:**

```bash
NEW_AUTHORITY_PUBKEY=9dKLmNpvXZfGkjRt3Hq7YzLpMnUwZxEaBcRfTyGhJkWs \
ALT_ADDRESSES=7YfYXkg4Tpb9jMVsrRjRLjrQ6r8BvCxTFfKqb7jMSvmE,8ZgYnWkg5Uqc0kNWtsStKmsSmjSLkmR7sLrbYcjNTwnF \
npx ts-node scripts/mainnet/transfer_alt_authority_specific.ts
```

**What the script does:**
- Accepts a list of specific ALT addresses via comma separation
- For each table, checks the current state and authority
- Transfers management rights to the new authority
- Verifies successful transfer
- Displays a detailed summary of all operations

**Important notes:**
- Use this script when you know the specific ALT addresses to transfer
- The script verifies that the current authority matches expectations
- Frozen tables are automatically skipped
- Addresses should be separated by commas without spaces (or with spaces after commas)

---

### 6. list_alt.ts - View Address Lookup Tables

Displays all Address Lookup Tables belonging to the current authority or a specified address.

**Usage (for current authority):**

```bash
npx ts-node scripts/mainnet/list_alt.ts
```

**Usage (for a specific authority):**

```bash
TARGET_AUTHORITY=<authority_public_key> npx ts-node scripts/mainnet/list_alt.ts
```

**Example:**

```bash
# Show ALTs for current authority
npx ts-node scripts/mainnet/list_alt.ts

# Show ALTs for a specific address
TARGET_AUTHORITY=9dKLmNpvXZfGkjRt3Hq7YzLpMnUwZxEaBcRfTyGhJkWs npx ts-node scripts/mainnet/list_alt.ts
```

**What the script does:**
- Finds all Address Lookup Tables belonging to the specified authority
- Shows detailed information for each table:
  - Table address
  - Current authority (or "Frozen" if frozen)
  - Number of addresses in the table
  - Deactivation information
  - List of addresses (first 10)
- Outputs all ALT addresses in a comma-separated format for easy copying

**Important notes:**
- Use this script before transferring rights to see which ALTs belong to the authority
- The script only reads data, does not make any changes
- Output data can be used for `transfer_alt_authority_specific.ts`

---

## Typical Workflows

### Scenario 1: Full rights transfer to a new operator

If you want to transfer all rights (adapter registry operators + all ALTs) to a new operator:

```bash
# Step 1: View current ALTs
npx ts-node scripts/mainnet/list_alt.ts

# Step 2: Replace operator in adapter registry
OLD_OPERATOR_PUBKEY=<old> NEW_OPERATOR_PUBKEY=<new> \
npx ts-node scripts/mainnet/replace_operator.ts

# Step 3: Transfer all ALTs to the new operator
NEW_AUTHORITY_PUBKEY=<new> \
npx ts-node scripts/mainnet/transfer_alt_authority.ts
```

### Scenario 2: Transfer only specific ALTs

If you only need to transfer certain Address Lookup Tables:

```bash
# Step 1: View all ALTs and select the ones you need
npx ts-node scripts/mainnet/list_alt.ts

# Step 2: Copy the needed ALT addresses from the output

# Step 3: Transfer selected ALTs
NEW_AUTHORITY_PUBKEY=<new> \
ALT_ADDRESSES=<addr1,addr2,addr3> \
npx ts-node scripts/mainnet/transfer_alt_authority_specific.ts
```

### Scenario 3: Check another operator's ALTs

If you need to check which ALTs belong to another operator:

```bash
TARGET_AUTHORITY=<operator_address> \
npx ts-node scripts/mainnet/list_alt.ts
```

## Checking Current Operators

You can check current operators using Solana Explorer or by running a script with any address - scripts display the current state before performing operations.

## Security

**IMPORTANT:**
- These scripts operate on mainnet
- Make sure you understand what you're doing
- Verify operator addresses before running
- Only the authority can add/remove operators
- Keep your keypair file secure

## Troubleshooting

### Error: "Keypair file not found"
- Ensure the file `~/.config/solana/fpp-staging.json` exists
- Check file access permissions

### Error: "Account does not exist"
- Ensure the adapter registry is initialized
- Run `initialize_adapter_registry.ts` if necessary

### Error: "InvalidAuthority"
- Ensure you're using the correct authority keypair
- Only the authority can manage operators

### Error: "Operator already exists" or "Operator not found"
- Check the current state of the registry
- Ensure you're using the correct operator address

### Error: "Address Lookup Table not found"
- Ensure the table exists on the network
- Check the table address is correct

### Message: "Table is frozen, cannot transfer authority"
- This is normal behavior for frozen tables
- Frozen tables cannot be modified, and their authority is set permanently
- The script automatically skips such tables
