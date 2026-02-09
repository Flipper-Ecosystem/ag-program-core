# Быстрый справочник команд для работы с операторами и ALT

## Управление операторами в Adapter Registry

### Добавить нового оператора
```bash
OPERATOR_PUBKEY=8cJXGoV8FCwNqbcjstCiAxdW3miy2xsBvuXSn3s64GrG \
npx ts-node scripts/mainnet/add_operator.ts
```

### Удалить оператора
```bash
OPERATOR_PUBKEY=8cJXGoV8FCwNqbcjstCiAxdW3miy2xsBvuXSn3s64GrG \
npx ts-node scripts/mainnet/remove_operator.ts
```

### Заменить оператора
```bash
OLD_OPERATOR_PUBKEY=8cJXGoV8FCwNqbcjstCiAxdW3miy2xsBvuXSn3s64GrG \
NEW_OPERATOR_PUBKEY=9dKLmNpvXZfGkjRt3Hq7YzLpMnUwZxEaBcRfTyGhJkWs \
npx ts-node scripts/mainnet/replace_operator.ts
```

---

## Управление Address Lookup Tables (ALT)

### Просмотреть все ALT текущего authority
```bash
npx ts-node scripts/mainnet/list_alt.ts
```

### Просмотреть ALT конкретного адреса
```bash
TARGET_AUTHORITY=9dKLmNpvXZfGkjRt3Hq7YzLpMnUwZxEaBcRfTyGhJkWs \
npx ts-node scripts/mainnet/list_alt.ts
```

### Передать ВСЕ ALT новому оператору
```bash
NEW_AUTHORITY_PUBKEY=9dKLmNpvXZfGkjRt3Hq7YzLpMnUwZxEaBcRfTyGhJkWs \
npx ts-node scripts/mainnet/transfer_alt_authority.ts
```

### Передать конкретные ALT новому оператору
```bash
NEW_AUTHORITY_PUBKEY=9dKLmNpvXZfGkjRt3Hq7YzLpMnUwZxEaBcRfTyGhJkWs \
ALT_ADDRESSES=7YfYXkg4Tpb9jMVsrRjRLjrQ6r8BvCxTFfKqb7jMSvmE,8ZgYnWkg5Uqc0kNWtsStKmsSmjSLkmR7sLrbYcjNTwnF \
npx ts-node scripts/mainnet/transfer_alt_authority_specific.ts
```

---

## Полный процесс передачи прав

### Вариант 1: Полная передача (операторы + все ALT)

```bash
# 1. Проверить текущие ALT
npx ts-node scripts/mainnet/list_alt.ts

# 2. Заменить оператора в registry
OLD_OPERATOR_PUBKEY=<старый_оператор> \
NEW_OPERATOR_PUBKEY=<новый_оператор> \
npx ts-node scripts/mainnet/replace_operator.ts

# 3. Передать все ALT
NEW_AUTHORITY_PUBKEY=<новый_authority> \
npx ts-node scripts/mainnet/transfer_alt_authority.ts
```

### Вариант 2: Выборочная передача ALT

```bash
# 1. Проверить все ALT и выбрать нужные
npx ts-node scripts/mainnet/list_alt.ts

# 2. Передать только выбранные ALT
NEW_AUTHORITY_PUBKEY=<новый_authority> \
ALT_ADDRESSES=<адрес1,адрес2> \
npx ts-node scripts/mainnet/transfer_alt_authority_specific.ts
```

---

## Проверка и верификация

### Проверить текущих операторов в registry
Запустите любой скрипт управления операторами - они всегда показывают текущее состояние:
```bash
OPERATOR_PUBKEY=любой_адрес npx ts-node scripts/mainnet/add_operator.ts
# (можно прервать после вывода текущего состояния)
```

### Проверить ALT на Solana Explorer
```
https://explorer.solana.com/address/<ALT_ADDRESS>?cluster=mainnet
```

---

## Важные замечания

⚠️ **Требования:**
- Keypair файл authority: `~/.config/solana/fpp-staging.json`
- Достаточно SOL на балансе для транзакций
- Только authority может управлять операторами и ALT

⚠️ **Ограничения:**
- Замороженные ALT (frozen) нельзя передать - они пропускаются автоматически
- Каждая операция с ALT = отдельная транзакция
- При ошибке скрипт продолжает работу с остальными элементами

⚠️ **Безопасность:**
- Все операции выполняются на mainnet
- Проверяйте адреса перед выполнением
- Храните keypair в безопасности
- Скрипты автоматически верифицируют результаты
