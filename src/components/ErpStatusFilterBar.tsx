import React from 'react';
import {
  CheckCheck,
  CheckCircle2,
  CircleDot,
  Clock,
  FileWarning,
  RotateCcw,
  SlidersHorizontal,
  XCircle,
} from 'lucide-react';
import {
  classifyGrnStatusCode,
  classifyStandardStatusCode,
  type DocStatusChip,
  type GrnStatusChip,
  type StandardDocStatusChip,
} from '../config/pendingTransactionRules';
import { useI18n } from '../lib/i18n';

export type ErpStatusBadgeVariant =
  | 'need_approve'
  | 'approved'
  | 'in_progress'
  | 'completed'
  | 'belum_ri'
  | 'excluded';

/**
 * Consistent status badge across all ERP document tables (PO, GRN, PR, SO, DO).
 * Always pairs color + icon + translated text (never color alone).
 * - Need Approve: yellow/warning
 * - Approved: blue/neutral
 * - In Progress: orange
 * - Completed: green
 * - Belum RI (GRN): yellow/warning
 */
export const ErpStatusBadge: React.FC<{
  statusCode: number;
  isClosed?: boolean;
  mode?: 'standard' | 'grn';
  rawLabel?: string;
}> = ({ statusCode, isClosed = false, mode = 'standard', rawLabel }) => {
  const { t } = useI18n();

  const variant: ErpStatusBadgeVariant =
    mode === 'grn'
      ? classifyGrnStatusCode(statusCode, isClosed)
      : classifyStandardStatusCode(statusCode, isClosed);

  if (variant === 'need_approve') {
    const label =
      statusCode === 0
        ? t('erpStatus.labels.draft')
        : statusCode === 5
          ? t('erpStatus.labels.revision')
          : statusCode >= 8 && statusCode <= 11 && rawLabel
            ? rawLabel
            : t('erpStatus.labels.need_approve');
    return (
      <span
        title={rawLabel}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[var(--warning-soft)] text-[var(--warning)] border border-[var(--warning)]/30 whitespace-nowrap"
      >
        <Clock className="w-3 h-3 shrink-0" />
        <span>{label}</span>
      </span>
    );
  }

  if (variant === 'approved') {
    return (
      <span
        title={rawLabel}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[var(--info-soft)] text-[var(--info)] border border-[var(--info)]/30 whitespace-nowrap"
      >
        <CheckCircle2 className="w-3 h-3 shrink-0" />
        <span>{t('erpStatus.labels.approved')}</span>
      </span>
    );
  }

  if (variant === 'in_progress') {
    return (
      <span
        title={rawLabel}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[var(--warning-soft)] dark:bg-orange-500/14 text-[var(--warning)] dark:text-orange-400 border border-[var(--warning)]/35 dark:border-orange-500/30 whitespace-nowrap"
      >
        <CircleDot className="w-3 h-3 shrink-0" />
        <span>{t('erpStatus.labels.in_progress')}</span>
      </span>
    );
  }

  if (variant === 'completed') {
    return (
      <span
        title={rawLabel}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[var(--success-soft)] text-[var(--success)] border border-[var(--success)]/30 whitespace-nowrap"
      >
        <CheckCheck className="w-3 h-3 shrink-0" />
        <span>{t('erpStatus.labels.completed')}</span>
      </span>
    );
  }

  if (variant === 'belum_ri') {
    return (
      <span
        title={rawLabel}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[var(--warning-soft)] text-[var(--warning)] border border-[var(--warning)]/30 whitespace-nowrap"
      >
        <FileWarning className="w-3 h-3 shrink-0" />
        <span>{t('erpStatus.labels.belum_ri')}</span>
      </span>
    );
  }

  return (
    <span
      title={rawLabel}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[var(--surface-3)] dark:bg-[var(--surface-2)] text-[var(--text-muted)] border border-[var(--border)] whitespace-nowrap"
    >
      <XCircle className="w-3 h-3 shrink-0" />
      <span>{rawLabel || t('erpStatus.labels.void')}</span>
    </span>
  );
};

export interface StatusFilterChipOption<T extends DocStatusChip> {
  id: T;
  labelKey: string;
  count: number;
  tone?: 'neutral' | 'warning' | 'blue' | 'orange' | 'green';
}

/**
 * Segmented interactive status filter control placed directly above document tables.
 * Displays exact counts per status, filters immediately client-side without page reload,
 * supports keyboard navigation (ArrowLeft/ArrowRight/Home/End), and provides a quick Reset.
 */
