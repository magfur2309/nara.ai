import { createPartFromUri, createUserContent, FileState, GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  FOLLOW_UP_QUERY_REGEX,
  isDataChartVisualQuery,
  isDiagramRequest,
  isVisualRequest,
  NO_VISUAL_REPLY_REGEX,
  SOP_EXPLICIT_VISUAL_REGEX,
  type SopVisualCatalogEntry,
} from '../src/lib/visualIntent.ts';
import type {
  AiChartSpec,
  AiSopDraft,
  CitationSource,
  ConflictType,
  Division,
  PrePublishConflictItem,
  PrePublishConflictReport,
  SopChunk,
  SopConflictItem,
  SopDocument,
  SopFeedbackRevisionResult,
} from '../src/types/sop.ts';
import type { AssetMaintenanceAiContext } from './assetAiContext.ts';
import type { ErpStockAiContext } from './erpMysql.ts';

let cachedAiClient: GoogleGenAI | null = null;
let cachedAiApiKey: string | null = null;
let cachedBetaAiClient: GoogleGenAI | null = null;
let cachedBetaApiKey: string | null = null;

function normalizeApiKey(rawValue: string | undefined): string {
  const trimmed = (rawValue || '').trim();
  if (!trimmed) return '';
  const withoutPrefix = trimmed.replace(/^GEMINI_API_KEY\s*=\s*/i, '').trim();
  const unquoted = withoutPrefix.replace(/^["']+|["']+$/g, '').trim();
  if (!unquoted || unquoted === 'MY_GEMINI_API_KEY') return '';
  return unquoted;
}

function getRawApiKey(): string {
  const apiKey = normalizeApiKey(process.env.GEMINI_API_KEY);
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY belum dikonfigurasi atau masih berupa placeholder. Silakan periksa atau pilih API key yang valid di panel Settings > Secrets.'
    );
  }
  return apiKey;
}

function getAiClient(apiVersion?: 'v1beta'): GoogleGenAI {
  const apiKey = getRawApiKey();
  if (apiVersion === 'v1beta') {
    if (cachedBetaAiClient && cachedBetaApiKey === apiKey) {
      return cachedBetaAiClient;
    }
    cachedBetaApiKey = apiKey;
    cachedBetaAiClient = new GoogleGenAI({
      apiKey,
      apiVersion: 'v1beta',
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    return cachedBetaAiClient;
  }

  if (cachedAiClient && cachedAiApiKey === apiKey) {
    return cachedAiClient;
  }
  cachedAiApiKey = apiKey;
  cachedAiClient = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  return cachedAiClient;
}

export function isGeminiAuthError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err || '');
  const upper = raw.toUpperCase();
  const status =
    typeof err === 'object' && err !== null && 'status' in err
      ? Number((err as { status?: unknown }).status)
      : undefined;
  return (
    status === 401 ||
    status === 403 ||
    upper.includes('API_KEY_INVALID') ||
    upper.includes('API KEY NOT VALID') ||
    upper.includes('ACCESS_TOKEN_TYPE_UNSUPPORTED') ||
    upper.includes('UNAUTHENTICATED') ||
    upper.includes('PERMISSION_DENIED')
  );
}

export function isGeminiTransientError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err || '');
  const upper = raw.toUpperCase();
  const status =
    typeof err === 'object' && err !== null && 'status' in err
      ? Number((err as { status?: unknown }).status)
      : undefined;
  return (
    status === 408 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    upper.includes('503') ||
    upper.includes('UNAVAILABLE') ||
    upper.includes('HIGH DEMAND') ||
    upper.includes('OVERLOADED') ||
    upper.includes('DEADLINE_EXCEEDED') ||
    upper.includes('BAD GATEWAY') ||
    upper.includes('GATEWAY TIMEOUT') ||
    upper.includes('"CODE": 500') ||
    upper.includes('"CODE":500') ||
    upper.includes('"STATUS":"INTERNAL"') ||
    upper.includes('"STATUS": "INTERNAL"') ||
    upper.includes('ECONNRESET') ||
    upper.includes('ETIMEDOUT') ||
    upper.includes('FETCH FAILED')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unwrapNestedJsonErrorMessage(raw: string): string {
  let current = raw.trim();
  for (let depth = 0; depth < 3; depth++) {
    if (!current.startsWith('{') || !current.endsWith('}')) break;
    try {
      const parsed = JSON.parse(current) as {
        error?: { message?: unknown } | unknown;
        message?: unknown;
      };
      const nested =
        parsed && typeof parsed.error === 'object' && parsed.error !== null && 'message' in parsed.error
          ? (parsed.error as { message?: unknown }).message
          : parsed?.message;
      if (typeof nested === 'string' && nested.trim()) {
        current = nested.trim();
      } else {
        break;
      }
    } catch {
      break;
    }
  }
  return current;
}

export function formatGeminiErrorMessage(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : String(err || '');
  const unwrapped = unwrapNestedJsonErrorMessage(raw);
  const combinedUpper = `${raw} ${unwrapped}`.toUpperCase();

  if (isGeminiAuthError(err)) {
    return 'API key Gemini tidak valid atau tipe token tidak didukung oleh Gemini API. Silakan periksa atau pilih ulang GEMINI_API_KEY yang valid di panel Settings > Secrets.';
  }

  if (combinedUpper.includes('RESOURCE_EXHAUSTED') || combinedUpper.includes('429')) {
    return 'Kuota Gemini API sedang tercapai (429). Silakan coba lagi beberapa saat atau periksa API key berbayar di panel Settings > Secrets.';
  }

  if (
    combinedUpper.includes('503') ||
    combinedUpper.includes('UNAVAILABLE') ||
    combinedUpper.includes('HIGH DEMAND') ||
    combinedUpper.includes('OVERLOADED')
  ) {
    return 'Server AI Gemini sedang mengalami lonjakan trafik sementara (503). Sistem sudah mencoba ulang otomatis namun server AI masih padat. Silakan klik "Coba Kirim Ulang" beberapa detik lagi.';
  }

  if (isGeminiTransientError(err)) {
    return 'Koneksi ke server AI Gemini sedang mengalami gangguan sementara. Silakan klik "Coba Kirim Ulang" beberapa saat lagi.';
  }

  if (combinedUpper.includes('NOT_FOUND') && combinedUpper.includes('MODEL')) {
    return 'Model Gemini yang diminta tidak tersedia saat ini. Silakan coba lagi atau periksa konfigurasi API key di panel Settings > Secrets.';
  }

  return unwrapped || fallback;
}

function parseAiJson<T>(rawText: string | undefined, contextLabel: string): T {
  const cleaned = (rawText ?? '{}')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned || '{}') as T;
  } catch {
    throw new Error(`Respons AI untuk ${contextLabel} tidak berbentuk JSON yang valid. Silakan coba lagi.`);
  }
}

const INDONESIAN_STOPWORDS = new Set([
  'yang', 'dan', 'di', 'ke', 'dari', 'untuk', 'pada', 'dengan', 'adalah', 'atau',
  'ini', 'itu', 'jika', 'bila', 'kalau', 'apa', 'siapa', 'berapa', 'bagaimana',
  'cara', 'mengapa', 'kenapa', 'kapan', 'dimana', 'mana', 'saya', 'kami', 'kita',
  'anda', 'mereka', 'harus', 'bisa', 'dapat', 'boleh', 'tidak', 'ya', 'ada',
  'oleh', 'sebagai', 'tentang', 'dalam', 'terhadap', 'atas', 'agar', 'supaya',
]);

export function tokenizeIndonesian(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s\-]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !INDONESIAN_STOPWORDS.has(token));
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

const EMBEDDING_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_EMBEDDING_CACHE = 250;
const queryEmbeddingCache = new Map<string, { expiresAt: number; values: number[] }>();

// Cache when the active API key/token does not support BatchEmbedContents so we avoid repeated 401/403 calls
const EMBEDDING_UNSUPPORTED_TTL_MS = 5 * 60 * 1000;
let embeddingUnsupportedKey: string | null = null;
let embeddingUnsupportedUntil = 0;

function isEmbeddingAuthOrUnsupportedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '');
  const upper = msg.toUpperCase();
  const status = typeof err === 'object' && err !== null && 'status' in err
    ? Number((err as { status?: unknown }).status)
    : undefined;
  return (
    upper.includes('ACCESS_TOKEN_TYPE_UNSUPPORTED') ||
    upper.includes('BATCHEMBEDCONTENTS') ||
    upper.includes('EMBEDCONTENT') ||
    upper.includes('API_KEY_INVALID') ||
    upper.includes('API KEY NOT VALID') ||
    upper.includes('UNAUTHENTICATED') ||
    upper.includes('PERMISSION_DENIED') ||
    status === 401 ||
    status === 403 ||
    status === 404
  );
}

export async function embedText(text: string, useCache = false): Promise<number[]> {
  const cleanText = text.slice(0, 8000).trim();
  const cacheKey = useCache ? cleanText.toLowerCase() : '';
  if (useCache && cacheKey) {
    const cached = queryEmbeddingCache.get(cacheKey);
    if (cached && Date.now() <= cached.expiresAt) {
      return cached.values;
    }
    if (cached) queryEmbeddingCache.delete(cacheKey);
  }

  let result;
  try {
    const ai = getAiClient();
    result = await ai.models.embedContent({
      model: 'gemini-embedding-2',
      contents: cleanText,
    });
  } catch (primaryErr) {
    if (!isEmbeddingAuthOrUnsupportedError(primaryErr)) {
      throw primaryErr;
    }
    // Retry once against v1beta before surfacing the error
    const aiBeta = getAiClient('v1beta');
    result = await aiBeta.models.embedContent({
      model: 'gemini-embedding-2',
      contents: cleanText,
    });
  }

  const values = result.embeddings?.[0]?.values;
  if (!values || !Array.isArray(values)) {
    throw new Error('Gagal menghasilkan embedding vektor dari Gemini.');
  }

  if (useCache && cacheKey) {
    if (queryEmbeddingCache.size >= MAX_EMBEDDING_CACHE) {
      const oldestKey = queryEmbeddingCache.keys().next().value;
      if (oldestKey) queryEmbeddingCache.delete(oldestKey);
    }
    queryEmbeddingCache.set(cacheKey, {
      expiresAt: Date.now() + EMBEDDING_CACHE_TTL_MS,
      values,
    });
  }

  return values;
}

/**
 * Attempts to generate a Gemini vector embedding for hybrid RAG retrieval.
 * If the embedding endpoint rejects the runtime token type (e.g. ACCESS_TOKEN_TYPE_UNSUPPORTED
 * on BatchEmbedContents), returns undefined so RAG can still rank chunks lexically and call
 * the real Gemini generateContent/generateContentStream model.
 */
export async function tryEmbedText(
  text: string,
  useCache = false,
  timeoutMs = 0
): Promise<number[] | undefined> {
  const apiKey = normalizeApiKey(process.env.GEMINI_API_KEY);
  if (!apiKey) return undefined;

  if (embeddingUnsupportedKey === apiKey && Date.now() < embeddingUnsupportedUntil) {
    return undefined;
  }

  try {
    const embedPromise = embedText(text, useCache);
    const vector =
      timeoutMs > 0
        ? await Promise.race<number[] | undefined>([
            embedPromise,
            new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), timeoutMs)),
          ])
        : await embedPromise;
    if (!vector) {
      return undefined;
    }
    if (embeddingUnsupportedKey === apiKey) {
      embeddingUnsupportedKey = null;
      embeddingUnsupportedUntil = 0;
    }
    return vector;
  } catch (err) {
    if (isEmbeddingAuthOrUnsupportedError(err)) {
      embeddingUnsupportedKey = apiKey;
      embeddingUnsupportedUntil = Date.now() + EMBEDDING_UNSUPPORTED_TTL_MS;
      return undefined;
    }
    console.warn('Gemini embedding failed transiently; falling back to lexical RAG ranking:', err);
    return undefined;
  }
}

export interface LogicalChunkInput {
  id: string;
  sopId: string;
  docNumber: string;
  title: string;
  version: number;
  divisionId: string;
  divisionName: string;
  departmentName: string;
  sectionIndex: number;
  sectionTitle: string;
  content: string;
  keywords: string;
  status: 'Disetujui';
  accessLevel: SopDocument['accessLevel'];
  viewerUids: string[];
  ownerUid: string;
  ownerName: string;
}

