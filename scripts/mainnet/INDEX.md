# Mainnet Scripts - Навигация

Добро пожаловать в директорию mainnet скриптов! Этот файл поможет вам быстро найти нужную документацию или скрипт.

## 🚀 Быстрый старт

**🔴 ПЕРВЫЙ ДЕПЛОЙ?** Начните здесь:
1. **КРИТИЧЕСКИ ВАЖНО:** Прочитайте [INITIALIZATION_GUIDE.md](INITIALIZATION_GUIDE.md)
2. Создайте Global Manager (сделайте это ПЕРВЫМ!)
3. Создайте Vault Authority
4. Инициализируйте Adapter Registry

**Новичок в управлении операторами?** Начните здесь:
1. Прочитайте [QUICK_REFERENCE.md](QUICK_REFERENCE.md) - 5 минут
2. Запустите `./alt_manager.sh` для интерактивного режима
3. При необходимости, см. [EXAMPLES.md](EXAMPLES.md) для практических примеров

**Опытный пользователь?** 
- [INITIALIZATION_GUIDE.md](INITIALIZATION_GUIDE.md) - полное руководство по инициализации
- [QUICK_REFERENCE.md](QUICK_REFERENCE.md) - все команды на одной странице
- [README_OPERATORS.md](README_OPERATORS.md) - полная документация

## 📁 Структура файлов

### 🔵 Документация (читайте в этом порядке)

| Файл | Описание | Когда читать |
|------|----------|--------------|
| 🔴 [INITIALIZATION_GUIDE.md](INITIALIZATION_GUIDE.md) | **Полное руководство по инициализации** | **ПЕРЕД первым деплоем!** |
| [QUICK_REFERENCE.md](QUICK_REFERENCE.md) | Краткий справочник команд | Первым делом |
| [EXAMPLES.md](EXAMPLES.md) | Практические примеры | Для конкретных задач |
| [README_OPERATORS.md](README_OPERATORS.md) | Полная документация | Для детального понимания |
| [ALT_TRANSFER_SUMMARY.md](ALT_TRANSFER_SUMMARY.md) | Техническая документация | Для разработчиков |
| [INDEX.md](INDEX.md) | Этот файл | Для навигации |

### 🟢 Скрипты для Address Lookup Tables (ALT)

| Скрипт | Назначение | Параметры |
|--------|------------|-----------|
| `list_alt.ts` | Просмотр всех ALT | `TARGET_AUTHORITY` (опц.) |
| `transfer_alt_authority.ts` | Передача всех ALT | `NEW_AUTHORITY_PUBKEY` |
| `transfer_alt_authority_specific.ts` | Передача конкретных ALT | `NEW_AUTHORITY_PUBKEY`, `ALT_ADDRESSES` |

### 🟡 Скрипты для управления операторами

| Скрипт | Назначение | Параметры |
|--------|------------|-----------|
| `add_operator.ts` | Добавить оператора | `OPERATOR_PUBKEY` |
| `remove_operator.ts` | Удалить оператора | `OPERATOR_PUBKEY` |
| `replace_operator.ts` | Заменить оператора | `OLD_OPERATOR_PUBKEY`, `NEW_OPERATOR_PUBKEY` |

### 🔴 Интерактивный UI

| Скрипт | Назначение | Использование |
|--------|------------|---------------|
| `alt_manager.sh` | Меню для всех операций | `./alt_manager.sh` |

### 🔴 Скрипты инициализации (КРИТИЧНО для первого деплоя!)

| Скрипт | Назначение | Параметры |
|--------|------------|-----------|
| `create_global_manager.ts` | Создание Global Manager | `MANAGER_PUBKEY` (опц.) |
| `change_global_manager.ts` | Изменение Global Manager | `NEW_MANAGER_PUBKEY` |
| `create_vault_authority.ts` | Создание Vault Authority | `ADMIN_PUBKEY` (опц.) |

