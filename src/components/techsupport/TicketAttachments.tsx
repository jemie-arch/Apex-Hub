'use client';

import { FileText, ImageIcon, Paperclip } from 'lucide-react';
import { useRef, useState, useTransition } from 'react';

import { attachScreenshot } from '@/app/(app)/tech-support/actions';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import type { Attachment } from '@/lib/tickets/attachments';

/**
 * Screenshots on a ticket.
 *
 * A picture settles in one glance what a paragraph argues about, which is the
 * whole reason this exists — most tech tickets are somebody describing a screen
 * they are looking at.
 *
 * Images render inline at a size you can actually read; anything else is a
 * link. The link is signed and expires in half an hour, so it is generated when
 * the page renders rather than stored — a stored URL either expires and breaks
 * or never expires and leaks.
 */
function bytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function TicketAttachments({
  ticketId,
  attachments,
  canUpload,
}: {
  ticketId: string;
  attachments: Attachment[];
  canUpload: boolean;
}) {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  const images = attachments.filter((item) => item.mimeType.startsWith('image/'));
  const files = attachments.filter((item) => !item.mimeType.startsWith('image/'));

  function upload(file: File) {
    const data = new FormData();
    data.set('ticket_id', ticketId);
    data.set('file', file);

    startTransition(async () => {
      const outcome = await attachScreenshot(data);
      setResult(outcome);
      if (outcome.ok && input.current) input.current.value = '';
    });
  }

  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
          <Paperclip size={13} />
          Attachments
          {attachments.length > 0 ? (
            <span className="numeric text-fg-subtle">({attachments.length})</span>
          ) : null}
        </h2>

        {canUpload ? (
          <>
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,application/pdf"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) upload(file);
              }}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={isPending}
              onClick={() => input.current?.click()}
            >
              {isPending ? 'Uploading…' : 'Add a screenshot'}
            </Button>
          </>
        ) : null}
      </div>

      {result ? (
        <p
          className={cn(
            'mb-3 rounded-md px-3 py-2 text-xs',
            result.ok
              ? 'bg-positive-subtle text-positive'
              : 'bg-negative-subtle text-negative',
          )}
        >
          {result.message}
        </p>
      ) : null}

      {attachments.length === 0 ? (
        <p className="text-xs text-fg-subtle">
          {canUpload
            ? 'Images and PDFs, up to 10 MB. A screenshot usually explains it faster than a sentence.'
            : 'Nothing attached.'}
        </p>
      ) : null}

      {images.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((item) => (
            <figure
              key={item.id}
              className="overflow-hidden rounded-lg border border-line bg-surface"
            >
              {item.url ? (
                /*
                 * A plain <img>, not next/image. The URL is signed and expires,
                 * so the optimiser would cache a link that stops working and
                 * serve a broken image long after the original was fine.
                 */
                // eslint-disable-next-line @next/next/no-img-element
                <a href={item.url} target="_blank" rel="noreferrer">
                  <img
                    src={item.url}
                    alt={item.fileName}
                    className="max-h-64 w-full bg-surface-sunken object-contain"
                  />
                </a>
              ) : (
                <div className="flex h-32 items-center justify-center text-xs text-fg-subtle">
                  <ImageIcon size={16} className="mr-1.5" />
                  link expired — reload
                </div>
              )}
              <figcaption className="flex items-baseline justify-between gap-2 border-t border-line px-3 py-1.5">
                <span className="truncate text-xs text-fg-muted">
                  {item.fileName}
                </span>
                <span className="numeric shrink-0 text-xs text-fg-subtle">
                  {bytes(item.sizeBytes)}
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}

      {files.length > 0 ? (
        <ul className={cn('space-y-1', images.length > 0 && 'mt-3')}>
          {files.map((item) => (
            <li key={item.id}>
              {item.url ? (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-accent hover:underline"
                >
                  <FileText size={13} />
                  {item.fileName}
                  <span className="numeric text-fg-subtle">
                    {bytes(item.sizeBytes)}
                  </span>
                </a>
              ) : (
                <span className="text-xs text-fg-subtle">
                  {item.fileName} — link expired, reload the page
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
