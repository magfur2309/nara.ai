import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Globe,
  SlidersHorizontal,
} from 'lucide-react';
import { useI18n } from '../lib/i18n';

export const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 25, 50, 100, 200, 500] as const;

const STORAGE_KEY_PREFS = 'erp_table_paging_prefs_v1';
const GLOBAL_PREFS_EVENT = 'erp-table-paging-prefs-updated';

interface PagingPrefEntry {
  pageSize: number;
  limitEnabled: boolean;
}

interface StoredPagingPrefs {
  global?: PagingPrefEntry;
  tables?: Record<string, PagingPrefEntry>;
}

function clampPageSize(raw: number, fallback = 20): number {
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(1, Math.min(5000, Math.round(raw)));
}

function readStoredPrefs(): StoredPagingPrefs {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_PREFS);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredPagingPrefs;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStoredPrefs(next: StoredPagingPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY_PREFS, JSON.stringify(next));
  } catch {
    // Ignore storage quota / private mode issues
  }
}

function resolveInitialPref(storageKey?: string, defaultPageSize = 20): PagingPrefEntry {
  const prefs = readStoredPrefs();
  if (storageKey && prefs.tables?.[storageKey]) {
    const t = prefs.tables[storageKey];
    return {
      pageSize: clampPageSize(t.pageSize, defaultPageSize),
      limitEnabled: typeof t.limitEnabled === 'boolean' ? t.limitEnabled : true,
    };
  }
  if (prefs.global) {
    return {
      pageSize: clampPageSize(prefs.global.pageSize, defaultPageSize),
      limitEnabled: typeof prefs.global.limitEnabled === 'boolean' ? prefs.global.limitEnabled : true,
    };
  }
  return {
    pageSize: clampPageSize(defaultPageSize, 20),
    limitEnabled: true,
  };
}

export function applyGlobalTablePagingPreference(pref: PagingPrefEntry): void {
  const sanitized: PagingPrefEntry = {
    pageSize: clampPageSize(pref.pageSize, 20),
    limitEnabled: Boolean(pref.limitEnabled),
  };
  writeStoredPrefs({
    global: sanitized,
    tables: {},
  });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<PagingPrefEntry>(GLOBAL_PREFS_EVENT, { detail: sanitized }));
  }
}

export interface TablePaginationBarProps {
  page: number;
  pageSize: number;
  totalItems: number;
  limitEnabled?: boolean;
  onPageChange: (nextPage: number) => void;
  onPageSizeChange?: (nextPageSize: number) => void;
  onLimitEnabledChange?: (enabled: boolean) => void;
  onApplyToAllTables?: () => void;
  pageSizeOptions?: readonly number[];
  compact?: boolean;
  className?: string;
}

/**
 * Reusable hook that adds Navicat-style customizable pagination (Limit Records toggle,
 * editable records per page, quick presets, first/prev/jump/next/last) to any array.
 */
