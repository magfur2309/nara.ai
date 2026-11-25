import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  ChevronDown,
  ChevronUp,
  Download,
  Info,
  RefreshCw,
} from 'lucide-react';
import { fetchApiJson } from '../../lib/apiClient';
import { getFreshIdToken } from '../../lib/firebase';
import type {
  ErpFinanceMonthlyPnlRow,
  ErpFinanceQueryResult,
} from '../ErpFinancePanel';
import {
  BiGroupedColumnChart,
  BiHorizontalBarChart,
} from './BiFinanceChartPrimitives';
import { useI18n } from '../../lib/i18n';

export type BiFinanceProfitMode = 'net_profit' | 'net_profit_margin';

interface BiFinanceProfitKpiProps {
  mode: BiFinanceProfitMode;
  idToken: string;
  onDownloadBridge?: () => void;
}

type TaxBasisMode = 'erp_actual' | 'estimated_rate';
type ColumnGroupMode = 'by_metric' | 'by_month';

interface ComputedMonthlyRow {
  month: string; // YYYY-MM
  labelShort: string; // e.g., Mar-26
  labelFull: string; // e.g., Maret 2026
  revenueOperating: number; // ctipe 11
  otherIncome: number; // ctipe 14
  totalPendapatan: number; // ctipe 11 + 14
  cogs: number; // ctipe 12
  opex: number; // ctipe 13
  otherExpense: number; // ctipe 15
  totalBiaya: number; // ctipe 12 + 13 + 15
  netProfitBeforeTax: number; // totalPendapatan - totalBiaya === profitBeforeTax
  erpTaxNetExpense: number; // oci (ctipe 16) - incomeTax (ctipe 17)
  taxAmount: number;
  taxPctDisplay: number;
  netProfitAfterTax: number;
  netProfitMarginPct: number;
  isOtherInferred: boolean;
}

const MONTH_SHORT_ID = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];

const MONTH_FULL_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

// Curated accessible multi-month palette anchored in Hijau Tosca
const MONTH_SERIES_PALETTE = [
  '#0D7678', // Hijau Tosca Utama
  '#2563EB', // Biru Korporat
  '#10B981', // Zamrud
  '#D97706', // Amber
  '#0891B2', // Cyan Dalam
  '#6366F1', // Indigo
  '#059669', // Hijau Daun
  '#E11D48', // Merah Mawar
  '#0284C7', // Biru Langit
  '#7C3AED', // Violet
  '#EA580C', // Oranye Hangat
  '#475569', // Slate
];

function getLastDayOfMonth(year: number, monthIndex1to12: number): string {
  const d = new Date(year, monthIndex1to12, 0);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatMonthShort(ym: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!match) return ym;
  const yy = match[1].slice(-2);
  const mIdx = Number(match[2]) - 1;
  return `${MONTH_SHORT_ID[mIdx] || match[2]}-${yy}`;
}

function formatMonthFull(ym: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!match) return ym;
  const mIdx = Number(match[2]) - 1;
  return `${MONTH_FULL_ID[mIdx] || match[2]} ${match[1]}`;
}

function formatIdr(value: number): string {
  const rounded = Math.round(value);
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(rounded);
}

