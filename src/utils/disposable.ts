import type { Disposable } from "vscode";

export class DisposableStore {
  private _disposables: Disposable[] = [];

  add<T extends Disposable>(d: T): T {
    this._disposables.push(d);
    return d;
  }

  dispose(): void {
    for (const d of this._disposables) {
      d.dispose();
    }
    this._disposables = [];
  }
}
