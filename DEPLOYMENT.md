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
3. **DNS**: `hq.hivesocial.agency` (the domain baked into
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

## `.env` — every variable

Copy `.env.example` to `.env` and fill in (it lists the same variables with
comments). `deploy.sh` won't proceed while the placeholder password is there.

| Variable | Required? | Where to get it / what it does |
|---|---|---|
| `POSTGRES_PASSWORD` | Yes | Pick a real password (not the placeholder) |
| `DATABASE_URL` | Yes | Update to match the password above |
| `NEXTAUTH_URL` | Yes | `https://hq.hivesocial.agency` — redirects, and the links in Slack / email / ClickUp |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` | Yes | Clerk dashboard → your app → API Keys |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` / `..._FALLBACK_REDIRECT_URL` | Yes | `/login` and `/dashboard` (as in `.env.example`) |
| `CLERK_WEBHOOK_SECRET` | Recommended | Clerk dashboard → Webhooks → endpoint at `/api/webhooks/clerk` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | For `npm run create-admin` | Creates (or promotes) the bootstrap ADMIN login |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Yes | Google Cloud Console → Credentials (OAuth client). Scopes used: spreadsheets (read/write), drive.readonly, userinfo.email |
| `GOOGLE_REDIRECT_URI` | Yes | `https://hq.hivesocial.agency/api/google/callback` |
| `TOKEN_ENCRYPTION_KEY` | Yes | `openssl rand -hex 32` — encrypts stored Google / Meta tokens at rest. Meta needs no app keys: each client's ad account ID + token is pasted on their Ads tab |
| `CRON_SECRET` | Yes | `openssl rand -hex 32` — auth for the cron (see below) |
| `ANTHROPIC_API_KEY` | Optional | console.anthropic.com → API Keys — classifies lead-note entries the regex rules miss |
| `RESEND_API_KEY` / `EMAIL_FROM` | Optional | resend.com — emails the 7-day "leads waiting on your update" reminders; `EMAIL_FROM` must be on a domain verified in Resend. Unset = in-app only. SMTP isn't supported. Also used for the weekly call emails to agents |
| `ACTION_TOKEN_SECRET` | With Resend | Signs the one-button links in action emails (`openssl rand -hex 32`). Not a login — the page still needs a sign-in. Changing it invalidates links already sent |
| `APP_URL` | Optional | Base URL for email links; defaults to `NEXTAUTH_URL` |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | Optional | api.slack.com → your app → Basic Information. Under OAuth & Permissions add bot scopes `chat:write` + `chat:write.public` and redirect URL `https://<your domain>/api/slack/callback`, then use **Add to Slack** in Settings → Integrations |
| `SLACK_BOT_TOKEN` | Optional | Fallback when Slack isn't connected in Settings: a bot token with `chat:write`, invited to every client channel and the admin channel |
| `SLACK_ADMIN_CHANNEL` | Optional | Channel ID for the daily 8am portfolio digest |

**ClickUp** isn't an env var: an admin enters the API key + Team ID in the
app under Settings → Integrations, then picks each client's list on its page.

Also double check in the **Clerk dashboard** → User & Authentication →
Restrictions: **"Allow sign-ups" must be OFF** — accounts are only ever
created from Settings → Users & logins inside the app.

## The cron (VPS crontab, every 5 minutes)

`GET /api/cron/sync` runs all the background work, in order:

1. syncs every non-archived client's Google Sheet (one at a time) — each
   sync also reconciles sheet vs HQ and re-runs the data health checks;
2. freezes last month's Snapshot KPIs from the 1st;
3. writes queued status changes back to the sheets (max 50 cells/min);
4. raises 7-day client-update reminders (+ email);
5. from 8am Sydney, once a day: Slack client digests, the admin portfolio
   digest and the weekly ClickUp tasks;
6. sends any queued Slack posts.

It's public at the routing level — the `x-cron-secret` header (must equal
`CRON_SECRET` in `.env`) is its only auth; anything else gets a 401.

On the VPS, `crontab -e` and add (adjust the path to the repo):

```cron
*/5 * * * * curl -fsS --max-time 290 -H "x-cron-secret: $(grep '^CRON_SECRET=' /opt/hive-os/.env | cut -d= -f2-)" https://hq.hivesocial.agency/api/cron/sync >> /var/log/hive-cron.log 2>&1
```

The VPS clock's timezone doesn't matter — the app checks Sydney time itself
(8am digests, month freezes). Check it's running: `tail -f /var/log/hive-cron.log`.
If you still have the old n8n workflow calling this URL, turn it off — two
callers would just do the work twice.

The response is JSON: `{ synced, failed, results: [{ client, ok, ms, total,
leads, created, updated, removed, restored, error? }], frozen, writeBack,
reminders, daily, slack }`. A failing client doesn't stop the others; its
error shows on that client's Leads tab and as a data alert (bell icon).
Quick manual test from the VPS:

```bash
curl -s -H "x-cron-secret: $CRON_SECRET" https://hq.hivesocial.agency/api/cron/sync
```

## Manual setup checklist (after deploying this release)

1. **Back up the database** (deploy.sh does this) — the stage-enum and
   two-way-sync migrations rewrite data.
2. **Make yourself an admin:** `docker compose exec app npm run promote-coaches`
   (every existing coach login becomes ADMIN), then sign out and back in.
3. **Reconnect Google with write access:** Leads page → "Reconnect Google"
   banner (admin). Until then HQ can't write statuses back to the sheets.
4. **Per client**, on Dashboard → Client Details:
   - set the **start date** (onboarding day) and the **client type**
     (Trade = "Onsite quote" / "Job won" wording);
   - Integrations: **Slack channel ID** (+ "Send test message"; invite the
     bot to the channel first) and the **ClickUp list**;
   - Ads tab → **Campaigns in reports**: check the ticks (default = started
     on/after the start date).
5. **Clean up the sheet dropdowns:** Leads page → each client's sheet
   settings — map any "not recognised" status values, and check the
   "Writing back to the sheet" values each stage writes.
6. **Rebuild history** per client (Snapshot card on the Dashboard), or once
   for everyone: `docker compose exec app npm run db:backfill-kpis`.
7. **Run a sync** (Leads tab → Sync now, or wait for the cron) and check the
   **bell shows 0 mismatches** — fix anything red it lists.
8. **ClickUp key + Team ID** under Settings → Integrations, if not already.
9. **Crontab** (above) on the VPS; turn off the old n8n workflow.

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
- Visit `https://hq.hivesocial.agency` and confirm it loads
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
