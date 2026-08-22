'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/cn';

/**
 * Copies a client's portal link.
 *
 * The link is the credential — there is no login behind it — so this exists to
 * stop anyone retyping one by hand and to make sending the right client the
 * right link a single click.
 */
export function CopyPortalLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1800);
        } catch {
          // Clipboard access can be refused outright (insecure context, denied
          // permission). Select the field instead of pretending it worked.
          setCopied(false);
        }
      }}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1',
        'text-xs transition-colors',
        copied
          ? 'border-positive text-positive'
          : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
      )}
      aria-label="Copy this client's portal link"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? 'Copied' : 'Copy link'}
    </button>
  );
}
