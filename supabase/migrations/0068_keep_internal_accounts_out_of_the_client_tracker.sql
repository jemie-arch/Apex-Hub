-- Internal accounts do not belong in the Client Fulfilment Tracker.
--
-- The clue is in the name, and the view was not enforcing it: one internal
-- client already appeared, harmlessly, because it had no spend. That stops
-- being harmless the moment an internal account has money against it — which is
-- exactly what happens in 0069, when the hiring ad account is mapped so its
-- recruitment spend can be reported. Without this, attaching that account would
-- push $526 of recruitment spend and 119 job applicants INTO fleet cost per
-- lead, which is the precise opposite of what mapping it is for.
--
-- Rewritten by wrapping its own definition rather than by retyping it. The view
-- is about a hundred lines of CTEs, and a hand-copy risks a transcription error
-- in something that reports client spend. `select q.*` guarantees the column
-- list, order and types are identical to what callers already select.

do $$
declare
  def text;
begin
  select pg_get_viewdef('v_cft_stats_dashboard'::regclass, true) into def;

  /* pg_get_viewdef returns a trailing semicolon, which cannot sit in a subquery. */
  def := rtrim(btrim(def), ';');

  execute format(
    'create or replace view v_cft_stats_dashboard as
       select q.*
       from (%s) q
       join clients c on c.id = q.client_id
       where not c.is_internal',
    def
  );
end
$$;

comment on view v_cft_stats_dashboard is
  'Per client per campaign per day, for the Client Fulfilment Tracker. '
  'Excludes clients flagged is_internal — ADM''s own accounts, test clinics and '
  'the hiring ad account are not client fulfilment and must never reach a '
  'client cost-per-lead figure.';
