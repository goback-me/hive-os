#!/bin/bash
# The one command to deploy Hive OS.
#
# Usage:
#   cd /root/tools/hive-os
#   ./deploy.sh
#
# First run: if .env doesn't exist, this creates it from .env.example
# and STOPS with instructions — it will not try to run with placeholder
# values. Edit .env, then run ./deploy.sh again.

set -e
cd "$(dirname "$0")"

# ── Step 0: make sure .env actually exists and is filled in ──────────
if [ ! -f .env ]; then
  echo "No .env file found — creating one from .env.example."
  cp .env.example .env
  echo ""
  echo "STOP: edit .env now and set a real POSTGRES_PASSWORD and matching"
  echo "DATABASE_URL, then run ./deploy.sh again."
  echo ""
  echo "  nano .env"
  echo ""
  exit 1
fi

if grep -q "change-this-password" .env; then
  echo "STOP: .env still has the placeholder password. Edit .env and set"
  echo "a real password in BOTH POSTGRES_PASSWORD and DATABASE_URL (they"
  echo "must match), then run ./deploy.sh again."
  echo ""
  echo "  nano .env"
  echo ""
  exit 1
fi

# ── Step 1: pull latest code ──────────────────────────────────────────
echo "→ Pulling latest code..."
git pull

# ── Step 2: build and start (postgres + app, self-contained) ─────────
echo "→ Building and starting containers..."
docker compose --progress=plain build --no-cache app
docker compose up -d

# ── Step 3: wait for postgres to actually be healthy ──────────────────
echo "→ Waiting for Postgres to be healthy..."
until docker inspect --format='{{.State.Health.Status}}' hive_os_postgres 2>/dev/null | grep -q healthy; do
  echo "  ...still waiting"
  sleep 2
done

# ── Step 4: sync schema + seed ─────────────────────────────────────────
# Using `db push` rather than `migrate deploy` — no migration history
# files exist yet (would need a local Postgres to generate them via
# `prisma migrate dev`). db push syncs the schema directly, which is
# fine pre-launch. Switch to proper migrations once this is live with
# real client data you don't want to risk with schema drift.
echo "→ Syncing database schema..."
docker compose exec -T app npx prisma db push
echo "  ...schema synced"

echo "→ Seeding base clients (safe to re-run)..."
docker compose exec -T app npm run db:seed
echo "  ...seed complete"

echo ""
echo "→ Deploy finished. Check logs with:"
echo "    docker compose logs -f app"
echo ""
echo "→ Visit: https://portal.hivesocial.agency"