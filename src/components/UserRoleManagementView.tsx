import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  History,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Shield,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  ALL_MENU_IDS,
  createEmptyPermissionMatrix,
  getDescendantIds,
  getLeafIds,
  hasMenuPermission,
  MENU_MODULE_TABS,
  MENU_REGISTRY_TREE,
  normalizePermissionMatrix,
  PERMISSION_ACTIONS,
  type MenuModuleTab,
  type MenuModuleTabId,
  type MenuTreeNode,
  type PermissionAction,
  type RolePermissionMatrix,
} from '../config/menuRegistry';
import {
  createRbacRoleApi,
  deleteRbacRoleApi,
  fetchRbacAuditLogsApi,
  fetchRbacRolesApi,
  updateRbacRoleApi,
  type RbacAuditLogItem,
  type RbacRoleItem,
} from '../lib/rbacClient';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import { useI18n } from '../lib/i18n';

interface TriCheckboxProps {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  ariaLabel: string;
  onChange: (next: boolean) => void;
}

const TriCheckbox: React.FC<TriCheckboxProps> = ({
  checked,
  indeterminate = false,
  disabled = false,
  ariaLabel,
  onChange,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate && !checked;
    }
  }, [indeterminate, checked]);

  return (
    <input
      ref={inputRef}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.checked)}
      className="w-4 h-4 rounded border border-[var(--border-strong)] accent-[#0D7678] dark:accent-[#2DD4BF] cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
    />
  );
};

interface UserRoleManagementViewProps {
  idToken?: string;
  permissions?: RolePermissionMatrix | null;
  onNavigateUserLogin?: () => void;
  onPermissionsMutated?: () => void | Promise<void>;
}

const PROTECTED_ADMIN_MENU_IDS = new Set([
  'admin_console',
  'admin_audit',
  'user_management',
  'user_login',
  'user_role',
]);

function formatShortTimestamp(iso?: string | null): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function countGrantedMenus(matrix: RolePermissionMatrix): number {
  let count = 0;
  for (const id of ALL_MENU_IDS) {
    const flags = matrix[id];
    if (
      flags &&
      (flags.view || flags.data || flags.insert || flags.update || flags.delete || flags.approve || flags.notify)
    ) {
      count += 1;
    }
  }
  return count;
}

