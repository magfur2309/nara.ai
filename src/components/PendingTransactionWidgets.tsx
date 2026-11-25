import React from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Info,
  RefreshCw,
  ShoppingCart,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  formatBadgeCount,
  type PendingRuleEvaluation,
  type PendingTransactionsSummaryResponse,
  type PendingUrgencyLevel,
} from '../config/pendingTransactionRules';
import { useI18n } from '../lib/i18n';

/**
 * Urgency styling combining color + icon + text (never color alone).
 */
export const PendingUrgencyBadge: React.FC<{
  urgency: PendingUrgencyLevel;
  compact?: boolean;
}> = ({ urgency, compact = false }) => {
  const { t } = useI18n();

  if (urgency === 'overdue') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[var(--danger-soft)] text-[var(--danger)] border border-[var(--danger)]/25 whitespace-nowrap">
        <AlertOctagon className="w-3 h-3 shrink-0" />
        <span>{compact ? t('pendingTx.urgency.overdueShort') : t('pendingTx.urgency.overdue')}</span>
      </span>
    );
  }

  if (urgency === 'warning') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[var(--warning-soft)] text-[var(--warning)] border border-[var(--warning)]/25 whitespace-nowrap">
        <AlertTriangle className="w-3 h-3 shrink-0" />
        <span>{compact ? t('pendingTx.urgency.warningShort') : t('pendingTx.urgency.warning')}</span>
      </span>
    );
  }

  if (urgency === 'info') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[var(--info-soft)] text-[var(--info)] border border-[var(--info)]/25 whitespace-nowrap">
        <Info className="w-3 h-3 shrink-0" />
        <span>{compact ? t('pendingTx.urgency.infoShort') : t('pendingTx.urgency.info')}</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[var(--surface-3)] dark:bg-[var(--surface-2)] text-[var(--text-muted)] border border-[var(--border)] whitespace-nowrap">
      <Clock className="w-3 h-3 shrink-0" />
      <span>{compact ? t('pendingTx.urgency.normalShort') : t('pendingTx.urgency.normal')}</span>
    </span>
  );
};

/**
 * Menu count badge (99+ cap, urgency tint, and optional tiny skeleton during first load).
 */
export const PendingCountBadge: React.FC<{
  count: number;
  urgency?: PendingUrgencyLevel | null;
  loading?: boolean;
  corner?: boolean;
  onDarkSurface?: boolean;
}> = ({ count, urgency, loading = false, corner = false, onDarkSurface = false }) => {
  if (loading && count === 0) {
    if (corner) {
      return (
        <span
          aria-hidden="true"
          className={`absolute top-1 right-1 w-2 h-2 rounded-full animate-pulse ${
            onDarkSurface ? 'bg-white/30' : 'bg-[var(--border)]'
          }`}
        />
      );
    }
    return (
      <span
        aria-hidden="true"
        className={`inline-block w-5 h-4 rounded animate-pulse ${
          onDarkSurface ? 'bg-white/15' : 'bg-[var(--surface-3)] dark:bg-[var(--surface-2)]'
        }`}
      />
    );
  }

  if (count <= 0) return null;

  const toneClass =
    urgency === 'overdue'
      ? 'bg-[var(--danger)] text-[var(--on-danger)]'
      : urgency === 'warning'
        ? 'bg-[#D97706] text-white'
        : urgency === 'info'
          ? 'bg-[var(--info)] text-white'
          : onDarkSurface
            ? 'bg-[#5EEAD4] text-[#042429]'
            : 'bg-[var(--accent)] text-[var(--on-accent)]';

  if (corner) {
    return (
      <span
        className={`absolute top-1 right-1 min-w-[16px] h-[16px] px-1 rounded-full font-mono tabular-nums text-[9px] font-bold flex items-center justify-center leading-none ${toneClass}`}
      >
        {formatBadgeCount(count)}
      </span>
    );
  }

  const inlineTone = onDarkSurface
    ? urgency === 'overdue'
      ? 'bg-[#EF4444]/25 text-[#FCA5A5] border border-[#F87171]/35'
      : urgency === 'warning'
        ? 'bg-[#F59E0B]/25 text-[#FDE68A] border border-[#FBBF24]/35'
        : urgency === 'info'
          ? 'bg-[#38BDF8]/25 text-[#BAE6FD] border border-[#38BDF8]/35'
          : 'bg-white/[0.14] text-[#7CEEE0] border border-[#5EEAD4]/25'
    : urgency === 'overdue'
      ? 'bg-[var(--danger-soft)] text-[var(--danger)] border border-[var(--danger)]/30'
      : urgency === 'warning'
        ? 'bg-[var(--warning-soft)] text-[var(--warning)] border border-[var(--warning)]/30'
        : urgency === 'info'
          ? 'bg-[var(--info-soft)] text-[var(--info)] border border-[var(--info)]/30'
          : 'bg-[var(--accent-soft)] text-[var(--accent-text)] border border-[var(--accent)]/25';

  return (
    <span
      className={`font-mono tabular-nums text-[10px] font-bold px-1.5 py-0.5 rounded leading-none ${inlineTone}`}
    >
      {formatBadgeCount(count)}
    </span>
  );
};

