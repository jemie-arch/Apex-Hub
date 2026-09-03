-- Who booked the appointment, so a bonus can be attributed to a person.
--
-- appointment_ledger has carried a booked_by_name column since 0001 and it is
-- populated on 0 of 1,358 rows, because nothing supplies it. The ledger was
-- designed expecting this fact and never given it.
--
-- It matters now beyond tidiness. The ISR bonus is a daily tiered payment --
-- five appointments in a day pays $10, six pays $20, eight pays $30 -- so
-- paying it automatically requires knowing which ISR set each appointment.
-- GoHighLevel cannot answer that: 157 of 6,947 calls carry a user, because
-- practice numbers forward inbound calls to an external line before any
-- GoHighLevel user touches them. The Client Fulfilment Tracker is where the
-- booker is recorded, and the one-off import never carried the column.
--
-- Nullable and unbackfilled on purpose. Every existing row genuinely does not
-- know who booked it, and inventing an attribution for 1,281 historical rows
-- would put a name against work somebody may not have done -- which, for a
-- column that feeds a payment, is the worst possible kind of wrong.
alter table tracker_appointments
  add column if not exists booked_by text;

comment on column tracker_appointments.booked_by is
  'The ISR or agent who set this appointment, as named in the Client Fulfilment Tracker. Null on every row imported before 2 September 2026, when the tracker import did not carry the column. Feeds appointment_ledger.booked_by_name and, through it, ISR bonus attribution.';

create index if not exists tracker_appointments_booked_by_idx
  on tracker_appointments (booked_by)
  where booked_by is not null;
