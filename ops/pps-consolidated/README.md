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

## BLOCKER — the stat sheets do not share a column layout

The consolidated scenario maps values by column **index**, which requires every
target sheet to have identical columns. They do not. Measured across 118 fetched
blueprints:

| Column carrying "Offer Name" | Blueprints |
|---|---|
| `AD` | 832 |
| `AA` | 114 |

and 22 blueprints carry a `First Called` column that the others lack.

Index 29 is column AD. So the current mapping is right for the newer layout and
writes past the end of the older one. **Do not activate against the whole estate
until this is resolved.** Two ways:

1. **Map by header name** — set `useColumnHeaders: true` and key the `values`
   collection on header strings rather than indices. Robust to layout drift,
   which is the durable answer. It needs the exact header text, and some headers
   contain awkward whitespace (`"CC On File\n (Y/N)"`), so it has to be taken
   from a real sheet rather than typed from memory.
2. **Standardise the sheets** to one layout first. More work, and it touches
   live client sheets.

Option 1 is preferred. Until either is done, the consolidated scenario is safe
only for clinics on the AD layout, and which clinic is on which is not yet
recorded anywhere.

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
