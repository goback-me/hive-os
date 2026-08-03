# Deploying Hive OS — fully isolated, one-command

This project is entirely self-contained on the VPS. It does **not**
touch your main `/root/docker-compose.yml` or your existing Postgres.
The only connection to your existing stack is the shared `root_default`
network, so Traefik (already running as part of your main stack) can
see and route to this container.

## One-time setup

```bash
cd /root/tools
git clone <your-repo-url> hive-os
cd hive-os

cp .env.compose.example .env.compose
cp .env.prod.example .env.prod
nano .env.compose     # set a real POSTGRES_PASSWORD
nano .env.prod         # set the SAME password in DATABASE_URL, plus any API keys you have
```

Both passwords must match exactly — `.env.compose` sets what Postgres
is created with, `.env.prod` is what the app uses to connect to it.

Make sure DNS is pointed first: an A record for `portal` → your VPS IP,
same as any other subdomain on this server.

## Deploy — the one command

```bash
cd /root/tools/hive-os
./deploy.sh
```

This pulls the latest code, builds and starts Postgres + the app (both
isolated to this project), waits for Postgres to be healthy, runs
migrations, and seeds your 5 real clients — all in one shot.

## Every future deploy

Same one command, every time you ship a change:
```bash
cd /root/tools/hive-os
./deploy.sh
```

## Verify

```bash
docker compose -f docker-compose.prod.yml logs -f app
```

Visit `https://portal.hivesocial.agency`.

## Add the test client (optional, for verification only)

```bash
docker compose -f docker-compose.prod.yml exec -T app npm run test:client
```

Remove it once you're satisfied everything works:
```bash
docker compose -f docker-compose.prod.yml exec -T app npx tsx scripts/remove-test-client.ts
```

## What's isolated vs. shared

| | This project |
|---|---|
| Postgres | Own container (`hive_os_postgres`), own volume — completely separate from any other DB on the VPS |
| Docker network | Own internal network for app↔postgres, PLUS the existing `root_default` (external) only so Traefik can route to it |
| Compose file | `docker-compose.prod.yml`, lives inside this repo — never merged into your main compose file |
| Traefik | Reused (already running in your main stack) — this is the one intentional shared piece, since you only want one reverse proxy on the whole server |
