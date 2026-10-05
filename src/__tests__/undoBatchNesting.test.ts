/**
 * runAsSingleUndoStep must restore the PRIOR suppression / deferred-save state when it
 * finishes, not reset it to null (#370).
 *
 * Both current callers are top-level, so nothing nests today. The trap: a bulk action that
 * runs inside another suppressed batch would, on exit, null out the outer batch's
 * suppression and deferred save. The outer batch's later pushUndo calls would then hit the
 * real stack (one entry per item instead of one for the batch), and its undoFailedPush
 * would pop a real, unrelated entry.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import type { ConnectionEdge, SchematicFile, SchematicNode } from "../types";
import fixture from "../testSchematic/schematic.json";

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key() { return null; }
  get length() { return this.m.size; }
}

let useSchematicStore: typeof import("../store")["useSchematicStore"];
let __undoBatchInternalsForTest: typeof import("../store")["__undoBatchInternalsForTest"];
let storage: MemStorage;

beforeAll(async () => {
  storage = new MemStorage();
  (globalThis as { localStorage?: unknown }).localStorage = storage;
  if (!globalThis.crypto?.randomUUID) {
    (globalThis as { crypto?: unknown }).crypto = {
      randomUUID: () => "test-" + Math.random().toString(36).slice(2),
    };
  }
  ({ useSchematicStore, __undoBatchInternalsForTest } = await import("../store"));
});

const file = fixture as unknown as SchematicFile;
const state = () => useSchematicStore.getState();

beforeEach(() => {
  while (state().undoSize > 0) state().undo();
  useSchematicStore.setState({
    nodes: structuredClone(file.nodes) as SchematicNode[],
    edges: structuredClone(file.edges) as ConnectionEdge[],
  });
});

describe("runAsSingleUndoStep nesting (#370)", () => {
  it("keeps the outer batch's undo suppression after an inner batch finishes", () => {
    state().pushSnapshot(); // one real pre-batch entry
    const before = state().undoSize;

    __undoBatchInternalsForTest.runAsSingleUndoStep(["outer-1", "outer-2"], (id) => {
      if (id === "outer-1") {
        // Inner batch that changes something: counted by the OUTER batch, not recorded.
        __undoBatchInternalsForTest.runAsSingleUndoStep(["inner"], () => state().pushSnapshot());
        expect(state().undoSize).toBe(before);
      }
      // Still inside the outer batch: this push must still be suppressed...
      state().pushSnapshot();
      expect(state().undoSize).toBe(before);
      // ...and a failed-item unwind must hit the suppression counter, not the real stack.
      __undoBatchInternalsForTest.undoFailedPush();
      expect(state().undoSize).toBe(before);
    });

    // One consolidated entry for the whole outer batch, nothing else.
    expect(state().undoSize).toBe(before + 1);
  });

  it("keeps the outer batch's deferred save after an inner batch finishes", () => {
    state().resumeAutosave(); // arm persistence (hydrated is module state)
    const setItem = vi.spyOn(storage, "setItem");
    try {
      __undoBatchInternalsForTest.runAsSingleUndoStep(["outer"], () => {
        __undoBatchInternalsForTest.runAsSingleUndoStep(["inner"], () => {
          state().pushSnapshot();
          state().saveToLocalStorage();
        });
        setItem.mockClear();
        // Back in the outer batch: this save must be deferred, not written now.
        state().saveToLocalStorage();
        expect(setItem).not.toHaveBeenCalled();
      });
      // The outer batch flushes its deferred save exactly once at the end.
      expect(setItem).toHaveBeenCalled();
    } finally {
      setItem.mockRestore();
    }
  });

  it("returns to unsuppressed state after a top-level batch (pushes record again)", () => {
    __undoBatchInternalsForTest.runAsSingleUndoStep(["a"], () => state().pushSnapshot());
    const after = state().undoSize;
    state().pushSnapshot();
    expect(state().undoSize).toBe(after + 1);
  });
});
