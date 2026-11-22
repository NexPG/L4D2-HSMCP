/**
 * Splitting a Windows command line into argv.
 *
 * The editor stores parameters as one string (`-game $gamedir $path\$file`). The compiler
 * needs an argument array, and handing the string to a shell would both re-parse quotes and
 * execute whatever a `&` inside it implies. The rules implemented here are
 * `CommandLineToArgvW`'s, which the CRT tools use:
 *
 * - whitespace outside quotes separates arguments;
 * - `"` starts and ends a quoted run, and a quoted empty string is a real empty argument;
 * - run of N backslashes before a quote yields N/2 backslashes, plus a literal quote when N
 *   is odd; an even N leaves the quote as a delimiter;
 * - backslashes not before a quote are literal, which matters because every map path has
 *   them.
 *
 * This is deliberately not a shell: `$vars` are substituted before this runs, and nothing
 * else is expanded.
 */
export function splitWindowsArgs(command: string): string[] {
  const args: string[] = [];
  let current = "";
  let hasToken = false;
  let inQuotes = false;
  let i = 0;

  while (i < command.length) {
    const ch = command[i]!;
    if (ch === "\\") {
      let slashes = 0;
      while (i < command.length && command[i] === "\\") {
        slashes += 1;
        i += 1;
      }
      if (i < command.length && command[i] === '"') {
        current += "\\".repeat(Math.floor(slashes / 2));
        hasToken = true;
        if (slashes % 2 === 1) {
          current += '"';
        } else {
          inQuotes = !inQuotes;
        }
        i += 1;
      } else {
        current += "\\".repeat(slashes);
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = !inQuotes;
      hasToken = true;
      i += 1;
      continue;
    }

    if (!inQuotes && /\s/.test(ch)) {
      if (hasToken) {
        args.push(current);
        current = "";
        hasToken = false;
      }
      i += 1;
      while (i < command.length && /\s/.test(command[i]!)) i += 1;
      continue;
    }

    current += ch;
    hasToken = true;
    i += 1;
  }

  if (hasToken) args.push(current);
  return args;
}
