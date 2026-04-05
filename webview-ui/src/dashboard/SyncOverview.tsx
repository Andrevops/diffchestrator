import { useState, useRef, useEffect } from "react";
import vscode from "../vscode";
import type { SyncOverviewEntry } from "./DashboardApp";

type SortKey = "name" | "branch" | "ahead" | "behind" | "totalChanges" | "healthScore";
type SortDir = "asc" | "desc";

interface Props {
  entries: SyncOverviewEntry[];
  onOpenRepo: (path: string) => void;
  collapsed: boolean;
  onToggle: () => void;
}

function statusDot(e: SyncOverviewEntry) {
  if (e.behind > 0) return <span className="status-dot status-dot--behind" title="Behind remote" />;
  if (e.totalChanges > 0) return <span className="status-dot status-dot--dirty" title="Has changes" />;
  if (e.ahead > 0) return <span className="status-dot status-dot--ahead" title="Ahead of remote" />;
  return <span className="status-dot status-dot--clean" title="Clean" />;
}

function healthBadge(score: number) {
  const cls = score >= 80 ? "health--good" : score >= 50 ? "health--warn" : "health--bad";
  return <span className={`health-badge ${cls}`} title={`Health: ${score}/100`}>{score}</span>;
}

export default function SyncOverview({ entries, onOpenRepo, collapsed, onToggle }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("totalChanges");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [search, setSearch] = useState("");
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [loadingRepo, setLoadingRepo] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" || key === "branch" ? "asc" : "desc");
    }
  };

  const filtered = entries.filter(
    (e) =>
      !search ||
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.branch.toLowerCase().includes(search.toLowerCase())
  );

  const sorted = [...filtered].sort((a, b) => {
    // Pinned repos always first
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    const av = a[sortKey];
    const bv = b[sortKey];
    const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
    return sortDir === "asc" ? cmp : -cmp;
  });

  const indicator = (key: SortKey) =>
    sortKey === key ? (
      <span className="sort-indicator">{sortDir === "asc" ? "▲" : "▼"}</span>
    ) : null;

  const rowClass = (e: SyncOverviewEntry, idx: number) => {
    const classes = [];
    if (e.isPinned) classes.push("sync-row--pinned");
    if (e.behind > 0) classes.push("sync-row--behind");
    else if (e.totalChanges > 0) classes.push("sync-row--changes");
    else if (e.ahead > 0) classes.push("sync-row--ahead");
    else classes.push("sync-row--clean");
    if (idx === selectedIdx) classes.push("sync-row--selected");
    return classes.join(" ");
  };

  const behindCount = entries.filter((e) => e.behind > 0).length;
  const aheadCount = entries.filter((e) => e.ahead > 0).length;
  const dirtyCount = entries.filter((e) => e.totalChanges > 0).length;

  const sendAction = (type: string, repoPath: string) => {
    setLoadingRepo(repoPath);
    setOpenMenu(null);
    vscode.postMessage({ type, repoPath });
    // Clear loading after a delay (dashboard update will arrive)
    setTimeout(() => setLoadingRepo(null), 3000);
  };

  // Close menu on outside click
  useEffect(() => {
    if (!openMenu) return;
    const handler = () => setOpenMenu(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [openMenu]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, sorted.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && selectedIdx >= 0 && selectedIdx < sorted.length) {
        onOpenRepo(sorted[selectedIdx].path);
      } else if (e.key === "/" && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        document.querySelector<HTMLInputElement>(".sync-search")?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [sorted, selectedIdx, onOpenRepo]);

  return (
    <div className="dashboard-section">
      <div className="dashboard-section-header" onClick={onToggle} style={{ cursor: "pointer" }}>
        <span>
          {collapsed ? "▸" : "▾"} Sync Overview{" "}
          <span className="section-badge">
            {behindCount > 0 && `↓${behindCount} `}
            {aheadCount > 0 && `↑${aheadCount} `}
            {dirtyCount > 0 && `${dirtyCount} dirty`}
            {behindCount === 0 && aheadCount === 0 && dirtyCount === 0 && "All clean"}
          </span>
        </span>
        {!collapsed && (
          <span className="header-actions" onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn" onClick={() => vscode.postMessage({ type: "fetchAll" })} title="Fetch all repos">
              ⟳
            </button>
            {behindCount > 0 && (
              <button className="refresh-btn" onClick={() => vscode.postMessage({ type: "pullAll" })}>
                Pull {behindCount}
              </button>
            )}
            {aheadCount > 0 && (
              <button className="refresh-btn" onClick={() => vscode.postMessage({ type: "bulkPush" })}>
                Push {aheadCount}
              </button>
            )}
          </span>
        )}
      </div>
      {!collapsed && (
        <div className="dashboard-section-body">
          {entries.length === 0 ? (
            <div className="section-empty">No repos scanned</div>
          ) : (
            <>
              <input
                className="sync-search"
                type="text"
                placeholder="Filter repos... ( / )"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setSelectedIdx(-1); }}
              />
              <table className="sync-table">
                <thead>
                  <tr>
                    <th onClick={() => toggleSort("name")}>Repo{indicator("name")}</th>
                    <th onClick={() => toggleSort("branch")}>Branch{indicator("branch")}</th>
                    <th onClick={() => toggleSort("ahead")}>↑{indicator("ahead")}</th>
                    <th onClick={() => toggleSort("behind")}>↓{indicator("behind")}</th>
                    <th onClick={() => toggleSort("totalChanges")}>Chg{indicator("totalChanges")}</th>
                    <th title="Stashes">S</th>
                    <th onClick={() => toggleSort("healthScore")} title="Health score">H{indicator("healthScore")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody ref={tbodyRef}>
                  {sorted.map((e, idx) => (
                    <tr key={e.path} className={rowClass(e, idx)}>
                      <td>
                        <span className="sync-repo-name">
                          {e.isPinned && <span className="pin-icon" title="Pinned">📌</span>}
                          {statusDot(e)}
                          <span className="sync-repo-link" onClick={() => onOpenRepo(e.path)}>
                            {e.name}
                          </span>
                          {loadingRepo === e.path && <span className="spinner spinner--inline" />}
                        </span>
                      </td>
                      <td>{e.branch}</td>
                      <td>{e.ahead || ""}</td>
                      <td>{e.behind || ""}</td>
                      <td>{e.totalChanges || ""}</td>
                      <td>{e.stashCount || ""}</td>
                      <td>{healthBadge(e.healthScore)}</td>
                      <td className="sync-actions">
                        {/* Contextual inline actions */}
                        {e.behind > 0 && (
                          <button className="icon-btn" onClick={() => sendAction("pullRepo", e.path)} title="Pull">↓</button>
                        )}
                        {e.ahead > 0 && (
                          <button className="icon-btn" onClick={() => sendAction("pushRepo", e.path)} title="Push">↑</button>
                        )}
                        {e.totalChanges > 0 && (
                          <button className="icon-btn" onClick={() => sendAction("aiCommit", e.path)} title="AI Commit">✦</button>
                        )}
                        {/* Overflow menu */}
                        <span className="overflow-wrapper">
                          <button
                            className="icon-btn"
                            onClick={(ev) => { ev.stopPropagation(); setOpenMenu(openMenu === e.path ? null : e.path); }}
                            title="More actions"
                          >
                            ···
                          </button>
                          {openMenu === e.path && (
                            <div className="overflow-menu" onClick={(ev) => ev.stopPropagation()}>
                              <button onClick={() => sendAction(e.isPinned ? "unpinRepo" : "pinRepo", e.path)}>
                                {e.isPinned ? "⊘ Unpin" : "📌 Pin to top"}
                              </button>
                              {e.totalChanges > 0 && (
                                <button onClick={() => sendAction("discardAll", e.path)}>✕ Discard all</button>
                              )}
                              <button onClick={() => sendAction("switchBranch", e.path)}>⎇ Switch branch</button>
                              <button onClick={() => sendAction("commitHistory", e.path)}>⏱ History</button>
                              <button onClick={() => sendAction("openRemoteUrl", e.path)}>↗ Open in browser</button>
                              <button onClick={() => sendAction("copyRepoInfo", e.path)}>⎘ Copy info</button>
                              <div className="overflow-divider" />
                              <button onClick={() => sendAction("openTerminal", e.path)}>&gt;_ Terminal</button>
                              <button onClick={() => sendAction("openClaude", e.path)}>◇ Claude Code</button>
                            </div>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {search && sorted.length === 0 && (
                <div className="section-empty">No repos match "{search}"</div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
