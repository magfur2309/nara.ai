import * as pdfjsLib from 'pdfjs-dist';
import type { SopAttachmentVisualPage } from '../types/sop';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

export interface PdfVisualExtractResult {
  totalPages: number;
  visualPages: SopAttachmentVisualPage[];
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface TextLine extends Box {
  text: string;
  centerX: number;
  centerY: number;
  fontH: number;
}

const MAX_DEFAULT_PAGES = 12;
const MAX_TOTAL_IMAGE_BYTES = 340 * 1024; // Keep well inside Firestore 1MB doc limit
const MAX_INSPECT_PAGES = 24;
const CAPTION_LINE_REGEX =
  /^\s*(?:gambar|gbr\.?|figure|fig\.?|diagram|bagan|ilustrasi|tampilan)\b/i;

function estimateDataUrlBytes(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) return dataUrl.length;
  return Math.ceil(((dataUrl.length - commaIdx - 1) * 3) / 4);
}

function boxWidth(b: Box): number {
  return Math.max(0, b.x1 - b.x0);
}

function boxHeight(b: Box): number {
  return Math.max(0, b.y1 - b.y0);
}

function mergeBox(a: Box, b: Box): Box {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

function isNonWhitePixel(r: number, g: number, b: number, a: number): boolean {
  if (a < 18) return false;
  return r < 244 || g < 244 || b < 244;
}

function isChromaticPixel(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min >= 28;
}

/**
 * Extract horizontal text lines in canvas pixel coordinates using pdfjs viewport transform.
 */
async function extractCanvasTextLines(
  page: pdfjsLib.PDFPageProxy,
  viewport: pdfjsLib.PageViewport
): Promise<TextLine[]> {
  try {
    const textContent = await page.getTextContent();
    const rawItems: (Box & { text: string; baselineY: number; fontH: number })[] = [];

    for (const item of textContent.items) {
      if (!('str' in item)) continue;
      const text = item.str.replace(/\s+/g, ' ').trim();
      if (!text) continue;

      const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
      const fontH = Math.max(
        6,
        Math.hypot(tx[2], tx[3]) || (item.height || 10) * viewport.scale
      );
      const widthPx = Math.max(2, (item.width || 0) * viewport.scale);
      const xStart = tx[4];
      const xEnd = tx[4] + widthPx;
      const baselineY = tx[5];

      rawItems.push({
        text,
        x0: Math.min(xStart, xEnd),
        x1: Math.max(xStart, xEnd),
        y0: baselineY - fontH * 0.92,
        y1: baselineY + fontH * 0.25,
        baselineY,
        fontH,
      });
    }

    if (rawItems.length === 0) return [];

    // Sort top-to-bottom then left-to-right
    rawItems.sort((a, b) => a.baselineY - b.baselineY || a.x0 - b.x0);

    const groups: (typeof rawItems)[] = [];
    for (const item of rawItems) {
      const lastGroup = groups[groups.length - 1];
      if (!lastGroup) {
        groups.push([item]);
        continue;
      }
      const ref = lastGroup[0];
      const tol = Math.max(5, Math.min(ref.fontH, item.fontH) * 0.55);
      if (Math.abs(item.baselineY - ref.baselineY) <= tol) {
        lastGroup.push(item);
      } else {
        groups.push([item]);
      }
    }

    const lines: TextLine[] = groups.map((grp) => {
      grp.sort((a, b) => a.x0 - b.x0);
      let x0 = grp[0].x0;
      let y0 = grp[0].y0;
      let x1 = grp[0].x1;
      let y1 = grp[0].y1;
      let maxFontH = grp[0].fontH;
      for (let i = 1; i < grp.length; i++) {
        x0 = Math.min(x0, grp[i].x0);
        y0 = Math.min(y0, grp[i].y0);
        x1 = Math.max(x1, grp[i].x1);
        y1 = Math.max(y1, grp[i].y1);
        maxFontH = Math.max(maxFontH, grp[i].fontH);
      }
      const text = grp.map((g) => g.text).join(' ').replace(/\s+/g, ' ').trim();
      return {
        text,
        x0,
        y0,
        x1,
        y1,
        centerX: (x0 + x1) / 2,
        centerY: (y0 + y1) / 2,
        fontH: maxFontH,
      };
    });

    lines.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
    return lines;
  } catch {
    return [];
  }
}

/**
 * Convert PDF.js recordImages coordinates into clamped canvas bounding boxes.
 */
function parseRecordedImageRects(
  imageCoordinates: ArrayLike<number> | null | undefined,
  canvasWidth: number,
  canvasHeight: number
): Box[] {
  if (!imageCoordinates || imageCoordinates.length < 6) return [];
  const raw: Box[] = [];
  for (let i = 0; i + 5 < imageCoordinates.length; i += 6) {
    const x0 = imageCoordinates[i] * canvasWidth;
    const y0 = imageCoordinates[i + 1] * canvasHeight;
    const x1 = imageCoordinates[i + 2] * canvasWidth;
    const y1 = imageCoordinates[i + 3] * canvasHeight;
    const x2 = imageCoordinates[i + 4] * canvasWidth;
    const y2 = imageCoordinates[i + 5] * canvasHeight;
    const x3 = x1 + x2 - x0;
    const y3 = y1 + y2 - y0;

    const minX = Math.max(0, Math.min(x0, x1, x2, x3));
    const maxX = Math.min(canvasWidth, Math.max(x0, x1, x2, x3));
    const minY = Math.max(0, Math.min(y0, y1, y2, y3));
    const maxY = Math.min(canvasHeight, Math.max(y0, y1, y2, y3));
    const w = maxX - minX;
    const h = maxY - minY;
    if (w < 30 || h < 22) continue;
    raw.push({ x0: minX, y0: minY, x1: maxX, y1: maxY });
  }

  if (raw.length === 0) return [];

  const pageArea = canvasWidth * canvasHeight;
  const hasSubPageRect = raw.some(
    (r) => boxWidth(r) < canvasWidth * 0.9 && boxHeight(r) < canvasHeight * 0.9
  );

  return raw.filter((r) => {
    const w = boxWidth(r);
    const h = boxHeight(r);
    const area = w * h;
    // Ignore full-page background layer when sub-page figures exist
    if (hasSubPageRect && w >= canvasWidth * 0.92 && h >= canvasHeight * 0.92) {
      return false;
    }
    // Ignore small header/footer logos
    if (
      area < pageArea * 0.028 &&
      (r.y1 < canvasHeight * 0.085 || r.y0 > canvasHeight * 0.92)
    ) {
      return false;
    }
    return true;
  });
}

function isLineInsideAnyRect(line: TextLine, rects: Box[]): boolean {
  return rects.some(
    (r) =>
      line.centerX >= r.x0 - 4 &&
      line.centerX <= r.x1 + 4 &&
      line.centerY >= r.y0 - 4 &&
      line.centerY <= r.y1 + 4
  );
}

function isSeparatingProseOrCaptionLine(line: TextLine, canvasWidth: number): boolean {
  if (CAPTION_LINE_REGEX.test(line.text)) return true;
  const words = line.text.split(/\s+/).filter(Boolean);
  if (words.length >= 4 && boxWidth(line) >= canvasWidth * 0.22) return true;
  if (line.text.length >= 28) return true;
  return false;
}

/**
 * Merge overlapping or closely adjacent image rectangles (e.g., main window + connected popups)
 * into distinct composite figure regions, WITHOUT merging across separating prose or captions.
 */
function clusterImageRects(
  rects: Box[],
  externalLines: TextLine[],
  canvasWidth: number,
  canvasHeight: number
): Box[] {
  if (rects.length === 0) return [];

  // Keep only substantial standalone rects OR small rects adjacent to a larger one
  const maxGapX = Math.max(36, Math.round(canvasWidth * 0.055));
  const maxGapY = Math.max(42, Math.round(canvasHeight * 0.045));

  const hasTextDividerBetween = (a: Box, b: Box): boolean => {
    const minY = Math.min(a.y1, b.y1);
    const maxY = Math.max(a.y0, b.y0);
    if (maxY - minY < 10) return false;
    return externalLines.some(
      (line) =>
        line.y0 >= minY - 4 &&
        line.y1 <= maxY + 4 &&
        isSeparatingProseOrCaptionLine(line, canvasWidth)
    );
  };

  let clusters: Box[] = rects.map((r) => ({ ...r }));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const a = clusters[i];
        const b = clusters[j];
        const gapX = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1));
        const gapY = Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));

        if (gapX <= maxGapX && gapY <= maxGapY && !hasTextDividerBetween(a, b)) {
          clusters[i] = mergeBox(a, b);
          clusters.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }

  // Filter out tiny standalone icons that did not belong to any main figure
  return clusters
    .filter((c) => boxWidth(c) >= 90 && boxHeight(c) >= 58)
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
}

