import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };
import type { AccessLevel, SopChunk } from '../src/types/sop.ts';

type FirestoreValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { timestampValue: string }
  | { nullValue: null }
  | { arrayValue: { values?: FirestoreValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreValue> } };

function decodeValue(val: FirestoreValue | undefined): unknown {
  if (!val) return undefined;
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('booleanValue' in val) return val.booleanValue;
  if ('timestampValue' in val) return val.timestampValue;
  if ('nullValue' in val) return null;
  if ('arrayValue' in val) {
    return (val.arrayValue.values || []).map((v) => decodeValue(v));
  }
  if ('mapValue' in val) {
    const out: Record<string, unknown> = {};
    const fields = val.mapValue.fields || {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = decodeValue(v);
    }
    return out;
  }
  return undefined;
}

function decodeEmbedding(val: FirestoreValue | undefined): number[] {
  if (!val || !('arrayValue' in val)) return [];
  const rawValues = val.arrayValue.values;
  if (!rawValues || rawValues.length === 0) return [];
  const out = new Array<number>(rawValues.length);
  for (let i = 0; i < rawValues.length; i++) {
    const item = rawValues[i] as { doubleValue?: number; integerValue?: string } | undefined;
    if (!item) {
      out[i] = 0;
    } else if (typeof item.doubleValue === 'number') {
      out[i] = item.doubleValue;
    } else if (item.integerValue !== undefined) {
      out[i] = Number(item.integerValue);
    } else {
      out[i] = 0;
    }
  }
  return out;
}

function decodeDocument(doc: { name: string; fields?: Record<string, FirestoreValue> }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const fields = doc.fields || {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = k === 'embedding' ? decodeEmbedding(v) : decodeValue(v);
  }
  if (!out.id && doc.name) {
    out.id = doc.name.split('/').pop();
  }
  return out;
}

async function runChunkQuery(
  idToken: string,
  structuredQuery: Record<string, unknown>
): Promise<SopChunk[]> {
  const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents:runQuery`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ structuredQuery }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Firestore query error (${resp.status}): ${errText}`);
  }

  const rows = (await resp.json()) as Array<{ document?: { name: string; fields?: Record<string, FirestoreValue> } }>;
  const chunks: SopChunk[] = [];

  for (const row of rows) {
    if (!row.document) continue;
    const raw = decodeDocument(row.document);
    if (raw.status !== 'Disetujui') continue;
    chunks.push({
      id: String(raw.id || ''),
      sopId: String(raw.sopId || ''),
      docNumber: String(raw.docNumber || ''),
      title: String(raw.title || ''),
      version: Number(raw.version || 1),
      divisionId: String(raw.divisionId || ''),
      divisionName: String(raw.divisionName || ''),
      departmentName: String(raw.departmentName || ''),
      sectionIndex: Number(raw.sectionIndex || 0),
      sectionTitle: String(raw.sectionTitle || ''),
      content: String(raw.content || ''),
      keywords: String(raw.keywords || ''),
      embedding: Array.isArray(raw.embedding) ? (raw.embedding as number[]) : [],
      status: 'Disetujui',
      accessLevel: (raw.accessLevel as AccessLevel) || 'Umum',
      viewerUids: Array.isArray(raw.viewerUids) ? raw.viewerUids.map(String) : [],
      ownerUid: String(raw.ownerUid || ''),
      ownerName: String(raw.ownerName || ''),
    });
  }

  return chunks;
}

const CHUNK_CACHE_TTL_MS = 180_000;
const MAX_CACHED_USERS = 100;
const chunkCache = new Map<string, { expiresAt: number; chunks: SopChunk[] }>();
const inFlightChunkQueries = new Map<string, Promise<SopChunk[]>>();

export function invalidateChunkCache(uid?: string): void {
  if (!uid) {
    chunkCache.clear();
    return;
  }
  for (const key of chunkCache.keys()) {
    if (key.startsWith(`${uid}:`)) {
      chunkCache.delete(key);
    }
  }
}

export function getCachedAccessibleChunks(uid: string, email?: string): SopChunk[] | null {
  const key = `${uid}:${email || ''}`;
  const entry = chunkCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    chunkCache.delete(key);
    return null;
  }
  return entry.chunks;
}

