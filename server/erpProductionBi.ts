import type { RowDataPacket } from 'mysql2/promise';
import {
  ACTIVE_ERP_CUTOFF_DATE,
  fetchErpBridgeJson,
  getErpBridgeConfig,
  withReadOnlyConnection,
} from './erpMysql.ts';

export interface ErpProductionDiscoveredTable {
  tableName: string;
  role: 'work_order' | 'output' | 'material_issue' | 'bom' | 'quality' | 'detail' | 'other';
  rowCount: number;
  dateColumn: string | null;
  columns: string[];
}

export interface ErpProductionBiMonthlyRow {
  month: string; // YYYY-MM
  // 01. Perbandingan WO vs SO (Total WO, WO Terhubung SO, Total SO, SO Memiliki WO)
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
  // 02 & 03. Target WO vs Output Aktual & Backlog
  plannedQty: number;
  actualOutputQty: number;
  achievementPct: number | null;
  outputDocCount: number;
  // 04. Penyelesaian Work Order / SPK (Complete vs Total)
  woCompleteOnlyCount: number;
  woCompleteCount: number;
  woInProgressCount: number;
  woOpenCount: number;
  woCompletionRatePct: number | null;
  // Kualitas & Material (tetap tersedia untuk audit)
  goodQty: number;
  rejectQty: number;
  yieldPct: number | null;
  rejectRatePct: number | null;
  plannedMaterialQty: number;
  actualMaterialQty: number;
  materialVariancePct: number | null;
  materialIssueCostIdr: number;
  // 05. Perbandingan Biaya Produksi (GL Terverifikasi)
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

const SAFE_SQL_IDENTIFIER_REGEX = /^[a-zA-Z0-9_]{1,64}$/;
const PRODUCTION_BI_CACHE_TTL_MS = 3 * 60 * 1000;
const productionBiCache = new Map<string, { expiresAt: number; data: ErpProductionBiQueryResult }>();

export function invalidateErpProductionBiCache(): void {
  productionBiCache.clear();
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

function classifyM6TableRole(tableName: string): ErpProductionDiscoveredTable['role'] {
  const t = tableName.toLowerCase();
  if (t.includes('_detail') || t.endsWith('detail')) return 'detail';
  if (/bom|formula|resep|bill/.test(t)) return 'bom';
  if (/qc|quality|reject|scrap|afkir|defect/.test(t)) return 'quality';
  if (/material|bahan|issue|pakai|pemakaian|_mi\b|_mr\b|raw/.test(t)) return 'material_issue';
  if (/hasil|result|output|finish|_fg\b|realisasi|receipt|terima/.test(t)) return 'output';
  if (/wo|spk|mo|order|plan|jadwal|prod|produksi|work/.test(t)) return 'work_order';
  return 'other';
}

function pickByRegex(cols: string[], patterns: RegExp[]): string | null {
  for (const rx of patterns) {
    const found = cols.find((c) => rx.test(c.toLowerCase()) && SAFE_SQL_IDENTIFIER_REGEX.test(c));
    if (found) return found;
  }
  return null;
}

function getStatusLabel(code: unknown): string {
  const n = Number(code || 0);
  if (n === 4) return 'Complete';
  if (n === 7) return 'Close';
  if (n === 3) return 'In Progress';
  if (n === 2) return 'Approved';
  if (n === 1) return 'Draft / Pending';
  return `Status ${n}`;
}

function classifyGlProdCostGroup(
  accNo: string,
  accName: string
): ErpProductionBiGlAccountRow['costGroup'] {
  const n = accName.toLowerCase();
  if (
    accNo.startsWith('5201') ||
    accNo.startsWith('5101') ||
    /bahan baku|material|pembelian|raw material|kemasan|packing/.test(n)
  ) {
    return 'Bahan Baku';
  }
  if (/tenaga kerja|upah|buruh|gaji produksi|tkl|labour|labor|lembur/.test(n)) {
    return 'Tenaga Kerja';
  }
  if (/overhead|listrik pabrik|penyusutan mesin|maintenance|perawatan mesin|bop|pabrik|utilitas/.test(n)) {
    return 'Overhead Pabrik';
  }
  return 'Biaya Produksi Lainnya';
}

function createEmptyMonthlyRow(month: string): ErpProductionBiMonthlyRow {
  return {
    month,
    soCount: 0,
    soItemQty: 0,
    soTotalValue: 0,
    woCount: 0,
    woLinkedToSoCount: 0,
    soLinkedToWoCount: 0,
    woUnlinkedCount: 0,
    soWithoutWoCount: 0,
    woToSoPct: null,
    soCoveredByWoPct: null,
    woVsSoRatioPct: null,
    plannedQty: 0,
    actualOutputQty: 0,
    achievementPct: null,
    outputDocCount: 0,
    woCompleteOnlyCount: 0,
    woCompleteCount: 0,
    woInProgressCount: 0,
    woOpenCount: 0,
    woCompletionRatePct: null,
    goodQty: 0,
    rejectQty: 0,
    yieldPct: null,
    rejectRatePct: null,
    plannedMaterialQty: 0,
    actualMaterialQty: 0,
    materialVariancePct: null,
    materialIssueCostIdr: 0,
    glMaterialCost: 0,
    glLaborCost: 0,
    glOverheadCost: 0,
    glOtherProdCost: 0,
    glTotalProdCost: 0,
    unitCostIdr: null,
  };
}

export async function queryErpProductionBiData(options: {
  dateFrom?: string;
  dateTo?: string;
  bypassCache?: boolean;
}): Promise<ErpProductionBiQueryResult> {
  const dateFrom = clampActiveDateFrom(options.dateFrom);
  const rawDateTo = (options.dateTo || '').trim();
  const dateTo =
    /^\d{4}-\d{2}-\d{2}$/.test(rawDateTo) && rawDateTo >= dateFrom
      ? rawDateTo
      : new Date().toISOString().slice(0, 10);

  const cacheKey = `prod_bi_v2_${dateFrom}|${dateTo}`;
  if (!options.bypassCache) {
    const cached = productionBiCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
  }

  const bridge = getErpBridgeConfig();
  if (bridge.configured) {
    const qs = new URLSearchParams();
    qs.set('dateFrom', dateFrom);
    qs.set('dateTo', dateTo);
    const data = await fetchErpBridgeJson<ErpProductionBiQueryResult>(
      `/production-bi?${qs.toString()}`
    );
    const isV13Schema =
      Boolean(data) &&
      typeof data === 'object' &&
      Boolean(data.diagnostics) &&
      typeof data.diagnostics.woSoLinkMethod === 'string' &&
      Array.isArray(data.woSoLinks);
    if (!isV13Schema) {
      throw new Error(
        'Skrip Local Bridge ERP yang sedang berjalan masih versi lama (sebelum v13) sehingga belum mendukung perbandingan Work Order (WO) vs Sales Order (SO) terbaru. Silakan unduh ulang Local Bridge terbaru (v13) dan jalankan ulang.'
      );
    }
    if (productionBiCache.size > 24) {
      const oldest = productionBiCache.keys().next().value;
      if (oldest) productionBiCache.delete(oldest);
    }
    productionBiCache.set(cacheKey, {
      expiresAt: Date.now() + PRODUCTION_BI_CACHE_TTL_MS,
      data,
    });
    return data;
  }

  const data = await withReadOnlyConnection(async (conn): Promise<ErpProductionBiQueryResult> => {
    const [tblRows] = await conn.query<RowDataPacket[]>('SHOW TABLES');
    const allTables = tblRows
      .map((r) => String(Object.values(r)[0] ?? '').trim())
      .filter((t) => SAFE_SQL_IDENTIFIER_REGEX.test(t));
    const tblSet = new Set(allTables.map((t) => t.toLowerCase()));

    const hasItem = tblSet.has('m1_item');
    const hasContact = tblSet.has('m1_contact');
    const hasSalesOrder = tblSet.has('m5_so');
    const hasSalesOrderDetail = tblSet.has('m5_so_detail');
    const hasFinance = tblSet.has('m2_transaction_journal') && tblSet.has('m1_coa');

    const getColumns = async (tableName: string): Promise<string[]> => {
      try {
        const [colRows] = await conn.query<RowDataPacket[]>(`SHOW COLUMNS FROM \`${tableName}\``);
        return colRows
          .map((r) => String(r.Field || r.field || '').trim())
          .filter((c) => SAFE_SQL_IDENTIFIER_REGEX.test(c));
      } catch {
        return [];
      }
    };

    // Inspect m5_so & m5_so_detail columns
    const soCols = hasSalesOrder ? await getColumns('m5_so') : [];
    const sodCols = hasSalesOrderDetail ? await getColumns('m5_so_detail') : [];
    const contactCols = hasContact ? await getColumns('m1_contact') : [];

    // Discover all m6_* tables dynamically via SHOW COLUMNS & exact row counts
    const m6TablesRaw = allTables.filter((t) => t.toLowerCase().startsWith('m6_'));
    const discoveredTables: ErpProductionDiscoveredTable[] = [];

    for (const tbl of m6TablesRaw) {
      try {
        const columns = await getColumns(tbl);
        const [cntRows] = await conn.query<RowDataPacket[]>(`SELECT COUNT(*) AS cnt FROM \`${tbl}\``);
        const rowCount = Number(cntRows[0]?.cnt || 0);
        const dateColumn = pickByRegex(columns, [
          /tgl$/,
          /tanggal/,
          /date$/,
          /tgltransaksi/,
          /tglmulai/,
        ]);
        discoveredTables.push({
          tableName: tbl,
          role: classifyM6TableRole(tbl),
          rowCount,
          dateColumn,
          columns,
        });
      } catch {
        // Skip unreadable views/tables safely
      }
    }

    const monthlyMap = new Map<string, ErpProductionBiMonthlyRow>();
    const ensureMonth = (ym: string): ErpProductionBiMonthlyRow | null => {
      if (!/^\d{4}-\d{2}$/.test(ym)) return null;
      let row = monthlyMap.get(ym);
      if (!row) {
        row = createEmptyMonthlyRow(ym);
        monthlyMap.set(ym, row);
      }
      return row;
    };
    for (const ym of listMonthsBetween(dateFrom.slice(0, 7), dateTo.slice(0, 7))) {
      ensureMonth(ym);
    }

    // Helper: pick best non-empty table for a given role
    const pickRoleTable = (
      role: ErpProductionDiscoveredTable['role'],
      requireDate = true
    ): ErpProductionDiscoveredTable | null => {
      const candidates = discoveredTables.filter(
        (t) => t.role === role && (!requireDate || Boolean(t.dateColumn))
      );
      if (candidates.length === 0) return null;
      return [...candidates].sort((a, b) => b.rowCount - a.rowCount)[0];
    };

    const woTable = pickRoleTable('work_order', true);
    const outputTable = pickRoleTable('output', true);
    const materialTable = pickRoleTable('material_issue', true);
    const qualityTable = pickRoleTable('quality', true);

    const woSoLinks: ErpProductionBiWoSoLinkRow[] = [];
    const openWorkOrders: ErpProductionBiWorkOrderRow[] = [];
    const productQuality: ErpProductionBiProductQualityRow[] = [];
    const topMaterials: ErpProductionBiMaterialRow[] = [];
    let qualitySource: ErpProductionBiQueryResult['diagnostics']['qualitySource'] = 'unavailable';
    let woSoLinkMethod: WoSoLinkMethod = woTable ? 'unlinked_no_fk_column' : 'no_wo_table';
    let woSoLinkColumn: string | null = null;
    let hasM6TransactionsInPeriod = false;

    // 0. Query Sales Orders (m5_so & m5_so_detail) per month for exact WO vs SO comparison
    const soIdCol = pickByRegex(soCols, [/^soid$/, /^id$/]);
    const soDateCol = pickByRegex(soCols, [/^sotgl$/, /tgl$/, /date$/]);
    const soNoCol = pickByRegex(soCols, [/^sonotransaksi$/, /^sono$/, /notransaksi/, /nomor/, /kode/]);
    const soStatusCol = pickByRegex(soCols, [/^sostatus$/, /status$/]);
    const soTotalCol = pickByRegex(soCols, [/^sototaltransaksi$/, /totaltransaksi/, /total$/]);
    const soKursCol = pickByRegex(soCols, [/^sokurs$/, /kurs/]);
    const soCustCol = pickByRegex(soCols, [/^socustomer$/, /^sokontak$/, /customer/, /kontak/, /idcontact/]);
    const soStatusFilter = soStatusCol ? `COALESCE(s.\`${soStatusCol}\`, 0) NOT IN (6, 12)` : '1 = 1';

    const cIdCol = pickByRegex(contactCols, [/^kid$/, /^cid$/, /^id$/]);
    const cNameCol = pickByRegex(contactCols, [/^knama$/, /^cnama$/, /nama/]);

    if (hasSalesOrder && soDateCol) {
      try {
        const kursExpr = soKursCol ? `COALESCE(NULLIF(s.\`${soKursCol}\`, 0), 1)` : '1';
        const valExpr = soTotalCol ? `COALESCE(s.\`${soTotalCol}\`, 0) * ${kursExpr}` : '0';
        const [soRows] = await conn.query<RowDataPacket[]>(
          `SELECT DATE_FORMAT(s.\`${soDateCol}\`, '%Y-%m') AS month,
            COUNT(*) AS soCount,
            COALESCE(SUM(${valExpr}), 0) AS soTotalValue
           FROM m5_so s
           WHERE ${soStatusFilter}
             AND s.\`${soDateCol}\` >= ? AND s.\`${soDateCol}\` <= ?
           GROUP BY DATE_FORMAT(s.\`${soDateCol}\`, '%Y-%m')`,
          [dateFrom, dateTo]
        );
        for (const r of soRows) {
          const row = ensureMonth(String(r.month || ''));
          if (!row) continue;
          row.soCount = Number(r.soCount || 0);
          row.soTotalValue = Number(r.soTotalValue || 0);
        }

        if (hasSalesOrderDetail && soIdCol) {
          const sodSoFk = pickByRegex(sodCols, [/^idso$/, /soid/, /id_so/]);
          const sodQtyCol = pickByRegex(sodCols, [/^sodqty$/, /qty$/, /jml$/, /jumlah/]);
          if (sodSoFk && sodQtyCol) {
            const [sodRows] = await conn.query<RowDataPacket[]>(
              `SELECT DATE_FORMAT(s.\`${soDateCol}\`, '%Y-%m') AS month,
                COALESCE(SUM(COALESCE(sd.\`${sodQtyCol}\`, 0)), 0) AS soItemQty
               FROM m5_so_detail sd
               INNER JOIN m5_so s ON s.\`${soIdCol}\` = sd.\`${sodSoFk}\`
               WHERE ${soStatusFilter}
                 AND s.\`${soDateCol}\` >= ? AND s.\`${soDateCol}\` <= ?
               GROUP BY DATE_FORMAT(s.\`${soDateCol}\`, '%Y-%m')`,
              [dateFrom, dateTo]
            );
            for (const r of sodRows) {
              const row = ensureMonth(String(r.month || ''));
              if (row) row.soItemQty = Number(r.soItemQty || 0);
            }
          }
        }
      } catch {
        // Non-fatal
      }
    }

    // 1. Work Order / SPK Header, Optional Detail, AND Exact WO ↔ SO Link Detection
    if (woTable && woTable.dateColumn && woTable.rowCount > 0) {
      const cols = woTable.columns;
      const dateCol = woTable.dateColumn;
      const idCol = pickByRegex(cols, [/id$/, /^id/]);
      const docNoCol = pickByRegex(cols, [/notransaksi/, /nomor/, /kode/, /no_/]);
      const statusCol = pickByRegex(cols, [/status$/]);
      const isCloseCol = pickByRegex(cols, [/isclose/, /close$/]);
      const targetDateCol = pickByRegex(cols, [/tglselesai/, /tgltarget/, /tgldipenuhi/, /duedate/, /deadline/]);
      const planQtyCol = pickByRegex(cols, [/jmltarget/, /qtytarget/, /jmlrencana/, /qtyplan/, /jml$/, /qty$/, /jumlah/]);
      const actualQtyCol = pickByRegex(cols, [/jmlhasil/, /qtyhasil/, /jmlrealisasi/, /qtyactual/, /jmljadi/, /jmlok/]);
      const rejectQtyCol = pickByRegex(cols, [/reject/, /scrap/, /rusak/, /afkir/, /cacat/, /gagal/]);
      const itemCol = pickByRegex(cols, [/idbarang/, /iditem/, /^bid$/]);

      // Detect SO reference columns on WO header
      const woSoIdCol = pickByRegex(cols, [/idso$/, /soid$/, /woidso/, /spkidso/, /id_so$/, /idorder/]);
      const woSoNoCol = pickByRegex(cols, [/noso$/, /so_no/, /refso/, /soref/, /notransaksiso/]);

      const statusFilter = statusCol ? `COALESCE(h.\`${statusCol}\`, 0) NOT IN (6, 12)` : '1 = 1';
      const closeCond = isCloseCol ? `COALESCE(h.\`${isCloseCol}\`, 0) = 1` : '0 = 1';

      const detailTbl = discoveredTables.find(
        (t) =>
          t.tableName.toLowerCase() === `${woTable.tableName.toLowerCase()}_detail` ||
          t.tableName.toLowerCase() === `${woTable.tableName.toLowerCase()}detail`
      );

      try {
        const [woMonRows] = await conn.query<RowDataPacket[]>(
          `SELECT DATE_FORMAT(h.\`${dateCol}\`, '%Y-%m') AS month,
            COUNT(*) AS woCount,
            ${statusCol ? `SUM(CASE WHEN COALESCE(h.\`${statusCol}\`, 0) = 4 THEN 1 ELSE 0 END)` : '0'} AS woCompleteOnly,
            ${statusCol ? `SUM(CASE WHEN COALESCE(h.\`${statusCol}\`, 0) IN (4, 7) OR ${closeCond} THEN 1 ELSE 0 END)` : '0'} AS woComplete,
            ${statusCol ? `SUM(CASE WHEN COALESCE(h.\`${statusCol}\`, 0) = 3 AND NOT (${closeCond}) THEN 1 ELSE 0 END)` : '0'} AS woInProgress,
            ${statusCol ? `SUM(CASE WHEN COALESCE(h.\`${statusCol}\`, 0) IN (0, 1, 2) AND NOT (${closeCond}) THEN 1 ELSE 0 END)` : 'COUNT(*)'} AS woOpen,
            ${planQtyCol ? `COALESCE(SUM(COALESCE(h.\`${planQtyCol}\`, 0)), 0)` : '0'} AS plannedQty,
            ${actualQtyCol ? `COALESCE(SUM(COALESCE(h.\`${actualQtyCol}\`, 0)), 0)` : '0'} AS actualQty,
            ${rejectQtyCol ? `COALESCE(SUM(COALESCE(h.\`${rejectQtyCol}\`, 0)), 0)` : '0'} AS rejectQty
           FROM \`${woTable.tableName}\` h
           WHERE ${statusFilter}
             AND h.\`${dateCol}\` >= ? AND h.\`${dateCol}\` <= ?
           GROUP BY DATE_FORMAT(h.\`${dateCol}\`, '%Y-%m')`,
          [dateFrom, dateTo]
        );
        for (const r of woMonRows) {
          const row = ensureMonth(String(r.month || ''));
          if (!row) continue;
          const cnt = Number(r.woCount || 0);
          if (cnt > 0) hasM6TransactionsInPeriod = true;
          row.woCount = cnt;
          row.woCompleteOnlyCount = Number(r.woCompleteOnly || 0);
          row.woCompleteCount = Number(r.woComplete || 0);
          row.woInProgressCount = Number(r.woInProgress || 0);
          row.woOpenCount = Number(r.woOpen || 0);
          row.plannedQty = Number(r.plannedQty || 0);
          if (actualQtyCol) {
            row.actualOutputQty = Number(r.actualQty || 0);
            row.goodQty = Math.max(0, row.actualOutputQty - Number(r.rejectQty || 0));
          }
          if (rejectQtyCol) {
            row.rejectQty = Number(r.rejectQty || 0);
            qualitySource = 'm6_reject_column';
          }
        }

        // If header lacks plannedQty, inspect matching _detail table
        if (detailTbl && idCol && !planQtyCol) {
          const dFk = pickByRegex(detailTbl.columns, [
            new RegExp(`^id${woTable.tableName.replace(/^m6_/i, '')}`),
            /idwo/,
            /idspk/,
            /idmo/,
            /idprod/,
            /^id_/,
          ]);
          const dPlanCol = pickByRegex(detailTbl.columns, [/jmltarget/, /qtytarget/, /jmlrencana/, /jml$/, /qty$/, /jumlah/]);
          const dActualCol = pickByRegex(detailTbl.columns, [/jmlhasil/, /qtyhasil/, /jmlrealisasi/, /jmljadi/]);
          if (dFk && dPlanCol) {
            const [detRows] = await conn.query<RowDataPacket[]>(
              `SELECT DATE_FORMAT(h.\`${dateCol}\`, '%Y-%m') AS month,
                COALESCE(SUM(COALESCE(d.\`${dPlanCol}\`, 0)), 0) AS plannedQty,
                ${dActualCol ? `COALESCE(SUM(COALESCE(d.\`${dActualCol}\`, 0)), 0)` : '0'} AS actualQty
               FROM \`${detailTbl.tableName}\` d
               INNER JOIN \`${woTable.tableName}\` h ON h.\`${idCol}\` = d.\`${dFk}\`
               WHERE ${statusFilter}
                 AND h.\`${dateCol}\` >= ? AND h.\`${dateCol}\` <= ?
               GROUP BY DATE_FORMAT(h.\`${dateCol}\`, '%Y-%m')`,
              [dateFrom, dateTo]
            );
            for (const r of detRows) {
              const row = ensureMonth(String(r.month || ''));
              if (!row) continue;
              row.plannedQty = Number(r.plannedQty || 0);
              if (dActualCol && row.actualOutputQty === 0) {
                row.actualOutputQty = Number(r.actualQty || 0);
              }
            }
          }
        }

        // 1B. Exact WO ↔ SO Link Discovery (checks 5 real FK paths — never guesses!)
        const soKursExpr = soKursCol ? `COALESCE(NULLIF(s.\`${soKursCol}\`, 0), 1)` : '1';
        const soValExpr = soTotalCol ? `COALESCE(s.\`${soTotalCol}\`, 0) * ${soKursExpr}` : '0';
        const custJoin =
          hasContact && cIdCol && soCustCol
            ? `LEFT JOIN m1_contact c ON c.\`${cIdCol}\` = s.\`${soCustCol}\``
            : '';
        const custNameExpr =
          hasContact && cIdCol && cNameCol && soCustCol
            ? `COALESCE(NULLIF(TRIM(c.\`${cNameCol}\`), ''), '-')`
            : "'-'";

        // Path A: WO header has numeric ID FK to m5_so (e.g., woidso / idso)
        if (hasSalesOrder && soIdCol && woSoIdCol) {
          woSoLinkMethod = 'wo_header_idso';
          woSoLinkColumn = `${woTable.tableName}.${woSoIdCol}`;

          const [linkMonRows] = await conn.query<RowDataPacket[]>(
            `SELECT DATE_FORMAT(h.\`${dateCol}\`, '%Y-%m') AS month,
              COUNT(DISTINCT CASE WHEN s.\`${soIdCol}\` IS NOT NULL THEN h.\`${idCol || docNoCol || dateCol}\` END) AS woLinked,
              COUNT(DISTINCT s.\`${soIdCol}\`) AS soLinked
             FROM \`${woTable.tableName}\` h
             LEFT JOIN m5_so s ON s.\`${soIdCol}\` = h.\`${woSoIdCol}\` AND ${soStatusFilter}
             WHERE ${statusFilter}
               AND h.\`${dateCol}\` >= ? AND h.\`${dateCol}\` <= ?
             GROUP BY DATE_FORMAT(h.\`${dateCol}\`, '%Y-%m')`,
            [dateFrom, dateTo]
          );
          for (const r of linkMonRows) {
            const row = ensureMonth(String(r.month || ''));
            if (row) {
              row.woLinkedToSoCount = Number(r.woLinked || 0);
              row.soLinkedToWoCount = Number(r.soLinked || 0);
            }
          }

          const [linkRows] = await conn.query<RowDataPacket[]>(
            `SELECT
              ${docNoCol ? `COALESCE(NULLIF(TRIM(h.\`${docNoCol}\`), ''), '-')` : "'-'"} AS woDocNo,
              h.\`${dateCol}\` AS woDate,
              ${statusCol ? `COALESCE(h.\`${statusCol}\`, 0)` : '0'} AS woStatus,
              ${planQtyCol ? `COALESCE(h.\`${planQtyCol}\`, 0)` : '0'} AS woQty,
              CASE WHEN s.\`${soIdCol}\` IS NOT NULL THEN 1 ELSE 0 END AS isLinked,
              ${soNoCol ? `COALESCE(NULLIF(TRIM(s.\`${soNoCol}\`), ''), '-')` : "'-'"} AS soDocNo,
              ${soDateCol ? `s.\`${soDateCol}\`` : 'NULL'} AS soDate,
              ${custNameExpr} AS customerName,
              ${soValExpr} AS soTotalValue
             FROM \`${woTable.tableName}\` h
             LEFT JOIN m5_so s ON s.\`${soIdCol}\` = h.\`${woSoIdCol}\` AND ${soStatusFilter}
             ${custJoin}
             WHERE ${statusFilter}
               AND h.\`${dateCol}\` >= ? AND h.\`${dateCol}\` <= ?
             ORDER BY h.\`${dateCol}\` DESC
             LIMIT 60`,
            [dateFrom, dateTo]
          );
          for (const r of linkRows) {
            woSoLinks.push({
              woDocNo: String(r.woDocNo || '-'),
              woDate: formatDateIso(r.woDate),
              woStatusLabel: getStatusLabel(r.woStatus),
              woQty: Number(r.woQty || 0),
              isLinkedToSo: Number(r.isLinked || 0) === 1,
              soDocNo: String(r.soDocNo || '-'),
              soDate: formatDateIso(r.soDate),
              customerName: String(r.customerName || '-'),
              soTotalValue: Number(r.soTotalValue || 0),
            });
          }
        }
        // Path B: WO header has SO document number column (e.g., noso / refso)
        else if (hasSalesOrder && soNoCol && woSoNoCol) {
          woSoLinkMethod = 'wo_header_noso';
          woSoLinkColumn = `${woTable.tableName}.${woSoNoCol}`;

          const [linkMonRows] = await conn.query<RowDataPacket[]>(
            `SELECT DATE_FORMAT(h.\`${dateCol}\`, '%Y-%m') AS month,
              COUNT(DISTINCT CASE WHEN s.\`${soNoCol}\` IS NOT NULL THEN h.\`${idCol || docNoCol || dateCol}\` END) AS woLinked,
              COUNT(DISTINCT s.\`${soNoCol}\`) AS soLinked
             FROM \`${woTable.tableName}\` h
             LEFT JOIN m5_so s ON TRIM(s.\`${soNoCol}\`) = TRIM(h.\`${woSoNoCol}\`) AND ${soStatusFilter}
             WHERE ${statusFilter}
               AND h.\`${dateCol}\` >= ? AND h.\`${dateCol}\` <= ?
             GROUP BY DATE_FORMAT(h.\`${dateCol}\`, '%Y-%m')`,
            [dateFrom, dateTo]
          );
          for (const r of linkMonRows) {
            const row = ensureMonth(String(r.month || ''));
            if (row) {
              row.woLinkedToSoCount = Number(r.woLinked || 0);
              row.soLinkedToWoCount = Number(r.soLinked || 0);
            }
          }

          const [linkRows] = await conn.query<RowDataPacket[]>(
            `SELECT
              ${docNoCol ? `COALESCE(NULLIF(TRIM(h.\`${docNoCol}\`), ''), '-')` : "'-'"} AS woDocNo,
              h.\`${dateCol}\` AS woDate,
              ${statusCol ? `COALESCE(h.\`${statusCol}\`, 0)` : '0'} AS woStatus,
              ${planQtyCol ? `COALESCE(h.\`${planQtyCol}\`, 0)` : '0'} AS woQty,
              CASE WHEN s.\`${soNoCol}\` IS NOT NULL THEN 1 ELSE 0 END AS isLinked,
              COALESCE(NULLIF(TRIM(s.\`${soNoCol}\`), ''), '-') AS soDocNo,
              ${soDateCol ? `s.\`${soDateCol}\`` : 'NULL'} AS soDate,
              ${custNameExpr} AS customerName,
              ${soValExpr} AS soTotalValue
             FROM \`${woTable.tableName}\` h
             LEFT JOIN m5_so s ON TRIM(s.\`${soNoCol}\`) = TRIM(h.\`${woSoNoCol}\`) AND ${soStatusFilter}
             ${custJoin}
             WHERE ${statusFilter}
               AND h.\`${dateCol}\` >= ? AND h.\`${dateCol}\` <= ?
             ORDER BY h.\`${dateCol}\` DESC
             LIMIT 60`,
            [dateFrom, dateTo]
          );
          for (const r of linkRows) {
            woSoLinks.push({
              woDocNo: String(r.woDocNo || '-'),
              woDate: formatDateIso(r.woDate),
              woStatusLabel: getStatusLabel(r.woStatus),
              woQty: Number(r.woQty || 0),
              isLinkedToSo: Number(r.isLinked || 0) === 1,
              soDocNo: String(r.soDocNo || '-'),
              soDate: formatDateIso(r.soDate),
              customerName: String(r.customerName || '-'),
              soTotalValue: Number(r.soTotalValue || 0),
            });
          }
        }
        // Path C: WO detail table has SO FK column (idso / idsodetail)
        else if (hasSalesOrder && soIdCol && detailTbl && idCol) {
          const dWoFk = pickByRegex(detailTbl.columns, [
            new RegExp(`^id${woTable.tableName.replace(/^m6_/i, '')}`),
            /idwo/,
            /idspk/,
            /idmo/,
            /idprod/,
          ]);
          const dSoFk = pickByRegex(detailTbl.columns, [/idso$/, /soid$/, /id_so$/]);
          if (dWoFk && dSoFk) {
            woSoLinkMethod = 'wo_detail_idso';
            woSoLinkColumn = `${detailTbl.tableName}.${dSoFk}`;

            const [linkMonRows] = await conn.query<RowDataPacket[]>(
              `SELECT DATE_FORMAT(h.\`${dateCol}\`, '%Y-%m') AS month,
                COUNT(DISTINCT CASE WHEN s.\`${soIdCol}\` IS NOT NULL THEN h.\`${idCol}\` END) AS woLinked,
                COUNT(DISTINCT s.\`${soIdCol}\`) AS soLinked
               FROM \`${woTable.tableName}\` h
               LEFT JOIN \`${detailTbl.tableName}\` d ON d.\`${dWoFk}\` = h.\`${idCol}\`
               LEFT JOIN m5_so s ON s.\`${soIdCol}\` = d.\`${dSoFk}\` AND ${soStatusFilter}
               WHERE ${statusFilter}
                 AND h.\`${dateCol}\` >= ? AND h.\`${dateCol}\` <= ?
               GROUP BY DATE_FORMAT(h.\`${dateCol}\`, '%Y-%m')`,
              [dateFrom, dateTo]
            );
            for (const r of linkMonRows) {
              const row = ensureMonth(String(r.month || ''));
              if (row) {
                row.woLinkedToSoCount = Number(r.woLinked || 0);
                row.soLinkedToWoCount = Number(r.soLinked || 0);
              }
            }
          }
        }
        // Path D: Reverse link — m5_so header has WO FK (idwo / woid / idspk)
        if (woSoLinkMethod === 'unlinked_no_fk_column' && hasSalesOrder && idCol) {
          const soWoFk = pickByRegex(soCols, [/idwo/, /woid/, /idspk/, /spkid/, /idmo/, /idprod/]);
          if (soWoFk) {
            woSoLinkMethod = 'so_header_idwo';
            woSoLinkColumn = `m5_so.${soWoFk}`;
            const [revRows] = await conn.query<RowDataPacket[]>(
              `SELECT DATE_FORMAT(h.\`${dateCol}\`, '%Y-%m') AS month,
                COUNT(DISTINCT CASE WHEN s.\`${soWoFk}\` IS NOT NULL THEN h.\`${idCol}\` END) AS woLinked,
                COUNT(DISTINCT s.\`${soIdCol || soWoFk}\`) AS soLinked
               FROM \`${woTable.tableName}\` h
               LEFT JOIN m5_so s ON s.\`${soWoFk}\` = h.\`${idCol}\` AND ${soStatusFilter}
               WHERE ${statusFilter}
                 AND h.\`${dateCol}\` >= ? AND h.\`${dateCol}\` <= ?
               GROUP BY DATE_FORMAT(h.\`${dateCol}\`, '%Y-%m')`,
              [dateFrom, dateTo]
            );
            for (const r of revRows) {
              const row = ensureMonth(String(r.month || ''));
              if (row) {
                row.woLinkedToSoCount = Number(r.woLinked || 0);
                row.soLinkedToWoCount = Number(r.soLinked || 0);
              }
            }
          }
        }

        // Open / In-Progress WO Backlog list (up to 40)
        if (statusCol) {
          const itemJoin = hasItem && itemCol ? `LEFT JOIN m1_item it ON it.bid = h.\`${itemCol}\`` : '';
          const itemNameExpr =
            hasItem && itemCol ? "COALESCE(NULLIF(TRIM(it.bnama), ''), '-')" : "'-'";
          const [openRows] = await conn.query<RowDataPacket[]>(
            `SELECT
              ${docNoCol ? `COALESCE(NULLIF(TRIM(h.\`${docNoCol}\`), ''), '-')` : "'-'"} AS docNo,
              h.\`${dateCol}\` AS docDate,
              ${targetDateCol ? `h.\`${targetDateCol}\`` : 'NULL'} AS targetDate,
              ${itemNameExpr} AS itemName,
              ${planQtyCol ? `COALESCE(h.\`${planQtyCol}\`, 0)` : '0'} AS plannedQty,
              ${actualQtyCol ? `COALESCE(h.\`${actualQtyCol}\`, 0)` : '0'} AS actualQty,
              COALESCE(h.\`${statusCol}\`, 0) AS statusCode,
              GREATEST(0, DATEDIFF(CURDATE(), h.\`${dateCol}\`)) AS ageDays
             FROM \`${woTable.tableName}\` h
             ${itemJoin}
             WHERE COALESCE(h.\`${statusCol}\`, 0) IN (0, 1, 2, 3)
               AND NOT (${closeCond})
               AND h.\`${dateCol}\` >= ? AND h.\`${dateCol}\` <= ?
             ORDER BY h.\`${dateCol}\` ASC
             LIMIT 40`,
            [dateFrom, dateTo]
          );
          for (const r of openRows) {
            openWorkOrders.push({
              docNo: String(r.docNo || '-'),
              date: formatDateIso(r.docDate),
              targetDate: formatDateIso(r.targetDate),
              itemName: String(r.itemName || '-'),
              plannedQty: Number(r.plannedQty || 0),
              actualQty: Number(r.actualQty || 0),
              statusLabel: getStatusLabel(r.statusCode),
              ageDays: Number(r.ageDays || 0),
            });
          }
        }
      } catch {
        // Non-fatal
      }
    }

    // 2. Production Output / Finished Goods Result Table (if separate from WO)
    if (outputTable && outputTable.dateColumn && outputTable.rowCount > 0) {
      const cols = outputTable.columns;
      const dateCol = outputTable.dateColumn;
      const idCol = pickByRegex(cols, [/id$/, /^id/]);
      const statusCol = pickByRegex(cols, [/status$/]);
      const goodQtyCol = pickByRegex(cols, [/jmlok/, /jmlbagus/, /jmljadi/, /jmlhasil/, /qtygood/, /jml$/, /qty$/]);
      const rejectCol = pickByRegex(cols, [/reject/, /scrap/, /rusak/, /afkir/, /cacat/, /gagal/]);
      const statusFilter = statusCol ? `COALESCE(o.\`${statusCol}\`, 0) NOT IN (6, 12)` : '1 = 1';

      try {
        const [outRows] = await conn.query<RowDataPacket[]>(
          `SELECT DATE_FORMAT(o.\`${dateCol}\`, '%Y-%m') AS month,
            COUNT(*) AS docCount,
            ${goodQtyCol ? `COALESCE(SUM(COALESCE(o.\`${goodQtyCol}\`, 0)), 0)` : '0'} AS goodQty,
            ${rejectCol ? `COALESCE(SUM(COALESCE(o.\`${rejectCol}\`, 0)), 0)` : '0'} AS rejectQty
           FROM \`${outputTable.tableName}\` o
           WHERE ${statusFilter}
             AND o.\`${dateCol}\` >= ? AND o.\`${dateCol}\` <= ?
           GROUP BY DATE_FORMAT(o.\`${dateCol}\`, '%Y-%m')`,
          [dateFrom, dateTo]
        );
        for (const r of outRows) {
          const row = ensureMonth(String(r.month || ''));
          if (!row) continue;
          const cnt = Number(r.docCount || 0);
          if (cnt > 0) hasM6TransactionsInPeriod = true;
          row.outputDocCount = cnt;
          if (goodQtyCol) {
            row.goodQty = Number(r.goodQty || 0);
            row.actualOutputQty = Number(r.goodQty || 0) + Number(r.rejectQty || 0);
          }
          if (rejectCol) {
            row.rejectQty = Number(r.rejectQty || 0);
            qualitySource = 'm6_reject_column';
          }
        }

        const outDet = discoveredTables.find(
          (t) =>
            t.tableName.toLowerCase() === `${outputTable.tableName.toLowerCase()}_detail` ||
            t.tableName.toLowerCase() === `${outputTable.tableName.toLowerCase()}detail`
        );
        if (outDet && idCol && !goodQtyCol) {
          const dFk = pickByRegex(outDet.columns, [/idhasil/, /idoutput/, /idprod/, /^id/]);
          const dGoodCol = pickByRegex(outDet.columns, [/jmlok/, /jmlbagus/, /jmljadi/, /jml$/, /qty$/, /jumlah/]);
          const dRejCol = pickByRegex(outDet.columns, [/reject/, /scrap/, /rusak/, /afkir/, /cacat/]);
          if (dFk && dGoodCol) {
            const [odRows] = await conn.query<RowDataPacket[]>(
              `SELECT DATE_FORMAT(o.\`${dateCol}\`, '%Y-%m') AS month,
                COALESCE(SUM(COALESCE(d.\`${dGoodCol}\`, 0)), 0) AS goodQty,
                ${dRejCol ? `COALESCE(SUM(COALESCE(d.\`${dRejCol}\`, 0)), 0)` : '0'} AS rejectQty
               FROM \`${outDet.tableName}\` d
               INNER JOIN \`${outputTable.tableName}\` o ON o.\`${idCol}\` = d.\`${dFk}\`
               WHERE ${statusFilter}
                 AND o.\`${dateCol}\` >= ? AND o.\`${dateCol}\` <= ?
               GROUP BY DATE_FORMAT(o.\`${dateCol}\`, '%Y-%m')`,
              [dateFrom, dateTo]
            );
            for (const r of odRows) {
              const row = ensureMonth(String(r.month || ''));
              if (!row) continue;
              row.goodQty = Number(r.goodQty || 0);
              row.rejectQty = Number(r.rejectQty || 0);
              row.actualOutputQty = row.goodQty + row.rejectQty;
              if (dRejCol) qualitySource = 'm6_reject_column';
            }
          }
        }
      } catch {
        // Non-fatal
      }
    }

    // 3. Dedicated Quality / QC table if present
    if (qualityTable && qualityTable.dateColumn && qualityTable.rowCount > 0 && qualitySource === 'unavailable') {
      const cols = qualityTable.columns;
      const dateCol = qualityTable.dateColumn;
      const rejCol = pickByRegex(cols, [/reject/, /scrap/, /rusak/, /gagal/, /jml$/, /qty$/]);
      const goodCol = pickByRegex(cols, [/pass/, /ok/, /bagus/, /good/, /lolos/]);
      if (rejCol) {
        try {
          const [qcRows] = await conn.query<RowDataPacket[]>(
            `SELECT DATE_FORMAT(q.\`${dateCol}\`, '%Y-%m') AS month,
              ${goodCol ? `COALESCE(SUM(COALESCE(q.\`${goodCol}\`, 0)), 0)` : '0'} AS goodQty,
              COALESCE(SUM(COALESCE(q.\`${rejCol}\`, 0)), 0) AS rejectQty
             FROM \`${qualityTable.tableName}\` q
             WHERE q.\`${dateCol}\` >= ? AND q.\`${dateCol}\` <= ?
             GROUP BY DATE_FORMAT(q.\`${dateCol}\`, '%Y-%m')`,
            [dateFrom, dateTo]
          );
          for (const r of qcRows) {
            const row = ensureMonth(String(r.month || ''));
            if (!row) continue;
            row.rejectQty = Number(r.rejectQty || 0);
            if (goodCol && row.goodQty === 0) row.goodQty = Number(r.goodQty || 0);
            if (row.rejectQty > 0 || row.goodQty > 0) hasM6TransactionsInPeriod = true;
          }
          qualitySource = 'm6_qc_table';
        } catch {
          // Non-fatal
        }
      }
    }

    // 4. Verified GL Production / Manufacturing Costs (m2_transaction_journal + m1_coa)
    const glProductionAccounts: ErpProductionBiGlAccountRow[] = [];
    let totalGlProductionCostIdr = 0;

    if (hasFinance) {
      try {
        const [glRows] = await conn.query<RowDataPacket[]>(
          `SELECT
            DATE_FORMAT(j.ttgl, '%Y-%m') AS month,
            c.cnomor AS accountNo,
            c.cnama AS accountName,
            COUNT(*) AS entryCount,
            COALESCE(SUM(j.tdebit - j.tkredit), 0) AS amountIdr
           FROM m2_transaction_journal j
           INNER JOIN m1_coa c ON c.cnomor = j.tnorek
           WHERE COALESCE(j.tstatus, 0) NOT IN (6, 12)
             AND COALESCE(j.tposting, 1) = 1
             AND c.cgd = 'D'
             AND (
               c.ctipe = 12
               OR c.cnomor LIKE '52%'
               OR c.cnomor LIKE '53%'
               OR LOWER(c.cnama) LIKE '%produksi%'
               OR LOWER(c.cnama) LIKE '%pabrik%'
               OR LOWER(c.cnama) LIKE '%overhead%'
               OR LOWER(c.cnama) LIKE '%tenaga kerja langsung%'
             )
             AND j.ttgl >= ? AND j.ttgl <= ?
           GROUP BY DATE_FORMAT(j.ttgl, '%Y-%m'), c.cnomor, c.cnama`,
          [dateFrom, dateTo]
        );

        const accAgg = new Map<
          string,
          {
            accountNo: string;
            accountName: string;
            costGroup: ErpProductionBiGlAccountRow['costGroup'];
            entryCount: number;
            amountIdr: number;
          }
        >();

        for (const r of glRows) {
          const ym = String(r.month || '');
          const accNo = String(r.accountNo || '').trim();
          const accName = String(r.accountName || '').trim();
          const amt = Number(r.amountIdr || 0);
          const cnt = Number(r.entryCount || 0);
          if (!accNo) continue;

          const group = classifyGlProdCostGroup(accNo, accName);
          const mRow = ensureMonth(ym);
          if (mRow) {
            if (group === 'Bahan Baku') mRow.glMaterialCost += amt;
            else if (group === 'Tenaga Kerja') mRow.glLaborCost += amt;
            else if (group === 'Overhead Pabrik') mRow.glOverheadCost += amt;
            else mRow.glOtherProdCost += amt;
            mRow.glTotalProdCost += amt;
          }

          const existing = accAgg.get(accNo) || {
            accountNo: accNo,
            accountName: accName,
            costGroup: group,
            entryCount: 0,
            amountIdr: 0,
          };
          existing.entryCount += cnt;
          existing.amountIdr += amt;
          accAgg.set(accNo, existing);
          totalGlProductionCostIdr += amt;
        }

        for (const a of Array.from(accAgg.values())
          .filter((x) => Math.abs(x.amountIdr) >= 1)
          .sort((a, b) => Math.abs(b.amountIdr) - Math.abs(a.amountIdr))
          .slice(0, 40)) {
          glProductionAccounts.push(a);
        }
      } catch {
        // Non-fatal
      }
    }

    // Finalize monthly ratios cleanly
    const monthly = Array.from(monthlyMap.values())
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((m) => {
        const totalQualityQty = m.goodQty + m.rejectQty;
        const effectiveOutput = m.actualOutputQty > 0 ? m.actualOutputQty : totalQualityQty;
        const woUnlinkedCount = Math.max(0, m.woCount - m.woLinkedToSoCount);
        const soWithoutWoCount = Math.max(0, m.soCount - m.soLinkedToWoCount);
        return {
          ...m,
          woUnlinkedCount,
          soWithoutWoCount,
          woToSoPct: m.woCount > 0 ? (m.woLinkedToSoCount / m.woCount) * 100 : null,
          soCoveredByWoPct: m.soCount > 0 ? (m.soLinkedToWoCount / m.soCount) * 100 : null,
          woVsSoRatioPct: m.soCount > 0 ? (m.woCount / m.soCount) * 100 : null,
          actualOutputQty: effectiveOutput,
          achievementPct: m.plannedQty > 0 ? (effectiveOutput / m.plannedQty) * 100 : null,
          woCompletionRatePct: m.woCount > 0 ? (m.woCompleteCount / m.woCount) * 100 : null,
          yieldPct: totalQualityQty > 0 ? (m.goodQty / totalQualityQty) * 100 : null,
          rejectRatePct: totalQualityQty > 0 ? (m.rejectQty / totalQualityQty) * 100 : null,
          materialVariancePct:
            m.plannedMaterialQty > 0
              ? ((m.actualMaterialQty - m.plannedMaterialQty) / m.plannedMaterialQty) * 100
              : null,
          unitCostIdr:
            effectiveOutput > 0 && m.glTotalProdCost > 0
              ? m.glTotalProdCost / effectiveOutput
              : null,
        };
      });

    return {
      cutoffDate: ACTIVE_ERP_CUTOFF_DATE,
      period: { dateFrom, dateTo },
      discoveredTables,
      diagnostics: {
        hasM6Tables: discoveredTables.length > 0,
        hasM6TransactionsInPeriod,
        hasSalesOrderTable: hasSalesOrder,
        workOrderTable: woTable?.tableName || null,
        outputTable: outputTable?.tableName || null,
        materialTable: materialTable?.tableName || null,
        woSoLinkMethod,
        woSoLinkColumn,
        qualitySource,
        hasGlProductionCosts: glProductionAccounts.length > 0,
        totalGlProductionCostIdr,
      },
      monthly,
      woSoLinks,
      openWorkOrders,
      productQuality,
      topMaterials,
      glProductionAccounts,
      fetchedAt: new Date().toISOString(),
    };
  });

  if (productionBiCache.size > 24) {
    const oldest = productionBiCache.keys().next().value;
    if (oldest) productionBiCache.delete(oldest);
  }
  productionBiCache.set(cacheKey, {
    expiresAt: Date.now() + PRODUCTION_BI_CACHE_TTL_MS,
    data,
  });
  return data;
}
