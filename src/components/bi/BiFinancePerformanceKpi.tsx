import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  ChevronDown,
  ChevronUp,
  Download,
  Info,
  RefreshCw,
} from 'lucide-react';
import {
  MONTH_FULL_ID,
  MONTH_SERIES_PALETTE,
  MONTH_SHORT_ID,
  computeNiceScale,
  downloadCsvFile,
  extractDetectedItdaAccounts,
  formatCompactIdr,
  formatIdr,
  formatNumberPlain,
  formatPct,
  useBiFinancePeriodData,
  type NormalizedMonthlyFinanceRow,
} from './biFinanceShared';
import {
  BiGroupedColumnChart,
  BiHorizontalBarChart,
  BiVerticalSingleChart,
} from './BiFinanceChartPrimitives';
import { useI18n } from '../../lib/i18n';

export type BiFinancePerformanceMode =
  | 'gross_profit_margin'
  | 'operating_profit_margin'
  | 'ebitda'
  | 'revenue_growth_rate';

interface BiFinancePerformanceKpiProps {
  mode: BiFinancePerformanceMode;
  idToken: string;
  onDownloadBridge?: () => void;
}

type ColumnGroupMode = 'by_metric' | 'by_month';
type OperatingBasisMode = 'pbt_template' | 'ebit_pure';
type RevenueBasisMode = 'operating_only' | 'total_revenue';
type GrowthChartView = 'nominal' | 'growth_pct';
type EbitdaBarShape = 'pyramid' | 'column';

interface GrowthRow {
  row: NormalizedMonthlyFinanceRow;
  revenueValue: number;
  prevRevenueValue: number | null;
  deltaNominal: number | null;
  growthPct: number | null;
}

const KPI_META: Record<
  BiFinancePerformanceMode,
  {
    orderLabel: string;
    category: string;
    chartTypeLabel: string;
    title: string;
    description: string;
    csvPrefix: string;
  }
> = {
  gross_profit_margin: {
    orderLabel: '03',
    category: 'Profitabilitas',
    chartTypeLabel: 'Diagram Kolom Vertikal',
    title: '03. Gross Profit Margin',
    description:
      'Perbandingan Pendapatan Usaha, Harga Pokok Penjualan (HPP/COGS), dan Gross Profit Margin (Laba Kotor) per bulan dari jurnal aktual MyERP Plus.',
    csvPrefix: 'BI_Gross_Profit_Margin',
  },
  operating_profit_margin: {
    orderLabel: '04',
    category: 'Profitabilitas',
    chartTypeLabel: 'Diagram Batang Horizontal',
    title: '04. Operating Profit Margin',
    description:
      'Persentase laba operasi / L/R sebelum pajak terhadap pendapatan per bulan untuk memantau efisiensi biaya inti perusahaan.',
    csvPrefix: 'BI_Operating_Profit_Margin',
  },
  ebitda: {
    orderLabel: '05',
    category: 'Profitabilitas',
    chartTypeLabel: 'Diagram Kolom Piramida',
    title: '05. EBITDA (Earning Before Interest, Taxes, Depreciation, and Amortization)',
    description:
      'Perbandingan Pendapatan, Biaya dikurangi komponen ITDA (Bunga, Pajak Penghasilan, Depresiasi & Amortisasi), dan EBITDA aktual bulanan.',
    csvPrefix: 'BI_EBITDA',
  },
  revenue_growth_rate: {
    orderLabel: '06',
    category: 'Pertumbuhan',
    chartTypeLabel: 'Diagram Kolom Vertikal',
    title: '06. Revenue Growth Rate',
    description:
      'Pemantauan tren pendapatan bulanan dan laju pertumbuhan antarbulan (Month-over-Month) dari transaksi jurnal aktual MyERP Plus.',
    csvPrefix: 'BI_Revenue_Growth_Rate',
  },
};

