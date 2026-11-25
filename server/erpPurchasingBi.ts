import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import {
  ACTIVE_ERP_CUTOFF_DATE,
  fetchErpBridgeJson,
  getErpBridgeConfig,
  withReadOnlyConnection,
} from './erpMysql.ts';

/* ============================================================================
 * Types — Purchasing Business Intelligence (12 Sales-Aligned KPIs for m4_*)
 * ========================================================================== */

export interface ErpPurchasingBiMonthlyRow {
  month: string; // YYYY-MM
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
  dayBuckets: number[]; // length 15: index 0..14 = 0 Hari..14 Hari
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
 * Helpers & Cache
 * ========================================================================== */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const BI_PURCHASING_CACHE_TTL_MS = 2 * 60 * 1000;
const purchasingBiCache = new Map<string, CacheEntry<ErpPurchasingBiQueryResult>>();
const SAFE_SQL_IDENTIFIER_REGEX = /^[a-zA-Z0-9_]+$/;

function assertSafeIdentifier(identifier: string): string {
  if (!SAFE_SQL_IDENTIFIER_REGEX.test(identifier)) {
    throw new Error(`Unsafe SQL identifier detected: ${identifier}`);
  }
  return identifier;
}

function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function enumerateMonths(dateFrom: string, dateTo: string): string[] {
  const [fy, fm] = dateFrom.split('-').map(Number);
  const [ty, tm] = dateTo.split('-').map(Number);
  if (!fy || !fm || !ty || !tm) return [];
  const out: string[] = [];
  let y = fy;
  let m = fm;
  let guard = 0;
  while ((y < ty || (y === ty && m <= tm)) && guard < 120) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    guard += 1;
  }
  return out;
}

