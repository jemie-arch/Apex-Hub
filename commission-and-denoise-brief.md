# For the next meeting: commission timing, and what "Denoise Data" does

Two items Joshua asked about on 10 September.

---

# 1. Commission payout timing

> *"we should collaborate to time when the auto commissions should be paid out.
> Im not sure if this payout in question was already disbursed or not"*

## The short answer to "was it already disbursed"

**Nothing can tell us, because nothing has ever recorded it.**

The Hub has fortnightly payout periods going back to May. Every single one is
`open`, unlocked, with **zero lines and $0.00**. And the payout table it does
have is about tracked hours, not commission.

So there is no system of record for commission anywhere. That is not a gap in
the Hub's reporting — it is the reason the question is unanswerable, and it will
stay unanswerable for every future payout until something records them.

**Anything we conclude about past payouts has to come from bank records or from
whoever actually sent the money.** I can't reconstruct it.

## The thing to settle before choosing a cadence

The dashboard and the pay periods measure different lengths of time, and they
are not compatible.

- **The dashboard pays on a rolling 30 days.** Cell O2 multiplies J2, and J2
  with A7 set to "Last 30 days" counts the last thirty days.
- **Pay periods are 14 days.**

Consecutive 30-day windows overlap by 16 days. So paying the number on screen at
each fortnightly pay date pays most bookings **roughly twice**.

Here is what that looks like with real numbers:

| Pay period | Karol | Ayanda |
|---|---|---|
| 1 – 14 Aug | 47 | 36 |
| 15 – 28 Aug | 37 | 39 |
| 29 Aug – 11 Sep *(current)* | **4** | **6** |
| | | |
| **Dashboard shows today (rolling 30d)** | **54** | **52** |

Karol has **4 bookings in the period being paid** and a screen showing **54**.
If the last three pay dates had each paid the displayed figure, we'd have paid
for roughly 150 bookings against 88 that actually happened.

## The thresholds have the same problem

The quota cliffs are **96** and **128** bookings.

The best fortnight any agent has ever recorded is **47**.

So on a fortnightly basis the $10 and $12 rates are not merely unmet, they are
**arithmetically unreachable**. Joshua noted that nobody has hit the additional
tier KPIs yet. That may not be a performance story at all — it may be a
threshold written for one window being applied to another.

Even monthly, 96 is close to double anyone's current 30-day count.

## What I've built for the conversation

`v_commission_by_period` calculates commission on bookings that fall **inside**
each pay period — the only basis that cannot double-pay — and flags when a
period is too short for the quota to be reachable.

It deliberately does **not** decide the cadence or restate the thresholds. Those
are yours. This exists so the decision has numbers behind it.

## What I'd want decided

1. **Basis** — pay on bookings within the pay period, not on a rolling window.
   Everything else follows from this.
2. **Cadence** — if the thresholds stay at 96/128, the natural period is monthly
   or longer. If fortnightly payment matters, the thresholds need halving to
   roughly 48/64 to mean the same thing.
3. **Record-keeping** — whatever is decided, each payout needs writing down, so
   this question is answerable next time. That's a small build once the basis is
   agreed; I've deliberately not guessed at it.
4. **Two agents currently earn nothing** regardless of the above: Jennelyn
   Salazar and Erick Mendoza have bookings, but the dashboard's agent list names
   only two people, so they never appear. Currently $80 and $48.

---

# 2. What "Denoise Data" does

> *"show me what you mean by Denoise data during our next meeting"*

It's a filter on the router in the call-transcription scenario — the first thing
every incoming call hits. If a call fails it, **nothing downstream runs at all**:
no RAW DATA row, no transcript, no contact note.

Here it is, verbatim from the blueprint:

```
Denoise Data
    agent_name  ≠  Maricris Cofreros
    email       ≠  mainexchange110@gmail.com
    agent_name  ≠  Joshua Jung
    agent_name  ≠  Alejandro Crespin
    agent_name  ≠  Megan Acapulco
```

All five must be true for the call to proceed.

## What that means in practice

It excludes **four named people and one email address** — internal and test
traffic. There is nothing in it about call length, disposition, practice or
volume.

**The good news:** RAW DATA is *not* a filtered subset of real calls. I had
worried it might be, which would have meant the pay dashboard had always
calculated on partial data. It hasn't.

**The thing worth a decision:** it hard-codes **Joshua Jung** as test traffic.
If you take real calls, none of them has ever reached RAW DATA, and none has
ever been paid. Same for the other three if any of them does real work now — the
filter was written at a point in time and nothing revisits it.

## Where the rest of the pipeline filters

For completeness, these sit further down and only affect the transcription
branch — **not** the RAW DATA row that pay is counted from:

| Step | Filter |
|---|---|
| Download recording | `call_duration >= 120` — calls under 2 minutes are never transcribed |
| Transcribe | file must be under 25 MB |
| Write to contact | extracted data must be non-empty |

That 2-minute rule is why most calls cost 2 Make credits and a few cost 13.

## The open question this leaves

A backlog of **2,507 calls produced only 166 rows**. The Denoise filter is not
big enough to explain that on its own unless those four excluded names generated
the bulk of the traffic between 28 August and 9 September.

**So: was anyone deliberately making test calls under those names during that
fortnight?** If yes, this closes completely. If no, calls went missing and no
pay figure should be trusted until we know why. Make's execution history has
already aged out, so this is a question for people rather than logs.
