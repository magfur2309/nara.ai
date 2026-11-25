import * as XLSX from 'xlsx';
import type {
  AiChartSpec,
  ChartColorPalette,
  ChartSeriesData,
  ChartSortMode,
  ChartType,
  ChartValueFormat,
} from '../types/sop';

export interface ChartTypeOption {
  id: ChartType;
  label: string;
  shortLabel: string;
  description: string;
}

export const CHART_TYPE_OPTIONS: ChartTypeOption[] = [
  {
    id: 'bar',
    label: 'Diagram Batang',
    shortLabel: 'Batang',
    description: 'Perbandingan nilai antar kategori atau periode',
  },
  {
    id: 'horizontal_bar',
    label: 'Batang Horizontal',
    shortLabel: 'Horizontal',
    description: 'Ideal untuk ranking atau nama kategori yang panjang',
  },
  {
    id: 'line',
    label: 'Diagram Garis',
    shortLabel: 'Garis',
    description: 'Menunjukkan tren perubahan dari waktu ke waktu',
  },
  {
    id: 'area',
    label: 'Diagram Area',
    shortLabel: 'Area',
    description: 'Menekankan volume dan pertumbuhan tren',
  },
  {
    id: 'donut',
    label: 'Diagram Donat',
    shortLabel: 'Donat',
    description: 'Menunjukkan proporsi kontribusi dengan total di tengah',
  },
  {
    id: 'pie',
    label: 'Diagram Lingkaran',
    shortLabel: 'Lingkaran',
    description: 'Distribusi persentase bagian terhadap keseluruhan',
  },
  {
    id: 'stacked_bar',
    label: 'Batang Tumpuk',
    shortLabel: 'Tumpuk',
    description: 'Komposisi total multi-seri per kategori/periode',
  },
];

export const CHART_PALETTES: Record<
  ChartColorPalette,
  { label: string; colors: string[] }
> = {
  corporate: {
    label: 'Korporat Biru',
    colors: [
      '#2563EB',
      '#0EA5E9',
      '#6366F1',
      '#0D9488',
      '#F59E0B',
      '#E11D48',
      '#8B5CF6',
      '#64748B',
    ],
  },
  emerald: {
    label: 'Finansial Hijau',
    colors: [
      '#059669',
      '#0284C7',
      '#0D9488',
      '#D97706',
      '#4F46E5',
      '#DC2626',
      '#16A34A',
      '#475569',
    ],
  },
  boardroom: {
    label: 'Eksekutif Slate',
    colors: [
      '#1E293B',
      '#2563EB',
      '#B45309',
      '#047857',
      '#6D28D9',
      '#BE123C',
      '#0369A1',
      '#64748B',
    ],
  },
  contrast: {
    label: 'Kontras Proyektor',
    colors: [
      '#1D4ED8',
      '#DC2626',
      '#15803D',
      '#D97706',
      '#7E22CE',
      '#0E7490',
      '#BE185D',
      '#374151',
    ],
  },
};

/** Calm, desaturated chart palettes specifically tuned for low-glare light mode */
export const CHART_PALETTES_LIGHT: Record<ChartColorPalette, string[]> = {
  corporate: [
    '#3B6EA5',
    '#4A8B9C',
    '#5E6BA8',
    '#3E857B',
    '#B6842C',
    '#A8505F',
    '#7964A4',
    '#5E6A75',
  ],
  emerald: [
    '#2E7D5B',
    '#3B7599',
    '#3C827B',
    '#B07D2B',
    '#565FA0',
    '#A64A46',
    '#417D4D',
    '#586573',
  ],
  boardroom: [
    '#384556',
    '#3B6EA5',
    '#9A6728',
    '#2F7259',
    '#6B5496',
    '#9E4557',
    '#396E8E',
    '#64707C',
  ],
  contrast: [
    '#355D96',
    '#A83D3B',
    '#2B6E46',
    '#A36D1C',
    '#6B4991',
    '#2C6D7D',
    '#994068',
    '#49525E',
  ],
};

export interface ChartInsightStats {
  total: number;
  average: number;
  maxItem: { label: string; value: number };
  minItem: { label: string; value: number };
  topSharePct: number | null;
  trendPct: number | null;
  isChronological: boolean;
  count: number;
}

const MONTH_KEYWORDS_REGEX =
  /\b(jan|januari|january|feb|februari|february|mar|maret|march|apr|april|mei|may|jun|juni|june|jul|juli|july|agu|ags|agustus|august|sep|sept|september|okt|oct|oktober|october|nov|november|des|dec|desember|december|q[1-4]|triwulan|kuartal|minggu|week|202\d)\b/i;

const SUMMARY_ROW_REGEX =
  /^(total|grand\s*total|sub\s*total|subtotal|jumlah(\s+keseluruhan)?|keseluruhan|rata[- ]?rata|average|net\s+total|akumulasi)\b/i;

