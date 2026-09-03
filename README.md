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
- `stripe-charges` reports `partial` whenever a charge was declined. That is not
  a bug in the sync — a declined card is exactly what it exists to surface, and
  `partial` is what makes the Slack alert fire. `error` still means the sync
  itself broke.
- A null from an API never overwrites a value a human typed. See
  `src/lib/sync/merge.ts`.
- A reschedule updates the existing appointment rather than inserting a second.
- Timestamps are stored UTC and rendered in the sub-account's timezone.

Vercel cron is the only scheduler. Do not add CI jobs against the same database.

### Cron schedule and the Hobby plan

`vercel.json` declares **two** daily crons, because Vercel's Hobby plan allows a
maximum of two cron jobs and only daily schedules. Declaring more fails the
deployment. On Pro, the schedule this app actually wants is:

| Sync | Schedule |
| --- | --- |
| `crm-clients` | hourly |
| `crm-appointments` | every 30 minutes |
| `crm-deals` | hourly |
| `crm-calls` | every 6 hours |
| `windsor-ads` | daily, early morning |
| `stripe-charges` | daily |

Two entries cannot cover six syncs, and the previous arrangement scheduled the
two that seemed most important and left `crm-clients`, `crm-deals`, `crm-calls`
and `stripe-charges` with no schedule at all — which meant they ran only when
somebody remembered, which meant they did not run.

So one cron points at **`/api/cron/sync-all`**, which runs every sync in the
registry in order:

1. `crm-clients` first — it creates the client rows everything else joins to
2. `crm-appointments`
3. `crm-deals`, `crm-calls`, `windsor-ads`
4. `stripe-charges` last — cheapest and least urgent, so it is the right thing
   to lose if time runs out

Sequential, not parallel: these share a GoHighLevel token and rate limit, and
appointments depend on clients existing first.

It stops *starting* new syncs at 240s, because the function is killed at 300s and
a sync killed mid-write leaves its `sync_runs` row saying `running` forever.
Anything not started is named in the response with the reason, and runs on the
next cycle. `crm-appointments` alone has taken 182s on a full import, so this is
a real limit rather than a theoretical one.

The second entry runs `crm-appointments` again at 18:00. Appointments change most,
and the contact-enrichment backlog drains one page per run.

Adding a seventh sync is now a change to the registry, not a fight with the plan
limit. Every sync also still has a **Run now** button in `/settings`, which calls
the identical function.

### Alerts

Set `SLACK_WEBHOOK_URL` and any sync ending `error` or `partial` posts to
`#tech-team`. Successes stay silent on purpose: a channel that fires on every
green run gets muted, and then the red ones are missed too.

## The @apex ticket bot

Tag `@apex` in any Slack channel the bot has been invited to and the message
becomes a ticket on `/tech-support`, assigned to Ally, with a threaded reply
saying so and a `:ticket:` reaction on the original message.

```
@apex the calendar sync is down for Smile Dental #urgent
Started around 9am, three practices affected.
```

The first line becomes the title, the whole message the body, and `#urgent`
sets the priority. `#high`, `#low` and `#normal` work the same way.

Tickets live in `tech_tickets`, which is deliberately **not** `tech_calls`. A
tech call is a booking — it has a time, a confirm step, and can end in a
no-show. A ticket is a piece of work and ends resolved. One table covering both
would offer every status on every row.

### What it refuses to do

- **A bare `@apex`** does not become a ticket. It gets a reply asking what is
  wrong. Filing "(no description)" turns silence into a row somebody has to
  chase, which is the mistake `/api/webhooks/consultation-outcome` refuses to
  make with a blank attendance answer.
- **It never guesses the practice.** Matching practice names against message
  text is what the reconciliation page exists to clean up after. `client_group_id`
  is set by hand on the page or not at all.
- **It never infers priority from wording.** "asap" and "this is urgent" are how
  people write, not how they triage. Only the explicit tag counts.

### Why a retry cannot file a second ticket

