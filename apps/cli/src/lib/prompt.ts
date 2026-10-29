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
