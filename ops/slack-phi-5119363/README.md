# Slack New Appt. Notification — removing the insurance block

Make scenario **5119363**, `Slack New Appt. Notification [ADM Ortho Snapshot]`.

## What the scenario does

A GoHighLevel webhook fires on a booking. Module 6 formats the appointment date
and time. Module 12 is a router with two routes, each ending in a Slack message
to private channel `C0B5PJQS5UG` (`appts-test`) on the *ADM - Client Success*
workspace, via connection `8962829`.

- **Module 2**, route "1st Consultation" — filter is `{"conditions": []}`, so it
  has no condition and fires on **every** payload, reschedules included.
- **Module 15**, route "Reschedule" — fires on `tags contains "reschedule"`.

Both message templates end in an `[Insurance Info]` block carrying policy holder
and beneficiary names and dates of birth, insurance provider, Policy ID,
Member ID and **Social Security Number**.

The scenario is **inactive**. It sits in the snapshot account, which is what
clones are made from, so it is one toggle away from posting SSNs.

## Why these files exist

`scenarios_update` replaces a blueprint wholesale — there is no partial edit —
and there is no way to pass a file into the Make API tooling from the agent
session. Applying this through the API would mean hand-typing ~13KB of
reconstructed JSON including a 66-entry webhook interface. A single mistyped
character damages a client scenario, whereas editing two text fields in the Make
UI cannot. Same outcome, so the edit is documented here and applied by hand.

- `5119363.original.json` — the blueprint as read on 31 Aug 2026. The rollback.
- `5119363.corrected.json` — identical, with the insurance block removed from
  both message templates.

Both were verified programmatically: 4 modules with ids `[1, 6, 7, 12]`, hook
`2331781`, 66 webhook interface entries, both Slack connections `8962829`,
channel unchanged, module 2's empty filter untouched. Neither file contains a
`samples` block, so no stored payload data is committed here.

## The edit

In Make, open 5119363 and delete this block from the **Text** field of module 2
and module 15, leaving the `Thank you!` sign-off directly after the appointment
lines:

```
[Insurance Info]
Policy Holder Name: {{1.`Policy Holder Name`}}
Policy Holder DOB: {{1.`Policy Holder Date of Birth (M/D/Y)`}}

Policy Beneficiary Name: {{1.`Policy Beneficiary Name`}}
Policy Beneficiary DOB: {{1.`Policy Beneficiary Date of Birth (M/D/Y)`}}

Insurance Provider: {{1.`Insurance Provider`}}
Policy ID: {{1.`Policy ID`}}
Member ID: {{1.`Member ID`}}
SSN: {{1.`Social Security Number`}}
```

## Three things this does not fix

**The empty filter stays.** Module 2 still fires on every payload. Route 2 keys
on `tags contains "reschedule"`, so `does not contain` would be the obvious
mirror — but that is an inference, and installing an invented filter condition is
worse than leaving a recorded fault. Someone who knows the intended tag should
set it.

**PHI remains in the message.** Patient date of birth, home address and stated
dental concern still post on every booking. Removing the insurance block was the
authorised scope; it does not make this message safe.

**The webhook still receives all 66 fields**, `Social Security Number` among
them, because that is GoHighLevel's payload spec rather than anything in this
blueprint. Active scenarios receive those fields too and retain them in Make's
execution history for 30 days while using none of them. That upstream fix —
removing unused fields from the GHL webhook payload — matters more than this
edit, because it closes the whole class rather than one instance.

## Unresolved

Whether this scenario ever actually posted is **not established**. Four Slack
searches returned nothing and `slack_read_channel` returned `channel_not_found`
— the Slack connection available to the agent session is on a different
workspace from *ADM - Client Success*. Those zero results mean "cannot see the
channel", not "nothing was posted", and must not be recorded as the latter.

Settling it needs a Slack connection on the right workspace, or someone opening
`appts-test` and searching for `Apex Scheduling Team`.
