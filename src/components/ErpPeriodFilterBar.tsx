import React, { useMemo } from 'react';
import { Calendar, ChevronDown, RefreshCw, RotateCcw, Search, X } from 'lucide-react';
import { useI18n } from '../lib/i18n';

export interface ErpPeriodFilterBarProps {
  dateFrom: string;
  dateTo: string;
  minDate?: string;
  searchValue: string;
  appliedSearchValue?: string;
  searchPlaceholder: string;
  loading: boolean;
  embedded?: boolean;
  helperNote?: string;
  extraActions?: React.ReactNode;
  onPeriodChange: (nextFrom: string, nextTo: string) => void;
  onSearchChange: (value: string) => void;
  onClearSearch?: () => void;
  onSubmit: () => void;
  onReset: () => void;
  onRefresh: () => void;
}

const DEFAULT_MIN_DATE = '2026-03-01';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function parseYmd(ymd: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '').trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null;
  }
  return { year, month };
}

function toMonthStart(year: number, month: number): string {
  return `${year}-${pad2(month)}-01`;
}

function toMonthEnd(year: number, month: number): string {
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${pad2(month)}-${pad2(lastDay)}`;
}

function compareYm(a: { year: number; month: number }, b: { year: number; month: number }): number {
  if (a.year !== b.year) return a.year - b.year;
  return a.month - b.month;
}

const MONTH_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

export const ErpPeriodFilterBar: React.FC<ErpPeriodFilterBarProps> = ({
  dateFrom,
  dateTo,
  minDate = DEFAULT_MIN_DATE,
  searchValue,
  appliedSearchValue = '',
  searchPlaceholder,
  loading,
  embedded = false,
  helperNote,
  extraActions,
  onPeriodChange,
  onSearchChange,
  onClearSearch,
  onSubmit,
  onReset,
  onRefresh,
}) => {
  const { t } = useI18n();

  const minYm = useMemo(() => parseYmd(minDate) || { year: 2026, month: 3 }, [minDate]);
  const currentYear = new Date().getFullYear();

  const parsedFrom = useMemo(() => {
    const p = parseYmd(dateFrom);
    if (!p || compareYm(p, minYm) < 0) return minYm;
    return p;
  }, [dateFrom, minYm]);

  const parsedTo = useMemo(() => {
    if (!dateTo) return null;
    const p = parseYmd(dateTo);
    if (!p) return null;
    return compareYm(p, parsedFrom) < 0 ? parsedFrom : p;
  }, [dateTo, parsedFrom]);

  const yearOptions = useMemo(() => {
    const maxYear = Math.max(
      currentYear + 1,
      minYm.year + 2,
      parsedFrom.year,
      parsedTo?.year || minYm.year
    );
    const list: number[] = [];
    for (let y = minYm.year; y <= maxYear; y++) {
      list.push(y);
    }
    return list;
  }, [currentYear, minYm.year, parsedFrom.year, parsedTo?.year]);

  const hasAppliedSearch = String(appliedSearchValue || '').trim() !== '';
  const isDefaultState =
    parsedFrom.year === minYm.year &&
    parsedFrom.month === minYm.month &&
    parsedTo === null &&
    searchValue.trim() === '' &&
    !hasAppliedSearch;

  const emitRange = (
    nextFrom: { year: number; month: number },
    nextTo: { year: number; month: number } | null
  ) => {
    const clampedFrom = compareYm(nextFrom, minYm) < 0 ? minYm : nextFrom;
    const clampedTo =
      nextTo && compareYm(nextTo, clampedFrom) < 0 ? clampedFrom : nextTo;
    const fromStr = toMonthStart(clampedFrom.year, clampedFrom.month);
    const toStr = clampedTo ? toMonthEnd(clampedTo.year, clampedTo.month) : '';
    onPeriodChange(fromStr, toStr);
  };

  const handleFromMonthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const month = Number(e.target.value);
    if (!Number.isFinite(month)) return;
    emitRange({ year: parsedFrom.year, month }, parsedTo);
  };

  const handleFromYearChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const year = Number(e.target.value);
    if (!Number.isFinite(year)) return;
    const month = year === minYm.year && parsedFrom.month < minYm.month ? minYm.month : parsedFrom.month;
    emitRange({ year, month }, parsedTo);
  };

  const handleToMonthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === '') {
      emitRange(parsedFrom, null);
      return;
    }
    const month = Number(val);
    if (!Number.isFinite(month)) return;
    let targetYear = parsedTo ? parsedTo.year : parsedFrom.year;
    if (!parsedTo && month < parsedFrom.month) {
      targetYear = parsedFrom.year + 1;
    }
    emitRange(parsedFrom, { year: targetYear, month });
  };

  const handleToYearChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === '') {
      emitRange(parsedFrom, null);
      return;
    }
    const year = Number(val);
    if (!Number.isFinite(year)) return;
    const month = parsedTo
      ? year === parsedFrom.year && parsedTo.month < parsedFrom.month
        ? parsedFrom.month
        : parsedTo.month
      : 12;
    emitRange(parsedFrom, { year, month });
  };

  const selectClass =
    'w-full h-10 appearance-none pl-3 pr-8 text-xs font-medium rounded-lg bg-[var(--input-bg)] dark:bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border-strong)] dark:border-[var(--border)] hover:border-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-text)] dark:focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus-ring)] transition-colors cursor-pointer';

  const activeRangeSummary = `${t(`erpFilter.monthsShort.${parsedFrom.month}`)} ${parsedFrom.year} – ${
    parsedTo
      ? `${t(`erpFilter.monthsShort.${parsedTo.month}`)} ${parsedTo.year}`
      : t('erpFilter.presentShort')
  }`;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className={
        embedded
          ? 'p-4 border-b border-[var(--border)] bg-[var(--surface)] space-y-3.5'
          : 'rounded-xl bg-[var(--surface)] border border-[var(--border)] p-4 space-y-3.5'
      }
    >
      {/* Row 1: Structured Period Dropdowns (From Month/Year -> To Month/Year) + Utility Actions */}
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-3">
        <div className="flex flex-col sm:flex-row sm:items-end gap-2.5 flex-wrap">
          {/* Dari Periode */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--text-muted)]">
              <Calendar className="w-3.5 h-3.5 text-[var(--accent-text)] shrink-0" />
              <span>{t('erpFilter.fromPeriod')}</span>
            </label>
            <div className="grid grid-cols-[minmax(136px,1fr)_94px] gap-1.5">
              <div className="relative">
                <select
                  aria-label={t('erpFilter.fromMonthAria')}
                  value={parsedFrom.month}
                  onChange={handleFromMonthChange}
                  className={selectClass}
                >
                  {MONTH_NUMBERS.map((m) => (
                    <option
                      key={m}
                      value={m}
                      disabled={parsedFrom.year === minYm.year && m < minYm.month}
                    >
                      {t(`erpFilter.months.${m}`)}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>

              <div className="relative">
                <select
                  aria-label={t('erpFilter.fromYearAria')}
                  value={parsedFrom.year}
                  onChange={handleFromYearChange}
                  className={`${selectClass} font-mono tabular-nums`}
                >
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Separator */}
          <span className="hidden sm:inline-flex items-center justify-center h-10 px-1 text-xs font-medium text-[var(--text-muted)] select-none">
            {t('erpFilter.toSeparator')}
          </span>

          {/* Sampai Periode */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-semibold text-[var(--text-muted)]">
              {t('erpFilter.toPeriod')}
            </label>
            <div className="grid grid-cols-[minmax(148px,1fr)_102px] gap-1.5">
              <div className="relative">
                <select
                  aria-label={t('erpFilter.toMonthAria')}
                  value={parsedTo ? String(parsedTo.month) : ''}
                  onChange={handleToMonthChange}
                  className={selectClass}
                >
                  <option value="">{t('erpFilter.untilPresentMonth')}</option>
                  {MONTH_NUMBERS.map((m) => {
                    const effectiveYear = parsedTo ? parsedTo.year : parsedFrom.year;
                    const disabled =
                      parsedTo !== null &&
                      effectiveYear === parsedFrom.year &&
                      m < parsedFrom.month;
                    return (
                      <option key={m} value={m} disabled={disabled}>
                        {t(`erpFilter.months.${m}`)}
                      </option>
                    );
                  })}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>

              <div className="relative">
                <select
                  aria-label={t('erpFilter.toYearAria')}
                  value={parsedTo ? String(parsedTo.year) : ''}
                  onChange={handleToYearChange}
                  className={`${selectClass} font-mono tabular-nums`}
                >
                  <option value="">{t('erpFilter.presentShort')}</option>
                  {yearOptions.map((y) => (
                    <option key={y} value={y} disabled={y < parsedFrom.year}>
                      {y}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>
          </div>
        </div>

        {/* Right: Quiet Active Period Readout + Reset + Extra Actions (e.g. Export CSV) */}
        <div className="flex flex-wrap items-center justify-between xl:justify-end gap-2.5 shrink-0">
          <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5 whitespace-nowrap">
            <span>{t('erpFilter.selectedRange')}:</span>
            <span className="font-mono tabular-nums font-semibold text-[var(--text)]">
              {activeRangeSummary}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!isDefaultState && (
              <button
                type="button"
                disabled={loading}
                onClick={onReset}
                className="inline-flex items-center justify-center gap-1.5 h-9 px-3 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text)] bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--text-muted)] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>{t('erpFilter.reset')}</span>
              </button>
            )}
            {extraActions}
          </div>
        </div>
      </div>

      {/* Row 2: Search Input + Primary Apply CTA + Refresh */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-3 border-t border-[var(--border)]/70">
        <div className="relative flex-1 min-w-0">
          <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full h-10 pl-9 pr-8 text-xs bg-[var(--input-bg)] dark:bg-[var(--surface-2)] border border-[var(--border-strong)] dark:border-[var(--border)] rounded-lg text-[var(--text)] placeholder:text-[var(--text-subtle)] dark:placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-text)] dark:focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus-ring)] transition-colors"
          />
          {searchValue && (
            <button
              type="button"
              onClick={() => {
                if (onClearSearch) {
                  onClearSearch();
                } else {
                  onSearchChange('');
                }
              }}
              aria-label={t('erpFilter.clearSearch')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="submit"
            disabled={loading}
            className="flex-1 sm:flex-initial h-10 px-4 text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {loading ? t('erpFilter.loading') : t('erpFilter.apply')}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onRefresh}
            className="inline-flex items-center justify-center gap-1.5 h-10 px-3.5 text-xs font-medium text-[var(--text)] bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--text-muted)] disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{t('erpFilter.refresh')}</span>
          </button>
        </div>
      </div>

      {hasAppliedSearch && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[var(--accent-soft)] border border-[var(--accent)]/35 text-xs">
          <div className="flex items-center gap-1.5 text-[var(--text)] min-w-0">
            <Search className="w-3.5 h-3.5 text-[var(--accent-text)] dark:text-[var(--accent)] shrink-0" />
            <span className="text-[var(--text-muted)]">Filter pencarian aktif:</span>
            <span className="font-mono font-semibold text-[var(--text)] truncate">
              {appliedSearchValue}
            </span>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              if (onClearSearch) {
                onClearSearch();
              } else {
                onReset();
              }
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] hover:border-[var(--accent)] transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            <X className="w-3 h-3" />
            <span>Tampilkan Semua Data</span>
          </button>
        </div>
      )}

      {helperNote && (
        <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">{helperNote}</p>
      )}
    </form>
  );
};
