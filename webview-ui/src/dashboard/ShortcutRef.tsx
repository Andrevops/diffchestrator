const shortcuts = [
  ["Alt+D, S", "Scan repos"],
  ["Alt+D, R", "Switch repo"],
  ["Alt+D, Tab", "Cycle active repos"],
  ["Alt+D, V", "Dashboard"],
  ["Alt+D, D", "Toggle changed-only"],
  ["Alt+D, Shift+S", "Switch scan root"],
  ["", ""],
  ["Alt+D, C", "AI Commit (Claude)"],
  ["Alt+D, M", "Commit with message"],
  ["Alt+D, L", "Open Claude Code"],
  ["Alt+D, Y", "Yolo (Claude Sandbox)"],
  ["Alt+D, P", "Push"],
  ["Alt+D, U", "Pull"],
  ["Alt+D, Z", "Undo last commit"],
  ["", ""],
  ["Alt+D, N", "Next changed file"],
  ["Alt+D, Shift+N", "Previous changed file"],
  ["Alt+D, F", "Browse files"],
  ["Alt+D, /", "Search in repo"],
  ["Alt+D, .", "Search active repos"],
  ["Alt+D, Shift+/", "Search all repos"],
  ["Alt+D, W", "Open in new window"],
  ["Alt+D, O", "Reveal in file explorer"],
  ["", ""],
  ["Alt+D, B", "Switch branch"],
  ["Alt+D, H", "Commit history"],
  ["Alt+D, A", "Stash management"],
  ["Alt+D, X", "Branch cleanup"],
  ["Alt+D, G", "Toggle inline blame"],
  ["Alt+D, E", "Favorite current repo"],
  ["Alt+D, I", "Filter by tag"],
  ["Alt+D, T", "Terminal at repo"],
  ["Alt+D, Shift+T", "Terminal at root"],
  ["Alt+D, Backspace", "Swap to previous repo"],
  ["", ""],
  ["Alt+D, Q", "Close active repo"],
  ["Alt+D, Shift+Q", "Pick repo to close"],
  ["Alt+D, Shift+Tab", "Close all active"],
  ["Alt+D, Shift+B", "Save snapshot"],
  ["Alt+D, Shift+L", "Load snapshot"],
  ["Alt+D, K", "Show all shortcuts"],
];

export default function ShortcutRef() {
  return (
    <div className="shortcut-panel">
      <div className="shortcut-panel-header">
        All shortcuts use <kbd className="shortcut-key">Alt+D</kbd> as a chord prefix — press Alt+D, release, then press the key.
      </div>
      <div className="shortcut-grid">
        {shortcuts.map(([key, desc], i) =>
          key === "" ? (
            <div key={i} className="shortcut-divider" />
          ) : (
            <div key={key} className="shortcut-row">
              <kbd className="shortcut-key">{key}</kbd>
              <span className="shortcut-desc">{desc}</span>
            </div>
          )
        )}
      </div>
    </div>
  );
}
