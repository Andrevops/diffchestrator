import * as assert from "node:assert";
import { test } from "node:test";
import { escapeForTerminal } from "./shell.ts";

const POSIX = "/bin/bash";
const POWERSHELL = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const PWSH = "/usr/bin/pwsh";
const CMD = "C:\\Windows\\System32\\cmd.exe";

// Tricky inputs reused across dialects
const TRICKY = [
  "hello",
  "",
  "with spaces here",
  "it's got a quote",
  "'leading and trailing'",
  "''",
  'say "hello"',
  "$(rm -rf /)",
  "`whoami`",
  "$HOME and ${PATH}",
  "line one\nline two",
  "mix 'of' \"all\" `the` $(things) $here\nand more",
];

/**
 * Simulates POSIX shell tokenization of a single argument. Every character
 * must be inside single quotes or backslash-escaped — anything else would be
 * interpreted by the shell (word splitting, expansion, substitution) and is
 * treated as a failure.
 */
function posixDecode(escaped: string): string {
  let out = "";
  let inQuotes = false;
  let i = 0;
  while (i < escaped.length) {
    const ch = escaped[i];
    if (inQuotes) {
      if (ch === "'") inQuotes = false;
      else out += ch;
      i++;
    } else if (ch === "'") {
      inQuotes = true;
      i++;
    } else if (ch === "\\" && i + 1 < escaped.length) {
      out += escaped[i + 1];
      i += 2;
    } else {
      assert.fail(`Unquoted character ${JSON.stringify(ch)} exposed to the shell in ${JSON.stringify(escaped)}`);
    }
  }
  assert.strictEqual(inQuotes, false, `Unterminated single quote in ${JSON.stringify(escaped)}`);
  return out;
}

/**
 * Simulates PowerShell parsing of a single-quoted string literal: must be
 * wrapped in single quotes, and every interior quote must be doubled (`''`).
 * Inside single quotes, `$`, backtick, and `"` are literal.
 */
function powershellDecode(escaped: string): string {
  assert.ok(escaped.startsWith("'") && escaped.endsWith("'") && escaped.length >= 2,
    `Not wrapped in single quotes: ${JSON.stringify(escaped)}`);
  const inner = escaped.slice(1, -1);
  // Every single quote inside must be part of a doubled pair
  assert.ok(!inner.replace(/''/g, "").includes("'"),
    `Lone single quote inside PowerShell string: ${JSON.stringify(escaped)}`);
  return inner.replace(/''/g, "'");
}

/**
 * Simulates CMD/CRT parsing of a double-quoted argument: must be wrapped in
 * double quotes, and every interior double quote must be doubled (`""`).
 */
function cmdDecode(escaped: string): string {
  assert.ok(escaped.startsWith('"') && escaped.endsWith('"') && escaped.length >= 2,
    `Not wrapped in double quotes: ${JSON.stringify(escaped)}`);
  const inner = escaped.slice(1, -1);
  assert.ok(!inner.replace(/""/g, "").includes('"'),
    `Lone double quote inside CMD string: ${JSON.stringify(escaped)}`);
  return inner.replace(/""/g, '"');
}

test("escapeForTerminal POSIX: exact quoting forms", () => {
  assert.strictEqual(escapeForTerminal("hello", POSIX), "'hello'");
  assert.strictEqual(escapeForTerminal("", POSIX), "''");
  assert.strictEqual(escapeForTerminal("with spaces", POSIX), "'with spaces'");
  // Embedded single quote: close quote, backslash-escaped quote, reopen
  assert.strictEqual(escapeForTerminal("it's", POSIX), "'it'\\''s'");
  // Everything else is literal inside single quotes
  assert.strictEqual(escapeForTerminal("$(whoami)", POSIX), "'$(whoami)'");
  assert.strictEqual(escapeForTerminal("`whoami`", POSIX), "'`whoami`'");
  assert.strictEqual(escapeForTerminal('say "hi"', POSIX), "'say \"hi\"'");
  assert.strictEqual(escapeForTerminal("a\nb", POSIX), "'a\nb'");
});

test("escapeForTerminal POSIX: round-trips through shell tokenization", () => {
  for (const input of TRICKY) {
    assert.strictEqual(posixDecode(escapeForTerminal(input, POSIX)), input,
      `POSIX round-trip failed for ${JSON.stringify(input)}`);
  }
});

test("escapeForTerminal PowerShell: exact quoting forms", () => {
  assert.strictEqual(escapeForTerminal("hello", POWERSHELL), "'hello'");
  assert.strictEqual(escapeForTerminal("", POWERSHELL), "''");
  // Embedded single quote doubled
  assert.strictEqual(escapeForTerminal("it's", POWERSHELL), "'it''s'");
  // $, backtick, and double quotes are literal inside single quotes
  assert.strictEqual(escapeForTerminal("$env:PATH", POWERSHELL), "'$env:PATH'");
  assert.strictEqual(escapeForTerminal("`whoami`", POWERSHELL), "'`whoami`'");
  assert.strictEqual(escapeForTerminal('say "hi"', POWERSHELL), "'say \"hi\"'");
});

test("escapeForTerminal PowerShell: round-trips for both powershell.exe and pwsh", () => {
  for (const shell of [POWERSHELL, PWSH]) {
    for (const input of TRICKY) {
      assert.strictEqual(powershellDecode(escapeForTerminal(input, shell)), input,
        `PowerShell round-trip failed for ${JSON.stringify(input)} with shell ${shell}`);
    }
  }
});

test("escapeForTerminal CMD: exact quoting forms", () => {
  assert.strictEqual(escapeForTerminal("hello", CMD), '"hello"');
  assert.strictEqual(escapeForTerminal("", CMD), '""');
  // Embedded double quote doubled
  assert.strictEqual(escapeForTerminal('say "hi"', CMD), '"say ""hi"""');
  // Single quotes and $() have no meaning in CMD
  assert.strictEqual(escapeForTerminal("it's", CMD), `"it's"`);
  assert.strictEqual(escapeForTerminal("$(whoami)", CMD), '"$(whoami)"');
});

test("escapeForTerminal CMD: round-trips through quoted-argument parsing", () => {
  // Note: CMD %VAR% expansion inside double quotes is a known, documented
  // limitation of the implementation — not asserted here.
  for (const input of TRICKY) {
    assert.strictEqual(cmdDecode(escapeForTerminal(input, CMD)), input,
      `CMD round-trip failed for ${JSON.stringify(input)}`);
  }
});

test("escapeForTerminal shell detection", () => {
  // Detection is case-insensitive on the shell path
  assert.strictEqual(escapeForTerminal("it's", "C:\\Tools\\PowerShell.EXE"), "'it''s'");
  assert.strictEqual(escapeForTerminal('a"b', "C:\\WINDOWS\\SYSTEM32\\CMD.EXE"), '"a""b"');
  // Unknown or empty shells fall back to POSIX quoting
  assert.strictEqual(escapeForTerminal("it's", "/usr/bin/fish"), "'it'\\''s'");
  assert.strictEqual(escapeForTerminal("it's", ""), "'it'\\''s'");
  // No override: vscode.env.shell is unset in the test stub → POSIX fallback
  assert.strictEqual(escapeForTerminal("it's"), "'it'\\''s'");
});
