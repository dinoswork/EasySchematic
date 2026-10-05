/**
 * Stub tag follow-ups to #270:
 *
 * - #376 — a stubbed connection has two tags, one per end, and they are one cable. Switching
 *   one tag between "Destination" and "Cable ID only" switches its partner too, and the
 *   pair change is ONE undo step.
 * - #377 — which of the two a freshly stubbed connection's tags start in is a setting: an app
 *   preference shared by every project on this computer, plus a per-project override that
 *   travels with the file. Same shape as the default device header color (#354): project
 *   override > app preference > "full", stamped onto the tags when the connection is
 *   stubbed, so changing a setting never rewrites tags already on the canvas.
 * - #297 (same-room half) — a destination tag names the far device's room only when that
 *   room differs from the room at the tag's own end. An explicit per-tag "Show room: On"
 *   still prints it.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { resolveStubLabelParts } from "../stubLabelResolve";
import { buildStubLabelText, type StubLabelParts } from "../stubLabelText";
import {
  DEFAULT_STUB_LABEL_MODE_KEY,
  normalizeStubLabelMode,
  resolveDefaultStubLabelMode,
} from "../stubLabelModeDefault";
import type { ConnectionEdge, SchematicFile, SchematicNode, StubLabelData } from "../types";

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key(i: number) { return Array.from(this.m.keys())[i] ?? null; }
  get length() { return this.m.size; }
}

let useSchematicStore: typeof import("../store").useSchematicStore;

beforeAll(async () => {
  vi.stubGlobal("localStorage", new MemStorage());
  ({ useSchematicStore } = await import("../store"));
});
afterAll(() => { vi.unstubAllGlobals(); });
beforeEach(() => {
  localStorage.removeItem(DEFAULT_STUB_LABEL_MODE_KEY);
  useSchematicStore.getState().newSchematic();
  useSchematicStore.setState({
    toasts: [],
    cableIdMap: {},
    appDefaultStubLabelMode: "full",
    defaultStubLabelMode: undefined,
  });
});

const SRC_TAG = "stub-e-run-src";
const TGT_TAG = "stub-e-run-tgt";

/**
 * MATRIX ──▶ PROJECTOR. `srcRoom` / `tgtRoom` put each device in a room (or leave it on
 * the bare canvas); the same id puts both devices in the same room.
 */
function seedRun(opts: { srcRoom?: string; tgtRoom?: string; stub?: boolean } = {}) {
  const rooms: Record<string, string> = { "room-hall": "Main Hall", "room-booth": "Booth" };
  const nodes: SchematicNode[] = [
    { id: "room-hall", type: "room", position: { x: 0, y: 0 },
      style: { width: 1200, height: 400 }, data: { label: rooms["room-hall"] } } as unknown as SchematicNode,
    { id: "room-booth", type: "room", position: { x: 0, y: 600 },
      style: { width: 1200, height: 400 }, data: { label: rooms["room-booth"] } } as unknown as SchematicNode,
    { id: "dev-src", type: "device", position: { x: 50, y: 100 },
      ...(opts.srcRoom ? { parentId: opts.srcRoom } : {}),
      measured: { width: 144, height: 48 },
      data: { label: "MATRIX", deviceType: "misc", ports: [
        { id: "hdmi-out-1", label: "HDMI Out 1", signalType: "hdmi", direction: "output", connectorType: "hdmi" },
      ] } } as unknown as SchematicNode,
    { id: "dev-proj", type: "device", position: { x: 800, y: 100 },
      ...(opts.tgtRoom ? { parentId: opts.tgtRoom } : {}),
      measured: { width: 144, height: 48 },
      data: { label: "PROJECTOR", deviceType: "display", ports: [
        { id: "hdmi-in-1", label: "HDMI In 1", signalType: "hdmi", direction: "input", connectorType: "hdmi" },
      ] } } as unknown as SchematicNode,
  ];
  const edges: ConnectionEdge[] = [
    { id: "e-run", source: "dev-src", sourceHandle: "hdmi-out-1",
      target: "dev-proj", targetHandle: "hdmi-in-1",
      data: { signalType: "hdmi", cableId: "HDMI-001" } } as unknown as ConnectionEdge,
  ];
  useSchematicStore.setState({ nodes, edges });
  if (opts.stub !== false) useSchematicStore.getState().convertEdgeToStubs("e-run");
}

