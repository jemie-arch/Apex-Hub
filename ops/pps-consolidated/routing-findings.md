# What the booking-scenario sweep turned up

Findings from reading every `01 - PPS - New Appointment Booked` blueprint, recorded
here rather than acted on, because each one is somebody's decision and not mine.

Nothing below was changed in Make. No live scenario was edited, paused or deleted.

## The routing rows

Fifty-two of the fifty-nine type-01 scenarios were read directly. Each one names a
spreadsheet id in its own modules, so the practice-to-sheet mapping is evidence
taken from the running automation, not a guess from a name.

That produced **43 routing rows**, all `source = 'derived'` and all unverified. They
sit on `/settings/clinic-routing` waiting for somebody to open each sheet and
confirm it belongs to that practice. Until verified they are deliberately excluded
from `pps_routing_export`, so nothing routes on them yet.

The gaps list moved from 57 practices with no known sheet to **13**.

## Three webhooks wear another practice's name

| Scenario | Practice | Webhook's display label |
|---|---|---|
| `4151568` | DNA Dental Studio | Abraham Orthodontics |
| `4187731` | Smile Now Align | Smile and Implant Center of Rockland 1 |
| `4167561` | Dental Design Studios | Smile Dental Studio 1 |

The hook **ids** are distinct and correct, so live traffic is not crossing between
practices. This is the same stale-display-label class as the spreadsheet labels:
the name was cached when the webhook was created and never refreshed.

The risk is human, not mechanical. Anyone wiring a GoHighLevel workflow by picking
a webhook from Make's dropdown is choosing by the wrong name.

## Dental Design Studios still holds patient data in a stored sample

`4167561`'s `metadata.designer.samples` contains a complete booking payload — name,
email, phone, date of birth, and a Social Security Number field. This confirms it
belongs on the list of stored samples to clear. Stored samples do not expire.

Its `Clinic Location` field also names a different practice from its `location.name`,
so it appears to be a multi-location client whose bookings all land in one sheet.
Worth knowing before the consolidated scenario replaces it.

## Snyder writes different data into the same columns

Every other scenario fills columns X/Y/Z on the update path with
`campaign` / `utmMedium` / `utmContent`. `3816566` fills the same three with
`campaign` / `adSetId` / `adId`.

Both are defensible; they are not the same thing. Any report reading columns Y and Z
across practices is comparing ad-set ids against a targeting description for this
one clinic.

## Three practices are marked churned in Make but active in the Hub

Eagle Creek Dentistry, Snyder Dental Group and Stanton Dental Care all sit in Make
folders prefixed `Z.`, the team's marker for a finished client. All three are
`is_active = true` in the Hub, and all three have zero appointments on record.

Either they churned and the Hub was never told, or they are dormant. Somebody who
knows should say which — they currently count toward the routing gaps and would
count toward any per-client billing check.

## Best Care Dental runs a scenario for a client that does not exist

`3744209` is active, writes to `Best Care Dental - Stat Sheet`, and there is no
client of that name in the Hub. Either the client record is missing or the scenario
outlived the engagement.

## ADM Ortho Snapshot points at the template on purpose

`5947250` writes to `1 - COPY THIS - Stat Sheet Template`. That is correct — it is the
scenario the per-client clones are made from. Recorded so nobody later reads it as a
misdirected write and "fixes" it.

---

# Second pass: the remaining gaps

## Six practices were the same clinic under two names

The Hub and Make name these six differently, so the identity matcher correctly
refused them. The abbreviations are documented in the sheet names themselves:

| Hub client | Make folder | The read |
|---|---|---|
| TMJ Sleep Airway Orthodontics - Gainesville | Airway Orthodontics - GNV | GNV is Gainesville |
| TMJ Sleep Airway Orthodontics - New York | Airway Orthodontics - NY | — |
| TMJ Sleep Airway Orthodontics - Ponte Vedra | Airway Orthodontics - FL | sheet is named "FL PV"; PV is Ponte Vedra |
| TMJ Sleep Airway Orthodontics - Williston | Airway Orthodontics - Williston | sheet is named "VT"; Williston is in Vermont |
| Art Of Smile: Center for Cosmetic Orthodontics | Art of Smile | Hub name carries a subtitle |
| Tamara Levit DDS PC | Tamara Levit DDS | Hub name carries a PC suffix |

