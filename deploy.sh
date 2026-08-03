#!/bin/bash
# One-command deploy for Hive OS on the VPS.
#
# Usage:
#   cd /root/tools/hive-os
#   ./deploy.sh
#
# What it does, in order:
#   1. Pulls the latest code
#   2. Builds and starts postgres + app (self-contained, own network)
#   3. Waits for postgres to be healthy
#   4. Runs prisma migrate deploy
#   5. Runs the seed script (safe to re-run — upserts, won't duplicate)
#
# Requires .env.prod and .env.compose (see below) to already exist —
# this script does not create them for you.

set -e

echo "→ Pulling latest code..."
git pull

echo "→ Building and starting containers..."
docker compose -f docker-compose.prod.yml --env-file .env.compose up -d --build

echo "→ Waiting for Postgres to be healthy..."
until docker inspect --format='{{.State.Health.Status}}' hive_os_postgres 2>/dev/null | grep -q healthy; do
  echo "  ...still waiting"
  sleep 2
done

echo "→ Running database migrations..."
docker compose -f docker-compose.prod.yml exec -T app npx prisma migrate deploy

echo "→ Seeding base clients (safe to re-run)..."
docker compose -f docker-compose.prod.yml exec -T app npm run db:seed

echo "→ Done. Check status with:"
echo "    docker compose -f docker-compose.prod.yml logs -f app"