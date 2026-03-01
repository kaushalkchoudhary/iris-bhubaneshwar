#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://demo2.magicboxhub.net}"
ADMIN_EMAIL="${ADMIN_EMAIL:-iris_admin@wiredleap.com}"
OP_EMAIL="${OP_EMAIL:-iris_operator@local.com}"
ADMIN_PASS="${ADMIN_PASS:-}"
OP_PASS="${OP_PASS:-}"
ADMIN_TOKEN="${ADMIN_TOKEN:-}"
UPLOAD_PATH="${UPLOAD_PATH:-}"
MEDIA_PATH="${MEDIA_PATH:-}"
RUN_LOCKOUT=0
NON_INTERACTIVE=0
WRITE_MD=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

for arg in "$@"; do
  case "$arg" in
    --base-url=*) BASE_URL="${arg#*=}" ;;
    --run-lockout) RUN_LOCKOUT=1 ;;
    --non-interactive) NON_INTERACTIVE=1 ;;
    --no-md) WRITE_MD=0 ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: $0 [--base-url=...] [--run-lockout] [--non-interactive] [--no-md]"
      exit 1
      ;;
  esac
done

for c in curl jq rg python3; do
  command -v "$c" >/dev/null 2>&1 || { echo "Missing command: $c"; exit 1; }
done

declare -a IDS
for i in $(seq 1 24); do IDS+=("$i"); done
declare -A TITLE STATUS NOTE

TITLE[1]="Source Code Disclosure (.ts/.tsx)"
TITLE[2]="Hardcoded Credentials in Client Source"
TITLE[3]="Privilege Escalation via Role Manipulation"
TITLE[4]="HTTP Request Smuggling (CL.TE)"
TITLE[5]="Unauthenticated Access to Sensitive API Endpoint"
TITLE[6]="Unauthenticated Access to Vehicle Captured Images"
TITLE[7]="Rate Limit Bypass via X-Forwarded-For"
TITLE[8]="Missing DMARC/SPF"
TITLE[9]="Missing Rate Limiting on API Endpoint"
TITLE[10]="HEAD Method Enabled"
TITLE[11]="Clickjacking"
TITLE[12]="Token Passed via GET Request"
TITLE[13]="CORS Misconfiguration"
TITLE[14]="Nginx Version Disclosure"
TITLE[15]="Missing CSRF Token Implementation on Dynamic Pages"
TITLE[16]="Hardcoded API Key Exposed in Client Source"
TITLE[17]="Missing Security Headers"
TITLE[18]="Insufficient Session Expiration"
TITLE[19]="Verbose Error Disclosure"
TITLE[20]="Missing Account Lockout"
TITLE[21]="Concurrent Login Across Browsers/Devices"
TITLE[22]="Improper Input Validation"
TITLE[23]="Unauthenticated Access to Media Resources"
TITLE[24]="No Web Application Firewall (WAF)"

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

mark() {
  local id="$1" st="$2" nt="$3"
  STATUS[$id]="$st"
  NOTE[$id]="$nt"
  case "$st" in
    PASS) PASS_COUNT=$((PASS_COUNT + 1)) ;;
    FAIL) FAIL_COUNT=$((FAIL_COUNT + 1)) ;;
    SKIP) SKIP_COUNT=$((SKIP_COUNT + 1)) ;;
  esac
}

curl_with_csrf() {
  local cookie token rc
  cookie="$(mktemp /tmp/iris-csrf.XXXXXX)"
  token="$(curl -sS -c "$cookie" "$BASE_URL/api/auth/csrf-token" | jq -er '.csrfToken' 2>/dev/null || true)"
  if [[ -z "$token" || "$token" == "null" ]]; then
    rm -f "$cookie"
    return 1
  fi
  curl -sS -b "$cookie" -H "X-CSRF-Token: $token" "$@"
  rc=$?
  rm -f "$cookie"
  return $rc
}

section() {
  local id="$1"
  echo
  echo "------------------------------------------------------------"
  echo "Issue #$id - ${TITLE[$id]}"
  echo "------------------------------------------------------------"
}

extract_token() {
  local email="$1" pass="$2"
  curl_with_csrf -X POST "$BASE_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$pass\"}" | jq -er '.token'
}

