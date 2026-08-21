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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
