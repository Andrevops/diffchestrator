/**
 * Pure decision logic for discarding a single file. No `vscode` import so it
 * can be unit-tested under plain Node.
 */

/**
 * - clean:       delete an untracked file (`git clean -f`)
 * - checkout:    drop unstaged edits, keep the staged version (`git checkout -- f`)
 * - restoreHead: drop staged AND unstaged changes, back to HEAD
 *                (`git restore --staged --worktree --source=HEAD`)
 */
export type DiscardAction = "clean" | "checkout" | "restoreHead";

export interface DiscardState {
  /** Status of the tree item the user acted on ("staged" | "unstaged" | "untracked") */
  itemStatus?: string;
  /** Current git state of the file */
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  /** The staged change adds the file (not in HEAD) */
  addedInIndex: boolean;
}

export interface DiscardChoice {
  action: DiscardAction;
  /** Modal button label */
  label: string;
  /** Toast after success */
  done: string;
}

export interface DiscardPrompt {
  message: string;
  /** First choice is the primary/default for the acted-on item */
  choices: DiscardChoice[];
}

export function planDiscard(fileName: string, s: DiscardState): DiscardPrompt | undefined {
  const q = `"${fileName}"`;

  if (s.untracked || (s.itemStatus === "untracked" && !s.staged && !s.unstaged)) {
    return {
      message: `Delete untracked file ${q}? This cannot be undone.`,
      choices: [{ action: "clean", label: "Delete", done: `Deleted ${fileName}` }],
    };
  }

  const restoreHead: DiscardChoice = s.addedInIndex
    ? { action: "restoreHead", label: "Discard All Changes", done: `Removed newly added ${fileName}` }
    : { action: "restoreHead", label: "Discard All Changes", done: `Restored ${fileName} from HEAD` };
  const checkout: DiscardChoice = {
    action: "checkout",
    label: "Discard Unstaged Only",
    done: `Discarded unstaged changes to ${fileName} (staged changes kept)`,
  };

  if (s.staged && s.unstaged) {
    return {
      message: s.addedInIndex
        ? `${q} is a newly added file with staged and unstaged changes. "Discard All Changes" unstages and deletes it; "Discard Unstaged Only" keeps the staged version. This cannot be undone.`
        : `${q} has staged and unstaged changes. "Discard All Changes" restores it from HEAD; "Discard Unstaged Only" keeps the staged version. This cannot be undone.`,
      choices: s.itemStatus === "staged" ? [restoreHead, checkout] : [checkout, restoreHead],
    };
  }

  if (s.staged) {
    return {
      message: s.addedInIndex
        ? `Remove newly added file ${q}? It will be unstaged and deleted. This cannot be undone.`
        : `Discard staged changes to ${q}, restoring it from HEAD? This cannot be undone.`,
      choices: [{ ...restoreHead, label: "Discard" }],
    };
  }

  if (s.unstaged) {
    return {
      message: `Discard changes to ${q}? This cannot be undone.`,
      choices: [{ action: "checkout", label: "Discard", done: `Discarded changes to ${fileName}` }],
    };
  }

  return undefined; // nothing to discard any more
}
