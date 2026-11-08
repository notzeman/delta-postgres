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

- **Docker discovery** — finds PostgreSQL compose projects and standalone containers automatically.
- **Manual onboarding** — add containers the scan misses, with live database/user detection.
- **Global + per-project schedules** — cron presets or custom expressions, next-run preview, persistent queue.
- **Manual backups** — one project or every enabled project.
- **Borg repositories** — one encrypted repo per project, zstd compression, block-level delta storage.
- **Retention** — keep daily/weekly/monthly counts, `borg prune` + `borg compact`.
- **Restore wizard** — restore into a new scratch database by default; destructive overwrite requires confirmation.
- **Archive verification** — `borg check --verify-data`.
- **Import/export** — single archive tar, full project repo tar, all repositories, or catalog JSON.
- **Live operations** — job history, persisted logs, health checks for Docker/Borg/DB/disk.
- **Postgres metadata** — the dashboard's own state lives in a dedicated PostgreSQL 17 container.
- **Single admin auth** — bcrypt/plain env secret, httpOnly JWT cookie, rate limiting, audit log.

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
# Edit .env: set ADMIN_PASSWORD, SESSION_SECRET, DASHBOARD_DB_PASSWORD, BORG_PASSPHRASE
# Set APP_UID/APP_GID to your user (id -u / id -g) and DOCKER_GID (getent group docker)

mkdir -p data backups
docker compose up -d --build
```

Open `http://<server>:8095` and sign in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

Check health:

```bash
docker compose ps
curl -s http://127.0.0.1:8095/api/health | jq
```

> **Security:** the dashboard has root-equivalent power through the Docker socket. Do not expose it to the public internet without TLS and network restrictions. Prefer a private network, VPN, or a reverse proxy with authentication. Docker port publishing bypasses `ufw`; use your cloud firewall/security group as well.

---

## First run

1. Open **Projects → Detected**.
2. Add a detected PostgreSQL project, or use **Add project** for a manual container.
3. Review the detected databases and PostgreSQL user.
4. Choose a schedule (or inherit the global one) and optional retention overrides.
5. Click **Backup now** to create the first archive.
6. Open the project to browse archives, verify, export, or restore.

Useful Docker labels:

```yaml
labels:
  backup.ignore: "true"   # hide a container from discovery
  backup.enable: "false"  # same, via the opt-out label
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

All settings are environment variables (see `.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `ADMIN_USERNAME` | `admin` | Dashboard login |
| `ADMIN_PASSWORD` / `ADMIN_PASSWORD_HASH` | — | Login secret; bcrypt hash supported |
| `SESSION_SECRET` | generated file | JWT signing |
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
ADMIN_PASSWORD=admin SESSION_SECRET=dev-secret \
BORG_PASSPHRASE=dev-passphrase \
npm run dev:server

# Terminal 2: Vite on :5173 with /api proxy
npm run dev:web
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
| `GET` | `/api/discovery` | Detected projects |
| `GET` | `/api/containers` | Docker containers for manual add |
| `GET/POST` | `/api/projects` | List / create projects |
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
