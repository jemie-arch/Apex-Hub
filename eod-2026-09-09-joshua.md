# EOD — Wednesday 9 September 2026

For: Joshua
From: Jemie

## Headline

The pay formula is solved — I can tell you exactly how the dashboard calculates
commission and where it gets its numbers. The Make scenario that had been dead
for twelve days is live again, and it no longer depends on anyone's personal
login.

Pay is not reconciled yet, and one question stands in the way: a backlog of
2,507 calls drained into only 166 new rows. The good news is that the tab pay is
counted from is NOT a filtered subset — I checked, and the only exclusions are
four named test accounts. The bad news is that I cannot yet account for the
difference.

## Live on the Hub

- **Everything from yesterday is now deployed.** The CPL fix and the agent
  roster were committed but not pushed, so you were still looking at the old
  dashboard. That's live now.
- **Every call is attributed to a named agent.** 215 of 215 AI summaries and all
  12,729 raw call rows. The roster was missing eight people because I'd seeded
  it from a tab that only ever saw five — including **Ayanda Ndlovu, with 3,096
  calls and 82 bookings**, one of the two agents on the pay dashboard.
- **The AI sales audit data was there all along.** Grading, coaching and the
  SOP answer now populate **215 of 215** rows. It was a column-mapping failure,
  not empty cells. **Average grading: 3.94 out of 10** — the first real quality
  signal we've had, and worth a look before anyone tweaks those prompts.
- **The Hub now reads the tab pay is actually calculated from.** 12,729 rows,
  with patient names, emails and mobiles deliberately not imported — none is
  needed to count a booking.

## The pay formula, fully traced

Cell **J2** on STATS DASHBOARD:

```
COUNTIFS('RAW DATA'!C:C, <agent>, 'RAW DATA'!N:N, "*Booked*", <date bounds>)
```

Five branches on the A7 period selector, with offsets of TODAY() minus 1, 2, 6
and 29. Column C is the agent, column N is the disposition.

**That's why the Hub and the dashboard disagreed in opposite directions.** The
dashboard counts the RAW DATA tab; the Hub was counting the BOOKING SHEET tab.
Neither was miscounting — they were answering different questions about
different sheets, which is exactly why the gap had no consistent sign.

Commission, from O2 and the INPUT VALUES block: **under 96 bookings → $8 each,
under 128 → $10, otherwise $12** — a flat cliff on all appointments, not a
marginal tier. Those rates already matched what the Hub had stored, to the cent.
Nothing needed rebuilding; only the count was missing.

Also confirmed, and worth knowing: **Q2 (Profit) subtracts Comms and Salary but
not Bonus**, and **N2 pulls a monthly $800 salary into a row whose other figures
follow a rolling window**. Deliberate or not, they're what the sheet does.

## Make: fixed properly, not patched

Scenario 5560467 had been off since 28 August. Cause: it minted its own
GoHighLevel token using a Make connection **authorised by someone who has left
the company**. GoHighLevel now rejects it, and because Make deactivates
instant-trigger scenarios on their *first* error, the whole flow switched itself
off — taking the pay data with it.

It could not be reauthorised: the consent belonged to the departed person.

So it no longer uses that connection at all. It now asks the Hub for the token,
which holds the refresh token, rotates it in one place, and belongs to no
individual. One module changed; the two below it needed no edits.

Result: the 2,507-call backlog drained in 27 minutes, the scenario stayed up
throughout, nothing new parked in the error queue, and the `invalid` flag that
had persisted through every other fix **cleared itself on activation**.

## Two decisions I need from you

**1. Jennelyn Salazar and Erick Mendoza aren't on the pay dashboard.**

| Agent | Booked, last 30 days | On the dashboard? |
|---|---|---|
| Karol Sanchez | 54 | yes |
| Ayanda Ndlovu | 52 | yes |
| **Jennelyn Salazar** | **10** | **no** |
| **Erick Mendoza** | **6** | **no** |

Rows 4 to 6 are empty and the agent column is a FILTER over the INPUT VALUES
active-agent list, which names two people. So those 16 bookings are **never
paid** — about $128 in the current window. Are they still on commission, or off
the scheme deliberately?