/**
 * Retrieves approved SOP chunks strictly enforced by Firestore Security Rules
 * at the database query level using the caller's Firebase ID Token.
 */
export async function fetchAccessibleApprovedChunks(params: {
  idToken: string;
  uid: string;
  email?: string;
}): Promise<SopChunk[]> {
  const { idToken, uid, email } = params;
  const cacheKey = `${uid}:${email || ''}`;

  const cached = getCachedAccessibleChunks(uid, email);
  if (cached) {
    return cached;
  }

  const existingInFlight = inFlightChunkQueries.get(cacheKey);
  if (existingInFlight) {
    return existingInFlight;
  }

  const queryPromise = (async () => {
    const isBootstrapAdmin =
      email === 'ahmadmagfur1218@gmail.com' || email === 'superuser@sopbrain.app';
    let result: SopChunk[];

    if (isBootstrapAdmin) {
      result = await runChunkQuery(idToken, {
        from: [{ collectionId: 'sopChunks' }],
        limit: 500,
      });
    } else {
      const [publicChunks, scopedChunks] = await Promise.all([
        runChunkQuery(idToken, {
          from: [{ collectionId: 'sopChunks' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'accessLevel' },
              op: 'EQUAL',
              value: { stringValue: 'Umum' },
            },
          },
          limit: 400,
        }),
        runChunkQuery(idToken, {
          from: [{ collectionId: 'sopChunks' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'viewerUids' },
              op: 'ARRAY_CONTAINS',
              value: { stringValue: uid },
            },
          },
          limit: 300,
        }),
      ]);

      const dedup = new Map<string, SopChunk>();
      for (const c of [...publicChunks, ...scopedChunks]) {
        dedup.set(c.id, c);
      }
      result = Array.from(dedup.values());
    }

    if (chunkCache.size >= MAX_CACHED_USERS) {
      const oldestKey = chunkCache.keys().next().value;
      if (oldestKey) chunkCache.delete(oldestKey);
    }
    chunkCache.set(cacheKey, {
      expiresAt: Date.now() + CHUNK_CACHE_TTL_MS,
      chunks: result,
    });

    return result;
  })();

  inFlightChunkQueries.set(cacheKey, queryPromise);
  try {
    return await queryPromise;
  } finally {
    inFlightChunkQueries.delete(cacheKey);
  }
}

async function runRawCollectionQuery(
  idToken: string,
  structuredQuery: Record<string, unknown>
): Promise<Record<string, unknown>[]> {
  const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents:runQuery`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ structuredQuery }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Firestore query error (${resp.status}): ${errText}`);
  }

  const rows = (await resp.json()) as Array<{
    document?: { name: string; fields?: Record<string, FirestoreValue> };
  }>;
  const items: Record<string, unknown>[] = [];
  for (const row of rows) {
    if (!row.document) continue;
    items.push(decodeDocument(row.document));
  }
  return items;
}

const ASSET_CACHE_TTL_MS = 120_000;
const assetDataCache = new Map<
  string,
  {
    expiresAt: number;
    assets: import('../src/types/sop.ts').CompanyAsset[];
    schedules: import('../src/types/sop.ts').AssetMaintenanceSchedule[];
  }
>();

export function invalidateAssetCache(uid?: string): void {
  if (!uid) {
    assetDataCache.clear();
    return;
  }
  for (const key of assetDataCache.keys()) {
    if (key.startsWith(`${uid}:`)) {
      assetDataCache.delete(key);
    }
  }
}

async function fetchAccessibleCollectionDocs(params: {
  idToken: string;
  uid: string;
  email?: string;
  collectionId: 'assets' | 'maintenanceSchedules';
}): Promise<Record<string, unknown>[]> {
  const { idToken, uid, email, collectionId } = params;
  const isBootstrapAdmin =
    email === 'ahmadmagfur1218@gmail.com' || email === 'superuser@sopbrain.app';

  if (isBootstrapAdmin) {
    return runRawCollectionQuery(idToken, {
      from: [{ collectionId }],
      limit: 300,
    });
  }

  const [publicDocs, viewerDocs, picDocs] = await Promise.all([
    runRawCollectionQuery(idToken, {
      from: [{ collectionId }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'isPublic' },
          op: 'EQUAL',
          value: { booleanValue: true },
        },
      },
      limit: 250,
    }),
    runRawCollectionQuery(idToken, {
      from: [{ collectionId }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'viewerUids' },
          op: 'ARRAY_CONTAINS',
          value: { stringValue: uid },
        },
      },
      limit: 200,
    }),
    runRawCollectionQuery(idToken, {
      from: [{ collectionId }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'picUid' },
          op: 'EQUAL',
          value: { stringValue: uid },
        },
      },
      limit: 100,
    }),
  ]);

  const dedup = new Map<string, Record<string, unknown>>();
  for (const doc of [...publicDocs, ...viewerDocs, ...picDocs]) {
    const id = String(doc.id || '');
    if (id) dedup.set(id, doc);
  }
  return Array.from(dedup.values());
}

