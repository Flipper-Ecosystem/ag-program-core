#!/bin/bash

# Script to update IDL on-chain (which Solscan will automatically detect)
# Usage: ./scripts/update_idl.sh [init|upgrade]

set -e

PROGRAM_ID="fLpRcgQSJxKeeUogb6M7bWe1iyYQbahjGXGwr4HgHit"
IDL_FILE="target/idl/flipper.json"
CLUSTER="mainnet"
WALLET="~/.config/solana/fpp-staging.json"
ACTION="${1:-upgrade}"  # Default to upgrade, can be 'init' for first time

echo "📋 Updating IDL for program: $PROGRAM_ID"
echo "   Cluster: $CLUSTER"
echo "   IDL file: $IDL_FILE"
echo "   Action: $ACTION"
echo ""

# Check if IDL file exists
if [ ! -f "$IDL_FILE" ]; then
    echo "❌ Error: IDL file not found at $IDL_FILE"
    echo "   Please run 'anchor build' first to generate the IDL"
    exit 1
fi

# Check if this is first time initialization or upgrade
if [ "$ACTION" = "init" ]; then
    echo "🚀 Initializing IDL on-chain (first time)..."
    anchor idl init \
        --filepath "$IDL_FILE" \
        "$PROGRAM_ID" \
        --provider.cluster "$CLUSTER" \
        --provider.wallet "$WALLET"
    echo "✅ IDL initialized successfully!"
else
    echo "🔄 Upgrading IDL on-chain..."
    anchor idl upgrade \
        --filepath "$IDL_FILE" \
        "$PROGRAM_ID" \
        --provider.cluster "$CLUSTER" \
        --provider.wallet "$WALLET"
    echo "✅ IDL upgraded successfully!"
fi

echo ""
echo "📝 Note: Solscan will automatically detect the updated IDL from the on-chain account."
echo "   Visit: https://solscan.io/account/$PROGRAM_ID to verify"














