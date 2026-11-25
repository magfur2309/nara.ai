import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchApiJson } from '../../lib/apiClient';
import { getFreshIdToken } from '../../lib/firebase';
import { getLastDayOfMonth } from './biFinanceShared';

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
export { downloadCsvFile } from './biSalesShared';

/* ============================================================================
 * Purchasing BI Types (12 Sales-Aligned KPIs for m4_*)
 * ========================================================================== */

export interface ErpPurchasingBiMonthlyRow {
  month: string;
  // 01 & 03: Supplier Growth & Turnover
  activeSuppliersRi: number;
  prevSuppliersRi: number;
  activeSuppliersPo: number;
  prevSuppliersPo: number;
  churnedSuppliersPrevMonth: number;
  churnedSuppliersRolling3m: number;
  // 04: Purchase Opportunity
  poCount: number;
  prevPoCount: number;
  // 06 & 06B: PO Realization & Unfulfilled
  poItemQty: number;
  poRealizedQty: number;
  poOrderValue: number;
  poRealizedValue: number;
  // 07: Purchase Close Index (Complete)
  poCompleteCount: number;
  poCompleteOrCloseCount: number;
  poTotalValue: number;
  poCompleteValue: number;
  poCompleteOrCloseValue: number;
  // 08: Purchase Price Index (PPI)
  ppiPrevTotalPrice: number;
  ppiCurrTotalPrice: number;
  ppiItemCount: number;
  ppiPct: number;
  // 09: Receiving On Time
  grnTotalCount: number;
  grnLinkedPoCount: number;
  grnOnTimeCount: number;
  riTotalCount: number;
  riLinkedPoCount: number;
  riOnTimeCount: number;
  // 10 & 10B: Purchase Return & Mismatch
  returnDocCount: number;
  riInvoiceCount: number;
  returnQty: number;
  purchasedQty: number;
  returnValueIdr: number;
  riDppIdr: number;
  mismatchQty: number;
  receivedQty: number;
}

export interface ErpPurchasingBiSupplierRow {
  supplierId: number;
  supplierCode: string;
  supplierName: string;
  invoiceCount: number;
  dppIdr: number;
  paidIdr: number;
  payableIdr: number;
  sharePct: number;
  returnValueIdr: number;
  grnLinkedCount: number;
  grnOnTimeCount: number;
  otdPct: number | null;
}

export interface ErpPurchasingBiPpiItemDetail {
  itemId: number;
  itemCode: string;
  itemName: string;
  prevPrice: number;
  currPrice: number;
  varianceIdr: number;
  variancePct: number;
}

export interface ErpPurchasingBiReturnItemDetail {
  itemId: number;
  itemCode: string;
  itemName: string;
  returnQty: number;
  purchasedQty: number;
  returnPct: number;
}

export interface ErpPurchasingBiMismatchItemDetail {
  itemId: number;
  itemCode: string;
  itemName: string;
  returnQty: number;
  qtyDiff: number;
  mismatchQty: number;
  receivedQty: number;
  mismatchPct: number;
}

export interface ErpPurchasingBiLeadTimeItemRow {
  itemId: number;
  itemCode: string;
  itemName: string;
  totalDeliveries: number;
  avgLeadDays: number;
  dayBuckets: number[]; // length 15: index 0..14 = 0..14 Hari
  over14Days: number;
}

export interface ErpPurchasingBiQueryResult {
  cutoffDate: string;
  period: { dateFrom: string; dateTo: string };
  coverage: {
    minDateAll: string;
    maxDateAll: string;
    minDateActive: string;
    maxDateActive: string;
  };
  masterSuppliers: {
    total: number;
    active: number;
    inactive: number;
  };
  diagnostics: {
    tablesDetected: string[];
    realizationSource: 'm4_grn_detail' | 'm4_ri_detail' | 'm4_po_detail' | 'm4_po_status' | 'unavailable';
    otdBasis: 'po_potgldipenuhi' | 'po_potgl_plus7' | 'unavailable';
    returnSource: 'm4_prt' | 'unavailable';
    leadTimeSource: 'm4_grn_po_detail' | 'm4_grn_po_header' | 'unavailable';
  };
  monthly: ErpPurchasingBiMonthlyRow[];
  supplierSpend: ErpPurchasingBiSupplierRow[];
  ppiDetailsByMonth: Record<string, ErpPurchasingBiPpiItemDetail[]>;
  returnDetailsByMonth: Record<string, ErpPurchasingBiReturnItemDetail[]>;
  mismatchDetailsByMonth: Record<string, ErpPurchasingBiMismatchItemDetail[]>;
  receivingLeadTimeItems: ErpPurchasingBiLeadTimeItemRow[];
  fetchedAt: string;
}

