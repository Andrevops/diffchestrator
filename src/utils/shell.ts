import * as vscode from "vscode";

/**
 * Neutralize control characters before text reaches `terminal.sendText`.
 * Quoting alone is not enough: a newline (or CR) inside a quoted argument is
 * delivered to the terminal as Enter — on cmd.exe that executes the rest of
 * the line as a new command, and on every shell it can submit a partially
 * typed command. Line breaks (and tabs) collapse to a single space; every
 * other C0 control and DEL is dropped (ESC sequences could drive the TTY).
 */
export function stripControlChars(text: string): string {
  return text
    .replace(/[\r\n\t]+/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, "");
}

/**
 * Shell dialect of a terminal shell path/name: "powershell" (powershell.exe,
 * pwsh), "cmd" (cmd.exe), or "posix" (bash, zsh, fish, Git Bash, …).
 */
export type ShellKind = "posix" | "powershell" | "cmd";

export function detectShellKind(shellPath?: string): ShellKind {
  const shell = (shellPath ?? "").toLowerCase();
  if (shell.includes("powershell") || shell.includes("pwsh")) return "powershell";
  if (shell.includes("cmd.exe")) return "cmd";
  return "posix";
}

/**
 * Shell dialect of VS Code's default terminal shell.
 */
export function currentShellKind(): ShellKind {
  // optional chaining: the Node test stub has no `env` namespace
  return detectShellKind(vscode.env?.shell);
}

/**
 * Build `primary || fallback` in a form valid for the given shell: POSIX shells
 * and cmd.exe support `||` natively; PowerShell 5.1 doesn't, so use
 * `$LASTEXITCODE` instead (also valid in pwsh 7). stderr of `primary` is
 * silenced in each dialect. Both commands must already be safely quoted.
 */
export function orElseCommand(primary: string, fallback: string, kind: ShellKind): string {
  switch (kind) {
    case "powershell":
      return `${primary} 2>$null; if ($LASTEXITCODE -ne 0) { ${fallback} }`;
    case "cmd":
      return `${primary} 2>nul || ${fallback}`;
    default:
      return `${primary} 2>/dev/null || ${fallback}`;
  }
}

/**
 * Escapes a string to be safely used as a command line argument
 * in the VS Code integrated terminal, regardless of the user's shell.
 *
 * @param shellOverride Shell binary path/name to target instead of
 *   `vscode.env.shell` — used by unit tests to exercise each dialect.
 */
export function escapeForTerminal(text: string, shellOverride?: string): string {
  // Try to determine the shell from VS Code environment
  const kind = shellOverride !== undefined ? detectShellKind(shellOverride) : currentShellKind();
  // Control characters (newlines especially) would act as Enter — strip first
  text = stripControlChars(text);

  // PowerShell
  if (kind === "powershell") {
    // Wrap in single quotes, escape literal single quotes by doubling them.
    // PowerShell also treats the typographic quotes U+2018–U+201B as single
    // quotes, so they must be doubled too or they would close the string.
    return `'${text.replace(/['‘’‚‛]/g, "$&$&")}'`;
  }

  // Windows CMD
  if (kind === "cmd") {
    // CMD is notoriously difficult to escape perfectly.
    // We replace double quotes with escaped double quotes and wrap in double quotes.
    // For highly complex strings (like code diffs), CMD might still struggle
    // with %, !, ^, etc., but this prevents trivial command injection via " & ".
    return `"${text.replace(/"/g, '""')}"`;
  }

  // Default to POSIX (Bash, Zsh, Git Bash, macOS, Linux)
  // Wrap in single quotes, escape literal single quotes as '\''
  return `'${text.replace(/'/g, "'\\''")}'`;
}
