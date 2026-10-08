#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# dueping Smoke Test Script
# Tests the full end-to-end flow on production build output:
# 1. Apply local migrations
# 2. Start wrangler dev server with production bundle & --test-scheduled
# 3. User 1 OTP request & login from console logs
# 4. User 1 modify settings & create contract
# 5. Trigger scheduled scan -> verify digest email sent in logs
# 6. Re-trigger scheduled scan -> verify no duplicate email sent
# 7. User 2 OTP login -> verify User 2 gets 404 attempting to access User 1 contract
# ==============================================================================

PORT=8788
BASE_URL="http://127.0.0.1:${PORT}"
TMP_DIR=$(mktemp -d -t dueping-smoke-XXXXXX)
LOG_FILE="${TMP_DIR}/wrangler.log"
USER1_COOKIE="${TMP_DIR}/user1_cookie.txt"
USER2_COOKIE="${TMP_DIR}/user2_cookie.txt"
WRANGLER_PID=""

cleanup() {
  echo ""
  echo "🧹 Cleaning up smoke test processes and files..."
  if [ -n "${WRANGLER_PID}" ] && kill -0 "${WRANGLER_PID}" 2>/dev/null; then
    kill "${WRANGLER_PID}" 2>/dev/null || true
    wait "${WRANGLER_PID}" 2>/dev/null || true
  fi
  rm -rf "${TMP_DIR}"
  echo "✓ Cleanup finished."
}
trap cleanup EXIT INT TERM

echo "=========================================================="
echo "🚀 Starting dueping End-to-End Smoke Test"
echo "=========================================================="
echo "Working dir: $(pwd)"
echo "Temp dir:    ${TMP_DIR}"
echo "Base URL:    ${BASE_URL}"
echo ""

# Step 0: Ensure build output exists
echo "▶ 0. Verifying build output..."
if [ ! -f "dist/dueping/index.js" ] || [ ! -f "dist/dueping/wrangler.json" ]; then
  echo "Build artifacts missing. Running npm run build..."
  npm run build
fi
echo "✓ Build artifacts present."

# Step 1: Apply D1 local migrations
echo ""
echo "▶ 1. Applying local D1 migrations..."
rm -rf dist/dueping/.wrangler
CI=true npx wrangler d1 migrations apply dueping --local -c dist/dueping/wrangler.json
echo "✓ Local D1 migrations applied."

# Step 2: Start local server on port 8788
echo ""
echo "▶ 2. Starting local wrangler dev on port ${PORT}..."
npx wrangler dev -c dist/dueping/wrangler.json --test-scheduled --port "${PORT}" --log-level log > "${LOG_FILE}" 2>&1 &
WRANGLER_PID=$!
echo "Wrangler dev started with PID ${WRANGLER_PID}."

echo "Waiting for server to become healthy..."
READY=0
for i in {1..30}; do
  if curl -s "${BASE_URL}/api/health" | grep -q '"status":"ok"'; then
    READY=1
    break
  fi
  sleep 1
done

if [ $READY -ne 1 ]; then
  echo "❌ Error: Server failed to start within 30 seconds. Logs:"
  cat "${LOG_FILE}"
  exit 1
fi
echo "✓ Server is healthy and ready."

# Helper function to extract OTP from logs
get_otp_code() {
  local target_email="$1"
  local code=""
  for i in {1..10}; do
    code=$(grep -oE "\[dueping OTP\] Verification code for ${target_email}: [0-9]{6}" "${LOG_FILE}" | tail -n 1 | awk '{print $NF}' || true)
    if [ -n "${code}" ]; then
      break
    fi
    sleep 0.5
  done
  echo "${code}"
}

# Step 3: User 1 OTP Request & Login
echo ""
echo "▶ 3. Testing User 1 Authentication Flow..."
USER1_EMAIL="user1@example.com"

echo "Requesting OTP for ${USER1_EMAIL}..."
REQ_RES=$(curl -s -X POST "${BASE_URL}/api/auth/otp/request" \
  -H "Content-Type: application/json" \
  -H "Origin: ${BASE_URL}" \
  -d "{\"email\":\"${USER1_EMAIL}\"}")

if ! echo "${REQ_RES}" | grep -q '"success":true'; then
  echo "❌ Failed to request OTP: ${REQ_RES}"
  exit 1
fi

USER1_OTP=$(get_otp_code "${USER1_EMAIL}")
if [ -z "${USER1_OTP}" ]; then
  echo "❌ Failed to capture OTP code from logs. Current log content:"
  cat "${LOG_FILE}"
  exit 1
fi
echo "Extracted User 1 OTP: ${USER1_OTP}"

echo "Verifying OTP and getting session cookie..."
VERIFY_RES=$(curl -s -i -X POST "${BASE_URL}/api/auth/otp/verify" \
  -H "Content-Type: application/json" \
  -H "Origin: ${BASE_URL}" \
  -c "${USER1_COOKIE}" \
  -d "{\"email\":\"${USER1_EMAIL}\",\"code\":\"${USER1_OTP}\"}")

