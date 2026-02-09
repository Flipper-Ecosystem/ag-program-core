# Алгоритм использования инструкции `shared_route_and_create_order`

## 📋 Общая цель
Инструкция `shared_route_and_create_order` объединяет Jupiter CPI swap с созданием limit order. Это позволяет пользователю за одну транзакцию:
1. Обменять токены через Jupiter
2. Автоматически создать limit order с полученными токенами для обратного обмена

## 🔄 Схема работы

```
User Source Tokens (50 SOL)
         ↓
    Jupiter Swap
         ↓
Swap Output (75 USDT) → Order Input Vault
         ↓
   Create Limit Order
   (Wait for trigger: 5% profit)
         ↓
When triggered: USDT → SOL (52.5 SOL)
```

## 🛠️ Структура инструкции

### Основные компоненты

1. **Vault Authority** - PDA, управляющий всеми vaults
2. **Limit Order** - аккаунт заказа (создается через `init_limit_order`)
3. **User Accounts** - токен аккаунты пользователя
4. **Swap Vaults** - временные хранилища для свопа
5. **Jupiter Program** - программа для выполнения свопа через CPI

### Параметры инструкции

```rust
pub fn shared_route_and_create_order(
    order_nonce: u64,              // Уникальный идентификатор заказа
    swap_route_plan: Vec<RoutePlanStep>, // План маршрута Jupiter
    swap_in_amount: u64,           // Количество входных токенов для свопа
    swap_quoted_out_amount: u64,   // Ожидаемое количество выходных токенов
    swap_slippage_bps: u16,        // Допустимое проскальзывание для свопа (0.5% = 50 bps)
    platform_fee_bps: u8,          // Комиссия платформы (0.5% = 50)
    order_min_output_amount: u64,  // Минимальное количество токенов для заказа
    order_trigger_price_bps: u32,  // Триггерная цена (5% = 500 bps)
    order_expiry: i64,             // Время истечения заказа (Unix timestamp)
    order_slippage_bps: u16,       // Допустимое проскальзывание для заказа
) -> Result<(u64, Pubkey)>
```

## 📝 Пошаговая инструкция

### Шаг 1: Инициализация limit order аккаунта

Перед вызовом `shared_route_and_create_order` необходимо инициализировать limit order:

```typescript
const orderNonce = new BN(Date.now());

// Derive limit order PDA
const [limitOrder] = PublicKey.findProgramAddressSync(
    [
        Buffer.from("limit_order"),
        user.publicKey.toBuffer(),
        orderNonce.toArrayLike(Buffer, "le", 8),
    ],
    program.programId
);

// Derive order vault PDA (будет хранить токены свопа)
const [orderVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("order_vault"), limitOrder.toBuffer()],
    program.programId
);

// Инициализация limit order аккаунта
await program.methods
    .initLimitOrder(orderNonce, 0) // 0 = стандартный размер, 14 для Token-2022 с расширениями
    .accounts({
        vaultAuthority,
        limitOrder,
        inputVault: orderVault,
        inputMint: destinationMint, // Mint токенов, которые будут получены из свопа
        inputTokenProgram: TOKEN_PROGRAM_ID,
        creator: user.publicKey,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .signers([user])
    .rpc();
```

### Шаг 2: Подготовка параметров

```typescript
// Параметры свопа
const swapInAmount = new BN(50_000_000); // 50 SOL (6 decimals)
const swapQuotedOutAmount = new BN(75_000_000); // 75 USDT (ожидаемый выход)
const swapSlippageBps = 50; // 0.5% проскальзывание
const platformFeeBps = 0; // 0% комиссия (или любое значение)

// Параметры limit order
const orderMinOutputAmount = new BN(50_000_000); // Минимум 50 SOL обратно
const orderTriggerPriceBps = 500; // Триггер при 5% прибыли (75 USDT → 52.5 SOL)
const orderExpiry = new BN(Math.floor(Date.now() / 1000) + 3600); // 1 час
const orderSlippageBps = 100; // 1% проскальзывание для выполнения заказа

// Route plan для Jupiter
const routePlan = [
    {
        swap: { raydium: {} }, // Тип свопа (в примере Raydium)
        percent: 100,          // Использовать 100% входных токенов
        inputIndex: 0,         // Индекс входного vault в remainingAccounts
        outputIndex: 1,        // Индекс выходного vault в remainingAccounts
    }
];
```

### Шаг 3: Подготовка remaining accounts для Jupiter

```typescript
// Получить список аккаунтов для Jupiter swap
// Это может включать liquidity pools, oracles и другие DEX-специфичные аккаунты
const jupiterAccounts = [
    { pubkey: liquidityPool, isSigner: false, isWritable: true },
    { pubkey: poolAuthority, isSigner: false, isWritable: false },
    // ... другие аккаунты необходимые для Jupiter
];
```

### Шаг 4: Выполнение инструкции

