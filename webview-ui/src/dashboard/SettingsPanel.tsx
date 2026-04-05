import { useState, useEffect } from "react";
import vscode from "../vscode";

interface Settings {
  scanRoots: string[];
  scanMaxDepth: number;
  scanExtraSkipDirs: string[];
  scanOnStartup: boolean;
  fetchOnScan: boolean;
  autoRefreshInterval: number;
  changedOnlyDefault: boolean;
  showFavorites: boolean;
  showInlineBlame: boolean;
  claudePermissionMode: string;
  autoPushAfterCommit: boolean;
  pinnedRepos: string[];
}

function SettingToggle({ label, description, value, onChange }: {
  label: string; description?: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="setting-row">
      <div>
        <div className="setting-label">{label}</div>
        {description && <div className="setting-description">{description}</div>}
      </div>
      <input
        type="checkbox"
        className="setting-toggle"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
    </div>
  );
}

function SettingNumber({ label, description, value, onChange, min, max }: {
  label: string; description?: string; value: number; onChange: (v: number) => void; min?: number; max?: number;
}) {
  return (
    <div className="setting-row">
      <div>
        <div className="setting-label">{label}</div>
        {description && <div className="setting-description">{description}</div>}
      </div>
      <input
        type="number"
        className="setting-input"
        value={value}
        min={min}
        max={max}
        style={{ width: 60 }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function SettingSelect({ label, description, value, options, onChange }: {
  label: string; description?: string; value: string; options: string[]; onChange: (v: string) => void;
}) {
  return (
    <div className="setting-row">
      <div>
        <div className="setting-label">{label}</div>
        {description && <div className="setting-description">{description}</div>}
      </div>
      <select className="setting-input" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function SettingArrayEditor({ label, description, values, onRemove, onAdd }: {
  label: string; description?: string; values: string[]; onRemove: (v: string) => void; onAdd: () => void;
}) {
  return (
    <div className="setting-row setting-row--array">
      <div>
        <div className="setting-label">{label}</div>
        {description && <div className="setting-description">{description}</div>}
      </div>
      <div className="setting-array">
        {values.map((v) => (
          <div key={v} className="setting-array-item">
            <span className="setting-array-value">{v}</span>
            <button className="icon-btn" onClick={() => onRemove(v)} title="Remove">✕</button>
          </div>
        ))}
        <button className="refresh-btn" onClick={onAdd} style={{ marginTop: 4 }}>
          + Add
        </button>
      </div>
    </div>
  );
}

export default function SettingsPanel() {
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data.type === "settingsData") {
        setSettings(event.data.settings);
      }
    };
    window.addEventListener("message", handler);
    vscode.postMessage({ type: "getSettings" });
    return () => window.removeEventListener("message", handler);
  }, []);

  const update = (key: keyof Settings, value: unknown) => {
    setSettings((prev) => prev ? { ...prev, [key]: value } : prev);
    vscode.postMessage({ type: "updateSetting", key, value });
  };

  if (!settings) {
    return <div className="loading-state"><span className="spinner" /> Loading settings...</div>;
  }

  return (
    <div className="settings-panel">
      <div className="settings-section">
        <div className="settings-section-title">Scanning</div>
        <SettingArrayEditor
          label="Scan Roots"
          description="Root directories to scan for Git repositories"
          values={settings.scanRoots}
          onRemove={(v) => update("scanRoots", settings.scanRoots.filter((r) => r !== v))}
          onAdd={() => vscode.postMessage({ type: "addScanRootFromSettings" })}
        />
        <SettingNumber
          label="Scan Max Depth"
          description="Maximum directory depth when scanning"
          value={settings.scanMaxDepth}
          onChange={(v) => update("scanMaxDepth", v)}
          min={1}
          max={20}
        />
        <SettingArrayEditor
          label="Extra Skip Directories"
          description="Additional directory names to skip during scanning"
          values={settings.scanExtraSkipDirs}
          onRemove={(v) => update("scanExtraSkipDirs", settings.scanExtraSkipDirs.filter((d) => d !== v))}
          onAdd={() => {
            const name = prompt("Directory name to skip:");
            if (name) update("scanExtraSkipDirs", [...settings.scanExtraSkipDirs, name]);
          }}
        />
        <SettingToggle
          label="Scan on Startup"
          description="Automatically scan for repositories when VS Code starts"
          value={settings.scanOnStartup}
          onChange={(v) => update("scanOnStartup", v)}
        />
        <SettingToggle
          label="Fetch on Scan"
          description="Run git fetch during scan for accurate ahead/behind counts"
          value={settings.fetchOnScan}
          onChange={(v) => update("fetchOnScan", v)}
        />
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Display</div>
        <SettingToggle
          label="Changed Only by Default"
          description="Show only repos with uncommitted changes by default"
          value={settings.changedOnlyDefault}
          onChange={(v) => update("changedOnlyDefault", v)}
        />
        <SettingToggle
          label="Show Favorites"
          description="Show favorites in Active Repos view"
          value={settings.showFavorites}
          onChange={(v) => update("showFavorites", v)}
        />
        <SettingToggle
          label="Show Inline Blame"
          description="Show inline git blame annotation on the current line"
          value={settings.showInlineBlame}
          onChange={(v) => update("showInlineBlame", v)}
        />
        <SettingNumber
          label="Auto-Refresh Interval"
          description="Seconds between auto-refreshes (0 to disable)"
          value={settings.autoRefreshInterval}
          onChange={(v) => update("autoRefreshInterval", v)}
          min={0}
          max={300}
        />
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Claude Code</div>
        <SettingSelect
          label="Permission Mode"
          description="Permission mode for Claude CLI AI commits"
          value={settings.claudePermissionMode}
          options={["default", "acceptEdits", "full"]}
          onChange={(v) => update("claudePermissionMode", v)}
        />
        <SettingToggle
          label="Auto-Push After Commit"
          description="Automatically push after a successful commit via Alt+D, M"
          value={settings.autoPushAfterCommit}
          onChange={(v) => update("autoPushAfterCommit", v)}
        />
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Pinned Repos</div>
        {settings.pinnedRepos.length === 0 ? (
          <div className="section-empty">No pinned repos. Use the pin button in the Sync Overview.</div>
        ) : (
          settings.pinnedRepos.map((p) => (
            <div key={p} className="setting-array-item">
              <span className="setting-array-value">{p.split("/").pop()}</span>
              <button
                className="icon-btn"
                onClick={() => update("pinnedRepos", settings.pinnedRepos.filter((r) => r !== p))}
                title="Unpin"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