/**
 * Tightly trim whitespace around a cluster while catching adjacent vector red arrows/borders
 * and strictly stopping clear of surrounding prose / caption lines.
 */
function refineFigureCropBox(
  cluster: Box,
  externalLines: TextLine[],
  imgData: ImageData
): Box | null {
  const { width, height, data } = imgData;

  // Identify external lines horizontally aligned with or spanning across this figure
  const relevantLines = externalLines.filter(
    (line) => line.x1 > cluster.x0 - 45 && line.x0 < cluster.x1 + 45
  );

  // Nearest prose/caption line strictly above the cluster
  let prevLine: TextLine | null = null;
  for (const line of relevantLines) {
    if (line.y1 <= cluster.y0 + 10) {
      if (!prevLine || line.y1 > prevLine.y1) {
        prevLine = line;
      }
    }
  }

  // Nearest prose/caption line strictly below the cluster
  let nextLine: TextLine | null = null;
  for (const line of relevantLines) {
    if (line.y0 >= cluster.y1 - 10) {
      if (!nextLine || line.y0 < nextLine.y0) {
        nextLine = line;
      }
    }
  }

  // Hard vertical boundaries that exclude external text lines from the crop
  const hardTop = prevLine
    ? Math.min(Math.round(cluster.y0 + 6), Math.ceil(prevLine.y1) + 4)
    : 0;
  const hardBottom = nextLine
    ? Math.max(Math.round(cluster.y1 - 6), Math.floor(nextLine.y0) - 4)
    : height;

  const searchX0 = Math.max(0, Math.floor(cluster.x0 - 26));
  const searchX1 = Math.min(width, Math.ceil(cluster.x1 + 26));
  const searchY0 = Math.max(hardTop, Math.floor(cluster.y0 - 22));
  const searchY1 = Math.min(hardBottom, Math.ceil(cluster.y1 + 22));

  if (searchX1 - searchX0 < 60 || searchY1 - searchY0 < 40) return null;

  let minX = searchX1;
  let maxX = searchX0;
  let minY = searchY1;
  let maxY = searchY0;
  let nonWhiteCount = 0;

  // Row pass & Col pass ignoring tiny 1px noise
  for (let y = searchY0; y < searchY1; y++) {
    let rowHits = 0;
    let rowColorHits = 0;
    let rowMinX = searchX1;
    let rowMaxX = searchX0;
    const rowOffset = y * width * 4;

    for (let x = searchX0; x < searchX1; x++) {
      const idx = rowOffset + x * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];
      if (isNonWhitePixel(r, g, b, a)) {
        rowHits++;
        if (isChromaticPixel(r, g, b)) rowColorHits++;
        if (x < rowMinX) rowMinX = x;
        if (x + 1 > rowMaxX) rowMaxX = x + 1;
      }
    }

    if (rowHits >= 3 || rowColorHits >= 2) {
      nonWhiteCount += rowHits;
      if (y < minY) minY = y;
      if (y + 1 > maxY) maxY = y + 1;
      if (rowMinX < minX) minX = rowMinX;
      if (rowMaxX > maxX) maxX = rowMaxX;
    }
  }

  if (maxX <= minX || maxY <= minY) return null;
  const inkW = maxX - minX;
  const inkH = maxY - minY;
  if (inkW < 90 || inkH < 58) return null;

  const inkArea = inkW * inkH;
  if (nonWhiteCount / Math.max(1, inkArea) < 0.015) return null;

  const margin = 6;
  return {
    x0: Math.max(0, minX - margin),
    y0: Math.max(hardTop, minY - margin),
    x1: Math.min(width, maxX + margin),
    y1: Math.min(hardBottom, maxY + margin),
  };
}

