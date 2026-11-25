import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import {
  classifyGrnStatusCode,
  classifyStandardStatusCode,
  computeUrgencyLevel,
  filterPendingRulesForUser,
  getHigherUrgency,
  PENDING_TRANSACTION_RULES,
  PENDING_TX_SERVER_CACHE_TTL_MS,
  sortPendingEvaluations,
  type ErpAccessEvaluationMode,
  type ErpDocumentStatusCounts,
  type ErpPurchasingMenuPermissions,
  type GrnStatusCounts,
  type PendingRuleEvaluation,
  type PendingTransactionRuleConfig,
  type PendingTransactionsSummaryResponse,
  type PendingUrgencyLevel,
  type StandardStatusCounts,
  type StatusInconsistencyItem,
  type StatusVerificationReport,
} from '../src/config/pendingTransactionRules.ts';
import type { RolePermissionMatrix } from '../src/config/menuRegistry.ts';
import type { UserRole } from '../src/types/sop.ts';
import {
  fetchErpBridgeJson,
  getErpBridgeConfig,
  isErpMysqlConfigured,
  queryErpPurchasingData,
  queryErpSalesData,
  withReadOnlyConnection,
} from './erpMysql.ts';
import { resolveErpUserPurchasingAccess } from './erpUserAccess.ts';

const ACTIVE_CUTOFF_DATE = '2026-03-01';
const SAFE_SQL_ID = /^[a-zA-Z0-9_]{1,64}$/;
const QTY_EPSILON = 0.0001;

interface RawRuleAggregate {
  ruleId: string;
  count: number;
  oldestDate: string | null;
  infoCount?: number;
  overdueCount: number;
  warningCount: number;
  normalCount: number;
  detectionMethod: string;
}

interface EvaluationBundle {
  rawRules: RawRuleAggregate[];
  statusCounts: ErpDocumentStatusCounts;
  verification: StatusVerificationReport;
}

interface BridgePendingResponse {
  bridgeVersion?: number;
  cutoffDate: string;
  rules: RawRuleAggregate[];
  statusCounts?: ErpDocumentStatusCounts;
  verification?: StatusVerificationReport;
  fetchedAt: string;
}

const pendingSummaryCache = new Map<
  string,
  {
    expiresAt: number;
    sourceMode: PendingTransactionsSummaryResponse['sourceMode'];
    rawRules: RawRuleAggregate[];
    statusCounts: ErpDocumentStatusCounts;
    verification: StatusVerificationReport;
    warning?: string;
  }
>();

const tableColumnsCache = new Map<string, { expiresAt: number; cols: string[] }>();

export function invalidatePendingTransactionsCache(): void {
  pendingSummaryCache.clear();
}

function formatDateYmd(val: unknown): string | null {
  if (!val) return null;
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return val.toISOString().slice(0, 10);
  }
  const s = String(val).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function computeAgeDaysFromYmd(ymd: string | null): number {
  if (!ymd) return 0;
  const parsed = Date.parse(`${ymd}T00:00:00Z`);
  if (Number.isNaN(parsed)) return 0;
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.floor((todayUtc - parsed) / 86_400_000));
}

function emptyStandardCounts(): StandardStatusCounts {
  return { all: 0, need_approve: 0, approved: 0, in_progress: 0, completed: 0 };
}

function emptyGrnCounts(): GrnStatusCounts {
  return { all: 0, belum_ri: 0, completed: 0 };
}

async function getCachedTableCols(conn: PoolConnection, tableName: string): Promise<string[]> {
  if (!SAFE_SQL_ID.test(tableName)) return [];
  const cached = tableColumnsCache.get(tableName);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.cols;
  }
  try {
    const [rows] = await conn.query<RowDataPacket[]>(`SHOW COLUMNS FROM \`${tableName}\``);
    const cols = rows
      .map((r) => String(r.Field || r.field || '').trim())
      .filter((c) => SAFE_SQL_ID.test(c));
    tableColumnsCache.set(tableName, { expiresAt: Date.now() + 5 * 60_000, cols });
    return cols;
  } catch {
    return [];
  }
}

function pickExactCol(cols: string[], candidates: string[]): string | null {
  const lowerMap = new Map(cols.map((c) => [c.toLowerCase(), c]));
  for (const cand of candidates) {
    const found = lowerMap.get(cand.toLowerCase());
    if (found) return found;
  }
  return null;
}

function pickApprovalDateCol(cols: string[], prefix: string): string | null {
  return pickExactCol(cols, [
    `${prefix}tglapprove`,
    `${prefix}tglapproved`,
    `${prefix}approve_date`,
    `${prefix}approvedate`,
    `${prefix}approved_at`,
    `${prefix}dateapprove`,
    'tglapprove',
    'approved_at',
    'approve_date',
    'approved_date',
  ]);
}

function buildDateExpr(alias: string, dateCol: string, approvalDateCol: string | null): string {
  if (approvalDateCol && SAFE_SQL_ID.test(approvalDateCol)) {
    return `COALESCE(${alias}.\`${approvalDateCol}\`, ${alias}.\`${dateCol}\`)`;
  }
  return `${alias}.\`${dateCol}\``;
}

