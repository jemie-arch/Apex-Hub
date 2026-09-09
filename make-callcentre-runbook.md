# Make: the call-centre scenarios — diagnosis and fix

Scenario **5560467** "Call Center Dashboard HP->SheetsAI->Transcript"
Team 163072, org 2206358, hook 2531828. Zone **us2.make.com**.

State as of 8 September 2026: `isActive: false`, `isinvalid: true`,
`dlqCount: 391`, `allDlqCount: 449`.

## There are three separate faults, not one

### 1. The queue filled, and that is what switched the scenario off

Live module **#5** (`google-sheets:addRow` → **RAW DATA** tab) carries an
error handler, `builtin:Break`, set to retry 3 times at 15-minute intervals.
The scenario's `metadata.scenario.dlq` is `true` — "Allow storing of
incomplete executions".

Break's job is to park the failing bundle in the incomplete-execution queue
and retry it later. The bundle at that point already contains the call
recording downloaded by module #102, so each parked item is megabytes rather
than kilobytes.

**The 500MB is 37 items, not 391.** Measured in the UI: 37 items are 100KB or
larger and total **498.2MB** — min 2.81MB, max 23.5MB, mean 13.46MB — and the
Status filter shows Unresolved = exactly those 37. They were parked 25–28
August. The other ~354 items are 1,802–3,967 bytes each, about 0.8MB together,
and were created in a 64-second burst on 8 September between 08:04:36 and
08:05:40 — the reactivation described at the end of this file. So that
reactivation added under a megabyte and did not cause the storage problem;
what it did was add ~354 rows to the list. Retrying "the queue" is 37
transcriptions, two weeks old, not 391 six weeks old.

Once the queue was full, every subsequent run failed with:

> There is NOT ENOUGH SPACE to add a new incomplete execution. […] The queue
> size limit is shared across all scenarios. DLQ limit exceeded: Organization
> DLQ size limit: 500MB

Make then deactivated the scenario and flagged it invalid. Not via
`maxErrors: 3`, which is what this file first assumed: the scenario settings'
own help text states that **scenarios with instant triggers deactivate after
the first error**, so a single DLQ-full error is enough. `maxErrors` does not
govern this webhook scenario.

**So `isinvalid: true` is a symptom, not a second defect.** The blueprint
itself is clean: no broken module references, no empty required fields, and
all three connections are alive and correctly scoped (Google `6237841`
joshua@apexdentalmarketing.net, OpenAI `9779619`, Slack bot `556114`). There
is nothing to repair in the scenario's configuration. Clear the queue and it
becomes valid again.

**Org-wide exposure while the queue stays full:** 298 of the 337 scenarios are
active, and all 391 queued items belong to this one scenario. Any other
scenario that errors right now cannot store its incomplete execution, so that
bundle is lost instead of being held for retry. This is worth clearing for the
rest of the estate, not just for this scenario.

There is no storage indicator anywhere in the Make UI. The org dashboard shows
credits and data transfer only; the 500MB ceiling appears nowhere except inside
the text of an execution error. Nobody could have seen this coming.

**A separate queue, and the more expensive one: 2,268 webhook records.** The
hook has been accepting calls the whole time the scenario has been inactive,
and the backlog was still climbing while it was being read. These are not DLQ
items — they are unprocessed trigger payloads, and they all flood in on
activation, at scheduling `immediately` with up to 100 runs per minute. **Most of them are cheap, and that matters.** Across a 48-run sample of the
8 September burst the distribution was 37 runs at 200 centicredits, 3 at 100,
2 at 300, 2 at 500 and 4 at 800 — average **2.6 credits**, not 8. The 8-credit
runs are the ones that download audio and transcribe; the 2-credit ones write
the RAW DATA row in two operations and go no further, because most calls have
no recording to transcribe.

So the backlog is roughly **5,900 credits against 17,063 remaining** in the
period (22,937 of 40,000 used) — affordable, and it backfills eleven days of
RAW DATA. An earlier draft of this file priced every run at 8 credits and put
the figure at 18,100, which would have made the backlog unaffordable and
argued for discarding it. That was wrong: the 8-credit figure came from a
sample filtered to errors, and the failures were disproportionately the
expensive transcription runs.

What the backlog does not buy is anything on the dashboard, because this chain
writes RAW DATA and the GoHighLevel contact while the Hub reads CALL SUMMARIES
on the orphaned chain. Its value is eleven days of contact notes, and eleven
days of RAW DATA history for a future import.

### 2. The chain that feeds the Hub is orphaned, and clearing the queue will not fix it

The blueprint contains **two** pipelines. Only one is attached to the webhook.