export async function fetchAccessibleAssetsAndMaintenance(params: {
  idToken: string;
  uid: string;
  email?: string;
}): Promise<{
  assets: import('../src/types/sop.ts').CompanyAsset[];
  schedules: import('../src/types/sop.ts').AssetMaintenanceSchedule[];
}> {
  const { idToken, uid, email } = params;
  const cacheKey = `${uid}:${email || ''}`;
  const cached = assetDataCache.get(cacheKey);
  if (cached && Date.now() <= cached.expiresAt) {
    return { assets: cached.assets, schedules: cached.schedules };
  }

  const [rawAssets, rawSchedules] = await Promise.all([
    fetchAccessibleCollectionDocs({ idToken, uid, email, collectionId: 'assets' }),
    fetchAccessibleCollectionDocs({ idToken, uid, email, collectionId: 'maintenanceSchedules' }),
  ]);

  const assets = rawAssets.map((raw) => ({
    id: String(raw.id || ''),
    assetCode: String(raw.assetCode || ''),
    name: String(raw.name || ''),
    category: (raw.category as import('../src/types/sop.ts').AssetCategory) || 'Lainnya',
    subCategory: String(raw.subCategory || ''),
    quantity: Number(raw.quantity || 1),
    unit: String(raw.unit || 'Unit'),
    condition: (raw.condition as import('../src/types/sop.ts').AssetCondition) || 'Baik',
    location: String(raw.location || ''),
    divisionId: String(raw.divisionId || ''),
    divisionName: String(raw.divisionName || ''),
    picUid: String(raw.picUid || ''),
    picName: String(raw.picName || ''),
    plateOrSerial: String(raw.plateOrSerial || ''),
    brandModel: String(raw.brandModel || ''),
    purchaseDate: String(raw.purchaseDate || ''),
    currentOdometerKm: Number(raw.currentOdometerKm || 0),
    notes: String(raw.notes || ''),
    isPublic: raw.isPublic !== false,
    viewerUids: Array.isArray(raw.viewerUids) ? raw.viewerUids.map(String) : [],
    createdByUid: String(raw.createdByUid || ''),
    createdByName: String(raw.createdByName || ''),
  }));

  const schedules = rawSchedules.map((raw) => ({
    id: String(raw.id || ''),
    assetId: String(raw.assetId || ''),
    assetCode: String(raw.assetCode || ''),
    assetName: String(raw.assetName || ''),
    assetCategory: (raw.assetCategory as import('../src/types/sop.ts').AssetCategory) || 'Lainnya',
    plateOrSerial: String(raw.plateOrSerial || ''),
    maintenanceType:
      (raw.maintenanceType as import('../src/types/sop.ts').MaintenanceType) || 'Lainnya',
    title: String(raw.title || ''),
    dueDate: String(raw.dueDate || ''),
    dueAtMs: Number(raw.dueAtMs || 0),
    intervalMonths: Number(raw.intervalMonths || 0),
    intervalKm: Number(raw.intervalKm || 0),
    targetOdometerKm: Number(raw.targetOdometerKm || 0),
    reminderDaysBefore: Number(raw.reminderDaysBefore || 14),
    status: (raw.status as import('../src/types/sop.ts').MaintenanceStatus) || 'Terjadwal',
    lastCompletedDate: String(raw.lastCompletedDate || ''),
    estimatedCost: Number(raw.estimatedCost || 0),
    vendorName: String(raw.vendorName || ''),
    picUid: String(raw.picUid || ''),
    picName: String(raw.picName || ''),
    divisionId: String(raw.divisionId || ''),
    divisionName: String(raw.divisionName || ''),
    notes: String(raw.notes || ''),
    history: Array.isArray(raw.history)
      ? (raw.history as import('../src/types/sop.ts').MaintenanceHistoryEntry[])
      : [],
    isPublic: raw.isPublic !== false,
    viewerUids: Array.isArray(raw.viewerUids) ? raw.viewerUids.map(String) : [],
    createdByUid: String(raw.createdByUid || ''),
    createdByName: String(raw.createdByName || ''),
  }));

  if (assetDataCache.size >= MAX_CACHED_USERS) {
    const oldestKey = assetDataCache.keys().next().value;
    if (oldestKey) assetDataCache.delete(oldestKey);
  }
  assetDataCache.set(cacheKey, {
    expiresAt: Date.now() + ASSET_CACHE_TTL_MS,
    assets,
    schedules,
  });

  return { assets, schedules };
}

