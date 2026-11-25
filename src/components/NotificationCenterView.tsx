import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BellRing,
  BookOpen,
  Calendar,
  Check,
  CheckCheck,
  CheckCircle2,
  Clock,
  Database,
  Download,
  Edit3,
  ExternalLink,
  Info,
  Loader2,
  Mail,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { LOCAL_BRIDGE_SCRIPT } from '../lib/erpBridgeTemplate';
import { useI18n } from '../lib/i18n';
import { DeleteConfirmModal } from './DeleteConfirmModal';
import { TablePaginationBar, useTablePagination } from './TablePaginationBar';
import {
  buildSystemReminderQueue,
  deleteEmployeeContact,
  deleteNotificationRecord,
  fetchEmployeeContacts,
  fetchErpEmployees,
  fetchNotificationChannelStatus,
  isValidEmailClient,
  markAllNotificationsRead,
  markNotificationRead,
  normalizePhoneClient,
  resolveEmployeeContact,
  saveNotificationRecords,
  sendMultiChannelNotificationApi,
  upsertEmployeeContact,
  type DispatchNotificationClientResponse,
  type SystemReminderItem,
} from '../lib/notificationService';
import type {
  AssetMaintenanceSchedule,
  DirectoryMember,
  Division,
  EmployeeContactOverride,
  ErpEmployeeRecord,
  ErpEmployeesQueryResult,
  MeetingDocument,
  NotificationCategory,
  NotificationChannel,
  NotificationChannelDeliveryStatus,
  NotificationChannelStatus,
  NotificationPriority,
  NotificationRecord,
  NotificationSourceType,
  ReminderComposeDraft,
  SopDocument,
  UserProfile,
} from '../types/sop';

interface NotificationCenterViewProps {
  user: UserProfile;
  idToken: string;
  divisions: Division[];
  directory: DirectoryMember[];
  sops: SopDocument[];
  meetings: MeetingDocument[];
  schedules: AssetMaintenanceSchedule[];
  notifications: NotificationRecord[];
  onNotificationsChange: (next: NotificationRecord[]) => void;
  initialDraft?: ReminderComposeDraft | null;
  onClearInitialDraft?: () => void;
  onNavigateSource?: (sourceType: NotificationSourceType, sourceId: string) => void;
}

type CenterTab = 'queue' | 'inbox' | 'employees' | 'history';

interface EditableRecipient {
  key: string;
  uid: string;
  name: string;
  erpCode: string;
  email: string;
  phone: string;
}

interface MergedEmployeeRow {
  rowKey: string;
  erpContactId: number;
  code: string;
  name: string;
  category: string;
  division: string;
  jobTitle: string;
  email: string;
  phone: string;
  whatsappNormalized: string;
  linkedUid: string;
  notes: string;
  source: 'erp' | 'merged' | 'override';
  overrideId?: string;
  isActive: boolean;
}