async function queryStandardStatusCounts(
  conn: PoolConnection,
  opts: {
    table: string;
    dateCol: string;
    statusCol: string;
    closeCol: string | null;
  }
): Promise<StandardStatusCounts> {
  const closeCond = opts.closeCol ? `COALESCE(\`${opts.closeCol}\`, 0) = 1` : '0 = 1';
  const notClosedCond = opts.closeCol ? `COALESCE(\`${opts.closeCol}\`, 0) = 0` : '1 = 1';
  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS allCnt,
       COALESCE(SUM(CASE WHEN ${notClosedCond} AND COALESCE(\`${opts.statusCol}\`, 0) IN (0, 1, 5, 8, 9, 10, 11) THEN 1 ELSE 0 END), 0) AS needApproveCnt,
       COALESCE(SUM(CASE WHEN ${notClosedCond} AND COALESCE(\`${opts.statusCol}\`, 0) = 2 THEN 1 ELSE 0 END), 0) AS approvedCnt,
       COALESCE(SUM(CASE WHEN ${notClosedCond} AND COALESCE(\`${opts.statusCol}\`, 0) = 3 THEN 1 ELSE 0 END), 0) AS inProgressCnt,
       COALESCE(SUM(CASE WHEN (${closeCond} OR COALESCE(\`${opts.statusCol}\`, 0) IN (4, 7)) THEN 1 ELSE 0 END), 0) AS completedCnt
     FROM \`${opts.table}\`
     WHERE \`${opts.dateCol}\` >= ?
       AND COALESCE(\`${opts.statusCol}\`, 0) NOT IN (6, 12)`,
    [ACTIVE_CUTOFF_DATE]
  );
  const r = rows[0] || {};
  return {
    all: Number(r.allCnt || 0),
    need_approve: Number(r.needApproveCnt || 0),
    approved: Number(r.approvedCnt || 0),
    in_progress: Number(r.inProgressCnt || 0),
    completed: Number(r.completedCnt || 0),
  };
}

async function queryGrnStatusCounts(
  conn: PoolConnection,
  opts: {
    dateCol: string;
    statusCol: string | null;
    closeCol: string | null;
  }
): Promise<GrnStatusCounts> {
  const notVoid = opts.statusCol ? `AND COALESCE(\`${opts.statusCol}\`, 0) NOT IN (6, 12)` : '';
  const completedCond = opts.closeCol
    ? opts.statusCol
      ? `(COALESCE(\`${opts.closeCol}\`, 0) = 1 OR COALESCE(\`${opts.statusCol}\`, 0) IN (4, 7))`
      : `COALESCE(\`${opts.closeCol}\`, 0) = 1`
    : opts.statusCol
      ? `COALESCE(\`${opts.statusCol}\`, 0) IN (4, 7)`
      : '0 = 1';

  const [rows] = await conn.query<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS allCnt,
       COALESCE(SUM(CASE WHEN ${completedCond} THEN 1 ELSE 0 END), 0) AS completedCnt,
       COALESCE(SUM(CASE WHEN NOT (${completedCond}) THEN 1 ELSE 0 END), 0) AS belumRiCnt
     FROM m4_grn
     WHERE \`${opts.dateCol}\` >= ?
       ${notVoid}`,
    [ACTIVE_CUTOFF_DATE]
  );
  const r = rows[0] || {};
  return {
    all: Number(r.allCnt || 0),
    belum_ri: Number(r.belumRiCnt || 0),
    completed: Number(r.completedCnt || 0),
  };
}

/**
 * Executes purely READ-ONLY aggregate queries (COUNT + MIN date + urgency buckets +
 * relational status verification + status chip counts) directly against MySQL ERP
 * for ONLY the modules & rules permitted for the authenticated caller.
 */
async function evaluateRulesDirectMysql(
  rules: PendingTransactionRuleConfig[],
  scope: { hasPurchasingAccess: boolean; hasSalesAccess: boolean }
): Promise<EvaluationBundle> {
  const statusCounts: ErpDocumentStatusCounts = {};
  const inconsistencies: StatusInconsistencyItem[] = [];
  const approvalDateColumns: Record<string, string | null> = {};
  let usedRelationBasis = false;

  if (rules.length === 0) {
    return {
      rawRules: [],
      statusCounts,
      verification: {
        checked: false,
        referenceBasis: 'status_column_fallback',
        qtyFormula: 'processedQty = GREATEST(grnQty, riQty) (Draft ikut dihitung, Void/Reject dikecualikan)',
        approvalDateColumns,
        inconsistencies,
      },
    };
  }

  const ruleMap = new Map(rules.map((r) => [r.id, r]));

  const rawRules = await withReadOnlyConnection(async (conn) => {
    const [tblRows] = await conn.query<RowDataPacket[]>(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME IN (
           'm5_so', 'm5_so_detail', 'm5_do', 'm5_do_detail', 'm5_si', 'm5_si_detail',
           'm4_pr', 'm4_pr_detail', 'm4_po', 'm4_po_detail', 'm4_grn', 'm4_grn_detail', 'm4_ri', 'm4_ri_detail',
           'm4_pi', 'm4_pi_detail'
         )`
    );
    const tblSet = new Set(
      tblRows.map((r) => String(r.TABLE_NAME || r.table_name || '').toLowerCase())
    );

    const results: RawRuleAggregate[] = [];

    // =========================================================================
    // PURCHASING MODULE (only queried when caller has purchasing permission)
    // =========================================================================
    if (scope.hasPurchasingAccess) {
      // 1) PR (m4_pr)
      if (tblSet.has('m4_pr')) {
        const prCols = await getCachedTableCols(conn, 'm4_pr');
        const prCloseCol = pickExactCol(prCols, ['prisclose', 'isclose']);
        const prApproveCol = pickApprovalDateCol(prCols, 'pr');
        approvalDateColumns.m4_pr = prApproveCol;

        try {
          statusCounts.pr = await queryStandardStatusCounts(conn, {
            table: 'm4_pr',
            dateCol: 'prtgl',
            statusCol: 'prstatus',
            closeCol: prCloseCol,
          });
        } catch (err) {
          console.warn('[PendingTx] PR statusCounts skipped:', err instanceof Error ? err.message : err);
        }

        const prRule = ruleMap.get('purchasing_pr_pending_po');
        if (prRule) {
          try {
            const warnDays = prRule.urgencyThresholds.warningDays;
            const overdueDays = prRule.urgencyThresholds.overdueDays;
            const ageExpr = buildDateExpr('pr', 'prtgl', prApproveCol);
            const [rows] = await conn.query<RowDataPacket[]>(
              `SELECT
                 COUNT(*) AS cnt,
                 MIN(${ageExpr}) AS oldestDate,
                 COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ${ageExpr}) >= ? THEN 1 ELSE 0 END), 0) AS overdueCnt,
                 COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ${ageExpr}) >= ? AND DATEDIFF(CURDATE(), ${ageExpr}) < ? THEN 1 ELSE 0 END), 0) AS warningCnt,
                 COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ${ageExpr}) < ? THEN 1 ELSE 0 END), 0) AS normalCnt
               FROM m4_pr pr
               WHERE pr.prtgl >= ?
                 AND COALESCE(pr.prisclose, 0) = 0
                 AND COALESCE(pr.prstatus, 0) IN (2, 3)
                 AND (COALESCE(pr.prstatuspo, 0) = 0 OR COALESCE(pr.prstatus, 0) = 3)`,
              [overdueDays, warnDays, overdueDays, warnDays, ACTIVE_CUTOFF_DATE]
            );
            const r = rows[0] || {};
            results.push({
              ruleId: prRule.id,
              count: Number(r.cnt || 0),
              oldestDate: formatDateYmd(r.oldestDate),
              overdueCount: Number(r.overdueCnt || 0),
              warningCount: Number(r.warningCnt || 0),
              normalCount: Number(r.normalCnt || 0),
              detectionMethod: 'm4_pr (prisclose=0, prstatus IN 2,3 [Approved/In Progress], prstatuspo=0 OR prstatus=3)',
            });
          } catch (err) {
            console.warn('[PendingTx] PR rule skipped:', err instanceof Error ? err.message : err);
          }
        }
      }

      // 2) PO (m4_po) — relational verification against m4_po_detail, m4_grn_detail+m4_grn, m4_ri_detail+m4_ri
      if (tblSet.has('m4_po')) {
        const poCols = await getCachedTableCols(conn, 'm4_po');
        const poCloseCol = pickExactCol(poCols, ['poisclose', 'isclose']);
        const poApproveCol = pickApprovalDateCol(poCols, 'po');
        approvalDateColumns.m4_po = poApproveCol;

        try {
          statusCounts.po = await queryStandardStatusCounts(conn, {
            table: 'm4_po',
            dateCol: 'potgl',
            statusCol: 'postatus',
            closeCol: poCloseCol,
          });
        } catch (err) {
          console.warn('[PendingTx] PO statusCounts skipped:', err instanceof Error ? err.message : err);
        }

        // Introspect detail & downstream relation columns (myERPplus uses idpodetail/idgrndetail + jml + header FKs)
        const poDetCols = tblSet.has('m4_po_detail') ? await getCachedTableCols(conn, 'm4_po_detail') : [];
        const poDetPk = pickExactCol(poDetCols, ['idpodetail', 'id']);
        const poDetFk = pickExactCol(poDetCols, ['idpo', 'poid', 'idpoid', 'idtransaksi']);
        const poDetQty = pickExactCol(poDetCols, ['jml', 'qty', 'poqty', 'dqty', 'jumlah', 'qtyorder', 'podqty']);

        const grnCols = tblSet.has('m4_grn') ? await getCachedTableCols(conn, 'm4_grn') : [];
        const grnIdCol = pickExactCol(grnCols, ['grnid', 'id']);
        const grnPoHdrFk = pickExactCol(grnCols, ['grnidpo', 'idpo', 'poid']);
        const grnStatusCol = pickExactCol(grnCols, ['grnstatus', 'status']);
        const grnDetCols = tblSet.has('m4_grn_detail') ? await getCachedTableCols(conn, 'm4_grn_detail') : [];
        const grnDetPk = pickExactCol(grnDetCols, ['idgrndetail', 'id']);
        const grnDetGrnFk = pickExactCol(grnDetCols, ['idgrn', 'grnid', 'idtransaksi']);
        const grnDetPoDetFk = pickExactCol(grnDetCols, ['idpodetail']);
        const grnDetPoFk = pickExactCol(grnDetCols, ['idpo', 'poid', 'grnpoid', 'dpo', 'idref']);
        const grnDetQty = pickExactCol(grnDetCols, ['jml', 'qty', 'grnqty', 'dqty', 'jumlah', 'grndqty']);

        const riTable = tblSet.has('m4_ri') ? 'm4_ri' : tblSet.has('m4_pi') ? 'm4_pi' : null;
        const riDetTable = tblSet.has('m4_ri_detail')
          ? 'm4_ri_detail'
          : tblSet.has('m4_pi_detail')
            ? 'm4_pi_detail'
            : null;
        const riCols = riTable ? await getCachedTableCols(conn, riTable) : [];
        const riIdCol = pickExactCol(riCols, ['riid', 'piid', 'id']);
        const riPoHdrFk = pickExactCol(riCols, ['riidpo', 'piidpo', 'idpo', 'poid']);
        const riGrnHdrFk = pickExactCol(riCols, ['riidgrn', 'piidgrn', 'idgrn', 'grnid']);
        const riStatusCol = pickExactCol(riCols, ['ristatus', 'pistatus', 'status']);
        const riDetCols = riDetTable ? await getCachedTableCols(conn, riDetTable) : [];
        const riDetRiFk = pickExactCol(riDetCols, ['idri', 'riid', 'idpi', 'piid', 'idtransaksi']);
        const riDetPoDetFk = pickExactCol(riDetCols, ['idpodetail']);
        const riDetGrnDetFk = pickExactCol(riDetCols, ['idgrndetail']);
        const riDetPoFk = pickExactCol(riDetCols, ['idpo', 'poid', 'ripoid', 'pipoid', 'idref']);
        const riDetQty = pickExactCol(riDetCols, ['jml', 'qty', 'riqty', 'piqty', 'dqty', 'jumlah', 'ridqty']);

        const hasGrnViaPoDet = Boolean(poDetPk && poDetFk && grnIdCol && grnDetGrnFk && grnDetPoDetFk);
        const hasGrnViaDetPo = Boolean(grnIdCol && grnDetGrnFk && grnDetPoFk);
        const hasGrnViaHdr = Boolean(grnIdCol && grnPoHdrFk);
        const hasGrnRelation = hasGrnViaPoDet || hasGrnViaDetPo || hasGrnViaHdr;

        const hasRiViaPoDet = Boolean(riTable && riDetTable && riIdCol && riDetRiFk && poDetPk && poDetFk && riDetPoDetFk);
        const hasRiViaGrnDet = Boolean(
          riTable && riDetTable && riIdCol && riDetRiFk && poDetPk && poDetFk && grnDetPk && grnDetPoDetFk && riDetGrnDetFk
        );
        const hasRiViaDetPo = Boolean(riTable && riDetTable && riIdCol && riDetRiFk && riDetPoFk);
        const hasRiViaHdr = Boolean(riTable && riIdCol && riPoHdrFk);
        const hasRiRelation = hasRiViaPoDet || hasRiViaGrnDet || hasRiViaDetPo || hasRiViaHdr;

        const hasPoDetailQty = Boolean(poDetFk && poDetQty);
        const canUsePoRelation = hasGrnRelation || hasRiRelation;

        if (canUsePoRelation) {
          usedRelationBasis = true;
          try {
            const poQtyJoin = hasPoDetailQty
              ? `LEFT JOIN (
                   SELECT \`${poDetFk}\` AS poid, COALESCE(SUM(COALESCE(\`${poDetQty}\`, 0)), 0) AS po_qty
                   FROM m4_po_detail
                   GROUP BY \`${poDetFk}\`
                 ) pd ON pd.poid = po.poid`
              : '';

            // Build GRN aggregation join (prefers exact idpodetail chain + header grnidpo)
            let grnJoin = '';
            if (hasGrnRelation) {
              const grnNotVoid = grnStatusCol ? `COALESCE(g.\`${grnStatusCol}\`, 0) NOT IN (6, 12)` : '1=1';
              if (hasGrnViaPoDet) {
                const qtyExpr = grnDetQty ? `COALESCE(gd.\`${grnDetQty}\`, 0)` : '0';
                const hdrUnion = hasGrnViaHdr
                  ? `UNION ALL
                     SELECT g.\`${grnPoHdrFk}\` AS poid, g.\`${grnIdCol}\` AS grnid, 0 AS grn_qty
                     FROM m4_grn g
                     WHERE COALESCE(g.\`${grnPoHdrFk}\`, 0) > 0 AND ${grnNotVoid}`
                  : '';
                grnJoin = `LEFT JOIN (
                   SELECT poid, COUNT(DISTINCT grnid) AS grn_docs, COALESCE(SUM(grn_qty), 0) AS grn_qty
                   FROM (
                     SELECT pd.\`${poDetFk}\` AS poid, g.\`${grnIdCol}\` AS grnid, ${qtyExpr} AS grn_qty
                     FROM m4_grn_detail gd
                     INNER JOIN m4_po_detail pd ON pd.\`${poDetPk}\` = gd.\`${grnDetPoDetFk}\`
                     INNER JOIN m4_grn g ON g.\`${grnIdCol}\` = gd.\`${grnDetGrnFk}\`
                     WHERE COALESCE(gd.\`${grnDetPoDetFk}\`, 0) > 0 AND ${grnNotVoid}
                     ${hdrUnion}
                   ) gx
                   GROUP BY poid
                 ) gr ON gr.poid = po.poid`;
              } else if (hasGrnViaDetPo) {
                grnJoin = `LEFT JOIN (
                   SELECT gd.\`${grnDetPoFk}\` AS poid,
                          COUNT(DISTINCT g.\`${grnIdCol}\`) AS grn_docs,
                          ${grnDetQty ? `COALESCE(SUM(COALESCE(gd.\`${grnDetQty}\`, 0)), 0)` : '0'} AS grn_qty
                   FROM m4_grn_detail gd
                   INNER JOIN m4_grn g ON g.\`${grnIdCol}\` = gd.\`${grnDetGrnFk}\`
                   WHERE ${grnNotVoid}
                   GROUP BY gd.\`${grnDetPoFk}\`
                 ) gr ON gr.poid = po.poid`;
              } else if (hasGrnViaHdr) {
                grnJoin = `LEFT JOIN (
                   SELECT g.\`${grnPoHdrFk}\` AS poid, COUNT(DISTINCT g.\`${grnIdCol}\`) AS grn_docs, 0 AS grn_qty
                   FROM m4_grn g
                   WHERE COALESCE(g.\`${grnPoHdrFk}\`, 0) > 0 AND ${grnNotVoid}
                   GROUP BY g.\`${grnPoHdrFk}\`
                 ) gr ON gr.poid = po.poid`;
              }
            }

            // Build RI aggregation join (catches direct PO->RI via idpodetail, indirect PO->GRN->RI via idgrndetail, and header riidpo/riidgrn)
            let riJoin = '';
            if (hasRiRelation) {
              const riNotVoid = riStatusCol ? `COALESCE(ri.\`${riStatusCol}\`, 0) NOT IN (6, 12)` : '1=1';
              if (hasRiViaPoDet || hasRiViaGrnDet) {
                const riQtyExpr = riDetQty ? `COALESCE(rd.\`${riDetQty}\`, 0)` : '0';
                const parts: string[] = [];
                if (hasRiViaPoDet) {
                  parts.push(
                    `SELECT pd.\`${poDetFk}\` AS poid, ri.\`${riIdCol}\` AS riid, ${riQtyExpr} AS ri_qty
                     FROM \`${riDetTable}\` rd
                     INNER JOIN m4_po_detail pd ON pd.\`${poDetPk}\` = rd.\`${riDetPoDetFk}\`
                     INNER JOIN \`${riTable}\` ri ON ri.\`${riIdCol}\` = rd.\`${riDetRiFk}\`
                     WHERE COALESCE(rd.\`${riDetPoDetFk}\`, 0) > 0 AND ${riNotVoid}`
                  );
                }
                if (hasRiViaGrnDet) {
                  const avoidDup = hasRiViaPoDet ? `AND COALESCE(rd.\`${riDetPoDetFk}\`, 0) = 0` : '';
                  parts.push(
                    `SELECT pd.\`${poDetFk}\` AS poid, ri.\`${riIdCol}\` AS riid, ${riQtyExpr} AS ri_qty
                     FROM \`${riDetTable}\` rd
                     INNER JOIN m4_grn_detail gd ON gd.\`${grnDetPk}\` = rd.\`${riDetGrnDetFk}\`
                     INNER JOIN m4_po_detail pd ON pd.\`${poDetPk}\` = gd.\`${grnDetPoDetFk}\`
                     INNER JOIN \`${riTable}\` ri ON ri.\`${riIdCol}\` = rd.\`${riDetRiFk}\`
                     WHERE COALESCE(rd.\`${riDetGrnDetFk}\`, 0) > 0 AND COALESCE(gd.\`${grnDetPoDetFk}\`, 0) > 0 ${avoidDup} AND ${riNotVoid}`
                  );
                }
                if (hasRiViaHdr) {
                  parts.push(
                    `SELECT ri.\`${riPoHdrFk}\` AS poid, ri.\`${riIdCol}\` AS riid, 0 AS ri_qty
                     FROM \`${riTable}\` ri
                     WHERE COALESCE(ri.\`${riPoHdrFk}\`, 0) > 0 AND ${riNotVoid}`
                  );
                }
                if (riGrnHdrFk && hasGrnViaHdr) {
                  parts.push(
                    `SELECT g.\`${grnPoHdrFk}\` AS poid, ri.\`${riIdCol}\` AS riid, 0 AS ri_qty
                     FROM \`${riTable}\` ri
                     INNER JOIN m4_grn g ON g.\`${grnIdCol}\` = ri.\`${riGrnHdrFk}\`
                     WHERE COALESCE(ri.\`${riGrnHdrFk}\`, 0) > 0 AND COALESCE(g.\`${grnPoHdrFk}\`, 0) > 0 AND ${riNotVoid}`
                  );
                }
                riJoin = `LEFT JOIN (
                   SELECT poid, COUNT(DISTINCT riid) AS ri_docs, COALESCE(SUM(ri_qty), 0) AS ri_qty
                   FROM (${parts.join(' UNION ALL ')}) rx
                   GROUP BY poid
                 ) rr ON rr.poid = po.poid`;
              } else if (hasRiViaDetPo) {
                riJoin = `LEFT JOIN (
                   SELECT rd.\`${riDetPoFk}\` AS poid,
                          COUNT(DISTINCT ri.\`${riIdCol}\`) AS ri_docs,
                          ${riDetQty ? `COALESCE(SUM(COALESCE(rd.\`${riDetQty}\`, 0)), 0)` : '0'} AS ri_qty
                   FROM \`${riDetTable}\` rd
                   INNER JOIN \`${riTable}\` ri ON ri.\`${riIdCol}\` = rd.\`${riDetRiFk}\`
                   WHERE ${riNotVoid}
                   GROUP BY rd.\`${riDetPoFk}\`
                 ) rr ON rr.poid = po.poid`;
              } else if (hasRiViaHdr) {
                riJoin = `LEFT JOIN (
                   SELECT ri.\`${riPoHdrFk}\` AS poid, COUNT(DISTINCT ri.\`${riIdCol}\`) AS ri_docs, 0 AS ri_qty
                   FROM \`${riTable}\` ri
                   WHERE COALESCE(ri.\`${riPoHdrFk}\`, 0) > 0 AND ${riNotVoid}
                   GROUP BY ri.\`${riPoHdrFk}\`
                 ) rr ON rr.poid = po.poid`;
              }
            }

            const poQtySel = hasPoDetailQty ? 'COALESCE(pd.po_qty, 0)' : '0';
            const grnDocsSel = hasGrnRelation ? 'COALESCE(gr.grn_docs, 0)' : '0';
            const grnQtySel = hasGrnRelation ? 'COALESCE(gr.grn_qty, 0)' : '0';
            const riDocsSel = hasRiRelation ? 'COALESCE(rr.ri_docs, 0)' : '0';
            const riQtySel = hasRiRelation ? 'COALESCE(rr.ri_qty, 0)' : '0';
            const ageExpr = buildDateExpr('po', 'potgl', poApproveCol);
            const closeExpr = poCloseCol ? `COALESCE(po.\`${poCloseCol}\`, 0)` : '0';

            const [poRows] = await conn.query<RowDataPacket[]>(
              `SELECT
                 po.poid,
                 po.ponotransaksi AS docNo,
                 po.potgl AS docDate,
                 ${ageExpr} AS refDate,
                 COALESCE(po.postatus, 0) AS statusCode,
                 ${closeExpr} AS isClosed,
                 COALESCE(po.postatusgrn, 0) AS flagGrn,
                 COALESCE(po.postatusri, 0) AS flagRi,
                 ${poQtySel} AS poQty,
                 ${grnDocsSel} AS grnDocs,
                 ${grnQtySel} AS grnQty,
                 ${riDocsSel} AS riDocs,
                 ${riQtySel} AS riQty
               FROM m4_po po
               ${poQtyJoin}
               ${grnJoin}
               ${riJoin}
               WHERE po.potgl >= ?
                 AND COALESCE(po.postatus, 0) NOT IN (6, 12)`,
              [ACTIVE_CUTOFF_DATE]
            );

            const needApproveDates: string[] = [];
            const approvedDates: string[] = [];
            const inProgressDates: string[] = [];

            const incApprovedHasDownstream: string[] = [];
            const incInProgressMismatch: string[] = [];
            const incCompletedMissingDownstream: string[] = [];

            for (const row of poRows) {
              const docNo = String(row.docNo || row.poid || '');
              const docDate = formatDateYmd(row.docDate);
              const refDate = formatDateYmd(row.refDate) || docDate;
              const st = Number(row.statusCode || 0);
              const isClosed = Number(row.isClosed || 0) === 1;
              const poQty = Number(row.poQty || 0);
              const grnDocs = Number(row.grnDocs || 0);
              const grnQty = Number(row.grnQty || 0);
              const riDocs = Number(row.riDocs || 0);
              const riQty = Number(row.riQty || 0);

              const processedQty = Math.max(grnQty, riQty);
              const hasDownstream = grnDocs > 0 || riDocs > 0 || processedQty > QTY_EPSILON;
              const isFullyProcessed = poQty > QTY_EPSILON && processedQty >= poQty - QTY_EPSILON;
              const isPartiallyProcessed =
                hasDownstream && (poQty > QTY_EPSILON ? processedQty < poQty - QTY_EPSILON : st === 3);

              // Read-only inconsistency verification (NEVER modifies DB)
              if (!isClosed && st === 2 && hasDownstream) {
                incApprovedHasDownstream.push(docNo);
              }
              if (!isClosed && st === 3 && (!hasDownstream || isFullyProcessed)) {
                incInProgressMismatch.push(docNo);
              }
              if (!isClosed && st === 4 && !hasDownstream) {
                incCompletedMissingDownstream.push(docNo);
              }

              // Effective status based on relational truth
              if (isClosed || st === 7) continue;

              if ([0, 1, 5, 8, 9, 10, 11].includes(st) && !hasDownstream) {
                if (docDate) needApproveDates.push(docDate);
              } else if (isFullyProcessed) {
                // Completed — not counted as pending
              } else if (isPartiallyProcessed) {
                if (refDate) inProgressDates.push(refDate);
              } else if (!hasDownstream && (st === 2 || st === 3)) {
                if (refDate) approvedDates.push(refDate);
              }
            }

            if (incApprovedHasDownstream.length > 0) {
              inconsistencies.push({
                code: 'po_approved_has_downstream',
                sourceTable: 'm4_po',
                count: incApprovedHasDownstream.length,
                sampleDocNos: incApprovedHasDownstream.slice(0, 5),
                descriptionKey: 'pendingTx.verification.po_approved_has_downstream',
              });
            }
            if (incInProgressMismatch.length > 0) {
              inconsistencies.push({
                code: 'po_in_progress_mismatch',
                sourceTable: 'm4_po',
                count: incInProgressMismatch.length,
                sampleDocNos: incInProgressMismatch.slice(0, 5),
                descriptionKey: 'pendingTx.verification.po_in_progress_mismatch',
              });
            }
            if (incCompletedMissingDownstream.length > 0) {
              inconsistencies.push({
                code: 'po_completed_missing_downstream',
                sourceTable: 'm4_po',
                count: incCompletedMissingDownstream.length,
                sampleDocNos: incCompletedMissingDownstream.slice(0, 5),
                descriptionKey: 'pendingTx.verification.po_completed_missing_downstream',
              });
            }

            const poNeedApproveRule = ruleMap.get('purchasing_po_need_approve');
            if (poNeedApproveRule) {
              results.push(
                summarizeDatesForRule(
                  poNeedApproveRule,
                  needApproveDates,
                  'relasi m4_po (postatus IN 0,1,5,8..11, tanpa GRN/RI)'
                )
              );
            }
            const poApprovedRule = ruleMap.get('purchasing_po_approved_pending');
            if (poApprovedRule) {
              results.push(
                summarizeDatesForRule(
                  poApprovedRule,
                  approvedDates,
                  `relasi m4_po vs ${hasGrnRelation ? 'm4_grn_detail' : ''}${hasGrnRelation && hasRiRelation ? '+' : ''}${hasRiRelation ? riDetTable : ''} (Approved, 0 transaksi lanjutan)`
                )
              );
            }
            const poInProgressRule = ruleMap.get('purchasing_po_in_progress');
            if (poInProgressRule) {
              results.push(
                summarizeDatesForRule(
                  poInProgressRule,
                  inProgressDates,
                  'relasi m4_po_detail vs m4_grn_detail/m4_ri_detail (0 < qty diproses < qty PO)'
                )
              );
            }
          } catch (err) {
            console.warn('[PendingTx] PO relational evaluation failed, falling back to status columns:', err instanceof Error ? err.message : err);
            await evaluatePoStatusFallback(conn, ruleMap, poCloseCol, poApproveCol, results);
          }
        } else {
          await evaluatePoStatusFallback(conn, ruleMap, poCloseCol, poApproveCol, results);
        }
      }

      // 3) GRN (m4_grn) — verified against m4_ri_detail + m4_ri
      if (tblSet.has('m4_grn')) {
        const gCols = await getCachedTableCols(conn, 'm4_grn');
        const idCol = pickExactCol(gCols, ['grnid', 'id']);
        const noCol = pickExactCol(gCols, ['grnnotransaksi', 'notransaksi', 'no_grn']);
        const dtCol = pickExactCol(gCols, ['grntgl', 'tgl']);
        const stCol = pickExactCol(gCols, ['grnstatus', 'status']);
        const closeCol = pickExactCol(gCols, ['grnisclose', 'isclose']);
        approvalDateColumns.m4_grn = pickApprovalDateCol(gCols, 'grn');

        if (dtCol) {
          try {
            statusCounts.grn = await queryGrnStatusCounts(conn, {
              dateCol: dtCol,
              statusCol: stCol,
              closeCol,
            });
          } catch (err) {
            console.warn('[PendingTx] GRN statusCounts skipped:', err instanceof Error ? err.message : err);
          }

          const grnRule = ruleMap.get('purchasing_grn_pending_ri');
          if (grnRule) {
            const riColsForGrn = tblSet.has('m4_ri') ? await getCachedTableCols(conn, 'm4_ri') : [];
            const riHdrGrnFk = pickExactCol(riColsForGrn, ['riidgrn', 'idgrn', 'grnid']);
            const grnDetColsForRi = tblSet.has('m4_grn_detail')
              ? await getCachedTableCols(conn, 'm4_grn_detail')
              : [];
            const grnDetPkForRi = pickExactCol(grnDetColsForRi, ['idgrndetail', 'id']);
            const grnDetFkForRi = pickExactCol(grnDetColsForRi, ['idgrn', 'grnid', 'idtransaksi']);
            const riDetCols = tblSet.has('m4_ri_detail')
              ? await getCachedTableCols(conn, 'm4_ri_detail')
              : [];
            const idRiCol = pickExactCol(riDetCols, ['idri', 'riid', 'idtransaksi']);
            const idGrnDetCol = pickExactCol(riDetCols, ['idgrndetail']);
            const idGrnCol = pickExactCol(riDetCols, ['idgrn', 'grnid', 'ridgrn', 'idref']);
            const hasGrnRiViaDetail = Boolean(
              idCol && tblSet.has('m4_ri') && idRiCol && grnDetPkForRi && grnDetFkForRi && idGrnDetCol
            );
            const hasGrnRiViaDirectDet = Boolean(idCol && tblSet.has('m4_ri') && idRiCol && idGrnCol);
            const hasGrnRiViaHdr = Boolean(idCol && tblSet.has('m4_ri') && riHdrGrnFk);
            const hasGrnRiRelation = hasGrnRiViaDetail || hasGrnRiViaDirectDet || hasGrnRiViaHdr;

            try {
              if (hasGrnRiRelation) {
                usedRelationBasis = true;
                let riAggSubquery = '';
                let relLabel = 'm4_ri_detail.idgrndetail';
                if (hasGrnRiViaDetail) {
                  const parts: string[] = [
                    `SELECT gd.\`${grnDetFkForRi}\` AS grnid, ri.riid AS riid
                     FROM m4_ri_detail rd
                     INNER JOIN m4_grn_detail gd ON gd.\`${grnDetPkForRi}\` = rd.\`${idGrnDetCol}\`
                     INNER JOIN m4_ri ri ON ri.riid = rd.\`${idRiCol}\`
                     WHERE COALESCE(rd.\`${idGrnDetCol}\`, 0) > 0 AND COALESCE(ri.ristatus, 0) NOT IN (6, 12)`,
                  ];
                  if (hasGrnRiViaHdr) {
                    parts.push(
                      `SELECT ri.\`${riHdrGrnFk}\` AS grnid, ri.riid AS riid
                       FROM m4_ri ri
                       WHERE COALESCE(ri.\`${riHdrGrnFk}\`, 0) > 0 AND COALESCE(ri.ristatus, 0) NOT IN (6, 12)`
                    );
                  }
                  riAggSubquery = `SELECT grnid, COUNT(DISTINCT riid) AS ri_docs FROM (${parts.join(' UNION ')}) rix GROUP BY grnid`;
                } else if (hasGrnRiViaDirectDet) {
                  relLabel = `m4_ri_detail.${idGrnCol}`;
                  riAggSubquery = `SELECT rd.\`${idGrnCol}\` AS grnid, COUNT(DISTINCT ri.riid) AS ri_docs
                     FROM m4_ri_detail rd
                     INNER JOIN m4_ri ri ON ri.riid = rd.\`${idRiCol}\`
                     WHERE COALESCE(ri.ristatus, 0) NOT IN (6, 12)
                     GROUP BY rd.\`${idGrnCol}\``;
                } else {
                  relLabel = `m4_ri.${riHdrGrnFk}`;
                  riAggSubquery = `SELECT ri.\`${riHdrGrnFk}\` AS grnid, COUNT(DISTINCT ri.riid) AS ri_docs
                     FROM m4_ri ri
                     WHERE COALESCE(ri.\`${riHdrGrnFk}\`, 0) > 0 AND COALESCE(ri.ristatus, 0) NOT IN (6, 12)
                     GROUP BY ri.\`${riHdrGrnFk}\``;
                }

                const [grnRows] = await conn.query<RowDataPacket[]>(
                  `SELECT
                     g.\`${idCol}\` AS grnId,
                     ${noCol ? `g.\`${noCol}\`` : `g.\`${idCol}\``} AS docNo,
                     g.\`${dtCol}\` AS docDate,
                     ${stCol ? `COALESCE(g.\`${stCol}\`, 0)` : '0'} AS statusCode,
                     ${closeCol ? `COALESCE(g.\`${closeCol}\`, 0)` : '0'} AS isClosed,
                     COALESCE(ri_agg.ri_docs, 0) AS riDocs
                   FROM m4_grn g
                   LEFT JOIN (${riAggSubquery}) ri_agg ON ri_agg.grnid = g.\`${idCol}\`
                   WHERE g.\`${dtCol}\` >= ?
                     ${stCol ? `AND COALESCE(g.\`${stCol}\`, 0) NOT IN (6, 12)` : ''}`,
                  [ACTIVE_CUTOFF_DATE]
                );

                const pendingDates: string[] = [];
                const incCompletedMissingRi: string[] = [];
                const incNotCompletedHasRi: string[] = [];

                for (const row of grnRows) {
                  const docNo = String(row.docNo || row.grnId || '');
                  const docDate = formatDateYmd(row.docDate);
                  const st = Number(row.statusCode || 0);
                  const isClosed = Number(row.isClosed || 0) === 1;
                  const riDocs = Number(row.riDocs || 0);

                  if (!isClosed && st === 4 && riDocs === 0) {
                    incCompletedMissingRi.push(docNo);
                  }
                  if (!isClosed && st !== 4 && st !== 7 && riDocs > 0) {
                    incNotCompletedHasRi.push(docNo);
                  }

                  // Strictly notify only Approved (2) and In Progress (3) GRN documents without RI
                  if (!isClosed && (st === 2 || st === 3) && riDocs === 0) {
                    if (docDate) pendingDates.push(docDate);
                  }
                }

                if (incCompletedMissingRi.length > 0) {
                  inconsistencies.push({
                    code: 'grn_completed_missing_ri',
                    sourceTable: 'm4_grn',
                    count: incCompletedMissingRi.length,
                    sampleDocNos: incCompletedMissingRi.slice(0, 5),
                    descriptionKey: 'pendingTx.verification.grn_completed_missing_ri',
                  });
                }
                if (incNotCompletedHasRi.length > 0) {
                  inconsistencies.push({
                    code: 'grn_not_completed_has_ri',
                    sourceTable: 'm4_grn',
                    count: incNotCompletedHasRi.length,
                    sampleDocNos: incNotCompletedHasRi.slice(0, 5),
                    descriptionKey: 'pendingTx.verification.grn_not_completed_has_ri',
                  });
                }

                results.push(
                  summarizeDatesForRule(
                    grnRule,
                    pendingDates,
                    `relasi m4_grn (grnstatus IN 2,3) NOT EXISTS ${relLabel}`
                  )
                );
              } else {
                const warnDays = grnRule.urgencyThresholds.warningDays;
                const overdueDays = grnRule.urgencyThresholds.overdueDays;
                const closeSql = closeCol ? `AND COALESCE(g.\`${closeCol}\`, 0) = 0` : '';
                const stSql = stCol ? `AND COALESCE(g.\`${stCol}\`, 0) IN (2, 3)` : '';
                const [rows] = await conn.query<RowDataPacket[]>(
                  `SELECT
                     COUNT(*) AS cnt,
                     MIN(g.\`${dtCol}\`) AS oldestDate,
                     COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), g.\`${dtCol}\`) >= ? THEN 1 ELSE 0 END), 0) AS overdueCnt,
                     COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), g.\`${dtCol}\`) >= ? AND DATEDIFF(CURDATE(), g.\`${dtCol}\`) < ? THEN 1 ELSE 0 END), 0) AS warningCnt,
                     COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), g.\`${dtCol}\`) < ? THEN 1 ELSE 0 END), 0) AS normalCnt
                   FROM m4_grn g
                   WHERE g.\`${dtCol}\` >= ?
                     ${closeSql}
                     ${stSql}`,
                  [overdueDays, warnDays, overdueDays, warnDays, ACTIVE_CUTOFF_DATE]
                );
                const r = rows[0] || {};
                results.push({
                  ruleId: grnRule.id,
                  count: Number(r.cnt || 0),
                  oldestDate: formatDateYmd(r.oldestDate),
                  overdueCount: Number(r.overdueCnt || 0),
                  warningCount: Number(r.warningCnt || 0),
                  normalCount: Number(r.normalCnt || 0),
                  detectionMethod: `m4_grn (${stCol || 'grnstatus'} IN 2,3 [Approved/In Progress])`,
                });
              }
            } catch (err) {
              console.warn('[PendingTx] GRN rule skipped:', err instanceof Error ? err.message : err);
            }
          }
        }
      }

      // 4) PI / RI (m4_ri) — Approved / In Progress unpaid invoices awaiting Vendor Payment (m4_vp)
      const riVpRule = ruleMap.get('purchasing_ri_pending_vp');
      if (riVpRule && tblSet.has('m4_ri')) {
        try {
          const riCols = await getCachedTableCols(conn, 'm4_ri');
          const riDateCol = pickExactCol(riCols, ['ritgl', 'tgl']) || 'ritgl';
          const riStatusCol = pickExactCol(riCols, ['ristatus', 'status']) || 'ristatus';
          const riLunasCol = pickExactCol(riCols, ['ristatuslunas', 'statuslunas']);
          const riCloseCol = pickExactCol(riCols, ['riisclose', 'isclose']);
          const riTotalCol = pickExactCol(riCols, ['ritotaltransaksi', 'totaltransaksi', 'ritotal']);
          const riBayarCol = pickExactCol(riCols, ['rijmlbayar', 'jmlbayar', 'ribayar']);
          const riUmCol = pickExactCol(riCols, ['rijmluangmuka', 'jmluangmuka', 'riuangmuka']);
          const riApproveCol = pickApprovalDateCol(riCols, 'ri');
          approvalDateColumns.m4_ri = riApproveCol;

          const ageExpr = buildDateExpr('ri', riDateCol, riApproveCol);
          const closeSql = riCloseCol ? `AND COALESCE(ri.\`${riCloseCol}\`, 0) = 0` : '';
          const lunasSql = riLunasCol ? `AND COALESCE(ri.\`${riLunasCol}\`, 0) = 0` : '';
          const unpaidSql = riTotalCol
            ? `AND GREATEST(0, COALESCE(ri.\`${riTotalCol}\`, 0)${riBayarCol ? ` - COALESCE(ri.\`${riBayarCol}\`, 0)` : ''}${riUmCol ? ` - COALESCE(ri.\`${riUmCol}\`, 0)` : ''}) > 0.0001`
            : '';

          const warnDays = riVpRule.urgencyThresholds.warningDays;
          const overdueDays = riVpRule.urgencyThresholds.overdueDays;
          const [rows] = await conn.query<RowDataPacket[]>(
            `SELECT
               COUNT(*) AS cnt,
               MIN(${ageExpr}) AS oldestDate,
               COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ${ageExpr}) >= ? THEN 1 ELSE 0 END), 0) AS overdueCnt,
               COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ${ageExpr}) >= ? AND DATEDIFF(CURDATE(), ${ageExpr}) < ? THEN 1 ELSE 0 END), 0) AS warningCnt,
               COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ${ageExpr}) < ? THEN 1 ELSE 0 END), 0) AS normalCnt
             FROM m4_ri ri
             WHERE ri.\`${riDateCol}\` >= ?
               AND COALESCE(ri.\`${riStatusCol}\`, 0) IN (2, 3)
               ${closeSql}
               ${lunasSql}
               ${unpaidSql}`,
            [overdueDays, warnDays, overdueDays, warnDays, ACTIVE_CUTOFF_DATE]
          );
          const r = rows[0] || {};
          results.push({
            ruleId: riVpRule.id,
            count: Number(r.cnt || 0),
            oldestDate: formatDateYmd(r.oldestDate),
            overdueCount: Number(r.overdueCnt || 0),
            warningCount: Number(r.warningCnt || 0),
            normalCount: Number(r.normalCnt || 0),
            detectionMethod: 'm4_ri (ristatus IN 2,3 [Approved/In Progress], ristatuslunas=0, sisa hutang > 0)',
          });
        } catch (err) {
          console.warn('[PendingTx] RI->VP rule skipped:', err instanceof Error ? err.message : err);
        }
      }
    }

    // =========================================================================
    // SALES MODULE (only queried when caller has sales permission)
    // =========================================================================
    if (scope.hasSalesAccess) {
      // 1) SO (m5_so)
      if (tblSet.has('m5_so')) {
        const soCols = await getCachedTableCols(conn, 'm5_so');
        const soCloseCol = pickExactCol(soCols, ['soisclose', 'isclose']);
        const soApproveCol = pickApprovalDateCol(soCols, 'so');
        approvalDateColumns.m5_so = soApproveCol;

        try {
          statusCounts.so = await queryStandardStatusCounts(conn, {
            table: 'm5_so',
            dateCol: 'sotgl',
            statusCol: 'sostatus',
            closeCol: soCloseCol,
          });
        } catch (err) {
          console.warn('[PendingTx] SO statusCounts skipped:', err instanceof Error ? err.message : err);
        }

        const soDetCols = tblSet.has('m5_so_detail') ? await getCachedTableCols(conn, 'm5_so_detail') : [];
        const soDetFk = pickExactCol(soDetCols, ['idso', 'soid', 'idtransaksi']);
        const soDetQty = pickExactCol(soDetCols, ['qty', 'soqty', 'dqty', 'jumlah']);

        const doDetCols = tblSet.has('m5_do_detail') ? await getCachedTableCols(conn, 'm5_do_detail') : [];
        const doDetDoFk = pickExactCol(doDetCols, ['iddo', 'doid', 'idtransaksi']);
        const doDetSoFk = pickExactCol(doDetCols, ['idso', 'soid', 'dosoid', 'idref']);
        const doDetQty = pickExactCol(doDetCols, ['qty', 'doqty', 'dqty', 'jumlah']);

        const canUseSoRelation = Boolean(tblSet.has('m5_do') && doDetDoFk && doDetSoFk);

        if (canUseSoRelation) {
          usedRelationBasis = true;
          try {
            const soQtyJoin =
              soDetFk && soDetQty
                ? `LEFT JOIN (
                     SELECT \`${soDetFk}\` AS soid, COALESCE(SUM(COALESCE(\`${soDetQty}\`, 0)), 0) AS so_qty
                     FROM m5_so_detail
                     GROUP BY \`${soDetFk}\`
                   ) sd ON sd.soid = so.soid`
                : '';
            const doJoin = `LEFT JOIN (
              SELECT dd.\`${doDetSoFk}\` AS soid,
                     COUNT(DISTINCT d.doid) AS do_docs,
                     ${doDetQty ? `COALESCE(SUM(COALESCE(dd.\`${doDetQty}\`, 0)), 0)` : '0'} AS do_qty
              FROM m5_do_detail dd
              INNER JOIN m5_do d ON d.doid = dd.\`${doDetDoFk}\`
              WHERE COALESCE(d.dostatus, 0) NOT IN (6, 12)
              GROUP BY dd.\`${doDetSoFk}\`
            ) dr ON dr.soid = so.soid`;

            const ageExpr = buildDateExpr('so', 'sotgl', soApproveCol);
            const [soRows] = await conn.query<RowDataPacket[]>(
              `SELECT
                 so.soid,
                 so.sonotransaksi AS docNo,
                 ${ageExpr} AS refDate,
                 COALESCE(so.sostatus, 0) AS statusCode,
                 ${soCloseCol ? `COALESCE(so.\`${soCloseCol}\`, 0)` : '0'} AS isClosed,
                 ${soDetFk && soDetQty ? 'COALESCE(sd.so_qty, 0)' : '0'} AS soQty,
                 COALESCE(dr.do_docs, 0) AS doDocs,
                 COALESCE(dr.do_qty, 0) AS doQty
               FROM m5_so so
               ${soQtyJoin}
               ${doJoin}
               WHERE so.sotgl >= ?
                 AND COALESCE(so.sostatus, 0) NOT IN (6, 12)`,
              [ACTIVE_CUTOFF_DATE]
            );

            const soApprovedDates: string[] = [];
            const soInProgressDates: string[] = [];
            const soMismatchDocs: string[] = [];

            for (const row of soRows) {
              const docNo = String(row.docNo || row.soid || '');
              const refDate = formatDateYmd(row.refDate);
              const st = Number(row.statusCode || 0);
              const isClosed = Number(row.isClosed || 0) === 1;
              const soQty = Number(row.soQty || 0);
              const doDocs = Number(row.doDocs || 0);
              const doQty = Number(row.doQty || 0);

              const hasDo = doDocs > 0 || doQty > QTY_EPSILON;
              const isFullDo = soQty > QTY_EPSILON && doQty >= soQty - QTY_EPSILON;
              const isPartialDo = hasDo && (soQty > QTY_EPSILON ? doQty < soQty - QTY_EPSILON : st === 3);

              if (!isClosed && ((st === 2 && hasDo) || (st === 4 && !hasDo))) {
                soMismatchDocs.push(docNo);
              }

              if (isClosed || st === 7 || isFullDo) continue;

              if (isPartialDo) {
                if (refDate) soInProgressDates.push(refDate);
              } else if (!hasDo && (st === 2 || st === 3)) {
                if (refDate) soApprovedDates.push(refDate);
              }
            }

            if (soMismatchDocs.length > 0) {
              inconsistencies.push({
                code: 'so_status_relation_mismatch',
                sourceTable: 'm5_so',
                count: soMismatchDocs.length,
                sampleDocNos: soMismatchDocs.slice(0, 5),
                descriptionKey: 'pendingTx.verification.so_status_relation_mismatch',
              });
            }

            const soAppRule = ruleMap.get('sales_so_approved_pending');
            if (soAppRule) {
              results.push(
                summarizeDatesForRule(
                  soAppRule,
                  soApprovedDates,
                  'relasi m5_so vs m5_do_detail (Approved, 0 DO terkait)'
                )
              );
            }
            const soProgRule = ruleMap.get('sales_so_in_progress');
            if (soProgRule) {
              results.push(
                summarizeDatesForRule(
                  soProgRule,
                  soInProgressDates,
                  'relasi m5_so_detail vs m5_do_detail (0 < qty DO < qty SO)'
                )
              );
            }
          } catch (err) {
            console.warn('[PendingTx] SO relational evaluation failed, falling back:', err instanceof Error ? err.message : err);
            await evaluateSoStatusFallback(conn, ruleMap, soCloseCol, soApproveCol, results);
          }
        } else {
          await evaluateSoStatusFallback(conn, ruleMap, soCloseCol, soApproveCol, results);
        }
      }

      // 2) DO (m5_do)
      if (tblSet.has('m5_do')) {
        const doCols = await getCachedTableCols(conn, 'm5_do');
        const closeCol = pickExactCol(doCols, ['doisclose', 'isclose']);
        const doApproveCol = pickApprovalDateCol(doCols, 'do');
        approvalDateColumns.m5_do = doApproveCol;
        const closeSql = closeCol ? `AND COALESCE(d.\`${closeCol}\`, 0) = 0` : '';

        try {
          statusCounts.do = await queryStandardStatusCounts(conn, {
            table: 'm5_do',
            dateCol: 'dotgl',
            statusCol: 'dostatus',
            closeCol,
          });
        } catch (err) {
          console.warn('[PendingTx] DO statusCounts skipped:', err instanceof Error ? err.message : err);
        }

        const doApprovalRule = ruleMap.get('sales_do_pending_approval');
        if (doApprovalRule) {
          try {
            const warnDays = doApprovalRule.urgencyThresholds.warningDays;
            const overdueDays = doApprovalRule.urgencyThresholds.overdueDays;
            const [rows] = await conn.query<RowDataPacket[]>(
              `SELECT
                 COUNT(*) AS cnt,
                 MIN(d.dotgl) AS oldestDate,
                 COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), d.dotgl) >= ? THEN 1 ELSE 0 END), 0) AS overdueCnt,
                 COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), d.dotgl) >= ? AND DATEDIFF(CURDATE(), d.dotgl) < ? THEN 1 ELSE 0 END), 0) AS warningCnt,
                 COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), d.dotgl) < ? THEN 1 ELSE 0 END), 0) AS normalCnt
               FROM m5_do d
               WHERE d.dotgl >= ?
                 ${closeSql}
                 AND COALESCE(d.dostatus, 0) IN (0, 1, 5, 8, 9, 10, 11)`,
              [overdueDays, warnDays, overdueDays, warnDays, ACTIVE_CUTOFF_DATE]
            );
            const r = rows[0] || {};
            results.push({
              ruleId: doApprovalRule.id,
              count: Number(r.cnt || 0),
              oldestDate: formatDateYmd(r.oldestDate),
              overdueCount: Number(r.overdueCnt || 0),
              warningCount: Number(r.warningCnt || 0),
              normalCount: Number(r.normalCnt || 0),
              detectionMethod: `m5_do (dostatus IN 0,1,5,8..11${closeCol ? `, ${closeCol}=0` : ''})`,
            });
          } catch (err) {
            console.warn('[PendingTx] DO approval rule skipped:', err instanceof Error ? err.message : err);
          }
        }

        const doSiRule = ruleMap.get('sales_do_pending_si');
        if (doSiRule) {
          try {
            const warnDays = doSiRule.urgencyThresholds.warningDays;
            const overdueDays = doSiRule.urgencyThresholds.overdueDays;
            const statusSiCol = pickExactCol(doCols, [
              'dostatussi',
              'dostatusfaktur',
              'dostatusinv',
              'doissi',
            ]);
            const ageExpr = buildDateExpr('d', 'dotgl', doApproveCol);
            let uninvoicedSql = '';
            let method = 'm5_do (dostatus IN 2,3)';

            if (tblSet.has('m5_si') && tblSet.has('m5_si_detail')) {
              const siDetCols = await getCachedTableCols(conn, 'm5_si_detail');
              const idSiCol = pickExactCol(siDetCols, ['idsi', 'siid', 'idtransaksi']);
              const idDoCol = pickExactCol(siDetCols, ['iddo', 'doid', 'sidoid', 'diddo', 'idref']);
              if (idSiCol && idDoCol) {
                usedRelationBasis = true;
                uninvoicedSql = `AND NOT EXISTS (
                  SELECT 1 FROM m5_si_detail sd
                  INNER JOIN m5_si si ON si.siid = sd.\`${idSiCol}\`
                  WHERE sd.\`${idDoCol}\` = d.doid AND COALESCE(si.sistatus, 0) NOT IN (6, 12)
                )`;
                method = `relasi m5_do (dostatus IN 2,3) NOT EXISTS m5_si_detail.${idDoCol}`;
              }
            }
            if (!uninvoicedSql && statusSiCol) {
              uninvoicedSql = `AND COALESCE(d.\`${statusSiCol}\`, 0) = 0`;
              method = `m5_do (dostatus IN 2,3, ${statusSiCol}=0)`;
            }

            const [rows] = await conn.query<RowDataPacket[]>(
              `SELECT
                 COUNT(*) AS cnt,
                 MIN(${ageExpr}) AS oldestDate,
                 COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ${ageExpr}) >= ? THEN 1 ELSE 0 END), 0) AS overdueCnt,
                 COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ${ageExpr}) >= ? AND DATEDIFF(CURDATE(), ${ageExpr}) < ? THEN 1 ELSE 0 END), 0) AS warningCnt,
                 COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ${ageExpr}) < ? THEN 1 ELSE 0 END), 0) AS normalCnt
               FROM m5_do d
               WHERE d.dotgl >= ?
                 ${closeSql}
                 AND COALESCE(d.dostatus, 0) IN (2, 3)
                 ${uninvoicedSql}`,
              [overdueDays, warnDays, overdueDays, warnDays, ACTIVE_CUTOFF_DATE]
            );
            const r = rows[0] || {};
            results.push({
              ruleId: doSiRule.id,
              count: Number(r.cnt || 0),
              oldestDate: formatDateYmd(r.oldestDate),
              overdueCount: Number(r.overdueCnt || 0),
              warningCount: Number(r.warningCnt || 0),
              normalCount: Number(r.normalCnt || 0),
              detectionMethod: method,
            });
          } catch (err) {
            console.warn('[PendingTx] DO SI rule skipped:', err instanceof Error ? err.message : err);
          }
        }
      }
    }

    return results;
  });

  return {
    rawRules,
    statusCounts,
    verification: {
      checked: true,
      referenceBasis: usedRelationBasis ? 'relation' : 'status_column_fallback',
      qtyFormula:
        'processedQty = GREATEST(SUM(m4_grn_detail.qty), SUM(m4_ri_detail.qty)) — dokumen Draft (status=0) ikut dihitung, Void/Reject (status IN 6,12) dikecualikan',
      approvalDateColumns,
      inconsistencies,
    },
  };
}

async function evaluatePoStatusFallback(
  conn: PoolConnection,
  ruleMap: Map<string, PendingTransactionRuleConfig>,
  closeCol: string | null,
  approveCol: string | null,
  results: RawRuleAggregate[]
): Promise<void> {
  const closeSql = closeCol ? `AND COALESCE(po.\`${closeCol}\`, 0) = 0` : '';
  const ageExpr = buildDateExpr('po', 'potgl', approveCol);

  const poNeedApprove = ruleMap.get('purchasing_po_need_approve');
  if (poNeedApprove) {
    const { warningDays: w, overdueDays: o } = poNeedApprove.urgencyThresholds;
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt, MIN(po.potgl) AS oldestDate,
         COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), po.potgl) >= ? THEN 1 ELSE 0 END), 0) AS overdueCnt,
         COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), po.potgl) >= ? AND DATEDIFF(CURDATE(), po.potgl) < ? THEN 1 ELSE 0 END), 0) AS warningCnt,
         COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), po.potgl) < ? THEN 1 ELSE 0 END), 0) AS normalCnt
       FROM m4_po po
       WHERE po.potgl >= ? ${closeSql} AND COALESCE(po.postatus, 0) IN (0, 1, 5, 8, 9, 10, 11)`,
      [o, w, o, w, ACTIVE_CUTOFF_DATE]
    );
    const r = rows[0] || {};
    results.push({
      ruleId: poNeedApprove.id,
      count: Number(r.cnt || 0),
      oldestDate: formatDateYmd(r.oldestDate),
      overdueCount: Number(r.overdueCnt || 0),
      warningCount: Number(r.warningCnt || 0),
      normalCount: Number(r.normalCnt || 0),
      detectionMethod: 'm4_po fallback (postatus IN 0,1,5,8..11)',
    });
  }

  const poApproved = ruleMap.get('purchasing_po_approved_pending');
  if (poApproved) {
    const { warningDays: w, overdueDays: o } = poApproved.urgencyThresholds;
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt, MIN(${ageExpr}) AS oldestDate,
         COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ${ageExpr}) >= ? THEN 1 ELSE 0 END), 0) AS overdueCnt,
         COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ${ageExpr}) >= ? AND DATEDIFF(CURDATE(), ${ageExpr}) < ? THEN 1 ELSE 0 END), 0) AS warningCnt,
         COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ${ageExpr}) < ? THEN 1 ELSE 0 END), 0) AS normalCnt
       FROM m4_po po
       WHERE po.potgl >= ? ${closeSql}
         AND COALESCE(po.postatus, 0) = 2
         AND COALESCE(po.postatusgrn, 0) = 0
         AND COALESCE(po.postatusri, 0) = 0`,
      [o, w, o, w, ACTIVE_CUTOFF_DATE]
    );
    const r = rows[0] || {};
    results.push({
      ruleId: poApproved.id,
      count: Number(r.cnt || 0),
      oldestDate: formatDateYmd(r.oldestDate),
      overdueCount: Number(r.overdueCnt || 0),
      warningCount: Number(r.warningCnt || 0),
      normalCount: Number(r.normalCnt || 0),
      detectionMethod: 'm4_po fallback (postatus=2, postatusgrn=0, postatusri=0)',
    });
  }

  const poInProgress = ruleMap.get('purchasing_po_in_progress');
  if (poInProgress) {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt, MIN(${ageExpr}) AS oldestDate
       FROM m4_po po
       WHERE po.potgl >= ? ${closeSql} AND COALESCE(po.postatus, 0) = 3`,
      [ACTIVE_CUTOFF_DATE]
    );
    const r = rows[0] || {};
    const cnt = Number(r.cnt || 0);
    results.push({
      ruleId: poInProgress.id,
      count: cnt,
      oldestDate: formatDateYmd(r.oldestDate),
      infoCount: cnt,
      overdueCount: 0,
      warningCount: 0,
      normalCount: 0,
      detectionMethod: 'm4_po fallback (postatus=3 / In Progress)',
    });
  }
}

async function evaluateSoStatusFallback(
  conn: PoolConnection,
  ruleMap: Map<string, PendingTransactionRuleConfig>,
  closeCol: string | null,
  approveCol: string | null,
  results: RawRuleAggregate[]
): Promise<void> {
  const closeSql = closeCol ? `AND COALESCE(so.\`${closeCol}\`, 0) = 0` : '';
  const ageExpr = buildDateExpr('so', 'sotgl', approveCol);

  const soApproved = ruleMap.get('sales_so_approved_pending');
  if (soApproved) {
    const { warningDays: w, overdueDays: o } = soApproved.urgencyThresholds;
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt, MIN(${ageExpr}) AS oldestDate,
         COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ${ageExpr}) >= ? THEN 1 ELSE 0 END), 0) AS overdueCnt,
         COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ${ageExpr}) >= ? AND DATEDIFF(CURDATE(), ${ageExpr}) < ? THEN 1 ELSE 0 END), 0) AS warningCnt,
         COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ${ageExpr}) < ? THEN 1 ELSE 0 END), 0) AS normalCnt
       FROM m5_so so
       WHERE so.sotgl >= ? ${closeSql}
         AND COALESCE(so.sostatus, 0) = 2
         AND COALESCE(so.sostatusdo, 0) = 0`,
      [o, w, o, w, ACTIVE_CUTOFF_DATE]
    );
    const r = rows[0] || {};
    results.push({
      ruleId: soApproved.id,
      count: Number(r.cnt || 0),
      oldestDate: formatDateYmd(r.oldestDate),
      overdueCount: Number(r.overdueCnt || 0),
      warningCount: Number(r.warningCnt || 0),
      normalCount: Number(r.normalCnt || 0),
      detectionMethod: 'm5_so fallback (sostatus=2, sostatusdo=0)',
    });
  }

  const soInProgress = ruleMap.get('sales_so_in_progress');
  if (soInProgress) {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt, MIN(${ageExpr}) AS oldestDate
       FROM m5_so so
       WHERE so.sotgl >= ? ${closeSql} AND COALESCE(so.sostatus, 0) = 3`,
      [ACTIVE_CUTOFF_DATE]
    );
    const r = rows[0] || {};
    const cnt = Number(r.cnt || 0);
    results.push({
      ruleId: soInProgress.id,
      count: cnt,
      oldestDate: formatDateYmd(r.oldestDate),
      infoCount: cnt,
      overdueCount: 0,
      warningCount: 0,
      normalCount: 0,
      detectionMethod: 'm5_so fallback (sostatus=3 / In Progress)',
    });
  }
}

