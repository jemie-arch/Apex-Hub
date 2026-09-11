/*
 * Creative performance, for media buying.
 *
 * The ask was a tool that analyses the ad accounts, finds winners and suggests
 * what to run next - the job a third-party "ad spy" product does against other
 * people's ads, pointed instead at our own 565.
 *
 * The hard part was deciding what a winner is allowed to be measured on.
 *
 * NOT leads, and not cost per lead. Meta reports 228 leads against $104,920 of
 * spend, and 32 of our 36 ad accounts report exactly zero. The lead figure is
 * not a performance signal, it is a record of which accounts have the pixel
 * wired up. Ranking on it would rank the plumbing.
 *
 * NOT bookings either, which is the number anyone would actually want. Every
 * one of the 1,443 rows in appointments has a null ad_external_id, and so does
 * every row in tracker_appointments. Nothing in the pipeline writes it. The
 * only ad attribution that exists anywhere is on tracker_leads, and 480 of its
 * 1,101 resolvable rows name an ad belonging to a DIFFERENT practice - the
 * same cross-join that made campaign-level cost per lead unusable. A 56%-clean
 * signal is worse than no signal, because it looks like data.
 *
 * What Meta does report per ad, accurately, is delivery: spend, impressions,
 * clicks and reach. Those come from the ad account's own billing and serving
 * records rather than from any tracking we installed, so they are the same
 * numbers Meta bills against. CTR and CPC built from them are honest.
 *
 * Frequency is deliberately not aggregated here. It is impressions over reach,
 * and reach counts unique people - summing it across days counts the same
 * person once per day, so a window-level frequency would be wrong in a way
 * nobody could see. The fatigue signal is built from the CTR trend instead,
 * which needs only impressions and clicks.
 *
 * Daily grain, because the window is chosen in the UI and a view cannot take a
 * parameter. The rollup and the winner/fatigue judgement live in TypeScript
 * where they can be commented and changed without a migration.
 *
 * Internal accounts are excluded, the same rule 0068 applies to the client
 * tracker. Without it the single best creative on the fleet is "New Leads Ad"
 * at 3.64% CTR and $0.06 a click - which is Ad Account 13, the recruitment
 * account. It is not a better dental ad, it is a different product sold to a
 * different audience, and 0069 already reports it separately through
 * v_recruitment_ads. Ranking it beside patient creatives would tell media
 * buying to go and copy a job advert.
 *
 * security_invoker so the caller's RLS decides which practices are visible.
 */
create or replace view public.v_ad_creative_daily
with (security_invoker = on) as
  select
    i.insight_on                as day,
    d.id                        as ad_id,
    d.name                      as ad_name,
    d.client_id,
    c.name                      as client_name,
    c.group_id,
    g.name                      as group_name,
    i.spend_cents,
    i.impressions,
    i.clicks,
    i.reach
  from ad_level_insights i
  join ads d           on d.id = i.ad_id
  join clients c       on c.id = i.client_id
  left join client_groups g on g.id = c.group_id
  where not coalesce(c.is_internal, false);

comment on view public.v_ad_creative_daily is
  'Per-ad daily delivery (spend, impressions, clicks, reach) with creative name and practice. Deliberately carries no leads column, and excludes internal accounts - see migration 0073.';