export function buildLogicalChunks(sop: SopDocument): LogicalChunkInput[] {
  const chunks: LogicalChunkInput[] = [];
  const docNumber = (sop.docNumber || 'SOP').slice(0, 60);
  const title = (sop.title || 'SOP').slice(0, 240);
  const divisionName = (sop.divisionName || 'Umum').slice(0, 120);
  const departmentName = (sop.departmentName || 'Umum').slice(0, 120);
  const ownerUid = (sop.ownerUid || '').slice(0, 128);
  const ownerName = (sop.ownerName || '').slice(0, 120);
  const headerPrefix = `[${docNumber} v${sop.version}] ${title} (${divisionName} - ${departmentName})`;

  const overviewContent = [
    headerPrefix,
    `Tujuan: ${sop.purpose || '-'}`,
    `Ruang Lingkup: ${sop.scope || '-'}`,
    `Pemilik Proses: ${ownerName || 'Belum ditetapkan'}`,
    `Peran Terkait: ${sop.relatedRoles.length ? sop.relatedRoles.join(', ') : '-'}`,
    `Tanggal Berlaku: ${sop.effectiveDate || '-'} | Review Berikutnya: ${sop.nextReviewDate || '-'}`,
    sop.attachments.length
      ? `Formulir & Lampiran: ${sop.attachments.map((a) => a.name).join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  chunks.push({
    id: `${sop.id}_v${sop.version}_sec0`,
    sopId: sop.id,
    docNumber,
    title,
    version: sop.version,
    divisionId: sop.divisionId,
    divisionName,
    departmentName,
    sectionIndex: 0,
    sectionTitle: 'Ringkasan, Tujuan & Peran Terkait',
    content: overviewContent.slice(0, 11500),
    keywords: tokenizeIndonesian(overviewContent).join(' ').slice(0, 11500),
    status: 'Disetujui',
    accessLevel: sop.accessLevel,
    viewerUids: sop.viewerUids,
    ownerUid,
    ownerName,
  });

  sop.sections.forEach((sec, idx) => {
    const imgSummary =
      sec.images && sec.images.length > 0
        ? `\n[Foto/Gambar Modul Tersedia (${sec.images.length}): ${sec.images
            .map((im) => {
              const cap = im.caption || sec.title;
              const ocr = (im.ocrText || '').trim();
              return ocr ? `${cap} (teks layar: ${ocr})` : cap;
            })
            .join('; ')}]`
        : '\n[Status Foto Modul: Belum ada foto yang diunggah pada bagian ini]';
    const sectionText = `${headerPrefix}\nBagian ${idx + 1}: ${sec.title}\n${sec.content}${imgSummary}`;
    chunks.push({
      id: `${sop.id}_v${sop.version}_sec${idx + 1}`,
      sopId: sop.id,
      docNumber,
      title,
      version: sop.version,
      divisionId: sop.divisionId,
      divisionName,
      departmentName,
      sectionIndex: idx + 1,
      sectionTitle: (sec.title || `Langkah ${idx + 1}`).slice(0, 240),
      content: sectionText.slice(0, 11500),
      keywords: tokenizeIndonesian(sectionText).join(' ').slice(0, 11500),
      status: 'Disetujui',
      accessLevel: sop.accessLevel,
      viewerUids: sop.viewerUids,
      ownerUid,
      ownerName,
    });
  });

  const attachmentTexts = sop.attachments
    .filter((a) => a.extractedText && a.extractedText.trim().length > 0)
    .map((a) => `Lampiran "${a.name}" (${a.fileType}):\n${a.extractedText}`)
    .join('\n\n');

  if (attachmentTexts.trim().length > 0) {
    const fullAtt = `${headerPrefix}\nLampiran & Formulir Terkait:\n${attachmentTexts}`;
    chunks.push({
      id: `${sop.id}_v${sop.version}_att`,
      sopId: sop.id,
      docNumber,
      title,
      version: sop.version,
      divisionId: sop.divisionId,
      divisionName,
      departmentName,
      sectionIndex: sop.sections.length + 1,
      sectionTitle: 'Lampiran & Formulir',
      content: fullAtt.slice(0, 11500),
      keywords: tokenizeIndonesian(fullAtt).join(' ').slice(0, 11500),
      status: 'Disetujui',
      accessLevel: sop.accessLevel,
      viewerUids: sop.viewerUids,
      ownerUid,
      ownerName,
    });
  }

  return chunks;
}

export async function embedSopLogicalChunks(sop: SopDocument): Promise<Omit<SopChunk, 'createdAt'>[]> {
  const drafts = buildLogicalChunks(sop);
  if (drafts.length === 0) return [];

  // Probe the first chunk first so if BatchEmbedContents is unsupported for the active key,
  // we skip firing parallel failing embedding requests and still persist full lexical chunks.
  const firstVector = await tryEmbedText(drafts[0].content);
  if (!firstVector) {
    return drafts.map((draft) => ({
      ...draft,
      embedding: [],
    }));
  }

  const restEmbedded = await Promise.all(
    drafts.slice(1).map(async (draft) => {
      const vector = (await tryEmbedText(draft.content)) || [];
      return {
        ...draft,
        embedding: vector,
      };
    })
  );

  return [
    {
      ...drafts[0],
      embedding: firstVector,
    },
    ...restEmbedded,
  ];
}

export interface HybridScoredChunk {
  chunk: SopChunk;
  semanticScore: number;
  lexicalScore: number;
  hybridScore: number;
}

export function rankChunksHybrid(
  queryText: string,
  queryEmbedding: number[],
  chunks: SopChunk[],
  topK = 8
): HybridScoredChunk[] {
  const queryTokens = tokenizeIndonesian(queryText);
  const queryLower = queryText.toLowerCase();

  const scored: HybridScoredChunk[] = chunks.map((chunk) => {
    const chunkEmbedding = chunk.embedding || [];
    const hasVectorPair =
      queryEmbedding.length > 0 &&
      chunkEmbedding.length > 0 &&
      queryEmbedding.length === chunkEmbedding.length;
    const semanticScore = hasVectorPair ? cosineSimilarity(queryEmbedding, chunkEmbedding) : 0;

    const titleAndSection = `${chunk.docNumber} ${chunk.title} ${chunk.sectionTitle}`.toLowerCase();
    const haystack = `${titleAndSection} ${chunk.content}`.toLowerCase();

    let matchedTerms = 0;
    let titleMatches = 0;
    let totalHits = 0;
    for (const token of queryTokens) {
      if (haystack.includes(token)) {
        matchedTerms++;
        const matches = haystack.split(token).length - 1;
        totalHits += Math.min(matches, 4);
      }
      if (titleAndSection.includes(token)) {
        titleMatches++;
      }
    }

    const coverage = queryTokens.length > 0 ? matchedTerms / queryTokens.length : 0;
    const titleCoverage = queryTokens.length > 0 ? titleMatches / queryTokens.length : 0;
    const density = queryTokens.length > 0 ? Math.min(1, totalHits / (queryTokens.length * 2.5)) : 0;
    const docNumberBoost = chunk.docNumber && queryLower.includes(chunk.docNumber.toLowerCase()) ? 0.35 : 0;
    const lexicalScore = Math.min(
      1,
      coverage * 0.55 + titleCoverage * 0.2 + density * 0.25 + docNumberBoost
    );

    const hybridScore = hasVectorPair
      ? semanticScore * 0.65 + lexicalScore * 0.35
      : lexicalScore;
    return { chunk, semanticScore, lexicalScore, hybridScore };
  });

  scored.sort((a, b) => b.hybridScore - a.hybridScore);
  return scored.slice(0, topK);
}

export interface RagAnswerResponse {
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
}

function isConversationalOrGreetingQuery(raw: string): boolean {
  const q = raw.trim().toLowerCase().replace(/[!?.,]+$/g, '').trim();
  if (!q) return false;
  if (
    /^(halo|hallo|hello|hai|hi|hey|hei|p|ping|tes|test|selamat\s+(pagi|siang|sore|malam)|pagi|siang|sore|malam|assalamu['’]?alaikum|makasih|terima\s+kasih|thanks|thank\s+you|oke|ok|siap|mantap|bagus|baik|sip)$/i.test(
      q
    )
  ) {
    return true;
  }
  if (
    /\b(siapa\s+kamu|kamu\s+siapa|kamu\s+bisa\s+apa|apa\s+yang\s+bisa\s+kamu|bisakah\s+kamu|apakah\s+kamu\s+bisa|bisa\s+bantu\s+apa|fitur\s+(kamu|aplikasi|ai)|cara\s+(pakai|menggunakan|bertanya)|metode\s+apa|baca\s+data|bisa\s+baca\s+(data|excel|pdf|database|mysql|erp))\b/i.test(
      q
    ) &&
    !/\b(sop[-\s]?\w+|m1_|m2_|m5_|m7_|faktur|piutang|hutang|laba\s+rugi|omzet|stok\s+\w+|aset\s+\w+)\b/i.test(
      q
    )
  ) {
    return true;
  }
  return false;
}

export function buildRetrievalQuery(
  question: string,
  history: { role: 'user' | 'assistant'; content: string }[]
): string {
  const lastUserMessages = history
    .filter((m) => m.role === 'user')
    .slice(-2)
    .map((m) => m.content);
  const wordCount = question.trim().split(/\s+/).length;
  return lastUserMessages.length > 0 && (wordCount <= 12 || FOLLOW_UP_QUERY_REGEX.test(question))
    ? `${lastUserMessages.join(' ')} ${question}`
    : question;
}

function buildEmptyChunksResponse(divisions: Division[]): RagAnswerResponse {
  const fallbackDiv = divisions[0];
  const contactText = fallbackDiv
    ? `Divisi ${fallbackDiv.name}`
    : 'Admin Divisi terkait';
  return {
    answered: false,
    answerMarkdown: `Saya tidak menemukan ini di SOP yang ada.\n\nSaat ini belum ada dokumen SOP berstatus **Disetujui** yang dapat diakses sesuai hak akses akun Anda untuk menjawab pertanyaan ini. Anda dapat menghubungi **${contactText}** untuk konfirmasi prosedur resmi.`,
    hasConflict: false,
    conflictSummary: '',
    suggestedContact: contactText,
    citations: [],
    matchedSopIds: [],
    showVisual: false,
    visualPageNumbers: [],
  };
}

function formatVisualCatalogContext(
  topScored: HybridScoredChunk[],
  visualCatalog?: SopVisualCatalogEntry[]
): string {
  if (!visualCatalog || visualCatalog.length === 0) return '';
  const relevantSopIds = new Set(topScored.map((s) => s.chunk.sopId));
  const matchedEntries = visualCatalog.filter((entry) => relevantSopIds.has(entry.sopId));
  if (matchedEntries.length === 0) return '';

  const lines = matchedEntries.map((entry) => {
    const parts = [`- ${entry.docNumber} (${entry.title}):`];
    if (entry.sectionsWithImages.length > 0) {
      parts.push(
        `  * Bagian yang MEMILIKI Foto Modul (${entry.sectionsWithImages.length}):`
      );
      for (const s of entry.sectionsWithImages) {
        const ocrHint = s.ocrKeywords?.length ? ` | teks layar: ${s.ocrKeywords.join(', ')}` : '';
        parts.push(
          `    - Bagian ${s.order}: ${s.title}${s.captions.length ? ` [foto: ${s.captions.join(', ')}${ocrHint}]` : ''}`
        );
      }
    } else {
      parts.push('  * Bagian yang MEMILIKI Foto Modul: Belum ada');
    }
    if (entry.sectionsWithoutImages.length > 0) {
      parts.push(
        `  * Bagian yang BELUM memiliki Foto Modul: ${entry.sectionsWithoutImages
          .map((s) => `Bagian ${s.order} (${s.title})`)
          .join('; ')}`
      );
    }
    if (entry.pdfFigures.length > 0) {
      parts.push(
        `  * Gambar Halaman PDF Tersimpan: ${entry.pdfFigures
          .map((p) => `Hal. ${p.pageNumber} (${p.caption})`)
          .join('; ')}`
      );
    } else {
      parts.push('  * Gambar Halaman PDF Tersimpan: Belum ada');
    }
    return parts.join('\n');
  });

  return `INVENTARIS GAMBAR/FOTO ASLI YANG BENAR-BENAR TERSEDIA DI SOP SAAT INI:\n${lines.join('\n')}\n`;
}

function prepareRagContext(params: {
  question: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  accessibleChunks: SopChunk[];
  divisions: Division[];
  queryEmbedding: number[];
  retrievalQuery: string;
  visualCatalog?: SopVisualCatalogEntry[];
  assetMaintenanceContext?: AssetMaintenanceAiContext;
  erpStockContext?: ErpStockAiContext;
  accessControlContext?: AiAccessControlContext;
}): {
  topScored: HybridScoredChunk[];
  prompt: string;
  divisionDirectory: string;
} {
  const {
    question,
    history,
    accessibleChunks,
    divisions,
    queryEmbedding,
    retrievalQuery,
    visualCatalog,
    assetMaintenanceContext,
    erpStockContext,
    accessControlContext,
  } = params;
  const explicitlyMentionsSopOrPolicy =
    /\b(sop|prosedur|kebijakan|aturan|langkah|alur|instruksi|formulir|form|syarat|ketentuan|dokumen|manual|panduan|pic|penanggung\s*jawab|otorisasi|approval|persetujuan|tender|pembanding)\b/i.test(
      question
    );
  const isPureErpDataFocus = Boolean(erpStockContext?.connected) && !explicitlyMentionsSopOrPolicy;

  const rawTop =
    accessibleChunks.length > 0
      ? rankChunksHybrid(retrievalQuery, queryEmbedding, accessibleChunks, isPureErpDataFocus ? 3 : 6)
      : [];

  // For pure ERP data queries, keep only high-confidence SOP matches to minimize prompt tokens & speed up TTFT
  let topScored: HybridScoredChunk[];
  if (isPureErpDataFocus) {
    topScored = rawTop.filter((s) => s.hybridScore >= 0.36).slice(0, 2);
  } else {
    topScored = rawTop.slice(0, 5);
    if (rawTop[5]) {
      const seenSops = new Set(topScored.map((s) => s.chunk.sopId));
      if (!seenSops.has(rawTop[5].chunk.sopId) && rawTop[5].hybridScore >= 0.42) {
        topScored.push(rawTop[5]);
      }
    }
  }

  const maxChunkChars = isPureErpDataFocus ? 1400 : 2800;
  const contextBlocks = topScored.map((item, i) => {
    const c = item.chunk;
    return [
      `--- KUTIPAN #${i + 1} ---`,
      `SOP ID: ${c.sopId} | Nomor: ${c.docNumber} | Judul: ${c.title} | Versi: v${c.version}`,
      `Divisi: ${c.divisionName} (${c.departmentName}) | Bagian: ${c.sectionTitle} | Relevansi: ${item.hybridScore.toFixed(3)}`,
      `Isi:\n${c.content.slice(0, maxChunkChars)}`,
    ].join('\n');
  });

  const divisionDirectory = divisions
    .map((d) => `- Divisi ${d.name} (${d.code})`)
    .join('\n');

  const historyText = history
    .slice(-4)
    .map((m) => `${m.role === 'user' ? 'Karyawan' : 'SOP Brain'}: ${m.content.slice(0, 600)}`)
    .join('\n\n');

  const needsVisualInventory =
    !isPureErpDataFocus || isVisualRequest(question) || isDiagramRequest(question);
  const visualInventoryText = needsVisualInventory
    ? formatVisualCatalogContext(topScored, visualCatalog)
    : '';
  const assetContextBlock = assetMaintenanceContext
    ? `DATA INVENTARIS ASET & JADWAL MAINTENANCE RESMI PERUSAHAAN (LIVE DARI DATABASE SISTEM):\n${assetMaintenanceContext.summaryText}\n`
    : '';
  const erpStockBlock =
    erpStockContext && erpStockContext.summaryText
      ? `DATA LIVE ERP PERUSAHAAN (KONEKSI LANGSUNG MYSQL ERP READ-ONLY):\n${erpStockContext.summaryText}\n`
      : '';

  const accessControlBlock = accessControlContext
    ? [
        `STATUS HAK AKSES PENGGUNA SAAT INI (DIVERIFIKASI SERVER):`,
        `- Role aktif: ${accessControlContext.roleName} (${accessControlContext.roleCode})`,
        `- Modul/data yang diizinkan: ${
          accessControlContext.allowedScopeLabels.length > 0
            ? accessControlContext.allowedScopeLabels.join(', ')
            : 'Hanya informasi umum / SOP non-sensitif'
        }`,
        accessControlContext.deniedDomains.length > 0
          ? `- AKSES DITOLAK SERVER UNTUK PERTANYAAN INI (DATA TIDAK DIAMBIL & TIDAK DIKIRIM KE AI): ${accessControlContext.deniedDomains.join(', ')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n') + '\n'
    : '';

  const prompt = [
    accessControlBlock,
    historyText ? `RIWAYAT PERCAKAPAN SEBELUMNYA:\n${historyText}\n` : '',
    `PERTANYAAN KARYAWAN SAAT INI:\n${question}\n`,
    assetContextBlock,
    erpStockBlock,
    visualInventoryText,
    !isPureErpDataFocus ? `DAFTAR DIVISI PERUSAHAAN:\n${divisionDirectory || '(Belum ada divisi)'}\n` : '',
    contextBlocks.length > 0
      ? `KUTIPAN SOP BERSTATUS DISETUJUI YANG BOLEH DIAKSES PENANYA:\n${contextBlocks.join('\n\n')}`
      : !isPureErpDataFocus
        ? 'KUTIPAN SOP BERSTATUS DISETUJUI YANG BOLEH DIAKSES PENANYA:\n(Belum ada kutipan SOP yang relevan)'
        : '',
  ]
    .filter(Boolean)
    .join('\n');

  return { topScored, prompt, divisionDirectory };
}

function finalizeRagResponse(
  parsed: {
    answered?: boolean;
    isConversational?: boolean;
    usedAssetData?: boolean;
    usedErpData?: boolean;
    answerMarkdown?: string;
    hasConflict?: boolean;
    conflictSummary?: string;
    suggestedContact?: string;
    citedSources?: Partial<CitationSource>[];
    showVisual?: boolean;
    visualType?: string;
    visualPageNumbers?: unknown[];
    chartSpec?: Partial<AiChartSpec> | null;
    followUpPrompts?: unknown[];
  },
  topScored: HybridScoredChunk[],
  question?: string,
  hasAssetContext = false,
  hasErpStockContext = false
): RagAnswerResponse {
  const allowedChunkMap = new Map(topScored.map((s) => [s.chunk.sopId, s.chunk]));
  const docNumberMap = new Map(
    topScored.map((s) => [s.chunk.docNumber.toLowerCase(), s.chunk])
  );
  const verifiedCitations: CitationSource[] = [];
  const seenKeys = new Set<string>();

  for (const src of parsed.citedSources || []) {
    const matched =
      (src.sopId && allowedChunkMap.get(src.sopId)) ||
      (src.docNumber && docNumberMap.get(src.docNumber.toLowerCase()));
    if (matched) {
      const sectionTitle = src.sectionTitle || matched.sectionTitle;
      const key = `${matched.sopId}::${sectionTitle}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        verifiedCitations.push({
          sopId: matched.sopId,
          docNumber: matched.docNumber,
          title: matched.title,
          version: matched.version,
          sectionTitle,
          divisionName: matched.divisionName,
        });
      }
    }
  }

  // Fallback citation matching if answered=true but citedSources omitted (skip for pure greeting/conversational replies)
  const answerText = (parsed.answerMarkdown || '').trim();
  const answerLower = answerText.toLowerCase();
  const isNotFoundReply = answerLower.startsWith('saya tidak menemukan ini di sop yang ada');
  const isConversationalReply =
    !isNotFoundReply &&
    Boolean(answerText) &&
    (Boolean(parsed.isConversational) || isConversationalOrGreetingQuery(question || ''));

  const explicitlyMentionsSopOrPolicy =
    /\b(sop|prosedur|kebijakan|aturan|langkah|alur|instruksi|formulir|form|syarat|ketentuan|dokumen|manual|panduan|pic|penanggung\s*jawab|otorisasi|approval|persetujuan|tender|pembanding)\b/i.test(
      question || ''
    );

  if (
    parsed.answered &&
    !isNotFoundReply &&
    !isConversationalReply &&
    !(hasErpStockContext && !explicitlyMentionsSopOrPolicy) &&
    verifiedCitations.length === 0 &&
    answerText
  ) {
    for (const item of topScored) {
      const hasDocMatch =
        item.chunk.docNumber && answerLower.includes(item.chunk.docNumber.toLowerCase());
      const hasTitleMatch =
        item.chunk.title &&
        item.chunk.title.length > 6 &&
        answerLower.includes(item.chunk.title.toLowerCase());
      const hasSectionMatch =
        item.chunk.sectionTitle &&
        item.chunk.sectionTitle.length > 6 &&
        answerLower.includes(item.chunk.sectionTitle.toLowerCase());
      if (hasDocMatch || hasTitleMatch || hasSectionMatch) {
        const key = `${item.chunk.sopId}::${item.chunk.sectionTitle}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          verifiedCitations.push({
            sopId: item.chunk.sopId,
            docNumber: item.chunk.docNumber,
            title: item.chunk.title,
            version: item.chunk.version,
            sectionTitle: item.chunk.sectionTitle,
            divisionName: item.chunk.divisionName,
          });
        }
      }
    }
    if (verifiedCitations.length === 0 && topScored[0] && topScored[0].hybridScore >= 0.28) {
      const topChunk = topScored[0].chunk;
      verifiedCitations.push({
        sopId: topChunk.sopId,
        docNumber: topChunk.docNumber,
        title: topChunk.title,
        version: topChunk.version,
        sectionTitle: topChunk.sectionTitle,
        divisionName: topChunk.divisionName,
      });
    }
  }

  const answeredFromAssets =
    hasAssetContext && !isNotFoundReply && Boolean(answerText) && (Boolean(parsed.usedAssetData) || Boolean(parsed.answered));
  const answeredFromErp =
    hasErpStockContext && !isNotFoundReply && Boolean(answerText) && (Boolean(parsed.usedErpData) || Boolean(parsed.answered));
  const answered =
    (Boolean(parsed.answered) && verifiedCitations.length > 0) ||
    answeredFromAssets ||
    answeredFromErp ||
    isConversationalReply;
  const fallbackOwner = topScored[0]?.chunk
    ? `Divisi ${topScored[0].chunk.divisionName}`
    : 'Admin Divisi terkait';

  const isDataChartQuery = isDataChartVisualQuery(question || '');
  const explicitlyAskedSopVisual = SOP_EXPLICIT_VISUAL_REGEX.test(question || '');
  const isPureDataResponse =
    (answeredFromErp || answeredFromAssets) &&
    verifiedCitations.length === 0 &&
    !explicitlyAskedSopVisual;

  const isNoVisualMessage = NO_VISUAL_REPLY_REGEX.test(answerText);
  const asksForDiagram = !isPureDataResponse && !isDataChartQuery && isDiagramRequest(question || '');
  const asksForVisual =
    !isNoVisualMessage &&
    !isDataChartQuery &&
    !isPureDataResponse &&
    (parsed.showVisual === true ||
      asksForDiagram ||
      (parsed.showVisual === undefined && isVisualRequest(question || '')));

  const rawPages = asksForVisual && Array.isArray(parsed.visualPageNumbers)
    ? parsed.visualPageNumbers
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n > 0)
    : [];

  // Fallback: extract explicit page numbers mentioned in answerText if visualPageNumbers was empty
  const extractedPages: number[] = [];
  if (rawPages.length === 0 && asksForVisual && answerText) {
    for (const match of answerText.matchAll(/(?:halaman|hal\.?)\s*(\d+)/gi)) {
      const p = Number(match[1]);
      if (Number.isInteger(p) && p > 0 && !extractedPages.includes(p)) {
        extractedPages.push(p);
      }
    }
  }

  const visualPageNumbers = asksForVisual
    ? (rawPages.length > 0 ? rawPages : extractedPages).slice(0, 3)
    : [];
  const visualType: 'pdf_page' | 'diagram' =
    parsed.visualType === 'diagram' || asksForDiagram ? 'diagram' : 'pdf_page';

  const validChartTypes = new Set([
    'bar',
    'horizontal_bar',
    'line',
    'area',
    'donut',
    'pie',
    'stacked_bar',
  ]);
  let sanitizedChartSpec: AiChartSpec | null = null;
  if (
    parsed.chartSpec &&
    Array.isArray(parsed.chartSpec.labels) &&
    parsed.chartSpec.labels.length >= 2 &&
    Array.isArray(parsed.chartSpec.series) &&
    parsed.chartSpec.series.length >= 1
  ) {
    const cleanLabels = parsed.chartSpec.labels
      .map((l) => String(l ?? '').trim().slice(0, 120))
      .filter(Boolean)
      .slice(0, 50);
    const cleanSeries = parsed.chartSpec.series
      .slice(0, 8)
      .filter((s) => s && typeof s.name === 'string' && Array.isArray(s.values))
      .map((s) => ({
        name: s.name.trim().slice(0, 80) || 'Nilai',
        values: cleanLabels.map((_, idx) => {
          const n = Number(s.values[idx]);
          return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
        }),
      }))
      .filter((s) => s.values.some((v) => v !== 0));

    if (cleanLabels.length >= 2 && cleanSeries.length >= 1) {
      const recType =
        typeof parsed.chartSpec.recommendedType === 'string' &&
        validChartTypes.has(parsed.chartSpec.recommendedType)
          ? (parsed.chartSpec.recommendedType as AiChartSpec['recommendedType'])
          : 'bar';
      const valFmt =
        parsed.chartSpec.valueFormat === 'currency' ||
        parsed.chartSpec.valueFormat === 'percent' ||
        parsed.chartSpec.valueFormat === 'number'
          ? parsed.chartSpec.valueFormat
          : 'number';
      sanitizedChartSpec = {
        title: String(parsed.chartSpec.title || 'Analisis Data Presentasi').trim().slice(0, 140),
        subtitle: String(parsed.chartSpec.subtitle || '').trim().slice(0, 220),
        recommendedType: recType,
        valueFormat: valFmt,
        unitLabel: String(
          parsed.chartSpec.unitLabel || (valFmt === 'currency' ? 'Rp' : valFmt === 'percent' ? '%' : '')
        ).slice(0, 30),
        categoryLabel: String(parsed.chartSpec.categoryLabel || 'Kategori').trim().slice(0, 60),
        labels: cleanLabels,
        series: cleanSeries,
        insightSummary: parsed.chartSpec.insightSummary
          ? String(parsed.chartSpec.insightSummary).trim().slice(0, 280)
          : undefined,
        sourceLabel: answeredFromErp
          ? 'ERP Live MySQL'
          : answeredFromAssets
            ? 'Aset & Maintenance'
            : 'SOP Brain',
      };
    }
  }

  const followUpPrompts: string[] = [];
  if (Array.isArray(parsed.followUpPrompts)) {
    const seenFollow = new Set<string>();
    for (const rawItem of parsed.followUpPrompts) {
      const text = String(rawItem ?? '').trim().replace(/^[-•*\d.)\s]+/, '').trim();
      if (text.length < 8 || text.length > 110) continue;
      const key = text.toLowerCase();
      if (seenFollow.has(key)) continue;
      seenFollow.add(key);
      followUpPrompts.push(text);
      if (followUpPrompts.length >= 3) break;
    }
  }

  return {
    answered,
    answerMarkdown:
      answerText ||
      (answered ? '' : `Saya tidak menemukan ini di SOP yang ada.\n\nSilakan hubungi **${fallbackOwner}** untuk informasi lebih lanjut.`),
    hasConflict: Boolean(parsed.hasConflict),
    conflictSummary: parsed.conflictSummary || '',
    suggestedContact: parsed.suggestedContact || fallbackOwner,
    citations: answered && !isConversationalReply ? verifiedCitations : [],
    matchedSopIds: isConversationalReply ? [] : Array.from(new Set(verifiedCitations.map((c) => c.sopId))),
    showVisual: answered && asksForVisual,
    visualType,
    visualPageNumbers,
    chartSpec: answered ? sanitizedChartSpec : null,
    followUpPrompts,
  };
}

const RAG_BASE_SYSTEM_RULES = `Kamu adalah "SOP Brain", asisten AI resmi perusahaan yang hangat, cerdas, dan interaktif dalam Bahasa Indonesia untuk membantu tanya-jawab SOP perusahaan, data live ERP MySQL (Stok Gudang, Purchasing/Pembelian & Hutang Supplier, Penjualan & Piutang, Keuangan/Laba Rugi & Neraca, Aset Tetap & Penyusutan), serta Manajemen Aset & Jadwal Maintenance.

GAYA KOMUNIKASI CONVERSATIONAL AI (INTERAKTIF & NATURAL):
- Terapkan pendekatan **Conversational AI** yang natural seperti rekan kerja ahli yang komunikatif:
  1. **Sapaan & Pertanyaan Umum Tentang Kemampuan Asisten** (mis. "halo", "pagi", "bisakah kamu baca data?", "kamu bisa bantu apa?", "terima kasih"):
     * Balas dengan ramah, hangat, ringkas, dan natural dalam Bahasa Indonesia. JANGAN pernah menjawab sapaan atau pertanyaan kapabilitas dengan kalimat kaku "Saya tidak menemukan ini di SOP yang ada."
     * Jika ditanya kemampuan baca data/sistem, jelaskan secara rapi & singkat apa yang bisa dibantu di aplikasi ini (SOP & prosedur kerja, data live ERP MySQL: Stok Gudang, Purchasing/Pembelian & Hutang Supplier, Sales & Piutang, Keuangan/Laba Rugi & Neraca, Aset Tetap & Penyusutan, Jadwal Maintenance, hingga penyajian diagram untuk presentasi jika diminta) lalu undang pengguna menyebutkan data atau topik yang ingin diperiksa.
     * Set "isConversational": true, "answered": true, "citedSources": [], "showVisual": false, "chartSpec": null.
  2. **Active Listening & Contextual Understanding**:
     * Pahami maksud utama pengguna dan sambungkan konteksnya dengan RIWAYAT PERCAKAPAN SEBELUMNYA sehingga diskusi terasa mengalir dan berkelanjutan.
  3. **Gaya Tulisan Ringkas, Jelas & Terstruktur (Konsep ChatGPT)**:
     * **Kalimat Pembuka Langsung ke Inti**: Awali jawaban dengan 1 kalimat pengantar singkat yang langsung menjawab inti pertanyaan pengguna (hindari basa-basi berulang atau paragraf pembuka yang panjang).
     * **Daftar Poin & Tabel yang Mudah Dipindai**: Pecah rincian menjadi daftar poin (\`- ...\`) atau langkah bernomor (\`1. ...\`) yang singkat, padat, dan tiap poin fokus pada 1 gagasan. Gunakan tabel Markdown hanya bila memang membandingkan beberapa baris data atau angka.
     * **Penekanan Visual yang Rapi**: Gunakan **cetak tebal** secara selektif pada angka penting, nama entitas, atau istilah kunci; gunakan \`inline code\` untuk kode dokumen, nomor transaksi, status sistem, nama akun/COA, atau alamat/domain teknis.
     * **Insight & Penutup Natural**: Untuk jawaban data atau prosedur penting, tutup dengan 1 kalimat ringkas kesimpulan (*"Jadi, ..."* / sorotan utama) dan, bila relevan, 1 kalimat tawaran lanjutan yang spesifik dan singkat. Jangan mengulang isi tabel kata per kata, dan jangan membanjiri informasi dari bagian/modul lain yang belum ditanyakan (*Progressive Disclosure*).
     * **Saran Lanjutan Cepat ("followUpPrompts")**: Isi array "followUpPrompts" di metadata dengan 2–3 pertanyaan lanjutan singkat (maks. 75 karakter) yang paling relevan agar pengguna bisa melanjutkannya dalam 1 klik.
     * **Konsistensi Logika Transaksi ERP Outstanding**: Pahami arti **Outstanding** pada alur transaksi ERP (\`PR → PO → GRN → RI/PI → VP\` dan \`SO → DO → SI\`):
       - Dokumen berstatus **Approved** yang outstanding berarti **BELUM dijalankan ke transaksi berikutnya sama sekali** (PR Outstanding \`Approved\` = **belum ada PO**; PO Outstanding \`Approved\` = **belum ada GRN/RI**; GRN \`Belum RI\` = **belum ada RI/PI**; SO Outstanding \`Approved\` = **belum ada DO**).
       - Dokumen berstatus **In Progress** yang outstanding berarti baru diproses **sebagian** ke transaksi berikutnya (masih ada sisa qty/item yang belum selesai).
       - DILARANG menulis saran lanjutan ("followUpPrompts") maupun pertanyaan penutup yang menanyakan status transaksi berikutnya yang memang belum ada (contoh: JANGAN sarankan *"Cek status PO untuk PR ini"* saat membahas PR Outstanding berstatus \`Approved\`, atau *"Cek status GRN untuk PO ini"* saat membahas PO Outstanding berstatus \`Approved\`). Berikan saran yang logis sesuai tahapnya, misalnya *"Cek prosedur SOP pembuatan PO dari PR"*, *"Cek PR outstanding berdasarkan gudang/nilai"*, atau *"Lihat daftar PO outstanding yang menunggu GRN"*.
     * **Logika Penyajian Daftar Data ERP (Default Bulan Berjalan, Batas Baris & Filter Bulan Spesifik — WAJIB DIPATUHI)**:
       - **DEFAULT PERIODE = BULAN BERJALAN**: Ketika pengguna menanyakan data transaksi operasional ERP (PO, PR, GRN, Faktur/RI, SO, DO, SI, Retur, Pembelian, Penjualan, Laba Rugi) **tanpa menyebut bulan tertentu** (misalnya *"cek daftar PO outstanding"*, *"cek PR belum diproses"*, *"daftar SO terbaru"*, *"cek omzet penjualan"*), sistem secara otomatis memfilter data ke **bulan berjalan** sesuai \`FOKUS PERIODE PERCAKAPAN\` di konteks ERP (misal saat diakses di November 2026 maka HANYA transaksi November 2026 yang ditampilkan).
       - **Transparansi Periode & Batas Baris**:
         1. **WAJIB sebutkan secara jelas** di kalimat pembuka dan/atau catatan bawah tabel bahwa data yang ditampilkan adalah transaksi **bulan berjalan** (sebutkan nama bulan & tahun persis sesuai konteks ERP, misal **November 2026**).
         2. Jika jumlah dokumen pada bulan tersebut ≤ 60 baris, tampilkan sesuai daftar di konteks (antarmuka tabel chat otomatis membagi menjadi beberapa halaman 10/25/30 baris agar pengguna bisa mengklik halaman sendiri). Jika jumlah dokumen pada periode tersebut sangat banyak (> 30–60 baris), sajikan **25–30 baris paling baru** (atau maksimal 50–60 baris untuk permintaan satu bulan spesifik) dan **WAJIB cantumkan keterangan jumlah yang ditampilkan vs total dokumen** pada periode tersebut beserta rentang tanggal sampelnya.
         3. **WAJIB infokan secara singkat** bahwa jika pengguna ingin melihat data untuk **bulan sebelumnya / bulan tertentu lainnya** atau **semua bulan (kumulatif sejak Maret 2026)** maupun filter **supplier/customer tertentu**, pengguna cukup menyebutkan bulannya.
       - Saat pengguna secara eksplisit meminta **bulan/periode tertentu** (misalnya *"tampilkan PO bulan Oktober 2026"*) atau **semua bulan / tren per bulan**, langsung sajikan sesuai periode di konteks ERP dengan tetap menyebutkan jumlah baris vs total dokumen secara transparan.
       - Sertakan saran lanjutan di \`followUpPrompts\` yang memudahkan pengguna melihat bulan lain atau filter supplier/customer (gunakan bulan yang relevan dengan konteks, JANGAN menyebut bulan yang sama berulang kali seolah-olah bulan berbeda).

ATURAN AKURASI & GROUNDING MUTLAK (TIDAK BOLEH DILANGGAR):
1. Untuk fakta/prosedur SOP, jawab HANYA berdasarkan KUTIPAN SOP yang diberikan di konteks. Untuk angka ERP/Aset/Maintenance, jawab HANYA berdasarkan blok data live di konteks. DILARANG KERAS mengarang aturan SOP, angka, transaksi, atau tanggal di luar data yang tersedia.
2. TETAP FOKUS (PROGRESSIVE DISCLOSURE):
   - Fokus jawab topik/proses yang ditanyakan pengguna saat ini; jangan membanjiri pengguna dengan menjelaskan seluruh bagian SOP lain yang tidak ditanyakan sekaligus. Cukup tawarkan secara singkat di kalimat follow-up jika pengguna ingin mendalami bagian berikutnya.
3. IKUTI ALUR PERCAKAPAN (FOLLOW-UP):
   - Jika pertanyaan saat ini adalah kelanjutan dari percakapan sebelumnya (misal: "contoh gambar menunya mana", "langkah berikutnya", "lanjutannya apa", "piutang mana yang belum lunas?"), ikuti konteks topik & periode yang sedang dibahas di RIWAYAT PERCAKAPAN SEBELUMNYA.
4. PERMINTAAN GAMBAR / FOTO MODUL / CONTOH MENU / SCREENSHOT / DIAGRAM:
   - Aplikasi SOP Brain secara OTOMATIS menampilkan gambar/foto modul, tangkapan layar PDF, atau infografis alur di bawah jawabanmu HANYA jika "showVisual": true.
   - WAJIB periksa daftar INVENTARIS GAMBAR/FOTO ASLI YANG BENAR-BENAR TERSEDIA DI SOP SAAT INI (atau tanda [Foto/Gambar Modul Tersedia ...] pada kutipan) sebelum menjawab permintaan gambar/foto/contoh menu/screenshot:
     * JIKA gambar/foto modul atau gambar halaman PDF yang SESUAI dengan bagian/proses yang ditanyakan BENAR-BENAR ADA di inventaris:
       - Set "answered": true dan cantumkan "citedSources" HANYA untuk bagian yang sesuai tersebut.
       - Jawab singkat (1-2 kalimat) merujuk pada menu/proses yang diminta saja.
       - Set "showVisual": true, "visualType": "pdf_page", dan isi "visualPageNumbers" jika menggunakan halaman PDF (atau [] jika menggunakan foto modul).
     * JIKA bagian/menu yang diminta BELUM MEMILIKI foto modul maupun gambar PDF di inventaris (misalnya bagian yang ditanya adalah Administrasi User/Bagian 3 yang belum punya foto, walaupun bagian lain seperti Role User/Bagian 4 sudah punya foto):
       - DILARANG KERAS menampilkan gambar dari bagian lain sebagai pengganti!
       - DILARANG menulis kalimat seolah-olah gambarnya ada/ditampilkan (jangan menulis "Berikut adalah tampilan screenshot...").
       - Sampaikan dengan jujur dan sopan: "Belum ada gambar atau tangkapan layar yang tersimpan untuk bagian [Nama Bagian/Menu] pada [Nomor SOP]." (dan boleh sebutkan bahwa Admin dapat mengunggah foto modul melalui menu Edit SOP).
       - Set "showVisual": false, "visualPageNumbers": [], "answered": true (dengan "citedSources" bagian yang ditanyakan).
     * JIKA pengguna secara eksplisit meminta dibuatkan diagram alur / flowchart / bagan / infografis prosedurnya:
       - Set "showVisual": true dan "visualType": "diagram".
   - Jika pengguna TIDAK meminta gambar/visual dalam pertanyaannya, set "showVisual": false dan "visualPageNumbers": [].
5. Jika kutipan yang tersedia TIDAK menjawab pertanyaan dengan cukup jelas dan eksplisit:
   - Set "answered": false.
   - Awali jawaban dengan kalimat persis: "Saya tidak menemukan ini di SOP yang ada."
   - Sarankan **nama divisi atau bagian terkait** saja yang sebaiknya dihubungi (misalnya "Divisi Keuangan", "Divisi Logistik", atau "Admin Divisi terkait").
   - DILARANG menyebutkan nama orang/pimpinan divisi/pemilik SOP (seperti "di bawah pimpinan Bapak/Ibu ..." atau nama personal individu) di dalam jawaban kecuali pengguna secara eksplisit menanyakan nama PIC-nya.
   - Kosongkan "citedSources" menjadi [].
6. Jika pertanyaan prosedural, sajikan langkah-langkah secara ringkas, bernomor (1, 2, 3...) dengan format jelas (misal: "1. **Nama Langkah:** Penjelasan...").
7. Sebutkan sumber SOP secara ringkas (nomor SOP, judul, versi, bagian, dan halaman jika ada) dan hanya mengutip SOP ID yang benar-benar ada di KUTIPAN SOP.
8. DETEKSI KONFLIK: Jika ada DUA atau lebih SOP dalam kutipan yang memiliki aturan, angka batas, atau prosedur yang SALING BERTENTANGAN untuk hal yang sama, set "hasConflict": true, jelaskan kedua versi aturan beserta nomor SOP masing-masing di jawaban dan "conflictSummary", dan ingatkan karyawan untuk mengonfirmasi ke Pemilik Proses/Admin Divisi.
9. DATA INVENTARIS ASET & JADWAL MAINTENANCE PERUSAHAAN:
   - Jika tersedia blok "DATA INVENTARIS ASET & JADWAL MAINTENANCE RESMI PERUSAHAAN" dan pertanyaan karyawan berkaitan dengan jumlah/total aset (kendaraan, meja, kursi, bangunan, IT, peralatan, kondisi, lokasi, PIC) atau jadwal maintenance (servis berkala, ganti oli, bayar pajak STNK, uji KIR, perawatan gedung/AC, jatuh tempo, vendor, estimasi biaya):
     * Jawab secara AKURAT, TERSTRUKTUR, dan RAPI (gunakan tabel Markdown atau daftar poin terkelompok dengan angka total yang presisi) HANYA berdasarkan data di blok tersebut. DILARANG mengarang aset atau tanggal jadwal di luar data tersebut.
     * Soroti jadwal yang berstatus **Terlambat** atau **Mendekati Jatuh Tempo** di urutan teratas lengkap dengan tanggal jatuh tempo, nama/kode aset, nomor polisi/seri (jika ada), siklus berulang, dan PIC/vendor.
     * Set "answered": true dan "usedAssetData": true. Jika ada SOP pemeliharaan terkait di kutipan SOP, boleh ikut menyertakan "citedSources"; jika murni dari data aset & maintenance, "citedSources" boleh [].
      * Jika data aset/maintenance masih kosong, sampaikan dengan sopan bahwa belum ada data aset/jadwal maintenance yang tercatat dan arahkan karyawan/admin ke menu **Aset & Maintenance** untuk menambahkannya (set "answered": true dan "usedAssetData": true).
10. DATA LIVE ERP MYSQL READ-ONLY (STOK GUDANG m1_*, PURCHASING/PEMBELIAN m4_* + REKONSILIASI LAPORAN KEUANGAN, PENJUALAN/SALES m5_*, KEUANGAN/FINANCE m2_* + m1_coa, & ASET TETAP m7_asset + m7_asset_depreciation):
    - Jika tersedia blok "DATA LIVE STOK BARANG GUDANG (KONEKSI LANGSUNG MYSQL ERP READ-ONLY)" (yang dapat berisi data Stok Gudang m1_*, data Purchasing/Pembelian m4_* + Jurnal Pembelian Laporan Keuangan, data Sales/Penjualan m5_*, data Keuangan/Finance m2_transaction_journal + m1_coa, dan/atau data Aset Tetap m7_asset):
      * **ATURAN CUT-OFF WAJIB (BERLAKU SEJAK 1 MARET 2026):**
        - Semua transaksi operasional, pembelian (m4_ri/m4_po/m4_grn/m4_pr), penjualan (m5_si/m5_so/m5_do/m5_sr), Laba Rugi (P&L ctipe 11–17), dan mutasi akun Neraca non-AR/AP di bawah 1 Maret 2026 (< 2026-03-01) **DIABAIKAN** karena pelaporan aktif dimulai 1 Maret 2026 sampai bulan berjalan.
        - **PENGECUALIAN HUTANG & PIUTANG:** Saldo **Piutang (AR / COA 1102* / faktur m5_si belum lunas)** dan **Hutang (AP / COA 210101* & 210103* / faktur m4_ri belum lunas)** WAJIB ditampilkan **kumulatif penuh termasuk saldo bawaan (carry-over) sebelum Maret 2026**, dengan menyebutkan rincian carry-over (< Maret 2026) vs mutasi (>= Maret 2026) jika tersedia.
        - **PENGECUALIAN ASET TETAP (m7_asset):** Daftar Aset Tetap perusahaan bersifat **kumulatif (akun Neraca)** sehingga mencakup seluruh aset aktif yang diperoleh kapan pun (tidak dibatasi cut-off Maret 2026).
        - Jika data jurnal m2_transaction_journal pada database lokal belum memiliki entri >= 2026-03-01, sampaikan secara transparan cakupan tanggal jurnal terakhir yang ada di database (mis. s.d. 18 Feb 2026) sehingga angka Laba Rugi >= Mar 2026 masih Rp 0, sambil tetap melaporkan posisi kumulatif Hutang/Piutang yang tersedia.
      * **KONTEKS BULAN / PERIODE & URUTAN BULAN (WAJIB DIPATUHI):**
        - Secara default (jika pengguna tidak menyebutkan bulan tertentu atau kata "semua bulan" / "per bulan"), seluruh transaksi operasional ERP (PO, PR, GRN, RI, SO, DO, SI, Retur, Pembelian, Penjualan, Laba Rugi) difokuskan pada **bulan berjalan** sesuai \`FOKUS PERIODE PERCAKAPAN\` pada konteks ERP. JANGAN mencampur transaksi dari bulan lain ke dalam tabel bulan berjalan (untuk akun Neraca seperti Hutang/AP, Piutang/AR kumulatif, Stok Fisik, dan Aset Tetap, tetap beri label jelas sebagai posisi kumulatif/saldo berjalan).
        - Jika pengguna sedang membahas **bulan/periode tertentu** (misalnya sebelumnya menanyakan penjualan/pembelian April 2026 lalu mengajukan pertanyaan lanjutan seperti "piutang mana yang belum lunas?" atau "supplier terbesarnya siapa?"), WAJIB tampilkan rincian **khusus bulan/periode yang sedang dibahas terlebih dahulu** agar angkanya konsisten 100% dengan jawaban sebelumnya. JANGAN mencampur faktur dari bulan lain atau menampilkan total keseluruhan seolah-olah itu milik bulan tersebut (jika ada carry-over dari bulan sebelumnya, pisahkan jelas di bagian catatan tambahan terpisah).
        - Jika pengguna meminta data **sesuai urutan bulan / per bulan / bulanan / tren bulanan**, WAJIB sajikan tabel terurut kronologis per bulan (misal 2026-03, 2026-04, 2026-05, dst.) dengan rincian angka masing-masing bulan, BUKAN sekadar total gabungan keseluruhan.
      * Untuk pertanyaan **Stok Gudang** (stok fisik / ketersediaan barang, qty tersedia, kode/nama barang, barang habis/menipis):
        - **ATURAN GUDANG INTRANSIT (WAJIB DIPATUHI):**
          1. **Gudang Intransit adalah gudang sementara (virtual)** berisi barang yang sudah di-DO dan sudah keluar secara fisik dari gudang asal, namun Sales Invoice (SI) belum diinput. Barang di Gudang Intransit **TIDAK ADA secara fisik di gudang**.
          2. Semua angka **Stok Fisik / Tersedia** WAJIB **MENGECUALIKAN Gudang Intransit**. DILARANG KERAS menjumlahkan qty Gudang Intransit ke stok tersedia (contoh: jika ada 10 di Gudang Utama dan 5 di Intransit, stok tersedia adalah **10**, BUKAN 15).
          3. DILARANG menandai atau melaporkan item dengan saldo ≤ 0 di Gudang Intransit sebagai anomali/kekosongan stok fisik atau kendala GRN/DO gudang fisik.
          4. Jika pengguna menanyakan atau perlu melihat isi Gudang Intransit, tampilkan di bagian/tabel **terpisah** dengan label jelas **"Barang sudah dikirim, belum diinvoice"** sebagai informasi semata dan JANGAN dijumlahkan ke stok tersedia.
        - Sajikan data Stok Fisik / Tersedia secara AKURAT dan RAPI dalam tabel Markdown (Kode Barang | Nama Barang | Gudang | Qty Tersedia | Satuan) beserta ringkasan per gudang fisik jika relevan.
      * Untuk pertanyaan **Purchasing / Pembelian** (total pembelian, Purchase Domestic 520105, Purchase Import 520104, Purchase Return 510103, Purchase Discount 510102, beban COGS pembelian 520103/520106–520109, faktur pembelian/m4_ri, Purchase Order/m4_po, Goods Receipt/m4_grn, Purchase Request/m4_pr, top supplier, top barang dibeli, hutang supplier/aging AP):
        - WAJIB gunakan angka **Buku Besar / Laporan Keuangan (m2_transaction_journal)** sebagai angka utama total Pembelian Bersih, Domestic, Import, dan Return/Discount agar 100% cocok dengan Laporan Keuangan (termasuk 2 angka desimal bila ada), lalu tampilkan rincian sub-ledger operasional (m4_ri, m4_po, m4_grn, m4_pr, Top Supplier, Aging Hutang) secara transparan beserta selisih rekonsiliasi jika relevan.
      * Untuk pertanyaan **Sales / Penjualan** (omzet, faktur penjualan/m5_si, piutang/belum lunas/jatuh tempo, Sales Order/m5_so, Delivery Order/m5_do, retur penjualan/m5_sr, top customer, barang terlaris): sajikan ringkasan angka presisi (format Rupiah Rp ...) dan tabel Markdown yang rapi lengkap dengan nomor transaksi, tanggal, nama customer, nilai, status (sesuai kode m0_status), serta penanda carry-over untuk piutang < 2026-03-01.
      * Untuk pertanyaan **Keuangan / Finance** (Laba Rugi / P&L, Neraca / Balance Sheet, Nilai Persediaan, Pendapatan, HPP/COGS, Beban Operasional/OPEX, Hutang/AP, Piutang/AR, Aging Piutang, Kas & Bank, COA m1_coa): sajikan angka Rupiah secara presisi dan tabel Markdown terstruktur sesuai data pada blok tersebut, sebutkan jika ada akun dengan anomali overflow yang dikecualikan dari total, dan jelaskan bila relevan bahwa **Nilai Persediaan, HPP, dan Neraca TETAP menyertakan Gudang Intransit** secara akuntansi hingga Sales Invoice (SI) diinput.
      * Untuk pertanyaan **Aset Tetap ERP (m7_asset / m7_asset_depreciation)** (daftar aset tetap, kendaraan/mesin/bangunan/dies/peralatan, umur ekonomis, sisa umur ekonomis, nilai perolehan, akumulasi penyusutan, sisa nilai buku / net book value, beban penyusutan bulanan): sajikan ringkasan total nilai Rupiah secara presisi dan tabel Markdown yang rapi (Kode | Nama Aset | Kategori | Tgl Beli | Umur Ekonomis & Sisa Umur | Nilai Perolehan | Akumulasi Penyusutan | Sisa Nilai Buku | Susut/Bln). Tegaskan jika pengguna menanyakan jadwal ganti oli / pajak STNK / uji KIR untuk aset ERP bahwa tanggal tersebut memang **sengaja dikosongkan** di database ERP sampai diisi manual melalui menu **Aset & Maintenance → Jadwal Maintenance** (dan gabungkan dengan blok DATA INVENTARIS ASET & JADWAL MAINTENANCE apabila sudah ada jadwal manual yang tersimpan).
      * DILARANG mengarang qty, nilai omzet, nilai pembelian, saldo COA, nilai buku aset, umur ekonomis, nomor faktur, tanggal ganti oli/STNK, atau nama customer/vendor/barang di luar data yang tertulis pada blok tersebut.
      * Set "answered": true dan "usedErpData": true. Jika pertanyaan juga menyangkut prosedur SOP terkait, boleh menggabungkan kutipan SOP dan menyertakan "citedSources"; jika murni cek data live ERP, "citedSources" boleh [].
      * Jika koneksi MySQL ERP belum dikonfigurasi atau gagal terhubung: apabila pertanyaan murni menanyakan prosedur SOP yang ada di kutipan SOP, jawab dari SOP saja tanpa terganggu; apabila pengguna memang ingin mengecek data live ERP, sampaikan status/kendala koneksi secara sopan dan arahkan ke menu **ERP Live** untuk uji koneksi & panduan penyiapan bridge lokal (set "answered": true dan "usedErpData": true).
11. PENYAJIAN DATA DIAGRAM & BAHAN PRESENTASI EKSEKUTIF (HANYA JIKA DIMINTA):
    - Jika pengguna HANYA meminta data/rekap/tabel biasa TANPA meminta diagram, grafik, chart, atau bahan presentasi: jawab bersih dalam teks/tabel Markdown seperti biasa dan WAJIB set "chartSpec": null (JANGAN tampilkan diagram otomatis).
    - HANYA JIKA pengguna secara eksplisit meminta diagram, grafik, chart, visualisasi data, atau bahan presentasi (termasuk pertanyaan lanjutan seperti "buatkan diagramnya", "tampilkan grafik garisnya", "ubah ke diagram donat"):
      * Isi objek "chartSpec" di blok metadata dengan angka numerik murni (tanpa tanda titik pemisah ribuan di JSON, misal 9147029581), jangan masukkan baris Total ke dalam array labels/series agar skala grafik tetap proporsional, dan set "showVisual": false agar tidak bentrok dengan gambar alur SOP.
12. BATASAN HAK AKSES ROLE (SERVER-ENFORCED RBAC):
    - Jika pada blok "STATUS HAK AKSES PENGGUNA SAAT INI" tercantum "AKSES DITOLAK SERVER UNTUK PERTANYAAN INI":
      * Server secara ketat TIDAK mengambil dan TIDAK mengirim data sensitif tersebut ke AI.
      * Tolak permintaan data sensitif itu secara sopan, tegas, dan jelas (contoh: "Maaf, akun Anda dengan role **Karyawan Biasa** tidak memiliki akses ke data pembayaran supplier / laporan keuangan tersebut.").
      * DILARANG menebak, mengestimasi, atau mengarang angka/transaksi apa pun untuk modul yang ditolak.
      * Jika tersedia kutipan SOP umum yang boleh diakses atau prosedur umum non-sensitif yang relevan (misal prosedur pengajuan pembayaran atau alur kerja umum), bantu pengguna dengan informasi umum non-sensitif tersebut secara ringkas, atau arahkan pengguna menghubungi divisi terkait / Administrator bila memerlukan akses.
      * Set "answered": true, "usedErpData": false, "chartSpec": null.`;

export interface AiAccessControlContext {
  roleCode: string;
  roleName: string;
  allowedScopeLabels: string[];
  deniedDomains: string[];
}

export async function generateGroundedSopAnswer(params: {
  question: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  accessibleChunks: SopChunk[];
  divisions: Division[];
  precomputedEmbedding?: number[];
  visualCatalog?: SopVisualCatalogEntry[];
  assetMaintenanceContext?: AssetMaintenanceAiContext;
  erpStockContext?: ErpStockAiContext;
  accessControlContext?: AiAccessControlContext;
}): Promise<RagAnswerResponse> {
  const {
    question,
    history,
    accessibleChunks,
    divisions,
    precomputedEmbedding,
    visualCatalog,
    assetMaintenanceContext,
    erpStockContext,
    accessControlContext,
  } = params;

  const hasDeniedDomains = Boolean(accessControlContext?.deniedDomains?.length);

  if (
    accessibleChunks.length === 0 &&
    !assetMaintenanceContext &&
    !(erpStockContext && erpStockContext.summaryText) &&
    !hasDeniedDomains &&
    !isConversationalOrGreetingQuery(question)
  ) {
    return buildEmptyChunksResponse(divisions);
  }

  const retrievalQuery = buildRetrievalQuery(question, history);
  const queryEmbedding =
    accessibleChunks.length === 0
      ? []
      : precomputedEmbedding !== undefined
        ? precomputedEmbedding
        : (await tryEmbedText(retrievalQuery, true)) || [];
  const { topScored, prompt } = prepareRagContext({
    question,
    history,
    accessibleChunks,
    divisions,
    queryEmbedding,
    retrievalQuery,
    visualCatalog,
    assetMaintenanceContext,
    erpStockContext,
    accessControlContext,
  });

  const ai = getAiClient();
  const qaAttempts: Array<{ model: string; level: ThinkingLevel; delayMs: number }> = [
    { model: 'gemini-3.1-flash-lite', level: ThinkingLevel.MINIMAL, delayMs: 0 },
    { model: 'gemini-4-hydrogen', level: ThinkingLevel.LOW, delayMs: 250 },
    { model: 'gemini-3.1-flash-lite', level: ThinkingLevel.MINIMAL, delayMs: 900 },
  ];

  let response: Awaited<ReturnType<typeof ai.models.generateContent>> | null = null;
  let lastQaErr: unknown = null;
  for (let i = 0; i < qaAttempts.length; i++) {
    const attempt = qaAttempts[i];
    if (attempt.delayMs > 0) {
      await sleep(attempt.delayMs);
    }
    try {
      response = await ai.models.generateContent({
        model: attempt.model,
        contents: prompt,
        config: {
          systemInstruction: RAG_BASE_SYSTEM_RULES,
          thinkingConfig: { thinkingLevel: attempt.level },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              answered: {
                type: Type.BOOLEAN,
                description: 'true jika jawaban ditemukan dalam kutipan SOP, data aset/maintenance, data ERP, atau merupakan percakapan/sapaan/pertanyaan kemampuan asisten; false jika pertanyaan spesifik SOP tidak ditemukan.',
              },
              isConversational: {
                type: Type.BOOLEAN,
                description: 'true jika pengguna menyapa, berterima kasih, atau menanyakan kemampuan umum asisten tanpa membutuhkan kutipan SOP.',
              },
              usedAssetData: {
                type: Type.BOOLEAN,
                description: 'true jika jawaban menggunakan DATA INVENTARIS ASET & JADWAL MAINTENANCE RESMI PERUSAHAAN.',
              },
              usedErpData: {
                type: Type.BOOLEAN,
                description: 'true jika jawaban menggunakan DATA LIVE STOK BARANG GUDANG (MYSQL ERP).',
              },
              answerMarkdown: {
                type: Type.STRING,
                description: 'Jawaban terstruktur, natural, dan interaktif dalam Markdown Bahasa Indonesia (pola Answer + Insight + Follow-up).',
              },
              hasConflict: {
                type: Type.BOOLEAN,
                description: 'true jika terdapat dua SOP dengan ketentuan bertentangan.',
              },
              conflictSummary: {
                type: Type.STRING,
                description: 'Ringkasan konflik antar SOP jika hasConflict=true, kosong jika false.',
              },
              suggestedContact: {
                type: Type.STRING,
                description: 'Saran divisi/owner yang bisa dihubungi jika tidak ditemukan atau ada konflik.',
              },
              citedSources: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    sopId: { type: Type.STRING },
                    docNumber: { type: Type.STRING },
                    title: { type: Type.STRING },
                    version: { type: Type.INTEGER },
                    sectionTitle: { type: Type.STRING },
                    divisionName: { type: Type.STRING },
                  },
                  required: ['sopId', 'docNumber', 'title', 'version', 'sectionTitle', 'divisionName'],
                },
              },
              showVisual: {
                type: Type.BOOLEAN,
                description: 'true hanya jika pengguna meminta gambar, contoh menu, screenshot, atau diagram.',
              },
              visualType: {
                type: Type.STRING,
                description: 'pdf_page atau diagram',
              },
              visualPageNumbers: {
                type: Type.ARRAY,
                items: { type: Type.INTEGER },
                description: 'Nomor halaman PDF spesifik yang relevan dengan permintaan gambar saat ini saja.',
              },
              followUpPrompts: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '2-3 saran pertanyaan lanjutan singkat (maks. 75 karakter) yang paling relevan untuk diklik pengguna berikutnya.',
              },
            },
            required: ['answered', 'answerMarkdown', 'hasConflict', 'conflictSummary', 'suggestedContact', 'citedSources'],
          },
        },
      });
      break;
    } catch (err) {
      lastQaErr = err;
      const isLast = i === qaAttempts.length - 1;
      if (isLast || isGeminiAuthError(err) || !isGeminiTransientError(err)) {
        throw err;
      }
      console.warn(
        `Q&A model ${attempt.model} failed transiently (attempt ${i + 1}/${qaAttempts.length}), retrying...`,
        err
      );
    }
  }

  if (!response) {
    throw lastQaErr ?? new Error('Gagal mendapatkan respons AI.');
  }

  const parsed = parseAiJson<{
    answered?: boolean;
    isConversational?: boolean;
    usedAssetData?: boolean;
    usedErpData?: boolean;
    answerMarkdown?: string;
    hasConflict?: boolean;
    conflictSummary?: string;
    suggestedContact?: string;
    citedSources?: CitationSource[];
    showVisual?: boolean;
    visualType?: string;
    visualPageNumbers?: number[];
    followUpPrompts?: string[];
  }>(response.text, 'jawaban Q&A');

  return finalizeRagResponse(
    parsed,
    topScored,
    question,
    Boolean(assetMaintenanceContext),
    Boolean(erpStockContext)
  );
}

