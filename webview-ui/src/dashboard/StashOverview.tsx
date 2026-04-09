import vscode from "../vscode";
import type { StashOverviewEntry } from "./DashboardApp";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface Props {
  entries: StashOverviewEntry[];
  collapsed: boolean;
  onToggle: () => void;
}

export default function StashOverview({ entries, collapsed, onToggle }: Props) {
  const totalStashes = entries.reduce((s, e) => s + e.stashes.length, 0);

  return (
    <div className="dashboard-section">
      <div className="dashboard-section-header" onClick={onToggle} style={{ cursor: "pointer" }}>
        <span>
          {collapsed ? "▸" : "▾"} Stashes{" "}
          <span className="section-badge">
            {totalStashes} across {entries.length} repo{entries.length !== 1 ? "s" : ""}
          </span>
        </span>
      </div>
      {!collapsed && (
        <div className="dashboard-section-body">
          {entries.map((repo) => (
            <div key={repo.repoPath} className="stash-repo">
              <div className="stash-repo-header">{repo.repoName}</div>
              {repo.stashes.map((s) => (
                <div key={s.index} className="stash-row">
                  <span className="stash-message">
                    {s.message}
                    {s.date && <span className="stash-date" title={s.date}> · {timeAgo(s.date)}</span>}
                  </span>
                  <span className="stash-actions">
                    <button
                      className="icon-btn"
                      onClick={() => vscode.postMessage({ type: "stashApply", repoPath: repo.repoPath, index: s.index })}
                      title="Apply (keep stash)"
                    >
                      Apply
                    </button>
                    {s.index === 0 && (
                      <button
                        className="icon-btn"
                        onClick={() => vscode.postMessage({ type: "stashPop", repoPath: repo.repoPath })}
                        title="Pop (apply and remove)"
                      >
                        Pop
                      </button>
                    )}
                    <button
                      className="icon-btn icon-btn--danger"
                      onClick={() => vscode.postMessage({ type: "stashDrop", repoPath: repo.repoPath, index: s.index })}
                      title="Drop (delete stash)"
                    >
                      Drop
                    </button>
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
