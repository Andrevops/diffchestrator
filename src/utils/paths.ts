import * as path from "path";

export function basename(p: string): string {
  return path.basename(p);
}

export function dirname(p: string): string {
  return path.dirname(p);
}
