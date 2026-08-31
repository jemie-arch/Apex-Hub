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
`Bearer REPLACE_WITH_CRON_SECRET`. Prefer Make's keychain over pasting the value:
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
`Authorization: Bearer REPLACE_WITH_CRON_SECRET`, which has to be replaced before
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
