/**
 * How to book at each practice — the call centre's scheduling reference.
 *
 * An agent on the phone with a patient needs one fact before anything else:
 * does this practice take bookings into fixed weekly slots, or through its own
 * online scheduler? Getting it wrong books a consultation nobody is expecting.
 *
 * That fact has been collected all along. The kick-off form asks it, 56
 * practices have answered, and until now nothing read the answer — kick-off is
 * one of the form keys wired to nothing, so 56 submissions sat in
 * form_submissions.payload consumed by no code and shown on no screen. This
 * page is the read.
 *
 * It deliberately surfaces the gaps as loudly as the answers. A reference that
 * quietly omits the practices it cannot describe is worse than no reference,
 * because an agent trusts it and then finds nothing for the clinic in front of
 * them. So an unusable answer sorts to the top, not the bottom.
 *
 * Not a live feed. form_submissions was imported once, on 22 August 2026, and
 * nothing refreshes it — a practice that changed its slots since then is
 * recorded wrong here, which is why the age of the data is stated on screen
 * rather than left for somebody to assume.
 */
import { CalendarClock, CircleHelp, Link2, ListChecks } from 'lucide-react';

import { EmptyState } from '@/components/ui/EmptyState';
import { KPICard } from '@/components/ui/KPICard';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusPill, type Tone } from '@/components/ui/StatusPill';
import { formatCount } from '@/lib/format';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Scheduling' };

/**
 * The kick-off question, spelled exactly as stored.
 *
 * Reproduced character for character including the missing "as" in "add the url
 * well", which is theirs. Two of the four question keys in the onboarding
 * adapter had already drifted from what the live form asks, so an approximate
 * match here would silently return nothing and look like a practice that never
 * answered.
 */
const SCHEDULING_QUESTION =
  "Scheduling through designated spots or online scheduler? (if we're using " +
  "their online scheduler, please add the url well. If we're using designated " +
  'spots, please list them here)';

/**
 * Below this, an answer is present but says nothing an agent could act on.
 *
 * Sixteen of the 56 answers average 27 characters — too short to be a URL or a
 * list of weekly slots. "Online scheduler" with no link, or "spots" with no
 * times, leaves the agent exactly where they started, so it is reported as a
 * gap rather than counted as covered.
 */
const USABLE_ANSWER_CHARS = 40;

type Kind = 'online_scheduler' | 'designated_spots' | 'too_vague' | 'no_answer';

const KIND_LABEL: Record<Kind, string> = {
  online_scheduler: 'online scheduler',
  designated_spots: 'designated spots',
  too_vague: 'needs detail',
  no_answer: 'not answered',
};

const KIND_TONE: Record<Kind, Tone> = {
  online_scheduler: 'accent',
  designated_spots: 'positive',
  too_vague: 'warning',
  no_answer: 'negative',
};

/**
 * Which of the two booking routes this answer describes.
 *
 * A URL is decisive — a practice that pasted a link is using its own scheduler
 * whatever else the sentence says. Only after that does the presence of days
 * and times mean designated spots. The order matters: several answers mention
 * both ("online scheduler, or Tues 3pm if it's full") and the link is the one
 * an agent should act on.
 */
