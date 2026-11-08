# DeltaPostgres

A self-hosted dashboard for **PostgreSQL container backups** using **BorgBackup**.

It discovers PostgreSQL containers through the Docker Engine API, schedules logical `pg_dump` snapshots, and stores them in encrypted, deduplicated Borg repositories. The UI lets you manage projects, trigger manual backups, browse and verify archives, restore databases, and import/export backup data.

```
PostgreSQL container ── pg_dump -Fc -Z 0 ──▶ Borg repository
                                             (chunk dedup + zstd + repokey-blake2)
```

> Borg provides **deduplicated incremental storage**, not PostgreSQL WAL-level point-in-time recovery. Each run is a full logical dump; Borg only stores changed chunks. WAL/PITR can be added later with a tool such as pgBackRest.

---

## Features

- **Full Docker Compose scan** — discovers every Compose project on the host and flags which ones contain PostgreSQL.
- **Multi-server support** — connect remote Docker Engine APIs over TCP or TLS, and scope projects, discovery, schedules, and backups by server.
- **Automatic project import** — PostgreSQL Compose projects are added to the dashboard automatically; new projects are picked up on rescan and every few minutes.
- **Manual onboarding** — add containers the scan misses, with live database/user detection.
- **Move to Ignored** — “removing” a project moves it to Ignored, preserving its archives, jobs, and Borg repository. Restore it from the Projects page.
- **Global + per-project schedules** — cron presets or custom expressions, next-run preview, persistent queue.
- **Manual backups** — one project or every enabled project.
- **Borg repositories** — one encrypted repo per project, zstd compression, block-level delta storage.
- **Retention** — keep daily/weekly/monthly counts, `borg prune` + `borg compact`.
- **Restore wizard** — restore into a new scratch database by default; destructive overwrite requires confirmation.
- **Archive verification** — `borg check --verify-data`.
- **Import/export** — project-level transfer tab plus global archive/repo/catalog exports.
- **Light & dark mode** — topbar theme switcher with persisted preference.
- **Polished controls** — searchable React dropdowns, custom checkboxes/switches, and animated tooltips.
- **Self-healing container lookup** — backup and restore re-resolve the project container by name/compose labels, and a **Refresh container** button repairs stale IDs.
- **Live operations** — job history, persisted logs, health checks for Docker/Borg/DB/disk.
- **Postgres metadata** — the dashboard's own state lives in a dedicated PostgreSQL 17 container.
- **Database-backed admin users** — bcrypt-hashed credentials created with an interactive CLI command, httpOnly JWT cookie, rate limiting, audit log.

---

## Requirements

A server with Docker installed, ofc.

### Runtime permissions

The entrypoint runs as root only long enough to:

- Detect the owner of `./data` or `./backups` and run the app as that UID/GID.
- Detect the GID of `/var/run/docker.sock` and add the app user to it.
- Chown `./data` and `./backups` if needed.
- Drop privileges before starting the dashboard.

So `APP_UID`, `APP_GID`, and `DOCKER_GID` are **not required** in `.env`. They remain optional overrides for rootless Docker, custom sockets, or unusual host ownership.

---

## Quick start

```bash
git clone https://github.com/notzeman/delta-postgres.git
cd delta-postgres

cp .env.example .env
# Edit .env: set SESSION_SECRET, DASHBOARD_DB_PASSWORD, BORG_PASSPHRASE
# UID/GID and the Docker socket GID are auto-detected by the entrypoint.

mkdir -p data backups
docker compose up -d --build

# Create the first admin user (interactive: username, password, confirmation)
docker compose exec dashboard npm run create-admin
```

Open `http://<server>:8095` and sign in with the admin user you just created.

Check health:

```bash
docker compose ps
curl -s http://127.0.0.1:8095/api/health | jq
```