function summarizeDatesForRule(
  rule: PendingTransactionRuleConfig,
  dates: string[],
  method: string,
  overrideCount?: number
): RawRuleAggregate {
  const validDates = dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const oldestDate = validDates.length > 0 ? validDates[0] : null;
  let infoCount = 0;
  let overdueCount = 0;
  let warningCount = 0;
  let normalCount = 0;

  for (const d of validDates) {
    const age = computeAgeDaysFromYmd(d);
    const u = computeUrgencyLevel(age, rule.urgencyThresholds, Boolean(rule.informational));
    if (u === 'info') infoCount++;
    else if (u === 'overdue') overdueCount++;
    else if (u === 'warning') warningCount++;
    else normalCount++;
  }

  const finalCount =
    typeof overrideCount === 'number' && overrideCount > validDates.length
      ? overrideCount
      : validDates.length;

  return {
    ruleId: rule.id,
    count: finalCount,
    oldestDate,
    infoCount,
    overdueCount,
    warningCount,
    normalCount,
    detectionMethod: method,
  };
}

function tallyStandardStatusCounts(
  rows: Array<{ statusCode: number; isClosed?: boolean }>
): StandardStatusCounts {
  const out = emptyStandardCounts();
  for (const row of rows) {
    const cls = classifyStandardStatusCode(row.statusCode, Boolean(row.isClosed));
    if (cls === 'excluded') continue;
    out.all++;
    out[cls]++;
  }
  return out;
}

