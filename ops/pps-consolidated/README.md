# One automation for every clinic

Replacing the per-client pattern — 5 scenarios × 56 clinics = 280 blueprints,
each with a spreadsheet id pasted inside it — with one set of scenarios that
look the sheet up at runtime.

## Why the per-client pattern has to go

The spreadsheet id living inside each clone is what makes the current faults
possible and invisible. Three scenarios are configured to write into another
practice's file, one reads a file nothing writes to, two point at a single file
neither can prove it owns, and one has a trailing newline on both lookup ids.
None of it is visible in Make, because a module's display label is a cache
frozen when the file was picked.

Adding a clinic today means cloning five scenarios and editing up to eight
spreadsheet references in each. Every one of those edits is a chance to paste
the wrong id, and nothing checks.

## The shape

One webhook, shared by every clinic:

```
gateway:CustomWebHook            one URL for all clinics
  -> datastore:GetRecord         key = {{1.location.id}}
  -> regexp:Parser               utm_id out of the attribution url
  -> google-sheets:filterRows    spreadsheetId = {{2.spreadsheet_id}}
  -> builtin:BasicRouter
       row absent  -> addRow     spreadsheetId = {{2.spreadsheet_id}}
       row present -> updateRow  spreadsheetId = {{2.spreadsheet_id}}
```

No module names a sheet. The clinic is identified by `location.id`, which
GoHighLevel already sends on every booking, and the sheet comes from the
**PPS Clinic Routing** data store (id `137975`, structure `472153`), keyed on
that same location id.

Adding a clinic becomes one row in a table. There is no per-practice
configuration left to get wrong.

Built so far: scenario **6046761**, `01 - PPS - New Appointment Booked -
[CONSOLIDATED]`, inactive. The other four event types (02 CCM Show, 03 CCM No
Show, 04 Update Appointment Info, 06 Appointment Cancelled) follow the identical
pattern and are not built yet.

### Five scenarios, not one

"One automation" in the sense that matters — one set, shared by all clinics
instead of one set per clinic. But it should stay **five scenarios, one per
event type**, not a single scenario with an event-type router. GoHighLevel fires
these from five different workflow actions, so five webhooks keeps the mapping
direct, the blueprints small, and a fault in one event type from taking the
other four down with it. 280 becomes 5, which is the win; forcing it to 1 buys
nothing and costs failure isolation.

## What guards it

**`active = false` is a deliberate skip.** Module 4 carries a filter,
`{{2.active}}` not equal `false`. A clinic switched off in the routing table
stops being written, silently, which is correct because somebody chose it.

**A missing routing row fails loudly on purpose.** There is deliberately no
filter for it. If a location has no row, `{{2.spreadsheet_id}}` is empty and the
sheet lookup errors — visible in Make's execution log, and with
`dataloss: true` the bundle is retained so the booking can be replayed once the
row exists. The alternative, filtering it out, would silently drop a real
patient booking for an unconfigured clinic, which is the failure this whole
piece of work exists to stop.

The distinction is the point: a deliberate switch-off is quiet, an unconfigured
clinic is loud.

## The column-layout problem, and how it was solved

Index-based mapping requires every target sheet to have identical columns. They
do not. Extracting the header lists straight out of the blueprints — Make stores
them verbatim in each `addRow` module's `metadata` — gives **three** layouts:

| | Layout 1 | Layout 2 | Layout 3 |
|---|---|---|---|
| Columns | 30 | 28 | 33 |
| Scenarios | 41 | 8 | 2 |
| index 22 | Date Booked | **Make Remarks** | Date Booked |
| index 24 | Campaign Name | **Ad Set ID** | Campaign Name |
| index 26 | Ad Set Name | **Offer Name** | Ad Set Name |
| index 28–29 | Ad Name, Offer Name | *past end of sheet* | Ad Name, Offer Name |

Columns A–V (indices 0–21) are **identical in all three**. They diverge only
from index 22.

So the original index mapping would have written `utmMedium` into layout 2's
**Offer Name** column, and indices 28–29 past the end of the sheet entirely. For
eight practices.

**Resolved by mapping on header names** — `useColumnHeaders: true`, with the
`values` collection keyed on the exact header strings taken from the blueprints
rather than typed from memory. Position no longer matters, so all three layouts
are written correctly by the same scenario.

The fourteen headers it writes exist in **all three** layouts: Name, Email,
Phone, Date Added, App Date, Source, Appointment ID, Location Name, Location ID,
Phone (+), Campaign ID, Ad Set ID, Ad ID, Offer Name.

### What that costs, stated plainly

Layout 1 and 3 have richer attribution columns — `Campaign Name`, `Ad Set Name`,
`Ad Name`, `Date Booked` — that layout 2 lacks. Writing only the intersection
means those four stop being filled for the 43 practices that have them.

It also means the consolidated scenario inherits the **mislabelling** the audit
found: `Ad Set ID` receives `utmMedium` and `Ad ID` receives `utmContent`, which
are not ad-set or ad identifiers. Those are the columns that exist everywhere, so
they are what the safe mapping can use. Propagating a known-wrong label was the
lesser evil against writing into the wrong column for eight practices — but it
is a compromise, not a fix.

The clean end state is to standardise the eight layout-2 sheets onto layout 1,
then restore the richer mapping (`utm_id` → Campaign ID, `campaign` → Campaign
Name, `utmMedium` → Ad Set Name, `utmContent` → Ad Name). Module 3, the regex
that extracts `utm_id`, is still in the scenario and currently unused — left in
place deliberately, because that restoration is what it is for.

## The GoHighLevel side

This half has NOT been done — it needs GoHighLevel access this session does not
have. What it requires, precisely:

**In the snapshot workflow** (`2. New Appointment Actions`, and its equivalents
for the other four event types): the webhook action's URL changes from the
per-client webhook to the single consolidated one. Nothing else changes — the
payload already carries `location.id`, `calendar.*`, `contact.*` and the custom
fields the sheet columns read.

**Per-client custom values for the spreadsheet id become unnecessary.** If any
sub-account carries one, it stops being read. Leave it rather than deleting it
until the cutover is proven.

**The snapshot only governs new sub-accounts.** Each of the 56 existing ones
still has its own workflow pointing at its own webhook, so each needs its URL
repointed once. That is one change per clinic — against maintaining five
scenarios per clinic indefinitely.

## Built so far

| | |
|---|---|
| Scenario | **6046761** — `01 - PPS - New Appointment Booked [CONSOLIDATED]` |
| State | inactive, `isinvalid: false` |
| Webhook | id `2755826` — `https://hook.us2.make.com/wihxahuu2g8en7tcdslrvdg25i1v83ec` |
| Routing store | `137975` (structure `472153`), 2 rows seeded of 56 needed |
| Mapping | by header name, safe across all three sheet layouts |

Event types 02, 03, 04 and 06 are not built. They follow the identical pattern:
same webhook-per-type, same data-store lookup, same header-name mapping.

## Rollout order

1. Resolve the column-layout blocker (header mapping preferred).
2. Populate the routing table. The Hub owns it: `pps_clinic_routing`, reviewed at
   Settings -> Clinic routing, published to the data store by the
   `routing-export` sync. Only verified rows publish, and verifying means a
   person opened the sheet and confirmed it belongs to that practice.
3. Bind a webhook to 6046761 — it currently has `hookId: null` and cannot
   receive anything.
4. Repoint **one** clinic's GoHighLevel workflow at the consolidated webhook.
   Book a test appointment. Confirm the row lands in the right sheet, in the
   right columns.
5. Repoint the rest in batches, leaving each clinic's old scenario **inactive
   but present** until its replacement has proven itself.
6. Only then delete the clones.

Do not deactivate a per-client scenario before its clinic is routed and tested.
An unrouted clinic with its old scenario switched off records nothing at all.

---

# Outcomes to the Hub instead of a stat sheet

A second, separate consolidation: the call centre's outcome data going straight
into the Hub rather than into a spreadsheet the Hub then imports.

## What the CCM trackers actually do

An assumption worth correcting first. Type 02 is **not** triggered by a
GoHighLevel form. Its trigger is a Call Center Mastery app webhook,
`app#call-center-mastery-qeqot5:watchEventsManualPlacement`, and its payload
**does** carry `calendar.appointmentId` — which matters, because it means an
appointment can be identified exactly rather than matched on a name.

All the scenario then does is:

- split on `calendar.calendarName` — anything containing `Second_consultation`
  is a second consult, everything else is a first
- find the sheet row by phone against column T
- write `Y` into column J (first) or column K (second), plus the App Date

That is the whole job, and the Hub already models it as `showed` and
`second_consult_showed`.

## Built, both inactive

**Hub endpoint** — `POST /api/webhooks/consultation-outcome`, guarded by
`CRON_SECRET` as a Bearer header. Accepts the field aliases the five form types
use for the same question, so the Make side needs no per-form renaming. Lives on
branch `feat/call-centre-outcome-queue`.

**Make scenario 6108174** — `02 - PPS - CCM Show Tracker -> HUB [CONSOLIDATED]`,
inactive, on its own new webhook `2755953`. CCM trigger, router on
`calendarName`, two HTTP posts. **No Google Sheets module anywhere in it.**

One scenario for every clinic, and unlike type 01 it needs no routing table at
all — the appointment id identifies the appointment, which identifies the clinic.
There is no sheet to choose, so there is nothing to choose it with.

Nothing live was touched. The 57 existing type-02 scenarios are untouched and
still running.

## Before it can run

**Put the secret in the Authorization header.** Both HTTP modules currently read
`Bearer the SERVICE_API_KEY keychain key`. Prefer Make's keychain over pasting the value:
a header typed into a module is stored in the blueprint in plain text, and
blueprints are readable by anyone with team access.

**Point Call Center Mastery at hook `2755953`**, ideally for one clinic first,
leaving the existing scenarios running.

**The endpoint URL will 404 until deployed.** It is set to
`https://www.apexdentalmarketing.co/api/webhooks/consultation-outcome`, which
needs `feat/call-centre-outcome-queue` merged and shipped.

