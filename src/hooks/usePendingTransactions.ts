import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PENDING_TX_POLL_INTERVAL_MS,
  type PendingTransactionsSummaryResponse,
} from '../config/pendingTransactionRules';
import { fetchApiJson } from '../lib/apiClient';
import { getFreshIdToken } from '../lib/firebase';

export interface UsePendingTransactionsResult {
  summary: PendingTransactionsSummaryResponse | null;
  loading: boolean;
  initialLoaded: boolean;
  error: string | null;
  refresh: (bypassCache?: boolean) => Promise<void>;
}

/**
 * Loads the server-filtered pending ERP transactions summary on login/mount,
 * polls every PENDING_TX_POLL_INTERVAL_MS (60s) ONLY while the browser tab is visible,
 * pauses polling when the tab is hidden, and refreshes immediately when the tab becomes visible again.
 * All failures are non-blocking so the rest of the ERP continues working normally.
 */
export function usePendingTransactions(params: {
  enabled: boolean;
  idToken: string;
  userUid?: string;
  pollIntervalMs?: number;
}): UsePendingTransactionsResult {
  const { enabled, idToken, userUid, pollIntervalMs = PENDING_TX_POLL_INTERVAL_MS } = params;
  const [summary, setSummary] = useState<PendingTransactionsSummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Reset state cleanly on sign-out or user switch
  useEffect(() => {
    if (!enabled || !userUid) {
      setSummary(null);
      setInitialLoaded(false);
      setError(null);
      setLoading(false);
    }
  }, [enabled, userUid]);

  const fetchSummary = useCallback(
    async (bypassCache = false) => {
      if (!enabled || !idToken || inFlightRef.current) return;
      inFlightRef.current = true;
      setLoading(true);
      try {
        const freshToken = await getFreshIdToken(idToken);
        const qs = bypassCache ? '?refresh=1' : '';
        const data = await fetchApiJson<PendingTransactionsSummaryResponse>(
          `/api/erp/pending-notifications${qs}`,
          {
            method: 'GET',
            cache: 'no-store',
            headers: {
              Authorization: `Bearer ${freshToken}`,
            },
          },
          'Gagal memuat ringkasan transaksi tertunda.'
        );
        if (mountedRef.current) {
          setSummary(data);
          setError(null);
          setInitialLoaded(true);
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(
            err instanceof Error ? err.message : 'Gagal memuat ringkasan transaksi tertunda.'
          );
          setInitialLoaded(true);
        }
      } finally {
        inFlightRef.current = false;
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    },
    [enabled, idToken]
  );

  // Initial load + visibility-aware polling
  useEffect(() => {
    if (!enabled || !idToken) return;

    let timerId: number | null = null;

    const clearPoll = () => {
      if (timerId !== null) {
        window.clearInterval(timerId);
        timerId = null;
      }
    };

    const startPoll = () => {
      clearPoll();
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      timerId = window.setInterval(() => {
        if (typeof document === 'undefined' || document.visibilityState === 'visible') {
          void fetchSummary(false);
        }
      }, pollIntervalMs);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void fetchSummary(false);
        startPoll();
      } else {
        clearPoll();
      }
    };

    void fetchSummary(false);
    startPoll();

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      clearPoll();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, idToken, pollIntervalMs, fetchSummary]);

  return {
    summary,
    loading,
    initialLoaded,
    error,
    refresh: fetchSummary,
  };
}
