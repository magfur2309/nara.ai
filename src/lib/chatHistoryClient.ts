import { fetchApiJson } from './apiClient';
import { getFreshIdToken } from './firebase';
import type { ChatMessage, ChatSession, CitationSource, FeedbackType } from '../types/sop';

async function buildAuthHeaders(idToken?: string): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const freshFb = await getFreshIdToken(idToken);
  if (freshFb) {
    headers.Authorization = `Bearer ${freshFb}`;
  }
  return headers;
}

export async function fetchUserChatSessionsApi(idToken?: string): Promise<ChatSession[]> {
  const headers = await buildAuthHeaders(idToken);
  const res = await fetchApiJson<{ sessions?: ChatSession[] }>(
    '/api/chat-sessions',
    { method: 'GET', headers },
    'Gagal memuat riwayat percakapan.'
  );
  return Array.isArray(res.sessions) ? res.sessions : [];
}

export async function createUserChatSessionApi(
  title: string,
  idToken?: string
): Promise<ChatSession> {
  const headers = await buildAuthHeaders(idToken);
  const res = await fetchApiJson<{ session: ChatSession }>(
    '/api/chat-sessions',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ title }),
    },
    'Gagal membuat sesi percakapan baru.'
  );
  return res.session;
}

export async function renameUserChatSessionApi(
  sessionId: string,
  title: string,
  idToken?: string
): Promise<string> {
  const headers = await buildAuthHeaders(idToken);
  const res = await fetchApiJson<{ session: ChatSession }>(
    `/api/chat-sessions/${encodeURIComponent(sessionId)}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ title }),
    },
    'Gagal mengganti nama percakapan.'
  );
  return res.session.title;
}

export async function togglePinUserChatSessionApi(
  sessionId: string,
  isPinned: boolean,
  idToken?: string
): Promise<{ isPinned: boolean; pinnedAt: number }> {
  const headers = await buildAuthHeaders(idToken);
  const res = await fetchApiJson<{ session: ChatSession }>(
    `/api/chat-sessions/${encodeURIComponent(sessionId)}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ isPinned }),
    },
    'Gagal mengubah status pin percakapan.'
  );
  return {
    isPinned: Boolean(res.session.isPinned),
    pinnedAt: Number(res.session.pinnedAt || 0),
  };
}

export async function deleteUserChatSessionApi(
  sessionId: string,
  idToken?: string
): Promise<void> {
  const headers = await buildAuthHeaders(idToken);
  await fetchApiJson<{ deleted: boolean }>(
    `/api/chat-sessions/${encodeURIComponent(sessionId)}`,
    {
      method: 'DELETE',
      headers,
    },
    'Gagal menghapus riwayat percakapan.'
  );
}

export async function fetchUserChatMessagesApi(
  sessionId: string,
  idToken?: string
): Promise<ChatMessage[]> {
  const headers = await buildAuthHeaders(idToken);
  const res = await fetchApiJson<{ messages?: ChatMessage[] }>(
    `/api/chat-sessions/${encodeURIComponent(sessionId)}/messages`,
    { method: 'GET', headers },
    'Gagal memuat pesan percakapan.'
  );
  return Array.isArray(res.messages) ? res.messages : [];
}

export async function saveUserChatMessageApi(
  params: {
    sessionId: string;
    role: 'user' | 'assistant';
    content: string;
    citations?: CitationSource[];
    hasConflict?: boolean;
    answered?: boolean;
    suggestedContact?: string;
    logId?: string;
  },
  idToken?: string
): Promise<ChatMessage> {
  const headers = await buildAuthHeaders(idToken);
  const res = await fetchApiJson<{ message: ChatMessage }>(
    `/api/chat-sessions/${encodeURIComponent(params.sessionId)}/messages`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        role: params.role,
        content: params.content,
        citations: params.citations,
        hasConflict: params.hasConflict,
        answered: params.answered,
        suggestedContact: params.suggestedContact,
        logId: params.logId,
      }),
    },
    'Gagal menyimpan pesan percakapan.'
  );
  return res.message;
}

export async function updateUserChatMessageFeedbackApi(
  params: {
    sessionId: string;
    messageId: string;
    feedback: FeedbackType;
    feedbackNote?: string;
  },
  idToken?: string
): Promise<void> {
  const headers = await buildAuthHeaders(idToken);
  await fetchApiJson<{ message: ChatMessage }>(
    `/api/chat-sessions/${encodeURIComponent(params.sessionId)}/messages/${encodeURIComponent(params.messageId)}/feedback`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        feedback: params.feedback,
        feedbackNote: params.feedbackNote || '',
      }),
    },
    'Gagal menyimpan umpan balik.'
  );
}
