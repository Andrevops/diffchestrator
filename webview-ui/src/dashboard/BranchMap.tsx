import vscode from "../vscode";
import type { BranchMapEntry } from "./DashboardApp";

interface Props {
  entries: BranchMapEntry[];
  onOpenRepo: (path: string) => void;
  collapsed: boolean;
  onToggle: () => void;
}

export default function BranchMap({ entries, onOpenRepo, collapsed, onToggle }: Props) {
  const mainRepos = entries.filter((e) => e.isMainBranch);
  const featureRepos = entries.filter((e) => !e.isMainBranch);

  const branchGroups = new Map<string, BranchMapEntry[]>();
  for (const r of featureRepos) {
    const group = branchGroups.get(r.branch) || [];
    group.push(r);
    branchGroups.set(r.branch, group);
  }
  const sortedBranches = [...branchGroups.entries()].sort(
    (a, b) => b[1].length - a[1].length
  );

  return (
    <div className="dashboard-section">
      <div className="dashboard-section-header" onClick={onToggle} style={{ cursor: "pointer" }}>
        <span>
          {collapsed ? "▸" : "▾"} Branch Map{" "}
          <span className="section-badge">
            {mainRepos.length} main · {featureRepos.length} feature
          </span>
        </span>
        {!collapsed && featureRepos.length > 0 && (
          <span className="header-actions" onClick={(e) => e.stopPropagation()}>
            <button
              className="refresh-btn"
              onClick={() => vscode.postMessage({ type: "branchCleanup" })}
              title="Find and delete merged branches"
            >
              Cleanup
            </button>
          </span>
        )}
      </div>
      {!collapsed && (
        <div className="dashboard-section-body">
          {entries.length === 0 ? (
            <div className="section-empty">No repos scanned</div>
          ) : (
            <>
              <div className="branch-group">
                <div className="branch-group-header">
                  Main Branches
                  <span className="section-badge">{mainRepos.length}</span>
                </div>
                <div className="branch-pills">
                  {mainRepos.map((r) => (
                    <span
                      key={r.path}
                      className="branch-pill branch-pill--main"
                      onClick={() => onOpenRepo(r.path)}
                      title={`${r.name} → ${r.branch}`}
                    >
                      {r.name}
                    </span>
                  ))}
                  {mainRepos.length === 0 && (
                    <span className="section-empty" style={{ padding: 4 }}>None</span>
                  )}
                </div>
              </div>
              {sortedBranches.map(([branch, repos]) => (
                <div className="branch-group" key={branch}>
                  <div className="branch-label">
                    {branch} <span className="section-badge">{repos.length}</span>
                  </div>
                  <div className="branch-pills">
                    {repos.map((r) => (
                      <span
                        key={r.path}
                        className="branch-pill branch-pill--feature"
                        onClick={() => onOpenRepo(r.path)}
                        title={r.name}
                      >
                        {r.name}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
