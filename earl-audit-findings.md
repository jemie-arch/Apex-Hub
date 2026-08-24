# Audit: PPS automation across Make + GoHighLevel

**Scope:** Make org `2206358` / team `163072` (330 scenarios) and the Apex Dental Marketing GHL agency.
**Date of audit:** 2026-08-21. **Mode:** read-only. Nothing was created, edited, activated, deactivated, deleted or replayed.
**Auditor note on framing:** the brief asked for a review of "Earl's build." The evidence does not support a single-author framing. See §1 before reading the register.

---

## 1. Executive summary

1. **The `01 - PPS - New Appointment Booked` template silently discards roughly 1 in 4 inbound bookings.** 11 of 42 real inbound booking webhooks since 2026-08-18 wrote **nothing** to the client sheet, and every one was logged **SUCCESS**.
2. Cause: the new template gates on `attributionSource.url` `exist`, then runs a `regexp:Parser` for `utm_id` with **`continueWhenNoRes: false`**. Any booking without a `utm_id` — i.e. every direct, calendar-widget and ISA booking — terminates at module 3.
3. **This is a regression, not a legacy bug.** The 12 clients still on the older 7-module design have no parser and drop nothing. The 45 clones on the new design all drop.
4. **Cross-client data leak, live now:** 3 clones write rows into a *different client's* Stat Sheet (Kind Dental → City Dental Centers **and** Kind Dental (GD); Team Dental Swedesboro → Team Dental N. Liberties; SMYLE East Meadows → SMYLE Dental Centers). A 4th, Stanton Dental Care, points its entire scenario at OC Healthy Smiles' sheet.
5. **38 of 57 `01` scenarios are active with no execution on record** — those clients are receiving nothing at all, which is worse and more invisible than a partial drop.
6. **All four `07 - PPS - Stripe Invoice Generation` scenarios are inactive.** No Make-driven invoicing is running for any client.
7. **PHI exposure:** scenario `5119363` posts patient **SSN, DOB, insurance policy and member IDs** into a Slack channel, and its first branch has **empty filter conditions** so it fires unconditionally. It is currently inactive. It predates Earl.
8. **Authorship:** since 2026-07-01, edits split **Paolo Encisa 41 / Ian Quizon 38 / Christopher Earl Co 36**. On 2026-08-21 — the mass-edit day — **Ian made 36 edits and Earl 16**. Earl did author the new template and created 56 of the recent scenarios.
9. **I could not size unbilled revenue in dollars.** The per-appointment rate is not recoverable from Make or GHL (see §7). The exposure is **11 confirmed missed invoices + 38 dark clients**; multiply by your contracted per-appointment rate.
10. Recommendation: **stop cloning.** Consolidating to one scenario keyed on `location.id` is less work than repairing 57 copies (§8).

---

## 2. Findings register

Severity: **Critical** = data loss, PHI exposure, or billing impact · **High** = will break soon, or a client is dark · **Medium** = inconsistency / maintenance risk · **Low** = cosmetic.