function tallyGrnStatusCounts(
  rows: Array<{ statusCode: number; isClosed?: boolean }>
): GrnStatusCounts {
  const out = emptyGrnCounts();
  for (const row of rows) {
    const cls = classifyGrnStatusCode(row.statusCode, Boolean(row.isClosed));
    if (cls === 'excluded') continue;
    out.all++;
    out[cls]++;
  }
  return out;
}

/**
 * Graceful non-blocking fallback when the user's local PC is still running Bridge v6 or v7
 * (which does not yet expose v8 relational verification & statusCounts).
 */
async function evaluateRulesBridgeFallback(
  rules: PendingTransactionRuleConfig[],
  scope: { hasPurchasingAccess: boolean; hasSalesAccess: boolean }
): Promise<EvaluationBundle> {
  const [salesData, purchasingData] = await Promise.all([
    scope.hasSalesAccess
      ? queryErpSalesData({ dateFrom: ACTIVE_CUTOFF_DATE, limit: 200 }).catch(() => null)
      : Promise.resolve(null),
    scope.hasPurchasingAccess
      ? queryErpPurchasingData({ dateFrom: ACTIVE_CUTOFF_DATE, limit: 200 }).catch(() => null)
      : Promise.resolve(null),
  ]);

  const rawRules: RawRuleAggregate[] = [];
  const statusCounts: ErpDocumentStatusCounts = {};
  const inconsistencies: StatusInconsistencyItem[] = [];

  if (purchasingData) {
    statusCounts.po = tallyStandardStatusCounts(purchasingData.purchaseOrders);
    statusCounts.grn = tallyGrnStatusCounts(purchasingData.goodsReceipts);
    statusCounts.pr = tallyStandardStatusCounts(purchasingData.purchaseRequests);

    // Flag-based consistency check available even in Bridge v6/v7 payload
    const poCompletedNoFlag = purchasingData.purchaseOrders
      .filter((po) => !po.isClosed && po.statusCode === 4 && po.statusGrn === 0 && po.statusRi === 0)
      .map((po) => po.docNo);
    if (poCompletedNoFlag.length > 0) {
      inconsistencies.push({
        code: 'po_completed_missing_downstream',
        sourceTable: 'm4_po',
        count: poCompletedNoFlag.length,
        sampleDocNos: poCompletedNoFlag.slice(0, 5),
        descriptionKey: 'pendingTx.verification.po_completed_missing_downstream',
      });
    }

    const poApprovedHasFlag = purchasingData.purchaseOrders
      .filter((po) => !po.isClosed && po.statusCode === 2 && (po.statusGrn > 0 || po.statusRi > 0))
      .map((po) => po.docNo);
    if (poApprovedHasFlag.length > 0) {
      inconsistencies.push({
        code: 'po_approved_has_downstream',
        sourceTable: 'm4_po',
        count: poApprovedHasFlag.length,
        sampleDocNos: poApprovedHasFlag.slice(0, 5),
        descriptionKey: 'pendingTx.verification.po_approved_has_downstream',
      });
    }
  }

  if (salesData) {
    statusCounts.so = tallyStandardStatusCounts(salesData.salesOrders);
    statusCounts.do = tallyStandardStatusCounts(salesData.deliveryOrders);
  }

  for (const rule of rules) {
    if (rule.id === 'purchasing_pr_pending_po' && purchasingData) {
      const pending = purchasingData.purchaseRequests.filter(
        (pr) => [2, 3].includes(pr.statusCode) && (pr.statusPo === 0 || pr.statusCode === 3)
      );
      rawRules.push(
        summarizeDatesForRule(
          rule,
          pending.map((x) => x.date),
          'bridge_fallback (m4_pr Approved/In Progress)'
        )
      );
    } else if (rule.id === 'purchasing_po_need_approve' && purchasingData) {
      const pending = purchasingData.purchaseOrders.filter(
        (po) => !po.isClosed && [0, 1, 5, 8, 9, 10, 11].includes(po.statusCode)
      );
      rawRules.push(
        summarizeDatesForRule(
          rule,
          pending.map((x) => x.date),
          'bridge_fallback (m4_po Need Approve)'
        )
      );
    } else if (rule.id === 'purchasing_po_approved_pending' && purchasingData) {
      const pending = purchasingData.purchaseOrders.filter(
        (po) => !po.isClosed && po.statusCode === 2 && po.statusGrn === 0 && po.statusRi === 0
      );
      rawRules.push(
        summarizeDatesForRule(
          rule,
          pending.map((x) => x.date),
          'bridge_fallback (m4_po Approved, GRN=0 & RI=0)'
        )
      );
    } else if (rule.id === 'purchasing_po_in_progress' && purchasingData) {
      const pending = purchasingData.purchaseOrders.filter(
        (po) =>
          !po.isClosed &&
          (po.statusCode === 3 ||
            (po.statusCode === 2 && (po.statusGrn > 0 || po.statusRi > 0)))
      );
      rawRules.push(
        summarizeDatesForRule(
          rule,
          pending.map((x) => x.date),
          'bridge_fallback (m4_po In Progress / parsial)'
        )
      );
    } else if (rule.id === 'purchasing_grn_pending_ri' && purchasingData) {
      const pending = purchasingData.goodsReceipts.filter(
        (g) => [2, 3].includes(g.statusCode) && classifyGrnStatusCode(g.statusCode) === 'belum_ri'
      );
      rawRules.push(
        summarizeDatesForRule(
          rule,
          pending.map((x) => x.date),
          'bridge_fallback (m4_grn Approved/In Progress belum RI)'
        )
      );
    } else if (rule.id === 'purchasing_ri_pending_vp' && purchasingData) {
      const pending = (purchasingData.unpaidInvoices || []).filter(
        (inv) =>
          inv.date >= ACTIVE_CUTOFF_DATE &&
          [2, 3].includes(inv.statusCode) &&
          inv.balanceIdr > QTY_EPSILON
      );
      rawRules.push(
        summarizeDatesForRule(
          rule,
          pending.map((x) => x.date),
          'bridge_fallback (m4_ri Approved/In Progress, sisa hutang > 0)'
        )
      );
    } else if (rule.id === 'sales_so_approved_pending' && salesData) {
      const pending = salesData.salesOrders.filter(
        (so) => !so.isClosed && so.statusCode === 2 && so.statusDo === 0
      );
      rawRules.push(
        summarizeDatesForRule(
          rule,
          pending.map((x) => x.date),
          'bridge_fallback (m5_so Approved, DO=0)'
        )
      );
    } else if (rule.id === 'sales_so_in_progress' && salesData) {
      const pending = salesData.salesOrders.filter(
        (so) => !so.isClosed && (so.statusCode === 3 || (so.statusCode === 2 && so.statusDo > 0))
      );
      rawRules.push(
        summarizeDatesForRule(
          rule,
          pending.map((x) => x.date),
          'bridge_fallback (m5_so In Progress)'
        )
      );
    } else if (rule.id === 'sales_do_pending_approval' && salesData) {
      const pending = salesData.deliveryOrders.filter((d) =>
        [0, 1, 5, 8, 9, 10, 11].includes(d.statusCode)
      );
      rawRules.push(
        summarizeDatesForRule(
          rule,
          pending.map((x) => x.date),
          'bridge_fallback (m5_do Need Approve)'
        )
      );
    } else if (rule.id === 'sales_do_pending_si' && salesData) {
      const pending = salesData.deliveryOrders.filter((d) => [2, 3].includes(d.statusCode));
      rawRules.push(
        summarizeDatesForRule(
          rule,
          pending.map((x) => x.date),
          'bridge_fallback (m5_do Approved/Inprogress)'
        )
      );
    }
  }

  return {
    rawRules,
    statusCounts,
    verification: {
      checked: true,
      referenceBasis: 'status_column_fallback',
      qtyFormula:
        'Mode kompatibilitas Bridge v6/v7 (flag postatusgrn/postatusri); perbarui erp-mysql-bridge.mjs (v9) untuk verifikasi tabel detail penuh & hak akses menu ERP.',
      approvalDateColumns: {},
      inconsistencies,
    },
  };
}

