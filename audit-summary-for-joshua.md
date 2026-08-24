# PPS automation audit — plain-English summary

**For:** Joshua
**From:** Jemie
**Date:** 21 August 2026
**Full technical detail:** `earl-audit-findings.md` (34 findings, with evidence quoted for each)

Nothing was changed during this audit. Read-only throughout.

---

## The one-paragraph version

The new appointment-tracking setup is **throwing away roughly one booking in four**, and recording each one as a success. We can prove 11 lost bookings across 8 practices in the last five days. Separately, three practices' bookings are being written into **other practices' report sheets** right now. And 38 practices have tracking that is switched on but has never received anything at all. The good news: this started about five days ago, so the damage is small so far, and the fix is genuinely simple because all 45 copies are broken in exactly the same way.

---

## 1. What's actually broken

Think of the tracking system as a mailroom. A booking comes in from GoHighLevel, the mailroom is supposed to write it into that practice's report sheet, and that sheet is what we bill from.

The new version of the mailroom was given a rule: **"only accept a booking if it arrived with an ad tracking number attached."** Anything without one gets thrown in the bin.

The problem is that a huge share of real bookings don't have an ad tracking number:

- someone phoning the practice
- someone booking directly through the calendar link
- our own ISAs booking on a patient's behalf

All of those get binned. And here's the part that hid it from us: **the system then logs the job as "Success."** So the error count is zero, the dashboards look clean, and nothing ever complained. That's why this ran for days without anyone noticing.

**Measured result: 11 of the last 42 real bookings wrote nothing. That's 26% — about one in four.**

| Practice | Bookings received | Lost | Lost % |
|---|---|---|---|
| Singleton Smile Dental | 6 | **3** | 50% |
| Essex Dental Arts | 4 | **2** | 50% |
| Fiesta Orthodontics | 1 | **1** | 100% |
| Lightning Orthodontics | 1 | **1** | 100% |
| Village Dental of NE (GD) | 2 | **1** | 50% |
| Art of Smile | 4 | **1** | 25% |
| Lompoc Family Dental | 2 | **1** | 25% |
| Ultra Smiles Orthodontics | 4 | **1** | 25% |
| 10 other practices | 18 | 0 | 0% |
| **Total** | **42** | **11** | **26%** |

The practices at 0% aren't safe — they've just happened to receive only ad-attributed bookings so far. Every one of them has the same faulty rule.

## 2. This is new, and that matters

12 practices are still on the **older** version of the mailroom. That older version has no ad-tracking rule at all — it writes down every booking. **It loses nothing.**

So this isn't an old problem we've just discovered. A new template was built on 14 August, copied out to 44 practices between the 14th and the 18th, and the fault came with it. Everything went live around 17 August, which is why the losses all sit in a five-day window.

**Why that's good news:** we're five days in, not five months. And because all 44 copies came off the same template, they're broken *identically* — one corrected template fixes all of them the same way.

## 3. The thing I'd deal with today

Not the lost bookings — this:

**Three practices are writing their bookings into other practices' report sheets.**

| This practice's bookings… | …are landing in this practice's sheet |
|---|---|
| Kind Dental | **City Dental Centers** (and also Kind Dental GD) |
| Team Dental Swedesboro | **Team Dental N. Liberties** |
| SMYLE East Meadows | **SMYLE Dental Centers** |
| Stanton Dental Care | **OC Healthy Smiles** (its entire setup points there) |

This happens because when each copy was made by hand, someone had to retype which spreadsheet it writes to — and in these cases only *some* of the steps got repointed. The system's own labels say it out loud: Kind Dental's setup literally has "City Dental Centers – Stat Sheet" written on two of its steps.

Two of these are between **different brands** (Kind Dental → City Dental Centers, Stanton → OC Healthy Smiles), which isn't defensible under any reading. The other two are between sister locations of the same group, which *might* have been intentional consolidated reporting — but the mapping is half-done and lopsided, which no deliberate setup would look like. Worth a five-minute check with whoever set those up.

**Practical consequence:** some practices' numbers are inflated with another practice's patients, and some are missing their own. If we've billed off those sheets, the invoices are wrong in both directions.

There's also **Eagle Creek Dentistry**, where the setup checks one spreadsheet for duplicates but writes to a different one — so it can never spot a duplicate, and will keep adding repeat rows.

## 4. 38 practices are getting nothing at all

Of 57 practices with appointment tracking switched on, **38 have never received a single booking through it.** Not "some lost" — nothing, ever.

That's a worse and much quieter failure than the 26% loss, because there's no partial data to raise a question. It's split between 27 practices on the new setup and 11 on the old one.

The sister systems are worse still: the show tracker, no-show tracker, appointment-info form and cancellation tracker each have 31–50 practices in the same state.

I could not determine *why* from the Make side — the tracking is armed and waiting, so the likeliest cause is that the GoHighLevel workflow that's supposed to send the booking either isn't switched on or is pointing somewhere else. Confirming that needs GoHighLevel access we currently don't have (see §7).

## 5. Automated invoicing is entirely switched off

All four "Stripe Invoice Generation" setups are **inactive**, and one is flagged as broken. Nothing in Make is raising invoices for anybody.

If invoicing is being done by hand at the moment, that's fine — but it should be written down somewhere, because right now the system looks like it's handling it and it isn't. Related: a setup called "Total Billing per Client – Automation **(Draft)**" is switched **on** and listening to live Stripe events. Either it's finished and badly named, or it's unfinished and shouldn't be running.

## 6. On who did what — because the brief asked

The audit was framed as a review of Earl's work. The record doesn't support that framing, and I don't think it would be fair to let it stand.

