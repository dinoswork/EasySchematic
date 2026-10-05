/**
 * An auto-inserted adapter must not land on top of an existing device (#363).
 *
 * The old placement walked the device list once, only ever moved along X, and never
 * re-checked a device it had already passed. Two failures fell out of that:
 *
 *  1. the #310 repro — Core Switch → USB Hub with the reversed USB dongle inserted —
 *     put the adapter at room-relative (352, 272) right over the USB Hub at (304, 320),
 *     because a flat 48px height guess for the adapter made the vertical overlap test
 *     miss the hub's header and first port row entirely;
 *  2. a crowded row, where pushing clear of one neighbour drops the adapter onto the
 *     next one — already checked, so never looked at again.
 *
 * Two more come from the same filter the old loop used — only devices sharing the
 * adapter's parent counted as obstacles:
 *
 *  3. on a cross-room drag the adapter has no parent at all, so nothing in any room
 *     was an obstacle and the adapter dropped straight onto whatever sat at the
 *     midpoint;
 *  4. searching on both axes can walk a room-parented adapter clean out of its own
 *     room, which the next reparent pass then acts on — silently refiling it under a
 *     different room in the room-grouped reports.
 *
 * All four are pinned here: at the helper level against the exact geometry, and
 * through the store so the wiring (heights, parent frame, room bounds, grid snap) is
 * covered too.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { findFreeAdapterSlot, ADAPTER_GAP, DEVICE_W_EST, type PlacementBox } from "../adapterPlacement";
import { GRID_SIZE } from "../gridConstants";
import { STUB_W_EST, STUB_H_EST } from "../stubPlacement";
import { DEVICE_TEMPLATES } from "../deviceLibrary";
import type { DeviceData, Port, SchematicNode } from "../types";

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
});

/** The clearance the placement promises: gap.x across, gap.y above and below. */
function clearOf(slot: { x: number; y: number }, size: { w: number; h: number }, o: PlacementBox) {
  const overlapX = slot.x - ADAPTER_GAP.x < o.x + o.w && slot.x + size.w + ADAPTER_GAP.x > o.x;
  const overlapY = slot.y - ADAPTER_GAP.y < o.y + o.h && slot.y + size.h + ADAPTER_GAP.y > o.y;
  return !(overlapX && overlapY);
}

function expectClearOfAll(
  slot: { x: number; y: number },
  size: { w: number; h: number },
  obstacles: PlacementBox[],
) {
  for (const [i, o] of obstacles.entries()) {
    expect(
      clearOf(slot, size, o),
      `slot (${slot.x}, ${slot.y}) overlaps device ${i} at (${o.x}, ${o.y}) ${o.w}×${o.h}`,
    ).toBe(true);
  }
  expect(Math.abs(slot.x % GRID_SIZE), `slot x ${slot.x} is off the grid`).toBe(0);
  expect(Math.abs(slot.y % GRID_SIZE), `slot y ${slot.y} is off the grid`).toBe(0);
}

