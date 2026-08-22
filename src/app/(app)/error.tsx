'use client';

/**
 * Catches a failure in any internal page.
 *
 * Without this, a thrown error in one page blanks the whole app and the only
 * clue is in a server log nobody is watching. The shell stays, the message says
 * what to do, and Try again re-runs just this segment rather than reloading
 * everything.
 *
 * The error text is shown rather than hidden behind "something went wrong".
 * Everyone using this app works here, and a Postgres message naming the column
 * it could not find is worth far more to them than a shrug.
 */
import { AlertTriangle, RotateCw } from 'lucide-react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="rounded-lg border border-negative-subtle bg-surface p-6">
      <h1 className="flex items-center gap-2 text-sm font-semibold text-fg">
        <AlertTriangle size={16} className="text-negative" /> This page could not
        load
      </h1>

      <p className="mt-2 max-w-2xl text-sm text-fg-muted">
        The rest of the app is fine — the sidebar still works, so you can carry
        on elsewhere while this is looked at.
      </p>

      <pre className="mt-4 max-w-full overflow-x-auto rounded-md border border-line bg-surface-sunken p-3 text-xs text-fg-muted">
        {error.message}
        {error.digest ? `\n\nReference: ${error.digest}` : ''}
      </pre>

      <button
        type="button"
        onClick={reset}
        className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-xs text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
      >
        <RotateCw size={12} /> Try again
      </button>
    </div>
  );
}
