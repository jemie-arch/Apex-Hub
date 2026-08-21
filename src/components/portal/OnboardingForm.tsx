'use client';

/**
 * The onboarding form.
 *
 * Kept as one screen rather than a wizard: a practice manager filling this in
 * between patients needs to see how much is left, and a wizard hides that.
 */
import { useState, useTransition } from 'react';

import {
  submitOnboardingForm,
  type PortalResult,
} from '@/app/portal/[token]/portal-actions';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

const FIELD =
  'h-10 w-full rounded-md border border-line bg-surface-sunken px-3 text-sm text-fg placeholder:text-fg-subtle';

const AREA =
  'w-full rounded-md border border-line bg-surface-sunken px-3 py-2 text-sm text-fg placeholder:text-fg-subtle';

interface Question {
  name: string;
  label: string;
  hint?: string;
  long?: boolean;
}

const SECTIONS: Array<{ heading: string; questions: Question[] }> = [
  {
    heading: 'The practice',
    questions: [
      { name: 'practice_name', label: 'Practice name as patients know it' },
      { name: 'website', label: 'Website' },
      { name: 'booking_phone', label: 'Phone patients should call' },
      {
        name: 'main_contact',
        label: 'Who we should speak to day to day',
        hint: 'Name, role and the best number.',
      },
    ],
  },
  {
    heading: 'What you want more of',
    questions: [
      {
        name: 'target_treatments',
        label: 'Treatments to push',
        hint: 'Braces, Invisalign, implants — whatever you want the phone ringing for.',
      },
      {
        name: 'average_case_value',
        label: 'Typical case value',
        hint: 'Roughly what a full plan is worth. It tells us what a lead is worth.',
      },
      {
        name: 'financing_offered',
        label: 'Financing you offer',
        hint: 'Providers and typical monthly amounts.',
      },
      {
        name: 'not_wanted',
        label: 'Anything you do NOT want',
        long: true,
        hint: 'Cases you would rather not see. Cheaper to say now than to filter later.',
      },
    ],
  },
  {
    heading: 'Getting patients booked',
    questions: [
      {
        name: 'consult_availability',
        label: 'When you can see new consults',
        hint: 'Days and times we may book into.',
      },
      {
        name: 'consult_length',
        label: 'How long a new-patient consult takes',
      },
      {
        name: 'who_answers',
        label: 'Who answers the phone, and when',
      },
      {
        name: 'existing_offers',
        label: 'Offers we can advertise',
        long: true,
        hint: 'Free consult, free scan, discount — exactly as you want it worded.',
      },
    ],
  },
  {
    heading: 'Content and access',
    questions: [
      {
        name: 'content_available',
        label: 'Footage and photos you already have',
        long: true,
      },
      {
        name: 'brand_notes',
        label: 'Anything about how you want to come across',
        long: true,
      },
    ],
  },
];

export function OnboardingForm({ token }: { token: string }) {
  const [result, setResult] = useState<PortalResult | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(async () => {
          setResult(await submitOnboardingForm(token, data));
        });
      }}
      className="flex flex-col gap-6"
    >
      {result ? (
        <p
          className={cn(
            'rounded-md px-3 py-2 text-sm',
            result.ok
              ? 'bg-positive-subtle text-positive'
              : 'bg-negative-subtle text-negative',
          )}
        >
          {result.message}
        </p>
      ) : null}

      {SECTIONS.map((section) => (
        <fieldset
          key={section.heading}
          className="rounded-lg border border-line bg-surface p-5"
        >
          <legend className="px-1 text-sm font-semibold text-fg">
            {section.heading}
          </legend>

          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {section.questions.map((question) => (
              <label
                key={question.name}
                className={cn(
                  'flex flex-col gap-1.5',
                  question.long && 'sm:col-span-2',
                )}
              >
                <span className="text-xs font-medium text-fg-muted">
                  {question.label}
                </span>
                {question.long ? (
                  <textarea name={question.name} rows={3} className={AREA} />
                ) : (
                  <input name={question.name} className={FIELD} />
                )}
                {question.hint ? (
                  <span className="text-[11px] text-fg-subtle">
                    {question.hint}
                  </span>
                ) : null}
              </label>
            ))}
          </div>
        </fieldset>
      ))}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-fg-subtle">
          You can send this more than once — the latest answers are the ones we
          work from.
        </p>
        <Button type="submit" variant="primary" disabled={isPending}>
          {isPending ? 'Sending…' : 'Send to our team'}
        </Button>
      </div>
    </form>
  );
}
