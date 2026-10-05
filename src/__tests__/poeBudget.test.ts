// #252 — the PoE budget's LOAD only summed the per-port "PoE (W)" figure on the far end
// of each connection. A device whose draw was entered with the device-level "Powered by
// PoE" checkbox contributed nothing, and a stubbed PoE connection dead-ended at its stub
// label so its draw vanished from LOAD too.
//
// The rule now: each powered device's draw is counted once. A per-port figure wins, and
// the device-level figure is the fallback when none of the device's ports carry one. A
// device-level draw is charged to one PoE source only, preferring a mains-powered one, and
// not at all when the device's own power input is wired (#404: count it once, in the
// right place).

import { describe, it, expect } from "vitest";
import { computePoeBudget } from "../networkReport";
import type { ConnectionEdge, Port, SchematicNode } from "../types";

const device = (
  id: string,
  ports: Partial<Port>[],
  extra: Record<string, unknown> = {},
): SchematicNode =>
  ({
    id,
    type: "device",
    position: { x: 0, y: 0 },
    data: {
      label: id,
      deviceType: "custom",
      ports: ports.map((p, i) => ({
        id: `${id}-p${i}`,
        label: `Port ${i}`,
        signalType: "ethernet",
        direction: "bidirectional",
        connectorType: "rj45",
        ...p,
      })),
      ...extra,
    },
  } as unknown as SchematicNode);

const poeSwitch = (id: string, portCount: number, budgetW = 120): SchematicNode =>
  device(id, Array.from({ length: portCount }, () => ({})), { poeBudgetW: budgetW });

const netEdge = (id: string, source: string, sourceHandle: string, target: string, targetHandle: string): ConnectionEdge =>
  ({ id, source, target, sourceHandle, targetHandle, data: { signalType: "ethernet" } } as unknown as ConnectionEdge);

const stubNode = (id: string, link: string, side: "source" | "target"): SchematicNode =>
  ({
    id,
    type: "stub-label",
    position: { x: 0, y: 0 },
    data: { signalType: "ethernet", linkedConnectionId: link, side },
  } as unknown as SchematicNode);

/** A stubbed ethernet connection src → tgt: two legs ending at stub labels, one link id. */
const stubbed = (baseId: string, src: string, srcHandle: string, tgt: string, tgtHandle: string) => ({
  nodes: [stubNode(`stub-${baseId}-src`, baseId, "source"), stubNode(`stub-${baseId}-tgt`, baseId, "target")],
  edges: [
    { id: `${baseId}-src`, source: src, sourceHandle: srcHandle, target: `stub-${baseId}-src`, targetHandle: "l",
      data: { signalType: "ethernet", linkedConnectionId: baseId } },
    { id: `${baseId}-tgt`, source: `stub-${baseId}-tgt`, sourceHandle: "r", target: tgt, targetHandle: tgtHandle,
      data: { signalType: "ethernet", linkedConnectionId: baseId } },
  ] as unknown as ConnectionEdge[],
});

const loadOf = (nodes: SchematicNode[], edges: ConnectionEdge[], switchId = "sw") =>
  computePoeBudget(nodes, edges).find((r) => r.nodeId === switchId)!.loadW;

