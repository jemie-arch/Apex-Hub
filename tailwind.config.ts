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
          // The inverted panel, for the single card that must outrank the rest.
          invert: 'var(--surface-invert)',
        },
        'invert-fg': {
          DEFAULT: 'var(--surface-invert-text)',
          muted: 'var(--surface-invert-muted)',
        },
        // Categorical series colours. These carry no meaning — they only
        // separate one series from another, which is why they are kept apart
        // from both the accent and the semantic scale.
        chart: {
          1: 'var(--chart-1)',
          2: 'var(--chart-2)',
          3: 'var(--chart-3)',
          4: 'var(--chart-4)',
          5: 'var(--chart-5)',
          6: 'var(--chart-6)',
          track: 'var(--chart-track)',
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
          strong: 'var(--positive-strong)',
        },
        warning: {
          DEFAULT: 'var(--warning)',
          subtle: 'var(--warning-subtle)',
          strong: 'var(--warning-strong)',
        },
        negative: {
          DEFAULT: 'var(--negative)',
          subtle: 'var(--negative-subtle)',
          strong: 'var(--negative-strong)',
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
