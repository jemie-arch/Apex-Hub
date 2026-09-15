# PPS auto-charge rules and ISR commission — as Joshua stated them

Source: two Loom walkthroughs relayed by Jemie on 15 September 2026. Each rule
below is Joshua's, restated once and then held against what the Hub actually
does. Where his wording admits two readings, both are written down and **nothing
is encoded** until he picks one. This is billing and pay; a guess here is money
taken or withheld from a real person.

Nothing in this document has been implemented. It is the specification to build
against, and the list of what must be answered first.

---

## Part 1 — What triggers an automatic charge

The Hub's billing model today is one rule: **a consultation that showed becomes
`billable`, and becomes `billed` when a Stripe charge is matched to it.** States
`waived`, `disputed` and `on_hold` exist for a human to set, and no row has ever
held one. None of the three rules below exists anywhere in the Hub.

### Rule 1 — Direct clinic call

**Joshua:** during onboarding every practice is told that when a lead books
directly with the practice, the practice must mark it in the reporting dashboard
(moving to the Hub). If we later discover a lead booked directly and the practice
did *not* mark it, the practice is charged for that appointment — they did not
follow the system.

**Applies to:** Lompoc Family Dental and every client signed **after** Lompoc.
Earlier clients are exempt until Joshua has spoken to each of them; he intends to
make it universal but has not yet.

**The signal already exists — in about a dozen spellings.** `lead_source` on the
stat sheets carries the practice's own record of direct bookings:

| `lead_source` value | Rows |
|---|---|
| Direct Clinic Booking | 9 |
| Client Reporting Dash - Direct Call Patient Bookin… | 7 |
| Direct Clinic Call | 5 |
| FB - Direct Booking | 5 |
| Booking Directly with Clinic | 4 |
| Client Reporting Dash - Direct Call Patient Booking Request | 4 |
| Booked directly with the clinic / with Clinic | 6 |
| Direct Clinic Call/Booking - Need these tracked by TSL staff next time | 2 |
| Direct Booking · GD Patient / Direct Call · IG - Direct Booking | 4 |

Roughly 45 rows. These are the ones the practice **did** mark — so under Rule 1
they are the *non*-chargeable cases. The chargeable case is the inverse: a lead
we learn booked directly (from the patient, on a call) with **no** such marking.
That second half has no structured signal today; it lives in call transcripts
and ISR notes.

**Gap that blocks encoding:** the Hub has no signup date. `client_groups` has
`onboarding_stage` but no *signed-on*; `created_at` is 21 August 2026 for every
group because that is when the Hub was built. "Lompoc and after" needs either a
`signed_on` column populated from the contracts, or a list from Joshua of which
clients the rule applies to.

### Rule 2 — Reschedule not reported

**Joshua:** when a practice reschedules a patient, it must tell us through the
reschedule system (it posts to Slack; we then move the appointment and the
new-patient tracker fires on the new date). If the practice reschedules and does
**not** tell us, the tracker fires on the old date, the practice marks it
"rescheduled" on the form — and that is how we know they bypassed the system.

**Both conditions must hold** for a charge:
1. **No** reschedule notification reached us (dashboard / Hub / Slack), **and**
2. We learned of the reschedule from either the returned tracker form **or** the
   patient telling us directly.

If they *did* notify us and we failed to act, that is our fault and there is no
charge.

**Signals that exist:**
- `first_consultation_show` = `R` — 4 rows. Presumably "rescheduled"; the legend
  is on the template sheet, not confirmed.
- `first_consultation_show` = `C` — 86 rows. Presumably "cancelled"; same caveat.
- `outcome_notes` mentioning "reschedul" — 48 rows.
- `appointment_ledger.reschedule_of` links reschedule chains — the Hub already
  tracks the *chain*, just not who initiated it or whether we were told.

**Gap that blocks encoding:** condition 1 needs a record of *what the practice
told us and when*. The reschedule form posts to Slack; the Hub does not capture
it. Without that, "they did not notify us" is the absence of a record, and
[[evidence-of-absence-discipline]] says an absence is not a finding.

### Rule 3 — "Three days, no more, auto-charge"

**Joshua's exact words, 3:46:** *"Three days, no more, auto-charge, pretty
basic as well."*

**Two readings, and they charge different people:**
- **(a)** A patient who no-shows **three times** is charged regardless.
- **(b)** A no-show unresolved for **three days** — not rescheduled, not
  disputed — is charged.

The stat sheets show 199 `N` (no-show) rows and the ledger 434. The Hub has a
`no_show` outcome and `attempt_number` on the ledger, so **either** reading is
computable once chosen. Neither should be built until it is.

