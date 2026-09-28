# Deploying Hive OS to the VPS

This app deploys as two Docker containers (Next.js app + Postgres) behind
an existing Traefik reverse proxy on your VPS. Everything below matches
the actual scripts already in this repo (`deploy.sh`, `docker-compose.yml`,
`Dockerfile`) — this isn't a generic guide.

## One-time VPS setup (skip if already done before)

1. **Docker + Docker Compose** installed on the VPS.
2. **Traefik already running** with an external Docker network called
   `root_default` — `docker-compose.yml` expects this network to exist
   already (it's how the app gets HTTPS routing without its own Traefik
   instance). If you're not sure it exists: `docker network ls | grep root_default`.
3. **DNS**: `portal.hivesocial.agency` (the domain baked into
   `docker-compose.yml`'s Traefik labels) must point at the VPS.
4. **Clone the repo** onto the VPS, e.g. `/opt/hive-os` — pick whichever
   branch is meant to be production (see "Which branch" below).

## Every deploy (first time or updating)

From the VPS, inside the repo folder:

```bash
./deploy.sh
```

This one script does everything:
1. Checks `.env` exists (copies `.env.example` → `.env` and stops if not —
   edit it with real secrets, see below, then rerun).
2. Refuses to continue if `.env` still has the placeholder password, or if
   `docker-compose.yml` still has a placeholder domain.
3. `git pull` — **pulls whatever branch is currently checked out on the
   VPS.** Pushing to GitHub does NOT deploy anything by itself; someone
   has to run this script on the server afterward.
4. Rebuilds the app image (`docker compose build --no-cache app`).
5. Starts Postgres alone and waits for it to report healthy.
6. **Backs up the database** to `backups/pre-deploy-<timestamp>.sql.gz`
   (`pg_dump`, on the VPS, not committed).
7. **First run only:** if the DB has no migration history (it was
   originally created with `prisma db push`), marks the ten migrations up to
   `20260925120000_client_sheet_sync_status` as already applied. It checks
   for `ClientSheet.lastSyncError` first and stops if the DB isn't at that
   point.
8. Applies pending migrations — `npx prisma migrate deploy`, run in a
   one-off container **before** the new app starts, so new code never runs
   against the old schema. If a migration fails, the script stops and the
   old app keeps serving.
9. Starts the new app (`docker compose up -d`).

Migrations are the deploy path now, not `prisma db push` — several of them
backfill data (e.g. `20260928120000_lead_stage_funnel` converts lead
statuses into stages and history), which `db push` would silently skip or
refuse to apply.

To restore a backup: `gunzip -c backups/<file>.sql.gz | docker compose exec -T postgres psql -U coach -d coach_os`
(into an empty database — drop and recreate `coach_os` first).

## `.env` — what has to be real before `deploy.sh` will proceed

Copy `.env.example` to `.env` and fill in:

| Variable | Where to get it |
|---|---|
| `POSTGRES_PASSWORD` | Pick a real password (not the placeholder) |
| `DATABASE_URL` | Update to match the password above |
| `NEXTAUTH_URL` | `https://portal.hivesocial.agency` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` | Clerk dashboard → your app → API Keys |
| `CLERK_WEBHOOK_SECRET` | Clerk dashboard → Webhooks → endpoint at `/api/webhooks/clerk` |
| `META_APP_ID` / `META_APP_SECRET` | Meta for Developers → your app |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Cloud Console → Credentials |
| `GOOGLE_REDIRECT_URI` | `https://portal.hivesocial.agency/api/google/callback` |
| `TOKEN_ENCRYPTION_KEY` | Generate with `openssl rand -hex 32` — encrypts stored Google/Meta tokens at rest |
| `CRON_SECRET` | Generate with `openssl rand -hex 32` — auth for the lead-sync cron (see below) |
| `ANTHROPIC_API_KEY` | Optional. console.anthropic.com → API Keys — classifies lead-note entries the regex rules miss; without it they stay as plain notes |

Also double check in the **Clerk dashboard** → User & Authentication →
Restrictions: **"Allow sign-ups" must be OFF** — accounts are only ever
created from Settings → Users & logins inside the app.

## Automatic lead sync (n8n)

Every client's Google Sheet is synced into the Leads tab by
`GET /api/cron/sync`. It's public at the routing level — the
`x-cron-secret` header (must equal `CRON_SECRET` in `.env`) is its only
auth; anything else gets a 401.

In n8n, create a workflow:

1. **Schedule Trigger** — every 5 minutes.
2. **HTTP Request** —
   - Method: `GET`
   - URL: `https://portal.hivesocial.agency/api/cron/sync`
   - Headers: `x-cron-secret` = the `CRON_SECRET` value (store it as an n8n
     credential — "Header Auth" — rather than pasting it into the node)
   - Timeout: 300000 ms (clients sync one at a time; a big sheet takes a while)

The response is JSON: `{ synced, failed, results: [{ client, ok, created,
updated, removed, restored, error? }] }`. A failing client doesn't stop the
others; its error also shows on that client's Leads tab (`lastSyncError`).
Quick manual test from the VPS:

```bash
curl -s -H "x-cron-secret: $CRON_SECRET" https://portal.hivesocial.agency/api/cron/sync
```

## Which repo/branch is production?

The VPS deploys from **`goback-me/hive-os`**, branch **`main`** — this is
a different GitHub repo from `goback-me/hive-coach` (an earlier, now-unused
repo with unrelated history). Push here:

```bash
git push https://github.com/goback-me/hive-os.git master:main
```

`deploy.sh` itself just runs `git pull` on whatever's checked out on the
VPS — check with `git branch --show-current` on the server if unsure.

## After deploying

- `docker compose logs -f app` — tail the app's logs
- Visit `https://portal.hivesocial.agency` and confirm it loads
- `docker compose ps` — confirm both `hive_os_app` and `hive_os_postgres` are `Up`/`healthy`

## Note: old "coach_os"-named containers on this VPS

Containers are now named `hive_os_app` / `hive_os_postgres` (previously
`coach_os` / `coach_os_postgres`, left over from before the Hive OS
rebrand — `container_name` is hardcoded in `docker-compose.yml`, so Docker
requires exact, unique names). If a stale `coach_os`/`coach_os_postgres`
container from an old deploy is still sitting on the VPS (stopped or
running), it won't conflict with these new names — it's just an orphaned
leftover you can remove once you've confirmed the new deploy is healthy:
`docker stop coach_os coach_os_postgres && docker rm coach_os coach_os_postgres`.

## Rolling back

There's no automated rollback. To revert: `git checkout <previous-commit-or-tag>`
on the VPS, then run `./deploy.sh` again.
