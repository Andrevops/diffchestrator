/**
 * Relative time formatting utilities.
 */

function compute(dateStr: string) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  return { months, weeks, days, hours, minutes };
}

/** Long format: "3 months ago", "2 days ago" */
export function timeAgo(dateStr: string): string {
  const { months, weeks, days, hours, minutes } = compute(dateStr);
  if (months > 0) return `${months} month${months > 1 ? "s" : ""} ago`;
  if (weeks > 0) return `${weeks} week${weeks > 1 ? "s" : ""} ago`;
  if (days > 0) return `${days} day${days > 1 ? "s" : ""} ago`;
  if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  if (minutes > 0) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
  return "just now";
}

/** Short format: "3mo ago", "2d ago" */
export function timeAgoShort(dateStr: string): string {
  const { months, weeks, days, hours, minutes } = compute(dateStr);
  if (months > 0) return `${months}mo ago`;
  if (weeks > 0) return `${weeks}w ago`;
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}