These are filed as `source = 'inferred'`, not `'derived'`, and the note on each row
says what the inference was. Reading GNV as Gainesville is a good guess, not an
identity match, and the person verifying should know which they are looking at.

Ponte Vedra deserves the closest look: Gainesville is also in Florida, so "FL"
alone does not settle it. It rests on the sheet being named "FL PV".

**No sheet known is now 7 practices, down from 57.**

## The last seven have no automation at all

Evergreen Dental and Orthodontics · Habib Dental Implants · Limestone Hills
Orthodontics · Metro Dental & Implant Studio · Natalie Yang Orthodontics ·
Pacific Dental Center · Skyline Implants & Periodontics

None of these has *any* scenario in Make — not just no booking scenario, nothing
across all 332. All seven were added to the Hub on 21 Aug 2026 and none has a single
appointment. They look like clients onboarded into the Hub ahead of their automation
being built. If that is right, they are not a routing gap at all and the consolidated
scenario will cover them the moment their GoHighLevel workflow points at it.

# Clients billed with no appointments on record

This came out of the same sweep and is not about routing.

Nine active clients have Stripe charges and zero appointments in the Hub —
35 charges, $12,915. That number is misleading and should not be quoted.

**The Hub's appointment data only covers 7 Jul 2026 to 8 Oct 2026.** Twenty-five of
those 35 charges occurred before 7 Jul, so there is no appointment data for that
period for *anyone*. Their absence says nothing.

Ten charges fall inside the window the Hub actually holds:

| Client | Charges | Amount | Consults billed | Succeeded |
|---|---|---|---|---|
| Natalie Yang Orthodontics | 2 | $1,000.00 | 0 | 2 |
| Integrity Dental | 2 | $994.00 | 0 | 1 |
| Kind Dental | 5 | $971.29 | 6 | 3 |
| TMJ Sleep Airway Orthodontics - Williston | 1 | $302.82 | 2 | 0 |

Natalie Yang and Integrity bill **zero consults** on those charges, so they are
almost certainly flat or retainer charges with no appointment to match. Not a gap.

**Kind Dental is the one to look at.** Six consultations billed, three charges
succeeded, inside the window where the Hub does hold appointments — and it has no
appointments whatsoever. Its location id is `KiGqpUllGNj1tJyPMpnX`. Either that id
is wrong, or the appointment sync is not reaching this client. Kind Dental also has
two separate Make scenarios, "Kind Dental" and "Kind Dental (GD)", writing to two
different sheets, which may be the same thing seen from the other side.

Williston bills 2 consults on one charge that did not succeed, so nothing was
collected; worth confirming rather than chasing.

I have not changed any client record, any charge, or any sync configuration.

---

# Kind Dental: found it

Kind Dental is billed for **27 consultations across 14 charges** and the Hub holds
**zero appointments**. The cause is a contradiction in the data, and it is now a row
you can look at rather than a day of digging.

The calendar `Ortho & New Patient Exam | Dr. Vohra` is in **both** lists:

- `excluded_calendars`, by id `Il8ovGGMeIc7dbtkmB2N`
- `included_calendars`, by name, with this reason recorded:
  > Active, publicly bookable 45-minute Service calendar on a real PatientSync
  > chair; confirmed new-patient consultations in a GoHighLevel UI audit on
  > 2026-08-24. Second consults live on a separate calendar in this account.

The appointments sync applies the exclusion, so that calendar is never read, so no
appointment ever lands. `crm-appointments.ts` already carries a comment about this
exact pair — an earlier fix stopped the missing-calendar alert from contradicting
the fetch, which made the problem *visible*. It could not resolve it, because which
list is right is a judgement, not a code path.

