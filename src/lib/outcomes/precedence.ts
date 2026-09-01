/**
 * Whose answer wins when three parties describe the same consultation.
 *
 * The same eight questions can be answered from three places: the practice, in
 * their portal; the call centre, in /b2c; and the GoHighLevel update form, which
 * arrives at /api/webhooks/consultation-outcome. All three write the same
 * columns on the same row, and until now whoever wrote last won.
 *
 * That is not a tie-break, it is a race. The portal tells a practice on screen
 * that "nothing you type here is overwritten by our systems", and
 * crm-appointments.ts keeps that promise against the nightly sync — but only for
 * attendance, and only against the CRM. A call-centre submission arriving an
 * hour after a practice filled the form would quietly replace their treatment
 * value, which is the exact fault the stat sheets had: last writer wins, no
 * record of who that was.
 *
 * The rule, in one sentence: **the practice is authoritative, and anyone else
 * may fill a blank but may not overwrite an answer.**
 *
 * Two groups, because there are two provenance columns. `showed_source` has
 * always governed attendance; `outcome_source` was added in 0027 to govern the
 * rest. Splitting them matters — the calendar legitimately knows whether someone
 * turned up, and legitimately does not know what the treatment was worth.
 */

/** Who is writing. 'client' means the practice, and outranks the others. */
export type OutcomeWriter = 'client' | 'call_centre' | 'crm' | 'tracker';

/** Columns the calendar can also speak to, governed by `showed_source`. */
export const ATTENDANCE_FIELDS = ['showed', 'second_consult_showed'] as const;

/**
 * Columns only a human can answer, governed by `outcome_source`.
 *
 * `second_consult_required` is here rather than with attendance on purpose: a
 * calendar can see whether somebody turned up, but not whether the consultation
 * concluded that another one was needed. Only the call centre asks it today, so
 * nothing contests it yet — it is listed so that if the portal ever asks the
 * practice the same question, precedence already covers it.
 */
export const OUTCOME_FIELDS = [
  'outcome',
  'value_cents',
  'financing_approved',
  'cc_on_file',
  'notes',
  'lead_quality',
  'second_consult_required',
] as const;

/** The subset of an appointment this decision needs. */
export interface ExistingAnswers {
  showed?: boolean | null;
  second_consult_showed?: boolean | null;
  showed_source?: string | null;
  outcome?: string | null;
  value_cents?: number | null;
  financing_approved?: boolean | null;
  cc_on_file?: boolean | null;
  notes?: string | null;
  lead_quality?: string | null;
  outcome_source?: string | null;
}

export interface PrecedenceResult {
  /** What should actually be written, provenance columns included. */
  changes: Record<string, unknown>;
  /** Columns dropped because the practice had already answered them. */
  dropped: string[];
}

/**
 * Is this column already answered?
 *
 * Null is unanswered everywhere. `outcome` needs the extra clause: 'pending' is
 * the column default and the portal spells it "Not decided yet", so treating it
 * as an answer would lock the call centre out of every row a practice had opened
 * and not finished. An empty note is not an answer either.
 */
function answered(field: string, value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (field === 'outcome') return value !== 'pending';
  if (field === 'notes') return String(value).trim() !== '';
  return true;
}

/**
 * Filter a set of proposed changes down to the ones this writer is allowed to
 * make, and stamp the provenance columns for whichever groups survive.
 *
 * The practice is never filtered. Everyone else is filtered per column rather
 * than per group, so a call centre chasing a half-finished form still fills the
 * boxes the practice left blank — which is the useful behaviour, and the reason
 * this is not simply "if the practice touched it, give up".
 */
export function applyPrecedence(
  existing: ExistingAnswers,
  proposed: Record<string, unknown>,
  writer: OutcomeWriter,
): PrecedenceResult {
  const changes: Record<string, unknown> = {};
  const dropped: string[] = [];

  const guard = (fields: readonly string[], owner: string | null | undefined) => {
    const practiceOwns = owner === 'client' && writer !== 'client';
    let wrote = false;
    for (const field of fields) {
      if (!(field in proposed)) continue;
      if (practiceOwns && answered(field, existing[field as keyof ExistingAnswers])) {
        dropped.push(field);
        continue;
      }
      changes[field] = proposed[field];
      wrote = true;
    }
    return wrote;
  };

  if (guard(ATTENDANCE_FIELDS, existing.showed_source)) {
    changes['showed_source'] = writer;
  }
  if (guard(OUTCOME_FIELDS, existing.outcome_source)) {
    changes['outcome_source'] = writer;
  }

  /*
   * Anything outside the two groups — a cancellation setting `status`, say — is
   * nobody's survey answer and passes through untouched. Precedence is about
   * who described the consultation, not about every column on the row.
   */
  for (const [field, value] of Object.entries(proposed)) {
    if (ATTENDANCE_FIELDS.includes(field as never)) continue;
    if (OUTCOME_FIELDS.includes(field as never)) continue;
    changes[field] = value;
  }

  return { changes, dropped };
}
