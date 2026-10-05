/**
 * Default stub tag mode for newly stubbed connections (#377).
 *
 * Two settings, resolved in this order — the same shape as the default device header
 * color (#354):
 *   1. the project override — `SchematicFile.defaultStubLabelMode`, travels with the file
 *   2. the app preference — localStorage, applies to every project on this machine
 *   3. neither, which is "full": the tag names the destination, as it always has
 *
 * The resolved mode is *stamped* onto both tags as a connection is stubbed rather than
 * consulted at paint time, so changing either setting never rewrites tags already on the
 * canvas. A "full" result stamps nothing — an unset `labelMode` already reads as "full",
 * exactly as it does for every tag saved before #270.
 */
import { DEFAULT_STUB_LABEL_MODE, type StubLabelMode } from "./types";

/** App-level preference — an editor preference, not document data. */
export const DEFAULT_STUB_LABEL_MODE_KEY = "easyschematic-default-stub-label-mode";

const MODES: readonly StubLabelMode[] = ["full", "cableId"];

/** Narrow an untrusted value (a loaded schematic file, a localStorage string) to a mode. */
export function normalizeStubLabelMode(value: unknown): StubLabelMode | undefined {
  return typeof value === "string" && (MODES as readonly string[]).includes(value)
    ? (value as StubLabelMode)
    : undefined;
}

/** Project override beats app preference beats "full". */
export function resolveDefaultStubLabelMode(
  projectDefault: StubLabelMode | undefined,
  appDefault: StubLabelMode | undefined,
): StubLabelMode {
  return (
    normalizeStubLabelMode(projectDefault) ??
    normalizeStubLabelMode(appDefault) ??
    DEFAULT_STUB_LABEL_MODE
  );
}

export function loadAppDefaultStubLabelMode(): StubLabelMode {
  try {
    return normalizeStubLabelMode(localStorage.getItem(DEFAULT_STUB_LABEL_MODE_KEY)) ?? DEFAULT_STUB_LABEL_MODE;
  } catch {
    return DEFAULT_STUB_LABEL_MODE;
  }
}

/** Only a non-default choice is stored; "full" clears the key. */
export function saveAppDefaultStubLabelMode(mode: StubLabelMode): void {
  try {
    if (mode !== DEFAULT_STUB_LABEL_MODE) localStorage.setItem(DEFAULT_STUB_LABEL_MODE_KEY, mode);
    else localStorage.removeItem(DEFAULT_STUB_LABEL_MODE_KEY);
  } catch {
    // Storage full or unavailable — the in-memory choice still applies this session.
  }
}
