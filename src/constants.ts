export const EXTENSION_ID = "diffchestrator";

export const VIEW_ACTIVE_REPOS = "diffchestrator.activeRepos";
export const VIEW_REPOS = "diffchestrator.repos";
export const VIEW_FAVORITES = "diffchestrator.favorites";
export const VIEW_CHANGED_FILES = "diffchestrator.changedFiles";

export const CMD = {
  scan: "diffchestrator.scan",
  rescan: "diffchestrator.rescan",
  toggleChangedOnly: "diffchestrator.toggleChangedOnly",
  toggleFavorite: "diffchestrator.toggleFavorite",
  viewDiff: "diffchestrator.viewDiff",
  viewMultiRepoDiff: "diffchestrator.viewMultiRepoDiff",
  stageFile: "diffchestrator.stageFile",
  unstageFile: "diffchestrator.unstageFile",
  stageAll: "diffchestrator.stageAll",
  unstageAll: "diffchestrator.unstageAll",
  commit: "diffchestrator.commit",
  push: "diffchestrator.push",
  pull: "diffchestrator.pull",
  aiCommit: "diffchestrator.aiCommit",
  bulkCommit: "diffchestrator.bulkCommit",
  bulkPush: "diffchestrator.bulkPush",
  openClaudeCode: "diffchestrator.openClaudeCode",
  searchFiles: "diffchestrator.searchFiles",
  browseFiles: "diffchestrator.browseFiles",
  openTerminal: "diffchestrator.openTerminal",
  selectRepo: "diffchestrator.selectRepo",
  clearSelection: "diffchestrator.clearSelection",
  switchRepo: "diffchestrator.switchRepo",
  yolo: "diffchestrator.yolo",
  commitHistory: "diffchestrator.commitHistory",
  discardFile: "diffchestrator.discardFile",
  discardAll: "diffchestrator.discardAll",
  switchBranch: "diffchestrator.switchBranch",
  stash: "diffchestrator.stash",
  toggleBlame: "diffchestrator.toggleBlame",
  favoriteCurrent: "diffchestrator.favoriteCurrent",
  searchInRepo: "diffchestrator.searchInRepo",
  grepInRepo: "diffchestrator.grepInRepo",
  grepActiveRepos: "diffchestrator.grepActiveRepos",
  grepAllRepos: "diffchestrator.grepAllRepos",
  stageCurrentFile: "diffchestrator.stageCurrentFile",
  unstageCurrentFile: "diffchestrator.unstageCurrentFile",
  cycleActiveRepo: "diffchestrator.cycleActiveRepo",
} as const;

export const CONFIG = {
  scanRoots: "diffchestrator.scanRoots",
  scanMaxDepth: "diffchestrator.scanMaxDepth",
  scanExtraSkipDirs: "diffchestrator.scanExtraSkipDirs",
  scanOnStartup: "diffchestrator.scanOnStartup",
  changedOnlyDefault: "diffchestrator.changedOnlyDefault",
  autoRefreshInterval: "diffchestrator.autoRefreshInterval",
  favorites: "diffchestrator.favorites",
  claudePermissionMode: "diffchestrator.claudePermissionMode",
  showInlineBlame: "diffchestrator.showInlineBlame",
} as const;

export const CTX = {
  hasRepos: "diffchestrator.hasRepos",
  hasFavorites: "diffchestrator.hasFavorites",
  hasSelectedRepo: "diffchestrator.hasSelectedRepo",
  hasMultiSelection: "diffchestrator.hasMultiSelection",
  changedOnly: "diffchestrator.changedOnly",
} as const;
