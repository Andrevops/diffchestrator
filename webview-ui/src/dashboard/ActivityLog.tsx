import type { ActivityEntry } from "./DashboardApp";

interface Props {
  entries: ActivityEntry[];
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function groupByDate(entries: ActivityEntry[]): Map<string, ActivityEntry[]> {
  const groups = new Map<string, ActivityEntry[]>();
  for (const e of entries) {
    const day = new Date(e.date).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const group = groups.get(day) || [];
    group.push(e);
    groups.set(day, group);
  }
  return groups;
}

export default function ActivityLog({ entries }: Props) {
  if (entries.length === 0) {
    return (
      <div className="activity-panel">
        <div className="section-empty">No recent activity across repos</div>
      </div>
    );
  }

  const grouped = groupByDate(entries);

  return (
    <div className="activity-panel">
      {[...grouped.entries()].map(([day, commits]) => (
        <div key={day} className="activity-day">
          <div className="activity-day-header">{day}</div>
          {commits.map((c, i) => (
            <div key={`${c.shortHash}-${i}`} className="activity-row">
              <span className="commit-hash">{c.shortHash}</span>
              <span className="activity-repo">{c.repoName}</span>
              <span className="commit-message">{c.message}</span>
              <span className="activity-author">{c.author}</span>
              <span className="commit-time">{timeAgo(c.date)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
