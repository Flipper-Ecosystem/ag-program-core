# Lifetime Specification

## Introduction to Lifetimes in Solana

In the context of Solana and the Anchor framework, the `'info` lifetime is a critical mechanism for ensuring memory safety during instruction execution. This lifetime, standard in Anchor, guarantees that all references to account data remain valid for the duration of an instruction, preventing issues like use-after-free errors. This specification details the role of the `'info` lifetime in the `route` function, `AdapterContext`, `DexAdapter` trait, and `Route` struct within the `swap_processor` module.

## `AdapterContext<'info>` Structure

The `AdapterContext` struct is used to pass account information to adapter implementations for executing swaps.

```rust
#[derive(Clone)]
pub struct AdapterContext<'info> {
    pub token_program: AccountInfo<'info>,
    pub authority: AccountInfo<'info>,
    pub input_account: AccountInfo<'info>,
    pub output_account: AccountInfo<'info>,
    pub remaining_accounts: &'info [AccountInfo<'info>],
}
```

### Lifetime Explanation
- **`'info` Lifetime**: The `'info` lifetime ensures that all fields in `AdapterContext` live at least as long as the structure itself. This lifetime is tied to the instruction's execution scope.
- **`AccountInfo<'info>`**: Each `AccountInfo` field contains metadata (e.g., public key, owner, lamports) with references to account data that must remain valid for the `'info` lifetime.
- **`&'info [AccountInfo<'info>]`**: The `remaining_accounts` field is a slice reference to a list of `AccountInfo` instances, where both the slice and its elements are bound to the `'info` lifetime. This ensures the slice and its account data remain valid during the instruction.

## `DexAdapter` Trait and Lifetime Usage

The `DexAdapter` trait defines methods for validating and executing swaps, both of which use the `'info` lifetime.

```rust
pub trait DexAdapter {
    fn execute_swap<'info>(
        &self,
        ctx: AdapterContext<'info>,
        amount: u64,
        remaining_accounts_start_index: usize,
    ) -> Result<SwapResult>;
    
    fn validate_accounts<'info>(
        &self,
        ctx: AdapterContext<'info>,
        remaining_accounts_start_index: usize,
    ) -> Result<()>;
}
```

### Lifetime Transmission
- **Generic Lifetime Parameter**: Each method declares its own `'info` lifetime parameter, allowing flexibility in the scope of references passed to it. This ensures that each method call can operate within its own lifetime context.
- **Ownership Transfer**: The `AdapterContext<'info>` is passed by value (moved) into these methods, transferring ownership. The methods use the references within `AdapterContext` (e.g., `remaining_accounts`) without owning the underlying account data, which remains valid for the `'info` lifetime.

## Analysis of `route` Function and `Context`

The `route` function is the core of the swap processing logic, orchestrating token swaps through multiple adapters.

```rust
pub fn route<'info>(
    ctx: Context<'_, '_, 'info, 'info, Route<'info>>,
    // ... other parameters
) -> Result<u64>
```

### Lifetime Parameters in `Context`
- **Signature Breakdown**: The `Context<'_, '_, 'info, 'info, Route<'info>>` uses two elided lifetimes (`'_`) for Anchor's internal purposes (e.g., account validation) and two `'info` lifetimes for accounts and `remaining_accounts`, respectively.
- **Route Struct**: The `Route<'info>` struct ties all account references to the `'info` lifetime, ensuring they remain valid throughout the function.

### Creation of `AdapterContext`
In the `route` function's loop, a new `AdapterContext` is created for each swap step:

```rust
let adapter_ctx = AdapterContext {
    token_program: token_program_info.clone(),
    authority: authority_info.clone(),
    input_account,
    output_account,
    remaining_accounts: ctx.remaining_accounts,
};
```

### Lifetime Transmission Mechanics
1. **`ctx.remaining_accounts`**: This is a slice of type `&'info [AccountInfo<'info>]`, shared across all iterations of the loop. The `'info` lifetime ensures the slice and its account data remain valid.
2. **Cloning `AccountInfo`**: Fields like `token_program_info` and `authority_info` are cloned, creating new `AccountInfo` instances. These clones copy metadata (e.g., public key, owner) but retain the `'info` lifetime for their internal data references.
3. **Assignment to `AdapterContext`**: The `remaining_accounts` field is assigned directly from `ctx.remaining_accounts`, inheriting the `'info` lifetime. This ensures that the slice reference remains valid without copying the underlying account data.

## Ownership Transfer in the Loop

The `route` function's loop creates and uses `AdapterContext` instances, managing ownership carefully:

```rust
for step in &route_plan {
    // ... other code ...
    let adapter_ctx = AdapterContext { /* ... */ };
    adapter.validate_accounts(adapter_ctx.clone(), step.input_index as usize + 1)?;
    let swap_result = adapter.execute_swap(adapter_ctx, step_amount, step.input_index as usize + 1)?;
    // ... rest of the loop ...
}
```

