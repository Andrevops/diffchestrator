/**
 * Builds the dashboard's keyboard-shortcut cheat sheet from the extension's
 * own package.json (`contributes.keybindings` + `contributes.commands`), so it
 * can never drift from the real keybindings.
 */

export interface ShortcutEntry {
  key: string;
  title: string;
  command: string;
}

interface Keybinding {
  command?: unknown;
  key?: unknown;
  mac?: unknown;
  linux?: unknown;
  win?: unknown;
}

interface CommandContribution {
  command?: unknown;
  title?: unknown;
}

const KEY_NAMES: Record<string, string> = {
  alt: "Alt",
  shift: "Shift",
  ctrl: "Ctrl",
  cmd: "Cmd",
  meta: "Meta",
  win: "Win",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
  enter: "Enter",
  escape: "Esc",
  space: "Space",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
};

/** "alt+d shift+t" → "Alt+D, Shift+T" */
export function formatKeybinding(key: string): string {
  return key
    .trim()
    .split(/\s+/)
    .map((chord) =>
      chord
        .split("+")
        .map((part) => {
          const p = part.toLowerCase();
          if (KEY_NAMES[p]) return KEY_NAMES[p];
          return p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1);
        })
        .join("+")
    )
    .join(", ");
}

export function buildShortcuts(packageJSON: unknown, platform: NodeJS.Platform): ShortcutEntry[] {
  const contributes = (packageJSON as { contributes?: { keybindings?: unknown; commands?: unknown } } | undefined)
    ?.contributes;
  const keybindings = Array.isArray(contributes?.keybindings) ? (contributes.keybindings as Keybinding[]) : [];
  const commands = Array.isArray(contributes?.commands) ? (contributes.commands as CommandContribution[]) : [];

  const titles = new Map<string, string>();
  for (const c of commands) {
    if (typeof c.command === "string" && typeof c.title === "string") titles.set(c.command, c.title);
  }

  const seen = new Set<string>();
  const out: ShortcutEntry[] = [];
  for (const kb of keybindings) {
    if (typeof kb.command !== "string" || kb.command.startsWith("-")) continue;
    const platformKey = platform === "darwin" ? kb.mac : platform === "win32" ? kb.win : kb.linux;
    const raw = typeof platformKey === "string" ? platformKey : kb.key;
    if (typeof raw !== "string" || !raw.trim()) continue;
    const key = formatKeybinding(raw);
    const dedupe = `${kb.command}\0${key}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({ key, title: titles.get(kb.command) ?? kb.command, command: kb.command });
  }
  return out;
}
