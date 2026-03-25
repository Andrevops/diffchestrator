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
