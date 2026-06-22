#!/bin/sh
cd "$(dirname "$0")"

echo ""
echo "=== DnDCast Deploy ==="
echo ""

echo "[1/3] Pulling latest changes from main..."
git pull origin main || { echo "ERROR: git pull failed. Check for local conflicts."; exit 1; }

echo ""
echo "[2/3] Installing dependencies..."
npm install --omit=dev || { echo "ERROR: npm install failed."; exit 1; }

echo ""
echo "[3/3] Restarting server..."
pm2 restart dndcast || { echo "ERROR: PM2 restart failed. Is PM2 running?"; exit 1; }

echo ""
echo "=== Deploy complete ==="
echo ""
pm2 status
