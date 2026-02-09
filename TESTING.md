# Unit Testing Documentation

## Overview

This document describes the unit tests for the Flipper Solana program. All tests are written in Rust and use the standard `#[test]` framework.

## Test Structure

Tests are organized in separate files with the `_test.rs` suffix, located alongside the modules they test:

```
programs/flipper/src/
├── state_test.rs                                    # State module tests
├── errors_test.rs                                   # Error codes tests
├── adapters/
│   └── dex_adapter_test.rs                         # DEX adapter tests
└── instructions/
    ├── adapter_registry_module/
    │   └── adapter_registry_test.rs                # Adapter registry tests
    ├── limit_orders_module/
    │   └── limit_orders_test.rs                    # Limit orders logic tests
    ├── route_validator_module/
    │   └── route_validator_test.rs                 # Route validation tests
    └── vault_manager_module/
        └── vault_manager_test.rs                   # Vault management tests
```

## Running Tests

### Run all unit tests
```bash
cargo test --lib
```

### Run tests for a specific module
```bash
# Test state module
cargo test --lib state_test

# Test limit orders
cargo test --lib limit_orders_test

# Test vault manager
cargo test --lib vault_manager_test
```

### Run a specific test
```bash
cargo test --lib test_limit_order_should_execute_take_profit_exact_trigger
```

### Run with output
```bash
cargo test --lib -- --nocapture
```

## Test Coverage Summary

### Total: 100 Unit Tests

#### 1. State Module Tests (14 tests)
- `test_adapter_registry_is_supported_adapter` - Verifies adapter support checking
- `test_adapter_registry_get_adapter_program_id` - Tests program ID retrieval
- `test_adapter_registry_is_authorized_operator` - Validates operator authorization
- `test_adapter_registry_multiple_adapters` - Tests multiple adapter support
- `test_swap_to_bytes_simple_variants` - Tests byte serialization for simple swap types
- `test_swap_to_bytes_with_bool_variants` - Tests serialization with boolean parameters
- `test_swap_to_bytes_with_side_variants` - Tests serialization with Side enum
- `test_swap_to_bytes_symmetry` - Tests Symmetry swap serialization
- `test_swap_to_bytes_symmetry_edge_cases` - Edge cases for Symmetry swap
- `test_swap_equality` - Tests swap type equality
- `test_side_equality` - Tests Side enum equality
- `test_swap_clone` - Verifies swap cloning
- `test_adapter_info_clone` - Verifies adapter info cloning

#### 2. Error Code Tests (10 tests)
- `test_error_code_values` - Verifies error code discriminants
- `test_error_code_adapter_errors` - Adapter-related error codes
- `test_error_code_operator_errors` - Operator error codes
- `test_error_code_vault_errors` - Vault error codes
- `test_error_code_limit_order_errors` - Limit order error codes
- `test_error_code_validation_errors` - Validation error codes
- `test_error_code_platform_fee_errors` - Platform fee error codes
- `test_error_code_trigger_errors` - Trigger mechanism error codes
- `test_error_code_no_duplicates` - Ensures no duplicate error codes
- `test_error_code_range` - Verifies error codes are in valid range
- `test_error_code_swap_errors` - Swap-related error codes
- `test_error_code_comprehensive_list` - Comprehensive error categorization

#### 3. DEX Adapter Tests (11 tests)
- `test_swap_result_creation` - Basic swap result creation
- `test_swap_result_zero_amount` - Handling zero amounts
- `test_swap_result_max_amount` - Handling maximum amounts
- `test_swap_result_typical_amounts` - Common amount scenarios
- `test_swap_result_comparison` - Result comparison logic
- `test_swap_result_arithmetic` - Arithmetic operations
- `test_swap_result_with_slippage` - Slippage calculations
- `test_swap_result_fee_calculation` - Fee calculation logic
- `test_swap_result_percentage_calculation` - Percentage gain/loss
- `test_swap_result_multiple_swaps` - Multi-hop swap scenarios
- `test_swap_result_precision` - Precision handling

#### 4. Adapter Registry Tests (14 tests)
- `test_adapter_info_creation` - Adapter info creation
- `test_adapter_info_different_swap_types` - Various swap type support
- `test_adapter_registry_initialization` - Registry initialization
- `test_adapter_registry_multiple_operators` - Multiple operator management
- `test_adapter_registry_multiple_adapters` - Multiple adapter management
- `test_adapter_registry_empty` - Empty registry handling
- `test_adapter_registry_find_adapter` - Adapter lookup
- `test_adapter_registry_authority_is_operator` - Authority operator privileges
- `test_adapter_info_clone` - Adapter info cloning
- `test_adapter_registry_operator_list_modification` - Operator list modifications
- `test_adapter_registry_remove_operator` - Operator removal
- `test_adapter_info_with_complex_swap_types` - Complex swap types
- `test_adapter_registry_large_operator_list` - Large operator lists

