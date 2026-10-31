import type { ReactNode } from 'react';
import { Icon } from './Icons';

/** A highlighted note: a shield for good news, a warning tone for honest limits. */
export default function Callout({ warn, children }: { warn?: boolean; children: ReactNode }) {
  return (
    <div className={`callout ${warn ? 'warn' : ''}`}>
      <Icon name="shield" />
      <div>{children}</div>
    </div>
  );
}