function buildSummaryResponse(params: {
  allowedRules: PendingTransactionRuleConfig[];
  rawRules: RawRuleAggregate[];
  statusCounts?: ErpDocumentStatusCounts;
  verification?: StatusVerificationReport;
  sourceMode: PendingTransactionsSummaryResponse['sourceMode'];
  callerScope: PendingTransactionsSummaryResponse['callerScope'];
  cached: boolean;
  warning?: string;
}): PendingTransactionsSummaryResponse {
  const rawMap = new Map(params.rawRules.map((r) => [r.ruleId, r]));
  const evaluations: PendingRuleEvaluation[] = [];

  for (const rule of params.allowedRules) {
    const raw = rawMap.get(rule.id);
    const count = Math.max(0, Number(raw?.count || 0));
    const oldestDate = raw?.oldestDate || null;
    const oldestAgeDays = count > 0 ? computeAgeDaysFromYmd(oldestDate) : 0;
    const urgency: PendingUrgencyLevel =
      count > 0
        ? computeUrgencyLevel(oldestAgeDays, rule.urgencyThresholds, Boolean(rule.informational))
        : rule.informational
          ? 'info'
          : 'normal';

    evaluations.push({
      ruleId: rule.id,
      module: rule.module,
      targetView: rule.targetView,
      targetErpTab: rule.targetErpTab,
      targetSubTab: rule.targetSubTab,
      targetFilterKey: rule.targetFilterKey,
      targetStatusChip: rule.targetStatusChip,
      sourceTable: rule.sourceTable,
      includedStatuses: rule.includedStatuses,
      informational: rule.informational,
      count,
      oldestDate,
      oldestAgeDays,
      urgency,
      urgencyBreakdown: {
        info: Math.max(0, Number(raw?.infoCount ?? (rule.informational ? count : 0))),
        normal: Math.max(0, Number(raw?.normalCount || 0)),
        warning: Math.max(0, Number(raw?.warningCount || 0)),
        overdue: Math.max(0, Number(raw?.overdueCount || 0)),
      },
      detectionMethod: raw?.detectionMethod || rule.pendingConditionSummary,
      textKeys: rule.textKeys,
    });
  }

  const activeSorted = sortPendingEvaluations(evaluations.filter((e) => e.count > 0));
  const totalCount = activeSorted.reduce((sum, e) => sum + e.count, 0);
  const highestUrgency = activeSorted.reduce<PendingUrgencyLevel | null>(
    (acc, e) => getHigherUrgency(acc, e.urgency),
    null
  );

  const salesItems = activeSorted.filter((e) => e.module === 'sales');
  const purchasingItems = activeSorted.filter((e) => e.module === 'purchasing');

  return {
    available: params.sourceMode !== 'unavailable',
    sourceMode: params.sourceMode,
    cutoffDate: ACTIVE_CUTOFF_DATE,
    totalCount,
    highestUrgency,
    byModule: {
      sales: {
        count: salesItems.reduce((s, e) => s + e.count, 0),
        oldestAgeDays: salesItems.reduce((m, e) => Math.max(m, e.oldestAgeDays), 0),
        highestUrgency: salesItems.reduce<PendingUrgencyLevel | null>(
          (acc, e) => getHigherUrgency(acc, e.urgency),
          null
        ),
      },
      purchasing: {
        count: purchasingItems.reduce((s, e) => s + e.count, 0),
        oldestAgeDays: purchasingItems.reduce((m, e) => Math.max(m, e.oldestAgeDays), 0),
        highestUrgency: purchasingItems.reduce<PendingUrgencyLevel | null>(
          (acc, e) => getHigherUrgency(acc, e.urgency),
          null
        ),
      },
    },
    rules: activeSorted,
    allowedRuleIds: params.allowedRules.map((r) => r.id),
    statusCounts: params.statusCounts,
    verification: params.verification,
    callerScope: params.callerScope,
    fetchedAt: new Date().toISOString(),
    cached: params.cached,
    warning: params.warning,
  };
}