function tagData(id: string): StubLabelData {
  return useSchematicStore.getState().nodes.find((n) => n.id === id)!.data as StubLabelData;
}

/** The text a tag shows, the way StubLabelNode composes it (global toggles as stored). */
function tagText(id: string): string {
  const s = useSchematicStore.getState();
  const data = tagData(id);
  const parts = resolveStubLabelParts(id, data, { nodes: s.nodes, edges: s.edges, cableIdMap: s.cableIdMap });
  expect(parts).not.toBeNull();
  return buildStubLabelText(parts!, {
    showArrow: data.showArrow ?? s.stubLabelShowArrow,
    showPort: data.showPort ?? s.stubLabelShowPort,
    showRoom: data.showRoom ?? s.stubLabelShowRoom,
    roomInSameRoom: data.showRoom === true,
    pageMode: data.pageMode ?? s.stubLabelPageMode,
    labelMode: data.labelMode,
  });
}

// ─── #376 ─────────────────────────────────────────────────────────

describe("both tags of a stubbed connection switch mode together (#376)", () => {
  it("switching one tag to Cable ID only switches its partner too", () => {
    seedRun();
    useSchematicStore.getState().setStubLabelMode(SRC_TAG, "cableId");
    expect(tagData(SRC_TAG).labelMode).toBe("cableId");
    expect(tagData(TGT_TAG).labelMode).toBe("cableId");
    expect(tagText(SRC_TAG)).toBe("HDMI-001");
    expect(tagText(TGT_TAG)).toBe("HDMI-001");
  });

  it("works from either end, and back to Destination clears both", () => {
    seedRun();
    useSchematicStore.getState().setStubLabelMode(TGT_TAG, "cableId");
    expect(tagData(SRC_TAG).labelMode).toBe("cableId");
    useSchematicStore.getState().setStubLabelMode(SRC_TAG, "full");
    // "full" is stored as unset, the same as every tag saved before #270.
    expect(tagData(SRC_TAG).labelMode).toBeUndefined();
    expect(tagData(TGT_TAG).labelMode).toBeUndefined();
    expect(tagText(SRC_TAG)).toContain("PROJECTOR");
    expect(tagText(TGT_TAG)).toContain("MATRIX");
  });

  it("is a single undo step that restores both tags", () => {
    seedRun();
    const before = useSchematicStore.getState().undoSize;
    useSchematicStore.getState().setStubLabelMode(SRC_TAG, "cableId");
    expect(useSchematicStore.getState().undoSize).toBe(before + 1);

    useSchematicStore.getState().undo();
    expect(tagData(SRC_TAG).labelMode).toBeUndefined();
    expect(tagData(TGT_TAG).labelMode).toBeUndefined();

    useSchematicStore.getState().redo();
    expect(tagData(SRC_TAG).labelMode).toBe("cableId");
    expect(tagData(TGT_TAG).labelMode).toBe("cableId");
  });

  it("re-syncs a pair that had drifted apart before the fix", () => {
    seedRun();
    // A file saved under #270 alone can carry one tag in each mode.
    useSchematicStore.getState().patchStubLabelData(TGT_TAG, { labelMode: "cableId" });
    useSchematicStore.getState().setStubLabelMode(SRC_TAG, "cableId");
    expect(tagData(SRC_TAG).labelMode).toBe("cableId");
    expect(tagData(TGT_TAG).labelMode).toBe("cableId");
  });

  it("leaves other stubbed connections alone", () => {
    seedRun();
    // A second stubbed connection out of the same pair of devices.
    const s = useSchematicStore.getState();
    useSchematicStore.setState({
      edges: [...s.edges, { id: "e-two", source: "dev-src", sourceHandle: "hdmi-out-1",
        target: "dev-proj", targetHandle: "hdmi-in-1",
        data: { signalType: "hdmi" } } as unknown as ConnectionEdge],
    });
    useSchematicStore.getState().convertEdgeToStubs("e-two");
    useSchematicStore.getState().setStubLabelMode(SRC_TAG, "cableId");
    expect(tagData("stub-e-two-src").labelMode).toBeUndefined();
    expect(tagData("stub-e-two-tgt").labelMode).toBeUndefined();
  });

  it("does nothing, and records no undo step, for a tag that's already in that mode", () => {
    seedRun();
    const before = useSchematicStore.getState().undoSize;
    useSchematicStore.getState().setStubLabelMode(SRC_TAG, "full");
    expect(useSchematicStore.getState().undoSize).toBe(before);
  });

  // The context menu calls this action, so the flip logic lives where it can be tested.
  it("toggleStubLabelMode flips both tags in one undo step, and flips back", () => {
    seedRun();
    const before = useSchematicStore.getState().undoSize;
    useSchematicStore.getState().toggleStubLabelMode(SRC_TAG);
    expect(tagData(SRC_TAG).labelMode).toBe("cableId");
    expect(tagData(TGT_TAG).labelMode).toBe("cableId");
    expect(useSchematicStore.getState().undoSize).toBe(before + 1);

    useSchematicStore.getState().undo();
    expect(tagData(SRC_TAG).labelMode).toBeUndefined();
    expect(tagData(TGT_TAG).labelMode).toBeUndefined();
    expect(useSchematicStore.getState().undoSize).toBe(before);

    useSchematicStore.getState().toggleStubLabelMode(TGT_TAG);
    useSchematicStore.getState().toggleStubLabelMode(TGT_TAG);
    expect(tagData(SRC_TAG).labelMode).toBeUndefined();
    expect(tagData(TGT_TAG).labelMode).toBeUndefined();
  });
});