const STREAM_META_START = '<<<SOP_META>>>';
const STREAM_META_END = '<<<END_META>>>';

export async function streamGroundedSopAnswer(params: {
  question: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  accessibleChunks: SopChunk[];
  divisions: Division[];
  precomputedEmbedding?: number[];
  visualCatalog?: SopVisualCatalogEntry[];
  assetMaintenanceContext?: AssetMaintenanceAiContext;
  erpStockContext?: ErpStockAiContext;
  accessControlContext?: AiAccessControlContext;
  onDelta: (textChunk: string) => void;
}): Promise<RagAnswerResponse> {
  const {
    question,
    history,
    accessibleChunks,
    divisions,
    precomputedEmbedding,
    visualCatalog,
    assetMaintenanceContext,
    erpStockContext,
    accessControlContext,
    onDelta,
  } = params;

  const hasDeniedDomains = Boolean(accessControlContext?.deniedDomains?.length);

  if (
    accessibleChunks.length === 0 &&
    !assetMaintenanceContext &&
    !(erpStockContext && erpStockContext.summaryText) &&
    !hasDeniedDomains &&
    !isConversationalOrGreetingQuery(question)
  ) {
    const emptyRes = buildEmptyChunksResponse(divisions);
    onDelta(emptyRes.answerMarkdown);
    return emptyRes;
  }

  const retrievalQuery = buildRetrievalQuery(question, history);
  const queryEmbedding =
    accessibleChunks.length === 0
      ? []
      : precomputedEmbedding !== undefined
        ? precomputedEmbedding
        : (await tryEmbedText(retrievalQuery, true)) || [];
  const { topScored, prompt } = prepareRagContext({
    question,
    history,
    accessibleChunks,
    divisions,
    queryEmbedding,
    retrievalQuery,
    visualCatalog,
    assetMaintenanceContext,
    erpStockContext,
    accessControlContext,
  });

  const streamInstruction = `${RAG_BASE_SYSTEM_RULES}

FORMAT OUTPUT WAJIB:
1. Tulis terlebih dahulu jawaban Markdown bergaya percakapan modern (ringkas, langsung ke inti, kalimat pembuka 1 baris, poin-poin bersih atau tabel Markdown bila cocok, cetak tebal selektif pada entitas/angka penting, \`inline code\` untuk kode/nomor/status, serta 1 kalimat penutup atau follow-up natural — TANPA pembungkus JSON atau blok kode di luar jawaban).
2. Tepat di baris baru setelah jawaban selesai, tambahkan blok metadata persis dengan format berikut:
${STREAM_META_START}
{"answered":true,"isConversational":false,"usedAssetData":false,"usedErpData":false,"hasConflict":false,"conflictSummary":"","suggestedContact":"","showVisual":false,"visualType":"pdf_page","visualPageNumbers":[],"chartSpec":null,"followUpPrompts":["Pertanyaan lanjutan singkat 1","Pertanyaan lanjutan singkat 2"],"citedSources":[{"sopId":"...","docNumber":"...","title":"...","version":1,"sectionTitle":"...","divisionName":"..."}]}
${STREAM_META_END}
Pastikan JSON di dalam blok ${STREAM_META_START} valid dalam satu baris. Set "isConversational": true untuk sapaan/pertanyaan umum kemampuan asisten. Set "usedAssetData": true jika jawaban memakai data aset/maintenance perusahaan, set "usedErpData": true jika jawaban memakai data live ERP MySQL, dan hanya menyertakan sopId yang benar-benar ada di KUTIPAN SOP. Isi "followUpPrompts" dengan 2-3 saran pertanyaan lanjutan singkat (maks. 75 karakter) yang paling relevan dengan konteks jawaban saat ini. Set "showVisual": true dan isi "visualPageNumbers" HANYA jika pengguna meminta contoh gambar/menu/screenshot/diagram alur SOP. Set "chartSpec": null secara default; HANYA isi "chartSpec":{"title":"...","subtitle":"...","recommendedType":"bar|horizontal_bar|line|area|donut|pie|stacked_bar","valueFormat":"currency|number|percent","unitLabel":"Rp","categoryLabel":"Bulan","labels":["Mar 2026","Apr 2026"],"series":[{"name":"Pendapatan","values":[9147029581,9795715088]}],"insightSummary":"1 kalimat poin utama presentasi"} apabila pengguna secara eksplisit meminta diagram, grafik, chart, atau bahan presentasi.`;

  const ai = getAiClient();

  let emittedAny = false;
  const trackedOnDelta = (chunk: string) => {
    emittedAny = true;
    onDelta(chunk);
  };

  const runModelStream = async (model: string, thinkingLevel: ThinkingLevel) => {
    let fullRaw = '';
    let emittedLen = 0;

    const stream = await ai.models.generateContentStream({
      model,
      contents: prompt,
      config: {
        systemInstruction: streamInstruction,
        thinkingConfig: { thinkingLevel },
      },
    });

    for await (const chunk of stream) {
      const piece = chunk.text || '';
      if (!piece) continue;
      fullRaw += piece;

      const markerIdx = fullRaw.indexOf(STREAM_META_START);
      if (markerIdx !== -1) {
        if (emittedLen < markerIdx) {
          const toEmit = fullRaw.slice(emittedLen, markerIdx);
          if (toEmit) trackedOnDelta(toEmit);
          emittedLen = markerIdx;
        }
      } else {
        const safeEnd = Math.max(emittedLen, fullRaw.length - STREAM_META_START.length);
        if (safeEnd > emittedLen) {
          const toEmit = fullRaw.slice(emittedLen, safeEnd);
          if (toEmit) trackedOnDelta(toEmit);
          emittedLen = safeEnd;
        }
      }
    }

    const markerIdx = fullRaw.indexOf(STREAM_META_START);
    let answerMarkdown = '';
    let parsedMeta: {
      answered?: boolean;
      isConversational?: boolean;
      usedAssetData?: boolean;
      usedErpData?: boolean;
      hasConflict?: boolean;
      conflictSummary?: string;
      suggestedContact?: string;
      citedSources?: Partial<CitationSource>[];
      showVisual?: boolean;
      visualType?: string;
      visualPageNumbers?: unknown[];
      chartSpec?: Partial<AiChartSpec> | null;
      followUpPrompts?: unknown[];
    } | null = null;

    if (markerIdx !== -1) {
      answerMarkdown = fullRaw.slice(0, markerIdx).trimEnd();
      const tailRaw = fullRaw.slice(markerIdx + STREAM_META_START.length);
      const endIdx = tailRaw.indexOf(STREAM_META_END);
      const jsonBody = (endIdx !== -1 ? tailRaw.slice(0, endIdx) : tailRaw)
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      try {
        parsedMeta = JSON.parse(jsonBody);
      } catch {
        parsedMeta = null;
      }
    } else {
      // Flush held-back tail if model omitted the marker
      if (emittedLen < fullRaw.length) {
        trackedOnDelta(fullRaw.slice(emittedLen));
      }
      answerMarkdown = fullRaw.trim();
    }

    if (!parsedMeta) {
      const notFound = answerMarkdown.toLowerCase().startsWith('saya tidak menemukan ini di sop yang ada');
      const answerLower = answerMarkdown.toLowerCase();
      const inferredCitations: Partial<CitationSource>[] = [];
      for (const item of topScored) {
        const matchedDoc = item.chunk.docNumber && answerLower.includes(item.chunk.docNumber.toLowerCase());
        const matchedTitle = item.chunk.title && answerLower.includes(item.chunk.title.toLowerCase());
        if (matchedDoc || matchedTitle) {
          inferredCitations.push({
            sopId: item.chunk.sopId,
            docNumber: item.chunk.docNumber,
            title: item.chunk.title,
            version: item.chunk.version,
            sectionTitle: item.chunk.sectionTitle,
            divisionName: item.chunk.divisionName,
          });
        }
      }
      if (!notFound && inferredCitations.length === 0 && topScored[0] && topScored[0].hybridScore >= 0.3) {
        inferredCitations.push({
          sopId: topScored[0].chunk.sopId,
          docNumber: topScored[0].chunk.docNumber,
          title: topScored[0].chunk.title,
          version: topScored[0].chunk.version,
          sectionTitle: topScored[0].chunk.sectionTitle,
          divisionName: topScored[0].chunk.divisionName,
        });
      }
      parsedMeta = {
        answered:
          !notFound &&
          (inferredCitations.length > 0 ||
            Boolean(assetMaintenanceContext) ||
            Boolean(erpStockContext)),
        usedAssetData: Boolean(assetMaintenanceContext) && !notFound,
        usedErpData: Boolean(erpStockContext) && !notFound,
        hasConflict: false,
        conflictSummary: '',
        suggestedContact: '',
        citedSources: inferredCitations,
      };
    }

    return finalizeRagResponse(
      {
        ...parsedMeta,
        answerMarkdown,
      },
      topScored,
      question,
      Boolean(assetMaintenanceContext),
      Boolean(erpStockContext)
    );
  };

  const streamAttempts: Array<{ model: string; level: ThinkingLevel; delayMs: number }> = [
    { model: 'gemini-3.1-flash-lite', level: ThinkingLevel.MINIMAL, delayMs: 0 },
    { model: 'gemini-4-hydrogen', level: ThinkingLevel.LOW, delayMs: 250 },
    { model: 'gemini-3.1-flash-lite', level: ThinkingLevel.MINIMAL, delayMs: 900 },
  ];

  let lastStreamErr: unknown = null;
  for (let i = 0; i < streamAttempts.length; i++) {
    const attempt = streamAttempts[i];
    if (attempt.delayMs > 0) {
      await sleep(attempt.delayMs);
    }
    try {
      return await runModelStream(attempt.model, attempt.level);
    } catch (err) {
      lastStreamErr = err;
      const isLast = i === streamAttempts.length - 1;
      if (isLast || emittedAny || isGeminiAuthError(err)) {
        throw err;
      }
      console.warn(
        `Q&A stream (${attempt.model}) failed before first token (attempt ${i + 1}/${streamAttempts.length}), retrying with fallback:`,
        err
      );
    }
  }

  throw lastStreamErr ?? new Error('Gagal mendapatkan jawaban AI.');
}

