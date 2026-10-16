import { useState, useEffect, useCallback, useMemo } from "react";
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
  stagedFiles: FileEntry[];
  unstagedFiles: FileEntry[];
  untrackedFiles: FileEntry[];
}

interface FileDiffResponse {
  requestId: number;
  diff?: string;
  lineCount?: number;
  truncated?: boolean;
  tooLarge?: boolean;
  error?: string;
}

type DiffFile = ReturnType<typeof parseDiff>[number];
type HunkData = DiffFile["hunks"][number];

/** Changed lines rendered per file before a "Show more" control. */
const RENDER_STEP = 500;
/** Max hunk text sent to the extension (it caps the final prompt further). */
const MAX_HUNK_TEXT = 100_000;

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

function safeParseDiff(raw: string): DiffFile[] {
  if (!raw || !raw.trim()) return [];
  try {
    return parseDiff(raw);
  } catch {
    return [];
  }
}

/**
 * Unified-diff text of a hunk: the @@ header plus every change line with its
 * +/-/space prefix. (gitdiff-parser's `hunk.content` is only the header.)
 */
function hunkToText(hunk: HunkData): string {
  const header = hunk.content || `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
  const out = [header];
  let size = header.length;
  for (const c of hunk.changes) {
    const prefix = c.type === "insert" ? "+" : c.type === "delete" ? "-" : " ";
    const line = prefix + c.content;
    size += line.length + 1;
    if (size > MAX_HUNK_TEXT) break;
    out.push(line);
  }
  return out.join("\n");
}

/** Hunks limited to `limit` change lines in total (the last one may be partial). */
function limitHunks(hunks: HunkData[], limit: number): { visible: HunkData[]; total: number; shown: number } {
  const total = hunks.reduce((n, h) => n + h.changes.length, 0);
  if (total <= limit) return { visible: hunks, total, shown: total };
  const visible: HunkData[] = [];
  let shown = 0;
  for (const h of hunks) {
    const room = limit - shown;
    if (room <= 0) break;
    if (h.changes.length <= room) {
      visible.push(h);
      shown += h.changes.length;
    } else {
      visible.push({ ...h, changes: h.changes.slice(0, room) });
      shown += room;
    }
  }
  return { visible, total, shown };
}

/* ------------------------------------------------------------------ */
/*  Lazy per-file diff requests                                        */
/* ------------------------------------------------------------------ */

let nextRequestId = 0;
const pendingDiffs = new Map<number, (r: FileDiffResponse) => void>();

function requestFileDiff(
  repoPath: string,
  filePath: string,
  staged: boolean,
  force: boolean,
  onResult: (r: FileDiffResponse) => void
): () => void {
  const requestId = ++nextRequestId;
  pendingDiffs.set(requestId, onResult);
  vscode.postMessage({ type: "getFileDiff", requestId, repoPath, filePath, staged, force });
  return () => pendingDiffs.delete(requestId);
}

function resolveFileDiff(msg: FileDiffResponse) {
  const cb = pendingDiffs.get(msg.requestId);
  if (!cb) return;
  pendingDiffs.delete(msg.requestId);
  cb(msg);
}

type DiffState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; diff: string; truncated: boolean }
  | { kind: "tooLarge"; lineCount: number }
  | { kind: "error"; message: string };

/**
 * Fetches a file's diff while expanded. Refetches when `version` changes (new
 * status data arrived) but keeps showing the previous diff meanwhile, so a
 * refresh never collapses or blanks an open file.
 */
function useFileDiff(
  enabled: boolean,
  repoPath: string,
  filePath: string,
  staged: boolean,
  version: number,
  force: boolean
): DiffState {
  const [state, setState] = useState<DiffState>({ kind: "idle" });
  useEffect(() => {
    if (!enabled) return;
    setState((prev) => (prev.kind === "loaded" ? prev : { kind: "loading" }));
    return requestFileDiff(repoPath, filePath, staged, force, (r) => {
      if (r.error !== undefined) setState({ kind: "error", message: r.error });
      else if (r.tooLarge) setState({ kind: "tooLarge", lineCount: r.lineCount ?? 0 });
      else setState({ kind: "loaded", diff: r.diff ?? "", truncated: !!r.truncated });
    });
  }, [enabled, repoPath, filePath, staged, version, force]);
  return state;
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function HunkWithActions({
  hunk,
  repoPath,
  filePath,
}: {
  hunk: HunkData;
  repoPath: string;
  filePath: string;
}) {
  const hunkHeader = hunk.content || `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
  return (
    <div>
      <div className="hunk-header">
        <span>{hunkHeader}</span>
        <button
          className="ask-claude-btn"
          title="Ask Claude about this hunk"
          onClick={(e) => {
            e.stopPropagation();
            vscode.postMessage({
              type: "askClaude",
              repoPath,
              filePath,
              hunkContent: hunkToText(hunk),
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

function FileDiffBody({
  state,
  file,
  repoPath,
  onForce,
}: {
  state: DiffState;
  file: FileEntry;
  repoPath: string;
  onForce: () => void;
}) {
  const [limit, setLimit] = useState(RENDER_STEP);
  const diffText = state.kind === "loaded" ? state.diff : "";
  const parsed = useMemo(() => safeParseDiff(diffText), [diffText]);
  const matchingDiff =
    parsed.find((d) => d.newPath === file.path || d.oldPath === file.path) ?? parsed[0];
  const { visible, total, shown } = useMemo(
    () => limitHunks(matchingDiff?.hunks ?? [], limit),
    [matchingDiff, limit]
  );

  if (file.status === "untracked") {
    return <p className="file-note">Untracked file (no diff available)</p>;
  }
  if (state.kind === "loading" || state.kind === "idle") {
    return (
      <p className="file-note">
        <span className="spinner spinner--inline" aria-hidden="true" /> Loading diff…
      </p>
    );
  }
  if (state.kind === "error") {
    return <p className="file-note file-note--error">Failed to load diff: {state.message}</p>;
  }
  if (state.kind === "tooLarge") {
    return (
      <p className="file-note">
        Large diff ({state.lineCount.toLocaleString()} lines) not loaded.{" "}
        <button className="link-btn" onClick={onForce}>Load anyway</button>
      </p>
    );
  }
  if (!matchingDiff) {
    return <p className="file-note">No diff content</p>;
  }
  return (
    <>
      <div className="diff-wrapper">
        <Diff viewType="unified" diffType={matchingDiff.type} hunks={visible}>
          {(hunks) =>
            hunks.map((hunk) => (
              <HunkWithActions
                key={`${file.path}-${hunk.oldStart}-${hunk.newStart}`}
                hunk={hunk}
                repoPath={repoPath}
                filePath={file.path}
              />
            ))
          }
        </Diff>
      </div>
      {shown < total && (
        <p className="file-note">
          Showing {shown.toLocaleString()} of {total.toLocaleString()} lines.{" "}
          <button className="link-btn" onClick={() => setLimit((l) => l + RENDER_STEP * 4)}>
            Show more
          </button>{" "}
          <button className="link-btn" onClick={() => setLimit(Number.POSITIVE_INFINITY)}>
            Show all
          </button>
        </p>
      )}
      {state.truncated && (
        <p className="file-note">Diff truncated — open the file's diff in the editor for the full change.</p>
      )}
    </>
  );
}

function FileSection({
  file,
  repoPath,
  isStaged,
  version,
}: {
  file: FileEntry;
  repoPath: string;
  isStaged: boolean;
  version: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const [force, setForce] = useState(false);
  const canDiff = file.status !== "untracked";
  const state = useFileDiff(expanded && canDiff, repoPath, file.path, isStaged, version, force);
  const hunkCount = useMemo(() => {
    if (state.kind !== "loaded") return 0;
    return (state.diff.match(/^@@ /gm) ?? []).length;
  }, [state]);
  const badge = badgeChar(file.changeType);

  return (
    <div className="file-section">
      <div className="file-header">
        <button
          type="button"
          className="header-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          title={file.path}
        >
          <span className="file-toggle" aria-hidden="true">{expanded ? "▼" : "▶"}</span>
          <span className={`file-badge ${badge}`} title={file.changeType}>{badge}</span>
          <span className="file-path">{file.path}</span>
          {isStaged && <span className="file-staged-label">staged</span>}
          {hunkCount > 0 && <span className="hunk-count">{hunkCount} hunk{hunkCount !== 1 ? "s" : ""}</span>}
        </button>
        <button
          className="icon-btn"
          title={isStaged ? "Unstage file" : "Stage file"}
          aria-label={`${isStaged ? "Unstage" : "Stage"} ${file.path}`}
          onClick={() => {
            vscode.postMessage({
              type: isStaged ? "unstageFile" : "stageFile",
              repoPath,
              filePath: file.path,
            });
          }}
        >
          {isStaged ? "−" : "+"}
        </button>
      </div>
      {expanded && (
        <div className="file-body">
          <FileDiffBody state={state} file={file} repoPath={repoPath} onForce={() => setForce(true)} />
        </div>
      )}
    </div>
  );
}

function FileGroup({
  label,
  files,
  repoPath,
  isStaged,
  version,
  actionLabel,
  actionType,
}: {
  label: string;
  files: FileEntry[];
  repoPath: string;
  isStaged: boolean;
  version: number;
  actionLabel: string;
  actionType: "stageAll" | "unstageAll";
}) {
  if (files.length === 0) return null;
  return (
    <>
      <div className="staging-header">
        <span>{label} ({files.length})</span>
        <button
          className="stage-all-btn"
          onClick={() => vscode.postMessage({ type: actionType, repoPath })}
        >
          {actionLabel}
        </button>
      </div>
      {files.map((file) => (
        <FileSection
          key={`${file.status}-${file.path}`}
          file={file}
          repoPath={repoPath}
          isStaged={isStaged}
          version={version}
        />
      ))}
    </>
  );
}

function RepoSection({ repo, version }: { repo: RepoDiffData; version: number }) {
  const [expanded, setExpanded] = useState(true);

  const totalChanges =
    repo.stagedFiles.length + repo.unstagedFiles.length + repo.untrackedFiles.length;

  return (
    <div className="repo-section">
      <div className="repo-header">
        <button
          type="button"
          className="header-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <span className="repo-toggle" aria-hidden="true">{expanded ? "▼" : "▶"}</span>
          <span className="repo-name">{repo.name}</span>
          <span className="repo-branch">{repo.branch}</span>
          {totalChanges > 0 && (
            <span className="repo-changes" aria-label={`${totalChanges} changes`}>{totalChanges}</span>
          )}
        </button>
        <div className="repo-actions">
          <button
            className="icon-btn"
            title="Open terminal"
            aria-label={`Open terminal in ${repo.name}`}
            onClick={() => vscode.postMessage({ type: "openTerminal", repoPath: repo.path })}
          >
            &gt;_
          </button>
        </div>
      </div>

      {expanded && (
        <div className="repo-body">
          {totalChanges === 0 && <p className="file-note">No changes</p>}
          <FileGroup
            label="Staged"
            files={repo.stagedFiles}
            repoPath={repo.path}
            isStaged={true}
            version={version}
            actionLabel="Unstage All"
            actionType="unstageAll"
          />
          <FileGroup
            label="Unstaged"
            files={repo.unstagedFiles}
            repoPath={repo.path}
            isStaged={false}
            version={version}
            actionLabel="Stage All"
            actionType="stageAll"
          />
          <FileGroup
            label="Untracked"
            files={repo.untrackedFiles}
            repoPath={repo.path}
            isStaged={false}
            version={version}
            actionLabel="Stage All"
            actionType="stageAll"
          />
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
  const [noSelection, setNoSelection] = useState(false);
  // Full-screen spinner only until the first data arrives; later refreshes
  // keep the tree mounted (and expanded files open) and show a small
  // indicator instead.
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Bumped on every data push so expanded files refetch their diff.
  const [version, setVersion] = useState(0);

  const handleMessage = useCallback((event: MessageEvent) => {
    const msg = event.data;
    switch (msg?.type) {
      case "setDiffData":
        setRepos(Array.isArray(msg.repos) ? (msg.repos as RepoDiffData[]) : []);
        setNoSelection(msg.noSelection === true);
        setVersion((v) => v + 1);
        setInitialLoading(false);
        setRefreshing(false);
        break;
      case "refreshing":
        setRefreshing(true);
        break;
      case "fileDiff":
        resolveFileDiff(msg as FileDiffResponse);
        break;
    }
  }, []);

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    // Tell extension we're ready
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  if (initialLoading) {
    return (
      <div className="app-container">
        <div className="loading-state" role="status">
          <span className="spinner" aria-hidden="true" />
          Loading diffs...
        </div>
      </div>
    );
  }

  const refreshButton = (
    <button
      className="refresh-btn"
      onClick={() => {
        setRefreshing(true);
        vscode.postMessage({ type: "refresh" });
      }}
      disabled={refreshing}
      aria-busy={refreshing}
    >
      {refreshing ? <span className="spinner spinner--inline" aria-hidden="true" /> : null}
      Refresh
    </button>
  );

  if (noSelection) {
    return (
      <div className="app-container">
        <div className="empty-state">
          <h3>No Repositories Selected</h3>
          <p>Select one or more repositories in the Diffchestrator sidebar to see their changes here.</p>
          <div className="empty-state-actions">{refreshButton}</div>
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
          <div className="empty-state-actions">{refreshButton}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <div className="app-header">
        <h2>Multi-Repo Diff ({repos.length} repo{repos.length !== 1 ? "s" : ""})</h2>
        {refreshButton}
      </div>
      {repos.map((repo) => (
        <RepoSection key={repo.path} repo={repo} version={version} />
      ))}
    </div>
  );
}
