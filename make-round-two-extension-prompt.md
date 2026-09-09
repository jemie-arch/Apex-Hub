# Round-two extension prompt — Make scenario 5560467

Paste the block below into the browser-extension agent session.

---

```text
CONTEXT — READ THIS FIRST, IT CORRECTS THE PREVIOUS BRIEF

You investigated Make scenario 5560467 read-only and reported back. Your report
corrected the earlier diagnosis on four points, all of which are now accepted:

  - The zone is us2.make.com, not us1.
  - The 500MB is 37 items, not 391: 37 Unresolved items of 25–28 August
    totalling 498.2MB, plus ~354 items of ~2KB created in a 64-second burst on
    8 September, worth about 0.8MB together.
  - Instant-trigger scenarios deactivate after the FIRST error, so maxErrors: 3
    does not govern this one.
  - There are 16 detached modules, not 14.

Two further things came out of costing your findings:

  - Across a 48-run sample of the 8 September burst the credit distribution was
    37 runs at 200 centicredits, 3 at 100, 2 at 300, 2 at 500 and 4 at 800 —
    an average of 2.6 credits, not 8. The cheap runs write the RAW DATA row in
    two operations and stop, because most calls have no recording to
    transcribe. So the 2,268-record webhook backlog costs roughly 5,900 credits
    against 17,063 remaining, which is affordable. The earlier claim of ~18,100
    was wrong: it priced every run at the cost of the failures, and the failures
    were disproportionately the expensive transcription runs.
  - The backlog is therefore worth processing rather than discarding. It
    backfills eleven days of the RAW DATA tab, which is about to become the
    Hub's live per-agent call feed.

The owner has approved the plan below, including the deletion in Task 1.

Scenario: 5560467 "Call Center Dashboard HP->SheetsAI->Transcript"
  https://us2.make.com/163072/scenarios/5560467
Team 163072, org 2206358, hook 2531828. Currently inactive and flagged invalid.

GOAL

Get the scenario running again in a configuration that cannot refill the queue,
then let the webhook backlog drain under supervision. Five tasks, strictly in
order. Task 4 is a hard stop.

TASK 1 — Delete exactly the 37 large items, and nothing else

Open the incomplete executions for scenario 5560467.

Scope gate, before deleting anything. Establish that the same 37 items are
selected two independent ways:

  a. Status filter = Unresolved. Report the count.
  b. Clear that, then Size filter Min = 100000 bytes. Report the count.

Both must read 37 and they must be the same items. If either count is not 37,
STOP and report — do not delete.

Then select those 37 and delete them. Report the "N selected" figure before you
click Delete; it must read 37.

Do NOT delete the ~354 small items. They are ~2KB each, they total under a
megabyte, they are not causing the problem, and some carry status "In progress"
which may mean live queued work. Freeing the 37 releases 498.2MB, which is all
the headroom needed.

Afterwards report the remaining item count and, if the UI shows it anywhere, the
freed size.

TASK 2 — Replace the Break error handler on module #5 with Ignore

In the editor, module #5 is the google-sheets:addRow writing the RAW DATA tab.
It carries an error handler, module #89, a builtin:Break directive configured
retry: true, count: 3, interval: 15.

Replace that Break directive with an Ignore directive on the same handler
route. Make may not allow changing a directive's type in place; if not, remove
the Break and add Ignore in its place.

Why Ignore specifically, so you can tell if the editor is doing something else:
Break parks the failing bundle in the queue, which is what filled 500MB with
audio. Simply deleting the handler is NOT acceptable either — with no handler
the error propagates, and an instant-trigger scenario deactivates on the first
error, so one Google Sheets hiccup would switch the scenario off again. Ignore
swallows the error so the run ends without parking anything and without
deactivating the scenario.

Save, and report what the editor allowed you to do and any warning it raised.

TASK 3 — Switch off incomplete-execution storage

Scenario settings → "Store incomplete executions" → No → Save.

This save was refused last time with "Retry — This directive requires storing of
incomplete executions to be enabled", because of the Break directive. With
Task 2 done it should now save cleanly. If the same warning still appears, STOP
and report — it means Task 2 did not take effect.

Leave "Errors before deactivation" (3), "Process data in order" (No), "Commit
after each module" (Yes), "Commit trigger last" (Yes) and "Keep data
confidential" (No) untouched. Report all values after saving.

TASK 4 — HARD STOP. Report the Slack blast radius and wait

Activation drains 2,268 queued webhook records. The connected chain ends at
module #110, slack:CreateMessage. On the sampled distribution roughly 8% of runs
go the full distance, so activation will post on the order of 180 Slack
messages into whatever channel #110 targets.

Before activating, report:

  a. Which Slack channel or conversation module #110 posts to.
  b. Whether the message is per-call.
  c. The current webhook queue count (it was 2,268 and climbing).
  d. The current credit figure from the org dashboard (it was 22,937 of 40,000).

Then STOP and wait for an explicit answer on whether to disable module #110
before activating. Do not activate until you have that answer. The owner has a
standing rule against sending messages on the company's behalf as part of this
work, and ~180 automated Slack posts is exactly the thing that rule exists for.

TASK 5 — Activate, then supervise the drain

Only after Task 4 is answered.

Preconditions to verify and state before clicking activate:
  - Incomplete executions: the 37 are gone.
  - "Store incomplete executions": No.
  - Module #5's handler: Ignore, not Break.
  - Task 4 answered, and #110 disabled if that was the decision.

Activate. Then supervise rather than walking away:

  a. After roughly 200 runs have processed, report the credit figure again. The
     estimate says ~2.6 credits per run, so ~200 runs should cost ~520 credits.
     If the actual burn implies materially more than about 4 credits per run,
     DEACTIVATE and report — the backlog estimate was wrong and the owner wants
     to reconsider before the rest drains.
  b. Report whether the scenario stays active, and whether dlqCount stays 0.
     Anything parking again means Task 2 did not work.
  c. Report the webhook queue count falling, so we know the backlog is actually
     draining and not stalling.

Deactivating mid-drain is safe and reversible — prefer it over letting something
unexpected run.

ALSO REPORT, DO NOT FIX

Scenario 5539931 is failing on a dead image URL in a Slack image block:
"invalid_blocks (200).[ERROR] downloading image failed
[json-pointer:/blocks/1/image_url]". By name the candidates are the GIF messages
#25, #34, #35, #45 and #43.

Identify which module holds the broken URL and report the URL itself. Do not
replace it — we do not know what it is supposed to point at, and guessing an
image URL is not a fix. Do not activate that scenario.

DO NOT

  - Do not reconnect the 16 detached modules. Whether to restore that chain is a
    separate decision that has not been made.
  - Do not delete the ~354 small incomplete executions.
  - Do not discard the webhook backlog.
  - Do not type, paste or read out any API key, token or password. Orphaned
    module #41 holds a HotProspector api_uId and api_key in plaintext; leave it
    closed. It needs rotating, but not by you.
  - Do not send any Slack message or email yourself.
  - Do not touch any scenario other than 5560467, and on 5539931 only look.
  - If anything contradicts this brief, stop and report rather than improvising.

REPORT BACK

  1. Task 1: both scope-gate counts, the selected count, and the remaining count.
  2. Task 2: what you changed on #5's handler and any warning.
  3. Task 3: whether the save succeeded, and all six settings values after.
  4. Task 4: a–d, and confirmation you stopped.
  5. Task 5: preconditions as verified, then the credit burn per run, whether the
     scenario stayed active, dlqCount, and the webhook queue trend.
  6. 5539931: the module and the broken URL.
  7. Anything that did not match this brief.
```
