import { useState, useEffect } from "react";
import vscode from "../vscode";
import SyncOverview from "./SyncOverview";
import BranchMap from "./BranchMap";
import ChangeHeatmap from "./ChangeHeatmap";
import SessionSummary from "./SessionSummary";
import ActivityLog from "./ActivityLog";
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

type Tab = "dashboard" | "activity" | "shortcuts";

export default function DashboardApp() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("dashboard");

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
          >
            Dashboard
          </button>
          <button
            className={`dashboard-tab ${tab === "activity" ? "dashboard-tab--active" : ""}`}
            onClick={() => setTab("activity")}
          >
            Activity
          </button>
          <button
            className={`dashboard-tab ${tab === "shortcuts" ? "dashboard-tab--active" : ""}`}
            onClick={() => setTab("shortcuts")}
          >
            Shortcuts
          </button>
        </div>
        <span className="header-actions">
          {tab === "dashboard" && (
            <>
              <button className="refresh-btn" onClick={() => vscode.postMessage({ type: "switchRoot" })} title="Switch scan root">
                Root
              </button>
              <button className="refresh-btn" onClick={() => vscode.postMessage({ type: "filterByTag" })} title="Filter by tag">
                Tags
              </button>
              <button className="refresh-btn" onClick={() => vscode.postMessage({ type: "claudeReviewAll" })} title="Claude review all changed repos">
                Review
              </button>
              <button className="refresh-btn" onClick={() => vscode.postMessage({ type: "saveSnapshot" })} title="Save workspace snapshot">
                Save
              </button>
              <button className="refresh-btn" onClick={() => vscode.postMessage({ type: "loadSnapshot" })} title="Load workspace snapshot">
                Load
              </button>
              <button className="refresh-btn" onClick={() => vscode.postMessage({ type: "scan" })}>
                Scan
              </button>
              <button className="refresh-btn" onClick={handleRefresh} disabled={loading}>
                {loading ? <><span className="spinner" /> Refreshing...</> : "Refresh"}
              </button>
            </>
          )}
        </span>
      </header>

      {tab === "dashboard" && (
        <div className="dashboard-grid">
          <SyncOverview entries={data.syncOverview} onOpenRepo={handleOpenRepo} />
          <BranchMap entries={data.branchMap} onOpenRepo={handleOpenRepo} />
          <ChangeHeatmap entries={data.changeHeatmap} onOpenRepo={handleOpenRepo} />
          <SessionSummary
            entries={data.sessionSummary}
            sessionStartTime={data.sessionStartTime}
          />
        </div>
      )}

      {tab === "activity" && <ActivityLog entries={data.activityLog} />}

      {tab === "shortcuts" && <ShortcutRef />}
    </div>
  );
}
