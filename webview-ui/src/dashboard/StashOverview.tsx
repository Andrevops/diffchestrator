import { useEffect, useState } from "react";
import vscode from "../vscode";
import type { StashOverviewEntry } from "./DashboardApp";
import { timeAgo } from "./timeAgo";
import SectionHeader from "./SectionHeader";

interface Props {
  entries: StashOverviewEntry[];
  collapsed: boolean;
  onToggle: () => void;
}

type StashOp = "stashApply" | "stashPop" | "stashDrop";

export default function StashOverview({ entries, collapsed, onToggle }: Props) {
  const totalStashes = entries.reduce((s, e) => s + e.stashes.length, 0);
  // Repos with a stash request in flight. Every stash row of the repo is
  // disabled until the extension answers: indexes shift after a drop/pop, so
  // a second click on any row could otherwise target a different stash.
  const [busy, setBusy] = useState<Set<string>>(new Set());

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.type === "stashOpDone" && typeof msg.repoPath === "string") {
        setBusy((prev) => {
          if (!prev.has(msg.repoPath)) return prev;
          const next = new Set(prev);
          next.delete(msg.repoPath);
          return next;
        });
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const send = (type: StashOp, repoPath: string, s: StashOverviewEntry["stashes"][number]) => {
    if (busy.has(repoPath)) return;
    setBusy((prev) => new Set(prev).add(repoPath));
    vscode.postMessage({ type, repoPath, index: s.index, sha: s.sha });
  };

  return (
    <div className="dashboard-section">
      <SectionHeader collapsed={collapsed} onToggle={onToggle} title="Stashes">
        <span className="section-badge">
          {totalStashes} across {entries.length} repo{entries.length !== 1 ? "s" : ""}
        </span>
      </SectionHeader>
      {!collapsed && (
        <div className="dashboard-section-body">
          {entries.map((repo) => {
            const isBusy = busy.has(repo.repoPath);
            return (
              <div key={repo.repoPath} className="stash-repo" aria-busy={isBusy}>
                <div className="stash-repo-header">{repo.repoName}</div>
                {repo.stashes.map((s) => (
                  <div key={s.sha || s.index} className="stash-row">
                    <span className="stash-message">
                      {s.message}
                      {s.date && <span className="stash-date" title={s.date}> · {timeAgo(s.date)}</span>}
                    </span>
                    <span className="stash-actions">
                      <button
                        className="icon-btn"
                        disabled={isBusy}
                        onClick={() => send("stashApply", repo.repoPath, s)}
                        title="Apply (keep stash)"
                        aria-label={`Apply stash ${s.index}: ${s.message}`}
                      >
                        Apply
                      </button>
                      {s.index === 0 && (
                        <button
                          className="icon-btn"
                          disabled={isBusy}
                          onClick={() => send("stashPop", repo.repoPath, s)}
                          title="Pop (apply and remove)"
                          aria-label={`Pop stash ${s.index}: ${s.message}`}
                        >
                          Pop
                        </button>
                      )}
                      <button
                        className="icon-btn icon-btn--danger"
                        disabled={isBusy}
                        onClick={() => send("stashDrop", repo.repoPath, s)}
                        title="Drop (delete stash)"
                        aria-label={`Drop stash ${s.index}: ${s.message}`}
                      >
                        Drop
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