> **Security:** the dashboard has root-equivalent power through every connected Docker socket or TCP endpoint. Do not expose it to the public internet without TLS and network restrictions. Prefer a private network, VPN, or a reverse proxy with authentication. Docker port publishing bypasses `ufw`; use your cloud firewall/security group as well.

---

## Admin setup

Admin users are stored in PostgreSQL with bcrypt hashes; there are no default credentials.

Create an admin:

```bash
docker compose exec dashboard npm run create-admin
```

The command prompts:

```text
Username: admin
Password: ********
Confirm password: ********
```

Passwords are hidden while typing and must be at least 8 characters. The username is normalized to lowercase.

Reset an existing admin password:

```bash
docker compose exec dashboard npm run reset-admin
```

For local development without Docker:

```bash
npm run create-admin:dev
npm run reset-admin:dev
```

The CLI reads `DATABASE_URL` from the environment. If no admin user exists yet, the login page returns a message telling you to run the setup command.

---

## First run

1. Create an admin user with the command above and sign in.
2. Open **Projects**. PostgreSQL Compose projects are auto-added to **Managed**; projects without PostgreSQL are listed under **Detected → Other Compose projects**.
3. Open a project and review its databases, PostgreSQL user, schedule, and retention.
4. Click **Backup now** to create the first archive.
5. Use **Detected** for a full Compose scan, **Ignored** to restore moved projects, or **Add project** for manual onboarding.

To move a project to **Ignored**, use the trash button on its card. Its archives, jobs, and Borg repository are kept, and the next scan will not re-add it. Restore it from the **Ignored** tab.

Useful Docker labels:

```yaml
labels:
  backup.ignore: "true"   # hide a container from discovery
  backup.enable: "false"  # same, via the opt-out label
```

---

## Project discovery & removal

Every Docker Compose project on each connected server is scanned. Projects containing PostgreSQL are auto-added to **Managed** with a per-project Borg repository, using all discovered databases and the container's `POSTGRES_USER`.

- New Compose projects are picked up on startup, on **Rescan**, and every five minutes.
- Opening the **Managed** tab does **not** trigger a scan. Discovery runs only on **Rescan** or when you open **Detected/Ignored**.
- Compose projects without a PostgreSQL service are shown under **Projects → Detected → Other Compose projects**.
- Auto-add can be disabled in **Settings → Global defaults**.
- Use the trash button on a project card to **move it to Ignored**. Its archives, jobs, and Borg repository stay intact, and the Compose project is added to the ignore list so it is not auto-added again.
- Open **Projects → Ignored** to unignore a project or add it back manually.

---

## Docker servers

The dashboard can manage multiple Docker Engine endpoints and scope everything by server.

- **Local Docker** is seeded automatically from `DOCKER_SOCKET`.
- **Remote Docker** hosts are added in the **Servers** page:
  - `http` on port `2375`, or `https` on `2376`
  - optional CA certificate, client certificate, and client key
  - TLS verification toggle
- Connections are tested before saving. TLS material is encrypted at rest with `SECRETS_KEY`.
- Use **Scan now** on a server to discover and auto-add its PostgreSQL projects immediately.
- Use the server filter on **Overview** and **Projects**, and the server selector in **Add project**.
- Backups, archives, restore, schedules, and logs are all scoped to the project's server.
- Removing a server with projects asks for a second confirmation and deletes the project records; Borg repository files remain on disk.

> **Security:** plain `http` Docker API access is unauthenticated. Prefer mutual TLS or keep the Docker API on a private network/WireGuard tunnel. The dashboard has root-equivalent control over every connected Docker host.

Remote repositories are stored under:

```text
backups/
  <project-slug>/                 # local server
  servers/
    <server-slug>/
      <project-slug>/repo/        # remote server
```

---

## How backups work

For each run, the dashboard executes inside the target PostgreSQL container:

```bash
pg_dumpall -U <user> --globals-only
pg_dump -U <user> -Fc -Z 0 -d <database>   # one per selected database
```

It writes a manifest, then creates one Borg archive:

