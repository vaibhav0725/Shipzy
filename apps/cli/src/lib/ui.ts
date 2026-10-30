// Terminal styling for the CLI, with no dependency: a few ANSI escape codes (invisible characters that tell the
// terminal to colour the text that follows). It costs nothing measurable in memory or speed.
//
// Colour is used only when a person is looking at a terminal. It is off when output is piped or redirected (so
// scripts, `--json` and the dashboard's job logs stay plain), when NO_COLOR is set (https://no-color.org), and
// when TERM=dumb. FORCE_COLOR=1 turns it on anyway. Plain output is exactly what the commands printed before.
//
// Only the 16 standard colours are used, so they follow the user's terminal theme (light or dark).

type Stream = NodeJS.WriteStream;

function colorEnabled(stream: Stream): boolean {
  const env = process.env;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.FORCE_COLOR !== undefined) return env.FORCE_COLOR !== '0' && env.FORCE_COLOR.toLowerCase() !== 'false';
  return Boolean(stream.isTTY) && env.TERM !== 'dumb';
}

const wrap = (on: boolean, open: number, close: number) => (text: string) => (on ? `\x1b[${open}m${text}\x1b[${close}m` : text);

function palette(on: boolean) {
  const accent = wrap(on, 36, 39); // cyan: the "sky" of the terminal
  const underline = wrap(on, 4, 24);
  return {
    on,
    bold: wrap(on, 1, 22),
    dim: wrap(on, 2, 22),
    red: wrap(on, 31, 39),
    green: wrap(on, 32, 39),
    yellow: wrap(on, 33, 39),
    blue: wrap(on, 34, 39),
    accent,
    /** an address people may want to open */
    url: (text: string) => underline(accent(text)),
    /** names the person typed or needs to recognise: projects, domains, deployments */
    name: (text: string) => wrap(on, 1, 22)(text),
    ok: (text: string) => (on ? `${wrap(on, 32, 39)('✔')} ${text}` : text),
    fail: (text: string) => (on ? `${wrap(on, 31, 39)('✖')} ${text}` : text),
    warn: (text: string) => (on ? `${wrap(on, 33, 39)('!')} ${text}` : text),
    /** a step in progress or a note */
    step: (text: string) => (on ? `${wrap(on, 2, 22)('›')} ${text}` : text),
  };
}

/** Styles for text printed to standard output. */
export const ui = palette(colorEnabled(process.stdout));
/** Styles for text printed to standard error (it can be a terminal while standard output is a pipe). */
export const uiErr = palette(colorEnabled(process.stderr));

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;
export const stripAnsi = (text: string) => text.replace(ANSI, '');
/** Width of text as it appears on screen, ignoring colour codes. */
export const visibleLength = (text: string) => stripAnsi(text).length;

const GOOD = new Set(['SUCCEEDED', 'ISSUED', 'OK', 'CREATE_COMPLETE', 'UPDATE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE', 'LIVE', 'READY', 'YES', 'ON']);
const BAD = ['FAILED', 'FAULT', 'TIMED_OUT', 'STOPPED', 'ROLLBACK_COMPLETE', 'WRONG', 'DELETE_FAILED'];

/** Colours a status word: green when healthy, red when broken, yellow while something is in progress. */
export function colorStatus(text: string): string {
  const s = text.trim().toUpperCase();
  if (GOOD.has(s)) return ui.green(text);
  if (BAD.some((b) => s.includes(b)) || s.endsWith('_FAILED')) return ui.red(text);
  if (s.includes('PROGRESS') || s === 'PENDING' || s === 'RUNNING' || s.startsWith('PENDING')) return ui.yellow(text);
  return text;
}

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const mmss = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * A spinner with an elapsed-time counter for a long wait (a CloudFront distribution takes minutes). It draws only on
 * a terminal; anywhere else it does nothing, so logs and pipes are unchanged. Call the returned function to stop it
 * and clear the line. Do not print while it is running.
 */
export function spinner(label: string): () => void {
  if (!process.stdout.isTTY || process.env.CI || process.env.TERM === 'dumb') return () => undefined;
  const started = Date.now();
  let frame = 0;
  const draw = () => {
    process.stdout.write(`\r\x1b[2K${ui.accent(FRAMES[frame++ % FRAMES.length]!)} ${label} ${ui.dim(mmss(Date.now() - started))}`);
  };
  draw();
  const timer = setInterval(draw, 120);
  timer.unref();
  return () => {
    clearInterval(timer);
    process.stdout.write('\r\x1b[2K');
  };
}
