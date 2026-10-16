/**
 * Extract repoPath and filePath from various argument shapes:
 * - FileNode from tree: { type: "file", repoPath: "...", fileChange: { path: "..." } }
 * - TreeItem with attached props: { repoPath: "...", filePath: "..." }
 */
export function resolveFileItem(item: any): { repoPath: string; filePath: string } | undefined {
  const repoPath = item?.repoPath;
  const filePath = item?.fileChange?.path ?? item?.filePath;
  if (repoPath && filePath) return { repoPath, filePath };
  return undefined;
}

/**
 * Status ("staged" | "unstaged" | "untracked") of the change a file item
 * represents, when the item carries one (Changed Files / Repo Files nodes).
 */
export function resolveFileStatus(item: any): string | undefined {
  const status = item?.fileChange?.status;
  return typeof status === "string" ? status : undefined;
}

/**
 * Extract a repo path from the various shapes that command handlers receive:
 * - RepoTreeItem: { repo: { path } }
 * - DirectoryTreeItem: { fullPath }
 * - Context menu: { path }
 * - Changed-file / active-repo tree items: { repoPath }
 * Falls back to the currently selected repo.
 */
export function resolveRepoPath(item: any, fallback?: string): string | undefined {
  return item?.repo?.path ?? item?.fullPath ?? item?.path ?? item?.repoPath ?? fallback;
}
