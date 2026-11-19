# Operating Opanel

This guide is for the operator of an Opanel install: someone who knows Docker and
PostgreSQL, but not Opanel. It covers installing, upgrading, backing up and restoring,
getting back in, routine maintenance, storage and logs. The design behind it is canonical
doc [0006](canonical/0006-operations.md).

Every command given for the example install is one that CI runs on every change to the
image, through the scripts of the image workflow (`scripts/smoke-production.sh`,
`scripts/smoke-proxy.sh`, `scripts/rehearse-backup.sh`). The two procedures CI does not
rehearse say so where they appear.

## Before you start

- **A Linux host with Docker and Docker Compose.** The commands below run in a checkout of
  this repository, where `compose.production.yaml` is.
- **A public name and HTTPS.** Opanel serves plain HTTP on the host's loopback interface;
  a reverse proxy in front of it terminates HTTPS (see "Reverse proxy and HTTPS"). The
  repository includes an example one.
- **Exactly one app process.** Open boards keep a Server-Sent Events stream, and the event
  hub that feeds it lives in the process's memory (canonical doc
  [0002](canonical/0002-realtime-sync.md)). Do not run two app containers against the same
  database, and do not deploy Opanel to serverless or edge hosting: it must be a
  long-lived Node.js server.

The example install, [`compose.production.yaml`](../compose.production.yaml), is an
example, not the only supported setup. It runs:

- `db`: PostgreSQL 18, its data in the `db-data` volume;
- `migrate`: applies pending migrations once, then exits;
- `app`: Opanel, started only after `migrate` succeeded, published on `127.0.0.1:3000`;
- `proxy`: the example HTTPS proxy (Caddy), only with `--profile proxy`.

The database has two roles. `opanel` owns the schema; `migrate` and backups use it.
`opanel_app` is what the app connects as: it can read and write the application's data,
but cannot drop or alter tables, `TRUNCATE`, or change the audit log or the task history
(WS-063).

## Install

1. Copy the env file and fill it in. It holds every secret of the install and is ignored
   by git:

   ```bash
   cp .env.production.example .env.production
   ```

   - `POSTGRES_PASSWORD` and `OPANEL_APP_DB_PASSWORD`: one `openssl rand -hex 32` each.
     Put them in `MIGRATION_DATABASE_URL` and `DATABASE_URL` as the file shows.
   - `BETTER_AUTH_SECRET`: `openssl rand -base64 32`. Changing it later signs everyone out.
   - `APP_URL`: the public `https://` address, with no path.
   - `SETUP_TOKEN`: `openssl rand -hex 32`. On a production server the first-run setup
     refuses to create the first Admin without it.
   - `CLIENT_IP_HEADER`: see "Reverse proxy and HTTPS".

2. Build and start:

   ```bash
   docker compose -f compose.production.yaml up -d --build
   ```

   `migrate` creates the schema and exits; the app starts after it and is healthy within
   a minute (`docker compose -f compose.production.yaml ps`).

3. Open `APP_URL` in a browser. The setup page asks for the first Admin's name, email and
   password, and for the setup token. Once the first Admin exists the setup page refuses
   every request; you may then remove `SETUP_TOKEN` from the env file.

Keep `.env.production` with your backups: a restored database is no use without the
passwords and `BETTER_AUTH_SECRET`.

## Reverse proxy and HTTPS

Whatever proxy you use, it must:

1. **Forward to the one app process**, and put the client's address in a header that
   overwrites anything the client sent. Set `CLIENT_IP_HEADER` to that header's name (for
   example `x-forwarded-for`): the sign-in limiter then counts attempts per client
   address as well as per email. Without it the app warns at start-up that attempts are
   limited per email only. Never set it when no proxy overwrites the header: clients
   could then choose their own address.
2. **Not buffer the events stream**, `GET /api/v1/projects/{projectId}/events`, and let
   its responses stay open far longer than the 25-second heartbeat. Opanel sends
   `X-Accel-Buffering: no`, which nginx honours.
3. **Accept request bodies of at least 512 KiB**, and refuse larger ones itself. Opanel
   answers `413` above 512 KiB; a proxy limit of 1 MB keeps anything larger from reaching
   it.
