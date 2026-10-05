import type { ConnectorType, PortDirection, SignalType } from "./types";
import type { PortDraft } from "./deviceTemplateBuild";
import { shouldDefaultMultiConnect } from "./connectorTypes";
import { bulkLabel } from "./slotBulk";

export interface BulkPortSpec {
  direction: PortDirection;
  prefix: string;
  start: number;
  count: number;
  signalType: SignalType;
  /** Always explicit: the dialog defaults it to the signal's default connector, but the user can override (#245). */
  connectorType: ConnectorType;
  section?: string;
  /** "Input 1" (true, the default) vs "Input1" (false). */
  spaceBeforeNumber?: boolean;
}

/** Build the port drafts for a bulk add. Pure: `newId` supplies unique draft ids. */
export function buildBulkPorts(spec: BulkPortSpec, newId: (i: number) => string): PortDraft[] {
  const multiConnect = shouldDefaultMultiConnect(spec.signalType, spec.connectorType) || undefined;
  const ports: PortDraft[] = [];
  for (let i = 0; i < spec.count; i++) {
    ports.push({
      id: newId(i),
      label: bulkLabel(spec.prefix, spec.start + i, spec.spaceBeforeNumber ?? true),
      signalType: spec.signalType,
      connectorType: spec.connectorType,
      direction: spec.direction,
      section: spec.section || undefined,
      multiConnect,
    });
  }
  return ports;
}