/**
 * Fallback detector for pages with vector diagrams/charts (no embedded raster images).
 * Excludes external prose lines and finds contiguous large non-text graphic bands.
 */
function detectVectorDiagramBoxes(
  imgData: ImageData,
  textLines: TextLine[],
  pageHasGraphicOps: boolean
): Box[] {
  if (!pageHasGraphicOps) return [];
  const { width, height, data } = imgData;
  const topBound = Math.round(height * 0.06);
  const bottomBound = Math.round(height * 0.94);

  // Build quick row/pixel mask of prose lines to exclude
  const proseLines = textLines.filter(
    (line) =>
      line.y0 < bottomBound &&
      line.y1 > topBound &&
      (isSeparatingProseOrCaptionLine(line, width) ||
        line.y1 < height * 0.085 ||
        line.y0 > height * 0.915)
  );

  // If almost the entire page is text and very little area could be a diagram, skip
  const rowHasGraphicInk = new Uint8Array(height);
  const rowMinX = new Int32Array(height).fill(width);
  const rowMaxX = new Int32Array(height).fill(0);

  for (let y = topBound; y < bottomBound; y++) {
    const rowProse = proseLines.filter(
      (l) => y >= Math.floor(l.y0) - 3 && y <= Math.ceil(l.y1) + 3
    );
    let hits = 0;
    let colorHits = 0;
    const rowOffset = y * width * 4;

    for (let x = 0; x < width; x++) {
      let insideProse = false;
      for (const pl of rowProse) {
        if (x >= pl.x0 - 4 && x <= pl.x1 + 4) {
          insideProse = true;
          break;
        }
      }
      if (insideProse) continue;

      const idx = rowOffset + x * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];
      if (isNonWhitePixel(r, g, b, a)) {
        hits++;
        if (isChromaticPixel(r, g, b)) colorHits++;
        if (x < rowMinX[y]) rowMinX[y] = x;
        if (x + 1 > rowMaxX[y]) rowMaxX[y] = x + 1;
      }
    }

    if (hits >= 14 || colorHits >= 4) {
      rowHasGraphicInk[y] = 1;
    }
  }

  // Group active rows allowing small gaps up to 22px
  const bands: Box[] = [];
  let inBand = false;
  let bTop = 0;
  let bBottom = 0;
  let bMinX = width;
  let bMaxX = 0;
  let gap = 0;

  for (let y = topBound; y < bottomBound; y++) {
    if (rowHasGraphicInk[y]) {
      if (!inBand) {
        inBand = true;
        bTop = y;
        bMinX = rowMinX[y];
        bMaxX = rowMaxX[y];
      } else {
        bMinX = Math.min(bMinX, rowMinX[y]);
        bMaxX = Math.max(bMaxX, rowMaxX[y]);
      }
      bBottom = y + 1;
      gap = 0;
    } else if (inBand) {
      gap++;
      if (gap > 22) {
        bands.push({ x0: bMinX, y0: bTop, x1: bMaxX, y1: bBottom });
        inBand = false;
      }
    }
  }
  if (inBand) {
    bands.push({ x0: bMinX, y0: bTop, x1: bMaxX, y1: bBottom });
  }

  return bands
    .filter((b) => boxWidth(b) >= width * 0.24 && boxHeight(b) >= 110)
    .map((b) => ({
      x0: Math.max(0, b.x0 - 8),
      y0: Math.max(0, b.y0 - 8),
      x1: Math.min(width, b.x1 + 8),
      y1: Math.min(height, b.y1 + 8),
    }));
}

