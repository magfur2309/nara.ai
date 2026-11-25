import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Factory,
  Landmark,
  Layers,
  Menu,
  Package,
  PieChart,
  Search,
  ShoppingCart,
  TrendingUp,
  X,
} from 'lucide-react';
import { BI_MODULES } from '../config/biModules';
import { hasMenuPermission, type RolePermissionMatrix } from '../config/menuRegistry';
import { useI18n, type LocaleCode } from '../lib/i18n';
import type {
  BiKpiMenuDefinition,
  BiModuleDefinition,
  BiModuleId,
} from '../types/businessIntelligence';
import type { CreatePinnedChartInput } from '../lib/pinnedChartService';
import type { PinnedChartDocument } from '../types/sop';
import { AccessDeniedView } from './AccessDeniedView';
import { BiChartActionsProvider } from './bi/BiChartActionsContext';

interface ErpBusinessIntelligencePanelProps {
  idToken: string;
  onDownloadBridge?: () => void;
  rbacPermissions?: RolePermissionMatrix | null;
  pinnedCharts?: PinnedChartDocument[];
  onPinChart?: (payload: CreatePinnedChartInput) => Promise<void>;
  onOpenDashboard?: () => void;
}

const BI_MODULE_MENU_MAP: Record<BiModuleId, string> = {
  accounting: 'erp_bi_finance',
  sales: 'erp_bi_sales',
  purchasing: 'erp_bi_purchasing',
  inventory: 'erp_bi_inventory',
  production: 'erp_bi_production',
};

type BiActiveScope = 'overview' | BiModuleId;

const MODULE_ICONS: Record<BiModuleId, React.ComponentType<{ className?: string }>> = {
  accounting: Landmark,
  sales: TrendingUp,
  purchasing: ShoppingCart,
  inventory: Package,
  production: Factory,
};

function formatKpiCode(kpi: Pick<BiKpiMenuDefinition, 'order' | 'code'>): string {
  return kpi.code || String(Math.floor(kpi.order)).padStart(2, '0');
}

function translateChartTypeLabel(raw: string, locale: LocaleCode): string {
  if (locale === 'id') return raw;
  const s = raw.toLowerCase();
  if (locale === 'ja') {
    if (s.includes('piramida')) return 'ピラミッド縦棒グラフ';
    if (s.includes('kerucut')) return '円錐縦棒グラフ';
    if (s.includes('silinder')) return '円柱縦棒グラフ';
    if (s.includes('horizontal')) return '横棒グラフ';
    if (s.includes('garis') || s.includes('line')) return '折れ線グラフ';
    if (s.includes('area')) return '面グラフ';
    if (s.includes('matriks') || s.includes('lead time')) return 'リードタイムマトリクス (0–14日)';
    if (s.includes('donat') || s.includes('donut')) return 'ドーナツグラフ';
    if (s.includes('kolom') || s.includes('batang') || s.includes('balok')) return '縦棒グラフ';
    if (s.includes('perbandingan')) return '比較グラフ';
    return raw;
  }
  if (s.includes('piramida')) return 'Vertical Pyramid Chart';
  if (s.includes('kerucut')) return 'Vertical Cone Chart';
  if (s.includes('silinder')) return 'Vertical Cylinder Chart';
  if (s.includes('horizontal')) return 'Horizontal Bar Chart';
  if (s.includes('garis') || s.includes('line')) return 'Line Chart';
  if (s.includes('area')) return 'Area Chart';
  if (s.includes('matriks') || s.includes('lead time')) return 'Lead Time Matrix (0–14 Days)';
  if (s.includes('donat') || s.includes('donut')) return 'Donut Chart';
  if (s.includes('kolom') || s.includes('batang') || s.includes('balok')) return 'Vertical Column Chart';
  if (s.includes('perbandingan')) return 'Comparison Chart';
  return raw;
}

