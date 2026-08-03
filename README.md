# Hive OS — v3 (real brand, full page set, real features)

Built on HiveSocial's actual brand colors (`#4a2874` purple / `#f8b144`
amber), light-mode-first, matching the 7 Stitch-generated mockups exactly:
Dashboard, Clients, Client detail, Referrals, Reports, Settings, and the
global Search + Notifications overlays.

## What's genuinely functional (not placeholder)

- **Search (⌘K)** — real client-side search across your actual clients,
  plus quick-jump shortcuts to every page. Try the button in the header
  or press Cmd/Ctrl+K anywhere.
- **Notifications** — the bell shows real `NeedsActionItem` rows, not
  sample data.
- **Add client** — the modal on `/clients` actually creates a `Client`
  row via a server action and redirects to its detail page.
- **Kanban** — unchanged from before, fully real (create/toggle tasks).
- **Referrals** — the submission form creates real `Referral` rows;
  Approve/Reject buttons update real status; the stat cards (total,
  approved, payouts, pending) are computed from the real table.
- **Reports** — client selector filters real data; summary cards
  (conversion rate, spend, CAC) are computed from real leads/spend;
  lead-source breakdown and the 14-day spend chart are real; **Export
  CSV** is a real download that also logs a row to `GeneratedReport`,
  which populates the "Recent exports" table below it.
- **Settings → Team** — Invite member modal creates a real `User` row.
  **Integrations** — Meta/Stripe status reflects whether
  `META_ACCESS_TOKEN` / `STRIPE_SECRET_KEY` are set in `.env`; ClickUp/
  Swarm show real per-client connection counts.

## What's honestly still a "not connected" state

These need real third-party credentials/OAuth that don't exist yet —
no amount of UI polish makes them real without that:
- **Ad review panel** (client detail page) — shows a real "not
  connected" state if `swarmProjectId` is unset on that client; there's
  no fake sample creative data.
- **ClickUp/Swarm embeds** — same reasoning; connect per-client via
  `Client.clickupListId` / `swarmProjectId` once you have real IDs.
- **Team invite** creates the row but has no email/password-setup flow —
  that needs a real auth system (NextAuth or similar) wired up first.

Billing/subscription section was removed from Settings per request —
doesn't make sense for a single-tenant internal tool anyway. Same logic
applied to the mockup's "Danger zone" (archive/delete agency) — cut
entirely rather than shipping a destructive button that does nothing
or, worse, actually deletes everything.

## Setup

```bash
cp .env.example .env
docker compose up -d
npm install
npx prisma migrate dev --name add_referrals_and_reports
npm run db:seed
npm run test:client
npm run dev
```

Visit `/dashboard`, `/clients`, `/clients/test-client`, `/referrals`,
`/reports`, `/settings` — everything above is live with real data from
the test-client seed.

## New since last version

- `prisma/schema.prisma` — added `Referral`, `GeneratedReport` models;
  added `title` field to `User`
- `lib/actions.ts` — added `createClient`, `createReferral`,
  `updateReferralStatus`, `inviteMember`
- `lib/dashboard-data.ts` — added `getAgencyDailySpend`,
  `getLeadSourceBreakdown`, `getReportSummary`
- `app/api/reports/export/route.ts` — real CSV export endpoint
- `components/SearchOverlay.tsx`, `components/NotificationsBell.tsx`,
  `components/AppHeader.tsx` — new shared header, now rendered once in
  `app/layout.tsx` instead of per-page
- `app/clients/AddClientModal.tsx`, `app/settings/InviteMemberModal.tsx`
  — new client components wrapping server-action forms
- `app/globals.css` — full palette swap to the real brand colors,
  light-mode-first

## Cron (unchanged)

```bash
*/15 * * * * cd /root/automation/hive-portal && npm run cron:needs-action >> /var/log/hive-portal-cron.log 2>&1
```
