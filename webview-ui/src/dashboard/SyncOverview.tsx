import { useState } from "react";
import vscode from "../vscode";
import type { SyncOverviewEntry } from "./DashboardApp";

type SortKey = "name" | "branch" | "ahead" | "behind" | "totalChanges";
type SortDir = "asc" | "desc";

interface Props {
  entries: SyncOverviewEntry[];
  onOpenRepo: (path: string) => void;
}

export default function SyncOverview({ entries, onOpenRepo }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("totalChanges");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" || key === "branch" ? "asc" : "desc");
    }
  };

  const sorted = [...entries].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
    return sortDir === "asc" ? cmp : -cmp;
  });

  const indicator = (key: SortKey) =>
    sortKey === key ? (
      <span className="sort-indicator">{sortDir === "asc" ? "▲" : "▼"}</span>
    ) : null;

  const rowClass = (e: SyncOverviewEntry) => {
    if (e.behind > 0) return "sync-row--behind";
    if (e.totalChanges > 0) return "sync-row--changes";
    if (e.ahead > 0) return "sync-row--ahead";
    return "sync-row--clean";
  };

  const behindCount = entries.filter((e) => e.behind > 0).length;
  const aheadCount = entries.filter((e) => e.ahead > 0).length;
  const dirtyCount = entries.filter((e) => e.totalChanges > 0).length;

  return (
    <div className="dashboard-section">
      <div className="dashboard-section-header">
        <span>
          Sync Overview{" "}
          <span className="section-badge">
            {behindCount > 0 && `↓${behindCount} `}
            {aheadCount > 0 && `↑${aheadCount} `}
            {dirtyCount > 0 && `${dirtyCount} dirty`}
            {behindCount === 0 && aheadCount === 0 && dirtyCount === 0 && "All clean"}
          </span>
        </span>
        <span className="header-actions">
          <button
            className="refresh-btn"
            onClick={() => vscode.postMessage({ type: "fetchAll" })}
            title="Fetch all repos"
          >
            Fetch All
          </button>
          {behindCount > 0 && (
            <button
              className="refresh-btn"
              onClick={() => vscode.postMessage({ type: "pullAll" })}
            >
              Pull {behindCount} outdated
            </button>
          )}
          {aheadCount > 0 && (
            <button
              className="refresh-btn"
              onClick={() => vscode.postMessage({ type: "bulkPush" })}
            >
              Push {aheadCount} ahead
            </button>
          )}
        </span>
      </div>
      <div className="dashboard-section-body">
        {entries.length === 0 ? (
          <div className="section-empty">No repos scanned</div>
        ) : (
          <table className="sync-table">
            <thead>
              <tr>
                <th onClick={() => toggleSort("name")}>
                  Repo{indicator("name")}
                </th>
                <th onClick={() => toggleSort("branch")}>
                  Branch{indicator("branch")}
                </th>
                <th onClick={() => toggleSort("ahead")}>
                  ↑{indicator("ahead")}
                </th>
                <th onClick={() => toggleSort("behind")}>
                  ↓{indicator("behind")}
                </th>
                <th onClick={() => toggleSort("totalChanges")}>
                  Changes{indicator("totalChanges")}
                </th>
                <th title="Stashes">S</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => (
                <tr key={e.path} className={rowClass(e)}>
                  <td>
                    <span
                      className="sync-repo-link"
                      onClick={() => onOpenRepo(e.path)}
                    >
                      {e.name}
                    </span>
                  </td>
                  <td>{e.branch}</td>
                  <td>{e.ahead || ""}</td>
                  <td>{e.behind || ""}</td>
                  <td>{e.totalChanges || ""}</td>
                  <td>{e.stashCount || ""}</td>
                  <td className="sync-actions">
                    {e.behind > 0 && (
                      <button
                        className="icon-btn"
                        onClick={() => vscode.postMessage({ type: "pullRepo", repoPath: e.path })}
                        title="Pull"
                      >
                        ↓
                      </button>
                    )}
                    {e.ahead > 0 && (
                      <button
                        className="icon-btn"
                        onClick={() => vscode.postMessage({ type: "pushRepo", repoPath: e.path })}
                        title="Push"
                      >
                        ↑
                      </button>
                    )}
                    {e.totalChanges > 0 && (
                      <button
                        className="icon-btn"
                        onClick={() => vscode.postMessage({ type: "aiCommit", repoPath: e.path })}
                        title="AI Commit"
                      >
                        ✦
                      </button>
                    )}
                    {e.totalChanges > 0 && (
                      <button
                        className="icon-btn"
                        onClick={() => vscode.postMessage({ type: "discardAll", repoPath: e.path })}
                        title="Discard all changes"
                      >
                        ✕
                      </button>
                    )}
                    <button
                      className="icon-btn"
                      onClick={() => vscode.postMessage({ type: "switchBranch", repoPath: e.path })}
                      title="Switch branch"
                    >
                      ⎇
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() => vscode.postMessage({ type: "commitHistory", repoPath: e.path })}
                      title="Commit history"
                    >
                      ⏱
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() => vscode.postMessage({ type: "openRemoteUrl", repoPath: e.path })}
                      title="Open in browser"
                    >
                      ↗
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() => vscode.postMessage({ type: "copyRepoInfo", repoPath: e.path })}
                      title="Copy repo info"
                    >
                      ⎘
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() => vscode.postMessage({ type: "openTerminal", repoPath: e.path })}
                      title="Terminal"
                    >
                      &gt;_
                    </button>
                    <button
                      className="icon-btn"
                      onClick={() => vscode.postMessage({ type: "openClaude", repoPath: e.path })}
                      title="Claude Code"
                    >
                      ◇
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