| ID | Sev | System | Object (id + name) | Finding | Evidence | Blast radius | Attributed to |
|---|---|---|---|---|---|---|---|
| **F-01** | Critical | Make | `5947250` `01 - PPS … [ADM Ortho Snapshot]` + 44 clones | Parser terminates the route when no `utm_id` is present; execution still logged SUCCESS. Data loss. | Module 3 `regexp:Parser`, `"pattern": "[?&]utm_id=([^&]+)"`, **`"continueWhenNoRes": false`** | 45 of 57 `01` scenarios (all NEW-gen clones) | Template created by **Earl** 2026-08-14, last edited by Earl 2026-08-21T23:18. Clones edited by Earl and Ian. |
| **F-02** | Critical | Make | same 45 clones | The route is gated on `attributionSource.url` `exist` while the parser needs `utm_id`. Wrong gate: unattributed traffic is admitted, then killed. | Module 3 filter: `{"a":"{{2.contact.attributionSource.url}}","o":"exist"}` | 45 scenarios | **Earl** (template author) |
| **F-03** | Critical | Make | 11 executions across 8 clients | Confirmed dropped bookings: 2-operation executions, status SUCCESS, no sheet write. | e.g. `5972350` exec `42c9cb6783b2451fb931f9eabe01e4d1`, `"operations": 2`, `"status": 1`, 2026-08-19T22:32:39 | 8 clients (table §3) | Consequence of F-01/F-02 |
| **F-04** | Critical | Make | `5950336` `01 - PPS … [Kind Dental]` | Writes into **two other clients'** sheets. Modules 10 & 22 (`updateRow`) → City Dental Centers' sheet; module 15 (`addRow`) → Kind Dental (GD)'s sheet. | mod 10/22 `spreadsheetId … 1MAOgIGlnAlF-3FyZRFwhQdVhp2HwWingBMRoet_fKS0` label `"City Dental Centers - Stat Sheet"`; mod 15 → `1K5GmuVnOkksTGMB98sCqIcX9Kl7z7ErjXGHlLO4Omcw` label `"Kind Dental (General Dentistry) - Stat Sheet Template"` | Kind Dental, City Dental Centers, Kind Dental (GD) | Created by **Earl**, last edited by **Ian** 2026-08-21T23:37 |
| **F-05** | Critical | Make | `5974519` `01 - PPS … [Team Dental Swedesboro]` | Modules 10 & 22 (`updateRow`) write into Team Dental N. Liberties' sheet. | `spreadsheetId … 1Bx5jJgDBEK8MIw6d-rpPAwIRKRTH3GOfOVfgQiiqNBQ` label `"Team Dental N. Liberties Apex - Stat Sheet"` | 2 clients | Created by **Earl**, last edited by **Ian** |
| **F-06** | Critical | Make | `5973526` `01 - PPS … [SMYLE Dental Centers East Meadows]` | Module 16 (`addRow`) writes into SMYLE Dental Centers' sheet. | `spreadsheetId … 1Ws0ktn_nUwWT7iaaHb2cXaM9CmFY-su53ihVLbXSuTY` label `"SMYLE Dental Centers - Stat Sheet"` | 2 clients | Created by **Earl**, last edited by **Earl** |
| **F-07** | Critical | Make | `5111292` `01 - PPS … [Stanton Dental Care]` | Entire scenario reads and writes **OC Healthy Smiles'** spreadsheet, while its UI label claims Stanton's. | All 3 sheet modules → `1Wb0dfuUMZxWoAe_DkpVHlLU1FTwo56XX-XEkamFOJbM`, identical to `4176701` `[OC Healthy Smiles]`; Stanton's `restore.expect.spreadsheetId.path` = `["PPS - Clinic NP Tracker Sheets","Stanton Dental Care - Stat Sheet"]` | 2 clients | `createdByUser: null`; last edited by **Paolo Encisa** 2026-07-29. Created 2026-05-19 — **predates Earl.** |
| **F-08** | Critical | Make | `5119363` `Slack New Appt. Notification [ADM Ortho Snapshot]` | Slack message body contains SSN, DOB, insurance policy/member IDs and patient address. Branch-1 filter has **empty conditions** → fires unconditionally. Currently inactive. | `"text": "… Date of Birth: {{1.` Patient Date of Birth`}} … Policy ID: {{1.`Policy ID`}}\nMember ID: {{1.`Member ID`}}\nSSN: {{1.`Social Security Number`}} …"`; filter `{"name":"1st Consultation","conditions":[]}`; channel `C0B5PJQS5UG` (private, label `appts-test`) | ADM Ortho Snapshot template; any subaccount cloned from it | `createdByUser: null`, `updatedByUser: null`. Created **2026-05-19**, last edit 2026-05-19 — **predates Earl's tenure. Not Earl's.** |
| **F-09** | Critical | Make | `5814127` `Lead Tracker: GHL Contact Created → Sheets` | Same halting parser with **no gate at all** (`filter: null`), writing to the CFT master sheet. 389 errors / 1527 executions (25%). | mod 5 `"pattern":"[?&]utm_id=([^&#]+)"`, `"continueWhenNoRes": false`, `"filter": null`; target `1MmpXLANeiffDrT9zIaNcLY8ekk_CZ1-96wYer1XTtiE` tab `Leads Data` | All lead attribution reporting | Created by **Paolo**, last edited by **Earl** 2026-08-19 |
| **F-10** | Critical | Make | `5814127` router branches 3 / 8 / 10 | `utmMedium` partitioned as `text:notcontain "paid"` vs `text:equal "paid"`, with a third branch on the literal **`"{{paid"`**. Values that *contain but do not equal* "paid" (`paid-social`, `cpc-paid`) match **no branch** → silent drop. | mod 3 `{"a":"…utmMedium","b":"paid","o":"text:notcontain"}`; mod 8 `…"o":"text:equal"`; mod 10 `{"b":"{{paid","o":"text:contain"}` | All paid-social lead attribution | Pattern present in template; last editor **Earl** |
| **F-11** | High | Make | 38 of 57 `01` scenarios (list §4) | Active with **no execution on record**. Client receives nothing. | `executions: 0`, `operations: 0` while `isActive: true`, e.g. `5949634 [All Dental of Menifee]` | 38 clients | Mixed — 27 NEW-gen (Earl-created), 11 OLD-gen (pre-Earl) |
| **F-12** | High | Make | `4285914`, `4229028`, `4259379`, `4069438` `07 - PPS - Stripe Invoice Generation` | **All four are inactive.** No automated invoicing runs. `4259379` is also `isinvalid: true`. | `"isActive": false` on all four; `4259379 "isinvalid": true` | All pay-per-appointment billing | `createdByUser: null` — all predate Earl (last edits Feb–Mar 2026) |
| **F-13** | High | Make | `6003601` `GHL Token Bridge (app-owned)` | Bridge is `isActive: false` **and** `isinvalid: true`; the data store holds key `ghl_token` with **empty data**, not `ghl_token_managed`. The public endpoint returns **HTTP 401**. GHL API v2 automation is dead. | data store `135204` records: `[{"key":"ghl_token","data":{}}]`; `GET https://apex-client-hub.vercel.app/api/tokens/ghl` → 401 | Every GHL-API-dependent automation | Created/last edited by **Jemie Jalea** 2026-08-21 |
| **F-14** | High | Make | 45 NEW-gen `01` clones | **Zero `onerror` handlers** in any scenario. Module failures die silently alongside the parser halts. | No `onerror` key on any of 585 modules examined across 45 blueprints | Whole fleet | Template design — **Earl** |
| **F-15** | High | Make | hooks `143126` "New Lead Tracker" (queue 1740/2668), `133965` "SA" (1663), `133913` "NLA" (1621), `172893` "Speed to Lead Tracker 1" (297) | Live webhooks with **no scenario attached**, queues filling toward the 2668 limit. Inbound data is accumulating and will be discarded. | `"scenarioId": null` with `"queueCount": 1740` / `1663` / `1621` / `297`, `"enabled": true` | Unknown — depends what is POSTing | Not determinable from available metadata |
| **F-16** | High | Make | `4176278` `01 - PPS … [Eagle Creek Dentistry]` | Reads one spreadsheet, writes a **different** one. The dedupe lookup can never match → duplicate rows and/or writes to the wrong file. | `filterRows spreadsheetId "1h1MnNra5nGzjHnX14ThfP2t7b546yqOwwD7A4pFu-A4"` vs `addRow/updateRow "…/1QyKIYRnfZnhv12GOa0sXIoyJT7DmvwUIlbpFUFIrbcU"` | Eagle Creek Dentistry | `createdByUser: null`, last edited by **Paolo** 2026-07-29 |
| **F-17** | High | GHL | Lightning Orthodontics `umZoVItnqMwTymckGaTH`, calendar `5fJJK7HlUinjHbBZtNYa` | The **live, Active** booking calendar is literally named `{{location.name}} Booking Calendar` — an unrendered merge field. | Screenshot, GHL Calendar settings: name `{{location.name}} Booking Calendar`, Id `5fJJK7HlUinjHbBZtNYa`, 30 min, Event, **Active**, updated December 11 2025 | Every subaccount cloned from ADM Ortho Snapshot | Last updated 2025-12-11 — **predates Earl** |
| **F-18** | High | GHL / Make | Lightning: 6 calendars; trackers match on calendar name | Lightning has **6 calendars**, at least two Active and bookable (incl. "Susana Mariaca's Personal Calendar"). `02`/`03`/`06` only act when `calendar.calendarName` contains `"Booking Calendar"` or `"Second_consultation"`. A booking into any other calendar is invisible everywhere. | GHL: "All calendars (06)"; Make `4146830` mod 11 filter `{"a":"{{5.calendar.calendarName}}","b":"Booking Calendar","o":"text:contain:ci"}` | Lightning confirmed; likely fleet-wide | Make scenarios pre-date Earl (`createdByUser: null`, edits Feb–Apr 2026) |
| **F-19** | High | Make | `4146873` `04 - PPS - Update Appointment Info Form … [Lightning]` | Router branch 1 (module 7) has **no filter at all** while branch 2 filters on "Second Consultation" → branch 1 fires unconditionally, so a second-consultation submission also overwrites the first-consultation row. | mod 7 has no `filter` key; mod 14 filter `{"a":"{{9.contact_source}}","b":"Second_consultation","o":"text:contain:ci"}` | `04` family (57 scenarios) if replicated — verified on Lightning only | Pre-Earl (`updatedByUser: null`, lastEdit 2026-04-09) |
| **F-20** | Medium | Make | All 45 NEW-gen clones | Module 9 branch filter compares `utmMedium` to the literal **`"{{paid"`** — an unclosed mapping stored as a string. The branch can never match; it is dead code. | mod 9 filter: `{"a":"{{2.contact.attributionSource.utmMedium}}","b":"{{paid","o":"text:contain"}` | 45 scenarios | **Earl** (template) |
| **F-21** | Medium | Make | All 45 NEW-gen clones | `text:equal "paid"` (mod 8) paired with `text:notcontain "paid"` (mod 6) as a partition. `paid-social` / `cpc-paid` match neither → silent drop even when a `utm_id` is present. | mod 8 `"o":"text:equal"`, mod 6 `"o":"text:notcontain"`, same field, same value `paid` | 45 scenarios | **Earl** (template) |
| **F-22** | Medium | Make | 43 of 45 NEW-gen clones | Webhook UI label is a copy-paste leftover reading **"Abraham Orthodontics"** on clones for other clients. Cosmetic, but it is how the sheet-target mistakes went unnoticed. | `blueprint.flow[0].metadata.restore.parameters.hook.label = "Abraham Orthodontics"` on 43 clones | Maintainability | Cloning process — **Earl** |
| **F-23** | Medium | Make | root folder (no folder) | 10 active orphan scenarios for **`[Ofir Orthodontics]`** and **`[Test Clinic]`** (families 01–06), all with no executions, sitting outside any client folder. | `folderId: null`, `isActive: true`, `executions: 0` — `4176885`, `4176887`, `4176891`, `4176893`, `4176898`, `4327540`, `4327721`, `4327725`, `4327734`, `4327737` | Housekeeping; Test Clinic writes to a real template sheet | `createdByUser: null` — pre-Earl |
| **F-24** | Medium | Make | `5981865` `Test Ian - Integration HTTP, Text parser, OpenAI…`, `5949789` `Integration Google Sheets, Data store, ClickUp, Slack` (folder "Sandbox - Ian") | Sandbox/test scenarios in the production team. `5981865` has consumed **110 executions**. | Folder `271594 "Sandbox - Ian"`; `5981865 executions: 110` | Cost/noise, not client-facing | **Ian Quizon** (creator and last editor) |
| **F-25** | Medium | Make | `4294532` `Total Billing per Client - Automation (Draft)` | Named "(Draft)" but **`isActive: true`**, listening on Stripe `watchEvents`. Either it is live and misnamed, or it is unfinished and should not be live. | `"isActive": true`, name contains "(Draft)" | Billing | `createdByUser: null` — pre-Earl |
| **F-26** | Medium | Make | `3816566` `01 … [Snyder Dental Group]` | Diverges from every sibling: router branches are in reverse order, and `updateRow` maps cols 24/25 to `adSetId`/`adId` where all other clones map `utmMedium`/`utmContent`. | mod 10 values `"24":"{{1.contact.lastAttributionSource.adSetId}}","25":"…adId"` vs fleet `utmMedium`/`utmContent` | Snyder's reporting columns disagree with the fleet | Last edited by **Paolo** 2026-07-27 |
| **F-27** | Medium | Make | OLD-gen clones (12) | Columns labelled "Campaign ID / Ad Set ID / Ad ID" are populated from `campaign` / **`utmMedium`** / **`utmContent`** — names do not match contents. | `"23":"…campaign","24":"…utmMedium","25":"…utmContent"` against headers `Campaign ID (X)`, `Ad Set ID (Y)`, `Ad ID (Z)` | Client-facing sheet columns are mislabelled | Pre-Earl |
| **F-28** | Medium | GHL | Lightning Orthodontics | 2 workflows sit in the **"Needs review"** tab. | Screenshot: `Needs review (2)` on the Workflows list | Lightning | Not determinable from the list view |
| **F-29** | Medium | GHL | custom field `` ` Patient Date of Birth` `` | Field name has a **leading space**, and is referenced with that space in Make mappings — so any cleanup of the name silently breaks the mapping. | `{{1.` Patient Date of Birth`}}` in `5119363`; declared as `{"name":" Patient Date of Birth"}` in the webhook interface of `5119363` and `5814127` | Any scenario mapping that field | Pre-Earl (field predates both) |
| **F-30** | Medium | Make | All 45 NEW-gen clones | Scenario setting `"dataloss": false` — incomplete executions are **not** stored, so halted routes leave no recoverable payload. | `blueprint.metadata.scenario: {"dlq": false, "dataloss": false, "maxErrors": 3}` | No recovery path for dropped records | Template default — **Earl** |
| **F-31** | Low | Make | 2 scenarios | `isinvalid: true`: `6003601` `GHL Token Bridge (app-owned)` and `4259379` `07 - PPS - Stripe Invoice Generation [Village Dental New England] Working`. | `"isinvalid": true` | See F-12, F-13 | Jemie / pre-Earl respectively |
| **F-32** | Low | Make | `4285914` `… [ADM Ortho] (copy)`, `4229028` / `4259379` `… Working`, `3943213` `(TEST) Calendar Automation`, `2670503` `Daily Slack Booking Msgr (test)`, `2668384` `Bookings` | Leftover copy/test/"Working" scenarios never cleaned up (all inactive). | Names + `isActive: false` | Housekeeping | Pre-Earl |
| **F-33** | Low | Make | `296215` `Call back request`, `434707` `Hiring Reminder Email Automation` | Active since 2024/2025 with zero executions. | `isActive: true`, `executions: 0`, lastEdit 2024-10-29 / 2025-01-11 | Dead weight | Joshua Jung (creator) |