function downloadBridgeV6Script(): void {
  const blob = new Blob([LOCAL_BRIDGE_SCRIPT], { type: 'text/javascript;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'erp-mysql-bridge.mjs';
  a.click();
  URL.revokeObjectURL(url);
}

function formatTs(ts: unknown, locale: string): string {
  const sec = (ts as { seconds?: number; _seconds?: number })?.seconds ??
    (ts as { _seconds?: number })?._seconds;
  if (!sec) return '-';
  return new Date(sec * 1000).toLocaleString(locale === 'ja' ? 'ja-JP' : locale === 'en' ? 'en-US' : 'id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function normalizeMatch(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const REQUIRED_ERP_FIELDS = [
  {
    field: 'kkode',
    label: 'Kode / NIK Karyawan',
    required: true,
    example: 'EMP-001',
    purpose: 'Identitas unik karyawan di Master Kontak ERP untuk sinkronisasi & pencocokan PIC.',
  },
  {
    field: 'knama',
    label: 'Nama Lengkap Karyawan',
    required: true,
    example: 'Budi Santoso',
    purpose: 'Dicocokkan otomatis dengan nama PIC Aset Maintenance, peserta Meeting, & SOP Owner.',
  },
  {
    field: 'kkategori / kjenis',
    label: 'Kategori = K (Karyawan)',
    required: true,
    example: 'K',
    purpose: 'Menyaring khusus kontak berkategori K (Karyawan) pada Master Kontak ERP.',
  },
  {
    field: 'kemail',
    label: 'Email Aktif Karyawan',
    required: true,
    example: 'budi.santoso@perusahaan.co.id',
    purpose: 'Alamat tujuan pengiriman pengingat otomatis via Email (SMTP / Resend).',
  },
  {
    field: 'khp / ktelp',
    label: 'No. HP / WhatsApp Aktif',
    required: true,
    example: '081234567890 atau 6281234567890',
    purpose: 'Nomor tujuan pengiriman pengingat via WhatsApp (otomatis dinormalisasi ke 62...).',
  },
  {
    field: 'kaktif',
    label: 'Status Aktif (1 = Aktif, 0 = Nonaktif)',
    required: true,
    example: '1',
    purpose: 'Memastikan karyawan yang sudah resign/nonaktif tidak ikut menerima notifikasi.',
  },
  {
    field: 'kdivisi / kjabatan',
    label: 'Divisi & Jabatan (Opsional, Disarankan)',
    required: false,
    example: 'GA & Maintenance / Staff Teknisi',
    purpose: 'Memudahkan pencarian PIC dan pengelompokan notifikasi lintas divisi.',
  },
];

export const NotificationCenterView: React.FC<NotificationCenterViewProps> = ({
  user,
  idToken,
  divisions,
  directory,
  sops,
  meetings,
  schedules,
  notifications,
  onNotificationsChange,
  initialDraft,
  onClearInitialDraft,
  onNavigateSource,
}) => {
  const { t, locale } = useI18n();
  const isAdmin = user.role === 'Super Admin' || user.role === 'Admin Divisi';

  const [activeTab, setActiveTab] = useState<CenterTab>('queue');
  const [categoryFilter, setCategoryFilter] = useState<'all' | NotificationCategory>('all');
  const [queueSearch, setQueueSearch] = useState('');
  const [inboxUnreadOnly, setInboxUnreadOnly] = useState(false);
  const [confirmDeleteNotif, setConfirmDeleteNotif] = useState<NotificationRecord | null>(null);
  const [confirmDeleteContact, setConfirmDeleteContact] = useState<{
    id: string;
    name: string;
    email?: string;
    phone?: string;
  } | null>(null);

  // ERP m1_contact Employee Master state (khusus kategori K)
  const [erpResult, setErpResult] = useState<ErpEmployeesQueryResult | null>(null);
  const [erpLoading, setErpLoading] = useState(false);
  const [erpError, setErpError] = useState<string | null>(null);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [showMasterGuide, setShowMasterGuide] = useState(true);

  // Firestore supplementary contact overrides
  const [contactOverrides, setContactOverrides] = useState<EmployeeContactOverride[]>([]);
  const [overridesLoading, setOverridesLoading] = useState(false);

  // Gateway readiness state
  const [gatewayStatus, setGatewayStatus] = useState<NotificationChannelStatus | null>(null);

  // Compose & Dispatch Modal state
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeCategory, setComposeCategory] = useState<NotificationCategory>('general');
  const [composePriority, setComposePriority] = useState<NotificationPriority>('normal');
  const [composeSourceType, setComposeSourceType] = useState<NotificationSourceType>('MANUAL');
  const [composeSourceId, setComposeSourceId] = useState('');
  const [composeSourceLabel, setComposeSourceLabel] = useState('');
  const [composeDueDate, setComposeDueDate] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeMessage, setComposeMessage] = useState('');
  const [channelInApp, setChannelInApp] = useState(true);
  const [channelEmail, setChannelEmail] = useState(true);
  const [channelWhatsapp, setChannelWhatsapp] = useState(true);
  const [composeRecipients, setComposeRecipients] = useState<EditableRecipient[]>([]);
  const [recipientPickerValue, setRecipientPickerValue] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [dispatchResponse, setDispatchResponse] =
    useState<DispatchNotificationClientResponse | null>(null);

  // Edit/Add Employee Contact Override Modal state
  const [editContactOpen, setEditContactOpen] = useState(false);
  const [editContactSaving, setEditContactSaving] = useState(false);
  const [editContactError, setEditContactError] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    id: '',
    erpContactId: 0,
    erpContactCode: '',
    employeeName: '',
    linkedUid: '',
    divisionId: user.divisionId || '',
    divisionName: user.divisionName || '',
    jobTitle: '',
    email: '',
    whatsappPhone: '',
    notes: '',
  });

  const [busyActionId, setBusyActionId] = useState<string | null>(null);

  const loadErpEmployeesData = useCallback(
    async (refresh = false) => {
      if (!idToken) return;
      setErpLoading(true);
      setErpError(null);
      try {
        const res = await fetchErpEmployees(idToken, {
          onlyActive: true,
          includeAll: false,
          refresh,
          limit: 500,
        });
        setErpResult(res);
      } catch (err) {
        setErpError(
          err instanceof Error
            ? err.message
            : 'Gagal memuat data master karyawan dari ERP.'
        );
      } finally {
        setErpLoading(false);
      }
    },
    [idToken]
  );

  const loadOverridesAndGateway = useCallback(async () => {
    setOverridesLoading(true);
    try {
      const [ovList, gw] = await Promise.all([
        fetchEmployeeContacts(user).catch(() => [] as EmployeeContactOverride[]),
        idToken ? fetchNotificationChannelStatus(idToken).catch(() => null) : Promise.resolve(null),
      ]);
      setContactOverrides(ovList);
      if (gw) setGatewayStatus(gw);
    } finally {
      setOverridesLoading(false);
    }
  }, [idToken, user]);

  useEffect(() => {
    void loadOverridesAndGateway();
    void loadErpEmployeesData(false);
  }, [loadErpEmployeesData, loadOverridesAndGateway]);

  const erpEmployees: ErpEmployeeRecord[] = useMemo(
    () =>
      (erpResult?.employees || []).filter(
        (emp) => String(emp.category || '').trim().toUpperCase() === 'K'
      ),
    [erpResult]
  );

  // Merge ERP m1_contact Employee records + Firestore Contact Overrides into one clean directory
  const mergedEmployees = useMemo<MergedEmployeeRow[]>(() => {
    const rows: MergedEmployeeRow[] = [];
    const usedOverrideIds = new Set<string>();

    for (const emp of erpEmployees) {
      const ov =
        contactOverrides.find((o) => o.erpContactId > 0 && o.erpContactId === emp.id) ||
        contactOverrides.find(
          (o) => o.erpContactCode && o.erpContactCode.toLowerCase() === emp.code.toLowerCase()
        ) ||
        contactOverrides.find((o) => normalizeMatch(o.employeeName) === normalizeMatch(emp.name)) ||
        null;
      if (ov) usedOverrideIds.add(ov.id);

      const finalEmail = (ov?.email || emp.email || '').trim();
      const finalPhone = (ov?.whatsappPhone || emp.phone || emp.secondaryPhone || '').trim();
      const waNorm = normalizePhoneClient(finalPhone) || emp.whatsappNormalized || '';

      rows.push({
        rowKey: `erp_${emp.id || emp.code}_${emp.name}`,
        erpContactId: emp.id,
        code: emp.code,
        name: emp.name,
        category: emp.category || 'Employee',
        division: ov?.divisionName || emp.division || '',
        jobTitle: ov?.jobTitle || emp.jobTitle || '',
        email: finalEmail,
        phone: finalPhone,
        whatsappNormalized: waNorm,
        linkedUid: ov?.linkedUid || '',
        notes: ov?.notes || '',
        source: ov ? 'merged' : 'erp',
        overrideId: ov?.id,
        isActive: emp.isActive,
      });
    }

    for (const ov of contactOverrides) {
      if (usedOverrideIds.has(ov.id)) continue;
      rows.push({
        rowKey: `ov_${ov.id}`,
        erpContactId: ov.erpContactId,
        code: ov.erpContactCode || '-',
        name: ov.employeeName,
        category: 'Employee',
        division: ov.divisionName || '',
        jobTitle: ov.jobTitle || '',
        email: ov.email || '',
        phone: ov.whatsappPhone || '',
        whatsappNormalized: normalizePhoneClient(ov.whatsappPhone || ''),
        linkedUid: ov.linkedUid || '',
        notes: ov.notes || '',
        source: 'override',
        overrideId: ov.id,
        isActive: true,
      });
    }

    return rows.sort((a, b) => a.name.localeCompare(b.name, 'id'));
  }, [contactOverrides, erpEmployees]);

  const filteredEmployees = useMemo(() => {
    const q = employeeSearch.trim().toLowerCase();
    if (!q) return mergedEmployees;
    return mergedEmployees.filter((r) => {
      const hay = [r.code, r.name, r.category, r.division, r.jobTitle, r.email, r.phone]
        .join(' ')
        .toLowerCase();
      return q
        .split(/\s+/)
        .filter(Boolean)
        .every((tok) => hay.includes(tok));
    });
  }, [employeeSearch, mergedEmployees]);

  const employeeStats = useMemo(() => {
    const total = mergedEmployees.length;
    const withEmail = mergedEmployees.filter((e) => isValidEmailClient(e.email)).length;
    const withWa = mergedEmployees.filter((e) => Boolean(e.whatsappNormalized)).length;
    const withBoth = mergedEmployees.filter(
      (e) => isValidEmailClient(e.email) && Boolean(e.whatsappNormalized)
    ).length;
    return { total, withEmail, withWa, withBoth };
  }, [mergedEmployees]);

  // Unified automated reminder queue across Maintenance, Meetings, and SOP Review
  const reminderQueue = useMemo(
    () =>
      buildSystemReminderQueue({
        schedules,
        meetings,
        sops,
        erpEmployees,
        overrides: contactOverrides,
        directory,
      }),
    [contactOverrides, directory, erpEmployees, meetings, schedules, sops]
  );

  const filteredQueue = useMemo(() => {
    const q = queueSearch.trim().toLowerCase();
    return reminderQueue.filter((item) => {
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;
      if (!q) return true;
      const hay = [
        item.title,
        item.subtitle,
        item.sourceLabel,
        ...item.recipients.map((r) => `${r.name} ${r.email} ${r.phone} ${r.erpCode}`),
      ]
        .join(' ')
        .toLowerCase();
      return q
        .split(/\s+/)
        .filter(Boolean)
        .every((tok) => hay.includes(tok));
    });
  }, [categoryFilter, queueSearch, reminderQueue]);

  // Special In-App Inbox (notifications addressed to current user or where user is in viewerUids)
  const myInboxNotifications = useMemo(() => {
    return notifications.filter((n) => {
      const isMine =
        n.recipientUid === user.uid ||
        (!n.recipientUid &&
          normalizeMatch(n.recipientName) === normalizeMatch(user.displayName)) ||
        (n.channels.includes('in_app') && n.viewerUids.includes(user.uid));
      if (!isMine) return false;
      if (inboxUnreadOnly && n.inAppRead) return false;
      return true;
    });
  }, [inboxUnreadOnly, notifications, user.displayName, user.uid]);

  const unreadInboxCount = useMemo(
    () =>
      notifications.filter(
        (n) =>
          !n.inAppRead &&
          (n.recipientUid === user.uid ||
            (!n.recipientUid &&
              normalizeMatch(n.recipientName) === normalizeMatch(user.displayName)) ||
            n.viewerUids.includes(user.uid))
      ).length,
    [notifications, user.displayName, user.uid]
  );

  const inboxPaging = useTablePagination(myInboxNotifications, {
    defaultPageSize: 15,
    storageKey: 'notif_inbox',
  });
  const employeesPaging = useTablePagination(filteredEmployees, {
    defaultPageSize: 20,
    storageKey: 'notif_employees',
  });
  const historyPaging = useTablePagination(notifications, {
    defaultPageSize: 20,
    storageKey: 'notif_history',
  });

  const openComposeFromDraft = useCallback(
    (draft: ReminderComposeDraft) => {
      setComposeCategory(draft.category);
      setComposePriority(draft.priority);
      setComposeSourceType(draft.sourceType);
      setComposeSourceId(draft.sourceId);
      setComposeSourceLabel(draft.sourceLabel);
      setComposeDueDate(draft.dueDate);
      setComposeSubject(draft.title);
      setComposeMessage(draft.message);
      setChannelInApp(true);
      setChannelEmail(true);
      setChannelWhatsapp(true);
      setSendError(null);
      setDispatchResponse(null);

      const resolvedList: EditableRecipient[] = draft.recipients.map((rec, idx) => {
        const matched = resolveEmployeeContact(
          { uid: rec.uid, name: rec.name, erpCode: rec.erpCode },
          erpEmployees,
          contactOverrides,
          directory
        );
        return {
          key: `rec_${idx}_${matched.uid || matched.erpCode || matched.name}`,
          uid: matched.uid || rec.uid || '',
          name: matched.name || rec.name,
          erpCode: matched.erpCode || rec.erpCode || '',
          email: rec.email || matched.email || '',
          phone: rec.phone || matched.phone || '',
        };
      });
      setComposeRecipients(resolvedList);
      setComposeOpen(true);
    },
    [contactOverrides, directory, erpEmployees]
  );

  // Consume external quick-send trigger from AssetMaintenanceView or MeetingView
  useEffect(() => {
    if (!initialDraft) return;
    openComposeFromDraft(initialDraft);
    onClearInitialDraft?.();
  }, [initialDraft, onClearInitialDraft, openComposeFromDraft]);

  const openComposeFromReminderItem = (item: SystemReminderItem) => {
    openComposeFromDraft({
      category: item.category,
      priority: item.priority,
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      sourceLabel: item.sourceLabel,
      dueDate: item.dueDate,
      title: item.title,
      message: item.defaultMessage,
      recipients: item.recipients.map((r) => ({
        uid: r.uid,
        name: r.name,
        email: r.email,
        phone: r.phone,
        erpCode: r.erpCode,
      })),
    });
  };

  const openManualCompose = () => {
    openComposeFromDraft({
      category: 'general',
      priority: 'normal',
      sourceType: 'MANUAL',
      sourceId: '',
      sourceLabel: 'Notifikasi Khusus',
      dueDate: '',
      title: '',
      message: '',
      recipients: [],
    });
  };

  const handleAddRecipientFromPicker = (rowKey: string) => {
    if (!rowKey) return;
    if (rowKey.startsWith('dir_')) {
      const uid = rowKey.slice(4);
      const dm = directory.find((d) => d.uid === uid);
      if (!dm) return;
      const matched = resolveEmployeeContact(
        { uid: dm.uid, name: dm.displayName },
        erpEmployees,
        contactOverrides,
        directory
      );
      if (composeRecipients.some((r) => r.uid === dm.uid && dm.uid)) return;
      setComposeRecipients((prev) => [
        ...prev,
        {
          key: `pick_dir_${dm.uid}_${Date.now()}`,
          uid: dm.uid,
          name: dm.displayName,
          erpCode: matched.erpCode,
          email: matched.email,
          phone: matched.phone,
        },
      ]);
      setRecipientPickerValue('');
      return;
    }

    const emp = mergedEmployees.find((e) => e.rowKey === rowKey);
    if (!emp) return;
    if (
      composeRecipients.some(
        (r) =>
          (emp.code && emp.code !== '-' && r.erpCode === emp.code) ||
          normalizeMatch(r.name) === normalizeMatch(emp.name)
      )
    ) {
      setRecipientPickerValue('');
      return;
    }
    setComposeRecipients((prev) => [
      ...prev,
      {
        key: `pick_emp_${emp.rowKey}_${Date.now()}`,
        uid: emp.linkedUid,
        name: emp.name,
        erpCode: emp.code === '-' ? '' : emp.code,
        email: emp.email,
        phone: emp.phone,
      },
    ]);
    setRecipientPickerValue('');
  };

  const handleSendNotifications = async () => {
    setSendError(null);
    if (!composeSubject.trim() || !composeMessage.trim()) {
      setSendError('Judul dan isi pesan pengingat wajib diisi.');
      return;
    }
    if (composeRecipients.length === 0) {
      setSendError('Tambahkan minimal satu penerima (PIC / karyawan).');
      return;
    }
    if (!channelInApp && !channelEmail && !channelWhatsapp) {
      setSendError('Pilih minimal satu kanal pengiriman (In-App, Email, atau WhatsApp).');
      return;
    }

    setSending(true);
    try {
      let apiRes: DispatchNotificationClientResponse | null = null;
      if (channelEmail || channelWhatsapp) {
        apiRes = await sendMultiChannelNotificationApi(idToken, {
          category: composeCategory,
          priority: composePriority,
          subject: composeSubject.trim(),
          message: composeMessage.trim(),
          channels: {
            email: channelEmail,
            whatsapp: channelWhatsapp,
          },
          recipients: composeRecipients.map((r) => ({
            uid: r.uid,
            name: r.name,
            email: r.email.trim(),
            phone: r.phone.trim(),
            erpCode: r.erpCode,
          })),
          senderName: user.displayName,
        });
        setDispatchResponse(apiRes);
        setGatewayStatus(apiRes.gatewayStatus);
      }

      const selectedChannels: NotificationChannel[] = [];
      if (channelInApp) selectedChannels.push('in_app');
      if (channelEmail) selectedChannels.push('email');
      if (channelWhatsapp) selectedChannels.push('whatsapp');

      const recordsToSave = composeRecipients.map((rec, idx) => {
        const resRow = apiRes?.results[idx];
        const notes: string[] = [];
        if (channelInApp) notes.push('Notifikasi Khusus In-App tersimpan.');
        if (resRow?.emailDetail) notes.push(`Email: ${resRow.emailDetail}`);
        if (resRow?.whatsappDetail) notes.push(`WA: ${resRow.whatsappDetail}`);

        return {
          category: composeCategory,
          priority: composePriority,
          title: composeSubject.trim(),
          message: composeMessage.trim(),
          sourceType: composeSourceType,
          sourceId: composeSourceId,
          sourceLabel: composeSourceLabel,
          dueDate: composeDueDate,
          recipientUid: rec.uid,
          recipientName: rec.name,
          recipientEmail: rec.email.trim(),
          recipientPhone: normalizePhoneClient(rec.phone.trim()) || rec.phone.trim(),
          recipientErpCode: rec.erpCode,
          divisionId: user.divisionId || '',
          channels: selectedChannels,
          emailStatus: (resRow?.emailStatus || 'not_requested') as NotificationChannelDeliveryStatus,
          whatsappStatus: (resRow?.whatsappStatus ||
            'not_requested') as NotificationChannelDeliveryStatus,
          deliveryNote: notes.join(' | ').slice(0, 500),
        };
      });

      const saved = await saveNotificationRecords(user, directory, recordsToSave);
      onNotificationsChange([...saved, ...notifications]);

      if (!channelEmail && !channelWhatsapp) {
        setComposeOpen(false);
      }
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Gagal mengirim notifikasi.');
    } finally {
      setSending(false);
    }
  };

  const openEditEmployeeContact = (row?: MergedEmployeeRow) => {
    setEditContactError(null);
    if (row) {
      const matchedDiv = divisions.find(
        (d) => normalizeMatch(d.name) === normalizeMatch(row.division)
      );
      setEditForm({
        id: row.overrideId || (row.erpContactId > 0 ? `erp_emp_${row.erpContactId}` : ''),
        erpContactId: row.erpContactId,
        erpContactCode: row.code === '-' ? '' : row.code,
        employeeName: row.name,
        linkedUid: row.linkedUid,
        divisionId: matchedDiv?.id || user.divisionId || '',
        divisionName: row.division || matchedDiv?.name || '',
        jobTitle: row.jobTitle || '',
        email: row.email || '',
        whatsappPhone: row.phone || '',
        notes: row.notes || '',
      });
    } else {
      setEditForm({
        id: '',
        erpContactId: 0,
        erpContactCode: '',
        employeeName: '',
        linkedUid: '',
        divisionId: user.divisionId || '',
        divisionName: user.divisionName || '',
        jobTitle: '',
        email: '',
        whatsappPhone: '',
        notes: '',
      });
    }
    setEditContactOpen(true);
  };

  const handleSaveEmployeeContact = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditContactError(null);
    if (!editForm.employeeName.trim()) {
      setEditContactError('Nama karyawan wajib diisi.');
      return;
    }
    if (editForm.email.trim() && !isValidEmailClient(editForm.email.trim())) {
      setEditContactError('Format email tidak valid.');
      return;
    }
    if (editForm.whatsappPhone.trim() && !normalizePhoneClient(editForm.whatsappPhone.trim())) {
      setEditContactError('Format nomor HP/WhatsApp tidak valid (gunakan 08... atau 628...).');
      return;
    }

    setEditContactSaving(true);
    try {
      const saved = await upsertEmployeeContact(user, directory, {
        id: editForm.id || undefined,
        erpContactId: editForm.erpContactId,
        erpContactCode: editForm.erpContactCode,
        employeeName: editForm.employeeName.trim(),
        linkedUid: editForm.linkedUid,
        divisionId: editForm.divisionId,
        divisionName: editForm.divisionName,
        jobTitle: editForm.jobTitle,
        email: editForm.email.trim(),
        whatsappPhone: editForm.whatsappPhone.trim(),
        notes: editForm.notes.trim(),
      });
      setContactOverrides((prev) => [saved, ...prev.filter((o) => o.id !== saved.id)]);
      setEditContactOpen(false);
    } catch (err) {
      setEditContactError(
        err instanceof Error ? err.message : 'Gagal menyimpan kontak pelengkap karyawan.'
      );
    } finally {
      setEditContactSaving(false);
    }
  };

  const handleDeleteOverride = async (overrideId: string) => {
    setBusyActionId(overrideId);
    try {
      await deleteEmployeeContact(overrideId);
      setContactOverrides((prev) => prev.filter((o) => o.id !== overrideId));
    } finally {
      setBusyActionId(null);
      setConfirmDeleteContact(null);
    }
  };

  const handleMarkOneRead = async (notif: NotificationRecord) => {
    setBusyActionId(notif.id);
    try {
      await markNotificationRead(notif.id, true);
      onNotificationsChange(
        notifications.map((n) => (n.id === notif.id ? { ...n, inAppRead: true } : n))
      );
    } finally {
      setBusyActionId(null);
    }
  };

  const handleMarkAllRead = async () => {
    const unread = myInboxNotifications.filter((n) => !n.inAppRead);
    if (unread.length === 0) return;
    setBusyActionId('mark_all');
    try {
      await markAllNotificationsRead(unread);
      const unreadIds = new Set(unread.map((u) => u.id));
      onNotificationsChange(
        notifications.map((n) => (unreadIds.has(n.id) ? { ...n, inAppRead: true } : n))
      );
    } finally {
      setBusyActionId(null);
    }
  };

  const handleDeleteNotification = async (notifId: string) => {
    setBusyActionId(notifId);
    try {
      await deleteNotificationRecord(notifId);
      onNotificationsChange(notifications.filter((n) => n.id !== notifId));
    } finally {
      setBusyActionId(null);
      setConfirmDeleteNotif(null);
    }
  };

  const renderCategoryIcon = (cat: NotificationCategory) => {
    if (cat === 'maintenance') return <Wrench className="w-4 h-4" />;
    if (cat === 'meeting') return <Calendar className="w-4 h-4" />;
    if (cat === 'sop_review') return <BookOpen className="w-4 h-4" />;
    return <Bell className="w-4 h-4" />;
  };

  const renderPriorityBadge = (priority: NotificationPriority) => {
    if (priority === 'urgent') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[var(--danger)]/15 text-[var(--danger)] border border-[var(--danger)]/30">
          <AlertTriangle className="w-3 h-3" />
          {t('notifications.priority.urgent')}
        </span>
      );
    }
    if (priority === 'warning') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[var(--warning)]/15 text-[var(--warning)] border border-[var(--warning)]/30">
          <Clock className="w-3 h-3" />
          {t('notifications.priority.warning')}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[var(--surface-2)] text-[var(--text-muted)] border border-[var(--border)]">
        {t('notifications.priority.normal')}
      </span>
    );
  };

  const renderDeliveryStatusBadge = (
    status: NotificationChannelDeliveryStatus,
    channelLabel: string
  ) => {
    if (status === 'not_requested') return null;
    const toneClass =
      status === 'sent'
        ? 'bg-[var(--success)]/15 text-[var(--success)] border-[var(--success)]/30'
        : status === 'manual_fallback'
          ? 'bg-[var(--warning)]/15 text-[var(--warning)] border-[var(--warning)]/30'
          : 'bg-[var(--danger)]/15 text-[var(--danger)] border-[var(--danger)]/30';
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${toneClass}`}
      >
        {channelLabel}: {t(`notifications.deliveryStatus.${status}`)}
      </span>
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-display text-xl sm:text-2xl font-bold text-[var(--text)] tracking-tight">
              {t('notifications.title')}
            </h1>
          </div>
          <div className="w-10 h-1 rounded-full bg-[var(--accent)] mt-2 mb-2.5" />
          <p className="text-xs sm:text-sm text-[var(--text-muted)] max-w-3xl leading-relaxed">
            {t('notifications.subtitle')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              void loadErpEmployeesData(true);
              void loadOverridesAndGateway();
            }}
            disabled={erpLoading || overridesLoading}
            className="inline-flex items-center gap-2 h-9 px-3.5 rounded-lg text-xs font-semibold bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] hover:border-[var(--text-muted)] transition-colors cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${erpLoading ? 'animate-spin' : ''}`} />
            <span>{t('common.refresh')}</span>
          </button>
          <button
            type="button"
            onClick={openManualCompose}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-lg text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] transition-colors cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{t('notifications.sendManual')}</span>
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-xl bg-[var(--surface)] border border-[var(--border)] p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-muted)]">
              {t('notifications.kpi.activeReminders')}
            </span>
            <BellRing className="w-4 h-4 text-[var(--warning)]" />
          </div>
          <p className="mt-2 font-mono tabular-nums text-2xl font-bold text-[var(--text)]">
            {reminderQueue.length}
          </p>
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">
            {reminderQueue.filter((i) => i.category === 'maintenance').length} Maintenance ·{' '}
            {reminderQueue.filter((i) => i.category === 'meeting').length} Meeting ·{' '}
            {reminderQueue.filter((i) => i.category === 'sop_review').length} SOP
          </p>
        </div>

        <div className="rounded-xl bg-[var(--surface)] border border-[var(--border)] p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-muted)]">
              {t('notifications.kpi.unreadInbox')}
            </span>
            <Bell className="w-4 h-4 text-[var(--accent-text)]" />
          </div>
          <p className="mt-2 font-mono tabular-nums text-2xl font-bold text-[var(--text)]">
            {unreadInboxCount}
          </p>
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">
            Total {notifications.length} log notifikasi tersimpan
          </p>
        </div>

        <div className="rounded-xl bg-[var(--surface)] border border-[var(--border)] p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-muted)]">
              {t('notifications.kpi.erpEmployeesReady')}
            </span>
            <Users className="w-4 h-4 text-[var(--success)]" />
          </div>
          <p className="mt-2 font-mono tabular-nums text-2xl font-bold text-[var(--text)]">
            {employeeStats.withBoth}{' '}
            <span className="text-sm font-normal text-[var(--text-muted)]">
              / {employeeStats.total}
            </span>
          </p>
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">
            Email: {employeeStats.withEmail} · WA: {employeeStats.withWa}
          </p>
        </div>

        <div className="rounded-xl bg-[var(--surface)] border border-[var(--border)] p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-muted)]">
              {t('notifications.kpi.gatewayStatus')}
            </span>
            <ShieldCheck className="w-4 h-4 text-[var(--accent-text)]" />
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${
                gatewayStatus?.emailConfigured
                  ? 'bg-[var(--success)]/15 text-[var(--success)] border-[var(--success)]/30'
                  : 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]'
              }`}
            >
              <Mail className="w-3 h-3" />
              Email:{' '}
              {gatewayStatus?.emailConfigured
                ? gatewayStatus.emailProvider.toUpperCase()
                : 'Tautan'}
            </span>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${
                gatewayStatus?.whatsappConfigured
                  ? 'bg-[var(--success)]/15 text-[var(--success)] border-[var(--success)]/30'
                  : 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]'
              }`}
            >
              <MessageCircle className="w-3 h-3" />
              WA:{' '}
              {gatewayStatus?.whatsappConfigured
                ? gatewayStatus.whatsappProvider.toUpperCase()
                : 'Tautan'}
            </span>
          </div>
          <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
            In-App selalu aktif · Email/WA via server Secrets
          </p>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-[var(--border)] flex items-center gap-1 overflow-x-auto">
        {(
          [
            {
              id: 'queue' as CenterTab,
              label: t('notifications.tabs.queue'),
              count: reminderQueue.length,
              icon: <BellRing className="w-4 h-4" />,
            },
            {
              id: 'inbox' as CenterTab,
              label: t('notifications.tabs.inbox'),
              count: unreadInboxCount,
              icon: <Bell className="w-4 h-4" />,
            },
            {
              id: 'employees' as CenterTab,
              label: t('notifications.tabs.employees'),
              count: employeeStats.total,
              icon: <Database className="w-4 h-4" />,
            },
            {
              id: 'history' as CenterTab,
              label: t('notifications.tabs.history'),
              count: notifications.length,
              icon: <Clock className="w-4 h-4" />,
            },
          ]
        ).map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 px-4 py-3 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors cursor-pointer ${
                isActive
                  ? 'border-[var(--accent)] text-[var(--text)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              <span className={isActive ? 'text-[var(--accent-text)]' : ''}>{tab.icon}</span>
              <span>{tab.label}</span>
              <span className="font-mono tabular-nums text-[11px] px-1.5 py-0.5 rounded bg-[var(--surface-2)] text-[var(--text-muted)]">
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: AUTOMATED REMINDER QUEUE */}
      {activeTab === 'queue' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'all', label: t('notifications.categories.all') },
                  { id: 'maintenance', label: t('notifications.categories.maintenance') },
                  { id: 'meeting', label: t('notifications.categories.meeting') },
                  { id: 'sop_review', label: t('notifications.categories.sop_review') },
                ] as const
              ).map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategoryFilter(cat.id)}
                  className={`h-8 px-3 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                    categoryFilter === cat.id
                      ? 'bg-[var(--accent)] text-[var(--on-accent)] border-[var(--accent)]'
                      : 'bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text)]'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-72">
              <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={queueSearch}
                onChange={(e) => setQueueSearch(e.target.value)}
                placeholder="Cari aset, meeting, SOP, atau nama PIC..."
                className="w-full h-9 pl-8 pr-3 rounded-lg text-xs bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>
          </div>

          {filteredQueue.length === 0 ? (
            <div className="rounded-xl bg-[var(--surface)] border border-[var(--border)] p-10 text-center space-y-2">
              <CheckCircle2 className="w-8 h-8 text-[var(--success)] mx-auto" />
              <p className="text-sm font-semibold text-[var(--text)]">
                {t('notifications.queue.empty')}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredQueue.map((item) => {
                const readyCount = item.recipients.filter(
                  (r) => isValidEmailClient(r.email) && Boolean(r.whatsappNormalized)
                ).length;
                const partialCount = item.recipients.filter(
                  (r) => isValidEmailClient(r.email) || Boolean(r.whatsappNormalized)
                ).length;

                return (
                  <div
                    key={item.key}
                    className="rounded-xl bg-[var(--surface)] border border-[var(--border)] p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:border-[var(--text-muted)]/50 transition-colors"
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div
                        className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${
                          item.priority === 'urgent'
                            ? 'bg-[var(--danger)]/15 text-[var(--danger)] border-[var(--danger)]/30'
                            : item.priority === 'warning'
                              ? 'bg-[var(--warning)]/15 text-[var(--warning)] border-[var(--warning)]/30'
                              : 'bg-[var(--surface-2)] text-[var(--accent-text)] border-[var(--border)]'
                        }`}
                      >
                        {renderCategoryIcon(item.category)}
                      </div>

                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          {renderPriorityBadge(item.priority)}
                          <span className="text-[11px] font-medium text-[var(--text-muted)]">
                            {t(`notifications.categories.${item.category}`)}
                          </span>
                          {item.dueDate && (
                            <span className="font-mono tabular-nums text-[11px] text-[var(--text-muted)]">
                              · {item.dueDate}
                            </span>
                          )}
                        </div>

                        <h3 className="text-sm font-semibold text-[var(--text)] leading-snug">
                          {item.title}
                        </h3>
                        <p className="text-xs text-[var(--text-muted)]">{item.subtitle}</p>

                        {/* Matched Recipients Preview */}
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          {item.recipients.slice(0, 4).map((rec, idx) => {
                            const hasEmail = isValidEmailClient(rec.email);
                            const hasWa = Boolean(rec.whatsappNormalized);
                            return (
                              <span
                                key={`${item.key}_rec_${idx}`}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)]"
                              >
                                <UserCheck className="w-3 h-3 text-[var(--text-muted)]" />
                                <span className="font-medium">{rec.name}</span>
                                {rec.erpCode && (
                                  <span className="font-mono text-[10px] text-[var(--text-muted)]">
                                    ({rec.erpCode})
                                  </span>
                                )}
                                <Mail
                                  className={`w-3 h-3 ${
                                    hasEmail ? 'text-[var(--success)]' : 'text-[var(--text-muted)]/40'
                                  }`}
                                />
                                <MessageCircle
                                  className={`w-3 h-3 ${
                                    hasWa ? 'text-[var(--success)]' : 'text-[var(--text-muted)]/40'
                                  }`}
                                />
                              </span>
                            );
                          })}
                          {item.recipients.length > 4 && (
                            <span className="text-[11px] text-[var(--text-muted)]">
                              +{item.recipients.length - 4} lainnya
                            </span>
                          )}

                          <span
                            className={`text-[11px] font-medium ${
                              readyCount === item.recipients.length
                                ? 'text-[var(--success)]'
                                : partialCount > 0
                                  ? 'text-[var(--warning)]'
                                  : 'text-[var(--danger)]'
                            }`}
                          >
                            {readyCount === item.recipients.length
                              ? t('notifications.queue.recipientReady')
                              : partialCount > 0
                                ? t('notifications.queue.recipientPartial')
                                : t('notifications.queue.recipientMissing')}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 self-end lg:self-center">
                      {onNavigateSource && item.sourceId && (
                        <button
                          type="button"
                          onClick={() => onNavigateSource(item.sourceType, item.sourceId)}
                          className="h-9 px-3 rounded-lg text-xs font-medium bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] hover:border-[var(--text-muted)] transition-colors cursor-pointer"
                        >
                          {t('notifications.queue.openSource')}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openComposeFromReminderItem(item)}
                        className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] transition-colors cursor-pointer"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>{t('notifications.queue.sendReminder')}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: SPECIAL IN-APP INBOX */}
      {activeTab === 'inbox' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setInboxUnreadOnly(false)}
                className={`h-8 px-3 rounded-lg text-xs font-semibold border cursor-pointer ${
                  !inboxUnreadOnly
                    ? 'bg-[var(--accent)] text-[var(--on-accent)] border-[var(--accent)]'
                    : 'bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)]'
                }`}
              >
                {t('common.all')}
              </button>
              <button
                type="button"
                onClick={() => setInboxUnreadOnly(true)}
                className={`h-8 px-3 rounded-lg text-xs font-semibold border cursor-pointer ${
                  inboxUnreadOnly
                    ? 'bg-[var(--accent)] text-[var(--on-accent)] border-[var(--accent)]'
                    : 'bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)]'
                }`}
              >
                {t('notifications.inbox.unreadOnly')} ({unreadInboxCount})
              </button>
            </div>

            {unreadInboxCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                disabled={busyActionId === 'mark_all'}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] hover:border-[var(--text-muted)] cursor-pointer disabled:opacity-60"
              >
                <CheckCheck className="w-3.5 h-3.5 text-[var(--accent-text)]" />
                <span>{t('notifications.inbox.markAllRead')}</span>
              </button>
            )}
          </div>

          {myInboxNotifications.length === 0 ? (
            <div className="rounded-xl bg-[var(--surface)] border border-[var(--border)] p-10 text-center space-y-2">
              <Bell className="w-8 h-8 text-[var(--text-muted)] mx-auto" />
              <p className="text-sm text-[var(--text-muted)]">{t('notifications.inbox.empty')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {inboxPaging.paginatedItems.map((notif) => (
                <div
                  key={notif.id}
                  className={`rounded-xl border p-4 transition-colors ${
                    notif.inAppRead
                      ? 'bg-[var(--surface)] border-[var(--border)]'
                      : 'bg-[var(--surface)] border-[var(--accent)]/60'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {!notif.inAppRead && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-[var(--accent)] text-[var(--on-accent)]">
                            {t('notifications.inbox.unread')}
                          </span>
                        )}
                        {renderPriorityBadge(notif.priority)}
                        <span className="text-[11px] font-medium text-[var(--text-muted)]">
                          {t(`notifications.categories.${notif.category}`)}
                        </span>
                        <span className="font-mono tabular-nums text-[11px] text-[var(--text-muted)]">
                          · {formatTs(notif.createdAt, locale)}
                        </span>
                      </div>

                      <h3 className="text-sm font-semibold text-[var(--text)]">{notif.title}</h3>
                      <p className="text-xs text-[var(--text-muted)] whitespace-pre-line leading-relaxed">
                        {notif.message}
                      </p>

                      <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-[var(--text-muted)]">
                        <span>
                          Penerima: <strong className="text-[var(--text)]">{notif.recipientName}</strong>
                        </span>
                        <span>· Pengirim: {notif.senderName}</span>
                        {renderDeliveryStatusBadge(notif.emailStatus, 'Email')}
                        {renderDeliveryStatusBadge(notif.whatsappStatus, 'WA')}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {!notif.inAppRead && (
                        <button
                          type="button"
                          onClick={() => handleMarkOneRead(notif)}
                          disabled={busyActionId === notif.id}
                          className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg text-xs font-medium bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] hover:border-[var(--accent)] cursor-pointer"
                        >
                          <Check className="w-3.5 h-3.5 text-[var(--success)]" />
                          <span>{t('notifications.inbox.markRead')}</span>
                        </button>
                      )}
                      {onNavigateSource && notif.sourceId && notif.sourceType !== 'MANUAL' && (
                        <button
                          type="button"
                          onClick={() => onNavigateSource(notif.sourceType, notif.sourceId)}
                          className="h-8 px-2.5 rounded-lg text-xs font-medium bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] hover:border-[var(--text-muted)] cursor-pointer"
                        >
                          {t('common.open')}
                        </button>
                      )}
                      {(user.role === 'Super Admin' || notif.senderUid === user.uid) && (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteNotif(notif)}
                          disabled={busyActionId === notif.id}
                          title={t('common.delete')}
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div className="rounded-xl bg-[var(--surface)] border border-[var(--border)] overflow-hidden">
                <TablePaginationBar {...inboxPaging.paginationProps} className="border-t-0" />
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: ERP EMPLOYEE MASTER (m1_contact) + REQUIRED FIELD CHECKLIST */}
      {activeTab === 'employees' && (
        <div className="space-y-5">
          {/* Required ERP Master Fields Checklist Card */}
          <div className="rounded-xl bg-[var(--surface)] border border-[var(--border)] overflow-hidden">
            <div className="px-4 py-3.5 border-b border-[var(--border)] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-start gap-2.5">
                <Info className="w-4 h-4 text-[var(--accent-text)] shrink-0 mt-0.5" />
                <div>
                  <h2 className="text-sm font-semibold text-[var(--text)]">
                    {t('notifications.employees.guideTitle')}
                  </h2>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    {t('notifications.employees.guideSubtitle')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowMasterGuide((v) => !v)}
                className="text-xs font-semibold text-[var(--accent-text)] hover:underline self-start sm:self-center shrink-0 cursor-pointer"
              >
                {showMasterGuide ? 'Sembunyikan Panduan' : 'Tampilkan Panduan'}
              </button>
            </div>

            {showMasterGuide && (
              <div className="p-4 space-y-3">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                        <th className="py-2 pr-3 font-semibold">Kolom Master ERP</th>
                        <th className="py-2 px-3 font-semibold">Field Master</th>
                        <th className="py-2 px-3 font-semibold">Contoh Isian</th>
                        <th className="py-2 pl-3 font-semibold">Fungsi di Sistem Pengingat</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]/60">
                      {REQUIRED_ERP_FIELDS.map((item) => (
                        <tr key={item.field}>
                          <td className="py-2 pr-3 font-mono text-[11px] text-[var(--accent-text)] whitespace-nowrap">
                            {item.field}
                          </td>
                          <td className="py-2 px-3 font-medium text-[var(--text)] whitespace-nowrap">
                            {item.label}{' '}
                            {item.required ? (
                              <span className="ml-1 text-[10px] font-bold text-[var(--danger)]">
                                WAJIB
                              </span>
                            ) : (
                              <span className="ml-1 text-[10px] text-[var(--text-muted)]">
                                Opsional
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 font-mono text-[11px] text-[var(--text-muted)] whitespace-nowrap">
                            {item.example}
                          </td>
                          <td className="py-2 pl-3 text-[var(--text-muted)]">{item.purpose}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {erpResult && (
                  <div className="rounded-lg bg-[var(--surface-2)] border border-[var(--border)] p-3 text-[11px] text-[var(--text-muted)] space-y-1">
                    <div className="font-semibold text-[var(--text)]">
                      Deteksi Otomatis Master Kontak ERP ({erpResult.totalContactsScanned} total kontak dipindai):
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono">
                      <span>Kode: {erpResult.detectedColumns.codeCol || '-'}</span>
                      <span>Nama: {erpResult.detectedColumns.nameCol || '-'}</span>
                      <span>Email: {erpResult.detectedColumns.emailCol || '-'}</span>
                      <span>HP/WA: {erpResult.detectedColumns.phoneCol || '-'}</span>
                      <span>Telp 2: {erpResult.detectedColumns.secondaryPhoneCol || '-'}</span>
                      <span>Kategori: {erpResult.detectedColumns.categoryCol || '-'}</span>
                      <span>Flag Employee: {erpResult.detectedColumns.employeeFlagCol || '-'}</span>
                      <span>Aktif: {erpResult.detectedColumns.activeCol || '-'}</span>
                    </div>
                    {erpResult.categoryValues.length > 0 && (
                      <div>
                        Nilai kategori terdeteksi di Master Kontak ERP:{' '}
                        <span className="font-mono text-[var(--text)]">
                          {erpResult.categoryValues.slice(0, 12).join(', ')}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ERP Bridge Error / Update Notice */}
          {erpError && (
            <div className="rounded-xl bg-[var(--warning)]/10 border border-[var(--warning)]/30 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1 text-xs">
                <p className="font-semibold text-[var(--text)]">
                  Koneksi Master Karyawan ERP belum terbaca
                </p>
                <p className="text-[var(--text-muted)]">{erpError}</p>
                <p className="text-[var(--text-muted)]">
                  Anda tetap bisa menambahkan/melengkapi Email & No. WA karyawan langsung di tabel
                  bawah ini (tersimpan aman di database aplikasi).
                </p>
              </div>
              <button
                type="button"
                onClick={downloadBridgeV6Script}
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] shrink-0 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{t('notifications.employees.downloadBridge')}</span>
              </button>
            </div>
          )}

          {/* Toolbar */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={employeeSearch}
                onChange={(e) => setEmployeeSearch(e.target.value)}
                placeholder={t('notifications.employees.searchPlaceholder')}
                className="w-full h-9 pl-8 pr-3 rounded-lg text-xs bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center h-9 px-3 rounded-lg text-xs font-medium bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)]">
                {t('notifications.employees.onlyEmployees')}
              </span>

              <button
                type="button"
                onClick={() => void loadErpEmployeesData(true)}
                disabled={erpLoading}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-semibold bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] hover:border-[var(--text-muted)] cursor-pointer disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${erpLoading ? 'animate-spin' : ''}`} />
                <span>{t('notifications.employees.syncNow')}</span>
              </button>

              {isAdmin && (
                <button
                  type="button"
                  onClick={() => openEditEmployeeContact()}
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>{t('notifications.employees.addOverride')}</span>
                </button>
              )}
            </div>
          </div>

          {/* Employee Directory Table */}
          <div className="rounded-xl bg-[var(--surface)] border border-[var(--border)] overflow-hidden">
            {erpLoading && mergedEmployees.length === 0 ? (
              <div className="p-10 flex items-center justify-center gap-2 text-xs text-[var(--text-muted)]">
                <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />
                <span>Memuat master karyawan kategori K dari ERP...</span>
              </div>
            ) : filteredEmployees.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <Users className="w-8 h-8 text-[var(--text-muted)] mx-auto" />
                <p className="text-sm font-medium text-[var(--text)]">
                  Belum ada data karyawan kategori K yang ditemukan.
                </p>
                <p className="text-xs text-[var(--text-muted)] max-w-lg mx-auto">
                  Pastikan kontak karyawan di Master Kontak ERP memiliki kategori K dan berstatus
                  aktif, atau tambahkan kontak karyawan secara manual.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--surface-2)]/60 text-[var(--text-muted)]">
                      <th className="py-3 px-4 font-semibold">Kode</th>
                      <th className="py-3 px-4 font-semibold">Nama Karyawan</th>
                      <th className="py-3 px-4 font-semibold">Kategori / Divisi</th>
                      <th className="py-3 px-4 font-semibold">Email</th>
                      <th className="py-3 px-4 font-semibold">No. HP / WhatsApp</th>
                      <th className="py-3 px-4 font-semibold">Kelengkapan</th>
                      <th className="py-3 px-4 font-semibold text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {employeesPaging.paginatedItems.map((emp) => {
                      const hasEmail = isValidEmailClient(emp.email);
                      const hasWa = Boolean(emp.whatsappNormalized);
                      const canEditThisRow = isAdmin || emp.linkedUid === user.uid;
                      return (
                        <tr
                          key={emp.rowKey}
                          className="hover:bg-[var(--surface-2)]/40 transition-colors"
                        >
                          <td className="py-3 px-4 font-mono text-[11px] text-[var(--text-muted)] whitespace-nowrap">
                            {emp.code}
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-semibold text-[var(--text)]">{emp.name}</div>
                            {emp.jobTitle && (
                              <div className="text-[11px] text-[var(--text-muted)]">
                                {emp.jobTitle}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <div className="text-[var(--text)]">{emp.category}</div>
                            {emp.division && (
                              <div className="text-[11px] text-[var(--text-muted)]">
                                {emp.division}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            {hasEmail ? (
                              <span className="font-mono text-[11px] text-[var(--text)]">
                                {emp.email}
                              </span>
                            ) : (
                              <span className="text-[11px] text-[var(--danger)]">
                                {t('notifications.employees.missingEmail')}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            {hasWa ? (
                              <div>
                                <div className="font-mono text-[11px] text-[var(--text)]">
                                  {emp.phone}
                                </div>
                                <div className="font-mono text-[10px] text-[var(--success)]">
                                  WA: +{emp.whatsappNormalized}
                                </div>
                              </div>
                            ) : (
                              <span className="text-[11px] text-[var(--danger)]">
                                {t('notifications.employees.missingPhone')}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex flex-col gap-1">
                              {hasEmail && hasWa ? (
                                <span className="inline-flex items-center gap-1 w-fit px-2 py-0.5 rounded-md text-[10px] font-semibold bg-[var(--success)]/15 text-[var(--success)] border border-[var(--success)]/30">
                                  <CheckCircle2 className="w-3 h-3" />
                                  {t('notifications.employees.complete')}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 w-fit px-2 py-0.5 rounded-md text-[10px] font-semibold bg-[var(--warning)]/15 text-[var(--warning)] border border-[var(--warning)]/30">
                                  <AlertTriangle className="w-3 h-3" />
                                  Perlu dilengkapi
                                </span>
                              )}
                              <span className="text-[10px] text-[var(--text-muted)]">
                                {emp.source === 'erp'
                                  ? t('notifications.employees.sourceErp')
                                  : emp.source === 'merged'
                                    ? t('notifications.employees.sourceMerged')
                                    : t('notifications.employees.sourceOverride')}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              {canEditThisRow && (
                                <button
                                  type="button"
                                  onClick={() => openEditEmployeeContact(emp)}
                                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] font-medium bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] hover:border-[var(--accent)] cursor-pointer"
                                >
                                  <Edit3 className="w-3 h-3" />
                                  <span>{t('notifications.employees.completeContact')}</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  openComposeFromDraft({
                                    category: 'general',
                                    priority: 'normal',
                                    sourceType: 'MANUAL',
                                    sourceId: '',
                                    sourceLabel: `Pesan ke ${emp.name}`,
                                    dueDate: '',
                                    title: '',
                                    message: '',
                                    recipients: [
                                      {
                                        uid: emp.linkedUid,
                                        name: emp.name,
                                        email: emp.email,
                                        phone: emp.phone,
                                        erpCode: emp.code === '-' ? '' : emp.code,
                                      },
                                    ],
                                  })
                                }
                                title="Kirim Notifikasi"
                                className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] cursor-pointer"
                              >
                                <Send className="w-3 h-3" />
                              </button>
                              {isAdmin && emp.overrideId && emp.source === 'override' && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setConfirmDeleteContact({
                                      id: emp.overrideId!,
                                      name: emp.name,
                                      email: emp.email,
                                      phone: emp.phone,
                                    })
                                  }
                                  disabled={busyActionId === emp.overrideId}
                                  title={t('common.delete')}
                                  className="inline-flex items-center justify-center w-7 h-7 rounded-md text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger)]/10 cursor-pointer"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {filteredEmployees.length > 0 && (
              <TablePaginationBar {...employeesPaging.paginationProps} />
            )}
          </div>
        </div>
      )}

      {/* TAB 4: DELIVERY HISTORY & GATEWAY STATUS */}
      {activeTab === 'history' && (
        <div className="space-y-5">
          {/* Server-Side Gateway Readiness Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl bg-[var(--surface)] border border-[var(--border)] p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-[var(--accent-text)]" />
                  <h3 className="text-sm font-semibold text-[var(--text)]">
                    {t('notifications.gateway.emailTitle')}
                  </h3>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border ${
                    gatewayStatus?.emailConfigured
                      ? 'bg-[var(--success)]/15 text-[var(--success)] border-[var(--success)]/30'
                      : 'bg-[var(--warning)]/15 text-[var(--warning)] border-[var(--warning)]/30'
                  }`}
                >
                  {gatewayStatus?.emailConfigured
                    ? `${t('notifications.gateway.configured')} (${gatewayStatus.emailProvider.toUpperCase()})`
                    : t('notifications.gateway.notConfigured')}
                </span>
              </div>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                Mendukung SMTP kantor (Google Workspace / Microsoft 365 / Mail Server) atau Resend
                API. Isi variabel berikut di panel <strong>Settings &gt; Secrets</strong>:
              </p>
              <div className="rounded-lg bg-[var(--surface-2)] border border-[var(--border)] p-2.5 font-mono text-[11px] text-[var(--text)] space-y-0.5">
                <div>SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM</div>
                <div className="text-[var(--text-muted)]">atau alternatif HTTP API: RESEND_API_KEY</div>
              </div>
            </div>

            <div className="rounded-xl bg-[var(--surface)] border border-[var(--border)] p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageCircle className="w-4 h-4 text-[var(--success)]" />
                  <h3 className="text-sm font-semibold text-[var(--text)]">
                    {t('notifications.gateway.whatsappTitle')}
                  </h3>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border ${
                    gatewayStatus?.whatsappConfigured
                      ? 'bg-[var(--success)]/15 text-[var(--success)] border-[var(--success)]/30'
                      : 'bg-[var(--warning)]/15 text-[var(--warning)] border-[var(--warning)]/30'
                  }`}
                >
                  {gatewayStatus?.whatsappConfigured
                    ? `${t('notifications.gateway.configured')} (${gatewayStatus.whatsappProvider.toUpperCase()})`
                    : t('notifications.gateway.notConfigured')}
                </span>
              </div>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                Mendukung <strong>Fonnte</strong> atau <strong>Meta WhatsApp Cloud API</strong>{' '}
                resmi. Jika belum diisi, sistem otomatis menyediakan tautan kirim 1-klik{' '}
                <span className="font-mono">wa.me</span>.
              </p>
              <div className="rounded-lg bg-[var(--surface-2)] border border-[var(--border)] p-2.5 font-mono text-[11px] text-[var(--text)] space-y-0.5">
                <div>WHATSAPP_PROVIDER=&quot;fonnte&quot; + FONNTE_TOKEN</div>
                <div className="text-[var(--text-muted)]">
                  atau WHATSAPP_PROVIDER=&quot;meta&quot; + WHATSAPP_META_TOKEN +
                  WHATSAPP_META_PHONE_NUMBER_ID
                </div>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-[var(--success)] shrink-0" />
            <span>{t('notifications.gateway.secretsHint')}</span>
          </p>

          {/* Delivery Log Table */}
          <div className="rounded-xl bg-[var(--surface)] border border-[var(--border)] overflow-hidden">
            {notifications.length === 0 ? (
              <div className="p-10 text-center text-xs text-[var(--text-muted)]">
                Belum ada riwayat pengiriman notifikasi.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--surface-2)]/60 text-[var(--text-muted)]">
                      <th className="py-3 px-4 font-semibold">Waktu</th>
                      <th className="py-3 px-4 font-semibold">Judul & Kategori</th>
                      <th className="py-3 px-4 font-semibold">Penerima</th>
                      <th className="py-3 px-4 font-semibold">Status Kanal</th>
                      <th className="py-3 px-4 font-semibold">Pengirim</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {historyPaging.paginatedItems.map((n) => (
                      <tr key={n.id} className="hover:bg-[var(--surface-2)]/40">
                        <td className="py-3 px-4 font-mono tabular-nums text-[11px] text-[var(--text-muted)] whitespace-nowrap">
                          {formatTs(n.createdAt, locale)}
                        </td>
                        <td className="py-3 px-4 max-w-xs">
                          <div className="font-semibold text-[var(--text)] truncate">{n.title}</div>
                          <div className="text-[11px] text-[var(--text-muted)]">
                            {t(`notifications.categories.${n.category}`)}
                            {n.sourceLabel ? ` · ${n.sourceLabel}` : ''}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-medium text-[var(--text)]">{n.recipientName}</div>
                          <div className="text-[10px] font-mono text-[var(--text-muted)]">
                            {[n.recipientEmail, n.recipientPhone].filter(Boolean).join(' · ') || '-'}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex flex-wrap gap-1">
                            {n.channels.includes('in_app') && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-[var(--accent-soft)] text-[var(--accent-text)] border border-[var(--accent)]/30">
                                In-App: {n.inAppRead ? 'Dibaca' : 'Terkirim'}
                              </span>
                            )}
                            {renderDeliveryStatusBadge(n.emailStatus, 'Email')}
                            {renderDeliveryStatusBadge(n.whatsappStatus, 'WA')}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-[var(--text-muted)] whitespace-nowrap">
                          {n.senderName}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {notifications.length > 0 && (
              <TablePaginationBar {...historyPaging.paginationProps} />
            )}
          </div>
        </div>
      )}

      {/* COMPOSE & DISPATCH MODAL */}
      {composeOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--overlay-bg)] dark:bg-black/65"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl bg-[var(--surface)] border border-[var(--border)] shadow-[var(--modal-shadow)] dark:shadow-2xl">
            <div className="sticky top-0 z-10 px-5 py-4 bg-[var(--surface)] border-b border-[var(--border)] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Send className="w-4 h-4 text-[var(--accent-text)]" />
                <h2 className="font-display text-sm sm:text-base font-bold text-[var(--text)]">
                  {t('notifications.compose.modalTitle')}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setComposeOpen(false)}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Channels */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-[var(--text)]">
                  {t('notifications.compose.channelsLabel')}
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <label className="flex items-center gap-2.5 p-2.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={channelInApp}
                      onChange={(e) => setChannelInApp(e.target.checked)}
                      className="accent-[var(--accent)]"
                    />
                    <Bell className="w-3.5 h-3.5 text-[var(--accent-text)] shrink-0" />
                    <span className="text-xs font-medium text-[var(--text)]">
                      {t('notifications.channels.in_app')}
                    </span>
                  </label>
                  <label className="flex items-center gap-2.5 p-2.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={channelEmail}
                      onChange={(e) => setChannelEmail(e.target.checked)}
                      className="accent-[var(--accent)]"
                    />
                    <Mail className="w-3.5 h-3.5 text-[var(--accent-text)] shrink-0" />
                    <span className="text-xs font-medium text-[var(--text)]">
                      {t('notifications.channels.email')}
                    </span>
                  </label>
                  <label className="flex items-center gap-2.5 p-2.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={channelWhatsapp}
                      onChange={(e) => setChannelWhatsapp(e.target.checked)}
                      className="accent-[var(--accent)]"
                    />
                    <MessageCircle className="w-3.5 h-3.5 text-[var(--success)] shrink-0" />
                    <span className="text-xs font-medium text-[var(--text)]">
                      {t('notifications.channels.whatsapp')}
                    </span>
                  </label>
                </div>
              </div>

              {/* Recipients */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-[var(--text)]">
                    {t('notifications.compose.recipientsLabel')} ({composeRecipients.length})
                  </label>
                </div>

                <div className="flex gap-2">
                  <select
                    value={recipientPickerValue}
                    onChange={(e) => {
                      const val = e.target.value;
                      setRecipientPickerValue(val);
                      if (val) handleAddRecipientFromPicker(val);
                    }}
                    className="flex-1 h-9 px-3 rounded-lg text-xs bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
                  >
                    <option value="">+ {t('notifications.compose.addRecipient')}...</option>
                    {mergedEmployees.length > 0 && (
                      <optgroup label="Master Karyawan ERP & Pelengkap">
                        {mergedEmployees.map((emp) => (
                          <option key={emp.rowKey} value={emp.rowKey}>
                            {emp.name} {emp.code !== '-' ? `(${emp.code})` : ''} —{' '}
                            {emp.email || 'Email kosong'} | {emp.phone || 'HP kosong'}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label="Pengguna Terdaftar di Aplikasi">
                      {directory.map((dm) => (
                        <option key={dm.uid} value={`dir_${dm.uid}`}>
                          {dm.displayName} ({dm.role} · {dm.divisionName || 'Umum'})
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>

                {composeRecipients.length > 0 && (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {composeRecipients.map((rec, idx) => (
                      <div
                        key={rec.key}
                        className="p-2.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs font-semibold text-[var(--text)]">
                            {rec.name}{' '}
                            {rec.erpCode && (
                              <span className="font-mono text-[11px] font-normal text-[var(--text-muted)]">
                                ({rec.erpCode})
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setComposeRecipients((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="text-[var(--text-muted)] hover:text-[var(--danger)] cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input
                            type="email"
                            value={rec.email}
                            onChange={(e) => {
                              const val = e.target.value;
                              setComposeRecipients((prev) =>
                                prev.map((r, i) => (i === idx ? { ...r, email: val } : r))
                              );
                            }}
                            placeholder="Email karyawan (cth: pic@perusahaan.co.id)"
                            className="h-8 px-2.5 rounded-md text-xs bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
                          />
                          <input
                            type="text"
                            value={rec.phone}
                            onChange={(e) => {
                              const val = e.target.value;
                              setComposeRecipients((prev) =>
                                prev.map((r, i) => (i === idx ? { ...r, phone: val } : r))
                              );
                            }}
                            placeholder="No. HP / WhatsApp (cth: 0812xxxx)"
                            className="h-8 px-2.5 rounded-md text-xs bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Subject & Message */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2 space-y-1.5">
                  <label className="text-xs font-semibold text-[var(--text)]">
                    {t('notifications.compose.subjectLabel')}
                  </label>
                  <input
                    type="text"
                    value={composeSubject}
                    onChange={(e) => setComposeSubject(e.target.value)}
                    placeholder="Contoh: Pengingat Servis Berkala Kendaraan Operasional"
                    className="w-full h-9 px-3 rounded-lg text-xs bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-[var(--text)]">Prioritas</label>
                  <select
                    value={composePriority}
                    onChange={(e) => setComposePriority(e.target.value as NotificationPriority)}
                    className="w-full h-9 px-3 rounded-lg text-xs bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
                  >
                    <option value="normal">{t('notifications.priority.normal')}</option>
                    <option value="warning">{t('notifications.priority.warning')}</option>
                    <option value="urgent">{t('notifications.priority.urgent')}</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[var(--text)]">
                  {t('notifications.compose.messageLabel')}
                </label>
                <textarea
                  rows={6}
                  value={composeMessage}
                  onChange={(e) => setComposeMessage(e.target.value)}
                  placeholder="Tulis rincian pengingat untuk PIC/karyawan..."
                  className="w-full p-3 rounded-lg text-xs bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)] leading-relaxed"
                />
              </div>

              {sendError && (
                <div className="p-3 rounded-lg bg-[var(--danger)]/10 border border-[var(--danger)]/30 text-xs text-[var(--danger)]">
                  {sendError}
                </div>
              )}

              {/* Delivery Results & 1-Click Fallback Links */}
              {dispatchResponse && (
                <div className="rounded-xl bg-[var(--surface-2)] border border-[var(--border)] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[var(--text)]">
                      {t('notifications.compose.resultTitle')}
                    </span>
                    <span className="text-[11px] text-[var(--success)] font-semibold">
                      Notifikasi Khusus In-App tersimpan
                    </span>
                  </div>

                  <div className="space-y-2">
                    {dispatchResponse.results.map((r, i) => (
                      <div
                        key={`res_${i}_${r.name}`}
                        className="p-2.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="font-semibold text-[var(--text)]">{r.name}</div>
                          <div className="flex flex-wrap gap-1.5">
                            {renderDeliveryStatusBadge(r.emailStatus, 'Email')}
                            {renderDeliveryStatusBadge(r.whatsappStatus, 'WA')}
                          </div>
                          {(r.emailDetail || r.whatsappDetail) && (
                            <p className="text-[11px] text-[var(--text-muted)]">
                              {[r.emailDetail, r.whatsappDetail].filter(Boolean).join(' · ')}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {r.whatsappWebLink && r.whatsappStatus !== 'sent' && (
                            <a
                              href={r.whatsappWebLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md text-[11px] font-semibold bg-[var(--success)]/15 text-[var(--success)] border border-[var(--success)]/30 hover:bg-[var(--success)]/25"
                            >
                              <MessageCircle className="w-3 h-3" />
                              <span>{t('notifications.compose.openWhatsApp')}</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                          {r.mailtoLink && r.emailStatus !== 'sent' && (
                            <a
                              href={r.mailtoLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md text-[11px] font-semibold bg-[var(--accent-soft)] text-[var(--accent-text)] border border-[var(--accent)]/30 hover:opacity-90"
                            >
                              <Mail className="w-3 h-3" />
                              <span>{t('notifications.compose.openEmail')}</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setComposeOpen(false)}
                  className="h-9 px-4 rounded-lg text-xs font-semibold bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] hover:border-[var(--text-muted)] cursor-pointer"
                >
                  {t('common.close')}
                </button>
                <button
                  type="button"
                  onClick={handleSendNotifications}
                  disabled={sending}
                  className="inline-flex items-center gap-2 h-9 px-4 rounded-lg text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] disabled:opacity-60 cursor-pointer"
                >
                  {sending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {sending
                      ? t('notifications.compose.sending')
                      : t('notifications.compose.sendButton')}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* EDIT / SUPPLEMENT EMPLOYEE CONTACT MODAL */}
      {editContactOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--overlay-bg)] dark:bg-black/65"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-2xl bg-[var(--surface)] border border-[var(--border)] shadow-[var(--modal-shadow)] dark:shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Plus className="w-4 h-4 text-[var(--accent-text)]" />
                <h2 className="font-display text-sm font-bold text-[var(--text)]">
                  {t('notifications.employees.completeContact')}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setEditContactOpen(false)}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEmployeeContact} className="p-5 space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[var(--text)]">Nama Karyawan *</label>
                  <input
                    type="text"
                    required
                    value={editForm.employeeName}
                    onChange={(e) => setEditForm((f) => ({ ...f, employeeName: e.target.value }))}
                    className="w-full h-9 px-3 rounded-lg text-xs bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[var(--text)]">
                    Kode Karyawan ERP (kkode)
                  </label>
                  <input
                    type="text"
                    value={editForm.erpContactCode}
                    onChange={(e) => setEditForm((f) => ({ ...f, erpContactCode: e.target.value }))}
                    placeholder="Contoh: EMP-001"
                    className="w-full h-9 px-3 rounded-lg text-xs bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[var(--text)]">Email Aktif</label>
                  <input
                    type="email"
                    value={editForm.email}
                    onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="nama@perusahaan.co.id"
                    className="w-full h-9 px-3 rounded-lg text-xs bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[var(--text)]">
                    No. HP / WhatsApp
                  </label>
                  <input
                    type="text"
                    value={editForm.whatsappPhone}
                    onChange={(e) => setEditForm((f) => ({ ...f, whatsappPhone: e.target.value }))}
                    placeholder="081234567890"
                    className="w-full h-9 px-3 rounded-lg text-xs bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[var(--text)]">Divisi</label>
                  <select
                    value={editForm.divisionId}
                    onChange={(e) => {
                      const d = divisions.find((x) => x.id === e.target.value);
                      setEditForm((f) => ({
                        ...f,
                        divisionId: e.target.value,
                        divisionName: d?.name || f.divisionName,
                      }));
                    }}
                    className="w-full h-9 px-3 rounded-lg text-xs bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
                  >
                    <option value="">-- Pilih Divisi --</option>
                    {divisions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-[var(--text)]">Jabatan</label>
                  <input
                    type="text"
                    value={editForm.jobTitle}
                    onChange={(e) => setEditForm((f) => ({ ...f, jobTitle: e.target.value }))}
                    placeholder="Contoh: Teknisi / Staff GA"
                    className="w-full h-9 px-3 rounded-lg text-xs bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-[var(--text)]">
                  Tautkan ke Akun Aplikasi (untuk Notifikasi Khusus In-App)
                </label>
                <select
                  value={editForm.linkedUid}
                  onChange={(e) => setEditForm((f) => ({ ...f, linkedUid: e.target.value }))}
                  className="w-full h-9 px-3 rounded-lg text-xs bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
                >
                  <option value="">-- Belum ditautkan --</option>
                  {directory.map((dm) => (
                    <option key={dm.uid} value={dm.uid}>
                      {dm.displayName} ({dm.role} · {dm.divisionName || 'Umum'})
                    </option>
                  ))}
                </select>
              </div>

              {editContactError && (
                <div className="p-2.5 rounded-lg bg-[var(--danger)]/10 border border-[var(--danger)]/30 text-xs text-[var(--danger)]">
                  {editContactError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setEditContactOpen(false)}
                  className="h-9 px-4 rounded-lg text-xs font-semibold bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] cursor-pointer"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={editContactSaving}
                  className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] disabled:opacity-60 cursor-pointer"
                >
                  {editContactSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{editContactSaving ? t('common.saving') : t('common.save')}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <DeleteConfirmModal
        open={Boolean(confirmDeleteNotif)}
        title="Hapus Notifikasi?"
        description={
          confirmDeleteNotif ? (
            <>
              Notifikasi <strong>{confirmDeleteNotif.title}</strong> akan dihapus permanen dari
              daftar kotak masuk.
            </>
          ) : null
        }
        details={
          confirmDeleteNotif
            ? [
                { label: 'Judul', value: confirmDeleteNotif.title },
                { label: 'Kategori', value: confirmDeleteNotif.category },
                ...(confirmDeleteNotif.sourceLabel
                  ? [{ label: 'Referensi', value: confirmDeleteNotif.sourceLabel }]
                  : []),
              ]
            : undefined
        }
        confirmLabel="Hapus Notifikasi"
        loading={Boolean(confirmDeleteNotif && busyActionId === confirmDeleteNotif.id)}
        onCancel={() => setConfirmDeleteNotif(null)}
        onConfirm={() => {
          if (confirmDeleteNotif) {
            return handleDeleteNotification(confirmDeleteNotif.id);
          }
        }}
      />

      <DeleteConfirmModal
        open={Boolean(confirmDeleteContact)}
        title="Hapus Kontak Tambahan Karyawan?"
        description={
          confirmDeleteContact ? (
            <>
              Data kontak override untuk <strong>{confirmDeleteContact.name}</strong> akan dihapus
              permanen dari direktori notifikasi.
            </>
          ) : null
        }
        details={
          confirmDeleteContact
            ? [
                { label: 'Nama Karyawan', value: confirmDeleteContact.name },
                ...(confirmDeleteContact.email
                  ? [{ label: 'Email', value: confirmDeleteContact.email }]
                  : []),
                ...(confirmDeleteContact.phone
                  ? [{ label: 'No. HP / WA', value: confirmDeleteContact.phone }]
                  : []),
              ]
            : undefined
        }
        confirmLabel="Hapus Kontak"
        loading={Boolean(confirmDeleteContact && busyActionId === confirmDeleteContact.id)}
        onCancel={() => setConfirmDeleteContact(null)}
        onConfirm={() => {
          if (confirmDeleteContact) {
            return handleDeleteOverride(confirmDeleteContact.id);
          }
        }}
      />
    </div>
  );
};
