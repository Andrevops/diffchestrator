import { useState } from "react";
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
        Sync Overview
        <span className="section-badge">
          {behindCount > 0 && `↓${behindCount} `}
          {aheadCount > 0 && `↑${aheadCount} `}
          {dirtyCount > 0 && `${dirtyCount} dirty`}
          {behindCount === 0 && aheadCount === 0 && dirtyCount === 0 && "All clean"}
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
