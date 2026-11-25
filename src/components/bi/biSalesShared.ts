import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchApiJson } from '../../lib/apiClient';
import { getFreshIdToken } from '../../lib/firebase';
import {
  escapeCsvCell,
  getLastDayOfMonth,
} from './biFinanceShared';

export {
  MONTH_FULL_ID,
  MONTH_SERIES_PALETTE,
  MONTH_SHORT_ID,
  computeNiceScale,
  escapeCsvCell,
  formatCompactIdr,
  formatDecimal,
  formatIdr,
  formatMonthFull,
  formatMonthShort,
  formatNumberPlain,
  formatPct,
  getLastDayOfMonth,
} from './biFinanceShared';

export interface ErpSalesBiMonthlyRow {
  month: string;
  activeCustomersSi: number;
  prevActiveCustomersSi: number;
  activeCustomersSo: number;
  prevActiveCustomersSo: number;
  churnedCustomersSi: number;
  rollingBaseCustomersSi: number;
  churnedRollingCustomersSi: number;
  soCount: number;
  prevSoCount: number;
  soItemQty: number;
  realizedItemQty: number;
  soTotalValue: number;
  realizedTotalValue: number;
  soCompleteCount: number;
  soCompleteOrCloseCount: number;
  soCompleteValue: number;
  soCompleteOrCloseValue: number;
  cpiPrevBasketPrice: number;
  cpiCurrBasketPrice: number;
  cpiPct: number;
  cpiItemCount: number;
  ivTotalCount: number;
  ivOnTimeCount: number;
  ivLinkedCount: number;
  ivLinkedOnTimeCount: number;
  doTotalCount: number;
  doOnTimeCount: number;
  doLinkedCount: number;
  doLinkedOnTimeCount: number;
  returnDocCount: number;
  returnItemQty: number;
  soldItemQty: number;
  returnValue: number;
  soldValue: number;
  deliveredItemQty: number;
  mismatchFromReturnQty: number;
  mismatchFromVarianceQty: number;
}

export interface ErpSalesBiCustomerProfitRow {
  customerId: number;
  customerCode: string;
  customerName: string;
  invoiceCount: number;
  salesAmount: number;
  cogsAmount: number;
  profitAmount: number;
  marginPct: number;
}

export interface ErpSalesBiCpiDetailItem {
  itemId: number;
  itemCode: string;
  itemName: string;
  prevPrice: number;
  currPrice: number;
  varianceRp: number;
  variancePct: number;
}

export interface ErpSalesBiReturnDetailItem {
  itemId: number;
  itemCode: string;
  itemName: string;
  returnQty: number;
  soldQty: number;
  returnPct: number;
}

export interface ErpSalesBiMismatchDetailItem {
  itemId: number;
  itemCode: string;
  itemName: string;
  mismatchReturnQty: number;
  mismatchVarianceQty: number;
  deliveredQty: number;
  mismatchReturnPct: number;
  mismatchVariancePct: number;
}

export interface ErpSalesBiDeliveryLeadTimeRow {
  itemId: number;
  itemCode: string;
  itemName: string;
  buckets: number[];
  totalDeliveries: number;
  avgLeadDays: number;
}

export interface ErpSalesBiQueryResult {
  cutoffDate: string;
  period: { dateFrom: string; dateTo: string };
  coverage: {
    minDateAll: string;
    maxDateAll: string;
    minDateActive: string;
    maxDateActive: string;
  };
  diagnostics: {
    hppSource: 'm5_si_detail' | 'm2_transaction_journal' | 'm1_item' | 'unavailable';
    realizationSource: 'm5_do_detail' | 'm5_si_detail' | 'm5_so_detail' | 'm5_so_status';
    dotSource: 'so_sotglkirim' | 'so_sotgl' | 'do_vs_si';
    hasMasterCustomerStatus: boolean;
    masterActiveCustomers: number;
    masterInactiveCustomers: number;
    tablesDetected: string[];
  };
  monthly: ErpSalesBiMonthlyRow[];
  customerProfitability: ErpSalesBiCustomerProfitRow[];
  cpiDetailsByMonth: Record<string, ErpSalesBiCpiDetailItem[]>;
  returnDetailsByMonth: Record<string, ErpSalesBiReturnDetailItem[]>;
  mismatchDetailsByMonth: Record<string, ErpSalesBiMismatchDetailItem[]>;
  deliveryLeadTime: ErpSalesBiDeliveryLeadTimeRow[];
  fetchedAt: string;
}

