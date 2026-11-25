import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import {
  ACTIVE_ERP_CUTOFF_DATE,
  fetchErpBridgeJson,
  getErpBridgeConfig,
  isIntransitWarehouseName,
  withReadOnlyConnection,
} from './erpMysql.ts';

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

export interface ErpInventoryBiIntransitBreakdown {
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
  month: string; // YYYY-MM
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
  intransit: ErpInventoryBiIntransitBreakdown;
  abcSummary: ErpInventoryBiAbcClassSummary[];
  abcTopItems: ErpInventoryBiSkuRow[];
  criticalStockItems: ErpInventoryBiSkuRow[];
  velocitySummary: ErpInventoryBiVelocityBucket[];
  slowDeadItems: ErpInventoryBiSkuRow[];
  monthly: ErpInventoryBiMonthlyRow[];
  fetchedAt: string;
}

const SAFE_SQL_IDENTIFIER_REGEX = /^[a-zA-Z0-9_]{1,64}$/;
const INVENTORY_BI_CACHE_TTL_MS = 3 * 60 * 1000;
const inventoryBiCache = new Map<string, { expiresAt: number; data: ErpInventoryBiQueryResult }>();

export function invalidateErpInventoryBiCache(): void {
  inventoryBiCache.clear();
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

function daysInMonth(ym: string): number {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return 30;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
}

async function getTableColumns(conn: PoolConnection, tableName: string): Promise<Set<string>> {
  if (!SAFE_SQL_IDENTIFIER_REGEX.test(tableName)) return new Set();
  try {
    const [rows] = await conn.query<RowDataPacket[]>(`SHOW COLUMNS FROM \`${tableName}\``);
    return new Set(
      rows
        .map((r) => String(r.Field || r.field || '').trim().toLowerCase())
        .filter((c) => SAFE_SQL_IDENTIFIER_REGEX.test(c))
    );
  } catch {
    return new Set();
  }
}

function pickColumn(cols: Set<string>, candidates: string[]): string | null {
  for (const c of candidates) {
    const lc = c.toLowerCase();
    if (cols.has(lc) && SAFE_SQL_IDENTIFIER_REGEX.test(lc)) return lc;
  }
  return null;
}

export async function queryErpInventoryBiData(options: {
  dateFrom?: string;
  dateTo?: string;
  bypassCache?: boolean;
}): Promise<ErpInventoryBiQueryResult> {
  const dateFrom = clampActiveDateFrom(options.dateFrom);
  const rawDateTo = (options.dateTo || '').trim();
  const dateTo =
    /^\d{4}-\d{2}-\d{2}$/.test(rawDateTo) && rawDateTo >= dateFrom
      ? rawDateTo
      : new Date().toISOString().slice(0, 10);

  const cacheKey = `${dateFrom}|${dateTo}`;
  if (!options.bypassCache) {
    const cached = inventoryBiCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
  }

  const bridge = getErpBridgeConfig();
  if (bridge.configured) {
    const qs = new URLSearchParams();
    qs.set('dateFrom', dateFrom);
    qs.set('dateTo', dateTo);
    const data = await fetchErpBridgeJson<ErpInventoryBiQueryResult>(
      `/inventory-bi?${qs.toString()}`
    );
    if (inventoryBiCache.size > 24) {
      const oldest = inventoryBiCache.keys().next().value;
      if (oldest) inventoryBiCache.delete(oldest);
    }
    inventoryBiCache.set(cacheKey, {
      expiresAt: Date.now() + INVENTORY_BI_CACHE_TTL_MS,
      data,
    });
    return data;
  }

  const data = await withReadOnlyConnection(async (conn): Promise<ErpInventoryBiQueryResult> => {
    const [tblRows] = await conn.query<RowDataPacket[]>('SHOW TABLES');
    const tblSet = new Set(
      tblRows
        .map((r) => String(Object.values(r)[0] ?? '').trim().toLowerCase())
        .filter(Boolean)
    );

    const hasItem = tblSet.has('m1_item');
    const hasStockWh = tblSet.has('m1_item_stock_warehouse');
    const hasWarehouse = tblSet.has('m1_warehouse');
    const hasCategoryTbl = tblSet.has('m1_item_category') || tblSet.has('m1_category');
    const categoryTblName = tblSet.has('m1_item_category')
      ? 'm1_item_category'
      : tblSet.has('m1_category')
        ? 'm1_category'
        : '';
    const hasDo = tblSet.has('m5_do') && tblSet.has('m5_do_detail');
    const hasSi = tblSet.has('m5_si') && tblSet.has('m5_si_detail');
    const hasGrn = tblSet.has('m4_grn') && tblSet.has('m4_grn_detail');
    const hasRi = tblSet.has('m4_ri') && tblSet.has('m4_ri_detail');
    const hasFinance = tblSet.has('m2_transaction_journal') && tblSet.has('m1_coa');

    const tablesDetected = [
      'm1_item',
      'm1_item_stock_warehouse',
      'm1_warehouse',
      categoryTblName,
      'm4_grn',
      'm4_grn_detail',
      'm4_ri',
      'm4_ri_detail',
      'm5_do',
      'm5_do_detail',
      'm5_si',
      'm5_si_detail',
      'm2_transaction_journal',
    ].filter((t) => Boolean(t) && tblSet.has(t));

    if (!hasItem || !hasStockWh) {
      throw new Error(
        'Tabel master barang (m1_item) atau stok gudang (m1_item_stock_warehouse) tidak ditemukan pada database ERP.'
      );
    }

    const [itemCols, stockCols, whCols, catCols] = await Promise.all([
      getTableColumns(conn, 'm1_item'),
      getTableColumns(conn, 'm1_item_stock_warehouse'),
      hasWarehouse ? getTableColumns(conn, 'm1_warehouse') : Promise.resolve(new Set<string>()),
      categoryTblName ? getTableColumns(conn, categoryTblName) : Promise.resolve(new Set<string>()),
    ]);

    const itemIdCol = pickColumn(itemCols, ['bid', 'idbarang', 'id']) || 'bid';
    const itemCodeCol = pickColumn(itemCols, ['bkode', 'kode', 'kodebarang']) || 'bkode';
    const itemNameCol = pickColumn(itemCols, ['bnama', 'nama', 'namabarang']) || 'bnama';
    const itemUnitCol = pickColumn(itemCols, ['bsatuan', 'bsatuankecil', 'satuan']);
    const itemActiveCol = pickColumn(itemCols, ['baktif', 'aktif']);
    const itemJenisCol = pickColumn(itemCols, ['bjenis']);
    const itemCatCol = pickColumn(itemCols, ['bkategori', 'idkategori', 'kategoribarang', 'bgolongan']);
    const itemCostCol = pickColumn(itemCols, [
      'bhargapokok',
      'bhpp',
      'bhargabeli',
      'bmodal',
      'bhargastandar',
      'bhargabeliterakhir',
      'bharga',
    ]);
    const itemMinStockCol = pickColumn(itemCols, [
      'bminstok',
      'bminstock',
      'bstokmin',
      'minstok',
      'breorder',
      'bminimumstok',
    ]);
    const itemMaxStockCol = pickColumn(itemCols, [
      'bmaxstok',
      'bmaxstock',
      'bstokmax',
      'maxstok',
      'bmaksimumstok',
    ]);

    const stockItemFk = pickColumn(stockCols, ['idbarang', 'bid', 'iditem']) || 'idbarang';
    const stockWhCol = pickColumn(stockCols, ['kgudang', 'gudang', 'wgudang', 'kodegudang']) || 'kgudang';
    const stockQtyCol = pickColumn(stockCols, ['stok', 'qty', 'jumlah', 'saldo']) || 'stok';

    // Build warehouse master lookup (name + virtual/intransit flag)
    const whNameByCode = new Map<string, string>();
    const virtualWhKeys = new Set<string>();
    if (hasWarehouse) {
      const wCodeCol = pickColumn(whCols, ['wkode', 'kode', 'id']) || 'wkode';
      const wNameCol = pickColumn(whCols, ['wnama', 'nama']) || wCodeCol;
      const wVirtualCol = pickColumn(whCols, ['wisintransit', 'is_intransit', 'wisvirtual', 'wnonfisik']);
      const wPhysicalCol = pickColumn(whCols, ['wisfisik', 'is_physical']);
      try {
        const [wRows] = await conn.query<RowDataPacket[]>(
          `SELECT \`${wCodeCol}\` AS wkode, \`${wNameCol}\` AS wnama` +
            (wVirtualCol ? `, COALESCE(\`${wVirtualCol}\`, 0) AS wvirtual` : ', 0 AS wvirtual') +
            (wPhysicalCol ? `, COALESCE(\`${wPhysicalCol}\`, 1) AS wfisik` : ', 1 AS wfisik') +
            ' FROM `m1_warehouse`'
        );
        for (const r of wRows) {
          const code = String(r.wkode || '').trim();
          const name = String(r.wnama || code || '').trim();
          if (code) whNameByCode.set(code.toLowerCase(), name || code);
          if (name) whNameByCode.set(name.toLowerCase(), name);
          const isVirt =
            Number(r.wvirtual || 0) === 1 ||
            Number(r.wfisik ?? 1) === 0 ||
            isIntransitWarehouseName(code) ||
            isIntransitWarehouseName(name);
          if (isVirt) {
            if (code) virtualWhKeys.add(code.toLowerCase());
            if (name) virtualWhKeys.add(name.toLowerCase());
          }
        }
      } catch {
        // Non-fatal
      }
    }

    // Build category master lookup if category table exists
    const catNameById = new Map<string, string>();
    if (categoryTblName && catCols.size > 0) {
      const cIdCol = pickColumn(catCols, ['kid', 'idkategori', 'id', 'kkode']);
      const cNameCol = pickColumn(catCols, ['knama', 'nama', 'namakategori', 'kategori']);
      if (cIdCol && cNameCol) {
        try {
          const [cRows] = await conn.query<RowDataPacket[]>(
            `SELECT \`${cIdCol}\` AS cid, \`${cNameCol}\` AS cname FROM \`${categoryTblName}\``
          );
          for (const r of cRows) {
            const k = String(r.cid ?? '').trim();
            const v = String(r.cname ?? '').trim();
            if (k && v) catNameById.set(k, v);
          }
        } catch {
          // Non-fatal
        }
      }
    }

    // Last purchase unit price per item from m4_ri_detail (for accurate cost fallback when m1_item cost is 0)
    const lastRiCostByItem = new Map<number, number>();
    if (hasRi) {
      const [riCols, riDetCols] = await Promise.all([
        getTableColumns(conn, 'm4_ri'),
        getTableColumns(conn, 'm4_ri_detail'),
      ]);
      const riDetFk = pickColumn(riDetCols, ['idri', 'riid']);
      const riItemCol = pickColumn(riDetCols, ['idbarang', 'bid']);
      const riPriceCol = pickColumn(riDetCols, ['harga', 'dharga']);
      const riKursExpr = riCols.has('rikurs') ? 'COALESCE(NULLIF(ri.rikurs, 0), 1)' : '1';
      if (riCols.has('riid') && riCols.has('ritgl') && riDetFk && riItemCol && riPriceCol) {
        try {
          const [lpRows] = await conn.query<RowDataPacket[]>(
            `SELECT d.\`${riItemCol}\` AS itemId,
              SUBSTRING_INDEX(
                GROUP_CONCAT(ROUND(COALESCE(d.\`${riPriceCol}\`, 0) * ${riKursExpr}, 4) ORDER BY ri.ritgl DESC, ri.riid DESC),
                ',', 1
              ) AS lastPrice
             FROM m4_ri_detail d
             INNER JOIN m4_ri ri ON ri.riid = d.\`${riDetFk}\`
             WHERE COALESCE(ri.ristatus, 0) NOT IN (6, 12)
               AND COALESCE(d.\`${riPriceCol}\`, 0) > 0
             GROUP BY d.\`${riItemCol}\``
          );
          for (const r of lpRows) {
            const id = Number(r.itemId || 0);
            const price = Number(r.lastPrice || 0);
            if (id > 0 && price > 0) lastRiCostByItem.set(id, price);
          }
        } catch {
          // Non-fatal
        }
      }
    }

    // Query active physical product master + stock by warehouse
    const itemConds: string[] = [];
    if (itemActiveCol) itemConds.push(`COALESCE(i.\`${itemActiveCol}\`, 1) = 1`);
    if (itemJenisCol) itemConds.push(`UPPER(TRIM(COALESCE(i.\`${itemJenisCol}\`, ''))) = 'P'`);
    const itemWhereSql = itemConds.length > 0 ? `WHERE ${itemConds.join(' AND ')}` : '';

    const [stockRows] = await conn.query<RowDataPacket[]>(
      `SELECT
        i.\`${itemIdCol}\` AS itemId,
        COALESCE(NULLIF(TRIM(i.\`${itemCodeCol}\`), ''), CAST(i.\`${itemIdCol}\` AS CHAR)) AS code,
        COALESCE(NULLIF(TRIM(i.\`${itemNameCol}\`), ''), CONCAT('Item #', i.\`${itemIdCol}\`)) AS name,
        ${itemUnitCol ? `COALESCE(NULLIF(TRIM(i.\`${itemUnitCol}\`), ''), 'Pcs')` : "'Pcs'"} AS unit,
        ${itemCatCol ? `COALESCE(NULLIF(TRIM(CAST(i.\`${itemCatCol}\` AS CHAR)), ''), 'Tanpa Kategori')` : "'Tanpa Kategori'"} AS rawCat,
        ${itemCostCol ? `COALESCE(i.\`${itemCostCol}\`, 0)` : '0'} AS itemCost,
        ${itemMinStockCol ? `i.\`${itemMinStockCol}\`` : 'NULL'} AS minStock,
        ${itemMaxStockCol ? `i.\`${itemMaxStockCol}\`` : 'NULL'} AS maxStock,
        COALESCE(NULLIF(TRIM(s.\`${stockWhCol}\`), ''), 'Gudang Utama') AS warehouseRaw,
        COALESCE(s.\`${stockQtyCol}\`, 0) AS qty
       FROM m1_item_stock_warehouse s
       INNER JOIN m1_item i ON i.\`${itemIdCol}\` = s.\`${stockItemFk}\`
       ${itemWhereSql}`
    );

    let usedItemCostCount = 0;
    let usedRiCostCount = 0;

    // Separate Physical vs Intransit strictly!
    const physicalWhMap = new Map<
      string,
      {
        warehouseCode: string;
        warehouseName: string;
        skuCount: number;
        inStockSkuCount: number;
        zeroStockCount: number;
        lowStockCount: number;
        totalQty: number;
        stockValueIdr: number;
      }
    >();

    const intransitWhMap = new Map<
      string,
      { warehouse: string; skuCount: number; totalQty: number; estimatedValueIdr: number }
    >();
    const intransitItemsList: ErpInventoryBiIntransitItem[] = [];

    const skuAggMap = new Map<
      number,
      {
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
      }
    >();

    for (const r of stockRows) {
      const itemId = Number(r.itemId || 0);
      if (!itemId) continue;
      const code = String(r.code || '-');
      const name = String(r.name || '-');
      const unit = String(r.unit || 'Pcs');
      const rawCat = String(r.rawCat || 'Tanpa Kategori').trim();
      const category = catNameById.get(rawCat) || rawCat || 'Tanpa Kategori';
      const whRaw = String(r.warehouseRaw || 'Gudang Utama').trim();
      const whNorm = whRaw.toLowerCase();
      const whDisplay = whNameByCode.get(whNorm) || whRaw;
      const qty = Number(r.qty || 0);
      const minStock = r.minStock !== null && r.minStock !== undefined && Number(r.minStock) > 0
        ? Number(r.minStock)
        : null;
      const maxStock = r.maxStock !== null && r.maxStock !== undefined && Number(r.maxStock) > 0
        ? Number(r.maxStock)
        : null;

      let unitCost = Number(r.itemCost || 0);
      if (unitCost > 0) {
        usedItemCostCount += 1;
      } else {
        const riPrice = lastRiCostByItem.get(itemId) || 0;
        if (riPrice > 0) {
          unitCost = riPrice;
          usedRiCostCount += 1;
        }
      }
      const lineValue = Math.max(0, qty) * unitCost;

      const isIntransit =
        virtualWhKeys.has(whNorm) ||
        isIntransitWarehouseName(whRaw) ||
        isIntransitWarehouseName(whDisplay);

      if (isIntransit) {
        const itWh = intransitWhMap.get(whDisplay) || {
          warehouse: whDisplay,
          skuCount: 0,
          totalQty: 0,
          estimatedValueIdr: 0,
        };
        itWh.skuCount += 1;
        itWh.totalQty += qty;
        itWh.estimatedValueIdr += lineValue;
        intransitWhMap.set(whDisplay, itWh);
        if (qty > 0) {
          intransitItemsList.push({
            itemId,
            code,
            name,
            warehouse: whDisplay,
            unit,
            qty,
            unitCost,
            estimatedValueIdr: lineValue,
          });
        }
        // NEVER add Intransit to physical warehouse totals or physical SKU qty!
        continue;
      }

      const whAgg = physicalWhMap.get(whDisplay) || {
        warehouseCode: whRaw,
        warehouseName: whDisplay,
        skuCount: 0,
        inStockSkuCount: 0,
        zeroStockCount: 0,
        lowStockCount: 0,
        totalQty: 0,
        stockValueIdr: 0,
      };
      whAgg.skuCount += 1;
      whAgg.totalQty += qty;
      whAgg.stockValueIdr += lineValue;
      if (qty <= 0) {
        whAgg.zeroStockCount += 1;
      } else {
        whAgg.inStockSkuCount += 1;
        if (minStock !== null && qty <= minStock) {
          whAgg.lowStockCount += 1;
        }
      }
      physicalWhMap.set(whDisplay, whAgg);

      const curSku = skuAggMap.get(itemId);
      if (!curSku) {
        skuAggMap.set(itemId, {
          itemId,
          code,
          name,
          category,
          unit,
          physicalQty: qty,
          minStock,
          maxStock,
          unitCost,
          stockValueIdr: lineValue,
        });
      } else {
        curSku.physicalQty += qty;
        curSku.stockValueIdr = Math.max(0, curSku.physicalQty) * curSku.unitCost;
      }
    }

    const costSource: ErpInventoryBiQueryResult['diagnostics']['costSource'] =
      usedItemCostCount > 0 && usedRiCostCount > 0
        ? 'mixed_item_and_ri'
        : usedItemCostCount > 0
          ? 'm1_item_hpp'
          : usedRiCostCount > 0
            ? 'm4_ri_last_price'
            : 'unavailable';

    // Monthly movement map
    const monthlyMap = new Map<string, ErpInventoryBiMonthlyRow>();
    const ensureMonth = (ym: string): ErpInventoryBiMonthlyRow | null => {
      if (!/^\d{4}-\d{2}$/.test(ym)) return null;
      let row = monthlyMap.get(ym);
      if (!row) {
        row = {
          month: ym,
          grnInQty: 0,
          grnInValue: 0,
          doOutQty: 0,
          siOutQty: 0,
          siOutValue: 0,
          netQtyMovement: 0,
          glCogs: 0,
          glInventoryEnding: 0,
          itrAnnualized: null,
          dioDays: null,
        };
        monthlyMap.set(ym, row);
      }
      return row;
    };
    for (const ym of listMonthsBetween(dateFrom.slice(0, 7), dateTo.slice(0, 7))) {
      ensureMonth(ym);
    }

    // Inflow per item & per month (m4_grn_detail preferred, fallback m4_ri_detail)
    const inflowByItem = new Map<number, number>();
    let inflowSource: ErpInventoryBiQueryResult['diagnostics']['inflowSource'] = 'unavailable';

    if (hasGrn) {
      const [grnCols, grnDetCols] = await Promise.all([
        getTableColumns(conn, 'm4_grn'),
        getTableColumns(conn, 'm4_grn_detail'),
      ]);
      const fk = pickColumn(grnDetCols, ['idgrn', 'grnid']);
      const qtyCol = pickColumn(grnDetCols, ['jml', 'qty', 'jumlah']);
      const priceCol = pickColumn(grnDetCols, ['harga', 'dharga']);
      const itemFk = pickColumn(grnDetCols, ['idbarang', 'bid']);
      const kursExpr = grnCols.has('grnkurs') ? 'COALESCE(NULLIF(grn.grnkurs, 0), 1)' : '1';
      if (grnCols.has('grnid') && grnCols.has('grntgl') && fk && qtyCol && itemFk) {
        try {
          const valExpr = priceCol
            ? `COALESCE(d.\`${qtyCol}\`, 0) * COALESCE(d.\`${priceCol}\`, 0) * ${kursExpr}`
            : '0';
          const [inMonRows] = await conn.query<RowDataPacket[]>(
            `SELECT DATE_FORMAT(grn.grntgl, '%Y-%m') AS month,
              COALESCE(SUM(COALESCE(d.\`${qtyCol}\`, 0)), 0) AS qty,
              COALESCE(SUM(${valExpr}), 0) AS val
             FROM m4_grn_detail d
             INNER JOIN m4_grn grn ON grn.grnid = d.\`${fk}\`
             WHERE COALESCE(grn.grnstatus, 0) NOT IN (6, 12)
               AND grn.grntgl >= ? AND grn.grntgl <= ?
             GROUP BY DATE_FORMAT(grn.grntgl, '%Y-%m')`,
            [dateFrom, dateTo]
          );
          for (const r of inMonRows) {
            const mRow = ensureMonth(String(r.month || ''));
            if (mRow) {
              mRow.grnInQty = Number(r.qty || 0);
              mRow.grnInValue = Number(r.val || 0);
            }
          }

          const [inItemRows] = await conn.query<RowDataPacket[]>(
            `SELECT d.\`${itemFk}\` AS itemId,
              COALESCE(SUM(COALESCE(d.\`${qtyCol}\`, 0)), 0) AS qty
             FROM m4_grn_detail d
             INNER JOIN m4_grn grn ON grn.grnid = d.\`${fk}\`
             WHERE COALESCE(grn.grnstatus, 0) NOT IN (6, 12)
               AND grn.grntgl >= ? AND grn.grntgl <= ?
             GROUP BY d.\`${itemFk}\``,
            [dateFrom, dateTo]
          );
          for (const r of inItemRows) {
            inflowByItem.set(Number(r.itemId || 0), Number(r.qty || 0));
          }
          inflowSource = 'm4_grn_detail';
        } catch {
          // Fallback to RI below
        }
      }
    }

    if (inflowSource === 'unavailable' && hasRi) {
      const [riCols, riDetCols] = await Promise.all([
        getTableColumns(conn, 'm4_ri'),
        getTableColumns(conn, 'm4_ri_detail'),
      ]);
      const fk = pickColumn(riDetCols, ['idri', 'riid']);
      const qtyCol = pickColumn(riDetCols, ['jml', 'qty', 'jumlah']);
      const priceCol = pickColumn(riDetCols, ['harga', 'dharga']);
      const itemFk = pickColumn(riDetCols, ['idbarang', 'bid']);
      const kursExpr = riCols.has('rikurs') ? 'COALESCE(NULLIF(ri.rikurs, 0), 1)' : '1';
      if (riCols.has('riid') && riCols.has('ritgl') && fk && qtyCol && itemFk) {
        try {
          const valExpr = priceCol
            ? `COALESCE(d.\`${qtyCol}\`, 0) * COALESCE(d.\`${priceCol}\`, 0) * ${kursExpr}`
            : '0';
          const [inMonRows] = await conn.query<RowDataPacket[]>(
            `SELECT DATE_FORMAT(ri.ritgl, '%Y-%m') AS month,
              COALESCE(SUM(COALESCE(d.\`${qtyCol}\`, 0)), 0) AS qty,
              COALESCE(SUM(${valExpr}), 0) AS val
             FROM m4_ri_detail d
             INNER JOIN m4_ri ri ON ri.riid = d.\`${fk}\`
             WHERE COALESCE(ri.ristatus, 0) NOT IN (6, 12)
               AND ri.ritgl >= ? AND ri.ritgl <= ?
             GROUP BY DATE_FORMAT(ri.ritgl, '%Y-%m')`,
            [dateFrom, dateTo]
          );
          for (const r of inMonRows) {
            const mRow = ensureMonth(String(r.month || ''));
            if (mRow) {
              mRow.grnInQty = Number(r.qty || 0);
              mRow.grnInValue = Number(r.val || 0);
            }
          }
          const [inItemRows] = await conn.query<RowDataPacket[]>(
            `SELECT d.\`${itemFk}\` AS itemId,
              COALESCE(SUM(COALESCE(d.\`${qtyCol}\`, 0)), 0) AS qty
             FROM m4_ri_detail d
             INNER JOIN m4_ri ri ON ri.riid = d.\`${fk}\`
             WHERE COALESCE(ri.ristatus, 0) NOT IN (6, 12)
               AND ri.ritgl >= ? AND ri.ritgl <= ?
             GROUP BY d.\`${itemFk}\``,
            [dateFrom, dateTo]
          );
          for (const r of inItemRows) {
            inflowByItem.set(Number(r.itemId || 0), Number(r.qty || 0));
          }
          inflowSource = 'm4_ri_detail';
        } catch {
          // Non-fatal
        }
      }
    }

    // Outflow per item & per month (m5_do_detail for physical outflow + m5_si_detail for invoiced sales)
    const outflowByItem = new Map<number, { qty: number; freq: number; lastDate: string }>();
    let outflowSource: ErpInventoryBiQueryResult['diagnostics']['outflowSource'] = 'unavailable';

    if (hasDo) {
      const [doCols, doDetCols] = await Promise.all([
        getTableColumns(conn, 'm5_do'),
        getTableColumns(conn, 'm5_do_detail'),
      ]);
      const fk = pickColumn(doDetCols, ['iddo', 'doid']);
      const qtyCol = pickColumn(doDetCols, ['jml', 'qty', 'jumlah']);
      const itemFk = pickColumn(doDetCols, ['idbarang', 'bid']);
      const dateCol = pickColumn(doCols, ['dotgl', 'dotglkirim']);
      if (doCols.has('doid') && dateCol && fk && qtyCol && itemFk) {
        try {
          const [doMonRows] = await conn.query<RowDataPacket[]>(
            `SELECT DATE_FORMAT(do_h.\`${dateCol}\`, '%Y-%m') AS month,
              COALESCE(SUM(COALESCE(d.\`${qtyCol}\`, 0)), 0) AS qty
             FROM m5_do_detail d
             INNER JOIN m5_do do_h ON do_h.doid = d.\`${fk}\`
             WHERE COALESCE(do_h.dostatus, 0) NOT IN (6, 12)
               AND do_h.\`${dateCol}\` >= ? AND do_h.\`${dateCol}\` <= ?
             GROUP BY DATE_FORMAT(do_h.\`${dateCol}\`, '%Y-%m')`,
            [dateFrom, dateTo]
          );
          for (const r of doMonRows) {
            const mRow = ensureMonth(String(r.month || ''));
            if (mRow) mRow.doOutQty = Number(r.qty || 0);
          }

          const [doItemRows] = await conn.query<RowDataPacket[]>(
            `SELECT d.\`${itemFk}\` AS itemId,
              COALESCE(SUM(COALESCE(d.\`${qtyCol}\`, 0)), 0) AS qty,
              COUNT(DISTINCT do_h.doid) AS freq,
              MAX(do_h.\`${dateCol}\`) AS lastDate
             FROM m5_do_detail d
             INNER JOIN m5_do do_h ON do_h.doid = d.\`${fk}\`
             WHERE COALESCE(do_h.dostatus, 0) NOT IN (6, 12)
               AND do_h.\`${dateCol}\` >= ? AND do_h.\`${dateCol}\` <= ?
             GROUP BY d.\`${itemFk}\``,
            [dateFrom, dateTo]
          );
          for (const r of doItemRows) {
            outflowByItem.set(Number(r.itemId || 0), {
              qty: Number(r.qty || 0),
              freq: Number(r.freq || 0),
              lastDate: formatDateIso(r.lastDate),
            });
          }
          outflowSource = 'm5_do_detail';
        } catch {
          // Fallback to SI
        }
      }
    }

    if (hasSi) {
      const [siCols, siDetCols] = await Promise.all([
        getTableColumns(conn, 'm5_si'),
        getTableColumns(conn, 'm5_si_detail'),
      ]);
      const fk = pickColumn(siDetCols, ['idsi', 'siid']);
      const qtyCol = pickColumn(siDetCols, ['jml', 'qty', 'jumlah']);
      const priceCol = pickColumn(siDetCols, ['harga', 'dharga']);
      const itemFk = pickColumn(siDetCols, ['idbarang', 'bid']);
      const kursExpr = siCols.has('sikurs') ? 'COALESCE(NULLIF(si.sikurs, 0), 1)' : '1';
      if (siCols.has('siid') && siCols.has('sitgl') && fk && qtyCol && itemFk) {
        try {
          const valExpr = priceCol
            ? `COALESCE(d.\`${qtyCol}\`, 0) * COALESCE(d.\`${priceCol}\`, 0) * ${kursExpr}`
            : '0';
          const [siMonRows] = await conn.query<RowDataPacket[]>(
            `SELECT DATE_FORMAT(si.sitgl, '%Y-%m') AS month,
              COALESCE(SUM(COALESCE(d.\`${qtyCol}\`, 0)), 0) AS qty,
              COALESCE(SUM(${valExpr}), 0) AS val
             FROM m5_si_detail d
             INNER JOIN m5_si si ON si.siid = d.\`${fk}\`
             WHERE COALESCE(si.sistatus, 0) NOT IN (6, 12)
               AND si.sitgl >= ? AND si.sitgl <= ?
             GROUP BY DATE_FORMAT(si.sitgl, '%Y-%m')`,
            [dateFrom, dateTo]
          );
          for (const r of siMonRows) {
            const mRow = ensureMonth(String(r.month || ''));
            if (mRow) {
              mRow.siOutQty = Number(r.qty || 0);
              mRow.siOutValue = Number(r.val || 0);
            }
          }

          if (outflowSource === 'unavailable') {
            const [siItemRows] = await conn.query<RowDataPacket[]>(
              `SELECT d.\`${itemFk}\` AS itemId,
                COALESCE(SUM(COALESCE(d.\`${qtyCol}\`, 0)), 0) AS qty,
                COUNT(DISTINCT si.siid) AS freq,
                MAX(si.sitgl) AS lastDate
               FROM m5_si_detail d
               INNER JOIN m5_si si ON si.siid = d.\`${fk}\`
               WHERE COALESCE(si.sistatus, 0) NOT IN (6, 12)
                 AND si.sitgl >= ? AND si.sitgl <= ?
               GROUP BY d.\`${itemFk}\``,
              [dateFrom, dateTo]
            );
            for (const r of siItemRows) {
              outflowByItem.set(Number(r.itemId || 0), {
                qty: Number(r.qty || 0),
                freq: Number(r.freq || 0),
                lastDate: formatDateIso(r.lastDate),
              });
            }
            outflowSource = 'm5_si_detail';
          }
        } catch {
          // Non-fatal
        }
      }
    }

    // GL Inventory ending balances & monthly COGS (for accurate ITR & DIO)
    let glInventoryBalanceIdr = 0;
    if (hasFinance) {
      try {
        const [invOpenRows] = await conn.query<RowDataPacket[]>(
          `SELECT COALESCE(SUM(j.tdebit - j.tkredit), 0) AS openingInv
           FROM m2_transaction_journal j
           INNER JOIN m1_coa c ON c.cnomor = j.tnorek
           WHERE COALESCE(j.tstatus, 0) NOT IN (6, 12)
             AND COALESCE(j.tposting, 1) = 1
             AND c.cgd = 'D'
             AND c.ctipe = 3
             AND j.ttgl < ?`,
          [dateFrom]
        );
        let runningInv = Number(invOpenRows[0]?.openingInv || 0);

        const [glMonRows] = await conn.query<RowDataPacket[]>(
          `SELECT DATE_FORMAT(j.ttgl, '%Y-%m') AS month,
            COALESCE(SUM(CASE WHEN c.ctipe = 3 THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS invDelta,
            COALESCE(SUM(CASE WHEN c.ctipe = 12 THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS cogsAmt
           FROM m2_transaction_journal j
           INNER JOIN m1_coa c ON c.cnomor = j.tnorek
           WHERE COALESCE(j.tstatus, 0) NOT IN (6, 12)
             AND COALESCE(j.tposting, 1) = 1
             AND c.cgd = 'D'
             AND c.ctipe IN (3, 12)
             AND j.ttgl >= ? AND j.ttgl <= ?
           GROUP BY DATE_FORMAT(j.ttgl, '%Y-%m')
           ORDER BY month ASC`,
          [dateFrom, dateTo]
        );
        const deltaByMonth = new Map<string, { invDelta: number; cogsAmt: number }>();
        for (const r of glMonRows) {
          deltaByMonth.set(String(r.month || ''), {
            invDelta: Number(r.invDelta || 0),
            cogsAmt: Number(r.cogsAmt || 0),
          });
        }

        const sortedMonths = Array.from(monthlyMap.keys()).sort();
        for (const ym of sortedMonths) {
          const mRow = monthlyMap.get(ym)!;
          const d = deltaByMonth.get(ym);
          runningInv += d?.invDelta || 0;
          mRow.glInventoryEnding = runningInv;
          mRow.glCogs = d?.cogsAmt || 0;
          const calDays = daysInMonth(ym);
          if (runningInv > 0 && mRow.glCogs > 0) {
            mRow.itrAnnualized = (mRow.glCogs / runningInv) * 12;
            mRow.dioDays = (runningInv / mRow.glCogs) * calDays;
          }
        }
        glInventoryBalanceIdr = runningInv;
      } catch {
        // Non-fatal
      }
    }

    // Compute SKU-level ABC, Health, and Velocity classifications (Physical SKUs ONLY!)
    const allPhysicalSkus = Array.from(skuAggMap.values());
    const totalPhysicalValueIdr = allPhysicalSkus.reduce((s, x) => s + x.stockValueIdr, 0);
    const totalPhysicalQty = allPhysicalSkus.reduce((s, x) => s + x.physicalQty, 0);

    // Sort descending by stock value for Pareto ABC calculation
    const sortedByVal = [...allPhysicalSkus].sort((a, b) => b.stockValueIdr - a.stockValueIdr);
    const periodEndMs = Date.parse(`${dateTo}T00:00:00Z`) || Date.now();
    const periodDays = Math.max(
      1,
      Math.round((periodEndMs - (Date.parse(`${dateFrom}T00:00:00Z`) || periodEndMs)) / 86400000) + 1
    );

    let runningVal = 0;
    const enrichedSkus: ErpInventoryBiSkuRow[] = sortedByVal.map((sku) => {
      runningVal += sku.stockValueIdr;
      const cumulativeValuePct =
        totalPhysicalValueIdr > 0 ? (runningVal / totalPhysicalValueIdr) * 100 : 0;
      let abcClass: ErpInventoryBiSkuRow['abcClass'] = 'N/A';
      if (sku.stockValueIdr > 0 && totalPhysicalValueIdr > 0) {
        if (cumulativeValuePct <= 80.0001) abcClass = 'A';
        else if (cumulativeValuePct <= 95.0001) abcClass = 'B';
        else abcClass = 'C';
      }

      const out = outflowByItem.get(sku.itemId) || { qty: 0, freq: 0, lastDate: '' };
      const inflowQty = inflowByItem.get(sku.itemId) || 0;
      const daysSinceLastOut = out.lastDate
        ? Math.max(0, Math.round((periodEndMs - Date.parse(`${out.lastDate}T00:00:00Z`)) / 86400000))
        : null;

      // Health status: Out-of-Stock / Low-Stock (<= minStock or < 14 days demand coverage) / Overstock / Healthy
      const dailyDemand = out.qty > 0 ? out.qty / periodDays : 0;
      let healthStatus: ErpInventoryBiSkuRow['healthStatus'] = 'healthy';
      if (sku.physicalQty <= 0) {
        healthStatus = 'out_of_stock';
      } else if (
        (sku.minStock !== null && sku.physicalQty <= sku.minStock) ||
        (sku.minStock === null && dailyDemand > 0 && sku.physicalQty / dailyDemand <= 14)
      ) {
        healthStatus = 'low_stock';
      } else if (sku.maxStock !== null && sku.physicalQty > sku.maxStock) {
        healthStatus = 'overstock';
      }

      // Velocity classification based on actual outflow frequency & turnover relative to stock
      let velocityClass: ErpInventoryBiSkuRow['velocityClass'] = 'dead';
      if (out.qty <= 0) {
        velocityClass = 'dead';
      } else if (out.freq >= 5 || (sku.physicalQty > 0 && out.qty >= sku.physicalQty * 0.5)) {
        velocityClass = 'fast';
      } else if (out.freq >= 2 || (sku.physicalQty > 0 && out.qty >= sku.physicalQty * 0.15)) {
        velocityClass = 'medium';
      } else {
        velocityClass = 'slow';
      }

      return {
        ...sku,
        cumulativeValuePct,
        abcClass,
        healthStatus,
        velocityClass,
        inflowQty,
        outflowQty: out.qty,
        outflowFreq: out.freq,
        lastOutDate: out.lastDate,
        daysSinceLastOut,
      };
    });

    // Category aggregation
    const catAggMap = new Map<
      string,
      { category: string; skuCount: number; zeroStockCount: number; lowStockCount: number; totalQty: number; stockValueIdr: number }
    >();
    for (const s of enrichedSkus) {
      const c = catAggMap.get(s.category) || {
        category: s.category,
        skuCount: 0,
        zeroStockCount: 0,
        lowStockCount: 0,
        totalQty: 0,
        stockValueIdr: 0,
      };
      c.skuCount += 1;
      c.totalQty += s.physicalQty;
      c.stockValueIdr += s.stockValueIdr;
      if (s.healthStatus === 'out_of_stock') c.zeroStockCount += 1;
      if (s.healthStatus === 'low_stock') c.lowStockCount += 1;
      catAggMap.set(s.category, c);
    }

    const warehouses: ErpInventoryBiWarehouseRow[] = Array.from(physicalWhMap.values())
      .sort((a, b) => b.stockValueIdr - a.stockValueIdr || b.totalQty - a.totalQty)
      .map((w) => ({
        ...w,
        valueSharePct: totalPhysicalValueIdr > 0 ? (w.stockValueIdr / totalPhysicalValueIdr) * 100 : 0,
      }));

    const categories: ErpInventoryBiCategoryRow[] = Array.from(catAggMap.values())
      .sort((a, b) => b.stockValueIdr - a.stockValueIdr || b.skuCount - a.skuCount)
      .slice(0, 30)
      .map((c) => ({
        ...c,
        valueSharePct: totalPhysicalValueIdr > 0 ? (c.stockValueIdr / totalPhysicalValueIdr) * 100 : 0,
      }));

    // ABC summary
    const valuedSkuCount = enrichedSkus.filter((s) => s.abcClass !== 'N/A').length;
    const abcSummary: ErpInventoryBiAbcClassSummary[] = (['A', 'B', 'C'] as const).map((cls) => {
      const members = enrichedSkus.filter((s) => s.abcClass === cls);
      const val = members.reduce((acc, x) => acc + x.stockValueIdr, 0);
      return {
        abcClass: cls,
        skuCount: members.length,
        skuSharePct: valuedSkuCount > 0 ? (members.length / valuedSkuCount) * 100 : 0,
        totalQty: members.reduce((acc, x) => acc + x.physicalQty, 0),
        stockValueIdr: val,
        valueSharePct: totalPhysicalValueIdr > 0 ? (val / totalPhysicalValueIdr) * 100 : 0,
      };
    });

    // Velocity summary (focus on physical SKUs with positive stock or movement)
    const velocityDefs: Array<{ key: ErpInventoryBiVelocityBucket['velocityClass']; label: string }> = [
      { key: 'fast', label: 'Fast-Moving' },
      { key: 'medium', label: 'Medium-Moving' },
      { key: 'slow', label: 'Slow-Moving' },
      { key: 'dead', label: 'Dead Stock (Tanpa Keluar)' },
    ];
    const velocitySummary: ErpInventoryBiVelocityBucket[] = velocityDefs.map((def) => {
      const members = enrichedSkus.filter((s) => s.velocityClass === def.key && s.physicalQty > 0);
      const val = members.reduce((acc, x) => acc + x.stockValueIdr, 0);
      return {
        velocityClass: def.key,
        label: def.label,
        skuCount: members.length,
        totalQty: members.reduce((acc, x) => acc + x.physicalQty, 0),
        stockValueIdr: val,
        valueSharePct: totalPhysicalValueIdr > 0 ? (val / totalPhysicalValueIdr) * 100 : 0,
      };
    });

    const outOfStockSkus = enrichedSkus.filter((s) => s.healthStatus === 'out_of_stock').length;
    const lowStockSkus = enrichedSkus.filter((s) => s.healthStatus === 'low_stock').length;
    const overStockSkus = enrichedSkus.filter((s) => s.healthStatus === 'overstock').length;
    const inStockSkus = enrichedSkus.length - outOfStockSkus;

    const criticalStockItems = enrichedSkus
      .filter((s) => s.healthStatus === 'out_of_stock' || s.healthStatus === 'low_stock')
      .sort((a, b) => b.outflowQty - a.outflowQty || a.physicalQty - b.physicalQty)
      .slice(0, 100);

    const slowDeadItems = enrichedSkus
      .filter((s) => (s.velocityClass === 'dead' || s.velocityClass === 'slow') && s.physicalQty > 0)
      .sort((a, b) => b.stockValueIdr - a.stockValueIdr || b.physicalQty - a.physicalQty)
      .slice(0, 100);

    const monthly = Array.from(monthlyMap.values())
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((m) => {
        const effectiveOut = m.doOutQty > 0 ? m.doOutQty : m.siOutQty;
        return {
          ...m,
          netQtyMovement: m.grnInQty - effectiveOut,
        };
      });

    const intransitWhArr = Array.from(intransitWhMap.values()).sort(
      (a, b) => b.estimatedValueIdr - a.estimatedValueIdr || b.totalQty - a.totalQty
    );
    const intransit: ErpInventoryBiIntransitBreakdown = {
      skuCount: intransitWhArr.reduce((s, w) => s + w.skuCount, 0),
      totalQty: intransitWhArr.reduce((s, w) => s + w.totalQty, 0),
      estimatedValueIdr: intransitWhArr.reduce((s, w) => s + w.estimatedValueIdr, 0),
      warehouses: intransitWhArr,
      topItems: intransitItemsList
        .sort((a, b) => b.estimatedValueIdr - a.estimatedValueIdr || b.qty - a.qty)
        .slice(0, 40),
    };

    return {
      cutoffDate: ACTIVE_ERP_CUTOFF_DATE,
      period: { dateFrom, dateTo },
      summary: {
        totalActivePhysicalSkus: enrichedSkus.length,
        inStockSkus,
        lowStockSkus,
        outOfStockSkus,
        overStockSkus,
        stockoutRatePct:
          enrichedSkus.length > 0 ? (outOfStockSkus / enrichedSkus.length) * 100 : 0,
        totalPhysicalQty,
        totalPhysicalValueIdr,
        glInventoryBalanceIdr,
        valuationVarianceVsGlIdr: totalPhysicalValueIdr - glInventoryBalanceIdr,
        totalPeriodInflowQty: monthly.reduce((s, m) => s + m.grnInQty, 0),
        totalPeriodOutflowQty: monthly.reduce(
          (s, m) => s + (m.doOutQty > 0 ? m.doOutQty : m.siOutQty),
          0
        ),
      },
      diagnostics: {
        costSource,
        minStockSource: itemMinStockCol,
        outflowSource,
        inflowSource,
        tablesDetected,
        intransitStrictlyExcluded: true,
      },
      warehouses,
      categories,
      intransit,
      abcSummary,
      abcTopItems: enrichedSkus.slice(0, 120),
      criticalStockItems,
      velocitySummary,
      slowDeadItems,
      monthly,
      fetchedAt: new Date().toISOString(),
    };
  });

  if (inventoryBiCache.size > 24) {
    const oldest = inventoryBiCache.keys().next().value;
    if (oldest) inventoryBiCache.delete(oldest);
  }
  inventoryBiCache.set(cacheKey, {
    expiresAt: Date.now() + INVENTORY_BI_CACHE_TTL_MS,
    data,
  });
  return data;
}
