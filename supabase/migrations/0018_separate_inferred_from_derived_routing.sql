-- Tell a name match apart from an abbreviation guess.
--
-- 'derived' has meant one thing: the Hub's client name and the Make folder name
-- are the same practice name once punctuation is normalised. That is evidence.
--
-- Six practices are plainly the same clinic under two naming conventions —
-- "TMJ Sleep Airway Orthodontics - Gainesville" in the Hub is "Airway
-- Orthodontics - GNV" in Make — but reading GNV as Gainesville is a guess, even
-- a well-supported one. Filing those as 'derived' would let a weaker claim
-- inherit a stronger word, and the verifier could not tell which was which.
--
-- Both still require a human to verify before pps_routing_export will use them.
-- The distinction is not about safety, it is about telling the person doing the
-- verifying how hard to look.
alter table pps_clinic_routing
  drop constraint pps_clinic_routing_source_check;

alter table pps_clinic_routing
  add constraint pps_clinic_routing_source_check
  check (source = any (array['derived', 'inferred', 'manual']));

comment on column pps_clinic_routing.source is
  'How this sheet came to be proposed. derived: the practice name in the Hub and in Make agree, so the scenario''s own spreadsheet id was taken directly. inferred: the names differ and were matched through an abbreviation or a naming convention — a reasonable read, not an identity match, so check this one properly. manual: somebody typed it. None of the three route anything until verified_at is set.';