**The judgement already exists.** Somebody audited that calendar in the GoHighLevel
UI on 24 Aug and wrote down that it holds new-patient consultations. The exclusion
row is the older, stale one.

I have not deleted it. Removing that row makes roughly 27 consultations' worth of
appointments appear at the next sync, which then feeds delivered-against-invoiced —
a visible change to billing reconciliation, and yours to make rather than mine:

```sql
delete from excluded_calendars
where crm_calendar_id = 'Il8ovGGMeIc7dbtkmB2N';
```

`calendar_list_conflicts` is the new view. Kind Dental is the **only** conflict in
the system today, so this is one fix and not a class with many instances — but the
next one will be a row instead of a mystery.

---

# The audit table now covers the fleet, and I had left it behind

`scenario_sheet_targets` held **14 scenarios** while routing held 49 and I had read
52. I had loaded the routing data and left the audit data behind.

**Correcting myself:** I first wrote that this made the reconciliation panel read as
a clean verdict on the whole fleet. It did not. That page already prints "Covers the
N scenarios read so far, last on <date>", and it was honestly saying **14**. Whoever
built that line had already guarded against exactly this. The defect was the missing
data, not the display — and I should have checked the page before describing what it
showed.

Now loaded: **49 scenarios, 377 sheet-touching modules, 50 distinct spreadsheets.**

## The findings did not move

Still **10**. Every one of the 35 newly loaded scenarios writes to exactly one
spreadsheet, consistently, with no padding and no split between the row it reads
and the row it writes.

That is the useful result. The misdirection is **concentrated, not systemic**:

| Finding | Count | Practices |
|---|---|---|
| Misdirected write | 6 | Kind Dental, SMYLE Dental Centers East Meadows, Team Dental Swedesboro |
| Spreadsheet id with stray whitespace | 2 | Dental Solutions |
| Reads one sheet, writes another | 1 | Z. Eagle Creek Dentistry |
| One sheet claimed by several scenarios | 1 | (across scenarios) |

Five practices out of forty-nine. Worth knowing before anyone decides how much of
the fleet needs hand-checking during the cutover: the answer is these five.

Kind Dental appears here **and** in the calendar-list conflict above. Two
independent faults on the same client, found by two different routes.

## The denominator was already there

Verified on the live page after loading the data:

> Covers the **49** scenarios read so far, last on 31 Aug 2026. A scenario that has
> not been read does not appear here and is not evidence of a clean one.

`scenario_audit_coverage` is a view I added carrying the same counts plus a canned
caveat sentence. It is **not load-bearing** — the page computes its own coverage from
`scenario_sheet_targets` and always did. It is there for anyone querying the findings
from SQL, where the denominator is easy to forget. Do not treat it as the guard; the
guard is on the page.

It deliberately does not hardcode how many scenarios exist in Make. That number
changes every time somebody clones one, and a stale denominator reads as
authoritative while being wrong — worse than having none.

---

# Did the misdirected writes ever run? Still unanswered

I thought I had a way to check this and I was wrong. Recording the attempt because
the reasoning error is worth not repeating.

**The idea.** `scenario_sheet_findings` reads Make's configuration and can only say
a scenario *points* at the wrong sheet. Every booking row carries its GoHighLevel
location name, so — I reasoned — a row sitting in one practice's sheet while naming
a different practice would be a write that had actually landed in the wrong file.

**Why it does not work.** `tracker_appointments` is not per-practice stat sheets.
It is a single Client Fulfilment Tracker. `source_row integer not null unique` says
so plainly, and I read past it. `location_name` is the practice as that one
spreadsheet spells it, and `client_id` is a name match the Hub makes on import.

So the mismatches I found were the Hub's name matching, not misdirected writes. Six
of the seven are the alias list **already written into `0001_init.sql`** — mapping
"Airway Orthodontics - GNV" to Gainesville, "Art of Smile" to the full trading name,
the "... Apex" suffixes home. I rediscovered an existing table and reported it as
new evidence.

