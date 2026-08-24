# PPS template — the corrected `01 - New Appointment Booked`

**Status: created in Make, inactive, nothing live touched.**

The corrected template now exists as scenario **`6033666`**, in the same folder
as the original (`186831`), named
`01 - PPS - New Appointment Booked -> Update sheet - [CORRECTED TEMPLATE - inactive, for review]`.

- `isActive: false` — it is not running and has no schedule that will start it.
- `hookId: null` — it holds **no webhook**, so nothing can reach it until
  somebody deliberately attaches one. It cannot take traffic from hook
  `1657778`, which the live template still owns.
- Every sheet module targets `1 - COPY THIS - Stat Sheet Template`, so even a
  manual test run cannot touch a client sheet.
- The original `5947250` was **not modified** — it is untouched and still live.

Verified after creation by reading the scenario back and checking the corrected
fields, the deliberately-unchanged fields, all 13 module ids, and the column
inventory of every `addRow` against the original. All matched.

This directory holds the same blueprint as files, so the change is reviewable
without opening Make.

- `01-new-appointment-booked.original.json` — scenario `5947250` exactly as it
  runs today, pulled 2026-08-24.
- `01-new-appointment-booked.corrected.json` — the same blueprint with four
  fields changed. Nothing else differs; see the diff below.

---

## Why this exists

The audit (`earl-audit-findings.md`, F-01/F-02/F-21/F-30) found that this
template silently discards roughly one booking in four and logs every one of
them as SUCCESS. 45 sub-accounts run clones of it. 11 of 42 real bookings in a
five-day window wrote nothing to a client sheet.

Remediation was not carried out at the time because it means editing live
scenarios for 45 practices, and that was not authorised. This is the reviewed
change, ready to apply the moment it is.

---

## What was actually wrong

The audit summary said the template drops "every direct, calendar-widget and
ISA booking". Reading the blueprint, that is not quite it, and the real shape
matters because it tells you which bookings to go looking for.

The top router already has two routes:

| Route | Gate | What it does |
|---|---|---|
| 0 | `attributionSource.url` **exists** | parse `utm_id`, then write to the sheet |
| 1 | `attributionSource.url` **does not exist** | write to the sheet directly |

So a booking with no attribution URL at all is handled — route 1 catches it.
The population that is lost is narrower and less obvious:

> **A booking that carries an attribution URL but no `utm_id` inside it.**

Route 0 claims it because the URL exists. Module 3 then parses for `utm_id`,
finds none, and because `continueWhenNoRes` is `false` the route **terminates**.
Route 1 cannot pick it up, because route 1 requires the URL to be absent. The
booking falls between the two routes and the execution reports SUCCESS.

That is any visit that landed with a URL but without campaign parameters —
organic search, a direct type-in that still carries a path, a calendar widget
link, an ISA booking made through the site. It is why the loss is ~26% rather
than ~100%.

There is a second, smaller leak further down. Among bookings that *do* survive
the parser, the sub-router partitions on `utmMedium`:

- route 0: `notcontain "paid"`
- route 2: `equal "paid"`

That is not a partition. `paid-social` and `cpc-paid` **contain** "paid" but do
not **equal** it, so they match neither branch and are dropped after surviving
everything else.

---

## The four changes

```
flow.0.parameters.hook                    1657778  ->  (removed)
flow.1.routes.0.flow.0
  .parameters.continueWhenNoRes             false  ->  true
flow.1.routes.0.flow.2.routes.2.flow.0
  .filter.conditions.0.1.o             text:equal  ->  text:contain
metadata.scenario.dataloss                  false  ->  true
name                        [ADM Ortho Snapshot]  ->  [CORRECTED TEMPLATE ...]
```

That is the complete diff — verified by comparing every leaf in both files, not
by reading them. Five leaves differ and four of them are the fix.

**1. `continueWhenNoRes: false → true` (module 3) — the actual bug.**
A regex parser was being used as a gate. Its capture feeds exactly one thing,
column 23, and nothing else references it. So letting it continue writes an
empty column 23 for a booking with no `utm_id` — which is the truthful value,
and is already what route 1 writes for bookings with no URL. Nothing else in
the route depends on the parser succeeding.

**2. `text:equal → text:contain` (module 8) — closes the `paid-social` gap.**
Pairs correctly against route 0's `notcontain "paid"`, so the two branches are
now mutually exclusive and jointly exhaustive.

**3. `dataloss: false → true`.**
Incomplete executions were not being stored, so a halted route left nothing to
inspect or replay. With this on, anything that does fail is recoverable instead
of merely gone.

**4. Webhook binding removed.**
The original binds hook `1657778`. A clone must not share it, or it would sit
on the live template's inbound traffic. Importing without the binding provisions
a fresh webhook.

---

## Deliberately not changed

**Module 9 / route 3.** Its filter compares `utmMedium` to the literal string
`"{{paid"` — an unclosed mapping stored as text, so the branch can never match.
It is dead code today and stays dead after change 2. It is left in place
because its *intent* is unclear: it writes the same columns as module 8 except
column 28 instead of 27, and nobody still here knows which was meant. Deleting
it would destroy the only evidence of what it was for. **Question for Joshua or
Earl: was route 3 meant to catch something module 8 does not?**

**Error handlers (F-14).** No module in the fleet has an `onerror` branch, so
failures die quietly. This is a real gap, but adding handlers is a design
decision — a badly chosen "resume" handler hides the very failures it is meant
to surface, which would be worse than the current state. `dataloss: true` gives
most of the diagnostic benefit with none of that risk. Handlers should be a
separate, deliberate change.

**Column semantics (F-26/F-27).** Several columns are populated from fields
that do not match their headers. Fixing that changes what clients see in their
sheets and needs sign-off, not a quiet correction.

---

## Testing it

Scenario `6033666` already exists and is ready to test. It carries no webhook,
so give it one first — that is the only setup step.

1. Open `6033666` in Make
2. Click the webhook module and create a **new** webhook. Do not select the
   existing one; hook `1657778` belongs to the live template and sharing it
   would put this scenario on production traffic.
3. Confirm the Google Sheets connection resolved to `6237841` (Josh@apex).
   It should have carried over, since connections are team-scoped.
4. Send the two payloads below and check the template sheet.

If you would rather rebuild it from the file than use `6033666`:
**Create a new scenario → Import Blueprint** →
`01-new-appointment-booked.corrected.json`. Either route leaves `5947250`
untouched.

The two payloads that matter:
   - one with `attributionSource.url` present and **no** `utm_id` — this is the
     case that currently writes nothing, and it must now write a row with
     column 23 empty
   - one with `utmMedium = paid-social` — currently matches no branch, and must
     now land via module 8

Only once both pass is it worth discussing the 45 clones. The audit's
recommendation there was to **consolidate to one scenario keyed on
`location.id`** rather than repair 45 copies, and that decision is still open.

---

## What this does not fix

This is the template only. It does nothing about:

- the **4 sub-accounts writing into other practices' sheets** (F-04 to F-07) —
  those are per-scenario sheet-target errors and need repointing individually
- the **38 practices with no execution on record** (F-11) — they are receiving
  nothing at all, which is a separate and larger problem
- the **4 dormant Stripe invoicing scenarios** (F-12) — no Make-driven
  invoicing runs for anyone
- the **4 live webhooks with no scenario attached** (F-15), queues filling
  toward the 2,668 limit

No credentials appear in either file. The only identifiers are a numeric
connection id and the template spreadsheet and folder ids.
