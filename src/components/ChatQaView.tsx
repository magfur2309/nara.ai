import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUp,
  BarChart3,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  CornerDownRight,
  Download,
  FileText,
  Image as ImageIcon,
  Maximize2,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  RotateCcw,
  Send,
  Share,
  Square,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Volume2,
  X,
} from 'lucide-react';
import { renderSopAnswerToImage } from '../lib/answerImageRenderer';
import { streamApiSse } from '../lib/apiClient';
import {
  extractChartSpecFromAnswer,
  isChartRequest,
} from '../lib/chartDataExtractor';
import { getFreshIdToken } from '../lib/firebase';
import { useI18n } from '../lib/i18n';
import { useTheme } from '../lib/theme';
import {
  isDataChartVisualQuery,
  isDiagramRequest,
  isVisualRequest,
  NO_VISUAL_REPLY_REGEX,
  SOP_EXPLICIT_VISUAL_REGEX,
  type SopVisualCatalogEntry,
} from '../lib/visualIntent';
import {
  logQueryAndAnswer,
  makeSafeId,
  sortChatSessions,
  updateQueryLogFeedback,
} from '../lib/sopService';
import {
  createUserChatSessionApi,
  deleteUserChatSessionApi,
  fetchUserChatMessagesApi,
  fetchUserChatSessionsApi,
  renameUserChatSessionApi,
  saveUserChatMessageApi,
  togglePinUserChatSessionApi,
  updateUserChatMessageFeedbackApi,
} from '../lib/chatHistoryClient';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import { PresentationChartCard } from './PresentationChartCard';
import type {
  AiChartSpec,
  ChartColorPalette,
  ChartSeriesData,
  ChartSortMode,
  ChartType,
  ChartValueFormat,
  ChatMessage,
  ChatSession,
  CitationSource,
  DirectoryMember,
  Division,
  FeedbackType,
  PinnedChartDocument,
  SopDocument,
  UserProfile,
} from '../types/sop';

interface ChatQaViewProps {
  user: UserProfile;
  idToken: string;
  divisions: Division[];
  directory: DirectoryMember[];
  sops?: SopDocument[];
  pinnedCharts?: PinnedChartDocument[];
  onPinChart?: (payload: {
    title: string;
    subtitle: string;
    chartType: ChartType;
    palette: ChartColorPalette;
    valueFormat: ChartValueFormat;
    unitLabel: string;
    categoryLabel: string;
    labels: string[];
    series: ChartSeriesData[];
    activeSeriesIndices: number[];
    showDataLabels: boolean;
    sortMode: ChartSortMode;
    speakerNotes: string;
    sourceQuestion: string;
    sourceLabel: string;
    isShared: boolean;
  }) => Promise<void>;
  onOpenDashboard?: () => void;
  onOpenSopCitation?: (sopId: string, sectionTitle?: string) => void;
  pendingQuestion?: string | null;
  onConsumePendingQuestion?: () => void;
}

type AnswerDisplayFormat = 'auto' | 'text_and_image' | 'text_only';

interface VisualIntentMeta {
  showVisual: boolean;
  visualType: 'pdf_page' | 'diagram';
  visualPageNumbers: number[];
}

function formatChatErrorMessage(raw: string): string {
  const trimmed = (raw || '').trim();
  const upper = trimmed.toUpperCase();
  if (
    upper.includes('503') ||
    upper.includes('UNAVAILABLE') ||
    upper.includes('HIGH DEMAND') ||
    upper.includes('OVERLOADED')
  ) {
    return 'Server AI Gemini sedang mengalami lonjakan trafik sementara (503). Silakan klik "Coba Kirim Ulang" beberapa detik lagi.';
  }
  if (upper.includes('429') || upper.includes('RESOURCE_EXHAUSTED')) {
    return 'Kuota permintaan AI sedang penuh (429). Silakan tunggu beberapa detik lalu coba kirim ulang.';
  }
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as { error?: { message?: string }; message?: string };
      const inner = parsed?.error?.message || parsed?.message;
      if (typeof inner === 'string' && inner.trim()) {
        return formatChatErrorMessage(inner);
      }
    } catch {
      // Fallback to generic message if raw JSON cannot be parsed cleanly
      return 'Terjadi gangguan sementara pada layanan AI. Silakan coba kirim ulang.';
    }
  }
  return trimmed || 'Terjadi kesalahan saat mengirim pertanyaan.';
}

interface ReferencedPdfVisual {
  sopTitle: string;
  docNumber: string;
  attachmentName: string;
  pageNumber: number;
  sectionTitle?: string;
  sectionOrder?: number;
  caption: string;
  dataUrl: string;
  sourceKind: 'section' | 'pdf';
}

const MATCH_STOPWORDS = new Set([
  'yang', 'dan', 'di', 'ke', 'dari', 'untuk', 'pada', 'dengan', 'adalah', 'atau',
  'ini', 'itu', 'jika', 'bila', 'kalau', 'apa', 'bagaimana', 'cara', 'mana',
  'contoh', 'gambar', 'gambarnya', 'foto', 'fotonya', 'screenshot', 'screenshotnya',
  'tampilan', 'tampilannya', 'menu', 'menunya', 'halaman', 'bagian', 'berikut',
  'proses', 'saat', 'hanya', 'tolong', 'lihat', 'tampilkan', 'tampil', 'saja',
  'sop', 'sistem', 'modul', 'berdasarkan', 'bukan', 'buka', 'kamu', 'harus',
  'seharusnya', 'salah', 'keliru', 'sebelumnya', 'ketidaksesuaian', 'belum',
  'tersedia', 'diunggah', 'mohon', 'maaf', 'atas', 'tadi', 'dong', 'coba',
  'kasih', 'minta', 'muncul', 'munculkan', 'perlihatkan', 'tunjukkan', 'tunjukin',
]);

function extractPositiveTopicText(question: string): string {
  const correctionMatch = question.match(
    /(?:yang\s+(?:kamu|anda|sistem)?\s*(?:tampilkan|munculkan|kasih)\s+.+?\s+\bbuka[n]?\b\s+)(.+)$/i
  );
  if (correctionMatch?.[1]) {
    return correctionMatch[1];
  }
  const notIdx = question.search(/\bbukan\b/i);
  if (notIdx > 0) {
    return question.slice(0, notIdx);
  }
  return question;
}

function extractMentionedPageNumbers(text: string): number[] {
  const pages: number[] = [];
  // Matches "Halaman 2", "Halaman 2-3", "Hal. 2"
  for (const m of text.matchAll(/\b(?:halaman|hal\.?)\s*(\d+)(?:\s*[-–]\s*(\d+))?/gi)) {
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : start;
    if (Number.isInteger(start) && start > 0) {
      const cap = Math.min(end >= start ? end : start, start + 2);
      for (let p = start; p <= cap; p++) {
        if (!pages.includes(p)) pages.push(p);
      }
    }
  }
  return pages;
}

function tokenizeMatchText(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 2 && !MATCH_STOPWORDS.has(t))
    )
  );
}

function scoreVisualCandidate<
  T extends ReferencedPdfVisual & { isPrimarySop: boolean; searchHaystack?: string; isCitedSection?: boolean },
>(
  candidate: T,
  questionTokens: string[],
  contextTokens: string[],
  extraTopicTokens: string[] = []
): T & { score: number; hasTopicHit: boolean } {
  const capLower = (candidate.searchHaystack || candidate.caption).toLowerCase();
  const captionOnlyLower = (candidate.caption || '').toLowerCase();
  let score = candidate.isPrimarySop ? 0.5 : 0;
  let hasTopicHit = Boolean(candidate.isCitedSection);
  if (candidate.isCitedSection) {
    score += 10;
  }
  for (const tok of questionTokens) {
    if (capLower.includes(tok)) {
      score += 5;
      if (captionOnlyLower.includes(tok)) {
        hasTopicHit = true;
      }
      if (capLower.includes(`gambar ${tok}`) || capLower.includes(`diagram ${tok}`)) {
        score += 2;
      }
    }
  }
  for (const tok of extraTopicTokens) {
    if (capLower.includes(tok)) {
      score += 2.5;
      if (captionOnlyLower.includes(tok)) {
        hasTopicHit = true;
      }
    }
  }
  for (const tok of contextTokens) {
    if (capLower.includes(tok)) {
      score += 1.5;
    }
  }
  return { ...candidate, score, hasTopicHit };
}

