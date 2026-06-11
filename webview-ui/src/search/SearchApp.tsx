import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import vscode from "../vscode";

interface Match {
  file: string;
  line: number;
  column: number;
  text: string;
}

interface SearchParams {
  query: string;
  caseSensitive: boolean;
  regex: boolean;
  wholeWord: boolean;
}

interface FileGroup {
  file: string;
  matches: Match[];
}

const DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Regex used purely for client-side highlighting of matched substrings. */
function buildHighlightRegex(p: SearchParams): RegExp | null {
  let src = p.regex ? p.query : escapeRegExp(p.query);
  if (p.wholeWord) src = `\\b(?:${src})\\b`;
  try {
    return new RegExp(src, p.caseSensitive ? "g" : "gi");
  } catch {
    return null;
  }
}

function highlightLine(text: string, re: RegExp | null): ReactNode {
  if (!re) return text;
  const parts: ReactNode[] = [];
  let last = 0;
  let i = 0;
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[0].length === 0) {
      re.lastIndex++; // zero-length match — avoid infinite loop
      continue;
    }
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(
      <span className="hl" key={i++}>
        {m[0]}
      </span>
    );
    last = m.index + m[0].length;
    if (parts.length > 200) break; // pathological line — stop highlighting
  }
  if (last === 0) return text;
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(0, i) : "";
}

