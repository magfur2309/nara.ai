import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Download,
  FileSpreadsheet,
  Filter,
  Info,
  Link2,
  Loader2,
  MessageSquareText,
  PackageCheck,
  RefreshCw,
  Search,
  ShoppingCart,
  Wallet,
  X,
} from 'lucide-react';
import { fetchApiJson } from '../lib/apiClient';
import { getFreshIdToken } from '../lib/firebase';
import { useI18n } from '../lib/i18n';
import {
  classifyGrnStatusCode,
  classifyStandardStatusCode,
  type GrnStatusChip,
  type PendingNavigationTarget,
  type PendingTransactionsSummaryResponse,
  type StandardDocStatusChip,
} from '../config/pendingTransactionRules';
import { ErpPeriodFilterBar } from './ErpPeriodFilterBar';
import {
  buildGrnStatusChips,
  buildStandardStatusChips,
  ErpStatusBadge,
  ErpStatusFilterBar,
  TablePaginationBar,
  useTablePagination,
} from './ErpStatusFilterBar';

export interface ErpPurchasingKpi {
  glPurchaseDomestic: number;
  glPurchaseImport: number;
  glPurchaseReturn: number;
  glPurchaseDiscount: number;
  glNetPurchase: number;
  glOtherCogsCost: number;
  glTotalPurchasingCogs: number;
  apJournalTotal: number;
  apJournalCarryOver: number;
  apJournalPeriod: number;
  riInvoiceCount: number;
  riDomesticCount: number;
  riImportCount: number;
  riDppIdr: number;
  riTaxIdr: number;
  riTotalIdr: number;
  riPaidIdr: number;
  varianceGlVsRiDpp: number;
  apSubLedgerTotalIdr: number;
  apUnpaidInvoiceCount: number;
  apCarryOverPayableIdr: number;
  apCarryOverUnpaidCount: number;
  apOverdueInvoiceCount: number;
  apOverdueAmountIdr: number;
  poCount: number;
  poTotalIdr: number;
  poOutstandingCount: number;
  grnCount: number;
  prCount: number;
  prOutstandingCount: number;
  returnCountSub: number;
  returnTotalSubIdr: number;
  vpCount: number;
  vpTotalIdr: number;
}

export interface ErpPurchasingMonthlyRow {
  month: string;
  glDomestic: number;
  glImport: number;
  glReturn: number;
  glDiscount: number;
  glNetPurchase: number;
  glOtherCogsCost: number;
  riInvoiceCount: number;
  riDomesticDpp: number;
  riImportDpp: number;
  riDppIdr: number;
  riTaxIdr: number;
  riTotalIdr: number;
  varianceVsRiDpp: number;
}

export interface ErpPurchasingGlAccountRow {
  accountNo: string;
  accountName: string;
  entryCount: number;
  amount: number;
  isCorePurchase: boolean;
}

export interface ErpPurchasingAgingBucket {
  count: number;
  amount: number;
}

export interface ErpPurchasingApAging {
  current: ErpPurchasingAgingBucket;
  days1to30: ErpPurchasingAgingBucket;
  days31to60: ErpPurchasingAgingBucket;
  days61to90: ErpPurchasingAgingBucket;
  over90: ErpPurchasingAgingBucket;
  totalCount: number;
  totalAmount: number;
  carryOverCount: number;
  carryOverAmount: number;
}

export interface ErpPurchasingContactBalance {
  contactId: number;
  contactCode: string;
  contactName: string;
  carryOverBalance: number;
  periodBalance: number;
  totalBalance: number;
}

export interface ErpPurchasingTopSupplier {
  supplierId: number;
  supplierCode: string;
  supplierName: string;
  invoiceCount: number;
  originType: 'Domestic' | 'Import' | 'Domestic & Import';
  totalDppIdr: number;
  totalIdr: number;
  totalPayableIdr: number;
}

export interface ErpPurchasingTopItem {
  itemId: number;
  itemCode: string;
  itemName: string;
  totalQty: number;
  unit: string;
  totalValueIdr: number;
  invoiceCount: number;
}

export interface ErpRelatedDocRef {
  type: 'PR' | 'PO' | 'GRN' | 'RI' | 'VP';
  id: number;
  docNo: string;
  date: string;
  statusCode: number;
  statusLabel: string;
  totalIdr?: number;
}

export interface ErpPurchasingInvoiceRow {
  id: number;
  docNo: string;
  refNo: string;
  date: string;
  dueDate: string;
  supplierName: string;
  originType: 'Domestic' | 'Import';
  warehouse: string;
  currency: string;
  kurs: number;
  dppIdr: number;
  taxIdr: number;
  totalOrig: number;
  totalIdr: number;
  paidIdr: number;
  balanceIdr: number;
  isPaid: boolean;
  isOverdue: boolean;
  isCarryOver: boolean;
  statusCode: number;
  statusLabel: string;
  relatedPrs?: ErpRelatedDocRef[];
  relatedPos?: ErpRelatedDocRef[];
  relatedGrns?: ErpRelatedDocRef[];
  relatedVps?: ErpRelatedDocRef[];
}

export interface ErpPurchasingOrderRow {
  id: number;
  docNo: string;
  date: string;
  expectedDate: string;
  supplierName: string;
  originType: 'Domestic' | 'Import';
  warehouse: string;
  currency: string;
  kurs: number;
  totalIdr: number;
  statusGrn: number;
  statusRi: number;
  isClosed: boolean;
  statusCode: number;
  statusLabel: string;
  relatedPrs?: ErpRelatedDocRef[];
  relatedGrns?: ErpRelatedDocRef[];
  relatedRis?: ErpRelatedDocRef[];
  relatedVps?: ErpRelatedDocRef[];
}

export interface ErpPurchasingGrnRow {
  id: number;
  docNo: string;
  date: string;
  supplierName: string;
  warehouse: string;
  totalIdr: number;
  statusCode: number;
  statusLabel: string;
  statusRi?: number;
  relatedPrs?: ErpRelatedDocRef[];
  relatedPos?: ErpRelatedDocRef[];
  relatedRis?: ErpRelatedDocRef[];
}

export interface ErpPurchasingPrRow {
  id: number;
  docNo: string;
  date: string;
  neededDate: string;
  description: string;
  warehouse: string;
  totalIdr: number;
  statusPo: number;
  statusCode: number;
  statusLabel: string;
  relatedPos?: ErpRelatedDocRef[];
  relatedGrns?: ErpRelatedDocRef[];
  relatedRis?: ErpRelatedDocRef[];
}

export interface ErpPurchasingQueryResult {
  cutoffDate: string;
  period: {
    dateFrom: string;
    dateTo: string;
  };
  kpi: ErpPurchasingKpi;
  monthlyReconciliation: ErpPurchasingMonthlyRow[];
  glPurchasingAccounts: ErpPurchasingGlAccountRow[];
  apAging: ErpPurchasingApAging;
  topApContactsGl: ErpPurchasingContactBalance[];
  topSuppliers: ErpPurchasingTopSupplier[];
  topItems: ErpPurchasingTopItem[];
  invoices: ErpPurchasingInvoiceRow[];
  unpaidInvoices: ErpPurchasingInvoiceRow[];
  purchaseOrders: ErpPurchasingOrderRow[];
  goodsReceipts: ErpPurchasingGrnRow[];
  purchaseRequests: ErpPurchasingPrRow[];
  relationsSupported?: boolean;
  fetchedAt: string;
}

interface RelatedTxModalContext {
  sourceType: 'PR' | 'PO' | 'GRN' | 'RI';
  docNo: string;
  date: string;
  subtitle: string;
  totalIdr: number;
  statusCode: number;
  statusLabel: string;
  isClosed?: boolean;
  relatedPrs: ErpRelatedDocRef[];
  relatedPos: ErpRelatedDocRef[];
  relatedGrns: ErpRelatedDocRef[];
  relatedRis: ErpRelatedDocRef[];
  relatedVps: ErpRelatedDocRef[];
}

interface ErpPurchasingPanelProps {
  idToken: string;
  onAskAiQuestion: (question: string) => void;
  onDownloadBridge: () => void;
  pendingSummary?: PendingTransactionsSummaryResponse | null;
  pendingNavTarget?: PendingNavigationTarget | null;
  onClearPendingNav?: () => void;
}

type PurchasingTab = 'reconciliation' | 'invoices' | 'ap' | 'po' | 'grn_pr';
type PeriodPreset = 'active_all' | 'year_2026' | 'mar_2026' | 'apr_2026' | 'this_month' | 'last_month' | 'custom';

const ACTIVE_CUTOFF_DATE = '2026-03-01';

