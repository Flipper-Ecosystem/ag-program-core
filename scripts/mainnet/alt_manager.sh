#!/bin/bash

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Путь к скриптам
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Функция для вывода заголовка
print_header() {
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo ""
}

# Функция для вывода ошибки
print_error() {
    echo -e "${RED}❌ Error: $1${NC}"
}

# Функция для вывода предупреждения
print_warning() {
    echo -e "${YELLOW}⚠️  Warning: $1${NC}"
}

# Функция для вывода успеха
print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

# Функция для проверки зависимостей
check_dependencies() {
    if ! command -v npx &> /dev/null; then
        print_error "npx not found. Please install Node.js and npm."
        exit 1
    fi
    
    if ! command -v ts-node &> /dev/null; then
        print_warning "ts-node not found globally. Will use npx ts-node."
    fi
}

# Показать меню
show_menu() {
    print_header "ALT & Operator Management Tool"
    echo "Выберите операцию:"
    echo ""
    echo "  ${GREEN}Address Lookup Tables (ALT):${NC}"
    echo "    1) Просмотреть все ALT текущего authority"
    echo "    2) Просмотреть ALT конкретного адреса"
    echo "    3) Передать ВСЕ ALT новому authority"
    echo "    4) Передать конкретные ALT новому authority"
    echo ""
    echo "  ${GREEN}Управление операторами:${NC}"
    echo "    5) Добавить нового оператора"
    echo "    6) Удалить оператора"
    echo "    7) Заменить оператора"
    echo ""
    echo "  ${GREEN}Другое:${NC}"
    echo "    8) Показать быстрый справочник"
    echo "    0) Выход"
    echo ""
    echo -n "Ваш выбор: "
}

# 1. Просмотреть все ALT текущего authority
list_alt_current() {
    print_header "Просмотр ALT текущего authority"
    npx ts-node "$SCRIPT_DIR/list_alt.ts"
}

# 2. Просмотреть ALT конкретного адреса
list_alt_specific() {
    print_header "Просмотр ALT конкретного адреса"
    echo -n "Введите адрес authority: "
    read target_authority
    
    if [ -z "$target_authority" ]; then
        print_error "Адрес не может быть пустым"
        return 1
    fi
    
    TARGET_AUTHORITY="$target_authority" npx ts-node "$SCRIPT_DIR/list_alt.ts"
}

# 3. Передать ВСЕ ALT новому authority
transfer_all_alt() {
    print_header "Передача ВСЕХ ALT новому authority"
    print_warning "Эта операция передаст ВСЕ ALT, принадлежащие текущему authority"
    echo ""
    echo -n "Введите адрес нового authority: "
    read new_authority
    
    if [ -z "$new_authority" ]; then
        print_error "Адрес не может быть пустым"
        return 1
    fi
    
    echo ""
    echo -n "Вы уверены? (yes/no): "
    read confirmation
    
    if [ "$confirmation" != "yes" ]; then
        print_warning "Операция отменена"
        return 1
    fi
    
    NEW_AUTHORITY_PUBKEY="$new_authority" npx ts-node "$SCRIPT_DIR/transfer_alt_authority.ts"
}

# 4. Передать конкретные ALT новому authority
transfer_specific_alt() {
    print_header "Передача конкретных ALT новому authority"
    echo -n "Введите адрес нового authority: "
    read new_authority
    
    if [ -z "$new_authority" ]; then
        print_error "Адрес не может быть пустым"
        return 1
    fi
    
    echo ""
    echo "Введите адреса ALT через запятую:"
    echo "(например: addr1,addr2,addr3)"
    echo -n "> "
    read alt_addresses
    
    if [ -z "$alt_addresses" ]; then
        print_error "Адреса ALT не могут быть пустыми"
        return 1
    fi
    
    echo ""
    echo -n "Вы уверены? (yes/no): "
    read confirmation
    
    if [ "$confirmation" != "yes" ]; then
        print_warning "Операция отменена"
        return 1
    fi
    
    NEW_AUTHORITY_PUBKEY="$new_authority" ALT_ADDRESSES="$alt_addresses" \
        npx ts-node "$SCRIPT_DIR/transfer_alt_authority_specific.ts"
}

# 5. Добавить нового оператора
add_operator() {
    print_header "Добавление нового оператора"
    echo -n "Введите публичный ключ оператора: "
    read operator_pubkey
    
    if [ -z "$operator_pubkey" ]; then
        print_error "Публичный ключ не может быть пустым"
        return 1
    fi
    
    OPERATOR_PUBKEY="$operator_pubkey" npx ts-node "$SCRIPT_DIR/add_operator.ts"
}

# 6. Удалить оператора
remove_operator() {
    print_header "Удаление оператора"
    echo -n "Введите публичный ключ оператора для удаления: "
    read operator_pubkey
    
    if [ -z "$operator_pubkey" ]; then
        print_error "Публичный ключ не может быть пустым"
        return 1
    fi
    
    echo ""
    echo -n "Вы уверены? (yes/no): "
    read confirmation
    
    if [ "$confirmation" != "yes" ]; then
        print_warning "Операция отменена"
        return 1
    fi
    
    OPERATOR_PUBKEY="$operator_pubkey" npx ts-node "$SCRIPT_DIR/remove_operator.ts"
}

# 7. Заменить оператора
replace_operator() {
    print_header "Замена оператора"
    echo -n "Введите публичный ключ СТАРОГО оператора: "
    read old_operator_pubkey
    
    if [ -z "$old_operator_pubkey" ]; then
        print_error "Публичный ключ не может быть пустым"
        return 1
    fi
    
    echo -n "Введите публичный ключ НОВОГО оператора: "
    read new_operator_pubkey
    
    if [ -z "$new_operator_pubkey" ]; then
        print_error "Публичный ключ не может быть пустым"
        return 1
    fi
    
    echo ""
    echo -n "Вы уверены? (yes/no): "
    read confirmation
    
    if [ "$confirmation" != "yes" ]; then
        print_warning "Операция отменена"
        return 1
    fi
    
    OLD_OPERATOR_PUBKEY="$old_operator_pubkey" NEW_OPERATOR_PUBKEY="$new_operator_pubkey" \
        npx ts-node "$SCRIPT_DIR/replace_operator.ts"
}

# 8. Показать быстрый справочник
show_quick_reference() {
    print_header "Быстрый справочник"
    cat "$SCRIPT_DIR/QUICK_REFERENCE.md"
}

# Главный цикл
main() {
    check_dependencies
    
    while true; do
        show_menu
        read choice
        echo ""
        
        case $choice in
            1) list_alt_current ;;
            2) list_alt_specific ;;
            3) transfer_all_alt ;;
            4) transfer_specific_alt ;;
            5) add_operator ;;
            6) remove_operator ;;
            7) replace_operator ;;
            8) show_quick_reference ;;
            0) 
                print_success "До свидания!"
                exit 0
                ;;
            *)
                print_error "Неверный выбор. Пожалуйста, выберите опцию от 0 до 8."
                ;;
        esac
        
        echo ""
        echo -n "Нажмите Enter для продолжения..."
        read
        clear
    done
}

# Запуск
clear
main
