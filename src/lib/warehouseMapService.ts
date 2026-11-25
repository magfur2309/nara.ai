import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { fetchApiJson } from './apiClient';
import { db, getFreshIdToken, handleFirestoreError, OperationType } from './firebase';
import { recordAuditLog } from './sopService';
import type { DirectoryMember, UserProfile } from '../types/sop';

export type WarehouseSizePreset = 'small' | 'medium' | 'large' | 'custom';
export type WarehouseCapacityUnit = 'pcs' | 'box' | 'pallet' | 'kg' | 'unit';
export type WarehouseRackStatus = 'normal' | 'warning' | 'critical' | 'empty';

export interface ErpWarehouseMasterItem {
  code: string;
  name: string;
  isActive: boolean;
  isIntransit: boolean;
  skuCount: number;
  totalQty: number;
  zeroStockCount: number;
  source: 'm1_warehouse' | 'stock_summary';
}

export interface ErpWarehousesMasterResult {
  warehouses: ErpWarehouseMasterItem[];
  sourceMode: 'mysql_direct' | 'bridge_v11' | 'bridge_fallback_stock';
  totalMasterCount: number;
  physicalCount: number;
  intransitCount: number;
  fetchedAt: string;
  warning?: string;
}

export interface ErpWarehouseStockItemLite {
  code: string;
  name: string;
  warehouse: string;
  qty: number;
  unit: string;
  category: string;
}