if ! echo "${VERIFY_RES}" | grep -q 'HTTP/1.1 200 OK'; then
  echo "❌ Failed to verify OTP: ${VERIFY_RES}"
  exit 1
fi

ME_RES=$(curl -s -b "${USER1_COOKIE}" "${BASE_URL}/api/auth/me")
if ! echo "${ME_RES}" | grep -q "${USER1_EMAIL}"; then
  echo "❌ Failed /api/auth/me check: ${ME_RES}"
  exit 1
fi
echo "✓ User 1 authenticated successfully."

# Step 4: User 1 Update Settings
echo ""
echo "▶ 4. Updating User 1 Settings..."
# Setting send_hour to 0 ensures scan runs immediately at any time of day
SETTINGS_RES=$(curl -s -X PUT "${BASE_URL}/api/settings" \
  -b "${USER1_COOKIE}" \
  -H "Content-Type: application/json" \
  -H "Origin: ${BASE_URL}" \
  -d '{"reminder_days":[30,15,7],"send_hour":0,"timezone":"Asia/Shanghai"}')

if ! echo "${SETTINGS_RES}" | grep -q '"send_hour":0'; then
  echo "❌ Failed to update settings: ${SETTINGS_RES}"
  exit 1
fi
echo "✓ Settings updated: reminder_days=[30,15,7], send_hour=0, timezone=Asia/Shanghai."

# Step 4.5: User 1 Test AI Contract Recognition
echo ""
echo "▶ 4.5. Testing AI Contract Image Recognition (/api/contracts/recognize)..."
RECOG_UNAUTH=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/api/contracts/recognize" \
  -H "Content-Type: application/json" \
  -H "Origin: ${BASE_URL}" \
  -d '{"images":["data:image/jpeg;base64,ZmFrZQ=="]}')
if [ "${RECOG_UNAUTH}" != "401" ]; then
  echo "❌ Unauthenticated recognition should return 401, got: ${RECOG_UNAUTH}"
  exit 1
fi
echo "✓ Unauthenticated recognition correctly rejected with HTTP 401."

RECOG_BAD_REQ=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/api/contracts/recognize" \
  -b "${USER1_COOKIE}" \
  -H "Content-Type: application/json" \
  -H "Origin: ${BASE_URL}" \
  -d '{"images":[]}')
if [ "${RECOG_BAD_REQ}" != "400" ]; then
  echo "❌ Empty images recognition should return 400, got: ${RECOG_BAD_REQ}"
  exit 1
fi
echo "✓ Empty images recognition correctly rejected with HTTP 400."

RECOG_RES=$(curl -s -X POST "${BASE_URL}/api/contracts/recognize" \
  -b "${USER1_COOKIE}" \
  -H "Content-Type: application/json" \
  -H "Origin: ${BASE_URL}" \
  -d '{"images":["data:image/jpeg;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="]}')

if ! echo "${RECOG_RES}" | grep -q '"success":true'; then
  echo "❌ Failed to recognize contract image: ${RECOG_RES}"
  exit 1
fi
echo "✓ AI Contract Image Recognition successfully returned structured contract data."

# Step 5: User 1 Create Contract
echo ""
echo "▶ 5. Creating User 1 Contract..."
# Compute an end_date 10 days in the future (falls in tier 15, since 10 <= 15)
TARGET_END_DATE=$(node -e 'const d = new Date(); d.setDate(d.getDate() + 10); console.log(d.toISOString().slice(0, 10))')
echo "Target end date: ${TARGET_END_DATE} (10 days from now)"

CREATE_RES=$(curl -s -X POST "${BASE_URL}/api/contracts" \
  -b "${USER1_COOKIE}" \
  -H "Content-Type: application/json" \
  -H "Origin: ${BASE_URL}" \
  -d "{\"name\":\"企业级云架构咨询服务\",\"client\":\"上海智创未来科技有限公司\",\"end_date\":\"${TARGET_END_DATE}\",\"amount\":128000,\"note\":\"到期请确认二期续签及尾款\"}")

