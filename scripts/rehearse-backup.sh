#!/usr/bin/env bash
# Rehearses the backup and restore procedure of canonical doc 0006 section 8 on the example
# install (WS-068): seed through the API, back up with pg_dump, destroy the install, restore
# into a new one, and check the app serves the same data with the same rights. Runs in CI
# (.github/workflows/image.yml) and locally with Docker and Node.js:
#   bash scripts/rehearse-backup.sh
# Its own Compose project, a throwaway env file (.env.rehearsal, ignored by git) and port
# 3997. Everything is removed at the end, whatever happens.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT=opanel-rehearsal
PORT=3997
URL="http://localhost:${PORT}"
ENV_FILE=.env.rehearsal
export OPANEL_ENV_FILE="$ENV_FILE" OPANEL_PORT="$PORT"
compose() { docker compose -p "$PROJECT" -f compose.production.yaml "$@"; }
WORK="$(mktemp -d)"
COOKIES="${WORK}/cookies"
BACKUP="${WORK}/opanel-backup.dump"

fail() {
  echo "FAIL: $*" >&2
  compose logs --no-color --tail 50 >&2 || true
  exit 1
}

cleanup() {
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$ENV_FILE" "$WORK"
}
trap cleanup EXIT

command -v node >/dev/null || fail "this script needs Node.js on the PATH (it reads the API's JSON)"

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

# One field of a JSON document on stdin, by a JavaScript path such as `.items[0].id`.
field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const v=eval("JSON.parse(s)"+process.argv[1]);process.stdout.write(String(v))})' "$1"; }
# Keeps only the named fields of an object, or of each of a page's items, and prints it.
reduce() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const keep=process.argv[1].split(","),pick=o=>Object.fromEntries(keep.map(k=>[k,o[k]]));
  const j=JSON.parse(s);console.log(JSON.stringify(j.items?j.items.map(pick):pick(j),null,1))})' "$1"; }

api() { curl -s -b "$COOKIES" -c "$COOKIES" -H "Origin: ${URL}" "$@"; }
# A JSON request: the path, the body, then any further curl arguments.
send() {
  local method=$1 path=$2 data=$3
  shift 3
  api -X "$method" "${URL}/api/v1${path}" -H "Content-Type: application/json" --data "$data" "$@"
}
post() { send POST "$@"; }
patch() { send PATCH "$@"; }

wait_healthy() {
  for _ in $(seq 1 60); do
    state="$(compose ps -a migrate --format '{{.State}} {{.ExitCode}}')"
    [[ "$state" == exited* ]] && break
    sleep 2
  done
  [[ "$state" == "exited 0" ]] || fail "migrate did not exit 0 (state: ${state})"
  for _ in $(seq 1 60); do
    health="$(docker inspect --format '{{.State.Health.Status}}' "$(compose ps -q app)")"
    [[ "$health" == "healthy" ]] && break
    sleep 2
  done
  [[ "$health" == "healthy" ]] || fail "the app's container is ${health}"
  code="$(curl -s -o /dev/null -w '%{http_code}' "${URL}/api/v1/health")"
  [[ "$code" == "200" ]] || fail "GET /api/v1/health answered ${code}"
}

owner_sql() { compose exec -T db psql -U opanel -d opanel -v ON_ERROR_STOP=1 -qtAc "$1"; }

# Every table of the app and the migration journal, with its number of rows.
row_counts() {
  owner_sql "select table_schema || '.' || table_name || ' ' ||
      (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I',
        table_schema, table_name), false, true, '')))[1]::text
    from information_schema.tables
    where table_schema in ('public', 'drizzle') and table_type = 'BASE TABLE'
    order by 1"
}

# The seeded data as the API shows it, reduced to fields that do not change on a restore.
api_view() {
  api "${URL}/api/v1/projects/BAK" | reduce id,key,name,version
  api "${URL}/api/v1/projects/BAK/tasks" | reduce id,key,title,columnId,version
  api "${URL}/api/v1/tasks/${TASK}/comments" | reduce id,body,author
}

