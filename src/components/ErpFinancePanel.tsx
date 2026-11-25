import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Download,
  Info,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Search,
} from 'lucide-react';
import { fetchApiJson } from '../lib/apiClient';
import { getFreshIdToken } from '../lib/firebase';
import { ErpPeriodFilterBar } from './ErpPeriodFilterBar';
import { TablePaginationBar, useTablePagination } from './TablePaginationBar';
import { useI18n } from '../lib/i18n';

export interface ErpFinanceCoverage {
  minDateAll: string;
  maxDateAll: string;
  totalRowsAll: number;
  minDateActive: string;
  maxDateActive: string;
  totalRowsActive: number;
  anomalyCount: number;
}

export interface ErpFinanceKpi {
  revenue: number;
  cogsMaterial?: number;
  cogsOpeningBalance?: number;
  cogsClosingBalance?: number;
  cogsLabour?: number;
  cogsOther?: number;
  cogs: number;
  hasOpeningClosingInput?: boolean;
  grossProfit: number;
  grossMarginPct: number;
  opex: number;
  operatingProfit: number;
  otherIncome: number;
  otherExpense: number;
  profitBeforeTax?: number;
  oci?: number;
  incomeTax?: number;
  taxAndExtraordinary?: number;
  otherAdj: number;
  taxExpense: number;
  netIncome: number;
  netMarginPct: number;
  totalArJournal: number;
  totalArCarryOver: number;
  totalArPeriod: number;
  totalApJournal: number;
  totalApCarryOver: number;
  totalApPeriod: number;
  arUnpaidInvoiceTotal: number;
  arUnpaidInvoiceCount: number;
  arOverdueTotal: number;
  arOverdueCount: number;
  cashAndBankMovement: number;
  inventoryMovement: number;
}

export interface ErpFinanceMonthlyPnlRow {
  month: string;
  revenue: number;
  cogsMaterial?: number;
  cogsOpeningBalance?: number;
  cogsClosingBalance?: number;
  cogsLabour?: number;
  cogsOther?: number;
  cogs: number;
  grossProfit: number;
  opex: number;
  otherIncome?: number;
  otherExpense?: number;
  operatingProfit?: number;
  profitBeforeTax?: number;
  oci?: number;
  incomeTax?: number;
  interestExpense?: number;
  depreciationAmortization?: number;
  taxExpenseInOpex?: number;
  netIncome: number;
  hasOpeningClosingInput?: boolean;
}

export interface ErpFinancePnlAccountRow {
  accountNo: string;
  accountName: string;
  ctipe: number;
  cdc: string;
  section: string;
  debit: number;
  credit: number;
  amount: number;
  hasAnomaly: boolean;
}

export interface ErpFinanceBsAccountRow {
  accountNo: string;
  accountName: string;
  ctipe: number;
  cdc: string;
  section: string;
  isAr: boolean;
  isAp: boolean;
  isArAp: boolean;
  carryOverBalance: number;
  periodBalance: number;
  balance: number;
  hasAnomaly: boolean;
}

export interface ErpFinanceContactBalanceRow {
  contactId: number;
  contactCode: string;
  contactName: string;
  carryOverBalance: number;
  periodBalance: number;
  totalBalance: number;
}

export interface ErpFinanceAgingBucket {
  count: number;
  amount: number;
}

export interface ErpFinanceArAging {
  current: ErpFinanceAgingBucket;
  days1to30: ErpFinanceAgingBucket;
  days31to60: ErpFinanceAgingBucket;
  days61to90: ErpFinanceAgingBucket;
  over90: ErpFinanceAgingBucket;
  totalCount: number;
  totalAmount: number;
  carryOverCount: number;
  carryOverAmount: number;
}

export interface ErpFinanceMonthlyBsRow {
  month: string;
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
}

export interface ErpFinanceQueryResult {
  cutoffDate: string;
  period: {
    dateFrom: string;
    dateTo: string;
  };
  coverage: ErpFinanceCoverage;
  kpi: ErpFinanceKpi;
  monthlyPnl: ErpFinanceMonthlyPnlRow[];
  monthlyBalanceSheet?: ErpFinanceMonthlyBsRow[];
  pnlAccounts: ErpFinancePnlAccountRow[];
  balanceSheetAccounts: ErpFinanceBsAccountRow[];
  arAccounts: ErpFinanceBsAccountRow[];
  apAccounts: ErpFinanceBsAccountRow[];
  topArContacts: ErpFinanceContactBalanceRow[];
  topApContacts: ErpFinanceContactBalanceRow[];
  arAging: ErpFinanceArAging;
  fetchedAt: string;
}