### ⚪ Другие скрипты

| Скрипт | Назначение |
|--------|------------|
| `initialize_adapter_registry.ts` | Инициализация adapter registry |
| `register_adapters.ts` | Регистрация адаптеров |
| `test_whirlpool_multihop.ts` | Тест Whirlpool routing |
| `test_meteora_route.ts` | Тест Meteora routing |

## 🎯 Найти решение для задачи

### Я хочу...

#### ...развернуть протокол в первый раз (НАЧНИТЕ ЗДЕСЬ!)
```bash
# Шаг 1: Создать Global Manager (СРАЗУ после деплоя!)
MANAGER_PUBKEY=<your_multisig> ts-node scripts/mainnet/create_global_manager.ts

# Шаг 2: Создать Vault Authority
ADMIN_PUBKEY=<your_multisig> ts-node scripts/mainnet/create_vault_authority.ts

# Шаг 3: Инициализировать Adapter Registry
OPERATOR_PUBKEY=<operator> ts-node scripts/mainnet/initialize_adapter_registry.ts

# Шаг 4: Зарегистрировать адаптеры
ts-node scripts/mainnet/register_adapters.ts
```
📖 См. [INITIALIZATION_GUIDE.md](INITIALIZATION_GUIDE.md) для полного руководства

#### ...изменить Global Manager на multisig
```bash
NEW_MANAGER_PUBKEY=<multisig_address> ts-node scripts/mainnet/change_global_manager.ts
```
📖 См. [INITIALIZATION_GUIDE.md](INITIALIZATION_GUIDE.md) § Change Global Manager

#### ...просмотреть мои ALT
```bash
npx ts-node scripts/mainnet/list_alt.ts
```
📖 См. [EXAMPLES.md](EXAMPLES.md) § Сценарий 1

#### ...передать все ALT другому оператору
```bash
NEW_AUTHORITY_PUBKEY=<address> npx ts-node scripts/mainnet/transfer_alt_authority.ts
```
📖 См. [EXAMPLES.md](EXAMPLES.md) § Сценарий 1

#### ...передать только некоторые ALT
```bash
NEW_AUTHORITY_PUBKEY=<address> ALT_ADDRESSES=<addr1,addr2> \
  npx ts-node scripts/mainnet/transfer_alt_authority_specific.ts
```
📖 См. [EXAMPLES.md](EXAMPLES.md) § Сценарий 2

#### ...добавить нового оператора
```bash
OPERATOR_PUBKEY=<address> npx ts-node scripts/mainnet/add_operator.ts
```
📖 См. [README_OPERATORS.md](README_OPERATORS.md) § add_operator

#### ...заменить оператора
```bash
OLD_OPERATOR_PUBKEY=<old> NEW_OPERATOR_PUBKEY=<new> \
  npx ts-node scripts/mainnet/replace_operator.ts
```
📖 См. [README_OPERATORS.md](README_OPERATORS.md) § replace_operator

#### ...использовать интерактивный интерфейс
```bash
./scripts/mainnet/alt_manager.sh
```
📖 См. [EXAMPLES.md](EXAMPLES.md) § Сценарий 5

#### ...полностью передать проект другому оператору
```bash
# Шаг 1: Просмотр
npx ts-node scripts/mainnet/list_alt.ts

# Шаг 2: Замена оператора
OLD_OPERATOR_PUBKEY=<old> NEW_OPERATOR_PUBKEY=<new> \
  npx ts-node scripts/mainnet/replace_operator.ts

# Шаг 3: Передача ALT
NEW_AUTHORITY_PUBKEY=<new> npx ts-node scripts/mainnet/transfer_alt_authority.ts
```
📖 См. [EXAMPLES.md](EXAMPLES.md) § Сценарий 1

## 🔧 Troubleshooting

### Проблема с выполнением скрипта?

1. **Проверьте требования:**
   - Keypair файл: `~/.config/solana/fpp-staging.json`
   - Достаточно SOL на балансе
   - Node.js установлен

