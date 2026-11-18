#!/bin/sh
# Runs once, when the example install's database volume is new (WS-063): creates the login
# role the app connects as. Migration 0014 finds it and grants it the app's rights; the
# migrations themselves connect as POSTGRES_USER, the schema owner.
set -eu
psql -v ON_ERROR_STOP=1 -v password="$OPANEL_APP_DB_PASSWORD" \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE ROLE opanel_app LOGIN PASSWORD :'password';
SQL
