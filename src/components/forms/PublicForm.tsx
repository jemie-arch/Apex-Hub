'use client';

import { Check } from 'lucide-react';
import { useState, useTransition } from 'react';

import { submitPublicForm, type FormResult } from '@/app/f/[type]/actions';
import { Button } from '@/components/ui/Button';
import type { PublicFormDefinition } from '@/config/public-forms';
import { cn } from '@/lib/cn';

const FIELD =
  'h-10 w-full rounded-md border border-line bg-surface-sunken px-3 text-sm text-fg placeholder:text-fg-subtle';

const AREA =
  'w-full rounded-md border border-line bg-surface-sunken px-3 py-2 text-sm text-fg placeholder:text-fg-subtle';

export function PublicForm({
  definition,
  token,
}: {
  definition: PublicFormDefinition;
  token: string | null;
}) {
  const [result, setResult] = useState<FormResult | null>(null);
  const [isPending, startTransition] = useTransition();

  // On success the form is replaced rather than reset. Somebody who has just
  // sent fifteen answers should not be looking at fifteen empty boxes,
  // wondering whether it went.
  if (result?.ok) {
    return (
      <div className="rounded-lg border border-line bg-surface p-8 text-center">
        <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-positive-subtle text-positive">
          <Check size={20} />
        </span>
        <p className="text-sm font-medium text-fg">Sent</p>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-fg-muted">
          {result.message}
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(async () => {
          setResult(await submitPublicForm(definition.slug, token, data));
        });
      }}
      className="flex flex-col gap-6"
    >
      {result && !result.ok ? (
        <p className="rounded-md bg-negative-subtle px-3 py-2 text-sm text-negative">
          {result.message}
        </p>
      ) : null}

      {definition.sections.map((section) => (
        <fieldset
          key={section.heading}
          className="rounded-lg border border-line bg-surface p-5"
        >
          <legend className="px-1 text-sm font-semibold text-fg">
            {section.heading}
          </legend>

          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {section.fields.map((field) => (
              <label
                key={field.name}
                className={cn(
                  'flex flex-col gap-1.5',
                  field.type === 'long' && 'sm:col-span-2',
                )}
              >
                <span className="text-xs font-medium text-fg-muted">
                  {field.label}
                  {field.required ? (
                    <span className="ml-1 text-negative" aria-hidden>
                      *
                    </span>
                  ) : null}
                </span>

                {field.type === 'long' ? (
                  <textarea
                    name={field.name}
                    rows={3}
                    required={field.required}
                    className={AREA}
                  />
                ) : (
                  <input
                    name={field.name}
                    type={field.type ?? 'text'}
                    required={field.required}
                    className={FIELD}
                  />
                )}

                {field.hint ? (
                  <span className="text-[11px] text-fg-subtle">{field.hint}</span>
                ) : null}
              </label>
            ))}
          </div>
        </fieldset>
      ))}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-fg-subtle">
          Fields marked * are needed. Everything else can follow later.
        </p>
        <Button type="submit" variant="primary" disabled={isPending}>
          {isPending ? 'Sending…' : 'Send'}
        </Button>
      </div>
    </form>
  );
}
