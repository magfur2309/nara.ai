import mysql from 'mysql2/promise';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { AllowedAiDataScopes } from '../src/config/menuRegistry.ts';

export interface ErpStockItem {
  code: string;
  name: string;
  warehouse: string;
  qty: number;
  unit: string;
  category: string;
  extra?: Record<string, string | number | null>;
}

export interface ErpWarehouseSummary {
  warehouse: string;
  skuCount: number;
  totalQty: number;
  zeroStockCount: number;
}

export interface ErpWarehouseMasterItem {
  code: string;
  name: string;
  isActive: boolean;
  isIntransit: boolean;
  skuCount: number;
  totalQty: number;
  zeroStockCount: number;
  source: 'm1_warehouse' | 'stock_summary';
}

export interface ErpWarehousesMasterResult {
  warehouses: ErpWarehouseMasterItem[];
  sourceMode: 'mysql_direct' | 'bridge_v11' | 'bridge_fallback_stock';
  totalMasterCount: number;
  physicalCount: number;
  intransitCount: number;
  fetchedAt: string;
  warning?: string;
}

export interface ErpStockCategorySummary {
  category: string;
  skuCount: number;
  totalQty: number;
  zeroStockCount: number;
}

export interface ErpColumnMapping {
  viewName: string;
  codeCol: string | null;
  nameCol: string | null;
  warehouseCol: string | null;
  qtyCol: string | null;
  unitCol: string | null;
  categoryCol: string | null;
  allColumns: string[];
}

export interface ErpConnectionStatus {
  configured: boolean;
  connected: boolean;
  mode?: 'bridge' | 'direct';
  stockMode?: 'myerpplus' | 'custom';
  salesSupported?: boolean;
  financeSupported?: boolean;
  assetsSupported?: boolean;
  purchasingSupported?: boolean;
  employeesSupported?: boolean;
  activeCutoffDate?: string;
  viewName: string;
  hostPreview: string;
  port: number;
  database: string;
  sslEnabled: boolean;
  latencyMs?: number;
  totalRows?: number;
  warehouses?: string[];
  availableTables?: string[];
  detectedColumns?: ErpColumnMapping;
  error?: string;
}

export interface ErpIntransitSummary {
  skuCount: number;
  totalQty: number;
  zeroStockCount: number;
  warehouses: string[];
}

export interface ErpStockQueryResult {
  items: ErpStockItem[];
  warehouses: ErpWarehouseSummary[];
  categories?: ErpStockCategorySummary[];
  selectedCategory?: string;
  activeOnly?: boolean;
  inventoryOnly?: boolean;
  intransitExcluded?: boolean;
  intransitBridgeNative?: boolean;
  intransitOnly?: boolean;
  intransitSummary?: ErpIntransitSummary;
  qtySort?: 'asc' | 'desc' | '';
  totalRows: number;
  totalActiveRows?: number;
  viewName: string;
  detectedColumns: ErpColumnMapping;
  fetchedAt: string;
}

/**
 * Identifies virtual Gudang Intransit (goods already shipped via DO, not yet invoiced via SI).
 * Physically NOT in the warehouse — MUST be excluded from all physical/available stock checks,
 * while remaining included in accounting inventory valuation / HPP / Balance Sheet.
 */
export function isIntransitWarehouseName(value: string | null | undefined): boolean {
  const raw = String(value || '').trim();
  if (!raw) return false;
  return /\bin[\s_-]*transit\b/i.test(raw) || raw.toLowerCase().replace(/[\s_-]+/g, '').includes('intransit');
}

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
  cutoffDate?: string;
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

export type ErpMappedOperationalCategory =
  | 'Kendaraan'
  | 'Meja'
  | 'Kursi'
  | 'Bangunan'
  | 'Elektronik & IT'
  | 'Mesin & Peralatan'
  | 'Lainnya';

export interface ErpAssetItem {
  id: number;
  assetCode: string;
  name: string;
  categoryCode: string;
  categoryName: string;
  mappedCategory: ErpMappedOperationalCategory;
  branch: string;
  location: string;
  division: string;
  subDivision: string;
  costCenter: string;
  serialOrPlate: string;
  notes: string;
  purchaseDate: string;
  useDate: string;
  retireDate: string;
  quantity: number;
  unit: string;
  currency: string;
  acquisitionCost: number;
  residualValue: number;
  monthlyDepreciation: number;
  accumulatedDepreciation: number;
  netBookValue: number;
  usefulLifeRaw: number;
  usefulLifeMonths: number;
  usefulLifeYears: number;
  usefulLifeUnit: 'years' | 'months';
  depreciatedMonths: number;
  remainingLifeMonths: number;
  depreciationMethod: string;
  coaAsset: string;
  coaAssetName: string;
  coaAccumDep: string;
  coaDepExpense: string;
  isDisposed: boolean;
  isClosed: boolean;
  isFullyDepreciated: boolean;
  isIntangible: boolean;
  statusCode: number;
  statusLabel: string;
}

export interface ErpAssetCategorySummary {
  categoryCode: string;
  categoryName: string;
  mappedCategory: ErpMappedOperationalCategory;
  assetCount: number;
  totalQty: number;
  acquisitionCost: number;
  accumulatedDepreciation: number;
  netBookValue: number;
  monthlyDepreciation: number;
}

export interface ErpAssetKpi {
  totalAssets: number;
  totalQty: number;
  disposedCount: number;
  fullyDepreciatedCount: number;
  expiringWithin12MonthsCount: number;
  vehicleCount: number;
  totalAcquisitionCost: number;
  totalAccumulatedDepreciation: number;
  totalNetBookValue: number;
  totalMonthlyDepreciation: number;
}

export interface ErpAssetsQueryResult {
  sourceTable: string;
  kpi: ErpAssetKpi;
  byCategory: ErpAssetCategorySummary[];
  items: ErpAssetItem[];
  totalMatched: number;
  fetchedAt: string;
}

export interface ErpPurchasingKpi {
  // 100% Laporan Keuangan (m2_transaction_journal)
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
  // Sub-ledger operasional (m4_*)
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
  apAging: ErpFinanceArAging;
  topApContactsGl: ErpFinanceContactBalanceRow[];
  topSuppliers: ErpPurchasingTopSupplier[];
  topItems: ErpPurchasingTopItem[];
  invoices: ErpPurchasingInvoiceRow[];
  unpaidInvoices: ErpPurchasingInvoiceRow[];
  purchaseOrders: ErpPurchasingOrderRow[];
  goodsReceipts: ErpPurchasingGrnRow[];
  purchaseRequests: ErpPurchasingPrRow[];
  relationsSupported?: boolean;
  poOutstandingStrict?: boolean;
  fetchedAt: string;
}

export interface ErpStockAiContext {
  configured: boolean;
  connected: boolean;
  totalRows: number;
  matchedCount: number;
  summaryText: string;
  deniedDomains?: string[];
}

export interface ErpEmployeeRecord {
  id: number;
  code: string;
  name: string;
  category: string;
  division: string;
  jobTitle: string;
  email: string;
  phone: string;
  secondaryPhone: string;
  whatsappNormalized: string;
  address: string;
  isActive: boolean;
  isEmployeeFlag: boolean;
  missingFields: ('email' | 'phone')[];
}

export interface ErpEmployeesQueryResult {
  sourceTable: string;
  totalContactsScanned: number;
  totalEmployees: number;
  readyEmailCount: number;
  readyWhatsappCount: number;
  readyBothCount: number;
  missingEmailCount: number;
  missingPhoneCount: number;
  detectedColumns: {
    idCol: string | null;
    codeCol: string | null;
    nameCol: string | null;
    emailCol: string | null;
    phoneCol: string | null;
    secondaryPhoneCol: string | null;
    activeCol: string | null;
    employeeFlagCol: string | null;
    categoryCol: string | null;
    divisionCol: string | null;
    jobTitleCol: string | null;
    addressCol: string | null;
    allColumns: string[];
  };
  categoryValues: string[];
  filterMode: 'employee_only' | 'all_contacts';
  employees: ErpEmployeeRecord[];
  fetchedAt: string;
}

export const ACTIVE_ERP_CUTOFF_DATE = '2026-03-01';
const ANOMALY_ABS_THRESHOLD = 1e14;

function clampActiveDateFrom(rawDateFrom?: string): string {
  const s = (rawDateFrom || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) && s >= ACTIVE_ERP_CUTOFF_DATE) {
    return s;
  }
  return ACTIVE_ERP_CUTOFF_DATE;
}

export const M0_STATUS_LABELS: Record<number, string> = {
  [-2]: 'Semua',
  [-1]: 'Aktif',
  0: 'Draft',
  1: 'Need Approve',
  2: 'Approved',
  3: 'Inprogress',
  4: 'Complete',
  5: 'Revision',
  6: 'Reject',
  7: 'Close',
  8: 'Approve 1',
  9: 'Approve 2',
  10: 'Approve 3',
  11: 'Approve 4',
  12: 'Delete',
};

function getM0StatusLabel(code: unknown): string {
  const num = Number(code);
  if (!Number.isFinite(num)) return 'Unknown';
  return M0_STATUS_LABELS[num] || `Status ${num}`;
}

const SAFE_SQL_IDENTIFIER_REGEX = /^[a-zA-Z0-9_]{1,64}$/;

function sanitizeIdentifier(raw: string | undefined): string {
  const cleaned = (raw || '').trim().replace(/^`+|`+$/g, '');
  if (!cleaned || !SAFE_SQL_IDENTIFIER_REGEX.test(cleaned)) {
    return '';
  }
  return cleaned;
}

function parseHostAndPort(rawHost: string, rawPort: string): {
  host: string;
  port: number;
  looksLikeHttpTunnel: boolean;
} {
  let cleaned = rawHost.trim().replace(/^["']+|["']+$/g, '').trim();
  const looksLikeHttpTunnel =
    /^https?:\/\//i.test(cleaned) ||
    (/ngrok-free\.(app|dev)|\.ngrok\.app\b/i.test(cleaned) && !/\.tcp\./i.test(cleaned));

  // Strip tcp://, mysql://, http://, https:// prefixes and trailing slashes
  cleaned = cleaned.replace(/^(?:tcp|mysql|https?):\/\//i, '').replace(/\/.*$/, '').trim();

  let extractedPort: number | undefined;
  const colonIdx = cleaned.lastIndexOf(':');
  if (colonIdx > 0 && /^\d+$/.test(cleaned.slice(colonIdx + 1))) {
    extractedPort = Number(cleaned.slice(colonIdx + 1));
    cleaned = cleaned.slice(0, colonIdx).trim();
  }

  const envPort = Number(rawPort);
  const chosenPort =
    Number.isFinite(envPort) && envPort > 0
      ? envPort
      : extractedPort && Number.isFinite(extractedPort)
        ? extractedPort
        : 3306;

  return {
    host: cleaned,
    port: Math.max(1, Math.min(65535, Math.round(chosenPort))),
    looksLikeHttpTunnel,
  };
}

function getErpMysqlConfig() {
  const { host, port, looksLikeHttpTunnel } = parseHostAndPort(
    process.env.ERP_MYSQL_HOST || '',
    process.env.ERP_MYSQL_PORT || ''
  );
  const database = (process.env.ERP_MYSQL_DATABASE || '').trim();
  const user = (process.env.ERP_MYSQL_USER || '').trim();
  const password = process.env.ERP_MYSQL_PASSWORD || '';
  const sslRaw = (process.env.ERP_MYSQL_SSL || '').trim().toLowerCase();
  const sslEnabled = sslRaw === 'true' || sslRaw === '1' || sslRaw === 'require';
  const viewName = sanitizeIdentifier(process.env.ERP_MYSQL_STOCK_VIEW || 'vw_ai_stok_barang');

  const configured = Boolean(host && database && user && viewName);

  return {
    configured,
    host,
    port,
    looksLikeHttpTunnel,
    database,
    user,
    password,
    sslEnabled,
    viewName,
    colOverrides: {
      code: sanitizeIdentifier(process.env.ERP_MYSQL_COL_CODE),
      name: sanitizeIdentifier(process.env.ERP_MYSQL_COL_NAME),
      warehouse: sanitizeIdentifier(process.env.ERP_MYSQL_COL_WAREHOUSE),
      qty: sanitizeIdentifier(process.env.ERP_MYSQL_COL_QTY),
      unit: sanitizeIdentifier(process.env.ERP_MYSQL_COL_UNIT),
      category: sanitizeIdentifier(process.env.ERP_MYSQL_COL_CATEGORY),
    },
  };
}

export function getErpBridgeConfig() {
  const rawUrl = (process.env.ERP_BRIDGE_URL || '').trim().replace(/^["']+|["']+$/g, '').trim();
  const baseUrl = rawUrl.replace(/\/+$/, '');
  const token = (process.env.ERP_BRIDGE_TOKEN || '').trim().replace(/^["']+|["']+$/g, '').trim();
  const validUrl = /^https?:\/\/[^/\s]+/i.test(baseUrl);
  return {
    configured: Boolean(validUrl),
    baseUrl,
    token,
  };
}

export function isErpMysqlConfigured(): boolean {
  return getErpBridgeConfig().configured || getErpMysqlConfig().configured;
}

function maskUrlHost(baseUrl: string): string {
  try {
    const u = new URL(baseUrl);
    return maskHostPreview(u.hostname);
  } catch {
    return maskHostPreview(baseUrl);
  }
}

export async function fetchErpBridgeJson<T>(pathAndQuery: string): Promise<T> {
  const bridge = getErpBridgeConfig();
  if (!bridge.configured) {
    throw new Error('ERP_BRIDGE_URL belum dikonfigurasi.');
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'ngrok-skip-browser-warning': 'true',
  };
  if (bridge.token) {
    headers.Authorization = `Bearer ${bridge.token}`;
  }

  let res: globalThis.Response;
  try {
    res = await fetch(`${bridge.baseUrl}${pathAndQuery}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Tidak dapat menghubungi bridge lokal ERP (${msg}). Pastikan skrip "node erp-mysql-bridge.mjs" dan ".\\ngrok http 3099" sedang berjalan di PC lokal Anda.`
    );
  }

  const rawText = await res.text();
  if (rawText.includes('ERR_NGROK_3200') || rawText.includes('is offline')) {
    throw new Error(
      'Tunnel ngrok sedang offline (ERR_NGROK_3200). Jalankan kembali ".\\ngrok http 3099" di PC lokal Anda dan pastikan ERP_BRIDGE_URL sesuai URL ngrok terbaru.'
    );
  }
  if (rawText.includes('ERR_NGROK_8012') || res.status === 502) {
    throw new Error(
      'Tunnel ngrok aktif, tetapi server bridge lokal di port 3099 belum menyala (502 Bad Gateway). Jalankan "node erp-mysql-bridge.mjs" di PowerShell PC lokal Anda.'
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(
      `Respons dari ERP_BRIDGE_URL bukan JSON valid (HTTP ${res.status}). Pastikan URL mengarah ke erp-mysql-bridge.mjs di localhost:3099.`
    );
  }

  if (!res.ok) {
    const errMsg =
      typeof parsed === 'object' && parsed !== null && 'error' in parsed
        ? String((parsed as { error?: unknown }).error || '')
        : '';
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        errMsg ||
          'Token otorisasi bridge ditolak (401). Pastikan ERP_BRIDGE_TOKEN di Settings > Secrets sama persis dengan BRIDGE_TOKEN di skrip lokal Anda.'
      );
    }
    if (res.status === 404 && pathAndQuery.startsWith('/assets')) {
      throw new Error(
        'Bridge lokal yang sedang berjalan di PC Anda belum mendukung endpoint /assets (HTTP 404). Unduh Bridge v5 (.mjs) terbaru, hentikan proses node lama (Ctrl+C), lalu jalankan ulang "node erp-mysql-bridge.mjs".'
      );
    }
    if (res.status === 404 && pathAndQuery.startsWith('/purchasing-bi')) {
      throw new Error(
        'Bridge lokal yang sedang berjalan di PC Anda belum mendukung endpoint /purchasing-bi untuk Business Intelligence Purchasing (HTTP 404). Klik "Unduh Bridge Terbaru", hentikan proses node lama (Ctrl+C), lalu jalankan ulang "node erp-mysql-bridge.mjs".'
      );
    }
    if (res.status === 404 && pathAndQuery.startsWith('/inventory-bi')) {
      throw new Error(
        'Bridge lokal yang sedang berjalan di PC Anda belum mendukung endpoint /inventory-bi untuk Business Intelligence Inventory (HTTP 404). Klik "Unduh Bridge Terbaru", hentikan proses node lama (Ctrl+C), lalu jalankan ulang "node erp-mysql-bridge.mjs".'
      );
    }
    if (res.status === 404 && pathAndQuery.startsWith('/production-bi')) {
      throw new Error(
        'Bridge lokal yang sedang berjalan di PC Anda belum mendukung endpoint /production-bi untuk Business Intelligence Production (HTTP 404). Klik "Unduh Bridge Terbaru", hentikan proses node lama (Ctrl+C), lalu jalankan ulang "node erp-mysql-bridge.mjs".'
      );
    }
    if (res.status === 404 && pathAndQuery.startsWith('/purchasing')) {
      throw new Error(
        'Bridge lokal yang sedang berjalan di PC Anda belum mendukung endpoint /purchasing (HTTP 404). Unduh Bridge terbaru (.mjs), hentikan proses node lama (Ctrl+C), lalu jalankan ulang "node erp-mysql-bridge.mjs".'
      );
    }
    if (res.status === 404 && pathAndQuery.startsWith('/employees')) {
      throw new Error(
        'Bridge lokal yang sedang berjalan di PC Anda belum mendukung endpoint /employees untuk m1_contact (HTTP 404). Unduh Bridge terbaru (.mjs), hentikan proses node lama (Ctrl+C), lalu jalankan ulang "node erp-mysql-bridge.mjs".'
      );
    }
    if (res.status === 404 && pathAndQuery.startsWith('/sales-bi')) {
      throw new Error(
        'Bridge lokal yang sedang berjalan di PC Anda belum mendukung endpoint /sales-bi untuk Business Intelligence Sales (HTTP 404). Klik "Unduh Bridge Terbaru", hentikan proses node lama (Ctrl+C), lalu jalankan ulang "node erp-mysql-bridge.mjs".'
      );
    }
    throw new Error(errMsg || `Bridge ERP mengembalikan error HTTP ${res.status}.`);
  }

  return parsed as T;
}

function maskHostPreview(host: string): string {
  if (!host) return '';
  if (host.length <= 6) return '***';
  const parts = host.split('.');
  if (parts.length >= 2) {
    return `${parts[0].slice(0, 3)}***.${parts[parts.length - 1]}`;
  }
  return `${host.slice(0, 3)}***${host.slice(-2)}`;
}

let cachedPool: Pool | null = null;
let cachedPoolSignature = '';

function getPool(): Pool {
  const cfg = getErpMysqlConfig();
  if (!cfg.configured) {
    throw new Error(
      'Koneksi MySQL ERP belum dikonfigurasi. Lengkapi ERP_MYSQL_HOST, ERP_MYSQL_DATABASE, ERP_MYSQL_USER, ERP_MYSQL_PASSWORD, dan ERP_MYSQL_STOCK_VIEW di pengaturan Secrets/Environment.'
    );
  }

  const signature = `${cfg.host}|${cfg.port}|${cfg.database}|${cfg.user}|${cfg.password.length}|${cfg.sslEnabled}`;
  if (cachedPool && cachedPoolSignature === signature) {
    return cachedPool;
  }

  if (cachedPool) {
    void cachedPool.end().catch(() => {});
  }

  cachedPool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    waitForConnections: true,
    connectionLimit: 3,
    maxIdle: 2,
    idleTimeout: 30_000,
    connectTimeout: 8_000,
    decimalNumbers: true,
    dateStrings: true,
    ssl: cfg.sslEnabled ? { rejectUnauthorized: false } : undefined,
  });
  cachedPoolSignature = signature;
  return cachedPool;
}

export async function withReadOnlyConnection<T>(
  fn: (conn: mysql.PoolConnection) => Promise<T>
): Promise<T> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    try {
      await conn.query('SET SESSION TRANSACTION READ ONLY');
    } catch {
      // Older MySQL/MariaDB variants may not support session read-only mode
    }
    try {
      await conn.query('SET SESSION MAX_EXECUTION_TIME = 5000');
    } catch {
      // MariaDB uses max_statement_time; safely ignore if unsupported
    }
    return await fn(conn);
  } finally {
    conn.release();
  }
}

const COLUMN_CACHE_TTL_MS = 5 * 60 * 1000;
let cachedColumns: { expiresAt: number; signature: string; mapping: ErpColumnMapping } | null = null;

function pickColumn(
  allColumns: string[],
  override: string,
  candidates: string[]
): string | null {
  const lowerMap = new Map(allColumns.map((c) => [c.toLowerCase(), c]));
  if (override && lowerMap.has(override.toLowerCase())) {
    return lowerMap.get(override.toLowerCase())!;
  }
  for (const cand of candidates) {
    if (lowerMap.has(cand.toLowerCase())) {
      return lowerMap.get(cand.toLowerCase())!;
    }
  }
  for (const cand of candidates) {
    const partial = allColumns.find((col) => col.toLowerCase().includes(cand.toLowerCase()));
    if (partial) return partial;
  }
  return null;
}

async function resolveStockColumns(conn: mysql.PoolConnection): Promise<ErpColumnMapping> {
  const cfg = getErpMysqlConfig();
  const signature = `${cfg.host}|${cfg.database}|${cfg.viewName}|${JSON.stringify(cfg.colOverrides)}`;
  if (cachedColumns && cachedColumns.signature === signature && Date.now() < cachedColumns.expiresAt) {
    return cachedColumns.mapping;
  }

  const [rows] = await conn.query<RowDataPacket[]>(`SHOW COLUMNS FROM \`${cfg.viewName}\``);
  const allColumns = rows
    .map((r) => String(r.Field || r.field || '').trim())
    .filter((c) => SAFE_SQL_IDENTIFIER_REGEX.test(c));

  if (allColumns.length === 0) {
    throw new Error(`View/tabel "${cfg.viewName}" tidak memiliki kolom yang dapat dibaca.`);
  }

  const codeCol = pickColumn(allColumns, cfg.colOverrides.code, [
    'kode_barang',
    'kode_brg',
    'kd_brg',
    'kd_barang',
    'item_code',
    'product_code',
    'sku',
    'part_no',
    'kode',
    'code',
  ]);
  const nameCol = pickColumn(allColumns, cfg.colOverrides.name, [
    'nama_barang',
    'nama_brg',
    'nm_brg',
    'nm_barang',
    'item_name',
    'product_name',
    'nama_produk',
    'description',
    'deskripsi',
    'nama',
    'name',
  ]);
  const warehouseCol = pickColumn(allColumns, cfg.colOverrides.warehouse, [
    'gudang',
    'nama_gudang',
    'nm_gudang',
    'kode_gudang',
    'warehouse_name',
    'warehouse',
    'wh_name',
    'wh_code',
    'lokasi_gudang',
    'lokasi',
    'cabang',
  ]);
  const qtyCol = pickColumn(allColumns, cfg.colOverrides.qty, [
    'qty_stok',
    'qty_akhir',
    'saldo_akhir',
    'stok_akhir',
    'qty_available',
    'on_hand',
    'stock_qty',
    'qty',
    'stok',
    'stock',
    'saldo',
    'jumlah',
    'quantity',
  ]);
  const unitCol = pickColumn(allColumns, cfg.colOverrides.unit, [
    'satuan',
    'uom',
    'unit',
    'sat',
  ]);
  const categoryCol = pickColumn(allColumns, cfg.colOverrides.category, [
    'kategori',
    'category',
    'group_barang',
    'grup',
    'jenis_barang',
    'jenis',
  ]);

  const mapping: ErpColumnMapping = {
    viewName: cfg.viewName,
    codeCol,
    nameCol,
    warehouseCol,
    qtyCol,
    unitCol,
    categoryCol,
    allColumns,
  };

  cachedColumns = {
    expiresAt: Date.now() + COLUMN_CACHE_TTL_MS,
    signature,
    mapping,
  };
  return mapping;
}

function formatMysqlError(err: unknown): string {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code || '')
      : '';
  const msg = err instanceof Error ? err.message : String(err || 'Gagal terhubung ke MySQL ERP.');

  if (code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH') {
    return `Server MySQL ERP tidak dapat dijangkau (${code}). Pastikan host/port dapat diakses dari cloud dan firewall mengizinkan koneksi.`;
  }
  if (code === 'ER_ACCESS_DENIED_ERROR') {
    return 'Akses ditolak oleh MySQL ERP (username/password salah atau host client belum diizinkan pada user MySQL).';
  }
  if (code === 'ER_BAD_DB_ERROR') {
    return 'Nama database (ERP_MYSQL_DATABASE) tidak ditemukan di server MySQL ERP.';
  }
  if (code === 'ER_NO_SUCH_TABLE') {
    return 'Tabel atau View stok (ERP_MYSQL_STOCK_VIEW) tidak ditemukan di database MySQL ERP.';
  }
  if (code === 'ER_TABLEACCESS_DENIED_ERROR' || code === 'ER_COLUMNACCESS_DENIED_ERROR') {
    return 'User MySQL read-only belum memiliki hak SELECT pada tabel/view stok barang yang dipilih.';
  }
  return msg;
}

export async function testErpMysqlConnection(): Promise<ErpConnectionStatus> {
  const bridgeCfg = getErpBridgeConfig();
  if (bridgeCfg.configured) {
    const startedAt = Date.now();
    try {
      const data = await fetchErpBridgeJson<{
        connected: boolean;
        stockMode?: 'myerpplus' | 'custom';
        salesSupported?: boolean;
        financeSupported?: boolean;
        assetsSupported?: boolean;
        purchasingSupported?: boolean;
        activeCutoffDate?: string;
        viewName?: string;
        database?: string;
        totalRows?: number;
        warehouses?: string[];
        availableTables?: string[];
        detectedColumns?: ErpColumnMapping;
        error?: string;
      }>('/health');

      return {
        configured: true,
        connected: Boolean(data.connected),
        mode: 'bridge',
        stockMode: data.stockMode,
        salesSupported: Boolean(data.salesSupported),
        financeSupported: Boolean(data.financeSupported),
        assetsSupported: Boolean(data.assetsSupported),
        purchasingSupported: Boolean(data.purchasingSupported),
        activeCutoffDate: data.activeCutoffDate || ACTIVE_ERP_CUTOFF_DATE,
        viewName: data.viewName || 'vw_ai_stok_barang',
        hostPreview: maskUrlHost(bridgeCfg.baseUrl),
        port: 443,
        database: data.database || 'mysql-local',
        sslEnabled: bridgeCfg.baseUrl.startsWith('https://'),
        latencyMs: Date.now() - startedAt,
        totalRows: data.totalRows,
        warehouses: Array.isArray(data.warehouses)
          ? data.warehouses.filter((w) => !isIntransitWarehouseName(w))
          : data.warehouses,
        availableTables: data.availableTables,
        detectedColumns: data.detectedColumns,
        error: data.error,
      };
    } catch (err) {
      return {
        configured: true,
        connected: false,
        mode: 'bridge',
        viewName: 'vw_ai_stok_barang',
        hostPreview: maskUrlHost(bridgeCfg.baseUrl),
        port: 443,
        database: 'mysql-local',
        sslEnabled: bridgeCfg.baseUrl.startsWith('https://'),
        latencyMs: Date.now() - startedAt,
        error: err instanceof Error ? err.message : 'Gagal menghubungi bridge lokal ERP.',
      };
    }
  }

  const cfg = getErpMysqlConfig();
  if (!cfg.configured) {
    return {
      configured: false,
      connected: false,
      viewName: cfg.viewName || 'vw_ai_stok_barang',
      hostPreview: '',
      port: cfg.port,
      database: cfg.database,
      sslEnabled: cfg.sslEnabled,
    };
  }

  if (cfg.looksLikeHttpTunnel) {
    return {
      configured: true,
      connected: false,
      mode: 'direct',
      viewName: cfg.viewName,
      hostPreview: maskHostPreview(cfg.host),
      port: cfg.port,
      database: cfg.database,
      sslEnabled: cfg.sslEnabled,
      error:
        'Alamat ngrok terdeteksi sebagai tunnel HTTP/HTTPS. Gunakan variabel ERP_BRIDGE_URL (bukan ERP_MYSQL_HOST) untuk menghubungkan lewat tunnel gratis "ngrok http 3000" + skrip erp-mysql-bridge.mjs.',
    };
  }

  const startedAt = Date.now();
  try {
    return await withReadOnlyConnection(async (conn) => {
      await conn.query('SELECT 1 AS ok');

      let mapping: ErpColumnMapping;
      try {
        mapping = await resolveStockColumns(conn);
      } catch (tableErr) {
        let availableTables: string[] = [];
        try {
          const [tblRows] = await conn.query<RowDataPacket[]>('SHOW TABLES');
          const allTbls = tblRows
            .map((r) => String(Object.values(r)[0] ?? '').trim())
            .filter(Boolean);
          const stockLike = /(stok|stock|gudang|barang|item|warehouse|inv|loc|mutasi|persediaan)/i;
          availableTables = [
            ...allTbls.filter((t) => stockLike.test(t)),
            ...allTbls.filter((t) => !stockLike.test(t)),
          ].slice(0, 250);
        } catch {
          // Ignore if SHOW TABLES is restricted for this user
        }
        return {
          configured: true,
          connected: false,
          viewName: cfg.viewName,
          hostPreview: maskHostPreview(cfg.host),
          port: cfg.port,
          database: cfg.database,
          sslEnabled: cfg.sslEnabled,
          latencyMs: Date.now() - startedAt,
          availableTables,
          error: `Koneksi ke server MySQL BERHASIL, namun View/Tabel "${cfg.viewName}" belum ditemukan atau belum diberi izin SELECT. ${
            availableTables.length > 0
              ? 'Pilih salah satu tabel/view yang terdeteksi di bawah ini untuk diisi ke ERP_MYSQL_STOCK_VIEW, atau buat View vw_ai_stok_barang.'
              : formatMysqlError(tableErr)
          }`,
        };
      }

      const whIntransitExclSql = mapping.warehouseCol
        ? `LOWER(REPLACE(REPLACE(COALESCE(\`${mapping.warehouseCol}\`, ''), ' ', ''), '-', '')) NOT LIKE '%intransit%'`
        : '';
      const [countRows] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS total FROM \`${mapping.viewName}\`${whIntransitExclSql ? ` WHERE ${whIntransitExclSql}` : ''}`
      );
      const totalRows = Number(countRows[0]?.total || 0);

      let warehouses: string[] = [];
      if (mapping.warehouseCol) {
        const [whRows] = await conn.query<RowDataPacket[]>(
          `SELECT DISTINCT \`${mapping.warehouseCol}\` AS wh FROM \`${mapping.viewName}\` WHERE \`${mapping.warehouseCol}\` IS NOT NULL AND \`${mapping.warehouseCol}\` <> '' AND ${whIntransitExclSql} ORDER BY wh ASC LIMIT 50`
        );
        warehouses = whRows
          .map((r) => String(r.wh || '').trim())
          .filter((w) => Boolean(w) && !isIntransitWarehouseName(w));
      }

      return {
        configured: true,
        connected: true,
        viewName: mapping.viewName,
        hostPreview: maskHostPreview(cfg.host),
        port: cfg.port,
        database: cfg.database,
        sslEnabled: cfg.sslEnabled,
        latencyMs: Date.now() - startedAt,
        totalRows,
        warehouses,
        detectedColumns: mapping,
      };
    });
  } catch (err) {
    return {
      configured: true,
      connected: false,
      viewName: cfg.viewName,
      hostPreview: maskHostPreview(cfg.host),
      port: cfg.port,
      database: cfg.database,
      sslEnabled: cfg.sslEnabled,
      latencyMs: Date.now() - startedAt,
      error: formatMysqlError(err),
    };
  }
}

const STOCK_CACHE_TTL_MS = 90_000;
const stockQueryCache = new Map<string, { expiresAt: number; data: ErpStockQueryResult }>();
const salesQueryCache = new Map<string, { expiresAt: number; data: ErpSalesQueryResult }>();
const financeQueryCache = new Map<string, { expiresAt: number; data: ErpFinanceQueryResult }>();
const assetsQueryCache = new Map<string, { expiresAt: number; data: ErpAssetsQueryResult }>();
const purchasingQueryCache = new Map<string, { expiresAt: number; data: ErpPurchasingQueryResult }>();
const employeesQueryCache = new Map<string, { expiresAt: number; data: ErpEmployeesQueryResult }>();
let warehousesMasterCache: { expiresAt: number; data: ErpWarehousesMasterResult } | null = null;

export function invalidateErpStockCache(): void {
  stockQueryCache.clear();
  salesQueryCache.clear();
  financeQueryCache.clear();
  assetsQueryCache.clear();
  purchasingQueryCache.clear();
  employeesQueryCache.clear();
  warehousesMasterCache = null;
  cachedColumns = null;
}

/**
 * Purely READ-ONLY lookup of ALL warehouses in ERP (`m1_warehouse` + stock aggregates from `m1_item_stock_warehouse`).
 * Includes empty warehouses, inactive flags, and virtual Intransit warehouses so admins can decide which to display.
 * Falls back gracefully to `/stock?summaryOnly=1` when connected to Bridge v10 (before `/warehouses` v11).
 */
export async function queryErpWarehousesMaster(opts?: {
  bypassCache?: boolean;
}): Promise<ErpWarehousesMasterResult> {
  if (!opts?.bypassCache && warehousesMasterCache && Date.now() < warehousesMasterCache.expiresAt) {
    return warehousesMasterCache.data;
  }

  const bridgeCfg = getErpBridgeConfig();
  if (bridgeCfg.configured) {
    try {
      const bridgeRes = await fetchErpBridgeJson<{
        warehouses?: ErpWarehouseMasterItem[];
        fetchedAt?: string;
        warning?: string;
      }>('/warehouses');

      const rows: ErpWarehouseMasterItem[] = Array.isArray(bridgeRes.warehouses)
        ? bridgeRes.warehouses.map((w) => {
            const name = String(w.name || w.code || 'Gudang').trim();
            const code = String(w.code || name).trim();
            return {
              code,
              name,
              isActive: w.isActive !== false,
              isIntransit: Boolean(w.isIntransit) || isIntransitWarehouseName(name) || isIntransitWarehouseName(code),
              skuCount: Number(w.skuCount || 0),
              totalQty: Number(w.totalQty || 0),
              zeroStockCount: Number(w.zeroStockCount || 0),
              source: w.source === 'stock_summary' ? 'stock_summary' : 'm1_warehouse',
            };
          })
        : [];

      const physicalCount = rows.filter((w) => !w.isIntransit && w.isActive).length;
      const intransitCount = rows.filter((w) => w.isIntransit).length;
      const data: ErpWarehousesMasterResult = {
        warehouses: rows,
        sourceMode: 'bridge_v11',
        totalMasterCount: rows.length,
        physicalCount,
        intransitCount,
        fetchedAt: bridgeRes.fetchedAt || new Date().toISOString(),
        warning: bridgeRes.warning,
      };
      warehousesMasterCache = { expiresAt: Date.now() + STOCK_CACHE_TTL_MS, data };
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/404|Endpoint tidak ditemukan|\/warehouses/i.test(msg)) {
        throw err;
      }
      // Graceful fallback for Bridge v10: merge physical warehouses + intransitSummary from /stock
      const stockRes = await queryErpWarehouseStock({
        summaryOnly: true,
        bypassCache: opts?.bypassCache,
      });
      const map = new Map<string, ErpWarehouseMasterItem>();
      for (const w of stockRes.warehouses || []) {
        const name = String(w.warehouse || '').trim();
        if (!name) continue;
        const key = name.toLowerCase();
        map.set(key, {
          code: name,
          name,
          isActive: true,
          isIntransit: isIntransitWarehouseName(name),
          skuCount: Number(w.skuCount || 0),
          totalQty: Number(w.totalQty || 0),
          zeroStockCount: Number(w.zeroStockCount || 0),
          source: 'stock_summary',
        });
      }
      for (const itName of stockRes.intransitSummary?.warehouses || []) {
        const name = String(itName || '').trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (!map.has(key)) {
          map.set(key, {
            code: name,
            name,
            isActive: true,
            isIntransit: true,
            skuCount: Number(stockRes.intransitSummary?.skuCount || 0),
            totalQty: Number(stockRes.intransitSummary?.totalQty || 0),
            zeroStockCount: Number(stockRes.intransitSummary?.zeroStockCount || 0),
            source: 'stock_summary',
          });
        }
      }
      const rows = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'id'));
      const data: ErpWarehousesMasterResult = {
        warehouses: rows,
        sourceMode: 'bridge_fallback_stock',
        totalMasterCount: rows.length,
        physicalCount: rows.filter((w) => !w.isIntransit).length,
        intransitCount: rows.filter((w) => w.isIntransit).length,
        fetchedAt: stockRes.fetchedAt || new Date().toISOString(),
        warning:
          'Bridge lokal belum memakai v11 (/warehouses). Daftar gudang ditampilkan dari ringkasan stok aktif; perbarui Bridge ke v11 jika ingin membaca gudang kosong dari master m1_warehouse.',
      };
      warehousesMasterCache = { expiresAt: Date.now() + STOCK_CACHE_TTL_MS, data };
      return data;
    }
  }

  // Direct read-only MySQL query against m1_warehouse + m1_item_stock_warehouse
  const data = await withReadOnlyConnection(async (conn): Promise<ErpWarehousesMasterResult> => {
    const [tblRows] = await conn.query<RowDataPacket[]>(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME IN ('m1_warehouse', 'm1_item_stock_warehouse', 'm1_item')`
    );
    const tblSet = new Set(
      tblRows.map((r) => String(r.TABLE_NAME || r.table_name || '').toLowerCase())
    );

    if (tblSet.has('m1_warehouse')) {
      const [whColRows] = await conn.query<RowDataPacket[]>('SHOW COLUMNS FROM `m1_warehouse`');
      const whCols = whColRows.map((r) => String(r.Field || r.field || '').trim());
      const whColMap = new Map(whCols.map((c) => [c.toLowerCase(), c]));
      const codeCol = whColMap.get('wkode') || whColMap.get('kode') || whCols[0] || 'wkode';
      const nameCol = whColMap.get('wnama') || whColMap.get('nama') || codeCol;
      const activeCol = whColMap.get('waktif') || whColMap.get('aktif') || '';
      const virtualCol =
        whColMap.get('wisintransit') ||
        whColMap.get('is_intransit') ||
        whColMap.get('wisvirtual') ||
        whColMap.get('wnonfisik') ||
        '';
      const physicalCol = whColMap.get('wisfisik') || whColMap.get('is_physical') || '';

      const [masterRows] = await conn.query<RowDataPacket[]>(
        `SELECT \`${codeCol}\` AS wkode, \`${nameCol}\` AS wnama` +
          (activeCol ? `, COALESCE(\`${activeCol}\`, 1) AS waktif` : ', 1 AS waktif') +
          (virtualCol ? `, COALESCE(\`${virtualCol}\`, 0) AS wvirtual` : ', 0 AS wvirtual') +
          (physicalCol ? `, COALESCE(\`${physicalCol}\`, 1) AS wfisik` : ', 1 AS wfisik') +
          ' FROM `m1_warehouse` ORDER BY `' +
          nameCol +
          '` ASC, `' +
          codeCol +
          '` ASC'
      );

      const stockAggMap = new Map<string, { skuCount: number; totalQty: number; zeroStockCount: number }>();
      if (tblSet.has('m1_item_stock_warehouse') && tblSet.has('m1_item')) {
        const [itemColRows] = await conn.query<RowDataPacket[]>('SHOW COLUMNS FROM `m1_item`');
        const hasBjenis = itemColRows.some((r) => String(r.Field || r.field || '').toLowerCase() === 'bjenis');
        const itemCond = hasBjenis
          ? "i.baktif = 1 AND UPPER(TRIM(COALESCE(i.bjenis, ''))) = 'P'"
          : 'i.baktif = 1';
        const [aggRows] = await conn.query<RowDataPacket[]>(
          `SELECT TRIM(COALESCE(s.kgudang, '')) AS kgudang,
                  COUNT(*) AS skuCount,
                  COALESCE(SUM(s.stok), 0) AS totalQty,
                  SUM(CASE WHEN COALESCE(s.stok, 0) <= 0 THEN 1 ELSE 0 END) AS zeroStockCount
           FROM m1_item_stock_warehouse s
           INNER JOIN m1_item i ON i.bid = s.idbarang
           WHERE ${itemCond}
           GROUP BY TRIM(COALESCE(s.kgudang, ''))`
        );
        for (const r of aggRows) {
          const k = String(r.kgudang || '').trim().toLowerCase();
          if (!k) continue;
          stockAggMap.set(k, {
            skuCount: Number(r.skuCount || 0),
            totalQty: Number(r.totalQty || 0),
            zeroStockCount: Number(r.zeroStockCount || 0),
          });
        }
      }

      const seenCodes = new Set<string>();
      const rows: ErpWarehouseMasterItem[] = [];
      for (const r of masterRows) {
        const code = String(r.wkode || '').trim();
        const name = String(r.wnama || code || 'Gudang').trim();
        if (!code && !name) continue;
        const normKey = (code || name).toLowerCase();
        seenCodes.add(normKey);
        const agg = stockAggMap.get(normKey) || stockAggMap.get(name.toLowerCase()) || {
          skuCount: 0,
          totalQty: 0,
          zeroStockCount: 0,
        };
        const isIntransit =
          Number(r.wvirtual || 0) === 1 ||
          Number(r.wfisik ?? 1) === 0 ||
          isIntransitWarehouseName(name) ||
          isIntransitWarehouseName(code);
        rows.push({
          code: code || name,
          name,
          isActive: Number(r.waktif ?? 1) === 1,
          isIntransit,
          skuCount: agg.skuCount,
          totalQty: agg.totalQty,
          zeroStockCount: agg.zeroStockCount,
          source: 'm1_warehouse',
        });
      }

      // Include any kgudang present in stock table but missing from m1_warehouse
      for (const [k, agg] of stockAggMap.entries()) {
        if (seenCodes.has(k)) continue;
        rows.push({
          code: k.toUpperCase(),
          name: k.toUpperCase(),
          isActive: true,
          isIntransit: isIntransitWarehouseName(k),
          skuCount: agg.skuCount,
          totalQty: agg.totalQty,
          zeroStockCount: agg.zeroStockCount,
          source: 'stock_summary',
        });
      }

      rows.sort((a, b) => a.name.localeCompare(b.name, 'id'));
      return {
        warehouses: rows,
        sourceMode: 'mysql_direct',
        totalMasterCount: rows.length,
        physicalCount: rows.filter((w) => !w.isIntransit && w.isActive).length,
        intransitCount: rows.filter((w) => w.isIntransit).length,
        fetchedAt: new Date().toISOString(),
      };
    }

    // Custom SQL view fallback
    const stockRes = await queryErpWarehouseStock({ summaryOnly: true, bypassCache: opts?.bypassCache });
    const rows: ErpWarehouseMasterItem[] = (stockRes.warehouses || []).map((w) => ({
      code: w.warehouse,
      name: w.warehouse,
      isActive: true,
      isIntransit: isIntransitWarehouseName(w.warehouse),
      skuCount: w.skuCount,
      totalQty: w.totalQty,
      zeroStockCount: w.zeroStockCount,
      source: 'stock_summary',
    }));
    return {
      warehouses: rows,
      sourceMode: 'mysql_direct',
      totalMasterCount: rows.length,
      physicalCount: rows.filter((w) => !w.isIntransit).length,
      intransitCount: rows.filter((w) => w.isIntransit).length,
      fetchedAt: new Date().toISOString(),
    };
  });

  warehousesMasterCache = { expiresAt: Date.now() + STOCK_CACHE_TTL_MS, data };
  return data;
}

export async function queryErpWarehouseStock(params?: {
  search?: string;
  warehouse?: string;
  category?: string;
  onlyLowStock?: boolean;
  summaryOnly?: boolean;
  intransitOnly?: boolean;
  qtySort?: 'asc' | 'desc' | '';
  limit?: number;
  bypassCache?: boolean;
}): Promise<ErpStockQueryResult> {
  const search = (params?.search || '').trim();
  const rawWarehouse = (params?.warehouse || '').trim();
  const intransitOnly = Boolean(params?.intransitOnly);
  // Safety guard: never allow physical stock query to explicitly target Gudang Intransit
  const warehouse = !intransitOnly && isIntransitWarehouseName(rawWarehouse) ? '' : rawWarehouse;
  const category = (params?.category || '').trim();
  const onlyLowStock = Boolean(params?.onlyLowStock);
  const summaryOnly = Boolean(params?.summaryOnly);
  const qtySort: 'asc' | 'desc' | '' =
    params?.qtySort === 'asc' || params?.qtySort === 'desc' ? params.qtySort : '';
  const limit = Math.max(1, Math.min(1000, Math.round(params?.limit || 80)));

  const cacheKey = `${search.toLowerCase()}|${warehouse.toLowerCase()}|${category.toLowerCase()}|${onlyLowStock ? '1' : '0'}|${summaryOnly ? '1' : '0'}|${intransitOnly ? 'IT' : 'PH'}|${qtySort}|${limit}`;
  if (!params?.bypassCache) {
    const cached = stockQueryCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.data;
    }
  }

  const bridgeCfg = getErpBridgeConfig();
  if (bridgeCfg.configured) {
    const qs = new URLSearchParams();
    if (search) qs.set('q', search);
    if (intransitOnly) {
      qs.set('intransitOnly', '1');
      if (warehouse) qs.set('warehouse', warehouse);
    } else if (warehouse) {
      qs.set('warehouse', warehouse);
    }
    if (category) qs.set('category', category);
    if (onlyLowStock) qs.set('low', '1');
    if (summaryOnly) qs.set('summaryOnly', '1');
    if (qtySort) qs.set('qtySort', qtySort);
    qs.set('limit', String(limit));

    let data = await fetchErpBridgeJson<ErpStockQueryResult>(`/stock?${qs.toString()}`);

    // Fallback compatibility when local PC is still running Bridge v5-v8 (before native v9 Intransit separation)
    const bridgeSupportsNativeIntransit = Boolean(data.intransitBridgeNative);
    if (intransitOnly && !bridgeSupportsNativeIntransit) {
      // Old bridge ignores intransitOnly=1 — re-query targeting Intransit warehouse name directly
      const fallbackQs = new URLSearchParams();
      if (search) fallbackQs.set('q', search);
      if (category) fallbackQs.set('category', category);
      fallbackQs.set('warehouse', 'Intransit');
      if (qtySort) fallbackQs.set('qtySort', qtySort);
      fallbackQs.set('limit', String(limit));
      data = await fetchErpBridgeJson<ErpStockQueryResult>(`/stock?${fallbackQs.toString()}`);
      const itItems = (data.items || []).filter((it) => isIntransitWarehouseName(it.warehouse));
      const itWh = (data.warehouses || []).filter((w) => isIntransitWarehouseName(w.warehouse));
      data.items = itItems;
      data.warehouses = itWh;
      data.intransitOnly = true;
      data.intransitExcluded = false;
      data.intransitBridgeNative = false;
      data.intransitSummary = {
        skuCount: itWh.reduce((s, w) => s + Number(w.skuCount || 0), 0) || itItems.length,
        totalQty:
          itWh.reduce((s, w) => s + Number(w.totalQty || 0), 0) ||
          itItems.reduce((s, it) => s + Number(it.qty || 0), 0),
        zeroStockCount:
          itWh.reduce((s, w) => s + Number(w.zeroStockCount || 0), 0) ||
          itItems.filter((it) => Number(it.qty || 0) <= 0).length,
        warehouses: itWh.map((w) => w.warehouse),
      };
      data.totalRows = data.intransitSummary.skuCount;
    } else if (!intransitOnly && !bridgeSupportsNativeIntransit) {
      const allWh = Array.isArray(data.warehouses) ? data.warehouses : [];
      const intransitWh = allWh.filter((w) => isIntransitWarehouseName(w.warehouse));
      const physicalWh = allWh.filter((w) => !isIntransitWarehouseName(w.warehouse));
      const intransitSku = intransitWh.reduce((s, w) => s + Number(w.skuCount || 0), 0);
      const intransitQty = intransitWh.reduce((s, w) => s + Number(w.totalQty || 0), 0);
      const intransitZero = intransitWh.reduce((s, w) => s + Number(w.zeroStockCount || 0), 0);

      data.warehouses = physicalWh;
      data.items = (data.items || []).filter((it) => !isIntransitWarehouseName(it.warehouse));
      data.intransitExcluded = true;
      data.intransitBridgeNative = false;
      data.intransitOnly = false;
      data.intransitSummary = {
        skuCount: intransitSku,
        totalQty: intransitQty,
        zeroStockCount: intransitZero,
        warehouses: intransitWh.map((w) => w.warehouse),
      };
      if (intransitSku > 0) {
        data.totalRows = Math.max(0, Number(data.totalRows || 0) - intransitSku);
        if (typeof data.totalActiveRows === 'number') {
          data.totalActiveRows = Math.max(0, data.totalActiveRows - intransitSku);
        }
      }
    } else if (!intransitOnly) {
      // Defensive guarantee even on Bridge v9: never let Intransit slip into physical results
      data.warehouses = (data.warehouses || []).filter((w) => !isIntransitWarehouseName(w.warehouse));
      data.items = (data.items || []).filter((it) => !isIntransitWarehouseName(it.warehouse));
      data.intransitExcluded = true;
      data.intransitOnly = false;
    }

    // Fallback gracefully if local Bridge is still older than v5 (missing categories/activeOnly)
    if (!Array.isArray(data.categories)) {
      const catMap = new Map<string, ErpStockCategorySummary>();
      for (const it of data.items || []) {
        const cat = (it.category || '').trim() || 'Tanpa Kategori';
        const cur = catMap.get(cat) || { category: cat, skuCount: 0, totalQty: 0, zeroStockCount: 0 };
        cur.skuCount += 1;
        cur.totalQty += Number(it.qty || 0);
        if (Number(it.qty || 0) <= 0) cur.zeroStockCount += 1;
        catMap.set(cat, cur);
      }
      data.categories = Array.from(catMap.values()).sort((a, b) => a.category.localeCompare(b.category));
      data.selectedCategory = category;
      if (category) {
        data.items = (data.items || []).filter(
          (it) => ((it.category || '').trim() || 'Tanpa Kategori').toLowerCase() === category.toLowerCase()
        );
      } else if (summaryOnly && !search) {
        data.items = [];
      }
    }

    // Ensure requested qtySort is respected even if Bridge is an older build
    if (qtySort && Array.isArray(data.items) && data.items.length > 1) {
      data.items = [...data.items].sort((a, b) =>
        qtySort === 'desc'
          ? Number(b.qty || 0) - Number(a.qty || 0)
          : Number(a.qty || 0) - Number(b.qty || 0)
      );
    }

    if (stockQueryCache.size > 40) {
      const oldest = stockQueryCache.keys().next().value;
      if (oldest) stockQueryCache.delete(oldest);
    }
    stockQueryCache.set(cacheKey, {
      expiresAt: Date.now() + STOCK_CACHE_TTL_MS,
      data,
    });
    return data;
  }

  const data = await withReadOnlyConnection(async (conn) => {
    const mapping = await resolveStockColumns(conn);
    const viewSql = `\`${mapping.viewName}\``;
    const activeCol = mapping.allColumns.find(
      (c) => c.toLowerCase() === 'baktif' || c.toLowerCase() === 'aktif'
    );
    const jenisCol = mapping.allColumns.find((c) => c.toLowerCase() === 'bjenis');
    const itemBaseConds: string[] = [];
    if (activeCol) itemBaseConds.push(`\`${activeCol}\` = 1`);
    if (jenisCol) itemBaseConds.push(`UPPER(TRIM(COALESCE(\`${jenisCol}\`, ''))) = 'P'`);

    const whNormExpr = mapping.warehouseCol
      ? `LOWER(REPLACE(REPLACE(COALESCE(\`${mapping.warehouseCol}\`, ''), ' ', ''), '-', ''))`
      : '';
    const isIntransitSql = whNormExpr ? `${whNormExpr} LIKE '%intransit%'` : '1 = 0';
    const isPhysicalSql = whNormExpr ? `${whNormExpr} NOT LIKE '%intransit%'` : '1 = 1';

    const baseConds: string[] = [...itemBaseConds];
    if (mapping.warehouseCol) {
      baseConds.push(intransitOnly ? isIntransitSql : isPhysicalSql);
    }
    const baseWhereSql = baseConds.length > 0 ? `WHERE ${baseConds.join(' AND ')}` : '';

    const [countRows] = await conn.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM ${viewSql} ${baseWhereSql}`
    );
    const totalActiveRows = Number(countRows[0]?.total || 0);

    // Separate informational Gudang Intransit summary (NEVER added to physical stock totals)
    let intransitSummary: ErpIntransitSummary = {
      skuCount: 0,
      totalQty: 0,
      zeroStockCount: 0,
      warehouses: [],
    };
    if (mapping.warehouseCol) {
      const itConds = [...itemBaseConds, isIntransitSql];
      const itBinds: unknown[] = [];
      if (category && mapping.categoryCol) {
        itConds.push(
          `COALESCE(NULLIF(TRIM(CAST(\`${mapping.categoryCol}\` AS CHAR)), ''), 'Tanpa Kategori') = ?`
        );
        itBinds.push(category);
      }
      const qtyExprIt = mapping.qtyCol ? `COALESCE(SUM(\`${mapping.qtyCol}\`), 0)` : 'COUNT(*)';
      const zeroExprIt = mapping.qtyCol
        ? `SUM(CASE WHEN COALESCE(\`${mapping.qtyCol}\`, 0) <= 0 THEN 1 ELSE 0 END)`
        : '0';
      const [itRows] = await conn.query<RowDataPacket[]>(
        `SELECT COALESCE(NULLIF(TRIM(\`${mapping.warehouseCol}\`), ''), 'Intransit') AS warehouse, COUNT(*) AS skuCount, ${qtyExprIt} AS totalQty, ${zeroExprIt} AS zeroStockCount FROM ${viewSql} WHERE ${itConds.join(' AND ')} GROUP BY warehouse ORDER BY warehouse ASC LIMIT 20`,
        itBinds
      );
      intransitSummary = {
        skuCount: itRows.reduce((s, r) => s + Number(r.skuCount || 0), 0),
        totalQty: itRows.reduce((s, r) => s + Number(r.totalQty || 0), 0),
        zeroStockCount: itRows.reduce((s, r) => s + Number(r.zeroStockCount || 0), 0),
        warehouses: itRows.map((r) => String(r.warehouse || 'Intransit').trim()).filter(Boolean),
      };
    }

    // Category summary aggregation (active physical inventory items only — excludes Intransit)
    let categories: ErpStockCategorySummary[] = [];
    if (mapping.categoryCol) {
      const catCol = `\`${mapping.categoryCol}\``;
      const qtyExpr = mapping.qtyCol ? `COALESCE(SUM(\`${mapping.qtyCol}\`), 0)` : 'COUNT(*)';
      const zeroExpr = mapping.qtyCol
        ? `SUM(CASE WHEN COALESCE(\`${mapping.qtyCol}\`, 0) <= 0 THEN 1 ELSE 0 END)`
        : '0';
      const [catRows] = await conn.query<RowDataPacket[]>(
        `SELECT COALESCE(NULLIF(TRIM(CAST(${catCol} AS CHAR)), ''), 'Tanpa Kategori') AS category, COUNT(*) AS skuCount, ${qtyExpr} AS totalQty, ${zeroExpr} AS zeroStockCount FROM ${viewSql} ${baseWhereSql} GROUP BY category ORDER BY category ASC LIMIT 100`
      );
      categories = catRows.map((r) => ({
        category: String(r.category || 'Tanpa Kategori').trim(),
        skuCount: Number(r.skuCount || 0),
        totalQty: Number(r.totalQty || 0),
        zeroStockCount: Number(r.zeroStockCount || 0),
      }));
    }

    const whWhereParts: string[] = [...baseConds];
    const whBinds: unknown[] = [];
    if (category && mapping.categoryCol) {
      whWhereParts.push(
        `COALESCE(NULLIF(TRIM(CAST(\`${mapping.categoryCol}\` AS CHAR)), ''), 'Tanpa Kategori') = ?`
      );
      whBinds.push(category);
    }
    const whWhereSql = whWhereParts.length > 0 ? `WHERE ${whWhereParts.join(' AND ')}` : '';

    // Warehouse summary aggregation (scoped to selected category when chosen; excludes Intransit by default)
    let warehouses: ErpWarehouseSummary[] = [];
    if (mapping.warehouseCol) {
      const whCol = `\`${mapping.warehouseCol}\``;
      const qtyExpr = mapping.qtyCol ? `COALESCE(SUM(\`${mapping.qtyCol}\`), 0)` : 'COUNT(*)';
      const zeroExpr = mapping.qtyCol
        ? `SUM(CASE WHEN COALESCE(\`${mapping.qtyCol}\`, 0) <= 0 THEN 1 ELSE 0 END)`
        : '0';
      const [whRows] = await conn.query<RowDataPacket[]>(
        `SELECT COALESCE(NULLIF(TRIM(${whCol}), ''), 'Gudang Utama') AS warehouse, COUNT(*) AS skuCount, ${qtyExpr} AS totalQty, ${zeroExpr} AS zeroStockCount FROM ${viewSql} ${whWhereSql} GROUP BY warehouse ORDER BY warehouse ASC LIMIT 50`,
        whBinds
      );
      warehouses = whRows.map((r) => ({
        warehouse: String(r.warehouse || 'Gudang Utama'),
        skuCount: Number(r.skuCount || 0),
        totalQty: Number(r.totalQty || 0),
        zeroStockCount: Number(r.zeroStockCount || 0),
      }));
    } else {
      const qtyExpr = mapping.qtyCol ? `COALESCE(SUM(\`${mapping.qtyCol}\`), 0)` : '0';
      const zeroExpr = mapping.qtyCol
        ? `SUM(CASE WHEN COALESCE(\`${mapping.qtyCol}\`, 0) <= 0 THEN 1 ELSE 0 END)`
        : '0';
      const [aggRows] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS skuCount, ${qtyExpr} AS totalQty, ${zeroExpr} AS zeroStockCount FROM ${viewSql} ${whWhereSql}`,
        whBinds
      );
      warehouses = [
        {
          warehouse: 'Semua Gudang',
          skuCount: Number(aggRows[0]?.skuCount || 0),
          totalQty: Number(aggRows[0]?.totalQty || 0),
          zeroStockCount: Number(aggRows[0]?.zeroStockCount || 0),
        },
      ];
    }

    const totalRows =
      category && mapping.categoryCol
        ? warehouses.reduce((sum, w) => sum + Number(w.skuCount || 0), 0)
        : totalActiveRows;

    if (summaryOnly && !category && !search && !intransitOnly) {
      return {
        items: [],
        warehouses,
        categories,
        selectedCategory: '',
        activeOnly: Boolean(activeCol),
        inventoryOnly: Boolean(jenisCol),
        intransitExcluded: true,
        intransitBridgeNative: true,
        intransitOnly: false,
        intransitSummary,
        qtySort,
        totalRows: totalActiveRows,
        totalActiveRows,
        viewName: mapping.viewName,
        detectedColumns: mapping,
        fetchedAt: new Date().toISOString(),
      };
    }

    const whereClauses: string[] = [...baseConds];
    const bindValues: unknown[] = [];

    if (category && mapping.categoryCol) {
      whereClauses.push(
        `COALESCE(NULLIF(TRIM(CAST(\`${mapping.categoryCol}\` AS CHAR)), ''), 'Tanpa Kategori') = ?`
      );
      bindValues.push(category);
    }

    if (warehouse && mapping.warehouseCol) {
      whereClauses.push(`\`${mapping.warehouseCol}\` LIKE ?`);
      bindValues.push(`%${warehouse}%`);
    }

    if (search) {
      const tokens = search
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 2)
        .slice(0, 5);

      const searchableCols = [
        mapping.codeCol,
        mapping.nameCol,
        mapping.warehouseCol,
        mapping.categoryCol,
      ].filter((c): c is string => Boolean(c));

      if (searchableCols.length > 0 && tokens.length > 0) {
        const tokenGroups = tokens.map((tok) => {
          const perCol = searchableCols.map((col) => {
            bindValues.push(`%${tok}%`);
            return `CAST(\`${col}\` AS CHAR) LIKE ?`;
          });
          return `(${perCol.join(' OR ')})`;
        });
        whereClauses.push(tokenGroups.join(' AND '));
      }
    }

    if (onlyLowStock && mapping.qtyCol) {
      whereClauses.push(`COALESCE(\`${mapping.qtyCol}\`, 0) <= 10`);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const orderByParts: string[] = [];
    if (qtySort === 'desc' && mapping.qtyCol) {
      orderByParts.push(`COALESCE(\`${mapping.qtyCol}\`, 0) DESC`);
    } else if (qtySort === 'asc' && mapping.qtyCol) {
      orderByParts.push(`COALESCE(\`${mapping.qtyCol}\`, 0) ASC`);
    } else if (onlyLowStock && mapping.qtyCol) {
      orderByParts.push(`COALESCE(\`${mapping.qtyCol}\`, 0) ASC`);
    }
    if (!qtySort && mapping.warehouseCol) orderByParts.push(`\`${mapping.warehouseCol}\` ASC`);
    if (mapping.nameCol) orderByParts.push(`\`${mapping.nameCol}\` ASC`);
    else if (mapping.codeCol) orderByParts.push(`\`${mapping.codeCol}\` ASC`);
    const orderSql = orderByParts.length > 0 ? `ORDER BY ${orderByParts.join(', ')}` : '';

    const selectedCols = mapping.allColumns.slice(0, 14).map((c) => `\`${c}\``).join(', ');
    const [itemRows] = await conn.query<RowDataPacket[]>(
      `SELECT ${selectedCols} FROM ${viewSql} ${whereSql} ${orderSql} LIMIT ?`,
      [...bindValues, limit]
    );

    const mappedColSet = new Set(
      [
        mapping.codeCol,
        mapping.nameCol,
        mapping.warehouseCol,
        mapping.qtyCol,
        mapping.unitCol,
        mapping.categoryCol,
      ].filter(Boolean)
    );

    const items: ErpStockItem[] = itemRows.map((row) => {
      const extra: Record<string, string | number | null> = {};
      for (const col of mapping.allColumns.slice(0, 14)) {
        if (!mappedColSet.has(col)) {
          const val = row[col];
          if (val !== undefined) {
            extra[col] =
              typeof val === 'number' || typeof val === 'string' || val === null
                ? val
                : String(val);
          }
        }
      }
      return {
        code: mapping.codeCol ? String(row[mapping.codeCol] ?? '').trim() : '-',
        name: mapping.nameCol ? String(row[mapping.nameCol] ?? '').trim() : '-',
        warehouse: mapping.warehouseCol
          ? String(row[mapping.warehouseCol] ?? '').trim() || 'Gudang Utama'
          : 'Gudang Utama',
        qty: mapping.qtyCol ? Number(row[mapping.qtyCol] ?? 0) : 0,
        unit: mapping.unitCol ? String(row[mapping.unitCol] ?? '').trim() || 'Pcs' : 'Pcs',
        category: mapping.categoryCol
          ? String(row[mapping.categoryCol] ?? '').trim() || 'Tanpa Kategori'
          : '',
        extra: Object.keys(extra).length > 0 ? extra : undefined,
      };
    });

    return {
      items,
      warehouses,
      categories,
      selectedCategory: category,
      activeOnly: Boolean(activeCol),
      inventoryOnly: Boolean(jenisCol),
      intransitExcluded: !intransitOnly,
      intransitBridgeNative: true,
      intransitOnly,
      intransitSummary,
      qtySort,
      totalRows,
      totalActiveRows,
      viewName: mapping.viewName,
      detectedColumns: mapping,
      fetchedAt: new Date().toISOString(),
    };
  });

  if (stockQueryCache.size > 40) {
    const oldest = stockQueryCache.keys().next().value;
    if (oldest) stockQueryCache.delete(oldest);
  }
  stockQueryCache.set(cacheKey, {
    expiresAt: Date.now() + STOCK_CACHE_TTL_MS,
    data,
  });

  return data;
}

function formatDateIso(val: unknown): string {
  if (!val) return '';
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return val.toISOString().slice(0, 10);
  }
  const s = String(val).trim();
  if (!s || s === '0000-00-00') return '';
  return s.slice(0, 10);
}

export async function queryErpSalesData(params?: {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  bypassCache?: boolean;
}): Promise<ErpSalesQueryResult> {
  const search = (params?.search || '').trim();
  const dateFrom = clampActiveDateFrom(params?.dateFrom);
  const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(params?.dateTo || '') ? params!.dateTo! : '';
  const limit = Math.max(1, Math.min(100, Math.round(params?.limit || 30)));

  const baseCachePrefix = `${search.toLowerCase()}|${dateFrom}|${dateTo}|`;
  const cacheKey = `${baseCachePrefix}${limit}`;
  if (!params?.bypassCache) {
    const now = Date.now();
    const cached = salesQueryCache.get(cacheKey);
    if (cached && now < cached.expiresAt) {
      return cached.data;
    }
    for (const [key, entry] of salesQueryCache.entries()) {
      if (now >= entry.expiresAt) continue;
      if (!key.startsWith(baseCachePrefix)) continue;
      const cachedLimit = Number(key.slice(baseCachePrefix.length));
      if (Number.isFinite(cachedLimit) && cachedLimit >= limit) {
        return entry.data;
      }
    }
  }

  const bridgeCfg = getErpBridgeConfig();
  if (bridgeCfg.configured) {
    const qs = new URLSearchParams();
    if (search) qs.set('q', search);
    if (dateFrom) qs.set('dateFrom', dateFrom);
    if (dateTo) qs.set('dateTo', dateTo);
    qs.set('limit', String(limit));

    const data = await fetchErpBridgeJson<ErpSalesQueryResult>(`/sales?${qs.toString()}`);
    if (salesQueryCache.size > 30) {
      const oldest = salesQueryCache.keys().next().value;
      if (oldest) salesQueryCache.delete(oldest);
    }
    salesQueryCache.set(cacheKey, {
      expiresAt: Date.now() + STOCK_CACHE_TTL_MS,
      data,
    });
    return data;
  }

  // Direct MySQL TCP mode for myerpplus m5_* tables
  const data = await withReadOnlyConnection(async (conn) => {
    const siWhere: string[] = ['COALESCE(si.sistatus, 0) NOT IN (6, 12)', 'si.sitgl >= ?'];
    const siBinds: unknown[] = [dateFrom];
    if (dateTo) {
      siWhere.push('si.sitgl <= ?');
      siBinds.push(dateTo);
    }
    if (search) {
      siWhere.push('(si.sinotransaksi LIKE ? OR COALESCE(c.knama, \'\') LIKE ? OR COALESCE(sls.knama, \'\') LIKE ? OR COALESCE(si.sigudang, \'\') LIKE ?)');
      siBinds.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    const siWhereSql = `WHERE ${siWhere.join(' AND ')}`;

    // PENGECUALIAN PIUTANG: semua faktur belum lunas tetap dihitung (termasuk carry-over < 2026-03-01)
    const arWhere: string[] = [
      'COALESCE(si.sistatus, 0) NOT IN (6, 12)',
      'COALESCE(si.sistatuslunas, 0) = 0',
      'GREATEST(0, COALESCE(si.sitotaltransaksi, 0) - COALESCE(si.sijmlbayar, 0) - COALESCE(si.sijmluangmuka, 0)) > 0',
    ];
    const arBinds: unknown[] = [];
    if (dateTo) {
      arWhere.push('si.sitgl <= ?');
      arBinds.push(dateTo);
    }
    if (search) {
      arWhere.push('(si.sinotransaksi LIKE ? OR COALESCE(c.knama, \'\') LIKE ? OR COALESCE(sls.knama, \'\') LIKE ? OR COALESCE(si.sigudang, \'\') LIKE ?)');
      arBinds.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    const arWhereSql = `WHERE ${arWhere.join(' AND ')}`;

    const [kpiRows] = await conn.query<RowDataPacket[]>(
      `SELECT
        COUNT(*) AS invoiceCount,
        COALESCE(SUM(si.sitotaltransaksi), 0) AS totalRevenue,
        COALESCE(SUM(COALESCE(si.sijmlbayar, 0) + COALESCE(si.sijmluangmuka, 0)), 0) AS totalPaid
      FROM m5_si si
      LEFT JOIN m1_contact c ON c.kid = si.sicustomer
      LEFT JOIN m1_contact sls ON sls.kid = si.sibagianpenjualan
      ${siWhereSql}`,
      siBinds
    );

    const [arKpiRows] = await conn.query<RowDataPacket[]>(
      `SELECT
        COALESCE(SUM(GREATEST(0, COALESCE(si.sitotaltransaksi, 0) - COALESCE(si.sijmlbayar, 0) - COALESCE(si.sijmluangmuka, 0))), 0) AS totalReceivable,
        COUNT(*) AS unpaidInvoiceCount,
        SUM(CASE WHEN si.sitgl < ? THEN 1 ELSE 0 END) AS carryOverUnpaidCount,
        COALESCE(SUM(CASE WHEN si.sitgl < ? THEN GREATEST(0, COALESCE(si.sitotaltransaksi, 0) - COALESCE(si.sijmlbayar, 0) - COALESCE(si.sijmluangmuka, 0)) ELSE 0 END), 0) AS carryOverReceivable,
        SUM(CASE WHEN si.sitgljatuhtempo IS NOT NULL AND si.sitgljatuhtempo < CURDATE() THEN 1 ELSE 0 END) AS overdueInvoiceCount,
        COALESCE(SUM(CASE WHEN si.sitgljatuhtempo IS NOT NULL AND si.sitgljatuhtempo < CURDATE() THEN GREATEST(0, COALESCE(si.sitotaltransaksi, 0) - COALESCE(si.sijmlbayar, 0) - COALESCE(si.sijmluangmuka, 0)) ELSE 0 END), 0) AS overdueAmount
      FROM m5_si si
      LEFT JOIN m1_contact c ON c.kid = si.sicustomer
      LEFT JOIN m1_contact sls ON sls.kid = si.sibagianpenjualan
      ${arWhereSql}`,
      [ACTIVE_ERP_CUTOFF_DATE, ACTIVE_ERP_CUTOFF_DATE, ...arBinds]
    );

    const [monthlyRows] = await conn.query<RowDataPacket[]>(
      `SELECT
        DATE_FORMAT(si.sitgl, '%Y-%m') AS month,
        COUNT(*) AS invoiceCount,
        COALESCE(SUM(si.sitotaltransaksi), 0) AS revenue,
        COALESCE(SUM(COALESCE(si.sijmlbayar, 0) + COALESCE(si.sijmluangmuka, 0)), 0) AS paid,
        COALESCE(SUM(CASE WHEN COALESCE(si.sistatuslunas, 0) = 0 THEN GREATEST(0, COALESCE(si.sitotaltransaksi, 0) - COALESCE(si.sijmlbayar, 0) - COALESCE(si.sijmluangmuka, 0)) ELSE 0 END), 0) AS receivable
      FROM m5_si si
      LEFT JOIN m1_contact c ON c.kid = si.sicustomer
      LEFT JOIN m1_contact sls ON sls.kid = si.sibagianpenjualan
      ${siWhereSql} AND si.sitgl IS NOT NULL
      GROUP BY DATE_FORMAT(si.sitgl, '%Y-%m')
      ORDER BY month DESC
      LIMIT 12`,
      siBinds
    );

    const [topCustRows] = await conn.query<RowDataPacket[]>(
      `SELECT
        si.sicustomer AS customerId,
        COALESCE(NULLIF(TRIM(c.kkode), ''), CAST(si.sicustomer AS CHAR)) AS customerCode,
        COALESCE(NULLIF(TRIM(c.knama), ''), CONCAT('Customer #', si.sicustomer)) AS customerName,
        COUNT(*) AS invoiceCount,
        COALESCE(SUM(si.sitotaltransaksi), 0) AS totalRevenue,
        COALESCE(SUM(CASE WHEN COALESCE(si.sistatuslunas, 0) = 0 THEN GREATEST(0, COALESCE(si.sitotaltransaksi, 0) - COALESCE(si.sijmlbayar, 0) - COALESCE(si.sijmluangmuka, 0)) ELSE 0 END), 0) AS totalReceivable
      FROM m5_si si
      LEFT JOIN m1_contact c ON c.kid = si.sicustomer
      LEFT JOIN m1_contact sls ON sls.kid = si.sibagianpenjualan
      ${siWhereSql}
      GROUP BY si.sicustomer, customerCode, customerName
      ORDER BY totalRevenue DESC
      LIMIT 15`,
      siBinds
    );

    const [topItemRows] = await conn.query<RowDataPacket[]>(
      `SELECT
        d.idbarang AS itemId,
        COALESCE(NULLIF(TRIM(i.bkode), ''), CAST(d.idbarang AS CHAR)) AS itemCode,
        COALESCE(NULLIF(TRIM(d.namabarang), ''), NULLIF(TRIM(i.bnama), ''), CONCAT('Barang #', d.idbarang)) AS itemName,
        COALESCE(SUM(d.jml), 0) AS totalQty,
        COALESCE(NULLIF(TRIM(MAX(d.satuan)), ''), 'Pcs') AS unit,
        COALESCE(SUM((COALESCE(d.jml, 0) * COALESCE(d.harga, 0)) - COALESCE(d.jmldiskon, 0)), 0) AS totalValue,
        COUNT(DISTINCT d.idsi) AS invoiceCount
      FROM m5_si_detail d
      INNER JOIN m5_si si ON si.siid = d.idsi
      LEFT JOIN m1_contact c ON c.kid = si.sicustomer
      LEFT JOIN m1_contact sls ON sls.kid = si.sibagianpenjualan
      LEFT JOIN m1_item i ON i.bid = d.idbarang
      ${siWhereSql}
      GROUP BY d.idbarang, itemCode, itemName
      ORDER BY totalValue DESC
      LIMIT 15`,
      siBinds
    );

    const [invRows] = await conn.query<RowDataPacket[]>(
      `SELECT
        si.siid AS id,
        si.sinotransaksi AS docNo,
        si.sitgl AS date,
        si.sitgljatuhtempo AS dueDate,
        COALESCE(NULLIF(TRIM(c.knama), ''), CONCAT('Customer #', si.sicustomer)) AS customerName,
        COALESCE(NULLIF(TRIM(sls.knama), ''), '-') AS salesmanName,
        COALESCE(NULLIF(TRIM(si.sigudang), ''), '-') AS warehouse,
        COALESCE(NULLIF(TRIM(si.simatauang), ''), 'IDR') AS currency,
        COALESCE(si.sitotaltransaksi, 0) AS total,
        COALESCE(si.sijmlbayar, 0) + COALESCE(si.sijmluangmuka, 0) AS paid,
        CASE WHEN COALESCE(si.sistatuslunas, 0) = 1 THEN 0 ELSE GREATEST(0, COALESCE(si.sitotaltransaksi, 0) - COALESCE(si.sijmlbayar, 0) - COALESCE(si.sijmluangmuka, 0)) END AS balance,
        COALESCE(si.sistatuslunas, 0) AS isPaid,
        CASE WHEN COALESCE(si.sistatuslunas, 0) = 0 AND si.sitgljatuhtempo IS NOT NULL AND si.sitgljatuhtempo < CURDATE() THEN 1 ELSE 0 END AS isOverdue,
        COALESCE(si.sistatus, 0) AS statusCode
      FROM m5_si si
      LEFT JOIN m1_contact c ON c.kid = si.sicustomer
      LEFT JOIN m1_contact sls ON sls.kid = si.sibagianpenjualan
      ${siWhereSql}
      ORDER BY si.sitgl DESC, si.siid DESC
      LIMIT ?`,
      [...siBinds, limit]
    );

    const [unpaidRows] = await conn.query<RowDataPacket[]>(
      `SELECT
        si.siid AS id,
        si.sinotransaksi AS docNo,
        si.sitgl AS date,
        si.sitgljatuhtempo AS dueDate,
        COALESCE(NULLIF(TRIM(c.knama), ''), CONCAT('Customer #', si.sicustomer)) AS customerName,
        COALESCE(NULLIF(TRIM(sls.knama), ''), '-') AS salesmanName,
        COALESCE(NULLIF(TRIM(si.sigudang), ''), '-') AS warehouse,
        COALESCE(NULLIF(TRIM(si.simatauang), ''), 'IDR') AS currency,
        COALESCE(si.sitotaltransaksi, 0) AS total,
        COALESCE(si.sijmlbayar, 0) + COALESCE(si.sijmluangmuka, 0) AS paid,
        GREATEST(0, COALESCE(si.sitotaltransaksi, 0) - COALESCE(si.sijmlbayar, 0) - COALESCE(si.sijmluangmuka, 0)) AS balance,
        0 AS isPaid,
        CASE WHEN si.sitgljatuhtempo IS NOT NULL AND si.sitgljatuhtempo < CURDATE() THEN 1 ELSE 0 END AS isOverdue,
        COALESCE(si.sistatus, 0) AS statusCode
      FROM m5_si si
      LEFT JOIN m1_contact c ON c.kid = si.sicustomer
      LEFT JOIN m1_contact sls ON sls.kid = si.sibagianpenjualan
      ${arWhereSql}
      ORDER BY si.sitgljatuhtempo ASC, si.sitgl ASC
      LIMIT ?`,
      [...arBinds, limit]
    );

    const soWhere: string[] = ['COALESCE(so.sostatus, 0) NOT IN (6, 12)', 'so.sotgl >= ?'];
    const soBinds: unknown[] = [dateFrom];
    if (dateTo) { soWhere.push('so.sotgl <= ?'); soBinds.push(dateTo); }
    if (search) {
      soWhere.push('(so.sonotransaksi LIKE ? OR COALESCE(c.knama, \'\') LIKE ?)');
      soBinds.push(`%${search}%`, `%${search}%`);
    }
    const soWhereSql = `WHERE ${soWhere.join(' AND ')}`;

    const [soAggRows] = await conn.query<RowDataPacket[]>(
      `SELECT
        COUNT(*) AS soCount,
        COALESCE(SUM(so.sototaltransaksi), 0) AS soTotalValue,
        SUM(CASE WHEN COALESCE(so.soisclose, 0) = 0 AND COALESCE(so.sostatus, 0) NOT IN (4, 7) AND COALESCE(so.sostatusdo, 0) = 0 THEN 1 ELSE 0 END) AS soOutstandingCount
      FROM m5_so so
      LEFT JOIN m1_contact c ON c.kid = so.socustomer
      ${soWhereSql}`,
      soBinds
    );

    const [soRows] = await conn.query<RowDataPacket[]>(
      `SELECT
        so.soid AS id,
        so.sonotransaksi AS docNo,
        so.sotgl AS date,
        so.sotglkirim AS shipDate,
        COALESCE(NULLIF(TRIM(c.knama), ''), CONCAT('Customer #', so.socustomer)) AS customerName,
        COALESCE(NULLIF(TRIM(so.sogudang), ''), '-') AS warehouse,
        COALESCE(so.sototaltransaksi, 0) AS total,
        COALESCE(so.sostatus, 0) AS statusCode,
        COALESCE(so.sostatusdo, 0) AS statusDo,
        COALESCE(so.sostatussi, 0) AS statusSi,
        COALESCE(so.soisclose, 0) AS isClosed
      FROM m5_so so
      LEFT JOIN m1_contact c ON c.kid = so.socustomer
      ${soWhereSql}
      ORDER BY so.sotgl DESC, so.soid DESC
      LIMIT ?`,
      [...soBinds, limit]
    );

    const doWhere: string[] = ['COALESCE(d.dostatus, 0) NOT IN (6, 12)', 'd.dotgl >= ?'];
    const doBinds: unknown[] = [dateFrom];
    if (dateTo) { doWhere.push('d.dotgl <= ?'); doBinds.push(dateTo); }
    if (search) {
      doWhere.push('(d.donotransaksi LIKE ? OR COALESCE(c.knama, \'\') LIKE ?)');
      doBinds.push(`%${search}%`, `%${search}%`);
    }
    const doWhereSql = `WHERE ${doWhere.join(' AND ')}`;

    const [doCntRows] = await conn.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS doCount FROM m5_do d LEFT JOIN m1_contact c ON c.kid = d.docustomer ${doWhereSql}`,
      doBinds
    );

    const [doRows] = await conn.query<RowDataPacket[]>(
      `SELECT
        d.doid AS id,
        d.donotransaksi AS docNo,
        d.dotgl AS date,
        d.dotglkirim AS shipDate,
        COALESCE(NULLIF(TRIM(c.knama), ''), CONCAT('Customer #', d.docustomer)) AS customerName,
        COALESCE(NULLIF(TRIM(d.dogudang), ''), '-') AS warehouse,
        COALESCE(NULLIF(TRIM(d.doekspedisi), ''), '-') AS expedition,
        COALESCE(d.dototaltransaksi, 0) AS total,
        COALESCE(d.dostatus, 0) AS statusCode
      FROM m5_do d
      LEFT JOIN m1_contact c ON c.kid = d.docustomer
      ${doWhereSql}
      ORDER BY d.dotgl DESC, d.doid DESC
      LIMIT ?`,
      [...doBinds, limit]
    );

    const srWhere: string[] = ['COALESCE(sr.srstatus, 0) NOT IN (6, 12)', 'sr.srtgl >= ?'];
    const srBinds: unknown[] = [dateFrom];
    if (dateTo) { srWhere.push('sr.srtgl <= ?'); srBinds.push(dateTo); }
    if (search) {
      srWhere.push('(sr.srnotransaksi LIKE ? OR COALESCE(c.knama, \'\') LIKE ?)');
      srBinds.push(`%${search}%`, `%${search}%`);
    }
    const srWhereSql = `WHERE ${srWhere.join(' AND ')}`;

    const [srAggRows] = await conn.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS returnCount, COALESCE(SUM(sr.srtotaltransaksi), 0) AS returnTotalValue
       FROM m5_sr sr LEFT JOIN m1_contact c ON c.kid = sr.srcustomer ${srWhereSql}`,
      srBinds
    );

    const [srRows] = await conn.query<RowDataPacket[]>(
      `SELECT
        sr.srid AS id,
        sr.srnotransaksi AS docNo,
        sr.srtgl AS date,
        COALESCE(NULLIF(TRIM(c.knama), ''), CONCAT('Customer #', sr.srcustomer)) AS customerName,
        COALESCE(NULLIF(TRIM(sr.srgudang), ''), '-') AS warehouse,
        COALESCE(sr.srtotaltransaksi, 0) AS total,
        COALESCE(sr.srstatus, 0) AS statusCode
      FROM m5_sr sr
      LEFT JOIN m1_contact c ON c.kid = sr.srcustomer
      ${srWhereSql}
      ORDER BY sr.srtgl DESC, sr.srid DESC
      LIMIT ?`,
      [...srBinds, limit]
    );

    const mapInv = (r: RowDataPacket): ErpSalesInvoiceRow => {
      const dt = formatDateIso(r.date);
      return {
        id: Number(r.id || 0),
        docNo: String(r.docNo || '-'),
        date: dt,
        dueDate: formatDateIso(r.dueDate),
        customerName: String(r.customerName || '-'),
        salesmanName: String(r.salesmanName || '-'),
        warehouse: String(r.warehouse || '-'),
        currency: String(r.currency || 'IDR'),
        total: Number(r.total || 0),
        paid: Number(r.paid || 0),
        balance: Number(r.balance || 0),
        isPaid: Boolean(Number(r.isPaid)),
        isOverdue: Boolean(Number(r.isOverdue)),
        isCarryOver: Boolean(dt && dt < ACTIVE_ERP_CUTOFF_DATE),
        statusCode: Number(r.statusCode || 0),
        statusLabel: getM0StatusLabel(r.statusCode),
      };
    };

    return {
      cutoffDate: ACTIVE_ERP_CUTOFF_DATE,
      period: { dateFrom, dateTo },
      kpi: {
        invoiceCount: Number(kpiRows[0]?.invoiceCount || 0),
        totalRevenue: Number(kpiRows[0]?.totalRevenue || 0),
        totalPaid: Number(kpiRows[0]?.totalPaid || 0),
        totalReceivable: Number(arKpiRows[0]?.totalReceivable || 0),
        unpaidInvoiceCount: Number(arKpiRows[0]?.unpaidInvoiceCount || 0),
        carryOverReceivable: Number(arKpiRows[0]?.carryOverReceivable || 0),
        carryOverUnpaidCount: Number(arKpiRows[0]?.carryOverUnpaidCount || 0),
        overdueInvoiceCount: Number(arKpiRows[0]?.overdueInvoiceCount || 0),
        overdueAmount: Number(arKpiRows[0]?.overdueAmount || 0),
        soCount: Number(soAggRows[0]?.soCount || 0),
        soTotalValue: Number(soAggRows[0]?.soTotalValue || 0),
        soOutstandingCount: Number(soAggRows[0]?.soOutstandingCount || 0),
        doCount: Number(doCntRows[0]?.doCount || 0),
        returnCount: Number(srAggRows[0]?.returnCount || 0),
        returnTotalValue: Number(srAggRows[0]?.returnTotalValue || 0),
      },
      monthlyRevenue: monthlyRows.map((r) => ({
        month: String(r.month || ''),
        invoiceCount: Number(r.invoiceCount || 0),
        revenue: Number(r.revenue || 0),
        paid: Number(r.paid || 0),
        receivable: Number(r.receivable || 0),
      })),
      topCustomers: topCustRows.map((r) => ({
        customerId: Number(r.customerId || 0),
        customerCode: String(r.customerCode || '-'),
        customerName: String(r.customerName || '-'),
        invoiceCount: Number(r.invoiceCount || 0),
        totalRevenue: Number(r.totalRevenue || 0),
        totalReceivable: Number(r.totalReceivable || 0),
      })),
      topItems: topItemRows.map((r) => ({
        itemId: Number(r.itemId || 0),
        itemCode: String(r.itemCode || '-'),
        itemName: String(r.itemName || '-'),
        totalQty: Number(r.totalQty || 0),
        unit: String(r.unit || 'Pcs'),
        totalValue: Number(r.totalValue || 0),
        invoiceCount: Number(r.invoiceCount || 0),
      })),
      invoices: invRows.map(mapInv),
      unpaidInvoices: unpaidRows.map(mapInv),
      salesOrders: soRows.map((r) => ({
        id: Number(r.id || 0),
        docNo: String(r.docNo || '-'),
        date: formatDateIso(r.date),
        shipDate: formatDateIso(r.shipDate),
        customerName: String(r.customerName || '-'),
        warehouse: String(r.warehouse || '-'),
        total: Number(r.total || 0),
        statusCode: Number(r.statusCode || 0),
        statusLabel: getM0StatusLabel(r.statusCode),
        statusDo: Number(r.statusDo || 0),
        statusSi: Number(r.statusSi || 0),
        isClosed: Boolean(Number(r.isClosed)),
      })),
      deliveryOrders: doRows.map((r) => ({
        id: Number(r.id || 0),
        docNo: String(r.docNo || '-'),
        date: formatDateIso(r.date),
        shipDate: formatDateIso(r.shipDate),
        customerName: String(r.customerName || '-'),
        warehouse: String(r.warehouse || '-'),
        expedition: String(r.expedition || '-'),
        total: Number(r.total || 0),
        statusCode: Number(r.statusCode || 0),
        statusLabel: getM0StatusLabel(r.statusCode),
      })),
      salesReturns: srRows.map((r) => ({
        id: Number(r.id || 0),
        docNo: String(r.docNo || '-'),
        date: formatDateIso(r.date),
        customerName: String(r.customerName || '-'),
        warehouse: String(r.warehouse || '-'),
        total: Number(r.total || 0),
        statusCode: Number(r.statusCode || 0),
        statusLabel: getM0StatusLabel(r.statusCode),
      })),
      fetchedAt: new Date().toISOString(),
    };
  });

  if (salesQueryCache.size > 30) {
    const oldest = salesQueryCache.keys().next().value;
    if (oldest) salesQueryCache.delete(oldest);
  }
  salesQueryCache.set(cacheKey, {
    expiresAt: Date.now() + STOCK_CACHE_TTL_MS,
    data,
  });
  return data;
}

function classifyCoaSection(ctipe: number, cnomor: string): string {
  const num = String(cnomor || '');
  if (ctipe === 0) return 'Kas';
  if (ctipe === 1) return 'Bank';
  if (ctipe === 2 || num.startsWith('1102')) return 'Piutang (AR)';
  if (ctipe === 3) return 'Persediaan';
  if (ctipe === 4) return 'Aset Lancar Lainnya';
  if (ctipe === 5) return 'Aset Tetap & Lainnya';
  if (ctipe === 6) return 'Akumulasi Penyusutan';
  if (ctipe === 7 || num.startsWith('210101')) return 'Hutang Usaha (AP)';
  if (num.startsWith('210103')) return 'Hutang Lainnya (AP)';
  if (ctipe === 8) return 'Pajak & Beban Akrual';
  if (ctipe === 9) return 'Liabilitas Jangka Panjang';
  if (ctipe === 10) return 'Ekuitas';
  if (ctipe === 11) return 'Pendapatan Usaha';
  if (ctipe === 12) {
    if (num.startsWith('520101')) return 'COGS — Opening Balance';
    if (num.startsWith('520102')) return 'COGS — Closing Balance';
    if (num.startsWith('51') || num.startsWith('52')) return 'COGS — Material & Pembelian';
    if (num.startsWith('53')) return 'COGS — Labour Expense';
    return 'COGS — Other COGS';
  }
  if (ctipe === 13) return 'Beban Operasional';
  if (ctipe === 14) return 'Pendapatan Lain-lain';
  if (ctipe === 15) return 'Beban Lain-lain';
  if (ctipe === 16) return 'OCI (Other Comprehensive Income)';
  if (ctipe === 17) return 'Pajak Penghasilan (Income Taxes)';
  return 'Lainnya';
}

function isArAccount(ctipe: number, cnomor: string): boolean {
  return ctipe === 2 || String(cnomor || '').startsWith('1102');
}

function isApAccount(ctipe: number, cnomor: string): boolean {
  const num = String(cnomor || '');
  return ctipe === 7 || num.startsWith('210101') || num.startsWith('210103');
}

export async function queryErpFinanceData(params?: {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  bypassCache?: boolean;
}): Promise<ErpFinanceQueryResult> {
  const search = (params?.search || '').trim();
  const dateFrom = clampActiveDateFrom(params?.dateFrom);
  const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(params?.dateTo || '') ? params!.dateTo! : '';

  const cacheKey = `${search.toLowerCase()}|${dateFrom}|${dateTo}`;
  if (!params?.bypassCache) {
    const cached = financeQueryCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.data;
    }
  }

  const bridgeCfg = getErpBridgeConfig();
  if (bridgeCfg.configured) {
    const qs = new URLSearchParams();
    if (search) qs.set('q', search);
    if (dateFrom) qs.set('dateFrom', dateFrom);
    if (dateTo) qs.set('dateTo', dateTo);

    const data = await fetchErpBridgeJson<ErpFinanceQueryResult>(`/finance?${qs.toString()}`);
    if (financeQueryCache.size > 30) {
      const oldest = financeQueryCache.keys().next().value;
      if (oldest) financeQueryCache.delete(oldest);
    }
    financeQueryCache.set(cacheKey, {
      expiresAt: Date.now() + STOCK_CACHE_TTL_MS,
      data,
    });
    return data;
  }

  // Direct MySQL TCP mode for myerpplus m1_coa + m2_transaction_journal
  const data = await withReadOnlyConnection(async (conn) => {
    const [covRows] = await conn.query<RowDataPacket[]>(
      `SELECT
        MIN(ttgl) AS minDateAll,
        MAX(ttgl) AS maxDateAll,
        COUNT(*) AS totalRowsAll,
        MIN(CASE WHEN ttgl >= ? THEN ttgl END) AS minDateActive,
        MAX(CASE WHEN ttgl >= ? THEN ttgl END) AS maxDateActive,
        SUM(CASE WHEN ttgl >= ? THEN 1 ELSE 0 END) AS totalRowsActive
      FROM m2_transaction_journal
      WHERE COALESCE(tstatus, 0) NOT IN (6, 12) AND COALESCE(tposting, 1) = 1`,
      [ACTIVE_ERP_CUTOFF_DATE, ACTIVE_ERP_CUTOFF_DATE, ACTIVE_ERP_CUTOFF_DATE]
    );

    const dateToClause = dateTo ? ' AND j.ttgl <= ?' : '';
    const dateToBind = dateTo ? [dateTo] : [];

    const pnlBinds: unknown[] = [dateFrom, ...dateToBind];
    let pnlSearchSql = '';
    if (search) {
      pnlSearchSql = ' AND (c.cnomor LIKE ? OR c.cnama LIKE ?)';
      pnlBinds.push(`%${search}%`, `%${search}%`);
    }

    const [pnlRows] = await conn.query<RowDataPacket[]>(
      `SELECT c.cnomor AS accountNo, c.cnama AS accountName, c.ctipe AS ctipe, c.cdc AS cdc,
        COALESCE(SUM(j.tdebit), 0) AS debit, COALESCE(SUM(j.tkredit), 0) AS credit
      FROM m2_transaction_journal j
      INNER JOIN m1_coa c ON c.cnomor = j.tnorek
      WHERE COALESCE(j.tstatus, 0) NOT IN (6, 12) AND COALESCE(j.tposting, 1) = 1
        AND c.cgd = 'D' AND c.ctipe BETWEEN 11 AND 17
        AND j.ttgl >= ? ${dateToClause} ${pnlSearchSql}
      GROUP BY c.cnomor, c.cnama, c.ctipe, c.cdc
      ORDER BY c.cnomor ASC`,
      pnlBinds
    );

    const [monthlyPnlRows] = await conn.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(j.ttgl, '%Y-%m') AS month,
        COALESCE(SUM(CASE WHEN c.ctipe = 11 THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS revenue,
        COALESCE(SUM(CASE WHEN c.ctipe = 12 AND (c.cnomor LIKE '51%' OR c.cnomor LIKE '52%') THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS cogsMaterial,
        COALESCE(SUM(CASE WHEN c.ctipe = 12 AND c.cnomor LIKE '520101%' THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS cogsOpeningBalance,
        COALESCE(SUM(CASE WHEN c.ctipe = 12 AND c.cnomor LIKE '520102%' THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS cogsClosingBalance,
        COALESCE(SUM(CASE WHEN c.ctipe = 12 AND c.cnomor LIKE '53%' THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS cogsLabour,
        COALESCE(SUM(CASE WHEN c.ctipe = 12 AND c.cnomor NOT LIKE '51%' AND c.cnomor NOT LIKE '52%' AND c.cnomor NOT LIKE '53%' THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS cogsOther,
        COALESCE(SUM(CASE WHEN c.ctipe = 12 THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS cogs,
        COALESCE(SUM(CASE WHEN c.ctipe = 13 THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS opex,
        COALESCE(SUM(CASE WHEN c.ctipe = 14 THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS otherIncome,
        COALESCE(SUM(CASE WHEN c.ctipe = 15 THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS otherExpense,
        COALESCE(SUM(CASE WHEN c.ctipe = 16 THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS oci,
        COALESCE(SUM(CASE WHEN c.ctipe = 17 THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS incomeTax,
        COALESCE(SUM(CASE WHEN c.ctipe IN (12, 13, 15) AND (LOWER(c.cnama) LIKE '%bunga%' OR LOWER(c.cnama) LIKE '%interest%') THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS interestExpense,
        COALESCE(SUM(CASE WHEN c.ctipe IN (12, 13, 15) AND NOT (LOWER(c.cnama) LIKE '%bunga%' OR LOWER(c.cnama) LIKE '%interest%') AND (LOWER(c.cnama) LIKE '%penyusut%' OR LOWER(c.cnama) LIKE '%depresiasi%' OR LOWER(c.cnama) LIKE '%depreciation%' OR LOWER(c.cnama) LIKE '%amortis%' OR LOWER(c.cnama) LIKE '%amortiz%') THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS depreciationAmortization,
        COALESCE(SUM(CASE WHEN c.ctipe IN (12, 13, 15) AND NOT (LOWER(c.cnama) LIKE '%bunga%' OR LOWER(c.cnama) LIKE '%interest%') AND NOT (LOWER(c.cnama) LIKE '%penyusut%' OR LOWER(c.cnama) LIKE '%depresiasi%' OR LOWER(c.cnama) LIKE '%depreciation%' OR LOWER(c.cnama) LIKE '%amortis%' OR LOWER(c.cnama) LIKE '%amortiz%') AND (LOWER(c.cnama) LIKE '%pajak penghasilan%' OR LOWER(c.cnama) LIKE '%pph badan%' OR LOWER(c.cnama) LIKE '%income tax%') THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS taxExpenseInOpex
      FROM m2_transaction_journal j
      INNER JOIN m1_coa c ON c.cnomor = j.tnorek
      WHERE COALESCE(j.tstatus, 0) NOT IN (6, 12) AND COALESCE(j.tposting, 1) = 1
        AND c.cgd = 'D' AND c.ctipe BETWEEN 11 AND 17
        AND j.ttgl >= ? ${dateToClause}
      GROUP BY DATE_FORMAT(j.ttgl, '%Y-%m')
      ORDER BY month ASC
      LIMIT 24`,
      [dateFrom, ...dateToBind]
    );

    const bsBinds: unknown[] = [
      ACTIVE_ERP_CUTOFF_DATE,
      ACTIVE_ERP_CUTOFF_DATE,
      ACTIVE_ERP_CUTOFF_DATE,
      ACTIVE_ERP_CUTOFF_DATE,
      ...dateToBind,
      ACTIVE_ERP_CUTOFF_DATE,
    ];
    let bsSearchSql = '';
    if (search) {
      bsSearchSql = ' AND (c.cnomor LIKE ? OR c.cnama LIKE ?)';
      bsBinds.push(`%${search}%`, `%${search}%`);
    }

    const [bsRows] = await conn.query<RowDataPacket[]>(
      `SELECT c.cnomor AS accountNo, c.cnama AS accountName, c.ctipe AS ctipe, c.cdc AS cdc,
        COALESCE(SUM(CASE WHEN j.ttgl < ? THEN j.tdebit ELSE 0 END), 0) AS carryDebit,
        COALESCE(SUM(CASE WHEN j.ttgl < ? THEN j.tkredit ELSE 0 END), 0) AS carryCredit,
        COALESCE(SUM(CASE WHEN j.ttgl >= ? THEN j.tdebit ELSE 0 END), 0) AS periodDebit,
        COALESCE(SUM(CASE WHEN j.ttgl >= ? THEN j.tkredit ELSE 0 END), 0) AS periodCredit
      FROM m2_transaction_journal j
      INNER JOIN m1_coa c ON c.cnomor = j.tnorek
      WHERE COALESCE(j.tstatus, 0) NOT IN (6, 12) AND COALESCE(j.tposting, 1) = 1
        AND c.cgd = 'D' AND c.ctipe BETWEEN 0 AND 10 ${dateToClause}
        AND (j.ttgl >= ? OR c.ctipe IN (2, 7) OR c.cnomor LIKE '1102%' OR c.cnomor LIKE '210101%' OR c.cnomor LIKE '210103%')
        ${bsSearchSql}
      GROUP BY c.cnomor, c.cnama, c.ctipe, c.cdc
      ORDER BY c.cnomor ASC`,
      bsBinds
    );

    // Monthly Balance Sheet Opening (< dateFrom) and Monthly Delta (>= dateFrom) for BI KPIs 08-18
    const [bsOpeningRows] = await conn.query<RowDataPacket[]>(
      `SELECT
        COALESCE(SUM(CASE WHEN (c.ctipe = 2 OR c.cnomor LIKE '1102%') THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS ar,
        COALESCE(SUM(CASE WHEN c.ctipe = 3 THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS inventory,
        COALESCE(SUM(CASE WHEN (c.ctipe = 7 OR c.cnomor LIKE '210101%' OR c.cnomor LIKE '210103%') THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS ap,
        COALESCE(SUM(CASE WHEN c.ctipe BETWEEN 0 AND 4 THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS currentAssets,
        COALESCE(SUM(CASE WHEN c.ctipe = 5 THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS fixedAssets,
        COALESCE(SUM(CASE WHEN c.ctipe = 6 THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS accumDep,
        COALESCE(SUM(CASE WHEN c.ctipe BETWEEN 0 AND 6 THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS totalAssets,
        COALESCE(SUM(CASE WHEN c.ctipe IN (7, 8) THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS currentLiabilities,
        COALESCE(SUM(CASE WHEN c.ctipe = 9 THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS longTermLiabilities,
        COALESCE(SUM(CASE WHEN c.ctipe IN (7, 8, 9) THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS totalLiabilities,
        COALESCE(SUM(CASE WHEN c.ctipe = 10 THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS equity
      FROM m2_transaction_journal j
      INNER JOIN m1_coa c ON c.cnomor = j.tnorek
      WHERE COALESCE(j.tstatus, 0) NOT IN (6, 12) AND COALESCE(j.tposting, 1) = 1
        AND c.cgd = 'D' AND c.ctipe BETWEEN 0 AND 10
        AND j.ttgl < ?
        AND (j.ttgl >= ? OR c.ctipe IN (2, 7) OR c.cnomor LIKE '1102%' OR c.cnomor LIKE '210101%' OR c.cnomor LIKE '210103%')`,
      [dateFrom, ACTIVE_ERP_CUTOFF_DATE]
    );

    const [bsMonthlyDeltaRows] = await conn.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(j.ttgl, '%Y-%m') AS month,
        COALESCE(SUM(CASE WHEN (c.ctipe = 2 OR c.cnomor LIKE '1102%') THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS ar,
        COALESCE(SUM(CASE WHEN c.ctipe = 3 THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS inventory,
        COALESCE(SUM(CASE WHEN (c.ctipe = 7 OR c.cnomor LIKE '210101%' OR c.cnomor LIKE '210103%') THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS ap,
        COALESCE(SUM(CASE WHEN c.ctipe BETWEEN 0 AND 4 THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS currentAssets,
        COALESCE(SUM(CASE WHEN c.ctipe = 5 THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS fixedAssets,
        COALESCE(SUM(CASE WHEN c.ctipe = 6 THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS accumDep,
        COALESCE(SUM(CASE WHEN c.ctipe BETWEEN 0 AND 6 THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS totalAssets,
        COALESCE(SUM(CASE WHEN c.ctipe IN (7, 8) THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS currentLiabilities,
        COALESCE(SUM(CASE WHEN c.ctipe = 9 THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS longTermLiabilities,
        COALESCE(SUM(CASE WHEN c.ctipe IN (7, 8, 9) THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS totalLiabilities,
        COALESCE(SUM(CASE WHEN c.ctipe = 10 THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS equity
      FROM m2_transaction_journal j
      INNER JOIN m1_coa c ON c.cnomor = j.tnorek
      WHERE COALESCE(j.tstatus, 0) NOT IN (6, 12) AND COALESCE(j.tposting, 1) = 1
        AND c.cgd = 'D' AND c.ctipe BETWEEN 0 AND 10
        AND j.ttgl >= ? ${dateToClause}
      GROUP BY DATE_FORMAT(j.ttgl, '%Y-%m')
      ORDER BY month ASC
      LIMIT 24`,
      [dateFrom, ...dateToBind]
    );

    const contactBinds: unknown[] = [ACTIVE_ERP_CUTOFF_DATE, ACTIVE_ERP_CUTOFF_DATE, ...dateToBind];
    const [topArRows] = await conn.query<RowDataPacket[]>(
      `SELECT COALESCE(j.tkontak, 0) AS contactId,
        COALESCE(NULLIF(TRIM(ct.kkode), ''), CAST(COALESCE(j.tkontak, 0) AS CHAR)) AS contactCode,
        COALESCE(NULLIF(TRIM(ct.knama), ''), CASE WHEN COALESCE(j.tkontak, 0) > 0 THEN CONCAT('Kontak #', j.tkontak) ELSE 'Tanpa Sub-Ledger Kontak' END) AS contactName,
        COALESCE(SUM(CASE WHEN j.ttgl < ? THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS carryOverBalance,
        COALESCE(SUM(CASE WHEN j.ttgl >= ? THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS periodBalance,
        COALESCE(SUM(j.tdebit - j.tkredit), 0) AS totalBalance
      FROM m2_transaction_journal j
      INNER JOIN m1_coa c ON c.cnomor = j.tnorek
      LEFT JOIN m1_contact ct ON ct.kid = j.tkontak
      WHERE COALESCE(j.tstatus, 0) NOT IN (6, 12) AND COALESCE(j.tposting, 1) = 1
        AND c.cgd = 'D' AND (c.ctipe = 2 OR c.cnomor LIKE '1102%') ${dateToClause}
      GROUP BY COALESCE(j.tkontak, 0), contactCode, contactName
      HAVING ABS(totalBalance) >= 1
      ORDER BY totalBalance DESC
      LIMIT 20`,
      contactBinds
    );

    const [topApRows] = await conn.query<RowDataPacket[]>(
      `SELECT COALESCE(j.tkontak, 0) AS contactId,
        COALESCE(NULLIF(TRIM(ct.kkode), ''), CAST(COALESCE(j.tkontak, 0) AS CHAR)) AS contactCode,
        COALESCE(NULLIF(TRIM(ct.knama), ''), CASE WHEN COALESCE(j.tkontak, 0) > 0 THEN CONCAT('Kontak #', j.tkontak) ELSE 'Tanpa Sub-Ledger Kontak' END) AS contactName,
        COALESCE(SUM(CASE WHEN j.ttgl < ? THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS carryOverBalance,
        COALESCE(SUM(CASE WHEN j.ttgl >= ? THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS periodBalance,
        COALESCE(SUM(j.tkredit - j.tdebit), 0) AS totalBalance
      FROM m2_transaction_journal j
      INNER JOIN m1_coa c ON c.cnomor = j.tnorek
      LEFT JOIN m1_contact ct ON ct.kid = j.tkontak
      WHERE COALESCE(j.tstatus, 0) NOT IN (6, 12) AND COALESCE(j.tposting, 1) = 1
        AND c.cgd = 'D' AND (c.ctipe = 7 OR c.cnomor LIKE '210101%' OR c.cnomor LIKE '210103%') ${dateToClause}
      GROUP BY COALESCE(j.tkontak, 0), contactCode, contactName
      HAVING ABS(totalBalance) >= 1
      ORDER BY totalBalance DESC
      LIMIT 20`,
      contactBinds
    );

    const arAging: ErpFinanceArAging = {
      current: { count: 0, amount: 0 },
      days1to30: { count: 0, amount: 0 },
      days31to60: { count: 0, amount: 0 },
      days61to90: { count: 0, amount: 0 },
      over90: { count: 0, amount: 0 },
      totalCount: 0,
      totalAmount: 0,
      carryOverCount: 0,
      carryOverAmount: 0,
    };

    try {
      const siDateClause = dateTo ? ' AND si.sitgl <= ?' : '';
      const balExpr = 'GREATEST(0, COALESCE(si.sitotaltransaksi, 0) - COALESCE(si.sijmlbayar, 0) - COALESCE(si.sijmluangmuka, 0))';
      const [agRows] = await conn.query<RowDataPacket[]>(
        `SELECT
          COUNT(*) AS totalCount, COALESCE(SUM(${balExpr}), 0) AS totalAmount,
          SUM(CASE WHEN si.sitgl < ? THEN 1 ELSE 0 END) AS carryOverCount,
          COALESCE(SUM(CASE WHEN si.sitgl < ? THEN ${balExpr} ELSE 0 END), 0) AS carryOverAmount,
          SUM(CASE WHEN si.sitgljatuhtempo IS NULL OR DATEDIFF(CURDATE(), si.sitgljatuhtempo) <= 0 THEN 1 ELSE 0 END) AS curCnt,
          COALESCE(SUM(CASE WHEN si.sitgljatuhtempo IS NULL OR DATEDIFF(CURDATE(), si.sitgljatuhtempo) <= 0 THEN ${balExpr} ELSE 0 END), 0) AS curAmt,
          SUM(CASE WHEN DATEDIFF(CURDATE(), si.sitgljatuhtempo) BETWEEN 1 AND 30 THEN 1 ELSE 0 END) AS d30Cnt,
          COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), si.sitgljatuhtempo) BETWEEN 1 AND 30 THEN ${balExpr} ELSE 0 END), 0) AS d30Amt,
          SUM(CASE WHEN DATEDIFF(CURDATE(), si.sitgljatuhtempo) BETWEEN 31 AND 60 THEN 1 ELSE 0 END) AS d60Cnt,
          COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), si.sitgljatuhtempo) BETWEEN 31 AND 60 THEN ${balExpr} ELSE 0 END), 0) AS d60Amt,
          SUM(CASE WHEN DATEDIFF(CURDATE(), si.sitgljatuhtempo) BETWEEN 61 AND 90 THEN 1 ELSE 0 END) AS d90Cnt,
          COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), si.sitgljatuhtempo) BETWEEN 61 AND 90 THEN ${balExpr} ELSE 0 END), 0) AS d90Amt,
          SUM(CASE WHEN DATEDIFF(CURDATE(), si.sitgljatuhtempo) > 90 THEN 1 ELSE 0 END) AS over90Cnt,
          COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), si.sitgljatuhtempo) > 90 THEN ${balExpr} ELSE 0 END), 0) AS over90Amt
        FROM m5_si si
        WHERE COALESCE(si.sistatus, 0) NOT IN (6, 12) AND COALESCE(si.sistatuslunas, 0) = 0 AND ${balExpr} > 0 ${siDateClause}`,
        [ACTIVE_ERP_CUTOFF_DATE, ACTIVE_ERP_CUTOFF_DATE, ...dateToBind]
      );
      const a = agRows[0];
      if (a) {
        arAging.current = { count: Number(a.curCnt || 0), amount: Number(a.curAmt || 0) };
        arAging.days1to30 = { count: Number(a.d30Cnt || 0), amount: Number(a.d30Amt || 0) };
        arAging.days31to60 = { count: Number(a.d60Cnt || 0), amount: Number(a.d60Amt || 0) };
        arAging.days61to90 = { count: Number(a.d90Cnt || 0), amount: Number(a.d90Amt || 0) };
        arAging.over90 = { count: Number(a.over90Cnt || 0), amount: Number(a.over90Amt || 0) };
        arAging.totalCount = Number(a.totalCount || 0);
        arAging.totalAmount = Number(a.totalAmount || 0);
        arAging.carryOverCount = Number(a.carryOverCount || 0);
        arAging.carryOverAmount = Number(a.carryOverAmount || 0);
      }
    } catch {
      // Ignore if m5_si not available
    }

    let anomalyCount = 0;
    let revenue = 0;
    let cogsMaterial = 0;
    let cogsOpeningBalance = 0;
    let cogsClosingBalance = 0;
    let cogsLabour = 0;
    let cogsOther = 0;
    let cogs = 0;
    let opex = 0;
    let otherIncome = 0;
    let otherExpense = 0;
    let oci = 0;
    let incomeTax = 0;

    const pnlAccounts: ErpFinancePnlAccountRow[] = pnlRows.map((r) => {
      const accountNo = String(r.accountNo || '');
      const ctipe = Number(r.ctipe || 0);
      const cdc = String(r.cdc || 'D').toUpperCase();
      const debit = Number(r.debit || 0);
      const credit = Number(r.credit || 0);
      const amount = cdc === 'C' ? credit - debit : debit - credit;
      const hasAnomaly = Math.abs(amount) >= ANOMALY_ABS_THRESHOLD;
      if (hasAnomaly) anomalyCount += 1;

      if (!hasAnomaly) {
        if (ctipe === 11) {
          revenue += credit - debit;
        } else if (ctipe === 12) {
          const net = debit - credit;
          cogs += net;
          if (accountNo.startsWith('520101')) cogsOpeningBalance += net;
          if (accountNo.startsWith('520102')) cogsClosingBalance += net;
          if (accountNo.startsWith('51') || accountNo.startsWith('52')) cogsMaterial += net;
          else if (accountNo.startsWith('53')) cogsLabour += net;
          else cogsOther += net;
        } else if (ctipe === 13) {
          opex += debit - credit;
        } else if (ctipe === 14) {
          otherIncome += credit - debit;
        } else if (ctipe === 15) {
          otherExpense += debit - credit;
        } else if (ctipe === 16) {
          oci += debit - credit;
        } else if (ctipe === 17) {
          incomeTax += credit - debit;
        }
      }

      return {
        accountNo,
        accountName: String(r.accountName || ''),
        ctipe,
        cdc,
        section: classifyCoaSection(ctipe, accountNo),
        debit,
        credit,
        amount,
        hasAnomaly,
      };
    });

    const grossProfit = revenue - cogs;
    const operatingProfit = grossProfit - opex;
    const profitBeforeTax = operatingProfit + otherIncome - otherExpense;
    const taxAndExtraordinary = incomeTax - oci;
    const netIncome = profitBeforeTax + taxAndExtraordinary;
    const hasOpeningClosingInput =
      Math.abs(cogsOpeningBalance) >= 1 || Math.abs(cogsClosingBalance) >= 1;

    let totalArJournal = 0;
    let totalArCarryOver = 0;
    let totalArPeriod = 0;
    let totalApJournal = 0;
    let totalApCarryOver = 0;
    let totalApPeriod = 0;
    let cashAndBankMovement = 0;
    let inventoryMovement = 0;

    const balanceSheetAccounts: ErpFinanceBsAccountRow[] = bsRows.map((r) => {
      const ctipe = Number(r.ctipe || 0);
      const accountNo = String(r.accountNo || '');
      const cdc = String(r.cdc || 'D').toUpperCase();
      const arFlag = isArAccount(ctipe, accountNo);
      const apFlag = isApAccount(ctipe, accountNo);
      const isArAp = arFlag || apFlag;

      const carryDebit = Number(r.carryDebit || 0);
      const carryCredit = Number(r.carryCredit || 0);
      const periodDebit = Number(r.periodDebit || 0);
      const periodCredit = Number(r.periodCredit || 0);

      const carryOverBalance = isArAp
        ? cdc === 'C'
          ? carryCredit - carryDebit
          : carryDebit - carryCredit
        : 0;
      const periodBalance = cdc === 'C' ? periodCredit - periodDebit : periodDebit - periodCredit;
      const balance = carryOverBalance + periodBalance;
      const hasAnomaly = Math.abs(balance) >= ANOMALY_ABS_THRESHOLD;
      if (hasAnomaly) anomalyCount += 1;

      if (!hasAnomaly) {
        if (arFlag) {
          totalArCarryOver += carryOverBalance;
          totalArPeriod += periodBalance;
          totalArJournal += balance;
        } else if (apFlag) {
          totalApCarryOver += carryOverBalance;
          totalApPeriod += periodBalance;
          totalApJournal += balance;
        } else if (ctipe === 0 || ctipe === 1) {
          cashAndBankMovement += periodBalance;
        } else if (ctipe === 3) {
          inventoryMovement += periodBalance;
        }
      }

      return {
        accountNo,
        accountName: String(r.accountName || ''),
        ctipe,
        cdc,
        section: classifyCoaSection(ctipe, accountNo),
        isAr: arFlag,
        isAp: apFlag,
        isArAp,
        carryOverBalance,
        periodBalance,
        balance,
        hasAnomaly,
      };
    });

    const overdueCount =
      arAging.days1to30.count + arAging.days31to60.count + arAging.days61to90.count + arAging.over90.count;
    const overdueAmount =
      arAging.days1to30.amount + arAging.days31to60.amount + arAging.days61to90.amount + arAging.over90.amount;

    return {
      cutoffDate: ACTIVE_ERP_CUTOFF_DATE,
      period: { dateFrom, dateTo },
      coverage: {
        minDateAll: formatDateIso(covRows[0]?.minDateAll),
        maxDateAll: formatDateIso(covRows[0]?.maxDateAll),
        totalRowsAll: Number(covRows[0]?.totalRowsAll || 0),
        minDateActive: formatDateIso(covRows[0]?.minDateActive),
        maxDateActive: formatDateIso(covRows[0]?.maxDateActive),
        totalRowsActive: Number(covRows[0]?.totalRowsActive || 0),
        anomalyCount,
      },
      kpi: {
        revenue,
        cogsMaterial,
        cogsOpeningBalance,
        cogsClosingBalance,
        cogsLabour,
        cogsOther,
        cogs,
        hasOpeningClosingInput,
        grossProfit,
        grossMarginPct: revenue > 0 ? Number(((grossProfit / revenue) * 100).toFixed(2)) : 0,
        opex,
        operatingProfit,
        otherIncome,
        otherExpense,
        profitBeforeTax,
        oci,
        incomeTax,
        taxAndExtraordinary,
        otherAdj: incomeTax,
        taxExpense: oci,
        netIncome,
        netMarginPct: revenue > 0 ? Number(((netIncome / revenue) * 100).toFixed(2)) : 0,
        totalArJournal,
        totalArCarryOver,
        totalArPeriod,
        totalApJournal,
        totalApCarryOver,
        totalApPeriod,
        arUnpaidInvoiceTotal: arAging.totalAmount,
        arUnpaidInvoiceCount: arAging.totalCount,
        arOverdueTotal: overdueAmount,
        arOverdueCount: overdueCount,
        cashAndBankMovement,
        inventoryMovement,
      },
      monthlyPnl: monthlyPnlRows.map((m) => {
        const rev = Number(m.revenue || 0);
        const cgMat = Number(m.cogsMaterial || 0);
        const cgOpen = Number(m.cogsOpeningBalance || 0);
        const cgClose = Number(m.cogsClosingBalance || 0);
        const cgLab = Number(m.cogsLabour || 0);
        const cgOth = Number(m.cogsOther || 0);
        const cg = Number(m.cogs || 0);
        const op = Number(m.opex || 0);
        const oi = Number(m.otherIncome || 0);
        const oe = Number(m.otherExpense || 0);
        const mOci = Number(m.oci || 0);
        const mTax = Number(m.incomeTax || 0);
        const mInterest = Number(m.interestExpense || 0);
        const mDepAmort = Number(m.depreciationAmortization || 0);
        const mTaxInOpex = Number(m.taxExpenseInOpex || 0);
        const gp = rev - cg;
        const ebit = gp - op;
        const pbt = ebit + oi - oe;
        return {
          month: String(m.month || ''),
          revenue: rev,
          cogsMaterial: cgMat,
          cogsOpeningBalance: cgOpen,
          cogsClosingBalance: cgClose,
          cogsLabour: cgLab,
          cogsOther: cgOth,
          cogs: cg,
          grossProfit: gp,
          opex: op,
          otherIncome: oi,
          otherExpense: oe,
          operatingProfit: ebit,
          profitBeforeTax: pbt,
          oci: mOci,
          incomeTax: mTax,
          interestExpense: mInterest,
          depreciationAmortization: mDepAmort,
          taxExpenseInOpex: mTaxInOpex,
          netIncome: pbt + mTax - mOci,
          hasOpeningClosingInput: Math.abs(cgOpen) >= 1 || Math.abs(cgClose) >= 1,
        };
      }),
      monthlyBalanceSheet: (() => {
        const openRow = bsOpeningRows[0] || {};
        const running = {
          ar: Number(openRow.ar || 0),
          inventory: Number(openRow.inventory || 0),
          ap: Number(openRow.ap || 0),
          currentAssets: Number(openRow.currentAssets || 0),
          fixedAssets: Number(openRow.fixedAssets || 0),
          accumDep: Number(openRow.accumDep || 0),
          totalAssets: Number(openRow.totalAssets || 0),
          currentLiabilities: Number(openRow.currentLiabilities || 0),
          longTermLiabilities: Number(openRow.longTermLiabilities || 0),
          totalLiabilities: Number(openRow.totalLiabilities || 0),
          equity: Number(openRow.equity || 0),
        };
        const deltaMap = new Map<string, RowDataPacket>();
        for (const r of bsMonthlyDeltaRows) {
          const mKey = String(r.month || '');
          if (mKey) deltaMap.set(mKey, r);
        }
        const monthSet = new Set<string>();
        for (const r of monthlyPnlRows) {
          const mKey = String(r.month || '');
          if (mKey) monthSet.add(mKey);
        }
        for (const mKey of deltaMap.keys()) {
          monthSet.add(mKey);
        }
        const sortedMonths = Array.from(monthSet).sort((a, b) => a.localeCompare(b));
        return sortedMonths.map((month): ErpFinanceMonthlyBsRow => {
          const d = deltaMap.get(month);
          const arStart = running.ar;
          const inventoryStart = running.inventory;
          const apStart = running.ap;
          const currentAssetsStart = running.currentAssets;
          const fixedAssetsStart = running.fixedAssets;
          const accumDepStart = running.accumDep;
          const totalAssetsStart = running.totalAssets;
          const currentLiabilitiesStart = running.currentLiabilities;
          const longTermLiabilitiesStart = running.longTermLiabilities;
          const totalLiabilitiesStart = running.totalLiabilities;
          const equityStart = running.equity;
          const capitalEmployedStart = totalAssetsStart - currentLiabilitiesStart;

          running.ar += Number(d?.ar || 0);
          running.inventory += Number(d?.inventory || 0);
          running.ap += Number(d?.ap || 0);
          running.currentAssets += Number(d?.currentAssets || 0);
          running.fixedAssets += Number(d?.fixedAssets || 0);
          running.accumDep += Number(d?.accumDep || 0);
          running.totalAssets += Number(d?.totalAssets || 0);
          running.currentLiabilities += Number(d?.currentLiabilities || 0);
          running.longTermLiabilities += Number(d?.longTermLiabilities || 0);
          running.totalLiabilities += Number(d?.totalLiabilities || 0);
          running.equity += Number(d?.equity || 0);

          const capitalEmployedEnd = running.totalAssets - running.currentLiabilities;
          return {
            month,
            arStart,
            arEnd: running.ar,
            inventoryStart,
            inventoryEnd: running.inventory,
            apStart,
            apEnd: running.ap,
            currentAssetsStart,
            currentAssetsEnd: running.currentAssets,
            fixedAssetsStart,
            fixedAssetsEnd: running.fixedAssets,
            accumDepStart,
            accumDepEnd: running.accumDep,
            totalAssetsStart,
            totalAssetsEnd: running.totalAssets,
            currentLiabilitiesStart,
            currentLiabilitiesEnd: running.currentLiabilities,
            longTermLiabilitiesStart,
            longTermLiabilitiesEnd: running.longTermLiabilities,
            totalLiabilitiesStart,
            totalLiabilitiesEnd: running.totalLiabilities,
            equityStart,
            equityEnd: running.equity,
            capitalEmployedStart,
            capitalEmployedEnd,
          };
        });
      })(),
      pnlAccounts,
      balanceSheetAccounts,
      arAccounts: balanceSheetAccounts.filter((a) => a.isAr),
      apAccounts: balanceSheetAccounts.filter((a) => a.isAp),
      topArContacts: topArRows.map((r) => ({
        contactId: Number(r.contactId || 0),
        contactCode: String(r.contactCode || '-'),
        contactName: String(r.contactName || '-'),
        carryOverBalance: Number(r.carryOverBalance || 0),
        periodBalance: Number(r.periodBalance || 0),
        totalBalance: Number(r.totalBalance || 0),
      })),
      topApContacts: topApRows.map((r) => ({
        contactId: Number(r.contactId || 0),
        contactCode: String(r.contactCode || '-'),
        contactName: String(r.contactName || '-'),
        carryOverBalance: Number(r.carryOverBalance || 0),
        periodBalance: Number(r.periodBalance || 0),
        totalBalance: Number(r.totalBalance || 0),
      })),
      arAging,
      fetchedAt: new Date().toISOString(),
    };
  });

  if (financeQueryCache.size > 30) {
    const oldest = financeQueryCache.keys().next().value;
    if (oldest) financeQueryCache.delete(oldest);
  }
  financeQueryCache.set(cacheKey, {
    expiresAt: Date.now() + STOCK_CACHE_TTL_MS,
    data,
  });
  return data;
}

function mapErpAssetOperationalCategory(
  categoryName: string,
  coaName: string,
  assetName: string
): ErpMappedOperationalCategory {
  const hay = [categoryName, coaName, assetName].filter(Boolean).join(' ').toLowerCase();
  if (
    /(kendaraan|vehicle|mobil|motor|truk|truck|pickup|pick up|minibus|avanza|innova|l300|elf|grandmax|gran max|hiace|forklift|car\b)/.test(
      hay
    )
  ) {
    return 'Kendaraan';
  }
  if (
    /(bangunan|building|gedung|structure|tanah|land|gudang|warehouse|renovation|renovasi|right of use)/.test(
      hay
    )
  ) {
    return 'Bangunan';
  }
  if (
    /(office\s*equipment|komputer|computer|laptop|notebook|printer|server|ups|software|lisensi|license|cctv|network|elektronik|ac\s+|air\s*cond|proyektor|projector|\bit\b)/.test(
      hay
    )
  ) {
    return 'Elektronik & IT';
  }
  if (/(meja|desk|table)/.test(hay)) {
    return 'Meja';
  }
  if (/(kursi|chair|sofa)/.test(hay)) {
    return 'Kursi';
  }
  if (
    /(mesin|machine|machinery|dies|mold|mould|jig|fixture|tool|welding|press|cutting|cnc|compressor|kompresor|genset|crane|hoist|peralatan|equipment)/.test(
      hay
    )
  ) {
    return 'Mesin & Peralatan';
  }
  return 'Lainnya';
}

function normalizeUsefulLife(
  rawLife: unknown,
  acquisitionCost: number,
  residualValue: number,
  monthlyDep: number,
  depKe: number,
  startDate: string,
  retireDate: string
): {
  usefulLifeMonths: number;
  usefulLifeYears: number;
  usefulLifeUnit: 'years' | 'months';
  depreciatedMonths: number;
  remainingLifeMonths: number;
} {
  const raw = Number(rawLife || 0);
  const depreciatedMonths = Math.max(0, Math.round(Number(depKe || 0)));
  if (raw <= 0) {
    return {
      usefulLifeMonths: 0,
      usefulLifeYears: 0,
      usefulLifeUnit: 'months',
      depreciatedMonths,
      remainingLifeMonths: 0,
    };
  }
  let isYears = false;
  const depreciable = Math.max(0, Number(acquisitionCost || 0) - Number(residualValue || 0));
  let spanMonths = 0;
  if (startDate && retireDate && startDate.length >= 7 && retireDate.length >= 7) {
    const [sy, sm] = startDate.split('-').map(Number);
    const [ry, rm] = retireDate.split('-').map(Number);
    if (sy > 1900 && ry >= sy) {
      spanMonths = (ry - sy) * 12 + (rm - sm);
    }
  }
  if (spanMonths > 0) {
    isYears = Math.abs(spanMonths - raw * 12) < Math.abs(spanMonths - raw);
  } else if (monthlyDep > 0 && depreciable > 0) {
    const impliedMonths = depreciable / monthlyDep;
    isYears = Math.abs(impliedMonths - raw * 12) < Math.abs(impliedMonths - raw);
  } else if (depreciatedMonths > raw) {
    isYears = true;
  } else {
    isYears = raw <= 30;
  }
  const usefulLifeMonths = Math.round(isYears ? raw * 12 : raw);
  const usefulLifeYears = Number((usefulLifeMonths / 12).toFixed(1));
  const remainingLifeMonths = Math.max(0, usefulLifeMonths - depreciatedMonths);
  return {
    usefulLifeMonths,
    usefulLifeYears,
    usefulLifeUnit: isYears ? 'years' : 'months',
    depreciatedMonths,
    remainingLifeMonths,
  };
}

export async function queryErpAssetsData(params?: {
  search?: string;
  category?: string;
  includeDisposed?: boolean;
  limit?: number;
  bypassCache?: boolean;
}): Promise<ErpAssetsQueryResult> {
  const search = (params?.search || '').trim();
  const category = (params?.category || '').trim();
  const includeDisposed = Boolean(params?.includeDisposed);
  const limit = Math.max(1, Math.min(1000, Math.round(params?.limit || 500)));

  const baseCachePrefix = `${search.toLowerCase()}|${category.toLowerCase()}|${includeDisposed ? '1' : '0'}|`;
  const cacheKey = `${baseCachePrefix}${limit}`;
  if (!params?.bypassCache) {
    const now = Date.now();
    const cached = assetsQueryCache.get(cacheKey);
    if (cached && now < cached.expiresAt) {
      return cached.data;
    }
    // Reuse a fresh cached snapshot for the same filters that has >= requested limit (e.g. UI tab limit 500 -> AI limit 120)
    for (const [key, entry] of assetsQueryCache.entries()) {
      if (now >= entry.expiresAt) continue;
      if (!key.startsWith(baseCachePrefix)) continue;
      const cachedLimit = Number(key.slice(baseCachePrefix.length));
      if (Number.isFinite(cachedLimit) && cachedLimit >= limit) {
        return entry.data;
      }
    }
  }

  const bridgeCfg = getErpBridgeConfig();
  if (bridgeCfg.configured) {
    const qs = new URLSearchParams();
    if (search) qs.set('q', search);
    if (category) qs.set('category', category);
    if (includeDisposed) qs.set('includeDisposed', '1');
    qs.set('limit', String(limit));

    const data = await fetchErpBridgeJson<ErpAssetsQueryResult>(`/assets?${qs.toString()}`);
    if (assetsQueryCache.size > 20) {
      const oldest = assetsQueryCache.keys().next().value;
      if (oldest) assetsQueryCache.delete(oldest);
    }
    assetsQueryCache.set(cacheKey, {
      expiresAt: Date.now() + STOCK_CACHE_TTL_MS,
      data,
    });
    return data;
  }

  // Direct MySQL TCP mode for myerpplus m7_asset_v / m7_asset + m7_asset_depreciation
  const data = await withReadOnlyConnection(async (conn) => {
    const [tblRows] = await conn.query<RowDataPacket[]>(
      "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('m7_asset', 'm7_asset_v', 'm7_asset_category', 'm7_asset_depreciation', 'm7_depreciation_category')"
    );
    const tblSet = new Set(
      tblRows.map((r) => String(r.TABLE_NAME || r.table_name || '').toLowerCase())
    );
    if (!tblSet.has('m7_asset')) {
      throw new Error('Tabel m7_asset (Aset Tetap) tidak ditemukan di database MySQL ERP.');
    }

    const hasAssetView = tblSet.has('m7_asset_v');
    const hasAssetCategory = tblSet.has('m7_asset_category');
    const hasAssetDepreciation = tblSet.has('m7_asset_depreciation');
    const hasDepCat = tblSet.has('m7_depreciation_category');

    let rows: RowDataPacket[] = [];
    let usedAssetView = false;
    if (hasAssetView) {
      try {
        const [vRows] = await conn.query<RowDataPacket[]>(
          'SELECT * FROM m7_asset_v WHERE COALESCE(astatus, 0) NOT IN (6, 12) ORDER BY akategori ASC, akode ASC'
        );
        rows = vRows;
        usedAssetView = true;
      } catch {
        usedAssetView = false;
      }
    }
    if (!usedAssetView) {
      try {
        const [tRows] = await conn.query<RowDataPacket[]>(
          'SELECT * FROM m7_asset WHERE COALESCE(astatus, 0) NOT IN (6, 12) ORDER BY akategori ASC, akode ASC'
        );
        rows = tRows;
      } catch {
        const [rawRows] = await conn.query<RowDataPacket[]>('SELECT * FROM m7_asset');
        rows = rawRows.filter((r) => {
          const st = Number(r.astatus ?? 0);
          return st !== 6 && st !== 12;
        });
      }
    }

    const depMap = new Map<string, { depCount: number; maxDepNo: number; totalDepPosted: number }>();
    if (hasAssetDepreciation) {
      try {
        const [depColRows] = await conn.query<RowDataPacket[]>('SHOW COLUMNS FROM m7_asset_depreciation');
        const depCols = depColRows
          .map((c) => sanitizeIdentifier(String(c.Field || c.field || '')))
          .filter(Boolean);
        const assetIdCol = pickColumn(depCols, '', ['idaset', 'adidaset', 'id_aset', 'idasset', 'asset_id', 'aid', 'asetid']);
        const depNoCol = pickColumn(depCols, '', ['penyusutanke', 'adpenyusutanke', 'adke', 'bulanke', 'periodeke', 'ke']);
        const amountCol = pickColumn(depCols, '', ['nilaipenyusutan', 'adnilai', 'adbeban', 'beban', 'nilai', 'jumlah', 'nominal']);
        if (assetIdCol) {
          const maxNoExpr = depNoCol ? `MAX(\`${depNoCol}\`)` : 'COUNT(*)';
          const sumAmtExpr = amountCol ? `COALESCE(SUM(\`${amountCol}\`), 0)` : '0';
          const [depRows] = await conn.query<RowDataPacket[]>(
            `SELECT \`${assetIdCol}\` AS idaset, COUNT(*) AS depCount, ${maxNoExpr} AS maxDepNo, ${sumAmtExpr} AS totalDepPosted FROM m7_asset_depreciation GROUP BY \`${assetIdCol}\``
          );
          for (const d of depRows) {
            if (d.idaset !== null && d.idaset !== undefined) {
              depMap.set(String(d.idaset).trim(), {
                depCount: Number(d.depCount || 0),
                maxDepNo: Number(d.maxDepNo || 0),
                totalDepPosted: Number(d.totalDepPosted || 0),
              });
            }
          }
        }
      } catch {
        // Fallback safely to m7_asset built-in accumulated depreciation columns
      }
    }

    const catNameMap = new Map<string, string>();
    if (hasAssetCategory) {
      try {
        const [catRows] = await conn.query<RowDataPacket[]>('SELECT * FROM m7_asset_category');
        for (const c of catRows) {
          const nameVal = String(c.acnama ?? c.nama ?? c.name ?? c.akategorinama ?? '').trim();
          if (!nameVal) continue;
          for (const k of [c.ackode, c.kode, c.acid, c.id, c.code]) {
            if (k !== null && k !== undefined && String(k).trim() !== '') {
              catNameMap.set(String(k).trim().toLowerCase(), nameVal);
            }
          }
        }
      } catch {
        // Ignore category lookup failure
      }
    }

    const methodNameMap = new Map<string, string>();
    if (hasDepCat) {
      try {
        const [mRows] = await conn.query<RowDataPacket[]>('SELECT * FROM m7_depreciation_category');
        for (const m of mRows) {
          const nameVal = String(m.nama ?? m.dcnama ?? m.name ?? m.metode ?? '').trim();
          if (!nameVal) continue;
          for (const k of [m.kode, m.dckode, m.id, m.dcid, m.code]) {
            if (k !== null && k !== undefined && String(k).trim() !== '') {
              methodNameMap.set(String(k).trim().toLowerCase(), nameVal);
            }
          }
        }
      } catch {
        // Ignore depreciation method lookup failure
      }
    }

    const allItems: ErpAssetItem[] = rows.map((r) => {
      const depInfo = depMap.get(String(r.aid ?? '').trim()) || {
        depCount: 0,
        maxDepNo: 0,
        totalDepPosted: 0,
      };
      const qty = Number(r.ajml || 0) > 0 ? Number(r.ajml) : 1;
      const unitPrice = Number(r.aharga || 0);
      const acquisitionCost = Number(r.ahargabeli || 0) || unitPrice * qty;
      const residualValue = Number(r.anilairesidu || 0);
      const monthlyDepreciation = Number(r.abebanperbln || 0);
      const rawAccum = Number(r.aakumulasibeban || 0);
      const postedDep = Number(depInfo.totalDepPosted || 0);
      const accumulatedDepreciation = rawAccum > 0 ? rawAccum : postedDep;
      const isDisposed = Number(r.adispose || 0) === 1;
      const isClosed = Number(r.aisclose || 0) === 1;
      const rawBookValue = Number(r.anilaibuku ?? 0);
      const hasExplicitBook = rawAccum > 0 || rawBookValue > 0 || isClosed || isDisposed;
      const netBookValue = isDisposed
        ? 0
        : hasExplicitBook
          ? Math.max(0, rawBookValue)
          : Math.max(0, acquisitionCost - accumulatedDepreciation);

      const purchaseDate = formatDateIso(r.atglbeli);
      const useDate = formatDateIso(r.atglpakai) || purchaseDate;
      const retireDate = formatDateIso(r.atglpensiun);
      const depKe = Math.max(
        Number(r.apenyusutanke || 0),
        Number(depInfo.maxDepNo || 0),
        Number(depInfo.depCount || 0)
      );
      const life = normalizeUsefulLife(
        r.aumurekonomis,
        acquisitionCost,
        residualValue,
        monthlyDepreciation,
        depKe,
        useDate,
        retireDate
      );

      const categoryCode = String(r.akategori || '').trim();
      const mappedCatFromTable = categoryCode ? catNameMap.get(categoryCode.toLowerCase()) || '' : '';
      const categoryName = String(
        r.akategorinama || mappedCatFromTable || categoryCode || 'Lainnya'
      ).trim();
      const coaAssetName = String(r.arekassetnama || '').trim();
      const assetName = String(r.anama || '-').trim();
      const mappedCategory = mapErpAssetOperationalCategory(categoryName, coaAssetName, assetName);
      const isFullyDepreciated =
        !isDisposed &&
        life.usefulLifeMonths > 0 &&
        (life.remainingLifeMonths <= 0 || netBookValue <= residualValue + 1);
      const methodKey = String(r.ametode ?? '').trim();
      const methodFromTable = methodKey ? methodNameMap.get(methodKey.toLowerCase()) || '' : '';

      return {
        id: Number(r.aid || 0),
        assetCode: String(r.akode || '-').trim(),
        name: assetName,
        categoryCode,
        categoryName,
        mappedCategory,
        branch: String(r.acabangnama || r.acabang || '').trim(),
        location: String(r.alokasinama || r.alokasi || '').trim(),
        division: String(r.adivisinama || r.adivisi || '').trim(),
        subDivision: String(r.asubdivisinama || r.asubdivisi || '').trim(),
        costCenter: String(r.acostcenternama || r.acostcenter || '').trim(),
        serialOrPlate: String(r.anomor || '').trim(),
        notes: String(r.acatatan || '').trim(),
        purchaseDate,
        useDate,
        retireDate,
        quantity: qty,
        unit: String(r.asatuan || 'Unit').trim() || 'Unit',
        currency: String(r.amatauang || 'IDR').trim() || 'IDR',
        acquisitionCost,
        residualValue,
        monthlyDepreciation,
        accumulatedDepreciation,
        netBookValue,
        usefulLifeRaw: Number(r.aumurekonomis || 0),
        usefulLifeMonths: life.usefulLifeMonths,
        usefulLifeYears: life.usefulLifeYears,
        usefulLifeUnit: life.usefulLifeUnit,
        depreciatedMonths: life.depreciatedMonths,
        remainingLifeMonths: life.remainingLifeMonths,
        depreciationMethod: String(r.ametodenama || methodFromTable || '').trim() || 'Garis Lurus',
        coaAsset: String(r.arekasset || '').trim(),
        coaAssetName,
        coaAccumDep: String(r.arekakumdepresiasi || '').trim(),
        coaDepExpense: String(r.arekdepresiasi || '').trim(),
        isDisposed,
        isClosed,
        isFullyDepreciated,
        isIntangible: Number(r.aintangible || 0) === 1,
        statusCode: Number(r.astatus || 0),
        statusLabel: String(r.astatusnama || '').trim() || getM0StatusLabel(r.astatus),
      };
    });

    const activeItems = allItems.filter((it) => !it.isDisposed);
    const disposedCount = allItems.length - activeItems.length;
    const scopedItems = includeDisposed ? allItems : activeItems;

    const byCatMap = new Map<string, ErpAssetCategorySummary>();
    for (const it of activeItems) {
      const key = it.categoryName || 'Lainnya';
      const cur = byCatMap.get(key) || {
        categoryCode: it.categoryCode,
        categoryName: key,
        mappedCategory: it.mappedCategory,
        assetCount: 0,
        totalQty: 0,
        acquisitionCost: 0,
        accumulatedDepreciation: 0,
        netBookValue: 0,
        monthlyDepreciation: 0,
      };
      cur.assetCount += 1;
      cur.totalQty += it.quantity;
      cur.acquisitionCost += it.acquisitionCost;
      cur.accumulatedDepreciation += it.accumulatedDepreciation;
      cur.netBookValue += it.netBookValue;
      cur.monthlyDepreciation += it.monthlyDepreciation;
      byCatMap.set(key, cur);
    }
    const byCategory = Array.from(byCatMap.values()).sort(
      (a, b) => b.netBookValue - a.netBookValue
    );

    const qLower = search.toLowerCase();
    const catLower = category.toLowerCase();
    const filtered = scopedItems.filter((it) => {
      if (catLower && catLower !== 'all') {
        const catMatch =
          it.categoryName.toLowerCase() === catLower ||
          it.categoryCode.toLowerCase() === catLower ||
          it.mappedCategory.toLowerCase() === catLower;
        if (!catMatch) return false;
      }
      if (!qLower) return true;
      const hay = [
        it.assetCode,
        it.name,
        it.categoryName,
        it.mappedCategory,
        it.serialOrPlate,
        it.location,
        it.division,
        it.coaAsset,
        it.coaAssetName,
        it.notes,
      ]
        .join(' ')
        .toLowerCase();
      return qLower
        .split(/\s+/)
        .filter(Boolean)
        .every((tok) => hay.includes(tok));
    });

    const kpi: ErpAssetKpi = {
      totalAssets: activeItems.length,
      totalQty: activeItems.reduce((s, x) => s + x.quantity, 0),
      disposedCount,
      fullyDepreciatedCount: activeItems.filter((x) => x.isFullyDepreciated).length,
      expiringWithin12MonthsCount: activeItems.filter(
        (x) =>
          !x.isFullyDepreciated &&
          x.usefulLifeMonths > 0 &&
          x.remainingLifeMonths > 0 &&
          x.remainingLifeMonths <= 12
      ).length,
      vehicleCount: activeItems.filter((x) => x.mappedCategory === 'Kendaraan').length,
      totalAcquisitionCost: activeItems.reduce((s, x) => s + x.acquisitionCost, 0),
      totalAccumulatedDepreciation: activeItems.reduce((s, x) => s + x.accumulatedDepreciation, 0),
      totalNetBookValue: activeItems.reduce((s, x) => s + x.netBookValue, 0),
      totalMonthlyDepreciation: activeItems.reduce(
        (s, x) => s + (x.isFullyDepreciated ? 0 : x.monthlyDepreciation),
        0
      ),
    };

    return {
      sourceTable: usedAssetView
        ? 'm7_asset_v + m7_asset_depreciation'
        : 'm7_asset + m7_asset_depreciation',
      kpi,
      byCategory,
      items: filtered.slice(0, limit),
      totalMatched: filtered.length,
      fetchedAt: new Date().toISOString(),
    };
  });

  if (assetsQueryCache.size > 20) {
    const oldest = assetsQueryCache.keys().next().value;
    if (oldest) assetsQueryCache.delete(oldest);
  }
  assetsQueryCache.set(cacheKey, {
    expiresAt: Date.now() + STOCK_CACHE_TTL_MS,
    data,
  });
  return data;
}

async function getSafeTableColumns(conn: mysql.PoolConnection, tableName: string): Promise<string[]> {
  try {
    const [rows] = await conn.query<RowDataPacket[]>(`SHOW COLUMNS FROM \`${tableName}\``);
    return rows
      .map((r) => String(r.Field || r.field || '').trim())
      .filter((c) => SAFE_SQL_IDENTIFIER_REGEX.test(c));
  } catch {
    return [];
  }
}

export async function queryErpPurchasingData(params?: {
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  bypassCache?: boolean;
}): Promise<ErpPurchasingQueryResult> {
  const search = (params?.search || '').trim();
  const dateFrom = clampActiveDateFrom(params?.dateFrom);
  const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(params?.dateTo || '') ? params!.dateTo! : '';
  const limit = Math.max(1, Math.min(100, Math.round(params?.limit || 35)));

  const baseCachePrefix = `${search.toLowerCase()}|${dateFrom}|${dateTo}|`;
  const cacheKey = `${baseCachePrefix}${limit}`;
  if (!params?.bypassCache) {
    const now = Date.now();
    const cached = purchasingQueryCache.get(cacheKey);
    if (cached && now < cached.expiresAt) {
      return cached.data;
    }
    for (const [key, entry] of purchasingQueryCache.entries()) {
      if (now >= entry.expiresAt) continue;
      if (!key.startsWith(baseCachePrefix)) continue;
      const cachedLimit = Number(key.slice(baseCachePrefix.length));
      if (Number.isFinite(cachedLimit) && cachedLimit >= limit) {
        return entry.data;
      }
    }
  }

  const bridgeCfg = getErpBridgeConfig();
  if (bridgeCfg.configured) {
    const qs = new URLSearchParams();
    if (search) qs.set('q', search);
    if (dateFrom) qs.set('dateFrom', dateFrom);
    if (dateTo) qs.set('dateTo', dateTo);
    qs.set('limit', String(limit));

    const data = await fetchErpBridgeJson<ErpPurchasingQueryResult>(`/purchasing?${qs.toString()}`);

    // Compatibility safeguard for Bridge <= v10 whose /purchasing SQL counted Draft/Need Approve in poOutstandingCount:
    // Reconcile strictly to Approved (2) & In Progress (3) (excluding Draft, Need Approve, Revision, Approve 1-4).
    if (!data.poOutstandingStrict && data.kpi) {
      let reconciledPo = false;
      let reconciledPr = false;

      if (dateFrom === ACTIVE_ERP_CUTOFF_DATE && !dateTo && !search) {
        try {
          const pendingPayload = await fetchErpBridgeJson<{
            statusCounts?: {
              po?: { approved?: number; in_progress?: number };
              pr?: { approved?: number; in_progress?: number };
            };
            rules?: Array<{ ruleId?: string; count?: number }>;
          }>(`/pending-transactions?cutoffDate=${encodeURIComponent(ACTIVE_ERP_CUTOFF_DATE)}`);

          const poSc = pendingPayload?.statusCounts?.po;
          if (poSc && (typeof poSc.approved === 'number' || typeof poSc.in_progress === 'number')) {
            data.kpi.poOutstandingCount =
              Number(poSc.approved || 0) + Number(poSc.in_progress || 0);
            reconciledPo = true;
          }

          const prRule = pendingPayload?.rules?.find(
            (r) => r.ruleId === 'purchasing_pr_pending_po'
          );
          const prSc = pendingPayload?.statusCounts?.pr;
          if (typeof prRule?.count === 'number') {
            data.kpi.prOutstandingCount = Number(prRule.count || 0);
            reconciledPr = true;
          } else if (
            prSc &&
            (typeof prSc.approved === 'number' || typeof prSc.in_progress === 'number')
          ) {
            data.kpi.prOutstandingCount =
              Number(prSc.approved || 0) + Number(prSc.in_progress || 0);
            reconciledPr = true;
          }
        } catch {
          // Non-fatal fallback below
        }
      }

      if (!reconciledPo && Array.isArray(data.purchaseOrders) && data.purchaseOrders.length >= data.kpi.poCount) {
        data.kpi.poOutstandingCount = data.purchaseOrders.filter(
          (po) => !po.isClosed && (po.statusCode === 2 || po.statusCode === 3)
        ).length;
        reconciledPo = true;
      }

      if (!reconciledPr && Array.isArray(data.purchaseRequests) && data.purchaseRequests.length >= data.kpi.prCount) {
        data.kpi.prOutstandingCount = data.purchaseRequests.filter(
          (pr) => (pr.statusCode === 2 || pr.statusCode === 3) && (pr.statusPo === 0 || pr.statusCode === 3)
        ).length;
        reconciledPr = true;
      }

      if (reconciledPo && reconciledPr) {
        data.poOutstandingStrict = true;
      }
    }

    if (purchasingQueryCache.size > 30) {
      const oldest = purchasingQueryCache.keys().next().value;
      if (oldest) purchasingQueryCache.delete(oldest);
    }
    purchasingQueryCache.set(cacheKey, {
      expiresAt: Date.now() + STOCK_CACHE_TTL_MS,
      data,
    });
    return data;
  }

  // Direct MySQL TCP mode (identik 100% dengan Bridge v5: GL Laporan Keuangan + sub-ledger m4_*)
  const data = await withReadOnlyConnection(async (conn) => {
    const [tblRows] = await conn.query<RowDataPacket[]>('SHOW TABLES');
    const tblSet = new Set(
      tblRows.map((r) => String(Object.values(r)[0] ?? '').trim().toLowerCase()).filter(Boolean)
    );
    const hasFinance = tblSet.has('m1_coa') && tblSet.has('m2_transaction_journal');
    const hasContact = tblSet.has('m1_contact');
    const hasItem = tblSet.has('m1_item');
    const hasRi = tblSet.has('m4_ri');
    const hasRiDetail = tblSet.has('m4_ri_detail');
    const hasPo = tblSet.has('m4_po');
    const hasPoDetail = tblSet.has('m4_po_detail');
    const hasGrn = tblSet.has('m4_grn');
    const hasGrnDetail = tblSet.has('m4_grn_detail');
    const hasPr = tblSet.has('m4_pr');
    const hasPrDetail = tblSet.has('m4_pr_detail');
    const hasPrt = tblSet.has('m4_prt');
    const hasVp = tblSet.has('m4_vp');
    const hasVpDetail = tblSet.has('m4_vp_detail');

    const dateToClauseJ = dateTo ? ' AND j.ttgl <= ?' : '';
    const dateToBind: unknown[] = dateTo ? [dateTo] : [];

    const glMonthlyMap = new Map<string, ErpPurchasingMonthlyRow>();
    let glPurchasingAccounts: ErpPurchasingGlAccountRow[] = [];
    let glTotalDomestic = 0;
    let glTotalImport = 0;
    let glTotalReturn = 0;
    let glTotalDiscount = 0;
    let glTotalOtherCogsCost = 0;
    let apJournalTotal = 0;
    let apJournalCarryOver = 0;
    let apJournalPeriod = 0;
    let topApContactsGl: ErpFinanceContactBalanceRow[] = [];

    if (hasFinance) {
      try {
        const [glMonRows] = await conn.query<RowDataPacket[]>(
          `SELECT
            DATE_FORMAT(j.ttgl, '%Y-%m') AS month,
            COALESCE(SUM(CASE WHEN c.cnomor LIKE '520105%' THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS glDomestic,
            COALESCE(SUM(CASE WHEN c.cnomor LIKE '520104%' THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS glImport,
            COALESCE(SUM(CASE WHEN c.cnomor LIKE '510103%' THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS glReturn,
            COALESCE(SUM(CASE WHEN c.cnomor LIKE '510102%' THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS glDiscount,
            COALESCE(SUM(CASE WHEN c.cnomor LIKE '520103%' OR c.cnomor LIKE '520106%' OR c.cnomor LIKE '520107%' OR c.cnomor LIKE '520108%' OR c.cnomor LIKE '520109%' THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS glOtherCogsCost
          FROM m2_transaction_journal j
          INNER JOIN m1_coa c ON c.cnomor = j.tnorek
          WHERE COALESCE(j.tstatus, 0) NOT IN (6, 12)
            AND COALESCE(j.tposting, 1) = 1
            AND c.cgd = 'D'
            AND (c.cnomor LIKE '51%' OR c.cnomor LIKE '52%')
            AND j.ttgl >= ?${dateToClauseJ}
          GROUP BY DATE_FORMAT(j.ttgl, '%Y-%m')
          ORDER BY month ASC`,
          [dateFrom, ...dateToBind]
        );

        for (const r of glMonRows) {
          const m = String(r.month || '');
          if (!m) continue;
          const glDomestic = Number(r.glDomestic || 0);
          const glImport = Number(r.glImport || 0);
          const glReturn = Number(r.glReturn || 0);
          const glDiscount = Number(r.glDiscount || 0);
          const glOtherCogsCost = Number(r.glOtherCogsCost || 0);
          glTotalDomestic += glDomestic;
          glTotalImport += glImport;
          glTotalReturn += glReturn;
          glTotalDiscount += glDiscount;
          glTotalOtherCogsCost += glOtherCogsCost;
          const glNetPurchase = glDomestic + glImport + glReturn + glDiscount;
          glMonthlyMap.set(m, {
            month: m,
            glDomestic,
            glImport,
            glReturn,
            glDiscount,
            glNetPurchase,
            glOtherCogsCost,
            riInvoiceCount: 0,
            riDomesticDpp: 0,
            riImportDpp: 0,
            riDppIdr: 0,
            riTaxIdr: 0,
            riTotalIdr: 0,
            varianceVsRiDpp: glNetPurchase,
          });
        }

        const [accRows] = await conn.query<RowDataPacket[]>(
          `SELECT c.cnomor AS accountNo, c.cnama AS accountName, COUNT(*) AS entryCount,
            COALESCE(SUM(j.tdebit - j.tkredit), 0) AS amount
          FROM m2_transaction_journal j
          INNER JOIN m1_coa c ON c.cnomor = j.tnorek
          WHERE COALESCE(j.tstatus, 0) NOT IN (6, 12)
            AND COALESCE(j.tposting, 1) = 1
            AND c.cgd = 'D'
            AND (c.cnomor LIKE '510102%' OR c.cnomor LIKE '510103%' OR c.cnomor LIKE '520103%' OR c.cnomor LIKE '520104%' OR c.cnomor LIKE '520105%' OR c.cnomor LIKE '520106%' OR c.cnomor LIKE '520107%' OR c.cnomor LIKE '520108%' OR c.cnomor LIKE '520109%')
            AND j.ttgl >= ?${dateToClauseJ}
          GROUP BY c.cnomor, c.cnama
          ORDER BY c.cnomor ASC`,
          [dateFrom, ...dateToBind]
        );
        glPurchasingAccounts = accRows.map((r) => {
          const accNo = String(r.accountNo || '');
          return {
            accountNo: accNo,
            accountName: String(r.accountName || ''),
            entryCount: Number(r.entryCount || 0),
            amount: Number(r.amount || 0),
            isCorePurchase:
              accNo.startsWith('520105') ||
              accNo.startsWith('520104') ||
              accNo.startsWith('510103') ||
              accNo.startsWith('510102'),
          };
        });

        const [apGlRows] = await conn.query<RowDataPacket[]>(
          `SELECT
            COALESCE(SUM(CASE WHEN j.ttgl < ? THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS carryOver,
            COALESCE(SUM(CASE WHEN j.ttgl >= ? THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS periodBal,
            COALESCE(SUM(j.tkredit - j.tdebit), 0) AS totalBal
          FROM m2_transaction_journal j
          INNER JOIN m1_coa c ON c.cnomor = j.tnorek
          WHERE COALESCE(j.tstatus, 0) NOT IN (6, 12)
            AND COALESCE(j.tposting, 1) = 1
            AND c.cgd = 'D'
            AND (c.ctipe = 7 OR c.cnomor LIKE '210101%' OR c.cnomor LIKE '210103%')${dateToClauseJ}`,
          [ACTIVE_ERP_CUTOFF_DATE, ACTIVE_ERP_CUTOFF_DATE, ...dateToBind]
        );
        apJournalCarryOver = Number(apGlRows[0]?.carryOver || 0);
        apJournalPeriod = Number(apGlRows[0]?.periodBal || 0);
        apJournalTotal = Number(apGlRows[0]?.totalBal || 0);

        const cJoinJ = hasContact ? 'LEFT JOIN m1_contact ct ON ct.kid = j.tkontak' : '';
        const cNameJ = hasContact
          ? "COALESCE(NULLIF(TRIM(ct.knama), ''), CASE WHEN COALESCE(j.tkontak, 0) > 0 THEN CONCAT('Supplier #', j.tkontak) ELSE 'Tanpa Sub-Ledger Kontak' END)"
          : "CASE WHEN COALESCE(j.tkontak, 0) > 0 THEN CONCAT('Supplier #', j.tkontak) ELSE 'Tanpa Sub-Ledger Kontak' END";
        const cCodeJ = hasContact
          ? "COALESCE(NULLIF(TRIM(ct.kkode), ''), CAST(COALESCE(j.tkontak, 0) AS CHAR))"
          : 'CAST(COALESCE(j.tkontak, 0) AS CHAR)';

        const [apTopRows] = await conn.query<RowDataPacket[]>(
          `SELECT COALESCE(j.tkontak, 0) AS contactId, ${cCodeJ} AS contactCode, ${cNameJ} AS contactName,
            COALESCE(SUM(CASE WHEN j.ttgl < ? THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS carryOverBalance,
            COALESCE(SUM(CASE WHEN j.ttgl >= ? THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS periodBalance,
            COALESCE(SUM(j.tkredit - j.tdebit), 0) AS totalBalance
          FROM m2_transaction_journal j
          INNER JOIN m1_coa c ON c.cnomor = j.tnorek
          ${cJoinJ}
          WHERE COALESCE(j.tstatus, 0) NOT IN (6, 12)
            AND COALESCE(j.tposting, 1) = 1
            AND c.cgd = 'D'
            AND (c.ctipe = 7 OR c.cnomor LIKE '210101%' OR c.cnomor LIKE '210103%')${dateToClauseJ}
          GROUP BY COALESCE(j.tkontak, 0), contactCode, contactName
          HAVING ABS(totalBalance) >= 1
          ORDER BY totalBalance DESC
          LIMIT 20`,
          [ACTIVE_ERP_CUTOFF_DATE, ACTIVE_ERP_CUTOFF_DATE, ...dateToBind]
        );
        topApContactsGl = apTopRows.map((r) => ({
          contactId: Number(r.contactId || 0),
          contactCode: String(r.contactCode || '-'),
          contactName: String(r.contactName || '-'),
          carryOverBalance: Number(r.carryOverBalance || 0),
          periodBalance: Number(r.periodBalance || 0),
          totalBalance: Number(r.totalBalance || 0),
        }));
      } catch {
        // Keep partial data safe
      }
    }

    const contactJoinRi = hasContact ? 'LEFT JOIN m1_contact c ON c.kid = ri.risupplier' : '';
    const supNameRi = hasContact
      ? "COALESCE(NULLIF(TRIM(c.knama), ''), CONCAT('Supplier #', ri.risupplier))"
      : "CONCAT('Supplier #', ri.risupplier)";
    const supCodeRi = hasContact
      ? "COALESCE(NULLIF(TRIM(c.kkode), ''), CAST(ri.risupplier AS CHAR))"
      : 'CAST(ri.risupplier AS CHAR)';

    const kursExprRi = 'COALESCE(NULLIF(ri.rikurs, 0), 1)';
    const dppExprRi = `(CASE WHEN COALESCE(ri.rihargatermasukpajak, 0) = 1 THEN (COALESCE(ri.ritotaltransaksi, 0) - COALESCE(ri.ritotalpajak1detail, 0) - COALESCE(ri.ritotalpajak2detail, 0)) ELSE (COALESCE(ri.ritotal, 0) - COALESCE(ri.rijmldiskon, 0)) END) * ${kursExprRi}`;
    const taxExprRi = `(COALESCE(ri.ritotalpajak1detail, 0) + COALESCE(ri.ritotalpajak2detail, 0)) * ${kursExprRi}`;
    const totalIdrExprRi = `COALESCE(ri.ritotaltransaksi, 0) * ${kursExprRi}`;
    const paidIdrExprRi = `(COALESCE(ri.rijmlbayar, 0) + COALESCE(ri.rijmluangmuka, 0)) * ${kursExprRi}`;
    const balIdrExprRi = `GREATEST(0, COALESCE(ri.ritotaltransaksi, 0) - COALESCE(ri.rijmlbayar, 0) - COALESCE(ri.rijmluangmuka, 0)) * ${kursExprRi}`;
    const isImportExprRi =
      "(COALESCE(ri.riasalbarangkategori, 0) = 1 OR LOWER(COALESCE(ri.riasalbarang, '')) LIKE '%impor%' OR (UPPER(COALESCE(NULLIF(TRIM(ri.rimatauang), ''), 'IDR')) <> 'IDR' AND COALESCE(ri.rikurs, 1) > 1))";

    let riAgg = {
      invoiceCount: 0,
      domesticCount: 0,
      importCount: 0,
      dppIdr: 0,
      taxIdr: 0,
      totalIdr: 0,
      paidIdr: 0,
    };
    let apSubAgg = {
      totalPayableIdr: 0,
      unpaidInvoiceCount: 0,
      carryOverPayableIdr: 0,
      carryOverUnpaidCount: 0,
      overdueInvoiceCount: 0,
      overdueAmountIdr: 0,
    };
    let apAging: ErpFinanceArAging = {
      current: { count: 0, amount: 0 },
      days1to30: { count: 0, amount: 0 },
      days31to60: { count: 0, amount: 0 },
      days61to90: { count: 0, amount: 0 },
      over90: { count: 0, amount: 0 },
      totalCount: 0,
      totalAmount: 0,
      carryOverCount: 0,
      carryOverAmount: 0,
    };
    let topSuppliers: ErpPurchasingTopSupplier[] = [];
    let topItems: ErpPurchasingTopItem[] = [];
    let invoices: ErpPurchasingInvoiceRow[] = [];
    let unpaidInvoices: ErpPurchasingInvoiceRow[] = [];

    if (hasRi) {
      const riWhere: string[] = ['COALESCE(ri.ristatus, 0) NOT IN (6, 12)', 'ri.ritgl >= ?'];
      const riBinds: unknown[] = [dateFrom];
      if (dateTo) {
        riWhere.push('ri.ritgl <= ?');
        riBinds.push(dateTo);
      }
      if (search) {
        if (hasContact) {
          riWhere.push(
            "(ri.rinotransaksi LIKE ? OR COALESCE(c.knama, '') LIKE ? OR COALESCE(ri.rinoref, '') LIKE ? OR COALESCE(ri.rigudang, '') LIKE ?)"
          );
          riBinds.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
        } else {
          riWhere.push(
            "(ri.rinotransaksi LIKE ? OR COALESCE(ri.rinoref, '') LIKE ? OR COALESCE(ri.rigudang, '') LIKE ?)"
          );
          riBinds.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
      }
      const riWhereSql = `WHERE ${riWhere.join(' AND ')}`;

      const apWhere: string[] = [
        'COALESCE(ri.ristatus, 0) NOT IN (6, 12)',
        'COALESCE(ri.ristatuslunas, 0) = 0',
        'GREATEST(0, COALESCE(ri.ritotaltransaksi, 0) - COALESCE(ri.rijmlbayar, 0) - COALESCE(ri.rijmluangmuka, 0)) > 0',
      ];
      const apBinds: unknown[] = [];
      if (dateTo) {
        apWhere.push('ri.ritgl <= ?');
        apBinds.push(dateTo);
      }
      if (search) {
        if (hasContact) {
          apWhere.push(
            "(ri.rinotransaksi LIKE ? OR COALESCE(c.knama, '') LIKE ? OR COALESCE(ri.rinoref, '') LIKE ?)"
          );
          apBinds.push(`%${search}%`, `%${search}%`, `%${search}%`);
        } else {
          apWhere.push("(ri.rinotransaksi LIKE ? OR COALESCE(ri.rinoref, '') LIKE ?)");
          apBinds.push(`%${search}%`, `%${search}%`);
        }
      }
      const apWhereSql = `WHERE ${apWhere.join(' AND ')}`;

      try {
        const [kRows] = await conn.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS invoiceCount,
            SUM(CASE WHEN ${isImportExprRi} THEN 0 ELSE 1 END) AS domesticCount,
            SUM(CASE WHEN ${isImportExprRi} THEN 1 ELSE 0 END) AS importCount,
            COALESCE(SUM(${dppExprRi}), 0) AS dppIdr,
            COALESCE(SUM(${taxExprRi}), 0) AS taxIdr,
            COALESCE(SUM(${totalIdrExprRi}), 0) AS totalIdr,
            COALESCE(SUM(${paidIdrExprRi}), 0) AS paidIdr
          FROM m4_ri ri ${contactJoinRi} ${riWhereSql}`,
          riBinds
        );
        riAgg = {
          invoiceCount: Number(kRows[0]?.invoiceCount || 0),
          domesticCount: Number(kRows[0]?.domesticCount || 0),
          importCount: Number(kRows[0]?.importCount || 0),
          dppIdr: Number(kRows[0]?.dppIdr || 0),
          taxIdr: Number(kRows[0]?.taxIdr || 0),
          totalIdr: Number(kRows[0]?.totalIdr || 0),
          paidIdr: Number(kRows[0]?.paidIdr || 0),
        };

        const [riMonRows] = await conn.query<RowDataPacket[]>(
          `SELECT DATE_FORMAT(ri.ritgl, '%Y-%m') AS month, COUNT(*) AS invoiceCount,
            COALESCE(SUM(CASE WHEN ${isImportExprRi} THEN 0 ELSE ${dppExprRi} END), 0) AS riDomesticDpp,
            COALESCE(SUM(CASE WHEN ${isImportExprRi} THEN ${dppExprRi} ELSE 0 END), 0) AS riImportDpp,
            COALESCE(SUM(${dppExprRi}), 0) AS riDppIdr,
            COALESCE(SUM(${taxExprRi}), 0) AS riTaxIdr,
            COALESCE(SUM(${totalIdrExprRi}), 0) AS riTotalIdr
          FROM m4_ri ri ${contactJoinRi} ${riWhereSql} AND ri.ritgl IS NOT NULL
          GROUP BY DATE_FORMAT(ri.ritgl, '%Y-%m')
          ORDER BY month ASC`,
          riBinds
        );
        for (const r of riMonRows) {
          const m = String(r.month || '');
          if (!m) continue;
          const existing = glMonthlyMap.get(m) || {
            month: m,
            glDomestic: 0,
            glImport: 0,
            glReturn: 0,
            glDiscount: 0,
            glNetPurchase: 0,
            glOtherCogsCost: 0,
            riInvoiceCount: 0,
            riDomesticDpp: 0,
            riImportDpp: 0,
            riDppIdr: 0,
            riTaxIdr: 0,
            riTotalIdr: 0,
            varianceVsRiDpp: 0,
          };
          existing.riInvoiceCount = Number(r.invoiceCount || 0);
          existing.riDomesticDpp = Number(r.riDomesticDpp || 0);
          existing.riImportDpp = Number(r.riImportDpp || 0);
          existing.riDppIdr = Number(r.riDppIdr || 0);
          existing.riTaxIdr = Number(r.riTaxIdr || 0);
          existing.riTotalIdr = Number(r.riTotalIdr || 0);
          existing.varianceVsRiDpp = existing.glNetPurchase - existing.riDppIdr;
          glMonthlyMap.set(m, existing);
        }

        const [apRows] = await conn.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS unpaidInvoiceCount, COALESCE(SUM(${balIdrExprRi}), 0) AS totalPayableIdr,
            SUM(CASE WHEN ri.ritgl < ? THEN 1 ELSE 0 END) AS carryOverUnpaidCount,
            COALESCE(SUM(CASE WHEN ri.ritgl < ? THEN ${balIdrExprRi} ELSE 0 END), 0) AS carryOverPayableIdr,
            SUM(CASE WHEN ri.ritgljatuhtempo IS NOT NULL AND ri.ritgljatuhtempo < CURDATE() THEN 1 ELSE 0 END) AS overdueInvoiceCount,
            COALESCE(SUM(CASE WHEN ri.ritgljatuhtempo IS NOT NULL AND ri.ritgljatuhtempo < CURDATE() THEN ${balIdrExprRi} ELSE 0 END), 0) AS overdueAmountIdr,
            SUM(CASE WHEN ri.ritgljatuhtempo IS NULL OR DATEDIFF(CURDATE(), ri.ritgljatuhtempo) <= 0 THEN 1 ELSE 0 END) AS curCnt,
            COALESCE(SUM(CASE WHEN ri.ritgljatuhtempo IS NULL OR DATEDIFF(CURDATE(), ri.ritgljatuhtempo) <= 0 THEN ${balIdrExprRi} ELSE 0 END), 0) AS curAmt,
            SUM(CASE WHEN DATEDIFF(CURDATE(), ri.ritgljatuhtempo) BETWEEN 1 AND 30 THEN 1 ELSE 0 END) AS d30Cnt,
            COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ri.ritgljatuhtempo) BETWEEN 1 AND 30 THEN ${balIdrExprRi} ELSE 0 END), 0) AS d30Amt,
            SUM(CASE WHEN DATEDIFF(CURDATE(), ri.ritgljatuhtempo) BETWEEN 31 AND 60 THEN 1 ELSE 0 END) AS d60Cnt,
            COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ri.ritgljatuhtempo) BETWEEN 31 AND 60 THEN ${balIdrExprRi} ELSE 0 END), 0) AS d60Amt,
            SUM(CASE WHEN DATEDIFF(CURDATE(), ri.ritgljatuhtempo) BETWEEN 61 AND 90 THEN 1 ELSE 0 END) AS d90Cnt,
            COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ri.ritgljatuhtempo) BETWEEN 61 AND 90 THEN ${balIdrExprRi} ELSE 0 END), 0) AS d90Amt,
            SUM(CASE WHEN DATEDIFF(CURDATE(), ri.ritgljatuhtempo) > 90 THEN 1 ELSE 0 END) AS over90Cnt,
            COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ri.ritgljatuhtempo) > 90 THEN ${balIdrExprRi} ELSE 0 END), 0) AS over90Amt
          FROM m4_ri ri ${contactJoinRi} ${apWhereSql}`,
          [ACTIVE_ERP_CUTOFF_DATE, ACTIVE_ERP_CUTOFF_DATE, ...apBinds]
        );
        const a = apRows[0] || {};
        apSubAgg = {
          totalPayableIdr: Number(a.totalPayableIdr || 0),
          unpaidInvoiceCount: Number(a.unpaidInvoiceCount || 0),
          carryOverPayableIdr: Number(a.carryOverPayableIdr || 0),
          carryOverUnpaidCount: Number(a.carryOverUnpaidCount || 0),
          overdueInvoiceCount: Number(a.overdueInvoiceCount || 0),
          overdueAmountIdr: Number(a.overdueAmountIdr || 0),
        };
        apAging = {
          current: { count: Number(a.curCnt || 0), amount: Number(a.curAmt || 0) },
          days1to30: { count: Number(a.d30Cnt || 0), amount: Number(a.d30Amt || 0) },
          days31to60: { count: Number(a.d60Cnt || 0), amount: Number(a.d60Amt || 0) },
          days61to90: { count: Number(a.d90Cnt || 0), amount: Number(a.d90Amt || 0) },
          over90: { count: Number(a.over90Cnt || 0), amount: Number(a.over90Amt || 0) },
          totalCount: Number(a.unpaidInvoiceCount || 0),
          totalAmount: Number(a.totalPayableIdr || 0),
          carryOverCount: Number(a.carryOverUnpaidCount || 0),
          carryOverAmount: Number(a.carryOverPayableIdr || 0),
        };

        const [supRows] = await conn.query<RowDataPacket[]>(
          `SELECT ri.risupplier AS supplierId, ${supCodeRi} AS supplierCode, ${supNameRi} AS supplierName,
            COUNT(*) AS invoiceCount,
            SUM(CASE WHEN ${isImportExprRi} THEN 1 ELSE 0 END) AS importInvoiceCount,
            COALESCE(SUM(${dppExprRi}), 0) AS totalDppIdr,
            COALESCE(SUM(${totalIdrExprRi}), 0) AS totalIdr,
            COALESCE(SUM(CASE WHEN COALESCE(ri.ristatuslunas, 0) = 0 THEN ${balIdrExprRi} ELSE 0 END), 0) AS totalPayableIdr
          FROM m4_ri ri ${contactJoinRi} ${riWhereSql}
          GROUP BY ri.risupplier, supplierCode, supplierName
          ORDER BY totalDppIdr DESC
          LIMIT 20`,
          riBinds
        );
        topSuppliers = supRows.map((r) => {
          const impCnt = Number(r.importInvoiceCount || 0);
          const invCnt = Number(r.invoiceCount || 0);
          const originType: ErpPurchasingTopSupplier['originType'] =
            impCnt > 0 && impCnt === invCnt
              ? 'Import'
              : impCnt > 0
                ? 'Domestic & Import'
                : 'Domestic';
          return {
            supplierId: Number(r.supplierId || 0),
            supplierCode: String(r.supplierCode || '-'),
            supplierName: String(r.supplierName || '-'),
            invoiceCount: invCnt,
            originType,
            totalDppIdr: Number(r.totalDppIdr || 0),
            totalIdr: Number(r.totalIdr || 0),
            totalPayableIdr: Number(r.totalPayableIdr || 0),
          };
        });

        const mapRiInv = (r: RowDataPacket): ErpPurchasingInvoiceRow => {
          const dt = formatDateIso(r.date);
          return {
            id: Number(r.id || 0),
            docNo: String(r.docNo || '-'),
            refNo: String(r.refNo || '').trim(),
            date: dt,
            dueDate: formatDateIso(r.dueDate),
            supplierName: String(r.supplierName || '-'),
            originType: Number(r.isImport || 0) === 1 ? 'Import' : 'Domestic',
            warehouse: String(r.warehouse || '-'),
            currency: String(r.currency || 'IDR').toUpperCase(),
            kurs: Number(r.kurs || 1),
            dppIdr: Number(r.dppIdr || 0),
            taxIdr: Number(r.taxIdr || 0),
            totalOrig: Number(r.totalOrig || 0),
            totalIdr: Number(r.totalIdr || 0),
            paidIdr: Number(r.paidIdr || 0),
            balanceIdr: Number(r.balanceIdr || 0),
            isPaid: Boolean(Number(r.isPaid)),
            isOverdue: Boolean(Number(r.isOverdue)),
            isCarryOver: Boolean(dt && dt < ACTIVE_ERP_CUTOFF_DATE),
            statusCode: Number(r.statusCode || 0),
            statusLabel: getM0StatusLabel(r.statusCode),
          };
        };

        const [invRows] = await conn.query<RowDataPacket[]>(
          `SELECT ri.riid AS id, ri.rinotransaksi AS docNo, ri.rinoref AS refNo, ri.ritgl AS date, ri.ritgljatuhtempo AS dueDate,
            ${supNameRi} AS supplierName, CASE WHEN ${isImportExprRi} THEN 1 ELSE 0 END AS isImport,
            COALESCE(NULLIF(TRIM(ri.rigudang), ''), '-') AS warehouse, COALESCE(NULLIF(TRIM(ri.rimatauang), ''), 'IDR') AS currency,
            ${kursExprRi} AS kurs, ${dppExprRi} AS dppIdr, ${taxExprRi} AS taxIdr,
            COALESCE(ri.ritotaltransaksi, 0) AS totalOrig, ${totalIdrExprRi} AS totalIdr, ${paidIdrExprRi} AS paidIdr,
            CASE WHEN COALESCE(ri.ristatuslunas, 0) = 1 THEN 0 ELSE ${balIdrExprRi} END AS balanceIdr,
            COALESCE(ri.ristatuslunas, 0) AS isPaid,
            CASE WHEN COALESCE(ri.ristatuslunas, 0) = 0 AND ri.ritgljatuhtempo IS NOT NULL AND ri.ritgljatuhtempo < CURDATE() THEN 1 ELSE 0 END AS isOverdue,
            COALESCE(ri.ristatus, 0) AS statusCode
          FROM m4_ri ri ${contactJoinRi} ${riWhereSql}
          ORDER BY ri.ritgl DESC, ri.riid DESC LIMIT ?`,
          [...riBinds, limit]
        );
        invoices = invRows.map(mapRiInv);

        const [unpaidRows] = await conn.query<RowDataPacket[]>(
          `SELECT ri.riid AS id, ri.rinotransaksi AS docNo, ri.rinoref AS refNo, ri.ritgl AS date, ri.ritgljatuhtempo AS dueDate,
            ${supNameRi} AS supplierName, CASE WHEN ${isImportExprRi} THEN 1 ELSE 0 END AS isImport,
            COALESCE(NULLIF(TRIM(ri.rigudang), ''), '-') AS warehouse, COALESCE(NULLIF(TRIM(ri.rimatauang), ''), 'IDR') AS currency,
            ${kursExprRi} AS kurs, ${dppExprRi} AS dppIdr, ${taxExprRi} AS taxIdr,
            COALESCE(ri.ritotaltransaksi, 0) AS totalOrig, ${totalIdrExprRi} AS totalIdr, ${paidIdrExprRi} AS paidIdr,
            ${balIdrExprRi} AS balanceIdr, 0 AS isPaid,
            CASE WHEN ri.ritgljatuhtempo IS NOT NULL AND ri.ritgljatuhtempo < CURDATE() THEN 1 ELSE 0 END AS isOverdue,
            COALESCE(ri.ristatus, 0) AS statusCode
          FROM m4_ri ri ${contactJoinRi} ${apWhereSql}
          ORDER BY ri.ritgljatuhtempo ASC, ri.ritgl ASC LIMIT ?`,
          [...apBinds, limit]
        );
        unpaidInvoices = unpaidRows.map(mapRiInv);
      } catch {
        // Keep safe
      }

      if (hasRiDetail) {
        try {
          const dCols = await getSafeTableColumns(conn, 'm4_ri_detail');
          const fkCol = pickColumn(dCols, '', ['idri', 'riid', 'id_ri']);
          const itemCol = pickColumn(dCols, '', ['idbarang', 'barangid', 'id_barang']);
          const nameCol = pickColumn(dCols, '', ['namabarang', 'nama_barang', 'deskripsi']);
          const qtyCol = pickColumn(dCols, '', ['jml', 'qty', 'jumlah']);
          const unitCol = pickColumn(dCols, '', ['satuan', 'satuanbarang', 'uom']);
          const priceCol = pickColumn(dCols, '', ['harga', 'price']);
          const discCol = pickColumn(dCols, '', ['jmldiskon', 'diskon_jml']);
          if (fkCol && itemCol && qtyCol && priceCol) {
            const itemCodeExpr = hasItem
              ? `COALESCE(NULLIF(TRIM(i.bkode), ''), CAST(d.\`${itemCol}\` AS CHAR))`
              : `CAST(d.\`${itemCol}\` AS CHAR)`;
            const itemNameExpr = nameCol
              ? hasItem
                ? `COALESCE(NULLIF(TRIM(d.\`${nameCol}\`), ''), NULLIF(TRIM(i.bnama), ''), CONCAT('Barang #', d.\`${itemCol}\`))`
                : `COALESCE(NULLIF(TRIM(d.\`${nameCol}\`), ''), CONCAT('Barang #', d.\`${itemCol}\`))`
              : hasItem
                ? `COALESCE(NULLIF(TRIM(i.bnama), ''), CONCAT('Barang #', d.\`${itemCol}\`))`
                : `CONCAT('Barang #', d.\`${itemCol}\`)`;
            const unitExpr = unitCol ? `COALESCE(NULLIF(TRIM(MAX(d.\`${unitCol}\`)), ''), 'Pcs')` : `'Pcs'`;
            const discExpr = discCol ? `COALESCE(d.\`${discCol}\`, 0)` : '0';
            const [itRows] = await conn.query<RowDataPacket[]>(
              `SELECT d.\`${itemCol}\` AS itemId, ${itemCodeExpr} AS itemCode, ${itemNameExpr} AS itemName,
                COALESCE(SUM(d.\`${qtyCol}\`), 0) AS totalQty, ${unitExpr} AS unit,
                COALESCE(SUM(((COALESCE(d.\`${qtyCol}\`, 0) * COALESCE(d.\`${priceCol}\`, 0)) - ${discExpr}) * ${kursExprRi}), 0) AS totalValueIdr,
                COUNT(DISTINCT d.\`${fkCol}\`) AS invoiceCount
              FROM m4_ri_detail d
              INNER JOIN m4_ri ri ON ri.riid = d.\`${fkCol}\`
              ${contactJoinRi}
              ${hasItem ? `LEFT JOIN m1_item i ON i.bid = d.\`${itemCol}\`` : ''}
              ${riWhereSql}
              GROUP BY d.\`${itemCol}\`, itemCode, itemName
              ORDER BY totalValueIdr DESC
              LIMIT 20`,
              riBinds
            );
            topItems = itRows.map((r) => ({
              itemId: Number(r.itemId || 0),
              itemCode: String(r.itemCode || '-'),
              itemName: String(r.itemName || '-'),
              totalQty: Number(r.totalQty || 0),
              unit: String(r.unit || 'Pcs'),
              totalValueIdr: Number(r.totalValueIdr || 0),
              invoiceCount: Number(r.invoiceCount || 0),
            }));
          }
        } catch {
          // Optional detail table
        }
      }
    }

    let poAgg = { poCount: 0, poTotalIdr: 0, poOutstandingCount: 0 };
    let purchaseOrders: ErpPurchasingOrderRow[] = [];
    if (hasPo) {
      try {
        const poWhere: string[] = ['COALESCE(po.postatus, 0) NOT IN (6, 12)', 'po.potgl >= ?'];
        const poBinds: unknown[] = [dateFrom];
        if (dateTo) {
          poWhere.push('po.potgl <= ?');
          poBinds.push(dateTo);
        }
        if (search) {
          poWhere.push(
            hasContact
              ? "(po.ponotransaksi LIKE ? OR COALESCE(c.knama, '') LIKE ?)"
              : 'po.ponotransaksi LIKE ?'
          );
          poBinds.push(`%${search}%`);
          if (hasContact) poBinds.push(`%${search}%`);
        }
        const poWhereSql = `WHERE ${poWhere.join(' AND ')}`;
        const poJoin = hasContact ? 'LEFT JOIN m1_contact c ON c.kid = po.posupplier' : '';
        const poSup = hasContact
          ? "COALESCE(NULLIF(TRIM(c.knama), ''), CONCAT('Supplier #', po.posupplier))"
          : "CONCAT('Supplier #', po.posupplier)";
        const poKurs = 'COALESCE(NULLIF(po.pokurs, 0), 1)';
        const poImp =
          "(COALESCE(po.poasalbarangkategori, 0) = 1 OR LOWER(COALESCE(po.poasalbarang, '')) LIKE '%impor%' OR (UPPER(COALESCE(NULLIF(TRIM(po.pomatauang), ''), 'IDR')) <> 'IDR' AND COALESCE(po.pokurs, 1) > 1))";

        const [aRows] = await conn.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS poCount, COALESCE(SUM(COALESCE(po.pototaltransaksi, 0) * ${poKurs}), 0) AS poTotalIdr,
            SUM(CASE WHEN COALESCE(po.poisclose, 0) = 0 AND COALESCE(po.postatus, 0) IN (2, 3) THEN 1 ELSE 0 END) AS poOutstandingCount
          FROM m4_po po ${poJoin} ${poWhereSql}`,
          poBinds
        );
        poAgg = {
          poCount: Number(aRows[0]?.poCount || 0),
          poTotalIdr: Number(aRows[0]?.poTotalIdr || 0),
          poOutstandingCount: Number(aRows[0]?.poOutstandingCount || 0),
        };

        const [rows] = await conn.query<RowDataPacket[]>(
          `SELECT po.poid AS id, po.ponotransaksi AS docNo, po.potgl AS date, po.potgldipenuhi AS expectedDate,
            ${poSup} AS supplierName, CASE WHEN ${poImp} THEN 1 ELSE 0 END AS isImport,
            COALESCE(NULLIF(TRIM(po.pogudang), ''), '-') AS warehouse, COALESCE(NULLIF(TRIM(po.pomatauang), ''), 'IDR') AS currency,
            ${poKurs} AS kurs, COALESCE(po.pototaltransaksi, 0) * ${poKurs} AS totalIdr,
            COALESCE(po.postatusgrn, 0) AS statusGrn, COALESCE(po.postatusri, 0) AS statusRi,
            COALESCE(po.poisclose, 0) AS isClosed, COALESCE(po.postatus, 0) AS statusCode
          FROM m4_po po ${poJoin} ${poWhereSql}
          ORDER BY po.potgl DESC, po.poid DESC LIMIT ?`,
          [...poBinds, limit]
        );
        purchaseOrders = rows.map((r) => ({
          id: Number(r.id || 0),
          docNo: String(r.docNo || '-'),
          date: formatDateIso(r.date),
          expectedDate: formatDateIso(r.expectedDate),
          supplierName: String(r.supplierName || '-'),
          originType: Number(r.isImport || 0) === 1 ? 'Import' : 'Domestic',
          warehouse: String(r.warehouse || '-'),
          currency: String(r.currency || 'IDR').toUpperCase(),
          kurs: Number(r.kurs || 1),
          totalIdr: Number(r.totalIdr || 0),
          statusGrn: Number(r.statusGrn || 0),
          statusRi: Number(r.statusRi || 0),
          isClosed: Boolean(Number(r.isClosed)),
          statusCode: Number(r.statusCode || 0),
          statusLabel: getM0StatusLabel(r.statusCode),
        }));
      } catch {
        // Optional PO
      }
    }

    let grnCount = 0;
    let goodsReceipts: ErpPurchasingGrnRow[] = [];
    if (hasGrn) {
      try {
        const gCols = await getSafeTableColumns(conn, 'm4_grn');
        const idCol = pickColumn(gCols, '', ['grnid', 'id']);
        const noCol = pickColumn(gCols, '', ['grnnotransaksi', 'notransaksi']);
        const dtCol = pickColumn(gCols, '', ['grntgl', 'tgl']);
        const supCol = pickColumn(gCols, '', ['grnsupplier', 'supplier']);
        const whCol = pickColumn(gCols, '', ['grngudang', 'gudang']);
        const totCol = pickColumn(gCols, '', ['grntotaltransaksi', 'grntotal', 'totaltransaksi']);
        const kursCol = pickColumn(gCols, '', ['grnkurs', 'kurs']);
        const stCol = pickColumn(gCols, '', ['grnstatus', 'status']);
        if (idCol && noCol && dtCol) {
          const gWhere: string[] = [`g.\`${dtCol}\` >= ?`];
          const gBinds: unknown[] = [dateFrom];
          if (stCol) gWhere.unshift(`COALESCE(g.\`${stCol}\`, 0) NOT IN (6, 12)`);
          if (dateTo) {
            gWhere.push(`g.\`${dtCol}\` <= ?`);
            gBinds.push(dateTo);
          }
          const gJoin = hasContact && supCol ? `LEFT JOIN m1_contact c ON c.kid = g.\`${supCol}\`` : '';
          if (search) {
            gWhere.push(
              gJoin
                ? `(g.\`${noCol}\` LIKE ? OR COALESCE(c.knama, '') LIKE ?)`
                : `g.\`${noCol}\` LIKE ?`
            );
            gBinds.push(`%${search}%`);
            if (gJoin) gBinds.push(`%${search}%`);
          }
          const gWhereSql = `WHERE ${gWhere.join(' AND ')}`;
          const [cRows] = await conn.query<RowDataPacket[]>(
            `SELECT COUNT(*) AS cnt FROM m4_grn g ${gJoin} ${gWhereSql}`,
            gBinds
          );
          grnCount = Number(cRows[0]?.cnt || 0);
          const supExpr = gJoin
            ? `COALESCE(NULLIF(TRIM(c.knama), ''), CONCAT('Supplier #', g.\`${supCol}\`))`
            : `'-'`;
          const whExpr = whCol ? `COALESCE(NULLIF(TRIM(g.\`${whCol}\`), ''), '-')` : `'-'`;
          const totExpr = totCol
            ? kursCol
              ? `COALESCE(g.\`${totCol}\`, 0) * COALESCE(NULLIF(g.\`${kursCol}\`, 0), 1)`
              : `COALESCE(g.\`${totCol}\`, 0)`
            : '0';
          const stExpr = stCol ? `COALESCE(g.\`${stCol}\`, 0)` : '0';
          const [rows] = await conn.query<RowDataPacket[]>(
            `SELECT g.\`${idCol}\` AS id, g.\`${noCol}\` AS docNo, g.\`${dtCol}\` AS date,
              ${supExpr} AS supplierName, ${whExpr} AS warehouse, ${totExpr} AS totalIdr, ${stExpr} AS statusCode
            FROM m4_grn g ${gJoin} ${gWhereSql}
            ORDER BY g.\`${dtCol}\` DESC, g.\`${idCol}\` DESC LIMIT ?`,
            [...gBinds, limit]
          );
          goodsReceipts = rows.map((r) => ({
            id: Number(r.id || 0),
            docNo: String(r.docNo || '-'),
            date: formatDateIso(r.date),
            supplierName: String(r.supplierName || '-'),
            warehouse: String(r.warehouse || '-'),
            totalIdr: Number(r.totalIdr || 0),
            statusCode: Number(r.statusCode || 0),
            statusLabel: getM0StatusLabel(r.statusCode),
          }));
        }
      } catch {
        // Optional GRN
      }
    }

    let prCount = 0;
    let prOutstandingCount = 0;
    let purchaseRequests: ErpPurchasingPrRow[] = [];
    if (hasPr) {
      try {
        const prWhere: string[] = ['COALESCE(pr.prstatus, 0) NOT IN (6, 12)', 'pr.prtgl >= ?'];
        const prBinds: unknown[] = [dateFrom];
        if (dateTo) {
          prWhere.push('pr.prtgl <= ?');
          prBinds.push(dateTo);
        }
        if (search) {
          prWhere.push(
            "(pr.prnotransaksi LIKE ? OR COALESCE(pr.pruraian, '') LIKE ? OR COALESCE(pr.prgudang, '') LIKE ?)"
          );
          prBinds.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        const prWhereSql = `WHERE ${prWhere.join(' AND ')}`;
        const [cRows] = await conn.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS cnt, SUM(CASE WHEN COALESCE(pr.prisclose, 0) = 0 AND COALESCE(pr.prstatus, 0) IN (2, 3) AND (COALESCE(pr.prstatuspo, 0) = 0 OR COALESCE(pr.prstatus, 0) = 3) THEN 1 ELSE 0 END) AS openCnt FROM m4_pr pr ${prWhereSql}`,
          prBinds
        );
        prCount = Number(cRows[0]?.cnt || 0);
        prOutstandingCount = Number(cRows[0]?.openCnt || 0);
        const [rows] = await conn.query<RowDataPacket[]>(
          `SELECT pr.prid AS id, pr.prnotransaksi AS docNo, pr.prtgl AS date, pr.prtgldipakai AS neededDate,
            COALESCE(NULLIF(TRIM(pr.pruraian), ''), '-') AS description, COALESCE(NULLIF(TRIM(pr.prgudang), ''), '-') AS warehouse,
            COALESCE(pr.prtotaltransaksi, 0) * COALESCE(NULLIF(pr.prkurs, 0), 1) AS totalIdr,
            COALESCE(pr.prstatuspo, 0) AS statusPo, COALESCE(pr.prstatus, 0) AS statusCode
          FROM m4_pr pr ${prWhereSql}
          ORDER BY pr.prtgl DESC, pr.prid DESC LIMIT ?`,
          [...prBinds, limit]
        );
        purchaseRequests = rows.map((r) => ({
          id: Number(r.id || 0),
          docNo: String(r.docNo || '-'),
          date: formatDateIso(r.date),
          neededDate: formatDateIso(r.neededDate),
          description: String(r.description || '-'),
          warehouse: String(r.warehouse || '-'),
          totalIdr: Number(r.totalIdr || 0),
          statusPo: Number(r.statusPo || 0),
          statusCode: Number(r.statusCode || 0),
          statusLabel: getM0StatusLabel(r.statusCode),
        }));
      } catch {
        // Optional PR
      }
    }

    let returnCountSub = 0;
    let returnTotalSubIdr = 0;
    let vpCount = 0;
    let vpTotalIdr = 0;
    if (hasPrt) {
      try {
        const pCols = await getSafeTableColumns(conn, 'm4_prt');
        const dtCol = pickColumn(pCols, '', ['prttgl', 'tgl']);
        const totCol = pickColumn(pCols, '', ['prttotaltransaksi', 'prttotal', 'totaltransaksi']);
        const kursCol = pickColumn(pCols, '', ['prtkurs', 'kurs']);
        const stCol = pickColumn(pCols, '', ['prtstatus', 'status']);
        if (dtCol) {
          const w: string[] = [`\`${dtCol}\` >= ?`];
          const b: unknown[] = [dateFrom];
          if (stCol) w.unshift(`COALESCE(\`${stCol}\`, 0) NOT IN (6, 12)`);
          if (dateTo) {
            w.push(`\`${dtCol}\` <= ?`);
            b.push(dateTo);
          }
          const totE = totCol
            ? kursCol
              ? `COALESCE(\`${totCol}\`, 0) * COALESCE(NULLIF(\`${kursCol}\`, 0), 1)`
              : `COALESCE(\`${totCol}\`, 0)`
            : '0';
          const [rows] = await conn.query<RowDataPacket[]>(
            `SELECT COUNT(*) AS cnt, COALESCE(SUM(${totE}), 0) AS tot FROM m4_prt WHERE ${w.join(' AND ')}`,
            b
          );
          returnCountSub = Number(rows[0]?.cnt || 0);
          returnTotalSubIdr = Number(rows[0]?.tot || 0);
        }
      } catch {
        // Optional PRT
      }
    }
    if (hasVp) {
      try {
        const vCols = await getSafeTableColumns(conn, 'm4_vp');
        const dtCol = pickColumn(vCols, '', ['vptgl', 'tgl']);
        const totCol = pickColumn(vCols, '', [
          'vpbayar',
          'vptotalap',
          'vptotaltransaksi',
          'vpjmlbayar',
          'vptotal',
          'totaltransaksi',
        ]);
        const kursCol = pickColumn(vCols, '', ['vpkurs', 'kurs']);
        const stCol = pickColumn(vCols, '', ['vpstatus', 'status']);
        if (dtCol) {
          const w: string[] = [`\`${dtCol}\` >= ?`];
          const b: unknown[] = [dateFrom];
          if (stCol) w.unshift(`COALESCE(\`${stCol}\`, 0) NOT IN (6, 12)`);
          if (dateTo) {
            w.push(`\`${dtCol}\` <= ?`);
            b.push(dateTo);
          }
          const totE = totCol
            ? kursCol
              ? `COALESCE(\`${totCol}\`, 0) * COALESCE(NULLIF(\`${kursCol}\`, 0), 1)`
              : `COALESCE(\`${totCol}\`, 0)`
            : '0';
          const [rows] = await conn.query<RowDataPacket[]>(
            `SELECT COUNT(*) AS cnt, COALESCE(SUM(${totE}), 0) AS tot FROM m4_vp WHERE ${w.join(' AND ')}`,
            b
          );
          vpCount = Number(rows[0]?.cnt || 0);
          vpTotalIdr = Number(rows[0]?.tot || 0);
        }
      } catch {
        // Optional VP
      }
    }

    // 7) Enrich actual transactional relations (PR <-> PO <-> GRN <-> RI/PI <-> VP)
    // Exact myERPplus schema:
    //   m4_po_detail.idprdetail -> m4_pr_detail.idprdetail (+ m4_po.poidpr)
    //   m4_grn_detail.idpodetail -> m4_po_detail.idpodetail (+ m4_grn.grnidpo)
    //   m4_ri_detail.idpodetail -> m4_po_detail.idpodetail, m4_ri_detail.idgrndetail -> m4_grn_detail.idgrndetail (+ m4_ri.riidpo / riidgrn)
    //   m4_vp_detail.idtransaksi -> m4_ri.riid (excluding AP/PRT/UM/Retur sumber)
    const pushRelated = (
      map: Map<number, ErpRelatedDocRef[]>,
      parentId: number,
      ref: ErpRelatedDocRef
    ) => {
      if (!parentId || !ref.id) return;
      const list = map.get(parentId) || [];
      if (!list.some((x) => x.type === ref.type && x.id === ref.id)) {
        list.push(ref);
        map.set(parentId, list);
      }
    };
    const toRelRef = (type: ErpRelatedDocRef['type'], r: RowDataPacket): ErpRelatedDocRef => ({
      type,
      id: Number(r.id || 0),
      docNo: String(r.docNo || '-'),
      date: formatDateIso(r.date),
      statusCode: Number(r.statusCode || 0),
      statusLabel: getM0StatusLabel(r.statusCode),
      totalIdr: Number(r.totalIdr || 0),
    });
    const vpSumberRiFilter =
      "UPPER(TRIM(COALESCE(vd.sumber, ''))) NOT IN ('AP', 'PRT', 'UM', 'RETUR', 'DNR', 'M4_AP', 'M4_PRT') " +
      "AND UPPER(COALESCE(vd.sumber, '')) NOT LIKE '%RETUR%' " +
      "AND UPPER(COALESCE(vd.sumber, '')) NOT LIKE '%UANG MUKA%'";

    const poIds = Array.from(new Set(purchaseOrders.map((p) => p.id).filter((id) => id > 0)));
    const prIds = Array.from(new Set(purchaseRequests.map((p) => p.id).filter((id) => id > 0)));
    const grnIds = Array.from(new Set(goodsReceipts.map((g) => g.id).filter((id) => id > 0)));
    const allRiIds = Array.from(
      new Set([...invoices, ...unpaidInvoices].map((i) => i.id).filter((id) => id > 0))
    );

    // 7a) PO relations: PR, GRN, RI (direct + via GRN), VP (via RI)
    if (poIds.length > 0) {
      const poPrMap = new Map<number, ErpRelatedDocRef[]>();
      const poGrnMap = new Map<number, ErpRelatedDocRef[]>();
      const poRiMap = new Map<number, ErpRelatedDocRef[]>();
      const poVpMap = new Map<number, ErpRelatedDocRef[]>();

      if (hasPr) {
        try {
          const unionParts: string[] = [
            'SELECT po.poid, po.poidpr AS prid FROM m4_po po WHERE po.poid IN (?) AND COALESCE(po.poidpr, 0) > 0',
          ];
          const binds: unknown[] = [poIds];
          if (hasPoDetail && hasPrDetail) {
            unionParts.unshift(
              'SELECT pd.idpo AS poid, prd.idpr AS prid FROM m4_po_detail pd INNER JOIN m4_pr_detail prd ON prd.idprdetail = pd.idprdetail WHERE pd.idpo IN (?) AND COALESCE(pd.idprdetail, 0) > 0'
            );
            binds.unshift(poIds);
          }
          const [rows] = await conn.query<RowDataPacket[]>(
            `SELECT DISTINCT x.poid AS parentId, pr.prid AS id, pr.prnotransaksi AS docNo, pr.prtgl AS date,
              COALESCE(pr.prstatus, 0) AS statusCode,
              COALESCE(pr.prtotaltransaksi, 0) * COALESCE(NULLIF(pr.prkurs, 0), 1) AS totalIdr
             FROM (${unionParts.join(' UNION ')}) x
             INNER JOIN m4_pr pr ON pr.prid = x.prid
             WHERE COALESCE(pr.prstatus, 0) NOT IN (6, 12)
             ORDER BY pr.prtgl DESC, pr.prid DESC`,
            binds
          );
          for (const r of rows) pushRelated(poPrMap, Number(r.parentId), toRelRef('PR', r));
        } catch {
          // Optional PO->PR
        }
      }

      if (hasGrn) {
        try {
          const unionParts: string[] = [
            'SELECT g.grnidpo AS poid, g.grnid AS grnid FROM m4_grn g WHERE g.grnidpo IN (?)',
          ];
          const binds: unknown[] = [poIds];
          if (hasPoDetail && hasGrnDetail) {
            unionParts.unshift(
              'SELECT pd.idpo AS poid, gd.idgrn AS grnid FROM m4_po_detail pd INNER JOIN m4_grn_detail gd ON gd.idpodetail = pd.idpodetail WHERE pd.idpo IN (?) AND COALESCE(gd.idpodetail, 0) > 0'
            );
            binds.unshift(poIds);
          }
          const [rows] = await conn.query<RowDataPacket[]>(
            `SELECT DISTINCT x.poid AS parentId, g.grnid AS id, g.grnnotransaksi AS docNo, g.grntgl AS date,
              COALESCE(g.grnstatus, 0) AS statusCode,
              COALESCE(g.grntotaltransaksi, 0) * COALESCE(NULLIF(g.grnkurs, 0), 1) AS totalIdr
             FROM (${unionParts.join(' UNION ')}) x
             INNER JOIN m4_grn g ON g.grnid = x.grnid
             WHERE COALESCE(g.grnstatus, 0) NOT IN (6, 12)
             ORDER BY g.grntgl DESC, g.grnid DESC`,
            binds
          );
          for (const r of rows) pushRelated(poGrnMap, Number(r.parentId), toRelRef('GRN', r));
        } catch {
          // Optional PO->GRN
        }
      }

      if (hasRi) {
        try {
          const unionParts: string[] = [
            'SELECT ri.riidpo AS poid, ri.riid AS riid FROM m4_ri ri WHERE ri.riidpo IN (?)',
          ];
          const binds: unknown[] = [poIds];
          if (hasGrn) {
            unionParts.push(
              'SELECT g.grnidpo AS poid, ri.riid AS riid FROM m4_grn g INNER JOIN m4_ri ri ON ri.riidgrn = g.grnid WHERE g.grnidpo IN (?) AND COALESCE(ri.riidgrn, 0) > 0'
            );
            binds.push(poIds);
          }
          if (hasPoDetail && hasRiDetail) {
            unionParts.unshift(
              'SELECT pd.idpo AS poid, rd.idri AS riid FROM m4_po_detail pd INNER JOIN m4_ri_detail rd ON rd.idpodetail = pd.idpodetail WHERE pd.idpo IN (?) AND COALESCE(rd.idpodetail, 0) > 0'
            );
            binds.unshift(poIds);
          }
          if (hasPoDetail && hasGrnDetail && hasRiDetail) {
            unionParts.unshift(
              'SELECT pd.idpo AS poid, rd.idri AS riid FROM m4_po_detail pd INNER JOIN m4_grn_detail gd ON gd.idpodetail = pd.idpodetail INNER JOIN m4_ri_detail rd ON rd.idgrndetail = gd.idgrndetail WHERE pd.idpo IN (?) AND COALESCE(gd.idpodetail, 0) > 0 AND COALESCE(rd.idgrndetail, 0) > 0'
            );
            binds.unshift(poIds);
          }
          const [rows] = await conn.query<RowDataPacket[]>(
            `SELECT DISTINCT x.poid AS parentId, ri.riid AS id, ri.rinotransaksi AS docNo, ri.ritgl AS date,
              COALESCE(ri.ristatus, 0) AS statusCode,
              COALESCE(ri.ritotaltransaksi, 0) * COALESCE(NULLIF(ri.rikurs, 0), 1) AS totalIdr
             FROM (${unionParts.join(' UNION ')}) x
             INNER JOIN m4_ri ri ON ri.riid = x.riid
             WHERE COALESCE(ri.ristatus, 0) NOT IN (6, 12)
             ORDER BY ri.ritgl DESC, ri.riid DESC`,
            binds
          );
          for (const r of rows) pushRelated(poRiMap, Number(r.parentId), toRelRef('RI', r));
        } catch {
          // Optional PO->RI
        }
      }

      if (hasVp && hasVpDetail && poRiMap.size > 0) {
        try {
          const riToPoIds = new Map<number, number[]>();
          for (const [poid, ris] of poRiMap.entries()) {
            for (const ri of ris) {
              const list = riToPoIds.get(ri.id) || [];
              if (!list.includes(poid)) list.push(poid);
              riToPoIds.set(ri.id, list);
            }
          }
          const linkedRiIds = Array.from(riToPoIds.keys());
          if (linkedRiIds.length > 0) {
            const [rows] = await conn.query<RowDataPacket[]>(
              `SELECT DISTINCT vd.idtransaksi AS riid, vp.vpid AS id, vp.vpnotransaksi AS docNo, vp.vptgl AS date,
                COALESCE(vp.vpstatus, 0) AS statusCode,
                COALESCE(vd.jmlbayar, vp.vpbayar, 0) * COALESCE(NULLIF(vp.vpkurs, 0), 1) AS totalIdr
               FROM m4_vp_detail vd
               INNER JOIN m4_vp vp ON vp.vpid = vd.idvp
               WHERE vd.idtransaksi IN (?) AND COALESCE(vp.vpstatus, 0) NOT IN (6, 12) AND ${vpSumberRiFilter}
               ORDER BY vp.vptgl DESC, vp.vpid DESC`,
              [linkedRiIds]
            );
            for (const r of rows) {
              const vpRef = toRelRef('VP', r);
              for (const poid of riToPoIds.get(Number(r.riid)) || []) {
                pushRelated(poVpMap, poid, vpRef);
              }
            }
          }
        } catch {
          // Optional PO->RI->VP
        }
      }

      for (const po of purchaseOrders) {
        const prs = poPrMap.get(po.id) || [];
        const grns = poGrnMap.get(po.id) || [];
        const ris = poRiMap.get(po.id) || [];
        const vps = poVpMap.get(po.id) || [];
        po.relatedPrs = prs;
        po.relatedGrns = grns;
        po.relatedRis = ris;
        po.relatedVps = vps;
        if (grns.length > 0) po.statusGrn = 1;
        if (ris.length > 0) po.statusRi = 1;
      }
    }

    // 7b) PR relations: PO, GRN, RI
    if (prIds.length > 0) {
      const prPoMap = new Map<number, ErpRelatedDocRef[]>();
      const prGrnMap = new Map<number, ErpRelatedDocRef[]>();
      const prRiMap = new Map<number, ErpRelatedDocRef[]>();

      if (hasPo) {
        try {
          const unionParts: string[] = [
            'SELECT po.poidpr AS prid, po.poid AS poid FROM m4_po po WHERE po.poidpr IN (?)',
          ];
          const binds: unknown[] = [prIds];
          if (hasPrDetail && hasPoDetail) {
            unionParts.unshift(
              'SELECT prd.idpr AS prid, pd.idpo AS poid FROM m4_pr_detail prd INNER JOIN m4_po_detail pd ON pd.idprdetail = prd.idprdetail WHERE prd.idpr IN (?) AND COALESCE(pd.idprdetail, 0) > 0'
            );
            binds.unshift(prIds);
          }
          const [rows] = await conn.query<RowDataPacket[]>(
            `SELECT DISTINCT x.prid AS parentId, po.poid AS id, po.ponotransaksi AS docNo, po.potgl AS date,
              COALESCE(po.postatus, 0) AS statusCode,
              COALESCE(po.pototaltransaksi, 0) * COALESCE(NULLIF(po.pokurs, 0), 1) AS totalIdr
             FROM (${unionParts.join(' UNION ')}) x
             INNER JOIN m4_po po ON po.poid = x.poid
             WHERE COALESCE(po.postatus, 0) NOT IN (6, 12)
             ORDER BY po.potgl DESC, po.poid DESC`,
            binds
          );
          for (const r of rows) pushRelated(prPoMap, Number(r.parentId), toRelRef('PO', r));
        } catch {
          // Optional PR->PO
        }
      }

      if (hasGrn) {
        try {
          const unionParts: string[] = [
            'SELECT g.grnidpr AS prid, g.grnid AS grnid FROM m4_grn g WHERE g.grnidpr IN (?)',
          ];
          const binds: unknown[] = [prIds];
          if (hasPrDetail && hasGrnDetail) {
            unionParts.unshift(
              'SELECT prd.idpr AS prid, gd.idgrn AS grnid FROM m4_pr_detail prd INNER JOIN m4_grn_detail gd ON gd.idprdetail = prd.idprdetail WHERE prd.idpr IN (?) AND COALESCE(gd.idprdetail, 0) > 0'
            );
            binds.unshift(prIds);
          }
          if (hasPrDetail && hasPoDetail && hasGrnDetail) {
            unionParts.push(
              'SELECT prd.idpr AS prid, gd.idgrn AS grnid FROM m4_pr_detail prd INNER JOIN m4_po_detail pd ON pd.idprdetail = prd.idprdetail INNER JOIN m4_grn_detail gd ON gd.idpodetail = pd.idpodetail WHERE prd.idpr IN (?) AND COALESCE(pd.idprdetail, 0) > 0 AND COALESCE(gd.idpodetail, 0) > 0'
            );
            binds.push(prIds);
          }
          const [rows] = await conn.query<RowDataPacket[]>(
            `SELECT DISTINCT x.prid AS parentId, g.grnid AS id, g.grnnotransaksi AS docNo, g.grntgl AS date,
              COALESCE(g.grnstatus, 0) AS statusCode,
              COALESCE(g.grntotaltransaksi, 0) * COALESCE(NULLIF(g.grnkurs, 0), 1) AS totalIdr
             FROM (${unionParts.join(' UNION ')}) x
             INNER JOIN m4_grn g ON g.grnid = x.grnid
             WHERE COALESCE(g.grnstatus, 0) NOT IN (6, 12)
             ORDER BY g.grntgl DESC, g.grnid DESC`,
            binds
          );
          for (const r of rows) pushRelated(prGrnMap, Number(r.parentId), toRelRef('GRN', r));
        } catch {
          // Optional PR->GRN
        }
      }

      if (hasRi) {
        try {
          const unionParts: string[] = [
            'SELECT ri.riidpr AS prid, ri.riid AS riid FROM m4_ri ri WHERE ri.riidpr IN (?)',
          ];
          const binds: unknown[] = [prIds];
          if (hasPrDetail && hasRiDetail) {
            unionParts.unshift(
              'SELECT prd.idpr AS prid, rd.idri AS riid FROM m4_pr_detail prd INNER JOIN m4_ri_detail rd ON rd.idprdetail = prd.idprdetail WHERE prd.idpr IN (?) AND COALESCE(rd.idprdetail, 0) > 0'
            );
            binds.unshift(prIds);
          }
          const [rows] = await conn.query<RowDataPacket[]>(
            `SELECT DISTINCT x.prid AS parentId, ri.riid AS id, ri.rinotransaksi AS docNo, ri.ritgl AS date,
              COALESCE(ri.ristatus, 0) AS statusCode,
              COALESCE(ri.ritotaltransaksi, 0) * COALESCE(NULLIF(ri.rikurs, 0), 1) AS totalIdr
             FROM (${unionParts.join(' UNION ')}) x
             INNER JOIN m4_ri ri ON ri.riid = x.riid
             WHERE COALESCE(ri.ristatus, 0) NOT IN (6, 12)
             ORDER BY ri.ritgl DESC, ri.riid DESC`,
            binds
          );
          for (const r of rows) pushRelated(prRiMap, Number(r.parentId), toRelRef('RI', r));
        } catch {
          // Optional PR->RI
        }
      }

      for (const pr of purchaseRequests) {
        const pos = prPoMap.get(pr.id) || [];
        pr.relatedPos = pos;
        pr.relatedGrns = prGrnMap.get(pr.id) || [];
        pr.relatedRis = prRiMap.get(pr.id) || [];
        if (pos.length > 0) pr.statusPo = 1;
      }
    }

    // 7c) GRN relations: PR, PO, RI
    if (grnIds.length > 0) {
      const grnPrMap = new Map<number, ErpRelatedDocRef[]>();
      const grnPoMap = new Map<number, ErpRelatedDocRef[]>();
      const grnRiMap = new Map<number, ErpRelatedDocRef[]>();

      if (hasPr) {
        try {
          const unionParts: string[] = [
            'SELECT g.grnid, g.grnidpr AS prid FROM m4_grn g WHERE g.grnid IN (?) AND COALESCE(g.grnidpr, 0) > 0',
          ];
          const binds: unknown[] = [grnIds];
          if (hasGrnDetail && hasPrDetail) {
            unionParts.unshift(
              'SELECT gd.idgrn AS grnid, prd.idpr AS prid FROM m4_grn_detail gd INNER JOIN m4_pr_detail prd ON prd.idprdetail = gd.idprdetail WHERE gd.idgrn IN (?) AND COALESCE(gd.idprdetail, 0) > 0'
            );
            binds.unshift(grnIds);
          }
          const [rows] = await conn.query<RowDataPacket[]>(
            `SELECT DISTINCT x.grnid AS parentId, pr.prid AS id, pr.prnotransaksi AS docNo, pr.prtgl AS date,
              COALESCE(pr.prstatus, 0) AS statusCode,
              COALESCE(pr.prtotaltransaksi, 0) * COALESCE(NULLIF(pr.prkurs, 0), 1) AS totalIdr
             FROM (${unionParts.join(' UNION ')}) x
             INNER JOIN m4_pr pr ON pr.prid = x.prid
             WHERE COALESCE(pr.prstatus, 0) NOT IN (6, 12)
             ORDER BY pr.prtgl DESC, pr.prid DESC`,
            binds
          );
          for (const r of rows) pushRelated(grnPrMap, Number(r.parentId), toRelRef('PR', r));
        } catch {
          // Optional GRN->PR
        }
      }

      if (hasPo) {
        try {
          const unionParts: string[] = [
            'SELECT g.grnid, g.grnidpo AS poid FROM m4_grn g WHERE g.grnid IN (?) AND COALESCE(g.grnidpo, 0) > 0',
          ];
          const binds: unknown[] = [grnIds];
          if (hasGrnDetail && hasPoDetail) {
            unionParts.unshift(
              'SELECT gd.idgrn AS grnid, pd.idpo AS poid FROM m4_grn_detail gd INNER JOIN m4_po_detail pd ON pd.idpodetail = gd.idpodetail WHERE gd.idgrn IN (?) AND COALESCE(gd.idpodetail, 0) > 0'
            );
            binds.unshift(grnIds);
          }
          const [rows] = await conn.query<RowDataPacket[]>(
            `SELECT DISTINCT x.grnid AS parentId, po.poid AS id, po.ponotransaksi AS docNo, po.potgl AS date,
              COALESCE(po.postatus, 0) AS statusCode,
              COALESCE(po.pototaltransaksi, 0) * COALESCE(NULLIF(po.pokurs, 0), 1) AS totalIdr
             FROM (${unionParts.join(' UNION ')}) x
             INNER JOIN m4_po po ON po.poid = x.poid
             WHERE COALESCE(po.postatus, 0) NOT IN (6, 12)
             ORDER BY po.potgl DESC, po.poid DESC`,
            binds
          );
          for (const r of rows) pushRelated(grnPoMap, Number(r.parentId), toRelRef('PO', r));
        } catch {
          // Optional GRN->PO
        }
      }

      if (hasRi) {
        try {
          const unionParts: string[] = [
            'SELECT ri.riidgrn AS grnid, ri.riid AS riid FROM m4_ri ri WHERE ri.riidgrn IN (?)',
          ];
          const binds: unknown[] = [grnIds];
          if (hasGrnDetail && hasRiDetail) {
            unionParts.unshift(
              'SELECT gd.idgrn AS grnid, rd.idri AS riid FROM m4_grn_detail gd INNER JOIN m4_ri_detail rd ON rd.idgrndetail = gd.idgrndetail WHERE gd.idgrn IN (?) AND COALESCE(rd.idgrndetail, 0) > 0'
            );
            binds.unshift(grnIds);
          }
          const [rows] = await conn.query<RowDataPacket[]>(
            `SELECT DISTINCT x.grnid AS parentId, ri.riid AS id, ri.rinotransaksi AS docNo, ri.ritgl AS date,
              COALESCE(ri.ristatus, 0) AS statusCode,
              COALESCE(ri.ritotaltransaksi, 0) * COALESCE(NULLIF(ri.rikurs, 0), 1) AS totalIdr
             FROM (${unionParts.join(' UNION ')}) x
             INNER JOIN m4_ri ri ON ri.riid = x.riid
             WHERE COALESCE(ri.ristatus, 0) NOT IN (6, 12)
             ORDER BY ri.ritgl DESC, ri.riid DESC`,
            binds
          );
          for (const r of rows) pushRelated(grnRiMap, Number(r.parentId), toRelRef('RI', r));
        } catch {
          // Optional GRN->RI
        }
      }

      for (const g of goodsReceipts) {
        const ris = grnRiMap.get(g.id) || [];
        g.relatedPrs = grnPrMap.get(g.id) || [];
        g.relatedPos = grnPoMap.get(g.id) || [];
        g.relatedRis = ris;
        g.statusRi = ris.length > 0 ? 1 : 0;
      }
    }

    // 7d) RI/PI relations: PR, PO, GRN, VP
    if (allRiIds.length > 0) {
      const riPrMap = new Map<number, ErpRelatedDocRef[]>();
      const riPoMap = new Map<number, ErpRelatedDocRef[]>();
      const riGrnMap = new Map<number, ErpRelatedDocRef[]>();
      const riVpMap = new Map<number, ErpRelatedDocRef[]>();

      if (hasPr) {
        try {
          const unionParts: string[] = [
            'SELECT ri.riid, ri.riidpr AS prid FROM m4_ri ri WHERE ri.riid IN (?) AND COALESCE(ri.riidpr, 0) > 0',
          ];
          const binds: unknown[] = [allRiIds];
          if (hasRiDetail && hasPrDetail) {
            unionParts.unshift(
              'SELECT rd.idri AS riid, prd.idpr AS prid FROM m4_ri_detail rd INNER JOIN m4_pr_detail prd ON prd.idprdetail = rd.idprdetail WHERE rd.idri IN (?) AND COALESCE(rd.idprdetail, 0) > 0'
            );
            binds.unshift(allRiIds);
          }
          const [rows] = await conn.query<RowDataPacket[]>(
            `SELECT DISTINCT x.riid AS parentId, pr.prid AS id, pr.prnotransaksi AS docNo, pr.prtgl AS date,
              COALESCE(pr.prstatus, 0) AS statusCode,
              COALESCE(pr.prtotaltransaksi, 0) * COALESCE(NULLIF(pr.prkurs, 0), 1) AS totalIdr
             FROM (${unionParts.join(' UNION ')}) x
             INNER JOIN m4_pr pr ON pr.prid = x.prid
             WHERE COALESCE(pr.prstatus, 0) NOT IN (6, 12)
             ORDER BY pr.prtgl DESC, pr.prid DESC`,
            binds
          );
          for (const r of rows) pushRelated(riPrMap, Number(r.parentId), toRelRef('PR', r));
        } catch {
          // Optional RI->PR
        }
      }

      if (hasPo) {
        try {
          const unionParts: string[] = [
            'SELECT ri.riid, ri.riidpo AS poid FROM m4_ri ri WHERE ri.riid IN (?) AND COALESCE(ri.riidpo, 0) > 0',
          ];
          const binds: unknown[] = [allRiIds];
          if (hasGrn) {
            unionParts.push(
              'SELECT ri.riid, g.grnidpo AS poid FROM m4_ri ri INNER JOIN m4_grn g ON g.grnid = ri.riidgrn WHERE ri.riid IN (?) AND COALESCE(ri.riidgrn, 0) > 0 AND COALESCE(g.grnidpo, 0) > 0'
            );
            binds.push(allRiIds);
          }
          if (hasRiDetail && hasPoDetail) {
            unionParts.unshift(
              'SELECT rd.idri AS riid, pd.idpo AS poid FROM m4_ri_detail rd INNER JOIN m4_po_detail pd ON pd.idpodetail = rd.idpodetail WHERE rd.idri IN (?) AND COALESCE(rd.idpodetail, 0) > 0'
            );
            binds.unshift(allRiIds);
          }
          if (hasRiDetail && hasGrnDetail && hasPoDetail) {
            unionParts.unshift(
              'SELECT rd.idri AS riid, pd.idpo AS poid FROM m4_ri_detail rd INNER JOIN m4_grn_detail gd ON gd.idgrndetail = rd.idgrndetail INNER JOIN m4_po_detail pd ON pd.idpodetail = gd.idpodetail WHERE rd.idri IN (?) AND COALESCE(rd.idgrndetail, 0) > 0 AND COALESCE(gd.idpodetail, 0) > 0'
            );
            binds.unshift(allRiIds);
          }
          const [rows] = await conn.query<RowDataPacket[]>(
            `SELECT DISTINCT x.riid AS parentId, po.poid AS id, po.ponotransaksi AS docNo, po.potgl AS date,
              COALESCE(po.postatus, 0) AS statusCode,
              COALESCE(po.pototaltransaksi, 0) * COALESCE(NULLIF(po.pokurs, 0), 1) AS totalIdr
             FROM (${unionParts.join(' UNION ')}) x
             INNER JOIN m4_po po ON po.poid = x.poid
             WHERE COALESCE(po.postatus, 0) NOT IN (6, 12)
             ORDER BY po.potgl DESC, po.poid DESC`,
            binds
          );
          for (const r of rows) pushRelated(riPoMap, Number(r.parentId), toRelRef('PO', r));
        } catch {
          // Optional RI->PO
        }
      }

      if (hasGrn) {
        try {
          const unionParts: string[] = [
            'SELECT ri.riid, ri.riidgrn AS grnid FROM m4_ri ri WHERE ri.riid IN (?) AND COALESCE(ri.riidgrn, 0) > 0',
          ];
          const binds: unknown[] = [allRiIds];
          if (hasRiDetail && hasGrnDetail) {
            unionParts.unshift(
              'SELECT rd.idri AS riid, gd.idgrn AS grnid FROM m4_ri_detail rd INNER JOIN m4_grn_detail gd ON gd.idgrndetail = rd.idgrndetail WHERE rd.idri IN (?) AND COALESCE(rd.idgrndetail, 0) > 0'
            );
            binds.unshift(allRiIds);
          }
          const [rows] = await conn.query<RowDataPacket[]>(
            `SELECT DISTINCT x.riid AS parentId, g.grnid AS id, g.grnnotransaksi AS docNo, g.grntgl AS date,
              COALESCE(g.grnstatus, 0) AS statusCode,
              COALESCE(g.grntotaltransaksi, 0) * COALESCE(NULLIF(g.grnkurs, 0), 1) AS totalIdr
             FROM (${unionParts.join(' UNION ')}) x
             INNER JOIN m4_grn g ON g.grnid = x.grnid
             WHERE COALESCE(g.grnstatus, 0) NOT IN (6, 12)
             ORDER BY g.grntgl DESC, g.grnid DESC`,
            binds
          );
          for (const r of rows) pushRelated(riGrnMap, Number(r.parentId), toRelRef('GRN', r));
        } catch {
          // Optional RI->GRN
        }
      }

      if (hasVp && hasVpDetail) {
        try {
          const [rows] = await conn.query<RowDataPacket[]>(
            `SELECT DISTINCT vd.idtransaksi AS parentId, vp.vpid AS id, vp.vpnotransaksi AS docNo, vp.vptgl AS date,
              COALESCE(vp.vpstatus, 0) AS statusCode,
              COALESCE(vd.jmlbayar, vp.vpbayar, 0) * COALESCE(NULLIF(vp.vpkurs, 0), 1) AS totalIdr
             FROM m4_vp_detail vd
             INNER JOIN m4_vp vp ON vp.vpid = vd.idvp
             WHERE vd.idtransaksi IN (?) AND COALESCE(vp.vpstatus, 0) NOT IN (6, 12) AND ${vpSumberRiFilter}
             ORDER BY vp.vptgl DESC, vp.vpid DESC`,
            [allRiIds]
          );
          for (const r of rows) pushRelated(riVpMap, Number(r.parentId), toRelRef('VP', r));
        } catch {
          // Optional RI->VP
        }
      }

      for (const inv of [...invoices, ...unpaidInvoices]) {
        inv.relatedPrs = riPrMap.get(inv.id) || [];
        inv.relatedPos = riPoMap.get(inv.id) || [];
        inv.relatedGrns = riGrnMap.get(inv.id) || [];
        inv.relatedVps = riVpMap.get(inv.id) || [];
      }
    }

    const monthlyReconciliation = Array.from(glMonthlyMap.values()).sort((a, b) =>
      a.month.localeCompare(b.month)
    );
    const glNetPurchase = glTotalDomestic + glTotalImport + glTotalReturn + glTotalDiscount;

    return {
      cutoffDate: ACTIVE_ERP_CUTOFF_DATE,
      period: { dateFrom, dateTo },
      kpi: {
        glPurchaseDomestic: glTotalDomestic,
        glPurchaseImport: glTotalImport,
        glPurchaseReturn: glTotalReturn,
        glPurchaseDiscount: glTotalDiscount,
        glNetPurchase,
        glOtherCogsCost: glTotalOtherCogsCost,
        glTotalPurchasingCogs: glNetPurchase + glTotalOtherCogsCost,
        apJournalTotal,
        apJournalCarryOver,
        apJournalPeriod,
        riInvoiceCount: riAgg.invoiceCount,
        riDomesticCount: riAgg.domesticCount,
        riImportCount: riAgg.importCount,
        riDppIdr: riAgg.dppIdr,
        riTaxIdr: riAgg.taxIdr,
        riTotalIdr: riAgg.totalIdr,
        riPaidIdr: riAgg.paidIdr,
        varianceGlVsRiDpp: glNetPurchase - riAgg.dppIdr,
        apSubLedgerTotalIdr: apSubAgg.totalPayableIdr,
        apUnpaidInvoiceCount: apSubAgg.unpaidInvoiceCount,
        apCarryOverPayableIdr: apSubAgg.carryOverPayableIdr,
        apCarryOverUnpaidCount: apSubAgg.carryOverUnpaidCount,
        apOverdueInvoiceCount: apSubAgg.overdueInvoiceCount,
        apOverdueAmountIdr: apSubAgg.overdueAmountIdr,
        poCount: poAgg.poCount,
        poTotalIdr: poAgg.poTotalIdr,
        poOutstandingCount: poAgg.poOutstandingCount,
        grnCount,
        prCount,
        prOutstandingCount,
        returnCountSub,
        returnTotalSubIdr,
        vpCount,
        vpTotalIdr,
      },
      monthlyReconciliation,
      glPurchasingAccounts,
      apAging,
      topApContactsGl,
      topSuppliers,
      topItems,
      invoices,
      unpaidInvoices,
      purchaseOrders,
      goodsReceipts,
      purchaseRequests,
      relationsSupported: true,
      poOutstandingStrict: true,
      fetchedAt: new Date().toISOString(),
    };
  });

  if (purchasingQueryCache.size > 30) {
    const oldest = purchasingQueryCache.keys().next().value;
    if (oldest) purchasingQueryCache.delete(oldest);
  }
  purchasingQueryCache.set(cacheKey, {
    expiresAt: Date.now() + STOCK_CACHE_TTL_MS,
    data,
  });
  return data;
}

const ERP_STOCK_INTENT_REGEX =
  /\b(stok|stock|persediaan|gudang|warehouse|sisa\s+stok|cek\s+stok|barang\s+di\s+gudang|kode\s+barang|sku|qty\s+barang|stok\s+habis|stok\s+kosong|stok\s+menipis|stok\s+minim)\b/i;

const ERP_SALES_INTENT_REGEX =
  /\b(penjualan|sales|omzet|omset|faktur\s+penjualan|invoice\s+penjualan|piutang|belum\s+lunas|jatuh\s+tempo|sales\s+order|\bso\b|delivery\s+order|\bdo\b|surat\s+jalan|pengiriman\s+barang|retur\s+penjualan|sales\s+return|customer|pelanggan|terlaris|top\s+customer|top\s+barang|m5_si|m5_so|m5_do|m5_sr)\b/i;

const ERP_PURCHASING_INTENT_REGEX =
  /\b(purchasing|pembelian|purchase|procurement|pengadaan|purchase\s+order|\bpo\b|purchase\s+request|\bpr\b|goods\s+receipt|\bgrn\b|penerimaan\s+barang|receiving\s+invoice|faktur\s+pembelian|purchase\s+domestic|purchase\s+import|pembelian\s+(lokal|domestik|impor|import)|retur\s+pembelian|purchase\s+return|diskon\s+pembelian|supplier|pemasok|vendor|vendor\s+payment|pembayaran\s+supplier|hutang\s+(supplier|usaha|pembelian|vendor)|aging\s+hutang|aging\s+ap|m4_ri|m4_po|m4_grn|m4_pr|m4_prt|m4_vp|520105|520104|510103|510102)\b/i;

const ERP_FINANCE_INTENT_REGEX =
  /\b(keuangan|finance|akuntansi|neraca|balance\s+sheet|laba\s+rugi|profit|loss|p&l|hpp|cogs|opex|beban\s+operasional|biaya\s+operasional|hutang|utang|payable|trade\s+payable|\bap\b|\bar\b|piutang|aging\s+piutang|kas\s+dan\s+bank|saldo\s+kas|saldo\s+bank|ekuitas|liabilitas|aktiva|pasiva|jurnal|m1_coa|m2_transaction_journal|m2_realization|supplier\s+hutang)\b/i;

const ERP_ASSETS_INTENT_REGEX =
  /\b(aset|asset|aktiva\s+tetap|fixed\s+asset|nilai\s+buku|sisa\s+nilai\s+buku|book\s+value|nbv|umur\s+ekonomis|masa\s+manfaat|penyusutan|depresiasi|akumulasi\s+penyusutan|harga\s+perolehan|nilai\s+perolehan|nilai\s+residu|m7_asset|dispose|kendaraan|mesin|bangunan|inventaris\s+aset|aset\s+perusahaan)\b/i;

const ERP_GENERAL_INTENT_REGEX = /\b(erp|mysql|myerpplus)\b/i;

const STOCK_QUERY_STOPWORDS = new Set([
  'cek', 'lihat', 'tampilkan', 'tunjukkan', 'tunjukan', 'berapa', 'ada', 'sisa', 'total', 'jumlah',
  'stok', 'stock', 'barang', 'persediaan', 'gudang', 'warehouse', 'di', 'ke', 'dari',
  'yang', 'dan', 'atau', 'untuk', 'pada', 'saat', 'ini', 'sekarang', 'erp', 'mysql',
  'database', 'tolong', 'dong', 'coba', 'daftar', 'list', 'semua', 'seluruh', 'apa',
  'saja', 'aja', 'habis', 'kosong', 'menipis', 'rendah', 'kurang', 'kode', 'nama', 'qty',
  'mana', 'siapa', 'kapan', 'bagaimana', 'kenapa', 'mengapa', 'sebutkan', 'rincikan',
  'rinci', 'detail', 'detil', 'per', 'tiap', 'setiap', 'urutan', 'urut', 'urutkan',
  'kronologis', 'masing', 'masih', 'sudah', 'telah', 'tersebut', 'tadi', 'itu', 'nya',
  'mohon', 'kasih', 'tahu', 'tau', 'sesuai', 'keseluruhan', 'gabungan', 'kumulatif',
  // Kata kerja/format presentasi, tabel, grafik, ringkasan, dan kata penghubung umum
  'dalam', 'dengan', 'tanpa', 'secara', 'berdasarkan', 'menurut', 'beserta', 'antara',
  'sebagai', 'seperti', 'agar', 'supaya', 'bisa', 'dapat', 'serta', 'juga', 'hanya',
  'akan', 'sedang', 'lagi', 'oleh', 'para', 'bagi', 'bila', 'jika', 'kalau', 'ketika',
  'buat', 'buatkan', 'sajikan', 'tulis', 'tuliskan', 'jelaskan', 'uraikan', 'berikan',
  'cekkan', 'periksa', 'bantu', 'ringkas', 'ringkasan', 'rekap', 'rekapitulasi',
  'analisis', 'analisa', 'bandingkan', 'perbandingan', 'komparasi', 'tren', 'trend',
  'pertumbuhan', 'persentase', 'proporsi', 'komposisi', 'distribusi', 'kontribusi',
  'tabel', 'table', 'grafik', 'chart', 'diagram', 'presentasi', 'visualisasi', 'visual',
  'slide', 'report', 'catatan', 'keterangan', 'poin', 'kesimpulan', 'insight', 'rekomendasi',
  'terbesar', 'terkecil', 'tertinggi', 'terendah', 'terbanyak', 'terbaru', 'terlama',
  'paling', 'utama', 'penting', 'status', 'kondisi', 'posisi', 'perusahaan', 'internal',
  'sistem', 'menu', 'modul', 'halaman', 'bagian', 'kategori', 'grup', 'group', 'jenis',
  'tipe', 'divisi', 'departemen', 'unit', 'item', 'dokumen', 'nomor', 'no', 'berjalan',
  'kini', 'terkini', 'terakhir', 'live', 'rupiah', 'idr', 'angka', 'data', 'info', 'informasi',
]);

const SALES_QUERY_STOPWORDS = new Set([
  ...STOCK_QUERY_STOPWORDS,
  'penjualan', 'sales', 'omzet', 'omset', 'faktur', 'invoice', 'piutang', 'belum', 'lunas',
  'jatuh', 'tempo', 'order', 'so', 'do', 'delivery', 'surat', 'jalan', 'pengiriman',
  'retur', 'return', 'customer', 'pelanggan', 'terlaris', 'paling', 'laris', 'top',
  'tertinggi', 'terbesar', 'terbaru', 'rekap', 'ringkasan', 'laporan', 'summary',
  'bulan', 'bulanan', 'tahun', 'hari', 'minggu', 'lalu', 'kemarin', 'januari', 'februari',
  'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november',
  'desember', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'agu', 'ags', 'sep', 'okt', 'nov', 'des',
  'outstanding', 'terkirim', 'kirim', 'bayar', 'pembayaran', 'nilai', 'baru', 'baris',
  'approved', 'approve', 'inprogress', 'progress', 'completed', 'complete', 'pending', 'open',
  'selesai', 'menunggu', 'diterima', 'terima', 'dibuat', 'dibuatkan',
  'transaksi', 'myerpplus', 'sejak', 'mulai', 'sampai', 'hingga', 'kini', 'periode',
  'aktif', 'carry', 'over',
]);

const FINANCE_QUERY_STOPWORDS = new Set([
  ...SALES_QUERY_STOPWORDS,
  'keuangan', 'finance', 'akuntansi', 'neraca', 'balance', 'sheet', 'laba', 'rugi',
  'profit', 'loss', 'hpp', 'cogs', 'opex', 'beban', 'biaya', 'operasional', 'hutang',
  'utang', 'payable', 'payables', 'receivable', 'receivables', 'ap', 'ar', 'aging',
  'kas', 'bank', 'saldo', 'ekuitas', 'liabilitas', 'aktiva', 'pasiva', 'jurnal',
  'coa', 'akun', 'supplier', 'vendor', 'pendapatan', 'bersih', 'kotor', 'margin',
  'bandingkan', 'analisa', 'analisis', 'ringkas', 'hitung', 'termasuk', 'sebelum',
]);

const PURCHASING_QUERY_STOPWORDS = new Set([
  ...FINANCE_QUERY_STOPWORDS,
  'purchasing', 'pembelian', 'purchase', 'procurement', 'pengadaan', 'po', 'pr', 'grn',
  'ri', 'prt', 'vp', 'receiving', 'goods', 'receipt', 'request', 'penerimaan', 'domestic',
  'domestik', 'lokal', 'import', 'impor', 'pemasok', 'rekonsiliasi', 'dpp', 'ppn', 'pajak',
  'm4_ri', 'm4_po', 'm4_grn', 'm4_pr', 'm4_prt', 'm4_vp', 'diskon', 'discount',
]);

export function isErpStockQuery(
  question: string,
  history: { role: 'user' | 'assistant'; content: string }[] = []
): boolean {
  const q = question.trim();
  if (!q) return false;
  if (ERP_STOCK_INTENT_REGEX.test(q)) return true;

  if (q.split(/\s+/).length <= 10 && history.length > 0) {
    const recent = history
      .slice(-2)
      .map((m) => m.content)
      .join(' ');
    if (ERP_STOCK_INTENT_REGEX.test(recent)) return true;
  }
  return false;
}

export function isErpSalesQuery(
  question: string,
  history: { role: 'user' | 'assistant'; content: string }[] = []
): boolean {
  const q = question.trim();
  if (!q) return false;
  if (ERP_SALES_INTENT_REGEX.test(q)) return true;

  if (q.split(/\s+/).length <= 10 && history.length > 0) {
    const recent = history
      .slice(-2)
      .map((m) => m.content)
      .join(' ');
    if (ERP_SALES_INTENT_REGEX.test(recent)) return true;
  }
  return false;
}

export function isErpFinanceQuery(
  question: string,
  history: { role: 'user' | 'assistant'; content: string }[] = []
): boolean {
  const q = question.trim();
  if (!q) return false;
  if (ERP_FINANCE_INTENT_REGEX.test(q)) return true;

  if (q.split(/\s+/).length <= 10 && history.length > 0) {
    const recent = history
      .slice(-2)
      .map((m) => m.content)
      .join(' ');
    if (ERP_FINANCE_INTENT_REGEX.test(recent)) return true;
  }
  return false;
}

export function isErpAssetsQuery(
  question: string,
  history: { role: 'user' | 'assistant'; content: string }[] = []
): boolean {
  const q = question.trim();
  if (!q) return false;
  if (ERP_ASSETS_INTENT_REGEX.test(q)) return true;

  if (q.split(/\s+/).length <= 10 && history.length > 0) {
    const recent = history
      .slice(-2)
      .map((m) => m.content)
      .join(' ');
    if (ERP_ASSETS_INTENT_REGEX.test(recent)) return true;
  }
  return false;
}

export function isErpPurchasingQuery(
  question: string,
  history: { role: 'user' | 'assistant'; content: string }[] = []
): boolean {
  const q = question.trim();
  if (!q) return false;
  if (ERP_PURCHASING_INTENT_REGEX.test(q)) return true;

  if (q.split(/\s+/).length <= 10 && history.length > 0) {
    const recent = history
      .slice(-2)
      .map((m) => m.content)
      .join(' ');
    if (ERP_PURCHASING_INTENT_REGEX.test(recent)) return true;
  }
  return false;
}

export function isErpAnyQuery(
  question: string,
  history: { role: 'user' | 'assistant'; content: string }[] = []
): boolean {
  return (
    isErpStockQuery(question, history) ||
    isErpSalesQuery(question, history) ||
    isErpPurchasingQuery(question, history) ||
    isErpFinanceQuery(question, history) ||
    isErpAssetsQuery(question, history) ||
    ERP_GENERAL_INTENT_REGEX.test(question.trim())
  );
}

function extractStockSearchTerms(question: string): {
  search: string;
  onlyLowStock: boolean;
} {
  const lower = question.toLowerCase();
  const onlyLowStock = /\b(habis|kosong|menipis|rendah|kurang|minimum|kritis|nol|0)\b/i.test(lower);

  const tokens = lower
    .replace(/[^a-z0-9\-_/.\s]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOCK_QUERY_STOPWORDS.has(t));

  return {
    search: tokens.slice(0, 4).join(' '),
    onlyLowStock,
  };
}

const MONTH_NAME_MAP: Record<string, number> = {
  januari: 1, jan: 1,
  februari: 2, feb: 2,
  maret: 3, mar: 3,
  april: 4, apr: 4,
  mei: 5,
  juni: 6, jun: 6,
  juli: 7, jul: 7,
  agustus: 8, agu: 8, ags: 8,
  september: 9, sep: 9,
  oktober: 10, okt: 10,
  november: 11, nov: 11,
  desember: 12, des: 12,
};

const MONTH_DISPLAY_ID = [
  '',
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

function getCurrentMonthRangeWib(): {
  year: number;
  month: number;
  day: number;
  today: string;
  dateFrom: string;
  dateTo: string;
  monthLabel: string;
  label: string;
  prevMonthLabel: string;
} {
  const pad = (n: number) => String(n).padStart(2, '0');
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === 'year')?.value || now.getFullYear());
  const month = Number(parts.find((p) => p.type === 'month')?.value || now.getMonth() + 1);
  const day = Number(parts.find((p) => p.type === 'day')?.value || now.getDate());
  const today = `${year}-${pad(month)}-${pad(day)}`;
  const lastDay = new Date(year, month, 0).getDate();
  const dateFrom = clampActiveDateFrom(`${year}-${pad(month)}-01`);
  const rawTo = `${year}-${pad(month)}-${pad(lastDay)}`;
  const dateTo = rawTo >= ACTIVE_ERP_CUTOFF_DATE ? rawTo : '';
  const monthLabel = `${MONTH_DISPLAY_ID[month]} ${year}`;
  const prevDate = new Date(year, month - 2, 1);
  const prevMonthLabel = `${MONTH_DISPLAY_ID[prevDate.getMonth() + 1]} ${prevDate.getFullYear()}`;
  return {
    year,
    month,
    day,
    today,
    dateFrom,
    dateTo,
    monthLabel,
    label: `${monthLabel} (Bulan Berjalan)`,
    prevMonthLabel,
  };
}

function parseExplicitDateRangeFromText(text: string): {
  matched: boolean;
  dateFrom: string;
  dateTo: string;
  isSpecificPeriod: boolean;
  label: string;
} {
  const lower = text.toLowerCase();
  const wib = getCurrentMonthRangeWib();
  const defaultYear = Math.max(2026, wib.year);
  const pad = (n: number) => String(n).padStart(2, '0');

  // 1) Rentang bulan, mis: "maret sampai april 2026", "maret - juni", "mar s/d okt 2026"
  const monthRangeMatch = lower.match(
    /\b(januari|jan|februari|feb|maret|mar|april|apr|mei|juni|jun|juli|jul|agustus|agu|ags|september|sep|oktober|okt|november|nov|desember|des)\s*(?:s\/?d|sampai(?:\s+dengan)?|hingga|-|–)\s*(januari|jan|februari|feb|maret|mar|april|apr|mei|juni|jun|juli|jul|agustus|agu|ags|september|sep|oktober|okt|november|nov|desember|des)(?:\s+(20\d{2}))?\b/
  );
  if (monthRangeMatch) {
    const m1 = MONTH_NAME_MAP[monthRangeMatch[1]];
    const m2 = MONTH_NAME_MAP[monthRangeMatch[2]];
    const y = monthRangeMatch[3] ? Number(monthRangeMatch[3]) : defaultYear;
    const startM = Math.min(m1, m2);
    const endM = Math.max(m1, m2);
    const lastDay = new Date(y, endM, 0).getDate();
    const dateFrom = clampActiveDateFrom(`${y}-${pad(startM)}-01`);
    const rawTo = `${y}-${pad(endM)}-${pad(lastDay)}`;
    const dateTo = rawTo >= ACTIVE_ERP_CUTOFF_DATE ? rawTo : '';
    return {
      matched: true,
      dateFrom,
      dateTo,
      isSpecificPeriod: Boolean(dateTo),
      label: `${MONTH_DISPLAY_ID[startM]}–${MONTH_DISPLAY_ID[endM]} ${y}`,
    };
  }

  // 2) Bulan + tahun, mis: "april 2026", "mar 2026" — namun jika didahului "mulai / sejak / dari / terhitung", berarti rentang terbuka s/d sekarang!
  const monthYearMatch = lower.match(
    /\b(januari|jan|februari|feb|maret|mar|april|apr|mei|juni|jun|juli|jul|agustus|agu|ags|september|sep|oktober|okt|november|nov|desember|des)\s+(20\d{2})\b/
  );
  if (monthYearMatch) {
    const m = MONTH_NAME_MAP[monthYearMatch[1]];
    const y = Number(monthYearMatch[2]);
    const dateFrom = clampActiveDateFrom(`${y}-${pad(m)}-01`);
    const matchIndex = monthYearMatch.index ?? 0;
    const prefix = lower.slice(Math.max(0, matchIndex - 26), matchIndex);
    if (/\b(?:sejak|mulai|dari|setelah|terhitung(?:\s+(?:sejak|mulai|dari))?)\s*$/.test(prefix)) {
      return {
        matched: true,
        dateFrom,
        dateTo: '',
        isSpecificPeriod: false,
        label: `${MONTH_DISPLAY_ID[m]} ${y} – Sekarang`,
      };
    }
    const lastDay = new Date(y, m, 0).getDate();
    const rawTo = `${y}-${pad(m)}-${pad(lastDay)}`;
    const dateTo = rawTo >= ACTIVE_ERP_CUTOFF_DATE ? rawTo : '';
    return {
      matched: true,
      dateFrom,
      dateTo,
      isSpecificPeriod: Boolean(dateTo),
      label: `${MONTH_DISPLAY_ID[m]} ${y}`,
    };
  }

  // 3) Nama bulan penuh tanpa tahun (atau "bulan mar/apr/..."), mis: "penjualan bulan april", "laba rugi maret"
  const monthOnlyMatch =
    lower.match(
      /\bbulan\s+(januari|jan|februari|feb|maret|mar|april|apr|mei|juni|jun|juli|jul|agustus|agu|ags|september|sep|oktober|okt|november|nov|desember|des)\b/
    ) ||
    lower.match(
      /\b(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)\b/
    );
  if (monthOnlyMatch) {
    // Jika didahului "sejak / mulai / dari / setelah / terhitung", berarti rentang terbuka dari bulan tsb s/d sekarang
    const matchIndex = monthOnlyMatch.index ?? 0;
    const prefix = lower.slice(Math.max(0, matchIndex - 26), matchIndex);
    const m = MONTH_NAME_MAP[monthOnlyMatch[1]];
    const y = defaultYear;
    const dateFrom = clampActiveDateFrom(`${y}-${pad(m)}-01`);
    if (/\b(?:sejak|mulai|dari|setelah|terhitung(?:\s+(?:sejak|mulai|dari))?)\s*$/.test(prefix)) {
      return {
        matched: true,
        dateFrom,
        dateTo: '',
        isSpecificPeriod: false,
        label: `${MONTH_DISPLAY_ID[m]} ${y} – Sekarang`,
      };
    }
    if (!/\bsebelum\s*$/.test(prefix)) {
      const lastDay = new Date(y, m, 0).getDate();
      const rawTo = `${y}-${pad(m)}-${pad(lastDay)}`;
      const dateTo = rawTo >= ACTIVE_ERP_CUTOFF_DATE ? rawTo : '';
      return {
        matched: true,
        dateFrom,
        dateTo,
        isSpecificPeriod: Boolean(dateTo),
        label: `${MONTH_DISPLAY_ID[m]} ${y}`,
      };
    }
  }

  if (/\bhari\s+ini\b/.test(lower)) {
    return {
      matched: true,
      dateFrom: clampActiveDateFrom(wib.today),
      dateTo: wib.today,
      isSpecificPeriod: true,
      label: `Hari Ini (${wib.today})`,
    };
  }
  if (/\bbulan\s+(?:ini|berjalan|sekarang)\b/.test(lower)) {
    return {
      matched: true,
      dateFrom: wib.dateFrom,
      dateTo: wib.dateTo,
      isSpecificPeriod: Boolean(wib.dateTo),
      label: wib.label,
    };
  }
  if (/\bbulan\s+(?:lalu|kemarin|sebelumnya)\b/.test(lower)) {
    const prevDate = new Date(wib.year, wib.month - 2, 1);
    const py = prevDate.getFullYear();
    const pm = prevDate.getMonth() + 1;
    const pLastDay = new Date(py, pm, 0).getDate();
    const dateFrom = clampActiveDateFrom(`${py}-${pad(pm)}-01`);
    const rawTo = `${py}-${pad(pm)}-${pad(pLastDay)}`;
    const dateTo = rawTo >= ACTIVE_ERP_CUTOFF_DATE ? rawTo : '';
    return {
      matched: true,
      dateFrom,
      dateTo,
      isSpecificPeriod: Boolean(dateTo),
      label: `Bulan Lalu (${MONTH_DISPLAY_ID[pm]} ${py})`,
    };
  }
  if (/\btahun\s+ini\b/.test(lower)) {
    return {
      matched: true,
      dateFrom: clampActiveDateFrom(`${wib.year}-01-01`),
      dateTo: wib.today,
      isSpecificPeriod: false,
      label: `Tahun ${wib.year} (sejak Mar 2026)`,
    };
  }

  const yearOnlyMatch = lower.match(/\b(20\d{2})\b/);
  if (yearOnlyMatch) {
    const y = Number(yearOnlyMatch[1]);
    if (y >= 2026) {
      return {
        matched: true,
        dateFrom: clampActiveDateFrom(`${y}-01-01`),
        dateTo: `${y}-12-31`,
        isSpecificPeriod: false,
        label: `Tahun ${y} (sejak Mar 2026)`,
      };
    }
  }

  return {
    matched: false,
    dateFrom: ACTIVE_ERP_CUTOFF_DATE,
    dateTo: '',
    isSpecificPeriod: false,
    label: 'Maret 2026 – Sekarang',
  };
}

function extractDateRangeFromQuestion(
  question: string,
  history: { role: 'user' | 'assistant'; content: string }[] = []
): {
  dateFrom: string;
  dateTo: string;
  isSpecificPeriod: boolean;
  isDefaultCurrentMonth: boolean;
  inheritedFromHistory: boolean;
  wantsMonthlyBreakdown: boolean;
  periodLabel: string;
} {
  const lower = question.toLowerCase();
  const wib = getCurrentMonthRangeWib();
  const wantsMonthlyBreakdown =
    /\b(per\s+bulan|urutan\s+bulan|sesuai\s+(?:urutan\s+)?bulan|tiap\s+bulan|setiap\s+bulan|bulanan|kronologis|masing[\s-]masing\s+bulan|tren\s+bulanan)\b/.test(
      lower
    );
  const wantsAllCumulative =
    /\b(keseluruhan|semua\s+bulan|seluruh\s+bulan|semua\s+periode|seluruh\s+periode|total\s+semua|kumulatif|sejak\s+maret|mulai\s+maret|dari\s+maret|sepanjang\s+tahun)\b/.test(
      lower
    );

  // 1) Periode eksplisit yang ditulis langsung oleh pengguna di pertanyaan saat ini selalu menjadi prioritas utama
  const direct = parseExplicitDateRangeFromText(question);
  if (direct.matched) {
    return {
      dateFrom: direct.dateFrom,
      dateTo: direct.dateTo,
      isSpecificPeriod: direct.isSpecificPeriod,
      isDefaultCurrentMonth: false,
      inheritedFromHistory: false,
      wantsMonthlyBreakdown,
      periodLabel: direct.label,
    };
  }

  // 2) Jika pengguna meminta tren/rekap per bulan atau kumulatif semua bulan, ambil sejak cut-off aktif
  if (wantsMonthlyBreakdown || wantsAllCumulative) {
    return {
      dateFrom: ACTIVE_ERP_CUTOFF_DATE,
      dateTo: '',
      isSpecificPeriod: false,
      isDefaultCurrentMonth: false,
      inheritedFromHistory: false,
      wantsMonthlyBreakdown,
      periodLabel: 'Maret 2026 – Sekarang',
    };
  }

  // 3) Warisi periode spesifik dari riwayat HANYA dari pesan USER (bukan dari teks contoh di jawaban assistant!)
  //    dan HANYA jika pertanyaan sekarang benar-benar berupa pertanyaan lanjutan kontekstual.
  const words = lower.trim().split(/\s+/).filter(Boolean);
  const isFollowUpReference =
    /\b(tersebut|tadi|di\s+atas|yang\s+itu|mana\s+yang|siapa\s+saja|rinciannya|detailnya|lanjutannya|diagramnya|grafiknya|chartnya|buatkan\s+(?:diagram|grafik|chart)|ubah\s+ke\s+(?:diagram|grafik|chart))\b/.test(
      lower
    ) ||
    (words.length <= 4 &&
      !/\b(cek|lihat|tampilkan|daftar|list|total|berapa)\s+(po|pr|so|do|si|grn|ri|faktur|omzet|penjualan|pembelian|laba|rugi)\b/.test(
        lower
      ));

  if (isFollowUpReference && history.length > 0) {
    const recentUserMsgs = history
      .filter((msg) => msg?.role === 'user' && msg?.content && msg.content.trim() !== question.trim())
      .slice(-2)
      .reverse();
    for (const msg of recentUserMsgs) {
      const fromHist = parseExplicitDateRangeFromText(msg.content);
      if (fromHist.matched && fromHist.isSpecificPeriod) {
        return {
          dateFrom: fromHist.dateFrom,
          dateTo: fromHist.dateTo,
          isSpecificPeriod: true,
          isDefaultCurrentMonth: false,
          inheritedFromHistory: true,
          wantsMonthlyBreakdown: false,
          periodLabel: fromHist.label,
        };
      }
    }
  }

  // 4) Default otomatis: BULAN BERJALAN (WIB) — misal akses di November 2026 -> otomatis tampilkan transaksi November 2026 saja
  return {
    dateFrom: wib.dateFrom,
    dateTo: wib.dateTo,
    isSpecificPeriod: Boolean(wib.dateTo),
    isDefaultCurrentMonth: true,
    inheritedFromHistory: false,
    wantsMonthlyBreakdown: false,
    periodLabel: wib.label,
  };
}

function extractSalesQueryParams(
  question: string,
  history: { role: 'user' | 'assistant'; content: string }[] = []
): {
  search: string;
  dateFrom: string;
  dateTo: string;
  isSpecificPeriod: boolean;
  isDefaultCurrentMonth: boolean;
  inheritedFromHistory: boolean;
  wantsMonthlyBreakdown: boolean;
  periodLabel: string;
} {
  const lower = question.toLowerCase();
  const range = extractDateRangeFromQuestion(question, history);

  const tokens = lower
    .replace(/\b20\d{2}\b/g, ' ')
    .replace(/[^a-z0-9\-_/.\s]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !SALES_QUERY_STOPWORDS.has(t));

  return {
    search: tokens.slice(0, 3).join(' '),
    ...range,
  };
}

function extractFinanceQueryParams(
  question: string,
  history: { role: 'user' | 'assistant'; content: string }[] = []
): {
  search: string;
  dateFrom: string;
  dateTo: string;
  isSpecificPeriod: boolean;
  isDefaultCurrentMonth: boolean;
  inheritedFromHistory: boolean;
  wantsMonthlyBreakdown: boolean;
  periodLabel: string;
} {
  const lower = question.toLowerCase();
  const range = extractDateRangeFromQuestion(question, history);

  const tokens = lower
    .replace(/\b20\d{2}\b/g, ' ')
    .replace(/[^a-z0-9\-_/.\s]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !FINANCE_QUERY_STOPWORDS.has(t));

  return {
    search: tokens.slice(0, 2).join(' '),
    ...range,
  };
}

function extractPurchasingQueryParams(
  question: string,
  history: { role: 'user' | 'assistant'; content: string }[] = []
): {
  search: string;
  dateFrom: string;
  dateTo: string;
  isSpecificPeriod: boolean;
  isDefaultCurrentMonth: boolean;
  inheritedFromHistory: boolean;
  wantsMonthlyBreakdown: boolean;
  periodLabel: string;
} {
  const lower = question.toLowerCase();
  const range = extractDateRangeFromQuestion(question, history);

  const tokens = lower
    .replace(/\b20\d{2}\b/g, ' ')
    .replace(/[^a-z0-9\-_/.\s]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !PURCHASING_QUERY_STOPWORDS.has(t));

  return {
    search: tokens.slice(0, 3).join(' '),
    ...range,
  };
}

function fmtIdr(val: number): string {
  return `Rp ${Math.round(val || 0).toLocaleString('id-ID')}`;
}

function fmtIdrExact(val: number): string {
  const num = Number(val || 0);
  return `Rp ${num.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function buildErpStockAiContext(question: string): Promise<ErpStockAiContext> {
  if (!isErpMysqlConfigured()) {
    return {
      configured: false,
      connected: false,
      totalRows: 0,
      matchedCount: 0,
      summaryText: [
        'STATUS KONEKSI MYSQL ERP: BELUM DIKONFIGURASI.',
        'Variabel koneksi ERP belum diisi di pengaturan Secrets/Environment server (ERP_BRIDGE_URL + ERP_BRIDGE_TOKEN untuk ngrok http 3099, atau ERP_MYSQL_HOST untuk TCP langsung).',
        'Arahkan pengguna ke menu "ERP Live" untuk mengunduh skrip bridge lokal erp-mysql-bridge.mjs dan melihat panduan koneksi.',
      ].join('\n'),
    };
  }

  try {
    const { search, onlyLowStock } = extractStockSearchTerms(question);
    // Ambil daftar kategori aktif terlebih dahulu agar bisa deteksi jika user menyebut kategori spesifik (RM, WIP, FG, dll.)
    const summaryResult = await queryErpWarehouseStock({
      summaryOnly: true,
      limit: 1,
    });
    const categories = summaryResult.categories || [];
    const qLower = question.toLowerCase();
    let matchedCategory = '';
    for (const c of categories) {
      const catName = c.category.trim();
      if (!catName || catName.toLowerCase() === 'tanpa kategori') continue;
      const escaped = catName.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const shortCode = catName.split(/\s*[-—]\s*/)[0]?.trim().toLowerCase() || '';
      const shortEscaped = shortCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (
        new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(qLower) ||
        (shortCode.length >= 2 && new RegExp(`(^|[^a-z0-9])${shortEscaped}([^a-z0-9]|$)`, 'i').test(qLower))
      ) {
        matchedCategory = catName;
        break;
      }
    }

    // Jika user menanyakan kategori spesifik, bersihkan token kategori dari search agar pencarian item tidak terlalu sempit
    let effectiveSearch = search;
    if (matchedCategory && effectiveSearch) {
      const catParts = matchedCategory
        .toLowerCase()
        .split(/[\s\-—/]+/)
        .filter((p) => p.length >= 2);
      const remaining = effectiveSearch
        .split(/\s+/)
        .filter((tok) => !catParts.includes(tok.toLowerCase()));
      effectiveSearch = remaining.join(' ');
    }

    const asksIntransit =
      /\b(intransit|in[\s-]*transit|belum\s+di\s*invoice|sudah\s+dikirim)\b/i.test(question);

    let result = await queryErpWarehouseStock({
      search: effectiveSearch,
      category: matchedCategory,
      onlyLowStock,
      intransitOnly: false,
      limit: 60,
    });

    let broadenedFallback = false;
    if (result.items.length === 0 && effectiveSearch) {
      broadenedFallback = true;
      result = await queryErpWarehouseStock({
        category: matchedCategory,
        onlyLowStock,
        intransitOnly: false,
        limit: 40,
      });
    }

    // Separate informational query ONLY if user explicitly asked about Gudang Intransit
    let intransitDetailResult: ErpStockQueryResult | null = null;
    if (asksIntransit) {
      intransitDetailResult = await queryErpWarehouseStock({
        search: effectiveSearch,
        category: matchedCategory,
        intransitOnly: true,
        limit: 40,
      }).catch(() => null);
    }

    const catLines = (result.categories || categories).map(
      (c) =>
        `- ${c.category}: ${c.skuCount.toLocaleString('id-ID')} item aktif | Total Qty Fisik/Tersedia: ${c.totalQty.toLocaleString('id-ID')} | Stok <= 0: ${c.zeroStockCount}`
    );

    const whLines = result.warehouses.map(
      (w) =>
        `- ${w.warehouse}: ${w.skuCount.toLocaleString('id-ID')} item aktif | Total Qty Fisik/Tersedia: ${w.totalQty.toLocaleString('id-ID')} | Stok <= 0: ${w.zeroStockCount}`
    );

    const itemLines =
      result.items.length === 0
        ? ['(Tidak ada baris stok fisik/tersedia aktif yang cocok di gudang fisik saat ini.)']
        : result.items.map(
            (it, idx) =>
              `${idx + 1}. Kode: ${it.code} | Nama: ${it.name} | Kategori: ${it.category || 'Tanpa Kategori'} | Gudang Fisik: ${it.warehouse} | Qty Tersedia: ${it.qty.toLocaleString('id-ID')} ${it.unit}`
          );

    const intransitSummary = intransitDetailResult?.intransitSummary || result.intransitSummary;
    const intransitSection: string[] = [];
    if (asksIntransit && intransitDetailResult) {
      intransitSection.push(
        '',
        '=== INFORMASI TERPISAH — GUDANG INTRANSIT (VIRTUAL: BARANG SUDAH DIKIRIM, BELUM DIINVOICE) ===',
        'PERINGATAN WAJIB: Data di bawah ini BUKAN stok fisik di gudang dan DILARANG DIJUMLAHKAN ke Stok Fisik / Tersedia. Hanya untuk informasi barang yang sudah di-DO tetapi Sales Invoice (SI) belum diinput (nilai HPP/persediaan tetap tercatat secara akuntansi).',
        intransitDetailResult.items.length === 0
          ? '(Tidak ada baris barang di Gudang Intransit untuk filter ini.)'
          : intransitDetailResult.items
              .map(
                (it, idx) =>
                  `${idx + 1}. Kode: ${it.code} | Nama: ${it.name} | Kategori: ${it.category || 'Tanpa Kategori'} | Status: Barang sudah dikirim, belum diinvoice (${it.warehouse}) | Qty Intransit: ${it.qty.toLocaleString('id-ID')} ${it.unit}`
              )
              .join('\n')
      );
    } else if (intransitSummary && intransitSummary.skuCount > 0) {
      intransitSection.push(
        '',
        `CATATAN TERPISAH GUDANG INTRANSIT (HANYA INFORMASI · TIDAK DIHITUNG KE STOK TERSEDIA): Terdapat ${intransitSummary.skuCount.toLocaleString('id-ID')} baris (${intransitSummary.totalQty.toLocaleString('id-ID')} unit) tercatat di Gudang Intransit ("Barang sudah dikirim, belum diinvoice" — sudah di-DO keluar fisik, menunggu Sales Invoice/SI). Angka tersebut SUDAH DIKECUALIKAN dari seluruh angka Stok Fisik / Tersedia di atas; DILARANG menjumlahkannya ke stok tersedia dan DILARANG melaporkannya sebagai kendala/kekosongan stok fisik gudang.`
      );
    }

    const summaryText = [
      `=== MODUL STOK FISIK / TERSEDIA ERP (MySQL Read-Only · HANYA GUDANG FISIK AKTIF · TANPA GUDANG INTRANSIT · m1_item.baktif = 1 & bjenis = 'P' · ${result.viewName}) ===`,
      `WAKTU PENGAMBILAN LIVE: ${new Date(result.fetchedAt).toLocaleString('id-ID')}`,
      `ATURAN GUDANG INTRANSIT: Seluruh angka di bawah ini adalah STOK FISIK / TERSEDIA dan SUDAH MENGECUALIKAN Gudang Intransit (gudang virtual barang sudah dikirim/DO, belum diinvoice/SI). Laporan Nilai Persediaan, HPP, dan Neraca di modul Keuangan TETAP menyertakan Gudang Intransit secara akuntansi.`,
      `TOTAL BARIS STOK FISIK AKTIF (baktif = 1, bjenis = 'P', tanpa Gudang Intransit): ${(result.totalActiveRows ?? result.totalRows).toLocaleString('id-ID')} baris`,
      matchedCategory
        ? `FILTER KATEGORI TERDETEKSI: "${matchedCategory}" (${result.totalRows.toLocaleString('id-ID')} baris stok fisik aktif di kategori ini, tanpa Gudang Intransit).`
        : 'CATATAN KATEGORI: Sajikan ringkasan stok fisik/tersedia per kategori barang persediaan (mis. RM, WIP, FG, dll.) tanpa Gudang Intransit dan tanyakan kategori mana yang ingin diperdalam jika pengguna belum menyebut kategori spesifik.',
      effectiveSearch
        ? broadenedFallback
          ? `PENCARIAN KATA KUNCI "${effectiveSearch}": Tidak ditemukan kecocokan langsung (0 baris di gudang fisik). Di bawah ini sampel stok fisik aktif sebagai referensi.`
          : `HASIL FILTER KATA KUNCI "${effectiveSearch}": ${result.items.length} baris stok fisik ditampilkan.`
        : `MENAMPILKAN: ${result.items.length} baris sampel stok fisik aktif (dari total ${(result.totalActiveRows ?? result.totalRows).toLocaleString('id-ID')} baris stok aktif)${onlyLowStock ? ' (filter stok rendah/kosong <= 10)' : ''}. WAJIB infokan kepada pengguna bahwa tabel hanya menampilkan sebagian data teratas/terbaru dan pengguna bisa menyebutkan kategori, gudang, atau nama/kode barang tertentu untuk melihat rincian spesifik.`,
      '',
      "RINGKASAN STOK FISIK / TERSEDIA PER KATEGORI (baktif = 1, bjenis = 'P', TANPA GUDANG INTRANSIT):",
      ...(catLines.length > 0 ? catLines : ['- (Tidak ada rincian kategori barang)']),
      '',
      `RINGKASAN PER GUDANG FISIK AKTIF${matchedCategory ? ` (KATEGORI: ${matchedCategory})` : ''} (TANPA GUDANG INTRANSIT):`,
      ...whLines,
      '',
      `RINCIAN STOK FISIK / TERSEDIA${matchedCategory ? ` (KATEGORI: ${matchedCategory})` : ''} (TANPA GUDANG INTRANSIT):`,
      ...itemLines,
      ...intransitSection,
    ].join('\n');

    return {
      configured: true,
      connected: true,
      totalRows: result.totalRows,
      matchedCount: broadenedFallback ? 0 : result.items.length,
      summaryText,
    };
  } catch (err) {
    return {
      configured: true,
      connected: false,
      totalRows: 0,
      matchedCount: 0,
      summaryText: [
        'STATUS KONEKSI STOK GUDANG ERP: GAGAL TERHUBUNG.',
        `Pesan diagnostik: ${formatMysqlError(err)}`,
        'Sampaikan kendala koneksi ini secara jelas dan sopan kepada pengguna, dan arahkan untuk memeriksa uji koneksi di menu "ERP Live".',
      ].join('\n'),
    };
  }
}

export async function buildErpSalesAiContext(
  question: string,
  history: { role: 'user' | 'assistant'; content: string }[] = []
): Promise<ErpStockAiContext> {
  if (!isErpMysqlConfigured()) {
    return {
      configured: false,
      connected: false,
      totalRows: 0,
      matchedCount: 0,
      summaryText: [
        'STATUS KONEKSI MYSQL ERP: BELUM DIKONFIGURASI.',
        'Arahkan pengguna ke menu "ERP Live" untuk menghubungkan bridge MySQL lokal.',
      ].join('\n'),
    };
  }

  try {
    const {
      search,
      dateFrom,
      dateTo,
      isSpecificPeriod,
      isDefaultCurrentMonth,
      inheritedFromHistory,
      wantsMonthlyBreakdown,
      periodLabel: detectedPeriodLabel,
    } = extractSalesQueryParams(question, history);
    const wib = getCurrentMonthRangeWib();
    let data = await queryErpSalesData({
      search,
      dateFrom,
      dateTo,
      limit: 100,
    });

    let broadenedFallback = false;
    if (data.kpi.invoiceCount === 0 && data.kpi.soCount === 0 && data.kpi.unpaidInvoiceCount === 0 && search) {
      broadenedFallback = true;
      data = await queryErpSalesData({
        dateFrom,
        dateTo,
        limit: 100,
      });
    }

    const effectiveFrom = data.period.dateFrom || ACTIVE_ERP_CUTOFF_DATE;
    const effectiveTo = data.period.dateTo || '';
    const periodRangeText = `${effectiveFrom} s/d ${effectiveTo || 'sekarang'}`;

    // Gabungkan faktur belum lunas dari data.unpaidInvoices & data.invoices tanpa duplikat,
    // lalu pisahkan secara tegas antara: (1) Khusus Periode yang Ditanyakan vs (2) Carry-Over Bulan Sebelumnya
    const unpaidMap = new Map<string, ErpSalesInvoiceRow>();
    for (const inv of [...data.unpaidInvoices, ...data.invoices]) {
      if (!inv.isPaid && inv.balance > 0) {
        const key = inv.docNo || String(inv.id);
        if (!unpaidMap.has(key)) unpaidMap.set(key, inv);
      }
    }
    const allUnpaidSorted = Array.from(unpaidMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date) || a.docNo.localeCompare(b.docNo)
    );
    const periodUnpaidInvoices = allUnpaidSorted.filter(
      (inv) => inv.date >= effectiveFrom && (!effectiveTo || inv.date <= effectiveTo)
    );
    const priorUnpaidInvoices = allUnpaidSorted.filter((inv) => inv.date < effectiveFrom);
    const periodUnpaidTotal = periodUnpaidInvoices.reduce((s, inv) => s + Number(inv.balance || 0), 0);

    const lines: string[] = [
      `=== MODUL SALES / PENJUALAN ERP (myerpplus: m5_si, m5_so, m5_do, m5_sr + m1_contact) ===`,
      `WAKTU PENGAMBILAN LIVE: ${new Date(data.fetchedAt).toLocaleString('id-ID')}`,
      `FOKUS PERIODE PERCAKAPAN: ${detectedPeriodLabel} (${periodRangeText})${
        isDefaultCurrentMonth
          ? ` [OTOMATIS BULAN BERJALAN (${wib.monthLabel}) — karena pengguna tidak menyebut bulan lain]`
          : inheritedFromHistory
            ? ' [DIWARISI OTOMATIS DARI KONTEKS BULAN DI PERTANYAAN SEBELUMNYA — utamakan rincian khusus bulan ini!]'
            : ''
      }`,
      `ATURAN PERIODE AKTIF: Transaksi operasional di bawah 2026-03-01 diabaikan (Status Reject [6] & Delete [12] dikecualikan). Piutang carry-over dari bulan sebelumnya dipisahkan di bagian khusus agar tidak tercampur dengan bulan yang sedang ditanyakan.`,
    ];

    if (wantsMonthlyBreakdown) {
      lines.push(
        `INSTRUKSI FORMAT URUTAN BULAN: Pengguna meminta tampilan BERURUTAN PER BULAN (kronologis). WAJIB sajikan tabel terurut per bulan (2026-03, 2026-04, 2026-05, dst.) dengan nilai masing-masing bulan, BUKAN hanya total gabungan keseluruhan.`
      );
    } else if (isDefaultCurrentMonth) {
      lines.push(
        `INSTRUKSI PERIODE DEFAULT = BULAN BERJALAN (${wib.monthLabel.toUpperCase()}): Seluruh data transaksi penjualan (SI, SO, DO, Retur) difokuskan otomatis ke bulan berjalan (${wib.monthLabel}, ${periodRangeText}). WAJIB infokan secara jelas kepada pengguna bahwa data yang ditampilkan adalah transaksi bulan berjalan (${wib.monthLabel}), dan pengguna dapat menyebutkan bulan lain (misalnya "${wib.prevMonthLabel}") atau "semua bulan" jika ingin melihat periode berbeda. Piutang carry-over dari bulan sebelum ${effectiveFrom} tetap dipisahkan sebagai catatan tambahan saja.`
      );
    } else if (isSpecificPeriod) {
      lines.push(
        `INSTRUKSI FOKUS BULAN ${detectedPeriodLabel.toUpperCase()}: Pengguna sedang membahas periode ${detectedPeriodLabel} (${periodRangeText}). Saat menampilkan rincian faktur/piutang, JAWAB TERLEBIH DAHULU daftar yang benar-benar terjadi di ${detectedPeriodLabel} saja agar cocok dengan angka bulan tersebut; jika ada carry-over dari bulan sebelum ${effectiveFrom}, sebutkan terpisah sebagai catatan tambahan saja (JANGAN dicampur menjadi satu daftar tanpa pemisah).`
      );
    }

    if (search) {
      lines.push(
        broadenedFallback
          ? `FILTER KATA KUNCI "${search}": Tidak ditemukan kecocokan langsung; menampilkan ringkasan umum periode tersebut.`
          : `FILTER KATA KUNCI: "${search}"`
      );
    }

    lines.push(
      '',
      `RINGKASAN KPI PENJUALAN PERIODE ${detectedPeriodLabel.toUpperCase()} (${periodRangeText}):`,
      `- Total Faktur Penjualan periode ini: ${data.kpi.invoiceCount.toLocaleString('id-ID')} faktur`,
      `- Total Omzet Penjualan periode ini: ${fmtIdr(data.kpi.totalRevenue)}`,
      `- Total Sudah Dibayar (faktur periode ini): ${fmtIdr(data.kpi.totalPaid)}`,
      `- Piutang Belum Lunas KHUSUS periode ${detectedPeriodLabel}: ${fmtIdr(periodUnpaidTotal)} (${periodUnpaidInvoices.length.toLocaleString('id-ID')} faktur)`,
      `- Total Piutang Kumulatif s/d ${effectiveTo || 'sekarang'} (termasuk carry-over < ${effectiveFrom}): ${fmtIdr(data.kpi.totalReceivable)} (${data.kpi.unpaidInvoiceCount.toLocaleString('id-ID')} faktur${
        typeof data.kpi.carryOverReceivable === 'number'
          ? `; termasuk carry-over < Mar 2026: ${fmtIdr(data.kpi.carryOverReceivable)} / ${(data.kpi.carryOverUnpaidCount || 0).toLocaleString('id-ID')} faktur`
          : ''
      })`,
      `- Faktur Jatuh Tempo Kumulatif (Overdue): ${data.kpi.overdueInvoiceCount.toLocaleString('id-ID')} faktur senilai ${fmtIdr(data.kpi.overdueAmount)}`,
      `- Total Sales Order periode ini (m5_so): ${data.kpi.soCount.toLocaleString('id-ID')} SO senilai ${fmtIdr(data.kpi.soTotalValue)} | Outstanding belum DO: ${data.kpi.soOutstandingCount.toLocaleString('id-ID')} SO`,
      `- Total Delivery Order / Surat Jalan periode ini (m5_do): ${data.kpi.doCount.toLocaleString('id-ID')} DO`,
      `- Total Retur Penjualan periode ini (m5_sr): ${data.kpi.returnCount.toLocaleString('id-ID')} retur senilai ${fmtIdr(data.kpi.returnTotalValue)}`
    );

    if (data.monthlyRevenue.length > 0) {
      const chronologicalMonths = [...data.monthlyRevenue].sort((a, b) =>
        a.month.localeCompare(b.month)
      );
      lines.push('', 'REKAP PENJUALAN & PIUTANG BERURUTAN PER BULAN (KRONOLOGIS):');
      for (const m of chronologicalMonths) {
        lines.push(
          `- ${m.month}: ${m.invoiceCount} faktur | Omzet ${fmtIdr(m.revenue)} | Terbayar ${fmtIdr(m.paid)} | Piutang Belum Lunas Bulan Ini ${fmtIdr(m.receivable)}`
        );
      }
    }

    if (data.topCustomers.length > 0) {
      lines.push('', `TOP CUSTOMER PERIODE ${detectedPeriodLabel.toUpperCase()}:`);
      data.topCustomers.slice(0, 10).forEach((c, idx) => {
        lines.push(
          `${idx + 1}. ${c.customerName} (${c.customerCode}) | ${c.invoiceCount} faktur | Omzet: ${fmtIdr(c.totalRevenue)} | Piutang Periode: ${fmtIdr(c.totalReceivable)}`
        );
      });
    }

    if (data.topItems.length > 0) {
      lines.push('', `TOP BARANG TERLARIS PERIODE ${detectedPeriodLabel.toUpperCase()} (m5_si_detail):`);
      data.topItems.slice(0, 10).forEach((it, idx) => {
        lines.push(
          `${idx + 1}. [${it.itemCode}] ${it.itemName} | Terjual: ${it.totalQty.toLocaleString('id-ID')} ${it.unit} (${it.invoiceCount} faktur) | Nilai: ${fmtIdr(it.totalValue)}`
        );
      });
    }

    if (isSpecificPeriod) {
      lines.push(
        '',
        `DAFTAR FAKTUR BELUM LUNAS KHUSUS PERIODE ${detectedPeriodLabel.toUpperCase()} (${periodRangeText}) — ${periodUnpaidInvoices.length} faktur (Total: ${fmtIdr(periodUnpaidTotal)}):`
      );
      if (periodUnpaidInvoices.length === 0) {
        lines.push(`(Seluruh faktur pada periode ${detectedPeriodLabel} sudah lunas / Rp 0 piutang.)`);
      } else {
        periodUnpaidInvoices.slice(0, 25).forEach((inv, idx) => {
          lines.push(
            `${idx + 1}. ${inv.docNo} | Tgl: ${inv.date} | JT: ${inv.dueDate || '-'}${inv.isOverdue ? ' [OVERDUE]' : ''} | Customer: ${inv.customerName} | Total: ${fmtIdr(inv.total)} | Sisa Piutang: ${fmtIdr(inv.balance)} | Status: ${inv.statusLabel}`
          );
        });
      }

      if (priorUnpaidInvoices.length > 0) {
        const priorTotal = priorUnpaidInvoices.reduce((s, inv) => s + Number(inv.balance || 0), 0);
        lines.push(
          '',
          `CATATAN TERPISAH — PIUTANG CARRY-OVER DARI BULAN SEBELUM ${effectiveFrom} (${priorUnpaidInvoices.length} faktur, Total: ${fmtIdr(priorTotal)} — JANGAN dicampur ke total ${detectedPeriodLabel}):`
        );
        priorUnpaidInvoices.slice(0, 15).forEach((inv, idx) => {
          lines.push(
            `${idx + 1}. ${inv.docNo} | Bulan: ${inv.date.slice(0, 7)} | Tgl: ${inv.date}${inv.isCarryOver ? ' [CARRY-OVER < MAR 2026]' : ''} | JT: ${inv.dueDate || '-'}${inv.isOverdue ? ' [OVERDUE]' : ''} | Customer: ${inv.customerName} | Sisa Piutang: ${fmtIdr(inv.balance)}`
          );
        });
      }
    } else if (allUnpaidSorted.length > 0) {
      lines.push(
        '',
        'DAFTAR FAKTUR BELUM LUNAS BERURUTAN KRONOLOGIS PER BULAN (TERMASUK CARRY-OVER < MAR 2026):'
      );
      allUnpaidSorted.slice(0, 30).forEach((inv, idx) => {
        lines.push(
          `${idx + 1}. [${inv.date.slice(0, 7)}] ${inv.docNo} | Tgl: ${inv.date}${inv.isCarryOver ? ' [CARRY-OVER < MAR 2026]' : ''} | JT: ${inv.dueDate || '-'}${inv.isOverdue ? ' [OVERDUE]' : ''} | Customer: ${inv.customerName} | Total: ${fmtIdr(inv.total)} | Sisa Piutang: ${fmtIdr(inv.balance)} | Status: ${inv.statusLabel}`
        );
      });
    }

    const salesDetailCap = isSpecificPeriod ? 60 : 30;

    if (data.invoices.length > 0) {
      const shownInv = data.invoices.slice(0, salesDetailCap);
      const newestDate = shownInv[0]?.date || '-';
      const oldestDate = shownInv[shownInv.length - 1]?.date || '-';
      lines.push(
        '',
        `DAFTAR FAKTUR PENJUALAN PALING BARU — MENAMPILKAN ${shownInv.length} BARIS TERBARU DARI TOTAL ${data.kpi.invoiceCount.toLocaleString('id-ID')} FAKTUR PERIODE ${detectedPeriodLabel.toUpperCase()} (m5_si · rentang sampel: ${oldestDate} s/d ${newestDate}):`
      );
      shownInv.forEach((inv, idx) => {
        lines.push(
          `${idx + 1}. ${inv.docNo} | Tgl: ${inv.date} | Customer: ${inv.customerName} | Sales: ${inv.salesmanName} | Total: ${fmtIdr(inv.total)} | ${inv.isPaid ? 'Lunas' : `Sisa ${fmtIdr(inv.balance)}`} | Status: ${inv.statusLabel}`
        );
      });
    }

    if (data.salesOrders.length > 0) {
      const shownSo = data.salesOrders.slice(0, salesDetailCap);
      const newestSoDate = shownSo[0]?.date || '-';
      const oldestSoDate = shownSo[shownSo.length - 1]?.date || '-';
      lines.push(
        '',
        `DAFTAR SALES ORDER PALING BARU — MENAMPILKAN ${shownSo.length} BARIS TERBARU DARI TOTAL ${data.kpi.soCount.toLocaleString('id-ID')} SO (Outstanding belum DO: ${data.kpi.soOutstandingCount.toLocaleString('id-ID')} SO) PERIODE ${detectedPeriodLabel.toUpperCase()} (m5_so · rentang sampel: ${oldestSoDate} s/d ${newestSoDate}):`
      );
      shownSo.forEach((so, idx) => {
        lines.push(
          `${idx + 1}. ${so.docNo} | Tgl: ${so.date} | Kirim: ${so.shipDate || '-'} | Customer: ${so.customerName} | Total: ${fmtIdr(so.total)} | DO: ${so.statusDo ? 'Sudah' : 'Belum'} | Status: ${so.statusLabel}`
        );
      });
      if (data.kpi.soCount > shownSo.length) {
        lines.push(
          `CATATAN WAJIB SAMPEL SO TERBARU: Tabel di atas hanya memuat ${shownSo.length} SO paling baru dari total ${data.kpi.soCount.toLocaleString('id-ID')} SO pada periode ${detectedPeriodLabel}. WAJIB infokan kepada pengguna bahwa daftar ini adalah SO paling baru, dan jika ingin melihat SO pada bulan/periode tertentu silakan sebutkan bulannya.`
        );
      }
    }

    if (data.deliveryOrders.length > 0) {
      const shownDo = data.deliveryOrders.slice(0, isSpecificPeriod ? 40 : 25);
      lines.push(
        '',
        `DAFTAR DELIVERY ORDER / SURAT JALAN PALING BARU — MENAMPILKAN ${shownDo.length} BARIS TERBARU DARI TOTAL ${data.kpi.doCount.toLocaleString('id-ID')} DO PERIODE ${detectedPeriodLabel.toUpperCase()} (m5_do):`
      );
      shownDo.forEach((d, idx) => {
        lines.push(
          `${idx + 1}. ${d.docNo} | Tgl: ${d.date} | Customer: ${d.customerName} | Gudang: ${d.warehouse} | Ekspedisi: ${d.expedition} | Total: ${fmtIdr(d.total)} | Status: ${d.statusLabel}`
        );
      });
    }

    if (data.salesReturns.length > 0) {
      lines.push('', 'DAFTAR RETUR PENJUALAN TERBARU (>= MARET 2026, m5_sr):');
      data.salesReturns.slice(0, 10).forEach((sr, idx) => {
        lines.push(
          `${idx + 1}. ${sr.docNo} | Tgl: ${sr.date} | Customer: ${sr.customerName} | Total Retur: ${fmtIdr(sr.total)} | Status: ${sr.statusLabel}`
        );
      });
    }

    return {
      configured: true,
      connected: true,
      totalRows: data.kpi.invoiceCount + data.kpi.soCount + data.kpi.unpaidInvoiceCount,
      matchedCount: broadenedFallback ? 0 : data.invoices.length + data.unpaidInvoices.length + data.salesOrders.length,
      summaryText: lines.join('\n'),
    };
  } catch (err) {
    return {
      configured: true,
      connected: false,
      totalRows: 0,
      matchedCount: 0,
      summaryText: [
        'STATUS KONEKSI MODUL SALES ERP (m5_*): GAGAL TERHUBUNG.',
        `Pesan diagnostik: ${formatMysqlError(err)}`,
        'Pastikan skrip bridge lokal erp-mysql-bridge.mjs versi terbaru (v3) sudah diunduh dan dijalankan di PC lokal Anda.',
      ].join('\n'),
    };
  }
}

export async function buildErpFinanceAiContext(
  question: string,
  history: { role: 'user' | 'assistant'; content: string }[] = []
): Promise<ErpStockAiContext> {
  if (!isErpMysqlConfigured()) {
    return {
      configured: false,
      connected: false,
      totalRows: 0,
      matchedCount: 0,
      summaryText: [
        'STATUS KONEKSI MYSQL ERP: BELUM DIKONFIGURASI.',
        'Arahkan pengguna ke menu "ERP Live" untuk menghubungkan bridge MySQL lokal.',
      ].join('\n'),
    };
  }

  try {
    const {
      search,
      dateFrom,
      dateTo,
      isDefaultCurrentMonth,
      inheritedFromHistory,
      wantsMonthlyBreakdown,
      periodLabel: detectedPeriodLabel,
    } = extractFinanceQueryParams(question, history);
    const wib = getCurrentMonthRangeWib();
    let data = await queryErpFinanceData({ search, dateFrom, dateTo });
    let broadenedFallback = false;
    if (data.pnlAccounts.length === 0 && data.balanceSheetAccounts.length === 0 && search) {
      broadenedFallback = true;
      data = await queryErpFinanceData({ dateFrom, dateTo });
    }

    const periodLabel = `${data.period.dateFrom || ACTIVE_ERP_CUTOFF_DATE} s/d ${data.period.dateTo || 'sekarang'}`;
    const lines: string[] = [
      '=== MODUL KEUANGAN / AKUNTANSI ERP (myerpplus: m1_coa + m2_transaction_journal + m5_si Aging) ===',
      `WAKTU PENGAMBILAN LIVE: ${new Date(data.fetchedAt).toLocaleString('id-ID')}`,
      `FOKUS PERIODE PERCAKAPAN: ${detectedPeriodLabel} (${periodLabel})${
        isDefaultCurrentMonth
          ? ` [OTOMATIS BULAN BERJALAN (${wib.monthLabel}) — karena pengguna tidak menyebut bulan lain]`
          : inheritedFromHistory
            ? ' [DIWARISI OTOMATIS DARI KONTEKS BULAN DI PERTANYAAN SEBELUMNYA]'
            : ''
      }`,
      ...(wantsMonthlyBreakdown
        ? [
            'INSTRUKSI FORMAT URUTAN BULAN: Pengguna meminta rincian BERURUTAN PER BULAN (kronologis). WAJIB tampilkan tabel tren bulanan terurut kronologis (2026-03, 2026-04, dst.) untuk masing-masing bulan, BUKAN hanya total keseluruhan.',
          ]
        : isDefaultCurrentMonth
          ? [
              `INSTRUKSI PERIODE DEFAULT = BULAN BERJALAN (${wib.monthLabel.toUpperCase()}): Data Laba Rugi / mutasi jurnal difokuskan otomatis ke bulan berjalan (${wib.monthLabel}, ${periodLabel}), sedangkan posisi Neraca/Hutang/Piutang tetap menampilkan saldo kumulatif. WAJIB infokan bahwa transaksi yang ditampilkan adalah bulan berjalan (${wib.monthLabel}) dan pengguna dapat menyebut bulan lain (mis. "${wib.prevMonthLabel}") atau "semua bulan".`,
            ]
          : []),
      `ATURAN CUT-OFF AKTIF: Transaksi di bawah ${data.cutoffDate} DIABAIKAN (Periode aktif: ${periodLabel}), KECUALI akun Hutang (2101*) & Piutang (1102* + m5_si belum lunas) yang tetap dihitung kumulatif penuh termasuk saldo carry-over < ${data.cutoffDate}.`,
      `CAKUPAN JURNAL DI DATABASE SAAT INI: Semua jurnal ${data.coverage.minDateAll || '-'} s/d ${data.coverage.maxDateAll || '-'} (${data.coverage.totalRowsAll.toLocaleString('id-ID')} baris) | Jurnal aktif >= ${data.cutoffDate}: ${data.coverage.totalRowsActive.toLocaleString('id-ID')} baris (${data.coverage.minDateActive || 'belum ada'} s/d ${data.coverage.maxDateActive || 'belum ada'}).`,
    ];

    if (data.coverage.totalRowsActive === 0) {
      lines.push(
        `CATATAN PENTING: Database lokal saat ini belum memiliki baris jurnal m2_transaction_journal bertanggal >= ${data.cutoffDate} (tanggal jurnal terakhir: ${data.coverage.maxDateAll || '-'}). Karena itu Laba Rugi periode >= Maret 2026 bernilai Rp 0, sedangkan saldo Hutang (AP) & Piutang (AR) tetap tampil penuh dari carry-over.`
      );
    }
    if (data.coverage.anomalyCount > 0) {
      lines.push(
        `PERINGATAN ANOMALI DATA: Terdeteksi ${data.coverage.anomalyCount} akun dengan nilai overflow ekstrem (>= 10^14) yang otomatis dikecualikan dari penjumlahan KPI.`
      );
    }

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

    lines.push(
      '',
      `RINGKASAN LABA RUGI (PERIODE ${periodLabel} · SISTEM PERSEDIAAN PERIODIK):`,
      `- CATATAN AKUNTANSI NILAI PERSEDIAAN & GUDANG INTRANSIT: Laporan Nilai Persediaan (Neraca), HPP/COGS, dan Laba Rugi TETAP menyertakan nilai barang di Gudang Intransit secara akuntansi hingga Sales Invoice (SI) diinput (berbeda dengan Stok Fisik/Tersedia di halaman stok yang mengecualikan Gudang Intransit).`,
      `- Pendapatan Usaha (4*): ${fmtIdr(data.kpi.revenue)}`,
      `- Total COGS / HPP (5*): ${fmtIdr(data.kpi.cogs)} [Material & Pembelian 51*-52*: ${fmtIdr(cogsMat)} (Opening Balance 520101*: ${fmtIdr(cogsOpen)}, Closing Balance 520102*: ${fmtIdr(cogsClose)}) | Labour Expense 53*: ${fmtIdr(cogsLab)} | Other COGS 55*: ${fmtIdr(cogsOth)}]`,
      ...(data.kpi.revenue > 0 && !data.kpi.hasOpeningClosingInput
        ? [
            '- CATATAN SISTEM PERIODIK: Akun Opening/Closing Balance (520101*/520102*) masih Rp 0 pada periode ini (user belum input saldo awal/akhir persediaan bulanan), sehingga HPP masih mencerminkan pembelian berjalan.',
          ]
        : []),
      `- Laba Kotor (Gross Profit): ${fmtIdr(data.kpi.grossProfit)} (Gross Margin ${data.kpi.grossMarginPct}%)`,
      `- Beban Operasional / OPEX (6*): ${fmtIdr(data.kpi.opex)}`,
      `- Laba Operasional (EBIT): ${fmtIdr(data.kpi.operatingProfit)}`,
      `- Pendapatan Lain-lain (7*): ${fmtIdr(data.kpi.otherIncome)} | Beban Lain-lain (8*): ${fmtIdr(data.kpi.otherExpense)}`,
      `- Laba / (Rugi) Sebelum Pajak (Before Tax): ${fmtIdr(pbt)}`,
      `- OCI (93*): ${fmtIdr(ociVal)} | Pajak Penghasilan / Deferred Tax (91*-92*): ${fmtIdr(incomeTaxVal)} | Total Taxation & Extraordinary: ${fmtIdr(taxExtra)}`,
      `- Laba / (Rugi) Bersih Setelah Pajak (After Tax): ${fmtIdr(data.kpi.netIncome)} (Net Margin ${data.kpi.netMarginPct}%)`,
      '',
      'RINGKASAN HUTANG & PIUTANG AKTIF (KUMULATIF PENUH, TERMASUK CARRY-OVER < MARET 2026):',
      `- Total Piutang Jurnal COA (1102*): ${fmtIdr(data.kpi.totalArJournal)} (Carry-Over < Mar 2026: ${fmtIdr(data.kpi.totalArCarryOver)} | Mutasi >= Mar 2026: ${fmtIdr(data.kpi.totalArPeriod)})`,
      `- Total Piutang Faktur Belum Lunas (m5_si): ${fmtIdr(data.kpi.arUnpaidInvoiceTotal)} (${data.kpi.arUnpaidInvoiceCount} faktur | Overdue: ${data.kpi.arOverdueCount} faktur senilai ${fmtIdr(data.kpi.arOverdueTotal)} | Carry-over < Mar 2026: ${data.arAging.carryOverCount} faktur senilai ${fmtIdr(data.arAging.carryOverAmount)})`,
      `- Aging Piutang m5_si: Belum JT ${fmtIdr(data.arAging.current.amount)} (${data.arAging.current.count}) | 1-30 hr ${fmtIdr(data.arAging.days1to30.amount)} (${data.arAging.days1to30.count}) | 31-60 hr ${fmtIdr(data.arAging.days31to60.amount)} (${data.arAging.days31to60.count}) | 61-90 hr ${fmtIdr(data.arAging.days61to90.amount)} (${data.arAging.days61to90.count}) | >90 hr ${fmtIdr(data.arAging.over90.amount)} (${data.arAging.over90.count})`,
      `- Total Hutang Jurnal COA (2101*): ${fmtIdr(data.kpi.totalApJournal)} (Carry-Over < Mar 2026: ${fmtIdr(data.kpi.totalApCarryOver)} | Mutasi >= Mar 2026: ${fmtIdr(data.kpi.totalApPeriod)})`
    );

    if (data.monthlyPnl.length > 0) {
      lines.push('', 'TREN LABA RUGI BULANAN (>= MARET 2026):');
      for (const m of data.monthlyPnl) {
        lines.push(
          `- ${m.month}: Revenue ${fmtIdr(m.revenue)} | HPP ${fmtIdr(m.cogs)} | Gross Profit ${fmtIdr(m.grossProfit)} | OPEX ${fmtIdr(m.opex)} | Net Income ${fmtIdr(m.netIncome)}`
        );
      }
    }

    if (data.arAccounts.length > 0) {
      lines.push('', 'RINCIAN AKUN PIUTANG (1102*, KUMULATIF):');
      for (const a of data.arAccounts) {
        lines.push(
          `- ${a.accountNo} ${a.accountName}: Saldo ${fmtIdr(a.balance)} (Carry-Over < Mar: ${fmtIdr(a.carryOverBalance)} | Mutasi >= Mar: ${fmtIdr(a.periodBalance)})`
        );
      }
    }

    if (data.apAccounts.length > 0) {
      lines.push('', 'RINCIAN AKUN HUTANG (2101*, KUMULATIF):');
      for (const a of data.apAccounts) {
        lines.push(
          `- ${a.accountNo} ${a.accountName}: Saldo ${fmtIdr(a.balance)} (Carry-Over < Mar: ${fmtIdr(a.carryOverBalance)} | Mutasi >= Mar: ${fmtIdr(a.periodBalance)})`
        );
      }
    }

    if (data.topArContacts.length > 0) {
      lines.push('', 'TOP KONTAK SALDO PIUTANG (1102*, KUMULATIF):');
      data.topArContacts.slice(0, 10).forEach((c, idx) => {
        lines.push(
          `${idx + 1}. ${c.contactName} (${c.contactCode}) | Total: ${fmtIdr(c.totalBalance)} (Carry-Over: ${fmtIdr(c.carryOverBalance)} | >= Mar: ${fmtIdr(c.periodBalance)})`
        );
      });
    }

    if (data.topApContacts.length > 0) {
      lines.push('', 'TOP KONTAK SALDO HUTANG (2101*, KUMULATIF):');
      data.topApContacts.slice(0, 10).forEach((c, idx) => {
        lines.push(
          `${idx + 1}. ${c.contactName} (${c.contactCode}) | Total: ${fmtIdr(c.totalBalance)} (Carry-Over: ${fmtIdr(c.carryOverBalance)} | >= Mar: ${fmtIdr(c.periodBalance)})`
        );
      });
    }

    if (data.pnlAccounts.length > 0) {
      lines.push('', 'TOP AKUN LABA RUGI (>= MARET 2026):');
      [...data.pnlAccounts]
        .filter((a) => !a.hasAnomaly)
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
        .slice(0, 20)
        .forEach((a) => {
          lines.push(`- [${a.section}] ${a.accountNo} ${a.accountName}: ${fmtIdr(a.amount)}`);
        });
    }

    return {
      configured: true,
      connected: true,
      totalRows: data.coverage.totalRowsActive + data.arAccounts.length + data.apAccounts.length,
      matchedCount: broadenedFallback ? 0 : data.pnlAccounts.length + data.balanceSheetAccounts.length,
      summaryText: lines.join('\n'),
    };
  } catch (err) {
    return {
      configured: true,
      connected: false,
      totalRows: 0,
      matchedCount: 0,
      summaryText: [
        'STATUS KONEKSI MODUL KEUANGAN ERP (m2_*): GAGAL TERHUBUNG.',
        `Pesan diagnostik: ${formatMysqlError(err)}`,
        'Pastikan skrip bridge lokal erp-mysql-bridge.mjs versi terbaru (v3 yang mendukung endpoint /finance) sudah diunduh dan dijalankan di PC lokal Anda.',
      ].join('\n'),
    };
  }
}

const ASSET_QUERY_STOPWORDS = new Set([
  ...FINANCE_QUERY_STOPWORDS,
  'aset', 'asset', 'tetap', 'fixed', 'buku', 'book', 'value', 'nbv', 'umur', 'ekonomis',
  'masa', 'manfaat', 'penyusutan', 'depresiasi', 'akumulasi', 'perolehan', 'residu',
  'm7_asset', 'dispose', 'disposed', 'habis', 'disusutkan', 'inventaris', 'perusahaan',
  'kategori', 'daftar', 'rincian', 'tampilkan', 'berapa', 'sisa', 'oli', 'stnk', 'kir',
  'servis', 'maintenance', 'jadwal', 'batas', 'waktu', 'tanggal', 'kosong',
]);

function formatLifeMonthsId(months: number): string {
  if (!months || months <= 0) return '0 bln';
  const yrs = Math.floor(months / 12);
  const rem = months % 12;
  if (yrs > 0 && rem > 0) return `${yrs} thn ${rem} bln (${months} bln)`;
  if (yrs > 0) return `${yrs} thn (${months} bln)`;
  return `${rem} bln`;
}

export async function buildErpAssetsAiContext(question: string): Promise<ErpStockAiContext> {
  if (!isErpMysqlConfigured()) {
    return {
      configured: false,
      connected: false,
      totalRows: 0,
      matchedCount: 0,
      summaryText: [
        'STATUS KONEKSI MODUL ASET TETAP ERP (m7_asset): BELUM DIKONFIGURASI.',
        'Arahkan pengguna ke menu "ERP Live" atau "Aset & Maintenance" untuk menghubungkan bridge MySQL lokal.',
      ].join('\n'),
    };
  }

  try {
    const lower = question.toLowerCase();
    const tokens = lower
      .replace(/[^a-z0-9\-_/.\s]/g, ' ')
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2 && !ASSET_QUERY_STOPWORDS.has(t));
    const search = tokens.slice(0, 3).join(' ');
    const includeDisposed = /\b(dispose|disposed|dihapus|penghapusan|dijual)\b/i.test(lower);

    let data = await queryErpAssetsData({ search, includeDisposed, limit: 120 });
    let broadenedFallback = false;
    if (data.items.length === 0 && search) {
      broadenedFallback = true;
      data = await queryErpAssetsData({ includeDisposed, limit: 120 });
    }

    const lines: string[] = [
      `=== MODUL ASET TETAP & PENYUSUTAN ERP (myerpplus: ${data.sourceTable}) ===`,
      `WAKTU PENGAMBILAN LIVE: ${new Date(data.fetchedAt).toLocaleString('id-ID')}`,
      'CATATAN JADWAL OPERASIONAL: Database ERP menyimpan data akuntansi aset tetap (Nilai Perolehan, Umur Ekonomis, Akumulasi Penyusutan, Sisa Nilai Buku). Tanggal batas waktu operasional seperti ganti oli, pajak STNK, dan uji KIR dikosongkan secara default dari ERP dan hanya terisi jika diinput manual pada modul Jadwal Maintenance.',
      '',
      'RINGKASAN KPI ASET TETAP AKTIF (NON-DISPOSE):',
      `- Total Aset Tetap Aktif: ${data.kpi.totalAssets.toLocaleString('id-ID')} entri (${data.kpi.totalQty.toLocaleString('id-ID')} unit) | Dispose: ${data.kpi.disposedCount.toLocaleString('id-ID')} entri`,
      `- Total Nilai Perolehan: ${fmtIdr(data.kpi.totalAcquisitionCost)}`,
      `- Total Akumulasi Penyusutan: ${fmtIdr(data.kpi.totalAccumulatedDepreciation)}`,
      `- Total Sisa Nilai Buku (Net Book Value): ${fmtIdr(data.kpi.totalNetBookValue)}`,
      `- Total Beban Penyusutan / Bulan (aset aktif belum habis disusutkan): ${fmtIdr(data.kpi.totalMonthlyDepreciation)}`,
      `- Aset Habis Disusutkan (Nilai Buku = Residu/Rp 0): ${data.kpi.fullyDepreciatedCount} aset | Sisa Umur <= 12 Bulan: ${data.kpi.expiringWithin12MonthsCount} aset | Terklasifikasi Kendaraan: ${data.kpi.vehicleCount} aset`,
    ];

    if (data.byCategory.length > 0) {
      lines.push('', 'REKAP ASET TETAP PER KATEGORI ERP:');
      data.byCategory.forEach((c, idx) => {
        lines.push(
          `${idx + 1}. ${c.categoryName} (${c.mappedCategory}) | ${c.assetCount} aset (${c.totalQty} unit) | Perolehan: ${fmtIdr(c.acquisitionCost)} | Akum. Susut: ${fmtIdr(c.accumulatedDepreciation)} | Sisa Nilai Buku: ${fmtIdr(c.netBookValue)} | Susut/Bln: ${fmtIdr(c.monthlyDepreciation)}`
        );
      });
    }

    if (search) {
      lines.push(
        '',
        broadenedFallback
          ? `FILTER KATA KUNCI "${search}": Tidak ditemukan kecocokan langsung; menampilkan daftar aset aktif berdasarkan sisa nilai buku terbesar.`
          : `HASIL FILTER KATA KUNCI "${search}": ${data.totalMatched} aset ditemukan (menampilkan ${Math.min(data.items.length, 60)} aset).`
      );
    }

    const detailLimit = search ? 40 : 25;
    const sortedItems = [...data.items]
      .sort((a, b) => b.netBookValue - a.netBookValue || a.assetCode.localeCompare(b.assetCode))
      .slice(0, detailLimit);

    if (sortedItems.length > 0) {
      lines.push('', `RINCIAN TOP ${sortedItems.length} ASET TETAP ERP (KODE | NAMA | KATEGORI | TGL BELI | UMUR & SISA | PEROLEHAN | AKUM. SUSUT | SISA NILAI BUKU):`);
      sortedItems.forEach((a, idx) => {
        const lifeStr =
          a.usefulLifeMonths > 0
            ? `${formatLifeMonthsId(a.usefulLifeMonths)} · Susut ke-${a.depreciatedMonths} bln · Sisa ${formatLifeMonthsId(a.remainingLifeMonths)}`
            : 'Tidak disusutkan';
        lines.push(
          `${idx + 1}. [${a.assetCode}] ${a.name} | Kat: ${a.categoryName}${a.serialOrPlate ? ` | No/Plat: ${a.serialOrPlate}` : ''} | Tgl Beli: ${a.purchaseDate || '-'} | Umur Ekonomis: ${lifeStr} | Perolehan: ${fmtIdr(a.acquisitionCost)} | Akum. Susut: ${fmtIdr(a.accumulatedDepreciation)} | Sisa Nilai Buku: ${fmtIdr(a.netBookValue)} | Susut/Bln: ${fmtIdr(a.monthlyDepreciation)}${a.isDisposed ? ' [DISPOSE]' : ''}`
        );
      });
    }

    return {
      configured: true,
      connected: true,
      totalRows: data.kpi.totalAssets,
      matchedCount: broadenedFallback ? 0 : data.totalMatched,
      summaryText: lines.join('\n'),
    };
  } catch (err) {
    return {
      configured: true,
      connected: false,
      totalRows: 0,
      matchedCount: 0,
      summaryText: [
        'STATUS KONEKSI MODUL ASET TETAP ERP (m7_asset): GAGAL TERHUBUNG.',
        `Pesan diagnostik: ${formatMysqlError(err)}`,
        'Pastikan skrip bridge lokal erp-mysql-bridge.mjs versi terbaru (v4 yang mendukung endpoint /assets) sudah diunduh dan dijalankan di PC lokal Anda.',
      ].join('\n'),
    };
  }
}

export async function buildErpPurchasingAiContext(
  question: string,
  history: { role: 'user' | 'assistant'; content: string }[] = []
): Promise<ErpStockAiContext> {
  if (!isErpMysqlConfigured()) {
    return {
      configured: false,
      connected: false,
      totalRows: 0,
      matchedCount: 0,
      summaryText: [
        'STATUS KONEKSI MODUL PURCHASING ERP (m4_*): BELUM DIKONFIGURASI.',
        'Arahkan pengguna ke menu "ERP Live" untuk menghubungkan bridge MySQL lokal.',
      ].join('\n'),
    };
  }

  try {
    const {
      search,
      dateFrom,
      dateTo,
      isSpecificPeriod,
      isDefaultCurrentMonth,
      inheritedFromHistory,
      wantsMonthlyBreakdown,
      periodLabel: detectedPeriodLabel,
    } = extractPurchasingQueryParams(question, history);
    const wib = getCurrentMonthRangeWib();

    let data = await queryErpPurchasingData({
      search,
      dateFrom,
      dateTo,
      limit: 100,
    });

    let broadenedFallback = false;
    if (
      data.kpi.riInvoiceCount === 0 &&
      data.kpi.poCount === 0 &&
      data.kpi.apUnpaidInvoiceCount === 0 &&
      search
    ) {
      broadenedFallback = true;
      data = await queryErpPurchasingData({
        dateFrom,
        dateTo,
        limit: 100,
      });
    }

    const effectiveFrom = data.period.dateFrom || ACTIVE_ERP_CUTOFF_DATE;
    const effectiveTo = data.period.dateTo || '';
    const periodRangeText = `${effectiveFrom} s/d ${effectiveTo || 'sekarang'}`;

    const lines: string[] = [
      '=== MODUL PURCHASING / PEMBELIAN ERP (myerpplus: 100% REKONSILIASI LAPORAN KEUANGAN m2_transaction_journal + SUB-LEDGER m4_ri, m4_po, m4_grn, m4_pr, m4_prt, m4_vp) ===',
      `WAKTU PENGAMBILAN LIVE: ${new Date(data.fetchedAt).toLocaleString('id-ID')}`,
      `FOKUS PERIODE PERCAKAPAN: ${detectedPeriodLabel} (${periodRangeText})${
        isDefaultCurrentMonth
          ? ` [OTOMATIS BULAN BERJALAN (${wib.monthLabel}) — karena pengguna tidak menyebut bulan lain]`
          : inheritedFromHistory
            ? ' [DIWARISI OTOMATIS DARI KONTEKS BULAN DI PERTANYAAN SEBELUMNYA]'
            : ''
      }`,
      'PRINSIP AKURASI 100% LAPORAN KEUANGAN: Angka total Pembelian Bersih, Purchase Domestic (520105.001), Purchase Import (520104.001), Purchase Return (510103.001), Purchase Discount (510102.001), dan Beban COGS Pembelian Lainnya (520103/520106-520109) diambil LANGSUNG dari Buku Besar m2_transaction_journal sehingga cocok 100,00% hingga sen dengan Laporan Keuangan (Laba Rugi). Rincian operasional supplier, faktur (m4_ri), PO (m4_po), GRN (m4_grn), PR (m4_pr), dan Aging Hutang disajikan dari sub-ledger m4_*.',
      `ATURAN CUT-OFF: Pembelian/PO/GRN/PR aktif mulai >= ${data.cutoffDate}. Hutang Supplier / AP (COA 210101*/210103* & faktur m4_ri belum lunas) bersifat KUMULATIF PENUH termasuk carry-over < ${data.cutoffDate}.`,
    ];

    if (wantsMonthlyBreakdown) {
      lines.push(
        'INSTRUKSI FORMAT URUTAN BULAN: Pengguna meminta rincian BERURUTAN PER BULAN (kronologis). WAJIB sajikan tabel bulanan kronologis (2026-03, 2026-04, dst.) dengan angka Laporan Keuangan (Domestic, Import, Return/Disc, Net Purchase LK) dan pembanding DPP Sub-Ledger m4_ri.'
      );
    } else if (isDefaultCurrentMonth) {
      lines.push(
        `INSTRUKSI PERIODE DEFAULT = BULAN BERJALAN (${wib.monthLabel.toUpperCase()}): Seluruh transaksi purchasing (PO, PR, GRN, RI, Retur, Pembelian LK) difokuskan otomatis ke bulan berjalan (${wib.monthLabel}, ${periodRangeText}). WAJIB infokan secara jelas kepada pengguna bahwa data yang ditampilkan adalah transaksi bulan berjalan (${wib.monthLabel}), dan pengguna dapat menyebutkan bulan lain (misalnya "${wib.prevMonthLabel}") atau "semua bulan" jika ingin melihat periode berbeda.`
      );
    } else if (isSpecificPeriod) {
      lines.push(
        `INSTRUKSI FOKUS PERIODE ${detectedPeriodLabel.toUpperCase()}: Tampilkan angka pembelian & daftar PO/PR/GRN/RI khusus periode ${detectedPeriodLabel} (${periodRangeText}) terlebih dahulu sesuai Laporan Keuangan.`
      );
    }

    if (search) {
      lines.push(
        broadenedFallback
          ? `FILTER KATA KUNCI "${search}": Tidak ditemukan kecocokan langsung pada m4_*; menampilkan ringkasan umum periode tersebut.`
          : `FILTER KATA KUNCI SUB-LEDGER: "${search}" (Catatan: angka Jurnal Laporan Keuangan tetap mencerminkan total COA periode; filter berlaku untuk daftar faktur/PO/supplier m4_*).`
      );
    }

    lines.push(
      '',
      `KPI RESMI LAPORAN KEUANGAN — PEMBELIAN PERIODE ${detectedPeriodLabel.toUpperCase()} (${periodRangeText}):`,
      `- Purchase Domestic (COA 520105*): ${fmtIdrExact(data.kpi.glPurchaseDomestic)}`,
      `- Purchase Import (COA 520104*): ${fmtIdrExact(data.kpi.glPurchaseImport)}`,
      `- Purchase Return (COA 510103*): ${fmtIdrExact(data.kpi.glPurchaseReturn)}`,
      `- Purchase Discount (COA 510102*): ${fmtIdrExact(data.kpi.glPurchaseDiscount)}`,
      `- TOTAL PEMBELIAN BERSIH / NET PURCHASES (100% SAMA DENGAN LAPORAN KEUANGAN): ${fmtIdrExact(data.kpi.glNetPurchase)}`,
      `- Beban COGS Pembelian Terkait (520103 Dev Cost, 520106 Import/Transport, 520107 Painting, 520108 Rebate, 520109 Tooling): ${fmtIdrExact(data.kpi.glOtherCogsCost)}`,
      `- Total Pembelian + Beban COGS Pembelian: ${fmtIdrExact(data.kpi.glTotalPurchasingCogs)}`,
      '',
      'RINGKASAN SUB-LEDGER OPERASIONAL PURCHASING (m4_*):',
      `- Faktur Pembelian / Receiving Invoice (m4_ri): ${data.kpi.riInvoiceCount.toLocaleString('id-ID')} faktur (Domestic: ${data.kpi.riDomesticCount} | Import: ${data.kpi.riImportCount}) | DPP IDR: ${fmtIdrExact(data.kpi.riDppIdr)} | PPN/Pajak IDR: ${fmtIdrExact(data.kpi.riTaxIdr)} | Total Transaksi IDR: ${fmtIdrExact(data.kpi.riTotalIdr)} | Terbayar: ${fmtIdrExact(data.kpi.riPaidIdr)}`,
      `- Selisih Rekonsiliasi Jurnal LK vs DPP m4_ri (mis. jurnal penyesuaian/opening summary Mar 2026): ${fmtIdrExact(data.kpi.varianceGlVsRiDpp)}`,
      `- Purchase Order (m4_po): ${data.kpi.poCount.toLocaleString('id-ID')} PO senilai ${fmtIdr(data.kpi.poTotalIdr)} | PO Outstanding (HANYA Approved & In Progress; TIDAK termasuk Need Approve & Draft): ${data.kpi.poOutstandingCount.toLocaleString('id-ID')} PO`,
      `- Goods Receipt Note (m4_grn): ${data.kpi.grnCount.toLocaleString('id-ID')} dokumen | Purchase Request (m4_pr): ${data.kpi.prCount.toLocaleString('id-ID')} PR | PR Outstanding (HANYA Approved & In Progress; TIDAK termasuk Need Approve & Draft): ${data.kpi.prOutstandingCount.toLocaleString('id-ID')} PR`,
      '- ATURAN WAJIB OUTSTANDING PO/PR: Yang termasuk outstanding HANYA dokumen berstatus Approved (kode 2) dan In Progress (kode 3) yang belum close. Dokumen berstatus Need Approve, Draft, Revisi, Approve 1–4, Completed, atau Void/Batal TIDAK termasuk outstanding dan DILARANG dimasukkan ke daftar/tabel outstanding.',
      '- MAKNA OUTSTANDING (PENTING): PR Outstanding berstatus Approved berarti PR tersebut BELUM dijalankan ke transaksi berikutnya (PO belum dibuat sama sekali); PR berstatus In Progress berarti baru dibuat PO sebagian. PO Outstanding berstatus Approved berarti BELUM dijalankan ke GRN/RI sama sekali; PO In Progress berarti baru diproses GRN/RI sebagian. JANGAN pernah menyarankan "Cek status PO untuk PR ini" pada PR Outstanding berstatus Approved karena PO-nya memang belum dibuat.',
      `- Retur Pembelian Sub-Ledger (m4_prt): ${data.kpi.returnCountSub} dokumen senilai ${fmtIdr(data.kpi.returnTotalSubIdr)} | Vendor Payment (m4_vp): ${data.kpi.vpCount} pembayaran senilai ${fmtIdr(data.kpi.vpTotalIdr)}`,
      '',
      'HUTANG SUPPLIER / ACCOUNTS PAYABLE (KUMULATIF PENUH, TERMASUK CARRY-OVER < MARET 2026):',
      `- Total Hutang Jurnal COA (210101* & 210103*): ${fmtIdrExact(data.kpi.apJournalTotal)} (Carry-Over < Mar 2026: ${fmtIdrExact(data.kpi.apJournalCarryOver)} | Mutasi >= Mar 2026: ${fmtIdrExact(data.kpi.apJournalPeriod)})`,
      `- Total Hutang Sub-Ledger Faktur m4_ri Belum Lunas: ${fmtIdr(data.kpi.apSubLedgerTotalIdr)} (${data.kpi.apUnpaidInvoiceCount} faktur | Overdue: ${data.kpi.apOverdueInvoiceCount} faktur senilai ${fmtIdr(data.kpi.apOverdueAmountIdr)} | Carry-Over < Mar 2026: ${data.kpi.apCarryOverUnpaidCount} faktur senilai ${fmtIdr(data.kpi.apCarryOverPayableIdr)})`,
      `- Aging Hutang m4_ri: Belum JT ${fmtIdr(data.apAging.current.amount)} (${data.apAging.current.count}) | 1-30 hr ${fmtIdr(data.apAging.days1to30.amount)} (${data.apAging.days1to30.count}) | 31-60 hr ${fmtIdr(data.apAging.days31to60.amount)} (${data.apAging.days31to60.count}) | 61-90 hr ${fmtIdr(data.apAging.days61to90.amount)} (${data.apAging.days61to90.count}) | >90 hr ${fmtIdr(data.apAging.over90.amount)} (${data.apAging.over90.count})`
    );

    if (data.monthlyReconciliation.length > 0) {
      lines.push('', 'REKAP PEMBELIAN KRONOLOGIS PER BULAN (100% LAPORAN KEUANGAN vs SUB-LEDGER m4_ri):');
      for (const m of data.monthlyReconciliation) {
        lines.push(
          `- ${m.month}: Domestic (520105) ${fmtIdrExact(m.glDomestic)} | Import (520104) ${fmtIdrExact(m.glImport)} | Return/Disc ${fmtIdrExact(m.glReturn + m.glDiscount)} | NET PURCHASE LK ${fmtIdrExact(m.glNetPurchase)} | Sub-Ledger m4_ri: ${m.riInvoiceCount} faktur, DPP ${fmtIdrExact(m.riDppIdr)} (Selisih: ${fmtIdrExact(m.varianceVsRiDpp)})`
        );
      }
    }

    if (data.glPurchasingAccounts.length > 0) {
      lines.push('', 'RINCIAN AKUN COA PEMBELIAN & COGS TERKAIT (LAPORAN KEUANGAN):');
      for (const acc of data.glPurchasingAccounts) {
        lines.push(
          `- ${acc.accountNo} ${acc.accountName} (${acc.isCorePurchase ? 'Inti Pembelian' : 'Beban COGS Terkait'}): ${fmtIdrExact(acc.amount)} (${acc.entryCount} entri jurnal)`
        );
      }
    }

    if (data.topSuppliers.length > 0) {
      lines.push('', `TOP SUPPLIER PERIODE ${detectedPeriodLabel.toUpperCase()} (m4_ri):`);
      data.topSuppliers.slice(0, 12).forEach((s, idx) => {
        lines.push(
          `${idx + 1}. ${s.supplierName} (${s.supplierCode}) [${s.originType}] | ${s.invoiceCount} faktur | DPP: ${fmtIdr(s.totalDppIdr)} | Total Inc. PPN: ${fmtIdr(s.totalIdr)} | Sisa Hutang Periode: ${fmtIdr(s.totalPayableIdr)}`
        );
      });
    }

    if (data.topItems.length > 0) {
      lines.push('', `TOP BARANG DIBELI PERIODE ${detectedPeriodLabel.toUpperCase()} (m4_ri_detail):`);
      data.topItems.slice(0, 10).forEach((it, idx) => {
        lines.push(
          `${idx + 1}. [${it.itemCode}] ${it.itemName} | Qty: ${it.totalQty.toLocaleString('id-ID')} ${it.unit} (${it.invoiceCount} faktur) | Nilai IDR: ${fmtIdr(it.totalValueIdr)}`
        );
      });
    }

    const purchDetailCap = isSpecificPeriod ? 60 : 30;

    if (data.unpaidInvoices.length > 0) {
      const shownUnpaid = data.unpaidInvoices.slice(0, purchDetailCap);
      lines.push(
        '',
        `DAFTAR FAKTUR PEMBELIAN BELUM LUNAS / HUTANG SUPPLIER — MENAMPILKAN ${shownUnpaid.length} BARIS DARI TOTAL ${data.kpi.apUnpaidInvoiceCount.toLocaleString('id-ID')} FAKTUR BELUM LUNAS (m4_ri, URUT JATUH TEMPO):`
      );
      shownUnpaid.forEach((inv, idx) => {
        lines.push(
          `${idx + 1}. ${inv.docNo} | Tgl: ${inv.date}${inv.isCarryOver ? ' [CARRY-OVER < MAR 2026]' : ''} | JT: ${inv.dueDate || '-'}${inv.isOverdue ? ' [OVERDUE]' : ''} | Supplier: ${inv.supplierName} [${inv.originType}] | Total IDR: ${fmtIdr(inv.totalIdr)} | Sisa Hutang: ${fmtIdr(inv.balanceIdr)}`
        );
      });
    }

    const outstandingPos = data.purchaseOrders.filter(
      (po) => !po.isClosed && (po.statusCode === 2 || po.statusCode === 3)
    );
    if (outstandingPos.length > 0) {
      const shownPos = outstandingPos.slice(0, purchDetailCap);
      const totalPoOut = Math.max(data.kpi.poOutstandingCount, outstandingPos.length);
      const newestPoDate = shownPos[0]?.date || '-';
      const oldestPoDate = shownPos[shownPos.length - 1]?.date || '-';
      lines.push(
        '',
        `DAFTAR PURCHASE ORDER OUTSTANDING PALING BARU — MENAMPILKAN ${shownPos.length} BARIS TERBARU DARI TOTAL ${totalPoOut.toLocaleString('id-ID')} PO OUTSTANDING PADA PERIODE ${detectedPeriodLabel.toUpperCase()} (m4_po · rentang tgl sampel: ${oldestPoDate} s/d ${newestPoDate} · HANYA STATUS APPROVED & IN PROGRESS; NEED APPROVE & DRAFT SUDAH DIKECUALIKAN):`
      );
      shownPos.forEach((po, idx) => {
        const grnInfo =
          po.relatedGrns && po.relatedGrns.length > 0
            ? `GRN parsial: ${po.relatedGrns.map((g) => g.docNo).join(', ')}`
            : po.statusGrn
              ? 'Sudah sebagian'
              : 'Belum ada GRN (belum dijalankan ke transaksi berikutnya)';
        lines.push(
          `${idx + 1}. ${po.docNo} | Tgl: ${po.date} | Supplier: ${po.supplierName} [${po.originType}] | Total IDR: ${fmtIdr(po.totalIdr)} | Transaksi Berikutnya (GRN): ${grnInfo} | Status: ${po.statusLabel}`
        );
      });
      lines.push(
        `CATATAN WAJIB SAMPEL PO: Daftar di atas menampilkan ${shownPos.length} PO paling baru (tanggal ${oldestPoDate} s/d ${newestPoDate}) dari total ${totalPoOut.toLocaleString('id-ID')} PO outstanding pada periode ${detectedPeriodLabel}. WAJIB infokan secara jelas kepada pengguna bahwa data tersebut adalah PO ${isDefaultCurrentMonth ? `bulan berjalan (${wib.monthLabel})` : `periode ${detectedPeriodLabel}`}${shownPos.length < totalPoOut ? ` (menampilkan ${shownPos.length} PO paling baru dari total ${totalPoOut.toLocaleString('id-ID')} PO)` : ''}, dan beritahu pengguna bahwa jika ingin melihat PO untuk bulan lain (misalnya "PO bulan ${wib.prevMonthLabel}" atau "PO semua bulan") atau supplier tertentu, cukup sebutkan bulannya.`
      );
    } else {
      lines.push(
        '',
        `DAFTAR PURCHASE ORDER OUTSTANDING PERIODE ${detectedPeriodLabel.toUpperCase()} (m4_po): Tidak ada PO berstatus Approved atau In Progress pada periode ${detectedPeriodLabel} (total PO periode ini: ${data.kpi.poCount.toLocaleString('id-ID')}; PO berstatus Need Approve / Draft / Completed dikecualikan dari outstanding).${isDefaultCurrentMonth ? ` Infokan ke pengguna bahwa saat ini belum ada PO outstanding pada bulan berjalan (${wib.monthLabel}), dan tawarkan melihat bulan sebelumnya ("${wib.prevMonthLabel}") atau semua bulan.` : ''}`
      );
    }

    if (isSpecificPeriod && data.purchaseOrders.length > 0) {
      const shownAllMonthPos = data.purchaseOrders.slice(0, purchDetailCap);
      const newestDate = shownAllMonthPos[0]?.date || '-';
      const oldestDate = shownAllMonthPos[shownAllMonthPos.length - 1]?.date || '-';
      lines.push(
        '',
        `DAFTAR SELURUH PURCHASE ORDER (SEMUA STATUS) KHUSUS PERIODE ${detectedPeriodLabel.toUpperCase()} — MENAMPILKAN ${shownAllMonthPos.length} BARIS TERBARU DARI TOTAL ${data.kpi.poCount.toLocaleString('id-ID')} PO (m4_po · rentang tgl: ${oldestDate} s/d ${newestDate}):`
      );
      shownAllMonthPos.forEach((po, idx) => {
        lines.push(
          `${idx + 1}. ${po.docNo} | Tgl: ${po.date} | Supplier: ${po.supplierName} [${po.originType}] | Total IDR: ${fmtIdr(po.totalIdr)} | GRN: ${po.statusGrn ? 'Sudah/Sebagian' : 'Belum'} | Status: ${po.statusLabel}`
        );
      });
    }

    const outstandingPrs = data.purchaseRequests.filter(
      (pr) =>
        (pr.statusCode === 2 || pr.statusCode === 3) &&
        (pr.statusPo === 0 || pr.statusCode === 3)
    );
    if (outstandingPrs.length > 0) {
      const shownPrs = outstandingPrs.slice(0, purchDetailCap);
      const totalPrOut = Math.max(data.kpi.prOutstandingCount, outstandingPrs.length);
      const newestPrDate = shownPrs[0]?.date || '-';
      const oldestPrDate = shownPrs[shownPrs.length - 1]?.date || '-';
      lines.push(
        '',
        `DAFTAR PURCHASE REQUEST OUTSTANDING PALING BARU — MENAMPILKAN ${shownPrs.length} BARIS TERBARU DARI TOTAL ${totalPrOut.toLocaleString('id-ID')} PR OUTSTANDING PADA PERIODE ${detectedPeriodLabel.toUpperCase()} (m4_pr · rentang tgl sampel: ${oldestPrDate} s/d ${newestPrDate} · HANYA STATUS APPROVED & IN PROGRESS; BELUM DIPROSES PENUH KE PO):`
      );
      shownPrs.forEach((pr, idx) => {
        const poInfo =
          pr.relatedPos && pr.relatedPos.length > 0
            ? `PO parsial: ${pr.relatedPos.map((p) => p.docNo).join(', ')}`
            : 'Belum ada PO (belum dijalankan ke transaksi berikutnya)';
        lines.push(
          `${idx + 1}. ${pr.docNo} | Tgl: ${pr.date} | Dipakai: ${pr.neededDate || '-'} | Uraian: ${pr.description} | Gudang: ${pr.warehouse} | Estimasi IDR: ${fmtIdr(pr.totalIdr)} | Transaksi Berikutnya (PO): ${poInfo} | Status: ${pr.statusLabel}`
        );
      });
      lines.push(
        `CATATAN WAJIB SAMPEL PR: Daftar di atas menampilkan ${shownPrs.length} PR paling baru dari total ${totalPrOut.toLocaleString('id-ID')} PR outstanding pada periode ${detectedPeriodLabel}. WAJIB infokan bahwa data tersebut adalah PR ${isDefaultCurrentMonth ? `bulan berjalan (${wib.monthLabel})` : `periode ${detectedPeriodLabel}`} dan pengguna dapat menyebutkan bulan lain (misalnya "${wib.prevMonthLabel}") jika ingin melihat periode lain.`
      );
    } else {
      lines.push(
        '',
        `DAFTAR PURCHASE REQUEST OUTSTANDING PERIODE ${detectedPeriodLabel.toUpperCase()} (m4_pr): Tidak ada PR berstatus Approved atau In Progress yang belum diproses ke PO pada periode ${detectedPeriodLabel} (total PR periode ini: ${data.kpi.prCount.toLocaleString('id-ID')}).`
      );
    }

    return {
      configured: true,
      connected: true,
      totalRows: data.kpi.riInvoiceCount + data.kpi.poCount + data.kpi.apUnpaidInvoiceCount,
      matchedCount: broadenedFallback
        ? 0
        : data.invoices.length + data.unpaidInvoices.length + data.purchaseOrders.length,
      summaryText: lines.join('\n'),
    };
  } catch (err) {
    return {
      configured: true,
      connected: false,
      totalRows: 0,
      matchedCount: 0,
      summaryText: [
        'STATUS KONEKSI MODUL PURCHASING ERP (m4_*): GAGAL TERHUBUNG.',
        `Pesan diagnostik: ${formatMysqlError(err)}`,
        'Pastikan skrip bridge lokal erp-mysql-bridge.mjs versi terbaru (v5 yang mendukung endpoint /purchasing) sudah diunduh dan dijalankan di PC lokal Anda.',
      ].join('\n'),
    };
  }
}

const ERP_PAYMENT_INTENT_REGEX =
  /\b(pembayaran|bayar|vendor\s*payment|\bvp\b|pelunasan|pencairan|hutang|utang|\bap\b|payable|payables|transfer\s*supplier|kas\s*(dan|&)?\s*bank|saldo\s*kas|saldo\s*bank|rekening\s*perusahaan)\b/i;

export async function buildErpCombinedAiContext(
  question: string,
  history: { role: 'user' | 'assistant'; content: string }[] = [],
  allowedScopes?: AllowedAiDataScopes
): Promise<ErpStockAiContext> {
  const wantsStock = isErpStockQuery(question, history);
  const wantsSales = isErpSalesQuery(question, history);
  const wantsPurchasing = isErpPurchasingQuery(question, history);
  const wantsFinance = isErpFinanceQuery(question, history);
  const wantsAssets = isErpAssetsQuery(question, history);
  const wantsPayment = ERP_PAYMENT_INTENT_REGEX.test(question.trim());

  const noneSpecific =
    !wantsStock &&
    !wantsSales &&
    !wantsPurchasing &&
    !wantsFinance &&
    !wantsAssets &&
    !wantsPayment;

  const canStock = allowedScopes ? allowedScopes.stock : true;
  const canSales = allowedScopes ? allowedScopes.sales : true;
  const canPurchasing = allowedScopes ? allowedScopes.purchasing : true;
  const canPurchasingPayment = allowedScopes ? allowedScopes.purchasingPayment : true;
  const canFinance = allowedScopes ? allowedScopes.finance : true;
  const canAssets = allowedScopes ? allowedScopes.erpAssets : true;

  const deniedDomains: string[] = [];

  if (wantsPayment && !canPurchasingPayment && !canFinance) {
    deniedDomains.push('Pembayaran Supplier, Kas & Keuangan');
  }
  if (wantsFinance && !canFinance) {
    deniedDomains.push('Laporan Keuangan, Laba Rugi, Neraca & Jurnal (Finance)');
  }
  if (wantsPurchasing && !canPurchasing) {
    deniedDomains.push('Pembelian, PO, Faktur & Supplier (Purchasing)');
  }
  if (wantsSales && !canSales) {
    deniedDomains.push('Penjualan, SO, Faktur & Piutang (Sales)');
  }
  if (wantsStock && !canStock) {
    deniedDomains.push('Stok Gudang & Persediaan (Inventory)');
  }
  if (wantsAssets && !canAssets) {
    deniedDomains.push('Aset Tetap & Penyusutan ERP (Fixed Assets)');
  }

  // Server-side hard gate: NEVER query MySQL for any module the user's role cannot access
  const fetchStock = (wantsStock || noneSpecific) && canStock;
  const fetchSales = (wantsSales || noneSpecific) && canSales;
  const fetchPurchasing =
    (wantsPurchasing || noneSpecific) &&
    canPurchasing &&
    !(wantsPayment && !canPurchasingPayment);
  const fetchFinance = (wantsFinance || wantsPayment || noneSpecific) && canFinance;
  const fetchAssets = (wantsAssets || noneSpecific) && canAssets;

  if (
    noneSpecific &&
    allowedScopes &&
    !fetchStock &&
    !fetchSales &&
    !fetchPurchasing &&
    !fetchFinance &&
    !fetchAssets
  ) {
    deniedDomains.push('Data Live ERP');
  }

  const [assetsCtx, rawPurchasingCtx, financeCtx, salesCtx, stockCtx] = await Promise.all([
    fetchAssets ? buildErpAssetsAiContext(question) : Promise.resolve(null),
    fetchPurchasing ? buildErpPurchasingAiContext(question, history) : Promise.resolve(null),
    fetchFinance ? buildErpFinanceAiContext(question, history) : Promise.resolve(null),
    fetchSales ? buildErpSalesAiContext(question, history) : Promise.resolve(null),
    fetchStock ? buildErpStockAiContext(question) : Promise.resolve(null),
  ]);

  // If user can view basic Purchasing (PR/PO/GRN) but NOT Vendor Payment / AP, strip sensitive payment/AP lines
  let purchasingCtx = rawPurchasingCtx;
  if (purchasingCtx && purchasingCtx.summaryText && !canPurchasingPayment) {
    const filteredLines = purchasingCtx.summaryText
      .split('\n')
      .filter(
        (line) =>
          !/vendor\s*payment|pembayaran\s*supplier|hutang|aging\s*ap|\bm4_vp\b|unpaid\s*ap/i.test(
            line
          )
      );
    purchasingCtx = {
      ...purchasingCtx,
      summaryText: filteredLines.join('\n'),
    };
  }

  const contexts = [assetsCtx, purchasingCtx, financeCtx, salesCtx, stockCtx].filter(
    (c): c is ErpStockAiContext => Boolean(c && c.summaryText)
  );

  const uniqueDenied = Array.from(new Set(deniedDomains));

  if (contexts.length === 0) {
    return {
      configured: false,
      connected: false,
      totalRows: 0,
      matchedCount: 0,
      summaryText: '',
      deniedDomains: uniqueDenied,
    };
  }

  return {
    configured: contexts.some((c) => c.configured),
    connected: contexts.some((c) => c.connected),
    totalRows: contexts.reduce((sum, c) => sum + c.totalRows, 0),
    matchedCount: contexts.reduce((sum, c) => sum + c.matchedCount, 0),
    summaryText: contexts.map((c) => c.summaryText).join('\n\n'),
    deniedDomains: uniqueDenied,
  };
}

function normalizeWaPhoneServer(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  let n = digits;
  if (n.startsWith('00')) n = n.slice(2);
  if (n.startsWith('0')) n = `62${n.slice(1)}`;
  else if (n.startsWith('8') && n.length >= 9 && n.length <= 13) n = `62${n}`;
  if (n.length < 9 || n.length > 15) return '';
  return n;
}

export async function queryErpEmployees(params?: {
  search?: string;
  onlyActive?: boolean;
  includeAll?: boolean;
  limit?: number;
  bypassCache?: boolean;
}): Promise<ErpEmployeesQueryResult> {
  const search = (params?.search || '').trim();
  const onlyActive = params?.onlyActive !== false;
  const includeAll = Boolean(params?.includeAll);
  const limit = Math.max(1, Math.min(1000, Math.round(params?.limit || 500)));

  const cacheKey = `${search.toLowerCase()}|${onlyActive ? '1' : '0'}|${includeAll ? '1' : '0'}|${limit}`;
  if (!params?.bypassCache) {
    const cached = employeesQueryCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.data;
    }
  }

  const bridgeCfg = getErpBridgeConfig();
  if (bridgeCfg.configured) {
    const qs = new URLSearchParams();
    if (search) qs.set('q', search);
    qs.set('onlyActive', onlyActive ? '1' : '0');
    if (includeAll) qs.set('includeAll', '1');
    qs.set('limit', String(limit));
    let rawData = await fetchErpBridgeJson<ErpEmployeesQueryResult>(`/employees?${qs.toString()}`);

    // Backward-compatibility with already-running Bridge v6 that matched "Employee" instead of "K":
    // if Bridge returned 0 rows (or non-K rows) while m1_contact contains category "K", re-fetch with includeAll=1
    // and enforce strict category === 'K' filtering server-side immediately.
    const isCatK = (cat: string) => String(cat || '').trim().toUpperCase() === 'K';
    if (!includeAll) {
      const hasKInCategories = (rawData.categoryValues || []).some((v) => isCatK(v));
      const needsAllRefetch =
        (rawData.employees.length === 0 && hasKInCategories) ||
        rawData.employees.some((e) => !isCatK(e.category));

      if (needsAllRefetch) {
        const qsAll = new URLSearchParams();
        if (search) qsAll.set('q', search);
        qsAll.set('onlyActive', onlyActive ? '1' : '0');
        qsAll.set('includeAll', '1');
        qsAll.set('limit', '1000');
        rawData = await fetchErpBridgeJson<ErpEmployeesQueryResult>(`/employees?${qsAll.toString()}`);
      }

      const kOnly = rawData.employees
        .filter((e) => isCatK(e.category) && (!onlyActive || e.isActive !== false))
        .map((e) => ({ ...e, isEmployeeFlag: true }));

      const readyEmailCount = kOnly.filter((e) => !e.missingFields.includes('email')).length;
      const readyWhatsappCount = kOnly.filter((e) => !e.missingFields.includes('phone')).length;
      const readyBothCount = kOnly.filter((e) => e.missingFields.length === 0).length;

      rawData = {
        ...rawData,
        totalEmployees: kOnly.length,
        readyEmailCount,
        readyWhatsappCount,
        readyBothCount,
        missingEmailCount: kOnly.length - readyEmailCount,
        missingPhoneCount: kOnly.length - readyWhatsappCount,
        filterMode: 'employee_only',
        employees: kOnly.slice(0, limit),
      };
    }

    if (employeesQueryCache.size > 20) {
      const oldest = employeesQueryCache.keys().next().value;
      if (oldest) employeesQueryCache.delete(oldest);
    }
    employeesQueryCache.set(cacheKey, {
      expiresAt: Date.now() + STOCK_CACHE_TTL_MS,
      data: rawData,
    });
    return rawData;
  }

  const data = await withReadOnlyConnection(async (conn) => {
    const [colRows] = await conn.query<RowDataPacket[]>('SHOW COLUMNS FROM `m1_contact`');
    const cols = colRows
      .map((r) => String(r.Field || r.field || '').trim())
      .filter((c) => SAFE_SQL_IDENTIFIER_REGEX.test(c));
    if (cols.length === 0) {
      throw new Error('Tabel m1_contact tidak ditemukan atau tidak memiliki kolom yang dapat dibaca.');
    }

    const idCol = pickColumn(cols, '', ['kid', 'id', 'contact_id']);
    const codeCol = pickColumn(cols, '', ['kkode', 'kode', 'code', 'nik', 'knik']);
    const nameCol = pickColumn(cols, '', ['knama', 'nama', 'name']);
    const emailCol = pickColumn(cols, '', ['kemail', 'email', 'kmail', 'kemail1', 'kemailkantor']);
    const phoneCol = pickColumn(cols, '', [
      'khp',
      'khandphone',
      'kwa',
      'kwhatsapp',
      'knohp',
      'kmobile',
      'ktelp',
      'ktelepon',
      'ktelpon',
      'ktelp1',
      'kphone',
      'phone',
    ]);
    const remainingPhoneCols = cols.filter((c) => c !== phoneCol);
    const secondaryPhoneCol = pickColumn(remainingPhoneCols, '', [
      'ktelp',
      'ktelepon',
      'ktelpon',
      'ktelp1',
      'ktelp2',
      'khp',
      'khandphone',
      'kwa',
      'kphone',
      'phone',
    ]);
    const activeCol = pickColumn(cols, '', ['kaktif', 'aktif', 'is_active', 'kstatusaktif']);
    const employeeFlagCol = pickColumn(cols, '', [
      'kpegawai',
      'kemployee',
      'kkaryawan',
      'kisemployee',
      'is_employee',
      'k1karyawan',
    ]);
    const categoryCol = pickColumn(cols, '', [
      'kkategori',
      'kkategorikontak',
      'kjenis',
      'ktipe',
      'ktype',
      'kgolongan',
      'kgroup',
      'kgrup',
      'kcategory',
    ]);
    const divisionCol = pickColumn(cols, '', ['kdivisi', 'kdepartemen', 'kdept', 'kbagian', 'kunit']);
    const jobTitleCol = pickColumn(cols, '', ['kjabatan', 'kposisi', 'ktitle', 'klevel']);
    const addressCol = pickColumn(cols, '', ['kalamat', 'kalamat1', 'alamat', 'address']);

    let catJoinSql = '';
    let catLabelExpr = categoryCol
      ? `COALESCE(NULLIF(TRIM(CAST(c.\`${categoryCol}\` AS CHAR)), ''), '')`
      : "''";

    if (categoryCol) {
      try {
        const [catTbls] = await conn.query<RowDataPacket[]>(
          "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('m1_contact_category', 'm1_contact_kategori', 'm1_kategori_kontak', 'm1_kontak_kategori', 'm1_contact_type', 'm1_contact_group')"
        );
        if (catTbls.length > 0) {
          const catTbl = String(catTbls[0].TABLE_NAME || catTbls[0].table_name || '').trim();
          if (catTbl && SAFE_SQL_IDENTIFIER_REGEX.test(catTbl)) {
            const [ccRows] = await conn.query<RowDataPacket[]>(`SHOW COLUMNS FROM \`${catTbl}\``);
            const ccCols = ccRows
              .map((r) => String(r.Field || r.field || '').trim())
              .filter((c) => SAFE_SQL_IDENTIFIER_REGEX.test(c));
            const ccMap = new Map(ccCols.map((x) => [x.toLowerCase(), x]));
            const ccId =
              ['id', 'kid', 'cid', 'kkid', 'kode', 'kkode'].map((k) => ccMap.get(k)).find(Boolean) || '';
            const ccName =
              ['nama', 'knama', 'cnama', 'name', 'kategori', 'deskripsi']
                .map((k) => ccMap.get(k))
                .find(Boolean) || '';
            if (ccId && ccName) {
              catJoinSql = `LEFT JOIN \`${catTbl}\` cc ON CAST(cc.\`${ccId}\` AS CHAR) = CAST(c.\`${categoryCol}\` AS CHAR)`;
              catLabelExpr = `COALESCE(NULLIF(TRIM(CAST(cc.\`${ccName}\` AS CHAR)), ''), NULLIF(TRIM(CAST(c.\`${categoryCol}\` AS CHAR)), ''), '')`;
            }
          }
        }
      } catch {
        // Fallback to raw category column value
      }
    }

    const selectParts = [
      `${idCol ? `c.\`${idCol}\`` : '0'} AS id`,
      `${codeCol ? `COALESCE(NULLIF(TRIM(CAST(c.\`${codeCol}\` AS CHAR)), ''), '')` : "''"} AS code`,
      `${nameCol ? `COALESCE(NULLIF(TRIM(CAST(c.\`${nameCol}\` AS CHAR)), ''), '')` : "''"} AS name`,
      `${emailCol ? `COALESCE(NULLIF(TRIM(CAST(c.\`${emailCol}\` AS CHAR)), ''), '')` : "''"} AS email`,
      `${phoneCol ? `COALESCE(NULLIF(TRIM(CAST(c.\`${phoneCol}\` AS CHAR)), ''), '')` : "''"} AS phone`,
      `${secondaryPhoneCol ? `COALESCE(NULLIF(TRIM(CAST(c.\`${secondaryPhoneCol}\` AS CHAR)), ''), '')` : "''"} AS secondaryPhone`,
      `${activeCol ? `COALESCE(c.\`${activeCol}\`, 1)` : '1'} AS isActive`,
      `${employeeFlagCol ? `COALESCE(c.\`${employeeFlagCol}\`, 0)` : '0'} AS employeeFlag`,
      `${catLabelExpr} AS category`,
      `${divisionCol ? `COALESCE(NULLIF(TRIM(CAST(c.\`${divisionCol}\` AS CHAR)), ''), '')` : "''"} AS division`,
      `${jobTitleCol ? `COALESCE(NULLIF(TRIM(CAST(c.\`${jobTitleCol}\` AS CHAR)), ''), '')` : "''"} AS jobTitle`,
      `${addressCol ? `COALESCE(NULLIF(TRIM(CAST(c.\`${addressCol}\` AS CHAR)), ''), '')` : "''"} AS address`,
    ];

    const whereClauses: string[] = [];
    if (onlyActive && activeCol) {
      whereClauses.push(`COALESCE(c.\`${activeCol}\`, 1) <> 0`);
    }
    if (!includeAll && categoryCol) {
      whereClauses.push(
        `(UPPER(TRIM(CAST(c.\`${categoryCol}\` AS CHAR))) = 'K' OR UPPER(TRIM(${catLabelExpr})) = 'K')`
      );
    }
    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const orderSql = nameCol
      ? `ORDER BY c.\`${nameCol}\` ASC`
      : idCol
        ? `ORDER BY c.\`${idCol}\` ASC`
        : '';

    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT ${selectParts.join(', ')} FROM m1_contact c ${catJoinSql} ${whereSql} ${orderSql} LIMIT 5000`
    );

    const categorySet = new Set<string>();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

    const mappedAll: ErpEmployeeRecord[] = rows.map((r) => {
      const rawCat = String(r.category || '').trim();
      if (rawCat) categorySet.add(rawCat);
      const catIsK = rawCat.toUpperCase() === 'K';
      const activeNum = Number(r.isActive ?? 1);
      const isActive = activeCol ? activeNum !== 0 : true;
      const rawEmail = String(r.email || '').trim();
      const validEmail = emailRegex.test(rawEmail) ? rawEmail : '';
      const primaryPhone = String(r.phone || '').trim();
      const secPhone = String(r.secondaryPhone || '').trim();
      const waNorm = normalizeWaPhoneServer(primaryPhone) || normalizeWaPhoneServer(secPhone);
      const missingFields: ('email' | 'phone')[] = [];
      if (!validEmail) missingFields.push('email');
      if (!waNorm) missingFields.push('phone');

      return {
        id: Number(r.id || 0),
        code: String(r.code || '').trim() || (r.id ? String(r.id) : '-'),
        name: String(r.name || '').trim() || 'Tanpa Nama',
        category: rawCat || '-',
        division: String(r.division || '').trim(),
        jobTitle: String(r.jobTitle || '').trim(),
        email: rawEmail,
        phone: primaryPhone,
        secondaryPhone: secPhone,
        whatsappNormalized: waNorm,
        address: String(r.address || '').trim(),
        isActive,
        isEmployeeFlag: catIsK,
        missingFields,
      };
    });

    const scoped = mappedAll.filter((emp) => {
      if (onlyActive && !emp.isActive) return false;
      if (!includeAll && !emp.isEmployeeFlag) return false;
      return true;
    });

    const qLower = search.toLowerCase();
    const filtered = qLower
      ? scoped.filter((emp) => {
          const hay = [
            emp.code,
            emp.name,
            emp.category,
            emp.division,
            emp.jobTitle,
            emp.email,
            emp.phone,
            emp.secondaryPhone,
          ]
            .join(' ')
            .toLowerCase();
          return qLower
            .split(/\s+/)
            .filter(Boolean)
            .every((tok) => hay.includes(tok));
        })
      : scoped;

    const readyEmailCount = scoped.filter((e) => !e.missingFields.includes('email')).length;
    const readyWhatsappCount = scoped.filter((e) => !e.missingFields.includes('phone')).length;
    const readyBothCount = scoped.filter((e) => e.missingFields.length === 0).length;

    return {
      sourceTable: `m1_contact${catJoinSql ? ' + category_lookup' : ''}`,
      totalContactsScanned: mappedAll.length,
      totalEmployees: scoped.length,
      readyEmailCount,
      readyWhatsappCount,
      readyBothCount,
      missingEmailCount: scoped.length - readyEmailCount,
      missingPhoneCount: scoped.length - readyWhatsappCount,
      detectedColumns: {
        idCol,
        codeCol,
        nameCol,
        emailCol,
        phoneCol,
        secondaryPhoneCol,
        activeCol,
        employeeFlagCol,
        categoryCol,
        divisionCol,
        jobTitleCol,
        addressCol,
        allColumns: cols,
      },
      categoryValues: Array.from(categorySet).sort((a, b) => a.localeCompare(b)),
      filterMode: (includeAll ? 'all_contacts' : 'employee_only') as 'all_contacts' | 'employee_only',
      employees: filtered.slice(0, limit),
      fetchedAt: new Date().toISOString(),
    };
  });

  if (employeesQueryCache.size > 20) {
    const oldest = employeesQueryCache.keys().next().value;
    if (oldest) employeesQueryCache.delete(oldest);
  }
  employeesQueryCache.set(cacheKey, {
    expiresAt: Date.now() + STOCK_CACHE_TTL_MS,
    data,
  });
  return data;
}
