'use server';

/**
 * Recording what happened at a consultation, from the inside.
 *
 * The client portal has had this since it was built, but only for practices.
 * The call centre — who actually record most show and no-show outcomes — had no
 * screen at all, so their route was a GoHighLevel form into Make into a Google
 * stat sheet, which the Hub then imported. Five hops, and every fault the
 * scenario audit turned up lives in the middle three: sheets addressed by a
 * stale label, a lookup reading a file nothing writes to, a spreadsheet id with
 * a trailing newline. None of that can happen to a row written here.
 *
 * Two rules this will not break.
 *
 * An unanswered question is left alone. The tri-state fields distinguish "no"
 * from "not asked yet", and only an explicit answer is written — because a form
 * that treated silence as "did not attend" would manufacture no-shows, and a
 * no-show is what a practice does not get billed for.
 *
 * It records who said so. showed_source already separates 'crm' (the calendar
 * said) from 'client' (the practice said); this writes 'call_centre'. When the
 * three disagree — and reconciliation exists because they do — the provenance is
 * the only thing that makes the disagreement resolvable.
 */
import { revalidatePath } from 'next/cache';

import { isStaffRole, isPrivileged } from '@/config/roles';
import { currentCaller } from '@/lib/supabase/server';
import { serviceClient } from '@/lib/supabase/service';
import type { Database } from '@/types/database';

type AppointmentOutcome = Database['public']['Enums']['appointment_outcome'];

export interface OutcomeResult {
  ok: boolean;
  message: string;
}

const OUTCOMES: readonly string[] = [
  'pending',
  'quoted',
  'won',
  'lost',
  'follow_up',
  'unqualified',
];

/** 'unknown' means nobody has answered, and must never be stored as false. */
function tri(value: 'yes' | 'no' | 'unknown'): boolean | null {
  if (value === 'yes') return true;
  if (value === 'no') return false;
  return null;
}

/**
 * Money in whole currency units from a free-text box, or null.
 *
 * Returns null rather than 0 for anything unparseable. A treatment value of
 * zero is a real answer meaning "they started and paid nothing"; an empty box
 * means nobody has said. Collapsing the two would put £0 treatments into the
 * won column.
 */
function cents(raw: string): number | null | 'invalid' {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const cleaned = trimmed.replace(/[^0-9.]/g, '');
  if (cleaned === '') return 'invalid';
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) return 'invalid';
  return Math.round(parsed * 100);
}

export async function recordConsultation(input: {
  appointmentId: string;
  outcome: string;
  showed: 'yes' | 'no' | 'unknown';
  secondShowed: 'yes' | 'no' | 'unknown';
  ccOnFile: 'yes' | 'no' | 'unknown';
  financing: 'yes' | 'no' | 'unknown';
  value: string;
  notes: string;
}): Promise<OutcomeResult> {
  const caller = await currentCaller();
  if (!caller) return { ok: false, message: 'Sign in again.' };

  /*
   * Staff and admins, not clients. A client login is scoped to one practice and
   * already has the portal for this; letting it through here would be a second,
   * unscoped path to the same table.
   */
  if (!isStaffRole(caller.role) && !isPrivileged(caller.role)) {
    return { ok: false, message: 'Your account cannot record outcomes.' };
  }

  if (!OUTCOMES.includes(input.outcome)) {
    return { ok: false, message: 'That outcome is not recognised.' };
  }

  const valueCents = cents(input.value);
  if (valueCents === 'invalid') {
    return {
      ok: false,
      message: 'Treatment value needs to be a number, or left empty.',
    };
  }

  const db = serviceClient();

  const existing = await db
    .from('appointments')
    .select('id, patient_name')
    .eq('id', input.appointmentId)
    .maybeSingle();

  if (existing.error) return { ok: false, message: existing.error.message };
  if (!existing.data) {
    return { ok: false, message: 'That appointment no longer exists.' };
  }

  const showed = tri(input.showed);
  const secondShowed = tri(input.secondShowed);
  const ccOnFile = tri(input.ccOnFile);
  const financing = tri(input.financing);
  const notes = input.notes.trim();

  const written = await db
    .from('appointments')
    .update({
      outcome: input.outcome as AppointmentOutcome,
      /*
       * Spread-if-answered rather than assigned. An omitted key leaves the
       * column as it was; writing null would erase what the calendar or the
       * practice had already established.
       */
      ...(showed === null ? {} : { showed, showed_source: 'call_centre' }),
      ...(secondShowed === null ? {} : { second_consult_showed: secondShowed }),
      ...(ccOnFile === null ? {} : { cc_on_file: ccOnFile }),
      ...(financing === null ? {} : { financing_approved: financing }),
      ...(valueCents === null ? {} : { value_cents: valueCents }),
      ...(notes === '' ? {} : { notes }),
      outcome_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.appointmentId);

  if (written.error) return { ok: false, message: written.error.message };

  /*
   * Reconciliation reads this table, so its page has to be invalidated too or
   * somebody chasing an exception sees the version from before the fix.
   */
  revalidatePath('/b2c');
  revalidatePath('/reconciliation');

  return {
    ok: true,
    message: `Saved for ${existing.data.patient_name ?? 'this appointment'}.`,
  };
}
