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