function classify(answer: string | null): Kind {
  if (answer === null || answer.trim() === '') return 'no_answer';
  const text = answer.trim();
  if (text.length < USABLE_ANSWER_CHARS && !/https?:\/\//i.test(text)) {
    return 'too_vague';
  }
  if (/https?:\/\//i.test(text)) return 'online_scheduler';
  if (/\b(mon|tue|wed|thu|fri|sat|sun)/i.test(text) || /\d\s*(am|pm)/i.test(text)) {
    return 'designated_spots';
  }
  return 'too_vague';
}

/** Gaps first. An agent scrolling this needs the unanswerable ones in view. */
const SORT_ORDER: Record<Kind, number> = {
  no_answer: 0,
  too_vague: 1,
  designated_spots: 2,
  online_scheduler: 3,
};

export default async function SchedulingPage() {
  const db = serviceClient();

  const [submissions, groups] = await Promise.all([
    db
      .from('form_submissions')
      .select('id, clinic_name, client_group_id, payload, submitted_at, created_at')
      .eq('form_key', 'kick-off')
      .order('submitted_at', { ascending: false }),
    db.from('client_groups').select('id, name').eq('status', 'active'),
  ]);
  if (submissions.error) throw submissions.error;
  if (groups.error) throw groups.error;

  const groupName = new Map((groups.data ?? []).map((row) => [row.id, row.name]));

  /*
   * One row per practice, newest answer wins.
   *
   * A practice that filled the kick-off form twice has two submissions, and the
   * later one is what they do now. Keyed on the group where the submission is
   * linked and on the clinic name where it is not, so an unlinked answer still
   * appears rather than being dropped for want of an id.
   */
  const byPractice = new Map<
    string,
    {
      practice: string;
      linked: boolean;
      answer: string | null;
      kind: Kind;
      answeredOn: string | null;
    }
  >();

  for (const row of submissions.data ?? []) {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    const raw = payload[SCHEDULING_QUESTION];
    const answer = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;

    const key = row.client_group_id ?? `name:${(row.clinic_name ?? '').toLowerCase()}`;
    if (byPractice.has(key)) continue; // ordered newest first, so keep the first

    byPractice.set(key, {
      practice:
        (row.client_group_id ? groupName.get(row.client_group_id) : null) ??
        row.clinic_name ??
        'Unnamed practice',
      linked: row.client_group_id !== null,
      answer,
      kind: classify(answer),
      answeredOn: row.submitted_at ?? row.created_at,
    });
  }

  const rows = [...byPractice.values()].sort((a, b) => {
    const order = SORT_ORDER[a.kind] - SORT_ORDER[b.kind];
    return order !== 0 ? order : a.practice.localeCompare(b.practice);
  });

  const count = (kind: Kind) => rows.filter((row) => row.kind === kind).length;
  const usable = count('online_scheduler') + count('designated_spots');
  const unlinked = rows.filter((row) => !row.linked).length;

  const importedOn = (submissions.data ?? [])[0]?.created_at ?? null;
  const ageDays =
    importedOn === null
      ? null
      : Math.floor((Date.now() - new Date(importedOn).getTime()) / 86_400_000);

  return (
    <>
      <PageHeader
        title="Scheduling"
        description="How to book at each practice, from their kick-off form."
      />

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          label="Usable"
          value={formatCount(usable)}
          hint={`of ${formatCount(rows.length)} practices answered`}
          icon={<ListChecks size={16} />}
        />
        <KPICard
          label="Designated spots"
          value={formatCount(count('designated_spots'))}
          hint="book into fixed weekly slots"
          icon={<CalendarClock size={16} />}
        />
        <KPICard
          label="Online scheduler"
          value={formatCount(count('online_scheduler'))}
          hint="use the practice's own link"
          icon={<Link2 size={16} />}
        />
        <KPICard
          label="Cannot answer"
          value={formatCount(count('too_vague') + count('no_answer'))}
          higherIsBetter={false}
          hint="an agent still has to ask"
          icon={<CircleHelp size={16} />}
        />
      </section>

      {/*
        * Stated rather than assumed. This reads from a one-off import, so the
        * page has to say how old it is — a scheduling reference that is quietly
        * three months stale sends an agent to a slot that no longer exists.
        */}
      <p className="mt-4 text-xs text-fg-subtle">
        From the kick-off form, imported once
        {ageDays === null ? '' : ` ${formatCount(ageDays)} day(s) ago`}. Nothing
        refreshes it, so a practice that changed its slots since then is recorded
        wrong here.
        {unlinked > 0
          ? ` ${formatCount(unlinked)} answer(s) are not linked to a client record and are listed under the name given on the form.`
          : ''}
      </p>

      <section className="mt-8 overflow-hidden rounded-lg border border-line bg-surface">
        {rows.length === 0 ? (
          <EmptyState
            title="No kick-off answers"
            description="No practice has answered the scheduling question yet, so there is nothing to book against."
            icon={<CalendarClock size={22} />}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-subtle">
                  <th className="px-4 py-3 font-medium">Practice</th>
                  <th className="px-4 py-3 font-medium">How to book</th>
                  <th className="px-4 py-3 font-medium">What they said</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.practice} className="border-b border-line last:border-0">
                    <td className="px-4 py-3 align-top">
                      <span className="font-medium text-fg">{row.practice}</span>
                      {row.linked ? null : (
                        <span className="ml-2 text-xs text-fg-subtle">unlinked</span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <StatusPill value={KIND_LABEL[row.kind]} tone={KIND_TONE[row.kind]} />
                    </td>
                    <td className="px-4 py-3 align-top text-fg-muted">
                      {row.answer ?? (
                        <span className="text-fg-subtle">
                          Left blank on the kick-off form.
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
