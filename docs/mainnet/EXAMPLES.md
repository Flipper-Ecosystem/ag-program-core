# ALT and Operator Management Scripts - Usage Examples

This file contains practical examples for typical usage scenarios.

---

## Scenario 1: Full Rights Transfer to a New Operator

### Situation
You want to completely transfer management to another operator, including:
- Operator rights in the adapter registry
- All Address Lookup Tables

### Steps

**Step 1: Check the current situation**
```bash
# View all ALTs owned by you
npx ts-node scripts/mainnet/list_alt.ts
```

Output will show something like:
```
Searching for Address Lookup Tables owned by: YourCurrentAuthority...

Found 3 Address Lookup Table(s)

ALT #1: 7YfYXkg4Tpb9jMVsrRjRLjrQ6r8BvCxTFfKqb7jMSvmE
   Authority: YourCurrentAuthority
   Addresses count: 42
   ...
```

**Step 2: Replace the operator in the registry**
```bash
OLD_OPERATOR_PUBKEY=YourCurrentOperator \
NEW_OPERATOR_PUBKEY=NewOperatorPublicKey \
npx ts-node scripts/mainnet/replace_operator.ts
```

Expected result:
```
Old operator removed successfully!
New operator added successfully!
Operator replacement completed successfully!
```

**Step 3: Transfer all ALTs to the new authority**
```bash
NEW_AUTHORITY_PUBKEY=NewOperatorPublicKey \
npx ts-node scripts/mainnet/transfer_alt_authority.ts
```

Expected result:
```
Transfer Summary:
   Total ALTs processed: 3
   Successfully transferred: 3
   Skipped (frozen): 0
   Failed: 0

All Address Lookup Table authorities transferred successfully!
```

---

## Scenario 2: Transfer Only Specific ALTs

### Situation
You have multiple ALTs but want to transfer only some of them.

### Steps

**Step 1: Get the list of all ALTs**
```bash
npx ts-node scripts/mainnet/list_alt.ts
```

Copy the needed addresses from the output at the end:
```
ALT addresses (comma-separated for easy copying):
7YfYXkg4Tpb9jMVsrRjRLjrQ6r8BvCxTFfKqb7jMSvmE,8ZgYnWkg5Uqc0kNWtsStKmsSmjSLkmR7sLrbYcjNTwnF,9ahZoVkg6Vrd1lOXutUuUnVxtTuSyHmNrvcscjOUwog
```

**Step 2: Select the needed addresses and transfer them**
For example, transferring only the first two:
```bash
NEW_AUTHORITY_PUBKEY=NewOperatorPublicKey \
ALT_ADDRESSES=7YfYXkg4Tpb9jMVsrRjRLjrQ6r8BvCxTFfKqb7jMSvmE,8ZgYnWkg5Uqc0kNWtsStKmsSmjSLkmR7sLrbYcjNTwnF \
npx ts-node scripts/mainnet/transfer_alt_authority_specific.ts
```

---

## Scenario 3: Check Another Operator's ALTs

### Situation
You need to check which ALTs belong to another address.

### Command
```bash
TARGET_AUTHORITY=OtherOperatorPublicKey \
npx ts-node scripts/mainnet/list_alt.ts
```

---

## Scenario 4: Add a New Operator Without Transferring ALTs

### Situation
You want to add a new operator to the registry but not transfer ALTs to them.

### Command
```bash
OPERATOR_PUBKEY=NewOperatorPublicKey \
npx ts-node scripts/mainnet/add_operator.ts
```

---

## Scenario 5: Using the Interactive Script

### Situation
You prefer an interactive interface instead of the command line.

### Launch
```bash
./scripts/mainnet/alt_manager.sh
```

You will see a menu:
```
===================================================================
  ALT & Operator Management Tool
===================================================================

Select an operation:

  Address Lookup Tables (ALT):
    1) View all ALTs of current authority
    2) View ALTs of a specific address
    3) Transfer ALL ALTs to new authority
    4) Transfer specific ALTs to new authority

  Operator Management:
    5) Add new operator
    6) Remove operator
    7) Replace operator

  Other:
    8) Show quick reference
    0) Exit

Your choice:
```

---

## Common Issues and Solutions

### Issue: "Table is frozen, cannot transfer authority"

**Cause**: The ALT has been frozen and its authority can no longer be changed.

**Solution**: This is normal behavior. The script automatically skips such tables. If you need to manage addresses in this table, you'll have to create a new ALT.

### Issue: "Authority mismatch"

**Cause**: The current ALT authority doesn't match your keypair.

**Solution**: Make sure that:
1. You're using the correct keypair file
2. The ALT actually belongs to this authority
3. The ALT hasn't been transferred to someone else previously

### Issue: "Operator already exists"

**Cause**: The operator is already in the registry.

**Solution**: This is an informational message. The script won't add a duplicate. If you need to replace an operator, use `replace_operator.ts`.

### Issue: "Insufficient SOL balance"

**Cause**: Not enough SOL to pay for transactions.

**Solution**: Top up the authority account balance. Each transaction requires ~0.001-0.01 SOL.

---

## Automation with Bash Scripts

You can create your own bash scripts for automation:

### Example: Full Rights Transfer
```bash
#!/bin/bash

# transfer_all_rights.sh
NEW_OPERATOR="9dKLmNpvXZfGkjRt3Hq7YzLpMnUwZxEaBcRfTyGhJkWs"
OLD_OPERATOR="8cJXGoV8FCwNqbcjstCiAxdW3miy2xsBvuXSn3s64GrG"

echo "Starting full rights transfer..."

# Step 1: Replace operator
echo "Step 1: Replacing operator..."
OLD_OPERATOR_PUBKEY=$OLD_OPERATOR \
NEW_OPERATOR_PUBKEY=$NEW_OPERATOR \
npx ts-node scripts/mainnet/replace_operator.ts

if [ $? -ne 0 ]; then
    echo "Operator replacement failed!"
    exit 1
fi

# Step 2: Transfer ALTs
echo "Step 2: Transferring ALTs..."
NEW_AUTHORITY_PUBKEY=$NEW_OPERATOR \
npx ts-node scripts/mainnet/transfer_alt_authority.ts

if [ $? -ne 0 ]; then
    echo "ALT transfer failed!"
    exit 1
fi

echo "Full rights transfer completed!"
```

Usage:
```bash
chmod +x transfer_all_rights.sh
./transfer_all_rights.sh
```

---

## Useful Verification Commands

### Check authority balance
```bash
solana balance ~/.config/solana/fpp-staging.json --url mainnet-beta
```

### View ALT info in explorer
```bash
# Open in browser:
https://explorer.solana.com/address/<ALT_ADDRESS>?cluster=mainnet
```

### Check current network
```bash
solana config get
```

### Switch to mainnet (if needed)
```bash
solana config set --url mainnet-beta
```

---

## Security Recommendations

1. **Always verify addresses** before executing operations
2. **Back up** keypair files
3. **Test on devnet** when possible
4. **Record transaction signatures** for audit trail
5. **Verify results** after each operation
6. **Use hardware wallets** for critical operations

---

## Additional Resources

- [Solana ALT Documentation](https://docs.solana.com/developing/lookup-tables)
- [Anchor Framework Documentation](https://www.anchor-lang.com/)
- [Solana Explorer](https://explorer.solana.com/)
- [Solscan](https://solscan.io/)
