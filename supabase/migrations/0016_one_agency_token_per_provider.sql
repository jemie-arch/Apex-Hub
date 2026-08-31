-- ===========================================================================
-- One agency-level token per provider, enforced rather than assumed.
--
-- oauth_tokens holds two different shapes: per-location GoHighLevel rows keyed
-- by crm_location_id (73 of them), and agency-level rows belonging to no client
-- at all (1). Hubstaff is the second kind, and it has a property that makes a
-- duplicate genuinely dangerous rather than merely untidy.
--
-- Hubstaff's refresh token rotates on every exchange and the string that was
-- used immediately stops being accepted. Two rows for one provider therefore
-- means two stored refresh tokens of which at most one is alive, and a sync that
-- fails permanently the moment it reads the wrong row — with no way to tell from
-- the error which row was stale.
--
-- Partial, so the per-location GoHighLevel rows are untouched. Safe to apply:
-- exactly one agency-level row existed at the time of writing.
-- ===========================================================================
create unique index if not exists oauth_tokens_one_agency_per_provider
  on oauth_tokens (provider)
  where crm_location_id is null and client_id is null;

comment on index oauth_tokens_one_agency_per_provider is
  'An agency-level provider gets exactly one row. Matters for rotating-refresh-token providers such as Hubstaff, where a second row would hold a refresh token that has already been invalidated by the first.';
