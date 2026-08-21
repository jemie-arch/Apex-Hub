import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { tenant } from '@/config/tenant.config';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: `${tenant.company.name} — ${tenant.company.tagline}`,
    template: `%s · ${tenant.company.name}`,
  },
  description: tenant.company.industry,
  robots: { index: false, follow: false },
};

/**
 * Applies the stored theme before first paint.
 *
 * Without this a light-theme user gets a dark flash on every navigation: the
 * server renders the dark default, and React only stamps data-theme after
 * hydration. Runs inline, ahead of any stylesheet.
 */
const NO_FLASH = `
(function () {
  try {
    var t = localStorage.getItem('theme');
    if (t !== 'light' && t !== 'dark') return;
    document.documentElement.setAttribute('data-theme', t);
    document.documentElement.style.colorScheme = t;
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  // Dark is the default; the script above upgrades to light when stored.
  return (
    <html lang="en" data-theme="dark" style={{ colorScheme: 'dark' }}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
