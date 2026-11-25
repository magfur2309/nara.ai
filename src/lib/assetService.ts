import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  OperationType,
  db,
  getFreshIdToken,
  handleFirestoreError,
  isBootstrapAdminEmail,
} from './firebase';
import { makeSafeId, recordAuditLog } from './sopService';
import type {
  AssetCategory,
  AssetCondition,
  AssetMaintenanceSchedule,
  CompanyAsset,
  DirectoryMember,
  Division,
  MaintenanceHistoryEntry,
  MaintenanceStatus,
  MaintenanceType,
  UserProfile,
} from '../types/sop';

export const ASSET_CATEGORIES: AssetCategory[] = [
  'Kendaraan',
  'Meja',
  'Kursi',
  'Bangunan',
  'Elektronik & IT',
  'Mesin & Peralatan',
  'Lainnya',
];

export const ASSET_CONDITIONS: AssetCondition[] = [
  'Baik',
  'Perlu Perhatian',
  'Dalam Perbaikan',
  'Rusak / Nonaktif',
];

export const MAINTENANCE_TYPES: MaintenanceType[] = [
  'Servis Berkala',
  'Ganti Oli',
  'Bayar Pajak STNK',
  'Uji KIR',
  'Perpanjangan Asuransi',
  'Perawatan Bangunan / AC',
  'Inspeksi & Kalibrasi',
  'Perbaikan',
  'Lainnya',
];

export const MAINTENANCE_STATUSES: MaintenanceStatus[] = [
  'Terjadwal',
  'Mendekati Jatuh Tempo',
  'Terlambat',
  'Selesai',
  'Dibatalkan',
];

export const MAINTENANCE_TYPE_PRESETS: Record<
  MaintenanceType,
  { intervalMonths: number; intervalKm: number; reminderDaysBefore: number; defaultTitle: string }
> = {
  'Servis Berkala': {
    intervalMonths: 6,
    intervalKm: 10000,
    reminderDaysBefore: 14,
    defaultTitle: 'Servis Berkala Rutin',
  },
  'Ganti Oli': {
    intervalMonths: 3,
    intervalKm: 5000,
    reminderDaysBefore: 10,
    defaultTitle: 'Ganti Oli Mesin & Filter Oli',
  },
  'Bayar Pajak STNK': {
    intervalMonths: 12,
    intervalKm: 0,
    reminderDaysBefore: 30,
    defaultTitle: 'Pembayaran Pajak Tahunan STNK',
  },
  'Uji KIR': {
    intervalMonths: 6,
    intervalKm: 0,
    reminderDaysBefore: 21,
    defaultTitle: 'Uji Berkala KIR Kendaraan Niaga',
  },
  'Perpanjangan Asuransi': {
    intervalMonths: 12,
    intervalKm: 0,
    reminderDaysBefore: 30,
    defaultTitle: 'Perpanjangan Polis Asuransi Aset',
  },
  'Perawatan Bangunan / AC': {
    intervalMonths: 3,
    intervalKm: 0,
    reminderDaysBefore: 14,
    defaultTitle: 'Perawatan Berkala Gedung & Unit AC',
  },
  'Inspeksi & Kalibrasi': {
    intervalMonths: 6,
    intervalKm: 0,
    reminderDaysBefore: 14,
    defaultTitle: 'Inspeksi Keselamatan & Kalibrasi Peralatan',
  },
  Perbaikan: {
    intervalMonths: 0,
    intervalKm: 0,
    reminderDaysBefore: 7,
    defaultTitle: 'Perbaikan Aset',
  },
  Lainnya: {
    intervalMonths: 0,
    intervalKm: 0,
    reminderDaysBefore: 14,
    defaultTitle: 'Jadwal Pemeliharaan Aset',
  },
};

export function formatIsoDateLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDaysIso(baseDate: Date, days: number): string {
  const copy = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  copy.setDate(copy.getDate() + days);
  return formatIsoDateLocal(copy);
}

export function addMonthsIso(isoDate: string, months: number): string {
  const parsed = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    const fallback = new Date();
    fallback.setMonth(fallback.getMonth() + months);
    return formatIsoDateLocal(fallback);
  }
  const targetMonth = parsed.getMonth() + months;
  const origDay = parsed.getDate();
  const next = new Date(parsed.getFullYear(), targetMonth, 1);
  const lastDayOfTarget = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(origDay, lastDayOfTarget));
  return formatIsoDateLocal(next);
}

export function computeDueAtMs(dueDate: string): number {
  if (!dueDate) return Date.now();
  const parsed = new Date(`${dueDate}T09:00:00`);
  const ms = parsed.getTime();
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : Date.now();
}

export function computeEffectiveMaintenanceStatus(
  schedule: Pick<AssetMaintenanceSchedule, 'dueDate' | 'reminderDaysBefore' | 'status'>,
  nowMs = Date.now()
): {
  effectiveStatus: MaintenanceStatus;
  daysUntilDue: number;
  urgencyLabel: string;
} {
  const nowDate = new Date(nowMs);
  const todayStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();
  const parsedDue = new Date(`${schedule.dueDate}T00:00:00`);
  const dueStart = Number.isNaN(parsedDue.getTime()) ? todayStart : parsedDue.getTime();
  const daysUntilDue = Math.round((dueStart - todayStart) / 86_400_000);

  if (schedule.status === 'Selesai') {
    return { effectiveStatus: 'Selesai', daysUntilDue, urgencyLabel: 'Selesai' };
  }
  if (schedule.status === 'Dibatalkan') {
    return { effectiveStatus: 'Dibatalkan', daysUntilDue, urgencyLabel: 'Dibatalkan' };
  }
  if (daysUntilDue < 0) {
    return {
      effectiveStatus: 'Terlambat',
      daysUntilDue,
      urgencyLabel: `Terlambat ${Math.abs(daysUntilDue)} hari`,
    };
  }
  if (daysUntilDue === 0) {
    return {
      effectiveStatus: 'Mendekati Jatuh Tempo',
      daysUntilDue: 0,
      urgencyLabel: 'Jatuh tempo hari ini',
    };
  }
  const lead = Math.max(1, schedule.reminderDaysBefore || 14);
  if (daysUntilDue <= lead) {
    return {
      effectiveStatus: 'Mendekati Jatuh Tempo',
      daysUntilDue,
      urgencyLabel: `H-${daysUntilDue} hari`,
    };
  }
  return {
    effectiveStatus: 'Terjadwal',
    daysUntilDue,
    urgencyLabel: `${daysUntilDue} hari lagi`,
  };
}

export function computeAssetViewerUids(params: {
  createdByUid: string;
  picUid: string;
  divisionId: string;
  directory: DirectoryMember[];
}): string[] {
  const set = new Set<string>();
  if (params.createdByUid) set.add(params.createdByUid);
  if (params.picUid) set.add(params.picUid);
  for (const m of params.directory) {
    if (m.role === 'Super Admin') {
      set.add(m.uid);
    } else if (
      params.divisionId &&
      m.role === 'Admin Divisi' &&
      m.divisionId === params.divisionId
    ) {
      set.add(m.uid);
    }
  }
  return Array.from(set).slice(0, 200);
}

