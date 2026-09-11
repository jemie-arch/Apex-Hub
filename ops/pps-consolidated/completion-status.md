# PPS 0 Error System — where it stands, 10 September 2026

Due 11 September. This is the state after today's pass, what closed, and what
genuinely remains.

## Routing is effectively done: 48 of 49

| | Before today | Now |
|---|---|---|
| Routing rows | 49 | 49 |
| Verified | 42 | **48** |
| In `pps_routing_export` | 42 | **48** |
| Unverified | 7 | **1** |

Six of the seven outstanding rows were closed **from evidence already in the
database**, not by opening sheets. `scenario_sheet_targets.label` holds the
spreadsheet name Make itself cached when somebody picked the sheet in the
module, and for six practices that label names the practice outright:

| Practice | Cached sheet label |
|---|---|
| All Dental of Menifee | `All Dental of Menifee - Stat Sheet` |
| Genuine Family Dentistry | `Genuine Family Dentistry - Stat Sheet` |
| Integrity Dental | `Integrity Dental - Stat Sheet` |
| Smile Now Align | `Smile Now Align - Stat Sheet` |
| Stanton Dental Care | `Stanton Dental Care - Stat Sheet` |
| Tamara Levit DDS PC | `Tamara Levit DDS - Stat Sheet` |

`verified_by` is deliberately **left null** on all six. This is evidence, not a
human sheet check — a Make label is cached when the sheet is first picked and
can go stale, which is exactly how three webhooks in this fleet ended up wearing
another practice's name. Each row's note records the label it was verified
against, so anyone can overturn it in seconds.

### Stanton Dental Care needed a second look

Two **active** scenarios write to the same spreadsheet under different cached
names — `4176701 "OC Healthy Smiles"` and `5111292 "Z. Stanton Dental Care"`.
That is either a rename with a stale label, or two practices sharing one stat
sheet, and those have very different consequences.

Settled: **there is no "OC Healthy Smiles" client in the Hub at all.** Only
Stanton. So it is a rename whose old scenario was never cleaned up — the same
class as the Best Care Dental finding already recorded. Routing is safe; the
orphaned scenario is a cleanup item.

Worth noting the export already guards this case on its own: it excludes any
spreadsheet claimed by more than one routing row.

### The one deliberately left open

**TMJ Sleep Airway Orthodontics - Ponte Vedra.** Its label reads
`Airway Orthodontics - FL PV - Stat Sheet`. "PV" is almost certainly Ponte
Vedra, but that is an abbreviation inference rather than a name match, and the
original findings singled this one out because Gainesville is also in Florida.
It is the row where being wrong is most plausible, so it stays out of the export
until a person opens the sheet.

## Gaps: 16 → 11, and the remainder is not really a gap

Five of the sixteen were **test clients** — `ZZ Route Test`,
`ZZ Automation Test`, `ZZ Profile Test`, `ZZ Profile Test B`,
`ZZ User Automation Test`, all created 2–3 September with zero appointments,
leads, campaigns and ledger rows. Marked internal and inactive, which removes
them from the gap list and, since migration 0068, from the Client Fulfilment
Tracker too.

Of the eleven left:

- **Nine are practices with no automation whatsoever** — Great Smiles of La Mesa
  (twice), Natalie Yang Orthodontics, Habib Dental Implants, Evergreen Dental
  and Orthodontics, Metro Dental & Implant Studio, Skyline Implants &
  Periodontics, Limestone Hills Orthodontics, Firewheel Smiles. Not a routing
  gap: they were onboarded into the Hub ahead of their automation being built,
  and the consolidated scenario covers them the moment their GoHighLevel
  workflow points at it.
- **One is Ponte Vedra**, held deliberately as above.
- **One is `Village Dental of New England (General Dentistry)`**, which has no
  GoHighLevel location id at all, so a booking can never be matched to it.

## Duplicate client records worth a decision

Three records look like duplicates rather than practices:

- `Village Dental of New England (General Dentistry)` — no location id, no
  leads, no spend, and it is the row that shows a blank CPL next to the real
  Village Dental. It appears in this gap list and in the CPL investigation from
  two independent directions.
- `Great Smiles of La Mesa` and `Great Smiles of La Mesa - READY` — two records,
  two location ids, one practice name.

