import { Writable } from 'node:stream';
import * as readline from 'node:readline/promises';

/** Asks the user to type `expected` to proceed; anything else (or a closed stdin) aborts. */
export async function confirmByTyping(question: string, expected: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(`${question} Type "${expected}" to confirm: `)).trim() === expected;
  } finally {
    rl.close();
  }
}

/** Reads a secret without echoing it. Falls back to a plain line read when stdin is not a terminal. */
export async function promptHidden(question: string): Promise<string> {
  const muted = new Writable({ write: (_chunk, _enc, done) => done() });
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdin.isTTY ? muted : undefined,
    terminal: Boolean(process.stdin.isTTY),
  });
  try {
    process.stdout.write(question);
    return (await rl.question('')).trim();
  } finally {
    rl.close();
    process.stdout.write('\n');
  }
}

/** Asks one question and returns the trimmed answer ("" when stdin is closed). */
export async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } catch {
    return '';
  } finally {
    rl.close();
  }
}
