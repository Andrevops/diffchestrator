/**
 * Builds the single-line prompt sent to `claude -p` from the diff panel's
 * "Ask Claude" button.
 *
 * The prompt is typed into a terminal via `sendText`, so it must never
 * contain raw newlines or control characters (a newline would submit the
 * command early and the rest would run as separate shell input). Hunk lines
 * are joined with a literal "\n" marker instead, which Claude reads fine.
 *
 * The total length is capped so the command stays well under the Windows
 * cmd.exe 8191-character command-line limit.
 */

export const MAX_ASK_CLAUDE_PROMPT = 6000;
export const MAX_ASK_CLAUDE_HUNK_INPUT = 200_000;

const CONTROL_CHARS = /[\x00-\x08\x0b-\x1f\x7f\u0085\u2028\u2029]/g;

function oneLine(s: string): string {
  return s.replace(/\t/g, "  ").replace(/\r\n?|\n/g, " ").replace(CONTROL_CHARS, "");
}

export function buildAskClaudePrompt(
  filePath: string,
  hunkContent: string,
  maxLength = MAX_ASK_CLAUDE_PROMPT
): string {
  const header = `Explain this change in ${oneLine(filePath)}: `;
  const lines = hunkContent
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\t/g, "  ").replace(CONTROL_CHARS, ""));
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const marker = " (hunk truncated)";
  const budget = maxLength - header.length;
  let body = lines.join("\\n");
  if (body.length > budget) {
    body = body.slice(0, Math.max(0, budget - marker.length)) + marker;
  }
  return (header + body).slice(0, maxLength);
}