/**
 * Main entry point called by GET /api/erp/pending-notifications.
 * Strictly enforces caller role, division, and ERP m0_role_menu Purchasing permissions
 * server-side BEFORE querying or returning any data.
 */
export async function queryErpPendingTransactions(params: {
  caller: {
    role: UserRole;
    divisionName: string;
    erpUserId?: number;
    erpUserCode?: string;
    erpUserName?: string;
    rbacPermissions?: RolePermissionMatrix | null;
    isSystemAdmin?: boolean;
  };
  bypassCache?: boolean;
}): Promise<PendingTransactionsSummaryResponse> {
  let erpAccessMode: ErpAccessEvaluationMode = 'super_admin';
  let erpPurchasingAccess: ErpPurchasingMenuPermissions | null | undefined = undefined;
  let erpRoles: string[] | undefined = undefined;
  let resolvedErpUserName = params.caller.erpUserName;
  let erpAccessWarning: string | undefined;

  // When RBAC RolePermissionMatrix is provided (unified User Role `Notif` routing),
  // we evaluate notification eligibility directly from the user's Role matrix without m0_user lookup.
  if (params.caller.rbacPermissions) {
    erpAccessMode = params.caller.isSystemAdmin ? 'super_admin' : 'erp_mapped';
  } else if (params.caller.role !== 'Super Admin') {
    const resolved = await resolveErpUserPurchasingAccess({
      erpUserId: params.caller.erpUserId,
      erpUserCode: params.caller.erpUserCode,
      bypassCache: params.bypassCache,
    });
    erpAccessMode = resolved.mode;
    erpPurchasingAccess = resolved.entry?.purchasingAccess ?? null;
    erpRoles = resolved.entry?.roles;
    if (resolved.entry?.erpUserName) {
      resolvedErpUserName = resolved.entry.erpUserName;
    }
    erpAccessWarning = resolved.warning;
  }

  const callerScope: PendingTransactionsSummaryResponse['callerScope'] = {
    role: params.caller.role,
    divisionName: params.caller.divisionName,
    ...(params.caller.erpUserId ? { erpUserId: params.caller.erpUserId } : {}),
    ...(params.caller.erpUserCode ? { erpUserCode: params.caller.erpUserCode } : {}),
    ...(resolvedErpUserName ? { erpUserName: resolvedErpUserName } : {}),
    ...(erpRoles ? { erpRoles } : {}),
    erpAccessMode,
    ...(erpPurchasingAccess ? { erpPurchasingAccess } : {}),
  };

  const allowedRules = filterPendingRulesForUser(PENDING_TRANSACTION_RULES, {
    role: params.caller.role,
    divisionName: params.caller.divisionName,
    erpPurchasingAccess,
    rbacPermissions: params.caller.rbacPermissions,
    isSystemAdmin: params.caller.isSystemAdmin,
  });
  const hasPurchasingAccess = allowedRules.some((r) => r.module === 'purchasing');
  const hasSalesAccess = allowedRules.some((r) => r.module === 'sales');

  if (allowedRules.length === 0) {
    return buildSummaryResponse({
      allowedRules: [],
      rawRules: [],
      sourceMode: isErpMysqlConfigured() ? 'mysql_direct' : 'unavailable',
      callerScope,
      cached: false,
      warning: erpAccessWarning,
    });
  }

  if (!isErpMysqlConfigured()) {
    return buildSummaryResponse({
      allowedRules,
      rawRules: [],
      sourceMode: 'unavailable',
      callerScope,
      cached: false,
      warning: 'Koneksi MySQL ERP belum dikonfigurasi.',
    });
  }

  const ruleKey = allowedRules
    .map((r) => r.id)
    .sort()
    .join(',');

  if (!params.bypassCache) {
    const cached = pendingSummaryCache.get(ruleKey);
    if (cached && Date.now() < cached.expiresAt) {
      const mergedWarning = [cached.warning, erpAccessWarning].filter(Boolean).join(' ') || undefined;
      return buildSummaryResponse({
        allowedRules,
        rawRules: cached.rawRules,
        statusCounts: cached.statusCounts,
        verification: cached.verification,
        sourceMode: cached.sourceMode,
        callerScope,
        cached: true,
        warning: mergedWarning,
      });
    }
  }

  const bridgeCfg = getErpBridgeConfig();
  let sourceMode: PendingTransactionsSummaryResponse['sourceMode'] = 'mysql_direct';
  let rawRules: RawRuleAggregate[] = [];
  let statusCounts: ErpDocumentStatusCounts = {};
  let verification: StatusVerificationReport = {
    checked: false,
    referenceBasis: 'status_column_fallback',
    qtyFormula: '',
    approvalDateColumns: {},
    inconsistencies: [],
  };
  let warning: string | undefined;

  if (bridgeCfg.configured) {
    try {
      const qs = new URLSearchParams();
      qs.set('rules', ruleKey);
      qs.set('warnDays', String(allowedRules[0]?.urgencyThresholds.warningDays ?? 3));
      qs.set('overdueDays', String(allowedRules[0]?.urgencyThresholds.overdueDays ?? 7));
      qs.set('includeCounts', '1');
      qs.set('verify', '1');
      const bridgeRes = await fetchErpBridgeJson<BridgePendingResponse>(
        `/pending-transactions?${qs.toString()}`
      );

      const bridgeVer = Number(bridgeRes.bridgeVersion || 0);
      const hasV9Features = bridgeVer >= 9;
      const hasV8Features =
        bridgeVer >= 8 || Boolean(bridgeRes.statusCounts && bridgeRes.verification);

      if (hasV9Features || hasV8Features) {
        sourceMode = hasV9Features ? 'bridge_v9' : 'bridge_v8';
        rawRules = Array.isArray(bridgeRes.rules) ? [...bridgeRes.rules] : [];
        // Re-enforce module scope on bridge-returned counts/verification server-side
        const rawCounts = bridgeRes.statusCounts || {};
        statusCounts = {
          ...(hasPurchasingAccess
            ? { po: rawCounts.po, grn: rawCounts.grn, pr: rawCounts.pr }
            : {}),
          ...(hasSalesAccess ? { so: rawCounts.so, do: rawCounts.do } : {}),
        };
        const rawVer = bridgeRes.verification;
        verification = rawVer
          ? {
              ...rawVer,
              inconsistencies: (rawVer.inconsistencies || []).filter((item) => {
                if (item.sourceTable.startsWith('m4_')) return hasPurchasingAccess;
                if (item.sourceTable.startsWith('m5_')) return hasSalesAccess;
                return false;
              }),
            }
          : verification;

        // If Bridge v8 is still running and caller has purchasing_ri_pending_vp, supplement from /purchasing
        const riVpRule = allowedRules.find((r) => r.id === 'purchasing_ri_pending_vp');
        if (riVpRule && !rawRules.some((r) => r.ruleId === 'purchasing_ri_pending_vp')) {
          const pData = await queryErpPurchasingData({
            dateFrom: ACTIVE_CUTOFF_DATE,
            limit: 200,
          }).catch(() => null);
          if (pData) {
            const pendingRi = (pData.unpaidInvoices || []).filter(
              (inv) =>
                inv.date >= ACTIVE_CUTOFF_DATE &&
                [2, 3].includes(inv.statusCode) &&
                inv.balanceIdr > QTY_EPSILON
            );
            rawRules.push(
              summarizeDatesForRule(
                riVpRule,
                pendingRi.map((x) => x.date),
                'bridge_v8_supplement (m4_ri Approved/In Progress, sisa hutang > 0)'
              )
            );
          }
        }
        if (bridgeVer < 10) {
          warning = hasV9Features
            ? 'Bridge v9 terdeteksi. Perbarui skrip erp-mysql-bridge.mjs (v10) untuk relasi penuh PR ↔ PO ↔ GRN ↔ RI/PI ↔ VP (idpodetail/idgrndetail) & tampilan Transaksi Terkait.'
            : 'Bridge v8 terdeteksi. Perbarui skrip erp-mysql-bridge.mjs (v10) untuk dukungan hak akses menu ERP (m0_user/m0_role_menu) & relasi penuh Transaksi Terkait Purchasing.';
        }
      } else {
        // Local PC still runs Bridge v7 (old 6-rule schema) -> compute full model via fallback
        sourceMode = 'bridge_v7';
        const fb = await evaluateRulesBridgeFallback(allowedRules, {
          hasPurchasingAccess,
          hasSalesAccess,
        });
        rawRules = fb.rawRules;
        statusCounts = fb.statusCounts;
        verification = fb.verification;
        warning =
          'Bridge v7 terdeteksi. Perbarui skrip erp-mysql-bridge.mjs (v10) untuk verifikasi relasi tabel detail (idpodetail/idgrndetail) & hak akses menu ERP penuh.';
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/404|Endpoint tidak ditemukan|\/pending-transactions/i.test(msg)) {
        sourceMode = 'bridge_v6_fallback';
        const fb = await evaluateRulesBridgeFallback(allowedRules, {
          hasPurchasingAccess,
          hasSalesAccess,
        });
        rawRules = fb.rawRules;
        statusCounts = fb.statusCounts;
        verification = fb.verification;
        warning =
          'Mode kompatibilitas Bridge v6 aktif. Perbarui skrip erp-mysql-bridge.mjs (v10) untuk agregasi SQL, relasi Transaksi Terkait Purchasing & hak akses menu ERP penuh.';
      } else {
        throw err;
      }
    }
  } else {
    sourceMode = 'mysql_direct';
    const evaluated = await evaluateRulesDirectMysql(allowedRules, {
      hasPurchasingAccess,
      hasSalesAccess,
    });
    rawRules = evaluated.rawRules;
    statusCounts = evaluated.statusCounts;
    verification = evaluated.verification;
  }

  if (pendingSummaryCache.size > 30) {
    const oldest = pendingSummaryCache.keys().next().value;
    if (oldest) pendingSummaryCache.delete(oldest);
  }
  pendingSummaryCache.set(ruleKey, {
    expiresAt: Date.now() + PENDING_TX_SERVER_CACHE_TTL_MS,
    sourceMode,
    rawRules,
    statusCounts,
    verification,
    warning,
  });

  const mergedWarning = [warning, erpAccessWarning].filter(Boolean).join(' ') || undefined;

  return buildSummaryResponse({
    allowedRules,
    rawRules,
    statusCounts,
    verification,
    sourceMode,
    callerScope,
    cached: false,
    warning: mergedWarning,
  });
}
