/**
 * Default header color for newly placed devices (#354).
 *
 * Four levels, resolved in this order:
 *   1. the project preset's saved color — set by Save as Preset on a device of this template
 *   2. the template's own saved color — set by Save as User Template / Update User Template /
 *      Update as Custom, and stored with the template
 *   3. the project override — `SchematicFile.defaultDeviceHeaderColor`, travels with the file
 *   4. the app preference — localStorage, applies to every project on this machine
 *   5. none of them, which leaves the device with no `headerColor` at all so DeviceNode keeps
 *      painting the theme's `--color-surface` the way it always has
 *
 * A color saved onto a template or a preset is a deliberate statement about *that* device, so
 * it outranks both defaults, which only say what an unopinionated device should look like.
 *
 * The resolved color is *stamped* onto each device as it is created rather than consulted
 * at paint time, so changing any of these never recolors devices already on the canvas.
 */

/** App-level preference — an editor preference, not document data. */
export const DEFAULT_DEVICE_HEADER_COLOR_KEY = "easyschematic-default-header-color";

/** Swatch a header-color picker shows when nothing is set. Matches the neutral gray the
 *  device editor's picker has always opened on. */
export const HEADER_COLOR_SWATCH_FALLBACK = "#4b5563";

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Narrow an untrusted value (a loaded schematic file, a localStorage string) to a CSS hex
 * color, lowercased and always in the 6-digit `#rrggbb` form — `<input type="color">`
 * rejects the 3-digit shorthand and would show black instead. Anything else — a token, a
 * `javascript:` string, a number — resolves to undefined and falls through to the next
 * level of the precedence chain.
 */
export function normalizeHeaderColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toLowerCase();
  if (!HEX_COLOR.test(trimmed)) return undefined;
  if (trimmed.length === 4) {
    const [, r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return trimmed;
}

/** Project override beats app preference beats the built-in surface color (undefined). */
export function resolveDefaultDeviceHeaderColor(
  projectDefault: string | undefined,
  appDefault: string | undefined,
): string | undefined {
  return normalizeHeaderColor(projectDefault) ?? normalizeHeaderColor(appDefault);
}

/**
 * The header color a device placed from this template gets: the project preset's saved color
 * first, then the template's own saved color, then the two default settings. Every level is
 * normalized here, so a junk value stored in a preset, a template, a file, or localStorage
 * simply falls through to the next one instead of reaching a device.
 */
export function resolveDeviceHeaderColor(
  presetHeaderColor: string | undefined,
  templateHeaderColor: string | undefined,
  projectDefault: string | undefined,
  appDefault: string | undefined,
): string | undefined {
  return (
    normalizeHeaderColor(presetHeaderColor) ??
    normalizeHeaderColor(templateHeaderColor) ??
    resolveDefaultDeviceHeaderColor(projectDefault, appDefault)
  );
}

/**
 * The header color a device wears after "Revert to Template" or "Revert to Preset" (#382).
 *
 * A revert is a reset to what a freshly placed device would look like, so it resolves the same
 * precedence placement does — and the header color the user picked on the device is dropped,
 * not carried over. Reverting to a *template* skips the project preset (the template is the
 * target, the way the body color is taken straight from it); reverting to a *preset* uses the
 * preset's color first. If nothing saved supplies one, the result is the default settings'
 * color, or undefined when there are none, leaving the device with no stored color.
 *
 * The editor pairs this with clearing its "picker worked" flag, so a later save sees an
 * inherited color rather than a deliberate one and the capture rule above does not bake the
 * default into a template or preset.
 */
export function headerColorAfterRevert(
  target: "template" | "preset",
  sources: {
    presetHeaderColor: string | undefined;
    templateHeaderColor: string | undefined;
    projectDefault: string | undefined;
    appDefault: string | undefined;
  },
): string | undefined {
  return resolveDeviceHeaderColor(
    target === "preset" ? sources.presetHeaderColor : undefined,
    sources.templateHeaderColor,
    sources.projectDefault,
    sources.appDefault,
  );
}

/** What the device editor knows about the header color it is about to save. */
export interface HeaderColorCapture {
  /** The header color the editor is showing for this device. */
  deviceHeaderColor: string | undefined;
  /** True once the user has worked the editor's header-color picker themselves this session. */
  edited: boolean;
  /** The header color the template or preset being written already carried, if any. */
  savedHeaderColor: string | undefined;
  /** `SchematicFile.defaultDeviceHeaderColor` — the project override. */
  projectDefault: string | undefined;
  /** The app preference, from localStorage. */
  appDefault: string | undefined;
}

/**
 * The `headerColor` field a template or a preset saved from a device carries. Spread into the
 * object being saved.
 *
 * Only a color this device actually *has* — as against one it merely inherited — is captured.
 * Since #354 every device is stamped with the resolved default header color the moment it is
 * placed, so "the device is showing #8b1a1a" is not on its own evidence that anybody chose
 * #8b1a1a for it. Baking an inherited default into a template or a preset would quietly put
 * that template beyond the reach of the very settings the color came from: the project
 * override would stop working for it, with nothing on screen to say why.
 *
 * So a color is captured when the user picked it here, when the template or preset being
 * written already carried one (an update must not silently erase it), or when it is a color no
 * default explains. A device carrying nothing but the resolved default saves a template with
 * no header color at all — absent stays absent, and such a template leaves the default
 * settings in charge exactly as before (#354).
 */
export function capturedHeaderColorField(capture: HeaderColorCapture): { headerColor?: string } {
  const current = normalizeHeaderColor(capture.deviceHeaderColor);
  const saved = normalizeHeaderColor(capture.savedHeaderColor);

  // The user worked the picker: whatever is in it now is the statement, including clearing it.
  if (capture.edited) return current ? { headerColor: current } : {};

  // Untouched and colorless — keep whatever the template or preset already said.
  if (!current) return saved ? { headerColor: saved } : {};

  // Untouched over a template/preset that already carried a color: the device is showing a
  // saved color, not an inherited default, so keep it saved.
  if (saved) return { headerColor: current };

  // Untouched, nothing saved before: capture only if no default accounts for the color.
  const inherited = resolveDefaultDeviceHeaderColor(capture.projectDefault, capture.appDefault);
  return current === inherited ? {} : { headerColor: current };
}

export function loadAppDefaultHeaderColor(): string | undefined {
  try {
    return normalizeHeaderColor(localStorage.getItem(DEFAULT_DEVICE_HEADER_COLOR_KEY));
  } catch {
    return undefined;
  }
}

export function saveAppDefaultHeaderColor(color: string | undefined): void {
  try {
    const normalized = normalizeHeaderColor(color);
    if (normalized) localStorage.setItem(DEFAULT_DEVICE_HEADER_COLOR_KEY, normalized);
    else localStorage.removeItem(DEFAULT_DEVICE_HEADER_COLOR_KEY);
  } catch {
    // Storage full or unavailable — the in-memory choice still applies this session.
  }
}