function formatIdrExact(val: number): string {
  const n = Number(val || 0);
  const abs = Math.abs(n).toLocaleString('id-ID', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `-Rp ${abs}` : `Rp ${abs}`;
}

function formatIdr(val: number): string {
  const n = Math.round(Number(val || 0));
  const abs = Math.abs(n).toLocaleString('id-ID');
  return n < 0 ? `-Rp ${abs}` : `Rp ${abs}`;
}

function formatPct(part: number, total: number): string {
  if (!total || total === 0) return '0,0%';
  return `${((part / total) * 100).toLocaleString('id-ID', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function getPresetDates(preset: Exclude<PeriodPreset, 'custom'>): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  if (preset === 'active_all') {
    return { dateFrom: ACTIVE_CUTOFF_DATE, dateTo: '' };
  }
  if (preset === 'year_2026') {
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
    return {
      dateFrom: start >= ACTIVE_CUTOFF_DATE ? start : ACTIVE_CUTOFF_DATE,
      dateTo: ymd(now),
    };
  }
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  const f = ymd(prevStart);
  const t = ymd(prevEnd);
  return {
    dateFrom: f >= ACTIVE_CUTOFF_DATE ? f : ACTIVE_CUTOFF_DATE,
    dateTo: t >= ACTIVE_CUTOFF_DATE ? t : '',
  };
}

function escapeCsv(val: string | number): string {
  const s = String(val ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportPurchasingCsv(
  data: ErpPurchasingQueryResult,
  tab: PurchasingTab,
  filteredOverrides?: {
    invoices?: ErpPurchasingInvoiceRow[];
    unpaidInvoices?: ErpPurchasingInvoiceRow[];
    purchaseOrders?: ErpPurchasingOrderRow[];
    goodsReceipts?: ErpPurchasingGrnRow[];
  }
): void {
  let headers: string[] = [];
  let rows: (string | number)[][] = [];
  let filePrefix = 'purchasing-rekonsiliasi-lk';

  if (tab === 'reconciliation') {
    headers = [
      'Bulan',
      'Purchase Domestic LK (520105)',
      'Purchase Import LK (520104)',
      'Purchase Return LK (510103)',
      'Purchase Discount LK (510102)',
      'Pembelian Bersih LK',
      'Beban COGS Pembelian Lainnya',
      'Jml Faktur',
      'DPP Faktur (IDR)',
      'PPN Faktur (IDR)',
      'Total Faktur (IDR)',
      'Selisih LK vs DPP Faktur',
    ];
    rows = data.monthlyReconciliation.map((m) => [
      m.month,
      m.glDomestic.toFixed(2),
      m.glImport.toFixed(2),
      m.glReturn.toFixed(2),
      m.glDiscount.toFixed(2),
      m.glNetPurchase.toFixed(2),
      m.glOtherCogsCost.toFixed(2),
      m.riInvoiceCount,
      m.riDppIdr.toFixed(2),
      m.riTaxIdr.toFixed(2),
      m.riTotalIdr.toFixed(2),
      m.varianceVsRiDpp.toFixed(2),
    ]);
  } else if (tab === 'invoices' || tab === 'ap') {
    filePrefix = tab === 'ap' ? 'purchasing-hutang-ap-m4ri' : 'purchasing-faktur-m4ri';
    const list =
      tab === 'ap'
        ? (filteredOverrides?.unpaidInvoices ?? data.unpaidInvoices)
        : (filteredOverrides?.invoices ?? data.invoices);
    headers = [
      'No Faktur',
      'No Referensi',
      'Tanggal',
      'Jatuh Tempo',
      'Supplier',
      'Asal',
      'Gudang',
      'Mata Uang',
      'Kurs',
      'DPP (IDR)',
      'PPN/Pajak (IDR)',
      'Total (IDR)',
      'Terbayar (IDR)',
      'Sisa Hutang (IDR)',
      'Status Lunas',
      'Status Dokumen',
    ];
    rows = list.map((inv) => [
      inv.docNo,
      inv.refNo,
      inv.date,
      inv.dueDate,
      inv.supplierName,
      inv.originType,
      inv.warehouse,
      inv.currency,
      inv.kurs,
      inv.dppIdr.toFixed(2),
      inv.taxIdr.toFixed(2),
      inv.totalIdr.toFixed(2),
      inv.paidIdr.toFixed(2),
      inv.balanceIdr.toFixed(2),
      inv.isPaid ? 'Lunas' : inv.isOverdue ? 'Jatuh Tempo' : 'Belum Lunas',
      inv.statusLabel,
    ]);
  } else if (tab === 'po') {
    filePrefix = 'purchasing-po-m4po';
    const poList = filteredOverrides?.purchaseOrders ?? data.purchaseOrders;
    headers = [
      'No PO',
      'Tanggal',
      'Target Dipenuhi',
      'Supplier',
      'Asal',
      'Gudang',
      'Mata Uang',
      'Kurs',
      'Total (IDR)',
      'Status GRN',
      'Status RI',
      'Status Dokumen',
    ];
    rows = poList.map((po) => [
      po.docNo,
      po.date,
      po.expectedDate,
      po.supplierName,
      po.originType,
      po.warehouse,
      po.currency,
      po.kurs,
      po.totalIdr.toFixed(2),
      po.statusGrn ? 'Sudah GRN' : 'Belum GRN',
      po.statusRi ? 'Sudah RI' : 'Belum RI',
      po.statusLabel,
    ]);
  } else {
    filePrefix = 'purchasing-grn-m4grn';
    const grnList = filteredOverrides?.goodsReceipts ?? data.goodsReceipts;
    headers = ['No GRN', 'Tanggal', 'Supplier', 'Gudang', 'Total (IDR)', 'Status'];
    rows = grnList.map((g) => [
      g.docNo,
      g.date,
      g.supplierName,
      g.warehouse,
      g.totalIdr.toFixed(2),
      g.statusLabel,
    ]);
  }

  const csvLines = [headers.join(','), ...rows.map((r) => r.map(escapeCsv).join(','))];
  const blob = new Blob([`\uFEFF${csvLines.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filePrefix}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ErpPurchasingPanel({
  idToken,
  onAskAiQuestion,
  onDownloadBridge,
  pendingSummary,
  pendingNavTarget,
  onClearPendingNav,
}: ErpPurchasingPanelProps) {
  const { t } = useI18n();
  const [data, setData] = useState<ErpPurchasingQueryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<PurchasingTab>('reconciliation');
  const [invoiceStatusChip, setInvoiceStatusChip] = useState<StandardDocStatusChip>('all');
  const [apStatusChip, setApStatusChip] = useState<StandardDocStatusChip>('all');
  const [poStatusChip, setPoStatusChip] = useState<StandardDocStatusChip>('all');
  const [grnStatusChip, setGrnStatusChip] = useState<GrnStatusChip>('all');
  const [prStatusChip, setPrStatusChip] = useState<StandardDocStatusChip>('all');
  const [pendingRuleId, setPendingRuleId] = useState<string | null>(null);
  const [preset, setPreset] = useState<PeriodPreset>('active_all');
  const [dateFrom, setDateFrom] = useState(ACTIVE_CUTOFF_DATE);
  const [dateTo, setDateTo] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [relatedModal, setRelatedModal] = useState<RelatedTxModalContext | null>(null);

  const fetchPurchasing = useCallback(
    async (opts?: { q?: string; dateFrom?: string; dateTo?: string; refresh?: boolean }) => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const token = await getFreshIdToken(idToken);
        const qs = new URLSearchParams();
        const safeFrom =
          opts?.dateFrom && opts.dateFrom >= ACTIVE_CUTOFF_DATE
            ? opts.dateFrom
            : ACTIVE_CUTOFF_DATE;
        qs.set('dateFrom', safeFrom);
        if (opts?.dateTo) qs.set('dateTo', opts.dateTo);
        if (opts?.q) qs.set('q', opts.q);
        if (opts?.refresh) qs.set('refresh', '1');
        qs.set('limit', '100');

        const res = await fetchApiJson<ErpPurchasingQueryResult>(
          `/api/erp/purchasing?${qs.toString()}`,
          {
            cache: 'no-store',
            headers: { Authorization: `Bearer ${token}` },
          },
          'Gagal memuat data Pembelian dari ERP.'
        );
        setData(res);
      } catch (err) {
        setErrorMsg(
          err instanceof Error ? err.message : 'Gagal memuat data Pembelian dari ERP.'
        );
      } finally {
        setLoading(false);
      }
    },
    [idToken]
  );

  useEffect(() => {
    void fetchPurchasing({ dateFrom: ACTIVE_CUTOFF_DATE });
  }, [fetchPurchasing]);

  const handleJumpToRelatedDoc = useCallback(
    (doc: ErpRelatedDocRef) => {
      if (doc.type === 'VP') return;
      setRelatedModal(null);
      setPendingRuleId(null);
      setInvoiceStatusChip('all');
      setApStatusChip('all');
      setPoStatusChip('all');
      setGrnStatusChip('all');
      setPrStatusChip('all');
      if (doc.type === 'PO') setActiveTab('po');
      else if (doc.type === 'RI') setActiveTab('invoices');
      else setActiveTab('grn_pr');
      setSearchInput(doc.docNo);
      setAppliedSearch(doc.docNo);
      void fetchPurchasing({ q: doc.docNo, dateFrom: ACTIVE_CUTOFF_DATE, dateTo: '' });
    },
    [fetchPurchasing]
  );

  const invoiceChipCounts = useMemo(() => {
    const rows = data?.invoices || [];
    const counts = { all: rows.length, need_approve: 0, approved: 0, in_progress: 0, completed: 0 };
    for (const inv of rows) {
      const cls = classifyStandardStatusCode(inv.statusCode);
      if (cls !== 'excluded') counts[cls]++;
    }
    return counts;
  }, [data?.invoices]);

  const baseUnpaidInvoices = useMemo(() => {
    const rows = data?.unpaidInvoices || [];
    if (pendingRuleId === 'purchasing_ri_pending_vp') {
      return rows.filter(
        (inv) =>
          inv.date >= ACTIVE_CUTOFF_DATE &&
          (inv.statusCode === 2 || inv.statusCode === 3) &&
          inv.balanceIdr > 0
      );
    }
    return rows;
  }, [data?.unpaidInvoices, pendingRuleId]);

  const apChipCounts = useMemo(() => {
    const counts = {
      all: baseUnpaidInvoices.length,
      need_approve: 0,
      approved: 0,
      in_progress: 0,
      completed: 0,
    };
    for (const inv of baseUnpaidInvoices) {
      const cls = classifyStandardStatusCode(inv.statusCode);
      if (cls !== 'excluded') counts[cls]++;
    }
    return counts;
  }, [baseUnpaidInvoices]);

  const poChipCounts = useMemo(() => {
    const rows = data?.purchaseOrders || [];
    const counts = { all: rows.length, need_approve: 0, approved: 0, in_progress: 0, completed: 0 };
    for (const po of rows) {
      const cls = classifyStandardStatusCode(po.statusCode, po.isClosed);
      if (cls !== 'excluded') counts[cls]++;
    }
    return counts;
  }, [data?.purchaseOrders]);

  const grnChipCounts = useMemo(() => {
    const rows = data?.goodsReceipts || [];
    const counts = { all: rows.length, belum_ri: 0, completed: 0 };
    for (const g of rows) {
      const cls = classifyGrnStatusCode(g.statusCode);
      if (cls !== 'excluded') counts[cls]++;
    }
    return counts;
  }, [data?.goodsReceipts]);

  const prChipCounts = useMemo(() => {
    const rows = data?.purchaseRequests || [];
    const counts = { all: rows.length, need_approve: 0, approved: 0, in_progress: 0, completed: 0 };
    for (const pr of rows) {
      const cls = classifyStandardStatusCode(pr.statusCode);
      if (cls !== 'excluded') counts[cls]++;
    }
    return counts;
  }, [data?.purchaseRequests]);

  const displayedInvoices = useMemo(() => {
    const rows = data?.invoices || [];
    if (invoiceStatusChip === 'all') return rows;
    return rows.filter((inv) => classifyStandardStatusCode(inv.statusCode) === invoiceStatusChip);
  }, [data?.invoices, invoiceStatusChip]);

  const displayedPurchaseOrders = useMemo(() => {
    const rows = data?.purchaseOrders || [];
    if (poStatusChip === 'all') return rows;
    return rows.filter(
      (po) => classifyStandardStatusCode(po.statusCode, po.isClosed) === poStatusChip
    );
  }, [data?.purchaseOrders, poStatusChip]);

  const displayedGoodsReceipts = useMemo(() => {
    const rows = data?.goodsReceipts || [];
    if (grnStatusChip === 'all') return rows;
    return rows.filter((g) => classifyGrnStatusCode(g.statusCode) === grnStatusChip);
  }, [data?.goodsReceipts, grnStatusChip]);

  const displayedPurchaseRequests = useMemo(() => {
    const rows = data?.purchaseRequests || [];
    if (prStatusChip === 'all') return rows;
    return rows.filter((pr) => classifyStandardStatusCode(pr.statusCode) === prStatusChip);
  }, [data?.purchaseRequests, prStatusChip]);

  const displayedUnpaidInvoices = useMemo(() => {
    if (apStatusChip === 'all') return baseUnpaidInvoices;
    return baseUnpaidInvoices.filter(
      (inv) => classifyStandardStatusCode(inv.statusCode) === apStatusChip
    );
  }, [baseUnpaidInvoices, apStatusChip]);

  const invoicesPaging = useTablePagination(displayedInvoices, {
    defaultPageSize: 20,
    storageKey: 'erp_purchasing_invoices',
  });
  const unpaidPaging = useTablePagination(displayedUnpaidInvoices, {
    defaultPageSize: 20,
    storageKey: 'erp_purchasing_unpaid',
  });
  const poPaging = useTablePagination(displayedPurchaseOrders, {
    defaultPageSize: 20,
    storageKey: 'erp_purchasing_po',
  });
  const grnPaging = useTablePagination(displayedGoodsReceipts, {
    defaultPageSize: 20,
    storageKey: 'erp_purchasing_grn',
  });
  const prPaging = useTablePagination(displayedPurchaseRequests, {
    defaultPageSize: 20,
    storageKey: 'erp_purchasing_pr',
  });

  const { setPage: setInvoicesPage } = invoicesPaging;
  const { setPage: setUnpaidPage } = unpaidPaging;
  const { setPage: setPoPage } = poPaging;
  const { setPage: setGrnPage } = grnPaging;
  const { setPage: setPrPage } = prPaging;

  useEffect(() => {
    if (!pendingNavTarget || pendingNavTarget.module !== 'purchasing') return;
    if (
      pendingNavTarget.subTab === 'po' ||
      pendingNavTarget.subTab === 'grn_pr' ||
      pendingNavTarget.subTab === 'ap'
    ) {
      setActiveTab(pendingNavTarget.subTab);
    }
    setPendingRuleId(pendingNavTarget.ruleId);

    if (pendingNavTarget.filterKey === 'pending_po_need_approve') {
      setPoStatusChip('need_approve');
      setPoPage(1);
    } else if (pendingNavTarget.filterKey === 'pending_po_approved') {
      setPoStatusChip('approved');
      setPoPage(1);
    } else if (pendingNavTarget.filterKey === 'pending_po_in_progress') {
      setPoStatusChip('in_progress');
      setPoPage(1);
    } else if (pendingNavTarget.filterKey === 'pending_grn_ri') {
      setGrnStatusChip('belum_ri');
      setGrnPage(1);
    } else if (pendingNavTarget.filterKey === 'pending_pr_po') {
      setPrStatusChip('approved');
      setPrPage(1);
    } else if (pendingNavTarget.filterKey === 'pending_ri_vp') {
      setUnpaidPage(1);
    }
  }, [pendingNavTarget, setGrnPage, setPoPage, setPrPage, setUnpaidPage]);

  const clearPendingFilter = () => {
    setInvoiceStatusChip('all');
    setApStatusChip('all');
    setPoStatusChip('all');
    setGrnStatusChip('all');
    setPrStatusChip('all');
    setInvoicesPage(1);
    setUnpaidPage(1);
    setPoPage(1);
    setGrnPage(1);
    setPrPage(1);
    setPendingRuleId(null);
    onClearPendingNav?.();
  };

  const paginatedPurchaseOrders = poPaging.paginatedItems;
  const paginatedGoodsReceipts = grnPaging.paginatedItems;
  const paginatedPurchaseRequests = prPaging.paginatedItems;

  const applyPreset = (p: Exclude<PeriodPreset, 'custom'>) => {
    setPreset(p);
    const range = getPresetDates(p);
    setDateFrom(range.dateFrom);
    setDateTo(range.dateTo);
    setInvoicesPage(1);
    setUnpaidPage(1);
    setPoPage(1);
    setGrnPage(1);
    setPrPage(1);
    void fetchPurchasing({ q: appliedSearch, dateFrom: range.dateFrom, dateTo: range.dateTo });
  };

  const handleFilterSubmit = () => {
    const cleaned = searchInput.trim();
    const safeFrom = dateFrom && dateFrom >= ACTIVE_CUTOFF_DATE ? dateFrom : ACTIVE_CUTOFF_DATE;
    setDateFrom(safeFrom);
    setAppliedSearch(cleaned);
    setInvoicesPage(1);
    setUnpaidPage(1);
    setPoPage(1);
    setGrnPage(1);
    setPrPage(1);
    void fetchPurchasing({ q: cleaned, dateFrom: safeFrom, dateTo });
  };

  const handleClearSearch = () => {
    const safeFrom = dateFrom && dateFrom >= ACTIVE_CUTOFF_DATE ? dateFrom : ACTIVE_CUTOFF_DATE;
    setSearchInput('');
    setAppliedSearch('');
    setInvoicesPage(1);
    setUnpaidPage(1);
    setPoPage(1);
    setGrnPage(1);
    setPrPage(1);
    void fetchPurchasing({ q: '', dateFrom: safeFrom, dateTo });
  };

  const handleSearchChange = (nextValue: string) => {
    setSearchInput(nextValue);
    if (nextValue.trim() === '' && appliedSearch !== '') {
      const safeFrom = dateFrom && dateFrom >= ACTIVE_CUTOFF_DATE ? dateFrom : ACTIVE_CUTOFF_DATE;
      setAppliedSearch('');
      setInvoicesPage(1);
      setUnpaidPage(1);
      setPoPage(1);
      setGrnPage(1);
      setPrPage(1);
      void fetchPurchasing({ q: '', dateFrom: safeFrom, dateTo });
    }
  };

  const handleFilterReset = () => {
    setPreset('active_all');
    setDateFrom(ACTIVE_CUTOFF_DATE);
    setDateTo('');
    setSearchInput('');
    setAppliedSearch('');
    setInvoiceStatusChip('all');
    setApStatusChip('all');
    setPoStatusChip('all');
    setGrnStatusChip('all');
    setPrStatusChip('all');
    setInvoicesPage(1);
    setUnpaidPage(1);
    setPoPage(1);
    setGrnPage(1);
    setPrPage(1);
    setPendingRuleId(null);
    void fetchPurchasing({ q: '', dateFrom: ACTIVE_CUTOFF_DATE, dateTo: '' });
  };

  if (loading && !data) {
    return (
      <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl p-10 flex items-center justify-center gap-2.5 text-sm text-slate-600 dark:text-slate-400">
        <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-text)] dark:text-[var(--accent)]" />
        <span>Memuat data Purchasing (m4_* &amp; Rekonsiliasi Laporan Keuangan)...</span>
      </div>
    );
  }

  if (errorMsg && !data) {
    const isServerWarmupError = /Starting Server|memulai ulang|HTTP 200.*HTML|HTML.*bukan JSON/i.test(errorMsg);
    const needsUpgrade = !isServerWarmupError && /404|Endpoint tidak ditemukan|\/purchasing/i.test(errorMsg);
    return (
      <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl p-5 space-y-3 text-xs">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              {isServerWarmupError
                ? 'Server Aplikasi Sedang Memulai Ulang'
                : needsUpgrade
                  ? 'Bridge Lokal Perlu Diperbarui ke Versi v5 untuk Modul Pembelian'
                  : 'Data Pembelian ERP belum dapat dimuat'}
            </p>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed">{errorMsg}</p>
            {needsUpgrade && (
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                Unduh <code>erp-mysql-bridge.mjs</code> versi terbaru (<strong>Bridge v5</strong>), hentikan proses node lama (<code>Ctrl+C</code>), lalu jalankan ulang <code>node erp-mysql-bridge.mjs</code> agar endpoint <code>/purchasing</code> dan perbaikan <code>/assets</code> aktif bersamaan.
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isServerWarmupError && (
            <button
              type="button"
              onClick={onDownloadBridge}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Unduh Bridge v5 (.mjs)</span>
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              void fetchPurchasing({ q: appliedSearch, dateFrom, dateTo, refresh: true })
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2 font-medium text-slate-700 dark:text-slate-200 bg-[var(--surface-3)] dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Coba Muat Ulang</span>
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { kpi } = data;
  const domesticShare = formatPct(kpi.glPurchaseDomestic, kpi.glNetPurchase);
  const importShare = formatPct(kpi.glPurchaseImport, kpi.glNetPurchase);
  const isGlExactMatchNote = Math.abs(kpi.varianceGlVsRiDpp) < 1;

  return (
    <div className="space-y-4">
      {errorMsg && (
        <div className="bg-[var(--danger-soft)] dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/70 rounded-lg px-4 py-2.5 text-xs text-rose-900 dark:text-rose-200">
          {errorMsg}
        </div>
      )}

      {/* Source-of-Truth Financial Accuracy Banner */}
      <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl px-4 py-3 text-xs text-slate-700 dark:text-slate-300 space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>
              <strong>Rekonsiliasi 100% Laporan Keuangan:</strong> Total Pembelian Bersih, Domestic (
              <code className="font-mono">520105</code>), Import (
              <code className="font-mono">520104</code>), Return (
              <code className="font-mono">510103</code>), dan Discount (
              <code className="font-mono">510102</code>) diambil langsung dari Buku Besar mulai{' '}
              <strong className="font-mono text-slate-900 dark:text-slate-100">1 Maret 2026</strong>
              , dilengkapi rincian operasional Faktur Pembelian, Purchase Order, Penerimaan Barang, dan Permintaan Pembelian.
            </span>
          </div>
          <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
            Live: {new Date(data.fetchedAt).toLocaleTimeString('id-ID')}
          </span>
        </div>
        <div className="pl-6 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
          <span>
            Hutang Supplier / AP (<code className="font-mono">210101* &amp; 210103*</code> + Faktur Pembelian belum lunas) dihitung{' '}
            <strong className="text-slate-700 dark:text-slate-300">kumulatif penuh</strong> termasuk saldo carry-over sebelum Maret 2026.
          </span>
          {!isGlExactMatchNote && (
            <span>
              Selisih LK vs DPP Faktur:{' '}
              <strong className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                {formatIdrExact(kpi.varianceGlVsRiDpp)}
              </strong>{' '}
              (jurnal penyesuaian / saldo awal Maret 2026)
            </span>
          )}
        </div>
      </div>

      {/* 4-Column Authoritative KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Total Pembelian Bersih (LK)
          </p>
          <p className="mt-1 font-mono tabular-nums text-xl font-bold text-slate-900 dark:text-slate-100">
            {formatIdrExact(kpi.glNetPurchase)}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            Return/Disc: {formatIdrExact(kpi.glPurchaseReturn + kpi.glPurchaseDiscount)} · +COGS Lain:{' '}
            {formatIdr(kpi.glTotalPurchasingCogs)}
          </p>
        </div>

        <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Purchase Domestic (520105)
            </p>
            <span className="font-mono tabular-nums text-[11px] font-semibold text-[var(--accent-text)] dark:text-[var(--accent)]">
              {domesticShare}
            </span>
          </div>
          <p className="mt-1 font-mono tabular-nums text-xl font-bold text-slate-900 dark:text-slate-100">
            {formatIdrExact(kpi.glPurchaseDomestic)}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            Sub-ledger: {kpi.riDomesticCount.toLocaleString('id-ID')} faktur lokal
          </p>
        </div>

        <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Purchase Import (520104)
            </p>
            <span className="font-mono tabular-nums text-[11px] font-semibold text-indigo-700 dark:text-indigo-400">
              {importShare}
            </span>
          </div>
          <p className="mt-1 font-mono tabular-nums text-xl font-bold text-slate-900 dark:text-slate-100">
            {formatIdrExact(kpi.glPurchaseImport)}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            Sub-ledger: {kpi.riImportCount.toLocaleString('id-ID')} faktur impor
          </p>
        </div>

        <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Hutang Supplier / AP (Kumulatif)
          </p>
          <p
            className={`mt-1 font-mono tabular-nums text-xl font-bold ${
              kpi.apJournalTotal > 0
                ? 'text-amber-700 dark:text-amber-400'
                : 'text-emerald-700 dark:text-emerald-400'
            }`}
          >
            {formatIdrExact(kpi.apJournalTotal)}
          </p>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            Faktur belum lunas: {kpi.apUnpaidInvoiceCount.toLocaleString('id-ID')} faktur (Overdue:{' '}
            <span
              className={
                kpi.apOverdueInvoiceCount > 0
                  ? 'text-rose-700 dark:text-rose-400 font-semibold'
                  : ''
              }
            >
              {kpi.apOverdueInvoiceCount.toLocaleString('id-ID')}
            </span>
            )
          </p>
        </div>
      </div>

      {/* Quick Tanya AI Bar */}
      <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
          <MessageSquareText className="w-4 h-4 text-[var(--accent-text)] dark:text-[var(--accent)] shrink-0" />
          <span>Analisis data Purchasing &amp; rekonsiliasi LK langsung lewat Tanya AI:</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[
            'Ringkas pembelian Domestic, Import, dan total bersih per bulan sesuai Laporan Keuangan',
            'Siapa 10 supplier dengan nilai pembelian terbesar sejak Maret 2026?',
            'Daftar hutang supplier (AP) yang belum lunas dan jatuh tempo beserta aging-nya',
            'Rekap Purchase Order (PO) dan Purchase Request (PR) yang masih outstanding',
          ].map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => onAskAiQuestion(prompt)}
              className="px-3 py-1.5 text-xs font-medium text-[var(--accent-text)] dark:text-[var(--accent)] bg-[var(--accent-soft)] dark:bg-[var(--accent-soft)] hover:bg-[var(--accent-soft)] dark:hover:bg-[var(--accent-soft)] border border-[var(--accent)]/40 dark:border-[var(--accent)]/40 rounded-lg transition-colors cursor-pointer text-left"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>

      {/* Filter Bar + Sub-Tab Navigation + Data Container */}
      <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl overflow-hidden">
        {/* Period Dropdowns & Search Controls */}
        <ErpPeriodFilterBar
          embedded
          dateFrom={dateFrom}
          dateTo={dateTo}
          minDate={ACTIVE_CUTOFF_DATE}
          searchValue={searchInput}
          appliedSearchValue={appliedSearch}
          searchPlaceholder="Cari no. faktur/PO/GRN/PR, nama supplier, referensi, atau gudang..."
          loading={loading}
          extraActions={
            <button
              type="button"
              onClick={() =>
                exportPurchasingCsv(data, activeTab, {
                  invoices: displayedInvoices,
                  unpaidInvoices: displayedUnpaidInvoices,
                  purchaseOrders: displayedPurchaseOrders,
                  goodsReceipts: displayedGoodsReceipts,
                })
              }
              className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-[var(--text)] bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--text-muted)] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Ekspor CSV</span>
            </button>
          }
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
            void fetchPurchasing({ q: currentQ, dateFrom, dateTo, refresh: true });
          }}
        />

        {/* Sub-Tabs */}
        <div className="px-4 pt-2 border-b border-[var(--border)] dark:border-slate-800 flex items-center gap-1 overflow-x-auto">
          {(
            [
              {
                id: 'reconciliation',
                label: t('erpPanels.purchasing.tabSummary'),
                icon: FileSpreadsheet,
              },
              {
                id: 'invoices',
                label: t('erpPanels.purchasing.tabInvoices', {
                  count: kpi.riInvoiceCount.toLocaleString('id-ID'),
                }),
                icon: ShoppingCart,
              },
              {
                id: 'ap',
                label: t('erpPanels.purchasing.tabPayables', {
                  count: kpi.apUnpaidInvoiceCount.toLocaleString('id-ID'),
                }),
                icon: Wallet,
              },
              {
                id: 'po',
                label: t('erpPanels.purchasing.tabPo', {
                  count: kpi.poCount.toLocaleString('id-ID'),
                }),
                icon: ClipboardList,
              },
              {
                id: 'grn_pr',
                label: t('erpPanels.purchasing.tabGrnPr', {
                  count: `${kpi.grnCount.toLocaleString('id-ID')} / ${kpi.prCount.toLocaleString('id-ID')}`,
                }),
                icon: PackageCheck,
              },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'border-[var(--accent)]/40 dark:border-[var(--accent)]/40 text-[var(--accent-text)] dark:text-[var(--accent)]'
                    : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* TAB 1: RINGKASAN & REKONSILIASI LAPORAN KEUANGAN */}
        {activeTab === 'reconciliation' && (
          <div className="p-4 space-y-6">
            {/* Monthly Financial Reconciliation Table */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {t('erpPanels.purchasing.monthlyRecap')}
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Kolom Domestic, Import, Return/Disc, dan Pembelian Bersih diambil langsung dari Buku Besar agar cocok hingga sen dengan Laporan Laba Rugi.
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto border border-[var(--border)] dark:border-slate-800 rounded-lg">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="bg-[var(--surface-2)] dark:bg-slate-900 border-b border-[var(--border)] dark:border-slate-800 text-slate-600 dark:text-slate-400">
                      <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Bulan</th>
                      <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">
                        Domestic (520105)
                      </th>
                      <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">
                        Import (520104)
                      </th>
                      <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">
                        Return / Disc
                      </th>
                      <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">
                        Pembelian Bersih (LK)
                      </th>
                      <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">
                        {t('erpPanels.purchasing.colInvoiceCount')}
                      </th>
                      <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">
                        {t('erpPanels.purchasing.colDpp')}
                      </th>
                      <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">
                        {t('erpPanels.purchasing.colDiff')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 tabular-nums">
                    {data.monthlyReconciliation.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="px-4 py-8 text-center text-slate-500 dark:text-slate-400"
                        >
                          Belum ada transaksi pembelian tercatat pada periode yang dipilih.
                        </td>
                      </tr>
                    ) : (
                      data.monthlyReconciliation.map((row) => {
                        const retDisc = row.glReturn + row.glDiscount;
                        const nearZeroVar = Math.abs(row.varianceVsRiDpp) < 1;
                        return (
                          <tr
                            key={row.month}
                            className="hover:bg-[var(--surface-2)] dark:hover:bg-slate-800/40"
                          >
                            <td className="px-3 py-2.5 font-mono font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                              {row.month}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-slate-800 dark:text-slate-200 whitespace-nowrap">
                              {formatIdrExact(row.glDomestic)}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-slate-800 dark:text-slate-200 whitespace-nowrap">
                              {formatIdrExact(row.glImport)}
                            </td>
                            <td
                              className={`px-3 py-2.5 text-right font-mono whitespace-nowrap ${
                                retDisc < 0
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              {formatIdrExact(retDisc)}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                              {formatIdrExact(row.glNetPurchase)}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                              {row.riInvoiceCount.toLocaleString('id-ID')}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                              {formatIdrExact(row.riDppIdr)}
                            </td>
                            <td
                              className={`px-3 py-2.5 text-right font-mono whitespace-nowrap ${
                                nearZeroVar
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : 'text-amber-700 dark:text-amber-400'
                              }`}
                            >
                              {nearZeroVar ? 'Rp 0,00' : formatIdrExact(row.varianceVsRiDpp)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                  {data.monthlyReconciliation.length > 0 && (
                    <tfoot>
                      <tr className="bg-[var(--surface-2)] dark:bg-slate-900 border-t-2 border-[var(--border)] dark:border-slate-700 font-semibold tabular-nums">
                        <td className="px-3 py-2.5 text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          TOTAL PERIODE
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          {formatIdrExact(kpi.glPurchaseDomestic)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-slate-900 dark:text-slate-100 whitespace-nowrap">
                          {formatIdrExact(kpi.glPurchaseImport)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                          {formatIdrExact(kpi.glPurchaseReturn + kpi.glPurchaseDiscount)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-[var(--accent-text)] dark:text-[var(--accent)] whitespace-nowrap">
                          {formatIdrExact(kpi.glNetPurchase)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {kpi.riInvoiceCount.toLocaleString('id-ID')}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {formatIdrExact(kpi.riDppIdr)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {formatIdrExact(kpi.varianceGlVsRiDpp)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            {/* GL Purchasing & COGS Related COA Accounts */}
            {data.glPurchasingAccounts.length > 0 && (
              <div className="space-y-2">
                <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Rincian Akun COA Pembelian &amp; Beban COGS Pembelian (Buku Besar / Laporan Keuangan)
                </h3>
                <div className="overflow-x-auto border border-[var(--border)] dark:border-slate-800 rounded-lg">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className="bg-[var(--surface-2)] dark:bg-slate-900 border-b border-[var(--border)] dark:border-slate-800 text-slate-600 dark:text-slate-400">
                        <th className="px-3 py-2 font-semibold whitespace-nowrap">Kode COA</th>
                        <th className="px-3 py-2 font-semibold">Nama Akun</th>
                        <th className="px-3 py-2 font-semibold whitespace-nowrap">Kelompok</th>
                        <th className="px-3 py-2 font-semibold text-right whitespace-nowrap">
                          Entri Jurnal
                        </th>
                        <th className="px-3 py-2 font-semibold text-right whitespace-nowrap">
                          Nilai Laporan Keuangan
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 tabular-nums">
                      {data.glPurchasingAccounts.map((acc) => (
                        <tr
                          key={acc.accountNo}
                          className="hover:bg-[var(--surface-2)] dark:hover:bg-slate-800/40"
                        >
                          <td className="px-3 py-2 font-mono font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                            {acc.accountNo}
                          </td>
                          <td className="px-3 py-2 text-slate-800 dark:text-slate-200">
                            {acc.accountName}
                          </td>
                          <td className="px-3 py-2 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                            {acc.isCorePurchase ? 'Inti Pembelian' : 'Beban COGS Pembelian'}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                            {acc.entryCount.toLocaleString('id-ID')}
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-mono font-semibold whitespace-nowrap ${
                              acc.amount < 0
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-slate-900 dark:text-slate-100'
                            }`}
                          >
                            {formatIdrExact(acc.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Top Suppliers & Top Purchased Items */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Top Suppliers */}
              <div className="border border-[var(--border)] dark:border-slate-800 rounded-lg overflow-hidden">
                <div className="px-3.5 py-2.5 bg-[var(--surface-2)] dark:bg-slate-900 border-b border-[var(--border)] dark:border-slate-800 flex items-center justify-between">
                  <h3 className="font-display text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {t('erpPanels.purchasing.topSuppliers')}
                  </h3>
                  <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                    {data.topSuppliers.length} supplier
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[var(--border)] dark:border-slate-800 text-slate-500 dark:text-slate-400">
                        <th className="px-3 py-2 font-medium">Supplier</th>
                        <th className="px-3 py-2 font-medium whitespace-nowrap">Asal</th>
                        <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Faktur</th>
                        <th className="px-3 py-2 font-medium text-right whitespace-nowrap">DPP (IDR)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 tabular-nums">
                      {data.topSuppliers.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                            Belum ada data supplier pada periode ini.
                          </td>
                        </tr>
                      ) : (
                        data.topSuppliers.slice(0, 12).map((sup) => (
                          <tr
                            key={`${sup.supplierId}-${sup.supplierCode}`}
                            className="hover:bg-[var(--surface-2)] dark:hover:bg-slate-800/40"
                          >
                            <td className="px-3 py-2 text-slate-900 dark:text-slate-100">
                              <div className="font-medium truncate max-w-[200px]" title={sup.supplierName}>
                                {sup.supplierName}
                              </div>
                              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                {sup.supplierCode}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-[11px] text-slate-600 dark:text-slate-400 whitespace-nowrap">
                              {sup.originType}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                              {sup.invoiceCount.toLocaleString('id-ID')}
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                              {formatIdr(sup.totalDppIdr)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Top Purchased Items */}
              <div className="border border-[var(--border)] dark:border-slate-800 rounded-lg overflow-hidden">
                <div className="px-3.5 py-2.5 bg-[var(--surface-2)] dark:bg-slate-900 border-b border-[var(--border)] dark:border-slate-800 flex items-center justify-between">
                  <h3 className="font-display text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {t('erpPanels.purchasing.topItems')}
                  </h3>
                  <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                    {data.topItems.length} item
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[var(--border)] dark:border-slate-800 text-slate-500 dark:text-slate-400">
                        <th className="px-3 py-2 font-medium">Barang</th>
                        <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Qty</th>
                        <th className="px-3 py-2 font-medium text-right whitespace-nowrap">Nilai (IDR)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 tabular-nums">
                      {data.topItems.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="px-3 py-6 text-center text-slate-500">
                            Belum ada detail barang dibeli pada periode ini.
                          </td>
                        </tr>
                      ) : (
                        data.topItems.slice(0, 12).map((it) => (
                          <tr
                            key={`${it.itemId}-${it.itemCode}`}
                            className="hover:bg-[var(--surface-2)] dark:hover:bg-slate-800/40"
                          >
                            <td className="px-3 py-2 text-slate-900 dark:text-slate-100">
                              <div className="font-medium truncate max-w-[230px]" title={it.itemName}>
                                {it.itemName}
                              </div>
                              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                {it.itemCode} · {it.invoiceCount} faktur
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
                              {it.totalQty.toLocaleString('id-ID')} {it.unit}
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                              {formatIdr(it.totalValueIdr)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: FAKTUR PEMBELIAN */}
        {activeTab === 'invoices' && (
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-[var(--surface-2)] dark:bg-slate-950 border border-[var(--border)] dark:border-slate-800">
                <p className="text-slate-500 dark:text-slate-400">{t('erpPanels.purchasing.colDpp')}</p>
                <p className="mt-1 font-mono tabular-nums font-bold text-slate-900 dark:text-slate-100">
                  {formatIdrExact(kpi.riDppIdr)}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-[var(--surface-2)] dark:bg-slate-950 border border-[var(--border)] dark:border-slate-800">
                <p className="text-slate-500 dark:text-slate-400">PPN / Pajak Masukan (IDR)</p>
                <p className="mt-1 font-mono tabular-nums font-bold text-slate-900 dark:text-slate-100">
                  {formatIdrExact(kpi.riTaxIdr)}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-[var(--surface-2)] dark:bg-slate-950 border border-[var(--border)] dark:border-slate-800">
                <p className="text-slate-500 dark:text-slate-400">Grand Total Inc. PPN (IDR)</p>
                <p className="mt-1 font-mono tabular-nums font-bold text-slate-900 dark:text-slate-100">
                  {formatIdrExact(kpi.riTotalIdr)}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-[var(--surface-2)] dark:bg-slate-950 border border-[var(--border)] dark:border-slate-800">
                <p className="text-slate-500 dark:text-slate-400">Terbayar Periode Ini (IDR)</p>
                <p className="mt-1 font-mono tabular-nums font-bold text-emerald-700 dark:text-emerald-400">
                  {formatIdrExact(kpi.riPaidIdr)}
                </p>
              </div>
            </div>

            <ErpStatusFilterBar
              options={buildStandardStatusChips(invoiceChipCounts)}
              activeValue={invoiceStatusChip}
              filteredCount={displayedInvoices.length}
              totalCount={data.invoices.length}
              onChange={(next) => {
                setInvoiceStatusChip(next);
                setInvoicesPage(1);
              }}
            />

            <div className="border border-[var(--border)] dark:border-slate-800 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-[var(--surface-2)] dark:bg-slate-900 border-b border-[var(--border)] dark:border-slate-800 text-slate-600 dark:text-slate-400">
                    <th className="px-3 py-2.5 font-semibold whitespace-nowrap">No. Faktur &amp; Ref</th>
                    <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Tgl / JT</th>
                    <th className="px-3 py-2.5 font-semibold">Supplier</th>
                    <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Asal / Kurs</th>
                    <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">DPP (IDR)</th>
                    <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">PPN (IDR)</th>
                    <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">Total (IDR)</th>
                    <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">Sisa Hutang</th>
                    <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Transaksi Terkait</th>
                    <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 tabular-nums">
                  {displayedInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-slate-500">
                        Tidak ada faktur pembelian yang cocok dengan filter ini.
                      </td>
                    </tr>
                  ) : (
                    invoicesPaging.paginatedItems.map((inv) => {
                      const relPos = inv.relatedPos || [];
                      const relGrns = inv.relatedGrns || [];
                      const relVps = inv.relatedVps || [];
                      const totalRel = relPos.length + relGrns.length + relVps.length + (inv.relatedPrs?.length || 0);
                      return (
                        <tr
                          key={inv.id}
                          className="hover:bg-[var(--surface-2)] dark:hover:bg-slate-800/40"
                        >
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                              {inv.docNo}
                            </div>
                            {inv.refNo && (
                              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                Ref: {inv.refNo}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2.5 font-mono whitespace-nowrap">
                            <div className="text-slate-800 dark:text-slate-200">{inv.date || '-'}</div>
                            <div
                              className={`text-[11px] ${
                                inv.isOverdue
                                  ? 'text-rose-700 dark:text-rose-400 font-semibold'
                                  : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              JT: {inv.dueDate || '-'}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-slate-800 dark:text-slate-200 max-w-[220px] truncate" title={inv.supplierName}>
                            {inv.supplierName}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <div className="font-medium text-slate-700 dark:text-slate-300">
                              {inv.originType}
                            </div>
                            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                              {inv.currency}
                              {inv.kurs !== 1 ? ` × ${inv.kurs.toLocaleString('id-ID')}` : ''}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-slate-800 dark:text-slate-200 whitespace-nowrap">
                            {formatIdr(inv.dppIdr)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                            {formatIdr(inv.taxIdr)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                            {formatIdr(inv.totalIdr)}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-right font-mono font-semibold whitespace-nowrap ${
                              inv.balanceIdr > 0
                                ? inv.isOverdue
                                  ? 'text-rose-700 dark:text-rose-400'
                                  : 'text-amber-700 dark:text-amber-400'
                                : 'text-emerald-700 dark:text-emerald-400'
                            }`}
                          >
                            {inv.balanceIdr > 0 ? formatIdr(inv.balanceIdr) : 'Lunas'}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() =>
                                setRelatedModal({
                                  sourceType: 'RI',
                                  docNo: inv.docNo,
                                  date: inv.date,
                                  subtitle: inv.supplierName,
                                  totalIdr: inv.totalIdr,
                                  statusCode: inv.statusCode,
                                  statusLabel: inv.statusLabel,
                                  relatedPrs: inv.relatedPrs || [],
                                  relatedPos: relPos,
                                  relatedGrns: relGrns,
                                  relatedRis: [],
                                  relatedVps: relVps,
                                })
                              }
                              className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md border border-[var(--border)] bg-[var(--surface-2)] hover:border-[var(--accent)] text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
                              title="Klik untuk lihat rantai Transaksi Terkait"
                            >
                              <Link2 className="w-3 h-3 text-[var(--accent-text)] dark:text-[var(--accent)] shrink-0" />
                              {data.relationsSupported ? (
                                totalRel > 0 ? (
                                  <span className="font-mono">
                                    {[
                                      relPos.length > 0 ? `PO:${relPos.length}` : '',
                                      relGrns.length > 0 ? `GRN:${relGrns.length}` : '',
                                      relVps.length > 0 ? `VP:${relVps.length}` : '',
                                    ]
                                      .filter(Boolean)
                                      .join(' · ') || `${totalRel} dok`}
                                  </span>
                                ) : (
                                  <span className="text-slate-400">Tanpa relasi</span>
                                )
                              ) : (
                                <span className="text-slate-400">Terkait</span>
                              )}
                            </button>
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <ErpStatusBadge
                              statusCode={inv.statusCode}
                              rawLabel={inv.statusLabel}
                            />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              </div>
              <TablePaginationBar {...invoicesPaging.paginationProps} />
            </div>
          </div>
        )}

        {/* TAB 3: HUTANG SUPPLIER & AGING AP (KUMULATIF) */}
        {activeTab === 'ap' && (
          <div className="p-4 space-y-5">
            {pendingRuleId === 'purchasing_ri_pending_vp' && (
              <div className="p-3 rounded-lg bg-[var(--accent-soft)] border border-[var(--border-strong)] flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 text-[var(--text)]">
                  <AlertTriangle className="w-4 h-4 text-[var(--accent-text)] shrink-0" />
                  <span>
                    Menampilkan filter notifikasi:{' '}
                    <strong>{t('pendingTx.rules.purchasing_ri_pending_vp.title')}</strong>{' '}
                    (status Approved / In Progress ≥ {ACTIVE_CUTOFF_DATE}, sisa hutang &gt; 0 —{' '}
                    {displayedUnpaidInvoices.length} faktur pada halaman ini).
                  </span>
                </div>
                <button
                  type="button"
                  onClick={clearPendingFilter}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] hover:border-[var(--text-muted)] cursor-pointer"
                >
                  <span>Tampilkan Semua Hutang</span>
                </button>
              </div>
            )}
            {/* GL AP vs Sub-Ledger AP Comparison */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="p-4 rounded-lg bg-[var(--surface-2)] dark:bg-slate-950 border border-[var(--border)] dark:border-slate-800 space-y-1.5">
                <p className="font-semibold text-slate-900 dark:text-slate-100">
                  Saldo Hutang Buku Besar (COA 210101* &amp; 210103* · Kumulatif)
                </p>
                <p className="font-mono tabular-nums text-xl font-bold text-slate-900 dark:text-slate-100">
                  {formatIdrExact(kpi.apJournalTotal)}
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-600 dark:text-slate-400 tabular-nums">
                  <span>Carry-Over &lt; Mar 2026: {formatIdrExact(kpi.apJournalCarryOver)}</span>
                  <span>Mutasi ≥ Mar 2026: {formatIdrExact(kpi.apJournalPeriod)}</span>
                </div>
              </div>
              <div className="p-4 rounded-lg bg-[var(--surface-2)] dark:bg-slate-950 border border-[var(--border)] dark:border-slate-800 space-y-1.5">
                <p className="font-semibold text-slate-900 dark:text-slate-100">
                  {t('erpPanels.purchasing.unpaidSubledger')}
                </p>
                <p className="font-mono tabular-nums text-xl font-bold text-amber-700 dark:text-amber-400">
                  {formatIdr(kpi.apSubLedgerTotalIdr)}
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-600 dark:text-slate-400 tabular-nums">
                  <span>
                    {kpi.apUnpaidInvoiceCount.toLocaleString('id-ID')} faktur belum lunas
                  </span>
                  <span className="text-rose-700 dark:text-rose-400 font-semibold">
                    Overdue: {kpi.apOverdueInvoiceCount.toLocaleString('id-ID')} ({formatIdr(kpi.apOverdueAmountIdr)})
                  </span>
                  <span>
                    Carry-Over &lt; Mar: {kpi.apCarryOverUnpaidCount.toLocaleString('id-ID')} ({formatIdr(kpi.apCarryOverPayableIdr)})
                  </span>
                </div>
              </div>
            </div>

            {/* 5-Bucket AP Aging Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 text-xs">
              {[
                {
                  label: 'Belum Jatuh Tempo',
                  bucket: data.apAging.current,
                  accent: 'text-emerald-700 dark:text-emerald-400',
                },
                {
                  label: 'Lewat 1–30 Hari',
                  bucket: data.apAging.days1to30,
                  accent: 'text-amber-700 dark:text-amber-400',
                },
                {
                  label: 'Lewat 31–60 Hari',
                  bucket: data.apAging.days31to60,
                  accent: 'text-orange-700 dark:text-orange-400',
                },
                {
                  label: 'Lewat 61–90 Hari',
                  bucket: data.apAging.days61to90,
                  accent: 'text-rose-700 dark:text-rose-400',
                },
                {
                  label: 'Lewat > 90 Hari',
                  bucket: data.apAging.over90,
                  accent: 'text-rose-800 dark:text-rose-300',
                },
              ].map((b) => (
                <div
                  key={b.label}
                  className="p-3 rounded-lg border border-[var(--border)] dark:border-slate-800 bg-[var(--surface)] dark:bg-slate-950/60"
                >
                  <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    {b.label}
                  </p>
                  <p className={`mt-1 font-mono tabular-nums text-sm font-bold ${b.accent}`}>
                    {formatIdr(b.bucket.amount)}
                  </p>
                  <p className="mt-0.5 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    {b.bucket.count.toLocaleString('id-ID')} faktur
                  </p>
                </div>
              ))}
            </div>

            {/* Top AP Contacts from General Ledger */}
            {data.topApContactsGl.length > 0 && (
              <div className="space-y-2">
                <h3 className="font-display text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Top Saldo Hutang per Supplier (Buku Besar COA 2101* · Kumulatif)
                </h3>
                <div className="overflow-x-auto border border-[var(--border)] dark:border-slate-800 rounded-lg">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className="bg-[var(--surface-2)] dark:bg-slate-900 border-b border-[var(--border)] dark:border-slate-800 text-slate-600 dark:text-slate-400">
                        <th className="px-3 py-2 font-semibold">Supplier</th>
                        <th className="px-3 py-2 font-semibold text-right whitespace-nowrap">
                          Carry-Over &lt; Mar 2026
                        </th>
                        <th className="px-3 py-2 font-semibold text-right whitespace-nowrap">
                          Mutasi ≥ Mar 2026
                        </th>
                        <th className="px-3 py-2 font-semibold text-right whitespace-nowrap">
                          Total Saldo Hutang
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 tabular-nums">
                      {data.topApContactsGl.slice(0, 12).map((c) => (
                        <tr
                          key={`${c.contactId}-${c.contactCode}`}
                          className="hover:bg-[var(--surface-2)] dark:hover:bg-slate-800/40"
                        >
                          <td className="px-3 py-2 text-slate-900 dark:text-slate-100">
                            <span className="font-medium">{c.contactName}</span>{' '}
                            <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                              ({c.contactCode})
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                            {formatIdr(c.carryOverBalance)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                            {formatIdr(c.periodBalance)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-semibold text-amber-700 dark:text-amber-400 whitespace-nowrap">
                            {formatIdr(c.totalBalance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Unpaid Purchase Invoices Table */}
            <div className="space-y-2.5">
              <h3 className="font-display text-xs font-semibold text-slate-900 dark:text-slate-100">
                {t('erpPanels.purchasing.unpaidDueOrder')}
              </h3>
              <ErpStatusFilterBar
                options={buildStandardStatusChips(apChipCounts)}
                activeValue={apStatusChip}
                filteredCount={displayedUnpaidInvoices.length}
                totalCount={baseUnpaidInvoices.length}
                onChange={(next) => {
                  setApStatusChip(next);
                  setUnpaidPage(1);
                }}
              />
              <div className="border border-[var(--border)] dark:border-slate-800 rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="bg-[var(--surface-2)] dark:bg-slate-900 border-b border-[var(--border)] dark:border-slate-800 text-slate-600 dark:text-slate-400">
                      <th className="px-3 py-2.5 font-semibold whitespace-nowrap">No. Faktur</th>
                      <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Tanggal</th>
                      <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Jatuh Tempo</th>
                      <th className="px-3 py-2.5 font-semibold">Supplier</th>
                      <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Asal</th>
                      <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">Total (IDR)</th>
                      <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">Sisa Hutang</th>
                      <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 tabular-nums">
                    {displayedUnpaidInvoices.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                          Tidak ada faktur pembelian belum lunas pada filter saat ini.
                        </td>
                      </tr>
                    ) : (
                      unpaidPaging.paginatedItems.map((inv) => (
                        <tr
                          key={inv.id}
                          className="hover:bg-[var(--surface-2)] dark:hover:bg-slate-800/40"
                        >
                          <td className="px-3 py-2.5 font-mono font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                            {inv.docNo}
                            {inv.isCarryOver && (
                              <span className="ml-1.5 text-[10px] font-sans font-semibold text-amber-700 dark:text-amber-400">
                                [Carry-Over]
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                            {inv.date || '-'}
                          </td>
                          <td
                            className={`px-3 py-2.5 font-mono whitespace-nowrap ${
                              inv.isOverdue
                                ? 'text-rose-700 dark:text-rose-400 font-semibold'
                                : 'text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            {inv.dueDate || '-'}
                            {inv.isOverdue ? ' · Overdue' : ''}
                          </td>
                          <td className="px-3 py-2.5 text-slate-800 dark:text-slate-200 max-w-[240px] truncate" title={inv.supplierName}>
                            {inv.supplierName}
                          </td>
                          <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                            {inv.originType}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
                            {formatIdr(inv.totalIdr)}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-right font-mono font-semibold whitespace-nowrap ${
                              inv.isOverdue
                                ? 'text-rose-700 dark:text-rose-400'
                                : 'text-amber-700 dark:text-amber-400'
                            }`}
                          >
                            {formatIdr(inv.balanceIdr)}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
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
                <TablePaginationBar {...unpaidPaging.paginationProps} />
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: PURCHASE ORDER (m4_po) */}
        {activeTab === 'po' && (
          <div className="p-4 space-y-4">
            {pendingRuleId && pendingRuleId.startsWith('purchasing_po_') && poStatusChip !== 'all' && (
              <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 rounded-lg bg-[var(--accent-soft)] border border-[var(--accent)]/35 text-xs">
                <div className="flex items-center gap-2 text-[var(--text)]">
                  <Filter className="w-3.5 h-3.5 text-[var(--accent-text)] shrink-0" />
                  <span className="font-semibold">{t('pendingTx.filterBanner.activeLabel')}:</span>
                  <span>{t(`pendingTx.rules.${pendingRuleId}.title`)}</span>
                  <span className="font-mono tabular-nums text-[var(--text-muted)]">
                    ({displayedPurchaseOrders.length})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={clearPendingFilter}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] hover:border-[var(--accent)] transition-colors cursor-pointer"
                >
                  <X className="w-3 h-3" />
                  <span>{t('pendingTx.filterBanner.reset')}</span>
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-[var(--surface-2)] dark:bg-slate-950 border border-[var(--border)] dark:border-slate-800">
                <p className="text-slate-500 dark:text-slate-400">{t('erpPanels.purchasing.totalPo')}</p>
                <p className="mt-1 font-mono tabular-nums text-lg font-bold text-slate-900 dark:text-slate-100">
                  {kpi.poCount.toLocaleString('id-ID')} PO
                </p>
              </div>
              <div className="p-3 rounded-lg bg-[var(--surface-2)] dark:bg-slate-950 border border-[var(--border)] dark:border-slate-800">
                <p className="text-slate-500 dark:text-slate-400">Total Nilai PO (IDR)</p>
                <p className="mt-1 font-mono tabular-nums text-lg font-bold text-slate-900 dark:text-slate-100">
                  {formatIdr(kpi.poTotalIdr)}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-[var(--surface-2)] dark:bg-slate-950 border border-[var(--border)] dark:border-slate-800">
                <p className="text-slate-500 dark:text-slate-400">
                  PO Outstanding (Approved &amp; In Progress)
                </p>
                <p
                  className={`mt-1 font-mono tabular-nums text-lg font-bold ${
                    kpi.poOutstandingCount > 0
                      ? 'text-amber-700 dark:text-amber-400'
                      : 'text-emerald-700 dark:text-emerald-400'
                  }`}
                >
                  {kpi.poOutstandingCount.toLocaleString('id-ID')} PO
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Tidak termasuk Draft &amp; Need Approve
                </p>
              </div>
            </div>

            <ErpStatusFilterBar
              options={buildStandardStatusChips(poChipCounts)}
              activeValue={poStatusChip}
              filteredCount={displayedPurchaseOrders.length}
              totalCount={data.purchaseOrders.length}
              onChange={(next) => {
                setPoStatusChip(next);
                setPoPage(1);
                if (next === 'all') setPendingRuleId(null);
              }}
            />

            {!data.relationsSupported && (
              <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 rounded-lg bg-[var(--warning-soft)] dark:bg-amber-950/30 border border-amber-500/40 text-xs text-[var(--warning)] dark:text-amber-300">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>
                    Bridge lokal Anda belum versi <strong>v10</strong> — perbarui ke <strong>Bridge v10</strong> agar relasi dokumen &amp; fitur klik <strong>Transaksi Terkait</strong> aktif penuh.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onDownloadBridge}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-[var(--surface)] text-[var(--text)] border border-[var(--border-strong)] hover:border-[var(--accent)] transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Unduh Bridge v10 (.mjs)</span>
                </button>
              </div>
            )}

            <div className="border border-[var(--border)] dark:border-slate-800 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-[var(--surface-2)] dark:bg-slate-900 border-b border-[var(--border)] dark:border-slate-800 text-slate-600 dark:text-slate-400">
                    <th className="px-3 py-2.5 font-semibold whitespace-nowrap">No. PO</th>
                    <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Tgl / Target</th>
                    <th className="px-3 py-2.5 font-semibold">Supplier</th>
                    <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Asal / Kurs</th>
                    <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">Total (IDR)</th>
                    <th className="px-3 py-2.5 font-semibold whitespace-nowrap">GRN / RI &amp; Transaksi Terkait</th>
                    <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 tabular-nums">
                  {paginatedPurchaseOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                        Tidak ada Purchase Order pada filter ini.
                      </td>
                    </tr>
                  ) : (
                    paginatedPurchaseOrders.map((po) => {
                      const relGrns = po.relatedGrns || [];
                      const relRis = po.relatedRis || [];
                      const relVps = po.relatedVps || [];
                      const hasGrn = relGrns.length > 0 || po.statusGrn > 0;
                      const hasRi = relRis.length > 0 || po.statusRi > 0;
                      const isStaleLegacyCompleted =
                        !data.relationsSupported &&
                        (po.statusCode === 4 || po.isClosed) &&
                        !hasGrn &&
                        !hasRi;

                      return (
                        <tr
                          key={po.id}
                          className="hover:bg-[var(--surface-2)] dark:hover:bg-slate-800/40"
                        >
                          <td className="px-3 py-2.5 font-mono font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                            {po.docNo}
                          </td>
                          <td className="px-3 py-2.5 font-mono whitespace-nowrap">
                            <div className="text-slate-800 dark:text-slate-200">{po.date || '-'}</div>
                            {po.expectedDate && (
                              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                Target: {po.expectedDate}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-slate-800 dark:text-slate-200 max-w-[240px] truncate" title={po.supplierName}>
                            {po.supplierName}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <div className="text-slate-700 dark:text-slate-300">{po.originType}</div>
                            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                              {po.currency}
                              {po.kurs !== 1 ? ` × ${po.kurs.toLocaleString('id-ID')}` : ''}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                            {formatIdr(po.totalIdr)}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() =>
                                setRelatedModal({
                                  sourceType: 'PO',
                                  docNo: po.docNo,
                                  date: po.date,
                                  subtitle: po.supplierName,
                                  totalIdr: po.totalIdr,
                                  statusCode: po.statusCode,
                                  statusLabel: po.statusLabel,
                                  isClosed: po.isClosed,
                                  relatedPrs: po.relatedPrs || [],
                                  relatedPos: [],
                                  relatedGrns: relGrns,
                                  relatedRis: relRis,
                                  relatedVps: relVps,
                                })
                              }
                              className="inline-flex flex-wrap items-center gap-1.5 text-left text-[11px] px-2 py-1 rounded-md border border-[var(--border)] bg-[var(--surface-2)] hover:border-[var(--accent)] transition-colors cursor-pointer"
                              title="Klik untuk melihat rantai Transaksi Terkait (PR → PO → GRN → RI → VP)"
                            >
                              <Link2 className="w-3 h-3 text-[var(--accent-text)] dark:text-[var(--accent)] shrink-0" />
                              {isStaleLegacyCompleted ? (
                                <span className="text-[var(--warning)] dark:text-amber-300 font-medium">
                                  Perlu Bridge v10 (Relasi)
                                </span>
                              ) : (
                                <>
                                  <span
                                    className={
                                      hasGrn
                                        ? 'font-mono font-semibold text-emerald-700 dark:text-emerald-400'
                                        : 'text-slate-500 dark:text-slate-400'
                                    }
                                  >
                                    GRN:{' '}
                                    {relGrns.length > 0
                                      ? `${relGrns[0].docNo}${relGrns.length > 1 ? ` (+${relGrns.length - 1})` : ''}`
                                      : hasGrn
                                        ? 'Sudah'
                                        : 'Belum'}
                                  </span>
                                  <span className="text-slate-400">·</span>
                                  <span
                                    className={
                                      hasRi
                                        ? 'font-mono font-semibold text-sky-700 dark:text-sky-400'
                                        : 'text-slate-500 dark:text-slate-400'
                                    }
                                  >
                                    RI:{' '}
                                    {relRis.length > 0
                                      ? `${relRis[0].docNo}${relRis.length > 1 ? ` (+${relRis.length - 1})` : ''}`
                                      : hasRi
                                        ? 'Sudah'
                                        : 'Belum'}
                                  </span>
                                  {relVps.length > 0 && (
                                    <>
                                      <span className="text-slate-400">·</span>
                                      <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                                        VP ({relVps.length})
                                      </span>
                                    </>
                                  )}
                                </>
                              )}
                            </button>
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <ErpStatusBadge
                              statusCode={po.statusCode}
                              isClosed={po.isClosed}
                              rawLabel={po.statusLabel}
                            />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              </div>
              <TablePaginationBar {...poPaging.paginationProps} />
            </div>
          </div>
        )}

        {/* TAB 5: GRN & PR (m4_grn, m4_pr, m4_prt, m4_vp) */}
        {activeTab === 'grn_pr' && (
          <div className="p-4 space-y-5">
            {pendingRuleId &&
              (pendingRuleId === 'purchasing_grn_pending_ri' || pendingRuleId === 'purchasing_pr_pending_po') &&
              (grnStatusChip !== 'all' || prStatusChip !== 'all') && (
                <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 rounded-lg bg-[var(--accent-soft)] border border-[var(--accent)]/35 text-xs">
                  <div className="flex items-center gap-2 text-[var(--text)]">
                    <Filter className="w-3.5 h-3.5 text-[var(--accent-text)] shrink-0" />
                    <span className="font-semibold">{t('pendingTx.filterBanner.activeLabel')}:</span>
                    <span>{t(`pendingTx.rules.${pendingRuleId}.title`)}</span>
                    <span className="font-mono tabular-nums text-[var(--text-muted)]">
                      (
                      {pendingRuleId === 'purchasing_pr_pending_po'
                        ? displayedPurchaseRequests.length
                        : displayedGoodsReceipts.length}
                      )
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={clearPendingFilter}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] hover:border-[var(--accent)] transition-colors cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                    <span>{t('pendingTx.filterBanner.reset')}</span>
                  </button>
                </div>
              )}

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-[var(--surface-2)] dark:bg-slate-950 border border-[var(--border)] dark:border-slate-800">
                <p className="text-slate-500 dark:text-slate-400">{t('erpPanels.purchasing.grnLabel')}</p>
                <p className="mt-1 font-mono tabular-nums text-lg font-bold text-slate-900 dark:text-slate-100">
                  {kpi.grnCount.toLocaleString('id-ID')} dok
                </p>
              </div>
              <div className="p-3 rounded-lg bg-[var(--surface-2)] dark:bg-slate-950 border border-[var(--border)] dark:border-slate-800">
                <p className="text-slate-500 dark:text-slate-400">{t('erpPanels.purchasing.prLabel')}</p>
                <p className="mt-1 font-mono tabular-nums text-lg font-bold text-slate-900 dark:text-slate-100">
                  {kpi.prCount.toLocaleString('id-ID')} PR
                </p>
                <p className="text-[11px] text-amber-700 dark:text-amber-400 tabular-nums">
                  Outstanding (Approved &amp; In Progress): {kpi.prOutstandingCount.toLocaleString('id-ID')}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-[var(--surface-2)] dark:bg-slate-950 border border-[var(--border)] dark:border-slate-800">
                <p className="text-slate-500 dark:text-slate-400">{t('erpPanels.purchasing.prtLabel')}</p>
                <p className="mt-1 font-mono tabular-nums text-lg font-bold text-slate-900 dark:text-slate-100">
                  {kpi.returnCountSub.toLocaleString('id-ID')} dok
                </p>
                <p className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  {formatIdr(kpi.returnTotalSubIdr)}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-[var(--surface-2)] dark:bg-slate-950 border border-[var(--border)] dark:border-slate-800">
                <p className="text-slate-500 dark:text-slate-400">{t('erpPanels.purchasing.vpLabel')}</p>
                <p className="mt-1 font-mono tabular-nums text-lg font-bold text-slate-900 dark:text-slate-100">
                  {kpi.vpCount.toLocaleString('id-ID')} dok
                </p>
                <p className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  {formatIdr(kpi.vpTotalIdr)}
                </p>
              </div>
            </div>

            {/* GRN Table */}
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-xs font-semibold text-slate-900 dark:text-slate-100">
                  {t('erpPanels.purchasing.recentGrn')}
                </h3>
              </div>
              <ErpStatusFilterBar
                options={buildGrnStatusChips(grnChipCounts)}
                activeValue={grnStatusChip}
                filteredCount={displayedGoodsReceipts.length}
                totalCount={data.goodsReceipts.length}
                onChange={(next) => {
                  setGrnStatusChip(next);
                  setGrnPage(1);
                  if (next === 'all' && pendingRuleId === 'purchasing_grn_pending_ri') {
                    setPendingRuleId(null);
                  }
                }}
              />
              <div
                className={`border rounded-lg overflow-hidden ${
                  grnStatusChip === 'belum_ri'
                    ? 'border-[var(--accent)]/60 ring-1 ring-[var(--accent)]/30'
                    : 'border-[var(--border)] dark:border-slate-800'
                }`}
              >
                <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="bg-[var(--surface-2)] dark:bg-slate-900 border-b border-[var(--border)] dark:border-slate-800 text-slate-600 dark:text-slate-400">
                      <th className="px-3 py-2 font-semibold whitespace-nowrap">No. GRN</th>
                      <th className="px-3 py-2 font-semibold whitespace-nowrap">Tanggal</th>
                      <th className="px-3 py-2 font-semibold">Supplier</th>
                      <th className="px-3 py-2 font-semibold whitespace-nowrap">Gudang</th>
                      <th className="px-3 py-2 font-semibold text-right whitespace-nowrap">Total (IDR)</th>
                      <th className="px-3 py-2 font-semibold whitespace-nowrap">PO / RI Terkait</th>
                      <th className="px-3 py-2 font-semibold whitespace-nowrap">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 tabular-nums">
                    {paginatedGoodsReceipts.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                          Tidak ada data penerimaan barang pada filter ini.
                        </td>
                      </tr>
                    ) : (
                      paginatedGoodsReceipts.map((g) => {
                        const relPos = g.relatedPos || [];
                        const relRis = g.relatedRis || [];
                        return (
                          <tr key={g.id} className="hover:bg-[var(--surface-2)] dark:hover:bg-slate-800/40">
                            <td className="px-3 py-2 font-mono font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                              {g.docNo}
                            </td>
                            <td className="px-3 py-2 font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                              {g.date || '-'}
                            </td>
                            <td className="px-3 py-2 text-slate-800 dark:text-slate-200">
                              {g.supplierName}
                            </td>
                            <td className="px-3 py-2 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                              {g.warehouse}
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                              {formatIdr(g.totalIdr)}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() =>
                                  setRelatedModal({
                                    sourceType: 'GRN',
                                    docNo: g.docNo,
                                    date: g.date,
                                    subtitle: g.supplierName,
                                    totalIdr: g.totalIdr,
                                    statusCode: g.statusCode,
                                    statusLabel: g.statusLabel,
                                    relatedPrs: g.relatedPrs || [],
                                    relatedPos: relPos,
                                    relatedGrns: [],
                                    relatedRis: relRis,
                                    relatedVps: [],
                                  })
                                }
                                className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-md border border-[var(--border)] bg-[var(--surface-2)] hover:border-[var(--accent)] transition-colors cursor-pointer"
                                title="Klik untuk melihat Transaksi Terkait GRN ini"
                              >
                                <Link2 className="w-3 h-3 text-[var(--accent-text)] dark:text-[var(--accent)] shrink-0" />
                                <span className={relPos.length > 0 ? 'font-mono text-slate-800 dark:text-slate-200' : 'text-slate-400'}>
                                  PO: {relPos.length > 0 ? relPos[0].docNo : '-'}
                                </span>
                                <span className="text-slate-400">·</span>
                                <span className={relRis.length > 0 ? 'font-mono font-semibold text-sky-700 dark:text-sky-400' : 'text-slate-400'}>
                                  RI: {relRis.length > 0 ? relRis[0].docNo : 'Belum'}
                                </span>
                              </button>
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              <ErpStatusBadge
                                statusCode={g.statusCode}
                                mode="grn"
                                rawLabel={g.statusLabel}
                              />
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
                </div>
                <TablePaginationBar {...grnPaging.paginationProps} />
              </div>
            </div>

            {/* PR Table */}
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-xs font-semibold text-slate-900 dark:text-slate-100">
                  {t('erpPanels.purchasing.recentPr')}
                </h3>
              </div>
              <ErpStatusFilterBar
                options={buildStandardStatusChips(prChipCounts)}
                activeValue={prStatusChip}
                filteredCount={displayedPurchaseRequests.length}
                totalCount={data.purchaseRequests.length}
                onChange={(next) => {
                  setPrStatusChip(next);
                  setPrPage(1);
                  if (next === 'all' && pendingRuleId === 'purchasing_pr_pending_po') {
                    setPendingRuleId(null);
                  }
                }}
              />
              <div
                className={`border rounded-lg overflow-hidden ${
                  prStatusChip !== 'all'
                    ? 'border-[var(--accent)]/60 ring-1 ring-[var(--accent)]/30'
                    : 'border-[var(--border)] dark:border-slate-800'
                }`}
              >
                <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="bg-[var(--surface-2)] dark:bg-slate-900 border-b border-[var(--border)] dark:border-slate-800 text-slate-600 dark:text-slate-400">
                      <th className="px-3 py-2 font-semibold whitespace-nowrap">No. PR</th>
                      <th className="px-3 py-2 font-semibold whitespace-nowrap">Tgl / Dipakai</th>
                      <th className="px-3 py-2 font-semibold">Uraian Kebutuhan</th>
                      <th className="px-3 py-2 font-semibold whitespace-nowrap">Gudang</th>
                      <th className="px-3 py-2 font-semibold text-right whitespace-nowrap">Estimasi (IDR)</th>
                      <th className="px-3 py-2 font-semibold whitespace-nowrap">PO / Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 tabular-nums">
                    {paginatedPurchaseRequests.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                          Tidak ada data Purchase Request pada filter ini.
                        </td>
                      </tr>
                    ) : (
                      paginatedPurchaseRequests.map((pr) => {
                        const relPos = pr.relatedPos || [];
                        return (
                          <tr key={pr.id} className="hover:bg-[var(--surface-2)] dark:hover:bg-slate-800/40">
                            <td className="px-3 py-2 font-mono font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                              {pr.docNo}
                            </td>
                            <td className="px-3 py-2 font-mono whitespace-nowrap">
                              <div className="text-slate-800 dark:text-slate-200">{pr.date || '-'}</div>
                              {pr.neededDate && (
                                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                                  Pakai: {pr.neededDate}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-slate-800 dark:text-slate-200 max-w-[280px] truncate" title={pr.description}>
                              {pr.description}
                            </td>
                            <td className="px-3 py-2 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                              {pr.warehouse}
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                              {formatIdr(pr.totalIdr)}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              <div className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setRelatedModal({
                                      sourceType: 'PR',
                                      docNo: pr.docNo,
                                      date: pr.date,
                                      subtitle: pr.description,
                                      totalIdr: pr.totalIdr,
                                      statusCode: pr.statusCode,
                                      statusLabel: pr.statusLabel,
                                      relatedPrs: [],
                                      relatedPos: relPos,
                                      relatedGrns: pr.relatedGrns || [],
                                      relatedRis: pr.relatedRis || [],
                                      relatedVps: [],
                                    })
                                  }
                                  className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border border-[var(--border)] bg-[var(--surface-2)] hover:border-[var(--accent)] transition-colors cursor-pointer"
                                  title="Klik untuk melihat Transaksi Terkait PR ini"
                                >
                                  <Link2 className="w-3 h-3 text-[var(--accent-text)] dark:text-[var(--accent)] shrink-0" />
                                  <span
                                    className={
                                      relPos.length > 0 || pr.statusPo > 0
                                        ? 'font-mono font-semibold text-emerald-700 dark:text-emerald-400'
                                        : 'text-slate-500 dark:text-slate-400'
                                    }
                                  >
                                    {relPos.length > 0
                                      ? `PO: ${relPos[0].docNo}${relPos.length > 1 ? ` (+${relPos.length - 1})` : ''}`
                                      : pr.statusPo
                                        ? 'Sudah PO'
                                        : 'Belum PO'}
                                  </span>
                                </button>
                                <ErpStatusBadge statusCode={pr.statusCode} rawLabel={pr.statusLabel} />
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
                </div>
                <TablePaginationBar {...prPaging.paginationProps} />
              </div>
            </div>

            <div className="flex items-start gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[var(--accent-text)] dark:text-[var(--accent)]" />
              <span>
                Seluruh angka pembelian utama tetap mengacu pada Buku Besar agar 100% sinkron dengan Laporan Keuangan, sedangkan daftar PO, Penerimaan Barang (GRN), dan Permintaan Pembelian (PR) menyajikan alur pengadaan operasional beserta relasi transaksi terkait.
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Modal Transaksi Terkait (PR → PO → GRN → RI/PI → VP) */}
      {relatedModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setRelatedModal(null)}
        >
          <div
            className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl bg-[var(--surface)] dark:bg-[#1C1C20] border border-[var(--border-strong)] dark:border-[#33333A] shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-[var(--border)] dark:border-[#33333A] bg-[var(--surface-2)] dark:bg-[#25252A] flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Link2 className="w-4 h-4 text-[var(--accent-text)] dark:text-[var(--accent)] shrink-0" />
                  <h3 className="text-sm font-semibold text-[var(--text)] dark:text-[#F4F4F5] truncate">
                    Transaksi Terkait · {relatedModal.sourceType} {relatedModal.docNo}
                  </h3>
                </div>
                <p className="text-[11px] text-[var(--text-muted)] dark:text-[#A1A1AA] truncate mt-0.5">
                  {relatedModal.date || '-'} · {relatedModal.subtitle || '-'} · {formatIdr(relatedModal.totalIdr)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRelatedModal(null)}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-3)] dark:hover:bg-white/10 transition-colors cursor-pointer"
                aria-label="Tutup"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-3">
              {!data.relationsSupported && (
                <div className="p-2.5 rounded-lg bg-[var(--warning-soft)] dark:bg-amber-950/30 border border-amber-500/40 text-xs text-[var(--warning)] dark:text-amber-300 flex flex-wrap items-center justify-between gap-2">
                  <span>
                    Bridge lokal belum v10 — perbarui ke <strong>Bridge v10</strong> agar seluruh relasi dokumen pengadaan tampil lengkap.
                  </span>
                  <button
                    type="button"
                    onClick={onDownloadBridge}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-[var(--surface)] text-[var(--text)] border border-[var(--border-strong)] cursor-pointer"
                  >
                    <Download className="w-3 h-3" />
                    <span>Unduh v10</span>
                  </button>
                </div>
              )}

              {(
                [
                  {
                    type: 'PR' as const,
                    title: t('erpPanels.purchasing.stepPr'),
                    docs: relatedModal.relatedPrs,
                  },
                  {
                    type: 'PO' as const,
                    title: t('erpPanels.purchasing.stepPo'),
                    docs: relatedModal.relatedPos,
                  },
                  {
                    type: 'GRN' as const,
                    title: t('erpPanels.purchasing.stepGrn'),
                    docs: relatedModal.relatedGrns,
                  },
                  {
                    type: 'RI' as const,
                    title: t('erpPanels.purchasing.stepRi'),
                    docs: relatedModal.relatedRis,
                  },
                  {
                    type: 'VP' as const,
                    title: t('erpPanels.purchasing.stepVp'),
                    docs: relatedModal.relatedVps,
                  },
                ]
              ).map((stage) => {
                const isActiveStage = stage.type === relatedModal.sourceType;
                return (
                  <div
                    key={stage.type}
                    className={`rounded-lg border p-3 ${
                      isActiveStage
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)]/50'
                        : 'border-[var(--border)] dark:border-[#33333A] bg-[var(--surface-2)]/60 dark:bg-[#25252A]/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-xs font-semibold text-[var(--text)] dark:text-[#F4F4F5]">
                        {stage.title}
                      </span>
                      {isActiveStage ? (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-[var(--accent)] text-[var(--on-accent)]">
                          Dokumen Aktif
                        </span>
                      ) : (
                        <span className="text-[11px] font-mono text-[var(--text-muted)] dark:text-[#A1A1AA]">
                          {stage.docs.length} dokumen
                        </span>
                      )}
                    </div>

                    {isActiveStage ? (
                      <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-2 rounded-md bg-[var(--surface)] dark:bg-[#1C1C20] border border-[var(--border)] dark:border-[#33333A] text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono font-semibold text-[var(--text)] dark:text-[#F4F4F5]">
                            {relatedModal.docNo}
                          </span>
                          <span className="font-mono text-[11px] text-[var(--text-muted)] dark:text-[#A1A1AA]">
                            {relatedModal.date || '-'}
                          </span>
                          <span className="font-mono text-[11px] font-semibold text-[var(--text)] dark:text-[#F4F4F5]">
                            {formatIdr(relatedModal.totalIdr)}
                          </span>
                        </div>
                        <ErpStatusBadge
                          statusCode={relatedModal.statusCode}
                          isClosed={relatedModal.isClosed}
                          mode={relatedModal.sourceType === 'GRN' ? 'grn' : 'standard'}
                          rawLabel={relatedModal.statusLabel}
                        />
                      </div>
                    ) : stage.docs.length === 0 ? (
                      <p className="text-[11px] text-[var(--text-subtle)] dark:text-[#71717A] italic">
                        Tidak ada dokumen {stage.type} terkait.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {stage.docs.map((doc) => (
                          <div
                            key={`${doc.type}-${doc.id}`}
                            className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-2 rounded-md bg-[var(--surface)] dark:bg-[#1C1C20] border border-[var(--border)] dark:border-[#33333A] text-xs"
                          >
                            <div className="flex flex-wrap items-center gap-2 min-w-0">
                              <span className="font-mono font-semibold text-[var(--text)] dark:text-[#F4F4F5]">
                                {doc.docNo}
                              </span>
                              <span className="font-mono text-[11px] text-[var(--text-muted)] dark:text-[#A1A1AA]">
                                {doc.date || '-'}
                              </span>
                              {typeof doc.totalIdr === 'number' && doc.totalIdr > 0 && (
                                <span className="font-mono text-[11px] font-semibold text-[var(--text)] dark:text-[#F4F4F5]">
                                  {formatIdr(doc.totalIdr)}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <ErpStatusBadge
                                statusCode={doc.statusCode}
                                mode={doc.type === 'GRN' ? 'grn' : 'standard'}
                                rawLabel={doc.statusLabel}
                              />
                              {doc.type !== 'VP' && (
                                <button
                                  type="button"
                                  onClick={() => handleJumpToRelatedDoc(doc)}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-[var(--surface-2)] hover:bg-[var(--accent)] hover:text-[var(--on-accent)] border border-[var(--border)] text-[var(--text)] transition-colors cursor-pointer"
                                >
                                  <span>Buka</span>
                                  <ArrowRight className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
