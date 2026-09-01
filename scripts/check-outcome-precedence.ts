/**
 * Exercise the rule that decides whose consultation answer survives.
 *
 * Three parties write the same eight columns — the practice in their portal, the
 * call centre in /b2c, and the GoHighLevel update form at the webhook. Until
 * 0027 there was no rule at all: whoever wrote last won, silently, which made
 * the portal's on-screen promise ("nothing you type here is overwritten by our
 * systems") false the first time two of them touched the same consultation.
 *
 * Worth testing rather than eyeballing, because every case here is a quiet
 * wrong number rather than an error — a treatment value replaced by a guess
 * looks exactly like a treatment value.
 *
 *   npm run check:precedence
 *
 * No database, no network. Exits non-zero on the first failure.
 */
import { applyPrecedence } from '../src/lib/outcomes/precedence';

let failures = 0;
let checks = 0;

function check(what: string, actual: unknown, expected: unknown) {
  checks += 1;
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    console.log(`  ok    ${what}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL  ${what}\n          expected ${b}\n          actual   ${a}`);
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------------------
section('An empty row: anyone may write anything');
{
  const { changes, dropped } = applyPrecedence(
    {},
    { showed: true, outcome: 'won', value_cents: 480000 },
    'call_centre',
  );
  check('attendance written', changes['showed'], true);
  check('outcome written', changes['outcome'], 'won');
  check('attendance provenance stamped', changes['showed_source'], 'call_centre');
  check('outcome provenance stamped', changes['outcome_source'], 'call_centre');
  check('nothing dropped', dropped, []);
}

section('The practice has answered: the call centre may not overwrite');
{
  const existing = {
    showed: true,
    showed_source: 'client',
    outcome: 'won',
    value_cents: 480000,
    outcome_source: 'client',
  };
  const { changes, dropped } = applyPrecedence(
    existing,
    { showed: false, outcome: 'lost', value_cents: 0 },
    'call_centre',
  );
  check('attendance kept', 'showed' in changes, false);
  check('outcome kept', 'outcome' in changes, false);
  check('treatment value kept', 'value_cents' in changes, false);
  check('all three reported', dropped.sort(), ['outcome', 'showed', 'value_cents']);
  check('no provenance restamped', 'outcome_source' in changes, false);
}

section('The practice left a blank: the call centre may fill it');
{
  const existing = {
    showed: true,
    showed_source: 'client',
    outcome: 'won',
    value_cents: null,
    financing_approved: null,
    outcome_source: 'client',
  };
  const { changes, dropped } = applyPrecedence(
    existing,
    { outcome: 'lost', value_cents: 250000, financing_approved: true },
    'call_centre',
  );
  check('the answered outcome is kept', 'outcome' in changes, false);
  check('the blank value is filled', changes['value_cents'], 250000);
  check('the blank financing is filled', changes['financing_approved'], true);
  check('only the answered one dropped', dropped, ['outcome']);
  check('provenance moves to the writer', changes['outcome_source'], 'call_centre');
}

section('The practice always wins, even over its own earlier answer');
{
  const existing = { outcome: 'won', value_cents: 480000, outcome_source: 'client' };
  const { changes, dropped } = applyPrecedence(
    existing,
    { outcome: 'lost', value_cents: 0 },
    'client',
  );
  check('outcome replaced', changes['outcome'], 'lost');
  check('value replaced, including with zero', changes['value_cents'], 0);
  check('nothing dropped', dropped, []);
}

section("'pending' is not an answer — it is the default");
{
  const existing = { outcome: 'pending', outcome_source: 'client' };
  const { changes, dropped } = applyPrecedence(
    existing,
    { outcome: 'won' },
    'call_centre',
  );
  check('a half-opened form does not lock the row', changes['outcome'], 'won');
  check('nothing dropped', dropped, []);
}

section('An empty note is not an answer either');
{
  const existing = { notes: '   ', outcome_source: 'client' };
  const { changes } = applyPrecedence(existing, { notes: 'Quoted, deciding' }, 'call_centre');
  check('whitespace counts as blank', changes['notes'], 'Quoted, deciding');
}

section('The two groups are governed separately');
{
  // The calendar knows who turned up; it does not know what treatment was worth.
  const existing = {
    showed: true,
    showed_source: 'client',
    outcome: null,
    outcome_source: null,
  };
  const { changes, dropped } = applyPrecedence(
    existing,
    { showed: false, outcome: 'won' },
    'crm',
  );
  check('practice attendance survives the sync', 'showed' in changes, false);
  check('the untouched outcome group is writable', changes['outcome'], 'won');
  check('only attendance dropped', dropped, ['showed']);
  check('attendance provenance unchanged', 'showed_source' in changes, false);
  check('outcome provenance stamped crm', changes['outcome_source'], 'crm');
}

section('Columns outside the survey pass straight through');
{
  const existing = { showed: true, showed_source: 'client', outcome_source: 'client' };
  const { changes } = applyPrecedence(
    existing,
    { status: 'cancelled', cancelled_at: '2026-09-01T00:00:00.000Z', showed: false },
    'call_centre',
  );
  check('a cancellation still lands', changes['status'], 'cancelled');
  check('and its timestamp', changes['cancelled_at'], '2026-09-01T00:00:00.000Z');
  check('while attendance is still protected', 'showed' in changes, false);
}

section('call_centre does not outrank call_centre');
{
  const existing = { outcome: 'won', outcome_source: 'call_centre' };
  const { changes, dropped } = applyPrecedence(
    existing,
    { outcome: 'lost' },
    'call_centre',
  );
  check('the team may correct itself', changes['outcome'], 'lost');
  check('nothing dropped', dropped, []);
}

// ---------------------------------------------------------------------------
console.log(
  `\n${checks - failures}/${checks} checks passed` +
    (failures ? ` — ${failures} FAILED` : ''),
);
process.exit(failures ? 1 : 0);