export function useTablePagination<T>(
  items: readonly T[],
  options?: {
    defaultPageSize?: number;
    storageKey?: string;
  }
) {
  const defaultPageSize = options?.defaultPageSize ?? 20;
  const storageKey = options?.storageKey;

  const initial = useMemo(
    () => resolveInitialPref(storageKey, defaultPageSize),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storageKey]
  );

  const [page, setPageState] = useState<number>(1);
  const [pageSize, setPageSizeState] = useState<number>(initial.pageSize);
  const [limitEnabled, setLimitEnabledState] = useState<boolean>(initial.limitEnabled);

  const persistLocalPref = useCallback(
    (nextSize: number, nextEnabled: boolean) => {
      if (!storageKey) return;
      const current = readStoredPrefs();
      writeStoredPrefs({
        ...current,
        tables: {
          ...(current.tables || {}),
          [storageKey]: {
            pageSize: clampPageSize(nextSize, defaultPageSize),
            limitEnabled: nextEnabled,
          },
        },
      });
    },
    [defaultPageSize, storageKey]
  );

  // Listen for "Apply to all tables" global broadcast
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<PagingPrefEntry>).detail;
      if (!detail) return;
      setPageSizeState(clampPageSize(detail.pageSize, defaultPageSize));
      setLimitEnabledState(Boolean(detail.limitEnabled));
      setPageState(1);
    };
    window.addEventListener(GLOBAL_PREFS_EVENT, handler);
    return () => window.removeEventListener(GLOBAL_PREFS_EVENT, handler);
  }, [defaultPageSize]);

  const totalItems = items.length;
  const effectivePageSize = limitEnabled ? clampPageSize(pageSize, defaultPageSize) : Math.max(1, totalItems);
  const totalPages = limitEnabled ? Math.max(1, Math.ceil(totalItems / effectivePageSize)) : 1;
  const safePage = Math.max(1, Math.min(page, totalPages));

  // Keep page within valid range when data shrinks
  useEffect(() => {
    if (page !== safePage) {
      setPageState(safePage);
    }
  }, [page, safePage]);

  const setPage = useCallback(
    (next: number) => {
      const clamped = Math.max(1, Math.min(totalPages, Math.round(next || 1)));
      setPageState(clamped);
    },
    [totalPages]
  );

  const setPageSize = useCallback(
    (nextSize: number) => {
      const clamped = clampPageSize(nextSize, defaultPageSize);
      setPageSizeState(clamped);
      setPageState(1);
      persistLocalPref(clamped, limitEnabled);
    },
    [defaultPageSize, limitEnabled, persistLocalPref]
  );

  const setLimitEnabled = useCallback(
    (nextEnabled: boolean) => {
      setLimitEnabledState(nextEnabled);
      setPageState(1);
      persistLocalPref(pageSize, nextEnabled);
    },
    [pageSize, persistLocalPref]
  );

  const applyToAllTables = useCallback(() => {
    applyGlobalTablePagingPreference({
      pageSize: clampPageSize(pageSize, defaultPageSize),
      limitEnabled,
    });
  }, [defaultPageSize, limitEnabled, pageSize]);

  const resetPage = useCallback(() => {
    setPageState(1);
  }, []);

  const paginatedItems = useMemo(() => {
    if (!limitEnabled) return items as T[];
    const start = (safePage - 1) * effectivePageSize;
    return items.slice(start, start + effectivePageSize);
  }, [effectivePageSize, items, limitEnabled, safePage]);

  const paginationProps: TablePaginationBarProps = {
    page: safePage,
    pageSize: clampPageSize(pageSize, defaultPageSize),
    totalItems,
    limitEnabled,
    onPageChange: setPage,
    onPageSizeChange: setPageSize,
    onLimitEnabledChange: setLimitEnabled,
    onApplyToAllTables: applyToAllTables,
  };

  return {
    page: safePage,
    setPage,
    pageSize: clampPageSize(pageSize, defaultPageSize),
    setPageSize,
    limitEnabled,
    setLimitEnabled,
    totalItems,
    totalPages,
    paginatedItems,
    resetPage,
    applyToAllTables,
    paginationProps,
  };
}

/**
 * Navicat-inspired unified table pagination footer:
 * - Record range & page summary ("Baris 1–20 dari 84 · Hal. 1 / 5")
 * - [✓] Limit Records + editable numeric input + quick preset dropdown & settings popover
 * - Full navigation: First, Prev, direct page jump input, Next, Last
 */
