import * as assert from "node:assert";
import { test } from "node:test";
import { timeAgo, timeAgoShort } from "./time.ts";

test("timeAgo", () => {
  const now = Date.now();

  const justNow = new Date(now - 10 * 1000).toISOString(); // 10 seconds ago
  const oneMinuteAgo = new Date(now - 1 * 60 * 1000).toISOString(); // 1 minute ago
  const minutesAgo = new Date(now - 5 * 60 * 1000).toISOString(); // 5 minutes ago
  const oneHourAgo = new Date(now - 1 * 60 * 60 * 1000).toISOString(); // 1 hour ago
  const hoursAgo = new Date(now - 3 * 60 * 60 * 1000).toISOString(); // 3 hours ago
  const oneDayAgo = new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(); // 1 day ago
  const daysAgo = new Date(now - 4 * 24 * 60 * 60 * 1000).toISOString(); // 4 days ago
  const oneWeekAgo = new Date(now - 1 * 7 * 24 * 60 * 60 * 1000).toISOString(); // 1 week ago
  const weeksAgo = new Date(now - 2 * 7 * 24 * 60 * 60 * 1000).toISOString(); // 2 weeks ago
  const oneMonthAgo = new Date(now - 1 * 30 * 24 * 60 * 60 * 1000).toISOString(); // 1 month ago
  const monthsAgo = new Date(now - 3 * 30 * 24 * 60 * 60 * 1000).toISOString(); // 3 months ago

  assert.strictEqual(timeAgo(justNow), "just now");
  assert.strictEqual(timeAgo(oneMinuteAgo), "1 minute ago");
  assert.strictEqual(timeAgo(minutesAgo), "5 minutes ago");
  assert.strictEqual(timeAgo(oneHourAgo), "1 hour ago");
  assert.strictEqual(timeAgo(hoursAgo), "3 hours ago");
  assert.strictEqual(timeAgo(oneDayAgo), "1 day ago");
  assert.strictEqual(timeAgo(daysAgo), "4 days ago");
  assert.strictEqual(timeAgo(oneWeekAgo), "1 week ago");
  assert.strictEqual(timeAgo(weeksAgo), "2 weeks ago");
  assert.strictEqual(timeAgo(oneMonthAgo), "1 month ago");
  assert.strictEqual(timeAgo(monthsAgo), "3 months ago");
});

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