#### 5. Limit Orders Tests (25 tests)
- `test_limit_order_should_execute_take_profit_exact_trigger` - Take profit at exact trigger
- `test_limit_order_should_execute_take_profit_above_trigger` - Take profit above trigger
- `test_limit_order_should_execute_take_profit_below_trigger` - Take profit below trigger
- `test_limit_order_should_execute_stop_loss_exact_trigger` - Stop loss at exact trigger
- `test_limit_order_should_execute_stop_loss_below_trigger` - Stop loss below trigger
- `test_limit_order_should_execute_stop_loss_above_trigger` - Stop loss above trigger
- `test_limit_order_should_execute_high_percentage_take_profit` - High percentage take profit
- `test_limit_order_should_execute_small_amounts` - Small amount handling
- `test_limit_order_calculate_min_acceptable_output` - Min output calculation
- `test_limit_order_calculate_min_acceptable_output_zero_slippage` - Zero slippage
- `test_limit_order_calculate_min_acceptable_output_max_slippage` - Maximum slippage
- `test_trigger_type_discriminant` - Trigger type values
- `test_order_status_discriminant` - Order status values
- `test_trigger_type_equality` - Trigger type equality
- `test_order_status_equality` - Order status equality
- `test_limit_order_space_constant` - Account space calculation
- `test_limit_order_should_execute_edge_case_zero_output` - Zero output edge case
- `test_limit_order_should_execute_precision` - Precision testing
- `test_limit_order_calculate_output_with_small_amounts` - Small amount calculations
- `test_limit_order_should_execute_max_trigger_take_profit` - Maximum take profit
- `test_limit_order_should_execute_max_trigger_stop_loss` - Maximum stop loss

#### 6. Route Validator Tests (15 tests)
- `test_route_plan_step_creation` - Route plan step creation
- `test_route_plan_step_partial_swap` - Partial swap routes
- `test_route_plan_step_with_whirlpool` - Whirlpool integration
- `test_route_plan_step_with_meteora` - Meteora integration
- `test_route_plan_multiple_steps` - Multi-step routes
- `test_route_plan_step_clone` - Route step cloning
- `test_route_plan_step_different_indices` - Multi-hop routing
- `test_route_plan_step_zero_percent` - Zero percent handling
- `test_route_plan_step_full_percent` - Full percent routes
- `test_route_plan_step_with_side` - Order book side handling
- `test_route_plan_parallel_swaps` - Parallel swap execution
- `test_route_plan_step_max_indices` - Maximum index values
- `test_route_plan_step_serialization_invariants` - Serialization consistency
- `test_route_plan_complex_multi_hop` - Complex multi-hop scenarios
- `test_route_plan_step_all_swap_types` - All swap type support

#### 7. Vault Manager Tests (15 tests)
- `test_get_vault_address` - Vault PDA derivation
- `test_get_vault_address_different_mints` - Multiple mint support
- `test_get_vault_authority_address` - Authority PDA derivation
- `test_get_vault_authority_address_different_programs` - Cross-program support
- `test_vault_authority_structure` - Authority structure validation
- `test_vault_authority_with_default_admin` - Default admin handling
- `test_vault_address_consistency` - Deterministic PDA generation
- `test_vault_authority_consistency` - Authority consistency
- `test_vault_exists_empty_accounts` - Empty account handling
- `test_vault_address_seeds` - PDA seed verification
- `test_vault_authority_seeds` - Authority seed verification
- `test_multiple_vaults_for_same_program` - Multiple vault support
- `test_vault_authority_bump_range` - Bump seed validation
- `test_vault_address_bump_range` - Vault bump validation

## Key Test Patterns

### 1. PDA Testing
Tests verify that Program Derived Addresses (PDAs) are generated correctly and consistently:
```rust
let (vault_address, bump) = get_vault_address(&mint, &program_id);
assert_ne!(vault_address, Pubkey::default());
```

### 2. Limit Order Trigger Logic
Tests validate complex trigger price calculations for take profit and stop loss:
```rust
let order = create_test_limit_order(TriggerType::TakeProfit, 1000, 100_000);
assert!(order.should_execute(110_000).unwrap()); // 10% increase triggers
```

### 3. Serialization Testing
Tests ensure swap types are correctly serialized to bytes for PDA seeds:
```rust
let swap = Swap::Whirlpool { a_to_b: true };
let bytes = swap.to_bytes();
assert_eq!(bytes[0], 17);
assert_eq!(bytes[1], 1);
```

### 4. Error Code Validation
Tests verify error codes are unique and in the correct range:
```rust
assert_eq!(ErrorCode::SwapNotSupported as u32, 6016);
assert!(code >= 6000 && code < 7000);
```

## Test Best Practices

1. **Determinism**: All tests produce consistent results across runs
2. **Isolation**: Tests don't depend on external state or each other
3. **Coverage**: Tests cover normal cases, edge cases, and error conditions
4. **Clarity**: Test names clearly describe what is being tested
5. **Assertions**: Each test has clear, specific assertions

## Adding New Tests

When adding new functionality, follow these guidelines:

1. Create a new test file with `_test.rs` suffix
2. Add the test module declaration in the parent `mod.rs`:
   ```rust
   #[cfg(test)]
   mod my_module_test;
   ```
3. Structure tests with the `#[cfg(test)]` and `mod tests` pattern
4. Use descriptive test names starting with `test_`
5. Test both success and failure scenarios
6. Include edge cases and boundary conditions

## Continuous Integration

These tests should be run as part of your CI/CD pipeline:

```bash
# In your CI workflow
cargo test --lib --verbose
```

## Test Maintenance

- Run tests before each commit: `cargo test --lib`
- Update tests when modifying business logic
- Add tests for new features
- Remove or update tests when deprecating features
- Keep test code clean and well-documented

## Additional Resources

- [Anchor Testing Guide](https://book.anchor-lang.com/anchor_bts/testing.html)
- [Rust Testing Documentation](https://doc.rust-lang.org/book/ch11-00-testing.html)
- [Solana Program Testing](https://docs.solana.com/developing/test-validator)

## Notes

- These are unit tests for pure Rust logic
- Integration tests with full Solana runtime are in the `tests/` directory
- Unit tests are faster and don't require a validator
- For testing instructions with CPI, use integration tests instead
