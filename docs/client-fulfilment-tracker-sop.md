# Client Fulfilment Tracker — SOP

How it is built, how to add a client, and how to work out what is wrong when a
number looks off.

Last updated 14 September 2026.

---

## 1. Where it is

**Dashboard → Client Fulfilment Tracker** (second tab), or go straight to
`/dashboard?tab=tracker`.

It is also listed in the left menu under Dashboard. It was not, until 14
September, which is why it was reported missing for a week — it existed as a tab
with no menu entry.

Three controls, matching the spreadsheet's own:

| Control | Options | Note |
|---|---|---|
| **Window** | 3 / 7 / 30 days | Counts are summed over the window, then divided |
| **Breakdown** | Campaign or Client | Some columns are unavailable per campaign — see §4 |
| **Client** | One, or all | |

All three live in the URL, so a view can be pasted to someone and they see the
same screen. Sorting is in the URL too.

---

## 2. What it is made of

Nothing in the tracker is typed in. Every figure is computed from feeds that
sync on a schedule, through two database views.

### The two views

| View | Grain | Supplies |
|---|---|---|
| `v_cft_stats_dashboard` | client × campaign × day | Spend, leads, appointments, outcomes |
| `v_cft_call_daily` | client × day | Everything in the call block |

They are **unioned, not joined**. A client that appears in one and not the other
still gets a row. Joining them would silently drop practices — eight of them, at
the time it was written.

### The feeds behind them

| Feed | Sync job | Writes to | Supplies |
|---|---|---|---|
| Meta ads, via Windsor | `windsor-ads` | `ad_level_insights`, `campaigns`, `ads` | Spend, impressions, clicks |
| Tracker sheet — leads tab | `fulfilment-leads` | `tracker_leads` | Leads |
| Tracker sheet — appointments | `fulfilment-tracker` | `tracker_appointments` | Appointments, shows, DQs, closes |
| CRM appointments | `crm-appointments` | `appointments`, `appointment_ledger` | Appointments the sheet never recorded |
| CRM calls | `crm-calls` | `calls` | Dials, pickups, talk time, speed to lead |

### When they run

| Schedule | What |
|---|---|
| `0 6 * * *` | `sync-all` — every feed above, in dependency order |
| `0 18 * * *` | `crm-appointments` again |
| `0 13,16,19,22 * * *` | `raw-call-rows` (call centre, not this tracker) |

Order inside `sync-all` matters: `crm-clients` runs first so a new practice has
a client row before anything tries to attach data to it.

### The one rule that governs every number

**Aggregate first, then divide.** No view stores a percentage. Counters are
summed across the whole window and only then divided.

Averaging a ratio across days gives the wrong answer whenever the days differ in
volume: a day with 1 lead and a day with 99 do not contribute equally to CPL,
but a mean of two CPLs treats them as though they did.

---

## 3. The columns, and where each one comes from

### Campaign information (A–F)

| Column | Source |
|---|---|
| Notes | Not stored. Always blank |
| Status | `clients.is_active` → Active / Paused |
| Client Name | `clients.name` |
| Campaign Name | `campaigns.name` |
| Campaign ID | The sheet's campaign id |
| Offer Name | Most common offer on that client's appointments |

### 1. Ad data (G–I)

| Column | Formula |
|---|---|
| Amount Spent | Σ `spend_cents` from Windsor |
| Leads | Greater of Windsor's lead count and the tracker's |
| CPL | Spend ÷ Leads |

**CPL is blank, not zero, when no spend is recorded.** Spend of zero against 30
leads does not mean the leads were free — it means no spend was recorded for
that campaign. £0.00 per lead is the most flattering possible lie.

### 2. Call data (J–O) — client grain only

| Column | Formula |
|---|---|
| Number of dialed calls | Outbound calls |
| Calls 2+ minutes | Calls of 120s or more, **both directions** |
| Speed To Lead | Average minutes from lead to first call |
| Pickup % | Outbound calls **with talk time** ÷ dialed |
| Conversation % | Outbound calls 2+ min ÷ dialed |
| Dials per Lead | Dials ÷ leads |

**Pickup % diverges from the spreadsheet deliberately.** See §6.

**Speed To Lead excludes anything over 24 hours**, and the count it was measured
on is shown beside it. A large excluded bracket means stale lead timestamps, not
a slow team.

### 3. Appointment data (P–W)

| Column | Formula |
|---|---|
| Appointments Created | All appointments, both feeds |
| Appointments To Be Taken | Those with no outcome yet |
| Last Appt Date | Latest appointment date |
| Schedule % | **Tracker** appointments ÷ leads |
| Shows / No Shows / Cancels | From the appointment's status |
| DQ % | DQs ÷ appointments created |
| Cancel % | Cancels ÷ appointments created |
| Show % | Shows ÷ appointments created |

**Schedule % uses a different numerator from the column beside it**, and that is
not a mistake. See §6.

