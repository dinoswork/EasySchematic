import { memo, useMemo, useCallback, useRef } from "react";
import { useViewport, useReactFlow } from "@xyflow/react";
import { useSchematicStore } from "../store";
import { computePageGrid, type PageRect } from "../printPageGrid";
import { PAGE_MARGIN_IN, getPaperSize, printTitleBlockHeightIn } from "../printConfig";
import type { TitleBlock, TitleBlockLayout } from "../types";
import { computeCellRects, normalizeSizes, getFieldValue, getFieldLabel } from "../titleBlockLayout";
import { transformLabel } from "../labelCaseUtils";
import { computeCrossingLabels, type CrossingLabel } from "../crossingLabels";
import { collectColorKeyEntries, layoutColorKey, type ColorKeyEntry } from "../colorKeyLayout";
import {
  continuationPillText,
  layoutContinuationPills,
  pillIsRotated,
  titleBlockBandPx,
  PILL_FONT_SIZE_PT,
  PILL_GAP_PT,
  PILL_PAD_PT,
  type TitleBlockBand,
} from "../continuationPill";

// ─── Page crossing labels ─────────────────────────────────────────
//
// The scan itself, and the nodeId → pill-name lookup it runs on, live in
// crossingLabels.ts — the PDF export builds its pills from the same lookup, so a
// crossing one surface draws a pill for is a crossing the other draws one for too
// (#361). This file only measures and paints them.

/** Measure text width using a canvas 2D context for pixel-accurate sizing. */
let measureCtx: CanvasRenderingContext2D | null = null;
function measureTextWidth(text: string, font: string): number {
  if (!measureCtx) {
    measureCtx = document.createElement("canvas").getContext("2d")!;
  }
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

function CrossingLabels({ labels, pxPerPt, titleBlockBands }: { labels: CrossingLabel[]; pxPerPt: number; titleBlockBands: TitleBlockBand[] }) {
  if (labels.length === 0) return null;
  // Type size, padding and pill text all come from the shared module: placement is
  // driven by the pill's measured box, so a preview that measured its pills
  // differently would push them to different places than the PDF does (#357).
  const fontSize = PILL_FONT_SIZE_PT * pxPerPt;
  const pad = PILL_PAD_PT * pxPerPt;
  const radius = 1.5 * pxPerPt;
  const font = `500 ${fontSize}px Inter, system-ui, sans-serif`;
  const pillGap = PILL_GAP_PT * pxPerPt;

  const texts = labels.map((l) => continuationPillText(l.text, l.pageNum));

  // Box outer edge sits at l.x/l.y, growing INWARD (away from the page boundary)
  // along its own wire — top/bottom-edge pills come back rotated onto the vertical
  // wire they belong to. Pills crossing within a thickness of each other still slide
  // along the edge until they clear, and any that landed on the title block ride up
  // off it.
  const boxes = layoutContinuationPills(
    labels.map((l, i) => ({
      anchor: l.anchor,
      x: l.x,
      y: l.y,
      width: measureTextWidth(texts[i], font) + pad * 2,
      height: fontSize + pad * 2,
      // A pill that landed on no page at all (a boundary shared with an empty grid
      // cell) is on nobody's edge, so it gets a key of its own rather than being
      // spread against every other homeless pill in the document.
      sheet: l.sheet > 0 ? l.sheet : `off-${i}`,
      limit: l.limit,
    })),
    titleBlockBands,
    pillGap,
  );

  return (
    <g>
      {labels.map((l, i) => {
        const displayText = texts[i];
        const box = boxes[i];
        // A top- or bottom-edge pill lies along its vertical wire, so the text is
        // rotated to read bottom-to-top (the drawing convention) from the pill's
        // lower end; the box itself stays an axis-aligned narrow rect. Side-edge
        // pills read flat along their horizontal wire, as before.
        const rotated = pillIsRotated(l.anchor);
        const textX = rotated ? box.x + box.width / 2 : box.x + pad;
        const textY = rotated ? box.y + box.height - pad : box.y + box.height / 2;

        return (
          <g key={i}>
            <rect
              x={box.x}
              y={box.y}
              width={box.width}
              height={box.height}
              rx={radius}
              ry={radius}
              fill="white"
              stroke={l.color}
              strokeWidth={0.5 * pxPerPt}
            />
            <text
              x={textX}
              y={textY}
              transform={rotated ? `rotate(-90 ${textX} ${textY})` : undefined}
              dominantBaseline="central"
              fill="#374151"
              fontSize={fontSize}
              fontFamily="'Inter', system-ui, sans-serif"
              fontWeight="500"
            >
              {displayText}
            </text>
          </g>
        );
      })}
    </g>
  );
}

// ─── Origin drag handle ──────────────────────────────────────────

const GRID_SNAP = 20;

function OriginDragHandle({
  handleX,
  handleY,
  originX,
  originY,
  zoom,
  corner,
  onDrag,
}: {
  handleX: number;
  handleY: number;
  originX: number;
  originY: number;
  zoom: number;
  corner: "tl" | "tr" | "bl" | "br";
  onDrag: (x: number, y: number) => void;
}) {
  const dragging = useRef(false);
  const startRef = useRef({ mouseX: 0, mouseY: 0, ox: 0, oy: 0 });

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      dragging.current = true;
      startRef.current = { mouseX: e.clientX, mouseY: e.clientY, ox: originX, oy: originY };
      (e.target as SVGElement).setPointerCapture(e.pointerId);
    },
    [originX, originY],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      const dx = (e.clientX - startRef.current.mouseX) / zoom;
      const dy = (e.clientY - startRef.current.mouseY) / zoom;
      const newX = Math.round((startRef.current.ox + dx) / GRID_SNAP) * GRID_SNAP;
      const newY = Math.round((startRef.current.oy + dy) / GRID_SNAP) * GRID_SNAP;
      onDrag(newX, newY);
    },
    [zoom, onDrag],
  );

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  // Constant screen-size for the handle
  const armLen = 24 / zoom;
  const strokeW = 2 / zoom;
  const hitSize = 16 / zoom;

  // Arms point inward: right for tl/bl, left for tr/br; down for tl/tr, up for bl/br
  const xSign = corner === "tl" || corner === "bl" ? 1 : -1;
  const ySign = corner === "tl" || corner === "tr" ? 1 : -1;

  return (
    <g
      style={{ pointerEvents: "all", cursor: "move" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Hit area */}
      <rect
        x={handleX - hitSize / 2}
        y={handleY - hitSize / 2}
        width={hitSize}
        height={hitSize}
        fill="transparent"
      />
      {/* L-bracket: horizontal arm */}
      <line
        x1={handleX}
        y1={handleY}
        x2={handleX + xSign * armLen}
        y2={handleY}
        stroke="#2563eb"
        strokeWidth={strokeW}
        strokeLinecap="round"
      />
      {/* L-bracket: vertical arm */}
      <line
        x1={handleX}
        y1={handleY}
        x2={handleX}
        y2={handleY + ySign * armLen}
        stroke="#2563eb"
        strokeWidth={strokeW}
        strokeLinecap="round"
      />
      {/* Corner dot */}
      <circle
        cx={handleX}
        cy={handleY}
        r={3 / zoom}
        fill="#2563eb"
      />
    </g>
  );
}