export const BiFinancePerformanceKpi: React.FC<BiFinancePerformanceKpiProps> = ({
  mode,
  idToken,
  onDownloadBridge,
}) => {
  const { t } = useI18n();
  const {
    selectedYear,
    setSelectedYear,
    startMonth,
    setStartMonth,
    endMonth,
    setEndMonth,
    effectiveStartMonth,
    effectiveEndMonth,
    availableYears,
    data,
    monthlyRows,
    loading,
    refreshing,
    errorMsg,
    cutoffWarning,
    fetchFinanceData,
    handleResetActivePeriod,
  } = useBiFinancePeriodData(idToken);

  const meta = KPI_META[mode];

  // Mode-specific interactive controls
  const [columnGroupMode, setColumnGroupMode] = useState<ColumnGroupMode>('by_metric');
  const [showHppBreakdown, setShowHppBreakdown] = useState<boolean>(false);
  const [operatingBasis, setOperatingBasis] = useState<OperatingBasisMode>('pbt_template');
  const [ebitdaBarShape, setEbitdaBarShape] = useState<EbitdaBarShape>('pyramid');
  const [showItdaBreakdown, setShowItdaBreakdown] = useState<boolean>(false);
  const [revenueBasis, setRevenueBasis] = useState<RevenueBasisMode>('operating_only');
  const [growthChartView, setGrowthChartView] = useState<GrowthChartView>('nominal');

  // Hover states
  const [hoveredColKey, setHoveredColKey] = useState<string | null>(null);
  const [hoveredMonthKey, setHoveredMonthKey] = useState<string | null>(null);

  // Detected ITDA COA accounts for full auditability in EBITDA
  const detectedItdaAccounts = useMemo(
    () => extractDetectedItdaAccounts(data?.pnlAccounts || []),
    [data?.pnlAccounts]
  );

  const hasMonthlyItdaSupport = useMemo(
    () => monthlyRows.some((r) => r.hasMonthlyItdaFields),
    [monthlyRows]
  );

  const periodItdaFromCoa = useMemo(
    () => detectedItdaAccounts.reduce((sum, a) => sum + a.amount, 0),
    [detectedItdaAccounts]
  );

  // Revenue Growth rows (with MoM nominal & percentage delta)
  const growthRows = useMemo<GrowthRow[]>(() => {
    return monthlyRows.map((row, idx) => {
      const revenueValue =
        revenueBasis === 'operating_only' ? row.revenueOperating : row.totalPendapatan;
      const prevRevenueValue =
        idx > 0
          ? revenueBasis === 'operating_only'
            ? monthlyRows[idx - 1].revenueOperating
            : monthlyRows[idx - 1].totalPendapatan
          : null;
      const deltaNominal =
        prevRevenueValue !== null ? revenueValue - prevRevenueValue : null;
      const growthPct =
        prevRevenueValue !== null && Math.abs(prevRevenueValue) > 0
          ? ((revenueValue - prevRevenueValue) / Math.abs(prevRevenueValue)) * 100
          : null;
      return {
        row,
        revenueValue,
        prevRevenueValue,
        deltaNominal,
        growthPct,
      };
    });
  }, [monthlyRows, revenueBasis]);

  // Period aggregate totals across all 4 KPIs
  const totals = useMemo(() => {
    const sumRevOp = monthlyRows.reduce((s, r) => s + r.revenueOperating, 0);
    const sumTotalPend = monthlyRows.reduce((s, r) => s + r.totalPendapatan, 0);
    const sumCogs = monthlyRows.reduce((s, r) => s + r.cogs, 0);
    const sumCogsMat = monthlyRows.reduce((s, r) => s + r.cogsMaterial, 0);
    const sumCogsLab = monthlyRows.reduce((s, r) => s + r.cogsLabour, 0);
    const sumCogsOth = monthlyRows.reduce((s, r) => s + r.cogsOther, 0);
    const sumGrossProfit = monthlyRows.reduce((s, r) => s + r.grossProfit, 0);
    const sumOpex = monthlyRows.reduce((s, r) => s + r.opex, 0);
    const sumOpTotalCost = monthlyRows.reduce((s, r) => s + r.operatingExpenseTotal, 0);
    const sumTotalBiaya = monthlyRows.reduce((s, r) => s + r.totalBiaya, 0);
    const sumEbit = monthlyRows.reduce((s, r) => s + r.operatingProfitEbit, 0);
    const sumPbt = monthlyRows.reduce((s, r) => s + r.profitBeforeTax, 0);
    const sumInterest = monthlyRows.reduce((s, r) => s + r.interestExpense, 0);
    const sumDepAmort = monthlyRows.reduce((s, r) => s + r.depreciationAmortization, 0);
    const sumTaxInOpex = monthlyRows.reduce((s, r) => s + r.taxExpenseInOpex, 0);
    const sumItda = monthlyRows.reduce((s, r) => s + r.itdaTotal, 0);
    const sumBiayaMinusItda = monthlyRows.reduce((s, r) => s + r.biayaMinusItda, 0);
    const sumEbitda = monthlyRows.reduce((s, r) => s + r.ebitda, 0);

    const grossMarginPct = sumRevOp > 0 ? (sumGrossProfit / sumRevOp) * 100 : 0;
    const opMarginPbtPct = sumTotalPend > 0 ? (sumPbt / sumTotalPend) * 100 : 0;
    const opMarginEbitPct = sumRevOp > 0 ? (sumEbit / sumRevOp) * 100 : 0;
    const ebitdaMarginPct = sumTotalPend > 0 ? (sumEbitda / sumTotalPend) * 100 : 0;

    const growthSelectedTotal = growthRows.reduce((s, g) => s + g.revenueValue, 0);
    const avgMonthlyRevenue =
      growthRows.length > 0 ? growthSelectedTotal / growthRows.length : 0;
    const firstRev = growthRows.length > 0 ? growthRows[0].revenueValue : 0;
    const lastRev =
      growthRows.length > 0 ? growthRows[growthRows.length - 1].revenueValue : 0;
    const overallGrowthPct =
      growthRows.length >= 2 && Math.abs(firstRev) > 0
        ? ((lastRev - firstRev) / Math.abs(firstRev)) * 100
        : null;
    const validMomRates = growthRows
      .map((g) => g.growthPct)
      .filter((v): v is number => v !== null);
    const avgMomGrowthPct =
      validMomRates.length > 0
        ? validMomRates.reduce((s, v) => s + v, 0) / validMomRates.length
        : null;

    return {
      sumRevOp,
      sumTotalPend,
      sumCogs,
      sumCogsMat,
      sumCogsLab,
      sumCogsOth,
      sumGrossProfit,
      grossMarginPct,
      sumOpex,
      sumOpTotalCost,
      sumTotalBiaya,
      sumEbit,
      sumPbt,
      opMarginPbtPct,
      opMarginEbitPct,
      sumInterest,
      sumDepAmort,
      sumTaxInOpex,
      sumItda,
      sumBiayaMinusItda,
      sumEbitda,
      ebitdaMarginPct,
      growthSelectedTotal,
      avgMonthlyRevenue,
      firstRev,
      lastRev,
      overallGrowthPct,
      avgMomGrowthPct,
    };
  }, [growthRows, monthlyRows]);

  // --- Multi-metric grouped vertical chart definitions (for 03 Gross Profit & 05 EBITDA) ---
  const groupedMetricDefs = useMemo(() => {
    if (mode === 'gross_profit_margin') {
      return [
        {
          key: 'pendapatan',
          label: 'Pendapatan',
          color: '#0D7678',
          getter: (r: NormalizedMonthlyFinanceRow) => r.revenueOperating,
          subtitle: 'Pendapatan Usaha (COA tipe 11)',
        },
        {
          key: 'hpp',
          label: 'Harga Pokok Penjualan',
          color: '#D97706',
          getter: (r: NormalizedMonthlyFinanceRow) => r.cogs,
          subtitle: 'HPP / COGS (COA tipe 12)',
        },
        {
          key: 'gross_profit',
          label: 'Gross Profit Margin',
          color: '#10B981',
          getter: (r: NormalizedMonthlyFinanceRow) => r.grossProfit,
          subtitle: 'Pendapatan − Harga Pokok Penjualan',
        },
      ];
    }
    return [
      {
        key: 'pendapatan',
        label: 'Pendapatan',
        color: '#0D7678',
        getter: (r: NormalizedMonthlyFinanceRow) => r.totalPendapatan,
        subtitle: 'Pendapatan Usaha (11) + Pendapatan Lain (14)',
      },
      {
        key: 'biaya_itda',
        label: 'Biaya - ITDA',
        color: '#D97706',
        getter: (r: NormalizedMonthlyFinanceRow) => r.biayaMinusItda,
        subtitle: 'Total Biaya dikurangi Bunga, Pajak, Depresiasi & Amortisasi',
      },
      {
        key: 'ebitda',
        label: 'EBITDA',
        color: '#10B981',
        getter: (r: NormalizedMonthlyFinanceRow) => r.ebitda,
        subtitle: 'Pendapatan − (Biaya − ITDA)',
      },
    ];
  }, [mode]);

  const groupedChartScale = useMemo(() => {
    const vals: number[] = [];
    for (const r of monthlyRows) {
      for (const m of groupedMetricDefs) {
        vals.push(m.getter(r));
      }
    }
    const minVal = vals.length > 0 ? Math.min(0, ...vals) : 0;
    const maxVal = vals.length > 0 ? Math.max(0, ...vals) : 100;
    return computeNiceScale(minVal, maxVal, 5);
  }, [groupedMetricDefs, monthlyRows]);

  const hoveredGroupedInfo = useMemo(() => {
    if (!hoveredColKey) return null;
    for (const row of monthlyRows) {
      for (const metric of groupedMetricDefs) {
        if (
          hoveredColKey === `${metric.key}-${row.month}` ||
          hoveredColKey === `${row.month}-${metric.key}`
        ) {
          const val = metric.getter(row);
          const denom =
            mode === 'gross_profit_margin' ? row.revenueOperating : row.totalPendapatan;
          const pctNote =
            (metric.key === 'gross_profit' || metric.key === 'ebitda') && denom > 0
              ? `${formatPct((val / denom) * 100)} dari pendapatan`
              : metric.subtitle;
          return {
            title: `${metric.label} · ${row.labelFull}`,
            subtitle: pctNote,
            value: val,
          };
        }
      }
    }
    return null;
  }, [groupedMetricDefs, hoveredColKey, mode, monthlyRows]);

  // --- Operating Profit Margin horizontal chart model (04) ---
  const operatingRowsNewestTop = useMemo(() => [...monthlyRows].reverse(), [monthlyRows]);

  const operatingChartScale = useMemo(() => {
    const vals = operatingRowsNewestTop.map((r) =>
      operatingBasis === 'pbt_template' ? r.operatingMarginPbtPct : r.operatingMarginEbitPct
    );
    const minVal = vals.length > 0 ? Math.min(0, ...vals) : 0;
    const maxVal = vals.length > 0 ? Math.max(10, ...vals) : 40;
    return computeNiceScale(minVal, maxVal, 5);
  }, [operatingBasis, operatingRowsNewestTop]);

  const hoveredOperatingRow = useMemo(
    () => operatingRowsNewestTop.find((r) => r.month === hoveredMonthKey) || null,
    [hoveredMonthKey, operatingRowsNewestTop]
  );

  // --- Revenue Growth single-series vertical column chart model (06) ---
  const growthChartScale = useMemo(() => {
    if (growthChartView === 'nominal') {
      const vals = growthRows.map((g) => g.revenueValue);
      const minVal = vals.length > 0 ? Math.min(0, ...vals) : 0;
      const maxVal = vals.length > 0 ? Math.max(0, ...vals) : 100;
      return computeNiceScale(minVal, maxVal, 5);
    }
    const vals = growthRows.map((g) => g.growthPct ?? 0);
    const minVal = vals.length > 0 ? Math.min(0, ...vals) : 0;
    const maxVal = vals.length > 0 ? Math.max(10, ...vals) : 25;
    return computeNiceScale(minVal, maxVal, 5);
  }, [growthChartView, growthRows]);

  const hoveredGrowthRow = useMemo(
    () => growthRows.find((g) => g.row.month === hoveredMonthKey) || null,
    [growthRows, hoveredMonthKey]
  );

  const applyMonthPreset = (fromM: number, toM: number) => {
    setStartMonth(fromM);
    setEndMonth(toM);
  };

  // CSV export per KPI mode
  const handleExportCsv = () => {
    if (monthlyRows.length === 0) return;
    const suffix = `${selectedYear}_${String(effectiveStartMonth).padStart(2, '0')}-${String(effectiveEndMonth).padStart(2, '0')}`;

    if (mode === 'gross_profit_margin') {
      const rows: Array<Array<string | number>> = [
        [
          'Bulan',
          'Pendapatan Usaha (ctipe 11)',
          'Harga Pokok Penjualan (ctipe 12)',
          'Gross Profit Margin (Rp)',
          'Gross Margin (%)',
        ],
        ...monthlyRows.map((r) => [
          r.labelShort,
          Math.round(r.revenueOperating),
          Math.round(r.cogs),
          Math.round(r.grossProfit),
          r.grossMarginPct.toFixed(2),
        ]),
        [
          'TOTAL / RATA-RATA',
          Math.round(totals.sumRevOp),
          Math.round(totals.sumCogs),
          Math.round(totals.sumGrossProfit),
          totals.grossMarginPct.toFixed(2),
        ],
      ];
      downloadCsvFile(`${meta.csvPrefix}_${suffix}.csv`, rows);
      return;
    }

    if (mode === 'operating_profit_margin') {
      const isPbt = operatingBasis === 'pbt_template';
      const rows: Array<Array<string | number>> = [
        [
          'Bulan',
          'Pendapatan',
          'Biaya',
          isPbt ? 'L/R Sebelum Pajak' : 'Laba Operasional (EBIT)',
          'Operating Profit Margin (%)',
        ],
        ...monthlyRows.map((r) => [
          r.labelShort,
          Math.round(isPbt ? r.totalPendapatan : r.revenueOperating),
          Math.round(isPbt ? r.totalBiaya : r.operatingExpenseTotal),
          Math.round(isPbt ? r.profitBeforeTax : r.operatingProfitEbit),
          (isPbt ? r.operatingMarginPbtPct : r.operatingMarginEbitPct).toFixed(2),
        ]),
        [
          'TOTAL / RATA-RATA',
          Math.round(isPbt ? totals.sumTotalPend : totals.sumRevOp),
          Math.round(isPbt ? totals.sumTotalBiaya : totals.sumOpTotalCost),
          Math.round(isPbt ? totals.sumPbt : totals.sumEbit),
          (isPbt ? totals.opMarginPbtPct : totals.opMarginEbitPct).toFixed(2),
        ],
      ];
      downloadCsvFile(`${meta.csvPrefix}_${suffix}.csv`, rows);
      return;
    }

    if (mode === 'ebitda') {
      const rows: Array<Array<string | number>> = [
        [
          'Bulan',
          'Pendapatan',
          'Total Biaya',
          'Bunga (Interest)',
          'Depresiasi & Amortisasi',
          'Pajak Penghasilan di Biaya',
          'Total ITDA',
          'Biaya - ITDA',
          'EBITDA',
          'EBITDA Margin (%)',
        ],
        ...monthlyRows.map((r) => [
          r.labelShort,
          Math.round(r.totalPendapatan),
          Math.round(r.totalBiaya),
          Math.round(r.interestExpense),
          Math.round(r.depreciationAmortization),
          Math.round(r.taxExpenseInOpex),
          Math.round(r.itdaTotal),
          Math.round(r.biayaMinusItda),
          Math.round(r.ebitda),
          r.ebitdaMarginPct.toFixed(2),
        ]),
        [
          'TOTAL / RATA-RATA',
          Math.round(totals.sumTotalPend),
          Math.round(totals.sumTotalBiaya),
          Math.round(totals.sumInterest),
          Math.round(totals.sumDepAmort),
          Math.round(totals.sumTaxInOpex),
          Math.round(totals.sumItda),
          Math.round(totals.sumBiayaMinusItda),
          Math.round(totals.sumEbitda),
          totals.ebitdaMarginPct.toFixed(2),
        ],
      ];
      downloadCsvFile(`${meta.csvPrefix}_${suffix}.csv`, rows);
      return;
    }

    // Revenue Growth Rate CSV
    const rows: Array<Array<string | number>> = [
      ['Bulan', 'Pendapatan (IDR)', 'Selisih MoM (IDR)', 'Revenue Growth Rate MoM (%)'],
      ...growthRows.map((g) => [
        g.row.labelShort,
        Math.round(g.revenueValue),
        g.deltaNominal !== null ? Math.round(g.deltaNominal) : '-',
        g.growthPct !== null ? g.growthPct.toFixed(2) : '-',
      ]),
      [
        'TOTAL / RATA-RATA',
        Math.round(totals.growthSelectedTotal),
        growthRows.length >= 2 ? Math.round(totals.lastRev - totals.firstRev) : '-',
        totals.overallGrowthPct !== null ? totals.overallGrowthPct.toFixed(2) : '-',
      ],
    ];
    downloadCsvFile(`${meta.csvPrefix}_${suffix}.csv`, rows);
  };

  return (
    <div className="space-y-5">
      {/* Header & Period Filter Card */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
          <div className="space-y-1 min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
              <span>{t('bi.modules.accounting.name')}</span>
              <span aria-hidden="true">·</span>
              <span>{meta.category}</span>
              <span aria-hidden="true">·</span>
              <span>{meta.chartTypeLabel}</span>
            </div>
            <h3 className="font-display text-lg font-bold text-[var(--text)] leading-snug">
              {meta.title}
            </h3>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed max-w-3xl">
              {meta.description}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void fetchFinanceData({ refresh: true })}
              disabled={refreshing || loading}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              <span>{t('bi.refresh')}</span>
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={monthlyRows.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-[var(--accent)] text-[var(--on-accent)] hover:opacity-95 transition-opacity disabled:opacity-45 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{t('bi.exportCsv')}</span>
            </button>
          </div>
        </div>

        {/* Year + Month Range Filter Bar */}
        <div className="pt-3.5 border-t border-[var(--border)] flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label
                htmlFor={`bi-year-${mode}`}
                className="block text-[11px] font-medium text-[var(--text-muted)]"
              >
                {t('bi.year')}
              </label>
              <div className="relative">
                <Calendar className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <select
                  id={`bi-year-${mode}`}
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
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
                htmlFor={`bi-start-${mode}`}
                className="block text-[11px] font-medium text-[var(--text-muted)]"
              >
                {t('bi.fromMonth')}
              </label>
              <select
                id={`bi-start-${mode}`}
                value={effectiveStartMonth}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setStartMonth(next);
                  if (next > endMonth) setEndMonth(next);
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
                htmlFor={`bi-end-${mode}`}
                className="block text-[11px] font-medium text-[var(--text-muted)]"
              >
                {t('bi.toMonth')}
              </label>
              <select
                id={`bi-end-${mode}`}
                value={effectiveEndMonth}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setEndMonth(next);
                  if (next < startMonth) setStartMonth(next);
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
                  const active =
                    effectiveStartMonth === preset.from && effectiveEndMonth === preset.to;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => applyMonthPreset(preset.from, preset.to)}
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

            {/* Operating Profit Basis Switcher (Mode 04) */}
            {mode === 'operating_profit_margin' && (
              <div className="space-y-1 ml-auto">
                <span className="block text-[11px] font-medium text-[var(--text-muted)]">
                  Basis Laba Operasi
                </span>
                <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
                  <button
                    type="button"
                    onClick={() => setOperatingBasis('pbt_template')}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      operatingBasis === 'pbt_template'
                        ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    L/R Sebelum Pajak (Template)
                  </button>
                  <button
                    type="button"
                    onClick={() => setOperatingBasis('ebit_pure')}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      operatingBasis === 'ebit_pure'
                        ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    EBIT Murni (COA 11–13)
                  </button>
                </div>
              </div>
            )}

            {/* Revenue Basis Switcher (Mode 06) */}
            {mode === 'revenue_growth_rate' && (
              <div className="space-y-1 ml-auto">
                <span className="block text-[11px] font-medium text-[var(--text-muted)]">
                  Basis Pendapatan
                </span>
                <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
                  <button
                    type="button"
                    onClick={() => setRevenueBasis('operating_only')}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      revenueBasis === 'operating_only'
                        ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    Pendapatan Usaha (COA 11)
                  </button>
                  <button
                    type="button"
                    onClick={() => setRevenueBasis('total_revenue')}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      revenueBasis === 'total_revenue'
                        ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    Total Pendapatan (11 + 14)
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Informational Notices */}
          {(cutoffWarning || (mode === 'ebitda' && !hasMonthlyItdaSupport && periodItdaFromCoa > 0)) && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-[var(--text-muted)] pt-2 border-t border-[var(--border)]/60">
              <div className="flex items-start gap-2">
                <Info className="w-3.5 h-3.5 text-[var(--accent)] shrink-0 mt-0.5" />
                <span className="leading-relaxed">
                  {cutoffWarning
                    ? `Periode jurnal aktif MyERP Plus dimulai sejak ${cutoffWarning} (menyesuaikan batas data bersih Laporan Keuangan ERP). `
                    : ''}
                  {mode === 'ebitda' && !hasMonthlyItdaSupport && periodItdaFromCoa > 0
                    ? `Bridge ERP lokal versi sebelumnya belum mengirim pemisahan ITDA per bulan (total ITDA periode terdeteksi ${formatIdr(periodItdaFromCoa)} pada COA). Unduh ulang Bridge ERP terbaru agar pengurangan ITDA bulanan tampil presisi.`
                    : ''}
                </span>
              </div>
              {mode === 'ebitda' && !hasMonthlyItdaSupport && onDownloadBridge && (
                <button
                  type="button"
                  onClick={onDownloadBridge}
                  className="text-xs font-semibold text-[var(--accent)] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Unduh Bridge Terbaru →
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Loading Skeleton */}
      {loading && !data && (
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
      )}

      {/* Error State */}
      {errorMsg && !loading && (
        <div className="bg-[var(--surface)] border border-rose-300 dark:border-rose-800 rounded-xl p-6 space-y-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="text-sm font-semibold text-[var(--text)]">
                Data Keuangan ERP Belum Dapat Dimuat
              </h4>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">{errorMsg}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => void fetchFinanceData({ refresh: true })}
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
      )}

      {/* Empty State */}
      {!loading && !errorMsg && data && monthlyRows.length === 0 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-10 text-center space-y-3">
          <h4 className="font-display text-base font-bold text-[var(--text)]">
            Tidak Ada Jurnal Laba Rugi pada Periode {MONTH_SHORT_ID[effectiveStartMonth - 1]}–
            {MONTH_SHORT_ID[effectiveEndMonth - 1]} {selectedYear}
          </h4>
          <p className="text-xs text-[var(--text-muted)] max-w-xl mx-auto leading-relaxed">
            Tidak ditemukan transaksi jurnal terposting (COA tipe 11–17) pada rentang bulan dan tahun yang dipilih.
            {data.coverage?.minDateActive && data.coverage?.maxDateActive
              ? ` Data aktif ERP saat ini tercatat dari ${data.coverage.minDateActive} hingga ${data.coverage.maxDateActive}.`
              : ''}
          </p>
          <div className="pt-1">
            <button
              type="button"
              onClick={handleResetActivePeriod}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-[var(--accent)] text-[var(--on-accent)] hover:opacity-95 cursor-pointer"
            >
              Tampilkan Periode Aktif ERP
            </button>
          </div>
        </div>
      )}

      {/* Populated KPI Dashboard */}
      {!errorMsg && data && monthlyRows.length > 0 && (
        <div
          className={`space-y-5 transition-opacity duration-150 ${loading ? 'opacity-65' : 'opacity-100'}`}
        >
          {/* 4-Column Summary Strip */}
          {mode === 'gross_profit_margin' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Total Pendapatan Usaha</span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate" title={formatIdr(totals.sumRevOp)}>
                  {formatIdr(totals.sumRevOp)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  COA tipe 11 · {monthlyRows.length} bulan
                </span>
              </div>

              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Harga Pokok Penjualan (HPP)</span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate" title={formatIdr(totals.sumCogs)}>
                  {formatIdr(totals.sumCogs)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] tabular-nums block">
                  {totals.sumRevOp > 0 ? formatPct((totals.sumCogs / totals.sumRevOp) * 100) : '0,00%'} dari pendapatan
                </span>
              </div>

              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Total Gross Profit Margin</span>
                <p
                  className={`font-mono text-lg font-bold tabular-nums truncate ${
                    totals.sumGrossProfit >= 0
                      ? 'text-[var(--accent)]'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                  title={formatIdr(totals.sumGrossProfit)}
                >
                  {formatIdr(totals.sumGrossProfit)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  Pendapatan − HPP (Laba Kotor)
                </span>
              </div>

              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Rasio Gross Margin (%)</span>
                <p
                  className={`font-mono text-xl font-bold tabular-nums ${
                    totals.grossMarginPct >= 0
                      ? 'text-[var(--accent)]'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {formatPct(totals.grossMarginPct)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  (Gross Profit ÷ Pendapatan) × 100%
                </span>
              </div>
            </div>
          )}

          {mode === 'operating_profit_margin' && (() => {
            const isPbt = operatingBasis === 'pbt_template';
            const sumPend = isPbt ? totals.sumTotalPend : totals.sumRevOp;
            const sumCost = isPbt ? totals.sumTotalBiaya : totals.sumOpTotalCost;
            const sumProfit = isPbt ? totals.sumPbt : totals.sumEbit;
            const marginPct = isPbt ? totals.opMarginPbtPct : totals.opMarginEbitPct;

            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Total Pendapatan</span>
                  <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate" title={formatIdr(sumPend)}>
                    {formatIdr(sumPend)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    {isPbt ? 'COA tipe 11 + 14' : 'Pendapatan Usaha (COA tipe 11)'}
                  </span>
                </div>

                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Total Biaya</span>
                  <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate" title={formatIdr(sumCost)}>
                    {formatIdr(sumCost)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    {isPbt ? 'HPP + Beban Ops + Beban Lain' : 'HPP (12) + Beban Operasional (13)'}
                  </span>
                </div>

                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">
                    {isPbt ? 'L/R Sebelum Pajak' : 'Laba Operasional (EBIT)'}
                  </span>
                  <p
                    className={`font-mono text-lg font-bold tabular-nums truncate ${
                      sumProfit >= 0 ? 'text-[var(--text)]' : 'text-rose-600 dark:text-rose-400'
                    }`}
                    title={formatIdr(sumProfit)}
                  >
                    {formatIdr(sumProfit)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Pendapatan − Biaya
                  </span>
                </div>

                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Operating Profit Margin</span>
                  <p
                    className={`font-mono text-xl font-bold tabular-nums ${
                      marginPct >= 0 ? 'text-[var(--accent)]' : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {formatPct(marginPct)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    ({isPbt ? 'L/R Sebelum Pajak' : 'EBIT'} ÷ Pendapatan) × 100%
                  </span>
                </div>
              </div>
            );
          })()}

          {mode === 'ebitda' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Total Pendapatan</span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate" title={formatIdr(totals.sumTotalPend)}>
                  {formatIdr(totals.sumTotalPend)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  COA tipe 11 + 14 · {monthlyRows.length} bulan
                </span>
              </div>

              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Total Biaya − ITDA</span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate" title={formatIdr(totals.sumBiayaMinusItda)}>
                  {formatIdr(totals.sumBiayaMinusItda)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] tabular-nums block">
                  ITDA dikeluarkan: {formatIdr(totals.sumItda)}
                </span>
              </div>

              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Total EBITDA</span>
                <p
                  className={`font-mono text-lg font-bold tabular-nums truncate ${
                    totals.sumEbitda >= 0
                      ? 'text-[var(--accent)]'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                  title={formatIdr(totals.sumEbitda)}
                >
                  {formatIdr(totals.sumEbitda)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  Pendapatan − (Biaya − ITDA)
                </span>
              </div>

              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">EBITDA Margin (%)</span>
                <p
                  className={`font-mono text-xl font-bold tabular-nums ${
                    totals.ebitdaMarginPct >= 0
                      ? 'text-[var(--accent)]'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {formatPct(totals.ebitdaMarginPct)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  {detectedItdaAccounts.length} akun COA ITDA terdeteksi
                </span>
              </div>
            </div>
          )}

          {mode === 'revenue_growth_rate' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Total Pendapatan Periode</span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate" title={formatIdr(totals.growthSelectedTotal)}>
                  {formatIdr(totals.growthSelectedTotal)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  {growthRows.length} bulan terposting
                </span>
              </div>

              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Rata-rata Pendapatan / Bulan</span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate" title={formatIdr(totals.avgMonthlyRevenue)}>
                  {formatIdr(totals.avgMonthlyRevenue)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  Bulan terakhir: {formatCompactIdr(totals.lastRev)}
                </span>
              </div>

              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Pertumbuhan Awal → Akhir</span>
                <p
                  className={`font-mono text-xl font-bold tabular-nums ${
                    totals.overallGrowthPct === null
                      ? 'text-[var(--text-muted)]'
                      : totals.overallGrowthPct >= 0
                        ? 'text-[var(--accent)]'
                        : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {totals.overallGrowthPct !== null
                    ? formatPct(totals.overallGrowthPct, true)
                    : '—'}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  {growthRows.length >= 2
                    ? `${growthRows[0].row.labelShort} → ${growthRows[growthRows.length - 1].row.labelShort}`
                    : 'Butuh minimal 2 bulan data'}
                </span>
              </div>

              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Rata-rata Growth MoM (%)</span>
                <p
                  className={`font-mono text-xl font-bold tabular-nums ${
                    totals.avgMomGrowthPct === null
                      ? 'text-[var(--text-muted)]'
                      : totals.avgMomGrowthPct >= 0
                        ? 'text-[var(--accent)]'
                        : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {totals.avgMomGrowthPct !== null
                    ? formatPct(totals.avgMomGrowthPct, true)
                    : '—'}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  Rata-rata perubahan bulanan
                </span>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* PRIMARY VISUALIZATION PER KPI MODE                                        */}
          {/* ========================================================================= */}

          {/* MODES 03 (GROSS PROFIT MARGIN) & 05 (EBITDA) — 6 selectable diagram shapes */}
          {(mode === 'gross_profit_margin' || mode === 'ebitda') && (
            <BiGroupedColumnChart
              title={
                mode === 'gross_profit_margin'
                  ? 'Grafik Perbandingan Gross Profit Margin'
                  : 'Grafik Perbandingan EBITDA'
              }
              subtitle={`${
                mode === 'gross_profit_margin'
                  ? 'Pendapatan, Harga Pokok Penjualan, dan Gross Profit Margin'
                  : 'Pendapatan, Biaya − ITDA, dan EBITDA'
              } periode ${monthlyRows[0].labelShort} s.d. ${monthlyRows[monthlyRows.length - 1].labelShort}`}
              defaultChartType={mode === 'ebitda' ? 'cone' : 'column'}
              months={monthlyRows.map((r) => ({
                key: r.month,
                label: r.labelShort,
                labelFull: r.labelFull,
              }))}
              metrics={groupedMetricDefs.map((metric) => ({
                key: metric.key,
                label: metric.label,
                color: metric.color,
                valuesByMonth: Object.fromEntries(
                  monthlyRows.map((r) => [r.month, metric.getter(r)])
                ),
              }))}
              formatAxisTick={formatCompactIdr}
              formatExactValue={formatIdr}
            />
          )}

          {/* MODE 04 (OPERATING PROFIT MARGIN) — 6 selectable diagram shapes */}
          {mode === 'operating_profit_margin' && (
            <BiHorizontalBarChart
              title="Operating Profit Margin"
              subtitle={
                operatingBasis === 'pbt_template'
                  ? 'Persentase L/R Sebelum Pajak terhadap Total Pendapatan per bulan'
                  : 'Persentase Laba Operasional Murni (EBIT) terhadap Pendapatan Usaha per bulan'
              }
              legendLabel="Operating Profit Margin (%)"
              defaultChartType="horizontal"
              data={monthlyRows.map((r) => {
                const marginVal =
                  operatingBasis === 'pbt_template'
                    ? r.operatingMarginPbtPct
                    : r.operatingMarginEbitPct;
                const rev =
                  operatingBasis === 'pbt_template' ? r.totalPendapatan : r.revenueOperating;
                const prof =
                  operatingBasis === 'pbt_template' ? r.profitBeforeTax : r.operatingProfitEbit;
                return {
                  key: r.month,
                  label: r.labelShort,
                  value: marginVal,
                  valueLabel: formatPct(marginVal),
                  hoverSummary: `Pendapatan: ${formatIdr(rev)} · ${operatingBasis === 'pbt_template' ? 'L/R Sblm Pajak' : 'EBIT'}: ${formatIdr(prof)} · Margin: ${formatPct(marginVal)}`,
                };
              })}
              formatAxisTick={(v) => `${v.toFixed(2)}%`}
            />
          )}

          {/* MODE 06 (REVENUE GROWTH RATE) — 6 selectable diagram shapes */}
          {mode === 'revenue_growth_rate' && (
            <BiVerticalSingleChart
              title="Revenue Growth Rate"
              subtitle={
                growthChartView === 'nominal'
                  ? 'Perbandingan nilai pendapatan bulanan dengan indikator pertumbuhan MoM (%)'
                  : 'Persentase laju pertumbuhan pendapatan antarbulan (Month-over-Month %)'
              }
              legendLabel={
                growthChartView === 'nominal'
                  ? 'Nominal Pendapatan (Rp)'
                  : 'Pertumbuhan MoM (%)'
              }
              defaultChartType="cylinder"
              headerRight={
                <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
                  <button
                    type="button"
                    onClick={() => setGrowthChartView('nominal')}
                    className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      growthChartView === 'nominal'
                        ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    Nominal
                  </button>
                  <button
                    type="button"
                    onClick={() => setGrowthChartView('growth_pct')}
                    className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      growthChartView === 'growth_pct'
                        ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    MoM (%)
                  </button>
                </div>
              }
              data={growthRows.map((g) => ({
                key: g.row.month,
                label: g.row.labelShort,
                value: growthChartView === 'nominal' ? g.revenueValue : (g.growthPct ?? 0),
                valueLabel:
                  growthChartView === 'nominal'
                    ? formatCompactIdr(g.revenueValue)
                    : g.growthPct !== null
                      ? formatPct(g.growthPct, true)
                      : 'Basis',
                secondaryLabel:
                  growthChartView === 'nominal' && g.growthPct !== null
                    ? formatPct(g.growthPct, true)
                    : undefined,
                hoverSummary: `Pendapatan: ${formatIdr(g.revenueValue)} · Selisih MoM: ${g.deltaNominal !== null ? `${g.deltaNominal >= 0 ? '+' : ''}${formatIdr(g.deltaNominal)}` : 'Bulan awal'} · Growth: ${g.growthPct !== null ? formatPct(g.growthPct, true) : '—'}`,
              }))}
              formatAxisTick={(v) =>
                growthChartView === 'nominal' ? formatCompactIdr(v) : `${v.toFixed(0)}%`
              }
            />
          )}

          {/* ========================================================================= */}
          {/* MONTHLY RECONCILIATION TABLE PER KPI MODE                                 */}
          {/* ========================================================================= */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="font-display text-sm font-bold text-[var(--text)]">
                  {mode === 'gross_profit_margin' && 'Tabel Data Gross Profit Margin Bulanan'}
                  {mode === 'operating_profit_margin' &&
                    'Tabel Perhitungan Operating Profit Margin Bulanan'}
                  {mode === 'ebitda' && 'Tabel Perhitungan EBITDA Bulanan'}
                  {mode === 'revenue_growth_rate' && 'Tabel Pertumbuhan Pendapatan (Revenue Growth Rate)'}
                </h4>
                <p className="text-[11px] text-[var(--text-muted)]">
                  Sumber aktual: Buku Besar ERP (jurnal terposting, non-void)
                </p>
              </div>

              {mode === 'gross_profit_margin' && (
                <button
                  type="button"
                  onClick={() => setShowHppBreakdown((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--accent)] transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  {showHppBreakdown ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                  <span>{showHppBreakdown ? 'Sembunyikan Rincian HPP' : 'Lihat Rincian HPP'}</span>
                </button>
              )}

              {mode === 'ebitda' && (
                <button
                  type="button"
                  onClick={() => setShowItdaBreakdown((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--accent)] transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  {showItdaBreakdown ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {showItdaBreakdown ? 'Sembunyikan Rincian ITDA' : 'Lihat Rincian ITDA'}
                  </span>
                </button>
              )}
            </div>

            <div className="overflow-x-auto">
              {/* Table 03: Gross Profit Margin */}
              {mode === 'gross_profit_margin' && (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                      <th className="text-left font-semibold px-4 py-2.5 whitespace-nowrap">Bulan</th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">Pendapatan</th>
                      {showHppBreakdown && (
                        <>
                          <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">HPP Material</th>
                          <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">HPP Tenaga Kerja</th>
                          <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">HPP Lainnya</th>
                        </>
                      )}
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">
                        Harga Pokok Penjualan
                      </th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">
                        Gross Profit Margin
                      </th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">
                        Margin (%)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)] font-mono tabular-nums">
                    {monthlyRows.map((row) => (
                      <tr key={row.month} className="hover:bg-[var(--bg)]/70 transition-colors">
                        <td className="px-4 py-2.5 font-sans font-medium text-[var(--text)] whitespace-nowrap">
                          {row.labelShort}{' '}
                          <span className="text-[11px] text-[var(--text-muted)] font-normal">
                            ({row.labelFull})
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--text)] whitespace-nowrap">
                          {formatNumberPlain(row.revenueOperating)}
                        </td>
                        {showHppBreakdown && (
                          <>
                            <td className="px-4 py-2.5 text-right text-[var(--text-muted)] whitespace-nowrap">
                              {formatNumberPlain(row.cogsMaterial)}
                            </td>
                            <td className="px-4 py-2.5 text-right text-[var(--text-muted)] whitespace-nowrap">
                              {formatNumberPlain(row.cogsLabour)}
                            </td>
                            <td className="px-4 py-2.5 text-right text-[var(--text-muted)] whitespace-nowrap">
                              {formatNumberPlain(row.cogsOther)}
                            </td>
                          </>
                        )}
                        <td className="px-4 py-2.5 text-right text-[var(--text)] whitespace-nowrap">
                          {formatNumberPlain(row.cogs)}
                        </td>
                        <td
                          className={`px-4 py-2.5 text-right font-semibold whitespace-nowrap ${
                            row.grossProfit >= 0
                              ? 'text-[var(--accent)]'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {formatNumberPlain(row.grossProfit)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--text-muted)] whitespace-nowrap">
                          {formatPct(row.grossMarginPct)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[var(--bg)] border-t border-[var(--border)] font-mono tabular-nums font-bold">
                      <td className="px-4 py-3 font-sans text-[var(--text)]">Total / Rata-rata</td>
                      <td className="px-4 py-3 text-right text-[var(--text)] whitespace-nowrap">
                        {formatNumberPlain(totals.sumRevOp)}
                      </td>
                      {showHppBreakdown && (
                        <>
                          <td className="px-4 py-3 text-right text-[var(--text-muted)] whitespace-nowrap">
                            {formatNumberPlain(totals.sumCogsMat)}
                          </td>
                          <td className="px-4 py-3 text-right text-[var(--text-muted)] whitespace-nowrap">
                            {formatNumberPlain(totals.sumCogsLab)}
                          </td>
                          <td className="px-4 py-3 text-right text-[var(--text-muted)] whitespace-nowrap">
                            {formatNumberPlain(totals.sumCogsOth)}
                          </td>
                        </>
                      )}
                      <td className="px-4 py-3 text-right text-[var(--text)] whitespace-nowrap">
                        {formatNumberPlain(totals.sumCogs)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right whitespace-nowrap ${
                          totals.sumGrossProfit >= 0
                            ? 'text-[var(--accent)]'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {formatNumberPlain(totals.sumGrossProfit)}
                      </td>
                      <td className="px-4 py-3 text-right text-[var(--text)] whitespace-nowrap">
                        {formatPct(totals.grossMarginPct)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}

              {/* Table 04: Operating Profit Margin */}
              {mode === 'operating_profit_margin' && (() => {
                const isPbt = operatingBasis === 'pbt_template';
                return (
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                        <th className="text-left font-semibold px-4 py-2.5 whitespace-nowrap">Bulan</th>
                        <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">Pendapatan</th>
                        <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">Biaya</th>
                        <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">
                          {isPbt ? 'L/R Sebelum Pajak' : 'Laba Operasional (EBIT)'}
                        </th>
                        <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">
                          Operating Profit Margin
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)] font-mono tabular-nums">
                      {monthlyRows.map((row) => {
                        const pend = isPbt ? row.totalPendapatan : row.revenueOperating;
                        const cost = isPbt ? row.totalBiaya : row.operatingExpenseTotal;
                        const profit = isPbt ? row.profitBeforeTax : row.operatingProfitEbit;
                        const pct = isPbt ? row.operatingMarginPbtPct : row.operatingMarginEbitPct;
                        return (
                          <tr key={row.month} className="hover:bg-[var(--bg)]/70 transition-colors">
                            <td className="px-4 py-2.5 font-sans font-medium text-[var(--text)] whitespace-nowrap">
                              {row.labelShort}{' '}
                              <span className="text-[11px] text-[var(--text-muted)] font-normal">
                                ({row.labelFull})
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right text-[var(--text)] whitespace-nowrap">
                              {formatNumberPlain(pend)}
                            </td>
                            <td className="px-4 py-2.5 text-right text-[var(--text)] whitespace-nowrap">
                              {formatNumberPlain(cost)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-medium text-[var(--text)] whitespace-nowrap">
                              {formatNumberPlain(profit)}
                            </td>
                            <td
                              className={`px-4 py-2.5 text-right font-semibold whitespace-nowrap ${
                                pct >= 0
                                  ? 'text-[var(--accent)]'
                                  : 'text-rose-600 dark:text-rose-400'
                              }`}
                            >
                              {formatPct(pct)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-[var(--bg)] border-t border-[var(--border)] font-mono tabular-nums font-bold">
                        <td className="px-4 py-3 font-sans text-[var(--text)]">Total / Rata-rata</td>
                        <td className="px-4 py-3 text-right text-[var(--text)] whitespace-nowrap">
                          {formatNumberPlain(isPbt ? totals.sumTotalPend : totals.sumRevOp)}
                        </td>
                        <td className="px-4 py-3 text-right text-[var(--text)] whitespace-nowrap">
                          {formatNumberPlain(isPbt ? totals.sumTotalBiaya : totals.sumOpTotalCost)}
                        </td>
                        <td className="px-4 py-3 text-right text-[var(--text)] whitespace-nowrap">
                          {formatNumberPlain(isPbt ? totals.sumPbt : totals.sumEbit)}
                        </td>
                        <td
                          className={`px-4 py-3 text-right whitespace-nowrap ${
                            (isPbt ? totals.opMarginPbtPct : totals.opMarginEbitPct) >= 0
                              ? 'text-[var(--accent)]'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {formatPct(isPbt ? totals.opMarginPbtPct : totals.opMarginEbitPct)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                );
              })()}

              {/* Table 05: EBITDA */}
              {mode === 'ebitda' && (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                      <th className="text-left font-semibold px-4 py-2.5 whitespace-nowrap">Bulan</th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">Pendapatan</th>
                      {showItdaBreakdown && (
                        <>
                          <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">Total Biaya</th>
                          <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">Bunga (I)</th>
                          <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">Depr. &amp; Amort. (D&amp;A)</th>
                          <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">Pajak di Biaya (T)</th>
                        </>
                      )}
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">
                        Biaya − ITDA
                      </th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">
                        EBITDA
                      </th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">
                        EBITDA Margin
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)] font-mono tabular-nums">
                    {monthlyRows.map((row) => (
                      <tr key={row.month} className="hover:bg-[var(--bg)]/70 transition-colors">
                        <td className="px-4 py-2.5 font-sans font-medium text-[var(--text)] whitespace-nowrap">
                          {row.labelShort}{' '}
                          <span className="text-[11px] text-[var(--text-muted)] font-normal">
                            ({row.labelFull})
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--text)] whitespace-nowrap">
                          {formatNumberPlain(row.totalPendapatan)}
                        </td>
                        {showItdaBreakdown && (
                          <>
                            <td className="px-4 py-2.5 text-right text-[var(--text-muted)] whitespace-nowrap">
                              {formatNumberPlain(row.totalBiaya)}
                            </td>
                            <td className="px-4 py-2.5 text-right text-[var(--text-muted)] whitespace-nowrap">
                              {formatNumberPlain(row.interestExpense)}
                            </td>
                            <td className="px-4 py-2.5 text-right text-[var(--text-muted)] whitespace-nowrap">
                              {formatNumberPlain(row.depreciationAmortization)}
                            </td>
                            <td className="px-4 py-2.5 text-right text-[var(--text-muted)] whitespace-nowrap">
                              {formatNumberPlain(row.taxExpenseInOpex)}
                            </td>
                          </>
                        )}
                        <td className="px-4 py-2.5 text-right text-[var(--text)] whitespace-nowrap">
                          {formatNumberPlain(row.biayaMinusItda)}
                        </td>
                        <td
                          className={`px-4 py-2.5 text-right font-semibold whitespace-nowrap ${
                            row.ebitda >= 0
                              ? 'text-[var(--accent)]'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {formatNumberPlain(row.ebitda)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--text-muted)] whitespace-nowrap">
                          {formatPct(row.ebitdaMarginPct)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[var(--bg)] border-t border-[var(--border)] font-mono tabular-nums font-bold">
                      <td className="px-4 py-3 font-sans text-[var(--text)]">Total / Rata-rata</td>
                      <td className="px-4 py-3 text-right text-[var(--text)] whitespace-nowrap">
                        {formatNumberPlain(totals.sumTotalPend)}
                      </td>
                      {showItdaBreakdown && (
                        <>
                          <td className="px-4 py-3 text-right text-[var(--text-muted)] whitespace-nowrap">
                            {formatNumberPlain(totals.sumTotalBiaya)}
                          </td>
                          <td className="px-4 py-3 text-right text-[var(--text-muted)] whitespace-nowrap">
                            {formatNumberPlain(totals.sumInterest)}
                          </td>
                          <td className="px-4 py-3 text-right text-[var(--text-muted)] whitespace-nowrap">
                            {formatNumberPlain(totals.sumDepAmort)}
                          </td>
                          <td className="px-4 py-3 text-right text-[var(--text-muted)] whitespace-nowrap">
                            {formatNumberPlain(totals.sumTaxInOpex)}
                          </td>
                        </>
                      )}
                      <td className="px-4 py-3 text-right text-[var(--text)] whitespace-nowrap">
                        {formatNumberPlain(totals.sumBiayaMinusItda)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right whitespace-nowrap ${
                          totals.sumEbitda >= 0
                            ? 'text-[var(--accent)]'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {formatNumberPlain(totals.sumEbitda)}
                      </td>
                      <td className="px-4 py-3 text-right text-[var(--text)] whitespace-nowrap">
                        {formatPct(totals.ebitdaMarginPct)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}

              {/* Table 06: Revenue Growth Rate */}
              {mode === 'revenue_growth_rate' && (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                      <th className="text-left font-semibold px-4 py-2.5 whitespace-nowrap">Bulan</th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">
                        Pendapatan (Revenue)
                      </th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">
                        Selisih MoM (Rp)
                      </th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">
                        Revenue Growth Rate (%)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)] font-mono tabular-nums">
                    {growthRows.map((g) => (
                      <tr key={g.row.month} className="hover:bg-[var(--bg)]/70 transition-colors">
                        <td className="px-4 py-2.5 font-sans font-medium text-[var(--text)] whitespace-nowrap">
                          {g.row.labelShort}{' '}
                          <span className="text-[11px] text-[var(--text-muted)] font-normal">
                            ({g.row.labelFull})
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium text-[var(--text)] whitespace-nowrap">
                          {formatNumberPlain(g.revenueValue)}
                        </td>
                        <td
                          className={`px-4 py-2.5 text-right whitespace-nowrap ${
                            g.deltaNominal === null
                              ? 'text-[var(--text-muted)]'
                              : g.deltaNominal >= 0
                                ? 'text-[var(--accent)]'
                                : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {g.deltaNominal !== null
                            ? `${g.deltaNominal >= 0 ? '+' : ''}${formatNumberPlain(g.deltaNominal)}`
                            : '— (Basis awal)'}
                        </td>
                        <td
                          className={`px-4 py-2.5 text-right font-semibold whitespace-nowrap ${
                            g.growthPct === null
                              ? 'text-[var(--text-muted)]'
                              : g.growthPct >= 0
                                ? 'text-[var(--accent)]'
                                : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {g.growthPct !== null ? formatPct(g.growthPct, true) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[var(--bg)] border-t border-[var(--border)] font-mono tabular-nums font-bold">
                      <td className="px-4 py-3 font-sans text-[var(--text)]">
                        Total / Pertumbuhan Periode
                      </td>
                      <td className="px-4 py-3 text-right text-[var(--text)] whitespace-nowrap">
                        {formatNumberPlain(totals.growthSelectedTotal)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right whitespace-nowrap ${
                          growthRows.length < 2
                            ? 'text-[var(--text-muted)]'
                            : totals.lastRev - totals.firstRev >= 0
                              ? 'text-[var(--accent)]'
                              : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {growthRows.length >= 2
                          ? `${totals.lastRev - totals.firstRev >= 0 ? '+' : ''}${formatNumberPlain(totals.lastRev - totals.firstRev)}`
                          : '—'}
                      </td>
                      <td
                        className={`px-4 py-3 text-right whitespace-nowrap ${
                          totals.overallGrowthPct === null
                            ? 'text-[var(--text-muted)]'
                            : totals.overallGrowthPct >= 0
                              ? 'text-[var(--accent)]'
                              : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {totals.overallGrowthPct !== null
                          ? formatPct(totals.overallGrowthPct, true)
                          : '—'}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>

            {/* Auditable ITDA COA Account List (shown when expanded on EBITDA) */}
            {mode === 'ebitda' && showItdaBreakdown && (
              <div className="px-5 py-3.5 border-t border-[var(--border)] bg-[var(--bg)]/40 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[var(--text)]">
                    Daftar Akun COA ITDA yang Dikeluarkan dari Biaya ({detectedItdaAccounts.length} akun)
                  </span>
                  <span className="font-mono text-[11px] text-[var(--text-muted)] tabular-nums">
                    Total COA ITDA Periode: {formatIdr(periodItdaFromCoa)}
                  </span>
                </div>
                {detectedItdaAccounts.length === 0 ? (
                  <p className="text-[11px] text-[var(--text-muted)]">
                    Tidak ada transaksi jurnal beban Bunga, Depresiasi/Amortisasi, atau Pajak Penghasilan di dalam COA tipe 12/13/15 pada periode yang dipilih (akun pajak tipe 16–17 sudah otomatis di luar Biaya).
                  </p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 text-[11px]">
                    {detectedItdaAccounts.map((acc) => (
                      <div
                        key={acc.accountNo}
                        className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)]"
                      >
                        <div className="min-w-0 truncate">
                          <span className="font-mono text-[var(--text-muted)] mr-1.5">
                            {acc.accountNo}
                          </span>
                          <span className="text-[var(--text)]">{acc.accountName}</span>
                          <span className="text-[var(--text-muted)] ml-1.5">
                            ·{' '}
                            {acc.category === 'interest'
                              ? 'Bunga (I)'
                              : acc.category === 'depreciation_amortization'
                                ? 'Depr./Amort. (D&A)'
                                : 'Pajak (T)'}
                          </span>
                        </div>
                        <span className="font-mono font-semibold text-[var(--text)] tabular-nums shrink-0">
                          {formatNumberPlain(acc.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Formula Footnote */}
            <div className="px-5 py-3 border-t border-[var(--border)] bg-[var(--bg)]/50 text-[11px] text-[var(--text-muted)] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span>
                {mode === 'gross_profit_margin' &&
                  'Rumus: Gross Profit Margin = Pendapatan Usaha (COA tipe 11) − Harga Pokok Penjualan / HPP (COA tipe 12).'}
                {mode === 'operating_profit_margin' &&
                  (operatingBasis === 'pbt_template'
                    ? 'Rumus: Operating Profit Margin = (L/R Sebelum Pajak ÷ Total Pendapatan) × 100%.'
                    : 'Rumus: Operating Profit Margin = (Laba Operasional EBIT [COA 11 − 12 − 13] ÷ Pendapatan Usaha [COA 11]) × 100%.')}
                {mode === 'ebitda' &&
                  'Rumus: Biaya − ITDA = Total Biaya (COA 12+13+15) − Beban Bunga − Depresiasi & Amortisasi − Pajak Penghasilan · EBITDA = Pendapatan − (Biaya − ITDA).'}
                {mode === 'revenue_growth_rate' &&
                  'Rumus: Revenue Growth Rate MoM = ((Pendapatan Bulan Ini − Pendapatan Bulan Sebelumnya) ÷ Pendapatan Bulan Sebelumnya) × 100%.'}
              </span>
              <span className="font-mono tabular-nums whitespace-nowrap">
                Nominal dalam Rupiah (IDR)
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
