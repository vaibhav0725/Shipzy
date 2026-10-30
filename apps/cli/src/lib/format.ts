import { ui, visibleLength } from './ui.js';

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

export function timeAgo(iso: string | undefined, now = Date.now()): string {
  if (!iso) return '-';
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/**
 * Left-aligned table with a header row. Cells may contain colour codes: columns are sized by what shows on screen.
 * On a terminal the header is bold and the rule beneath it dim; in a pipe the output is plain text.
 */
export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => visibleLength(r[i] ?? ''))));
  const pad = (cell: string, width: number) => cell + ' '.repeat(Math.max(0, width - visibleLength(cell)));
  const line = (cells: string[]) => cells.map((c, i) => pad(c, widths[i]!)).join('  ').trimEnd();
  return [
    line(headers.map((h) => ui.bold(h))),
    ui.dim(line(widths.map((w) => '-'.repeat(w)))),
    ...rows.map(line),
  ].join('\n');
}
