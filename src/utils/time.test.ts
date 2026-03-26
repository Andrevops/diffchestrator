import * as assert from "node:assert";
import { test } from "node:test";
import { timeAgoShort } from "./time.ts";

test("timeAgoShort", () => {
  const now = Date.now();

  // Create relative dates
  const justNow = new Date(now - 10 * 1000).toISOString(); // 10 seconds ago
  const minutesAgo = new Date(now - 5 * 60 * 1000).toISOString(); // 5 minutes ago
  const hoursAgo = new Date(now - 3 * 60 * 60 * 1000).toISOString(); // 3 hours ago
  const daysAgo = new Date(now - 4 * 24 * 60 * 60 * 1000).toISOString(); // 4 days ago
  const weeksAgo = new Date(now - 2 * 7 * 24 * 60 * 60 * 1000).toISOString(); // 2 weeks ago
  const monthsAgo = new Date(now - 3 * 30 * 24 * 60 * 60 * 1000).toISOString(); // 3 months (90 days) ago

  assert.strictEqual(timeAgoShort(justNow), "just now");
  assert.strictEqual(timeAgoShort(minutesAgo), "5m ago");
  assert.strictEqual(timeAgoShort(hoursAgo), "3h ago");
  assert.strictEqual(timeAgoShort(daysAgo), "4d ago");
  assert.strictEqual(timeAgoShort(weeksAgo), "2w ago");
  assert.strictEqual(timeAgoShort(monthsAgo), "3mo ago");
});
