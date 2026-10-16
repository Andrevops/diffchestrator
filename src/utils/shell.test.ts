import * as assert from "node:assert";
import { test } from "node:test";
import { escapeForTerminal, stripControlChars, detectShellKind, orElseCommand } from "./shell.ts";

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
  "smart ‘quotes’ and ‚low‛",
  "tab\there\r\nand\x1b[31mred\x07",
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
  // PowerShell treats ' and the typographic quotes U+2018–U+201B alike: each
  // one inside the literal must be part of a doubled pair, or it closes it.
  const isQuote = (c: string) => "'‘’‚‛".includes(c);
  let out = "";
  for (let i = 0; i < inner.length; i++) {
    if (isQuote(inner[i])) {
      assert.ok(i + 1 < inner.length && isQuote(inner[i + 1]),
        `Lone quote ${JSON.stringify(inner[i])} inside PowerShell string: ${JSON.stringify(escaped)}`);
      out += inner[i];
      i++;
    } else {
      out += inner[i];
    }
  }
  return out;
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
  // Newlines collapse to a space (a raw newline would act as Enter)
  assert.strictEqual(escapeForTerminal("a\nb", POSIX), "'a b'");
});

test("escapeForTerminal POSIX: round-trips through shell tokenization", () => {
  for (const input of TRICKY) {
    assert.strictEqual(posixDecode(escapeForTerminal(input, POSIX)), stripControlChars(input),
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
      assert.strictEqual(powershellDecode(escapeForTerminal(input, shell)), stripControlChars(input),
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
    assert.strictEqual(cmdDecode(escapeForTerminal(input, CMD)), stripControlChars(input),
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

// ── Control-character injection ─────────────────────────────────────────────

const INJECTIONS = [
  // Diff hunk header with an embedded newline + command (repo-controlled text)
  "@@ -1,3 +1,4 @@ fn()\ncalc.exe",
  "x\r\nrm -rf ~",
  "x\rshutdown /s",
  "a\u0000b",
  "esc\u001b]0;title\u0007seq",
  "del\u007fchar",
  // cmd.exe: close quote, newline, run command
  'a"\n& calc.exe & "',
  // PowerShell: typographic quote closes the literal, then runs a command
  "a’; Start-Process calc; ‘",
];

test("stripControlChars: collapses line breaks/tabs, drops other controls", () => {
  assert.strictEqual(stripControlChars("a\nb"), "a b");
  assert.strictEqual(stripControlChars("a\r\n\r\nb"), "a b");
  assert.strictEqual(stripControlChars("a\tb"), "a b");
  assert.strictEqual(stripControlChars("a\u0000b\u0007c\u001bd\u007fe"), "abcde");
  assert.strictEqual(stripControlChars("plain text"), "plain text");
  // Non-ASCII printable text is untouched
  assert.strictEqual(stripControlChars("café — ’"), "café — ’");
});

for (const [label, shell] of [["bash", POSIX], ["PowerShell", POWERSHELL], ["pwsh", PWSH], ["cmd", CMD]] as const) {
  test(`escapeForTerminal ${label}: no control characters reach the terminal`, () => {
    for (const input of INJECTIONS) {
      const out = escapeForTerminal(input, shell);
      assert.ok(!/[\x00-\x1f\x7f]/.test(out),
        `Control character leaked for ${JSON.stringify(input)}: ${JSON.stringify(out)}`);
    }
  });
}

test("escapeForTerminal: injection payloads stay a single literal argument", () => {
  for (const input of INJECTIONS) {
    const expected = stripControlChars(input);
    assert.strictEqual(posixDecode(escapeForTerminal(input, POSIX)), expected);
    assert.strictEqual(powershellDecode(escapeForTerminal(input, POWERSHELL)), expected);
    assert.strictEqual(powershellDecode(escapeForTerminal(input, PWSH)), expected);
    assert.strictEqual(cmdDecode(escapeForTerminal(input, CMD)), expected);
  }
});

test("escapeForTerminal PowerShell: typographic quotes are doubled", () => {
  assert.strictEqual(escapeForTerminal("a’b", POWERSHELL), "'a’’b'");
  assert.strictEqual(escapeForTerminal("‘x‛", PWSH), "'‘‘x‛‛'");
});

test("detectShellKind", () => {
  assert.strictEqual(detectShellKind(POSIX), "posix");
  assert.strictEqual(detectShellKind(POWERSHELL), "powershell");
  assert.strictEqual(detectShellKind(PWSH), "powershell");
  assert.strictEqual(detectShellKind(CMD), "cmd");
  assert.strictEqual(detectShellKind(undefined), "posix");
  assert.strictEqual(detectShellKind(""), "posix");
});

test("orElseCommand: valid fallback syntax per shell", () => {
  assert.strictEqual(orElseCommand("claude -c", "claude", "posix"), "claude -c 2>/dev/null || claude");
  assert.strictEqual(orElseCommand("claude -c", "claude", "cmd"), "claude -c 2>nul || claude");
  // PowerShell 5.1 has no `||` — must use $LASTEXITCODE, and no /dev/null
  const ps = orElseCommand("claude -c", "claude", "powershell");
  assert.ok(!ps.includes("||") && !ps.includes("/dev/null"), ps);
  assert.strictEqual(ps, "claude -c 2>$null; if ($LASTEXITCODE -ne 0) { claude }");
});
