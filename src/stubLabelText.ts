// Pure assembly of a stub-label's display text. Extracted from StubLabelNode.tsx so the
// content rules (which of device / far-end port / room / page appear, and in what format)
// are unit-testable without a DOM or the React Flow runtime.

import { DEFAULT_STUB_LABEL_MODE, type StubLabelMode, type StubLabelPageMode } from "./types";

export interface StubLabelParts {
  /** Direction arrow toward the far end, e.g. "→". */
  arrow: string;
  /** Far-end device label. */
  farLabel: string;
  /** Far-end port label (the port at the OTHER end of the stubbed connection). */
  farPort: string;
  /** Far-end room label. */
  farRoom: string;
  /** Printed page this stub sits on ("" when not in print view / single page). */
  myPage: string;
  /** Printed page the far end sits on. */
  farPage: string;
  /** Cable ID of the logical connection this stub terminates ("" when unnumbered). */
  cableId: string;
  /** True when the far device sits in the same room as the device at this stub's own end,
   *  so naming the room tells the reader nothing (#297). Omitted = not known to be. */
  sameRoom?: boolean;
}

/** What a stub tag reads when its partner leg or far device can't be resolved — a
 *  half-deleted connection. Shared so the canvas box and the DXF pill say the same
 *  thing rather than one of them going blank (#319). */
export const UNRESOLVED_STUB_LABEL_TEXT = "?";

/** Stand-in for a cable-ID tag on a connection with no cable ID — a direct-attach run
 *  never gets one (computeCableSchedule skips them), and an empty tag would just be a
 *  blank box with nothing to explain it. Same marker the patch-panel report uses. */
export const MISSING_CABLE_ID = "—";

export interface StubLabelOptions {
  showArrow: boolean;
  showPort: boolean;
  showRoom: boolean;
  /** Name the far room even when it is this end's own room. Only an explicit per-tag
   *  "Show room: On" asks for that; by default a same-room tag leaves it off (#297). */
  roomInSameRoom?: boolean;
  pageMode: StubLabelPageMode;
  /** Omitted = the full destination description (#270). */
  labelMode?: StubLabelMode;
}

/**
 * Build the stub-label text: the far device's name, optionally led by the direction
 * arrow, plus — when enabled and available — the far-end port in brackets, the far-end
 * room in parens (only when it is a different room from this end's, #297), and a page tag. The port is the far end's port so BOTH stubs of a
 * connection name the opposite device's port (issue #200), not the near/local one.
 *
 * In "cableId" mode the tag is the cable ID alone — a plain cable tag with no far-end
 * information at all, or MISSING_CABLE_ID when the connection has no ID (#270). Every
 * surface (canvas, PDF, DXF) composes its stub text here, so the mode reaches all three
 * without any of them knowing about it.
 */
export function buildStubLabelText(parts: StubLabelParts, opts: StubLabelOptions): string {
  const { arrow, farLabel, farPort, farRoom, myPage, farPage } = parts;
  const mode = opts.labelMode ?? DEFAULT_STUB_LABEL_MODE;
  // Deliberately ahead of every other option: "only the cable ID" means the arrow, port,
  // room and page toggles all stop applying, whatever they are set to.
  if (mode === "cableId") return parts.cableId || MISSING_CABLE_ID;
  let t = opts.showArrow ? `${arrow} ${farLabel}` : farLabel;
  if (opts.showPort && farPort) t += ` [${farPort}]`;
  if (opts.showRoom && farRoom && (!parts.sameRoom || opts.roomInSameRoom)) t += ` (${farRoom})`;
  const showPage =
    !!farPage &&
    (opts.pageMode === "always" || (opts.pageMode === "cross-page" && farPage !== myPage));
  if (showPage) t += ` Pg ${farPage}`;
  return t;
}