**Since 1 July, edits to these systems split three ways:** Paolo Encisa 41, Ian Quizon 38, Earl 36. On 21 August — the day 40-odd copies were all edited at once — **Ian made 36 of the 53 edits and Earl made 16.**

What is fairly Earl's: he built the new template, so the faulty ad-tracking rule and the missing safety nets are his, and he created the copies that carry the cross-practice sheet mix-ups.

What isn't: the two most serious pre-existing problems — the dead invoicing, and a patient-privacy item I've kept out of this summary — both **predate his start**. Several other faults sit on setups where the system no longer records who made them, and I've said so rather than guessing.

He's also one month in, with no prior GoHighLevel experience, working on the same objects as two other people on the same day with no review step. The pattern here reads much more like a process gap than one person's carelessness.

**One practice worth stopping:** while debugging on 21 August, old bookings were "replayed" against **live practice report sheets** — 7 times by Earl, 2 by Ian. Some of those wrote real rows. A few duplicate lines in client sheets are from that, not from the tracking itself. Replays should never be run against live client data.

## 7. What I couldn't check, and why

I want to be straight about the size of this gap: **the GoHighLevel side is essentially unaudited.**

The automated connection we use to read GoHighLevel is dead — the token service is switched off, flagged broken, and its stored credential is empty. The alternative was to lift a login token out of the browser, which our security tooling blocked, and I didn't try to get around it. That left me clicking through the GoHighLevel screens one practice at a time, and those screens are built in a way that can't be read automatically — so I got through **1 practice out of 57** (Lightning).

So these questions are still open: which workflows are live vs sitting in draft, whether each practice's workflow points at the right destination, what's drifted between the master template and live practices, and what the ~75 custom patient fields actually look like.

**Fixing that connection is the single highest-leverage thing on the list**, because it unblocks all of the above.

What the one practice I did check turned up:

- Lightning's live booking calendar is literally named **`{{location.name}} Booking Calendar`** — a placeholder that never got filled in. It's been that way since December 2025.
- Lightning has **6 calendars**, at least two of them live and bookable, including a staff member's personal calendar. Our trackers only watch calendars whose name contains "Booking Calendar" — **a booking into any of the others is invisible to us entirely.**
- Lightning is set up on **both** the PatientSync and the non-PatientSync path at the same time, which contradicts how it's been described.

**Careful with that calendar name.** The trackers work today *by accident* — the broken placeholder name happens to contain the words "Booking Calendar," which is what they look for. Renaming it to something that doesn't contain those words will silently break the show and no-show tracking. Any rename needs to keep that phrase.

## 8. The money

**I can't give you a number, because the per-appointment rate isn't stored anywhere in Make or GoHighLevel — you'll know it and I don't.** The only figure I found was a single historic Stripe payment of $454.23 described as "Payment for Invoice," which is a monthly total, not a per-appointment price, so it can't be divided down.

The arithmetic, for you to fill in:

- **11 confirmed missed invoices** × your per-appointment rate = billed-short so far
- Continuing at 26%, roughly **1 in 4** of every future booking, until the rule is fixed
- Plus **38 practices** whose bookings may never have been billed at all — potentially the much larger number
- Plus wrong invoices in both directions for the four practices in §3

## 9. What I'd do, in order

| | Action | Why it's here |
|---|---|---|
| 1 | **Settle one question first:** is the tracker *supposed* to record every booking, or only ad-attributed ones? | Everything else depends on the answer, and I couldn't check it — the written guide isn't readable from where I sat. If ad-only is intentional, then §1 isn't a bug and we have a much bigger conversation about what we're billing on. |
| 2 | Fix the four cross-practice sheet mix-ups, and check those sheets for other practices' rows | Live now, client-facing, and affects invoices |
| 3 | Turn off the ad-tracking rule on the template and all 45 copies | Stops the losses. Genuinely a one-setting change, 45 times |
| 4 | Establish whether invoicing is being done by hand, then either switch the automation back on or document the manual process | We may be under-billing and not know |
| 5 | Repair the GoHighLevel connection | Unblocks the whole unaudited half of this |
| 6 | Work through the 38 dark practices | Needs step 5 first |
| 7 | Add safety nets (error alerts, keep failed records) | Without these, the next silent failure is just as invisible |
| 8 | Tidy up: test setups in the live account, leftover copies, four abandoned webhooks quietly filling up with data | Low risk individually — collectively it's why the real problems hid |

## 10. My one strategic recommendation

**Stop making copies.**

Right now there are 57 hand-made duplicates of the same logic, five families of them — 285 setups in total. Every fault in this report is one of two things:

- one bad template, copied 44 times *(the lost bookings)*
- someone retyping a destination by hand and getting it wrong *(the cross-practice mix-ups, the wrong-sheet lookups, 43 copies still labelled "Abraham Orthodontics")*

The only things that genuinely differ between those 45 copies are **the webhook address and the spreadsheet ID**. That's it. Everything else is identical.

So: **one** setup per family instead of 57, which looks up the right practice's spreadsheet from a list. **285 setups become 5.**

Rough cost: **11–12 days**, most of it repointing 57 GoHighLevel workflows. Patching the 57 copies in place is 5–7 days — but it re-runs the exact process that caused this (three people editing 45 near-identical copies by hand in one afternoon) and it'll produce a fresh crop of the same mistakes. The consolidation pays for itself the first time we onboard practice number 58.

---

### One item I've deliberately left out

There's a patient-privacy finding that I've kept out of this summary at Jemie's direction. It's written up in full as finding **F-08** in `earl-audit-findings.md`, §6. It is currently switched off and shows no record of ever having run, so it isn't an active incident — but it needs a decision from you rather than from us, and it predates Earl.
