#!/usr/bin/env bash
# Runs the example install behind the example reverse proxy (docker/production/Caddyfile,
# the `proxy` profile of compose.production.yaml) and checks the requirements of canonical
# doc 0006 section 4 through real traffic (WS-067). Runs in CI and locally with Docker:
#   bash scripts/smoke-proxy.sh
# Its own Compose project, a throwaway env file (.env.smoke-proxy, ignored by git), ports
# 8080 and 8443, and Caddy's internal test CA (curl --insecure: the test does not need to
# trust it). Everything is removed at the end, whatever happens.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT=opanel-smoke-proxy
HTTP_PORT=8080
HTTPS_PORT=8443
SITE="https://localhost:${HTTPS_PORT}"
ENV_FILE=.env.smoke-proxy
export OPANEL_ENV_FILE="$ENV_FILE" OPANEL_PORT=3998 \
  OPANEL_HTTP_PORT="$HTTP_PORT" OPANEL_HTTPS_PORT="$HTTPS_PORT" \
  OPANEL_SITE="https://localhost:${HTTPS_PORT}" OPANEL_CADDY_TLS="tls internal"
compose() { docker compose -p "$PROJECT" -f compose.production.yaml --profile proxy "$@"; }
COOKIES="$(mktemp)"
https() { curl --insecure -s "$@"; }

fail() {
  echo "FAIL: $*" >&2
  compose logs --no-color --tail 50 >&2 || true
  exit 1
}

cleanup() {
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f "$ENV_FILE" "$COOKIES"
}
trap cleanup EXIT

secret() { od -An -tx1 -N32 /dev/urandom | tr -d ' \n'; }
DB_PASSWORD="$(secret)"
APP_DB_PASSWORD="$(secret)"
SETUP_TOKEN="$(secret)"
cat >"$ENV_FILE" <<EOF
POSTGRES_PASSWORD=${DB_PASSWORD}
OPANEL_APP_DB_PASSWORD=${APP_DB_PASSWORD}
DATABASE_URL=postgres://opanel_app:${APP_DB_PASSWORD}@db:5432/opanel
MIGRATION_DATABASE_URL=postgres://opanel:${DB_PASSWORD}@db:5432/opanel
BETTER_AUTH_SECRET=$(secret)
APP_URL=${SITE}
SETUP_TOKEN=${SETUP_TOKEN}
CLIENT_IP_HEADER=x-forwarded-for
EOF

echo "== build and start, behind the proxy"
compose up -d --build
for _ in $(seq 1 60); do
  code="$(https -o /dev/null -w '%{http_code}' "${SITE}/api/v1/health" || true)"
  [[ "$code" == "200" ]] && break
  sleep 2
done
[[ "$code" == "200" ]] || fail "GET ${SITE}/api/v1/health answered ${code}"

echo "== HTTP redirects to HTTPS"
location="$(curl -s -o /dev/null -w '%{redirect_url}' "http://localhost:${HTTP_PORT}/sign-in")"
[[ "$location" == "${SITE}/sign-in" ]] || fail "http:// redirected to '${location}'"

echo "== pages and the API carry Strict-Transport-Security"
for path in /sign-in /api/v1/health; do
  hsts="$(https -D - -o /dev/null "${SITE}${path}" | tr -d '\r' |
    sed -n 's/^[Ss]trict-[Tt]ransport-[Ss]ecurity: //p')"
  [[ "$hsts" == "max-age=31536000" ]] || fail "${path} sent Strict-Transport-Security '${hsts}'"
done

echo "== setup with the token, then a project"
body="{\"name\":\"Proxy Admin\",\"email\":\"proxy.admin@example.com\","
body+="\"password\":\"a proxy admin password, long enough\",\"setupToken\":\"${SETUP_TOKEN}\"}"
code="$(https -c "$COOKIES" -o /dev/null -w '%{http_code}' -X POST "${SITE}/api/v1/setup" \
  -H "Content-Type: application/json" -H "Origin: ${SITE}" --data "$body")"
[[ "$code" == 2* ]] || fail "setup answered ${code}"
code="$(https -b "$COOKIES" -o /dev/null -w '%{http_code}' -X POST "${SITE}/api/v1/projects" \
  -H "Content-Type: application/json" -H "Origin: ${SITE}" --data '{"key":"PRX","name":"Proxy"}')"
[[ "$code" == "201" ]] || fail "creating a project answered ${code}"

echo "== the events stream passes through unbuffered"
STREAM="$(mktemp)"
https -b "$COOKIES" --no-buffer -m 8 "${SITE}/api/v1/projects/PRX/events" >"$STREAM" &
reader=$!
for _ in $(seq 1 20); do
  grep -q ": connected" "$STREAM" && break
  sleep 0.1
done
grep -q ": connected" "$STREAM" || fail "no ': connected' within 2 s through the proxy"
code="$(https -b "$COOKIES" -o /dev/null -w '%{http_code}' -X POST "${SITE}/api/v1/projects/PRX/tasks" \
  -H "Content-Type: application/json" -H "Origin: ${SITE}" --data '{"title":"Through the proxy"}')"
[[ "$code" == "201" ]] || fail "creating a task answered ${code}"
for _ in $(seq 1 20); do
  grep -q "event: task.created" "$STREAM" && break
  sleep 0.1
done
grep -q "event: task.created" "$STREAM" || fail "the task.created event did not arrive within 2 s"
kill "$reader" 2>/dev/null || true
rm -f "$STREAM"

echo "== bodies: 700 KiB gets the app's 413, 2 MiB the proxy's"
big() { head -c "$1" /dev/zero | tr '\0' 'a'; }
printf '{"key":"BIG","name":"%s"}' "$(big 716800)" >"$COOKIES.body"
answer="$(https -b "$COOKIES" -w '\n%{http_code}' -X POST "${SITE}/api/v1/projects" \
  -H "Content-Type: application/json" -H "Origin: ${SITE}" --data-binary "@$COOKIES.body")"
[[ "$answer" == *'"payload_too_large"'*$'\n'413 ]] || fail "700 KiB: ${answer: -120}"
printf '{"key":"BIG","name":"%s"}' "$(big 2097152)" >"$COOKIES.body"
answer="$(https -b "$COOKIES" -w '\n%{http_code}' -X POST "${SITE}/api/v1/projects" \
  -H "Content-Type: application/json" -H "Origin: ${SITE}" --data-binary "@$COOKIES.body")"
rm -f "$COOKIES.body"
[[ "$answer" == *$'\n'413 && "$answer" != *payload_too_large* ]] || fail "2 MiB: ${answer: -120}"

echo "== the client's own X-Forwarded-For is ignored: one client, one limiter"
for attempt in $(seq 1 51); do
  code="$(https -o /dev/null -w '%{http_code}' -X POST "${SITE}/api/v1/auth/sign-in" \
    -H "Content-Type: application/json" -H "Origin: ${SITE}" \
    -H "X-Forwarded-For: 203.0.113.${attempt}" \
    --data "{\"email\":\"nobody${attempt}@example.com\",\"password\":\"not the right one\"}")"
done
[[ "$code" == "429" ]] || fail "the 51st sign-in from one client answered ${code}, not 429"

echo "OK: behind the example proxy, every requirement holds."
