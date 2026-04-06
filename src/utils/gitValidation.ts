/**
 * Validate a git ref to prevent flag/command injection
 * @param ref The git ref to validate
 * @returns boolean True if valid, false if invalid or potentially malicious
 */
export function isValidRef(ref: string): boolean {
  // Allow: HEAD, :0, commit hashes, branch names, stash@{N}, tag names
  // Block: anything starting with - (flag injection), shell metacharacters
  // Note: Curly braces are allowed only if the ref is exactly `stash@{N}`.
  return typeof ref === "string" && ref.length > 0 && ref.length < 256
    && !ref.startsWith("-") && !/[;&|`$()]/.test(ref) && !/[{}]/.test(ref.replace(/^stash@\{\d+\}$/, ""));
}