export function ErpStatusFilterBar<T extends DocStatusChip>({
  options,
  activeValue,
  onChange,
  ariaLabel,
  loadingCounts = false,
  filteredCount,
  totalCount,
}: {
  options: StatusFilterChipOption<T>[];
  activeValue: T;
  onChange: (next: T) => void;
  ariaLabel?: string;
  loadingCounts?: boolean;
  filteredCount?: number;
  totalCount?: number;
}) {
  const { t, formatNumber } = useI18n();

  const getToneDot = (tone?: StatusFilterChipOption<T>['tone'], isActive?: boolean) => {
    if (isActive) return 'bg-[var(--on-accent)]/85';
    if (tone === 'warning') return 'bg-[var(--warning)]';
    if (tone === 'blue') return 'bg-[var(--info)]';
    if (tone === 'orange') return 'bg-[var(--warning)] dark:bg-orange-500';
    if (tone === 'green') return 'bg-[var(--success)]';
    return 'bg-[var(--text-muted)]';
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
    if (options.length === 0) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      onChange(options[(idx + 1) % options.length].id);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onChange(options[(idx - 1 + options.length) % options.length].id);
    } else if (e.key === 'Home') {
      e.preventDefault();
      onChange(options[0].id);
    } else if (e.key === 'End') {
      e.preventDefault();
      onChange(options[options.length - 1].id);
    }
  };

  const isFiltered = activeValue !== 'all';
  const resolvedTotal =
    typeof totalCount === 'number'
      ? totalCount
      : options.find((o) => o.id === 'all')?.count ?? 0;
  const resolvedShown =
    typeof filteredCount === 'number'
      ? filteredCount
      : options.find((o) => o.id === activeValue)?.count ?? resolvedTotal;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5 px-3 py-2 rounded-xl bg-[var(--surface)] border border-[var(--border)]">
      <div className="flex flex-wrap items-center gap-2.5 min-w-0">
        <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] whitespace-nowrap shrink-0">
          <SlidersHorizontal className="w-3.5 h-3.5 text-[var(--accent-text)] dark:text-[var(--accent)]" />
          <span>{t('erpStatus.filterLabel')}</span>
        </div>

        <div
          role="tablist"
          aria-label={ariaLabel || t('erpStatus.filterBarAria')}
          className="inline-flex flex-wrap items-center gap-1 p-1 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]"
        >
          {options.map((opt, idx) => {
            const isActive = activeValue === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="tab"
                tabIndex={isActive ? 0 : -1}
                aria-selected={isActive}
                onClick={() => onChange(opt.id)}
                onKeyDown={(e) => handleKeyDown(e, idx)}
                className={`inline-flex items-center gap-1.5 h-7.5 px-2.5 rounded-md text-xs transition-all whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60 ${
                  isActive
                    ? 'bg-[var(--accent)] text-[var(--on-accent)] font-semibold dark:shadow-sm'
                    : 'text-[var(--text-muted)] font-medium hover:text-[var(--text)] hover:bg-[var(--surface)]/80'
                }`}
              >
                {opt.tone && opt.tone !== 'neutral' && (
                  <span
                    aria-hidden="true"
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${getToneDot(opt.tone, isActive)}`}
                  />
                )}
                <span>{t(opt.labelKey)}</span>
                {loadingCounts ? (
                  <span
                    aria-hidden="true"
                    className="inline-block w-4 h-3.5 rounded bg-[var(--border)] animate-pulse"
                  />
                ) : (
                  <span
                    className={`font-mono tabular-nums text-[11px] leading-none px-1.5 py-0.5 rounded ${
                      isActive
                        ? 'bg-[var(--on-accent)]/15 text-[var(--on-accent)] font-bold'
                        : 'bg-[var(--surface)] text-[var(--text)] border border-[var(--border)]'
                    }`}
                  >
                    {formatNumber(opt.count)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)] whitespace-nowrap ml-auto">
        <span className="font-mono tabular-nums">
          {isFiltered
            ? t('erpStatus.showingFiltered', {
                shown: formatNumber(resolvedShown),
                total: formatNumber(resolvedTotal),
              })
            : t('erpStatus.showingAll', { total: formatNumber(resolvedTotal) })}
        </span>
        {isFiltered && (
          <button
            type="button"
            onClick={() => onChange('all' as T)}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-semibold bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] hover:border-[var(--accent)] hover:text-[var(--accent-text)] transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            <span>{t('erpStatus.resetFilter')}</span>
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Helper to build the standard 5-chip options list (Semua | Need Approve | Approved | In Progress | Completed).
 */
export function buildStandardStatusChips(counts: {
  all: number;
  need_approve: number;
  approved: number;
  in_progress: number;
  completed: number;
}): StatusFilterChipOption<StandardDocStatusChip>[] {
  return [
    { id: 'all', labelKey: 'erpStatus.chips.all', count: counts.all, tone: 'neutral' },
    {
      id: 'need_approve',
      labelKey: 'erpStatus.chips.need_approve',
      count: counts.need_approve,
      tone: 'warning',
    },
    { id: 'approved', labelKey: 'erpStatus.chips.approved', count: counts.approved, tone: 'blue' },
    {
      id: 'in_progress',
      labelKey: 'erpStatus.chips.in_progress',
      count: counts.in_progress,
      tone: 'orange',
    },
    {
      id: 'completed',
      labelKey: 'erpStatus.chips.completed',
      count: counts.completed,
      tone: 'green',
    },
  ];
}

/**
 * Helper to build the 3-chip GRN options list (Semua | Belum RI | Completed).
 */
export function buildGrnStatusChips(counts: {
  all: number;
  belum_ri: number;
  completed: number;
}): StatusFilterChipOption<GrnStatusChip>[] {
  return [
    { id: 'all', labelKey: 'erpStatus.chips.all', count: counts.all, tone: 'neutral' },
    { id: 'belum_ri', labelKey: 'erpStatus.chips.belum_ri', count: counts.belum_ri, tone: 'warning' },
    {
      id: 'completed',
      labelKey: 'erpStatus.chips.completed',
      count: counts.completed,
      tone: 'green',
    },
  ];
}

export {
  TablePaginationBar,
  useTablePagination,
  DEFAULT_PAGE_SIZE_OPTIONS,
  applyGlobalTablePagingPreference,
  type TablePaginationBarProps,
} from './TablePaginationBar';

