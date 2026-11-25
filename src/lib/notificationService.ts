import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { computeEffectiveMaintenanceStatus } from './assetService';
import { db, isBootstrapAdminEmail } from './firebase';
import { getRbacToken } from './rbacClient';
import { makeSafeId } from './sopService';
import type {
  AssetMaintenanceSchedule,
  DirectoryMember,
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
  SopDocument,
  UserProfile,
} from '../types/sop';

export interface RecipientDispatchClientResult {
  uid: string;
  name: string;
  erpCode: string;
  email: string;
  phoneNormalized: string;
  emailStatus: NotificationChannelDeliveryStatus;
  emailDetail: string;
  whatsappStatus: NotificationChannelDeliveryStatus;
  whatsappDetail: string;
  mailtoLink: string;
  whatsappWebLink: string;
}

export interface DispatchNotificationClientResponse {
  gatewayStatus: NotificationChannelStatus;
  results: RecipientDispatchClientResult[];
  summary: {
    totalRecipients: number;
    emailSent: number;
    emailFallback: number;
    emailFailed: number;
    whatsappSent: number;
    whatsappFallback: number;
    whatsappFailed: number;
  };
  dispatchedAt: string;
}

export interface ResolvedRecipientContact {
  uid: string;
  name: string;
  erpCode: string;
  erpContactId: number;
  email: string;
  phone: string;
  whatsappNormalized: string;
  division: string;
  jobTitle: string;
  source: 'override' | 'erp' | 'merged' | 'unmatched';
}