### Practice risk (not a defect, but it wrote to live client sheets)

| ID | Sev | Finding | Evidence | Who |
|---|---|---|---|---|
| **F-34** | High | Executions were **replayed against live client Stat Sheets** during debugging on 2026-08-21, writing real rows. At least 9 replays observed; several completed with 3–4 operations, meaning they wrote. | `5950112` exec `99f2b7ee1c83438c82a1956b1348c64d` `"replayOfExecutionId":"837090e82ed0484eb58362f2548668a7"`, `"operations": 4`, `"authorName":"Christopher Earl Co"`; `5974856` exec `04315e3d469d46fb8be6785019042ad2` `"authorName":"Ian Quizon"`; also `5970898` ×2, `5972350` ×2, `5972404`, `5973074` ×3, `5974977` | **Earl** (7) and **Ian** (2) |

---

## 3. Impact table — confirmed dropped appointments

Method: for each `01` scenario I pulled the execution log and counted **real inbound** executions (`type: auto`, `replayOfExecutionId: null`) with exactly **2 operations** — webhook + parser, then halt. Replays and manual runs are excluded.

| Client | Scenario | Real inbound | 2-op drops | Drop rate | Window |
|---|---|---|---|---|---|
| Singleton Smile Dental | `5973074` | 6 | **3** | 50% | 18–20 Aug |
| Essex Dental Arts | `5970898` | 4 | **2** | 50% | 19–21 Aug |
| Fiesta Orthodontics | `5970967` | 1 | **1** | 100% | 21 Aug |
| Lightning Orthodontics | `5972350` | 1 | **1** | 100% | 19 Aug |
| (GD) Village Dental of New England | `5974977` | 2 | **1** | 50% | 18 Aug |
| Art of Smile | `5950112` | 4 | **1** | 25% | 19 Aug |
| Lompoc Family Dental | `5972404` | 2 | **1** | 25% | 19 Aug |
| Ultra Smiles Orthodontics | `5974856` | 4 | **1** | 25% | 20 Aug |
| Anaheim, Bespoke, Bling, City Dental, Hancock, Kind Dental, Magic, The Dental Collective, The Smile Patio, Village Dental of New England | 10 scenarios | 18 | 0 | 0% | — |
| **Total (NEW-gen)** | **18 scenarios** | **42** | **11** | **26.2%** | 18–21 Aug |

