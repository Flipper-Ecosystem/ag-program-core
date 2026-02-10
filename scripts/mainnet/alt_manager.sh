#!/bin/bash

# Output colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Path to scripts
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Function to print header
print_header() {
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo ""
}

# Function to print error
print_error() {
    echo -e "${RED}Error: $1${NC}"
}

# Function to print warning
print_warning() {
    echo -e "${YELLOW}Warning: $1${NC}"
}

# Function to print success
print_success() {
    echo -e "${GREEN}$1${NC}"
}

# Function to check dependencies
check_dependencies() {
    if ! command -v npx &> /dev/null; then
        print_error "npx not found. Please install Node.js and npm."
        exit 1
    fi
    
    if ! command -v ts-node &> /dev/null; then
        print_warning "ts-node not found globally. Will use npx ts-node."
    fi
}

# Show menu
show_menu() {
    print_header "ALT & Operator Management Tool"
    echo "Select an operation:"
    echo ""
    echo "  ${GREEN}Address Lookup Tables (ALT):${NC}"
    echo "    1) View all ALTs of current authority"
    echo "    2) View ALTs of a specific address"
    echo "    3) Transfer ALL ALTs to new authority"
    echo "    4) Transfer specific ALTs to new authority"
    echo ""
    echo "  ${GREEN}Operator Management:${NC}"
    echo "    5) Add new operator"
    echo "    6) Remove operator"
    echo "    7) Replace operator"
    echo ""
    echo "  ${GREEN}Other:${NC}"
    echo "    8) Show quick reference"
    echo "    0) Exit"
    echo ""
    echo -n "Your choice: "
}

# 1. View all ALTs of current authority
list_alt_current() {
    print_header "View ALTs of Current Authority"
    npx ts-node "$SCRIPT_DIR/list_alt.ts"
}

# 2. View ALTs of a specific address
list_alt_specific() {
    print_header "View ALTs of a Specific Address"
    echo -n "Enter authority address: "
    read target_authority
    
    if [ -z "$target_authority" ]; then
        print_error "Address cannot be empty"
        return 1
    fi
    
    TARGET_AUTHORITY="$target_authority" npx ts-node "$SCRIPT_DIR/list_alt.ts"
}

# 3. Transfer ALL ALTs to new authority
transfer_all_alt() {
    print_header "Transfer ALL ALTs to New Authority"
    print_warning "This operation will transfer ALL ALTs belonging to the current authority"
    echo ""
    echo -n "Enter new authority address: "
    read new_authority
    
    if [ -z "$new_authority" ]; then
        print_error "Address cannot be empty"
        return 1
    fi
    
    echo ""
    echo -n "Are you sure? (yes/no): "
    read confirmation
    
    if [ "$confirmation" != "yes" ]; then
        print_warning "Operation cancelled"
        return 1
    fi
    
    NEW_AUTHORITY_PUBKEY="$new_authority" npx ts-node "$SCRIPT_DIR/transfer_alt_authority.ts"
}

# 4. Transfer specific ALTs to new authority
transfer_specific_alt() {
    print_header "Transfer Specific ALTs to New Authority"
    echo -n "Enter new authority address: "
    read new_authority
    
    if [ -z "$new_authority" ]; then
        print_error "Address cannot be empty"
        return 1
    fi
    
    echo ""
    echo "Enter ALT addresses separated by commas:"
    echo "(e.g.: addr1,addr2,addr3)"
    echo -n "> "
    read alt_addresses
    
    if [ -z "$alt_addresses" ]; then
        print_error "ALT addresses cannot be empty"
        return 1
    fi
    
    echo ""
    echo -n "Are you sure? (yes/no): "
    read confirmation
    
    if [ "$confirmation" != "yes" ]; then
        print_warning "Operation cancelled"
        return 1
    fi
    
    NEW_AUTHORITY_PUBKEY="$new_authority" ALT_ADDRESSES="$alt_addresses" \
        npx ts-node "$SCRIPT_DIR/transfer_alt_authority_specific.ts"
}

# 5. Add new operator
add_operator() {
    print_header "Add New Operator"
    echo -n "Enter operator public key: "
    read operator_pubkey
    
    if [ -z "$operator_pubkey" ]; then
        print_error "Public key cannot be empty"
        return 1
    fi
    
    OPERATOR_PUBKEY="$operator_pubkey" npx ts-node "$SCRIPT_DIR/add_operator.ts"
}

# 6. Remove operator
remove_operator() {
    print_header "Remove Operator"
    echo -n "Enter operator public key to remove: "
    read operator_pubkey
    
    if [ -z "$operator_pubkey" ]; then
        print_error "Public key cannot be empty"
        return 1
    fi
    
    echo ""
    echo -n "Are you sure? (yes/no): "
    read confirmation
    
    if [ "$confirmation" != "yes" ]; then
        print_warning "Operation cancelled"
        return 1
    fi
    
    OPERATOR_PUBKEY="$operator_pubkey" npx ts-node "$SCRIPT_DIR/remove_operator.ts"
}

# 7. Replace operator
replace_operator() {
    print_header "Replace Operator"
    echo -n "Enter OLD operator public key: "
    read old_operator_pubkey
    
    if [ -z "$old_operator_pubkey" ]; then
        print_error "Public key cannot be empty"
        return 1
    fi
    
    echo -n "Enter NEW operator public key: "
    read new_operator_pubkey
    
    if [ -z "$new_operator_pubkey" ]; then
        print_error "Public key cannot be empty"
        return 1
    fi
    
    echo ""
    echo -n "Are you sure? (yes/no): "
    read confirmation
    
    if [ "$confirmation" != "yes" ]; then
        print_warning "Operation cancelled"
        return 1
    fi
    
    OLD_OPERATOR_PUBKEY="$old_operator_pubkey" NEW_OPERATOR_PUBKEY="$new_operator_pubkey" \
        npx ts-node "$SCRIPT_DIR/replace_operator.ts"
}

# 8. Show quick reference
show_quick_reference() {
    print_header "Quick Reference"
    cat "$SCRIPT_DIR/../../docs/mainnet/QUICK_REFERENCE.md"
}

# Main loop
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
                print_success "Goodbye!"
                exit 0
                ;;
            *)
                print_error "Invalid choice. Please select an option from 0 to 8."
                ;;
        esac
        
        echo ""
        echo -n "Press Enter to continue..."
        read
        clear
    done
}

# Launch
clear
main
