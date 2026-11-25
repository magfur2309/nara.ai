import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Download,
  Filter,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import {
  classifyStandardStatusCode,
  type PendingNavigationTarget,
  type PendingTransactionsSummaryResponse,
  type StandardDocStatusChip,
} from '../config/pendingTransactionRules';
import { fetchApiJson } from '../lib/apiClient';
import { getFreshIdToken } from '../lib/firebase';
import { useI18n } from '../lib/i18n';
import { ErpPeriodFilterBar } from './ErpPeriodFilterBar';
import {
  buildStandardStatusChips,
  ErpStatusBadge,
  ErpStatusFilterBar,
  TablePaginationBar,
  useTablePagination,
} from './ErpStatusFilterBar';

export interface ErpSalesKpi {
  invoiceCount: number;
  totalRevenue: number;
  totalPaid: number;
  totalReceivable: number;
  unpaidInvoiceCount: number;
  carryOverReceivable?: number;
  carryOverUnpaidCount?: number;
  overdueInvoiceCount: number;
  overdueAmount: number;
  soCount: number;
  soTotalValue: number;
  soOutstandingCount: number;
  doCount: number;
  returnCount: number;
  returnTotalValue: number;
}

export interface ErpSalesMonthlyRow {
  month: string;
  invoiceCount: number;
  revenue: number;
  paid: number;
  receivable: number;
}

export interface ErpSalesTopCustomer {
  customerId: number;
  customerCode: string;
  customerName: string;
  invoiceCount: number;
  totalRevenue: number;
  totalReceivable: number;
}

export interface ErpSalesTopItem {
  itemId: number;
  itemCode: string;
  itemName: string;
  totalQty: number;
  unit: string;
  totalValue: number;
  invoiceCount: number;
}

export interface ErpSalesInvoiceRow {
  id: number;
  docNo: string;
  date: string;
  dueDate: string;
  customerName: string;
  salesmanName: string;
  warehouse: string;
  currency: string;
  total: number;
  paid: number;
  balance: number;
  isPaid: boolean;
  isOverdue: boolean;
  isCarryOver?: boolean;
  statusCode: number;
  statusLabel: string;
}

export interface ErpSalesOrderRow {
  id: number;
  docNo: string;
  date: string;
  shipDate: string;
  customerName: string;
  warehouse: string;
  total: number;
  statusCode: number;
  statusLabel: string;
  statusDo: number;
  statusSi: number;
  isClosed: boolean;
}

export interface ErpDeliveryOrderRow {
  id: number;
  docNo: string;
  date: string;
  shipDate: string;
  customerName: string;
  warehouse: string;
  expedition: string;
  total: number;
  statusCode: number;
  statusLabel: string;
}

export interface ErpSalesReturnRow {
  id: number;
  docNo: string;
  date: string;
  customerName: string;
  warehouse: string;
  total: number;
  statusCode: number;
  statusLabel: string;
}

export interface ErpSalesQueryResult {
  period: {
    dateFrom: string;
    dateTo: string;
  };
  kpi: ErpSalesKpi;
  monthlyRevenue: ErpSalesMonthlyRow[];
  topCustomers: ErpSalesTopCustomer[];
  topItems: ErpSalesTopItem[];
  invoices: ErpSalesInvoiceRow[];
  unpaidInvoices: ErpSalesInvoiceRow[];
  salesOrders: ErpSalesOrderRow[];
  deliveryOrders: ErpDeliveryOrderRow[];
  salesReturns: ErpSalesReturnRow[];
  fetchedAt: string;
}

type SalesSubTab = 'overview' | 'invoices' | 'unpaid' | 'so' | 'do' | 'returns';

interface ErpSalesPanelProps {
  idToken: string;
  onAskAiQuestion: (question: string) => void;
  onDownloadBridge: () => void;
  pendingSummary?: PendingTransactionsSummaryResponse | null;
  pendingNavTarget?: PendingNavigationTarget | null;
  onClearPendingNav?: () => void;
}

const ACTIVE_CUTOFF_DATE = '2026-03-01';

function fmtIdr(val: number): string {
  return `Rp ${Math.round(val || 0).toLocaleString('id-ID')}`;
}

type SalesPreset = 'since_mar' | 'mar_2026' | 'apr_2026' | 'this_month' | 'last_month' | 'custom';

