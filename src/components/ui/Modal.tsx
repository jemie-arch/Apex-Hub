'use client';

/**
 * The one detail surface in this app. Every detail view is a centred modal —
 * never a side panel — so that opening a record never reflows the page behind
 * it and the reader's eye does not have to move.
 */
import { X } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** Buttons pinned to the bottom. */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}

const SIZES = {
  sm: 'max-w-md',
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
} as const;

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  footer,
  size = 'md',
  children,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    },
    [onClose],
  );

  /*
   * Focus the panel when it OPENS, and at no other time.
   *
   * This used to live in the effect below, whose dependencies include
   * handleKeyDown, which depends on onClose. Every caller passes an inline
   * `onClose={() => setOpen(false)}`, so onClose is a new function on every
   * render of the caller — and any caller holding state for a controlled input
   * re-renders on each keystroke.
   *
   * The result: type one character, the caller re-renders, onClose changes
   * identity, handleKeyDown changes identity, the effect re-runs, and
   * `panelRef.current.focus()` pulls focus off the input. The second character
   * goes nowhere. Ally hit it on the resolve note — "it doesnt let me type more
   * than 1 letter" — and it would have hit every controlled field in every
   * modal this app has.
   *
   * Keyed on `open` alone, so it fires once per opening. The listener effect
   * below keeps its own dependencies, because a stale Escape handler would
   * close using an outdated onClose.
   */
  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
  }, [open]);

  // Stop the page behind from scrolling under the overlay. Separate from the
  // listener for the same reason: it should run when the modal opens, not
  // whenever the caller happens to re-render.
  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'var(--overlay)' }}
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'flex max-h-[90vh] w-full flex-col rounded-xl border border-line',
          'bg-surface-raised shadow-lg outline-none',
          SIZES[size],
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-fg">{title}</h2>
            {subtitle ? (
              <p className="mt-0.5 truncate text-sm text-fg-muted">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>

        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-line px-6 py-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
