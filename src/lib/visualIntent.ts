export interface SopVisualCatalogEntry {
  sopId: string;
  docNumber: string;
  title: string;
  sectionsWithImages: {
    order: number;
    title: string;
    captions: string[];
    ocrKeywords?: string[];
  }[];
  sectionsWithoutImages: {
    order: number;
    title: string;
  }[];
  pdfFigures: {
    pageNumber: number;
    caption: string;
  }[];
}

export const VISUAL_REQUEST_PATTERNS: RegExp[] = [
  /\bgambar(?:nya|kan)?\b/i,
  /\bfoto(?:nya)?\b/i,
  /\b(?:screen\s*shot|screenshot|ss)(?:nya)?\b/i,
  /\btangkapan\s+layar(?:nya)?\b/i,
  /\btampilan(?:nya)?\b/i,
  /\bilustrasi(?:nya)?\b/i,
  /\bvisual(?:isasi|nya)?\b/i,
  /\bpreview(?:nya)?\b/i,
  /\b(?:diagram\s+alur|bagan\s+alur|flow\s*chart|flowchart|infografis|infografik|skema\s+alur)\b/i,
  /\b(?:contoh|lihat|tunjuk(?:kan|in)?|perlihat(?:kan)?|mana|kasih|minta|kirim|tampil(?:kan|in)?|muncul(?:kan|in)?)\s+(?:[a-z]+\s+){0,2}(?:menu|layar|form|formulir|ui)(?:nya)?\b/i,
  /\bmenunya\s+(?:mana|dong|ya|gimana|bagaimana|seperti\s+apa|kayak\s+apa)\b/i,
  /\bcontoh\s+(?:halaman|bagian|tampilan|layar|form|formulir)(?:nya)?\b/i,
  /\b(?:dalam|ke|berbentuk|bentuk|format|pake|pakai)\s+gambar\b/i,
];

export const DIAGRAM_REQUEST_REGEX =
  /\b(?:diagram\s+alur|bagan\s+alur|flow\s*chart|flowchart|infografis|infografik|skema(?:\s+alur)?)\b/i;

export const SOP_EXPLICIT_VISUAL_REGEX =
  /\b(?:gambar\s+(?:menu|sop|halaman|layar)|foto\s+(?:menu|sop|modul)|screen\s*shot|screenshot|tangkapan\s+layar|contoh\s+(?:menu|tampilan|halaman|layar|form)|flowchart|flow\s*chart|diagram\s+alur|bagan\s+alur|infografis\s+(?:sop|prosedur|alur))\b/i;

export const DATA_CHART_QUERY_REGEX =
  /\b(?:grafik|chart|diagram\s+(?:batang|garis|lingkaran|pie|donat|donut|area|tumpuk|stacked|presentasi)|presentasi\s+(?:diagram|grafik|chart)|bahan\s+presentasi|rekap\s+bulanan|pendapatan|hpp|cogs|laba\s+bersih|laba\s+kotor|laba\s+rugi|neraca|omzet|omset|penjualan|pembelian|hutang|piutang|aging|nilai\s+perolehan|nilai\s+buku|penyusutan|depresiasi|aset\s+tetap|stok\s+gudang|purchase\s+order|purchase\s+request|faktur\s+(?:penjualan|pembelian))\b/i;

export const FOLLOW_UP_QUERY_REGEX =
  /\b(?:gambar(?:nya|kan)?|foto(?:nya)?|screenshot(?:nya)?|ss(?:nya)?|tampilan(?:nya)?|menu(?:nya)?|contoh(?:nya)?|ilustrasi(?:nya)?|diagram(?:nya)?|flowchart(?:nya)?|bagan(?:nya)?|infografis(?:nya)?|visual(?:nya)?|lanjut(?:an|nya)?|berikut(?:nya)?|selanjutnya|halaman(?:nya)?|bagian(?:nya)?|itu|tersebut|mana|tunjuk(?:kan|in)?|perlihat(?:kan)?|lihat(?:in)?|tampil(?:kan|in)?|muncul(?:kan|in)?)\b/i;

export const NO_VISUAL_REPLY_REGEX =
  /\b(?:belum\s+(?:ada|tersedia|memiliki|dilampirkan|diunggah)|tidak\s+(?:ada|tersedia|memiliki))\b[^.\n]{0,70}\b(?:gambar|foto|screenshot|tangkapan\s+layar|tampilan|visual)\b/i;

export function isDataChartVisualQuery(text: string): boolean {
  const clean = text.trim();
  if (!clean) return false;
  if (SOP_EXPLICIT_VISUAL_REGEX.test(clean)) return false;
  return DATA_CHART_QUERY_REGEX.test(clean);
}

export function isVisualRequest(text: string): boolean {
  const clean = text.trim();
  if (!clean) return false;
  if (isDataChartVisualQuery(clean)) return false;
  return VISUAL_REQUEST_PATTERNS.some((re) => re.test(clean));
}

export function isDiagramRequest(text: string): boolean {
  const clean = text.trim();
  if (!clean) return false;
  if (isDataChartVisualQuery(clean)) return false;
  return DIAGRAM_REQUEST_REGEX.test(clean);
}