const CALLER_PROFILE_CACHE_TTL_MS = 60_000;
export interface CallerUserProfile {
  uid: string;
  email: string;
  role: import('../src/types/sop.ts').UserRole;
  divisionId: string;
  divisionName: string;
  erpUserId: number;
  erpUserCode: string;
  erpUserName: string;
}

const callerProfileCache = new Map<
  string,
  {
    expiresAt: number;
    profile: CallerUserProfile;
  }
>();

export function invalidateCallerProfileCache(uid?: string): void {
  if (!uid) {
    callerProfileCache.clear();
    return;
  }
  callerProfileCache.delete(uid);
}

const VALID_ROLES = new Set(['Super Admin', 'Admin Divisi', 'Penulis', 'Karyawan']);

/**
 * Authoritatively fetches the caller's role, division, and ERP user mapping from Firestore `/users/{uid}`
 * using their verified Firebase ID Token so backend endpoints never trust client-supplied roles or ERP IDs.
 */
export async function fetchCallerUserProfile(params: {
  idToken: string;
  uid: string;
  email?: string;
}): Promise<CallerUserProfile> {
  const { idToken, uid, email = '' } = params;
  const cached = callerProfileCache.get(uid);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.profile;
  }

  const isBootstrapAdmin =
    email === 'ahmadmagfur1218@gmail.com' || email === 'superuser@sopbrain.app';

  let role: import('../src/types/sop.ts').UserRole = isBootstrapAdmin ? 'Super Admin' : 'Karyawan';
  let divisionId = '';
  let divisionName = '';
  let erpUserId = 0;
  let erpUserCode = '';
  let erpUserName = '';

  try {
    const safeUid = encodeURIComponent(uid);
    const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents/users/${safeUid}`;
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });
    if (resp.ok) {
      const doc = (await resp.json()) as {
        name?: string;
        fields?: Record<string, FirestoreValue>;
      };
      if (doc && doc.fields) {
        const raw = decodeDocument({ name: doc.name || uid, fields: doc.fields });
        const rawRole = String(raw.role || '').trim();
        if (VALID_ROLES.has(rawRole)) {
          role = rawRole as import('../src/types/sop.ts').UserRole;
        }
        divisionId = String(raw.divisionId || '').trim();
        divisionName = String(raw.divisionName || '').trim();
        const parsedErpId = Number(raw.erpUserId || 0);
        erpUserId = Number.isInteger(parsedErpId) && parsedErpId > 0 ? parsedErpId : 0;
        erpUserCode = String(raw.erpUserCode || '').trim().slice(0, 40);
        erpUserName = String(raw.erpUserName || '').trim().slice(0, 120);
      }
    }
  } catch (err) {
    console.warn(
      '[FirestoreRest] Caller profile lookup fallback:',
      err instanceof Error ? err.message : err
    );
  }

  if (isBootstrapAdmin) {
    role = 'Super Admin';
  }

  const profile: CallerUserProfile = {
    uid,
    email,
    role,
    divisionId,
    divisionName,
    erpUserId,
    erpUserCode,
    erpUserName,
  };
  if (callerProfileCache.size > 150) {
    const oldest = callerProfileCache.keys().next().value;
    if (oldest) callerProfileCache.delete(oldest);
  }
  callerProfileCache.set(uid, {
    expiresAt: Date.now() + CALLER_PROFILE_CACHE_TTL_MS,
    profile,
  });
  return profile;
}


