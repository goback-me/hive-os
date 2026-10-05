# Hive HQ — Go-live handover

Step-by-step guide to putting Hive HQ live and keeping it running. Follow it
top to bottom the first time. For more detail on the deploy script and the
database migrations, see [DEPLOYMENT.md](DEPLOYMENT.md).

---

## What you're deploying

- **The app:** Next.js 14 + Postgres 16, as two Docker containers
  (`hive_os_app`, `hive_os_postgres`) on the VPS. It's served over HTTPS by
  the **Traefik** proxy that's already running there.
- **Sign-in:** Clerk.
- **Data in:** each client's Google Sheet (leads), synced every 5 minutes,
  plus Meta ad spend per client.
- **Background work:** one URL, `/api/cron/sync`, called every 5 minutes by
  the VPS crontab. It syncs sheets, writes statuses back to the sheets, and
  sends the reminders, the Slack posts, the emails and the ClickUp tasks.
- **Outbound services:** Slack, Resend (email), ClickUp, Anthropic (optional
  AI for reading call notes).

---

## Before you start — what you need

| Need | Who / where |
|---|---|
| SSH access to the VPS, with Docker + Docker Compose installed | Server admin |
| Traefik running on the VPS with a Docker network named `root_default` | `docker network ls \| grep root_default` |
| The live domain (e.g. `portal.hivesocial.agency`) — able to edit its DNS | Domain admin |
| Admin on the **Clerk** account (production instance) | clerk.com |
| A **Google Cloud** project for the Sheets/Drive connection | console.cloud.google.com |
| Admin on the **Slack** workspace (to install the app) | api.slack.com |
| A **ClickUp** account that can create tasks in your workspace | ClickUp |
| **Resend** account with the sending domain verified | resend.com |
| GitHub access to `goback-me/hive-os` (branch `main`) | GitHub |

---

## Step 1 — DNS

Point the live domain at the VPS:

```
portal.hivesocial.agency   A   <VPS IP address>
```

Traefik gets the HTTPS certificate automatically once DNS resolves.

## Step 2 — Get the code onto the VPS

```bash
ssh <you>@<vps>
cd /opt
git clone https://github.com/goback-me/hive-os.git hive-os
cd hive-os
git checkout main
```

## Step 3 — Set up the outside services

Do these before writing `.env`; each one gives you values for it.

### 3a. Clerk (sign-in)
1. Clerk dashboard → **production** instance → **API Keys**. Copy the
   publishable key (`pk_live_…`) and the secret key (`sk_live_…`).
2. **User & Authentication → Restrictions → turn "Allow sign-ups" OFF.**
   Logins are only ever created inside the app (Settings → Users & logins).
3. **Domains:** add the live domain.
4. **Webhooks → Add endpoint:** `https://<domain>/api/webhooks/clerk`, with the
   user events. Copy the signing secret (`whsec_…`).

### 3b. Google (lead sheets)
1. Google Cloud Console → APIs & Services → enable the **Google Sheets API** and
   the **Google Drive API**.
2. **OAuth consent screen:** set it to External or Internal, and **publish** it
   to Production. If it stays in "Testing", the connection expires every 7 days.
3. **Credentials → Create OAuth client ID → Web application.**
   Authorised redirect URI: `https://<domain>/api/google/callback`
4. Copy the Client ID and Client secret.

### 3c. Slack (client channel posts)
1. api.slack.com → your app (or **Create New App**) → **OAuth & Permissions**.
2. **Bot token scopes:** `chat:write`, `chat:write.public`, `channels:read`, `groups:read`.
3. **Redirect URL:** `https://<domain>/api/slack/callback`
4. **Install to workspace.** Copy the **Bot User OAuth Token** (`xoxb-…`) and,
   from Basic Information, the Client ID + Client Secret.
5. **For every private client channel:** `/invite @<your bot name>` in that
   channel. Public channels work without an invite.

> Use a **bot** token (`xoxb-`) on the live server, not a user token (`xoxp-`).
> A user token posts as that person, can read their DMs, and stops working if
> they leave.

### 3d. Resend (email)
1. resend.com → **Domains** → `notify.hivesocial.agency` must show **Verified**.
   If it says "Partially verified" or "Not verified", open it and make sure
   every DNS record it lists exists exactly as shown: DKIM on
   `resend._domainkey.notify…`, plus SPF/MX on the return-path subdomain
   (`rsend.notify…`). Then click Verify.
