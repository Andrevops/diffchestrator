/**
 * Pure release helpers (no git, no fs) extracted from release.mjs so they can
 * be unit-tested without executing the release script.
 */

/** Field separator between subject and body inside one commit record. */
export const FIELD_SEP = "\x1f";
/** Record separator between commits. */
export const RECORD_SEP = "\x1e";

/**
 * `git log` pretty format that pairs with {@link parseGitLog}. Subjects and
 * bodies can contain newlines, so ASCII unit/record separators delimit them.
 */
export const GIT_LOG_FORMAT = "%s%x1f%b%x1e";

/**
 * @typedef {{ subject: string, body: string }} Commit
 */

/**
 * Parse `git log --format=GIT_LOG_FORMAT` output into commits.
 * @param {string} raw
 * @returns {Commit[]}
 */
export function parseGitLog(raw) {
  return raw
    .split(RECORD_SEP)
    .map((rec) => rec.replace(/^\s+/, ""))
    .filter((rec) => rec.length > 0)
    .map((rec) => {
      const idx = rec.indexOf(FIELD_SEP);
      if (idx === -1) return { subject: rec.trim(), body: "" };
      return { subject: rec.slice(0, idx).trim(), body: rec.slice(idx + 1).trim() };
    })
    .filter((c) => c.subject.length > 0);
}

/** @param {string | Commit} c @returns {Commit} */
function toCommit(c) {
  return typeof c === "string" ? { subject: c, body: "" } : c;
}

const BANG_SUBJECT = /^\w+(\([^)]*\))?!:/;
const BREAKING_SUBJECT = /BREAKING[ -]CHANGE/i;
// Conventional Commits footer: token at line start, followed by ": "
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:\s/m;
const FEAT_SUBJECT = /^feat(\([^)]*\))?:/;

/**
 * Whether a single commit is a breaking change.
 * @param {string | Commit} commit
 */
export function isBreaking(commit) {
  const { subject, body } = toCommit(commit);
  return BANG_SUBJECT.test(subject) || BREAKING_SUBJECT.test(subject) || BREAKING_FOOTER.test(body);
}

/**
 * Classify the semver bump for a list of conventional commits.
 *
 * - `type!:` / `type(scope)!:` (any type), `BREAKING CHANGE` in the subject,
 *   or a `BREAKING CHANGE:` / `BREAKING-CHANGE:` footer in the body → major
 * - `feat:` / `feat(scope):` → minor
 * - anything else → patch (default)
 *
 * @param {(string | Commit)[]} commits Subjects or parsed commits (non-empty).
 * @returns {"major" | "minor" | "patch"}
 */
export function classifyBump(commits) {
  let bump = "patch";
  for (const c of commits) {
    if (isBreaking(c)) return "major";
    if (FEAT_SUBJECT.test(toCommit(c).subject)) bump = "minor";
  }
  return bump;
}

/**
 * Apply a semver bump to a plain `X.Y.Z` version.
 * @param {string} version
 * @param {"major" | "minor" | "patch"} bump
 */
export function bumpVersion(version, bump) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) throw new Error(`Unsupported version format: ${version}`);
  const [major, minor, patch] = m.slice(1).map(Number);
  switch (bump) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Invalid bump type: ${bump}`);
  }
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const stripType = (s) => s.replace(/^\w+(\([^)]*\))?!?:\s*/, "");

/**
 * Group commits into changelog sections. Release and CI commits are skipped.
 * @param {(string | Commit)[]} commits
 * @returns {{ title: string, items: string[] }[]} Non-empty sections, in order.
 */
export function groupChangelog(commits) {
  const groups = { Features: [], "Bug Fixes": [], Performance: [], Other: [] };
  for (const c of commits) {
    const commit = toCommit(c);
    const msg = commit.subject;
    if (/^chore\(release\)/.test(msg)) continue;
    if (/^ci(\(|!|:)/.test(msg)) continue;
    let item = cap(stripType(msg));
    if (isBreaking(commit)) item = `**BREAKING:** ${item}`;
    if (/^feat(\(|!|:)/.test(msg)) groups.Features.push(item);
    else if (/^fix(\(|!|:)/.test(msg)) groups["Bug Fixes"].push(item);
    else if (/^perf(\(|!|:)/.test(msg)) groups.Performance.push(item);
    else groups.Other.push(item);
  }
  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([title, items]) => ({ title, items }));
}

/**
 * Render a CHANGELOG entry, or null when nothing is worth listing.
 * @param {string} version
 * @param {(string | Commit)[]} commits
 */
export function renderChangelogEntry(version, commits) {
  const sections = groupChangelog(commits);
  if (sections.length === 0) return null;
  const body = sections.map((s) => `### ${s.title}\n` + s.items.map((i) => `- ${i}`).join("\n")).join("\n\n");
  return `## ${version}\n\n${body}`;
}

export const CHANGELOG_HEADER =
  "# Changelog\n\nAll notable changes to Diffchestrator are documented here. Generated from conventional commits.\n";

/**
 * Insert an entry below the CHANGELOG header (header is normalised).
 * @param {string} existing
 * @param {string} entry
 */
export function prependChangelog(existing, entry) {
  const body = existing.replace(/^# Changelog\n+.*Generated from conventional commits\.\n*/m, "");
  return `${CHANGELOG_HEADER}\n${entry}\n\n${body}`;
}

/**
 * Extract the body of one version's section from CHANGELOG.md (without the
 * `## X.Y.Z` heading). Returns null when the version is absent.
 * @param {string} changelog
 * @param {string} version e.g. "0.84.3" (a leading "v" is ignored)
 */
export function extractReleaseNotes(changelog, version) {
  const v = version.replace(/^v/, "").replace(/\./g, "\\.");
  const heading = new RegExp(`^## \\[?v?${v}\\]?(?:\\s.*)?$`, "m");
  const m = heading.exec(changelog);
  if (!m) return null;
  const rest = changelog.slice(m.index + m[0].length);
  const next = rest.search(/^## /m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}
