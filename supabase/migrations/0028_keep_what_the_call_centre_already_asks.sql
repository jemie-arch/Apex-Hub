-- Stop discarding answers the call centre already collects.
--
-- The GoHighLevel appointment update form asks roughly twenty questions. Make
-- scenario 6109500 forwards three of them — did they start treatment, what was
-- it worth, and why not. Everything else is answered, paid for, and thrown away
-- at the webhook because the Hub has nowhere to put it.
--
-- Four of the discarded answers have a consumer here:
--
--   treatment_opted_for   the Hub knows an appointment was won and what it was
--                         worth, but not what was sold. Revenue by treatment is
--                         not answerable today.
--   deposit_collected     the strongest early signal that a "won" will hold.
--                         Sits naturally beside cc_on_file, which already exists.
--   payment_method        finance and insurance splits, for the same reason.
--   insurance_provider
--
-- Deliberately NOT added: Readiness and Stage Booked. Both are call-centre
-- funnel internals with no reader on this side, and a column nobody queries is
-- its own kind of debt — it looks like data, ages badly, and the next person
-- assumes somebody depends on it. They stay in GoHighLevel until something here
-- actually asks the question.
--
-- All four are free text rather than enums except the boolean. The values come
-- from a form somebody else owns and can change without telling us; an enum
-- would turn a new dropdown option into a failed webhook, and losing the whole
-- submission to protect a column's tidiness is the wrong trade.
alter table appointments
  add column if not exists treatment_opted_for text,
  add column if not exists deposit_collected   boolean,
  add column if not exists payment_method      text,
  add column if not exists insurance_provider  text;

comment on column appointments.treatment_opted_for is
  'Which treatment the patient chose, as the call centre recorded it. Free text because the option list lives in a GoHighLevel form we do not control. Distinct from outcome, which says whether they proceeded, and from value_cents, which says what it was worth.';

comment on column appointments.deposit_collected is
  'Whether a deposit was taken at the consultation. Null means not asked, not no — the same tri-state discipline as showed and cc_on_file, because a missing answer must never bill as a negative.';

comment on column appointments.payment_method is
  'How the patient intends to pay, as recorded by the call centre. Free text.';

comment on column appointments.insurance_provider is
  'The patient''s insurer, as recorded by the call centre. Free text.';
