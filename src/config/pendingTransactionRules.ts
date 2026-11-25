import type { UserRole } from '../types/sop.ts';
import { hasMenuPermission, type RolePermissionMatrix } from './menuRegistry.ts';

export type PendingModuleId = 'sales' | 'purchasing';
export type PendingUrgencyLevel = 'info' | 'normal' | 'warning' | 'overdue';

export type StandardDocStatusChip =
  | 'all'
  | 'need_approve'
  | 'approved'
  | 'in_progress'
  | 'completed';

export type GrnStatusChip = 'all' | 'belum_ri' | 'completed';
export type DocStatusChip = StandardDocStatusChip | GrnStatusChip;

export type PendingFilterKey =
  | 'pending_so_approved'
  | 'pending_so_in_progress'
  | 'pending_do_approval'
  | 'pending_do_si'
  | 'pending_pr_po'
  | 'pending_po_need_approve'
  | 'pending_po_approved'
  | 'pending_po_in_progress'
  | 'pending_grn_ri'
  | 'pending_ri_vp';

export type PendingSalesSubTab = 'so' | 'do';
export type PendingPurchasingSubTab = 'po' | 'grn_pr' | 'ap';

/**
 * Verified myerpplus Purchasing menu keys (m0_menu / m0_role_menu, rmmoduleid = 4):
 * - pr  -> mnid 3  (m4_TransaksiPR.swf)
 * - po  -> mnid 7  (m4_TransaksiPO.swf)
 * - grn -> mnid 10 (m4_TransaksiGRN.swf)
 * - pi  -> mnid 11 (m4_TransaksiRI.swf)
 * - vp  -> mnid 15 (m4_TransaksiVP.swf)
 */
export type ErpPurchasingMenuKey = 'pr' | 'po' | 'grn' | 'pi' | 'vp';

export interface ErpPurchasingMenuPermissions {
  pr: boolean;
  po: boolean;
  grn: boolean;
  pi: boolean;
  vp: boolean;
}

export interface ErpUserAccessEntry {
  erpUserId: number;
  erpUserCode: string;
  erpUserName: string;
  level: number;
  groupId: number;
  roles: string[];
  purchasingAccess: ErpPurchasingMenuPermissions;
}

export interface ErpUsersAccessResponse {
  available: boolean;
  sourceMode: 'mysql_direct' | 'bridge_v9' | 'bridge_upgrade_required' | 'unavailable';
  users: ErpUserAccessEntry[];
  fetchedAt: string;
  warning?: string;
}

export type ErpAccessEvaluationMode =
  | 'super_admin'
  | 'erp_mapped'
  | 'unmapped'
  | 'erp_user_not_found'
  | 'bridge_upgrade_required';

export interface UrgencyThresholds {
  /** 0 .. (warningDays - 1) => Normal (default: 0–2 hari) */
  warningDays: number;
  /** warningDays .. (overdueDays - 1) => Perlu Perhatian (default: 3–6 hari) */
  overdueDays: number;
}

export interface PendingRuleTextKeys {
  /** Short rule name, e.g. "PO menunggu persetujuan" */
  titleKey: string;
  /** Count-parameterized summary key (supports _one/_other pluralization) */
  summaryKey: string;
  /** CTA button label key */
  actionKey: string;
}