token_works() {
  local tok="$1"
  [[ -n "$tok" && "$tok" == *.*.* ]] || return 1
  local code
  code="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/api/auth/me" -H "Authorization: Bearer $tok")"
  [[ "$code" == "200" ]]
}

refresh_auth_tokens() {
  if ! token_works "${ADMIN_TOKEN:-}"; then
    if [[ -n "${ADMIN_PASS:-}" ]]; then
      ADMIN_TOKEN="$(extract_token "$ADMIN_EMAIL" "$ADMIN_PASS" 2>/dev/null || true)"
      if ! token_works "${ADMIN_TOKEN:-}"; then ADMIN_TOKEN=""; fi
    else
      ADMIN_TOKEN=""
    fi
  fi

  if ! token_works "${OP_TOKEN:-}"; then
    if [[ -n "${OP_PASS:-}" ]]; then
      OP_TOKEN="$(extract_token "$OP_EMAIL" "$OP_PASS" 2>/dev/null || true)"
      if ! token_works "${OP_TOKEN:-}"; then OP_TOKEN=""; fi
    else
      OP_TOKEN=""
    fi
  fi
}

pick_auth_token() {
  if token_works "${ADMIN_TOKEN:-}"; then
    echo "$ADMIN_TOKEN"
    return 0
  fi
  if token_works "${OP_TOKEN:-}"; then
    echo "$OP_TOKEN"
    return 0
  fi
  echo ""
  return 0
}