describe("computePoeBudget — device-level PoE draw (#252)", () => {
  it("counts the device-level draw when no port carries a PoE figure", () => {
    const nodes = [poeSwitch("sw", 1), device("cam", [{}], { poeDrawW: 12.5 })];
    const edges = [netEdge("e1", "sw", "sw-p0", "cam", "cam-p0")];
    expect(loadOf(nodes, edges)).toBe(12.5);
    const row = computePoeBudget(nodes, edges)[0];
    expect(row.remainingW).toBe(107.5);
  });

  it("counts the device-level draw once even with two connections to the same switch", () => {
    const nodes = [poeSwitch("sw", 2), device("ap", [{}, {}], { poeDrawW: 20 })];
    const edges = [
      netEdge("e1", "sw", "sw-p0", "ap", "ap-p0"),
      netEdge("e2", "sw", "sw-p1", "ap", "ap-p1"),
    ];
    expect(loadOf(nodes, edges)).toBe(20);
  });

  it("does not double count when both the device and a port carry a figure — the port wins", () => {
    const nodes = [poeSwitch("sw", 1), device("cam", [{ poeDrawW: 7 }], { poeDrawW: 12.5 })];
    const edges = [netEdge("e1", "sw", "sw-p0", "cam", "cam-p0")];
    expect(loadOf(nodes, edges)).toBe(7);
  });

  it("ignores the device-level figure once any port carries one, even an unconnected port", () => {
    // Port 0 goes to this switch with no figure; port 1 carries the real draw and is
    // fed elsewhere. Falling back to the device figure here would count the device twice.
    const nodes = [poeSwitch("sw", 1), device("cam", [{}, { poeDrawW: 7 }], { poeDrawW: 12.5 })];
    const edges = [netEdge("e1", "sw", "sw-p0", "cam", "cam-p0")];
    expect(loadOf(nodes, edges)).toBe(0);
  });

  it("charges a device-level draw to one PoE source, not to every switch it is cabled to", () => {
    // A Dante device with primary and secondary on two PoE switches is powered by one.
    const nodes = [poeSwitch("swA", 1), poeSwitch("swB", 1), device("mic", [{}, {}], { poeDrawW: 6 })];
    const edges = [
      netEdge("e1", "swA", "swA-p0", "mic", "mic-p0"),
      netEdge("e2", "swB", "swB-p0", "mic", "mic-p1"),
    ];
    const total = computePoeBudget(nodes, edges).reduce((s, r) => s + r.loadW, 0);
    expect(total).toBe(6);
  });

  it("bills a PoE-powered switch to its mains-powered upstream, not its downstream switch", () => {
    // core (mains) → sw2 (PoE-powered, 60 W) → sw3 (PoE-powered, 25 W). The sw2–sw3
    // connection is listed first, so connection order alone would bill sw2 to sw3.
    const nodes = [
      poeSwitch("core", 1, 370),
      device("sw2", [{}, {}], { poeBudgetW: 30, poeDrawW: 60 }),
      device("sw3", [{}], { poeBudgetW: 15, poeDrawW: 25 }),
    ];
    const edges = [
      netEdge("e2", "sw2", "sw2-p1", "sw3", "sw3-p0"),
      netEdge("e1", "core", "core-p0", "sw2", "sw2-p0"),
    ];
    expect(loadOf(nodes, edges, "core")).toBe(60);
    expect(loadOf(nodes, edges, "sw2")).toBe(25);
    expect(loadOf(nodes, edges, "sw3")).toBe(0);
    expect(computePoeBudget(nodes, edges).some((r) => r.overBudget)).toBe(false);
  });

  it("prefers a source with a wired power input over a PoE-powered one", () => {
    // swA is PoE-powered (no wired power input); swB has a device-level draw but its DC
    // input is wired to a PSU, so it is mains-fed. swA is listed first.
    const nodes = [
      device("swA", [{}, {}], { poeBudgetW: 30, poeDrawW: 20 }),
      device("swB", [{}, {}, { signalType: "power", direction: "input", connectorType: "barrel" }], { poeBudgetW: 30, poeDrawW: 20 }),
      device("psu", [{ signalType: "power", direction: "output", connectorType: "barrel" }]),
      device("mic", [{}, {}], { poeDrawW: 5 }),
    ];
    const edges = [
      netEdge("e1", "swA", "swA-p0", "mic", "mic-p0"),
      netEdge("e2", "swB", "swB-p0", "mic", "mic-p1"),
      { id: "pw", source: "psu", sourceHandle: "psu-p0", target: "swB", targetHandle: "swB-p2",
        data: { signalType: "power" } } as unknown as ConnectionEdge,
    ];
    expect(loadOf(nodes, edges, "swA")).toBe(0);
    expect(loadOf(nodes, edges, "swB")).toBe(5);
  });

  it("skips the device-level draw when the device's power input is wired to a supply", () => {
    // A BirdDog-style camera: PoE-capable, but here its DC barrel is fed by a PSU.
    const nodes = [
      poeSwitch("sw", 1),
      device("psu", [{ signalType: "power", direction: "output", connectorType: "barrel" }]),
      device("cam", [{}, { signalType: "power", direction: "input", connectorType: "barrel" }], { poeDrawW: 12 }),
    ];
    const edges = [
      netEdge("e1", "sw", "sw-p0", "cam", "cam-p0"),
      { id: "pw", source: "psu", sourceHandle: "psu-p0", target: "cam", targetHandle: "cam-p1",
        data: { signalType: "power" } } as unknown as ConnectionEdge,
    ];
    expect(loadOf(nodes, edges)).toBe(0);
    // An unwired power input doesn't count — the camera is on PoE.
    expect(loadOf(nodes, [edges[0]])).toBe(12);
  });

  it("still sums per-port draws across several devices alongside a device-level one", () => {
    const nodes = [
      poeSwitch("sw", 3),
      device("cam1", [{ poeDrawW: 10 }]),
      device("cam2", [{ poeDrawW: 15 }]),
      device("panel", [{}], { poeDrawW: 4 }),
    ];
    const edges = [
      netEdge("e1", "sw", "sw-p0", "cam1", "cam1-p0"),
      netEdge("e2", "sw", "sw-p1", "cam2", "cam2-p0"),
      netEdge("e3", "sw", "sw-p2", "panel", "panel-p0"),
    ];
    expect(loadOf(nodes, edges)).toBe(29);
  });
});

describe("computePoeBudget — stubbed connections (#252)", () => {
  it("counts a per-port draw across a stubbed connection", () => {
    const s = stubbed("e1", "sw", "sw-p0", "cam", "cam-p0");
    const nodes = [poeSwitch("sw", 1), device("cam", [{ poeDrawW: 25.5 }]), ...s.nodes];
    expect(loadOf(nodes, s.edges)).toBe(25.5);
  });

  it("counts a device-level draw across a stubbed connection, either direction", () => {
    const s = stubbed("e1", "cam", "cam-p0", "sw", "sw-p0");
    const nodes = [poeSwitch("sw", 1), device("cam", [{}], { poeDrawW: 9 }), ...s.nodes];
    expect(loadOf(nodes, s.edges)).toBe(9);
  });
});