export interface SystemReminderItem {
  key: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  sourceType: NotificationSourceType;
  sourceId: string;
  sourceLabel: string;
  title: string;
  subtitle: string;
  dueDate: string;
  daysDelta: number;
  defaultMessage: string;
  divisionId: string;
  recipients: ResolvedRecipientContact[];
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmailClient(raw: string): boolean {
  const s = String(raw || '').trim();
  return Boolean(s && s.length <= 254 && EMAIL_REGEX.test(s));
}

export function normalizePhoneClient(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  let n = digits;
  if (n.startsWith('00')) n = n.slice(2);
  if (n.startsWith('0')) n = `62${n.slice(1)}`;
  else if (n.startsWith('8') && n.length >= 9 && n.length <= 13) n = `62${n}`;
  if (n.length < 9 || n.length > 15) return '';
  return n;
}

function normalizeNameForMatch(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getAdminViewerUids(actor: UserProfile, directory: DirectoryMember[]): string[] {
  const uids = new Set<string>([actor.uid]);
  for (const m of directory) {
    if (m.role === 'Super Admin' || m.role === 'Admin Divisi') {
      uids.add(m.uid);
    }
  }
  return Array.from(uids).slice(0, 50);
}

function getTimestampSeconds(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  const obj = ts as { seconds?: number; _seconds?: number };
  return Number(obj.seconds ?? obj._seconds ?? 0);
}

export async function fetchErpEmployees(
  idToken: string,
  opts?: {
    search?: string;
    onlyActive?: boolean;
    includeAll?: boolean;
    refresh?: boolean;
    limit?: number;
  }
): Promise<ErpEmployeesQueryResult> {
  const qs = new URLSearchParams();
  if (opts?.search) qs.set('q', opts.search);
  if (opts?.onlyActive === false) qs.set('onlyActive', '0');
  if (opts?.includeAll) qs.set('includeAll', '1');
  if (opts?.refresh) qs.set('refresh', '1');
  if (opts?.limit) qs.set('limit', String(opts.limit));

  const rbacToken = getRbacToken();
  const res = await fetch(`/api/erp/employees?${qs.toString()}`, {
    headers: {
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      ...(rbacToken ? { 'X-Rbac-Token': rbacToken } : {}),
      Accept: 'application/json',
    },
    cache: 'no-store',
  });
  const body = (await res.json().catch(() => ({}))) as ErpEmployeesQueryResult & { error?: string };
  if (!res.ok) {
    throw new Error(body.error || `Gagal mengambil data master karyawan ERP (HTTP ${res.status}).`);
  }
  return body;
}

export async function fetchNotificationChannelStatus(
  idToken: string
): Promise<NotificationChannelStatus> {
  const rbacToken = getRbacToken();
  const res = await fetch('/api/notifications/status', {
    headers: {
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      ...(rbacToken ? { 'X-Rbac-Token': rbacToken } : {}),
      Accept: 'application/json',
    },
    cache: 'no-store',
  });
  const body = (await res.json().catch(() => ({}))) as NotificationChannelStatus & { error?: string };
  if (!res.ok) {
    throw new Error(body.error || `Gagal memeriksa status gateway notifikasi (HTTP ${res.status}).`);
  }
  return body;
}

export async function sendMultiChannelNotificationApi(
  idToken: string,
  payload: {
    category: NotificationCategory;
    priority: NotificationPriority;
    subject: string;
    message: string;
    channels: { email: boolean; whatsapp: boolean };
    recipients: {
      uid?: string;
      name: string;
      email?: string;
      phone?: string;
      erpCode?: string;
    }[];
    senderName: string;
  }
): Promise<DispatchNotificationClientResponse> {
  const rbacToken = getRbacToken();
  const res = await fetch('/api/notifications/send', {
    method: 'POST',
    headers: {
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      ...(rbacToken ? { 'X-Rbac-Token': rbacToken } : {}),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => ({}))) as DispatchNotificationClientResponse & {
    error?: string;
  };
  if (!res.ok) {
    throw new Error(body.error || `Gagal mengirim notifikasi (HTTP ${res.status}).`);
  }
  return body;
}

export async function fetchAccessibleNotifications(
  user: UserProfile
): Promise<NotificationRecord[]> {
  const notifCol = collection(db, 'notifications');
  const map = new Map<string, NotificationRecord>();

  if (isBootstrapAdminEmail(user.email)) {
    const snap = await getDocs(notifCol);
    for (const d of snap.docs) {
      map.set(d.id, d.data() as NotificationRecord);
    }
  } else {
    const [byRecipient, bySender, byViewer] = await Promise.all([
      getDocs(query(notifCol, where('recipientUid', '==', user.uid))).catch(() => null),
      getDocs(query(notifCol, where('senderUid', '==', user.uid))).catch(() => null),
      getDocs(query(notifCol, where('viewerUids', 'array-contains', user.uid))).catch(() => null),
    ]);
    for (const snap of [byRecipient, bySender, byViewer]) {
      if (!snap) continue;
      for (const d of snap.docs) {
        map.set(d.id, d.data() as NotificationRecord);
      }
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => getTimestampSeconds(b.createdAt) - getTimestampSeconds(a.createdAt)
  );
}

export interface SaveNotificationInput {
  category: NotificationCategory;
  priority: NotificationPriority;
  title: string;
  message: string;
  sourceType: NotificationSourceType;
  sourceId: string;
  sourceLabel: string;
  dueDate: string;
  recipientUid: string;
  recipientName: string;
  recipientEmail: string;
  recipientPhone: string;
  recipientErpCode: string;
  divisionId: string;
  channels: NotificationChannel[];
  emailStatus: NotificationChannelDeliveryStatus;
  whatsappStatus: NotificationChannelDeliveryStatus;
  deliveryNote: string;
}

export async function saveNotificationRecords(
  actor: UserProfile,
  directory: DirectoryMember[],
  items: SaveNotificationInput[]
): Promise<NotificationRecord[]> {
  const adminUids = getAdminViewerUids(actor, directory);
  const created: NotificationRecord[] = [];

  for (const item of items) {
    const id = makeSafeId('notif');
    const viewerSet = new Set<string>([actor.uid, ...adminUids]);
    if (item.recipientUid) viewerSet.add(item.recipientUid);
    const safeChannels: NotificationChannel[] =
      item.channels.length > 0 ? item.channels.slice(0, 3) : ['in_app'];

    const payload = {
      id,
      category: item.category,
      priority: item.priority,
      title: String(item.title || 'Pengingat Sistem').trim().slice(0, 200),
      message: String(item.message || '-').trim().slice(0, 4000),
      sourceType: item.sourceType,
      sourceId: String(item.sourceId || '').trim().slice(0, 128),
      sourceLabel: String(item.sourceLabel || '').trim().slice(0, 200),
      dueDate: String(item.dueDate || '').trim().slice(0, 30),
      recipientUid: String(item.recipientUid || '').trim().slice(0, 128),
      recipientName: String(item.recipientName || 'Karyawan').trim().slice(0, 120),
      recipientEmail: String(item.recipientEmail || '').trim().slice(0, 254),
      recipientPhone: String(item.recipientPhone || '').trim().slice(0, 40),
      recipientErpCode: String(item.recipientErpCode || '').trim().slice(0, 60),
      divisionId: String(item.divisionId || actor.divisionId || '').trim().slice(0, 128),
      channels: safeChannels,
      inAppRead: false,
      emailStatus: item.emailStatus,
      whatsappStatus: item.whatsappStatus,
      deliveryNote: String(item.deliveryNote || '').trim().slice(0, 500),
      senderUid: actor.uid,
      senderName: String(actor.displayName || 'Administrator').trim().slice(0, 120),
      viewerUids: Array.from(viewerSet).slice(0, 50),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const ref = doc(db, 'notifications', id);
    await setDoc(ref, payload);
    const savedSnap = await getDoc(ref);
    if (savedSnap.exists()) {
      created.push(savedSnap.data() as NotificationRecord);
    } else {
      created.push({
        ...payload,
        createdAt: { seconds: Math.floor(Date.now() / 1000) },
        updatedAt: { seconds: Math.floor(Date.now() / 1000) },
      });
    }
  }

  return created;
}

export async function markNotificationRead(notifId: string, isRead = true): Promise<void> {
  const ref = doc(db, 'notifications', notifId);
  await updateDoc(ref, {
    inAppRead: isRead,
    updatedAt: serverTimestamp(),
  });
}

export async function markAllNotificationsRead(items: NotificationRecord[]): Promise<void> {
  const unread = items.filter((n) => !n.inAppRead);
  await Promise.all(unread.map((n) => markNotificationRead(n.id, true)));
}

export async function deleteNotificationRecord(notifId: string): Promise<void> {
  await deleteDoc(doc(db, 'notifications', notifId));
}

export async function fetchEmployeeContacts(
  user: UserProfile
): Promise<EmployeeContactOverride[]> {
  const col = collection(db, 'employeeContacts');
  const map = new Map<string, EmployeeContactOverride>();

  if (isBootstrapAdminEmail(user.email)) {
    const snap = await getDocs(col);
    for (const d of snap.docs) {
      map.set(d.id, d.data() as EmployeeContactOverride);
    }
  } else {
    const [byAdmin, bySelf] = await Promise.all([
      getDocs(query(col, where('adminViewerUids', 'array-contains', user.uid))).catch(() => null),
      getDocs(query(col, where('linkedUid', '==', user.uid))).catch(() => null),
    ]);
    for (const snap of [byAdmin, bySelf]) {
      if (!snap) continue;
      for (const d of snap.docs) {
        map.set(d.id, d.data() as EmployeeContactOverride);
      }
    }
  }

  return Array.from(map.values()).sort((a, b) =>
    a.employeeName.localeCompare(b.employeeName, 'id')
  );
}

export interface UpsertEmployeeContactInput {
  id?: string;
  erpContactId: number;
  erpContactCode: string;
  employeeName: string;
  linkedUid: string;
  divisionId: string;
  divisionName: string;
  jobTitle: string;
  email: string;
  whatsappPhone: string;
  notes: string;
}

export async function upsertEmployeeContact(
  actor: UserProfile,
  directory: DirectoryMember[],
  input: UpsertEmployeeContactInput
): Promise<EmployeeContactOverride> {
  const safeId =
    input.id && /^[a-zA-Z0-9_-]{1,128}$/.test(input.id)
      ? input.id
      : input.erpContactId > 0
        ? `erp_emp_${input.erpContactId}`
        : makeSafeId('emp_contact');

  const ref = doc(db, 'employeeContacts', safeId);
  const existingSnap = await getDoc(ref).catch(() => null);
  const adminUids = getAdminViewerUids(actor, directory);

  const basePayload = {
    id: safeId,
    erpContactId: Math.max(0, Math.round(Number(input.erpContactId) || 0)),
    erpContactCode: String(input.erpContactCode || '').trim().slice(0, 60),
    employeeName: String(input.employeeName || 'Karyawan').trim().slice(0, 120),
    linkedUid: String(input.linkedUid || '').trim().slice(0, 128),
    divisionId: String(input.divisionId || actor.divisionId || '').trim().slice(0, 128),
    divisionName: String(input.divisionName || '').trim().slice(0, 120),
    jobTitle: String(input.jobTitle || '').trim().slice(0, 120),
    email: String(input.email || '').trim().slice(0, 254),
    whatsappPhone: String(input.whatsappPhone || '').trim().slice(0, 40),
    notes: String(input.notes || '').trim().slice(0, 500),
    adminViewerUids: adminUids,
    updatedByUid: actor.uid,
    updatedByName: String(actor.displayName || 'Administrator').trim().slice(0, 120),
    updatedAt: serverTimestamp(),
  };

  if (existingSnap && existingSnap.exists()) {
    await updateDoc(ref, basePayload);
  } else {
    await setDoc(ref, {
      ...basePayload,
      createdAt: serverTimestamp(),
    });
  }

  const savedSnap = await getDoc(ref);
  if (savedSnap.exists()) {
    return savedSnap.data() as EmployeeContactOverride;
  }
  return {
    ...basePayload,
    createdAt: { seconds: Math.floor(Date.now() / 1000) },
    updatedAt: { seconds: Math.floor(Date.now() / 1000) },
  };
}

export async function deleteEmployeeContact(contactId: string): Promise<void> {
  await deleteDoc(doc(db, 'employeeContacts', contactId));
}

/**
 * Matches a PIC / meeting participant / SOP owner against Firestore contact overrides
 * AND live ERP m1_contact Employee records so reminders resolve Email + WhatsApp automatically.
 */
export function resolveEmployeeContact(
  target: { uid?: string; name: string; erpCode?: string },
  erpEmployees: ErpEmployeeRecord[],
  overrides: EmployeeContactOverride[],
  directory: DirectoryMember[]
): ResolvedRecipientContact {
  const normTargetName = normalizeNameForMatch(target.name);
  const targetTokens = normTargetName.split(' ').filter((tok) => tok.length >= 2);
  const targetCodeLower = String(target.erpCode || '').trim().toLowerCase();

  // 1. Find matching Firestore override
  const matchedOverride =
    overrides.find((o) => target.uid && o.linkedUid && o.linkedUid === target.uid) ||
    overrides.find(
      (o) => targetCodeLower && o.erpContactCode.trim().toLowerCase() === targetCodeLower
    ) ||
    overrides.find((o) => normalizeNameForMatch(o.employeeName) === normTargetName) ||
    null;

  // 2. Find matching ERP m1_contact employee
  const matchedErp =
    erpEmployees.find(
      (e) =>
        (matchedOverride && matchedOverride.erpContactId > 0 && e.id === matchedOverride.erpContactId) ||
        (targetCodeLower && e.code.trim().toLowerCase() === targetCodeLower)
    ) ||
    erpEmployees.find((e) => normalizeNameForMatch(e.name) === normTargetName) ||
    (targetTokens.length >= 1
      ? erpEmployees.find((e) => {
          const erpNorm = normalizeNameForMatch(e.name);
          if (!erpNorm) return false;
          if (erpNorm.includes(normTargetName) || normTargetName.includes(erpNorm)) return true;
          const erpTokens = erpNorm.split(' ').filter((tok) => tok.length >= 2);
          const overlap = targetTokens.filter((tok) => erpTokens.includes(tok)).length;
          return overlap >= Math.min(2, targetTokens.length);
        })
      : undefined) ||
    null;

  // 3. Find matching Directory UID if missing
  const matchedDir =
    directory.find((d) => target.uid && d.uid === target.uid) ||
    directory.find((d) => matchedOverride?.linkedUid && d.uid === matchedOverride.linkedUid) ||
    directory.find((d) => normalizeNameForMatch(d.displayName) === normTargetName) ||
    null;

  const email = (matchedOverride?.email || matchedErp?.email || '').trim();
  const phone = (matchedOverride?.whatsappPhone || matchedErp?.phone || matchedErp?.secondaryPhone || '').trim();
  const whatsappNormalized = normalizePhoneClient(phone) || matchedErp?.whatsappNormalized || '';

  let source: ResolvedRecipientContact['source'] = 'unmatched';
  if (matchedOverride && matchedErp) source = 'merged';
  else if (matchedOverride) source = 'override';
  else if (matchedErp) source = 'erp';

  return {
    uid: target.uid || matchedOverride?.linkedUid || matchedDir?.uid || '',
    name: target.name || matchedOverride?.employeeName || matchedErp?.name || 'Karyawan',
    erpCode: matchedErp?.code || matchedOverride?.erpContactCode || target.erpCode || '',
    erpContactId: matchedErp?.id || matchedOverride?.erpContactId || 0,
    email,
    phone,
    whatsappNormalized,
    division: matchedOverride?.divisionName || matchedErp?.division || matchedDir?.divisionName || '',
    jobTitle: matchedOverride?.jobTitle || matchedErp?.jobTitle || '',
    source,
  };
}

/**
 * Builds the unified system reminder queue across:
 * 1) Asset Maintenance Schedules (overdue / approaching due / upcoming <= 30 days)
 * 2) Meetings (upcoming within 7 days or currently in reminder window)
 * 3) Approved SOPs needing periodic review (past due or within 14 days)
 */
export function buildSystemReminderQueue(params: {
  schedules: AssetMaintenanceSchedule[];
  meetings: MeetingDocument[];
  sops: SopDocument[];
  erpEmployees: ErpEmployeeRecord[];
  overrides: EmployeeContactOverride[];
  directory: DirectoryMember[];
  nowMs?: number;
}): SystemReminderItem[] {
  const nowMs = params.nowMs ?? Date.now();
  const todayStart = new Date(nowMs);
  todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();
  const items: SystemReminderItem[] = [];

  // 1. Asset Maintenance Reminders
  for (const sch of params.schedules) {
    if (sch.status === 'Selesai' || sch.status === 'Dibatalkan') continue;
    const { effectiveStatus, daysUntilDue } = computeEffectiveMaintenanceStatus(sch, nowMs);
    if (effectiveStatus !== 'Terlambat' && effectiveStatus !== 'Mendekati Jatuh Tempo' && daysUntilDue > 30) {
      continue;
    }

    const priority: NotificationPriority =
      effectiveStatus === 'Terlambat'
        ? 'urgent'
        : effectiveStatus === 'Mendekati Jatuh Tempo'
          ? 'warning'
          : 'normal';

    const statusLine =
      daysUntilDue < 0
        ? `TERLAMBAT ${Math.abs(daysUntilDue)} hari (jatuh tempo: ${sch.dueDate})`
        : daysUntilDue === 0
          ? `JATUH TEMPO HARI INI (${sch.dueDate})`
          : `Jatuh tempo dalam ${daysUntilDue} hari (${sch.dueDate})`;

    const picResolved = resolveEmployeeContact(
      { uid: sch.picUid, name: sch.picName || sch.createdByName || 'PIC Aset' },
      params.erpEmployees,
      params.overrides,
      params.directory
    );

    const msgLines = [
      `Pengingat Maintenance Aset: ${sch.title}`,
      `Aset: [${sch.assetCode}] ${sch.assetName}${sch.plateOrSerial ? ` (${sch.plateOrSerial})` : ''}`,
      `Jenis Perawatan: ${sch.maintenanceType}`,
      `Status Jadwal: ${statusLine}`,
      sch.vendorName ? `Vendor/Bengkel: ${sch.vendorName}` : '',
      sch.estimatedCost > 0
        ? `Estimasi Biaya: Rp ${Math.round(sch.estimatedCost).toLocaleString('id-ID')}`
        : '',
      sch.notes ? `Catatan: ${sch.notes}` : '',
      'Mohon segera ditindaklanjuti dan perbarui status setelah perawatan selesai.',
    ].filter(Boolean);

    items.push({
      key: `maint_${sch.id}`,
      category: 'maintenance',
      priority,
      sourceType: 'ASSET_MAINTENANCE',
      sourceId: sch.id,
      sourceLabel: `${sch.assetCode} · ${sch.assetName}`,
      title: `[Maintenance] ${sch.title} — ${sch.assetName}`,
      subtitle: `${sch.maintenanceType} · ${statusLine}`,
      dueDate: sch.dueDate,
      daysDelta: daysUntilDue,
      defaultMessage: msgLines.join('\n'),
      divisionId: sch.divisionId,
      recipients: [picResolved],
    });
  }

  // 2. Meeting Reminders (from -30m up to +7 days)
  for (const mtg of params.meetings) {
    if (mtg.status !== 'Terjadwal' && mtg.status !== 'Berlangsung') continue;
    const diffMs = mtg.startAtMs - nowMs;
    const diffDays = Math.floor((mtg.startAtMs - todayMs) / 86_400_000);
    if (diffMs < -30 * 60_000 || diffDays > 7) continue;

    const diffMin = Math.round(diffMs / 60_000);
    const inReminderWindow = mtg.reminderMinutes > 0 && diffMin <= mtg.reminderMinutes;
    const priority: NotificationPriority =
      inReminderWindow || diffDays === 0 ? 'urgent' : diffDays === 1 ? 'warning' : 'normal';

    const recipients: ResolvedRecipientContact[] = [];
    const seenKeys = new Set<string>();
    const addTarget = (uid: string, name: string) => {
      const k = (uid || normalizeNameForMatch(name)).toLowerCase();
      if (!k || seenKeys.has(k)) return;
      seenKeys.add(k);
      recipients.push(
        resolveEmployeeContact(
          { uid, name },
          params.erpEmployees,
          params.overrides,
          params.directory
        )
      );
    };

    const pUids = Array.isArray(mtg.participantUids) ? mtg.participantUids : [];
    const pNames = Array.isArray(mtg.participantNames) ? mtg.participantNames : [];
    pUids.forEach((uid, idx) => {
      addTarget(uid, pNames[idx] || directoryNameByUid(params.directory, uid) || 'Peserta');
    });
    if (recipients.length === 0) {
      addTarget(mtg.organizerUid, mtg.organizerName || 'Penyelenggara');
    }

    const timingNote =
      diffMin <= 0
        ? 'Sedang berlangsung / dimulai sekarang'
        : diffMin < 120
          ? `Dimulai dalam ${diffMin} menit`
          : `Jadwal: ${mtg.date} pukul ${mtg.startTime}–${mtg.endTime}`;

    const msgLines = [
      `Pengingat Jadwal Meeting: ${mtg.title}`,
      `Tanggal & Waktu: ${mtg.date}, ${mtg.startTime}–${mtg.endTime}`,
      mtg.location ? `Lokasi / Tautan: ${mtg.location}` : '',
      `Penyelenggara: ${mtg.organizerName}${mtg.divisionName ? ` (${mtg.divisionName})` : ''}`,
      mtg.description ? `Agenda: ${mtg.description.slice(0, 400)}` : '',
      'Mohon kehadiran tepat waktu dan konfirmasi kehadiran Anda di aplikasi.',
    ].filter(Boolean);

    items.push({
      key: `mtg_${mtg.id}`,
      category: 'meeting',
      priority,
      sourceType: 'MEETING',
      sourceId: mtg.id,
      sourceLabel: `${mtg.date} ${mtg.startTime} · ${mtg.location || 'Meeting'}`,
      title: `[Meeting] ${mtg.title}`,
      subtitle: `${timingNote} · ${recipients.length} peserta`,
      dueDate: mtg.date,
      daysDelta: diffDays,
      defaultMessage: msgLines.join('\n'),
      divisionId: mtg.divisionId,
      recipients,
    });
  }

  // 3. SOP Review Overdue / Approaching Reminders
  for (const sop of params.sops) {
    if (sop.status !== 'Disetujui' || !sop.nextReviewDate) continue;
    const reviewTime = new Date(`${sop.nextReviewDate}T00:00:00`).getTime();
    if (Number.isNaN(reviewTime)) continue;
    const daysLeft = Math.round((reviewTime - todayMs) / 86_400_000);
    if (daysLeft > 14) continue;

    const priority: NotificationPriority = daysLeft <= 0 ? 'urgent' : 'warning';
    const ownerResolved = resolveEmployeeContact(
      { uid: sop.ownerUid || sop.createdByUid, name: sop.ownerName || sop.createdByName || 'SOP Owner' },
      params.erpEmployees,
      params.overrides,
      params.directory
    );

    const statusLine =
      daysLeft < 0
        ? `Lewat jadwal review ${Math.abs(daysLeft)} hari (${sop.nextReviewDate})`
        : daysLeft === 0
          ? `Jadwal review hari ini (${sop.nextReviewDate})`
          : `Jadwal review dalam ${daysLeft} hari (${sop.nextReviewDate})`;

    const msgLines = [
      `Pengingat Review Berkala SOP: [${sop.docNumber}] ${sop.title}`,
      `Divisi / Departemen: ${sop.divisionName} / ${sop.departmentName}`,
      `Versi Aktif: v${sop.version} | Status: ${statusLine}`,
      'Mohon lakukan tinjauan kesesuaian prosedur SOP ini dan perbarui jika terdapat perubahan kebijakan.',
    ];

    items.push({
      key: `sop_${sop.id}`,
      category: 'sop_review',
      priority,
      sourceType: 'SOP',
      sourceId: sop.id,
      sourceLabel: `${sop.docNumber} · ${sop.divisionName}`,
      title: `[Review SOP] ${sop.docNumber} — ${sop.title}`,
      subtitle: statusLine,
      dueDate: sop.nextReviewDate,
      daysDelta: daysLeft,
      defaultMessage: msgLines.join('\n'),
      divisionId: sop.divisionId,
      recipients: [ownerResolved],
    });
  }

  const priorityRank: Record<NotificationPriority, number> = { urgent: 0, warning: 1, normal: 2 };
  return items.sort((a, b) => {
    const pDiff = priorityRank[a.priority] - priorityRank[b.priority];
    if (pDiff !== 0) return pDiff;
    return a.daysDelta - b.daysDelta;
  });
}

function directoryNameByUid(directory: DirectoryMember[], uid: string): string {
  return directory.find((d) => d.uid === uid)?.displayName || '';
}
