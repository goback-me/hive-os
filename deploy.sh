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

echo "→ Pulling latest code..."
git checkout -- deploy.sh 2>/dev/null || true
git pull
chmod +x deploy.sh

echo "→ Building and starting containers..."
docker compose build --no-cache app
docker compose up -d

echo "→ Waiting for Postgres to be healthy..."
until docker inspect --format='{{.State.Health.Status}}' hive_os_postgres 2>/dev/null | grep -q healthy; do
  echo "  ...still waiting"
  sleep 2
done

echo "→ Syncing database schema..."
docker compose exec -T app npx prisma db push
echo "  ...schema synced"

echo "→ Seeding sample clients (safe to re-run)..."
docker compose exec -T app npm run db:seed
echo "  ...seed complete"

echo ""
echo "→ Deploy finished. Check logs with: docker compose logs -f app"