`3744203 [Abraham Orthodontics]` is excluded: it is NEW-gen (it was retrofitted with the parser in place) but all 6 of its recorded executions ran at 5 operations *before* the retrofit, so there is no post-retrofit evidence for it.

**Caveat:** each 2-op execution is one inbound booking webhook that wrote nothing. I am treating that as one appointment. If GHL ever fires the webhook twice for one appointment, the appointment count would be lower than the event count. I could not rule that out (see §7).

### Dark clients — active, no execution on record (F-11)

`01` family, 38 of 57:

**NEW-gen (27):** ADM Ortho Snapshot, Airway Orthodontics – FL, Airway Orthodontics – GNV, Airway Orthodontics – NY, Airway Orthodontics – Williston, All Dental of Menifee, Andros Orthodontics, Cruz Orthodontics LLC, Dental Illusions, Dental Solutions, Diamond Dental, Genuine Family Dentistry, HEB Family Dentistry, Integrity Dental, Kind Dental (GD), Plano Top Dental, Smile and Implant Center of Rockland, Smile Orthodontics, SMYLE Dental Centers, SMYLE Dental Centers East Meadows, Sparkill Dental, Tamara Levit DDS, Team Dental N. Liberties, Team Dental Swedesboro, The Smile Lounge, Wilmington Family Dental *(+ the snapshot itself, expected)*

