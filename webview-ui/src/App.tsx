import { useState, useEffect, useCallback } from "react";
import { parseDiff, Diff, Hunk } from "react-diff-view";
import "react-diff-view/style/index.css";
import vscode from "./vscode.ts";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface FileEntry {
  path: string;
  changeType: string; // M, A, D, R, ...
  status: "staged" | "unstaged" | "untracked";
}

interface RepoDiffData {
  name: string;
  path: string;
  branch: string;
  stagedDiff: string;
  unstagedDiff: string;
  stagedFiles: FileEntry[];
  unstagedFiles: FileEntry[];
  untrackedFiles: FileEntry[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function badgeChar(changeType: string): string {
  switch (changeType) {
    case "modified": return "M";
    case "added": return "A";
    case "deleted": return "D";
    case "renamed": return "R";
    case "unmerged": return "U";
    default: return "?";
  }
}

function safeParseDiff(raw: string) {
  if (!raw || !raw.trim()) return [];
  try {
    return parseDiff(raw);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function HunkWithActions({
  hunk,
  repoPath,
  filePath,
}: {
  hunk: Parameters<typeof Hunk>[0] extends { hunk: infer H } ? H : never;
  repoPath: string;
  filePath: string;
}) {
  const hunkContent = hunk.content || `@@ ${hunk.oldStart},${hunk.oldLines} ${hunk.newStart},${hunk.newLines} @@`;
  return (
    <div>
      <div className="hunk-header">
        <span>{hunkContent}</span>
        <button
          className="ask-claude-btn"
          title="Ask Claude about this hunk"
          onClick={(e) => {
            e.stopPropagation();
            vscode.postMessage({
              type: "askClaude",
              repoPath,
              filePath,
              hunkContent: hunkContent,
            });
          }}
        >
          Ask Claude
        </button>
      </div>
      <Hunk hunk={hunk} />
    </div>
  );
}

function FileSection({
  file,
  repoPath,
  diffFiles,
  isStaged,
}: {
  file: FileEntry;
  repoPath: string;
  diffFiles: ReturnType<typeof parseDiff>;
  isStaged: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  // Find matching diff for this file
  const matchingDiff = diffFiles.find(
    (d) => d.newPath === file.path || d.oldPath === file.path
  );
  const hunkCount = matchingDiff?.hunks?.length ?? 0;
  const badge = badgeChar(file.changeType);

  return (
    <div className="file-section">
      <div className="file-header" onClick={() => setExpanded(!expanded)}>
        <span className="file-toggle">{expanded ? "\u25BC" : "\u25B6"}</span>
        <span className={`file-badge ${badge}`}>{badge}</span>
        <span className="file-path" title={file.path}>{file.path}</span>
        {isStaged && <span className="file-staged-label">staged</span>}
        {hunkCount > 0 && <span className="hunk-count">{hunkCount} hunk{hunkCount !== 1 ? "s" : ""}</span>}
        <button
          className="icon-btn"
          title={isStaged ? "Unstage file" : "Stage file"}
          onClick={(e) => {
            e.stopPropagation();
            vscode.postMessage({
              type: isStaged ? "unstageFile" : "stageFile",
              repoPath,
              filePath: file.path,
            });
          }}
        >
          {isStaged ? "\u2212" : "+"}
        </button>
      </div>
      {expanded && matchingDiff && (
        <div className="file-body">
          <div className="diff-wrapper">
            <Diff viewType="unified" diffType={matchingDiff.type} hunks={matchingDiff.hunks}>
              {(hunks) =>
                hunks.map((hunk) => (
                  <HunkWithActions
                    key={hunk.content}
                    hunk={hunk}
                    repoPath={repoPath}
                    filePath={file.path}
                  />
                ))
              }
            </Diff>
          </div>
        </div>
      )}
      {expanded && !matchingDiff && (
        <div className="file-body">
          <p style={{ color: "var(--vscode-descriptionForeground)", fontSize: 12, margin: "4px 8px" }}>
            {file.status === "untracked" ? "Untracked file (no diff available)" : "No diff content"}
          </p>
        </div>
      )}
    </div>
  );
}

function RepoSection({ repo }: { repo: RepoDiffData }) {
  const [expanded, setExpanded] = useState(true);

  const stagedDiffs = safeParseDiff(repo.stagedDiff);
  const unstagedDiffs = safeParseDiff(repo.unstagedDiff);

  const totalChanges =
    repo.stagedFiles.length + repo.unstagedFiles.length + repo.untrackedFiles.length;

  return (
    <div className="repo-section">
      <div className="repo-header" onClick={() => setExpanded(!expanded)}>
        <span className="repo-toggle">{expanded ? "\u25BC" : "\u25B6"}</span>
        <span className="repo-name">{repo.name}</span>
        <span className="repo-branch">{repo.branch}</span>
        {totalChanges > 0 && (
          <span className="repo-changes">{totalChanges}</span>
        )}
        <div className="repo-actions">
          <button
            className="icon-btn"
            title="Open terminal"
            onClick={(e) => {
              e.stopPropagation();
              vscode.postMessage({ type: "openTerminal", repoPath: repo.path });
            }}
          >
            &gt;_
          </button>
        </div>
      </div>

      {expanded && (
        <div className="repo-body">
          {totalChanges === 0 && (
            <p style={{ color: "var(--vscode-descriptionForeground)", fontSize: 12, margin: "8px 0" }}>
              No changes
            </p>
          )}

          {/* Staged files */}
          {repo.stagedFiles.length > 0 && (
            <>
              <div className="staging-header">
                <span>Staged ({repo.stagedFiles.length})</span>
                <button
                  className="stage-all-btn"
                  onClick={() =>
                    vscode.postMessage({
                      type: "unstageAll",
                      repoPath: repo.path,
                    })
                  }
                >
                  Unstage All
                </button>
              </div>
              {repo.stagedFiles.map((file) => (
                <FileSection
                  key={`staged-${file.path}`}
                  file={file}
                  repoPath={repo.path}
                  diffFiles={stagedDiffs}
                  isStaged={true}
                />
              ))}
            </>
          )}

          {/* Unstaged files */}
          {repo.unstagedFiles.length > 0 && (
            <>
              <div className="staging-header">
                <span>Unstaged ({repo.unstagedFiles.length})</span>
                <button
                  className="stage-all-btn"
                  onClick={() =>
                    vscode.postMessage({
                      type: "stageAll",
                      repoPath: repo.path,
                    })
                  }
                >
                  Stage All
                </button>
              </div>
              {repo.unstagedFiles.map((file) => (
                <FileSection
                  key={`unstaged-${file.path}`}
                  file={file}
                  repoPath={repo.path}
                  diffFiles={unstagedDiffs}
                  isStaged={false}
                />
              ))}
            </>
          )}

          {/* Untracked files */}
          {repo.untrackedFiles.length > 0 && (
            <>
              <div className="staging-header">
                <span>Untracked ({repo.untrackedFiles.length})</span>
                <button
                  className="stage-all-btn"
                  onClick={() =>
                    vscode.postMessage({
                      type: "stageAll",
                      repoPath: repo.path,
                    })
                  }
                >
                  Stage All
                </button>
              </div>
              {repo.untrackedFiles.map((file) => (
                <FileSection
                  key={`untracked-${file.path}`}
                  file={file}
                  repoPath={repo.path}
                  diffFiles={[]}
                  isStaged={false}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main App                                                           */
/* ------------------------------------------------------------------ */

export default function App() {
  const [repos, setRepos] = useState<RepoDiffData[]>([]);
  const [loading, setLoading] = useState(true);

  const handleMessage = useCallback((event: MessageEvent) => {
    const msg = event.data;
    switch (msg.type) {
      case "setDiffData":
        setRepos(msg.repos as RepoDiffData[]);
        setLoading(false);
        break;
      case "refreshing":
        setLoading(true);
        break;
    }
  }, []);

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    // Tell extension we're ready
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  if (loading) {
    return (
      <div className="app-container">
        <div className="loading-state">
          <span className="spinner" />
          Loading diffs...
        </div>
      </div>
    );
  }

  if (repos.length === 0) {
    return (
      <div className="app-container">
        <div className="empty-state">
          <h3>No Changes Detected</h3>
          <p>All selected repositories are clean.</p>
          <div className="empty-state-actions">
            <button
              className="refresh-btn"
              onClick={() => vscode.postMessage({ type: "openTerminal" })}
            >
              Open Terminal
            </button>
            <button
              className="refresh-btn"
              onClick={() => vscode.postMessage({ type: "refresh" })}
            >
              Refresh
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <div className="app-header">
        <h2>Multi-Repo Diff ({repos.length} repo{repos.length !== 1 ? "s" : ""})</h2>
        <button
          className="refresh-btn"
          onClick={() => vscode.postMessage({ type: "refresh" })}
        >
          Refresh
        </button>
      </div>
      {repos.map((repo) => (
        <RepoSection key={repo.path} repo={repo} />
      ))}
    </div>
  );
}
