#!/bin/bash

# Script to extend program size and upgrade if needed
# Usage: ./scripts/extend_and_upgrade.sh

set -e

PROGRAM_ID="fLpRcgQSJxKeeUogb6M7bWe1iyYQbahjGXGwr4HgHit"
PROGRAM_SO="target/deploy/flipper.so"
CLUSTER="mainnet"
WALLET="~/.config/solana/fpp-staging.json"

echo "🔍 Checking program size..."
PROGRAM_SIZE=$(wc -c < "$PROGRAM_SO")
echo "   Program size: $PROGRAM_SIZE bytes ($(($PROGRAM_SIZE / 1024)) KB)"

# Get current program data account size
echo "📊 Checking current program account size..."
CURRENT_SIZE=$(solana program show "$PROGRAM_ID" --url "$CLUSTER" 2>/dev/null | grep "Program Data Account" -A 5 | grep "Length" | awk '{print $2}' || echo "0")

if [ "$CURRENT_SIZE" = "0" ]; then
    echo "⚠️  Could not determine current program size. Proceeding with upgrade..."
else
    echo "   Current program account size: $CURRENT_SIZE bytes"
    if [ "$PROGRAM_SIZE" -gt "$CURRENT_SIZE" ]; then
        ADDITIONAL_BYTES=$((PROGRAM_SIZE - CURRENT_SIZE + 10240)) # Add 10KB buffer
        echo "📈 Program size increased. Extending by $ADDITIONAL_BYTES bytes..."
        solana program extend "$PROGRAM_ID" "$ADDITIONAL_BYTES" --url "$CLUSTER" --keypair "$WALLET"
        echo "✅ Program account extended successfully"
    else
        echo "✅ Program size is within current allocation"
    fi
fi

echo "🚀 Upgrading program..."
anchor upgrade "$PROGRAM_SO" \
    --program-id "$PROGRAM_ID" \
    --provider.cluster "$CLUSTER" \
    --provider.wallet "$WALLET"

echo "✅ Upgrade completed successfully!"






















