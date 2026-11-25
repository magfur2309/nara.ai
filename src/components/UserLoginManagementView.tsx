import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  History,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  UserCheck,
  UserX,
  Users,
  X,
} from 'lucide-react';
import { hasMenuPermission, type RolePermissionMatrix } from '../config/menuRegistry';
import {
  createRbacUserApi,
  deleteRbacUserApi,
  fetchRbacAuditLogsApi,
  fetchRbacRolesApi,
  fetchRbacUsersApi,
  resetRbacUserPasswordApi,
  toggleRbacUserStatusApi,
  updateRbacUserApi,
  type RbacAuditLogItem,
  type RbacRoleItem,
  type RbacUserItem,
} from '../lib/rbacClient';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import { useI18n } from '../lib/i18n';
import type { Division } from '../types/sop';

interface UserLoginManagementViewProps {
  idToken?: string;
  currentUserId?: string;
  permissions?: RolePermissionMatrix | null;
  divisions?: Division[];
  onNavigateUserRole?: () => void;
  onUsersMutated?: () => void | Promise<void>;
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return 'Belum pernah login';
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

export const UserLoginManagementView: React.FC<UserLoginManagementViewProps> = ({
  idToken,
  currentUserId,
  permissions,
  divisions = [],
  onNavigateUserRole,
  onUsersMutated,
}) => {
  const { t } = useI18n();
  const [users, setUsers] = useState<RbacUserItem[]>([]);
  const [roles, setRoles] = useState<RbacRoleItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

  // Audit Log toggle
  const [showAudit, setShowAudit] = useState<boolean>(false);
  const [auditLogs, setAuditLogs] = useState<RbacAuditLogItem[]>([]);
  const [auditLoading, setAuditLoading] = useState<boolean>(false);

  // Add / Edit User modal
  const [userModalOpen, setUserModalOpen] = useState<boolean>(false);
  const [editingUser, setEditingUser] = useState<RbacUserItem | null>(null);
  const [formUsername, setFormUsername] = useState<string>('');
  const [formFullName, setFormFullName] = useState<string>('');
  const [formEmail, setFormEmail] = useState<string>('');
  const [formRoleId, setFormRoleId] = useState<string>('');
  const [formDivisionId, setFormDivisionId] = useState<string>('');
  const [formPassword, setFormPassword] = useState<string>('');
  const [formShowPw, setFormShowPw] = useState<boolean>(false);
  const [formIsActive, setFormIsActive] = useState<boolean>(true);
  const [savingUser, setSavingUser] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Reset Password modal
  const [resetTarget, setResetTarget] = useState<RbacUserItem | null>(null);
  const [resetPassword, setResetPassword] = useState<string>('');
  const [resetConfirm, setResetConfirm] = useState<string>('');
  const [resetShowPw, setResetShowPw] = useState<boolean>(false);
  const [resetSaving, setResetSaving] = useState<boolean>(false);
  const [resetError, setResetError] = useState<string | null>(null);

  // Delete Confirm Modal
  const [deleteTarget, setDeleteTarget] = useState<RbacUserItem | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);

  // Toggle status busy state
  const [togglingUserId, setTogglingUserId] = useState<string | null>(null);

