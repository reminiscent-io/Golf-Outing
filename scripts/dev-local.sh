#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

API_PORT="${API_PORT:-${PORT:-3000}}"
UI_PORT="${UI_PORT:-5173}"

trap 'kill 0' SIGINT SIGTERM EXIT

PORT="$API_PORT" pnpm --filter @workspace/api-server run dev &
PORT="$UI_PORT" pnpm --filter @workspace/golf-scorecard run dev &

wait
