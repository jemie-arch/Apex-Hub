'use client';

/**
 * Practice details, edited by the practice.
 *
 * Hours are free text per day. Practices write "8–1, 2–5, closed alt Fridays",
 * and a pair of time pickers cannot hold that — so it is not modelled as one.
 */
import { useState, useTransition } from 'react';

import {
  savePracticeDetails,
  type PortalResult,
} from '@/app/portal/[token]/portal-actions';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { titleCase } from '@/config/tenant.config';

const FIELD =
  'h-10 w-full rounded-md border border-line bg-surface-sunken px-3 text-sm text-fg placeholder:text-fg-subtle';

const DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

export interface PracticeDetails {
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  website: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  hours: Record<string, string>;
}

export function PracticeDetailsForm({
  token,
  details,
}: {
  token: string;
  details: PracticeDetails;
}) {
  const [result, setResult] = useState<PortalResult | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(async () => {
          setResult(await savePracticeDetails(token, data));
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

      <fieldset className="rounded-lg border border-line bg-surface p-5">
        <legend className="px-1 text-sm font-semibold text-fg">
          Who we contact
        </legend>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-muted">Name</span>
            <input
              name="contact_name"
              defaultValue={details.contactName ?? ''}
              className={FIELD}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-muted">Email</span>
            <input
              name="contact_email"
              type="email"
              defaultValue={details.contactEmail ?? ''}
              className={FIELD}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-muted">Phone</span>
            <input
              name="contact_phone"
              defaultValue={details.contactPhone ?? ''}
              className={FIELD}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-muted">Website</span>
            <input
              name="website"
              defaultValue={details.website ?? ''}
              className={FIELD}
            />
          </label>
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-line bg-surface p-5">
        <legend className="px-1 text-sm font-semibold text-fg">Address</legend>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-xs font-medium text-fg-muted">Street</span>
            <input
              name="address_line1"
              defaultValue={details.addressLine1 ?? ''}
              className={FIELD}
            />
          </label>
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-xs font-medium text-fg-muted">
              Suite, unit, floor
            </span>
            <input
              name="address_line2"
              defaultValue={details.addressLine2 ?? ''}
              className={FIELD}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-muted">City</span>
            <input
              name="city"
              defaultValue={details.city ?? ''}
              className={FIELD}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-muted">
              State or province
            </span>
            <input
              name="region"
              defaultValue={details.region ?? ''}
              className={FIELD}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-muted">Postcode</span>
            <input
              name="postal_code"
              defaultValue={details.postalCode ?? ''}
              className={FIELD}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-muted">Country</span>
            <input
              name="country"
              defaultValue={details.country ?? ''}
              className={FIELD}
            />
          </label>
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-line bg-surface p-5">
        <legend className="px-1 text-sm font-semibold text-fg">
          Opening hours
        </legend>
        <p className="mt-1 text-xs text-fg-subtle">
          Write them however they actually are — &ldquo;8–1, 2–5&rdquo;,
          &ldquo;closed alternate Fridays&rdquo;. We book consultations around
          this.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {DAYS.map((day) => (
            <label key={day} className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-xs font-medium text-fg-muted">
                {titleCase(day)}
              </span>
              <input
                name={`hours_${day}`}
                defaultValue={details.hours[day] ?? ''}
                placeholder="Closed"
                className={FIELD}
              />
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={isPending}>
          {isPending ? 'Saving…' : 'Save details'}
        </Button>
      </div>
    </form>
  );
}
