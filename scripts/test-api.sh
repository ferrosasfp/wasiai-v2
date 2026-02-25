#!/bin/bash
# Test suite para los nuevos endpoints de WasiAI
# Usar en entorno de desarrollo — NO en producción
# Ejecutar: bash scripts/test-api.sh

set -e

BASE_URL="${BASE_URL:-http://localhost:3000}"
CRON_SECRET="${CRON_SECRET:-}"
PASS=0
FAIL=0

echo "=== WasiAI API Tests ==="
echo "Base URL: $BASE_URL"
echo ""

# Helper
check() {
  local name="$1"
  local expected="$2"
  local actual="$3"
  if echo "$actual" | grep -q "$expected"; then
    echo "  ✅ PASS: $name"
    PASS=$((PASS+1))
  else
    echo "  ❌ FAIL: $name"
    echo "     Expected to find: $expected"
    echo "     Got: $(echo "$actual" | head -c 200)"
    FAIL=$((FAIL+1))
  fi
}

# ── 1. GET balance sin auth ───────────────────────────────────────────────────
echo "[1] GET /api/agent-keys/nonexistent-id/balance"
RESP=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/api/agent-keys/nonexistent-id/balance")
check "Balance endpoint returns non-2xx for invalid id" "4" "$RESP"

# ── 2. POST deposit sin firma → 400 ──────────────────────────────────────────
echo ""
echo "[2] POST /api/agent-keys/fake-id/deposit sin firma válida → error"
RESP=$(curl -s -X POST \
  "${BASE_URL}/api/agent-keys/fake-id/deposit" \
  -H "Content-Type: application/json" \
  -d '{"ownerAddress":"0x0","amount":10,"validAfter":0,"validBefore":9999999999,"nonce":"0x0","v":0,"r":"0x0","s":"0x0"}')
check "Deposit sin auth → unauthorized/error" '"error"' "$RESP"

# ── 3. POST refund sin auth → 401 ────────────────────────────────────────────
echo ""
echo "[3] POST /api/agent-keys/fake-id/refund sin sesión → 401"
RESP=$(curl -s -X POST \
  "${BASE_URL}/api/agent-keys/fake-id/refund" \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: test")
check "Refund sin sesión → Unauthorized" '"error"' "$RESP"

# ── 4. GET cron sin auth → 401 ────────────────────────────────────────────────
echo ""
echo "[4] GET /api/cron/settle-key-batches sin auth → 401"
RESP=$(curl -s "${BASE_URL}/api/cron/settle-key-batches")
check "Cron sin auth → Unauthorized" '"Unauthorized"' "$RESP"

# ── 5. GET cron con auth → respuesta válida ───────────────────────────────────
if [ -n "$CRON_SECRET" ]; then
  echo ""
  echo "[5] GET /api/cron/settle-key-batches con CRON_SECRET"
  RESP=$(curl -s "${BASE_URL}/api/cron/settle-key-batches" \
    -H "Authorization: Bearer ${CRON_SECRET}")
  check "Cron con auth → ok o No unsettled calls" '"ok":true' "$RESP"
else
  echo ""
  echo "[5] SKIP: CRON_SECRET not set (export CRON_SECRET=wasiai_cron_... para probar)"
fi

# ── 6. POST invoke sin key ni payment → 402 ──────────────────────────────────
echo ""
echo "[6] POST /api/v1/models/test-model/invoke sin auth → 402 o 404"
RESP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "${BASE_URL}/api/v1/models/nonexistent-model-xyz/invoke" \
  -H "Content-Type: application/json" \
  -d '{"input":"hello"}')
check "Invoke modelo inexistente → 404" "404" "$RESP_CODE"

# ── 7. GET model spec ─────────────────────────────────────────────────────────
echo ""
echo "[7] GET /api/v1/models/ spec (si hay algún modelo activo)"
RESP=$(curl -s "${BASE_URL}/api/v1/models/text-summarizer/invoke" || echo '{}')
# Just check it returns JSON
check "Model GET → JSON response" '{' "$RESP"

# ── Resumen ───────────────────────────────────────────────────────────────────
echo ""
echo "=== Resultados ==="
echo "Passed: $PASS | Failed: $FAIL | Total: $((PASS+FAIL))"

if [ $FAIL -gt 0 ]; then
  echo ""
  echo "⚠️  Algunos tests fallaron. Verifica que el servidor esté corriendo en $BASE_URL"
  exit 1
else
  echo ""
  echo "✅ Todos los tests pasaron!"
fi