strip_base_to_path() {
  local u="$1"
  if [[ "$u" =~ ^https?://[^/]+(/.*)$ ]]; then
    echo "${BASH_REMATCH[1]}"
  else
    echo "$u"
  fi
}

discover_paths_from_fs() {
  local upload_dir="/var/lib/iris2/data"
  if [[ -f /etc/iris2/backend.env ]]; then
    local v
    v="$(awk -F= '/^UPLOAD_DIR=/{print $2}' /etc/iris2/backend.env | tail -n1)"
    [[ -n "$v" ]] && upload_dir="$v"
  fi
  if [[ -d "$upload_dir" ]]; then
    local f
    f="$(find "$upload_dir" -type f | head -n1 || true)"
    if [[ -n "$f" ]]; then
      local rel="${f#"$upload_dir"/}"
      [[ -z "$UPLOAD_PATH" ]] && UPLOAD_PATH="/uploads/$rel"
      [[ -z "$MEDIA_PATH" ]] && MEDIA_PATH="/media/$rel"
    fi
  fi
  return 0
}

discover_paths_from_api() {
  if [[ -z "$ADMIN_TOKEN" ]]; then
    return 0
  fi
  local body snap plate
  body="$(curl -sS "$BASE_URL/api/violations?limit=100" -H "Authorization: Bearer $ADMIN_TOKEN" || true)"
  snap="$(echo "$body" | jq -r '.violations[]? | .fullSnapshotUrl // empty' | head -n1)"
  plate="$(echo "$body" | jq -r '.violations[]? | .plateImageUrl // empty' | head -n1)"
  if [[ -z "$UPLOAD_PATH" ]]; then
    [[ -n "$snap" ]] && UPLOAD_PATH="$(strip_base_to_path "$snap")"
    [[ -z "$UPLOAD_PATH" && -n "$plate" ]] && UPLOAD_PATH="$(strip_base_to_path "$plate")"
  fi
  if [[ -z "$MEDIA_PATH" && -n "$UPLOAD_PATH" ]]; then
    MEDIA_PATH="${UPLOAD_PATH/\/uploads\//\/media\/}"
  fi
  return 0
}

bootstrap_test_upload() {
  [[ -n "$UPLOAD_PATH" || -z "$ADMIN_TOKEN" ]] && return
  local t resp p
  t="$(mktemp /tmp/iris-up.XXXXXX.jpg)"
  printf "probe-%s\n" "$(date +%s)" > "$t"
  resp="$(curl_with_csrf -X POST "$BASE_URL/api/uploads" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -F "device_id=probe-device" \
    -F "worker_id=probe-worker" \
    -F "type=image" \
    -F "probe=@$t;filename=probe.jpg" || true)"
  rm -f "$t"
  p="$(echo "$resp" | jq -r '.files.probe // empty' 2>/dev/null || true)"
  if [[ -n "$p" ]]; then
    UPLOAD_PATH="$p"
    [[ -z "$MEDIA_PATH" ]] && MEDIA_PATH="${UPLOAD_PATH/\/uploads\//\/media\/}"
  fi
  return 0
}

echo "Base URL: $BASE_URL"
echo "Repo root: $REPO_ROOT"

if [[ "$NON_INTERACTIVE" -eq 0 ]]; then
  [[ -z "$ADMIN_PASS" ]] && read -r -s -p "Admin password ($ADMIN_EMAIL): " ADMIN_PASS && echo
  [[ -z "$OP_PASS" ]] && read -r -s -p "Operator password ($OP_EMAIL): " OP_PASS && echo
  [[ -z "$UPLOAD_PATH" ]] && read -r -p "Known uploads file path for #6 (optional): " UPLOAD_PATH
  [[ -z "$MEDIA_PATH" ]] && read -r -p "Known media file path for #23 (optional): " MEDIA_PATH
fi

if [[ -z "$ADMIN_TOKEN" && -n "$ADMIN_PASS" ]]; then
  ADMIN_TOKEN="$(extract_token "$ADMIN_EMAIL" "$ADMIN_PASS" 2>/dev/null || true)"
fi
if ! token_works "$ADMIN_TOKEN"; then ADMIN_TOKEN=""; fi

if [[ -n "$OP_PASS" ]]; then
  OP_TOKEN="$(extract_token "$OP_EMAIL" "$OP_PASS" 2>/dev/null || true)"
else
  OP_TOKEN=""
fi
if ! token_works "$OP_TOKEN"; then OP_TOKEN=""; fi

# Normalize operator state for #3/#21 if admin is available.
if [[ -n "$ADMIN_TOKEN" ]]; then
  OP_ID="$(curl -sS "$BASE_URL/api/admin/auth/operators" -H "Authorization: Bearer $ADMIN_TOKEN" \
    | jq -r --arg e "$OP_EMAIL" '.operators[]? | select((.email|ascii_downcase)==($e|ascii_downcase)) | .id' | head -n1)"
  if [[ -n "$OP_ID" ]]; then
    curl_with_csrf -o /dev/null -X POST "$BASE_URL/api/admin/auth/operators/$OP_ID/approve-access" -H "Authorization: Bearer $ADMIN_TOKEN" || true
    curl_with_csrf -o /dev/null -X POST "$BASE_URL/api/admin/auth/operators/$OP_ID/unlock" -H "Authorization: Bearer $ADMIN_TOKEN" || true
  fi
  if [[ -n "$OP_PASS" ]]; then
    OP_TOKEN="$(extract_token "$OP_EMAIL" "$OP_PASS" 2>/dev/null || true)"
    if ! token_works "$OP_TOKEN"; then OP_TOKEN=""; fi
  fi
fi

discover_paths_from_api
discover_paths_from_fs
bootstrap_test_upload
[[ -n "$UPLOAD_PATH" ]] && echo "Using UPLOAD_PATH: $UPLOAD_PATH"
[[ -n "$MEDIA_PATH" ]] && echo "Using MEDIA_PATH: $MEDIA_PATH"

# 1
section 1
C1A="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/somefile.ts")"
C1B="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/somefile.tsx")"
echo "ts=$C1A tsx=$C1B"
[[ "$C1A" == "404" && "$C1B" == "404" ]] && mark 1 PASS "Source files blocked" || mark 1 FAIL "Expected 404/404"
echo "Result: ${STATUS[1]} - ${NOTE[1]}"

# 2
section 2
OUT2="$(rg -n -i -e "(api[_-]?key|client_secret|private[_-]?key|token|password)[[:space:]]*[:=][[:space:]]*['\"][^'\"]{8,}['\"]" frontend/src backend 2>&1 || true)"
echo "$OUT2"
[[ -n "$OUT2" ]] && mark 2 FAIL "Potential hardcoded credential pattern found" || mark 2 PASS "No obvious hardcoded credential literals"
echo "Result: ${STATUS[2]} - ${NOTE[2]}"

# 3
section 3
if [[ -z "$ADMIN_TOKEN" || -z "$OP_TOKEN" ]]; then
  mark 3 SKIP "Missing valid admin/operator token"
