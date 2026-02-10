# Devnet Testing Guide

Scripts and documentation for testing the Flipper protocol on Solana devnet.

## Documentation

| Document | Description |
|----------|-------------|
| [JUPITER_TESTING.md](JUPITER_TESTING.md) | Complete guide for Jupiter shared functions testing |
| [ALGORITHM_SHARED_ROUTE.md](ALGORITHM_SHARED_ROUTE.md) | Detailed algorithm for `shared_route` test script |
| [ALGORITHM_ROUTE_AND_ORDER.md](ALGORITHM_ROUTE_AND_ORDER.md) | Algorithm for `shared_route_and_create_order` instruction |
| [CHANGE_AUTHORITY.md](CHANGE_AUTHORITY.md) | Guide for changing vault authority and adding operators |
| [SUMMARY.md](SUMMARY.md) | Summary of all devnet scripts and created accounts |

## Quick Start

```bash
# 1. Configure Solana CLI for devnet
solana config set --url devnet
solana airdrop 5

# 2. Build and deploy
anchor build
anchor deploy --provider.cluster devnet

# 3. Run all tests
npm run devnet:test-all
```

## Available NPM Scripts

```bash
npm run devnet:setup-jupiter      # Setup test environment
npm run devnet:verify              # Verify configuration & integration test
npm run devnet:test-route          # Test shared_route
npm run devnet:test-limit-orders   # Test limit orders
npm run devnet:check-status        # Check account status
npm run devnet:test-all            # Run all tests sequentially
```

## Script Files

Located in `scripts/devnet/`:

| Script | Purpose |
|--------|---------|
| `1.setup_and_single_raydium_swap.ts` | Setup and test Raydium swap |
| `2.setup_and_swap_wsol_to_token.ts` | Setup and test WSOL swap |
| `3.migrate_and_set_price_with_swap_raydium.ts` | Migration and price setting |
| `4.setup_shared_jupiter_environment.ts` | Full Jupiter test environment setup |
| `5.test_shared_route_jupiter.ts` | Test `shared_route` instruction |
| `6.test_shared_limit_orders_jupiter.ts` | Test limit orders with Jupiter |
| `7.verify_jupiter_mock_config.ts` | Verify mock Jupiter configuration |
| `8.check_account_status.ts` | Check all account statuses |
| `add_operator.ts` | Add operator to registry |
| `change_vault_authority_admun.ts` | Change vault authority admin |
| `change_vault_authority_and_add_operator.ts` | Change authority + add operator |
| `register_meteora_whirlpool_adapters.ts` | Register Meteora & Whirlpool adapters |
| `test_create_vaults_with_id.ts` | Test vault creation |

## Testing Flow

```
1. Setup Environment (script 4)
   |
2. Verify Configuration (script 7)
   |
3. Test Shared Route (script 5)
   |
4. Test Limit Orders (script 6)
   |
5. Check Status anytime (script 8)
```

## Notes

- All tests use the Mock Jupiter program, not the real Jupiter aggregator
- The mock simulates swap behavior for testing purposes
- Platform fees are set to 0 in tests for simplicity
- Tokens use 6 decimals (like USDC)

## Related

- [Architecture Overview](../ARCHITECTURE.md)
- [Instruction Reference](../INSTRUCTIONS.md)
- [Mainnet Guides](../mainnet/)
