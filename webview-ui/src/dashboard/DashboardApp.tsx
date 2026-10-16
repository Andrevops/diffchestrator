import { useState, useEffect, useCallback } from "react";
import vscode from "../vscode";
import { hasModifier, isEditableTarget } from "../keyboard";
import SyncOverview from "./SyncOverview";
import BranchMap from "./BranchMap";
import ChangeHeatmap from "./ChangeHeatmap";
import SessionSummary from "./SessionSummary";
import ActivityLog from "./ActivityLog";
import StashOverview from "./StashOverview";
import SettingsPanel from "./SettingsPanel";
import ShortcutRef from "./ShortcutRef";

export interface ActivityEntry {
  repoName: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
}

export interface DiffStatSummary {
  files: string[];
  additions: number;
  deletions: number;
}

export interface StashOverviewEntry {
  repoName: string;
  repoPath: string;
  stashes: { index: number; sha: string; message: string; date?: string }[];
}

export interface DashboardPayload {
  syncOverview: SyncOverviewEntry[];
  branchMap: BranchMapEntry[];
  changeHeatmap: HeatmapEntry[];
  sessionSummary: SessionSummaryEntry[];
  activityLog: ActivityEntry[];
  stashOverview: StashOverviewEntry[];
  sessionStartTime: string;
}

export interface SyncOverviewEntry {
  name: string;
  path: string;
  branch: string;
  ahead: number;
  behind: number;
  totalChanges: number;
  stashCount: number;
  isPinned: boolean;
  healthScore: number;
  diffStat?: DiffStatSummary;
}

export interface BranchMapEntry {
  name: string;
  path: string;
  branch: string;
  isMainBranch: boolean;
}

export interface HeatmapEntry {
  name: string;
  path: string;
  totalChanges: number;
  lastCommitDate: string | undefined;
  daysSinceLastCommit: number | undefined;
}

export interface SessionSummaryEntry {
  repoName: string;
  repoPath: string;
  commits: {
    hash: string;
    shortHash: string;
    author: string;
    date: string;
    message: string;
  }[];
}

export type DashboardPhase1Payload = Pick<DashboardPayload, "syncOverview" | "branchMap" | "sessionStartTime">;

/**
 * Merge a Phase-1 payload into the previous dashboard state. Phase-2 arrays
 * are preserved, and each repo keeps its previous diffStat while it still has
 * changes (Phase 1 can't compute diff stats without git calls).
 */
function mergePhase1(prev: DashboardPayload | null, p1: DashboardPhase1Payload): DashboardPayload {
  if (!prev) {
    return {
      ...p1,
      changeHeatmap: [],
      sessionSummary: [],
      activityLog: [],
      stashOverview: [],
    };
  }
  const prevStats = new Map(prev.syncOverview.map((e) => [e.path, e.diffStat]));
  return {
    ...prev,
    ...p1,
    syncOverview: p1.syncOverview.map((e) =>
      e.diffStat || e.totalChanges === 0 ? e : { ...e, diffStat: prevStats.get(e.path) }
    ),
  };
}

type Tab = "dashboard" | "activity" | "settings" | "shortcuts";