  const canInsert = hasMenuPermission(permissions, 'user_login', 'insert');
  const canUpdate = hasMenuPermission(permissions, 'user_login', 'update');
  const canDelete = hasMenuPermission(permissions, 'user_login', 'delete');
  const canViewRoles = hasMenuPermission(permissions, 'user_role', 'view');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersRes, rolesRes] = await Promise.all([
        fetchRbacUsersApi(idToken),
        fetchRbacRolesApi(idToken),
      ]);
      setUsers(usersRes.users || []);
      setRoles(rolesRes.roles || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat daftar User Login.');
    } finally {
      setLoading(false);
    }
  }, [idToken]);

  const loadAuditLogs = useCallback(async () => {
    setAuditLoading(true);
    try {
      const res = await fetchRbacAuditLogsApi(100, idToken);
      setAuditLogs((res.logs || []).filter((l) => l.targetType === 'USER' || l.targetType === 'AUTH'));
    } catch {
      // ignore
    } finally {
      setAuditLoading(false);
    }
  }, [idToken]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (showAudit) void loadAuditLogs();
  }, [showAudit, loadAuditLogs]);

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== 'ALL' && u.roleId !== roleFilter) return false;
      if (statusFilter === 'ACTIVE' && !u.isActive) return false;
      if (statusFilter === 'INACTIVE' && u.isActive) return false;
      if (!q) return true;
      return (
        u.username.toLowerCase().includes(q) ||
        u.fullName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.roleCode.toLowerCase().includes(q) ||
        u.roleName.toLowerCase().includes(q)
      );
    });
  }, [users, searchQuery, roleFilter, statusFilter]);

  const activeCount = useMemo(() => users.filter((u) => u.isActive).length, [users]);
  const adminCount = useMemo(
    () => users.filter((u) => u.isActive && u.isSystemAdmin).length,
    [users]
  );

  const openCreateModal = () => {
    setEditingUser(null);
    setFormUsername('');
    setFormFullName('');
    setFormEmail('');
    const defaultStaff = roles.find((r) => r.code === 'STAFF') || roles[0];
    setFormRoleId(defaultStaff?.id || '');
    setFormDivisionId('');
    setFormPassword('');
    setFormShowPw(false);
    setFormIsActive(true);
    setModalError(null);
    setUserModalOpen(true);
  };

  const openEditModal = (u: RbacUserItem) => {
    setEditingUser(u);
    setFormUsername(u.username);
    setFormFullName(u.fullName);
    setFormEmail(u.email);
    setFormRoleId(u.roleId);
    setFormDivisionId(u.divisionId || '');
    setFormPassword('');
    setFormShowPw(false);
    setFormIsActive(u.isActive);
    setModalError(null);
    setUserModalOpen(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingUser) return;
    setModalError(null);

    if (!formUsername.trim() || !formFullName.trim() || !formEmail.trim() || !formRoleId) {
      setModalError('Username, Nama Lengkap, Email, dan Role wajib diisi.');
      return;
    }
    if (!editingUser && formPassword.length < 6) {
      setModalError('Kata sandi awal minimal 6 karakter.');
      return;
    }

    const selectedDiv = divisions.find((d) => d.id === formDivisionId);

    setSavingUser(true);
    try {
      if (editingUser) {
        await updateRbacUserApi(
          editingUser.id,
          {
            username: formUsername.trim().toLowerCase(),
            fullName: formFullName.trim(),
            email: formEmail.trim().toLowerCase(),
            roleId: formRoleId,
            divisionId: selectedDiv?.id || '',
            divisionName: selectedDiv?.name || '',
            isActive: formIsActive,
          },
          idToken
        );
        setNotice(`Data user "${formUsername.trim().toLowerCase()}" berhasil diperbarui.`);
      } else {
        await createRbacUserApi(
          {
            username: formUsername.trim().toLowerCase(),
            fullName: formFullName.trim(),
            email: formEmail.trim().toLowerCase(),
            roleId: formRoleId,
            divisionId: selectedDiv?.id || undefined,
            divisionName: selectedDiv?.name || undefined,
            password: formPassword,
            isActive: formIsActive,
          },
          idToken
        );
        setNotice(
          `User baru "${formUsername.trim().toLowerCase()}" berhasil dibuat (password tersimpan sebagai hash aman).`
        );
      }
      setUserModalOpen(false);
      await loadData();
      if (showAudit) void loadAuditLogs();
      await onUsersMutated?.();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Gagal menyimpan data pengguna.');
    } finally {
      setSavingUser(false);
    }
  };

  const handleToggleStatus = async (u: RbacUserItem) => {
    if (togglingUserId) return;
    setTogglingUserId(u.id);
    setError(null);
    try {
      const nextActive = !u.isActive;
      await toggleRbacUserStatusApi(u.id, nextActive, idToken);
      setNotice(
        `Status akun "${u.username}" diubah menjadi ${nextActive ? 'Aktif' : 'Nonaktif'}.`
      );
      await loadData();
      if (showAudit) void loadAuditLogs();
      await onUsersMutated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengubah status user.');
    } finally {
      setTogglingUserId(null);
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget || resetSaving) return;
    setResetError(null);
    if (resetPassword.length < 6) {
      setResetError('Kata sandi baru minimal 6 karakter.');
      return;
    }
    if (resetPassword !== resetConfirm) {
      setResetError('Konfirmasi kata sandi tidak cocok.');
      return;
    }
    setResetSaving(true);
    try {
      await resetRbacUserPasswordApi(resetTarget.id, resetPassword, idToken);
      setNotice(`Kata sandi akun "${resetTarget.username}" berhasil direset.`);
      setResetTarget(null);
      setResetPassword('');
      setResetConfirm('');
      if (showAudit) void loadAuditLogs();
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Gagal mereset kata sandi.');
    } finally {
      setResetSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteRbacUserApi(deleteTarget.id, idToken);
      setNotice(`Akun "${deleteTarget.username}" (${deleteTarget.fullName}) berhasil dihapus.`);
      setDeleteTarget(null);
      await loadData();
      if (showAudit) void loadAuditLogs();
      await onUsersMutated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus user.');
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border)] pb-4">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-[var(--accent-text)] shrink-0" />
            <h1 className="font-display text-xl font-bold text-[var(--text)] tracking-tight">
              {t('rbac.userLoginTitle')}
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-[var(--text-muted)]">
            {t('rbac.userLoginSubtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {onNavigateUserRole && canViewRoles && (
            <button
              type="button"
              onClick={onNavigateUserRole}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Shield className="w-3.5 h-3.5 text-[var(--accent-text)]" />
              <span>{t('menu.userRole')}</span>
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
          {canInsert && (
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold rounded-lg bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t('rbac.addUser')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Inline KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <p className="text-[11px] font-medium text-[var(--text-muted)]">Total User Terdaftar</p>
          <p className="mt-1 font-display text-xl font-bold text-[var(--text)] tabular-nums">
            {users.length}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <p className="text-[11px] font-medium text-[var(--text-muted)]">Akun Aktif</p>
          <p className="mt-1 font-display text-xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
            {activeCount}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <p className="text-[11px] font-medium text-[var(--text-muted)]">Akun Nonaktif</p>
          <p className="mt-1 font-display text-xl font-bold text-[var(--text-muted)] tabular-nums">
            {users.length - activeCount}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <p className="text-[11px] font-medium text-[var(--text-muted)]">Administrator Aktif</p>
          <p className="mt-1 font-display text-xl font-bold text-[var(--accent-text)] tabular-nums">
            {adminCount}
          </p>
        </div>
      </div>

      {/* Feedback Banners */}
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

      {/* Filter Bar + User Login Table */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]/60 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap flex-1">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('rbac.searchUserPlaceholder')}
                className="w-full h-8 pl-8 pr-3 text-xs rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>

            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              aria-label={t('rbac.colRole')}
              className="h-8 px-2.5 text-xs rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
            >
              <option value="ALL">{t('rbac.allRoles')}</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} — {r.name}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as 'ALL' | 'ACTIVE' | 'INACTIVE')
              }
              aria-label={t('rbac.colStatus')}
              className="h-8 px-2.5 text-xs rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
            >
              <option value="ALL">{t('rbac.allStatuses')}</option>
              <option value="ACTIVE">{t('common.active')}</option>
              <option value="INACTIVE">{t('common.inactive')}</option>
            </select>
          </div>

          <button
            type="button"
            onClick={() => void loadData()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{t('rbac.refresh')}</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface-2)]/40 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                <th className="py-2.5 px-4">{t('rbac.colUsername')}</th>
                <th className="py-2.5 px-4">{t('rbac.colFullName')}</th>
                <th className="py-2.5 px-4">{t('rbac.colEmail')}</th>
                <th className="py-2.5 px-4">{t('rbac.colRole')}</th>
                <th className="py-2.5 px-4">{t('rbac.colStatus')}</th>
                <th className="py-2.5 px-4">{t('rbac.colLastLogin')}</th>
                <th className="py-2.5 px-4 text-right">{t('rbac.colActions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)] text-xs">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-[var(--text-muted)]">
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />
                      Memuat daftar pengguna...
                    </span>
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-[var(--text-muted)]">
                    Tidak ada pengguna yang cocok dengan filter.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const isSelf = currentUserId === u.id;
                  return (
                    <tr
                      key={u.id}
                      className="hover:bg-[var(--surface-2)]/45 transition-colors"
                    >
                      <td className="py-3 px-4 font-mono font-semibold text-[var(--text)] whitespace-nowrap">
                        {u.username}
                        {isSelf && (
                          <span className="ml-1.5 font-sans text-[10px] font-semibold text-[var(--accent-text)]">
                            (Anda)
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-medium text-[var(--text)] whitespace-nowrap">
                        {u.fullName}
                      </td>
                      <td className="py-3 px-4 text-[var(--text-muted)] whitespace-nowrap">
                        {u.email}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="font-mono font-semibold text-[var(--accent-text)]">
                          {u.roleCode}
                        </span>
                        <span className="text-[var(--text-muted)]"> · {u.roleName}</span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 font-semibold ${
                            u.isActive
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              u.isActive ? 'bg-emerald-500' : 'bg-rose-500'
                            }`}
                          />
                          {u.isActive ? t('common.active') : t('common.inactive')}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-[var(--text-muted)] tabular-nums whitespace-nowrap">
                        {formatDateTime(u.lastLoginAt)}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          {canUpdate && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditModal(u)}
                                title="Edit User & Role"
                                className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--accent-text)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setResetTarget(u);
                                  setResetPassword('');
                                  setResetConfirm('');
                                  setResetShowPw(false);
                                  setResetError(null);
                                }}
                                title="Reset Password"
                                className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-amber-600 dark:hover:text-amber-400 hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
                              >
                                <KeyRound className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={togglingUserId === u.id}
                                onClick={() => void handleToggleStatus(u)}
                                title={u.isActive ? 'Nonaktifkan User' : 'Aktifkan User'}
                                className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] disabled:opacity-40 transition-colors cursor-pointer"
                              >
                                {u.isActive ? (
                                  <UserX className="w-3.5 h-3.5" />
                                ) : (
                                  <UserCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                                )}
                              </button>
                            </>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              disabled={isSelf}
                              onClick={() => !isSelf && setDeleteTarget(u)}
                              title={isSelf ? 'Tidak dapat menghapus akun sendiri' : 'Hapus User'}
                              className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
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
            Kata sandi seluruh pengguna disimpan dalam bentuk hash kriptografi di server (bukan teks biasa).
          </span>
          <span className="font-mono tabular-nums">
            Menampilkan {filteredUsers.length} dari {users.length} user
          </span>
        </div>
      </div>

      {/* Audit Log Panel */}
      {showAudit && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)]/50 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-[var(--accent-text)]" />
              <h2 className="font-display text-sm font-semibold text-[var(--text)]">
                Audit Log Aktivitas User Login
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
                  <th className="py-2 px-4 w-44">Oleh</th>
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
                      Belum ada catatan aktivitas.
                    </td>
                  </tr>
                ) : (
                  auditLogs.map((log) => (
                    <tr key={log.id}>
                      <td className="py-2 px-4 font-mono text-[11px] text-[var(--text-muted)] tabular-nums whitespace-nowrap">
                        {formatDateTime(log.createdAt)}
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

      {/* ===================== MODAL: TAMBAH / EDIT USER LOGIN ===================== */}
      {userModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 dark:bg-black/75 backdrop-blur-[1px] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="user-login-modal-title"
        >
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[var(--border)] bg-[var(--surface-2)]/70 flex items-center justify-between gap-2">
              <h2
                id="user-login-modal-title"
                className="font-display text-sm font-bold text-[var(--text)]"
              >
                {editingUser ? `Edit User — ${editingUser.username}` : 'Tambah User Login Baru'}
              </h2>
              <button
                type="button"
                disabled={savingUser}
                onClick={() => setUserModalOpen(false)}
                className="p-1 rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-2)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="p-5 space-y-3.5">
              {modalError && (
                <div className="p-2.5 rounded-lg bg-[var(--danger-soft)] border border-rose-500/35 text-xs text-[var(--danger)] flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{modalError}</span>
                </div>
              )}

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-[var(--text)]">
                  Username (Unik) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formUsername}
                  onChange={(e) => setFormUsername(e.target.value.toLowerCase().replace(/\s+/g, ''))}
                  placeholder="cth: dewi.finance"
                  className="w-full h-9 px-3 text-xs font-mono rounded-lg bg-[var(--input-bg)] border border-[var(--border-strong)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-[var(--text)]">
                  Nama Lengkap <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formFullName}
                  onChange={(e) => setFormFullName(e.target.value)}
                  placeholder="cth: Dewi Kartika"
                  className="w-full h-9 px-3 text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--border-strong)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-[var(--text)]">
                  Email <span className="text-rose-500">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="dewi.kartika@company.co.id"
                  className="w-full h-9 px-3 text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--border-strong)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-[var(--text)]">
                  User Role (Hak Akses) <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  value={formRoleId}
                  onChange={(e) => setFormRoleId(e.target.value)}
                  className="w-full h-9 px-3 text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--border-strong)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                >
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code} — {r.name}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-[var(--text-muted)]">
                  Hak akses menu, data AI, dan notifikasi transaksi otomatis mengikuti matriks pada role yang dipilih.
                </p>
              </div>

              {divisions.length > 0 && (
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-[var(--text)]">
                    Divisi (Opsional)
                  </label>
                  <select
                    value={formDivisionId}
                    onChange={(e) => setFormDivisionId(e.target.value)}
                    className="w-full h-9 px-3 text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--border-strong)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                  >
                    <option value="">— Ikuti Nama Role —</option>
                    {divisions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.code ? `${d.code} — ` : ''}{d.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {!editingUser && (
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-[var(--text)]">
                    Kata Sandi Awal (min. 6 karakter) <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={formShowPw ? 'text' : 'password'}
                      required
                      minLength={6}
                      value={formPassword}
                      onChange={(e) => setFormPassword(e.target.value)}
                      placeholder="Masukkan kata sandi"
                      className="w-full h-9 pl-3 pr-9 text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--border-strong)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                    />
                    <button
                      type="button"
                      onClick={() => setFormShowPw((v) => !v)}
                      aria-label={formShowPw ? 'Sembunyikan kata sandi' : 'Lihat kata sandi'}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
                    >
                      {formShowPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              )}

              <label className="flex items-center gap-2 pt-1 text-xs text-[var(--text)] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={formIsActive}
                  onChange={(e) => setFormIsActive(e.target.checked)}
                  className="w-4 h-4 rounded border border-[var(--border-strong)] accent-[#0D7678] dark:accent-[#2DD4BF]"
                />
                <span>Status Akun Aktif (diizinkan login)</span>
              </label>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
                <button
                  type="button"
                  disabled={savingUser}
                  onClick={() => setUserModalOpen(false)}
                  className="h-9 px-3.5 text-xs font-medium rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-2)] cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingUser}
                  className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold rounded-lg bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] disabled:opacity-55 cursor-pointer"
                >
                  {savingUser && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{editingUser ? 'Simpan Perubahan' : 'Buat User'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================== MODAL: RESET PASSWORD ===================== */}
      {resetTarget && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 dark:bg-black/75 backdrop-blur-[1px] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-pw-modal-title"
        >
          <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[var(--border)] bg-[var(--surface-2)]/70 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-[var(--accent-text)]" />
                <h2
                  id="reset-pw-modal-title"
                  className="font-display text-sm font-bold text-[var(--text)]"
                >
                  Reset Kata Sandi
                </h2>
              </div>
              <button
                type="button"
                disabled={resetSaving}
                onClick={() => setResetTarget(null)}
                className="p-1 rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-2)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleResetPasswordSubmit} className="p-5 space-y-3.5">
              <p className="text-xs text-[var(--text-muted)]">
                Atur ulang kata sandi untuk akun{' '}
                <strong className="text-[var(--text)]">{resetTarget.username}</strong> ({resetTarget.fullName}).
              </p>

              {resetError && (
                <div className="p-2.5 rounded-lg bg-[var(--danger-soft)] border border-rose-500/35 text-xs text-[var(--danger)]">
                  {resetError}
                </div>
              )}

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-[var(--text)]">
                  Kata Sandi Baru (min. 6 karakter)
                </label>
                <div className="relative">
                  <input
                    type={resetShowPw ? 'text' : 'password'}
                    required
                    minLength={6}
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    className="w-full h-9 pl-3 pr-9 text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--border-strong)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                  />
                  <button
                    type="button"
                    onClick={() => setResetShowPw((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[var(--text-muted)] cursor-pointer"
                  >
                    {resetShowPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-[var(--text)]">
                  Ulangi Kata Sandi Baru
                </label>
                <input
                  type={resetShowPw ? 'text' : 'password'}
                  required
                  minLength={6}
                  value={resetConfirm}
                  onChange={(e) => setResetConfirm(e.target.value)}
                  className="w-full h-9 px-3 text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--border-strong)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
                <button
                  type="button"
                  disabled={resetSaving}
                  onClick={() => setResetTarget(null)}
                  className="h-9 px-3.5 text-xs font-medium rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-2)] cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={resetSaving}
                  className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold rounded-lg bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] disabled:opacity-55 cursor-pointer"
                >
                  {resetSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Simpan Password</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      <DeleteConfirmModal
        open={Boolean(deleteTarget)}
        title="Hapus User Login?"
        description={
          deleteTarget ? (
            <>
              Anda yakin ingin menghapus pengguna <strong>{deleteTarget.fullName}</strong> (
              <span className="font-mono">{deleteTarget.username}</span>)?
            </>
          ) : (
            ''
          )
        }
        details={
          deleteTarget
            ? [
                { label: 'Username', value: deleteTarget.username },
                { label: 'Nama Lengkap', value: deleteTarget.fullName },
                { label: 'Role', value: `${deleteTarget.roleCode} — ${deleteTarget.roleName}` },
                { label: 'Status', value: deleteTarget.isActive ? 'Aktif' : 'Nonaktif' },
              ]
            : undefined
        }
        warningNote="Jika hanya ingin mencabut akses sementara tanpa menghapus riwayat akun, gunakan tombol Nonaktifkan."
        confirmLabel="Ya, Hapus User"
        loading={deleting}
        onCancel={() => !deleting && setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
};