export const ErpBusinessIntelligencePanel: React.FC<ErpBusinessIntelligencePanelProps> = ({
  idToken,
  onDownloadBridge,
  rbacPermissions,
  pinnedCharts = [],
  onPinChart,
  onOpenDashboard,
}) => {
  const { t, locale } = useI18n();

  const getModuleName = (mod: BiModuleDefinition): string => {
    const key = `bi.modules.${mod.id}.name`;
    const val = t(key);
    return val !== key ? val : mod.name;
  };

  const getModuleDescription = (mod: BiModuleDefinition): string => {
    const key = `bi.modules.${mod.id}.description`;
    const val = t(key);
    return val !== key ? val : mod.description;
  };

  const getCategoryLabel = (category: string): string => {
    const key = `bi.categories.${category}`;
    const val = t(key);
    return val !== key ? val : category;
  };

  const allowedModules = useMemo<BiModuleDefinition[]>(() => {
    if (!rbacPermissions) return BI_MODULES;
    return BI_MODULES.filter((mod) =>
      hasMenuPermission(rbacPermissions, BI_MODULE_MENU_MAP[mod.id], 'view')
    );
  }, [rbacPermissions]);

  // Default to the first allowed module that already has active KPIs so users land directly on live insights
  const defaultScope = useMemo<BiActiveScope>(() => {
    const firstActive = allowedModules.find((m) => m.kpiMenus.length > 0);
    return firstActive ? firstActive.id : 'overview';
  }, [allowedModules]);

  const [activeScope, setActiveScope] = useState<BiActiveScope>(defaultScope);
  const [selectedKpiByModule, setSelectedKpiByModule] = useState<Partial<Record<BiModuleId, string>>>(
    {}
  );
  const [openCategoryByModule, setOpenCategoryByModule] = useState<
    Partial<Record<BiModuleId, string | null>>
  >({});
  const [globalSearch, setGlobalSearch] = useState<string>('');
  const [moduleKpiSearch, setModuleKpiSearch] = useState<string>('');
  const [mobileKpiDrawerOpen, setMobileKpiDrawerOpen] = useState<boolean>(false);

  const effectiveScope: BiActiveScope = useMemo(() => {
    if (activeScope === 'overview') return 'overview';
    if (allowedModules.some((m) => m.id === activeScope)) return activeScope;
    return defaultScope;
  }, [activeScope, allowedModules, defaultScope]);

  const activeModule = useMemo<BiModuleDefinition | null>(() => {
    if (effectiveScope === 'overview') return null;
    return allowedModules.find((m) => m.id === effectiveScope) || null;
  }, [effectiveScope, allowedModules]);

  const allRegisteredKpis = useMemo(
    () =>
      allowedModules.flatMap((mod) =>
        mod.kpiMenus.map((kpi) => ({
          module: mod,
          kpi,
        }))
      ),
    [allowedModules]
  );

  const filteredGlobalKpis = useMemo(() => {
    const q = globalSearch.trim().toLowerCase();
    if (!q) return [];
    return allRegisteredKpis.filter(
      ({ module, kpi }) =>
        kpi.title.toLowerCase().includes(q) ||
        kpi.category.toLowerCase().includes(q) ||
        getCategoryLabel(kpi.category).toLowerCase().includes(q) ||
        kpi.shortDescription.toLowerCase().includes(q) ||
        module.name.toLowerCase().includes(q) ||
        getModuleName(module).toLowerCase().includes(q)
    );
  }, [allRegisteredKpis, globalSearch, locale]);

  const activeKpiMenu = useMemo<BiKpiMenuDefinition | null>(() => {
    if (!activeModule || activeModule.kpiMenus.length === 0) return null;
    const savedId = selectedKpiByModule[activeModule.id];
    return activeModule.kpiMenus.find((k) => k.id === savedId) || activeModule.kpiMenus[0];
  }, [activeModule, selectedKpiByModule]);

  // Group module KPI menus by category for scalable navigation (supports 16-30+ dashboards cleanly)
  const groupedModuleKpis = useMemo(() => {
    if (!activeModule) return [];
    const q = moduleKpiSearch.trim().toLowerCase();
    const filtered = activeModule.kpiMenus.filter((kpi) => {
      if (!q) return true;
      return (
        kpi.title.toLowerCase().includes(q) ||
        kpi.category.toLowerCase().includes(q) ||
        getCategoryLabel(kpi.category).toLowerCase().includes(q) ||
        kpi.shortDescription.toLowerCase().includes(q) ||
        formatKpiCode(kpi).toLowerCase().includes(q)
      );
    });

    const map = new Map<string, BiKpiMenuDefinition[]>();
    for (const kpi of filtered) {
      const cat = kpi.category || 'Umum';
      const list = map.get(cat) || [];
      list.push(kpi);
      map.set(cat, list);
    }

    return Array.from(map.entries()).map(([category, items]) => ({
      category,
      items: items.sort((a, b) => a.order - b.order),
    }));
  }, [activeModule, moduleKpiSearch, locale]);

  const isSearchingModuleKpi = moduleKpiSearch.trim().length > 0;

  const activeOpenCategory = useMemo<string | null>(() => {
    if (!activeModule) return null;
    if (Object.prototype.hasOwnProperty.call(openCategoryByModule, activeModule.id)) {
      return openCategoryByModule[activeModule.id] ?? null;
    }
    return activeKpiMenu?.category || groupedModuleKpis[0]?.category || null;
  }, [activeModule, openCategoryByModule, activeKpiMenu, groupedModuleKpis]);

  const handleToggleCategory = (moduleId: BiModuleId, category: string) => {
    setOpenCategoryByModule((prev) => {
      const hasStored = Object.prototype.hasOwnProperty.call(prev, moduleId);
      const currentOpen = hasStored
        ? (prev[moduleId] ?? null)
        : activeKpiMenu?.category || groupedModuleKpis[0]?.category || null;
      return {
        ...prev,
        [moduleId]: currentOpen === category ? null : category,
      };
    });
  };

  const handleOpenModule = (moduleId: BiModuleId, kpiId?: string) => {
    setActiveScope(moduleId);
    setModuleKpiSearch('');
    setMobileKpiDrawerOpen(false);
    if (kpiId) {
      setSelectedKpiByModule((prev) => ({ ...prev, [moduleId]: kpiId }));
      const targetMod = BI_MODULES.find((m) => m.id === moduleId);
      const targetKpi = targetMod?.kpiMenus.find((k) => k.id === kpiId);
      if (targetKpi) {
        setOpenCategoryByModule((prev) => ({
          ...prev,
          [moduleId]: targetKpi.category || 'Umum',
        }));
      }
    }
  };

  const handleSelectKpiMenu = (moduleId: BiModuleId, kpiId: string, category?: string) => {
    setSelectedKpiByModule((prev) => ({ ...prev, [moduleId]: kpiId }));
    if (category) {
      setOpenCategoryByModule((prev) => ({ ...prev, [moduleId]: category }));
    }
    setMobileKpiDrawerOpen(false);
  };

  if (allowedModules.length === 0) {
    return <AccessDeniedView menuLabel={t('bi.title')} />;
  }

  return (
    <div className="space-y-5">
      {/* BI Hub Header & Single-Line Module Navigation */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-9 h-9 rounded-lg bg-[var(--accent)]/12 border border-[var(--accent)]/25 text-[var(--accent)] dark:text-[var(--accent-text)] flex items-center justify-center shrink-0">
              <PieChart className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h2 className="font-display text-lg font-bold text-[var(--text)] leading-tight truncate">
                {t('bi.title')}
              </h2>
              <p className="text-xs text-[var(--text-muted)]">{t('bi.subtitle')}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs text-[var(--text-muted)] tabular-nums shrink-0">
            <span>
              <strong className="font-semibold text-[var(--text)]">{allowedModules.length}</strong>{' '}
              {t('bi.erpModules')}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              <strong className="font-semibold text-[var(--accent)] dark:text-[var(--accent-text)]">
                {allRegisteredKpis.length}
              </strong>{' '}
              {t('bi.activeKpis')}
            </span>
          </div>
        </div>

        {/* Module Navigation Bar */}
        <div
          className="pt-3 border-t border-[var(--border)] flex items-center gap-1.5 overflow-x-auto pb-0.5"
          role="tablist"
          aria-label={t('bi.navAria')}
        >
          <button
            type="button"
            role="tab"
            aria-selected={effectiveScope === 'overview'}
            onClick={() => {
              setActiveScope('overview');
              setMobileKpiDrawerOpen(false);
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              effectiveScope === 'overview'
                ? 'bg-[var(--accent)] text-[var(--on-accent)] border-[var(--accent)] font-semibold'
                : 'bg-[var(--bg)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text)] hover:border-[var(--text-muted)]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>{t('bi.moduleOverview')}</span>
          </button>

          {allowedModules.map((mod) => {
            const Icon = MODULE_ICONS[mod.id];
            const isSelected = effectiveScope === mod.id;
            return (
              <button
                key={mod.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => handleOpenModule(mod.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  isSelected
                    ? 'bg-[var(--accent)] text-[var(--on-accent)] border-[var(--accent)] font-semibold'
                    : 'bg-[var(--bg)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text)] hover:border-[var(--text-muted)]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{getModuleName(mod)}</span>
                <span
                  className={`font-mono text-[11px] tabular-nums ${
                    isSelected ? 'opacity-85' : 'text-[var(--text-muted)]'
                  }`}
                >
                  ({mod.kpiMenus.length})
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Content Area: Overview Directory vs Scalable Master-Detail Module Workspace */}
      {effectiveScope === 'overview' || !activeModule ? (
        <div className="space-y-5">
          {/* Global BI KPI Quick Search */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-base font-bold text-[var(--text)]">
                {t('bi.directoryTitle')}
              </h3>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                {t('bi.directorySubtitle')}
              </p>
            </div>

            <div className="relative w-full sm:w-72 shrink-0">
              <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                placeholder={t('bi.searchPlaceholder')}
                className="w-full pl-9 pr-8 py-2 text-xs rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
              />
              {globalSearch && (
                <button
                  type="button"
                  onClick={() => setGlobalSearch('')}
                  aria-label={t('common.clearSearch')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Search Results Drawer when user searches globally */}
          {globalSearch.trim() !== '' && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-2.5">
              <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                <span>
                  {t('bi.searchResultsFor')}{' '}
                  <strong className="text-[var(--text)]">"{globalSearch}"</strong>
                </span>
                <span className="font-mono tabular-nums">{filteredGlobalKpis.length} KPI</span>
              </div>
              {filteredGlobalKpis.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)] py-2">{t('bi.noSearchMatch')}</p>
              ) : (
                <div className="divide-y divide-[var(--border)]">
                  {filteredGlobalKpis.map(({ module, kpi }) => (
                    <button
                      key={`${module.id}-${kpi.id}`}
                      type="button"
                      onClick={() => handleOpenModule(module.id, kpi.id)}
                      className="w-full py-2.5 px-2 text-left flex items-center justify-between gap-3 hover:bg-[var(--bg)] rounded-lg transition-colors cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-[var(--text)]">
                          {formatKpiCode(kpi)}. {kpi.title}
                        </div>
                        <div className="text-[11px] text-[var(--text-muted)] truncate">
                          {getModuleName(module)} · {getCategoryLabel(kpi.category)} ·{' '}
                          {translateChartTypeLabel(kpi.chartTypeLabel, locale)}
                        </div>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-[var(--accent)] dark:text-[var(--accent-text)] shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Module Directory Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {allowedModules.map((mod) => {
              const Icon = MODULE_ICONS[mod.id];
              const kpiCount = mod.kpiMenus.length;

              return (
                <div
                  key={mod.id}
                  className="bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--accent)]/70 rounded-xl p-5 flex flex-col justify-between gap-4 transition-colors"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="w-9 h-9 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[var(--accent)] dark:text-[var(--accent-text)] flex items-center justify-center shrink-0">
                        <Icon className="w-4 h-4" />
                      </span>
                      <span className="font-mono text-[11px] text-[var(--text-muted)]">
                        {kpiCount} KPI
                      </span>
                    </div>

                    <div className="space-y-1">
                      <h4 className="font-display text-base font-bold text-[var(--text)]">
                        {getModuleName(mod)}
                      </h4>
                      <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                        {getModuleDescription(mod)}
                      </p>
                    </div>

                    {/* Direct 1-click KPI Quick List inside active modules */}
                    {kpiCount > 0 && (
                      <div className="pt-2 border-t border-[var(--border)] space-y-1">
                        {mod.kpiMenus.slice(0, 4).map((kpi) => (
                          <button
                            key={kpi.id}
                            type="button"
                            onClick={() => handleOpenModule(mod.id, kpi.id)}
                            className="w-full px-2.5 py-1.5 rounded-lg text-left text-xs text-[var(--text)] hover:bg-[var(--bg)] hover:text-[var(--accent)] flex items-center justify-between gap-2 transition-colors cursor-pointer"
                          >
                            <span className="truncate">
                              <span className="font-mono text-[11px] text-[var(--text-muted)] mr-1.5">
                                {formatKpiCode(kpi)}.
                              </span>
                              <span className="font-medium">{kpi.title}</span>
                            </span>
                            <ChevronRight className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                          </button>
                        ))}
                        {kpiCount > 4 && (
                          <p className="px-2.5 text-[11px] text-[var(--text-muted)]">
                            {t('bi.moreDashboards', { count: kpiCount - 4 })}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="pt-3 border-t border-[var(--border)] flex items-center justify-between gap-2 text-xs">
                    <span className="text-[11px] text-[var(--text-muted)] tabular-nums">
                      {kpiCount > 0
                        ? t('bi.activeDashboards', { count: kpiCount })
                        : t('bi.readyToConfigure')}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleOpenModule(mod.id)}
                      className="inline-flex items-center gap-1 font-semibold text-[var(--accent)] dark:text-[var(--accent-text)] hover:underline cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <span>{t('bi.openModule')}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* Dedicated Module BI Workspace (Master-Detail Layout scalable to 16-30+ KPIs) */
        <div className="space-y-4">
          {/* Breadcrumb Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-muted)] px-1">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setActiveScope('overview')}
                className="inline-flex items-center gap-1 hover:text-[var(--accent)] dark:hover:text-[var(--accent-text)] transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>{t('bi.overviewBreadcrumb')}</span>
              </button>
              <ChevronRight className="w-3.5 h-3.5" />
              <span className="font-semibold text-[var(--text)]">
                {getModuleName(activeModule)}
              </span>
              {activeKpiMenu && (
                <>
                  <ChevronRight className="w-3.5 h-3.5" />
                  <span className="text-[var(--accent)] dark:text-[var(--accent-text)] font-medium">
                    {formatKpiCode(activeKpiMenu)}. {activeKpiMenu.title}
                  </span>
                </>
              )}
            </div>

            <span className="font-mono text-[11px] tabular-nums">
              {t('bi.kpiDashboardsCount', { count: activeModule.kpiMenus.length })}
            </span>
          </div>

          {activeModule.kpiMenus.length > 0 && activeKpiMenu ? (
            <div className="flex flex-col lg:flex-row gap-5 items-start">
              {/* Mobile / Tablet Compact KPI Switcher */}
              <div className="w-full lg:hidden bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setMobileKpiDrawerOpen((prev) => !prev)}
                  className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left cursor-pointer"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Menu className="w-4 h-4 text-[var(--accent)] dark:text-[var(--accent-text)] shrink-0" />
                    <div className="min-w-0">
                      <span className="block text-[11px] text-[var(--text-muted)]">
                        {t('bi.moduleKpiMenu', {
                          module: getModuleName(activeModule),
                          count: activeModule.kpiMenus.length,
                        })}
                      </span>
                      <span className="block text-xs font-semibold text-[var(--text)] truncate">
                        {formatKpiCode(activeKpiMenu)}. {activeKpiMenu.title}
                      </span>
                    </div>
                  </div>
                  <ChevronDown
                    className={`w-4 h-4 text-[var(--text-muted)] transition-transform ${
                      mobileKpiDrawerOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {mobileKpiDrawerOpen && (
                  <div className="px-3 pb-3 pt-2 border-t border-[var(--border)] space-y-3">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={moduleKpiSearch}
                        onChange={(e) => setModuleKpiSearch(e.target.value)}
                        placeholder={t('bi.searchModuleKpiPlaceholder', {
                          module: getModuleName(activeModule),
                        })}
                        className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                      />
                    </div>
                    <div className="divide-y divide-[var(--border)]/70 max-h-80 overflow-y-auto">
                      {groupedModuleKpis.map((group) => {
                        const isExpanded =
                          isSearchingModuleKpi || activeOpenCategory === group.category;
                        const hasActiveChild = group.items.some((k) => k.id === activeKpiMenu.id);
                        return (
                          <div key={group.category} className="py-1.5 first:pt-0 last:pb-0">
                            <button
                              type="button"
                              aria-expanded={isExpanded}
                              onClick={() => handleToggleCategory(activeModule.id, group.category)}
                              className="w-full px-2 py-2 rounded-lg flex items-center justify-between gap-2 text-left hover:bg-[var(--bg)] transition-colors cursor-pointer"
                            >
                              <span
                                className={`text-xs font-semibold truncate ${
                                  isExpanded || hasActiveChild
                                    ? 'text-[var(--accent)] dark:text-[var(--accent-text)]'
                                    : 'text-[var(--text)]'
                                }`}
                              >
                                {getCategoryLabel(group.category)}
                              </span>
                              <span className="inline-flex items-center gap-1.5 shrink-0">
                                <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                                  {group.items.length}
                                </span>
                                <ChevronDown
                                  className={`w-3.5 h-3.5 transition-transform duration-150 ${
                                    isExpanded
                                      ? 'rotate-180 text-[var(--accent)] dark:text-[var(--accent-text)]'
                                      : 'text-[var(--text-muted)]'
                                  }`}
                                />
                              </span>
                            </button>

                            {isExpanded && (
                              <div className="mt-1 space-y-0.5 pl-1">
                                {group.items.map((kpi) => {
                                  const isActive = kpi.id === activeKpiMenu.id;
                                  return (
                                    <button
                                      key={kpi.id}
                                      type="button"
                                      onClick={() =>
                                        handleSelectKpiMenu(activeModule.id, kpi.id, group.category)
                                      }
                                      className={`w-full px-2.5 py-2 rounded-lg text-left transition-colors cursor-pointer flex items-start gap-2 ${
                                        isActive
                                          ? 'bg-[var(--accent)]/12 text-[var(--accent)] dark:bg-[#108486]/16 dark:text-[var(--accent-text)]'
                                          : 'text-[var(--text)] hover:bg-[var(--bg)]'
                                      }`}
                                    >
                                      <span className="font-mono text-[11px] tabular-nums opacity-75 pt-0.5 shrink-0">
                                        {formatKpiCode(kpi)}
                                      </span>
                                      <div className="min-w-0">
                                        <div className="text-xs font-semibold truncate">
                                          {kpi.title}
                                        </div>
                                        <div className="text-[11px] text-[var(--text-muted)] truncate">
                                          {translateChartTypeLabel(kpi.chartTypeLabel, locale)}
                                        </div>
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Desktop Scalable Left KPI Directory Rail (Optimized for 16-30+ Dashboards) */}
              <aside
                aria-label={`${t('bi.kpiListTitle')} ${getModuleName(activeModule)}`}
                className="hidden lg:flex flex-col w-64 xl:w-72 shrink-0 bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden lg:sticky lg:top-4"
              >
                <div className="p-3.5 border-b border-[var(--border)] space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-[var(--text)]">
                      {t('bi.kpiListTitle')}
                    </span>
                    <span className="font-mono text-[11px] text-[var(--text-muted)] tabular-nums">
                      {t('bi.activeCount', { count: activeModule.kpiMenus.length })}
                    </span>
                  </div>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={moduleKpiSearch}
                      onChange={(e) => setModuleKpiSearch(e.target.value)}
                      placeholder={t('bi.searchMenuKpi')}
                      className="w-full pl-8 pr-7 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                    />
                    {moduleKpiSearch && (
                      <button
                        type="button"
                        onClick={() => setModuleKpiSearch('')}
                        aria-label={t('bi.clearMenuFilter')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                <nav className="p-2 divide-y divide-[var(--border)]/70 max-h-[calc(100vh-220px)] overflow-y-auto">
                  {groupedModuleKpis.length === 0 ? (
                    <p className="px-2.5 py-4 text-xs text-[var(--text-muted)] text-center">
                      {t('bi.noKpiMatch')}
                    </p>
                  ) : (
                    groupedModuleKpis.map((group) => {
                      const isExpanded =
                        isSearchingModuleKpi || activeOpenCategory === group.category;
                      const hasActiveChild = group.items.some((k) => k.id === activeKpiMenu.id);
                      return (
                        <div key={group.category} className="py-1.5 first:pt-0 last:pb-0">
                          <button
                            type="button"
                            aria-expanded={isExpanded}
                            onClick={() => handleToggleCategory(activeModule.id, group.category)}
                            className={`w-full px-2.5 py-2 rounded-lg flex items-center justify-between gap-2 text-left transition-colors cursor-pointer ${
                              isExpanded
                                ? 'bg-[var(--bg)]/80 text-[var(--accent)] dark:text-[var(--accent-text)]'
                                : 'text-[var(--text)] hover:bg-[var(--bg)]'
                            }`}
                          >
                            <span
                              className={`text-xs font-semibold truncate ${
                                isExpanded || hasActiveChild
                                  ? 'text-[var(--accent)] dark:text-[var(--accent-text)]'
                                  : 'text-[var(--text)]'
                              }`}
                            >
                              {getCategoryLabel(group.category)}
                            </span>
                            <span className="inline-flex items-center gap-1.5 shrink-0">
                              <span className="font-mono text-[11px] tabular-nums text-[var(--text-muted)]">
                                {group.items.length}
                              </span>
                              <ChevronDown
                                className={`w-3.5 h-3.5 transition-transform duration-150 ${
                                  isExpanded
                                    ? 'rotate-180 text-[var(--accent)] dark:text-[var(--accent-text)]'
                                    : 'text-[var(--text-muted)]'
                                }`}
                              />
                            </span>
                          </button>

                          {isExpanded && (
                            <div className="mt-1 space-y-0.5 pl-1">
                              {group.items.map((kpi) => {
                                const isActive = kpi.id === activeKpiMenu.id;
                                return (
                                  <button
                                    key={kpi.id}
                                    type="button"
                                    onClick={() =>
                                      handleSelectKpiMenu(activeModule.id, kpi.id, group.category)
                                    }
                                    className={`w-full px-2.5 py-2 rounded-lg text-left transition-colors cursor-pointer flex items-start gap-2.5 ${
                                      isActive
                                        ? 'bg-[var(--accent)]/12 text-[var(--accent)] dark:bg-[#108486]/16 dark:text-[var(--accent-text)]'
                                        : 'text-[var(--text)] hover:bg-[var(--bg)]'
                                    }`}
                                  >
                                    <span
                                      className={`font-mono text-[11px] tabular-nums pt-0.5 shrink-0 w-7 ${
                                        isActive
                                          ? 'text-[var(--accent)] dark:text-[var(--accent-text)] font-bold'
                                          : 'text-[var(--text-muted)]'
                                      }`}
                                    >
                                      {formatKpiCode(kpi)}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                      <div className="text-xs font-semibold leading-snug truncate">
                                        {kpi.title}
                                      </div>
                                      <div className="text-[11px] text-[var(--text-muted)] truncate mt-0.5">
                                        {translateChartTypeLabel(kpi.chartTypeLabel, locale)}
                                      </div>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </nav>
              </aside>

              {/* Main Right Dashboard Canvas */}
              <div className="flex-1 min-w-0 w-full">
                <BiChartActionsProvider
                  value={{
                    pinnedCharts,
                    onPinChart,
                    onOpenDashboard,
                    sourceModuleLabel: `Business Intelligence · ${getModuleName(activeModule)} · ${activeKpiMenu.title}`,
                  }}
                >
                  {activeKpiMenu.render({ idToken, onDownloadBridge })}
                </BiChartActionsProvider>
              </div>
            </div>
          ) : (
            /* Clean Empty Module Workspace awaiting official KPI specification */
            <div className="bg-[var(--surface)] border border-dashed border-[var(--border)] rounded-xl p-8 sm:p-10">
              <div className="max-w-2xl mx-auto text-center space-y-4">
                <div className="w-12 h-12 rounded-xl bg-[var(--bg)] border border-[var(--border)] text-[var(--accent)] flex items-center justify-center mx-auto">
                  <PieChart className="w-6 h-6" />
                </div>

                <div className="space-y-1.5">
                  <h4 className="font-display text-base font-bold text-[var(--text)]">
                    {t('bi.emptyModuleTitle', { module: getModuleName(activeModule) })}
                  </h4>
                  <p className="text-xs sm:text-sm text-[var(--text-muted)] leading-relaxed">
                    {t('bi.emptyModuleDesc', { module: getModuleName(activeModule) })}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

