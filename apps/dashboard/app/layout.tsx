import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import Nav from '@/components/Nav';
import Topbar from '@/components/Topbar';
import './globals.css';

// Self-hosted at build time, so the dashboard looks the same offline.
const sans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-sans', display: 'swap' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'shipzy',
  description: 'Local dashboard for your own AWS deployments',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before the first paint (and accept ?theme=light|dark|system once). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var q=new URLSearchParams(location.search).get('theme');if(q==='light'||q==='dark'||q==='system')localStorage.setItem('shipzy-theme',q);var t=localStorage.getItem('shipzy-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}",
          }}
        />
      </head>
      <body>
        <div className="shell">
          <Nav />
          <div className="frame">
            <Topbar />
            <main className="main">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