// ─── #377 ─────────────────────────────────────────────────────────

describe("default stub tag mode — precedence (#377)", () => {
  it("starts new tags as Destination when nothing is set", () => {
    seedRun();
    expect(tagData(SRC_TAG).labelMode).toBeUndefined();
    expect(tagData(TGT_TAG).labelMode).toBeUndefined();
  });

  it("starts both new tags as Cable ID only under the app preference", () => {
    useSchematicStore.getState().setAppDefaultStubLabelMode("cableId");
    seedRun();
    expect(tagData(SRC_TAG).labelMode).toBe("cableId");
    expect(tagData(TGT_TAG).labelMode).toBe("cableId");
    expect(tagText(TGT_TAG)).toBe("HDMI-001");
  });

  it("starts both new tags as Cable ID only under the project override", () => {
    useSchematicStore.getState().setDefaultStubLabelMode("cableId");
    seedRun();
    expect(tagData(SRC_TAG).labelMode).toBe("cableId");
    expect(tagData(TGT_TAG).labelMode).toBe("cableId");
  });

  it("lets the project override win over the app preference, both ways", () => {
    useSchematicStore.getState().setAppDefaultStubLabelMode("cableId");
    useSchematicStore.getState().setDefaultStubLabelMode("full");
    seedRun();
    expect(tagData(SRC_TAG).labelMode).toBeUndefined();

    useSchematicStore.getState().newSchematic();
    useSchematicStore.getState().setAppDefaultStubLabelMode("full");
    useSchematicStore.getState().setDefaultStubLabelMode("cableId");
    seedRun();
    expect(tagData(SRC_TAG).labelMode).toBe("cableId");
  });

  it("falls back to the app preference when the project override is cleared", () => {
    useSchematicStore.getState().setAppDefaultStubLabelMode("cableId");
    useSchematicStore.getState().setDefaultStubLabelMode("full");
    useSchematicStore.getState().setDefaultStubLabelMode(undefined);
    seedRun();
    expect(tagData(SRC_TAG).labelMode).toBe("cableId");
  });

  it("applies to connections drawn as stubs by the default connection type (#353)", () => {
    useSchematicStore.getState().setDefaultStubLabelMode("cableId");
    useSchematicStore.getState().setDefaultConnectionType("stub");
    seedRun({ stub: false });
    useSchematicStore.setState({ edges: [] });
    useSchematicStore.getState().onConnect({
      source: "dev-src", sourceHandle: "hdmi-out-1", target: "dev-proj", targetHandle: "hdmi-in-1",
    });
    const tags = useSchematicStore.getState().nodes.filter((n) => n.type === "stub-label");
    expect(tags.length).toBe(2);
    for (const t of tags) expect((t.data as StubLabelData).labelMode).toBe("cableId");
  });

  it("resolves the same way outside the store", () => {
    expect(resolveDefaultStubLabelMode("full", "cableId")).toBe("full");
    expect(resolveDefaultStubLabelMode(undefined, "cableId")).toBe("cableId");
    expect(resolveDefaultStubLabelMode(undefined, undefined)).toBe("full");
    expect(resolveDefaultStubLabelMode("junk" as never, "cableId")).toBe("cableId");
  });
});