function findReferencedSopVisuals(params: {
  msg: ChatMessage;
  userQuestion: string;
  priorContext: string;
  sops: SopDocument[];
  explicitPageNumbers?: number[];
}): {
  visuals: ReferencedPdfVisual[];
  hasAnyPdfVisualsOnSop: boolean;
  hasLegacyPdfWithoutVisuals: boolean;
} {
  const { msg, userQuestion, priorContext, sops, explicitPageNumbers } = params;
  if (!sops.length) {
    return { visuals: [], hasAnyPdfVisualsOnSop: false, hasLegacyPdfWithoutVisuals: false };
  }

  const citedIds = new Set((msg.citations || []).map((c) => c.sopId));
  const citedSectionTitles = (msg.citations || [])
    .map((c) => (c.sectionTitle || '').trim().toLowerCase())
    .filter(Boolean);
  const combinedTextLower = `${msg.content || ''} ${priorContext}`.toLowerCase();

  let matchedSops = sops.filter((sop) => {
    if (citedIds.has(sop.id)) return true;
    if (sop.docNumber && combinedTextLower.includes(sop.docNumber.toLowerCase())) return true;
    if (sop.title && sop.title.length > 8 && combinedTextLower.includes(sop.title.toLowerCase())) {
      return true;
    }
    return false;
  });

  // Fallback: ONLY match SOPs by keyword when the user actually asked about an SOP / menu / screenshot / procedure
  // Never leak unrelated SOP menu screenshots onto ERP financial/sales/purchasing/asset data answers!
  const isDataOrChartQuestion =
    isDataChartVisualQuery(userQuestion) || isChartRequest(userQuestion);
  const explicitlyMentionsSopOrMenu =
    /\b(sop|prosedur|menu|modul|halaman|screenshot|tangkapan\s+layar|foto|form|formulir|alur|flowchart)\b/i.test(
      userQuestion
    );
  if (
    matchedSops.length === 0 &&
    msg.answered !== false &&
    !isDataOrChartQuestion &&
    explicitlyMentionsSopOrMenu
  ) {
    const queryTokens = tokenizeMatchText(`${extractPositiveTopicText(userQuestion)} ${msg.content || ''}`);
    if (queryTokens.length > 0) {
      const scoredSops = sops
        .map((sop) => {
          const sopHaystack = [
            sop.docNumber,
            sop.title,
            ...(sop.sections || []).map((s) => `${s.title} ${(s.images || []).map((im) => im.caption).join(' ')}`),
            ...(sop.attachments || []).flatMap((a) => (a.visualPages || []).map((vp) => vp.caption)),
          ]
            .join(' ')
            .toLowerCase();
          let score = 0;
          for (const tok of queryTokens) {
            if (sopHaystack.includes(tok)) score += 1;
          }
          return { sop, score };
        })
        .filter((item) => item.score >= 2)
        .sort((a, b) => b.score - a.score);
      if (scoredSops.length > 0) {
        matchedSops = [scoredSops[0].sop];
      }
    }
  }

  const positiveQuestionText = extractPositiveTopicText(userQuestion);
  const topicTokens = tokenizeMatchText(positiveQuestionText);
  const answerTokens = tokenizeMatchText(msg.content || '');
  const priorTokens =
    topicTokens.length === 0 && answerTokens.length <= 4 ? tokenizeMatchText(priorContext) : [];

  // Score ALL sections across matchedSops (including sections WITHOUT images)
  // so that requesting a module with NO image never falls back to a different module's photo!
  const allSectionMatches: {
    sop: SopDocument;
    sec: SopDocument['sections'][number];
    score: number;
    isPrimarySop: boolean;
    isCitedSection: boolean;
  }[] = [];

  const allPages: (ReferencedPdfVisual & { isPrimarySop: boolean })[] = [];
  let hasLegacyPdfWithoutVisuals = false;
  let hasAnyUploadedSectionImages = false;

  for (const sop of matchedSops) {
    const isPrimarySop = citedIds.has(sop.id) || msg.citations?.[0]?.sopId === sop.id;
    for (const sec of sop.sections || []) {
      if ((sec.images || []).length > 0) {
        hasAnyUploadedSectionImages = true;
      }
      const secTitleLower = (sec.title || '').trim().toLowerCase();
      const secHaystack = `${sec.title} ${sec.content.slice(0, 600)} ${(sec.images || [])
        .map((im) => `${im.caption || ''} ${im.ocrText || ''}`)
        .join(' ')}`.toLowerCase();
      const isCitedSection =
        secTitleLower.length > 2 &&
        citedSectionTitles.some(
          (ct) => ct === secTitleLower || ct.includes(secTitleLower) || secTitleLower.includes(ct)
        );

      let score = isCitedSection ? 10 : 0;
      for (const tok of topicTokens) {
        if (secTitleLower.includes(tok)) score += 6;
        else if (secHaystack.includes(tok)) score += 3;
      }
      for (const tok of answerTokens) {
        if (secTitleLower.includes(tok)) score += 4;
        else if (secHaystack.includes(tok)) score += 1.5;
      }
      for (const tok of priorTokens) {
        if (secTitleLower.includes(tok)) score += 2.5;
        else if (secHaystack.includes(tok)) score += 1;
      }
      if (isPrimarySop && score > 0) score += 0.5;

      allSectionMatches.push({
        sop,
        sec,
        score,
        isPrimarySop,
        isCitedSection,
      });
    }

    for (const att of sop.attachments || []) {
      const isPdfAtt =
        att.fileType?.toUpperCase() === 'PDF' || att.name?.toLowerCase().endsWith('.pdf');
      if (isPdfAtt && (!att.visualPages || att.visualPages.length === 0)) {
        hasLegacyPdfWithoutVisuals = true;
      }
      for (const vp of att.visualPages || []) {
        allPages.push({
          sopTitle: sop.title,
          docNumber: sop.docNumber,
          attachmentName: att.name,
          pageNumber: vp.pageNumber,
          caption: vp.caption,
          dataUrl: vp.dataUrl,
          sourceKind: 'pdf',
          isPrimarySop,
        });
      }
    }
  }

  const hasAnyVisuals = hasAnyUploadedSectionImages || allPages.length > 0;
  if (!hasAnyVisuals) {
    return { visuals: [], hasAnyPdfVisualsOnSop: false, hasLegacyPdfWithoutVisuals };
  }

  allSectionMatches.sort((a, b) => b.score - a.score || a.sec.order - b.sec.order);
  const bestSectionMatch = allSectionMatches[0];

  // 0. Check uploaded module/section photos strictly against the best-matching target section
  if (bestSectionMatch && bestSectionMatch.score >= 4) {
    const bestImages = bestSectionMatch.sec.images || [];
    if (bestImages.length > 0) {
      const visuals: ReferencedPdfVisual[] = bestImages.slice(0, 3).map((img) => ({
        sopTitle: bestSectionMatch.sop.title,
        docNumber: bestSectionMatch.sop.docNumber,
        attachmentName: `modul-${bestSectionMatch.sec.order}`,
        pageNumber: 0,
        sectionTitle: bestSectionMatch.sec.title,
        sectionOrder: bestSectionMatch.sec.order,
        caption:
          img.caption && img.caption.trim() && img.caption.trim() !== bestSectionMatch.sec.title.trim()
            ? `${bestSectionMatch.sec.title} — ${img.caption.trim()}`
            : bestSectionMatch.sec.title,
        dataUrl: img.dataUrl,
        sourceKind: 'section',
      }));
      return {
        visuals,
        hasAnyPdfVisualsOnSop: true,
        hasLegacyPdfWithoutVisuals,
      };
    }
    // Target section has 0 uploaded photos: do NOT steal photos from another section!
    // Continue ONLY to check whether PDF visualPages match this exact section/page.
  } else if (hasAnyUploadedSectionImages) {
    // No section matched the request with confidence -> check PDF pages strictly before giving up
  }

  if (allPages.length === 0) {
    return { visuals: [], hasAnyPdfVisualsOnSop: true, hasLegacyPdfWithoutVisuals };
  }

  const targetSectionTokens = bestSectionMatch
    ? tokenizeMatchText(bestSectionMatch.sec.title)
    : [];

  // 1. Prioritize explicit page numbers from AI metadata or explicitly cited in answer/question
  const targetPages =
    explicitPageNumbers && explicitPageNumbers.length > 0
      ? explicitPageNumbers
      : extractMentionedPageNumbers(`${userQuestion} ${msg.content}`);

  if (targetPages.length > 0) {
    const targetSet = new Set(targetPages);
    const exactMatches = allPages.filter((p) => targetSet.has(p.pageNumber));
    if (exactMatches.length > 0) {
      if (exactMatches.length === 1) {
        return {
          visuals: exactMatches,
          hasAnyPdfVisualsOnSop: true,
          hasLegacyPdfWithoutVisuals,
        };
      }
      const scoredExact = exactMatches
        .map((p) => scoreVisualCandidate(p, topicTokens, answerTokens, targetSectionTokens))
        .sort((a, b) => b.score - a.score || a.pageNumber - b.pageNumber);

      const best = scoredExact[0];
      const runnerUp = scoredExact[1];
      const multiPageRequested = new Set(targetPages).size > 1;
      const includeRunnerUp =
        runnerUp &&
        (multiPageRequested || best.pageNumber !== runnerUp.pageNumber) &&
        runnerUp.score >= 4 &&
        best.score - runnerUp.score <= 2;

      return {
        visuals: includeRunnerUp ? [best, runnerUp] : [best],
        hasAnyPdfVisualsOnSop: true,
        hasLegacyPdfWithoutVisuals,
      };
    }
    // Requested page number is not saved in allPages: only match via strong keyword hit (>= 6), never random page
    const strictPageMissFallback = allPages
      .map((p) => scoreVisualCandidate(p, topicTokens, answerTokens, targetSectionTokens))
      .filter((p) => p.score >= 6 && p.hasTopicHit)
      .sort((a, b) => b.score - a.score || a.pageNumber - b.pageNumber);
    return {
      visuals: strictPageMissFallback.length > 0 ? [strictPageMissFallback[0]] : [],
      hasAnyPdfVisualsOnSop: true,
      hasLegacyPdfWithoutVisuals,
    };
  }

  // 2. Fallback: strict keyword scoring against vp.caption — never return unrelated figure
  const scored = allPages
    .map((p) => scoreVisualCandidate(p, topicTokens, [...answerTokens, ...priorTokens], targetSectionTokens))
    .filter((p) => p.score >= 5 && p.hasTopicHit)
    .sort((a, b) => b.score - a.score || a.pageNumber - b.pageNumber);

  if (scored.length === 0) {
    return {
      visuals: [],
      hasAnyPdfVisualsOnSop: true,
      hasLegacyPdfWithoutVisuals,
    };
  }

  const best = scored[0];
  const runnerUp = scored[1];
  const selected =
    runnerUp &&
    best.pageNumber !== runnerUp.pageNumber &&
    runnerUp.score >= 5 &&
    best.score - runnerUp.score <= 2
      ? [best, runnerUp]
      : [best];

  return {
    visuals: selected,
    hasAnyPdfVisualsOnSop: true,
    hasLegacyPdfWithoutVisuals,
  };
}

