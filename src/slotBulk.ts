/**
 * Name for item `n` of a bulk add — `"Input 3"` by default, `"Input3"` when `spaceBeforeNumber`
 * is false (#245).
 */
export function bulkLabel(prefix: string, n: number, spaceBeforeNumber = true): string {
  return `${prefix}${spaceBeforeNumber ? " " : ""}${n}`;
}

/**
 * Build the slot blueprints for a bulk add — `${prefix} ${start}` … `${prefix} ${start + count - 1}`,
 * all sharing one slot family. Pure: the store assigns slot IDs when it inserts them.
 */
export function buildBulkSlots(
  prefix: string,
  start: number,
  count: number,
  slotFamily: string,
): { label: string; slotFamily: string }[] {
  const slots: { label: string; slotFamily: string }[] = [];
  for (let i = 0; i < count; i++) {
    slots.push({ label: bulkLabel(prefix, start + i), slotFamily });
  }
  return slots;
}