### What Joshua asked for alongside

A written SOP so practices use the dashboard properly — *"I don't want to be
explaining that over and over again."* The Hub's client portal now has the
outcome form and support thread; the reschedule notification is the missing
piece, and it is exactly the piece Rule 2 depends on.

---

## Part 2 — ISR commission and qualification

### What the commission sheet describes

From Joshua's walkthrough of the sheet (the sheet itself has not been read —
see the brief at the end):

| Element | Joshua's description |
|---|---|
| **Tiers** | Three, set by appointments booked **per day** and **per month** |
| **Paid on** | **Shows**, not bookings — "we only get charged when the patient shows up" |
| **Show-rate gate** | 80% show rate to qualify for a tier |
| **Base wage** | Yes, on the sheet |
| **Daily bonus** | 5/day → $10 · tier 2 → $20 · tier 3 → $30. Tier 3 every day for 20 days = $600 |
| **Weekly bonus** | Exists on the sheet; not described |

The daily bonus matches what the Hub already holds:
`app_settings.isa_commission_scheme` → `tier1/2/3Bonus` = 1000 / 2000 / 3000
cents at thresholds 5 / 6 / 8. That part agrees.

### Where the Hub disagrees with the sheet

The Hub's live commission path (`v_agent_commission`, `/call-center/commission`)
reproduces the STATS DASHBOARD tab: **a flat rate per booking**, $8 / $10 / $12,
cliffed at 96 and 128 bookings over a rolling 30 days. That is what the
spreadsheet the agents are actually paid from computes.

Joshua's sheet pays **per show, tiered by monthly volume, with an 80% show-rate
gate and a base wage.** These are two different schemes, and the Hub currently
encodes the one people are being paid on, not the one Joshua describes as the
rule. Which is authoritative is his call, not a data question.

### The change Joshua is open to

Paying on shows has a real problem he named: an ISR who books a patient for a
month out cannot be paid until then, which *"fucks up the tier system for them"*
and discourages booking. He said, verbatim, he is *"completely fine"* with:
- paying **monthly**, or
- paying on **booking** with a hard rule and coaching to book patients soon,

if paying-on-show is too hard to automate. **It is not too hard to automate.**
The Hub already knows shows per agent per day. The question is which he wants,
and the trade is: pay-on-show is accurate but delayed; pay-on-booking is prompt
but pays for no-shows. This should be his decision, made once.

### Qualification — the deduction that is not yet buildable

**Joshua:** an ISR must qualify the patient against **"the 7 points of a
qualified patient"** (in a meeting-recap document). The AI transcriber should
tag calls where the ISR did not, and the deduction reduces commission.

Two things are needed and neither exists in the Hub:
1. **The 7 points themselves** — in the meeting recap sheet, not yet read.
2. **A per-call qualification tag** from the transcriber. The call-summaries
   sync already stores grading, coaching and an SOP answer for 215 calls
   (average 3.94/10). The transcription prompt would need the 7 points added to
   emit a pass/fail per point.

The repo already records (in `src/config/isa-commission.ts`) that the penalty
half — 2 units per unqualified booking, 5% monthly cliff — is **deliberately not
implemented** because "which disqualifications count" was undefined. The 7
points are the definition it was waiting for.

---

## What must be answered before anything is built

| # | Question | Who | Blocks |
|---|---|---|---|
| 1 | Rule 3: three **no-shows**, or three **days** unresolved? | Joshua | Rule 3 |
| 2 | Which clients does Rule 1 apply to? (No signup dates in the Hub) | Joshua | Rule 1 |
| 3 | Pay on **show** or on **booking**, and fortnightly or **monthly**? | Joshua | All commission |
| 4 | Is the commission **sheet** or the **STATS DASHBOARD** authoritative today? | Joshua | Whether current pay is wrong |
| 5 | The 7 points of a qualified patient | meeting recap doc | Deductions |
| 6 | Legend for `C` and `R` in the show column | template sheet | Rule 2 |

Items 5 and 6 are documents; the rest are decisions.

## What can be built without waiting

- **Normalise `lead_source`** — a dozen spellings of "booked directly" into one
  flag. Pure cleanup, no policy, and it is the input to Rule 1 either way.
- **A reschedule-notification record.** Capture the reschedule form's Slack post
  into the Hub so "did they tell us" becomes a lookup rather than an absence.
  This is the prerequisite for Rule 2 and it is also the SOP Joshua wants.
- **Add the 7 points to the transcription prompt** the moment they are known.
  The pipeline is already there.