| | Connected (runs) | Orphaned (does not run) |
|---|---|---|
| Trigger | webhook #1 | HotProspector `FetchLeadCallLogs` #41 |
| Transcription | `openai-gpt-3:CreateTranscription` #103 | `assembly-ai:UploadFile` #28 → `TranscribeAudio` #48 |
| AI | `transformTextToStructuredData` #104 | six `openai:CreateCompletion` #50–#55 |
| Writes | **RAW DATA** row (#5, 22 cols); `PUT /contacts/{id}` in GHL (#109); Slack | **CALL SUMMARIES** row (#56, 12 cols); Slack |

The **16** orphaned modules sit in `metadata.designer.orphans` — Make's term
for detached from the trigger, and confirmed visually in the editor as a
separate lower chain with no link from the webhook. Detached modules never
execute. In order:

`#41 http:ActionSendData` (HotProspector, with its own Break #85) →
`#26 json:ParseJSON` → `#27 http:ActionGetFile` → `#28 assembly-ai:UploadFile`
→ `#48 assembly-ai:TranscribeAudio` → `#50`–`#55` six OpenAI completions →
`#56 google-sheets:addRow` (CALL SUMMARIES) →
`#77 google-sheets:filterRows` (the GHL Directory tab) →
`#57 builtin:BasicRouter` → `#58`/`#59 slack:CreateMessage`.

**The Hub imports CALL SUMMARIES.** That tab is written only by orphaned
module #56. This is why the Hub holds 215 transcripts and no more: they date
from whenever that chain was last connected. Clearing the queue and
reactivating restores the RAW DATA row and the GoHighLevel contact write — it
will not add a 216th summary.

The grading and SOP columns come from that same orphaned chain (#53 the sales
audit, #54 the coaching, #55 the SOP answer), so the backfill of
`grading`/`process_followed` into the existing 215 rows is the most that data
will ever cover unless the chain is reconnected.

Two ways forward, and this is a judgement call rather than a fix:

- **Reconnect #41→#56** in the Make editor so CALL SUMMARIES resumes. Restores
  transcript, summary, coaching, grading and SOP. Costs an AssemblyAI upload
  and six GPT completions per call.
- **Point the Hub at RAW DATA instead.** The connected chain writes it, so it
  is live the moment the scenario is reactivated. It carries `agent_name`,
  `call_duration`, `call_disposition`, `call_direction`, `call_status`,
  `call_time`, both numbers, `leadId` and `ghl_location_name` — everything
  per-agent call efficiency needs, one row per call. It carries no transcript,
  summary, grading or SOP answer.

Doing both is reasonable: RAW DATA for the live counters, the reconnected
chain for the coaching text.

### 3. A live credential is sitting in the blueprint

Orphaned module **#41** posts to `https://app.hotprospector.com/glu/custom_api`
with a HotProspector `api_uId` and `api_key` written as plaintext in the
request body, inside the blueprint. Anyone who can export or read the scenario
has them.

**Rotate that HotProspector key**, and if the chain is reconnected, move both
values into a Make connection or a data store rather than the module body.
The key is not repeated here on purpose.

## What only you can do

The Make API exposed to me has `executions_list`, `executions_get` and
`executions_get-detail` and **no incomplete-execution endpoint at all** — the
queue cannot be listed, retried or cleared programmatically. The browser here
has no Make session, and signing in is not something I will do. So these three
steps are yours:

0. **Discard the 2,268 queued webhook records first.** Otherwise step 3 is an
   ~18,100-credit event against 17,063 remaining, for output the dashboard does
   not read. Permanent, so it is your call.

1. **Scenario 5560467 → incomplete executions → delete the 37 large items.**
   Retry is not available while the scenario is inactive: the queue page carries
   an orange banner saying auto-retry cannot run because the scenario is not
   active, every per-row retry icon is greyed out, and bulk selection offers
   **Delete only** — there is no bulk retry and no "clear all". So retrying
   requires activating first, which requires free space, which requires
   deleting. Deleting the 37 frees the whole 498.2MB. Permanent, so it is your
   call and not mine to make for you.

2. **Change Break #89 first, then switch storage off.** The setting is called
   "Store incomplete executions" in the UI and it **cannot be saved as No while
   Break #89 exists**: the save is refused with "Retry — This directive requires
   storing of incomplete executions to be enabled", offering only Ignore
   warnings / Cancel / Save anyway. Saving anyway leaves Make flagging the
   scenario invalid, which defeats reactivating it.

   So the order is: change module #5's `builtin:Break` handler to `builtin:Ignore`,
   then set storage to No. That is the correct fix on its own merits — a failed
   RAW DATA logging row should never park a multi-megabyte audio bundle for 45
   minutes — and it is what unblocks the setting.

3. **Reactivate it** — after 1 and 2, in that order. Reactivating before the
   queue is clear just reproduces the failure.

I got step 3 wrong earlier in this work: I activated the scenario while the API
response in front of me already said `isinvalid: true`. The item count went
from 37 to 391. What that actually added was ~354 records of about 2KB — under
a megabyte — so it did not cause the 498.2MB, which was already parked from
25–28 August. It made the list longer, not the problem bigger. The reason the
ordering above matters is the 2,268 webhook records, not those 354.

## Also dead, and nobody had noticed

**5539931** "CCD - Call Center Dashboard HP->Sheets->Slack" —
`isActive: false`, `isinvalid: true`, but `dlqCount: 0`. Its own queue is
clean, so whatever invalidated it is unrelated to the 500MB problem. It writes
an 11-column row to the **APPOINTMENT DATA** tab and then fans out to eleven
Slack messages. Last edited 9 August 2026.

Cause found, and it is small: execution `4c7153f6…` of 3 September reports
`DataError` on `slack:CreateMessage` —
`invalid_blocks (200).[ERROR] downloading image failed [json-pointer:/blocks/1/image_url]`.
A dead image URL in a Slack image block, not a connection fault; connection
9692482 "ISR Wins" is alive and scoped. By name the candidate modules are the
GIF messages #25, #34, #35, #45 and #43. Fixing this is replacing one broken
image URL.

Nine further scenarios are inactive and invalid, all PPS per-practice ones:
5970743, 5059193, 4509646, 4196863, 5059231, 4511107, 4196869, 4158796,
4259379. All have empty queues. Logged rather than touched.

## Current state, so nothing is ambiguous

- Scenario 5560467 is **off**. I confirmed this by calling deactivate, which
  returned "Scenario is not running." It stopped itself at 12:05:42 today.
- While it was briefly on, each failing run consumed 8 operations and up to
  13MB of transfer for a full transcription that was then thrown away at the
  final step. That waste has stopped.
- No new calls are being transcribed, and no new rows are reaching RAW DATA,
  CALL SUMMARIES or the GoHighLevel contact fields.
- The Hub's 215 imported summaries are unaffected and still serving.