```bash
borg create --stats --json --compression auto,zstd,3 <repo>::<timestamp> .
borg prune --keep-daily 7 --keep-weekly 4 --keep-monthly 6 <repo>
borg compact <repo>
```

`-Z 0` keeps the dump uncompressed so Borg can deduplicate it effectively; Borg applies zstd once. Repositories use `repokey-blake2` encryption with `BORG_PASSPHRASE`.

### Data layout

```
data/
  logs/job-<id>.log
  secrets/session.secret
  secrets/borg.passphrase      # only when BORG_PASSPHRASE is not provided
  staging/                     # temporary dumps, cleaned after each run
backups/
  <project-slug>/
    repo/                      # encrypted Borg repository
    ...
```

The dashboard's metadata lives in the `dashboard-db` Postgres container and is excluded from discovery with the `backup.ignore=true` label.

---

## Restore

Open a project → **Restore**:

- Choose an archive. The **Database dump** list is read directly from that archive’s `databases/*.dump` files.
- **Database dump** is the dump to extract; **Target database** is where it is restored in the current PostgreSQL container.
- If the archive contains exactly one dump, the dashboard shows it read-only and skips the picker. Multiple dumps get a picker.
- The default target is a new database: `restore_<db>_<date>`.
- The project container is re-resolved automatically before restore.
- Enabling **Overwrite** terminates connections, drops the target, and requires typing the target name.
- The dump is extracted from Borg and piped into `pg_restore` inside the container.

Restores are intentionally non-destructive by default.

---

## Import / export

| Operation | Format | Where |
|---|---|---|
| Catalog only | JSON | Import/Export → Catalog |
| Single archive | `.tar` (`borg export-tar`) | Project → Import / export |
| Single project repo | `.tar` of the encrypted repo | Project → Import / export |
| Import archive/repo | `.tar` upload | Project → Import / export |
| All repositories | `.tar` of `backups/` | Import/Export → All repositories |

Open a project and use the **Import / export** tab to download its full repository or a specific archive, and to upload a new archive or replace the repository — all scoped to that project. Archive import uses `borg import-tar`. Full repository import replaces the target project's repo directory; the dashboard clears that project's Borg cache/security metadata so relocated repositories can be adopted safely. Repositories must use the same Borg passphrase.

An archive export is **the whole Borg archive**, not a single `pg_dump`: it contains `globals.sql`, `manifest.json`, and one `databases/<name>.dump` per backed-up database. The restore **Database dump** picker lists those dumps. If a project has three databases, the archive has three dumps.

Imported archives are subject to the project's retention policy. Importing an archive with the same timestamp/day as an existing one can result in one being removed by the next `borg prune`; the catalog now reconciles automatically and removes rows for archives that no longer exist.

---

## Configuration

Admin users live in the metadata PostgreSQL database and are managed with the CLI, not environment variables. Global schedule, timezone, concurrency, retention, the notification webhook, and auto-add behavior are configured in the dashboard **Settings** page.

### `.env` reference

| Variable | Required | Purpose | Generate / set |
|---|---|---|---|
| `SESSION_SECRET` | Yes | Signs login JWT cookies | `openssl rand -hex 32` |
| `DASHBOARD_DB_PASSWORD` | Yes | Password for the dashboard’s own Postgres | `openssl rand -hex 24` |
| `BORG_PASSPHRASE` | Yes | Encrypts every Borg repository | `openssl rand -hex 32` |
| `SECRETS_KEY` | Yes | Encrypts stored remote Docker TLS credentials | `openssl rand -hex 32` |
| `COOKIE_SECURE` | No | Set `true` when serving the dashboard over HTTPS | `false` / `true` |
| `DASHBOARD_PORT` | No | Host port published by Compose | `8095` or any free port |

Generate a complete `.env`:

