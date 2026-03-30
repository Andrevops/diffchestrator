import type { Disposable } from "vscode";

export class DisposableStore {
  private _disposables: Disposable[] = [];

  add<T extends Disposable>(d: T): T {
    this._disposables.push(d);
    return d;
  }

  dispose(): void {
    const errors: any[] = [];
    while (this._disposables.length > 0) {
      const d = this._disposables.pop();
      try {
        d?.dispose();
      } catch (e) {
        errors.push(e);
      }
    }
    if (errors.length > 0) {
      if (errors.length === 1) {
        throw errors[0];
      }
      throw new AggregateError(errors, "Errors occurred while disposing");
    }
  }
}