else
  C3O="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/api/admin/workers" -H "Authorization: Bearer $OP_TOKEN")"
  C3A="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/api/admin/workers" -H "Authorization: Bearer $ADMIN_TOKEN")"
  echo "operator=$C3O admin=$C3A"
  [[ "$C3O" == "403" && "$C3A" == "200" ]] && mark 3 PASS "RBAC enforced" || mark 3 FAIL "Expected operator=403 admin=200"
fi
echo "Result: ${STATUS[3]} - ${NOTE[3]}"

# 4
section 4
if command -v nuclei >/dev/null 2>&1; then
  C4="$(nuclei -u "$BASE_URL" -tags smuggling -silent 2>/dev/null || true)"
  echo "$C4"
  [[ -z "$C4" ]] && mark 4 PASS "No smuggling template hit" || mark 4 FAIL "Smuggling-related finding detected"
else
  mark 4 SKIP "nuclei not available"
fi
echo "Result: ${STATUS[4]} - ${NOTE[4]}"

# 5
section 5
C5="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/api/admin/workers")"
echo "status=$C5"
[[ "$C5" =~ ^(401|403)$ ]] && mark 5 PASS "Unauth access blocked" || mark 5 FAIL "Expected 401/403"
echo "Result: ${STATUS[5]} - ${NOTE[5]}"

# 6
section 6
if [[ -z "$UPLOAD_PATH" || -z "$ADMIN_TOKEN" ]]; then
  mark 6 SKIP "Need UPLOAD_PATH and admin token"
else
  UURL="$BASE_URL$UPLOAD_PATH"
  U1="$(curl -sS -o /dev/null -w '%{http_code}' "$UURL")"
  U2="$(curl -sS -o /dev/null -w '%{http_code}' "$UURL" -H "Authorization: Bearer $ADMIN_TOKEN")"
  echo "unauth=$U1 auth=$U2 path=$UPLOAD_PATH"
  [[ "$U1" =~ ^(401|403)$ && "$U2" == "200" ]] && mark 6 PASS "Unauth blocked, auth allowed" || mark 6 FAIL "Expected unauth=401/403 auth=200"
fi
echo "Result: ${STATUS[6]} - ${NOTE[6]}"

# 7
section 7
R7A="$(seq 1 200 | xargs -P30 -I{} curl -sS -o /dev/null -w '%{http_code}\n' "$BASE_URL/api/does-not-exist" | sort | uniq -c)"
R7B="$(seq 1 200 | xargs -P30 -I{} curl -sS -o /dev/null -w '%{http_code}\n' -H "X-Forwarded-For: 1.2.3.{}" "$BASE_URL/api/does-not-exist" | sort | uniq -c)"
echo "no-xff:"
echo "$R7A"
echo "with-xff:"
echo "$R7B"
if [[ "$R7A" == "$R7B" ]]; then
  mark 7 PASS "XFF did not change behavior"
else
  mark 7 FAIL "Behavior changed with spoofed XFF"
fi
echo "Result: ${STATUS[7]} - ${NOTE[7]}"

# 8
section 8
D8S="$(dig TXT magicboxhub.net +short | tr -d '\n')"
D8D="$(dig TXT _dmarc.magicboxhub.net +short | tr -d '\n')"
echo "SPF=$D8S"
echo "DMARC=$D8D"
if [[ "$D8S" == *"v=spf1"* && "$D8D" == *"v=DMARC1"* ]]; then
  mark 8 PASS "SPF and DMARC present"
else
  mark 8 FAIL "SPF and/or DMARC missing"
fi
echo "Result: ${STATUS[8]} - ${NOTE[8]}"

# 9
section 9
if [[ -z "$ADMIN_TOKEN" ]]; then
  mark 9 SKIP "Missing admin token"
else
  R9="$(seq 1 500 | xargs -P50 -I{} curl -sS -o /dev/null -w '%{http_code}\n' "$BASE_URL/api/violations?__rl={}" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Cache-Control: no-cache" | sort | uniq -c)"
  echo "$R9"
  echo "$R9" | rg -q '429' && mark 9 PASS "429 observed" || mark 9 FAIL "No 429 observed"
fi
echo "Result: ${STATUS[9]} - ${NOTE[9]}"

# 10
section 10
C10="$(curl -sSI "$BASE_URL/" | head -n1 | awk '{print $2}')"
echo "status=$C10"
[[ "$C10" == "405" ]] && mark 10 PASS "HEAD disabled" || mark 10 FAIL "Expected 405"
echo "Result: ${STATUS[10]} - ${NOTE[10]}"

