import * as assert from "node:assert";
import { test } from "node:test";
import { DisposableStore } from "./disposable.ts";
import type { Disposable } from "vscode";

test("DisposableStore", async (t) => {
  await t.test("add() should add a disposable and return it", () => {
    const store = new DisposableStore();
    let disposed = false;
    const disposable: Disposable = {
      dispose: () => {
        disposed = true;
      },
    };

    const result = store.add(disposable);

    assert.strictEqual(result, disposable);
    assert.strictEqual(disposed, false); // Not disposed yet
  });

  await t.test("dispose() should call dispose on all added disposables", () => {
    const store = new DisposableStore();
    let disposed1 = false;
    let disposed2 = false;

    store.add({
      dispose: () => {
        disposed1 = true;
      },
    });

    store.add({
      dispose: () => {
        disposed2 = true;
      },
    });

    store.dispose();

    assert.strictEqual(disposed1, true);
    assert.strictEqual(disposed2, true);
  });

  await t.test("dispose() should clear the store", () => {
    const store = new DisposableStore();
    let disposedCount = 0;

    const disposable: Disposable = {
      dispose: () => {
        disposedCount++;
      },
    };

    store.add(disposable);
    store.dispose();

    assert.strictEqual(disposedCount, 1);

    // Call dispose again, it shouldn't call dispose on the previous items again
    store.dispose();

    assert.strictEqual(disposedCount, 1);
  });

  await t.test("dispose() should dispose items in reverse order of addition", () => {
    const store = new DisposableStore();
    const order: number[] = [];

    store.add({ dispose: () => order.push(1) });
    store.add({ dispose: () => order.push(2) });
    store.add({ dispose: () => order.push(3) });

    store.dispose();

    assert.deepStrictEqual(order, [3, 2, 1]);
  });

  await t.test("dispose() should continue disposing even if one throws", () => {
    const store = new DisposableStore();
    let disposed1 = false;
    let disposed3 = false;

    store.add({
      dispose: () => {
        disposed1 = true;
      },
    });

    store.add({
      dispose: () => {
        throw new Error("Dispose failed");
      },
    });

    store.add({
      dispose: () => {
        disposed3 = true;
      },
    });

    assert.throws(() => {
      store.dispose();
    }, /Dispose failed/);

    assert.strictEqual(disposed1, true);
    assert.strictEqual(disposed3, true);
  });

  await t.test("dispose() should throw AggregateError if multiple items throw", () => {
    const store = new DisposableStore();

    store.add({
      dispose: () => {
        throw new Error("First error");
      },
    });

    store.add({
      dispose: () => {
        throw new Error("Second error");
      },
    });

    assert.throws(
      () => {
        store.dispose();
      },
      (err: any) => {
        return err instanceof AggregateError && err.errors.length === 2;
      }
    );
  });
});