export const UserRoleManagementView: React.FC<UserRoleManagementViewProps> = ({
  idToken,
  permissions,
  onNavigateUserLogin,
  onPermissionsMutated,
}) => {
  const { t } = useI18n();
  const [roles, setRoles] = useState<RbacRoleItem[]>([]);
  const [registryTabs, setRegistryTabs] = useState<MenuModuleTab[]>(MENU_MODULE_TABS);
  const [registryTree, setRegistryTree] = useState<MenuTreeNode[]>(MENU_REGISTRY_TREE);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);

  // Audit Log toggle
  const [showAudit, setShowAudit] = useState<boolean>(false);
  const [auditLogs, setAuditLogs] = useState<RbacAuditLogItem[]>([]);
  const [auditLoading, setAuditLoading] = useState<boolean>(false);

  // User Role Detail Dialog state
  const [detailOpen, setDetailOpen] = useState<boolean>(false);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [editingIsSystemAdmin, setEditingIsSystemAdmin] = useState<boolean>(false);
  const [formCode, setFormCode] = useState<string>('');
  const [formName, setFormName] = useState<string>('');
  const [formDescription, setFormDescription] = useState<string>('');
  const [formMatrix, setFormMatrix] = useState<RolePermissionMatrix>(() =>
    createEmptyPermissionMatrix()
  );
  const [activeTabId, setActiveTabId] = useState<MenuModuleTabId>('utama');
  const [expandedParents, setExpandedParents] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const node of MENU_REGISTRY_TREE) {
      initial[node.id] = true;
    }
    return initial;
  });
  const [saving, setSaving] = useState<boolean>(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  // Delete confirmation modal
  const [deleteTarget, setDeleteTarget] = useState<RbacRoleItem | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);

  const canInsert = hasMenuPermission(permissions, 'user_role', 'insert');
  const canUpdate = hasMenuPermission(permissions, 'user_role', 'update');
  const canDelete = hasMenuPermission(permissions, 'user_role', 'delete');

  const loadRoles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchRbacRolesApi(idToken);
      setRoles(res.roles || []);
      if (res.registry?.tabs?.length) setRegistryTabs(res.registry.tabs);
      if (res.registry?.tree?.length) {
        setRegistryTree(res.registry.tree);
        setExpandedParents((prev) => {
          const next = { ...prev };
          for (const node of res.registry.tree) {
            if (next[node.id] === undefined) next[node.id] = true;
          }
          return next;
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat daftar User Role.');
    } finally {
      setLoading(false);
    }
  }, [idToken]);

  const loadAuditLogs = useCallback(async () => {
    setAuditLoading(true);
    try {
      const res = await fetchRbacAuditLogsApi(100, idToken);
      setAuditLogs((res.logs || []).filter((l) => l.targetType === 'ROLE' || l.targetType === 'USER'));
    } catch {
      // ignore
    } finally {
      setAuditLoading(false);
    }
  }, [idToken]);

  useEffect(() => {
    void loadRoles();
  }, [loadRoles]);

  useEffect(() => {
    if (showAudit) {
      void loadAuditLogs();
    }
  }, [showAudit, loadAuditLogs]);

  const filteredRoles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return roles;
    return roles.filter(
      (r) =>
        r.code.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q)
    );
  }, [roles, searchQuery]);

  const selectedRole = useMemo(
    () => roles.find((r) => r.id === selectedRoleId) ?? null,
    [roles, selectedRoleId]
  );

  // Open Detail Dialog for Creating a New Role (ALL checkboxes default to UNCHECKED)
  const openCreateDialog = () => {
    setEditingRoleId(null);
    setEditingIsSystemAdmin(false);
    setFormCode('');
    setFormName('');
    setFormDescription('');
    setFormMatrix(createEmptyPermissionMatrix());
    setActiveTabId('utama');
    setDialogError(null);
    setDetailOpen(true);
  };

  // Open Detail Dialog for Viewing / Editing an Existing Role
  const openEditDialog = (role: RbacRoleItem) => {
    setSelectedRoleId(role.id);
    setEditingRoleId(role.id);
    setEditingIsSystemAdmin(Boolean(role.isSystemAdmin));
    setFormCode(role.code);
    setFormName(role.name);
    setFormDescription(role.description || '');
    setFormMatrix(normalizePermissionMatrix(role.permissions, role.isSystemAdmin));
    setActiveTabId('utama');
    setDialogError(null);
    setDetailOpen(true);
  };

  const tabNodes = useMemo(
    () => registryTree.filter((node) => node.tabId === activeTabId),
    [registryTree, activeTabId]
  );

  // Toggle a single node (if parent, cascades automatically to ALL descendants!)
  const handleToggleCell = (node: MenuTreeNode, action: PermissionAction, nextVal: boolean) => {
    if (editingIsSystemAdmin && PROTECTED_ADMIN_MENU_IDS.has(node.id) && !nextVal) {
      return;
    }
    setFormMatrix((prev) => {
      const next: RolePermissionMatrix = { ...prev };
      const descendants = getDescendantIds(node.id);
      const targetIds = [node.id, ...descendants];

      for (const tid of targetIds) {
        if (editingIsSystemAdmin && PROTECTED_ADMIN_MENU_IDS.has(tid) && !nextVal) {
          continue;
        }
        next[tid] = {
          ...(next[tid] || createEmptyPermissionMatrix()[tid]),
          [action]: nextVal,
        };
      }

      // If toggling a child, recalculate its parent's checkbox state
      if (node.parentId) {
        const parentNode = registryTree.find((p) => p.id === node.parentId);
        if (parentNode?.children?.length) {
          const leaves = getLeafIds(parentNode);
          const allChecked = leaves.every((leafId) => Boolean(next[leafId]?.[action]));
          next[parentNode.id] = {
            ...(next[parentNode.id] || createEmptyPermissionMatrix()[parentNode.id]),
            [action]: allChecked,
          };
        }
      }

      return next;
    });
  };

  // Toggle entire row (all 7 columns for a parent + children or single child)
  const handleToggleRowAll = (node: MenuTreeNode) => {
    const descendants = getDescendantIds(node.id);
    const targetIds = [node.id, ...descendants];
    const currentlyAllOn = targetIds.every((id) =>
      PERMISSION_ACTIONS.every((a) => Boolean(formMatrix[id]?.[a.key]))
    );
    const nextVal = !currentlyAllOn;

    setFormMatrix((prev) => {
      const next: RolePermissionMatrix = { ...prev };
      for (const tid of targetIds) {
        if (editingIsSystemAdmin && PROTECTED_ADMIN_MENU_IDS.has(tid) && !nextVal) {
          continue;
        }
        next[tid] = {
          favorite: nextVal,
          view: nextVal,
          insert: nextVal,
          update: nextVal,
          delete: nextVal,
          data: nextVal,
          approve: nextVal,
          notify: nextVal,
        };
      }
      if (node.parentId) {
        const parentNode = registryTree.find((p) => p.id === node.parentId);
        if (parentNode?.children?.length) {
          const leaves = getLeafIds(parentNode);
          for (const { key } of PERMISSION_ACTIONS) {
            next[parentNode.id] = {
              ...(next[parentNode.id] || createEmptyPermissionMatrix()[parentNode.id]),
              [key]: leaves.every((leafId) => Boolean(next[leafId]?.[key])),
            };
          }
        }
      }
      return next;
    });
  };

  // Bulk select / clear all checkboxes in the current tab
  const handleSetTabAll = (val: boolean) => {
    setFormMatrix((prev) => {
      const next: RolePermissionMatrix = { ...prev };
      for (const parent of tabNodes) {
        const ids = [parent.id, ...getDescendantIds(parent.id)];
        for (const id of ids) {
          if (editingIsSystemAdmin && PROTECTED_ADMIN_MENU_IDS.has(id) && !val) continue;
          next[id] = {
            favorite: val,
            view: val,
            insert: val,
            update: val,
            delete: val,
            data: val,
            approve: val,
            notify: val,
          };
        }
      }
      return next;
    });
  };

  const getTabViewCount = (tabId: MenuModuleTabId): number => {
    let count = 0;
    const roots = registryTree.filter((n) => n.tabId === tabId);
    for (const r of roots) {
      const leaves = getLeafIds(r);
      for (const leafId of leaves) {
        if (formMatrix[leafId]?.view || formMatrix[leafId]?.data) count += 1;
      }
    }
    return count;
  };

  const handleSaveRole = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setDialogError(null);
    const code = formCode.trim().toUpperCase();
    const name = formName.trim();
    if (!code) {
      setDialogError('Kode role wajib diisi.');
      return;
    }
    if (!name) {
      setDialogError('Nama role wajib diisi.');
      return;
    }

    setSaving(true);
    try {
      if (editingRoleId) {
        await updateRbacRoleApi(
          editingRoleId,
          {
            code,
            name,
            description: formDescription.trim(),
            permissions: formMatrix,
          },
          idToken
        );
        setNotice(`Hak akses untuk role ${code} (${name}) berhasil disimpan dan langsung berlaku.`);
      } else {
        const created = await createRbacRoleApi(
          {
            code,
            name,
            description: formDescription.trim(),
            permissions: formMatrix,
          },
          idToken
        );
        setSelectedRoleId(created.role.id);
        setNotice(`Role baru ${code} (${name}) berhasil dibuat.`);
      }
      setDetailOpen(false);
      await loadRoles();
      if (showAudit) void loadAuditLogs();
      await onPermissionsMutated?.();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : 'Gagal menyimpan User Role.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteRbacRoleApi(deleteTarget.id, idToken);
      setNotice(`Role ${deleteTarget.code} (${deleteTarget.name}) berhasil dihapus.`);
      if (selectedRoleId === deleteTarget.id) setSelectedRoleId(null);
      setDeleteTarget(null);
      await loadRoles();
      if (showAudit) void loadAuditLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus role.');
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  const isReadOnlyDialog = editingRoleId ? !canUpdate : !canInsert;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border)] pb-4">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-[var(--accent-text)] shrink-0" />
            <h1 className="font-display text-xl font-bold text-[var(--text)] tracking-tight">
              {t('rbac.userRoleTitle')}
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-[var(--text-muted)]">
            {t('rbac.userRoleSubtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {onNavigateUserLogin && (
            <button
              type="button"
              onClick={onNavigateUserLogin}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Users className="w-3.5 h-3.5 text-[var(--accent-text)]" />
              <span>{t('menu.userLogin')}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowAudit((v) => !v)}
            className={`inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              showAudit
                ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-text)]'
                : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-2)]'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>{t('rbac.auditLog')}</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {notice && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-700 dark:text-emerald-300">
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{notice}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-xs font-semibold hover:underline cursor-pointer shrink-0"
          >
            Tutup
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-rose-500/35 bg-[var(--danger-soft)] text-xs text-[var(--danger)]">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-xs font-semibold hover:underline cursor-pointer shrink-0"
          >
            Tutup
          </button>
        </div>
      )}

      {/* MyERP Plus-style Toolbar + Role List Table */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => void loadRoles()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>{t('rbac.show')}</span>
            </button>

            {canInsert && (
              <button
                type="button"
                onClick={openCreateDialog}
                className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t('rbac.addRole')}</span>
              </button>
            )}

            <button
              type="button"
              disabled={!selectedRole}
              onClick={() => selectedRole && openEditDialog(selectedRole)}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Pencil className="w-3.5 h-3.5" />
              <span>{t('common.edit')}</span>
            </button>

            {canDelete && (
              <button
                type="button"
                disabled={!selectedRole || selectedRole.isSystemAdmin}
                onClick={() => selectedRole && !selectedRole.isSystemAdmin && setDeleteTarget(selectedRole)}
                title={
                  selectedRole?.isSystemAdmin
                    ? 'Role Administrator (ADM01) tidak dapat dihapus'
                    : t('common.delete')
                }
                className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg border border-rose-500/30 bg-[var(--surface)] text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{t('common.delete')}</span>
              </button>
            )}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('rbac.searchRolePlaceholder')}
              className="w-full h-8 pl-8 pr-3 text-xs rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface-2)]/40 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                <th className="py-2.5 px-4 w-36">{t('rbac.colCode')}</th>
                <th className="py-2.5 px-4">{t('rbac.colName')}</th>
                <th className="py-2.5 px-4 hidden md:table-cell">{t('rbac.colDescription')}</th>
                <th className="py-2.5 px-4 text-right w-28">{t('rbac.colUsers')}</th>
                <th className="py-2.5 px-4 text-right w-32">Akses Menu</th>
                <th className="py-2.5 px-4 hidden lg:table-cell w-44">Diperbarui</th>
                <th className="py-2.5 px-4 text-right w-36">{t('rbac.colActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)] text-xs">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-[var(--text-muted)]">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />
                      Memuat daftar User Role...
                    </span>
                  </td>
                </tr>
              ) : filteredRoles.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-[var(--text-muted)]">
                    Tidak ada role yang sesuai pencarian.
                  </td>
                </tr>
              ) : (
                filteredRoles.map((role) => {
                  const isSelected = selectedRoleId === role.id;
                  const grantedCount = countGrantedMenus(role.permissions);
                  return (
                    <tr
                      key={role.id}
                      onClick={() => setSelectedRoleId(role.id)}
                      onDoubleClick={() => openEditDialog(role)}
                      className={`transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-[var(--accent-soft)]/70'
                          : 'hover:bg-[var(--surface-2)]/50'
                      }`}
                    >
                      <td className="py-3 px-4 font-mono font-semibold text-[var(--accent-text)] whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditDialog(role);
                          }}
                          className="hover:underline text-left cursor-pointer"
                        >
                          {role.code}
                        </button>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEditDialog(role);
                            }}
                            className="font-semibold text-[var(--text)] hover:text-[var(--accent-text)] hover:underline text-left cursor-pointer"
                          >
                            {role.name}
                          </button>
                          {role.isSystemAdmin && (
                            <span
                              title="Role Administrator bawaan sistem tidak dapat dihapus"
                              className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--accent-text)]"
                            >
                              <Lock className="w-3 h-3" />
                              Sistem
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-[var(--text-muted)] hidden md:table-cell max-w-md truncate">
                        {role.description || '—'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-[var(--text)]">
                        {role.activeUserCount ?? 0} / {role.userCount ?? 0}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-[var(--text)]">
                        {grantedCount} / {ALL_MENU_IDS.length}
                      </td>
                      <td className="py-3 px-4 text-[var(--text-muted)] hidden lg:table-cell tabular-nums whitespace-nowrap">
                        {formatShortTimestamp(role.updatedAt)}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEditDialog(role);
                            }}
                            className="px-2.5 py-1 text-[11px] font-semibold rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:border-[var(--accent)] hover:text-[var(--accent-text)] transition-colors cursor-pointer"
                          >
                            Detail
                          </button>
                          {canDelete && !role.isSystemAdmin && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteTarget(role);
                              }}
                              aria-label={`Hapus role ${role.name}`}
                              className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-2.5 border-t border-[var(--border)] bg-[var(--surface-2)]/30 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
          <span>
            Klik kode/nama role atau tombol <strong>Detail</strong> untuk mengatur matriks hak akses menu.
          </span>
          <span className="font-mono tabular-nums">
            Total {filteredRoles.length} role · {ALL_MENU_IDS.length} menu terdaftar otomatis
          </span>
        </div>
      </div>

      {/* Optional Audit Log Panel */}
      {showAudit && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]/50 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-[var(--accent-text)]" />
              <h2 className="font-display text-sm font-semibold text-[var(--text)]">
                Audit Log Perubahan Role &amp; User
              </h2>
            </div>
            <button
              type="button"
              onClick={() => void loadAuditLogs()}
              className="text-xs font-semibold text-[var(--accent-text)] hover:underline cursor-pointer"
            >
              Muat Ulang
            </button>
          </div>
          <div className="overflow-x-auto max-h-72 overflow-y-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 bg-[var(--surface-2)] border-b border-[var(--border)] text-[11px] text-[var(--text-muted)] uppercase">
                <tr>
                  <th className="py-2 px-4 w-40">Waktu</th>
                  <th className="py-2 px-4 w-40">Oleh</th>
                  <th className="py-2 px-4 w-40">Aksi</th>
                  <th className="py-2 px-4 w-44">Target</th>
                  <th className="py-2 px-4">Keterangan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {auditLoading ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-[var(--text-muted)]">
                      Memuat log audit...
                    </td>
                  </tr>
                ) : auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-[var(--text-muted)]">
                      Belum ada catatan perubahan.
                    </td>
                  </tr>
                ) : (
                  auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="py-2 px-4 font-mono text-[11px] text-[var(--text-muted)] tabular-nums whitespace-nowrap">
                        {formatShortTimestamp(log.createdAt)}
                      </td>
                      <td className="py-2 px-4 font-medium text-[var(--text)] whitespace-nowrap">
                        {log.actorName}{' '}
                        <span className="text-[11px] text-[var(--text-muted)]">
                          ({log.actorUsername})
                        </span>
                      </td>
                      <td className="py-2 px-4 font-mono text-[11px] text-[var(--accent-text)] whitespace-nowrap">
                        {log.action}
                      </td>
                      <td className="py-2 px-4 font-medium text-[var(--text)] whitespace-nowrap">
                        {log.targetLabel}
                      </td>
                      <td className="py-2 px-4 text-[var(--text-muted)]">{log.detail}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ===================== DIALOG: USER ROLE DETAIL (MyERP Plus Style) ===================== */}
      {detailOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 dark:bg-black/75 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-labelledby="user-role-detail-title"
        >
          <form
            onSubmit={handleSaveRole}
            className="w-full max-w-5xl max-h-[92vh] flex flex-col rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl overflow-hidden"
          >
            {/* Dialog Title Bar */}
            <div className="px-5 py-3.5 border-b border-[var(--border)] bg-[var(--surface-2)]/80 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <Shield className="w-4 h-4 text-[var(--accent-text)] shrink-0" />
                <h2
                  id="user-role-detail-title"
                  className="font-display text-sm sm:text-base font-bold text-[var(--text)] truncate"
                >
                  {t('rbac.roleDetailTitle')}
                  {editingRoleId ? ` — ${formCode}` : ''}
                </h2>
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={() => setDetailOpen(false)}
                aria-label={t('common.close')}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Dialog Top Action Strip */}
            <div className="px-5 py-2.5 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-3 flex-wrap shrink-0">
              <div className="flex items-center gap-2">
                {!isReadOnlyDialog && (
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 h-8 px-4 text-xs font-semibold rounded-lg bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] disabled:opacity-55 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {saving ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Save className="w-3.5 h-3.5" />
                    )}
                    <span>{saving ? t('common.saving') : t('common.save')}</span>
                  </button>
                )}
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setDetailOpen(false)}
                  className="inline-flex items-center h-8 px-3 text-xs font-medium rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer whitespace-nowrap"
                >
                  {t('common.cancel')}
                </button>
              </div>

              {!isReadOnlyDialog && (
                <div className="flex items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={() => handleSetTabAll(true)}
                    className="px-2.5 py-1 rounded-md border border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)] hover:text-[var(--accent-text)] transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {t('rbac.selectAllTab')}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSetTabAll(false)}
                    className="px-2.5 py-1 rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {t('rbac.clearTab')}
                  </button>
                </div>
              )}
            </div>

            {/* Role Header Fields (Code *, Name *, Description) */}
            <div className="px-5 py-3.5 border-b border-[var(--border)] bg-[var(--surface)] space-y-3 shrink-0">
              {dialogError && (
                <div className="p-2.5 rounded-lg bg-[var(--danger-soft)] border border-rose-500/35 text-xs text-[var(--danger)] flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{dialogError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-3 space-y-1">
                  <label className="block text-xs font-semibold text-[var(--text)]">
                    Kode <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    disabled={editingIsSystemAdmin || isReadOnlyDialog}
                    value={formCode}
                    onChange={(e) => setFormCode(e.target.value.toUpperCase())}
                    placeholder="cth: PRC01"
                    className="w-full h-9 px-3 text-xs font-mono uppercase rounded-lg bg-[var(--input-bg)] border border-[var(--border-strong)] text-[var(--text)] disabled:opacity-60 focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
                <div className="sm:col-span-4 space-y-1">
                  <label className="block text-xs font-semibold text-[var(--text)]">
                    Nama <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    disabled={isReadOnlyDialog}
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="cth: Purchasing Staff"
                    className="w-full h-9 px-3 text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--border-strong)] text-[var(--text)] disabled:opacity-60 focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
                <div className="sm:col-span-5 space-y-1">
                  <label className="block text-xs font-semibold text-[var(--text)]">
                    Keterangan Singkat
                  </label>
                  <input
                    type="text"
                    disabled={isReadOnlyDialog}
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    placeholder="Cakupan divisi atau batasan akses role ini"
                    className="w-full h-9 px-3 text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--border-strong)] text-[var(--text)] disabled:opacity-60 focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
              </div>
            </div>

            {/* Module Group Tabs */}
            <div className="px-5 pt-2.5 border-b border-[var(--border)] bg-[var(--surface-2)]/40 flex items-center gap-1 overflow-x-auto shrink-0">
              {registryTabs.map((tab) => {
                const isActive = activeTabId === tab.id;
                const activeCount = getTabViewCount(tab.id);
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTabId(tab.id)}
                    className={`px-3.5 py-2 text-xs font-semibold rounded-t-lg border-t border-x transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1.5 -mb-px ${
                      isActive
                        ? 'bg-[var(--surface)] border-[var(--border)] text-[var(--accent-text)]'
                        : 'bg-transparent border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    <span>{tab.label}</span>
                    <span className="font-mono text-[10px] tabular-nums opacity-75">
                      ({activeCount})
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Tree Permission Matrix Table */}
            <div className="flex-1 overflow-auto min-h-[260px]">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 z-10 bg-[var(--surface-2)] border-b border-[var(--border)] text-[11px] font-semibold text-[var(--text-muted)]">
                  <tr>
                    <th className="py-2.5 px-4 min-w-[270px]">
                      Menu (Induk &gt; Sub-Menu)
                    </th>
                    {PERMISSION_ACTIONS.map((act) => (
                      <th
                        key={act.key}
                        title={
                          act.key === 'notify'
                            ? 'Atur apakah user dengan role ini menerima notifikasi otomatis untuk menu terkait (contoh: PR baru → centang Notif di PO)'
                            : act.label
                        }
                        className={`py-2.5 px-2 text-center whitespace-nowrap w-20 ${
                          act.key === 'notify' ? 'text-[var(--accent-text)]' : ''
                        }`}
                      >
                        {act.key === 'notify' ? (
                          <span className="inline-flex items-center justify-center gap-1">
                            <Bell className="w-3 h-3" />
                            <span>{act.shortLabel}</span>
                          </span>
                        ) : (
                          act.shortLabel
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)] text-xs">
                  {tabNodes.map((parent) => {
                    const isExpanded = expandedParents[parent.id] !== false;
                    const leaves = getLeafIds(parent);
                    const hasChildren = Boolean(parent.children?.length);

                    return (
                      <React.Fragment key={parent.id}>
                        {/* Parent Menu Row */}
                        <tr className="bg-[var(--surface-2)]/35 hover:bg-[var(--surface-2)]/70 transition-colors">
                          <td className="py-2.5 px-4 font-semibold text-[var(--text)]">
                            <div className="flex items-center gap-2">
                              {hasChildren ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedParents((prev) => ({
                                      ...prev,
                                      [parent.id]: !isExpanded,
                                    }))
                                  }
                                  className="p-0.5 rounded hover:bg-[var(--surface-2)] text-[var(--text-muted)] cursor-pointer"
                                  aria-label={isExpanded ? 'Tutup sub-menu' : 'Buka sub-menu'}
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="w-3.5 h-3.5" />
                                  ) : (
                                    <ChevronRight className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              ) : (
                                <span className="w-4" />
                              )}
                              <button
                                type="button"
                                disabled={isReadOnlyDialog}
                                onClick={() => handleToggleRowAll(parent)}
                                title="Klik untuk centang / kosongkan seluruh kolom baris induk ini"
                                className="text-left hover:text-[var(--accent-text)] transition-colors cursor-pointer disabled:cursor-default"
                              >
                                {parent.label}
                              </button>
                              {parent.sensitive && (
                                <span className="text-[10px] font-semibold text-rose-600 dark:text-rose-400">
                                  Sensitif
                                </span>
                              )}
                            </div>
                          </td>
                          {PERMISSION_ACTIONS.map((act) => {
                            const checkedCount = leaves.filter((id) =>
                              Boolean(formMatrix[id]?.[act.key])
                            ).length;
                            const allChecked =
                              leaves.length > 0
                                ? checkedCount === leaves.length
                                : Boolean(formMatrix[parent.id]?.[act.key]);
                            const indeterminate =
                              leaves.length > 0 && checkedCount > 0 && checkedCount < leaves.length;
                            const locked =
                              editingIsSystemAdmin && PROTECTED_ADMIN_MENU_IDS.has(parent.id);

                            return (
                              <td key={act.key} className="py-2.5 px-2.5 text-center">
                                <TriCheckbox
                                  checked={allChecked}
                                  indeterminate={indeterminate}
                                  disabled={isReadOnlyDialog || locked}
                                  ariaLabel={`${parent.label} — ${act.label}`}
                                  onChange={(val) => handleToggleCell(parent, act.key, val)}
                                />
                              </td>
                            );
                          })}
                        </tr>

                        {/* Child Sub-Menu Rows */}
                        {hasChildren &&
                          isExpanded &&
                          parent.children!.map((child) => {
                            const locked =
                              editingIsSystemAdmin && PROTECTED_ADMIN_MENU_IDS.has(child.id);
                            return (
                              <tr
                                key={child.id}
                                className="hover:bg-[var(--surface-2)]/40 transition-colors"
                              >
                                <td className="py-2 pl-11 pr-4 text-[var(--text)]">
                                  <div className="flex flex-col gap-0.5">
                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        disabled={isReadOnlyDialog}
                                        onClick={() => handleToggleRowAll(child)}
                                        className="text-left hover:text-[var(--accent-text)] transition-colors cursor-pointer disabled:cursor-default"
                                      >
                                        {child.label}
                                      </button>
                                      {child.sensitive && (
                                        <span className="text-[10px] font-medium text-rose-600 dark:text-rose-400">
                                          Sensitif
                                        </span>
                                      )}
                                      {locked && (
                                        <Lock
                                          className="w-3 h-3 text-[var(--text-muted)]"
                                          aria-label="Dilindungi untuk Administrator"
                                        />
                                      )}
                                    </div>
                                    {child.notifyHint && (
                                      <span className="text-[10px] text-[var(--text-muted)] leading-snug">
                                        {child.notifyHint}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                {PERMISSION_ACTIONS.map((act) => (
                                  <td
                                    key={act.key}
                                    title={act.key === 'notify' && child.notifyHint ? child.notifyHint : undefined}
                                    className={`py-2 px-2 text-center ${
                                      act.key === 'notify' ? 'bg-[var(--accent)]/[0.04]' : ''
                                    }`}
                                  >
                                    <TriCheckbox
                                      checked={Boolean(formMatrix[child.id]?.[act.key])}
                                      disabled={isReadOnlyDialog || locked}
                                      ariaLabel={`${child.label} — ${act.label}`}
                                      onChange={(val) => handleToggleCell(child, act.key, val)}
                                    />
                                  </td>
                                ))}
                              </tr>
                            );
                          })}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Dialog Footer Note */}
            <div className="px-5 py-2.5 border-t border-[var(--border)] bg-[var(--surface-2)]/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-[var(--text-muted)] shrink-0">
              <span>
                Centang menu induk otomatis berlaku ke seluruh sub-menu. Centang kolom <strong>Notif</strong> untuk mengaktifkan notifikasi otomatis (mis. PR baru → Notif PO, PO → Notif GRN, SO → Notif DO).
              </span>
              {editingIsSystemAdmin && (
                <span className="font-medium text-[var(--accent-text)] whitespace-nowrap">
                  Akses inti Administrator dikunci agar sistem tidak terkunci.
                </span>
              )}
            </div>
          </form>
        </div>
      )}

      {/* Confirmation Modal for Role Deletion */}
      <DeleteConfirmModal
        open={Boolean(deleteTarget)}
        title="Hapus User Role?"
        description={
          deleteTarget ? (
            <>
              Anda yakin ingin menghapus role <strong>{deleteTarget.code} — {deleteTarget.name}</strong>?
            </>
          ) : (
            ''
          )
        }
        details={
          deleteTarget
            ? [
                { label: 'Kode Role', value: deleteTarget.code },
                { label: 'Nama Role', value: deleteTarget.name },
                { label: 'Pengguna Terkait', value: `${deleteTarget.userCount ?? 0} user` },
              ]
            : undefined
        }
        warningNote="Role yang masih digunakan oleh user aktif atau nonaktif tidak dapat dihapus sebelum user dipindahkan ke role lain."
        confirmLabel="Ya, Hapus Role"
        loading={deleting}
        onCancel={() => !deleting && setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
};