const INDEX_HEADER_REGEX = /^(no\.?|#|urut|id|nomor)$/i;

const NON_METRIC_HEADER_REGEX =
  /\b(kode|code|nomor|no\.?\s*faktur|no\.?\s*dok|sku|plat|nopol|telepon|telp|hp|nik|npwp|tahun|year|tgl|tanggal|date|periode|bulan|month|status|kondisi|keterangan|catatan)\b/i;

const CURRENCY_HEADER_REGEX =
  /\b(rp|idr|rupiah|harga|nilai|omzet|omset|penjualan|pendapatan|revenue|hpp|cogs|laba|rugi|profit|loss|beban|biaya|expense|opex|piutang|hutang|utang|ar|ap|saldo|kas|bank|bayar|dibayar|pembelian|purchase|buku|perolehan|akumulasi|penyusutan|depresiasi|nominal|tagihan|anggaran|budget)\b/i;

const PERCENT_HEADER_REGEX = /\b(persen|persentase|margin|rasio|ratio|growth|pertumbuhan|porsi|share|%|rate|tingkat)\b/i;

export function formatChartValue(
  value: number,
  format: ChartValueFormat,
  unitLabel = '',
  compact = false
): string {
  if (!Number.isFinite(value)) return '0';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);

  if (format === 'percent') {
    const formatted = abs.toLocaleString('id-ID', {
      minimumFractionDigits: abs % 1 === 0 ? 0 : 1,
      maximumFractionDigits: 2,
    });
    return `${sign}${formatted}%`;
  }

  if (format === 'currency') {
    if (compact) {
      if (abs >= 1_000_000_000_000) {
        return `${sign}Rp ${(abs / 1_000_000_000_000).toLocaleString('id-ID', {
          maximumFractionDigits: 2,
        })} T`;
      }
      if (abs >= 1_000_000_000) {
        return `${sign}Rp ${(abs / 1_000_000_000).toLocaleString('id-ID', {
          maximumFractionDigits: 2,
        })} M`;
      }
      if (abs >= 1_000_000) {
        return `${sign}Rp ${(abs / 1_000_000).toLocaleString('id-ID', {
          maximumFractionDigits: 1,
        })} Jt`;
      }
      if (abs >= 1_000) {
        return `${sign}Rp ${(abs / 1_000).toLocaleString('id-ID', {
          maximumFractionDigits: 0,
        })} Rb`;
      }
    }
    const hasCents = abs > 0 && abs < 10_000 && Math.abs(abs - Math.round(abs)) > 0.005;
    return `${sign}Rp ${abs.toLocaleString('id-ID', {
      minimumFractionDigits: hasCents ? 2 : 0,
      maximumFractionDigits: hasCents ? 2 : 0,
    })}`;
  }

  // format === 'number'
  const cleanUnit = unitLabel.trim();
  if (compact && abs >= 1_000_000_000) {
    return `${sign}${(abs / 1_000_000_000).toLocaleString('id-ID', {
      maximumFractionDigits: 2,
    })} M${cleanUnit ? ` ${cleanUnit}` : ''}`;
  }
  if (compact && abs >= 1_000_000) {
    return `${sign}${(abs / 1_000_000).toLocaleString('id-ID', {
      maximumFractionDigits: 1,
    })} Jt${cleanUnit ? ` ${cleanUnit}` : ''}`;
  }
  if (compact && abs >= 10_000) {
    return `${sign}${(abs / 1_000).toLocaleString('id-ID', {
      maximumFractionDigits: 1,
    })} Rb${cleanUnit ? ` ${cleanUnit}` : ''}`;
  }
  const numStr = abs.toLocaleString('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: abs % 1 === 0 ? 0 : 2,
  });
  return `${sign}${numStr}${cleanUnit ? ` ${cleanUnit}` : ''}`;
}

