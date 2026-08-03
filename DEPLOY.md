# Deploying Hive OS to portal.hivesocial.agency

## 1. DNS — do this first, it can take a while to propagate

In your DNS provider (wherever hivesocial.agency's DNS lives — Cloudflare,
Namecheap, etc.):

Add an **A record**:
- Name: `portal`
- Value: your VPS IP (`151.106.120.202`, per your existing setup)
- Proxy/CDN: if using Cloudflare, keep it **DNS-only (gray cloud)** while
  Traefik issues the SSL cert, or make sure Cloudflare's SSL mode is
  "Full" not "Flexible" — Flexible breaks Traefik's own cert challenge.

Give it 5–15 minutes to propagate before moving on.

## 2. Decide: shared Postgres or a new one?

You already have a Postgres instance running for Ad Performance OS. Two
options:

**Option A — reuse it (recommended, simpler):**
Just point `DATABASE_URL` at a *new database* on that same Postgres
container:
```
DATABASE_URL="postgresql://user:pass@postgres-host:5432/hive_os"
```
Create the new DB once: `psql -U user -c "CREATE DATABASE hive_os;"`

**Option B — separate Postgres container:**
Only worth it if you want full isolation. Adds another container to
manage for no real benefit at this scale.

## 3. Push code from Windows, pull on the VPS

Same rule as Gingin — commits and pushes only happen from your local
machine, never the VPS:

```powershell
# on Windows, in hive_os folder
git add .
git commit -m "Hive OS v3 — ready for deploy"
git push
```

```bash
# on the VPS
cd /root/automation
git clone <your-repo-url> hive-os   # first time only
cd hive-os
git pull                             # subsequent deploys
```

## 4. Create the production `.env` on the VPS

This file is never committed — create it directly on the server:

```bash
cd /root/automation/hive-os
nano .env
```

```
DATABASE_URL="postgresql://user:pass@postgres-host:5432/hive_os"
META_APP_ID=
META_APP_SECRET=
META_ACCESS_TOKEN=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
CLICKUP_API_TOKEN=
CLICKUP_TEAM_ID=
NEXTAUTH_SECRET=
NEXTAUTH_URL="https://portal.hivesocial.agency"
```

Leave third-party keys blank for now if you haven't got them yet — the
app runs fine without them, those integrations just show "not connected".

## 5. Run the database migration against the live VPS Postgres

```bash
cd /root/automation/hive-os
npx prisma migrate deploy
npm run db:seed          # seeds Revvy, Gingin, JOAT, Loop99, Pink Loan
```

Do **not** run `npm run test:client` on production — that's local demo
data only.

## 6. Merge the service block into your VPS's docker-compose

Copy the contents of `docker-compose.prod.yml` (the `hive-os` service)
into your existing VPS docker-compose file that already runs Traefik and
your other services. Then:

```bash
cd /root/automation
docker compose up -d --build hive-os
```

## 7. Verify

```bash
docker compose logs -f hive-os
```

Watch for `Ready` in the logs, then visit `https://portal.hivesocial.agency`.
First load may take a few extra seconds while Traefik finishes the TLS
cert handshake.

## 8. Future deploys

Same three-step loop every time you ship an update:
```bash
# Windows: commit + push
# VPS:
cd /root/automation/hive-os
git pull
docker compose up -d --build hive-os
```

If a new Prisma migration was added, run `npx prisma migrate deploy`
again before rebuilding the container.