The seventh, a "Kind Dental (General Dentistry)" row attributed to Kind Dental, is
the same class — most likely left over from the earlier matching rule that dropped
everything after the first bracket, which is the rule `0001` replaced *because* it
merged distinct practices. There is no unaudited misdirect behind it: scenario
`5972241`, Kind Dental (GD), points every module at its own sheet. I checked.

The view has been dropped. Nothing replaces it, because this table cannot answer
the question.

## What survives

**The inferred routing matches are corroborated, but not by me.** `0001_init.sql`
already contains the same conclusions, reached by whoever wrote it, with the same
reasoning — including that Williston is the only real Vermont town among the Airway
locations, and that Ponte Vedra has no tracker rows at all. Five of my six
`inferred` rows were already established there. That is genuine support for them; it
is just older than my work, not independent of it.

That same comment records "Best Care Dental" and "Ofir Orthodontics" as names with
no candidate anywhere in the CRM — which matches what I found separately about Best
Care Dental having a live scenario and no client record.

## What is still open

Whether the misdirected `updateRow` modules on Kind Dental and Team Dental
Swedesboro have ever fired. They overwrite one cell in an existing row of another
practice's sheet, addressed by a row number computed against a different file, and
they change no name — so nothing in the Hub can see them. It needs the receiving
spreadsheet's own revision history, in Google Sheets.

---

# Do the other event types misdirect too? A targeted sample says probably not

Only type 01 has ever been audited for wrong-sheet writes. Types 02, 03, 04 and 06
are ~226 more live scenarios nobody has checked. Reading all of them is a large
spend, so rather than sample at random I went at the practices that **already have
a type-01 fault** — faults cluster, and these clones were edited by the same hands.

That gives 32 candidate scenarios across eight practices. I read the two with the
strongest prior: Kind Dental's type 04 and type 06. Kind Dental's type-01 carries
three misdirected modules, more than any other practice.

**Both are clean.** Every sheet module in `4627528` (type 04) and `4627545`
(type 06) points at `1AyUqTch…`, Kind Dental's own stat sheet.

That is worth something. It suggests the misdirection is a property of **type 01**
rather than of the practice — which is plausible on inspection: type 01 is the
biggest scenario, eight sheet modules deep, and the one that has been revised
repeatedly. Types 04 and 06 have two or three modules and far less edit history.

**I stopped there rather than reading the remaining 30.** Two clean results against
the strongest prior in the set moves the expected yield low enough that the reading
cost is hard to justify without somebody deciding it is worth it. The list of 32 is
above if that decision goes the other way.

## Two real faults found on the way

**The dead second route in type 04 is in the template, not a one-off.** Abraham
Orthodontics and Kind Dental both have it: a router whose second branch filters on
`contact_source` containing `Second_consultation` and then writes the *same three
columns* to the *same row* as the unfiltered first branch. When the filter matches,
both fire and write identically. Two for two suggests all 57 carry it. It does no
damage — it just does nothing, while looking like it handles second consultations.

**Type 06 has at least two variants, and one of them mis-files second-consult
cancellations.** Abraham's (`3803591`) has a router: calendar name containing
"Booking Calendar" writes `C` into column J, "Second_consultation" writes `C` into
column K. Kind Dental's (`4627545`) has **no router at all** — one path, always
writing `C` into column J.

So at Kind Dental, cancelling a *second* consultation writes the cancellation into
the *first* consultation's show column, overwriting whatever was there. A second
consult that was attended and then had a follow-up cancelled would have its first
consult marked cancelled.

Which variant a practice has is not something you can see without opening it. Worth
knowing: the consolidated type-06 scenario has no such branch to get wrong, because
the Hub holds one row per appointment and the appointment id already says which
consultation was cancelled.

---

# Type-01 coverage is now complete

