/**
 * Centralized Menu & Permission Registry (Single Source of Truth)
 *
 * Used by:
 * 1. Frontend Sidebar & Module Navigation (src/App.tsx, ErpStockView.tsx, BI Panel)
 * 2. User Role Detail Tree Matrix Editor (src/components/UserRoleManagementView.tsx)
 * 3. Server-side API Route Authorization Middleware (server.ts)
 * 4. Server-side Role-Based AI Data Gating (server.ts, server/erpMysql.ts, server/ai.ts)
 *
 * Adding any new menu here automatically registers it in the User Role form
 * and authorization checks without duplicating manual lists.
 */

export type PermissionAction =
  | 'favorite'
  | 'view'
  | 'insert'
  | 'update'
  | 'delete'
  | 'data'
  | 'approve'
  | 'notify';

export const PERMISSION_ACTIONS: {
  key: PermissionAction;
  label: string;
  shortLabel: string;
}[] = [
  { key: 'favorite', label: 'Favorit', shortLabel: 'Favorit' },
  { key: 'view', label: 'Select / View', shortLabel: 'Select/View' },
  { key: 'insert', label: 'Insert', shortLabel: 'Insert' },
  { key: 'update', label: 'Update / Draft', shortLabel: 'Update/Draft' },
  { key: 'delete', label: 'Delete', shortLabel: 'Delete' },
  { key: 'data', label: 'Data', shortLabel: 'Data' },
  { key: 'approve', label: 'Approve', shortLabel: 'Approve' },
  { key: 'notify', label: 'Notifikasi', shortLabel: 'Notif' },
];

export type MenuPermissionFlags = Record<PermissionAction, boolean>;
export type RolePermissionMatrix = Record<string, MenuPermissionFlags>;

export type MenuModuleTabId =
  | 'utama'
  | 'erp_ops'
  | 'erp_finance_bi'
  | 'governance'
  | 'admin';

export interface MenuModuleTab {
  id: MenuModuleTabId;
  label: string;
  description: string;
}

export interface MenuTreeNode {
  id: string;
  label: string;
  tabId: MenuModuleTabId;
  parentId?: string;
  sensitive?: boolean;
  description?: string;
  notifyHint?: string;
  children?: MenuTreeNode[];
}

export const MENU_MODULE_TABS: MenuModuleTab[] = [
  {
    id: 'utama',
    label: 'Utama & AI',
    description: 'Dashboard Eksekutif, Ask AI, dan Notifikasi',
  },
  {
    id: 'erp_ops',
    label: 'ERP Operasional',
    description: 'Inventory, Purchasing, Sales, dan Fixed Assets',
  },
  {
    id: 'erp_finance_bi',
    label: 'Keuangan & BI',
    description: 'Finance & Accounting serta Business Intelligence (BI)',
  },
  {
    id: 'governance',
    label: 'Aset, SOP & Meeting',
    description: 'Inventaris Aset, SOP Repository, Meeting, dan AI Studio',
  },
  {
    id: 'admin',
    label: 'Administrasi & Akses',
    description: 'Admin Console, User Login, User Role, dan Pengaturan Sistem',
  },
];

