import vscode from "../vscode";
import type { StashOverviewEntry } from "./DashboardApp";

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
                  <span className="stash-message">{s.message}</span>
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
