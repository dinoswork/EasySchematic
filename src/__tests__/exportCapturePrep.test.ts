import { describe, it, expect } from "vitest";
import { scrubXmlIllegalChars, describeExportError } from "../exportCapturePrep";

describe("scrubXmlIllegalChars", () => {
  it("replaces XML-illegal C0 controls (Excel line break = vertical tab) with spaces", () => {
    expect(scrubXmlIllegalChars("Fiber TX\u000bLC")).toBe("Fiber TX LC");
    expect(scrubXmlIllegalChars("a\u0000b\u000cc\u001fd")).toBe("a b c d");
  });
  it("keeps tab, LF, CR, emoji and normal unicode", () => {
    const s = "Rack\t1\nRow\r2 — 🎛️ Café";
    expect(scrubXmlIllegalChars(s)).toBe(s);
  });
  it("replaces lone surrogates (encodeURIComponent throws on them)", () => {
    const s = scrubXmlIllegalChars("x\ud83dy\ude00z");
    expect(s).toBe("x y z");
    expect(() => encodeURIComponent(s)).not.toThrow();
  });
});

describe("describeExportError", () => {
  it("uses Error messages, explains Events, never says just 'unexpected' for a string", () => {
    expect(describeExportError(new Error("boom"))).toBe("boom");
    expect(describeExportError(new Event("error"))).toMatch(/couldn't render/);
    expect(describeExportError("bad")).toBe("bad");
    expect(describeExportError(undefined)).toBe("unexpected error");
  });
});