Not merged, because merging client records moves appointments and billing.

## Kind Dental: already fixed

The findings recorded 27 consultations billed against **zero** appointments,
caused by one calendar sitting in both the excluded and included lists.

That is now resolved — the exclusion row is gone, `calendar_list_conflicts` is
**empty**, and Kind Dental holds **11 appointments**. Done since the findings
were written; recorded here so nobody chases it twice.

## The cutover is bigger than "activate 5 scenarios", and one step is blocked

Counting what is actually running today:

| Type | Per-practice **active** | Consolidated active |
|---|---|---|
| 01 New Appointment Booked | 56 | **1** |
| 02 CCM Show Tracker | 52 | 0 |
| 03 CCM No Show Tracker | 55 | 0 |
| 04 Appointment Update Form | 54 | 0 |
| 06 Appointment Cancelled | 55 | 0 |
| **07 Onboarding Form** | **0** | **1** |

**Type 07 is a completed cutover and the template for the rest**: every
per-practice scenario off, one consolidated scenario on.

**Type 01 is active but receiving nothing, and this is the finding that decides
the whole cutover.**

Its execution history ends on **1 September**, and those last runs were manual
tests fired seconds after edits by the person building it — 5 and 6 operations,
a couple of kilobytes of transfer. **Ten days, zero real traffic.**

So it is not shadow-running alongside the per-practice scenarios. It is switched
on and idle, because **no GoHighLevel workflow points at its webhook.** The
1,443 appointments in the Hub arrive through the crm-appointments sync reading
the GoHighLevel API, not through this scenario.

That changes what "cut over" means, and it rules out the obvious plan.
Deactivating the per-practice scenarios would not move traffic to the
consolidated one — it would stop bookings reaching anything at all, because
GoHighLevel would still be calling webhooks attached to disabled scenarios.

**The remaining work is in GoHighLevel, not in Make.** Each practice's workflow
has to be repointed from its own webhook to the consolidated scenario's, one at
a time, and only then can its old scenario be retired. That is roughly 56
workflow edits per type — and it is exactly why type 07, with only five
practices, is the one that got finished.

So the cutover per type is: repoint each practice's GoHighLevel workflow,
confirm the consolidated scenario is receiving that practice's bookings, and
only then **deactivate that practice's scenario** — 52 to 56 of them per type. Across types 02, 03, 04 and 06 that is roughly 216
scenarios, and the consequence is that every per-practice stat sheet stops being
written. That is a decision about who still reads those sheets, not a technical
step — and it is the same cleanup Joshua described when he said there are a lot
of Make scenarios we do not need.

### The routing store is five practices behind, and cannot catch up

The consolidated scenarios carry no per-practice configuration. They read a Make
data store keyed on the GoHighLevel location id the webhook already carries —
store **137975, "PPS Clinic Routing"**, already wired to scenario 6046761.

It holds **43 records**. The Hub now has **48** verified rows. The five newly
verified practices are not routed.

**`routing-export` has never run from the Hub at all** — `sync_runs` holds no
row for it. It needs `MAKE_TOKEN`, the same variable `scenario-audit` is
waiting on, plus `MAKE_ROUTING_DATA_STORE_ID`, which is 137975. The store
exists and is connected, so **only the token is missing.**

Nothing is silently wrong while it waits: an unpublished practice is simply not
routed, and the consolidated scenario treats that as "no sheet known" rather
than guessing. But it does mean those five practices cannot be cut over until
the token is set and the sync runs once.

I have not written to the store by hand. The module that owns it states the rule
plainly — nothing reaches it until a row is verified — and routing a real
patient's booking into another practice's sheet is the exact failure the whole
exercise exists to prevent. Publishing it belongs to the sync, once it can run.

## The pilot found a live outage, and the cutover mechanism

Attempting the pilot on Dental Illusions turned up two things neither the plan
nor I had right.

### Dental Illusions has been dark since 1 September

Its GoHighLevel workflow — `001. New Appointment → Make → Send Email Form -
PPS v6.1`, published, two triggers — has one webhook action, named
`01 PPS Make [TO CHANGE]`. Its URL field reads:

    https://hook.us2.make.com/<consolidated hook>{{custom_values.01__pps__new_appointment_booked__update_sheet}}

