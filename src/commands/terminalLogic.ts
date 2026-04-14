import * as path from "path";
import type { Terminal } from "vscode";
import type { TerminalKind } from "./terminal";

/** Map key: `${repoPath}::${kind}` */
export const repoTerminals = new Map<string, Terminal>();

export function key(repoPath: string, kind: TerminalKind): string {
  return `${repoPath}::${kind}`;
}

export function registerRepoTerminal(repoPath: string, kind: TerminalKind, terminal: Terminal): void {
  repoTerminals.set(key(repoPath, kind), terminal);
}

// Logic extracted from terminal.ts
export function findRepoForTerminal(
  terminal: Terminal,
  allRepoPaths: string[],
  activeTerminals: readonly Terminal[],
  inferKindFromIconFn: (terminal: Terminal) => TerminalKind | undefined
): string | undefined {
  // Check tracked map first
  for (const [k, t] of repoTerminals) {
    if (t === terminal) {
      return k.split("::")[0];
    }
  }

  // Fallback: find the repo whose basename appears in the terminal name.
  // Sort by basename length descending so "diffchestrator-vscode" matches
  // before "diffchestrator".
  const name = terminal.name;
  const sorted = [...allRepoPaths].sort(
    (a, b) => path.basename(b).length - path.basename(a).length
  );

  for (const rp of sorted) {
    const repoName = path.basename(rp);
    if (name.includes(repoName)) {
      // Infer kind from name or legacy prefix, then icon
      let kind: TerminalKind =
        /claude/i.test(name) ? "claude" :
        /yolonew/i.test(name) ? "yolonew" :
        /yolo/i.test(name) ? "yolo" :
        /^DC:/i.test(name) ? "shell" :
        inferKindFromIconFn(terminal) ?? "shell";

      // Don't overwrite a slot occupied by a different alive terminal
      const existing = repoTerminals.get(key(rp, kind));
      if (existing && existing !== terminal && activeTerminals.includes(existing)) {
        // Slot taken — try other kinds
        const allKinds: TerminalKind[] = ["claude", "claudenew", "yolo", "yolonew", "shell"];
        const freeKind = allKinds.find((k) => {
          const t = repoTerminals.get(key(rp, k));
          return !t || t === terminal || !activeTerminals.includes(t);
        });
        if (freeKind) kind = freeKind; else return rp; // all slots full, just return repo
      }

      repoTerminals.set(key(rp, kind), terminal);
      return rp;
    }
  }

  return undefined;
}