**2. Where did 2,341 drained calls go?**

The 2,507-call backlog produced only **166 new rows**. I first thought a router
filter called "Denoise Data" was discarding them, and I have since read it. It
is not that:

    agent_name != Maricris Cofreros
    email      != mainexchange110@gmail.com
    agent_name != Joshua Jung
    agent_name != Alejandro Crespin
    agent_name != Megan Acapulco

Four named people and one email address — internal and test traffic. Nothing
about duration, disposition or volume. So RAW DATA is **not** a filtered subset
of real calls, and the pay dashboard is not counting a partial population. That
is the reassuring half.

The unexplained half: 166 rows from 2,507 records, with roughly 588 module-level
errors absorbed by the error handlers along the way. The only filters that do
gate anything sit on the transcription branch — a "> 2 minute call" test on the
download step, a 25MB size cap, and an "extracted data exists" check. **The
branch that writes the RAW DATA row has no filter at all**, so every non-test
call should have produced one.

Two possibilities, and I cannot separate them from outside Make: either those
four excluded agents accounted for the bulk of the backlog — which is plausible
if the window was mostly test traffic, and would mean nothing is wrong — or the
588 errors were the row write failing, in which case real calls lost their rows.
The execution history only retains the most recent runs, so the evidence has
already aged out.

What would settle it: whether anyone was deliberately generating test calls
under those four names between 28 August and 9 September. If yes, this closes.
If no, we have calls that vanished and I would want to know before trusting any
pay figure.

## Flags

**Your passwords have leaked.** Google sent a critical security alert overnight
saying saved passwords for your account were found online. Alongside the shared
password we already knew about and an API key sitting in plaintext inside a Make
blueprint, I'd treat this as the most urgent item here — ahead of pay.

**109 of 166 Make connections have no owner.** The person who created them is
gone from Make. **Fifteen are still in active use across 25 scenarios**,
including a **Stripe API key behind three of them** and an agency-level
GoHighLevel connection behind two. Every one can fail exactly the way today's
did. This is the decentralisation problem you named, with a number on it — and
the fix is that automations authenticate as a role account nobody personally
owns, not as whoever happened to build them.

**Make credits will be tight before the reset.** 8,967 left of 40,000, resetting
16 September. Today's drain cost 7,377. With the scenario now live and adding
roughly 540 a day on top of normal usage, that runs out around 15 September —
about a day short. Worth watching rather than discovering. Data transfer is also
on the board now at 3.70 GB of 21.5 GB, because each transcribed call moves
26–36 MB.

**Two new sub-account users were added to the agency on 8 September.** Given the
day we've had on departed-staff access, worth confirming those were you.

**31 August is still unexplained.** The Agent column on the booking sheet is
blank at source, not lost in our import. Your read — that it follows someone
leaving — fits the evidence, and it's the same root cause as the Make
connection.

## A correction, because it affected a number I gave you

I reported that the dashboard was underpaying Karol by about $88 because of
blank date cells. **Withdraw that.** I'd changed the import to read a second
date column, and that column follows a different date convention — it produced
70 rows dated in the future, and moved bookings between pay windows. Before I
touched it, the Hub and the dashboard agreed on Karol exactly: 54 and 54. I
broke a correct answer trying to improve it.

Reverted. The blank cells are real and they do cost money, but that's a defect
in the sheet to fix there, not something the Hub should guess at — so it now
reports them instead, and raises an error when a booking is affected.

## Tomorrow

- Confirm the revert restored the exact match on Karol.
- Account for the 2,341 drained calls that produced no row. The Denoise filter
  is ruled out; the remaining suspects are test traffic under the four excluded
  names, or the row write failing 588 times.
- Mark Ad Account 13 as internal hiring spend so it stops dragging fleet CPL.
- PPS 0 Error System, due 11 September. The groundwork is there; it needs your
  authorisation to activate 5 consolidated scenarios and someone to verify 43
  sheet-to-practice mappings.

Still blocked: **Closebot B2C Texting**, also due 11 September. I need to know
what "complete automations in blue" refers to — I can't see the colour coding
and I'd be inventing the requirement.
