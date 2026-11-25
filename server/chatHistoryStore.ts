import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ChatMessage, ChatSession, CitationSource, FeedbackType } from '../src/types/sop.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');
const STORE_PATH = path.join(DATA_DIR, 'chat-history-store.json');

export interface StoredChatSession extends ChatSession {
  createdAt: number;
  updatedAt: number;
}

export interface StoredChatMessage extends ChatMessage {
  createdAt: number;
}

interface ChatHistoryStoreData {
  version: number;
  sessions: StoredChatSession[];
  messagesBySessionId: Record<string, StoredChatMessage[]>;
}

const VALID_FEEDBACK = new Set<FeedbackType>(['none', 'helpful', 'inaccurate', 'outdated']);
const MAX_SESSIONS_PER_USER = 100;
const MAX_MESSAGES_PER_SESSION = 300;

let cachedStore: ChatHistoryStoreData | null = null;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function makeSafeServerId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
}

function createEmptyStore(): ChatHistoryStoreData {
  return {
    version: 1,
    sessions: [],
    messagesBySessionId: {},
  };
}

function loadStore(): ChatHistoryStoreData {
  if (cachedStore) return cachedStore;
  ensureDataDir();
  if (!fs.existsSync(STORE_PATH)) {
    cachedStore = createEmptyStore();
    return cachedStore;
  }
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<ChatHistoryStoreData>;
    cachedStore = {
      version: typeof parsed.version === 'number' ? parsed.version : 1,
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      messagesBySessionId:
        parsed.messagesBySessionId && typeof parsed.messagesBySessionId === 'object'
          ? parsed.messagesBySessionId
          : {},
    };
    return cachedStore;
  } catch (err) {
    console.error('[chatHistoryStore] Failed to parse store, starting fresh:', err);
    cachedStore = createEmptyStore();
    return cachedStore;
  }
}

