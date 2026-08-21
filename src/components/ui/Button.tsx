import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-accent text-accent-contrast hover:bg-accent-hover disabled:bg-line-strong',
  secondary:
    'bg-surface text-fg border border-line hover:bg-surface-hover disabled:text-fg-subtle',
  ghost: 'bg-transparent text-fg-muted hover:bg-surface-hover hover:text-fg',
  // Semantic, not accent: destructive is red because it destroys.
  danger: 'bg-negative text-fg-inverse hover:opacity-90',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = 'secondary', size = 'md', icon, className, children, ...rest },
    ref,
  ) {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center rounded-md font-medium',
          'transition-colors disabled:cursor-not-allowed disabled:opacity-60',
          VARIANTS[variant],
          SIZES[size],
          className,
        )}
        {...rest}
      >
        {icon}
        {children}
      </button>
    );
  },
);