export interface PendingTransactionRuleConfig {
  id: string;
  module: PendingModuleId;
  targetView: 'erp-stock';
  targetErpTab: 'sales' | 'purchasing';
  targetSubTab: PendingSalesSubTab | PendingPurchasingSubTab;
  targetFilterKey: PendingFilterKey;
  /** Status filter chip that will automatically be selected when clicking this notification */
  targetStatusChip: DocStatusChip;
  sourceTable: string;
  dateColumn: string;
  /** Canonical status names covered by this rule */
  includedStatuses: string[];
  pendingConditionSummary: string;
  /** Roles allowed to receive this rule */
  allowedRoles: UserRole[];
  /**
   * Case-insensitive substring keywords matched against UserProfile.divisionName.
   * Super Admin always bypasses division filtering.
   * Users whose division matches OVERSIGHT_DIVISION_KEYWORDS also receive cross-division visibility
   * for rules permitted by their role.
   */
  divisionKeywords: string[];
  /** When true, only leadership/approver roles (Super Admin / Admin Divisi) see this rule */
  requiresApprovalAuthority?: boolean;
  /**
   * Target menu ID in User Role Detail whose `Notif` checkbox controls who receives this notification.
   * Example: PR Approved -> target `erp_po` (users whose Role has `Notif` checked on Purchase Order).
   */
  requiredNotifyMenuId: string;
  /** When true, in addition to `notify`, the role must also have `approve` checked on `requiredNotifyMenuId`. */
  requiresApproveOnMenu?: boolean;
  /** Legacy ERP m0_role_menu key (kept for backward compatibility when RBAC matrix is unavailable). */
  requiredErpMenuKey?: ErpPurchasingMenuKey;
  /** When true (e.g. PO/SO In Progress partial qty), renders as lighter informational urgency */
  informational?: boolean;
  urgencyThresholds: UrgencyThresholds;
  textKeys: PendingRuleTextKeys;
  enabled: boolean;
}

export interface PendingRuleEvaluation {
  ruleId: string;
  module: PendingModuleId;
  targetView: 'erp-stock';
  targetErpTab: 'sales' | 'purchasing';
  targetSubTab: PendingSalesSubTab | PendingPurchasingSubTab;
  targetFilterKey: PendingFilterKey;
  targetStatusChip: DocStatusChip;
  sourceTable: string;
  includedStatuses: string[];
  informational?: boolean;
  count: number;
  oldestDate: string | null;
  oldestAgeDays: number;
  urgency: PendingUrgencyLevel;
  urgencyBreakdown: {
    info: number;
    normal: number;
    warning: number;
    overdue: number;
  };
  detectionMethod: string;
  textKeys: PendingRuleTextKeys;
}

export interface StandardStatusCounts {
  all: number;
  need_approve: number;
  approved: number;
  in_progress: number;
  completed: number;
}

export interface GrnStatusCounts {
  all: number;
  belum_ri: number;
  completed: number;
}

export interface ErpDocumentStatusCounts {
  po?: StandardStatusCounts;
  grn?: GrnStatusCounts;
  pr?: StandardStatusCounts;
  so?: StandardStatusCounts;
  do?: StandardStatusCounts;
}

export interface StatusInconsistencyItem {
  code:
    | 'po_approved_has_downstream'
    | 'po_in_progress_mismatch'
    | 'po_completed_missing_downstream'
    | 'grn_completed_missing_ri'
    | 'grn_not_completed_has_ri'
    | 'so_status_relation_mismatch';
  sourceTable: string;
  count: number;
  sampleDocNos: string[];
  descriptionKey: string;
}

export interface StatusVerificationReport {
  checked: boolean;
  referenceBasis: 'relation' | 'status_column_fallback';
  qtyFormula: string;
  approvalDateColumns: Record<string, string | null>;
  inconsistencies: StatusInconsistencyItem[];
}

export interface PendingTransactionsSummaryResponse {
  available: boolean;
  sourceMode:
    | 'mysql_direct'
    | 'bridge_v9'
    | 'bridge_v8'
    | 'bridge_v7'
    | 'bridge_v6_fallback'
    | 'unavailable';
  cutoffDate: string;
  totalCount: number;
  highestUrgency: PendingUrgencyLevel | null;
  byModule: {
    sales: {
      count: number;
      oldestAgeDays: number;
      highestUrgency: PendingUrgencyLevel | null;
    };
    purchasing: {
      count: number;
      oldestAgeDays: number;
      highestUrgency: PendingUrgencyLevel | null;
    };
  };
  rules: PendingRuleEvaluation[];
  allowedRuleIds: string[];
  statusCounts?: ErpDocumentStatusCounts;
  verification?: StatusVerificationReport;
  callerScope: {
    role: UserRole;
    divisionName: string;
    erpUserId?: number;
    erpUserCode?: string;
    erpUserName?: string;
    erpRoles?: string[];
    erpAccessMode?: ErpAccessEvaluationMode;
    erpPurchasingAccess?: ErpPurchasingMenuPermissions;
  };
  fetchedAt: string;
  cached: boolean;
  warning?: string;
}