describe("findFreeAdapterSlot (#363)", () => {
  // The dongle the #310 repro inserts: two ports, one per side, so 48 + one 16px row.
  const ADAPTER = { w: DEVICE_W_EST, h: 64 };

  it("leaves an already-free midpoint exactly where it is", () => {
    const obstacles: PlacementBox[] = [{ x: 0, y: 0, w: 144, h: 96 }];
    expect(findFreeAdapterSlot({ x: 640, y: 320 }, ADAPTER, obstacles)).toEqual({ x: 640, y: 320 });
  });

  it("clears the USB Hub in the #310 repro geometry", () => {
    // Naive midpoint (352, 272) against the hub at (304, 320) — the exact overlap the
    // deep review screenshotted, header and first port row occluded.
    const hub: PlacementBox = { x: 304, y: 320, w: 144, h: 96 };
    const sw: PlacementBox = { x: 256, y: 176, w: 144, h: 96 };
    const slot = findFreeAdapterSlot({ x: 352, y: 272 }, ADAPTER, [sw, hub]);
    expectClearOfAll(slot, ADAPTER, [sw, hub]);
  });

  it("finds a slot in a row that defeats a single X-only pass", () => {
    // Three devices in a row, each gap too narrow for the adapter plus its clearance.
    // Pushing right off the first lands on the second, pushing right off that lands on
    // the third — the old loop, having already checked those, stopped there.
    const row: PlacementBox[] = [
      { x: 0, y: 300, w: 144, h: 96 },
      { x: 224, y: 300, w: 144, h: 96 },
      { x: 448, y: 300, w: 144, h: 96 },
    ];
    const slot = findFreeAdapterSlot({ x: 288, y: 320 }, ADAPTER, row);
    expectClearOfAll(slot, ADAPTER, row);
  });

  it("reproduces the single-pass failure the row case is built to expose", () => {
    // Guards the fixture itself: the naive push-off-the-first-overlap answer really is
    // still on top of a neighbour, so the case above isn't passing by accident.
    const row: PlacementBox[] = [
      { x: 0, y: 300, w: 144, h: 96 },
      { x: 224, y: 300, w: 144, h: 96 },
      { x: 448, y: 300, w: 144, h: 96 },
    ];
    const naivePush = { x: row[0].x + row[0].w + ADAPTER_GAP.x, y: 320 }; // 224
    expect(clearOf(naivePush, ADAPTER, row[1])).toBe(false);
  });

  it("escapes a pocket that is boxed in on both sides by moving off the row", () => {
    // Devices left, right, and directly above the midpoint: no X-only answer exists
    // near the cable at all, so the search has to give ground on Y.
    const boxed: PlacementBox[] = [
      { x: 100, y: 300, w: 144, h: 96 },
      { x: 380, y: 300, w: 144, h: 96 },
      { x: 240, y: 180, w: 144, h: 96 },
    ];
    const slot = findFreeAdapterSlot({ x: 288, y: 320 }, ADAPTER, boxed);
    expectClearOfAll(slot, ADAPTER, boxed);
  });

  it("still places clear in a dense grid of devices", () => {
    // 8×6 lattice at a pitch that leaves no free slot anywhere inside it — the answer
    // has to come from outside the block, and it still has to be a real one.
    const grid: PlacementBox[] = [];
    for (let c = 0; c < 8; c++) {
      for (let r = 0; r < 6; r++) grid.push({ x: c * 208, y: r * 128, w: 144, h: 96 });
    }
    const slot = findFreeAdapterSlot({ x: 624, y: 256 }, { w: DEVICE_W_EST, h: 96 }, grid);
    expectClearOfAll(slot, { w: DEVICE_W_EST, h: 96 }, grid);
  });

  it("picks the nearest free slot, not merely a free one", () => {
    // One device covering the midpoint and nothing else, with the midpoint sitting
    // low in it so dropping below is the shorter hop: the answer should be exactly
    // 32px of clearance under its bottom edge, not the 144px climb over its top.
    const only: PlacementBox = { x: 240, y: 240, w: 144, h: 96 };
    const slot = findFreeAdapterSlot({ x: 256, y: 288 }, ADAPTER, [only]);
    expectClearOfAll(slot, ADAPTER, [only]);
    expect(slot).toEqual({ x: 256, y: 240 + 96 + ADAPTER_GAP.y });
  });

  it("takes a slot inside the parent room over a nearer one outside it", () => {
    // Two full-width rows near the top of a room. Hopping up over the first row is the
    // shorter move (128px) but puts the adapter above the room's own top edge; dropping
    // below the second (192px) keeps it in the room, which is what has to win — room
    // membership is geometric, so an adapter outside its room gets detached from it.
    const rows: PlacementBox[] = [];
    for (const y of [32, 160]) for (const x of [0, 224, 448, 672]) rows.push({ x, y, w: 144, h: 64 });
    const room: PlacementBox = { x: 0, y: 0, w: 784, h: 688 };

    expect(findFreeAdapterSlot({ x: 320, y: 64 }, ADAPTER, rows, ADAPTER_GAP, room))
      .toEqual({ x: 320, y: 256 });
    expectClearOfAll({ x: 320, y: 256 }, ADAPTER, rows);
    // Same schematic with no room to respect takes the nearer slot, which is the one
    // 64px above the room's top edge — so the case above is really testing the bounds.
    expect(findFreeAdapterSlot({ x: 320, y: 64 }, ADAPTER, rows)).toEqual({ x: 320, y: -64 });
  });

  it("leaves the room when the room has no free slot left", () => {
    // Five rows packed at a pitch that fits nothing between them: staying inside is a
    // preference, not a constraint that can strand the search. The answer still has to
    // be clear of every device, and it keeps the adapter's centre in the room so the
    // room membership survives.
    const rows: PlacementBox[] = [];
    for (const y of [32, 160, 288, 416, 544]) for (const x of [0, 224, 448, 672]) rows.push({ x, y, w: 144, h: 64 });
    const room: PlacementBox = { x: 0, y: 0, w: 784, h: 688 };

    const slot = findFreeAdapterSlot({ x: 320, y: 64 }, ADAPTER, rows, ADAPTER_GAP, room);
    expectClearOfAll(slot, ADAPTER, rows);
    expect(slot.y + ADAPTER.h, "no slot fits wholly inside a packed room").toBeGreaterThan(room.h);
    const centre = { x: slot.x + ADAPTER.w / 2, y: slot.y + ADAPTER.h / 2 };
    expect(centre.x).toBeGreaterThanOrEqual(room.x);
    expect(centre.x).toBeLessThanOrEqual(room.x + room.w);
    expect(centre.y).toBeGreaterThanOrEqual(room.y);
    expect(centre.y).toBeLessThanOrEqual(room.y + room.h);
  });

  it("returns the same slot for the same schematic every time", () => {
    const obstacles: PlacementBox[] = [
      { x: 0, y: 0, w: 144, h: 96 },
      { x: 208, y: 0, w: 144, h: 96 },
      { x: 104, y: 128, w: 144, h: 96 },
    ];
    const first = findFreeAdapterSlot({ x: 128, y: 48 }, ADAPTER, obstacles);
    for (let i = 0; i < 5; i++) {
      expect(findFreeAdapterSlot({ x: 128, y: 48 }, ADAPTER, [...obstacles].reverse())).toEqual(first);
    }
  });
});