## Three things the endpoint deliberately refuses

**It will not guess which appointment is meant.** Resolution is by GoHighLevel
appointment id only. Name-and-date matching is what the stat-sheet import does,
and reconciliation exists because that matching is unreliable — a spelling
difference silently becomes a second appointment. No id: 422, with the keys it
did receive so a drifted form says what it actually sent.

**It will not create an appointment.** An unknown id answers 404. The Hub learns
appointments from the `crm-appointments` sync; inventing one from a form payload
would create a second source of truth for whether an appointment exists, which
is what the reconciliation work removes. A 404 most likely means the nightly
sync has not caught up.

**It will not answer 200 having recorded nothing.** Appointment found but no
known field present is 422 — because a webhook that accepts everything and
stores nothing is indistinguishable from one that works, and that is how the
tracker feed went quiet without anyone noticing.

## Still on sheets

Types 03 (CCM No Show), 04 (Update Appointment Info) and 06 (Appointment
Cancelled) are unchanged across all clinics. 03 is the same shape as 02 with the
value inverted, so it is the obvious next one; 04 and 06 carry more fields and
want reading properly first.

## Type 03 — CCM No Show, also built

Read before building rather than assumed, and it is the exact inverse of 02:
same Call Center Mastery trigger, same split on `calendar.calendarName`, and it
writes `N` where 02 writes `Y` — index 9 for a first consult, index 10 plus the
App Date for a second.

**Make scenario 6108222** — `03 - PPS - CCM No Show Tracker -> HUB
[CONSOLIDATED]`, inactive, on its own new hook `2755973`. Posts
`{"showed": "no"}` or `{"second_consult_showed": "no"}` to the same endpoint. No
Sheets module. The 57 live type-03 scenarios are untouched.

One oddity noticed while reading 3744117, harmless but worth knowing: its two
routes carry *different* column specs in their `expect` metadata — the first
route describes a 26-column sheet where index 9 is "Show (Y/N)", the second a
27-column sheet where index 9 is "First Consultation Show". Only the stale UI
cache disagrees; both mappers write numeric indices, so behaviour is consistent.
It is the same stale-metadata phenomenon as the misdirected spreadsheet labels,
in a place where it happens not to matter.

### Why "no" is the more dangerous value

A wrongly recorded show is a billing error somebody notices, because the
practice is charged for an appointment. A wrongly recorded **no-show** is a
billing error nobody notices, because it removes a charge — the practice is
happy, the revenue is simply absent, and it shows up only in the unbilled
backlog months later.

That is why the endpoint refuses to infer. `showed: "no"` has to be sent
explicitly by this scenario; an absent or unrecognised value leaves the column
untouched rather than defaulting to a no-show. The `readTri` mapping accepts
`no`, `no show`, `no-show`, `noshow`, `missed` and `dna` because CCM and the
forms spell it differently, and returns undefined for anything else — so an
unmapped spelling is a 422 rather than a silent lost charge.

## Remaining on sheets

Types 04 (Update Appointment Info) and 06 (Appointment Cancelled), across all
clinics. Both carry more fields than 02 and 03 and should be read properly
before a Hub equivalent is written — 04 in particular writes treatment outcome
and value, which is the data the billing figures depend on.

---

## Types 04 and 06, built — both inactive

That completes the set. All five event types now have one consolidated scenario
each, and none of them is switched on.

| Type | Scenario | Hook | Replaces |
|---|---|---|---|
| 01 New Appointment Booked | `6046761` | `2755826` | 57 clones |
| 02 CCM Show Tracker | `6108174` | `2755953` | 55 clones |
| 03 CCM No Show Tracker | `6108222` | `2755973` | 55 clones |
| 04 Appointment Update Form | **`6109500`** | **`2756502`** | 57 clones |
| 06 Appointment Cancelled | **`6109503`** | **`2756504`** | 56 clones |

Neither new scenario contains a Google Sheets module. Both post to
`POST /api/webhooks/consultation-outcome` with
`Authorization: Bearer the SERVICE_API_KEY keychain key`, which has to be replaced before
either can work — prefer Make's keychain to pasting the value into the blueprint.

Webhook URLs:

- 04 — `https://hook.us2.make.com/q2lgmsp7kjligjs0j4s6r1lsp3fpefb6`
- 06 — `https://hook.us2.make.com/ytcyautku3v2wntx995m8g8k274m5jxx`

### What changed in the endpoint to accept them

**Cancellations set the status and nothing else.** The stat sheets write a literal
`"C"` into the show column, which exists precisely so that cancelled and no-show
stay distinguishable. The Hub has a `cancelled` status, so a cancellation sets
`status` and `cancelled_at` and deliberately leaves `showed` alone. If a payload
somehow carries both a cancellation and "did not show", the cancellation wins.

GoHighLevel's own field is misspelled `appoinmentStatus` in the payload. Both
spellings are accepted. Matching only the correct one would have dropped every
cancellation silently.

**The first/second consultation branch is gone, on purpose.** The cloned type-06
scenarios inspect the calendar name to decide whether to write the `C` into
column J or column K. They have to, because a stat sheet holds one row per
*patient* and both consultations share it. The Hub holds one row per
*appointment*, so the appointment id already says which consultation was
cancelled. There is nothing left to branch on.

**The update form resolves by contact id.** Type 04 is a form filled in about a
patient, not an event raised against a calendar, so it carries no appointment id
at all. The endpoint now accepts `contact_id` — still an id, so this does not
reopen the name-and-date matching it refuses.

Which of that contact's appointments wins is the interesting part. The cloned
scenarios match on phone in column T, sort by appointment date descending and take
the first. **That is wrong for a rebooked patient**: someone who attended in March
and is booked again in May would have March's outcome written against May's
consultation. It is invisible in a stat sheet because both bookings are the same
row. It would not be invisible here, so the endpoint takes the most recent
appointment that has *already happened*, and only falls back to an upcoming one if
the contact has no past appointment at all.

**An appointment id that matches nothing does not fall back to the contact.** It
means that appointment has not synced, and quietly writing the answers onto a
different appointment for the same patient is worse than a 404 that says so.

### Two faults found in the originals, not reproduced

**Type 04's second route is dead.** The router has two branches: one unfiltered,
one filtered on `contact_source` containing `Second_consultation`. Both write the
*same three columns* — Converted to Patient, Treatment Value, Notes — to the *same
row*. When the filter matches, both fire and write identical values. Whoever added
it presumably meant it to record the second consultation separately; it does not.
Observed in `3744099`; not checked across all 57.

**Type 04 matches on phone, not appointment id** — the rebooking fault described
above.

### Still nothing switched on

Same as before: the secret, then one clinic repointed, then a real appointment
checked end to end, then the rest in batches with the old scenarios left inactive
rather than deleted until the numbers agree.

### The payload reader is now exercised

I shipped the cancellation and contact-id paths without ever running them: both
sit behind `CRON_SECRET`, so they cannot be poked from outside, and a type check
proves the shapes line up rather than that the decisions are right.

The part that decides *what to write* is now its own module,
`src/lib/webhooks/consultation-payload.ts` — pure, no database, no network. An
App Router route may only export its handlers, so extracting it was the only way
to reach it at all.

```bash
npm run check:webhook
```

Thirty-four checks over real payload shapes, including GoHighLevel's own
misspelling of `appoinmentStatus`, a cancellation that also claims a no-show, and
the several ways a blank answer must not become a `false`. No patient data is
used — the payloads are trimmed skeletons with invented names.

The suite was mutation-checked: removing the guard that stops a cancellation
being recorded as a no-show makes it fail, so it is testing something.

What it does **not** cover is which appointment gets picked, because that needs
the database. The rebooking rule — most recent appointment that has already
happened — is still unproven against real rows.

---

## All five hardened against the Hub being unreachable

The consolidated scenarios post over HTTP to a Next.js route. The path they replace
wrote to Google Sheets, which is a great deal more available than a serverless
function on a cold start. Shipping the swap without saying so would have traded a
fault class for an availability regression and called it progress.

Every one of the five now has, and all remain **inactive**:

| Setting | Value | Why |
|---|---|---|
| Store incomplete executions | on | A failed run is kept and can be resumed, not lost |
| Data loss queue | on | Failures park where somebody can see and retry them |
| Retry handler on each write | 5 attempts, 15s apart | Rides out a cold start or a transient 5xx |

The retry is a `Break` directive on the module's error path, so a failure retries
and then parks rather than discarding the booking.

**Type 01's data-store lookup deliberately has no retry.** If a clinic has no
routing row, retrying five times over 75 seconds changes nothing — the record is
absent, not slow. It errors immediately and parks in the queue, which is the loud
failure that case deserves. The two sheet operations either side of it do retry,
because those fail for reasons that pass.

Scenario ids: `6046761`, `6108174`, `6108222`, `6109500`, `6109503`. All
`isinvalid: false` after the change.

### What this still does not give you

Retries and a queue mean a booking survives the Hub being briefly down. They do not
make the endpoint idempotent — the same webhook delivered twice writes twice.
Harmless for an attendance flag or a cancellation, which are the only things sent
today. It would stop being harmless if the payload ever carried anything additive.

---

## The secret is SERVICE_API_KEY, not CRON_SECRET

I built this endpoint on `CRON_SECRET` because the recordings webhook uses it. That
was wrong, and `env.ts` says so in a comment I read past:

> Shared secret for machine-to-machine routes that hand out CRM tokens. Separate from
> CRON_SECRET on purpose: this one is pasted into Make, so it can be rotated without
> touching the cron schedule.

The distinction matters. `CRON_SECRET` is required for the app to boot and is what the
nightly sync authenticates with — it should never leave Vercel. A secret copied into a
third-party automation platform has to be rotatable on an afternoon's notice, and
rotating `CRON_SECRET` stops every cron route until each consumer is updated.

So `/api/webhooks/consultation-outcome` now takes **`SERVICE_API_KEY`**.

It also now uses the constant-time comparison from `/api/tokens/ghl`. The plain `!==`
I had written leaks the position of the first differing character to anyone who can
time the response, which is enough to recover a secret one byte at a time.

