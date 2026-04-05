import { useState, useEffect } from "react";
import vscode from "../vscode";
import SyncOverview from "./SyncOverview";
import BranchMap from "./BranchMap";
import ChangeHeatmap from "./ChangeHeatmap";
import SessionSummary from "./SessionSummary";

export interface DashboardPayload {
  syncOverview: SyncOverviewEntry[];
  branchMap: BranchMapEntry[];
  changeHeatmap: HeatmapEntry[];
  sessionSummary: SessionSummaryEntry[];
  sessionStartTime: string;
}

export interface SyncOverviewEntry {
  name: string;
  path: string;
  branch: string;
  ahead: number;
  behind: number;
  totalChanges: number;
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

export default function DashboardApp() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);

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
        <h2>Diffchestrator Dashboard</h2>
        <button className="refresh-btn" onClick={handleRefresh} disabled={loading}>
          {loading ? <><span className="spinner" /> Refreshing...</> : "Refresh"}
        </button>
      </header>

      <div className="dashboard-grid">
        <SyncOverview entries={data.syncOverview} onOpenRepo={handleOpenRepo} />
        <BranchMap entries={data.branchMap} onOpenRepo={handleOpenRepo} />
        <ChangeHeatmap entries={data.changeHeatmap} onOpenRepo={handleOpenRepo} />
        <SessionSummary
          entries={data.sessionSummary}
          sessionStartTime={data.sessionStartTime}
        />
      </div>
    </div>
  );
}