/**
 * Once-per-session summary toast displayed after login when pending transactions exist.
 * Non-intrusive, silent, and dismissible.
 */
export const PendingSummaryToast: React.FC<{
  totalCount: number;
  highestUrgency: PendingUrgencyLevel | null;
  onViewDashboard: () => void;
  onDismiss: () => void;
}> = ({ totalCount, highestUrgency, onViewDashboard, onDismiss }) => {
  const { t } = useI18n();
  if (totalCount <= 0) return null;

  const borderTone =
    highestUrgency === 'overdue'
      ? 'border-[var(--danger)]/50'
      : highestUrgency === 'warning'
        ? 'border-[var(--warning)]/50'
        : highestUrgency === 'info'
          ? 'border-[var(--info)]/45'
          : 'border-[var(--accent)]/50';

  const Icon =
    highestUrgency === 'overdue'
      ? AlertOctagon
      : highestUrgency === 'warning'
        ? AlertTriangle
        : highestUrgency === 'info'
          ? Info
          : Clock;

  const iconTone =
    highestUrgency === 'overdue'
      ? 'text-[var(--danger)]'
      : highestUrgency === 'warning'
        ? 'text-[var(--warning)]'
        : highestUrgency === 'info'
          ? 'text-[var(--info)]'
          : 'text-[var(--accent-text)]';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-5 right-5 z-50 w-[360px] max-w-[calc(100vw-2rem)] rounded-xl bg-[var(--surface)] border ${borderTone} shadow-[var(--modal-shadow)] dark:shadow-2xl p-4`}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 shrink-0 ${iconTone}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="font-display text-xs font-semibold text-[var(--text)]">
              {t('pendingTx.toast.title')}
            </p>
            <button
              type="button"
              onClick={onDismiss}
              aria-label={t('common.close')}
              className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            {t('pendingTx.toast.body', { count: totalCount })}
          </p>
          <div className="pt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={onViewDashboard}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] transition-colors cursor-pointer"
            >
              <span>{t('pendingTx.toast.cta')}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="h-8 px-2.5 rounded-lg text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Bell dropdown section showing ERP pending transactions sorted by urgency (overdue -> warning -> normal).
 */
export const HeaderPendingDropdownSection: React.FC<{
  summary: PendingTransactionsSummaryResponse | null;
  loading: boolean;
  error: string | null;
  onSelectRule: (rule: PendingRuleEvaluation) => void;
  onRetry: () => void;
}> = ({ summary, loading, error, onSelectRule, onRetry }) => {
  const { t } = useI18n();

  if (loading && !summary) {
    return (
      <div className="px-4 py-3 space-y-2">
        <div className="h-3 w-36 rounded bg-[var(--surface-3)] dark:bg-[var(--surface-2)] animate-pulse" />
        <div className="h-10 w-full rounded-lg bg-[var(--surface-3)] dark:bg-[var(--surface-2)] animate-pulse" />
        <div className="h-10 w-full rounded-lg bg-[var(--surface-3)] dark:bg-[var(--surface-2)] animate-pulse" />
      </div>
    );
  }

  if (error && !summary) {
    return (
      <div className="px-4 py-3 bg-[var(--surface-2)]/50 text-[11px] text-[var(--text-muted)] flex items-center justify-between gap-2">
        <span className="truncate">{t('pendingTx.loadFailedShort')}</span>
        <button
          type="button"
          onClick={onRetry}
          className="text-[var(--accent-text)] font-semibold hover:underline shrink-0 cursor-pointer"
        >
          {t('pendingTx.retry')}
        </button>
      </div>
    );
  }

  if (!summary || summary.allowedRuleIds.length === 0) {
    return null;
  }

  return (
    <div className="divide-y divide-[var(--border)]">
      <div className="px-4 py-2 bg-[var(--surface-2)]/60 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          {t('pendingTx.dropdown.sectionTitle')}
        </span>
        <span className="font-mono tabular-nums text-[11px] font-semibold text-[var(--text)]">
          {formatBadgeCount(summary.totalCount)}
        </span>
      </div>

      {summary.rules.length === 0 ? (
        <div className="px-4 py-4 flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <CheckCircle2 className="w-4 h-4 text-[var(--success)] shrink-0" />
          <span>{t('pendingTx.empty')}</span>
        </div>
      ) : (
        summary.rules.map((rule) => {
          const Icon =
            rule.urgency === 'overdue'
              ? AlertOctagon
              : rule.urgency === 'warning'
                ? AlertTriangle
                : rule.urgency === 'info'
                  ? Info
                  : Clock;
          const iconTone =
            rule.urgency === 'overdue'
              ? 'text-[var(--danger)]'
              : rule.urgency === 'warning'
                ? 'text-[var(--warning)]'
                : rule.urgency === 'info'
                  ? 'text-[var(--info)]'
                  : 'text-[var(--accent-text)]';

          return (
            <button
              key={rule.ruleId}
              type="button"
              onClick={() => onSelectRule(rule)}
              className="w-full text-left px-4 py-3 hover:bg-[var(--surface-2)] transition-colors flex items-start gap-2.5 cursor-pointer"
            >
              <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${iconTone}`} />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-[var(--text)] leading-snug">
                    {t(rule.textKeys.summaryKey, { count: rule.count })}
                  </p>
                  <ArrowRight className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                  <span>{t(`pendingTx.modules.${rule.module}`)}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {t('pendingTx.oldestAge', { days: rule.oldestAgeDays })}
                  </span>
                  <PendingUrgencyBadge urgency={rule.urgency} compact />
                </div>
              </div>
            </button>
          );
        })
      )}
    </div>
  );
};

