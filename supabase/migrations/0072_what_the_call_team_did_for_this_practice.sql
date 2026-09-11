/*
 * The call-centre panel in the client portal.
 *
 * Joshua asked for the portal to carry accurate tracking from marketing, the
 * call centre and ads. Ads is the creatives page and marketing is the
 * dashboard; the call centre was the missing third, and until raw_call_rows
 * landed there was no per-call data to build it from.
 *
 * Grouped by group_id rather than client_id because the portal is issued per
 * group - a multi-location practice gets one token and expects one number
 * covering all of its sites, not a figure that silently omits two of them.
 *
 * Four counters only. What is absent is the deliberate part:
 *
 *   No cost, spend or cost-per-anything. The portal states that rule on its
 *   own landing page. A call panel is exactly where it creeps back in.
 *
 *   No patient names, numbers or transcripts. A practice owning the patient
 *   relationship does not make our call log theirs to browse.
 *
 *   No agent names. Which of our staff dialled is our business, and naming
 *   them turns a service report into a performance review nobody asked for.
 *
 *   No no-answer or hang-up counts. The internal board carries them because
 *   the team can act on them. A practice reading "412 no answers" learns
 *   nothing and draws a conclusion about effort the number does not support.
 *
 * A conversation is 90 seconds or more - the same threshold the internal
 * board uses, so the two can never tell different stories about one week.
 *
 * security_invoker so the caller's RLS decides which groups are visible; the
 * portal route already resolves a token to exactly one group before querying.
 */
create or replace view public.v_portal_call_activity
with (security_invoker = on) as
  select
    cl.group_id,
    r.called_on as day,
    count(*) as calls,
    count(*) filter (where coalesce(r.duration_seconds, 0) >= 90) as conversations,
    count(*) filter (where r.disposition ilike '%booked%') as appointments,
    sum(coalesce(r.duration_seconds, 0)) as talk_seconds
  from raw_call_rows r
  join clients cl on cl.id = r.client_id
  where r.called_on is not null
    and cl.group_id is not null
  group by cl.group_id, r.called_on;

comment on view public.v_portal_call_activity is
  'Call-centre activity for the client portal, by group and day. No cost, no agent names, no patient detail, no no-answer counts.';
