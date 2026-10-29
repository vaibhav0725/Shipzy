export interface ParsedDotenv {
  vars: Record<string, string>;
  /** human-readable problems, one per offending line */
  errors: string[];
}

/**
 * Parses KEY=VALUE lines: blank lines and `#` comments are skipped, `export ` is allowed, and values may be
 * quoted. Variable interpolation and multi-line values are not supported.
 */
export function parseDotenv(text: string): ParsedDotenv {
  const vars: Record<string, string> = {};
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) {
      errors.push(`line ${index + 1}: not a KEY=VALUE pair`);
      return;
    }
    const [, name, rest] = m as unknown as [string, string, string];
    let value = rest;
    const quote = rest[0];
    if (quote === '"' || quote === "'") {
      const end = rest.indexOf(quote, 1);
      if (end === -1) {
        errors.push(`line ${index + 1}: unterminated quote (multi-line values are not supported)`);
        return;
      }
      value = rest.slice(1, end);
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    } else {
      value = rest.replace(/\s+#.*$/, '').trim();
    }
    vars[name] = value;
  });
  return { vars, errors };
}