export const TablePaginationBar: React.FC<TablePaginationBarProps> = ({
  page,
  pageSize,
  totalItems,
  limitEnabled = true,
  onPageChange,
  onPageSizeChange,
  onLimitEnabledChange,
  onApplyToAllTables,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  compact = false,
  className = '',
}) => {
  const { t, formatNumber } = useI18n();
  const [sizeInput, setSizeInput] = useState<string>(String(pageSize));
  const [pageInput, setPageInput] = useState<string>(String(page));
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [menuCoords, setMenuCoords] = useState<{ top: number; left: number; openAbove: boolean }>({
    top: 0,
    left: 0,
    openAbove: true,
  });
  const [savedGlobalToast, setSavedGlobalToast] = useState<boolean>(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const safeSize = clampPageSize(pageSize, 20);
  const totalPages = limitEnabled ? Math.max(1, Math.ceil(totalItems / safeSize)) : 1;
  const safePage = Math.max(1, Math.min(page, totalPages));

  useEffect(() => {
    setSizeInput(String(safeSize));
  }, [safeSize]);

  useEffect(() => {
    setPageInput(String(safePage));
  }, [safePage]);

  const updatePopoverPosition = useCallback(() => {
    if (!anchorRef.current || typeof window === 'undefined') return;
    const rect = anchorRef.current.getBoundingClientRect();
    const popoverWidth = 232;
    const estimatedHeight = 165;
    const openAbove = rect.top > estimatedHeight + 16;
    const left = Math.max(
      12,
      Math.min(window.innerWidth - popoverWidth - 12, rect.right - popoverWidth)
    );
    const top = openAbove ? rect.top - 8 : rect.bottom + 8;
    setMenuCoords({ top, left, openAbove });
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    updatePopoverPosition();
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        anchorRef.current &&
        !anchorRef.current.contains(target) &&
        (!popoverRef.current || !popoverRef.current.contains(target))
      ) {
        setMenuOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    const handleReposition = () => updatePopoverPosition();
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [menuOpen, updatePopoverPosition]);

  if (totalItems <= 0) return null;

  const startIdx = limitEnabled ? (safePage - 1) * safeSize + 1 : 1;
  const endIdx = limitEnabled ? Math.min(totalItems, safePage * safeSize) : totalItems;
  const canCustomizeSize = typeof onPageSizeChange === 'function';
  const canToggleLimit = typeof onLimitEnabledChange === 'function';

  const commitSizeInput = () => {
    if (!onPageSizeChange) return;
    const parsed = Number.parseInt(sizeInput.trim(), 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      setSizeInput(String(safeSize));
      return;
    }
    const clamped = clampPageSize(parsed, safeSize);
    setSizeInput(String(clamped));
    if (clamped !== safeSize) {
      onPageSizeChange(clamped);
    }
    if (!limitEnabled && onLimitEnabledChange) {
      onLimitEnabledChange(true);
    }
  };

  const commitPageInput = () => {
    const parsed = Number.parseInt(pageInput.trim(), 10);
    if (!Number.isFinite(parsed)) {
      setPageInput(String(safePage));
      return;
    }
    const clamped = Math.max(1, Math.min(totalPages, parsed));
    setPageInput(String(clamped));
    if (clamped !== safePage) {
      onPageChange(clamped);
    }
  };

  const handleSelectPreset = (presetVal: number) => {
    if (onPageSizeChange) onPageSizeChange(presetVal);
    if (!limitEnabled && onLimitEnabledChange) onLimitEnabledChange(true);
    setMenuOpen(false);
  };

  const handleShowAllOption = () => {
    if (onLimitEnabledChange) {
      onLimitEnabledChange(false);
    } else if (onPageSizeChange) {
      onPageSizeChange(Math.max(totalItems, 500));
    }
    setMenuOpen(false);
  };

  const handleApplyGlobal = () => {
    if (onApplyToAllTables) {
      onApplyToAllTables();
    } else {
      applyGlobalTablePagingPreference({
        pageSize: safeSize,
        limitEnabled,
      });
    }
    setSavedGlobalToast(true);
    window.setTimeout(() => setSavedGlobalToast(false), 1800);
    setMenuOpen(false);
  };

  const popoverNode =
    menuOpen && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={popoverRef}
            role="menu"
            style={{
              position: 'fixed',
              left: `${menuCoords.left}px`,
              top: `${menuCoords.top}px`,
              transform: menuCoords.openAbove ? 'translateY(-100%)' : 'none',
            }}
            className="z-[70] w-[232px] rounded-xl bg-[var(--surface)] border border-[var(--border)] shadow-[var(--modal-shadow)] dark:shadow-2xl p-2.5 space-y-2"
          >
            <div className="px-1 text-[11px] font-semibold text-[var(--text)]">
              {t('erpStatus.pagination.presetHeading')}
            </div>
            <div className="grid grid-cols-4 gap-1">
              {pageSizeOptions.map((opt) => {
                const isActive = limitEnabled && safeSize === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => handleSelectPreset(opt)}
                    className={`h-7 rounded-md font-mono tabular-nums text-[11px] font-semibold transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                        : 'bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] hover:border-[var(--accent)]'
                    }`}
                  >
                    {opt}
                  </button>
                );
              })}
              {canToggleLimit && (
                <button
                  type="button"
                  onClick={handleShowAllOption}
                  className={`h-7 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                    !limitEnabled
                      ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                      : 'bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] hover:border-[var(--accent)]'
                  }`}
                >
                  {t('erpStatus.pagination.allShort')}
                </button>
              )}
            </div>

            <div className="border-t border-[var(--border)] pt-2">
              <button
                type="button"
                onClick={handleApplyGlobal}
                className="w-full inline-flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-md text-[11px] font-semibold bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent-text)] transition-colors cursor-pointer"
              >
                <Globe className="w-3 h-3 shrink-0" />
                <span className="truncate">{t('erpStatus.pagination.applyToAllTables')}</span>
              </button>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div
      className={`${
        compact ? 'px-3 py-2' : 'px-4 py-2.5'
      } border-t border-[var(--border)] bg-[var(--surface-2)]/45 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-[var(--text-muted)] ${className}`}
    >
      {/* Left Zone: Navicat-style Record Counter */}
      <div className="flex flex-wrap items-center gap-2 font-mono tabular-nums">
        <span className="text-[var(--text-muted)]">
          {limitEnabled
            ? t('erpStatus.pagination.recordRange', {
                start: formatNumber(startIdx),
                end: formatNumber(endIdx),
                total: formatNumber(totalItems),
              })
            : t('erpStatus.pagination.showingAllRows', {
                total: formatNumber(totalItems),
              })}
        </span>
        {limitEnabled && (
          <span className="text-[var(--text-muted)]/75">
            ·{' '}
            {t('erpStatus.pagination.pageOf', {
              page: formatNumber(safePage),
              totalPages: formatNumber(totalPages),
            })}
          </span>
        )}
        {savedGlobalToast && (
          <span className="inline-flex items-center gap-1 font-sans text-[11px] font-medium text-[var(--success)]">
            <Check className="w-3 h-3" />
            <span>{t('erpStatus.pagination.appliedAllToast')}</span>
          </span>
        )}
      </div>

      {/* Right Zone: Navicat Limit Records Control + Page Navigation */}
      <div className="flex flex-wrap items-center gap-3 ml-auto">
        {/* Navicat Limit Records Control */}
        {(canCustomizeSize || canToggleLimit) && (
          <div className="flex flex-wrap items-center gap-1.5" ref={anchorRef}>
            {canToggleLimit && (
              <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--text)] cursor-pointer select-none whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={limitEnabled}
                  onChange={(e) => onLimitEnabledChange?.(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-[var(--border)] bg-[var(--surface)] accent-[var(--accent)] cursor-pointer"
                />
                <span>{t('erpStatus.pagination.limitRecords')}</span>
              </label>
            )}

            {canCustomizeSize && (
              <div
                className={`inline-flex items-center rounded-md border border-[var(--border-strong)] dark:border-[var(--border)] bg-[var(--input-bg)] dark:bg-[var(--surface)] overflow-hidden transition-opacity ${
                  limitEnabled ? 'opacity-100' : 'opacity-45'
                }`}
              >
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label={t('erpStatus.pagination.rowsPerPageAria')}
                  value={sizeInput}
                  disabled={!limitEnabled}
                  onChange={(e) => setSizeInput(e.target.value.replace(/[^0-9]/g, ''))}
                  onBlur={commitSizeInput}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitSizeInput();
                      (e.currentTarget as HTMLInputElement).blur();
                    }
                  }}
                  className="w-12 h-7 px-1.5 text-center font-mono tabular-nums text-xs font-semibold text-[var(--text)] bg-transparent focus:outline-none focus:bg-[var(--accent-soft)] disabled:cursor-not-allowed"
                />
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-label={t('erpStatus.pagination.settingsAria')}
                  aria-expanded={menuOpen}
                  title={t('erpStatus.pagination.settingsTitle')}
                  className="inline-flex items-center justify-center h-7 px-1.5 border-l border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
                >
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
                </button>
              </div>
            )}

            <span className="text-[11px] text-[var(--text-muted)] whitespace-nowrap hidden sm:inline">
              {t('erpStatus.pagination.recordsPerPage')}
            </span>

            {canCustomizeSize && (
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label={t('erpStatus.pagination.settingsAria')}
                title={t('erpStatus.pagination.settingsTitle')}
                className={`inline-flex items-center justify-center w-7 h-7 rounded-md border transition-colors cursor-pointer ${
                  menuOpen
                    ? 'bg-[var(--accent)] text-[var(--on-accent)] border-[var(--accent)]'
                    : 'bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text)] hover:border-[var(--text-muted)]'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {popoverNode}

        {/* Divider */}
        {(canCustomizeSize || canToggleLimit) && limitEnabled && (
          <span className="hidden sm:inline-block w-px h-4 bg-[var(--border)]" aria-hidden="true" />
        )}

        {/* Navicat Page Navigation Controls */}
        {limitEnabled && (
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => onPageChange(1)}
              aria-label={t('erpStatus.pagination.first')}
              title={t('erpStatus.pagination.first')}
              className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] hover:border-[var(--text-muted)] disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed transition-colors"
            >
              <ChevronsLeft className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => onPageChange(Math.max(1, safePage - 1))}
              aria-label={t('erpStatus.pagination.prev')}
              title={t('erpStatus.pagination.prev')}
              className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] hover:border-[var(--text-muted)] disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>

            <div className="inline-flex items-center gap-1 px-1">
              <input
                type="text"
                inputMode="numeric"
                aria-label={t('erpStatus.pagination.jumpPageAria')}
                value={pageInput}
                disabled={totalPages <= 1}
                onChange={(e) => setPageInput(e.target.value.replace(/[^0-9]/g, ''))}
                onBlur={commitPageInput}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitPageInput();
                    (e.currentTarget as HTMLInputElement).blur();
                  }
                }}
                className="w-10 h-7 px-1 text-center font-mono tabular-nums text-xs font-semibold text-[var(--text)] bg-[var(--input-bg)] dark:bg-[var(--surface)] border border-[var(--border-strong)] dark:border-[var(--border)] rounded-md focus:outline-none focus:border-[var(--accent-text)] dark:focus:border-[var(--accent)] disabled:opacity-60"
              />
              <span className="font-mono tabular-nums text-[11px] text-[var(--text-muted)] whitespace-nowrap">
                / {formatNumber(totalPages)}
              </span>
            </div>

            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => onPageChange(Math.min(totalPages, safePage + 1))}
              aria-label={t('erpStatus.pagination.next')}
              title={t('erpStatus.pagination.next')}
              className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] hover:border-[var(--text-muted)] disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => onPageChange(totalPages)}
              aria-label={t('erpStatus.pagination.last')}
              title={t('erpStatus.pagination.last')}
              className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] hover:border-[var(--text-muted)] disabled:opacity-35 cursor-pointer disabled:cursor-not-allowed transition-colors"
            >
              <ChevronsRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
