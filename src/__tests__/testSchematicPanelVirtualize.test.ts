/**
 * The seeded fixture must let a test pass drive virtual-patch-panel scenarios
 * without substituting devices (#378): setPanelOffCanvas refuses a wired panel,
 * so the fixture needs a panel with no connections, while PP-01 stays wired.
 */
import { describe, it, expect, beforeAll } from "vitest";
import type { SchematicFile } from "../types";
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

beforeAll(async () => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemStorage();
  if (!globalThis.crypto?.randomUUID) {
    (globalThis as { crypto?: unknown }).crypto = {
      randomUUID: () => "test-" + Math.random().toString(36).slice(2),
    };
  }
  ({ useSchematicStore } = await import("../store"));
  const file = structuredClone(fixture) as unknown as SchematicFile;
  useSchematicStore.setState({ nodes: file.nodes, edges: file.edges });
});

describe("fixture patch panels and setPanelOffCanvas (#378)", () => {
  it("virtualizes the unwired panel (PP-02)", () => {
    expect(useSchematicStore.getState().setPanelOffCanvas("device-26", true)).toBe(true);
    const pp2 = useSchematicStore.getState().nodes.find((n) => n.id === "device-26")!;
    expect(pp2.hidden).toBe(true);
    expect(useSchematicStore.getState().setPanelOffCanvas("device-26", false)).toBe(true);
  });

  it("still refuses the wired panel (PP-01)", () => {
    expect(useSchematicStore.getState().setPanelOffCanvas("device-8", true)).toBe(false);
  });
});