const USB_ETH_ADAPTER = "USB-A (M) → RJ45 (F) Adapter";
const SWITCH_PORT: Port = { id: "sw-p3", label: "Port 3", signalType: "ethernet", direction: "bidirectional", connectorType: "rj45" };
const HUB_IN: Port = { id: "hub-in", label: "USB-A In", signalType: "usb", direction: "input", connectorType: "usb-a" };
const HUB_OUT: Port = { id: "hub-out", label: "USB-A Out", signalType: "usb", direction: "output", connectorType: "usb-a" };

function deviceNode(id: string, label: string, ports: Port[], x: number, y: number): SchematicNode {
  return {
    id,
    type: "device",
    position: { x, y },
    data: { label, deviceType: "generic", ports },
  } as SchematicNode;
}

/** A room sized the way the fixture's are — both `style` and `measured` carry the box,
 *  because the store's room-membership check reads them in that order. */
function roomNode(id: string, label: string, x: number, y: number, w: number, h: number): SchematicNode {
  return {
    id,
    type: "room",
    position: { x, y },
    data: { label },
    style: { width: w, height: h },
    measured: { width: w, height: h },
  } as unknown as SchematicNode;
}

describe("insertAdapterBetween placement (#363)", () => {
  beforeEach(() => {
    useSchematicStore.setState({ nodes: [], edges: [], pendingIncompatibleConnection: null });
  });

  /** Rough footprint of a placed device, the same way the store estimates it. */
  function boxOf(n: SchematicNode): PlacementBox {
    const ports = (n.data as DeviceData).ports ?? [];
    const left = ports.filter((p) => p.direction === "input").length;
    const right = ports.filter((p) => p.direction === "output").length;
    const bidirs = ports.filter((p) => p.direction === "bidirectional").length;
    return { x: n.position.x, y: n.position.y, w: 144, h: 48 + (Math.max(left, right) + bidirs) * 16 };
  }

  it("does not drop the auto-inserted adapter onto the USB Hub", () => {
    // Positions chosen so the midpoint the store computes is exactly the (352, 272)
    // the deep review saw, with the hub at (304, 320).
    useSchematicStore.setState({
      nodes: [
        deviceNode("n1", "Core Switch", [SWITCH_PORT], 256, 176),
        deviceNode("n2", "USB Hub", [HUB_IN, HUB_OUT], 304, 320),
      ],
      edges: [],
      pendingIncompatibleConnection: null,
    });
    useSchematicStore.getState().onConnect({
      source: "n1", sourceHandle: "sw-p3-out", target: "n2", targetHandle: "hub-in",
    });

    const { nodes } = useSchematicStore.getState();
    const adapter = nodes.find((n) => (n.data as { label?: string }).label === USB_ETH_ADAPTER);
    expect(adapter, "the reversed USB adapter should have been inserted").toBeDefined();

    const others = nodes.filter((n) => n.type === "device" && n.id !== adapter!.id).map(boxOf);
    expectClearOfAll(adapter!.position, boxOf(adapter!), others);
  });

  it("keeps the adapter near the cable it serves", () => {
    useSchematicStore.setState({
      nodes: [
        deviceNode("n1", "Core Switch", [SWITCH_PORT], 256, 176),
        deviceNode("n2", "USB Hub", [HUB_IN, HUB_OUT], 304, 320),
      ],
      edges: [],
      pendingIncompatibleConnection: null,
    });
    useSchematicStore.getState().onConnect({
      source: "n1", sourceHandle: "sw-p3-out", target: "n2", targetHandle: "hub-in",
    });
    const adapter = useSchematicStore.getState().nodes
      .find((n) => (n.data as { label?: string }).label === USB_ETH_ADAPTER)!;
    // Both devices are one port row tall (64px), so their centres are (328, 208) and
    // (376, 352) and the midpoint snaps to (352, 288). Clearing the hub is a short hop
    // straight down its own column — one grid step past the hub's bottom edge — not a
    // flight across the page, so the legs read as a cable and not a detour. Pinned
    // exactly: a bound loose enough to admit the backstop column is no assertion at all.
    expect(adapter.position).toEqual({ x: 352, y: 320 + 64 + ADAPTER_GAP.y });
    expect(adapter.position.x).toBe(352); // unmoved on the cable's own axis
  });

  it("clears every device when the midpoint sits inside a crowded row", () => {
    // Switch and hub far apart with three unrelated devices parked along the midpoint,
    // spaced so no single X push finds daylight.
    useSchematicStore.setState({
      nodes: [
        deviceNode("n1", "Core Switch", [SWITCH_PORT], 0, 320),
        deviceNode("n2", "USB Hub", [HUB_IN, HUB_OUT], 800, 320),
        deviceNode("f1", "Filler A", [{ ...SWITCH_PORT, id: "f1-p1" }], 288, 304),
        deviceNode("f2", "Filler B", [{ ...SWITCH_PORT, id: "f2-p1" }], 512, 304),
        deviceNode("f3", "Filler C", [{ ...SWITCH_PORT, id: "f3-p1" }], 288, 176),
      ],
      edges: [],
      pendingIncompatibleConnection: null,
    });
    useSchematicStore.getState().onConnect({
      source: "n1", sourceHandle: "sw-p3-out", target: "n2", targetHandle: "hub-in",
    });

    const { nodes } = useSchematicStore.getState();
    const adapter = nodes.find((n) => (n.data as { label?: string }).label === USB_ETH_ADAPTER);
    expect(adapter).toBeDefined();
    const others = nodes.filter((n) => n.type === "device" && n.id !== adapter!.id).map(boxOf);
    expectClearOfAll(adapter!.position, boxOf(adapter!), others);
    // Centres are (72, 352) and (872, 352), so the midpoint snaps to (480, 352) and the
    // answer is the row 32px under the fillers — still on the cable, one hop down.
    expect(adapter!.position).toEqual({ x: 480, y: 304 + 64 + ADAPTER_GAP.y });
  });

  it("places inside the room, clear of that room's devices, when both ends share one", () => {
    // Parented devices carry room-relative positions; the slot search has to stay in
    // that frame. The decoy sits at the same room-relative coordinates in a room 2000px
    // away, so it must not perturb the answer — it is a genuinely distant device now
    // rather than one hidden from the search by a parent filter.
    useSchematicStore.setState({
      nodes: [
        roomNode("r1", "AV Rack Room", 1000, 400, 784, 688),
        roomNode("r2", "Boardroom", 3000, 400, 784, 688),
        { ...deviceNode("n1", "Core Switch", [SWITCH_PORT], 256, 176), parentId: "r1" } as SchematicNode,
        { ...deviceNode("n2", "USB Hub", [HUB_IN, HUB_OUT], 304, 320), parentId: "r1" } as SchematicNode,
        { ...deviceNode("n3", "Decoy", [{ ...SWITCH_PORT, id: "d-p1" }], 352, 272), parentId: "r2" } as SchematicNode,
      ],
      edges: [],
      pendingIncompatibleConnection: null,
    });
    useSchematicStore.getState().onConnect({
      source: "n1", sourceHandle: "sw-p3-out", target: "n2", targetHandle: "hub-in",
    });

    const { nodes } = useSchematicStore.getState();
    const adapter = nodes.find((n) => (n.data as { label?: string }).label === USB_ETH_ADAPTER);
    expect(adapter).toBeDefined();
    expect(adapter!.parentId).toBe("r1");
    const roommates = nodes
      .filter((n) => n.type === "device" && n.parentId === "r1" && n.id !== adapter!.id)
      .map(boxOf);
    expectClearOfAll(adapter!.position, boxOf(adapter!), roommates);
  });

  it("leaves an empty midpoint alone — devices far from the cable don't move it", () => {
    useSchematicStore.setState({
      nodes: [
        deviceNode("n1", "Core Switch", [SWITCH_PORT], 0, 320),
        deviceNode("n2", "USB Hub", [HUB_IN, HUB_OUT], 800, 320),
        deviceNode("f1", "Filler A", [{ ...SWITCH_PORT, id: "f1-p1" }], 0, 1600),
      ],
      edges: [],
      pendingIncompatibleConnection: null,
    });
    useSchematicStore.getState().onConnect({
      source: "n1", sourceHandle: "sw-p3-out", target: "n2", targetHandle: "hub-in",
    });
    const adapter = useSchematicStore.getState().nodes
      .find((n) => (n.data as { label?: string }).label === USB_ETH_ADAPTER)!;
    // Centres are (72, 352) and (872, 352), so the midpoint snaps to (480, 352) — and
    // with nothing near it, that is exactly where the adapter stays.
    expect(adapter.position).toEqual({ x: 480, y: 352 });
    expect(adapter.position.x % GRID_SIZE).toBe(0);
  });

  it("sees devices in other rooms when the cable crosses between rooms", () => {
    // The fixture's three rooms, with a patch panel in the middle one directly under
    // the midpoint of a main-Hall → TECH TABLE cable. The adapter is unparented here,
    // because the two endpoints don't share a room — so a search that only looks at
    // devices sharing the adapter's parent sees nothing at all and drops it on PP-01,
    // which is the screenshot on #363.
    useSchematicStore.setState({
      nodes: [
        roomNode("room-1", "main Hall", 0, 0, 784, 608),
        roomNode("room-2", "BOH Rack Room", 912, 0, 784, 688),
        roomNode("room-3", "TECH TABLE", 1824, 0, 512, 576),
        { ...deviceNode("n1", "Core Switch", [SWITCH_PORT], 32, 96), parentId: "room-1" } as SchematicNode,
        { ...deviceNode("n2", "USB Hub", [HUB_IN, HUB_OUT], 32, 96), parentId: "room-3" } as SchematicNode,
        {
          ...deviceNode("pp", "PP-01", [
            { ...SWITCH_PORT, id: "pp-p1" },
            { ...SWITCH_PORT, id: "pp-p2" },
            { ...SWITCH_PORT, id: "pp-p3" },
          ], 32, 96),
          parentId: "room-2",
        } as SchematicNode,
      ],
      edges: [],
      pendingIncompatibleConnection: null,
    });
    useSchematicStore.getState().onConnect({
      source: "n1", sourceHandle: "sw-p3-out", target: "n2", targetHandle: "hub-in",
    });

    const { nodes } = useSchematicStore.getState();
    const adapter = nodes.find((n) => (n.data as { label?: string }).label === USB_ETH_ADAPTER);
    expect(adapter).toBeDefined();
    expect(adapter!.parentId, "endpoints in different rooms leave the adapter unparented").toBeUndefined();

    // PP-01's absolute box is (944, 96) 144×96 — three port rows. The naive midpoint
    // is (1024, 128), squarely on its header and first port row; the adapter has to
    // end up clear of it in absolute space.
    const pp = nodes.find((n) => n.id === "pp")!;
    const ppAbs: PlacementBox = { ...boxOf(pp), x: 912 + pp.position.x, y: 0 + pp.position.y };
    expect(ppAbs).toEqual({ x: 944, y: 96, w: 144, h: 96 });
    expectClearOfAll(adapter!.position, boxOf(adapter!), [ppAbs]);
    expect(adapter!.position).toEqual({ x: 1024, y: 96 + 96 + ADAPTER_GAP.y });
  });

  it("keeps a room-parented adapter inside its own room", () => {
    // Two rows near the top of the rack room. Hopping up over the first row is the
    // shorter move but lands 64px above the room's own top edge — and because room
    // membership is geometric, the next reparent pass would then detach the adapter
    // and refile it in the room-grouped reports. It has to drop below the second row
    // instead and stay in the room it claims.
    const room = { x: 912, y: 0, w: 784, h: 688 };
    const nodes: SchematicNode[] = [
      roomNode("room-2", "BOH Rack Room", room.x, room.y, room.w, room.h),
      { ...deviceNode("n1", "Core Switch", [SWITCH_PORT], 0, 32), parentId: "room-2" } as SchematicNode,
      { ...deviceNode("f1", "Filler A", [{ ...SWITCH_PORT, id: "f1-p1" }], 224, 32), parentId: "room-2" } as SchematicNode,
      { ...deviceNode("n2", "USB Hub", [HUB_IN, HUB_OUT], 448, 32), parentId: "room-2" } as SchematicNode,
      { ...deviceNode("f2", "Filler B", [{ ...SWITCH_PORT, id: "f2-p1" }], 672, 32), parentId: "room-2" } as SchematicNode,
    ];
    for (const [i, x] of [0, 224, 448, 672].entries()) {
      nodes.push({
        ...deviceNode(`g${i}`, `Filler G${i}`, [{ ...SWITCH_PORT, id: `g${i}-p1` }], x, 160),
        parentId: "room-2",
      } as SchematicNode);
    }
    useSchematicStore.setState({ nodes, edges: [], pendingIncompatibleConnection: null });
    useSchematicStore.getState().onConnect({
      source: "n1", sourceHandle: "sw-p3-out", target: "n2", targetHandle: "hub-in",
    });

    const placed = useSchematicStore.getState().nodes;
    const adapter = placed.find((n) => (n.data as { label?: string }).label === USB_ETH_ADAPTER);
    expect(adapter).toBeDefined();
    expect(adapter!.parentId).toBe("room-2");

    const box = boxOf(adapter!);
    expect(adapter!.position).toEqual({ x: 304, y: 160 + 64 + ADAPTER_GAP.y });
    // Room-relative, so the room's own box is (0, 0)–(784, 688).
    expect(adapter!.position.x, "adapter left of the room").toBeGreaterThanOrEqual(0);
    expect(adapter!.position.y, "adapter above the room").toBeGreaterThanOrEqual(0);
    expect(adapter!.position.x + box.w, "adapter right of the room").toBeLessThanOrEqual(room.w);
    expect(adapter!.position.y + box.h, "adapter below the room").toBeLessThanOrEqual(room.h);

    const roommates = placed
      .filter((n) => n.type === "device" && n.parentId === "room-2" && n.id !== adapter!.id)
      .map(boxOf);
    expectClearOfAll(adapter!.position, box, roommates);
  });
});

