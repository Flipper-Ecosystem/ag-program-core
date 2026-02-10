# Mainnet Deployment & Operations Guide

Scripts and documentation for deploying and operating the Flipper protocol on Solana mainnet.

## Documentation

| Document | Description |
|----------|-------------|
| [INITIALIZATION_GUIDE.md](INITIALIZATION_GUIDE.md) | **Start here** - Critical initialization steps after deployment |
| [SHARED_ROUTE_GUIDE.md](SHARED_ROUTE_GUIDE.md) | Guide for executing Jupiter shared route swaps |
| [OPERATORS_GUIDE.md](OPERATORS_GUIDE.md) | Full operator and ALT management documentation |
| [ALT_MANAGEMENT.md](ALT_MANAGEMENT.md) | Address Lookup Table transfer technical details |
| [QUICK_REFERENCE.md](QUICK_REFERENCE.md) | Quick command reference for common operations |
| [EXAMPLES.md](EXAMPLES.md) | Practical usage examples and scenarios |

## Deployment Checklist

Before mainnet deployment:

- [ ] Contract audited by professional auditor
- [ ] All tests passing
- [ ] Multisig created and tested
- [ ] All signers have access to multisig
- [ ] Emergency procedures documented

After deployment (DO IMMEDIATELY):

```bash
# Step 1: Create Global Manager (within 1 minute of deployment!)
MANAGER_PUBKEY=<your_multisig> ts-node scripts/mainnet/create_global_manager.ts

# Step 2: Create Vault Authority
ADMIN_PUBKEY=<your_multisig> ts-node scripts/mainnet/create_vault_authority.ts

# Step 3: Initialize Adapter Registry
OPERATOR_PUBKEY=<operator> ts-node scripts/mainnet/initialize_adapter_registry.ts

# Step 4: Register adapters
ts-node scripts/mainnet/register_adapters.ts
```

See [INITIALIZATION_GUIDE.md](INITIALIZATION_GUIDE.md) for the complete guide.

## Script Files

Located in `scripts/mainnet/`:

### Initialization Scripts

| Script | Purpose |
|--------|---------|
| `create_global_manager.ts` | Create Global Manager PDA |
| `change_global_manager.ts` | Transfer Global Manager role |
| `create_vault_authority.ts` | Create Vault Authority PDA |
| `change_vault_authority_admin.ts` | Change vault authority admin |
| `initialize_adapter_registry.ts` | Setup adapter registry |
| `migrate_adapter_registry.ts` | Migrate adapter registry |
| `migrate_vault_authority.ts` | Migrate vault authority |
| `register_adapters.ts` | Register DEX adapters |
| `create_vault_for_mint.ts` | Create vault for a token mint |

### Operator Management

| Script | Purpose |
|--------|---------|
| `add_operator.ts` | Add operator to registry |
| `remove_operator.ts` | Remove operator from registry |
| `replace_operator.ts` | Replace one operator with another |

### ALT Management

| Script | Purpose |
|--------|---------|
| `list_alt.ts` | View Address Lookup Tables |
| `transfer_alt_authority.ts` | Transfer all ALTs |
| `transfer_alt_authority_specific.ts` | Transfer specific ALTs |
| `alt_manager.sh` | Interactive ALT/operator management UI |

### Verification & Testing

| Script | Purpose |
|--------|---------|
| `check_global_manager.ts` | Check Global Manager status |
| `check_vault_auth_admin.ts` | Check Vault Authority admin |
| `check_vault_and_global_manager.ts` | Check vault and manager |
| `check_adapter_registry.ts` | Check adapter registry |
| `check_shared_route_setup.ts` | Check shared route setup |
| `test_shared_route_jupiter.ts` | Test Jupiter shared route |
| `test_whirlpool_multihop.ts` | Test Whirlpool routing |
| `test_meteora_route.ts` | Test Meteora routing |
| `test_swap_near.ts` | Test near-value swaps |

## Quick Reference

### Operator Management
```bash
OPERATOR_PUBKEY=<key> npx ts-node scripts/mainnet/add_operator.ts
OPERATOR_PUBKEY=<key> npx ts-node scripts/mainnet/remove_operator.ts
OLD_OPERATOR_PUBKEY=<old> NEW_OPERATOR_PUBKEY=<new> npx ts-node scripts/mainnet/replace_operator.ts
```

### ALT Management
```bash
npx ts-node scripts/mainnet/list_alt.ts
NEW_AUTHORITY_PUBKEY=<key> npx ts-node scripts/mainnet/transfer_alt_authority.ts
```

### Interactive UI
```bash
./scripts/mainnet/alt_manager.sh
```

## Prerequisites

- Keypair file: `~/.config/solana/fpp-staging.json`
- Sufficient SOL balance for transaction fees
- Node.js 18+ installed
- Dependencies installed: `npm install`

## Important Reminders

1. **All operations are on mainnet** - verify everything before executing
2. **Save transaction signatures** for audit trail
3. **Use multisig** for Global Manager and Vault Authority Admin
4. **Test on devnet first** when possible

## Related

- [Architecture Overview](../ARCHITECTURE.md)
- [Instruction Reference](../INSTRUCTIONS.md)
- [Devnet Testing](../devnet/)
