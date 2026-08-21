import type { ReactNode } from 'react';

import { Sidebar } from '@/components/shell/Sidebar';

/**
 * The internal app shell. Access is decided in middleware.ts — nothing here
 * checks a role, it only lays out the page.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1600px] px-8 py-8">{children}</div>
      </main>
    </div>
  );
}
