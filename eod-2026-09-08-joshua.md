# EOD — Tuesday 8 September 2026

For: Joshua
From: Jemie

## Headline

The client fulfilment tracker and the call centre system are live on the Hub.
The Make side of the call centre is not, and the reason turned out to be
different from what we thought — detail below, and there are two decisions I
need from you.

## Live on the Hub

- **Client fulfilment tracker** — populated and backfilled, not just the
  current window. Leads, appointments and the booking sheet all import.
- **Cost per lead** — stable at $34–36 across the last five weeks. Twelve ad
  accounts are mapped to practices **by campaign id**, not by name; name
  matching would have misassigned five practices.
- **Appointment ledger** — 2,648 rows, one per appointment. Invoiced totals
  untouched at $66,124.81.
- **Call centre** — 215 AI call transcripts and summaries, per-agent call
  efficiency, and callback-request SLA measurement.
- **Agent attribution** — every one of the 215 summaries is now attached to a
  named agent: Karol Sanchez 128, Jennelyn Salazar 68, Joshua Jung 9, Maricris
  Cofreros 6, Susana Mariaca 4. Two things worth knowing. "Joshua Jung" is you —
  your Hub profile is named just "Joshua", so the two never matched, and those
  9 calls were sitting unattributed for that reason alone. And the four agents
  are on a roster rather than being given Hub logins: a Hub profile needs a
  login account and a unique email address, and I was not going to invent email
  addresses for real people to satisfy a foreign key. If you want any of them
  able to sign in and see their own scoreboard, send me their email address and
  it links to their existing history with no rework.

On the **leads vs GoHighLevel** discrepancy you flagged: it had concrete
causes, not a methodology disagreement. The contact sync was reading 7,966
contacts and writing none — a pagination bug where the GoHighLevel contacts
endpoint pages by page number, and we were sending a cursor as well, which it
rejects outright. Internal ADM accounts were also being counted as client
leads, and some contacts appeared twice. All three are fixed and the figures
now reconcile.

Two things the transcripts turned up that nobody had asked for: the AI sales
audit has been writing a **1–10 grading** and a **"call process followed?"**
answer into the sheet for months, and nothing had ever read them. Per agent
those say more than any call counter. They're now in the Hub.

## Two decisions I need from you

**1. The Make transcription scenario — which pipeline do we restore?**

Scenario 5560467 holds two pipelines and only one is connected to the trigger:

- *Connected:* webhook → RAW DATA row → OpenAI transcription → writes the
  transcript into the GoHighLevel contact → Slack.
- *Orphaned:* HotProspector → AssemblyAI → six GPT calls → **writes the CALL
  SUMMARIES tab** → Slack. Fourteen modules, detached from the trigger.
  Detached modules never run.

The Hub reads CALL SUMMARIES. That tab is written only by the orphaned chain,
which is why we have 215 transcripts and no more. Restarting the scenario will
**not** add a 216th.

Options: reconnect the orphaned chain to get the coaching and grading text
back (costs an AssemblyAI upload and six GPT completions per call), or point
the Hub at RAW DATA, which the connected chain already writes and which
carries agent name, duration, disposition, direction and status — one row per
call, live, but no transcript or coaching. My recommendation is both, RAW DATA
first, because it needs no Make editing.

**2. Ad Account 13 (`1522430326001923`)** — 119 of 157 fleet leads run through
it and it cannot be mapped to a practice from the data. I need you to tell me
which practice it belongs to.

## Blocked on one cell

Agent pay reconciliation. The Hub and the call centre dashboard disagree in
**opposite directions** for the same two agents, so it isn't the date window.
I need the formula in **cell J2** ("Booked Appts") on the dashboard. One cell
unblocks it.

For reference, the dashboard pays on a rolling 30 days (A7 is `TODAY()-29`),
commission only, `J2 < 96 → J2 × 8`. The 96/128 quota rates at $10/$12 have
never actually been paid to anyone.

## Flags

**Something broke on 31 August.** The Agent column on the booking sheet stopped
being filled. Before that date 6.7% of bookings were unattributed; since, it's
81.5% — roughly 44 bookings, about $352 in commission unpaid and growing daily.
Worth finding out what changed on that date, because it's still happening.

**A live credential is sitting in a Make blueprint.** An orphaned module in
5560467 carries a HotProspector API user id and key as plaintext in the request
body. Anyone who can read or export that scenario has them. They need rotating.

**A second scenario is dead and nobody had noticed — and it's a one-line fix.**
5539931 "CCD - Call Center Dashboard HP->Sheets->Slack" writes the APPOINTMENT
DATA tab and eleven Slack alerts. It's failing on a dead image URL in one Slack
image block: `invalid_blocks … downloading image failed`. Not a connection
fault. Replacing that URL should bring it back. Nine PPS per-practice scenarios
are also inactive and invalid.

**Make's incomplete-execution queue is full, and it's 37 items doing it.**
Thirty-seven parked bundles from 25–28 August total 498.2MB of the
organisation-wide 500MB limit, which is shared across all 337 scenarios. Until
it's cleared, any active scenario that errors loses its bundle instead of
holding it for retry — and there is no storage indicator anywhere in Make's UI,
so nothing warned us. Clearing needs the UI; there's no API for it.

**A second queue: 2,268 webhook records.** That many calls have arrived while
the scenario sat inactive, and they all flood in on activation. Costed against
a 48-run sample they average 2.6 credits each — most calls have no recording
and cost 2 credits to log, only a minority get transcribed — so the backlog is
about **5,900 credits against 17,063 left** in the period. Affordable, and it
backfills eleven days of call history. Activation still needs sequencing rather
than just clicking, because the queue has to be cleared first or the first error
switches the scenario straight back off.

**Also:** the shared password `Apexdental1234` should be changed.

## Tomorrow

- Point the Hub at RAW DATA for live per-agent call data.
- Backfill the 23-day Windsor impressions gap.
- ~~Create Hub profiles for the call centre agents~~ **done**, and it was five
  names rather than six. All 215 call summaries now attribute to a named agent;
  none are unattributed.
- Chase 31 August.
