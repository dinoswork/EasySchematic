import { describe, it, expect } from "vitest";
import { capturedHeaderColorField, headerColorAfterRevert } from "../deviceHeaderColor";

const none = { presetHeaderColor: undefined, templateHeaderColor: undefined, projectDefault: undefined, appDefault: undefined };

describe("headerColorAfterRevert (#382)", () => {
  it("revert to template adopts the template's saved color, dropping a picked override", () => {
    expect(headerColorAfterRevert("template", { ...none, templateHeaderColor: "#112233" })).toBe("#112233");
  });

  it("revert to template ignores the project preset's color (the template is the target)", () => {
    expect(headerColorAfterRevert("template", { ...none, presetHeaderColor: "#aa0000", templateHeaderColor: "#112233" })).toBe("#112233");
  });

  it("revert to template with no saved color clears the override — nothing stored when no default applies", () => {
    expect(headerColorAfterRevert("template", none)).toBeUndefined();
  });

  it("revert to template with no saved color falls back to the defaults, project over app", () => {
    expect(headerColorAfterRevert("template", { ...none, appDefault: "#222222" })).toBe("#222222");
    expect(headerColorAfterRevert("template", { ...none, projectDefault: "#111111", appDefault: "#222222" })).toBe("#111111");
  });

  it("revert to preset adopts the preset's color, then the template's, then the defaults", () => {
    expect(headerColorAfterRevert("preset", { ...none, presetHeaderColor: "#aa0000", templateHeaderColor: "#112233" })).toBe("#aa0000");
    expect(headerColorAfterRevert("preset", { ...none, templateHeaderColor: "#112233", projectDefault: "#111111" })).toBe("#112233");
    expect(headerColorAfterRevert("preset", { ...none, projectDefault: "#111111" })).toBe("#111111");
    expect(headerColorAfterRevert("preset", none)).toBeUndefined();
  });

  it("falls through a junk saved color rather than stamping it", () => {
    expect(headerColorAfterRevert("template", { ...none, templateHeaderColor: "javascript:1", projectDefault: "#111111" })).toBe("#111111");
  });

  it("Revert then Save as Preset stores no header color when none was ever chosen", () => {
    // A device whose user picked #ff0000, reverted to a template with no color, under a project
    // default. The editor shows the stamped default and clears its "picker worked" flag.
    const projectDefault = "#00aa00";
    const afterRevert = headerColorAfterRevert("template", { ...none, projectDefault });
    expect(afterRevert).toBe("#00aa00");
    expect(capturedHeaderColorField({
      deviceHeaderColor: afterRevert,
      edited: false,
      savedHeaderColor: undefined,
      projectDefault,
      appDefault: undefined,
    })).toEqual({});
  });
});