### What this changes for setup

`SERVICE_API_KEY` is **optional** in the schema, so it may not be set yet. Check:

```
GET https://www.apexdentalmarketing.co/api/webhooks/consultation-outcome
```

A `503` naming SERVICE_API_KEY means it is unset. A `401` means it is set and your
bearer was wrong or absent.

If it is unset, generate 32+ random characters, set it in Vercel, and use the same
value for the Make keychain key. Nothing else depends on it yet, so it can be created
fresh rather than hunted for — which is easier than finding an existing `CRON_SECRET`,
and safer, because that one should stay where it is.

---

## Guarding scenario 01 against a payload it cannot route

Six webhook payloads were sitting queued on three consolidated hooks since 31 Aug —
two each on `2755826`, `2756502` and `2756504`. All six are `{}`, one byte, test
traffic from creation day. No appointment id, no contact id, no location id.

For 04 and 06 that is harmless by construction: both HTTP modules sit behind a filter
requiring an id to exist, so an empty body never reaches the Hub.

**Scenario 01 had no such guard**, and it was the one place the reasoning got thin.
The flow was webhook → datastore lookup keyed on `{{1.location.id}}` → sheet lookup on
`{{2.spreadsheet_id}}` → router. With an empty payload the datastore key is empty, so
the spreadsheet id is empty, so the Sheets modules have no file to address. The likely
outcome is an error into the retry handler and then the queue. The argument that it
*cannot* append a blank row to a real sheet is sound — every write is parameterised on
a spreadsheet id that an unrouted payload never obtains — but it is an argument, and
the cost of being wrong is a junk row in a client's stat sheet.

So it is now a guard rather than an argument. Three filters:

| Module | Requires |
|---|---|
| 2, datastore lookup | `{{1.location.id}}` exists |
| 4, sheet lookup | `{{2.spreadsheet_id}}` exists, and the clinic is not switched off |
| 6, addRow | `{{1.calendar.appointmentId}}` exists |

An unroutable payload now stops at **module 2's filter**, not at the trigger. That
distinction matters when reading execution history: the webhook still accepts the
payload and dequeues it, so you will see a short **terminated** execution rather than
nothing at all. Terminated is the correct outcome here — no error, no retry, no queue
entry, nothing written — but somebody expecting silence would reasonably wonder
whether the guard had failed.

A clinic that has a location id but no routing row still parks loudly, which is the
behaviour that was wanted. The change is only that a payload naming no clinic at all
is now ignored rather than treated as a failed delivery.

Module 7, the updateRow branch, deliberately has no id guard and does not need one:
reaching it means module 4 returned a row, which means an appointment id already
matched.

---

## The key is live and the modules are wired — 1 Sep 2026

`SERVICE_API_KEY` is set in Vercel and mirrored into a Make Keychain entry,
**Apex Hub SERVICE_API_KEY**, id `215007`. Verified end to end:

```
POST /api/webhooks/consultation-outcome   Authorization: Bearer <key>   {}
→ 422  "No appointment id and no contact id"
```

`422` is the pass. It authenticated, then refused an empty body — which is the
endpoint declining to guess, exactly as designed.

Six modules across five scenarios now reference that key, all still **inactive**:

| Scenario | Modules | Valid |
|---|---|---|
| `6109503` 06 Appointment Cancelled | 1 | yes |
| `6109500` 04 Appointment Update Form | 1 | yes |
| `6108174` 02 CCM Show Tracker | 2 | yes |
| `6108222` 03 CCM No Show Tracker | 2 | yes |
| `6003601` GHL Token Bridge | 1 | **no — see below** |

`6046761` (01 New Appointment Booked) needs no key: it writes to Google Sheets via
the routing data store and never calls the Hub.

### Two things known and accepted

**The live key was exposed in a chat transcript** during setup and was knowingly kept
rather than rotated. It is a working credential guarding `/api/tokens/ghl`, which
hands out GoHighLevel access tokens. Rotating it later costs two edits — the Vercel
variable and the value inside key `215007` — and needs no module rewiring, because the
key entry keeps its id and its attachments. Recorded so the decision is visible rather
than forgotten.

**`6003601` is still `isinvalid`.** The missing key was one of at least two faults; it
was asserted here that the key would fix it, and that was wrong. Everything checkable
through the API is correct — key attached, data store `135204` "GHL OAuth Tokens"
present with every field the module writes, all required HTTP fields populated, and
the exact field shape of the four working modules replicated. Three API writes did not
clear the flag. Either it only recomputes on a save in the editor, or something the
API does not expose is wrong. Opening it in Make settles it: the editor marks the
unhappy module and names the reason.

It blocks nothing here. The Token Bridge caches a GoHighLevel token for other
scenarios, calls a different endpoint, and has been broken since 20 August.

---

# The pilot is live — Dental Illusions, 1 Sep 2026

One clinic, one event type. `6046761` is **active** and receiving type-01
bookings for Dental Illusions only.

| | |
|---|---|
| Clinic | Dental Illusions, location `tM8YmF72Rll1N142yYrt` |
| Sheet | `1mqdtHdN3wPiowBH8FskrZUwUxE5eo7bYkcAS9zpPndU`, tab MASTER |
| GHL workflow | `001. New Appointment -> Make -> Send Email Form - PPS v6.1`, action `01 PPS Make [TO CHANGE]` |
| Repointed from | hook `2589408` (`6mhd4kpz...`) |
| Repointed to | hook `2755826` (`wihxahuu...`) |
| Old scenario | `5970597`, left **active** on its old hook |

The other four consolidated scenarios stay inactive, and the other four
GoHighLevel custom values still point at the per-client hooks, so types
02/03/04/06 are untouched for every clinic including this one.

## The URL went in the action, not the custom value

The workflow read its URL from a shared custom value,
`PPS-System > 01 - PPS - New Appointment Booked -> Update sheet`. Editing that
would have repointed every workflow in the location that reads it, and nothing
proves only one does. The literal URL went into the action instead, which is
provably scoped to one workflow.

The custom value still holds the old hook, unchanged. That makes it the rollback
artefact: re-inserting the token restores the old routing without anyone having
to know what the old URL was.

## The queued payloads were checked before activation, not after

Both items sitting on hook `2755826` were 1 byte and parsed to `{}`. On
activation they ran as two 1-operation Successes at 10:50:18 and wrote nothing —
module 2's filter requires `{{1.location.id}}`, and an empty body has none.

Predicted behaviour, observed. **When reading execution history, ignore those
two runs.** A real booking shows more than one operation; a 1-operation run is a
payload that was filtered out.

## Two things flagged during the cutover, both real

**`6046761` has no HTTP module and never calls the Hub.** Correct, and by
design — type 01 writes to Google Sheets via the routing store. So the
`SERVICE_API_KEY` / key `215007` verification proves nothing about this
scenario's write path.

What does cover it: all three Sheets modules use Google connection
**`6237841`** — the *same connection* Dental Illusions' live scenario `5970597`
already uses to write to this same sheet. The auth on the pilot path is not
unproven; it is the credential that has been doing this job in production.

**Module 4's dedupe filters on positional column `Q`.** Also correct, and it
qualifies the claim that the consolidated scenario maps by header name. The
*writes* do — modules 6 and 7 use `useColumnHeaders: true` with header-keyed
values. The *lookup* cannot: Make's `google-sheets:filterRows` takes a column
letter, and offers no header-name form.

For this clinic it is settled. `5970597`'s own lookup is byte-identical —
`Q` equals `{{1.calendar.appointmentId}}`, `orderBy: D`, `sortOrder: desc`,
`tableFirstRow: A1:CZ1` — and Make's own cached label for that column reads
`Appointment ID (Q)`. The consolidated scenario reproduces the proven
configuration rather than introducing a new one.

Fleet-wide it is **open, and it gates the batch rollout, not the pilot**:
columns A-V are identical across all three sheet layouts and Q sits inside that
range, so Q should be Appointment ID everywhere — but that came from reading the
`addRow` header arrays, not the `filterRows` columns. The check is to read the
filter column out of each live type-01 blueprint. If all 57 say `Q`, the
consolidated scenario inherits the fleet's existing behaviour exactly and adds
no risk. Any that disagree are a clinic that needs its own answer before it
moves.

## One field fixed before the first booking

Module 4 read `from: "drive"`. Under that setting Make declares `spreadsheetId`
as type **file** and expects the Drive-picker path form, `/folderId/fileId` —
but the data store supplies a bare id. Modules 6 and 7 are unaffected because
`mode: "map"` makes their id a mapped text field; `filterRows` offers no `mode`,
so `from` is the only control.

Changed to `from: "share"`, which declares `spreadsheetId` as type **text** and
is the setting `5970597` uses with a bare id against this exact sheet. It may
well have worked either way — Make probably splits the path and takes the last
segment — but "probably" is not what a pilot is for. Worst case had been a
loud one: module 4 errors, retries five times, parks in the queue, writes
nothing.

`isinvalid: false` after the change, hook intact, queue empty.

## Deliberately not changed during the pilot

The scenario is still named `[CONSOLIDATED - inactive, for review]` and still
carries the `needs audit` label, while being active. That is exactly the
frozen-label fault this engagement exists to remove, and it should be corrected
— but not now. Renaming is behaviourally inert, and a mid-pilot edit gives
"what changed?" a second answer if anything misbehaves. It happens when the
first real booking has passed.

## What proof looks like

1. `6046761` shows an execution with **more than one operation**
2. A new row in the MASTER tab of `1mqdtHdN...`
3. The row lands in the correct columns for all fourteen mapped headers
4. Nothing in `5970597`

Rollback if any of those is wrong: re-insert the custom-value token in action
`01 PPS Make [TO CHANGE]`, or paste
`https://hook.us2.make.com/6mhd4kpz3rvc2ectx39d9fbpph0erycq`, then deactivate
`6046761`. `5970597` never stopped, so service resumes on the next booking.

## The fleet-wide `Q` gate is closed — all 57 checked