export const MENU_REGISTRY_TREE: MenuTreeNode[] = [
  // ===================== TAB 1: UTAMA & AI =====================
  {
    id: 'dashboard',
    label: 'Dashboard Eksekutif',
    tabId: 'utama',
    description: 'Ringkasan metrik operasional, SOP, dan grafik pinned',
    children: [
      {
        id: 'dashboard_kpi',
        label: 'Ringkasan KPI & Status Kerja',
        tabId: 'utama',
        parentId: 'dashboard',
      },
      {
        id: 'dashboard_charts',
        label: 'Grafik Pinned & Analitik Cepat',
        tabId: 'utama',
        parentId: 'dashboard',
      },
    ],
  },
  {
    id: 'ask_ai',
    label: 'Ask AI (Tanya NARA AI)',
    tabId: 'utama',
    description: 'Asisten AI dengan filter data otomatis sesuai hak akses role',
    children: [
      {
        id: 'ask_ai_sop',
        label: 'Tanya SOP & Prosedur Umum',
        tabId: 'utama',
        parentId: 'ask_ai',
      },
      {
        id: 'ask_ai_erp',
        label: 'Tanya Data Live ERP (Sesuai Modul Diizinkan)',
        tabId: 'utama',
        parentId: 'ask_ai',
      },
    ],
  },
  {
    id: 'notifications',
    label: 'Notifikasi & Pengingat',
    tabId: 'utama',
    children: [
      {
        id: 'notifications_inbox',
        label: 'Kotak Masuk Notifikasi',
        tabId: 'utama',
        parentId: 'notifications',
      },
      {
        id: 'notifications_send',
        label: 'Kirim Pengingat Email / WhatsApp',
        tabId: 'utama',
        parentId: 'notifications',
      },
    ],
  },

  // ===================== TAB 2: ERP OPERASIONAL =====================
  {
    id: 'erp_purchasing',
    label: 'Purchasing & Pembelian',
    tabId: 'erp_ops',
    children: [
      {
        id: 'erp_pr',
        label: 'Purchase Request (PR)',
        tabId: 'erp_ops',
        parentId: 'erp_purchasing',
      },
      {
        id: 'erp_po',
        label: 'Purchase Order (PO)',
        tabId: 'erp_ops',
        parentId: 'erp_purchasing',
        notifyHint: 'Notif saat ada PR disetujui yang perlu dibuatkan PO',
      },
      {
        id: 'erp_grn',
        label: 'Penerimaan Barang (GRN)',
        tabId: 'erp_ops',
        parentId: 'erp_purchasing',
        notifyHint: 'Notif saat ada PO disetujui / parsial menunggu penerimaan barang (GRN)',
      },
      {
        id: 'erp_ri',
        label: 'Faktur Pembelian (Receive Invoice / RI)',
        tabId: 'erp_ops',
        parentId: 'erp_purchasing',
        sensitive: true,
        notifyHint: 'Notif saat ada GRN selesai yang belum dibuatkan Faktur Pembelian',
      },
      {
        id: 'erp_vp',
        label: 'Pembayaran Supplier (Vendor Payment)',
        tabId: 'erp_ops',
        parentId: 'erp_purchasing',
        sensitive: true,
        notifyHint: 'Notif saat ada Faktur Pembelian belum lunas menunggu pembayaran',
      },
      {
        id: 'erp_ap',
        label: 'Hutang Supplier & Aging AP',
        tabId: 'erp_ops',
        parentId: 'erp_purchasing',
        sensitive: true,
      },
    ],
  },
  {
    id: 'erp_sales',
    label: 'Sales & Penjualan',
    tabId: 'erp_ops',
    children: [
      {
        id: 'erp_so',
        label: 'Sales Order (SO)',
        tabId: 'erp_ops',
        parentId: 'erp_sales',
      },
      {
        id: 'erp_do',
        label: 'Delivery Order (DO)',
        tabId: 'erp_ops',
        parentId: 'erp_sales',
        notifyHint: 'Notif saat ada SO menunggu pengiriman (DO) atau DO menunggu persetujuan',
      },
      {
        id: 'erp_si',
        label: 'Faktur Penjualan (Sales Invoice / SI)',
        tabId: 'erp_ops',
        parentId: 'erp_sales',
        notifyHint: 'Notif saat ada DO disetujui yang belum dibuatkan Faktur Penjualan',
      },
      {
        id: 'erp_sr',
        label: 'Retur Penjualan (Sales Return)',
        tabId: 'erp_ops',
        parentId: 'erp_sales',
      },
      {
        id: 'erp_ar',
        label: 'Piutang Customer & Aging AR',
        tabId: 'erp_ops',
        parentId: 'erp_sales',
        sensitive: true,
      },
    ],
  },
  {
    id: 'erp_inventory',
    label: 'Inventory & Gudang',
    tabId: 'erp_ops',
    children: [
      {
        id: 'erp_stock_list',
        label: 'Stok Gudang, SKU & Nilai Persediaan',
        tabId: 'erp_ops',
        parentId: 'erp_inventory',
      },
      {
        id: 'erp_warehouse_map',
        label: 'Peta & Kapasitas Gudang',
        tabId: 'erp_ops',
        parentId: 'erp_inventory',
      },
      {
        id: 'erp_warehouse_settings',
        label: 'Pengaturan Gudang & Safety Stock',
        tabId: 'erp_ops',
        parentId: 'erp_inventory',
        sensitive: true,
      },
    ],
  },
  {
    id: 'erp_assets',
    label: 'Fixed Assets ERP',
    tabId: 'erp_ops',
    children: [
      {
        id: 'erp_asset_list',
        label: 'Daftar Aset Tetap ERP',
        tabId: 'erp_ops',
        parentId: 'erp_assets',
      },
      {
        id: 'erp_asset_depreciation',
        label: 'Penyusutan & Nilai Buku Aset',
        tabId: 'erp_ops',
        parentId: 'erp_assets',
        sensitive: true,
      },
    ],
  },

  // ===================== TAB 3: KEUANGAN & BI =====================
  {
    id: 'erp_bi',
    label: 'Business Intelligence (BI)',
    tabId: 'erp_finance_bi',
    children: [
      {
        id: 'erp_bi_finance',
        label: 'BI Finance & Rasio Keuangan',
        tabId: 'erp_finance_bi',
        parentId: 'erp_bi',
        sensitive: true,
      },
      {
        id: 'erp_bi_sales',
        label: 'BI Sales & Pipeline Penjualan',
        tabId: 'erp_finance_bi',
        parentId: 'erp_bi',
      },
      {
        id: 'erp_bi_purchasing',
        label: 'BI Purchasing & Kinerja Supplier',
        tabId: 'erp_finance_bi',
        parentId: 'erp_bi',
      },
      {
        id: 'erp_bi_inventory',
        label: 'BI Inventory & Perputaran Stok',
        tabId: 'erp_finance_bi',
        parentId: 'erp_bi',
      },
      {
        id: 'erp_bi_production',
        label: 'BI Production (WO vs SO)',
        tabId: 'erp_finance_bi',
        parentId: 'erp_bi',
      },
    ],
  },
  {
    id: 'erp_finance',
    label: 'Finance & Accounting',
    tabId: 'erp_finance_bi',
    sensitive: true,
    children: [
      {
        id: 'erp_fin_pnl',
        label: 'Laporan Laba Rugi (Income Statement)',
        tabId: 'erp_finance_bi',
        parentId: 'erp_finance',
        sensitive: true,
      },
      {
        id: 'erp_fin_bs',
        label: 'Neraca (Balance Sheet)',
        tabId: 'erp_finance_bi',
        parentId: 'erp_finance',
        sensitive: true,
      },
      {
        id: 'erp_fin_journal',
        label: 'Buku Besar & Jurnal Umum (GL)',
        tabId: 'erp_finance_bi',
        parentId: 'erp_finance',
        sensitive: true,
      },
      {
        id: 'erp_fin_payment',
        label: 'Kas, Bank & Pembayaran',
        tabId: 'erp_finance_bi',
        parentId: 'erp_finance',
        sensitive: true,
      },
    ],
  },

  // ===================== TAB 4: ASET, SOP & MEETING =====================
  {
    id: 'assets_maint',
    label: 'Aset & Maintenance',
    tabId: 'governance',
    children: [
      {
        id: 'assets_inventory',
        label: 'Inventaris Aset Operasional',
        tabId: 'governance',
        parentId: 'assets_maint',
      },
      {
        id: 'assets_schedule',
        label: 'Jadwal Maintenance & Servis',
        tabId: 'governance',
        parentId: 'assets_maint',
        notifyHint: 'Pengingat jadwal perawatan & servis aset mendekati jatuh tempo',
      },
    ],
  },
  {
    id: 'sop_repo',
    label: 'SOP Repository',
    tabId: 'governance',
    children: [
      {
        id: 'sop_read',
        label: 'Baca Dokumen SOP Disetujui',
        tabId: 'governance',
        parentId: 'sop_repo',
      },
      {
        id: 'sop_manage',
        label: 'Kelola, Revisi & Publish SOP',
        tabId: 'governance',
        parentId: 'sop_repo',
        notifyHint: 'Notif review berkala & pengajuan persetujuan dokumen SOP',
      },
    ],
  },
  {
    id: 'meetings',
    label: 'Meetings & Notulen',
    tabId: 'governance',
    children: [
      {
        id: 'meetings_schedule',
        label: 'Jadwal & Kalender Meeting',
        tabId: 'governance',
        parentId: 'meetings',
        notifyHint: 'Pengingat jadwal rapat yang akan datang',
      },
      {
        id: 'meetings_minutes',
        label: 'Notulen & Tindak Lanjut Meeting',
        tabId: 'governance',
        parentId: 'meetings',
      },
    ],
  },
  {
    id: 'ai_studio',
    label: 'Import & AI Studio',
    tabId: 'governance',
    children: [
      {
        id: 'ai_studio_import',
        label: 'Impor Dokumen SOP (PDF / DOCX)',
        tabId: 'governance',
        parentId: 'ai_studio',
      },
      {
        id: 'ai_studio_writer',
        label: 'AI SOP Writer & Handover Interview',
        tabId: 'governance',
        parentId: 'ai_studio',
      },
    ],
  },

  // ===================== TAB 5: ADMINISTRASI & AKSES =====================
  {
    id: 'admin_console',
    label: 'Admin Console',
    tabId: 'admin',
    sensitive: true,
    children: [
      {
        id: 'admin_analytics',
        label: 'Analitik & Deteksi Celah SOP',
        tabId: 'admin',
        parentId: 'admin_console',
        sensitive: true,
      },
      {
        id: 'admin_org',
        label: 'Struktur Organisasi & Divisi',
        tabId: 'admin',
        parentId: 'admin_console',
        sensitive: true,
      },
      {
        id: 'admin_audit',
        label: 'Audit Log Sistem & Hak Akses',
        tabId: 'admin',
        parentId: 'admin_console',
        sensitive: true,
      },
    ],
  },
  {
    id: 'user_management',
    label: 'Manajemen Pengguna & Hak Akses',
    tabId: 'admin',
    sensitive: true,
    children: [
      {
        id: 'user_login',
        label: 'Form User Login (Daftar Pengguna)',
        tabId: 'admin',
        parentId: 'user_management',
        sensitive: true,
      },
      {
        id: 'user_role',
        label: 'Form User Role & Matriks Hak Akses',
        tabId: 'admin',
        parentId: 'user_management',
        sensitive: true,
      },
      {
        id: 'erp_connection',
        label: 'Pengaturan Koneksi Database ERP',
        tabId: 'admin',
        parentId: 'user_management',
        sensitive: true,
      },
    ],
  },
];