/**
 * Build a topic-rich caption using nearby "Gambar ..." labels and adjacent context lines
 * so Q&A matching can distinguish multiple figures even on the same PDF page.
 */
function buildFigureCaption(
  pageNumber: number,
  figIndex: number,
  totalFiguresOnPage: number,
  figBox: Box,
  externalLines: TextLine[],
  prevFigBottomY: number,
  nextFigTopY: number
): string {
  // Look strictly within the zone belonging to this figure
  const zoneTop = Math.max(prevFigBottomY - 4, figBox.y0 - 115);
  const zoneBottom = Math.min(nextFigTopY + 4, figBox.y1 + 70);

  const nearbyAbove = externalLines
    .filter((l) => l.y1 <= figBox.y0 + 14 && l.y0 >= zoneTop)
    .sort((a, b) => b.y1 - a.y1); // closest first
  const nearbyBelow = externalLines
    .filter((l) => l.y0 >= figBox.y1 - 14 && l.y1 <= zoneBottom)
    .sort((a, b) => a.y0 - b.y0); // closest first

  const explicitAbove = nearbyAbove.find((l) => CAPTION_LINE_REGEX.test(l.text));
  const explicitBelow = nearbyBelow.find((l) => CAPTION_LINE_REGEX.test(l.text));
  const explicitCaption = explicitAbove || explicitBelow;

  // Context text (chronological top-to-bottom from nearby above lines)
  const contextLines = [...nearbyAbove]
    .slice(0, 3)
    .reverse()
    .map((l) => l.text);
  if (explicitBelow && !contextLines.includes(explicitBelow.text)) {
    contextLines.push(explicitBelow.text);
  }
  const contextSnippet = contextLines
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);

  if (explicitCaption) {
    const extra = contextSnippet
      .replace(explicitCaption.text, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 95);
    return extra
      ? `Halaman ${pageNumber} — ${explicitCaption.text} (${extra})`
      : `Halaman ${pageNumber} — ${explicitCaption.text}`;
  }

  if (contextSnippet) {
    const label = totalFiguresOnPage > 1 ? ` · Gambar ${figIndex + 1}` : '';
    return `Halaman ${pageNumber}${label} — ${contextSnippet}${contextSnippet.length >= 150 ? '...' : ''}`;
  }

  return totalFiguresOnPage > 1
    ? `Halaman ${pageNumber} — Gambar Utama ${figIndex + 1}`
    : `Halaman ${pageNumber} — Gambar Utama`;
}