**OLD-gen (11):** Best Care Dental, Dental Design Studios, DNA Dental Studio, Eagle Creek Dentistry, Glamorous Smile Dental Spa, OC Healthy Smiles, Ofir Orthodontics, Royal Dentistry Studio, Smile Now Align, Snyder Dental Group, Stanton Dental Care *(+ Test Clinic)*

Sibling families are worse: **02** 31 dark, **03** 44 dark, **04** 31 dark, **06** 50 dark (of 57 each). Across the whole team, **200 of 308 active scenarios have no execution on record.**

---

## 4. Fleet divergence matrix

The fleet has **two generations**, not one drifted family:

| | OLD design | NEW design |
|---|---|---|
| Count (`01` family) | 12 | 45 |
| Modules | 7 | 13 |
| Flow | webhook → SetVariable ×2 → filterRows → router{addRow \| updateRow} | webhook → router → **regexp:Parser** → filterRows → router{addRow ×3 \| updateRow} → filterRows → router{addRow \| updateRow} |
| `regexp:Parser` | absent | present, `continueWhenNoRes: false` |
| Drops unattributed bookings | **No** | **Yes** |
| `onerror` handlers | 0 | 0 |
| Created | Dec 2025 – May 2026, `createdByUser: null` | 2026-08-14 → 2026-08-18, `createdByUser: Christopher Earl Co` |

**On the four defect signatures, the 45 NEW-gen clones are identical — not drifted.** Every one has sig 1 (parser halt), sig 2 (wrong gate), sig 3 (`"{{paid"` literal), sig 4 (equal/notcontain partition), and zero `onerror`. That is the signature of one bad template cloned 44 times, and it is *good news for the fix*: one corrected template repairs all 45 identically.

Where the clones **do** diverge is in the parts a human had to retype:

| Divergence | Clones affected |
|---|---|
| Sheet target points at another client (F-04/05/06) | Kind Dental, Team Dental Swedesboro, SMYLE East Meadows |
| Read sheet ≠ write sheet (F-16) | Eagle Creek Dentistry (OLD-gen) |
| Whole scenario on another client's sheet (F-07) | Stanton Dental Care (OLD-gen) |
| Webhook label still "Abraham Orthodontics" (F-22) | 43 of 45 |
| Router branch order reversed + different column mapping (F-26) | Snyder Dental Group |
| `App - Date` format `MM/DD/YYYY` vs `MM/DD/YYYY hh:mm` vs raw `calendar.startTime` | OC Healthy Smiles, Ofir, Test Clinic (date only); Stanton (raw ISO); rest (with time) |
| Column count in `addRow` spec (26 / 27 / 28 / 34 columns) | varies across OLD-gen; DNA Dental Studio has 34 incl. "Ad Spend / Bookings / Shows / Starts" |

