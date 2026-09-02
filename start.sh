#!/usr/bin/env bash
# Positron v0.2.0 Starter
set -e

echo "🚀 Starting Positron v0.2.0..."
echo ""

# Start Server
echo "📡 Starting server on port 3000..."
cd apps/server
npx tsx src/index.ts &
SERVER_PID=$!
cd ../..

# Wait for server
sleep 2

# Start Web UI
echo "🎨 Starting web UI on port 5173..."
cd apps/web
npx vite --port 5173 &
WEB_PID=$!
cd ../..

echo ""
echo "✅ Positron läuft:"
echo "   Server: http://localhost:3000 (PID $SERVER_PID)"
echo "   Web UI: http://localhost:5173 (PID $WEB_PID)"
echo ""
echo "Beenden: kill $SERVER_PID $WEB_PID"