function getPresetDates(preset: Exclude<SalesPreset, 'custom'>): {
  dateFrom: string;
  dateTo: string;
} {
  if (preset === 'since_mar') return { dateFrom: ACTIVE_CUTOFF_DATE, dateTo: '' };
  if (preset === 'mar_2026') return { dateFrom: '2026-03-01', dateTo: '2026-03-31' };
  if (preset === 'apr_2026') return { dateFrom: '2026-04-01', dateTo: '2026-04-30' };
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  if (preset === 'this_month') {
    const start = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
    return { dateFrom: start >= ACTIVE_CUTOFF_DATE ? start : ACTIVE_CUTOFF_DATE, dateTo: ymd(now) };
  }
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  const ps = ymd(prevStart);
  const pe = ymd(prevEnd);
  return {
    dateFrom: ps >= ACTIVE_CUTOFF_DATE ? ps : ACTIVE_CUTOFF_DATE,
    dateTo: pe >= ACTIVE_CUTOFF_DATE ? pe : '',
  };
}

export function ErpSalesPanel({
  idToken,
  onAskAiQuestion,
  onDownloadBridge,
  pendingSummary,
  pendingNavTarget,
  onClearPendingNav,
}: ErpSalesPanelProps) {
  const { t } = useI18n();
  const [data, setData] = useState<ErpSalesQueryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<SalesSubTab>('overview');
  const [invoiceStatusChip, setInvoiceStatusChip] = useState<StandardDocStatusChip>('all');
  const [returnStatusChip, setReturnStatusChip] = useState<StandardDocStatusChip>('all');
  const [soStatusChip, setSoStatusChip] = useState<StandardDocStatusChip>('all');
  const [doStatusChip, setDoStatusChip] = useState<StandardDocStatusChip>('all');
  const [pendingRuleId, setPendingRuleId] = useState<string | null>(null);
  const [preset, setPreset] = useState<SalesPreset>('since_mar');
  const [dateFrom, setDateFrom] = useState(ACTIVE_CUTOFF_DATE);
  const [dateTo, setDateTo] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');

  const soChipCounts = useMemo(() => {
    const rows = data?.salesOrders || [];
    const counts = { all: rows.length, need_approve: 0, approved: 0, in_progress: 0, completed: 0 };
    for (const so of rows) {
      const cls = classifyStandardStatusCode(so.statusCode, so.isClosed);
      if (cls !== 'excluded') counts[cls]++;
    }
    return counts;
  }, [data?.salesOrders]);

  const doChipCounts = useMemo(() => {
    const rows = data?.deliveryOrders || [];
    const counts = { all: rows.length, need_approve: 0, approved: 0, in_progress: 0, completed: 0 };
    for (const d of rows) {
      const cls = classifyStandardStatusCode(d.statusCode);
      if (cls !== 'excluded') counts[cls]++;
    }
    return counts;
  }, [data?.deliveryOrders]);

  const displayedSalesOrders = useMemo(() => {
    const rows = data?.salesOrders || [];
    if (soStatusChip === 'all') return rows;
    return rows.filter(
      (so) => classifyStandardStatusCode(so.statusCode, so.isClosed) === soStatusChip
    );
  }, [data?.salesOrders, soStatusChip]);

  const displayedDeliveryOrders = useMemo(() => {
    const rows = data?.deliveryOrders || [];
    if (doStatusChip === 'all') return rows;
    return rows.filter((d) => classifyStandardStatusCode(d.statusCode) === doStatusChip);
  }, [data?.deliveryOrders, doStatusChip]);

  const activeInvoicesList = useMemo(
    () => (subTab === 'unpaid' ? data?.unpaidInvoices || [] : data?.invoices || []),
    [data?.invoices, data?.unpaidInvoices, subTab]
  );

  const invoiceChipCounts = useMemo(() => {
    const counts = {
      all: activeInvoicesList.length,
      need_approve: 0,
      approved: 0,
      in_progress: 0,
      completed: 0,
    };
    for (const inv of activeInvoicesList) {
      const cls = classifyStandardStatusCode(inv.statusCode);
      if (cls !== 'excluded') counts[cls]++;
    }
    return counts;
  }, [activeInvoicesList]);

  const displayedInvoices = useMemo(() => {
    if (invoiceStatusChip === 'all') return activeInvoicesList;
    return activeInvoicesList.filter(
      (inv) => classifyStandardStatusCode(inv.statusCode) === invoiceStatusChip
    );
  }, [activeInvoicesList, invoiceStatusChip]);

  const returnChipCounts = useMemo(() => {
    const rows = data?.salesReturns || [];
    const counts = { all: rows.length, need_approve: 0, approved: 0, in_progress: 0, completed: 0 };
    for (const sr of rows) {
      const cls = classifyStandardStatusCode(sr.statusCode);
      if (cls !== 'excluded') counts[cls]++;
    }
    return counts;
  }, [data?.salesReturns]);

  const displayedReturns = useMemo(() => {
    const rows = data?.salesReturns || [];
    if (returnStatusChip === 'all') return rows;
    return rows.filter((sr) => classifyStandardStatusCode(sr.statusCode) === returnStatusChip);
  }, [data?.salesReturns, returnStatusChip]);

  const invoicesPaging = useTablePagination(displayedInvoices, {
    defaultPageSize: 20,
    storageKey: 'erp_sales_invoices',
  });
  const soPaging = useTablePagination(displayedSalesOrders, {
    defaultPageSize: 20,
    storageKey: 'erp_sales_so',
  });
  const doPaging = useTablePagination(displayedDeliveryOrders, {
    defaultPageSize: 20,
    storageKey: 'erp_sales_do',
  });
  const returnsPaging = useTablePagination(displayedReturns, {
    defaultPageSize: 20,
    storageKey: 'erp_sales_returns',
  });

  const { setPage: setSoPage } = soPaging;
  const { setPage: setDoPage } = doPaging;
  const { setPage: setInvoicesPage } = invoicesPaging;
  const { setPage: setReturnsPage } = returnsPaging;

  useEffect(() => {
    setInvoiceStatusChip('all');
    setInvoicesPage(1);
  }, [subTab, setInvoicesPage]);

  useEffect(() => {
    if (!pendingNavTarget || pendingNavTarget.module !== 'sales') return;
    if (pendingNavTarget.subTab === 'so' || pendingNavTarget.subTab === 'do') {
      setSubTab(pendingNavTarget.subTab);
    }
    setPendingRuleId(pendingNavTarget.ruleId);

    if (pendingNavTarget.filterKey === 'pending_so_approved') {
      setSoStatusChip('approved');
      setSoPage(1);
    } else if (pendingNavTarget.filterKey === 'pending_so_in_progress') {
      setSoStatusChip('in_progress');
      setSoPage(1);
    } else if (pendingNavTarget.filterKey === 'pending_do_approval') {
      setDoStatusChip('need_approve');
      setDoPage(1);
    } else if (pendingNavTarget.filterKey === 'pending_do_si') {
      setDoStatusChip('approved');
      setDoPage(1);
    }
  }, [pendingNavTarget, setDoPage, setSoPage]);

  const clearPendingDisplayFilter = () => {
    setSoStatusChip('all');
    setDoStatusChip('all');
    setSoPage(1);
    setDoPage(1);
    setPendingRuleId(null);
    onClearPendingNav?.();
  };

  const paginatedSalesOrders = soPaging.paginatedItems;
  const paginatedDeliveryOrders = doPaging.paginatedItems;

  const fetchSales = useCallback(
    async (opts?: { q?: string; dateFrom?: string; dateTo?: string; refresh?: boolean }) => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const token = await getFreshIdToken(idToken);
        const params = new URLSearchParams();
        if (opts?.q) params.set('q', opts.q);
        if (opts?.dateFrom) params.set('dateFrom', opts.dateFrom);
        if (opts?.dateTo) params.set('dateTo', opts.dateTo);
        if (opts?.refresh) params.set('refresh', '1');
        params.set('limit', '100');

        const json = await fetchApiJson<ErpSalesQueryResult>(
          `/api/erp/sales?${params.toString()}`,
          {
            cache: 'no-store',
            headers: { Authorization: `Bearer ${token}` },
          },
          'Gagal memuat data Sales ERP (m5_*).'
        );
        setData(json);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Gagal memuat data Sales ERP.');
      } finally {
        setLoading(false);
      }
    },
    [idToken]
  );

  useEffect(() => {
    void fetchSales({ dateFrom: ACTIVE_CUTOFF_DATE });
  }, [fetchSales]);

  const applyPreset = (p: Exclude<SalesPreset, 'custom'>) => {
    setPreset(p);
    const range = getPresetDates(p);
    setDateFrom(range.dateFrom);
    setDateTo(range.dateTo);
    setInvoicesPage(1);
    setReturnsPage(1);
    setSoPage(1);
    setDoPage(1);
    void fetchSales({ q: appliedSearch, dateFrom: range.dateFrom, dateTo: range.dateTo });
  };

  const handleFilterSubmit = () => {
    const cleaned = searchInput.trim();
    const safeFrom = dateFrom && dateFrom >= ACTIVE_CUTOFF_DATE ? dateFrom : ACTIVE_CUTOFF_DATE;
    setDateFrom(safeFrom);
    setAppliedSearch(cleaned);
    setInvoicesPage(1);
    setReturnsPage(1);
    setSoPage(1);
    setDoPage(1);
    void fetchSales({ q: cleaned, dateFrom: safeFrom, dateTo });
  };

  const handleClearSearch = () => {
    const safeFrom = dateFrom && dateFrom >= ACTIVE_CUTOFF_DATE ? dateFrom : ACTIVE_CUTOFF_DATE;
    setSearchInput('');
    setAppliedSearch('');
    setInvoicesPage(1);
    setReturnsPage(1);
    setSoPage(1);
    setDoPage(1);
    void fetchSales({ q: '', dateFrom: safeFrom, dateTo });
  };

  const handleSearchChange = (nextValue: string) => {
    setSearchInput(nextValue);
    if (nextValue.trim() === '' && appliedSearch !== '') {
      const safeFrom = dateFrom && dateFrom >= ACTIVE_CUTOFF_DATE ? dateFrom : ACTIVE_CUTOFF_DATE;
      setAppliedSearch('');
      setInvoicesPage(1);
      setReturnsPage(1);
      setSoPage(1);
      setDoPage(1);
      void fetchSales({ q: '', dateFrom: safeFrom, dateTo });
    }
  };

  const handleFilterReset = () => {
    setPreset('since_mar');
    setDateFrom(ACTIVE_CUTOFF_DATE);
    setDateTo('');
    setSearchInput('');
    setAppliedSearch('');
    setInvoiceStatusChip('all');
    setReturnStatusChip('all');
    setSoStatusChip('all');
    setDoStatusChip('all');
    setInvoicesPage(1);
    setReturnsPage(1);
    setSoPage(1);
    setDoPage(1);
    setPendingRuleId(null);
    void fetchSales({ q: '', dateFrom: ACTIVE_CUTOFF_DATE, dateTo: '' });
  };

  if (loading && !data) {
    return (
      <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl p-10 flex items-center justify-center gap-2.5 text-sm text-slate-600 dark:text-slate-400">
        <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-text)] dark:text-[var(--accent)]" />
        <span>{t('erpPanels.sales.loading')}</span>
      </div>
    );
  }

  if (errorMsg && !data) {
    const needsUpgrade = /404|Endpoint tidak ditemukan|\/sales/i.test(errorMsg);
    return (
      <div className="bg-[var(--danger-soft)] dark:bg-rose-950/35 border border-rose-200 dark:border-rose-800/70 rounded-xl p-5 space-y-3 text-xs text-rose-900 dark:text-rose-200">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold">Data Penjualan ERP belum dapat dimuat</p>
            <p className="leading-relaxed">{errorMsg}</p>
            {needsUpgrade && (
              <p className="leading-relaxed text-rose-800 dark:text-rose-300">
                Bridge lokal di PC Anda masih versi lama. Unduh <code>erp-mysql-bridge.mjs</code> versi terbaru di bawah ini agar modul Penjualan aktif.
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onDownloadBridge}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] rounded-lg cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Unduh erp-mysql-bridge.mjs (v2)</span>
          </button>
          <button
            type="button"
            onClick={() => void fetchSales({ q: appliedSearch, dateFrom, dateTo, refresh: true })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 font-medium text-slate-700 dark:text-slate-200 bg-[var(--surface)] dark:bg-slate-900 border border-[var(--border)] dark:border-slate-700 rounded-lg cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Coba Lagi</span>
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      {errorMsg && (
        <div className="bg-[var(--danger-soft)] dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/70 rounded-lg px-4 py-2.5 text-xs text-rose-900 dark:text-rose-200">
          {errorMsg}
        </div>
      )}

      {/* 4-Column Sales KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Total Omzet Aktif (≥ Mar 2026)
          </p>
          <p className="mt-1 font-mono tabular-nums text-xl font-bold text-slate-900 dark:text-slate-100">
            {fmtIdr(data.kpi.totalRevenue)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {data.kpi.invoiceCount.toLocaleString('id-ID')} faktur (tanpa Reject/Delete)
          </p>
        </div>

        <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Piutang Belum Lunas (Kumulatif)
          </p>
          <p
            className={`mt-1 font-mono tabular-nums text-xl font-bold ${
              data.kpi.overdueInvoiceCount > 0
                ? 'text-rose-700 dark:text-rose-400'
                : 'text-slate-900 dark:text-slate-100'
            }`}
          >
            {fmtIdr(data.kpi.totalReceivable)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {data.kpi.unpaidInvoiceCount.toLocaleString('id-ID')} faktur ·{' '}
            <span className="text-rose-600 dark:text-rose-400 font-medium">
              {data.kpi.overdueInvoiceCount.toLocaleString('id-ID')} jatuh tempo
            </span>
            {typeof data.kpi.carryOverUnpaidCount === 'number' && data.kpi.carryOverUnpaidCount > 0 && (
              <span> · {data.kpi.carryOverUnpaidCount} carry-over &lt; Mar</span>
            )}
          </p>
        </div>

        <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Sales Order
          </p>
          <p className="mt-1 font-mono tabular-nums text-xl font-bold text-slate-900 dark:text-slate-100">
            {data.kpi.soCount.toLocaleString('id-ID')} SO
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {data.kpi.soOutstandingCount.toLocaleString('id-ID')} belum DO · {fmtIdr(data.kpi.soTotalValue)}
          </p>
        </div>

        <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Surat Jalan &amp; Retur
          </p>
          <p className="mt-1 font-mono tabular-nums text-xl font-bold text-slate-900 dark:text-slate-100">
            {data.kpi.doCount.toLocaleString('id-ID')} DO
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Retur: {data.kpi.returnCount.toLocaleString('id-ID')} ({fmtIdr(data.kpi.returnTotalValue)})
          </p>
        </div>
      </div>

      {/* Quick Tanya AI Prompts for Sales */}
      <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
          <MessageSquareText className="w-4 h-4 text-[var(--accent-text)] dark:text-[var(--accent)] shrink-0" />
          <span>Analisa langsung data Penjualan ERP lewat Tanya AI:</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[
            'Rekap omzet penjualan dan piutang belum lunas saat ini',
            'Faktur penjualan mana saja yang sudah jatuh tempo?',
            'Siapa top 10 customer dan barang paling laris?',
            'Cek daftar Sales Order yang belum dikirim (DO)',
          ].map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => onAskAiQuestion(prompt)}
              className="px-3 py-1.5 text-xs font-medium text-[var(--accent-text)] dark:text-[var(--accent)] bg-[var(--accent-soft)] dark:bg-[var(--accent-soft)] hover:bg-[var(--accent-soft)] dark:hover:bg-[var(--accent-soft)] border border-[var(--accent)]/40 dark:border-[var(--accent)]/40 rounded-lg transition-colors cursor-pointer"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>

      {/* Period & Search Filter Bar */}
      <ErpPeriodFilterBar
        dateFrom={dateFrom}
        dateTo={dateTo}
        minDate={ACTIVE_CUTOFF_DATE}
        searchValue={searchInput}
        appliedSearchValue={appliedSearch}
        searchPlaceholder="Cari nomor faktur/SO/DO, nama customer, salesman, atau gudang..."
        loading={loading}
        helperNote="Aturan aktif: transaksi penjualan di bawah 1 Maret 2026 diabaikan, kecuali faktur Piutang Belum Lunas (carry-over) yang tetap dihitung penuh."
        onPeriodChange={(nextFrom, nextTo) => {
          setPreset('custom');
          setDateFrom(nextFrom);
          setDateTo(nextTo);
        }}
        onSearchChange={handleSearchChange}
        onClearSearch={handleClearSearch}
        onSubmit={handleFilterSubmit}
        onReset={handleFilterReset}
        onRefresh={() => {
          const currentQ = searchInput.trim();
          setAppliedSearch(currentQ);
          void fetchSales({ q: currentQ, dateFrom, dateTo, refresh: true });
        }}
      />

      {/* Sales Sub-Tabs */}
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--border)] dark:border-slate-800 pb-2">
        {(
          [
            { id: 'overview', label: t('erpPanels.sales.tabOverview') },
            { id: 'invoices', label: t('erpPanels.sales.tabInvoices', { count: data.invoices.length }) },
            { id: 'unpaid', label: `Belum Lunas (${data.unpaidInvoices.length})` },
            { id: 'so', label: t('erpPanels.sales.tabSo', { count: data.salesOrders.length }) },
            { id: 'do', label: t('erpPanels.sales.tabDo', { count: data.deliveryOrders.length }) },
            { id: 'returns', label: t('erpPanels.sales.tabReturns', { count: data.salesReturns.length }) },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSubTab(tab.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
              subTab === tab.id
                ? 'bg-[var(--accent-soft)] dark:bg-[var(--accent-soft)] text-[var(--accent-text)] dark:text-[var(--accent)] font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-[var(--surface-2)] dark:hover:bg-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Sub-Tab Content */}
      {subTab === 'overview' && (
        <div className="space-y-4">
          {/* Monthly Trend Table */}
          <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border)] dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Tren Omzet Penjualan Per Bulan (12 Bulan Terbaru)
              </h3>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Live: {new Date(data.fetchedAt).toLocaleTimeString('id-ID')}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[var(--surface-2)] dark:bg-slate-900/90 border-b border-[var(--border)] dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-2.5 font-semibold">Bulan</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Faktur</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Omzet</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Terbayar</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Sisa Piutang</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {data.monthlyRevenue.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                        Belum ada data faktur pada periode ini.
                      </td>
                    </tr>
                  ) : (
                    data.monthlyRevenue.map((m) => (
                      <tr key={m.month} className="hover:bg-[var(--surface-2)] dark:hover:bg-slate-800/40">
                        <td className="px-4 py-2 font-mono font-medium text-slate-900 dark:text-slate-100">
                          {m.month}
                        </td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                          {m.invoiceCount.toLocaleString('id-ID')}
                        </td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                          {fmtIdr(m.revenue)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                          {fmtIdr(m.paid)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums text-amber-700 dark:text-amber-400">
                          {fmtIdr(m.receivable)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Top Customers */}
            <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border)] dark:border-slate-800">
                <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  {t('erpPanels.sales.topCustomers')}
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[var(--surface-2)] dark:bg-slate-900/90 border-b border-[var(--border)] dark:border-slate-800 text-slate-500 dark:text-slate-400">
                      <th className="px-3.5 py-2 font-semibold">Customer</th>
                      <th className="px-3.5 py-2 font-semibold text-right">Faktur</th>
                      <th className="px-3.5 py-2 font-semibold text-right">Total Omzet</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {data.topCustomers.map((c) => (
                      <tr key={`${c.customerId}-${c.customerCode}`} className="hover:bg-[var(--surface-2)] dark:hover:bg-slate-800/40">
                        <td className="px-3.5 py-2">
                          <div className="font-medium text-slate-900 dark:text-slate-100">{c.customerName}</div>
                          <div className="font-mono text-[11px] text-slate-500">{c.customerCode}</div>
                        </td>
                        <td className="px-3.5 py-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                          {c.invoiceCount}
                        </td>
                        <td className="px-3.5 py-2 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          {fmtIdr(c.totalRevenue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Top Items */}
            <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border)] dark:border-slate-800">
                <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  {t('erpPanels.sales.topItems')}
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[var(--surface-2)] dark:bg-slate-900/90 border-b border-[var(--border)] dark:border-slate-800 text-slate-500 dark:text-slate-400">
                      <th className="px-3.5 py-2 font-semibold">Barang</th>
                      <th className="px-3.5 py-2 font-semibold text-right">Qty</th>
                      <th className="px-3.5 py-2 font-semibold text-right">Nilai</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {data.topItems.map((it) => (
                      <tr key={`${it.itemId}-${it.itemCode}`} className="hover:bg-[var(--surface-2)] dark:hover:bg-slate-800/40">
                        <td className="px-3.5 py-2">
                          <div className="font-medium text-slate-900 dark:text-slate-100">{it.itemName}</div>
                          <div className="font-mono text-[11px] text-slate-500">{it.itemCode}</div>
                        </td>
                        <td className="px-3.5 py-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {it.totalQty.toLocaleString('id-ID')} {it.unit}
                        </td>
                        <td className="px-3.5 py-2 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          {fmtIdr(it.totalValue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {(subTab === 'invoices' || subTab === 'unpaid') && (
        <div className="space-y-3">
          <ErpStatusFilterBar
            options={buildStandardStatusChips(invoiceChipCounts)}
            activeValue={invoiceStatusChip}
            filteredCount={displayedInvoices.length}
            totalCount={activeInvoicesList.length}
            onChange={(next) => {
              setInvoiceStatusChip(next);
              setInvoicesPage(1);
            }}
          />
          <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[var(--surface-2)] dark:bg-slate-900/90 border-b border-[var(--border)] dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-2.5 font-semibold">No. Faktur</th>
                    <th className="px-4 py-2.5 font-semibold">Tanggal</th>
                    <th className="px-4 py-2.5 font-semibold">Jatuh Tempo</th>
                    <th className="px-4 py-2.5 font-semibold">Customer</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Total</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Sisa Piutang</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {displayedInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                        Tidak ada faktur penjualan pada filter status ini.
                      </td>
                    </tr>
                  ) : (
                    invoicesPaging.paginatedItems.map((inv) => (
                      <tr key={inv.id} className="hover:bg-[var(--surface-2)] dark:hover:bg-slate-800/40">
                        <td className="px-4 py-2.5 font-mono font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          {inv.docNo}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {inv.date || '-'}
                          {inv.isCarryOver && (
                            <span className="ml-1.5 font-sans text-[11px] text-[var(--accent-text)] dark:text-[var(--accent)]">
                              · Carry-over
                            </span>
                          )}
                        </td>
                        <td
                          className={`px-4 py-2.5 font-mono whitespace-nowrap ${
                            inv.isOverdue
                              ? 'text-rose-700 dark:text-rose-400 font-semibold'
                              : 'text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          {inv.dueDate || '-'}
                          {inv.isOverdue ? ' (Overdue)' : ''}
                        </td>
                        <td className="px-4 py-2.5 text-slate-900 dark:text-slate-100">{inv.customerName}</td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          {fmtIdr(inv.total)}
                        </td>
                        <td
                          className={`px-4 py-2.5 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                            inv.balance > 0
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-emerald-700 dark:text-emerald-400'
                          }`}
                        >
                          {inv.isPaid || inv.balance <= 0 ? 'Lunas' : fmtIdr(inv.balance)}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <ErpStatusBadge
                            statusCode={inv.statusCode}
                            rawLabel={inv.statusLabel}
                          />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <TablePaginationBar {...invoicesPaging.paginationProps} />
          </div>
        </div>
      )}

      {subTab === 'so' && (
        <div className="space-y-3">
          {pendingRuleId && pendingRuleId.startsWith('sales_so_') && soStatusChip !== 'all' && (
            <div className="rounded-xl bg-[var(--accent-soft)] border border-[var(--accent)]/40 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-2 text-[var(--text)]">
                <Filter className="w-3.5 h-3.5 text-[var(--accent-text)] shrink-0" />
                <span className="font-semibold">
                  {t(`pendingTx.rules.${pendingRuleId}.title`)}
                </span>
                <span className="text-[var(--text-muted)]">
                  · {t('pendingTx.filterBanner.showingCount', { shown: displayedSalesOrders.length })}
                </span>
              </div>
              <button
                type="button"
                onClick={clearPendingDisplayFilter}
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs font-semibold bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] hover:border-[var(--accent)] cursor-pointer"
              >
                <X className="w-3 h-3" />
                <span>{t('pendingTx.filterBanner.reset')}</span>
              </button>
            </div>
          )}

          <ErpStatusFilterBar
            options={buildStandardStatusChips(soChipCounts)}
            activeValue={soStatusChip}
            filteredCount={displayedSalesOrders.length}
            totalCount={data.salesOrders.length}
            onChange={(next) => {
              setSoStatusChip(next);
              setSoPage(1);
              if (next === 'all') setPendingRuleId(null);
            }}
          />

          <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[var(--surface-2)] dark:bg-slate-900/90 border-b border-[var(--border)] dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-2.5 font-semibold">No. SO</th>
                    <th className="px-4 py-2.5 font-semibold">Tanggal</th>
                    <th className="px-4 py-2.5 font-semibold">Tgl Kirim</th>
                    <th className="px-4 py-2.5 font-semibold">Customer</th>
                    <th className="px-4 py-2.5 font-semibold">Gudang</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Total</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {paginatedSalesOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                        {t('pendingTx.empty')}
                      </td>
                    </tr>
                  ) : (
                    paginatedSalesOrders.map((so) => (
                      <tr key={so.id} className="hover:bg-[var(--surface-2)] dark:hover:bg-slate-800/40">
                        <td className="px-4 py-2.5 font-mono font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          {so.docNo}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {so.date || '-'}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {so.shipDate || '-'}
                        </td>
                        <td className="px-4 py-2.5 text-slate-900 dark:text-slate-100">{so.customerName}</td>
                        <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">{so.warehouse}</td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          {fmtIdr(so.total)}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <ErpStatusBadge
                            statusCode={so.statusCode}
                            isClosed={so.isClosed}
                            rawLabel={so.statusLabel}
                          />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <TablePaginationBar {...soPaging.paginationProps} />
          </div>
        </div>
      )}

      {subTab === 'do' && (
        <div className="space-y-3">
          {pendingRuleId && pendingRuleId.startsWith('sales_do_') && doStatusChip !== 'all' && (
            <div className="rounded-xl bg-[var(--accent-soft)] border border-[var(--accent)]/40 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-2 text-[var(--text)]">
                <Filter className="w-3.5 h-3.5 text-[var(--accent-text)] shrink-0" />
                <span className="font-semibold">
                  {t(`pendingTx.rules.${pendingRuleId}.title`)}
                </span>
                <span className="text-[var(--text-muted)]">
                  · {t('pendingTx.filterBanner.showingCount', { shown: displayedDeliveryOrders.length })}
                </span>
              </div>
              <button
                type="button"
                onClick={clearPendingDisplayFilter}
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-xs font-semibold bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] hover:border-[var(--accent)] cursor-pointer"
              >
                <X className="w-3 h-3" />
                <span>{t('pendingTx.filterBanner.reset')}</span>
              </button>
            </div>
          )}

          <ErpStatusFilterBar
            options={buildStandardStatusChips(doChipCounts)}
            activeValue={doStatusChip}
            filteredCount={displayedDeliveryOrders.length}
            totalCount={data.deliveryOrders.length}
            onChange={(next) => {
              setDoStatusChip(next);
              setDoPage(1);
              if (next === 'all') setPendingRuleId(null);
            }}
          />

          <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[var(--surface-2)] dark:bg-slate-900/90 border-b border-[var(--border)] dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-2.5 font-semibold">No. DO</th>
                    <th className="px-4 py-2.5 font-semibold">Tanggal</th>
                    <th className="px-4 py-2.5 font-semibold">Customer</th>
                    <th className="px-4 py-2.5 font-semibold">Gudang</th>
                    <th className="px-4 py-2.5 font-semibold">Ekspedisi</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Total</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {paginatedDeliveryOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                        {t('pendingTx.empty')}
                      </td>
                    </tr>
                  ) : (
                    paginatedDeliveryOrders.map((d) => (
                      <tr key={d.id} className="hover:bg-[var(--surface-2)] dark:hover:bg-slate-800/40">
                        <td className="px-4 py-2.5 font-mono font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          {d.docNo}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {d.date || '-'}
                        </td>
                        <td className="px-4 py-2.5 text-slate-900 dark:text-slate-100">{d.customerName}</td>
                        <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">{d.warehouse}</td>
                        <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">{d.expedition}</td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          {fmtIdr(d.total)}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <ErpStatusBadge statusCode={d.statusCode} rawLabel={d.statusLabel} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <TablePaginationBar {...doPaging.paginationProps} />
          </div>
        </div>
      )}

      {subTab === 'returns' && (
        <div className="space-y-3">
          <ErpStatusFilterBar
            options={buildStandardStatusChips(returnChipCounts)}
            activeValue={returnStatusChip}
            filteredCount={displayedReturns.length}
            totalCount={data.salesReturns.length}
            onChange={(next) => {
              setReturnStatusChip(next);
              setReturnsPage(1);
            }}
          />
          <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[var(--surface-2)] dark:bg-slate-900/90 border-b border-[var(--border)] dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-2.5 font-semibold">No. Retur</th>
                    <th className="px-4 py-2.5 font-semibold">Tanggal</th>
                    <th className="px-4 py-2.5 font-semibold">Customer</th>
                    <th className="px-4 py-2.5 font-semibold">Gudang</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Total Retur</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {displayedReturns.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                        Tidak ada retur penjualan pada filter ini.
                      </td>
                    </tr>
                  ) : (
                    returnsPaging.paginatedItems.map((sr) => (
                      <tr key={sr.id} className="hover:bg-[var(--surface-2)] dark:hover:bg-slate-800/40">
                        <td className="px-4 py-2.5 font-mono font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          {sr.docNo}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {sr.date || '-'}
                        </td>
                        <td className="px-4 py-2.5 text-slate-900 dark:text-slate-100">{sr.customerName}</td>
                        <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">{sr.warehouse}</td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums font-semibold text-rose-700 dark:text-rose-400 whitespace-nowrap">
                          {fmtIdr(sr.total)}
                        </td>
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <ErpStatusBadge statusCode={sr.statusCode} rawLabel={sr.statusLabel} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <TablePaginationBar {...returnsPaging.paginationProps} />
          </div>
        </div>
      )}
    </div>
  );
}