```bash
cat > .env <<EOF
SESSION_SECRET=$(openssl rand -hex 32)
DASHBOARD_DB_PASSWORD=$(openssl rand -hex 24)
BORG_PASSPHRASE=$(openssl rand -hex 32)
SECRETS_KEY=$(openssl rand -hex 32)
COOKIE_SECURE=false
DASHBOARD_PORT=8095
EOF

chmod 600 .env
```

### Optional overrides

| Variable | Default | Purpose | Set with |
|---|---|---|---|
| `APP_UID` / `APP_GID` | auto-detected | Runtime UID/GID | `id -u` / `id -g` |
| `DOCKER_GID` | socket GID | Docker socket group | `stat -c '%g' /var/run/docker.sock` |
| `PORT` | `8080` | Container HTTP port | any free container port |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Docker socket path | custom socket path |
| `LOG_LEVEL` | `info` | API log verbosity | `debug`, `info`, `warn`, `error` |
| `DATABASE_URL` | Compose-built | External metadata database | `postgres://user:pass@host:5432/db` |
| `DATA_DIR` | `/data` | Runtime state directory | set by Compose |
| `BACKUP_ROOT` | `/backups` | Borg repository root | set by Compose |

`APP_UID`, `APP_GID`, and `DOCKER_GID` are **not needed** normally. The entrypoint detects them from `./data` ownership and the mounted Docker socket. Override them only for rootless Docker, a custom socket, or unusual host ownership.

### Secret handling

- `.env` is gitignored. Keep it `chmod 600`.
- **`BORG_PASSPHRASE` is unrecoverable if lost** — store it in a password manager or offline vault. Changing it does not re-encrypt existing repositories.
- **`SECRETS_KEY`** must remain stable. Changing it invalidates stored remote Docker TLS certificates; re-enter them in **Servers**.
- **`SESSION_SECRET`** rotation logs everyone out.
- **`DASHBOARD_DB_PASSWORD`** must match the actual Postgres role. If you change it after the database volume exists, update the role inside `dashboard-db` as well.

---

## Development

```bash
# Metadata database only
docker compose up -d dashboard-db

# Install dependencies
npm install
npm --prefix web install

# Terminal 1: API on :8080
DATABASE_URL=postgres://dashboard:<password>@localhost:5432/backup_dashboard \
SESSION_SECRET=dev-secret \
BORG_PASSPHRASE=dev-passphrase \
npm run dev:server

# Terminal 2: Vite on :5173 with /api proxy
npm run dev:web

# Terminal 3: create the admin user (schema is created by the API on startup)
DATABASE_URL=postgres://dashboard:<password>@localhost:5432/backup_dashboard \
npm run create-admin:dev
```

Build everything:

```bash
npm run build
```

The API serves `web/dist` in production.

---

