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
4. Rebuilds the app image (`docker compose build --no-cache app`) and
   starts both containers (`docker compose up -d`).
5. Waits for Postgres to report healthy.
6. Syncs the database schema — `npx prisma db push` (applies whatever's in
   `prisma/schema.prisma` directly; it does not replay the numbered
   migration files under `prisma/migrations/`, which exist for local dev
   history rather than the deploy path).

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

Also double check in the **Clerk dashboard** → User & Authentication →
Restrictions: **"Allow sign-ups" must be OFF** — accounts are only ever
created from Settings → Users & logins inside the app.

## Which branch is production?

`deploy.sh` deploys whatever branch is checked out in the VPS's copy of
this repo — check with `git branch --show-current` on the server itself.
The GitHub remote only has `master` and `dev`; there is no `main`. If
you're not sure which one the VPS is tracking, that's the first thing to
confirm before pushing anything you expect to go live.

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
