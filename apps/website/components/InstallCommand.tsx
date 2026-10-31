'use client';

import { useState } from 'react';
import { Icon } from './Icons';

/** The install command with a copy button. */
export default function InstallCommand({ command }: { command: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="install">
      <code>
        <span className="prompt">$ </span>
        {command}
      </code>
      <button
        type="button"
        className="btn small ghost"
        onClick={() => {
          void navigator.clipboard?.writeText(command).then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          });
        }}
      >
        <Icon name={done ? 'check' : 'copy'} />
        {done ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