# 11
section 11
H11="$(curl -sS -D- -o /dev/null "$BASE_URL/" | rg -i '^(x-frame-options:|content-security-policy:)' || true)"
echo "$H11"
if echo "$H11" | rg -qi 'x-frame-options:\s*DENY|frame-ancestors\s+''none'''; then
  mark 11 PASS "Clickjacking protections present"
else
  mark 11 FAIL "Missing clickjacking headers"
fi
echo "Result: ${STATUS[11]} - ${NOTE[11]}"

# 12
section 12
R12="$(rg -n "Query\\(\"token\"\\)|Query\\(\"auth\"\\)|access_token|Authorization.*Query" backend || true)"
echo "$R12"
[[ -z "$R12" ]] && mark 12 PASS "No token-in-query handler pattern found" || mark 12 FAIL "Potential token-in-query pattern found"
echo "Result: ${STATUS[12]} - ${NOTE[12]}"

# 13
section 13
H13="$(curl -sS -i -X OPTIONS "$BASE_URL/api/devices" -H "Origin: https://evil.example" -H "Access-Control-Request-Method: GET" -H "Access-Control-Request-Headers: authorization,content-type")"
echo "$H13" | sed -n '1,24p'
if echo "$H13" | rg -q "HTTP/.* 403" && ! echo "$H13" | rg -qi "access-control-allow-origin:\s*\*"; then
  mark 13 PASS "Untrusted origin blocked"
else
  mark 13 FAIL "CORS behavior unexpected"
fi
echo "Result: ${STATUS[13]} - ${NOTE[13]}"

# 14
section 14
S14="$(curl -sS -D- -o /dev/null "$BASE_URL/" | rg -i '^server:' || true)"
echo "$S14"
if echo "$S14" | rg -q '[0-9]+\.[0-9]'; then
  mark 14 FAIL "Server version disclosed"
else
  mark 14 PASS "No server version number disclosed"
fi
echo "Result: ${STATUS[14]} - ${NOTE[14]}"

# 15
section 15
# Verify CSRF protection behavior directly:
# - without X-CSRF-Token => 403
# - with X-CSRF-Token + cookie => non-403
PAY15='{"email":"invalid@example.com","password":"invalid"}'
CSRF_COOKIE15="$(mktemp /tmp/iris-csrf15.XXXXXX)"
CSRF_TOKEN15="$(curl -sS -c "$CSRF_COOKIE15" "$BASE_URL/api/auth/csrf-token" | jq -r '.csrfToken // empty')"
if [[ -z "$CSRF_TOKEN15" ]]; then
  mark 15 FAIL "Could not fetch CSRF token"
else
  C15A="$(curl -sS -o /dev/null -w '%{http_code}' -b "$CSRF_COOKIE15" -X POST "$BASE_URL/api/auth/login" -H "Content-Type: application/json" -d "$PAY15")"
  C15B="$(curl -sS -o /dev/null -w '%{http_code}' -b "$CSRF_COOKIE15" -X POST "$BASE_URL/api/auth/login" -H "Content-Type: application/json" -H "X-CSRF-Token: $CSRF_TOKEN15" -d "$PAY15")"
  echo "without_csrf=$C15A with_csrf=$C15B"
  if [[ "$C15A" == "403" && "$C15B" != "403" ]]; then
    mark 15 PASS "CSRF enforced (403 without token, accepted when token provided)"
  else
    mark 15 FAIL "Expected without_csrf=403 and with_csrf!=403"
  fi
fi
rm -f "$CSRF_COOKIE15"
if [[ -z "$ADMIN_TOKEN" && -n "$ADMIN_PASS" ]]; then
  ADMIN_TOKEN="$(extract_token "$ADMIN_EMAIL" "$ADMIN_PASS" 2>/dev/null || true)"
  if ! token_works "$ADMIN_TOKEN"; then ADMIN_TOKEN=""; fi
fi
echo "Result: ${STATUS[15]} - ${NOTE[15]}"