function stripMarkdownForSpeech(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' blok kode ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\|/g, ', ')
    .replace(/\n{2,}/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderInlineMarkdown(text: string): React.ReactNode {
  return text
    .split(/(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/g)
    .map((part, pIdx) => {
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        return (
          <strong key={pIdx} className="font-semibold text-[var(--text)]">
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        return (
          <code
            key={pIdx}
            className="px-1.5 py-[1px] mx-[1px] text-[13.5px] font-mono bg-[var(--surface-2)] dark:bg-[#1A333C] text-[var(--text)] rounded-[5px]"
          >
            {part.slice(1, -1)}
          </code>
        );
      }
      if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
        return (
          <em key={pIdx} className="italic text-[var(--text)]">
            {part.slice(1, -1)}
          </em>
        );
      }
      return part;
    });
}

function splitMarkdownTableRow(row: string): string[] {
  let cleaned = row.trim();
  if (cleaned.startsWith('|')) cleaned = cleaned.slice(1);
  if (cleaned.endsWith('|')) cleaned = cleaned.slice(0, -1);
  return cleaned.split('|').map((cell) => cell.trim());
}

function isMarkdownTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}

const CHAT_TABLE_PAGE_SIZES = [10, 25, 30] as const;

function isSummaryFooterRow(cells: string[]): boolean {
  const first = (cells[0] ?? '')
    .replace(/[*_`~]/g, '')
    .trim()
    .toLowerCase();
  return /^(total|jumlah|grand\s+total|subtotal|keseluruhan)\b/.test(first);
}

const PaginatedChatTable: React.FC<{
  headers: string[];
  rows: string[][];
}> = ({ headers, rows }) => {
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);

  const hasPinnedFooter = rows.length > 2 && isSummaryFooterRow(rows[rows.length - 1]);
  const dataRows = hasPinnedFooter ? rows.slice(0, -1) : rows;
  const footerRow = hasPinnedFooter ? rows[rows.length - 1] : null;

  const totalRows = dataRows.length;
  const showPaginationBar = totalRows > 10;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.max(1, Math.min(page, totalPages));

  useEffect(() => {
    if (page !== safePage) {
      setPage(safePage);
    }
  }, [page, safePage]);

  const startIdx = (safePage - 1) * pageSize;
  const visibleRows = showPaginationBar
    ? dataRows.slice(startIdx, startIdx + pageSize)
    : dataRows;

  // Build compact page number list (with ellipsis when many pages)
  const pageNumbers = useMemo<Array<number | 'ellipsis'>>(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, idx) => idx + 1);
    }
    const result: Array<number | 'ellipsis'> = [1];
    if (safePage > 3) result.push('ellipsis');
    const from = Math.max(2, safePage - 1);
    const to = Math.min(totalPages - 1, safePage + 1);
    for (let p = from; p <= to; p++) result.push(p);
    if (safePage < totalPages - 2) result.push('ellipsis');
    result.push(totalPages);
    return result;
  }, [safePage, totalPages]);

  const displayStart = totalRows === 0 ? 0 : startIdx + 1;
  const displayEnd = Math.min(totalRows, startIdx + visibleRows.length);

  return (
    <div className="my-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] dark:bg-[#0D1E24] overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[13.5px] text-left border-collapse">
          <thead>
            <tr className="bg-[var(--surface-2)]/75 dark:bg-[#132930] border-b border-[var(--border)] text-[var(--text)]">
              {headers.map((h, hIdx) => (
                <th
                  key={hIdx}
                  className="px-3.5 py-2.5 font-semibold whitespace-nowrap"
                >
                  {renderInlineMarkdown(h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]/70 tabular-nums">
            {visibleRows.map((cells, rIdx) => (
              <tr
                key={startIdx + rIdx}
                className="hover:bg-[var(--surface-2)]/40 dark:hover:bg-[#142B33]/60 transition-colors"
              >
                {headers.map((_, cIdx) => (
                  <td
                    key={cIdx}
                    className="px-3.5 py-2.5 text-[var(--text)] align-top"
                  >
                    {renderInlineMarkdown(cells[cIdx] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {footerRow && (
            <tfoot className="border-t border-[var(--border)] bg-[var(--surface-2)]/60 dark:bg-[#132930]/80 tabular-nums font-semibold">
              <tr>
                {headers.map((_, cIdx) => (
                  <td
                    key={cIdx}
                    className="px-3.5 py-2.5 text-[var(--text)] align-top"
                  >
                    {renderInlineMarkdown(footerRow[cIdx] ?? '')}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {showPaginationBar && (
        <div className="px-3.5 py-2.5 border-t border-[var(--border)] bg-[var(--surface-2)]/45 dark:bg-[#10242B] flex flex-wrap items-center justify-between gap-2.5 text-xs text-[var(--text-muted)]">
          <div className="font-mono tabular-nums text-[11.5px]">
            Menampilkan{' '}
            <strong className="text-[var(--text)] font-semibold">
              {displayStart}–{displayEnd}
            </strong>{' '}
            dari{' '}
            <strong className="text-[var(--text)] font-semibold">{totalRows}</strong> baris
            {totalPages > 1 && (
              <span className="ml-1.5 text-[var(--text-muted)]/80">
                · Hal. {safePage}/{totalPages}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 ml-auto">
            <div
              role="group"
              aria-label="Jumlah baris per halaman"
              className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-[var(--bg)] border border-[var(--border)]"
            >
              {CHAT_TABLE_PAGE_SIZES.map((sz) => {
                const active = pageSize === sz;
                return (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => {
                      setPageSize(sz);
                      setPage(1);
                    }}
                    className={`px-2 py-0.5 text-[11px] font-mono font-medium rounded-md transition-colors cursor-pointer ${
                      active
                        ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    {sz}
                  </button>
                );
              })}
              <span className="px-1.5 text-[10.5px] text-[var(--text-muted)] select-none">
                / hal
              </span>
            </div>

            {totalPages > 1 && (
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  aria-label="Halaman sebelumnya"
                  className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:border-[var(--accent)] disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>

                {pageNumbers.map((item, idx) =>
                  item === 'ellipsis' ? (
                    <span
                      key={`el-${idx}`}
                      className="px-1 text-[11px] text-[var(--text-muted)] select-none"
                    >
                      …
                    </span>
                  ) : (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setPage(item)}
                      aria-current={item === safePage ? 'page' : undefined}
                      className={`min-w-[28px] h-7 px-1.5 rounded-md font-mono text-[11.5px] font-medium border transition-colors cursor-pointer ${
                        item === safePage
                          ? 'bg-[var(--accent)] text-[var(--on-accent)] border-[var(--accent)]'
                          : 'bg-[var(--surface)] text-[var(--text)] border-[var(--border)] hover:border-[var(--accent)]'
                      }`}
                    >
                      {item}
                    </button>
                  )
                )}

                <button
                  type="button"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  aria-label="Halaman berikutnya"
                  className="inline-flex items-center justify-center w-7 h-7 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:border-[var(--accent)] disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

function renderFormattedAnswer(
  text: string,
  options?: {
    msgKey?: string;
    copiedCodeKey?: string | null;
    onCopyCode?: (codeKey: string, codeText: string) => void;
  }
): React.ReactNode {
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  const msgKey = options?.msgKey || 'ans';

  let i = 0;
  while (i < lines.length) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (!line) {
      i++;
      continue;
    }

    // Fenced code block
    if (line.startsWith('```')) {
      const startIdx = i;
      const lang = line.slice(3).trim();
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length && lines[i].trim().startsWith('```')) {
        i++;
      }
      const codeText = codeLines.join('\n');
      const codeKey = `${msgKey}-code-${startIdx}`;
      const isCodeCopied = options?.copiedCodeKey === codeKey;
      blocks.push(
        <div
          key={`code-${startIdx}`}
          className="my-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)]/70 dark:bg-[#0D1E24] overflow-hidden"
        >
          <div className="px-3.5 py-2 border-b border-[var(--border)] flex items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
            <span className="font-mono text-[11px]">{lang || 'teks'}</span>
            {options?.onCopyCode && (
              <button
                type="button"
                onClick={() => options.onCopyCode?.(codeKey, codeText)}
                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
              >
                {isCodeCopied ? (
                  <Check className="w-3.5 h-3.5 text-[var(--accent)]" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{isCodeCopied ? 'Tersalin' : 'Salin kode'}</span>
              </button>
            )}
          </div>
          <pre className="p-3.5 overflow-x-auto text-[13px] leading-relaxed font-mono text-[var(--text)]">
            <code>{codeText}</code>
          </pre>
        </div>
      );
      continue;
    }

    // GFM pipe table: header row + separator row + 0..N body rows
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      isMarkdownTableSeparator(lines[i + 1])
    ) {
      const headers = splitMarkdownTableRow(line);
      const startIdx = i;
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length) {
        const rowLine = lines[i].trim();
        if (!rowLine || !rowLine.includes('|')) break;
        rows.push(splitMarkdownTableRow(rowLine));
        i++;
      }

      blocks.push(
        <PaginatedChatTable
          key={`${msgKey}-tbl-${startIdx}`}
          headers={headers}
          rows={rows}
        />
      );
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,})$/.test(line)) {
      blocks.push(
        <hr
          key={`hr-${i}`}
          className="border-[var(--border)] my-4"
        />
      );
      i++;
      continue;
    }

    // Blockquote (grouped, hairline border, no thick left bar)
    if (line.startsWith('> ')) {
      const startIdx = i;
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('> ')) {
        quoteLines.push(lines[i].trim().slice(2).trim());
        i++;
      }
      blocks.push(
        <blockquote
          key={`bq-${startIdx}`}
          className="my-2.5 px-4 py-3 rounded-xl bg-[var(--surface-2)]/65 dark:bg-[#12262D] border border-[var(--border)] text-[14.5px] text-[var(--text-muted)] space-y-1.5"
        >
          {quoteLines.map((ql, qIdx) => (
            <p key={qIdx}>{renderInlineMarkdown(ql)}</p>
          ))}
        </blockquote>
      );
      continue;
    }

    // Markdown headings
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = headingMatch[2].trim();
      blocks.push(
        <h3
          key={`h-${i}`}
          className={`font-display font-semibold text-[var(--text)] pt-3 first:pt-0 ${
            level <= 2 ? 'text-[17px] leading-snug' : 'text-[15.5px] leading-snug'
          }`}
        >
          {renderInlineMarkdown(headingText)}
        </h3>
      );
      i++;
      continue;
    }

    // Grouped unordered bullet list (exact ChatGPT hanging indent & dot marker)
    if (/^[-*•]\s+/.test(line)) {
      const startIdx = i;
      const items: string[] = [];
      while (i < lines.length) {
        const cur = lines[i].trim();
        if (/^[-*•]\s+/.test(cur)) {
          items.push(cur.replace(/^[-*•]\s+/, '').trim());
          i++;
        } else {
          break;
        }
      }
      blocks.push(
        <ul
          key={`ul-${startIdx}`}
          className="list-disc pl-6 space-y-1.5 my-2 marker:text-[var(--text-muted)]"
        >
          {items.map((itemText, idx) => (
            <li key={idx} className="pl-0.5 text-[var(--text)] leading-[1.7]">
              {renderInlineMarkdown(itemText)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Grouped ordered numbered list
    if (/^\d+\.\s+/.test(line)) {
      const startIdx = i;
      const items: string[] = [];
      const startNumMatch = line.match(/^(\d+)\.\s+/);
      const startNum = startNumMatch ? Number(startNumMatch[1]) : 1;
      while (i < lines.length) {
        const cur = lines[i].trim();
        if (/^\d+\.\s+/.test(cur)) {
          items.push(cur.replace(/^\d+\.\s+/, '').trim());
          i++;
        } else {
          break;
        }
      }
      blocks.push(
        <ol
          key={`ol-${startIdx}`}
          start={startNum}
          className="list-decimal pl-6 space-y-1.5 my-2 marker:text-[var(--text-muted)] marker:font-medium"
        >
          {items.map((itemText, idx) => (
            <li key={idx} className="pl-0.5 text-[var(--text)] leading-[1.7]">
              {renderInlineMarkdown(itemText)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Standard paragraph
    blocks.push(
      <p key={`p-${i}`} className="text-[var(--text)] leading-[1.72]">
        {renderInlineMarkdown(line)}
      </p>
    );
    i++;
  }

  return (
    <div className="space-y-3 text-[15px] leading-[1.72] text-[var(--text)] tracking-[0.005em] break-words">
      {blocks}
    </div>
  );
}

export const ChatQaView: React.FC<ChatQaViewProps> = ({
  user,
  idToken,
  divisions,
  directory,
  sops = [],
  pinnedCharts = [],
  onPinChart,
  onOpenDashboard,
  onOpenSopCitation,
  pendingQuestion,
  onConsumePendingQuestion,
}) => {
  const { theme } = useTheme();
  const { t } = useI18n();
  const appDark = theme === 'dark';
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedDivFilter, setSelectedDivFilter] = useState<string>('all');
  const [answerFormat, setAnswerFormat] = useState<AnswerDisplayFormat>('auto');
  const [visualMetaByMsgId, setVisualMetaByMsgId] = useState<Record<string, VisualIntentMeta>>({});
  const [aiChartSpecByMsgId, setAiChartSpecByMsgId] = useState<Record<string, AiChartSpec>>({});
  const [chartOpenByMsgId, setChartOpenByMsgId] = useState<Record<string, boolean>>({});
  const [perMessageOverride, setPerMessageOverride] = useState<
    Record<string, { showImage?: boolean; showDiagram?: boolean }>
  >({});
  const [lightboxImage, setLightboxImage] = useState<{
    url: string;
    title: string;
    downloadName: string;
  } | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [historyOpenMobile, setHistoryOpenMobile] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [copiedCodeKey, setCopiedCodeKey] = useState<string | null>(null);
  const [sharedMsgId, setSharedMsgId] = useState<string | null>(null);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [openMsgMoreId, setOpenMsgMoreId] = useState<string | null>(null);
  const [editingUserMsgId, setEditingUserMsgId] = useState<string | null>(null);
  const [editingUserDraft, setEditingUserDraft] = useState('');
  const [followUpPromptsByMsgId, setFollowUpPromptsByMsgId] = useState<Record<string, string[]>>({});
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [confirmDeleteSession, setConfirmDeleteSession] = useState<ChatSession | null>(null);
  const [savingSessionId, setSavingSessionId] = useState<string | null>(null);
  const [openSessionMenu, setOpenSessionMenu] = useState<{
    sessionId: string;
    top: number;
    left: number;
  } | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameSessionDraft, setRenameSessionDraft] = useState('');
  const [noteEditorMsgId, setNoteEditorMsgId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [savingFeedback, setSavingFeedback] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastFailedPrompt, setLastFailedPrompt] = useState<string | null>(null);
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null);
  const [streamingStatusText, setStreamingStatusText] = useState<string>(
    'Menyiapkan jawaban AI...'
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const sessionMenuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const lastAutoScrollRef = useRef<number>(0);
  const skipNextFetchSessionIdRef = useRef<string | null>(null);
  const hasPendingOnMountRef = useRef<boolean>(Boolean(pendingQuestion));

  const focusChatInput = () => {
    requestAnimationFrame(() => {
      chatInputRef.current?.focus({ preventScroll: true });
    });
  };

  useEffect(() => {
    focusChatInput();
  }, [activeSession?.id]);

  // Pre-warm server SOP chunk cache as soon as user opens Q&A view
  useEffect(() => {
    if (!idToken) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getFreshIdToken(idToken);
        if (cancelled || !token) return;
        await fetch('/api/rag/warm', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // Non-blocking warmup
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [idToken, user.uid]);

  const ownerKey = user.rbacUserId || user.uid;

  useEffect(() => {
    let active = true;
    setLoadingSessions(true);
    setSessions([]);
    setActiveSession(null);
    setMessages([]);
    fetchUserChatSessionsApi(idToken)
      .then((list) => {
        if (!active) return;
        const sorted = sortChatSessions(list);
        setSessions(sorted);
        if (sorted.length > 0 && !hasPendingOnMountRef.current) {
          setActiveSession(sorted[0]);
        }
      })
      .catch((err) => {
        if (active) setErrorMsg(err instanceof Error ? err.message : 'Gagal memuat riwayat chat.');
      })
      .finally(() => {
        if (active) setLoadingSessions(false);
      });
    return () => {
      active = false;
    };
  }, [ownerKey]);

  const activeSessionId = activeSession?.id || '';
  useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
      return;
    }
    if (skipNextFetchSessionIdRef.current === activeSessionId) {
      skipNextFetchSessionIdRef.current = null;
      return;
    }
    let active = true;
    fetchUserChatMessagesApi(activeSessionId, idToken)
      .then((list) => {
        if (active) setMessages(list);
      })
      .catch((err) => {
        if (active) setErrorMsg(err instanceof Error ? err.message : 'Gagal memuat pesan.');
      });
    return () => {
      active = false;
    };
  }, [activeSessionId, ownerKey]);

  useEffect(() => {
    const now = Date.now();
    if (streamingMsgId) {
      if (now - lastAutoScrollRef.current >= 120) {
        lastAutoScrollRef.current = now;
        bottomRef.current?.scrollIntoView({ behavior: 'auto' });
      }
    } else {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, sending, streamingMsgId]);

  const handleNewChat = () => {
    if (sending) return;
    setActiveSession(null);
    setMessages([]);
    setErrorMsg(null);
    setLastFailedPrompt(null);
    setHistoryOpenMobile(false);
    focusChatInput();
  };

  const handleSend = async (
    overrideText?: string,
    options?: { forceNewSession?: boolean }
  ) => {
    const questionText = (overrideText ?? input).trim();
    if (!questionText || sending) {
      focusChatInput();
      return;
    }

    const useNewSession = Boolean(options?.forceNewSession);
    setErrorMsg(null);
    setLastFailedPrompt(null);
    setSending(true);
    if (!overrideText) setInput('');
    focusChatInput();

    const priorMessages = useNewSession ? [] : messages.slice(-8);
    const randSuffix = Math.random().toString(36).slice(2, 7);
    const tempUserId = `temp_u_${Date.now()}_${randSuffix}`;
    const tempBotId = `temp_b_${Date.now()}_${randSuffix}`;
    const existingSessionId = useNewSession ? '' : activeSession?.id || '';

    const optimisticUserMsg: ChatMessage = {
      id: tempUserId,
      sessionId: existingSessionId,
      userId: ownerKey,
      role: 'user',
      content: questionText,
      citations: [],
      hasConflict: false,
      answered: true,
      suggestedContact: '',
      feedback: 'none',
      feedbackNote: '',
      logId: '',
    };

    const optimisticBotMsg: ChatMessage = {
      id: tempBotId,
      sessionId: existingSessionId,
      userId: ownerKey,
      role: 'assistant',
      content: '',
      citations: [],
      hasConflict: false,
      answered: true,
      suggestedContact: '',
      feedback: 'none',
      feedbackNote: '',
      logId: '',
    };

    if (useNewSession) {
      setActiveSession(null);
      setMessages([optimisticUserMsg, optimisticBotMsg]);
    } else {
      setMessages((prev) => [...prev, optimisticUserMsg, optimisticBotMsg]);
    }
    setStreamingMsgId(tempBotId);
    setStreamingStatusText('Menyiapkan konteks & data...');

    try {
      const visualCatalog: SopVisualCatalogEntry[] = sops.map((sop) => ({
        sopId: sop.id,
        docNumber: sop.docNumber,
        title: sop.title,
        sectionsWithImages: (sop.sections || [])
          .filter((s) => (s.images || []).length > 0)
          .map((s) => ({
            order: s.order,
            title: s.title,
            captions: (s.images || []).map((im) => im.caption || s.title),
            ocrKeywords: (s.images || [])
              .map((im) => (im.ocrText || '').trim())
              .filter(Boolean),
          })),
        sectionsWithoutImages: (sop.sections || [])
          .filter((s) => !(s.images || []).length)
          .map((s) => ({
            order: s.order,
            title: s.title,
          })),
        pdfFigures: (sop.attachments || []).flatMap((a) =>
          (a.visualPages || []).map((vp) => ({
            pageNumber: vp.pageNumber,
            caption: vp.caption,
          }))
        ),
      }));

      const freshToken = await getFreshIdToken(idToken);
      const ragData = await streamApiSse<{
        answered: boolean;
        answerMarkdown: string;
        hasConflict: boolean;
        conflictSummary: string;
        suggestedContact: string;
        citations: CitationSource[];
        matchedSopIds: string[];
        showVisual?: boolean;
        visualType?: 'pdf_page' | 'diagram';
        visualPageNumbers?: number[];
        chartSpec?: AiChartSpec | null;
        followUpPrompts?: string[];
      }>(
        '/api/rag/ask-stream',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${freshToken}`,
          },
          body: JSON.stringify({
            question: questionText,
            history: [...priorMessages, optimisticUserMsg].slice(-8).map((m) => ({
              role: m.role,
              content: m.content,
            })),
            divisions,
            visualCatalog,
          }),
        },
        {
          fallbackError: 'Gagal mendapatkan jawaban AI.',
          onStatus: (statusText) => {
            setStreamingStatusText(statusText);
          },
          onDelta: (chunk) => {
            setMessages((prev) =>
              prev.map((m) => (m.id === tempBotId ? { ...m, content: m.content + chunk } : m))
            );
          },
        }
      );

      const assistantContent =
        ragData.hasConflict && ragData.conflictSummary
          ? `${ragData.answerMarkdown}\n\n**Catatan Konflik SOP:** ${ragData.conflictSummary}`
          : ragData.answerMarkdown;

      const resolvedVisualMeta: VisualIntentMeta = {
        showVisual: Boolean(ragData.showVisual),
        visualType:
          ragData.visualType === 'diagram' || isDiagramRequest(questionText)
            ? 'diagram'
            : 'pdf_page',
        visualPageNumbers: Array.isArray(ragData.visualPageNumbers)
          ? ragData.visualPageNumbers
          : [],
      };

      // Immediately show finalized content, citations, and badges
      setStreamingMsgId(null);
      setVisualMetaByMsgId((prev) => ({
        ...prev,
        [tempBotId]: resolvedVisualMeta,
      }));
      if (ragData.chartSpec) {
        setAiChartSpecByMsgId((prev) => ({
          ...prev,
          [tempBotId]: ragData.chartSpec as AiChartSpec,
        }));
      }
      if (Array.isArray(ragData.followUpPrompts) && ragData.followUpPrompts.length > 0) {
        setFollowUpPromptsByMsgId((prev) => ({
          ...prev,
          [tempBotId]: ragData.followUpPrompts as string[],
        }));
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempBotId
            ? {
                ...m,
                content: assistantContent,
                citations: ragData.citations,
                hasConflict: ragData.hasConflict,
                answered: ragData.answered,
                suggestedContact: ragData.suggestedContact,
              }
            : m
        )
      );

      let currentSession = useNewSession ? null : activeSession;
      if (!currentSession) {
        currentSession = await createUserChatSessionApi(questionText.slice(0, 80), idToken);
        skipNextFetchSessionIdRef.current = currentSession.id;
        setSessions((prev) =>
          sortChatSessions([
            currentSession!,
            ...prev.filter((s) => s.id !== currentSession!.id),
          ])
        );
        setActiveSession(currentSession);
      }

      const pregeneratedLogId = makeSafeId('qlog');
      const [savedUserMsg, , savedAssistantMsg] = await Promise.all([
        saveUserChatMessageApi(
          {
            sessionId: currentSession.id,
            role: 'user',
            content: questionText,
          },
          idToken
        ),
        logQueryAndAnswer({
          id: pregeneratedLogId,
          user,
          question: questionText,
          answered: ragData.answered,
          matchedSopIds: ragData.matchedSopIds,
          primaryCitation: ragData.citations[0],
          directory,
        }).catch(() => ''),
        saveUserChatMessageApi(
          {
            sessionId: currentSession.id,
            role: 'assistant',
            content: assistantContent,
            citations: ragData.citations,
            hasConflict: ragData.hasConflict,
            answered: ragData.answered,
            suggestedContact: ragData.suggestedContact,
            logId: pregeneratedLogId,
          },
          idToken
        ),
      ]);

      setVisualMetaByMsgId((prev) => {
        const next = { ...prev, [savedAssistantMsg.id]: resolvedVisualMeta };
        delete next[tempBotId];
        return next;
      });
      if (ragData.chartSpec) {
        setAiChartSpecByMsgId((prev) => {
          const next = { ...prev, [savedAssistantMsg.id]: ragData.chartSpec as AiChartSpec };
          delete next[tempBotId];
          return next;
        });
      }
      if (Array.isArray(ragData.followUpPrompts) && ragData.followUpPrompts.length > 0) {
        setFollowUpPromptsByMsgId((prev) => {
          const next = { ...prev, [savedAssistantMsg.id]: ragData.followUpPrompts as string[] };
          delete next[tempBotId];
          return next;
        });
      }
      setMessages((prev) => {
        const mapped = prev.map((m) => {
          if (m.id === tempUserId) return savedUserMsg;
          if (m.id === tempBotId) return savedAssistantMsg;
          return m;
        });
        const seen = new Set<string>();
        return mapped.filter((m) => {
          if (seen.has(m.id)) return false;
          seen.add(m.id);
          return true;
        });
      });
    } catch (err) {
      setStreamingMsgId(null);
      setMessages((prev) => prev.filter((m) => m.id !== tempBotId && m.id !== tempUserId));
      const rawMessage =
        err instanceof Error ? err.message : 'Terjadi kesalahan saat mengirim pertanyaan.';
      setErrorMsg(formatChatErrorMessage(rawMessage));
      setLastFailedPrompt(questionText);
    } finally {
      setSending(false);
      const activeTag = document.activeElement?.tagName;
      if (activeTag !== 'INPUT' && activeTag !== 'TEXTAREA') {
        focusChatInput();
      }
    }
  };

  const handleOpenSessionMenu = (
    e: React.MouseEvent<HTMLButtonElement>,
    sessionId: string
  ) => {
    e.stopPropagation();
    if (openSessionMenu?.sessionId === sessionId) {
      setOpenSessionMenu(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const menuWidth = 196;
    const menuHeight = 148;
    const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const viewportH = typeof window !== 'undefined' ? window.innerHeight : 800;

    let left = rect.right - menuWidth + 4;
    if (left + menuWidth > viewportW - 12) {
      left = viewportW - menuWidth - 12;
    }
    if (left < 12) {
      left = Math.min(rect.left, viewportW - menuWidth - 12);
    }

    let top = rect.bottom + 6;
    if (top + menuHeight > viewportH - 12) {
      top = Math.max(12, rect.top - menuHeight - 6);
    }

    setOpenSessionMenu({ sessionId, top, left });
  };

  const handleTogglePinSession = async (session: ChatSession) => {
    if (savingSessionId || deletingSessionId) return;
    setOpenSessionMenu(null);
    setSavingSessionId(session.id);
    setErrorMsg(null);
    const nextPinned = !Boolean(session.isPinned);
    try {
      const { isPinned, pinnedAt } = await togglePinUserChatSessionApi(
        session.id,
        nextPinned,
        idToken
      );
      setSessions((prev) =>
        sortChatSessions(
          prev.map((s) =>
            s.id === session.id ? { ...s, isPinned, pinnedAt, updatedAt: Date.now() } : s
          )
        )
      );
      setActiveSession((prev) =>
        prev && prev.id === session.id ? { ...prev, isPinned, pinnedAt } : prev
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Gagal mengubah status pin percakapan.'
      );
    } finally {
      setSavingSessionId(null);
    }
  };

  const handleStartRenameSession = (session: ChatSession) => {
    setOpenSessionMenu(null);
    setRenamingSessionId(session.id);
    setRenameSessionDraft(session.title);
  };

  const handleCancelRenameSession = () => {
    setRenamingSessionId(null);
    setRenameSessionDraft('');
  };

  const handleCommitRenameSession = async (sessionId: string) => {
    if (savingSessionId) return;
    const target = sessions.find((s) => s.id === sessionId);
    const trimmed = renameSessionDraft.trim().slice(0, 200);
    if (!trimmed || (target && trimmed === target.title)) {
      handleCancelRenameSession();
      return;
    }
    setSavingSessionId(sessionId);
    setErrorMsg(null);
    try {
      const updatedTitle = await renameUserChatSessionApi(sessionId, trimmed, idToken);
      setSessions((prev) =>
        sortChatSessions(
          prev.map((s) =>
            s.id === sessionId ? { ...s, title: updatedTitle, updatedAt: Date.now() } : s
          )
        )
      );
      setActiveSession((prev) =>
        prev && prev.id === sessionId ? { ...prev, title: updatedTitle } : prev
      );
      handleCancelRenameSession();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Gagal mengganti nama percakapan.'
      );
    } finally {
      setSavingSessionId(null);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (deletingSessionId) return;
    setOpenSessionMenu(null);
    if (renamingSessionId === sessionId) {
      handleCancelRenameSession();
    }
    setDeletingSessionId(sessionId);
    setErrorMsg(null);
    try {
      await deleteUserChatSessionApi(sessionId, idToken);
      setSessions((prev) => {
        const remaining = prev.filter((s) => s.id !== sessionId);
        if (activeSession?.id === sessionId) {
          setActiveSession(remaining[0] || null);
          if (remaining.length === 0) setMessages([]);
        }
        return remaining;
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menghapus riwayat percakapan.');
    } finally {
      setDeletingSessionId(null);
      setConfirmDeleteSession(null);
    }
  };

  useEffect(() => {
    if (!renamingSessionId) return;
    const frame = requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [renamingSessionId]);

  useEffect(() => {
    if (!openSessionMenu) return;
    const menuSession = sessions.find((s) => s.id === openSessionMenu.sessionId);

    const handlePointerDown = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null;
      if (sessionMenuRef.current?.contains(target)) return;
      if (target?.closest('[data-session-menu-trigger="true"]')) return;
      setOpenSessionMenu(null);
    };

    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setOpenSessionMenu(null);
        return;
      }
      if (!menuSession || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
      const key = ev.key.toLowerCase();
      if (key === 'p') {
        ev.preventDefault();
        void handleTogglePinSession(menuSession);
      } else if (key === 'r') {
        ev.preventDefault();
        handleStartRenameSession(menuSession);
      }
    };

    const handleDismiss = () => setOpenSessionMenu(null);

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleDismiss);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleDismiss);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSessionMenu, sessions]);

  const handleFeedback = async (
    msg: ChatMessage,
    feedback: FeedbackType,
    feedbackNote = ''
  ) => {
    setSavingFeedback(true);
    setErrorMsg(null);
    try {
      await updateUserChatMessageFeedbackApi(
        {
          sessionId: msg.sessionId,
          messageId: msg.id,
          feedback,
          feedbackNote,
        },
        idToken
      );
      void updateQueryLogFeedback({
        logId: msg.logId,
        feedback,
        feedbackNote,
      });
      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, feedback, feedbackNote } : m))
      );
      if (feedback === 'inaccurate' || feedback === 'outdated') {
        setNoteEditorMsgId(msg.id);
        setNoteDraft(feedbackNote);
      } else if (noteEditorMsgId === msg.id) {
        setNoteEditorMsgId(null);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menyimpan umpan balik.');
    } finally {
      setSavingFeedback(false);
    }
  };

  const handleSaveFeedbackNote = async (msg: ChatMessage) => {
    if (!msg.feedback || msg.feedback === 'none' || msg.feedback === 'helpful') return;
    setSavingFeedback(true);
    setErrorMsg(null);
    try {
      const trimmed = noteDraft.trim();
      await updateUserChatMessageFeedbackApi(
        {
          sessionId: msg.sessionId,
          messageId: msg.id,
          feedback: msg.feedback,
          feedbackNote: trimmed,
        },
        idToken
      );
      void updateQueryLogFeedback({
        logId: msg.logId,
        feedback: msg.feedback,
        feedbackNote: trimmed,
      });
      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, feedbackNote: trimmed } : m))
      );
      setNoteEditorMsgId(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menyimpan catatan evaluasi.');
    } finally {
      setSavingFeedback(false);
    }
  };

  const handleCopyAnswer = async (msg: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopiedMsgId(msg.id);
      setTimeout(() => setCopiedMsgId((curr) => (curr === msg.id ? null : curr)), 2000);
    } catch {
      // Ignore clipboard failures in restricted frames
    }
  };

  const handleCopyCode = async (codeKey: string, codeText: string) => {
    try {
      await navigator.clipboard.writeText(codeText);
      setCopiedCodeKey(codeKey);
      setTimeout(() => setCopiedCodeKey((curr) => (curr === codeKey ? null : curr)), 2000);
    } catch {
      // Ignore clipboard failures in restricted frames
    }
  };

  const handleToggleSpeakAnswer = (msg: ChatMessage) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const synth = window.speechSynthesis;
    if (speakingMsgId === msg.id) {
      synth.cancel();
      setSpeakingMsgId(null);
      return;
    }
    const plainText = stripMarkdownForSpeech(msg.content);
    if (!plainText) return;
    try {
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(plainText);
      utterance.lang = 'id-ID';
      utterance.rate = 1.02;
      utterance.onend = () => {
        setSpeakingMsgId((curr) => (curr === msg.id ? null : curr));
      };
      utterance.onerror = () => {
        setSpeakingMsgId((curr) => (curr === msg.id ? null : curr));
      };
      setSpeakingMsgId(msg.id);
      synth.speak(utterance);
    } catch {
      setSpeakingMsgId(null);
    }
  };

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [activeSessionId]);

  useEffect(() => {
    if (!openMsgMoreId) return;
    const handlePointerDown = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target?.closest('[data-msg-more-popover="true"]')) return;
      if (target?.closest('[data-msg-more-trigger="true"]')) return;
      setOpenMsgMoreId(null);
    };
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setOpenMsgMoreId(null);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openMsgMoreId]);

  useEffect(() => {
    const el = chatInputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const handleShareUserMessage = async (msg: ChatMessage, msgIndex: number) => {
    const nextMsg = messages[msgIndex + 1];
    const hasPairedAnswer =
      nextMsg && nextMsg.role === 'assistant' && nextMsg.id !== streamingMsgId && nextMsg.content.trim();

    const citationLine =
      hasPairedAnswer && nextMsg.citations && nextMsg.citations.length > 0
        ? `\n\nSumber SOP: ${nextMsg.citations
            .map((c) => `${c.docNumber} v${c.version} (${c.title})`)
            .join('; ')}`
        : '';

    const sharePayload = hasPairedAnswer
      ? `Pertanyaan:\n${msg.content}\n\nJawaban NARA AI:\n${nextMsg.content}${citationLine}`
      : msg.content;

    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({
          title: 'Tanya Jawab NARA AI',
          text: sharePayload,
        });
        setSharedMsgId(msg.id);
        setTimeout(() => setSharedMsgId((curr) => (curr === msg.id ? null : curr)), 2200);
        return;
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
    }

    try {
      await navigator.clipboard.writeText(sharePayload);
      setSharedMsgId(msg.id);
      setTimeout(() => setSharedMsgId((curr) => (curr === msg.id ? null : curr)), 2200);
    } catch {
      // Ignore clipboard failures in restricted frames
    }
  };

  const handleShareAssistantMessage = async (msg: ChatMessage, msgIndex: number) => {
    const prevMsg = msgIndex > 0 ? messages[msgIndex - 1] : null;
    const questionPrefix =
      prevMsg && prevMsg.role === 'user' && prevMsg.content.trim()
        ? `Pertanyaan:\n${prevMsg.content}\n\nJawaban NARA AI:\n`
        : '';
    const citationLine =
      msg.citations && msg.citations.length > 0
        ? `\n\nSumber SOP: ${msg.citations
            .map((c) => `${c.docNumber} v${c.version} (${c.title})`)
            .join('; ')}`
        : '';
    const sharePayload = `${questionPrefix}${msg.content}${citationLine}`;

    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({
          title: 'Tanya Jawab NARA AI',
          text: sharePayload,
        });
        setSharedMsgId(msg.id);
        setTimeout(() => setSharedMsgId((curr) => (curr === msg.id ? null : curr)), 2200);
        return;
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
    }

    try {
      await navigator.clipboard.writeText(sharePayload);
      setSharedMsgId(msg.id);
      setTimeout(() => setSharedMsgId((curr) => (curr === msg.id ? null : curr)), 2200);
    } catch {
      // Ignore clipboard failures in restricted frames
    }
  };

  const handleRegenerateAssistantMessage = (msgIndex: number) => {
    if (sending) return;
    for (let idx = msgIndex - 1; idx >= 0; idx--) {
      const candidate = messages[idx];
      if (candidate.role === 'user' && candidate.content.trim()) {
        void handleSend(candidate.content);
        return;
      }
    }
  };

  const handleStartEditUserMessage = (msg: ChatMessage) => {
    if (sending) return;
    setEditingUserMsgId(msg.id);
    setEditingUserDraft(msg.content);
  };

  const handleCancelEditUserMessage = () => {
    setEditingUserMsgId(null);
    setEditingUserDraft('');
  };

  const handleSubmitEditedUserMessage = async () => {
    const trimmed = editingUserDraft.trim();
    if (!trimmed || sending) return;
    setEditingUserMsgId(null);
    setEditingUserDraft('');
    await handleSend(trimmed);
  };

  const chartSpecsByMsgId = useMemo(() => {
    const map = new Map<
      string,
      { spec: AiChartSpec; userQuestion: string; autoShowChart: boolean }
    >();
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role !== 'assistant' || msg.id === streamingMsgId || !msg.content.trim()) {
        continue;
      }
      if (msg.answered === false) continue;
      const prevUserMsg =
        i > 0 && messages[i - 1].role === 'user' ? messages[i - 1].content : '';
      const userExplicitlyAskedChart = isChartRequest(prevUserMsg);
      const aiProvidedSpec = aiChartSpecByMsgId[msg.id];
      const fallbackSource =
        msg.citations && msg.citations.length > 0
          ? msg.citations[0].docNumber
          : 'ERP Live / Analisa AI';

      let spec = extractChartSpecFromAnswer(
        msg.content,
        prevUserMsg,
        aiProvidedSpec,
        fallbackSource
      );

      // If user asked a follow-up like "tampilkan diagramnya" / "buatkan grafik garisnya"
      // and AI replied briefly without repeating the full table, borrow data from the previous assistant message
      if (!spec && userExplicitlyAskedChart) {
        for (let back = i - 1; back >= Math.max(0, i - 4); back--) {
          const earlier = messages[back];
          if (earlier.role === 'assistant' && earlier.content.trim()) {
            const earlierQuestion =
              back > 0 && messages[back - 1].role === 'user' ? messages[back - 1].content : '';
            const fromEarlier = extractChartSpecFromAnswer(
              earlier.content,
              prevUserMsg || earlierQuestion,
              aiChartSpecByMsgId[earlier.id],
              fallbackSource
            );
            if (fromEarlier) {
              spec = fromEarlier;
              break;
            }
          }
        }
      }

      if (spec) {
        map.set(msg.id, {
          spec,
          userQuestion: prevUserMsg,
          autoShowChart: userExplicitlyAskedChart || Boolean(aiProvidedSpec),
        });
      }
    }
    return map;
  }, [messages, streamingMsgId, aiChartSpecByMsgId]);

  const visualAssetsByMsgId = useMemo(() => {
    const map = new Map<
      string,
      {
        diagramUrl: string;
        pdfVisuals: ReferencedPdfVisual[];
        hasAnyPdfVisualsOnSop: boolean;
        hasLegacyPdfWithoutVisuals: boolean;
        aiSaidNoVisual: boolean;
        autoShowVisual: boolean;
        preferredType: 'pdf_page' | 'diagram';
      }
    >();
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role !== 'assistant' || msg.id === streamingMsgId || !msg.content.trim()) {
        continue;
      }
      const prevUserMsg =
        i > 0 && messages[i - 1].role === 'user' ? messages[i - 1].content : '';
      const priorContext = messages
        .slice(Math.max(0, i - 4), i)
        .map((m) => m.content)
        .join(' ');
      const meta = visualMetaByMsgId[msg.id];
      const aiSaidNoVisual = NO_VISUAL_REPLY_REGEX.test(msg.content);
      const hasSopCitations = (msg.citations || []).length > 0;
      const hasDataChart = chartSpecsByMsgId.has(msg.id);
      const isDataChartMsg =
        hasDataChart || isDataChartVisualQuery(prevUserMsg) || isChartRequest(prevUserMsg);
      const explicitlyAskedSopVisual = SOP_EXPLICIT_VISUAL_REGEX.test(prevUserMsg);

      // For data/ERP/chart answers without SOP citations and without explicit SOP visual ask,
      // NEVER render unrelated SOP screenshots or procedure infographics!
      if ((isDataChartMsg && !explicitlyAskedSopVisual) || (!hasSopCitations && !explicitlyAskedSopVisual && isDataChartVisualQuery(prevUserMsg))) {
        map.set(msg.id, {
          diagramUrl: '',
          pdfVisuals: [],
          hasAnyPdfVisualsOnSop: false,
          hasLegacyPdfWithoutVisuals: false,
          aiSaidNoVisual,
          autoShowVisual: false,
          preferredType: 'pdf_page',
        });
        continue;
      }

      const userAskedDiagram = isDiagramRequest(prevUserMsg);
      const userAskedVisual = isVisualRequest(prevUserMsg);
      const preferredType: 'pdf_page' | 'diagram' =
        meta?.visualType ?? (userAskedDiagram ? 'diagram' : 'pdf_page');

      const {
        visuals: pdfVisuals,
        hasAnyPdfVisualsOnSop,
        hasLegacyPdfWithoutVisuals,
      } = findReferencedSopVisuals({
        msg,
        userQuestion: prevUserMsg,
        priorContext,
        sops,
        explicitPageNumbers: meta?.visualPageNumbers,
      });

      const hasVerifiedPdfMatch = pdfVisuals.length > 0;
      const inferredShowVisual =
        !aiSaidNoVisual &&
        (meta?.showVisual === true ||
          userAskedDiagram ||
          (userAskedVisual && (meta?.showVisual !== false || hasVerifiedPdfMatch)));

      const diagramUrl =
        hasSopCitations || userAskedDiagram || explicitlyAskedSopVisual
          ? renderSopAnswerToImage({
              question: prevUserMsg || 'Ringkasan Jawaban SOP',
              content: msg.content,
              citations: msg.citations,
              hasConflict: msg.hasConflict,
              answered: msg.answered,
            })
          : '';

      map.set(msg.id, {
        diagramUrl,
        pdfVisuals,
        hasAnyPdfVisualsOnSop,
        hasLegacyPdfWithoutVisuals,
        aiSaidNoVisual,
        autoShowVisual: msg.answered !== false && inferredShowVisual,
        preferredType,
      });
    }
    return map;
  }, [messages, sops, streamingMsgId, visualMetaByMsgId, chartSpecsByMsgId]);

  useEffect(() => {
    const q = (pendingQuestion || '').trim();
    if (!q || !idToken || sending) return;
    hasPendingOnMountRef.current = true;
    onConsumePendingQuestion?.();
    void handleSend(q, { forceNewSession: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingQuestion, idToken]);

  const suggestedQuestions = divisions
    .filter((d) => selectedDivFilter === 'all' || d.id === selectedDivFilter)
    .flatMap((d) =>
      (d.suggestedQuestions || []).map((q) => ({
        divisionName: d.name,
        question: q,
      }))
    );

  const assetQuickPrompts = [
    {
      label: 'Grafik Tren Keuangan Bulanan',
      question:
        'Tampilkan rekap bulanan Pendapatan, HPP, dan Laba Bersih mulai Maret 2026 dalam bentuk tabel untuk bahan presentasi diagram.',
    },
    {
      label: 'Diagram Piutang Terbesar',
      question:
        'Buatkan tabel top 10 customer dengan sisa piutang terbesar saat ini dari ERP untuk disajikan sebagai diagram presentasi.',
    },
    {
      label: 'Rekap Nilai Buku Aset Tetap',
      question:
        'Ringkas nilai perolehan dan sisa nilai buku aset tetap perusahaan per kategori dalam tabel untuk presentasi grafik.',
    },
  ];

  return (
    <div className="h-[calc(100dvh-4rem)] flex flex-col lg:flex-row bg-[var(--bg)] text-[var(--text)]">
      {/* Left Conversation History (Matches Global Page Canvas) */}
      <aside className="lg:w-72 border-b lg:border-b-0 lg:border-r border-[var(--border)] bg-[var(--bg)] flex flex-col shrink-0">
        <div className="px-4 py-3 lg:p-4 border-b border-[var(--border)] flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setHistoryOpenMobile((v) => !v)}
            className="inline-flex items-center gap-1.5 text-left lg:pointer-events-none cursor-pointer"
          >
            <h2 className="font-display text-sm font-semibold text-[var(--text)]">
              Riwayat Tanya SOP
            </h2>
            <span className="lg:hidden font-mono text-xs text-[var(--text-muted)] tabular-nums">
              ({sessions.length})
            </span>
            <span className="lg:hidden text-[var(--text-muted)]">
              {historyOpenMobile ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </span>
          </button>
          <button
            type="button"
            onClick={handleNewChat}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] rounded-[8px] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <MessageSquarePlus className="w-3.5 h-3.5" />
            <span>Tanya Baru</span>
          </button>
        </div>
        <div
          onScroll={() => {
            if (openSessionMenu) setOpenSessionMenu(null);
          }}
          className={`${
            historyOpenMobile ? 'block max-h-56' : 'hidden'
          } lg:block lg:flex-1 overflow-y-auto p-2 space-y-0.5`}
        >
          {loadingSessions ? (
            <div className="p-2 space-y-2">
              <div className="h-4 bg-[var(--surface-2)] rounded w-3/4" />
              <div className="h-4 bg-[var(--surface-2)] rounded w-1/2" />
            </div>
          ) : sessions.length === 0 ? (
            <p className="p-2 text-xs text-[var(--text-muted)]">
              Belum ada percakapan. Mulai ajukan pertanyaan pertama Anda di bawah ini.
            </p>
          ) : (
            sessions.map((s) => {
              const isActive = activeSession?.id === s.id;
              const isMenuOpen = openSessionMenu?.sessionId === s.id;
              const isRenaming = renamingSessionId === s.id;
              const isBusy = savingSessionId === s.id || deletingSessionId === s.id;

              return (
                <div
                  key={s.id}
                  className={`group flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-[8px] text-xs transition-colors ${
                    isActive || isMenuOpen
                      ? 'bg-[var(--surface-2)] text-[var(--text)] font-semibold border border-[var(--border)]'
                      : 'text-[var(--text-muted)] hover:bg-[var(--surface)] hover:text-[var(--text)] border border-transparent'
                  }`}
                >
                  {isRenaming ? (
                    <form
                      onSubmit={(ev) => {
                        ev.preventDefault();
                        void handleCommitRenameSession(s.id);
                      }}
                      className="flex-1 flex items-center gap-1 min-w-0"
                    >
                      <input
                        ref={renameInputRef}
                        type="text"
                        value={renameSessionDraft}
                        onChange={(ev) => setRenameSessionDraft(ev.target.value)}
                        onKeyDown={(ev) => {
                          if (ev.key === 'Escape') {
                            ev.preventDefault();
                            handleCancelRenameSession();
                          }
                        }}
                        maxLength={200}
                        disabled={isBusy}
                        aria-label="Nama baru percakapan"
                        className="flex-1 min-w-0 px-2 py-1 text-xs rounded-md border border-[var(--accent)] bg-[var(--input-bg)] text-[var(--text)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                      />
                      <button
                        type="submit"
                        disabled={isBusy || !renameSessionDraft.trim()}
                        title="Simpan nama"
                        aria-label="Simpan nama"
                        className="p-1 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded transition-colors shrink-0 cursor-pointer disabled:opacity-40"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={handleCancelRenameSession}
                        title="Batal"
                        aria-label="Batal"
                        className="p-1 text-[var(--text-muted)] hover:text-[var(--text)] rounded transition-colors shrink-0 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setOpenSessionMenu(null);
                          setActiveSession(s);
                          setHistoryOpenMobile(false);
                        }}
                        className="flex-1 min-w-0 text-left py-1 cursor-pointer"
                        title={s.title}
                      >
                        <p className="truncate">{s.title}</p>
                      </button>
                      <div className="flex items-center gap-0.5 shrink-0">
                        {s.isPinned && (
                          <span
                            title="Disematkan"
                            className={`p-0.5 ${
                              isActive
                                ? 'text-[var(--accent-text)]'
                                : 'text-[var(--text-subtle)]'
                            }`}
                          >
                            <Pin className="w-3.5 h-3.5" />
                          </span>
                        )}
                        <button
                          type="button"
                          data-session-menu-trigger="true"
                          disabled={isBusy}
                          onClick={(ev) => handleOpenSessionMenu(ev, s.id)}
                          title="Opsi percakapan"
                          aria-label="Opsi percakapan"
                          aria-haspopup="menu"
                          aria-expanded={isMenuOpen}
                          className={`p-1 rounded-md transition-all shrink-0 cursor-pointer ${
                            isMenuOpen
                              ? 'opacity-100 bg-[var(--surface-3)] text-[var(--text)]'
                              : isActive
                                ? 'opacity-100 text-[var(--text)] hover:bg-[var(--surface-3)]'
                                : 'opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100 text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
                          }`}
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Floating Session Action Popover (Pin / Rename / Delete) */}
        {openSessionMenu &&
          (() => {
            const menuSession = sessions.find((s) => s.id === openSessionMenu.sessionId);
            if (!menuSession) return null;
            const isPinned = Boolean(menuSession.isPinned);
            const isBusy =
              savingSessionId === menuSession.id || deletingSessionId === menuSession.id;

            return (
              <div
                ref={sessionMenuRef}
                role="menu"
                aria-label="Aksi percakapan"
                style={{ top: openSessionMenu.top, left: openSessionMenu.left }}
                className="fixed z-50 w-48 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--modal-shadow)] p-1.5 text-xs"
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={isBusy}
                  onClick={() => void handleTogglePinSession(menuSession)}
                  className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-[6px] text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer disabled:opacity-50"
                >
                  <span className="inline-flex items-center gap-2.5">
                    {isPinned ? (
                      <PinOff className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                    ) : (
                      <Pin className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                    )}
                    <span>{isPinned ? 'Unpin' : 'Pin'}</span>
                  </span>
                  <span className="text-[10px] font-mono text-[var(--text-subtle)]">
                    P
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={isBusy}
                  onClick={() => handleStartRenameSession(menuSession)}
                  className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-[6px] text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer disabled:opacity-50"
                >
                  <span className="inline-flex items-center gap-2.5">
                    <Pencil className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                    <span>Rename</span>
                  </span>
                  <span className="text-[10px] font-mono text-[var(--text-subtle)]">
                    R
                  </span>
                </button>
                <div className="my-1 border-t border-[var(--border)]" />
                <button
                  type="button"
                  role="menuitem"
                  disabled={isBusy}
                  onClick={() => {
                    setOpenSessionMenu(null);
                    setConfirmDeleteSession(menuSession);
                  }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[6px] text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete</span>
                </button>
              </div>
            );
          })()}
      </aside>

      {/* Main Chat Canvas (ChatGPT Minimalist Conversational Flow) */}
      <section className="flex-1 flex flex-col min-w-0 bg-[var(--surface)] dark:bg-[var(--bg)]">
        {/* Subtle Format Toggle Strip */}
        <div className="bg-[var(--surface)] dark:bg-[var(--bg)] border-b border-[var(--border)]/70 px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <ImageIcon className="w-3.5 h-3.5 text-[var(--accent-text)]" />
            <span>Sajian Jawaban AI</span>
          </div>
          <div className="flex items-center gap-1 p-0.5 bg-[var(--surface-2)]/70 dark:bg-[var(--surface)] border border-[var(--border)] rounded-[8px]">
            {(
              [
                { id: 'auto', label: 'Sesuai Alur' },
                { id: 'text_and_image', label: 'Selalu Gambar' },
                { id: 'text_only', label: 'Teks Saja' },
              ] as { id: AnswerDisplayFormat; label: string }[]
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  setAnswerFormat(opt.id);
                  setPerMessageOverride({});
                }}
                className={`px-2.5 py-1 text-xs font-medium rounded-[6px] transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  answerFormat === opt.id
                    ? 'bg-[var(--accent)] text-[var(--on-accent)] font-semibold'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 pt-6 pb-8">
          <div className="max-w-[760px] mx-auto space-y-8">
            {messages.length === 0 ? (
              <div className="pt-4 sm:pt-8 space-y-8">
                <div className="space-y-2 text-center sm:text-left">
                  <h1 className="font-display text-2xl sm:text-[28px] font-semibold tracking-tight text-[var(--text)] [text-wrap:balance]">
                    {t('chat.title')}
                  </h1>
                  <p className="text-[14.5px] text-[var(--text-muted)] leading-relaxed">
                    {t('chat.subtitle')} · {t(`roles.${user.role}`)} · {user.divisionName || t('common.general')}
                  </p>
                </div>

                {/* Quick Prompts for Presentation Charts & Live Data */}
                <div className="space-y-3">
                  <span className="block text-xs font-semibold text-[var(--text-muted)]">
                    Contoh Pertanyaan Bahan Presentasi &amp; Grafik Langsung
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {assetQuickPrompts.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => handleSend(item.question)}
                        className="text-left p-4 bg-[var(--bg)]/60 dark:bg-[var(--surface)] hover:bg-[var(--surface-2)]/70 dark:hover:bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--accent)] rounded-2xl transition-colors cursor-pointer space-y-1.5"
                      >
                        <span className="block text-[11px] font-medium text-[var(--text-muted)]">
                          {item.label}
                        </span>
                        <span className="block text-[13px] font-medium text-[var(--text)] leading-snug">
                          {item.question}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Popular Question Suggestions per Division */}
                <div className="space-y-3 pt-4 border-t border-[var(--border)]/70">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[var(--text-muted)]">
                      Saran Pertanyaan Populer per Divisi
                    </span>
                    <div className="flex flex-wrap items-center gap-1 p-1 bg-[var(--bg)] dark:bg-[var(--surface)] border border-[var(--border)] rounded-lg">
                      <button
                        type="button"
                        onClick={() => setSelectedDivFilter('all')}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          selectedDivFilter === 'all'
                            ? 'bg-[var(--accent)] text-[var(--on-accent)] font-semibold'
                            : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                        }`}
                      >
                        Semua Divisi
                      </button>
                      {divisions.map((div) => (
                        <button
                          key={div.id}
                          type="button"
                          onClick={() => setSelectedDivFilter(div.id)}
                          className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            selectedDivFilter === div.id
                              ? 'bg-[var(--accent)] text-[var(--on-accent)] font-semibold'
                              : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                          }`}
                        >
                          {div.code}
                        </button>
                      ))}
                    </div>
                  </div>

                  {suggestedQuestions.length > 0 ? (
                    <div className="divide-y divide-[var(--border)]/70 border-y border-[var(--border)]/70">
                      {suggestedQuestions.map((item, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => handleSend(item.question)}
                          className="w-full text-left py-3 px-2 hover:bg-[var(--surface-2)]/50 dark:hover:bg-[var(--surface)] rounded-lg transition-colors cursor-pointer flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0 space-y-0.5">
                            <span className="block text-[14px] font-medium text-[var(--text)] leading-snug">
                              {item.question}
                            </span>
                            <span className="block text-xs text-[var(--text-muted)]">
                              {item.divisionName}
                            </span>
                          </div>
                          <CornerDownRight className="w-4 h-4 text-[var(--text-subtle)] shrink-0" />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--text-muted)]">
                      Ketik pertanyaan Anda di bawah untuk memulai pencarian SOP atau data ERP.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              messages.map((msg, msgIndex) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.role === 'user' ? (
                    editingUserMsgId === msg.id ? (
                      <div className="w-full max-w-[640px] bg-[var(--surface)] dark:bg-[var(--surface)] border border-[var(--accent)] rounded-2xl p-3.5 space-y-2.5">
                        <textarea
                          autoFocus
                          rows={3}
                          value={editingUserDraft}
                          onChange={(e) => setEditingUserDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              handleCancelEditUserMessage();
                            } else if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              void handleSubmitEditedUserMessage();
                            }
                          }}
                          aria-label="Edit pertanyaan"
                          className="w-full px-3.5 py-2.5 text-[15px] leading-relaxed bg-[var(--input-bg)] text-[var(--text)] border border-[var(--border)] rounded-xl focus:outline-none focus:border-[var(--accent)] resize-y"
                        />
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs text-[var(--text-muted)]">
                            Enter untuk kirim ulang · Esc untuk batal
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={handleCancelEditUserMessage}
                              className="px-3.5 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] rounded-full transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              Batal
                            </button>
                            <button
                              type="button"
                              disabled={!editingUserDraft.trim() || sending}
                              onClick={() => void handleSubmitEditedUserMessage()}
                              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 rounded-full transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <Send className="w-3.5 h-3.5" />
                              <span>Kirim Ulang</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="group flex flex-col items-end gap-1.5 max-w-[85%] sm:max-w-[72%]">
                        <div className="bg-[#0D7678] text-white dark:bg-[#135A61] dark:text-[#F0FAFA] rounded-[22px] px-5 py-2.5 text-[15px] leading-[1.6] whitespace-pre-wrap break-words">
                          {msg.content}
                        </div>
                        <div className="flex items-center justify-end gap-0.5 pr-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:focus-within:opacity-100 transition-opacity duration-150">
                          {(copiedMsgId === msg.id || sharedMsgId === msg.id) && (
                            <span className="text-[11px] text-[var(--accent-text)] mr-1">
                              {copiedMsgId === msg.id ? 'Tersalin' : 'Siap dibagikan'}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleCopyAnswer(msg)}
                            title="Salin pertanyaan"
                            aria-label="Salin pertanyaan"
                            className="p-1.5 rounded-lg text-[var(--text-subtle)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
                          >
                            {copiedMsgId === msg.id ? (
                              <Check className="w-4 h-4 text-[var(--accent)]" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleShareUserMessage(msg, msgIndex)}
                            title="Bagikan pertanyaan & jawaban"
                            aria-label="Bagikan pertanyaan & jawaban"
                            className="p-1.5 rounded-lg text-[var(--text-subtle)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
                          >
                            {sharedMsgId === msg.id ? (
                              <Check className="w-4 h-4 text-[var(--accent)]" />
                            ) : (
                              <Share className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            type="button"
                            disabled={sending}
                            onClick={() => handleStartEditUserMessage(msg)}
                            title="Edit & kirim ulang pertanyaan"
                            aria-label="Edit & kirim ulang pertanyaan"
                            className="p-1.5 rounded-lg text-[var(--text-subtle)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-40 transition-colors cursor-pointer"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )
                  ) : (
                    <div className="w-full space-y-3.5">
                      {streamingMsgId !== msg.id && msg.hasConflict && (
                        <div className="flex items-start gap-2.5 p-3.5 bg-amber-50 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-800/60 rounded-xl text-xs text-amber-900 dark:text-amber-200">
                          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                          <span>
                            <strong>Terdeteksi Perbedaan Ketentuan SOP:</strong> Terdapat dua SOP yang memuat ketentuan berbeda. Mohon konfirmasi kepada Pemilik Proses sebelum eksekusi.
                          </span>
                        </div>
                      )}

                      {streamingMsgId === msg.id && !msg.content ? (
                        <div className="space-y-2.5 py-1">
                          <p className="text-xs font-medium text-[var(--text-muted)]">
                            {streamingStatusText || 'Menyusun jawaban AI...'}
                          </p>
                          <div className="h-3.5 bg-[var(--surface-2)] rounded-md w-3/4 animate-pulse" />
                          <div className="h-3.5 bg-[var(--surface-2)] rounded-md w-1/2 animate-pulse" />
                        </div>
                      ) : (() => {
                        const isFinished = streamingMsgId !== msg.id;
                        const visualAsset = isFinished ? visualAssetsByMsgId.get(msg.id) : undefined;
                        const override = perMessageOverride[msg.id];
                        const defaultShowImage =
                          answerFormat === 'text_and_image'
                            ? true
                            : answerFormat === 'auto'
                              ? Boolean(visualAsset?.autoShowVisual)
                              : false;
                        const showImage =
                          isFinished &&
                          Boolean(visualAsset) &&
                          (override?.showImage ?? defaultShowImage);

                        const hasPdfMatches = (visualAsset?.pdfVisuals.length || 0) > 0;
                        const showPdfSection = showImage && hasPdfMatches;
                        const showDiagramSection =
                          showImage &&
                          Boolean(visualAsset?.diagramUrl) &&
                          (override?.showDiagram ??
                            (answerFormat === 'text_and_image' ||
                              visualAsset?.preferredType === 'diagram'));

                        return (
                          <div className="space-y-4">
                            <div>
                              {renderFormattedAnswer(msg.content, {
                                msgKey: msg.id,
                                copiedCodeKey,
                                onCopyCode: (codeKey, codeText) => {
                                  void handleCopyCode(codeKey, codeText);
                                },
                              })}
                              {streamingMsgId === msg.id && (
                                <span className="inline-block w-2 h-4 ml-1 bg-[var(--accent)] align-middle animate-pulse rounded-sm" />
                              )}
                            </div>

                            {showImage && visualAsset && (
                              <div className="space-y-3 pt-1">
                                {showPdfSection && (
                                  <div className="border border-[var(--border)] rounded-xl p-3.5 bg-[var(--bg)]/60 dark:bg-[var(--surface)] space-y-2.5">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text)]">
                                        <FileText className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                                        <span>
                                          Contoh Gambar Menu SOP (
                                          {visualAsset.pdfVisuals.length === 1
                                            ? visualAsset.pdfVisuals[0].sourceKind === 'section'
                                              ? `Bagian ${visualAsset.pdfVisuals[0].sectionOrder || 1}`
                                              : `Hal. ${visualAsset.pdfVisuals[0].pageNumber}`
                                            : `${visualAsset.pdfVisuals.length} gambar`}
                                          )
                                        </span>
                                      </span>
                                    </div>
                                    <div
                                      className={`grid gap-3 ${
                                        visualAsset.pdfVisuals.length === 1
                                          ? 'grid-cols-1'
                                          : 'grid-cols-1 sm:grid-cols-2'
                                      }`}
                                    >
                                      {visualAsset.pdfVisuals.map((vp, vIdx) => {
                                        const badgeLocation =
                                          vp.sourceKind === 'section'
                                            ? `Bagian ${vp.sectionOrder || 1}`
                                            : `Hal. ${vp.pageNumber}`;
                                        const dlName =
                                          vp.sourceKind === 'section'
                                            ? `${vp.docNumber}-bagian-${vp.sectionOrder || 1}.jpg`
                                            : `${vp.docNumber}-hal-${vp.pageNumber}.jpg`;
                                        return (
                                        <div
                                          key={`${vp.attachmentName}-${vp.pageNumber}-${vIdx}`}
                                          className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden"
                                        >
                                          <div className="px-3 py-2 border-b border-[var(--border)] flex items-center justify-between gap-2 text-xs">
                                            <span className="font-mono font-semibold text-[var(--text)] truncate">
                                              {vp.docNumber} · {badgeLocation}
                                            </span>
                                            <div className="flex items-center gap-1.5 shrink-0">
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  setLightboxImage({
                                                    url: vp.dataUrl,
                                                    title: `${vp.docNumber} · ${vp.caption}`,
                                                    downloadName: dlName,
                                                  })
                                                }
                                                className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-[var(--text)] bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--accent)] rounded-md cursor-pointer"
                                              >
                                                <Maximize2 className="w-3 h-3" />
                                                <span>Perbesar</span>
                                              </button>
                                              <a
                                                href={vp.dataUrl}
                                                download={dlName}
                                                className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] rounded-md transition-colors"
                                              >
                                                <Download className="w-3 h-3" />
                                                <span>Unduh</span>
                                              </a>
                                            </div>
                                          </div>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setLightboxImage({
                                                url: vp.dataUrl,
                                                title: `${vp.docNumber} · ${vp.caption}`,
                                                downloadName: dlName,
                                              })
                                            }
                                            className="block w-full bg-[var(--bg)] cursor-zoom-in p-2"
                                          >
                                            <img
                                              src={vp.dataUrl}
                                              alt={vp.caption}
                                              className="w-full max-h-[420px] object-contain mx-auto bg-white rounded"
                                            />
                                          </button>
                                          {vp.caption && (
                                            <p className="px-3 py-1.5 border-t border-[var(--border)] text-[11px] text-[var(--text-muted)] truncate">
                                              {vp.caption}
                                            </p>
                                          )}
                                        </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}

                                {showImage &&
                                  !hasPdfMatches &&
                                  !visualAsset.aiSaidNoVisual &&
                                  visualAsset.preferredType === 'pdf_page' &&
                                  visualAsset.autoShowVisual && (
                                    <div className="p-3 bg-[var(--bg)]/60 dark:bg-[var(--surface)] border border-[var(--border)] rounded-xl text-xs text-[var(--text-muted)] flex flex-wrap items-center justify-between gap-2">
                                      <span>
                                        {visualAsset.hasLegacyPdfWithoutVisuals
                                          ? 'Gambar untuk bagian/menu ini belum tersedia di SOP. Admin dapat mengunggah foto modul melalui menu Edit SOP atau memperbarui lampiran PDF.'
                                          : 'Gambar atau tangkapan layar untuk bagian/menu ini belum tersedia pada dokumen SOP.'}
                                      </span>
                                      {!showDiagramSection && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setPerMessageOverride((prev) => ({
                                              ...prev,
                                              [msg.id]: {
                                                ...prev[msg.id],
                                                showImage: true,
                                                showDiagram: true,
                                              },
                                            }))
                                          }
                                          className="px-2.5 py-1 text-[11px] font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] rounded-md transition-colors cursor-pointer"
                                        >
                                          Buat Ringkasan Infografis
                                        </button>
                                      )}
                                    </div>
                                  )}

                                {showDiagramSection && !(chartSpecsByMsgId.get(msg.id)?.autoShowChart) && (
                                  <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--bg)]/60 dark:bg-[var(--surface)]">
                                    <div className="px-3.5 py-2 bg-[var(--surface)] border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-2 text-xs">
                                      <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--text)]">
                                        <ImageIcon className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                                        <span>Jawaban Visual (Infografis Alur)</span>
                                      </span>
                                      <div className="flex items-center gap-1.5">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setLightboxImage({
                                              url: visualAsset.diagramUrl,
                                              title: 'Jawaban Visual NARA AI',
                                              downloadName: `jawaban-sop-${msg.id.slice(-6)}.png`,
                                            })
                                          }
                                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-[var(--text)] bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--accent)] rounded-md cursor-pointer"
                                        >
                                          <Maximize2 className="w-3 h-3" />
                                          <span>Perbesar</span>
                                        </button>
                                        <a
                                          href={visualAsset.diagramUrl}
                                          download={`jawaban-sop-${msg.id.slice(-6)}.png`}
                                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] rounded-md transition-colors"
                                        >
                                          <Download className="w-3 h-3" />
                                          <span>Unduh PNG</span>
                                        </a>
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setLightboxImage({
                                          url: visualAsset.diagramUrl,
                                          title: 'Jawaban Visual NARA AI',
                                          downloadName: `jawaban-sop-${msg.id.slice(-6)}.png`,
                                        })
                                      }
                                      className="block w-full bg-[var(--bg)] cursor-zoom-in"
                                    >
                                      <img
                                        src={visualAsset.diagramUrl}
                                        alt="Sajian gambar jawaban prosedur SOP"
                                        className="w-full h-auto block"
                                      />
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Interactive Presentation Diagram Studio */}
                      {streamingMsgId !== msg.id && (() => {
                        const chartEntry = chartSpecsByMsgId.get(msg.id);
                        if (!chartEntry) return null;
                        const isChartVisible =
                          chartOpenByMsgId[msg.id] !== undefined
                            ? chartOpenByMsgId[msg.id]
                            : chartEntry.autoShowChart;
                        if (!isChartVisible) return null;

                        const alreadyPinned = pinnedCharts.some(
                          (pc) =>
                            pc.ownerUid === user.uid &&
                            pc.title.toLowerCase() === chartEntry.spec.title.toLowerCase() &&
                            pc.labels.length === chartEntry.spec.labels.length
                        );

                        return (
                          <div className="pt-2 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text)]">
                                <BarChart3 className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                                <span>Studio Diagram Presentasi (7 Pilihan Grafik)</span>
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setChartOpenByMsgId((prev) => ({
                                    ...prev,
                                    [msg.id]: false,
                                  }))
                                }
                                className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
                              >
                                <span>Sembunyikan</span>
                                <ChevronUp className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            <PresentationChartCard
                              mode="chat"
                              spec={chartEntry.spec}
                              sourceQuestion={chartEntry.userQuestion}
                              isAlreadyPinned={alreadyPinned}
                              appDark={appDark}
                              onPinToDashboard={onPinChart}
                              onOpenDashboard={onOpenDashboard}
                            />
                          </div>
                        );
                      })()}

                      {/* Quiet Unboxed SOP Citations (Zero-Pill) */}
                      {streamingMsgId !== msg.id && msg.citations && msg.citations.length > 0 && (
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--text-muted)] pt-0.5">
                          <span className="text-[var(--text-subtle)]">Sumber:</span>
                          {msg.citations.map((cit, cIdx) => (
                            <React.Fragment key={`${cit.sopId}-${cIdx}`}>
                              {cIdx > 0 && (
                                <span aria-hidden="true" className="text-[var(--text-subtle)]">
                                  ·
                                </span>
                              )}
                              {onOpenSopCitation ? (
                                <button
                                  type="button"
                                  onClick={() => onOpenSopCitation(cit.sopId, cit.sectionTitle)}
                                  className="underline decoration-dotted underline-offset-4 hover:text-[var(--text)] hover:decoration-solid transition-colors cursor-pointer"
                                >
                                  {cit.docNumber} v{cit.version}
                                  {cit.sectionTitle ? ` (${cit.sectionTitle})` : ''}
                                </button>
                              ) : (
                                <span>
                                  {cit.docNumber} v{cit.version}
                                  {cit.sectionTitle ? ` (${cit.sectionTitle})` : ''}
                                </span>
                              )}
                            </React.Fragment>
                          ))}
                        </div>
                      )}

                      {/* ChatGPT-Style Minimalist Icon Action Bar */}
                      {streamingMsgId !== msg.id && (() => {
                        const chartEntry = chartSpecsByMsgId.get(msg.id);
                        const isChartVisible = chartEntry
                          ? chartOpenByMsgId[msg.id] !== undefined
                            ? chartOpenByMsgId[msg.id]
                            : chartEntry.autoShowChart
                          : false;
                        const visualAsset = visualAssetsByMsgId.get(msg.id);
                        const hasAnyVisualOption = Boolean(
                          visualAsset &&
                            (visualAsset.pdfVisuals.length > 0 || visualAsset.diagramUrl)
                        );
                        const currentShowImage =
                          perMessageOverride[msg.id]?.showImage ??
                          (answerFormat === 'text_and_image'
                            ? true
                            : answerFormat === 'auto'
                              ? Boolean(visualAsset?.autoShowVisual)
                              : false);
                        const canRegenerate = messages
                          .slice(0, msgIndex)
                          .some((m) => m.role === 'user' && m.content.trim());
                        const isSpeaking = speakingMsgId === msg.id;
                        const isMoreOpen = openMsgMoreId === msg.id;
                        const speechSupported =
                          typeof window !== 'undefined' && 'speechSynthesis' in window;

                        return (
                          <div className="space-y-2.5 pt-0.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-0.5 -ml-1.5">
                                <button
                                  type="button"
                                  onClick={() => void handleCopyAnswer(msg)}
                                  title={copiedMsgId === msg.id ? 'Tersalin' : 'Salin jawaban'}
                                  aria-label="Salin jawaban"
                                  className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
                                >
                                  {copiedMsgId === msg.id ? (
                                    <Check className="w-[17px] h-[17px] text-[var(--accent)]" />
                                  ) : (
                                    <Copy className="w-[17px] h-[17px]" />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  disabled={savingFeedback || msg.id.startsWith('temp_')}
                                  onClick={() => void handleFeedback(msg, 'helpful', '')}
                                  title="Jawaban membantu"
                                  aria-label="Jawaban membantu"
                                  className={`p-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-40 ${
                                    msg.feedback === 'helpful'
                                      ? 'text-[var(--accent)] bg-[var(--accent-soft)]'
                                      : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
                                  }`}
                                >
                                  <ThumbsUp className="w-[17px] h-[17px]" />
                                </button>
                                <button
                                  type="button"
                                  disabled={savingFeedback || msg.id.startsWith('temp_')}
                                  onClick={() =>
                                    void handleFeedback(msg, 'inaccurate', msg.feedbackNote || '')
                                  }
                                  title="Jawaban kurang tepat / tidak akurat"
                                  aria-label="Jawaban tidak akurat"
                                  className={`p-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-40 ${
                                    msg.feedback === 'inaccurate'
                                      ? 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40'
                                      : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
                                  }`}
                                >
                                  <ThumbsDown className="w-[17px] h-[17px]" />
                                </button>
                                {canRegenerate && (
                                  <button
                                    type="button"
                                    disabled={sending}
                                    onClick={() => handleRegenerateAssistantMessage(msgIndex)}
                                    title="Buat ulang jawaban"
                                    aria-label="Buat ulang jawaban"
                                    className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-40 transition-colors cursor-pointer"
                                  >
                                    <RotateCcw className="w-[17px] h-[17px]" />
                                  </button>
                                )}
                                {speechSupported && (
                                  <button
                                    type="button"
                                    onClick={() => handleToggleSpeakAnswer(msg)}
                                    title={isSpeaking ? 'Hentikan pembacaan' : 'Bacakan jawaban'}
                                    aria-label={isSpeaking ? 'Hentikan pembacaan' : 'Bacakan jawaban'}
                                    className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                                      isSpeaking
                                        ? 'text-[var(--accent)] bg-[var(--accent-soft)]'
                                        : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
                                    }`}
                                  >
                                    {isSpeaking ? (
                                      <Square className="w-[15px] h-[15px] fill-current" />
                                    ) : (
                                      <Volume2 className="w-[17px] h-[17px]" />
                                    )}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => void handleShareAssistantMessage(msg, msgIndex)}
                                  title="Bagikan jawaban"
                                  aria-label="Bagikan jawaban"
                                  className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
                                >
                                  {sharedMsgId === msg.id ? (
                                    <Check className="w-[17px] h-[17px] text-[var(--accent)]" />
                                  ) : (
                                    <Share className="w-[17px] h-[17px]" />
                                  )}
                                </button>

                                {/* Overflow More Menu (...) */}
                                <div className="relative">
                                  <button
                                    type="button"
                                    data-msg-more-trigger="true"
                                    onClick={() =>
                                      setOpenMsgMoreId((curr) => (curr === msg.id ? null : msg.id))
                                    }
                                    title="Opsi lainnya"
                                    aria-label="Opsi lainnya"
                                    aria-haspopup="menu"
                                    aria-expanded={isMoreOpen}
                                    className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                                      isMoreOpen || msg.feedback === 'outdated'
                                        ? 'text-[var(--text)] bg-[var(--surface-2)]'
                                        : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
                                    }`}
                                  >
                                    <MoreHorizontal className="w-[17px] h-[17px]" />
                                  </button>

                                  {isMoreOpen && (
                                    <div
                                      data-msg-more-popover="true"
                                      role="menu"
                                      className="absolute left-0 bottom-full mb-1.5 z-40 w-52 rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--modal-shadow)] p-1.5 text-xs"
                                    >
                                      <button
                                        type="button"
                                        role="menuitem"
                                        disabled={savingFeedback || msg.id.startsWith('temp_')}
                                        onClick={() => {
                                          setOpenMsgMoreId(null);
                                          void handleFeedback(
                                            msg,
                                            'outdated',
                                            msg.feedbackNote || ''
                                          );
                                        }}
                                        className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-colors cursor-pointer disabled:opacity-40 ${
                                          msg.feedback === 'outdated'
                                            ? 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 font-medium'
                                            : 'text-[var(--text)] hover:bg-[var(--surface-2)]'
                                        }`}
                                      >
                                        <Clock className="w-3.5 h-3.5 shrink-0" />
                                        <span>Laporkan SOP Usang</span>
                                      </button>
                                      {chartEntry && (
                                        <button
                                          type="button"
                                          role="menuitem"
                                          onClick={() => {
                                            setOpenMsgMoreId(null);
                                            setChartOpenByMsgId((prev) => ({
                                              ...prev,
                                              [msg.id]: !isChartVisible,
                                            }));
                                          }}
                                          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
                                        >
                                          <BarChart3 className="w-3.5 h-3.5 shrink-0 text-[var(--text-muted)]" />
                                          <span>
                                            {isChartVisible
                                              ? 'Sembunyikan Diagram'
                                              : 'Sajikan Diagram'}
                                          </span>
                                        </button>
                                      )}
                                      {hasAnyVisualOption && (
                                        <button
                                          type="button"
                                          role="menuitem"
                                          onClick={() => {
                                            setOpenMsgMoreId(null);
                                            setPerMessageOverride((prev) => ({
                                              ...prev,
                                              [msg.id]: {
                                                ...prev[msg.id],
                                                showImage: !currentShowImage,
                                                showDiagram:
                                                  !currentShowImage &&
                                                  visualAsset?.pdfVisuals.length === 0
                                                    ? true
                                                    : prev[msg.id]?.showDiagram,
                                              },
                                            }));
                                          }}
                                          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
                                        >
                                          <ImageIcon className="w-3.5 h-3.5 shrink-0 text-[var(--text-muted)]" />
                                          <span>
                                            {currentShowImage
                                              ? 'Sembunyikan Visual SOP'
                                              : 'Tampilkan Visual SOP'}
                                          </span>
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>

                                {(copiedMsgId === msg.id || sharedMsgId === msg.id || isSpeaking) && (
                                  <span className="ml-1.5 text-[11px] text-[var(--accent-text)]">
                                    {copiedMsgId === msg.id
                                      ? 'Tersalin'
                                      : sharedMsgId === msg.id
                                        ? 'Siap dibagikan'
                                        : 'Membacakan...'}
                                  </span>
                                )}
                              </div>

                              {chartEntry && !isChartVisible && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setChartOpenByMsgId((prev) => ({
                                      ...prev,
                                      [msg.id]: true,
                                    }))
                                  }
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                                  title="Ubah data di jawaban ini menjadi diagram presentasi"
                                >
                                  <BarChart3 className="w-3.5 h-3.5" />
                                  <span>Sajikan Diagram</span>
                                </button>
                              )}
                            </div>

                            {noteEditorMsgId === msg.id ? (
                              <div className="space-y-2.5 bg-[var(--bg)] dark:bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-[11px] font-medium text-[var(--text-muted)]">
                                    Pilih alasan cepat atau tulis detail:
                                  </span>
                                  {[
                                    'Nominal/plafon sudah berubah',
                                    'Langkah di sistem berbeda',
                                    'PIC/approver perlu diperbarui',
                                    'Penjelasan kurang lengkap',
                                  ].map((reason) => (
                                    <button
                                      key={reason}
                                      type="button"
                                      onClick={() =>
                                        setNoteDraft((prev) =>
                                          prev.trim()
                                            ? prev.includes(reason)
                                              ? prev
                                              : `${prev.trim()}; ${reason}`
                                            : reason
                                        )
                                      }
                                      className="px-2.5 py-1 text-[11px] rounded-lg border border-[var(--border)] bg-[var(--surface)] dark:bg-[var(--surface-2)] text-[var(--text)] hover:border-[var(--accent)] transition-colors cursor-pointer"
                                    >
                                      + {reason}
                                    </button>
                                  ))}
                                </div>
                                <div className="flex flex-col sm:flex-row gap-2">
                                  <input
                                    type="text"
                                    autoFocus
                                    value={noteDraft}
                                    onChange={(e) => setNoteDraft(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        void handleSaveFeedbackNote(msg);
                                      }
                                    }}
                                    placeholder="Jelaskan bagian mana yang keliru atau sudah berubah agar admin bisa meninjau..."
                                    className="flex-1 px-3 py-1.5 text-xs bg-[var(--input-bg)] text-[var(--text)] placeholder:text-[var(--text-subtle)] border border-[var(--border-strong)] rounded-lg focus:outline-none focus:border-[var(--accent)]"
                                  />
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <button
                                      type="button"
                                      disabled={savingFeedback}
                                      onClick={() => void handleSaveFeedbackNote(msg)}
                                      className="px-3 py-1.5 text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] rounded-lg transition-colors cursor-pointer"
                                    >
                                      Simpan Catatan
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setNoteEditorMsgId(null)}
                                      className="px-2.5 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] rounded-lg cursor-pointer"
                                    >
                                      Tutup
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              (msg.feedback === 'inaccurate' || msg.feedback === 'outdated') && (
                                <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-muted)] bg-[var(--bg)] dark:bg-[var(--surface)] border border-[var(--border)] rounded-xl px-3 py-2">
                                  <span className="truncate">
                                    {msg.feedbackNote
                                      ? `Catatan Anda: ${msg.feedbackNote}`
                                      : msg.feedback === 'outdated'
                                        ? 'Ditandai sebagai SOP Usang. Tambahkan catatan detail jika diperlukan.'
                                        : 'Terima kasih atas masukan Anda. Tambahkan catatan detail jika diperlukan.'}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setNoteEditorMsgId(msg.id);
                                      setNoteDraft(msg.feedbackNote || '');
                                    }}
                                    className="text-[var(--accent-text)] hover:underline font-semibold shrink-0 cursor-pointer"
                                  >
                                    {msg.feedbackNote ? 'Ubah Catatan' : 'Tambah Catatan'}
                                  </button>
                                </div>
                              )
                            )}
                          </div>
                        );
                      })()}

                      {/* Contextual Interactive Follow-up Suggestions */}
                      {streamingMsgId !== msg.id &&
                        msgIndex === messages.length - 1 &&
                        (followUpPromptsByMsgId[msg.id]?.length || 0) > 0 && (
                          <div className="pt-1 space-y-2">
                            <p className="text-[11px] font-medium text-[var(--text-subtle)]">
                              Lanjutkan diskusi
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {followUpPromptsByMsgId[msg.id].map((promptText, pIdx) => (
                                <button
                                  key={`${msg.id}-fu-${pIdx}`}
                                  type="button"
                                  disabled={sending}
                                  onClick={() => void handleSend(promptText)}
                                  className="inline-flex items-center gap-1.5 text-left px-3.5 py-2 text-xs font-medium text-[var(--text)] bg-[var(--bg)]/70 dark:bg-[var(--surface)] hover:bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--accent)] rounded-2xl transition-colors disabled:opacity-40 cursor-pointer"
                                >
                                  <CornerDownRight className="w-3.5 h-3.5 shrink-0 text-[var(--text-subtle)]" />
                                  <span>{promptText}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                    </div>
                  )}
                </div>
              ))
            )}

            {errorMsg && (
              <div className="p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 rounded-xl text-xs text-rose-800 dark:text-rose-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
                  <div className="space-y-1 min-w-0">
                    <p className="leading-relaxed font-medium">{errorMsg}</p>
                    {lastFailedPrompt && (
                      <p className="text-[11px] text-rose-700/80 dark:text-rose-300/80 truncate">
                        Pertanyaan: &ldquo;{lastFailedPrompt}&rdquo;
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  {lastFailedPrompt && (
                    <button
                      type="button"
                      disabled={sending}
                      onClick={() => void handleSend(lastFailedPrompt)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 transition-colors cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Coba Kirim Ulang</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMsg(null);
                      setLastFailedPrompt(null);
                    }}
                    className="p-1 rounded-md text-rose-700 dark:text-rose-300 hover:bg-rose-200/60 dark:hover:bg-rose-900/50 transition-colors cursor-pointer"
                    aria-label="Tutup pesan error"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* ChatGPT-Style Floating Rounded Composer */}
        <div className="bg-[var(--surface)] dark:bg-[var(--bg)] px-4 sm:px-6 pt-2 pb-4 shrink-0">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSend();
            }}
            className="max-w-[760px] mx-auto"
          >
            <div className="flex items-end gap-2 px-4 py-2 bg-[var(--bg)]/70 dark:bg-[var(--surface)] border border-[var(--border-strong)] rounded-[26px] focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--focus-ring)] transition-colors">
              <textarea
                ref={chatInputRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder="Tanyakan apa saja tentang SOP, data ERP, atau aset..."
                aria-label="Kolom pertanyaan SOP, ERP, dan Aset"
                className="flex-1 py-1.5 text-[15px] leading-relaxed bg-transparent text-[var(--text)] placeholder:text-[var(--text-subtle)] focus:outline-none resize-none max-h-40"
              />
              <button
                type="submit"
                onMouseDown={(e) => e.preventDefault()}
                disabled={!input.trim() || sending}
                title="Kirim pertanyaan"
                aria-label="Kirim pertanyaan"
                className="w-9 h-9 mb-0.5 rounded-full inline-flex items-center justify-center bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] disabled:opacity-35 transition-colors shrink-0 cursor-pointer"
              >
                <ArrowUp className="w-4 h-4 stroke-[2.5]" />
              </button>
            </div>
          </form>
        </div>
      </section>

      {lightboxImage && (
        <div
          onClick={() => setLightboxImage(null)}
          className="fixed inset-0 z-50 bg-black/75 dark:bg-black/85 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[var(--surface)] rounded-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden border border-[var(--border)]"
          >
            <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between gap-3">
              <p className="text-xs font-semibold text-[var(--text)] truncate">
                {lightboxImage.title}
              </p>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href={lightboxImage.url}
                  download={lightboxImage.downloadName}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] rounded-lg transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Unduh Gambar</span>
                </a>
                <button
                  type="button"
                  onClick={() => setLightboxImage(null)}
                  className="p-1.5 text-[var(--text-muted)] hover:text-[var(--text)] rounded-lg hover:bg-[var(--surface-2)] cursor-pointer"
                  aria-label="Tutup gambar"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4 bg-[var(--bg)] flex items-center justify-center">
              <img
                src={lightboxImage.url}
                alt={lightboxImage.title}
                className="max-w-full max-h-[78vh] object-contain rounded bg-white"
              />
            </div>
          </div>
        </div>
      )}

      <DeleteConfirmModal
        open={Boolean(confirmDeleteSession)}
        title="Hapus Riwayat Percakapan?"
        description={
          confirmDeleteSession ? (
            <>
              Riwayat percakapan <strong>{confirmDeleteSession.title}</strong> beserta seluruh
              pesan tanya-jawab di dalamnya akan dihapus permanen.
            </>
          ) : null
        }
        details={
          confirmDeleteSession
            ? [{ label: 'Judul Percakapan', value: confirmDeleteSession.title }]
            : undefined
        }
        confirmLabel="Hapus Percakapan"
        loading={Boolean(confirmDeleteSession && deletingSessionId === confirmDeleteSession.id)}
        onCancel={() => setConfirmDeleteSession(null)}
        onConfirm={() => {
          if (confirmDeleteSession) {
            return handleDeleteSession(confirmDeleteSession.id);
          }
        }}
      />
    </div>
  );
};
