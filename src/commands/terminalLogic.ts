import * as path from "path";
import type { Terminal } from "vscode";
import type { TerminalKind } from "./terminal";

/** Map key: `${repoPath}::${kind}` */
export const repoTerminals = new Map<string, Terminal>();

export const ALL_TERMINAL_KINDS: readonly TerminalKind[] = ["claude", "claudenew", "yolo", "yolonew", "shell"];

export function key(repoPath: string, kind: TerminalKind): string {
  return `${repoPath}::${kind}`;
}

export function registerRepoTerminal(repoPath: string, kind: TerminalKind, terminal: Terminal): void {
  repoTerminals.set(key(repoPath, kind), terminal);
}

/** Repo path a terminal is tracked under (exact object identity), if any. */
export function trackedRepoForTerminal(terminal: Terminal): string | undefined {
  for (const [k, t] of repoTerminals) {
    if (t === terminal) return k.slice(0, k.lastIndexOf("::"));
  }
  return undefined;
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Legacy prefixed terminal names from older releases (and Claude Code's own
 * "Claude: <repo>" rename). Each pattern is anchored on both ends so a repo
 * name only matches as a whole word — "Claude: foo-bar" never matches "bar".
 */
export function legacyNamePatterns(repoName: string, kind: TerminalKind): RegExp[] {
  const name = escapeRegex(repoName);
  switch (kind) {
    case "claude":
      return [
        new RegExp(`^Claude:\\s*${name}$`, "i"),
        // "Claude Code - repo", "Claude Code: repo" — the repo name must be
        // preceded by whitespace or a colon, not be the tail of another word.
        new RegExp(`^Claude Code\\b(?:.*[\\s:])?${name}$`, "i"),
      ];
    case "claudenew":
      return [];
    case "yolo":
      return [new RegExp(`^YOLO:\\s*${name}$`, "i")];
    case "yolonew":
      return [new RegExp(`^YOLONEW:\\s*${name}$`, "i")];
    case "shell":
      return [new RegExp(`^DC:\\s*${name}$`, "i")];
  }
}

/**
 * Does a terminal name identify the given repo? Exact matches only:
 * - the bare repo name (current naming; kind comes from the icon) → "bare"
 * - a legacy prefixed name → that prefix's kind
 * Substring matches ("node my-repo", "my-repo-2") are deliberately rejected:
 * they adopt foreign terminals and send commands into them.
 */
export function matchTerminalName(terminalName: string, repoName: string): TerminalKind | "bare" | undefined {
  if (!repoName) return undefined;
  if (terminalName === repoName) return "bare";
  for (const kind of ALL_TERMINAL_KINDS) {
    if (legacyNamePatterns(repoName, kind).some((p) => p.test(terminalName))) return kind;
  }
  return undefined;
}

/**
 * Extract the repo basename a terminal name refers to (bare name or legacy
 * prefix form), for lookups in roots whose repo list isn't loaded.
 */
export function repoNameFromTerminalName(terminalName: string): string | undefined {
  const name = terminalName.trim();
  if (!name) return undefined;
  const prefixed = /^(?:Claude|YOLO|YOLONEW|DC):\s*(.*)$/i.exec(name);
  if (prefixed) return prefixed[1].trim() || undefined;
  if (/^Claude Code\b/i.test(name)) return undefined; // ambiguous legacy form
  return name;
}

/**
 * Find which repo path a terminal belongs to.
 *
 * Matching strategy:
 * 1. The tracking map (exact match by terminal object)
 * 2. An exact name match against a scanned repo basename — either the bare
 *    repo name or a legacy prefixed name (see matchTerminalName). Matches
 *    are registered in the tracking map under a free kind slot.
 */
export function findRepoForTerminal(
  terminal: Terminal,
  allRepoPaths: string[],
  activeTerminals: readonly Terminal[],
  inferKindFromIconFn: (terminal: Terminal) => TerminalKind | undefined
): string | undefined {
  const tracked = trackedRepoForTerminal(terminal);
  if (tracked !== undefined) return tracked;

  const name = terminal.name;
  for (const rp of allRepoPaths) {
    const match = matchTerminalName(name, path.basename(rp));
    if (!match) continue;

    let kind: TerminalKind = match === "bare" ? inferKindFromIconFn(terminal) ?? "shell" : match;

    // Don't overwrite a slot occupied by a different alive terminal
    const existing = repoTerminals.get(key(rp, kind));
    if (existing && existing !== terminal && activeTerminals.includes(existing)) {
      // Slot taken — try other kinds
      const freeKind = ALL_TERMINAL_KINDS.find((k) => {
        const t = repoTerminals.get(key(rp, k));
        return !t || t === terminal || !activeTerminals.includes(t);
      });
      if (freeKind) kind = freeKind; else return rp; // all slots full, just return repo
    }

    repoTerminals.set(key(rp, kind), terminal);
    return rp;
  }

  return undefined;
}