export default function DashboardApp() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === "dashboardData") {
        // Phase 1 (no git calls): merge into the previous state so Phase-2
        // sections keep their last data until the new Phase-2 payload lands.
        setData((prev) => mergePhase1(prev, msg.data as DashboardPhase1Payload));
        setLoading(false);
      } else if (msg.type === "dashboardUpdate") {
        setData(msg.data as DashboardPayload);
        setLoading(false);
      } else if (msg.type === "refreshing") {
        setRefreshing(true);
      } else if (msg.type === "refreshDone") {
        setRefreshing(false);
      }
    };
    window.addEventListener("message", handler);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", handler);
  }, []);

  const handleRefresh = () => {
    if (refreshing) return;
    setRefreshing(true); // optimistic; cleared by refreshDone
    vscode.postMessage({ type: "refresh" });
  };

  const handleOpenRepo = (repoPath: string) => {
    vscode.postMessage({ type: "openRepo", repoPath });
  };

  const toggleSection = useCallback((key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Never hijack digits typed into form fields (e.g. Auto-Refresh "15",
      // Max Depth) or chorded with modifiers.
      if (isEditableTarget(e.target) || hasModifier(e) || e.repeat) return;
      if (e.key === "1") setTab("dashboard");
      else if (e.key === "2") setTab("activity");
      else if (e.key === "3") setTab("settings");
      else if (e.key === "4") setTab("shortcuts");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  if (loading && !data) {
    return (
      <div className="dashboard-container">
        <div className="loading-state">
          <span className="spinner" /> Loading dashboard...
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <div className="dashboard-tabs">
          <button
            className={`dashboard-tab ${tab === "dashboard" ? "dashboard-tab--active" : ""}`}
            onClick={() => setTab("dashboard")}
            title="1"
          >
            Dashboard
          </button>
          <button
            className={`dashboard-tab ${tab === "activity" ? "dashboard-tab--active" : ""}`}
            onClick={() => setTab("activity")}
            title="2"
          >
            Activity
          </button>
          <button
            className={`dashboard-tab ${tab === "settings" ? "dashboard-tab--active" : ""}`}
            onClick={() => setTab("settings")}
            title="3"
          >
            Settings
          </button>
          <button
            className={`dashboard-tab ${tab === "shortcuts" ? "dashboard-tab--active" : ""}`}
            onClick={() => setTab("shortcuts")}
            title="4"
          >
            Shortcuts
          </button>
        </div>
        <span className="header-actions">
          {tab === "dashboard" && (
            <>
              <button className="header-icon-btn" onClick={() => vscode.postMessage({ type: "switchRoot" })} title="Switch scan root">
                ⌂
              </button>
              <button className="header-icon-btn" onClick={() => vscode.postMessage({ type: "filterByTag" })} title="Filter by tag">
                #
              </button>
              <span className="header-divider" />
              <button className="header-icon-btn" onClick={() => vscode.postMessage({ type: "claudeReviewAll" })} title="Claude review all changed repos">
                ◇
              </button>
              <span className="header-divider" />
              <button className="header-icon-btn" onClick={() => vscode.postMessage({ type: "saveSnapshot" })} title="Save workspace snapshot">
                ⬇
              </button>
              <button className="header-icon-btn" onClick={() => vscode.postMessage({ type: "loadSnapshot" })} title="Load workspace snapshot">
                ⬆
              </button>
              <span className="header-divider" />
              <button className="header-icon-btn" onClick={() => vscode.postMessage({ type: "scan" })} title="Rescan repos">
                ⟳
              </button>
              <button
                className="header-icon-btn"
                onClick={handleRefresh}
                disabled={refreshing}
                title="Refresh data"
                aria-label="Refresh data"
                aria-busy={refreshing}
              >
                {refreshing ? <span className="spinner" /> : "↻"}
              </button>
            </>
          )}
        </span>
      </header>

      {tab === "dashboard" && (
        <div className="dashboard-grid">
          <SyncOverview
            entries={data.syncOverview}
            onOpenRepo={handleOpenRepo}
            collapsed={!!collapsed.sync}
            onToggle={() => toggleSection("sync")}
          />
          <BranchMap
            entries={data.branchMap}
            onOpenRepo={handleOpenRepo}
            collapsed={!!collapsed.branch}
            onToggle={() => toggleSection("branch")}
          />
          <ChangeHeatmap
            entries={data.changeHeatmap}
            onOpenRepo={handleOpenRepo}
            collapsed={!!collapsed.heat}
            onToggle={() => toggleSection("heat")}
          />
          <SessionSummary
            entries={data.sessionSummary}
            sessionStartTime={data.sessionStartTime}
            collapsed={!!collapsed.session}
            onToggle={() => toggleSection("session")}
          />
          {data.stashOverview.length > 0 && (
            <StashOverview
              entries={data.stashOverview}
              collapsed={!!collapsed.stash}
              onToggle={() => toggleSection("stash")}
            />
          )}
        </div>
      )}

      {tab === "activity" && <ActivityLog entries={data.activityLog} />}

      {tab === "settings" && <SettingsPanel />}

      {tab === "shortcuts" && <ShortcutRef />}
    </div>
  );
}
