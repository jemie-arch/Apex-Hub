# Week in review — 8 to 11 September 2026

Prepared for the team meeting. Everything below is verified against the live
systems, not from memory.

---

## Against the priority list

| Priority item | Due | Status |
|---|---|---|
| **PPS 0 Error System** | 11 Sep | **Infrastructure done.** Cutover not started — see below |
| **Closebot B2C Texting** | 11 Sep | **Dropped.** Joshua confirmed it was completion tracking used with Ian, Earl and Pao |
| **Client Portal Completion** | 15 Sep | **Not started.** The only item with a live deadline and no work against it |
| **Call Center Role Efficiency** | 8 Sep | **Done and live** |
| Daily HotProspector stats *(new, from Joshua)* | — | **Built and live**, 10 of 17 columns |
| Commission payout timing *(new, from Joshua)* | — | **Analysed**, needs a decision from him |
| Ad Account 13 *(new, from Joshua)* | — | **Done** |

---

## What is now live

**The call centre has a working system in the Hub.** 12,729 calls imported, all
attributed to a named agent, refreshed five times a day.

- **215 AI call transcripts** with summaries, coaching, grading and SOP answers.
  The grading and SOP columns had been written to a sheet for months and nothing
  had ever read them. **Average grading: 3.94 out of 10** — the first quality
  signal we have ever had on calls.
- **A team board** reproducing HotProspector's stats, computed from our own call
  feed rather than scraped, so it and agent pay cannot drift apart.
- **Commission per agent**, calculated exactly the way the pay dashboard
  calculates it.
- **Every call attributed.** The roster was missing eight people, including
  Ayanda Ndlovu with 3,096 calls and 82 bookings — one of the two agents the pay
  dashboard actually pays.

**Agent pay is solved as a formula.** Nobody knew how the dashboard calculated
commission. It is now traced end to end: bookings counted off the RAW DATA tab
where the disposition contains "Booked", then a flat cliff rate — under 96
bookings $8 each, under 128 $10, otherwise $12. The Hub already held those rates
correctly; only the count was missing, and the count was missing because the Hub
was counting a different tab from the one the dashboard counts. That is why the
two disagreed in opposite directions for weeks.

**Cost per lead is honest now.** Campaign-level CPL was wrong and is no longer
shown. Client-level CPL is correct: Singleton $39.96, Village $67.92, fleet
$43.04 over thirty days.

**PPS routing is published.** 48 of 49 clinics now route from a lookup instead of
a spreadsheet id pasted inside 56 cloned scenarios. Kind Dental's 27 billed
consultations with zero appointments is resolved.

---

## What we found that nobody was looking for

**109 of 166 Make connections have no owner** — the person who created them has
left. Fifteen are still in active use across 25 scenarios, including a **Stripe
API key behind three of them**. Every one can fail the way the GoHighLevel
connection failed on Tuesday, which took the call transcription offline for
twelve days.

**Two agents are earning commission nobody pays them.** Jennelyn Salazar and
Erick Mendoza have bookings, but the pay dashboard's agent list names only two
people, so they never appear. About $128 in the current window.

**Paying the dashboard figure fortnightly would pay most bookings twice.** It
shows a rolling 30 days; pay periods are 14. Karol currently has 4 bookings in
the period being paid and a screen showing 54. And nothing has ever recorded a
commission payment, which is why nobody can say whether a given payout was made.

**The quota thresholds may be unreachable rather than unmet.** 96 and 128
bookings, against a best fortnight on record of 47.

**A practice was dark for ten days and nobody noticed.** Dental Illusions'
webhook was half-edited on 1 September and pointed nowhere. It cost no bookings
— that practice books about two a month — but nothing alerted anyone.

**Credentials.** A HotProspector API key sits in plaintext inside a Make
blueprint, readable by anyone who can export it. Google also flagged that saved
passwords for the account were found online.

---

## Corrections I made to my own work

Recording these because the numbers were quoted in earlier updates.

- I said the dashboard underpaid Karol by about $88. **Withdrawn** — my own date
  change had broken a match that was already correct.
- I said ten days of Dental Illusions bookings were lost. **Wrong** — the
  practice had no bookings; the Hub and its sheet agree at two.
- I said the Make queue cost us 391 items of retry work. **It was 37.**
- I said the backlog drain would cost ~18,000 credits. **It cost 7,377** — my
  estimate had priced every run at the cost of the failures.
- I said the call board's rate definitions were confirmed. **The formulas were;
  the inputs were not**, and I ran those together.

---

## What needs a decision, not more work

1. **The stat sheets.** Retiring the 216 per-practice scenarios is the rest of
   PPS. Confirmed this week that the consolidated scenario writes to the same
   sheets, so nothing goes stale — but it is 55 practices of one-field edits.
2. **Commission cadence.** Pay on bookings inside the pay period, not a rolling
   window — and either move to monthly or halve the thresholds to roughly 48 and
   64.
3. **Are Jennelyn and Erick still on commission?**
4. **Was anyone making test calls** under four specific names between 28 August
   and 9 September? That is the last thing between agent pay and being
   trustworthy.
5. **Who owns the tracker's campaign ID column?** It stamps other practices'
   campaign ids onto leads, which is why campaign-level CPL is unavailable.

---

## Immediate risks

- **The leaked passwords.** Untouched since Tuesday, and the only item where
  waiting makes it worse rather than just later.
- **The HotProspector key**, still in plaintext.
- **Make credits.** 8,967 left of 40,000, resetting 16 September. Joshua's
  answer — delete the scenarios we do not need rather than upgrade — is the
  right one, and the ownerless-connection audit is the shortlist.
- **Client Portal, due 15 September**, with nothing done against it.