function persistStore(store: ChatHistoryStoreData): void {
  ensureDataDir();
  const tmpPath = `${STORE_PATH}.tmp.${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmpPath, STORE_PATH);
}

function sortSessions(list: StoredChatSession[]): StoredChatSession[] {
  return [...list].sort((a, b) => {
    const pinDiff = Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned));
    if (pinDiff !== 0) return pinDiff;
    if (a.isPinned && b.isPinned) {
      const pinTimeDiff = (b.pinnedAt || 0) - (a.pinnedAt || 0);
      if (pinTimeDiff !== 0) return pinTimeDiff;
    }
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}

function sanitizeCitations(input: unknown): CitationSource[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .slice(0, 12)
    .map((item) => ({
      sopId: String(item.sopId ?? '').slice(0, 128),
      docNumber: String(item.docNumber ?? '').slice(0, 80),
      title: String(item.title ?? '').slice(0, 240),
      version: Number.isFinite(Number(item.version)) ? Number(item.version) : 1,
      divisionName: String(item.divisionName ?? '').slice(0, 120),
      sectionTitle: String(item.sectionTitle ?? '').slice(0, 240),
      excerpt: String(item.excerpt ?? '').slice(0, 1200),
      score: Number.isFinite(Number(item.score)) ? Number(item.score) : 0,
    }));
}

export function listUserChatSessions(ownerUserId: string, limit = 50): StoredChatSession[] {
  const safeOwner = String(ownerUserId || '').trim();
  if (!safeOwner) return [];
  const store = loadStore();
  const mine = store.sessions.filter((s) => s.userId === safeOwner);
  return sortSessions(mine).slice(0, Math.min(Math.max(limit, 1), MAX_SESSIONS_PER_USER));
}

export function createUserChatSession(params: {
  ownerUserId: string;
  userName: string;
  divisionId: string;
  title: string;
}): StoredChatSession {
  const store = loadStore();
  const now = Date.now();
  const title = String(params.title || 'Percakapan Baru').trim().slice(0, 200) || 'Percakapan Baru';
  const session: StoredChatSession = {
    id: makeSafeServerId('chat'),
    userId: params.ownerUserId,
    userName: String(params.userName || 'User').trim().slice(0, 120),
    divisionId: String(params.divisionId || '').trim().slice(0, 128),
    title,
    isPinned: false,
    pinnedAt: 0,
    createdAt: now,
    updatedAt: now,
  };

  store.sessions.push(session);
  store.messagesBySessionId[session.id] = [];

  // Trim oldest unpinned sessions if user exceeds cap
  const userSessions = sortSessions(store.sessions.filter((s) => s.userId === params.ownerUserId));
  if (userSessions.length > MAX_SESSIONS_PER_USER) {
    const excess = userSessions.slice(MAX_SESSIONS_PER_USER);
    const excessIds = new Set(excess.map((s) => s.id));
    store.sessions = store.sessions.filter((s) => !excessIds.has(s.id));
    for (const id of excessIds) {
      delete store.messagesBySessionId[id];
    }
  }

  persistStore(store);
  return session;
}

export function updateUserChatSession(
  ownerUserId: string,
  sessionId: string,
  patch: { title?: string; isPinned?: boolean }
): { session: StoredChatSession } | { error: string; status: number } {
  const store = loadStore();
  const session = store.sessions.find((s) => s.id === sessionId);
  if (!session) {
    return { error: 'Riwayat percakapan tidak ditemukan.', status: 404 };
  }
  if (session.userId !== ownerUserId) {
    return { error: 'Anda tidak memiliki akses ke riwayat percakapan ini.', status: 403 };
  }

  if (typeof patch.title === 'string') {
    const trimmed = patch.title.trim().slice(0, 200);
    if (!trimmed) {
      return { error: 'Judul percakapan tidak boleh kosong.', status: 400 };
    }
    session.title = trimmed;
  }

  if (typeof patch.isPinned === 'boolean') {
    session.isPinned = patch.isPinned;
    session.pinnedAt = patch.isPinned ? Date.now() : 0;
  }

  session.updatedAt = Date.now();
  persistStore(store);
  return { session };
}

export function deleteUserChatSession(
  ownerUserId: string,
  sessionId: string
): { deleted: true } | { error: string; status: number } {
  const store = loadStore();
  const idx = store.sessions.findIndex((s) => s.id === sessionId);
  if (idx < 0) {
    return { error: 'Riwayat percakapan tidak ditemukan.', status: 404 };
  }
  if (store.sessions[idx].userId !== ownerUserId) {
    return { error: 'Anda tidak memiliki akses ke riwayat percakapan ini.', status: 403 };
  }

  store.sessions.splice(idx, 1);
  delete store.messagesBySessionId[sessionId];
  persistStore(store);
  return { deleted: true };
}

export function listUserChatMessages(
  ownerUserId: string,
  sessionId: string
): { messages: StoredChatMessage[] } | { error: string; status: number } {
  const store = loadStore();
  const session = store.sessions.find((s) => s.id === sessionId);
  if (!session) {
    return { error: 'Riwayat percakapan tidak ditemukan.', status: 404 };
  }
  if (session.userId !== ownerUserId) {
    return { error: 'Anda tidak memiliki akses ke riwayat percakapan ini.', status: 403 };
  }

  const messages = (store.messagesBySessionId[sessionId] || [])
    .filter((m) => m.userId === ownerUserId)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  return { messages };
}

export interface AppendChatMessageInput {
  role: 'user' | 'assistant';
  content: string;
  citations?: CitationSource[];
  hasConflict?: boolean;
  answered?: boolean;
  suggestedContact?: string;
  logId?: string;
}

export function appendUserChatMessage(
  ownerUserId: string,
  sessionId: string,
  input: AppendChatMessageInput
): { message: StoredChatMessage } | { error: string; status: number } {
  const store = loadStore();
  const session = store.sessions.find((s) => s.id === sessionId);
  if (!session) {
    return { error: 'Riwayat percakapan tidak ditemukan.', status: 404 };
  }
  if (session.userId !== ownerUserId) {
    return { error: 'Anda tidak memiliki akses ke riwayat percakapan ini.', status: 403 };
  }

  const role = input.role === 'assistant' ? 'assistant' : 'user';
  const content = String(input.content || '').slice(0, 24000);
  if (!content.trim()) {
    return { error: 'Isi pesan tidak boleh kosong.', status: 400 };
  }

  const now = Date.now();
  const message: StoredChatMessage = {
    id: makeSafeServerId('msg'),
    sessionId,
    userId: ownerUserId,
    role,
    content,
    citations: sanitizeCitations(input.citations),
    hasConflict: Boolean(input.hasConflict),
    answered: input.answered ?? true,
    suggestedContact: String(input.suggestedContact || '').slice(0, 300),
    feedback: 'none',
    feedbackNote: '',
    logId: String(input.logId || '').slice(0, 128),
    createdAt: now,
  };

  const list = store.messagesBySessionId[sessionId] || [];
  list.push(message);
  if (list.length > MAX_MESSAGES_PER_SESSION) {
    list.splice(0, list.length - MAX_MESSAGES_PER_SESSION);
  }
  store.messagesBySessionId[sessionId] = list;
  session.updatedAt = now;
  persistStore(store);

  return { message };
}

export function updateUserChatMessageFeedback(
  ownerUserId: string,
  sessionId: string,
  messageId: string,
  feedback: FeedbackType,
  feedbackNote = ''
): { message: StoredChatMessage } | { error: string; status: number } {
  const store = loadStore();
  const session = store.sessions.find((s) => s.id === sessionId);
  if (!session) {
    return { error: 'Riwayat percakapan tidak ditemukan.', status: 404 };
  }
  if (session.userId !== ownerUserId) {
    return { error: 'Anda tidak memiliki akses ke riwayat percakapan ini.', status: 403 };
  }

  if (!VALID_FEEDBACK.has(feedback)) {
    return { error: 'Status umpan balik tidak valid.', status: 400 };
  }

  const list = store.messagesBySessionId[sessionId] || [];
  const message = list.find((m) => m.id === messageId && m.userId === ownerUserId);
  if (!message) {
    return { error: 'Pesan tidak ditemukan.', status: 404 };
  }

  message.feedback = feedback;
  message.feedbackNote = String(feedbackNote || '').slice(0, 500);
  persistStore(store);
  return { message };
}