export async function invalidateServerAssetCache(fallbackToken?: string): Promise<void> {
  try {
    const token = await getFreshIdToken(fallbackToken);
    if (!token) return;
    await fetch('/api/assets/invalidate-cache', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // Non-blocking cache invalidation
  }
}

export function sortAssets(list: CompanyAsset[]): CompanyAsset[] {
  return [...list].sort((a, b) => {
    if (a.category !== b.category) {
      return ASSET_CATEGORIES.indexOf(a.category) - ASSET_CATEGORIES.indexOf(b.category);
    }
    return a.assetCode.localeCompare(b.assetCode, 'id-ID');
  });
}

export function sortMaintenanceSchedules(
  list: AssetMaintenanceSchedule[],
  nowMs = Date.now()
): AssetMaintenanceSchedule[] {
  const rankOrder: Record<MaintenanceStatus, number> = {
    Terlambat: 0,
    'Mendekati Jatuh Tempo': 1,
    Terjadwal: 2,
    Selesai: 3,
    Dibatalkan: 4,
  };
  return [...list].sort((a, b) => {
    const sa = computeEffectiveMaintenanceStatus(a, nowMs);
    const sb = computeEffectiveMaintenanceStatus(b, nowMs);
    if (rankOrder[sa.effectiveStatus] !== rankOrder[sb.effectiveStatus]) {
      return rankOrder[sa.effectiveStatus] - rankOrder[sb.effectiveStatus];
    }
    if (sa.effectiveStatus === 'Selesai' || sa.effectiveStatus === 'Dibatalkan') {
      return b.dueAtMs - a.dueAtMs;
    }
    return a.dueAtMs - b.dueAtMs;
  });
}

export async function fetchAccessibleAssets(user: UserProfile): Promise<CompanyAsset[]> {
  try {
    if (isBootstrapAdminEmail(user.email)) {
      const snap = await getDocs(collection(db, 'assets'));
      return sortAssets(snap.docs.map((d) => d.data() as CompanyAsset));
    }

    const [publicSnap, viewerSnap, picSnap, ownSnap] = await Promise.all([
      getDocs(query(collection(db, 'assets'), where('isPublic', '==', true))),
      getDocs(query(collection(db, 'assets'), where('viewerUids', 'array-contains', user.uid))),
      getDocs(query(collection(db, 'assets'), where('picUid', '==', user.uid))),
      getDocs(query(collection(db, 'assets'), where('createdByUid', '==', user.uid))),
    ]);

    const map = new Map<string, CompanyAsset>();
    for (const snap of [publicSnap, viewerSnap, picSnap, ownSnap]) {
      for (const d of snap.docs) {
        const data = d.data() as CompanyAsset;
        map.set(data.id, data);
      }
    }
    return sortAssets(Array.from(map.values()));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'assets');
  }
}

export async function fetchAccessibleMaintenanceSchedules(
  user: UserProfile
): Promise<AssetMaintenanceSchedule[]> {
  try {
    if (isBootstrapAdminEmail(user.email)) {
      const snap = await getDocs(collection(db, 'maintenanceSchedules'));
      return sortMaintenanceSchedules(snap.docs.map((d) => d.data() as AssetMaintenanceSchedule));
    }

    const [publicSnap, viewerSnap, picSnap, ownSnap] = await Promise.all([
      getDocs(query(collection(db, 'maintenanceSchedules'), where('isPublic', '==', true))),
      getDocs(
        query(
          collection(db, 'maintenanceSchedules'),
          where('viewerUids', 'array-contains', user.uid)
        )
      ),
      getDocs(query(collection(db, 'maintenanceSchedules'), where('picUid', '==', user.uid))),
      getDocs(
        query(collection(db, 'maintenanceSchedules'), where('createdByUid', '==', user.uid))
      ),
    ]);

    const map = new Map<string, AssetMaintenanceSchedule>();
    for (const snap of [publicSnap, viewerSnap, picSnap, ownSnap]) {
      for (const d of snap.docs) {
        const data = d.data() as AssetMaintenanceSchedule;
        map.set(data.id, data);
      }
    }
    return sortMaintenanceSchedules(Array.from(map.values()));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'maintenanceSchedules');
  }
}

export interface CreateAssetInput {
  assetCode: string;
  name: string;
  category: AssetCategory;
  subCategory: string;
  quantity: number;
  unit: string;
  condition: AssetCondition;
  location: string;
  divisionId: string;
  divisionName: string;
  picUid: string;
  picName: string;
  plateOrSerial: string;
  brandModel: string;
  purchaseDate: string;
  currentOdometerKm: number;
  notes: string;
  isPublic?: boolean;
}