Read the `filterRows` dedupe out of every live per-client type-01 blueprint.
**57 of 57 are identical**: filter column `Q` compared against
`{{1.calendar.appointmentId}}` with `text:equal`, `orderBy: D`, `sortOrder: desc`,
`tableFirstRow: A1:CZ1`, `sheetId: MASTER`. No deviations, including the twelve
older-generation scenarios (ids in the 3.7M–5.1M range) that predate the bulk
clone and were the ones most likely to differ.

Make's own cached column label reads `Appointment ID (Q)` in each. So the
consolidated scenario's positional lookup reproduces the fleet's existing
behaviour exactly and introduces no new risk at the batch rollout. The gate that
was open is now shut.

Method note: this is a blueprint-level check, not a spreadsheet-level one. It
proves every scenario *asks* for column Q, and that Make's cache agreed when the
sheet was last picked. If a practice has since inserted a column before Q, its
current scenario is already looking in the wrong place and the consolidated one
inherits that — the fault would predate the cutover rather than be caused by it.

### Three things the sweep surfaced

**Eagle Creek's read_write_split is worse than recorded, and consolidating fixes
it.** `4176278`'s lookup reads `1h1MnNra5nGzjHnX14ThfP2t7b546yqOwwD7A4pFu-A4`
while both its writes target `1QyKIYRnfZnhv12GOa0sXIoyJT7DmvwUIlbpFUFIrbcU`. The
read sheet's cached column list is the 26-column layout, where Appointment ID
sits at **P**, not Q — so that lookup could never match even if it were reading
the right file. Every booking appends a duplicate; the update branch never runs.
The routing row already points at the write target, so the consolidated scenario
reads and writes the same file and the fault disappears on cutover.

**Stanton's shared sheet is confirmed by id, not inference.** `5111292` reads and
writes `1Wb0dfuUMZxWoAe_DkpVHlLU1FTwo56XX-XEkamFOJbM`, which is also OC Healthy
Smiles' own primary target in `4176701`. Two scenarios, one file, both treating it
as theirs. Stanton stays out of the routing store until somebody opens that file
and decides whose it is.

**Snyder and Stanton write different values from everyone else.** Snyder's
`3816566` update branch writes real `adSetId` and `adId` into columns Y and Z,
where the other 55 write `utmMedium` and `utmContent` — Snyder is the one practice
whose attribution columns mean what their headers say. Stanton's `5111292` writes
a raw `{{1.calendar.startTime}}` into App Date instead of a formatted date.
Consolidating changes both. Neither is a blocker, but both are a visible change to
that practice's sheet and should be said out loud before those two are repointed.

### Still unroutable, and now confirmed active

`3744209` Best Care Dental and `4176885` Ofir Orthodontics are both live and have
no routing row, because `0001_init.sql` deliberately left them unmatched — no
client of that name exists in the CRM. `5947250` ADM Ortho Snapshot and `4327540`
Test Clinic are internal. Four active type-01 scenarios that cannot move until
somebody decides what they are.

## The synthetic test found a real defect — 1 Sep 2026

Rather than wait for a booking to exercise a scenario that had never run in its
current form, the whole path was driven end to end against an internal sheet.

**The target.** `NWJb5XTSNeLOVKCxhP6L`, the ADM Snapshot Account, added to the
routing store pointing at `11Gr6-P7i44B0_NSZUe7M4WE_FoWQxIYz4cvfYMyxJik` — the
sheet its own scenario `5947250` already writes to, taken from that blueprint.
Internal, no client reads it. Adding the row also routes the snapshot account
like every other clinic, so it is not only a test fixture.

**Run 1 — the new-patient path works.** A synthetic payload posted to hook
`2755826` produced a 5-operation success: webhook → datastore → regex →
filterRows → addRow. So `from: "share"` on module 4 accepts a bare mapped id,
which was the unexercised change.

The row's fourteen mapped values landed under their own header names, verified by
reading the sheet back as CSV and aligning headers to values. **Appointment ID
landed at index 16 — column Q** — so the positional lookup and the header-name
write agree on this layout. Columns 22, 24, 26 and 28 (Date Booked, Campaign
Name, Ad Set Name, Ad Name) are empty, which is exactly the documented cost of
writing only the intersection of the three layouts.

**Run 2 — the dedupe did not hold.** The identical payload posted again used
**6 operations**, not 5, and the sheet grew to two rows. Both router branches had
fired: the existing row was updated *and* a duplicate was appended.

The cause was module 6's filter, written here as

```
"conditions": [[ROW_NUMBER notexist], [appointmentId exists]]
```

Two condition groups. In a Make blueprint the outer array is **OR** and the inner
array is AND, so that reads "the row was not found **OR** an appointment id
exists" — and the second half is true on every real payload. The addRow branch
therefore fired unconditionally, including on payloads that had matched.

This was introduced by me, in the change that added an appointment-id guard to
stop empty payloads appending blank rows. The 57 cloned scenarios do not have it:
their equivalent filter is a single condition in a single group, so there was no
OR to get wrong. The guard was also redundant — module 2 already drops a payload
with no `location.id`, which is what the empty bodies were.

**Fixed** by collapsing both conditions into one AND group. Run 3, with the same
payload, used 5 operations and left the row count at two: match → updateRow only,
nothing appended.

### What it would have cost

GoHighLevel re-fires the booking workflow on appointment updates — a reschedule,
a confirmation — so a second webhook for the same appointment is ordinary
traffic, not an edge case. Every one would have appended a duplicate row to the
clinic's stat sheet, and duplicates in the MASTER tab are what the appointment-id
dedupe exists to prevent in the first place.

Dental Illusions was exposed from activation at 14:50 until the fix at 15:59.
**No client data was affected**: the only executions in that window were the two
`{}` queue items and these three synthetic posts. No real booking arrived.

The lesson is narrow and worth keeping: a filter that reads correctly in English
can still be wrong in the blueprint, and the only way to tell is to run it. Three
posts against an internal sheet found what the reasoning had missed twice.

### Left behind

Two synthetic rows in `11Gr6-P7i…`, both with Appointment ID
`CONSOLIDATION-TEST-20260901`. **That file is `1 - COPY THIS - Stat Sheet
Template`** — the sheet new clinics are cloned from — so the rows should be
deleted before the next clinic is onboarded, or they propagate. The consolidated
scenario has no delete module, so this needs a person in Sheets.

### Still unproven

The four step-3 checks against a real Dental Illusions booking. What the
synthetic run proves is the mechanism — routing, lookup, header mapping, dedupe.
What it cannot prove is that GoHighLevel's real payload carries the field names
the mapping expects, because the payload here was hand-built from the field paths
in the blueprint rather than captured from GoHighLevel.

### The OR fault does not exist in the other four

Checked every filter in `6108174`, `6108222`, `6109500` and `6109503` after
finding it in `6046761`. All of them use a single condition in a single group —
the CCM pair split on `calendarName`, 04 requires `contact_id`, 06 requires
`calendar.appointmentId` — so there is no OR to get wrong. `6046761` was the only
scenario where a second condition was added, and therefore the only one that
could have this fault. Closed.

While reading them: **`6109503` has `dlqCount: 1`**, left from the live
end-to-end cancellation proof — a synthetic appointment id the Hub correctly
answered 404, which `handleErrors: true` parked. Inert, but it should be cleared
so the queue means something the next time it is looked at.

### The real payload carries the field names the mapping expects

The synthetic test proved the mechanism but used a payload built from the
blueprint's own field paths, which cannot catch a mapping that names a field
GoHighLevel does not send. Checked against the sample GoHighLevel actually
delivered, stored in live scenario `5970597` — field names and presence only, no
values read.

Twelve of the fourteen mapped paths are present. The two that are not,
`contact.attributionSource.campaign` and the intake question
`Please select the treatment you are interested in:`, are absent because that
sample is a **direct calendar booking** — no ad campaign, no intake form. Dental
Design Studios' sample (`4167561`), a Facebook lead, carries both populated. So
the mapping is right and those two fields are conditional on lead source; a
direct booking correctly writes Campaign ID and Offer Name empty.

Stated precisely, because the number flatters: 44 stored samples were readable,
but they are the same ADM test booking cloned across scenarios — one payload
shape, not 44. The paid-social shape is evidenced by one sample, not many.

---

# Decision, 1 Sep 2026: Google Sheets is being retired

Jemie's call. The pilot rollout stops here, and the extension prompt was halted
before the two verification jobs ran. What follows is what that changes, checked
against the data rather than assumed.

## Type 01 contributes nothing to the Hub, so it is deleted rather than rebuilt

The instinct is that dropping Sheets means rebuilding 57 booking scenarios
against a Hub endpoint. It does not. Two facts:

- `appointments.source` is **only ever `crm`**, across all 369 rows. No
  appointment has ever entered the Hub from a Make scenario or a sheet.
- There are **zero** `appointment_ledger` rows carrying a `crm_appointment_id`
  that the CRM sync did not create.

So the type-01 scenarios' only output is the spreadsheet row. The Hub already
learns every one of those appointments independently, from the
`crm-appointments` sync. Retire the sheet and the 57 scenarios have no remaining
job — there is nothing to port.

That also retires, unused: the `pps_clinic_routing` table and its Settings page,
the `routing-export` sync, data store `137975` and its 43 records, the three-way
sheet-layout analysis, the header-name mapping compromise, the column-`Q`
dedupe, and every finding in `scenario_sheet_findings`. They exist to answer
"which spreadsheet?", and the question stops being asked.

## What the sheet is still carrying, and it is smaller than it looks

The tracker does surface appointments the CRM sync lacks — **27 in the last
fourteen days**. That is the number to clear before the sheet can stop being a
source. It is not a systemic gap; it decomposes into causes already on record:

| Rows | Practice | Cause |
|---|---|---|
| 9 | Village Dental of New England (General Dentistry) | has **no `crm_location_id`** — already logged as unroutable |
| 9 | Village Dental of New England | has a location id but no same-day appointment matches; needs a look |
| 4 | Kind Dental | almost certainly the excluded Dr. Vohra calendar `Il8ovGGMeIc7dbtkmB2N`, an open decision |
| 2 | Art of Smile | one has a same-day appointment in the Hub, so likely a match failure, not missing data |
| 1 | Lightning Orthodontics | dated 2027-08-02 — a tracker typo |
| 2 | The Smile Patio, Bling Dental | one row each, uninvestigated |