Slack gives an endpoint three seconds and retries up to three times, with a
byte-identical payload and no way to switch it off. The route does real work
before answering — a `users.info` call, a permalink call, an insert — and a cold
start alone can eat the budget, so retries are expected rather than exceptional.

`(slack_channel_id, slack_message_ts)` is unique. The retry's insert conflicts,
the existing ticket is read back, and the reply is posted only by the attempt
that actually created the row. Three deliveries, one ticket, one reply. Same
rule as the syncs: re-running never duplicates, because everything upserts on an
external id.

### Setting up the Slack app

Two environment variables — `SLACK_SIGNING_SECRET` and `SLACK_BOT_TOKEN` — and
one app, created once at [api.slack.com/apps](https://api.slack.com/apps).
These are separate from `SLACK_WEBHOOK_URL`, which is the sync-alert webhook and
can only post to `#tech-team`.

1. **Create an app** in the Apex workspace, *From scratch*, named **Apex**. The
   name is what `@apex` matches.
2. **OAuth & Permissions → Bot Token Scopes**, add:

   | Scope | Why |
   | --- | --- |
   | `app_mentions:read` | receive the mention at all |
   | `chat:write` | reply in the thread |
   | `reactions:write` | mark the message filed |
   | `users:read` | the raiser's name |
   | `users:read.email` | match them to a Hub login — without it `raised_by` is always null |
   | `channels:read` | the channel name on public channels |
   | `groups:read` | the same on private ones |

3. **Install to Workspace**, then copy the Bot User OAuth Token (`xoxb-…`) into
   `SLACK_BOT_TOKEN` and the signing secret from **Basic Information → App
   Credentials** into `SLACK_SIGNING_SECRET`. Redeploy — `src/lib/env.ts`
   validates both shapes at boot.
4. **Event Subscriptions → Enable Events**, Request URL:

   ```
   https://<your-app>/api/slack/events
   ```

   Slack sends a signed `url_verification` challenge immediately. It only
   passes once the signing secret is deployed, so do step 3 first. Under
   *Subscribe to bot events* add **`app_mention`** and save.
5. **Invite the bot** to each channel it should watch: `/invite @apex`. It
   cannot see a channel it is not in, which is the intended blast radius.

`TECH_SUPPORT_ASSIGNEE_EMAIL` decides who tickets land on and defaults to
`ally@apexdentalmarketing.net`. If it matches no Hub user the ticket is still
filed — unassigned, and the Slack reply says so out loud rather than losing the
request.

`npm run check:slack` exercises the signature check and the message parser with
no workspace, database or network. Worth running before touching either: the
signature is the only guard on a public URL, and the parser decides what a
ticket says.

## Billing

`/billing` answers one question: was this consult actually paid for?

Nothing else in the stack can. GoHighLevel holds no record of Apex billing its
clients — the sub-accounts and the Pay Per Show System location both return zero
invoices and zero transactions. The tracker and the stat sheets only know what
was *supposed* to be billed. Stripe is the only system that knows what was.

Two failure modes, and keeping them apart is the point of the page:

- **The card was declined.** Visible in Stripe as a payment intent sitting at
  `requires_payment_method` with a `last_payment_error`. It is worth reading
  payment intents rather than invoices or charges, because a declined autocharge
  frequently never becomes either.
- **No charge was ever attempted.** Invisible in Stripe by definition. It shows
  up on the page as an active client with no rows against it, which is why the
  table lists every active client rather than only the ones with charges.

`billing_customers` maps a Stripe customer to a client. Most cannot be matched
automatically — Stripe customers are named after the practice owner rather than
the practice — so unmapped ones are listed on the page for a human to map, and
`mapped_by_hand` stops the next sync from overwriting that decision. A practice
with two Stripe customers is a real thing that happens, and it means the same
consults get billed twice, so the duplicates are shown rather than merged.

## Roles

`admin` sees everything. `isr` and `csr` see only their own performance page.
`client` is bounced to their portal. Enforced in `src/middleware.ts`, never in
components.
