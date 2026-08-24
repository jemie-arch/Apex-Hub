/**
 * Hubstaff tracked time into payout lines.
 *
 * One line per person per fortnight: hours they tracked, plus hours of approved
 * paid leave, valued at the rate on their profile at the moment of calculation.
 *
 * Three rules this sync will not break.
 *
 * It never touches a period that is locked or paid. Those are a record of what
 * somebody was actually paid, and a later rate change or a corrected timesheet
 * must not silently restate history. Only open periods are recomputed.
 *
 * It stores the rate it used rather than relying on a join. Same reason.
 *
 * It never invents a rate. A person with no hourly_rate_cents gets a line with
 * hours and a null amount, because valuing their work at zero would be a lie
 * that looks like a number.
 */
import {
  listMembers,
  resolveOrganizationId,
  trackedSecondsByUser,
} from '@/lib/integrations/hubstaff';
import type { SyncContext } from '@/lib/sync/runner';
import { serviceClient } from '@/lib/supabase/service';

/**
 * How far back to recompute. Two periods is a month, which covers a timesheet
 * corrected after the fact without rewriting the whole year on every run.
 */
const PERIODS_BACK = 2;

export async function syncPayoutHours(ctx: SyncContext): Promise<void> {
  const db = serviceClient();

  // Keep the calendar of fortnights ahead of today before anything reads it.
  const generated = await db.rpc('ensure_payout_periods');
  if (generated.error) throw generated.error;
  if ((generated.data ?? 0) > 0) {
    ctx.note('periods_created', generated.data);
  }

  const organizationId = await resolveOrganizationId();
  ctx.note('hubstaff_organization', organizationId);

  const [members, profiles, periods] = await Promise.all([
    listMembers(organizationId),
    db
      .from('user_profiles')
      .select('id, email, full_name, hourly_rate_cents')
      .eq('is_active', true),
    /*
     * Open periods only, most recent first. A locked or paid period is history
     * and is deliberately unreachable from here.
     */
    db
      .from('payout_periods')
      .select('id, starts_on, ends_on, state')
      .eq('state', 'open')
      .lte('starts_on', new Date().toISOString().slice(0, 10))
      .order('starts_on', { ascending: false })
      .limit(PERIODS_BACK),
  ]);

  if (profiles.error) throw profiles.error;
  if (periods.error) throw periods.error;

  ctx.counts.read = members.length;
  ctx.note('hubstaff_members', members.length);

  /*
   * Email is the join. It is the only field both systems hold that identifies a
   * person rather than a row — Hubstaff ids mean nothing here and Hub ids mean
   * nothing there. Lowercased on both sides because one system title-cases what
   * the other does not.
   */
  const profileByEmail = new Map(
    (profiles.data ?? []).flatMap((row) =>
      row.email ? [[row.email.trim().toLowerCase(), row] as const] : [],
    ),
  );

  const matched = new Map<string, (typeof profiles.data)[number]>();
  const unmatched: string[] = [];

  for (const member of members) {
    const profile = member.email
      ? profileByEmail.get(member.email)
      : undefined;
    if (profile) matched.set(member.id, profile);
    else unmatched.push(member.name ?? member.email ?? member.id);
  }

  ctx.note('matched_to_profiles', matched.size);

  if (unmatched.length > 0) {
    /*
     * Recorded as an error because it is somebody's pay. A Hubstaff member with
     * no Hub profile tracks hours that no payout line will ever carry, and
     * unlike most gaps in this system that one has a person on the other end of
     * it. Named rather than counted so it can be fixed the same day.
     */
    ctx.recordError(
      `${unmatched.length} Hubstaff member(s) have no matching Hub profile by ` +
        'email, so their tracked hours will not appear on any payout: ' +
        unmatched.join(', ') +
        '. Add a profile with the same email, or deactivate them in Hubstaff.',
      { members: unmatched },
    );
  }

  if ((periods.data ?? []).length === 0) {
    ctx.log('No open payout period covers today, so there is nothing to fill.');
    return;
  }

  let linesWritten = 0;
  let withoutRate = 0;

  for (const period of periods.data ?? []) {
    const tracked = await trackedSecondsByUser(
      organizationId,
      period.starts_on,
      period.ends_on,
    );

    for (const [hubstaffUserId, profile] of matched) {
      const trackedHours = (tracked.get(hubstaffUserId) ?? 0) / 3600;

      // Leave comes from the database rather than being recomputed here, so the
      // weekend and paid/unpaid rules live in exactly one place.
      const leave = await db.rpc('paid_leave_hours', {
        p_user_id: profile.id,
        p_from: period.starts_on,
        p_to: period.ends_on,
      });
      if (leave.error) throw leave.error;

      const leaveHours = Number(leave.data ?? 0);
      const totalHours = trackedHours + leaveHours;

      /*
       * Skip a person with nothing in the period rather than writing a zero
       * line. A row saying "0 hours" is indistinguishable from a row that was
       * never calculated, and the empty state on My Account depends on that
       * difference to say the right thing.
       */
      if (totalHours === 0) continue;

      const rate = profile.hourly_rate_cents;
      if (rate === null) withoutRate += 1;

      const written = await db.from('payout_lines').upsert(
        {
          period_id: period.id,
          user_id: profile.id,
          tracked_hours: Number(trackedHours.toFixed(2)),
          leave_hours: Number(leaveHours.toFixed(2)),
          rate_cents: rate,
          amount_cents: rate === null ? null : Math.round(totalHours * rate),
          hubstaff_user_id: hubstaffUserId,
          computed_at: new Date().toISOString(),
        },
        { onConflict: 'period_id,user_id' },
      );

      if (written.error) {
        ctx.recordError(
          `could not write the payout line for ${profile.full_name ?? profile.email}`,
          { detail: written.error.message, period: period.starts_on },
        );
        continue;
      }

      linesWritten += 1;
    }
  }

  ctx.counts.updated = linesWritten;
  ctx.note('periods_filled', (periods.data ?? []).length);
  ctx.note('lines_written', linesWritten);

  if (withoutRate > 0) {
    /*
     * Logged, not raised. The line is correct — hours with no money against
     * them — and whether somebody has a rate on file is a decision rather than
     * a fault. Saying it every run would make the alert wallpaper.
     */
    ctx.log(
      `${withoutRate} payout line(s) have hours but no amount, because those ` +
        'people have no hourly rate on record. The hours are right; the money ' +
        'is deliberately blank rather than zero.',
    );
  }
}