## API overview

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/login` | Sign in |
| `GET` | `/api/health` | Docker/Borg/DB/disk health |
| `GET` | `/api/stats` | Dashboard totals and chart data |
| `GET` | `/api/discovery` | Detected Compose projects (optionally `?serverId=`) |
| `GET` | `/api/containers` | Containers for manual add (optionally `?serverId=`) |
| `GET/POST` | `/api/servers` | List / add Docker servers |
| `PATCH/DELETE` | `/api/servers/:id` | Update / remove a Docker server |
| `POST` | `/api/servers/test` | Test a connection before saving |
| `POST` | `/api/servers/:id/test` | Test an existing server |
| `POST` | `/api/servers/:id/scan` | Discover + auto-add projects on a server |
| `GET/POST` | `/api/projects` | List / create projects (optionally `?serverId=`) |
| `GET/PATCH/DELETE` | `/api/projects/:id` | Project details / update / remove |
| `POST` | `/api/projects/:id/backup` | Queue a manual backup |
| `POST` | `/api/backups` | Queue all enabled projects |
| `GET` | `/api/projects/:id/archives` | Archive catalog |
| `POST` | `/api/projects/:id/archives/:name/verify` | Verify archive |
| `POST` | `/api/projects/:id/restore` | Restore a database |
| `GET` | `/api/projects/:id/archives/:name/export` | Export archive tar |
| `GET` | `/api/projects/:id/export` | Export repo tar |
| `GET` | `/api/export/catalog` | Export catalog JSON |
| `GET` | `/api/export/all` | Export all repos |
| `POST` | `/api/import` | Import archive or repo tar |
| `GET` | `/api/jobs` | Job history |
| `GET` | `/api/jobs/:id` | Job + log tail |
| `GET/PATCH` | `/api/settings` | Global defaults |

---

## Operational notes

- **Single scheduler instance.** The in-process queue assumes one dashboard replica. Scaling horizontally requires a shared queue/leader election.
- **One container per project.** A project maps to one PostgreSQL container. Multiple databases inside it are supported.
- **Logical dumps only.** Cross-database consistency is per-database; no WAL/PITR in v1.
- **Passphrase safety.** Store `BORG_PASSPHRASE` securely. Without it, repositories cannot be restored. Use `borg key export` if you need a portable key backup.
- **Docker socket risk.** A compromised dashboard can control the host. Keep it on a trusted network and use TLS.
- **Disk space.** Backups are written to `./backups`; the app checks free space in health and staging is cleaned after each run.
- **Stale locks.** If a job is interrupted, use `borg break-lock` on the affected repo (or stop/start the job) before retrying.

---

## Troubleshooting

**`No admin user configured` on the login page**
Create one with:

```bash
docker compose exec dashboard npm run create-admin
```

If a user exists but you forgot the password:

```bash
docker compose exec dashboard npm run reset-admin
```

**`permission denied` on `/var/run/docker.sock`**
The entrypoint auto-detects the socket GID. If you use a custom Docker socket or rootless Docker, set `DOCKER_GID` explicitly and recreate the container.

**`no such container` after recreating a Compose service**
Container IDs change when a container is recreated; names and Compose labels stay stable. Backup and restore automatically re-resolve by container name, then compose project/service, and save the new ID. Open the project and use **Refresh container** to repair it manually; the restore error state also offers a refresh button.

**`Archive ... does not exist` or an archive disappears after trim/prune**
The archive catalog now reconciles with Borg automatically. If an imported archive was removed by retention, refresh the archive list from **Restore** or **Backups → Sync** and choose an existing archive. Imported archives use their original timestamps, so a duplicate/day collision can be pruned by the next backup. Do not include `.tar` in the imported archive name; the backend strips it.

**`pg_dump: error: connection ... role ... does not exist`**
Set the project's PostgreSQL user in Settings, or ensure `POSTGRES_USER` is present in the container.

**`Borg repository ... already exists` / lock errors**
A previous run may still hold a lock. Check `docker compose logs dashboard`, then run `borg break-lock <repo>` in the container.

**Restore fails with a missing member path**
The restore form lists dump files from the selected archive itself. Pick a database dump from that list; the exact `databases/<name>.dump` member is sent to the backend.

**Dashboard can't reach Docker**
Verify the runtime process ownership and group membership:

```bash
docker compose exec dashboard sh -c 'grep -E "^(Uid|Gid|Groups)" /proc/1/status'
```

The process should run as the owner of `./data` and include the Docker socket GID. The entrypoint creates the runtime user and joins the Docker group automatically.

**Remote Docker server is offline**
Check that the Docker Engine API is reachable from the dashboard container, the host/port are correct, and TLS certificates match. Plain `http` requires the API to be exposed on port 2375; `https` uses 2376. Use **Servers → Test** to inspect the exact error.

---

## Project structure

```
src/                 Fastify API, Docker/Borg services, scheduler, job queue
web/                 React 19 + Vite + Tailwind dashboard
Dockerfile           Multi-stage build (React + TypeScript + Borg runtime)
docker-compose.yml   Dashboard + metadata Postgres
```

---

## License

MIT
