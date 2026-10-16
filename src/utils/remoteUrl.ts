/**
 * Remote URL handling for "Open Remote URL" / "Copy Repo Info".
 * Pure (no `vscode` import) so it can be unit-tested under Node.
 *
 * A git remote is repo-controlled data: it can embed credentials
 * (https://user:token@host/...) or use schemes that must never reach
 * `openExternal` (file:, javascript:, ext::, custom app protocols).
 */

/** scp-like syntax: [user@]host:path — but not a Windows drive (C:\x) or a URL */
const SCP_LIKE = /^(?:([^@/\s]+)@)?([^:/\\\s]{2,}):(?!\/\/)([^\s]+)$/;

const SSH_SCHEMES = new Set(["ssh:", "git+ssh:", "ssh+git:", "git:"]);

function cleanPath(p: string): string {
  return p
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");
}

/**
 * Convert a git remote to an https/http URL safe to open in a browser.
 * - http(s): kept, userinfo stripped
 * - ssh://, git://, git+ssh://, scp-like (git@host:org/repo): → https://host/path
 *   (ssh ports are dropped — they aren't the web port)
 * - anything else (file:, local paths, unknown schemes): undefined
 * Trailing `.git`, query, and fragment are removed.
 */
export function toBrowsableUrl(remote: string | undefined): string | undefined {
  const raw = remote?.trim();
  if (!raw) return undefined;

  const scp = SCP_LIKE.exec(raw);
  if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    const host = scp[2];
    // "javascript:alert(1)" parses as scp-like host "javascript" — the result
    // would be a harmless https URL, but reject URI-scheme lookalikes outright.
    if (/^(?:javascript|vbscript|data|file|blob|about|ext|fd)$/i.test(host)) return undefined;
    const repoPath = cleanPath(scp[3]);
    if (!repoPath) return undefined;
    return safeHttpsUrl(host, repoPath);
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  const isHttp = url.protocol === "https:" || url.protocol === "http:";
  if (!isHttp && !SSH_SCHEMES.has(url.protocol)) return undefined;
  let repoPath: string;
  try {
    repoPath = cleanPath(decodeURIComponent(url.pathname));
  } catch {
    return undefined; // malformed percent-encoding
  }
  if (!url.hostname || !repoPath) return undefined;

  if (url.protocol === "https:" || url.protocol === "http:") {
    const port = url.port ? `:${url.port}` : "";
    return `${url.protocol}//${url.hostname}${port}/${encodePath(repoPath)}`;
  }
  if (SSH_SCHEMES.has(url.protocol)) {
    return safeHttpsUrl(url.hostname, repoPath);
  }
  return undefined;
}

function safeHttpsUrl(host: string, repoPath: string): string | undefined {
  try {
    const u = new URL(`https://${host}/${encodePath(repoPath)}`);
    return u.hostname ? u.toString().replace(/\/$/, "") : undefined;
  } catch {
    return undefined;
  }
}

function encodePath(p: string): string {
  return p.split("/").map((seg) => encodeURIComponent(seg)).join("/");
}

/**
 * Remote URL with credentials removed, for display/clipboard. For http(s)
 * the whole userinfo goes (the "username" is often a token). For ssh-style
 * remotes the username is kept (git@ is needed to clone) but any password
 * is dropped. Other forms are returned unchanged.
 */
export function stripCredentials(remote: string): string {
  const raw = remote.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw; // scp-like / local path
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Unparseable — best-effort regex strip of user:pass@
    return raw.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]*@/i, "$1");
  }
  if (url.protocol === "https:" || url.protocol === "http:") {
    url.username = "";
  }
  url.password = "";
  return url.toString();
}
