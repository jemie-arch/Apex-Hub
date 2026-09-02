-- Clear the second onboarding test from the live tables.
--
-- The 2 September test of automated user creation went through the real form,
-- so it left real records: a submission, a provisioning run, and a client and
-- group for a practice that does not exist. It did its job -- it proved
-- createLocationUser works against live GoHighLevel (ghl_user_id
-- Ox0hw5VQKuj8wVatoVS0) and it disproved the Timezone diagnosis from an hour
-- earlier -- and what remains is a test account holding a live portal token.
--
-- READ THIS BEFORE ASSUMING IT WORKED. Deleting a test practice here does not
-- keep it deleted.
--
-- crm-clients runs first in the nightly cycle, reads the agency's GoHighLevel
-- locations, and creates a client_group and clients row for every location it
-- does not already recognise. GoHighLevel is the source of truth for which
-- practices exist, so a sub-account that still exists there comes back -- with
-- a new group, status 'onboarding', and a fresh portal token.
--
-- That is not a hypothesis. Migration 0033 deleted 'ZZ Automation Test
-- 2026-09-02' last night; the 06:01 sync recreated it, pointing at the same
-- sub-account sIH2Y92UVvmY0SgNcPiQ, and the live portal count went from 71 back
-- to 73. This migration will be undone the same way at the next cycle unless
-- the sub-account behind it is removed in the agency first.
--
-- So the order matters, and it is the opposite of the one I used: delete the
-- GoHighLevel sub-account, then let crm-clients stop re-importing it. Running
-- this on its own is worth doing only to tidy the tables in between.
--
-- Still to remove by hand in GoHighLevel, and the reason any Hub-side count of
-- test accounts is unstable until they are gone:
--
--   4g2h50VsL4xGh9Pyci6y   this test, plus user Ox0hw5VQKuj8wVatoVS0
--   sIH2Y92UVvmY0SgNcPiQ   the first test, already proven to return
--
-- aBJM60CPjxxzkaxQsptb and kwNClh7UHk57MYTZ4HOO from August have not come back,
-- which suggests those two are already gone from the agency.
--
-- Children first, so nothing is left pointing at a row that has gone.

delete from provisioning_runs
 where clinic_name = 'ZZ User Automation Test 2026-09-02';

delete from form_submissions
 where clinic_name = 'ZZ User Automation Test 2026-09-02';

delete from clients
 where group_id in (
   select id from client_groups
    where name = 'ZZ User Automation Test 2026-09-02'
 );

delete from client_groups
 where name = 'ZZ User Automation Test 2026-09-02';