Two named accounts explain two thirds of it. Neither is a reason to keep 57
spreadsheets.

## What survives, and it is the good half

`POST /api/webhooks/consultation-outcome` and the four scenarios that already
post to it — 02, 03, 04 and 06 — are the pattern, not the exception. They contain
no Google Sheets module at all. The work done on them stands unchanged.

`appointments` and `appointment_ledger` already model the stat sheet: 41 columns
in the ledger against 28 in the sheet, and several of the sheet's are redundant
(Month is derived, Appt. Date Time duplicates App Date, Phone (+) duplicates
Phone). Genuinely absent: Additional Notes, Confirm?, Make Remarks, Offer Name,
First Called.

## Correction: the replacement is already built, and already live

I wrote above that `user_profiles` holds two users and no practice has ever
logged in, and concluded that replacing the sheet meant deciding whether to give
practices Hub accounts. That was wrong, and wrong in the direction that matters.

**Practices do not need accounts.** The portal is token-based: one per client
group, at `/portal/[token]`, gated by `portal_enabled`. Checked:

| | |
|---|---|
| Client groups | **75** |
| With a portal token | **75** |
| With the portal enabled | **75** |
| Active clients not in a group | **0** |

Every practice already has a live portal.

**The survey is the stat sheet, and provisioning says so.** From
`src/config/provisioning.ts`, on the `*Client Stats Sheet URL` custom value:

> The stat sheet and the portal are the same thing seen twice: the sheet's green
> columns — did they attend, did they attend a second time, did they convert,
> were they approved for credit, what was it worth — are exactly the
> post-appointment survey, and the portal is where a practice answers it. So the
> value points at the portal rather than at a spreadsheet somebody has to
> maintain by hand.

New sub-accounts are provisioned with that custom value pointing at the portal.
The decision to stop using Sheets is not a change of direction — it is the
direction the system was already built for.

`portal-actions.ts` writes `outcome`, `showed` with **`showed_source: 'client'`**,
`second_consult_showed`, `financing_approved`, `value_cents` and
`outcome_updated_at`. Those are sheet columns J, K, L, M and N. The appointment
detail page tells the practice "nothing you type here is overwritten by our
systems", and that promise is kept by the `clinicAnswered` guard in
`crm-appointments.ts`, which stops the CRM sync replacing an answer whose
`showed_source` is `client`.

Three writers are already distinguished by provenance: `crm` from the sync,
`call_centre` from the outcome webhook that types 02/03/04/06 post to, and
`client` from the portal.

## So the gap is adoption, not engineering

| | |
|---|---|
| Appointments with a practice-supplied answer (`showed_source = 'client'`) | **0** |
| Appointments whose outcome has ever been updated | **0** |

Not one practice has ever answered the survey. The portal is finished, enabled
for all 75 groups, and unused — while the same five answers keep being typed into
spreadsheets. Nothing needs building for practices to stop using Sheets; they
need to be told to use the link they already have.

## Immediately outstanding from the halted pilot

- Dental Illusions is still routed to `6046761`, which still writes to Sheets.
  It works and it is one URL either way; leaving it costs nothing until the
  replacement exists, and rolling back is its own small risk. Needs a decision,
  not urgency.
- Two synthetic rows remain in `1 - COPY THIS - Stat Sheet Template`
  (`11Gr6-P7i…`), Appointment ID `CONSOLIDATION-TEST-20260901`. They only matter
  if a clinic is onboarded from that template before Sheets is retired — which
  may now be never. Lower priority than it was, not zero.

---

# Retiring the sheets: what each feed actually contributes

Before deciding what to switch off, measured what the CRM sync already delivers
without any Make scenario involved. Across 369 appointments:

| | |
|---|---|
| Created by the sync (`source = 'crm'`) | **369 of 369** |
| Status known, including cancellations | all; **24** cancelled |
| Attendance known (`showed` set) | **248**, every one `showed_source = 'crm'` |
| Attendance from the call centre | **0** |
| Attendance from the practice | **0** |
| Outcome / treatment value ever recorded | **0** |

That settles which scenarios are load-bearing:

| Type | What it feeds | Verdict |
|---|---|---|
| **01** New Appointment Booked | the spreadsheet row, nothing else | **redundant** — the sync creates every appointment |
| **06** Appointment Cancelled | cancellation | **redundant** — the sync already sets `status = 'cancelled'` on 24 |
| **02 / 03** CCM show / no-show | attendance | **supplementary** — the sync answers 248 of 369, so these corroborate and cover the other 121 sooner |
| **04** Appointment Update Form | outcome, treatment value, notes | **the only feed carrying something nobody else has** — and it overlaps the portal survey exactly |

So retiring Google Sheets does not mean replacing five feeds. It means deleting
two outright, keeping two as a faster second opinion on attendance, and making
one deliberate choice about who answers the outcome question.

## Order of operations

The sheet is still a practice's window on their own numbers. Switching off the
writes before anybody is using the portal takes that away, so the order is not
negotiable:

1. **Practices start using the portal.** 75 live portals already exist; the link
   is the only thing missing. Nothing technical blocks this.
2. **Watch `showed_source = 'client'` climb from zero.** That figure is the
   adoption metric — it is the count of answers a practice gave directly.
3. **Then deactivate the type-01 clones**, 57 of them, leaving them present.
   Nothing downstream notices: the Hub never read them.
4. **Then 06**, the same way.
5. **Only then delete**, once a full billing cycle has closed with the numbers
   agreeing.

02 and 03 stay until the CRM's attendance is shown to be as timely as the call
centre's. 04 waits on the question below.

## The one question retirement does not answer

Type 04's form and the portal survey capture the same five answers. They differ
in **who is answering**: the GoHighLevel form is filled in on the call centre's
side and lands as `showed_source = 'call_centre'`; the portal is filled in by
the practice and lands as `'client'`, which the sync then refuses to overwrite.

Both are legitimate and the Hub already tells them apart. But keeping both means
the same question has two front doors, and the practice's answer silently wins.
Worth choosing on purpose rather than discovering later.

---

# The coverage gap is not a Sheets problem

27 appointments in the last fortnight exist in the tracker and not in the Hub.
That number was the stated blocker on retiring the sheets. It is not one, for
two reasons.

**First, it comes from a different file.** All 27 carry
`tracker_source_tab = 'Appointment Data'` — the single Client Fulfilment Tracker,
not any of the 57 per-clinic stat sheets. Retiring the stat sheets does not touch
it.

**Second, the cause is three specific accounts, and it predates all of this.**

| Practice | CRM location id | Hub appointments ever | Latest | Tracker-only rows | Excluded calendars |
|---|---|---|---|---|---|
| **Kind Dental** | present | **0** | — | 32 | **7** |
| **Village Dental of New England** | present | **3** | **22 Jul 2026** | **109** | 5 |
| **VDNE (General Dentistry)** | **none** | **0** | — | 28 | 0 |
| *(comparable practices)* | present | 13–43 | current | few | 0 |

Kind Dental has **never** had an appointment in the Hub, and Village Dental has
had none for six weeks, while both are active clients being billed. This is the
same fault behind the earlier "27 consults billed against 0 appointments" figure
for Kind Dental — now explained.

`included_calendars` is empty for every client, so exclusion is the only
mechanism in play and the sync reads everything not excluded.

**What each case needs:**

- **VDNE (General Dentistry)** — no `crm_location_id`, so it is invisible to the
  sync by construction. Fixable as soon as somebody supplies the GoHighLevel
  location id. Its own stat sheet carries a Location ID column, which is how the
  other 42 were verified.
- **Kind Dental** — all seven of its calendars are excluded. Five are genuine
  `Do Not Book` PatientSync mirrors. Two are judgement calls made on 22 Aug:
  `Ortho & New Patient Exam | Dr. Vohra` and ` {{location.name}} Virtual Calendar `.
  If the practice's real booking calendar is among them, that exclusion is why
  the Hub has nothing. Note the unrendered merge tag in that name — the fleet's
  standard calendar is literally called ` {{location.name}} Booking Calendar `,
  so a `{{...}}` in a calendar name is normal, not corruption.
- **Village Dental** — its five exclusions all look correct, which makes the
  silence since 22 July harder to explain. Needs its GoHighLevel calendar list
  read, which needs API access.

None of these is caused by, or fixed by, Google Sheets. They are a live
reporting and billing fault that would still be there if every spreadsheet
vanished tonight — and arguably more visible once it did.

---

# Three writers, one row: the precedence rule — 1 Sep 2026

The same eight questions can be answered from three places. Until now there was
no rule about which answer survived, so whoever wrote last won.

## What was wrong

`showed_source` has always recorded who said whether a patient attended, and
`crm-appointments.ts` reads it to stop the nightly sync overwriting a practice's
answer. That is the promise the portal makes on screen: *"Nothing you type here
is overwritten by our systems."*

The other half of the survey had no such marker, and **two** write paths ignored
the question entirely:

- `/api/webhooks/consultation-outcome` — the GoHighLevel update form
- `/b2c/actions.ts` — the call centre's own screen

Both wrote `outcome`, `value_cents`, `financing_approved`, `cc_on_file` and
`notes` unconditionally. A call-centre submission arriving an hour after a
practice filled in their portal would silently replace their treatment value.
Not live — no practice has answered yet and 02/03/04 are inactive — but
load-bearing the moment either changes, and it is the stat sheets' own fault
reproduced in Postgres: last writer wins, no record of who that was.

## The rule

**The practice is authoritative, and anyone else may fill a blank but may not
overwrite an answer.**

`0027` adds `appointments.outcome_source`, mirroring `showed_source`, so the
outcome half has a provenance column too. `src/lib/outcomes/precedence.ts` holds
the decision, and all three write paths now go through it.

Two groups, because there are two provenance columns and two kinds of knowledge:

| Group | Columns | Governed by |
|---|---|---|
| Attendance | `showed`, `second_consult_showed` | `showed_source` |
| Outcome | `outcome`, `value_cents`, `financing_approved`, `cc_on_file`, `notes`, `lead_quality` | `outcome_source` |

The split matters: the calendar legitimately knows whether somebody turned up,
and legitimately does not know what the treatment was worth.

Filtering is **per column, not per group** — a call centre chasing a
half-finished form still fills the boxes the practice left blank. Locking them
out of the whole row would make the feature useless for its actual purpose.

Two details worth keeping:

- **`outcome = 'pending'` is not an answer.** It is the column default and the
  portal spells it "Not decided yet". Treating it as answered would lock the
  call centre out of every row a practice opened and did not finish.
- **A dropped field is reported, never swallowed.** `/b2c` says which fields the
  practice had already answered; the webhook returns them as `keptFromPractice`.
  A form that says "saved" while discarding half a submission is how somebody
  comes to trust a number that is not theirs.

`npm run check:precedence` — 31 checks. Mutation-tested: removing the guard
takes it to 20/31, so it is testing the rule rather than describing it.

## /b2c already was the call-centre queue

Worth recording, because it nearly got built twice. `/b2c` is "every patient
consultation across every client, in one list", with a `pending` queue and an
inline outcome form that already wrote `showed_source: 'call_centre'`. It maps
to a `consultations` capability in `permissions.ts`. Nothing needed building —
it needed the precedence rule above, and people granted the capability.

A per-agent queue was considered and rejected on the data: `booked_by_user_id`
is null on all 369 appointments, so "my bookings" would be empty. The shared
cross-client queue is the only one that can work today. **316 appointments are
past and still unanswered**, which is what that queue is looking at.

---

# Keeping what the call centre already collects

The GoHighLevel update form asks about twenty questions. Make forwarded three.
`0028` adds columns for four more that have a real consumer here —
`treatment_opted_for`, `deposit_collected`, `payment_method`,
`insurance_provider` — and scenario `6109500` now sends them, plus attendance,
which it was also discarding.

`Readiness` and `Stage Booked` were deliberately left out: call-centre funnel
internals with no reader on this side, and a column nobody queries looks like
data, ages badly, and makes the next person assume something depends on it.

The four are free text (bar the boolean) because the option lists live in a form
somebody else owns. An enum would turn a new dropdown value into a failed
webhook, and losing a whole submission to protect a column's tidiness is the
wrong trade. A lone `-` is how that form spells "not answered" — real payloads
carry it for cash patients — so it is read as absent rather than stored.

These sit **outside** both precedence groups. They are intake facts, not survey
answers: a practice completing their own survey has no opinion about which
insurer the patient named, so there is nothing to contest.

`npm run check:webhook` — now 42 checks.

## The second-consultation mapping, fixed

The payload reader mapped `"Did this patient require a second consultation?"` to
`second_consult_showed`. Those are different facts, and independent: a patient
can need a second consult and not turn up to it, which the old mapping would have
recorded as a **show**.

It never fired — Make forwarded three fields and this was not among them, so the
alias sat dormant from the day it was written. Widening `6109500` in 0028 would
have armed it, which is how it surfaced.

Fixed by adding the column rather than deleting the alias, because the answer is
real and the call centre already collects it. The reason it looked like a
duplicate is that the Hub had nowhere else to put it. `0029` adds
`second_consult_required`, and who answers what is now unambiguous:

| Column | Answered by |
|---|---|
| `second_consult_required` | the call centre, on the update form |
| `second_consult_showed` | Call Center Mastery (02/03, splitting on a calendar name containing `Second_consultation`), or the practice in its portal |

It joins the **outcome** group for precedence, not attendance — a calendar can
see who turned up but not whether another appointment was judged necessary.
Nothing contests it today; it is listed so that if the portal ever asks the
practice the same question, the rule already covers it.

`6109500` now sends it. `npm run check:webhook` — 48 checks, including the
case the old mapping got wrong: needed one, did not attend, and both facts
survive.

## Do not activate 6109500 before these changes are deployed

Scenario `6109500` has been inactive since it was built, for three reasons. One
has expired and one is new.

**Still true — nothing points at it.** No GoHighLevel workflow has been repointed
to hook `2756502`. Activating it would receive zero traffic and simply look live
in the Make list, which is the frozen-label confusion this engagement exists to
remove. Repointing is the GoHighLevel-side work that cannot be automated.

**No longer true — the endpoint is deployed.** It was originally blocked on
`feat/call-centre-outcome-queue` being merged and shipped. It is on `main` and
live: `GET` answers 405 and an unauthenticated `POST` answers 401, so the route
exists and `SERVICE_API_KEY` is set. That blocker is gone.

**New, and created by widening the blueprint.** The deployed reader still
contains the old alias, mapping `"Did this patient require a second
consultation?"` onto `second_consult_showed`. `6109500` now *sends* that
question. Against the code currently in production that lands in the wrong
column — arming the exact fault 0029 fixes. Five of the nine fields it now sends
are also unknown to the deployed reader and would be silently ignored:

| Field | Deployed reader |
|---|---|
| `second_consult_required` | **misread as attendance** |
| `treatment_opted_for` | ignored |
| `deposit_collected` | ignored |
| `payment_method` | ignored |
| `insurance_provider` | ignored |

So the order is: **commit and deploy 0027–0029 and the code that goes with them,
then repoint a clinic, then activate.** Activating first would not merely waste
the widening — it would write a wrong answer into a real column.

The same applies to the precedence rule. Until it ships, `/b2c` and the webhook
are still last-writer-wins against a practice's portal answer. No practice has
answered yet, so nothing is at risk today; that stops being true on the first
one.

---

# Retiring type 01: the manifest — 1 Sep 2026

The standing rule is that nothing gets deactivated without stating what it does
and why. This is that statement, for all 58 per-client
`01 - PPS - New Appointment Booked` scenarios (56 active, 2 already off).

## They cannot reach the Hub. Proven twice, independently.

**Structurally.** Reading `usedPackages` for all 58: every one uses only
`gateway`, `builtin`, `google-sheets`, and some `regexp` and `util`. **Not one
has an `http` module.** There is no mechanism by which any of them could post to
the Hub even if somebody wanted it to.

| Package | Scenarios using it |
|---|---|
| gateway | 58 |
| builtin | 58 |
| google-sheets | 58 |
| regexp | 46 |
| util | 12 |
| **http** | **0** |

**Empirically.** `appointments.source` is `crm` on all 369 rows, and there are
zero `appointment_ledger` rows carrying a `crm_appointment_id` that the CRM sync
did not create. Nothing has ever entered the Hub from one of these scenarios.

So their entire output is the spreadsheet row. Switching them off removes a
spreadsheet write and nothing else — there is no Hub feed to port, which is why
this is a retirement rather than a migration.

## Five need a decision before they are switched off

Everything else is uniform: one scenario, one sheet, eight modules. These five
are not, and switching them off changes something beyond "the stat sheet stops
being written".

| Scenario | Practice | Sheets | What is different |
|---|---|---|---|
| `5950336` | **Kind Dental** | **3** | misdirected_write — also writes into City Dental Centers and Kind Dental (GD). Retiring it *stops* two cross-account leaks. Good, but somebody should know those two practices' sheets will stop receiving rows they were never supposed to get. |
| `5950112` | **Art of Smile** | 2 | Not a fault — `0024` cleared it as a deliberate dual-write to a second file with its own lookup. **That second sheet has no other writer.** Retiring this stops it being maintained, and somebody has to decide whether it still matters. |
| `5973526` | SMYLE East Meadows | 2 | misdirected_write into SMYLE Dental Centers' sheet. Retiring stops the leak. |
| `5974519` | Team Dental Swedesboro | 2 | misdirected_write into Team Dental N. Liberties. Retiring stops the leak — and this is the one case where an overwrite of real data could not be ruled out. |
| `4176278` | Eagle Creek | 2 | read_write_split — reads a file nothing writes, so its dedupe never matches and every booking appends a duplicate. Retiring stops the duplicates. |

Plus `5970743` (Dental Solutions) with a `padded_id`, and `4176701`
(OC Healthy Smiles) sharing a file with Stanton — neither changes the retirement
decision, but both stop mattering once the writes stop.

Four of the six are faults that **retirement fixes**. Only Art of Smile's second
sheet is something that would be lost.

## Why nothing has been switched off yet

The blocker is not technical and it has not moved: **no practice is using the
portal.** `showed_source = 'client'` is zero across all 369 appointments, and
`outcome_updated_at` has never been set.

The stat sheet is still a practice's only window on their own numbers. Switching
off the writes today would take that away and replace it with a portal nobody
has been told to open. The order stands:

1. Practices are pointed at their portal link — 75 already exist and work.
2. `showed_source = 'client'` climbs off zero. That is the adoption signal.
3. **Then** deactivate the 57, leaving them present and reversible.
4. Delete only after a full billing cycle closes with the numbers agreeing.

Steps 3 and 4 are ten minutes of work. Step 1 is the project, and it is not an
engineering task.

## The four cross-account faults are fixed — 1 Sep 2026

Repaired rather than retired. Retiring these would have stopped the damage *and*
taken each practice's sheet away; repointing stops the damage and keeps the
sheet, so it strictly dominates — and it holds whether Sheets is retired next
month or never.

| Scenario | Practice | Was | Now |
|---|---|---|---|
| `5950336` | Kind Dental | modules 10 & 22 wrote into **City Dental Centers**, module 15 into **Kind Dental (GD)** | all 8 Sheets modules point at Kind Dental's own file |
| `5973526` | SMYLE East Meadows | module 16 wrote into **SMYLE Dental Centers** | all 8 point at its own file |
| `5974519` | Team Dental Swedesboro | modules 10 & 22 wrote into **Team Dental N. Liberties** | all 8 point at its own file |
| `4176278` | Eagle Creek | lookup read `1h1MnNra…`, a file nothing writes | lookup reads the file it writes to |

