# Mainnet Initialization Guide

## 🎯 Overview

This guide explains the correct order of operations for initializing the Flipper protocol on Mainnet.

## ⚠️ CRITICAL: Do This IMMEDIATELY After Deployment

The **Global Manager** and **Vault Authority** should be created **immediately** after deploying the contract to prevent unauthorized access.

## 📋 Initialization Steps

### Step 1: Create Global Manager (CRITICAL - DO FIRST!)

The **Global Manager** is the super-admin with critical permissions:
- ✅ Withdraw platform fees
- ✅ Change Vault Authority admin
- ✅ Change itself to another address

**⚠️ IMPORTANT**: The first account to call `create_global_manager` becomes the Global Manager!

```bash
# Using wallet as manager (for testing only)
ts-node scripts/mainnet/create_global_manager.ts

# Using multisig as manager (RECOMMENDED for production)
MANAGER_PUBKEY=<your_multisig_address> ts-node scripts/mainnet/create_global_manager.ts

# Skip confirmation prompt (for automation)
SKIP_CONFIRMATION=true MANAGER_PUBKEY=<multisig> ts-node scripts/mainnet/create_global_manager.ts
```

**Best Practices**:
- ✅ Use a multisig address as manager
- ✅ Test the multisig before using in production
- ✅ Document the manager address
- ✅ Keep private keys extremely secure
- ⚠️ Never lose the manager's private keys!

### Step 2: Create Vault Authority

The **Vault Authority** controls all vaults in the system.

```bash
# Using wallet as admin
ts-node scripts/mainnet/create_vault_authority.ts

# Using specific admin address (recommended: same as Global Manager)
ADMIN_PUBKEY=<your_multisig_address> ts-node scripts/mainnet/create_vault_authority.ts
```

**Recommendation**: Use the same multisig address for both Global Manager and Vault Authority admin.

### Step 3: Initialize Adapter Registry

Set up the DEX adapter registry with operators.

```bash
# Set operator public key
OPERATOR_PUBKEY=<operator_address> ts-node scripts/mainnet/initialize_adapter_registry.ts
```

### Step 4: Register DEX Adapters

Register supported DEX protocols (Raydium, Whirlpool, Meteora).

```bash
ts-node scripts/mainnet/register_adapters.ts
```

### Step 5: Add Operators (if needed)

Add additional operators who can manage pools and execute limit orders.

```bash
OPERATOR_PUBKEY=<new_operator> ts-node scripts/mainnet/add_operator.ts
```

## 🔄 Management Operations

### Change Global Manager

Transfer Global Manager role to a new address (irreversible operation).

```bash
# Current manager must sign this transaction
NEW_MANAGER_PUBKEY=<new_multisig> ts-node scripts/mainnet/change_global_manager.ts

# Skip confirmation (use with caution!)
SKIP_CONFIRMATION=true NEW_MANAGER_PUBKEY=<new_multisig> ts-node scripts/mainnet/change_global_manager.ts
```

**⚠️ WARNING**: This is irreversible! The old manager loses all control.

### Change Vault Authority Admin

Only Global Manager can change the Vault Authority admin.

This requires calling the `change_vault_authority_admin` instruction with the Global Manager's signature.

## 📊 Verification

After initialization, verify all accounts:

```bash
# Check Global Manager
solana account <global_manager_pda> -u mainnet-beta

# Check Vault Authority
solana account <vault_authority_pda> -u mainnet-beta

# Check Adapter Registry
solana account <adapter_registry_pda> -u mainnet-beta
```

Or use Solscan:
- `https://solscan.io/account/<account_address>`

## 🏗️ Architecture

```
Global Manager (multisig)
    ↓ controls
Vault Authority Admin (multisig)
    ↓ manages
Vaults (token storage)
    ↓ used in
Swaps & Limit Orders
```

## 🔐 Security Best Practices

### 1. Multisig Setup

Use Squads Protocol or similar for multisig:
```bash
# Install Squads CLI
npm install -g @sqds/cli

# Create multisig (recommended: 3/5 or 2/3)
squads create --threshold 3 --members <key1,key2,key3,key4,key5>
```

### 2. Key Management

- ✅ Store private keys in hardware wallets
- ✅ Use separate keys for different roles
- ✅ Regularly rotate keys
- ✅ Document all key holders
- ❌ Never commit keys to git
- ❌ Never share keys via insecure channels

### 3. Access Control

| Role | Permissions | Recommended Setup |
|------|-------------|-------------------|
| Global Manager | Withdraw fees, change admin | Multisig (3/5) |
| Vault Authority Admin | Create/close vaults | Same as Global Manager |
| Operators | Manage pools, execute orders | Trusted bots/servers |

### 4. Monitoring

- Set up alerts for Global Manager transactions
- Monitor platform fee account balances
- Track vault creation/closure events
- Log all admin operations

## 🚨 Emergency Procedures

### If Global Manager Key is Compromised

1. **Immediately** use the compromised key to transfer to a new secure address
2. Verify the new address is secure
3. Investigate how the compromise occurred
4. Document the incident

### If Vault Authority Admin is Compromised

1. Use Global Manager to change the admin
2. Verify the new admin is secure
3. Audit all recent vault operations

## 📝 Deployment Checklist

Before mainnet deployment:

- [ ] Contract audited by professional auditor
- [ ] All tests passing
- [ ] Multisig created and tested
- [ ] All signers have access to multisig
- [ ] Deployment plan documented
- [ ] Emergency procedures documented
- [ ] Monitoring system in place
- [ ] Backup plan for key management

After deployment (DO IMMEDIATELY):

- [ ] Create Global Manager (within 1 minute)
- [ ] Verify Global Manager address is correct
- [ ] Create Vault Authority
- [ ] Verify Vault Authority admin is correct
- [ ] Document all addresses
- [ ] Set up monitoring
- [ ] Test basic operations

## 🔗 Related Scripts

- `create_global_manager.ts` - Create Global Manager
- `change_global_manager.ts` - Transfer Global Manager role
- `create_vault_authority.ts` - Create Vault Authority
- `initialize_adapter_registry.ts` - Setup adapter registry
- `register_adapters.ts` - Register DEX adapters
- `add_operator.ts` - Add operators
- `remove_operator.ts` - Remove operators

## 📞 Support

For issues or questions:
- Open an issue on GitHub
- Contact the development team
- Review the protocol documentation

## ⚠️ Disclaimer

This is critical infrastructure. Test thoroughly on devnet before mainnet deployment. The developers are not responsible for any loss of funds due to misconfiguration or misuse of these scripts.