function stripMarkdownInline(raw: string): string {
  return raw
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface ParsedCellNumeric {
  value: number;
  isCurrency: boolean;
  isPercent: boolean;
  unit: string;
}

export function parseIndonesianNumericCell(rawCell: string): ParsedCellNumeric | null {
  const cleaned = stripMarkdownInline(rawCell);
  if (!cleaned || cleaned === '-' || cleaned === '—' || cleaned === 'N/A' || cleaned === 'n/a') {
    return null;
  }

  // Reject dates (2026-04-06, 06/04/2026, 2026-04) and invoice/COA codes
  if (
    /^\d{4}[-/]\d{1,2}([-/]\d{1,2})?$/.test(cleaned) ||
    /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(cleaned) ||
    /^[A-Z]{2,}[-/]?\d+/i.test(cleaned) ||
    /^\d{6}\.\d{3}$/.test(cleaned)
  ) {
    return null;
  }

  let working = cleaned;
  let negative = false;

  // Accounting negative format: (4.770.417.285,77) or (Rp 1.200.000)
  if (/^\(.+\)$/.test(working)) {
    negative = true;
    working = working.slice(1, -1).trim();
  }

  const isCurrency = /\b(rp\.?|idr)\b/i.test(working) || /^rp\.?\s*/i.test(working);
  const isPercent = working.includes('%');

  if (working.startsWith('-')) {
    negative = true;
    working = working.slice(1).trim();
  } else if (working.startsWith('+')) {
    working = working.slice(1).trim();
  }

  working = working.replace(/^(rp\.?|idr)\s*/i, '').trim();
  if (working.startsWith('-')) {
    negative = true;
    working = working.slice(1).trim();
  }

  // Match leading numeric token plus optional suffix/unit
  const match = working.match(
    /^(\d[\d.,\s]*)(?:\s*(%|triliun|miliar|milyar|juta|jt|ribu|rb|unit|pcs|buah|faktur|transaksi|item|aset|orang|bulan|tahun|hari|kg|ton|liter|box|paket|dokumen|sop|jam|km))?$/i
  );
  if (!match) return null;

  const numToken = match[1].replace(/\s+/g, '');
  const suffixRaw = (match[2] || '').trim();
  const suffixLower = suffixRaw.toLowerCase();

  let normalized = numToken;
  const hasDot = normalized.includes('.');
  const hasComma = normalized.includes(',');

  if (hasDot && hasComma) {
    const lastDot = normalized.lastIndexOf('.');
    const lastComma = normalized.lastIndexOf(',');
    if (lastComma > lastDot) {
      // Indonesian style: 9.147.029.581,00
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      // English style: 9,147,029,581.00
      normalized = normalized.replace(/,/g, '');
    }
  } else if (hasDot) {
    // Check if dots are thousand separators (e.g. 10.870.651.527 or 23.565.648 or 1.500)
    if (/^\d{1,3}(\.\d{3})+$/.test(normalized)) {
      normalized = normalized.replace(/\./g, '');
    }
  } else if (hasComma) {
    if (/^\d{1,3}(,\d{3})+$/.test(normalized)) {
      normalized = normalized.replace(/,/g, '');
    } else {
      normalized = normalized.replace(',', '.');
    }
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;

  let multiplier = 1;
  let unit = '';
  if (suffixLower === 'triliun') multiplier = 1_000_000_000_000;
  else if (suffixLower === 'miliar' || suffixLower === 'milyar') multiplier = 1_000_000_000;
  else if (suffixLower === 'juta' || suffixLower === 'jt') multiplier = 1_000_000;
  else if (suffixLower === 'ribu' || suffixLower === 'rb') multiplier = 1_000;
  else if (suffixLower && suffixLower !== '%') unit = suffixRaw;

  const finalVal = (negative ? -1 : 1) * parsed * multiplier;
  return {
    value: Math.round(finalVal * 100) / 100,
    isCurrency,
    isPercent: isPercent || suffixLower === '%',
    unit,
  };
}

export function isChronologicalLabels(labels: string[]): boolean {
  if (labels.length < 2) return false;
  let matches = 0;
  for (const label of labels) {
    if (
      MONTH_KEYWORDS_REGEX.test(label) ||
      /^\d{4}[-/]\d{1,2}/.test(label.trim()) ||
      /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(label.trim())
    ) {
      matches++;
    }
  }
  return matches / labels.length >= 0.6;
}

const EXPLICIT_CHART_REQUEST_REGEX =
  /\b(diagram|grafik|chart|pie\s*chart|bar\s*chart|line\s*chart|area\s*chart|donut\s*chart|donat|donut|doughnut|histogram|kurva|visualisasi\s+(?:data|angka|grafik|tabel)?|bahan\s+presentasi|slide\s+presentasi)\b/i;

const CONTEXTUAL_CHART_PHRASE_REGEX =
  /\b(?:buat(?:kan)?|tampilkan|sajikan|ubah|jadikan|konversi|ganti|pakai|dalam\s+bentuk|mode|lihat)\s+(?:ke\s+|dalam\s+)?(?:diagram|grafik|chart|pie|lingkaran|donat|donut|batang|bar|garis|line|area|tumpuk|stacked|visualisasi|presentasi|slide)\b/i;

const SOP_FLOWCHART_ONLY_REGEX =
  /\b(flowchart|alur\s+sop|alur\s+kerja|alur\s+prosedur|bagan\s+alur|struktur\s+organisasi)\b/i;

export function isChartRequest(question?: string): boolean {
  const q = (question || '').trim();
  if (!q) return false;
  if (SOP_FLOWCHART_ONLY_REGEX.test(q) && !/\b(grafik|chart|pie|donat|donut|batang|bar|garis|line|area|tumpuk|stacked|presentasi)\b/i.test(q)) {
    return false;
  }
  return EXPLICIT_CHART_REQUEST_REGEX.test(q) || CONTEXTUAL_CHART_PHRASE_REGEX.test(q);
}

export function detectRequestedChartType(question?: string): ChartType | null {
  const q = (question || '').toLowerCase();
  if (!q) return null;
  if (/\b(donat|donut|doughnut)\b/.test(q)) return 'donut';
  if (/\b(pie|lingkaran|pai)\b/.test(q)) return 'pie';
  if (/\b(stacked|tumpuk|bertumpuk)\b/.test(q)) return 'stacked_bar';
  if (/\b(horizontal|mendatar|ranking|peringkat|top\s+\d+)\b/.test(q)) return 'horizontal_bar';
  if (/\b(area)\b/.test(q)) return 'area';
  if (/\b(line|garis|tren|trend|perkembangan|per\s+bulan|bulanan)\b/.test(q)) return 'line';
  if (/\b(bar|batang|kolom|column|perbandingan)\b/.test(q)) return 'bar';
  return null;
}

function chooseRecommendedChartType(params: {
  question?: string;
  labels: string[];
  series: ChartSeriesData[];
  valueFormat: ChartValueFormat;
}): ChartType {
  const explicit = detectRequestedChartType(params.question);
  if (explicit) {
    // Pie/donut requires single series with mostly positive values
    if (explicit === 'pie' || explicit === 'donut') {
      const vals = params.series[0]?.values || [];
      if (vals.some((v) => v > 0)) return explicit;
    } else {
      return explicit;
    }
  }

  const { labels, series } = params;
  const chrono = isChronologicalLabels(labels);
  const qLower = (params.question || '').toLowerCase();

  if (chrono && labels.length >= 3) {
    return series.length > 2 ? 'bar' : 'line';
  }

  if (
    series.length === 1 &&
    labels.length >= 2 &&
    labels.length <= 6 &&
    series[0].values.every((v) => v >= 0) &&
    /\b(porsi|komposisi|proporsi|distribusi|persentase|sebaran|pembagian)\b/.test(qLower)
  ) {
    return 'donut';
  }

  const avgLabelLen =
    labels.reduce((sum, l) => sum + l.length, 0) / Math.max(1, labels.length);
  if (series.length === 1 && (avgLabelLen > 16 || labels.length > 7)) {
    return 'horizontal_bar';
  }

  return 'bar';
}

interface ParsedMarkdownTable {
  headers: string[];
  rows: string[][];
  headingContext: string;
}

function parseMarkdownTables(markdown: string): ParsedMarkdownTable[] {
  const lines = markdown.split(/\r?\n/);
  const tables: ParsedMarkdownTable[] = [];
  let lastHeading = '';

  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (/^#{1,4}\s+/.test(trimmed)) {
      lastHeading = stripMarkdownInline(trimmed.replace(/^#{1,4}\s+/, ''));
      i++;
      continue;
    }
    if (/^\*\*[^*]{4,90}\*\*:?$/.test(trimmed)) {
      lastHeading = stripMarkdownInline(trimmed.replace(/:$/, ''));
      i++;
      continue;
    }

    const nextTrimmed = i + 1 < lines.length ? lines[i + 1].trim() : '';
    const isTableHeader =
      trimmed.includes('|') &&
      nextTrimmed.includes('|') &&
      /^\|?[\s:]*-{2,}[\s:]*(\|[\s:]*-{2,}[\s:]*)+\|?$/.test(nextTrimmed);

    if (!isTableHeader) {
      i++;
      continue;
    }

    const splitRow = (line: string): string[] => {
      let s = line.trim();
      if (s.startsWith('|')) s = s.slice(1);
      if (s.endsWith('|')) s = s.slice(0, -1);
      return s.split('|').map((c) => stripMarkdownInline(c));
    };

    const headers = splitRow(trimmed);
    const rows: string[][] = [];
    i += 2;

    while (i < lines.length) {
      const rLine = lines[i].trim();
      if (!rLine || !rLine.includes('|')) break;
      const cells = splitRow(rLine);
      if (cells.length >= 2) {
        while (cells.length < headers.length) cells.push('');
        rows.push(cells.slice(0, headers.length));
      }
      i++;
    }

    if (headers.length >= 2 && rows.length >= 2) {
      tables.push({ headers, rows, headingContext: lastHeading });
    }
  }

  return tables;
}

function deriveTitleFromContext(
  headingContext: string,
  userQuestion: string | undefined,
  seriesNames: string[],
  categoryLabel: string
): string {
  if (headingContext && headingContext.length >= 4 && headingContext.length <= 100) {
    return headingContext;
  }
  const cleanQ = (userQuestion || '')
    .replace(/\?+$/, '')
    .replace(/^(tolong|mohon|coba|bisa|tampilkan|buatkan|berikan|jelaskan|lihat|cek|analisa|analisis)\s+/i, '')
    .trim();
  if (cleanQ.length >= 6 && cleanQ.length <= 90) {
    return cleanQ.charAt(0).toUpperCase() + cleanQ.slice(1);
  }
  if (seriesNames.length === 1) {
    return `${seriesNames[0]} per ${categoryLabel}`;
  }
  return `Analisis ${seriesNames.slice(0, 2).join(' vs ')}`;
}

function buildSpecFromTable(
  table: ParsedMarkdownTable,
  userQuestion?: string,
  fallbackSourceLabel?: string
): { spec: AiChartSpec; score: number } | null {
  const { headers, rows } = table;
  // Filter out Total/Subtotal/Average rows
  const filteredRows = rows.filter((row) => {
    const firstNonEmpty = row.find((c) => c.trim().length > 0) || '';
    const secondCell = row[1] || '';
    return !SUMMARY_ROW_REGEX.test(firstNonEmpty.trim()) && !SUMMARY_ROW_REGEX.test(secondCell.trim());
  });

  if (filteredRows.length < 2) return null;

  // Analyze each column
  const colMeta = headers.map((header, colIdx) => {
    const headerTrim = header.trim();
    const isIndexHeader = INDEX_HEADER_REGEX.test(headerTrim);
    const isNonMetricHeader = NON_METRIC_HEADER_REGEX.test(headerTrim);

    let numericHits = 0;
    let currencyHits = 0;
    let percentHits = 0;
    const unitCounts = new Map<string, number>();
    const parsedValues: (number | null)[] = [];

    for (const row of filteredRows) {
      const parsed = parseIndonesianNumericCell(row[colIdx] || '');
      if (parsed) {
        numericHits++;
        if (parsed.isCurrency) currencyHits++;
        if (parsed.isPercent) percentHits++;
        if (parsed.unit) {
          unitCounts.set(parsed.unit, (unitCounts.get(parsed.unit) || 0) + 1);
        }
        parsedValues.push(parsed.value);
      } else {
        parsedValues.push(null);
      }
    }

    const numericRatio = numericHits / filteredRows.length;
    // Detect sequential index column (1, 2, 3, ...)
    const isSequentialIndex =
      isIndexHeader ||
      (colIdx === 0 &&
        numericHits === filteredRows.length &&
        parsedValues.every((v, idx) => v === idx + 1));

    let dominantUnit = '';
    let maxUnitCount = 0;
    for (const [u, c] of unitCounts.entries()) {
      if (c > maxUnitCount) {
        dominantUnit = u;
        maxUnitCount = c;
      }
    }

    const isCurrency =
      currencyHits >= Math.max(1, Math.floor(numericHits * 0.4)) ||
      (CURRENCY_HEADER_REGEX.test(headerTrim) && percentHits === 0);
    const isPercent =
      percentHits >= Math.max(1, Math.floor(numericHits * 0.4)) ||
      (PERCENT_HEADER_REGEX.test(headerTrim) && currencyHits === 0);

    const isNumericCandidate =
      !isSequentialIndex &&
      !isNonMetricHeader &&
      numericHits >= 2 &&
      numericRatio >= 0.6;

    return {
      colIdx,
      header: headerTrim || `Kolom ${colIdx + 1}`,
      isSequentialIndex,
      isNumericCandidate,
      isCurrency,
      isPercent,
      dominantUnit,
      parsedValues,
      numericHits,
    };
  });

  const numericCols = colMeta.filter((c) => c.isNumericCandidate);
  if (numericCols.length === 0) return null;

  // Choose best label column (non-numeric, non-index, preferring descriptive names)
  const labelCandidates = colMeta.filter((c) => !c.isSequentialIndex && !c.isNumericCandidate);
  if (labelCandidates.length === 0) return null;

  const preferredLabel =
    labelCandidates.find((c) =>
      /\b(bulan|periode|tanggal|tgl|tahun|customer|pelanggan|supplier|vendor|nama|aset|barang|item|produk|kategori|divisi|akun|coa|departemen|cabang|gudang|metrik|keterangan)\b/i.test(
        c.header
      )
    ) || labelCandidates[0];

  // Secondary identifier for disambiguating duplicate labels (e.g., No. Faktur or Kode)
  const secondaryLabelCol = labelCandidates.find(
    (c) => c.colIdx !== preferredLabel.colIdx && !/\b(status|kondisi)\b/i.test(c.header)
  );

  const slicedRows = filteredRows.slice(0, 50);
  const rawLabels = slicedRows.map((row, idx) => {
    const val = (row[preferredLabel.colIdx] || '').trim();
    return val || `Item ${idx + 1}`;
  });

  // Count duplicate labels to disambiguate cleanly
  const labelFreq = new Map<string, number>();
  for (const l of rawLabels) {
    labelFreq.set(l, (labelFreq.get(l) || 0) + 1);
  }

  const labels = rawLabels.map((l, idx) => {
    if ((labelFreq.get(l) || 0) > 1 && secondaryLabelCol) {
      const sec = (slicedRows[idx][secondaryLabelCol.colIdx] || '').trim();
      if (sec && sec !== l) {
        return `${l} (${sec})`.slice(0, 120);
      }
    }
    return l.slice(0, 120);
  });

  // Group compatible numeric columns (prefer currency columns if both currency & percent exist,
  // unless user specifically asked for percent/margin)
  const qLower = (userQuestion || '').toLowerCase();
  const askedPercent = /\b(persen|persentase|margin|rasio|%)\b/.test(qLower);

  const currencyCols = numericCols.filter((c) => c.isCurrency);
  const percentCols = numericCols.filter((c) => c.isPercent && !c.isCurrency);
  const plainCols = numericCols.filter((c) => !c.isCurrency && !c.isPercent);

  let selectedCols = numericCols;
  let valueFormat: ChartValueFormat = 'number';

  if (askedPercent && percentCols.length > 0) {
    selectedCols = percentCols;
    valueFormat = 'percent';
  } else if (currencyCols.length > 0) {
    selectedCols = currencyCols;
    valueFormat = 'currency';
  } else if (percentCols.length > 0 && plainCols.length === 0) {
    selectedCols = percentCols;
    valueFormat = 'percent';
  } else if (plainCols.length > 0) {
    selectedCols = plainCols;
    valueFormat = 'number';
  }

  selectedCols = selectedCols.slice(0, 8);

  const series: ChartSeriesData[] = selectedCols.map((col) => ({
    name: col.header.slice(0, 80),
    values: slicedRows.map((_, rowIdx) => col.parsedValues[rowIdx] ?? 0),
  }));

  // Ensure at least one non-zero value exists
  const hasNonZero = series.some((s) => s.values.some((v) => v !== 0));
  if (!hasNonZero) return null;

  const unitLabel =
    valueFormat === 'currency'
      ? 'Rp'
      : valueFormat === 'percent'
        ? '%'
        : selectedCols[0]?.dominantUnit || '';

  const recommendedType = chooseRecommendedChartType({
    question: userQuestion,
    labels,
    series,
    valueFormat,
  });

  const title = deriveTitleFromContext(
    table.headingContext,
    userQuestion,
    series.map((s) => s.name),
    preferredLabel.header
  );

  const subtitle = `${labels.length} ${preferredLabel.header.toLowerCase()} · ${series.length} metrik data`;

  const spec: AiChartSpec = {
    title: title.slice(0, 140),
    subtitle: subtitle.slice(0, 220),
    recommendedType,
    valueFormat,
    unitLabel: unitLabel.slice(0, 30),
    categoryLabel: preferredLabel.header.slice(0, 60),
    labels,
    series,
    sourceLabel: (fallbackSourceLabel || 'Data Analisa AI').slice(0, 120),
  };

  const score = labels.length * series.length + (valueFormat === 'currency' ? 10 : 0);
  return { spec, score };
}

function buildSpecFromNumericList(
  markdown: string,
  userQuestion?: string,
  fallbackSourceLabel?: string
): AiChartSpec | null {
  const lines = markdown.split(/\r?\n/);
  interface BulletMetric {
    label: string;
    value: number;
    isCurrency: boolean;
    isPercent: boolean;
    unit: string;
  }

  const metrics: BulletMetric[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^(?:[-*•]|\d+\.)\s+(.+?):\s+(.+)$/);
    if (!match) continue;
    const rawLabel = stripMarkdownInline(match[1]);
    const rawVal = stripMarkdownInline(match[2]);
    if (!rawLabel || rawLabel.length > 80) continue;

    // Strip trailing parenthetical explanations like "(14,5%)" or "(Belum Lunas)"
    const primaryValToken = rawVal.replace(/\s*\([^)]*\)\s*$/, '').trim();
    const parsed = parseIndonesianNumericCell(primaryValToken);
    if (!parsed) continue;
    metrics.push({
      label: rawLabel,
      value: parsed.value,
      isCurrency: parsed.isCurrency,
      isPercent: parsed.isPercent,
      unit: parsed.unit,
    });
  }

  if (metrics.length < 2) return null;

  // Keep homogeneous metrics (prefer currency group if >= 2 currency items exist)
  const currencyMetrics = metrics.filter((m) => m.isCurrency);
  const percentMetrics = metrics.filter((m) => m.isPercent && !m.isCurrency);

  let chosen = metrics;
  let valueFormat: ChartValueFormat = 'number';

  if (currencyMetrics.length >= 2) {
    chosen = currencyMetrics;
    valueFormat = 'currency';
  } else if (percentMetrics.length >= 2) {
    chosen = percentMetrics;
    valueFormat = 'percent';
  } else {
    // Only use plain numbers if they share compatible scale/units
    const nonCurrency = metrics.filter((m) => !m.isCurrency && !m.isPercent);
    if (nonCurrency.length < 2) return null;
    chosen = nonCurrency;
    valueFormat = 'number';
  }

  chosen = chosen.slice(0, 20);
  if (!chosen.some((m) => m.value !== 0)) return null;

  const labels = chosen.map((m) => m.label);
  const series: ChartSeriesData[] = [
    {
      name: valueFormat === 'currency' ? 'Nilai (Rp)' : valueFormat === 'percent' ? 'Persentase (%)' : 'Nilai',
      values: chosen.map((m) => m.value),
    },
  ];
  const unitLabel =
    valueFormat === 'currency'
      ? 'Rp'
      : valueFormat === 'percent'
        ? '%'
        : chosen[0]?.unit || '';

  const recommendedType = chooseRecommendedChartType({
    question: userQuestion,
    labels,
    series,
    valueFormat,
  });

  const title = deriveTitleFromContext('', userQuestion, series.map((s) => s.name), 'Metrik');

  return {
    title: title.slice(0, 140),
    subtitle: `Ringkasan ${labels.length} indikator utama`,
    recommendedType,
    valueFormat,
    unitLabel: unitLabel.slice(0, 30),
    categoryLabel: 'Indikator',
    labels,
    series,
    sourceLabel: (fallbackSourceLabel || 'Data Analisa AI').slice(0, 120),
  };
}

export function normalizeAiChartSpec(
  raw: Partial<AiChartSpec> | null | undefined,
  userQuestion?: string,
  fallbackSourceLabel?: string
): AiChartSpec | null {
  if (!raw || !Array.isArray(raw.labels) || !Array.isArray(raw.series)) return null;

  const labels = raw.labels
    .map((l) => String(l ?? '').trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, 50);

  if (labels.length < 2) return null;

  const series: ChartSeriesData[] = [];
  for (const s of raw.series.slice(0, 8)) {
    if (!s || typeof s.name !== 'string' || !Array.isArray(s.values)) continue;
    const vals = labels.map((_, idx) => {
      const n = Number(s.values[idx]);
      return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
    });
    if (vals.some((v) => v !== 0)) {
      series.push({
        name: s.name.trim().slice(0, 80) || `Seri ${series.length + 1}`,
        values: vals,
      });
    }
  }

  if (series.length === 0) return null;

  const validFormat: ChartValueFormat =
    raw.valueFormat === 'currency' || raw.valueFormat === 'percent' || raw.valueFormat === 'number'
      ? raw.valueFormat
      : 'number';

  const validTypes: ChartType[] = [
    'bar',
    'horizontal_bar',
    'line',
    'area',
    'donut',
    'pie',
    'stacked_bar',
  ];

  const userRequested = detectRequestedChartType(userQuestion);
  const recommendedType: ChartType =
    userRequested ||
    (raw.recommendedType && validTypes.includes(raw.recommendedType)
      ? raw.recommendedType
      : chooseRecommendedChartType({
          question: userQuestion,
          labels,
          series,
          valueFormat: validFormat,
        }));

  return {
    title:
      (raw.title || '').trim().slice(0, 140) ||
      deriveTitleFromContext('', userQuestion, series.map((s) => s.name), raw.categoryLabel || 'Kategori'),
    subtitle:
      (raw.subtitle || '').trim().slice(0, 220) ||
      `${labels.length} data · ${series.length} metrik`,
    recommendedType,
    valueFormat: validFormat,
    unitLabel: (raw.unitLabel || (validFormat === 'currency' ? 'Rp' : validFormat === 'percent' ? '%' : '')).slice(0, 30),
    categoryLabel: (raw.categoryLabel || 'Kategori').trim().slice(0, 60),
    labels,
    series,
    insightSummary: (raw.insightSummary || '').trim().slice(0, 280) || undefined,
    sourceLabel: (raw.sourceLabel || fallbackSourceLabel || 'Data Analisa AI').trim().slice(0, 120),
  };
}

export function extractChartSpecFromAnswer(
  answerMarkdown: string,
  userQuestion?: string,
  aiChartSpec?: Partial<AiChartSpec> | null,
  fallbackSourceLabel?: string
): AiChartSpec | null {
  const fromAi = normalizeAiChartSpec(aiChartSpec, userQuestion, fallbackSourceLabel);
  if (fromAi) return fromAi;

  if (!answerMarkdown || answerMarkdown.trim().length < 20) return null;

  const tables = parseMarkdownTables(answerMarkdown);
  let best: { spec: AiChartSpec; score: number } | null = null;
  for (const table of tables) {
    const candidate = buildSpecFromTable(table, userQuestion, fallbackSourceLabel);
    if (candidate && (!best || candidate.score > best.score)) {
      best = candidate;
    }
  }
  if (best) return best.spec;

  return buildSpecFromNumericList(answerMarkdown, userQuestion, fallbackSourceLabel);
}

export function applySortToChartData(
  labels: string[],
  series: ChartSeriesData[],
  activeSeriesIndices: number[],
  sortMode: ChartSortMode
): { labels: string[]; series: ChartSeriesData[] } {
  if (sortMode === 'original' || labels.length <= 1) {
    return { labels, series };
  }

  const primaryIdx = activeSeriesIndices[0] ?? 0;
  const primaryValues = series[primaryIdx]?.values || series[0]?.values || [];
  const order = labels.map((_, idx) => idx);

  order.sort((a, b) => {
    const va = primaryValues[a] ?? 0;
    const vb = primaryValues[b] ?? 0;
    return sortMode === 'desc' ? vb - va : va - vb;
  });

  return {
    labels: order.map((idx) => labels[idx]),
    series: series.map((s) => ({
      name: s.name,
      values: order.map((idx) => s.values[idx] ?? 0),
    })),
  };
}

export function computeChartInsights(
  labels: string[],
  values: number[]
): ChartInsightStats {
  const count = Math.min(labels.length, values.length);
  if (count === 0) {
    return {
      total: 0,
      average: 0,
      maxItem: { label: '-', value: 0 },
      minItem: { label: '-', value: 0 },
      topSharePct: null,
      trendPct: null,
      isChronological: false,
      count: 0,
    };
  }

  let total = 0;
  let positiveTotal = 0;
  let maxIdx = 0;
  let minIdx = 0;

  for (let i = 0; i < count; i++) {
    const v = values[i] ?? 0;
    total += v;
    if (v > 0) positiveTotal += v;
    if (v > (values[maxIdx] ?? -Infinity)) maxIdx = i;
    if (v < (values[minIdx] ?? Infinity)) minIdx = i;
  }

  const average = total / count;
  const maxVal = values[maxIdx] ?? 0;
  const minVal = values[minIdx] ?? 0;
  const topSharePct = positiveTotal > 0 && maxVal > 0 ? (maxVal / positiveTotal) * 100 : null;

  const chronological = isChronologicalLabels(labels.slice(0, count));
  let trendPct: number | null = null;
  if (chronological && count >= 2) {
    // Compare first non-zero to last non-zero
    let firstNonZeroIdx = -1;
    let lastNonZeroIdx = -1;
    for (let i = 0; i < count; i++) {
      if ((values[i] ?? 0) !== 0) {
        if (firstNonZeroIdx === -1) firstNonZeroIdx = i;
        lastNonZeroIdx = i;
      }
    }
    if (firstNonZeroIdx !== -1 && lastNonZeroIdx > firstNonZeroIdx) {
      const startVal = values[firstNonZeroIdx];
      const endVal = values[lastNonZeroIdx];
      if (Math.abs(startVal) > 0) {
        trendPct = ((endVal - startVal) / Math.abs(startVal)) * 100;
      }
    }
  }

  return {
    total,
    average,
    maxItem: { label: labels[maxIdx] || '-', value: maxVal },
    minItem: { label: labels[minIdx] || '-', value: minVal },
    topSharePct,
    trendPct,
    isChronological: chronological,
    count,
  };
}

function sanitizeFilename(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'diagram-presentasi'
  );
}

