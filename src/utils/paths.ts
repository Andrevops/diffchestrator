import * as path from "path";

/**
 * True if `child` is `parent` itself or lives under it. Compares with a
 * trailing separator so /x/foo doesn't count as inside /x/fo.
 */
export function isWithin(child: string, parent: string, sep: string = path.sep): boolean {
  if (!parent) return false;
  const base = parent.endsWith(sep) ? parent.slice(0, -1) : parent;
  return child === base || child.startsWith(base + sep);
}

/** Structural subset of vscode.Uri (keeps this module vscode-free). */
export interface UriLike {
  scheme: string;
  fsPath: string;
  query: string;
}

/**
 * Does an editor URI belong to a repo? `file:` URIs by path containment,
 * `git-show:` URIs by the `repoPath` in their JSON query.
 */
export function uriBelongsToRepo(uri: UriLike, repoPath: string, sep: string = path.sep): boolean {
  if (uri.scheme === "file") return isWithin(uri.fsPath, repoPath, sep);
  if (uri.scheme === "git-show") {
    try {
      return JSON.parse(uri.query)?.repoPath === repoPath;
    } catch {
      return false;
    }
  }
  return false;
}

/** The configured root that contains `p` (deepest root wins), if any. */
export function findOwningRoot(p: string, roots: readonly string[], sep: string = path.sep): string | undefined {
  let best: string | undefined;
  for (const root of roots) {
    if (isWithin(p, root, sep) && (best === undefined || root.length > best.length)) {
      best = root;
    }
  }
  return best;
}
