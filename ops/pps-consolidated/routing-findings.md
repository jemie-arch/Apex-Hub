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
