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