function encodeCroppedCanvas(
  sourceCanvas: HTMLCanvasElement,
  crop: Box,
  maxBytes: number
): { dataUrl: string; bytes: number } {
  const sx = Math.max(0, Math.floor(crop.x0));
  const sy = Math.max(0, Math.floor(crop.y0));
  const sw = Math.max(1, Math.min(sourceCanvas.width - sx, Math.ceil(crop.x1 - sx)));
  const sh = Math.max(1, Math.min(sourceCanvas.height - sy, Math.ceil(crop.y1 - sy)));

  const maxCropW = 860;
  const destScale = sw > maxCropW ? maxCropW / sw : 1;
  const dw = Math.max(1, Math.round(sw * destScale));
  const dh = Math.max(1, Math.round(sh * destScale));

  const outCanvas = document.createElement('canvas');
  outCanvas.width = dw;
  outCanvas.height = dh;
  const oCtx = outCanvas.getContext('2d');
  if (!oCtx) {
    const fallbackUrl = sourceCanvas.toDataURL('image/jpeg', 0.6);
    return { dataUrl: fallbackUrl, bytes: estimateDataUrlBytes(fallbackUrl) };
  }

  oCtx.fillStyle = '#ffffff';
  oCtx.fillRect(0, 0, dw, dh);
  oCtx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, dw, dh);

  const qualities = [0.82, 0.7, 0.58, 0.45];
  let chosenUrl = outCanvas.toDataURL('image/jpeg', qualities[0]);
  let chosenBytes = estimateDataUrlBytes(chosenUrl);

  for (let i = 1; i < qualities.length && chosenBytes > maxBytes; i++) {
    const candidate = outCanvas.toDataURL('image/jpeg', qualities[i]);
    chosenUrl = candidate;
    chosenBytes = estimateDataUrlBytes(candidate);
  }

  if (chosenBytes > maxBytes && dw > 560) {
    const r = 560 / dw;
    const smallCanvas = document.createElement('canvas');
    smallCanvas.width = 560;
    smallCanvas.height = Math.max(1, Math.round(dh * r));
    const sCtx = smallCanvas.getContext('2d');
    if (sCtx) {
      sCtx.fillStyle = '#ffffff';
      sCtx.fillRect(0, 0, smallCanvas.width, smallCanvas.height);
      sCtx.drawImage(outCanvas, 0, 0, smallCanvas.width, smallCanvas.height);
      chosenUrl = smallCanvas.toDataURL('image/jpeg', 0.5);
      chosenBytes = estimateDataUrlBytes(chosenUrl);
    }
  }

  return { dataUrl: chosenUrl, bytes: chosenBytes };
}

