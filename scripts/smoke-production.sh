#!/usr/bin/env bash
# Builds the production image and checks the example install of compose.production.yaml
# (WS-062 section 6). Runs in CI (.github/workflows/image.yml) and locally with Docker:
#   bash scripts/smoke-production.sh
# It uses its own Compose project, a throwaway env file (.env.smoke, ignored by git) and
# port 3999, and removes the containers and the volume at the end, whatever happens.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT=opanel-smoke
PORT=3999
URL="http://localhost:${PORT}"
ENV_FILE=.env.smoke
export OPANEL_ENV_FILE="$ENV_FILE" OPANEL_PORT="$PORT"
compose() { docker compose -p "$PROJECT" -f compose.production.yaml "$@"; }

fail() {
  echo "FAIL: $*" >&2
  compose logs --no-color --tail 50 >&2 || true
  exit 1
}

cleanup() {
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f "$ENV_FILE"
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
APP_URL=${URL}
SETUP_TOKEN=${SETUP_TOKEN}
EOF

echo "== build and start"
compose up -d --build

echo "== migrate ran once and succeeded"
for _ in $(seq 1 60); do
  state="$(compose ps -a migrate --format '{{.State}} {{.ExitCode}}')"
  [[ "$state" == exited* ]] && break
  sleep 2
done
[[ "$state" == "exited 0" ]] || fail "migrate did not exit 0 (state: ${state})"

echo "== the app answers healthy"
for _ in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "${URL}/api/v1/health" || true)"
  [[ "$code" == "200" ]] && break
  sleep 2
done
[[ "$code" == "200" ]] || fail "GET /api/v1/health answered ${code}"

app="$(compose ps -q app)"
for _ in $(seq 1 30); do
  health="$(docker inspect --format '{{.State.Health.Status}}' "$app")"
  [[ "$health" == "healthy" ]] && break
  sleep 2
done
[[ "$health" == "healthy" ]] || fail "the container's health check says ${health}"

echo "== the first-run setup needs the setup token"
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "${URL}/api/v1/setup" \
  -H "Content-Type: application/json" -H "Origin: ${URL}" \
  --data '{"name":"Smoke","email":"smoke@example.com","password":"a smoke test password, long enough"}')"
[[ "$code" == "403" ]] || fail "POST /api/v1/setup without the token answered ${code}"

echo "== the app is published on the loopback interface only"
binding="$(compose port app 3000)"
[[ "$binding" == 127.0.0.1:* ]] || fail "the app is published on ${binding}"

echo "== the app runs as a non-root user"
uid="$(compose exec -T app id -u)"
[[ "$uid" != "0" ]] || fail "the app runs as root"

echo "== no development dependency in the image"
dev="$(compose exec -T app sh -c 'ls node_modules/.bin' | grep -xE 'tsx|vitest|playwright|drizzle-kit|eslint' || true)"
[[ -z "$dev" ]] || fail "development dependencies in the image: ${dev}"

echo "== the app connects as the runtime role (WS-063)"
users="$(compose exec -T db psql -U opanel -d opanel -tAc   "select string_agg(distinct usename, ',') from pg_stat_activity
   where datname = 'opanel' and backend_type = 'client backend' and pid <> pg_backend_pid()")"
[[ "$users" == "opanel_app" ]] || fail "the app's connections use: ${users}"

echo "== the runtime role cannot truncate the audit log"
set +e
output="$(compose exec -T -e PGPASSWORD="$APP_DB_PASSWORD" db   psql -h 127.0.0.1 -U opanel_app -d opanel -c "truncate audit_log" 2>&1)"
status=$?
set -e
[[ $status -ne 0 && "$output" == *"permission denied"* ]] || fail "truncate as opanel_app: ${output}"

echo "== migrate again: nothing to do, exits 0"
compose run --rm -T migrate >/dev/null || fail "a second migrate failed"

echo "== migrate with a wrong password fails and does not print it"
set +e
output="$(compose run --rm -T \
  -e MIGRATION_DATABASE_URL="postgres://opanel:wrong-smoke-password@db:5432/opanel" migrate 2>&1)"
status=$?
set -e
[[ $status -ne 0 ]] || fail "migrate with a wrong password exited 0"
[[ "$output" != *wrong-smoke-password* ]] || fail "migrate printed the password"
[[ "$output" == *"Migrations failed:"* ]] || fail "migrate printed no failure line: ${output}"

echo "== a bad environment stops the app with the validation message"
set +e
output="$(compose run --rm -T --no-deps -e APP_URL=not-a-url app 2>&1)"
status=$?
set -e
[[ $status -ne 0 ]] || fail "the app started with APP_URL=not-a-url"
[[ "$output" == *"Invalid environment configuration"* ]] || fail "no validation message: ${output}"

echo "== recover-admin prints a link for the Admin, and refuses anyone else (WS-065)"
body="{\"name\":\"Smoke Admin\",\"email\":\"smoke.admin@example.com\","
body+="\"password\":\"a smoke admin password, long enough\",\"setupToken\":\"${SETUP_TOKEN}\"}"
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "${URL}/api/v1/setup" \
  -H "Content-Type: application/json" -H "Origin: ${URL}" --data "$body")"
[[ "$code" == 2* ]] || fail "setup with the token answered ${code}"
output="$(compose run --rm -T app node dist/recover-admin.mjs --email smoke.admin@example.com 2>&1)" ||
  fail "recover-admin failed: ${output}"
[[ "$output" == *"${URL}/accept#"* ]] || fail "recover-admin printed no link: ${output}"
set +e
output="$(compose run --rm -T app node dist/recover-admin.mjs --email nobody@example.com 2>&1)"
status=$?
set -e
[[ $status -eq 1 && "$output" == *"No human account"* ]] || fail "recover-admin for nobody: ${status} ${output}"

echo "== a migration the app does not know stops it, with the message (WS-064)"
owner_sql() { compose exec -T db psql -U opanel -d opanel -qtAc "$1"; }
owner_sql "insert into drizzle.__drizzle_migrations (hash, created_at) values ('smoke-future', 9999999999999)"
compose restart app >/dev/null
for _ in $(seq 1 30); do
  logs="$(compose logs --no-color app 2>&1)"
  [[ "$logs" == *"does not know"* ]] && break
  sleep 2
done
[[ "$logs" == *"does not know"* ]] || fail "the app did not refuse an unknown migration"

echo "== once it is gone, the app starts and is healthy again"
owner_sql "delete from drizzle.__drizzle_migrations where hash = 'smoke-future'"
compose restart app >/dev/null
for _ in $(seq 1 60); do
  health="$(docker inspect --format '{{.State.Health.Status}}' "$(compose ps -q app)")"
  [[ "$health" == "healthy" ]] && break
  sleep 2
done
[[ "$health" == "healthy" ]] || fail "the app is ${health} after the unknown migration was removed"

echo "OK: the production image and the example install pass every check."
