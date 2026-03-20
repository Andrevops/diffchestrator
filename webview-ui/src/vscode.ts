interface VSCodeAPI {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
// @ts-expect-error — injected by VS Code webview
const vscode: VSCodeAPI = acquireVsCodeApi();
export default vscode;
