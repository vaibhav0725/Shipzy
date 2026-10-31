import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import CodeCopy from '@/components/CodeCopy';
import Footer from '@/components/Footer';
import Header from '@/components/Header';
import { site } from '@/lib/site';
import './globals.css';

const sans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-sans', display: 'swap' });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: `${site.name}: ${site.tagline}`, template: `%s | ${site.name}` },
  description: site.description,
  openGraph: { title: `${site.name}: ${site.tagline}`, description: site.description, siteName: site.name, type: 'website' },
  twitter: { card: 'summary', title: `${site.name}: ${site.tagline}`, description: site.description },
};

export const viewport: Viewport = { themeColor: [{ media: '(prefers-color-scheme: light)', color: '#f3f0ea' }, { media: '(prefers-color-scheme: dark)', color: '#100f0e' }] };

// Applies the saved theme before the first paint (and accepts ?theme=light|dark|system once).
const themeScript =
  "try{var q=new URLSearchParams(location.search).get('theme');if(q==='light'||q==='dark'||q==='system')localStorage.setItem('shipzy-site-theme',q);var t=localStorage.getItem('shipzy-site-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
      </head>
      <body>
        <a className="skip" href="#main">Skip to content</a>
        <Header />
        <main id="main">{children}</main>
        <Footer />
        <CodeCopy />
      </body>
    </html>
  );
}
