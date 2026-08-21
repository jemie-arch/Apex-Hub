'use client';

/**
 * Dark / light switch.
 *
 * Applies immediately by stamping data-theme on <html>, writes to localStorage
 * so the next page load has it before first paint (see the inline script in
 * layout.tsx), and persists to the profile so the choice follows the person to
 * another device.
 */
import { Moon, Sun } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';

import { saveTheme } from '@/app/(app)/account/theme-action';
import { cn } from '@/lib/cn';

export type Theme = 'dark' | 'light';

export function ThemeToggle({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);
  const [, startTransition] = useTransition();

  // Keeps the DOM in step if the value changes after hydration.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  function choose(next: Theme) {
    setTheme(next);
    try {
      window.localStorage.setItem('theme', next);
    } catch {
      // Private browsing can refuse storage. The profile write below still
      // persists it, so this is not worth surfacing.
    }
    startTransition(() => {
      void saveTheme(next);
    });
  }

  return (
    <div
      className="flex items-center gap-0.5 rounded-full border border-line bg-surface-sunken p-0.5"
      role="group"
      aria-label="Colour theme"
    >
      {(
        [
          { value: 'dark' as const, icon: Moon, label: 'Dark' },
          { value: 'light' as const, icon: Sun, label: 'Light' },
        ]
      ).map((option) => {
        const Icon = option.icon;
        const active = theme === option.value;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => choose(option.value)}
            aria-pressed={active}
            title={`${option.label} theme`}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
              active
                ? 'bg-accent text-accent-contrast'
                : 'text-fg-muted hover:text-fg',
            )}
          >
            <Icon size={13} />
            <span className="sr-only sm:not-sr-only">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
