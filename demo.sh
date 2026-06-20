#!/usr/bin/env bash
# ─────────────────────────────────────────────────
# Quick demo script — seeds tasks and runs the agent loop
# ─────────────────────────────────────────────────

BASE="http://localhost:8000"

echo "🤖 Agentic Task Loop — Demo"
echo "════════════════════════════════════════════"
echo ""

# Step 1: Add tasks
echo "📝 Adding tasks..."
echo ""

curl -s -X POST "$BASE/tasks" \
  -H "Content-Type: application/json" \
  -d '{"description": "Implement Tic-Tac-Toe in a TUI"}' | python3 -m json.tool

curl -s -X POST "$BASE/tasks" \
  -H "Content-Type: application/json" \
  -d '{"description": "Make the grid 5x5 instead of 3x3"}' | python3 -m json.tool

curl -s -X POST "$BASE/tasks" \
  -H "Content-Type: application/json" \
  -d '{"description": "Make the grid size configurable"}' | python3 -m json.tool

curl -s -X POST "$BASE/tasks" \
  -H "Content-Type: application/json" \
  -d '{"description": "Make the player count configurable instead of fixed 2 players"}' | python3 -m json.tool

echo ""
echo "════════════════════════════════════════════"
echo "📋 Current task list:"
curl -s "$BASE/tasks" | python3 -m json.tool

echo ""
echo "════════════════════════════════════════════"
echo "🚀 Starting agent loop..."
echo "(This will call the local LLM for each task)"
echo ""

curl -s -X POST "$BASE/agent/run" | python3 -m json.tool

echo ""
echo "════════════════════════════════════════════"
echo "📋 Final task statuses:"
curl -s "$BASE/tasks" | python3 -m json.tool
