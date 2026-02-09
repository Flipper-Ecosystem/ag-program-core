# Примеры использования скриптов управления ALT и операторами

Этот файл содержит практические примеры использования скриптов для типичных сценариев.

---

## Сценарий 1: Передача всех прав новому оператору

### Ситуация
Вы хотите полностью передать управление другому оператору, включая:
- Права оператора в adapter registry
- Все Address Lookup Tables

### Шаги

**Шаг 1: Проверьте текущую ситуацию**
```bash
# Просмотрите все ALT, принадлежащие вам
npx ts-node scripts/mainnet/list_alt.ts
```

Вывод покажет что-то вроде:
```
🔍 Searching for Address Lookup Tables owned by: YourCurrentAuthority...

✅ Found 3 Address Lookup Table(s)

📍 ALT #1: 7YfYXkg4Tpb9jMVsrRjRLjrQ6r8BvCxTFfKqb7jMSvmE
   Authority: YourCurrentAuthority
   Addresses count: 42
   ...
```

**Шаг 2: Замените оператора в registry**
```bash
OLD_OPERATOR_PUBKEY=YourCurrentOperator \
NEW_OPERATOR_PUBKEY=NewOperatorPublicKey \
npx ts-node scripts/mainnet/replace_operator.ts
```

Ожидаемый результат:
```
✅ Old operator removed successfully!
✅ New operator added successfully!
🎉 Operator replacement completed successfully!
```

**Шаг 3: Передайте все ALT новому authority**
```bash
NEW_AUTHORITY_PUBKEY=NewOperatorPublicKey \
npx ts-node scripts/mainnet/transfer_alt_authority.ts
```

Ожидаемый результат:
```
📊 Transfer Summary:
   Total ALTs processed: 3
   ✅ Successfully transferred: 3
   ⚠️  Skipped (frozen): 0
   ❌ Failed: 0

🎉 All Address Lookup Table authorities transferred successfully!
```

---

## Сценарий 2: Передача только некоторых ALT

### Ситуация
У вас несколько ALT, но вы хотите передать только некоторые из них.

### Шаги

**Шаг 1: Получите список всех ALT**
```bash
npx ts-node scripts/mainnet/list_alt.ts
```

Скопируйте нужные адреса из вывода в конце:
```
📋 ALT addresses (comma-separated for easy copying):
7YfYXkg4Tpb9jMVsrRjRLjrQ6r8BvCxTFfKqb7jMSvmE,8ZgYnWkg5Uqc0kNWtsStKmsSmjSLkmR7sLrbYcjNTwnF,9ahZoVkg6Vrd1lOXutUuUnVxtTuSyHmNrvcscjOUwog
```

**Шаг 2: Выберите нужные адреса и передайте их**
Например, передаём только первые два:
```bash
NEW_AUTHORITY_PUBKEY=NewOperatorPublicKey \
ALT_ADDRESSES=7YfYXkg4Tpb9jMVsrRjRLjrQ6r8BvCxTFfKqb7jMSvmE,8ZgYnWkg5Uqc0kNWtsStKmsSmjSLkmR7sLrbYcjNTwnF \
npx ts-node scripts/mainnet/transfer_alt_authority_specific.ts
```

---

## Сценарий 3: Проверка ALT другого оператора

### Ситуация
Вам нужно проверить, какие ALT принадлежат другому адресу.

### Команда
```bash
TARGET_AUTHORITY=OtherOperatorPublicKey \
npx ts-node scripts/mainnet/list_alt.ts
```

---

## Сценарий 4: Добавление нового оператора без передачи ALT

### Ситуация
Вы хотите добавить нового оператора в registry, но не передавать ему ALT.

### Команда
```bash
OPERATOR_PUBKEY=NewOperatorPublicKey \
npx ts-node scripts/mainnet/add_operator.ts
```

---

## Сценарий 5: Использование интерактивного скрипта

### Ситуация
Вы предпочитаете интерактивный интерфейс вместо командной строки.

### Запуск
```bash
./scripts/mainnet/alt_manager.sh
```