/* ============================================================================
 * Inventory BI Types
 * ========================================================================== */

export interface ErpInventoryBiWarehouseRow {
  warehouseCode: string;
  warehouseName: string;
  skuCount: number;
  inStockSkuCount: number;
  zeroStockCount: number;
  lowStockCount: number;
  totalQty: number;
  stockValueIdr: number;
  valueSharePct: number;
}

export interface ErpInventoryBiCategoryRow {
  category: string;
  skuCount: number;
  zeroStockCount: number;
  lowStockCount: number;
  totalQty: number;
  stockValueIdr: number;
  valueSharePct: number;
}

export interface ErpInventoryBiIntransitItem {
  itemId: number;
  code: string;
  name: string;
  warehouse: string;
  unit: string;
  qty: number;
  unitCost: number;
  estimatedValueIdr: number;
}

export interface ErpInventoryBiAbcClassSummary {
  abcClass: 'A' | 'B' | 'C';
  skuCount: number;
  skuSharePct: number;
  totalQty: number;
  stockValueIdr: number;
  valueSharePct: number;
}

export interface ErpInventoryBiSkuRow {
  itemId: number;
  code: string;
  name: string;
  category: string;
  unit: string;
  physicalQty: number;
  minStock: number | null;
  maxStock: number | null;
  unitCost: number;
  stockValueIdr: number;
  cumulativeValuePct: number;
  abcClass: 'A' | 'B' | 'C' | 'N/A';
  healthStatus: 'out_of_stock' | 'low_stock' | 'healthy' | 'overstock';
  velocityClass: 'fast' | 'medium' | 'slow' | 'dead';
  inflowQty: number;
  outflowQty: number;
  outflowFreq: number;
  lastOutDate: string;
  daysSinceLastOut: number | null;
}

export interface ErpInventoryBiVelocityBucket {
  velocityClass: 'fast' | 'medium' | 'slow' | 'dead';
  label: string;
  skuCount: number;
  totalQty: number;
  stockValueIdr: number;
  valueSharePct: number;
}

export interface ErpInventoryBiMonthlyRow {
  month: string;
  grnInQty: number;
  grnInValue: number;
  doOutQty: number;
  siOutQty: number;
  siOutValue: number;
  netQtyMovement: number;
  glCogs: number;
  glInventoryEnding: number;
  itrAnnualized: number | null;
  dioDays: number | null;
}

export interface ErpInventoryBiQueryResult {
  cutoffDate: string;
  period: { dateFrom: string; dateTo: string };
  summary: {
    totalActivePhysicalSkus: number;
    inStockSkus: number;
    lowStockSkus: number;
    outOfStockSkus: number;
    overStockSkus: number;
    stockoutRatePct: number;
    totalPhysicalQty: number;
    totalPhysicalValueIdr: number;
    glInventoryBalanceIdr: number;
    valuationVarianceVsGlIdr: number;
    totalPeriodInflowQty: number;
    totalPeriodOutflowQty: number;
  };
  diagnostics: {
    costSource: 'm1_item_hpp' | 'm4_ri_last_price' | 'mixed_item_and_ri' | 'unavailable';
    minStockSource: string | null;
    outflowSource: 'm5_do_detail' | 'm5_si_detail' | 'unavailable';
    inflowSource: 'm4_grn_detail' | 'm4_ri_detail' | 'unavailable';
    tablesDetected: string[];
    intransitStrictlyExcluded: true;
  };
  warehouses: ErpInventoryBiWarehouseRow[];
  categories: ErpInventoryBiCategoryRow[];
  intransit: {
    skuCount: number;
    totalQty: number;
    estimatedValueIdr: number;
    warehouses: Array<{
      warehouse: string;
      skuCount: number;
      totalQty: number;
      estimatedValueIdr: number;
    }>;
    topItems: ErpInventoryBiIntransitItem[];
  };
  abcSummary: ErpInventoryBiAbcClassSummary[];
  abcTopItems: ErpInventoryBiSkuRow[];
  criticalStockItems: ErpInventoryBiSkuRow[];
  velocitySummary: ErpInventoryBiVelocityBucket[];
  slowDeadItems: ErpInventoryBiSkuRow[];
  monthly: ErpInventoryBiMonthlyRow[];
  fetchedAt: string;
}

