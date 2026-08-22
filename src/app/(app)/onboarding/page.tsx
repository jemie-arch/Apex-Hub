import { ClipboardList, MapPin } from 'lucide-react';
import Link from 'next/link';

import { StageControls } from '@/components/onboarding/StageControls';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { tenant, titleCase } from '@/config/tenant.config';
import { formatCount, formatDateInZone } from '@/lib/format';
import { serviceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Onboarding' };

const FALLBACK_STAGES = [
  'signed',
  'kickoff',
  'account_access',
  'assets',
  'build',
  'launched',
  'live',
] as const;

/** Whole days between then and now, for the age badge on a card. */
function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const then = new Date(`${iso}T00:00:00.000Z`).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86_400_000);
}

export default async function OnboardingPage() {
  const db = serviceClient();

  const [stageSetting, groups, locations] = await Promise.all([
    db.from('app_settings').select('value').eq('key', 'onboarding_stages').maybeSingle(),
    db
      .from('client_groups')
      .select('*')
      .eq('status', 'onboarding')
      .order('signed_on', { ascending: true, nullsFirst: false }),
    db.from('clients').select('id, name, group_id'),
  ]);

  if (groups.error) throw groups.error;
  if (locations.error) throw locations.error;

  const stages: readonly string[] = Array.isArray(stageSetting.data?.value)
    ? (stageSetting.data.value as unknown[]).filter(
        (entry): entry is string => typeof entry === 'string',
      )
    : FALLBACK_STAGES;

  const locationsByGroup = new Map<string, string[]>();
  for (const row of locations.data ?? []) {
    const list = locationsByGroup.get(row.group_id) ?? [];
    list.push(row.name);
    locationsByGroup.set(row.group_id, list);
  }

  const client = tenant.vocabulary.client;
  const location = tenant.vocabulary.location;
  const all = groups.data ?? [];

  // A stage that is not in the configured list still gets a column, so a
  // business can never be invisible because its stage was renamed.
  const unknownStages = [
    ...new Set(all.map((g) => g.onboarding_stage).filter((s) => !stages.includes(s))),
  ];
  const columns = [...stages, ...unknownStages];

  const lastStage = stages.at(-1);

  return (
    <>
      <PageHeader
        title="Onboarding"
        description={
          `${formatCount(all.length)} ${all.length === 1 ? client.singular : client.plural} ` +
          'in setup · move a card with its stage selector'
        }
      />

      {all.length === 0 ? (
        <EmptyState
          title="Nothing in onboarding"
          description={
            `Newly synced ${client.plural} land here automatically. A ` +
            `${client.singular} leaves the board when you mark it active.`
          }
          icon={<ClipboardList size={22} />}
        />
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {columns.map((stage) => {
            const cards = all.filter((group) => group.onboarding_stage === stage);

            return (
              <section
                key={stage}
                className="flex w-72 shrink-0 flex-col rounded-lg border border-line bg-surface-sunken"
              >
                <header className="flex items-baseline justify-between gap-2 px-3 py-2.5">
                  <h2 className="text-sm font-semibold capitalize text-fg">
                    {stage.replace(/_/g, ' ')}
                  </h2>
                  <span className="numeric text-xs text-fg-subtle">
                    {formatCount(cards.length)}
                  </span>
                </header>

                <div className="flex flex-1 flex-col gap-2 px-2 pb-2">
                  {cards.length === 0 ? (
                    <p className="px-1 py-3 text-xs text-fg-subtle">Empty</p>
                  ) : (
                    cards.map((group) => {
                      const age = daysSince(group.signed_on);
                      const names = locationsByGroup.get(group.id) ?? [];

                      return (
                        <article
                          key={group.id}
                          className="surface-interactive rounded-md border border-line bg-surface p-3"
                        >
                          <Link
                            href={`/clients/${group.id}`}
                            className="block truncate text-sm font-medium text-fg hover:text-accent"
                          >
                            {group.name}
                          </Link>

                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle">
                            {group.signed_on ? (
                              <span className="numeric">
                                signed {formatDateInZone(
                                  `${group.signed_on}T00:00:00.000Z`,
                                  tenant.defaultTimezone,
                                  'd MMM',
                                )}
                              </span>
                            ) : (
                              <span>no signed date</span>
                            )}
                            {age !== null ? (
                              <span
                                className={
                                  // 30 days in setup is a stall, not progress.
                                  age > 30 ? 'text-negative' : age > 14 ? 'text-warning' : ''
                                }
                              >
                                {formatCount(age)}d
                              </span>
                            ) : null}
                          </div>

                          <div className="mt-1.5 flex items-center gap-1 text-xs text-fg-subtle">
                            <MapPin size={11} />
                            {names.length === 0
                              ? `no ${location.singular} linked`
                              : names.length === 1
                                ? names[0]
                                : `${formatCount(names.length)} ${location.plural}`}
                          </div>

                          <StageControls
                            groupId={group.id}
                            stage={group.onboarding_stage}
                            stages={columns}
                            isLastStage={stage === lastStage}
                          />
                        </article>
                      );
                    })
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-xs text-fg-subtle">
        Reorder or rename columns by editing the{' '}
        <code className="rounded bg-surface-sunken px-1 py-0.5 font-mono">
          onboarding_stages
        </code>{' '}
        setting. A {titleCase(client.singular)} only counts toward the target
        once it is marked active.
      </p>
    </>
  );
}