export async function extractPdfVisualPages(
  file: File,
  options?: { maxPages?: number; maxTotalBytes?: number }
): Promise<PdfVisualExtractResult> {
  const isPdf =
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) {
    return { totalPages: 0, visualPages: [] };
  }

  const maxFigures = options?.maxPages ?? MAX_DEFAULT_PAGES;
  const maxTotalBytes = options?.maxTotalBytes ?? MAX_TOTAL_IMAGE_BYTES;

  let pdfDoc: pdfjsLib.PDFDocumentProxy | null = null;
  let loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;
  try {
    const buffer = await file.arrayBuffer();
    loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
    });
    pdfDoc = await loadingTask.promise;
    const totalPages = pdfDoc.numPages || 0;
    if (totalPages === 0) {
      return { totalPages: 0, visualPages: [] };
    }

    const inspectCount = Math.min(totalPages, MAX_INSPECT_PAGES);
    const pageMeta: {
      pageNumber: number;
      hasRasterImage: boolean;
      hasGraphicOps: boolean;
    }[] = [];

    const rasterOps = new Set<number>([
      pdfjsLib.OPS.paintImageXObject,
      pdfjsLib.OPS.paintInlineImageXObject,
      pdfjsLib.OPS.paintImageMaskXObject,
      pdfjsLib.OPS.paintImageXObjectRepeat,
      pdfjsLib.OPS.paintFormXObjectBegin,
    ]);

    for (let p = 1; p <= inspectCount; p++) {
      let hasRasterImage = false;
      let hasGraphicOps = false;
      try {
        const page = await pdfDoc.getPage(p);
        const opList = await page.getOperatorList();
        let pathCount = 0;
        for (const fn of opList.fnArray) {
          if (rasterOps.has(fn)) hasRasterImage = true;
          if (fn === pdfjsLib.OPS.constructPath || fn === pdfjsLib.OPS.shadingFill) {
            pathCount++;
          }
        }
        hasGraphicOps = pathCount >= 4;
        page.cleanup();
      } catch {
        hasRasterImage = false;
        hasGraphicOps = false;
      }
      pageMeta.push({ pageNumber: p, hasRasterImage, hasGraphicOps });
    }

    // Prioritize pages that actually contain embedded images/diagrams
    const pagesWithVisuals = pageMeta.filter(
      (m) => m.hasRasterImage || m.hasGraphicOps
    );
    const candidatePages =
      pagesWithVisuals.length > 0
        ? pagesWithVisuals.slice(0, maxFigures)
        : pageMeta.slice(0, Math.min(4, maxFigures));
    candidatePages.sort((a, b) => a.pageNumber - b.pageNumber);

    const estimatedFigures = Math.min(
      maxFigures,
      Math.max(candidatePages.length, Math.ceil(candidatePages.length * 1.5))
    );
    const perFigureBudget = Math.max(
      24 * 1024,
      Math.floor(maxTotalBytes / Math.max(1, estimatedFigures))
    );

    const visualPages: SopAttachmentVisualPage[] = [];
    let totalBytes = 0;

    for (const meta of candidatePages) {
      if (totalBytes >= maxTotalBytes || visualPages.length >= maxFigures) break;
      const page = await pdfDoc.getPage(meta.pageNumber);

      const baseViewport = page.getViewport({ scale: 1 });
      const targetWidth = Math.min(1180, Math.max(920, baseViewport.width * 1.55));
      const scale = Math.min(2.0, targetWidth / Math.max(1, baseViewport.width));
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        page.cleanup();
        continue;
      }

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const renderTask = page.render({
        canvas,
        canvasContext: ctx,
        viewport,
        recordImages: true,
      });
      await renderTask.promise;

      const textLines = await extractCanvasTextLines(page, viewport);
      const imageCoordinates =
        (page as unknown as { imageCoordinates?: ArrayLike<number> | null })
          .imageCoordinates ??
        (renderTask as unknown as { imageCoordinates?: ArrayLike<number> | null })
          .imageCoordinates;
      page.cleanup();

      const rawRects = parseRecordedImageRects(
        imageCoordinates,
        canvas.width,
        canvas.height
      );

      const externalLines = textLines.filter(
        (line) => !isLineInsideAnyRect(line, rawRects)
      );

      const pageImgData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      // 1. Primary: detect composite raster figure clusters (e.g. screenshots + red arrows)
      let figureBoxes: Box[] = [];
      if (rawRects.length > 0) {
        const clusters = clusterImageRects(
          rawRects,
          externalLines,
          canvas.width,
          canvas.height
        );
        for (const cl of clusters) {
          const refined = refineFigureCropBox(cl, externalLines, pageImgData);
          if (refined) {
            figureBoxes.push(refined);
          }
        }
      }

      // 2. Secondary: vector diagram fallback if no raster figure clusters were detected
      if (figureBoxes.length === 0) {
        figureBoxes = detectVectorDiagramBoxes(
          pageImgData,
          textLines,
          meta.hasGraphicOps || meta.hasRasterImage
        );
      }

      // 3. Ultimate fallback ONLY if no visual sub-region could be isolated and no text prose covers the page
      if (figureBoxes.length === 0 && pagesWithVisuals.length === 0) {
        figureBoxes = [{ x0: 0, y0: 0, x1: canvas.width, y1: canvas.height }];
      }

      figureBoxes.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);

      for (let fIdx = 0; fIdx < figureBoxes.length; fIdx++) {
        if (visualPages.length >= maxFigures) break;
        const figBox = figureBoxes[fIdx];
        const prevFigBottomY = fIdx > 0 ? figureBoxes[fIdx - 1].y1 : 0;
        const nextFigTopY =
          fIdx + 1 < figureBoxes.length ? figureBoxes[fIdx + 1].y0 : canvas.height;

        const { dataUrl, bytes } = encodeCroppedCanvas(
          canvas,
          figBox,
          perFigureBudget
        );

        if (totalBytes + bytes > maxTotalBytes && visualPages.length > 0) {
          break;
        }

        const caption = buildFigureCaption(
          meta.pageNumber,
          fIdx,
          figureBoxes.length,
          figBox,
          externalLines,
          prevFigBottomY,
          nextFigTopY
        );

        totalBytes += bytes;
        visualPages.push({
          pageNumber: meta.pageNumber,
          caption,
          dataUrl,
        });
      }
    }

    return { totalPages, visualPages };
  } catch (err) {
    console.warn('PDF visual extraction skipped:', err);
    return { totalPages: 0, visualPages: [] };
  } finally {
    if (pdfDoc) {
      await pdfDoc.cleanup().catch(() => {});
    }
    if (loadingTask) {
      await loadingTask.destroy().catch(() => {});
    }
  }
}