const INLINE_MEDIA_MAX_BYTES = 7 * 1024 * 1024;

async function runWithUploadedOrInlineFile<T>(params: {
  fileBase64?: string;
  mimeType?: string;
  fileName?: string;
  textPrompt: string;
  execute: (contents: Parameters<GoogleGenAI['models']['generateContent']>[0]['contents']) => Promise<T>;
}): Promise<T> {
  const ai = getAiClient();
  if (!params.fileBase64 || !params.mimeType) {
    return params.execute(params.textPrompt);
  }

  const fileBuffer = Buffer.from(params.fileBase64, 'base64');
  if (fileBuffer.byteLength <= INLINE_MEDIA_MAX_BYTES) {
    return params.execute({
      parts: [
        { inlineData: { mimeType: params.mimeType, data: params.fileBase64 } },
        { text: params.textPrompt },
      ],
    });
  }

  // Use Gemini Files API for larger image-heavy PDFs (> 7 MB)
  const blob = new Blob([fileBuffer], { type: params.mimeType });
  const uploaded = await ai.files.upload({
    file: blob,
    config: {
      mimeType: params.mimeType,
      displayName: params.fileName || 'sop-document.pdf',
    },
  });

  try {
    let fileMeta = uploaded;
    const deadline = Date.now() + 25_000;
    while (fileMeta.state === FileState.PROCESSING && Date.now() < deadline && fileMeta.name) {
      await new Promise((r) => setTimeout(r, 1200));
      fileMeta = await ai.files.get({ name: fileMeta.name });
    }
    if (fileMeta.state === FileState.FAILED || !fileMeta.uri) {
      throw new Error('Gagal memproses file PDF berukuran besar pada layanan AI.');
    }
    const content = createUserContent([
      createPartFromUri(fileMeta.uri, fileMeta.mimeType || params.mimeType),
      params.textPrompt,
    ]);
    return await params.execute(content);
  } finally {
    if (uploaded.name) {
      await ai.files.delete({ name: uploaded.name }).catch(() => {});
    }
  }
}