/**
 * Dashboard "Perlu Tindakan" / "Action Needed" section grouping pending transactions
 * by module (Penjualan, Pembelian) with count, oldest age, urgency indicator, and quick jump links.
 */
export const DashboardActionNeededSection: React.FC<{
  summary: PendingTransactionsSummaryResponse | null;
  loading: boolean;
  error: string | null;
  onSelectRule: (rule: PendingRuleEvaluation) => void;
  onRefresh: () => void;
}> = ({ summary, loading, error, onSelectRule, onRefresh }) => {
  const { t, formatNumber } = useI18n();

  // Hide section entirely if user's division/role has zero permitted pending rules
  if (summary && summary.allowedRuleIds.length === 0) {
    return null;
  }

  const salesRules = (summary?.rules || []).filter((r) => r.module === 'sales');
  const purchasingRules = (summary?.rules || []).filter((r) => r.module === 'purchasing');
  const hasSalesPermission = Boolean(
    summary?.allowedRuleIds?.some((id) => id.startsWith('sales_'))
  );
  const hasPurchasingPermission = Boolean(
    summary?.allowedRuleIds?.some((id) => id.startsWith('purchasing_'))
  );

  const moduleGroups: {
    module: 'sales' | 'purchasing';
    icon: React.ReactNode;
    rules: PendingRuleEvaluation[];
    count: number;
    oldestAgeDays: number;
    highestUrgency: PendingUrgencyLevel | null;
  }[] = [];

  if (hasSalesPermission) {
    moduleGroups.push({
      module: 'sales',
      icon: <TrendingUp className="w-4 h-4 text-[var(--accent-text)]" />,
      rules: salesRules,
      count: summary?.byModule?.sales?.count || 0,
      oldestAgeDays: summary?.byModule?.sales?.oldestAgeDays || 0,
      highestUrgency: summary?.byModule?.sales?.highestUrgency || null,
    });
  }
  if (hasPurchasingPermission) {
    moduleGroups.push({
      module: 'purchasing',
      icon: <ShoppingCart className="w-4 h-4 text-[var(--accent-text)]" />,
      rules: purchasingRules,
      count: summary?.byModule?.purchasing?.count || 0,
      oldestAgeDays: summary?.byModule?.purchasing?.oldestAgeDays || 0,
      highestUrgency: summary?.byModule?.purchasing?.highestUrgency || null,
    });
  }

  return (
    <section
      aria-label={t('pendingTx.dashboard.title')}
      className="rounded-[10px] bg-[var(--surface)] border border-[var(--border)] overflow-hidden"
    >
      <div className="px-5 py-4 border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2.5">
            <h2 className="font-display text-base font-bold text-[var(--text)]">
              {t('pendingTx.dashboard.title')}
            </h2>
            {summary && summary.totalCount > 0 && (
              <PendingCountBadge
                count={summary.totalCount}
                urgency={summary.highestUrgency}
              />
            )}
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            {t('pendingTx.dashboard.subtitle')}
          </p>
          {summary?.callerScope?.erpAccessMode === 'erp_mapped' &&
            summary.callerScope.erpUserName && (
              <p className="text-[11px] text-[var(--text-subtle)]">
                Akun ERP:{' '}
                <span className="font-mono font-medium text-[var(--text)]">
                  {summary.callerScope.erpUserName}
                  {summary.callerScope.erpUserCode
                    ? ` (${summary.callerScope.erpUserCode})`
                    : ''}
                </span>
                {summary.callerScope.erpRoles && summary.callerScope.erpRoles.length > 0 && (
                  <>
                    {' · '}
                    <span className="font-mono">
                      {summary.callerScope.erpRoles.join(', ')}
                    </span>
                  </>
                )}
              </p>
            )}
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] hover:border-[var(--text-muted)] disabled:opacity-50 transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>{t('common.refresh')}</span>
        </button>
      </div>

      {/* Initial loading skeleton (non-blocking) */}
      {loading && !summary ? (
        <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="h-32 rounded-xl bg-[var(--surface-3)] dark:bg-[var(--surface-2)]/70 border border-[var(--border)] animate-pulse" />
          <div className="h-32 rounded-xl bg-[var(--surface-3)] dark:bg-[var(--surface-2)]/70 border border-[var(--border)] animate-pulse" />
        </div>
      ) : error && !summary ? (
        <div className="p-5 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--text-muted)]">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[var(--warning)] shrink-0" />
            <span>{t('pendingTx.loadFailed')}</span>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="h-8 px-3 rounded-lg text-xs font-semibold bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] hover:border-[var(--accent)] cursor-pointer"
          >
            {t('pendingTx.retry')}
          </button>
        </div>
      ) : !summary || summary.totalCount === 0 ? (
        <div className="px-5 py-7 flex flex-col sm:flex-row items-center justify-center gap-2.5 text-center sm:text-left">
          <CheckCircle2 className="w-5 h-5 text-[var(--success)] shrink-0" />
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-[var(--text)]">{t('pendingTx.empty')}</p>
            <p className="text-xs text-[var(--text-muted)]">{t('pendingTx.emptyHint')}</p>
          </div>
        </div>
      ) : (
        <div className="p-5 space-y-4">
          <div
            className={`grid grid-cols-1 ${
              moduleGroups.length > 1 ? 'lg:grid-cols-2' : ''
            } gap-4`}
          >
            {moduleGroups.map((grp) => (
              <div
                key={grp.module}
                className="rounded-xl bg-[var(--surface-2)]/45 border border-[var(--border)] overflow-hidden flex flex-col"
              >
                {/* Module Header */}
                <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between gap-2 bg-[var(--surface-2)]/70">
                  <div className="flex items-center gap-2 min-w-0">
                    {grp.icon}
                    <h3 className="font-display text-sm font-semibold text-[var(--text)] truncate">
                      {t(`pendingTx.modules.${grp.module}`)}
                    </h3>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {grp.count > 0 && (
                      <span className="font-mono tabular-nums text-[11px] text-[var(--text-muted)]">
                        {t('pendingTx.oldestAge', { days: grp.oldestAgeDays })}
                      </span>
                    )}
                    <PendingCountBadge count={grp.count} urgency={grp.highestUrgency} />
                  </div>
                </div>

                {/* Rules inside module */}
                {grp.rules.length === 0 ? (
                  <div className="px-4 py-5 flex items-center gap-2 text-xs text-[var(--text-muted)]">
                    <CheckCircle2 className="w-4 h-4 text-[var(--success)] shrink-0" />
                    <span>{t('pendingTx.empty')}</span>
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--border)]/80">
                    {grp.rules.map((rule) => (
                      <div
                        key={rule.ruleId}
                        className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[var(--surface)]/65 dark:bg-transparent hover:bg-[var(--surface-2)] dark:hover:bg-[var(--surface)]/70 transition-colors"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono tabular-nums text-sm font-bold text-[var(--text)]">
                              {formatNumber(rule.count)}
                            </span>
                            <span className="text-xs font-semibold text-[var(--text)]">
                              {t(rule.textKeys.titleKey)}
                            </span>
                            <PendingUrgencyBadge urgency={rule.urgency} />
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-muted)]">
                            <span className="font-mono tabular-nums">
                              {t('pendingTx.oldestAge', { days: rule.oldestAgeDays })}
                              {rule.oldestDate ? ` (${rule.oldestDate})` : ''}
                            </span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => onSelectRule(rule)}
                          className="inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold bg-[var(--surface)] text-[var(--text)] border border-[var(--border-strong)] dark:border-[var(--border)] hover:bg-[var(--surface-2)] hover:border-[var(--accent)] hover:text-[var(--accent-text)] transition-colors shrink-0 cursor-pointer"
                        >
                          <span>{t(rule.textKeys.actionKey)}</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {summary.verification &&
            summary.verification.inconsistencies &&
            summary.verification.inconsistencies.length > 0 && (
              <details className="rounded-lg bg-[var(--surface-2)]/60 border border-[var(--border)] px-3.5 py-2.5 text-xs">
                <summary className="cursor-pointer font-semibold text-[var(--text)] flex items-center gap-2 select-none">
                  <Info className="w-3.5 h-3.5 text-[var(--info)] shrink-0" />
                  <span>
                    {t('pendingTx.verification.noticeTitle', {
                      count: summary.verification.inconsistencies.reduce((s, i) => s + i.count, 0),
                    })}
                  </span>
                </summary>
                <div className="mt-2 pt-2 border-t border-[var(--border)]/70 space-y-1.5 text-[11px] text-[var(--text-muted)]">
                  <p>{t('pendingTx.verification.noticeHint')}</p>
                  <ul className="space-y-1">
                    {summary.verification.inconsistencies.map((inc) => (
                      <li key={`${inc.code}-${inc.sourceTable}`} className="flex flex-wrap items-baseline gap-1.5">
                        <span className="font-mono font-semibold text-[var(--text)]">
                          {formatNumber(inc.count)}×
                        </span>
                        <span>{t(inc.descriptionKey)}</span>
                        {inc.sampleDocNos.length > 0 && (
                          <span className="font-mono text-[10px] text-[var(--text-muted)]">
                            ({t('pendingTx.verification.samplesLabel')}: {inc.sampleDocNos.join(', ')})
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            )}

          {summary.warning && (
            <p className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-[var(--warning)] shrink-0" />
              <span>{summary.warning}</span>
            </p>
          )}
        </div>
      )}
    </section>
  );
};
