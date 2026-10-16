import { useMemo } from "react";
import type { HeatmapEntry } from "./DashboardApp";
import { buttonProps } from "../keyboard";
import SectionHeader from "./SectionHeader";

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
  const sorted = useMemo(() => [...entries].sort((a, b) => score(b) - score(a)), [entries]);

  const activeCount = useMemo(() => entries.filter((e) => e.totalChanges > 0).length, [entries]);
  const staleCount = useMemo(
    () => entries.filter((e) => e.daysSinceLastCommit !== undefined && e.daysSinceLastCommit > 30).length,
    [entries]
  );

  return (
    <div className="dashboard-section">
      <SectionHeader title="Change Heatmap" collapsed={collapsed} onToggle={onToggle}>
        <span className="section-badge">
          {activeCount > 0 && `${activeCount} active `}
          {staleCount > 0 && `${staleCount} stale`}
          {activeCount === 0 && staleCount === 0 && "All quiet"}
        </span>
      </SectionHeader>
      {!collapsed && (
        <div className="dashboard-section-body">
          {entries.length === 0 ? (
            <div className="heatmap-grid" aria-busy="true" aria-label="Loading heatmap">
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
                  {...buttonProps(
                    () => onOpenRepo(e.path),
                    `Open ${e.name}: ${e.totalChanges} changes${
                      e.daysSinceLastCommit !== undefined ? `, last commit ${e.daysSinceLastCommit} days ago` : ""
                    }`
                  )}
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