/* ============================================================================
 * Production BI Types
 * ========================================================================== */

export interface ErpProductionDiscoveredTable {
  tableName: string;
  role: 'work_order' | 'output' | 'material_issue' | 'bom' | 'quality' | 'detail' | 'other';
  rowCount: number;
  dateColumn: string | null;
  columns: string[];
}

export interface ErpProductionBiMonthlyRow {
  month: string;
  soCount: number;
  soItemQty: number;
  soTotalValue: number;
  woCount: number;
  woLinkedToSoCount: number;
  soLinkedToWoCount: number;
  woUnlinkedCount: number;
  soWithoutWoCount: number;
  woToSoPct: number | null;
  soCoveredByWoPct: number | null;
  woVsSoRatioPct: number | null;
  plannedQty: number;
  actualOutputQty: number;
  achievementPct: number | null;
  outputDocCount: number;
  woCompleteOnlyCount: number;
  woCompleteCount: number;
  woInProgressCount: number;
  woOpenCount: number;
  woCompletionRatePct: number | null;
  goodQty: number;
  rejectQty: number;
  yieldPct: number | null;
  rejectRatePct: number | null;
  plannedMaterialQty: number;
  actualMaterialQty: number;
  materialVariancePct: number | null;
  materialIssueCostIdr: number;
  glMaterialCost: number;
  glLaborCost: number;
  glOverheadCost: number;
  glOtherProdCost: number;
  glTotalProdCost: number;
  unitCostIdr: number | null;
}

export interface ErpProductionBiWoSoLinkRow {
  woDocNo: string;
  woDate: string;
  woStatusLabel: string;
  woQty: number;
  isLinkedToSo: boolean;
  soDocNo: string;
  soDate: string;
  customerName: string;
  soTotalValue: number;
}

export interface ErpProductionBiWorkOrderRow {
  docNo: string;
  date: string;
  targetDate: string;
  itemName: string;
  plannedQty: number;
  actualQty: number;
  statusLabel: string;
  ageDays: number;
}

export interface ErpProductionBiProductQualityRow {
  itemCode: string;
  itemName: string;
  goodQty: number;
  rejectQty: number;
  totalQty: number;
  yieldPct: number;
}

export interface ErpProductionBiMaterialRow {
  itemCode: string;
  itemName: string;
  unit: string;
  plannedQty: number;
  actualQty: number;
  varianceQty: number;
  costIdr: number;
}

export interface ErpProductionBiGlAccountRow {
  accountNo: string;
  accountName: string;
  costGroup: 'Bahan Baku' | 'Tenaga Kerja' | 'Overhead Pabrik' | 'Biaya Produksi Lainnya';
  entryCount: number;
  amountIdr: number;
}

export type WoSoLinkMethod =
  | 'wo_header_idso'
  | 'wo_header_noso'
  | 'wo_detail_idso'
  | 'so_header_idwo'
  | 'so_detail_idwo'
  | 'unlinked_no_fk_column'
  | 'no_wo_table';