# 16
section 16
OUT16="$(rg -n -i -e "(api[_-]?key|client_secret|private[_-]?key)[[:space:]]*[:=][[:space:]]*['\"][^'\"]{8,}['\"]" frontend/src backend 2>&1 || true)"
echo "$OUT16"
[[ -n "$OUT16" ]] && mark 16 FAIL "Potential hardcoded API key literal found" || mark 16 PASS "No obvious hardcoded API-key literals"
echo "Result: ${STATUS[16]} - ${NOTE[16]}"

# 17
section 17
H17="$(curl -sS -D- -o /dev/null "$BASE_URL/" | rg -i '^(x-content-type-options:|x-frame-options:|strict-transport-security:|content-security-policy:|referrer-policy:|permissions-policy:)' || true)"
echo "$H17"
if echo "$H17" | rg -qi 'x-content-type-options:' && echo "$H17" | rg -qi 'x-frame-options:' && echo "$H17" | rg -qi 'strict-transport-security:'; then
  mark 17 PASS "Core security headers present"
else
  mark 17 FAIL "Missing one or more core headers"
fi
echo "Result: ${STATUS[17]} - ${NOTE[17]}"

# 18
section 18
if [[ -z "$ADMIN_TOKEN" || "$ADMIN_TOKEN" != *.*.* ]]; then
  mark 18 SKIP "Missing valid admin token"
else
  TTL="$(ADMIN_TOKEN="$ADMIN_TOKEN" python3 - <<'PY'
import os,base64,json
t=os.environ["ADMIN_TOKEN"].split(".")[1]
t+="="*((4-len(t)%4)%4)
c=json.loads(base64.urlsafe_b64decode(t))
print(int(c["exp"])-int(c["iat"]))
PY
)"
  echo "ttl_seconds=$TTL"
  [[ "$TTL" -ge 3000 && "$TTL" -le 7200 ]] && mark 18 PASS "TTL in expected range" || mark 18 FAIL "Unexpected TTL"
fi
echo "Result: ${STATUS[18]} - ${NOTE[18]}"

# 19
section 19
R19="$(curl -sS -i "$BASE_URL/api/does-not-exist")"
echo "$R19" | sed -n '1,24p'
if echo "$R19" | rg -q 'HTTP/.* 404' && echo "$R19" | grep -Fq '{"error":"Not found"}'; then
  mark 19 PASS "Non-verbose 404 JSON"
else
  mark 19 FAIL "Unexpected verbose/format response"
fi
echo "Result: ${STATUS[19]} - ${NOTE[19]}"

# 21 (before 20 so lockout does not poison this test)
section 21
if [[ -z "$OP_PASS" ]]; then
  mark 21 SKIP "Missing operator password"
else
  T1="$(extract_token "$OP_EMAIL" "$OP_PASS" 2>/dev/null || true)"
  T2="$(extract_token "$OP_EMAIL" "$OP_PASS" 2>/dev/null || true)"
  if [[ -z "$T1" || -z "$T2" ]]; then
    mark 21 FAIL "Could not obtain both operator tokens"
  else
    C21A="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/api/auth/me" -H "Authorization: Bearer $T1")"
    C21B="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/api/auth/me" -H "Authorization: Bearer $T2")"
    echo "token1=$C21A token2=$C21B"
    [[ "$C21A" == "401" && "$C21B" == "200" ]] && mark 21 PASS "Old token invalidated, new token valid" || mark 21 FAIL "Expected token1=401 token2=200"
  fi
fi
echo "Result: ${STATUS[21]} - ${NOTE[21]}"

# 20
section 20
if [[ "$RUN_LOCKOUT" -ne 1 ]]; then
  mark 20 SKIP "Skipped by default (use --run-lockout)"
else
  L20="$(for _ in 1 2 3 4; do curl_with_csrf -o /dev/null -w '%{http_code}\n' -X POST "$BASE_URL/api/auth/login" -H "Content-Type: application/json" -d "{\"email\":\"$OP_EMAIL\",\"password\":\"wrong\"}"; sleep 1; done)"
  echo "$L20"
  echo "$L20" | rg -q '423|429' && mark 20 PASS "Lockout/rate-limit observed" || mark 20 FAIL "No lockout/rate-limit observed"
fi
echo "Result: ${STATUS[20]} - ${NOTE[20]}"

# 22
section 22
refresh_auth_tokens
TOK22="$(pick_auth_token)"
if [[ -z "$TOK22" ]]; then
  mark 22 SKIP "Missing valid auth token"