export interface PendingNavigationTarget {
  ruleId: string;
  module: PendingModuleId;
  erpTab: 'sales' | 'purchasing';
  subTab: PendingSalesSubTab | PendingPurchasingSubTab;
  filterKey: PendingFilterKey;
  statusChip: DocStatusChip;
  nonce: number;
}

/** Polling & cache tuning constants (centralized) */
export const PENDING_TX_POLL_INTERVAL_MS = 60_000;
export const PENDING_TX_SERVER_CACHE_TTL_MS = 45_000;

export const DEFAULT_URGENCY_THRESHOLDS: UrgencyThresholds = {
  warningDays: 3, // Normal: 0-2 hari, Perlu perhatian: 3-6 hari
  overdueDays: 7, // Terlambat: >= 7 hari
};

/**
 * Divisions with cross-module oversight (e.g. Direksi, Management, Finance/Accounting, Umum).
 * Non-Super Admin users in these divisions see rules allowed by their role across modules.
 * Edit this list to tighten or broaden cross-division visibility without touching UI components.
 */
export const OVERSIGHT_DIVISION_KEYWORDS: string[] = [
  'direksi',
  'director',
  'bod',
  'management',
  'manajemen',
  'executive',
  'eksekutif',
  'pimpinan',
  'operasional',
  'operation',
  'finance',
  'keuangan',
  'accounting',
  'akuntansi',
  'umum',
  'general',
  'admin',
];

const SALES_DIVISION_KEYWORDS: string[] = [
  'sales',
  'penjualan',
  'marketing',
  'pemasaran',
  'commercial',
  'komersial',
  'distribusi',
  'distribution',
  'delivery',
  'pengiriman',
  'ekspedisi',
  'customer',
];

const PURCHASING_DIVISION_KEYWORDS: string[] = [
  'purchasing',
  'pembelian',
  'procurement',
  'pengadaan',
  'supply',
  'logistik',
  'logistics',
  'gudang',
  'warehouse',
  'ppic',
  'inventory',
  'persediaan',
  'material',
];

const PURCHASING_AND_FINANCE_KEYWORDS: string[] = [
  ...PURCHASING_DIVISION_KEYWORDS,
  'finance',
  'keuangan',
  'accounting',
  'akuntansi',
];

const SALES_AND_FINANCE_KEYWORDS: string[] = [
  ...SALES_DIVISION_KEYWORDS,
  'finance',
  'keuangan',
  'accounting',
  'akuntansi',
];

/**
 * Centralized declarative catalog of pending transaction rules.
 * Adding a new rule here automatically wires role/division scoping, urgency calculation,
 * sidebar badges, bell dropdown, dashboard "Perlu Tindakan", and target status chip navigation.
 */