// ===================== TREE HELPERS =====================

export function flattenMenuTree(nodes: MenuTreeNode[] = MENU_REGISTRY_TREE): MenuTreeNode[] {
  const result: MenuTreeNode[] = [];
  const walk = (list: MenuTreeNode[]) => {
    for (const node of list) {
      result.push(node);
      if (node.children?.length) {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return result;
}

export const ALL_MENU_NODES: MenuTreeNode[] = flattenMenuTree(MENU_REGISTRY_TREE);
export const ALL_MENU_IDS: string[] = ALL_MENU_NODES.map((n) => n.id);
export const MENU_NODE_MAP: Record<string, MenuTreeNode> = Object.fromEntries(
  ALL_MENU_NODES.map((n) => [n.id, n]),
);

export function getMenusByTab(tabId: MenuModuleTabId): MenuTreeNode[] {
  return MENU_REGISTRY_TREE.filter((node) => node.tabId === tabId);
}

export function getDescendantIds(menuId: string): string[] {
  const node = MENU_NODE_MAP[menuId];
  if (!node?.children?.length) return [];
  const ids: string[] = [];
  const walk = (list: MenuTreeNode[]) => {
    for (const child of list) {
      ids.push(child.id);
      if (child.children?.length) walk(child.children);
    }
  };
  walk(node.children);
  return ids;
}

export function getLeafIds(node: MenuTreeNode): string[] {
  if (!node.children?.length) return [node.id];
  const leaves: string[] = [];
  for (const child of node.children) {
    leaves.push(...getLeafIds(child));
  }
  return leaves;
}

export function createEmptyPermissionFlags(): MenuPermissionFlags {
  return {
    favorite: false,
    view: false,
    insert: false,
    update: false,
    delete: false,
    data: false,
    approve: false,
    notify: false,
  };
}

export function createFullPermissionFlags(): MenuPermissionFlags {
  return {
    favorite: true,
    view: true,
    insert: true,
    update: true,
    delete: true,
    data: true,
    approve: true,
    notify: true,
  };
}

/**
 * Default permission matrix for any newly created role: ALL unchecked (minimum privilege).
 */
export function createEmptyPermissionMatrix(): RolePermissionMatrix {
  const matrix: RolePermissionMatrix = {};
  for (const id of ALL_MENU_IDS) {
    matrix[id] = createEmptyPermissionFlags();
  }
  return matrix;
}

/**
 * Full permission matrix for Administrator (ADM01).
 */
export function createFullPermissionMatrix(): RolePermissionMatrix {
  const matrix: RolePermissionMatrix = {};
  for (const id of ALL_MENU_IDS) {
    matrix[id] = createFullPermissionFlags();
  }
  return matrix;
}

/**
 * Normalize an incoming or persisted matrix so that any newly added menu in
 * MENU_REGISTRY_TREE is automatically present (false by default, or true if isSystemAdmin).
 */
export function normalizePermissionMatrix(
  raw: Partial<Record<string, Partial<MenuPermissionFlags>>> | undefined | null,
  isSystemAdmin = false,
): RolePermissionMatrix {
  const base = isSystemAdmin ? createFullPermissionMatrix() : createEmptyPermissionMatrix();
  if (!raw || typeof raw !== 'object') return base;
  for (const id of ALL_MENU_IDS) {
    const incoming = raw[id];
    if (incoming && typeof incoming === 'object') {
      base[id] = {
        favorite: Boolean(incoming.favorite),
        view: Boolean(incoming.view),
        insert: Boolean(incoming.insert),
        update: Boolean(incoming.update),
        delete: Boolean(incoming.delete),
        data: Boolean(incoming.data),
        approve: Boolean(incoming.approve),
        notify: typeof incoming.notify === 'boolean' ? incoming.notify : isSystemAdmin,
      };
    }
  }
  if (isSystemAdmin) {
    // Safeguard: ADM01 always retains full access to User Management & Audit
    const protectedAdminIds = [
      'admin_console',
      'admin_audit',
      'user_management',
      'user_login',
      'user_role',
    ];
    for (const pid of protectedAdminIds) {
      base[pid] = createFullPermissionFlags();
    }
  }
  return base;
}

/**
 * Build a preset permission matrix from compact grants.
 * Granting a parent menu automatically cascades to its descendants unless overridden.
 */
export function buildPresetPermissionMatrix(
  grants: Record<string, PermissionAction[]>,
): RolePermissionMatrix {
  const matrix = createEmptyPermissionMatrix();
  for (const [menuId, actions] of Object.entries(grants)) {
    const targets = [menuId, ...getDescendantIds(menuId)];
    for (const targetId of targets) {
      if (!matrix[targetId]) continue;
      for (const action of actions) {
        matrix[targetId][action] = true;
      }
    }
  }
  // Keep parent flags synchronized if any child has the action enabled
  syncParentFlagsFromChildren(matrix);
  return matrix;
}

export function syncParentFlagsFromChildren(matrix: RolePermissionMatrix): void {
  for (const root of MENU_REGISTRY_TREE) {
    if (!root.children?.length) continue;
    const leaves = getLeafIds(root);
    for (const { key } of PERMISSION_ACTIONS) {
      const allChecked = leaves.every((leafId) => Boolean(matrix[leafId]?.[key]));
      if (allChecked) {
        matrix[root.id][key] = true;
      }
    }
  }
}

/**
 * Check if a role permission matrix allows a given menu + action.
 * If checking a parent node, returns true if the parent itself OR any descendant has that permission.
 */
export function hasMenuPermission(
  matrix: RolePermissionMatrix | null | undefined,
  menuId: string,
  action: PermissionAction = 'view',
): boolean {
  if (!matrix) return false;
  if (matrix[menuId]?.[action]) return true;
  const descendants = getDescendantIds(menuId);
  if (descendants.length > 0) {
    return descendants.some((childId) => Boolean(matrix[childId]?.[action]));
  }
  return false;
}

/**
 * Derive strict server-side AI data scopes from a RolePermissionMatrix.
 * Server MUST use this before querying MySQL or Firestore for AI answers.
 */
export interface AllowedAiDataScopes {
  askAi: boolean;
  askAiSop: boolean;
  askAiErp: boolean;
  stock: boolean;
  purchasing: boolean;
  purchasingPayment: boolean;
  sales: boolean;
  salesReceivables: boolean;
  finance: boolean;
  erpAssets: boolean;
  biFinance: boolean;
  biSales: boolean;
  biPurchasing: boolean;
  biInventory: boolean;
  biProduction: boolean;
  assetsMaintenance: boolean;
  sop: boolean;
  meetings: boolean;
}

function canViewOrData(matrix: RolePermissionMatrix | null | undefined, menuId: string): boolean {
  return hasMenuPermission(matrix, menuId, 'view') || hasMenuPermission(matrix, menuId, 'data');
}

export function getAllowedAiDataScopes(
  matrix: RolePermissionMatrix | null | undefined,
): AllowedAiDataScopes {
  const askAi = canViewOrData(matrix, 'ask_ai');
  const askAiSop = askAi && canViewOrData(matrix, 'ask_ai_sop');
  const askAiErp = askAi && canViewOrData(matrix, 'ask_ai_erp');

  const stock = askAiErp && (canViewOrData(matrix, 'erp_stock_list') || canViewOrData(matrix, 'erp_warehouse_map'));
  const purchasingBasic =
    askAiErp &&
    (canViewOrData(matrix, 'erp_pr') ||
      canViewOrData(matrix, 'erp_po') ||
      canViewOrData(matrix, 'erp_grn') ||
      canViewOrData(matrix, 'erp_ri'));
  const purchasingPayment =
    askAiErp &&
    (canViewOrData(matrix, 'erp_vp') ||
      canViewOrData(matrix, 'erp_ap') ||
      canViewOrData(matrix, 'erp_fin_payment'));
  const purchasing = purchasingBasic || purchasingPayment;

  const salesBasic =
    askAiErp &&
    (canViewOrData(matrix, 'erp_so') ||
      canViewOrData(matrix, 'erp_do') ||
      canViewOrData(matrix, 'erp_si') ||
      canViewOrData(matrix, 'erp_sr'));
  const salesReceivables = askAiErp && canViewOrData(matrix, 'erp_ar');
  const sales = salesBasic || salesReceivables;

  const finance =
    askAiErp &&
    (canViewOrData(matrix, 'erp_fin_pnl') ||
      canViewOrData(matrix, 'erp_fin_bs') ||
      canViewOrData(matrix, 'erp_fin_journal') ||
      canViewOrData(matrix, 'erp_fin_payment'));

  const erpAssets =
    askAiErp &&
    (canViewOrData(matrix, 'erp_asset_list') || canViewOrData(matrix, 'erp_asset_depreciation'));

  return {
    askAi,
    askAiSop,
    askAiErp,
    stock,
    purchasing,
    purchasingPayment,
    sales,
    salesReceivables,
    finance,
    erpAssets,
    biFinance: askAiErp && canViewOrData(matrix, 'erp_bi_finance'),
    biSales: askAiErp && canViewOrData(matrix, 'erp_bi_sales'),
    biPurchasing: askAiErp && canViewOrData(matrix, 'erp_bi_purchasing'),
    biInventory: askAiErp && canViewOrData(matrix, 'erp_bi_inventory'),
    biProduction: askAiErp && canViewOrData(matrix, 'erp_bi_production'),
    assetsMaintenance: askAi && canViewOrData(matrix, 'assets_maint'),
    sop: askAiSop && canViewOrData(matrix, 'sop_repo'),
    meetings: askAi && canViewOrData(matrix, 'meetings'),
  };
}

export function canAccessAnyErpModule(matrix: RolePermissionMatrix | null | undefined): boolean {
  return (
    hasMenuPermission(matrix, 'erp_inventory', 'view') ||
    hasMenuPermission(matrix, 'erp_purchasing', 'view') ||
    hasMenuPermission(matrix, 'erp_sales', 'view') ||
    hasMenuPermission(matrix, 'erp_bi', 'view') ||
    hasMenuPermission(matrix, 'erp_finance', 'view') ||
    hasMenuPermission(matrix, 'erp_assets', 'view')
  );
}

export const ERP_PENDING_NOTIFY_MENU_IDS = [
  'erp_po',
  'erp_grn',
  'erp_ri',
  'erp_vp',
  'erp_do',
  'erp_si',
] as const;

export function hasAnyErpPendingNotifyPermission(
  matrix: RolePermissionMatrix | null | undefined,
): boolean {
  if (!matrix) return false;
  return ERP_PENDING_NOTIFY_MENU_IDS.some((menuId) => hasMenuPermission(matrix, menuId, 'notify'));
}