CONTRACT1_ID=$(echo "${CREATE_RES}" | node -e '
  let d = "";
  process.stdin.on("data", c => d += c);
  process.stdin.on("end", () => {
    try {
      const j = JSON.parse(d);
      if (j.contract && j.contract.id) process.stdout.write(j.contract.id);
    } catch(e) {}
  });
')

if [ -z "${CONTRACT1_ID}" ]; then
  echo "❌ Failed to create contract: ${CREATE_RES}"
  exit 1
fi
echo "✓ Contract created with ID: ${CONTRACT1_ID}"

# Step 6: Trigger scheduled cron -> Verify digest email sent
echo ""
echo "▶ 6. Triggering Scheduled Scan (First Run)..."
TRIGGER_RES=$(curl -s -X POST "${BASE_URL}/api/test/trigger-scheduled" \
  -H "Content-Type: application/json" \
  -H "Origin: ${BASE_URL}")

echo "Trigger response: ${TRIGGER_RES}"

# Verify in trigger result that 1 email was sent
if ! echo "${TRIGGER_RES}" | grep -q '"emailsSent":1'; then
  echo "❌ Expected emailsSent to be 1, got: ${TRIGGER_RES}"
  exit 1
fi

# Also check logs for the email simulation and Chinese reminder content
sleep 1
if ! grep -q "企业级云架构咨询服务" "${LOG_FILE}"; then
  echo "❌ Reminder email did not contain contract name. Log tail:"
  tail -n 25 "${LOG_FILE}"
  exit 1
fi
echo "✓ Scheduled scan triggered and reminder email logged for User 1."

# Step 7: Re-trigger scheduled scan -> Verify NO duplicate email
echo ""
echo "▶ 7. Triggering Scheduled Scan (Second Run - Duplicate Check)..."
TRIGGER2_RES=$(curl -s -X POST "${BASE_URL}/api/test/trigger-scheduled" \
  -H "Content-Type: application/json" \
  -H "Origin: ${BASE_URL}")

echo "Trigger response: ${TRIGGER2_RES}"
if ! echo "${TRIGGER2_RES}" | grep -q '"emailsSent":0'; then
  echo "❌ Duplicate email check failed! Expected emailsSent: 0, got: ${TRIGGER2_RES}"
  exit 1
fi
echo "✓ Duplicate check passed: 0 emails sent on second scan."

# Step 8: Multi-tenant Isolation Verification
echo ""
echo "▶ 8. Verifying Multi-Tenant Data Isolation (User 2)..."
USER2_EMAIL="user2@example.com"

echo "Requesting OTP for ${USER2_EMAIL}..."
curl -s -X POST "${BASE_URL}/api/auth/otp/request" \
  -H "Content-Type: application/json" \
  -H "Origin: ${BASE_URL}" \
  -d "{\"email\":\"${USER2_EMAIL}\"}" > /dev/null

USER2_OTP=$(get_otp_code "${USER2_EMAIL}")
if [ -z "${USER2_OTP}" ]; then
  echo "❌ Failed to capture OTP code for User 2"
  exit 1
fi

echo "Verifying OTP for ${USER2_EMAIL}..."
curl -s -X POST "${BASE_URL}/api/auth/otp/verify" \
  -H "Content-Type: application/json" \
  -H "Origin: ${BASE_URL}" \
  -c "${USER2_COOKIE}" \
  -d "{\"email\":\"${USER2_EMAIL}\",\"code\":\"${USER2_OTP}\"}" > /dev/null

echo "Attempting unauthorized access: User 2 reading User 1's contract..."
U2_GET_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -b "${USER2_COOKIE}" "${BASE_URL}/api/contracts/${CONTRACT1_ID}")
if [ "${U2_GET_STATUS}" != "404" ]; then
  echo "❌ Tenant isolation failure! Expected HTTP 404, got: ${U2_GET_STATUS}"
  exit 1
fi
echo "✓ Unauthorized read returned HTTP 404 as required by SPEC."

echo "Attempting unauthorized modification: User 2 updating User 1's contract..."
U2_PUT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "${BASE_URL}/api/contracts/${CONTRACT1_ID}" \
  -b "${USER2_COOKIE}" \
  -H "Content-Type: application/json" \
  -H "Origin: ${BASE_URL}" \
  -d '{"name":"Hacked Name","client":"Hacked","end_date":"2099-01-01"}')
if [ "${U2_PUT_STATUS}" != "404" ]; then
  echo "❌ Tenant isolation failure! Expected HTTP 404 on PUT, got: ${U2_PUT_STATUS}"
  exit 1
fi
echo "✓ Unauthorized update returned HTTP 404 as required by SPEC."

echo "Attempting unauthorized deletion: User 2 deleting User 1's contract..."
U2_DEL_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "${BASE_URL}/api/contracts/${CONTRACT1_ID}" \
  -b "${USER2_COOKIE}" \
  -H "Content-Type: application/json" \
  -H "Origin: ${BASE_URL}")
if [ "${U2_DEL_STATUS}" != "404" ]; then
  echo "❌ Tenant isolation failure! Expected HTTP 404 on DELETE, got: ${U2_DEL_STATUS}"
  exit 1
fi
echo "✓ Unauthorized delete returned HTTP 404 as required by SPEC."

echo "Checking User 2's contract list..."
U2_LIST=$(curl -s -b "${USER2_COOKIE}" "${BASE_URL}/api/contracts")
if echo "${U2_LIST}" | grep -q "${CONTRACT1_ID}"; then
  echo "❌ Tenant isolation failure! User 2 list contains User 1 contract!"
  exit 1
fi
echo "✓ User 2 contract list is completely isolated."

echo ""
echo "=========================================================="
echo "🎉 ALL SMOKE TESTS PASSED SUCCESSFULLY!"
echo "=========================================================="
exit 0