export const PENDING_TRANSACTION_RULES: PendingTransactionRuleConfig[] = [
  // ========================
  // MODUL PEMBELIAN (m4_*) — Strictly Approved & In Progress Handover Stages
  // Routed strictly by ERP m0_role_menu access (rmmoduleid = 4):
  //   PR (Approved/In Progress)  -> Users with PO menu access (mnid=7)
  //   PO (Approved/In Progress)  -> Users with GRN menu access (mnid=10)
  //   GRN (Approved/In Progress) -> Users with PI/RI menu access (mnid=11)
  //   PI/RI (Approved/In Progress unpaid) -> Users with VP menu access (mnid=15)
  // ========================
  {
    id: 'purchasing_pr_pending_po',
    module: 'purchasing',
    targetView: 'erp-stock',
    targetErpTab: 'purchasing',
    targetSubTab: 'grn_pr',
    targetFilterKey: 'pending_pr_po',
    targetStatusChip: 'approved',
    sourceTable: 'm4_pr',
    dateColumn: 'prtgl',
    includedStatuses: ['Approved', 'In Progress'],
    pendingConditionSummary:
      'm4_pr berstatus Approved/In Progress (prisclose=0, prstatus IN 2,3) yang belum diproses penuh ke PO (prstatuspo=0 atau prstatus=3)',
    allowedRoles: ['Super Admin', 'Admin Divisi', 'Penulis', 'Karyawan'],
    divisionKeywords: PURCHASING_DIVISION_KEYWORDS,
    requiredNotifyMenuId: 'erp_po',
    requiredErpMenuKey: 'po',
    urgencyThresholds: { ...DEFAULT_URGENCY_THRESHOLDS },
    textKeys: {
      titleKey: 'pendingTx.rules.purchasing_pr_pending_po.title',
      summaryKey: 'pendingTx.rules.purchasing_pr_pending_po.summary',
      actionKey: 'pendingTx.rules.purchasing_pr_pending_po.action',
    },
    enabled: true,
  },
  {
    id: 'purchasing_po_need_approve',
    module: 'purchasing',
    targetView: 'erp-stock',
    targetErpTab: 'purchasing',
    targetSubTab: 'po',
    targetFilterKey: 'pending_po_need_approve',
    targetStatusChip: 'need_approve',
    sourceTable: 'm4_po',
    dateColumn: 'potgl',
    includedStatuses: ['Need Approve'],
    pendingConditionSummary:
      'Dinonaktifkan sesuai kebijakan Purchasing: notifikasi serah terima hanya untuk transaksi berstatus Approved & In Progress',
    allowedRoles: ['Super Admin', 'Admin Divisi'],
    divisionKeywords: PURCHASING_DIVISION_KEYWORDS,
    requiresApprovalAuthority: true,
    requiredNotifyMenuId: 'erp_po',
    requiresApproveOnMenu: true,
    urgencyThresholds: { ...DEFAULT_URGENCY_THRESHOLDS },
    textKeys: {
      titleKey: 'pendingTx.rules.purchasing_po_need_approve.title',
      summaryKey: 'pendingTx.rules.purchasing_po_need_approve.summary',
      actionKey: 'pendingTx.rules.purchasing_po_need_approve.action',
    },
    enabled: false,
  },
  {
    id: 'purchasing_po_approved_pending',
    module: 'purchasing',
    targetView: 'erp-stock',
    targetErpTab: 'purchasing',
    targetSubTab: 'po',
    targetFilterKey: 'pending_po_approved',
    targetStatusChip: 'approved',
    sourceTable: 'm4_po',
    dateColumn: 'potgl',
    includedStatuses: ['Approved'],
    pendingConditionSummary:
      'PO sudah Approved dan belum memiliki transaksi lanjutan GRN maupun Faktur Pembelian sama sekali',
    allowedRoles: ['Super Admin', 'Admin Divisi', 'Penulis', 'Karyawan'],
    divisionKeywords: PURCHASING_DIVISION_KEYWORDS,
    requiredNotifyMenuId: 'erp_grn',
    requiredErpMenuKey: 'grn',
    urgencyThresholds: { ...DEFAULT_URGENCY_THRESHOLDS },
    textKeys: {
      titleKey: 'pendingTx.rules.purchasing_po_approved_pending.title',
      summaryKey: 'pendingTx.rules.purchasing_po_approved_pending.summary',
      actionKey: 'pendingTx.rules.purchasing_po_approved_pending.action',
    },
    enabled: true,
  },
  {
    id: 'purchasing_po_in_progress',
    module: 'purchasing',
    targetView: 'erp-stock',
    targetErpTab: 'purchasing',
    targetSubTab: 'po',
    targetFilterKey: 'pending_po_in_progress',
    targetStatusChip: 'in_progress',
    sourceTable: 'm4_po',
    dateColumn: 'potgl',
    includedStatuses: ['In Progress'],
    pendingConditionSummary:
      'PO baru diproses sebagian ke GRN dan/atau Faktur Pembelian; outstanding belum selesai',
    allowedRoles: ['Super Admin', 'Admin Divisi', 'Penulis', 'Karyawan'],
    divisionKeywords: PURCHASING_DIVISION_KEYWORDS,
    requiredNotifyMenuId: 'erp_grn',
    requiredErpMenuKey: 'grn',
    informational: true,
    urgencyThresholds: { ...DEFAULT_URGENCY_THRESHOLDS },
    textKeys: {
      titleKey: 'pendingTx.rules.purchasing_po_in_progress.title',
      summaryKey: 'pendingTx.rules.purchasing_po_in_progress.summary',
      actionKey: 'pendingTx.rules.purchasing_po_in_progress.action',
    },
    enabled: true,
  },
  {
    id: 'purchasing_grn_pending_ri',
    module: 'purchasing',
    targetView: 'erp-stock',
    targetErpTab: 'purchasing',
    targetSubTab: 'grn_pr',
    targetFilterKey: 'pending_grn_ri',
    targetStatusChip: 'belum_ri',
    sourceTable: 'm4_grn',
    dateColumn: 'grntgl',
    includedStatuses: ['Approved', 'In Progress'],
    pendingConditionSummary:
      'Penerimaan Barang berstatus Approved/In Progress yang belum memiliki dokumen Faktur Pembelian',
    allowedRoles: ['Super Admin', 'Admin Divisi', 'Penulis', 'Karyawan'],
    divisionKeywords: PURCHASING_AND_FINANCE_KEYWORDS,
    requiredNotifyMenuId: 'erp_ri',
    requiredErpMenuKey: 'pi',
    urgencyThresholds: { ...DEFAULT_URGENCY_THRESHOLDS },
    textKeys: {
      titleKey: 'pendingTx.rules.purchasing_grn_pending_ri.title',
      summaryKey: 'pendingTx.rules.purchasing_grn_pending_ri.summary',
      actionKey: 'pendingTx.rules.purchasing_grn_pending_ri.action',
    },
    enabled: true,
  },
  {
    id: 'purchasing_ri_pending_vp',
    module: 'purchasing',
    targetView: 'erp-stock',
    targetErpTab: 'purchasing',
    targetSubTab: 'ap',
    targetFilterKey: 'pending_ri_vp',
    targetStatusChip: 'approved',
    sourceTable: 'm4_ri',
    dateColumn: 'ritgl',
    includedStatuses: ['Approved', 'In Progress'],
    pendingConditionSummary:
      'Faktur Pembelian berstatus Approved/In Progress yang masih memiliki sisa hutang menunggu Pembayaran Supplier',
    allowedRoles: ['Super Admin', 'Admin Divisi', 'Penulis', 'Karyawan'],
    divisionKeywords: PURCHASING_AND_FINANCE_KEYWORDS,
    requiredNotifyMenuId: 'erp_vp',
    requiredErpMenuKey: 'vp',
    urgencyThresholds: { ...DEFAULT_URGENCY_THRESHOLDS },
    textKeys: {
      titleKey: 'pendingTx.rules.purchasing_ri_pending_vp.title',
      summaryKey: 'pendingTx.rules.purchasing_ri_pending_vp.summary',
      actionKey: 'pendingTx.rules.purchasing_ri_pending_vp.action',
    },
    enabled: true,
  },

  // ========================
  // MODUL PENJUALAN
  // ========================
  {
    id: 'sales_so_approved_pending',
    module: 'sales',
    targetView: 'erp-stock',
    targetErpTab: 'sales',
    targetSubTab: 'so',
    targetFilterKey: 'pending_so_approved',
    targetStatusChip: 'approved',
    sourceTable: 'm5_so',
    dateColumn: 'sotgl',
    includedStatuses: ['Approved'],
    pendingConditionSummary:
      'Sales Order sudah Approved dan belum memiliki Delivery Order sama sekali',
    allowedRoles: ['Super Admin', 'Admin Divisi', 'Penulis', 'Karyawan'],
    divisionKeywords: SALES_DIVISION_KEYWORDS,
    requiredNotifyMenuId: 'erp_do',
    urgencyThresholds: { ...DEFAULT_URGENCY_THRESHOLDS },
    textKeys: {
      titleKey: 'pendingTx.rules.sales_so_approved_pending.title',
      summaryKey: 'pendingTx.rules.sales_so_approved_pending.summary',
      actionKey: 'pendingTx.rules.sales_so_approved_pending.action',
    },
    enabled: true,
  },
  {
    id: 'sales_so_in_progress',
    module: 'sales',
    targetView: 'erp-stock',
    targetErpTab: 'sales',
    targetSubTab: 'so',
    targetFilterKey: 'pending_so_in_progress',
    targetStatusChip: 'in_progress',
    sourceTable: 'm5_so',
    dateColumn: 'sotgl',
    includedStatuses: ['In Progress'],
    pendingConditionSummary:
      'Sales Order baru dibuat Delivery Order sebagian; tampil sebagai informasi',
    allowedRoles: ['Super Admin', 'Admin Divisi', 'Penulis', 'Karyawan'],
    divisionKeywords: SALES_DIVISION_KEYWORDS,
    requiredNotifyMenuId: 'erp_do',
    informational: true,
    urgencyThresholds: { ...DEFAULT_URGENCY_THRESHOLDS },
    textKeys: {
      titleKey: 'pendingTx.rules.sales_so_in_progress.title',
      summaryKey: 'pendingTx.rules.sales_so_in_progress.summary',
      actionKey: 'pendingTx.rules.sales_so_in_progress.action',
    },
    enabled: true,
  },
  {
    id: 'sales_do_pending_approval',
    module: 'sales',
    targetView: 'erp-stock',
    targetErpTab: 'sales',
    targetSubTab: 'do',
    targetFilterKey: 'pending_do_approval',
    targetStatusChip: 'need_approve',
    sourceTable: 'm5_do',
    dateColumn: 'dotgl',
    includedStatuses: ['Need Approve'],
    pendingConditionSummary:
      'Delivery Order baru/menunggu persetujuan',
    allowedRoles: ['Super Admin', 'Admin Divisi'],
    divisionKeywords: SALES_DIVISION_KEYWORDS,
    requiresApprovalAuthority: true,
    requiredNotifyMenuId: 'erp_do',
    requiresApproveOnMenu: true,
    urgencyThresholds: { ...DEFAULT_URGENCY_THRESHOLDS },
    textKeys: {
      titleKey: 'pendingTx.rules.sales_do_pending_approval.title',
      summaryKey: 'pendingTx.rules.sales_do_pending_approval.summary',
      actionKey: 'pendingTx.rules.sales_do_pending_approval.action',
    },
    enabled: true,
  },
  {
    id: 'sales_do_pending_si',
    module: 'sales',
    targetView: 'erp-stock',
    targetErpTab: 'sales',
    targetSubTab: 'do',
    targetFilterKey: 'pending_do_si',
    targetStatusChip: 'approved',
    sourceTable: 'm5_do',
    dateColumn: 'dotgl',
    includedStatuses: ['Approved', 'In Progress'],
    pendingConditionSummary:
      'Delivery Order sudah Approved/In Progress yang belum dijadikan Faktur Penjualan',
    allowedRoles: ['Super Admin', 'Admin Divisi', 'Penulis', 'Karyawan'],
    divisionKeywords: SALES_AND_FINANCE_KEYWORDS,
    requiredNotifyMenuId: 'erp_si',
    urgencyThresholds: { ...DEFAULT_URGENCY_THRESHOLDS },
    textKeys: {
      titleKey: 'pendingTx.rules.sales_do_pending_si.title',
      summaryKey: 'pendingTx.rules.sales_do_pending_si.summary',
      actionKey: 'pendingTx.rules.sales_do_pending_si.action',
    },
    enabled: true,
  },
];

