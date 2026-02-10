# Quick Command Reference for Operators and ALT Management

## Operator Management in Adapter Registry

### Add a new operator
```bash
OPERATOR_PUBKEY=8cJXGoV8FCwNqbcjstCiAxdW3miy2xsBvuXSn3s64GrG \
npx ts-node scripts/mainnet/add_operator.ts
```

### Remove an operator
```bash
OPERATOR_PUBKEY=8cJXGoV8FCwNqbcjstCiAxdW3miy2xsBvuXSn3s64GrG \
npx ts-node scripts/mainnet/remove_operator.ts
```

### Replace an operator
```bash
OLD_OPERATOR_PUBKEY=8cJXGoV8FCwNqbcjstCiAxdW3miy2xsBvuXSn3s64GrG \
NEW_OPERATOR_PUBKEY=9dKLmNpvXZfGkjRt3Hq7YzLpMnUwZxEaBcRfTyGhJkWs \
npx ts-node scripts/mainnet/replace_operator.ts
```

---

## Address Lookup Table (ALT) Management

### View all ALTs of the current authority
```bash
npx ts-node scripts/mainnet/list_alt.ts
```

### View ALTs of a specific address
```bash
TARGET_AUTHORITY=9dKLmNpvXZfGkjRt3Hq7YzLpMnUwZxEaBcRfTyGhJkWs \
npx ts-node scripts/mainnet/list_alt.ts
```

### Transfer ALL ALTs to a new operator
```bash
NEW_AUTHORITY_PUBKEY=9dKLmNpvXZfGkjRt3Hq7YzLpMnUwZxEaBcRfTyGhJkWs \
npx ts-node scripts/mainnet/transfer_alt_authority.ts
```

### Transfer specific ALTs to a new operator
```bash
NEW_AUTHORITY_PUBKEY=9dKLmNpvXZfGkjRt3Hq7YzLpMnUwZxEaBcRfTyGhJkWs \
ALT_ADDRESSES=7YfYXkg4Tpb9jMVsrRjRLjrQ6r8BvCxTFfKqb7jMSvmE,8ZgYnWkg5Uqc0kNWtsStKmsSmjSLkmR7sLrbYcjNTwnF \
npx ts-node scripts/mainnet/transfer_alt_authority_specific.ts
```

---

## Full Rights Transfer Process

### Option 1: Full transfer (operators + all ALTs)

```bash
# 1. Check current ALTs
npx ts-node scripts/mainnet/list_alt.ts

# 2. Replace operator in registry
OLD_OPERATOR_PUBKEY=<old_operator> \
NEW_OPERATOR_PUBKEY=<new_operator> \
npx ts-node scripts/mainnet/replace_operator.ts

# 3. Transfer all ALTs
NEW_AUTHORITY_PUBKEY=<new_authority> \
npx ts-node scripts/mainnet/transfer_alt_authority.ts
```

### Option 2: Selective ALT transfer

```bash
# 1. Check all ALTs and select the ones you need
npx ts-node scripts/mainnet/list_alt.ts

# 2. Transfer only selected ALTs
NEW_AUTHORITY_PUBKEY=<new_authority> \
ALT_ADDRESSES=<addr1,addr2> \
npx ts-node scripts/mainnet/transfer_alt_authority_specific.ts
```

---

## Verification and Checks

### Check current operators in registry
Run any operator management script - they always display the current state:
```bash
OPERATOR_PUBKEY=any_address npx ts-node scripts/mainnet/add_operator.ts
# (you can interrupt after seeing the current state)
```

### Check ALT on Solana Explorer
```
https://explorer.solana.com/address/<ALT_ADDRESS>?cluster=mainnet
```

---

## Important Notes

**Requirements:**
- Authority keypair file: `~/.config/solana/fpp-staging.json`
- Sufficient SOL balance for transactions
- Only the authority can manage operators and ALTs

**Limitations:**
- Frozen ALTs cannot be transferred - they are skipped automatically
- Each ALT operation = separate transaction
- On error, the script continues working with the remaining items

**Security:**
- All operations execute on mainnet
- Verify addresses before execution
- Keep your keypair secure
- Scripts automatically verify results
