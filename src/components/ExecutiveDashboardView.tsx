import React, { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Calendar,
  ChevronRight,
  Columns2,
  Globe,
  Lock,
  MessageSquarePlus,
  MessageSquareText,
  Package,
  Play,
  RefreshCw,
  Rows2,
  Search,
  Wrench,
} from 'lucide-react';
import { useI18n } from '../lib/i18n';
import type { ActiveView } from '../App';
import type {
  AiChartSpec,
  ChartColorPalette,
  ChartSortMode,
  ChartType,
  CompanyAsset,
  MeetingDocument,
  PinnedChartDocument,
  SopDocument,
  UserProfile,
} from '../types/sop';
import type {
  PendingRuleEvaluation,
  PendingTransactionsSummaryResponse,
} from '../config/pendingTransactionRules';
import {
  FullscreenPresentationModal,
  PresentationChartCard,
} from './PresentationChartCard';
import { DashboardActionNeededSection } from './PendingTransactionWidgets';

interface ExecutiveDashboardViewProps {
  user: UserProfile;
  sops?: SopDocument[];
  meetings?: MeetingDocument[];
  assets?: CompanyAsset[];
  urgentMaintenanceCount?: number;
  activeRemindersCount?: number;
  pinnedCharts: PinnedChartDocument[];
  loading: boolean;
  appDark: boolean;
  onNavigateView?: (view: ActiveView) => void;
  onOpenSop?: (sop: SopDocument) => void;
  onRefresh: () => Promise<void>;
  onUpdatePinned: (
    doc: PinnedChartDocument,
    patch: {
      title?: string;
      subtitle?: string;
      chartType?: ChartType;
      palette?: ChartColorPalette;
      activeSeriesIndices?: number[];
      showDataLabels?: boolean;
      sortMode?: ChartSortMode;
      speakerNotes?: string;
      displayOrder?: number;
      isShared?: boolean;
    }
  ) => Promise<void>;
  onDeletePinned: (chartId: string) => Promise<void>;
  onAskAiQuestion: (question: string) => void;
  pendingSummary?: PendingTransactionsSummaryResponse | null;
  pendingLoading?: boolean;
  pendingError?: string | null;
  onSelectPendingRule?: (rule: PendingRuleEvaluation) => void;
  onRefreshPending?: () => void;
}