---

## 5. GHL ↔ Make chain map

**This is the weakest part of the audit and I want to be direct about why.** The GHL API v2 path is unavailable: the token bridge is dead (F-13) and extracting a session token from the browser was blocked by policy — correctly, and I did not work around it. That leaves the GHL UI, where the Workflows and Calendars screens render inside **cross-origin iframes** (`client-app-automation-workflows.leadconnectorhq.com`, `calendar-app.leadconnectorhq.com`) that cannot be read as text and do not render when loaded directly. Everything below came from screenshots, one location at a time.

**Verified (1 of 57 locations):**

| Client | GHL location | Make `01` hookId | GHL side | Chain verdict |
|---|---|---|---|---|
| Lightning Orthodontics | `umZoVItnqMwTymckGaTH` | `1887778` (attached) | Workflow folders `01 - PPS \| Tracking Workflows`, `02 - PPS \| Pay Per Appt/Show Auto Billing`, `03 - PPS \| Client Reporting Dashboard`, `1. CCM - …`; 6 calendars; booking calendar `5fJJK7HlUinjHbBZtNYa` Active but named `{{location.name}} Booking Calendar`; 2 workflows in "Needs review" | **Make side fires** (3 executions), so the chain is intact end-to-end — but 1 of 1 real bookings was dropped by F-01. Published/draft status of the individual workflows **not verified**. |

**Inferred, not verified (56 locations):** every `01` scenario has a `hookId` and Make reports the hook attached, so the Make end of each chain exists. Whether a **published** GHL workflow POSTs to it, and whether it posts to the *correct* client's URL, is unverified. The 38 dark scenarios (F-11) are the population where the chain is most likely broken on the GHL side — but I cannot say that from evidence, only that Make has never received anything.

**B4 — PatientSync classification.** Lightning Orthodontics is on **both** paths, confirmed: full PPS folders in GHL (screenshot) *and* 5 active PPS scenarios in Make (`5972350`, `4146830`, `4146848`, `4146873`, `4146855`). The brief describes it as non-PatientSync. That conflict is real. I could not classify the other 56.

---

## 6. Compliance and security

**PHI in Slack (F-08)** — `5119363`, currently **inactive**. The message body is quoted in the register. Two aggravating details: the branch-1 filter has empty conditions so it would fire on *every* payload, not just first consultations; and the channel is `C0B5PJQS5UG`, a **private** channel labelled `appts-test` — i.e. a test channel, with whatever membership it has.

I searched every Slack, email and SMS module in the blueprints I retrieved for SSN / DOB / insurance / policy identifiers in message bodies. **`5119363` is the only scenario carrying that payload, and it is inactive.** I found no *active* scenario doing so. That search covered the 57 `01` scenarios, `5814127`, `4294532`, Lightning's `02/03/04/06`, and `5119363` — **not** all 330 scenarios (§7).

**PHI in transit and at rest, beyond Slack.** The GHL webhook payloads themselves carry PHI regardless of the Slack module. The stored sample payload in `4167561 [Dental Design Studios]` contains a real patient record: `"Patient Date of Birth": "10/24/1997"`, `"Social Security Number": "-"`, `"Policy ID"`, `"Member ID"`, `"Insurance Provider"`, `"Pain point | Desired Product | Dental History": "Bottom row crowded since childhood…"`. These samples are stored inside the Make blueprint and visible to anyone with team access. The `01` scenarios do not write those fields to sheets — but the fields arrive at the webhook and sit in Make's stored samples.

**Unauthenticated webhooks (signature 8).** Every `gateway-webhook` in this team is unauthenticated: `data` carries `{"ip": null, "udt": null, "headers": false, "method": false, "stringify": false}` and no API-key list. Anyone holding a `https://hook.us2.make.com/<udid>` URL can inject arbitrary rows into a client's Stat Sheet, or (for `5814127`) into the CFT master sheet. The URLs are the only secret, and they are pasted into GHL workflows across 57 subaccounts that client staff can often view. **Risk: medium-high, exposure-dependent.** `hooks_list` returned only the first ~50 hooks, so I enumerated a sample, not the full set.

One dead hook: `143435 "Location Webhook"` has `"gone": true` and, oddly, its `data.ip` field contains another webhook's URL (`https://hook.us2.make.com/gmuxxx1ltnok1px2t4w6bpfjy0g16qjf`).

**Do not remediate any of the above.** F-08 in particular is a compliance decision, not an engineering one.

---

## 7. What I could not verify

Being explicit, because the gaps change how much weight the register can carry.