Вы увидите меню:
```
═══════════════════════════════════════════════════════════
  ALT & Operator Management Tool
═══════════════════════════════════════════════════════════

Выберите операцию:

  Address Lookup Tables (ALT):
    1) Просмотреть все ALT текущего authority
    2) Просмотреть ALT конкретного адреса
    3) Передать ВСЕ ALT новому authority
    4) Передать конкретные ALT новому authority

  Управление операторами:
    5) Добавить нового оператора
    6) Удалить оператора
    7) Заменить оператора

  Другое:
    8) Показать быстрый справочник
    0) Выход

Ваш выбор:
```

---

## Типичные проблемы и их решение

### Проблема: "Table is frozen, cannot transfer authority"

**Причина**: ALT была заморожена (frozen) и её authority больше нельзя изменить.

**Решение**: Это нормальное поведение. Скрипт автоматически пропустит такую таблицу. Если вам нужно управлять адресами в этой таблице, вам придётся создать новую ALT.

### Проблема: "Authority mismatch"

**Причина**: Текущий authority ALT не совпадает с вашим keypair.

**Решение**: Убедитесь, что:
1. Вы используете правильный keypair файл
2. ALT действительно принадлежит этому authority
3. ALT не была передана кому-то другому ранее

### Проблема: "Operator already exists"

**Причина**: Оператор уже есть в registry.

**Решение**: Это информационное сообщение. Скрипт не будет добавлять дубликат. Если нужно заменить оператора, используйте `replace_operator.ts`.

### Проблема: "Insufficient SOL balance"

**Причина**: Недостаточно SOL для оплаты транзакций.

**Решение**: Пополните баланс authority аккаунта. Каждая транзакция требует ~0.001-0.01 SOL.

---

## Автоматизация с помощью bash скриптов

Вы можете создать собственные bash скрипты для автоматизации:

### Пример: Полная передача прав
```bash
#!/bin/bash

# transfer_all_rights.sh
NEW_OPERATOR="9dKLmNpvXZfGkjRt3Hq7YzLpMnUwZxEaBcRfTyGhJkWs"
OLD_OPERATOR="8cJXGoV8FCwNqbcjstCiAxdW3miy2xsBvuXSn3s64GrG"

echo "🚀 Starting full rights transfer..."

# Шаг 1: Замена оператора
echo "Step 1: Replacing operator..."
OLD_OPERATOR_PUBKEY=$OLD_OPERATOR \
NEW_OPERATOR_PUBKEY=$NEW_OPERATOR \
npx ts-node scripts/mainnet/replace_operator.ts

if [ $? -ne 0 ]; then
    echo "❌ Operator replacement failed!"
    exit 1
fi

# Шаг 2: Передача ALT
echo "Step 2: Transferring ALT..."
NEW_AUTHORITY_PUBKEY=$NEW_OPERATOR \
npx ts-node scripts/mainnet/transfer_alt_authority.ts

if [ $? -ne 0 ]; then
    echo "❌ ALT transfer failed!"
    exit 1
fi

echo "✅ Full rights transfer completed!"
```

Использование:
```bash
chmod +x transfer_all_rights.sh
./transfer_all_rights.sh
```

---

## Полезные команды для проверки

### Проверить баланс authority
```bash
solana balance ~/.config/solana/fpp-staging.json --url mainnet-beta
```

### Посмотреть информацию об ALT в explorer
```bash
# Откройте в браузере:
https://explorer.solana.com/address/<ALT_ADDRESS>?cluster=mainnet
```

### Проверить текущую сеть
```bash
solana config get
```

### Переключиться на mainnet (если нужно)
```bash
solana config set --url mainnet-beta
```

---

## Рекомендации по безопасности

1. **Всегда проверяйте адреса** перед выполнением операций
2. **Делайте backup** keypair файлов
3. **Тестируйте на devnet** если возможно
4. **Записывайте transaction signatures** для истории
5. **Проверяйте results** после каждой операции
6. **Используйте hardware wallets** для critical operations

---

## Дополнительные ресурсы

- [Официальная документация Solana по ALT](https://docs.solana.com/developing/lookup-tables)
- [Anchor Framework Documentation](https://www.anchor-lang.com/)
- [Solana Explorer](https://explorer.solana.com/)
- [Solscan](https://solscan.io/)
