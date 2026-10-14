#!/usr/bin/env bash
#
# test-all.sh — Person B test gates: Python matching tests + backend API tests
# against the real local PostGIS database and real matching service.
#
set -euo pipefail
cd "$(dirname "$0")/.."   # -> backend/

bash scripts/db-start.sh

# matching service must be up for backend integration tests
if ! curl -sf http://localhost:8000/health > /dev/null 2>&1; then
  echo "[test] starting matching service"
  matching-service/.venv/bin/uvicorn app:app --port 8000 --app-dir matching-service > /tmp/fb-test-matcher.log 2>&1 &
  MATCHER_PID=$!
  trap 'kill "$MATCHER_PID" 2> /dev/null || true' EXIT
  for _ in $(seq 1 20); do curl -sf http://localhost:8000/health > /dev/null 2>&1 && break; sleep 0.5; done
fi

echo "=== [1/2] Python matching service tests ==="
matching-service/.venv/bin/python -m pytest matching-service/tests -q

echo "=== [2/2] Backend tests (vitest + real PostgreSQL foodbridge_test) ==="
npm run test

echo "[test] all Person B suites passed"
