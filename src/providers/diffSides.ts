import type { FileChange } from "../types";
import { FileStatus } from "../types";

/**
 * Repo-relative path to read for the LEFT (original) side of a file's diff.
 * Staged changes compare against HEAD, where a renamed/copied file still
 * lives at its ORIGINAL path — the new path doesn't exist there, so using it
 * renders the rename as a full add. Unstaged changes compare against the
 * index, which already has the new path.
 */
export function diffLeftPath(fc: FileChange): string {
  return fc.status === FileStatus.Staged ? (fc.oldPath ?? fc.path) : fc.path;
}