export async function summarizeVisualPdfAttachment(params: {
  fileBase64: string;
  mimeType: string;
  fileName: string;
}): Promise<string> {
  const ai = getAiClient();
  const prompt = `Baca seluruh halaman PDF "${params.fileName}" secara menyeluruh termasuk teks, hasil scan (OCR), tabel, diagram alur, dan screenshot aplikasi/UI.
Buat ringkasan terstruktur per halaman (Halaman 1, Halaman 2, dst.) dalam Bahasa Indonesia yang memuat semua langkah kerja, nama menu/tombol, form, dan keterangan gambar penting.`;

  const response = await runWithUploadedOrInlineFile({
    fileBase64: params.fileBase64,
    mimeType: params.mimeType,
    fileName: params.fileName,
    textPrompt: prompt,
    execute: (contents) =>
      ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        },
      }),
  });

  return (response.text || '').trim().slice(0, 6000);
}

export async function structureSopWithAi(params: {
  rawText?: string;
  fileBase64?: string;
  mimeType?: string;
  fileName?: string;
  titleHint?: string;
  divisionHint?: string;
  divisions: Division[];
}): Promise<AiSopDraft> {
  const ai = getAiClient();
  const divisionNames = params.divisions.map((d) => `${d.name} (${d.code})`).join(', ');
  const isPdf = params.mimeType === 'application/pdf';

  const systemInstruction = `Kamu adalah arsitek dokumentasi SOP perusahaan profesional berbahasa Indonesia dengan kemampuan membaca dokumen multimodal (teks, tabel, diagram alur, screenshot aplikasi, dan gambar hasil scan/OCR).
Tugasmu adalah mengekstrak, merapikan, atau menyusun dokumen menjadi struktur SOP standar perusahaan yang rapi, lengkap, operasional, dan mudah dipahami karyawan.

Pedoman:
- Gunakan Bahasa Indonesia formal yang jelas, aktif, dan prosedural.
- Jika dokumen berupa PDF yang berisi GAMBAR, SCREENSHOT SISTEM/ERP, DIAGRAM ALUR (FLOWCHART), atau HALAMAN SCAN:
  1. Lakukan pembacaan visual & OCR menyeluruh pada setiap halaman dan setiap gambar.
  2. Terjemahkan informasi visual (nama menu, tombol, kolom input, alur panah, catatan pada gambar, dan ilustrasi langkah) menjadi langkah-langkah kerja eksplisit di dalam "sections" dengan referensi halaman bila relevan (misal: "[Halaman 2]").
  3. Di field "attachmentSummary", tuliskan ringkasan terperinci isi visual/gambar per halaman agar tetap dapat dicari oleh mesin tanya-jawab SOP.
- Pecah langkah kerja menjadi bagian-bagian logis ("sections") dengan judul bagian yang deskriptif (misal: "1. Persiapan & Persyaratan", "2. Pengajuan di Sistem", "3. Persetujuan Berjenjang", "4. Pencairan / Tindak Lanjut").
- Pastikan "suggestedDivisionName" dipilih dari daftar divisi yang tersedia jika cocok: [${divisionNames}].
- Buat nomor dokumen standar jika belum ada (contoh: SOP-FIN-010).`;

  const textPrompt = [
    params.fileName ? `Nama File Sumber: ${params.fileName}` : '',
    params.titleHint ? `Petunjuk Judul / Konteks: ${params.titleHint}` : '',
    params.divisionHint ? `Petunjuk Divisi: ${params.divisionHint}` : '',
    params.rawText
      ? `ISI DOKUMEN / CATATAN KASAR:\n${params.rawText.slice(0, 35000)}`
      : isPdf
        ? 'Ekstrak seluruh isi PDF terlampir secara menyeluruh, termasuk semua gambar, screenshot aplikasi, diagram alur, tabel, dan teks hasil scan (OCR) di setiap halaman menjadi SOP terstruktur.'
        : 'Ekstrak isi dokumen terlampir menjadi SOP terstruktur.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const response = await runWithUploadedOrInlineFile({
    fileBase64: params.fileBase64,
    mimeType: params.mimeType,
    fileName: params.fileName,
    textPrompt,
    execute: (contents) =>
      ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              docNumber: { type: Type.STRING },
              suggestedDivisionName: { type: Type.STRING },
              suggestedDepartmentName: { type: Type.STRING },
              purpose: { type: Type.STRING },
              scope: { type: Type.STRING },
              relatedRoles: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              sections: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    content: { type: Type.STRING },
                  },
                  required: ['title', 'content'],
                },
              },
              attachmentSummary: { type: Type.STRING },
            },
            required: [
              'title',
              'docNumber',
              'suggestedDivisionName',
              'suggestedDepartmentName',
              'purpose',
              'scope',
              'relatedRoles',
              'sections',
              'attachmentSummary',
            ],
          },
        },
      }),
  });

  const parsed = parseAiJson<Partial<AiSopDraft>>(response.text, 'ekstraksi SOP');
  return {
    title: parsed.title || params.titleHint || 'SOP Baru',
    docNumber: parsed.docNumber || 'SOP-GEN-001',
    suggestedDivisionName: parsed.suggestedDivisionName || params.divisionHint || '',
    suggestedDepartmentName: parsed.suggestedDepartmentName || '',
    purpose: parsed.purpose || '',
    scope: parsed.scope || '',
    relatedRoles: Array.isArray(parsed.relatedRoles) ? parsed.relatedRoles : [],
    sections:
      Array.isArray(parsed.sections) && parsed.sections.length > 0
        ? parsed.sections
        : [{ title: '1. Prosedur Pelaksanaan', content: params.rawText || parsed.attachmentSummary || '' }],
    attachmentSummary: parsed.attachmentSummary || '',
  };
}

