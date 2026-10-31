'use client';

import { useState } from 'react';
import { Icon } from './Icons';

/** The install command with a copy button. */
export default function InstallCommand({ command }: { command: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="install">
      <span className="prompt">$</span>
      <code>{command}</code>
      <button
        type="button"
        aria-label="Copy the install command"
        onClick={() => {
          void navigator.clipboard?.writeText(command).then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          });
        }}
      >
        <Icon name={done ? 'check' : 'copy'} />
        {done && 'Copied'}
      </button>
    </div>
  );
}
