#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════
# Agentic Coding Agent — Demo v2.0
# Runtime: OpenCode + Qwen 3 (8B) via Ollama
# Pipeline: Architect → Coder → Reviewer → Fix
# ════════════════════════════════════════════════════════════

set -e

BASE="http://localhost:8000"
BOLD="\033[1m"
DIM="\033[2m"
CYAN="\033[36m"
GREEN="\033[32m"
YELLOW="\033[33m"
PURPLE="\033[35m"
RESET="\033[0m"

echo ""
echo -e "${BOLD}════════════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}  AGENTIC CODING AGENT — Demo v2.0${RESET}"
echo -e "${DIM}  Runtime: OpenCode + Qwen 3 (8B) via Ollama${RESET}"
echo -e "${DIM}  Pipeline: Architect → Coder → Reviewer → Fix${RESET}"
echo -e "${BOLD}════════════════════════════════════════════════════════════${RESET}"
echo ""

# ── Step 1: Check service ──────────────────────────────────
echo -e "${CYAN}[1/5]${RESET} Checking service health..."
HEALTH=$(curl -s "$BASE/" 2>/dev/null || echo "FAIL")
if echo "$HEALTH" | grep -q "Agentic"; then
    echo -e "  ${GREEN}✓${RESET} Service is running"
else
    echo -e "  ${YELLOW}✗${RESET} Service not running. Start with:"
    echo "    uvicorn app.main:app --reload --port 8000"
    exit 1
fi
echo ""

# ── Step 2: Submit a coding task ───────────────────────────
echo -e "${CYAN}[2/5]${RESET} Creating coding task..."
TASK_RESPONSE=$(curl -s -X POST "$BASE/tasks" \
    -H "Content-Type: application/json" \
    -d '{"description": "Create a Python Tic-Tac-Toe game that runs in the terminal. It should have a 3x3 board, two players (X and O), turn-based input via row and column numbers, win detection for rows columns and diagonals, and draw detection when the board is full. Print the board after each move."}')

TASK_ID=$(echo "$TASK_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['task']['id'])" 2>/dev/null || echo "unknown")
echo -e "  ${GREEN}✓${RESET} Task created: ${BOLD}$TASK_ID${RESET}"
echo -e "  ${DIM}$(echo "$TASK_RESPONSE" | python3 -m json.tool 2>/dev/null | head -8)${RESET}"
echo ""

# ── Step 3: Run the agent pipeline ─────────────────────────
echo -e "${CYAN}[3/5]${RESET} Starting agent pipeline..."
echo -e "  ${DIM}This will run: Architect → Coder → Reviewer → Fix${RESET}"
echo -e "  ${DIM}Monitor live at: ${BOLD}$BASE/dashboard${RESET}"
echo ""

RESULT=$(curl -s -X POST "$BASE/agent/run")
echo ""

# Parse results
STATUS=$(echo "$RESULT" | python3 -c "import sys, json; print(json.load(sys.stdin).get('status', 'unknown'))" 2>/dev/null)
RUNS=$(echo "$RESULT" | python3 -c "import sys, json; print(json.load(sys.stdin).get('total_opencode_runs', 0))" 2>/dev/null)

echo -e "  ${GREEN}✓${RESET} Pipeline complete: ${BOLD}$STATUS${RESET}"
echo -e "  ${DIM}OpenCode runs: $RUNS${RESET}"
echo ""

# ── Step 4: Show workspace ─────────────────────────────────
echo -e "${CYAN}[4/5]${RESET} Files created by the agent:"
WORKSPACE=$(curl -s "$BASE/workspace")
echo "$WORKSPACE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
files = data.get('files', {})
if files:
    for path, info in files.items():
        size = info['size_bytes']
        if size < 1024:
            print(f'  📄 {path}  ({size} bytes)')
        else:
            print(f'  📄 {path}  ({size/1024:.1f} KB)')
else:
    print('  (no files created)')
" 2>/dev/null
echo ""

# ── Step 5: Show telemetry ─────────────────────────────────
echo -e "${CYAN}[5/5]${RESET} Telemetry summary:"
curl -s "$BASE/traces/summary" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(f'  OpenCode runs:    {data.get(\"total_runs\", 0)}')
print(f'  Tool calls:       {data.get(\"total_tool_calls\", 0)}')
print(f'  Files modified:   {data.get(\"total_files_modified\", 0)}')
avg = data.get('avg_latency_ms', 0)
total = data.get('total_latency_ms', 0)
print(f'  Avg latency:      {avg/1000:.1f}s')
print(f'  Total time:       {total/1000:.1f}s')
print(f'  Success rate:     {data.get(\"success_rate\", 0)}%')
modes = data.get('calls_by_mode', {})
if modes:
    print(f'  Breakdown:        {\"  \".join(f\"{k}: {v}\" for k, v in modes.items())}')
" 2>/dev/null
echo ""

echo -e "${BOLD}════════════════════════════════════════════════════════════${RESET}"
echo -e "  ${GREEN}✓${RESET} Demo complete!"
echo -e "  ${DIM}Dashboard:  ${BOLD}$BASE/dashboard${RESET}"
echo -e "  ${DIM}Workspace:  ${BOLD}$BASE/workspace${RESET}"
echo -e "  ${DIM}Telemetry:  ${BOLD}$BASE/traces/summary${RESET}"
echo -e "${BOLD}════════════════════════════════════════════════════════════${RESET}"
echo ""