export function exportChartDataExcel(params: {
  title: string;
  subtitle?: string;
  categoryLabel: string;
  labels: string[];
  series: ChartSeriesData[];
  valueFormat: ChartValueFormat;
  unitLabel: string;
  sourceLabel?: string;
  speakerNotes?: string;
}): void {
  const {
    title,
    subtitle,
    categoryLabel,
    labels,
    series,
    valueFormat,
    unitLabel,
    sourceLabel,
    speakerNotes,
  } = params;

  const wb = XLSX.utils.book_new();

  // Sheet 1: Data Grafik
  const headerRow = [categoryLabel || 'Kategori', ...series.map((s) => s.name)];
  const dataRows = labels.map((label, idx) => [
    label,
    ...series.map((s) => s.values[idx] ?? 0),
  ]);

  const totalRow = [
    'TOTAL',
    ...series.map((s) =>
      Math.round(s.values.reduce((acc, v) => acc + (v || 0), 0) * 100) / 100
    ),
  ];
  const avgRow = [
    'RATA-RATA',
    ...series.map((s) =>
      labels.length > 0
        ? Math.round((s.values.reduce((acc, v) => acc + (v || 0), 0) / labels.length) * 100) / 100
        : 0
    ),
  ];

  const dataSheet = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows, [], totalRow, avgRow]);
  dataSheet['!cols'] = [
    { wch: 28 },
    ...series.map(() => ({ wch: 20 })),
  ];
  XLSX.utils.book_append_sheet(wb, dataSheet, 'Data Grafik');

  // Sheet 2: Ringkasan Eksekutif
  const summaryRows: (string | number)[][] = [
    ['Judul Presentasi', title],
    ['Subjudul', subtitle || '-'],
    ['Sumber Data', sourceLabel || 'NARA AI · Analisa AI'],
    ['Tanggal Ekspor', new Date().toLocaleString('id-ID')],
    ['Format Nilai', valueFormat === 'currency' ? 'Rupiah (IDR)' : valueFormat === 'percent' ? 'Persentase (%)' : `Angka ${unitLabel}`.trim()],
    ['Catatan Presenter', speakerNotes?.trim() || '-'],
    [],
    ['Metrik', 'Total', 'Rata-rata', 'Tertinggi', 'Nilai Tertinggi', 'Terendah', 'Nilai Terendah'],
  ];

  for (const s of series) {
    const stats = computeChartInsights(labels, s.values);
    summaryRows.push([
      s.name,
      stats.total,
      Math.round(stats.average * 100) / 100,
      stats.maxItem.label,
      stats.maxItem.value,
      stats.minItem.label,
      stats.minItem.value,
    ]);
  }

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet['!cols'] = [
    { wch: 24 },
    { wch: 20 },
    { wch: 20 },
    { wch: 24 },
    { wch: 20 },
    { wch: 24 },
    { wch: 20 },
  ];
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Ringkasan Eksekutif');

  XLSX.writeFile(wb, `${sanitizeFilename(title)}.xlsx`);
}