export const URGENCY_SORT_WEIGHT: Record<PendingUrgencyLevel, number> = {
  overdue: 4,
  warning: 3,
  normal: 2,
  info: 1,
};

export function computeUrgencyLevel(
  ageDays: number,
  thresholds: UrgencyThresholds = DEFAULT_URGENCY_THRESHOLDS,
  informational = false
): PendingUrgencyLevel {
  if (informational) return 'info';
  const safeDays = Math.max(0, Number.isFinite(ageDays) ? ageDays : 0);
  if (safeDays >= thresholds.overdueDays) return 'overdue';
  if (safeDays >= thresholds.warningDays) return 'warning';
  return 'normal';
}

export function getHigherUrgency(
  a: PendingUrgencyLevel | null,
  b: PendingUrgencyLevel | null
): PendingUrgencyLevel | null {
  if (!a) return b;
  if (!b) return a;
  return URGENCY_SORT_WEIGHT[a] >= URGENCY_SORT_WEIGHT[b] ? a : b;
}

export function formatBadgeCount(count: number): string {
  const n = Math.max(0, Math.floor(count || 0));
  return n > 99 ? '99+' : String(n);
}

/**
 * Maps raw m0_status codes from myerpplus to canonical UI filter categories.
 * DB values are never mutated; only view grouping/display translation uses this helper.
 */