function shiftMonth(ym: string, deltaMonths: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + deltaMonths, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthStartDate(ym: string): string {
  return `${ym}-01`;
}

function pickCol(cols: string[], exact: string[], patterns: RegExp[] = []): string | null {
  const lowerMap = new Map<string, string>();
  for (const c of cols) lowerMap.set(c.toLowerCase(), c);
  for (const cand of exact) {
    const found = lowerMap.get(cand.toLowerCase());
    if (found) return assertSafeIdentifier(found);
  }
  for (const pat of patterns) {
    const found = cols.find((c) => pat.test(c));
    if (found) return assertSafeIdentifier(found);
  }
  return null;
}

async function inspectTableColumns(
  conn: PoolConnection,
  tableName: string
): Promise<string[] | null> {
  try {
    const safe = assertSafeIdentifier(tableName);
    const [rows] = await conn.query<RowDataPacket[]>(`SHOW COLUMNS FROM \`${safe}\``);
    return rows.map((r) => String(r.Field || '')).filter(Boolean);
  } catch {
    return null;
  }
}

function buildStatusExcludeClause(alias: string, statusCol: string | null): string {
  if (!statusCol) return '1=1';
  const ref = `${alias}.\`${assertSafeIdentifier(statusCol)}\``;
  return `(${ref} IS NULL OR COALESCE(${ref}, 0) NOT IN (6, 12))`;
}

function buildActiveDateBound(dateFrom: string, dateTo: string) {
  const effectiveFrom = dateFrom < ACTIVE_ERP_CUTOFF_DATE ? ACTIVE_ERP_CUTOFF_DATE : dateFrom;
  return { effectiveFrom, effectiveTo: dateTo };
}

/* ============================================================================
 * Main Purchasing BI Query Engine (12 Sales-Aligned KPIs)
 * ========================================================================== */

export function invalidateErpPurchasingBiCache(): void {
  purchasingBiCache.clear();
}

export async function queryErpPurchasingBiData(options: {
  dateFrom?: string;
  dateTo?: string;
  bypassCache?: boolean;
}): Promise<ErpPurchasingBiQueryResult> {
  const rawFrom = (options.dateFrom || '').trim();
  const dateFrom =
    /^\d{4}-\d{2}-\d{2}$/.test(rawFrom) && rawFrom >= ACTIVE_ERP_CUTOFF_DATE
      ? rawFrom
      : ACTIVE_ERP_CUTOFF_DATE;
  const rawTo = (options.dateTo || '').trim();
  const dateTo =
    /^\d{4}-\d{2}-\d{2}$/.test(rawTo) && rawTo >= dateFrom
      ? rawTo
      : new Date().toISOString().slice(0, 10);
  const bypassCache = Boolean(options.bypassCache);

  const cacheKey = `purchasing_bi_v2_${dateFrom}_${dateTo}`;
  const cached = purchasingBiCache.get(cacheKey);
  if (!bypassCache && cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const bridge = getErpBridgeConfig();
  if (bridge.configured) {
    const qs = new URLSearchParams();
    qs.set('dateFrom', dateFrom);
    qs.set('dateTo', dateTo);
    const bridged = await fetchErpBridgeJson<ErpPurchasingBiQueryResult>(
      `/purchasing-bi?${qs.toString()}`
    );
    const isV13Schema =
      Boolean(bridged) &&
      typeof bridged === 'object' &&
      Boolean(bridged.masterSuppliers) &&
      Array.isArray(bridged.supplierSpend) &&
      Boolean(bridged.ppiDetailsByMonth) &&
      Array.isArray(bridged.receivingLeadTimeItems);
    if (!isV13Schema) {
      throw new Error(
        'Skrip Local Bridge ERP yang sedang berjalan masih versi lama (sebelum v13) sehingga belum mendukung struktur 12 KPI Purchasing terbaru. Silakan unduh ulang Local Bridge terbaru (v13) dan jalankan ulang.'
      );
    }
    purchasingBiCache.set(cacheKey, {
      data: bridged,
      expiresAt: Date.now() + BI_PURCHASING_CACHE_TTL_MS,
    });
    return bridged;
  }

  const result = await withReadOnlyConnection(async (conn) => {
    const months = enumerateMonths(dateFrom, dateTo);
    const lookbackStartMonth = months.length > 0 ? shiftMonth(months[0], -3) : dateFrom.slice(0, 7);
    const lookbackFromDate = monthStartDate(lookbackStartMonth);
    const { effectiveFrom, effectiveTo } = buildActiveDateBound(dateFrom, dateTo);

    // 1. Inspect available m4_* & master tables
    const tableNames = [
      'm4_po',
      'm4_po_detail',
      'm4_grn',
      'm4_grn_detail',
      'm4_ri',
      'm4_ri_detail',
      'm4_prt',
      'm4_prt_detail',
      'm4_vp',
      'm4_vp_detail',
      'm1_contact',
      'm1_item',
    ];
    const tableCols: Record<string, string[] | null> = {};
    for (const t of tableNames) {
      tableCols[t] = await inspectTableColumns(conn, t);
    }
    const tablesDetected = tableNames.filter((t) => Array.isArray(tableCols[t]));

    // 2. Coverage dates from m4_ri or m4_po
    let minDateAll = '';
    let maxDateAll = '';
    let minDateActive = '';
    let maxDateActive = '';

    const riCols = tableCols['m4_ri'];
    const poCols = tableCols['m4_po'];
    const riDateCol = riCols ? pickCol(riCols, ['ritgl', 'ri_tgl', 'tanggal'], [/tgl|date/i]) : null;
    const riStatusCol = riCols ? pickCol(riCols, ['ristatus', 'status'], [/status/i]) : null;
    const poDateCol = poCols ? pickCol(poCols, ['potgl', 'po_tgl', 'tanggal'], [/tgl|date/i]) : null;
    const poStatusCol = poCols ? pickCol(poCols, ['postatus', 'status'], [/status/i]) : null;

    if (riCols && riDateCol) {
      const [covRows] = await conn.query<RowDataPacket[]>(
        `SELECT
           DATE_FORMAT(MIN(r.\`${riDateCol}\`), '%Y-%m-%d') AS min_all,
           DATE_FORMAT(MAX(r.\`${riDateCol}\`), '%Y-%m-%d') AS max_all,
           DATE_FORMAT(MIN(CASE WHEN r.\`${riDateCol}\` >= ? THEN r.\`${riDateCol}\` END), '%Y-%m-%d') AS min_act,
           DATE_FORMAT(MAX(CASE WHEN r.\`${riDateCol}\` >= ? THEN r.\`${riDateCol}\` END), '%Y-%m-%d') AS max_act
         FROM m4_ri r
         WHERE ${buildStatusExcludeClause('r', riStatusCol)}`,
        [ACTIVE_ERP_CUTOFF_DATE, ACTIVE_ERP_CUTOFF_DATE]
      );
      if (covRows[0]) {
        minDateAll = String(covRows[0].min_all || '');
        maxDateAll = String(covRows[0].max_all || '');
        minDateActive = String(covRows[0].min_act || '');
        maxDateActive = String(covRows[0].max_act || '');
      }
    } else if (poCols && poDateCol) {
      const [covRows] = await conn.query<RowDataPacket[]>(
        `SELECT
           DATE_FORMAT(MIN(p.\`${poDateCol}\`), '%Y-%m-%d') AS min_all,
           DATE_FORMAT(MAX(p.\`${poDateCol}\`), '%Y-%m-%d') AS max_all,
           DATE_FORMAT(MIN(CASE WHEN p.\`${poDateCol}\` >= ? THEN p.\`${poDateCol}\` END), '%Y-%m-%d') AS min_act,
           DATE_FORMAT(MAX(CASE WHEN p.\`${poDateCol}\` >= ? THEN p.\`${poDateCol}\` END), '%Y-%m-%d') AS max_act
         FROM m4_po p
         WHERE ${buildStatusExcludeClause('p', poStatusCol)}`,
        [ACTIVE_ERP_CUTOFF_DATE, ACTIVE_ERP_CUTOFF_DATE]
      );
      if (covRows[0]) {
        minDateAll = String(covRows[0].min_all || '');
        maxDateAll = String(covRows[0].max_all || '');
        minDateActive = String(covRows[0].min_act || '');
        maxDateActive = String(covRows[0].max_act || '');
      }
    }

    // 3. Master suppliers (m1_contact)
    const masterSuppliers = { total: 0, active: 0, inactive: 0 };
    const contactCols = tableCols['m1_contact'];
    const cIdCol = contactCols ? pickCol(contactCols, ['kid', 'cid', 'id'], [/^(k|c)?id$/i]) : null;
    const cCodeCol = contactCols ? pickCol(contactCols, ['kkode', 'ckode', 'kode'], [/kode|code/i]) : null;
    const cNameCol = contactCols ? pickCol(contactCols, ['knama', 'cnama', 'nama'], [/nama|name/i]) : null;
    const cSuppFlag = contactCols
      ? pickCol(contactCols, ['kissupplier', 'ksupplier', 'cissupplier', 'cisvendor', 'issupplier'], [/supplier|vendor/i])
      : null;
    const cAktifCol = contactCols
      ? pickCol(contactCols, ['kaktif', 'caktif', 'cisactive', 'isactive', 'aktif'], [/aktif|active/i])
      : null;

    if (contactCols && cIdCol) {
      try {
        const whereSupp = cSuppFlag ? `WHERE COALESCE(c.\`${cSuppFlag}\`, 0) = 1` : '';
        const activeExpr = cAktifCol
          ? `SUM(CASE WHEN COALESCE(c.\`${cAktifCol}\`, 1) IN (1, '1', 'Y', 'y', 'Active') THEN 1 ELSE 0 END)`
          : 'COUNT(*)';
        const [msRows] = await conn.query<RowDataPacket[]>(
          `SELECT COUNT(*) AS total_cnt, ${activeExpr} AS active_cnt FROM m1_contact c ${whereSupp}`
        );
        if (msRows[0]) {
          masterSuppliers.total = toNum(msRows[0].total_cnt);
          masterSuppliers.active = toNum(msRows[0].active_cnt);
          masterSuppliers.inactive = Math.max(0, masterSuppliers.total - masterSuppliers.active);
        }
      } catch {
        // Non-fatal
      }
    }

    // Initialize monthly buckets
    const monthlyMap = new Map<string, ErpPurchasingBiMonthlyRow>();
    for (const ym of months) {
      monthlyMap.set(ym, {
        month: ym,
        activeSuppliersRi: 0,
        prevSuppliersRi: 0,
        activeSuppliersPo: 0,
        prevSuppliersPo: 0,
        churnedSuppliersPrevMonth: 0,
        churnedSuppliersRolling3m: 0,
        poCount: 0,
        prevPoCount: 0,
        poItemQty: 0,
        poRealizedQty: 0,
        poOrderValue: 0,
        poRealizedValue: 0,
        poCompleteCount: 0,
        poCompleteOrCloseCount: 0,
        poTotalValue: 0,
        poCompleteValue: 0,
        poCompleteOrCloseValue: 0,
        ppiPrevTotalPrice: 0,
        ppiCurrTotalPrice: 0,
        ppiItemCount: 0,
        ppiPct: 0,
        grnTotalCount: 0,
        grnLinkedPoCount: 0,
        grnOnTimeCount: 0,
        riTotalCount: 0,
        riLinkedPoCount: 0,
        riOnTimeCount: 0,
        returnDocCount: 0,
        riInvoiceCount: 0,
        returnQty: 0,
        purchasedQty: 0,
        returnValueIdr: 0,
        riDppIdr: 0,
        mismatchQty: 0,
        receivedQty: 0,
      });
    }

    // Helper for item master columns (MyERP Plus uses bid/bkode/bnama or iid/ikode/inama)
    const itemCols = tableCols['m1_item'];
    const iIdCol = itemCols ? pickCol(itemCols, ['bid', 'iid', 'id'], [/^(b|i)?id$/i]) : null;
    const iCodeCol = itemCols ? pickCol(itemCols, ['bkode', 'ikode', 'kode'], [/kode|code/i]) : null;
    const iNameCol = itemCols ? pickCol(itemCols, ['bnama', 'inama', 'nama'], [/nama|name/i]) : null;

    // 4. KPI 01 & 03 — Active Suppliers per month & Churn (from m4_ri & m4_po with 3-month lookback)
    const riSuppCol = riCols ? pickCol(riCols, ['risupplier', 'rikontak', 'idcontact', 'idsupplier'], [/supplier|kontak|vendor|contact/i]) : null;
    const riKursCol = riCols ? pickCol(riCols, ['rikurs', 'kurs'], [/kurs|rate/i]) : null;
    const riTotalCol = riCols ? pickCol(riCols, ['ritotaltransaksi', 'ritotal', 'total'], [/totaltransaksi|total/i]) : null;
    const riDppCol = riCols ? pickCol(riCols, ['ritotaldpp', 'ridpp', 'risubtotal'], [/dpp|subtotal/i]) : null;
    const riTaxCol = riCols ? pickCol(riCols, ['ritotalpajak', 'ripajak', 'rippn'], [/pajak|ppn|tax/i]) : null;
    const riPaidCol = riCols ? pickCol(riCols, ['rijmlbayar', 'ritotalbayar', 'ribayar', 'ripayment'], [/bayar|paid|payment/i]) : null;
    const riDpCol = riCols ? pickCol(riCols, ['rijmluangmuka'], [/uangmuka/i]) : null;
    const riBalanceCol = riCols ? pickCol(riCols, ['risisahutang', 'risisa', 'ribalance'], [/sisa|balance|hutang/i]) : null;
    const riIdCol = riCols ? pickCol(riCols, ['riid', 'id'], [/^ri?id$/i]) : null;
    const riPoFkCol = riCols ? pickCol(riCols, ['riidpo', 'idpo'], [/idpo|poid/i]) : null;
    const riGrnFkCol = riCols ? pickCol(riCols, ['riidgrn', 'idgrn'], [/idgrn|grnid/i]) : null;

    const poIdCol = poCols ? pickCol(poCols, ['poid', 'id'], [/^po?id$/i]) : null;
    const poSuppCol = poCols ? pickCol(poCols, ['posupplier', 'pokontak', 'idcontact', 'idsupplier'], [/supplier|kontak|vendor|contact/i]) : null;
    const poKursCol = poCols ? pickCol(poCols, ['pokurs', 'kurs'], [/kurs|rate/i]) : null;
    const poTotalCol = poCols ? pickCol(poCols, ['pototaltransaksi', 'pototal', 'total'], [/totaltransaksi|total/i]) : null;
    const poIsCloseCol = poCols ? pickCol(poCols, ['poisclose', 'isclose', 'poclosed'], [/isclose|closed/i]) : null;
    const poTargetDateCol = poCols
      ? pickCol(poCols, ['potgldipenuhi', 'potglkirim', 'potgldelivery', 'potglduedate', 'potgljatuhtempo'], [/dipenuhi|delivery|kirim|due|target/i])
      : null;

    const riSuppliersByMonth = new Map<string, Set<number>>();
    if (riCols && riDateCol && riSuppCol) {
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT DATE_FORMAT(r.\`${riDateCol}\`, '%Y-%m') AS ym, r.\`${riSuppCol}\` AS supp_id
         FROM m4_ri r
         WHERE r.\`${riDateCol}\` >= ? AND r.\`${riDateCol}\` <= ?
           AND r.\`${riSuppCol}\` IS NOT NULL AND r.\`${riSuppCol}\` > 0
           AND ${buildStatusExcludeClause('r', riStatusCol)}
         GROUP BY ym, supp_id`,
        [lookbackFromDate, effectiveTo]
      );
      for (const r of rows) {
        const ym = String(r.ym || '');
        const sid = toNum(r.supp_id);
        if (!ym || !sid) continue;
        if (!riSuppliersByMonth.has(ym)) riSuppliersByMonth.set(ym, new Set());
        riSuppliersByMonth.get(ym)!.add(sid);
      }
    }

    const poSuppliersByMonth = new Map<string, Set<number>>();
    const poCountByMonth = new Map<string, number>();
    if (poCols && poDateCol) {
      const kursExpr = poKursCol ? `COALESCE(NULLIF(p.\`${poKursCol}\`, 0), 1)` : '1';
      const totalExpr = poTotalCol ? `COALESCE(p.\`${poTotalCol}\`, 0) * ${kursExpr}` : '0';
      const completeExpr = poStatusCol
        ? `CASE WHEN p.\`${poStatusCol}\` = 4 OR LOWER(CAST(p.\`${poStatusCol}\` AS CHAR)) = 'complete' THEN 1 ELSE 0 END`
        : '0';
      const closeOrCompleteExpr =
        poStatusCol && poIsCloseCol
          ? `CASE WHEN p.\`${poStatusCol}\` IN (4, 7) OR COALESCE(p.\`${poIsCloseCol}\`, 0) = 1 OR LOWER(CAST(p.\`${poStatusCol}\` AS CHAR)) IN ('complete', 'close', 'closed') THEN 1 ELSE 0 END`
          : poStatusCol
            ? `CASE WHEN p.\`${poStatusCol}\` IN (4, 7) OR LOWER(CAST(p.\`${poStatusCol}\` AS CHAR)) IN ('complete', 'close', 'closed') THEN 1 ELSE 0 END`
            : '0';

      const [poMonthlyRows] = await conn.query<RowDataPacket[]>(
        `SELECT
           DATE_FORMAT(p.\`${poDateCol}\`, '%Y-%m') AS ym,
           COUNT(*) AS po_cnt,
           SUM(${completeExpr}) AS comp_cnt,
           SUM(${closeOrCompleteExpr}) AS close_cnt,
           SUM(${totalExpr}) AS total_val,
           SUM(CASE WHEN (${completeExpr}) = 1 THEN ${totalExpr} ELSE 0 END) AS comp_val,
           SUM(CASE WHEN (${closeOrCompleteExpr}) = 1 THEN ${totalExpr} ELSE 0 END) AS close_val
         FROM m4_po p
         WHERE p.\`${poDateCol}\` >= ? AND p.\`${poDateCol}\` <= ?
           AND ${buildStatusExcludeClause('p', poStatusCol)}
         GROUP BY ym`,
        [lookbackFromDate, effectiveTo]
      );
      for (const r of poMonthlyRows) {
        const ym = String(r.ym || '');
        if (!ym) continue;
        poCountByMonth.set(ym, toNum(r.po_cnt));
        const bucket = monthlyMap.get(ym);
        if (bucket) {
          bucket.poCount = toNum(r.po_cnt);
          bucket.poCompleteCount = toNum(r.comp_cnt);
          bucket.poCompleteOrCloseCount = toNum(r.close_cnt);
          bucket.poTotalValue = toNum(r.total_val);
          bucket.poCompleteValue = toNum(r.comp_val);
          bucket.poCompleteOrCloseValue = toNum(r.close_val);
        }
      }

      if (poSuppCol) {
        const [poSuppRows] = await conn.query<RowDataPacket[]>(
          `SELECT DATE_FORMAT(p.\`${poDateCol}\`, '%Y-%m') AS ym, p.\`${poSuppCol}\` AS supp_id
           FROM m4_po p
           WHERE p.\`${poDateCol}\` >= ? AND p.\`${poDateCol}\` <= ?
             AND p.\`${poSuppCol}\` IS NOT NULL AND p.\`${poSuppCol}\` > 0
             AND ${buildStatusExcludeClause('p', poStatusCol)}
           GROUP BY ym, supp_id`,
          [lookbackFromDate, effectiveTo]
        );
        for (const r of poSuppRows) {
          const ym = String(r.ym || '');
          const sid = toNum(r.supp_id);
          if (!ym || !sid) continue;
          if (!poSuppliersByMonth.has(ym)) poSuppliersByMonth.set(ym, new Set());
          poSuppliersByMonth.get(ym)!.add(sid);
        }
      }
    }

    // Populate supplier growth, churn, and prev PO count per month
    for (const ym of months) {
      const row = monthlyMap.get(ym)!;
      const prev1 = shiftMonth(ym, -1);
      const prev2 = shiftMonth(ym, -2);
      const prev3 = shiftMonth(ym, -3);

      const currRi = riSuppliersByMonth.get(ym) || new Set<number>();
      const prevRi = riSuppliersByMonth.get(prev1) || new Set<number>();
      const currPo = poSuppliersByMonth.get(ym) || new Set<number>();
      const prevPo = poSuppliersByMonth.get(prev1) || new Set<number>();

      row.activeSuppliersRi = currRi.size;
      row.prevSuppliersRi = prevRi.size;
      row.activeSuppliersPo = currPo.size;
      row.prevSuppliersPo = prevPo.size;
      row.prevPoCount = poCountByMonth.get(prev1) || 0;

      // Churned vs previous month: active in prev1, not active in curr
      let churnPrev = 0;
      for (const sid of prevRi) {
        if (!currRi.has(sid)) churnPrev += 1;
      }
      row.churnedSuppliersPrevMonth = churnPrev;

      // Churned rolling 3m: active in prev1..prev3, not active in curr
      const rollingUnion = new Set<number>();
      for (const pYm of [prev1, prev2, prev3]) {
        const s = riSuppliersByMonth.get(pYm);
        if (s) for (const sid of s) rollingUnion.add(sid);
      }
      let churn3m = 0;
      for (const sid of rollingUnion) {
        if (!currRi.has(sid)) churn3m += 1;
      }
      row.churnedSuppliersRolling3m = churn3m;
    }

    // 5. Monthly RI totals & Supplier Spend Ranking (KPI 02)
    const supplierSpendMap = new Map<number, ErpPurchasingBiSupplierRow>();
    if (riCols && riDateCol) {
      const riColSet = new Set(riCols.map((c) => c.toLowerCase()));
      const hasTaxParts =
        riColSet.has('rihargatermasukpajak') &&
        riColSet.has('ritotalpajak1detail') &&
        riColSet.has('ritotalpajak2detail') &&
        riColSet.has('ritotal') &&
        riColSet.has('rijmldiskon');
      const kursExpr = riKursCol ? `COALESCE(NULLIF(r.\`${riKursCol}\`, 0), 1)` : '1';
      const dppBaseExpr = hasTaxParts
        ? `(CASE WHEN COALESCE(r.rihargatermasukpajak, 0) = 1 THEN (COALESCE(r.ritotaltransaksi, 0) - COALESCE(r.ritotalpajak1detail, 0) - COALESCE(r.ritotalpajak2detail, 0)) ELSE (COALESCE(r.ritotal, 0) - COALESCE(r.rijmldiskon, 0)) END)`
        : riDppCol
          ? `COALESCE(r.\`${riDppCol}\`, 0)`
          : riTotalCol && riTaxCol
            ? `(COALESCE(r.\`${riTotalCol}\`, 0) - COALESCE(r.\`${riTaxCol}\`, 0))`
            : riTotalCol
              ? `COALESCE(r.\`${riTotalCol}\`, 0)`
              : '0';
      const totalBaseExpr = riTotalCol ? `COALESCE(r.\`${riTotalCol}\`, 0)` : dppBaseExpr;
      const dppIdrExpr = `(${dppBaseExpr} * ${kursExpr})`;
      const totalIdrExpr = `(${totalBaseExpr} * ${kursExpr})`;

      const paidBaseExpr =
        riPaidCol && riDpCol
          ? `(COALESCE(r.\`${riPaidCol}\`, 0) + COALESCE(r.\`${riDpCol}\`, 0))`
          : riPaidCol
            ? `COALESCE(r.\`${riPaidCol}\`, 0)`
            : riBalanceCol
              ? `GREATEST(0, ${totalBaseExpr} - COALESCE(r.\`${riBalanceCol}\`, 0))`
              : '0';
      const paidIdrExpr = `(${paidBaseExpr} * ${kursExpr})`;
      const payableIdrExpr = riBalanceCol
        ? `(GREATEST(0, COALESCE(r.\`${riBalanceCol}\`, 0)) * ${kursExpr})`
        : riPaidCol
          ? `(GREATEST(0, ${totalBaseExpr} - ${paidBaseExpr}) * ${kursExpr})`
          : '0';

      const [riMonthlyRows] = await conn.query<RowDataPacket[]>(
        `SELECT
           DATE_FORMAT(r.\`${riDateCol}\`, '%Y-%m') AS ym,
           COUNT(*) AS inv_cnt,
           SUM(${dppIdrExpr}) AS dpp_idr
         FROM m4_ri r
         WHERE r.\`${riDateCol}\` >= ? AND r.\`${riDateCol}\` <= ?
           AND ${buildStatusExcludeClause('r', riStatusCol)}
         GROUP BY ym`,
        [effectiveFrom, effectiveTo]
      );
      for (const r of riMonthlyRows) {
        const bucket = monthlyMap.get(String(r.ym || ''));
        if (bucket) {
          bucket.riInvoiceCount = toNum(r.inv_cnt);
          bucket.riTotalCount = toNum(r.inv_cnt);
          bucket.riDppIdr = toNum(r.dpp_idr);
        }
      }

      if (riSuppCol) {
        const contactJoin =
          contactCols && cIdCol
            ? `LEFT JOIN m1_contact c ON c.\`${cIdCol}\` = r.\`${riSuppCol}\``
            : '';
        const codeSelect = cCodeCol ? `COALESCE(c.\`${cCodeCol}\`, '')` : `CAST(r.\`${riSuppCol}\` AS CHAR)`;
        const nameSelect = cNameCol
          ? `COALESCE(NULLIF(TRIM(c.\`${cNameCol}\`), ''), CONCAT('Supplier #', r.\`${riSuppCol}\`))`
          : `CONCAT('Supplier #', r.\`${riSuppCol}\`)`;

        const [suppRows] = await conn.query<RowDataPacket[]>(
          `SELECT
             r.\`${riSuppCol}\` AS supp_id,
             ${codeSelect} AS supp_code,
             ${nameSelect} AS supp_name,
             COUNT(*) AS inv_cnt,
             SUM(${dppIdrExpr}) AS dpp_idr,
             SUM(${totalIdrExpr}) AS total_idr,
             SUM(${paidIdrExpr}) AS paid_idr,
             SUM(${payableIdrExpr}) AS payable_idr
           FROM m4_ri r
           ${contactJoin}
           WHERE r.\`${riDateCol}\` >= ? AND r.\`${riDateCol}\` <= ?
             AND r.\`${riSuppCol}\` IS NOT NULL AND r.\`${riSuppCol}\` > 0
             AND ${buildStatusExcludeClause('r', riStatusCol)}
           GROUP BY supp_id, supp_code, supp_name
           ORDER BY dpp_idr DESC`,
          [effectiveFrom, effectiveTo]
        );
        const totalPeriodDpp = suppRows.reduce((s, x) => s + Math.max(0, toNum(x.dpp_idr)), 0);
        for (const r of suppRows) {
          const sid = toNum(r.supp_id);
          const dpp = toNum(r.dpp_idr);
          supplierSpendMap.set(sid, {
            supplierId: sid,
            supplierCode: String(r.supp_code || `SUP-${sid}`),
            supplierName: String(r.supp_name || `Supplier #${sid}`),
            invoiceCount: toNum(r.inv_cnt),
            dppIdr: dpp,
            paidIdr: toNum(r.paid_idr),
            payableIdr: toNum(r.payable_idr),
            sharePct: totalPeriodDpp > 0 ? (dpp / totalPeriodDpp) * 100 : 0,
            returnValueIdr: 0,
            grnLinkedCount: 0,
            grnOnTimeCount: 0,
            otdPct: null,
          });
        }
      }
    }

    // 6. KPI 06 & 06B — PO Realization (Qty & Value)
    let realizationSource: ErpPurchasingBiQueryResult['diagnostics']['realizationSource'] = 'unavailable';
    const podCols = tableCols['m4_po_detail'];
    const grnCols = tableCols['m4_grn'];
    const grndCols = tableCols['m4_grn_detail'];
    const ridCols = tableCols['m4_ri_detail'];

    const podIdCol = podCols ? pickCol(podCols, ['idpodetail', 'podetailid', 'podid', 'id'], [/idpodetail|podid/i]) : null;
    const podPoFkCol = podCols ? pickCol(podCols, ['idpo', 'poid', 'podidpo'], [/idpo|poid/i]) : null;
    const podItemCol = podCols ? pickCol(podCols, ['idbarang', 'iditem', 'bid', 'podiditem', 'itemid'], [/idbarang|iditem|itemid/i]) : null;
    const podQtyCol = podCols ? pickCol(podCols, ['jml', 'qty', 'jumlah', 'podjml', 'podqty', 'dqty'], [/jml|qty|jumlah/i]) : null;
    const podRealQtyCol = podCols
      ? pickCol(podCols, ['jmlterima', 'podqtyterima', 'podqtygrn', 'podqtyproses', 'podqtyrealisasi'], [/terima|qtygrn|qtyproses|realisasi/i])
      : null;
    const podPriceCol = podCols ? pickCol(podCols, ['harga', 'dharga', 'podharga', 'hargasatuan', 'podprice'], [/harga|price/i]) : null;
    const podSubCol = podCols ? pickCol(podCols, ['subtotal', 'podsubtotal', 'total', 'podtotal'], [/subtotal|total/i]) : null;

    const grnIdCol = grnCols ? pickCol(grnCols, ['grnid', 'id'], [/^grn?id$/i]) : null;
    const grnDateCol = grnCols ? pickCol(grnCols, ['grntgl', 'tanggal'], [/tgl|date/i]) : null;
    const grnStatusCol = grnCols ? pickCol(grnCols, ['grnstatus', 'status'], [/status/i]) : null;
    const grnPoFkCol = grnCols ? pickCol(grnCols, ['grnidpo', 'idpo', 'poid'], [/idpo|poid/i]) : null;
    const grnSuppCol = grnCols ? pickCol(grnCols, ['grnsupplier', 'grnkontak', 'idcontact', 'idsupplier'], [/supplier|kontak|vendor|contact/i]) : null;

    const grndGrnFkCol = grndCols ? pickCol(grndCols, ['idgrn', 'grnid', 'grndidgrn'], [/idgrn|grnid/i]) : null;
    const grndPodFkCol = grndCols ? pickCol(grndCols, ['idpodetail', 'podetailid', 'grndidpodetail'], [/idpodetail|podetail/i]) : null;
    const grndItemCol = grndCols ? pickCol(grndCols, ['idbarang', 'iditem', 'bid', 'grndiditem', 'itemid'], [/idbarang|iditem|itemid/i]) : null;
    const grndQtyCol = grndCols ? pickCol(grndCols, ['jml', 'qty', 'jumlah', 'grndjml', 'grndqty'], [/jml|qty|jumlah/i]) : null;

    const ridRiFkCol = ridCols ? pickCol(ridCols, ['idri', 'riid', 'rididri'], [/idri|riid/i]) : null;
    const ridPodFkCol = ridCols ? pickCol(ridCols, ['idpodetail', 'podetailid', 'rididpodetail'], [/idpodetail|podetail/i]) : null;
    const ridItemCol = ridCols ? pickCol(ridCols, ['idbarang', 'iditem', 'bid', 'rididitem', 'itemid'], [/idbarang|iditem|itemid/i]) : null;
    const ridQtyCol = ridCols ? pickCol(ridCols, ['jml', 'qty', 'jumlah', 'ridjml', 'ridqty', 'dqty'], [/jml|qty|jumlah/i]) : null;
    const ridPriceCol = ridCols ? pickCol(ridCols, ['harga', 'dharga', 'ridharga', 'hargasatuan', 'ridprice'], [/harga|price/i]) : null;

    if (poCols && poIdCol && poDateCol && podCols && podPoFkCol && podQtyCol) {
      const poKursExpr = poKursCol ? `COALESCE(NULLIF(p.\`${poKursCol}\`, 0), 1)` : '1';
      const lineValExpr = podSubCol
        ? `COALESCE(pd.\`${podSubCol}\`, 0) * ${poKursExpr}`
        : podPriceCol
          ? `(COALESCE(pd.\`${podQtyCol}\`, 0) * COALESCE(pd.\`${podPriceCol}\`, 0) * ${poKursExpr})`
          : '0';
      const unitValExpr = podPriceCol
        ? `(COALESCE(pd.\`${podPriceCol}\`, 0) * ${poKursExpr})`
        : podSubCol
          ? `(CASE WHEN COALESCE(pd.\`${podQtyCol}\`, 0) > 0 THEN (COALESCE(pd.\`${podSubCol}\`, 0) / pd.\`${podQtyCol}\`) * ${poKursExpr} ELSE 0 END)`
          : '0';

      if (podIdCol && grnCols && grnIdCol && grndCols && grndGrnFkCol && grndPodFkCol && grndQtyCol) {
        realizationSource = 'm4_grn_detail';
        const [rows] = await conn.query<RowDataPacket[]>(
          `SELECT
             DATE_FORMAT(p.\`${poDateCol}\`, '%Y-%m') AS ym,
             SUM(COALESCE(pd.\`${podQtyCol}\`, 0)) AS po_qty,
             SUM(LEAST(COALESCE(pd.\`${podQtyCol}\`, 0), COALESCE(g_agg.grn_qty, 0))) AS real_qty,
             SUM(${lineValExpr}) AS po_val,
             SUM(LEAST(COALESCE(pd.\`${podQtyCol}\`, 0), COALESCE(g_agg.grn_qty, 0)) * ${unitValExpr}) AS real_val
           FROM m4_po p
           INNER JOIN m4_po_detail pd ON pd.\`${podPoFkCol}\` = p.\`${poIdCol}\`
           LEFT JOIN (
             SELECT gd.\`${grndPodFkCol}\` AS pod_id, SUM(COALESCE(gd.\`${grndQtyCol}\`, 0)) AS grn_qty
             FROM m4_grn_detail gd
             INNER JOIN m4_grn g ON g.\`${grnIdCol}\` = gd.\`${grndGrnFkCol}\`
             WHERE ${buildStatusExcludeClause('g', grnStatusCol)}
             GROUP BY gd.\`${grndPodFkCol}\`
           ) g_agg ON g_agg.pod_id = pd.\`${podIdCol}\`
           WHERE p.\`${poDateCol}\` >= ? AND p.\`${poDateCol}\` <= ?
             AND ${buildStatusExcludeClause('p', poStatusCol)}
           GROUP BY ym`,
          [effectiveFrom, effectiveTo]
        );
        for (const r of rows) {
          const b = monthlyMap.get(String(r.ym || ''));
          if (b) {
            b.poItemQty = toNum(r.po_qty);
            b.poRealizedQty = toNum(r.real_qty);
            b.poOrderValue = toNum(r.po_val);
            b.poRealizedValue = toNum(r.real_val);
          }
        }
      } else if (podIdCol && riCols && riIdCol && ridCols && ridRiFkCol && ridPodFkCol && ridQtyCol) {
        realizationSource = 'm4_ri_detail';
        const [rows] = await conn.query<RowDataPacket[]>(
          `SELECT
             DATE_FORMAT(p.\`${poDateCol}\`, '%Y-%m') AS ym,
             SUM(COALESCE(pd.\`${podQtyCol}\`, 0)) AS po_qty,
             SUM(LEAST(COALESCE(pd.\`${podQtyCol}\`, 0), COALESCE(ri_agg.ri_qty, 0))) AS real_qty,
             SUM(${lineValExpr}) AS po_val,
             SUM(LEAST(COALESCE(pd.\`${podQtyCol}\`, 0), COALESCE(ri_agg.ri_qty, 0)) * ${unitValExpr}) AS real_val
           FROM m4_po p
           INNER JOIN m4_po_detail pd ON pd.\`${podPoFkCol}\` = p.\`${poIdCol}\`
           LEFT JOIN (
             SELECT rd.\`${ridPodFkCol}\` AS pod_id, SUM(COALESCE(rd.\`${ridQtyCol}\`, 0)) AS ri_qty
             FROM m4_ri_detail rd
             INNER JOIN m4_ri r ON r.\`${riIdCol}\` = rd.\`${ridRiFkCol}\`
             WHERE ${buildStatusExcludeClause('r', riStatusCol)}
             GROUP BY rd.\`${ridPodFkCol}\`
           ) ri_agg ON ri_agg.pod_id = pd.\`${podIdCol}\`
           WHERE p.\`${poDateCol}\` >= ? AND p.\`${poDateCol}\` <= ?
             AND ${buildStatusExcludeClause('p', poStatusCol)}
           GROUP BY ym`,
          [effectiveFrom, effectiveTo]
        );
        for (const r of rows) {
          const b = monthlyMap.get(String(r.ym || ''));
          if (b) {
            b.poItemQty = toNum(r.po_qty);
            b.poRealizedQty = toNum(r.real_qty);
            b.poOrderValue = toNum(r.po_val);
            b.poRealizedValue = toNum(r.real_val);
          }
        }
      } else if (podRealQtyCol) {
        realizationSource = 'm4_po_detail';
        const [rows] = await conn.query<RowDataPacket[]>(
          `SELECT
             DATE_FORMAT(p.\`${poDateCol}\`, '%Y-%m') AS ym,
             SUM(COALESCE(pd.\`${podQtyCol}\`, 0)) AS po_qty,
             SUM(LEAST(COALESCE(pd.\`${podQtyCol}\`, 0), COALESCE(pd.\`${podRealQtyCol}\`, 0))) AS real_qty,
             SUM(${lineValExpr}) AS po_val,
             SUM(LEAST(COALESCE(pd.\`${podQtyCol}\`, 0), COALESCE(pd.\`${podRealQtyCol}\`, 0)) * ${unitValExpr}) AS real_val
           FROM m4_po p
           INNER JOIN m4_po_detail pd ON pd.\`${podPoFkCol}\` = p.\`${poIdCol}\`
           WHERE p.\`${poDateCol}\` >= ? AND p.\`${poDateCol}\` <= ?
             AND ${buildStatusExcludeClause('p', poStatusCol)}
           GROUP BY ym`,
          [effectiveFrom, effectiveTo]
        );
        for (const r of rows) {
          const b = monthlyMap.get(String(r.ym || ''));
          if (b) {
            b.poItemQty = toNum(r.po_qty);
            b.poRealizedQty = toNum(r.real_qty);
            b.poOrderValue = toNum(r.po_val);
            b.poRealizedValue = toNum(r.real_val);
          }
        }
      } else {
        realizationSource = 'm4_po_status';
        for (const b of monthlyMap.values()) {
          b.poItemQty = b.poCount;
          b.poRealizedQty = b.poCompleteOrCloseCount;
          b.poOrderValue = b.poTotalValue;
          b.poRealizedValue = b.poCompleteOrCloseValue;
        }
      }
    }

    // 7. KPI 08 — Purchase Price Index (PPI) from m4_ri_detail (last unit price per item per month × kurs)
    const ppiDetailsByMonth: Record<string, ErpPurchasingBiPpiItemDetail[]> = {};
    if (riCols && riIdCol && riDateCol && ridCols && ridRiFkCol && ridItemCol && ridPriceCol) {
      const kursExpr = riKursCol ? `COALESCE(NULLIF(r.\`${riKursCol}\`, 0), 1)` : '1';
      const itemJoin =
        itemCols && iIdCol ? `LEFT JOIN m1_item it ON it.\`${iIdCol}\` = rd.\`${ridItemCol}\`` : '';
      const iCodeSel = iCodeCol ? `COALESCE(it.\`${iCodeCol}\`, '')` : `CAST(rd.\`${ridItemCol}\` AS CHAR)`;
      const iNameSel = iNameCol
        ? `COALESCE(NULLIF(TRIM(it.\`${iNameCol}\`), ''), CONCAT('Item #', rd.\`${ridItemCol}\`))`
        : `CONCAT('Item #', rd.\`${ridItemCol}\`)`;

      const ppiLookbackFrom = months.length > 0 ? monthStartDate(shiftMonth(months[0], -1)) : lookbackFromDate;
      const [priceRows] = await conn.query<RowDataPacket[]>(
        `SELECT
           DATE_FORMAT(r.\`${riDateCol}\`, '%Y-%m') AS ym,
           rd.\`${ridItemCol}\` AS item_id,
           ${iCodeSel} AS item_code,
           ${iNameSel} AS item_name,
           (COALESCE(rd.\`${ridPriceCol}\`, 0) * ${kursExpr}) AS unit_price_idr,
           r.\`${riDateCol}\` AS doc_date,
           r.\`${riIdCol}\` AS doc_id
         FROM m4_ri_detail rd
         INNER JOIN m4_ri r ON r.\`${riIdCol}\` = rd.\`${ridRiFkCol}\`
         ${itemJoin}
         WHERE r.\`${riDateCol}\` >= ? AND r.\`${riDateCol}\` <= ?
           AND COALESCE(rd.\`${ridPriceCol}\`, 0) > 0
           AND ${buildStatusExcludeClause('r', riStatusCol)}
         ORDER BY r.\`${riDateCol}\` ASC, r.\`${riIdCol}\` ASC`,
        [ppiLookbackFrom, effectiveTo]
      );

      // Keep last price per (ym, itemId)
      const lastPriceByMonthItem = new Map<
        string,
        Map<number, { itemCode: string; itemName: string; price: number }>
      >();
      for (const r of priceRows) {
        const ym = String(r.ym || '');
        const itemId = toNum(r.item_id);
        const price = toNum(r.unit_price_idr);
        if (!ym || !itemId || price <= 0) continue;
        if (!lastPriceByMonthItem.has(ym)) lastPriceByMonthItem.set(ym, new Map());
        lastPriceByMonthItem.get(ym)!.set(itemId, {
          itemCode: String(r.item_code || `ITEM-${itemId}`),
          itemName: String(r.item_name || `Item #${itemId}`),
          price,
        });
      }

      for (const ym of months) {
        const prevYm = shiftMonth(ym, -1);
        const currMap = lastPriceByMonthItem.get(ym);
        const prevMap = lastPriceByMonthItem.get(prevYm);
        const details: ErpPurchasingBiPpiItemDetail[] = [];
        let sumPrev = 0;
        let sumCurr = 0;

        if (currMap && prevMap) {
          for (const [itemId, currInfo] of currMap.entries()) {
            const prevInfo = prevMap.get(itemId);
            if (!prevInfo || prevInfo.price <= 0) continue;
            const varianceIdr = currInfo.price - prevInfo.price;
            const variancePct = (varianceIdr / prevInfo.price) * 100;
            sumPrev += prevInfo.price;
            sumCurr += currInfo.price;
            details.push({
              itemId,
              itemCode: currInfo.itemCode,
              itemName: currInfo.itemName,
              prevPrice: prevInfo.price,
              currPrice: currInfo.price,
              varianceIdr,
              variancePct,
            });
          }
        }

        details.sort((a, b) => Math.abs(b.variancePct) - Math.abs(a.variancePct));
        ppiDetailsByMonth[ym] = details.slice(0, 100);

        const b = monthlyMap.get(ym)!;
        b.ppiPrevTotalPrice = sumPrev;
        b.ppiCurrTotalPrice = sumCurr;
        b.ppiItemCount = details.length;
        b.ppiPct = sumPrev > 0 ? ((sumCurr - sumPrev) / sumPrev) * 100 : 0;
      }
    }

    // 8. KPI 09 — Receiving On Time (GRN & RI vs PO target date)
    let otdBasis: ErpPurchasingBiQueryResult['diagnostics']['otdBasis'] = 'unavailable';
    if (poCols && poIdCol && poDateCol) {
      const targetExpr = poTargetDateCol
        ? `COALESCE(NULLIF(p.\`${poTargetDateCol}\`, '0000-00-00'), DATE_ADD(p.\`${poDateCol}\`, INTERVAL 7 DAY))`
        : `DATE_ADD(p.\`${poDateCol}\`, INTERVAL 7 DAY)`;
      otdBasis = poTargetDateCol ? 'po_potgldipenuhi' : 'po_potgl_plus7';

      if (grnCols && grnDateCol) {
        if (grnPoFkCol) {
          const [grnOtdRows] = await conn.query<RowDataPacket[]>(
            `SELECT
               DATE_FORMAT(g.\`${grnDateCol}\`, '%Y-%m') AS ym,
               COUNT(*) AS total_cnt,
               SUM(CASE WHEN p.\`${poIdCol}\` IS NOT NULL THEN 1 ELSE 0 END) AS linked_cnt,
               SUM(CASE WHEN p.\`${poIdCol}\` IS NOT NULL AND DATE(g.\`${grnDateCol}\`) <= DATE(${targetExpr}) THEN 1 ELSE 0 END) AS ontime_cnt
             FROM m4_grn g
             LEFT JOIN m4_po p ON p.\`${poIdCol}\` = g.\`${grnPoFkCol}\`
             WHERE g.\`${grnDateCol}\` >= ? AND g.\`${grnDateCol}\` <= ?
               AND ${buildStatusExcludeClause('g', grnStatusCol)}
             GROUP BY ym`,
            [effectiveFrom, effectiveTo]
          );
          for (const r of grnOtdRows) {
            const b = monthlyMap.get(String(r.ym || ''));
            if (b) {
              b.grnTotalCount = toNum(r.total_cnt);
              b.grnLinkedPoCount = toNum(r.linked_cnt);
              b.grnOnTimeCount = toNum(r.ontime_cnt);
            }
          }

          // Supplier-level OTD enrichment
          if (grnSuppCol) {
            const [suppOtdRows] = await conn.query<RowDataPacket[]>(
              `SELECT
                 g.\`${grnSuppCol}\` AS supp_id,
                 SUM(CASE WHEN p.\`${poIdCol}\` IS NOT NULL THEN 1 ELSE 0 END) AS linked_cnt,
                 SUM(CASE WHEN p.\`${poIdCol}\` IS NOT NULL AND DATE(g.\`${grnDateCol}\`) <= DATE(${targetExpr}) THEN 1 ELSE 0 END) AS ontime_cnt
               FROM m4_grn g
               LEFT JOIN m4_po p ON p.\`${poIdCol}\` = g.\`${grnPoFkCol}\`
               WHERE g.\`${grnDateCol}\` >= ? AND g.\`${grnDateCol}\` <= ?
                 AND g.\`${grnSuppCol}\` IS NOT NULL
                 AND ${buildStatusExcludeClause('g', grnStatusCol)}
               GROUP BY supp_id`,
              [effectiveFrom, effectiveTo]
            );
            for (const r of suppOtdRows) {
              const s = supplierSpendMap.get(toNum(r.supp_id));
              if (s) {
                s.grnLinkedCount = toNum(r.linked_cnt);
                s.grnOnTimeCount = toNum(r.ontime_cnt);
                s.otdPct = s.grnLinkedCount > 0 ? (s.grnOnTimeCount / s.grnLinkedCount) * 100 : null;
              }
            }
          }
        } else {
          const [grnOnlyRows] = await conn.query<RowDataPacket[]>(
            `SELECT DATE_FORMAT(g.\`${grnDateCol}\`, '%Y-%m') AS ym, COUNT(*) AS total_cnt
             FROM m4_grn g
             WHERE g.\`${grnDateCol}\` >= ? AND g.\`${grnDateCol}\` <= ?
               AND ${buildStatusExcludeClause('g', grnStatusCol)}
             GROUP BY ym`,
            [effectiveFrom, effectiveTo]
          );
          for (const r of grnOnlyRows) {
            const b = monthlyMap.get(String(r.ym || ''));
            if (b) b.grnTotalCount = toNum(r.total_cnt);
          }
        }
      }

      // RI vs PO target date (alternative document basis in KPI 09)
      if (riCols && riDateCol) {
        const joinPoClause = riPoFkCol
          ? `LEFT JOIN m4_po p ON p.\`${poIdCol}\` = r.\`${riPoFkCol}\``
          : riGrnFkCol && grnCols && grnIdCol && grnPoFkCol
            ? `LEFT JOIN m4_grn g ON g.\`${grnIdCol}\` = r.\`${riGrnFkCol}\` LEFT JOIN m4_po p ON p.\`${poIdCol}\` = g.\`${grnPoFkCol}\``
            : '';
        if (joinPoClause) {
          const [riOtdRows] = await conn.query<RowDataPacket[]>(
            `SELECT
               DATE_FORMAT(r.\`${riDateCol}\`, '%Y-%m') AS ym,
               COUNT(*) AS total_cnt,
               SUM(CASE WHEN p.\`${poIdCol}\` IS NOT NULL THEN 1 ELSE 0 END) AS linked_cnt,
               SUM(CASE WHEN p.\`${poIdCol}\` IS NOT NULL AND DATE(r.\`${riDateCol}\`) <= DATE(${targetExpr}) THEN 1 ELSE 0 END) AS ontime_cnt
             FROM m4_ri r
             ${joinPoClause}
             WHERE r.\`${riDateCol}\` >= ? AND r.\`${riDateCol}\` <= ?
               AND ${buildStatusExcludeClause('r', riStatusCol)}
             GROUP BY ym`,
            [effectiveFrom, effectiveTo]
          );
          for (const r of riOtdRows) {
            const b = monthlyMap.get(String(r.ym || ''));
            if (b) {
              b.riTotalCount = toNum(r.total_cnt);
              b.riLinkedPoCount = toNum(r.linked_cnt);
              b.riOnTimeCount = toNum(r.ontime_cnt);
            }
          }
        }
      }
    }

    // 9. KPI 10 & 10B — Purchase Return (m4_prt) & Purchase Mismatch (GRN vs PO + Return)
    let returnSource: ErpPurchasingBiQueryResult['diagnostics']['returnSource'] = 'unavailable';
    const returnDetailsByMonth: Record<string, ErpPurchasingBiReturnItemDetail[]> = {};
    const mismatchDetailsByMonth: Record<string, ErpPurchasingBiMismatchItemDetail[]> = {};

    // Purchased qty per month & per (month, item) from m4_ri_detail
    const purchasedByMonthItem = new Map<
      string,
      Map<number, { itemCode: string; itemName: string; qty: number }>
    >();
    if (riCols && riIdCol && riDateCol && ridCols && ridRiFkCol && ridQtyCol) {
      const [riQtyRows] = await conn.query<RowDataPacket[]>(
        `SELECT DATE_FORMAT(r.\`${riDateCol}\`, '%Y-%m') AS ym, SUM(COALESCE(rd.\`${ridQtyCol}\`, 0)) AS qty_sum
         FROM m4_ri_detail rd
         INNER JOIN m4_ri r ON r.\`${riIdCol}\` = rd.\`${ridRiFkCol}\`
         WHERE r.\`${riDateCol}\` >= ? AND r.\`${riDateCol}\` <= ?
           AND ${buildStatusExcludeClause('r', riStatusCol)}
         GROUP BY ym`,
        [effectiveFrom, effectiveTo]
      );
      for (const r of riQtyRows) {
        const b = monthlyMap.get(String(r.ym || ''));
        if (b) b.purchasedQty = toNum(r.qty_sum);
      }

      if (ridItemCol) {
        const itemJoin =
          itemCols && iIdCol ? `LEFT JOIN m1_item it ON it.\`${iIdCol}\` = rd.\`${ridItemCol}\`` : '';
        const iCodeSel = iCodeCol ? `COALESCE(it.\`${iCodeCol}\`, '')` : `CAST(rd.\`${ridItemCol}\` AS CHAR)`;
        const iNameSel = iNameCol
          ? `COALESCE(NULLIF(TRIM(it.\`${iNameCol}\`), ''), CONCAT('Item #', rd.\`${ridItemCol}\`))`
          : `CONCAT('Item #', rd.\`${ridItemCol}\`)`;

        const [rows] = await conn.query<RowDataPacket[]>(
          `SELECT
             DATE_FORMAT(r.\`${riDateCol}\`, '%Y-%m') AS ym,
             rd.\`${ridItemCol}\` AS item_id,
             ${iCodeSel} AS item_code,
             ${iNameSel} AS item_name,
             SUM(COALESCE(rd.\`${ridQtyCol}\`, 0)) AS qty_sum
           FROM m4_ri_detail rd
           INNER JOIN m4_ri r ON r.\`${riIdCol}\` = rd.\`${ridRiFkCol}\`
           ${itemJoin}
           WHERE r.\`${riDateCol}\` >= ? AND r.\`${riDateCol}\` <= ?
             AND ${buildStatusExcludeClause('r', riStatusCol)}
           GROUP BY ym, item_id, item_code, item_name`,
          [effectiveFrom, effectiveTo]
        );
        for (const r of rows) {
          const ym = String(r.ym || '');
          const iid = toNum(r.item_id);
          if (!ym || !iid) continue;
          if (!purchasedByMonthItem.has(ym)) purchasedByMonthItem.set(ym, new Map());
          purchasedByMonthItem.get(ym)!.set(iid, {
            itemCode: String(r.item_code || `ITEM-${iid}`),
            itemName: String(r.item_name || `Item #${iid}`),
            qty: toNum(r.qty_sum),
          });
        }
      }
    }

    // Received qty per month & per (month, item) from m4_grn_detail
    const receivedByMonthItem = new Map<
      string,
      Map<number, { itemCode: string; itemName: string; qty: number }>
    >();
    if (grnCols && grnIdCol && grnDateCol && grndCols && grndGrnFkCol && grndQtyCol) {
      const [grnQtyRows] = await conn.query<RowDataPacket[]>(
        `SELECT DATE_FORMAT(g.\`${grnDateCol}\`, '%Y-%m') AS ym, SUM(COALESCE(gd.\`${grndQtyCol}\`, 0)) AS qty_sum
         FROM m4_grn_detail gd
         INNER JOIN m4_grn g ON g.\`${grnIdCol}\` = gd.\`${grndGrnFkCol}\`
         WHERE g.\`${grnDateCol}\` >= ? AND g.\`${grnDateCol}\` <= ?
           AND ${buildStatusExcludeClause('g', grnStatusCol)}
         GROUP BY ym`,
        [effectiveFrom, effectiveTo]
      );
      for (const r of grnQtyRows) {
        const b = monthlyMap.get(String(r.ym || ''));
        if (b) b.receivedQty = toNum(r.qty_sum);
      }

      if (grndItemCol) {
        const itemJoin =
          itemCols && iIdCol ? `LEFT JOIN m1_item it ON it.\`${iIdCol}\` = gd.\`${grndItemCol}\`` : '';
        const iCodeSel = iCodeCol ? `COALESCE(it.\`${iCodeCol}\`, '')` : `CAST(gd.\`${grndItemCol}\` AS CHAR)`;
        const iNameSel = iNameCol
          ? `COALESCE(NULLIF(TRIM(it.\`${iNameCol}\`), ''), CONCAT('Item #', gd.\`${grndItemCol}\`))`
          : `CONCAT('Item #', gd.\`${grndItemCol}\`)`;

        const [rows] = await conn.query<RowDataPacket[]>(
          `SELECT
             DATE_FORMAT(g.\`${grnDateCol}\`, '%Y-%m') AS ym,
             gd.\`${grndItemCol}\` AS item_id,
             ${iCodeSel} AS item_code,
             ${iNameSel} AS item_name,
             SUM(COALESCE(gd.\`${grndQtyCol}\`, 0)) AS qty_sum
           FROM m4_grn_detail gd
           INNER JOIN m4_grn g ON g.\`${grnIdCol}\` = gd.\`${grndGrnFkCol}\`
           ${itemJoin}
           WHERE g.\`${grnDateCol}\` >= ? AND g.\`${grnDateCol}\` <= ?
             AND ${buildStatusExcludeClause('g', grnStatusCol)}
           GROUP BY ym, item_id, item_code, item_name`,
          [effectiveFrom, effectiveTo]
        );
        for (const r of rows) {
          const ym = String(r.ym || '');
          const iid = toNum(r.item_id);
          if (!ym || !iid) continue;
          if (!receivedByMonthItem.has(ym)) receivedByMonthItem.set(ym, new Map());
          receivedByMonthItem.get(ym)!.set(iid, {
            itemCode: String(r.item_code || `ITEM-${iid}`),
            itemName: String(r.item_name || `Item #${iid}`),
            qty: toNum(r.qty_sum),
          });
        }
      }
    }

    // Purchase Returns from m4_prt & m4_prt_detail
    const prtCols = tableCols['m4_prt'];
    const prtdCols = tableCols['m4_prt_detail'];
    const prtIdCol = prtCols ? pickCol(prtCols, ['prtid', 'id'], [/^prt?id$/i]) : null;
    const prtDateCol = prtCols ? pickCol(prtCols, ['prttgl', 'tanggal'], [/tgl|date/i]) : null;
    const prtStatusCol = prtCols ? pickCol(prtCols, ['prtstatus', 'status'], [/status/i]) : null;
    const prtSuppCol = prtCols ? pickCol(prtCols, ['prtsupplier', 'prtkontak', 'idcontact', 'idsupplier'], [/supplier|kontak|vendor|contact/i]) : null;
    const prtTotalCol = prtCols ? pickCol(prtCols, ['prttotaltransaksi', 'prttotal', 'total'], [/totaltransaksi|total/i]) : null;
    const prtKursCol = prtCols ? pickCol(prtCols, ['prtkurs', 'kurs'], [/kurs|rate/i]) : null;

    const prtdPrtFkCol = prtdCols ? pickCol(prtdCols, ['idprt', 'prtid', 'prtdidprt'], [/idprt|prtid/i]) : null;
    const prtdItemCol = prtdCols ? pickCol(prtdCols, ['idbarang', 'iditem', 'bid', 'prtdiditem', 'itemid'], [/idbarang|iditem|itemid/i]) : null;
    const prtdQtyCol = prtdCols ? pickCol(prtdCols, ['jml', 'qty', 'jumlah', 'prtdjml', 'prtdqty'], [/jml|qty|jumlah/i]) : null;

    const returnByMonthItem = new Map<
      string,
      Map<number, { itemCode: string; itemName: string; qty: number }>
    >();

    if (prtCols && prtDateCol) {
      returnSource = 'm4_prt';
      const kursExpr = prtKursCol ? `COALESCE(NULLIF(rt.\`${prtKursCol}\`, 0), 1)` : '1';
      const valExpr = prtTotalCol ? `COALESCE(rt.\`${prtTotalCol}\`, 0) * ${kursExpr}` : '0';

      const [prtRows] = await conn.query<RowDataPacket[]>(
        `SELECT
           DATE_FORMAT(rt.\`${prtDateCol}\`, '%Y-%m') AS ym,
           COUNT(*) AS doc_cnt,
           SUM(${valExpr}) AS val_idr
         FROM m4_prt rt
         WHERE rt.\`${prtDateCol}\` >= ? AND rt.\`${prtDateCol}\` <= ?
           AND ${buildStatusExcludeClause('rt', prtStatusCol)}
         GROUP BY ym`,
        [effectiveFrom, effectiveTo]
      );
      for (const r of prtRows) {
        const b = monthlyMap.get(String(r.ym || ''));
        if (b) {
          b.returnDocCount = toNum(r.doc_cnt);
          b.returnValueIdr = toNum(r.val_idr);
        }
      }

      if (prtSuppCol) {
        const [suppRetRows] = await conn.query<RowDataPacket[]>(
          `SELECT rt.\`${prtSuppCol}\` AS supp_id, SUM(${valExpr}) AS val_idr
           FROM m4_prt rt
           WHERE rt.\`${prtDateCol}\` >= ? AND rt.\`${prtDateCol}\` <= ?
             AND rt.\`${prtSuppCol}\` IS NOT NULL
             AND ${buildStatusExcludeClause('rt', prtStatusCol)}
           GROUP BY supp_id`,
          [effectiveFrom, effectiveTo]
        );
        for (const r of suppRetRows) {
          const s = supplierSpendMap.get(toNum(r.supp_id));
          if (s) s.returnValueIdr = toNum(r.val_idr);
        }
      }

      if (prtIdCol && prtdCols && prtdPrtFkCol && prtdQtyCol) {
        const [prtQtyRows] = await conn.query<RowDataPacket[]>(
          `SELECT DATE_FORMAT(rt.\`${prtDateCol}\`, '%Y-%m') AS ym, SUM(COALESCE(rd.\`${prtdQtyCol}\`, 0)) AS qty_sum
           FROM m4_prt_detail rd
           INNER JOIN m4_prt rt ON rt.\`${prtIdCol}\` = rd.\`${prtdPrtFkCol}\`
           WHERE rt.\`${prtDateCol}\` >= ? AND rt.\`${prtDateCol}\` <= ?
             AND ${buildStatusExcludeClause('rt', prtStatusCol)}
           GROUP BY ym`,
          [effectiveFrom, effectiveTo]
        );
        for (const r of prtQtyRows) {
          const b = monthlyMap.get(String(r.ym || ''));
          if (b) b.returnQty = toNum(r.qty_sum);
        }

        if (prtdItemCol) {
          const itemJoin =
            itemCols && iIdCol ? `LEFT JOIN m1_item it ON it.\`${iIdCol}\` = rd.\`${prtdItemCol}\`` : '';
          const iCodeSel = iCodeCol ? `COALESCE(it.\`${iCodeCol}\`, '')` : `CAST(rd.\`${prtdItemCol}\` AS CHAR)`;
          const iNameSel = iNameCol
            ? `COALESCE(NULLIF(TRIM(it.\`${iNameCol}\`), ''), CONCAT('Item #', rd.\`${prtdItemCol}\`))`
            : `CONCAT('Item #', rd.\`${prtdItemCol}\`)`;

          const [rows] = await conn.query<RowDataPacket[]>(
            `SELECT
               DATE_FORMAT(rt.\`${prtDateCol}\`, '%Y-%m') AS ym,
               rd.\`${prtdItemCol}\` AS item_id,
               ${iCodeSel} AS item_code,
               ${iNameSel} AS item_name,
               SUM(COALESCE(rd.\`${prtdQtyCol}\`, 0)) AS qty_sum
             FROM m4_prt_detail rd
             INNER JOIN m4_prt rt ON rt.\`${prtIdCol}\` = rd.\`${prtdPrtFkCol}\`
             ${itemJoin}
             WHERE rt.\`${prtDateCol}\` >= ? AND rt.\`${prtDateCol}\` <= ?
               AND ${buildStatusExcludeClause('rt', prtStatusCol)}
             GROUP BY ym, item_id, item_code, item_name`,
            [effectiveFrom, effectiveTo]
          );
          for (const r of rows) {
            const ym = String(r.ym || '');
            const iid = toNum(r.item_id);
            if (!ym || !iid) continue;
            if (!returnByMonthItem.has(ym)) returnByMonthItem.set(ym, new Map());
            returnByMonthItem.get(ym)!.set(iid, {
              itemCode: String(r.item_code || `ITEM-${iid}`),
              itemName: String(r.item_name || `Item #${iid}`),
              qty: toNum(r.qty_sum),
            });
          }
        }
      }
    }

    // Mismatch qty diff between GRN detail and PO detail (over/under delivery vs PO)
    const qtyDiffByMonthItem = new Map<
      string,
      Map<number, { itemCode: string; itemName: string; diffQty: number }>
    >();
    if (
      grnCols &&
      grnIdCol &&
      grnDateCol &&
      grndCols &&
      grndGrnFkCol &&
      grndPodFkCol &&
      grndQtyCol &&
      podCols &&
      podIdCol &&
      podQtyCol
    ) {
      const itemColRef = grndItemCol ? `gd.\`${grndItemCol}\`` : podItemCol ? `pd.\`${podItemCol}\`` : null;
      if (itemColRef) {
        const itemJoin =
          itemCols && iIdCol ? `LEFT JOIN m1_item it ON it.\`${iIdCol}\` = ${itemColRef}` : '';
        const iCodeSel = iCodeCol ? `COALESCE(it.\`${iCodeCol}\`, '')` : `CAST(${itemColRef} AS CHAR)`;
        const iNameSel = iNameCol
          ? `COALESCE(NULLIF(TRIM(it.\`${iNameCol}\`), ''), CONCAT('Item #', ${itemColRef}))`
          : `CONCAT('Item #', ${itemColRef})`;

        const [diffRows] = await conn.query<RowDataPacket[]>(
          `SELECT
             DATE_FORMAT(g.\`${grnDateCol}\`, '%Y-%m') AS ym,
             ${itemColRef} AS item_id,
             ${iCodeSel} AS item_code,
             ${iNameSel} AS item_name,
             SUM(CASE WHEN COALESCE(gd.\`${grndQtyCol}\`, 0) > COALESCE(pd.\`${podQtyCol}\`, 0)
                      THEN COALESCE(gd.\`${grndQtyCol}\`, 0) - COALESCE(pd.\`${podQtyCol}\`, 0)
                      ELSE 0 END) AS excess_qty
           FROM m4_grn_detail gd
           INNER JOIN m4_grn g ON g.\`${grnIdCol}\` = gd.\`${grndGrnFkCol}\`
           INNER JOIN m4_po_detail pd ON pd.\`${podIdCol}\` = gd.\`${grndPodFkCol}\`
           ${itemJoin}
           WHERE g.\`${grnDateCol}\` >= ? AND g.\`${grnDateCol}\` <= ?
             AND ${buildStatusExcludeClause('g', grnStatusCol)}
           GROUP BY ym, item_id, item_code, item_name
           HAVING excess_qty > 0`,
          [effectiveFrom, effectiveTo]
        );
        for (const r of diffRows) {
          const ym = String(r.ym || '');
          const iid = toNum(r.item_id);
          if (!ym || !iid) continue;
          if (!qtyDiffByMonthItem.has(ym)) qtyDiffByMonthItem.set(ym, new Map());
          qtyDiffByMonthItem.get(ym)!.set(iid, {
            itemCode: String(r.item_code || `ITEM-${iid}`),
            itemName: String(r.item_name || `Item #${iid}`),
            diffQty: toNum(r.excess_qty),
          });
        }
      }
    }

    // Build returnDetailsByMonth and mismatchDetailsByMonth
    for (const ym of months) {
      const b = monthlyMap.get(ym)!;
      if (b.receivedQty === 0 && b.purchasedQty > 0) {
        b.receivedQty = b.purchasedQty;
      }

      const retMap = returnByMonthItem.get(ym) || new Map();
      const purMap = purchasedByMonthItem.get(ym) || new Map();
      const recMap = receivedByMonthItem.get(ym) || purMap;
      const diffMap = qtyDiffByMonthItem.get(ym) || new Map();

      const retList: ErpPurchasingBiReturnItemDetail[] = [];
      for (const [iid, rInfo] of retMap.entries()) {
        const pQty = purMap.get(iid)?.qty ?? 0;
        retList.push({
          itemId: iid,
          itemCode: rInfo.itemCode,
          itemName: rInfo.itemName,
          returnQty: rInfo.qty,
          purchasedQty: pQty,
          returnPct: pQty > 0 ? (rInfo.qty / pQty) * 100 : 100,
        });
      }
      retList.sort((a, bItem) => bItem.returnQty - a.returnQty);
      returnDetailsByMonth[ym] = retList.slice(0, 100);

      const misItemIds = new Set<number>([...retMap.keys(), ...diffMap.keys()]);
      const misList: ErpPurchasingBiMismatchItemDetail[] = [];
      let monthMismatchSum = 0;
      for (const iid of misItemIds) {
        const rInfo = retMap.get(iid);
        const dInfo = diffMap.get(iid);
        const recInfo = recMap.get(iid);
        const rQty = rInfo?.qty ?? 0;
        const dQty = dInfo?.diffQty ?? 0;
        const mQty = rQty + dQty;
        if (mQty <= 0) continue;
        monthMismatchSum += mQty;
        const recvQty = recInfo?.qty ?? 0;
        misList.push({
          itemId: iid,
          itemCode: rInfo?.itemCode || dInfo?.itemCode || recInfo?.itemCode || `ITEM-${iid}`,
          itemName: rInfo?.itemName || dInfo?.itemName || recInfo?.itemName || `Item #${iid}`,
          returnQty: rQty,
          qtyDiff: dQty,
          mismatchQty: mQty,
          receivedQty: recvQty,
          mismatchPct: recvQty > 0 ? (mQty / recvQty) * 100 : 100,
        });
      }
      misList.sort((a, bItem) => bItem.mismatchQty - a.mismatchQty);
      mismatchDetailsByMonth[ym] = misList.slice(0, 100);
      b.mismatchQty = monthMismatchSum;
    }

    // 10. KPI 11 — Receiving Lead Time Matrix (0–14 Hari + >14 Hari per Item: PO -> GRN)
    let leadTimeSource: ErpPurchasingBiQueryResult['diagnostics']['leadTimeSource'] = 'unavailable';
    const receivingLeadTimeItems: ErpPurchasingBiLeadTimeItemRow[] = [];

    if (
      grnCols &&
      grnIdCol &&
      grnDateCol &&
      grndCols &&
      grndGrnFkCol &&
      poCols &&
      poIdCol &&
      poDateCol
    ) {
      const canJoinDetail = Boolean(grndPodFkCol && podCols && podIdCol && podPoFkCol);
      const canJoinHeader = Boolean(grnPoFkCol);
      const itemColRef = grndItemCol
        ? `gd.\`${grndItemCol}\``
        : canJoinDetail && podItemCol
          ? `pd.\`${podItemCol}\``
          : null;

      if (itemColRef && (canJoinDetail || canJoinHeader)) {
        leadTimeSource = canJoinDetail ? 'm4_grn_po_detail' : 'm4_grn_po_header';
        const poJoinClause = canJoinDetail
          ? `INNER JOIN m4_po_detail pd ON pd.\`${podIdCol}\` = gd.\`${grndPodFkCol}\`
             INNER JOIN m4_po p ON p.\`${poIdCol}\` = pd.\`${podPoFkCol}\``
          : `INNER JOIN m4_po p ON p.\`${poIdCol}\` = g.\`${grnPoFkCol}\``;
        const itemJoin =
          itemCols && iIdCol ? `LEFT JOIN m1_item it ON it.\`${iIdCol}\` = ${itemColRef}` : '';
        const iCodeSel = iCodeCol ? `COALESCE(it.\`${iCodeCol}\`, '')` : `CAST(${itemColRef} AS CHAR)`;
        const iNameSel = iNameCol
          ? `COALESCE(NULLIF(TRIM(it.\`${iNameCol}\`), ''), CONCAT('Item #', ${itemColRef}))`
          : `CONCAT('Item #', ${itemColRef})`;

        const [ltRows] = await conn.query<RowDataPacket[]>(
          `SELECT
             ${itemColRef} AS item_id,
             ${iCodeSel} AS item_code,
             ${iNameSel} AS item_name,
             GREATEST(0, DATEDIFF(DATE(g.\`${grnDateCol}\`), DATE(p.\`${poDateCol}\`))) AS lead_days,
             COUNT(*) AS cnt
           FROM m4_grn_detail gd
           INNER JOIN m4_grn g ON g.\`${grnIdCol}\` = gd.\`${grndGrnFkCol}\`
           ${poJoinClause}
           ${itemJoin}
           WHERE g.\`${grnDateCol}\` >= ? AND g.\`${grnDateCol}\` <= ?
             AND ${buildStatusExcludeClause('g', grnStatusCol)}
             AND ${buildStatusExcludeClause('p', poStatusCol)}
           GROUP BY item_id, item_code, item_name, lead_days`,
          [effectiveFrom, effectiveTo]
        );

        const ltMap = new Map<
          number,
          {
            itemId: number;
            itemCode: string;
            itemName: string;
            totalDeliveries: number;
            totalLeadDays: number;
            dayBuckets: number[];
            over14Days: number;
          }
        >();

        for (const r of ltRows) {
          const iid = toNum(r.item_id);
          const days = Math.max(0, Math.floor(toNum(r.lead_days)));
          const cnt = toNum(r.cnt);
          if (!iid || cnt <= 0) continue;
          let entry = ltMap.get(iid);
          if (!entry) {
            entry = {
              itemId: iid,
              itemCode: String(r.item_code || `ITEM-${iid}`),
              itemName: String(r.item_name || `Item #${iid}`),
              totalDeliveries: 0,
              totalLeadDays: 0,
              dayBuckets: new Array(15).fill(0),
              over14Days: 0,
            };
            ltMap.set(iid, entry);
          }
          entry.totalDeliveries += cnt;
          entry.totalLeadDays += days * cnt;
          if (days <= 14) {
            entry.dayBuckets[days] += cnt;
          } else {
            entry.over14Days += cnt;
          }
        }

        const sortedLt = Array.from(ltMap.values())
          .sort((a, bItem) => bItem.totalDeliveries - a.totalDeliveries)
          .slice(0, 120);

        for (const e of sortedLt) {
          receivingLeadTimeItems.push({
            itemId: e.itemId,
            itemCode: e.itemCode,
            itemName: e.itemName,
            totalDeliveries: e.totalDeliveries,
            avgLeadDays: e.totalDeliveries > 0 ? e.totalLeadDays / e.totalDeliveries : 0,
            dayBuckets: e.dayBuckets,
            over14Days: e.over14Days,
          });
        }
      }
    }

    const monthly = Array.from(monthlyMap.values()).sort((a, b) => a.month.localeCompare(b.month));
    const supplierSpend = Array.from(supplierSpendMap.values()).sort((a, b) => b.dppIdr - a.dppIdr);

    return {
      cutoffDate: ACTIVE_ERP_CUTOFF_DATE,
      period: { dateFrom, dateTo },
      coverage: {
        minDateAll,
        maxDateAll,
        minDateActive,
        maxDateActive,
      },
      masterSuppliers,
      diagnostics: {
        tablesDetected,
        realizationSource,
        otdBasis,
        returnSource,
        leadTimeSource,
      },
      monthly,
      supplierSpend,
      ppiDetailsByMonth,
      returnDetailsByMonth,
      mismatchDetailsByMonth,
      receivingLeadTimeItems,
      fetchedAt: new Date().toISOString(),
    };
  });

  purchasingBiCache.set(cacheKey, {
    data: result,
    expiresAt: Date.now() + BI_PURCHASING_CACHE_TTL_MS,
  });
  return result;
}