export interface ErpProductionBiQueryResult {
  cutoffDate: string;
  period: { dateFrom: string; dateTo: string };
  discoveredTables: ErpProductionDiscoveredTable[];
  diagnostics: {
    hasM6Tables: boolean;
    hasM6TransactionsInPeriod: boolean;
    hasSalesOrderTable: boolean;
    workOrderTable: string | null;
    outputTable: string | null;
    materialTable: string | null;
    woSoLinkMethod: WoSoLinkMethod;
    woSoLinkColumn: string | null;
    qualitySource: 'm6_reject_column' | 'm6_qc_table' | 'unavailable';
    hasGlProductionCosts: boolean;
    totalGlProductionCostIdr: number;
  };
  monthly: ErpProductionBiMonthlyRow[];
  woSoLinks: ErpProductionBiWoSoLinkRow[];
  openWorkOrders: ErpProductionBiWorkOrderRow[];
  productQuality: ErpProductionBiProductQualityRow[];
  topMaterials: ErpProductionBiMaterialRow[];
  glProductionAccounts: ErpProductionBiGlAccountRow[];
  fetchedAt: string;
}

/* ============================================================================
 * Generic Period Hook Factory for Operational BI Modules
 * ========================================================================== */

function useBiModulePeriodData<T>(
  endpointPath: string,
  defaultError: string,
  idToken: string | null
) {
  const now = new Date();
  const currentYear = Math.max(2026, now.getFullYear());

  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [startMonth, setStartMonth] = useState<number>(1);
  const [endMonth, setEndMonth] = useState<number>(12);

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const effectiveStart = Math.min(startMonth, endMonth);
  const effectiveEnd = Math.max(startMonth, endMonth);

  const dateFrom = `${selectedYear}-${String(effectiveStart).padStart(2, '0')}-01`;
  const dateTo = getLastDayOfMonth(selectedYear, effectiveEnd);

  const availableYears = useMemo(() => {
    const yrs = new Set<number>([2026, currentYear, selectedYear]);
    return Array.from(yrs).sort((a, b) => b - a);
  }, [currentYear, selectedYear]);

  const fetchData = useCallback(
    async (opts?: { refresh?: boolean }) => {
      const isRefresh = Boolean(opts?.refresh);
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setErrorMsg(null);

      try {
        const token = (await getFreshIdToken()) || idToken;
        if (!token) throw new Error('Sesi autentikasi tidak ditemukan. Silakan masuk ulang.');

        const qs = new URLSearchParams();
        qs.set('dateFrom', dateFrom);
        qs.set('dateTo', dateTo);
        if (isRefresh) qs.set('refresh', '1');

        const res = await fetchApiJson<T>(`${endpointPath}?${qs.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setData(res);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : defaultError);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [dateFrom, dateTo, defaultError, endpointPath, idToken]
  );

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const applyPreset = (from: number, to: number) => {
    setStartMonth(from);
    setEndMonth(to);
  };

  const resetToActivePeriod = () => {
    setSelectedYear(currentYear);
    setStartMonth(3);
    setEndMonth(12);
  };

  return {
    selectedYear,
    setSelectedYear,
    startMonth,
    setStartMonth,
    endMonth,
    setEndMonth,
    effectiveStart,
    effectiveEnd,
    availableYears,
    data,
    loading,
    refreshing,
    errorMsg,
    fetchData,
    applyPreset,
    resetToActivePeriod,
  };
}

export function useBiPurchasingPeriodData(idToken: string | null) {
  return useBiModulePeriodData<ErpPurchasingBiQueryResult>(
    '/api/erp/purchasing-bi',
    'Gagal memuat data Business Intelligence Purchasing dari ERP.',
    idToken
  );
}

export function useBiInventoryPeriodData(idToken: string | null) {
  return useBiModulePeriodData<ErpInventoryBiQueryResult>(
    '/api/erp/inventory-bi',
    'Gagal memuat data Business Intelligence Inventory dari ERP.',
    idToken
  );
}

export function useBiProductionPeriodData(idToken: string | null) {
  return useBiModulePeriodData<ErpProductionBiQueryResult>(
    '/api/erp/production-bi',
    'Gagal memuat data Business Intelligence Production dari ERP.',
    idToken
  );
}