export default function SearchApp() {
  const [repoName, setRepoName] = useState<string>("");
  const [repoPath, setRepoPath] = useState<string>("");
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("");

  const [matches, setMatches] = useState<Match[]>([]);
  const [appliedParams, setAppliedParams] = useState<SearchParams | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const requestIdRef = useRef(0);
  const pendingParams = useRef(new Map<number, SearchParams>());
  const inputRef = useRef<HTMLInputElement>(null);

  const sendSearch = useCallback(
    (q: string, cs: boolean, ww: boolean, rx: boolean, inc: string, exc: string) => {
      const requestId = ++requestIdRef.current;
      pendingParams.current.set(requestId, {
        query: q,
        caseSensitive: cs,
        wholeWord: ww,
        regex: rx,
      });
      setSearching(true);
      vscode.postMessage({
        type: "search",
        requestId,
        query: q,
        caseSensitive: cs,
        wholeWord: ww,
        regex: rx,
        include: inc,
        exclude: exc,
      });
    },
    []
  );

  // Debounced search-as-you-type
  useEffect(() => {
    if (query.length < MIN_QUERY_LENGTH) {
      requestIdRef.current++; // invalidate in-flight requests
      pendingParams.current.clear();
      setMatches([]);
      setAppliedParams(null);
      setError(null);
      setSearching(false);
      setTruncated(false);
      return;
    }
    const t = setTimeout(
      () => sendSearch(query, caseSensitive, wholeWord, regex, include, exclude),
      DEBOUNCE_MS
    );
    return () => clearTimeout(t);
  }, [query, caseSensitive, wholeWord, regex, include, exclude, sendSearch]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const msg = event.data;
      switch (msg.type) {
        case "repo": {
          setRepoName(msg.repoName);
          setRepoPath(msg.repoPath);
          inputRef.current?.focus();
          break;
        }
        case "results": {
          if (msg.requestId !== requestIdRef.current) {
            pendingParams.current.delete(msg.requestId);
            break;
          }
          const params = pendingParams.current.get(msg.requestId) ?? null;
          pendingParams.current.clear();
          setMatches(msg.matches);
          setAppliedParams(params);
          setTruncated(msg.truncated);
          setDurationMs(msg.durationMs);
          setError(null);
          setSearching(false);
          setCollapsed(new Set());
          break;
        }
        case "error": {
          if (msg.requestId !== requestIdRef.current) {
            pendingParams.current.delete(msg.requestId);
            break;
          }
          pendingParams.current.clear();
          setMatches([]);
          setAppliedParams(null);
          setError(msg.message);
          setSearching(false);
          break;
        }
      }
    };
    window.addEventListener("message", onMessage);
    vscode.postMessage({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Repo retarget: when the panel is pointed at a different repo, drop stale
  // results and rerun the current query against the new repo.
  const repoRef = useRef("");
  useEffect(() => {
    if (!repoPath || repoRef.current === repoPath) return;
    const isRetarget = repoRef.current !== "";
    repoRef.current = repoPath;
    if (!isRetarget) return;
    setMatches([]);
    setAppliedParams(null);
    setError(null);
    if (query.length >= MIN_QUERY_LENGTH) {
      sendSearch(query, caseSensitive, wholeWord, regex, include, exclude);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath]);

  const groups = useMemo<FileGroup[]>(() => {
    const byFile = new Map<string, Match[]>();
    for (const m of matches) {
      const list = byFile.get(m.file);
      if (list) list.push(m);
      else byFile.set(m.file, [m]);
    }
    return [...byFile.entries()].map(([file, ms]) => ({ file, matches: ms }));
  }, [matches]);

  const highlightRe = useMemo(
    () => (appliedParams ? buildHighlightRegex(appliedParams) : null),
    [appliedParams]
  );

  const toggleFile = (file: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  };

  const openMatch = (m: Match) => {
    vscode.postMessage({ type: "openMatch", file: m.file, line: m.line, column: m.column });
  };

  const allCollapsed = groups.length > 0 && groups.every((g) => collapsed.has(g.file));

  const status = (() => {
    if (error) return null;
    if (searching) return "Searching…";
    if (!appliedParams) return null;
    if (matches.length === 0) return "No results found";
    const files = groups.length;
    return `${truncated ? "First " : ""}${matches.length} result${matches.length !== 1 ? "s" : ""} in ${files} file${files !== 1 ? "s" : ""} — ${durationMs} ms`;
  })();

  return (
    <div className="search-root">
      <div className="search-header">
        <span className="search-title">Search</span>
        <span className="repo-badge" title="Searches tracked and untracked files via git grep">
          {repoName || "…"}
        </span>
        {groups.length > 1 && (
          <button
            className="link-btn"
            onClick={() =>
              setCollapsed(allCollapsed ? new Set() : new Set(groups.map((g) => g.file)))
            }
          >
            {allCollapsed ? "Expand all" : "Collapse all"}
          </button>
        )}
      </div>

      <div className="query-row">
        <input
          ref={inputRef}
          className="query-input"
          type="text"
          autoFocus
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && query.length >= MIN_QUERY_LENGTH) {
              sendSearch(query, caseSensitive, wholeWord, regex, include, exclude);
            }
          }}
        />
        <div className="toggles">
          <button
            className={`toggle ${caseSensitive ? "active" : ""}`}
            title="Match Case"
            aria-pressed={caseSensitive}
            onClick={() => setCaseSensitive((v) => !v)}
          >
            Aa
          </button>
          <button
            className={`toggle ${wholeWord ? "active" : ""}`}
            title="Match Whole Word"
            aria-pressed={wholeWord}
            onClick={() => setWholeWord((v) => !v)}
          >
            <span className="ww">ab</span>
          </button>
          <button
            className={`toggle ${regex ? "active" : ""}`}
            title="Use Regular Expression (POSIX extended)"
            aria-pressed={regex}
            onClick={() => setRegex((v) => !v)}
          >
            .*
          </button>
        </div>
      </div>

      <div className="glob-row">
        <input
          className="glob-input"
          type="text"
          placeholder="files to include (e.g. src, *.ts)"
          value={include}
          onChange={(e) => setInclude(e.target.value)}
        />
        <input
          className="glob-input"
          type="text"
          placeholder="files to exclude (e.g. *.test.ts, dist)"
          value={exclude}
          onChange={(e) => setExclude(e.target.value)}
        />
      </div>

      {error && <div className="error-banner">{error}</div>}
      {status && <div className="status-line">{status}</div>}
      {truncated && !searching && (
        <div className="truncated-note">
          Result limit reached — narrow the query or use include/exclude filters.
        </div>
      )}

      <div className="results">
        {groups.map((g) => {
          const isCollapsed = collapsed.has(g.file);
          return (
            <div className="file-group" key={g.file}>
              <div
                className="file-header"
                onClick={() => toggleFile(g.file)}
                title={g.file}
              >
                <span className="chevron">{isCollapsed ? "▸" : "▾"}</span>
                <span className="file-name">{basename(g.file)}</span>
                {dirname(g.file) && <span className="file-dir">{dirname(g.file)}</span>}
                <span className="count">{g.matches.length}</span>
              </div>
              {!isCollapsed &&
                g.matches.map((m, idx) => (
                  <div
                    className="match-line"
                    key={`${m.line}:${m.column}:${idx}`}
                    onClick={() => openMatch(m)}
                  >
                    <span className="line-no">{m.line}</span>
                    <span className="line-text">{highlightLine(m.text, highlightRe)}</span>
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
