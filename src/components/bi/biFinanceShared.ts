import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchApiJson } from '../../lib/apiClient';
import { getFreshIdToken } from '../../lib/firebase';
import type {
  ErpFinanceMonthlyBsRow,
  ErpFinanceMonthlyPnlRow,
  ErpFinancePnlAccountRow,
  ErpFinanceQueryResult,
} from '../ErpFinancePanel';

export const MONTH_SHORT_ID = [
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

export const MONTH_FULL_ID = [
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
export const MONTH_SERIES_PALETTE = [
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

export function getLastDayOfMonth(year: number, monthIndex1to12: number): string {
  const d = new Date(year, monthIndex1to12, 0);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function getDaysInMonth(ym: string): number {
  const match = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!match) return 30;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return new Date(year, month, 0).getDate();
}

export function formatMonthShort(ym: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!match) return ym;
  const yy = match[1].slice(-2);
  const mIdx = Number(match[2]) - 1;
  return `${MONTH_SHORT_ID[mIdx] || match[2]}-${yy}`;
}

export function formatMonthFull(ym: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!match) return ym;
  const mIdx = Number(match[2]) - 1;
  return `${MONTH_FULL_ID[mIdx] || match[2]} ${match[1]}`;
}

export function formatIdr(value: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

export function formatNumberPlain(value: number): string {
  return new Intl.NumberFormat('id-ID', {
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

export function formatDecimal(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return (0).toFixed(digits).replace('.', ',');
  return value.toFixed(digits).replace('.', ',');
}

export function formatCompactIdr(value: number): string {
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

export function formatPct(value: number, showPlus = false): string {
  if (!Number.isFinite(value)) return '0,00%';
  const prefix = showPlus && value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(2).replace('.', ',')}%`;
}

export function computeNiceScale(
  minVal: number,
  maxVal: number,
  tickCount = 5
): { min: number; max: number; ticks: number[] } {
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

export function escapeCsvCell(value: string | number): string {
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function downloadCsvFile(filename: string, rows: Array<Array<string | number>>): void {
  const csv = '\uFEFF' + rows.map((r) => r.map(escapeCsvCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export type ItdaCategory = 'interest' | 'depreciation_amortization' | 'tax';

export interface DetectedItdaAccount {
  accountNo: string;
  accountName: string;
  ctipe: number;
  category: ItdaCategory;
  amount: number;
}

export function classifyItdaAccount(acc: ErpFinancePnlAccountRow): ItdaCategory | null {
  if (![12, 13, 15].includes(acc.ctipe)) return null;
  if (acc.hasAnomaly) return null;
  const lower = (acc.accountName || '').toLowerCase();
  if (lower.includes('bunga') || lower.includes('interest')) {
    return 'interest';
  }
  if (
    lower.includes('penyusut') ||
    lower.includes('depresiasi') ||
    lower.includes('depreciation') ||
    lower.includes('amortis') ||
    lower.includes('amortiz')
  ) {
    return 'depreciation_amortization';
  }
  if (
    lower.includes('pajak penghasilan') ||
    lower.includes('pph badan') ||
    lower.includes('income tax')
  ) {
    return 'tax';
  }
  return null;
}

export function extractDetectedItdaAccounts(
  pnlAccounts: ErpFinancePnlAccountRow[]
): DetectedItdaAccount[] {
  const results: DetectedItdaAccount[] = [];
  for (const acc of pnlAccounts) {
    const cat = classifyItdaAccount(acc);
    if (!cat) continue;
    const netDebit = Number(acc.debit || 0) - Number(acc.credit || 0);
    if (Math.abs(netDebit) < 0.5) continue;
    results.push({
      accountNo: acc.accountNo,
      accountName: acc.accountName,
      ctipe: acc.ctipe,
      category: cat,
      amount: netDebit,
    });
  }
  return results.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

export interface NormalizedMonthlyFinanceRow {
  month: string;
  daysInMonth: number;
  labelShort: string;
  labelFull: string;
  revenueOperating: number; // ctipe 11
  otherIncome: number; // ctipe 14
  totalPendapatan: number; // ctipe 11 + 14
  cogsMaterial: number;
  cogsLabour: number;
  cogsOther: number;
  cogs: number; // ctipe 12
  grossProfit: number; // ctipe 11 - 12
  grossMarginPct: number;
  opex: number; // ctipe 13
  otherExpense: number; // ctipe 15
  operatingExpenseTotal: number; // ctipe 12 + 13
  totalBiaya: number; // ctipe 12 + 13 + 15
  operatingProfitEbit: number; // ctipe 11 - 12 - 13
  operatingMarginEbitPct: number;
  profitBeforeTax: number; // totalPendapatan - totalBiaya
  operatingMarginPbtPct: number;
  interestExpense: number;
  depreciationAmortization: number;
  taxExpenseInOpex: number;
  hasMonthlyItdaFields: boolean;
  itdaTotal: number;
  biayaMinusItda: number;
  ebitda: number;
  ebitdaMarginPct: number;
  oci: number;
  incomeTax: number;
  erpTaxNetExpense: number;
  netIncome: number;
  // Monthly Balance Sheet opening & closing balances (from m2_transaction_journal + m1_coa ctipe 0..10)
  hasBsData: boolean;
  arStart: number;
  arEnd: number;
  inventoryStart: number;
  inventoryEnd: number;
  apStart: number;
  apEnd: number;
  currentAssetsStart: number;
  currentAssetsEnd: number;
  fixedAssetsStart: number;
  fixedAssetsEnd: number;
  accumDepStart: number;
  accumDepEnd: number;
  totalAssetsStart: number;
  totalAssetsEnd: number;
  currentLiabilitiesStart: number;
  currentLiabilitiesEnd: number;
  longTermLiabilitiesStart: number;
  longTermLiabilitiesEnd: number;
  totalLiabilitiesStart: number;
  totalLiabilitiesEnd: number;
  equityStart: number;
  equityEnd: number;
  capitalEmployedStart: number;
  capitalEmployedEnd: number;
  // Cumulative net income up to end of this month (for optional Equity + Laba Berjalan mode)
  cumulativeNetIncome: number;
}

export function normalizeMonthlyFinanceRows(
  rawRows: ErpFinanceMonthlyPnlRow[],
  selectedYear: number,
  startMonth: number,
  endMonth: number,
  rawBsRows?: ErpFinanceMonthlyBsRow[]
): NormalizedMonthlyFinanceRow[] {
  const fromM = Math.min(startMonth, endMonth);
  const toM = Math.max(startMonth, endMonth);

  const bsMap = new Map<string, ErpFinanceMonthlyBsRow>();
  if (rawBsRows) {
    for (const b of rawBsRows) {
      if (b.month) bsMap.set(b.month, b);
    }
  }

  let runningNetIncome = 0;

  return rawRows
    .filter((row) => {
      const match = /^(\d{4})-(\d{2})$/.exec(row.month || '');
      if (!match) return false;
      const y = Number(match[1]);
      const m = Number(match[2]);
      return y === selectedYear && m >= fromM && m <= toM;
    })
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((row) => {
      const revOp = Number(row.revenue || 0);
      const cg = Number(row.cogs || 0);
      const cgMat = Number(row.cogsMaterial || 0);
      const cgLab = Number(row.cogsLabour || 0);
      const cgOth = Number(row.cogsOther || 0);
      const op = Number(row.opex || 0);
      const gp = revOp - cg;
      const ebit = row.operatingProfit !== undefined ? Number(row.operatingProfit) : gp - op;
      const pbt = row.profitBeforeTax !== undefined ? Number(row.profitBeforeTax) : ebit;

      let oi = 0;
      let oe = 0;
      if (row.otherIncome !== undefined && row.otherExpense !== undefined) {
        oi = Number(row.otherIncome || 0);
        oe = Number(row.otherExpense || 0);
      } else {
        const otherNet = pbt - ebit;
        if (Math.abs(otherNet) >= 0.5) {
          if (otherNet > 0) oi = otherNet;
          else oe = Math.abs(otherNet);
        }
      }

      const totalPendapatan = revOp + oi;
      const operatingExpenseTotal = cg + op;
      const totalBiaya = cg + op + oe;
      const reconciledPbt = totalPendapatan - totalBiaya;

      const hasMonthlyItdaFields =
        row.interestExpense !== undefined ||
        row.depreciationAmortization !== undefined ||
        row.taxExpenseInOpex !== undefined;

      const interestExpense = Number(row.interestExpense || 0);
      const depreciationAmortization = Number(row.depreciationAmortization || 0);
      const taxExpenseInOpex = Number(row.taxExpenseInOpex || 0);
      const itdaTotal = interestExpense + depreciationAmortization + taxExpenseInOpex;
      const biayaMinusItda = totalBiaya - itdaTotal;
      const ebitda = totalPendapatan - biayaMinusItda;

      const oci = Number(row.oci || 0);
      const incomeTax = Number(row.incomeTax || 0);
      const erpTaxNetExpense = oci - incomeTax;
      const netIncome = reconciledPbt - erpTaxNetExpense;
      runningNetIncome += netIncome;

      const bs = bsMap.get(row.month);

      return {
        month: row.month,
        daysInMonth: getDaysInMonth(row.month),
        labelShort: formatMonthShort(row.month),
        labelFull: formatMonthFull(row.month),
        revenueOperating: revOp,
        otherIncome: oi,
        totalPendapatan,
        cogsMaterial: cgMat,
        cogsLabour: cgLab,
        cogsOther: cgOth,
        cogs: cg,
        grossProfit: gp,
        grossMarginPct: revOp > 0 ? (gp / revOp) * 100 : 0,
        opex: op,
        otherExpense: oe,
        operatingExpenseTotal,
        totalBiaya,
        operatingProfitEbit: ebit,
        operatingMarginEbitPct: revOp > 0 ? (ebit / revOp) * 100 : 0,
        profitBeforeTax: reconciledPbt,
        operatingMarginPbtPct: totalPendapatan > 0 ? (reconciledPbt / totalPendapatan) * 100 : 0,
        interestExpense,
        depreciationAmortization,
        taxExpenseInOpex,
        hasMonthlyItdaFields,
        itdaTotal,
        biayaMinusItda,
        ebitda,
        ebitdaMarginPct: totalPendapatan > 0 ? (ebitda / totalPendapatan) * 100 : 0,
        oci,
        incomeTax,
        erpTaxNetExpense,
        netIncome,
        hasBsData: Boolean(bs),
        arStart: Number(bs?.arStart || 0),
        arEnd: Number(bs?.arEnd || 0),
        inventoryStart: Number(bs?.inventoryStart || 0),
        inventoryEnd: Number(bs?.inventoryEnd || 0),
        apStart: Number(bs?.apStart || 0),
        apEnd: Number(bs?.apEnd || 0),
        currentAssetsStart: Number(bs?.currentAssetsStart || 0),
        currentAssetsEnd: Number(bs?.currentAssetsEnd || 0),
        fixedAssetsStart: Number(bs?.fixedAssetsStart || 0),
        fixedAssetsEnd: Number(bs?.fixedAssetsEnd || 0),
        accumDepStart: Number(bs?.accumDepStart || 0),
        accumDepEnd: Number(bs?.accumDepEnd || 0),
        totalAssetsStart: Number(bs?.totalAssetsStart || 0),
        totalAssetsEnd: Number(bs?.totalAssetsEnd || 0),
        currentLiabilitiesStart: Number(bs?.currentLiabilitiesStart || 0),
        currentLiabilitiesEnd: Number(bs?.currentLiabilitiesEnd || 0),
        longTermLiabilitiesStart: Number(bs?.longTermLiabilitiesStart || 0),
        longTermLiabilitiesEnd: Number(bs?.longTermLiabilitiesEnd || 0),
        totalLiabilitiesStart: Number(bs?.totalLiabilitiesStart || 0),
        totalLiabilitiesEnd: Number(bs?.totalLiabilitiesEnd || 0),
        equityStart: Number(bs?.equityStart || 0),
        equityEnd: Number(bs?.equityEnd || 0),
        capitalEmployedStart: Number(bs?.capitalEmployedStart || 0),
        capitalEmployedEnd: Number(bs?.capitalEmployedEnd || 0),
        cumulativeNetIncome: runningNetIncome,
      };
    });
}

export function useBiFinancePeriodData(idToken: string) {
  const now = useMemo(() => new Date(), []);
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const [selectedYear, setSelectedYear] = useState<number>(Math.max(2026, currentYear));
  const [startMonth, setStartMonth] = useState<number>(1);
  const [endMonth, setEndMonth] = useState<number>(Math.max(currentMonth, 4));

  const [data, setData] = useState<ErpFinanceQueryResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
          'Gagal memuat data keuangan bulanan dari MyERP Plus.'
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

  const monthlyRows = useMemo(
    () =>
      normalizeMonthlyFinanceRows(
        data?.monthlyPnl || [],
        selectedYear,
        effectiveStartMonth,
        effectiveEndMonth,
        data?.monthlyBalanceSheet
      ),
    [
      data?.monthlyBalanceSheet,
      data?.monthlyPnl,
      effectiveEndMonth,
      effectiveStartMonth,
      selectedYear,
    ]
  );

  const hasMonthlyBalanceSheet = useMemo(
    () => Array.isArray(data?.monthlyBalanceSheet) && data.monthlyBalanceSheet.length > 0,
    [data?.monthlyBalanceSheet]
  );

  const cutoffWarning = useMemo(() => {
    const cutoff = data?.cutoffDate || '2026-03-01';
    return requestedDateFrom < cutoff ? cutoff : null;
  }, [data?.cutoffDate, requestedDateFrom]);

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

  return {
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
    hasMonthlyBalanceSheet,
    loading,
    refreshing,
    errorMsg,
    cutoffWarning,
    fetchFinanceData,
    handleResetActivePeriod,
  };
}
