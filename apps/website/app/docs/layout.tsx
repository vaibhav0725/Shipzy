import type { ReactNode } from 'react';
import { MobileNav, Sidebar } from '@/components/DocsNav';
import { allDocs } from '@/lib/docs';

export default function DocsLayout({ children }: { children: ReactNode }) {
  const docs = allDocs();
  return (
    <div className="container docs">
      <Sidebar docs={docs} />
      <div style={{ minWidth: 0 }}>
        <MobileNav docs={docs} />
        {children}
      </div>
    </div>
  );
}