2. **API Keys → Create** with **Sending access** only. Copy it (`re_…`).
3. Sender name: use **"Hive HQ"**, never **"Hive Social"**. A sender name
   matching an account in your own Google Workspace makes Gmail show an
   impersonation warning.

### 3e. ClickUp (tasks)
ClickUp isn't set in `.env`; it's entered inside the app (Step 7). Get ready:
1. Decide which ClickUp account HQ acts as. The current key belongs to
   **integrations@hivesocial.com.au**.
2. That account must be able to create tasks. Either make it a **Member** of
   the workspace (ClickUp → Settings → People), or keep it a guest and **share
   a "Clients" folder with it with Full edit permission**.
3. ClickUp → avatar → **Settings → Apps → API Token** (`pk_…`), and your
   **Team ID** (the number in your ClickUp URL).

### 3f. Anthropic (optional)
console.anthropic.com → API Keys. Used to read call-note write-ups the rules
can't place, and to work out DQ reasons. Leave it blank and those notes just
stay as plain notes.

## Step 4 — Create `.env` on the VPS

```bash
cd /opt/hive-os
cp .env.example .env
nano .env
```

Generate the secrets with `openssl rand -hex 32` (run it once per secret).

| Variable | Required | Value |
|---|---|---|
| `POSTGRES_PASSWORD` | ✅ | A strong password |
| `DATABASE_URL` | ✅ | `postgresql://coach:<POSTGRES_PASSWORD>@postgres:5432/coach_os` |
| `APP_DOMAIN` | ✅ | `portal.hivesocial.agency` (no `https://`) |
| `NEXTAUTH_URL` | ✅ | `https://portal.hivesocial.agency`. Every link in Slack, email and ClickUp uses it |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` | ✅ | From 3a |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` / `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL` | ✅ | `/login` and `/dashboard` |
| `CLERK_WEBHOOK_SECRET` | Recommended | From 3a |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | ✅ | From 3b |
| `GOOGLE_REDIRECT_URI` | ✅ | `https://portal.hivesocial.agency/api/google/callback` |
| `TOKEN_ENCRYPTION_KEY` | ✅ | `openssl rand -hex 32`. **Never change it after go-live**: it decrypts the stored Google/Meta/Slack tokens |
| `CRON_SECRET` | ✅ | `openssl rand -hex 32` |
| `SLACK_BOT_TOKEN` | For Slack | `xoxb-…` from 3c |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | For "Add to Slack" | From 3c |
| `SLACK_ADMIN_CHANNEL` | Optional | Channel ID for the agency-wide 8am digest and "call didn't happen" notes |
| `RESEND_API_KEY` | For email | `re_…` from 3d |
| `EMAIL_FROM` | For email | `Hive HQ <updates@notify.hivesocial.agency>` |
| `ACTION_TOKEN_SECRET` | For email | `openssl rand -hex 32`. Signs the email buttons' links |
| `ANTHROPIC_API_KEY` | Optional | From 3f |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | For Step 6 | Your first admin login |

The deploy script refuses to run if a ✅ setting is missing, if
`NEXTAUTH_URL` is `http://`, or if email is half set up. It also lists the
optional features that will stay off.

## Step 5 — Deploy

```bash
cd /opt/hive-os
chmod +x deploy.sh
./deploy.sh
```

What it does, in order (and it stops safely if any step fails):
1. Checks `.env` (above).
2. `git pull` on the checked-out branch.
3. Builds the app image.
4. Starts Postgres and waits for it to be healthy.
5. **Backs up the database** to `backups/pre-deploy-<time>.sql.gz`.
6. Applies database migrations, **before** the new app starts.
7. Freezes past months' KPIs (only does work the first time).
8. Starts the new app.

Check it:
```bash
docker compose ps                 # both containers "Up" / "healthy"
docker compose logs -f app        # no errors
curl -I https://portal.hivesocial.agency/login   # HTTP 200
```

## Step 6 — First admin login

```bash
docker compose exec app npm run create-admin
```

This creates (or promotes) `ADMIN_EMAIL` as an admin. Sign in at
`https://<domain>/login`. If some coach logins already exist and should all be
admins, run `docker compose exec app npm run promote-coaches` instead, then
sign out and back in.

