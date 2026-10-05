/**
 * Export Rack PDF honours the chosen paper size (#379).
 *
 * The rack export used to build every page on Letter regardless of the paper
 * picked in the print view. This drives the real `exportRackPdf` (fonts read from
 * public/, jsPDF's save intercepted) and checks the page size of the document it
 * would have downloaded.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { jsPDF } from "jspdf";
import { exportRackPdf } from "../rackPdf";
import { getPaperSize } from "../printConfig";
import type { RackElevationPage } from "../types";

const MM_PER_IN = 25.4;
// Every jsPDF the export builds lands here instead of downloading. `save` is an
// own property set per instance, so it is replaced in a constructor wrapper.
const saved: jsPDF[] = [];
vi.mock("jspdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jspdf")>();
  class CapturingJsPDF extends actual.jsPDF {
    constructor(...args: ConstructorParameters<typeof actual.jsPDF>) {
      super(...args);
      this.save = (() => { saved.push(this); return this; }) as unknown as typeof this.save;
    }
  }
  return { ...actual, jsPDF: CapturingJsPDF };
});
const realFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = (async (url: string) => {
    const buf = readFileSync(resolve(__dirname, "../../public", String(url).replace(/^\//, "")));
    return new Response(buf);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

const rackPage: RackElevationPage = {
  id: "rack-page-1",
  type: "rack-elevation",
  label: "Racks",
  // Two racks, so two sheets: every page must take the paper, not only the first.
  racks: [
    { id: "rack-1", label: "Rack A", rackType: "floor-19", heightU: 12, depthMm: 600, widthClass: "19in", position: { x: 0, y: 0 } },
    { id: "rack-2", label: "Rack B", rackType: "floor-19", heightU: 42, depthMm: 1000, widthClass: "19in", position: { x: 400, y: 0 } },
  ],
  placements: [],
  accessories: [],
};

async function exportWith(paperId: string, w?: number, h?: number) {
  saved.length = 0;
  await exportRackPdf({
    pages: [rackPage],
    nodes: [],
    schematicName: "Rack Test",
    paper: getPaperSize(paperId, w, h),
  });
  expect(saved).toHaveLength(1);
  const doc = saved[0];
  expect(doc.getNumberOfPages()).toBe(2);
  const sizes = [1, 2].map((n) => {
    const info = doc.getPageInfo(n).pageContext.mediaBox;
    // mediaBox is in PDF points; convert to mm.
    return { w: ((info.topRightX - info.bottomLeftX) / 72) * MM_PER_IN, h: ((info.topRightY - info.bottomLeftY) / 72) * MM_PER_IN };
  });
  expect(sizes[1].w).toBeCloseTo(sizes[0].w, 1);
  expect(sizes[1].h).toBeCloseTo(sizes[0].h, 1);
  return sizes[0];
}

describe("exportRackPdf paper size", () => {
  it("uses A4 when A4 is chosen (landscape)", async () => {
    const { w, h } = await exportWith("iso-a4");
    expect(w).toBeCloseTo(11.69 * MM_PER_IN, 0);
    expect(h).toBeCloseTo(8.27 * MM_PER_IN, 0);
  });

  it("uses a large-format sheet too, not just the four report sizes", async () => {
    const { w, h } = await exportWith("ansi-d");
    expect(w).toBeCloseTo(34 * MM_PER_IN, 0);
    expect(h).toBeCloseTo(22 * MM_PER_IN, 0);
  });

  it("uses custom dimensions", async () => {
    const { w, h } = await exportWith("custom", 12, 18);
    expect(w).toBeCloseTo(18 * MM_PER_IN, 0);
    expect(h).toBeCloseTo(12 * MM_PER_IN, 0);
  });

  it("still defaults to Letter when no paper is passed", async () => {
    saved.length = 0;
    await exportRackPdf({ pages: [rackPage], nodes: [], schematicName: "Rack Test" });
    const size = saved[0].internal.pageSize;
    expect(size.getWidth()).toBeCloseTo(11 * MM_PER_IN, 0);
    expect(size.getHeight()).toBeCloseTo(8.5 * MM_PER_IN, 0);
  });
});