2. **Частые ошибки:**
   - `Keypair file not found` → Проверьте путь к keypair
   - `Insufficient balance` → Пополните SOL
   - `Table is frozen` → Это нормально, таблица пропускается

3. **Полный список проблем:**
   📖 См. [README_OPERATORS.md](README_OPERATORS.md) § Troubleshooting

### Нужна помощь?

1. Проверьте [EXAMPLES.md](EXAMPLES.md) - возможно, там есть ваш случай
2. Прочитайте [README_OPERATORS.md](README_OPERATORS.md) § Troubleshooting
3. Проверьте логи скрипта на предмет ошибок

## 📊 Карта функционала

```
mainnet/
│
├── 📖 Документация
│   ├── QUICK_REFERENCE.md ─────► Быстрые команды
│   ├── EXAMPLES.md ────────────► Практические примеры
│   ├── README_OPERATORS.md ────► Полное руководство
│   ├── ALT_TRANSFER_SUMMARY.md ► Техническая документация
│   └── INDEX.md (этот файл) ───► Навигация
│
├── 🔧 ALT Management
│   ├── list_alt.ts ────────────► Просмотр
│   ├── transfer_alt_authority.ts ──────────► Передача всех
│   └── transfer_alt_authority_specific.ts ─► Передача выборочно
│
├── 👥 Operator Management
│   ├── add_operator.ts ────────► Добавить
│   ├── remove_operator.ts ─────► Удалить
│   └── replace_operator.ts ────► Заменить
│
├── 🎮 Interactive UI
│   └── alt_manager.sh ─────────► Меню
│
└── 🧪 Other Scripts
    ├── initialize_adapter_registry.ts
    ├── register_adapters.ts
    └── test_*.ts
```

## 🎓 Обучение

### Уровень 1: Новичок (15 минут)
1. Прочитайте [QUICK_REFERENCE.md](QUICK_REFERENCE.md)
2. Запустите `./alt_manager.sh`
3. Выберите опцию 1 (Просмотр ALT)

### Уровень 2: Пользователь (30 минут)
1. Прочитайте [EXAMPLES.md](EXAMPLES.md)
2. Попробуйте команды из примеров
3. Изучите вывод скриптов

### Уровень 3: Эксперт (1+ час)
1. Прочитайте [README_OPERATORS.md](README_OPERATORS.md)
2. Прочитайте [ALT_TRANSFER_SUMMARY.md](ALT_TRANSFER_SUMMARY.md)
3. Изучите исходный код скриптов

## 🔗 Быстрые ссылки

### Проверка в blockchain
- [Solana Explorer](https://explorer.solana.com/?cluster=mainnet)
- [Solscan](https://solscan.io/)

### Внешняя документация
- [Solana ALT Documentation](https://docs.solana.com/developing/lookup-tables)
- [Anchor Framework](https://www.anchor-lang.com/)

### Проверка баланса
```bash
solana balance ~/.config/solana/fpp-staging.json --url mainnet-beta
```

## 📝 Чеклист перед использованием

- [ ] Keypair файл существует: `~/.config/solana/fpp-staging.json`
- [ ] Достаточно SOL на балансе (проверить командой выше)
- [ ] Знаю адрес нового authority/оператора
- [ ] Прочитал QUICK_REFERENCE.md
- [ ] Понимаю, что делаю (это mainnet!)

## ⚠️ Важные напоминания

1. **Все операции на mainnet** - будьте осторожны!
2. **Проверяйте адреса** перед выполнением
3. **Сохраняйте transaction signatures** для истории
4. **Замороженные ALT** нельзя передать (это нормально)
5. **Скрипты верифицируют** результаты автоматически

---

**Готовы начать?** Откройте [QUICK_REFERENCE.md](QUICK_REFERENCE.md) или запустите `./alt_manager.sh`! 🚀