4. **Redirect HTTP to HTTPS.**

When `APP_URL` starts with `https://`, Opanel sends `Strict-Transport-Security` itself;
the proxy need not add it.

### The example proxy: Caddy

[`docker/production/Caddyfile`](../docker/production/Caddyfile) does all four, and obtains
and renews the certificate. Set `OPANEL_SITE` to your public name (for example
`opanel.example.com`) in the shell or in a `.env` file next to `compose.production.yaml`
(not in `.env.production`: the proxy faces the internet and sees none of the app's
secrets), set `APP_URL=https://opanel.example.com` and `CLIENT_IP_HEADER=x-forwarded-for`
in `.env.production`, and start with the profile:

```bash
docker compose -f compose.production.yaml --profile proxy up -d --build
```

Ports 80 and 443 of the host must reach it, and the name must resolve to the host, for
the certificate to be issued.

### nginx

Not rehearsed by CI; the Caddy example is the tested one. The same four requirements, in
the `server` blocks of your site:

```nginx
server {
    listen 80;
    server_name opanel.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name opanel.example.com;
    # ssl_certificate and ssl_certificate_key: your certificate.

    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
    }

    location /api/v1/projects/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_buffering off;
        proxy_read_timeout 1h;
    }
}
```

`$remote_addr`, not `$proxy_add_x_forwarded_for`: the header must hold only the address
nginx saw. Then `CLIENT_IP_HEADER=x-forwarded-for`.

## Upgrade

Not yet rehearsed from one release to the next: there is no tagged release so far. Each
migration is tested against a database built by the earlier ones, and the app refuses to
start on a schema it does not match. Opanel has no zero-downtime upgrade: boards go
offline for the length of the migration.

1. Back up (see "Backup and restore") and keep the backup until the new version runs.
2. Check out the new version and build its image:

   ```bash
   git fetch --tags
   git checkout <version>
   docker compose -f compose.production.yaml build
   ```

3. Stop the app, apply the new migrations, and start the new version:

   ```bash
   docker compose -f compose.production.yaml stop app
   docker compose -f compose.production.yaml run --rm migrate
   docker compose -f compose.production.yaml up -d
   ```

4. Check that it is healthy:

   ```bash
   curl -fsS http://127.0.0.1:3000/api/v1/health
   ```

Each migration runs in a transaction: a failed `migrate` leaves the schema as it was, and
prints the error class and code, never the connection string. Migrations only go forward.
To go back to the previous version, check it out again and restore the backup into a new
install, as below.

If the app and the database do not match, the app stops at start-up and its log names both
sides, for example "The database schema is behind this version of Opanel: its last
migration is …, this version needs …. Run migrate first." A database newer than the app
means the app is the older version: start the version that migrated it, or restore.

## Backup and restore

### Backing up

Back up with the database server's own `pg_dump`, as the owner, while the app runs:
`pg_dump` takes a consistent snapshot.

```bash
docker compose -f compose.production.yaml exec -T db pg_dump -U opanel -d opanel --format=custom >opanel-backup.dump
```

Schedule it as often as you can afford to lose work (daily at least), keep several, store
them off the host, and keep `.env.production` with them. Opanel does not run backups
itself.

### Restoring into a new install

CI does exactly this every week (`scripts/rehearse-backup.sh`): it seeds an install,
backs it up, destroys it with its volume, restores into a new one and checks every row,
the sign-in and the runtime role's rights.

1. Start from an empty database: a new host, or the old install removed with its volume
   (`down -v` deletes the data; be sure the backup is good first):

   ```bash
   docker compose -f compose.production.yaml down -v
   docker compose -f compose.production.yaml up -d db
   ```

2. Wait until PostgreSQL accepts connections over TCP. On a new volume, it first runs its
   init scripts (which create `opanel_app`) on a socket-only server:

   ```bash
   docker compose -f compose.production.yaml exec -T db pg_isready -h 127.0.0.1 -U opanel -d opanel
   ```

