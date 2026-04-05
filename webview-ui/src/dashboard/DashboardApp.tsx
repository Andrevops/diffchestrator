import { useState, useEffect, useCallback } from "react";
import vscode from "../vscode";
import SyncOverview from "./SyncOverview";
import BranchMap from "./BranchMap";
import ChangeHeatmap from "./ChangeHeatmap";
import SessionSummary from "./SessionSummary";
import ActivityLog from "./ActivityLog";
import SettingsPanel from "./SettingsPanel";
import ShortcutRef from "./ShortcutRef";

export interface ActivityEntry {
  repoName: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
}

export interface DashboardPayload {
  syncOverview: SyncOverviewEntry[];
  branchMap: BranchMapEntry[];
  changeHeatmap: HeatmapEntry[];
  sessionSummary: SessionSummaryEntry[];
  activityLog: ActivityEntry[];
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

type Tab = "dashboard" | "activity" | "settings" | "shortcuts";

export default function DashboardApp() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === "dashboardData" || msg.type === "dashboardUpdate") {
        setData(msg.data);
        setLoading(false);
      } else if (msg.type === "refreshing") {
        setLoading(true);
      }
    };
    window.addEventListener("message", handler);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", handler);
  }, []);

  const handleRefresh = () => {
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
                disabled={loading}
                title="Refresh data"
              >
                {loading ? <span className="spinner" /> : "↻"}
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
        </div>
      )}

      {tab === "activity" && <ActivityLog entries={data.activityLog} />}

      {tab === "settings" && <SettingsPanel />}

      {tab === "shortcuts" && <ShortcutRef />}
    </div>
  );
}
