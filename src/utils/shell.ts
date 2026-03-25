import * as vscode from "vscode";

/**
 * Escapes a string to be safely used as a command line argument
 * in the VS Code integrated terminal, regardless of the user's shell.
 */
export function escapeForTerminal(text: string): string {
  // Try to determine the shell from VS Code environment
  const shell = (vscode.env.shell || "").toLowerCase();

  // PowerShell
  if (shell.includes("powershell") || shell.includes("pwsh")) {
    // Wrap in single quotes, escape literal single quotes by doubling them
    return `'${text.replace(/'/g, "''")}'`;
  }

  // Windows CMD
  if (shell.includes("cmd.exe")) {
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