3. Restore, then start everything; `migrate` brings an older backup up to this version:

   ```bash
   docker compose -f compose.production.yaml exec -T db pg_restore -U opanel -d opanel --exit-on-error <opanel-backup.dump
   docker compose -f compose.production.yaml up -d
   ```

Restore with the same or a newer version of Opanel than the one that made the backup,
never an older one.

### With your own PostgreSQL

Outside the example install, create the two roles yourself before the first `migrate` and
before any restore; the grants the backup carries need `opanel_app` to exist:

```sql
CREATE ROLE opanel LOGIN PASSWORD '…';
CREATE DATABASE opanel OWNER opanel;
CREATE ROLE opanel_app LOGIN PASSWORD '…';
```

This is what [`docker/production/init/01-runtime-role.sh`](../docker/production/init/01-runtime-role.sh)
does for `opanel_app` in the example. `opanel_app` may also be a group role that your own
login roles are members of. Point `MIGRATION_DATABASE_URL` at `opanel` and `DATABASE_URL`
at `opanel_app`; migrations grant the runtime role its rights.

## Recovering the last Admin

If the only Admin loses their password, an operator on the server issues them a one-time
link:

```bash
docker compose -f compose.production.yaml run --rm app node dist/recover-admin.mjs --email admin@example.com
```

It refuses any email that is not a human Admin's account, and changes no role. The link is
printed once, on standard output: send it to the Admin and do not keep it. Issuing it
replaces any unused link the account had, and is recorded in the audit log with
`via: "operator"` (WS-065).

## Maintenance

Schedule the maintenance command daily:

```bash
docker compose -f compose.production.yaml run --rm app node dist/maintenance.mjs
```

It deletes expired sessions, links used or expired more than 30 days ago, and ended
rate-limit counters, prints how many of each, and never touches the audit log or the task
history (WS-066). For example, as a cron line (use the checkout's absolute path):

```bash
15 3 * * * cd /srv/opanel && docker compose -f compose.production.yaml run --rm -T app node dist/maintenance.mjs
```

## Health and outages

`GET /api/v1/health` answers `200` when the app can reach the database and `503` when it
cannot, with no detail either way. The image's own health check calls it, so
`docker compose -f compose.production.yaml ps` shows `healthy` or `unhealthy`. Point your
monitoring at it through the proxy: `https://opanel.example.com/api/v1/health`.

While the database is down, every other request answers `500` with no detail. The app
keeps running and recovers by itself when the database returns.

Requests made with an agent's API token are limited to 600 a minute per token, counted in
the app process; above that they answer `429` with `Retry-After` (WS-072). Restarting the
app resets the counts.

## Storage

Three tables grow with use and are kept for the life of the install: `audit_log` (every
administrative action), `task_events` (every change to a task) and `comments`. Opanel never
prunes them. To see the size of every table, largest first:

```bash
docker compose -f compose.production.yaml exec -T db psql -U opanel -d opanel -c "select relname as table, pg_size_pretty(pg_total_relation_size(relid)) as size from pg_catalog.pg_statio_user_tables order by pg_total_relation_size(relid) desc"
```

`docker system df -v` shows the size of the `db-data` volume as a whole.

## Logs

Opanel writes its logs to standard output only; collecting, keeping and reading them is
yours:

```bash
docker compose -f compose.production.yaml logs app
```

What they contain:

- start-up lines, and warnings such as a missing `CLIENT_IP_HEADER`;
- one line per failed request, `Request <id> failed: <class> code=<code>`, where the id is
  the `requestId` of the error the client received;
- lines of the same shape from `migrate`, `maintenance`, the events stream and sign-in.

What they never contain: passwords, tokens, session cookies, the secrets of the env file,
or the message of a database error (which holds the query's values). In production every
error written to the console, by Opanel, Next.js or Better Auth, is reduced to its class,
code and constraint name (WS-042, WS-069). Request bodies and query strings are not logged.

Access: whoever can run Docker on the host can read the logs; treat that as
administrative access to the install. Retention: the example install keeps at most five
files of 10 MB per service (Docker's `json-file` driver, set in
`compose.production.yaml`); change `max-size` and `max-file` there, or ship the logs to
your own system and keep them as long as your policy says.
