/*
 * Limestone Hills Orthodontics and Metro Dental & Implant Studio churned.
 *
 * Joshua, 15 September 2026, correcting the sheet-coverage report: "lime
 * stone, metro dental are clinics that churned." The Hub still had both
 * groups at 'onboarding' with active client rows, so they appeared in every
 * active-practice list - 55 and 46 historical appointments between them,
 * no spend and no sheet booking on record. Neither is a maintenance
 * candidate, in his words: "churned ones aren't necessary to do maintenance
 * on, they're already gone."
 *
 * churned_on is the day he said so, not the day they left, which nobody has
 * recorded. The check constraint requires a date; this one is honest about
 * what it is.
 *
 * Status only. Their history stays; the tracker shows them as Churned.
 */
update public.client_groups
set status = 'churned',
    churned_on = coalesce(churned_on, date '2026-09-15')
where name in ('Limestone Hills Orthodontics', 'Metro Dental & Implant Studio')
  and status::text <> 'churned';