describe("default stub tag mode — no retroactive rewrite (#377)", () => {
  it("leaves tags already on the canvas alone when either setting changes", () => {
    seedRun();
    useSchematicStore.getState().setAppDefaultStubLabelMode("cableId");
    useSchematicStore.getState().setDefaultStubLabelMode("cableId");
    expect(tagData(SRC_TAG).labelMode).toBeUndefined();
    expect(tagText(SRC_TAG)).toContain("PROJECTOR");
  });

  it("lets a stamped tag be switched back to Destination", () => {
    useSchematicStore.getState().setAppDefaultStubLabelMode("cableId");
    seedRun();
    useSchematicStore.getState().setStubLabelMode(SRC_TAG, "full");
    expect(tagData(SRC_TAG).labelMode).toBeUndefined();
    expect(tagData(TGT_TAG).labelMode).toBeUndefined();
  });
});

describe("default stub tag mode — persistence (#377)", () => {
  it("writes the project override into the exported file, and omits it when unset", () => {
    expect(useSchematicStore.getState().exportToJSON().defaultStubLabelMode).toBeUndefined();
    useSchematicStore.getState().setDefaultStubLabelMode("cableId");
    expect(useSchematicStore.getState().exportToJSON().defaultStubLabelMode).toBe("cableId");
  });

  it("round-trips the project override through export and import", () => {
    useSchematicStore.getState().setDefaultStubLabelMode("cableId");
    const exported = JSON.parse(JSON.stringify(useSchematicStore.getState().exportToJSON())) as SchematicFile;
    useSchematicStore.getState().setDefaultStubLabelMode(undefined);
    useSchematicStore.getState().importFromJSON(exported);
    expect(useSchematicStore.getState().defaultStubLabelMode).toBe("cableId");
  });

  it("round-trips the project override through the autosave", () => {
    useSchematicStore.getState().setDefaultStubLabelMode("full");
    useSchematicStore.getState().saveToLocalStorage();
    useSchematicStore.setState({ defaultStubLabelMode: undefined });
    expect(useSchematicStore.getState().loadFromLocalStorage()).toBe(true);
    expect(useSchematicStore.getState().defaultStubLabelMode).toBe("full");
  });

  it("loads an older file with no such field as unset", () => {
    useSchematicStore.getState().setDefaultStubLabelMode("cableId");
    const legacy = JSON.parse(JSON.stringify(useSchematicStore.getState().exportToJSON())) as SchematicFile;
    delete legacy.defaultStubLabelMode;
    useSchematicStore.getState().importFromJSON(legacy);
    expect(useSchematicStore.getState().defaultStubLabelMode).toBeUndefined();
  });

  it("ignores a junk value in a loaded file", () => {
    const tampered = JSON.parse(JSON.stringify(useSchematicStore.getState().exportToJSON())) as SchematicFile;
    (tampered as unknown as Record<string, unknown>).defaultStubLabelMode = "everything";
    useSchematicStore.getState().importFromJSON(tampered);
    expect(useSchematicStore.getState().defaultStubLabelMode).toBeUndefined();
  });

  it("keeps the app preference out of the file and in localStorage", () => {
    useSchematicStore.getState().setAppDefaultStubLabelMode("cableId");
    expect(useSchematicStore.getState().exportToJSON().defaultStubLabelMode).toBeUndefined();
    expect(localStorage.getItem(DEFAULT_STUB_LABEL_MODE_KEY)).toBe("cableId");
    useSchematicStore.getState().setAppDefaultStubLabelMode("full");
    expect(localStorage.getItem(DEFAULT_STUB_LABEL_MODE_KEY)).toBeNull();
  });

  it("drops the project override on New Schematic but keeps the app preference", () => {
    useSchematicStore.getState().setAppDefaultStubLabelMode("cableId");
    useSchematicStore.getState().setDefaultStubLabelMode("full");
    useSchematicStore.getState().newSchematic();
    expect(useSchematicStore.getState().defaultStubLabelMode).toBeUndefined();
    expect(useSchematicStore.getState().appDefaultStubLabelMode).toBe("cableId");
  });

  it("normalizes untrusted values", () => {
    expect(normalizeStubLabelMode("cableId")).toBe("cableId");
    expect(normalizeStubLabelMode("full")).toBe("full");
    for (const junk of ["CableId", "", "id", 1, null, undefined, {}]) {
      expect(normalizeStubLabelMode(junk)).toBeUndefined();
    }
  });
});

