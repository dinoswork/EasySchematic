/**
 * Print view "Title Block" toggle (#388).
 *
 * Hiding the title block hands its band back to the drawing, so the page grid
 * must lay pages out with a title-block height of 0 on every surface that derives
 * the grid: the on-canvas page overlay, the page count, the PDF export and the
 * stub-label page lookup. They all read it through `printTitleBlockHeightIn`, so
 * pinning that plus the grid math pins them all.
 *
 * The setting is per file, so it also has to survive autosave, file save/open
 * and reset on New.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { computePageGrid, type NodeInfo } from "../printPageGrid";
import { getPaperSize, PAGE_MARGIN_IN, printTitleBlockHeightIn } from "../printConfig";
import { buildPrintPageLookup } from "../stubLabelResolve";
import { createDefaultLayout } from "../titleBlockLayout";
import { titleBlockBandInches } from "../continuationPill";
import type { SchematicNode } from "../types";

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key() { return null; }
  get length() { return this.m.size; }
}

const DPI = 96;
const letter = getPaperSize("letter");

describe("printTitleBlockHeightIn", () => {
  const layout = createDefaultLayout();

  it("is the layout's height when the title block is shown", () => {
    expect(printTitleBlockHeightIn(layout, true)).toBe(layout.heightIn);
  });

  it("is 0 when the title block is hidden, whatever the layout says", () => {
    expect(printTitleBlockHeightIn(layout, false)).toBe(0);
    expect(printTitleBlockHeightIn({ ...layout, heightIn: 2.5 }, false)).toBe(0);
  });

  it("yields no title block band when hidden, so no block is drawn and pills are not pushed off it", () => {
    expect(titleBlockBandInches(11, 8.5, layout.widthIn, printTitleBlockHeightIn(layout, false))).toBeNull();
    expect(titleBlockBandInches(11, 8.5, layout.widthIn, printTitleBlockHeightIn(layout, true))).not.toBeNull();
  });
});

describe("page grid with the title block hidden", () => {
  const layout = createDefaultLayout();

  it("gives the drawing the full page height minus margins", () => {
    const nodes: NodeInfo[] = [{ id: "a", position: { x: 100, y: 100 }, measured: { width: 100, height: 50 } }];
    const [shown] = computePageGrid(letter, "landscape", 1, nodes, printTitleBlockHeightIn(layout, true));
    const [hidden] = computePageGrid(letter, "landscape", 1, nodes, printTitleBlockHeightIn(layout, false));
    expect(hidden.contentH).toBeCloseTo((8.5 - 2 * PAGE_MARGIN_IN) * DPI);
    expect(hidden.contentH - shown.contentH).toBeCloseTo(layout.heightIn * DPI);
    // Width is untouched either way.
    expect(hidden.contentW).toBeCloseTo(shown.contentW);
  });

  it("counts a page whose only device sits where the title block was", () => {
    // Letter landscape at 100%: page row 0 spans y 0..816px. With the block shown its
    // drawing area stops at 38.4 + (816 - 76.8 - 96) = 681.6px, so a device at y 700
    // lands in the band and on no page's drawing area.
    const nodes: NodeInfo[] = [
      { id: "top", position: { x: 100, y: 100 }, measured: { width: 100, height: 50 } },
      { id: "band", position: { x: 1200, y: 700 }, measured: { width: 60, height: 40 } },
    ];
    const shown = computePageGrid(letter, "landscape", 1, nodes, printTitleBlockHeightIn(layout, true), 0, 0);
    const hidden = computePageGrid(letter, "landscape", 1, nodes, printTitleBlockHeightIn(layout, false), 0, 0);
    expect(shown).toHaveLength(1);
    expect(hidden).toHaveLength(2);
  });

  it("stub-label page numbers follow the toggle", () => {
    const nodes = [
      { id: "top", type: "device", position: { x: 100, y: 100 }, measured: { width: 100, height: 50 }, data: {} },
      { id: "band", type: "device", position: { x: 1200, y: 700 }, measured: { width: 60, height: 40 }, data: {} },
    ] as unknown as SchematicNode[];
    const base = {
      printView: true, printPaperId: "letter", printOrientation: "landscape" as const, printScale: 1,
      printOriginOffsetX: 0, printOriginOffsetY: 0, titleBlockLayout: layout, nodes,
    };
    // One page with the block shown, so no page numbers at all.
    expect(buildPrintPageLookup({ ...base, printTitleBlockEnabled: true })).toBeUndefined();
    const lookup = buildPrintPageLookup({ ...base, printTitleBlockEnabled: false });
    expect(lookup).toBeDefined();
    expect(lookup!(1220, 720)).toBe(2);
  });
});

describe("printTitleBlockEnabled persistence", () => {
  let useSchematicStore: typeof import("../store")["useSchematicStore"];

  beforeAll(async () => {
    (globalThis as { localStorage?: unknown }).localStorage = new MemStorage();
    if (!globalThis.crypto?.randomUUID) {
      (globalThis as { crypto?: unknown }).crypto = { randomUUID: () => "test-" + Math.random().toString(36).slice(2) };
    }
    ({ useSchematicStore } = await import("../store"));
  });

  it("defaults to shown", () => {
    useSchematicStore.getState().newSchematic();
    expect(useSchematicStore.getState().printTitleBlockEnabled).toBe(true);
  });

  it("round-trips through file save and open", () => {
    const s = useSchematicStore.getState();
    s.newSchematic();
    s.setPrintTitleBlockEnabled(false);
    const saved = useSchematicStore.getState().exportToJSON();
    expect(saved.printTitleBlockEnabled).toBe(false);

    useSchematicStore.getState().newSchematic();
    expect(useSchematicStore.getState().printTitleBlockEnabled).toBe(true);
    useSchematicStore.getState().importFromJSON(structuredClone(saved));
    expect(useSchematicStore.getState().printTitleBlockEnabled).toBe(false);
  });

  it("stays out of saved files at its default and opens old files as shown", () => {
    useSchematicStore.getState().newSchematic();
    const saved = useSchematicStore.getState().exportToJSON();
    expect(saved.printTitleBlockEnabled).toBeUndefined();
    useSchematicStore.setState({ printTitleBlockEnabled: false });
    useSchematicStore.getState().importFromJSON(structuredClone(saved));
    expect(useSchematicStore.getState().printTitleBlockEnabled).toBe(true);
  });

  it("survives autosave and reload", () => {
    const s = useSchematicStore.getState();
    s.newSchematic(); // arms autosave
    s.setPrintTitleBlockEnabled(false);
    useSchematicStore.setState({ printTitleBlockEnabled: true });
    expect(useSchematicStore.getState().loadFromLocalStorage()).toBe(true);
    expect(useSchematicStore.getState().printTitleBlockEnabled).toBe(false);
  });

  it("resets to shown on New", () => {
    useSchematicStore.getState().setPrintTitleBlockEnabled(false);
    useSchematicStore.getState().newSchematic();
    expect(useSchematicStore.getState().printTitleBlockEnabled).toBe(true);
  });
});