## Step 7 — Connect everything inside the app (admin)

1. **Leads page → Connect Google** with the Google account that can open all
   the client sheets. Accept every permission, including editing sheets; HQ
   writes statuses back.
2. **Settings → Integrations:**
   - **Slack:** "Add to Slack", or rely on `SLACK_BOT_TOKEN`.
   - **ClickUp API key + Team ID** (from 3e) → Save.
3. **Settings → Users & logins:**
   - Create the team logins. **Manager** sees all clients; **Agent** sees only
     the clients they run the weekly call for.
   - Next to each team member, pick their **ClickUp user**, so weekly-call
     tasks are assigned to them.
   - Create client logins if clients will sign in themselves.

## Step 8 — The cron (makes all the automations run)

On the VPS: `crontab -e`, then add one line (adjust the path and domain):

```cron
*/5 * * * * curl -fsS --max-time 290 -H "x-cron-secret: $(grep '^CRON_SECRET=' /opt/hive-os/.env | cut -d= -f2-)" https://portal.hivesocial.agency/api/cron/sync >> /var/log/hive-cron.log 2>&1
```

Test it once by hand. It should print JSON, not "Unauthorized":
```bash
curl -s -H "x-cron-secret: <CRON_SECRET>" https://portal.hivesocial.agency/api/cron/sync | head -c 400
```

If an old n8n workflow also calls this URL, **turn it off**. Two callers just
do everything twice.

## Step 9 — Add each client

**Clients → Add Client** asks for everything in one go:
- **The client:** name, type (Trade / Service / Other), start date, status.
- **How we reach them:** client email (for reminder emails), Slack channel ID,
  Google Drive folder.
- **ClickUp:** create their Account / Client / Other lists (or use an existing
  list), and who HQ's tasks are assigned to.
- **Weekly call:** who runs it, and on which day.

Only the name is required. Anything left blank just **pauses** that automation
for that client; nothing errors. Their page then shows a **"Automation
setup"** checklist of what's still missing, with links. The client email can be
added right there.

Then connect their **leads Google Sheet**: Leads page → pick the client → pick
the spreadsheet and tab → check the status columns → **Sync now**.

## Step 10 — Go-live checks

Tick each one:

- [ ] `https://<domain>/login` loads over HTTPS and you can sign in.
- [ ] Leads page shows Google connected; one client's **Sync now** works.
- [ ] Bell icon: no red data alerts (fix anything it lists).
- [ ] A client's Integrations card → **Send test message** posts in their Slack channel.
- [ ] Integrations card → **+ Create ClickUp task** creates a task in their list, assigned correctly.
- [ ] The cron log (`tail -f /var/log/hive-cron.log`) shows a JSON line every 5 minutes.
- [ ] Each client's "Automation setup" checklist is empty, or only shows things you've chosen to leave off.

---

## What the automations send

Everything below is sent by the cron. Each item goes out **once only** (a
re-run never duplicates it), and a failure in Slack, email or ClickUp never
blocks the rest. It shows up as a warning in the bell instead.

### Slack — to the client's channel (each one can be switched off per client)

| Message | When | Example |
|---|---|---|
| **New sale** | A lead is marked Won with a value | 🎉 **New job won for Jake Of All Tradez!** Kate — **$30,000**, 58 days after they first enquired. |
| **New live transfer** | A lead is live-transferred | 📞 **New live transfer for Jake Of All Tradez.** Laura Carter was just put through to you on the phone. |
| **Weekly update** | A coach publishes the weekly update | 📝 **Here's this week's update for Jake Of All Tradez** — What went well / What's getting in the way / What happens next, + link |
| **Daily digest** | Every day from 8am Sydney | 🌅 **Good morning! Here's how yesterday went for …** new leads, live transfers, quotes, jobs won, leads waiting on an update, next step |
| **Waiting on an update** | With the reminder email (from 9am) | ⏳ **7 leads waiting on an update**, with the list and a link |
| **Weekly call summary** | When an agent logs a call as held | 📞 **Weekly call — Fri 2 Oct** summary, issues, next steps |
| *(admin channel)* **Portfolio digest** | Daily from 8am, if `SLACK_ADMIN_CHANNEL` is set | Clients that need attention |
| *(admin channel)* **Call didn't happen** | When a call is logged as not held | ⚠️ Jake Of All Tradez — Fri 2 Oct's weekly call didn't happen: Rescheduled |

