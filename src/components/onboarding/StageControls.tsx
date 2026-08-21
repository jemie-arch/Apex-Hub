'use client';

import { Check } from 'lucide-react';
import { useState, useTransition } from 'react';

import {
  markOnboardingComplete,
  moveOnboardingStage,
} from '@/app/(app)/onboarding/actions';
import { Button } from '@/components/ui/Button';

/**
 * A select plus a finish button, rather than drag-and-drop. A dropdown is
 * keyboard-accessible, needs no library, and cannot half-drop a card into the
 * wrong column — which matters when the column decides whether a practice is
 * counted toward the target.
 */
export function StageControls({
  groupId,
  stage,
  stages,
  isLastStage,
}: {
  groupId: string;
  stage: string;
  stages: readonly string[];
  isLastStage: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-3 flex flex-col gap-2">
      <select
        value={stage}
        disabled={isPending}
        aria-label="Onboarding stage"
        onChange={(event) => {
          const next = event.target.value;
          startTransition(async () => {
            const result = await moveOnboardingStage({ groupId, stage: next });
            setError(result.ok ? null : result.message);
          });
        }}
        className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-fg"
      >
        {stages.map((option) => (
          <option key={option} value={option}>
            {option.replace(/_/g, ' ')}
          </option>
        ))}
      </select>

      {isLastStage ? (
        <Button
          size="sm"
          variant="primary"
          icon={<Check size={13} />}
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await markOnboardingComplete({ groupId });
              setError(result.ok ? null : result.message);
            })
          }
        >
          Mark active
        </Button>
      ) : null}

      {error ? <p className="text-xs text-negative">{error}</p> : null}
    </div>
  );
}
