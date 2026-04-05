import type { SessionSummaryEntry } from "./DashboardApp";

interface Props {
  entries: SessionSummaryEntry[];
  sessionStartTime: string;
  collapsed: boolean;
  onToggle: () => void;
}

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

export default function SessionSummary({ entries, sessionStartTime, collapsed, onToggle }: Props) {
  const totalCommits = entries.reduce((s, e) => s + e.commits.length, 0);

  return (
    <div className="dashboard-section">
      <div className="dashboard-section-header" onClick={onToggle} style={{ cursor: "pointer" }}>
        <span>
          {collapsed ? "▸" : "▾"} Session Summary{" "}
          <span className="section-badge">
            {totalCommits > 0
              ? `${totalCommits} commit${totalCommits !== 1 ? "s" : ""}`
              : "No commits"}
          </span>
        </span>
      </div>
      {!collapsed && (
        <div className="dashboard-section-body">
          {entries.length === 0 ? (
            <div className="section-empty">
              No commits since session started
              {sessionStartTime && (
                <div style={{ marginTop: 4, fontSize: 10 }}>
                  Session: {new Date(sessionStartTime).toLocaleTimeString()}
                </div>
              )}
            </div>
          ) : (
            entries.map((repo) => (
              <div key={repo.repoPath} className="session-repo">
                <div className="session-repo-header">
                  {repo.repoName}
                  <span className="section-badge">{repo.commits.length}</span>
                </div>
                {repo.commits.map((c) => (
                  <div key={c.hash} className="session-commit">
                    <span className="commit-hash">{c.shortHash}</span>
                    <span className="commit-message">{c.message}</span>
                    <span className="commit-time">{timeAgo(c.date)}</span>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