**Blocked outright**
- **GHL API v2 (Part B, most of it).** Token bridge `6003601` is inactive + invalid; data store key is `ghl_token` with `{}`; the public endpoint returns 401. Reading a session token out of the browser was refused by policy and I did not attempt a workaround. Consequence: **B1 (published vs draft per workflow), B2 (webhook URL per workflow), B5 (snapshot drift), B6 (the ~75 custom fields), B7 (observed `utmMedium` value set) are essentially unaudited.**
- **B7 specifically.** I cannot report the real observed `utmMedium` values, which is exactly what would tell you how much F-21 costs. What I *can* say from stored webhook samples: `utmMedium` is **`null`** on every direct/calendar booking I saw, and on the one paid-social sample it was `"Broad | Apple Tree/Avondale | 10 mil | [25-50]"` — an ad-set *name*, not a channel token. Neither `paid` nor `paid-social`. If that is representative, mod 8 (`text:equal "paid"`) may never match at all and effectively all attributed traffic funnels through mod 6.
- **Per-appointment billing rate.** Not present in Make or GHL. The only monetary value I found is a stored Stripe sample in `4294532`: `"amount": 45423` / `"currency": "usd"` / `"description": "Payment for Invoice"` — a **monthly invoice total**, not a unit rate, so it cannot be divided into a per-appointment figure. **This is why the executive summary has no dollar number.** Supply the contracted rate and the exposure is `11 × rate` for confirmed drops, plus whatever the 38 dark clients should have billed.