export function exportChartDataCsv(params: {
  title: string;
  categoryLabel: string;
  labels: string[];
  series: ChartSeriesData[];
}): void {
  const escapeCsv = (val: string | number) => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows: string[] = [];
  rows.push([params.categoryLabel || 'Kategori', ...params.series.map((s) => s.name)].map(escapeCsv).join(','));
  params.labels.forEach((label, idx) => {
    rows.push([label, ...params.series.map((s) => params.series.length ? (s.values[idx] ?? 0) : 0)].map(escapeCsv).join(','));
  });

  const blob = new Blob([`\uFEFF${rows.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${sanitizeFilename(params.title)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function exportChartSlidePng(params: {
  svgElement: SVGSVGElement | null;
  title: string;
  subtitle: string;
  sourceLabel: string;
  speakerNotes?: string;
  theme: 'light' | 'dark';
  kpis: { label: string; value: string; hint?: string }[];
  legendItems: { label: string; color: string }[];
}): Promise<void> {
  const { svgElement, title, subtitle, sourceLabel, speakerNotes, theme, kpis, legendItems } = params;
  if (!svgElement) return;

  const WIDTH = 1920;
  const HEIGHT = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const isDark = theme === 'dark';
  const bg = isDark ? '#0B1120' : '#E3E5E8';
  const surface = isDark ? '#111827' : '#EDEEF0';
  const border = isDark ? '#1E293B' : '#CACED4';
  const textPrimary = isDark ? '#F8FAFC' : '#1F2328';
  const textSecondary = isDark ? '#94A3B8' : '#4F5761';
  const textMuted = isDark ? '#64748B' : '#5B646F';

  // Background
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Subtle top accent hairline
  ctx.fillStyle = isDark ? '#2DD4BF' : '#0D7678';
  ctx.fillRect(0, 0, WIDTH, 6);

  // Header
  ctx.fillStyle = textPrimary;
  ctx.font = '700 40px Inter, system-ui, -apple-system, sans-serif';
  ctx.fillText(title.slice(0, 72), 72, 86);

  ctx.fillStyle = textSecondary;
  ctx.font = '400 22px Inter, system-ui, -apple-system, sans-serif';
  ctx.fillText(subtitle.slice(0, 110), 72, 124);

  // Right header date + brand
  const dateLabel = new Date().toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  ctx.textAlign = 'right';
  ctx.fillStyle = isDark ? '#5EEAD4' : '#0D7678';
  ctx.font = '700 20px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText('NARA AI · PRESENTASI EKSEKUTIF', WIDTH - 72, 80);
  ctx.fillStyle = textMuted;
  ctx.font = '400 18px Inter, system-ui, sans-serif';
  ctx.fillText(dateLabel, WIDTH - 72, 110);
  ctx.textAlign = 'left';

  // Divider
  ctx.strokeStyle = border;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(72, 148);
  ctx.lineTo(WIDTH - 72, 148);
  ctx.stroke();

  // KPI strip (up to 4 cards)
  const kpiList = kpis.slice(0, 4);
  const kpiTop = 172;
  const kpiHeight = 104;
  if (kpiList.length > 0) {
    const gap = 24;
    const totalW = WIDTH - 144;
    const cardW = (totalW - gap * (kpiList.length - 1)) / kpiList.length;

    kpiList.forEach((kpi, idx) => {
      const x = 72 + idx * (cardW + gap);
      ctx.fillStyle = surface;
      ctx.strokeStyle = border;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(x, kpiTop, cardW, kpiHeight, 12);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = textMuted;
      ctx.font = '600 16px Inter, system-ui, sans-serif';
      ctx.fillText(kpi.label.toUpperCase(), x + 22, kpiTop + 32);

      ctx.fillStyle = textPrimary;
      ctx.font = '700 26px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillText(kpi.value.slice(0, 26), x + 22, kpiTop + 66);

      if (kpi.hint) {
        ctx.fillStyle = textSecondary;
        ctx.font = '400 15px Inter, system-ui, sans-serif';
        ctx.fillText(kpi.hint.slice(0, 38), x + 22, kpiTop + 90);
      }
    });
  }

  // Main chart frame
  const chartBoxTop = kpiList.length > 0 ? 300 : 176;
  const hasNotes = Boolean(speakerNotes && speakerNotes.trim());
  const footerHeight = hasNotes ? 128 : 76;
  const chartBoxHeight = HEIGHT - chartBoxTop - footerHeight - 24;

  ctx.fillStyle = isDark ? '#0F172A' : '#EDEEF0';
  ctx.strokeStyle = border;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(72, chartBoxTop, WIDTH - 144, chartBoxHeight, 16);
  ctx.fill();
  ctx.stroke();

  // Render SVG onto Canvas
  const clonedSvg = svgElement.cloneNode(true) as SVGSVGElement;
  const viewBox = clonedSvg.getAttribute('viewBox') || '0 0 900 400';
  const [, , vbW, vbH] = viewBox.split(/\s+/).map(Number);
  const svgW = Number.isFinite(vbW) && vbW > 0 ? vbW : 900;
  const svgH = Number.isFinite(vbH) && vbH > 0 ? vbH : 400;

  clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clonedSvg.setAttribute('width', String(svgW));
  clonedSvg.setAttribute('height', String(svgH));

  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(clonedSvg);
  const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  await new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const innerPadX = 36;
      const innerPadTop = 28;
      const legendBarH = legendItems.length > 0 ? 44 : 16;
      const availW = WIDTH - 144 - innerPadX * 2;
      const availH = chartBoxHeight - innerPadTop - legendBarH - 16;
      const scale = Math.min(availW / svgW, availH / svgH);
      const drawW = svgW * scale;
      const drawH = svgH * scale;
      const drawX = 72 + (WIDTH - 144 - drawW) / 2;
      const drawY = chartBoxTop + innerPadTop + (availH - drawH) / 2;

      ctx.drawImage(img, drawX, drawY, drawW, drawH);
      URL.revokeObjectURL(svgUrl);
      resolve();
    };
    img.onerror = () => {
      URL.revokeObjectURL(svgUrl);
      resolve();
    };
    img.src = svgUrl;
  });

  // Legend row at bottom of chart box
  if (legendItems.length > 0) {
    let lx = 104;
    const ly = chartBoxTop + chartBoxHeight - 24;
    ctx.font = '500 17px Inter, system-ui, sans-serif';
    for (const item of legendItems.slice(0, 8)) {
      const labelTxt = item.label.slice(0, 26);
      const txtW = ctx.measureText(labelTxt).width;
      if (lx + 24 + txtW > WIDTH - 96) break;
      ctx.fillStyle = item.color;
      ctx.beginPath();
      ctx.roundRect(lx, ly - 13, 14, 14, 3);
      ctx.fill();
      ctx.fillStyle = textSecondary;
      ctx.fillText(labelTxt, lx + 22, ly);
      lx += 22 + txtW + 28;
    }
  }

  // Speaker Notes + Footer
  const footerTop = HEIGHT - footerHeight;
  if (hasNotes && speakerNotes) {
    ctx.fillStyle = surface;
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(72, footerTop, WIDTH - 144, 58, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = textMuted;
    ctx.font = '600 15px Inter, system-ui, sans-serif';
    ctx.fillText('CATATAN PRESENTER:', 94, footerTop + 35);
    ctx.fillStyle = textPrimary;
    ctx.font = '400 17px Inter, system-ui, sans-serif';
    ctx.fillText(speakerNotes.trim().replace(/\s+/g, ' ').slice(0, 130), 278, footerTop + 35);
  }

  ctx.fillStyle = textMuted;
  ctx.font = '400 16px Inter, system-ui, sans-serif';
  ctx.fillText(`Sumber: ${sourceLabel || 'NARA AI Live Analytics'}`, 72, HEIGHT - 28);
  ctx.textAlign = 'right';
  ctx.fillText('1920 × 1080 HD Slide', WIDTH - 72, HEIGHT - 28);
  ctx.textAlign = 'left';

  const pngUrl = canvas.toDataURL('image/png');
  const link = document.createElement('a');
  link.href = pngUrl;
  link.download = `${sanitizeFilename(title)}-slide-16x9.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