export const ExecutiveDashboardView: React.FC<ExecutiveDashboardViewProps> = ({
  user,
  sops = [],
  meetings = [],
  assets = [],
  urgentMaintenanceCount = 0,
  activeRemindersCount = 0,
  pinnedCharts,
  loading,
  appDark,
  onNavigateView,
  onOpenSop,
  onRefresh,
  onUpdatePinned,
  onDeletePinned,
  onAskAiQuestion,
  pendingSummary = null,
  pendingLoading = false,
  pendingError = null,
  onSelectPendingRule,
  onRefreshPending,
}) => {
  const { t, formatNumber, formatDate } = useI18n();
  const [scopeFilter, setScopeFilter] = useState<'all' | 'mine' | 'shared'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [layoutCols, setLayoutCols] = useState<1 | 2>(2);
  const [refreshing, setRefreshing] = useState(false);

  // Slideshow Deck Mode state
  const [deckIndex, setDeckIndex] = useState<number | null>(null);
  const [deckOverride, setDeckOverride] = useState<{
    chartType?: ChartType;
    palette?: ChartColorPalette;
    activeSeriesIndices?: number[];
    showDataLabels?: boolean;
    sortMode?: ChartSortMode;
  }>({});

  const isAdmin = user.role === 'Super Admin';
  const translatedRole = t(`roles.${user.role}`);

  const approvedSopsCount = useMemo(
    () => sops.filter((s) => s.status === 'Disetujui').length,
    [sops]
  );

  const scheduledMeetingsCount = useMemo(
    () => meetings.filter((m) => m.status === 'Terjadwal').length,
    [meetings]
  );

  const recentSops = useMemo(
    () =>
      [...sops]
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
        .slice(0, 6),
    [sops]
  );

  const mineCount = useMemo(
    () => pinnedCharts.filter((c) => c.ownerUid === user.uid).length,
    [pinnedCharts, user.uid]
  );
  const sharedCount = useMemo(
    () => pinnedCharts.filter((c) => c.isShared).length,
    [pinnedCharts]
  );

  const filteredCharts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return pinnedCharts.filter((chart) => {
      if (scopeFilter === 'mine' && chart.ownerUid !== user.uid) return false;
      if (scopeFilter === 'shared' && !chart.isShared) return false;
      if (!q) return true;
      return (
        chart.title.toLowerCase().includes(q) ||
        chart.subtitle.toLowerCase().includes(q) ||
        chart.speakerNotes.toLowerCase().includes(q) ||
        chart.sourceQuestion.toLowerCase().includes(q) ||
        chart.ownerName.toLowerCase().includes(q)
      );
    });
  }, [pinnedCharts, scopeFilter, searchQuery, user.uid]);

  const starterPrompts = useMemo(
    () => [
      {
        title: t('dashboard.starter1Title'),
        description: t('dashboard.starter1Desc'),
        prompt:
          'Tampilkan rekap bulanan Pendapatan, HPP, dan Laba Bersih dari ERP mulai Maret 2026 dalam bentuk tabel untuk bahan presentasi grafik.',
      },
      {
        title: t('dashboard.starter2Title'),
        description: t('dashboard.starter2Desc'),
        prompt:
          'Buatkan tabel top 10 customer dengan sisa piutang terbesar saat ini dari ERP untuk bahan presentasi diagram.',
      },
      {
        title: t('dashboard.starter3Title'),
        description: t('dashboard.starter3Desc'),
        prompt:
          'Ringkas total nilai perolehan dan sisa nilai buku aset tetap perusahaan per kategori dalam tabel untuk bahan presentasi.',
      },
    ],
    [t]
  );

  const quickActions = useMemo(
    () => [
      {
        view: 'erp-stock' as ActiveView,
        icon: Package,
        title: t('dashboard.quickAccess.erpTitle'),
        subtitle: t('dashboard.quickAccess.erpSub'),
      },
      {
        view: 'chat' as ActiveView,
        icon: MessageSquareText,
        title: t('dashboard.quickAccess.chatTitle'),
        subtitle: t('dashboard.quickAccess.chatSub'),
      },
      {
        view: 'repository' as ActiveView,
        icon: BookOpen,
        title: t('dashboard.quickAccess.sopTitle'),
        subtitle: t('dashboard.quickAccess.sopSub'),
      },
      {
        view: 'assets' as ActiveView,
        icon: Wrench,
        title: t('dashboard.quickAccess.assetsTitle'),
        subtitle: t('dashboard.quickAccess.assetsSub'),
      },
      {
        view: 'meetings' as ActiveView,
        icon: Calendar,
        title: t('dashboard.quickAccess.meetingsTitle'),
        subtitle: t('dashboard.quickAccess.meetingsSub'),
      },
    ],
    [t]
  );

  const handleRefreshClick = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const handleMoveOrder = async (chartId: string, direction: 'up' | 'down') => {
    const idx = filteredCharts.findIndex((c) => c.id === chartId);
    if (idx === -1) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= filteredCharts.length) return;

    const current = filteredCharts[idx];
    const target = filteredCharts[swapIdx];
    const currentOrder = current.displayOrder ?? idx;
    const targetOrder = target.displayOrder ?? swapIdx;
    const nextCurrentOrder = targetOrder === currentOrder ? swapIdx : targetOrder;
    const nextTargetOrder = targetOrder === currentOrder ? idx : currentOrder;

    await Promise.all([
      onUpdatePinned(current, { displayOrder: nextCurrentOrder }),
      onUpdatePinned(target, { displayOrder: nextTargetOrder }),
    ]);
  };

  const openDeckAt = (index: number) => {
    if (filteredCharts.length === 0) return;
    const safeIdx = Math.max(0, Math.min(filteredCharts.length - 1, index));
    setDeckOverride({});
    setDeckIndex(safeIdx);
  };

  const activeDeckChart =
    deckIndex !== null && filteredCharts[deckIndex] ? filteredCharts[deckIndex] : null;

  const canEditDeckChart = Boolean(
    activeDeckChart && (activeDeckChart.ownerUid === user.uid || isAdmin)
  );

  const handleDeckPatch = (patch: {
    chartType?: ChartType;
    palette?: ChartColorPalette;
    activeSeriesIndices?: number[];
    showDataLabels?: boolean;
    sortMode?: ChartSortMode;
  }) => {
    setDeckOverride((prev) => ({ ...prev, ...patch }));
    if (activeDeckChart && canEditDeckChart) {
      void onUpdatePinned(activeDeckChart, patch);
    }
  };

  const renderSopStatusText = (status: SopDocument['status']) => {
    const labelMap: Record<SopDocument['status'], string> = {
      Disetujui: t('sop.statusApproved'),
      Review: t('sop.statusReview'),
      Draft: t('sop.statusDraft'),
      Arsip: t('sop.statusArchive'),
    };
    const toneClass =
      status === 'Disetujui'
        ? 'text-[var(--success)]'
        : status === 'Review'
          ? 'text-[var(--warning)]'
          : 'text-[var(--text-muted)]';
    return (
      <span className={`text-xs font-semibold ${toneClass}`}>
        {labelMap[status] || status}
      </span>
    );
  };

  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-4 sm:p-6 lg:p-8">
      {/* Greeting Header — clean corporate typography without ornamental bars */}
      <div className="flex flex-wrap items-end justify-between gap-4 pb-5 border-b border-[var(--border)]">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
            <span>{translatedRole}</span>
            <span aria-hidden="true">·</span>
            <span>{user.divisionName || t('common.general')}</span>
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-[var(--text)]">
            {t('dashboard.greeting', { name: user.displayName })}
          </h1>
          <p className="text-sm text-[var(--text-muted)]">{t('dashboard.subtitle')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => openDeckAt(0)}
            disabled={filteredCharts.length === 0}
            className="inline-flex items-center gap-2 h-9 px-4 text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] disabled:opacity-45 disabled:cursor-not-allowed rounded-[8px] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            <span>{t('dashboard.startPresentation', { count: filteredCharts.length })}</span>
          </button>

          <button
            type="button"
            onClick={() => onAskAiQuestion('')}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium text-[var(--text)] bg-[var(--surface)] border border-[var(--border-strong)] dark:border-[var(--border)] hover:bg-[var(--surface-2)] hover:border-[var(--accent)] rounded-[8px] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <MessageSquarePlus className="h-3.5 w-3.5 text-[var(--accent-text)]" />
            <span>{t('dashboard.createChartAi')}</span>
          </button>

          <button
            type="button"
            onClick={handleRefreshClick}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium text-[var(--text)] bg-[var(--surface)] border border-[var(--border-strong)] dark:border-[var(--border)] hover:bg-[var(--surface-2)] hover:border-[var(--text-muted)] disabled:opacity-50 rounded-[8px] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{t('common.refresh')}</span>
          </button>
        </div>
      </div>

      {/* Unified 4-Column Corporate KPI Strip (Single elevation, equal proportions, hairline dividers) */}
      <div className="rounded-[10px] bg-[var(--surface)] border border-[var(--border)] overflow-hidden grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[var(--border)]">
        {/* KPI 1: Approved SOPs */}
        <button
          type="button"
          onClick={() => onNavigateView?.('repository')}
          className="group text-left p-5 flex flex-col justify-between gap-3 hover:bg-[var(--surface-2)]/55 transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[var(--text-muted)] truncate">
              {t('dashboard.kpi.approvedSops')}
            </span>
            <BookOpen className="w-4 h-4 text-[var(--accent-text)] shrink-0" />
          </div>
          <div>
            <p className="font-mono tabular-nums text-[28px] font-semibold tracking-tight text-[var(--text)] leading-none">
              {formatNumber(approvedSopsCount)}
            </p>
            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
              <span className="truncate">
                {t('dashboard.kpi.approvedSopsSub', { total: formatNumber(sops.length) })}
              </span>
              <ArrowUpRight className="w-3.5 h-3.5 text-[var(--text-subtle)] group-hover:text-[var(--accent-text)] transition-colors shrink-0" />
            </div>
          </div>
        </button>

        {/* KPI 2: Assets & Maintenance */}
        <button
          type="button"
          onClick={() => onNavigateView?.('assets')}
          className="group text-left p-5 flex flex-col justify-between gap-3 hover:bg-[var(--surface-2)]/55 transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[var(--text-muted)] truncate">
              {t('dashboard.kpi.activeAssets')}
            </span>
            <Wrench className="w-4 h-4 text-[var(--text-subtle)] group-hover:text-[var(--accent-text)] transition-colors shrink-0" />
          </div>
          <div>
            <p className="font-mono tabular-nums text-[28px] font-semibold tracking-tight text-[var(--text)] leading-none">
              {formatNumber(assets.length)}
            </p>
            <div className="mt-2 flex items-center justify-between gap-2 text-xs">
              <span
                className={`font-medium truncate ${
                  urgentMaintenanceCount > 0 ? 'text-[var(--danger)]' : 'text-[var(--success)]'
                }`}
              >
                {urgentMaintenanceCount > 0
                  ? t('dashboard.kpi.urgentCount', { count: formatNumber(urgentMaintenanceCount) })
                  : t('dashboard.kpi.allNominal')}
              </span>
              <ArrowUpRight className="w-3.5 h-3.5 text-[var(--text-subtle)] group-hover:text-[var(--accent-text)] transition-colors shrink-0" />
            </div>
          </div>
        </button>

        {/* KPI 3: Meetings */}
        <button
          type="button"
          onClick={() => onNavigateView?.('meetings')}
          className="group text-left p-5 flex flex-col justify-between gap-3 hover:bg-[var(--surface-2)]/55 transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[var(--text-muted)] truncate">
              {t('dashboard.kpi.upcomingMeetings')}
            </span>
            <Calendar className="w-4 h-4 text-[var(--text-subtle)] group-hover:text-[var(--accent-text)] transition-colors shrink-0" />
          </div>
          <div>
            <p className="font-mono tabular-nums text-[28px] font-semibold tracking-tight text-[var(--text)] leading-none">
              {formatNumber(scheduledMeetingsCount)}
            </p>
            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
              <span className="truncate">
                {t('dashboard.kpi.remindersCount', { count: formatNumber(activeRemindersCount) })}
              </span>
              <ArrowUpRight className="w-3.5 h-3.5 text-[var(--text-subtle)] group-hover:text-[var(--accent-text)] transition-colors shrink-0" />
            </div>
          </div>
        </button>

        {/* KPI 4: Pinned Charts */}
        <div className="p-5 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[var(--text-muted)] truncate">
              {t('dashboard.kpi.pinnedCharts')}
            </span>
            <BarChart3 className="w-4 h-4 text-[var(--text-subtle)] shrink-0" />
          </div>
          <div>
            <p className="font-mono tabular-nums text-[28px] font-semibold tracking-tight text-[var(--text)] leading-none">
              {formatNumber(pinnedCharts.length)}
            </p>
            <p className="mt-2 text-xs text-[var(--text-muted)] truncate">
              {t('dashboard.kpi.sharedCount', { count: formatNumber(sharedCount) })}
            </p>
          </div>
        </div>
      </div>

      {/* Action Needed ("Perlu Tindakan") — Pending ERP Transactions grouped by module */}
      {onSelectPendingRule && (
        <DashboardActionNeededSection
          summary={pendingSummary}
          loading={pendingLoading}
          error={pendingError}
          onSelectRule={onSelectPendingRule}
          onRefresh={() => onRefreshPending?.()}
        />
      )}

      {/* Quick Access + Recent Activity Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Quick Access List Panel (Single flat surface with hairline dividers, no card-in-card nesting) */}
        <section className="lg:col-span-4 rounded-[10px] bg-[var(--surface)] border border-[var(--border)] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[var(--border)]">
            <h2 className="font-display text-sm font-semibold text-[var(--text)]">
              {t('dashboard.quickAccessTitle')}
            </h2>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {quickActions.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.view}
                  type="button"
                  onClick={() => onNavigateView?.(item.view)}
                  className="group w-full text-left flex items-center gap-3 px-5 py-3.5 hover:bg-[var(--surface-2)]/65 transition-colors cursor-pointer"
                >
                  <Icon
                    className="w-4 h-4 text-[var(--accent-text)] shrink-0"
                    strokeWidth={1.8}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-[var(--text)] truncate">
                      {item.title}
                    </p>
                    <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">
                      {item.subtitle}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-[var(--text-subtle)] group-hover:text-[var(--accent-text)] group-hover:translate-x-0.5 transition-all shrink-0" />
                </button>
              );
            })}
          </div>
        </section>

        {/* Recent Documents / Operational Activity Table */}
        <section className="lg:col-span-8 rounded-[10px] bg-[var(--surface)] border border-[var(--border)] overflow-hidden min-w-0">
          <div className="px-5 py-3.5 border-b border-[var(--border)] flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-display text-sm font-semibold text-[var(--text)]">
                {t('dashboard.recentActivityTitle')}
              </h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">
                {t('dashboard.recentActivitySub')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigateView?.('repository')}
              className="text-xs font-semibold text-[var(--accent-text)] hover:underline underline-offset-4 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {t('common.viewAll')}
            </button>
          </div>

          {loading && recentSops.length === 0 ? (
            <div className="p-4 space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-9 rounded bg-[var(--surface-3)] dark:bg-[var(--surface-2)] animate-pulse"
                />
              ))}
            </div>
          ) : recentSops.length === 0 ? (
            <div className="px-6 py-10 text-center text-xs text-[var(--text-muted)]">
              {t('dashboard.noRecentActivity')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-[var(--surface-2)]/70 border-b border-[var(--border)] text-[var(--text-muted)]">
                    <th className="px-4 py-2.5 font-semibold whitespace-nowrap">
                      {t('dashboard.colCode')}
                    </th>
                    <th className="px-4 py-2.5 font-semibold">{t('dashboard.colTitle')}</th>
                    <th className="px-4 py-2.5 font-semibold whitespace-nowrap">
                      {t('dashboard.colDivision')}
                    </th>
                    <th className="px-4 py-2.5 font-semibold whitespace-nowrap">
                      {t('dashboard.colStatus')}
                    </th>
                    <th className="px-4 py-2.5 font-semibold text-right whitespace-nowrap">
                      {t('dashboard.colDate')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]/75">
                  {recentSops.map((sop) => (
                    <tr
                      key={sop.id}
                      onClick={() => onOpenSop?.(sop)}
                      className="hover:bg-[var(--surface-2)]/55 transition-colors cursor-pointer"
                    >
                      <td className="px-4 py-3 font-mono font-semibold text-[var(--accent-text)] whitespace-nowrap">
                        {sop.docNumber}
                      </td>
                      <td className="px-4 py-3 text-[var(--text)] font-medium max-w-[260px] truncate">
                        {sop.title}
                      </td>
                      <td className="px-4 py-3 text-[var(--text-muted)] whitespace-nowrap">
                        {sop.divisionName || '-'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {renderSopStatusText(sop.status)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-[var(--text-muted)] whitespace-nowrap">
                        {formatDate(
                          sop.nextReviewDate ||
                            (typeof sop.updatedAt === 'string' || typeof sop.updatedAt === 'number'
                              ? sop.updatedAt
                              : sop.updatedAt &&
                                  typeof sop.updatedAt === 'object' &&
                                  'toDate' in sop.updatedAt &&
                                  typeof (sop.updatedAt as { toDate?: () => Date }).toDate === 'function'
                                ? (sop.updatedAt as { toDate: () => Date }).toDate()
                                : null)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* Executive Presentation Deck Section */}
      <section className="space-y-4 pt-4 border-t border-[var(--border)]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display text-base sm:text-lg font-semibold text-[var(--text)]">
                {t('dashboard.deckTitle')}
              </h2>
              <span className="font-mono text-xs font-semibold tabular-nums text-[var(--text-muted)]">
                ({t('dashboard.deckCount', { count: formatNumber(pinnedCharts.length) })})
              </span>
            </div>
            <p className="mt-1 text-xs sm:text-sm text-[var(--text-muted)]">
              {t('dashboard.deckSubtitle')}
            </p>
          </div>
        </div>

        {/* Filter, Search & Layout Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1">
            <button
              type="button"
              onClick={() => setScopeFilter('all')}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                scopeFilter === 'all'
                  ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
              }`}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              <span>{t('dashboard.filterAll', { count: formatNumber(pinnedCharts.length) })}</span>
            </button>
            <button
              type="button"
              onClick={() => setScopeFilter('mine')}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                scopeFilter === 'mine'
                  ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
              }`}
            >
              <Lock className="h-3.5 w-3.5" />
              <span>{t('dashboard.filterMine', { count: formatNumber(mineCount) })}</span>
            </button>
            <button
              type="button"
              onClick={() => setScopeFilter('shared')}
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                scopeFilter === 'shared'
                  ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                  : 'text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
              }`}
            >
              <Globe className="h-3.5 w-3.5" />
              <span>{t('dashboard.filterShared', { count: formatNumber(sharedCount) })}</span>
            </button>
          </div>

          <div className="flex flex-1 flex-wrap items-center justify-end gap-2 sm:flex-initial">
            <div className="relative min-w-[220px] flex-1 sm:w-64 sm:flex-initial">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('dashboard.searchChartsPlaceholder')}
                className="w-full h-10 rounded-lg border border-[var(--border-strong)] dark:border-[var(--border)] bg-[var(--input-bg)] dark:bg-[var(--surface)] pl-9 pr-3 text-xs text-[var(--text)] placeholder:text-[var(--text-subtle)] dark:placeholder:text-[var(--text-muted)] focus:border-[var(--accent-text)] dark:focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--focus-ring)] focus:outline-none"
              />
            </div>

            <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1">
              <button
                type="button"
                onClick={() => setLayoutCols(1)}
                className={`rounded-md p-1.5 transition cursor-pointer ${
                  layoutCols === 1
                    ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
                title={t('dashboard.col1Title')}
              >
                <Rows2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setLayoutCols(2)}
                className={`rounded-md p-1.5 transition cursor-pointer ${
                  layoutCols === 2
                    ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
                title={t('dashboard.col2Title')}
              >
                <Columns2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Deck Content */}
        {loading && pinnedCharts.length === 0 ? (
          <div className="grid gap-5 lg:grid-cols-2">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="h-80 animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface)]"
              />
            ))}
          </div>
        ) : filteredCharts.length === 0 ? (
          <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
            <h3 className="font-display text-base font-semibold text-[var(--text)]">
              {pinnedCharts.length === 0
                ? t('dashboard.emptyTitle')
                : t('dashboard.emptyFilteredTitle')}
            </h3>
            <p className="mx-auto mt-1 max-w-xl text-xs leading-relaxed text-[var(--text-muted)]">
              {pinnedCharts.length === 0
                ? t('dashboard.emptyDesc')
                : t('dashboard.emptyFilteredDesc')}
            </p>

            {pinnedCharts.length === 0 && (
              <div className="mx-auto mt-6 grid max-w-4xl gap-3 text-left sm:grid-cols-3">
                {starterPrompts.map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => onAskAiQuestion(item.prompt)}
                    className="group flex flex-col justify-between rounded-[8px] border border-[var(--border)] bg-[var(--bg)]/60 p-4 transition hover:border-[var(--accent)] cursor-pointer"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 text-xs font-mono font-semibold text-[var(--accent-text)]">
                        <span>0{idx + 1}</span>
                        <ArrowUpRight className="h-3.5 w-3.5 text-[var(--text-subtle)] group-hover:text-[var(--accent-text)] transition-colors" />
                      </div>
                      <h4 className="mt-2 text-sm font-semibold text-[var(--text)]">
                        {item.title}
                      </h4>
                      <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
                        {item.description}
                      </p>
                    </div>
                    <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[var(--accent-text)] group-hover:underline">
                      <span>{t('dashboard.starterCta')}</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div
            className={`grid gap-5 ${
              layoutCols === 2 ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1'
            }`}
          >
            {filteredCharts.map((chart, idx) => {
              const spec: AiChartSpec = {
                title: chart.title,
                subtitle: chart.subtitle,
                recommendedType: chart.chartType,
                valueFormat: chart.valueFormat,
                unitLabel: chart.unitLabel,
                categoryLabel: chart.categoryLabel,
                labels: chart.labels,
                series: chart.series,
                insightSummary: chart.speakerNotes,
                sourceLabel: chart.sourceLabel,
              };
              const canEditCard = chart.ownerUid === user.uid || isAdmin;

              return (
                <PresentationChartCard
                  key={chart.id}
                  mode="dashboard"
                  spec={spec}
                  pinnedDoc={chart}
                  sourceQuestion={chart.sourceQuestion}
                  canEdit={canEditCard}
                  appDark={appDark}
                  compact={layoutCols === 2}
                  onUpdatePinned={onUpdatePinned}
                  onDeletePinned={onDeletePinned}
                  onMoveOrder={handleMoveOrder}
                  canMoveUp={idx > 0}
                  canMoveDown={idx < filteredCharts.length - 1}
                  onReAskAi={(q) => onAskAiQuestion(q)}
                  onRequestDeckAtHere={() => openDeckAt(idx)}
                />
              );
            })}
          </div>
        )}
      </section>

      {/* Multi-Slide Fullscreen Presentation Deck Modal */}
      {activeDeckChart && deckIndex !== null && (
        <FullscreenPresentationModal
          isOpen={true}
          onClose={() => {
            setDeckIndex(null);
            setDeckOverride({});
          }}
          title={activeDeckChart.title}
          subtitle={activeDeckChart.subtitle}
          sourceLabel={activeDeckChart.sourceLabel || 'NARA AI · Dashboard'}
          categoryLabel={activeDeckChart.categoryLabel}
          labels={activeDeckChart.labels}
          series={activeDeckChart.series}
          valueFormat={activeDeckChart.valueFormat}
          unitLabel={activeDeckChart.unitLabel}
          chartType={deckOverride.chartType ?? activeDeckChart.chartType}
          onChangeChartType={(ct) => handleDeckPatch({ chartType: ct })}
          palette={deckOverride.palette ?? activeDeckChart.palette}
          onChangePalette={(p) => handleDeckPatch({ palette: p })}
          activeSeriesIndices={
            deckOverride.activeSeriesIndices ??
            (activeDeckChart.activeSeriesIndices?.length
              ? activeDeckChart.activeSeriesIndices
              : activeDeckChart.series.map((_, i) => i))
          }
          onToggleSeries={(sIdx) => {
            const current =
              deckOverride.activeSeriesIndices ??
              (activeDeckChart.activeSeriesIndices?.length
                ? activeDeckChart.activeSeriesIndices
                : activeDeckChart.series.map((_, i) => i));
            const exists = current.includes(sIdx);
            if (exists && current.length <= 1) return;
            const next = exists
              ? current.filter((i) => i !== sIdx)
              : [...current, sIdx].sort((a, b) => a - b);
            handleDeckPatch({ activeSeriesIndices: next });
          }}
          showDataLabels={deckOverride.showDataLabels ?? activeDeckChart.showDataLabels}
          onToggleDataLabels={() =>
            handleDeckPatch({
              showDataLabels: !(deckOverride.showDataLabels ?? activeDeckChart.showDataLabels),
            })
          }
          sortMode={deckOverride.sortMode ?? activeDeckChart.sortMode}
          onChangeSortMode={(s) => handleDeckPatch({ sortMode: s })}
          speakerNotes={activeDeckChart.speakerNotes}
          appDark={appDark}
          slideIndex={deckIndex}
          slideCount={filteredCharts.length}
          onPrevSlide={() => {
            setDeckOverride({});
            setDeckIndex((curr) =>
              curr === null ? 0 : (curr - 1 + filteredCharts.length) % filteredCharts.length
            );
          }}
          onNextSlide={() => {
            setDeckOverride({});
            setDeckIndex((curr) =>
              curr === null ? 0 : (curr + 1) % filteredCharts.length
            );
          }}
        />
      )}
    </div>
  );
};