**Sampled, not exhaustive**
- **Blueprints: 63 of 330 scenarios read** (all 57 of the `01` family, Lightning's `02/03/04/06`, `5119363`, `5814127`, `4294532`). The 8-signature sweep in A2 therefore covers the `01` family exhaustively and the other families **only through Lightning**. Families `02`, `03`, `04`, `06`, `07` — 228 scenarios — were not swept. F-19 in particular is confirmed on one scenario and may or may not replicate across the `04` family.
- **GHL: 1 of ~57 locations** (Lightning), and within it the calendar list only partially (I read 2 of 6 calendar names before the iframe stopped scrolling; the remaining 4 names are unknown). No location's workflow published/draft states were read.
- **Webhooks: ~50 of an unknown total.** `hooks_list` appears to paginate and returned only ids ≤ 437017, while the fleet uses ids up to 2638687.

**Method caveats**
- The `executions` / `operations` counters exclude `type: manual` runs. I validated this on `3744203`: 9 execution records in the log vs `executions: 7`, and `47` operations summed vs `operations: 37` — the difference is exactly the two manual replays by Paolo. So "no execution on record" means no *automatic* execution, and does not strictly prove a scenario never ran.
- `executions_list` returns a bounded window (for `3744203` it reached back only to 2026-07-21). For older scenarios, absence of executions in the log is not proof of absence over all time.
- The `from`/`to` parameters on `executions_list` are ignored, as the brief warned; I filtered timestamps myself.
- **Modify history is available** — `executions_list` interleaves `type: "modify"` / `"start"` records with author names, which is how the authorship map in §1 and the register was built. But it only covers the retained window, so pre-July authorship for most objects remains `null`.

**Where the intended behaviour is genuinely unclear (needs a human, not a fix)**
- Should the `01` scenario record **all** bookings, or only ad-attributed ones? The OLD design records all; the NEW design records only `utm_id`-tagged ones. If the NEW behaviour is *intentional*, then F-01/F-03 are not bugs — but then pay-per-appointment billing is being driven off ad-attributed bookings only, which contradicts "a dropped appointment is a missed invoice." **I could not read the written guide** (Google Doc `1mDNc8fjusQe2WZV9eyQYIRN59AuyAKZw`) — it is not publicly fetchable — so I could not check the intended design as instructed. This is the single most important thing to resolve before fixing anything.
- Whether the same-brand multi-location sheet sharing (Kind Dental / Kind Dental (GD), SMYLE / SMYLE East Meadows, Team Dental N. Liberties / Swedesboro) is *intended* consolidated reporting for a group. I have flagged all three as Critical because the mapping is **partial and asymmetric** — only some modules point at the sibling's sheet, which no deliberate design would do. But the direction of the fix depends on the answer. The Stanton → OC Healthy Smiles and Kind Dental → City Dental Centers pairs are **different brands** and are not defensible under any reading.

---

## 8. Recommended fix order

Effort in engineer-days, rough.

| # | Action | Why now | Effort |
|---|---|---|---|
| 1 | **Answer the design question in §7** — should `01` record all bookings or only ad-attributed ones? | Every other fix depends on it. Do not touch the fleet before this is settled. | 0.5 (a conversation) |
| 2 | **Fix the 3 + 2 sheet mis-targets** (F-04/05/06/07/16) and audit the affected sheets for foreign rows | Live cross-client data leak. Client-facing. | 0.5 fix, 1 to reconcile rows |
| 3 | **Decide on F-08 (PHI in Slack)** — scrub or delete `5119363`, and remove it from the ADM Ortho Snapshot before the next clone | Compliance. It is inactive, so this is urgent-but-not-emergency. | 0.5 + policy review |
| 4 | **Set `continueWhenNoRes: true`** on the parser in the template and all 45 clones; correct the mod 3 gate | Stops the bleeding. One-line change ×46. | 1 |
| 5 | **Collapse mods 6/8/9** into one correct `utmMedium` classification with a real else-branch (F-20/21) | Removes the second silent-drop path. | 0.5 |
| 6 | **Reactivate or retire the four `07` Stripe scenarios** (F-12) | Nothing is invoicing. Either it is being done manually — in which case say so — or revenue is being missed. | 0.5 to establish, then scope |
| 7 | **Investigate the 38 dark `01` clients** (F-11) starting with the GHL workflow published state | 38 clients may be receiving nothing. Needs GHL access first. | 2–3 |
| 8 | **Fix the token bridge** (F-13) | Unblocks a proper Part B audit and any GHL-API automation. | 0.5 |
| 9 | **Attach or delete the 4 orphan webhooks with filling queues** (F-15) | Data accumulating toward a hard limit. | 0.5 |
| 10 | **Add `onerror` handlers + enable `dataloss` storage** on the fleet (F-14/F-30) | Without these the next silent failure is equally invisible. | 1 |
| 11 | Housekeeping: F-23, F-24, F-25, F-31, F-32, F-33 | Low risk, but they are why the real problems hid. | 1 |
| 12 | Rename the `{{location.name}}` calendars, after checking what breaks (F-17) | **Careful:** `02/03/06` match on `calendarName contains "Booking Calendar"`. The literal name happens to satisfy that. Renaming to a clean value that still contains "Booking Calendar" is safe; anything else silently breaks the show/no-show trackers. | 1 |

### Consolidation vs repairing 57 clones

**Consolidate.** The evidence is unusually clear on this:

- The 45 NEW-gen clones are **byte-identical in logic** — all 4 signatures, same module ids, same patterns. There is no per-client logic to preserve. The only per-client values are the **webhook id** and the **spreadsheet id**.
- Every divergence that actually hurts a client (F-04, F-05, F-06, F-07, F-16, F-22, F-26) is a **hand-retyping error in exactly those two values**. Consolidation deletes the entire error class.
- The fleet already proves the failure mode: one bad template, cloned 44 times, then patched inconsistently by three people — Earl, Ian and Paolo — on the same day. Repairing 57 copies re-runs that exact process and will produce a fresh crop of the same mistakes.

Target design: **one** `01 - PPS - New Appointment Booked` scenario, one webhook, routing on `{{1.location.id}}`, with the target spreadsheet looked up from a Make data store (or the CFT `Leads Data` sheet) keyed on location id. Same for each of `02/03/04/06`. Net: **285 scenarios → 5**.

Rough migration estimate:
- Build + test the consolidated `01` against 3 pilot clients: **3 days**
- Build the location→spreadsheet mapping data store (57 rows, from `bp-summary.csv` produced by this audit): **0.5 day**
- Repoint 57 GHL workflows to the single webhook URL: **2 days** (needs GHL access; this is the bulk of it)
- Migrate the other 4 families: **4 days**
- Parallel run + decommission: **2 days**

**~11–12 days**, against roughly 5–7 days to patch 57 clones in place and inherit the same fragility. The consolidation pays for itself the first time a 58th client is onboarded.

---

## 9. Flagged separately for a human decision

1. **PHI in Slack (F-08).** Compliance call, not an engineering one. Note it predates Earl and no active scenario shares the pattern.
2. **Client-facing sheet columns that would change if the fleet were re-converged.** Re-pointing clones onto the template's column layout would alter columns already visible to clients: OLD-gen sheets carry "Campaign ID / Ad Set ID / Ad ID" populated from `campaign`/`utmMedium`/`utmContent` (F-27), Snyder's are populated from `campaign`/`adSetId`/`adId` (F-26), and DNA Dental Studio's sheet has four extra columns ("Ad Spend", "Bookings", "Shows", "Starts") no other client has. Converging the fleet **will visibly change client reports**. That needs a client-comms decision before, not after.
3. **The `utm_id` design question (§7).** Genuinely ambiguous from the systems alone, and I could not read the written guide. Everything in the register that is Critical for data loss rests on the assumption that all bookings should be recorded.
4. **Same-brand sheet sharing.** Whether Kind Dental / Kind Dental (GD), SMYLE / SMYLE East Meadows and Team Dental N. Liberties / Swedesboro are meant to share one reporting sheet. The current mapping is partial either way and wrong either way, but the fix differs.
5. **Attribution fairness.** The brief framed this as Earl's output. On the evidence: Earl authored the NEW template and therefore F-01, F-02, F-14, F-20, F-21, F-30, and created the clones carrying F-04/05/06. He is also one of three people editing the same objects, made a minority of recent edits (36 of 116 since 2026-07-01, 16 of 53 on 2026-08-21 against Ian's 36), and did **not** author the two most serious pre-existing items (F-08 PHI-in-Slack, F-12 dead invoicing). Several findings attributed to `createdByUser: null` genuinely cannot be assigned to anyone from the retained history.

---

### Appendix — artefacts produced by this audit

Working files (local, no credentials): `inventory.csv` (all 330 scenarios), `parsed.csv`, `bp-summary.csv` (per-scenario signature + sheet-target matrix, 45 rows), `bp-findings.csv` (94 signature hits), `bp-report.txt`, `leak.txt` (per-module sheet targets for the leaking clones), `tables.txt`.
Directory: `%LOCALAPPDATA%\Temp\claude\C--Users-Jemie-Documents-Apex\e65e7de5-d3e5-47e6-8f2b-2879af763dbd\scratchpad\audit`
