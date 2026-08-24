-- ===========================================================================
-- A bi-weekly Friday payout that pays on a Thursday is not a payout.
--
-- The first anchor was 2026-01-02, which is a Friday. A 14-day period opening
-- on a Friday CLOSES on a Thursday, so all eighteen generated periods paid on a
-- Thursday and nothing objected — the function did exactly what it was told and
-- what it was told was wrong.
--
-- Enforced now rather than trusted: a period that pays on any other weekday
-- fails to insert. That turns a silent off-by-one into a failed migration.
--
-- A fortnight that closes on a Friday has to open on a Saturday, hence the
-- anchor moving to 2026-01-03. The setting keeps its name — renaming the key
-- would orphan the row it points at.
--
-- Safe to delete and regenerate: no payout_lines existed yet, so nothing was
-- attached to the wrong periods.
-- ===========================================================================
delete from payout_lines;
delete from payout_periods;

alter table payout_periods drop constraint if exists payout_periods_pay_on_friday;
alter table payout_periods
  add constraint payout_periods_pay_on_friday
  check (extract(isodow from pay_date) = 5);

update app_settings
set value = to_jsonb('2026-01-03'::text)
where key = 'payout_anchor_friday';

comment on table payout_periods is
  'A fortnight of work and the Friday it pays on. Periods run Saturday to Friday and pay on the closing Friday, which is why the anchor is a Saturday — anchoring on a Friday makes the period close on a Thursday. The pay_date check enforces it, because that mistake was made once and produced eighteen periods paying on the wrong weekday without a single error.';