export async function createCompanyAsset(params: {
  input: CreateAssetInput;
  actor: UserProfile;
  directory: DirectoryMember[];
  idToken?: string;
}): Promise<CompanyAsset> {
  const { input, actor, directory, idToken } = params;
  const id = makeSafeId('ast');
  const viewerUids = computeAssetViewerUids({
    createdByUid: actor.uid,
    picUid: input.picUid,
    divisionId: input.divisionId,
    directory,
  });

  const cleanDoc: CompanyAsset = {
    id,
    assetCode: (input.assetCode.trim() || `AST-${Date.now().toString().slice(-4)}`).slice(0, 40),
    name: input.name.trim().slice(0, 160),
    category: input.category,
    subCategory: input.subCategory.trim().slice(0, 80),
    quantity: Math.max(1, Math.min(100000, Math.round(Number(input.quantity) || 1))),
    unit: (input.unit.trim() || 'Unit').slice(0, 30),
    condition: input.condition,
    location: input.location.trim().slice(0, 160),
    divisionId: input.divisionId.slice(0, 128),
    divisionName: (input.divisionName || 'Umum').slice(0, 120),
    picUid: input.picUid.slice(0, 128),
    picName: (input.picName.trim() || actor.displayName).slice(0, 120),
    plateOrSerial: input.plateOrSerial.trim().slice(0, 80),
    brandModel: input.brandModel.trim().slice(0, 120),
    purchaseDate: input.purchaseDate.trim().slice(0, 20),
    currentOdometerKm: Math.max(
      0,
      Math.min(10000000, Math.round(Number(input.currentOdometerKm) || 0))
    ),
    notes: input.notes.trim().slice(0, 2000),
    isPublic: input.isPublic !== false,
    viewerUids,
    createdByUid: actor.uid,
    createdByName: actor.displayName.slice(0, 120),
  };

  try {
    await setDoc(doc(db, 'assets', id), {
      ...cleanDoc,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `assets/${id}`);
  }

  await recordAuditLog({
    actor,
    action: 'Tambah Aset Perusahaan',
    targetType: 'ASSET',
    targetId: id,
    targetLabel: `${cleanDoc.assetCode} — ${cleanDoc.name}`,
    divisionId: cleanDoc.divisionId || 'general',
    detail: `Kategori: ${cleanDoc.category} · Jumlah: ${cleanDoc.quantity} ${cleanDoc.unit} · Kondisi: ${cleanDoc.condition}`,
    directory,
  });

  void invalidateServerAssetCache(idToken);
  return cleanDoc;
}

export async function updateCompanyAsset(params: {
  asset: CompanyAsset;
  updates: CreateAssetInput;
  actor: UserProfile;
  directory: DirectoryMember[];
  idToken?: string;
}): Promise<CompanyAsset> {
  const { asset, updates, actor, directory, idToken } = params;
  const viewerUids = computeAssetViewerUids({
    createdByUid: asset.createdByUid,
    picUid: updates.picUid,
    divisionId: updates.divisionId,
    directory,
  });

  const nextAsset: CompanyAsset = {
    ...asset,
    assetCode: (updates.assetCode.trim() || asset.assetCode).slice(0, 40),
    name: updates.name.trim().slice(0, 160),
    category: updates.category,
    subCategory: updates.subCategory.trim().slice(0, 80),
    quantity: Math.max(1, Math.min(100000, Math.round(Number(updates.quantity) || 1))),
    unit: (updates.unit.trim() || 'Unit').slice(0, 30),
    condition: updates.condition,
    location: updates.location.trim().slice(0, 160),
    divisionId: updates.divisionId.slice(0, 128),
    divisionName: (updates.divisionName || 'Umum').slice(0, 120),
    picUid: updates.picUid.slice(0, 128),
    picName: (updates.picName.trim() || asset.picName).slice(0, 120),
    plateOrSerial: updates.plateOrSerial.trim().slice(0, 80),
    brandModel: updates.brandModel.trim().slice(0, 120),
    purchaseDate: updates.purchaseDate.trim().slice(0, 20),
    currentOdometerKm: Math.max(
      0,
      Math.min(10000000, Math.round(Number(updates.currentOdometerKm) || 0))
    ),
    notes: updates.notes.trim().slice(0, 2000),
    isPublic: updates.isPublic !== false,
    viewerUids,
  };

  try {
    await updateDoc(doc(db, 'assets', asset.id), {
      assetCode: nextAsset.assetCode,
      name: nextAsset.name,
      category: nextAsset.category,
      subCategory: nextAsset.subCategory,
      quantity: nextAsset.quantity,
      unit: nextAsset.unit,
      condition: nextAsset.condition,
      location: nextAsset.location,
      divisionId: nextAsset.divisionId,
      divisionName: nextAsset.divisionName,
      picUid: nextAsset.picUid,
      picName: nextAsset.picName,
      plateOrSerial: nextAsset.plateOrSerial,
      brandModel: nextAsset.brandModel,
      purchaseDate: nextAsset.purchaseDate,
      currentOdometerKm: nextAsset.currentOdometerKm,
      notes: nextAsset.notes,
      isPublic: nextAsset.isPublic,
      viewerUids: nextAsset.viewerUids,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `assets/${asset.id}`);
  }

  await recordAuditLog({
    actor,
    action: 'Perbarui Data Aset',
    targetType: 'ASSET',
    targetId: asset.id,
    targetLabel: `${nextAsset.assetCode} — ${nextAsset.name}`,
    divisionId: nextAsset.divisionId || 'general',
    detail: `Kategori: ${nextAsset.category} · Jumlah: ${nextAsset.quantity} ${nextAsset.unit} · Kondisi: ${nextAsset.condition}`,
    directory,
  });

  void invalidateServerAssetCache(idToken);
  return nextAsset;
}

export async function deleteCompanyAsset(params: {
  asset: CompanyAsset;
  relatedSchedules: AssetMaintenanceSchedule[];
  actor: UserProfile;
  directory: DirectoryMember[];
  idToken?: string;
}): Promise<void> {
  const { asset, relatedSchedules, actor, directory, idToken } = params;
  try {
    for (const sch of relatedSchedules) {
      await deleteDoc(doc(db, 'maintenanceSchedules', sch.id));
    }
    await deleteDoc(doc(db, 'assets', asset.id));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `assets/${asset.id}`);
  }

  await recordAuditLog({
    actor,
    action: 'Hapus Aset Perusahaan',
    targetType: 'ASSET',
    targetId: asset.id,
    targetLabel: `${asset.assetCode} — ${asset.name}`,
    divisionId: asset.divisionId || 'general',
    detail: `Menghapus aset (${asset.quantity} ${asset.unit}) beserta ${relatedSchedules.length} jadwal maintenance terkait`,
    directory,
  });

  void invalidateServerAssetCache(idToken);
}

export interface CreateMaintenanceInput {
  asset: CompanyAsset;
  maintenanceType: MaintenanceType;
  title: string;
  dueDate: string;
  intervalMonths: number;
  intervalKm: number;
  targetOdometerKm: number;
  reminderDaysBefore: number;
  estimatedCost: number;
  vendorName: string;
  picUid: string;
  picName: string;
  notes: string;
  lastCompletedDate?: string;
  status?: MaintenanceStatus;
}

export async function createMaintenanceSchedule(params: {
  input: CreateMaintenanceInput;
  actor: UserProfile;
  directory: DirectoryMember[];
  idToken?: string;
}): Promise<AssetMaintenanceSchedule> {
  const { input, actor, directory, idToken } = params;
  const id = makeSafeId('mnt');
  const dueDate = input.dueDate.trim().slice(0, 20);
  const dueAtMs = computeDueAtMs(dueDate);
  const reminderDaysBefore = Math.max(
    0,
    Math.min(180, Math.round(Number(input.reminderDaysBefore) || 14))
  );
  const baseStatus: MaintenanceStatus =
    input.status ||
    computeEffectiveMaintenanceStatus({
      dueDate,
      reminderDaysBefore,
      status: 'Terjadwal',
    }).effectiveStatus;

  const viewerUids = computeAssetViewerUids({
    createdByUid: actor.uid,
    picUid: input.picUid || input.asset.picUid,
    divisionId: input.asset.divisionId,
    directory,
  });

  const cleanDoc: AssetMaintenanceSchedule = {
    id,
    assetId: input.asset.id,
    assetCode: input.asset.assetCode.slice(0, 40),
    assetName: input.asset.name.slice(0, 160),
    assetCategory: input.asset.category,
    plateOrSerial: input.asset.plateOrSerial.slice(0, 80),
    maintenanceType: input.maintenanceType,
    title: (input.title.trim() || MAINTENANCE_TYPE_PRESETS[input.maintenanceType].defaultTitle).slice(
      0,
      200
    ),
    dueDate,
    dueAtMs,
    intervalMonths: Math.max(0, Math.min(120, Math.round(Number(input.intervalMonths) || 0))),
    intervalKm: Math.max(0, Math.min(500000, Math.round(Number(input.intervalKm) || 0))),
    targetOdometerKm: Math.max(
      0,
      Math.min(10000000, Math.round(Number(input.targetOdometerKm) || 0))
    ),
    reminderDaysBefore,
    status: baseStatus,
    lastCompletedDate: (input.lastCompletedDate || '').trim().slice(0, 20),
    estimatedCost: Math.max(
      0,
      Math.min(10000000000, Math.round(Number(input.estimatedCost) || 0))
    ),
    vendorName: input.vendorName.trim().slice(0, 160),
    picUid: (input.picUid || input.asset.picUid).slice(0, 128),
    picName: (input.picName.trim() || input.asset.picName || actor.displayName).slice(0, 120),
    divisionId: input.asset.divisionId.slice(0, 128),
    divisionName: (input.asset.divisionName || 'Umum').slice(0, 120),
    notes: input.notes.trim().slice(0, 2000),
    history: [],
    isPublic: input.asset.isPublic !== false,
    viewerUids,
    createdByUid: actor.uid,
    createdByName: actor.displayName.slice(0, 120),
  };

  try {
    await setDoc(doc(db, 'maintenanceSchedules', id), {
      ...cleanDoc,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `maintenanceSchedules/${id}`);
  }

  await recordAuditLog({
    actor,
    action: 'Buat Jadwal Maintenance',
    targetType: 'MAINTENANCE',
    targetId: id,
    targetLabel: `${cleanDoc.maintenanceType} — ${cleanDoc.assetName}`,
    divisionId: cleanDoc.divisionId || 'general',
    detail: `Jatuh tempo: ${cleanDoc.dueDate}${
      cleanDoc.intervalMonths > 0 ? ` · Siklus per ${cleanDoc.intervalMonths} bulan` : ''
    }`,
    directory,
  });

  void invalidateServerAssetCache(idToken);
  return cleanDoc;
}

export async function updateMaintenanceSchedule(params: {
  schedule: AssetMaintenanceSchedule;
  updates: {
    maintenanceType: MaintenanceType;
    title: string;
    dueDate: string;
    intervalMonths: number;
    intervalKm: number;
    targetOdometerKm: number;
    reminderDaysBefore: number;
    status: MaintenanceStatus;
    estimatedCost: number;
    vendorName: string;
    picUid: string;
    picName: string;
    notes: string;
  };
  actor: UserProfile;
  directory: DirectoryMember[];
  idToken?: string;
}): Promise<AssetMaintenanceSchedule> {
  const { schedule, updates, actor, directory, idToken } = params;
  const dueDate = updates.dueDate.trim().slice(0, 20);
  const dueAtMs = computeDueAtMs(dueDate);
  const viewerUids = computeAssetViewerUids({
    createdByUid: schedule.createdByUid,
    picUid: updates.picUid,
    divisionId: schedule.divisionId,
    directory,
  });

  const nextSchedule: AssetMaintenanceSchedule = {
    ...schedule,
    maintenanceType: updates.maintenanceType,
    title: updates.title.trim().slice(0, 200),
    dueDate,
    dueAtMs,
    intervalMonths: Math.max(0, Math.min(120, Math.round(Number(updates.intervalMonths) || 0))),
    intervalKm: Math.max(0, Math.min(500000, Math.round(Number(updates.intervalKm) || 0))),
    targetOdometerKm: Math.max(
      0,
      Math.min(10000000, Math.round(Number(updates.targetOdometerKm) || 0))
    ),
    reminderDaysBefore: Math.max(
      0,
      Math.min(180, Math.round(Number(updates.reminderDaysBefore) || 14))
    ),
    status: updates.status,
    estimatedCost: Math.max(
      0,
      Math.min(10000000000, Math.round(Number(updates.estimatedCost) || 0))
    ),
    vendorName: updates.vendorName.trim().slice(0, 160),
    picUid: updates.picUid.slice(0, 128),
    picName: (updates.picName.trim() || schedule.picName).slice(0, 120),
    notes: updates.notes.trim().slice(0, 2000),
    viewerUids,
  };

  try {
    await updateDoc(doc(db, 'maintenanceSchedules', schedule.id), {
      maintenanceType: nextSchedule.maintenanceType,
      title: nextSchedule.title,
      dueDate: nextSchedule.dueDate,
      dueAtMs: nextSchedule.dueAtMs,
      intervalMonths: nextSchedule.intervalMonths,
      intervalKm: nextSchedule.intervalKm,
      targetOdometerKm: nextSchedule.targetOdometerKm,
      reminderDaysBefore: nextSchedule.reminderDaysBefore,
      status: nextSchedule.status,
      estimatedCost: nextSchedule.estimatedCost,
      vendorName: nextSchedule.vendorName,
      picUid: nextSchedule.picUid,
      picName: nextSchedule.picName,
      notes: nextSchedule.notes,
      viewerUids: nextSchedule.viewerUids,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `maintenanceSchedules/${schedule.id}`);
  }

  await recordAuditLog({
    actor,
    action: 'Perbarui Jadwal Maintenance',
    targetType: 'MAINTENANCE',
    targetId: schedule.id,
    targetLabel: `${nextSchedule.maintenanceType} — ${nextSchedule.assetName}`,
    divisionId: nextSchedule.divisionId || 'general',
    detail: `Jatuh tempo: ${nextSchedule.dueDate} · Status: ${nextSchedule.status}`,
    directory,
  });

  void invalidateServerAssetCache(idToken);
  return nextSchedule;
}

export async function completeMaintenanceSchedule(params: {
  schedule: AssetMaintenanceSchedule;
  asset?: CompanyAsset;
  completedDate: string;
  vendorName: string;
  actualCost: number;
  odometerKm: number;
  notes: string;
  autoRollover: boolean;
  actor: UserProfile;
  directory: DirectoryMember[];
  idToken?: string;
}): Promise<{ schedule: AssetMaintenanceSchedule; updatedAsset?: CompanyAsset }> {
  const {
    schedule,
    asset,
    completedDate,
    vendorName,
    actualCost,
    odometerKm,
    notes,
    autoRollover,
    actor,
    directory,
    idToken,
  } = params;

  const cleanDate = (completedDate.trim() || formatIsoDateLocal(new Date())).slice(0, 20);
  const cleanCost = Math.max(0, Math.min(10000000000, Math.round(Number(actualCost) || 0)));
  const cleanOdo = Math.max(0, Math.min(10000000, Math.round(Number(odometerKm) || 0)));
  const cleanVendor = (vendorName.trim() || schedule.vendorName).slice(0, 160);

  const historyEntry: MaintenanceHistoryEntry = {
    id: makeSafeId('hist'),
    completedDate: cleanDate,
    performedByName: actor.displayName.slice(0, 120),
    vendorName: cleanVendor,
    cost: cleanCost,
    odometerKm: cleanOdo,
    notes: notes.trim().slice(0, 500),
  };

  const nextHistory = [historyEntry, ...(schedule.history || [])].slice(0, 50);
  const shouldAdvance = autoRollover && schedule.intervalMonths > 0;
  const nextDueDate = shouldAdvance
    ? addMonthsIso(cleanDate, schedule.intervalMonths)
    : schedule.dueDate;
  const nextDueAtMs = computeDueAtMs(nextDueDate);
  const nextTargetOdo =
    shouldAdvance && schedule.intervalKm > 0
      ? Math.min(
          10000000,
          (cleanOdo > 0 ? cleanOdo : schedule.targetOdometerKm || 0) + schedule.intervalKm
        )
      : schedule.targetOdometerKm;

  const nextStatus: MaintenanceStatus = shouldAdvance
    ? computeEffectiveMaintenanceStatus({
        dueDate: nextDueDate,
        reminderDaysBefore: schedule.reminderDaysBefore,
        status: 'Terjadwal',
      }).effectiveStatus
    : 'Selesai';

  try {
    await updateDoc(doc(db, 'maintenanceSchedules', schedule.id), {
      status: nextStatus,
      dueDate: nextDueDate,
      dueAtMs: nextDueAtMs,
      targetOdometerKm: nextTargetOdo,
      lastCompletedDate: cleanDate,
      vendorName: cleanVendor,
      estimatedCost: cleanCost > 0 ? cleanCost : schedule.estimatedCost,
      history: nextHistory,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `maintenanceSchedules/${schedule.id}`);
  }

  let updatedAsset: CompanyAsset | undefined;
  if (asset && cleanOdo > (asset.currentOdometerKm || 0)) {
    try {
      await updateDoc(doc(db, 'assets', asset.id), {
        currentOdometerKm: cleanOdo,
        updatedAt: serverTimestamp(),
      });
      updatedAsset = { ...asset, currentOdometerKm: cleanOdo };
    } catch {
      // Non-critical if user lacks asset update permission
    }
  }

  await recordAuditLog({
    actor,
    action: 'Selesaikan Maintenance Aset',
    targetType: 'MAINTENANCE',
    targetId: schedule.id,
    targetLabel: `${schedule.maintenanceType} — ${schedule.assetName}`,
    divisionId: schedule.divisionId || 'general',
    detail: shouldAdvance
      ? `Selesai ${cleanDate} · Jadwal siklus berikutnya otomatis ke ${nextDueDate}`
      : `Selesai ${cleanDate} · Biaya Rp ${cleanCost.toLocaleString('id-ID')}`,
    directory,
  });

  void invalidateServerAssetCache(idToken);

  return {
    schedule: {
      ...schedule,
      status: nextStatus,
      dueDate: nextDueDate,
      dueAtMs: nextDueAtMs,
      targetOdometerKm: nextTargetOdo,
      lastCompletedDate: cleanDate,
      vendorName: cleanVendor,
      estimatedCost: cleanCost > 0 ? cleanCost : schedule.estimatedCost,
      history: nextHistory,
    },
    updatedAsset,
  };
}

export async function deleteMaintenanceSchedule(params: {
  schedule: AssetMaintenanceSchedule;
  actor: UserProfile;
  directory: DirectoryMember[];
  idToken?: string;
}): Promise<void> {
  const { schedule, actor, directory, idToken } = params;
  try {
    await deleteDoc(doc(db, 'maintenanceSchedules', schedule.id));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `maintenanceSchedules/${schedule.id}`);
  }

  await recordAuditLog({
    actor,
    action: 'Hapus Jadwal Maintenance',
    targetType: 'MAINTENANCE',
    targetId: schedule.id,
    targetLabel: `${schedule.maintenanceType} — ${schedule.assetName}`,
    divisionId: schedule.divisionId || 'general',
    detail: `Menghapus jadwal jatuh tempo ${schedule.dueDate}`,
    directory,
  });

  void invalidateServerAssetCache(idToken);
}

export const SAMPLE_ASSET_CODES = [
  'KND-001',
  'KND-002',
  'KND-003',
  'KND-004',
  'MJ-001',
  'MJ-002',
  'KR-001',
  'KR-002',
  'BGN-001',
  'BGN-002',
  'IT-001',
  'IT-002',
  'MSN-001',
  'MSN-002',
  'AST-001',
] as const;

export async function seedSampleAssetsAndMaintenance(params: {
  actor: UserProfile;
  divisions: Division[];
  directory: DirectoryMember[];
  existingAssets?: CompanyAsset[];
  existingSchedules?: AssetMaintenanceSchedule[];
  idToken?: string;
  onProgress?: (label: string) => void;
}): Promise<{
  assets: CompanyAsset[];
  schedules: AssetMaintenanceSchedule[];
  createdAssetCount: number;
  createdScheduleCount: number;
}> {
  const {
    actor,
    divisions,
    directory,
    existingAssets = [],
    existingSchedules = [],
    idToken,
    onProgress,
  } = params;

  const gaDiv =
    divisions.find((d) => /operasional|umum|ga|logistik/i.test(d.name)) || divisions[0];
  const actorDiv = divisions.find((d) => d.id === actor.divisionId);
  // Respect Division Admin write scope in firestore.rules
  const divId =
    actor.role === 'Admin Divisi' && actor.divisionId
      ? actor.divisionId
      : gaDiv?.id || actor.divisionId || '';
  const divName =
    actor.role === 'Admin Divisi' && actor.divisionId
      ? actorDiv?.name || actor.divisionName || 'Divisi Operasional'
      : gaDiv?.name || actor.divisionName || 'Operasional & GA';
  const today = new Date();

  onProgress?.('Membuat contoh data inventaris aset perusahaan...');

  const sampleAssetsInput: CreateAssetInput[] = [
    {
      assetCode: 'KND-001',
      name: 'Toyota Avanza Veloz 1.5 Operasional',
      category: 'Kendaraan',
      subCategory: 'Mobil Operasional',
      quantity: 1,
      unit: 'Unit',
      condition: 'Baik',
      location: 'Pool Kantor Pusat',
      divisionId: divId,
      divisionName: divName,
      picUid: actor.uid,
      picName: actor.displayName,
      plateOrSerial: 'B 1842 KOP',
      brandModel: 'Toyota Avanza Veloz 2023',
      purchaseDate: '2023-04-15',
      currentOdometerKm: 34200,
      notes: 'Kendaraan operasional kunjungan klien & manajemen.',
    },
    {
      assetCode: 'KND-002',
      name: 'Mitsubishi L300 Box Distribusi',
      category: 'Kendaraan',
      subCategory: 'Kendaraan Niaga / Box',
      quantity: 1,
      unit: 'Unit',
      condition: 'Perlu Perhatian',
      location: 'Gudang Distribusi Cikarang',
      divisionId: divId,
      divisionName: divName,
      picUid: actor.uid,
      picName: actor.displayName,
      plateOrSerial: 'B 9210 UCE',
      brandModel: 'Mitsubishi Colt L300 Euro 4 2022',
      purchaseDate: '2022-08-10',
      currentOdometerKm: 68500,
      notes: 'Armada pengiriman harian Jabodetabek. Wajib Uji KIR 6 bulanan.',
    },
    {
      assetCode: 'KND-003',
      name: 'Isuzu Elf NMR 71 Wingbox',
      category: 'Kendaraan',
      subCategory: 'Truk Logistik',
      quantity: 1,
      unit: 'Unit',
      condition: 'Baik',
      location: 'Gudang Distribusi Cikarang',
      divisionId: divId,
      divisionName: divName,
      picUid: actor.uid,
      picName: actor.displayName,
      plateOrSerial: 'B 9445 TXA',
      brandModel: 'Isuzu NMR 71 HD 2021',
      purchaseDate: '2021-11-20',
      currentOdometerKm: 112400,
      notes: 'Pengiriman antarkota & distribusi cabang. Wajib Uji KIR 6 bulanan.',
    },
    {
      assetCode: 'KND-004',
      name: 'Honda Vario 160 Kurir Dokumen',
      category: 'Kendaraan',
      subCategory: 'Sepeda Motor Operasional',
      quantity: 2,
      unit: 'Unit',
      condition: 'Baik',
      location: 'Parkir Motor Kantor Pusat',
      divisionId: divId,
      divisionName: divName,
      picUid: actor.uid,
      picName: actor.displayName,
      plateOrSerial: 'B 4512 KMR / B 4513 KMR',
      brandModel: 'Honda Vario 160 CBS 2024',
      purchaseDate: '2024-02-05',
      currentOdometerKm: 12800,
      notes: 'Motor kurir antar dokumen pajak, bank, dan operasional ringan.',
    },
    {
      assetCode: 'MJ-001',
      name: 'Meja Kerja Staff Workstation 120cm',
      category: 'Meja',
      subCategory: 'Meja Kerja',
      quantity: 24,
      unit: 'Buah',
      condition: 'Baik',
      location: 'Kantor Pusat Lantai 1 & 2',
      divisionId: divId,
      divisionName: divName,
      picUid: actor.uid,
      picName: actor.displayName,
      plateOrSerial: 'INV-MJ-2023-01..24',
      brandModel: 'Informa Modular Desk 120x60',
      purchaseDate: '2023-01-12',
      currentOdometerKm: 0,
      notes: 'Tersebar di area Finance, HR, Operasional, dan IT.',
    },
    {
      assetCode: 'MJ-002',
      name: 'Meja Ruang Meeting Utama 12 Orang',
      category: 'Meja',
      subCategory: 'Meja Meeting',
      quantity: 2,
      unit: 'Buah',
      condition: 'Baik',
      location: 'Ruang Meeting Merpati & Garuda',
      divisionId: divId,
      divisionName: divName,
      picUid: actor.uid,
      picName: actor.displayName,
      plateOrSerial: 'INV-MJ-MTG-01..02',
      brandModel: 'Custom HPL Oak 360x120',
      purchaseDate: '2023-03-01',
      currentOdometerKm: 0,
      notes: 'Dilengkapi jalur stopkontak & kabel HDMI tanam.',
    },
    {
      assetCode: 'KR-001',
      name: 'Kursi Kerja Ergonomis Mesh Staff',
      category: 'Kursi',
      subCategory: 'Kursi Kerja',
      quantity: 28,
      unit: 'Buah',
      condition: 'Baik',
      location: 'Kantor Pusat Lantai 1 & 2',
      divisionId: divId,
      divisionName: divName,
      picUid: actor.uid,
      picName: actor.displayName,
      plateOrSerial: 'INV-KR-2023-01..28',
      brandModel: 'Ergotech High-Back Mesh',
      purchaseDate: '2023-01-12',
      currentOdometerKm: 0,
      notes: 'Cek berkala hidrolik & roda kursi setiap 6 bulan.',
    },
    {
      assetCode: 'KR-002',
      name: 'Kursi Ruang Meeting & Tamu Lobby',
      category: 'Kursi',
      subCategory: 'Kursi Meeting & Tamu',
      quantity: 30,
      unit: 'Buah',
      condition: 'Baik',
      location: 'Ruang Meeting & Lobby Lantai 1',
      divisionId: divId,
      divisionName: divName,
      picUid: actor.uid,
      picName: actor.displayName,
      plateOrSerial: 'INV-KR-MTG-01..30',
      brandModel: 'Chitose Stacking & Sofa Lobby',
      purchaseDate: '2023-03-01',
      currentOdometerKm: 0,
      notes: '24 kursi ruang meeting + 6 kursi tunggu tamu lobby.',
    },
    {
      assetCode: 'BGN-001',
      name: 'Gedung Kantor Pusat (3 Lantai)',
      category: 'Bangunan',
      subCategory: 'Gedung Kantor',
      quantity: 1,
      unit: 'Gedung',
      condition: 'Baik',
      location: 'Jl. Industri Raya No. 88, Bekasi',
      divisionId: divId,
      divisionName: divName,
      picUid: actor.uid,
      picName: actor.displayName,
      plateOrSerial: 'SHGB-04128 / IMB-2020-88',
      brandModel: 'Luas Bangunan 1.250 m²',
      purchaseDate: '2020-06-01',
      currentOdometerKm: 0,
      notes: 'Mencakup 14 unit AC, genset backup 60 kVA, dan panel listrik utama.',
    },
    {
      assetCode: 'BGN-002',
      name: 'Gudang Distribusi Utama Cikarang',
      category: 'Bangunan',
      subCategory: 'Gudang Logistik',
      quantity: 1,
      unit: 'Gedung',
      condition: 'Baik',
      location: 'Kawasan Industri Jababeka Blok C-12',
      divisionId: divId,
      divisionName: divName,
      picUid: actor.uid,
      picName: actor.displayName,
      plateOrSerial: 'SHGB-09871 / PBG-2021-12',
      brandModel: 'Luas Bangunan 2.400 m²',
      purchaseDate: '2021-05-18',
      currentOdometerKm: 0,
      notes: 'Dilengkapi 12 tabung APAR, hydrant, dan 3 loading dock.',
    },
    {
      assetCode: 'IT-001',
      name: 'Laptop Operasional Staff & Manajer',
      category: 'Elektronik & IT',
      subCategory: 'Laptop Kerja',
      quantity: 18,
      unit: 'Unit',
      condition: 'Baik',
      location: 'Kantor Pusat Lantai 1 & 2',
      divisionId: divId,
      divisionName: divName,
      picUid: actor.uid,
      picName: actor.displayName,
      plateOrSerial: 'INV-LTP-2024-01..18',
      brandModel: 'Lenovo ThinkPad E14 Gen 5',
      purchaseDate: '2024-01-20',
      currentOdometerKm: 0,
      notes: 'Inventaris laptop divisi Finance, HR, Operasional, dan Sales.',
    },
    {
      assetCode: 'IT-002',
      name: 'Server Rak Utama & UPS APC 3000VA',
      category: 'Elektronik & IT',
      subCategory: 'Server & Backup Daya',
      quantity: 2,
      unit: 'Unit',
      condition: 'Baik',
      location: 'Ruang Server Lantai 2',
      divisionId: divId,
      divisionName: divName,
      picUid: actor.uid,
      picName: actor.displayName,
      plateOrSerial: 'SRV-DL380-01 / UPS-APC-3K',
      brandModel: 'HPE ProLiant DL380 + APC Smart-UPS 3000VA',
      purchaseDate: '2022-11-10',
      currentOdometerKm: 0,
      notes: 'Wajib cek kesehatan baterai UPS dan suhu ruang server tiap 3 bulan.',
    },
    {
      assetCode: 'MSN-001',
      name: 'Forklift Diesel Toyota 3 Ton Gudang',
      category: 'Mesin & Peralatan',
      subCategory: 'Alat Angkat Gudang',
      quantity: 2,
      unit: 'Unit',
      condition: 'Perlu Perhatian',
      location: 'Gudang Distribusi Cikarang',
      divisionId: divId,
      divisionName: divName,
      picUid: actor.uid,
      picName: actor.displayName,
      plateOrSerial: 'FL-TYT-01 / FL-TYT-02',
      brandModel: 'Toyota 8FD30 Diesel 3 Ton',
      purchaseDate: '2021-09-14',
      currentOdometerKm: 1420,
      notes: 'Operasional bongkar muat palet gudang. Unit #2 butuh cek seal hidrolik.',
    },
    {
      assetCode: 'MSN-002',
      name: 'Genset Backup Perkins 60 kVA',
      category: 'Mesin & Peralatan',
      subCategory: 'Pembangkit Cadangan',
      quantity: 1,
      unit: 'Unit',
      condition: 'Baik',
      location: 'Rumah Genset Kantor Pusat',
      divisionId: divId,
      divisionName: divName,
      picUid: actor.uid,
      picName: actor.displayName,
      plateOrSerial: 'GEN-PRK-60KVA-01',
      brandModel: 'Perkins Silent 60 kVA',
      purchaseDate: '2020-07-22',
      currentOdometerKm: 0,
      notes: 'Pemanasan mingguan setiap Jumat pagi; ganti oli & filter solar tiap 6 bulan.',
    },
    {
      assetCode: 'AST-001',
      name: 'Tabung APAR Powder 6 Kg Kantor & Gudang',
      category: 'Lainnya',
      subCategory: 'Keselamatan K3',
      quantity: 12,
      unit: 'Tabung',
      condition: 'Baik',
      location: 'Kantor Pusat (4) & Gudang Cikarang (8)',
      divisionId: divId,
      divisionName: divName,
      picUid: actor.uid,
      picName: actor.displayName,
      plateOrSerial: 'K3-APAR-01..12',
      brandModel: 'Yamato Dry Chemical Powder 6 Kg',
      purchaseDate: '2023-06-10',
      currentOdometerKm: 0,
      notes: 'Wajib inspeksi tekanan manometer tiap 6 bulan dan isi ulang tahunan.',
    },
  ];

  const existingByCode = new Map<string, CompanyAsset>();
  for (const a of existingAssets) {
    existingByCode.set(a.assetCode.trim().toUpperCase(), a);
  }

  const assetsToCreate = sampleAssetsInput.filter(
    (item) => !existingByCode.has(item.assetCode.trim().toUpperCase())
  );

  const newlyCreatedAssets: CompanyAsset[] = [];
  for (let i = 0; i < assetsToCreate.length; i += 5) {
    const batch = assetsToCreate.slice(i, i + 5);
    const createdBatch = await Promise.all(
      batch.map((item) =>
        createCompanyAsset({
          input: item,
          actor,
          directory,
          idToken,
        })
      )
    );
    newlyCreatedAssets.push(...createdBatch);
  }

  const allAssetsByCode = new Map<string, CompanyAsset>(existingByCode);
  for (const a of newlyCreatedAssets) {
    allAssetsByCode.set(a.assetCode.trim().toUpperCase(), a);
  }

  onProgress?.('Menyusun jadwal servis, ganti oli, pajak STNK, uji KIR & inspeksi...');

  const byCode = (code: string) => allAssetsByCode.get(code.toUpperCase());
  const avanza = byCode('KND-001');
  const l300 = byCode('KND-002');
  const isuzu = byCode('KND-003');
  const vario = byCode('KND-004');
  const kantor = byCode('BGN-001');
  const gudang = byCode('BGN-002');
  const serverUps = byCode('IT-002');
  const forklift = byCode('MSN-001');
  const genset = byCode('MSN-002');
  const apar = byCode('AST-001');

  const rawSchedules: (CreateMaintenanceInput | null)[] = [
    l300
      ? {
          asset: l300,
          maintenanceType: 'Ganti Oli',
          title: 'Ganti Oli Mesin, Filter Oli & Filter Solar L300',
          dueDate: addDaysIso(today, -3),
          intervalMonths: 3,
          intervalKm: 5000,
          targetOdometerKm: 70000,
          reminderDaysBefore: 10,
          estimatedCost: 850000,
          vendorName: 'Bengkel Resmi Mitsubishi Cikarang',
          picUid: actor.uid,
          picName: actor.displayName,
          notes: 'Gunakan oli diesel 15W-40 standar Euro 4. Cek kampas rem sekalian.',
          lastCompletedDate: addDaysIso(today, -95),
        }
      : null,
    forklift
      ? {
          asset: forklift,
          maintenanceType: 'Perbaikan',
          title: 'Penggantian Seal Hidrolik & Servis Rem Forklift Unit #2',
          dueDate: addDaysIso(today, -2),
          intervalMonths: 0,
          intervalKm: 0,
          targetOdometerKm: 0,
          reminderDaysBefore: 7,
          estimatedCost: 1950000,
          vendorName: 'PT Traktor Nusantara Service Cikarang',
          picUid: actor.uid,
          picName: actor.displayName,
          notes: 'Terdeteksi rembesan tipis di silinder lift kanan saat inspeksi gudang.',
          lastCompletedDate: addDaysIso(today, -120),
        }
      : null,
    avanza
      ? {
          asset: avanza,
          maintenanceType: 'Ganti Oli',
          title: 'Ganti Oli Mesin 5W-30 & Spooring Balancing Avanza',
          dueDate: addDaysIso(today, 6),
          intervalMonths: 3,
          intervalKm: 5000,
          targetOdometerKm: 35000,
          reminderDaysBefore: 10,
          estimatedCost: 950000,
          vendorName: 'Auto2000 Bekasi Timur',
          picUid: actor.uid,
          picName: actor.displayName,
          notes: 'Booking servis pagi jam 08.30 agar tidak mengganggu jadwal kunjungan.',
          lastCompletedDate: addDaysIso(today, -84),
        }
      : null,
    l300
      ? {
          asset: l300,
          maintenanceType: 'Uji KIR',
          title: 'Uji KIR Berkala 6 Bulanan Mitsubishi L300 Box',
          dueDate: addDaysIso(today, 9),
          intervalMonths: 6,
          intervalKm: 0,
          targetOdometerKm: 0,
          reminderDaysBefore: 21,
          estimatedCost: 450000,
          vendorName: 'UPTD Pengujian Kendaraan Bermotor Dishub Kab. Bekasi',
          picUid: actor.uid,
          picName: actor.displayName,
          notes: 'Siapkan STNK asli, kartu uji KIR lama, lampu sein/rem, dan kotak P3K.',
          lastCompletedDate: addDaysIso(today, -171),
        }
      : null,
    kantor
      ? {
          asset: kantor,
          maintenanceType: 'Perawatan Bangunan / AC',
          title: 'Cuci & Servis Berkala 14 Unit AC Gedung Kantor Pusat',
          dueDate: addDaysIso(today, 11),
          intervalMonths: 3,
          intervalKm: 0,
          targetOdometerKm: 0,
          reminderDaysBefore: 14,
          estimatedCost: 2200000,
          vendorName: 'CV Sejuk Teknik Mandiri',
          picUid: actor.uid,
          picName: actor.displayName,
          notes: 'Dilaksanakan hari Sabtu pagi agar tidak mengganggu operasional kantor.',
          lastCompletedDate: addDaysIso(today, -79),
        }
      : null,
    serverUps
      ? {
          asset: serverUps,
          maintenanceType: 'Inspeksi & Kalibrasi',
          title: 'Cek Kesehatan Baterai UPS 3000VA & Pembersihan Rak Server',
          dueDate: addDaysIso(today, 12),
          intervalMonths: 3,
          intervalKm: 0,
          targetOdometerKm: 0,
          reminderDaysBefore: 14,
          estimatedCost: 750000,
          vendorName: 'Tim IT Internal & Partner APC',
          picUid: actor.uid,
          picName: actor.displayName,
          notes: 'Uji failover UPS dan verifikasi backup otomatis sebelum pembersihan.',
          lastCompletedDate: addDaysIso(today, -78),
        }
      : null,
    isuzu
      ? {
          asset: isuzu,
          maintenanceType: 'Servis Berkala',
          title: 'Servis Berkala Mesin Diesel & Kaki-Kaki Truk Wingbox',
          dueDate: addDaysIso(today, 14),
          intervalMonths: 4,
          intervalKm: 10000,
          targetOdometerKm: 120000,
          reminderDaysBefore: 14,
          estimatedCost: 3400000,
          vendorName: 'Astra Isuzu Cikarang',
          picUid: actor.uid,
          picName: actor.displayName,
          notes: 'Pengecekan injektor, kopling, per daun, dan sistem rem angin.',
          lastCompletedDate: addDaysIso(today, -106),
        }
      : null,
    avanza
      ? {
          asset: avanza,
          maintenanceType: 'Bayar Pajak STNK',
          title: 'Pembayaran Pajak STNK Tahunan Toyota Avanza B 1842 KOP',
          dueDate: addDaysIso(today, 18),
          intervalMonths: 12,
          intervalKm: 0,
          targetOdometerKm: 0,
          reminderDaysBefore: 30,
          estimatedCost: 3850000,
          vendorName: 'Samsat Kota Bekasi / SIGNAL',
          picUid: actor.uid,
          picName: actor.displayName,
          notes: 'Pengajuan dana ke Finance maksimal H-10 jatuh tempo.',
          lastCompletedDate: addDaysIso(today, -347),
        }
      : null,
    isuzu
      ? {
          asset: isuzu,
          maintenanceType: 'Uji KIR',
          title: 'Uji KIR Berkala 6 Bulanan Isuzu Elf Wingbox',
          dueDate: addDaysIso(today, 28),
          intervalMonths: 6,
          intervalKm: 0,
          targetOdometerKm: 0,
          reminderDaysBefore: 21,
          estimatedCost: 600000,
          vendorName: 'UPTD Pengujian Kendaraan Bermotor Dishub Kab. Bekasi',
          picUid: actor.uid,
          picName: actor.displayName,
          notes: 'Pastikan ban belakang & stiker reflektor boks sesuai ketentuan Dishub.',
          lastCompletedDate: addDaysIso(today, -152),
        }
      : null,
    l300
      ? {
          asset: l300,
          maintenanceType: 'Bayar Pajak STNK',
          title: 'Pembayaran Pajak STNK Tahunan Mitsubishi L300 B 9210 UCE',
          dueDate: addDaysIso(today, 34),
          intervalMonths: 12,
          intervalKm: 0,
          targetOdometerKm: 0,
          reminderDaysBefore: 30,
          estimatedCost: 2950000,
          vendorName: 'Samsat Kab. Bekasi',
          picUid: actor.uid,
          picName: actor.displayName,
          notes: 'Lampirkan fotokopi NPWP perusahaan dan surat kuasa GA.',
          lastCompletedDate: addDaysIso(today, -331),
        }
      : null,
    apar
      ? {
          asset: apar,
          maintenanceType: 'Inspeksi & Kalibrasi',
          title: 'Inspeksi Tekanan & Isi Ulang 12 Tabung APAR Kantor & Gudang',
          dueDate: addDaysIso(today, 38),
          intervalMonths: 6,
          intervalKm: 0,
          targetOdometerKm: 0,
          reminderDaysBefore: 21,
          estimatedCost: 3100000,
          vendorName: 'PT Proteksi Api Nusantara',
          picUid: actor.uid,
          picName: actor.displayName,
          notes: 'Wajib dokumentasi berita acara K3 untuk audit tahunan.',
          lastCompletedDate: addDaysIso(today, -142),
        }
      : null,
    avanza
      ? {
          asset: avanza,
          maintenanceType: 'Servis Berkala',
          title: 'Servis Berkala Kelipatan 40.000 KM (Major Service)',
          dueDate: addDaysIso(today, 45),
          intervalMonths: 6,
          intervalKm: 10000,
          targetOdometerKm: 40000,
          reminderDaysBefore: 14,
          estimatedCost: 2650000,
          vendorName: 'Auto2000 Bekasi Timur',
          picUid: actor.uid,
          picName: actor.displayName,
          notes: 'Termasuk penggantian oli transmisi CVT, busi, dan minyak rem.',
          lastCompletedDate: addDaysIso(today, -135),
        }
      : null,
    genset
      ? {
          asset: genset,
          maintenanceType: 'Servis Berkala',
          title: 'Ganti Oli, Filter Solar & Uji Beban Genset Perkins 60 kVA',
          dueDate: addDaysIso(today, 55),
          intervalMonths: 6,
          intervalKm: 0,
          targetOdometerKm: 0,
          reminderDaysBefore: 14,
          estimatedCost: 2400000,
          vendorName: 'PT Daya Mandiri Teknik',
          picUid: actor.uid,
          picName: actor.displayName,
          notes: 'Cek tegangan aki starter dan tangki solar harian.',
          lastCompletedDate: addDaysIso(today, -125),
        }
      : null,
    gudang
      ? {
          asset: gudang,
          maintenanceType: 'Perpanjangan Asuransi',
          title: 'Perpanjangan Polis Asuransi Kebakaran & Properti Gudang Cikarang',
          dueDate: addDaysIso(today, 58),
          intervalMonths: 12,
          intervalKm: 0,
          targetOdometerKm: 0,
          reminderDaysBefore: 30,
          estimatedCost: 14500000,
          vendorName: 'Asuransi Astra Buana (Garda Oto / Property)',
          picUid: actor.uid,
          picName: actor.displayName,
          notes: 'Review nilai pertanggungan bangunan dan stok gudang bersama Finance.',
          lastCompletedDate: addDaysIso(today, -307),
        }
      : null,
    vario
      ? {
          asset: vario,
          maintenanceType: 'Bayar Pajak STNK',
          title: 'Pembayaran Pajak STNK Tahunan 2 Motor Kurir Vario 160',
          dueDate: addDaysIso(today, 62),
          intervalMonths: 12,
          intervalKm: 0,
          targetOdometerKm: 0,
          reminderDaysBefore: 30,
          estimatedCost: 780000,
          vendorName: 'Samsat Kota Bekasi',
          picUid: actor.uid,
          picName: actor.displayName,
          notes: 'Total estimasi untuk 2 unit motor operasional.',
          lastCompletedDate: addDaysIso(today, -303),
        }
      : null,
  ];

  const existingScheduleKeys = new Set(
    existingSchedules.map(
      (s) =>
        `${s.assetCode.trim().toUpperCase()}|${s.maintenanceType}|${s.title.trim().toLowerCase()}`
    )
  );

  const schedulesToCreate = rawSchedules.filter((sch): sch is CreateMaintenanceInput => {
    if (!sch) return false;
    const key = `${sch.asset.assetCode.trim().toUpperCase()}|${sch.maintenanceType}|${sch.title
      .trim()
      .toLowerCase()}`;
    return !existingScheduleKeys.has(key);
  });

  const newlyCreatedSchedules: AssetMaintenanceSchedule[] = [];
  for (let i = 0; i < schedulesToCreate.length; i += 5) {
    const batch = schedulesToCreate.slice(i, i + 5);
    const createdBatch = await Promise.all(
      batch.map((sch) =>
        createMaintenanceSchedule({
          input: sch,
          actor,
          directory,
          idToken,
        })
      )
    );
    newlyCreatedSchedules.push(...createdBatch);
  }

  return {
    assets: sortAssets([...newlyCreatedAssets, ...existingAssets]),
    schedules: sortMaintenanceSchedules([...newlyCreatedSchedules, ...existingSchedules]),
    createdAssetCount: newlyCreatedAssets.length,
    createdScheduleCount: newlyCreatedSchedules.length,
  };
}

function escapeCsvCell(val: string | number): string {
  const str = String(val ?? '');
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function downloadAssetsCsv(assets: CompanyAsset[]): void {
  const headers = [
    'Kode Aset',
    'Nama Aset',
    'Kategori',
    'Sub-Kategori',
    'Jumlah',
    'Satuan',
    'Kondisi',
    'No. Polisi / Seri',
    'Merek / Model',
    'Odometer (KM)',
    'Lokasi',
    'Divisi',
    'PIC',
    'Tanggal Perolehan',
    'Catatan',
  ];
  const rows = assets.map((a) =>
    [
      a.assetCode,
      a.name,
      a.category,
      a.subCategory,
      a.quantity,
      a.unit,
      a.condition,
      a.plateOrSerial,
      a.brandModel,
      a.currentOdometerKm || '',
      a.location,
      a.divisionName,
      a.picName,
      a.purchaseDate,
      a.notes,
    ]
      .map(escapeCsvCell)
      .join(',')
  );
  const csv = ['\uFEFF' + headers.join(','), ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `inventaris-aset-${formatIsoDateLocal(new Date())}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadMaintenanceCsv(schedules: AssetMaintenanceSchedule[]): void {
  const headers = [
    'Kode Aset',
    'Nama Aset',
    'Kategori',
    'Plat / Seri',
    'Jenis Maintenance',
    'Judul Jadwal',
    'Tanggal Jatuh Tempo',
    'Status Aktual',
    'Siklus (Bulan)',
    'Siklus (KM)',
    'Target Odometer (KM)',
    'Estimasi Biaya (Rp)',
    'Vendor / Lokasi',
    'PIC',
    'Terakhir Selesai',
    'Catatan',
  ];
  const rows = schedules.map((s) => {
    const eff = computeEffectiveMaintenanceStatus(s);
    return [
      s.assetCode,
      s.assetName,
      s.assetCategory,
      s.plateOrSerial,
      s.maintenanceType,
      s.title,
      s.dueDate,
      `${eff.effectiveStatus} (${eff.urgencyLabel})`,
      s.intervalMonths || 'Sekali',
      s.intervalKm || '',
      s.targetOdometerKm || '',
      s.estimatedCost || 0,
      s.vendorName,
      s.picName,
      s.lastCompletedDate || '-',
      s.notes,
    ]
      .map(escapeCsvCell)
      .join(',');
  });
  const csv = ['\uFEFF' + headers.join(','), ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `jadwal-maintenance-aset-${formatIsoDateLocal(new Date())}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