describe("insertAdapterBetween placement avoids stub tags (#371)", () => {
  beforeEach(() => {
    useSchematicStore.setState({ nodes: [], edges: [], pendingIncompatibleConnection: null });
  });

  /** Core Switch (0,320) -> USB Hub (800,320): the adapter's ideal slot is (480, 352),
   *  with nothing else near it — the "empty midpoint" geometry. */
  function dragWith(tag: SchematicNode) {
    useSchematicStore.setState({
      nodes: [
        deviceNode("n1", "Core Switch", [SWITCH_PORT], 0, 320),
        deviceNode("n2", "USB Hub", [HUB_IN, HUB_OUT], 800, 320),
        tag,
      ],
      edges: [],
      pendingIncompatibleConnection: null,
    });
    useSchematicStore.getState().onConnect({
      source: "n1", sourceHandle: "sw-p3-out", target: "n2", targetHandle: "hub-in",
    });
    return useSchematicStore.getState().nodes
      .find((n) => (n.data as { label?: string }).label === USB_ETH_ADAPTER)!;
  }

  // Tags are unmeasured here, so the store has to fall back to the shared tag estimate.
  const tagBox: PlacementBox = { x: 480, y: 352, w: STUB_W_EST, h: STUB_H_EST };
  const adapterSize = { w: DEVICE_W_EST, h: 64 };

  it("does not land on a stub tag sitting on the midpoint", () => {
    const adapter = dragWith({
      id: "tag1",
      type: "stub-label",
      position: { x: tagBox.x, y: tagBox.y },
      data: { signalType: "usb", linkedConnectionId: "c1", side: "source" },
    } as unknown as SchematicNode);
    expect(adapter).toBeDefined();
    expectClearOfAll(adapter.position, adapterSize, [tagBox]);
  });

  it("does not land on a text stub sitting on the midpoint", () => {
    const adapter = dragWith({
      id: "txt1",
      type: "text-stub",
      position: { x: tagBox.x, y: tagBox.y },
      data: { text: "Client LAN", signalType: "usb", anchorNodeId: "n1", anchorPortId: "sw-p3", side: "r" },
    } as unknown as SchematicNode);
    expect(adapter).toBeDefined();
    expectClearOfAll(adapter.position, adapterSize, [tagBox]);
  });

  it("uses a tag's measured size over the estimate", () => {
    // The estimate box (200..280) clears the midpoint at x=480; only the measured
    // 400-wide box (200..600) reaches it, so this fails if `measured` is ignored.
    const wide: PlacementBox = { x: 200, y: 352, w: 400, h: 14 };
    const adapter = dragWith({
      id: "tag2",
      type: "stub-label",
      position: { x: wide.x, y: wide.y },
      measured: { width: wide.w, height: wide.h },
      data: { signalType: "usb", linkedConnectionId: "c2", side: "source" },
    } as unknown as SchematicNode);
    expectClearOfAll(adapter.position, adapterSize, [wide]);
  });
});

// Sanity: the template the repro relies on is still in the bundled library, so a
// rename there fails loudly here rather than silently skipping the store cases.
it("the reversed USB dongle used by these cases is still bundled", () => {
  expect(DEVICE_TEMPLATES.some((t) => t.label === USB_ETH_ADAPTER)).toBe(true);
});
