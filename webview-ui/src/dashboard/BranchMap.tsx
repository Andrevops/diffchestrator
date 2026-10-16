import vscode from "../vscode";
import { buttonProps } from "../keyboard";
import SectionHeader from "./SectionHeader";
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
      <SectionHeader
        title="Branch Map"
        collapsed={collapsed}
        onToggle={onToggle}
        actions={
          !collapsed && featureRepos.length > 0 ? (
            <button
              className="refresh-btn"
              onClick={() => vscode.postMessage({ type: "branchCleanup" })}
              title="Find and delete merged branches"
            >
              Cleanup
            </button>
          ) : undefined
        }
      >
        <span className="section-badge">
          {mainRepos.length} main · {featureRepos.length} feature · {sortedBranches.length} branches
        </span>
      </SectionHeader>
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
                      {...buttonProps(() => onOpenRepo(r.path), `Open ${r.name} (${r.branch})`)}
                      title={`${r.name} → ${r.branch}`}
                    >
                      {r.name}
                    </span>
                  ))}
                  {mainRepos.length === 0 && (
                    <span className="section-empty section-empty--compact">None</span>
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
                        {...buttonProps(() => onOpenRepo(r.path), `Open ${r.name} (${branch})`)}
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