echo "== install and seed through the API"
compose up -d --build
wait_healthy
body="{\"name\":\"Backup Admin\",\"email\":\"backup.admin@example.com\","
body+="\"password\":\"a backup admin password, long enough\",\"setupToken\":\"${SETUP_TOKEN}\"}"
code="$(post /setup "$body" -o /dev/null -w '%{http_code}')"
[[ "$code" == 2* ]] || fail "setup answered ${code}"
post /projects '{"key":"BAK","name":"Backed up"}' | field .key | grep -qx BAK || fail "no project"
for title in "First task" "Second task" "Third task"; do
  post /projects/BAK/tasks "{\"title\":\"${title}\"}" >"${WORK}/task.json"
done
TASK="$(field .id <"${WORK}/task.json")"
version="$(field .version <"${WORK}/task.json")"
column="$(api "${URL}/api/v1/projects/BAK/columns" | field '.items[1].id')"
version="$(post "/tasks/${TASK}/move" "{\"columnId\":\"${column}\",\"version\":${version}}" |
  field .version)"
version="$(patch "/tasks/${TASK}" "{\"title\":\"Third task, renamed\",\"version\":${version}}" |
  field .version)"
[[ "$version" == 3 ]] || fail "the seeded task is at version ${version}, not 3"
post "/tasks/${TASK}/comments" '{"body":"A first comment."}' >/dev/null
post "/tasks/${TASK}/comments" '{"body":"A second comment, **in Markdown**."}' >/dev/null

echo "== record what is there"
row_counts >"${WORK}/counts.before"
api_view >"${WORK}/api.before"
grep -q "Third task, renamed" "${WORK}/api.before" || fail "the seeded data is not in the API"
grep -q "A second comment" "${WORK}/api.before" || fail "the seeded comments are not in the API"

echo "== back up, while the app runs"
compose exec -T db pg_dump -U opanel -d opanel --format=custom >"$BACKUP"
[[ "$(head -c 5 "$BACKUP")" == "PGDMP" ]] || fail "the backup is not a pg_dump custom archive"

echo "== destroy the install, its volume included"
compose down -v --remove-orphans >/dev/null

echo "== restore into a new install"
compose up -d db
for _ in $(seq 1 60); do
  # Over TCP: during its first start the image's entrypoint runs a socket-only server for
  # the init scripts, which must not be mistaken for the real one.
  compose exec -T db pg_isready -h 127.0.0.1 -U opanel -d opanel >/dev/null 2>&1 && break
  sleep 2
done
compose exec -T db pg_restore -U opanel -d opanel --exit-on-error <"$BACKUP" ||
  fail "pg_restore failed"
compose up -d
wait_healthy

echo "== every table has the rows it had"
row_counts >"${WORK}/counts.after"
diff "${WORK}/counts.before" "${WORK}/counts.after" || fail "the row counts differ"

echo "== the Admin signs in with their password and reads the same data"
rm -f "$COOKIES"
code="$(post /auth/sign-in \
  '{"email":"backup.admin@example.com","password":"a backup admin password, long enough"}' \
  -o /dev/null -w '%{http_code}')"
[[ "$code" == 2* ]] || fail "signing in on the restored install answered ${code}"
api_view >"${WORK}/api.after"
diff "${WORK}/api.before" "${WORK}/api.after" || fail "the API shows different data"

echo "== the app still connects as the runtime role, with the same rights"
users="$(owner_sql "select string_agg(distinct usename, ',') from pg_stat_activity
   where datname = 'opanel' and backend_type = 'client backend' and pid <> pg_backend_pid()")"
[[ "$users" == "opanel_app" ]] || fail "the app's connections use: ${users}"
for statement in "truncate audit_log" "delete from task_events"; do
  set +e
  output="$(compose exec -T -e PGPASSWORD="$APP_DB_PASSWORD" db \
    psql -h 127.0.0.1 -U opanel_app -d opanel -c "$statement" 2>&1)"
  status=$?
  set -e
  [[ $status -ne 0 && "$output" == *"permission denied"* ]] ||
    fail "'${statement}' as opanel_app: ${output}"
done
code="$(post /projects/BAK/tasks '{"title":"After the restore"}' -o /dev/null -w '%{http_code}')"
[[ "$code" == "201" ]] || fail "creating a task after the restore answered ${code}"

echo "OK: the backup restores into a new install, which serves the same data."