export function classifyStandardStatusCode(
  statusCode: number,
  isClosed = false
): Exclude<StandardDocStatusChip, 'all'> | 'excluded' {
  if (statusCode === 6 || statusCode === 12) return 'excluded';
  if (isClosed || statusCode === 4 || statusCode === 7) return 'completed';
  if (statusCode === 3) return 'in_progress';
  if (statusCode === 2) return 'approved';
  return 'need_approve'; // 0=Draft, 1=Need Approve, 5=Revision, 8..11=Approve 1..4
}

export function classifyGrnStatusCode(
  statusCode: number,
  isClosed = false
): Exclude<GrnStatusChip, 'all'> | 'excluded' {
  if (statusCode === 6 || statusCode === 12) return 'excluded';
  if (isClosed || statusCode === 4 || statusCode === 7) return 'completed';
  return 'belum_ri';
}

/**
 * Pure server- & client-shared access policy evaluator.
 * Server ALWAYS runs this using the authoritative Firestore user profile & ERP m0_role_menu access so
 * restricted modules/rules are never queried or returned in API payloads.
 *
 * Policy:
 * - Super Admin: unchanged full visibility across all enabled rules.
 * - Non-Super Admin on Purchasing rules with requiredErpMenuKey:
 *   STRICTLY requires mapped ERP user access (erpPurchasingAccess[requiredErpMenuKey] === true).
 *   Unmapped users or users without that specific ERP menu access receive ZERO notifications for that stage.
 * - Non-Super Admin on Sales rules: retains role + division keyword policy.
 */