export function downloadCsvFile(
  filename: string,
  headers: string[],
  rows: (string | number)[][]
): void {
  const csv = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((r) => r.map(escapeCsvCell).join(',')),
  ].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function useBiSalesPeriodData(idToken: string | null) {
  const now = new Date();
  const currentYear = Math.max(2026, now.getFullYear());

  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [startMonth, setStartMonth] = useState<number>(1);
  const [endMonth, setEndMonth] = useState<number>(12);

  const [data, setData] = useState<ErpSalesBiQueryResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const effectiveStart = Math.min(startMonth, endMonth);
  const effectiveEnd = Math.max(startMonth, endMonth);

  const dateFrom = `${selectedYear}-${String(effectiveStart).padStart(2, '0')}-01`;
  const dateTo = getLastDayOfMonth(selectedYear, effectiveEnd);

  const fetchSalesBiData = useCallback(
    async (opts?: { refresh?: boolean }) => {
      if (opts?.refresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setErrorMsg(null);
      try {
        const token = (await getFreshIdToken()) || idToken;
        if (!token) {
          throw new Error('Sesi autentikasi tidak tersedia. Silakan masuk ulang.');
        }
        const qs = new URLSearchParams();
        qs.set('dateFrom', dateFrom);
        qs.set('dateTo', dateTo);
        if (opts?.refresh) qs.set('refresh', '1');

        const res = await fetchApiJson<ErpSalesBiQueryResult>(
          `/api/erp/sales-bi?${qs.toString()}`,
          {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        setData(res);
      } catch (err) {
        setErrorMsg(
          err instanceof Error
            ? err.message
            : 'Gagal memuat data Business Intelligence Sales dari MyERP Plus.'
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [dateFrom, dateTo, idToken]
  );

  useEffect(() => {
    void fetchSalesBiData();
  }, [fetchSalesBiData]);

  const availableYears = useMemo(() => {
    const years = new Set<number>([currentYear, selectedYear]);
    const minActive = data?.coverage?.minDateActive;
    const maxActive = data?.coverage?.maxDateActive;
    const minY = minActive ? Number(minActive.slice(0, 4)) : 2026;
    const maxY = maxActive ? Number(maxActive.slice(0, 4)) : currentYear;
    if (Number.isFinite(minY) && Number.isFinite(maxY)) {
      for (let y = Math.max(2020, minY); y <= Math.max(currentYear, maxY); y++) {
        years.add(y);
      }
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [currentYear, data?.coverage?.maxDateActive, data?.coverage?.minDateActive, selectedYear]);

  const cutoffWarning = useMemo(() => {
    const cutoff = data?.cutoffDate || '2026-03-01';
    if (dateFrom < cutoff && dateTo >= cutoff) {
      return cutoff;
    }
    return null;
  }, [data?.cutoffDate, dateFrom, dateTo]);

  const handleResetActivePeriod = useCallback(() => {
    const maxActive = data?.coverage?.maxDateActive;
    const targetYear = maxActive ? Number(maxActive.slice(0, 4)) : currentYear;
    setSelectedYear(Number.isFinite(targetYear) ? targetYear : currentYear);
    setStartMonth(1);
    setEndMonth(12);
  }, [currentYear, data?.coverage?.maxDateActive]);

  const monthlyRows = useMemo(() => {
    if (!data?.monthly) return [];
    const fromYm = dateFrom.slice(0, 7);
    const toYm = dateTo.slice(0, 7);
    return data.monthly
      .filter((r) => r.month >= fromYm && r.month <= toYm)
      .sort((a, b) => a.month.localeCompare(b.month));
  }, [data?.monthly, dateFrom, dateTo]);

  return {
    selectedYear,
    setSelectedYear,
    startMonth,
    setStartMonth,
    endMonth,
    setEndMonth,
    effectiveStart,
    effectiveEnd,
    dateFrom,
    dateTo,
    availableYears,
    data,
    monthlyRows,
    loading,
    refreshing,
    errorMsg,
    cutoffWarning,
    fetchSalesBiData,
    handleResetActivePeriod,
  };
}
