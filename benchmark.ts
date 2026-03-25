import { performance } from "perf_hooks";

// Mock VS Code API
const mockTabGroups = {
  all: [
    {
      tabs: Array.from({ length: 100 }, (_, i) => ({
        input: { uri: { scheme: "file", fsPath: `/repo/path/file${i}.txt` } }
      }))
    },
    {
      tabs: Array.from({ length: 100 }, (_, i) => ({
        input: { uri: { scheme: "file", fsPath: `/other/path/file${i}.txt` } }
      }))
    }
  ],
  async close(tabs: any | any[]) {
    // Simulate delay
    await new Promise(resolve => setTimeout(resolve, 5));
    return true;
  }
};

function uriBelongsToRepo(uri: any, repoPath: string): boolean {
  if (uri.scheme === "file" && uri.fsPath.startsWith(repoPath)) return true;
  if (uri.scheme === "git-show") {
    try {
      const params = JSON.parse(uri.query);
      if (params.repoPath === repoPath) return true;
    } catch { /* ignore */ }
  }
  return false;
}

async function closeEditorsForRepoUnoptimized(repoPath: string): Promise<void> {
  for (const group of mockTabGroups.all) {
    for (const tab of group.tabs) {
      let belongsToRepo = false;
      const input = tab.input as any;
      if (input?.uri) {
        belongsToRepo = uriBelongsToRepo(input.uri, repoPath);
      } else if (input?.original && input?.modified) {
        belongsToRepo =
          uriBelongsToRepo(input.original, repoPath) ||
          uriBelongsToRepo(input.modified, repoPath);
      }
      if (belongsToRepo) {
        await mockTabGroups.close(tab);
      }
    }
  }
}

async function closeEditorsForRepoOptimized(repoPath: string): Promise<void> {
  const tabsToClose: any[] = [];
  for (const group of mockTabGroups.all) {
    for (const tab of group.tabs) {
      let belongsToRepo = false;
      const input = tab.input as any;
      if (input?.uri) {
        belongsToRepo = uriBelongsToRepo(input.uri, repoPath);
      } else if (input?.original && input?.modified) {
        belongsToRepo =
          uriBelongsToRepo(input.original, repoPath) ||
          uriBelongsToRepo(input.modified, repoPath);
      }
      if (belongsToRepo) {
        tabsToClose.push(tab);
      }
    }
  }
  if (tabsToClose.length > 0) {
    await mockTabGroups.close(tabsToClose);
  }
}

async function run() {
  const startUnoptimized = performance.now();
  await closeEditorsForRepoUnoptimized("/repo/path");
  const endUnoptimized = performance.now();
  console.log(`Unoptimized: ${endUnoptimized - startUnoptimized} ms`);

  const startOptimized = performance.now();
  await closeEditorsForRepoOptimized("/repo/path");
  const endOptimized = performance.now();
  console.log(`Optimized: ${endOptimized - startOptimized} ms`);
}

run();
