// Minimal vscode API stub for Node-runtime unit tests. The real `vscode`
// module is only available inside the extension host, so modules that depend
// on it are redirected here via the loader hook in vscode-loader.mjs.
// Only the surface actually touched by testable modules is stubbed.

export class EventEmitter {
  constructor() { this._listeners = []; }
  event = (listener) => {
    this._listeners.push(listener);
    return { dispose: () => { this._listeners = this._listeners.filter((l) => l !== listener); } };
  };
  fire(data) { for (const l of this._listeners) l(data); }
  dispose() { this._listeners = []; }
}

class Configuration {
  constructor(values = {}) { this._values = values; }
  get(key, defaultValue) {
    return this._values[key] !== undefined ? this._values[key] : defaultValue;
  }
}

const _configValues = {};

export const workspace = {
  getConfiguration(section) { return new Configuration(_configValues[section] ?? {}); },
  onDidChangeConfiguration: (_cb) => ({ dispose: () => {} }),
  __setConfig(section, values) { _configValues[section] = values; },
  __resetConfig() { for (const k of Object.keys(_configValues)) delete _configValues[k]; },
};

const _executedCommands = [];

export const commands = {
  executeCommand: (command, ...args) => { _executedCommands.push({ command, args }); return Promise.resolve(); },
  registerCommand: (_cmd, _cb) => ({ dispose: () => {} }),
  __getCalls() { return [..._executedCommands]; },
  __resetCalls() { _executedCommands.length = 0; },
};

export const window = {
  onDidChangeWindowState: (_cb) => ({ dispose: () => {} }),
  showWarningMessage: () => Promise.resolve(undefined),
  showInformationMessage: () => Promise.resolve(undefined),
  showErrorMessage: () => Promise.resolve(undefined),
  withProgress: async (_o, task) => task({ report: () => {} }),
};

export class Disposable {
  constructor(fn) { this._fn = fn; }
  dispose() { this._fn(); }
  static from(...items) { return new Disposable(() => { for (const i of items) i.dispose(); }); }
}

export const Uri = {
  file: (p) => ({ fsPath: p, scheme: "file", path: p }),
  parse: (s) => ({ fsPath: s, scheme: s.split(":")[0] ?? "file", path: s, with: () => ({}) }),
};

export const ProgressLocation = { Notification: 15, Window: 10 };
export const ConfigurationTarget = { Global: 1, Workspace: 2 };
