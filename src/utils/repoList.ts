/**
 * Pure helpers for bulk-operation confirmations and planning.
 * No `vscode` import — unit-testable under plain Node.
 */

/**
 * Render repo names as a bulleted list for a modal's `detail`, truncated to
 * `max` entries with an "…and N more" tail so huge selections stay readable.
 */
export function formatRepoList(names: readonly string[], max = 10): string {
  if (names.length === 0) return "";
  const limit = Math.max(1, max);
  const shown = names.slice(0, limit).map((n) => `• ${n}`);
  const rest = names.length - shown.length;
  if (rest > 0) shown.push(`…and ${rest} more`);
  return shown.join("\n");
}

/** "1 repo" / "3 repos" */
export function pluralRepos(n: number): string {
  return `${n} repo${n === 1 ? "" : "s"}`;
}

export interface SyncCandidate {
  name: string;
  path: string;
  ahead: number;
  behind: number;
  stagedCount: number;
  unstagedCount: number;
}

export interface SyncPlan<T extends SyncCandidate = SyncCandidate> {
  /** Behind and clean → `pull --ff-only` */
  pull: T[];
  /** Ahead only → push */
  push: T[];
  /** Behind with staged/unstaged changes → not pulled (and not pushed) */
  skippedDirty: T[];
  /** Ahead AND behind → neither ff-pull nor push can succeed */
  skippedDiverged: T[];
}

/**
 * Decide what Sync All does per repo. Untracked files don't make a repo
 * "dirty" here: `pull --ff-only` refuses to overwrite them on its own.
 */
export function planSync<T extends SyncCandidate>(repos: readonly T[]): SyncPlan<T> {
  const plan: SyncPlan<T> = { pull: [], push: [], skippedDirty: [], skippedDiverged: [] };
  for (const r of repos) {
    if (r.behind > 0 && r.ahead > 0) {
      plan.skippedDiverged.push(r);
    } else if (r.behind > 0) {
      if (r.stagedCount + r.unstagedCount > 0) plan.skippedDirty.push(r);
      else plan.pull.push(r);
    } else if (r.ahead > 0) {
      plan.push.push(r);
    }
  }
  return plan;
}
