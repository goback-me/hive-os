#!/bin/bash
set -e
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "No .env file found — creating one from .env.example."
  cp .env.example .env
  echo ""
  echo "STOP: edit .env now — set a real POSTGRES_PASSWORD, a matching"
  echo "DATABASE_URL, and NEXTAUTH_URL. Also edit docker-compose.yml to"
  echo "replace REPLACE_WITH_YOUR_DOMAIN with your real domain."
  echo "Then run ./deploy.sh again."
  echo ""
  exit 1
fi

if grep -q "change-this-password" .env; then
  echo "STOP: .env still has the placeholder password. Edit it, then rerun."
  exit 1
fi

if grep -q "REPLACE_WITH_YOUR_DOMAIN" docker-compose.yml; then
  echo "STOP: docker-compose.yml still has the placeholder domain. Edit"
  echo "the traefik.http.routers.hive-os.rule line, then rerun."
  exit 1
fi

# Required settings — the app can't run without these.
missing=""
for v in DATABASE_URL NEXTAUTH_URL NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY CLERK_SECRET_KEY GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_REDIRECT_URI TOKEN_ENCRYPTION_KEY CRON_SECRET APP_DOMAIN; do
  grep -qE "^$v=.+" .env || missing="$missing $v"
done
if [ -n "$missing" ]; then
  echo "STOP: .env is missing required settings:$missing"
  echo "See HANDOVER.md → step 4 for what each one is."
  exit 1
fi
if grep -qE "^NEXTAUTH_URL=http://" .env; then
  echo "STOP: NEXTAUTH_URL starts with http:// — use the live https:// address."
  exit 1
fi
if grep -qE "^RESEND_API_KEY=.+" .env && ! grep -qE "^ACTION_TOKEN_SECRET=.+" .env; then
  echo "STOP: RESEND_API_KEY is set but ACTION_TOKEN_SECRET isn't — emails can't be sent."
  echo "Add one: ACTION_TOKEN_SECRET=\$(openssl rand -hex 32)"
  exit 1
fi
# Optional — each feature just stays off without its setting.
for v in RESEND_API_KEY EMAIL_FROM ANTHROPIC_API_KEY SLACK_BOT_TOKEN SLACK_ADMIN_CHANNEL CLERK_WEBHOOK_SECRET; do
  grep -qE "^$v=.+" .env || echo "  note: $v isn't set — that feature stays off"
done

echo "→ Pulling latest code..."
git checkout -- deploy.sh 2>/dev/null || true
git pull
chmod +x deploy.sh

echo "→ Building app image..."
docker compose build --no-cache app

echo "→ Starting Postgres..."
docker compose up -d postgres
tries=0
until docker inspect --format='{{.State.Health.Status}}' hive_os_postgres 2>/dev/null | grep -q healthy; do
  tries=$((tries + 1))
  if [ "$tries" -ge 30 ]; then
    echo "STOP: Postgres never reported healthy after 60s. Check its logs:"
    echo "  docker compose logs postgres"
    exit 1
  fi
  echo "  ...still waiting"
  sleep 2
done

PSQL="docker compose exec -T postgres psql -U coach -d coach_os -tAc"

echo "→ Backing up the database..."
mkdir -p backups
backup="backups/pre-deploy-$(date +%Y%m%d-%H%M%S).sql.gz"
docker compose exec -T postgres pg_dump -U coach coach_os | gzip > "$backup"
echo "  ...saved $backup"

# One-time baseline: this DB was originally created with `prisma db push`,
# so it has no migration history. Mark the migrations it already matches as
# applied (checked via the newest pre-existing column), then let
# `migrate deploy` run only the new ones — they carry data backfills that
# `db push` would skip (or refuse to run at all).
if [ -z "$($PSQL "select to_regclass('public._prisma_migrations')")" ]; then
  if [ -z "$($PSQL "select 1 from information_schema.columns where table_name='ClientSheet' and column_name='lastSyncError'")" ]; then
    echo "STOP: database has no migration history and isn't at the expected baseline"
    echo "(ClientSheet.lastSyncError missing). Baseline it by hand — see DEPLOYMENT.md."
    exit 1
  fi
  echo "→ Baselining migration history (first run only)..."
  for m in     20260907192344_init     20260907211508_lead_pipeline     20260907213348_lead_activity_log     20260907214718_lead_stage_timestamps     20260908211316_add_lead_notes     20260908213626_add_lead_sheet_status     20260908220956_add_client_scope_and_referral_link     20260909073000_add_client_archived_at     20260910212824_add_result_status_column     20260925120000_client_sheet_sync_status; do
    docker compose run --rm --no-deps -T app npx prisma migrate resolve --applied "$m"
  done
fi

# Migrate BEFORE the new app container starts, so new code never runs
# against the old schema. A failed migration stops here with the old app
# still serving.
echo "→ Applying database migrations..."
docker compose run --rm --no-deps -T app npx prisma migrate deploy
echo "  ...migrations applied"

# Freeze Snapshot KPIs for any closed month not frozen yet (idempotent —
# only the first run after this feature does real work). Never blocks a
# deploy: the 5-min cron freezes recent months on its own anyway.
echo "→ Backfilling monthly KPIs..."
docker compose run --rm --no-deps -T app npm run --silent db:backfill-kpis || echo "  ...backfill had errors (see above) — rerun: docker compose run --rm app npm run db:backfill-kpis"

echo "→ Starting app..."
docker compose up -d

echo ""
echo "→ Deploy finished. Check logs with: docker compose logs -f app"
