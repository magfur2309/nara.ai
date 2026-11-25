import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import {
  ACTIVE_ERP_CUTOFF_DATE,
  fetchErpBridgeJson,
  getErpBridgeConfig,
  withReadOnlyConnection,
} from './erpMysql.ts';

export interface ErpSalesBiMonthlyRow {
  month: string; // YYYY-MM
  // 01. Pertumbuhan Customer
  activeCustomersSi: number;
  prevActiveCustomersSi: number;
  activeCustomersSo: number;
  prevActiveCustomersSo: number;
  // 03. Customer Mengundurkan Diri (Customer Turnover Rate)
  churnedCustomersSi: number;
  rollingBaseCustomersSi: number;
  churnedRollingCustomersSi: number;
  // 04. Order Penjualan (Sales Opportunity)
  soCount: number;
  prevSoCount: number;
  // 06 & 06B. Realisasi & Tidak Terpenuhi SO
  soItemQty: number;
  realizedItemQty: number;
  soTotalValue: number;
  realizedTotalValue: number;
  // 07. Order Penjualan Complete (Sales Close Index)
  soCompleteCount: number;
  soCompleteOrCloseCount: number;
  soCompleteValue: number;
  soCompleteOrCloseValue: number;
  // 08. Consumer Price Index (CPI)
  cpiPrevBasketPrice: number;
  cpiCurrBasketPrice: number;
  cpiPct: number;
  cpiItemCount: number;
  // 09. Delivery On Time
  ivTotalCount: number;
  ivOnTimeCount: number;
  ivLinkedCount: number;
  ivLinkedOnTimeCount: number;
  doTotalCount: number;
  doOnTimeCount: number;
  doLinkedCount: number;
  doLinkedOnTimeCount: number;
  // 10. Retur Penjualan (Sales Return)
  returnDocCount: number;
  returnItemQty: number;
  soldItemQty: number;
  returnValue: number;
  soldValue: number;
  // 10B. Barang Tidak Sesuai Pesanan
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
  /** Length 16: index 0..14 = 0..14 Hari, index 15 = >14 Hari */
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

const SAFE_SQL_IDENTIFIER_REGEX = /^[a-zA-Z0-9_]{1,64}$/;
const SALES_BI_CACHE_TTL_MS = 3 * 60 * 1000;
const salesBiQueryCache = new Map<string, { expiresAt: number; data: ErpSalesBiQueryResult }>();

export function invalidateErpSalesBiCache(): void {
  salesBiQueryCache.clear();
}

function clampActiveDateFrom(rawDateFrom?: string): string {
  const s = (rawDateFrom || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) && s >= ACTIVE_ERP_CUTOFF_DATE) {
    return s;
  }
  return ACTIVE_ERP_CUTOFF_DATE;
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

function shiftMonth(ym: string, deltaMonths: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return ym;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + deltaMonths, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function listMonthsBetween(startYm: string, endYm: string): string[] {
  const out: string[] = [];
  if (!/^\d{4}-\d{2}$/.test(startYm) || !/^\d{4}-\d{2}$/.test(endYm)) return out;
  let cur = startYm;
  let guard = 0;
  while (cur <= endYm && guard < 36) {
    out.push(cur);
    cur = shiftMonth(cur, 1);
    guard += 1;
  }
  return out;
}

function pickExactCol(cols: string[], candidates: string[]): string | null {
  const map = new Map(cols.map((c) => [c.toLowerCase(), c]));
  for (const cand of candidates) {
    const hit = map.get(cand.toLowerCase());
    if (hit && SAFE_SQL_IDENTIFIER_REGEX.test(hit)) return hit;
  }
  return null;
}

async function getTableCols(conn: PoolConnection, table: string): Promise<string[]> {
  if (!SAFE_SQL_IDENTIFIER_REGEX.test(table)) return [];
  try {
    const [rows] = await conn.query<RowDataPacket[]>(`SHOW COLUMNS FROM \`${table}\``);
    return rows
      .map((r) => String(r.Field || r.field || '').trim())
      .filter((c) => SAFE_SQL_IDENTIFIER_REGEX.test(c));
  } catch {
    return [];
  }
}

export async function queryErpSalesBiData(params?: {
  dateFrom?: string;
  dateTo?: string;
  bypassCache?: boolean;
}): Promise<ErpSalesBiQueryResult> {
  const dateFrom = clampActiveDateFrom(params?.dateFrom);
  const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(params?.dateTo || '') ? params!.dateTo! : '';

  const cacheKey = `${dateFrom}|${dateTo}`;
  if (!params?.bypassCache) {
    const cached = salesBiQueryCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.data;
    }
  }

  const bridgeCfg = getErpBridgeConfig();
  if (bridgeCfg.configured) {
    const qs = new URLSearchParams();
    if (dateFrom) qs.set('dateFrom', dateFrom);
    if (dateTo) qs.set('dateTo', dateTo);

    const data = await fetchErpBridgeJson<ErpSalesBiQueryResult>(`/sales-bi?${qs.toString()}`);
    if (salesBiQueryCache.size > 30) {
      const oldest = salesBiQueryCache.keys().next().value;
      if (oldest) salesBiQueryCache.delete(oldest);
    }
    salesBiQueryCache.set(cacheKey, {
      expiresAt: Date.now() + SALES_BI_CACHE_TTL_MS,
      data,
    });
    return data;
  }

  const data = await withReadOnlyConnection(async (conn) => {
    const [tblRows] = await conn.query<RowDataPacket[]>(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME IN (
           'm5_si', 'm5_si_detail', 'm5_so', 'm5_so_detail',
           'm5_do', 'm5_do_detail', 'm5_sr', 'm5_sr_detail',
           'm1_contact', 'm1_item', 'm2_transaction_journal', 'm1_coa'
         )`
    );
    const tblSet = new Set(
      tblRows.map((r) => String(r.TABLE_NAME || r.table_name || '').toLowerCase())
    );
    const hasSi = tblSet.has('m5_si');
    const hasSiDet = tblSet.has('m5_si_detail');
    const hasSo = tblSet.has('m5_so');
    const hasSoDet = tblSet.has('m5_so_detail');
    const hasDo = tblSet.has('m5_do');
    const hasDoDet = tblSet.has('m5_do_detail');
    const hasSr = tblSet.has('m5_sr');
    const hasSrDet = tblSet.has('m5_sr_detail');
    const hasContact = tblSet.has('m1_contact');
    const hasItem = tblSet.has('m1_item');
    const hasJournal = tblSet.has('m2_transaction_journal') && tblSet.has('m1_coa');

    if (!hasSi && !hasSo) {
      throw new Error('Tabel penjualan MyERP Plus (m5_si / m5_so) tidak ditemukan pada database.');
    }

    const [siCols, siDetCols, soCols, soDetCols, doCols, doDetCols, srCols, srDetCols, contactCols, itemCols] =
      await Promise.all([
        hasSi ? getTableCols(conn, 'm5_si') : Promise.resolve([]),
        hasSiDet ? getTableCols(conn, 'm5_si_detail') : Promise.resolve([]),
        hasSo ? getTableCols(conn, 'm5_so') : Promise.resolve([]),
        hasSoDet ? getTableCols(conn, 'm5_so_detail') : Promise.resolve([]),
        hasDo ? getTableCols(conn, 'm5_do') : Promise.resolve([]),
        hasDoDet ? getTableCols(conn, 'm5_do_detail') : Promise.resolve([]),
        hasSr ? getTableCols(conn, 'm5_sr') : Promise.resolve([]),
        hasSrDet ? getTableCols(conn, 'm5_sr_detail') : Promise.resolve([]),
        hasContact ? getTableCols(conn, 'm1_contact') : Promise.resolve([]),
        hasItem ? getTableCols(conn, 'm1_item') : Promise.resolve([]),
      ]);

    // 1. Coverage dates across SI & SO
    let minDateAll = '';
    let maxDateAll = '';
    let minDateActive = '';
    let maxDateActive = '';

    const covQueries: Promise<RowDataPacket[]>[] = [];
    if (hasSi) {
      covQueries.push(
        conn
          .query<RowDataPacket[]>(
            `SELECT MIN(sitgl) AS mnAll, MAX(sitgl) AS mxAll,
                    MIN(CASE WHEN sitgl >= ? THEN sitgl END) AS mnAct,
                    MAX(CASE WHEN sitgl >= ? THEN sitgl END) AS mxAct
             FROM m5_si WHERE COALESCE(sistatus, 0) NOT IN (6, 12) AND sitgl IS NOT NULL`,
            [ACTIVE_ERP_CUTOFF_DATE, ACTIVE_ERP_CUTOFF_DATE]
          )
          .then(([r]) => r)
          .catch(() => [])
      );
    }
    if (hasSo) {
      covQueries.push(
        conn
          .query<RowDataPacket[]>(
            `SELECT MIN(sotgl) AS mnAll, MAX(sotgl) AS mxAll,
                    MIN(CASE WHEN sotgl >= ? THEN sotgl END) AS mnAct,
                    MAX(CASE WHEN sotgl >= ? THEN sotgl END) AS mxAct
             FROM m5_so WHERE COALESCE(sostatus, 0) NOT IN (6, 12) AND sotgl IS NOT NULL`,
            [ACTIVE_ERP_CUTOFF_DATE, ACTIVE_ERP_CUTOFF_DATE]
          )
          .then(([r]) => r)
          .catch(() => [])
      );
    }
    const covRes = await Promise.all(covQueries);
    for (const rows of covRes) {
      const r = rows[0];
      if (!r) continue;
      const mnA = formatDateIso(r.mnAll);
      const mxA = formatDateIso(r.mxAll);
      const mnAct = formatDateIso(r.mnAct);
      const mxAct = formatDateIso(r.mxAct);
      if (mnA && (!minDateAll || mnA < minDateAll)) minDateAll = mnA;
      if (mxA && (!maxDateAll || mxA > maxDateAll)) maxDateAll = mxA;
      if (mnAct && (!minDateActive || mnAct < minDateActive)) minDateActive = mnAct;
      if (mxAct && (!maxDateActive || mxAct > maxDateActive)) maxDateActive = mxAct;
    }

    const startYm = dateFrom.slice(0, 7);
    const effectiveDateTo = dateTo || maxDateActive || dateFrom.slice(0, 4) + '-12-31';
    const endYm = effectiveDateTo.slice(0, 7);
    const prevMonthDateFrom = `${shiftMonth(startYm, -1)}-01`;
    const rolling3mDateFrom = `${shiftMonth(startYm, -3)}-01`;

    const siDateToSql = dateTo ? ' AND si.sitgl <= ?' : '';
    const siDateToBind = dateTo ? [dateTo] : [];
    const soDateToSql = dateTo ? ' AND so.sotgl <= ?' : '';
    const soDateToBind = dateTo ? [dateTo] : [];
    const doDateToSql = dateTo ? ' AND d.dotgl <= ?' : '';
    const doDateToBind = dateTo ? [dateTo] : [];
    const srDateToSql = dateTo ? ' AND sr.srtgl <= ?' : '';
    const srDateToBind = dateTo ? [dateTo] : [];

    // Helper maps indexed by YYYY-MM
    const activeMonthsSet = new Set<string>();
    const siCustByMonth = new Map<string, Set<number>>();
    const soCustByMonth = new Map<string, Set<number>>();

    // 2. Active customers per month (KPI 01 & 03)
    if (hasSi) {
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT DATE_FORMAT(si.sitgl, '%Y-%m') AS ym, si.sicustomer AS cid
         FROM m5_si si
         WHERE COALESCE(si.sistatus, 0) NOT IN (6, 12)
           AND si.sitgl >= ? ${siDateToSql}
           AND si.sicustomer IS NOT NULL AND si.sicustomer > 0
         GROUP BY ym, si.sicustomer`,
        [rolling3mDateFrom, ...siDateToBind]
      );
      for (const r of rows) {
        const ym = String(r.ym || '');
        const cid = Number(r.cid || 0);
        if (!ym || !cid) continue;
        if (!siCustByMonth.has(ym)) siCustByMonth.set(ym, new Set());
        siCustByMonth.get(ym)!.add(cid);
        if (ym >= startYm && ym <= endYm) activeMonthsSet.add(ym);
      }
    }

    if (hasSo) {
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT DATE_FORMAT(so.sotgl, '%Y-%m') AS ym, so.socustomer AS cid
         FROM m5_so so
         WHERE COALESCE(so.sostatus, 0) NOT IN (6, 12)
           AND so.sotgl >= ? ${soDateToSql}
           AND so.socustomer IS NOT NULL AND so.socustomer > 0
         GROUP BY ym, so.socustomer`,
        [prevMonthDateFrom, ...soDateToBind]
      );
      for (const r of rows) {
        const ym = String(r.ym || '');
        const cid = Number(r.cid || 0);
        if (!ym || !cid) continue;
        if (!soCustByMonth.has(ym)) soCustByMonth.set(ym, new Set());
        soCustByMonth.get(ym)!.add(cid);
        if (ym >= startYm && ym <= endYm) activeMonthsSet.add(ym);
      }
    }

    // Master customer active/inactive counts from m1_contact
    let hasMasterCustomerStatus = false;
    let masterActiveCustomers = 0;
    let masterInactiveCustomers = 0;
    const contactActiveCol = pickExactCol(contactCols, ['kaktif', 'aktif', 'is_active', 'kstatusaktif']);
    if (hasContact && contactActiveCol && (hasSi || hasSo)) {
      try {
        const unionSql =
          hasSi && hasSo
            ? `SELECT DISTINCT sicustomer AS cid FROM m5_si WHERE sicustomer > 0
               UNION
               SELECT DISTINCT socustomer AS cid FROM m5_so WHERE socustomer > 0`
            : hasSi
              ? `SELECT DISTINCT sicustomer AS cid FROM m5_si WHERE sicustomer > 0`
              : `SELECT DISTINCT socustomer AS cid FROM m5_so WHERE socustomer > 0`;
        const [mRows] = await conn.query<RowDataPacket[]>(
          `SELECT
             SUM(CASE WHEN COALESCE(c.\`${contactActiveCol}\`, 1) <> 0 THEN 1 ELSE 0 END) AS actCnt,
             SUM(CASE WHEN COALESCE(c.\`${contactActiveCol}\`, 1) = 0 THEN 1 ELSE 0 END) AS inactCnt
           FROM m1_contact c
           INNER JOIN (${unionSql}) u ON u.cid = c.kid`
        );
        hasMasterCustomerStatus = true;
        masterActiveCustomers = Number(mRows[0]?.actCnt || 0);
        masterInactiveCustomers = Number(mRows[0]?.inactCnt || 0);
      } catch {
        hasMasterCustomerStatus = false;
      }
    }

    // 3. KPI 02: Customer Profitability (Sales - HPP per customer in [dateFrom, dateTo])
    const siDetSiFk = pickExactCol(siDetCols, ['idsi', 'siid', 'idtransaksi']);
    const siDetItemFk = pickExactCol(siDetCols, ['idbarang', 'barangid', 'itemid']);
    const siDetNameCol = pickExactCol(siDetCols, ['namabarang', 'bnama', 'nama']);
    const siDetQtyCol = pickExactCol(siDetCols, ['jml', 'qty', 'siqty', 'dqty', 'jumlah']);
    const siDetPriceCol = pickExactCol(siDetCols, ['harga', 'siharga', 'hargasatuan']);
    const siDetDiscCol = pickExactCol(siDetCols, ['jmldiskon', 'diskon', 'discount']);
    const siDetSubCol = pickExactCol(siDetCols, ['subtotal', 'total', 'jumlahharga']);
    const siDetHppTotalCol = pickExactCol(siDetCols, ['totalhpp', 'jmlhpp', 'subtotalhpp', 'sihpptotal']);
    const siDetHppUnitCol = pickExactCol(siDetCols, [
      'hpp',
      'sihpp',
      'hargapokok',
      'hargabeli',
      'modal',
      'cost',
      'cogs',
    ]);
    const itemHppCol = pickExactCol(itemCols, [
      'bhpp',
      'bhargapokok',
      'bhargabeli',
      'bmodal',
      'bhargastandar',
      'bhargadasar',
    ]);

    let hppSource: ErpSalesBiQueryResult['diagnostics']['hppSource'] = 'unavailable';
    const customerProfitability: ErpSalesBiCustomerProfitRow[] = [];

    if (hasSi) {
      const custCodeExpr = hasContact
        ? "COALESCE(NULLIF(TRIM(c.kkode), ''), CAST(si.sicustomer AS CHAR))"
        : 'CAST(si.sicustomer AS CHAR)';
      const custNameExpr = hasContact
        ? "COALESCE(NULLIF(TRIM(c.knama), ''), CONCAT('Customer #', si.sicustomer))"
        : "CONCAT('Customer #', si.sicustomer)";
      const contactJoin = hasContact ? 'LEFT JOIN m1_contact c ON c.kid = si.sicustomer' : '';

      const lineNetExpr =
        siDetQtyCol && siDetPriceCol
          ? `(COALESCE(d.\`${siDetQtyCol}\`, 0) * COALESCE(d.\`${siDetPriceCol}\`, 0) - ${siDetDiscCol ? `COALESCE(d.\`${siDetDiscCol}\`, 0)` : '0'})`
          : siDetSubCol
            ? `COALESCE(d.\`${siDetSubCol}\`, 0)`
            : '0';

      const salesMap = new Map<
        number,
        { customerId: number; customerCode: string; customerName: string; invoiceCount: number; salesAmount: number; cogsAmount: number }
      >();

      // Primary sales per customer from m5_si (net detail when available, else header total)
      const [siCustRows] = await conn.query<RowDataPacket[]>(
        `SELECT
           si.sicustomer AS customerId,
           ${custCodeExpr} AS customerCode,
           ${custNameExpr} AS customerName,
           COUNT(DISTINCT si.siid) AS invoiceCount,
           COALESCE(SUM(si.sitotaltransaksi), 0) AS headerSales
         FROM m5_si si
         ${contactJoin}
         WHERE COALESCE(si.sistatus, 0) NOT IN (6, 12)
           AND si.sitgl >= ? ${siDateToSql}
           AND si.sicustomer IS NOT NULL AND si.sicustomer > 0
         GROUP BY si.sicustomer, customerCode, customerName`,
        [dateFrom, ...siDateToBind]
      );
      for (const r of siCustRows) {
        const cid = Number(r.customerId || 0);
        if (!cid) continue;
        salesMap.set(cid, {
          customerId: cid,
          customerCode: String(r.customerCode || '-'),
          customerName: String(r.customerName || `Customer #${cid}`),
          invoiceCount: Number(r.invoiceCount || 0),
          salesAmount: Number(r.headerSales || 0),
          cogsAmount: 0,
        });
      }

      // Try HPP from m5_si_detail first (and refine net ex-PPN sales if detail present)
      if (hasSiDet && siDetSiFk && (siDetHppTotalCol || (siDetHppUnitCol && siDetQtyCol))) {
        try {
          const hppExpr = siDetHppTotalCol
            ? `COALESCE(d.\`${siDetHppTotalCol}\`, 0)`
            : `COALESCE(d.\`${siDetQtyCol}\`, 0) * COALESCE(d.\`${siDetHppUnitCol}\`, 0)`;
          const [detHppRows] = await conn.query<RowDataPacket[]>(
            `SELECT
               si.sicustomer AS customerId,
               COALESCE(SUM(${lineNetExpr}), 0) AS detailSales,
               COALESCE(SUM(${hppExpr}), 0) AS detailHpp
             FROM m5_si_detail d
             INNER JOIN m5_si si ON si.siid = d.\`${siDetSiFk}\`
             WHERE COALESCE(si.sistatus, 0) NOT IN (6, 12)
               AND si.sitgl >= ? ${siDateToSql}
               AND si.sicustomer IS NOT NULL AND si.sicustomer > 0
             GROUP BY si.sicustomer`,
            [dateFrom, ...siDateToBind]
          );
          let totalHpp = 0;
          for (const r of detHppRows) totalHpp += Number(r.detailHpp || 0);
          if (totalHpp > 0) {
            hppSource = 'm5_si_detail';
            for (const r of detHppRows) {
              const entry = salesMap.get(Number(r.customerId || 0));
              if (!entry) continue;
              const detSales = Number(r.detailSales || 0);
              if (detSales > 0) entry.salesAmount = detSales;
              entry.cogsAmount = Number(r.detailHpp || 0);
            }
          }
        } catch {
          // fallback next
        }
      }

      // Priority 2: GL COGS (m2_transaction_journal ctipe = 12 grouped by tkontak)
      if (hppSource === 'unavailable' && hasJournal) {
        try {
          const jDateToSql = dateTo ? ' AND j.ttgl <= ?' : '';
          const [glHppRows] = await conn.query<RowDataPacket[]>(
            `SELECT
               j.tkontak AS customerId,
               COALESCE(SUM(COALESCE(j.tdebit, 0) - COALESCE(j.tkredit, 0)), 0) AS glCogs
             FROM m2_transaction_journal j
             INNER JOIN m1_coa a ON a.cid = j.tcoa
             WHERE COALESCE(j.tstatus, 0) NOT IN (6, 12)
               AND COALESCE(j.tposting, 1) = 1
               AND a.cgd = 'D'
               AND a.ctipe = 12
               AND j.ttgl >= ? ${jDateToSql}
               AND j.tkontak IS NOT NULL AND j.tkontak > 0
             GROUP BY j.tkontak`,
            [dateFrom, ...(dateTo ? [dateTo] : [])]
          );
          let matchedCogs = 0;
          for (const r of glHppRows) {
            const cid = Number(r.customerId || 0);
            const cogs = Number(r.glCogs || 0);
            if (salesMap.has(cid) && cogs > 0) matchedCogs += cogs;
          }
          if (matchedCogs > 0) {
            hppSource = 'm2_transaction_journal';
            for (const r of glHppRows) {
              const entry = salesMap.get(Number(r.customerId || 0));
              if (entry) entry.cogsAmount = Math.max(0, Number(r.glCogs || 0));
            }
          }
        } catch {
          // fallback next
        }
      }

      // Priority 3: m1_item unit HPP * m5_si_detail qty
      if (hppSource === 'unavailable' && hasSiDet && hasItem && siDetSiFk && siDetItemFk && siDetQtyCol && itemHppCol) {
        try {
          const [itemHppRows] = await conn.query<RowDataPacket[]>(
            `SELECT
               si.sicustomer AS customerId,
               COALESCE(SUM(${lineNetExpr}), 0) AS detailSales,
               COALESCE(SUM(COALESCE(d.\`${siDetQtyCol}\`, 0) * COALESCE(i.\`${itemHppCol}\`, 0)), 0) AS itemHpp
             FROM m5_si_detail d
             INNER JOIN m5_si si ON si.siid = d.\`${siDetSiFk}\`
             LEFT JOIN m1_item i ON i.bid = d.\`${siDetItemFk}\`
             WHERE COALESCE(si.sistatus, 0) NOT IN (6, 12)
               AND si.sitgl >= ? ${siDateToSql}
               AND si.sicustomer IS NOT NULL AND si.sicustomer > 0
             GROUP BY si.sicustomer`,
            [dateFrom, ...siDateToBind]
          );
          let totalHpp = 0;
          for (const r of itemHppRows) totalHpp += Number(r.itemHpp || 0);
          if (totalHpp > 0) {
            hppSource = 'm1_item';
            for (const r of itemHppRows) {
              const entry = salesMap.get(Number(r.customerId || 0));
              if (!entry) continue;
              const detSales = Number(r.detailSales || 0);
              if (detSales > 0) entry.salesAmount = detSales;
              entry.cogsAmount = Number(r.itemHpp || 0);
            }
          }
        } catch {
          // keep unavailable
        }
      }

      for (const entry of salesMap.values()) {
        const profit = entry.salesAmount - entry.cogsAmount;
        const marginPct = entry.salesAmount > 0 ? (profit / entry.salesAmount) * 100 : 0;
        customerProfitability.push({
          ...entry,
          profitAmount: profit,
          marginPct,
        });
      }
      customerProfitability.sort((a, b) => b.profitAmount - a.profitAmount);
    }

    // 4. KPI 04 & 07: Monthly SO counts, values, and complete counts
    const soMonthlyMap = new Map<
      string,
      {
        soCount: number;
        soTotalValue: number;
        soCompleteCount: number;
        soCompleteOrCloseCount: number;
        soCompleteValue: number;
        soCompleteOrCloseValue: number;
      }
    >();
    const soCloseCol = pickExactCol(soCols, ['soisclose', 'isclose']);
    if (hasSo) {
      const closeCond = soCloseCol ? `OR COALESCE(so.\`${soCloseCol}\`, 0) = 1` : '';
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT
           DATE_FORMAT(so.sotgl, '%Y-%m') AS ym,
           COUNT(*) AS soCount,
           COALESCE(SUM(COALESCE(so.sototaltransaksi, 0)), 0) AS soTotalValue,
           SUM(CASE WHEN COALESCE(so.sostatus, 0) = 4 THEN 1 ELSE 0 END) AS soCompleteCount,
           SUM(CASE WHEN COALESCE(so.sostatus, 0) IN (4, 7) ${closeCond} THEN 1 ELSE 0 END) AS soCompleteOrCloseCount,
           COALESCE(SUM(CASE WHEN COALESCE(so.sostatus, 0) = 4 THEN COALESCE(so.sototaltransaksi, 0) ELSE 0 END), 0) AS soCompleteValue,
           COALESCE(SUM(CASE WHEN COALESCE(so.sostatus, 0) IN (4, 7) ${closeCond} THEN COALESCE(so.sototaltransaksi, 0) ELSE 0 END), 0) AS soCompleteOrCloseValue
         FROM m5_so so
         WHERE COALESCE(so.sostatus, 0) NOT IN (6, 12)
           AND so.sotgl >= ? ${soDateToSql}
         GROUP BY ym`,
        [prevMonthDateFrom, ...soDateToBind]
      );
      for (const r of rows) {
        const ym = String(r.ym || '');
        if (!ym) continue;
        soMonthlyMap.set(ym, {
          soCount: Number(r.soCount || 0),
          soTotalValue: Number(r.soTotalValue || 0),
          soCompleteCount: Number(r.soCompleteCount || 0),
          soCompleteOrCloseCount: Number(r.soCompleteOrCloseCount || 0),
          soCompleteValue: Number(r.soCompleteValue || 0),
          soCompleteOrCloseValue: Number(r.soCompleteOrCloseValue || 0),
        });
        if (ym >= startYm && ym <= endYm) activeMonthsSet.add(ym);
      }
    }

    // 5. KPI 06 & 06B: SO Realization (Qty & Value)
    const soDetSoFk = pickExactCol(soDetCols, ['idso', 'soid', 'idtransaksi']);
    const soDetItemFk = pickExactCol(soDetCols, ['idbarang', 'barangid', 'itemid']);
    const soDetQtyCol = pickExactCol(soDetCols, ['jml', 'qty', 'soqty', 'dqty', 'jumlah']);
    const soDetPriceCol = pickExactCol(soDetCols, ['harga', 'soharga', 'hargasatuan']);
    const soDetDiscCol = pickExactCol(soDetCols, ['jmldiskon', 'diskon', 'discount']);
    const soDetSubCol = pickExactCol(soDetCols, ['subtotal', 'total', 'jumlahharga']);
    const soDetRealizedCol = pickExactCol(soDetCols, [
      'jmlrealisasi',
      'jmldo',
      'jmlkirim',
      'qtydo',
      'qtykirim',
      'jmlterkirim',
    ]);

    const doDetDoFk = pickExactCol(doDetCols, ['iddo', 'doid', 'idtransaksi']);
    const doDetSoFk = pickExactCol(doDetCols, ['idso', 'soid', 'dosoid', 'idref']);
    const doDetItemFk = pickExactCol(doDetCols, ['idbarang', 'barangid', 'itemid']);
    const doDetNameCol = pickExactCol(doDetCols, ['namabarang', 'bnama', 'nama']);
    const doDetQtyCol = pickExactCol(doDetCols, ['jml', 'qty', 'doqty', 'dqty', 'jumlah']);
    const doDetPriceCol = pickExactCol(doDetCols, ['harga', 'doharga', 'hargasatuan']);
    const doDetDiscCol = pickExactCol(doDetCols, ['jmldiskon', 'diskon', 'discount']);
    const doDetSubCol = pickExactCol(doDetCols, ['subtotal', 'total', 'jumlahharga']);

    const siDetSoFk = pickExactCol(siDetCols, ['idso', 'soid', 'sisoid']);
    const siDetDoFk = pickExactCol(siDetCols, ['iddo', 'doid', 'sidoid', 'diddo']);

    let realizationSource: ErpSalesBiQueryResult['diagnostics']['realizationSource'] = 'm5_so_status';
    const soRealizationByMonth = new Map<
      string,
      { soItemQty: number; realizedItemQty: number; soTotalValue: number; realizedTotalValue: number }
    >();

    if (hasSo && hasSoDet && soDetSoFk && soDetQtyCol) {
      const soLineValExpr =
        soDetPriceCol
          ? `(COALESCE(sd.\`${soDetQtyCol}\`, 0) * COALESCE(sd.\`${soDetPriceCol}\`, 0) - ${soDetDiscCol ? `COALESCE(sd.\`${soDetDiscCol}\`, 0)` : '0'})`
          : soDetSubCol
            ? `COALESCE(sd.\`${soDetSubCol}\`, 0)`
            : '0';

      if (hasDo && hasDoDet && doDetDoFk && doDetSoFk && doDetQtyCol) {
        realizationSource = 'm5_do_detail';
        const doLineValExpr = doDetPriceCol
          ? `(COALESCE(dd.\`${doDetQtyCol}\`, 0) * COALESCE(dd.\`${doDetPriceCol}\`, 0) - ${doDetDiscCol ? `COALESCE(dd.\`${doDetDiscCol}\`, 0)` : '0'})`
          : doDetSubCol
            ? `COALESCE(dd.\`${doDetSubCol}\`, 0)`
            : '0';

        const [rows] = await conn.query<RowDataPacket[]>(
          `SELECT
             DATE_FORMAT(so.sotgl, '%Y-%m') AS ym,
             so.soid,
             COALESCE(so.sototaltransaksi, 0) AS soHeaderVal,
             COALESCE(sq.soQty, 0) AS soQty,
             COALESCE(sq.soLineVal, 0) AS soLineVal,
             COALESCE(dq.doQty, 0) AS doQty,
             COALESCE(dq.doLineVal, 0) AS doLineVal
           FROM m5_so so
           LEFT JOIN (
             SELECT \`${soDetSoFk}\` AS soid,
                    COALESCE(SUM(COALESCE(\`${soDetQtyCol}\`, 0)), 0) AS soQty,
                    COALESCE(SUM(${soLineValExpr}), 0) AS soLineVal
             FROM m5_so_detail sd
             GROUP BY \`${soDetSoFk}\`
           ) sq ON sq.soid = so.soid
           LEFT JOIN (
             SELECT dd.\`${doDetSoFk}\` AS soid,
                    COALESCE(SUM(COALESCE(dd.\`${doDetQtyCol}\`, 0)), 0) AS doQty,
                    COALESCE(SUM(${doLineValExpr}), 0) AS doLineVal
             FROM m5_do_detail dd
             INNER JOIN m5_do d ON d.doid = dd.\`${doDetDoFk}\`
             WHERE COALESCE(d.dostatus, 0) NOT IN (6, 12)
             GROUP BY dd.\`${doDetSoFk}\`
           ) dq ON dq.soid = so.soid
           WHERE COALESCE(so.sostatus, 0) NOT IN (6, 12)
             AND so.sotgl >= ? ${soDateToSql}`,
          [dateFrom, ...soDateToBind]
        );
        for (const r of rows) {
          const ym = String(r.ym || '');
          if (!ym) continue;
          const soQty = Math.max(0, Number(r.soQty || 0));
          const doQty = Math.max(0, Number(r.doQty || 0));
          const realQty = soQty > 0 ? Math.min(soQty, doQty) : doQty;
          const soVal = Math.max(0, Number(r.soHeaderVal || 0) > 0 ? Number(r.soHeaderVal) : Number(r.soLineVal || 0));
          const rawDoVal = Math.max(0, Number(r.doLineVal || 0));
          const realVal =
            rawDoVal > 0
              ? Math.min(soVal, rawDoVal)
              : soQty > 0
                ? Math.min(soVal, (realQty / soQty) * soVal)
                : 0;

          const cur = soRealizationByMonth.get(ym) || {
            soItemQty: 0,
            realizedItemQty: 0,
            soTotalValue: 0,
            realizedTotalValue: 0,
          };
          cur.soItemQty += soQty;
          cur.realizedItemQty += realQty;
          cur.soTotalValue += soVal;
          cur.realizedTotalValue += realVal;
          soRealizationByMonth.set(ym, cur);
          activeMonthsSet.add(ym);
        }
      } else if (hasSi && hasSiDet && siDetSiFk && siDetSoFk && siDetQtyCol) {
        realizationSource = 'm5_si_detail';
        const siLineValExpr = siDetPriceCol
          ? `(COALESCE(sd2.\`${siDetQtyCol}\`, 0) * COALESCE(sd2.\`${siDetPriceCol}\`, 0) - ${siDetDiscCol ? `COALESCE(sd2.\`${siDetDiscCol}\`, 0)` : '0'})`
          : siDetSubCol
            ? `COALESCE(sd2.\`${siDetSubCol}\`, 0)`
            : '0';
        const [rows] = await conn.query<RowDataPacket[]>(
          `SELECT
             DATE_FORMAT(so.sotgl, '%Y-%m') AS ym,
             COALESCE(so.sototaltransaksi, 0) AS soHeaderVal,
             COALESCE(sq.soQty, 0) AS soQty,
             COALESCE(sq.soLineVal, 0) AS soLineVal,
             COALESCE(iq.siQty, 0) AS siQty,
             COALESCE(iq.siLineVal, 0) AS siLineVal
           FROM m5_so so
           LEFT JOIN (
             SELECT \`${soDetSoFk}\` AS soid,
                    COALESCE(SUM(COALESCE(\`${soDetQtyCol}\`, 0)), 0) AS soQty,
                    COALESCE(SUM(${soLineValExpr}), 0) AS soLineVal
             FROM m5_so_detail sd
             GROUP BY \`${soDetSoFk}\`
           ) sq ON sq.soid = so.soid
           LEFT JOIN (
             SELECT sd2.\`${siDetSoFk}\` AS soid,
                    COALESCE(SUM(COALESCE(sd2.\`${siDetQtyCol}\`, 0)), 0) AS siQty,
                    COALESCE(SUM(${siLineValExpr}), 0) AS siLineVal
             FROM m5_si_detail sd2
             INNER JOIN m5_si si ON si.siid = sd2.\`${siDetSiFk}\`
             WHERE COALESCE(si.sistatus, 0) NOT IN (6, 12)
             GROUP BY sd2.\`${siDetSoFk}\`
           ) iq ON iq.soid = so.soid
           WHERE COALESCE(so.sostatus, 0) NOT IN (6, 12)
             AND so.sotgl >= ? ${soDateToSql}`,
          [dateFrom, ...soDateToBind]
        );
        for (const r of rows) {
          const ym = String(r.ym || '');
          if (!ym) continue;
          const soQty = Math.max(0, Number(r.soQty || 0));
          const siQty = Math.max(0, Number(r.siQty || 0));
          const realQty = soQty > 0 ? Math.min(soQty, siQty) : siQty;
          const soVal = Math.max(0, Number(r.soHeaderVal || 0) > 0 ? Number(r.soHeaderVal) : Number(r.soLineVal || 0));
          const rawSiVal = Math.max(0, Number(r.siLineVal || 0));
          const realVal =
            rawSiVal > 0
              ? Math.min(soVal, rawSiVal)
              : soQty > 0
                ? Math.min(soVal, (realQty / soQty) * soVal)
                : 0;

          const cur = soRealizationByMonth.get(ym) || {
            soItemQty: 0,
            realizedItemQty: 0,
            soTotalValue: 0,
            realizedTotalValue: 0,
          };
          cur.soItemQty += soQty;
          cur.realizedItemQty += realQty;
          cur.soTotalValue += soVal;
          cur.realizedTotalValue += realVal;
          soRealizationByMonth.set(ym, cur);
          activeMonthsSet.add(ym);
        }
      } else if (soDetRealizedCol) {
        realizationSource = 'm5_so_detail';
        const [rows] = await conn.query<RowDataPacket[]>(
          `SELECT
             DATE_FORMAT(so.sotgl, '%Y-%m') AS ym,
             COALESCE(SUM(COALESCE(sd.\`${soDetQtyCol}\`, 0)), 0) AS soQty,
             COALESCE(SUM(LEAST(COALESCE(sd.\`${soDetQtyCol}\`, 0), COALESCE(sd.\`${soDetRealizedCol}\`, 0))), 0) AS realQty,
             COALESCE(SUM(${soLineValExpr}), 0) AS soVal
           FROM m5_so_detail sd
           INNER JOIN m5_so so ON so.soid = sd.\`${soDetSoFk}\`
           WHERE COALESCE(so.sostatus, 0) NOT IN (6, 12)
             AND so.sotgl >= ? ${soDateToSql}
           GROUP BY ym`,
          [dateFrom, ...soDateToBind]
        );
        for (const r of rows) {
          const ym = String(r.ym || '');
          if (!ym) continue;
          const soQty = Math.max(0, Number(r.soQty || 0));
          const realQty = Math.max(0, Number(r.realQty || 0));
          const soVal = Math.max(0, Number(r.soVal || 0));
          const realVal = soQty > 0 ? (realQty / soQty) * soVal : 0;
          soRealizationByMonth.set(ym, {
            soItemQty: soQty,
            realizedItemQty: realQty,
            soTotalValue: soVal,
            realizedTotalValue: realVal,
          });
          activeMonthsSet.add(ym);
        }
      }
    }

    // 6. KPI 08: Perubahan Harga (Consumer Price Index) per month + detail items
    const cpiDetailsByMonth: Record<string, ErpSalesBiCpiDetailItem[]> = {};
    const cpiSummaryByMonth = new Map<
      string,
      { prevBasket: number; currBasket: number; pct: number; itemCount: number }
    >();

    if (hasSi && hasSiDet && siDetSiFk && siDetItemFk && siDetPriceCol) {
      try {
        const itemCodeExpr = hasItem
          ? `COALESCE(NULLIF(TRIM(i.bkode), ''), CAST(d.\`${siDetItemFk}\` AS CHAR))`
          : `CAST(d.\`${siDetItemFk}\` AS CHAR)`;
        const itemNameExpr = hasItem
          ? siDetNameCol
            ? `COALESCE(NULLIF(TRIM(d.\`${siDetNameCol}\`), ''), NULLIF(TRIM(i.bnama), ''), CONCAT('Barang #', d.\`${siDetItemFk}\`))`
            : `COALESCE(NULLIF(TRIM(i.bnama), ''), CONCAT('Barang #', d.\`${siDetItemFk}\`))`
          : siDetNameCol
            ? `COALESCE(NULLIF(TRIM(d.\`${siDetNameCol}\`), ''), CONCAT('Barang #', d.\`${siDetItemFk}\`))`
            : `CONCAT('Barang #', d.\`${siDetItemFk}\`)`;

        const [priceRows] = await conn.query<RowDataPacket[]>(
          `SELECT
             DATE_FORMAT(si.sitgl, '%Y-%m') AS ym,
             d.\`${siDetItemFk}\` AS itemId,
             MAX(${itemCodeExpr}) AS itemCode,
             MAX(${itemNameExpr}) AS itemName,
             SUBSTRING_INDEX(
               GROUP_CONCAT(d.\`${siDetPriceCol}\` ORDER BY si.sitgl DESC, si.siid DESC SEPARATOR ','),
               ',',
               1
             ) AS lastPrice
           FROM m5_si_detail d
           INNER JOIN m5_si si ON si.siid = d.\`${siDetSiFk}\`
           ${hasItem ? `LEFT JOIN m1_item i ON i.bid = d.\`${siDetItemFk}\`` : ''}
           WHERE COALESCE(si.sistatus, 0) NOT IN (6, 12)
             AND si.sitgl >= ? ${siDateToSql}
             AND COALESCE(d.\`${siDetPriceCol}\`, 0) > 0
             AND d.\`${siDetItemFk}\` IS NOT NULL AND d.\`${siDetItemFk}\` > 0
           GROUP BY ym, d.\`${siDetItemFk}\``,
          [prevMonthDateFrom, ...siDateToBind]
        );

        const priceByMonthItem = new Map<
          string,
          Map<number, { itemId: number; itemCode: string; itemName: string; price: number }>
        >();
        for (const r of priceRows) {
          const ym = String(r.ym || '');
          const itemId = Number(r.itemId || 0);
          const price = Number(r.lastPrice || 0);
          if (!ym || !itemId || price <= 0) continue;
          if (!priceByMonthItem.has(ym)) priceByMonthItem.set(ym, new Map());
          priceByMonthItem.get(ym)!.set(itemId, {
            itemId,
            itemCode: String(r.itemCode || itemId),
            itemName: String(r.itemName || `Barang #${itemId}`),
            price,
          });
        }

        const allPriceMonths = Array.from(priceByMonthItem.keys()).sort();
        const lastKnownPrice = new Map<number, number>();
        for (const ym of allPriceMonths) {
          const currMap = priceByMonthItem.get(ym)!;
          if (ym >= startYm && ym <= endYm) {
            const prevYm = shiftMonth(ym, -1);
            const prevMap = priceByMonthItem.get(prevYm);
            const details: ErpSalesBiCpiDetailItem[] = [];
            let sumPrev = 0;
            let sumCurr = 0;

            for (const [itemId, curr] of currMap.entries()) {
              const prevPrice = prevMap?.get(itemId)?.price ?? lastKnownPrice.get(itemId) ?? 0;
              if (prevPrice > 0) {
                const varianceRp = curr.price - prevPrice;
                const variancePct = (varianceRp / prevPrice) * 100;
                details.push({
                  itemId,
                  itemCode: curr.itemCode,
                  itemName: curr.itemName,
                  prevPrice,
                  currPrice: curr.price,
                  varianceRp,
                  variancePct,
                });
                sumPrev += prevPrice;
                sumCurr += curr.price;
              }
            }
            details.sort((a, b) => Math.abs(b.variancePct) - Math.abs(a.variancePct));
            cpiDetailsByMonth[ym] = details;
            cpiSummaryByMonth.set(ym, {
              prevBasket: sumPrev,
              currBasket: sumCurr,
              pct: sumPrev > 0 ? ((sumCurr - sumPrev) / sumPrev) * 100 : 0,
              itemCount: details.length,
            });
          }
          // Update carry-forward last known prices after processing ym
          for (const [itemId, curr] of currMap.entries()) {
            lastKnownPrice.set(itemId, curr.price);
          }
        }
      } catch {
        // Ignore if CPI columns unavailable
      }
    }

    // 7. KPI 09: Delivery On Time (IV vs SO target date & DO vs SO target date)
    const soShipDateCol = pickExactCol(soCols, ['sotglkirim', 'tglkirim', 'sotgltarget']);
    const doShipDateCol = pickExactCol(doCols, ['dotglkirim', 'tglkirim']);
    const dotSource: ErpSalesBiQueryResult['diagnostics']['dotSource'] = soShipDateCol
      ? 'so_sotglkirim'
      : hasSo
        ? 'so_sotgl'
        : 'do_vs_si';

    const dotByMonth = new Map<
      string,
      {
        ivTotal: number;
        ivOnTime: number;
        ivLinked: number;
        ivLinkedOnTime: number;
        doTotal: number;
        doOnTime: number;
        doLinked: number;
        doLinkedOnTime: number;
      }
    >();

    const soTargetExpr = soShipDateCol
      ? `COALESCE(NULLIF(so.\`${soShipDateCol}\`, '0000-00-00'), so.sotgl)`
      : 'so.sotgl';

    if (hasSi) {
      let siSoJoinSql = '';
      let hasSiTarget = false;
      if (hasSo && hasSiDet && siDetSiFk && siDetSoFk) {
        hasSiTarget = true;
        siSoJoinSql = `LEFT JOIN (
          SELECT sd.\`${siDetSiFk}\` AS siid, MAX(${soTargetExpr}) AS targetDate
          FROM m5_si_detail sd
          INNER JOIN m5_so so ON so.soid = sd.\`${siDetSoFk}\`
          WHERE COALESCE(so.sostatus, 0) NOT IN (6, 12)
          GROUP BY sd.\`${siDetSiFk}\`
        ) tgt ON tgt.siid = si.siid`;
      } else if (hasSo && hasSiDet && hasDo && hasDoDet && siDetSiFk && siDetDoFk && doDetDoFk && doDetSoFk) {
        hasSiTarget = true;
        siSoJoinSql = `LEFT JOIN (
          SELECT sd.\`${siDetSiFk}\` AS siid, MAX(${soTargetExpr}) AS targetDate
          FROM m5_si_detail sd
          INNER JOIN m5_do_detail dd ON dd.\`${doDetDoFk}\` = sd.\`${siDetDoFk}\`
          INNER JOIN m5_so so ON so.soid = dd.\`${doDetSoFk}\`
          WHERE COALESCE(so.sostatus, 0) NOT IN (6, 12)
          GROUP BY sd.\`${siDetSiFk}\`
        ) tgt ON tgt.siid = si.siid`;
      }

      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT
           DATE_FORMAT(si.sitgl, '%Y-%m') AS ym,
           COUNT(*) AS ivTotal,
           ${
             hasSiTarget
               ? `SUM(CASE WHEN tgt.targetDate IS NOT NULL THEN 1 ELSE 0 END) AS ivLinked,
                  SUM(CASE WHEN tgt.targetDate IS NOT NULL AND si.sitgl <= tgt.targetDate THEN 1 ELSE 0 END) AS ivLinkedOnTime,
                  SUM(CASE WHEN tgt.targetDate IS NULL OR si.sitgl <= tgt.targetDate THEN 1 ELSE 0 END) AS ivOnTime`
               : `0 AS ivLinked, 0 AS ivLinkedOnTime, COUNT(*) AS ivOnTime`
           }
         FROM m5_si si
         ${siSoJoinSql}
         WHERE COALESCE(si.sistatus, 0) NOT IN (6, 12)
           AND si.sitgl >= ? ${siDateToSql}
         GROUP BY ym`,
        [dateFrom, ...siDateToBind]
      );
      for (const r of rows) {
        const ym = String(r.ym || '');
        if (!ym) continue;
        const cur = dotByMonth.get(ym) || {
          ivTotal: 0,
          ivOnTime: 0,
          ivLinked: 0,
          ivLinkedOnTime: 0,
          doTotal: 0,
          doOnTime: 0,
          doLinked: 0,
          doLinkedOnTime: 0,
        };
        cur.ivTotal = Number(r.ivTotal || 0);
        cur.ivOnTime = Number(r.ivOnTime || 0);
        cur.ivLinked = Number(r.ivLinked || 0);
        cur.ivLinkedOnTime = Number(r.ivLinkedOnTime || 0);
        dotByMonth.set(ym, cur);
        activeMonthsSet.add(ym);
      }
    }

    if (hasDo) {
      const doActualDateExpr = doShipDateCol
        ? `COALESCE(NULLIF(d.\`${doShipDateCol}\`, '0000-00-00'), d.dotgl)`
        : 'd.dotgl';
      const hasDoTarget = Boolean(hasSo && hasDoDet && doDetDoFk && doDetSoFk);
      const doSoJoinSql = hasDoTarget
        ? `LEFT JOIN (
             SELECT dd.\`${doDetDoFk}\` AS doid, MAX(${soTargetExpr}) AS targetDate
             FROM m5_do_detail dd
             INNER JOIN m5_so so ON so.soid = dd.\`${doDetSoFk}\`
             WHERE COALESCE(so.sostatus, 0) NOT IN (6, 12)
             GROUP BY dd.\`${doDetDoFk}\`
           ) tgt ON tgt.doid = d.doid`
        : '';

      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT
           DATE_FORMAT(d.dotgl, '%Y-%m') AS ym,
           COUNT(*) AS doTotal,
           ${
             hasDoTarget
               ? `SUM(CASE WHEN tgt.targetDate IS NOT NULL THEN 1 ELSE 0 END) AS doLinked,
                  SUM(CASE WHEN tgt.targetDate IS NOT NULL AND ${doActualDateExpr} <= tgt.targetDate THEN 1 ELSE 0 END) AS doLinkedOnTime,
                  SUM(CASE WHEN tgt.targetDate IS NULL OR ${doActualDateExpr} <= tgt.targetDate THEN 1 ELSE 0 END) AS doOnTime`
               : `0 AS doLinked, 0 AS doLinkedOnTime, COUNT(*) AS doOnTime`
           }
         FROM m5_do d
         ${doSoJoinSql}
         WHERE COALESCE(d.dostatus, 0) NOT IN (6, 12)
           AND d.dotgl >= ? ${doDateToSql}
         GROUP BY ym`,
        [dateFrom, ...doDateToBind]
      );
      for (const r of rows) {
        const ym = String(r.ym || '');
        if (!ym) continue;
        const cur = dotByMonth.get(ym) || {
          ivTotal: 0,
          ivOnTime: 0,
          ivLinked: 0,
          ivLinkedOnTime: 0,
          doTotal: 0,
          doOnTime: 0,
          doLinked: 0,
          doLinkedOnTime: 0,
        };
        cur.doTotal = Number(r.doTotal || 0);
        cur.doOnTime = Number(r.doOnTime || 0);
        cur.doLinked = Number(r.doLinked || 0);
        cur.doLinkedOnTime = Number(r.doLinkedOnTime || 0);
        dotByMonth.set(ym, cur);
        activeMonthsSet.add(ym);
      }
    }

    // 8. KPI 10 (Retur Penjualan) & KPI 10B (Barang Tidak Sesuai Pesanan)
    const srDetSrFk = pickExactCol(srDetCols, ['idsr', 'srid', 'idtransaksi']);
    const srDetItemFk = pickExactCol(srDetCols, ['idbarang', 'barangid', 'itemid']);
    const srDetNameCol = pickExactCol(srDetCols, ['namabarang', 'bnama', 'nama']);
    const srDetQtyCol = pickExactCol(srDetCols, ['jml', 'qty', 'srqty', 'dqty', 'jumlah']);

    const returnDocByMonth = new Map<string, { count: number; value: number }>();
    const soldValueByMonth = new Map<string, number>();

    if (hasSr) {
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT DATE_FORMAT(sr.srtgl, '%Y-%m') AS ym,
                COUNT(*) AS cnt,
                COALESCE(SUM(COALESCE(sr.srtotaltransaksi, 0)), 0) AS val
         FROM m5_sr sr
         WHERE COALESCE(sr.srstatus, 0) NOT IN (6, 12)
           AND sr.srtgl >= ? ${srDateToSql}
         GROUP BY ym`,
        [dateFrom, ...srDateToBind]
      );
      for (const r of rows) {
        const ym = String(r.ym || '');
        if (!ym) continue;
        returnDocByMonth.set(ym, { count: Number(r.cnt || 0), value: Number(r.val || 0) });
        activeMonthsSet.add(ym);
      }
    }

    if (hasSi) {
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT DATE_FORMAT(si.sitgl, '%Y-%m') AS ym,
                COALESCE(SUM(COALESCE(si.sitotaltransaksi, 0)), 0) AS val
         FROM m5_si si
         WHERE COALESCE(si.sistatus, 0) NOT IN (6, 12)
           AND si.sitgl >= ? ${siDateToSql}
         GROUP BY ym`,
        [dateFrom, ...siDateToBind]
      );
      for (const r of rows) {
        const ym = String(r.ym || '');
        if (!ym) continue;
        soldValueByMonth.set(ym, Number(r.val || 0));
      }
    }

    // Per (month, itemId) sold qty, return qty, delivered qty, and DO-vs-SO variance qty
    type ItemMonthStat = {
      itemId: number;
      itemCode: string;
      itemName: string;
      soldQty: number;
      returnQty: number;
      deliveredQty: number;
      varianceQty: number;
    };
    const itemStatsByMonth = new Map<string, Map<number, ItemMonthStat>>();

    const ensureItemStat = (ym: string, itemId: number, code: string, name: string): ItemMonthStat => {
      if (!itemStatsByMonth.has(ym)) itemStatsByMonth.set(ym, new Map());
      const m = itemStatsByMonth.get(ym)!;
      let cur = m.get(itemId);
      if (!cur) {
        cur = {
          itemId,
          itemCode: code || String(itemId),
          itemName: name || `Barang #${itemId}`,
          soldQty: 0,
          returnQty: 0,
          deliveredQty: 0,
          varianceQty: 0,
        };
        m.set(itemId, cur);
      } else {
        if ((!cur.itemCode || cur.itemCode === String(itemId)) && code) cur.itemCode = code;
        if ((!cur.itemName || cur.itemName.startsWith('Barang #')) && name) cur.itemName = name;
      }
      return cur;
    };

    if (hasSi && hasSiDet && siDetSiFk && siDetItemFk && siDetQtyCol) {
      const iCode = hasItem
        ? `COALESCE(NULLIF(TRIM(i.bkode), ''), CAST(d.\`${siDetItemFk}\` AS CHAR))`
        : `CAST(d.\`${siDetItemFk}\` AS CHAR)`;
      const iName = hasItem
        ? siDetNameCol
          ? `COALESCE(NULLIF(TRIM(d.\`${siDetNameCol}\`), ''), NULLIF(TRIM(i.bnama), ''), CONCAT('Barang #', d.\`${siDetItemFk}\`))`
          : `COALESCE(NULLIF(TRIM(i.bnama), ''), CONCAT('Barang #', d.\`${siDetItemFk}\`))`
        : siDetNameCol
          ? `COALESCE(NULLIF(TRIM(d.\`${siDetNameCol}\`), ''), CONCAT('Barang #', d.\`${siDetItemFk}\`))`
          : `CONCAT('Barang #', d.\`${siDetItemFk}\`)`;
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT DATE_FORMAT(si.sitgl, '%Y-%m') AS ym,
                d.\`${siDetItemFk}\` AS itemId,
                MAX(${iCode}) AS itemCode,
                MAX(${iName}) AS itemName,
                COALESCE(SUM(COALESCE(d.\`${siDetQtyCol}\`, 0)), 0) AS qty
         FROM m5_si_detail d
         INNER JOIN m5_si si ON si.siid = d.\`${siDetSiFk}\`
         ${hasItem ? `LEFT JOIN m1_item i ON i.bid = d.\`${siDetItemFk}\`` : ''}
         WHERE COALESCE(si.sistatus, 0) NOT IN (6, 12)
           AND si.sitgl >= ? ${siDateToSql}
           AND d.\`${siDetItemFk}\` IS NOT NULL AND d.\`${siDetItemFk}\` > 0
         GROUP BY ym, d.\`${siDetItemFk}\``,
        [dateFrom, ...siDateToBind]
      );
      for (const r of rows) {
        const ym = String(r.ym || '');
        const itemId = Number(r.itemId || 0);
        if (!ym || !itemId) continue;
        const st = ensureItemStat(ym, itemId, String(r.itemCode || ''), String(r.itemName || ''));
        st.soldQty += Math.max(0, Number(r.qty || 0));
        activeMonthsSet.add(ym);
      }
    }

    if (hasSr && hasSrDet && srDetSrFk && srDetItemFk && srDetQtyCol) {
      const iCode = hasItem
        ? `COALESCE(NULLIF(TRIM(i.bkode), ''), CAST(d.\`${srDetItemFk}\` AS CHAR))`
        : `CAST(d.\`${srDetItemFk}\` AS CHAR)`;
      const iName = hasItem
        ? srDetNameCol
          ? `COALESCE(NULLIF(TRIM(d.\`${srDetNameCol}\`), ''), NULLIF(TRIM(i.bnama), ''), CONCAT('Barang #', d.\`${srDetItemFk}\`))`
          : `COALESCE(NULLIF(TRIM(i.bnama), ''), CONCAT('Barang #', d.\`${srDetItemFk}\`))`
        : srDetNameCol
          ? `COALESCE(NULLIF(TRIM(d.\`${srDetNameCol}\`), ''), CONCAT('Barang #', d.\`${srDetItemFk}\`))`
          : `CONCAT('Barang #', d.\`${srDetItemFk}\`)`;
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT DATE_FORMAT(sr.srtgl, '%Y-%m') AS ym,
                d.\`${srDetItemFk}\` AS itemId,
                MAX(${iCode}) AS itemCode,
                MAX(${iName}) AS itemName,
                COALESCE(SUM(COALESCE(d.\`${srDetQtyCol}\`, 0)), 0) AS qty
         FROM m5_sr_detail d
         INNER JOIN m5_sr sr ON sr.srid = d.\`${srDetSrFk}\`
         ${hasItem ? `LEFT JOIN m1_item i ON i.bid = d.\`${srDetItemFk}\`` : ''}
         WHERE COALESCE(sr.srstatus, 0) NOT IN (6, 12)
           AND sr.srtgl >= ? ${srDateToSql.replaceAll('d.dotgl', 'sr.srtgl')}
           AND d.\`${srDetItemFk}\` IS NOT NULL AND d.\`${srDetItemFk}\` > 0
         GROUP BY ym, d.\`${srDetItemFk}\``,
        [dateFrom, ...srDateToBind]
      );
      for (const r of rows) {
        const ym = String(r.ym || '');
        const itemId = Number(r.itemId || 0);
        if (!ym || !itemId) continue;
        const st = ensureItemStat(ym, itemId, String(r.itemCode || ''), String(r.itemName || ''));
        st.returnQty += Math.max(0, Number(r.qty || 0));
        activeMonthsSet.add(ym);
      }
    }

    if (hasDo && hasDoDet && doDetDoFk && doDetItemFk && doDetQtyCol) {
      const iCode = hasItem
        ? `COALESCE(NULLIF(TRIM(i.bkode), ''), CAST(dd.\`${doDetItemFk}\` AS CHAR))`
        : `CAST(dd.\`${doDetItemFk}\` AS CHAR)`;
      const iName = hasItem
        ? doDetNameCol
          ? `COALESCE(NULLIF(TRIM(dd.\`${doDetNameCol}\`), ''), NULLIF(TRIM(i.bnama), ''), CONCAT('Barang #', dd.\`${doDetItemFk}\`))`
          : `COALESCE(NULLIF(TRIM(i.bnama), ''), CONCAT('Barang #', dd.\`${doDetItemFk}\`))`
        : doDetNameCol
          ? `COALESCE(NULLIF(TRIM(dd.\`${doDetNameCol}\`), ''), CONCAT('Barang #', dd.\`${doDetItemFk}\`))`
          : `CONCAT('Barang #', dd.\`${doDetItemFk}\`)`;
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT DATE_FORMAT(d.dotgl, '%Y-%m') AS ym,
                dd.\`${doDetItemFk}\` AS itemId,
                MAX(${iCode}) AS itemCode,
                MAX(${iName}) AS itemName,
                COALESCE(SUM(COALESCE(dd.\`${doDetQtyCol}\`, 0)), 0) AS qty
         FROM m5_do_detail dd
         INNER JOIN m5_do d ON d.doid = dd.\`${doDetDoFk}\`
         ${hasItem ? `LEFT JOIN m1_item i ON i.bid = dd.\`${doDetItemFk}\`` : ''}
         WHERE COALESCE(d.dostatus, 0) NOT IN (6, 12)
           AND d.dotgl >= ? ${doDateToSql}
           AND dd.\`${doDetItemFk}\` IS NOT NULL AND dd.\`${doDetItemFk}\` > 0
         GROUP BY ym, dd.\`${doDetItemFk}\``,
        [dateFrom, ...doDateToBind]
      );
      for (const r of rows) {
        const ym = String(r.ym || '');
        const itemId = Number(r.itemId || 0);
        if (!ym || !itemId) continue;
        const st = ensureItemStat(ym, itemId, String(r.itemCode || ''), String(r.itemName || ''));
        st.deliveredQty += Math.max(0, Number(r.qty || 0));
        activeMonthsSet.add(ym);
      }

      // Compute DO vs SO variance per (SO, item) for KPI 10B variance basis
      if (hasSo && hasSoDet && soDetSoFk && soDetItemFk && soDetQtyCol && doDetSoFk) {
        try {
          const [varRows] = await conn.query<RowDataPacket[]>(
            `SELECT
               DATE_FORMAT(d.dotgl, '%Y-%m') AS ym,
               dd.\`${doDetItemFk}\` AS itemId,
               COALESCE(SUM(COALESCE(dd.\`${doDetQtyCol}\`, 0)), 0) AS doQty,
               COALESCE(MAX(sq.soQty), 0) AS soQty
             FROM m5_do_detail dd
             INNER JOIN m5_do d ON d.doid = dd.\`${doDetDoFk}\`
             LEFT JOIN (
               SELECT \`${soDetSoFk}\` AS soid, \`${soDetItemFk}\` AS itemId,
                      COALESCE(SUM(COALESCE(\`${soDetQtyCol}\`, 0)), 0) AS soQty
               FROM m5_so_detail
               GROUP BY \`${soDetSoFk}\`, \`${soDetItemFk}\`
             ) sq ON sq.soid = dd.\`${doDetSoFk}\` AND sq.itemId = dd.\`${doDetItemFk}\`
             WHERE COALESCE(d.dostatus, 0) NOT IN (6, 12)
               AND d.dotgl >= ? ${doDateToSql}
               AND dd.\`${doDetSoFk}\` IS NOT NULL AND dd.\`${doDetSoFk}\` > 0
               AND dd.\`${doDetItemFk}\` IS NOT NULL AND dd.\`${doDetItemFk}\` > 0
             GROUP BY ym, dd.\`${doDetSoFk}\`, dd.\`${doDetItemFk}\``,
            [dateFrom, ...doDateToBind]
          );
          for (const r of varRows) {
            const ym = String(r.ym || '');
            const itemId = Number(r.itemId || 0);
            if (!ym || !itemId) continue;
            const doQ = Math.max(0, Number(r.doQty || 0));
            const soQ = Math.max(0, Number(r.soQty || 0));
            const diff = Math.abs(doQ - soQ);
            if (diff > 0) {
              const st = ensureItemStat(ym, itemId, '', '');
              st.varianceQty += diff;
            }
          }
        } catch {
          // Optional variance query
        }
      }
    }

    // 9. KPI 11: Pengiriman Barang (Delivery Order) 0..14 Hari Lead Time Matrix
    const deliveryLeadTime: ErpSalesBiDeliveryLeadTimeRow[] = [];
    if (hasDo && hasDoDet && doDetDoFk && doDetItemFk) {
      try {
        const doActualExpr = doShipDateCol
          ? `COALESCE(NULLIF(d.\`${doShipDateCol}\`, '0000-00-00'), d.dotgl)`
          : 'd.dotgl';
        const hasSoLink = Boolean(hasSo && doDetSoFk);
        const leadExpr = hasSoLink
          ? `GREATEST(0, DATEDIFF(${doActualExpr}, COALESCE(so.sotgl, d.dotgl)))`
          : `GREATEST(0, DATEDIFF(${doActualExpr}, d.dotgl))`;
        const iCode = hasItem
          ? `COALESCE(NULLIF(TRIM(i.bkode), ''), CAST(dd.\`${doDetItemFk}\` AS CHAR))`
          : `CAST(dd.\`${doDetItemFk}\` AS CHAR)`;
        const iName = hasItem
          ? doDetNameCol
            ? `COALESCE(NULLIF(TRIM(dd.\`${doDetNameCol}\`), ''), NULLIF(TRIM(i.bnama), ''), CONCAT('Barang #', dd.\`${doDetItemFk}\`))`
            : `COALESCE(NULLIF(TRIM(i.bnama), ''), CONCAT('Barang #', dd.\`${doDetItemFk}\`))`
          : doDetNameCol
            ? `COALESCE(NULLIF(TRIM(dd.\`${doDetNameCol}\`), ''), CONCAT('Barang #', dd.\`${doDetItemFk}\`))`
            : `CONCAT('Barang #', dd.\`${doDetItemFk}\`)`;

        const [ltRows] = await conn.query<RowDataPacket[]>(
          `SELECT
             dd.\`${doDetItemFk}\` AS itemId,
             MAX(${iCode}) AS itemCode,
             MAX(${iName}) AS itemName,
             LEAST(15, ${leadExpr}) AS bucketIdx,
             COUNT(DISTINCT d.doid) AS deliveryCount,
             SUM(${leadExpr}) AS sumLeadDays
           FROM m5_do_detail dd
           INNER JOIN m5_do d ON d.doid = dd.\`${doDetDoFk}\`
           ${hasSoLink ? `LEFT JOIN m5_so so ON so.soid = dd.\`${doDetSoFk}\`` : ''}
           ${hasItem ? `LEFT JOIN m1_item i ON i.bid = dd.\`${doDetItemFk}\`` : ''}
           WHERE COALESCE(d.dostatus, 0) NOT IN (6, 12)
             AND d.dotgl >= ? ${doDateToSql}
             AND dd.\`${doDetItemFk}\` IS NOT NULL AND dd.\`${doDetItemFk}\` > 0
           GROUP BY dd.\`${doDetItemFk}\`, bucketIdx`,
          [dateFrom, ...doDateToBind]
        );

        const ltMap = new Map<
          number,
          { itemId: number; itemCode: string; itemName: string; buckets: number[]; total: number; sumDays: number }
        >();
        for (const r of ltRows) {
          const itemId = Number(r.itemId || 0);
          const idx = Math.max(0, Math.min(15, Number(r.bucketIdx || 0)));
          const cnt = Number(r.deliveryCount || 0);
          const sumDays = Number(r.sumLeadDays || 0);
          if (!itemId || cnt <= 0) continue;
          let entry = ltMap.get(itemId);
          if (!entry) {
            entry = {
              itemId,
              itemCode: String(r.itemCode || itemId),
              itemName: String(r.itemName || `Barang #${itemId}`),
              buckets: new Array(16).fill(0),
              total: 0,
              sumDays: 0,
            };
            ltMap.set(itemId, entry);
          }
          entry.buckets[idx] += cnt;
          entry.total += cnt;
          entry.sumDays += sumDays;
        }
        for (const entry of ltMap.values()) {
          deliveryLeadTime.push({
            itemId: entry.itemId,
            itemCode: entry.itemCode,
            itemName: entry.itemName,
            buckets: entry.buckets,
            totalDeliveries: entry.total,
            avgLeadDays: entry.total > 0 ? entry.sumDays / entry.total : 0,
          });
        }
        deliveryLeadTime.sort((a, b) => b.totalDeliveries - a.totalDeliveries);
      } catch {
        // Optional lead time query
      }
    }

    // 10. Assemble ordered monthly rows and per-month detail dictionaries
    const sortedMonths = Array.from(activeMonthsSet)
      .filter((ym) => ym >= startYm && ym <= endYm)
      .sort();

    const monthsToBuild =
      sortedMonths.length > 0 ? sortedMonths : listMonthsBetween(startYm, endYm).slice(0, 0);

    const returnDetailsByMonth: Record<string, ErpSalesBiReturnDetailItem[]> = {};
    const mismatchDetailsByMonth: Record<string, ErpSalesBiMismatchDetailItem[]> = {};

    const monthly: ErpSalesBiMonthlyRow[] = monthsToBuild.map((ym) => {
      const prevYm = shiftMonth(ym, -1);
      const currSiSet = siCustByMonth.get(ym) || new Set<number>();
      const prevSiSet = siCustByMonth.get(prevYm) || new Set<number>();
      const currSoSet = soCustByMonth.get(ym) || new Set<number>();
      const prevSoSet = soCustByMonth.get(prevYm) || new Set<number>();

      // Churned customers: active in previous month (M-1) but absent in current month (M)
      let churnedSi = 0;
      for (const cid of prevSiSet) {
        if (!currSiSet.has(cid)) churnedSi += 1;
      }

      // Rolling 3-month active customer base (M-3..M-1)
      const rollingUnion = new Set<number>();
      for (const d of [-1, -2, -3]) {
        const s = siCustByMonth.get(shiftMonth(ym, d));
        if (s) for (const cid of s) rollingUnion.add(cid);
      }
      let churnedRolling = 0;
      for (const cid of rollingUnion) {
        if (!currSiSet.has(cid)) churnedRolling += 1;
      }

      const soCur = soMonthlyMap.get(ym) || {
        soCount: 0,
        soTotalValue: 0,
        soCompleteCount: 0,
        soCompleteOrCloseCount: 0,
        soCompleteValue: 0,
        soCompleteOrCloseValue: 0,
      };
      const soPrev = soMonthlyMap.get(prevYm);
      const realCur = soRealizationByMonth.get(ym) || {
        soItemQty: 0,
        realizedItemQty: 0,
        soTotalValue: soCur.soTotalValue,
        realizedTotalValue: soCur.soCompleteOrCloseValue,
      };
      const cpiCur = cpiSummaryByMonth.get(ym) || {
        prevBasket: 0,
        currBasket: 0,
        pct: 0,
        itemCount: 0,
      };
      const dotCur = dotByMonth.get(ym) || {
        ivTotal: 0,
        ivOnTime: 0,
        ivLinked: 0,
        ivLinkedOnTime: 0,
        doTotal: 0,
        doOnTime: 0,
        doLinked: 0,
        doLinkedOnTime: 0,
      };
      const srDoc = returnDocByMonth.get(ym) || { count: 0, value: 0 };

      // Build return & mismatch item detail tables for ym
      const itemMap = itemStatsByMonth.get(ym);
      let sumRetQty = 0;
      let sumSoldQty = 0;
      let sumDelivQty = 0;
      let sumVarQty = 0;
      const retItems: ErpSalesBiReturnDetailItem[] = [];
      const misItems: ErpSalesBiMismatchDetailItem[] = [];

      if (itemMap) {
        for (const st of itemMap.values()) {
          sumRetQty += st.returnQty;
          sumSoldQty += st.soldQty;
          sumDelivQty += st.deliveredQty;
          sumVarQty += st.varianceQty;

          if (st.returnQty > 0 || st.soldQty > 0) {
            retItems.push({
              itemId: st.itemId,
              itemCode: st.itemCode,
              itemName: st.itemName,
              returnQty: st.returnQty,
              soldQty: st.soldQty,
              returnPct: st.soldQty > 0 ? (st.returnQty / st.soldQty) * 100 : 0,
            });
          }
          if (st.returnQty > 0 || st.varianceQty > 0 || st.deliveredQty > 0) {
            const delivDenom = st.deliveredQty > 0 ? st.deliveredQty : st.soldQty;
            misItems.push({
              itemId: st.itemId,
              itemCode: st.itemCode,
              itemName: st.itemName,
              mismatchReturnQty: st.returnQty,
              mismatchVarianceQty: st.varianceQty,
              deliveredQty: delivDenom,
              mismatchReturnPct: delivDenom > 0 ? (st.returnQty / delivDenom) * 100 : 0,
              mismatchVariancePct: delivDenom > 0 ? (st.varianceQty / delivDenom) * 100 : 0,
            });
          }
        }
      }
      retItems.sort((a, b) => b.returnQty - a.returnQty || b.soldQty - a.soldQty);
      misItems.sort(
        (a, b) =>
          b.mismatchReturnQty + b.mismatchVarianceQty - (a.mismatchReturnQty + a.mismatchVarianceQty) ||
          b.deliveredQty - a.deliveredQty
      );
      returnDetailsByMonth[ym] = retItems;
      mismatchDetailsByMonth[ym] = misItems;

      return {
        month: ym,
        activeCustomersSi: currSiSet.size,
        prevActiveCustomersSi: prevSiSet.size,
        activeCustomersSo: currSoSet.size,
        prevActiveCustomersSo: prevSoSet.size,
        churnedCustomersSi: churnedSi,
        rollingBaseCustomersSi: rollingUnion.size,
        churnedRollingCustomersSi: churnedRolling,
        soCount: soCur.soCount,
        prevSoCount: soPrev?.soCount || 0,
        soItemQty: realCur.soItemQty,
        realizedItemQty: realCur.realizedItemQty,
        soTotalValue: realCur.soTotalValue > 0 ? realCur.soTotalValue : soCur.soTotalValue,
        realizedTotalValue: realCur.realizedTotalValue,
        soCompleteCount: soCur.soCompleteCount,
        soCompleteOrCloseCount: soCur.soCompleteOrCloseCount,
        soCompleteValue: soCur.soCompleteValue,
        soCompleteOrCloseValue: soCur.soCompleteOrCloseValue,
        cpiPrevBasketPrice: cpiCur.prevBasket,
        cpiCurrBasketPrice: cpiCur.currBasket,
        cpiPct: cpiCur.pct,
        cpiItemCount: cpiCur.itemCount,
        ivTotalCount: dotCur.ivTotal,
        ivOnTimeCount: dotCur.ivOnTime,
        ivLinkedCount: dotCur.ivLinked,
        ivLinkedOnTimeCount: dotCur.ivLinkedOnTime,
        doTotalCount: dotCur.doTotal,
        doOnTimeCount: dotCur.doOnTime,
        doLinkedCount: dotCur.doLinked,
        doLinkedOnTimeCount: dotCur.doLinkedOnTime,
        returnDocCount: srDoc.count,
        returnItemQty: sumRetQty,
        soldItemQty: sumSoldQty,
        returnValue: srDoc.value,
        soldValue: soldValueByMonth.get(ym) || 0,
        deliveredItemQty: sumDelivQty > 0 ? sumDelivQty : sumSoldQty,
        mismatchFromReturnQty: sumRetQty,
        mismatchFromVarianceQty: sumVarQty,
      };
    });

    return {
      cutoffDate: ACTIVE_ERP_CUTOFF_DATE,
      period: { dateFrom, dateTo },
      coverage: {
        minDateAll,
        maxDateAll,
        minDateActive,
        maxDateActive,
      },
      diagnostics: {
        hppSource,
        realizationSource,
        dotSource,
        hasMasterCustomerStatus,
        masterActiveCustomers,
        masterInactiveCustomers,
        tablesDetected: Array.from(tblSet).sort(),
      },
      monthly,
      customerProfitability,
      cpiDetailsByMonth,
      returnDetailsByMonth,
      mismatchDetailsByMonth,
      deliveryLeadTime,
      fetchedAt: new Date().toISOString(),
    };
  });

  if (salesBiQueryCache.size > 30) {
    const oldest = salesBiQueryCache.keys().next().value;
    if (oldest) salesBiQueryCache.delete(oldest);
  }
  salesBiQueryCache.set(cacheKey, {
    expiresAt: Date.now() + SALES_BI_CACHE_TTL_MS,
    data,
  });
  return data;
}
