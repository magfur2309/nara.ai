import type { CitationSource } from '../types/sop';

export interface ExecutiveSummaryPoint {
  label?: string;
  detail: string;
}

export interface ExecutiveSummaryData {
  coreTakeaway: string;
  keyPoints: ExecutiveSummaryPoint[];
  highlights: string[];
  totalStepsDetected: number;
  copyText: string;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateCleanly(text: string, maxLen = 135): string {
  const clean = text.trim();
  if (clean.length <= maxLen) return clean;
  const sliced = clean.slice(0, maxLen);
  const lastPeriod = sliced.lastIndexOf('. ');
  if (lastPeriod >= maxLen * 0.55) {
    return sliced.slice(0, lastPeriod + 1).trim();
  }
  const lastComma = sliced.lastIndexOf(', ');
  if (lastComma >= maxLen * 0.65) {
    return `${sliced.slice(0, lastComma).trim()}...`;
  }
  const lastSpace = sliced.lastIndexOf(' ');
  return `${(lastSpace > 40 ? sliced.slice(0, lastSpace) : sliced).trim()}...`;
}

function cleanIntroSentence(raw: string): string {
  let text = stripMarkdown(raw);
  // Trim repetitive "Berdasarkan SOP-xxx v1 mengenai ... (Bagian ...), berikut adalah "
  text = text.replace(
    /^berdasarkan\s+(?:dokumen\s+)?sop[-\w\s.]+?(?:mengenai|tentang)\s+["“]?[^"”,\n]+["”]?(?:\s*\([^)]+\))?\s*,?\s*(?:berikut\s+(?:adalah|merupakan)\s+)?/i,
    ''
  );
  text = text.replace(/^berikut\s+(?:ini\s+)?(?:adalah|merupakan)?\s*/i, '');
  text = text.replace(/:\s*$/, '.');
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function extractHighlights(text: string): string[] {
  const found: string[] = [];
  const pushUnique = (val: string) => {
    const normalized = val.replace(/\s+/g, ' ').trim();
    if (!normalized || normalized.length < 3) return;
    if (found.some((f) => f.toLowerCase() === normalized.toLowerCase())) return;
    if (found.length < 3) found.push(normalized);
  };

  // Menu path e.g. [Administrator] -> [User] -> [Administrasi User]
  for (const m of text.matchAll(/\[[^\]\n]{2,35}\](?:\s*(?:->|→|>)\s*\[[^\]\n]{2,35}\]){1,4}/g)) {
    pushUnique(`Menu: ${m[0].replace(/\s*(?:->|→|>)\s*/g, ' → ')}`);
  }

  // Monetary limits e.g. Rp 5.000.000
  for (const m of text.matchAll(/Rp\.?\s*\d[\d.,]*(?:\s*(?:ribu|juta|miliar))?/gi)) {
    pushUnique(`Nominal: ${m[0]}`);
  }

  // SLA / Time durations e.g. maksimal 3 hari kerja
  for (const m of text.matchAll(
    /(?:maksimal|minimal|maks\.?|min\.?|paling\s+lambat|sla)?\s*\b\d+\s*(?:hari\s+kerja|hari|jam|menit|bulan|tahun)\b/gi
  )) {
    const val = m[0].trim();
    if (/^\d+\s+tahun$/i.test(val) && !/maks|min|berlaku|usia|masa/i.test(val)) continue;
    pushUnique(`SLA/Waktu: ${val.charAt(0).toUpperCase() + val.slice(1)}`);
  }

  // Percentage limits
  for (const m of text.matchAll(/\b\d+(?:[.,]\d+)?\s*%/g)) {
    pushUnique(`Batas: ${m[0]}`);
  }

  return found;
}

export function buildExecutiveSummary(params: {
  content: string;
  citations?: CitationSource[];
  answered?: boolean;
}): ExecutiveSummaryData | null {
  const { content, citations = [], answered } = params;
  if (answered === false) return null;
  const trimmed = (content || '').trim();
  if (!trimmed) return null;

  // Never summarize "not found" or "no image available" short replies
  if (
    /^saya tidak menemukan ini di sop yang ada/i.test(trimmed) ||
    /^belum ada gambar atau tangkapan layar/i.test(trimmed)
  ) {
    return null;
  }

  const lines = trimmed
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const plainLength = stripMarkdown(trimmed).length;
  const listLines = lines.filter((l) => /^\d+\.\s/.test(l) || /^[-*•]\s/.test(l));
  const proseLines = lines.filter(
    (l) =>
      !/^\d+\.\s/.test(l) &&
      !/^[-*•]\s/.test(l) &&
      !/^\*\*Catatan Konflik SOP:\*\*/i.test(l)
  );

  // Trigger only for meaningfully long answers
  const isLongAnswer =
    plainLength >= 420 || listLines.length >= 4 || lines.length >= 6;
  if (!isLongAnswer) return null;

  interface CandidatePoint {
    idx: number;
    label?: string;
    detail: string;
    priority: number;
  }

  const candidates: CandidatePoint[] = [];

  listLines.forEach((rawLine, idx) => {
    const body = rawLine.replace(/^(\d+\.|[-*•])\s*/, '').trim();
    if (!body) return;

    const boldSplit = body.match(/^\*\*([^*:]+):?\*\*:?\s*(.+)$/);
    let label: string | undefined;
    let detailRaw = body;
    if (boldSplit) {
      label = stripMarkdown(boldSplit[1]).replace(/:$/, '').trim();
      detailRaw = boldSplit[2].trim();
    } else {
      const colonIdx = body.indexOf(': ');
      if (colonIdx > 2 && colonIdx <= 36) {
        label = stripMarkdown(body.slice(0, colonIdx)).trim();
        detailRaw = body.slice(colonIdx + 2).trim();
      }
    }

    const detailClean = truncateCleanly(stripMarkdown(detailRaw), 125);
    if (!detailClean && !label) return;

    let priority = 1;
    if (idx === 0) priority += 3;
    if (idx === listLines.length - 1) priority += 2;
    if (label) priority += 1.5;
    if (/\b(wajib|harus|maksimal|minimal|jika|apabila|setuju|approve|otorisasi|rp\s*\d|hari\s+kerja|sla)\b/i.test(body)) {
      priority += 2.5;
    }

    candidates.push({
      idx,
      label,
      detail: detailClean || label || '',
      priority,
    });
  });

  // If answer is long prose paragraphs without bullet/numbered steps, split into key sentences
  const usedProseFallback = candidates.length < 2;
  if (usedProseFallback) {
    const sentences = stripMarkdown(proseLines.join(' '))
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 25);

    sentences.forEach((sentence, idx) => {
      let priority = idx === 0 ? 3 : 1;
      if (/\b(wajib|harus|maksimal|minimal|jika|apabila|disetujui|rp\s*\d|hari\s+kerja|menu)\b/i.test(sentence)) {
        priority += 2.5;
      }
      candidates.push({
        idx: 100 + idx,
        detail: truncateCleanly(sentence, 130),
        priority,
      });
    });
  }