else
  C22A="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/api/violations?limit=-1" -H "Authorization: Bearer $TOK22")"
  C22B="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/api/violations?sort=%3Cscript%3Ealert(1)%3C%2Fscript%3E" -H "Authorization: Bearer $TOK22")"
  C22C="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/api/violations?id=%27%20OR%201%3D1%20--" -H "Authorization: Bearer $TOK22")"
  echo "limit=-1:$C22A sort:<script>:$C22B id='OR1=1:$C22C"
  [[ "$C22A" == "400" && "$C22B" == "400" && "$C22C" == "400" ]] && mark 22 PASS "Invalid inputs rejected with 400" || mark 22 FAIL "Expected all 400"
fi
echo "Result: ${STATUS[22]} - ${NOTE[22]}"

# 23
section 23
refresh_auth_tokens
TOK23="$(pick_auth_token)"
if [[ -z "$MEDIA_PATH" || -z "$TOK23" ]]; then
  mark 23 SKIP "Need MEDIA_PATH and valid auth token"
else
  MURL="$BASE_URL$MEDIA_PATH"
  M1="$(curl -sS -o /dev/null -w '%{http_code}' "$MURL")"
  M2="$(curl -sS -o /dev/null -w '%{http_code}' "$MURL" -H "Authorization: Bearer $TOK23")"
  echo "unauth=$M1 auth=$M2 path=$MEDIA_PATH"
  [[ "$M1" =~ ^(401|403)$ && "$M2" == "200" ]] && mark 23 PASS "Unauth blocked, auth allowed" || mark 23 FAIL "Expected unauth=401/403 auth=200"
fi
echo "Result: ${STATUS[23]} - ${NOTE[23]}"

# 24
section 24
if command -v nuclei >/dev/null 2>&1; then
  C24="$(nuclei -u "$BASE_URL" -id waf-detect -silent 2>/dev/null || true)"
  echo "$C24"
  [[ -n "$C24" ]] && mark 24 PASS "WAF detected by nuclei" || mark 24 FAIL "WAF not detected"
else
  S24="$(curl -sS -D- -o /dev/null "$BASE_URL/" | rg -i '^server:' || true)"
  echo "$S24"
  echo "$S24" | rg -qi 'cloudflare|akamai|fastly' && mark 24 PASS "WAF/CDN edge detected by header" || mark 24 FAIL "No edge/WAF indicator"
fi
echo "Result: ${STATUS[24]} - ${NOTE[24]}"

echo
echo "==================== Clean Status List ===================="
for id in "${IDS[@]}"; do
  printf "#%-2s %-4s %s\n" "$id" "${STATUS[$id]}" "${TITLE[$id]}"
done
echo "-----------------------------------------------------------"
echo "PASS=$PASS_COUNT FAIL=$FAIL_COUNT SKIP=$SKIP_COUNT"
echo "==========================================================="

if [[ "$WRITE_MD" -eq 1 ]]; then
  OUT_MD="docs/CHECKLIST.md"
  {
    echo "# Security Checklist (24 Issues + Extra)"
    echo
    echo "- Date: $(date -u '+%Y-%m-%d %H:%M:%SZ')"
    echo "- Base URL: \`$BASE_URL\`"
    echo
    echo "| Issue | Status | Note |"
    echo "|---|---|---|"
    for id in "${IDS[@]}"; do
      st="${STATUS[$id]}"
      icon="⏭️"
      [[ "$st" == "PASS" ]] && icon="✅"
      [[ "$st" == "FAIL" ]] && icon="❌"
      echo "| #$id ${TITLE[$id]} | $icon $st | ${NOTE[$id]} |"
    done
    echo
    echo "## Extra"
    echo "- Extra check: upload/media path auto-discovery via API/filesystem/probe upload."
    echo "- Summary: PASS=$PASS_COUNT, FAIL=$FAIL_COUNT, SKIP=$SKIP_COUNT"
  } > "$OUT_MD"
  # Keep old file name up to date for continuity.
  cp -f "$OUT_MD" "docs/REMAINING_ISSUES_STATUS_LATEST.md"
  echo "Wrote: $OUT_MD"
  echo "Wrote: docs/REMAINING_ISSUES_STATUS_LATEST.md"
fi
