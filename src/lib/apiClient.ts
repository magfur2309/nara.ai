import { getRbacToken } from './rbacClient';

export interface FetchApiJsonOptions {
  onWarmup?: (message: string) => void;
}

function withRbacAuthHeaders(init: RequestInit): RequestInit {
  const rbacToken = getRbacToken();
  if (!rbacToken) return init;
  const headers = new Headers(init.headers);
  if (!headers.has('X-Rbac-Token')) {
    headers.set('X-Rbac-Token', rbacToken);
  }
  const existingAuth = headers.get('Authorization') || '';
  if (!existingAuth || existingAuth === 'Bearer ' || existingAuth === 'Bearer null' || existingAuth === 'Bearer undefined') {
    headers.set('Authorization', `Bearer ${rbacToken}`);
  }
  return { ...init, headers };
}

let activeHealthWaitPromise: Promise<boolean> | null = null;

/**
 * Polls /api/health until the Express backend responds with valid JSON
 * (handling AI Studio / Cloud Run cold-start "Starting Server..." HTML interstitials).
 */
export async function waitForBackendReady(
  maxWaitMs = 32_000,
  signal?: AbortSignal | null
): Promise<boolean> {
  if (activeHealthWaitPromise) {
    return activeHealthWaitPromise;
  }

  const run = async (): Promise<boolean> => {
    const deadline = Date.now() + maxWaitMs;
    let attempt = 0;
    while (Date.now() < deadline) {
      if (signal?.aborted) return false;
      try {
        const res = await fetch(`/api/health?_t=${Date.now()}`, {
          method: 'GET',
          cache: 'no-store',
          signal: signal ?? undefined,
        });
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (res.ok && ct.includes('application/json')) {
          const text = await res.text();
          if (text.trim().startsWith('{')) {
            return true;
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return false;
        }
      }
      attempt += 1;
      const delay = Math.min(2500, 900 + attempt * 350);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    return false;
  };

  activeHealthWaitPromise = run().finally(() => {
    activeHealthWaitPromise = null;
  });
  return activeHealthWaitPromise;
}

export async function fetchApiJson<T>(
  url: string,
  init: RequestInit,
  fallbackError = 'Terjadi kesalahan saat menghubungi server.',
  options?: FetchApiJsonOptions
): Promise<T> {
  const maxAttempts = 5;
  const retryDelaysMs = [1000, 1800, 2500, 3000];
  let waitedForBoot = false;
  const authedInit = withRbacAuthHeaders(init);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let resp: Response;
    try {
      resp = await fetch(url, authedInit);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt] ?? 2500));
        continue;
      }
      const rawMsg = err instanceof Error ? err.message : '';
      const isNetworkFail =
        !rawMsg ||
        rawMsg.toLowerCase().includes('failed to fetch') ||
        rawMsg.toLowerCase().includes('networkerror') ||
        rawMsg.toLowerCase().includes('load failed');
      throw new Error(
        isNetworkFail
          ? 'Gagal terhubung ke server backend (koneksi terputus atau server sedang memulai ulang). Tunggu beberapa detik lalu coba klik lagi.'
          : `${fallbackError} (${rawMsg})`
      );
    }

    const contentType = (resp.headers.get('content-type') || '').toLowerCase();
    const rawText = await resp.text();
    const trimmed = rawText.trim();
    const lowerTrimmed = trimmed.toLowerCase();
    const looksLikeHtml =
      contentType.includes('text/html') ||
      lowerTrimmed.startsWith('<!doctype') ||
      lowerTrimmed.startsWith('<html');

    const isStartingServerPage =
      looksLikeHtml && /starting\s+server|warming\s+up|please\s+wait/i.test(trimmed);

    const isJsonPayload = trimmed.startsWith('{') || trimmed.startsWith('[');
    const isTransientWarmup =
      looksLikeHtml ||
      ((resp.status === 502 || resp.status === 503 || resp.status === 504) && !isJsonPayload);

    if (isTransientWarmup && attempt < maxAttempts - 1) {
      if ((isStartingServerPage || !waitedForBoot) && !init.signal?.aborted) {
        waitedForBoot = true;
        options?.onWarmup?.(
          'Server aplikasi sedang memulai ulang (Starting Server...), menunggu otomatis sampai siap...'
        );
        const ready = await waitForBackendReady(32_000, init.signal);
        if (ready) {
          continue;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt] ?? 2500));
      continue;
    }

    if (looksLikeHtml) {
      const titleMatch = trimmed.match(/<title[^>]*>([^<]{1,80})<\/title>/i);
      const htmlTitle = titleMatch ? ` — "${titleMatch[1].trim()}"` : '';
      if (isStartingServerPage) {
        throw new Error(
          `Server backend aplikasi masih dalam proses booting (${htmlTitle.replace(/^ — /, '') || 'Starting Server...'}). Ini bukan masalah Bridge MySQL — tunggu beberapa detik lalu klik "Coba Muat Ulang".`
        );
      }
      throw new Error(
        `Server API (${url.split('?')[0]}) mengembalikan HTML (HTTP ${resp.status}${htmlTitle}), bukan JSON. Pastikan halaman sudah di-refresh (Ctrl+F5) atau tunggu beberapa detik jika server baru saja dimulai ulang.`
      );
    }

    let parsed: unknown = null;
    if (trimmed.length > 0) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        if (!resp.ok) {
          throw new Error(`${fallbackError} (HTTP ${resp.status})`);
        }
        throw new Error('Respons server bukan format JSON yang valid. Silakan coba lagi.');
      }
    }

    if (!resp.ok) {
      const errMsg =
        parsed &&
        typeof parsed === 'object' &&
        'error' in parsed &&
        typeof (parsed as { error?: unknown }).error === 'string'
          ? (parsed as { error: string }).error
          : fallbackError;
      throw new Error(errMsg);
    }

    return (parsed ?? {}) as T;
  }

  throw new Error(fallbackError);
}