`scenario_sheet_targets` holds **56 scenarios, 398 modules, 57 distinct sheets**.
The three type-01 scenarios not in it are two clones of my own and Test Clinic, so
every real practice's booking scenario has now been read.

Seven of those 56 were a gap I had made: read during the routing work, used for
routing, never loaded into the audit. All seven are clean — a single spreadsheet
across every module, no padding, no read/write split.

**The findings did not move. Still 10, still the same five practices.** Across the
whole fleet of booking scenarios, misdirection is confined to Kind Dental, SMYLE
Dental Centers East Meadows, Team Dental Swedesboro, Dental Solutions and Eagle
Creek. That is now a complete statement about type 01 rather than a partial one.

---

# All 223 active scenarios, audited structurally, for no fetches at all

I had been about to read 226 blueprints to check types 02, 03, 04 and 06. That was
unnecessary. Make's **scenario list** already carries `usedModules` — the ordered
list of every module in a scenario with its package. It does not carry spreadsheet
ids, so it cannot find misdirection, but it finds something else: scenarios that are
**shaped differently from their siblings**, which is where behaviour diverges.

Grouping every active scenario by its module signature:

| Type | Active | Distinct shapes |
|---|---|---|
| 02 CCM Show Tracker | 55 | **1** — completely uniform |
| 03 CCM No Show Tracker | 55 | 2 |
| 04 Appointment Update Form | 57 | 2 |
| 06 Appointment Cancelled | 56 | **2, split almost evenly** |

## The one that matters: half the fleet mis-files cancelled second consultations

Type 06 exists in two shapes. Twenty-seven have a router that sends a cancelled
*first* consultation to column J and a cancelled *second* consultation to column K.
**Twenty-nine have no router at all** and write column J unconditionally.

Verified by reading two of them in full — Kind Dental (`4627545`) and Dental
Solutions (`4511141`). Both write `{"9": "C"}`, which is column J, First
Consultation Show. Two of two, and all 29 share an identical module signature.

So at these practices, cancelling a second consultation writes `C` over the **first**
consultation's show status. A patient who attended their first consult and later
cancelled a follow-up has their attended consult recorded as cancelled — which feeds
the show rate, and a show is the billable event.

Twenty-eight real practices (the twenty-ninth is Test Clinic):

Airway Orthodontics FL · GNV · NY · VT · All Dental of Menifee · Andros Orthodontics ·
Art of Smile · Best Care Dental · Cruz Orthodontics · Dental Illusions ·
Dental Solutions · Diamond Dental · Fiesta Orthodontics · Genuine Family Dentistry ·
Hancock and Johnston · Integrity Dental · Kind Dental · Kind Dental (GD) ·
Lompoc Family Dental · Magic Dental · Plano Top Dental · SMYLE Dental Centers ·
SMYLE East Meadows · Team Dental N. Liberties · Team Dental Swedesboro ·
The Smile Patio · Village Dental of New England (GD) · Z. Stanton Dental Care

The consolidated type-06 scenario cannot have this fault. A stat sheet holds one row
per patient, so the two consultations share a row and must be told apart by calendar
name; the Hub holds one row per appointment, so the appointment id already answers it.

## Two smaller outliers

**Type 04 — four practices have no router**: Anaheim Smile Center, Bling Dental, DNA
Dental Studio, The Dental Collective. Here the missing router is *harmless*, and
arguably better: the second branch in the other 53 writes the same three columns to
the same row as the first, so it does nothing. These four are the version without the
dead code.

**Type 03 — Anaheim Smile Center** is missing a `util:SetVariable2` the other 54 have.
Worth a glance; not obviously harmful.

## The method is worth keeping

`usedModules` from the scenario list gives a fleet-wide structural audit at no cost.
It cannot see spreadsheet ids, so it complements `scenario_sheet_targets` rather than
replacing it — one finds wrong destinations, the other finds wrong shapes. Between
them they cover the fleet without reading 226 blueprints.
