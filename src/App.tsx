import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onIdTokenChanged, signOut } from 'firebase/auth';
import {
  BarChart3,
  Bell,
  BellRing,
  BookOpen,
  Building2,
  Calendar,
  ChevronDown,
  ChevronRight,
  Database,
  FilePlus2,
  KeyRound,
  Landmark,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  MessageSquareText,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  PieChart,
  Shield,
  ShoppingCart,
  TrendingUp,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { AccessDeniedView } from './components/AccessDeniedView';
import { AdminDashboardView } from './components/AdminDashboardView';
import { AiStudioView } from './components/AiStudioView';
import { AssetMaintenanceView } from './components/AssetMaintenanceView';
import { BrandLogo } from './components/BrandLogo';
import { ChatQaView } from './components/ChatQaView';
import { ErpStockView, type ErpModuleTab } from './components/ErpStockView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ExecutiveDashboardView } from './components/ExecutiveDashboardView';
import { LoginView } from './components/LoginView';
import { MeetingView } from './components/MeetingView';
import { NotificationCenterView } from './components/NotificationCenterView';
import {
  HeaderPendingDropdownSection,
  PendingCountBadge,
  PendingSummaryToast,
} from './components/PendingTransactionWidgets';
import { SopDetailModal } from './components/SopDetailModal';
import { SopRepositoryView } from './components/SopRepositoryView';
import { UserLoginManagementView } from './components/UserLoginManagementView';
import { UserRoleManagementView } from './components/UserRoleManagementView';
import {
  canAccessAnyErpModule,
  hasMenuPermission,
  type RolePermissionMatrix,
} from './config/menuRegistry';
import {
  formatBadgeCount,
  type PendingNavigationTarget,
  type PendingRuleEvaluation,
  type PendingUrgencyLevel,
} from './config/pendingTransactionRules';
import { usePendingTransactions } from './hooks/usePendingTransactions';
import {
  computeEffectiveMaintenanceStatus,
  fetchAccessibleAssets,
  fetchAccessibleMaintenanceSchedules,
  seedSampleAssetsAndMaintenance,
} from './lib/assetService';
import {
  auth,
  changeOwnPassword,
  DEFAULT_ROLE_ACCOUNTS,
  formatAuthError,
  getRoleDisplayLabel,
  isBootstrapAdminEmail,
  signInWithCredentials,
} from './lib/firebase';
import {
  clearRbacToken,
  fetchRbacMeApi,
  rbacLoginApi,
  type RbacSessionState,
} from './lib/rbacClient';
import { I18nProvider, LanguageSwitcher, useI18n } from './lib/i18n';
import { fetchAccessibleMeetings } from './lib/meetingService';
import { fetchAccessibleNotifications } from './lib/notificationService';
import {
  createPinnedChart,
  deletePinnedChart,
  fetchAccessiblePinnedCharts,
  sortPinnedCharts,
  updatePinnedChart,
  type CreatePinnedChartInput,
  type UpdatePinnedChartInput,
} from './lib/pinnedChartService';
import { ThemeProvider, ThemeToggleButton, useTheme } from './lib/theme';
import {
  fetchAccessibleSops,
  fetchDepartments,
  fetchDirectoryMembers,
  fetchDivisions,
  fetchSopById,
  seedInitialEnterpriseData,
  syncUserProfileAndDirectory,
} from './lib/sopService';
import type {
  AssetMaintenanceSchedule,
  CompanyAsset,
  Department,
  DirectoryMember,
  Division,
  MeetingDocument,
  NotificationRecord,
  NotificationSourceType,
  PinnedChartDocument,
  QueryLog,
  ReminderComposeDraft,
  SopDocument,
  UserProfile,
} from './types/sop';

export type ActiveView =
  | 'chat'
  | 'dashboard'
  | 'notifications'
  | 'repository'
  | 'meetings'
  | 'assets'
  | 'erp-stock'
  | 'ai-studio'
  | 'admin'
  | 'user-login'
  | 'user-role';

const VIEW_REQUIRED_MENU: Partial<Record<ActiveView, string>> = {
  dashboard: 'dashboard',
  chat: 'ask_ai',
  notifications: 'notifications',
  assets: 'assets_maint',
  repository: 'sop_repo',
  meetings: 'meetings',
  'ai-studio': 'ai_studio',
  admin: 'admin_console',
  'user-login': 'user_login',
  'user-role': 'user_role',
};

const ERP_TAB_TO_MENU: Record<ErpModuleTab, string> = {
  stock: 'erp_inventory',
  purchasing: 'erp_purchasing',
  sales: 'erp_sales',
  bi: 'erp_bi',
  finance: 'erp_finance',
  assets: 'erp_assets',
};

function mapRbacSessionToProfile(session: RbacSessionState, fallbackUid?: string): UserProfile {
  const mappedRole: UserProfile['role'] = session.role.isSystemAdmin
    ? 'Super Admin'
    : hasMenuPermission(session.permissions, 'sop_manage', 'insert') ||
        hasMenuPermission(session.permissions, 'admin_console', 'view')
      ? 'Admin Divisi'
      : 'Karyawan';

  return {
    uid: fallbackUid || session.user.id,
    rbacUserId: session.user.id,
    username: session.user.username,
    email: session.user.email,
    displayName: session.user.fullName,
    role: mappedRole,
    divisionId: session.user.divisionId || session.role.code.toLowerCase(),
    divisionName: session.user.divisionName || session.role.name,
  };
}

function pickFirstPermittedView(perms: RolePermissionMatrix | null | undefined): ActiveView {
  if (hasMenuPermission(perms, 'dashboard', 'view')) return 'dashboard';
  if (hasMenuPermission(perms, 'ask_ai', 'view')) return 'chat';
  if (canAccessAnyErpModule(perms)) return 'erp-stock';
  if (hasMenuPermission(perms, 'sop_repo', 'view')) return 'repository';
  if (hasMenuPermission(perms, 'meetings', 'view')) return 'meetings';
  if (hasMenuPermission(perms, 'assets_maint', 'view')) return 'assets';
  if (hasMenuPermission(perms, 'notifications', 'view')) return 'notifications';
  if (hasMenuPermission(perms, 'user_login', 'view')) return 'user-login';
  if (hasMenuPermission(perms, 'user_role', 'view')) return 'user-role';
  return 'dashboard';
}

function pickFirstPermittedErpTab(perms: RolePermissionMatrix | null | undefined): ErpModuleTab {
  const order: ErpModuleTab[] = ['bi', 'finance', 'purchasing', 'sales', 'stock', 'assets'];
  for (const tab of order) {
    if (hasMenuPermission(perms, ERP_TAB_TO_MENU[tab], 'view')) return tab;
  }
  return 'bi';
}

const SIDEBAR_STORAGE_KEY = 'sop-brain-sidebar-collapsed';

function readInitialSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function getUserInitials(name: string): string {
  const parts = String(name || 'U')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function SopBrainApp() {
  const { theme } = useTheme();
  const { t } = useI18n();
  const appDark = theme === 'dark';
  const [authLoading, setAuthLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [authProviderDisabled, setAuthProviderDisabled] = useState(false);

  const [user, setUser] = useState<UserProfile | null>(null);
  const [rbacSession, setRbacSession] = useState<RbacSessionState | null>(null);
  const rbacSessionRef = useRef<RbacSessionState | null>(null);
  const [idToken, setIdToken] = useState<string>('');
  const [activeView, setActiveView] = useState<ActiveView>('dashboard');
  const [activeErpModule, setActiveErpModule] = useState<ErpModuleTab>('bi');
  const [erpSubmenuOpen, setErpSubmenuOpen] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(readInitialSidebarCollapsed);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifPopoverOpen, setNotifPopoverOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  const notifRef = useRef<HTMLDivElement | null>(null);
  const profileRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    rbacSessionRef.current = rbacSession;
  }, [rbacSession]);

  const [divisions, setDivisions] = useState<Division[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [directory, setDirectory] = useState<DirectoryMember[]>([]);
  const [sops, setSops] = useState<SopDocument[]>([]);
  const [meetings, setMeetings] = useState<MeetingDocument[]>([]);
  const [assets, setAssets] = useState<CompanyAsset[]>([]);
  const [maintenanceSchedules, setMaintenanceSchedules] = useState<AssetMaintenanceSchedule[]>([]);
  const [pinnedCharts, setPinnedCharts] = useState<PinnedChartDocument[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [pendingReminderDraft, setPendingReminderDraft] = useState<ReminderComposeDraft | null>(null);
  const [pendingErpNavTarget, setPendingErpNavTarget] = useState<PendingNavigationTarget | null>(null);
  const [pendingToastVisible, setPendingToastVisible] = useState(false);
  const [pendingChatQuestion, setPendingChatQuestion] = useState<string | null>(null);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [dismissedReminderIds, setDismissedReminderIds] = useState<string[]>([]);
  const notifiedBrowserIdsRef = useRef<Set<string>>(new Set());

  const {
    summary: pendingSummary,
    loading: pendingLoading,
    error: pendingError,
    refresh: refreshPending,
  } = usePendingTransactions({
    enabled: Boolean(user && (idToken || rbacSession)),
    idToken,
    userUid: user?.rbacUserId || user?.uid,
  });

  // Once-per-session login summary toast (silent, non-intrusive, never repeats in the same session)
  useEffect(() => {
    if (!user) {
      setPendingToastVisible(false);
      setPendingErpNavTarget(null);
      return;
    }
    if (!pendingSummary || pendingSummary.totalCount <= 0) return;
    const sessionKey = `erp_pending_toast_shown_${user.rbacUserId || user.uid}`;
    try {
      if (window.sessionStorage.getItem(sessionKey) === '1') return;
      window.sessionStorage.setItem(sessionKey, '1');
    } catch {
      // Ignore storage access restrictions
    }
    setPendingToastVisible(true);
  }, [user, pendingSummary]);

  useEffect(() => {
    if (!pendingToastVisible) return;
    const timer = window.setTimeout(() => {
      setPendingToastVisible(false);
    }, 10_000);
    return () => window.clearTimeout(timer);
  }, [pendingToastVisible]);
  const [browserNotifPermission, setBrowserNotifPermission] = useState<
    NotificationPermission | 'unsupported'
  >(() =>
    typeof window !== 'undefined' && 'Notification' in window
      ? window.Notification.permission
      : 'unsupported'
  );
  const [dataLoading, setDataLoading] = useState(false);
  const [seedingLabel, setSeedingLabel] = useState<string | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);

  // SOP Modal State
  const [modalSop, setModalSop] = useState<SopDocument | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'read' | 'edit'>('read');
  const [modalHighlightSection, setModalHighlightSection] = useState<string | undefined>(undefined);
  const [modalRevisionContext, setModalRevisionContext] = useState<{
    feedbackLogs: QueryLog[];
  } | null>(null);
  const [adminRefreshTick, setAdminRefreshTick] = useState(0);

  // Self-service Change Password Modal (non-bootstrap users only; Super User stays fixed)
  const [pwModalOpen, setPwModalOpen] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNext, setPwNext] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState<string | null>(null);

  const handleSubmitOwnPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwSaving) return;
    setPwError(null);
    setPwSuccess(null);
    if (pwNext.length < 6) {
      setPwError('Kata sandi baru minimal 6 karakter.');
      return;
    }
    if (pwNext !== pwConfirm) {
      setPwError('Konfirmasi kata sandi baru tidak cocok.');
      return;
    }
    setPwSaving(true);
    try {
      await changeOwnPassword({ currentPassword: pwCurrent, newPassword: pwNext });
      setPwCurrent('');
      setPwNext('');
      setPwConfirm('');
      setPwSuccess('Kata sandi Anda berhasil diperbarui.');
    } catch (err) {
      const formatted = formatAuthError(err);
      setPwError(formatted.message);
    } finally {
      setPwSaving(false);
    }
  };

  // Prefill from Admin Unanswered Question or Meeting Notulen -> AI Writer
  const [aiPrefill, setAiPrefill] = useState<{
    notes: string;
    titleHint: string;
    logIds?: string[];
    meetingId?: string;
  } | null>(null);

  const autoAssetSeedAttemptedRef = useRef(false);

  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  };

  // Close header dropdowns on outside click / Escape
  useEffect(() => {
    if (!notifPopoverOpen && !profileMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifPopoverOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setNotifPopoverOpen(false);
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [notifPopoverOpen, profileMenuOpen]);

  const loadWorkspaceData = useCallback(async (profile: UserProfile, token?: string) => {
    setDataLoading(true);
    try {
      const [divs, depts, dir, sopList, meetingList, assetList, scheduleList, chartList, notifList] =
        await Promise.all([
          fetchDivisions(),
          fetchDepartments(),
          fetchDirectoryMembers(),
          fetchAccessibleSops(profile),
          fetchAccessibleMeetings(profile).catch(() => [] as MeetingDocument[]),
          fetchAccessibleAssets(profile).catch(() => [] as CompanyAsset[]),
          fetchAccessibleMaintenanceSchedules(profile).catch(() => [] as AssetMaintenanceSchedule[]),
          fetchAccessiblePinnedCharts(profile).catch(() => [] as PinnedChartDocument[]),
          fetchAccessibleNotifications(profile).catch(() => [] as NotificationRecord[]),
        ]);
      setDivisions(divs);
      setDepartments(depts);
      setDirectory(dir);
      setSops(sopList);
      setMeetings(meetingList);
      setAssets(assetList);
      setMaintenanceSchedules(scheduleList);
      setPinnedCharts(chartList);
      setNotifications(notifList);
      setSeedError(null);

      // Auto-populate sample asset & maintenance dataset once if still empty so AI testing works immediately
      const seedMarkerKey = `sopbrain_asset_sample_seeded_v2_${profile.uid}`;
      const alreadyAutoSeeded =
        typeof window !== 'undefined' && window.localStorage.getItem(seedMarkerKey) === '1';

      if (
        assetList.length === 0 &&
        profile.role !== 'Karyawan' &&
        !autoAssetSeedAttemptedRef.current &&
        !alreadyAutoSeeded
      ) {
        autoAssetSeedAttemptedRef.current = true;
        try {
          const seeded = await seedSampleAssetsAndMaintenance({
            actor: profile,
            divisions: divs,
            directory: dir,
            existingAssets: assetList,
            existingSchedules: scheduleList,
            idToken: token,
          });
          setAssets(seeded.assets);
          setMaintenanceSchedules(seeded.schedules);
          if (typeof window !== 'undefined') {
            window.localStorage.setItem(seedMarkerKey, '1');
          }
        } catch (seedErr) {
          console.warn('Auto-seed sample assets skipped:', seedErr);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal memuat data workspace.';
      setSeedError(msg);
    } finally {
      setDataLoading(false);
    }
  }, []);

  // Tick every 30 seconds for live meeting reminders across all tabs
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // Proactively keep the Express backend warm while the app tab is open & wake it on focus
  useEffect(() => {
    if (!user) return;
    const pingHealth = () => {
      if (document.visibilityState !== 'visible') return;
      void fetch(`/api/health?_t=${Date.now()}`, { cache: 'no-store' }).catch(() => {});
    };
    pingHealth();
    const interval = window.setInterval(pingHealth, 180_000);
    const onVisible = () => pingHealth();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [user]);

  const activeReminders = useMemo(() => {
    if (!user) return [];
    return meetings
      .filter((m) => {
        if (m.status !== 'Terjadwal' || !m.reminderMinutes || m.reminderMinutes <= 0) return false;
        const diffMin = Math.round((m.startAtMs - nowMs) / 60_000);
        return diffMin <= m.reminderMinutes && diffMin >= -10;
      })
      .sort((a, b) => a.startAtMs - b.startAtMs);
  }, [meetings, nowMs, user]);

  const visibleReminders = useMemo(
    () => activeReminders.filter((m) => !dismissedReminderIds.includes(m.id)),
    [activeReminders, dismissedReminderIds]
  );

  const urgentMaintenanceCount = useMemo(() => {
    if (!user) return 0;
    return maintenanceSchedules.filter((s) => {
      const { effectiveStatus } = computeEffectiveMaintenanceStatus(s, nowMs);
      return effectiveStatus === 'Terlambat' || effectiveStatus === 'Mendekati Jatuh Tempo';
    }).length;
  }, [maintenanceSchedules, nowMs, user]);

  const unreadSpecialNotifs = useMemo(() => {
    if (!user) return [];
    return notifications.filter(
      (n) =>
        !n.inAppRead &&
        (n.recipientUid === user.uid || n.viewerUids.includes(user.uid))
    );
  }, [notifications, user]);

  // Fire native browser Notification once per meeting when entering its reminder window
  useEffect(() => {
    if (
      !user ||
      browserNotifPermission !== 'granted' ||
      typeof window === 'undefined' ||
      !('Notification' in window)
    ) {
      return;
    }
    for (const m of activeReminders) {
      if (notifiedBrowserIdsRef.current.has(m.id)) continue;
      notifiedBrowserIdsRef.current.add(m.id);
      const diffMin = Math.max(0, Math.round((m.startAtMs - nowMs) / 60_000));
      try {
        new window.Notification(`${t('banners.meetingReminderLabel')} ${m.title}`, {
          body:
            diffMin > 0
              ? `${t('banners.startsInMin', { count: diffMin })} (${m.startTime}–${m.endTime})${m.location ? ` · ${m.location}` : ''}`
              : `${t('banners.startsNow')} (${m.startTime}–${m.endTime})`,
        });
      } catch {
        // Ignore notification restrictions inside embedded preview iframes
      }
    }
  }, [activeReminders, browserNotifPermission, nowMs, t, user]);

  const handleRequestBrowserNotif = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setBrowserNotifPermission('unsupported');
      return;
    }
    try {
      const result = await window.Notification.requestPermission();
      setBrowserNotifPermission(result);
    } catch {
      // Ignore if blocked by iframe policy
    }
  };

  const refreshRbacProfile = useCallback(
    async (tokenOverride?: string) => {
      try {
        const me = await fetchRbacMeApi(tokenOverride || idToken || null);
        setRbacSession((prev) => ({
          token: prev?.token ?? null,
          user: me.user,
          role: me.role,
          permissions: me.permissions,
          registry: me.registry,
        }));
        setUser((prev) =>
          mapRbacSessionToProfile(
            {
              token: null,
              user: me.user,
              role: me.role,
              permissions: me.permissions,
              registry: me.registry,
            },
            prev?.uid
          )
        );
      } catch (err) {
        console.warn('Refresh RBAC session warning:', err);
      }
    },
    [idToken]
  );

  useEffect(() => {
    let lastUid: string | null = null;
    const unsub = onIdTokenChanged(auth, async (fbUser) => {
      if (!fbUser) {
        lastUid = null;
        setIdToken('');
        // Only clear app user if not logged in via an active server RBAC session
        if (!rbacSessionRef.current) {
          setUser(null);
        }
        setAuthLoading(false);
        return;
      }

      try {
        const token = await fbUser.getIdToken();
        setIdToken(token);

        // If user explicitly logged in via RBAC form, keep RBAC identity authoritative
        if (rbacSessionRef.current) {
          const activeProfile = mapRbacSessionToProfile(rbacSessionRef.current, fbUser.uid);
          setUser(activeProfile);
          if (lastUid !== `${fbUser.uid}:${rbacSessionRef.current.user.id}`) {
            lastUid = `${fbUser.uid}:${rbacSessionRef.current.user.id}`;
            await loadWorkspaceData(activeProfile, token);
          }
          setAuthLoading(false);
          return;
        }

        if (lastUid !== fbUser.uid) {
          lastUid = fbUser.uid;
          const profile = await syncUserProfileAndDirectory(fbUser);
          // Resolve authoritative server-side RBAC role & permissions
          try {
            const me = await fetchRbacMeApi(token);
            const restoredSession: RbacSessionState = {
              token: null,
              user: me.user,
              role: me.role,
              permissions: me.permissions,
              registry: me.registry,
            };
            rbacSessionRef.current = restoredSession;
            setRbacSession(restoredSession);
            const mergedProfile = mapRbacSessionToProfile(restoredSession, fbUser.uid);
            setUser(mergedProfile);
            setActiveView(pickFirstPermittedView(me.permissions));
            setActiveErpModule(pickFirstPermittedErpTab(me.permissions));
            setLoginError(null);
            setAuthProviderDisabled(false);
            await loadWorkspaceData(mergedProfile, token);
          } catch {
            setUser(profile);
            setActiveView('dashboard');
            setLoginError(null);
            setAuthProviderDisabled(false);
            await loadWorkspaceData(profile, token);
          }
        }
      } catch (err) {
        console.error('Auth initialization error:', err);
        setLoginError(err instanceof Error ? err.message : 'Gagal memuat profil pengguna.');
      } finally {
        setAuthLoading(false);
      }
    });

    return () => unsub();
  }, [loadWorkspaceData]);

  const handleSignIn = async (identifier: string, password: string, rememberMe = true) => {
    setSigningIn(true);
    setLoginError(null);
    setAuthProviderDisabled(false);
    try {
      // 1. Primary server-side authentication (verifies scrypt password hash, active status, & Role)
      const session = await rbacLoginApi(identifier, password);
      rbacSessionRef.current = session;
      setRbacSession(session);

      // 2. Ensure background Firebase read session is available for Firestore SOP/Meetings/Assets
      let fbUid: string | undefined = auth.currentUser?.uid;
      let fbToken = idToken;
      if (!auth.currentUser) {
        try {
          const fallbackDemo = DEFAULT_ROLE_ACCOUNTS[0];
          const cred = await signInWithCredentials(
            fallbackDemo?.username || identifier,
            fallbackDemo?.password || password,
            rememberMe
          );
          fbUid = cred.user.uid;
          fbToken = await cred.user.getIdToken();
          setIdToken(fbToken);
        } catch {
          // App still operates cleanly with authoritative RBAC server token
        }
      }

      const profile = mapRbacSessionToProfile(session, fbUid);
      setUser(profile);
      setActiveView(pickFirstPermittedView(session.permissions));
      setActiveErpModule(pickFirstPermittedErpTab(session.permissions));
      void loadWorkspaceData(profile, fbToken || undefined);
    } catch (err) {
      // Fallback: if account is a legacy Firebase-only user not in RBAC store, try Firebase Auth
      const errMessage = err instanceof Error ? err.message : 'Gagal login.';
      const isDeactivated = /nonaktif/i.test(errMessage);
      if (isDeactivated) {
        setLoginError(errMessage);
        return;
      }
      try {
        await signInWithCredentials(identifier, password, rememberMe);
      } catch (fbErr) {
        const formatted = formatAuthError(fbErr);
        setLoginError(errMessage || formatted.message);
        setAuthProviderDisabled(formatted.isProviderDisabled);
      }
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    setProfileMenuOpen(false);
    setNotifPopoverOpen(false);
    clearRbacToken();
    rbacSessionRef.current = null;
    setRbacSession(null);
    setUser(null);
    setIdToken('');
    setActiveView('dashboard');
    setModalOpen(false);
    setModalSop(null);
    setAiPrefill(null);
    setPendingChatQuestion(null);
    setAssets([]);
    setMaintenanceSchedules([]);
    setNotifications([]);
    setPendingReminderDraft(null);
    try {
      await signOut(auth);
    } catch {
      // Ignore if Firebase wasn't signed in
    }
  };

  const handleSeedDemo = async () => {
    if (!user || !idToken || seedingLabel) return;
    setSeedError(null);
    setSeedingLabel(t('banners.seedingInitialSop'));
    try {
      const freshToken = (await auth.currentUser?.getIdToken()) || idToken;
      setIdToken(freshToken);
      await seedInitialEnterpriseData({
        actor: user,
        directory,
        idToken: freshToken,
        onProgress: (label) => setSeedingLabel(label),
      });
      await loadWorkspaceData(user);
    } catch (err) {
      console.error('Seeding failed:', err);
      setSeedError(err instanceof Error ? err.message : 'Gagal memuat data SOP awal.');
    } finally {
      setSeedingLabel(null);
    }
  };

  const handleOpenSopCitation = async (sopId: string, sectionTitle?: string) => {
    let found: SopDocument | null | undefined = sops.find((s) => s.id === sopId);
    if (!found) {
      try {
        found = await fetchSopById(sopId);
        if (found) {
          setSops((prev) => [found!, ...prev.filter((s) => s.id !== found!.id)]);
        }
      } catch (err) {
        setSeedError(err instanceof Error ? err.message : 'Gagal membuka dokumen SOP sumber.');
        return;
      }
    }
    if (!found) return;
    setModalSop(found);
    setModalMode('read');
    setModalHighlightSection(sectionTitle);
    setModalRevisionContext(null);
    setModalOpen(true);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center">
        <div className="flex items-center gap-2.5 text-sm text-[var(--text-muted)]">
          <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />
          <span>{t('common.loadingApp')}</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginView
        onSignIn={handleSignIn}
        loading={signingIn}
        error={loginError}
        isProviderDisabled={authProviderDisabled}
      />
    );
  }

  const rbacPerms = rbacSession?.permissions ?? null;
  const canViewMenu = (menuId: string) =>
    rbacPerms ? hasMenuPermission(rbacPerms, menuId, 'view') : true;

  const canWrite = rbacPerms
    ? hasMenuPermission(rbacPerms, 'ai_studio', 'view')
    : user.role !== 'Karyawan';
  const isAdmin = rbacPerms
    ? hasMenuPermission(rbacPerms, 'admin_console', 'view')
    : user.role === 'Super Admin' || user.role === 'Admin Divisi';
  const canManageUsers = rbacPerms
    ? hasMenuPermission(rbacPerms, 'user_login', 'view')
    : isAdmin;
  const canManageRoles = rbacPerms
    ? hasMenuPermission(rbacPerms, 'user_role', 'view')
    : isAdmin;
  const canViewAnyErp = rbacPerms ? canAccessAnyErpModule(rbacPerms) : true;

  const pendingTxCount = pendingSummary?.totalCount || 0;
  const totalNotifCount =
    activeReminders.length +
    urgentMaintenanceCount +
    unreadSpecialNotifs.length +
    pendingTxCount;

  const handleSelectPendingRule = (rule: PendingRuleEvaluation) => {
    setActiveErpModule(rule.targetErpTab);
    setActiveView('erp-stock');
    setErpSubmenuOpen(true);
    setPendingErpNavTarget({
      ruleId: rule.ruleId,
      module: rule.module,
      erpTab: rule.targetErpTab,
      subTab: rule.targetSubTab,
      filterKey: rule.targetFilterKey,
      statusChip: rule.targetStatusChip,
      nonce: Date.now(),
    });
    setNotifPopoverOpen(false);
    setMobileMenuOpen(false);
    setPendingToastVisible(false);
  };

  const handleTriggerReminderDraft = (draft: ReminderComposeDraft) => {
    setPendingReminderDraft(draft);
    setActiveView('notifications');
  };

  const handleNavigateNotificationSource = (sourceType: NotificationSourceType, sourceId: string) => {
    if (sourceType === 'ASSET_MAINTENANCE') {
      setActiveView('assets');
    } else if (sourceType === 'MEETING') {
      if (sourceId) setSelectedMeetingId(sourceId);
      setActiveView('meetings');
    } else if (sourceType === 'SOP' && sourceId) {
      void handleOpenSopCitation(sourceId);
    }
  };

  const allErpSubItems: {
    id: ErpModuleTab;
    menuId: string;
    label: string;
    icon: React.ReactNode;
    pendingCount?: number;
    pendingUrgency?: PendingUrgencyLevel | null;
    pendingLoading?: boolean;
  }[] = [
    {
      id: 'bi',
      menuId: 'erp_bi',
      label: t('menu.erpBi'),
      icon: <PieChart className="w-3.5 h-3.5" />,
    },
    {
      id: 'finance',
      menuId: 'erp_finance',
      label: t('menu.erpFinance'),
      icon: <Landmark className="w-3.5 h-3.5" />,
    },
    {
      id: 'purchasing',
      menuId: 'erp_purchasing',
      label: t('menu.erpPurchasing'),
      icon: <ShoppingCart className="w-3.5 h-3.5" />,
      pendingCount: pendingSummary?.byModule?.purchasing?.count || 0,
      pendingUrgency: pendingSummary?.byModule?.purchasing?.highestUrgency || null,
      pendingLoading: pendingLoading && !pendingSummary,
    },
    {
      id: 'sales',
      menuId: 'erp_sales',
      label: t('menu.erpSales'),
      icon: <TrendingUp className="w-3.5 h-3.5" />,
      pendingCount: pendingSummary?.byModule?.sales?.count || 0,
      pendingUrgency: pendingSummary?.byModule?.sales?.highestUrgency || null,
      pendingLoading: pendingLoading && !pendingSummary,
    },
    {
      id: 'stock',
      menuId: 'erp_inventory',
      label: t('menu.erpStock'),
      icon: <Package className="w-3.5 h-3.5" />,
    },
    {
      id: 'assets',
      menuId: 'erp_assets',
      label: t('menu.erpAssets'),
      icon: <Building2 className="w-3.5 h-3.5" />,
    },
  ];

  const erpSubItems = allErpSubItems.filter((sub) => canViewMenu(sub.menuId));

  interface NavItemDef {
    id: ActiveView;
    label: string;
    icon: React.ReactNode;
    visible: boolean;
    count?: number;
    hasErpSubmenu?: boolean;
  }

  const navGroups: { key: string; label: string; items: NavItemDef[] }[] = [
    {
      key: 'main',
      label: t('menu.groups.main'),
      items: [
        {
          id: 'dashboard',
          label: t('menu.dashboard'),
          icon: <BarChart3 className="w-4 h-4" />,
          visible: canViewMenu('dashboard'),
          count: pinnedCharts.length > 0 ? pinnedCharts.length : undefined,
        },
        {
          id: 'chat',
          label: t('menu.chat'),
          icon: <MessageSquareText className="w-4 h-4" />,
          visible: canViewMenu('ask_ai'),
        },
        {
          id: 'notifications',
          label: t('menu.notificationsCenter'),
          icon: <BellRing className="w-4 h-4" />,
          visible: canViewMenu('notifications'),
          count: totalNotifCount > 0 ? totalNotifCount : undefined,
        },
      ],
    },
    {
      key: 'erp',
      label: t('menu.groups.erp'),
      items: [
        {
          id: 'erp-stock',
          label: t('menu.erpLive'),
          icon: <Package className="w-4 h-4" />,
          visible: canViewAnyErp && erpSubItems.length > 0,
          hasErpSubmenu: true,
        },
        {
          id: 'assets',
          label: t('menu.assets'),
          icon: <Wrench className="w-4 h-4" />,
          visible: canViewMenu('assets_maint'),
          count: urgentMaintenanceCount > 0 ? urgentMaintenanceCount : undefined,
        },
      ],
    },
    {
      key: 'governance',
      label: t('menu.groups.governance'),
      items: [
        {
          id: 'repository',
          label: t('menu.repository'),
          icon: <BookOpen className="w-4 h-4" />,
          visible: canViewMenu('sop_repo'),
        },
        {
          id: 'meetings',
          label: t('menu.meetings'),
          icon: <Calendar className="w-4 h-4" />,
          visible: canViewMenu('meetings'),
          count: activeReminders.length > 0 ? activeReminders.length : undefined,
        },
        {
          id: 'ai-studio',
          label: t('menu.aiStudio'),
          icon: <FilePlus2 className="w-4 h-4" />,
          visible: canWrite,
        },
      ],
    },
    {
      key: 'admin',
      label: t('menu.groups.admin'),
      items: [
        {
          id: 'user-login',
          label: t('menu.userLogin'),
          icon: <Users className="w-4 h-4" />,
          visible: canManageUsers,
        },
        {
          id: 'user-role',
          label: t('menu.userRole'),
          icon: <Shield className="w-4 h-4" />,
          visible: canManageRoles,
        },
        {
          id: 'admin',
          label: t('menu.admin'),
          icon: <LayoutDashboard className="w-4 h-4" />,
          visible: isAdmin,
        },
      ],
    },
  ];

  // Check if current activeView is permitted by RBAC
  const requiredMenuForActiveView = VIEW_REQUIRED_MENU[activeView];
  const isActiveViewPermitted =
    activeView === 'erp-stock'
      ? canViewAnyErp
      : requiredMenuForActiveView
        ? canViewMenu(requiredMenuForActiveView)
        : true;

  // Breadcrumb calculation
  let activeGroupLabel = t('menu.groups.main');
  let activePageLabel = t('menu.dashboard');
  for (const grp of navGroups) {
    const found = grp.items.find((item) => item.id === activeView);
    if (found) {
      activeGroupLabel = grp.label;
      activePageLabel = found.label;
      break;
    }
  }
  const activeErpSubLabel =
    activeView === 'erp-stock'
      ? erpSubItems.find((s) => s.id === activeErpModule)?.label
      : undefined;

  const rbacRoleTranslated = rbacSession
    ? (() => {
        const key = `roles.${rbacSession.role.code}`;
        const localized = t(key);
        const displayName = localized !== key ? localized : rbacSession.role.name;
        return `${rbacSession.role.code} · ${displayName}`;
      })()
    : null;
  const translatedRole =
    rbacRoleTranslated || t(`roles.${user.role}`) || getRoleDisplayLabel(user.role);

  const renderSidebarNav = (isMobileDrawer = false) => {
    const isCompact = !isMobileDrawer && sidebarCollapsed;
    return (
      <nav className="flex-1 overflow-y-auto py-4 px-2.5 space-y-5">
        {navGroups.map((group) => {
          const visibleItems = group.items.filter((it) => it.visible);
          if (visibleItems.length === 0) return null;

          return (
            <div key={group.key} className="space-y-1">
              {!isCompact ? (
                <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.11em] text-[#9BCACA]/85 dark:text-[#64748B] truncate">
                  {group.label}
                </p>
              ) : (
                <div className="mx-2 my-1.5 border-t border-white/12 dark:border-[#232D3B]" />
              )}

              {visibleItems.map((item) => {
                const isActive = activeView === item.id;
                return (
                  <div key={item.id} className="space-y-0.5">
                    <div className="relative flex items-center">
                      {isActive && (
                        <span
                          className="absolute left-0 top-2 bottom-2 w-[2.5px] rounded-r-full bg-[#5EEAD4] dark:bg-[#45C8C4]"
                          aria-hidden="true"
                        />
                      )}
                      <button
                        type="button"
                        title={isCompact ? item.label : undefined}
                        onClick={() => {
                          if (item.hasErpSubmenu) {
                            if (activeView === 'erp-stock' && !isCompact) {
                              setErpSubmenuOpen((v) => !v);
                            } else {
                              setActiveView('erp-stock');
                              setErpSubmenuOpen(true);
                            }
                          } else {
                            setActiveView(item.id);
                          }
                          if (isMobileDrawer && !item.hasErpSubmenu) {
                            setMobileMenuOpen(false);
                          }
                        }}
                        className={`relative w-full flex items-center ${
                          isCompact ? 'justify-center px-0' : 'justify-between px-3'
                        } h-10 rounded-[8px] text-[13px] transition-colors duration-150 cursor-pointer ${
                          isActive
                            ? 'bg-white/[0.13] dark:bg-[#108486]/18 dark:ring-1 dark:ring-inset dark:ring-[#45C8C4]/22 text-white font-semibold'
                            : 'text-[#CBE6E6] dark:text-[#94A3B8] hover:bg-white/[0.07] dark:hover:bg-white/[0.05] hover:text-white font-medium'
                        }`}
                      >
                        <span className="flex items-center gap-2.5 min-w-0">
                          <span
                            className={`shrink-0 ${
                              isActive
                                ? 'text-[#5EEAD4] dark:text-[#45C8C4]'
                                : 'text-[#8EC2C2] dark:text-[#64748B]'
                            }`}
                          >
                            {item.icon}
                          </span>
                          {!isCompact && <span className="truncate">{item.label}</span>}
                        </span>

                        {isCompact && item.hasErpSubmenu && (
                          <PendingCountBadge
                            count={pendingTxCount}
                            urgency={pendingSummary?.highestUrgency}
                            loading={pendingLoading && !pendingSummary}
                            corner
                            onDarkSurface
                          />
                        )}

                        {isCompact && !item.hasErpSubmenu && Boolean(item.count) && (
                          <PendingCountBadge count={item.count || 0} corner onDarkSurface />
                        )}

                        {!isCompact && (
                          <span className="flex items-center gap-1.5 shrink-0 ml-2">
                            {item.hasErpSubmenu && !erpSubmenuOpen && (
                              <PendingCountBadge
                                count={pendingTxCount}
                                urgency={pendingSummary?.highestUrgency}
                                loading={pendingLoading && !pendingSummary}
                                onDarkSurface
                              />
                            )}
                            {Boolean(item.count) && (
                              <span className="font-mono tabular-nums text-[11px] font-semibold px-1.5 py-0.5 rounded bg-white/[0.12] text-[#7CEEE0] dark:bg-[#1A222D] dark:text-[#45C8C4] dark:border dark:border-[#232D3B]">
                                {formatBadgeCount(item.count || 0)}
                              </span>
                            )}
                            {item.hasErpSubmenu && (
                              <ChevronDown
                                className={`w-3.5 h-3.5 text-[#9BCACA] dark:text-[#64748B] transition-transform duration-200 ${
                                  erpSubmenuOpen ? 'rotate-180' : ''
                                }`}
                              />
                            )}
                          </span>
                        )}
                      </button>
                    </div>

                    {/* Smooth Expand/Collapse Submenu for ERP Live modules */}
                    {item.hasErpSubmenu && !isCompact && (
                      <div
                        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                          erpSubmenuOpen
                            ? 'grid-rows-[1fr] opacity-100'
                            : 'grid-rows-[0fr] opacity-0 pointer-events-none'
                        }`}
                      >
                        <div className="overflow-hidden">
                          <div className="pl-4 pr-1 pt-0.5 pb-1 space-y-0.5 border-l border-white/[0.14] dark:border-[#232D3B] ml-5">
                            {erpSubItems.map((sub) => {
                              const subActive =
                                activeView === 'erp-stock' && activeErpModule === sub.id;
                              return (
                                <button
                                  key={sub.id}
                                  type="button"
                                  onClick={() => {
                                    setActiveErpModule(sub.id);
                                    setActiveView('erp-stock');
                                    if (isMobileDrawer) setMobileMenuOpen(false);
                                  }}
                                  className={`w-full flex items-center justify-between gap-2 h-8 px-2.5 rounded-[6px] text-xs transition-colors duration-150 cursor-pointer ${
                                    subActive
                                      ? 'bg-white/[0.13] dark:bg-[#108486]/16 text-white font-semibold'
                                      : 'text-[#B5DADA] dark:text-[#94A3B8] hover:bg-white/[0.07] dark:hover:bg-white/[0.05] hover:text-white'
                                  }`}
                                >
                                  <span className="flex items-center gap-2 min-w-0">
                                    <span
                                      className={`shrink-0 ${
                                        subActive
                                          ? 'text-[#5EEAD4] dark:text-[#45C8C4]'
                                          : 'text-[#84BABA] dark:text-[#64748B]'
                                      }`}
                                    >
                                      {sub.icon}
                                    </span>
                                    <span className="truncate">{sub.label}</span>
                                  </span>
                                  {(sub.pendingCount || sub.pendingLoading) ? (
                                    <PendingCountBadge
                                      count={sub.pendingCount || 0}
                                      urgency={sub.pendingUrgency}
                                      loading={sub.pendingLoading}
                                      onDarkSurface
                                    />
                                  ) : null}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </nav>
    );
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] flex">
      {/* Desktop Fixed Left Sidebar — Corporate Deep Marine Teal echoing Login Page */}
      <aside
        className={`hidden lg:flex flex-col shrink-0 sticky top-0 h-screen bg-[linear-gradient(180deg,#042F42_0%,#074659_55%,#0C6672_100%)] dark:bg-[linear-gradient(180deg,#0F141B_0%,#0D1218_100%)] text-white border-r border-[#5EEAD4]/15 dark:border-[#232D3B] transition-[width] duration-200 ease-out z-30 ${
          sidebarCollapsed ? 'w-[72px]' : 'w-64'
        }`}
      >
        <div
          className={`h-16 border-b border-white/[0.1] dark:border-[#232D3B] flex items-center ${
            sidebarCollapsed ? 'justify-center px-2' : 'justify-between px-4'
          }`}
        >
          <BrandLogo size="sm" variant="onDark" accentScheme="tosca" showText={!sidebarCollapsed} />
          {!sidebarCollapsed && (
            <button
              type="button"
              onClick={toggleSidebarCollapsed}
              title={t('menu.collapseSidebar')}
              aria-label={t('menu.collapseSidebar')}
              className="p-1.5 rounded-[8px] text-[#9BCACA] dark:text-[#94A3B8] hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          )}
        </div>

        {renderSidebarNav(false)}

        <div className="border-t border-white/[0.1] dark:border-[#232D3B] p-2.5">
          {sidebarCollapsed ? (
            <button
              type="button"
              onClick={toggleSidebarCollapsed}
              title={t('menu.expandSidebar')}
              aria-label={t('menu.expandSidebar')}
              className="w-full h-10 flex items-center justify-center rounded-[8px] text-[#9BCACA] dark:text-[#94A3B8] hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          ) : (
            <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-[8px] bg-white/[0.07] border border-white/[0.08] dark:bg-[#131921] dark:border-[#232D3B]">
              <div className="w-8 h-8 rounded-[6px] bg-[#5EEAD4] text-[#042A35] dark:bg-[#108486] dark:text-white flex items-center justify-center text-xs font-bold shrink-0">
                {getUserInitials(user.displayName)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-white truncate">
                  {user.displayName}
                </p>
                <p className="text-[11px] text-[#A8D5D5] dark:text-[#94A3B8] truncate">
                  {translatedRole} · {user.divisionName || t('common.general')}
                </p>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Mobile Slide-Over Sidebar Drawer */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden flex"
          role="dialog"
          aria-modal="true"
          aria-label={t('menu.openMenu')}
        >
          <div
            className="fixed inset-0 bg-[var(--overlay-bg)] dark:bg-black/65"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-10 w-72 max-w-[85vw] bg-[linear-gradient(180deg,#042F42_0%,#074659_55%,#0C6672_100%)] dark:bg-[linear-gradient(180deg,#0F141B_0%,#0D1218_100%)] text-white border-r border-[#5EEAD4]/15 dark:border-[#232D3B] flex flex-col h-full">
            <div className="h-16 px-4 border-b border-white/[0.1] dark:border-[#232D3B] flex items-center justify-between gap-2">
              <BrandLogo size="sm" variant="onDark" accentScheme="tosca" />
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label={t('common.close')}
                className="p-2 rounded-[8px] text-[#9BCACA] dark:text-[#94A3B8] hover:text-white hover:bg-white/[0.08] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {renderSidebarNav(true)}
            <div className="border-t border-white/[0.1] dark:border-[#232D3B] p-3">
              <button
                type="button"
                onClick={handleSignOut}
                className="w-full h-10 inline-flex items-center justify-center gap-2 text-xs font-semibold text-white bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.12] dark:bg-[#1A222D] dark:hover:bg-[#222C3A] dark:border-[#232D3B] rounded-[8px] transition-colors cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>{t('menu.signOut')}</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Right Shell: Sticky Header + Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Header (64px) */}
        <header className="h-16 sticky top-0 z-20 bg-[var(--surface)] border-b border-[var(--border)] px-4 sm:px-6 flex items-center justify-between gap-3">
          {/* Left: Mobile Trigger + Breadcrumb */}
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden inline-flex items-center justify-center w-9 h-9 text-[var(--text)] bg-[var(--surface-2)] border border-[var(--border)] rounded-lg cursor-pointer shrink-0"
              aria-label={t('menu.openMenu')}
            >
              <Menu className="w-4 h-4" />
            </button>

            <nav
              aria-label="Breadcrumb"
              className="flex items-center gap-1.5 text-xs sm:text-sm min-w-0"
            >
              <span className="hidden md:inline text-[var(--text-muted)] whitespace-nowrap shrink-0">
                {activeGroupLabel}
              </span>
              <ChevronRight className="hidden md:inline w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
              <span className="font-display font-semibold text-[var(--text)] truncate">
                {activePageLabel}
              </span>
              {activeErpSubLabel && (
                <>
                  <ChevronRight className="hidden sm:inline w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                  <span className="hidden sm:inline text-xs font-medium text-[var(--text-muted)] truncate">
                    {activeErpSubLabel}
                  </span>
                </>
              )}
            </nav>
          </div>

          {/* Right: Language Pill, Theme Toggle, Notifications, User Profile */}
          <div className="flex items-center gap-2 shrink-0">
            <LanguageSwitcher />
            <ThemeToggleButton iconOnly />

            {/* Notifications Popover */}
            <div ref={notifRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  setNotifPopoverOpen((v) => !v);
                  setProfileMenuOpen(false);
                }}
                aria-label={t('menu.notifications')}
                title={t('menu.notifications')}
                className="relative inline-flex items-center justify-center w-9 h-9 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] hover:border-[var(--text-muted)] transition-colors cursor-pointer"
              >
                <Bell className="w-4 h-4" />
                {totalNotifCount > 0 && (
                  <span
                    className={`absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full font-mono tabular-nums text-[10px] font-bold flex items-center justify-center ${
                      pendingSummary?.highestUrgency === 'overdue'
                        ? 'bg-[var(--danger)] text-[var(--on-danger)]'
                        : 'bg-[var(--accent)] text-[var(--on-accent)]'
                    }`}
                  >
                    {formatBadgeCount(totalNotifCount)}
                  </span>
                )}
              </button>

              {notifPopoverOpen && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 max-w-[calc(100vw-2rem)] rounded-xl bg-[var(--surface)] border border-[var(--border)] shadow-[var(--modal-shadow)] dark:shadow-xl overflow-hidden z-50">
                  <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
                    <span className="font-display text-xs font-semibold text-[var(--text)]">
                      {t('menu.notifications')}
                    </span>
                    <span className="font-mono tabular-nums text-[11px] text-[var(--text-muted)]">
                      {formatBadgeCount(totalNotifCount)}
                    </span>
                  </div>
                  <div className="max-h-[420px] overflow-y-auto divide-y divide-[var(--border)]">
                    <HeaderPendingDropdownSection
                      summary={pendingSummary}
                      loading={pendingLoading}
                      error={pendingError}
                      onSelectRule={handleSelectPendingRule}
                      onRetry={() => void refreshPending(true)}
                    />
                    {totalNotifCount === 0 &&
                    !pendingLoading &&
                    !pendingError &&
                    (!pendingSummary ||
                      !Array.isArray(pendingSummary.allowedRuleIds) ||
                      pendingSummary.allowedRuleIds.length === 0) ? (
                      <div className="px-4 py-6 text-center text-xs text-[var(--text-muted)]">
                        {t('menu.noNotifications')}
                      </div>
                    ) : (
                      <>
                        {activeReminders.map((mtg) => (
                          <button
                            key={mtg.id}
                            type="button"
                            onClick={() => {
                              setSelectedMeetingId(mtg.id);
                              setActiveView('meetings');
                              setNotifPopoverOpen(false);
                            }}
                            className="w-full text-left px-4 py-3 hover:bg-[var(--surface-2)] transition-colors flex items-start gap-2.5 cursor-pointer"
                          >
                            <BellRing className="w-4 h-4 text-[var(--warning)] shrink-0 mt-0.5" />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-[var(--text)] truncate">
                                {mtg.title}
                              </p>
                              <p className="text-[11px] text-[var(--text-muted)] mt-0.5 font-mono tabular-nums">
                                {mtg.startTime}–{mtg.endTime}
                                {mtg.location ? ` · ${mtg.location}` : ''}
                              </p>
                            </div>
                          </button>
                        ))}
                        {urgentMaintenanceCount > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setActiveView('assets');
                              setNotifPopoverOpen(false);
                            }}
                            className="w-full text-left px-4 py-3 hover:bg-[var(--surface-2)] transition-colors flex items-start gap-2.5 cursor-pointer"
                          >
                            <Wrench className="w-4 h-4 text-[var(--danger)] shrink-0 mt-0.5" />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-[var(--text)]">
                                {t('menu.urgentMaintenance')}
                              </p>
                              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                                {t('dashboard.kpi.urgentCount', { count: urgentMaintenanceCount })}
                              </p>
                            </div>
                          </button>
                        )}
                        {unreadSpecialNotifs.slice(0, 4).map((sn) => (
                          <button
                            key={sn.id}
                            type="button"
                            onClick={() => {
                              setActiveView('notifications');
                              setNotifPopoverOpen(false);
                            }}
                            className="w-full text-left px-4 py-3 hover:bg-[var(--surface-2)] transition-colors flex items-start gap-2.5 cursor-pointer"
                          >
                            <Bell className="w-4 h-4 text-[var(--accent-text)] shrink-0 mt-0.5" />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-[var(--text)] truncate">
                                {sn.title}
                              </p>
                              <p className="text-[11px] text-[var(--text-muted)] truncate mt-0.5">
                                {sn.recipientName} · {sn.senderName}
                              </p>
                            </div>
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                  <div className="p-2 border-t border-[var(--border)] bg-[var(--surface-2)]/60">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveView('notifications');
                        setNotifPopoverOpen(false);
                      }}
                      className="w-full h-8 px-3 rounded-lg text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] transition-colors cursor-pointer"
                    >
                      {t('menu.openNotificationCenter')}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* User Profile Dropdown */}
            <div ref={profileRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  setProfileMenuOpen((v) => !v);
                  setNotifPopoverOpen(false);
                }}
                aria-label={t('menu.profile')}
                className="inline-flex items-center gap-2 h-9 pl-1.5 pr-2.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--text-muted)] transition-colors cursor-pointer"
              >
                <span className="w-6 h-6 rounded-md bg-[var(--accent)] text-[var(--on-accent)] text-[11px] font-bold flex items-center justify-center shrink-0">
                  {getUserInitials(user.displayName)}
                </span>
                <span className="hidden md:inline text-xs font-semibold text-[var(--text)] max-w-[120px] truncate">
                  {user.displayName}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
              </button>

              {profileMenuOpen && (
                <div className="absolute right-0 mt-2 w-60 rounded-xl bg-[var(--surface)] border border-[var(--border)] shadow-[var(--modal-shadow)] dark:shadow-xl py-1.5 z-50">
                  <div className="px-3.5 py-2.5 border-b border-[var(--border)]">
                    <p className="text-xs font-semibold text-[var(--text)] truncate">
                      {user.displayName}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)] truncate mt-0.5">
                      {translatedRole} · {user.divisionName || t('common.general')}
                    </p>
                  </div>
                  <div className="p-1.5 space-y-0.5">
                    {!isBootstrapAdminEmail(user.email) && (
                      <button
                        type="button"
                        onClick={() => {
                          setProfileMenuOpen(false);
                          setPwError(null);
                          setPwSuccess(null);
                          setPwCurrent('');
                          setPwNext('');
                          setPwConfirm('');
                          setPwModalOpen(true);
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-2 text-xs font-medium text-[var(--text)] hover:bg-[var(--surface-2)] rounded-lg transition-colors cursor-pointer"
                      >
                        <KeyRound className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                        <span>Ganti Kata Sandi</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleSignOut}
                      className="w-full flex items-center gap-2 px-2.5 py-2 text-xs font-medium text-[var(--danger)] hover:bg-[var(--danger-soft)] rounded-lg transition-colors cursor-pointer"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>{t('menu.signOut')}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Active Meeting Reminder Banner (Global across all tabs) */}
        {visibleReminders.length > 0 && (
          <div className="bg-[var(--warning-soft)] border-b border-[var(--warning)]/30 px-4 sm:px-6 py-2.5">
            <div className="max-w-7xl mx-auto space-y-2">
              {visibleReminders.slice(0, 2).map((mtg) => {
                const diffMin = Math.round((mtg.startAtMs - nowMs) / 60_000);
                const timingText =
                  diffMin > 0
                    ? t('banners.startsInMin', { count: diffMin })
                    : diffMin === 0
                      ? t('banners.startsNow')
                      : t('banners.inProgressAgo', { count: Math.abs(diffMin) });
                return (
                  <div
                    key={mtg.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-[var(--text)]"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <BellRing className="w-4 h-4 text-[var(--warning)] shrink-0" />
                      <span className="truncate">
                        <strong>{t('banners.meetingReminderLabel')}</strong> {mtg.title} —{' '}
                        {timingText} (
                        <span className="font-mono tabular-nums">
                          {mtg.startTime}–{mtg.endTime}
                        </span>
                        {mtg.location ? ` · ${mtg.location}` : ''})
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedMeetingId(mtg.id);
                          setActiveView('meetings');
                        }}
                        className="h-7 px-3 text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] rounded-md transition-colors whitespace-nowrap cursor-pointer"
                      >
                        {t('banners.openMeeting')}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setDismissedReminderIds((prev) => [...prev, mtg.id])
                        }
                        className="text-[var(--text-muted)] hover:text-[var(--text)] font-medium cursor-pointer"
                      >
                        {t('common.close')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Initial Empty Workspace Bootstrap Banner for Super Admin */}
        {!dataLoading && divisions.length === 0 && user.role === 'Super Admin' && (
          <div className="bg-[var(--surface)] border-b border-[var(--border)] px-4 sm:px-6 py-3">
            <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-[var(--text-muted)]">
                <strong className="text-[var(--text)]">{t('banners.newWorkspaceTitle')}</strong>{' '}
                {t('banners.newWorkspaceDesc')}
              </div>
              <button
                type="button"
                disabled={Boolean(seedingLabel)}
                onClick={handleSeedDemo}
                className="inline-flex items-center gap-2 h-9 px-4 text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] disabled:opacity-60 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
              >
                {seedingLabel ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Database className="w-3.5 h-3.5" />
                )}
                <span>{seedingLabel || t('banners.seedInitialSop')}</span>
              </button>
            </div>
          </div>
        )}

        {seedError && (
          <div className="bg-[var(--danger-soft)] border-b border-[var(--danger)]/30 px-4 sm:px-6 py-2.5 text-xs text-[var(--danger)] flex items-center justify-between gap-3">
            <span>
              {t('common.dataIssue')}: {seedError}
            </span>
            <button
              type="button"
              onClick={() => setSeedError(null)}
              className="font-semibold hover:underline cursor-pointer shrink-0"
            >
              {t('common.close')}
            </button>
          </div>
        )}

        {/* Main Content Area */}
        <main className="flex-1 min-w-0">
          {!isActiveViewPermitted ? (
            <AccessDeniedView
              menuLabel={activePageLabel}
              roleCode={rbacSession?.role.code}
              roleName={rbacSession?.role.name}
              onGoHome={() => setActiveView(pickFirstPermittedView(rbacPerms))}
            />
          ) : (
            <>
              {activeView === 'chat' && (
                <ChatQaView
                  key={user.rbacUserId || user.uid}
                  user={user}
                  idToken={idToken}
                  divisions={divisions}
                  directory={directory}
                  sops={sops}
                  pinnedCharts={pinnedCharts}
                  onPinChart={async (payload: CreatePinnedChartInput) => {
                    const saved = await createPinnedChart(user, {
                      ...payload,
                      displayOrder: pinnedCharts.length,
                    });
                    setPinnedCharts((prev) =>
                      sortPinnedCharts([saved, ...prev.filter((c) => c.id !== saved.id)])
                    );
                  }}
                  onOpenDashboard={() => setActiveView('dashboard')}
                  onOpenSopCitation={handleOpenSopCitation}
                  pendingQuestion={pendingChatQuestion}
                  onConsumePendingQuestion={() => setPendingChatQuestion(null)}
                />
              )}

              {activeView === 'dashboard' && (
                <ExecutiveDashboardView
                  user={user}
                  sops={sops}
                  meetings={meetings}
                  assets={assets}
                  urgentMaintenanceCount={urgentMaintenanceCount}
                  activeRemindersCount={activeReminders.length}
                  pinnedCharts={pinnedCharts}
                  loading={dataLoading}
                  appDark={appDark}
                  pendingSummary={pendingSummary}
                  pendingLoading={pendingLoading}
                  pendingError={pendingError}
                  onSelectPendingRule={handleSelectPendingRule}
                  onRefreshPending={() => void refreshPending(true)}
                  onNavigateView={(view) => setActiveView(view)}
                  onOpenSop={(sop) => {
                    setModalSop(sop);
                    setModalMode('read');
                    setModalHighlightSection(undefined);
                    setModalRevisionContext(null);
                    setModalOpen(true);
                  }}
                  onRefresh={async () => {
                    const fresh = await fetchAccessiblePinnedCharts(user);
                    setPinnedCharts(fresh);
                    void refreshPending(true);
                  }}
                  onUpdatePinned={async (doc: PinnedChartDocument, patch: UpdatePinnedChartInput) => {
                    const updated = await updatePinnedChart(doc, patch);
                    setPinnedCharts((prev) =>
                      sortPinnedCharts(prev.map((c) => (c.id === updated.id ? updated : c)))
                    );
                  }}
                  onDeletePinned={async (chartId: string) => {
                    await deletePinnedChart(chartId);
                    setPinnedCharts((prev) => prev.filter((c) => c.id !== chartId));
                  }}
                  onAskAiQuestion={(question) => {
                    if (question.trim()) {
                      setPendingChatQuestion(question);
                    }
                    setActiveView('chat');
                  }}
                />
              )}

              {activeView === 'repository' && (
                <SopRepositoryView
                  user={user}
                  divisions={divisions}
                  departments={departments}
                  sops={sops}
                  onSelectSop={(sop, mode) => {
                    setModalSop(sop);
                    setModalMode(mode);
                    setModalHighlightSection(undefined);
                    setModalRevisionContext(null);
                    setModalOpen(true);
                  }}
                  onCreateNewSop={() => {
                    setModalSop(null);
                    setModalMode('edit');
                    setModalHighlightSection(undefined);
                    setModalRevisionContext(null);
                    setModalOpen(true);
                  }}
                />
              )}

              {activeView === 'notifications' && (
                <NotificationCenterView
                  user={user}
                  idToken={idToken}
                  divisions={divisions}
                  directory={directory}
                  sops={sops}
                  meetings={meetings}
                  schedules={maintenanceSchedules}
                  notifications={notifications}
                  onNotificationsChange={setNotifications}
                  initialDraft={pendingReminderDraft}
                  onClearInitialDraft={() => setPendingReminderDraft(null)}
                  onNavigateSource={handleNavigateNotificationSource}
                />
              )}

              {activeView === 'meetings' && (
                <MeetingView
                  user={user}
                  divisions={divisions}
                  directory={directory}
                  meetings={meetings}
                  initialSelectedMeetingId={selectedMeetingId}
                  onClearInitialSelection={() => setSelectedMeetingId(null)}
                  onMeetingsChange={setMeetings}
                  onConvertMinutesToSop={(notes, titleHint, meetingId) => {
                    setAiPrefill({ notes, titleHint, meetingId });
                    setActiveView('ai-studio');
                  }}
                  onOpenLinkedSop={(sopId) => {
                    void handleOpenSopCitation(sopId);
                  }}
                  browserNotifPermission={browserNotifPermission}
                  onRequestBrowserNotif={handleRequestBrowserNotif}
                  onSendReminder={handleTriggerReminderDraft}
                />
              )}

              {activeView === 'assets' && (
                <AssetMaintenanceView
                  user={user}
                  idToken={idToken}
                  divisions={divisions}
                  directory={directory}
                  assets={assets}
                  schedules={maintenanceSchedules}
                  loading={dataLoading}
                  onAssetsChange={setAssets}
                  onSchedulesChange={setMaintenanceSchedules}
                  onAskAiQuestion={(question) => {
                    setPendingChatQuestion(question);
                    setActiveView('chat');
                  }}
                  onSendReminder={handleTriggerReminderDraft}
                />
              )}

              {activeView === 'erp-stock' && (
                <ErpStockView
                  idToken={idToken}
                  user={user}
                  directory={directory}
                  activeModuleExternal={activeErpModule}
                  onActiveModuleChange={setActiveErpModule}
                  pendingSummary={pendingSummary}
                  pendingNavTarget={pendingErpNavTarget}
                  onClearPendingNav={() => setPendingErpNavTarget(null)}
                  rbacPermissions={rbacPerms}
                  pinnedCharts={pinnedCharts}
                  onPinChart={async (payload: CreatePinnedChartInput) => {
                    const saved = await createPinnedChart(user, {
                      ...payload,
                      displayOrder: pinnedCharts.length,
                    });
                    setPinnedCharts((prev) =>
                      sortPinnedCharts([saved, ...prev.filter((c) => c.id !== saved.id)])
                    );
                  }}
                  onOpenDashboard={() => setActiveView('dashboard')}
                  onAskAiQuestion={(question) => {
                    setPendingChatQuestion(question);
                    setActiveView('chat');
                  }}
                />
              )}

              {activeView === 'ai-studio' && canWrite && (
                <AiStudioView
                  user={user}
                  idToken={idToken}
                  divisions={divisions}
                  departments={departments}
                  directory={directory}
                  sops={sops}
                  prefillNotes={aiPrefill}
                  onClearPrefill={() => setAiPrefill(null)}
                  onSopCreated={(saved) => {
                    setSops((prev) => [saved, ...prev.filter((s) => s.id !== saved.id)]);
                  }}
                  onMeetingSopLinked={(meetingId, saved) => {
                    setMeetings((prev) =>
                      prev.map((m) =>
                        m.id === meetingId
                          ? {
                              ...m,
                              linkedSopId: saved.id,
                              linkedSopDocNumber: saved.docNumber,
                              linkedSopTitle: saved.title,
                            }
                          : m
                      )
                    );
                  }}
                  onOrgUpdated={() => loadWorkspaceData(user)}
                />
              )}

              {activeView === 'user-login' && canManageUsers && (
                <UserLoginManagementView
                  idToken={idToken}
                  currentUserId={rbacSession?.user.id}
                  permissions={rbacPerms}
                  divisions={divisions}
                  onNavigateUserRole={() => setActiveView('user-role')}
                  onUsersMutated={async () => {
                    await refreshRbacProfile();
                    void refreshPending(true);
                  }}
                />
              )}

              {activeView === 'user-role' && canManageRoles && (
                <UserRoleManagementView
                  idToken={idToken}
                  permissions={rbacPerms}
                  onNavigateUserLogin={() => setActiveView('user-login')}
                  onPermissionsMutated={async () => {
                    await refreshRbacProfile();
                    void refreshPending(true);
                  }}
                />
              )}

              {activeView === 'admin' && isAdmin && (
                <AdminDashboardView
                  user={user}
                  idToken={idToken}
                  divisions={divisions}
                  departments={departments}
                  directory={directory}
                  sops={sops}
                  seedingLabel={seedingLabel}
                  onSeedDemo={handleSeedDemo}
                  onOpenSop={(sop) => {
                    setModalSop(sop);
                    setModalMode('read');
                    setModalHighlightSection(undefined);
                    setModalRevisionContext(null);
                    setModalOpen(true);
                  }}
                  onDraftFromQuestion={(notes, titleHint, logIds) => {
                    setAiPrefill({ notes, titleHint, logIds });
                    setActiveView('ai-studio');
                  }}
                  onReviseSopFromFeedback={(sopDoc, feedbackLogs) => {
                    setModalSop(sopDoc);
                    setModalMode('edit');
                    setModalHighlightSection(undefined);
                    setModalRevisionContext({ feedbackLogs });
                    setModalOpen(true);
                  }}
                  onOrgUpdated={() => loadWorkspaceData(user)}
                  refreshTick={adminRefreshTick}
                />
              )}
            </>
          )}
        </main>
      </div>

      {pendingToastVisible && pendingSummary && pendingSummary.totalCount > 0 && (
        <PendingSummaryToast
          totalCount={pendingSummary.totalCount}
          highestUrgency={pendingSummary.highestUrgency}
          onViewDashboard={() => {
            setActiveView('dashboard');
            setPendingToastVisible(false);
          }}
          onDismiss={() => setPendingToastVisible(false)}
        />
      )}

      {modalOpen && (
        <SopDetailModal
          sop={modalSop}
          initialMode={modalMode}
          highlightSection={modalHighlightSection}
          user={user}
          idToken={idToken}
          divisions={divisions}
          departments={departments}
          directory={directory}
          allSops={sops}
          revisionContext={modalRevisionContext}
          onFeedbackLogsResolved={() => {
            setModalRevisionContext(null);
            setAdminRefreshTick((n) => n + 1);
          }}
          onClose={() => {
            setModalOpen(false);
            setModalRevisionContext(null);
          }}
          onSaved={(saved) => {
            setSops((prev) => [saved, ...prev.filter((s) => s.id !== saved.id)]);
            setAdminRefreshTick((n) => n + 1);
          }}
          onDeleted={(sopId) => {
            setSops((prev) => prev.filter((s) => s.id !== sopId));
          }}
          onOrgUpdated={() => loadWorkspaceData(user)}
        />
      )}

      {pwModalOpen && !isBootstrapAdminEmail(user.email) && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Ganti Kata Sandi"
        >
          <div className="w-full max-w-sm rounded-xl bg-[var(--surface)] border border-[var(--border)] shadow-[var(--modal-shadow)] overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-[var(--accent-text)]" />
                <h2 className="font-display text-sm font-semibold text-[var(--text)]">
                  Ganti Kata Sandi
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setPwModalOpen(false)}
                className="p-1 rounded-md text-[var(--text-muted)] hover:bg-[var(--surface-2)] cursor-pointer"
                aria-label="Tutup dialog"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSubmitOwnPassword} className="p-5 space-y-3.5">
              {pwError && (
                <div className="p-2.5 rounded-lg bg-[var(--danger-soft)] border border-[var(--danger)]/30 text-xs text-[var(--danger)]">
                  {pwError}
                </div>
              )}
              {pwSuccess && (
                <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-700 dark:text-emerald-300">
                  {pwSuccess}
                </div>
              )}
              <div className="space-y-1">
                <label className="block text-xs font-medium text-[var(--text-muted)]">
                  Kata Sandi Saat Ini
                </label>
                <input
                  type="password"
                  required
                  value={pwCurrent}
                  onChange={(e) => setPwCurrent(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--border-strong)] text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-[var(--text-muted)]">
                  Kata Sandi Baru (min. 6 karakter)
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={pwNext}
                  onChange={(e) => setPwNext(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--border-strong)] text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-[var(--text-muted)]">
                  Ulangi Kata Sandi Baru
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={pwConfirm}
                  onChange={(e) => setPwConfirm(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-[var(--input-bg)] border border-[var(--border-strong)] text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPwModalOpen(false)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg text-[var(--text-muted)] hover:bg-[var(--surface-2)] cursor-pointer"
                >
                  Tutup
                </button>
                <button
                  type="submit"
                  disabled={pwSaving || !pwCurrent || pwNext.length < 6 || !pwConfirm}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 cursor-pointer"
                >
                  {pwSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Simpan Kata Sandi</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <ThemeProvider>
        <ErrorBoundary>
          <SopBrainApp />
        </ErrorBoundary>
      </ThemeProvider>
    </I18nProvider>
  );
}