function normalizeConflictType(raw?: string): ConflictType {
  const lower = (raw || '').toLowerCase();
  if (lower.includes('duplik')) return 'Duplikasi';
  if (lower.includes('tumpang') || lower.includes('pic') || lower.includes('wewenang')) {
    return 'Tumpang Tindih PIC';
  }
  return 'Konflik Aturan';
}

function normalizeSeverity(raw?: string): 'Tinggi' | 'Sedang' | 'Rendah' {
  const lower = (raw || '').toLowerCase();
  if (lower.includes('tinggi') || lower.includes('high')) return 'Tinggi';
  if (lower.includes('rendah') || lower.includes('low')) return 'Rendah';
  return 'Sedang';
}

function buildSopDigest(s: SopDocument, maxSectionChars = 900): string {
  const sectionsText = s.sections
    .map((sec) => `  - ${sec.title}: ${sec.content.slice(0, maxSectionChars)}`)
    .join('\n');
  return [
    `SOP ID: ${s.id}`,
    `Nomor: ${s.docNumber} | Judul: ${s.title} | Divisi: ${s.divisionName} | v${s.version}`,
    `Owner: ${s.ownerName || '-'} | Peran: ${(s.relatedRoles || []).join(', ') || '-'}`,
    `Tujuan: ${s.purpose.slice(0, 400)}`,
    `Isi:\n${sectionsText}`,
  ].join('\n');
}