All four remain **active**, `isinvalid: false`, hooks unchanged. Verified by
re-reading each blueprint: no foreign spreadsheet id survives in any of them.

**Why repointing and not deletion.** Modules 10 and 22 are the *"row already
exists"* branches. Deleting them would have removed each practice's update path
entirely, so a repeat booking would append a duplicate instead of updating —
trading one fault for another. Worse, in their broken state they looked up a row
number in the practice's own sheet and then applied it to a *different*
practice's sheet, so the row they overwrote was arbitrary.

**Backups are in `ops/pps-consolidated/blueprints/`**, one `-before.json` per
scenario, which is the restore path. This is a deliberate departure from "clone
before you edit": a Make clone would contain the same misdirected modules and
`scenario_sheet_findings` would report it as a second offender, so the backup
would create the fault it exists to protect against. A file in git does not.

Two side effects worth naming. The blueprints were sent without their
`metadata.expect` blocks, which are Make's derived UI caches and are rebuilt when
a scenario is opened — the stale display labels that made this audit necessary go
with them. And the stored `samples` were dropped, which removes a copy of real
patient data from each blueprint.

### A fifth fault, found in all of them, and not fixed

Every one of these scenarios splits new patients three ways on `utmMedium`:

| Module | Condition | Destination |
|---|---|---|
| 2 | does **not** contain `paid` | own sheet |
| 15 | **equals** `paid` | own sheet |
| 16 | contains **`{{paid`** | own sheet |

Module 16's comparison value is a **broken merge tag** — the literal characters
`{{paid`. No real value contains that, so the branch can never fire. Which means
a booking whose `utmMedium` *contains* "paid" but does not *equal* it — say
`paid_social` — matches no branch at all and **is never written to the sheet**.

It is in **45 of 45** type-01 blueprints on hand, so it is in the template and
almost certainly all 58.

Left unfixed deliberately, for two reasons. Correcting `{{paid` to `paid` would
make modules 15 and 16 both fire on `utmMedium = "paid"`, producing a duplicate
row — so the fix is a rewrite of the branch logic, not a one-character edit. And
the impact is unevidenced: the only paid-social sample on record carries
`utmMedium = "Broad | Apple Tree/Avondale | 10 mil | [25-50]"`, which contains no
"paid" and correctly takes module 2.

**It cannot be measured from the Hub**, which is its own finding:
`appointments.utm_medium` is **null on all 369 rows**. The column exists and the
sync never fills it, so no attribution question can be answered from the Hub
today — and this particular gap cannot be sized without reading GoHighLevel
directly.

---

# The three practices missing from the Hub — 1 Sep 2026

Chasing the largest remaining item: Kind Dental has never had an appointment in
the Hub, Village Dental has had none since 22 July, and VDNE (General Dentistry)
has none ever. All three are active clients.

## Kind Dental: already diagnosed, already recorded, still not acted on

`calendar_list_conflicts` — the view added in `0019` — has carried the answer
since 24 August:

> `Il8ovGGMeIc7dbtkmB2N` · **Ortho & New Patient Exam | Dr. Vohra**
> *"Active, publicly bookable 45-minute Service calendar on a real PatientSync
> chair; confirmed new-patient consultations in a GoHighLevel UI audit on
> 2026-08-24. Second consults live on a separate calendar in this account."*
> appointments held **0** · charges held **15** · consults billed **28**

Somebody opened GoHighLevel and confirmed this is the practice's real
new-patient consultation calendar. It is nonetheless in `excluded_calendars`,
reason "Not the practice booking calendar". That single exclusion is why the Hub
has zero appointments for Kind Dental, why 15 charges are held, and why 28
consults were billed against nothing.

Removing it is one statement:

```sql
delete from excluded_calendars where crm_calendar_id = 'Il8ovGGMeIc7dbtkmB2N';
```

Not run here. It is a billing decision — it makes 28 consults visible and
releases 15 held charges — and that is the practice's commercial relationship,
not a data fix.

## VDNE (General Dentistry) is not a separate GoHighLevel location

It has no `crm_location_id`, which read like a missing value to be filled in.
It is not. Reading both stat sheets' Location ID column directly:

| Sheet | Data rows | Location ID found | Location Name |
|---|---|---|---|
| VDNE (General Dentistry) | 32 | `QfjLxc7h8uj4YZkryYUA` ×29 | Village Dental of New England |
| VDNE (main) | 117 | `QfjLxc7h8uj4YZkryYUA` ×29 (of 102 filled) | Village Dental of New England |

**The same id, and the same name, in both.** There is one GoHighLevel location
writing into two spreadsheets. The "(General Dentistry)" client in the Hub is a
Hub-side split with no CRM counterpart.

So the field must stay null. Assigning `QfjLxc7h8uj4YZkryYUA` to it would give
two clients the same location id, and every id-keyed lookup in this system —
routing, sync attribution, the consolidated data store — would then have two
answers to a question that must have one.

What it actually needs is a decision: either the two Hub clients merge, or the
split is deliberate and something other than a location id has to distinguish
them. The GD sheet's last row is **13 July**; the main sheet runs to **31
August**, which suggests the split has already lapsed in practice.

## Village Dental's own gap is narrowed but not closed

Its three Hub appointments all came from calendar `85cKh87AJV8VWnd8I0g5`, which
is **not excluded**, and they stop on 22 July. Its stat sheet has bookings
through 31 August. So the practice kept booking, the sync kept working for other
clients, and this location's bookings stopped arriving.

The most likely reading is that bookings moved to a different calendar after 22
July — one either excluded or never seen. Confirming that needs GoHighLevel's
calendar list for the location, which needs API access, which needs the token
bridge `6003601` that is still `isinvalid`. That chain is now the blocker on the
last of the three.

## Kind Dental's consultation calendar is no longer excluded — 1 Sep 2026

Run on Jemie's instruction:

```sql
delete from excluded_calendars where crm_calendar_id = 'Il8ovGGMeIc7dbtkmB2N';
```

`Ortho & New Patient Exam | Dr. Vohra`, excluded on 22 Aug with the reason "Not
the practice booking calendar", and confirmed two days later by a GoHighLevel UI
audit to be exactly that. `calendar_list_conflicts` is now **empty**.

To restore it, if the audit turns out to have been wrong:

```sql
insert into excluded_calendars (crm_calendar_id, client_id, calendar_name, reason, excluded_at)
values ('Il8ovGGMeIc7dbtkmB2N', 'd9f78b83-e6e2-4e58-ba4b-0c8fdf76857f',
        'Ortho & New Patient Exam | Dr. Vohra', 'Not the practice booking calendar',
        '2026-08-22 17:42:28.187218+00');
```

### What this does and does not do

**No money has moved.** This changes what the `crm-appointments` sync is allowed
to read. It does not bill anything, release anything, or alter a charge. The 15
held charges and 28 billed consults are still exactly where they were.

**Kind Dental still shows 0 appointments** and will until the next nightly sync
runs — the exclusion governs reading, and nothing has read since. That is the
check: after the next run, `appointments` for
`d9f78b83-e6e2-4e58-ba4b-0c8fdf76857f` should stop being zero for the first time.

If it is still zero afterwards, the Vohra calendar was not the whole story and
the remaining six exclusions need the same GoHighLevel scrutiny — particularly
` {{location.name}} Virtual Calendar `, the other judgement call from 22 Aug,
which nobody has audited. The five `Do Not Book` PatientSync mirrors are almost
certainly correct and should stay.

Only once real appointments land can the billing question be answered properly:
28 consults were billed against zero appointments, and until there are
appointments to compare them to, nobody can say which of the 28 were owed.

### It worked, and the nightly sync is clean for the first time

The 18:00 cron run on 1 Sep, the first since the exclusion was removed:

| | Before | After |
|---|---|---|
| Kind Dental appointments in the Hub | **0**, ever | **7** |
| `crm-appointments` run status | `partial`, every night | **`success`** |
| Errors on the run | **2**, every night | **0** |

All seven of Kind Dental's appointments are on calendar `Il8ovGGMeIc7dbtkmB2N`
— the Vohra calendar — spanning 5 Aug to 1 Sep. That is direct proof the
exclusion was the sole cause, not a contributing factor.

Both nightly errors were about this one calendar, and both had been describing
the fix for ten days:

> *"1 calendar(s) are named in both excluded_calendars and included_calendars.
> Exclusion wins, so they are NOT being read — which means somebody added them as
> consultation calendars and is still getting no appointments from them. One of
> the two entries is wrong and a person has to decide which."*

Somebody had already added the Vohra calendar to `included_calendars` after the
24 Aug UI audit. It stayed in `excluded_calendars` as well, exclusion won, and
the sync said so out loud every single night into a field nobody read.

The second error listed Kind Dental's whole calendar inventory, which explains
why nothing else could have covered for it: five `Do Not Book` PatientSync
mirrors, a `{{location.name}} Virtual Calendar`, a
`{{clinic.use}} Second_consultation`, and `Joshua Jung's Personal Calendar`. Not
one of the readable ones is a new-patient consultation calendar.

### One consequence, handled

That run started at 18:00:23, roughly as PR #2 merged, so it executed the
**pre-merge** code and re-incremented `reschedule_count` on 292 rows — exactly
the regression predicted before merging. `0026`'s reset was re-run; both columns
are back to 0 and null.

From the next nightly run onward the deployed fix compares instants, so this
should stay at zero without intervention. **That is the one thing still worth
checking tomorrow:** if `reschedule_count` is non-zero again after the 2 Sep run,
the deploy did not take.

### Still open on the billing question

28 consults were billed and 15 charges are held against what was, until today,
zero appointments. There are now seven. Whether those seven reconcile against
the 28 is a separate exercise, and it needs the appointment ledger rather than
this table.

---

# The ledger rebuild now fails, and it is a consequence of the Kind Dental fix

Ran `appointment-ledger` manually at 18:07 to link the seven new appointments.
It aborted:

```
fatal: duplicate key value violates unique constraint "appointment_ledger_tracker_key"
Key (tracker_source_tab, tracker_source_row)=(Appointment Data, 46) already exists.
```

