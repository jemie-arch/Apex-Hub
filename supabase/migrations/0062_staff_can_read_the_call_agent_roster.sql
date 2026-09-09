-- Staff can read the roster, matching call_summaries_staff_read.
--
-- Without this, RLS-enabled-with-no-policy means only the service role sees
-- call_agents — and v_call_summary_agent_daily is security_invoker, so a staff
-- client reading it would get its LEFT JOIN silently return nothing:
-- agent_display_name would fall back to the raw sheet name and has_profile
-- would read false for everybody. The scoreboard is served by the service
-- client today, so this is a correctness guard for the next caller rather than
-- a fix for a live fault.
--
-- No client access, deliberately. A roster is a list of employees, which is the
-- same reason call_summaries keeps the practices out.

create policy call_agents_staff_read on call_agents
  for select
  using (auth_role() is not null and auth_role() <> 'client');

create policy call_agent_aliases_staff_read on call_agent_aliases
  for select
  using (auth_role() is not null and auth_role() <> 'client');