// ─── Color key legend ────────────────────────────────────────────

function ColorKeyLegend({
  entries,
  pages,
  corner,
  columns,
  pageFilter,
  pxPerPt,
}: {
  entries: ColorKeyEntry[];
  pages: PageRect[];
  corner: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  columns: number;
  pageFilter: "first" | "last" | "all";
  pxPerPt: number;
}) {
  if (entries.length === 0 || pages.length === 0) return null;

  const fontSize = 6.5 * pxPerPt;
  const headerFontSize = 7.5 * pxPerPt;
  const swatchLen = 18 * pxPerPt;
  const swatchGap = 4 * pxPerPt;
  const cellW = (swatchLen + swatchGap + 55 * pxPerPt);
  const cellH = fontSize * 1.8;
  const padding = 5 * pxPerPt;
  const headerH = headerFontSize * 1.8;
  const strokeW = 1.5 * pxPerPt;
  const borderW = 0.5 * pxPerPt; // match title block stroke weight

  const geo = layoutColorKey(entries, columns, cellW, cellH, padding, headerH);

  // Determine which pages show the legend
  const qualifying = pages.filter((_, i) =>
    pageFilter === "all" ? true : pageFilter === "first" ? i === 0 : i === pages.length - 1,
  );

  return (
    <g>
      {qualifying.map((p) => {
        // Flush with drawing border — locked into the corner like the title block
        const isRight = corner.includes("right");
        const isBottom = corner.includes("bottom");
        const marginPx = p.contentX - p.x;
        const drawingBottom = p.y + p.heightPx - marginPx;
        const ox = isRight ? p.contentX + p.contentW - geo.width : p.contentX;
        const oy = isBottom ? drawingBottom - geo.height : p.contentY;

        return (
          <g key={`ck-${p.index}`} transform={`translate(${ox},${oy})`}>
            {/* White fill + black border — matches title block style */}
            <rect
              x={0}
              y={0}
              width={geo.width}
              height={geo.height}
              fill="white"
              stroke="#000000"
              strokeWidth={borderW}
            />
            {/* Header divider line */}
            <line
              x1={0}
              y1={padding + headerH}
              x2={geo.width}
              y2={padding + headerH}
              stroke="#000000"
              strokeWidth={borderW}
            />
            {/* Header */}
            <text
              x={padding}
              y={padding + headerFontSize * 0.85}
              fontSize={headerFontSize}
              fontFamily="'Inter', system-ui, sans-serif"
              fontWeight="600"
              fill="#000000"
            >
              SIGNAL KEY
            </text>
            {/* Entries */}
            {geo.entries.map(({ entry, x, y }) => {
              const lineY = y + cellH / 2;
              const dashArray = entry.dashArray;
              return (
                <g key={entry.signalType}>
                  <line
                    x1={x}
                    y1={lineY}
                    x2={x + swatchLen}
                    y2={lineY}
                    stroke={entry.color}
                    strokeWidth={strokeW}
                    strokeDasharray={dashArray}
                    strokeLinecap="round"
                  />
                  <text
                    x={x + swatchLen + swatchGap}
                    y={lineY + fontSize * 0.35}
                    fontSize={fontSize}
                    fontFamily="'Inter', system-ui, sans-serif"
                    fill="#000000"
                  >
                    {entry.label}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

// ─── Main overlay ─────────────────────────────────────────────────

function PageBoundaryOverlay() {
  const { x: vx, y: vy, zoom } = useViewport();
  const rfInstance = useReactFlow();

  const printPaperId = useSchematicStore((s) => s.printPaperId);
  const printOrientation = useSchematicStore((s) => s.printOrientation);
  const printScale = useSchematicStore((s) => s.printScale);
  const printCustomWidthIn = useSchematicStore((s) => s.printCustomWidthIn);
  const printCustomHeightIn = useSchematicStore((s) => s.printCustomHeightIn);
  const titleBlock = useSchematicStore((s) => s.titleBlock);
  const storedTitleBlockLayout = useSchematicStore((s) => s.titleBlockLayout);
  const printTitleBlockEnabled = useSchematicStore((s) => s.printTitleBlockEnabled);
  // A hidden title block is a zero-height one: no band to draw, no band for pills
  // to dodge, and its height goes back to each page's drawing area (#388).
  const titleBlockLayout = useMemo(() => {
    const heightIn = printTitleBlockHeightIn(storedTitleBlockLayout, printTitleBlockEnabled);
    return heightIn === storedTitleBlockLayout.heightIn ? storedTitleBlockLayout : { ...storedTitleBlockLayout, heightIn };
  }, [storedTitleBlockLayout, printTitleBlockEnabled]);
  const routedEdges = useSchematicStore((s) => s.routedEdges);
  const storeNodes = useSchematicStore((s) => s.nodes);
  const storeEdges = useSchematicStore((s) => s.edges);
  const signalColors = useSchematicStore((s) => s.signalColors);
  const signalLineStyles = useSchematicStore((s) => s.signalLineStyles);
  const colorKeyEnabled = useSchematicStore((s) => s.colorKeyEnabled);
  const colorKeyCorner = useSchematicStore((s) => s.colorKeyCorner);
  const colorKeyColumns = useSchematicStore((s) => s.colorKeyColumns);
  const colorKeyPage = useSchematicStore((s) => s.colorKeyPage);
  const colorKeyOverrides = useSchematicStore((s) => s.colorKeyOverrides);
  const printOriginOffsetX = useSchematicStore((s) => s.printOriginOffsetX);
  const printOriginOffsetY = useSchematicStore((s) => s.printOriginOffsetY);
  const setPrintOriginOffset = useSchematicStore((s) => s.setPrintOriginOffset);
  const labelCase = useSchematicStore((s) => s.labelCase);
  // A stub leg whose partner ends on a hidden inline adapter names the device beyond
  // it, exactly as the stub tag on that leg does (#348).
  const hiddenAdapterNodeIds = useSchematicStore((s) => s.hiddenAdapterNodeIds);
  // Subscribe to node positions so the overlay re-renders when nodes move
  useSchematicStore((s) =>
    s.nodes.map((n) => `${n.id}:${Math.round(n.position.x)},${Math.round(n.position.y)},${n.measured?.width ?? 0},${n.measured?.height ?? 0}`).join("|"),
  );

  const paperSize = getPaperSize(printPaperId, printCustomWidthIn, printCustomHeightIn);
  const nodes = rfInstance.getNodes();

  const pages = computePageGrid(paperSize, printOrientation, printScale, nodes, titleBlockLayout.heightIn, printOriginOffsetX, printOriginOffsetY);

  // Compute page-relative sizing: pxPerPt scales with page dimensions, not zoom
  const marginPx = pages.length > 0 ? pages[0].contentX - pages[0].x : 0;
  const pxPerIn = PAGE_MARGIN_IN > 0 ? marginPx / PAGE_MARGIN_IN : 96 / printScale;
  const pxPerPt = pxPerIn / 72;

  const crossingLabels = useMemo(
    () => computeCrossingLabels(
      pages,
      routedEdges,
      storeEdges,
      storeNodes,
      signalColors,
      // Case-transform to match the PDF's pill text (#294) — pill placement is
      // width-driven since #357, so differing text would also move the pills.
      (label) => transformLabel(label, labelCase),
      hiddenAdapterNodeIds,
    ),
    [pages, routedEdges, storeEdges, storeNodes, signalColors, labelCase, hiddenAdapterNodeIds],
  );

  const titleBlockBands = useMemo(
    () => pages
      .map((p) => titleBlockBandPx(p, titleBlockLayout.widthIn, titleBlockLayout.heightIn))
      .filter((b): b is TitleBlockBand => b !== null),
    [pages, titleBlockLayout.widthIn, titleBlockLayout.heightIn],
  );

  const colorKeyEntries = useMemo(
    () => colorKeyEnabled ? collectColorKeyEntries(storeEdges, signalColors, signalLineStyles, colorKeyOverrides) : [],
    [colorKeyEnabled, storeEdges, signalColors, signalLineStyles, colorKeyOverrides],
  );

  if (pages.length === 0) return null;

  const totalPages = pages.length;
  const minCol = Math.min(...pages.map((p) => p.col));
  const minRow = Math.min(...pages.map((p) => p.row));

  const pageMinX = Math.min(...pages.map((p) => p.x));
  const pageMinY = Math.min(...pages.map((p) => p.y));
  const pageMaxX = Math.max(...pages.map((p) => p.x + p.widthPx));
  const pageMaxY = Math.max(...pages.map((p) => p.y + p.heightPx));

  return (
    <div
      className="page-boundary-overlay"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 999,
        overflow: "hidden",
      }}
    >
      <svg
        style={{
          position: "absolute",
          overflow: "visible",
          width: 1,
          height: 1,
          transform: `translate(${vx}px, ${vy}px) scale(${zoom})`,
          transformOrigin: "0 0",
        }}
      >
        {pages.map((p) => (
          <PageOverlay key={p.index} page={p} zoom={zoom} titleBlock={titleBlock} layout={titleBlockLayout} totalPages={totalPages} minCol={minCol} minRow={minRow} />
        ))}
        <CrossingLabels labels={crossingLabels} pxPerPt={pxPerPt} titleBlockBands={titleBlockBands} />
        {colorKeyEnabled && <ColorKeyLegend entries={colorKeyEntries} pages={pages} corner={colorKeyCorner} columns={colorKeyColumns} pageFilter={colorKeyPage} pxPerPt={pxPerPt} />}
        {(["tl", "tr", "bl", "br"] as const).map((corner) => (
          <OriginDragHandle
            key={corner}
            handleX={corner === "tl" || corner === "bl" ? pageMinX : pageMaxX}
            handleY={corner === "tl" || corner === "tr" ? pageMinY : pageMaxY}
            originX={printOriginOffsetX}
            originY={printOriginOffsetY}
            zoom={zoom}
            corner={corner}
            onDrag={setPrintOriginOffset}
          />
        ))}
      </svg>
    </div>
  );
}

const FONT_FAMILY_MAP: Record<string, string> = {
  "sans-serif": "'Inter', system-ui, sans-serif",
  "serif": "Georgia, serif",
  "monospace": "'Courier New', monospace",
};

function PageOverlay({
  page: p,
  zoom,
  titleBlock: tb,
  layout,
  totalPages,
  minCol,
  minRow,
}: {
  page: PageRect;
  zoom: number;
  titleBlock: TitleBlock;
  layout: TitleBlockLayout;
  totalPages: number;
  minCol: number;
  minRow: number;
}) {
  const fontSize = 14 / zoom;
  const labelFontSize = 10 / zoom;

  // Title block geometry — the same band the continuation pills are clamped against
  const marginPx = p.contentX - p.x;
  const band = titleBlockBandPx(p, layout.widthIn, layout.heightIn);
  const hasTitleBlock = band !== null;
  const tbTop = band?.y ?? 0;
  const tbHeight = band?.height ?? 0;
  const tbBoxW = band?.width ?? 0;
  const tbBoxX = band?.x ?? 0;

  const pxPerIn = marginPx / PAGE_MARGIN_IN;
  const pxPerPt = pxPerIn / 72; // convert font points to page pixels
  const stroke = 0.5 * pxPerPt; // scale with page, not screen

  const cellRects = computeCellRects(layout);
  const pad = 3 * pxPerPt;

  // Build a set of grid lines that should NOT be drawn (inside merged cells)
  const skipHLines = new Set<string>(); // "row,colStart,colEnd"
  const skipVLines = new Set<string>(); // "col,rowStart,rowEnd"
  for (const cell of layout.cells) {
    // Skip horizontal lines inside merged cells
    for (let r = cell.row + 1; r < cell.row + cell.rowSpan; r++) {
      for (let c = cell.col; c < cell.col + cell.colSpan; c++) {
        skipHLines.add(`${r},${c}`);
      }
    }
    // Skip vertical lines inside merged cells
    for (let c = cell.col + 1; c < cell.col + cell.colSpan; c++) {
      for (let r = cell.row; r < cell.row + cell.rowSpan; r++) {
        skipVLines.add(`${c},${r}`);
      }
    }
  }

  // Cumulative column/row positions (normalized to 0..1)
  const normCols = normalizeSizes(layout.columns);
  const normRows = normalizeSizes(layout.rows);
  const colStarts: number[] = [0];
  for (let i = 0; i < normCols.length; i++) {
    colStarts.push(colStarts[i] + normCols[i]);
  }
  const rowStarts: number[] = [0];
  for (let i = 0; i < normRows.length; i++) {
    rowStarts.push(rowStarts[i] + normRows[i]);
  }

  return (
    <g>
      {/* Page boundary — solid border */}
      <rect
        x={p.x}
        y={p.y}
        width={p.widthPx}
        height={p.heightPx}
        fill="none"
        stroke="#6b7280"
        strokeWidth={1.5 / zoom}
      />

      {/* Drawing border at print margin */}
      <rect
        x={p.contentX}
        y={p.contentY}
        width={p.contentW}
        height={(p.y + p.heightPx) - p.contentY - marginPx}
        fill="none"
        stroke="#000000"
        strokeWidth={stroke}
      />

      {/* Title block */}
      {hasTitleBlock && (
        <g>
          {/* Outer border — opaque so cables routed under the band are hidden
              exactly as they are on the printed sheet (#359). Only this rect is
              filled; the rest of the overlay stays transparent, and the wrapping
              div keeps pointerEvents "none" so the band never swallows clicks. */}
          <rect
            x={tbBoxX}
            y={tbTop}
            width={tbBoxW}
            height={tbHeight}
            fill="white"
            stroke="#000000"
            strokeWidth={stroke}
          />

          {/* Horizontal grid lines (between rows) */}
          {rowStarts.slice(1, -1).map((frac, i) => {
            const rowIdx = i + 1;
            // Find segments where line should be drawn (skip merged)
            const segments: [number, number][] = [];
            let segStart: number | null = null;
            for (let c = 0; c < layout.columns.length; c++) {
              if (skipHLines.has(`${rowIdx},${c}`)) {
                if (segStart !== null) {
                  segments.push([segStart, c]);
                  segStart = null;
                }
              } else {
                if (segStart === null) segStart = c;
              }
            }
            if (segStart !== null) segments.push([segStart, layout.columns.length]);

            return segments.map(([sc, ec]) => (
              <line
                key={`h-${rowIdx}-${sc}-${ec}`}
                x1={tbBoxX + colStarts[sc] * tbBoxW}
                y1={tbTop + frac * tbHeight}
                x2={tbBoxX + colStarts[ec] * tbBoxW}
                y2={tbTop + frac * tbHeight}
                stroke="#000000"
                strokeWidth={stroke}
              />
            ));
          })}

          {/* Vertical grid lines (between columns) */}
          {colStarts.slice(1, -1).map((frac, i) => {
            const colIdx = i + 1;
            const segments: [number, number][] = [];
            let segStart: number | null = null;
            for (let r = 0; r < layout.rows.length; r++) {
              if (skipVLines.has(`${colIdx},${r}`)) {
                if (segStart !== null) {
                  segments.push([segStart, r]);
                  segStart = null;
                }
              } else {
                if (segStart === null) segStart = r;
              }
            }
            if (segStart !== null) segments.push([segStart, layout.rows.length]);

            return segments.map(([sr, er]) => (
              <line
                key={`v-${colIdx}-${sr}-${er}`}
                x1={tbBoxX + frac * tbBoxW}
                y1={tbTop + rowStarts[sr] * tbHeight}
                x2={tbBoxX + frac * tbBoxW}
                y2={tbTop + rowStarts[er] * tbHeight}
                stroke="#000000"
                strokeWidth={stroke}
              />
            ));
          })}

          {/* Cell content */}
          {layout.cells.map((cell) => {
            const rect = cellRects.get(cell.id);
            if (!rect) return null;

            const cellX = tbBoxX + rect.x * tbBoxW;
            const cellY = tbTop + rect.y * tbHeight;
            const cellW = rect.w * tbBoxW;
            const cellH = rect.h * tbHeight;
            const cellFontSize = cell.fontSize * pxPerPt;
            const fontFamily = FONT_FAMILY_MAP[cell.fontFamily] ?? "system-ui, sans-serif";

            let textContent: string;
            let fillColor = cell.color;
            let isPlaceholder = false;

            switch (cell.content.type) {
              case "field": {
                const value = getFieldValue(tb, cell.content.field);
                if (value) {
                  textContent = value;
                } else {
                  textContent = getFieldLabel(tb, cell.content.field);
                  fillColor = "#9ca3af";
                  isPlaceholder = true;
                }
                break;
              }
              case "static":
                textContent = cell.content.text;
                break;
              case "pageNumber":
                textContent = `Page ${p.index + 1} / ${totalPages}`;
                break;
              case "logo":
                return tb.logo ? (
                  <image
                    key={cell.id}
                    href={tb.logo}
                    x={cellX + pad}
                    y={cellY + pad}
                    width={cellW - pad * 2}
                    height={cellH - pad * 2}
                    preserveAspectRatio="xMidYMid meet"
                  />
                ) : null;
            }

            // Compute text position based on alignment
            let textX: number;
            let anchor: "start" | "middle" | "end";
            if (cell.align === "center") {
              textX = cellX + cellW / 2;
              anchor = "middle";
            } else if (cell.align === "right") {
              textX = cellX + cellW - pad;
              anchor = "end";
            } else {
              textX = cellX + pad;
              anchor = "start";
            }

            const textY = cellY + cellH / 2 + cellFontSize * 0.35;

            return (
              <text
                key={cell.id}
                x={textX}
                y={textY}
                textAnchor={anchor}
                fill={fillColor}
                fontSize={cellFontSize}
                fontFamily={fontFamily}
                fontWeight={cell.fontWeight === "bold" ? "600" : "normal"}
                fontStyle={isPlaceholder ? "italic" : undefined}
              >
                {textContent}
              </text>
            );
          })}
        </g>
      )}

      {/* Page number at top */}
      <text
        x={p.x + p.widthPx / 2}
        y={p.y + fontSize * 1.5}
        textAnchor="middle"
        fill="#6b7280"
        fontSize={fontSize}
        fontFamily="'Inter', system-ui, sans-serif"
        fontWeight="600"
      >
        Page {p.index + 1}
      </text>

      {/* Dimensions label */}
      <text
        x={p.x + p.widthPx / 2}
        y={p.y + fontSize * 1.5 + labelFontSize * 1.5}
        textAnchor="middle"
        fill="#9ca3af"
        fontSize={labelFontSize}
        fontFamily="'Inter', system-ui, sans-serif"
      >
        {p.col - minCol + 1},{p.row - minRow + 1}
      </text>
    </g>
  );
}

export default memo(PageBoundaryOverlay);
