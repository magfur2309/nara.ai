export const LOCAL_BRIDGE_SCRIPT = `// erp-mysql-bridge.mjs (v12 - Native myerpplus: Stok m1_* + BI Finance/Sales/Purchasing/Inventory/Production + Master Karyawan m1_contact + Hak Akses User m0_user/m0_role_menu + Purchasing m4_* + Sales m5_* + Keuangan m2_* + Produksi m6_* + Aset Tetap m7_*)
// Aturan periode aktif: transaksi mulai 2026-03-01 ke atas (di bawah Maret 2026 diabaikan,
// KECUALI untuk saldo Hutang & Piutang / AR & AP serta Master Aset Tetap m7_asset yang bersifat kumulatif).
// Angka Laporan Pembelian (Domestic 520105, Import 520104, Return 510103, Discount 510102) ditarik 100% dari m2_transaction_journal agar cocok presisi dengan Laporan Keuangan.
// Hak akses notifikasi Purchasing dibaca READ-ONLY dari m0_user (TANPA upassword), m0_user_role(_s), m0_role_menu(_s), dan m0_usergrupmenu.
// Bridge lokal READ-ONLY (SELECT saja) untuk menghubungkan MySQL 127.0.0.1:3306
// ke aplikasi SOP Brain lewat tunnel gratis: .\\ngrok http 3099
//
// Cara jalankan di PowerShell (C:\\erp-bridge):
//   1) npm init -y && npm install mysql2
//   2) Isi CONFIG di bawah (database, user, password, bridgeToken)
//   3) node erp-mysql-bridge.mjs
//   4) Di PowerShell lain (C:\\ngrok): .\\ngrok http 3099

import http from 'node:http';
import mysql from 'mysql2/promise';

const ACTIVE_CUTOFF_DATE = '2026-03-01';
const ANOMALY_ABS_THRESHOLD = 1e14;

const CONFIG = {
  bridgePort: Number(process.env.BRIDGE_PORT) || 3099,
  // Wajib sama dengan ERP_BRIDGE_TOKEN di panel Settings > Secrets aplikasi SOP Brain
  bridgeToken: process.env.BRIDGE_TOKEN || 'GANTI_TOKEN_RAHASIA_ANDA_MIN_16_KARAKTER',
  mysqlHost: process.env.MYSQL_HOST || '127.0.0.1',
  mysqlPort: Number(process.env.MYSQL_PORT) || 3306,
  mysqlDatabase: process.env.MYSQL_DATABASE || 'myerpplus',
  mysqlUser: process.env.MYSQL_USER || 'root',
  mysqlPassword: process.env.MYSQL_PASSWORD || '',
  // Otomatis memakai m1_item_stock_warehouse + m1_item + m1_warehouse jika terdeteksi database myerpplus.
  // Hanya dipakai jika ingin override ke tabel/view custom lain:
  stockView: process.env.MYSQL_STOCK_VIEW || '',
  colCode: process.env.MYSQL_COL_CODE || '',
  colName: process.env.MYSQL_COL_NAME || '',
  colWarehouse: process.env.MYSQL_COL_WAREHOUSE || '',
  colQty: process.env.MYSQL_COL_QTY || '',
  colUnit: process.env.MYSQL_COL_UNIT || '',
  colCategory: process.env.MYSQL_COL_CATEGORY || '',
};

const M0_STATUS = {
  '-2': 'Semua',
  '-1': 'Aktif',
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

function statusLabel(code) {
  const k = Number(code);
  return M0_STATUS[k] || ('Status ' + k);
}

function fmtDate(val) {
  if (!val) return '';
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return val.toISOString().slice(0, 10);
  }
  const s = String(val).trim();
  if (!s || s === '0000-00-00') return '';
  return s.slice(0, 10);
}

function clampActiveDateFrom(rawDateFrom) {
  if (rawDateFrom && /^\\d{4}-\\d{2}-\\d{2}$/.test(rawDateFrom) && rawDateFrom >= ACTIVE_CUTOFF_DATE) {
    return rawDateFrom;
  }
  return ACTIVE_CUTOFF_DATE;
}

const SAFE_ID = /^[a-zA-Z0-9_]{1,64}$/;
function safeId(v) {
  const s = String(v || '').trim().replace(/^\`+|\`+$/g, '');
  return SAFE_ID.test(s) ? s : '';
}

const pool = mysql.createPool({
  host: CONFIG.mysqlHost,
  port: CONFIG.mysqlPort,
  database: CONFIG.mysqlDatabase,
  user: CONFIG.mysqlUser,
  password: CONFIG.mysqlPassword,
  connectionLimit: 5,
  connectTimeout: 8000,
  decimalNumbers: true,
  dateStrings: true,
});

function pickCol(allCols, override, candidates) {
  const map = new Map(allCols.map((c) => [c.toLowerCase(), c]));
  if (override && map.has(override.toLowerCase())) return map.get(override.toLowerCase());
  for (const cand of candidates) {
    if (map.has(cand.toLowerCase())) return map.get(cand.toLowerCase());
  }
  for (const cand of candidates) {
    const partial = allCols.find((c) => c.toLowerCase().includes(cand.toLowerCase()));
    if (partial) return partial;
  }
  return null;
}

async function withReadOnlyConn(fn) {
  const conn = await pool.getConnection();
  try {
    try { await conn.query('SET SESSION TRANSACTION READ ONLY'); } catch {}
    try { await conn.query('SET SESSION MAX_EXECUTION_TIME = 10000'); } catch {}
    return await fn(conn);
  } finally {
    conn.release();
  }
}

async function detectMyErpPlusTables(conn) {
  const [rows] = await conn.query(
    "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('m1_item_stock_warehouse', 'm1_item', 'm1_warehouse', 'm1_contact', 'm1_coa', 'm2_transaction_journal', 'm2_accounting_period', 'm4_ri', 'm4_ri_detail', 'm4_po', 'm4_po_detail', 'm4_grn', 'm4_grn_detail', 'm4_pr', 'm4_pr_detail', 'm4_prt', 'm4_vp', 'm4_vp_detail', 'm5_si', 'm5_si_detail', 'm5_so', 'm5_do', 'm5_sr', 'm7_asset', 'm7_asset_v', 'm7_asset_category', 'm7_asset_depreciation', 'm7_depreciation_category')"
  );
  const set = new Set(rows.map((r) => String(r.TABLE_NAME || r.table_name || '').toLowerCase()));
  return {
    hasStock: set.has('m1_item_stock_warehouse') && set.has('m1_item'),
    hasWarehouse: set.has('m1_warehouse'),
    hasContact: set.has('m1_contact'),
    hasCoa: set.has('m1_coa'),
    hasJournal: set.has('m2_transaction_journal'),
    hasFinance: set.has('m1_coa') && set.has('m2_transaction_journal'),
    hasPurchasing: set.has('m4_ri') || set.has('m4_po'),
    hasRi: set.has('m4_ri'),
    hasRiDetail: set.has('m4_ri_detail'),
    hasPo: set.has('m4_po'),
    hasPoDetail: set.has('m4_po_detail'),
    hasGrn: set.has('m4_grn'),
    hasGrnDetail: set.has('m4_grn_detail'),
    hasPr: set.has('m4_pr'),
    hasPrDetail: set.has('m4_pr_detail'),
    hasPrt: set.has('m4_prt'),
    hasVp: set.has('m4_vp'),
    hasVpDetail: set.has('m4_vp_detail'),
    hasSales: set.has('m5_si'),
    hasSalesDetail: set.has('m5_si_detail'),
    hasSo: set.has('m5_so'),
    hasDo: set.has('m5_do'),
    hasSr: set.has('m5_sr'),
    hasAssets: set.has('m7_asset'),
    hasAssetView: set.has('m7_asset_v'),
    hasAssetCategory: set.has('m7_asset_category'),
    hasAssetDepreciation: set.has('m7_asset_depreciation'),
    hasDepreciationCategory: set.has('m7_depreciation_category'),
  };
}

async function detectCustomColumns(conn) {
  const viewName = safeId(CONFIG.stockView || 'vw_ai_stok_barang');
  if (!viewName) throw new Error('MYSQL_STOCK_VIEW tidak valid.');
  const [rows] = await conn.query('SHOW COLUMNS FROM \`' + viewName + '\`');
  const allColumns = rows.map((r) => String(r.Field || r.field || '').trim()).filter((c) => SAFE_ID.test(c));
  return {
    viewName,
    allColumns,
    codeCol: pickCol(allColumns, safeId(CONFIG.colCode), ['kode_barang', 'bkode', 'kodebarang', 'kode_brg', 'item_code', 'sku', 'kode', 'code']),
    nameCol: pickCol(allColumns, safeId(CONFIG.colName), ['nama_barang', 'bnama', 'namabarang', 'nama_brg', 'item_name', 'description', 'nama', 'name']),
    warehouseCol: pickCol(allColumns, safeId(CONFIG.colWarehouse), ['namagudang', 'gudang', 'nama_gudang', 'kgudang', 'warehouse_name', 'warehouse', 'lokasi']),
    qtyCol: pickCol(allColumns, safeId(CONFIG.colQty), ['qty_stok', 'stok', 'bstok', 'qty_akhir', 'saldo_akhir', 'qty', 'stock', 'saldo', 'jumlah']),
    unitCol: pickCol(allColumns, safeId(CONFIG.colUnit), ['satuan', 'bsatuan', 'uom', 'unit']),
    categoryCol: pickCol(allColumns, safeId(CONFIG.colCategory), ['kategori', 'bkategori', 'category', 'jenis']),
  };
}

async function resolveItemCategoryExpr(conn, hasBjenis) {
  let catJoin = '';
  let catExpr = "COALESCE(NULLIF(TRIM(CAST(i.bkategori AS CHAR)), ''), 'Tanpa Kategori')";
  try {
    const itemColsArr = await getTableCols(conn, 'm1_item');
    const itemColMap = new Map(itemColsArr.map((c) => [c.toLowerCase(), c]));
    const catColName = itemColMap.get('bkategori') || itemColMap.get('bgolongan') || '';
    if (catColName) {
      catExpr = "COALESCE(NULLIF(TRIM(CAST(i.\`" + catColName + "\` AS CHAR)), ''), 'Tanpa Kategori')";
      const [catTbls] = await conn.query(
        "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('m1_item_category', 'm1_category', 'm1_kategori', 'm1_item_kategori')"
      );
      if (catTbls && catTbls.length > 0) {
        const catTbl = String(catTbls[0].TABLE_NAME || catTbls[0].table_name || '').trim();
        if (catTbl && SAFE_ID.test(catTbl)) {
          const cColsArr = await getTableCols(conn, catTbl);
          const cColMap = new Map(cColsArr.map((c) => [c.toLowerCase(), c]));
          const idCol = ['kid', 'id', 'cid', 'k_id', 'kode', 'kkode'].map((c) => cColMap.get(c)).find(Boolean) || '';
          const codeCol = ['kkode', 'kode', 'ckode', 'code'].map((c) => cColMap.get(c)).find(Boolean) || '';
          const nameCol = ['knama', 'nama', 'cnama', 'name', 'kategori', 'deskripsi'].map((c) => cColMap.get(c)).find(Boolean) || '';
          if (idCol && (nameCol || codeCol)) {
            const jenisClause = hasBjenis ? " AND UPPER(TRIM(COALESCE(i.bjenis, ''))) = 'P'" : '';
            const [matchTest] = await conn.query(
              'SELECT 1 AS ok FROM m1_item i INNER JOIN \`' + catTbl + '\` ic ON CAST(ic.\`' + idCol + '\` AS CHAR) = CAST(i.\`' + catColName + '\` AS CHAR) WHERE i.baktif = 1' + jenisClause + ' LIMIT 1'
            );
            if (matchTest && matchTest.length > 0) {
              catJoin = 'LEFT JOIN \`' + catTbl + '\` ic ON CAST(ic.\`' + idCol + '\` AS CHAR) = CAST(i.\`' + catColName + '\` AS CHAR)';
              if (codeCol && nameCol && codeCol !== nameCol) {
                catExpr =
                  "CASE WHEN NULLIF(TRIM(CAST(ic.\`" + codeCol + "\` AS CHAR)), '') IS NOT NULL AND NULLIF(TRIM(CAST(ic.\`" + nameCol + "\` AS CHAR)), '') IS NOT NULL AND UPPER(TRIM(CAST(ic.\`" + codeCol + "\` AS CHAR))) <> UPPER(TRIM(CAST(ic.\`" + nameCol + "\` AS CHAR))) " +
                  "THEN CONCAT(TRIM(CAST(ic.\`" + codeCol + "\` AS CHAR)), ' - ', TRIM(CAST(ic.\`" + nameCol + "\` AS CHAR))) " +
                  "ELSE COALESCE(NULLIF(TRIM(CAST(ic.\`" + nameCol + "\` AS CHAR)), ''), NULLIF(TRIM(CAST(ic.\`" + codeCol + "\` AS CHAR)), ''), NULLIF(TRIM(CAST(i.\`" + catColName + "\` AS CHAR)), ''), 'Tanpa Kategori') END";
              } else {
                const chosen = nameCol || codeCol;
                catExpr = "COALESCE(NULLIF(TRIM(CAST(ic.\`" + chosen + "\` AS CHAR)), ''), NULLIF(TRIM(CAST(i.\`" + catColName + "\` AS CHAR)), ''), 'Tanpa Kategori')";
              }
            }
          }
        }
      }
    }
  } catch {}
  return { catJoin, catExpr };
}

function buildIntransitSqlParts(hasWarehouse, whColsArr) {
  const whColsLower = new Map((whColsArr || []).map((c) => [c.toLowerCase(), c]));
  const intransitParts = [
    "LOWER(REPLACE(REPLACE(COALESCE(s.kgudang, ''), ' ', ''), '-', '')) LIKE '%intransit%'",
  ];
  const inactiveWhParts = [];

  if (hasWarehouse) {
    intransitParts.push(
      "LOWER(REPLACE(REPLACE(COALESCE(w.wnama, ''), ' ', ''), '-', '')) LIKE '%intransit%'"
    );
    const virtualFlagCols = ['wisintransit', 'is_intransit', 'wisvirtual', 'is_virtual', 'wnonfisik'];
    for (const key of virtualFlagCols) {
      const col = whColsLower.get(key);
      if (col) intransitParts.push('COALESCE(w.\`' + col + '\`, 0) = 1');
    }
    const physicalFlagCol = whColsLower.get('wisfisik') || whColsLower.get('is_physical');
    if (physicalFlagCol) {
      intransitParts.push('COALESCE(w.\`' + physicalFlagCol + '\`, 1) = 0');
    }
    const activeWhCol = whColsLower.get('waktif') || whColsLower.get('aktif');
    if (activeWhCol) {
      inactiveWhParts.push('COALESCE(w.\`' + activeWhCol + '\`, 1) = 1');
    }
  }

  const isIntransitSql = '(' + intransitParts.join(' OR ') + ')';
  const isPhysicalSql =
    inactiveWhParts.length > 0
      ? '(NOT ' + isIntransitSql + ' AND ' + inactiveWhParts.join(' AND ') + ')'
      : '(NOT ' + isIntransitSql + ')';

  return { isIntransitSql, isPhysicalSql };
}

async function queryMyErpPlusStock(conn, opts) {
  const { search, warehouse, category, onlyLow, summaryOnly, intransitOnly, qtySort, limit, hasWarehouse } = opts;
  const whJoin = hasWarehouse ? 'LEFT JOIN m1_warehouse w ON w.wkode = s.kgudang' : '';
  const whExpr = hasWarehouse
    ? "COALESCE(NULLIF(TRIM(w.wnama), ''), NULLIF(TRIM(s.kgudang), ''), 'Gudang Utama')"
    : "COALESCE(NULLIF(TRIM(s.kgudang), ''), 'Gudang Utama')";

  const itemColsArr = await getTableCols(conn, 'm1_item');
  const whColsArr = hasWarehouse ? await getTableCols(conn, 'm1_warehouse') : [];
  const hasBjenis = itemColsArr.some((c) => c.toLowerCase() === 'bjenis');
  // Strict: hanya item aktif (baktif = 1) DAN jenis Persediaan (bjenis = 'P'; Jasa 'J' disembunyikan)
  const baseItemFilter = hasBjenis
    ? "i.baktif = 1 AND UPPER(TRIM(COALESCE(i.bjenis, ''))) = 'P'"
    : 'i.baktif = 1';

  // Logika Gudang Intransit (WAJIB): stok fisik/tersedia mengecualikan Gudang Intransit (virtual)
  const { isIntransitSql, isPhysicalSql } = buildIntransitSqlParts(hasWarehouse, whColsArr);
  const baseScopeFilter = baseItemFilter + ' AND ' + (intransitOnly ? isIntransitSql : isPhysicalSql);

  const { catJoin, catExpr } = await resolveItemCategoryExpr(conn, hasBjenis);

  const [cntAllRows] = await conn.query(
    'SELECT COUNT(*) AS total FROM m1_item_stock_warehouse s INNER JOIN m1_item i ON i.bid = s.idbarang ' + whJoin + ' WHERE ' + baseScopeFilter
  );
  const totalActiveRows = Number(cntAllRows[0]?.total || 0);

  // Ringkasan terpisah Gudang Intransit (HANYA INFORMASI — tidak pernah dijumlahkan ke stok fisik/tersedia)
  const itWhere = [baseItemFilter, isIntransitSql];
  const itBinds = [];
  if (category) {
    itWhere.push(catExpr + ' = ?');
    itBinds.push(category);
  }
  const [itRows] = await conn.query(
    'SELECT ' + whExpr + ' AS warehouse, COUNT(*) AS skuCount, COALESCE(SUM(s.stok), 0) AS totalQty, SUM(CASE WHEN COALESCE(s.stok, 0) <= 0 THEN 1 ELSE 0 END) AS zeroStockCount ' +
    'FROM m1_item_stock_warehouse s INNER JOIN m1_item i ON i.bid = s.idbarang ' + whJoin + ' ' + catJoin + ' ' +
    'WHERE ' + itWhere.join(' AND ') + ' GROUP BY warehouse ORDER BY warehouse ASC LIMIT 20',
    itBinds
  );
  const intransitSummary = {
    skuCount: itRows.reduce((acc, r) => acc + Number(r.skuCount || 0), 0),
    totalQty: itRows.reduce((acc, r) => acc + Number(r.totalQty || 0), 0),
    zeroStockCount: itRows.reduce((acc, r) => acc + Number(r.zeroStockCount || 0), 0),
    warehouses: itRows.map((r) => String(r.warehouse || 'Intransit').trim()).filter(Boolean),
  };

  // Ringkasan kategori barang persediaan aktif (mis. RM, WIP, FG, dll.) — TANPA Gudang Intransit pada mode stok fisik
  const [catRows] = await conn.query(
    'SELECT ' + catExpr + ' AS category, COUNT(*) AS skuCount, COALESCE(SUM(s.stok), 0) AS totalQty, SUM(CASE WHEN COALESCE(s.stok, 0) <= 0 THEN 1 ELSE 0 END) AS zeroStockCount ' +
    'FROM m1_item_stock_warehouse s INNER JOIN m1_item i ON i.bid = s.idbarang ' + whJoin + ' ' + catJoin + ' ' +
    'WHERE ' + baseScopeFilter + ' GROUP BY category ORDER BY category ASC LIMIT 100'
  );
  const categories = catRows.map((r) => ({
    category: String(r.category || 'Tanpa Kategori').trim(),
    skuCount: Number(r.skuCount || 0),
    totalQty: Number(r.totalQty || 0),
    zeroStockCount: Number(r.zeroStockCount || 0),
  }));

  // Ringkasan gudang fisik (mengikuti filter kategori jika kategori dipilih; TANPA Gudang Intransit)
  const whWhere = [baseScopeFilter];
  const whBinds = [];
  if (category) {
    whWhere.push(catExpr + ' = ?');
    whBinds.push(category);
  }
  const [whRows] = await conn.query(
    'SELECT ' + whExpr + ' AS warehouse, COUNT(*) AS skuCount, COALESCE(SUM(s.stok), 0) AS totalQty, SUM(CASE WHEN COALESCE(s.stok, 0) <= 0 THEN 1 ELSE 0 END) AS zeroStockCount ' +
    'FROM m1_item_stock_warehouse s INNER JOIN m1_item i ON i.bid = s.idbarang ' + whJoin + ' ' + catJoin + ' ' +
    'WHERE ' + whWhere.join(' AND ') + ' GROUP BY warehouse ORDER BY warehouse ASC LIMIT 50',
    whBinds
  );
  const warehouses = whRows.map((r) => ({
    warehouse: String(r.warehouse || 'Gudang Utama'),
    skuCount: Number(r.skuCount || 0),
    totalQty: Number(r.totalQty || 0),
    zeroStockCount: Number(r.zeroStockCount || 0),
  }));

  const totalRows = category
    ? warehouses.reduce((acc, w) => acc + Number(w.skuCount || 0), 0)
    : totalActiveRows;

  // Jika mode summaryOnly (belum memilih kategori & tidak ada pencarian), jangan kirim dump seluruh stok
  if (summaryOnly && !category && !search && !intransitOnly) {
    return {
      items: [],
      warehouses,
      categories,
      selectedCategory: '',
      activeOnly: true,
      inventoryOnly: hasBjenis,
      intransitExcluded: true,
      intransitBridgeNative: true,
      intransitOnly: false,
      intransitSummary,
      qtySort: qtySort || '',
      totalRows: totalActiveRows,
      totalActiveRows,
      viewName: 'm1_item_stock_warehouse + m1_item (baktif=1, bjenis=P) + m1_warehouse (tanpa Intransit)',
      detectedColumns: {
        viewName: 'm1_item_stock_warehouse',
        codeCol: 'bkode',
        nameCol: 'bnama',
        warehouseCol: 'wnama',
        qtyCol: 'stok',
        unitCol: 'bsatuan',
        categoryCol: 'bkategori',
        allColumns: ['bkode', 'bnama', 'wnama', 'stok', 'bsatuan', 'bkategori', 'baktif', 'bjenis'],
      },
      fetchedAt: new Date().toISOString(),
    };
  }

  const where = [baseScopeFilter];
  const binds = [];
  if (category) {
    where.push(catExpr + ' = ?');
    binds.push(category);
  }
  if (warehouse) {
    where.push('(' + whExpr + ' LIKE ? OR s.kgudang LIKE ?)');
    binds.push('%' + warehouse + '%', '%' + warehouse + '%');
  }
  if (search) {
    const tokens = search.split(/\\s+/).filter((t) => t.length >= 2).slice(0, 5);
    for (const tok of tokens) {
      where.push('(i.bkode LIKE ? OR i.bnama LIKE ? OR ' + catExpr + ' LIKE ? OR ' + whExpr + ' LIKE ?)');
      binds.push('%' + tok + '%', '%' + tok + '%', '%' + tok + '%', '%' + tok + '%');
    }
  }
  if (onlyLow) {
    where.push('COALESCE(s.stok, 0) <= GREATEST(COALESCE(i.bstokminimal, 0), 10)');
  }

  const orderSql =
    qtySort === 'desc'
      ? 'ORDER BY COALESCE(s.stok, 0) DESC, i.bnama ASC'
      : qtySort === 'asc'
        ? 'ORDER BY COALESCE(s.stok, 0) ASC, i.bnama ASC'
        : onlyLow
          ? 'ORDER BY COALESCE(s.stok, 0) ASC, i.bnama ASC'
          : 'ORDER BY warehouse ASC, i.bnama ASC';

  const [rows] = await conn.query(
    'SELECT i.bkode AS code, i.bnama AS name, ' + whExpr + ' AS warehouse, COALESCE(s.stok, 0) AS qty, ' +
    "COALESCE(NULLIF(TRIM(i.bsatuan), ''), 'Pcs') AS unit, " + catExpr + ' AS category ' +
    'FROM m1_item_stock_warehouse s INNER JOIN m1_item i ON i.bid = s.idbarang ' + whJoin + ' ' + catJoin + ' ' +
    'WHERE ' + where.join(' AND ') + ' ' + orderSql + ' LIMIT ?',
    [...binds, limit]
  );

  return {
    items: rows.map((r) => ({
      code: String(r.code || '-').trim(),
      name: String(r.name || '-').trim(),
      warehouse: String(r.warehouse || 'Gudang Utama').trim(),
      qty: Number(r.qty || 0),
      unit: String(r.unit || 'Pcs').trim(),
      category: String(r.category || 'Tanpa Kategori').trim(),
    })),
    warehouses,
    categories,
    selectedCategory: category || '',
    activeOnly: true,
    inventoryOnly: hasBjenis,
    intransitExcluded: !intransitOnly,
    intransitBridgeNative: true,
    intransitOnly: Boolean(intransitOnly),
    intransitSummary,
    qtySort: qtySort || '',
    totalRows,
    totalActiveRows,
    viewName: intransitOnly
      ? 'm1_item_stock_warehouse (Gudang Intransit · Hanya Informasi)'
      : 'm1_item_stock_warehouse + m1_item (baktif=1, bjenis=P) + m1_warehouse (tanpa Intransit)',
    detectedColumns: {
      viewName: 'm1_item_stock_warehouse',
      codeCol: 'bkode',
      nameCol: 'bnama',
      warehouseCol: 'wnama',
      qtyCol: 'stok',
      unitCol: 'bsatuan',
      categoryCol: 'bkategori',
      allColumns: ['bkode', 'bnama', 'wnama', 'stok', 'bsatuan', 'bkategori', 'baktif', 'bjenis'],
    },
    fetchedAt: new Date().toISOString(),
  };
}

async function queryMyErpPlusSales(conn, opts, caps) {
  const { search, dateTo, limit } = opts;
  // Transaksi non-piutang minimal dari 2026-03-01 (di bawah Maret 2026 diabaikan)
  const effectiveDateFrom = clampActiveDateFrom(opts.dateFrom);

  const contactJoin = caps.hasContact
    ? 'LEFT JOIN m1_contact c ON c.kid = si.sicustomer LEFT JOIN m1_contact sls ON sls.kid = si.sibagianpenjualan'
    : '';
  const custNameExpr = caps.hasContact
    ? "COALESCE(NULLIF(TRIM(c.knama), ''), CONCAT('Customer #', si.sicustomer))"
    : "CONCAT('Customer #', si.sicustomer)";
  const custCodeExpr = caps.hasContact
    ? "COALESCE(NULLIF(TRIM(c.kkode), ''), CAST(si.sicustomer AS CHAR))"
    : 'CAST(si.sicustomer AS CHAR)';
  const salesNameExpr = caps.hasContact
    ? "COALESCE(NULLIF(TRIM(sls.knama), ''), '-')"
    : "'-'";

  // Filter transaksi aktif (>= 2026-03-01)
  const siWhere = ['COALESCE(si.sistatus, 0) NOT IN (6, 12)', 'si.sitgl >= ?'];
  const siBinds = [effectiveDateFrom];
  if (dateTo) { siWhere.push('si.sitgl <= ?'); siBinds.push(dateTo); }
  if (search) {
    if (caps.hasContact) {
      siWhere.push("(si.sinotransaksi LIKE ? OR COALESCE(c.knama, '') LIKE ? OR COALESCE(sls.knama, '') LIKE ? OR COALESCE(si.sigudang, '') LIKE ?)");
      siBinds.push('%' + search + '%', '%' + search + '%', '%' + search + '%', '%' + search + '%');
    } else {
      siWhere.push("(si.sinotransaksi LIKE ? OR COALESCE(si.sigudang, '') LIKE ?)");
      siBinds.push('%' + search + '%', '%' + search + '%');
    }
  }
  const siWhereSql = 'WHERE ' + siWhere.join(' AND ');

  // PENGECUALIAN PIUTANG: seluruh faktur belum lunas tetap dihitung (termasuk carry-over < 2026-03-01)
  const arWhere = [
    'COALESCE(si.sistatus, 0) NOT IN (6, 12)',
    'COALESCE(si.sistatuslunas, 0) = 0',
    'GREATEST(0, COALESCE(si.sitotaltransaksi, 0) - COALESCE(si.sijmlbayar, 0) - COALESCE(si.sijmluangmuka, 0)) > 0',
  ];
  const arBinds = [];
  if (dateTo) { arWhere.push('si.sitgl <= ?'); arBinds.push(dateTo); }
  if (search) {
    if (caps.hasContact) {
      arWhere.push("(si.sinotransaksi LIKE ? OR COALESCE(c.knama, '') LIKE ? OR COALESCE(sls.knama, '') LIKE ? OR COALESCE(si.sigudang, '') LIKE ?)");
      arBinds.push('%' + search + '%', '%' + search + '%', '%' + search + '%', '%' + search + '%');
    } else {
      arWhere.push("(si.sinotransaksi LIKE ? OR COALESCE(si.sigudang, '') LIKE ?)");
      arBinds.push('%' + search + '%', '%' + search + '%');
    }
  }
  const arWhereSql = 'WHERE ' + arWhere.join(' AND ');

  const [kpiRows] = await conn.query(
    'SELECT COUNT(*) AS invoiceCount, COALESCE(SUM(si.sitotaltransaksi), 0) AS totalRevenue, ' +
    'COALESCE(SUM(COALESCE(si.sijmlbayar, 0) + COALESCE(si.sijmluangmuka, 0)), 0) AS totalPaid ' +
    'FROM m5_si si ' + contactJoin + ' ' + siWhereSql,
    siBinds
  );

  const [arKpiRows] = await conn.query(
    'SELECT ' +
    'COALESCE(SUM(GREATEST(0, COALESCE(si.sitotaltransaksi, 0) - COALESCE(si.sijmlbayar, 0) - COALESCE(si.sijmluangmuka, 0))), 0) AS totalReceivable, ' +
    'COUNT(*) AS unpaidInvoiceCount, ' +
    'SUM(CASE WHEN si.sitgl < ? THEN 1 ELSE 0 END) AS carryOverUnpaidCount, ' +
    'COALESCE(SUM(CASE WHEN si.sitgl < ? THEN GREATEST(0, COALESCE(si.sitotaltransaksi, 0) - COALESCE(si.sijmlbayar, 0) - COALESCE(si.sijmluangmuka, 0)) ELSE 0 END), 0) AS carryOverReceivable, ' +
    'SUM(CASE WHEN si.sitgljatuhtempo IS NOT NULL AND si.sitgljatuhtempo < CURDATE() THEN 1 ELSE 0 END) AS overdueInvoiceCount, ' +
    'COALESCE(SUM(CASE WHEN si.sitgljatuhtempo IS NOT NULL AND si.sitgljatuhtempo < CURDATE() THEN GREATEST(0, COALESCE(si.sitotaltransaksi, 0) - COALESCE(si.sijmlbayar, 0) - COALESCE(si.sijmluangmuka, 0)) ELSE 0 END), 0) AS overdueAmount ' +
    'FROM m5_si si ' + contactJoin + ' ' + arWhereSql,
    [ACTIVE_CUTOFF_DATE, ACTIVE_CUTOFF_DATE, ...arBinds]
  );

  const [monthlyRows] = await conn.query(
    "SELECT DATE_FORMAT(si.sitgl, '%Y-%m') AS month, COUNT(*) AS invoiceCount, COALESCE(SUM(si.sitotaltransaksi), 0) AS revenue, " +
    'COALESCE(SUM(COALESCE(si.sijmlbayar, 0) + COALESCE(si.sijmluangmuka, 0)), 0) AS paid, ' +
    'COALESCE(SUM(CASE WHEN COALESCE(si.sistatuslunas, 0) = 0 THEN GREATEST(0, COALESCE(si.sitotaltransaksi, 0) - COALESCE(si.sijmlbayar, 0) - COALESCE(si.sijmluangmuka, 0)) ELSE 0 END), 0) AS receivable ' +
    'FROM m5_si si ' + contactJoin + ' ' + siWhereSql + " AND si.sitgl IS NOT NULL GROUP BY DATE_FORMAT(si.sitgl, '%Y-%m') ORDER BY month DESC LIMIT 12",
    siBinds
  );

  const [topCustRows] = await conn.query(
    'SELECT si.sicustomer AS customerId, ' + custCodeExpr + ' AS customerCode, ' + custNameExpr + ' AS customerName, ' +
    'COUNT(*) AS invoiceCount, COALESCE(SUM(si.sitotaltransaksi), 0) AS totalRevenue, ' +
    'COALESCE(SUM(CASE WHEN COALESCE(si.sistatuslunas, 0) = 0 THEN GREATEST(0, COALESCE(si.sitotaltransaksi, 0) - COALESCE(si.sijmlbayar, 0) - COALESCE(si.sijmluangmuka, 0)) ELSE 0 END), 0) AS totalReceivable ' +
    'FROM m5_si si ' + contactJoin + ' ' + siWhereSql + ' GROUP BY si.sicustomer, customerCode, customerName ORDER BY totalRevenue DESC LIMIT 15',
    siBinds
  );

  let topItemRows = [];
  if (caps.hasSalesDetail) {
    try {
      const [rows] = await conn.query(
        'SELECT d.idbarang AS itemId, ' +
        (caps.hasStock ? "COALESCE(NULLIF(TRIM(i.bkode), ''), CAST(d.idbarang AS CHAR))" : 'CAST(d.idbarang AS CHAR)') + ' AS itemCode, ' +
        (caps.hasStock ? "COALESCE(NULLIF(TRIM(d.namabarang), ''), NULLIF(TRIM(i.bnama), ''), CONCAT('Barang #', d.idbarang))" : "COALESCE(NULLIF(TRIM(d.namabarang), ''), CONCAT('Barang #', d.idbarang))") + ' AS itemName, ' +
        "COALESCE(SUM(d.jml), 0) AS totalQty, COALESCE(NULLIF(TRIM(MAX(d.satuan)), ''), 'Pcs') AS unit, " +
        'COALESCE(SUM((COALESCE(d.jml, 0) * COALESCE(d.harga, 0)) - COALESCE(d.jmldiskon, 0)), 0) AS totalValue, ' +
        'COUNT(DISTINCT d.idsi) AS invoiceCount ' +
        'FROM m5_si_detail d INNER JOIN m5_si si ON si.siid = d.idsi ' + contactJoin + ' ' +
        (caps.hasStock ? 'LEFT JOIN m1_item i ON i.bid = d.idbarang ' : '') +
        siWhereSql + ' GROUP BY d.idbarang, itemCode, itemName ORDER BY totalValue DESC LIMIT 15',
        siBinds
      );
      topItemRows = rows;
    } catch {}
  }

  const [invRows] = await conn.query(
    'SELECT si.siid AS id, si.sinotransaksi AS docNo, si.sitgl AS date, si.sitgljatuhtempo AS dueDate, ' +
    custNameExpr + ' AS customerName, ' + salesNameExpr + ' AS salesmanName, ' +
    "COALESCE(NULLIF(TRIM(si.sigudang), ''), '-') AS warehouse, COALESCE(NULLIF(TRIM(si.simatauang), ''), 'IDR') AS currency, " +
    'COALESCE(si.sitotaltransaksi, 0) AS total, COALESCE(si.sijmlbayar, 0) + COALESCE(si.sijmluangmuka, 0) AS paid, ' +
    'CASE WHEN COALESCE(si.sistatuslunas, 0) = 1 THEN 0 ELSE GREATEST(0, COALESCE(si.sitotaltransaksi, 0) - COALESCE(si.sijmlbayar, 0) - COALESCE(si.sijmluangmuka, 0)) END AS balance, ' +
    'COALESCE(si.sistatuslunas, 0) AS isPaid, ' +
    'CASE WHEN COALESCE(si.sistatuslunas, 0) = 0 AND si.sitgljatuhtempo IS NOT NULL AND si.sitgljatuhtempo < CURDATE() THEN 1 ELSE 0 END AS isOverdue, ' +
    'COALESCE(si.sistatus, 0) AS statusCode ' +
    'FROM m5_si si ' + contactJoin + ' ' + siWhereSql + ' ORDER BY si.sitgl DESC, si.siid DESC LIMIT ?',
    [...siBinds, limit]
  );

  const [unpaidRows] = await conn.query(
    'SELECT si.siid AS id, si.sinotransaksi AS docNo, si.sitgl AS date, si.sitgljatuhtempo AS dueDate, ' +
    custNameExpr + ' AS customerName, ' + salesNameExpr + ' AS salesmanName, ' +
    "COALESCE(NULLIF(TRIM(si.sigudang), ''), '-') AS warehouse, COALESCE(NULLIF(TRIM(si.simatauang), ''), 'IDR') AS currency, " +
    'COALESCE(si.sitotaltransaksi, 0) AS total, COALESCE(si.sijmlbayar, 0) + COALESCE(si.sijmluangmuka, 0) AS paid, ' +
    'GREATEST(0, COALESCE(si.sitotaltransaksi, 0) - COALESCE(si.sijmlbayar, 0) - COALESCE(si.sijmluangmuka, 0)) AS balance, ' +
    '0 AS isPaid, ' +
    'CASE WHEN si.sitgljatuhtempo IS NOT NULL AND si.sitgljatuhtempo < CURDATE() THEN 1 ELSE 0 END AS isOverdue, ' +
    'COALESCE(si.sistatus, 0) AS statusCode ' +
    'FROM m5_si si ' + contactJoin + ' ' + arWhereSql +
    ' ORDER BY si.sitgljatuhtempo ASC, si.sitgl ASC LIMIT ?',
    [...arBinds, limit]
  );

  let soAgg = { soCount: 0, soTotalValue: 0, soOutstandingCount: 0 };
  let soRows = [];
  if (caps.hasSo) {
    try {
      const soWhere = ['COALESCE(so.sostatus, 0) NOT IN (6, 12)', 'so.sotgl >= ?'];
      const soBinds = [effectiveDateFrom];
      if (dateTo) { soWhere.push('so.sotgl <= ?'); soBinds.push(dateTo); }
      if (search) {
        soWhere.push(caps.hasContact ? "(so.sonotransaksi LIKE ? OR COALESCE(c.knama, '') LIKE ?)" : 'so.sonotransaksi LIKE ?');
        soBinds.push('%' + search + '%');
        if (caps.hasContact) soBinds.push('%' + search + '%');
      }
      const soWhereSql = 'WHERE ' + soWhere.join(' AND ');
      const soJoin = caps.hasContact ? 'LEFT JOIN m1_contact c ON c.kid = so.socustomer' : '';
      const soCust = caps.hasContact ? "COALESCE(NULLIF(TRIM(c.knama), ''), CONCAT('Customer #', so.socustomer))" : "CONCAT('Customer #', so.socustomer)";

      const [a] = await conn.query(
        'SELECT COUNT(*) AS soCount, COALESCE(SUM(so.sototaltransaksi), 0) AS soTotalValue, ' +
        'SUM(CASE WHEN COALESCE(so.soisclose, 0) = 0 AND COALESCE(so.sostatus, 0) NOT IN (4, 7) AND COALESCE(so.sostatusdo, 0) = 0 THEN 1 ELSE 0 END) AS soOutstandingCount ' +
        'FROM m5_so so ' + soJoin + ' ' + soWhereSql,
        soBinds
      );
      soAgg = {
        soCount: Number(a[0]?.soCount || 0),
        soTotalValue: Number(a[0]?.soTotalValue || 0),
        soOutstandingCount: Number(a[0]?.soOutstandingCount || 0),
      };
      const [rows] = await conn.query(
        'SELECT so.soid AS id, so.sonotransaksi AS docNo, so.sotgl AS date, so.sotglkirim AS shipDate, ' +
        soCust + " AS customerName, COALESCE(NULLIF(TRIM(so.sogudang), ''), '-') AS warehouse, " +
        'COALESCE(so.sototaltransaksi, 0) AS total, COALESCE(so.sostatus, 0) AS statusCode, ' +
        'COALESCE(so.sostatusdo, 0) AS statusDo, COALESCE(so.sostatussi, 0) AS statusSi, COALESCE(so.soisclose, 0) AS isClosed ' +
        'FROM m5_so so ' + soJoin + ' ' + soWhereSql + ' ORDER BY so.sotgl DESC, so.soid DESC LIMIT ?',
        [...soBinds, limit]
      );
      soRows = rows;
    } catch {}
  }

  let doCount = 0;
  let doRows = [];
  if (caps.hasDo) {
    try {
      const doWhere = ['COALESCE(d.dostatus, 0) NOT IN (6, 12)', 'd.dotgl >= ?'];
      const doBinds = [effectiveDateFrom];
      if (dateTo) { doWhere.push('d.dotgl <= ?'); doBinds.push(dateTo); }
      if (search) {
        doWhere.push(caps.hasContact ? "(d.donotransaksi LIKE ? OR COALESCE(c.knama, '') LIKE ?)" : 'd.donotransaksi LIKE ?');
        doBinds.push('%' + search + '%');
        if (caps.hasContact) doBinds.push('%' + search + '%');
      }
      const doWhereSql = 'WHERE ' + doWhere.join(' AND ');
      const doJoin = caps.hasContact ? 'LEFT JOIN m1_contact c ON c.kid = d.docustomer' : '';
      const doCust = caps.hasContact ? "COALESCE(NULLIF(TRIM(c.knama), ''), CONCAT('Customer #', d.docustomer))" : "CONCAT('Customer #', d.docustomer)";

      const [cRows] = await conn.query('SELECT COUNT(*) AS doCount FROM m5_do d ' + doJoin + ' ' + doWhereSql, doBinds);
      doCount = Number(cRows[0]?.doCount || 0);
      const [rows] = await conn.query(
        'SELECT d.doid AS id, d.donotransaksi AS docNo, d.dotgl AS date, d.dotglkirim AS shipDate, ' +
        doCust + " AS customerName, COALESCE(NULLIF(TRIM(d.dogudang), ''), '-') AS warehouse, " +
        "COALESCE(NULLIF(TRIM(d.doekspedisi), ''), '-') AS expedition, COALESCE(d.dototaltransaksi, 0) AS total, COALESCE(d.dostatus, 0) AS statusCode " +
        'FROM m5_do d ' + doJoin + ' ' + doWhereSql + ' ORDER BY d.dotgl DESC, d.doid DESC LIMIT ?',
        [...doBinds, limit]
      );
      doRows = rows;
    } catch {}
  }

  let srAgg = { returnCount: 0, returnTotalValue: 0 };
  let srRows = [];
  if (caps.hasSr) {
    try {
      const srWhere = ['COALESCE(sr.srstatus, 0) NOT IN (6, 12)', 'sr.srtgl >= ?'];
      const srBinds = [effectiveDateFrom];
      if (dateTo) { srWhere.push('sr.srtgl <= ?'); srBinds.push(dateTo); }
      if (search) {
        srWhere.push(caps.hasContact ? "(sr.srnotransaksi LIKE ? OR COALESCE(c.knama, '') LIKE ?)" : 'sr.srnotransaksi LIKE ?');
        srBinds.push('%' + search + '%');
        if (caps.hasContact) srBinds.push('%' + search + '%');
      }
      const srWhereSql = 'WHERE ' + srWhere.join(' AND ');
      const srJoin = caps.hasContact ? 'LEFT JOIN m1_contact c ON c.kid = sr.srcustomer' : '';
      const srCust = caps.hasContact ? "COALESCE(NULLIF(TRIM(c.knama), ''), CONCAT('Customer #', sr.srcustomer))" : "CONCAT('Customer #', sr.srcustomer)";

      const [a] = await conn.query(
        'SELECT COUNT(*) AS returnCount, COALESCE(SUM(sr.srtotaltransaksi), 0) AS returnTotalValue FROM m5_sr sr ' + srJoin + ' ' + srWhereSql,
        srBinds
      );
      srAgg = {
        returnCount: Number(a[0]?.returnCount || 0),
        returnTotalValue: Number(a[0]?.returnTotalValue || 0),
      };
      const [rows] = await conn.query(
        'SELECT sr.srid AS id, sr.srnotransaksi AS docNo, sr.srtgl AS date, ' +
        srCust + " AS customerName, COALESCE(NULLIF(TRIM(sr.srgudang), ''), '-') AS warehouse, " +
        'COALESCE(sr.srtotaltransaksi, 0) AS total, COALESCE(sr.srstatus, 0) AS statusCode ' +
        'FROM m5_sr sr ' + srJoin + ' ' + srWhereSql + ' ORDER BY sr.srtgl DESC, sr.srid DESC LIMIT ?',
        [...srBinds, limit]
      );
      srRows = rows;
    } catch {}
  }

  const mapInv = (r) => {
    const dt = fmtDate(r.date);
    return {
      id: Number(r.id || 0),
      docNo: String(r.docNo || '-'),
      date: dt,
      dueDate: fmtDate(r.dueDate),
      customerName: String(r.customerName || '-'),
      salesmanName: String(r.salesmanName || '-'),
      warehouse: String(r.warehouse || '-'),
      currency: String(r.currency || 'IDR'),
      total: Number(r.total || 0),
      paid: Number(r.paid || 0),
      balance: Number(r.balance || 0),
      isPaid: Boolean(Number(r.isPaid)),
      isOverdue: Boolean(Number(r.isOverdue)),
      isCarryOver: Boolean(dt && dt < ACTIVE_CUTOFF_DATE),
      statusCode: Number(r.statusCode || 0),
      statusLabel: statusLabel(r.statusCode),
    };
  };

  return {
    cutoffDate: ACTIVE_CUTOFF_DATE,
    period: { dateFrom: effectiveDateFrom, dateTo },
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
      soCount: soAgg.soCount,
      soTotalValue: soAgg.soTotalValue,
      soOutstandingCount: soAgg.soOutstandingCount,
      doCount,
      returnCount: srAgg.returnCount,
      returnTotalValue: srAgg.returnTotalValue,
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
      date: fmtDate(r.date),
      shipDate: fmtDate(r.shipDate),
      customerName: String(r.customerName || '-'),
      warehouse: String(r.warehouse || '-'),
      total: Number(r.total || 0),
      statusCode: Number(r.statusCode || 0),
      statusLabel: statusLabel(r.statusCode),
      statusDo: Number(r.statusDo || 0),
      statusSi: Number(r.statusSi || 0),
      isClosed: Boolean(Number(r.isClosed)),
    })),
    deliveryOrders: doRows.map((r) => ({
      id: Number(r.id || 0),
      docNo: String(r.docNo || '-'),
      date: fmtDate(r.date),
      shipDate: fmtDate(r.shipDate),
      customerName: String(r.customerName || '-'),
      warehouse: String(r.warehouse || '-'),
      expedition: String(r.expedition || '-'),
      total: Number(r.total || 0),
      statusCode: Number(r.statusCode || 0),
      statusLabel: statusLabel(r.statusCode),
    })),
    salesReturns: srRows.map((r) => ({
      id: Number(r.id || 0),
      docNo: String(r.docNo || '-'),
      date: fmtDate(r.date),
      customerName: String(r.customerName || '-'),
      warehouse: String(r.warehouse || '-'),
      total: Number(r.total || 0),
      statusCode: Number(r.statusCode || 0),
      statusLabel: statusLabel(r.statusCode),
    })),
    fetchedAt: new Date().toISOString(),
  };
}

function shiftMonthYm(ym, deltaMonths) {
  const m = /^(\\d{4})-(\\d{2})$/.exec(String(ym || ''));
  if (!m) return String(ym || '');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + deltaMonths, 1));
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

function pickColExact(cols, candidates) {
  const map = new Map((cols || []).map((c) => [String(c).toLowerCase(), String(c)]));
  for (const cand of candidates) {
    const hit = map.get(String(cand).toLowerCase());
    if (hit && /^[a-zA-Z0-9_]{1,64}$/.test(hit)) return hit;
  }
  return null;
}

async function queryMyErpPlusSalesBi(conn, opts) {
  const effectiveDateFrom = clampActiveDateFrom(opts.dateFrom);
  const dateTo = /^\\d{4}-\\d{2}-\\d{2}$/.test(opts.dateTo || '') ? opts.dateTo : '';

  const [tblRows] = await conn.query(
    "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('m5_si','m5_si_detail','m5_so','m5_so_detail','m5_do','m5_do_detail','m5_sr','m5_sr_detail','m1_contact','m1_item','m2_transaction_journal','m1_coa')"
  );
  const tblSet = new Set(tblRows.map((r) => String(r.TABLE_NAME || r.table_name || '').toLowerCase()));
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
    throw new Error('Tabel penjualan MyERP Plus (m5_si / m5_so) tidak ditemukan.');
  }

  const [siCols, siDetCols, soCols, soDetCols, doCols, doDetCols, srCols, srDetCols, contactCols, itemCols] =
    await Promise.all([
      hasSi ? getTableCols(conn, 'm5_si') : [],
      hasSiDet ? getTableCols(conn, 'm5_si_detail') : [],
      hasSo ? getTableCols(conn, 'm5_so') : [],
      hasSoDet ? getTableCols(conn, 'm5_so_detail') : [],
      hasDo ? getTableCols(conn, 'm5_do') : [],
      hasDoDet ? getTableCols(conn, 'm5_do_detail') : [],
      hasSr ? getTableCols(conn, 'm5_sr') : [],
      hasSrDet ? getTableCols(conn, 'm5_sr_detail') : [],
      hasContact ? getTableCols(conn, 'm1_contact') : [],
      hasItem ? getTableCols(conn, 'm1_item') : [],
    ]);

  let minDateAll = '', maxDateAll = '', minDateActive = '', maxDateActive = '';
  for (const spec of [
    hasSi ? { t: 'm5_si', d: 'sitgl', s: 'sistatus' } : null,
    hasSo ? { t: 'm5_so', d: 'sotgl', s: 'sostatus' } : null,
  ].filter(Boolean)) {
    try {
      const [r] = await conn.query(
        'SELECT MIN(' + spec.d + ') AS mnAll, MAX(' + spec.d + ') AS mxAll, ' +
        'MIN(CASE WHEN ' + spec.d + ' >= ? THEN ' + spec.d + ' END) AS mnAct, ' +
        'MAX(CASE WHEN ' + spec.d + ' >= ? THEN ' + spec.d + ' END) AS mxAct ' +
        'FROM ' + spec.t + ' WHERE COALESCE(' + spec.s + ', 0) NOT IN (6, 12) AND ' + spec.d + ' IS NOT NULL',
        [ACTIVE_CUTOFF_DATE, ACTIVE_CUTOFF_DATE]
      );
      if (r[0]) {
        const mnA = fmtDate(r[0].mnAll), mxA = fmtDate(r[0].mxAll), mnAct = fmtDate(r[0].mnAct), mxAct = fmtDate(r[0].mxAct);
        if (mnA && (!minDateAll || mnA < minDateAll)) minDateAll = mnA;
        if (mxA && (!maxDateAll || mxA > maxDateAll)) maxDateAll = mxA;
        if (mnAct && (!minDateActive || mnAct < minDateActive)) minDateActive = mnAct;
        if (mxAct && (!maxDateActive || mxAct > maxDateActive)) maxDateActive = mxAct;
      }
    } catch {}
  }

  const startYm = effectiveDateFrom.slice(0, 7);
  const effectiveDateTo = dateTo || maxDateActive || effectiveDateFrom.slice(0, 4) + '-12-31';
  const endYm = effectiveDateTo.slice(0, 7);
  const prevMonthDateFrom = shiftMonthYm(startYm, -1) + '-01';
  const rolling3mDateFrom = shiftMonthYm(startYm, -3) + '-01';

  const siDateToSql = dateTo ? ' AND si.sitgl <= ?' : '';
  const siDateToBind = dateTo ? [dateTo] : [];
  const soDateToSql = dateTo ? ' AND so.sotgl <= ?' : '';
  const soDateToBind = dateTo ? [dateTo] : [];
  const doDateToSql = dateTo ? ' AND d.dotgl <= ?' : '';
  const doDateToBind = dateTo ? [dateTo] : [];
  const srDateToSql = dateTo ? ' AND sr.srtgl <= ?' : '';
  const srDateToBind = dateTo ? [dateTo] : [];

  const activeMonthsSet = new Set();
  const siCustByMonth = new Map();
  const soCustByMonth = new Map();

  if (hasSi) {
    const [rows] = await conn.query(
      "SELECT DATE_FORMAT(si.sitgl, '%Y-%m') AS ym, si.sicustomer AS cid FROM m5_si si " +
      'WHERE COALESCE(si.sistatus, 0) NOT IN (6, 12) AND si.sitgl >= ?' + siDateToSql +
      ' AND si.sicustomer IS NOT NULL AND si.sicustomer > 0 GROUP BY ym, si.sicustomer',
      [rolling3mDateFrom, ...siDateToBind]
    );
    for (const r of rows) {
      const ym = String(r.ym || ''), cid = Number(r.cid || 0);
      if (!ym || !cid) continue;
      if (!siCustByMonth.has(ym)) siCustByMonth.set(ym, new Set());
      siCustByMonth.get(ym).add(cid);
      if (ym >= startYm && ym <= endYm) activeMonthsSet.add(ym);
    }
  }
  if (hasSo) {
    const [rows] = await conn.query(
      "SELECT DATE_FORMAT(so.sotgl, '%Y-%m') AS ym, so.socustomer AS cid FROM m5_so so " +
      'WHERE COALESCE(so.sostatus, 0) NOT IN (6, 12) AND so.sotgl >= ?' + soDateToSql +
      ' AND so.socustomer IS NOT NULL AND so.socustomer > 0 GROUP BY ym, so.socustomer',
      [prevMonthDateFrom, ...soDateToBind]
    );
    for (const r of rows) {
      const ym = String(r.ym || ''), cid = Number(r.cid || 0);
      if (!ym || !cid) continue;
      if (!soCustByMonth.has(ym)) soCustByMonth.set(ym, new Set());
      soCustByMonth.get(ym).add(cid);
      if (ym >= startYm && ym <= endYm) activeMonthsSet.add(ym);
    }
  }

  let hasMasterCustomerStatus = false, masterActiveCustomers = 0, masterInactiveCustomers = 0;
  const contactActiveCol = pickColExact(contactCols, ['kaktif', 'aktif', 'is_active', 'kstatusaktif']);
  if (hasContact && contactActiveCol && (hasSi || hasSo)) {
    try {
      const unionSql = hasSi && hasSo
        ? 'SELECT DISTINCT sicustomer AS cid FROM m5_si WHERE sicustomer > 0 UNION SELECT DISTINCT socustomer AS cid FROM m5_so WHERE socustomer > 0'
        : hasSi ? 'SELECT DISTINCT sicustomer AS cid FROM m5_si WHERE sicustomer > 0'
        : 'SELECT DISTINCT socustomer AS cid FROM m5_so WHERE socustomer > 0';
      const [mRows] = await conn.query(
        'SELECT SUM(CASE WHEN COALESCE(c.\`' + contactActiveCol + '\`, 1) <> 0 THEN 1 ELSE 0 END) AS actCnt, ' +
        'SUM(CASE WHEN COALESCE(c.\`' + contactActiveCol + '\`, 1) = 0 THEN 1 ELSE 0 END) AS inactCnt ' +
        'FROM m1_contact c INNER JOIN (' + unionSql + ') u ON u.cid = c.kid'
      );
      hasMasterCustomerStatus = true;
      masterActiveCustomers = Number(mRows[0]?.actCnt || 0);
      masterInactiveCustomers = Number(mRows[0]?.inactCnt || 0);
    } catch {}
  }

  const siDetSiFk = pickColExact(siDetCols, ['idsi', 'siid', 'idtransaksi']);
  const siDetItemFk = pickColExact(siDetCols, ['idbarang', 'barangid', 'itemid']);
  const siDetNameCol = pickColExact(siDetCols, ['namabarang', 'bnama', 'nama']);
  const siDetQtyCol = pickColExact(siDetCols, ['jml', 'qty', 'siqty', 'dqty', 'jumlah']);
  const siDetPriceCol = pickColExact(siDetCols, ['harga', 'siharga', 'hargasatuan']);
  const siDetDiscCol = pickColExact(siDetCols, ['jmldiskon', 'diskon', 'discount']);
  const siDetSubCol = pickColExact(siDetCols, ['subtotal', 'total', 'jumlahharga']);
  const siDetHppTotalCol = pickColExact(siDetCols, ['totalhpp', 'jmlhpp', 'subtotalhpp', 'sihpptotal']);
  const siDetHppUnitCol = pickColExact(siDetCols, ['hpp', 'sihpp', 'hargapokok', 'hargabeli', 'modal', 'cost', 'cogs']);
  const itemHppCol = pickColExact(itemCols, ['bhpp', 'bhargapokok', 'bhargabeli', 'bmodal', 'bhargastandar', 'bhargadasar']);

  let hppSource = 'unavailable';
  const customerProfitability = [];
  if (hasSi) {
    const custCodeExpr = hasContact ? "COALESCE(NULLIF(TRIM(c.kkode), ''), CAST(si.sicustomer AS CHAR))" : 'CAST(si.sicustomer AS CHAR)';
    const custNameExpr = hasContact ? "COALESCE(NULLIF(TRIM(c.knama), ''), CONCAT('Customer #', si.sicustomer))" : "CONCAT('Customer #', si.sicustomer)";
    const contactJoin = hasContact ? 'LEFT JOIN m1_contact c ON c.kid = si.sicustomer' : '';
    const lineNetExpr = siDetQtyCol && siDetPriceCol
      ? '(COALESCE(d.\`' + siDetQtyCol + '\`, 0) * COALESCE(d.\`' + siDetPriceCol + '\`, 0) - ' + (siDetDiscCol ? 'COALESCE(d.\`' + siDetDiscCol + '\`, 0)' : '0') + ')'
      : siDetSubCol ? 'COALESCE(d.\`' + siDetSubCol + '\`, 0)' : '0';

    const salesMap = new Map();
    const [siCustRows] = await conn.query(
      'SELECT si.sicustomer AS customerId, ' + custCodeExpr + ' AS customerCode, ' + custNameExpr + ' AS customerName, ' +
      'COUNT(DISTINCT si.siid) AS invoiceCount, COALESCE(SUM(si.sitotaltransaksi), 0) AS headerSales ' +
      'FROM m5_si si ' + contactJoin + ' WHERE COALESCE(si.sistatus, 0) NOT IN (6, 12) AND si.sitgl >= ?' + siDateToSql +
      ' AND si.sicustomer IS NOT NULL AND si.sicustomer > 0 GROUP BY si.sicustomer, customerCode, customerName',
      [effectiveDateFrom, ...siDateToBind]
    );
    for (const r of siCustRows) {
      const cid = Number(r.customerId || 0);
      if (!cid) continue;
      salesMap.set(cid, {
        customerId: cid,
        customerCode: String(r.customerCode || '-'),
        customerName: String(r.customerName || 'Customer #' + cid),
        invoiceCount: Number(r.invoiceCount || 0),
        salesAmount: Number(r.headerSales || 0),
        cogsAmount: 0,
      });
    }

    if (hasSiDet && siDetSiFk && (siDetHppTotalCol || (siDetHppUnitCol && siDetQtyCol))) {
      try {
        const hppExpr = siDetHppTotalCol
          ? 'COALESCE(d.\`' + siDetHppTotalCol + '\`, 0)'
          : 'COALESCE(d.\`' + siDetQtyCol + '\`, 0) * COALESCE(d.\`' + siDetHppUnitCol + '\`, 0)';
        const [detHppRows] = await conn.query(
          'SELECT si.sicustomer AS customerId, COALESCE(SUM(' + lineNetExpr + '), 0) AS detailSales, COALESCE(SUM(' + hppExpr + '), 0) AS detailHpp ' +
          'FROM m5_si_detail d INNER JOIN m5_si si ON si.siid = d.\`' + siDetSiFk + '\` ' +
          'WHERE COALESCE(si.sistatus, 0) NOT IN (6, 12) AND si.sitgl >= ?' + siDateToSql + ' AND si.sicustomer > 0 GROUP BY si.sicustomer',
          [effectiveDateFrom, ...siDateToBind]
        );
        let tot = 0;
        for (const r of detHppRows) tot += Number(r.detailHpp || 0);
        if (tot > 0) {
          hppSource = 'm5_si_detail';
          for (const r of detHppRows) {
            const e = salesMap.get(Number(r.customerId || 0));
            if (!e) continue;
            if (Number(r.detailSales || 0) > 0) e.salesAmount = Number(r.detailSales || 0);
            e.cogsAmount = Number(r.detailHpp || 0);
          }
        }
      } catch {}
    }

    if (hppSource === 'unavailable' && hasJournal) {
      try {
        const jDateToSql = dateTo ? ' AND j.ttgl <= ?' : '';
        const [glHppRows] = await conn.query(
          "SELECT j.tkontak AS customerId, COALESCE(SUM(COALESCE(j.tdebit, 0) - COALESCE(j.tkredit, 0)), 0) AS glCogs " +
          "FROM m2_transaction_journal j INNER JOIN m1_coa a ON a.cid = j.tcoa " +
          "WHERE COALESCE(j.tstatus, 0) NOT IN (6, 12) AND COALESCE(j.tposting, 1) = 1 AND a.cgd = 'D' AND a.ctipe = 12 AND j.ttgl >= ?" +
          jDateToSql + ' AND j.tkontak IS NOT NULL AND j.tkontak > 0 GROUP BY j.tkontak',
          [effectiveDateFrom, ...(dateTo ? [dateTo] : [])]
        );
        let matched = 0;
        for (const r of glHppRows) {
          if (salesMap.has(Number(r.customerId || 0)) && Number(r.glCogs || 0) > 0) matched += Number(r.glCogs || 0);
        }
        if (matched > 0) {
          hppSource = 'm2_transaction_journal';
          for (const r of glHppRows) {
            const e = salesMap.get(Number(r.customerId || 0));
            if (e) e.cogsAmount = Math.max(0, Number(r.glCogs || 0));
          }
        }
      } catch {}
    }

    if (hppSource === 'unavailable' && hasSiDet && hasItem && siDetSiFk && siDetItemFk && siDetQtyCol && itemHppCol) {
      try {
        const [itemHppRows] = await conn.query(
          'SELECT si.sicustomer AS customerId, COALESCE(SUM(' + lineNetExpr + '), 0) AS detailSales, ' +
          'COALESCE(SUM(COALESCE(d.\`' + siDetQtyCol + '\`, 0) * COALESCE(i.\`' + itemHppCol + '\`, 0)), 0) AS itemHpp ' +
          'FROM m5_si_detail d INNER JOIN m5_si si ON si.siid = d.\`' + siDetSiFk + '\` LEFT JOIN m1_item i ON i.bid = d.\`' + siDetItemFk + '\` ' +
          'WHERE COALESCE(si.sistatus, 0) NOT IN (6, 12) AND si.sitgl >= ?' + siDateToSql + ' AND si.sicustomer > 0 GROUP BY si.sicustomer',
          [effectiveDateFrom, ...siDateToBind]
        );
        let tot = 0;
        for (const r of itemHppRows) tot += Number(r.itemHpp || 0);
        if (tot > 0) {
          hppSource = 'm1_item';
          for (const r of itemHppRows) {
            const e = salesMap.get(Number(r.customerId || 0));
            if (!e) continue;
            if (Number(r.detailSales || 0) > 0) e.salesAmount = Number(r.detailSales || 0);
            e.cogsAmount = Number(r.itemHpp || 0);
          }
        }
      } catch {}
    }

    for (const e of salesMap.values()) {
      const profitAmount = e.salesAmount - e.cogsAmount;
      customerProfitability.push({
        ...e,
        profitAmount,
        marginPct: e.salesAmount > 0 ? (profitAmount / e.salesAmount) * 100 : 0,
      });
    }
    customerProfitability.sort((a, b) => b.profitAmount - a.profitAmount);
  }

  const soMonthlyMap = new Map();
  const soCloseCol = pickColExact(soCols, ['soisclose', 'isclose']);
  if (hasSo) {
    const closeCond = soCloseCol ? ' OR COALESCE(so.\`' + soCloseCol + '\`, 0) = 1' : '';
    const [rows] = await conn.query(
      "SELECT DATE_FORMAT(so.sotgl, '%Y-%m') AS ym, COUNT(*) AS soCount, COALESCE(SUM(COALESCE(so.sototaltransaksi, 0)), 0) AS soTotalValue, " +
      'SUM(CASE WHEN COALESCE(so.sostatus, 0) = 4 THEN 1 ELSE 0 END) AS soCompleteCount, ' +
      'SUM(CASE WHEN COALESCE(so.sostatus, 0) IN (4, 7)' + closeCond + ' THEN 1 ELSE 0 END) AS soCompleteOrCloseCount, ' +
      'COALESCE(SUM(CASE WHEN COALESCE(so.sostatus, 0) = 4 THEN COALESCE(so.sototaltransaksi, 0) ELSE 0 END), 0) AS soCompleteValue, ' +
      'COALESCE(SUM(CASE WHEN COALESCE(so.sostatus, 0) IN (4, 7)' + closeCond + ' THEN COALESCE(so.sototaltransaksi, 0) ELSE 0 END), 0) AS soCompleteOrCloseValue ' +
      'FROM m5_so so WHERE COALESCE(so.sostatus, 0) NOT IN (6, 12) AND so.sotgl >= ?' + soDateToSql + ' GROUP BY ym',
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

  const soDetSoFk = pickColExact(soDetCols, ['idso', 'soid', 'idtransaksi']);
  const soDetItemFk = pickColExact(soDetCols, ['idbarang', 'barangid', 'itemid']);
  const soDetQtyCol = pickColExact(soDetCols, ['jml', 'qty', 'soqty', 'dqty', 'jumlah']);
  const soDetPriceCol = pickColExact(soDetCols, ['harga', 'soharga', 'hargasatuan']);
  const soDetDiscCol = pickColExact(soDetCols, ['jmldiskon', 'diskon', 'discount']);
  const soDetSubCol = pickColExact(soDetCols, ['subtotal', 'total', 'jumlahharga']);
  const soDetRealizedCol = pickColExact(soDetCols, ['jmlrealisasi', 'jmldo', 'jmlkirim', 'qtydo', 'qtykirim', 'jmlterkirim']);

  const doDetDoFk = pickColExact(doDetCols, ['iddo', 'doid', 'idtransaksi']);
  const doDetSoFk = pickColExact(doDetCols, ['idso', 'soid', 'dosoid', 'idref']);
  const doDetItemFk = pickColExact(doDetCols, ['idbarang', 'barangid', 'itemid']);
  const doDetNameCol = pickColExact(doDetCols, ['namabarang', 'bnama', 'nama']);
  const doDetQtyCol = pickColExact(doDetCols, ['jml', 'qty', 'doqty', 'dqty', 'jumlah']);
  const doDetPriceCol = pickColExact(doDetCols, ['harga', 'doharga', 'hargasatuan']);
  const doDetDiscCol = pickColExact(doDetCols, ['jmldiskon', 'diskon', 'discount']);
  const doDetSubCol = pickColExact(doDetCols, ['subtotal', 'total', 'jumlahharga']);

  const siDetSoFk = pickColExact(siDetCols, ['idso', 'soid', 'sisoid']);
  const siDetDoFk = pickColExact(siDetCols, ['iddo', 'doid', 'sidoid', 'diddo']);

  let realizationSource = 'm5_so_status';
  const soRealizationByMonth = new Map();
  if (hasSo && hasSoDet && soDetSoFk && soDetQtyCol) {
    const soLineValExpr = soDetPriceCol
      ? '(COALESCE(sd.\`' + soDetQtyCol + '\`, 0) * COALESCE(sd.\`' + soDetPriceCol + '\`, 0) - ' + (soDetDiscCol ? 'COALESCE(sd.\`' + soDetDiscCol + '\`, 0)' : '0') + ')'
      : soDetSubCol ? 'COALESCE(sd.\`' + soDetSubCol + '\`, 0)' : '0';

    if (hasDo && hasDoDet && doDetDoFk && doDetSoFk && doDetQtyCol) {
      realizationSource = 'm5_do_detail';
      const doLineValExpr = doDetPriceCol
        ? '(COALESCE(dd.\`' + doDetQtyCol + '\`, 0) * COALESCE(dd.\`' + doDetPriceCol + '\`, 0) - ' + (doDetDiscCol ? 'COALESCE(dd.\`' + doDetDiscCol + '\`, 0)' : '0') + ')'
        : doDetSubCol ? 'COALESCE(dd.\`' + doDetSubCol + '\`, 0)' : '0';
      const [rows] = await conn.query(
        "SELECT DATE_FORMAT(so.sotgl, '%Y-%m') AS ym, COALESCE(so.sototaltransaksi, 0) AS soHeaderVal, " +
        'COALESCE(sq.soQty, 0) AS soQty, COALESCE(sq.soLineVal, 0) AS soLineVal, COALESCE(dq.doQty, 0) AS doQty, COALESCE(dq.doLineVal, 0) AS doLineVal ' +
        'FROM m5_so so ' +
        'LEFT JOIN (SELECT \`' + soDetSoFk + '\` AS soid, COALESCE(SUM(COALESCE(\`' + soDetQtyCol + '\`, 0)), 0) AS soQty, COALESCE(SUM(' + soLineValExpr + '), 0) AS soLineVal FROM m5_so_detail sd GROUP BY \`' + soDetSoFk + '\`) sq ON sq.soid = so.soid ' +
        'LEFT JOIN (SELECT dd.\`' + doDetSoFk + '\` AS soid, COALESCE(SUM(COALESCE(dd.\`' + doDetQtyCol + '\`, 0)), 0) AS doQty, COALESCE(SUM(' + doLineValExpr + '), 0) AS doLineVal FROM m5_do_detail dd INNER JOIN m5_do d ON d.doid = dd.\`' + doDetDoFk + '\` WHERE COALESCE(d.dostatus, 0) NOT IN (6, 12) GROUP BY dd.\`' + doDetSoFk + '\`) dq ON dq.soid = so.soid ' +
        'WHERE COALESCE(so.sostatus, 0) NOT IN (6, 12) AND so.sotgl >= ?' + soDateToSql,
        [effectiveDateFrom, ...soDateToBind]
      );
      for (const r of rows) {
        const ym = String(r.ym || '');
        if (!ym) continue;
        const soQty = Math.max(0, Number(r.soQty || 0));
        const doQty = Math.max(0, Number(r.doQty || 0));
        const realQty = soQty > 0 ? Math.min(soQty, doQty) : doQty;
        const soVal = Math.max(0, Number(r.soHeaderVal || 0) > 0 ? Number(r.soHeaderVal) : Number(r.soLineVal || 0));
        const rawDoVal = Math.max(0, Number(r.doLineVal || 0));
        const realVal = rawDoVal > 0 ? Math.min(soVal, rawDoVal) : soQty > 0 ? Math.min(soVal, (realQty / soQty) * soVal) : 0;
        const cur = soRealizationByMonth.get(ym) || { soItemQty: 0, realizedItemQty: 0, soTotalValue: 0, realizedTotalValue: 0 };
        cur.soItemQty += soQty; cur.realizedItemQty += realQty; cur.soTotalValue += soVal; cur.realizedTotalValue += realVal;
        soRealizationByMonth.set(ym, cur);
        activeMonthsSet.add(ym);
      }
    } else if (hasSi && hasSiDet && siDetSiFk && siDetSoFk && siDetQtyCol) {
      realizationSource = 'm5_si_detail';
      const siLineValExpr = siDetPriceCol
        ? '(COALESCE(sd2.\`' + siDetQtyCol + '\`, 0) * COALESCE(sd2.\`' + siDetPriceCol + '\`, 0) - ' + (siDetDiscCol ? 'COALESCE(sd2.\`' + siDetDiscCol + '\`, 0)' : '0') + ')'
        : siDetSubCol ? 'COALESCE(sd2.\`' + siDetSubCol + '\`, 0)' : '0';
      const [rows] = await conn.query(
        "SELECT DATE_FORMAT(so.sotgl, '%Y-%m') AS ym, COALESCE(so.sototaltransaksi, 0) AS soHeaderVal, " +
        'COALESCE(sq.soQty, 0) AS soQty, COALESCE(sq.soLineVal, 0) AS soLineVal, COALESCE(iq.siQty, 0) AS siQty, COALESCE(iq.siLineVal, 0) AS siLineVal ' +
        'FROM m5_so so ' +
        'LEFT JOIN (SELECT \`' + soDetSoFk + '\` AS soid, COALESCE(SUM(COALESCE(\`' + soDetQtyCol + '\`, 0)), 0) AS soQty, COALESCE(SUM(' + soLineValExpr + '), 0) AS soLineVal FROM m5_so_detail sd GROUP BY \`' + soDetSoFk + '\`) sq ON sq.soid = so.soid ' +
        'LEFT JOIN (SELECT sd2.\`' + siDetSoFk + '\` AS soid, COALESCE(SUM(COALESCE(sd2.\`' + siDetQtyCol + '\`, 0)), 0) AS siQty, COALESCE(SUM(' + siLineValExpr + '), 0) AS siLineVal FROM m5_si_detail sd2 INNER JOIN m5_si si ON si.siid = sd2.\`' + siDetSiFk + '\` WHERE COALESCE(si.sistatus, 0) NOT IN (6, 12) GROUP BY sd2.\`' + siDetSoFk + '\`) iq ON iq.soid = so.soid ' +
        'WHERE COALESCE(so.sostatus, 0) NOT IN (6, 12) AND so.sotgl >= ?' + soDateToSql,
        [effectiveDateFrom, ...soDateToBind]
      );
      for (const r of rows) {
        const ym = String(r.ym || '');
        if (!ym) continue;
        const soQty = Math.max(0, Number(r.soQty || 0));
        const siQty = Math.max(0, Number(r.siQty || 0));
        const realQty = soQty > 0 ? Math.min(soQty, siQty) : siQty;
        const soVal = Math.max(0, Number(r.soHeaderVal || 0) > 0 ? Number(r.soHeaderVal) : Number(r.soLineVal || 0));
        const rawSiVal = Math.max(0, Number(r.siLineVal || 0));
        const realVal = rawSiVal > 0 ? Math.min(soVal, rawSiVal) : soQty > 0 ? Math.min(soVal, (realQty / soQty) * soVal) : 0;
        const cur = soRealizationByMonth.get(ym) || { soItemQty: 0, realizedItemQty: 0, soTotalValue: 0, realizedTotalValue: 0 };
        cur.soItemQty += soQty; cur.realizedItemQty += realQty; cur.soTotalValue += soVal; cur.realizedTotalValue += realVal;
        soRealizationByMonth.set(ym, cur);
        activeMonthsSet.add(ym);
      }
    } else if (soDetRealizedCol) {
      realizationSource = 'm5_so_detail';
      const [rows] = await conn.query(
        "SELECT DATE_FORMAT(so.sotgl, '%Y-%m') AS ym, COALESCE(SUM(COALESCE(sd.\`" + soDetQtyCol + "\`, 0)), 0) AS soQty, " +
        'COALESCE(SUM(LEAST(COALESCE(sd.\`' + soDetQtyCol + '\`, 0), COALESCE(sd.\`' + soDetRealizedCol + '\`, 0))), 0) AS realQty, ' +
        'COALESCE(SUM(' + soLineValExpr + '), 0) AS soVal FROM m5_so_detail sd INNER JOIN m5_so so ON so.soid = sd.\`' + soDetSoFk + '\` ' +
        'WHERE COALESCE(so.sostatus, 0) NOT IN (6, 12) AND so.sotgl >= ?' + soDateToSql + ' GROUP BY ym',
        [effectiveDateFrom, ...soDateToBind]
      );
      for (const r of rows) {
        const ym = String(r.ym || '');
        if (!ym) continue;
        const soQty = Math.max(0, Number(r.soQty || 0)), realQty = Math.max(0, Number(r.realQty || 0)), soVal = Math.max(0, Number(r.soVal || 0));
        soRealizationByMonth.set(ym, { soItemQty: soQty, realizedItemQty: realQty, soTotalValue: soVal, realizedTotalValue: soQty > 0 ? (realQty / soQty) * soVal : 0 });
        activeMonthsSet.add(ym);
      }
    }
  }

  const cpiDetailsByMonth = {};
  const cpiSummaryByMonth = new Map();
  if (hasSi && hasSiDet && siDetSiFk && siDetItemFk && siDetPriceCol) {
    try {
      const iCode = hasItem ? "COALESCE(NULLIF(TRIM(i.bkode), ''), CAST(d.\`" + siDetItemFk + "\` AS CHAR))" : 'CAST(d.\`' + siDetItemFk + '\` AS CHAR)';
      const iName = hasItem
        ? siDetNameCol ? "COALESCE(NULLIF(TRIM(d.\`" + siDetNameCol + "\`), ''), NULLIF(TRIM(i.bnama), ''), CONCAT('Barang #', d.\`" + siDetItemFk + "\`))" : "COALESCE(NULLIF(TRIM(i.bnama), ''), CONCAT('Barang #', d.\`" + siDetItemFk + "\`))"
        : siDetNameCol ? "COALESCE(NULLIF(TRIM(d.\`" + siDetNameCol + "\`), ''), CONCAT('Barang #', d.\`" + siDetItemFk + "\`))" : "CONCAT('Barang #', d.\`" + siDetItemFk + "\`)";
      const [priceRows] = await conn.query(
        "SELECT DATE_FORMAT(si.sitgl, '%Y-%m') AS ym, d.\`" + siDetItemFk + "\` AS itemId, MAX(" + iCode + ") AS itemCode, MAX(" + iName + ") AS itemName, " +
        "SUBSTRING_INDEX(GROUP_CONCAT(d.\`" + siDetPriceCol + "\` ORDER BY si.sitgl DESC, si.siid DESC SEPARATOR ','), ',', 1) AS lastPrice " +
        'FROM m5_si_detail d INNER JOIN m5_si si ON si.siid = d.\`' + siDetSiFk + '\` ' + (hasItem ? 'LEFT JOIN m1_item i ON i.bid = d.\`' + siDetItemFk + '\` ' : '') +
        'WHERE COALESCE(si.sistatus, 0) NOT IN (6, 12) AND si.sitgl >= ?' + siDateToSql + ' AND COALESCE(d.\`' + siDetPriceCol + '\`, 0) > 0 AND d.\`' + siDetItemFk + '\` > 0 GROUP BY ym, d.\`' + siDetItemFk + '\`',
        [prevMonthDateFrom, ...siDateToBind]
      );
      const priceByMonthItem = new Map();
      for (const r of priceRows) {
        const ym = String(r.ym || ''), itemId = Number(r.itemId || 0), price = Number(r.lastPrice || 0);
        if (!ym || !itemId || price <= 0) continue;
        if (!priceByMonthItem.has(ym)) priceByMonthItem.set(ym, new Map());
        priceByMonthItem.get(ym).set(itemId, { itemId, itemCode: String(r.itemCode || itemId), itemName: String(r.itemName || 'Barang #' + itemId), price });
      }
      const allPriceMonths = Array.from(priceByMonthItem.keys()).sort();
      const lastKnownPrice = new Map();
      for (const ym of allPriceMonths) {
        const currMap = priceByMonthItem.get(ym);
        if (ym >= startYm && ym <= endYm) {
          const prevMap = priceByMonthItem.get(shiftMonthYm(ym, -1));
          const details = [];
          let sumPrev = 0, sumCurr = 0;
          for (const [itemId, curr] of currMap.entries()) {
            const prevPrice = (prevMap && prevMap.get(itemId)?.price) || lastKnownPrice.get(itemId) || 0;
            if (prevPrice > 0) {
              const varianceRp = curr.price - prevPrice;
              details.push({ itemId, itemCode: curr.itemCode, itemName: curr.itemName, prevPrice, currPrice: curr.price, varianceRp, variancePct: (varianceRp / prevPrice) * 100 });
              sumPrev += prevPrice; sumCurr += curr.price;
            }
          }
          details.sort((a, b) => Math.abs(b.variancePct) - Math.abs(a.variancePct));
          cpiDetailsByMonth[ym] = details;
          cpiSummaryByMonth.set(ym, { prevBasket: sumPrev, currBasket: sumCurr, pct: sumPrev > 0 ? ((sumCurr - sumPrev) / sumPrev) * 100 : 0, itemCount: details.length });
        }
        for (const [itemId, curr] of currMap.entries()) lastKnownPrice.set(itemId, curr.price);
      }
    } catch {}
  }

  const soShipDateCol = pickColExact(soCols, ['sotglkirim', 'tglkirim', 'sotgltarget']);
  const doShipDateCol = pickColExact(doCols, ['dotglkirim', 'tglkirim']);
  const dotSource = soShipDateCol ? 'so_sotglkirim' : hasSo ? 'so_sotgl' : 'do_vs_si';
  const soTargetExpr = soShipDateCol ? "COALESCE(NULLIF(so.\`" + soShipDateCol + "\`, '0000-00-00'), so.sotgl)" : 'so.sotgl';
  const dotByMonth = new Map();

  if (hasSi) {
    let siSoJoinSql = '', hasSiTarget = false;
    if (hasSo && hasSiDet && siDetSiFk && siDetSoFk) {
      hasSiTarget = true;
      siSoJoinSql = 'LEFT JOIN (SELECT sd.\`' + siDetSiFk + '\` AS siid, MAX(' + soTargetExpr + ') AS targetDate FROM m5_si_detail sd INNER JOIN m5_so so ON so.soid = sd.\`' + siDetSoFk + '\` WHERE COALESCE(so.sostatus, 0) NOT IN (6, 12) GROUP BY sd.\`' + siDetSiFk + '\`) tgt ON tgt.siid = si.siid';
    } else if (hasSo && hasSiDet && hasDo && hasDoDet && siDetSiFk && siDetDoFk && doDetDoFk && doDetSoFk) {
      hasSiTarget = true;
      siSoJoinSql = 'LEFT JOIN (SELECT sd.\`' + siDetSiFk + '\` AS siid, MAX(' + soTargetExpr + ') AS targetDate FROM m5_si_detail sd INNER JOIN m5_do_detail dd ON dd.\`' + doDetDoFk + '\` = sd.\`' + siDetDoFk + '\` INNER JOIN m5_so so ON so.soid = dd.\`' + doDetSoFk + '\` WHERE COALESCE(so.sostatus, 0) NOT IN (6, 12) GROUP BY sd.\`' + siDetSiFk + '\`) tgt ON tgt.siid = si.siid';
    }
    const [rows] = await conn.query(
      "SELECT DATE_FORMAT(si.sitgl, '%Y-%m') AS ym, COUNT(*) AS ivTotal, " +
      (hasSiTarget
        ? 'SUM(CASE WHEN tgt.targetDate IS NOT NULL THEN 1 ELSE 0 END) AS ivLinked, SUM(CASE WHEN tgt.targetDate IS NOT NULL AND si.sitgl <= tgt.targetDate THEN 1 ELSE 0 END) AS ivLinkedOnTime, SUM(CASE WHEN tgt.targetDate IS NULL OR si.sitgl <= tgt.targetDate THEN 1 ELSE 0 END) AS ivOnTime '
        : '0 AS ivLinked, 0 AS ivLinkedOnTime, COUNT(*) AS ivOnTime ') +
      'FROM m5_si si ' + siSoJoinSql + ' WHERE COALESCE(si.sistatus, 0) NOT IN (6, 12) AND si.sitgl >= ?' + siDateToSql + ' GROUP BY ym',
      [effectiveDateFrom, ...siDateToBind]
    );
    for (const r of rows) {
      const ym = String(r.ym || ''); if (!ym) continue;
      const cur = dotByMonth.get(ym) || { ivTotal: 0, ivOnTime: 0, ivLinked: 0, ivLinkedOnTime: 0, doTotal: 0, doOnTime: 0, doLinked: 0, doLinkedOnTime: 0 };
      cur.ivTotal = Number(r.ivTotal || 0); cur.ivOnTime = Number(r.ivOnTime || 0); cur.ivLinked = Number(r.ivLinked || 0); cur.ivLinkedOnTime = Number(r.ivLinkedOnTime || 0);
      dotByMonth.set(ym, cur); activeMonthsSet.add(ym);
    }
  }

  if (hasDo) {
    const doActualDateExpr = doShipDateCol ? "COALESCE(NULLIF(d.\`" + doShipDateCol + "\`, '0000-00-00'), d.dotgl)" : 'd.dotgl';
    const hasDoTarget = Boolean(hasSo && hasDoDet && doDetDoFk && doDetSoFk);
    const doSoJoinSql = hasDoTarget
      ? 'LEFT JOIN (SELECT dd.\`' + doDetDoFk + '\` AS doid, MAX(' + soTargetExpr + ') AS targetDate FROM m5_do_detail dd INNER JOIN m5_so so ON so.soid = dd.\`' + doDetSoFk + '\` WHERE COALESCE(so.sostatus, 0) NOT IN (6, 12) GROUP BY dd.\`' + doDetDoFk + '\`) tgt ON tgt.doid = d.doid'
      : '';
    const [rows] = await conn.query(
      "SELECT DATE_FORMAT(d.dotgl, '%Y-%m') AS ym, COUNT(*) AS doTotal, " +
      (hasDoTarget
        ? 'SUM(CASE WHEN tgt.targetDate IS NOT NULL THEN 1 ELSE 0 END) AS doLinked, SUM(CASE WHEN tgt.targetDate IS NOT NULL AND ' + doActualDateExpr + ' <= tgt.targetDate THEN 1 ELSE 0 END) AS doLinkedOnTime, SUM(CASE WHEN tgt.targetDate IS NULL OR ' + doActualDateExpr + ' <= tgt.targetDate THEN 1 ELSE 0 END) AS doOnTime '
        : '0 AS doLinked, 0 AS doLinkedOnTime, COUNT(*) AS doOnTime ') +
      'FROM m5_do d ' + doSoJoinSql + ' WHERE COALESCE(d.dostatus, 0) NOT IN (6, 12) AND d.dotgl >= ?' + doDateToSql + ' GROUP BY ym',
      [effectiveDateFrom, ...doDateToBind]
    );
    for (const r of rows) {
      const ym = String(r.ym || ''); if (!ym) continue;
      const cur = dotByMonth.get(ym) || { ivTotal: 0, ivOnTime: 0, ivLinked: 0, ivLinkedOnTime: 0, doTotal: 0, doOnTime: 0, doLinked: 0, doLinkedOnTime: 0 };
      cur.doTotal = Number(r.doTotal || 0); cur.doOnTime = Number(r.doOnTime || 0); cur.doLinked = Number(r.doLinked || 0); cur.doLinkedOnTime = Number(r.doLinkedOnTime || 0);
      dotByMonth.set(ym, cur); activeMonthsSet.add(ym);
    }
  }

  const srDetSrFk = pickColExact(srDetCols, ['idsr', 'srid', 'idtransaksi']);
  const srDetItemFk = pickColExact(srDetCols, ['idbarang', 'barangid', 'itemid']);
  const srDetNameCol = pickColExact(srDetCols, ['namabarang', 'bnama', 'nama']);
  const srDetQtyCol = pickColExact(srDetCols, ['jml', 'qty', 'srqty', 'dqty', 'jumlah']);
  const returnDocByMonth = new Map();
  const soldValueByMonth = new Map();
  if (hasSr) {
    const [rows] = await conn.query(
      "SELECT DATE_FORMAT(sr.srtgl, '%Y-%m') AS ym, COUNT(*) AS cnt, COALESCE(SUM(COALESCE(sr.srtotaltransaksi, 0)), 0) AS val FROM m5_sr sr WHERE COALESCE(sr.srstatus, 0) NOT IN (6, 12) AND sr.srtgl >= ?" + srDateToSql + ' GROUP BY ym',
      [effectiveDateFrom, ...srDateToBind]
    );
    for (const r of rows) {
      const ym = String(r.ym || ''); if (!ym) continue;
      returnDocByMonth.set(ym, { count: Number(r.cnt || 0), value: Number(r.val || 0) });
      activeMonthsSet.add(ym);
    }
  }
  if (hasSi) {
    const [rows] = await conn.query(
      "SELECT DATE_FORMAT(si.sitgl, '%Y-%m') AS ym, COALESCE(SUM(COALESCE(si.sitotaltransaksi, 0)), 0) AS val FROM m5_si si WHERE COALESCE(si.sistatus, 0) NOT IN (6, 12) AND si.sitgl >= ?" + siDateToSql + ' GROUP BY ym',
      [effectiveDateFrom, ...siDateToBind]
    );
    for (const r of rows) { if (r.ym) soldValueByMonth.set(String(r.ym), Number(r.val || 0)); }
  }

  const itemStatsByMonth = new Map();
  const ensureItemStat = (ym, itemId, code, name) => {
    if (!itemStatsByMonth.has(ym)) itemStatsByMonth.set(ym, new Map());
    const m = itemStatsByMonth.get(ym);
    let cur = m.get(itemId);
    if (!cur) {
      cur = { itemId, itemCode: code || String(itemId), itemName: name || 'Barang #' + itemId, soldQty: 0, returnQty: 0, deliveredQty: 0, varianceQty: 0 };
      m.set(itemId, cur);
    } else {
      if ((!cur.itemCode || cur.itemCode === String(itemId)) && code) cur.itemCode = code;
      if ((!cur.itemName || cur.itemName.startsWith('Barang #')) && name) cur.itemName = name;
    }
    return cur;
  };

  if (hasSi && hasSiDet && siDetSiFk && siDetItemFk && siDetQtyCol) {
    const iCode = hasItem ? "COALESCE(NULLIF(TRIM(i.bkode), ''), CAST(d.\`" + siDetItemFk + "\` AS CHAR))" : 'CAST(d.\`' + siDetItemFk + '\` AS CHAR)';
    const iName = hasItem ? (siDetNameCol ? "COALESCE(NULLIF(TRIM(d.\`" + siDetNameCol + "\`), ''), NULLIF(TRIM(i.bnama), ''), CONCAT('Barang #', d.\`" + siDetItemFk + "\`))" : "COALESCE(NULLIF(TRIM(i.bnama), ''), CONCAT('Barang #', d.\`" + siDetItemFk + "\`))") : (siDetNameCol ? "COALESCE(NULLIF(TRIM(d.\`" + siDetNameCol + "\`), ''), CONCAT('Barang #', d.\`" + siDetItemFk + "\`))" : "CONCAT('Barang #', d.\`" + siDetItemFk + "\`)");
    const [rows] = await conn.query(
      "SELECT DATE_FORMAT(si.sitgl, '%Y-%m') AS ym, d.\`" + siDetItemFk + "\` AS itemId, MAX(" + iCode + ") AS itemCode, MAX(" + iName + ") AS itemName, COALESCE(SUM(COALESCE(d.\`" + siDetQtyCol + "\`, 0)), 0) AS qty " +
      'FROM m5_si_detail d INNER JOIN m5_si si ON si.siid = d.\`' + siDetSiFk + '\` ' + (hasItem ? 'LEFT JOIN m1_item i ON i.bid = d.\`' + siDetItemFk + '\` ' : '') +
      'WHERE COALESCE(si.sistatus, 0) NOT IN (6, 12) AND si.sitgl >= ?' + siDateToSql + ' AND d.\`' + siDetItemFk + '\` > 0 GROUP BY ym, d.\`' + siDetItemFk + '\`',
      [effectiveDateFrom, ...siDateToBind]
    );
    for (const r of rows) {
      const ym = String(r.ym || ''), itemId = Number(r.itemId || 0); if (!ym || !itemId) continue;
      ensureItemStat(ym, itemId, String(r.itemCode || ''), String(r.itemName || '')).soldQty += Math.max(0, Number(r.qty || 0));
      activeMonthsSet.add(ym);
    }
  }

  if (hasSr && hasSrDet && srDetSrFk && srDetItemFk && srDetQtyCol) {
    const iCode = hasItem ? "COALESCE(NULLIF(TRIM(i.bkode), ''), CAST(d.\`" + srDetItemFk + "\` AS CHAR))" : 'CAST(d.\`' + srDetItemFk + '\` AS CHAR)';
    const iName = hasItem ? (srDetNameCol ? "COALESCE(NULLIF(TRIM(d.\`" + srDetNameCol + "\`), ''), NULLIF(TRIM(i.bnama), ''), CONCAT('Barang #', d.\`" + srDetItemFk + "\`))" : "COALESCE(NULLIF(TRIM(i.bnama), ''), CONCAT('Barang #', d.\`" + srDetItemFk + "\`))") : (srDetNameCol ? "COALESCE(NULLIF(TRIM(d.\`" + srDetNameCol + "\`), ''), CONCAT('Barang #', d.\`" + srDetItemFk + "\`))" : "CONCAT('Barang #', d.\`" + srDetItemFk + "\`)");
    const [rows] = await conn.query(
      "SELECT DATE_FORMAT(sr.srtgl, '%Y-%m') AS ym, d.\`" + srDetItemFk + "\` AS itemId, MAX(" + iCode + ") AS itemCode, MAX(" + iName + ") AS itemName, COALESCE(SUM(COALESCE(d.\`" + srDetQtyCol + "\`, 0)), 0) AS qty " +
      'FROM m5_sr_detail d INNER JOIN m5_sr sr ON sr.srid = d.\`' + srDetSrFk + '\` ' + (hasItem ? 'LEFT JOIN m1_item i ON i.bid = d.\`' + srDetItemFk + '\` ' : '') +
      'WHERE COALESCE(sr.srstatus, 0) NOT IN (6, 12) AND sr.srtgl >= ?' + srDateToSql + ' AND d.\`' + srDetItemFk + '\` > 0 GROUP BY ym, d.\`' + srDetItemFk + '\`',
      [effectiveDateFrom, ...srDateToBind]
    );
    for (const r of rows) {
      const ym = String(r.ym || ''), itemId = Number(r.itemId || 0); if (!ym || !itemId) continue;
      ensureItemStat(ym, itemId, String(r.itemCode || ''), String(r.itemName || '')).returnQty += Math.max(0, Number(r.qty || 0));
      activeMonthsSet.add(ym);
    }
  }

  if (hasDo && hasDoDet && doDetDoFk && doDetItemFk && doDetQtyCol) {
    const iCode = hasItem ? "COALESCE(NULLIF(TRIM(i.bkode), ''), CAST(dd.\`" + doDetItemFk + "\` AS CHAR))" : 'CAST(dd.\`' + doDetItemFk + '\` AS CHAR)';
    const iName = hasItem ? (doDetNameCol ? "COALESCE(NULLIF(TRIM(dd.\`" + doDetNameCol + "\`), ''), NULLIF(TRIM(i.bnama), ''), CONCAT('Barang #', dd.\`" + doDetItemFk + "\`))" : "COALESCE(NULLIF(TRIM(i.bnama), ''), CONCAT('Barang #', dd.\`" + doDetItemFk + "\`))") : (doDetNameCol ? "COALESCE(NULLIF(TRIM(dd.\`" + doDetNameCol + "\`), ''), CONCAT('Barang #', dd.\`" + doDetItemFk + "\`))" : "CONCAT('Barang #', dd.\`" + doDetItemFk + "\`)");
    const [rows] = await conn.query(
      "SELECT DATE_FORMAT(d.dotgl, '%Y-%m') AS ym, dd.\`" + doDetItemFk + "\` AS itemId, MAX(" + iCode + ") AS itemCode, MAX(" + iName + ") AS itemName, COALESCE(SUM(COALESCE(dd.\`" + doDetQtyCol + "\`, 0)), 0) AS qty " +
      'FROM m5_do_detail dd INNER JOIN m5_do d ON d.doid = dd.\`' + doDetDoFk + '\` ' + (hasItem ? 'LEFT JOIN m1_item i ON i.bid = dd.\`' + doDetItemFk + '\` ' : '') +
      'WHERE COALESCE(d.dostatus, 0) NOT IN (6, 12) AND d.dotgl >= ?' + doDateToSql + ' AND dd.\`' + doDetItemFk + '\` > 0 GROUP BY ym, dd.\`' + doDetItemFk + '\`',
      [effectiveDateFrom, ...doDateToBind]
    );
    for (const r of rows) {
      const ym = String(r.ym || ''), itemId = Number(r.itemId || 0); if (!ym || !itemId) continue;
      ensureItemStat(ym, itemId, String(r.itemCode || ''), String(r.itemName || '')).deliveredQty += Math.max(0, Number(r.qty || 0));
      activeMonthsSet.add(ym);
    }
    if (hasSo && hasSoDet && soDetSoFk && soDetItemFk && soDetQtyCol && doDetSoFk) {
      try {
        const [varRows] = await conn.query(
          "SELECT DATE_FORMAT(d.dotgl, '%Y-%m') AS ym, dd.\`" + doDetItemFk + "\` AS itemId, COALESCE(SUM(COALESCE(dd.\`" + doDetQtyCol + "\`, 0)), 0) AS doQty, COALESCE(MAX(sq.soQty), 0) AS soQty " +
          'FROM m5_do_detail dd INNER JOIN m5_do d ON d.doid = dd.\`' + doDetDoFk + '\` ' +
          'LEFT JOIN (SELECT \`' + soDetSoFk + '\` AS soid, \`' + soDetItemFk + '\` AS itemId, COALESCE(SUM(COALESCE(\`' + soDetQtyCol + '\`, 0)), 0) AS soQty FROM m5_so_detail GROUP BY \`' + soDetSoFk + '\`, \`' + soDetItemFk + '\`) sq ON sq.soid = dd.\`' + doDetSoFk + '\` AND sq.itemId = dd.\`' + doDetItemFk + '\` ' +
          'WHERE COALESCE(d.dostatus, 0) NOT IN (6, 12) AND d.dotgl >= ?' + doDateToSql + ' AND dd.\`' + doDetSoFk + '\` > 0 AND dd.\`' + doDetItemFk + '\` > 0 GROUP BY ym, dd.\`' + doDetSoFk + '\`, dd.\`' + doDetItemFk + '\`',
          [effectiveDateFrom, ...doDateToBind]
        );
        for (const r of varRows) {
          const ym = String(r.ym || ''), itemId = Number(r.itemId || 0); if (!ym || !itemId) continue;
          const diff = Math.abs(Math.max(0, Number(r.doQty || 0)) - Math.max(0, Number(r.soQty || 0)));
          if (diff > 0) ensureItemStat(ym, itemId, '', '').varianceQty += diff;
        }
      } catch {}
    }
  }

  const deliveryLeadTime = [];
  if (hasDo && hasDoDet && doDetDoFk && doDetItemFk) {
    try {
      const doActualExpr = doShipDateCol ? "COALESCE(NULLIF(d.\`" + doShipDateCol + "\`, '0000-00-00'), d.dotgl)" : 'd.dotgl';
      const hasSoLink = Boolean(hasSo && doDetSoFk);
      const leadExpr = hasSoLink ? 'GREATEST(0, DATEDIFF(' + doActualExpr + ', COALESCE(so.sotgl, d.dotgl)))' : 'GREATEST(0, DATEDIFF(' + doActualExpr + ', d.dotgl))';
      const iCode = hasItem ? "COALESCE(NULLIF(TRIM(i.bkode), ''), CAST(dd.\`" + doDetItemFk + "\` AS CHAR))" : 'CAST(dd.\`' + doDetItemFk + '\` AS CHAR)';
      const iName = hasItem ? (doDetNameCol ? "COALESCE(NULLIF(TRIM(dd.\`" + doDetNameCol + "\`), ''), NULLIF(TRIM(i.bnama), ''), CONCAT('Barang #', dd.\`" + doDetItemFk + "\`))" : "COALESCE(NULLIF(TRIM(i.bnama), ''), CONCAT('Barang #', dd.\`" + doDetItemFk + "\`))") : (doDetNameCol ? "COALESCE(NULLIF(TRIM(dd.\`" + doDetNameCol + "\`), ''), CONCAT('Barang #', dd.\`" + doDetItemFk + "\`))" : "CONCAT('Barang #', dd.\`" + doDetItemFk + "\`)");
      const [ltRows] = await conn.query(
        'SELECT dd.\`' + doDetItemFk + '\` AS itemId, MAX(' + iCode + ') AS itemCode, MAX(' + iName + ') AS itemName, LEAST(15, ' + leadExpr + ') AS bucketIdx, COUNT(DISTINCT d.doid) AS deliveryCount, SUM(' + leadExpr + ') AS sumLeadDays ' +
        'FROM m5_do_detail dd INNER JOIN m5_do d ON d.doid = dd.\`' + doDetDoFk + '\` ' +
        (hasSoLink ? 'LEFT JOIN m5_so so ON so.soid = dd.\`' + doDetSoFk + '\` ' : '') +
        (hasItem ? 'LEFT JOIN m1_item i ON i.bid = dd.\`' + doDetItemFk + '\` ' : '') +
        'WHERE COALESCE(d.dostatus, 0) NOT IN (6, 12) AND d.dotgl >= ?' + doDateToSql + ' AND dd.\`' + doDetItemFk + '\` > 0 GROUP BY dd.\`' + doDetItemFk + '\`, bucketIdx',
        [effectiveDateFrom, ...doDateToBind]
      );
      const ltMap = new Map();
      for (const r of ltRows) {
        const itemId = Number(r.itemId || 0), idx = Math.max(0, Math.min(15, Number(r.bucketIdx || 0))), cnt = Number(r.deliveryCount || 0), sumDays = Number(r.sumLeadDays || 0);
        if (!itemId || cnt <= 0) continue;
        let e = ltMap.get(itemId);
        if (!e) { e = { itemId, itemCode: String(r.itemCode || itemId), itemName: String(r.itemName || 'Barang #' + itemId), buckets: new Array(16).fill(0), total: 0, sumDays: 0 }; ltMap.set(itemId, e); }
        e.buckets[idx] += cnt; e.total += cnt; e.sumDays += sumDays;
      }
      for (const e of ltMap.values()) {
        deliveryLeadTime.push({ itemId: e.itemId, itemCode: e.itemCode, itemName: e.itemName, buckets: e.buckets, totalDeliveries: e.total, avgLeadDays: e.total > 0 ? e.sumDays / e.total : 0 });
      }
      deliveryLeadTime.sort((a, b) => b.totalDeliveries - a.totalDeliveries);
    } catch {}
  }

  const sortedMonths = Array.from(activeMonthsSet).filter((ym) => ym >= startYm && ym <= endYm).sort();
  const returnDetailsByMonth = {};
  const mismatchDetailsByMonth = {};

  const monthly = sortedMonths.map((ym) => {
    const prevYm = shiftMonthYm(ym, -1);
    const currSiSet = siCustByMonth.get(ym) || new Set();
    const prevSiSet = siCustByMonth.get(prevYm) || new Set();
    const currSoSet = soCustByMonth.get(ym) || new Set();
    const prevSoSet = soCustByMonth.get(prevYm) || new Set();
    let churnedSi = 0;
    for (const cid of prevSiSet) { if (!currSiSet.has(cid)) churnedSi += 1; }
    const rollingUnion = new Set();
    for (const d of [-1, -2, -3]) {
      const s = siCustByMonth.get(shiftMonthYm(ym, d));
      if (s) for (const cid of s) rollingUnion.add(cid);
    }
    let churnedRolling = 0;
    for (const cid of rollingUnion) { if (!currSiSet.has(cid)) churnedRolling += 1; }

    const soCur = soMonthlyMap.get(ym) || { soCount: 0, soTotalValue: 0, soCompleteCount: 0, soCompleteOrCloseCount: 0, soCompleteValue: 0, soCompleteOrCloseValue: 0 };
    const soPrev = soMonthlyMap.get(prevYm);
    const realCur = soRealizationByMonth.get(ym) || { soItemQty: 0, realizedItemQty: 0, soTotalValue: soCur.soTotalValue, realizedTotalValue: soCur.soCompleteOrCloseValue };
    const cpiCur = cpiSummaryByMonth.get(ym) || { prevBasket: 0, currBasket: 0, pct: 0, itemCount: 0 };
    const dotCur = dotByMonth.get(ym) || { ivTotal: 0, ivOnTime: 0, ivLinked: 0, ivLinkedOnTime: 0, doTotal: 0, doOnTime: 0, doLinked: 0, doLinkedOnTime: 0 };
    const srDoc = returnDocByMonth.get(ym) || { count: 0, value: 0 };

    const itemMap = itemStatsByMonth.get(ym);
    let sumRetQty = 0, sumSoldQty = 0, sumDelivQty = 0, sumVarQty = 0;
    const retItems = [], misItems = [];
    if (itemMap) {
      for (const st of itemMap.values()) {
        sumRetQty += st.returnQty; sumSoldQty += st.soldQty; sumDelivQty += st.deliveredQty; sumVarQty += st.varianceQty;
        if (st.returnQty > 0 || st.soldQty > 0) {
          retItems.push({ itemId: st.itemId, itemCode: st.itemCode, itemName: st.itemName, returnQty: st.returnQty, soldQty: st.soldQty, returnPct: st.soldQty > 0 ? (st.returnQty / st.soldQty) * 100 : 0 });
        }
        if (st.returnQty > 0 || st.varianceQty > 0 || st.deliveredQty > 0) {
          const den = st.deliveredQty > 0 ? st.deliveredQty : st.soldQty;
          misItems.push({ itemId: st.itemId, itemCode: st.itemCode, itemName: st.itemName, mismatchReturnQty: st.returnQty, mismatchVarianceQty: st.varianceQty, deliveredQty: den, mismatchReturnPct: den > 0 ? (st.returnQty / den) * 100 : 0, mismatchVariancePct: den > 0 ? (st.varianceQty / den) * 100 : 0 });
        }
      }
    }
    retItems.sort((a, b) => b.returnQty - a.returnQty || b.soldQty - a.soldQty);
    misItems.sort((a, b) => (b.mismatchReturnQty + b.mismatchVarianceQty) - (a.mismatchReturnQty + a.mismatchVarianceQty) || b.deliveredQty - a.deliveredQty);
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
      prevSoCount: soPrev ? soPrev.soCount : 0,
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
    cutoffDate: ACTIVE_CUTOFF_DATE,
    period: { dateFrom: effectiveDateFrom, dateTo },
    coverage: { minDateAll, maxDateAll, minDateActive, maxDateActive },
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
}

function classifyCoaSection(ctipe, cnomor) {
  const num = String(cnomor || '');
  const t = Number(ctipe);
  if (t === 0) return 'Kas';
  if (t === 1) return 'Bank';
  if (t === 2 || num.startsWith('1102')) return 'Piutang (AR)';
  if (t === 3) return 'Persediaan';
  if (t === 4) return 'Aset Lancar Lainnya';
  if (t === 5) return 'Aset Tetap & Lainnya';
  if (t === 6) return 'Akumulasi Penyusutan';
  if (t === 7 || num.startsWith('210101')) return 'Hutang Usaha (AP)';
  if (num.startsWith('210103')) return 'Hutang Lainnya (AP)';
  if (t === 8) return 'Pajak & Beban Akrual';
  if (t === 9) return 'Liabilitas Jangka Panjang';
  if (t === 10) return 'Ekuitas';
  if (t === 11) return 'Pendapatan Usaha';
  if (t === 12) {
    if (num.startsWith('520101')) return 'COGS — Opening Balance';
    if (num.startsWith('520102')) return 'COGS — Closing Balance';
    if (num.startsWith('51') || num.startsWith('52')) return 'COGS — Material & Pembelian';
    if (num.startsWith('53')) return 'COGS — Labour Expense';
    return 'COGS — Other COGS';
  }
  if (t === 13) return 'Beban Operasional';
  if (t === 14) return 'Pendapatan Lain-lain';
  if (t === 15) return 'Beban Lain-lain';
  if (t === 16) return 'OCI (Other Comprehensive Income)';
  if (t === 17) return 'Pajak Penghasilan (Income Taxes)';
  return 'Lainnya';
}

function isArAccount(ctipe, cnomor) {
  return Number(ctipe) === 2 || String(cnomor || '').startsWith('1102');
}

function isApAccount(ctipe, cnomor) {
  const num = String(cnomor || '');
  return Number(ctipe) === 7 || num.startsWith('210101') || num.startsWith('210103');
}

async function queryMyErpPlusFinance(conn, opts, caps) {
  const { search, dateTo } = opts;
  const effectiveDateFrom = clampActiveDateFrom(opts.dateFrom);

  // 1) Coverage metadata jurnal di DB lokal
  const [covRows] = await conn.query(
    'SELECT MIN(ttgl) AS minDateAll, MAX(ttgl) AS maxDateAll, COUNT(*) AS totalRowsAll, ' +
    'MIN(CASE WHEN ttgl >= ? THEN ttgl END) AS minDateActive, ' +
    'MAX(CASE WHEN ttgl >= ? THEN ttgl END) AS maxDateActive, ' +
    'SUM(CASE WHEN ttgl >= ? THEN 1 ELSE 0 END) AS totalRowsActive ' +
    'FROM m2_transaction_journal WHERE COALESCE(tstatus, 0) NOT IN (6, 12) AND COALESCE(tposting, 1) = 1',
    [ACTIVE_CUTOFF_DATE, ACTIVE_CUTOFF_DATE, ACTIVE_CUTOFF_DATE]
  );

  const dateToClause = dateTo ? ' AND j.ttgl <= ?' : '';
  const dateToBind = dateTo ? [dateTo] : [];

  // 2) Laba Rugi (P&L: ctipe 11..17) — STRICTLY >= effectiveDateFrom (>= 2026-03-01)
  const pnlBinds = [effectiveDateFrom, ...dateToBind];
  let pnlSearchSql = '';
  if (search) {
    pnlSearchSql = ' AND (c.cnomor LIKE ? OR c.cnama LIKE ?)';
    pnlBinds.push('%' + search + '%', '%' + search + '%');
  }

  const [pnlRows] = await conn.query(
    'SELECT c.cnomor AS accountNo, c.cnama AS accountName, c.ctipe AS ctipe, c.cdc AS cdc, ' +
    'COALESCE(SUM(j.tdebit), 0) AS debit, COALESCE(SUM(j.tkredit), 0) AS credit ' +
    'FROM m2_transaction_journal j ' +
    'INNER JOIN m1_coa c ON c.cnomor = j.tnorek ' +
    'WHERE COALESCE(j.tstatus, 0) NOT IN (6, 12) AND COALESCE(j.tposting, 1) = 1 ' +
    "AND c.cgd = 'D' AND c.ctipe BETWEEN 11 AND 17 " +
    'AND j.ttgl >= ?' + dateToClause + pnlSearchSql + ' ' +
    'GROUP BY c.cnomor, c.cnama, c.ctipe, c.cdc ORDER BY c.cnomor ASC',
    pnlBinds
  );

  // 3) Tren Laba Rugi Bulanan (>= effectiveDateFrom) — 100% sesuai struktur resmi MyERPPlus
  const [monthlyPnlRows] = await conn.query(
    "SELECT DATE_FORMAT(j.ttgl, '%Y-%m') AS month, " +
    'COALESCE(SUM(CASE WHEN c.ctipe = 11 THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS revenue, ' +
    "COALESCE(SUM(CASE WHEN c.ctipe = 12 AND (c.cnomor LIKE '51%' OR c.cnomor LIKE '52%') THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS cogsMaterial, " +
    "COALESCE(SUM(CASE WHEN c.ctipe = 12 AND c.cnomor LIKE '520101%' THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS cogsOpeningBalance, " +
    "COALESCE(SUM(CASE WHEN c.ctipe = 12 AND c.cnomor LIKE '520102%' THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS cogsClosingBalance, " +
    "COALESCE(SUM(CASE WHEN c.ctipe = 12 AND c.cnomor LIKE '53%' THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS cogsLabour, " +
    "COALESCE(SUM(CASE WHEN c.ctipe = 12 AND c.cnomor NOT LIKE '51%' AND c.cnomor NOT LIKE '52%' AND c.cnomor NOT LIKE '53%' THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS cogsOther, " +
    'COALESCE(SUM(CASE WHEN c.ctipe = 12 THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS cogs, ' +
    'COALESCE(SUM(CASE WHEN c.ctipe = 13 THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS opex, ' +
    'COALESCE(SUM(CASE WHEN c.ctipe = 14 THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS otherIncome, ' +
    'COALESCE(SUM(CASE WHEN c.ctipe = 15 THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS otherExpense, ' +
    'COALESCE(SUM(CASE WHEN c.ctipe = 16 THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS oci, ' +
    'COALESCE(SUM(CASE WHEN c.ctipe = 17 THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS incomeTax, ' +
    "COALESCE(SUM(CASE WHEN c.ctipe IN (12, 13, 15) AND (LOWER(c.cnama) LIKE '%bunga%' OR LOWER(c.cnama) LIKE '%interest%') THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS interestExpense, " +
    "COALESCE(SUM(CASE WHEN c.ctipe IN (12, 13, 15) AND NOT (LOWER(c.cnama) LIKE '%bunga%' OR LOWER(c.cnama) LIKE '%interest%') AND (LOWER(c.cnama) LIKE '%penyusut%' OR LOWER(c.cnama) LIKE '%depresiasi%' OR LOWER(c.cnama) LIKE '%depreciation%' OR LOWER(c.cnama) LIKE '%amortis%' OR LOWER(c.cnama) LIKE '%amortiz%') THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS depreciationAmortization, " +
    "COALESCE(SUM(CASE WHEN c.ctipe IN (12, 13, 15) AND NOT (LOWER(c.cnama) LIKE '%bunga%' OR LOWER(c.cnama) LIKE '%interest%') AND NOT (LOWER(c.cnama) LIKE '%penyusut%' OR LOWER(c.cnama) LIKE '%depresiasi%' OR LOWER(c.cnama) LIKE '%depreciation%' OR LOWER(c.cnama) LIKE '%amortis%' OR LOWER(c.cnama) LIKE '%amortiz%') AND (LOWER(c.cnama) LIKE '%pajak penghasilan%' OR LOWER(c.cnama) LIKE '%pph badan%' OR LOWER(c.cnama) LIKE '%income tax%') THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS taxExpenseInOpex " +
    'FROM m2_transaction_journal j ' +
    'INNER JOIN m1_coa c ON c.cnomor = j.tnorek ' +
    'WHERE COALESCE(j.tstatus, 0) NOT IN (6, 12) AND COALESCE(j.tposting, 1) = 1 ' +
    "AND c.cgd = 'D' AND c.ctipe BETWEEN 11 AND 17 " +
    'AND j.ttgl >= ?' + dateToClause + ' ' +
    "GROUP BY DATE_FORMAT(j.ttgl, '%Y-%m') ORDER BY month ASC LIMIT 24",
    [effectiveDateFrom, ...dateToBind]
  );

  // 3b) Snapshot Neraca Bulanan (Saldo Awal & Akhir per Bulan) untuk BI KPI 08-18
  const [bsOpeningRows] = await conn.query(
    "SELECT " +
    "COALESCE(SUM(CASE WHEN (c.ctipe = 2 OR c.cnomor LIKE '1102%') THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS ar, " +
    "COALESCE(SUM(CASE WHEN c.ctipe = 3 THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS inventory, " +
    "COALESCE(SUM(CASE WHEN (c.ctipe = 7 OR c.cnomor LIKE '210101%' OR c.cnomor LIKE '210103%') THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS ap, " +
    "COALESCE(SUM(CASE WHEN c.ctipe BETWEEN 0 AND 4 THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS currentAssets, " +
    "COALESCE(SUM(CASE WHEN c.ctipe = 5 THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS fixedAssets, " +
    "COALESCE(SUM(CASE WHEN c.ctipe = 6 THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS accumDep, " +
    "COALESCE(SUM(CASE WHEN c.ctipe BETWEEN 0 AND 6 THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS totalAssets, " +
    "COALESCE(SUM(CASE WHEN c.ctipe IN (7, 8) THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS currentLiabilities, " +
    "COALESCE(SUM(CASE WHEN c.ctipe = 9 THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS longTermLiabilities, " +
    "COALESCE(SUM(CASE WHEN c.ctipe IN (7, 8, 9) THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS totalLiabilities, " +
    "COALESCE(SUM(CASE WHEN c.ctipe = 10 THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS equity " +
    "FROM m2_transaction_journal j INNER JOIN m1_coa c ON c.cnomor = j.tnorek " +
    "WHERE COALESCE(j.tstatus, 0) NOT IN (6, 12) AND COALESCE(j.tposting, 1) = 1 " +
    "AND c.cgd = 'D' AND c.ctipe BETWEEN 0 AND 10 AND j.ttgl < ? " +
    "AND (j.ttgl >= ? OR c.ctipe IN (2, 7) OR c.cnomor LIKE '1102%' OR c.cnomor LIKE '210101%' OR c.cnomor LIKE '210103%')",
    [effectiveDateFrom, ACTIVE_CUTOFF_DATE]
  );

  const [bsMonthlyDeltaRows] = await conn.query(
    "SELECT DATE_FORMAT(j.ttgl, '%Y-%m') AS month, " +
    "COALESCE(SUM(CASE WHEN (c.ctipe = 2 OR c.cnomor LIKE '1102%') THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS ar, " +
    "COALESCE(SUM(CASE WHEN c.ctipe = 3 THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS inventory, " +
    "COALESCE(SUM(CASE WHEN (c.ctipe = 7 OR c.cnomor LIKE '210101%' OR c.cnomor LIKE '210103%') THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS ap, " +
    "COALESCE(SUM(CASE WHEN c.ctipe BETWEEN 0 AND 4 THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS currentAssets, " +
    "COALESCE(SUM(CASE WHEN c.ctipe = 5 THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS fixedAssets, " +
    "COALESCE(SUM(CASE WHEN c.ctipe = 6 THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS accumDep, " +
    "COALESCE(SUM(CASE WHEN c.ctipe BETWEEN 0 AND 6 THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS totalAssets, " +
    "COALESCE(SUM(CASE WHEN c.ctipe IN (7, 8) THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS currentLiabilities, " +
    "COALESCE(SUM(CASE WHEN c.ctipe = 9 THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS longTermLiabilities, " +
    "COALESCE(SUM(CASE WHEN c.ctipe IN (7, 8, 9) THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS totalLiabilities, " +
    "COALESCE(SUM(CASE WHEN c.ctipe = 10 THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS equity " +
    "FROM m2_transaction_journal j INNER JOIN m1_coa c ON c.cnomor = j.tnorek " +
    "WHERE COALESCE(j.tstatus, 0) NOT IN (6, 12) AND COALESCE(j.tposting, 1) = 1 " +
    "AND c.cgd = 'D' AND c.ctipe BETWEEN 0 AND 10 AND j.ttgl >= ?" + dateToClause + ' ' +
    "GROUP BY DATE_FORMAT(j.ttgl, '%Y-%m') ORDER BY month ASC LIMIT 24",
    [effectiveDateFrom, ...dateToBind]
  );

  // 4) Neraca & Hutang/Piutang (ctipe 0..10):
  //    - Akun AR (1102%, ctipe=2) & AP (210101%, 210103%, ctipe=7): dihitung KUMULATIF PENUH (termasuk < 2026-03-01)
  //    - Akun Neraca lainnya: transaksi < 2026-03-01 DIABAIKAN (hanya mutasi >= 2026-03-01)
  const bsBinds = [
    ACTIVE_CUTOFF_DATE,
    ACTIVE_CUTOFF_DATE,
    ACTIVE_CUTOFF_DATE,
    ACTIVE_CUTOFF_DATE,
    ...dateToBind,
    ACTIVE_CUTOFF_DATE,
  ];
  let bsSearchSql = '';
  if (search) {
    bsSearchSql = ' AND (c.cnomor LIKE ? OR c.cnama LIKE ?)';
    bsBinds.push('%' + search + '%', '%' + search + '%');
  }

  const [bsRows] = await conn.query(
    'SELECT c.cnomor AS accountNo, c.cnama AS accountName, c.ctipe AS ctipe, c.cdc AS cdc, ' +
    'COALESCE(SUM(CASE WHEN j.ttgl < ? THEN j.tdebit ELSE 0 END), 0) AS carryDebit, ' +
    'COALESCE(SUM(CASE WHEN j.ttgl < ? THEN j.tkredit ELSE 0 END), 0) AS carryCredit, ' +
    'COALESCE(SUM(CASE WHEN j.ttgl >= ? THEN j.tdebit ELSE 0 END), 0) AS periodDebit, ' +
    'COALESCE(SUM(CASE WHEN j.ttgl >= ? THEN j.tkredit ELSE 0 END), 0) AS periodCredit ' +
    'FROM m2_transaction_journal j ' +
    'INNER JOIN m1_coa c ON c.cnomor = j.tnorek ' +
    'WHERE COALESCE(j.tstatus, 0) NOT IN (6, 12) AND COALESCE(j.tposting, 1) = 1 ' +
    "AND c.cgd = 'D' AND c.ctipe BETWEEN 0 AND 10" + dateToClause + ' ' +
    "AND (j.ttgl >= ? OR c.ctipe IN (2, 7) OR c.cnomor LIKE '1102%' OR c.cnomor LIKE '210101%' OR c.cnomor LIKE '210103%')" +
    bsSearchSql + ' ' +
    'GROUP BY c.cnomor, c.cnama, c.ctipe, c.cdc ORDER BY c.cnomor ASC',
    bsBinds
  );

  // 5) Top Customer Piutang & Top Supplier Hutang (kumulatif penuh termasuk < 2026-03-01)
  const contactJoin = caps.hasContact ? 'LEFT JOIN m1_contact ct ON ct.kid = j.tkontak' : '';
  const contactNameExpr = caps.hasContact
    ? "COALESCE(NULLIF(TRIM(ct.knama), ''), CASE WHEN COALESCE(j.tkontak, 0) > 0 THEN CONCAT('Kontak #', j.tkontak) ELSE 'Tanpa Sub-Ledger Kontak' END)"
    : "CASE WHEN COALESCE(j.tkontak, 0) > 0 THEN CONCAT('Kontak #', j.tkontak) ELSE 'Tanpa Sub-Ledger Kontak' END";
  const contactCodeExpr = caps.hasContact
    ? "COALESCE(NULLIF(TRIM(ct.kkode), ''), CAST(COALESCE(j.tkontak, 0) AS CHAR))"
    : 'CAST(COALESCE(j.tkontak, 0) AS CHAR)';

  const contactBinds = [ACTIVE_CUTOFF_DATE, ACTIVE_CUTOFF_DATE, ...dateToBind];
  const [topArRows] = await conn.query(
    'SELECT COALESCE(j.tkontak, 0) AS contactId, ' + contactCodeExpr + ' AS contactCode, ' + contactNameExpr + ' AS contactName, ' +
    'COALESCE(SUM(CASE WHEN j.ttgl < ? THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS carryOverBalance, ' +
    'COALESCE(SUM(CASE WHEN j.ttgl >= ? THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS periodBalance, ' +
    'COALESCE(SUM(j.tdebit - j.tkredit), 0) AS totalBalance ' +
    'FROM m2_transaction_journal j INNER JOIN m1_coa c ON c.cnomor = j.tnorek ' + contactJoin + ' ' +
    'WHERE COALESCE(j.tstatus, 0) NOT IN (6, 12) AND COALESCE(j.tposting, 1) = 1 ' +
    "AND c.cgd = 'D' AND (c.ctipe = 2 OR c.cnomor LIKE '1102%')" + dateToClause + ' ' +
    'GROUP BY COALESCE(j.tkontak, 0), contactCode, contactName ' +
    'HAVING ABS(totalBalance) >= 1 ORDER BY totalBalance DESC LIMIT 20',
    contactBinds
  );

  const [topApRows] = await conn.query(
    'SELECT COALESCE(j.tkontak, 0) AS contactId, ' + contactCodeExpr + ' AS contactCode, ' + contactNameExpr + ' AS contactName, ' +
    'COALESCE(SUM(CASE WHEN j.ttgl < ? THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS carryOverBalance, ' +
    'COALESCE(SUM(CASE WHEN j.ttgl >= ? THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS periodBalance, ' +
    'COALESCE(SUM(j.tkredit - j.tdebit), 0) AS totalBalance ' +
    'FROM m2_transaction_journal j INNER JOIN m1_coa c ON c.cnomor = j.tnorek ' + contactJoin + ' ' +
    'WHERE COALESCE(j.tstatus, 0) NOT IN (6, 12) AND COALESCE(j.tposting, 1) = 1 ' +
    "AND c.cgd = 'D' AND (c.ctipe = 7 OR c.cnomor LIKE '210101%' OR c.cnomor LIKE '210103%')" + dateToClause + ' ' +
    'GROUP BY COALESCE(j.tkontak, 0), contactCode, contactName ' +
    'HAVING ABS(totalBalance) >= 1 ORDER BY totalBalance DESC LIMIT 20',
    contactBinds
  );

  // 6) Aging Piutang dari m5_si (faktur belum lunas semua periode termasuk < 2026-03-01)
  let arAging = {
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

  if (caps.hasSales) {
    try {
      const siDateClause = dateTo ? ' AND si.sitgl <= ?' : '';
      const siAgingBinds = [ACTIVE_CUTOFF_DATE, ACTIVE_CUTOFF_DATE, ...(dateTo ? [dateTo] : [])];
      const balExpr = 'GREATEST(0, COALESCE(si.sitotaltransaksi, 0) - COALESCE(si.sijmlbayar, 0) - COALESCE(si.sijmluangmuka, 0))';
      const [agRows] = await conn.query(
        'SELECT ' +
        'COUNT(*) AS totalCount, COALESCE(SUM(' + balExpr + '), 0) AS totalAmount, ' +
        'SUM(CASE WHEN si.sitgl < ? THEN 1 ELSE 0 END) AS carryOverCount, ' +
        'COALESCE(SUM(CASE WHEN si.sitgl < ? THEN ' + balExpr + ' ELSE 0 END), 0) AS carryOverAmount, ' +
        'SUM(CASE WHEN si.sitgljatuhtempo IS NULL OR DATEDIFF(CURDATE(), si.sitgljatuhtempo) <= 0 THEN 1 ELSE 0 END) AS curCnt, ' +
        'COALESCE(SUM(CASE WHEN si.sitgljatuhtempo IS NULL OR DATEDIFF(CURDATE(), si.sitgljatuhtempo) <= 0 THEN ' + balExpr + ' ELSE 0 END), 0) AS curAmt, ' +
        'SUM(CASE WHEN DATEDIFF(CURDATE(), si.sitgljatuhtempo) BETWEEN 1 AND 30 THEN 1 ELSE 0 END) AS d30Cnt, ' +
        'COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), si.sitgljatuhtempo) BETWEEN 1 AND 30 THEN ' + balExpr + ' ELSE 0 END), 0) AS d30Amt, ' +
        'SUM(CASE WHEN DATEDIFF(CURDATE(), si.sitgljatuhtempo) BETWEEN 31 AND 60 THEN 1 ELSE 0 END) AS d60Cnt, ' +
        'COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), si.sitgljatuhtempo) BETWEEN 31 AND 60 THEN ' + balExpr + ' ELSE 0 END), 0) AS d60Amt, ' +
        'SUM(CASE WHEN DATEDIFF(CURDATE(), si.sitgljatuhtempo) BETWEEN 61 AND 90 THEN 1 ELSE 0 END) AS d90Cnt, ' +
        'COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), si.sitgljatuhtempo) BETWEEN 61 AND 90 THEN ' + balExpr + ' ELSE 0 END), 0) AS d90Amt, ' +
        'SUM(CASE WHEN DATEDIFF(CURDATE(), si.sitgljatuhtempo) > 90 THEN 1 ELSE 0 END) AS over90Cnt, ' +
        'COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), si.sitgljatuhtempo) > 90 THEN ' + balExpr + ' ELSE 0 END), 0) AS over90Amt ' +
        'FROM m5_si si WHERE COALESCE(si.sistatus, 0) NOT IN (6, 12) AND COALESCE(si.sistatuslunas, 0) = 0 AND ' + balExpr + ' > 0' + siDateClause,
        siAgingBinds
      );
      const a = agRows[0] || {};
      arAging = {
        current: { count: Number(a.curCnt || 0), amount: Number(a.curAmt || 0) },
        days1to30: { count: Number(a.d30Cnt || 0), amount: Number(a.d30Amt || 0) },
        days31to60: { count: Number(a.d60Cnt || 0), amount: Number(a.d60Amt || 0) },
        days61to90: { count: Number(a.d90Cnt || 0), amount: Number(a.d90Amt || 0) },
        over90: { count: Number(a.over90Cnt || 0), amount: Number(a.over90Amt || 0) },
        totalCount: Number(a.totalCount || 0),
        totalAmount: Number(a.totalAmount || 0),
        carryOverCount: Number(a.carryOverCount || 0),
        carryOverAmount: Number(a.carryOverAmount || 0),
      };
    } catch {}
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

  const pnlAccounts = pnlRows.map((r) => {
    const accountNo = String(r.accountNo || '');
    const ctipe = Number(r.ctipe || 0);
    const cdc = String(r.cdc || 'D').toUpperCase();
    const debit = Number(r.debit || 0);
    const credit = Number(r.credit || 0);
    const amount = cdc === 'C' ? (credit - debit) : (debit - credit);
    const hasAnomaly = Math.abs(amount) >= ANOMALY_ABS_THRESHOLD;
    if (hasAnomaly) anomalyCount += 1;

    if (!hasAnomaly) {
      if (ctipe === 11) {
        revenue += (credit - debit);
      } else if (ctipe === 12) {
        const net = debit - credit;
        cogs += net;
        if (accountNo.startsWith('520101')) cogsOpeningBalance += net;
        if (accountNo.startsWith('520102')) cogsClosingBalance += net;
        if (accountNo.startsWith('51') || accountNo.startsWith('52')) cogsMaterial += net;
        else if (accountNo.startsWith('53')) cogsLabour += net;
        else cogsOther += net;
      } else if (ctipe === 13) {
        opex += (debit - credit);
      } else if (ctipe === 14) {
        otherIncome += (credit - debit);
      } else if (ctipe === 15) {
        otherExpense += (debit - credit);
      } else if (ctipe === 16) {
        // ctipe 16 = OCI (930101 Employee Benefit, 930102 Deferred Tax, cdc=D)
        oci += (debit - credit);
      } else if (ctipe === 17) {
        // ctipe 17 = Corporate & Deferred Income Taxes (910101, 920101, cdc=C)
        incomeTax += (credit - debit);
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

  const balanceSheetAccounts = bsRows.map((r) => {
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
      ? (cdc === 'C' ? (carryCredit - carryDebit) : (carryDebit - carryCredit))
      : 0;
    const periodBalance = cdc === 'C' ? (periodCredit - periodDebit) : (periodDebit - periodCredit);
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

  const monthlyPnl = monthlyPnlRows.map((m) => {
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
    const ni = pbt + mTax - mOci;
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
      netIncome: ni,
      hasOpeningClosingInput: Math.abs(cgOpen) >= 1 || Math.abs(cgClose) >= 1,
    };
  });

  const overdueCount = arAging.days1to30.count + arAging.days31to60.count + arAging.days61to90.count + arAging.over90.count;
  const overdueAmount = arAging.days1to30.amount + arAging.days31to60.amount + arAging.days61to90.amount + arAging.over90.amount;

  return {
    cutoffDate: ACTIVE_CUTOFF_DATE,
    period: { dateFrom: effectiveDateFrom, dateTo },
    coverage: {
      minDateAll: fmtDate(covRows[0]?.minDateAll),
      maxDateAll: fmtDate(covRows[0]?.maxDateAll),
      totalRowsAll: Number(covRows[0]?.totalRowsAll || 0),
      minDateActive: fmtDate(covRows[0]?.minDateActive),
      maxDateActive: fmtDate(covRows[0]?.maxDateActive),
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
    monthlyPnl,
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
      const deltaMap = new Map();
      for (const r of bsMonthlyDeltaRows) {
        const mKey = String(r.month || '');
        if (mKey) deltaMap.set(mKey, r);
      }
      const monthSet = new Set();
      for (const r of monthlyPnlRows) {
        const mKey = String(r.month || '');
        if (mKey) monthSet.add(mKey);
      }
      for (const mKey of deltaMap.keys()) monthSet.add(mKey);
      return Array.from(monthSet).sort().map((month) => {
        const d = deltaMap.get(month);
        const start = { ...running, capitalEmployed: running.totalAssets - running.currentLiabilities };
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
        return {
          month,
          arStart: start.ar,
          arEnd: running.ar,
          inventoryStart: start.inventory,
          inventoryEnd: running.inventory,
          apStart: start.ap,
          apEnd: running.ap,
          currentAssetsStart: start.currentAssets,
          currentAssetsEnd: running.currentAssets,
          fixedAssetsStart: start.fixedAssets,
          fixedAssetsEnd: running.fixedAssets,
          accumDepStart: start.accumDep,
          accumDepEnd: running.accumDep,
          totalAssetsStart: start.totalAssets,
          totalAssetsEnd: running.totalAssets,
          currentLiabilitiesStart: start.currentLiabilities,
          currentLiabilitiesEnd: running.currentLiabilities,
          longTermLiabilitiesStart: start.longTermLiabilities,
          longTermLiabilitiesEnd: running.longTermLiabilities,
          totalLiabilitiesStart: start.totalLiabilities,
          totalLiabilitiesEnd: running.totalLiabilities,
          equityStart: start.equity,
          equityEnd: running.equity,
          capitalEmployedStart: start.capitalEmployed,
          capitalEmployedEnd: running.totalAssets - running.currentLiabilities,
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
}

function mapErpAssetOperationalCategory(categoryName, coaName, assetName) {
  const hay = [categoryName, coaName, assetName].filter(Boolean).join(' ').toLowerCase();
  if (/(kendaraan|vehicle|mobil|motor|truk|truck|pickup|pick up|minibus|avanza|innova|l300|elf|grandmax|gran max|hiace|forklift|car\\b)/.test(hay)) {
    return 'Kendaraan';
  }
  if (/(bangunan|building|gedung|structure|tanah|land|gudang|warehouse|renovation|renovasi|right of use)/.test(hay)) {
    return 'Bangunan';
  }
  if (/(office\\s*equipment|komputer|computer|laptop|notebook|printer|server|ups|software|lisensi|license|cctv|network|elektronik|ac\\s+|air\\s*cond|proyektor|projector|\\bit\\b)/.test(hay)) {
    return 'Elektronik & IT';
  }
  if (/(meja|desk|table)/.test(hay)) {
    return 'Meja';
  }
  if (/(kursi|chair|sofa)/.test(hay)) {
    return 'Kursi';
  }
  if (/(mesin|machine|machinery|dies|mold|mould|jig|fixture|tool|welding|press|cutting|cnc|compressor|kompresor|genset|crane|hoist|peralatan|equipment)/.test(hay)) {
    return 'Mesin & Peralatan';
  }
  return 'Lainnya';
}

function normalizeUsefulLife(rawLife, acquisitionCost, residualValue, monthlyDep, depKe, startDate, retireDate) {
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

async function queryMyErpPlusAssets(conn, opts, caps) {
  const { search, category, includeDisposed, limit } = opts;

  // 1) Fetch main asset rows safely: try m7_asset_v -> m7_asset (filtered) -> m7_asset (raw)
  let rows = [];
  let usedAssetView = false;
  if (caps.hasAssetView) {
    try {
      const [vRows] = await conn.query(
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
      const [tRows] = await conn.query(
        'SELECT * FROM m7_asset WHERE COALESCE(astatus, 0) NOT IN (6, 12) ORDER BY akategori ASC, akode ASC'
      );
      rows = tRows;
    } catch {
      const [rawRows] = await conn.query('SELECT * FROM m7_asset');
      rows = rawRows.filter((r) => {
        const st = Number(r.astatus ?? 0);
        return st !== 6 && st !== 12;
      });
    }
  }

  // 2) Independently aggregate m7_asset_depreciation with automatic column detection (never crashes /assets)
  const depMap = new Map();
  let usedDepreciationTable = false;
  if (caps.hasAssetDepreciation) {
    try {
      const [depColRows] = await conn.query('SHOW COLUMNS FROM m7_asset_depreciation');
      const depCols = depColRows
        .map((c) => String(c.Field || c.field || '').trim())
        .filter((c) => SAFE_ID.test(c));
      const assetIdCol = pickCol(depCols, '', ['idaset', 'adidaset', 'id_aset', 'idasset', 'asset_id', 'aid', 'asetid']);
      const depNoCol = pickCol(depCols, '', ['penyusutanke', 'adpenyusutanke', 'adke', 'bulanke', 'periodeke', 'ke']);
      const amountCol = pickCol(depCols, '', ['nilaipenyusutan', 'adnilai', 'adbeban', 'beban', 'nilai', 'jumlah', 'nominal']);
      if (assetIdCol) {
        const maxNoExpr = depNoCol ? 'MAX(\`' + depNoCol + '\`)' : 'COUNT(*)';
        const sumAmtExpr = amountCol ? 'COALESCE(SUM(\`' + amountCol + '\`), 0)' : '0';
        const [depRows] = await conn.query(
          'SELECT \`' + assetIdCol + '\` AS idaset, COUNT(*) AS depCount, ' +
          maxNoExpr + ' AS maxDepNo, ' + sumAmtExpr + ' AS totalDepPosted ' +
          'FROM m7_asset_depreciation GROUP BY \`' + assetIdCol + '\`'
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
        usedDepreciationTable = true;
      }
    } catch {
      // Fallback safely to m7_asset built-in accumulated depreciation columns
    }
  }

  // 3) Independently load m7_asset_category lookup map in JS (immune to SQL collation/column differences)
  const catNameMap = new Map();
  if (caps.hasAssetCategory) {
    try {
      const [catRows] = await conn.query('SELECT * FROM m7_asset_category');
      for (const c of catRows) {
        const nameVal = String(c.acnama ?? c.nama ?? c.name ?? c.akategorinama ?? '').trim();
        if (!nameVal) continue;
        const keys = [c.ackode, c.kode, c.acid, c.id, c.code];
        for (const k of keys) {
          if (k !== null && k !== undefined && String(k).trim() !== '') {
            catNameMap.set(String(k).trim().toLowerCase(), nameVal);
          }
        }
      }
    } catch {
      // Ignore category lookup failure
    }
  }

  // 4) Independently load m7_depreciation_category lookup map in JS (immune to SQL collation/column differences)
  const methodNameMap = new Map();
  if (caps.hasDepreciationCategory) {
    try {
      const [mRows] = await conn.query('SELECT * FROM m7_depreciation_category');
      for (const m of mRows) {
        const nameVal = String(m.nama ?? m.dcnama ?? m.name ?? m.metode ?? '').trim();
        if (!nameVal) continue;
        const keys = [m.kode, m.dckode, m.id, m.dcid, m.code];
        for (const k of keys) {
          if (k !== null && k !== undefined && String(k).trim() !== '') {
            methodNameMap.set(String(k).trim().toLowerCase(), nameVal);
          }
        }
      }
    } catch {
      // Ignore depreciation method lookup failure
    }
  }

  // 5) Independently load m1_coa lookup map so coaAssetName is populated even when falling back from m7_asset_v to m7_asset
  const coaNameMap = new Map();
  if (caps.hasCoa && !usedAssetView) {
    try {
      const [coaRows] = await conn.query('SELECT cnomor, cnama FROM m1_coa');
      for (const coa of coaRows) {
        const no = String(coa.cnomor || '').trim();
        const nm = String(coa.cnama || '').trim();
        if (no && nm) coaNameMap.set(no, nm);
      }
    } catch {
      // Ignore COA lookup failure
    }
  }

  const allItems = rows.map((r) => {
    const depInfo = depMap.get(String(r.aid ?? '').trim()) || { depCount: 0, maxDepNo: 0, totalDepPosted: 0 };
    const qty = Number(r.ajml || 0) > 0 ? Number(r.ajml) : 1;
    const unitPrice = Number(r.aharga || 0);
    const acquisitionCost = Number(r.ahargabeli || 0) || (unitPrice * qty);
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

    const purchaseDate = fmtDate(r.atglbeli);
    const useDate = fmtDate(r.atglpakai) || purchaseDate;
    const retireDate = fmtDate(r.atglpensiun);
    const depKe = Math.max(Number(r.apenyusutanke || 0), Number(depInfo.maxDepNo || 0), Number(depInfo.depCount || 0));
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
    const categoryName = String(r.akategorinama || mappedCatFromTable || categoryCode || 'Lainnya').trim();
    const coaAssetCode = String(r.arekasset || '').trim();
    const coaAssetName = String(r.arekassetnama || (coaAssetCode ? coaNameMap.get(coaAssetCode) || '' : '')).trim();
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
      statusLabel: String(r.astatusnama || '').trim() || statusLabel(r.astatus),
    };
  });

  const activeItems = allItems.filter((it) => !it.isDisposed);
  const disposedCount = allItems.length - activeItems.length;
  const scopedItems = includeDisposed ? allItems : activeItems;

  const byCatMap = new Map();
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
  const byCategory = Array.from(byCatMap.values()).sort((a, b) => b.netBookValue - a.netBookValue);

  const qLower = String(search || '').trim().toLowerCase();
  const catLower = String(category || '').trim().toLowerCase();
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
    ].join(' ').toLowerCase();
    return qLower.split(/\\s+/).filter(Boolean).every((tok) => hay.includes(tok));
  });

  const kpi = {
    totalAssets: activeItems.length,
    totalQty: activeItems.reduce((s, x) => s + x.quantity, 0),
    disposedCount,
    fullyDepreciatedCount: activeItems.filter((x) => x.isFullyDepreciated).length,
    expiringWithin12MonthsCount: activeItems.filter((x) => !x.isFullyDepreciated && x.usefulLifeMonths > 0 && x.remainingLifeMonths > 0 && x.remainingLifeMonths <= 12).length,
    vehicleCount: activeItems.filter((x) => x.mappedCategory === 'Kendaraan').length,
    totalAcquisitionCost: activeItems.reduce((s, x) => s + x.acquisitionCost, 0),
    totalAccumulatedDepreciation: activeItems.reduce((s, x) => s + x.accumulatedDepreciation, 0),
    totalNetBookValue: activeItems.reduce((s, x) => s + x.netBookValue, 0),
    totalMonthlyDepreciation: activeItems.reduce((s, x) => s + (x.isFullyDepreciated ? 0 : x.monthlyDepreciation), 0),
  };

  return {
    sourceTable: (usedAssetView ? 'm7_asset_v' : 'm7_asset') + (usedDepreciationTable ? ' + m7_asset_depreciation' : ''),
    kpi,
    byCategory,
    items: filtered.slice(0, limit),
    totalMatched: filtered.length,
    fetchedAt: new Date().toISOString(),
  };
}

async function getTableCols(conn, tableName) {
  try {
    const [rows] = await conn.query('SHOW COLUMNS FROM \`' + tableName + '\`');
    return rows.map((r) => String(r.Field || r.field || '').trim()).filter((c) => SAFE_ID.test(c));
  } catch {
    return [];
  }
}

async function queryMyErpPlusPurchasing(conn, opts, caps) {
  const { search, dateTo, limit } = opts;
  const effectiveDateFrom = clampActiveDateFrom(opts.dateFrom);
  const dateToClauseJ = dateTo ? ' AND j.ttgl <= ?' : '';
  const dateToBind = dateTo ? [dateTo] : [];

  // 1) ANGKA RESMI LAPORAN KEUANGAN (100% dari m2_transaction_journal + m1_coa)
  //    520105% = PURCHASE DOMESTIC, 520104% = PURCHASE IMPORT,
  //    510103% = PURCHASE RETURN, 510102% = PURCHASE DISCOUNT,
  //    520103% = DEVELOPMENT COST, 520106% = IMPORT/TRANSPORT, 520107% = PAINTING, 520108% = REBATE, 520109% = TOOLING
  let glMonthlyMap = new Map();
  let glOtherCogsAccounts = [];
  let glTotalDomestic = 0;
  let glTotalImport = 0;
  let glTotalReturn = 0;
  let glTotalDiscount = 0;
  let glTotalOtherCogsCost = 0;
  let apJournalTotal = 0;
  let apJournalCarryOver = 0;
  let apJournalPeriod = 0;
  let topApContactsGl = [];

  if (caps.hasFinance) {
    try {
      const [glMonRows] = await conn.query(
        "SELECT DATE_FORMAT(j.ttgl, '%Y-%m') AS month, " +
        "COALESCE(SUM(CASE WHEN c.cnomor LIKE '520105%' THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS glDomestic, " +
        "COALESCE(SUM(CASE WHEN c.cnomor LIKE '520104%' THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS glImport, " +
        "COALESCE(SUM(CASE WHEN c.cnomor LIKE '510103%' THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS glReturn, " +
        "COALESCE(SUM(CASE WHEN c.cnomor LIKE '510102%' THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS glDiscount, " +
        "COALESCE(SUM(CASE WHEN c.cnomor LIKE '520103%' OR c.cnomor LIKE '520106%' OR c.cnomor LIKE '520107%' OR c.cnomor LIKE '520108%' OR c.cnomor LIKE '520109%' THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS glOtherCogsCost " +
        'FROM m2_transaction_journal j ' +
        'INNER JOIN m1_coa c ON c.cnomor = j.tnorek ' +
        'WHERE COALESCE(j.tstatus, 0) NOT IN (6, 12) AND COALESCE(j.tposting, 1) = 1 ' +
        "AND c.cgd = 'D' AND (c.cnomor LIKE '51%' OR c.cnomor LIKE '52%') " +
        'AND j.ttgl >= ?' + dateToClauseJ + ' ' +
        "GROUP BY DATE_FORMAT(j.ttgl, '%Y-%m') ORDER BY month ASC",
        [effectiveDateFrom, ...dateToBind]
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
        glMonthlyMap.set(m, {
          month: m,
          glDomestic,
          glImport,
          glReturn,
          glDiscount,
          glNetPurchase: glDomestic + glImport + glReturn + glDiscount,
          glOtherCogsCost,
          riInvoiceCount: 0,
          riDomesticDpp: 0,
          riImportDpp: 0,
          riDppIdr: 0,
          riTaxIdr: 0,
          riTotalIdr: 0,
          varianceVsRiDpp: glDomestic + glImport + glReturn + glDiscount,
        });
      }

      const [otherAccRows] = await conn.query(
        'SELECT c.cnomor AS accountNo, c.cnama AS accountName, COUNT(*) AS entryCount, ' +
        'COALESCE(SUM(j.tdebit - j.tkredit), 0) AS amount ' +
        'FROM m2_transaction_journal j ' +
        'INNER JOIN m1_coa c ON c.cnomor = j.tnorek ' +
        'WHERE COALESCE(j.tstatus, 0) NOT IN (6, 12) AND COALESCE(j.tposting, 1) = 1 ' +
        "AND c.cgd = 'D' AND (c.cnomor LIKE '510102%' OR c.cnomor LIKE '510103%' OR c.cnomor LIKE '520103%' OR c.cnomor LIKE '520104%' OR c.cnomor LIKE '520105%' OR c.cnomor LIKE '520106%' OR c.cnomor LIKE '520107%' OR c.cnomor LIKE '520108%' OR c.cnomor LIKE '520109%') " +
        'AND j.ttgl >= ?' + dateToClauseJ + ' ' +
        'GROUP BY c.cnomor, c.cnama ORDER BY c.cnomor ASC',
        [effectiveDateFrom, ...dateToBind]
      );
      glOtherCogsAccounts = otherAccRows.map((r) => ({
        accountNo: String(r.accountNo || ''),
        accountName: String(r.accountName || ''),
        entryCount: Number(r.entryCount || 0),
        amount: Number(r.amount || 0),
        isCorePurchase:
          String(r.accountNo || '').startsWith('520105') ||
          String(r.accountNo || '').startsWith('520104') ||
          String(r.accountNo || '').startsWith('510103') ||
          String(r.accountNo || '').startsWith('510102'),
      }));

      // Saldo Hutang Usaha / AP Kumulatif (termasuk carry-over < 2026-03-01)
      const [apGlRows] = await conn.query(
        'SELECT ' +
        'COALESCE(SUM(CASE WHEN j.ttgl < ? THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS carryOver, ' +
        'COALESCE(SUM(CASE WHEN j.ttgl >= ? THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS periodBal, ' +
        'COALESCE(SUM(j.tkredit - j.tdebit), 0) AS totalBal ' +
        'FROM m2_transaction_journal j ' +
        'INNER JOIN m1_coa c ON c.cnomor = j.tnorek ' +
        'WHERE COALESCE(j.tstatus, 0) NOT IN (6, 12) AND COALESCE(j.tposting, 1) = 1 ' +
        "AND c.cgd = 'D' AND (c.ctipe = 7 OR c.cnomor LIKE '210101%' OR c.cnomor LIKE '210103%')" + dateToClauseJ,
        [ACTIVE_CUTOFF_DATE, ACTIVE_CUTOFF_DATE, ...dateToBind]
      );
      apJournalCarryOver = Number(apGlRows[0]?.carryOver || 0);
      apJournalPeriod = Number(apGlRows[0]?.periodBal || 0);
      apJournalTotal = Number(apGlRows[0]?.totalBal || 0);

      const cJoinJ = caps.hasContact ? 'LEFT JOIN m1_contact ct ON ct.kid = j.tkontak' : '';
      const cNameJ = caps.hasContact
        ? "COALESCE(NULLIF(TRIM(ct.knama), ''), CASE WHEN COALESCE(j.tkontak, 0) > 0 THEN CONCAT('Supplier #', j.tkontak) ELSE 'Tanpa Sub-Ledger Kontak' END)"
        : "CASE WHEN COALESCE(j.tkontak, 0) > 0 THEN CONCAT('Supplier #', j.tkontak) ELSE 'Tanpa Sub-Ledger Kontak' END";
      const cCodeJ = caps.hasContact
        ? "COALESCE(NULLIF(TRIM(ct.kkode), ''), CAST(COALESCE(j.tkontak, 0) AS CHAR))"
        : 'CAST(COALESCE(j.tkontak, 0) AS CHAR)';

      const [apTopRows] = await conn.query(
        'SELECT COALESCE(j.tkontak, 0) AS contactId, ' + cCodeJ + ' AS contactCode, ' + cNameJ + ' AS contactName, ' +
        'COALESCE(SUM(CASE WHEN j.ttgl < ? THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS carryOverBalance, ' +
        'COALESCE(SUM(CASE WHEN j.ttgl >= ? THEN (j.tkredit - j.tdebit) ELSE 0 END), 0) AS periodBalance, ' +
        'COALESCE(SUM(j.tkredit - j.tdebit), 0) AS totalBalance ' +
        'FROM m2_transaction_journal j INNER JOIN m1_coa c ON c.cnomor = j.tnorek ' + cJoinJ + ' ' +
        'WHERE COALESCE(j.tstatus, 0) NOT IN (6, 12) AND COALESCE(j.tposting, 1) = 1 ' +
        "AND c.cgd = 'D' AND (c.ctipe = 7 OR c.cnomor LIKE '210101%' OR c.cnomor LIKE '210103%')" + dateToClauseJ + ' ' +
        'GROUP BY COALESCE(j.tkontak, 0), contactCode, contactName HAVING ABS(totalBalance) >= 1 ORDER BY totalBalance DESC LIMIT 20',
        [ACTIVE_CUTOFF_DATE, ACTIVE_CUTOFF_DATE, ...dateToBind]
      );
      topApContactsGl = apTopRows.map((r) => ({
        contactId: Number(r.contactId || 0),
        contactCode: String(r.contactCode || '-'),
        contactName: String(r.contactName || '-'),
        carryOverBalance: Number(r.carryOverBalance || 0),
        periodBalance: Number(r.periodBalance || 0),
        totalBalance: Number(r.totalBalance || 0),
      }));
    } catch (e) {
      console.error('[Purchasing GL Query Warning]', e instanceof Error ? e.message : e);
    }
  }

  // 2) SUB-LEDGER OPERASIONAL: Receiving Invoice / Purchase Invoice (m4_ri)
  const contactJoinRi = caps.hasContact ? 'LEFT JOIN m1_contact c ON c.kid = ri.risupplier' : '';
  const supNameRi = caps.hasContact
    ? "COALESCE(NULLIF(TRIM(c.knama), ''), CONCAT('Supplier #', ri.risupplier))"
    : "CONCAT('Supplier #', ri.risupplier)";
  const supCodeRi = caps.hasContact
    ? "COALESCE(NULLIF(TRIM(c.kkode), ''), CAST(ri.risupplier AS CHAR))"
    : 'CAST(ri.risupplier AS CHAR)';

  const kursExprRi = 'COALESCE(NULLIF(ri.rikurs, 0), 1)';
  const dppExprRi =
    '(CASE WHEN COALESCE(ri.rihargatermasukpajak, 0) = 1 ' +
    'THEN (COALESCE(ri.ritotaltransaksi, 0) - COALESCE(ri.ritotalpajak1detail, 0) - COALESCE(ri.ritotalpajak2detail, 0)) ' +
    'ELSE (COALESCE(ri.ritotal, 0) - COALESCE(ri.rijmldiskon, 0)) END) * ' + kursExprRi;
  const taxExprRi = '(COALESCE(ri.ritotalpajak1detail, 0) + COALESCE(ri.ritotalpajak2detail, 0)) * ' + kursExprRi;
  const totalIdrExprRi = 'COALESCE(ri.ritotaltransaksi, 0) * ' + kursExprRi;
  const paidIdrExprRi = '(COALESCE(ri.rijmlbayar, 0) + COALESCE(ri.rijmluangmuka, 0)) * ' + kursExprRi;
  const balIdrExprRi = 'GREATEST(0, COALESCE(ri.ritotaltransaksi, 0) - COALESCE(ri.rijmlbayar, 0) - COALESCE(ri.rijmluangmuka, 0)) * ' + kursExprRi;
  const isImportExprRi = "(COALESCE(ri.riasalbarangkategori, 0) = 1 OR LOWER(COALESCE(ri.riasalbarang, '')) LIKE '%impor%' OR (UPPER(COALESCE(NULLIF(TRIM(ri.rimatauang), ''), 'IDR')) <> 'IDR' AND COALESCE(ri.rikurs, 1) > 1))";

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
  let apAging = {
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
  let topSuppliers = [];
  let topItems = [];
  let invoices = [];
  let unpaidInvoices = [];

  if (caps.hasRi) {
    const riWhere = ['COALESCE(ri.ristatus, 0) NOT IN (6, 12)', 'ri.ritgl >= ?'];
    const riBinds = [effectiveDateFrom];
    if (dateTo) { riWhere.push('ri.ritgl <= ?'); riBinds.push(dateTo); }
    if (search) {
      if (caps.hasContact) {
        riWhere.push("(ri.rinotransaksi LIKE ? OR COALESCE(c.knama, '') LIKE ? OR COALESCE(ri.rinoref, '') LIKE ? OR COALESCE(ri.rigudang, '') LIKE ?)");
        riBinds.push('%' + search + '%', '%' + search + '%', '%' + search + '%', '%' + search + '%');
      } else {
        riWhere.push("(ri.rinotransaksi LIKE ? OR COALESCE(ri.rinoref, '') LIKE ? OR COALESCE(ri.rigudang, '') LIKE ?)");
        riBinds.push('%' + search + '%', '%' + search + '%', '%' + search + '%');
      }
    }
    const riWhereSql = 'WHERE ' + riWhere.join(' AND ');

    const apWhere = [
      'COALESCE(ri.ristatus, 0) NOT IN (6, 12)',
      'COALESCE(ri.ristatuslunas, 0) = 0',
      'GREATEST(0, COALESCE(ri.ritotaltransaksi, 0) - COALESCE(ri.rijmlbayar, 0) - COALESCE(ri.rijmluangmuka, 0)) > 0',
    ];
    const apBinds = [];
    if (dateTo) { apWhere.push('ri.ritgl <= ?'); apBinds.push(dateTo); }
    if (search) {
      if (caps.hasContact) {
        apWhere.push("(ri.rinotransaksi LIKE ? OR COALESCE(c.knama, '') LIKE ? OR COALESCE(ri.rinoref, '') LIKE ?)");
        apBinds.push('%' + search + '%', '%' + search + '%', '%' + search + '%');
      } else {
        apWhere.push("(ri.rinotransaksi LIKE ? OR COALESCE(ri.rinoref, '') LIKE ?)");
        apBinds.push('%' + search + '%', '%' + search + '%');
      }
    }
    const apWhereSql = 'WHERE ' + apWhere.join(' AND ');

    try {
      const [kRows] = await conn.query(
        'SELECT COUNT(*) AS invoiceCount, ' +
        'SUM(CASE WHEN ' + isImportExprRi + ' THEN 0 ELSE 1 END) AS domesticCount, ' +
        'SUM(CASE WHEN ' + isImportExprRi + ' THEN 1 ELSE 0 END) AS importCount, ' +
        'COALESCE(SUM(' + dppExprRi + '), 0) AS dppIdr, ' +
        'COALESCE(SUM(' + taxExprRi + '), 0) AS taxIdr, ' +
        'COALESCE(SUM(' + totalIdrExprRi + '), 0) AS totalIdr, ' +
        'COALESCE(SUM(' + paidIdrExprRi + '), 0) AS paidIdr ' +
        'FROM m4_ri ri ' + contactJoinRi + ' ' + riWhereSql,
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

      const [riMonRows] = await conn.query(
        "SELECT DATE_FORMAT(ri.ritgl, '%Y-%m') AS month, COUNT(*) AS invoiceCount, " +
        'COALESCE(SUM(CASE WHEN ' + isImportExprRi + ' THEN 0 ELSE ' + dppExprRi + ' END), 0) AS riDomesticDpp, ' +
        'COALESCE(SUM(CASE WHEN ' + isImportExprRi + ' THEN ' + dppExprRi + ' ELSE 0 END), 0) AS riImportDpp, ' +
        'COALESCE(SUM(' + dppExprRi + '), 0) AS riDppIdr, ' +
        'COALESCE(SUM(' + taxExprRi + '), 0) AS riTaxIdr, ' +
        'COALESCE(SUM(' + totalIdrExprRi + '), 0) AS riTotalIdr ' +
        'FROM m4_ri ri ' + contactJoinRi + ' ' + riWhereSql + " AND ri.ritgl IS NOT NULL GROUP BY DATE_FORMAT(ri.ritgl, '%Y-%m') ORDER BY month ASC",
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

      const [apRows] = await conn.query(
        'SELECT COUNT(*) AS unpaidInvoiceCount, COALESCE(SUM(' + balIdrExprRi + '), 0) AS totalPayableIdr, ' +
        'SUM(CASE WHEN ri.ritgl < ? THEN 1 ELSE 0 END) AS carryOverUnpaidCount, ' +
        'COALESCE(SUM(CASE WHEN ri.ritgl < ? THEN ' + balIdrExprRi + ' ELSE 0 END), 0) AS carryOverPayableIdr, ' +
        'SUM(CASE WHEN ri.ritgljatuhtempo IS NOT NULL AND ri.ritgljatuhtempo < CURDATE() THEN 1 ELSE 0 END) AS overdueInvoiceCount, ' +
        'COALESCE(SUM(CASE WHEN ri.ritgljatuhtempo IS NOT NULL AND ri.ritgljatuhtempo < CURDATE() THEN ' + balIdrExprRi + ' ELSE 0 END), 0) AS overdueAmountIdr, ' +
        'SUM(CASE WHEN ri.ritgljatuhtempo IS NULL OR DATEDIFF(CURDATE(), ri.ritgljatuhtempo) <= 0 THEN 1 ELSE 0 END) AS curCnt, ' +
        'COALESCE(SUM(CASE WHEN ri.ritgljatuhtempo IS NULL OR DATEDIFF(CURDATE(), ri.ritgljatuhtempo) <= 0 THEN ' + balIdrExprRi + ' ELSE 0 END), 0) AS curAmt, ' +
        'SUM(CASE WHEN DATEDIFF(CURDATE(), ri.ritgljatuhtempo) BETWEEN 1 AND 30 THEN 1 ELSE 0 END) AS d30Cnt, ' +
        'COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ri.ritgljatuhtempo) BETWEEN 1 AND 30 THEN ' + balIdrExprRi + ' ELSE 0 END), 0) AS d30Amt, ' +
        'SUM(CASE WHEN DATEDIFF(CURDATE(), ri.ritgljatuhtempo) BETWEEN 31 AND 60 THEN 1 ELSE 0 END) AS d60Cnt, ' +
        'COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ri.ritgljatuhtempo) BETWEEN 31 AND 60 THEN ' + balIdrExprRi + ' ELSE 0 END), 0) AS d60Amt, ' +
        'SUM(CASE WHEN DATEDIFF(CURDATE(), ri.ritgljatuhtempo) BETWEEN 61 AND 90 THEN 1 ELSE 0 END) AS d90Cnt, ' +
        'COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ri.ritgljatuhtempo) BETWEEN 61 AND 90 THEN ' + balIdrExprRi + ' ELSE 0 END), 0) AS d90Amt, ' +
        'SUM(CASE WHEN DATEDIFF(CURDATE(), ri.ritgljatuhtempo) > 90 THEN 1 ELSE 0 END) AS over90Cnt, ' +
        'COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ri.ritgljatuhtempo) > 90 THEN ' + balIdrExprRi + ' ELSE 0 END), 0) AS over90Amt ' +
        'FROM m4_ri ri ' + contactJoinRi + ' ' + apWhereSql,
        [ACTIVE_CUTOFF_DATE, ACTIVE_CUTOFF_DATE, ...apBinds]
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

      const [supRows] = await conn.query(
        'SELECT ri.risupplier AS supplierId, ' + supCodeRi + ' AS supplierCode, ' + supNameRi + ' AS supplierName, ' +
        'COUNT(*) AS invoiceCount, ' +
        'SUM(CASE WHEN ' + isImportExprRi + ' THEN 1 ELSE 0 END) AS importInvoiceCount, ' +
        'COALESCE(SUM(' + dppExprRi + '), 0) AS totalDppIdr, ' +
        'COALESCE(SUM(' + totalIdrExprRi + '), 0) AS totalIdr, ' +
        'COALESCE(SUM(CASE WHEN COALESCE(ri.ristatuslunas, 0) = 0 THEN ' + balIdrExprRi + ' ELSE 0 END), 0) AS totalPayableIdr ' +
        'FROM m4_ri ri ' + contactJoinRi + ' ' + riWhereSql + ' GROUP BY ri.risupplier, supplierCode, supplierName ORDER BY totalDppIdr DESC LIMIT 20',
        riBinds
      );
      topSuppliers = supRows.map((r) => ({
        supplierId: Number(r.supplierId || 0),
        supplierCode: String(r.supplierCode || '-'),
        supplierName: String(r.supplierName || '-'),
        invoiceCount: Number(r.invoiceCount || 0),
        originType: Number(r.importInvoiceCount || 0) > 0 && Number(r.importInvoiceCount || 0) === Number(r.invoiceCount || 0)
          ? 'Import'
          : Number(r.importInvoiceCount || 0) > 0
            ? 'Domestic & Import'
            : 'Domestic',
        totalDppIdr: Number(r.totalDppIdr || 0),
        totalIdr: Number(r.totalIdr || 0),
        totalPayableIdr: Number(r.totalPayableIdr || 0),
      }));

      const mapRiInv = (r) => {
        const dt = fmtDate(r.date);
        return {
          id: Number(r.id || 0),
          docNo: String(r.docNo || '-'),
          refNo: String(r.refNo || '').trim(),
          date: dt,
          dueDate: fmtDate(r.dueDate),
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
          isCarryOver: Boolean(dt && dt < ACTIVE_CUTOFF_DATE),
          statusCode: Number(r.statusCode || 0),
          statusLabel: statusLabel(r.statusCode),
        };
      };

      const [invRows] = await conn.query(
        'SELECT ri.riid AS id, ri.rinotransaksi AS docNo, ri.rinoref AS refNo, ri.ritgl AS date, ri.ritgljatuhtempo AS dueDate, ' +
        supNameRi + ' AS supplierName, CASE WHEN ' + isImportExprRi + ' THEN 1 ELSE 0 END AS isImport, ' +
        "COALESCE(NULLIF(TRIM(ri.rigudang), ''), '-') AS warehouse, COALESCE(NULLIF(TRIM(ri.rimatauang), ''), 'IDR') AS currency, " +
        kursExprRi + ' AS kurs, ' + dppExprRi + ' AS dppIdr, ' + taxExprRi + ' AS taxIdr, ' +
        'COALESCE(ri.ritotaltransaksi, 0) AS totalOrig, ' + totalIdrExprRi + ' AS totalIdr, ' + paidIdrExprRi + ' AS paidIdr, ' +
        'CASE WHEN COALESCE(ri.ristatuslunas, 0) = 1 THEN 0 ELSE ' + balIdrExprRi + ' END AS balanceIdr, ' +
        'COALESCE(ri.ristatuslunas, 0) AS isPaid, ' +
        'CASE WHEN COALESCE(ri.ristatuslunas, 0) = 0 AND ri.ritgljatuhtempo IS NOT NULL AND ri.ritgljatuhtempo < CURDATE() THEN 1 ELSE 0 END AS isOverdue, ' +
        'COALESCE(ri.ristatus, 0) AS statusCode ' +
        'FROM m4_ri ri ' + contactJoinRi + ' ' + riWhereSql + ' ORDER BY ri.ritgl DESC, ri.riid DESC LIMIT ?',
        [...riBinds, limit]
      );
      invoices = invRows.map(mapRiInv);

      const [unpaidRows] = await conn.query(
        'SELECT ri.riid AS id, ri.rinotransaksi AS docNo, ri.rinoref AS refNo, ri.ritgl AS date, ri.ritgljatuhtempo AS dueDate, ' +
        supNameRi + ' AS supplierName, CASE WHEN ' + isImportExprRi + ' THEN 1 ELSE 0 END AS isImport, ' +
        "COALESCE(NULLIF(TRIM(ri.rigudang), ''), '-') AS warehouse, COALESCE(NULLIF(TRIM(ri.rimatauang), ''), 'IDR') AS currency, " +
        kursExprRi + ' AS kurs, ' + dppExprRi + ' AS dppIdr, ' + taxExprRi + ' AS taxIdr, ' +
        'COALESCE(ri.ritotaltransaksi, 0) AS totalOrig, ' + totalIdrExprRi + ' AS totalIdr, ' + paidIdrExprRi + ' AS paidIdr, ' +
        balIdrExprRi + ' AS balanceIdr, 0 AS isPaid, ' +
        'CASE WHEN ri.ritgljatuhtempo IS NOT NULL AND ri.ritgljatuhtempo < CURDATE() THEN 1 ELSE 0 END AS isOverdue, ' +
        'COALESCE(ri.ristatus, 0) AS statusCode ' +
        'FROM m4_ri ri ' + contactJoinRi + ' ' + apWhereSql + ' ORDER BY ri.ritgljatuhtempo ASC, ri.ritgl ASC LIMIT ?',
        [...apBinds, limit]
      );
      unpaidInvoices = unpaidRows.map(mapRiInv);
    } catch (e) {
      console.error('[Purchasing m4_ri Warning]', e instanceof Error ? e.message : e);
    }

    // Top Purchased Items (m4_ri_detail — deteksi kolom dinamis agar aman)
    if (caps.hasRiDetail) {
      try {
        const dCols = await getTableCols(conn, 'm4_ri_detail');
        const fkCol = pickCol(dCols, '', ['idri', 'riid', 'id_ri']);
        const itemCol = pickCol(dCols, '', ['idbarang', 'barangid', 'id_barang']);
        const nameCol = pickCol(dCols, '', ['namabarang', 'nama_barang', 'deskripsi']);
        const qtyCol = pickCol(dCols, '', ['jml', 'qty', 'jumlah']);
        const unitCol = pickCol(dCols, '', ['satuan', 'satuanbarang', 'uom']);
        const priceCol = pickCol(dCols, '', ['harga', 'price']);
        const discCol = pickCol(dCols, '', ['jmldiskon', 'diskon_jml']);
        if (fkCol && itemCol && qtyCol && priceCol) {
          const itemCodeExpr = caps.hasStock
            ? "COALESCE(NULLIF(TRIM(i.bkode), ''), CAST(d.\`" + itemCol + "\` AS CHAR))"
            : 'CAST(d.\`' + itemCol + '\` AS CHAR)';
          const itemNameExpr = nameCol
            ? (caps.hasStock
                ? "COALESCE(NULLIF(TRIM(d.\`" + nameCol + "\`), ''), NULLIF(TRIM(i.bnama), ''), CONCAT('Barang #', d.\`" + itemCol + "\`))"
                : "COALESCE(NULLIF(TRIM(d.\`" + nameCol + "\`), ''), CONCAT('Barang #', d.\`" + itemCol + "\`))")
            : (caps.hasStock ? "COALESCE(NULLIF(TRIM(i.bnama), ''), CONCAT('Barang #', d.\`" + itemCol + "\`))" : "CONCAT('Barang #', d.\`" + itemCol + "\`)");
          const unitExpr = unitCol ? "COALESCE(NULLIF(TRIM(MAX(d.\`" + unitCol + "\`)), ''), 'Pcs')" : "'Pcs'";
          const discExpr = discCol ? 'COALESCE(d.\`' + discCol + '\`, 0)' : '0';
          const [itRows] = await conn.query(
            'SELECT d.\`' + itemCol + '\` AS itemId, ' + itemCodeExpr + ' AS itemCode, ' + itemNameExpr + ' AS itemName, ' +
            'COALESCE(SUM(d.\`' + qtyCol + '\`), 0) AS totalQty, ' + unitExpr + ' AS unit, ' +
            'COALESCE(SUM(((COALESCE(d.\`' + qtyCol + '\`, 0) * COALESCE(d.\`' + priceCol + '\`, 0)) - ' + discExpr + ') * ' + kursExprRi + '), 0) AS totalValueIdr, ' +
            'COUNT(DISTINCT d.\`' + fkCol + '\`) AS invoiceCount ' +
            'FROM m4_ri_detail d INNER JOIN m4_ri ri ON ri.riid = d.\`' + fkCol + '\` ' + contactJoinRi + ' ' +
            (caps.hasStock ? 'LEFT JOIN m1_item i ON i.bid = d.\`' + itemCol + '\` ' : '') +
            riWhereSql + ' GROUP BY d.\`' + itemCol + '\`, itemCode, itemName ORDER BY totalValueIdr DESC LIMIT 20',
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
      } catch {}
    }
  }

  // 3) Purchase Orders (m4_po)
  let poAgg = { poCount: 0, poTotalIdr: 0, poOutstandingCount: 0 };
  let purchaseOrders = [];
  if (caps.hasPo) {
    try {
      const poWhere = ['COALESCE(po.postatus, 0) NOT IN (6, 12)', 'po.potgl >= ?'];
      const poBinds = [effectiveDateFrom];
      if (dateTo) { poWhere.push('po.potgl <= ?'); poBinds.push(dateTo); }
      if (search) {
        poWhere.push(caps.hasContact ? "(po.ponotransaksi LIKE ? OR COALESCE(c.knama, '') LIKE ?)" : 'po.ponotransaksi LIKE ?');
        poBinds.push('%' + search + '%');
        if (caps.hasContact) poBinds.push('%' + search + '%');
      }
      const poWhereSql = 'WHERE ' + poWhere.join(' AND ');
      const poJoin = caps.hasContact ? 'LEFT JOIN m1_contact c ON c.kid = po.posupplier' : '';
      const poSup = caps.hasContact ? "COALESCE(NULLIF(TRIM(c.knama), ''), CONCAT('Supplier #', po.posupplier))" : "CONCAT('Supplier #', po.posupplier)";
      const poKurs = 'COALESCE(NULLIF(po.pokurs, 0), 1)';
      const poImp = "(COALESCE(po.poasalbarangkategori, 0) = 1 OR LOWER(COALESCE(po.poasalbarang, '')) LIKE '%impor%' OR (UPPER(COALESCE(NULLIF(TRIM(po.pomatauang), ''), 'IDR')) <> 'IDR' AND COALESCE(po.pokurs, 1) > 1))";

      const [a] = await conn.query(
        'SELECT COUNT(*) AS poCount, COALESCE(SUM(COALESCE(po.pototaltransaksi, 0) * ' + poKurs + '), 0) AS poTotalIdr, ' +
        'SUM(CASE WHEN COALESCE(po.poisclose, 0) = 0 AND COALESCE(po.postatus, 0) IN (2, 3) THEN 1 ELSE 0 END) AS poOutstandingCount ' +
        'FROM m4_po po ' + poJoin + ' ' + poWhereSql,
        poBinds
      );
      poAgg = {
        poCount: Number(a[0]?.poCount || 0),
        poTotalIdr: Number(a[0]?.poTotalIdr || 0),
        poOutstandingCount: Number(a[0]?.poOutstandingCount || 0),
      };

      const [rows] = await conn.query(
        'SELECT po.poid AS id, po.ponotransaksi AS docNo, po.potgl AS date, po.potgldipenuhi AS expectedDate, ' +
        poSup + ' AS supplierName, CASE WHEN ' + poImp + ' THEN 1 ELSE 0 END AS isImport, ' +
        "COALESCE(NULLIF(TRIM(po.pogudang), ''), '-') AS warehouse, COALESCE(NULLIF(TRIM(po.pomatauang), ''), 'IDR') AS currency, " +
        poKurs + ' AS kurs, COALESCE(po.pototaltransaksi, 0) * ' + poKurs + ' AS totalIdr, ' +
        'COALESCE(po.postatusgrn, 0) AS statusGrn, COALESCE(po.postatusri, 0) AS statusRi, ' +
        'COALESCE(po.poisclose, 0) AS isClosed, COALESCE(po.postatus, 0) AS statusCode ' +
        'FROM m4_po po ' + poJoin + ' ' + poWhereSql + ' ORDER BY po.potgl DESC, po.poid DESC LIMIT ?',
        [...poBinds, limit]
      );
      purchaseOrders = rows.map((r) => ({
        id: Number(r.id || 0),
        docNo: String(r.docNo || '-'),
        date: fmtDate(r.date),
        expectedDate: fmtDate(r.expectedDate),
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
        statusLabel: statusLabel(r.statusCode),
      }));
    } catch {}
  }

  // 4) Goods Receipt Notes (m4_grn — deteksi kolom dinamis agar aman 100%)
  let grnCount = 0;
  let goodsReceipts = [];
  if (caps.hasGrn) {
    try {
      const gCols = await getTableCols(conn, 'm4_grn');
      const idCol = pickCol(gCols, '', ['grnid', 'id']);
      const noCol = pickCol(gCols, '', ['grnnotransaksi', 'notransaksi']);
      const dtCol = pickCol(gCols, '', ['grntgl', 'tgl']);
      const supCol = pickCol(gCols, '', ['grnsupplier', 'supplier']);
      const whCol = pickCol(gCols, '', ['grngudang', 'gudang']);
      const totCol = pickCol(gCols, '', ['grntotaltransaksi', 'grntotal', 'totaltransaksi']);
      const kursCol = pickCol(gCols, '', ['grnkurs', 'kurs']);
      const stCol = pickCol(gCols, '', ['grnstatus', 'status']);
      if (idCol && noCol && dtCol) {
        const gWhere = ['g.\`' + dtCol + '\` >= ?'];
        const gBinds = [effectiveDateFrom];
        if (stCol) gWhere.unshift('COALESCE(g.\`' + stCol + '\`, 0) NOT IN (6, 12)');
        if (dateTo) { gWhere.push('g.\`' + dtCol + '\` <= ?'); gBinds.push(dateTo); }
        const gJoin = caps.hasContact && supCol ? 'LEFT JOIN m1_contact c ON c.kid = g.\`' + supCol + '\`' : '';
        if (search) {
          gWhere.push(gJoin ? '(g.\`' + noCol + "\` LIKE ? OR COALESCE(c.knama, '') LIKE ?)" : 'g.\`' + noCol + '\` LIKE ?');
          gBinds.push('%' + search + '%');
          if (gJoin) gBinds.push('%' + search + '%');
        }
        const gWhereSql = 'WHERE ' + gWhere.join(' AND ');
        const [cRows] = await conn.query('SELECT COUNT(*) AS cnt FROM m4_grn g ' + gJoin + ' ' + gWhereSql, gBinds);
        grnCount = Number(cRows[0]?.cnt || 0);
        const supExpr = gJoin ? "COALESCE(NULLIF(TRIM(c.knama), ''), CONCAT('Supplier #', g.\`" + supCol + "\`))" : "'-'";
        const whExpr = whCol ? "COALESCE(NULLIF(TRIM(g.\`" + whCol + "\`), ''), '-')" : "'-'";
        const totExpr = totCol
          ? (kursCol ? 'COALESCE(g.\`' + totCol + '\`, 0) * COALESCE(NULLIF(g.\`' + kursCol + '\`, 0), 1)' : 'COALESCE(g.\`' + totCol + '\`, 0)')
          : '0';
        const stExpr = stCol ? 'COALESCE(g.\`' + stCol + '\`, 0)' : '0';
        const [rows] = await conn.query(
          'SELECT g.\`' + idCol + '\` AS id, g.\`' + noCol + '\` AS docNo, g.\`' + dtCol + '\` AS date, ' +
          supExpr + ' AS supplierName, ' + whExpr + ' AS warehouse, ' + totExpr + ' AS totalIdr, ' + stExpr + ' AS statusCode ' +
          'FROM m4_grn g ' + gJoin + ' ' + gWhereSql + ' ORDER BY g.\`' + dtCol + '\` DESC, g.\`' + idCol + '\` DESC LIMIT ?',
          [...gBinds, limit]
        );
        goodsReceipts = rows.map((r) => ({
          id: Number(r.id || 0),
          docNo: String(r.docNo || '-'),
          date: fmtDate(r.date),
          supplierName: String(r.supplierName || '-'),
          warehouse: String(r.warehouse || '-'),
          totalIdr: Number(r.totalIdr || 0),
          statusCode: Number(r.statusCode || 0),
          statusLabel: statusLabel(r.statusCode),
        }));
      }
    } catch {}
  }

  // 5) Purchase Requests (m4_pr)
  let prCount = 0;
  let prOutstandingCount = 0;
  let purchaseRequests = [];
  if (caps.hasPr) {
    try {
      const prWhere = ['COALESCE(pr.prstatus, 0) NOT IN (6, 12)', 'pr.prtgl >= ?'];
      const prBinds = [effectiveDateFrom];
      if (dateTo) { prWhere.push('pr.prtgl <= ?'); prBinds.push(dateTo); }
      if (search) {
        prWhere.push("(pr.prnotransaksi LIKE ? OR COALESCE(pr.pruraian, '') LIKE ? OR COALESCE(pr.prgudang, '') LIKE ?)");
        prBinds.push('%' + search + '%', '%' + search + '%', '%' + search + '%');
      }
      const prWhereSql = 'WHERE ' + prWhere.join(' AND ');
      const [cRows] = await conn.query(
        'SELECT COUNT(*) AS cnt, SUM(CASE WHEN COALESCE(pr.prisclose, 0) = 0 AND COALESCE(pr.prstatus, 0) IN (2, 3) AND (COALESCE(pr.prstatuspo, 0) = 0 OR COALESCE(pr.prstatus, 0) = 3) THEN 1 ELSE 0 END) AS openCnt FROM m4_pr pr ' + prWhereSql,
        prBinds
      );
      prCount = Number(cRows[0]?.cnt || 0);
      prOutstandingCount = Number(cRows[0]?.openCnt || 0);
      const [rows] = await conn.query(
        'SELECT pr.prid AS id, pr.prnotransaksi AS docNo, pr.prtgl AS date, pr.prtgldipakai AS neededDate, ' +
        "COALESCE(NULLIF(TRIM(pr.pruraian), ''), '-') AS description, COALESCE(NULLIF(TRIM(pr.prgudang), ''), '-') AS warehouse, " +
        'COALESCE(pr.prtotaltransaksi, 0) * COALESCE(NULLIF(pr.prkurs, 0), 1) AS totalIdr, ' +
        'COALESCE(pr.prstatuspo, 0) AS statusPo, COALESCE(pr.prstatus, 0) AS statusCode ' +
        'FROM m4_pr pr ' + prWhereSql + ' ORDER BY pr.prtgl DESC, pr.prid DESC LIMIT ?',
        [...prBinds, limit]
      );
      purchaseRequests = rows.map((r) => ({
        id: Number(r.id || 0),
        docNo: String(r.docNo || '-'),
        date: fmtDate(r.date),
        neededDate: fmtDate(r.neededDate),
        description: String(r.description || '-'),
        warehouse: String(r.warehouse || '-'),
        totalIdr: Number(r.totalIdr || 0),
        statusPo: Number(r.statusPo || 0),
        statusCode: Number(r.statusCode || 0),
        statusLabel: statusLabel(r.statusCode),
      }));
    } catch {}
  }

  // 6) Purchase Returns (m4_prt) & Vendor Payments (m4_vp) count/totals (dinamis)
  let returnCountSub = 0;
  let returnTotalSubIdr = 0;
  let vpCount = 0;
  let vpTotalIdr = 0;
  if (caps.hasPrt) {
    try {
      const pCols = await getTableCols(conn, 'm4_prt');
      const dtCol = pickCol(pCols, '', ['prttgl', 'tgl']);
      const totCol = pickCol(pCols, '', ['prttotaltransaksi', 'prttotal', 'totaltransaksi']);
      const kursCol = pickCol(pCols, '', ['prtkurs', 'kurs']);
      const stCol = pickCol(pCols, '', ['prtstatus', 'status']);
      if (dtCol) {
        const w = ['\`' + dtCol + '\` >= ?'];
        const b = [effectiveDateFrom];
        if (stCol) w.unshift('COALESCE(\`' + stCol + '\`, 0) NOT IN (6, 12)');
        if (dateTo) { w.push('\`' + dtCol + '\` <= ?'); b.push(dateTo); }
        const totE = totCol ? (kursCol ? 'COALESCE(\`' + totCol + '\`, 0) * COALESCE(NULLIF(\`' + kursCol + '\`, 0), 1)' : 'COALESCE(\`' + totCol + '\`, 0)') : '0';
        const [rows] = await conn.query('SELECT COUNT(*) AS cnt, COALESCE(SUM(' + totE + '), 0) AS tot FROM m4_prt WHERE ' + w.join(' AND '), b);
        returnCountSub = Number(rows[0]?.cnt || 0);
        returnTotalSubIdr = Number(rows[0]?.tot || 0);
      }
    } catch {}
  }
  if (caps.hasVp) {
    try {
      const vCols = await getTableCols(conn, 'm4_vp');
      const dtCol = pickCol(vCols, '', ['vptgl', 'tgl']);
      const totCol = pickCol(vCols, '', ['vpbayar', 'vptotalap', 'vptotaltransaksi', 'vpjmlbayar', 'vptotal', 'totaltransaksi']);
      const kursCol = pickCol(vCols, '', ['vpkurs', 'kurs']);
      const stCol = pickCol(vCols, '', ['vpstatus', 'status']);
      if (dtCol) {
        const w = ['\`' + dtCol + '\` >= ?'];
        const b = [effectiveDateFrom];
        if (stCol) w.unshift('COALESCE(\`' + stCol + '\`, 0) NOT IN (6, 12)');
        if (dateTo) { w.push('\`' + dtCol + '\` <= ?'); b.push(dateTo); }
        const totE = totCol ? (kursCol ? 'COALESCE(\`' + totCol + '\`, 0) * COALESCE(NULLIF(\`' + kursCol + '\`, 0), 1)' : 'COALESCE(\`' + totCol + '\`, 0)') : '0';
        const [rows] = await conn.query('SELECT COUNT(*) AS cnt, COALESCE(SUM(' + totE + '), 0) AS tot FROM m4_vp WHERE ' + w.join(' AND '), b);
        vpCount = Number(rows[0]?.cnt || 0);
        vpTotalIdr = Number(rows[0]?.tot || 0);
      }
    } catch {}
  }

  // 7) Relasi Transaksi Terkait Purchasing (PR <-> PO <-> GRN <-> RI/PI <-> VP)
  const pushRel = (map, parentId, ref) => {
    if (!parentId || !ref.id) return;
    const list = map.get(parentId) || [];
    if (!list.some((x) => x.type === ref.type && x.id === ref.id)) {
      list.push(ref);
      map.set(parentId, list);
    }
  };
  const toRel = (type, r) => ({
    type,
    id: Number(r.id || 0),
    docNo: String(r.docNo || '-'),
    date: fmtDate(r.date),
    statusCode: Number(r.statusCode || 0),
    statusLabel: statusLabel(r.statusCode),
    totalIdr: Number(r.totalIdr || 0),
  });
  const vpSumberRiFilter =
    "UPPER(TRIM(COALESCE(vd.sumber, ''))) NOT IN ('AP', 'PRT', 'UM', 'RETUR', 'DNR', 'M4_AP', 'M4_PRT') " +
    "AND UPPER(COALESCE(vd.sumber, '')) NOT LIKE '%RETUR%' " +
    "AND UPPER(COALESCE(vd.sumber, '')) NOT LIKE '%UANG MUKA%'";

  const poIds = Array.from(new Set(purchaseOrders.map((p) => p.id).filter((id) => id > 0)));
  const prIds = Array.from(new Set(purchaseRequests.map((p) => p.id).filter((id) => id > 0)));
  const grnIds = Array.from(new Set(goodsReceipts.map((g) => g.id).filter((id) => id > 0)));
  const allRiIds = Array.from(new Set([...invoices, ...unpaidInvoices].map((i) => i.id).filter((id) => id > 0)));

  if (poIds.length > 0) {
    const poPrMap = new Map();
    const poGrnMap = new Map();
    const poRiMap = new Map();
    const poVpMap = new Map();

    if (caps.hasPr) {
      try {
        const up = ['SELECT po.poid, po.poidpr AS prid FROM m4_po po WHERE po.poid IN (?) AND COALESCE(po.poidpr, 0) > 0'];
        const b = [poIds];
        if (caps.hasPoDetail && caps.hasPrDetail) {
          up.unshift('SELECT pd.idpo AS poid, prd.idpr AS prid FROM m4_po_detail pd INNER JOIN m4_pr_detail prd ON prd.idprdetail = pd.idprdetail WHERE pd.idpo IN (?) AND COALESCE(pd.idprdetail, 0) > 0');
          b.unshift(poIds);
        }
        const [rows] = await conn.query(
          'SELECT DISTINCT x.poid AS parentId, pr.prid AS id, pr.prnotransaksi AS docNo, pr.prtgl AS date, COALESCE(pr.prstatus, 0) AS statusCode, COALESCE(pr.prtotaltransaksi, 0) * COALESCE(NULLIF(pr.prkurs, 0), 1) AS totalIdr FROM (' + up.join(' UNION ') + ') x INNER JOIN m4_pr pr ON pr.prid = x.prid WHERE COALESCE(pr.prstatus, 0) NOT IN (6, 12) ORDER BY pr.prtgl DESC, pr.prid DESC',
          b
        );
        for (const r of rows) pushRel(poPrMap, Number(r.parentId), toRel('PR', r));
      } catch {}
    }

    if (caps.hasGrn) {
      try {
        const up = ['SELECT g.grnidpo AS poid, g.grnid AS grnid FROM m4_grn g WHERE g.grnidpo IN (?)'];
        const b = [poIds];
        if (caps.hasPoDetail && caps.hasGrnDetail) {
          up.unshift('SELECT pd.idpo AS poid, gd.idgrn AS grnid FROM m4_po_detail pd INNER JOIN m4_grn_detail gd ON gd.idpodetail = pd.idpodetail WHERE pd.idpo IN (?) AND COALESCE(gd.idpodetail, 0) > 0');
          b.unshift(poIds);
        }
        const [rows] = await conn.query(
          'SELECT DISTINCT x.poid AS parentId, g.grnid AS id, g.grnnotransaksi AS docNo, g.grntgl AS date, COALESCE(g.grnstatus, 0) AS statusCode, COALESCE(g.grntotaltransaksi, 0) * COALESCE(NULLIF(g.grnkurs, 0), 1) AS totalIdr FROM (' + up.join(' UNION ') + ') x INNER JOIN m4_grn g ON g.grnid = x.grnid WHERE COALESCE(g.grnstatus, 0) NOT IN (6, 12) ORDER BY g.grntgl DESC, g.grnid DESC',
          b
        );
        for (const r of rows) pushRel(poGrnMap, Number(r.parentId), toRel('GRN', r));
      } catch {}
    }

    if (caps.hasRi) {
      try {
        const up = ['SELECT ri.riidpo AS poid, ri.riid AS riid FROM m4_ri ri WHERE ri.riidpo IN (?)'];
        const b = [poIds];
        if (caps.hasGrn) {
          up.push('SELECT g.grnidpo AS poid, ri.riid AS riid FROM m4_grn g INNER JOIN m4_ri ri ON ri.riidgrn = g.grnid WHERE g.grnidpo IN (?) AND COALESCE(ri.riidgrn, 0) > 0');
          b.push(poIds);
        }
        if (caps.hasPoDetail && caps.hasRiDetail) {
          up.unshift('SELECT pd.idpo AS poid, rd.idri AS riid FROM m4_po_detail pd INNER JOIN m4_ri_detail rd ON rd.idpodetail = pd.idpodetail WHERE pd.idpo IN (?) AND COALESCE(rd.idpodetail, 0) > 0');
          b.unshift(poIds);
        }
        if (caps.hasPoDetail && caps.hasGrnDetail && caps.hasRiDetail) {
          up.unshift('SELECT pd.idpo AS poid, rd.idri AS riid FROM m4_po_detail pd INNER JOIN m4_grn_detail gd ON gd.idpodetail = pd.idpodetail INNER JOIN m4_ri_detail rd ON rd.idgrndetail = gd.idgrndetail WHERE pd.idpo IN (?) AND COALESCE(gd.idpodetail, 0) > 0 AND COALESCE(rd.idgrndetail, 0) > 0');
          b.unshift(poIds);
        }
        const [rows] = await conn.query(
          'SELECT DISTINCT x.poid AS parentId, ri.riid AS id, ri.rinotransaksi AS docNo, ri.ritgl AS date, COALESCE(ri.ristatus, 0) AS statusCode, COALESCE(ri.ritotaltransaksi, 0) * COALESCE(NULLIF(ri.rikurs, 0), 1) AS totalIdr FROM (' + up.join(' UNION ') + ') x INNER JOIN m4_ri ri ON ri.riid = x.riid WHERE COALESCE(ri.ristatus, 0) NOT IN (6, 12) ORDER BY ri.ritgl DESC, ri.riid DESC',
          b
        );
        for (const r of rows) pushRel(poRiMap, Number(r.parentId), toRel('RI', r));
      } catch {}
    }

    if (caps.hasVp && caps.hasVpDetail && poRiMap.size > 0) {
      try {
        const riToPo = new Map();
        for (const [poid, ris] of poRiMap.entries()) {
          for (const ri of ris) {
            const list = riToPo.get(ri.id) || [];
            if (!list.includes(poid)) list.push(poid);
            riToPo.set(ri.id, list);
          }
        }
        const linkedRiIds = Array.from(riToPo.keys());
        if (linkedRiIds.length > 0) {
          const [rows] = await conn.query(
            'SELECT DISTINCT vd.idtransaksi AS riid, vp.vpid AS id, vp.vpnotransaksi AS docNo, vp.vptgl AS date, COALESCE(vp.vpstatus, 0) AS statusCode, COALESCE(vd.jmlbayar, vp.vpbayar, 0) * COALESCE(NULLIF(vp.vpkurs, 0), 1) AS totalIdr FROM m4_vp_detail vd INNER JOIN m4_vp vp ON vp.vpid = vd.idvp WHERE vd.idtransaksi IN (?) AND COALESCE(vp.vpstatus, 0) NOT IN (6, 12) AND ' + vpSumberRiFilter + ' ORDER BY vp.vptgl DESC, vp.vpid DESC',
            [linkedRiIds]
          );
          for (const r of rows) {
            const vpRef = toRel('VP', r);
            for (const poid of riToPo.get(Number(r.riid)) || []) pushRel(poVpMap, poid, vpRef);
          }
        }
      } catch {}
    }

    for (const po of purchaseOrders) {
      const grns = poGrnMap.get(po.id) || [];
      const ris = poRiMap.get(po.id) || [];
      po.relatedPrs = poPrMap.get(po.id) || [];
      po.relatedGrns = grns;
      po.relatedRis = ris;
      po.relatedVps = poVpMap.get(po.id) || [];
      if (grns.length > 0) po.statusGrn = 1;
      if (ris.length > 0) po.statusRi = 1;
    }
  }

  if (prIds.length > 0) {
    const prPoMap = new Map();
    const prGrnMap = new Map();
    const prRiMap = new Map();

    if (caps.hasPo) {
      try {
        const up = ['SELECT po.poidpr AS prid, po.poid AS poid FROM m4_po po WHERE po.poidpr IN (?)'];
        const b = [prIds];
        if (caps.hasPrDetail && caps.hasPoDetail) {
          up.unshift('SELECT prd.idpr AS prid, pd.idpo AS poid FROM m4_pr_detail prd INNER JOIN m4_po_detail pd ON pd.idprdetail = prd.idprdetail WHERE prd.idpr IN (?) AND COALESCE(pd.idprdetail, 0) > 0');
          b.unshift(prIds);
        }
        const [rows] = await conn.query(
          'SELECT DISTINCT x.prid AS parentId, po.poid AS id, po.ponotransaksi AS docNo, po.potgl AS date, COALESCE(po.postatus, 0) AS statusCode, COALESCE(po.pototaltransaksi, 0) * COALESCE(NULLIF(po.pokurs, 0), 1) AS totalIdr FROM (' + up.join(' UNION ') + ') x INNER JOIN m4_po po ON po.poid = x.poid WHERE COALESCE(po.postatus, 0) NOT IN (6, 12) ORDER BY po.potgl DESC, po.poid DESC',
          b
        );
        for (const r of rows) pushRel(prPoMap, Number(r.parentId), toRel('PO', r));
      } catch {}
    }

    if (caps.hasGrn) {
      try {
        const up = ['SELECT g.grnidpr AS prid, g.grnid AS grnid FROM m4_grn g WHERE g.grnidpr IN (?)'];
        const b = [prIds];
        if (caps.hasPrDetail && caps.hasGrnDetail) {
          up.unshift('SELECT prd.idpr AS prid, gd.idgrn AS grnid FROM m4_pr_detail prd INNER JOIN m4_grn_detail gd ON gd.idprdetail = prd.idprdetail WHERE prd.idpr IN (?) AND COALESCE(gd.idprdetail, 0) > 0');
          b.unshift(prIds);
        }
        if (caps.hasPrDetail && caps.hasPoDetail && caps.hasGrnDetail) {
          up.push('SELECT prd.idpr AS prid, gd.idgrn AS grnid FROM m4_pr_detail prd INNER JOIN m4_po_detail pd ON pd.idprdetail = prd.idprdetail INNER JOIN m4_grn_detail gd ON gd.idpodetail = pd.idpodetail WHERE prd.idpr IN (?) AND COALESCE(pd.idprdetail, 0) > 0 AND COALESCE(gd.idpodetail, 0) > 0');
          b.push(prIds);
        }
        const [rows] = await conn.query(
          'SELECT DISTINCT x.prid AS parentId, g.grnid AS id, g.grnnotransaksi AS docNo, g.grntgl AS date, COALESCE(g.grnstatus, 0) AS statusCode, COALESCE(g.grntotaltransaksi, 0) * COALESCE(NULLIF(g.grnkurs, 0), 1) AS totalIdr FROM (' + up.join(' UNION ') + ') x INNER JOIN m4_grn g ON g.grnid = x.grnid WHERE COALESCE(g.grnstatus, 0) NOT IN (6, 12) ORDER BY g.grntgl DESC, g.grnid DESC',
          b
        );
        for (const r of rows) pushRel(prGrnMap, Number(r.parentId), toRel('GRN', r));
      } catch {}
    }

    if (caps.hasRi) {
      try {
        const up = ['SELECT ri.riidpr AS prid, ri.riid AS riid FROM m4_ri ri WHERE ri.riidpr IN (?)'];
        const b = [prIds];
        if (caps.hasPrDetail && caps.hasRiDetail) {
          up.unshift('SELECT prd.idpr AS prid, rd.idri AS riid FROM m4_pr_detail prd INNER JOIN m4_ri_detail rd ON rd.idprdetail = prd.idprdetail WHERE prd.idpr IN (?) AND COALESCE(rd.idprdetail, 0) > 0');
          b.unshift(prIds);
        }
        const [rows] = await conn.query(
          'SELECT DISTINCT x.prid AS parentId, ri.riid AS id, ri.rinotransaksi AS docNo, ri.ritgl AS date, COALESCE(ri.ristatus, 0) AS statusCode, COALESCE(ri.ritotaltransaksi, 0) * COALESCE(NULLIF(ri.rikurs, 0), 1) AS totalIdr FROM (' + up.join(' UNION ') + ') x INNER JOIN m4_ri ri ON ri.riid = x.riid WHERE COALESCE(ri.ristatus, 0) NOT IN (6, 12) ORDER BY ri.ritgl DESC, ri.riid DESC',
          b
        );
        for (const r of rows) pushRel(prRiMap, Number(r.parentId), toRel('RI', r));
      } catch {}
    }

    for (const pr of purchaseRequests) {
      const pos = prPoMap.get(pr.id) || [];
      pr.relatedPos = pos;
      pr.relatedGrns = prGrnMap.get(pr.id) || [];
      pr.relatedRis = prRiMap.get(pr.id) || [];
      if (pos.length > 0) pr.statusPo = 1;
    }
  }

  if (grnIds.length > 0) {
    const grnPrMap = new Map();
    const grnPoMap = new Map();
    const grnRiMap = new Map();

    if (caps.hasPr) {
      try {
        const up = ['SELECT g.grnid, g.grnidpr AS prid FROM m4_grn g WHERE g.grnid IN (?) AND COALESCE(g.grnidpr, 0) > 0'];
        const b = [grnIds];
        if (caps.hasGrnDetail && caps.hasPrDetail) {
          up.unshift('SELECT gd.idgrn AS grnid, prd.idpr AS prid FROM m4_grn_detail gd INNER JOIN m4_pr_detail prd ON prd.idprdetail = gd.idprdetail WHERE gd.idgrn IN (?) AND COALESCE(gd.idprdetail, 0) > 0');
          b.unshift(grnIds);
        }
        const [rows] = await conn.query(
          'SELECT DISTINCT x.grnid AS parentId, pr.prid AS id, pr.prnotransaksi AS docNo, pr.prtgl AS date, COALESCE(pr.prstatus, 0) AS statusCode, COALESCE(pr.prtotaltransaksi, 0) * COALESCE(NULLIF(pr.prkurs, 0), 1) AS totalIdr FROM (' + up.join(' UNION ') + ') x INNER JOIN m4_pr pr ON pr.prid = x.prid WHERE COALESCE(pr.prstatus, 0) NOT IN (6, 12) ORDER BY pr.prtgl DESC, pr.prid DESC',
          b
        );
        for (const r of rows) pushRel(grnPrMap, Number(r.parentId), toRel('PR', r));
      } catch {}
    }

    if (caps.hasPo) {
      try {
        const up = ['SELECT g.grnid, g.grnidpo AS poid FROM m4_grn g WHERE g.grnid IN (?) AND COALESCE(g.grnidpo, 0) > 0'];
        const b = [grnIds];
        if (caps.hasGrnDetail && caps.hasPoDetail) {
          up.unshift('SELECT gd.idgrn AS grnid, pd.idpo AS poid FROM m4_grn_detail gd INNER JOIN m4_po_detail pd ON pd.idpodetail = gd.idpodetail WHERE gd.idgrn IN (?) AND COALESCE(gd.idpodetail, 0) > 0');
          b.unshift(grnIds);
        }
        const [rows] = await conn.query(
          'SELECT DISTINCT x.grnid AS parentId, po.poid AS id, po.ponotransaksi AS docNo, po.potgl AS date, COALESCE(po.postatus, 0) AS statusCode, COALESCE(po.pototaltransaksi, 0) * COALESCE(NULLIF(po.pokurs, 0), 1) AS totalIdr FROM (' + up.join(' UNION ') + ') x INNER JOIN m4_po po ON po.poid = x.poid WHERE COALESCE(po.postatus, 0) NOT IN (6, 12) ORDER BY po.potgl DESC, po.poid DESC',
          b
        );
        for (const r of rows) pushRel(grnPoMap, Number(r.parentId), toRel('PO', r));
      } catch {}
    }

    if (caps.hasRi) {
      try {
        const up = ['SELECT ri.riidgrn AS grnid, ri.riid AS riid FROM m4_ri ri WHERE ri.riidgrn IN (?)'];
        const b = [grnIds];
        if (caps.hasGrnDetail && caps.hasRiDetail) {
          up.unshift('SELECT gd.idgrn AS grnid, rd.idri AS riid FROM m4_grn_detail gd INNER JOIN m4_ri_detail rd ON rd.idgrndetail = gd.idgrndetail WHERE gd.idgrn IN (?) AND COALESCE(rd.idgrndetail, 0) > 0');
          b.unshift(grnIds);
        }
        const [rows] = await conn.query(
          'SELECT DISTINCT x.grnid AS parentId, ri.riid AS id, ri.rinotransaksi AS docNo, ri.ritgl AS date, COALESCE(ri.ristatus, 0) AS statusCode, COALESCE(ri.ritotaltransaksi, 0) * COALESCE(NULLIF(ri.rikurs, 0), 1) AS totalIdr FROM (' + up.join(' UNION ') + ') x INNER JOIN m4_ri ri ON ri.riid = x.riid WHERE COALESCE(ri.ristatus, 0) NOT IN (6, 12) ORDER BY ri.ritgl DESC, ri.riid DESC',
          b
        );
        for (const r of rows) pushRel(grnRiMap, Number(r.parentId), toRel('RI', r));
      } catch {}
    }

    for (const g of goodsReceipts) {
      const ris = grnRiMap.get(g.id) || [];
      g.relatedPrs = grnPrMap.get(g.id) || [];
      g.relatedPos = grnPoMap.get(g.id) || [];
      g.relatedRis = ris;
      g.statusRi = ris.length > 0 ? 1 : 0;
    }
  }

  if (allRiIds.length > 0) {
    const riPrMap = new Map();
    const riPoMap = new Map();
    const riGrnMap = new Map();
    const riVpMap = new Map();

    if (caps.hasPr) {
      try {
        const up = ['SELECT ri.riid, ri.riidpr AS prid FROM m4_ri ri WHERE ri.riid IN (?) AND COALESCE(ri.riidpr, 0) > 0'];
        const b = [allRiIds];
        if (caps.hasRiDetail && caps.hasPrDetail) {
          up.unshift('SELECT rd.idri AS riid, prd.idpr AS prid FROM m4_ri_detail rd INNER JOIN m4_pr_detail prd ON prd.idprdetail = rd.idprdetail WHERE rd.idri IN (?) AND COALESCE(rd.idprdetail, 0) > 0');
          b.unshift(allRiIds);
        }
        const [rows] = await conn.query(
          'SELECT DISTINCT x.riid AS parentId, pr.prid AS id, pr.prnotransaksi AS docNo, pr.prtgl AS date, COALESCE(pr.prstatus, 0) AS statusCode, COALESCE(pr.prtotaltransaksi, 0) * COALESCE(NULLIF(pr.prkurs, 0), 1) AS totalIdr FROM (' + up.join(' UNION ') + ') x INNER JOIN m4_pr pr ON pr.prid = x.prid WHERE COALESCE(pr.prstatus, 0) NOT IN (6, 12) ORDER BY pr.prtgl DESC, pr.prid DESC',
          b
        );
        for (const r of rows) pushRel(riPrMap, Number(r.parentId), toRel('PR', r));
      } catch {}
    }

    if (caps.hasPo) {
      try {
        const up = ['SELECT ri.riid, ri.riidpo AS poid FROM m4_ri ri WHERE ri.riid IN (?) AND COALESCE(ri.riidpo, 0) > 0'];
        const b = [allRiIds];
        if (caps.hasGrn) {
          up.push('SELECT ri.riid, g.grnidpo AS poid FROM m4_ri ri INNER JOIN m4_grn g ON g.grnid = ri.riidgrn WHERE ri.riid IN (?) AND COALESCE(ri.riidgrn, 0) > 0 AND COALESCE(g.grnidpo, 0) > 0');
          b.push(allRiIds);
        }
        if (caps.hasRiDetail && caps.hasPoDetail) {
          up.unshift('SELECT rd.idri AS riid, pd.idpo AS poid FROM m4_ri_detail rd INNER JOIN m4_po_detail pd ON pd.idpodetail = rd.idpodetail WHERE rd.idri IN (?) AND COALESCE(rd.idpodetail, 0) > 0');
          b.unshift(allRiIds);
        }
        if (caps.hasRiDetail && caps.hasGrnDetail && caps.hasPoDetail) {
          up.unshift('SELECT rd.idri AS riid, pd.idpo AS poid FROM m4_ri_detail rd INNER JOIN m4_grn_detail gd ON gd.idgrndetail = rd.idgrndetail INNER JOIN m4_po_detail pd ON pd.idpodetail = gd.idpodetail WHERE rd.idri IN (?) AND COALESCE(rd.idgrndetail, 0) > 0 AND COALESCE(gd.idpodetail, 0) > 0');
          b.unshift(allRiIds);
        }
        const [rows] = await conn.query(
          'SELECT DISTINCT x.riid AS parentId, po.poid AS id, po.ponotransaksi AS docNo, po.potgl AS date, COALESCE(po.postatus, 0) AS statusCode, COALESCE(po.pototaltransaksi, 0) * COALESCE(NULLIF(po.pokurs, 0), 1) AS totalIdr FROM (' + up.join(' UNION ') + ') x INNER JOIN m4_po po ON po.poid = x.poid WHERE COALESCE(po.postatus, 0) NOT IN (6, 12) ORDER BY po.potgl DESC, po.poid DESC',
          b
        );
        for (const r of rows) pushRel(riPoMap, Number(r.parentId), toRel('PO', r));
      } catch {}
    }

    if (caps.hasGrn) {
      try {
        const up = ['SELECT ri.riid, ri.riidgrn AS grnid FROM m4_ri ri WHERE ri.riid IN (?) AND COALESCE(ri.riidgrn, 0) > 0'];
        const b = [allRiIds];
        if (caps.hasRiDetail && caps.hasGrnDetail) {
          up.unshift('SELECT rd.idri AS riid, gd.idgrn AS grnid FROM m4_ri_detail rd INNER JOIN m4_grn_detail gd ON gd.idgrndetail = rd.idgrndetail WHERE rd.idri IN (?) AND COALESCE(rd.idgrndetail, 0) > 0');
          b.unshift(allRiIds);
        }
        const [rows] = await conn.query(
          'SELECT DISTINCT x.riid AS parentId, g.grnid AS id, g.grnnotransaksi AS docNo, g.grntgl AS date, COALESCE(g.grnstatus, 0) AS statusCode, COALESCE(g.grntotaltransaksi, 0) * COALESCE(NULLIF(g.grnkurs, 0), 1) AS totalIdr FROM (' + up.join(' UNION ') + ') x INNER JOIN m4_grn g ON g.grnid = x.grnid WHERE COALESCE(g.grnstatus, 0) NOT IN (6, 12) ORDER BY g.grntgl DESC, g.grnid DESC',
          b
        );
        for (const r of rows) pushRel(riGrnMap, Number(r.parentId), toRel('GRN', r));
      } catch {}
    }

    if (caps.hasVp && caps.hasVpDetail) {
      try {
        const [rows] = await conn.query(
          'SELECT DISTINCT vd.idtransaksi AS parentId, vp.vpid AS id, vp.vpnotransaksi AS docNo, vp.vptgl AS date, COALESCE(vp.vpstatus, 0) AS statusCode, COALESCE(vd.jmlbayar, vp.vpbayar, 0) * COALESCE(NULLIF(vp.vpkurs, 0), 1) AS totalIdr FROM m4_vp_detail vd INNER JOIN m4_vp vp ON vp.vpid = vd.idvp WHERE vd.idtransaksi IN (?) AND COALESCE(vp.vpstatus, 0) NOT IN (6, 12) AND ' + vpSumberRiFilter + ' ORDER BY vp.vptgl DESC, vp.vpid DESC',
          [allRiIds]
        );
        for (const r of rows) pushRel(riVpMap, Number(r.parentId), toRel('VP', r));
      } catch {}
    }

    for (const inv of [...invoices, ...unpaidInvoices]) {
      inv.relatedPrs = riPrMap.get(inv.id) || [];
      inv.relatedPos = riPoMap.get(inv.id) || [];
      inv.relatedGrns = riGrnMap.get(inv.id) || [];
      inv.relatedVps = riVpMap.get(inv.id) || [];
    }
  }

  const monthlyReconciliation = Array.from(glMonthlyMap.values()).sort((a, b) => a.month.localeCompare(b.month));
  const glNetPurchase = glTotalDomestic + glTotalImport + glTotalReturn + glTotalDiscount;

  return {
    cutoffDate: ACTIVE_CUTOFF_DATE,
    period: { dateFrom: effectiveDateFrom, dateTo },
    kpi: {
      // 100% sesuai Laporan Keuangan (m2_transaction_journal)
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
      // Sub-ledger operasional (m4_*)
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
    glPurchasingAccounts: glOtherCogsAccounts,
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
}

function normalizeWaPhoneBridge(raw) {
  const digits = String(raw || '').replace(/\\D/g, '');
  if (!digits) return '';
  let n = digits;
  if (n.startsWith('00')) n = n.slice(2);
  if (n.startsWith('0')) n = '62' + n.slice(1);
  else if (n.startsWith('8') && n.length >= 9 && n.length <= 13) n = '62' + n;
  if (n.length < 9 || n.length > 15) return '';
  return n;
}

async function queryMyErpPlusEmployees(conn, opts) {
  const { search, onlyActive, includeAll, limit } = opts;
  const cols = await getTableCols(conn, 'm1_contact');
  if (cols.length === 0) {
    throw new Error('Tabel m1_contact tidak memiliki kolom yang dapat dibaca.');
  }

  const idCol = pickCol(cols, '', ['kid', 'id', 'contact_id']);
  const codeCol = pickCol(cols, '', ['kkode', 'kode', 'code', 'nik', 'knik']);
  const nameCol = pickCol(cols, '', ['knama', 'nama', 'name']);
  const emailCol = pickCol(cols, '', ['kemail', 'email', 'kmail', 'kemail1', 'kemailkantor']);
  const phoneCol = pickCol(cols, '', ['khp', 'khandphone', 'kwa', 'kwhatsapp', 'knohp', 'kmobile', 'ktelp', 'ktelepon', 'ktelpon', 'ktelp1', 'kphone', 'phone']);
  const remainingPhoneCols = cols.filter((c) => c !== phoneCol);
  const secondaryPhoneCol = pickCol(remainingPhoneCols, '', ['ktelp', 'ktelepon', 'ktelpon', 'ktelp1', 'ktelp2', 'khp', 'khandphone', 'kwa', 'kphone', 'phone']);
  const activeCol = pickCol(cols, '', ['kaktif', 'aktif', 'is_active', 'kstatusaktif']);
  const employeeFlagCol = pickCol(cols, '', ['kpegawai', 'kemployee', 'kkaryawan', 'kisemployee', 'is_employee', 'k1karyawan']);
  const categoryCol = pickCol(cols, '', ['kkategori', 'kkategorikontak', 'kjenis', 'ktipe', 'ktype', 'kgolongan', 'kgroup', 'kgrup', 'kcategory']);
  const divisionCol = pickCol(cols, '', ['kdivisi', 'kdepartemen', 'kdept', 'kbagian', 'kunit']);
  const jobTitleCol = pickCol(cols, '', ['kjabatan', 'kposisi', 'ktitle', 'klevel']);
  const addressCol = pickCol(cols, '', ['kalamat', 'kalamat1', 'alamat', 'address']);

  // Optional category lookup table join (e.g. m1_contact_category)
  let catJoinSql = '';
  let catLabelExpr = categoryCol ? "COALESCE(NULLIF(TRIM(CAST(c.\`" + categoryCol + "\` AS CHAR)), ''), '')" : "''";
  if (categoryCol) {
    try {
      const [catTbls] = await conn.query(
        "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('m1_contact_category', 'm1_contact_kategori', 'm1_kategori_kontak', 'm1_kontak_kategori', 'm1_contact_type', 'm1_contact_group')"
      );
      if (catTbls && catTbls.length > 0) {
        const catTbl = String(catTbls[0].TABLE_NAME || catTbls[0].table_name || '').trim();
        if (catTbl && SAFE_ID.test(catTbl)) {
          const ccCols = await getTableCols(conn, catTbl);
          const ccMap = new Map(ccCols.map((x) => [x.toLowerCase(), x]));
          const ccId = ['id', 'kid', 'cid', 'kkid', 'kode', 'kkode'].map((k) => ccMap.get(k)).find(Boolean) || '';
          const ccName = ['nama', 'knama', 'cnama', 'name', 'kategori', 'deskripsi'].map((k) => ccMap.get(k)).find(Boolean) || '';
          if (ccId && ccName) {
            catJoinSql = 'LEFT JOIN \`' + catTbl + '\` cc ON CAST(cc.\`' + ccId + '\` AS CHAR) = CAST(c.\`' + categoryCol + '\` AS CHAR)';
            catLabelExpr = "COALESCE(NULLIF(TRIM(CAST(cc.\`" + ccName + "\` AS CHAR)), ''), NULLIF(TRIM(CAST(c.\`" + categoryCol + "\` AS CHAR)), ''), '')";
          }
        }
      }
    } catch {}
  }

  const selectParts = [
    (idCol ? 'c.\`' + idCol + '\`' : '0') + ' AS id',
    (codeCol ? "COALESCE(NULLIF(TRIM(CAST(c.\`" + codeCol + "\` AS CHAR)), ''), '')" : "''") + ' AS code',
    (nameCol ? "COALESCE(NULLIF(TRIM(CAST(c.\`" + nameCol + "\` AS CHAR)), ''), '')" : "''") + ' AS name',
    (emailCol ? "COALESCE(NULLIF(TRIM(CAST(c.\`" + emailCol + "\` AS CHAR)), ''), '')" : "''") + ' AS email',
    (phoneCol ? "COALESCE(NULLIF(TRIM(CAST(c.\`" + phoneCol + "\` AS CHAR)), ''), '')" : "''") + ' AS phone',
    (secondaryPhoneCol ? "COALESCE(NULLIF(TRIM(CAST(c.\`" + secondaryPhoneCol + "\` AS CHAR)), ''), '')" : "''") + ' AS secondaryPhone',
    (activeCol ? 'COALESCE(c.\`' + activeCol + '\`, 1)' : '1') + ' AS isActive',
    (employeeFlagCol ? 'COALESCE(c.\`' + employeeFlagCol + '\`, 0)' : '0') + ' AS employeeFlag',
    catLabelExpr + ' AS category',
    (divisionCol ? "COALESCE(NULLIF(TRIM(CAST(c.\`" + divisionCol + "\` AS CHAR)), ''), '')" : "''") + ' AS division',
    (jobTitleCol ? "COALESCE(NULLIF(TRIM(CAST(c.\`" + jobTitleCol + "\` AS CHAR)), ''), '')" : "''") + ' AS jobTitle',
    (addressCol ? "COALESCE(NULLIF(TRIM(CAST(c.\`" + addressCol + "\` AS CHAR)), ''), '')" : "''") + ' AS address',
  ];

  const whereClauses = [];
  if (onlyActive && activeCol) {
    whereClauses.push('COALESCE(c.\`' + activeCol + '\`, 1) <> 0');
  }
  if (!includeAll && categoryCol) {
    whereClauses.push("(UPPER(TRIM(CAST(c.\`" + categoryCol + "\` AS CHAR))) = 'K' OR UPPER(TRIM(" + catLabelExpr + ")) = 'K')");
  }
  const whereSql = whereClauses.length ? 'WHERE ' + whereClauses.join(' AND ') : '';

  const orderSql = nameCol ? 'ORDER BY c.\`' + nameCol + '\` ASC' : (idCol ? 'ORDER BY c.\`' + idCol + '\` ASC' : '');
  const [rows] = await conn.query(
    'SELECT ' + selectParts.join(', ') + ' FROM m1_contact c ' + catJoinSql + ' ' + whereSql + ' ' + orderSql + ' LIMIT 5000'
  );

  const categorySet = new Set();
  const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/;

  const mappedAll = rows.map((r) => {
    const rawCat = String(r.category || '').trim();
    if (rawCat) categorySet.add(rawCat);
    const catIsK = rawCat.toUpperCase() === 'K';
    const activeNum = Number(r.isActive ?? 1);
    const isActive = activeCol ? activeNum !== 0 : true;
    const rawEmail = String(r.email || '').trim();
    const validEmail = emailRegex.test(rawEmail) ? rawEmail : '';
    const primaryPhone = String(r.phone || '').trim();
    const secPhone = String(r.secondaryPhone || '').trim();
    const waNorm = normalizeWaPhoneBridge(primaryPhone) || normalizeWaPhoneBridge(secPhone);
    const missingFields = [];
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

  const qLower = String(search || '').trim().toLowerCase();
  const filtered = qLower
    ? scoped.filter((emp) => {
        const hay = [emp.code, emp.name, emp.category, emp.division, emp.jobTitle, emp.email, emp.phone, emp.secondaryPhone]
          .join(' ')
          .toLowerCase();
        return qLower.split(/\\s+/).filter(Boolean).every((tok) => hay.includes(tok));
      })
    : scoped;

  const readyEmailCount = scoped.filter((e) => !e.missingFields.includes('email')).length;
  const readyWhatsappCount = scoped.filter((e) => !e.missingFields.includes('phone')).length;
  const readyBothCount = scoped.filter((e) => e.missingFields.length === 0).length;

  return {
    sourceTable: 'm1_contact' + (catJoinSql ? ' + category_lookup' : ''),
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
    filterMode: includeAll ? 'all_contacts' : 'employee_only',
    employees: filtered.slice(0, limit),
    fetchedAt: new Date().toISOString(),
  };
}

async function queryMyErpPlusPendingTransactions(conn, opts) {
  const allowedSet = new Set(opts.ruleIds);
  const warnDays = Math.max(1, Math.min(30, Number(opts.warnDays) || 3));
  const overdueDays = Math.max(warnDays + 1, Math.min(90, Number(opts.overdueDays) || 7));
  const QTY_EPSILON = 0.0001;

  const hasPurchasing = Array.from(allowedSet).some((id) => id.startsWith('purchasing_'));
  const hasSales = Array.from(allowedSet).some((id) => id.startsWith('sales_'));

  const [tblRows] = await conn.query(
    "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('m5_so', 'm5_so_detail', 'm5_do', 'm5_do_detail', 'm5_si', 'm5_si_detail', 'm4_pr', 'm4_po', 'm4_po_detail', 'm4_grn', 'm4_grn_detail', 'm4_ri', 'm4_ri_detail', 'm4_pi', 'm4_pi_detail')"
  );
  const tblSet = new Set(tblRows.map((r) => String(r.TABLE_NAME || r.table_name || '').toLowerCase()));

  const fmtYmd = (v) => {
    if (!v) return null;
    if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
    const m = String(v).trim().match(/^(\\d{4}-\\d{2}-\\d{2})/);
    return m ? m[1] : null;
  };
  const ageDaysFromYmd = (ymd) => {
    if (!ymd) return 0;
    const p = Date.parse(ymd + 'T00:00:00Z');
    if (Number.isNaN(p)) return 0;
    const now = new Date();
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return Math.max(0, Math.floor((todayUtc - p) / 86400000));
  };
  const pickExact = (cols, cands) => {
    const lm = new Map(cols.map((c) => [c.toLowerCase(), c]));
    for (const cand of cands) {
      if (lm.has(cand.toLowerCase())) return lm.get(cand.toLowerCase());
    }
    return null;
  };
  const pickApproveCol = (cols, prefix) =>
    pickExact(cols, [
      prefix + 'tglapprove',
      prefix + 'tglapproved',
      prefix + 'approve_date',
      prefix + 'approvedate',
      prefix + 'approved_at',
      'tglapprove',
      'approved_at',
      'approve_date',
    ]);
  const buildDateExpr = (alias, dtCol, appCol) =>
    appCol ? 'COALESCE(' + alias + '.\`' + appCol + '\`, ' + alias + '.\`' + dtCol + '\`)' : alias + '.\`' + dtCol + '\`';

  const summarizeDates = (ruleId, dates, method, informational) => {
    const valid = dates.filter((d) => /^\\d{4}-\\d{2}-\\d{2}$/.test(d)).sort();
    let infoCount = 0;
    let overdueCount = 0;
    let warningCount = 0;
    let normalCount = 0;
    for (const d of valid) {
      if (informational) {
        infoCount++;
      } else {
        const age = ageDaysFromYmd(d);
        if (age >= overdueDays) overdueCount++;
        else if (age >= warnDays) warningCount++;
        else normalCount++;
      }
    }
    return {
      ruleId,
      count: valid.length,
      oldestDate: valid.length > 0 ? valid[0] : null,
      infoCount,
      overdueCount,
      warningCount,
      normalCount,
      detectionMethod: method,
    };
  };

  const queryStdCounts = async (table, dtCol, stCol, closeCol) => {
    const cCond = closeCol ? 'COALESCE(\`' + closeCol + '\`, 0) = 1' : '0 = 1';
    const ncCond = closeCol ? 'COALESCE(\`' + closeCol + '\`, 0) = 0' : '1 = 1';
    const [rows] = await conn.query(
      'SELECT COUNT(*) AS allCnt, ' +
      'COALESCE(SUM(CASE WHEN ' + ncCond + ' AND COALESCE(\`' + stCol + '\`, 0) IN (0, 1, 5, 8, 9, 10, 11) THEN 1 ELSE 0 END), 0) AS needApproveCnt, ' +
      'COALESCE(SUM(CASE WHEN ' + ncCond + ' AND COALESCE(\`' + stCol + '\`, 0) = 2 THEN 1 ELSE 0 END), 0) AS approvedCnt, ' +
      'COALESCE(SUM(CASE WHEN ' + ncCond + ' AND COALESCE(\`' + stCol + '\`, 0) = 3 THEN 1 ELSE 0 END), 0) AS inProgressCnt, ' +
      'COALESCE(SUM(CASE WHEN (' + cCond + ' OR COALESCE(\`' + stCol + '\`, 0) IN (4, 7)) THEN 1 ELSE 0 END), 0) AS completedCnt ' +
      'FROM \`' + table + '\` WHERE \`' + dtCol + '\` >= ? AND COALESCE(\`' + stCol + '\`, 0) NOT IN (6, 12)',
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
  };

  const rules = [];
  const statusCounts = {};
  const inconsistencies = [];
  const approvalDateColumns = {};
  let usedRelationBasis = false;

  // --- PURCHASING ---
  if (hasPurchasing) {
    if (tblSet.has('m4_pr')) {
      const prCols = await getTableCols(conn, 'm4_pr');
      const prCloseCol = pickExact(prCols, ['prisclose', 'isclose']);
      const prAppCol = pickApproveCol(prCols, 'pr');
      approvalDateColumns.m4_pr = prAppCol;
      try { statusCounts.pr = await queryStdCounts('m4_pr', 'prtgl', 'prstatus', prCloseCol); } catch {}
      if (allowedSet.has('purchasing_pr_pending_po')) {
        try {
          const ageExpr = buildDateExpr('pr', 'prtgl', prAppCol);
          const [rows] = await conn.query(
            'SELECT COUNT(*) AS cnt, MIN(' + ageExpr + ') AS oldestDate, ' +
            'COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ' + ageExpr + ') >= ? THEN 1 ELSE 0 END), 0) AS overdueCnt, ' +
            'COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ' + ageExpr + ') >= ? AND DATEDIFF(CURDATE(), ' + ageExpr + ') < ? THEN 1 ELSE 0 END), 0) AS warningCnt, ' +
            'COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ' + ageExpr + ') < ? THEN 1 ELSE 0 END), 0) AS normalCnt ' +
            'FROM m4_pr pr WHERE pr.prtgl >= ? AND COALESCE(pr.prisclose, 0) = 0 AND COALESCE(pr.prstatus, 0) IN (2, 3) AND (COALESCE(pr.prstatuspo, 0) = 0 OR COALESCE(pr.prstatus, 0) = 3)',
            [overdueDays, warnDays, overdueDays, warnDays, ACTIVE_CUTOFF_DATE]
          );
          const r = rows[0] || {};
          rules.push({
            ruleId: 'purchasing_pr_pending_po',
            count: Number(r.cnt || 0),
            oldestDate: fmtYmd(r.oldestDate),
            overdueCount: Number(r.overdueCnt || 0),
            warningCount: Number(r.warningCnt || 0),
            normalCount: Number(r.normalCnt || 0),
            detectionMethod: 'm4_pr (prisclose=0, prstatus IN 2,3 [Approved/In Progress], prstatuspo=0 OR prstatus=3)',
          });
        } catch {}
      }
    }

    if (tblSet.has('m4_po')) {
      const poCols = await getTableCols(conn, 'm4_po');
      const poCloseCol = pickExact(poCols, ['poisclose', 'isclose']);
      const poAppCol = pickApproveCol(poCols, 'po');
      approvalDateColumns.m4_po = poAppCol;
      try { statusCounts.po = await queryStdCounts('m4_po', 'potgl', 'postatus', poCloseCol); } catch {}

      const poDetCols = tblSet.has('m4_po_detail') ? await getTableCols(conn, 'm4_po_detail') : [];
      const poDetPk = pickExact(poDetCols, ['idpodetail', 'id']);
      const poDetFk = pickExact(poDetCols, ['idpo', 'poid', 'idpoid', 'idtransaksi']);
      const poDetQty = pickExact(poDetCols, ['jml', 'qty', 'poqty', 'dqty', 'jumlah', 'qtyorder', 'podqty']);

      const grnCols = tblSet.has('m4_grn') ? await getTableCols(conn, 'm4_grn') : [];
      const grnIdCol = pickExact(grnCols, ['grnid', 'id']);
      const grnPoHdrFk = pickExact(grnCols, ['grnidpo', 'idpo', 'poid']);
      const grnStCol = pickExact(grnCols, ['grnstatus', 'status']);
      const grnDetCols = tblSet.has('m4_grn_detail') ? await getTableCols(conn, 'm4_grn_detail') : [];
      const grnDetPk = pickExact(grnDetCols, ['idgrndetail', 'id']);
      const grnDetGrnFk = pickExact(grnDetCols, ['idgrn', 'grnid', 'idtransaksi']);
      const grnDetPoDetFk = pickExact(grnDetCols, ['idpodetail']);
      const grnDetPoFk = pickExact(grnDetCols, ['idpo', 'poid', 'grnpoid', 'dpo', 'idref']);
      const grnDetQty = pickExact(grnDetCols, ['jml', 'qty', 'grnqty', 'dqty', 'jumlah', 'grndqty']);

      const riTable = tblSet.has('m4_ri') ? 'm4_ri' : tblSet.has('m4_pi') ? 'm4_pi' : null;
      const riDetTable = tblSet.has('m4_ri_detail') ? 'm4_ri_detail' : tblSet.has('m4_pi_detail') ? 'm4_pi_detail' : null;
      const riCols = riTable ? await getTableCols(conn, riTable) : [];
      const riIdCol = pickExact(riCols, ['riid', 'piid', 'id']);
      const riPoHdrFk = pickExact(riCols, ['riidpo', 'piidpo', 'idpo', 'poid']);
      const riGrnHdrFk = pickExact(riCols, ['riidgrn', 'piidgrn', 'idgrn', 'grnid']);
      const riStCol = pickExact(riCols, ['ristatus', 'pistatus', 'status']);
      const riDetCols = riDetTable ? await getTableCols(conn, riDetTable) : [];
      const riDetRiFk = pickExact(riDetCols, ['idri', 'riid', 'idpi', 'piid', 'idtransaksi']);
      const riDetPoDetFk = pickExact(riDetCols, ['idpodetail']);
      const riDetGrnDetFk = pickExact(riDetCols, ['idgrndetail']);
      const riDetPoFk = pickExact(riDetCols, ['idpo', 'poid', 'ripoid', 'pipoid', 'idref']);
      const riDetQty = pickExact(riDetCols, ['jml', 'qty', 'riqty', 'piqty', 'dqty', 'jumlah', 'ridqty']);

      const hasGrnViaPoDet = Boolean(poDetPk && poDetFk && grnIdCol && grnDetGrnFk && grnDetPoDetFk);
      const hasGrnViaDetPo = Boolean(grnIdCol && grnDetGrnFk && grnDetPoFk);
      const hasGrnViaHdr = Boolean(grnIdCol && grnPoHdrFk);
      const hasGrnRel = hasGrnViaPoDet || hasGrnViaDetPo || hasGrnViaHdr;

      const hasRiViaPoDet = Boolean(riTable && riDetTable && riIdCol && riDetRiFk && poDetPk && poDetFk && riDetPoDetFk);
      const hasRiViaGrnDet = Boolean(riTable && riDetTable && riIdCol && riDetRiFk && poDetPk && poDetFk && grnDetPk && grnDetPoDetFk && riDetGrnDetFk);
      const hasRiViaDetPo = Boolean(riTable && riDetTable && riIdCol && riDetRiFk && riDetPoFk);
      const hasRiViaHdr = Boolean(riTable && riIdCol && riPoHdrFk);
      const hasRiRel = hasRiViaPoDet || hasRiViaGrnDet || hasRiViaDetPo || hasRiViaHdr;
      const hasPoQty = Boolean(poDetFk && poDetQty);

      if (hasGrnRel || hasRiRel) {
        usedRelationBasis = true;
        try {
          const poQtyJoin = hasPoQty
            ? 'LEFT JOIN (SELECT \`' + poDetFk + '\` AS poid, COALESCE(SUM(COALESCE(\`' + poDetQty + '\`, 0)), 0) AS po_qty FROM m4_po_detail GROUP BY \`' + poDetFk + '\`) pd ON pd.poid = po.poid'
            : '';

          let grnJoin = '';
          if (hasGrnRel) {
            const grnNotVoid = grnStCol ? 'COALESCE(g.\`' + grnStCol + '\`, 0) NOT IN (6, 12)' : '1=1';
            if (hasGrnViaPoDet) {
              const gq = grnDetQty ? 'COALESCE(gd.\`' + grnDetQty + '\`, 0)' : '0';
              const hdrU = hasGrnViaHdr
                ? ' UNION ALL SELECT g.\`' + grnPoHdrFk + '\` AS poid, g.\`' + grnIdCol + '\` AS grnid, 0 AS grn_qty FROM m4_grn g WHERE COALESCE(g.\`' + grnPoHdrFk + '\`, 0) > 0 AND ' + grnNotVoid
                : '';
              grnJoin = 'LEFT JOIN (SELECT poid, COUNT(DISTINCT grnid) AS grn_docs, COALESCE(SUM(grn_qty), 0) AS grn_qty FROM (SELECT pd.\`' + poDetFk + '\` AS poid, g.\`' + grnIdCol + '\` AS grnid, ' + gq + ' AS grn_qty FROM m4_grn_detail gd INNER JOIN m4_po_detail pd ON pd.\`' + poDetPk + '\` = gd.\`' + grnDetPoDetFk + '\` INNER JOIN m4_grn g ON g.\`' + grnIdCol + '\` = gd.\`' + grnDetGrnFk + '\` WHERE COALESCE(gd.\`' + grnDetPoDetFk + '\`, 0) > 0 AND ' + grnNotVoid + hdrU + ') gx GROUP BY poid) gr ON gr.poid = po.poid';
            } else if (hasGrnViaDetPo) {
              grnJoin = 'LEFT JOIN (SELECT gd.\`' + grnDetPoFk + '\` AS poid, COUNT(DISTINCT g.\`' + grnIdCol + '\`) AS grn_docs, ' + (grnDetQty ? 'COALESCE(SUM(COALESCE(gd.\`' + grnDetQty + '\`, 0)), 0)' : '0') + ' AS grn_qty FROM m4_grn_detail gd INNER JOIN m4_grn g ON g.\`' + grnIdCol + '\` = gd.\`' + grnDetGrnFk + '\` WHERE ' + grnNotVoid + ' GROUP BY gd.\`' + grnDetPoFk + '\`) gr ON gr.poid = po.poid';
            } else if (hasGrnViaHdr) {
              grnJoin = 'LEFT JOIN (SELECT g.\`' + grnPoHdrFk + '\` AS poid, COUNT(DISTINCT g.\`' + grnIdCol + '\`) AS grn_docs, 0 AS grn_qty FROM m4_grn g WHERE COALESCE(g.\`' + grnPoHdrFk + '\`, 0) > 0 AND ' + grnNotVoid + ' GROUP BY g.\`' + grnPoHdrFk + '\`) gr ON gr.poid = po.poid';
            }
          }

          let riJoin = '';
          if (hasRiRel) {
            const riNotVoid = riStCol ? 'COALESCE(ri.\`' + riStCol + '\`, 0) NOT IN (6, 12)' : '1=1';
            if (hasRiViaPoDet || hasRiViaGrnDet) {
              const rq = riDetQty ? 'COALESCE(rd.\`' + riDetQty + '\`, 0)' : '0';
              const parts = [];
              if (hasRiViaPoDet) {
                parts.push('SELECT pd.\`' + poDetFk + '\` AS poid, ri.\`' + riIdCol + '\` AS riid, ' + rq + ' AS ri_qty FROM \`' + riDetTable + '\` rd INNER JOIN m4_po_detail pd ON pd.\`' + poDetPk + '\` = rd.\`' + riDetPoDetFk + '\` INNER JOIN \`' + riTable + '\` ri ON ri.\`' + riIdCol + '\` = rd.\`' + riDetRiFk + '\` WHERE COALESCE(rd.\`' + riDetPoDetFk + '\`, 0) > 0 AND ' + riNotVoid);
              }
              if (hasRiViaGrnDet) {
                const avoidDup = hasRiViaPoDet ? 'AND COALESCE(rd.\`' + riDetPoDetFk + '\`, 0) = 0 ' : '';
                parts.push('SELECT pd.\`' + poDetFk + '\` AS poid, ri.\`' + riIdCol + '\` AS riid, ' + rq + ' AS ri_qty FROM \`' + riDetTable + '\` rd INNER JOIN m4_grn_detail gd ON gd.\`' + grnDetPk + '\` = rd.\`' + riDetGrnDetFk + '\` INNER JOIN m4_po_detail pd ON pd.\`' + poDetPk + '\` = gd.\`' + grnDetPoDetFk + '\` INNER JOIN \`' + riTable + '\` ri ON ri.\`' + riIdCol + '\` = rd.\`' + riDetRiFk + '\` WHERE COALESCE(rd.\`' + riDetGrnDetFk + '\`, 0) > 0 AND COALESCE(gd.\`' + grnDetPoDetFk + '\`, 0) > 0 ' + avoidDup + 'AND ' + riNotVoid);
              }
              if (hasRiViaHdr) {
                parts.push('SELECT ri.\`' + riPoHdrFk + '\` AS poid, ri.\`' + riIdCol + '\` AS riid, 0 AS ri_qty FROM \`' + riTable + '\` ri WHERE COALESCE(ri.\`' + riPoHdrFk + '\`, 0) > 0 AND ' + riNotVoid);
              }
              if (riGrnHdrFk && hasGrnViaHdr) {
                parts.push('SELECT g.\`' + grnPoHdrFk + '\` AS poid, ri.\`' + riIdCol + '\` AS riid, 0 AS ri_qty FROM \`' + riTable + '\` ri INNER JOIN m4_grn g ON g.\`' + grnIdCol + '\` = ri.\`' + riGrnHdrFk + '\` WHERE COALESCE(ri.\`' + riGrnHdrFk + '\`, 0) > 0 AND COALESCE(g.\`' + grnPoHdrFk + '\`, 0) > 0 AND ' + riNotVoid);
              }
              riJoin = 'LEFT JOIN (SELECT poid, COUNT(DISTINCT riid) AS ri_docs, COALESCE(SUM(ri_qty), 0) AS ri_qty FROM (' + parts.join(' UNION ALL ') + ') rx GROUP BY poid) rr ON rr.poid = po.poid';
            } else if (hasRiViaDetPo) {
              riJoin = 'LEFT JOIN (SELECT rd.\`' + riDetPoFk + '\` AS poid, COUNT(DISTINCT ri.\`' + riIdCol + '\`) AS ri_docs, ' + (riDetQty ? 'COALESCE(SUM(COALESCE(rd.\`' + riDetQty + '\`, 0)), 0)' : '0') + ' AS ri_qty FROM \`' + riDetTable + '\` rd INNER JOIN \`' + riTable + '\` ri ON ri.\`' + riIdCol + '\` = rd.\`' + riDetRiFk + '\` WHERE ' + riNotVoid + ' GROUP BY rd.\`' + riDetPoFk + '\`) rr ON rr.poid = po.poid';
            } else if (hasRiViaHdr) {
              riJoin = 'LEFT JOIN (SELECT ri.\`' + riPoHdrFk + '\` AS poid, COUNT(DISTINCT ri.\`' + riIdCol + '\`) AS ri_docs, 0 AS ri_qty FROM \`' + riTable + '\` ri WHERE COALESCE(ri.\`' + riPoHdrFk + '\`, 0) > 0 AND ' + riNotVoid + ' GROUP BY ri.\`' + riPoHdrFk + '\`) rr ON rr.poid = po.poid';
            }
          }
          const ageExpr = buildDateExpr('po', 'potgl', poAppCol);
          const closeExpr = poCloseCol ? 'COALESCE(po.\`' + poCloseCol + '\`, 0)' : '0';

          const [poRows] = await conn.query(
            'SELECT po.poid, po.ponotransaksi AS docNo, po.potgl AS docDate, ' + ageExpr + ' AS refDate, ' +
            'COALESCE(po.postatus, 0) AS statusCode, ' + closeExpr + ' AS isClosed, ' +
            (hasPoQty ? 'COALESCE(pd.po_qty, 0)' : '0') + ' AS poQty, ' +
            (hasGrnRel ? 'COALESCE(gr.grn_docs, 0)' : '0') + ' AS grnDocs, ' +
            (hasGrnRel ? 'COALESCE(gr.grn_qty, 0)' : '0') + ' AS grnQty, ' +
            (hasRiRel ? 'COALESCE(rr.ri_docs, 0)' : '0') + ' AS riDocs, ' +
            (hasRiRel ? 'COALESCE(rr.ri_qty, 0)' : '0') + ' AS riQty ' +
            'FROM m4_po po ' + poQtyJoin + ' ' + grnJoin + ' ' + riJoin + ' ' +
            'WHERE po.potgl >= ? AND COALESCE(po.postatus, 0) NOT IN (6, 12)',
            [ACTIVE_CUTOFF_DATE]
          );

          const needAppDates = [];
          const appDates = [];
          const progDates = [];
          const incAppHas = [];
          const incProgMis = [];
          const incCompMiss = [];

          for (const row of poRows) {
            const docNo = String(row.docNo || row.poid || '');
            const docDate = fmtYmd(row.docDate);
            const refDate = fmtYmd(row.refDate) || docDate;
            const st = Number(row.statusCode || 0);
            const isClosed = Number(row.isClosed || 0) === 1;
            const poQty = Number(row.poQty || 0);
            const grnDocs = Number(row.grnDocs || 0);
            const grnQty = Number(row.grnQty || 0);
            const riDocs = Number(row.riDocs || 0);
            const riQty = Number(row.riQty || 0);
            const procQty = Math.max(grnQty, riQty);
            const hasDown = grnDocs > 0 || riDocs > 0 || procQty > QTY_EPSILON;
            const isFull = poQty > QTY_EPSILON && procQty >= poQty - QTY_EPSILON;
            const isPartial = hasDown && (poQty > QTY_EPSILON ? procQty < poQty - QTY_EPSILON : st === 3);

            if (!isClosed && st === 2 && hasDown) incAppHas.push(docNo);
            if (!isClosed && st === 3 && (!hasDown || isFull)) incProgMis.push(docNo);
            if (!isClosed && st === 4 && !hasDown) incCompMiss.push(docNo);

            if (isClosed || st === 7) continue;
            if ([0, 1, 5, 8, 9, 10, 11].includes(st) && !hasDown) {
              if (docDate) needAppDates.push(docDate);
            } else if (isFull) {
              // completed
            } else if (isPartial) {
              if (refDate) progDates.push(refDate);
            } else if (!hasDown && (st === 2 || st === 3)) {
              if (refDate) appDates.push(refDate);
            }
          }

          if (incAppHas.length > 0) {
            inconsistencies.push({ code: 'po_approved_has_downstream', sourceTable: 'm4_po', count: incAppHas.length, sampleDocNos: incAppHas.slice(0, 5), descriptionKey: 'pendingTx.verification.po_approved_has_downstream' });
          }
          if (incProgMis.length > 0) {
            inconsistencies.push({ code: 'po_in_progress_mismatch', sourceTable: 'm4_po', count: incProgMis.length, sampleDocNos: incProgMis.slice(0, 5), descriptionKey: 'pendingTx.verification.po_in_progress_mismatch' });
          }
          if (incCompMiss.length > 0) {
            inconsistencies.push({ code: 'po_completed_missing_downstream', sourceTable: 'm4_po', count: incCompMiss.length, sampleDocNos: incCompMiss.slice(0, 5), descriptionKey: 'pendingTx.verification.po_completed_missing_downstream' });
          }

          if (allowedSet.has('purchasing_po_need_approve')) {
            rules.push(summarizeDates('purchasing_po_need_approve', needAppDates, 'relasi m4_po (Need Approve, tanpa GRN/RI)', false));
          }
          if (allowedSet.has('purchasing_po_approved_pending')) {
            rules.push(summarizeDates('purchasing_po_approved_pending', appDates, 'relasi m4_po vs m4_grn_detail/m4_ri_detail (Approved, 0 lanjutan)', false));
          }
          if (allowedSet.has('purchasing_po_in_progress')) {
            rules.push(summarizeDates('purchasing_po_in_progress', progDates, 'relasi m4_po_detail vs m4_grn_detail/m4_ri_detail (parsial)', true));
          }
        } catch {}
      }
    }

    if (tblSet.has('m4_grn')) {
      const gCols = await getTableCols(conn, 'm4_grn');
      const idCol = pickExact(gCols, ['grnid', 'id']);
      const noCol = pickExact(gCols, ['grnnotransaksi', 'notransaksi', 'no_grn']);
      const dtCol = pickExact(gCols, ['grntgl', 'tgl']);
      const stCol = pickExact(gCols, ['grnstatus', 'status']);
      const closeCol = pickExact(gCols, ['grnisclose', 'isclose']);
      approvalDateColumns.m4_grn = pickApproveCol(gCols, 'grn');

      if (dtCol) {
        try {
          const notVoid = stCol ? 'AND COALESCE(\`' + stCol + '\`, 0) NOT IN (6, 12)' : '';
          const compCond = closeCol
            ? (stCol ? '(COALESCE(\`' + closeCol + '\`, 0) = 1 OR COALESCE(\`' + stCol + '\`, 0) IN (4, 7))' : 'COALESCE(\`' + closeCol + '\`, 0) = 1')
            : (stCol ? 'COALESCE(\`' + stCol + '\`, 0) IN (4, 7)' : '0 = 1');
          const [cRows] = await conn.query(
            'SELECT COUNT(*) AS allCnt, COALESCE(SUM(CASE WHEN ' + compCond + ' THEN 1 ELSE 0 END), 0) AS completedCnt, COALESCE(SUM(CASE WHEN NOT (' + compCond + ') THEN 1 ELSE 0 END), 0) AS belumRiCnt FROM m4_grn WHERE \`' + dtCol + '\` >= ? ' + notVoid,
            [ACTIVE_CUTOFF_DATE]
          );
          const cr = cRows[0] || {};
          statusCounts.grn = { all: Number(cr.allCnt || 0), belum_ri: Number(cr.belumRiCnt || 0), completed: Number(cr.completedCnt || 0) };
        } catch {}

        if (allowedSet.has('purchasing_grn_pending_ri')) {
          try {
            const riColsG = tblSet.has('m4_ri') ? await getTableCols(conn, 'm4_ri') : [];
            const riHdrGrnFk = pickExact(riColsG, ['riidgrn', 'idgrn', 'grnid']);
            const grnDetColsG = tblSet.has('m4_grn_detail') ? await getTableCols(conn, 'm4_grn_detail') : [];
            const grnDetPkG = pickExact(grnDetColsG, ['idgrndetail', 'id']);
            const grnDetFkG = pickExact(grnDetColsG, ['idgrn', 'grnid', 'idtransaksi']);
            const riDetCols = tblSet.has('m4_ri_detail') ? await getTableCols(conn, 'm4_ri_detail') : [];
            const idRiCol = pickExact(riDetCols, ['idri', 'riid', 'idtransaksi']);
            const idGrnDetCol = pickExact(riDetCols, ['idgrndetail']);
            const idGrnCol = pickExact(riDetCols, ['idgrn', 'grnid', 'ridgrn', 'idref']);
            const hasViaDet = Boolean(idCol && tblSet.has('m4_ri') && idRiCol && grnDetPkG && grnDetFkG && idGrnDetCol);
            const hasViaDirect = Boolean(idCol && tblSet.has('m4_ri') && idRiCol && idGrnCol);
            const hasViaHdr = Boolean(idCol && tblSet.has('m4_ri') && riHdrGrnFk);
            if (hasViaDet || hasViaDirect || hasViaHdr) {
              usedRelationBasis = true;
              let riSub = '';
              let relLbl = 'm4_ri_detail.idgrndetail';
              if (hasViaDet) {
                const ps = [
                  'SELECT gd.\`' + grnDetFkG + '\` AS grnid, ri.riid AS riid FROM m4_ri_detail rd INNER JOIN m4_grn_detail gd ON gd.\`' + grnDetPkG + '\` = rd.\`' + idGrnDetCol + '\` INNER JOIN m4_ri ri ON ri.riid = rd.\`' + idRiCol + '\` WHERE COALESCE(rd.\`' + idGrnDetCol + '\`, 0) > 0 AND COALESCE(ri.ristatus, 0) NOT IN (6, 12)'
                ];
                if (hasViaHdr) {
                  ps.push('SELECT ri.\`' + riHdrGrnFk + '\` AS grnid, ri.riid AS riid FROM m4_ri ri WHERE COALESCE(ri.\`' + riHdrGrnFk + '\`, 0) > 0 AND COALESCE(ri.ristatus, 0) NOT IN (6, 12)');
                }
                riSub = 'SELECT grnid, COUNT(DISTINCT riid) AS ri_docs FROM (' + ps.join(' UNION ') + ') rix GROUP BY grnid';
              } else if (hasViaDirect) {
                relLbl = 'm4_ri_detail.' + idGrnCol;
                riSub = 'SELECT rd.\`' + idGrnCol + '\` AS grnid, COUNT(DISTINCT ri.riid) AS ri_docs FROM m4_ri_detail rd INNER JOIN m4_ri ri ON ri.riid = rd.\`' + idRiCol + '\` WHERE COALESCE(ri.ristatus, 0) NOT IN (6, 12) GROUP BY rd.\`' + idGrnCol + '\`';
              } else {
                relLbl = 'm4_ri.' + riHdrGrnFk;
                riSub = 'SELECT ri.\`' + riHdrGrnFk + '\` AS grnid, COUNT(DISTINCT ri.riid) AS ri_docs FROM m4_ri ri WHERE COALESCE(ri.\`' + riHdrGrnFk + '\`, 0) > 0 AND COALESCE(ri.ristatus, 0) NOT IN (6, 12) GROUP BY ri.\`' + riHdrGrnFk + '\`';
              }
              const [gRows] = await conn.query(
                'SELECT g.\`' + idCol + '\` AS grnId, ' + (noCol ? 'g.\`' + noCol + '\`' : 'g.\`' + idCol + '\`') + ' AS docNo, g.\`' + dtCol + '\` AS docDate, ' +
                (stCol ? 'COALESCE(g.\`' + stCol + '\`, 0)' : '0') + ' AS statusCode, ' +
                (closeCol ? 'COALESCE(g.\`' + closeCol + '\`, 0)' : '0') + ' AS isClosed, COALESCE(ri_agg.ri_docs, 0) AS riDocs ' +
                'FROM m4_grn g LEFT JOIN (' + riSub + ') ri_agg ON ri_agg.grnid = g.\`' + idCol + '\` ' +
                'WHERE g.\`' + dtCol + '\` >= ? ' + (stCol ? 'AND COALESCE(g.\`' + stCol + '\`, 0) NOT IN (6, 12)' : ''),
                [ACTIVE_CUTOFF_DATE]
              );
              const pendingDates = [];
              const incCompMiss = [];
              const incNotCompHas = [];
              for (const row of gRows) {
                const docNo = String(row.docNo || row.grnId || '');
                const docDate = fmtYmd(row.docDate);
                const st = Number(row.statusCode || 0);
                const isClosed = Number(row.isClosed || 0) === 1;
                const riDocs = Number(row.riDocs || 0);
                if (!isClosed && st === 4 && riDocs === 0) incCompMiss.push(docNo);
                if (!isClosed && st !== 4 && st !== 7 && riDocs > 0) incNotCompHas.push(docNo);
                if (!isClosed && (st === 2 || st === 3) && riDocs === 0 && docDate) pendingDates.push(docDate);
              }
              if (incCompMiss.length > 0) {
                inconsistencies.push({ code: 'grn_completed_missing_ri', sourceTable: 'm4_grn', count: incCompMiss.length, sampleDocNos: incCompMiss.slice(0, 5), descriptionKey: 'pendingTx.verification.grn_completed_missing_ri' });
              }
              if (incNotCompHas.length > 0) {
                inconsistencies.push({ code: 'grn_not_completed_has_ri', sourceTable: 'm4_grn', count: incNotCompHas.length, sampleDocNos: incNotCompHas.slice(0, 5), descriptionKey: 'pendingTx.verification.grn_not_completed_has_ri' });
              }
              rules.push(summarizeDates('purchasing_grn_pending_ri', pendingDates, 'relasi m4_grn (grnstatus IN 2,3) NOT EXISTS ' + relLbl, false));
            }
          } catch {}
        }
      }
    }

    if (tblSet.has('m4_ri') && allowedSet.has('purchasing_ri_pending_vp')) {
      try {
        const riCols = await getTableCols(conn, 'm4_ri');
        const riDtCol = pickExact(riCols, ['ritgl', 'tgl']) || 'ritgl';
        const riStCol = pickExact(riCols, ['ristatus', 'status']) || 'ristatus';
        const riLunasCol = pickExact(riCols, ['ristatuslunas', 'statuslunas']);
        const riCloseCol = pickExact(riCols, ['riisclose', 'isclose']);
        const riTotCol = pickExact(riCols, ['ritotaltransaksi', 'totaltransaksi', 'ritotal']);
        const riBayarCol = pickExact(riCols, ['rijmlbayar', 'jmlbayar', 'ribayar']);
        const riUmCol = pickExact(riCols, ['rijmluangmuka', 'jmluangmuka', 'riuangmuka']);
        const riAppCol = pickApproveCol(riCols, 'ri');
        approvalDateColumns.m4_ri = riAppCol;

        const ageExpr = buildDateExpr('ri', riDtCol, riAppCol);
        const closeSql = riCloseCol ? 'AND COALESCE(ri.\`' + riCloseCol + '\`, 0) = 0' : '';
        const lunasSql = riLunasCol ? 'AND COALESCE(ri.\`' + riLunasCol + '\`, 0) = 0' : '';
        const unpaidSql = riTotCol
          ? 'AND GREATEST(0, COALESCE(ri.\`' + riTotCol + '\`, 0)' +
            (riBayarCol ? ' - COALESCE(ri.\`' + riBayarCol + '\`, 0)' : '') +
            (riUmCol ? ' - COALESCE(ri.\`' + riUmCol + '\`, 0)' : '') +
            ') > 0.0001'
          : '';

        const [rows] = await conn.query(
          'SELECT COUNT(*) AS cnt, MIN(' + ageExpr + ') AS oldestDate, ' +
          'COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ' + ageExpr + ') >= ? THEN 1 ELSE 0 END), 0) AS overdueCnt, ' +
          'COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ' + ageExpr + ') >= ? AND DATEDIFF(CURDATE(), ' + ageExpr + ') < ? THEN 1 ELSE 0 END), 0) AS warningCnt, ' +
          'COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ' + ageExpr + ') < ? THEN 1 ELSE 0 END), 0) AS normalCnt ' +
          'FROM m4_ri ri WHERE ri.\`' + riDtCol + '\` >= ? AND COALESCE(ri.\`' + riStCol + '\`, 0) IN (2, 3) ' +
          closeSql + ' ' + lunasSql + ' ' + unpaidSql,
          [overdueDays, warnDays, overdueDays, warnDays, ACTIVE_CUTOFF_DATE]
        );
        const r = rows[0] || {};
        rules.push({
          ruleId: 'purchasing_ri_pending_vp',
          count: Number(r.cnt || 0),
          oldestDate: fmtYmd(r.oldestDate),
          overdueCount: Number(r.overdueCnt || 0),
          warningCount: Number(r.warningCnt || 0),
          normalCount: Number(r.normalCnt || 0),
          detectionMethod: 'm4_ri (ristatus IN 2,3 [Approved/In Progress], ristatuslunas=0, sisa hutang > 0)',
        });
      } catch {}
    }
  }

  // --- SALES ---
  if (hasSales) {
    if (tblSet.has('m5_so')) {
      const soCols = await getTableCols(conn, 'm5_so');
      const soCloseCol = pickExact(soCols, ['soisclose', 'isclose']);
      const soAppCol = pickApproveCol(soCols, 'so');
      approvalDateColumns.m5_so = soAppCol;
      try { statusCounts.so = await queryStdCounts('m5_so', 'sotgl', 'sostatus', soCloseCol); } catch {}

      const soDetCols = tblSet.has('m5_so_detail') ? await getTableCols(conn, 'm5_so_detail') : [];
      const soDetFk = pickExact(soDetCols, ['idso', 'soid', 'idtransaksi']);
      const soDetQty = pickExact(soDetCols, ['qty', 'soqty', 'dqty', 'jumlah']);
      const doDetCols = tblSet.has('m5_do_detail') ? await getTableCols(conn, 'm5_do_detail') : [];
      const doDetDoFk = pickExact(doDetCols, ['iddo', 'doid', 'idtransaksi']);
      const doDetSoFk = pickExact(doDetCols, ['idso', 'soid', 'dosoid', 'idref']);
      const doDetQty = pickExact(doDetCols, ['qty', 'doqty', 'dqty', 'jumlah']);

      if (tblSet.has('m5_do') && doDetDoFk && doDetSoFk) {
        usedRelationBasis = true;
        try {
          const soQtyJoin = soDetFk && soDetQty
            ? 'LEFT JOIN (SELECT \`' + soDetFk + '\` AS soid, COALESCE(SUM(COALESCE(\`' + soDetQty + '\`, 0)), 0) AS so_qty FROM m5_so_detail GROUP BY \`' + soDetFk + '\`) sd ON sd.soid = so.soid'
            : '';
          const doJoin = 'LEFT JOIN (SELECT dd.\`' + doDetSoFk + '\` AS soid, COUNT(DISTINCT d.doid) AS do_docs, ' + (doDetQty ? 'COALESCE(SUM(COALESCE(dd.\`' + doDetQty + '\`, 0)), 0)' : '0') + ' AS do_qty FROM m5_do_detail dd INNER JOIN m5_do d ON d.doid = dd.\`' + doDetDoFk + '\` WHERE COALESCE(d.dostatus, 0) NOT IN (6, 12) GROUP BY dd.\`' + doDetSoFk + '\`) dr ON dr.soid = so.soid';
          const ageExpr = buildDateExpr('so', 'sotgl', soAppCol);
          const [soRows] = await conn.query(
            'SELECT so.soid, so.sonotransaksi AS docNo, ' + ageExpr + ' AS refDate, COALESCE(so.sostatus, 0) AS statusCode, ' +
            (soCloseCol ? 'COALESCE(so.\`' + soCloseCol + '\`, 0)' : '0') + ' AS isClosed, ' +
            (soDetFk && soDetQty ? 'COALESCE(sd.so_qty, 0)' : '0') + ' AS soQty, COALESCE(dr.do_docs, 0) AS doDocs, COALESCE(dr.do_qty, 0) AS doQty ' +
            'FROM m5_so so ' + soQtyJoin + ' ' + doJoin + ' WHERE so.sotgl >= ? AND COALESCE(so.sostatus, 0) NOT IN (6, 12)',
            [ACTIVE_CUTOFF_DATE]
          );
          const appDates = [];
          const progDates = [];
          const mismatchDocs = [];
          for (const row of soRows) {
            const docNo = String(row.docNo || row.soid || '');
            const refDate = fmtYmd(row.refDate);
            const st = Number(row.statusCode || 0);
            const isClosed = Number(row.isClosed || 0) === 1;
            const soQty = Number(row.soQty || 0);
            const doDocs = Number(row.doDocs || 0);
            const doQty = Number(row.doQty || 0);
            const hasDo = doDocs > 0 || doQty > QTY_EPSILON;
            const isFull = soQty > QTY_EPSILON && doQty >= soQty - QTY_EPSILON;
            const isPartial = hasDo && (soQty > QTY_EPSILON ? doQty < soQty - QTY_EPSILON : st === 3);
            if (!isClosed && ((st === 2 && hasDo) || (st === 4 && !hasDo))) mismatchDocs.push(docNo);
            if (isClosed || st === 7 || isFull) continue;
            if (isPartial) {
              if (refDate) progDates.push(refDate);
            } else if (!hasDo && (st === 2 || st === 3)) {
              if (refDate) appDates.push(refDate);
            }
          }
          if (mismatchDocs.length > 0) {
            inconsistencies.push({ code: 'so_status_relation_mismatch', sourceTable: 'm5_so', count: mismatchDocs.length, sampleDocNos: mismatchDocs.slice(0, 5), descriptionKey: 'pendingTx.verification.so_status_relation_mismatch' });
          }
          if (allowedSet.has('sales_so_approved_pending')) {
            rules.push(summarizeDates('sales_so_approved_pending', appDates, 'relasi m5_so vs m5_do_detail (Approved, 0 DO)', false));
          }
          if (allowedSet.has('sales_so_in_progress')) {
            rules.push(summarizeDates('sales_so_in_progress', progDates, 'relasi m5_so_detail vs m5_do_detail (parsial)', true));
          }
        } catch {}
      }
    }

    if (tblSet.has('m5_do')) {
      const doCols = await getTableCols(conn, 'm5_do');
      const closeCol = pickExact(doCols, ['doisclose', 'isclose']);
      const doAppCol = pickApproveCol(doCols, 'do');
      approvalDateColumns.m5_do = doAppCol;
      const closeSql = closeCol ? 'AND COALESCE(d.\`' + closeCol + '\`, 0) = 0' : '';
      try { statusCounts.do = await queryStdCounts('m5_do', 'dotgl', 'dostatus', closeCol); } catch {}

      if (allowedSet.has('sales_do_pending_approval')) {
        try {
          const [rows] = await conn.query(
            'SELECT COUNT(*) AS cnt, MIN(d.dotgl) AS oldestDate, ' +
            'COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), d.dotgl) >= ? THEN 1 ELSE 0 END), 0) AS overdueCnt, ' +
            'COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), d.dotgl) >= ? AND DATEDIFF(CURDATE(), d.dotgl) < ? THEN 1 ELSE 0 END), 0) AS warningCnt, ' +
            'COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), d.dotgl) < ? THEN 1 ELSE 0 END), 0) AS normalCnt ' +
            'FROM m5_do d WHERE d.dotgl >= ? ' + closeSql + ' AND COALESCE(d.dostatus, 0) IN (0, 1, 5, 8, 9, 10, 11)',
            [overdueDays, warnDays, overdueDays, warnDays, ACTIVE_CUTOFF_DATE]
          );
          const r = rows[0] || {};
          rules.push({
            ruleId: 'sales_do_pending_approval',
            count: Number(r.cnt || 0),
            oldestDate: fmtYmd(r.oldestDate),
            overdueCount: Number(r.overdueCnt || 0),
            warningCount: Number(r.warningCnt || 0),
            normalCount: Number(r.normalCnt || 0),
            detectionMethod: 'm5_do (dostatus IN 0,1,5,8..11)',
          });
        } catch {}
      }

      if (allowedSet.has('sales_do_pending_si')) {
        try {
          const statusSiCol = pickExact(doCols, ['dostatussi', 'dostatusfaktur', 'dostatusinv', 'doissi']);
          const ageExpr = buildDateExpr('d', 'dotgl', doAppCol);
          let uninvoicedSql = '';
          let method = 'm5_do (dostatus IN 2,3)';
          if (tblSet.has('m5_si') && tblSet.has('m5_si_detail')) {
            const siDetCols = await getTableCols(conn, 'm5_si_detail');
            const idSiCol = pickExact(siDetCols, ['idsi', 'siid', 'idtransaksi']);
            const idDoCol = pickExact(siDetCols, ['iddo', 'doid', 'sidoid', 'diddo', 'idref']);
            if (idSiCol && idDoCol) {
              usedRelationBasis = true;
              uninvoicedSql = 'AND NOT EXISTS (SELECT 1 FROM m5_si_detail sd INNER JOIN m5_si si ON si.siid = sd.\`' + idSiCol + '\` WHERE sd.\`' + idDoCol + '\` = d.doid AND COALESCE(si.sistatus, 0) NOT IN (6, 12))';
              method = 'relasi m5_do (dostatus IN 2,3) NOT EXISTS m5_si_detail.' + idDoCol;
            }
          }
          if (!uninvoicedSql && statusSiCol) {
            uninvoicedSql = 'AND COALESCE(d.\`' + statusSiCol + '\`, 0) = 0';
            method = 'm5_do (dostatus IN 2,3, ' + statusSiCol + '=0)';
          }
          const [rows] = await conn.query(
            'SELECT COUNT(*) AS cnt, MIN(' + ageExpr + ') AS oldestDate, ' +
            'COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ' + ageExpr + ') >= ? THEN 1 ELSE 0 END), 0) AS overdueCnt, ' +
            'COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ' + ageExpr + ') >= ? AND DATEDIFF(CURDATE(), ' + ageExpr + ') < ? THEN 1 ELSE 0 END), 0) AS warningCnt, ' +
            'COALESCE(SUM(CASE WHEN DATEDIFF(CURDATE(), ' + ageExpr + ') < ? THEN 1 ELSE 0 END), 0) AS normalCnt ' +
            'FROM m5_do d WHERE d.dotgl >= ? ' + closeSql + ' AND COALESCE(d.dostatus, 0) IN (2, 3) ' + uninvoicedSql,
            [overdueDays, warnDays, overdueDays, warnDays, ACTIVE_CUTOFF_DATE]
          );
          const r = rows[0] || {};
          rules.push({
            ruleId: 'sales_do_pending_si',
            count: Number(r.cnt || 0),
            oldestDate: fmtYmd(r.oldestDate),
            overdueCount: Number(r.overdueCnt || 0),
            warningCount: Number(r.warningCnt || 0),
            normalCount: Number(r.normalCnt || 0),
            detectionMethod: method,
          });
        } catch {}
      }
    }
  }

  return {
    bridgeVersion: 10,
    cutoffDate: ACTIVE_CUTOFF_DATE,
    rules,
    statusCounts,
    verification: {
      checked: true,
      referenceBasis: usedRelationBasis ? 'relation' : 'status_column_fallback',
      qtyFormula: 'processedQty = GREATEST(SUM(m4_grn_detail.jml), SUM(m4_ri_detail.jml)) via idpodetail/idgrndetail (Draft ikut dihitung, Void/Reject dikecualikan)',
      approvalDateColumns,
      inconsistencies,
    },
    fetchedAt: new Date().toISOString(),
  };
}

// READ-ONLY ERP User & Purchasing Menu Access Matrix (m0_user WITHOUT upassword + m0_user_role(_s) + m0_role_menu(_s) + m0_usergrupmenu)
async function queryMyErpPlusUsersAccess(conn) {
  const MENU_ID_TO_KEY = { 3: 'pr', 7: 'po', 10: 'grn', 11: 'pi', 15: 'vp' };
  const emptyAccess = () => ({ pr: false, po: false, grn: false, pi: false, vp: false });
  const hasBit = (raw) => {
    const s = String(raw ?? '').trim();
    return s.length > 0 && s.includes('1');
  };
  const normRole = (r) => String(r || '').trim().toLowerCase();

  const [tblRows] = await conn.query(
    "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('m0_user', 'm0_user_role', 'm0_user_role_s', 'm0_role_menu', 'm0_role_menu_s', 'm0_usergrupmenu')"
  );
  const tblSet = new Set(tblRows.map((r) => String(r.TABLE_NAME || r.table_name || '').toLowerCase()));
  if (!tblSet.has('m0_user')) {
    return {
      bridgeVersion: 10,
      users: [],
      fetchedAt: new Date().toISOString(),
      warning: 'Tabel m0_user tidak ditemukan di database ERP.',
    };
  }

  // NEVER select upassword
  const [userRows] = await conn.query(
    'SELECT userid, ukode, unama, COALESCE(ulevel, 0) AS ulevel, COALESCE(ugrup, 0) AS ugrup FROM m0_user WHERE COALESCE(uaktif, 1) = 1 ORDER BY unama ASC, ukode ASC'
  );

  const userRolesMap = new Map();
  const addRole = (uid, role) => {
    const clean = String(role || '').trim();
    if (!uid || !clean) return;
    const set = userRolesMap.get(uid) || new Set();
    set.add(clean);
    userRolesMap.set(uid, set);
  };

  if (tblSet.has('m0_user_role')) {
    try {
      const [rows] = await conn.query("SELECT userid, role FROM m0_user_role WHERE role IS NOT NULL AND TRIM(role) <> ''");
      for (const r of rows) addRole(Number(r.userid || 0), r.role);
    } catch {}
  }
  if (tblSet.has('m0_user_role_s')) {
    try {
      const [rows] = await conn.query("SELECT userid, role FROM m0_user_role_s WHERE role IS NOT NULL AND TRIM(role) <> ''");
      for (const r of rows) addRole(Number(r.userid || 0), r.role);
    } catch {}
  }

  const roleMenuMap = new Map();
  const grantRole = (roleName, menuId, rawAkses) => {
    const key = MENU_ID_TO_KEY[Number(menuId || 0)];
    if (!key || !hasBit(rawAkses)) return;
    const nk = normRole(roleName);
    if (!nk) return;
    const perms = roleMenuMap.get(nk) || emptyAccess();
    perms[key] = true;
    roleMenuMap.set(nk, perms);
  };

  if (tblSet.has('m0_role_menu')) {
    try {
      const [rows] = await conn.query('SELECT rmrole, rmmenuid, rmakses FROM m0_role_menu WHERE rmmoduleid = 4 AND rmmenuid IN (3, 7, 10, 11, 15)');
      for (const r of rows) grantRole(r.rmrole, r.rmmenuid, r.rmakses);
    } catch {}
  }
  if (tblSet.has('m0_role_menu_s')) {
    try {
      const [rows] = await conn.query('SELECT rmrole, rmmenuid, rmakses FROM m0_role_menu_s WHERE rmmoduleid = 4 AND rmmenuid IN (3, 7, 10, 11, 15)');
      for (const r of rows) grantRole(r.rmrole, r.rmmenuid, r.rmakses);
    } catch {}
  }

  const groupMenuMap = new Map();
  if (tblSet.has('m0_usergrupmenu')) {
    try {
      const [rows] = await conn.query('SELECT ugmusergrup, ugmmenuid, ugmakses FROM m0_usergrupmenu WHERE ugmmoduleid = 4 AND ugmmenuid IN (3, 7, 10, 11, 15)');
      for (const r of rows) {
        const gid = Number(r.ugmusergrup || 0);
        const key = MENU_ID_TO_KEY[Number(r.ugmmenuid || 0)];
        if (!gid || !key || !hasBit(r.ugmakses)) continue;
        const perms = groupMenuMap.get(gid) || emptyAccess();
        perms[key] = true;
        groupMenuMap.set(gid, perms);
      }
    } catch {}
  }

  const users = userRows.map((u) => {
    const erpUserId = Number(u.userid || 0);
    const erpUserCode = String(u.ukode || '').trim();
    const erpUserName = String(u.unama || erpUserCode || ('User #' + erpUserId)).trim();
    const level = Number(u.ulevel || 0);
    const groupId = Number(u.ugrup || 0);
    const roles = Array.from(userRolesMap.get(erpUserId) || []).sort((a, b) => a.localeCompare(b));
    const purchasingAccess = emptyAccess();

    for (const rn of roles) {
      const rp = roleMenuMap.get(normRole(rn));
      if (rp) {
        if (rp.pr) purchasingAccess.pr = true;
        if (rp.po) purchasingAccess.po = true;
        if (rp.grn) purchasingAccess.grn = true;
        if (rp.pi) purchasingAccess.pi = true;
        if (rp.vp) purchasingAccess.vp = true;
      }
    }
    if (roles.length === 0 && groupId > 0) {
      const gp = groupMenuMap.get(groupId);
      if (gp) {
        if (gp.pr) purchasingAccess.pr = true;
        if (gp.po) purchasingAccess.po = true;
        if (gp.grn) purchasingAccess.grn = true;
        if (gp.pi) purchasingAccess.pi = true;
        if (gp.vp) purchasingAccess.vp = true;
      }
    }

    return { erpUserId, erpUserCode, erpUserName, level, groupId, roles, purchasingAccess };
  });

  return {
    bridgeVersion: 13,
    users,
    fetchedAt: new Date().toISOString(),
  };
}

function listBiMonthsBetween(startYm, endYm) {
  const out = [];
  if (!/^\\d{4}-\\d{2}$/.test(startYm) || !/^\\d{4}-\\d{2}$/.test(endYm)) return out;
  let cur = startYm;
  let guard = 0;
  while (cur <= endYm && guard < 36) {
    out.push(cur);
    cur = shiftMonthYm(cur, 1);
    guard += 1;
  }
  return out;
}

function isBiIntransitWh(val) {
  const raw = String(val || '').trim();
  if (!raw) return false;
  return /\\bin[\\s_-]*transit\\b/i.test(raw) || raw.toLowerCase().replace(/[\\s_-]+/g, '').includes('intransit');
}

function pickBiColByRegex(cols, patterns) {
  for (const rx of patterns) {
    const found = (cols || []).find((c) => rx.test(String(c).toLowerCase()) && SAFE_ID.test(String(c)));
    if (found) return found;
  }
  return null;
}

async function queryMyErpPlusPurchasingBi(conn, opts) {
  const dateFrom = clampActiveDateFrom(opts.dateFrom);
  const dateTo = /^\\d{4}-\\d{2}-\\d{2}$/.test(opts.dateTo || '') && opts.dateTo >= dateFrom
    ? opts.dateTo
    : new Date().toISOString().slice(0, 10);

  const months = listBiMonthsBetween(dateFrom.slice(0, 7), dateTo.slice(0, 7));
  const lookbackStartMonth = months.length > 0 ? shiftMonthYm(months[0], -3) : dateFrom.slice(0, 7);
  const lookbackFromDate = lookbackStartMonth + '-01';
  const effectiveFrom = dateFrom < ACTIVE_CUTOFF_DATE ? ACTIVE_CUTOFF_DATE : dateFrom;
  const effectiveTo = dateTo;

  const pickExactOrPat = (cols, exact, pats) => {
    if (!Array.isArray(cols)) return null;
    const lowerMap = new Map();
    for (const c of cols) lowerMap.set(String(c).toLowerCase(), String(c));
    for (const cand of exact || []) {
      const f = lowerMap.get(String(cand).toLowerCase());
      if (f && SAFE_ID.test(f)) return f;
    }
    for (const p of pats || []) {
      const f = cols.find((c) => p.test(String(c)) && SAFE_ID.test(String(c)));
      if (f) return f;
    }
    return null;
  };
  const statusExcl = (alias, col) => {
    if (!col) return '1=1';
    const ref = alias + '.\`' + col + '\`';
    return "(" + ref + " IS NULL OR COALESCE(" + ref + ", 0) NOT IN (6, 12))";
  };
  const toN = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

  const tableNames = ['m4_po','m4_po_detail','m4_grn','m4_grn_detail','m4_ri','m4_ri_detail','m4_prt','m4_prt_detail','m4_vp','m4_vp_detail','m1_contact','m1_item'];
  const tableCols = {};
  for (const t of tableNames) {
    try {
      const cols = await getTableCols(conn, t);
      tableCols[t] = cols && cols.length ? cols : null;
    } catch { tableCols[t] = null; }
  }
  const tablesDetected = tableNames.filter((t) => Array.isArray(tableCols[t]));

  let minDateAll = '', maxDateAll = '', minDateActive = '', maxDateActive = '';
  const riCols = tableCols['m4_ri'], poCols = tableCols['m4_po'];
  const riSet = new Set((riCols || []).map((c) => c.toLowerCase()));
  const riDateCol = pickExactOrPat(riCols, ['ritgl','ri_tgl','tanggal'], [/tgl|date/i]);
  const riStatusCol = pickExactOrPat(riCols, ['ristatus','status'], [/status/i]);
  const poDateCol = pickExactOrPat(poCols, ['potgl','po_tgl','tanggal'], [/tgl|date/i]);
  const poStatusCol = pickExactOrPat(poCols, ['postatus','status'], [/status/i]);

  if (riCols && riDateCol) {
    try {
      const [covRows] = await conn.query(
        "SELECT DATE_FORMAT(MIN(r.\`" + riDateCol + "\`),'%Y-%m-%d') AS min_all, DATE_FORMAT(MAX(r.\`" + riDateCol + "\`),'%Y-%m-%d') AS max_all, DATE_FORMAT(MIN(CASE WHEN r.\`" + riDateCol + "\` >= ? THEN r.\`" + riDateCol + "\` END),'%Y-%m-%d') AS min_act, DATE_FORMAT(MAX(CASE WHEN r.\`" + riDateCol + "\` >= ? THEN r.\`" + riDateCol + "\` END),'%Y-%m-%d') AS max_act FROM m4_ri r WHERE " + statusExcl('r', riStatusCol) + " AND r.\`" + riDateCol + "\` > '2000-01-01'",
        [ACTIVE_CUTOFF_DATE, ACTIVE_CUTOFF_DATE]
      );
      if (covRows[0]) {
        minDateAll = String(covRows[0].min_all || ''); maxDateAll = String(covRows[0].max_all || '');
        minDateActive = String(covRows[0].min_act || ''); maxDateActive = String(covRows[0].max_act || '');
      }
    } catch {}
  } else if (poCols && poDateCol) {
    try {
      const [covRows] = await conn.query(
        "SELECT DATE_FORMAT(MIN(p.\`" + poDateCol + "\`),'%Y-%m-%d') AS min_all, DATE_FORMAT(MAX(p.\`" + poDateCol + "\`),'%Y-%m-%d') AS max_all, DATE_FORMAT(MIN(CASE WHEN p.\`" + poDateCol + "\` >= ? THEN p.\`" + poDateCol + "\` END),'%Y-%m-%d') AS min_act, DATE_FORMAT(MAX(CASE WHEN p.\`" + poDateCol + "\` >= ? THEN p.\`" + poDateCol + "\` END),'%Y-%m-%d') AS max_act FROM m4_po p WHERE " + statusExcl('p', poStatusCol) + " AND p.\`" + poDateCol + "\` > '2000-01-01'",
        [ACTIVE_CUTOFF_DATE, ACTIVE_CUTOFF_DATE]
      );
      if (covRows[0]) {
        minDateAll = String(covRows[0].min_all || ''); maxDateAll = String(covRows[0].max_all || '');
        minDateActive = String(covRows[0].min_act || ''); maxDateActive = String(covRows[0].max_act || '');
      }
    } catch {}
  }

  const masterSuppliers = { total: 0, active: 0, inactive: 0 };
  const contactCols = tableCols['m1_contact'];
  const cIdCol = pickExactOrPat(contactCols, ['kid','cid','id'], [/^(k|c)?id$/i]);
  const cCodeCol = pickExactOrPat(contactCols, ['kkode','ckode','kode'], [/kode|code/i]);
  const cNameCol = pickExactOrPat(contactCols, ['knama','cnama','nama'], [/nama|name/i]);
  const cSuppFlag = pickExactOrPat(contactCols, ['kissupplier','ksupplier','cissupplier','cisvendor','issupplier'], [/supplier|vendor/i]);
  const cAktifCol = pickExactOrPat(contactCols, ['kaktif','caktif','cisactive','isactive','aktif'], [/aktif|active/i]);
  if (contactCols && cIdCol) {
    try {
      const whereSupp = cSuppFlag ? 'WHERE COALESCE(c.\`' + cSuppFlag + '\`, 0) = 1' : '';
      const activeExpr = cAktifCol ? "SUM(CASE WHEN COALESCE(c.\`" + cAktifCol + "\`, 1) IN (1,'1','Y','y','Active') THEN 1 ELSE 0 END)" : 'COUNT(*)';
      const [msRows] = await conn.query('SELECT COUNT(*) AS total_cnt, ' + activeExpr + ' AS active_cnt FROM m1_contact c ' + whereSupp);
      if (msRows[0]) {
        masterSuppliers.total = toN(msRows[0].total_cnt);
        masterSuppliers.active = toN(msRows[0].active_cnt);
        masterSuppliers.inactive = Math.max(0, masterSuppliers.total - masterSuppliers.active);
      }
    } catch {}
  }

  const monthlyMap = new Map();
  for (const ym of months) {
    monthlyMap.set(ym, {
      month: ym,
      activeSuppliersRi: 0, prevSuppliersRi: 0, activeSuppliersPo: 0, prevSuppliersPo: 0,
      churnedSuppliersPrevMonth: 0, churnedSuppliersRolling3m: 0,
      poCount: 0, prevPoCount: 0,
      poItemQty: 0, poRealizedQty: 0, poOrderValue: 0, poRealizedValue: 0,
      poCompleteCount: 0, poCompleteOrCloseCount: 0, poTotalValue: 0, poCompleteValue: 0, poCompleteOrCloseValue: 0,
      ppiPrevTotalPrice: 0, ppiCurrTotalPrice: 0, ppiItemCount: 0, ppiPct: 0,
      grnTotalCount: 0, grnLinkedPoCount: 0, grnOnTimeCount: 0,
      riTotalCount: 0, riLinkedPoCount: 0, riOnTimeCount: 0,
      returnDocCount: 0, riInvoiceCount: 0, returnQty: 0, purchasedQty: 0,
      returnValueIdr: 0, riDppIdr: 0, mismatchQty: 0, receivedQty: 0,
    });
  }

  const itemCols = tableCols['m1_item'];
  const iIdCol = pickExactOrPat(itemCols, ['bid','iid','id'], [/^(b|i)?id$/i]);
  const iCodeCol = pickExactOrPat(itemCols, ['bkode','ikode','kode'], [/kode|code/i]);
  const iNameCol = pickExactOrPat(itemCols, ['bnama','inama','nama'], [/nama|name/i]);

  const riSuppCol = pickExactOrPat(riCols, ['risupplier','rikontak','idcontact','idsupplier'], [/supplier|kontak|vendor|contact/i]);
  const riKursCol = pickExactOrPat(riCols, ['rikurs','kurs'], [/kurs|rate/i]);
  const riTotalCol = pickExactOrPat(riCols, ['ritotaltransaksi','ritotal','total'], [/totaltransaksi|total/i]);
  const riDppCol = pickExactOrPat(riCols, ['ritotaldpp','ridpp','risubtotal'], [/dpp|subtotal/i]);
  const riPaidCol = pickExactOrPat(riCols, ['rijmlbayar','ritotalbayar','ribayar'], [/bayar|paid|payment/i]);
  const riDpCol = pickExactOrPat(riCols, ['rijmluangmuka'], [/uangmuka/i]);
  const riBalanceCol = pickExactOrPat(riCols, ['risisahutang','risisa','ribalance'], [/sisa|balance|hutang/i]);
  const riIdCol = pickExactOrPat(riCols, ['riid','id'], [/^ri?id$/i]);
  const riPoFkCol = pickExactOrPat(riCols, ['riidpo','idpo'], [/idpo|poid/i]);
  const riGrnFkCol = pickExactOrPat(riCols, ['riidgrn','idgrn'], [/idgrn|grnid/i]);

  const poIdCol = pickExactOrPat(poCols, ['poid','id'], [/^po?id$/i]);
  const poSuppCol = pickExactOrPat(poCols, ['posupplier','pokontak','idcontact','idsupplier'], [/supplier|kontak|vendor|contact/i]);
  const poKursCol = pickExactOrPat(poCols, ['pokurs','kurs'], [/kurs|rate/i]);
  const poTotalCol = pickExactOrPat(poCols, ['pototaltransaksi','pototal','total'], [/totaltransaksi|total/i]);
  const poIsCloseCol = pickExactOrPat(poCols, ['poisclose','isclose','poclosed'], [/isclose|closed/i]);
  const poTargetDateCol = pickExactOrPat(poCols, ['potgldipenuhi','potglkirim','potgldelivery','potglduedate','potgljatuhtempo'], [/dipenuhi|delivery|kirim|due|target/i]);

  const riSuppliersByMonth = new Map();
  if (riCols && riDateCol && riSuppCol) {
    try {
      const [rows] = await conn.query(
        "SELECT DATE_FORMAT(r.\`" + riDateCol + "\`,'%Y-%m') AS ym, r.\`" + riSuppCol + "\` AS supp_id FROM m4_ri r WHERE r.\`" + riDateCol + "\` >= ? AND r.\`" + riDateCol + "\` <= ? AND r.\`" + riSuppCol + "\` IS NOT NULL AND r.\`" + riSuppCol + "\` > 0 AND " + statusExcl('r', riStatusCol) + " GROUP BY ym, supp_id",
        [lookbackFromDate, effectiveTo]
      );
      for (const r of rows) {
        const ym = String(r.ym || ''), sid = toN(r.supp_id);
        if (!ym || !sid) continue;
        if (!riSuppliersByMonth.has(ym)) riSuppliersByMonth.set(ym, new Set());
        riSuppliersByMonth.get(ym).add(sid);
      }
    } catch {}
  }

  const poSuppliersByMonth = new Map();
  const poCountByMonth = new Map();
  if (poCols && poDateCol) {
    try {
      const kursExpr = poKursCol ? 'COALESCE(NULLIF(p.\`' + poKursCol + '\`, 0), 1)' : '1';
      const totalExpr = poTotalCol ? 'COALESCE(p.\`' + poTotalCol + '\`, 0) * ' + kursExpr : '0';
      const completeExpr = poStatusCol ? 'CASE WHEN COALESCE(p.\`' + poStatusCol + '\`,0) = 4 THEN 1 ELSE 0 END' : '0';
      const closeOrCompleteExpr = (poStatusCol && poIsCloseCol)
        ? 'CASE WHEN COALESCE(p.\`' + poStatusCol + '\`,0) IN (4,7) OR COALESCE(p.\`' + poIsCloseCol + '\`,0)=1 THEN 1 ELSE 0 END'
        : poStatusCol
          ? 'CASE WHEN COALESCE(p.\`' + poStatusCol + '\`,0) IN (4,7) THEN 1 ELSE 0 END'
          : '0';
      const [poRows] = await conn.query(
        "SELECT DATE_FORMAT(p.\`" + poDateCol + "\`,'%Y-%m') AS ym, COUNT(*) AS po_cnt, SUM(" + completeExpr + ") AS comp_cnt, SUM(" + closeOrCompleteExpr + ") AS close_cnt, SUM(" + totalExpr + ") AS total_val, SUM(CASE WHEN (" + completeExpr + ")=1 THEN " + totalExpr + " ELSE 0 END) AS comp_val, SUM(CASE WHEN (" + closeOrCompleteExpr + ")=1 THEN " + totalExpr + " ELSE 0 END) AS close_val FROM m4_po p WHERE p.\`" + poDateCol + "\` >= ? AND p.\`" + poDateCol + "\` <= ? AND " + statusExcl('p', poStatusCol) + " GROUP BY ym",
        [lookbackFromDate, effectiveTo]
      );
      for (const r of poRows) {
        const ym = String(r.ym || '');
        if (!ym) continue;
        poCountByMonth.set(ym, toN(r.po_cnt));
        const b = monthlyMap.get(ym);
        if (b) {
          b.poCount = toN(r.po_cnt); b.poCompleteCount = toN(r.comp_cnt); b.poCompleteOrCloseCount = toN(r.close_cnt);
          b.poTotalValue = toN(r.total_val); b.poCompleteValue = toN(r.comp_val); b.poCompleteOrCloseValue = toN(r.close_val);
        }
      }
      if (poSuppCol) {
        const [psRows] = await conn.query(
          "SELECT DATE_FORMAT(p.\`" + poDateCol + "\`,'%Y-%m') AS ym, p.\`" + poSuppCol + "\` AS supp_id FROM m4_po p WHERE p.\`" + poDateCol + "\` >= ? AND p.\`" + poDateCol + "\` <= ? AND p.\`" + poSuppCol + "\` IS NOT NULL AND p.\`" + poSuppCol + "\` > 0 AND " + statusExcl('p', poStatusCol) + " GROUP BY ym, supp_id",
          [lookbackFromDate, effectiveTo]
        );
        for (const r of psRows) {
          const ym = String(r.ym || ''), sid = toN(r.supp_id);
          if (!ym || !sid) continue;
          if (!poSuppliersByMonth.has(ym)) poSuppliersByMonth.set(ym, new Set());
          poSuppliersByMonth.get(ym).add(sid);
        }
      }
    } catch {}
  }

  for (const ym of months) {
    const row = monthlyMap.get(ym);
    const p1 = shiftMonthYm(ym, -1), p2 = shiftMonthYm(ym, -2), p3 = shiftMonthYm(ym, -3);
    const currRi = riSuppliersByMonth.get(ym) || new Set();
    const prevRi = riSuppliersByMonth.get(p1) || new Set();
    const currPo = poSuppliersByMonth.get(ym) || new Set();
    const prevPo = poSuppliersByMonth.get(p1) || new Set();
    row.activeSuppliersRi = currRi.size; row.prevSuppliersRi = prevRi.size;
    row.activeSuppliersPo = currPo.size; row.prevSuppliersPo = prevPo.size;
    row.prevPoCount = poCountByMonth.get(p1) || 0;
    let cPrev = 0;
    for (const sid of prevRi) { if (!currRi.has(sid)) cPrev += 1; }
    row.churnedSuppliersPrevMonth = cPrev;
    const roll = new Set();
    for (const py of [p1, p2, p3]) { const s = riSuppliersByMonth.get(py); if (s) for (const sid of s) roll.add(sid); }
    let c3 = 0;
    for (const sid of roll) { if (!currRi.has(sid)) c3 += 1; }
    row.churnedSuppliersRolling3m = c3;
  }

  const supplierSpendMap = new Map();
  if (riCols && riDateCol) {
    try {
      const kursExpr = riKursCol ? 'COALESCE(NULLIF(r.\`' + riKursCol + '\`, 0), 1)' : '1';
      const hasTaxParts = riSet.has('rihargatermasukpajak') && riSet.has('ritotalpajak1detail') && riSet.has('ritotalpajak2detail') && riSet.has('ritotal') && riSet.has('rijmldiskon');
      const dppBase = hasTaxParts
        ? '(CASE WHEN COALESCE(r.rihargatermasukpajak,0)=1 THEN (COALESCE(r.ritotaltransaksi,0) - COALESCE(r.ritotalpajak1detail,0) - COALESCE(r.ritotalpajak2detail,0)) ELSE (COALESCE(r.ritotal,0) - COALESCE(r.rijmldiskon,0)) END)'
        : riDppCol ? 'COALESCE(r.\`' + riDppCol + '\`, 0)'
        : riTotalCol ? 'COALESCE(r.\`' + riTotalCol + '\`, 0)' : '0';
      const totBase = riTotalCol ? 'COALESCE(r.\`' + riTotalCol + '\`, 0)' : dppBase;
      const dppIdr = '(' + dppBase + ' * ' + kursExpr + ')';
      const paidBase = riPaidCol && riDpCol
        ? '(COALESCE(r.\`' + riPaidCol + '\`, 0) + COALESCE(r.\`' + riDpCol + '\`, 0))'
        : riPaidCol ? 'COALESCE(r.\`' + riPaidCol + '\`, 0)'
        : riBalanceCol ? 'GREATEST(0, ' + totBase + ' - COALESCE(r.\`' + riBalanceCol + '\`, 0))' : '0';
      const payBase = riBalanceCol ? 'GREATEST(0, COALESCE(r.\`' + riBalanceCol + '\`, 0))'
        : riPaidCol ? 'GREATEST(0, ' + totBase + ' - ' + paidBase + ')' : '0';
      const paidIdr = '(' + paidBase + ' * ' + kursExpr + ')';
      const payIdr = '(' + payBase + ' * ' + kursExpr + ')';

      const [riMon] = await conn.query(
        "SELECT DATE_FORMAT(r.\`" + riDateCol + "\`,'%Y-%m') AS ym, COUNT(*) AS inv_cnt, SUM(" + dppIdr + ") AS dpp_idr FROM m4_ri r WHERE r.\`" + riDateCol + "\` >= ? AND r.\`" + riDateCol + "\` <= ? AND " + statusExcl('r', riStatusCol) + " GROUP BY ym",
        [effectiveFrom, effectiveTo]
      );
      for (const r of riMon) {
        const b = monthlyMap.get(String(r.ym || ''));
        if (b) { b.riInvoiceCount = toN(r.inv_cnt); b.riTotalCount = toN(r.inv_cnt); b.riDppIdr = toN(r.dpp_idr); }
      }
      if (riSuppCol) {
        const cJoin = (contactCols && cIdCol) ? 'LEFT JOIN m1_contact c ON c.\`' + cIdCol + '\` = r.\`' + riSuppCol + '\`' : '';
        const cCodeSel = cCodeCol ? "COALESCE(NULLIF(TRIM(c.\`" + cCodeCol + "\`), ''), CAST(r.\`" + riSuppCol + "\` AS CHAR))" : "CAST(r.\`" + riSuppCol + "\` AS CHAR)";
        const cNameSel = cNameCol ? "COALESCE(NULLIF(TRIM(c.\`" + cNameCol + "\`), ''), CONCAT('Supplier #', r.\`" + riSuppCol + "\`))" : "CONCAT('Supplier #', r.\`" + riSuppCol + "\`)";
        const [sRows] = await conn.query(
          "SELECT r.\`" + riSuppCol + "\` AS supp_id, " + cCodeSel + " AS supp_code, " + cNameSel + " AS supp_name, COUNT(*) AS inv_cnt, SUM(" + dppIdr + ") AS dpp_idr, SUM(" + paidIdr + ") AS paid_idr, SUM(" + payIdr + ") AS payable_idr FROM m4_ri r " + cJoin + " WHERE r.\`" + riDateCol + "\` >= ? AND r.\`" + riDateCol + "\` <= ? AND r.\`" + riSuppCol + "\` IS NOT NULL AND r.\`" + riSuppCol + "\` > 0 AND " + statusExcl('r', riStatusCol) + " GROUP BY supp_id, supp_code, supp_name ORDER BY dpp_idr DESC",
          [effectiveFrom, effectiveTo]
        );
        const totDpp = sRows.reduce((s, x) => s + Math.max(0, toN(x.dpp_idr)), 0);
        for (const r of sRows) {
          const sid = toN(r.supp_id), dpp = toN(r.dpp_idr);
          supplierSpendMap.set(sid, {
            supplierId: sid, supplierCode: String(r.supp_code || 'SUP-' + sid), supplierName: String(r.supp_name || 'Supplier #' + sid),
            invoiceCount: toN(r.inv_cnt), dppIdr: dpp, paidIdr: toN(r.paid_idr), payableIdr: toN(r.payable_idr),
            sharePct: totDpp > 0 ? (dpp / totDpp) * 100 : 0, returnValueIdr: 0, grnLinkedCount: 0, grnOnTimeCount: 0, otdPct: null,
          });
        }
      }
    } catch {}
  }

  let realizationSource = 'unavailable';
  const podCols = tableCols['m4_po_detail'], grnCols = tableCols['m4_grn'], grndCols = tableCols['m4_grn_detail'], ridCols = tableCols['m4_ri_detail'];
  const podIdCol = pickExactOrPat(podCols, ['idpodetail','podetailid','podid','id'], [/idpodetail|podid/i]);
  const podPoFkCol = pickExactOrPat(podCols, ['idpo','poid','podidpo'], [/idpo|poid/i]);
  const podItemCol = pickExactOrPat(podCols, ['idbarang','iditem','bid','podiditem','itemid'], [/idbarang|iditem|itemid/i]);
  const podQtyCol = pickExactOrPat(podCols, ['jml','qty','jumlah','podjml','podqty','dqty'], [/jml|qty|jumlah/i]);
  const podRealQtyCol = pickExactOrPat(podCols, ['jmlterima','podqtyterima','podqtygrn','podqtyproses'], [/terima|qtygrn|qtyproses|realisasi/i]);
  const podPriceCol = pickExactOrPat(podCols, ['harga','dharga','podharga','hargasatuan'], [/harga|price/i]);
  const podSubCol = pickExactOrPat(podCols, ['subtotal','podsubtotal','total','podtotal'], [/subtotal|total/i]);

  const grnIdCol = pickExactOrPat(grnCols, ['grnid','id'], [/^grn?id$/i]);
  const grnDateCol = pickExactOrPat(grnCols, ['grntgl','tanggal'], [/tgl|date/i]);
  const grnStatusCol = pickExactOrPat(grnCols, ['grnstatus','status'], [/status/i]);
  const grnPoFkCol = pickExactOrPat(grnCols, ['grnidpo','idpo','poid'], [/idpo|poid/i]);
  const grnSuppCol = pickExactOrPat(grnCols, ['grnsupplier','grnkontak','idsupplier','idcontact'], [/supplier|kontak|vendor|contact/i]);

  const grndGrnFkCol = pickExactOrPat(grndCols, ['idgrn','grnid','grndidgrn'], [/idgrn|grnid/i]);
  const grndPodFkCol = pickExactOrPat(grndCols, ['idpodetail','podetailid','grndidpodetail'], [/idpodetail|podetail/i]);
  const grndItemCol = pickExactOrPat(grndCols, ['idbarang','iditem','bid','grndiditem','itemid'], [/idbarang|iditem|itemid/i]);
  const grndQtyCol = pickExactOrPat(grndCols, ['jml','qty','jumlah','grndjml','grndqty'], [/jml|qty|jumlah/i]);

  const ridRiFkCol = pickExactOrPat(ridCols, ['idri','riid','rididri'], [/idri|riid/i]);
  const ridPodFkCol = pickExactOrPat(ridCols, ['idpodetail','podetailid','rididpodetail'], [/idpodetail|podetail/i]);
  const ridItemCol = pickExactOrPat(ridCols, ['idbarang','iditem','bid','rididitem','itemid'], [/idbarang|iditem|itemid/i]);
  const ridQtyCol = pickExactOrPat(ridCols, ['jml','qty','jumlah','ridjml','ridqty','dqty'], [/jml|qty|jumlah/i]);
  const ridPriceCol = pickExactOrPat(ridCols, ['harga','dharga','ridharga','hargasatuan'], [/harga|price/i]);

  if (poCols && poIdCol && poDateCol && podCols && podPoFkCol && podQtyCol) {
    try {
      const poKursExpr = poKursCol ? 'COALESCE(NULLIF(p.\`' + poKursCol + '\`, 0), 1)' : '1';
      const lineVal = podSubCol ? 'COALESCE(pd.\`' + podSubCol + '\`, 0) * ' + poKursExpr
        : podPriceCol ? '(COALESCE(pd.\`' + podQtyCol + '\`, 0) * COALESCE(pd.\`' + podPriceCol + '\`, 0) * ' + poKursExpr + ')' : '0';
      const unitVal = podPriceCol ? '(COALESCE(pd.\`' + podPriceCol + '\`, 0) * ' + poKursExpr + ')'
        : podSubCol ? '(CASE WHEN COALESCE(pd.\`' + podQtyCol + '\`, 0) > 0 THEN (COALESCE(pd.\`' + podSubCol + '\`, 0) / pd.\`' + podQtyCol + '\`) * ' + poKursExpr + ' ELSE 0 END)' : '0';

      if (podIdCol && grnCols && grnIdCol && grndCols && grndGrnFkCol && grndPodFkCol && grndQtyCol) {
        realizationSource = 'm4_grn_detail';
        const [rows] = await conn.query(
          "SELECT DATE_FORMAT(p.\`" + poDateCol + "\`,'%Y-%m') AS ym, SUM(COALESCE(pd.\`" + podQtyCol + "\`,0)) AS po_qty, SUM(LEAST(COALESCE(pd.\`" + podQtyCol + "\`,0), COALESCE(g_agg.grn_qty,0))) AS real_qty, SUM(" + lineVal + ") AS po_val, SUM(LEAST(COALESCE(pd.\`" + podQtyCol + "\`,0), COALESCE(g_agg.grn_qty,0)) * " + unitVal + ") AS real_val FROM m4_po p INNER JOIN m4_po_detail pd ON pd.\`" + podPoFkCol + "\` = p.\`" + poIdCol + "\` LEFT JOIN (SELECT gd.\`" + grndPodFkCol + "\` AS pod_id, SUM(COALESCE(gd.\`" + grndQtyCol + "\`,0)) AS grn_qty FROM m4_grn_detail gd INNER JOIN m4_grn g ON g.\`" + grnIdCol + "\` = gd.\`" + grndGrnFkCol + "\` WHERE " + statusExcl('g', grnStatusCol) + " GROUP BY gd.\`" + grndPodFkCol + "\`) g_agg ON g_agg.pod_id = pd.\`" + podIdCol + "\` WHERE p.\`" + poDateCol + "\` >= ? AND p.\`" + poDateCol + "\` <= ? AND " + statusExcl('p', poStatusCol) + " GROUP BY ym",
          [effectiveFrom, effectiveTo]
        );
        for (const r of rows) { const b = monthlyMap.get(String(r.ym || '')); if (b) { b.poItemQty = toN(r.po_qty); b.poRealizedQty = toN(r.real_qty); b.poOrderValue = toN(r.po_val); b.poRealizedValue = toN(r.real_val); } }
      } else if (podIdCol && riCols && riIdCol && ridCols && ridRiFkCol && ridPodFkCol && ridQtyCol) {
        realizationSource = 'm4_ri_detail';
        const [rows] = await conn.query(
          "SELECT DATE_FORMAT(p.\`" + poDateCol + "\`,'%Y-%m') AS ym, SUM(COALESCE(pd.\`" + podQtyCol + "\`,0)) AS po_qty, SUM(LEAST(COALESCE(pd.\`" + podQtyCol + "\`,0), COALESCE(ri_agg.ri_qty,0))) AS real_qty, SUM(" + lineVal + ") AS po_val, SUM(LEAST(COALESCE(pd.\`" + podQtyCol + "\`,0), COALESCE(ri_agg.ri_qty,0)) * " + unitVal + ") AS real_val FROM m4_po p INNER JOIN m4_po_detail pd ON pd.\`" + podPoFkCol + "\` = p.\`" + poIdCol + "\` LEFT JOIN (SELECT rd.\`" + ridPodFkCol + "\` AS pod_id, SUM(COALESCE(rd.\`" + ridQtyCol + "\`,0)) AS ri_qty FROM m4_ri_detail rd INNER JOIN m4_ri r ON r.\`" + riIdCol + "\` = rd.\`" + ridRiFkCol + "\` WHERE " + statusExcl('r', riStatusCol) + " GROUP BY rd.\`" + ridPodFkCol + "\`) ri_agg ON ri_agg.pod_id = pd.\`" + podIdCol + "\` WHERE p.\`" + poDateCol + "\` >= ? AND p.\`" + poDateCol + "\` <= ? AND " + statusExcl('p', poStatusCol) + " GROUP BY ym",
          [effectiveFrom, effectiveTo]
        );
        for (const r of rows) { const b = monthlyMap.get(String(r.ym || '')); if (b) { b.poItemQty = toN(r.po_qty); b.poRealizedQty = toN(r.real_qty); b.poOrderValue = toN(r.po_val); b.poRealizedValue = toN(r.real_val); } }
      } else if (podRealQtyCol) {
        realizationSource = 'm4_po_detail';
        const [rows] = await conn.query(
          "SELECT DATE_FORMAT(p.\`" + poDateCol + "\`,'%Y-%m') AS ym, SUM(COALESCE(pd.\`" + podQtyCol + "\`,0)) AS po_qty, SUM(LEAST(COALESCE(pd.\`" + podQtyCol + "\`,0), COALESCE(pd.\`" + podRealQtyCol + "\`,0))) AS real_qty, SUM(" + lineVal + ") AS po_val, SUM(LEAST(COALESCE(pd.\`" + podQtyCol + "\`,0), COALESCE(pd.\`" + podRealQtyCol + "\`,0)) * " + unitVal + ") AS real_val FROM m4_po p INNER JOIN m4_po_detail pd ON pd.\`" + podPoFkCol + "\` = p.\`" + poIdCol + "\` WHERE p.\`" + poDateCol + "\` >= ? AND p.\`" + poDateCol + "\` <= ? AND " + statusExcl('p', poStatusCol) + " GROUP BY ym",
          [effectiveFrom, effectiveTo]
        );
        for (const r of rows) { const b = monthlyMap.get(String(r.ym || '')); if (b) { b.poItemQty = toN(r.po_qty); b.poRealizedQty = toN(r.real_qty); b.poOrderValue = toN(r.po_val); b.poRealizedValue = toN(r.real_val); } }
      } else {
        realizationSource = 'm4_po_status';
        for (const b of monthlyMap.values()) { b.poItemQty = b.poCount; b.poRealizedQty = b.poCompleteOrCloseCount; b.poOrderValue = b.poTotalValue; b.poRealizedValue = b.poCompleteOrCloseValue; }
      }
    } catch {}
  }

  const ppiDetailsByMonth = {};
  if (riCols && riIdCol && riDateCol && ridCols && ridRiFkCol && ridItemCol && ridPriceCol) {
    try {
      const kursExpr = riKursCol ? 'COALESCE(NULLIF(r.\`' + riKursCol + '\`, 0), 1)' : '1';
      const itJoin = (itemCols && iIdCol) ? 'LEFT JOIN m1_item it ON it.\`' + iIdCol + '\` = rd.\`' + ridItemCol + '\`' : '';
      const iCodeSel = iCodeCol ? "COALESCE(NULLIF(TRIM(it.\`" + iCodeCol + "\`), ''), CAST(rd.\`" + ridItemCol + "\` AS CHAR))" : "CAST(rd.\`" + ridItemCol + "\` AS CHAR)";
      const iNameSel = iNameCol ? "COALESCE(NULLIF(TRIM(it.\`" + iNameCol + "\`), ''), CONCAT('Item #', rd.\`" + ridItemCol + "\`))" : "CONCAT('Item #', rd.\`" + ridItemCol + "\`)";
      const ppiFrom = months.length > 0 ? shiftMonthYm(months[0], -1) + '-01' : lookbackFromDate;
      const [pRows] = await conn.query(
        "SELECT DATE_FORMAT(r.\`" + riDateCol + "\`,'%Y-%m') AS ym, rd.\`" + ridItemCol + "\` AS item_id, " + iCodeSel + " AS item_code, " + iNameSel + " AS item_name, (COALESCE(rd.\`" + ridPriceCol + "\`,0) * " + kursExpr + ") AS unit_price_idr FROM m4_ri_detail rd INNER JOIN m4_ri r ON r.\`" + riIdCol + "\` = rd.\`" + ridRiFkCol + "\` " + itJoin + " WHERE r.\`" + riDateCol + "\` >= ? AND r.\`" + riDateCol + "\` <= ? AND COALESCE(rd.\`" + ridPriceCol + "\`,0) > 0 AND " + statusExcl('r', riStatusCol) + " ORDER BY r.\`" + riDateCol + "\` ASC, r.\`" + riIdCol + "\` ASC",
        [ppiFrom, effectiveTo]
      );
      const lastMap = new Map();
      for (const r of pRows) {
        const ym = String(r.ym || ''), iid = toN(r.item_id), price = toN(r.unit_price_idr);
        if (!ym || !iid || price <= 0) continue;
        if (!lastMap.has(ym)) lastMap.set(ym, new Map());
        lastMap.get(ym).set(iid, { itemCode: String(r.item_code || 'ITEM-' + iid), itemName: String(r.item_name || 'Item #' + iid), price });
      }
      for (const ym of months) {
        const pYm = shiftMonthYm(ym, -1);
        const cm = lastMap.get(ym), pm = lastMap.get(pYm);
        const det = []; let sPrev = 0, sCurr = 0;
        if (cm && pm) {
          for (const [iid, ci] of cm.entries()) {
            const pi = pm.get(iid);
            if (!pi || pi.price <= 0) continue;
            const vIdr = ci.price - pi.price, vPct = (vIdr / pi.price) * 100;
            sPrev += pi.price; sCurr += ci.price;
            det.push({ itemId: iid, itemCode: ci.itemCode, itemName: ci.itemName, prevPrice: pi.price, currPrice: ci.price, varianceIdr: vIdr, variancePct: vPct });
          }
        }
        det.sort((a, b) => Math.abs(b.variancePct) - Math.abs(a.variancePct));
        ppiDetailsByMonth[ym] = det.slice(0, 100);
        const b = monthlyMap.get(ym);
        b.ppiPrevTotalPrice = sPrev; b.ppiCurrTotalPrice = sCurr; b.ppiItemCount = det.length;
        b.ppiPct = sPrev > 0 ? ((sCurr - sPrev) / sPrev) * 100 : 0;
      }
    } catch {}
  }

  let otdBasis = 'unavailable';
  if (poCols && poIdCol && poDateCol) {
    try {
      const targetExpr = poTargetDateCol ? "COALESCE(NULLIF(p.\`" + poTargetDateCol + "\`, '0000-00-00'), DATE_ADD(p.\`" + poDateCol + "\`, INTERVAL 7 DAY))" : "DATE_ADD(p.\`" + poDateCol + "\`, INTERVAL 7 DAY)";
      otdBasis = poTargetDateCol ? 'po_potgldipenuhi' : 'po_potgl_plus7';
      if (grnCols && grnDateCol) {
        let joinPo = '';
        if (grnPoFkCol) joinPo = 'LEFT JOIN m4_po p ON p.\`' + poIdCol + '\` = g.\`' + grnPoFkCol + '\`';
        else if (grnIdCol && grndCols && grndGrnFkCol && grndPodFkCol && podCols && podIdCol && podPoFkCol) {
          joinPo = 'LEFT JOIN (SELECT gd.\`' + grndGrnFkCol + '\` AS gid, MIN(pd.\`' + podPoFkCol + '\`) AS pid FROM m4_grn_detail gd INNER JOIN m4_po_detail pd ON pd.\`' + podIdCol + '\` = gd.\`' + grndPodFkCol + '\` GROUP BY gd.\`' + grndGrnFkCol + '\`) gp ON gp.gid = g.\`' + grnIdCol + '\` LEFT JOIN m4_po p ON p.\`' + poIdCol + '\` = gp.pid';
        }
        if (joinPo) {
          const [gRows] = await conn.query(
            "SELECT DATE_FORMAT(g.\`" + grnDateCol + "\`,'%Y-%m') AS ym, COUNT(*) AS total_cnt, SUM(CASE WHEN p.\`" + poIdCol + "\` IS NOT NULL THEN 1 ELSE 0 END) AS linked_cnt, SUM(CASE WHEN p.\`" + poIdCol + "\` IS NOT NULL AND DATE(g.\`" + grnDateCol + "\`) <= DATE(" + targetExpr + ") THEN 1 ELSE 0 END) AS ontime_cnt FROM m4_grn g " + joinPo + " WHERE g.\`" + grnDateCol + "\` >= ? AND g.\`" + grnDateCol + "\` <= ? AND " + statusExcl('g', grnStatusCol) + " GROUP BY ym",
            [effectiveFrom, effectiveTo]
          );
          for (const r of gRows) { const b = monthlyMap.get(String(r.ym || '')); if (b) { b.grnTotalCount = toN(r.total_cnt); b.grnLinkedPoCount = toN(r.linked_cnt); b.grnOnTimeCount = toN(r.ontime_cnt); } }
          const supRef = grnSuppCol ? 'g.\`' + grnSuppCol + '\`' : (poSuppCol ? 'p.\`' + poSuppCol + '\`' : '');
          if (supRef) {
            const [soRows] = await conn.query(
              "SELECT " + supRef + " AS supp_id, SUM(CASE WHEN p.\`" + poIdCol + "\` IS NOT NULL THEN 1 ELSE 0 END) AS linked_cnt, SUM(CASE WHEN p.\`" + poIdCol + "\` IS NOT NULL AND DATE(g.\`" + grnDateCol + "\`) <= DATE(" + targetExpr + ") THEN 1 ELSE 0 END) AS ontime_cnt FROM m4_grn g " + joinPo + " WHERE g.\`" + grnDateCol + "\` >= ? AND g.\`" + grnDateCol + "\` <= ? AND " + supRef + " IS NOT NULL AND " + statusExcl('g', grnStatusCol) + " GROUP BY supp_id",
              [effectiveFrom, effectiveTo]
            );
            for (const r of soRows) { const s = supplierSpendMap.get(toN(r.supp_id)); if (s) { s.grnLinkedCount = toN(r.linked_cnt); s.grnOnTimeCount = toN(r.ontime_cnt); s.otdPct = s.grnLinkedCount > 0 ? (s.grnOnTimeCount / s.grnLinkedCount) * 100 : null; } }
          }
        }
      }
      if (riCols && riDateCol) {
        const joinPo = riPoFkCol ? 'LEFT JOIN m4_po p ON p.\`' + poIdCol + '\` = r.\`' + riPoFkCol + '\`'
          : (riGrnFkCol && grnCols && grnIdCol && grnPoFkCol) ? 'LEFT JOIN m4_grn g ON g.\`' + grnIdCol + '\` = r.\`' + riGrnFkCol + '\` LEFT JOIN m4_po p ON p.\`' + poIdCol + '\` = g.\`' + grnPoFkCol + '\`'
          : (riIdCol && ridCols && ridRiFkCol && ridPodFkCol && podCols && podIdCol && podPoFkCol) ? 'LEFT JOIN (SELECT rd.\`' + ridRiFkCol + '\` AS rid, MIN(pd.\`' + podPoFkCol + '\`) AS pid FROM m4_ri_detail rd INNER JOIN m4_po_detail pd ON pd.\`' + podIdCol + '\` = rd.\`' + ridPodFkCol + '\` GROUP BY rd.\`' + ridRiFkCol + '\`) rp ON rp.rid = r.\`' + riIdCol + '\` LEFT JOIN m4_po p ON p.\`' + poIdCol + '\` = rp.pid' : '';
        if (joinPo) {
          const [rRows] = await conn.query(
            "SELECT DATE_FORMAT(r.\`" + riDateCol + "\`,'%Y-%m') AS ym, COUNT(*) AS total_cnt, SUM(CASE WHEN p.\`" + poIdCol + "\` IS NOT NULL THEN 1 ELSE 0 END) AS linked_cnt, SUM(CASE WHEN p.\`" + poIdCol + "\` IS NOT NULL AND DATE(r.\`" + riDateCol + "\`) <= DATE(" + targetExpr + ") THEN 1 ELSE 0 END) AS ontime_cnt FROM m4_ri r " + joinPo + " WHERE r.\`" + riDateCol + "\` >= ? AND r.\`" + riDateCol + "\` <= ? AND " + statusExcl('r', riStatusCol) + " GROUP BY ym",
            [effectiveFrom, effectiveTo]
          );
          for (const r of rRows) { const b = monthlyMap.get(String(r.ym || '')); if (b) { b.riTotalCount = toN(r.total_cnt); b.riLinkedPoCount = toN(r.linked_cnt); b.riOnTimeCount = toN(r.ontime_cnt); } }
        }
      }
    } catch {}
  }

  let returnSource = 'unavailable';
  const returnDetailsByMonth = {}, mismatchDetailsByMonth = {};
  const purchasedByMonthItem = new Map(), receivedByMonthItem = new Map(), returnByMonthItem = new Map(), qtyDiffByMonthItem = new Map();

  if (riCols && riIdCol && riDateCol && ridCols && ridRiFkCol && ridQtyCol) {
    try {
      const [rqRows] = await conn.query(
        "SELECT DATE_FORMAT(r.\`" + riDateCol + "\`,'%Y-%m') AS ym, SUM(COALESCE(rd.\`" + ridQtyCol + "\`,0)) AS qty_sum FROM m4_ri_detail rd INNER JOIN m4_ri r ON r.\`" + riIdCol + "\` = rd.\`" + ridRiFkCol + "\` WHERE r.\`" + riDateCol + "\` >= ? AND r.\`" + riDateCol + "\` <= ? AND " + statusExcl('r', riStatusCol) + " GROUP BY ym",
        [effectiveFrom, effectiveTo]
      );
      for (const r of rqRows) { const b = monthlyMap.get(String(r.ym || '')); if (b) b.purchasedQty = toN(r.qty_sum); }
      if (ridItemCol) {
        const itJoin = (itemCols && iIdCol) ? 'LEFT JOIN m1_item it ON it.\`' + iIdCol + '\` = rd.\`' + ridItemCol + '\`' : '';
        const iCodeSel = iCodeCol ? "COALESCE(NULLIF(TRIM(it.\`" + iCodeCol + "\`), ''), CAST(rd.\`" + ridItemCol + "\` AS CHAR))" : "CAST(rd.\`" + ridItemCol + "\` AS CHAR)";
        const iNameSel = iNameCol ? "COALESCE(NULLIF(TRIM(it.\`" + iNameCol + "\`), ''), CONCAT('Item #', rd.\`" + ridItemCol + "\`))" : "CONCAT('Item #', rd.\`" + ridItemCol + "\`)";
        const [rows] = await conn.query(
          "SELECT DATE_FORMAT(r.\`" + riDateCol + "\`,'%Y-%m') AS ym, rd.\`" + ridItemCol + "\` AS item_id, " + iCodeSel + " AS item_code, " + iNameSel + " AS item_name, SUM(COALESCE(rd.\`" + ridQtyCol + "\`,0)) AS qty_sum FROM m4_ri_detail rd INNER JOIN m4_ri r ON r.\`" + riIdCol + "\` = rd.\`" + ridRiFkCol + "\` " + itJoin + " WHERE r.\`" + riDateCol + "\` >= ? AND r.\`" + riDateCol + "\` <= ? AND " + statusExcl('r', riStatusCol) + " GROUP BY ym, item_id, item_code, item_name",
          [effectiveFrom, effectiveTo]
        );
        for (const r of rows) {
          const ym = String(r.ym || ''), iid = toN(r.item_id);
          if (!ym || !iid) continue;
          if (!purchasedByMonthItem.has(ym)) purchasedByMonthItem.set(ym, new Map());
          purchasedByMonthItem.get(ym).set(iid, { itemCode: String(r.item_code || 'ITEM-' + iid), itemName: String(r.item_name || 'Item #' + iid), qty: toN(r.qty_sum) });
        }
      }
    } catch {}
  }

  if (grnCols && grnIdCol && grnDateCol && grndCols && grndGrnFkCol && grndQtyCol) {
    try {
      const [gqRows] = await conn.query(
        "SELECT DATE_FORMAT(g.\`" + grnDateCol + "\`,'%Y-%m') AS ym, SUM(COALESCE(gd.\`" + grndQtyCol + "\`,0)) AS qty_sum FROM m4_grn_detail gd INNER JOIN m4_grn g ON g.\`" + grnIdCol + "\` = gd.\`" + grndGrnFkCol + "\` WHERE g.\`" + grnDateCol + "\` >= ? AND g.\`" + grnDateCol + "\` <= ? AND " + statusExcl('g', grnStatusCol) + " GROUP BY ym",
        [effectiveFrom, effectiveTo]
      );
      for (const r of gqRows) { const b = monthlyMap.get(String(r.ym || '')); if (b) b.receivedQty = toN(r.qty_sum); }
      if (grndItemCol) {
        const itJoin = (itemCols && iIdCol) ? 'LEFT JOIN m1_item it ON it.\`' + iIdCol + '\` = gd.\`' + grndItemCol + '\`' : '';
        const iCodeSel = iCodeCol ? "COALESCE(NULLIF(TRIM(it.\`" + iCodeCol + "\`), ''), CAST(gd.\`" + grndItemCol + "\` AS CHAR))" : "CAST(gd.\`" + grndItemCol + "\` AS CHAR)";
        const iNameSel = iNameCol ? "COALESCE(NULLIF(TRIM(it.\`" + iNameCol + "\`), ''), CONCAT('Item #', gd.\`" + grndItemCol + "\`))" : "CONCAT('Item #', gd.\`" + grndItemCol + "\`)";
        const [rows] = await conn.query(
          "SELECT DATE_FORMAT(g.\`" + grnDateCol + "\`,'%Y-%m') AS ym, gd.\`" + grndItemCol + "\` AS item_id, " + iCodeSel + " AS item_code, " + iNameSel + " AS item_name, SUM(COALESCE(gd.\`" + grndQtyCol + "\`,0)) AS qty_sum FROM m4_grn_detail gd INNER JOIN m4_grn g ON g.\`" + grnIdCol + "\` = gd.\`" + grndGrnFkCol + "\` " + itJoin + " WHERE g.\`" + grnDateCol + "\` >= ? AND g.\`" + grnDateCol + "\` <= ? AND " + statusExcl('g', grnStatusCol) + " GROUP BY ym, item_id, item_code, item_name",
          [effectiveFrom, effectiveTo]
        );
        for (const r of rows) {
          const ym = String(r.ym || ''), iid = toN(r.item_id);
          if (!ym || !iid) continue;
          if (!receivedByMonthItem.has(ym)) receivedByMonthItem.set(ym, new Map());
          receivedByMonthItem.get(ym).set(iid, { itemCode: String(r.item_code || 'ITEM-' + iid), itemName: String(r.item_name || 'Item #' + iid), qty: toN(r.qty_sum) });
        }
      }
    } catch {}
  }

  const prtCols = tableCols['m4_prt'], prtdCols = tableCols['m4_prt_detail'];
  const prtIdCol = pickExactOrPat(prtCols, ['prtid','id'], [/^prt?id$/i]);
  const prtDateCol = pickExactOrPat(prtCols, ['prttgl','tanggal'], [/tgl|date/i]);
  const prtStatusCol = pickExactOrPat(prtCols, ['prtstatus','status'], [/status/i]);
  const prtSuppCol = pickExactOrPat(prtCols, ['prtsupplier','prtkontak','idsupplier','idcontact'], [/supplier|kontak|vendor|contact/i]);
  const prtTotalCol = pickExactOrPat(prtCols, ['prttotaltransaksi','prttotal','total'], [/totaltransaksi|total/i]);
  const prtKursCol = pickExactOrPat(prtCols, ['prtkurs','kurs'], [/kurs|rate/i]);
  const prtdPrtFkCol = pickExactOrPat(prtdCols, ['idprt','prtid','prtdidprt'], [/idprt|prtid/i]);
  const prtdItemCol = pickExactOrPat(prtdCols, ['idbarang','iditem','bid','prtdiditem','itemid'], [/idbarang|iditem|itemid/i]);
  const prtdQtyCol = pickExactOrPat(prtdCols, ['jml','qty','jumlah','prtdjml','prtdqty'], [/jml|qty|jumlah/i]);

  if (prtCols && prtDateCol) {
    try {
      returnSource = 'm4_prt';
      const kursExpr = prtKursCol ? 'COALESCE(NULLIF(rt.\`' + prtKursCol + '\`, 0), 1)' : '1';
      const valExpr = prtTotalCol ? 'COALESCE(rt.\`' + prtTotalCol + '\`, 0) * ' + kursExpr : '0';
      const [prtRows] = await conn.query(
        "SELECT DATE_FORMAT(rt.\`" + prtDateCol + "\`,'%Y-%m') AS ym, COUNT(*) AS doc_cnt, SUM(" + valExpr + ") AS val_idr FROM m4_prt rt WHERE rt.\`" + prtDateCol + "\` >= ? AND rt.\`" + prtDateCol + "\` <= ? AND " + statusExcl('rt', prtStatusCol) + " GROUP BY ym",
        [effectiveFrom, effectiveTo]
      );
      for (const r of prtRows) { const b = monthlyMap.get(String(r.ym || '')); if (b) { b.returnDocCount = toN(r.doc_cnt); b.returnValueIdr = toN(r.val_idr); } }
      if (prtSuppCol) {
        const [srRows] = await conn.query(
          "SELECT rt.\`" + prtSuppCol + "\` AS supp_id, SUM(" + valExpr + ") AS val_idr FROM m4_prt rt WHERE rt.\`" + prtDateCol + "\` >= ? AND rt.\`" + prtDateCol + "\` <= ? AND rt.\`" + prtSuppCol + "\` IS NOT NULL AND " + statusExcl('rt', prtStatusCol) + " GROUP BY supp_id",
          [effectiveFrom, effectiveTo]
        );
        for (const r of srRows) { const s = supplierSpendMap.get(toN(r.supp_id)); if (s) s.returnValueIdr = toN(r.val_idr); }
      }
      if (prtIdCol && prtdCols && prtdPrtFkCol && prtdQtyCol) {
        const [pqRows] = await conn.query(
          "SELECT DATE_FORMAT(rt.\`" + prtDateCol + "\`,'%Y-%m') AS ym, SUM(COALESCE(rd.\`" + prtdQtyCol + "\`,0)) AS qty_sum FROM m4_prt_detail rd INNER JOIN m4_prt rt ON rt.\`" + prtIdCol + "\` = rd.\`" + prtdPrtFkCol + "\` WHERE rt.\`" + prtDateCol + "\` >= ? AND rt.\`" + prtDateCol + "\` <= ? AND " + statusExcl('rt', prtStatusCol) + " GROUP BY ym",
          [effectiveFrom, effectiveTo]
        );
        for (const r of pqRows) { const b = monthlyMap.get(String(r.ym || '')); if (b) b.returnQty = toN(r.qty_sum); }
        if (prtdItemCol) {
          const itJoin = (itemCols && iIdCol) ? 'LEFT JOIN m1_item it ON it.\`' + iIdCol + '\` = rd.\`' + prtdItemCol + '\`' : '';
          const iCodeSel = iCodeCol ? "COALESCE(NULLIF(TRIM(it.\`" + iCodeCol + "\`), ''), CAST(rd.\`" + prtdItemCol + "\` AS CHAR))" : "CAST(rd.\`" + prtdItemCol + "\` AS CHAR)";
          const iNameSel = iNameCol ? "COALESCE(NULLIF(TRIM(it.\`" + iNameCol + "\`), ''), CONCAT('Item #', rd.\`" + prtdItemCol + "\`))" : "CONCAT('Item #', rd.\`" + prtdItemCol + "\`)";
          const [rows] = await conn.query(
            "SELECT DATE_FORMAT(rt.\`" + prtDateCol + "\`,'%Y-%m') AS ym, rd.\`" + prtdItemCol + "\` AS item_id, " + iCodeSel + " AS item_code, " + iNameSel + " AS item_name, SUM(COALESCE(rd.\`" + prtdQtyCol + "\`,0)) AS qty_sum FROM m4_prt_detail rd INNER JOIN m4_prt rt ON rt.\`" + prtIdCol + "\` = rd.\`" + prtdPrtFkCol + "\` " + itJoin + " WHERE rt.\`" + prtDateCol + "\` >= ? AND rt.\`" + prtDateCol + "\` <= ? AND " + statusExcl('rt', prtStatusCol) + " GROUP BY ym, item_id, item_code, item_name",
            [effectiveFrom, effectiveTo]
          );
          for (const r of rows) {
            const ym = String(r.ym || ''), iid = toN(r.item_id);
            if (!ym || !iid) continue;
            if (!returnByMonthItem.has(ym)) returnByMonthItem.set(ym, new Map());
            returnByMonthItem.get(ym).set(iid, { itemCode: String(r.item_code || 'ITEM-' + iid), itemName: String(r.item_name || 'Item #' + iid), qty: toN(r.qty_sum) });
          }
        }
      }
    } catch {}
  }

  if (grnCols && grnIdCol && grnDateCol && grndCols && grndGrnFkCol && grndPodFkCol && grndQtyCol && podCols && podIdCol && podQtyCol) {
    try {
      const itemRef = grndItemCol ? 'gd.\`' + grndItemCol + '\`' : podItemCol ? 'pd.\`' + podItemCol + '\`' : null;
      if (itemRef) {
        const itJoin = (itemCols && iIdCol) ? 'LEFT JOIN m1_item it ON it.\`' + iIdCol + '\` = ' + itemRef : '';
        const iCodeSel = iCodeCol ? "COALESCE(NULLIF(TRIM(it.\`" + iCodeCol + "\`), ''), CAST(" + itemRef + " AS CHAR))" : "CAST(" + itemRef + " AS CHAR)";
        const iNameSel = iNameCol ? "COALESCE(NULLIF(TRIM(it.\`" + iNameCol + "\`), ''), CONCAT('Item #', " + itemRef + "))" : "CONCAT('Item #', " + itemRef + ")";
        const [dRows] = await conn.query(
          "SELECT DATE_FORMAT(g.\`" + grnDateCol + "\`,'%Y-%m') AS ym, " + itemRef + " AS item_id, " + iCodeSel + " AS item_code, " + iNameSel + " AS item_name, SUM(CASE WHEN COALESCE(gd.\`" + grndQtyCol + "\`,0) > COALESCE(pd.\`" + podQtyCol + "\`,0) THEN COALESCE(gd.\`" + grndQtyCol + "\`,0) - COALESCE(pd.\`" + podQtyCol + "\`,0) ELSE 0 END) AS excess_qty FROM m4_grn_detail gd INNER JOIN m4_grn g ON g.\`" + grnIdCol + "\` = gd.\`" + grndGrnFkCol + "\` INNER JOIN m4_po_detail pd ON pd.\`" + podIdCol + "\` = gd.\`" + grndPodFkCol + "\` " + itJoin + " WHERE g.\`" + grnDateCol + "\` >= ? AND g.\`" + grnDateCol + "\` <= ? AND " + statusExcl('g', grnStatusCol) + " GROUP BY ym, item_id, item_code, item_name HAVING excess_qty > 0",
          [effectiveFrom, effectiveTo]
        );
        for (const r of dRows) {
          const ym = String(r.ym || ''), iid = toN(r.item_id);
          if (!ym || !iid) continue;
          if (!qtyDiffByMonthItem.has(ym)) qtyDiffByMonthItem.set(ym, new Map());
          qtyDiffByMonthItem.get(ym).set(iid, { itemCode: String(r.item_code || 'ITEM-' + iid), itemName: String(r.item_name || 'Item #' + iid), diffQty: toN(r.excess_qty) });
        }
      }
    } catch {}
  }

  for (const ym of months) {
    const b = monthlyMap.get(ym);
    if (b.receivedQty === 0 && b.purchasedQty > 0) b.receivedQty = b.purchasedQty;
    const retMap = returnByMonthItem.get(ym) || new Map();
    const purMap = purchasedByMonthItem.get(ym) || new Map();
    const recMap = receivedByMonthItem.get(ym) || purMap;
    const diffMap = qtyDiffByMonthItem.get(ym) || new Map();

    const retList = [];
    for (const [iid, rInfo] of retMap.entries()) {
      const pQty = (purMap.get(iid) && purMap.get(iid).qty) || 0;
      retList.push({ itemId: iid, itemCode: rInfo.itemCode, itemName: rInfo.itemName, returnQty: rInfo.qty, purchasedQty: pQty, returnPct: pQty > 0 ? (rInfo.qty / pQty) * 100 : 100 });
    }
    retList.sort((a, x) => x.returnQty - a.returnQty);
    returnDetailsByMonth[ym] = retList.slice(0, 100);

    const misIds = new Set([...retMap.keys(), ...diffMap.keys()]);
    const misList = []; let mSum = 0;
    for (const iid of misIds) {
      const rInfo = retMap.get(iid), dInfo = diffMap.get(iid), recInfo = recMap.get(iid);
      const rQty = (rInfo && rInfo.qty) || 0, dQty = (dInfo && dInfo.diffQty) || 0, mQty = rQty + dQty;
      if (mQty <= 0) continue;
      mSum += mQty;
      const recvQty = (recInfo && recInfo.qty) || 0;
      misList.push({
        itemId: iid,
        itemCode: (rInfo && rInfo.itemCode) || (dInfo && dInfo.itemCode) || (recInfo && recInfo.itemCode) || ('ITEM-' + iid),
        itemName: (rInfo && rInfo.itemName) || (dInfo && dInfo.itemName) || (recInfo && recInfo.itemName) || ('Item #' + iid),
        returnQty: rQty, qtyDiff: dQty, mismatchQty: mQty, receivedQty: recvQty, mismatchPct: recvQty > 0 ? (mQty / recvQty) * 100 : 100,
      });
    }
    misList.sort((a, x) => x.mismatchQty - a.mismatchQty);
    mismatchDetailsByMonth[ym] = misList.slice(0, 100);
    b.mismatchQty = mSum;
  }

  let leadTimeSource = 'unavailable';
  const receivingLeadTimeItems = [];
  if (grnCols && grnIdCol && grnDateCol && grndCols && grndGrnFkCol && poCols && poIdCol && poDateCol) {
    try {
      const canDet = Boolean(grndPodFkCol && podCols && podIdCol && podPoFkCol);
      const canHdr = Boolean(grnPoFkCol);
      const itemRef = grndItemCol ? 'gd.\`' + grndItemCol + '\`' : (canDet && podItemCol) ? 'pd.\`' + podItemCol + '\`' : null;
      if (itemRef && (canDet || canHdr)) {
        leadTimeSource = canDet ? 'm4_grn_po_detail' : 'm4_grn_po_header';
        const poJoin = canDet
          ? 'INNER JOIN m4_po_detail pd ON pd.\`' + podIdCol + '\` = gd.\`' + grndPodFkCol + '\` INNER JOIN m4_po p ON p.\`' + poIdCol + '\` = pd.\`' + podPoFkCol + '\`'
          : 'INNER JOIN m4_po p ON p.\`' + poIdCol + '\` = g.\`' + grnPoFkCol + '\`';
        const itJoin = (itemCols && iIdCol) ? 'LEFT JOIN m1_item it ON it.\`' + iIdCol + '\` = ' + itemRef : '';
        const iCodeSel = iCodeCol ? "COALESCE(NULLIF(TRIM(it.\`" + iCodeCol + "\`), ''), CAST(" + itemRef + " AS CHAR))" : "CAST(" + itemRef + " AS CHAR)";
        const iNameSel = iNameCol ? "COALESCE(NULLIF(TRIM(it.\`" + iNameCol + "\`), ''), CONCAT('Item #', " + itemRef + "))" : "CONCAT('Item #', " + itemRef + ")";
        const [ltRows] = await conn.query(
          "SELECT " + itemRef + " AS item_id, " + iCodeSel + " AS item_code, " + iNameSel + " AS item_name, GREATEST(0, DATEDIFF(DATE(g.\`" + grnDateCol + "\`), DATE(p.\`" + poDateCol + "\`))) AS lead_days, COUNT(*) AS cnt FROM m4_grn_detail gd INNER JOIN m4_grn g ON g.\`" + grnIdCol + "\` = gd.\`" + grndGrnFkCol + "\` " + poJoin + " " + itJoin + " WHERE g.\`" + grnDateCol + "\` >= ? AND g.\`" + grnDateCol + "\` <= ? AND " + statusExcl('g', grnStatusCol) + " AND " + statusExcl('p', poStatusCol) + " GROUP BY item_id, item_code, item_name, lead_days",
          [effectiveFrom, effectiveTo]
        );
        const ltMap = new Map();
        for (const r of ltRows) {
          const iid = toN(r.item_id), days = Math.max(0, Math.floor(toN(r.lead_days))), cnt = toN(r.cnt);
          if (!iid || cnt <= 0) continue;
          let e = ltMap.get(iid);
          if (!e) { e = { itemId: iid, itemCode: String(r.item_code || 'ITEM-' + iid), itemName: String(r.item_name || 'Item #' + iid), totalDeliveries: 0, totalLeadDays: 0, dayBuckets: new Array(15).fill(0), over14Days: 0 }; ltMap.set(iid, e); }
          e.totalDeliveries += cnt; e.totalLeadDays += days * cnt;
          if (days <= 14) e.dayBuckets[days] += cnt; else e.over14Days += cnt;
        }
        for (const e of Array.from(ltMap.values()).sort((a, x) => x.totalDeliveries - a.totalDeliveries).slice(0, 120)) {
          receivingLeadTimeItems.push({ itemId: e.itemId, itemCode: e.itemCode, itemName: e.itemName, totalDeliveries: e.totalDeliveries, avgLeadDays: e.totalDeliveries > 0 ? e.totalLeadDays / e.totalDeliveries : 0, dayBuckets: e.dayBuckets, over14Days: e.over14Days });
        }
      }
    } catch {}
  }

  return {
    cutoffDate: ACTIVE_CUTOFF_DATE,
    period: { dateFrom, dateTo },
    coverage: { minDateAll, maxDateAll, minDateActive, maxDateActive },
    masterSuppliers,
    diagnostics: { tablesDetected, realizationSource, otdBasis, returnSource, leadTimeSource },
    monthly: Array.from(monthlyMap.values()).sort((a, b) => a.month.localeCompare(b.month)),
    supplierSpend: Array.from(supplierSpendMap.values()).sort((a, b) => b.dppIdr - a.dppIdr),
    ppiDetailsByMonth,
    returnDetailsByMonth,
    mismatchDetailsByMonth,
    receivingLeadTimeItems,
    fetchedAt: new Date().toISOString(),
  };
}

async function queryMyErpPlusInventoryBi(conn, opts) {
  const dateFrom = clampActiveDateFrom(opts.dateFrom);
  const dateTo = /^\\d{4}-\\d{2}-\\d{2}$/.test(opts.dateTo || '') && opts.dateTo >= dateFrom
    ? opts.dateTo
    : new Date().toISOString().slice(0, 10);

  const [tblRows] = await conn.query('SHOW TABLES');
  const tblSet = new Set(tblRows.map((r) => String(Object.values(r)[0] || '').trim().toLowerCase()).filter(Boolean));
  const hasItem = tblSet.has('m1_item');
  const hasStockWh = tblSet.has('m1_item_stock_warehouse');
  const hasWh = tblSet.has('m1_warehouse');
  const catTbl = tblSet.has('m1_item_category') ? 'm1_item_category' : (tblSet.has('m1_category') ? 'm1_category' : '');
  const hasDo = tblSet.has('m5_do') && tblSet.has('m5_do_detail');
  const hasSi = tblSet.has('m5_si') && tblSet.has('m5_si_detail');
  const hasGrn = tblSet.has('m4_grn') && tblSet.has('m4_grn_detail');
  const hasRi = tblSet.has('m4_ri') && tblSet.has('m4_ri_detail');
  const hasFinance = tblSet.has('m2_transaction_journal') && tblSet.has('m1_coa');

  if (!hasItem || !hasStockWh) {
    throw new Error('Tabel master barang (m1_item) atau stok gudang (m1_item_stock_warehouse) tidak ditemukan.');
  }

  const tablesDetected = ['m1_item','m1_item_stock_warehouse','m1_warehouse',catTbl,'m4_grn','m4_grn_detail','m4_ri','m4_ri_detail','m5_do','m5_do_detail','m5_si','m5_si_detail','m2_transaction_journal']
    .filter((t) => Boolean(t) && tblSet.has(t));

  const [itemCols, stockCols, whCols, catCols] = await Promise.all([
    getTableCols(conn, 'm1_item'),
    getTableCols(conn, 'm1_item_stock_warehouse'),
    hasWh ? getTableCols(conn, 'm1_warehouse') : [],
    catTbl ? getTableCols(conn, catTbl) : [],
  ]);

  const itemIdCol = pickColExact(itemCols, ['bid', 'idbarang', 'id']) || 'bid';
  const itemCodeCol = pickColExact(itemCols, ['bkode', 'kode', 'kodebarang']) || 'bkode';
  const itemNameCol = pickColExact(itemCols, ['bnama', 'nama', 'namabarang']) || 'bnama';
  const itemUnitCol = pickColExact(itemCols, ['bsatuan', 'bsatuankecil', 'satuan']);
  const itemActiveCol = pickColExact(itemCols, ['baktif', 'aktif']);
  const itemJenisCol = pickColExact(itemCols, ['bjenis']);
  const itemCatCol = pickColExact(itemCols, ['bkategori', 'idkategori', 'kategoribarang', 'bgolongan']);
  const itemCostCol = pickColExact(itemCols, ['bhargapokok', 'bhpp', 'bhargabeli', 'bmodal', 'bhargastandar', 'bhargabeliterakhir', 'bharga']);
  const itemMinStockCol = pickColExact(itemCols, ['bminstok', 'bminstock', 'bstokmin', 'minstok', 'breorder', 'bminimumstok']);
  const itemMaxStockCol = pickColExact(itemCols, ['bmaxstok', 'bmaxstock', 'bstokmax', 'maxstok', 'bmaksimumstok']);

  const stockItemFk = pickColExact(stockCols, ['idbarang', 'bid', 'iditem']) || 'idbarang';
  const stockWhCol = pickColExact(stockCols, ['kgudang', 'gudang', 'wgudang', 'kodegudang']) || 'kgudang';
  const stockQtyCol = pickColExact(stockCols, ['stok', 'qty', 'jumlah', 'saldo']) || 'stok';

  const whNameByCode = new Map();
  const virtualWhKeys = new Set();
  if (hasWh && whCols.length) {
    const wCode = pickColExact(whCols, ['wkode', 'kode', 'id']) || 'wkode';
    const wName = pickColExact(whCols, ['wnama', 'nama']) || wCode;
    const wVirt = pickColExact(whCols, ['wisintransit', 'is_intransit', 'wisvirtual', 'wnonfisik']);
    const wPhys = pickColExact(whCols, ['wisfisik', 'is_physical']);
    try {
      const [wRows] = await conn.query(
        'SELECT \`' + wCode + '\` AS wkode, \`' + wName + '\` AS wnama' +
        (wVirt ? ', COALESCE(\`' + wVirt + '\`, 0) AS wvirtual' : ', 0 AS wvirtual') +
        (wPhys ? ', COALESCE(\`' + wPhys + '\`, 1) AS wfisik' : ', 1 AS wfisik') +
        ' FROM m1_warehouse'
      );
      for (const r of wRows) {
        const c = String(r.wkode || '').trim(), n = String(r.wnama || c || '').trim();
        if (c) whNameByCode.set(c.toLowerCase(), n || c);
        if (n) whNameByCode.set(n.toLowerCase(), n);
        if (Number(r.wvirtual || 0) === 1 || Number(r.wfisik ?? 1) === 0 || isBiIntransitWh(c) || isBiIntransitWh(n)) {
          if (c) virtualWhKeys.add(c.toLowerCase());
          if (n) virtualWhKeys.add(n.toLowerCase());
        }
      }
    } catch {}
  }

  const catNameById = new Map();
  if (catTbl && catCols.length) {
    const cId = pickColExact(catCols, ['kid', 'idkategori', 'id', 'kkode']);
    const cNm = pickColExact(catCols, ['knama', 'nama', 'namakategori', 'kategori']);
    if (cId && cNm) {
      try {
        const [cRows] = await conn.query('SELECT \`' + cId + '\` AS cid, \`' + cNm + '\` AS cname FROM \`' + catTbl + '\`');
        for (const r of cRows) { const k = String(r.cid ?? '').trim(), v = String(r.cname ?? '').trim(); if (k && v) catNameById.set(k, v); }
      } catch {}
    }
  }

  const lastRiCostByItem = new Map();
  if (hasRi) {
    const [riColsA, riDetColsA] = await Promise.all([getTableCols(conn, 'm4_ri'), getTableCols(conn, 'm4_ri_detail')]);
    const riCols = new Set(riColsA.map((c) => c.toLowerCase()));
    const fk = pickColExact(riDetColsA, ['idri', 'riid']);
    const itCol = pickColExact(riDetColsA, ['idbarang', 'bid']);
    const pCol = pickColExact(riDetColsA, ['harga', 'dharga']);
    const kurs = riCols.has('rikurs') ? 'COALESCE(NULLIF(ri.rikurs,0),1)' : '1';
    if (riCols.has('riid') && riCols.has('ritgl') && fk && itCol && pCol) {
      try {
        const [lpRows] = await conn.query(
          "SELECT d.\`" + itCol + "\` AS itemId, SUBSTRING_INDEX(GROUP_CONCAT(ROUND(COALESCE(d.\`" + pCol + "\`, 0) * " + kurs + ", 4) ORDER BY ri.ritgl DESC, ri.riid DESC), ',', 1) AS lastPrice FROM m4_ri_detail d INNER JOIN m4_ri ri ON ri.riid = d.\`" + fk + "\` WHERE COALESCE(ri.ristatus,0) NOT IN (6,12) AND COALESCE(d.\`" + pCol + "\`, 0) > 0 GROUP BY d.\`" + itCol + "\`"
        );
        for (const r of lpRows) { const id = Number(r.itemId || 0), p = Number(r.lastPrice || 0); if (id > 0 && p > 0) lastRiCostByItem.set(id, p); }
      } catch {}
    }
  }

  const itemConds = [];
  if (itemActiveCol) itemConds.push('COALESCE(i.\`' + itemActiveCol + '\`, 1) = 1');
  if (itemJenisCol) itemConds.push("UPPER(TRIM(COALESCE(i.\`" + itemJenisCol + "\`, ''))) = 'P'");
  const itemWhereSql = itemConds.length ? 'WHERE ' + itemConds.join(' AND ') : '';

  const [stockRows] = await conn.query(
    "SELECT i.\`" + itemIdCol + "\` AS itemId, COALESCE(NULLIF(TRIM(i.\`" + itemCodeCol + "\`), ''), CAST(i.\`" + itemIdCol + "\` AS CHAR)) AS code, COALESCE(NULLIF(TRIM(i.\`" + itemNameCol + "\`), ''), CONCAT('Item #', i.\`" + itemIdCol + "\`)) AS name, " +
    (itemUnitCol ? "COALESCE(NULLIF(TRIM(i.\`" + itemUnitCol + "\`), ''), 'Pcs')" : "'Pcs'") + ' AS unit, ' +
    (itemCatCol ? "COALESCE(NULLIF(TRIM(CAST(i.\`" + itemCatCol + "\` AS CHAR)), ''), 'Tanpa Kategori')" : "'Tanpa Kategori'") + ' AS rawCat, ' +
    (itemCostCol ? 'COALESCE(i.\`' + itemCostCol + '\`, 0)' : '0') + ' AS itemCost, ' +
    (itemMinStockCol ? 'i.\`' + itemMinStockCol + '\`' : 'NULL') + ' AS minStock, ' +
    (itemMaxStockCol ? 'i.\`' + itemMaxStockCol + '\`' : 'NULL') + ' AS maxStock, ' +
    "COALESCE(NULLIF(TRIM(s.\`" + stockWhCol + "\`), ''), 'Gudang Utama') AS warehouseRaw, COALESCE(s.\`" + stockQtyCol + "\`, 0) AS qty FROM m1_item_stock_warehouse s INNER JOIN m1_item i ON i.\`" + itemIdCol + "\` = s.\`" + stockItemFk + "\` " + itemWhereSql
  );

  let usedItemCostCount = 0, usedRiCostCount = 0;
  const physicalWhMap = new Map();
  const intransitWhMap = new Map();
  const intransitItemsList = [];
  const skuAggMap = new Map();

  for (const r of stockRows) {
    const itemId = Number(r.itemId || 0);
    if (!itemId) continue;
    const code = String(r.code || '-'), name = String(r.name || '-'), unit = String(r.unit || 'Pcs');
    const rawCat = String(r.rawCat || 'Tanpa Kategori').trim();
    const category = catNameById.get(rawCat) || rawCat || 'Tanpa Kategori';
    const whRaw = String(r.warehouseRaw || 'Gudang Utama').trim();
    const whNorm = whRaw.toLowerCase();
    const whDisplay = whNameByCode.get(whNorm) || whRaw;
    const qty = Number(r.qty || 0);
    const minStock = r.minStock !== null && r.minStock !== undefined && Number(r.minStock) > 0 ? Number(r.minStock) : null;
    const maxStock = r.maxStock !== null && r.maxStock !== undefined && Number(r.maxStock) > 0 ? Number(r.maxStock) : null;
    let unitCost = Number(r.itemCost || 0);
    if (unitCost > 0) usedItemCostCount += 1;
    else {
      const rp = lastRiCostByItem.get(itemId) || 0;
      if (rp > 0) { unitCost = rp; usedRiCostCount += 1; }
    }
    const lineValue = Math.max(0, qty) * unitCost;
    if (virtualWhKeys.has(whNorm) || isBiIntransitWh(whRaw) || isBiIntransitWh(whDisplay)) {
      const itWh = intransitWhMap.get(whDisplay) || { warehouse: whDisplay, skuCount: 0, totalQty: 0, estimatedValueIdr: 0 };
      itWh.skuCount += 1; itWh.totalQty += qty; itWh.estimatedValueIdr += lineValue;
      intransitWhMap.set(whDisplay, itWh);
      if (qty > 0) intransitItemsList.push({ itemId, code, name, warehouse: whDisplay, unit, qty, unitCost, estimatedValueIdr: lineValue });
      continue;
    }
    const whAgg = physicalWhMap.get(whDisplay) || { warehouseCode: whRaw, warehouseName: whDisplay, skuCount: 0, inStockSkuCount: 0, zeroStockCount: 0, lowStockCount: 0, totalQty: 0, stockValueIdr: 0 };
    whAgg.skuCount += 1; whAgg.totalQty += qty; whAgg.stockValueIdr += lineValue;
    if (qty <= 0) whAgg.zeroStockCount += 1;
    else { whAgg.inStockSkuCount += 1; if (minStock !== null && qty <= minStock) whAgg.lowStockCount += 1; }
    physicalWhMap.set(whDisplay, whAgg);

    const cur = skuAggMap.get(itemId);
    if (!cur) skuAggMap.set(itemId, { itemId, code, name, category, unit, physicalQty: qty, minStock, maxStock, unitCost, stockValueIdr: lineValue });
    else { cur.physicalQty += qty; cur.stockValueIdr = Math.max(0, cur.physicalQty) * cur.unitCost; }
  }

  const costSource = usedItemCostCount > 0 && usedRiCostCount > 0 ? 'mixed_item_and_ri' : (usedItemCostCount > 0 ? 'm1_item_hpp' : (usedRiCostCount > 0 ? 'm4_ri_last_price' : 'unavailable'));
  const monthlyMap = new Map();
  const ensureMonth = (ym) => {
    if (!/^\\d{4}-\\d{2}$/.test(ym)) return null;
    let row = monthlyMap.get(ym);
    if (!row) {
      row = { month: ym, grnInQty: 0, grnInValue: 0, doOutQty: 0, siOutQty: 0, siOutValue: 0, netQtyMovement: 0, glCogs: 0, glInventoryEnding: 0, itrAnnualized: null, dioDays: null };
      monthlyMap.set(ym, row);
    }
    return row;
  };
  for (const ym of listBiMonthsBetween(dateFrom.slice(0, 7), dateTo.slice(0, 7))) ensureMonth(ym);

  const inflowByItem = new Map();
  let inflowSource = 'unavailable';
  if (hasGrn) {
    const [gColsA, gdColsA] = await Promise.all([getTableCols(conn, 'm4_grn'), getTableCols(conn, 'm4_grn_detail')]);
    const gCols = new Set(gColsA.map((c) => c.toLowerCase()));
    const fk = pickColExact(gdColsA, ['idgrn', 'grnid']), qCol = pickColExact(gdColsA, ['jml', 'qty', 'jumlah']), pCol = pickColExact(gdColsA, ['harga', 'dharga']), itFk = pickColExact(gdColsA, ['idbarang', 'bid']);
    const kurs = gCols.has('grnkurs') ? 'COALESCE(NULLIF(grn.grnkurs,0),1)' : '1';
    if (gCols.has('grnid') && gCols.has('grntgl') && fk && qCol && itFk) {
      try {
        const vExpr = pCol ? 'COALESCE(d.\`' + qCol + '\`, 0) * COALESCE(d.\`' + pCol + '\`, 0) * ' + kurs : '0';
        const [mRows] = await conn.query("SELECT DATE_FORMAT(grn.grntgl, '%Y-%m') AS month, COALESCE(SUM(COALESCE(d.\`" + qCol + "\`, 0)), 0) AS qty, COALESCE(SUM(" + vExpr + "), 0) AS val FROM m4_grn_detail d INNER JOIN m4_grn grn ON grn.grnid = d.\`" + fk + "\` WHERE COALESCE(grn.grnstatus,0) NOT IN (6,12) AND grn.grntgl >= ? AND grn.grntgl <= ? GROUP BY DATE_FORMAT(grn.grntgl, '%Y-%m')", [dateFrom, dateTo]);
        for (const r of mRows) { const m = ensureMonth(String(r.month || '')); if (m) { m.grnInQty = Number(r.qty || 0); m.grnInValue = Number(r.val || 0); } }
        const [iRows] = await conn.query('SELECT d.\`' + itFk + '\` AS itemId, COALESCE(SUM(COALESCE(d.\`' + qCol + '\`, 0)), 0) AS qty FROM m4_grn_detail d INNER JOIN m4_grn grn ON grn.grnid = d.\`' + fk + '\` WHERE COALESCE(grn.grnstatus,0) NOT IN (6,12) AND grn.grntgl >= ? AND grn.grntgl <= ? GROUP BY d.\`' + itFk + '\`', [dateFrom, dateTo]);
        for (const r of iRows) inflowByItem.set(Number(r.itemId || 0), Number(r.qty || 0));
        inflowSource = 'm4_grn_detail';
      } catch {}
    }
  }

  const outflowByItem = new Map();
  let outflowSource = 'unavailable';
  if (hasDo) {
    const [dColsA, ddColsA] = await Promise.all([getTableCols(conn, 'm5_do'), getTableCols(conn, 'm5_do_detail')]);
    const dCols = new Set(dColsA.map((c) => c.toLowerCase()));
    const fk = pickColExact(ddColsA, ['iddo', 'doid']), qCol = pickColExact(ddColsA, ['jml', 'qty', 'jumlah']), itFk = pickColExact(ddColsA, ['idbarang', 'bid']), dtCol = pickColExact(dColsA, ['dotgl', 'dotglkirim']);
    if (dCols.has('doid') && dtCol && fk && qCol && itFk) {
      try {
        const [mRows] = await conn.query("SELECT DATE_FORMAT(do_h.\`" + dtCol + "\`, '%Y-%m') AS month, COALESCE(SUM(COALESCE(d.\`" + qCol + "\`, 0)), 0) AS qty FROM m5_do_detail d INNER JOIN m5_do do_h ON do_h.doid = d.\`" + fk + "\` WHERE COALESCE(do_h.dostatus,0) NOT IN (6,12) AND do_h.\`" + dtCol + "\` >= ? AND do_h.\`" + dtCol + "\` <= ? GROUP BY DATE_FORMAT(do_h.\`" + dtCol + "\`, '%Y-%m')", [dateFrom, dateTo]);
        for (const r of mRows) { const m = ensureMonth(String(r.month || '')); if (m) m.doOutQty = Number(r.qty || 0); }
        const [iRows] = await conn.query('SELECT d.\`' + itFk + '\` AS itemId, COALESCE(SUM(COALESCE(d.\`' + qCol + '\`, 0)), 0) AS qty, COUNT(DISTINCT do_h.doid) AS freq, MAX(do_h.\`' + dtCol + '\`) AS lastDate FROM m5_do_detail d INNER JOIN m5_do do_h ON do_h.doid = d.\`' + fk + '\` WHERE COALESCE(do_h.dostatus,0) NOT IN (6,12) AND do_h.\`' + dtCol + '\` >= ? AND do_h.\`' + dtCol + '\` <= ? GROUP BY d.\`' + itFk + '\`', [dateFrom, dateTo]);
        for (const r of iRows) outflowByItem.set(Number(r.itemId || 0), { qty: Number(r.qty || 0), freq: Number(r.freq || 0), lastDate: fmtDate(r.lastDate) });
        outflowSource = 'm5_do_detail';
      } catch {}
    }
  }
  if (hasSi) {
    const [sColsA, sdColsA] = await Promise.all([getTableCols(conn, 'm5_si'), getTableCols(conn, 'm5_si_detail')]);
    const sCols = new Set(sColsA.map((c) => c.toLowerCase()));
    const fk = pickColExact(sdColsA, ['idsi', 'siid']), qCol = pickColExact(sdColsA, ['jml', 'qty', 'jumlah']), pCol = pickColExact(sdColsA, ['harga', 'dharga']), itFk = pickColExact(sdColsA, ['idbarang', 'bid']);
    const kurs = sCols.has('sikurs') ? 'COALESCE(NULLIF(si.sikurs,0),1)' : '1';
    if (sCols.has('siid') && sCols.has('sitgl') && fk && qCol && itFk) {
      try {
        const vExpr = pCol ? 'COALESCE(d.\`' + qCol + '\`, 0) * COALESCE(d.\`' + pCol + '\`, 0) * ' + kurs : '0';
        const [mRows] = await conn.query("SELECT DATE_FORMAT(si.sitgl, '%Y-%m') AS month, COALESCE(SUM(COALESCE(d.\`" + qCol + "\`, 0)), 0) AS qty, COALESCE(SUM(" + vExpr + "), 0) AS val FROM m5_si_detail d INNER JOIN m5_si si ON si.siid = d.\`" + fk + "\` WHERE COALESCE(si.sistatus,0) NOT IN (6,12) AND si.sitgl >= ? AND si.sitgl <= ? GROUP BY DATE_FORMAT(si.sitgl, '%Y-%m')", [dateFrom, dateTo]);
        for (const r of mRows) { const m = ensureMonth(String(r.month || '')); if (m) { m.siOutQty = Number(r.qty || 0); m.siOutValue = Number(r.val || 0); } }
        if (outflowSource === 'unavailable') {
          const [iRows] = await conn.query('SELECT d.\`' + itFk + '\` AS itemId, COALESCE(SUM(COALESCE(d.\`' + qCol + '\`, 0)), 0) AS qty, COUNT(DISTINCT si.siid) AS freq, MAX(si.sitgl) AS lastDate FROM m5_si_detail d INNER JOIN m5_si si ON si.siid = d.\`' + fk + '\` WHERE COALESCE(si.sistatus,0) NOT IN (6,12) AND si.sitgl >= ? AND si.sitgl <= ? GROUP BY d.\`' + itFk + '\`', [dateFrom, dateTo]);
          for (const r of iRows) outflowByItem.set(Number(r.itemId || 0), { qty: Number(r.qty || 0), freq: Number(r.freq || 0), lastDate: fmtDate(r.lastDate) });
          outflowSource = 'm5_si_detail';
        }
      } catch {}
    }
  }

  let glInventoryBalanceIdr = 0;
  if (hasFinance) {
    try {
      const [opRows] = await conn.query("SELECT COALESCE(SUM(j.tdebit - j.tkredit), 0) AS openingInv FROM m2_transaction_journal j INNER JOIN m1_coa c ON c.cnomor = j.tnorek WHERE COALESCE(j.tstatus,0) NOT IN (6,12) AND COALESCE(j.tposting,1)=1 AND c.cgd='D' AND c.ctipe = 3 AND j.ttgl < ?", [dateFrom]);
      let runningInv = Number(opRows[0] && opRows[0].openingInv || 0);
      const [gmRows] = await conn.query("SELECT DATE_FORMAT(j.ttgl, '%Y-%m') AS month, COALESCE(SUM(CASE WHEN c.ctipe = 3 THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS invDelta, COALESCE(SUM(CASE WHEN c.ctipe = 12 THEN (j.tdebit - j.tkredit) ELSE 0 END), 0) AS cogsAmt FROM m2_transaction_journal j INNER JOIN m1_coa c ON c.cnomor = j.tnorek WHERE COALESCE(j.tstatus,0) NOT IN (6,12) AND COALESCE(j.tposting,1)=1 AND c.cgd='D' AND c.ctipe IN (3,12) AND j.ttgl >= ? AND j.ttgl <= ? GROUP BY DATE_FORMAT(j.ttgl, '%Y-%m') ORDER BY month ASC", [dateFrom, dateTo]);
      const dMap = new Map(gmRows.map((r) => [String(r.month || ''), { invDelta: Number(r.invDelta || 0), cogsAmt: Number(r.cogsAmt || 0) }]));
      for (const ym of Array.from(monthlyMap.keys()).sort()) {
        const mRow = monthlyMap.get(ym);
        const d = dMap.get(ym);
        runningInv += d ? d.invDelta : 0;
        mRow.glInventoryEnding = runningInv;
        mRow.glCogs = d ? d.cogsAmt : 0;
        const parts = ym.split('-');
        const calDays = new Date(Date.UTC(Number(parts[0]), Number(parts[1]), 0)).getUTCDate() || 30;
        if (runningInv > 0 && mRow.glCogs > 0) {
          mRow.itrAnnualized = (mRow.glCogs / runningInv) * 12;
          mRow.dioDays = (runningInv / mRow.glCogs) * calDays;
        }
      }
      glInventoryBalanceIdr = runningInv;
    } catch {}
  }

  const allSkus = Array.from(skuAggMap.values());
  const totalPhysicalValueIdr = allSkus.reduce((s, x) => s + x.stockValueIdr, 0);
  const totalPhysicalQty = allSkus.reduce((s, x) => s + x.physicalQty, 0);
  const sortedByVal = [...allSkus].sort((a, b) => b.stockValueIdr - a.stockValueIdr);
  const periodEndMs = Date.parse(dateTo + 'T00:00:00Z') || Date.now();
  const periodDays = Math.max(1, Math.round((periodEndMs - (Date.parse(dateFrom + 'T00:00:00Z') || periodEndMs)) / 86400000) + 1);

  let runVal = 0;
  const enrichedSkus = sortedByVal.map((sku) => {
    runVal += sku.stockValueIdr;
    const cumulativeValuePct = totalPhysicalValueIdr > 0 ? (runVal / totalPhysicalValueIdr) * 100 : 0;
    let abcClass = 'N/A';
    if (sku.stockValueIdr > 0 && totalPhysicalValueIdr > 0) {
      abcClass = cumulativeValuePct <= 80.0001 ? 'A' : (cumulativeValuePct <= 95.0001 ? 'B' : 'C');
    }
    const out = outflowByItem.get(sku.itemId) || { qty: 0, freq: 0, lastDate: '' };
    const inflowQty = inflowByItem.get(sku.itemId) || 0;
    const daysSinceLastOut = out.lastDate ? Math.max(0, Math.round((periodEndMs - Date.parse(out.lastDate + 'T00:00:00Z')) / 86400000)) : null;
    const dailyDemand = out.qty > 0 ? out.qty / periodDays : 0;
    let healthStatus = 'healthy';
    if (sku.physicalQty <= 0) healthStatus = 'out_of_stock';
    else if ((sku.minStock !== null && sku.physicalQty <= sku.minStock) || (sku.minStock === null && dailyDemand > 0 && sku.physicalQty / dailyDemand <= 14)) healthStatus = 'low_stock';
    else if (sku.maxStock !== null && sku.physicalQty > sku.maxStock) healthStatus = 'overstock';

    let velocityClass = 'dead';
    if (out.qty <= 0) velocityClass = 'dead';
    else if (out.freq >= 5 || (sku.physicalQty > 0 && out.qty >= sku.physicalQty * 0.5)) velocityClass = 'fast';
    else if (out.freq >= 2 || (sku.physicalQty > 0 && out.qty >= sku.physicalQty * 0.15)) velocityClass = 'medium';
    else velocityClass = 'slow';

    return { ...sku, cumulativeValuePct, abcClass, healthStatus, velocityClass, inflowQty, outflowQty: out.qty, outflowFreq: out.freq, lastOutDate: out.lastDate, daysSinceLastOut };
  });

  const catAggMap = new Map();
  for (const s of enrichedSkus) {
    const c = catAggMap.get(s.category) || { category: s.category, skuCount: 0, zeroStockCount: 0, lowStockCount: 0, totalQty: 0, stockValueIdr: 0 };
    c.skuCount += 1; c.totalQty += s.physicalQty; c.stockValueIdr += s.stockValueIdr;
    if (s.healthStatus === 'out_of_stock') c.zeroStockCount += 1;
    if (s.healthStatus === 'low_stock') c.lowStockCount += 1;
    catAggMap.set(s.category, c);
  }
  const warehouses = Array.from(physicalWhMap.values()).sort((a, b) => b.stockValueIdr - a.stockValueIdr || b.totalQty - a.totalQty).map((w) => ({ ...w, valueSharePct: totalPhysicalValueIdr > 0 ? (w.stockValueIdr / totalPhysicalValueIdr) * 100 : 0 }));
  const categories = Array.from(catAggMap.values()).sort((a, b) => b.stockValueIdr - a.stockValueIdr || b.skuCount - a.skuCount).slice(0, 30).map((c) => ({ ...c, valueSharePct: totalPhysicalValueIdr > 0 ? (c.stockValueIdr / totalPhysicalValueIdr) * 100 : 0 }));
  const valuedSkuCount = enrichedSkus.filter((s) => s.abcClass !== 'N/A').length;
  const abcSummary = ['A', 'B', 'C'].map((cls) => {
    const mem = enrichedSkus.filter((s) => s.abcClass === cls);
    const val = mem.reduce((a, x) => a + x.stockValueIdr, 0);
    return { abcClass: cls, skuCount: mem.length, skuSharePct: valuedSkuCount > 0 ? (mem.length / valuedSkuCount) * 100 : 0, totalQty: mem.reduce((a, x) => a + x.physicalQty, 0), stockValueIdr: val, valueSharePct: totalPhysicalValueIdr > 0 ? (val / totalPhysicalValueIdr) * 100 : 0 };
  });
  const velocitySummary = [
    { key: 'fast', label: 'Fast-Moving' },
    { key: 'medium', label: 'Medium-Moving' },
    { key: 'slow', label: 'Slow-Moving' },
    { key: 'dead', label: 'Dead Stock (Tanpa Keluar)' },
  ].map((def) => {
    const mem = enrichedSkus.filter((s) => s.velocityClass === def.key && s.physicalQty > 0);
    const val = mem.reduce((a, x) => a + x.stockValueIdr, 0);
    return { velocityClass: def.key, label: def.label, skuCount: mem.length, totalQty: mem.reduce((a, x) => a + x.physicalQty, 0), stockValueIdr: val, valueSharePct: totalPhysicalValueIdr > 0 ? (val / totalPhysicalValueIdr) * 100 : 0 };
  });

  const outOfStockSkus = enrichedSkus.filter((s) => s.healthStatus === 'out_of_stock').length;
  const lowStockSkus = enrichedSkus.filter((s) => s.healthStatus === 'low_stock').length;
  const overStockSkus = enrichedSkus.filter((s) => s.healthStatus === 'overstock').length;
  const monthly = Array.from(monthlyMap.values()).sort((a, b) => a.month.localeCompare(b.month)).map((m) => ({ ...m, netQtyMovement: m.grnInQty - (m.doOutQty > 0 ? m.doOutQty : m.siOutQty) }));
  const intransitWhArr = Array.from(intransitWhMap.values()).sort((a, b) => b.estimatedValueIdr - a.estimatedValueIdr || b.totalQty - a.totalQty);

  return {
    cutoffDate: ACTIVE_CUTOFF_DATE,
    period: { dateFrom, dateTo },
    summary: {
      totalActivePhysicalSkus: enrichedSkus.length,
      inStockSkus: enrichedSkus.length - outOfStockSkus,
      lowStockSkus,
      outOfStockSkus,
      overStockSkus,
      stockoutRatePct: enrichedSkus.length > 0 ? (outOfStockSkus / enrichedSkus.length) * 100 : 0,
      totalPhysicalQty,
      totalPhysicalValueIdr,
      glInventoryBalanceIdr,
      valuationVarianceVsGlIdr: totalPhysicalValueIdr - glInventoryBalanceIdr,
      totalPeriodInflowQty: monthly.reduce((s, m) => s + m.grnInQty, 0),
      totalPeriodOutflowQty: monthly.reduce((s, m) => s + (m.doOutQty > 0 ? m.doOutQty : m.siOutQty), 0),
    },
    diagnostics: { costSource, minStockSource: itemMinStockCol, outflowSource, inflowSource, tablesDetected, intransitStrictlyExcluded: true },
    warehouses,
    categories,
    intransit: {
      skuCount: intransitWhArr.reduce((s, w) => s + w.skuCount, 0),
      totalQty: intransitWhArr.reduce((s, w) => s + w.totalQty, 0),
      estimatedValueIdr: intransitWhArr.reduce((s, w) => s + w.estimatedValueIdr, 0),
      warehouses: intransitWhArr,
      topItems: intransitItemsList.sort((a, b) => b.estimatedValueIdr - a.estimatedValueIdr || b.qty - a.qty).slice(0, 40),
    },
    abcSummary,
    abcTopItems: enrichedSkus.slice(0, 120),
    criticalStockItems: enrichedSkus.filter((s) => s.healthStatus === 'out_of_stock' || s.healthStatus === 'low_stock').sort((a, b) => b.outflowQty - a.outflowQty || a.physicalQty - b.physicalQty).slice(0, 100),
    velocitySummary,
    slowDeadItems: enrichedSkus.filter((s) => (s.velocityClass === 'dead' || s.velocityClass === 'slow') && s.physicalQty > 0).sort((a, b) => b.stockValueIdr - a.stockValueIdr || b.physicalQty - a.physicalQty).slice(0, 100),
    monthly,
    fetchedAt: new Date().toISOString(),
  };
}

async function queryMyErpPlusProductionBi(conn, opts) {
  const dateFrom = clampActiveDateFrom(opts.dateFrom);
  const dateTo = /^\\d{4}-\\d{2}-\\d{2}$/.test(opts.dateTo || '') && opts.dateTo >= dateFrom
    ? opts.dateTo
    : new Date().toISOString().slice(0, 10);

  const [tblRows] = await conn.query('SHOW TABLES');
  const allTables = tblRows.map((r) => String(Object.values(r)[0] || '').trim()).filter((t) => SAFE_ID.test(t));
  const tblSet = new Set(allTables.map((t) => t.toLowerCase()));
  const hasItem = tblSet.has('m1_item');
  const hasContact = tblSet.has('m1_contact');
  const hasSalesOrder = tblSet.has('m5_so');
  const hasSalesOrderDetail = tblSet.has('m5_so_detail');
  const hasFinance = tblSet.has('m2_transaction_journal') && tblSet.has('m1_coa');

  const soCols = hasSalesOrder ? await getTableCols(conn, 'm5_so') : [];
  const sodCols = hasSalesOrderDetail ? await getTableCols(conn, 'm5_so_detail') : [];
  const contactCols = hasContact ? await getTableCols(conn, 'm1_contact') : [];

  const classifyM6 = (tbl) => {
    const t = tbl.toLowerCase();
    if (t.includes('_detail') || t.endsWith('detail')) return 'detail';
    if (/bom|formula|resep|bill/.test(t)) return 'bom';
    if (/qc|quality|reject|scrap|afkir|defect/.test(t)) return 'quality';
    if (/material|bahan|issue|pakai|pemakaian|_mi\\b|_mr\\b|raw/.test(t)) return 'material_issue';
    if (/hasil|result|output|finish|_fg\\b|realisasi|receipt|terima/.test(t)) return 'output';
    if (/wo|spk|mo|order|plan|jadwal|prod|produksi|work/.test(t)) return 'work_order';
    return 'other';
  };
  const classifyGlGroup = (accNo, accName) => {
    const n = String(accName || '').toLowerCase();
    if (accNo.startsWith('5201') || accNo.startsWith('5101') || /bahan baku|material|pembelian|raw material|kemasan|packing/.test(n)) return 'Bahan Baku';
    if (/tenaga kerja|upah|buruh|gaji produksi|tkl|labour|labor|lembur/.test(n)) return 'Tenaga Kerja';
    if (/overhead|listrik pabrik|penyusutan mesin|maintenance|perawatan mesin|bop|pabrik|utilitas/.test(n)) return 'Overhead Pabrik';
    return 'Biaya Produksi Lainnya';
  };

  const discoveredTables = [];
  for (const tbl of allTables.filter((t) => t.toLowerCase().startsWith('m6_'))) {
    try {
      const cols = await getTableCols(conn, tbl);
      const [cRows] = await conn.query('SELECT COUNT(*) AS cnt FROM \`' + tbl + '\`');
      const dateColumn = pickBiColByRegex(cols, [/tgl$/, /tanggal/, /date$/, /tgltransaksi/, /tglmulai/]);
      discoveredTables.push({ tableName: tbl, role: classifyM6(tbl), rowCount: Number(cRows[0] && cRows[0].cnt || 0), dateColumn, columns: cols });
    } catch {}
  }

  const monthlyMap = new Map();
  const ensureMonth = (ym) => {
    if (!/^\\d{4}-\\d{2}$/.test(ym)) return null;
    let row = monthlyMap.get(ym);
    if (!row) {
      row = {
        month: ym,
        soCount: 0, soItemQty: 0, soTotalValue: 0,
        woCount: 0, woLinkedToSoCount: 0, soLinkedToWoCount: 0, woUnlinkedCount: 0, soWithoutWoCount: 0,
        woToSoPct: null, soCoveredByWoPct: null, woVsSoRatioPct: null,
        plannedQty: 0, actualOutputQty: 0, achievementPct: null, outputDocCount: 0,
        woCompleteOnlyCount: 0, woCompleteCount: 0, woInProgressCount: 0, woOpenCount: 0, woCompletionRatePct: null,
        goodQty: 0, rejectQty: 0, yieldPct: null, rejectRatePct: null,
        plannedMaterialQty: 0, actualMaterialQty: 0, materialVariancePct: null, materialIssueCostIdr: 0,
        glMaterialCost: 0, glLaborCost: 0, glOverheadCost: 0, glOtherProdCost: 0, glTotalProdCost: 0, unitCostIdr: null,
      };
      monthlyMap.set(ym, row);
    }
    return row;
  };
  for (const ym of listBiMonthsBetween(dateFrom.slice(0, 7), dateTo.slice(0, 7))) ensureMonth(ym);

  const pickRole = (role) => {
    const cands = discoveredTables.filter((t) => t.role === role && Boolean(t.dateColumn));
    return cands.length ? [...cands].sort((a, b) => b.rowCount - a.rowCount)[0] : null;
  };
  const woTable = pickRole('work_order');
  const outputTable = pickRole('output');
  const materialTable = pickRole('material_issue');
  const qualityTable = pickRole('quality');

  const woSoLinks = [];
  const openWorkOrders = [];
  const productQuality = [];
  const topMaterials = [];
  let qualitySource = 'unavailable';
  let woSoLinkMethod = woTable ? 'unlinked_no_fk_column' : 'no_wo_table';
  let woSoLinkColumn = null;
  let hasM6TransactionsInPeriod = false;

  const soIdCol = pickBiColByRegex(soCols, [/^soid$/, /^id$/]);
  const soDateCol = pickBiColByRegex(soCols, [/^sotgl$/, /tgl$/, /date$/]);
  const soNoCol = pickBiColByRegex(soCols, [/^sonotransaksi$/, /^sono$/, /notransaksi/, /nomor/, /kode/]);
  const soStatusCol = pickBiColByRegex(soCols, [/^sostatus$/, /status$/]);
  const soTotalCol = pickBiColByRegex(soCols, [/^sototaltransaksi$/, /totaltransaksi/, /total$/]);
  const soKursCol = pickBiColByRegex(soCols, [/^sokurs$/, /kurs/]);
  const soCustCol = pickBiColByRegex(soCols, [/^socustomer$/, /^sokontak$/, /customer/, /kontak/, /idcontact/]);
  const soStatusFilter = soStatusCol ? 'COALESCE(s.\`' + soStatusCol + '\`, 0) NOT IN (6, 12)' : '1 = 1';
  const cIdCol = pickBiColByRegex(contactCols, [/^kid$/, /^cid$/, /^id$/]);
  const cNameCol = pickBiColByRegex(contactCols, [/^knama$/, /^cnama$/, /nama/]);

  if (hasSalesOrder && soDateCol) {
    try {
      const kExpr = soKursCol ? 'COALESCE(NULLIF(s.\`' + soKursCol + '\`, 0), 1)' : '1';
      const vExpr = soTotalCol ? 'COALESCE(s.\`' + soTotalCol + '\`, 0) * ' + kExpr : '0';
      const [soRows] = await conn.query(
        "SELECT DATE_FORMAT(s.\`" + soDateCol + "\`, '%Y-%m') AS month, COUNT(*) AS soCount, COALESCE(SUM(" + vExpr + "), 0) AS soTotalValue FROM m5_so s WHERE " + soStatusFilter + " AND s.\`" + soDateCol + "\` >= ? AND s.\`" + soDateCol + "\` <= ? GROUP BY DATE_FORMAT(s.\`" + soDateCol + "\`, '%Y-%m')",
        [dateFrom, dateTo]
      );
      for (const r of soRows) {
        const row = ensureMonth(String(r.month || ''));
        if (row) { row.soCount = Number(r.soCount || 0); row.soTotalValue = Number(r.soTotalValue || 0); }
      }
      if (hasSalesOrderDetail && soIdCol) {
        const sodSoFk = pickBiColByRegex(sodCols, [/^idso$/, /soid/, /id_so/]);
        const sodQtyCol = pickBiColByRegex(sodCols, [/^sodqty$/, /qty$/, /jml$/, /jumlah/]);
        if (sodSoFk && sodQtyCol) {
          const [sdRows] = await conn.query(
            "SELECT DATE_FORMAT(s.\`" + soDateCol + "\`, '%Y-%m') AS month, COALESCE(SUM(COALESCE(sd.\`" + sodQtyCol + "\`, 0)), 0) AS soItemQty FROM m5_so_detail sd INNER JOIN m5_so s ON s.\`" + soIdCol + "\` = sd.\`" + sodSoFk + "\` WHERE " + soStatusFilter + " AND s.\`" + soDateCol + "\` >= ? AND s.\`" + soDateCol + "\` <= ? GROUP BY DATE_FORMAT(s.\`" + soDateCol + "\`, '%Y-%m')",
            [dateFrom, dateTo]
          );
          for (const r of sdRows) { const row = ensureMonth(String(r.month || '')); if (row) row.soItemQty = Number(r.soItemQty || 0); }
        }
      }
    } catch {}
  }

  if (woTable && woTable.dateColumn && woTable.rowCount > 0) {
    const cols = woTable.columns, dateCol = woTable.dateColumn;
    const idCol = pickBiColByRegex(cols, [/id$/, /^id/]);
    const docNoCol = pickBiColByRegex(cols, [/notransaksi/, /nomor/, /kode/, /no_/]);
    const statusCol = pickBiColByRegex(cols, [/status$/]);
    const isCloseCol = pickBiColByRegex(cols, [/isclose/, /close$/]);
    const targetDateCol = pickBiColByRegex(cols, [/tglselesai/, /tgltarget/, /tgldipenuhi/, /duedate/, /deadline/]);
    const planQtyCol = pickBiColByRegex(cols, [/jmltarget/, /qtytarget/, /jmlrencana/, /qtyplan/, /jml$/, /qty$/, /jumlah/]);
    const actualQtyCol = pickBiColByRegex(cols, [/jmlhasil/, /qtyhasil/, /jmlrealisasi/, /qtyactual/, /jmljadi/, /jmlok/]);
    const rejectQtyCol = pickBiColByRegex(cols, [/reject/, /scrap/, /rusak/, /afkir/, /cacat/, /gagal/]);
    const itemCol = pickBiColByRegex(cols, [/idbarang/, /iditem/, /^bid$/]);
    const woSoIdCol = pickBiColByRegex(cols, [/idso$/, /soid$/, /woidso/, /spkidso/, /id_so$/, /idorder/]);
    const woSoNoCol = pickBiColByRegex(cols, [/noso$/, /so_no/, /refso/, /soref/, /notransaksiso/]);
    const statusFilter = statusCol ? 'COALESCE(h.\`' + statusCol + '\`, 0) NOT IN (6, 12)' : '1 = 1';
    const closeCond = isCloseCol ? 'COALESCE(h.\`' + isCloseCol + '\`, 0) = 1' : '0 = 1';
    const detailTbl = discoveredTables.find((t) => t.tableName.toLowerCase() === woTable.tableName.toLowerCase() + '_detail' || t.tableName.toLowerCase() === woTable.tableName.toLowerCase() + 'detail');

    try {
      const [wRows] = await conn.query(
        "SELECT DATE_FORMAT(h.\`" + dateCol + "\`, '%Y-%m') AS month, COUNT(*) AS woCount, " +
        (statusCol ? 'SUM(CASE WHEN COALESCE(h.\`' + statusCol + '\`,0) = 4 THEN 1 ELSE 0 END)' : '0') + ' AS woCompleteOnly, ' +
        (statusCol ? 'SUM(CASE WHEN COALESCE(h.\`' + statusCol + '\`,0) IN (4,7) OR ' + closeCond + ' THEN 1 ELSE 0 END)' : '0') + ' AS woComplete, ' +
        (statusCol ? 'SUM(CASE WHEN COALESCE(h.\`' + statusCol + '\`,0) = 3 AND NOT (' + closeCond + ') THEN 1 ELSE 0 END)' : '0') + ' AS woInProgress, ' +
        (statusCol ? 'SUM(CASE WHEN COALESCE(h.\`' + statusCol + '\`,0) IN (0,1,2) AND NOT (' + closeCond + ') THEN 1 ELSE 0 END)' : 'COUNT(*)') + ' AS woOpen, ' +
        (planQtyCol ? 'COALESCE(SUM(COALESCE(h.\`' + planQtyCol + '\`, 0)), 0)' : '0') + ' AS plannedQty, ' +
        (actualQtyCol ? 'COALESCE(SUM(COALESCE(h.\`' + actualQtyCol + '\`, 0)), 0)' : '0') + ' AS actualQty, ' +
        (rejectQtyCol ? 'COALESCE(SUM(COALESCE(h.\`' + rejectQtyCol + '\`, 0)), 0)' : '0') +
        " AS rejectQty FROM \`" + woTable.tableName + "\` h WHERE " + statusFilter + " AND h.\`" + dateCol + "\` >= ? AND h.\`" + dateCol + "\` <= ? GROUP BY DATE_FORMAT(h.\`" + dateCol + "\`, '%Y-%m')",
        [dateFrom, dateTo]
      );
      for (const r of wRows) {
        const row = ensureMonth(String(r.month || ''));
        if (!row) continue;
        if (Number(r.woCount || 0) > 0) hasM6TransactionsInPeriod = true;
        row.woCount = Number(r.woCount || 0);
        row.woCompleteOnlyCount = Number(r.woCompleteOnly || 0);
        row.woCompleteCount = Number(r.woComplete || 0);
        row.woInProgressCount = Number(r.woInProgress || 0);
        row.woOpenCount = Number(r.woOpen || 0);
        row.plannedQty = Number(r.plannedQty || 0);
        if (actualQtyCol) { row.actualOutputQty = Number(r.actualQty || 0); row.goodQty = Math.max(0, row.actualOutputQty - Number(r.rejectQty || 0)); }
        if (rejectQtyCol) { row.rejectQty = Number(r.rejectQty || 0); qualitySource = 'm6_reject_column'; }
      }

      const soKursExpr = soKursCol ? 'COALESCE(NULLIF(s.\`' + soKursCol + '\`, 0), 1)' : '1';
      const soValExpr = soTotalCol ? 'COALESCE(s.\`' + soTotalCol + '\`, 0) * ' + soKursExpr : '0';
      const custJoin = (hasContact && cIdCol && soCustCol) ? 'LEFT JOIN m1_contact c ON c.\`' + cIdCol + '\` = s.\`' + soCustCol + '\`' : '';
      const custNameExpr = (hasContact && cIdCol && cNameCol && soCustCol) ? "COALESCE(NULLIF(TRIM(c.\`" + cNameCol + "\`), ''), '-')" : "'-'";
      const woKeyCol = idCol || docNoCol || dateCol;

      if (hasSalesOrder && soIdCol && woSoIdCol) {
        woSoLinkMethod = 'wo_header_idso'; woSoLinkColumn = woTable.tableName + '.' + woSoIdCol;
        const [lmRows] = await conn.query(
          "SELECT DATE_FORMAT(h.\`" + dateCol + "\`, '%Y-%m') AS month, COUNT(DISTINCT CASE WHEN s.\`" + soIdCol + "\` IS NOT NULL THEN h.\`" + woKeyCol + "\` END) AS woLinked, COUNT(DISTINCT s.\`" + soIdCol + "\`) AS soLinked FROM \`" + woTable.tableName + "\` h LEFT JOIN m5_so s ON s.\`" + soIdCol + "\` = h.\`" + woSoIdCol + "\` AND " + soStatusFilter + " WHERE " + statusFilter + " AND h.\`" + dateCol + "\` >= ? AND h.\`" + dateCol + "\` <= ? GROUP BY DATE_FORMAT(h.\`" + dateCol + "\`, '%Y-%m')",
          [dateFrom, dateTo]
        );
        for (const r of lmRows) { const row = ensureMonth(String(r.month || '')); if (row) { row.woLinkedToSoCount = Number(r.woLinked || 0); row.soLinkedToWoCount = Number(r.soLinked || 0); } }
        const [lkRows] = await conn.query(
          'SELECT ' + (docNoCol ? "COALESCE(NULLIF(TRIM(h.\`" + docNoCol + "\`), ''), '-')" : "'-'") + ' AS woDocNo, h.\`' + dateCol + '\` AS woDate, ' + (statusCol ? 'COALESCE(h.\`' + statusCol + '\`, 0)' : '0') + ' AS woStatus, ' + (planQtyCol ? 'COALESCE(h.\`' + planQtyCol + '\`, 0)' : '0') + ' AS woQty, CASE WHEN s.\`' + soIdCol + '\` IS NOT NULL THEN 1 ELSE 0 END AS isLinked, ' + (soNoCol ? "COALESCE(NULLIF(TRIM(s.\`" + soNoCol + "\`), ''), '-')" : "'-'") + ' AS soDocNo, ' + (soDateCol ? 's.\`' + soDateCol + '\`' : 'NULL') + ' AS soDate, ' + custNameExpr + ' AS customerName, ' + soValExpr + ' AS soTotalValue FROM \`' + woTable.tableName + '\` h LEFT JOIN m5_so s ON s.\`' + soIdCol + '\` = h.\`' + woSoIdCol + '\` AND ' + soStatusFilter + ' ' + custJoin + ' WHERE ' + statusFilter + ' AND h.\`' + dateCol + '\` >= ? AND h.\`' + dateCol + '\` <= ? ORDER BY h.\`' + dateCol + '\` DESC LIMIT 60',
          [dateFrom, dateTo]
        );
        for (const r of lkRows) {
          woSoLinks.push({ woDocNo: String(r.woDocNo || '-'), woDate: fmtDate(r.woDate), woStatusLabel: statusLabel(r.woStatus), woQty: Number(r.woQty || 0), isLinkedToSo: Number(r.isLinked || 0) === 1, soDocNo: String(r.soDocNo || '-'), soDate: fmtDate(r.soDate), customerName: String(r.customerName || '-'), soTotalValue: Number(r.soTotalValue || 0) });
        }
      } else if (hasSalesOrder && soNoCol && woSoNoCol) {
        woSoLinkMethod = 'wo_header_noso'; woSoLinkColumn = woTable.tableName + '.' + woSoNoCol;
        const [lmRows] = await conn.query(
          "SELECT DATE_FORMAT(h.\`" + dateCol + "\`, '%Y-%m') AS month, COUNT(DISTINCT CASE WHEN s.\`" + soNoCol + "\` IS NOT NULL THEN h.\`" + woKeyCol + "\` END) AS woLinked, COUNT(DISTINCT s.\`" + soNoCol + "\`) AS soLinked FROM \`" + woTable.tableName + "\` h LEFT JOIN m5_so s ON TRIM(s.\`" + soNoCol + "\`) = TRIM(h.\`" + woSoNoCol + "\`) AND " + soStatusFilter + " WHERE " + statusFilter + " AND h.\`" + dateCol + "\` >= ? AND h.\`" + dateCol + "\` <= ? GROUP BY DATE_FORMAT(h.\`" + dateCol + "\`, '%Y-%m')",
          [dateFrom, dateTo]
        );
        for (const r of lmRows) { const row = ensureMonth(String(r.month || '')); if (row) { row.woLinkedToSoCount = Number(r.woLinked || 0); row.soLinkedToWoCount = Number(r.soLinked || 0); } }
        const [lkRows] = await conn.query(
          'SELECT ' + (docNoCol ? "COALESCE(NULLIF(TRIM(h.\`" + docNoCol + "\`), ''), '-')" : "'-'") + ' AS woDocNo, h.\`' + dateCol + '\` AS woDate, ' + (statusCol ? 'COALESCE(h.\`' + statusCol + '\`, 0)' : '0') + ' AS woStatus, ' + (planQtyCol ? 'COALESCE(h.\`' + planQtyCol + '\`, 0)' : '0') + ' AS woQty, CASE WHEN s.\`' + soNoCol + '\` IS NOT NULL THEN 1 ELSE 0 END AS isLinked, COALESCE(NULLIF(TRIM(s.\`' + soNoCol + "\`), ''), '-') AS soDocNo, " + (soDateCol ? 's.\`' + soDateCol + '\`' : 'NULL') + ' AS soDate, ' + custNameExpr + ' AS customerName, ' + soValExpr + ' AS soTotalValue FROM \`' + woTable.tableName + '\` h LEFT JOIN m5_so s ON TRIM(s.\`' + soNoCol + '\`) = TRIM(h.\`' + woSoNoCol + '\`) AND ' + soStatusFilter + ' ' + custJoin + ' WHERE ' + statusFilter + ' AND h.\`' + dateCol + '\` >= ? AND h.\`' + dateCol + '\` <= ? ORDER BY h.\`' + dateCol + '\` DESC LIMIT 60',
          [dateFrom, dateTo]
        );
        for (const r of lkRows) {
          woSoLinks.push({ woDocNo: String(r.woDocNo || '-'), woDate: fmtDate(r.woDate), woStatusLabel: statusLabel(r.woStatus), woQty: Number(r.woQty || 0), isLinkedToSo: Number(r.isLinked || 0) === 1, soDocNo: String(r.soDocNo || '-'), soDate: fmtDate(r.soDate), customerName: String(r.customerName || '-'), soTotalValue: Number(r.soTotalValue || 0) });
        }
      } else if (hasSalesOrder && soIdCol && detailTbl && idCol) {
        const dWoFk = pickBiColByRegex(detailTbl.columns, [/idwo/, /idspk/, /idmo/, /idprod/]);
        const dSoFk = pickBiColByRegex(detailTbl.columns, [/idso$/, /soid$/, /id_so$/]);
        if (dWoFk && dSoFk) {
          woSoLinkMethod = 'wo_detail_idso'; woSoLinkColumn = detailTbl.tableName + '.' + dSoFk;
          const [lmRows] = await conn.query(
            "SELECT DATE_FORMAT(h.\`" + dateCol + "\`, '%Y-%m') AS month, COUNT(DISTINCT CASE WHEN s.\`" + soIdCol + "\` IS NOT NULL THEN h.\`" + idCol + "\` END) AS woLinked, COUNT(DISTINCT s.\`" + soIdCol + "\`) AS soLinked FROM \`" + woTable.tableName + "\` h LEFT JOIN \`" + detailTbl.tableName + "\` d ON d.\`" + dWoFk + "\` = h.\`" + idCol + "\` LEFT JOIN m5_so s ON s.\`" + soIdCol + "\` = d.\`" + dSoFk + "\` AND " + soStatusFilter + " WHERE " + statusFilter + " AND h.\`" + dateCol + "\` >= ? AND h.\`" + dateCol + "\` <= ? GROUP BY DATE_FORMAT(h.\`" + dateCol + "\`, '%Y-%m')",
            [dateFrom, dateTo]
          );
          for (const r of lmRows) { const row = ensureMonth(String(r.month || '')); if (row) { row.woLinkedToSoCount = Number(r.woLinked || 0); row.soLinkedToWoCount = Number(r.soLinked || 0); } }
        }
      }
      if (woSoLinkMethod === 'unlinked_no_fk_column' && hasSalesOrder && idCol) {
        const soWoFk = pickBiColByRegex(soCols, [/idwo/, /woid/, /idspk/, /spkid/, /idmo/, /idprod/]);
        if (soWoFk) {
          woSoLinkMethod = 'so_header_idwo'; woSoLinkColumn = 'm5_so.' + soWoFk;
          const [revRows] = await conn.query(
            "SELECT DATE_FORMAT(h.\`" + dateCol + "\`, '%Y-%m') AS month, COUNT(DISTINCT CASE WHEN s.\`" + soWoFk + "\` IS NOT NULL THEN h.\`" + idCol + "\` END) AS woLinked, COUNT(DISTINCT s.\`" + (soIdCol || soWoFk) + "\`) AS soLinked FROM \`" + woTable.tableName + "\` h LEFT JOIN m5_so s ON s.\`" + soWoFk + "\` = h.\`" + idCol + "\` AND " + soStatusFilter + " WHERE " + statusFilter + " AND h.\`" + dateCol + "\` >= ? AND h.\`" + dateCol + "\` <= ? GROUP BY DATE_FORMAT(h.\`" + dateCol + "\`, '%Y-%m')",
            [dateFrom, dateTo]
          );
          for (const r of revRows) { const row = ensureMonth(String(r.month || '')); if (row) { row.woLinkedToSoCount = Number(r.woLinked || 0); row.soLinkedToWoCount = Number(r.soLinked || 0); } }
        }
      }

      if (statusCol) {
        const itJoin = hasItem && itemCol ? 'LEFT JOIN m1_item it ON it.bid = h.\`' + itemCol + '\`' : '';
        const [opRows] = await conn.query(
          'SELECT ' + (docNoCol ? "COALESCE(NULLIF(TRIM(h.\`" + docNoCol + "\`), ''), '-')" : "'-'") + ' AS docNo, h.\`' + dateCol + '\` AS docDate, ' + (targetDateCol ? 'h.\`' + targetDateCol + '\`' : 'NULL') + ' AS targetDate, ' + (hasItem && itemCol ? "COALESCE(NULLIF(TRIM(it.bnama), ''), '-')" : "'-'") + ' AS itemName, ' + (planQtyCol ? 'COALESCE(h.\`' + planQtyCol + '\`, 0)' : '0') + ' AS plannedQty, ' + (actualQtyCol ? 'COALESCE(h.\`' + actualQtyCol + '\`, 0)' : '0') + ' AS actualQty, COALESCE(h.\`' + statusCol + '\`, 0) AS statusCode, GREATEST(0, DATEDIFF(CURDATE(), h.\`' + dateCol + '\`)) AS ageDays FROM \`' + woTable.tableName + '\` h ' + itJoin + ' WHERE COALESCE(h.\`' + statusCol + '\`,0) IN (0,1,2,3) AND NOT (' + closeCond + ') AND h.\`' + dateCol + '\` >= ? AND h.\`' + dateCol + '\` <= ? ORDER BY h.\`' + dateCol + '\` ASC LIMIT 40',
          [dateFrom, dateTo]
        );
        for (const r of opRows) {
          openWorkOrders.push({ docNo: String(r.docNo || '-'), date: fmtDate(r.docDate), targetDate: fmtDate(r.targetDate), itemName: String(r.itemName || '-'), plannedQty: Number(r.plannedQty || 0), actualQty: Number(r.actualQty || 0), statusLabel: statusLabel(r.statusCode), ageDays: Number(r.ageDays || 0) });
        }
      }
    } catch {}
  }

  if (outputTable && outputTable.dateColumn && outputTable.rowCount > 0) {
    const cols = outputTable.columns, dateCol = outputTable.dateColumn;
    const statusCol = pickBiColByRegex(cols, [/status$/]);
    const goodCol = pickBiColByRegex(cols, [/jmlok/, /jmlbagus/, /jmljadi/, /jmlhasil/, /qtygood/, /jml$/, /qty$/]);
    const rejCol = pickBiColByRegex(cols, [/reject/, /scrap/, /rusak/, /afkir/, /cacat/, /gagal/]);
    const statusFilter = statusCol ? 'COALESCE(o.\`' + statusCol + '\`,0) NOT IN (6,12)' : '1=1';
    try {
      const [oRows] = await conn.query(
        "SELECT DATE_FORMAT(o.\`" + dateCol + "\`, '%Y-%m') AS month, COUNT(*) AS docCount, " + (goodCol ? 'COALESCE(SUM(COALESCE(o.\`' + goodCol + '\`, 0)), 0)' : '0') + ' AS goodQty, ' + (rejCol ? 'COALESCE(SUM(COALESCE(o.\`' + rejCol + '\`, 0)), 0)' : '0') + " AS rejectQty FROM \`" + outputTable.tableName + "\` o WHERE " + statusFilter + " AND o.\`" + dateCol + "\` >= ? AND o.\`" + dateCol + "\` <= ? GROUP BY DATE_FORMAT(o.\`" + dateCol + "\`, '%Y-%m')",
        [dateFrom, dateTo]
      );
      for (const r of oRows) {
        const row = ensureMonth(String(r.month || ''));
        if (!row) continue;
        if (Number(r.docCount || 0) > 0) hasM6TransactionsInPeriod = true;
        row.outputDocCount = Number(r.docCount || 0);
        if (goodCol) { row.goodQty = Number(r.goodQty || 0); row.actualOutputQty = Number(r.goodQty || 0) + Number(r.rejectQty || 0); }
        if (rejCol) { row.rejectQty = Number(r.rejectQty || 0); qualitySource = 'm6_reject_column'; }
      }
    } catch {}
  }

  const glProductionAccounts = [];
  let totalGlProductionCostIdr = 0;
  if (hasFinance) {
    try {
      const [glRows] = await conn.query(
        "SELECT DATE_FORMAT(j.ttgl, '%Y-%m') AS month, c.cnomor AS accountNo, c.cnama AS accountName, COUNT(*) AS entryCount, COALESCE(SUM(j.tdebit - j.tkredit), 0) AS amountIdr FROM m2_transaction_journal j INNER JOIN m1_coa c ON c.cnomor = j.tnorek WHERE COALESCE(j.tstatus,0) NOT IN (6,12) AND COALESCE(j.tposting,1)=1 AND c.cgd='D' AND (c.ctipe = 12 OR c.cnomor LIKE '52%' OR c.cnomor LIKE '53%' OR LOWER(c.cnama) LIKE '%produksi%' OR LOWER(c.cnama) LIKE '%pabrik%' OR LOWER(c.cnama) LIKE '%overhead%' OR LOWER(c.cnama) LIKE '%tenaga kerja langsung%') AND j.ttgl >= ? AND j.ttgl <= ? GROUP BY DATE_FORMAT(j.ttgl, '%Y-%m'), c.cnomor, c.cnama",
        [dateFrom, dateTo]
      );
      const accAgg = new Map();
      for (const r of glRows) {
        const ym = String(r.month || ''), accNo = String(r.accountNo || '').trim(), accName = String(r.accountName || '').trim();
        const amt = Number(r.amountIdr || 0), cnt = Number(r.entryCount || 0);
        if (!accNo) continue;
        const grp = classifyGlGroup(accNo, accName);
        const mRow = ensureMonth(ym);
        if (mRow) {
          if (grp === 'Bahan Baku') mRow.glMaterialCost += amt;
          else if (grp === 'Tenaga Kerja') mRow.glLaborCost += amt;
          else if (grp === 'Overhead Pabrik') mRow.glOverheadCost += amt;
          else mRow.glOtherProdCost += amt;
          mRow.glTotalProdCost += amt;
        }
        const ex = accAgg.get(accNo) || { accountNo: accNo, accountName: accName, costGroup: grp, entryCount: 0, amountIdr: 0 };
        ex.entryCount += cnt; ex.amountIdr += amt;
        accAgg.set(accNo, ex);
        totalGlProductionCostIdr += amt;
      }
      for (const a of Array.from(accAgg.values()).filter((x) => Math.abs(x.amountIdr) >= 1).sort((a, b) => Math.abs(b.amountIdr) - Math.abs(a.amountIdr)).slice(0, 40)) {
        glProductionAccounts.push(a);
      }
    } catch {}
  }

  const monthly = Array.from(monthlyMap.values()).sort((a, b) => a.month.localeCompare(b.month)).map((m) => {
    const totQ = m.goodQty + m.rejectQty;
    const effOut = m.actualOutputQty > 0 ? m.actualOutputQty : totQ;
    const woUnlinkedCount = Math.max(0, m.woCount - m.woLinkedToSoCount);
    const soWithoutWoCount = Math.max(0, m.soCount - m.soLinkedToWoCount);
    return {
      ...m,
      woUnlinkedCount,
      soWithoutWoCount,
      woToSoPct: m.woCount > 0 ? (m.woLinkedToSoCount / m.woCount) * 100 : null,
      soCoveredByWoPct: m.soCount > 0 ? (m.soLinkedToWoCount / m.soCount) * 100 : null,
      woVsSoRatioPct: m.soCount > 0 ? (m.woCount / m.soCount) * 100 : null,
      actualOutputQty: effOut,
      achievementPct: m.plannedQty > 0 ? (effOut / m.plannedQty) * 100 : null,
      woCompletionRatePct: m.woCount > 0 ? (m.woCompleteCount / m.woCount) * 100 : null,
      yieldPct: totQ > 0 ? (m.goodQty / totQ) * 100 : null,
      rejectRatePct: totQ > 0 ? (m.rejectQty / totQ) * 100 : null,
      materialVariancePct: m.plannedMaterialQty > 0 ? ((m.actualMaterialQty - m.plannedMaterialQty) / m.plannedMaterialQty) * 100 : null,
      unitCostIdr: effOut > 0 && m.glTotalProdCost > 0 ? m.glTotalProdCost / effOut : null,
    };
  });

  return {
    cutoffDate: ACTIVE_CUTOFF_DATE,
    period: { dateFrom, dateTo },
    discoveredTables,
    diagnostics: {
      hasM6Tables: discoveredTables.length > 0,
      hasM6TransactionsInPeriod,
      hasSalesOrderTable: hasSalesOrder,
      workOrderTable: woTable ? woTable.tableName : null,
      outputTable: outputTable ? outputTable.tableName : null,
      materialTable: materialTable ? materialTable.tableName : null,
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
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

const server = http.createServer(async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    if (!CONFIG.bridgeToken || auth !== 'Bearer ' + CONFIG.bridgeToken) {
      return sendJson(res, 401, { error: 'Unauthorized: Bearer token tidak cocok.' });
    }

    const url = new URL(req.url || '/', 'http://127.0.0.1:' + CONFIG.bridgePort);

    if (req.method === 'GET' && url.pathname === '/health') {
      const result = await withReadOnlyConn(async (conn) => {
        await conn.query('SELECT 1 AS ok');
        const caps = await detectMyErpPlusTables(conn);
        const useNativeStock = caps.hasStock && !CONFIG.stockView;

        if (useNativeStock) {
          const itemColsHealth = await getTableCols(conn, 'm1_item');
          const whColsHealth = caps.hasWarehouse ? await getTableCols(conn, 'm1_warehouse') : [];
          const { isPhysicalSql } = buildIntransitSqlParts(caps.hasWarehouse, whColsHealth);
          const whJoinHealth = caps.hasWarehouse ? 'LEFT JOIN m1_warehouse w ON w.wkode = s.kgudang' : '';
          const baseHealthFilter = (itemColsHealth.some((c) => c.toLowerCase() === 'bjenis')
            ? "i.baktif = 1 AND UPPER(TRIM(COALESCE(i.bjenis, ''))) = 'P'"
            : 'i.baktif = 1') + ' AND ' + isPhysicalSql;
          const [cnt] = await conn.query(
            'SELECT COUNT(*) AS total FROM m1_item_stock_warehouse s INNER JOIN m1_item i ON i.bid = s.idbarang ' + whJoinHealth + ' WHERE ' + baseHealthFilter
          );
          let warehouses = [];
          try {
            const whSql = caps.hasWarehouse
              ? "SELECT DISTINCT COALESCE(NULLIF(TRIM(w.wnama), ''), s.kgudang) AS wh FROM m1_item_stock_warehouse s INNER JOIN m1_item i ON i.bid = s.idbarang LEFT JOIN m1_warehouse w ON w.wkode = s.kgudang WHERE " + baseHealthFilter + ' ORDER BY wh ASC LIMIT 50'
              : 'SELECT DISTINCT s.kgudang AS wh FROM m1_item_stock_warehouse s INNER JOIN m1_item i ON i.bid = s.idbarang WHERE ' + baseHealthFilter + ' ORDER BY wh ASC LIMIT 50';
            const [wh] = await conn.query(whSql);
            warehouses = wh.map((r) => String(r.wh || '').trim()).filter(Boolean);
          } catch {}
          return {
            connected: true,
            stockMode: 'myerpplus',
            purchasingSupported: caps.hasPurchasing || caps.hasFinance,
            salesSupported: caps.hasSales,
            financeSupported: caps.hasFinance,
            assetsSupported: caps.hasAssets,
            employeesSupported: caps.hasContact,
            activeCutoffDate: ACTIVE_CUTOFF_DATE,
            database: CONFIG.mysqlDatabase,
            viewName: 'm1_item_stock_warehouse + m1_item (baktif=1, bjenis=P) + m1_warehouse (tanpa Intransit)',
            totalRows: Number(cnt[0]?.total || 0),
            warehouses,
          };
        }

        try {
          const mapping = await detectCustomColumns(conn);
          const [cnt] = await conn.query('SELECT COUNT(*) AS total FROM \`' + mapping.viewName + '\`');
          let warehouses = [];
          if (mapping.warehouseCol) {
            const [wh] = await conn.query(
              'SELECT DISTINCT \`' + mapping.warehouseCol + '\` AS wh FROM \`' + mapping.viewName + '\` WHERE \`' + mapping.warehouseCol + '\` IS NOT NULL AND \`' + mapping.warehouseCol + "\` <> '' ORDER BY wh ASC LIMIT 50"
            );
            warehouses = wh.map((r) => String(r.wh || '').trim()).filter(Boolean);
          }
          return {
            connected: true,
            stockMode: 'custom',
            purchasingSupported: caps.hasPurchasing || caps.hasFinance,
            salesSupported: caps.hasSales,
            financeSupported: caps.hasFinance,
            assetsSupported: caps.hasAssets,
            activeCutoffDate: ACTIVE_CUTOFF_DATE,
            database: CONFIG.mysqlDatabase,
            viewName: mapping.viewName,
            totalRows: Number(cnt[0]?.total || 0),
            warehouses,
            detectedColumns: mapping,
          };
        } catch {
          let availableTables = [];
          try {
            const [tbls] = await conn.query('SHOW TABLES');
            const allTbls = tbls.map((r) => String(Object.values(r)[0] || '').trim()).filter(Boolean);
            const stockLike = /(stok|stock|gudang|barang|item|warehouse|inv|loc|mutasi|persediaan)/i;
            availableTables = [
              ...allTbls.filter((t) => stockLike.test(t)),
              ...allTbls.filter((t) => !stockLike.test(t)),
            ].slice(0, 250);
          } catch {}
          return {
            connected: false,
            purchasingSupported: caps.hasPurchasing || caps.hasFinance,
            salesSupported: caps.hasSales,
            financeSupported: caps.hasFinance,
            assetsSupported: caps.hasAssets,
            employeesSupported: caps.hasContact,
            activeCutoffDate: ACTIVE_CUTOFF_DATE,
            database: CONFIG.mysqlDatabase,
            viewName: CONFIG.stockView || 'vw_ai_stok_barang',
            availableTables,
            error: 'MySQL lokal terhubung, tapi tabel/view stok tidak ditemukan.',
          };
        }
      });
      return sendJson(res, 200, result);
    }

    if (req.method === 'GET' && url.pathname === '/stock') {
      const search = (url.searchParams.get('q') || '').trim();
      const warehouse = (url.searchParams.get('warehouse') || '').trim();
      const category = (url.searchParams.get('category') || '').trim();
      const onlyLow = url.searchParams.get('low') === '1';
      const summaryOnly = url.searchParams.get('summaryOnly') === '1';
      const intransitOnly = url.searchParams.get('intransitOnly') === '1';
      const rawSort = (url.searchParams.get('qtySort') || '').trim().toLowerCase();
      const qtySort = rawSort === 'asc' || rawSort === 'desc' ? rawSort : '';
      const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get('limit')) || 100));

      const data = await withReadOnlyConn(async (conn) => {
        const caps = await detectMyErpPlusTables(conn);
        if (caps.hasStock && !CONFIG.stockView) {
          return queryMyErpPlusStock(conn, {
            search,
            warehouse,
            category,
            onlyLow,
            summaryOnly,
            intransitOnly,
            qtySort,
            limit,
            hasWarehouse: caps.hasWarehouse,
          });
        }

        const m = await detectCustomColumns(conn);
        const viewSql = '\`' + m.viewName + '\`';
        const activeCol = m.allColumns.find((c) => c.toLowerCase() === 'baktif' || c.toLowerCase() === 'aktif');
        const jenisCol = m.allColumns.find((c) => c.toLowerCase() === 'bjenis');
        const baseConds = [];
        if (activeCol) baseConds.push('\`' + activeCol + '\` = 1');
        if (jenisCol) baseConds.push("UPPER(TRIM(COALESCE(\`" + jenisCol + "\`, ''))) = 'P'");
        if (m.warehouseCol) {
          const whNorm = "LOWER(REPLACE(REPLACE(COALESCE(\`" + m.warehouseCol + "\`, ''), ' ', ''), '-', ''))";
          baseConds.push(intransitOnly ? whNorm + " LIKE '%intransit%'" : whNorm + " NOT LIKE '%intransit%'");
        }
        const baseWhereSql = baseConds.length ? 'WHERE ' + baseConds.join(' AND ') : '';

        const [cnt] = await conn.query('SELECT COUNT(*) AS total FROM ' + viewSql + ' ' + baseWhereSql);
        const totalActiveRows = Number(cnt[0]?.total || 0);

        let categories = [];
        if (m.categoryCol) {
          const catCol = '\`' + m.categoryCol + '\`';
          const qtyExpr = m.qtyCol ? 'COALESCE(SUM(\`' + m.qtyCol + '\`), 0)' : 'COUNT(*)';
          const zeroExpr = m.qtyCol ? 'SUM(CASE WHEN COALESCE(\`' + m.qtyCol + '\`, 0) <= 0 THEN 1 ELSE 0 END)' : '0';
          const [catRows] = await conn.query(
            "SELECT COALESCE(NULLIF(TRIM(CAST(" + catCol + " AS CHAR)), ''), 'Tanpa Kategori') AS category, COUNT(*) AS skuCount, " +
            qtyExpr + ' AS totalQty, ' + zeroExpr + ' AS zeroStockCount FROM ' + viewSql + ' ' + baseWhereSql + ' GROUP BY category ORDER BY category ASC LIMIT 100'
          );
          categories = catRows.map((r) => ({
            category: String(r.category || 'Tanpa Kategori').trim(),
            skuCount: Number(r.skuCount || 0),
            totalQty: Number(r.totalQty || 0),
            zeroStockCount: Number(r.zeroStockCount || 0),
          }));
        }

        const whWhereParts = [...baseConds];
        const whBinds = [];
        if (category && m.categoryCol) {
          whWhereParts.push("COALESCE(NULLIF(TRIM(CAST(\`" + m.categoryCol + "\` AS CHAR)), ''), 'Tanpa Kategori') = ?");
          whBinds.push(category);
        }
        const whWhereSql = whWhereParts.length ? 'WHERE ' + whWhereParts.join(' AND ') : '';

        let warehouses = [];
        if (m.warehouseCol) {
          const whCol = '\`' + m.warehouseCol + '\`';
          const qtyExpr = m.qtyCol ? 'COALESCE(SUM(\`' + m.qtyCol + '\`), 0)' : 'COUNT(*)';
          const zeroExpr = m.qtyCol ? 'SUM(CASE WHEN COALESCE(\`' + m.qtyCol + '\`, 0) <= 0 THEN 1 ELSE 0 END)' : '0';
          const [whRows] = await conn.query(
            "SELECT COALESCE(NULLIF(TRIM(" + whCol + "), ''), 'Gudang Utama') AS warehouse, COUNT(*) AS skuCount, " + qtyExpr + ' AS totalQty, ' + zeroExpr + ' AS zeroStockCount FROM ' + viewSql + ' ' + whWhereSql + ' GROUP BY warehouse ORDER BY warehouse ASC LIMIT 50',
            whBinds
          );
          warehouses = whRows.map((r) => ({
            warehouse: String(r.warehouse || 'Gudang Utama'),
            skuCount: Number(r.skuCount || 0),
            totalQty: Number(r.totalQty || 0),
            zeroStockCount: Number(r.zeroStockCount || 0),
          }));
        } else {
          const qtyExpr = m.qtyCol ? 'COALESCE(SUM(\`' + m.qtyCol + '\`), 0)' : '0';
          const zeroExpr = m.qtyCol ? 'SUM(CASE WHEN COALESCE(\`' + m.qtyCol + '\`, 0) <= 0 THEN 1 ELSE 0 END)' : '0';
          const [agg] = await conn.query('SELECT COUNT(*) AS skuCount, ' + qtyExpr + ' AS totalQty, ' + zeroExpr + ' AS zeroStockCount FROM ' + viewSql + ' ' + whWhereSql, whBinds);
          warehouses = [{
            warehouse: 'Semua Gudang',
            skuCount: Number(agg[0]?.skuCount || 0),
            totalQty: Number(agg[0]?.totalQty || 0),
            zeroStockCount: Number(agg[0]?.zeroStockCount || 0),
          }];
        }

        const totalRows = category && m.categoryCol
          ? warehouses.reduce((acc, w) => acc + Number(w.skuCount || 0), 0)
          : totalActiveRows;

        if (summaryOnly && !category && !search) {
          return {
            items: [],
            warehouses,
            categories,
            selectedCategory: '',
            activeOnly: Boolean(activeCol),
            inventoryOnly: Boolean(jenisCol),
            qtySort,
            totalRows: totalActiveRows,
            totalActiveRows,
            viewName: m.viewName,
            detectedColumns: m,
            fetchedAt: new Date().toISOString(),
          };
        }

        const where = [...baseConds];
        const binds = [];
        if (category && m.categoryCol) {
          where.push("COALESCE(NULLIF(TRIM(CAST(\`" + m.categoryCol + "\` AS CHAR)), ''), 'Tanpa Kategori') = ?");
          binds.push(category);
        }
        if (warehouse && m.warehouseCol) {
          where.push('\`' + m.warehouseCol + '\` LIKE ?');
          binds.push('%' + warehouse + '%');
        }
        if (search) {
          const tokens = search.split(/\\s+/).filter((t) => t.length >= 2).slice(0, 5);
          const cols = [m.codeCol, m.nameCol, m.warehouseCol, m.categoryCol].filter(Boolean);
          if (cols.length && tokens.length) {
            for (const tok of tokens) {
              where.push('(' + cols.map((c) => { binds.push('%' + tok + '%'); return 'CAST(\`' + c + '\` AS CHAR) LIKE ?'; }).join(' OR ') + ')');
            }
          }
        }
        if (onlyLow && m.qtyCol) {
          where.push('COALESCE(\`' + m.qtyCol + '\`, 0) <= 10');
        }

        const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
        const orderParts = [];
        if (qtySort === 'desc' && m.qtyCol) {
          orderParts.push('COALESCE(\`' + m.qtyCol + '\`, 0) DESC');
        } else if (qtySort === 'asc' && m.qtyCol) {
          orderParts.push('COALESCE(\`' + m.qtyCol + '\`, 0) ASC');
        } else if (onlyLow && m.qtyCol) {
          orderParts.push('COALESCE(\`' + m.qtyCol + '\`, 0) ASC');
        }
        if (!qtySort && m.warehouseCol) orderParts.push('\`' + m.warehouseCol + '\` ASC');
        if (m.nameCol) orderParts.push('\`' + m.nameCol + '\` ASC');
        const orderSql = orderParts.length ? 'ORDER BY ' + orderParts.join(', ') : '';
        const selectCols = m.allColumns.slice(0, 14).map((c) => '\`' + c + '\`').join(', ');

        const [rows] = await conn.query('SELECT ' + selectCols + ' FROM ' + viewSql + ' ' + whereSql + ' ' + orderSql + ' LIMIT ?', [...binds, limit]);
        return {
          items: rows.map((row) => ({
            code: m.codeCol ? String(row[m.codeCol] ?? '').trim() : '-',
            name: m.nameCol ? String(row[m.nameCol] ?? '').trim() : '-',
            warehouse: m.warehouseCol ? String(row[m.warehouseCol] ?? '').trim() || 'Gudang Utama' : 'Gudang Utama',
            qty: m.qtyCol ? Number(row[m.qtyCol] ?? 0) : 0,
            unit: m.unitCol ? String(row[m.unitCol] ?? '').trim() || 'Pcs' : 'Pcs',
            category: m.categoryCol ? String(row[m.categoryCol] ?? '').trim() || 'Tanpa Kategori' : '',
          })),
          warehouses,
          categories,
          selectedCategory: category || '',
          activeOnly: Boolean(activeCol),
          inventoryOnly: Boolean(jenisCol),
          qtySort,
          totalRows,
          totalActiveRows,
          viewName: m.viewName,
          detectedColumns: m,
          fetchedAt: new Date().toISOString(),
        };
      });
      return sendJson(res, 200, data);
    }

    if (req.method === 'GET' && url.pathname === '/sales') {
      const search = (url.searchParams.get('q') || '').trim();
      const dateFrom = /^\\d{4}-\\d{2}-\\d{2}$/.test(url.searchParams.get('dateFrom') || '') ? url.searchParams.get('dateFrom') : '';
      const dateTo = /^\\d{4}-\\d{2}-\\d{2}$/.test(url.searchParams.get('dateTo') || '') ? url.searchParams.get('dateTo') : '';
      const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 35));

      const data = await withReadOnlyConn(async (conn) => {
        const caps = await detectMyErpPlusTables(conn);
        if (!caps.hasSales) {
          throw new Error('Tabel m5_si (Sales Invoice) tidak ditemukan di database ' + CONFIG.mysqlDatabase + '.');
        }
        return queryMyErpPlusSales(conn, { search, dateFrom, dateTo, limit }, caps);
      });
      return sendJson(res, 200, data);
    }

    if (req.method === 'GET' && url.pathname === '/sales-bi') {
      const dateFrom = /^\\d{4}-\\d{2}-\\d{2}$/.test(url.searchParams.get('dateFrom') || '') ? url.searchParams.get('dateFrom') : '';
      const dateTo = /^\\d{4}-\\d{2}-\\d{2}$/.test(url.searchParams.get('dateTo') || '') ? url.searchParams.get('dateTo') : '';

      const data = await withReadOnlyConn(async (conn) => {
        return queryMyErpPlusSalesBi(conn, { dateFrom, dateTo });
      });
      return sendJson(res, 200, data);
    }

    if (req.method === 'GET' && url.pathname === '/purchasing-bi') {
      const dateFrom = /^\\d{4}-\\d{2}-\\d{2}$/.test(url.searchParams.get('dateFrom') || '') ? url.searchParams.get('dateFrom') : '';
      const dateTo = /^\\d{4}-\\d{2}-\\d{2}$/.test(url.searchParams.get('dateTo') || '') ? url.searchParams.get('dateTo') : '';

      const data = await withReadOnlyConn(async (conn) => {
        return queryMyErpPlusPurchasingBi(conn, { dateFrom, dateTo });
      });
      return sendJson(res, 200, data);
    }

    if (req.method === 'GET' && url.pathname === '/inventory-bi') {
      const dateFrom = /^\\d{4}-\\d{2}-\\d{2}$/.test(url.searchParams.get('dateFrom') || '') ? url.searchParams.get('dateFrom') : '';
      const dateTo = /^\\d{4}-\\d{2}-\\d{2}$/.test(url.searchParams.get('dateTo') || '') ? url.searchParams.get('dateTo') : '';

      const data = await withReadOnlyConn(async (conn) => {
        return queryMyErpPlusInventoryBi(conn, { dateFrom, dateTo });
      });
      return sendJson(res, 200, data);
    }

    if (req.method === 'GET' && url.pathname === '/production-bi') {
      const dateFrom = /^\\d{4}-\\d{2}-\\d{2}$/.test(url.searchParams.get('dateFrom') || '') ? url.searchParams.get('dateFrom') : '';
      const dateTo = /^\\d{4}-\\d{2}-\\d{2}$/.test(url.searchParams.get('dateTo') || '') ? url.searchParams.get('dateTo') : '';

      const data = await withReadOnlyConn(async (conn) => {
        return queryMyErpPlusProductionBi(conn, { dateFrom, dateTo });
      });
      return sendJson(res, 200, data);
    }

    if (req.method === 'GET' && url.pathname === '/finance') {
      const search = (url.searchParams.get('q') || '').trim();
      const dateFrom = /^\\d{4}-\\d{2}-\\d{2}$/.test(url.searchParams.get('dateFrom') || '') ? url.searchParams.get('dateFrom') : '';
      const dateTo = /^\\d{4}-\\d{2}-\\d{2}$/.test(url.searchParams.get('dateTo') || '') ? url.searchParams.get('dateTo') : '';

      const data = await withReadOnlyConn(async (conn) => {
        const caps = await detectMyErpPlusTables(conn);
        if (!caps.hasFinance) {
          throw new Error('Tabel m1_coa / m2_transaction_journal tidak ditemukan di database ' + CONFIG.mysqlDatabase + '.');
        }
        return queryMyErpPlusFinance(conn, { search, dateFrom, dateTo }, caps);
      });
      return sendJson(res, 200, data);
    }

    if (req.method === 'GET' && url.pathname === '/purchasing') {
      const search = (url.searchParams.get('q') || '').trim();
      const dateFrom = /^\\d{4}-\\d{2}-\\d{2}$/.test(url.searchParams.get('dateFrom') || '') ? url.searchParams.get('dateFrom') : '';
      const dateTo = /^\\d{4}-\\d{2}-\\d{2}$/.test(url.searchParams.get('dateTo') || '') ? url.searchParams.get('dateTo') : '';
      const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 40));

      const data = await withReadOnlyConn(async (conn) => {
        const caps = await detectMyErpPlusTables(conn);
        if (!caps.hasPurchasing && !caps.hasFinance) {
          throw new Error('Tabel Purchasing (m4_ri / m4_po) dan Jurnal (m2_transaction_journal) tidak ditemukan di database ' + CONFIG.mysqlDatabase + '.');
        }
        return queryMyErpPlusPurchasing(conn, { search, dateFrom, dateTo, limit }, caps);
      });
      return sendJson(res, 200, data);
    }

    if (req.method === 'GET' && url.pathname === '/assets') {
      const search = (url.searchParams.get('q') || '').trim();
      const category = (url.searchParams.get('category') || '').trim();
      const includeDisposed = url.searchParams.get('includeDisposed') === '1';
      const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get('limit')) || 500));

      const data = await withReadOnlyConn(async (conn) => {
        const caps = await detectMyErpPlusTables(conn);
        if (!caps.hasAssets) {
          throw new Error('Tabel m7_asset (Aset Tetap) tidak ditemukan di database ' + CONFIG.mysqlDatabase + '.');
        }
        return queryMyErpPlusAssets(conn, { search, category, includeDisposed, limit }, caps);
      });
      return sendJson(res, 200, data);
    }

    if (req.method === 'GET' && url.pathname === '/employees') {
      const search = (url.searchParams.get('q') || '').trim();
      const onlyActive = url.searchParams.get('onlyActive') !== '0';
      const includeAll = url.searchParams.get('includeAll') === '1';
      const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get('limit')) || 500));

      const data = await withReadOnlyConn(async (conn) => {
        const caps = await detectMyErpPlusTables(conn);
        if (!caps.hasContact) {
          throw new Error('Tabel m1_contact (Master Kontak/Karyawan) tidak ditemukan di database ' + CONFIG.mysqlDatabase + '.');
        }
        return queryMyErpPlusEmployees(conn, { search, onlyActive, includeAll, limit });
      });
      return sendJson(res, 200, data);
    }

    if (req.method === 'GET' && url.pathname === '/pending-transactions') {
      const rulesParam = String(url.searchParams.get('rules') || '').trim();
      const ruleIds = rulesParam
        ? rulesParam.split(',').map((s) => s.trim()).filter(Boolean)
        : [
            'purchasing_pr_pending_po',
            'purchasing_po_approved_pending',
            'purchasing_po_in_progress',
            'purchasing_grn_pending_ri',
            'purchasing_ri_pending_vp',
            'sales_so_approved_pending',
            'sales_so_in_progress',
            'sales_do_pending_approval',
            'sales_do_pending_si',
          ];
      const warnDays = Number(url.searchParams.get('warnDays')) || 3;
      const overdueDays = Number(url.searchParams.get('overdueDays')) || 7;
      const data = await withReadOnlyConn(async (conn) =>
        queryMyErpPlusPendingTransactions(conn, { ruleIds, warnDays, overdueDays })
      );
      return sendJson(res, 200, data);
    }

    if (req.method === 'GET' && url.pathname === '/users-access') {
      const data = await withReadOnlyConn(async (conn) => queryMyErpPlusUsersAccess(conn));
      return sendJson(res, 200, data);
    }

    if (req.method === 'GET' && url.pathname === '/warehouses') {
      const data = await withReadOnlyConn(async (conn) => {
        const caps = await detectMyErpPlusTables(conn);
        const rows = [];
        const stockAggMap = new Map();

        if (caps.hasStock) {
          const itemCols = await getTableCols(conn, 'm1_item');
          const hasBjenis = itemCols.some((c) => c.toLowerCase() === 'bjenis');
          const itemCond = hasBjenis
            ? "i.baktif = 1 AND UPPER(TRIM(COALESCE(i.bjenis, ''))) = 'P'"
            : 'i.baktif = 1';
          const [aggRows] = await conn.query(
            "SELECT TRIM(COALESCE(s.kgudang, '')) AS kgudang, COUNT(*) AS skuCount, COALESCE(SUM(s.stok), 0) AS totalQty, SUM(CASE WHEN COALESCE(s.stok, 0) <= 0 THEN 1 ELSE 0 END) AS zeroStockCount FROM m1_item_stock_warehouse s INNER JOIN m1_item i ON i.bid = s.idbarang WHERE " +
              itemCond +
              " GROUP BY TRIM(COALESCE(s.kgudang, ''))"
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

        const seen = new Set();
        if (caps.hasWarehouse) {
          const whCols = await getTableCols(conn, 'm1_warehouse');
          const whMap = new Map(whCols.map((c) => [c.toLowerCase(), c]));
          const codeCol = whMap.get('wkode') || whMap.get('kode') || whCols[0] || 'wkode';
          const nameCol = whMap.get('wnama') || whMap.get('nama') || codeCol;
          const activeCol = whMap.get('waktif') || whMap.get('aktif') || '';
          const virtualCol =
            whMap.get('wisintransit') || whMap.get('is_intransit') || whMap.get('wisvirtual') || whMap.get('wnonfisik') || '';
          const physicalCol = whMap.get('wisfisik') || whMap.get('is_physical') || '';

          const [mRows] = await conn.query(
            'SELECT \`' + codeCol + '\` AS wkode, \`' + nameCol + '\` AS wnama' +
            (activeCol ? ', COALESCE(\`' + activeCol + '\`, 1) AS waktif' : ', 1 AS waktif') +
            (virtualCol ? ', COALESCE(\`' + virtualCol + '\`, 0) AS wvirtual' : ', 0 AS wvirtual') +
            (physicalCol ? ', COALESCE(\`' + physicalCol + '\`, 1) AS wfisik' : ', 1 AS wfisik') +
            ' FROM m1_warehouse ORDER BY \`' + nameCol + '\` ASC, \`' + codeCol + '\` ASC'
          );

          for (const r of mRows) {
            const code = String(r.wkode || '').trim();
            const name = String(r.wnama || code || 'Gudang').trim();
            if (!code && !name) continue;
            const normKey = (code || name).toLowerCase();
            seen.add(normKey);
            const agg = stockAggMap.get(normKey) || stockAggMap.get(name.toLowerCase()) || {
              skuCount: 0,
              totalQty: 0,
              zeroStockCount: 0,
            };
            const normName = (name + ' ' + code).toLowerCase().replace(/[\\s_-]+/g, '');
            const isIntransit =
              Number(r.wvirtual || 0) === 1 ||
              Number(r.wfisik ?? 1) === 0 ||
              normName.includes('intransit');
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
        }

        for (const [k, agg] of stockAggMap.entries()) {
          if (seen.has(k)) continue;
          const normName = k.replace(/[\\s_-]+/g, '');
          rows.push({
            code: k.toUpperCase(),
            name: k.toUpperCase(),
            isActive: true,
            isIntransit: normName.includes('intransit'),
            skuCount: agg.skuCount,
            totalQty: agg.totalQty,
            zeroStockCount: agg.zeroStockCount,
            source: 'stock_summary',
          });
        }

        rows.sort((a, b) => a.name.localeCompare(b.name));
        return { warehouses: rows, fetchedAt: new Date().toISOString() };
      });
      return sendJson(res, 200, data);
    }

    return sendJson(res, 404, { error: 'Endpoint tidak ditemukan. Gunakan /health, /stock, /warehouses, /purchasing, /sales, /finance, /assets, /employees, /pending-transactions, atau /users-access.' });
  } catch (err) {
    console.error('[ERP Bridge Error]', req.method, req.url, err instanceof Error ? err.message : err);
    return sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(CONFIG.bridgePort, '127.0.0.1', () => {
  console.log('[ERP Read-Only Bridge v11] Aktif di http://127.0.0.1:' + CONFIG.bridgePort);
  console.log('[ERP Read-Only Bridge v11] Target MySQL: ' + CONFIG.mysqlHost + ':' + CONFIG.mysqlPort + '/' + CONFIG.mysqlDatabase + ' (m1_* Stok, Master Gudang & Karyawan + m0_* Hak Akses User + m4_* Purchasing & Transaksi Terkait + m5_* Sales + m2_* Finance + m7_* Aset Tetap + /pending-transactions + /users-access + /warehouses | Cut-off >= ' + ACTIVE_CUTOFF_DATE + ')');
});
`;
