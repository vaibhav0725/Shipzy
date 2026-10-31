'use client';

import { useEffect } from 'react';

/** Makes the "Copy" button on every code block work (one listener for the whole page). */
export default function CodeCopy() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('.code .copy');
      if (!button) return;
      const text = button.parentElement?.querySelector('pre')?.textContent ?? '';
      void navigator.clipboard?.writeText(text.replace(/\n$/, '')).then(() => {
        const label = button.textContent;
        button.textContent = 'Copied';
        setTimeout(() => (button.textContent = label), 1400);
      });
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);
  return null;
}
