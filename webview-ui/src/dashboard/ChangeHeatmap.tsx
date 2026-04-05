import type { HeatmapEntry } from "./DashboardApp";

interface Props {
  entries: HeatmapEntry[];
  onOpenRepo: (path: string) => void;
  collapsed: boolean;
  onToggle: () => void;
}

function score(e: HeatmapEntry): number {
  return e.totalChanges * 2 + (e.daysSinceLastCommit ?? 0);
}

type HeatLevel = "hot" | "warm" | "mild" | "stale" | "quiet";

function heatLevel(e: HeatmapEntry): HeatLevel {
  if (e.totalChanges >= 10) return "hot";
  if (e.totalChanges > 0) return "warm";
  if (e.daysSinceLastCommit !== undefined && e.daysSinceLastCommit > 30)
    return "stale";
  if (e.daysSinceLastCommit !== undefined && e.daysSinceLastCommit > 7)
    return "mild";
  return "quiet";
}

export default function ChangeHeatmap({ entries, onOpenRepo, collapsed, onToggle }: Props) {
  const sorted = [...entries].sort((a, b) => score(b) - score(a));

  const activeCount = entries.filter((e) => e.totalChanges > 0).length;
  const staleCount = entries.filter(
    (e) => e.daysSinceLastCommit !== undefined && e.daysSinceLastCommit > 30
  ).length;

  return (
    <div className="dashboard-section">
      <div className="dashboard-section-header" onClick={onToggle} style={{ cursor: "pointer" }}>
        <span>
          {collapsed ? "▸" : "▾"} Change Heatmap{" "}
          <span className="section-badge">
            {activeCount > 0 && `${activeCount} active `}
            {staleCount > 0 && `${staleCount} stale`}
            {activeCount === 0 && staleCount === 0 && "All quiet"}
          </span>
        </span>
      </div>
      {!collapsed && (
        <div className="dashboard-section-body">
          {entries.length === 0 ? (
            <div className="heatmap-grid">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="heatmap-tile heatmap-tile--skeleton">
                  <div className="skeleton-line skeleton-line--short" />
                  <div className="skeleton-line" />
                </div>
              ))}
            </div>
          ) : (
            <div className="heatmap-grid">
              {sorted.map((e) => (
                <div
                  key={e.path}
                  className={`heatmap-tile heatmap-tile--${heatLevel(e)}`}
                  onClick={() => onOpenRepo(e.path)}
                  title={[
                    e.name,
                    `Changes: ${e.totalChanges}`,
                    e.daysSinceLastCommit !== undefined
                      ? `Last commit: ${e.daysSinceLastCommit}d ago`
                      : "No commits",
                  ].join("\n")}
                >
                  <div className="heatmap-tile-name">{e.name}</div>
                  <div className="heatmap-tile-stats">
                    {e.totalChanges > 0 && `${e.totalChanges} changes`}
                    {e.totalChanges > 0 && e.daysSinceLastCommit !== undefined && " · "}
                    {e.daysSinceLastCommit !== undefined && `${e.daysSinceLastCommit}d`}
                    {e.totalChanges === 0 && e.daysSinceLastCommit === undefined && "—"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
