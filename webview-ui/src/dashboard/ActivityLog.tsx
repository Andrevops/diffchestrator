import { useState, useMemo } from "react";
import vscode from "../vscode";
import type { ActivityEntry } from "./DashboardApp";
import { timeAgo } from "./timeAgo";

interface Props {
  entries: ActivityEntry[];
}

function groupByDate(entries: ActivityEntry[]): Map<string, ActivityEntry[]> {
  const groups = new Map<string, ActivityEntry[]>();
  for (const e of entries) {
    const day = new Date(e.date).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const group = groups.get(day) || [];
    group.push(e);
    groups.set(day, group);
  }
  return groups;
}

export default function ActivityLog({ entries }: Props) {
  const [repoFilter, setRepoFilter] = useState("");
  const [authorFilter, setAuthorFilter] = useState("");

  const repos = useMemo(() => [...new Set(entries.map((e) => e.repoName))].sort(), [entries]);
  const authors = useMemo(() => [...new Set(entries.map((e) => e.author))].sort(), [entries]);

  const filtered = useMemo(
    () =>
      entries.filter((e) => {
        if (repoFilter && e.repoName !== repoFilter) return false;
        if (authorFilter && e.author !== authorFilter) return false;
        return true;
      }),
    [entries, repoFilter, authorFilter]
  );

  const grouped = useMemo(() => groupByDate(filtered), [filtered]);

  return (
    <div className="activity-panel">
      <div className="activity-filters">
        <select
          className="activity-filter-select"
          value={repoFilter}
          onChange={(e) => setRepoFilter(e.target.value)}
        >
          <option value="">All repos ({repos.length})</option>
          {repos.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select
          className="activity-filter-select"
          value={authorFilter}
          onChange={(e) => setAuthorFilter(e.target.value)}
        >
          <option value="">All authors ({authors.length})</option>
          {authors.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        {(repoFilter || authorFilter) && (
          <button
            className="icon-btn"
            onClick={() => { setRepoFilter(""); setAuthorFilter(""); }}
            title="Clear filters"
          >
            Clear
          </button>
        )}
        <span className="activity-count">{filtered.length} commits</span>
        {filtered.length > 0 && (
          <>
            <button
              className="icon-btn"
              onClick={() => vscode.postMessage({ type: "exportActivity", format: "clipboard", entries: filtered })}
              title="Copy as Markdown"
            >
              ⎘
            </button>
            <button
              className="icon-btn"
              onClick={() => vscode.postMessage({ type: "exportActivity", format: "file", entries: filtered })}
              title="Save as Markdown file"
            >
              ⬇
            </button>
          </>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="section-empty">
          {entries.length === 0
            ? "No recent activity across repos"
            : "No commits match filters"}
        </div>
      ) : (
        [...grouped.entries()].map(([day, commits]) => (
          <div key={day} className="activity-day">
            <div className="activity-day-header">{day} <span className="section-badge">{commits.length}</span></div>
            {commits.map((c, i) => (
              <div key={`${c.shortHash}-${i}`} className="activity-row">
                <span className="commit-hash">{c.shortHash}</span>
                <span className="activity-repo">{c.repoName}</span>
                <span className="commit-message">{c.message}</span>
                <span className="activity-author">{c.author}</span>
                <span className="commit-time">{timeAgo(c.date)}</span>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