export async function streamApiSse<TDone>(
  url: string,
  init: RequestInit,
  options: {
    onDelta: (textChunk: string) => void;
    onStatus?: (statusText: string) => void;
    fallbackError?: string;
  }
): Promise<TDone> {
  const {
    onDelta,
    onStatus,
    fallbackError = 'Terjadi kesalahan saat menerima aliran jawaban AI.',
  } = options;
  const maxAttempts = 4;
  const retryDelaysMs = [1000, 1800, 2500];
  let waitedForBoot = false;
  const authedInit = withRbacAuthHeaders(init);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let resp: Response;
    try {
      resp = await fetch(url, authedInit);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err;
      }
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt] ?? 1500));
        continue;
      }
      const rawMsg = err instanceof Error ? err.message : '';
      const isNetworkFail =
        !rawMsg ||
        rawMsg.toLowerCase().includes('failed to fetch') ||
        rawMsg.toLowerCase().includes('networkerror') ||
        rawMsg.toLowerCase().includes('load failed');
      throw new Error(
        isNetworkFail
          ? 'Gagal terhubung ke server backend (koneksi terputus atau server sedang memulai ulang). Tunggu beberapa detik lalu coba klik lagi.'
          : `${fallbackError} (${rawMsg})`
      );
    }

    const contentType = (resp.headers.get('content-type') || '').toLowerCase();
    const isTransient =
      contentType.includes('text/html') ||
      resp.status === 502 ||
      resp.status === 503 ||
      resp.status === 504;

    if (isTransient && attempt < maxAttempts - 1) {
      if (!waitedForBoot && !init.signal?.aborted) {
        waitedForBoot = true;
        const ready = await waitForBackendReady(30_000, init.signal);
        if (ready) continue;
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt] ?? 1500));
      continue;
    }

    if (!resp.ok) {
      const rawText = await resp.text();
      let errMessage = `${fallbackError} (HTTP ${resp.status})`;
      try {
        const parsed = JSON.parse(rawText) as { error?: string };
        if (parsed?.error) errMessage = parsed.error;
      } catch {
        // Keep default status error
      }
      throw new Error(errMessage);
    }

    // Fallback if server returned JSON instead of event-stream
    if (!contentType.includes('text/event-stream') || !resp.body) {
      const json = (await resp.json()) as TDone;
      return json;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let donePayload: TDone | null = null;

    const processEventBlock = (block: string) => {
      const lines = block.split(/\r?\n/);
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const jsonStr = line.slice(5).trim();
        if (!jsonStr) continue;
        const evt = JSON.parse(jsonStr) as {
          type?: string;
          text?: string;
          result?: TDone;
          error?: string;
        };
        if (evt.type === 'delta' && typeof evt.text === 'string') {
          onDelta(evt.text);
        } else if (evt.type === 'status' && typeof evt.text === 'string') {
          onStatus?.(evt.text);
        } else if (evt.type === 'done' && evt.result !== undefined) {
          donePayload = evt.result;
        } else if (evt.type === 'error') {
          throw new Error(evt.error || fallbackError);
        }
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: true });
        let sepIndex = buffer.indexOf('\n\n');
        while (sepIndex !== -1) {
          const block = buffer.slice(0, sepIndex).trim();
          buffer = buffer.slice(sepIndex + 2);
          if (block) processEventBlock(block);
          sepIndex = buffer.indexOf('\n\n');
        }
      }
      if (done) break;
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      processEventBlock(buffer.trim());
    }

    if (donePayload === null) {
      throw new Error('Aliran jawaban AI terputus sebelum selesai. Silakan coba lagi.');
    }

    return donePayload;
  }

  throw new Error(fallbackError);
}
