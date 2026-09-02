-- Record the login provisioning creates for the practice.
--
-- Onboarding built a sub-account, applied the snapshot and filled the merge
-- fields, then stopped -- leaving an account nobody could sign into. Every GHL
-- path in the codebase was checked and there was no /users call anywhere, so
-- creating the practice's login had always been a manual step nobody had
-- written down. A practice cannot use what it cannot open.
--
-- Two columns rather than one, for the same reason values_written and
-- values_missing are separate: "no user was made" and "a user was made and here
-- it is" have to be distinguishable months later, and a null id with no reason
-- beside it says only that somebody once did not look.
alter table provisioning_runs
  add column if not exists ghl_user_id text,
  add column if not exists user_error  text;

comment on column provisioning_runs.ghl_user_id is
  'The GoHighLevel user created for the practice on this run, so they can sign in to their own sub-account. Null means none was created -- see user_error for why, which is null on runs from before this was automated.';

comment on column provisioning_runs.user_error is
  'Why the practice login could not be created. Recorded rather than raised: a sub-account with every merge field filled and no user is still worth keeping, and the run is retried by provision-pending.';
