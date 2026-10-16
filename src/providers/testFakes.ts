// Test-only helper: minimal RepoManager stand-in for provider tests.
import * as vscode from "vscode";
import type { RepoSummary } from "../types.ts";

export function fakeRepoManager(overrides: Record<string, unknown> = {}) {
  const changeRepos = new vscode.EventEmitter<void>();
  const changeSelection = new vscode.EventEmitter<void>();
  const rm = {
    onDidChangeRepos: changeRepos.event,
    onDidChangeSelection: changeSelection.event,
    repos: [] as RepoSummary[],
    allRepos: [] as RepoSummary[],
    selectedRepo: undefined as string | undefined,
    selectedRepoPaths: new Set<string>(),
    changedOnly: false,
    git: {},
    ...overrides,
  };
  return { rm, changeRepos, changeSelection };
}
