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
 * Extract a repo path from the various shapes that command handlers receive:
 * - RepoTreeItem: { repo: { path } }
 * - DirectoryTreeItem: { fullPath }
 * - Context menu: { path }
 * Falls back to the currently selected repo.
 */
export function resolveRepoPath(item: any, fallback?: string): string | undefined {
  return item?.repo?.path ?? item?.fullPath ?? item?.path ?? fallback;
}