type FinanceSubTab = 'pnl' | 'arap' | 'coa';
type FinancePreset = 'since_mar' | 'full_2026' | 'mar_2026' | 'apr_2026' | 'this_month' | 'last_month' | 'custom';

interface ErpFinancePanelProps {
  idToken: string;
  onAskAiQuestion: (question: string) => void;
  onDownloadBridge: () => void;
}

const ACTIVE_CUTOFF_DATE = '2026-03-01';

function fmtIdr(val: number): string {
  const num = Number(val || 0);
  if (!Number.isFinite(num)) return 'Rp 0';
  const abs = Math.abs(Math.round(num)).toLocaleString('id-ID');
  return num < 0 ? `(Rp ${abs})` : `Rp ${abs}`;
}

function fmtIdrExact(val: number): string {
  const num = Number(val || 0);
  if (!Number.isFinite(num)) return 'Rp 0,00';
  const abs = Math.abs(num).toLocaleString('id-ID', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return num < 0 ? `(Rp ${abs})` : `Rp ${abs}`;
}

function getFinancePresetDates(preset: Exclude<FinancePreset, 'custom'>): {
  dateFrom: string;
  dateTo: string;
} {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  if (preset === 'since_mar') {
    return { dateFrom: ACTIVE_CUTOFF_DATE, dateTo: '' };
  }
  if (preset === 'full_2026') {
    return { dateFrom: ACTIVE_CUTOFF_DATE, dateTo: '2026-12-31' };
  }
  if (preset === 'mar_2026') {
    return { dateFrom: '2026-03-01', dateTo: '2026-03-31' };
  }
  if (preset === 'apr_2026') {
    return { dateFrom: '2026-04-01', dateTo: '2026-04-30' };
  }
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

export function ErpFinancePanel({
  idToken,
  onAskAiQuestion,
  onDownloadBridge,
}: ErpFinancePanelProps) {
  const { t } = useI18n();
  const [data, setData] = useState<ErpFinanceQueryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<FinanceSubTab>('pnl');
  const [preset, setPreset] = useState<FinancePreset>('since_mar');
  const [dateFrom, setDateFrom] = useState(ACTIVE_CUTOFF_DATE);
  const [dateTo, setDateTo] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');

  const pnlAccountsPaging = useTablePagination(data?.pnlAccounts || [], {
    defaultPageSize: 25,
    storageKey: 'erp_finance_pnl_accounts',
  });
  const arContactsPaging = useTablePagination(data?.topArContacts || [], {
    defaultPageSize: 15,
    storageKey: 'erp_finance_ar_contacts',
  });
  const apContactsPaging = useTablePagination(data?.topApContacts || [], {
    defaultPageSize: 15,
    storageKey: 'erp_finance_ap_contacts',
  });
  const coaPaging = useTablePagination(data?.balanceSheetAccounts || [], {
    defaultPageSize: 25,
    storageKey: 'erp_finance_coa',
  });

  const fetchFinance = useCallback(
    async (opts?: { q?: string; dateFrom?: string; dateTo?: string; refresh?: boolean }) => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const token = await getFreshIdToken(idToken);
        const params = new URLSearchParams();
        if (opts?.q) params.set('q', opts.q);
        params.set('dateFrom', opts?.dateFrom || ACTIVE_CUTOFF_DATE);
        if (opts?.dateTo) params.set('dateTo', opts.dateTo);
        if (opts?.refresh) params.set('refresh', '1');

        const json = await fetchApiJson<ErpFinanceQueryResult>(
          `/api/erp/finance?${params.toString()}`,
          {
            cache: 'no-store',
            headers: { Authorization: `Bearer ${token}` },
          },
          'Gagal memuat data Keuangan ERP (m2_*).'
        );
        setData(json);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Gagal memuat data Keuangan ERP.');
      } finally {
        setLoading(false);
      }
    },
    [idToken]
  );

  useEffect(() => {
    void fetchFinance({ dateFrom: ACTIVE_CUTOFF_DATE });
  }, [fetchFinance]);

  const applyPreset = (p: Exclude<FinancePreset, 'custom'>) => {
    setPreset(p);
    const range = getFinancePresetDates(p);
    setDateFrom(range.dateFrom);
    setDateTo(range.dateTo);
    void fetchFinance({ q: appliedSearch, dateFrom: range.dateFrom, dateTo: range.dateTo });
  };

  const handleFilterSubmit = () => {
    const cleaned = searchInput.trim();
    const safeFrom = dateFrom && dateFrom >= ACTIVE_CUTOFF_DATE ? dateFrom : ACTIVE_CUTOFF_DATE;
    setDateFrom(safeFrom);
    setAppliedSearch(cleaned);
    void fetchFinance({ q: cleaned, dateFrom: safeFrom, dateTo });
  };

  const handleClearSearch = () => {
    const safeFrom = dateFrom && dateFrom >= ACTIVE_CUTOFF_DATE ? dateFrom : ACTIVE_CUTOFF_DATE;
    setSearchInput('');
    setAppliedSearch('');
    void fetchFinance({ q: '', dateFrom: safeFrom, dateTo });
  };

  const handleSearchChange = (nextValue: string) => {
    setSearchInput(nextValue);
    if (nextValue.trim() === '' && appliedSearch !== '') {
      const safeFrom = dateFrom && dateFrom >= ACTIVE_CUTOFF_DATE ? dateFrom : ACTIVE_CUTOFF_DATE;
      setAppliedSearch('');
      void fetchFinance({ q: '', dateFrom: safeFrom, dateTo });
    }
  };

  const handleFilterReset = () => {
    setPreset('since_mar');
    setDateFrom(ACTIVE_CUTOFF_DATE);
    setDateTo('');
    setSearchInput('');
    setAppliedSearch('');
    void fetchFinance({ q: '', dateFrom: ACTIVE_CUTOFF_DATE, dateTo: '' });
  };

  if (loading && !data) {
    return (
      <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl p-10 flex items-center justify-center gap-2.5 text-sm text-slate-600 dark:text-slate-400">
        <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-text)] dark:text-[var(--accent)]" />
        <span>{t('erpPanels.finance.loading')}</span>
      </div>
    );
  }

  if (errorMsg && !data) {
    const needsUpgrade = /404|Endpoint tidak ditemukan|\/finance/i.test(errorMsg);
    return (
      <div className="bg-[var(--danger-soft)] dark:bg-rose-950/35 border border-rose-200 dark:border-rose-800/70 rounded-xl p-5 space-y-3 text-xs text-rose-900 dark:text-rose-200">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold">Data Keuangan ERP belum dapat dimuat</p>
            <p className="leading-relaxed">{errorMsg}</p>
            {needsUpgrade && (
              <p className="leading-relaxed text-rose-800 dark:text-rose-300">
                Bridge lokal di PC Anda masih versi sebelumnya. Unduh{' '}
                <code>erp-mysql-bridge.mjs</code> versi terbaru (v5) di bawah ini agar endpoint{' '}
                <code>/finance</code> dan aturan cut-off Maret 2026 aktif.
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
            <span>Unduh Bridge v5 (.mjs)</span>
          </button>
          <button
            type="button"
            onClick={() => void fetchFinance({ q: appliedSearch, dateFrom, dateTo, refresh: true })}
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

      {/* Active Cut-Off Policy & Local DB Journal Coverage Notice */}
      <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl px-4 py-3 text-xs text-slate-700 dark:text-slate-300 space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-[var(--accent-text)] dark:text-[var(--accent)] shrink-0" />
            <span>
              <strong>Aturan Cut-Off Aktif:</strong> Transaksi operasional &amp; Laba Rugi dihitung mulai{' '}
              <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                1 Maret 2026
              </span>{' '}
              (di bawah Maret 2026 diabaikan), <strong>kecuali Hutang (2101*) &amp; Piutang (1102*)</strong> yang tetap membawa saldo terbuka sebelumnya.
            </span>
          </div>
          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">
            Live: {new Date(data.fetchedAt).toLocaleTimeString('id-ID')}
          </span>
        </div>
        <div className="pl-6 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
          <span>
            Jurnal DB lokal:{' '}
            <strong className="font-mono text-slate-700 dark:text-slate-300">
              {data.coverage.minDateAll || '-'} s/d {data.coverage.maxDateAll || '-'}
            </strong>{' '}
            ({data.coverage.totalRowsAll.toLocaleString('id-ID')} baris)
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Jurnal ≥ Mar 2026:{' '}
            <strong
              className={`font-mono ${
                data.coverage.totalRowsActive > 0
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-amber-700 dark:text-amber-400'
              }`}
            >
              {data.coverage.totalRowsActive.toLocaleString('id-ID')} baris
            </strong>
          </span>
          {data.coverage.anomalyCount > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-amber-700 dark:text-amber-400">
                {data.coverage.anomalyCount} akun anomali overflow (&gt;10¹⁴) otomatis dikecualikan dari KPI
              </span>
            </>
          )}
        </div>
      </div>

      {data.coverage.totalRowsActive === 0 && (
        <div className="bg-[var(--warning-soft)] dark:bg-amber-950/35 border border-amber-200 dark:border-amber-800/70 rounded-xl px-4 py-3 text-xs text-amber-950 dark:text-amber-100 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <p className="leading-relaxed">
            Database ERP yang terhubung saat ini memiliki jurnal terakhir tanggal{' '}
            <strong className="font-mono">{data.coverage.maxDateAll || '-'}</strong> (belum ada transaksi jurnal ≥{' '}
            <strong className="font-mono">2026-03-01</strong>). Oleh karena itu Laba Rugi mulai Maret 2026 masih bernilai Rp 0, sedangkan saldo{' '}
            <strong>Hutang &amp; Piutang</strong> di bawah tetap tampil penuh dari carry-over. Begitu database diperbarui dengan data Maret 2026 ke atas, seluruh angka Laba Rugi &amp; Neraca akan langsung terisi otomatis.
          </p>
        </div>
      )}

      {/* 4-Column Finance KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Pendapatan Usaha (≥ Mar 2026)
          </p>
          <p className="mt-1 font-mono tabular-nums text-xl font-bold text-slate-900 dark:text-slate-100">
            {fmtIdr(data.kpi.revenue)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Laba Kotor: {fmtIdr(data.kpi.grossProfit)} · Margin {data.kpi.grossMarginPct}%
          </p>
        </div>

        <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Laba / (Rugi) Bersih (≥ Mar 2026)
          </p>
          <p
            className={`mt-1 font-mono tabular-nums text-xl font-bold ${
              data.kpi.netIncome < 0
                ? 'text-rose-700 dark:text-rose-400'
                : data.kpi.netIncome > 0
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-slate-900 dark:text-slate-100'
            }`}
          >
            {fmtIdr(data.kpi.netIncome)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            OPEX: {fmtIdr(data.kpi.opex)} · Net {data.kpi.netMarginPct}%
          </p>
        </div>

        <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Total Piutang / AR (Kumulatif)
          </p>
          <p className="mt-1 font-mono tabular-nums text-xl font-bold text-[var(--accent-text)] dark:text-[var(--accent)]">
            {fmtIdr(data.kpi.totalArJournal)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Carry-over &lt; Mar: {fmtIdr(data.kpi.totalArCarryOver)} · Faktur JT: {data.kpi.arOverdueCount}
          </p>
        </div>

        <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Total Hutang / AP (Kumulatif)
          </p>
          <p className="mt-1 font-mono tabular-nums text-xl font-bold text-amber-700 dark:text-amber-400">
            {fmtIdr(data.kpi.totalApJournal)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Carry-over &lt; Mar: {fmtIdr(data.kpi.totalApCarryOver)} · Mutasi ≥ Mar: {fmtIdr(data.kpi.totalApPeriod)}
          </p>
        </div>
      </div>

      {/* Quick Tanya AI Prompts for Finance */}
      <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
          <MessageSquareText className="w-4 h-4 text-[var(--accent-text)] dark:text-[var(--accent)] shrink-0" />
          <span>Analisa langsung Keuangan &amp; Hutang Piutang (m2_*) lewat Tanya AI:</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[
            'Ringkas Laba Rugi sejak Maret 2026 dari ERP',
            'Cek total Hutang dan Piutang aktif termasuk carry-over sebelum Maret 2026',
            'Bagaimana aging piutang yang sudah jatuh tempo saat ini?',
            'Siapa top 10 supplier dengan saldo hutang terbesar?',
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
        searchPlaceholder="Cari nomor atau nama akun COA (misal: 110201, 210101, BANK, SALARY)..."
        loading={loading}
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
          void fetchFinance({ q: currentQ, dateFrom, dateTo, refresh: true });
        }}
      />

      {/* Finance Sub-Tabs */}
      <div className="flex flex-wrap items-center gap-1 border-b border-[var(--border)] dark:border-slate-800 pb-2">
        {(
          [
            { id: 'pnl', label: `Laba Rugi ≥ Mar 2026 (${data.pnlAccounts.length})` },
            {
              id: 'arap',
              label: `Hutang & Piutang Kumulatif (${data.arAccounts.length + data.apAccounts.length})`,
            },
            { id: 'coa', label: `Neraca / Mutasi COA (${data.balanceSheetAccounts.length})` },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubTab(t.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              subTab === t.id
                ? 'bg-[var(--accent-soft)] dark:bg-[var(--accent-soft)] text-[var(--accent-text)] dark:text-[var(--accent)] font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-[var(--surface-2)] dark:hover:bg-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Sub-Tab 1: Laba Rugi (P&L >= March 2026) */}
      {subTab === 'pnl' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Structured P&L Summary — 100% sesuai struktur resmi MyERPPlus */}
            <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border)] dark:border-slate-800 flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Ikhtisar Laba Rugi ({data.period.dateFrom} s/d {data.period.dateTo || 'Sekarang'})
                </h3>
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  Sistem Periodik · Presisi 2 Desimal
                </span>
              </div>
              {data.kpi.revenue > 0 && !data.kpi.hasOpeningClosingInput && (
                <div className="px-4 py-2 bg-[var(--warning-soft)] dark:bg-amber-950/30 border-b border-amber-200/70 dark:border-amber-800/50 text-[11px] text-amber-900 dark:text-amber-200">
                  Sistem Periodik: Akun Opening/Closing Balance (<code>520101*</code>/<code>520102*</code>) masih Rp 0 pada periode ini, sehingga HPP masih mencerminkan pembelian berjalan.
                </div>
              )}
              <div className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
                {(() => {
                  const cogsMat = data.kpi.cogsMaterial ?? 0;
                  const cogsOpen = data.kpi.cogsOpeningBalance ?? 0;
                  const cogsClose = data.kpi.cogsClosingBalance ?? 0;
                  const cogsLab = data.kpi.cogsLabour ?? 0;
                  const cogsOth = data.kpi.cogsOther ?? 0;
                  const pbt =
                    data.kpi.profitBeforeTax ??
                    data.kpi.operatingProfit + data.kpi.otherIncome - data.kpi.otherExpense;
                  const ociVal = data.kpi.oci ?? data.kpi.taxExpense ?? 0;
                  const incomeTaxVal = data.kpi.incomeTax ?? data.kpi.otherAdj ?? 0;
                  const taxExtra = data.kpi.taxAndExtraordinary ?? incomeTaxVal - ociVal;

                  const rows: Array<{
                    label: string;
                    subNote?: string;
                    value: number;
                    bold?: boolean;
                    indent?: boolean;
                    highlight?: boolean;
                  }> = [
                    { label: 'Total REVENUE (4*)', value: data.kpi.revenue, bold: true },
                    {
                      label: 'COGS — Material & Pembelian (51*–52*)',
                      subNote: `Opening 520101: ${fmtIdrExact(cogsOpen)} · Closing 520102: ${fmtIdrExact(cogsClose)}`,
                      value: cogsMat,
                      indent: true,
                    },
                    { label: 'COGS — Labour Expense (53*)', value: cogsLab, indent: true },
                    { label: 'COGS — Other COGS (55*)', value: cogsOth, indent: true },
                    { label: 'Total COGS (5*)', value: data.kpi.cogs, bold: true },
                    {
                      label: `GROSS PROFIT (Margin ${data.kpi.grossMarginPct}%)`,
                      value: data.kpi.grossProfit,
                      bold: true,
                    },
                    { label: 'Total OPERATING EXPENSE (6*)', value: data.kpi.opex },
                    { label: 'OPERATIONAL PROFIT (EBIT)', value: data.kpi.operatingProfit, bold: true },
                    { label: 'Total OTHER INCOME (7*)', value: data.kpi.otherIncome },
                    { label: 'Total OTHER EXPENSES (8*)', value: data.kpi.otherExpense },
                    { label: 'NET PROFIT / (LOSS) BEFORE TAX', value: pbt, bold: true },
                    { label: 'Total OCI (93*)', value: ociVal, indent: true },
                    { label: 'INCOME TAXES — Corporate & Deferred (91*–92*)', value: incomeTaxVal, indent: true },
                    { label: 'Total TAXATION & EXTRAORDINARY ITEMS', value: taxExtra },
                    {
                      label: `NET PROFIT / (LOSS) AFTER TAX (${data.kpi.netMarginPct}%)`,
                      value: data.kpi.netIncome,
                      bold: true,
                      highlight: true,
                    },
                  ];

                  return rows.map((row) => (
                    <div
                      key={row.label}
                      className={`px-4 py-2 flex items-center justify-between gap-4 ${
                        row.highlight
                          ? 'bg-[var(--surface-2)] dark:bg-slate-800/70 font-semibold'
                          : row.bold
                            ? 'bg-[var(--surface-2)]/50 dark:bg-slate-900/50 font-semibold'
                            : ''
                      }`}
                    >
                      <div className={row.indent ? 'pl-3' : ''}>
                        <span
                          className={
                            row.indent
                              ? 'text-slate-600 dark:text-slate-400'
                              : 'text-slate-800 dark:text-slate-200'
                          }
                        >
                          {row.label}
                        </span>
                        {row.subNote && (
                          <p className="text-[11px] font-mono text-slate-400 dark:text-slate-500 mt-0.5">
                            {row.subNote}
                          </p>
                        )}
                      </div>
                      <span
                        className={`font-mono tabular-nums whitespace-nowrap ${
                          row.value < 0
                            ? 'text-rose-700 dark:text-rose-400'
                            : row.highlight && row.value > 0
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {fmtIdrExact(row.value)}
                      </span>
                    </div>
                  ));
                })()}
              </div>
            </div>

            {/* Monthly P&L Trend */}
            <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border)] dark:border-slate-800 flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Tren Laba Rugi Bulanan (≥ Maret 2026)
                </h3>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Urut kronologis
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[var(--surface-2)] dark:bg-slate-900/90 border-b border-[var(--border)] dark:border-slate-800 text-slate-500 dark:text-slate-400">
                      <th className="px-3 py-2.5 font-semibold">Bulan</th>
                      <th className="px-3 py-2.5 font-semibold text-right">Revenue</th>
                      <th className="px-3 py-2.5 font-semibold text-right">Total COGS</th>
                      <th className="px-3 py-2.5 font-semibold text-right">Gross Profit</th>
                      <th className="px-3 py-2.5 font-semibold text-right">After Tax</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {data.monthlyPnl.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                          Belum ada transaksi jurnal Laba Rugi sejak 1 Maret 2026 di database yang terhubung.
                        </td>
                      </tr>
                    ) : (
                      data.monthlyPnl.map((m) => (
                        <tr key={m.month} className="hover:bg-[var(--surface-2)] dark:hover:bg-slate-800/40">
                          <td className="px-3 py-2 font-mono font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                            {m.month}
                            {m.revenue > 0 && m.hasOpeningClosingInput === false && (
                              <span
                                title="Opening/Closing Balance (520101/520102) belum diinput bulan ini"
                                className="ml-1.5 text-[10px] font-sans text-amber-600 dark:text-amber-400"
                              >
                                · Berjalan
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100 whitespace-nowrap">
                            {fmtIdr(m.revenue)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap">
                            {fmtIdr(m.cogs)}
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap ${
                              m.grossProfit < 0
                                ? 'text-rose-700 dark:text-rose-400'
                                : 'text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            {fmtIdr(m.grossProfit)}
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                              m.netIncome < 0
                                ? 'text-rose-700 dark:text-rose-400'
                                : 'text-emerald-700 dark:text-emerald-400'
                            }`}
                          >
                            {fmtIdr(m.netIncome)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Detail P&L Accounts */}
          <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border)] dark:border-slate-800">
              <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Rincian Akun Laba Rugi (COA 4*–9* · ≥ Maret 2026)
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[var(--surface-2)] dark:bg-slate-900/90 border-b border-[var(--border)] dark:border-slate-800 text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-2.5 font-semibold">No. Akun</th>
                    <th className="px-4 py-2.5 font-semibold">Nama Akun</th>
                    <th className="px-4 py-2.5 font-semibold">Kelompok</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Debit</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Kredit</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Saldo Bersih</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {data.pnlAccounts.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500 dark:text-slate-400">
                        Belum ada mutasi akun Laba Rugi pada periode ≥ Maret 2026.
                      </td>
                    </tr>
                  ) : (
                    pnlAccountsPaging.paginatedItems.map((acc) => (
                      <tr key={acc.accountNo} className="hover:bg-[var(--surface-2)] dark:hover:bg-slate-800/40">
                        <td className="px-4 py-2 font-mono font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          {acc.accountNo}
                        </td>
                        <td className="px-4 py-2 text-slate-800 dark:text-slate-200">
                          {acc.accountName}
                          {acc.hasAnomaly && (
                            <span className="ml-2 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                              · Anomali overflow
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {acc.section}
                        </td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {fmtIdr(acc.debit)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {fmtIdr(acc.credit)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          {fmtIdr(acc.amount)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <TablePaginationBar {...pnlAccountsPaging.paginationProps} />
          </div>
        </div>
      )}

      {/* Sub-Tab 2: Hutang & Piutang Kumulatif (AR/AP including < March 2026 Carry-Over) */}
      {subTab === 'arap' && (
        <div className="space-y-4">
          {/* AR Aging Strip */}
          <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                {t('erpPanels.finance.arAgingTitle')}
              </h3>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                Total: {fmtIdr(data.arAging.totalAmount)} ({data.arAging.totalCount} faktur · Carry-over &lt; Mar:{' '}
                {data.arAging.carryOverCount} faktur / {fmtIdr(data.arAging.carryOverAmount)})
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 text-xs">
              {[
                { label: 'Belum Jatuh Tempo', bucket: data.arAging.current, tone: 'text-emerald-700 dark:text-emerald-400' },
                { label: 'Lewat 1–30 Hari', bucket: data.arAging.days1to30, tone: 'text-amber-700 dark:text-amber-400' },
                { label: 'Lewat 31–60 Hari', bucket: data.arAging.days31to60, tone: 'text-amber-700 dark:text-amber-400' },
                { label: 'Lewat 61–90 Hari', bucket: data.arAging.days61to90, tone: 'text-rose-700 dark:text-rose-400' },
                { label: 'Lewat > 90 Hari', bucket: data.arAging.over90, tone: 'text-rose-700 dark:text-rose-400' },
              ].map((b) => (
                <div
                  key={b.label}
                  className="p-3 rounded-lg bg-[var(--surface-2)] dark:bg-slate-950/60 border border-[var(--border)]/80 dark:border-slate-800"
                >
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{b.label}</p>
                  <p className={`mt-1 font-mono tabular-nums font-bold ${b.tone}`}>
                    {fmtIdr(b.bucket.amount)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                    {b.bucket.count.toLocaleString('id-ID')} faktur
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* COA Accounts for AR & AP */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border)] dark:border-slate-800">
                <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Akun COA Piutang (1102* · Kumulatif)
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[var(--surface-2)] dark:bg-slate-900/90 border-b border-[var(--border)] dark:border-slate-800 text-slate-500 dark:text-slate-400">
                      <th className="px-3.5 py-2 font-semibold">Akun</th>
                      <th className="px-3.5 py-2 font-semibold text-right">&lt; Mar 2026</th>
                      <th className="px-3.5 py-2 font-semibold text-right">≥ Mar 2026</th>
                      <th className="px-3.5 py-2 font-semibold text-right">Total Saldo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {data.arAccounts.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                          Tidak ada mutasi akun Piutang.
                        </td>
                      </tr>
                    ) : (
                      data.arAccounts.map((a) => (
                        <tr key={a.accountNo} className="hover:bg-[var(--surface-2)] dark:hover:bg-slate-800/40">
                          <td className="px-3.5 py-2">
                            <div className="font-medium text-slate-900 dark:text-slate-100">{a.accountName}</div>
                            <div className="font-mono text-[11px] text-slate-500">{a.accountNo}</div>
                          </td>
                          <td className="px-3.5 py-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap">
                            {fmtIdr(a.carryOverBalance)}
                          </td>
                          <td className="px-3.5 py-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap">
                            {fmtIdr(a.periodBalance)}
                          </td>
                          <td className="px-3.5 py-2 text-right font-mono tabular-nums font-semibold text-[var(--accent-text)] dark:text-[var(--accent)] whitespace-nowrap">
                            {fmtIdr(a.balance)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border)] dark:border-slate-800">
                <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Akun COA Hutang (2101* · Kumulatif)
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[var(--surface-2)] dark:bg-slate-900/90 border-b border-[var(--border)] dark:border-slate-800 text-slate-500 dark:text-slate-400">
                      <th className="px-3.5 py-2 font-semibold">Akun</th>
                      <th className="px-3.5 py-2 font-semibold text-right">&lt; Mar 2026</th>
                      <th className="px-3.5 py-2 font-semibold text-right">≥ Mar 2026</th>
                      <th className="px-3.5 py-2 font-semibold text-right">Total Saldo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {data.apAccounts.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                          Tidak ada mutasi akun Hutang.
                        </td>
                      </tr>
                    ) : (
                      data.apAccounts.map((a) => (
                        <tr key={a.accountNo} className="hover:bg-[var(--surface-2)] dark:hover:bg-slate-800/40">
                          <td className="px-3.5 py-2">
                            <div className="font-medium text-slate-900 dark:text-slate-100">{a.accountName}</div>
                            <div className="font-mono text-[11px] text-slate-500">{a.accountNo}</div>
                          </td>
                          <td className="px-3.5 py-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap">
                            {fmtIdr(a.carryOverBalance)}
                          </td>
                          <td className="px-3.5 py-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap">
                            {fmtIdr(a.periodBalance)}
                          </td>
                          <td className="px-3.5 py-2 text-right font-mono tabular-nums font-semibold text-amber-700 dark:text-amber-400 whitespace-nowrap">
                            {fmtIdr(a.balance)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Top Contacts AR & AP */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border)] dark:border-slate-800">
                <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  {t('erpPanels.finance.topReceivables')}
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[var(--surface-2)] dark:bg-slate-900/90 border-b border-[var(--border)] dark:border-slate-800 text-slate-500 dark:text-slate-400">
                      <th className="px-3.5 py-2 font-semibold">Customer / Kontak</th>
                      <th className="px-3.5 py-2 font-semibold text-right">&lt; Mar 2026</th>
                      <th className="px-3.5 py-2 font-semibold text-right">Total Piutang</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {data.topArContacts.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-4 py-6 text-center text-slate-500">
                          Tidak ada saldo piutang per kontak.
                        </td>
                      </tr>
                    ) : (
                      arContactsPaging.paginatedItems.map((c) => (
                        <tr key={`${c.contactId}-${c.contactCode}`} className="hover:bg-[var(--surface-2)] dark:hover:bg-slate-800/40">
                          <td className="px-3.5 py-2">
                            <div className="font-medium text-slate-900 dark:text-slate-100">{c.contactName}</div>
                            <div className="font-mono text-[11px] text-slate-500">{c.contactCode}</div>
                          </td>
                          <td className="px-3.5 py-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap">
                            {fmtIdr(c.carryOverBalance)}
                          </td>
                          <td className="px-3.5 py-2 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                            {fmtIdr(c.totalBalance)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <TablePaginationBar {...arContactsPaging.paginationProps} compact />
            </div>

            <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border)] dark:border-slate-800">
                <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  {t('erpPanels.finance.topPayables')}
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-[var(--surface-2)] dark:bg-slate-900/90 border-b border-[var(--border)] dark:border-slate-800 text-slate-500 dark:text-slate-400">
                      <th className="px-3.5 py-2 font-semibold">Supplier / Kontak</th>
                      <th className="px-3.5 py-2 font-semibold text-right">&lt; Mar 2026</th>
                      <th className="px-3.5 py-2 font-semibold text-right">Total Hutang</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                    {data.topApContacts.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-4 py-6 text-center text-slate-500">
                          Tidak ada saldo hutang per kontak.
                        </td>
                      </tr>
                    ) : (
                      apContactsPaging.paginatedItems.map((c) => (
                        <tr key={`${c.contactId}-${c.contactCode}`} className="hover:bg-[var(--surface-2)] dark:hover:bg-slate-800/40">
                          <td className="px-3.5 py-2">
                            <div className="font-medium text-slate-900 dark:text-slate-100">{c.contactName}</div>
                            <div className="font-mono text-[11px] text-slate-500">{c.contactCode}</div>
                          </td>
                          <td className="px-3.5 py-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap">
                            {fmtIdr(c.carryOverBalance)}
                          </td>
                          <td className="px-3.5 py-2 text-right font-mono tabular-nums font-semibold text-amber-700 dark:text-amber-400 whitespace-nowrap">
                            {fmtIdr(c.totalBalance)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <TablePaginationBar {...apContactsPaging.paginationProps} compact />
            </div>
          </div>
        </div>
      )}

      {/* Sub-Tab 3: Neraca / Mutasi COA (1* - 3*) */}
      {subTab === 'coa' && (
        <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--border)] dark:border-slate-800 space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Akun Neraca &amp; Nilai Persediaan (COA 1*–3*) · AR/AP Kumulatif &amp; Akun Lainnya ≥ Maret 2026
              </h3>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Akun non-AR/AP mengabaikan transaksi &lt; 2026-03-01
              </span>
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400">
              <strong className="text-slate-800 dark:text-slate-200">Nilai Persediaan, HPP &amp; Neraca (dengan Gudang Intransit):</strong>{' '}
              Secara akuntansi, nilai barang di Gudang Intransit (sudah di-DO, belum di-SI) tetap termasuk dalam saldo persediaan &amp; Neraca hingga Sales Invoice diinput.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[var(--surface-2)] dark:bg-slate-900/90 border-b border-[var(--border)] dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <th className="px-4 py-2.5 font-semibold">No. Akun</th>
                  <th className="px-4 py-2.5 font-semibold">Nama Akun</th>
                  <th className="px-4 py-2.5 font-semibold">Kelompok</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Carry-Over &lt; Mar</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Mutasi ≥ Mar</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Saldo Aktif</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {data.balanceSheetAccounts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                      Tidak ada baris akun Neraca yang sesuai filter.
                    </td>
                  </tr>
                ) : (
                  coaPaging.paginatedItems.map((acc) => (
                    <tr key={acc.accountNo} className="hover:bg-[var(--surface-2)] dark:hover:bg-slate-800/40">
                      <td className="px-4 py-2 font-mono font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {acc.accountNo}
                      </td>
                      <td className="px-4 py-2 text-slate-800 dark:text-slate-200">
                        {acc.accountName}
                        {acc.isArAp && (
                          <span className="ml-2 text-[11px] font-medium text-[var(--accent-text)] dark:text-[var(--accent)]">
                            · Kumulatif AR/AP
                          </span>
                        )}
                        {acc.hasAnomaly && (
                          <span className="ml-2 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                            · Anomali overflow
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {acc.section}
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {acc.isArAp ? fmtIdr(acc.carryOverBalance) : '-'}
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {fmtIdr(acc.periodBalance)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        {fmtIdr(acc.balance)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <TablePaginationBar {...coaPaging.paginationProps} />
        </div>
      )}
    </div>
  );
}
