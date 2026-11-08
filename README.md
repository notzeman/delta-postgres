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
- **Remove & ignore** — remove a project from the list; it is ignored so auto-discovery does not re-add it. Restore ignored projects from the Projects page.
- **Global + per-project schedules** — cron presets or custom expressions, next-run preview, persistent queue.
- **Manual backups** — one project or every enabled project.
- **Borg repositories** — one encrypted repo per project, zstd compression, block-level delta storage.
- **Retention** — keep daily/weekly/monthly counts, `borg prune` + `borg compact`.
- **Restore wizard** — restore into a new scratch database by default; destructive overwrite requires confirmation.
- **Archive verification** — `borg check --verify-data`.
- **Import/export** — single archive tar, full project repo tar, all repositories, or catalog JSON.
- **Live operations** — job history, persisted logs, health checks for Docker/Borg/DB/disk.
- **Postgres metadata** — the dashboard's own state lives in a dedicated PostgreSQL 17 container.
- **Database-backed admin users** — bcrypt-hashed credentials created with an interactive CLI command, httpOnly JWT cookie, rate limiting, audit log.

---

## Requirements

- Docker Engine with the Compose plugin.
- Access to `/var/run/docker.sock` (the dashboard uses it for discovery and `docker exec`).
- A host user that can write `./data` and `./backups`, plus the host Docker group GID.
- Port `8095` (configurable).

---

## Quick start

```bash
git clone https://github.com/notzeman/delta-postgres.git
cd delta-postgres

cp .env.example .env
# Edit .env: set SESSION_SECRET, DASHBOARD_DB_PASSWORD, BORG_PASSPHRASE
# Set APP_UID/APP_GID to your user (id -u / id -g) and DOCKER_GID (getent group docker)

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
5. Use **Detected** for a full Compose scan, **Ignored** to restore removed projects, or **Add project** for manual onboarding.

To remove a project, use the trash button on its card. The Borg repository is kept on disk, and the Compose project is ignored so the next scan will not re-add it.

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
- Compose projects without a PostgreSQL service are shown under **Projects → Detected → Other Compose projects**.
- Auto-add can be disabled in **Settings → Global defaults**.
- Use the trash button on a project card to **remove** it. The encrypted Borg repository stays on disk; the Compose project is added to the ignore list so it is not auto-added again.
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

- Choose an archive and source database.
- The default target is a new database: `restore_<db>_<date>`.
- Enabling **Overwrite** terminates connections, drops the target, and requires typing the target name.
- The dump is extracted from Borg and piped into `pg_restore` inside the container.

Restores are intentionally non-destructive by default.

---

## Import / export

| Operation | Format | Where |
|---|---|---|
| Catalog only | JSON | Import/Export → Catalog |
| Single archive | `.tar` (`borg export-tar`) | Project → Backups → download icon |
| Single project repo | `.tar` of the encrypted repo | Project → Export repo |
| All repositories | `.tar` of `backups/` | Import/Export → All repositories |

Archive import uses `borg import-tar`. Full repository import replaces the target project's repo directory; the dashboard clears that project's Borg cache/security metadata so relocated repositories can be adopted safely. Repositories must use the same Borg passphrase.

---

## Configuration

Admin users live in the metadata PostgreSQL database and are managed with the CLI, not environment variables. All other settings are environment variables (see `.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `SESSION_SECRET` | generated file | JWT signing |
| `SECRETS_KEY` | `SESSION_SECRET` | Encrypts stored Docker TLS credentials |
| `DASHBOARD_DB_PASSWORD` | — | Metadata Postgres password |
| `BORG_PASSPHRASE` | generated file | Borg repo encryption |
| `DASHBOARD_PORT` | `8095` | Published port |
| `APP_UID` / `APP_GID` | `1001` | Container runtime user; must own `./data` and `./backups` |
| `DOCKER_GID` | `988` | Host Docker group GID |
| `CONCURRENCY` | `1` | Parallel backup jobs |
| `DEFAULT_CRON` | `0 2 * * *` | Global schedule |
| `RETENTION_KEEP_DAILY` | `7` | Global retention |
| `RETENTION_KEEP_WEEKLY` | `4` | Global retention |
| `RETENTION_KEEP_MONTHLY` | `6` | Global retention |
| `TZ` | `Asia/Kolkata` | Scheduler timezone |
| `COOKIE_SECURE` | `false` | Set `true` behind HTTPS |

Global schedule/retention and the notification webhook can also be changed in the UI. Per-project cron and retention override globals.

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
Set `DOCKER_GID` to the host's docker GID: `getent group docker`.

**`pg_dump: error: connection ... role ... does not exist`**
Set the project's PostgreSQL user in Settings, or ensure `POSTGRES_USER` is present in the container.

**`Borg repository ... already exists` / lock errors**
A previous run may still hold a lock. Check `docker compose logs dashboard`, then run `borg break-lock <repo>` in the container.

**Restore fails with a missing member path**
The archive layout is `databases/<name>.dump`; use the UI's source-database list. Borg paths with a leading `./` are handled automatically.

**Dashboard can't reach Docker**
Verify the socket mount and the runtime process groups:

```bash
docker compose exec dashboard cat /proc/1/status | grep -E 'Uid|Gid|Groups'
```

The process should run as `APP_UID` and include `DOCKER_GID`. The entrypoint creates the runtime user and joins the Docker group automatically.

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
