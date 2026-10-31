import type { ReactNode } from 'react';

/** A terminal window. Pass each line as a child of <Line>; lines fade in one after another. */
export function Terminal({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="terminal" role="img" aria-label="A terminal session">
      <div className="bar">
        <i /><i /><i />
        {title && <span>{title}</span>}
      </div>
      <pre>{children}</pre>
    </div>
  );
}

export function Line({ children, at }: { children?: ReactNode; at: number }) {
  return (
    <span className="l" style={{ animationDelay: `${at}ms` }}>
      {children ?? ' '}
      {'\n'}
    </span>
  );
}