function formatNumberPlain(value: number): string {
  return new Intl.NumberFormat('id-ID', {
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

function formatCompactIdr(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000_000_000) {
    return `${sign}${(abs / 1_000_000_000_000).toFixed(1).replace(/\.0$/, '')} T`;
  }
  if (abs >= 1_000_000_000) {
    return `${sign}${(abs / 1_000_000_000).toFixed(1).replace(/\.0$/, '')} M`;
  }
  if (abs >= 1_000_000) {
    return `${sign}${(abs / 1_000_000).toFixed(1).replace(/\.0$/, '')} Jt`;
  }
  if (abs >= 1_000) {
    return `${sign}${(abs / 1_000).toFixed(0)} Rb`;
  }
  return `${sign}${Math.round(abs)}`;
}

function formatPct(value: number): string {
  if (!Number.isFinite(value)) return '0,00%';
  return `${value.toFixed(2).replace('.', ',')}%`;
}

function computeNiceScale(minVal: number, maxVal: number, tickCount = 5): {
  min: number;
  max: number;
  ticks: number[];
} {
  const safeMin = Math.min(0, minVal);
  const safeMax = Math.max(0, maxVal);
  const span = safeMax - safeMin;
  if (span <= 0) {
    return { min: 0, max: 100, ticks: [0, 25, 50, 75, 100] };
  }
  const rawStep = span / Math.max(1, tickCount - 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  let niceFactor = 1;
  if (normalized <= 1) niceFactor = 1;
  else if (normalized <= 2) niceFactor = 2;
  else if (normalized <= 2.5) niceFactor = 2.5;
  else if (normalized <= 5) niceFactor = 5;
  else niceFactor = 10;

  const step = niceFactor * magnitude;
  const niceMin = Math.floor(safeMin / step) * step;
  const niceMax = Math.ceil(safeMax / step) * step;

  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + step * 0.001; v += step) {
    ticks.push(Number(v.toFixed(6)));
  }
  return { min: niceMin, max: niceMax, ticks };
}

function escapeCsvCell(value: string | number): string {
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export const BiFinanceProfitKpi: React.FC<BiFinanceProfitKpiProps> = ({
  mode,
  idToken,
  onDownloadBridge,
}) => {
  const { t, locale } = useI18n();
  const now = useMemo(() => new Date(), []);
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // Default year = 2026 (or current year if >= 2026), default months = Jan..currentMonth (or Mar..currentMonth)
  const [selectedYear, setSelectedYear] = useState<number>(Math.max(2026, currentYear));
  const [startMonth, setStartMonth] = useState<number>(1);
  const [endMonth, setEndMonth] = useState<number>(Math.max(currentMonth, 4));

  // Net Profit chart grouping (default matches user Excel: Pendapatan / Biaya / Net Profit grouped by months)
  const [columnGroupMode, setColumnGroupMode] = useState<ColumnGroupMode>('by_metric');
  const [showCoaBreakdown, setShowCoaBreakdown] = useState<boolean>(false);

  // Net Profit Margin tax basis (default: actual ERP journal, with 1-click toggle to estimated rate e.g. 25% / 22%)
  const [taxBasis, setTaxBasis] = useState<TaxBasisMode>('erp_actual');
  const [estimatedTaxRate, setEstimatedTaxRate] = useState<number>(25);

  const [data, setData] = useState<ErpFinanceQueryResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Hover states for interactive tooltips
  const [hoveredColKey, setHoveredColKey] = useState<string | null>(null);
  const [hoveredMarginMonth, setHoveredMarginMonth] = useState<string | null>(null);

  const effectiveStartMonth = Math.min(startMonth, endMonth);
  const effectiveEndMonth = Math.max(startMonth, endMonth);

  const requestedDateFrom = `${selectedYear}-${String(effectiveStartMonth).padStart(2, '0')}-01`;
  const requestedDateTo = getLastDayOfMonth(selectedYear, effectiveEndMonth);

  const fetchFinanceData = useCallback(
    async (opts?: { refresh?: boolean }) => {
      if (opts?.refresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setErrorMsg(null);
      try {
        const token = await getFreshIdToken(idToken);
        const params = new URLSearchParams();
        params.set('dateFrom', requestedDateFrom);
        params.set('dateTo', requestedDateTo);
        if (opts?.refresh) params.set('refresh', '1');

        const result = await fetchApiJson<ErpFinanceQueryResult>(
          `/api/erp/finance?${params.toString()}`,
          {
            cache: 'no-store',
            headers: { Authorization: `Bearer ${token}` },
          },
          'Gagal memuat data laba rugi bulanan dari MyERP Plus.'
        );
        setData(result);
      } catch (err) {
        setErrorMsg(
          err instanceof Error
            ? err.message
            : 'Gagal memuat data keuangan dari database MyERP Plus.'
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [idToken, requestedDateFrom, requestedDateTo]
  );

  useEffect(() => {
    void fetchFinanceData();
  }, [fetchFinanceData]);

  // Available years derived from ERP coverage + current year
  const availableYears = useMemo(() => {
    const years = new Set<number>([currentYear, 2026]);
    const minStr = data?.coverage?.minDateActive || data?.coverage?.minDateAll;
    const maxStr = data?.coverage?.maxDateActive || data?.coverage?.maxDateAll;
    const minY = minStr ? Number(minStr.slice(0, 4)) : 2026;
    const maxY = maxStr ? Number(maxStr.slice(0, 4)) : currentYear;
    if (Number.isFinite(minY) && Number.isFinite(maxY) && minY >= 2020 && maxY <= 2035) {
      for (let y = minY; y <= maxY; y += 1) {
        years.add(y);
      }
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [currentYear, data]);

  // Transform monthlyPnl rows from MyERP Plus with exact accounting reconciliation
  const monthlyRows = useMemo<ComputedMonthlyRow[]>(() => {
    const rawRows: ErpFinanceMonthlyPnlRow[] = data?.monthlyPnl || [];
    const safeTaxRate = Number.isFinite(estimatedTaxRate)
      ? Math.max(0, Math.min(100, estimatedTaxRate))
      : 0;

    return rawRows
      .filter((row) => {
        const match = /^(\d{4})-(\d{2})$/.exec(row.month || '');
        if (!match) return false;
        const y = Number(match[1]);
        const m = Number(match[2]);
        return y === selectedYear && m >= effectiveStartMonth && m <= effectiveEndMonth;
      })
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((row) => {
        const revOp = Number(row.revenue || 0);
        const cg = Number(row.cogs || 0);
        const op = Number(row.opex || 0);
        const ebit = row.operatingProfit !== undefined ? Number(row.operatingProfit) : revOp - cg - op;
        const pbt =
          row.profitBeforeTax !== undefined ? Number(row.profitBeforeTax) : ebit;

        let oi = 0;
        let oe = 0;
        let isOtherInferred = false;
        if (row.otherIncome !== undefined && row.otherExpense !== undefined) {
          oi = Number(row.otherIncome || 0);
          oe = Number(row.otherExpense || 0);
        } else {
          const otherNet = pbt - ebit;
          if (Math.abs(otherNet) >= 0.5) {
            isOtherInferred = true;
            if (otherNet > 0) oi = otherNet;
            else oe = Math.abs(otherNet);
          }
        }

        const totalPendapatan = revOp + oi;
        const totalBiaya = cg + op + oe;
        // Mathematical identity: totalPendapatan - totalBiaya === profitBeforeTax
        const netProfitBeforeTax = totalPendapatan - totalBiaya;

        const mOci = Number(row.oci || 0);
        const mIncomeTax = Number(row.incomeTax || 0);
        // Net tax expense recorded in ERP (ctipe 16 minus ctipe 17)
        const erpTaxNetExpense = mOci - mIncomeTax;

        let taxAmount = 0;
        let taxPctDisplay = 0;
        let netProfitAfterTax = netProfitBeforeTax;

        if (taxBasis === 'erp_actual') {
          taxAmount = erpTaxNetExpense;
          netProfitAfterTax = netProfitBeforeTax - taxAmount;
          taxPctDisplay =
            netProfitBeforeTax > 0 ? (taxAmount / netProfitBeforeTax) * 100 : 0;
        } else {
          taxAmount = netProfitBeforeTax > 0 ? netProfitBeforeTax * (safeTaxRate / 100) : 0;
          netProfitAfterTax = netProfitBeforeTax - taxAmount;
          taxPctDisplay = netProfitBeforeTax > 0 ? safeTaxRate : 0;
        }

        const netProfitMarginPct =
          totalPendapatan > 0 ? (netProfitAfterTax / totalPendapatan) * 100 : 0;

        return {
          month: row.month,
          labelShort: formatMonthShort(row.month),
          labelFull: formatMonthFull(row.month),
          revenueOperating: revOp,
          otherIncome: oi,
          totalPendapatan,
          cogs: cg,
          opex: op,
          otherExpense: oe,
          totalBiaya,
          netProfitBeforeTax,
          erpTaxNetExpense,
          taxAmount,
          taxPctDisplay,
          netProfitAfterTax,
          netProfitMarginPct,
          isOtherInferred,
        };
      });
  }, [data, effectiveEndMonth, effectiveStartMonth, estimatedTaxRate, selectedYear, taxBasis]);

  const hasAnyActualErpTax = useMemo(
    () => monthlyRows.some((r) => Math.abs(r.erpTaxNetExpense) >= 1),
    [monthlyRows]
  );

  // Aggregate totals for summary strip and table footer
  const totals = useMemo(() => {
    const totalPendapatan = monthlyRows.reduce((s, r) => s + r.totalPendapatan, 0);
    const totalRevenueOperating = monthlyRows.reduce((s, r) => s + r.revenueOperating, 0);
    const totalOtherIncome = monthlyRows.reduce((s, r) => s + r.otherIncome, 0);
    const totalBiaya = monthlyRows.reduce((s, r) => s + r.totalBiaya, 0);
    const totalCogs = monthlyRows.reduce((s, r) => s + r.cogs, 0);
    const totalOpex = monthlyRows.reduce((s, r) => s + r.opex, 0);
    const totalOtherExpense = monthlyRows.reduce((s, r) => s + r.otherExpense, 0);
    const totalNetProfitBeforeTax = monthlyRows.reduce((s, r) => s + r.netProfitBeforeTax, 0);
    const totalTaxAmount = monthlyRows.reduce((s, r) => s + r.taxAmount, 0);
    const totalNetProfitAfterTax = monthlyRows.reduce((s, r) => s + r.netProfitAfterTax, 0);
    const avgMonthlyNetProfit =
      monthlyRows.length > 0 ? totalNetProfitBeforeTax / monthlyRows.length : 0;
    const weightedMarginPct =
      totalPendapatan > 0 ? (totalNetProfitAfterTax / totalPendapatan) * 100 : 0;
    const effectiveTaxPct =
      totalNetProfitBeforeTax > 0 ? (totalTaxAmount / totalNetProfitBeforeTax) * 100 : 0;

    return {
      totalPendapatan,
      totalRevenueOperating,
      totalOtherIncome,
      totalBiaya,
      totalCogs,
      totalOpex,
      totalOtherExpense,
      totalNetProfitBeforeTax,
      totalTaxAmount,
      totalNetProfitAfterTax,
      avgMonthlyNetProfit,
      weightedMarginPct,
      effectiveTaxPct,
    };
  }, [monthlyRows]);

  const cutoffWarning = useMemo(() => {
    const cutoff = data?.cutoffDate || '2026-03-01';
    return requestedDateFrom < cutoff ? cutoff : null;
  }, [data?.cutoffDate, requestedDateFrom]);

  // Quick month range presets
  const applyMonthPreset = (fromM: number, toM: number) => {
    setStartMonth(fromM);
    setEndMonth(toM);
  };

  const handleResetActivePeriod = () => {
    const activeStartYear = data?.coverage?.minDateActive
      ? Number(data.coverage.minDateActive.slice(0, 4))
      : Math.max(2026, currentYear);
    const activeStartMonth = data?.coverage?.minDateActive
      ? Number(data.coverage.minDateActive.slice(5, 7))
      : 3;
    const activeEndMonth = data?.coverage?.maxDateActive
      ? Number(data.coverage.maxDateActive.slice(5, 7))
      : Math.max(currentMonth, activeStartMonth);

    setSelectedYear(activeStartYear);
    setStartMonth(activeStartMonth);
    setEndMonth(Math.max(activeStartMonth, activeEndMonth));
  };

  // CSV Export
  const handleExportCsv = () => {
    if (monthlyRows.length === 0) return;

    const lines: string[] = [];
    if (mode === 'net_profit') {
      lines.push(
        [
          'Bulan',
          'Pendapatan Usaha (ctipe 11)',
          'Pendapatan Lain (ctipe 14)',
          'Total Pendapatan',
          'HPP/COGS (ctipe 12)',
          'Beban Operasional (ctipe 13)',
          'Beban Lain (ctipe 15)',
          'Total Biaya',
          'Net Profit',
        ]
          .map(escapeCsvCell)
          .join(',')
      );
      for (const r of monthlyRows) {
        lines.push(
          [
            r.labelShort,
            Math.round(r.revenueOperating),
            Math.round(r.otherIncome),
            Math.round(r.totalPendapatan),
            Math.round(r.cogs),
            Math.round(r.opex),
            Math.round(r.otherExpense),
            Math.round(r.totalBiaya),
            Math.round(r.netProfitBeforeTax),
          ]
            .map(escapeCsvCell)
            .join(',')
        );
      }
      lines.push(
        [
          'TOTAL',
          Math.round(totals.totalRevenueOperating),
          Math.round(totals.totalOtherIncome),
          Math.round(totals.totalPendapatan),
          Math.round(totals.totalCogs),
          Math.round(totals.totalOpex),
          Math.round(totals.totalOtherExpense),
          Math.round(totals.totalBiaya),
          Math.round(totals.totalNetProfitBeforeTax),
        ]
          .map(escapeCsvCell)
          .join(',')
      );
    } else {
      lines.push(
        [
          'Bulan',
          'Pendapatan',
          'Biaya',
          'L/R Sebelum Pajak',
          taxBasis === 'erp_actual' ? 'Pajak Aktual (%)' : `Pajak Estimasi (${estimatedTaxRate}%)`,
          'Nominal Pajak',
          'L/R Setelah Pajak',
          'Net Profit Margin (%)',
        ]
          .map(escapeCsvCell)
          .join(',')
      );
      for (const r of monthlyRows) {
        lines.push(
          [
            r.labelShort,
            Math.round(r.totalPendapatan),
            Math.round(r.totalBiaya),
            Math.round(r.netProfitBeforeTax),
            r.taxPctDisplay.toFixed(2),
            Math.round(r.taxAmount),
            Math.round(r.netProfitAfterTax),
            r.netProfitMarginPct.toFixed(2),
          ]
            .map(escapeCsvCell)
            .join(',')
        );
      }
      lines.push(
        [
          'TOTAL / RATA-RATA',
          Math.round(totals.totalPendapatan),
          Math.round(totals.totalBiaya),
          Math.round(totals.totalNetProfitBeforeTax),
          totals.effectiveTaxPct.toFixed(2),
          Math.round(totals.totalTaxAmount),
          Math.round(totals.totalNetProfitAfterTax),
          totals.weightedMarginPct.toFixed(2),
        ]
          .map(escapeCsvCell)
          .join(',')
      );
    }

    const blob = new Blob(['\uFEFF' + lines.join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `BI_${mode === 'net_profit' ? 'Net_Profit' : 'Net_Profit_Margin'}_${selectedYear}_${String(effectiveStartMonth).padStart(2, '0')}-${String(effectiveEndMonth).padStart(2, '0')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // --- SVG Chart Calculations for 1. Net Profit (Grouped Vertical Column Chart) ---
  const netProfitChartModel = useMemo(() => {
    const allValues: number[] = [];
    for (const r of monthlyRows) {
      allValues.push(r.totalPendapatan, r.totalBiaya, r.netProfitBeforeTax);
    }
    const minVal = allValues.length > 0 ? Math.min(0, ...allValues) : 0;
    const maxVal = allValues.length > 0 ? Math.max(0, ...allValues) : 100;
    const scale = computeNiceScale(minVal, maxVal, 5);
    return { scale };
  }, [monthlyRows]);

  // --- SVG Chart Calculations for 2. Net Profit Margin (Horizontal Bar Chart) ---
  // Ordered newest month at top (matching Excel reference: Mar-15, Feb-15, Jan-15)
  const marginRowsNewestTop = useMemo(
    () => [...monthlyRows].reverse(),
    [monthlyRows]
  );

  const marginChartModel = useMemo(() => {
    const vals = marginRowsNewestTop.map((r) => r.netProfitMarginPct);
    const minVal = vals.length > 0 ? Math.min(0, ...vals) : 0;
    const maxVal = vals.length > 0 ? Math.max(5, ...vals) : 25;
    const scale = computeNiceScale(minVal, maxVal, 6);
    return { scale };
  }, [marginRowsNewestTop]);

  const activeHoveredMarginRow = useMemo(
    () => marginRowsNewestTop.find((r) => r.month === hoveredMarginMonth) || null,
    [hoveredMarginMonth, marginRowsNewestTop]
  );

  const activeHoveredColInfo = useMemo(() => {
    if (!hoveredColKey) return null;
    for (const row of monthlyRows) {
      const checks = [
        {
          keys: [`pendapatan-${row.month}`, `${row.month}-pendapatan`],
          label: 'Pendapatan',
          value: row.totalPendapatan,
          subtitle: 'Pendapatan Usaha (11) + Pendapatan Lain (14)',
        },
        {
          keys: [`biaya-${row.month}`, `${row.month}-biaya`],
          label: 'Biaya',
          value: row.totalBiaya,
          subtitle: 'HPP/COGS (12) + Beban Ops (13) + Beban Lain (15)',
        },
        {
          keys: [`net_profit-${row.month}`, `${row.month}-net_profit`],
          label: 'Net Profit',
          value: row.netProfitBeforeTax,
          subtitle:
            row.totalPendapatan > 0
              ? `${formatPct((row.netProfitBeforeTax / row.totalPendapatan) * 100)} dari pendapatan`
              : 'Pendapatan − Biaya',
        },
      ];
      for (const item of checks) {
        if (item.keys.includes(hoveredColKey)) {
          return {
            title: `${item.label} · ${row.labelFull}`,
            subtitle: item.subtitle,
            value: item.value,
          };
        }
      }
    }
    return null;
  }, [hoveredColKey, monthlyRows]);

  return (
    <div className="space-y-5">
      {/* KPI Header + Filter Bar */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-3">
          <div className="space-y-1 min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
              <span>{t('bi.modules.accounting.name')}</span>
              <span aria-hidden="true">·</span>
              <span>{t('bi.categories.Profitabilitas')}</span>
              <span aria-hidden="true">·</span>
              <span>
                {mode === 'net_profit'
                  ? locale === 'ja'
                    ? '縦棒グラフ'
                    : locale === 'en'
                      ? 'Vertical Column Chart'
                      : 'Diagram Kolom Vertikal'
                  : locale === 'ja'
                    ? '横棒グラフ'
                    : locale === 'en'
                      ? 'Horizontal Bar Chart'
                      : 'Diagram Batang Horizontal'}
              </span>
            </div>
            <h3 className="font-display text-lg font-bold text-[var(--text)] leading-snug">
              {mode === 'net_profit' ? '01. Net Profit' : '02. Net Profit Margin'}
            </h3>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed max-w-3xl">
              {mode === 'net_profit'
                ? 'Perbandingan Pendapatan, Biaya, dan Net Profit (Laba/Rugi Sebelum Pajak) per bulan berdasarkan jurnal transaksi aktual.'
                : 'Persentase margin laba bersih setelah pajak terhadap total pendapatan per bulan untuk mengukur tingkat profitabilitas bersih perusahaan.'}
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

        {/* Period Filter Bar (Year + Month Range + Quick Presets) */}
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
                htmlFor={`bi-start-month-${mode}`}
                className="block text-[11px] font-medium text-[var(--text-muted)]"
              >
                {t('bi.fromMonth')}
              </label>
              <select
                id={`bi-start-month-${mode}`}
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
                htmlFor={`bi-end-month-${mode}`}
                className="block text-[11px] font-medium text-[var(--text-muted)]"
              >
                {t('bi.toMonth')}
              </label>
              <select
                id={`bi-end-month-${mode}`}
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

            {/* Quick Month Presets */}
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

            {/* Tax Basis Selector for Net Profit Margin */}
            {mode === 'net_profit_margin' && (
              <div className="space-y-1 ml-auto">
                <span className="block text-[11px] font-medium text-[var(--text-muted)]">
                  Basis Perhitungan Pajak
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
                    <button
                      type="button"
                      onClick={() => setTaxBasis('erp_actual')}
                      className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        taxBasis === 'erp_actual'
                          ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                          : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                      }`}
                    >
                      Jurnal ERP Aktual
                    </button>
                    <button
                      type="button"
                      onClick={() => setTaxBasis('estimated_rate')}
                      className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                        taxBasis === 'estimated_rate'
                          ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                          : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                      }`}
                    >
                      Tarif Estimasi (%)
                    </button>
                  </div>

                  {taxBasis === 'estimated_rate' && (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.5}
                        aria-label="Tarif pajak estimasi persen"
                        value={estimatedTaxRate}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setEstimatedTaxRate(Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0);
                        }}
                        className="w-16 px-2 py-1.5 text-xs font-mono tabular-nums text-right rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                      />
                      <span className="text-xs text-[var(--text-muted)]">%</span>
                      <button
                        type="button"
                        onClick={() => setEstimatedTaxRate(22)}
                        className={`px-2 py-1 text-[11px] font-mono rounded-md border transition-colors cursor-pointer ${
                          estimatedTaxRate === 22
                            ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10'
                            : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]'
                        }`}
                        title="Tarif PPh Badan umum Indonesia 22%"
                      >
                        22%
                      </button>
                      <button
                        type="button"
                        onClick={() => setEstimatedTaxRate(25)}
                        className={`px-2 py-1 text-[11px] font-mono rounded-md border transition-colors cursor-pointer ${
                          estimatedTaxRate === 25
                            ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10'
                            : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]'
                        }`}
                        title="Tarif sesuai contoh tabel referensi 25%"
                      >
                        25%
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Informational Notices (Cutoff / Tax Zero Reminder) */}
          {(cutoffWarning || (mode === 'net_profit_margin' && taxBasis === 'erp_actual' && !hasAnyActualErpTax && monthlyRows.length > 0)) && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-[var(--text-muted)] pt-2 border-t border-[var(--border)]/60">
              <div className="flex items-start gap-2">
                <Info className="w-3.5 h-3.5 text-[var(--accent)] shrink-0 mt-0.5" />
                <span className="leading-relaxed">
                  {cutoffWarning
                    ? `Periode jurnal aktif MyERP Plus dimulai sejak ${cutoffWarning} (menyesuaikan batas data bersih Laporan Keuangan ERP). `
                    : ''}
                  {mode === 'net_profit_margin' &&
                  taxBasis === 'erp_actual' &&
                  !hasAnyActualErpTax &&
                  monthlyRows.length > 0
                    ? 'Belum ada jurnal beban pajak penghasilan (COA tipe 16–17) yang diposting pada periode ini. Anda dapat beralih ke "Tarif Estimasi (%)" untuk simulasi tarif pajak (mis. 22% atau 25%).'
                    : ''}
                </span>
              </div>
              {mode === 'net_profit_margin' &&
                taxBasis === 'erp_actual' &&
                !hasAnyActualErpTax &&
                monthlyRows.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setTaxBasis('estimated_rate')}
                    className="text-xs font-semibold text-[var(--accent)] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Aktifkan Tarif Estimasi →
                  </button>
                )}
            </div>
          )}
        </div>
      </div>

      {/* Loading Skeleton State */}
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

      {/* Empty State (No posted journal transactions in selected Month & Year range) */}
      {!loading && !errorMsg && data && monthlyRows.length === 0 && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-10 text-center space-y-3">
          <h4 className="font-display text-base font-bold text-[var(--text)]">
            Tidak Ada Jurnal Laba Rugi pada Periode {MONTH_SHORT_ID[effectiveStartMonth - 1]}–
            {MONTH_SHORT_ID[effectiveEndMonth - 1]} {selectedYear}
          </h4>
          <p className="text-xs text-[var(--text-muted)] max-w-xl mx-auto leading-relaxed">
            Tidak ditemukan transaksi jurnal terposting (COA tipe 11–17) pada rentang bulan dan tahun yang dipilih.
            {data.coverage?.minDateActive && data.coverage?.maxDateActive
              ? ` Rentang data aktif ERP saat ini tercatat dari ${data.coverage.minDateActive} hingga ${data.coverage.maxDateActive}.`
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
        <div className={`space-y-5 transition-opacity duration-150 ${loading ? 'opacity-65' : 'opacity-100'}`}>
          {/* 4-Column Summary Strip (Single Elevation, Tabular Numerals) */}
          {mode === 'net_profit' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Total Pendapatan</span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate" title={formatIdr(totals.totalPendapatan)}>
                  {formatIdr(totals.totalPendapatan)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] tabular-nums block">
                  {monthlyRows.length} bulan terposting
                </span>
              </div>

              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Total Biaya</span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate" title={formatIdr(totals.totalBiaya)}>
                  {formatIdr(totals.totalBiaya)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] tabular-nums block">
                  HPP + Beban Operasional + Lainnya
                </span>
              </div>

              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Total Net Profit</span>
                <p
                  className={`font-mono text-lg font-bold tabular-nums truncate ${
                    totals.totalNetProfitBeforeTax >= 0
                      ? 'text-[var(--accent)]'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                  title={formatIdr(totals.totalNetProfitBeforeTax)}
                >
                  {formatIdr(totals.totalNetProfitBeforeTax)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] tabular-nums block">
                  {totals.totalNetProfitBeforeTax >= 0 ? 'Surplus (Laba)' : 'Defisit (Rugi)'} · Pendapatan − Biaya
                </span>
              </div>

              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Rata-rata Net Profit / Bulan</span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate" title={formatIdr(totals.avgMonthlyNetProfit)}>
                  {formatIdr(totals.avgMonthlyNetProfit)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] tabular-nums block">
                  Rasio Biaya: {totals.totalPendapatan > 0 ? formatPct((totals.totalBiaya / totals.totalPendapatan) * 100) : '0,00%'}
                </span>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Total Pendapatan</span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate" title={formatIdr(totals.totalPendapatan)}>
                  {formatIdr(totals.totalPendapatan)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] tabular-nums block">
                  Dasar pembagi Net Profit Margin
                </span>
              </div>

              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">L/R Sebelum Pajak</span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate" title={formatIdr(totals.totalNetProfitBeforeTax)}>
                  {formatIdr(totals.totalNetProfitBeforeTax)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] tabular-nums block">
                  Pajak: {formatIdr(totals.totalTaxAmount)} ({formatPct(totals.effectiveTaxPct)})
                </span>
              </div>

              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">L/R Setelah Pajak</span>
                <p
                  className={`font-mono text-lg font-bold tabular-nums truncate ${
                    totals.totalNetProfitAfterTax >= 0
                      ? 'text-[var(--text)]'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                  title={formatIdr(totals.totalNetProfitAfterTax)}
                >
                  {formatIdr(totals.totalNetProfitAfterTax)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] tabular-nums block">
                  {taxBasis === 'erp_actual'
                    ? 'Sesuai jurnal pajak aktual ERP'
                    : `Simulasi tarif pajak ${estimatedTaxRate}%`}
                </span>
              </div>

              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Net Profit Margin (Akumulasi)</span>
                <p
                  className={`font-mono text-xl font-bold tabular-nums ${
                    totals.weightedMarginPct >= 0
                      ? 'text-[var(--accent)]'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {formatPct(totals.weightedMarginPct)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] tabular-nums block">
                  (L/R Setelah Pajak ÷ Pendapatan) × 100%
                </span>
              </div>
            </div>
          )}

          {/* Primary Chart Section (6 selectable diagram shapes) */}
          {mode === 'net_profit' ? (
            <BiGroupedColumnChart
              title="Grafik Perbandingan Net Profit"
              subtitle={`Perbandingan Pendapatan, Biaya, dan Net Profit periode ${monthlyRows[0].labelShort} s.d. ${monthlyRows[monthlyRows.length - 1].labelShort}`}
              defaultChartType="column"
              months={monthlyRows.map((r) => ({
                key: r.month,
                label: r.labelShort,
                labelFull: r.labelFull,
              }))}
              metrics={[
                {
                  key: 'pendapatan',
                  label: 'Pendapatan',
                  color: '#0D7678',
                  valuesByMonth: Object.fromEntries(
                    monthlyRows.map((r) => [r.month, r.totalPendapatan])
                  ),
                },
                {
                  key: 'biaya',
                  label: 'Biaya',
                  color: '#D97706',
                  valuesByMonth: Object.fromEntries(
                    monthlyRows.map((r) => [r.month, r.totalBiaya])
                  ),
                },
                {
                  key: 'net_profit',
                  label: 'Net Profit',
                  color: '#10B981',
                  valuesByMonth: Object.fromEntries(
                    monthlyRows.map((r) => [r.month, r.netProfitBeforeTax])
                  ),
                },
              ]}
              formatAxisTick={formatCompactIdr}
              formatExactValue={formatIdr}
            />
          ) : (
            <BiHorizontalBarChart
              title="Net Profit Margin"
              subtitle={`Persentase L/R Setelah Pajak terhadap Pendapatan per bulan (${taxBasis === 'erp_actual' ? 'Basis Jurnal Pajak Aktual ERP' : `Basis Tarif Estimasi ${estimatedTaxRate}%`})`}
              legendLabel="Net Profit Margin (%)"
              defaultChartType="horizontal"
              data={monthlyRows.map((r) => ({
                key: r.month,
                label: r.labelShort,
                value: r.netProfitMarginPct,
                valueLabel: formatPct(r.netProfitMarginPct),
                hoverSummary: `Pendapatan: ${formatIdr(r.totalPendapatan)} · L/R Stlh Pajak: ${formatIdr(r.netProfitAfterTax)} · Margin: ${formatPct(r.netProfitMarginPct)}`,
              }))}
              formatAxisTick={(v) => `${v.toFixed(2)}%`}
            />
          )}

          {/* Monthly Data Table (Exact Columns from Reference + Audit Breakdown) */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="font-display text-sm font-bold text-[var(--text)]">
                  {mode === 'net_profit'
                    ? 'Tabel Data Net Profit Bulanan'
                    : 'Tabel Perhitungan Net Profit Margin Bulanan'}
                </h4>
                <p className="text-[11px] text-[var(--text-muted)]">
                  Sumber aktual: Buku Besar ERP (jurnal terposting, non-void)
                </p>
              </div>

              {mode === 'net_profit' && (
                <button
                  type="button"
                  onClick={() => setShowCoaBreakdown((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--accent)] transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  {showCoaBreakdown ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                  <span>{showCoaBreakdown ? 'Sembunyikan Rincian COA' : 'Lihat Rincian COA'}</span>
                </button>
              )}
            </div>

            <div className="overflow-x-auto">
              {mode === 'net_profit' ? (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                      <th className="text-left font-semibold px-4 py-2.5 whitespace-nowrap">
                        Bulan
                      </th>
                      {showCoaBreakdown && (
                        <>
                          <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">
                            Pend. Usaha (11)
                          </th>
                          <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">
                            Pend. Lain (14)
                          </th>
                        </>
                      )}
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">
                        Pendapatan
                      </th>
                      {showCoaBreakdown && (
                        <>
                          <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">
                            HPP / COGS (12)
                          </th>
                          <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">
                            Beban Ops (13)
                          </th>
                          <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">
                            Beban Lain (15)
                          </th>
                        </>
                      )}
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">
                        Biaya
                      </th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">
                        Net Profit
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)] font-mono tabular-nums">
                    {monthlyRows.map((row) => (
                      <tr
                        key={row.month}
                        className="hover:bg-[var(--bg)]/70 transition-colors"
                      >
                        <td className="px-4 py-2.5 font-sans font-medium text-[var(--text)] whitespace-nowrap">
                          {row.labelShort}{' '}
                          <span className="text-[11px] text-[var(--text-muted)] font-normal">
                            ({row.labelFull})
                          </span>
                        </td>
                        {showCoaBreakdown && (
                          <>
                            <td className="px-4 py-2.5 text-right text-[var(--text-muted)] whitespace-nowrap">
                              {formatNumberPlain(row.revenueOperating)}
                            </td>
                            <td className="px-4 py-2.5 text-right text-[var(--text-muted)] whitespace-nowrap">
                              {formatNumberPlain(row.otherIncome)}
                            </td>
                          </>
                        )}
                        <td className="px-4 py-2.5 text-right font-medium text-[var(--text)] whitespace-nowrap">
                          {formatNumberPlain(row.totalPendapatan)}
                        </td>
                        {showCoaBreakdown && (
                          <>
                            <td className="px-4 py-2.5 text-right text-[var(--text-muted)] whitespace-nowrap">
                              {formatNumberPlain(row.cogs)}
                            </td>
                            <td className="px-4 py-2.5 text-right text-[var(--text-muted)] whitespace-nowrap">
                              {formatNumberPlain(row.opex)}
                            </td>
                            <td className="px-4 py-2.5 text-right text-[var(--text-muted)] whitespace-nowrap">
                              {formatNumberPlain(row.otherExpense)}
                            </td>
                          </>
                        )}
                        <td className="px-4 py-2.5 text-right text-[var(--text)] whitespace-nowrap">
                          {formatNumberPlain(row.totalBiaya)}
                        </td>
                        <td
                          className={`px-4 py-2.5 text-right font-semibold whitespace-nowrap ${
                            row.netProfitBeforeTax >= 0
                              ? 'text-[var(--accent)]'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {formatNumberPlain(row.netProfitBeforeTax)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[var(--bg)] border-t border-[var(--border)] font-mono tabular-nums font-bold">
                      <td className="px-4 py-3 font-sans text-[var(--text)]">Total Periode</td>
                      {showCoaBreakdown && (
                        <>
                          <td className="px-4 py-3 text-right text-[var(--text-muted)] whitespace-nowrap">
                            {formatNumberPlain(totals.totalRevenueOperating)}
                          </td>
                          <td className="px-4 py-3 text-right text-[var(--text-muted)] whitespace-nowrap">
                            {formatNumberPlain(totals.totalOtherIncome)}
                          </td>
                        </>
                      )}
                      <td className="px-4 py-3 text-right text-[var(--text)] whitespace-nowrap">
                        {formatNumberPlain(totals.totalPendapatan)}
                      </td>
                      {showCoaBreakdown && (
                        <>
                          <td className="px-4 py-3 text-right text-[var(--text-muted)] whitespace-nowrap">
                            {formatNumberPlain(totals.totalCogs)}
                          </td>
                          <td className="px-4 py-3 text-right text-[var(--text-muted)] whitespace-nowrap">
                            {formatNumberPlain(totals.totalOpex)}
                          </td>
                          <td className="px-4 py-3 text-right text-[var(--text-muted)] whitespace-nowrap">
                            {formatNumberPlain(totals.totalOtherExpense)}
                          </td>
                        </>
                      )}
                      <td className="px-4 py-3 text-right text-[var(--text)] whitespace-nowrap">
                        {formatNumberPlain(totals.totalBiaya)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right whitespace-nowrap ${
                          totals.totalNetProfitBeforeTax >= 0
                            ? 'text-[var(--accent)]'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {formatNumberPlain(totals.totalNetProfitBeforeTax)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              ) : (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                      <th className="text-left font-semibold px-4 py-2.5 whitespace-nowrap">
                        Bulan
                      </th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">
                        Pendapatan
                      </th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">
                        Biaya
                      </th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">
                        L/R Sebelum Pajak
                      </th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">
                        {taxBasis === 'erp_actual' ? 'Pajak (ERP %)' : `Pajak (${estimatedTaxRate}%)`}
                      </th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">
                        L/R Setelah Pajak
                      </th>
                      <th className="text-right font-semibold px-4 py-2.5 whitespace-nowrap">
                        Net Profit Margin
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)] font-mono tabular-nums">
                    {monthlyRows.map((row) => (
                      <tr
                        key={row.month}
                        className="hover:bg-[var(--bg)]/70 transition-colors"
                      >
                        <td className="px-4 py-2.5 font-sans font-medium text-[var(--text)] whitespace-nowrap">
                          {row.labelShort}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--text)] whitespace-nowrap">
                          {formatNumberPlain(row.totalPendapatan)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--text)] whitespace-nowrap">
                          {formatNumberPlain(row.totalBiaya)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--text)] whitespace-nowrap">
                          {formatNumberPlain(row.netProfitBeforeTax)}
                        </td>
                        <td
                          className="px-4 py-2.5 text-right text-[var(--text-muted)] whitespace-nowrap"
                          title={`Nominal pajak: ${formatIdr(row.taxAmount)}`}
                        >
                          {formatPct(row.taxPctDisplay)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium text-[var(--text)] whitespace-nowrap">
                          {formatNumberPlain(row.netProfitAfterTax)}
                        </td>
                        <td
                          className={`px-4 py-2.5 text-right font-semibold whitespace-nowrap ${
                            row.netProfitMarginPct >= 0
                              ? 'text-[var(--accent)]'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {formatPct(row.netProfitMarginPct)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-[var(--bg)] border-t border-[var(--border)] font-mono tabular-nums font-bold">
                      <td className="px-4 py-3 font-sans text-[var(--text)]">
                        Total / Rata-rata
                      </td>
                      <td className="px-4 py-3 text-right text-[var(--text)] whitespace-nowrap">
                        {formatNumberPlain(totals.totalPendapatan)}
                      </td>
                      <td className="px-4 py-3 text-right text-[var(--text)] whitespace-nowrap">
                        {formatNumberPlain(totals.totalBiaya)}
                      </td>
                      <td className="px-4 py-3 text-right text-[var(--text)] whitespace-nowrap">
                        {formatNumberPlain(totals.totalNetProfitBeforeTax)}
                      </td>
                      <td className="px-4 py-3 text-right text-[var(--text-muted)] whitespace-nowrap">
                        {formatPct(totals.effectiveTaxPct)}
                      </td>
                      <td className="px-4 py-3 text-right text-[var(--text)] whitespace-nowrap">
                        {formatNumberPlain(totals.totalNetProfitAfterTax)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right whitespace-nowrap ${
                          totals.weightedMarginPct >= 0
                            ? 'text-[var(--accent)]'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {formatPct(totals.weightedMarginPct)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>

            {/* Formula & Accounting Basis Footnote */}
            <div className="px-5 py-3 border-t border-[var(--border)] bg-[var(--bg)]/50 text-[11px] text-[var(--text-muted)] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span>
                {mode === 'net_profit'
                  ? 'Rumus: Pendapatan (COA tipe 11 + 14) − Biaya (COA tipe 12 HPP + 13 Beban Ops + 15 Beban Lain) = Net Profit (L/R Sebelum Pajak).'
                  : 'Rumus: L/R Setelah Pajak = L/R Sebelum Pajak − Pajak · Net Profit Margin = (L/R Setelah Pajak ÷ Pendapatan) × 100%.'}
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