### 4. Deals (X–Z) and 5. KPI metrics (AA–AG)

| Column | Formula |
|---|---|
| Closes | Appointments marked Closed |
| Close % | Closes ÷ shows |
| Revenue | **Not recorded anywhere.** Always blank |
| ROI | Needs revenue. Always blank |
| Cost Per Booking | Spend ÷ appointments created |
| Cost Per Show | Spend ÷ shows |
| Cost Per Close | Spend ÷ closes |

All three cost columns are blank rather than zero when no spend is recorded.

---

## 4. Why some cells are hatched

A hatched cell means **this cannot be known at this grain** — which is different
from zero, and different from nobody having filled it in.

Switch the breakdown to **Client** and they fill in.

24 columns hatch at campaign grain, for two different reasons:

**Columns J–O, the call block.** The calls table carries no campaign reference
at all. Splitting one client's calls across their campaigns would be invention;
repeating the client total on every campaign row would double count.

**Columns H, I, P–AB, AE–AG, from the tracker sheet.** These exist per campaign
and are *wrong* per campaign. The sheet's campaign id is unreliable row by row:
Singleton Smile has 97 lead rows citing 16 different campaign ids, fifteen of
them other practices'. Fleet-wide, every campaign id is cited by leads from 3 to
29 different practices.

So the numbers are real at client grain and meaningless at campaign grain. That
is a defect in the sheet's campaign id column, not in the Hub.

---

## 5. Adding a client to the tracker

A practice appears in the tracker when it has a `clients` row and at least one
feed carries data for it. There is no "add to tracker" step — it is driven off
the identifiers below.

### The three identifiers

| Field | Needed for | Where it comes from |
|---|---|---|
| `crm_location_id` | Appointments, calls | GoHighLevel sub-account id |
| `ad_account_id` | Spend, impressions, clicks, CPL | Meta ad account (`act_…`) |
| `group_id` | Portal, grouping locations | The practice this location belongs to |

### Steps

1. **Confirm the client row exists.** `crm-clients` creates it automatically
   from GoHighLevel on the 6am sync. Check **Settings → Clients**.
2. **Map the ad account** in **Settings → Ad accounts**. Without this the
   practice gets no spend, and therefore no CPL, no cost per booking, and no
   cost per show — the row will look half empty and nothing will say why.
3. **Check the practice's name in the tracker sheet matches** the client name in
   the Hub. Leads and appointments are matched on the location name the sheet
   carries. A rename on one side and not the other silently orphans the rows.
4. **Wait for the 6am sync**, or trigger it. Data appears the following morning.
5. **Verify** by opening the tracker at Client breakdown, 30 days, and picking
   the practice. Spend, leads and appointments should all be non-zero.

### 27 active practices have no ad account mapped

They can show appointments but never spend or CPL. This is the single biggest
cause of a row looking broken. As of 14 September:

All Dental of Menifee · Dental Design Studios · Diamond Dental · DNA Dental
Studio · Eagle Creek Dentistry · Evergreen Dental and Orthodontics · Firewheel
Smiles · Glamorous Smile Dental Spa · Great Smiles of La Mesa (×2) · Habib
Dental Implants · Integrity Dental · Limestone Hills Orthodontics · Metro Dental
& Implant Studio · Natalie Yang Orthodontics · Plano Top Dental · Royal
Dentistry Studio · Skyline Implants & Periodontics · Smile Now Align · Snyder
Dental Group · Stanton Dental Care · Team Dental N. Liberties · Team Dental
Swedesboro · TMJ Sleep Airway Orthodontics (Gainesville, New York, Ponte Vedra)
· Village Dental of New England (General Dentistry)

Several already carry appointments — DNA Dental Studio has 40, Village Dental 28,
Snyder 21 — so those rows show bookings against no spend, which makes the
practice look infinitely efficient.

**"Great Smiles of La Mesa (Dont use)"** is a duplicate client row and should be
deactivated rather than mapped.

---

## 6. Two places the Hub deliberately disagrees with the spreadsheet

Both are recorded here so nobody "fixes" them back.

### Pickup % is measured on talk time

The sheet counts GoHighLevel's `connected` flag. That flag is set when a call
attempt finishes at the carrier, **not** when a person answers — 3,292 of 6,691
outbound calls carry it with zero seconds of audio.

On that definition the fleet read **97.8%** and every practice landed between
97.6% and 100%, so the column could not tell any of them apart. On talk time they
run from **2.3% to 62.9%**:

| Practice | Old | Real |
|---|---|---|
| DNA Dental Studio | 99.7% | 5.3% |
| Glamorous Smile Dental Spa | 100% | 2.3% |
| City Dental Centers | 98.0% | 62.9% |

The Hub will read **lower** than the sheet here. That is the Hub being right.

### Schedule % counts only tracker appointments

Appointments come from two feeds:

- **1,273** from the tracker sheet, carrying a campaign
- **1,420** from the CRM ledger, carrying no campaign, no spend and no lead

Leads all sit on campaign rows. Counting all 2,693 against 2,220 leads gave
**121.3%** — more bookings than leads, which is not a rate. Matched against the
feed the leads come from, it reads **57.3%**.

`Appointments Created` still counts all 2,693, because those CRM bookings are
real appointments that real practices really took.

### Settled: Cost Per Booking

Joshua, 14 September: **"Cost per booking we got is the metric we are to use."**

That is what the column already does — spend divided by every appointment,
including the ones no ad paid for. No change was needed. Recorded here so the
question is not reopened.

### The sheet holds 47% of the appointments

Also Joshua, 14 September: *"The appts in GHL are more accurate than the ones in
the sheet."* Measured, and by a wider margin than assumed.

GoHighLevel carries 2,693 appointments. The tracker sheet carries 1,273 of them.
**1,420 exist only in the CRM, and six practices have nothing in the sheet at
all** — Limestone Hills 0 of 55, Metro Dental 0 of 46.

The relationship is one-directional: not one practice has an appointment in the
sheet that the CRM lacks. So nothing in the sheet needs correcting — things need
**adding**.

The tracker shows the per-practice gap under **What the sheet is missing**,
ordered by how many are absent, so it doubles as the worklist and shows when it
is finished.

The Hub cannot fix this itself. The Google scope is `spreadsheets.readonly` on
purpose, so a bug here can never write to the thing everybody trusts.

**What it affects:** Schedule % divides sheet appointments by sheet leads —
consistent, but both sides undercounted, so it reports the sheet's view of the
world rather than the world. Appointments Created, Shows, and the rates built on
them already count both sources and are unaffected.

### Open question for whoever owns the sheet

**Cost Per Booking divides spend by ALL appointments**, including the 1,420 that
no ad paid for. It therefore reads lower than reality.

Two defensible answers — cost per booking we *paid for*, or cost per booking we
*got* — and unlike 121% neither is impossible, so this has been left alone
pending a decision. Changing it is one line.

---

## 7. Troubleshooting

### Start here: the freshness line

The tracker shows the last day each feed actually delivered — spend, leads,
appointments, calls. **Check this first.** Most "the numbers are wrong" reports
are one stale feed, and the line says which.

### A whole practice is missing

1. Does it have a `clients` row? Settings → Clients.
2. Is it marked internal? Internal clients are excluded on purpose.
3. Is it active?
4. Does the name in the tracker sheet match the Hub's client name exactly?

### One practice shows appointments but no spend

Almost always a missing `ad_account_id`. See §5.

### One practice shows spend but no impressions

Three do today — Team Dental Swedesboro ($1,267), Diamond Dental ($682), Plano
Top Dental ($418). They carry insight rows with spend and zero delivery, and
none of them has an ad account mapped, so the rows predate or bypass the normal
Windsor path. **Unexplained — under investigation.**

### Everything is empty for every practice

A sync failed. Check the sync run log, then re-run `sync-all`. Feeds are
independent, so a failure in one leaves the others intact — which is why a
partly-empty tracker is more common than a wholly empty one.

### A number looks wrong but not impossible

Work down this list:

1. **Which grain?** Campaign grain hatches 24 columns. Switch to Client.
2. **Which window?** 3 days on a practice that books twice a month shows zero,
   correctly.
3. **Is it a rate with a small denominator?** 1 show out of 1 appointment is
   100% and means nothing.
4. **Is the denominator blank rather than zero?** Blank means unknowable, and is
   deliberate throughout.
5. **Is it one of the two deliberate divergences in §6?**

### Checks you can run

```bash
npm run check:cft
```

68 assertions over the tracker's arithmetic — column letters, section spans,
which columns hatch at which grain, and every derived rate. Run it after any
change to `cft-stats.ts` or `cft-columns.ts`.

Related suites: `check:tracker`, `check:commission`, `check:pay`,
`check:booking`.

---

## 8. Known limitations

**No ad can be traced to a booking.** All 1,443 appointments carry an empty ad
id, and so does every row from the tracker. The only ad attribution anywhere is
on tracker leads, where 480 of 1,101 resolvable rows name an ad belonging to a
*different* practice.

This is the binding constraint on creative testing. Hook/body/CTA combinations
can be measured on clicks and cost, and cannot be measured on bookings, until
something stamps the ad id onto the appointment. It is a tracker change, and it
is far cheaper to start recording now than to backfill later.

**Revenue and ROI are permanently blank** until case values are recorded
somewhere.

**Campaign-grain reporting is unavailable** for anything sheet-sourced, because
the sheet's campaign id is cross-contaminated. Fixing that means fixing the
column at source — whoever owns it needs to stamp the practice's own campaign id
rather than whatever was last in the cell.
