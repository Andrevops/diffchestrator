import type { HeatmapEntry } from "./DashboardApp";

interface Props {
  entries: HeatmapEntry[];
  onOpenRepo: (path: string) => void;
}

function score(e: HeatmapEntry): number {
  return e.totalChanges * 2 + (e.daysSinceLastCommit ?? 0);
}

function intensity(e: HeatmapEntry, maxScore: number): number {
  if (maxScore === 0) return 0.1;
  return 0.1 + (score(e) / maxScore) * 0.6;
}

function tileColor(e: HeatmapEntry): string {
  if (e.totalChanges > 0) {
    // warm — active changes
    return "var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d)";
  }
  if (e.daysSinceLastCommit !== undefined && e.daysSinceLastCommit > 30) {
    // cool — stale
    return "var(--vscode-descriptionForeground, #888)";
  }
  return "var(--vscode-editor-foreground, #ccc)";
}

export default function ChangeHeatmap({ entries, onOpenRepo }: Props) {
  const sorted = [...entries].sort((a, b) => score(b) - score(a));
  const maxScore = sorted.length > 0 ? score(sorted[0]) : 1;

  const activeCount = entries.filter((e) => e.totalChanges > 0).length;
  const staleCount = entries.filter(
    (e) => e.daysSinceLastCommit !== undefined && e.daysSinceLastCommit > 30
  ).length;

  return (
    <div className="dashboard-section">
      <div className="dashboard-section-header">
        Change Heatmap
        <span className="section-badge">
          {activeCount > 0 && `${activeCount} active `}
          {staleCount > 0 && `${staleCount} stale`}
          {activeCount === 0 && staleCount === 0 && "All quiet"}
        </span>
      </div>
      <div className="dashboard-section-body">
        {entries.length === 0 ? (
          <div className="section-empty">Loading heatmap data...</div>
        ) : (
          <div className="heatmap-grid">
            {sorted.map((e) => (
              <div
                key={e.path}
                className="heatmap-tile"
                onClick={() => onOpenRepo(e.path)}
                style={{
                  backgroundColor: tileColor(e),
                  opacity: intensity(e, maxScore),
                }}
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
                  {e.totalChanges > 0 &&
                    e.daysSinceLastCommit !== undefined &&
                    " · "}
                  {e.daysSinceLastCommit !== undefined &&
                    `${e.daysSinceLastCommit}d`}
                  {e.totalChanges === 0 &&
                    e.daysSinceLastCommit === undefined &&
                    "—"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