export interface WarehouseMapGlobalSettings {
  id: string;
  scope: 'workspace';
  greenMaxPct: number;
  yellowMaxPct: number;
  autoRefreshSeconds: number;
  showOvercapacityBadge: boolean;
  syncVisibilityToStockTable: boolean;
  updatedByUid: string;
  updatedByName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface WarehouseMapLayoutConfig {
  id: string;
  scope: 'workspace';
  warehouseCode: string;
  warehouseName: string;
  displayName: string;
  isVisible: boolean;
  isIntransit: boolean;
  sortOrder: number;
  preset: WarehouseSizePreset;
  areaCount: number;
  racksPerArea: number;
  aisleColumns: number;
  defaultRackCapacity: number;
  capacityUnit: WarehouseCapacityUnit;
  areaNames: string[];
  facilityZones: string[];
  updatedByUid: string;
  updatedByName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface WarehouseRackCell {
  rackCode: string;
  areaIndex: number;
  areaName: string;
  rowNumber: number;
  colNumber: number;
  usedQty: number;
  capacity: number;
  occupancyPct: number;
  displayPct: number;
  isOvercapacity: boolean;
  status: WarehouseRackStatus;
  skuCount: number;
  items: ErpWarehouseStockItemLite[];
}

export interface WarehouseAreaGroup {
  areaIndex: number;
  areaName: string;
  areaPrefix: string;
  racks: WarehouseRackCell[];
  totalUsed: number;
  totalCapacity: number;
  occupancyPct: number;
  normalCount: number;
  warningCount: number;
  criticalCount: number;
  emptyCount: number;
}

export interface WarehouseFloorplanData {
  areas: WarehouseAreaGroup[];
  allRacks: WarehouseRackCell[];
  totalRacks: number;
  totalCapacity: number;
  totalUsed: number;
  overallPct: number;
  normalCount: number;
  warningCount: number;
  criticalCount: number;
  emptyCount: number;
  isPreviewMode: boolean;
}

export const GLOBAL_SETTINGS_DOC_ID = 'default';

export const DEFAULT_WAREHOUSE_MAP_GLOBAL_SETTINGS: Omit<
  WarehouseMapGlobalSettings,
  'updatedByUid' | 'updatedByName' | 'createdAt' | 'updatedAt'
> = {
  id: GLOBAL_SETTINGS_DOC_ID,
  scope: 'workspace',
  greenMaxPct: 69,
  yellowMaxPct: 90,
  autoRefreshSeconds: 0,
  showOvercapacityBadge: true,
  syncVisibilityToStockTable: false,
};

export const WAREHOUSE_SIZE_PRESETS: Record<
  Exclude<WarehouseSizePreset, 'custom'>,
  {
    id: Exclude<WarehouseSizePreset, 'custom'>;
    label: string;
    subtitle: string;
    areaCount: number;
    racksPerArea: number;
    aisleColumns: number;
  }
> = {
  small: {
    id: 'small',
    label: 'Gudang Kecil',
    subtitle: '3 Area · 12 Rak',
    areaCount: 3,
    racksPerArea: 4,
    aisleColumns: 2,
  },
  medium: {
    id: 'medium',
    label: 'Gudang Menengah',
    subtitle: '4 Area · 48 Rak',
    areaCount: 4,
    racksPerArea: 12,
    aisleColumns: 3,
  },
  large: {
    id: 'large',
    label: 'Gudang Besar',
    subtitle: '5 Area · 100 Rak',
    areaCount: 5,
    racksPerArea: 20,
    aisleColumns: 4,
  },
};

export const WAREHOUSE_CAPACITY_UNITS: { value: WarehouseCapacityUnit; label: string; short: string }[] = [
  { value: 'pcs', label: 'Pieces (pcs)', short: 'pcs' },
  { value: 'unit', label: 'Unit / Qty (unit)', short: 'unit' },
  { value: 'box', label: 'Box / Karton (box)', short: 'box' },
  { value: 'pallet', label: 'Pallet (pallet)', short: 'pallet' },
  { value: 'kg', label: 'Kilogram (kg)', short: 'kg' },
];

export const DEFAULT_FACILITY_ZONES = [
  'Ruang Admin',
  'Loading Dock',
  'Area Receiving',
  'Pintu Utama',
] as const;

export function getCapacityUnitShort(unit: WarehouseCapacityUnit): string {
  return WAREHOUSE_CAPACITY_UNITS.find((u) => u.value === unit)?.short || unit;
}

export function buildDefaultAreaNames(count: number, existing: string[] = []): string[] {
  const safeCount = Math.max(1, Math.min(12, Math.round(count)));
  const names: string[] = [];
  for (let i = 0; i < safeCount; i++) {
    const prev = String(existing[i] || '').trim();
    const letter = String.fromCharCode(65 + i);
    names.push(prev ? prev.slice(0, 48) : `Area ${letter}`);
  }
  return names;
}

export function makeWarehouseLayoutId(warehouseCodeOrName: string): string {
  const raw = String(warehouseCodeOrName || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 72);
  let hash = 0;
  const src = String(warehouseCodeOrName || '').trim().toLowerCase();
  for (let i = 0; i < src.length; i++) {
    hash = (hash * 31 + src.charCodeAt(i)) >>> 0;
  }
  const suffix = hash.toString(36).slice(0, 6);
  return `wh_${raw || 'gudang'}_${suffix}`;
}

export function buildDefaultWarehouseLayout(
  wh: ErpWarehouseMasterItem,
  sortOrder: number
): WarehouseMapLayoutConfig {
  const preset: Exclude<WarehouseSizePreset, 'custom'> =
    wh.skuCount >= 180 ? 'large' : wh.skuCount >= 40 ? 'medium' : 'small';
  const presetCfg = WAREHOUSE_SIZE_PRESETS[preset];
  const totalRacks = presetCfg.areaCount * presetCfg.racksPerArea;
  const estPerRack =
    wh.totalQty > 0 && totalRacks > 0
      ? Math.max(100, Math.ceil((wh.totalQty / totalRacks) * 1.45 / 50) * 50)
      : 1000;

  return {
    id: makeWarehouseLayoutId(wh.code || wh.name),
    scope: 'workspace',
    warehouseCode: String(wh.code || wh.name).trim().slice(0, 64),
    warehouseName: String(wh.name || wh.code || 'Gudang').trim().slice(0, 160),
    displayName: String(wh.name || wh.code || 'Gudang').trim().slice(0, 160),
    isVisible: !wh.isIntransit && wh.isActive,
    isIntransit: Boolean(wh.isIntransit),
    sortOrder: Math.max(0, Math.min(10000, Math.round(sortOrder))),
    preset,
    areaCount: presetCfg.areaCount,
    racksPerArea: presetCfg.racksPerArea,
    aisleColumns: presetCfg.aisleColumns,
    defaultRackCapacity: Math.min(100_000_000, estPerRack),
    capacityUnit: 'pcs',
    areaNames: buildDefaultAreaNames(presetCfg.areaCount),
    facilityZones: [...DEFAULT_FACILITY_ZONES],
    updatedByUid: '',
    updatedByName: '',
  };
}

export function classifyRackStatus(
  usedQty: number,
  occupancyPct: number,
  settings: Pick<WarehouseMapGlobalSettings, 'greenMaxPct' | 'yellowMaxPct'>
): WarehouseRackStatus {
  if (usedQty <= 0) return 'empty';
  if (occupancyPct <= settings.greenMaxPct) return 'normal';
  if (occupancyPct <= settings.yellowMaxPct) return 'warning';
  return 'critical';
}

export function buildWarehouseFloorplan(params: {
  layout: WarehouseMapLayoutConfig;
  settings: Pick<WarehouseMapGlobalSettings, 'greenMaxPct' | 'yellowMaxPct'>;
  warehouseItems: ErpWarehouseStockItemLite[];
  erpMaster?: ErpWarehouseMasterItem | null;
  previewMode?: boolean;
}): WarehouseFloorplanData {
  const { layout, settings, warehouseItems, erpMaster, previewMode = false } = params;
  const areaCount = Math.max(1, Math.min(12, Math.round(layout.areaCount || 4)));
  const racksPerArea = Math.max(1, Math.min(40, Math.round(layout.racksPerArea || 12)));
  const aisleColumns = Math.max(1, Math.min(6, Math.round(layout.aisleColumns || 3)));
  const rackCap = Math.max(1, Math.round(layout.defaultRackCapacity || 1000));
  const areaNames = buildDefaultAreaNames(areaCount, layout.areaNames);
  const totalRacks = areaCount * racksPerArea;

  // Prepare per-rack buckets
  const rackBuckets: { usedQty: number; items: ErpWarehouseStockItemLite[] }[] = Array.from(
    { length: totalRacks },
    () => ({ usedQty: 0, items: [] })
  );

  if (previewMode) {
    // Deterministic proportional occupancy preview (Green ~60%, Yellow ~22%, Red ~12%, Empty ~6%)
    const greenTarget = Math.max(15, Math.round(settings.greenMaxPct * 0.62));
    const yellowTarget = Math.min(
      settings.yellowMaxPct,
      Math.max(settings.greenMaxPct + 4, Math.round((settings.greenMaxPct + settings.yellowMaxPct) / 2))
    );
    const redTarget = Math.min(108, Math.max(settings.yellowMaxPct + 5, 96));

    for (let idx = 0; idx < totalRacks; idx++) {
      const slot = (idx * 7 + (idx % 5) * 3) % 16;
      let pct = greenTarget;
      if (slot === 15) pct = 0;
      else if (slot === 13 || slot === 14) pct = redTarget;
      else if (slot >= 10 && slot <= 12) pct = yellowTarget;
      else pct = Math.max(12, Math.min(settings.greenMaxPct, Math.round(greenTarget + ((idx % 4) - 1) * 11)));
      rackBuckets[idx].usedQty = Math.round((rackCap * pct) / 100);
    }
  } else if (warehouseItems.length > 0) {
    // Distribute live ERP items deterministically by sorted category + code across configured racks
    const sortedItems = [...warehouseItems].sort((a, b) => {
      const catCmp = (a.category || '').localeCompare(b.category || '', 'id');
      if (catCmp !== 0) return catCmp;
      return (a.code || '').localeCompare(b.code || '', 'id');
    });

    for (let i = 0; i < sortedItems.length; i++) {
      const item = sortedItems[i];
      const rackIdx =
        sortedItems.length <= totalRacks
          ? i
          : Math.min(totalRacks - 1, Math.floor((i * totalRacks) / sortedItems.length));
      const qty = Math.max(0, Number(item.qty || 0));
      rackBuckets[rackIdx].usedQty += qty;
      rackBuckets[rackIdx].items.push(item);
    }
  } else if (erpMaster && erpMaster.totalQty > 0) {
    // When detailed SKU rows are not yet loaded, distribute master warehouse totalQty across racks cleanly
    let remaining = Math.max(0, Number(erpMaster.totalQty || 0));
    const activeRackCount = Math.min(totalRacks, Math.max(1, erpMaster.skuCount || totalRacks));
    const avgPerRack = remaining / activeRackCount;
    for (let idx = 0; idx < activeRackCount && remaining > 0; idx++) {
      const weight = 0.72 + ((idx * 5) % 7) * 0.095;
      const alloc = idx === activeRackCount - 1 ? remaining : Math.min(remaining, Math.round(avgPerRack * weight));
      rackBuckets[idx].usedQty = Math.max(0, alloc);
      remaining = Math.max(0, remaining - alloc);
    }
  }

  const areas: WarehouseAreaGroup[] = [];
  const allRacks: WarehouseRackCell[] = [];
  let totalUsed = 0;
  let normalCount = 0;
  let warningCount = 0;
  let criticalCount = 0;
  let emptyCount = 0;

  for (let a = 0; a < areaCount; a++) {
    const areaName = areaNames[a];
    const letterMatch = areaName.match(/([A-Za-z0-9]{1,2})$/);
    const areaPrefix =
      areaName.toLowerCase().startsWith('area ') && letterMatch
        ? letterMatch[1].toUpperCase()
        : String.fromCharCode(65 + a);

    const racks: WarehouseRackCell[] = [];
    let areaUsed = 0;
    let areaNormal = 0;
    let areaWarning = 0;
    let areaCritical = 0;
    let areaEmpty = 0;

    for (let r = 0; r < racksPerArea; r++) {
      const globalIdx = a * racksPerArea + r;
      const bucket = rackBuckets[globalIdx];
      const usedQty = Math.round(bucket.usedQty * 100) / 100;
      const occupancyPct = rackCap > 0 ? Math.round((usedQty / rackCap) * 100) : 0;
      const displayPct = Math.max(0, Math.min(100, occupancyPct));
      const status = classifyRackStatus(usedQty, occupancyPct, settings);
      const rackNum = String(r + 1).padStart(2, '0');
      const rackCode = `${areaPrefix}-${rackNum}`;
      const colNumber = (r % aisleColumns) + 1;
      const rowNumber = Math.floor(r / aisleColumns) + 1;

      const cell: WarehouseRackCell = {
        rackCode,
        areaIndex: a,
        areaName,
        rowNumber,
        colNumber,
        usedQty,
        capacity: rackCap,
        occupancyPct,
        displayPct,
        isOvercapacity: occupancyPct > 100,
        status,
        skuCount: bucket.items.length,
        items: bucket.items,
      };

      racks.push(cell);
      allRacks.push(cell);
      areaUsed += usedQty;
      if (status === 'normal') areaNormal += 1;
      else if (status === 'warning') areaWarning += 1;
      else if (status === 'critical') areaCritical += 1;
      else areaEmpty += 1;
    }

    const areaCapacity = racksPerArea * rackCap;
    const areaPct = areaCapacity > 0 ? Math.round((areaUsed / areaCapacity) * 100) : 0;
    areas.push({
      areaIndex: a,
      areaName,
      areaPrefix,
      racks,
      totalUsed: Math.round(areaUsed * 100) / 100,
      totalCapacity: areaCapacity,
      occupancyPct: areaPct,
      normalCount: areaNormal,
      warningCount: areaWarning,
      criticalCount: areaCritical,
      emptyCount: areaEmpty,
    });

    totalUsed += areaUsed;
    normalCount += areaNormal;
    warningCount += areaWarning;
    criticalCount += areaCritical;
    emptyCount += areaEmpty;
  }

  const totalCapacity = totalRacks * rackCap;
  const overallPct = totalCapacity > 0 ? Math.round((totalUsed / totalCapacity) * 100) : 0;

  return {
    areas,
    allRacks,
    totalRacks,
    totalCapacity,
    totalUsed: Math.round(totalUsed * 100) / 100,
    overallPct,
    normalCount,
    warningCount,
    criticalCount,
    emptyCount,
    isPreviewMode: previewMode,
  };
}

export async function fetchErpWarehousesMaster(
  idToken: string,
  bypassCache = false
): Promise<ErpWarehousesMasterResult> {
  const token = await getFreshIdToken(idToken);
  const qs = bypassCache ? '?refresh=1' : '';
  return fetchApiJson<ErpWarehousesMasterResult>(
    `/api/erp/warehouses${qs}`,
    {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` },
    },
    'Gagal mengambil daftar seluruh gudang dari MySQL ERP.'
  );
}

export async function fetchWarehouseMapGlobalSettings(): Promise<WarehouseMapGlobalSettings | null> {
  try {
    const snap = await getDoc(doc(db, 'warehouseMapSettings', GLOBAL_SETTINGS_DOC_ID));
    if (!snap.exists()) return null;
    return snap.data() as WarehouseMapGlobalSettings;
  } catch (err) {
    // If document doesn't exist yet, Firestore rules with `existing().scope` can deny get; fallback cleanly
    const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code?: unknown }).code) : '';
    if (code === 'permission-denied' || code === 'not-found') {
      try {
        const qSnap = await getDocs(
          query(collection(db, 'warehouseMapSettings'), where('scope', '==', 'workspace'))
        );
        const found = qSnap.docs.find((d) => d.id === GLOBAL_SETTINGS_DOC_ID) || qSnap.docs[0];
        return found ? (found.data() as WarehouseMapGlobalSettings) : null;
      } catch {
        return null;
      }
    }
    handleFirestoreError(err, OperationType.GET, `warehouseMapSettings/${GLOBAL_SETTINGS_DOC_ID}`);
  }
}

export async function saveWarehouseMapGlobalSettings(params: {
  greenMaxPct: number;
  yellowMaxPct: number;
  autoRefreshSeconds: number;
  showOvercapacityBadge: boolean;
  syncVisibilityToStockTable: boolean;
  existing?: WarehouseMapGlobalSettings | null;
  actor: UserProfile;
  directory: DirectoryMember[];
}): Promise<WarehouseMapGlobalSettings> {
  const greenMaxPct = Math.max(1, Math.min(98, Math.round(params.greenMaxPct)));
  const yellowMaxPct = Math.max(greenMaxPct + 1, Math.min(100, Math.round(params.yellowMaxPct)));
  const autoRefreshSeconds = Math.max(0, Math.min(3600, Math.round(params.autoRefreshSeconds)));
  const ref = doc(db, 'warehouseMapSettings', GLOBAL_SETTINGS_DOC_ID);

  const payload = {
    id: GLOBAL_SETTINGS_DOC_ID,
    scope: 'workspace' as const,
    greenMaxPct,
    yellowMaxPct,
    autoRefreshSeconds,
    showOvercapacityBadge: Boolean(params.showOvercapacityBadge),
    syncVisibilityToStockTable: Boolean(params.syncVisibilityToStockTable),
    updatedByUid: params.actor.uid,
    updatedByName: String(params.actor.displayName || 'Admin').trim().slice(0, 120) || 'Admin',
    createdAt: params.existing?.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(ref, payload);
    const saved = await getDoc(ref);
    await recordAuditLog({
      actor: params.actor,
      action: 'Ubah Threshold Peta Gudang',
      targetType: 'ASSET',
      targetId: GLOBAL_SETTINGS_DOC_ID,
      targetLabel: 'Pengaturan Global Peta Gudang',
      divisionId: params.actor.divisionId || 'general',
      detail: `Hijau <= ${greenMaxPct}% · Kuning <= ${yellowMaxPct}% · Auto-refresh: ${autoRefreshSeconds}d`,
      directory: params.directory,
    }).catch(() => {});
    return saved.exists()
      ? (saved.data() as WarehouseMapGlobalSettings)
      : { ...payload, createdAt: params.existing?.createdAt || new Date(), updatedAt: new Date() };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `warehouseMapSettings/${GLOBAL_SETTINGS_DOC_ID}`);
  }
}

export async function fetchWarehouseMapLayouts(): Promise<WarehouseMapLayoutConfig[]> {
  try {
    const qSnap = await getDocs(
      query(collection(db, 'warehouseMapLayouts'), where('scope', '==', 'workspace'))
    );
    return qSnap.docs
      .map((d) => d.data() as WarehouseMapLayoutConfig)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.warehouseName.localeCompare(b.warehouseName, 'id'));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'warehouseMapLayouts');
  }
}

export async function saveWarehouseMapLayout(params: {
  layout: WarehouseMapLayoutConfig;
  existing?: WarehouseMapLayoutConfig | null;
  actor: UserProfile;
  directory: DirectoryMember[];
  auditAction?: string;
}): Promise<WarehouseMapLayoutConfig> {
  const { layout, existing, actor, directory, auditAction = 'Ubah Layout & Kapasitas Gudang' } = params;
  const safeId = layout.id || makeWarehouseLayoutId(layout.warehouseCode || layout.warehouseName);
  const areaCount = Math.max(1, Math.min(12, Math.round(layout.areaCount || 4)));
  const racksPerArea = Math.max(1, Math.min(40, Math.round(layout.racksPerArea || 12)));
  const aisleColumns = Math.max(1, Math.min(6, Math.round(layout.aisleColumns || 3)));
  const defaultRackCapacity = Math.max(1, Math.min(100_000_000, Math.round(layout.defaultRackCapacity || 1000)));
  const areaNames = buildDefaultAreaNames(areaCount, layout.areaNames);
  const facilityZones = (Array.isArray(layout.facilityZones) ? layout.facilityZones : [...DEFAULT_FACILITY_ZONES])
    .map((z) => String(z || '').trim().slice(0, 48))
    .filter(Boolean)
    .slice(0, 8);

  const payload = {
    id: safeId,
    scope: 'workspace' as const,
    warehouseCode: String(layout.warehouseCode || '').trim().slice(0, 64),
    warehouseName: String(layout.warehouseName || layout.warehouseCode || 'Gudang').trim().slice(0, 160) || 'Gudang',
    displayName: String(layout.displayName || layout.warehouseName || 'Gudang').trim().slice(0, 160),
    isVisible: Boolean(layout.isVisible),
    isIntransit: Boolean(layout.isIntransit),
    sortOrder: Math.max(0, Math.min(10000, Math.round(layout.sortOrder || 0))),
    preset: (['small', 'medium', 'large', 'custom'].includes(layout.preset)
      ? layout.preset
      : 'custom') as WarehouseSizePreset,
    areaCount,
    racksPerArea,
    aisleColumns,
    defaultRackCapacity,
    capacityUnit: (['pcs', 'box', 'pallet', 'kg', 'unit'].includes(layout.capacityUnit)
      ? layout.capacityUnit
      : 'pcs') as WarehouseCapacityUnit,
    areaNames,
    facilityZones,
    updatedByUid: actor.uid,
    updatedByName: String(actor.displayName || 'Admin').trim().slice(0, 120) || 'Admin',
    createdAt: existing?.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = doc(db, 'warehouseMapLayouts', safeId);
  try {
    await setDoc(ref, payload);
    const saved = await getDoc(ref);
    await recordAuditLog({
      actor,
      action: auditAction,
      targetType: 'ASSET',
      targetId: safeId,
      targetLabel: payload.displayName || payload.warehouseName,
      divisionId: actor.divisionId || 'general',
      detail: `Tampil: ${payload.isVisible ? 'Ya' : 'Tidak'} · ${areaCount} Area × ${racksPerArea} Rak · Kapasitas ${defaultRackCapacity} ${payload.capacityUnit}/rak`,
      directory,
    }).catch(() => {});

    return saved.exists()
      ? (saved.data() as WarehouseMapLayoutConfig)
      : { ...payload, createdAt: existing?.createdAt || new Date(), updatedAt: new Date() };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `warehouseMapLayouts/${safeId}`);
  }
}
