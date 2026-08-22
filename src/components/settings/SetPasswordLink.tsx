'use client';

/**
 * Shows a generated set-password link, once.
 *
 * Deliberately not stored anywhere and not shown again: it is a credential, and
 * a credential that lingers on a page is one somebody screenshots. If it is lost
 * or expires, generating another is a click.
 */
import { AlertTriangle, Check, Copy } from 'lucide-react';
import { useState } from 'react';

export function SetPasswordLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setFailed(false);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused outright. Say so, rather than showing a
      // tick for something that did not happen.
      setFailed(true);
    }
  }

  return (
    <div className="mt-3 rounded-md border border-line-strong bg-surface-sunken p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-fg">
        <AlertTriangle size={13} /> Single-use link — treat it like a password
      </p>
      <p className="mt-1 text-xs text-fg-subtle">
        Anyone holding this can set the account&rsquo;s password until it is used
        or expires. Send it directly to that person, not to a group channel. It
        is not shown again.
      </p>

      <div className="mt-2 flex items-center gap-2">
        <input
          readOnly
          value={url}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 rounded border border-line bg-surface px-2 py-1 text-xs text-fg-muted"
        />
        <button
          type="button"
          onClick={copy}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {failed ? (
        <p className="mt-1.5 text-xs text-negative">
          Could not reach the clipboard. Select the text above and copy it.
        </p>
      ) : null}
    </div>
  );
}