```typescript
const result = await program.methods
    .sharedRouteAndCreateOrder(
        orderNonce,
        routePlan,
        swapInAmount,
        swapQuotedOutAmount,
        swapSlippageBps,
        platformFeeBps,
        orderMinOutputAmount,
        orderTriggerPriceBps,
        orderExpiry,
        orderSlippageBps
    )
    .accounts({
        vaultAuthority,
        limitOrder,
        userInputAccount: userSourceTokenAccount,      // Откуда берутся SOL для свопа
        userDestinationAccount: userSourceTokenAccount, // Куда придут SOL после выполнения заказа
        swapSourceVault: sourceVault,                  // Vault для входных токенов (SOL)
        swapDestinationVault: orderVault,              // Vault для выходных токенов (USDT) = input vault заказа
        swapInputMint: sourceMint,                     // SOL mint
        swapOutputMint: destinationMint,               // USDT mint
        inputTokenProgram: TOKEN_PROGRAM_ID,
        outputTokenProgram: TOKEN_PROGRAM_ID,
        platformFeeAccount: null,                      // Или аккаунт для комиссии
        jupiterProgram: jupiterProgramId,              // Jupiter V6 program ID
        creator: user.publicKey,
        systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(jupiterAccounts)
    .signers([user])
    .rpc();

console.log("✅ Swap completed and limit order created");
console.log("Transaction:", result);
```

## 🔍 Что происходит внутри инструкции

### Этап 1: Валидация параметров
- Проверка всех входных параметров
- Проверка, что limit order в статусе `Init`
- Проверка, что destination vault соответствует input vault заказа

### Этап 2: Перевод токенов от пользователя в vault
```rust
// User Source Account → Swap Source Vault
transfer_checked(swap_in_amount)
```

### Этап 3: Выполнение Jupiter CPI свопа
```rust
// Swap Source Vault → Swap Destination Vault (через Jupiter)
invoke_signed(jupiter_route_instruction)
```

### Этап 4: Сбор комиссии платформы (если указана)
```rust
// Swap Destination Vault → Platform Fee Account
transfer_checked(fee_amount)
```

### Этап 5: Проверка проскальзывания
```rust
require!(swap_output >= min_acceptable_output)
```

### Этап 6: Создание limit order
```rust
// Обновление параметров limit order
order.input_mint = swap_output_mint;     // USDT
order.output_mint = swap_input_mint;     // SOL (обратный обмен)
order.input_amount = swap_output_amount; // Токены в vault
order.status = OrderStatus::Open;        // Заказ активен
```

### Этап 7: Эмиссия событий
```rust
emit_cpi!(RouterSwapEvent { ... });
emit_cpi!(LimitOrderCreated { ... });
emit_cpi!(RouteAndCreateOrderEvent { ... });
```

## 📊 Пример использования

```typescript
// 1. SOL → USDT через Jupiter
// 2. Создать limit order: USDT → SOL с 5% прибылью

const orderNonce = new BN(Date.now());
const swapAmount = new BN(50_000_000); // 50 SOL

// Инициализация limit order
await initLimitOrder(orderNonce, destinationMint);

// Выполнение swap + создание заказа
await program.methods
    .sharedRouteAndCreateOrder(
        orderNonce,
        routePlan,
        swapAmount,
        new BN(75_000_000),  // Ожидаем 75 USDT
        50,                  // 0.5% slippage для swap
        0,                   // 0% комиссия
        new BN(50_000_000),  // Минимум 50 SOL обратно
        500,                 // Триггер на 5% прибыли
        expiry,
        100                  // 1% slippage для order
    )
    .accounts({ ... })
    .remainingAccounts(jupiterAccounts)
    .signers([user])
    .rpc();

// Результат:
// - 50 SOL → 75 USDT (через Jupiter)
// - Создан limit order: 75 USDT → SOL (выполнится при триггере)
```

## ⚠️ Важные замечания

### Требования
1. **Limit order должен быть инициализирован** через `init_limit_order` перед вызовом
2. **Статус limit order должен быть Init** (не Open, не Filled, не Cancelled)
3. **Swap destination vault = Order input vault** (один и тот же аккаунт)
4. **User input account** должен иметь достаточно токенов для свопа
5. **Jupiter accounts** должны быть корректно указаны в remainingAccounts

### Ограничения
- `swap_slippage_bps` ≤ 10,000 (100%)
- `order_trigger_price_bps` > 0 и ≤ 100,000 (1000%)
- `order_slippage_bps` ≤ 10,000 (100%)
- `order_expiry` > текущее время
- Всегда создается `TakeProfit` заказ (для обратного обмена с прибылью)

### Ошибки
- `InvalidOrderStatus` - limit order не в статусе Init
- `InvalidTriggerPrice` - некорректная триггерная цена (0 или > 100,000)
- `InvalidSlippage` - проскальзывание превышает 100%
- `InvalidExpiry` - время истечения в прошлом
- `InvalidVaultAddress` - destination vault не совпадает с order input vault
- `SlippageToleranceExceeded` - реальное проскальзывание превысило допустимое

## 🎯 Преимущества

1. **Атомарность** - swap и создание заказа в одной транзакции
2. **Автоматизация** - не нужно вручную создавать заказ после свопа
3. **Безопасность** - токены сразу защищены в vault до выполнения заказа
4. **Эффективность** - экономия на комиссиях (одна транзакция вместо двух)
5. **Гибкость** - поддержка любых токенов (SPL Token и Token-2022)

## 🔗 Связанные инструкции

- `init_limit_order` - инициализация limit order аккаунта
- `shared_route` - простой swap через Jupiter без создания заказа
- `shared_execute_limit_order` - выполнение заказа через Jupiter CPI
- `cancel_limit_order` - отмена заказа пользователем

## 📚 Дополнительные ресурсы

- Jupiter V6 Documentation: https://station.jup.ag/docs/apis/swap-api
- Flipper Program: `fLpRcgQSJxKeeUogb6M7bWe1iyYQbahjGXGwr4HgHit`
- Тесты: `tests/07. shared_jupiter_instructions.ts`