### Ownership Analysis
1. **Creation**: A new `AdapterContext` is created in each iteration, owning its metadata copies and a reference to `ctx.remaining_accounts`.
2. **Cloning for Validation**: The `adapter_ctx.clone()` call creates a copy of `AdapterContext` for `validate_accounts`, preserving the original for the subsequent `execute_swap` call. The clone copies metadata, but the `remaining_accounts` reference remains a pointer to the same slice.
3. **Moving to `execute_swap`**: The `adapter_ctx` is moved into `execute_swap`, transferring ownership. After this call, `adapter_ctx` is no longer accessible in the loop. The `execute_swap` function uses the references within `AdapterContext` (bound to `'info`) and destroys the `AdapterContext` struct upon completion, but the underlying account data remains valid.
4. **End of Iteration**: Each iteration creates a fresh `AdapterContext`, ensuring no overlap or reuse of moved instances. The `ctx.remaining_accounts` slice is shared across iterations, with the `'info` lifetime guaranteeing its validity.

### Memory Layout
```
Stack frame for iteration N:
├── adapter_ctx (owns metadata copies)
│   ├── token_program: AccountInfo (metadata copy)
│   ├── authority: AccountInfo (metadata copy)  
│   ├── input_account: AccountInfo (metadata copy)
│   ├── output_account: AccountInfo (metadata copy)
│   └── remaining_accounts: &[AccountInfo] ──┐
│                                            │
└── References to heap data:                 │
    └── ctx.remaining_accounts ←─────────────┘
        (shared across all iterations)
```

## `Route<'info>` Struct and Annotations

The `Route` struct defines the accounts required for the `route` function:

```rust
#[derive(Accounts)]
pub struct Route<'info> {
    pub adapter_registry: Account<'info, AdapterRegistry>,
    pub token_program: Program<'info, Token>,
    pub user_transfer_authority: Signer<'info>,
    // ... other fields
}
```

### Role of Lifetime
- **Account References**: Each field (`Account<'info, T>`, `Program<'info, T>`, `Signer<'info>`) is tied to the `'info` lifetime, ensuring that references to account data remain valid during instruction execution.
- **Anchor Management**: Anchor automatically deserializes and validates accounts, respecting the `'info` lifetime to prevent invalid references.
- **Remaining Accounts**: The `ctx.remaining_accounts` slice (`&'info [AccountInfo<'info>]`) is used by `AdapterContext`, ensuring consistent lifetime constraints across all components.

## Lifetime in `execute_swap`

The `execute_swap` method in the `DexAdapter` trait uses the `'info` lifetime:

```rust
fn execute_swap<'info>(
    &self,
    ctx: AdapterContext<'info>,
    amount: u64,
    remaining_accounts_start_index: usize,
) -> Result<SwapResult>;
```

### Lifetime and Ownership
- **Generic Lifetime**: The `'info` lifetime is a generic parameter, meaning the method does not own the account data but uses references valid for the `'info` lifetime.
- **Ownership Transfer**: The `AdapterContext` is moved into `execute_swap`, making the method the temporary owner of the struct. The struct's fields (e.g., `remaining_accounts`) are used without copying the underlying account data.
- **Destruction**: At the end of `execute_swap`, the `AdapterContext` struct is destroyed, but the account data it referenced remains valid until the `route` function's `ctx` goes out of scope.

### Lifetime Scope
```
ctx: Context<Route<'info>>  ┌─────────────────────────────────────┐
├─ remaining_accounts       │ Entire route() instruction         │
├─ user_source_token_account│                                   │  
├─ user_destination_...     │                                   │
└─ other accounts           │                                   │
                            │                                   │
    adapter_ctx created ────┤                                   │
    ├─ references to data ──┼─ execute_swap() ┐                │
    └─ metadata             │                 │ Method duration │
                            │                 ┘                │
    adapter_ctx dropped ────┤                                   │
                            │                                   │
                            └─────────────────────────────────────┘
```

## Safety and Guarantees

### Compile-Time Checks
The Rust compiler ensures:
1. All references in `AdapterContext` and `Route` live at least as long as the `'info` lifetime.
2. `remaining_accounts` cannot be used after `ctx` goes out of scope.
3. No dangling references to account data can be created.

### Anchor-Specific Guarantees
Anchor provides:
1. Automatic deserialization of accounts with correct lifetime management.
2. Validation of account constraints before function execution.
3. Automatic resource cleanup after the instruction completes.

## Conclusion
The `'info` lifetime is essential for memory safety in Solana programs using Anchor. It ensures that all account references remain valid during instruction execution, preventing memory-related errors. In the `route` function, the `'info` lifetime ties `AdapterContext` and `Route` to the instruction's scope, with ownership of `AdapterContext` managed carefully in each loop iteration. The use of cloning for metadata and shared references for `remaining_accounts` optimizes memory usage while maintaining safety. Anchor's integration with Rust's lifetime system provides a robust and ergonomic API for developing secure smart contracts.