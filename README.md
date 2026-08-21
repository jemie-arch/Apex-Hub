# Apex Client Hub

Internal reporting layer for Apex Dental Marketing. GoHighLevel remains the
system of record for operations; this app answers the questions the CRM cannot.

## The distinction that matters

- **client_groups** — the business. A dental practice. This is what "44 clients,
  100 by December" counts, what signs a retainer, and what logs into the portal.
- **clients** — one GoHighLevel sub-account. A practice has several when its
  locations are far enough apart to need their own area code for A2P.

Bookings, ads and phone numbers live at the sub-account level and roll up to the
business. Collapsing the two would make the headline client count wrong by
however many multi-sub-account practices exist — which is the number the company
steers by.

## Two funnels, modelled separately

| Funnel | Meaning | Tables |
| --- | --- | --- |
| b2b | Apex selling retainers to practices | `deals`, `sales_calls` |
| b2c | A practice booking patients | `appointments` |

They have different lifecycles and different definitions of "converted", so they
never share a table.

## Stack

Next.js 14 App Router · TypeScript strict · Supabase (Postgres) · Tailwind over
CSS custom properties · deployed on Vercel.

## Setup

1. Apply `supabase/migrations/0001_init.sql` to an empty database. That one file
   rebuilds everything; there is no second migration.
2. Set the environment variables in `.env.example`. Shapes are validated at boot
   by `src/lib/env.ts`, which fails loudly rather than rendering zeroes.
3. Create your admin row:

   ```sql
   insert into user_profiles (id, email, role)
   values ('<auth-user-uuid>', 'you@example.com', 'admin');
   ```

   A trigger mirrors `role` into the JWT, which is what middleware reads.
4. Connect GoHighLevel at `/settings`, then run the syncs from the same page.

## Syncs

Every integration has the same four parts: a function in `src/lib/sync/`, a CLI
script in `scripts/`, a route at `/api/sync/[name]`, and a row in `sync_runs`
recording counts and errors. Any sync can therefore be run by hand when it
breaks.

Rules that hold throughout:

- Re-running never duplicates; syncs upsert on an external id.
- A null from an API never overwrites a value a human typed. See
  `src/lib/sync/merge.ts`.
- A reschedule updates the existing appointment rather than inserting a second.
- Timestamps are stored UTC and rendered in the sub-account's timezone.

Vercel cron is the only scheduler. Do not add CI jobs against the same database.

## Roles

`admin` sees everything. `isr` and `csr` see only their own performance page.
`client` is bounced to their portal. Enforced in `src/middleware.ts`, never in
components.