function rankRelatedApprovedSops(candidate: SopDocument, pool: SopDocument[], limit = 14): SopDocument[] {
  const candText = [
    candidate.title,
    candidate.purpose,
    candidate.scope,
    ...(candidate.relatedRoles || []),
    ...candidate.sections.map((s) => `${s.title} ${s.content}`),
  ].join(' ');
  const candTokens = new Set(tokenizeIndonesian(candText));

  const scored = pool
    .filter((s) => s.id !== candidate.id)
    .map((other) => {
      const otherText = [
        other.title,
        other.purpose,
        other.scope,
        ...(other.relatedRoles || []),
        ...other.sections.map((s) => `${s.title} ${s.content}`),
      ].join(' ');
      const otherTokens = tokenizeIndonesian(otherText);
      let overlap = 0;
      const seen = new Set<string>();
      for (const tok of otherTokens) {
        if (candTokens.has(tok) && !seen.has(tok)) {
          seen.add(tok);
          overlap += 1;
        }
      }
      const sameDivBonus = other.divisionId && other.divisionId === candidate.divisionId ? 4 : 0;
      const score = overlap + sameDivBonus;
      return { sop: other, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((item) => item.sop);
}

export async function detectSopConflictsWithAi(
  sops: SopDocument[]
): Promise<{ conflicts: SopConflictItem[]; summary: string }> {
  const approvedSops = sops.filter((s) => s.status === 'Disetujui');
  if (approvedSops.length < 2) {
    return {
      conflicts: [],
      summary: 'Minimal dibutuhkan 2 SOP berstatus Disetujui untuk memindai konflik antar dokumen.',
    };
  }

  // Scalable batching: if <= 25 SOPs inspect all together; if > 25, partition into overlapping batches
  // plus top cross-division high-risk pairs (financial/approval/HR/IT policies) so no SOP is skipped.
  const batches: SopDocument[][] = [];
  if (approvedSops.length <= 25) {
    batches.push(approvedSops);
  } else {
    const batchSize = 20;
    for (let i = 0; i < approvedSops.length; i += 14) {
      const slice = approvedSops.slice(i, i + batchSize);
      if (slice.length >= 2) batches.push(slice);
      if (i + batchSize >= approvedSops.length) break;
    }
  }

  const ai = getAiClient();
  const validIds = new Set(approvedSops.map((s) => s.id));
  const allConflicts: SopConflictItem[] = [];
  const seenPairs = new Set<string>();
  const batchSummaries: string[] = [];

  for (const batch of batches.slice(0, 4)) {
    const digest = batch
      .map((s) => buildSopDigest(s, batch.length > 15 ? 600 : 1000))
      .join('\n\n====================\n\n');

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Analisis daftar SOP berstatus Disetujui berikut ini untuk menemukan apakah ada KONFLIK kebijakan/angka batas/plafon/SLA, DUPLIKASI prosedur serupa, atau TUMPANG TINDIH tanggung jawab PIC antar SOP.\n\nJika tidak ada masalah nyata, kembalikan array conflicts kosong []. Jangan mengada-ada konflik jika memang selaras.\n\nDAFTAR SOP:\n${digest}`,
      config: {
        systemInstruction:
          'Kamu adalah auditor tata kelola SOP perusahaan. Gunakan Bahasa Indonesia formal dan objektif. Hanya laporkan konflik, duplikasi, atau tumpang tindih nyata antar dua SOP berbeda yang ID-nya benar-benar ada di input.',
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            conflicts: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  sopAId: { type: Type.STRING },
                  sopADocNumber: { type: Type.STRING },
                  sopATitle: { type: Type.STRING },
                  sopBId: { type: Type.STRING },
                  sopBDocNumber: { type: Type.STRING },
                  sopBTitle: { type: Type.STRING },
                  conflictType: {
                    type: Type.STRING,
                    description: 'Konflik Aturan, Duplikasi, atau Tumpang Tindih PIC',
                  },
                  severity: {
                    type: Type.STRING,
                    description: 'Tinggi, Sedang, atau Rendah',
                  },
                  description: { type: Type.STRING },
                  recommendation: { type: Type.STRING },
                },
                required: [
                  'sopAId',
                  'sopADocNumber',
                  'sopATitle',
                  'sopBId',
                  'sopBDocNumber',
                  'sopBTitle',
                  'conflictType',
                  'severity',
                  'description',
                  'recommendation',
                ],
              },
            },
          },
          required: ['summary', 'conflicts'],
        },
      },
    });

    const parsed = parseAiJson<{
      summary?: string;
      conflicts?: SopConflictItem[];
    }>(response.text, 'pemindaian konflik SOP');

    if (parsed.summary) batchSummaries.push(parsed.summary);

    for (const c of parsed.conflicts || []) {
      if (!validIds.has(c.sopAId) || !validIds.has(c.sopBId) || c.sopAId === c.sopBId) continue;
      const pairKey = [c.sopAId, c.sopBId].sort().join('::');
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);
      allConflicts.push({
        ...c,
        conflictType: normalizeConflictType(c.conflictType),
        severity: normalizeSeverity(c.severity),
      });
    }
  }

  return {
    conflicts: allConflicts,
    summary:
      allConflicts.length === 0
        ? `Pemindaian selesai pada ${approvedSops.length} SOP Disetujui. Tidak ditemukan konflik aturan, duplikasi, atau tumpang tindih PIC.`
        : batchSummaries[0] ||
          `Ditemukan ${allConflicts.length} potensi konflik atau duplikasi pada ${approvedSops.length} SOP Disetujui.`,
  };
}

export async function checkPrePublishConflictsWithAi(params: {
  candidateSop: SopDocument;
  existingApprovedSops: SopDocument[];
}): Promise<PrePublishConflictReport> {
  const approvedOthers = params.existingApprovedSops.filter(
    (s) => s.status === 'Disetujui' && s.id !== params.candidateSop.id
  );

  if (approvedOthers.length === 0) {
    return {
      hasIssues: false,
      checkedCount: 0,
      summary: 'Belum ada SOP Disetujui lain untuk dibandingkan.',
      conflicts: [],
    };
  }

  const relatedSops = rankRelatedApprovedSops(params.candidateSop, approvedOthers, 14);
  const candidateDigest = buildSopDigest(params.candidateSop, 1200);
  const existingDigest = relatedSops
    .map((s) => buildSopDigest(s, 750))
    .join('\n\n--------------------\n\n');

  const ai = getAiClient();
  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: `KANDIDAT SOP YANG AKAN DISIMPAN / DISETUJUI:\n${candidateDigest}\n\n====================\n\nDAFTAR SOP DISETUJUI YANG SUDAH ADA:\n${existingDigest}\n\nTugasmu: Periksa apakah KANDIDAT SOP di atas bertentangan (plafon biaya, SLA, batas persetujuan, syarat), menduplikasi prosedur yang sudah ada, atau tumpang tindih kewenangan PIC dengan salah satu SOP Disetujui di atas.\nJika hanya pembaruan wajar tanpa bentrokan aturan nyata dengan SOP lain, kembalikan conflicts kosong [].`,
    config: {
      systemInstruction:
        'Kamu adalah penjaga kualitas tata kelola SOP pra-publikasi (Pre-Publish Guardrail) berbahasa Indonesia. Laporkan hanya konflik, duplikasi, atau tumpang tindih nyata dengan SOP existing yang ID-nya ada pada daftar.',
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          conflicts: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                existingSopId: { type: Type.STRING },
                existingDocNumber: { type: Type.STRING },
                existingTitle: { type: Type.STRING },
                conflictType: {
                  type: Type.STRING,
                  description: 'Konflik Aturan, Duplikasi, atau Tumpang Tindih PIC',
                },
                severity: {
                  type: Type.STRING,
                  description: 'Tinggi, Sedang, atau Rendah',
                },
                description: { type: Type.STRING },
                recommendation: { type: Type.STRING },
              },
              required: [
                'existingSopId',
                'existingDocNumber',
                'existingTitle',
                'conflictType',
                'severity',
                'description',
                'recommendation',
              ],
            },
          },
        },
        required: ['summary', 'conflicts'],
      },
    },
  });

  const parsed = parseAiJson<{
    summary?: string;
    conflicts?: PrePublishConflictItem[];
  }>(response.text, 'pengecekan konflik pra-persetujuan');

  const existingMap = new Map(relatedSops.map((s) => [s.id, s]));
  const docNumMap = new Map(relatedSops.map((s) => [s.docNumber.toLowerCase(), s]));

  const verified: PrePublishConflictItem[] = [];
  for (const item of parsed.conflicts || []) {
    const matched =
      existingMap.get(item.existingSopId) ||
      (item.existingDocNumber ? docNumMap.get(item.existingDocNumber.toLowerCase()) : undefined);
    if (!matched) continue;
    verified.push({
      existingSopId: matched.id,
      existingDocNumber: matched.docNumber,
      existingTitle: matched.title,
      conflictType: normalizeConflictType(item.conflictType),
      severity: normalizeSeverity(item.severity),
      description: item.description,
      recommendation: item.recommendation,
    });
  }

  return {
    hasIssues: verified.length > 0,
    checkedCount: relatedSops.length,
    summary:
      parsed.summary ||
      (verified.length > 0
        ? `Terdeteksi ${verified.length} potensi konflik atau duplikasi dengan SOP yang sudah aktif.`
        : `Lolos pemeriksaan pra-persetujuan terhadap ${relatedSops.length} SOP aktif terdekat.`),
    conflicts: verified,
  };
}

export async function analyzeModuleImageWithAi(params: {
  imageBase64: string;
  mimeType: string;
  moduleTitle: string;
  sopTitle?: string;
  fileName?: string;
}): Promise<{
  suggestedCaption: string;
  ocrText: string;
  matchesModule: boolean;
  mismatchWarning: string;
}> {
  const ai = getAiClient();
  const prompt = [
    `Judul SOP: ${params.sopTitle || '-'}`,
    `Nama Bagian / Modul Target: ${params.moduleTitle || '-'}`,
    params.fileName ? `Nama File Gambar: ${params.fileName}` : '',
    `Tugasmu:
1. Lakukan OCR & pembacaan visual terhadap tangkapan layar / foto modul terlampir.
2. Buat "suggestedCaption": keterangan singkat (maks. 12 kata) dalam Bahasa Indonesia yang menggambarkan layar/menu/form apa yang terlihat pada gambar (contoh: "Form Tambah User — Pengisian Kode, Nama, Password & Cabang").
3. Buat "ocrText": ringkasan teks penting di dalam gambar (judul jendela/window, path menu, nama tombol utama, nama kolom/field, atau label tabel) maksimal 450 karakter untuk keperluan indeks pencarian AI.
4. Periksa "matchesModule": true jika isi gambar sesuai atau relevan untuk mendukung "${params.moduleTitle}". Set false HANYA jika gambar jelas merupakan menu/modul yang salah atau sama sekali tidak nyambung dengan "${params.moduleTitle}".
5. Jika "matchesModule" false, tulis "mismatchWarning" singkat (1 kalimat) menjelaskan apa yang sebenarnya terlihat di gambar dibanding judul modul.`,
  ]
    .filter(Boolean)
    .join('\n');

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-flash-lite',
    contents: {
      parts: [
        { inlineData: { mimeType: params.mimeType, data: params.imageBase64 } },
        { text: prompt },
      ],
    },
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          suggestedCaption: { type: Type.STRING },
          ocrText: { type: Type.STRING },
          matchesModule: { type: Type.BOOLEAN },
          mismatchWarning: { type: Type.STRING },
        },
        required: ['suggestedCaption', 'ocrText', 'matchesModule', 'mismatchWarning'],
      },
    },
  });

  const parsed = parseAiJson<{
    suggestedCaption?: string;
    ocrText?: string;
    matchesModule?: boolean;
    mismatchWarning?: string;
  }>(response.text, 'analisis OCR gambar modul');

  return {
    suggestedCaption: (parsed.suggestedCaption || params.moduleTitle || 'Foto Modul').trim().slice(0, 220),
    ocrText: (parsed.ocrText || '').trim().slice(0, 480),
    matchesModule: parsed.matchesModule !== false,
    mismatchWarning:
      parsed.matchesModule === false
        ? (parsed.mismatchWarning || 'Gambar tampak menampilkan menu yang berbeda dari judul modul.').trim().slice(0, 240)
        : '',
  };
}

export async function reviseSopWithFeedbackAi(params: {
  sop: SopDocument;
  feedbackItems: {
    question: string;
    feedback: string;
    feedbackNote: string;
    userName?: string;
  }[];
}): Promise<SopFeedbackRevisionResult> {
  const ai = getAiClient();
  const feedbackLines = params.feedbackItems
    .map((f, i) => {
      const label = f.feedback === 'outdated' ? 'SOP Sudah Usang' : 'Tidak Akurat';
      return `${i + 1}. [${label}] Pertanyaan karyawan: "${f.question}"\n   Catatan pelapor (${f.userName || 'Karyawan'}): "${f.feedbackNote || 'Tidak ada catatan tambahan — tinjau relevansi & kejelasan langkah terkait.'}"`;
    })
    .join('\n\n');

  const existingSections = params.sop.sections
    .map((s, idx) => `Bagian ${idx + 1} (id: ${s.id}): ${s.title}\n${s.content}`)
    .join('\n\n---\n\n');

  const prompt = `DOKUMEN SOP SAAT INI (${params.sop.docNumber} v${params.sop.version}):
Judul: ${params.sop.title}
Divisi/Departemen: ${params.sop.divisionName} / ${params.sop.departmentName}
Tujuan: ${params.sop.purpose}
Ruang Lingkup: ${params.sop.scope}
Peran Terkait: ${(params.sop.relatedRoles || []).join(', ')}

ISI BAGIAN SAAT INI:
${existingSections}

====================

UMPAN BALIK / KELUHAN KARYAWAN YANG HARUS DITINDAKLANJUTI:
${feedbackLines}

Tugasmu:
1. Perbaiki/perbarui isi bagian SOP yang terdampak oleh umpan balik karyawan di atas secara presisi dalam Bahasa Indonesia formal.
2. Pertahankan bagian-bagian lain yang tidak bermasalah (pertahankan "id" bagian asal jika masih merupakan bagian yang sama agar foto modul tidak terlepas!).
3. Jika catatan karyawan menyebut nilai angka/aturan baru secara eksplisit (misal plafon atau SLA baru), gunakan nilai tersebut; jika catatan hanya menyebut bagian membingungkan atau belum lengkap tanpa angka baru, perjelas struktur langkah dan beri penanda "[PERLU VERIFIKASI ADMIN: ...]" pada bagian yang butuh konfirmasi kebijakan.
4. Isi "changeSummary" (maks 180 karakter) untuk catatan riwayat versi dan "revisionNotes" (ringkasan perubahan apa saja yang dilakukan AI).`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction:
        'Kamu adalah editor tata kelola SOP senior berbahasa Indonesia. Revisi SOP secara terstruktur berdasarkan masukan lapangan karyawan tanpa merusak bagian yang sudah benar.',
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          purpose: { type: Type.STRING },
          scope: { type: Type.STRING },
          relatedRoles: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          sections: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                title: { type: Type.STRING },
                content: { type: Type.STRING },
              },
              required: ['title', 'content'],
            },
          },
          changeSummary: { type: Type.STRING },
          revisionNotes: { type: Type.STRING },
        },
        required: [
          'title',
          'purpose',
          'scope',
          'relatedRoles',
          'sections',
          'changeSummary',
          'revisionNotes',
        ],
      },
    },
  });

  const parsed = parseAiJson<Partial<SopFeedbackRevisionResult>>(
    response.text,
    'revisi SOP dari umpan balik'
  );

  return {
    title: parsed.title || params.sop.title,
    purpose: parsed.purpose || params.sop.purpose,
    scope: parsed.scope || params.sop.scope,
    relatedRoles:
      Array.isArray(parsed.relatedRoles) && parsed.relatedRoles.length > 0
        ? parsed.relatedRoles
        : params.sop.relatedRoles,
    sections:
      Array.isArray(parsed.sections) && parsed.sections.length > 0
        ? parsed.sections
        : params.sop.sections.map((s) => ({ id: s.id, title: s.title, content: s.content })),
    changeSummary:
      (parsed.changeSummary || 'Revisi SOP berdasarkan umpan balik karyawan').slice(0, 480),
    revisionNotes:
      parsed.revisionNotes || 'Draf revisi telah disesuaikan berdasarkan umpan balik karyawan.',
  };
}

export async function conductHandoverInterview(params: {
  employeeRole: string;
  divisionName: string;
  topic: string;
  transcript: { speaker: 'ai' | 'user'; text: string }[];
}): Promise<{ nextQuestion: string; capturedKeyPoints: string[]; readyToDraft: boolean }> {
  const ai = getAiClient();
  const historyLines = params.transcript
    .map((t) => `${t.speaker === 'ai' ? 'Pewawancara AI' : 'Karyawan'}: ${t.text}`)
    .join('\n\n');

  const userTurns = params.transcript.filter((t) => t.speaker === 'user').length;

  const prompt = [
    `Peran / Jabatan Karyawan: ${params.employeeRole}`,
    `Divisi: ${params.divisionName}`,
    `Topik Proses / Tugas Kunci yang Diserahterimakan: ${params.topic}`,
    `Jumlah jawaban karyawan sejauh ini: ${userTurns}`,
    historyLines
      ? `TRANSKRIP WAWANCARA SEJAUH INI:\n${historyLines}`
      : 'Belum ada pertanyaan. Mulailah wawancara dengan pertanyaan pembuka pertama.',
  ].join('\n\n');

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-flash-lite',
    contents: prompt,
    config: {
      systemInstruction: `Kamu adalah pewawancara AI profesional untuk proses handover/offboarding karyawan yang akan resign atau mutasi agar pengetahuan kerjanya tidak hilang.
Tugasmu:
1. Ajukan SATU pertanyaan lanjutan yang singkat, spesifik, dan tajam dalam Bahasa Indonesia untuk menggali detail operasional yang sering terlupakan (urutan langkah nyata, batas nilai/SLA, aplikasi/formulir yang dipakai, PIC eksternal/vendor, pengecualian kasus darurat).
2. Jangan menanyakan hal yang sudah dijawab dengan jelas di transkrip.
3. Ekstrak poin-poin penting yang sudah berhasil terkumpul ke dalam "capturedKeyPoints".
4. Set "readyToDraft": true jika jumlah jawaban karyawan >= 3 dan alur utama, PIC, serta langkah kerja sudah cukup jelas untuk disusun menjadi SOP.`,
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          nextQuestion: { type: Type.STRING },
          capturedKeyPoints: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          readyToDraft: { type: Type.BOOLEAN },
        },
        required: ['nextQuestion', 'capturedKeyPoints', 'readyToDraft'],
      },
    },
  });

  const parsed = parseAiJson<{
    nextQuestion?: string;
    capturedKeyPoints?: string[];
    readyToDraft?: boolean;
  }>(response.text, 'wawancara handover');

  return {
    nextQuestion:
      parsed.nextQuestion ||
      'Bisa jelaskan langkah demi langkah proses tersebut dari awal hingga selesai, termasuk dokumen atau sistem yang digunakan?',
    capturedKeyPoints: Array.isArray(parsed.capturedKeyPoints) ? parsed.capturedKeyPoints : [],
    readyToDraft: Boolean(parsed.readyToDraft) || userTurns >= 3,
  };
}
