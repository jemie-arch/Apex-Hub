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

# Has any of it actually executed?

The reconciliation page says plainly that a wrong-target finding proves the
configuration is wrong and not that rows have moved, and that Make's execution
list cannot settle it. That is correct. But there is a second place to look.

Every booking row carries the GoHighLevel **location name** into column R. So a
row sitting in one practice's tracker while naming a different practice is a write
that happened. `tracker_foreign_rows` is that check, over all 1,281 tracker rows —
every one of which has the field populated, so a clean result means something.

## What it found

| Sheet | Row says it came from | Rows | Period |
|---|---|---|---|
| TMJ Sleep Airway Orthodontics - Williston | Airway Orthodontics - VT | 15 | Apr–Jun |
| TMJ Sleep Airway Orthodontics - Gainesville | Airway Orthodontics - GNV | 10 | Jun–Jul |
| TMJ Sleep Airway Orthodontics - New York | Airway Orthodontics - NY | 1 | Apr |
| Art Of Smile: Center for Cosmetic Orthodontics | Art of Smile | 22 | May–Aug |
| Team Dental N. Liberties | Team Dental N. Liberties Apex | 5 | May–Jul |
| Team Dental Swedesboro | Team Dental Swedesboro Apex | 3 | Jun–Jul |
| **Kind Dental** | **Kind Dental (General Dentistry)** | **1** | **20 Aug** |

Six of the seven are **one clinic under two naming conventions** — the Hub and
GoHighLevel simply disagree on what to call it. Nothing is misrouted.

Those six are also **independent corroboration of the six inferred routing rows**
filed earlier. I matched "Airway Orthodontics - GNV" to Gainesville by reading an
abbreviation; the tracker shows GNV-labelled bookings physically landing in the
Gainesville client's sheet, from a source that had nothing to do with how I
matched them. Those proposals are now considerably better than a good guess —
though somebody should still open the sheets before ticking them off.

**One entry is a real cross-account write:** a booking from Kind Dental (General
Dentistry) sitting in Kind Dental's tracker, 20 Aug. One row. The direction is the
*reverse* of the configured fault the audit found — the audit shows Kind Dental's
module 15 writing into the GD sheet, and this row went the other way. So either the
GD scenario has its own misdirect that has not been audited, or the two accounts
share something upstream. One row, but worth ten minutes.

## What this does not prove, and I want to be exact

**City Dental Centers has 170 tracker rows, all carrying a location name, and zero
foreign.** So no Kind Dental booking has been *appended* to City Dental's sheet.

That is not the same as City Dental's sheet being uncorrupted, and the difference
matters. Kind Dental's two misdirected modules are `updateRow`, not `addRow`. An
updateRow writes one cell into an existing row, addressed by a row number worked
out against a *different* spreadsheet — so it overwrites whichever City Dental
patient happens to occupy that row number, and changes no name. This method is
blind to that by construction.

Answering it needs the spreadsheet's own revision history, which is outside
anything I can reach. Flagging it rather than reporting City Dental clean.