describe("default stub tag mode — app preference reload (#377)", () => {
  const RELOAD_TIMEOUT = 30000;

  it("reads the stored app preference back on the next session", async () => {
    const storage = new MemStorage();
    storage.setItem(DEFAULT_STUB_LABEL_MODE_KEY, "cableId");
    vi.stubGlobal("localStorage", storage);
    vi.resetModules();
    const reloaded = (await import("../store")).useSchematicStore;
    expect(reloaded.getState().appDefaultStubLabelMode).toBe("cableId");
  }, RELOAD_TIMEOUT);

  it("ignores a junk stored value", async () => {
    const storage = new MemStorage();
    storage.setItem(DEFAULT_STUB_LABEL_MODE_KEY, "nonsense");
    vi.stubGlobal("localStorage", storage);
    vi.resetModules();
    const reloaded = (await import("../store")).useSchematicStore;
    expect(reloaded.getState().appDefaultStubLabelMode).toBe("full");
  }, RELOAD_TIMEOUT);
});

// ─── #297 (same-room half) ────────────────────────────────────────

describe("a stub tag names the far room only when it's a different room (#297)", () => {
  it("leaves the room off when both devices are in the same room", () => {
    seedRun({ srcRoom: "room-hall", tgtRoom: "room-hall" });
    expect(tagText(SRC_TAG)).toBe("PROJECTOR [HDMI In 1]");
    expect(tagText(TGT_TAG)).toBe("MATRIX [HDMI Out 1]");
  });

  it("still names the room when the far device is in a different room", () => {
    seedRun({ srcRoom: "room-booth", tgtRoom: "room-hall" });
    expect(tagText(SRC_TAG)).toBe("PROJECTOR [HDMI In 1] (Main Hall)");
    expect(tagText(TGT_TAG)).toBe("MATRIX [HDMI Out 1] (Booth)");
  });

  it("still names the room when only the far device is in one", () => {
    seedRun({ tgtRoom: "room-hall" });
    expect(tagText(SRC_TAG)).toBe("PROJECTOR [HDMI In 1] (Main Hall)");
    // The far end of the other tag is on the bare canvas: no room to name either way.
    expect(tagText(TGT_TAG)).toBe("MATRIX [HDMI Out 1]");
  });

  it("prints the room anyway on a tag explicitly set to Show room: On", () => {
    seedRun({ srcRoom: "room-hall", tgtRoom: "room-hall" });
    useSchematicStore.getState().patchStubLabelData(SRC_TAG, { showRoom: true });
    expect(tagText(SRC_TAG)).toBe("PROJECTOR [HDMI In 1] (Main Hall)");
    // The partner keeps following the default.
    expect(tagText(TGT_TAG)).toBe("MATRIX [HDMI Out 1]");
  });

  it("keeps the room off everywhere when the global toggle is off", () => {
    useSchematicStore.getState().setStubLabelShowRoom(false);
    seedRun({ srcRoom: "room-booth", tgtRoom: "room-hall" });
    expect(tagText(SRC_TAG)).toBe("PROJECTOR [HDMI In 1]");
  });

  it("reports the same-room fact from the resolver", () => {
    seedRun({ srcRoom: "room-hall", tgtRoom: "room-hall" });
    const s = useSchematicStore.getState();
    const parts = resolveStubLabelParts(SRC_TAG, tagData(SRC_TAG), { nodes: s.nodes, edges: s.edges });
    expect(parts?.sameRoom).toBe(true);
    expect(parts?.farRoom).toBe("Main Hall");
  });
});

describe("same-room rule in the pure text builder (#297)", () => {
  const p = (over: Partial<StubLabelParts> = {}): StubLabelParts => ({
    arrow: "→", farLabel: "Projector", farPort: "", farRoom: "Main Hall",
    myPage: "", farPage: "", cableId: "HDMI-001", ...over,
  });
  const opts = { showArrow: false, showPort: false, showRoom: true, pageMode: "never" } as const;

  it("drops the room for a same-room run", () => {
    expect(buildStubLabelText(p({ sameRoom: true }), opts)).toBe("Projector");
  });

  it("keeps it when the parts don't say same-room (every older caller)", () => {
    expect(buildStubLabelText(p(), opts)).toBe("Projector (Main Hall)");
  });

  it("keeps it for a same-room run when the tag forces the room on", () => {
    expect(buildStubLabelText(p({ sameRoom: true }), { ...opts, roomInSameRoom: true }))
      .toBe("Projector (Main Hall)");
  });
});