Somebody pasted the consolidated hook in FRONT of the existing merge token
rather than replacing what the token resolves to. At runtime that concatenates
two URLs into one malformed string, so the POST reaches nothing.

Confirmed from both ends in Make:

- the consolidated scenario 6046761 has no execution since 1 September, and
  those were three manual tests by the person editing it;
- Dental Illusions' own scenario 5970597 last ran on 1 September at 18:30 and
  has been silent for ten days.

Neither the old path nor the new one is receiving.

**But nothing was lost.** The Hub settles it independently of Make, because it
reads appointments from the GoHighLevel API rather than from any scenario:
Dental Illusions has **two appointments in total**, booked 4 and 12 August, and
none since. Its stat sheet holds two rows. They match.

So the half-edit broke a pipe that nothing has flowed through since 12 August.
An earlier version of this section said ten days of bookings had not reached the
sheet. That was an inference from the scenario being silent, and the silence was
absence of traffic, not lost traffic.

That has a consequence for proving the fix: there is no organic booking to wait
for. At roughly two a month, confirming the new path works needs a deliberate
test booking rather than patience — and the low volume that made this a safe
pilot is exactly what makes it a slow one to verify.

**It is isolated.** City Dental Centers' equivalent scenario fired on 10, 8, 7,
3 and 1 September, all clean, so the fleet is healthy. This is one half-finished
edit on the one clinic somebody chose to pilot — the same clinic the routing
store nominates, for the same reason: small enough that a mistake is cheap.

### The per-practice hook lives in a custom value, not in the workflow

This is the more useful discovery. The workflow action does not contain a URL.
It contains a merge token, and the practice's own hook is held in a GoHighLevel
custom value:

| | |
|---|---|
| Folder | `PPS-System` |
| Name | `01 - PPS - New Appointment Booked -> Update sheet` |
| Key | `{{custom_values.01__pps__new_appointment_booked__update_sheet}}` |

So the cutover is **not** 56 workflow edits. It is **one custom-value edit per
practice** — change what that key resolves to, and every workflow in that
sub-account referencing it follows. Rollback is the same single field.

That also means the brief I wrote was wrong in a way that mattered: it told the
agent to record the URL in the action as the rollback and then replace it. The
action holds a half-edited string, not the old hook, so following it would have
destroyed the only in-workflow reference to where bookings currently go. The
agent stopped instead of proceeding, which is the reason this is a finding
rather than an incident.

### Restoring Dental Illusions

Two edits, in this order:

1. Set the custom value to the consolidated hook.
2. Strip the pasted literal out of the workflow action so the field is the token
   alone.

Doing only (1) leaves the action concatenating the consolidated hook with
itself — still malformed. Doing only (2) restores the practice to its old
working path, which is a valid rollback if the cutover is deferred.

**Record the current custom-value contents before touching it.** It is the only
copy of where that practice's bookings used to go, and it belongs in a password
manager rather than in this repository — a Make webhook URL is a write
capability, and anyone holding it can post bookings into a practice's sheet.

## What actually remains

1. **Activate the 5 consolidated scenarios.** Built, tested, still INACTIVE.
   Needs the Make UI and an explicit go-ahead — this replaces live per-practice
   automations.
2. **Ten config faults across five practices** — misdirected writes at Kind
   Dental, SMYLE East Meadows and Team Dental Swedesboro; stray whitespace in
   Dental Solutions' spreadsheet ids; Eagle Creek reading one sheet and writing
   another. The consolidated scenarios make most of these moot, which is an
   argument for doing (1) rather than patching each one.
3. **Ponte Vedra** — one sheet to open.
4. **The 28 practices mis-filing cancelled second consults.** Type-06 scenarios
   come in two variants and only one has the router that separates first from
   second consultations. Practices with the other variant write a second-consult
   cancellation into the *first* consult's column, overwriting it. This is fixed
   by the consolidated type-06 scenario, which cannot get it wrong — the Hub
   holds one row per appointment and the appointment id already says which
   consultation was cancelled. Another argument for (1).
5. **Three practices marked churned in Make but active in the Hub** — Eagle
   Creek, Snyder Dental Group, Stanton Dental Care. Somebody who knows should
   say which.

Items 2 and 4 both resolve through item 1. **The cutover is the work, not a
list of individual repairs.**
