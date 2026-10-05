import { describe, it, expect } from "vitest";
import { buildBulkPorts } from "../portBulk";
import { bulkLabel, buildBulkSlots } from "../slotBulk";

const base = { direction: "input" as const, prefix: "Port", start: 1, count: 3, signalType: "ethernet" as const };

describe("buildBulkPorts (#245)", () => {
  it("applies the chosen connector, not the signal default", () => {
    const ports = buildBulkPorts({ ...base, connectorType: "sfp" }, (i) => `p${i}`);
    expect(ports.map((p) => p.connectorType)).toEqual(["sfp", "sfp", "sfp"]);
    expect(ports.map((p) => p.id)).toEqual(["p0", "p1", "p2"]);
  });

  it("spaces the number by default and omits the space on request", () => {
    expect(buildBulkPorts({ ...base, connectorType: "rj45" }, String).map((p) => p.label)).toEqual(["Port 1", "Port 2", "Port 3"]);
    expect(buildBulkPorts({ ...base, connectorType: "rj45", spaceBeforeNumber: false }, String).map((p) => p.label)).toEqual(["Port1", "Port2", "Port3"]);
  });

  it("carries section, and leaves it undefined when blank", () => {
    expect(buildBulkPorts({ ...base, connectorType: "rj45", section: "Front" }, String)[0].section).toBe("Front");
    expect(buildBulkPorts({ ...base, connectorType: "rj45", section: "" }, String)[0].section).toBeUndefined();
  });
});

describe("bulkLabel", () => {
  it("formats with and without the space", () => {
    expect(bulkLabel("Slot", 4)).toBe("Slot 4");
    expect(bulkLabel("Slot", 4, false)).toBe("Slot4");
  });
  it("leaves slot bulk naming unchanged", () => {
    expect(buildBulkSlots("Slot", 1, 2, "f").map((s) => s.label)).toEqual(["Slot 1", "Slot 2"]);
  });
});