  // Also include conflict warning if present
  const conflictLine = lines.find((l) => /^\*\*Catatan Konflik SOP:\*\*/i.test(l));
  if (conflictLine) {
    const conflictBody = conflictLine.replace(/^\*\*Catatan Konflik SOP:\*\*\s*/i, '');
    candidates.push({
      idx: 999,
      label: 'Konflik SOP',
      detail: truncateCleanly(stripMarkdown(conflictBody), 130),
      priority: 10,
    });
  }

  if (candidates.length < 2) return null;

  // Build concise 1-sentence core takeaway
  let coreTakeaway = '';
  let takeawayUsedFirstProseSentence = false;
  if (usedProseFallback && citations.length > 0) {
    const c = citations[0];
    coreTakeaway = `Ringkasan ketentuan utama dari ${c.docNumber} (${c.title}${
      c.sectionTitle ? ` — ${c.sectionTitle}` : ''
    }).`;
  } else if (proseLines.length > 0) {
    const firstSentence = proseLines[0].split(/(?<=[.!?])\s+/)[0] || proseLines[0];
    const cleaned = cleanIntroSentence(firstSentence);
    if (cleaned.length >= 24) {
      coreTakeaway = truncateCleanly(cleaned, 155);
      takeawayUsedFirstProseSentence = usedProseFallback;
    }
  }
  if (!coreTakeaway && citations.length > 0) {
    const c = citations[0];
    coreTakeaway = `Ringkasan ketentuan utama dari ${c.docNumber} (${c.title}${
      c.sectionTitle ? ` — ${c.sectionTitle}` : ''
    }).`;
  }
  if (!coreTakeaway) {
    coreTakeaway = `Ringkasan ${Math.min(candidates.length, 5)} poin utama prosedur dan ketentuan SOP terkait.`;
  }

  const pointPool =
    takeawayUsedFirstProseSentence && candidates.length >= 3
      ? candidates.filter((c) => c.idx !== 100)
      : candidates;

  // Select up to 5 highest-priority points, then restore original reading order
  const selected = [...pointPool]
    .sort((a, b) => b.priority - a.priority || a.idx - b.idx)
    .slice(0, 5)
    .sort((a, b) => a.idx - b.idx);

  const keyPoints: ExecutiveSummaryPoint[] = selected.map((c) => ({
    label: c.label,
    detail: c.detail,
  }));

  const highlights = extractHighlights(trimmed);

  const copyLines = [
    `Executive Summary: ${coreTakeaway}`,
    '',
    ...keyPoints.map((kp, i) =>
      `${i + 1}. ${kp.label ? `${kp.label}: ` : ''}${kp.detail}`
    ),
    ...(highlights.length > 0 ? ['', `Sorotan: ${highlights.join(' | ')}`] : []),
  ];

  return {
    coreTakeaway,
    keyPoints,
    highlights,
    totalStepsDetected: listLines.length || keyPoints.length,
    copyText: copyLines.join('\n'),
  };
}
