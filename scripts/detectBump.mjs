/**
 * Pure conventional-commit bump classification, extracted from release.mjs
 * so it can be unit-tested without executing the release script.
 */

/**
 * Classify the semver bump for a list of conventional commit subject lines.
 *
 * - `type!:` / `type(scope)!:` (any type) or `BREAKING CHANGE` → major
 * - `feat:` / `feat(scope):` → minor
 * - anything else → patch (default)
 *
 * @param {string[]} subjects Commit subject lines (non-empty).
 * @returns {"major" | "minor" | "patch"}
 */
export function classifyBump(subjects) {
  let bump = "patch"; // default

  for (const msg of subjects) {
    if (/^\w+(\(.+\))?!:|BREAKING[ -]CHANGE/i.test(msg)) {
      return "major";
    }
    if (/^feat(\(.+\))?:/.test(msg)) {
      bump = "minor";
    }
  }

  return bump;
}