**No damage.** The ledger is still 1,344 rows and nothing was linked; the
function is atomic and rolled back.

## What the bug is

`rebuild_appointment_ledger()` inserts CRM appointments as ledger rows first,
then matches tracker rows to them on client + patient name + date, then stamps
the tracker key onto the matched CRM row:

```sql
merged as (
  update appointment_ledger l
  set tracker_source_tab = p.tab,
      tracker_source_row = p.source_row, ...
  from paired p
  where l.id = p.ledger_id and p.ledger_id is not null
)
```

If that tracker row **already has its own tracker-only ledger row**, two rows now
carry the same `(tracker_source_tab, tracker_source_row)` and the unique index
rejects it. The merge never removes the row it is superseding.

It has been dormant since the ledger was built, because it only fires the first
time a practice goes from *"tracker rows, no CRM appointments"* to *"both"* — a
transition no practice had made. Kind Dental made it this evening.

## Blast radius: three rows, one practice, no money

| tracker row | date | outcome | billing state | amount | billed | Stripe intent |
|---|---|---|---|---|---|---|
| 102 | 7 Aug | showed | billable | £0 | no | no |
| 21 | 19 Aug | pending | pending | £0 | no | no |
| 46 | 20 Aug | pending | pending | £0 | no | no |

None carries money, a `billed_at`, or a payment intent.

## Why it matters more than three rows

The function is one statement. Three colliding rows abort the **entire** rebuild,
so **the 06:04 run tomorrow will fail the same way** and the reconciliation stops
updating fleet-wide — including the numbers it reported this morning:

- 45 charge lines totalling **$11,836.75** that cannot be tied to an appointment
- 455 delivered consultations worth an estimated **$102,592.66** unbilled past 30 days
- 27 appointments billed without a recorded show, or vanished while still open

Those figures go stale until the rebuild runs again.

## Two ways out

**Patch the function** — the right fix. In the `merged` CTE, delete the
superseded tracker-only row as part of the merge, so one appointment keeps one
ledger row: the CRM-keyed one, enriched from the tracker. This also covers the
next practice to make the same transition, which Village Dental will do the
moment its calendar is found. It is a change to billing reconciliation logic and
has no test harness, which is why it is not done here.

**Clear the three rows** — unblocks tonight. They carry no money and the rebuild
recreates them correctly from `tracker_appointments`. But it recurs for the next
practice, so it buys time rather than fixing anything.

Recommend the patch, with the three-row clear only if the reconciliation numbers
are needed before someone can review a function change.

## Patched, and the rebuild runs clean again

`0030` adds `merge_superseded_tracker_ledger_rows()`, called from
`appointment-ledger.ts` immediately before the rebuild.

It is a separate function rather than a change to `rebuild_appointment_ledger`
on purpose. The superseded rows can be identified without any of that function's
internals — they are tracker-only ledger rows whose patient and date already
exist as a real appointment — so the fix stays small enough to read in one
sitting and 177 lines of billing logic stay untouched.

It matches the `appointments` table rather than CRM-keyed ledger rows, because
at the point it runs those ledger rows do not exist: step 1 of the rebuild is
what creates them. That is also why the collision could never be seen in the
ledger's resting state, only mid-rebuild.

**Rows in `waived`, `disputed` or `on_hold` are deliberately left alone.**
`attribute_ledger_charges()` resets and re-derives `billing_state`, `billed_at`,
`stripe_payment_intent_id` and `amount_cents` from `billing_charges` on every
run, so a superseded row carries nothing durable — except those three states,
which are a person's decision. If one ever collides the rebuild will abort
exactly as it did today, and that is the right outcome: somebody disputed a
charge, and a merge should not quietly decide what happens to it. None exist
today, fleet-wide.

### Verified

```
merge_superseded_tracker_ledger_rows()  ->  3 rows removed
rebuild_appointment_ledger()            ->  from_crm 386 · rows_total 1358
                                            matched_both 294 · billed_rows 342
```

| | |
|---|---|
| Duplicate tracker keys anywhere in the ledger | **0** |
| Kind Dental ledger rows | 36 — 32 tracker + 7 CRM − 3 merged |
| Kind Dental rows linked to a CRM appointment | **7** |
| Kind Dental rows now carrying **both** feeds | **3** |

The reconciliation is live again, so tonight's numbers are current rather than
frozen at this morning's. The three rows that aborted it are now single rows
carrying both a CRM appointment id and their tracker origin — which is what the
ledger was built to produce.

---

# Billed for consultations that were not delivered — 1 Sep 2026

With the ledger rebuilding again, the billing question Kind Dental raised is
answerable fleet-wide. It is not a Kind Dental problem.

| Outcome recorded | Rows billed | Practices | Amount |
|---|---|---|---|
| showed | 315 | 28 | $60,829.32 |
| **no_show** | **17** | **11** | **$3,230.34** |
| **outcome never recorded** | **9** | **7** | **$1,659.33** |
| **cancelled** | **1** | **1** | **$202.91** |

**27 charges totalling $5,092.58** are against consultations that either did not
happen or were never confirmed to have happened — about 7.7% of billed value.

That 27 is not a coincidence. It is the same 27 the nightly exception report has
been printing for months: *"27 appointment(s) are either billed without a
recorded show or vanished from the CRM while still open."* The view was right;
nobody had put a number on it.

## Per practice

| Practice | No-show | Cancelled | Never recorded | Amount |
|---|---|---|---|---|
| Anaheim Smile Center | 3 | – | 2 | **$1,014.55** |
| Bespoke Orthodontics | 2 | – | 1 | $608.73 |
| Hancock and Johnston Dentistry | 2 | – | – | $456.55 |
| Wilmington Family Dental | – | – | 2 | $405.82 |
| Bling Dental | 1 | 1 | – | $405.82 |
| Snyder Dental Group | 2 | – | – | $405.82 |
| TMJ Sleep Airway Orthodontics – Williston | 2 | – | – | $302.82 |
| DNA Dental Studio | 1 | – | – | $202.91 |
| Smile and Implant Center of Rockland | – | – | 1 | $202.91 |
| Diamond Dental | – | – | 1 | $202.91 |
| HEB Family Dentistry | 1 | – | – | $202.91 |
| Magic Dental | 1 | – | – | $202.91 |
| Kind Dental | 1 | – | 1 | $175.10 |
| Lightning Orthodontics | – | – | 1 | $151.41 |
| Team Dental N. Liberties | 1 | – | – | $151.41 |

15 practices, 15 Mar – 27 Aug.

The three categories are not equally wrong. A **no-show** or **cancelled** charge
is billed for something the record says did not occur. An **outcome never
recorded** charge may be perfectly good — nobody answered the survey, which is
the adoption problem — but it is billed without evidence, which is the same
position to be in if a client asks.

## Kind Dental specifically, now that it has appointments

36 ledger rows. 21 billed at $1,838.55, spanning 21 Apr – 20 Jul, and **not one
of them has a CRM appointment behind it**.

Removing the exclusion fixed the future, not the past. The sync's window reaches
back to 7 July at the earliest, so consultations billed before then can never
gain calendar corroboration — the tracker sheet remains the only evidence they
happened. Of the 21, two are questionable on their face: one billed against a
recorded no-show and one where no outcome was ever recorded.

## Not recommended: fixing the `{{paid` defect

The broken merge tag in all 58 type-01 scenarios is real, but it should be left
alone.

Its effect is unmeasurable from here — `appointments.utm_medium` is null on all
369 rows, and a dropped booking leaves no row to count. And the replacement
already does not have it: the consolidated scenario `6046761` writes every
booking through one `addRow` with no `utmMedium` branch at all. Editing 58 live
scenarios to repair a fault that the retirement deletes, with no way to show it
has ever fired, is work spent on a system being switched off.

---

# Task 3, the coverage gap: as closed as it goes without GoHighLevel

The gap was **27** appointments per fortnight present in the Client Fulfilment
Tracker and absent from the Hub. It is now **25**, and it is no longer a
fleet-wide problem — it is one practice.

| Practice | Rows | Status |
|---|---|---|
| Village Dental of New England | 9 | blocked — bookings stopped reaching the Hub on 22 Jul |
| Village Dental (General Dentistry) | 9 | blocked — needs a merge decision, not a data fix |
| Art Of Smile | 2 | needs a per-row GoHighLevel lookup |
| **Kind Dental** | **2** *(was 4)* | **halved by removing the calendar exclusion** |
| Bling Dental · The Smile Patio | 1 each | per-row lookup |
| Lightning Orthodontics | 1 | a tracker typo — see below |

**18 of the remaining 25 are Village Dental**, across its two Hub clients. Both
threads run into the same wall: one needs somebody to decide whether the two
clients are one practice, the other needs GoHighLevel's calendar list.

## The name matcher is not the problem

Worth recording, because it was the obvious suspect and it is innocent. Seventeen
unlinked tracker rows across eight practices have a Hub appointment on the same
day, which looks like failed name matching. It is not:

| | |
|---|---|
| Unlinked rows with a same-day Hub appointment | 17 |
| …whose first name matches the appointment's | **1** |
| …differing only by whitespace | **0** |

They are different patients seen on the same day. A practice books several
consultations a day, so "same date" was never much of a signal. Only one row in
seventeen is even a candidate for a spelling miss.

So the residual gap is genuinely missing CRM appointments, not appointments the
Hub holds and failed to recognise. No fuzzy-matching work is warranted; it would
manufacture false links against a problem that does not exist.

## The one clear data error, and why it is not fixed here

Tracker row 173, Lightning Orthodontics: `booked_for` **2 Aug 2027**, created
17 Jul 2026 — **381 days ahead**, with no appointment status. Almost certainly
2026 mistyped as 2027.

Not corrected in the database, because the Client Fulfilment Tracker is the
source and the next import would write the typo straight back. It is a one-cell
edit in that sheet, and it is somebody's to make rather than mine to guess: a
381-day lead time is implausible, not impossible.

It is worth making. A 2027 date keeps the row permanently "upcoming", so it will
sit in the exception and backlog views indefinitely without ever resolving.
