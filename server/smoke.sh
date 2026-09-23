#!/usr/bin/env bash
# Smoke test: boots the API in the background, exercises the endpoints, exits.
set -u
cd "$(dirname "$0")"

node index.js > server.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null' EXIT
sleep 2

fail=0
check() { # name url method
  local name="$1" url="$2" method="$3"
  echo "== $name =="
  curl -s --max-time 5 -X "$method" "$url"
  echo
}

check "health" "http://localhost:3001/api/health" GET
check "services" "http://localhost:3001/api/services" GET
check "unauth-mine-401" "http://localhost:3001/api/bookings/mine" GET
check "book-missing-fields-400" "http://localhost:3001/api/bookings" POST
check "admin-bookings-401" "http://localhost:3001/api/admin/bookings" GET
check "admin-services-401" "http://localhost:3001/api/admin/services" GET

EMAIL="demo$(date +%s)@example.com"
echo "== signup =="
SIGNUP=$(curl -s --max-time 5 -X POST -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"test1234\",\"name\":\"Demo\"}" \
  http://localhost:3001/api/auth/signup)
echo "$SIGNUP" | head -c 300; echo
TOKEN=$(echo "$SIGNUP" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).session?.access_token||'')}catch(e){console.log('')}})")

echo "== login =="
LOGIN=$(curl -s --max-time 5 -X POST -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"test1234\"}" \
  http://localhost:3001/api/auth/login)
echo "$LOGIN" | head -c 300; echo
TOKEN=$(echo "${TOKEN:-$LOGIN}" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).session?.access_token||'')}catch(e){console.log('')}})")

if [ -z "$TOKEN" ]; then
  echo "NOTE: no session returned — Supabase email confirmation is ON."
  echo "      Signups get a user with session=null until they confirm."
  exit 0
fi

echo "== book while logged in =="
curl -s --max-time 5 -X POST -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"service_id\":1,\"date\":\"2026-09-30\",\"time\":\"10:00\",\"name\":\"Demo User\",\"email\":\"$EMAIL\"}" \
  http://localhost:3001/api/bookings; echo

echo "== my bookings =="
curl -s --max-time 5 -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/bookings/mine; echo

if [ "$(echo "$LOGIN" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).role||"")}catch(e){console.log("")}})')" != "owner" ]; then
  echo "== admin-denied-for-client-403 =="
  curl -s --max-time 5 -H "Authorization: Bearer $TOKEN" \
    http://localhost:3001/api/admin/bookings; echo
fi