### Email — via Resend, one button each, the button opens the right page in HQ

| Email | To | When | Subject |
|---|---|---|---|
| **Leads waiting on your update** | The client (their login emails, else the client email) | From 9am. Handover leads after 7 days, then every 7 days. Booked / attended / quoted leads on their own schedule (the client's buying cycle). | `Jake Of All Tradez: 7 leads waiting on your update`. The list shows each lead, what's needed and days waiting; the button opens their Update page with those leads pinned |
| **Log your weekly call** | The call agent | Monday 9am after the call day | `[Jake Of All Tradez] Log your weekly call — Fri 2 Oct` |
| **Weekly call reminder** | The call agent | Wednesday 9am, if still not logged | `[Jake Of All Tradez] Reminder: weekly call not logged yet — Fri 2 Oct` |

No client email → that client's reminder emails are paused (shown on their setup
checklist). Everything else still runs.

### ClickUp — in the client's list, assigned to the client's chosen people

Every task title starts with **[Client name]**. The description opens with
**Client / Why this task / Open in Hive HQ**.

| Task | When | Closes |
|---|---|---|
| **[Client] Fix data — …** (e.g. Google connection isn't working) | After a sync finds a serious data problem | By itself, when fixed |
| **[Client] Chase client — 7 leads waiting on their update** | With the reminder, at most once a week | By hand |
| **[Client] Write and publish this week's update (due Friday 5pm)** | Every week from 8am Monday | By hand |
| **[Client] Account review — client at risk** | Weekly, only when the client is red on the portfolio | By hand |
| **[Client] Log the weekly call — Fri 2 Oct** | Monday 9am after the call, assigned to the call agent; a reminder comment on Wednesday | By itself, when logged |

---

## Running it day to day

| Task | Command (on the VPS, in `/opt/hive-os`) |
|---|---|
| Deploy an update | `git push` to `main` from your machine, then `./deploy.sh` on the VPS |
| See app logs | `docker compose logs -f app` |
| See the cron log | `tail -f /var/log/hive-cron.log` |
| Restart the app (e.g. after editing `.env`) | `docker compose up -d --force-recreate app` (a plain `restart` does **not** reload `.env`) |
| Take a backup now | `docker compose exec -T postgres pg_dump -U coach coach_os \| gzip > backups/manual-$(date +%F).sql.gz` |
| Restore a backup | Into an empty `coach_os` DB: `gunzip -c backups/<file>.sql.gz \| docker compose exec -T postgres psql -U coach -d coach_os` |
| Roll back | `git checkout <previous commit>`, then `./deploy.sh` |

Copy `backups/` off the server regularly. Every deploy also makes one.

---

## Troubleshooting

| You see | Cause → fix |
|---|---|
| ClickUp list picker is empty / "can't see any spaces" | The ClickUp key's account is a **guest**. Make it a Member, or share a folder with it (Full edit). Shared lists and folders show as "Shared / …" |
| Slack test: `channel_not_found` | Private channel the bot isn't in → `/invite @<bot>` in that channel. Or the ID is wrong: it looks like `C0123ABCD`, from channel name → About |
| Slack test: `not_in_channel` | Same: invite the bot |
| Resend: "domain is not verified" | Resend → Domains → fix the DNS records it shows, then Verify |
| Gmail: "Be careful with this message" | Sender name matches your own Workspace account → `EMAIL_FROM=Hive HQ <…>` |
| Email arrives but the link opens localhost | `NEXTAUTH_URL` / `APP_URL` isn't the live https address |
| Google "Reconnect" banner | The Google token expired or the consent screen is still "Testing" → publish it, reconnect on the Leads page |
| Nothing automatic is happening | The cron isn't running: check `crontab -l` and the cron log, and that `CRON_SECRET` matches |
| A client gets no reminder emails | Their setup checklist shows "Client email": add it there, or create their client login |
| After a schema update: "Cannot read properties of undefined (reading 'findMany')" | The app is running an old database client → `./deploy.sh` (or recreate the app container) |
| Building on a Windows PC fails with "Can't resolve '@/lib/…'" | That PC has `NODE_ENV=production`, so npm skipped dev tools → `npm install --include=dev` |
