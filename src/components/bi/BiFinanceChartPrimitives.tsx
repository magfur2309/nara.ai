import React, { useMemo, useState } from 'react';
import { AlertTriangle, Calendar, Download, Info, RefreshCw } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import {
  MONTH_FULL_ID,
  MONTH_SERIES_PALETTE,
  MONTH_SHORT_ID,
  computeNiceScale,
} from './biFinanceShared';
import {
  BiChartActionButtons,
  BiChartFullscreenModal,
  BiPinComposerPanel,
  detectBiValueFormat,
  mapBiShapeToPinnedChartType,
  useBiChartCardActions,
} from './BiChartActionsContext';

/* ============================================================================
 * 0. Universal 6-Shape Chart Type Selector (Balok, Kerucut, Silinder, Horizontal, Garis, Area)
 * ========================================================================== */

function safeFinite(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export type BiChartShape =
  | 'column'
  | 'cone'
  | 'cylinder'
  | 'horizontal'
  | 'line'
  | 'area';

export const BI_CHART_SHAPE_OPTIONS: Array<{
  id: BiChartShape;
  label: string;
  title: string;
}> = [
  { id: 'column', label: 'Balok', title: 'Diagram Balok / Kolom Vertikal' },
  { id: 'cone', label: 'Kerucut', title: 'Diagram Kerucut / Piramida' },
  { id: 'cylinder', label: 'Silinder', title: 'Diagram Silinder / Tabung' },
  { id: 'horizontal', label: 'Horizontal', title: 'Diagram Batang Horizontal' },
  { id: 'line', label: 'Garis', title: 'Diagram Garis (Line)' },
  { id: 'area', label: 'Area', title: 'Diagram Area' },
];

const ChartShapeMiniIcon: React.FC<{ shape: BiChartShape }> = ({ shape }) => {
  switch (shape) {
    case 'column':
      return (
        <svg viewBox="0 0 14 14" className="w-3 h-3 shrink-0" aria-hidden="true">
          <rect x="1.5" y="7" width="2.8" height="5.5" rx="0.6" fill="currentColor" />
          <rect x="5.6" y="3" width="2.8" height="9.5" rx="0.6" fill="currentColor" />
          <rect x="9.7" y="5" width="2.8" height="7.5" rx="0.6" fill="currentColor" />
        </svg>
      );
    case 'cone':
      return (
        <svg viewBox="0 0 14 14" className="w-3 h-3 shrink-0" aria-hidden="true">
          <polygon points="3.5,6.5 5.5,12.5 1.5,12.5" fill="currentColor" />
          <polygon points="7,2 9.2,12.5 4.8,12.5" fill="currentColor" />
          <polygon points="10.8,5 12.8,12.5 8.8,12.5" fill="currentColor" />
        </svg>
      );
    case 'cylinder':
      return (
        <svg viewBox="0 0 14 14" className="w-3 h-3 shrink-0" aria-hidden="true">
          <ellipse cx="4" cy="5.5" rx="2" ry="0.9" fill="currentColor" opacity="0.65" />
          <path d="M2,5.5 v6 a2,0.9 0 0,0 4,0 v-6 z" fill="currentColor" />
          <ellipse cx="10" cy="3" rx="2" ry="0.9" fill="currentColor" opacity="0.65" />
          <path d="M8,3 v8.5 a2,0.9 0 0,0 4,0 v-8.5 z" fill="currentColor" />
        </svg>
      );
    case 'horizontal':
      return (
        <svg viewBox="0 0 14 14" className="w-3 h-3 shrink-0" aria-hidden="true">
          <rect x="1.5" y="2" width="10.5" height="2.6" rx="0.6" fill="currentColor" />
          <rect x="1.5" y="5.8" width="7" height="2.6" rx="0.6" fill="currentColor" />
          <rect x="1.5" y="9.6" width="9" height="2.6" rx="0.6" fill="currentColor" />
        </svg>
      );
    case 'line':
      return (
        <svg viewBox="0 0 14 14" className="w-3 h-3 shrink-0" aria-hidden="true">
          <polyline
            points="1.5,10.5 5,6.5 8.5,8 12.5,3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="5" cy="6.5" r="1.2" fill="currentColor" />
          <circle cx="12.5" cy="3" r="1.2" fill="currentColor" />
        </svg>
      );
    case 'area':
      return (
        <svg viewBox="0 0 14 14" className="w-3 h-3 shrink-0" aria-hidden="true">
          <polygon
            points="1.5,12 1.5,9.5 5,5.5 8.5,7.2 12.5,2.8 12.5,12"
            fill="currentColor"
            opacity="0.32"
          />
          <polyline
            points="1.5,9.5 5,5.5 8.5,7.2 12.5,2.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
  }
};

const CHART_SHAPE_LOCALE_KEYS: Record<BiChartShape, string> = {
  column: 'bi.chartStyles.bar',
  cone: 'bi.chartStyles.cone',
  cylinder: 'bi.chartStyles.cylinder',
  horizontal: 'bi.chartStyles.horizontal',
  line: 'bi.chartStyles.line',
  area: 'bi.chartStyles.area',
};

export const BiChartTypeSelector: React.FC<{
  value: BiChartShape;
  onChange: (next: BiChartShape) => void;
}> = ({ value, onChange }) => {
  const { t } = useI18n();
  return (
    <div
      role="group"
      aria-label="Chart style"
      className="inline-flex flex-wrap items-center gap-0.5 p-0.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] max-w-full"
    >
      {BI_CHART_SHAPE_OPTIONS.map((opt) => {
        const active = value === opt.id;
        const localizedLabel = t(CHART_SHAPE_LOCALE_KEYS[opt.id]);
        return (
          <button
            key={opt.id}
            type="button"
            title={localizedLabel}
            aria-pressed={active}
            onClick={() => onChange(opt.id)}
            className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              active
                ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            <ChartShapeMiniIcon shape={opt.id} />
            <span>{localizedLabel}</span>
          </button>
        );
      })}
    </div>
  );
};

/**
 * Renders a crisp vertical primitive (Balok, Kerucut 2-faset, or Silinder dengan elips atas/bawah)
 * inside any SVG chart.
 */
function renderVerticalBarShape(params: {
  shape: 'column' | 'cone' | 'cylinder';
  x: number;
  y: number;
  w: number;
  h: number;
  isNeg: boolean;
  fill: string;
  opacity: number;
}): React.ReactNode {
  const { shape, x, y, w, h, isNeg, fill, opacity } = params;
  const cx = x + w / 2;

  if (shape === 'cone') {
    if (isNeg) {
      return (
        <g opacity={opacity} className="transition-opacity duration-150">
          <polygon points={`${x},${y} ${x + w},${y} ${cx},${y + h}`} fill={fill} />
          <polygon
            points={`${cx},${y} ${x + w},${y} ${cx},${y + h}`}
            fill="#000000"
            opacity={0.16}
          />
          <ellipse
            cx={cx}
            cy={y}
            rx={w / 2}
            ry={Math.min(4.5, Math.max(1.8, w * 0.14))}
            fill={fill}
            opacity={0.85}
          />
        </g>
      );
    }
    return (
      <g opacity={opacity} className="transition-opacity duration-150">
        <polygon points={`${cx},${y} ${x + w},${y + h} ${x},${y + h}`} fill={fill} />
        <polygon
          points={`${cx},${y} ${x + w},${y + h} ${cx},${y + h}`}
          fill="#000000"
          opacity={0.16}
        />
        <ellipse
          cx={cx}
          cy={y + h}
          rx={w / 2}
          ry={Math.min(4, Math.max(1.5, w * 0.12))}
          fill={fill}
          opacity={0.8}
        />
      </g>
    );
  }

  if (shape === 'cylinder') {
    const ry = Math.min(6, Math.max(2.2, w * 0.17));
    const bodyTop = y + (h > ry * 2 ? ry : 0);
    const bodyH = Math.max(1.5, h - (h > ry * 2 ? ry * 2 : 0));
    return (
      <g opacity={opacity} className="transition-opacity duration-150">
        <rect x={x} y={bodyTop} width={w} height={bodyH} fill={fill} />
        {/* Subtle 3D shading strips */}
        <rect x={x} y={bodyTop} width={w * 0.28} height={bodyH} fill="#FFFFFF" opacity={0.18} />
        <rect
          x={x + w * 0.68}
          y={bodyTop}
          width={w * 0.32}
          height={bodyH}
          fill="#000000"
          opacity={0.16}
        />
        {/* Bottom ellipse */}
        <ellipse cx={cx} cy={bodyTop + bodyH} rx={w / 2} ry={ry} fill={fill} />
        <ellipse cx={cx} cy={bodyTop + bodyH} rx={w / 2} ry={ry} fill="#000000" opacity={0.12} />
        {/* Top ellipse cap */}
        <ellipse cx={cx} cy={bodyTop} rx={w / 2} ry={ry} fill={fill} />
        <ellipse cx={cx} cy={bodyTop} rx={w / 2} ry={ry} fill="#FFFFFF" opacity={0.28} />
      </g>
    );
  }

  return (
    <rect
      x={x}
      y={y}
      width={w}
      height={h}
      rx={3.5}
      fill={fill}
      opacity={opacity}
      className="transition-opacity duration-150"
    />
  );
}

/* ============================================================================
 * 1. Shared KPI Header + Year & Month Filter Bar + Loading/Error/Empty States
 * ========================================================================== */

interface BiKpiHeaderAndFilterProps {
  idPrefix: string;
  moduleLabel?: string;
  category: string;
  chartTypeLabel: string;
  title: string;
  description: string;
  selectedYear: number;
  availableYears: number[];
  onYearChange: (y: number) => void;
  startMonth: number;
  endMonth: number;
  onStartMonthChange: (m: number) => void;
  onEndMonthChange: (m: number) => void;
  onApplyPreset: (from: number, to: number) => void;
  onRefresh: () => void;
  onExportCsv: () => void;
  loading: boolean;
  refreshing: boolean;
  canExport: boolean;
  extraControls?: React.ReactNode;
  noticeText?: string | null;
  noticeActionLabel?: string;
  onNoticeAction?: () => void;
}

export const BiKpiHeaderAndFilter: React.FC<BiKpiHeaderAndFilterProps> = ({
  idPrefix,
  moduleLabel = 'Finance & Accounting',
  category,
  chartTypeLabel,
  title,
  description,
  selectedYear,
  availableYears,
  onYearChange,
  startMonth,
  endMonth,
  onStartMonthChange,
  onEndMonthChange,
  onApplyPreset,
  onRefresh,
  onExportCsv,
  loading,
  refreshing,
  canExport,
  extraControls,
  noticeText,
  noticeActionLabel,
  onNoticeAction,
}) => {
  const { t, locale } = useI18n();
  const effectiveStart = Math.min(startMonth, endMonth);
  const effectiveEnd = Math.max(startMonth, endMonth);

  const moduleKeyMap: Record<string, string> = {
    'Finance & Accounting': 'bi.modules.accounting.name',
    Sales: 'bi.modules.sales.name',
    Purchasing: 'bi.modules.purchasing.name',
    Inventory: 'bi.modules.inventory.name',
    Production: 'bi.modules.production.name',
  };
  const localizedModuleLabel = moduleKeyMap[moduleLabel] ? t(moduleKeyMap[moduleLabel]) : moduleLabel;
  const catKey = `bi.categories.${category}`;
  const catTr = t(catKey);
  const localizedCategory = catTr === catKey ? category : catTr;

  const localizedChartLabel = (() => {
    if (locale === 'id') return chartTypeLabel;
    const map: Record<string, { en: string; ja: string }> = {
      'Diagram Kolom Vertikal': { en: 'Vertical Column Chart', ja: '縦棒グラフ' },
      'Diagram Batang Horizontal': { en: 'Horizontal Bar Chart', ja: '横棒グラフ' },
      'Diagram Kerucut Vertikal': { en: 'Vertical Cone Chart', ja: '円錐グラフ' },
      'Diagram Garis (Line Chart)': { en: 'Line Chart', ja: '折れ線グラフ' },
      'Diagram Perbandingan Multi-Bentuk': { en: 'Multi-Shape Comparison Chart', ja: '比較チャート（複数形式）' },
      'Matriks Lead Time 0–14 Hari': { en: 'Lead Time Matrix (0–14 Days)', ja: 'リードタイムマトリクス（0〜14日）' },
    };
    return map[chartTypeLabel]?.[locale] || chartTypeLabel;
  })();

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
            <span>{localizedModuleLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{localizedCategory}</span>
            <span aria-hidden="true">·</span>
            <span>{localizedChartLabel}</span>
          </div>
          <h3 className="font-display text-lg font-bold text-[var(--text)] leading-snug">
            {title}
          </h3>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed max-w-3xl">
            {description}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing || loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{t('bi.refresh')}</span>
          </button>
          <button
            type="button"
            onClick={onExportCsv}
            disabled={!canExport}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-[var(--accent)] text-[var(--on-accent)] hover:opacity-95 transition-opacity disabled:opacity-45 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{t('bi.exportCsv')}</span>
          </button>
        </div>
      </div>

      <div className="pt-3.5 border-t border-[var(--border)] flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label
              htmlFor={`bi-year-${idPrefix}`}
              className="block text-[11px] font-medium text-[var(--text-muted)]"
            >
              {t('bi.year')}
            </label>
            <div className="relative">
              <Calendar className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                id={`bi-year-${idPrefix}`}
                value={selectedYear}
                onChange={(e) => onYearChange(Number(e.target.value))}
                className="pl-8 pr-7 py-1.5 text-xs font-medium tabular-nums rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
              >
                {availableYears.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label
              htmlFor={`bi-start-${idPrefix}`}
              className="block text-[11px] font-medium text-[var(--text-muted)]"
            >
              {t('bi.fromMonth')}
            </label>
            <select
              id={`bi-start-${idPrefix}`}
              value={effectiveStart}
              onChange={(e) => {
                const next = Number(e.target.value);
                onStartMonthChange(next);
                if (next > endMonth) onEndMonthChange(next);
              }}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
            >
              {MONTH_FULL_ID.map((mName, idx) => (
                <option key={mName} value={idx + 1}>
                  {t(`erpFilter.months.${idx + 1}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label
              htmlFor={`bi-end-${idPrefix}`}
              className="block text-[11px] font-medium text-[var(--text-muted)]"
            >
              {t('bi.toMonth')}
            </label>
            <select
              id={`bi-end-${idPrefix}`}
              value={effectiveEnd}
              onChange={(e) => {
                const next = Number(e.target.value);
                onEndMonthChange(next);
                if (next < startMonth) onStartMonthChange(next);
              }}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
            >
              {MONTH_FULL_ID.map((mName, idx) => (
                <option key={mName} value={idx + 1}>
                  {t(`erpFilter.months.${idx + 1}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <span className="block text-[11px] font-medium text-[var(--text-muted)]">
              {t('bi.quickRange')}
            </span>
            <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
              {[
                { label: 'Q1', from: 1, to: 3 },
                { label: 'Q2', from: 4, to: 6 },
                { label: 'Q3', from: 7, to: 9 },
                { label: 'Q4', from: 10, to: 12 },
                { label: 'Sem 1', from: 1, to: 6 },
                { label: t('bi.fullYear'), from: 1, to: 12 },
              ].map((preset) => {
                const active = effectiveStart === preset.from && effectiveEnd === preset.to;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => onApplyPreset(preset.from, preset.to)}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          {extraControls}
        </div>

        {noticeText && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-[var(--text-muted)] pt-2 border-t border-[var(--border)]/60">
            <div className="flex items-start gap-2">
              <Info className="w-3.5 h-3.5 text-[var(--accent)] dark:text-[var(--accent-text)] shrink-0 mt-0.5" />
              <span className="leading-relaxed">{noticeText}</span>
            </div>
            {noticeActionLabel && onNoticeAction && (
              <button
                type="button"
                onClick={onNoticeAction}
                className="text-xs font-semibold text-[var(--accent)] dark:text-[var(--accent-text)] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
              >
                {noticeActionLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export const BiKpiStateViews: React.FC<{
  loading: boolean;
  hasData: boolean;
  errorMsg: string | null;
  isEmpty: boolean;
  selectedYear: number;
  startMonth: number;
  endMonth: number;
  minDateActive?: string;
  maxDateActive?: string;
  onRetry: () => void;
  onResetPeriod: () => void;
  onDownloadBridge?: () => void;
  errorTitle?: string;
  emptyTitle?: string;
  emptyDescription?: string;
}> = ({
  loading,
  hasData,
  errorMsg,
  isEmpty,
  selectedYear,
  startMonth,
  endMonth,
  minDateActive,
  maxDateActive,
  onRetry,
  onResetPeriod,
  onDownloadBridge,
  errorTitle = 'Data Keuangan ERP Belum Dapat Dimuat',
  emptyTitle,
  emptyDescription,
}) => {
  if (loading && !hasData) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((idx) => (
            <div
              key={idx}
              className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-2.5 animate-pulse"
            >
              <div className="h-3 w-24 rounded bg-[var(--border)]" />
              <div className="h-6 w-36 rounded bg-[var(--border)]" />
              <div className="h-3 w-28 rounded bg-[var(--border)]/70" />
            </div>
          ))}
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-6 h-80 animate-pulse" />
      </div>
    );
  }

  if (errorMsg && !loading) {
    return (
      <div className="bg-[var(--surface)] border border-rose-300 dark:border-rose-800 rounded-xl p-6 space-y-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="text-sm font-semibold text-[var(--text)]">{errorTitle}</h4>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed">{errorMsg}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={onRetry}
            className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-[var(--accent)] text-[var(--on-accent)] hover:opacity-95 cursor-pointer"
          >
            Coba Lagi
          </button>
          {onDownloadBridge && (
            <button
              type="button"
              onClick={onDownloadBridge}
              className="px-3.5 py-2 text-xs font-medium rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] hover:border-[var(--accent)] cursor-pointer"
            >
              Unduh Bridge ERP Lokal
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!loading && !errorMsg && hasData && isEmpty) {
    const s = Math.min(startMonth, endMonth);
    const e = Math.max(startMonth, endMonth);
    return (
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-10 text-center space-y-3">
        <h4 className="font-display text-base font-bold text-[var(--text)]">
          {emptyTitle ||
            `Tidak Ada Data Jurnal pada Periode ${MONTH_SHORT_ID[s - 1]}–${MONTH_SHORT_ID[e - 1]} ${selectedYear}`}
        </h4>
        <p className="text-xs text-[var(--text-muted)] max-w-xl mx-auto leading-relaxed">
          {emptyDescription ||
            'Tidak ditemukan transaksi jurnal terposting pada rentang bulan dan tahun yang dipilih.'}
          {minDateActive && maxDateActive
            ? ` Rentang data aktif ERP saat ini tercatat dari ${minDateActive} hingga ${maxDateActive}.`
            : ''}
        </p>
        <div className="pt-1">
          <button
            type="button"
            onClick={onResetPeriod}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-[var(--accent)] text-[var(--on-accent)] hover:opacity-95 cursor-pointer"
          >
            Tampilkan Periode Aktif ERP
          </button>
        </div>
      </div>
    );
  }

  return null;
};

/* ============================================================================
 * 2. Unified Single-Series Chart Engine (Supports ALL 6 Chart Shapes)
 * ========================================================================== */

export interface HorizontalBarDatum {
  key: string;
  label: string;
  value: number;
  valueLabel: string;
  hoverSummary: string;
  secondaryLabel?: string;
}

interface BiSingleSeriesChartProps {
  title: string;
  subtitle: string;
  legendLabel: string;
  data: HorizontalBarDatum[];
  formatAxisTick: (v: number) => string;
  defaultChartType: BiChartShape;
  taperedHorizontal?: boolean;
  headerRight?: React.ReactNode;
}

export const BiSingleSeriesChart: React.FC<BiSingleSeriesChartProps> = ({
  title,
  subtitle,
  legendLabel,
  data,
  formatAxisTick,
  defaultChartType,
  taperedHorizontal = false,
  headerRight,
}) => {
  const [chartType, setChartType] = useState<BiChartShape>(defaultChartType);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  // Sanitize incoming data values so NaN / undefined never leak into SVG attributes
  const safeData = useMemo(
    () => data.map((d) => ({ ...d, value: safeFinite(d.value, 0) })),
    [data]
  );

  // Horizontal layout reverses order so newest month sits on top (matching Excel)
  const horizontalOrdered = useMemo(() => [...safeData].reverse(), [safeData]);

  const scale = useMemo(() => {
    const vals = safeData.map((d) => d.value);
    const minVal = vals.length > 0 ? Math.min(0, ...vals) : 0;
    const maxVal = vals.length > 0 ? Math.max(1, ...vals) : 10;
    return computeNiceScale(minVal, maxVal, 5);
  }, [safeData]);

  const activeHover = useMemo(
    () => safeData.find((d) => d.key === hoveredKey) || null,
    [safeData, hoveredKey]
  );

  // Determine left padding dynamically for long horizontal labels
  const maxLabelLen = useMemo(
    () => Math.max(6, ...data.map((d) => d.label.length)),
    [data]
  );

  const actions = useBiChartCardActions({
    title,
    subtitle,
    buildPinPayload: () => {
      if (safeData.length === 0) return null;
      const sampleTexts = [
        safeData[0]?.valueLabel || '',
        safeData[0]?.hoverSummary || '',
        formatAxisTick(scale.max),
        legendLabel,
      ];
      const { valueFormat, unitLabel } = detectBiValueFormat(sampleTexts);
      const sliced = safeData.slice(0, 50);
      return {
        subtitle,
        chartType: mapBiShapeToPinnedChartType(chartType),
        palette: 'corporate',
        valueFormat,
        unitLabel,
        categoryLabel: 'Periode / Kategori',
        labels: sliced.map((d) => d.label),
        series: [
          {
            name: legendLabel || title,
            values: sliced.map((d) => safeFinite(d.value, 0)),
          },
        ],
        showDataLabels: true,
        sortMode: 'original',
      };
    },
  });

  const renderSvg = () => {
    /* ---------- HORIZONTAL BAR ---------- */
    if (chartType === 'horizontal') {
      const xSpan = Math.max(1e-6, safeFinite(scale.max - scale.min, 1));
      const rowHeight = 42;
      const padTop = 18;
      const padBottom = 38;
      const padLeft = Math.min(180, Math.max(84, maxLabelLen * 6.8 + 18));
      const padRight = 92;
      const svgW = 780;
      const plotW = svgW - padLeft - padRight;
      const svgH = Math.max(180, padTop + padBottom + horizontalOrdered.length * rowHeight);
      const toX = (val: number) => padLeft + ((safeFinite(val, 0) - scale.min) / xSpan) * plotW;
      const zeroX = toX(0);

      return (
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          className="w-full h-auto min-w-[540px]"
          role="img"
          aria-label={title}
        >
          {scale.ticks.map((tick) => {
            const x = toX(tick);
            const isZero = Math.abs(tick) < 1e-6;
            return (
              <g key={tick}>
                <line
                  x1={x}
                  y1={padTop}
                  x2={x}
                  y2={svgH - padBottom}
                  stroke="currentColor"
                  className={isZero ? 'text-[var(--text-muted)]/70' : 'text-[var(--border)]'}
                  strokeWidth={isZero ? 1.25 : 1}
                  strokeDasharray={isZero ? undefined : '3 3'}
                />
                <text
                  x={x}
                  y={svgH - 14}
                  textAnchor="middle"
                  className="fill-[var(--text-muted)] text-[11px] font-mono tabular-nums"
                >
                  {formatAxisTick(tick)}
                </text>
              </g>
            );
          })}

          {horizontalOrdered.map((item, idx) => {
            const yCenter = padTop + idx * rowHeight + rowHeight / 2;
            const barH = 22;
            const barY = yCenter - barH / 2;
            const valX = toX(item.value);
            const isNeg = item.value < 0;
            const barX = isNeg ? valX : zeroX;
            const barW = Math.max(2, Math.abs(valX - zeroX));
            const isHovered = hoveredKey === item.key;
            const fill = isNeg ? '#DC2626' : 'var(--accent)';
            const shortLabel =
              item.label.length > 24 ? `${item.label.slice(0, 23)}…` : item.label;

            return (
              <g
                key={item.key}
                onMouseEnter={() => setHoveredKey(item.key)}
                onMouseLeave={() => setHoveredKey(null)}
                className="cursor-pointer"
              >
                {isHovered && (
                  <rect
                    x={padLeft}
                    y={padTop + idx * rowHeight + 2}
                    width={plotW + padRight - 6}
                    height={rowHeight - 4}
                    rx={4}
                    fill="currentColor"
                    className="text-[var(--accent)]/6"
                  />
                )}

                <text
                  x={padLeft - 12}
                  y={yCenter + 4}
                  textAnchor="end"
                  className={`text-xs font-mono ${
                    isHovered ? 'fill-[var(--accent)] font-bold' : 'fill-[var(--text)] font-medium'
                  }`}
                >
                  {shortLabel}
                </text>

                {taperedHorizontal ? (
                  <polygon
                    points={
                      isNeg
                        ? `${zeroX},${barY} ${zeroX},${barY + barH} ${valX},${yCenter}`
                        : `${zeroX},${barY} ${valX},${yCenter} ${zeroX},${barY + barH}`
                    }
                    fill={fill}
                    opacity={hoveredKey && !isHovered ? 0.45 : 1}
                    className="transition-opacity duration-150"
                  />
                ) : (
                  <rect
                    x={barX}
                    y={barY}
                    width={barW}
                    height={barH}
                    rx={4}
                    fill={fill}
                    opacity={hoveredKey && !isHovered ? 0.45 : 1}
                    className="transition-opacity duration-150"
                  />
                )}

                <text
                  x={isNeg ? barX - 8 : barX + barW + 8}
                  y={yCenter + 4}
                  textAnchor={isNeg ? 'end' : 'start'}
                  className={`text-xs font-mono font-semibold tabular-nums ${
                    isNeg ? 'fill-rose-600 dark:fill-rose-400' : 'fill-[var(--text)]'
                  }`}
                >
                  {item.valueLabel}
                </text>
              </g>
            );
          })}
        </svg>
      );
    }

    /* ---------- LINE OR AREA ---------- */
    if (chartType === 'line' || chartType === 'area') {
      const ySpan = Math.max(1e-6, safeFinite(scale.max - scale.min, 1));
      const svgW = Math.max(660, safeData.length * 98 + 120);
      const svgH = 320;
      const padTop = 34;
      const padRight = 32;
      const padBottom = 46;
      const padLeft = 78;
      const plotW = svgW - padLeft - padRight;
      const plotH = svgH - padTop - padBottom;
      const toY = (val: number) => padTop + ((scale.max - safeFinite(val, 0)) / ySpan) * plotH;
      const zeroY = toY(Math.max(scale.min, Math.min(scale.max, 0)));

      const points = safeData.map((d, idx) => {
        const slotW = plotW / Math.max(1, safeData.length);
        const x = padLeft + idx * slotW + slotW / 2;
        const y = toY(d.value);
        return { ...d, x, y };
      });
      const polylineStr = points.map((p) => `${p.x},${p.y}`).join(' ');
      const areaPolygonStr =
        points.length > 0
          ? `${points[0].x},${zeroY} ${polylineStr} ${points[points.length - 1].x},${zeroY}`
          : '';

      return (
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          className="w-full h-auto min-w-[520px]"
          role="img"
          aria-label={title}
        >
          {scale.ticks.map((tick) => {
            const y = toY(tick);
            const isZero = Math.abs(tick) < 1e-6;
            return (
              <g key={tick}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={svgW - padRight}
                  y2={y}
                  stroke="currentColor"
                  className={isZero ? 'text-[var(--text-muted)]/60' : 'text-[var(--border)]'}
                  strokeWidth={isZero ? 1.25 : 1}
                  strokeDasharray={isZero ? undefined : '3 3'}
                />
                <text
                  x={padLeft - 10}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-[var(--text-muted)] text-[11px] font-mono tabular-nums"
                >
                  {formatAxisTick(tick)}
                </text>
              </g>
            );
          })}

          {chartType === 'area' && points.length > 1 && (
            <polygon points={areaPolygonStr} fill="var(--accent)" opacity={0.18} />
          )}

          {points.length > 1 && (
            <polyline
              fill="none"
              stroke="var(--accent)"
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              points={polylineStr}
            />
          )}

          {points.map((pt) => {
            const isHovered = hoveredKey === pt.key;
            const r = isHovered ? 7 : 5.5;
            const shortLabel =
              pt.label.length > 14 ? `${pt.label.slice(0, 13)}…` : pt.label;
            return (
              <g
                key={pt.key}
                onMouseEnter={() => setHoveredKey(pt.key)}
                onMouseLeave={() => setHoveredKey(null)}
                className="cursor-pointer"
              >
                <circle cx={pt.x} cy={pt.y} r={16} fill="transparent" />
                {chartType === 'area' ? (
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={r - 1}
                    fill={pt.value < 0 ? '#DC2626' : 'var(--accent)'}
                    stroke="var(--surface)"
                    strokeWidth={1.75}
                  />
                ) : (
                  <polygon
                    points={`${pt.x},${pt.y - r} ${pt.x + r},${pt.y} ${pt.x},${pt.y + r} ${pt.x - r},${pt.y}`}
                    fill={pt.value < 0 ? '#DC2626' : 'var(--accent)'}
                    stroke="var(--surface)"
                    strokeWidth={1.5}
                  />
                )}
                <text
                  x={pt.x}
                  y={pt.y - 12}
                  textAnchor="middle"
                  className="fill-[var(--text)] text-[11px] font-mono font-semibold tabular-nums pointer-events-none"
                >
                  {pt.valueLabel}
                </text>
                <text
                  x={pt.x}
                  y={svgH - 14}
                  textAnchor="middle"
                  className={`text-xs font-mono ${
                    isHovered ? 'fill-[var(--accent)] font-bold' : 'fill-[var(--text)] font-medium'
                  }`}
                >
                  {shortLabel}
                </text>
              </g>
            );
          })}
        </svg>
      );
    }

    /* ---------- VERTICAL COLUMN / CONE / CYLINDER ---------- */
    const ySpan = Math.max(1e-6, safeFinite(scale.max - scale.min, 1));
    const svgW = Math.max(660, safeData.length * 98 + 120);
    const svgH = 330;
    const padTop = 36;
    const padRight = 24;
    const padBottom = 46;
    const padLeft = 78;
    const plotW = svgW - padLeft - padRight;
    const plotH = svgH - padTop - padBottom;
    const toY = (val: number) => padTop + ((scale.max - safeFinite(val, 0)) / ySpan) * plotH;
    const zeroY = toY(0);

    return (
      <svg
        viewBox={`0 0 ${svgW} ${svgH}`}
        className="w-full h-auto min-w-[520px]"
        role="img"
        aria-label={title}
      >
        {scale.ticks.map((tick) => {
          const y = toY(tick);
          const isZero = Math.abs(tick) < 1e-6;
          return (
            <g key={tick}>
              <line
                x1={padLeft}
                y1={y}
                x2={svgW - padRight}
                y2={y}
                stroke="currentColor"
                className={isZero ? 'text-[var(--text-muted)]/60' : 'text-[var(--border)]'}
                strokeWidth={isZero ? 1.25 : 1}
                strokeDasharray={isZero ? undefined : '3 3'}
              />
              <text
                x={padLeft - 10}
                y={y + 4}
                textAnchor="end"
                className="fill-[var(--text-muted)] text-[11px] font-mono tabular-nums"
              >
                {formatAxisTick(tick)}
              </text>
            </g>
          );
        })}

        <line
          x1={padLeft}
          y1={padTop}
          x2={padLeft}
          y2={svgH - padBottom}
          stroke="currentColor"
          className="text-[var(--border)]"
          strokeWidth={1}
        />

        {safeData.map((item, idx) => {
          const slotW = plotW / Math.max(1, safeData.length);
          const cx = padLeft + idx * slotW + slotW / 2;
          const barW = Math.min(54, Math.max(20, slotW * 0.46));
          const barX = cx - barW / 2;
          const valY = toY(item.value);
          const isNeg = item.value < 0;
          const barY = isNeg ? zeroY : valY;
          const barH = Math.max(3, Math.abs(zeroY - valY));
          const isHovered = hoveredKey === item.key;
          const fill = isNeg ? '#DC2626' : 'var(--accent)';
          const shortLabel =
            item.label.length > 14 ? `${item.label.slice(0, 13)}…` : item.label;

          return (
            <g
              key={item.key}
              onMouseEnter={() => setHoveredKey(item.key)}
              onMouseLeave={() => setHoveredKey(null)}
              className="cursor-pointer"
            >
              {renderVerticalBarShape({
                shape: chartType,
                x: barX,
                y: barY,
                w: barW,
                h: barH,
                isNeg,
                fill,
                opacity: hoveredKey && !isHovered ? 0.45 : 1,
              })}

              <text
                x={cx}
                y={isNeg ? barY + barH + 14 : barY - 8}
                textAnchor="middle"
                className={`text-[11px] font-mono font-semibold tabular-nums pointer-events-none ${
                  isNeg ? 'fill-rose-600 dark:fill-rose-400' : 'fill-[var(--text)]'
                }`}
              >
                {item.valueLabel}
              </text>

              {item.secondaryLabel && (
                <text
                  x={cx}
                  y={Math.max(12, isNeg ? barY + barH + 26 : barY - 21)}
                  textAnchor="middle"
                  className="fill-[var(--text-muted)] text-[10px] font-mono tabular-nums pointer-events-none"
                >
                  {item.secondaryLabel}
                </text>
              )}

              <text
                x={cx}
                y={svgH - 14}
                textAnchor="middle"
                className={`text-xs font-mono ${
                  isHovered ? 'fill-[var(--accent)] font-bold' : 'fill-[var(--text)] font-medium'
                }`}
              >
                {shortLabel}
              </text>
            </g>
          );
        })}
      </svg>
    );
  };

  const singleToolbar = (
    <div className="flex flex-wrap items-center justify-between gap-2.5">
      <div className="flex flex-wrap items-center gap-2 max-w-full">
        <BiChartTypeSelector value={chartType} onChange={setChartType} />
        {headerRight}
      </div>
      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] whitespace-nowrap ml-auto">
        <span
          className={
            chartType === 'line'
              ? 'w-4 h-0.5 bg-[var(--accent)] inline-block'
              : 'w-3 h-3 rounded-sm bg-[var(--accent)]'
          }
        />
        <span>{legendLabel}</span>
      </span>
    </div>
  );

  const singleHoverBar = (
    <div className="px-3 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] flex flex-wrap items-center justify-between gap-2 text-xs min-h-[32px]">
      {activeHover ? (
        <>
          <span className="font-medium text-[var(--text)]">{activeHover.label}</span>
          <span className="font-mono tabular-nums text-[var(--text-muted)]">
            {activeHover.hoverSummary}
          </span>
        </>
      ) : (
        <span className="text-[var(--text-muted)]">
          Arahkan kursor ke elemen grafik untuk melihat detail perhitungan eksak.
        </span>
      )}
    </div>
  );

  const singlePinComposer = (
    <BiPinComposerPanel
      open={actions.showPinComposer}
      pinTitle={actions.pinTitle}
      onChangePinTitle={actions.setPinTitle}
      speakerNotes={actions.speakerNotes}
      onChangeSpeakerNotes={actions.setSpeakerNotes}
      isShared={actions.isShared}
      onChangeIsShared={actions.setIsShared}
      savingPin={actions.savingPin}
      pinError={actions.pinError}
      onCancel={() => actions.setShowPinComposer(false)}
      onConfirm={() => void actions.handleConfirmPin()}
    />
  );

  return (
    <>
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4 min-w-0 overflow-hidden">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1 min-w-0 flex-1">
              <h4 className="font-display text-base font-bold text-[var(--text)] leading-snug break-words">
                {title}
              </h4>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed break-words">
                {subtitle}
              </p>
            </div>

            <BiChartActionButtons
              canPin={actions.canPin}
              isAlreadyPinned={actions.isAlreadyPinned}
              showPinComposer={actions.showPinComposer}
              onTogglePinComposer={actions.handleOpenComposer}
              onOpenDashboard={actions.onOpenDashboard}
              onOpenMaximize={() => actions.setIsFullscreen(true)}
            />
          </div>

          {!actions.isFullscreen && singlePinComposer}

          <div className="pt-2.5 border-t border-[var(--border)]/60">{singleToolbar}</div>
        </div>

        <div className="overflow-x-auto space-y-2">
          {renderSvg()}
          {singleHoverBar}
        </div>
      </div>

      <BiChartFullscreenModal
        open={actions.isFullscreen}
        onClose={() => actions.setIsFullscreen(false)}
        title={title}
        subtitle={subtitle}
        sourceLabel={actions.sourceModuleLabel}
        headerActions={
          <BiChartActionButtons
            canPin={actions.canPin}
            isAlreadyPinned={actions.isAlreadyPinned}
            showPinComposer={actions.showPinComposer}
            onTogglePinComposer={actions.handleOpenComposer}
            onOpenDashboard={() => {
              actions.setIsFullscreen(false);
              actions.onOpenDashboard?.();
            }}
            showMaximize={false}
          />
        }
        pinComposer={actions.isFullscreen ? singlePinComposer : null}
        toolbar={singleToolbar}
      >
        <div className="space-y-4">
          <div className="overflow-x-auto">{renderSvg()}</div>
          {singleHoverBar}
        </div>
      </BiChartFullscreenModal>
    </>
  );
};

/* ============================================================================
 * 3. Backward-Compatible Single-Series Exports (Now All Have 6 Selectable Shapes)
 * ========================================================================== */

export const BiHorizontalBarChart: React.FC<{
  title: string;
  subtitle: string;
  legendLabel: string;
  data: HorizontalBarDatum[];
  formatAxisTick: (v: number) => string;
  tapered?: boolean;
  headerRight?: React.ReactNode;
  defaultChartType?: BiChartShape;
}> = ({ tapered = false, defaultChartType = 'horizontal', ...rest }) => (
  <BiSingleSeriesChart
    {...rest}
    defaultChartType={defaultChartType}
    taperedHorizontal={tapered}
  />
);

export const BiVerticalSingleChart: React.FC<{
  title: string;
  subtitle: string;
  legendLabel: string;
  data: HorizontalBarDatum[];
  formatAxisTick: (v: number) => string;
  shape?: 'column' | 'cone' | 'cylinder';
  headerRight?: React.ReactNode;
  defaultChartType?: BiChartShape;
}> = ({ shape = 'column', defaultChartType, ...rest }) => (
  <BiSingleSeriesChart
    {...rest}
    defaultChartType={defaultChartType ?? shape}
  />
);

export const BiLineChart: React.FC<{
  title: string;
  subtitle: string;
  legendLabel: string;
  data: HorizontalBarDatum[];
  formatAxisTick: (v: number) => string;
  headerRight?: React.ReactNode;
  defaultChartType?: BiChartShape;
}> = ({ defaultChartType = 'line', ...rest }) => (
  <BiSingleSeriesChart {...rest} defaultChartType={defaultChartType} />
);

/* ============================================================================
 * 4. Grouped Multi-Metric Chart (Supports ALL 6 Chart Shapes + Grouping Mode)
 * ========================================================================== */

export interface GroupedMetricDef {
  key: string;
  label: string;
  color: string;
  valuesByMonth: Record<string, number>;
}

export const BiGroupedColumnChart: React.FC<{
  title: string;
  subtitle: string;
  months: Array<{ key: string; label: string; labelFull: string }>;
  metrics: GroupedMetricDef[];
  formatAxisTick: (v: number) => string;
  formatExactValue: (v: number) => string;
  headerExtra?: React.ReactNode;
  defaultChartType?: BiChartShape;
  defaultGroupMode?: 'by_metric' | 'by_month';
}> = ({
  title,
  subtitle,
  months,
  metrics,
  formatAxisTick,
  formatExactValue,
  headerExtra,
  defaultChartType = 'column',
  defaultGroupMode = 'by_metric',
}) => {
  const [groupMode, setGroupMode] = useState<'by_metric' | 'by_month'>(defaultGroupMode);
  const [chartType, setChartType] = useState<BiChartShape>(defaultChartType);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  const scale = useMemo(() => {
    const vals: number[] = [];
    for (const m of metrics) {
      for (const mo of months) {
        vals.push(safeFinite(m.valuesByMonth[mo.key], 0));
      }
    }
    const minVal = vals.length > 0 ? Math.min(0, ...vals) : 0;
    const maxVal = vals.length > 0 ? Math.max(1, ...vals) : 100;
    return computeNiceScale(minVal, maxVal, 5);
  }, [metrics, months]);

  const hoverInfo = useMemo(() => {
    if (!hoveredKey) return null;
    for (const mo of months) {
      for (const m of metrics) {
        if (hoveredKey === `${m.key}-${mo.key}` || hoveredKey === `${mo.key}-${m.key}`) {
          return {
            title: `${m.label} · ${mo.labelFull}`,
            value: safeFinite(m.valuesByMonth[mo.key], 0),
          };
        }
      }
    }
    return null;
  }, [hoveredKey, metrics, months]);

  const isTrendShape = chartType === 'line' || chartType === 'area';

  const actions = useBiChartCardActions({
    title,
    subtitle,
    buildPinPayload: () => {
      if (months.length === 0 || metrics.length === 0) return null;
      const sampleTexts = [formatExactValue(scale.max), formatAxisTick(scale.max)];
      const { valueFormat, unitLabel } = detectBiValueFormat(sampleTexts);
      const useMonthAsLabel = isTrendShape || groupMode === 'by_month';
      if (useMonthAsLabel) {
        const slicedMonths = months.slice(0, 50);
        const slicedMetrics = metrics.slice(0, 8);
        return {
          subtitle,
          chartType: mapBiShapeToPinnedChartType(chartType),
          palette: 'corporate',
          valueFormat,
          unitLabel,
          categoryLabel: 'Bulan',
          labels: slicedMonths.map((mo) => mo.label),
          series: slicedMetrics.map((m) => ({
            name: m.label,
            values: slicedMonths.map((mo) => safeFinite(m.valuesByMonth[mo.key], 0)),
          })),
          showDataLabels: true,
          sortMode: 'original',
        };
      }
      const slicedMetrics = metrics.slice(0, 50);
      const slicedMonths = months.slice(-8);
      return {
        subtitle,
        chartType: mapBiShapeToPinnedChartType(chartType),
        palette: 'corporate',
        valueFormat,
        unitLabel,
        categoryLabel: 'Kategori Metrik',
        labels: slicedMetrics.map((m) => m.label),
        series: slicedMonths.map((mo) => ({
          name: mo.label,
          values: slicedMetrics.map((m) => safeFinite(m.valuesByMonth[mo.key], 0)),
        })),
        showDataLabels: true,
        sortMode: 'original',
      };
    },
  });
  const showByMonthLegend = isTrendShape || groupMode === 'by_month';

  const renderSvg = () => {
    /* ---------- MULTI-SERIES LINE / AREA (Chronological by Month) ---------- */
    if (isTrendShape) {
      const ySpan = Math.max(1e-6, scale.max - scale.min);
      const svgW = Math.max(660, months.length * 100 + 120);
      const svgH = 335;
      const padTop = 26;
      const padRight = 28;
      const padBottom = 44;
      const padLeft = 82;
      const plotW = svgW - padLeft - padRight;
      const plotH = svgH - padTop - padBottom;
      const toY = (val: number) => padTop + ((scale.max - safeFinite(val, 0)) / ySpan) * plotH;
      const zeroY = toY(Math.max(scale.min, Math.min(scale.max, 0)));
      const slotW = plotW / Math.max(1, months.length);

      return (
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          className="w-full h-auto min-w-[540px]"
          role="img"
          aria-label={title}
        >
          {scale.ticks.map((tick) => {
            const y = toY(tick);
            const isZero = Math.abs(tick) < 1e-6;
            return (
              <g key={tick}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={svgW - padRight}
                  y2={y}
                  stroke="currentColor"
                  className={isZero ? 'text-[var(--text-muted)]/60' : 'text-[var(--border)]'}
                  strokeWidth={isZero ? 1.25 : 1}
                  strokeDasharray={isZero ? undefined : '3 3'}
                />
                <text
                  x={padLeft - 10}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-[var(--text-muted)] text-[11px] font-mono tabular-nums"
                >
                  {formatAxisTick(tick)}
                </text>
              </g>
            );
          })}

          {metrics.map((metric) => {
            const pts = months.map((mo, mIdx) => {
              const x = padLeft + mIdx * slotW + slotW / 2;
              const val = safeFinite(metric.valuesByMonth[mo.key], 0);
              return { mo, val, x, y: toY(val) };
            });
            const poly = pts.map((p) => `${p.x},${p.y}`).join(' ');
            const areaPoly =
              pts.length > 0
                ? `${pts[0].x},${zeroY} ${poly} ${pts[pts.length - 1].x},${zeroY}`
                : '';

            return (
              <g key={metric.key}>
                {chartType === 'area' && pts.length > 1 && (
                  <polygon points={areaPoly} fill={metric.color} opacity={0.14} />
                )}
                {pts.length > 1 && (
                  <polyline
                    fill="none"
                    stroke={metric.color}
                    strokeWidth={2.4}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    points={poly}
                  />
                )}
                {pts.map((pt) => {
                  const k = `${pt.mo.key}-${metric.key}`;
                  const isHovered = hoveredKey === k;
                  const r = isHovered ? 6.5 : 4.5;
                  return (
                    <g
                      key={k}
                      onMouseEnter={() => setHoveredKey(k)}
                      onMouseLeave={() => setHoveredKey(null)}
                      className="cursor-pointer"
                    >
                      <circle cx={pt.x} cy={pt.y} r={14} fill="transparent" />
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r={r}
                        fill={metric.color}
                        stroke="var(--surface)"
                        strokeWidth={1.6}
                      />
                    </g>
                  );
                })}
              </g>
            );
          })}

          {months.map((mo, mIdx) => {
            const x = padLeft + mIdx * slotW + slotW / 2;
            return (
              <text
                key={mo.key}
                x={x}
                y={svgH - 14}
                textAnchor="middle"
                className="fill-[var(--text)] text-[11px] font-medium font-mono"
              >
                {mo.label}
              </text>
            );
          })}
        </svg>
      );
    }

    /* ---------- GROUPED HORIZONTAL BARS ---------- */
    if (chartType === 'horizontal') {
      const xSpan = Math.max(1e-6, scale.max - scale.min);
      const groups =
        groupMode === 'by_metric'
          ? metrics.map((metric) => ({
              groupKey: metric.key,
              groupLabel: metric.label,
              bars: months.map((mo, mIdx) => ({
                key: `${metric.key}-${mo.key}`,
                val: metric.valuesByMonth[mo.key] ?? 0,
                fill: MONTH_SERIES_PALETTE[mIdx % MONTH_SERIES_PALETTE.length],
              })),
            }))
          : [...months].reverse().map((mo) => ({
              groupKey: mo.key,
              groupLabel: mo.label,
              bars: metrics.map((metric) => ({
                key: `${mo.key}-${metric.key}`,
                val: metric.valuesByMonth[mo.key] ?? 0,
                fill: (metric.valuesByMonth[mo.key] ?? 0) < 0 ? '#DC2626' : metric.color,
              })),
            }));

      const barH = Math.max(10, Math.min(18, Math.floor(72 / Math.max(1, groups[0]?.bars.length || 1))));
      const barGap = 4;
      const groupPad = 14;
      const groupH = (groups[0]?.bars.length || 1) * (barH + barGap) - barGap + groupPad;
      const padTop = 16;
      const padBottom = 38;
      const padLeft = 148;
      const padRight = 32;
      const svgW = 760;
      const plotW = svgW - padLeft - padRight;
      const svgH = Math.max(200, padTop + padBottom + groups.length * groupH);
      const toX = (val: number) => padLeft + ((safeFinite(val, 0) - scale.min) / xSpan) * plotW;
      const zeroX = toX(0);

      return (
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          className="w-full h-auto min-w-[540px]"
          role="img"
          aria-label={title}
        >
          {scale.ticks.map((tick) => {
            const x = toX(tick);
            const isZero = Math.abs(tick) < 1e-6;
            return (
              <g key={tick}>
                <line
                  x1={x}
                  y1={padTop}
                  x2={x}
                  y2={svgH - padBottom}
                  stroke="currentColor"
                  className={isZero ? 'text-[var(--text-muted)]/60' : 'text-[var(--border)]'}
                  strokeWidth={isZero ? 1.25 : 1}
                  strokeDasharray={isZero ? undefined : '3 3'}
                />
                <text
                  x={x}
                  y={svgH - 14}
                  textAnchor="middle"
                  className="fill-[var(--text-muted)] text-[11px] font-mono tabular-nums"
                >
                  {formatAxisTick(tick)}
                </text>
              </g>
            );
          })}

          {groups.map((grp, gIdx) => {
            const topY = padTop + gIdx * groupH + groupPad / 2;
            const totalBarsH = grp.bars.length * (barH + barGap) - barGap;
            const labelY = topY + totalBarsH / 2 + 4;
            const shortLabel =
              grp.groupLabel.length > 20 ? `${grp.groupLabel.slice(0, 19)}…` : grp.groupLabel;

            return (
              <g key={grp.groupKey}>
                <text
                  x={padLeft - 12}
                  y={labelY}
                  textAnchor="end"
                  className="fill-[var(--text)] text-xs font-semibold"
                >
                  {shortLabel}
                </text>
                {grp.bars.map((bar, bIdx) => {
                  const y = topY + bIdx * (barH + barGap);
                  const valX = toX(bar.val);
                  const isNeg = bar.val < 0;
                  const bx = isNeg ? valX : zeroX;
                  const bw = Math.max(2, Math.abs(valX - zeroX));
                  const isHovered = hoveredKey === bar.key;
                  return (
                    <rect
                      key={bar.key}
                      x={bx}
                      y={y}
                      width={bw}
                      height={barH}
                      rx={3}
                      fill={bar.fill}
                      opacity={hoveredKey && !isHovered ? 0.45 : 1}
                      onMouseEnter={() => setHoveredKey(bar.key)}
                      onMouseLeave={() => setHoveredKey(null)}
                      className="cursor-pointer transition-opacity duration-150"
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>
      );
    }

    /* ---------- GROUPED VERTICAL COLUMN / CONE / CYLINDER ---------- */
    const ySpan = Math.max(1e-6, scale.max - scale.min);
    const svgW = Math.max(
      660,
      groupMode === 'by_month'
        ? months.length * 115 + 110
        : Math.max(720, metrics.length * 185 + 110)
    );
    const svgH = 335;
    const padTop = 24;
    const padRight = 24;
    const padBottom = 44;
    const padLeft = 82;
    const plotW = svgW - padLeft - padRight;
    const plotH = svgH - padTop - padBottom;
    const toY = (val: number) => padTop + ((scale.max - safeFinite(val, 0)) / ySpan) * plotH;
    const zeroY = toY(0);

    return (
      <svg
        viewBox={`0 0 ${svgW} ${svgH}`}
        className="w-full h-auto min-w-[540px]"
        role="img"
        aria-label={title}
      >
        {scale.ticks.map((tick) => {
          const y = toY(tick);
          const isZero = Math.abs(tick) < 1e-6;
          return (
            <g key={tick}>
              <line
                x1={padLeft}
                y1={y}
                x2={svgW - padRight}
                y2={y}
                stroke="currentColor"
                className={isZero ? 'text-[var(--text-muted)]/60' : 'text-[var(--border)]'}
                strokeWidth={isZero ? 1.25 : 1}
                strokeDasharray={isZero ? undefined : '3 3'}
              />
              <text
                x={padLeft - 10}
                y={y + 4}
                textAnchor="end"
                className="fill-[var(--text-muted)] text-[11px] font-mono tabular-nums"
              >
                {formatAxisTick(tick)}
              </text>
            </g>
          );
        })}

        <line
          x1={padLeft}
          y1={padTop}
          x2={padLeft}
          y2={svgH - padBottom}
          stroke="currentColor"
          className="text-[var(--border)]"
          strokeWidth={1}
        />

        {groupMode === 'by_metric'
          ? metrics.map((metric, groupIdx) => {
              const groupWidth = plotW / Math.max(1, metrics.length);
              const groupCenterX = padLeft + groupIdx * groupWidth + groupWidth / 2;
              const innerPad = Math.min(24, groupWidth * 0.14);
              const usableW = groupWidth - innerPad * 2;
              const gap = months.length > 6 ? 4 : 7;
              const barW = Math.min(
                44,
                Math.max(
                  10,
                  (usableW - gap * Math.max(0, months.length - 1)) / Math.max(1, months.length)
                )
              );
              const totalBarsW = barW * months.length + gap * Math.max(0, months.length - 1);
              const startX = groupCenterX - totalBarsW / 2;

              return (
                <g key={metric.key}>
                  {months.map((mo, mIdx) => {
                    const val = metric.valuesByMonth[mo.key] ?? 0;
                    const barX = startX + mIdx * (barW + gap);
                    const valY = toY(val);
                    const isNeg = val < 0;
                    const barY = isNeg ? zeroY : valY;
                    const barH = Math.max(3, Math.abs(zeroY - valY));
                    const k = `${metric.key}-${mo.key}`;
                    const isHovered = hoveredKey === k;
                    const fill = MONTH_SERIES_PALETTE[mIdx % MONTH_SERIES_PALETTE.length];

                    return (
                      <g
                        key={k}
                        onMouseEnter={() => setHoveredKey(k)}
                        onMouseLeave={() => setHoveredKey(null)}
                        className="cursor-pointer"
                      >
                        {renderVerticalBarShape({
                          shape: chartType,
                          x: barX,
                          y: barY,
                          w: barW,
                          h: barH,
                          isNeg,
                          fill,
                          opacity: hoveredKey && !isHovered ? 0.45 : 1,
                        })}
                      </g>
                    );
                  })}
                  <text
                    x={groupCenterX}
                    y={svgH - 14}
                    textAnchor="middle"
                    className="fill-[var(--text)] text-xs font-semibold"
                  >
                    {metric.label}
                  </text>
                </g>
              );
            })
          : months.map((mo, mIdx) => {
              const groupWidth = plotW / Math.max(1, months.length);
              const groupCenterX = padLeft + mIdx * groupWidth + groupWidth / 2;
              const innerPad = Math.min(16, groupWidth * 0.14);
              const usableW = groupWidth - innerPad * 2;
              const gap = 5;
              const barW = Math.min(
                32,
                Math.max(
                  10,
                  (usableW - gap * Math.max(0, metrics.length - 1)) / Math.max(1, metrics.length)
                )
              );
              const totalBarsW = barW * metrics.length + gap * Math.max(0, metrics.length - 1);
              const startX = groupCenterX - totalBarsW / 2;

              return (
                <g key={mo.key}>
                  {metrics.map((metric, sIdx) => {
                    const val = metric.valuesByMonth[mo.key] ?? 0;
                    const barX = startX + sIdx * (barW + gap);
                    const valY = toY(val);
                    const isNeg = val < 0;
                    const barY = isNeg ? zeroY : valY;
                    const barH = Math.max(3, Math.abs(zeroY - valY));
                    const k = `${mo.key}-${metric.key}`;
                    const isHovered = hoveredKey === k;

                    return (
                      <g
                        key={k}
                        onMouseEnter={() => setHoveredKey(k)}
                        onMouseLeave={() => setHoveredKey(null)}
                        className="cursor-pointer"
                      >
                        {renderVerticalBarShape({
                          shape: chartType,
                          x: barX,
                          y: barY,
                          w: barW,
                          h: barH,
                          isNeg,
                          fill: isNeg ? '#DC2626' : metric.color,
                          opacity: hoveredKey && !isHovered ? 0.45 : 1,
                        })}
                      </g>
                    );
                  })}
                  <text
                    x={groupCenterX}
                    y={svgH - 14}
                    textAnchor="middle"
                    className="fill-[var(--text)] text-[11px] font-medium font-mono"
                  >
                    {mo.label}
                  </text>
                </g>
              );
            })}
      </svg>
    );
  };

  const groupedToolbar = (
    <div className="flex flex-wrap items-center justify-between gap-2.5">
      <div className="flex flex-wrap items-center gap-2 max-w-full">
        <BiChartTypeSelector value={chartType} onChange={setChartType} />
        {headerExtra}
      </div>

      {!isTrendShape && (
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] ml-auto max-w-full">
          <button
            type="button"
            onClick={() => setGroupMode('by_metric')}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              groupMode === 'by_metric'
                ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            Per Kategori Metrik
          </button>
          <button
            type="button"
            onClick={() => setGroupMode('by_month')}
            className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              groupMode === 'by_month'
                ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            Per Bulan
          </button>
        </div>
      )}
    </div>
  );

  const groupedHoverBar = (
    <div className="px-3 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] flex flex-wrap items-center justify-between gap-2 text-xs min-h-[32px]">
      {hoverInfo ? (
        <>
          <span className="font-medium text-[var(--text)]">{hoverInfo.title}</span>
          <strong className="font-mono tabular-nums text-[var(--accent)]">
            {formatExactValue(hoverInfo.value)}
          </strong>
        </>
      ) : (
        <span className="text-[var(--text-muted)]">
          Arahkan kursor ke salah satu elemen grafik untuk melihat nilai eksak.
        </span>
      )}
    </div>
  );

  const renderGroupedLegend = (inModal = false) => (
    <div
      className={
        inModal
          ? 'lg:w-52 shrink-0 border-t lg:border-t-0 lg:border-l border-[var(--border)] pt-3 lg:pt-0 lg:pl-5 flex flex-col justify-center gap-2.5'
          : '2xl:w-44 shrink-0 border-t 2xl:border-t-0 2xl:border-l border-[var(--border)] pt-3 2xl:pt-0 2xl:pl-4 flex flex-col justify-center gap-2'
      }
    >
      <span className="text-[11px] font-semibold text-[var(--text-muted)]">
        {showByMonthLegend ? 'Kategori Metrik' : 'Seri Bulan'}
      </span>
      <div
        className={
          inModal ? 'flex flex-wrap lg:flex-col gap-2.5' : 'flex flex-wrap 2xl:flex-col gap-2'
        }
      >
        {!showByMonthLegend
          ? months.map((mo, idx) => (
              <div key={mo.key} className="flex items-center gap-2 text-xs">
                <span
                  className="w-3 h-3 rounded-sm shrink-0"
                  style={{
                    backgroundColor: MONTH_SERIES_PALETTE[idx % MONTH_SERIES_PALETTE.length],
                  }}
                />
                <span className="font-mono text-[var(--text)] truncate">{mo.label}</span>
              </div>
            ))
          : metrics.map((m) => (
              <div key={m.key} className="flex items-center gap-2 text-xs">
                <span
                  className="w-3 h-3 rounded-sm shrink-0"
                  style={{ backgroundColor: m.color }}
                />
                <span className="text-[var(--text)]">{m.label}</span>
              </div>
            ))}
      </div>
    </div>
  );

  const groupedPinComposer = (
    <BiPinComposerPanel
      open={actions.showPinComposer}
      pinTitle={actions.pinTitle}
      onChangePinTitle={actions.setPinTitle}
      speakerNotes={actions.speakerNotes}
      onChangeSpeakerNotes={actions.setSpeakerNotes}
      isShared={actions.isShared}
      onChangeIsShared={actions.setIsShared}
      savingPin={actions.savingPin}
      pinError={actions.pinError}
      onCancel={() => actions.setShowPinComposer(false)}
      onConfirm={() => void actions.handleConfirmPin()}
    />
  );

  return (
    <>
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4 min-w-0 overflow-hidden">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1 min-w-0 flex-1">
              <h4 className="font-display text-base font-bold text-[var(--text)] leading-snug break-words">
                {title}
              </h4>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed break-words">
                {subtitle}
              </p>
            </div>

            <BiChartActionButtons
              canPin={actions.canPin}
              isAlreadyPinned={actions.isAlreadyPinned}
              showPinComposer={actions.showPinComposer}
              onTogglePinComposer={actions.handleOpenComposer}
              onOpenDashboard={actions.onOpenDashboard}
              onOpenMaximize={() => actions.setIsFullscreen(true)}
            />
          </div>

          {!actions.isFullscreen && groupedPinComposer}

          <div className="pt-2.5 border-t border-[var(--border)]/60">{groupedToolbar}</div>
        </div>

        <div className="flex flex-col 2xl:flex-row gap-5 items-stretch">
          <div className="flex-1 min-w-0 overflow-x-auto space-y-2">
            {renderSvg()}
            {groupedHoverBar}
          </div>

          {renderGroupedLegend(false)}
        </div>
      </div>

      <BiChartFullscreenModal
        open={actions.isFullscreen}
        onClose={() => actions.setIsFullscreen(false)}
        title={title}
        subtitle={subtitle}
        sourceLabel={actions.sourceModuleLabel}
        headerActions={
          <BiChartActionButtons
            canPin={actions.canPin}
            isAlreadyPinned={actions.isAlreadyPinned}
            showPinComposer={actions.showPinComposer}
            onTogglePinComposer={actions.handleOpenComposer}
            onOpenDashboard={() => {
              actions.setIsFullscreen(false);
              actions.onOpenDashboard?.();
            }}
            showMaximize={false}
          />
        }
        pinComposer={actions.isFullscreen ? groupedPinComposer : null}
        toolbar={groupedToolbar}
      >
        <div className="flex flex-col lg:flex-row gap-6 items-stretch">
          <div className="flex-1 min-w-0 overflow-x-auto space-y-3">
            {renderSvg()}
            {groupedHoverBar}
          </div>
          {renderGroupedLegend(true)}
        </div>
      </BiChartFullscreenModal>
    </>
  );
};
