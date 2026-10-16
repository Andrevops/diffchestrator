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
