-- Take the test accounts out of the live tables.
--
-- Five groups in client_groups are not practices. Four are debris from build
-- and debugging sessions; the fifth is mine, from the end-to-end test of
-- automated onboarding on 2 September. All five carry portal_enabled = true and
-- a portal token, which is why the fleet read as 75 live portals when the real
-- number is 70.
--
-- That mattered beyond tidiness: every portal count in this work — "75 live
-- portals, zero practices using them" — was inflated by records that no
-- practice was ever going to open.
--
-- Checked before deleting. All five hold exactly one client and nothing else:
-- no appointments, no tracker rows, no ad snapshots, no ledger rows, no calls,
-- no billing. Deleting them orphans nothing.
--
-- Two are treated differently on purpose.
--
-- 'ADM Testing Grounds' and 'CloseBot v2 Test' are both status = 'paused' and
-- were created on the same day, which reads as somebody parking a sandbox
-- deliberately rather than leaving a mess. A sandbox is worth keeping and a
-- deletion is not reversible, so they keep their rows and lose only the portal
-- — which is the part that was distorting the count and the part nobody needs.
--
-- The two 'jemie test' groups and my own 'ZZ Automation Test 2026-09-02' are
-- unambiguous debris and go entirely.
--
-- None of this touches GoHighLevel. The sub-accounts behind these rows still
-- exist there and have to be removed by hand, including sIH2Y92UVvmY0SgNcPiQ,
-- which the test created.

-- 1. The sandboxes: keep the record, close the portal.
update client_groups
   set portal_enabled = false
 where name in ('ADM Testing Grounds', 'CloseBot v2 Test');

-- 2. The debris, children first.
delete from provisioning_runs
 where clinic_name = 'ZZ Automation Test 2026-09-02';

delete from form_submissions
 where clinic_name = 'ZZ Automation Test 2026-09-02';

delete from clients
 where group_id in (
   select id from client_groups
    where name in ('jemie test', 'ZZ Automation Test 2026-09-02')
 );

delete from client_groups
 where name in ('jemie test', 'ZZ Automation Test 2026-09-02');