export function filterPendingRulesForUser(
  rules: PendingTransactionRuleConfig[],
  caller: {
    role: UserRole;
    divisionName?: string;
    erpPurchasingAccess?: ErpPurchasingMenuPermissions | null;
    rbacPermissions?: RolePermissionMatrix | null;
    isSystemAdmin?: boolean;
  }
): PendingTransactionRuleConfig[] {
  const enabledRules = rules.filter((r) => r.enabled);

  // Authoritative unified RBAC User Role `Notif` routing (Single Source of Truth)
  if (caller.rbacPermissions) {
    return enabledRules.filter((rule) => {
      const hasNotify = hasMenuPermission(
        caller.rbacPermissions,
        rule.requiredNotifyMenuId,
        'notify'
      );
      if (!hasNotify) return false;
      if (rule.requiresApproveOnMenu) {
        return hasMenuPermission(caller.rbacPermissions, rule.requiredNotifyMenuId, 'approve');
      }
      return true;
    });
  }

  // Legacy fallback if called without RBAC matrix
  if (caller.role === 'Super Admin' || caller.isSystemAdmin) {
    return enabledRules;
  }

  const divLower = String(caller.divisionName || '').trim().toLowerCase();
  const isOversightDivision =
    divLower.length === 0 ||
    OVERSIGHT_DIVISION_KEYWORDS.some((kw) => divLower.includes(kw));

  return enabledRules.filter((rule) => {
    if (!rule.allowedRoles.includes(caller.role)) {
      return false;
    }
    if (rule.module === 'purchasing' && rule.requiredErpMenuKey) {
      if (!caller.erpPurchasingAccess) {
        return false;
      }
      return Boolean(caller.erpPurchasingAccess[rule.requiredErpMenuKey]);
    }
    if (isOversightDivision) {
      return true;
    }
    return rule.divisionKeywords.some((kw) => divLower.includes(kw));
  });
}

export function sortPendingEvaluations(
  items: PendingRuleEvaluation[]
): PendingRuleEvaluation[] {
  return [...items].sort((a, b) => {
    const uDiff = URGENCY_SORT_WEIGHT[b.urgency] - URGENCY_SORT_WEIGHT[a.urgency];
    if (uDiff !== 0) return uDiff;
    if (b.oldestAgeDays !== a.oldestAgeDays) return b.oldestAgeDays - a.oldestAgeDays;
    return b.count - a.count;
  });
}
