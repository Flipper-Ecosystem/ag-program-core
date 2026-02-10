# Flipper Protocol Documentation

> **Disclaimer:** This project is currently under active development and has not yet been audited. The protocol, its smart contracts, APIs, and documentation are subject to change at any time without notice. **Do not use in production with real funds until a professional security audit has been completed.** The developers make no warranties regarding the security, reliability, or completeness of the software. Use at your own risk.

Flipper is a Solana-based DEX aggregator protocol that routes token swaps through multiple liquidity providers to find the best execution price. It supports direct adapter-based swaps through on-chain DEX protocols, as well as Jupiter aggregator integration as an additional liquidity provider via CPI.

## Program ID

```
fLpRcgQSJxKeeUogb6M7bWe1iyYQbahjGXGwr4HgHit
```

## Key Features

- **Multi-DEX Routing** - Routes swaps through Raydium, Whirlpool (Orca), Meteora, and 120+ other DEX protocols
- **Jupiter Integration** - Uses Jupiter V6 as an additional liquidity provider via CPI (`shared_accounts_route`)
- **Limit Orders** - TakeProfit and StopLoss limit orders with price-based triggers and expiry
- **Partial Swaps** - Split input across multiple DEXes for better price execution
- **Multi-Hop Swaps** - Chain multiple swaps through intermediate tokens
- **Platform Fees** - Configurable platform fee collection on swaps
- **Token 2022 Support** - Full support for Token 2022 extensions including confidential transfers
- **Role-Based Access Control** - Global Manager, Vault Authority Admin, and Operator roles

## Documentation Index

### Architecture & Reference

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture, component overview, and data flow diagrams |
| [INSTRUCTIONS.md](INSTRUCTIONS.md) | Complete reference for all 30+ program instructions |
| [ACCOUNTS.md](ACCOUNTS.md) | Account structures, PDAs, and state management |
| [ADAPTERS.md](ADAPTERS.md) | DEX adapter system: Raydium, Whirlpool, Meteora, and Jupiter |
| [LIMIT_ORDERS.md](LIMIT_ORDERS.md) | Limit order system: creation, execution, cancellation |
| [EVENTS_AND_ERRORS.md](EVENTS_AND_ERRORS.md) | Event definitions and error code reference |

### Network-Specific Guides

| Directory | Description |
|-----------|-------------|
| [devnet/](devnet/) | Devnet testing scripts, setup guides, and algorithm documentation |
| [mainnet/](mainnet/) | Mainnet deployment, initialization, operator management, and ALT scripts |

## Architecture Overview

```
                    User
                     |
          +----------+-----------+
          |                      |
     Direct Route           Jupiter CPI
     (route instruction)    (shared_route instruction)
          |                      |
    +-----------+          +----------+
    | Route     |          | Jupiter  |
    | Validator |          | V6       |
    +-----+-----+         +-----+----+
          |                      |
    +-----+-----+               |
    | Route     |               |
    | Executor  |               |
    +-----+-----+               |
          |                      |
    +-----+--------+-----+      |
    |     |        |      |     |
 Raydium Whirlpool Meteora 120+ DEXes
    |     |        |      |     |
    +-----+--------+-----+-----+
                |
          Token Vaults
          (PDA-owned)
                |
          +-----+-----+
          |           |
     User Tokens   Platform Fees
```

## Role Hierarchy

```
Global Manager (super-admin, multisig recommended)
    |-- Withdraw platform fees
    |-- Change Vault Authority admin
    |-- Change itself to new address
    |
Vault Authority Admin (admin, multisig recommended)
    |-- Create/close vaults
    |-- Change adapter registry authority
    |-- Add/remove operators
    |
Operators (trusted bots/servers)
    |-- Execute limit orders
    |-- Cancel expired orders
    |-- Close filled/cancelled orders
    |-- Manage pools
```

## Quick Start

### For Developers

1. Read [ARCHITECTURE.md](ARCHITECTURE.md) for system overview
2. Read [INSTRUCTIONS.md](INSTRUCTIONS.md) for instruction reference
3. Read [ADAPTERS.md](ADAPTERS.md) to understand the DEX adapter system

### For Deployment

1. Read [mainnet/INITIALIZATION_GUIDE.md](mainnet/INITIALIZATION_GUIDE.md) for deployment steps
2. Read [mainnet/README.md](mainnet/README.md) for script reference

### For Testing

1. Read [devnet/README.md](devnet/README.md) for devnet testing setup
2. Run `npm run devnet:test-all` for a full test suite

## Building

```bash
# Build programs
anchor build

# Run tests
anchor test

# Deploy to devnet
anchor deploy --provider.cluster devnet

# Deploy to mainnet
anchor deploy --provider.cluster mainnet
```

## Related Files

- Program source: `programs/flipper/src/`
- Mock programs: `programs/mock_jupiter/`, `programs/mock_raydium/`, `programs/mock_whirlpools/`, `programs/mock_meteora/`
- Test suite: `tests/`
- Scripts: `scripts/devnet/`, `scripts/mainnet/`, `scripts/localnet/`
