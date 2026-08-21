import type { Config } from 'tailwindcss';

/**
 * Tailwind is a mapping layer over the custom properties in globals.css. No
 * colour literal appears here either — if a token is missing, add it to
 * globals.css first and surface it below.
 */
const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          subtle: 'var(--accent-subtle)',
          contrast: 'var(--accent-contrast)',
        },
        bg: 'var(--bg)',
        surface: {
          DEFAULT: 'var(--surface)',
          raised: 'var(--surface-raised)',
          sunken: 'var(--surface-sunken)',
          hover: 'var(--surface-hover)',
        },
        overlay: 'var(--overlay)',
        // Named fg rather than text so the utility reads `text-fg-muted`
        // instead of `text-text-muted`.
        fg: {
          DEFAULT: 'var(--text)',
          muted: 'var(--text-muted)',
          subtle: 'var(--text-subtle)',
          inverse: 'var(--text-inverse)',
        },
        line: {
          DEFAULT: 'var(--border)',
          strong: 'var(--border-strong)',
        },
        positive: {
          DEFAULT: 'var(--positive)',
          subtle: 'var(--positive-subtle)',
        },
        warning: {
          DEFAULT: 'var(--warning)',
          subtle: 'var(--warning-subtle)',
        },
        negative: {
          DEFAULT: 'var(--negative)',
          subtle: 'var(--negative-subtle)',
        },
        neutral: {
          DEFAULT: 'var(--neutral)',
          subtle: 'var(--neutral-subtle)',
        },
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        full: 'var(--radius-full)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        mono: 'var(--font-mono)',
      },
      fontSize: {
        hero: ['var(--size-hero)', { lineHeight: '1', fontWeight: '650' }],
      },
    },
  },
  plugins: [],
};

export default config;
