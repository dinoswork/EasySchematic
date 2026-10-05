/**
 * Freeze CSS-variable-based SVG colors to concrete values before an
 * html-to-image capture, then restore them afterwards.
 *
 * Why (#173): connection strokes are inlined as `var(--color-<signal>)` (see
 * `resolveEdgeStroke` in store.ts). html-to-image renders the cloned DOM inside
 * an isolated SVG <foreignObject> whose document does NOT inherit our
 * `:root { --color-* }` custom properties, so in Chromium every `var(--color-…)`
 * stroke resolves to nothing and the line disappears from the PNG/PDF/SVG.
 * (Firefox happens to survive this — hence "Firefox works, Chromium drops lines".)
 * Plain HTML labels use concrete hex colors, so they keep rendering — matching
 * the "lines gone, labels remain" report.
 *
 * Fix: replace each element's `var(...)` inline stroke/fill with its *computed*
 * (already-resolved) color so the clone carries a concrete value. Concrete
 * colors and `url(#gradient)` references are left untouched.
 *
 * Call AFTER `[data-export-capturing]` is set and the style flush has happened,
 * so the frozen colors are the light-mode export values.
 *
 * @returns a restore function that undoes every override.
 */
export function freezeSvgColors(root: HTMLElement): () => void {
  const restores: Array<() => void> = [];
  const els = root.querySelectorAll<SVGElement>(
    "path, line, polyline, polygon, circle, rect, ellipse",
  );
  els.forEach((el) => {
    const inlineStroke = el.style.stroke;
    const inlineFill = el.style.fill;
    let touched = false;
    // Connections with no inline stroke (hand-made or legacy files; the store
    // only stamps style.stroke when it creates or retypes an edge) fall back to
    // React Flow's stylesheet var() default, which the clone drops too. Freeze
    // their computed stroke the same way.
    const isUnstyledEdgePath = !inlineStroke && el.classList.contains("react-flow__edge-path");
    if (inlineStroke.includes("var(") || isUnstyledEdgePath) {
      el.style.stroke = getComputedStyle(el).stroke;
      touched = true;
    }
    if (inlineFill.includes("var(")) {
      el.style.fill = getComputedStyle(el).fill;
      touched = true;
    }
    if (touched) {
      restores.push(() => {
        el.style.stroke = inlineStroke;
        el.style.fill = inlineFill;
      });
    }
  });
  return () => restores.forEach((r) => r());
}
