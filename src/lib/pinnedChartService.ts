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
  handleFirestoreError,
  isBootstrapAdminEmail,
} from './firebase';
import { makeSafeId } from './sopService';
import type {
  ChartColorPalette,
  ChartSeriesData,
  ChartSortMode,
  ChartType,
  ChartValueFormat,
  PinnedChartDocument,
  UserProfile,
} from '../types/sop';

const COLLECTION_NAME = 'pinnedCharts';

function sanitizeSeries(series: ChartSeriesData[], labelCount: number): ChartSeriesData[] {
  return (series || [])
    .slice(0, 8)
    .map((s, idx) => ({
      name: String(s?.name || `Seri ${idx + 1}`).trim().slice(0, 80) || `Seri ${idx + 1}`,
      values: Array.from({ length: labelCount }, (_, i) => {
        const n = Number(s?.values?.[i]);
        return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
      }),
    }));
}

function sanitizeActiveIndices(indices: number[] | undefined, seriesCount: number): number[] {
  const cleaned = Array.from(
    new Set(
      (indices || [])
        .map((n) => Math.trunc(Number(n)))
        .filter((n) => Number.isInteger(n) && n >= 0 && n < seriesCount)
    )
  ).slice(0, 8);
  return cleaned.length > 0 ? cleaned : Array.from({ length: seriesCount }, (_, i) => i);
}

function toTimestampMs(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'object' && ts !== null && 'toMillis' in ts && typeof (ts as { toMillis: () => number }).toMillis === 'function') {
    return (ts as { toMillis: () => number }).toMillis();
  }
  return 0;
}

export async function fetchAccessiblePinnedCharts(
  user: UserProfile
): Promise<PinnedChartDocument[]> {
  try {
    const colRef = collection(db, COLLECTION_NAME);
    const isAdmin = user.role === 'Super Admin' || isBootstrapAdminEmail(user.email);

    if (isAdmin) {
      const snap = await getDocs(colRef);
      const list = snap.docs.map((d) => ({
        ...(d.data() as PinnedChartDocument),
        id: d.id,
      }));
      return sortPinnedCharts(list);
    }

    const [ownSnap, sharedSnap] = await Promise.all([
      getDocs(query(colRef, where('ownerUid', '==', user.uid))),
      getDocs(query(colRef, where('isShared', '==', true))),
    ]);

    const merged = new Map<string, PinnedChartDocument>();
    for (const d of [...ownSnap.docs, ...sharedSnap.docs]) {
      merged.set(d.id, { ...(d.data() as PinnedChartDocument), id: d.id });
    }
    return sortPinnedCharts(Array.from(merged.values()));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, COLLECTION_NAME);
  }
}

export function sortPinnedCharts(list: PinnedChartDocument[]): PinnedChartDocument[] {
  return [...list].sort((a, b) => {
    const orderDiff = (a.displayOrder ?? 0) - (b.displayOrder ?? 0);
    if (orderDiff !== 0) return orderDiff;
    return toTimestampMs(b.createdAt) - toTimestampMs(a.createdAt);
  });
}

export interface CreatePinnedChartInput {
  title: string;
  subtitle: string;
  chartType: ChartType;
  palette: ChartColorPalette;
  valueFormat: ChartValueFormat;
  unitLabel: string;
  categoryLabel: string;
  labels: string[];
  series: ChartSeriesData[];
  activeSeriesIndices?: number[];
  showDataLabels?: boolean;
  sortMode?: ChartSortMode;
  speakerNotes?: string;
  sourceQuestion?: string;
  sourceLabel?: string;
  displayOrder?: number;
  isShared?: boolean;
}

export async function createPinnedChart(
  user: UserProfile,
  input: CreatePinnedChartInput
): Promise<PinnedChartDocument> {
  const id = makeSafeId('pchart');
  const labels = (input.labels || [])
    .map((l) => String(l ?? '').trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, 50);

  if (labels.length === 0) {
    throw new Error('Data diagram tidak memiliki label kategori.');
  }

  const series = sanitizeSeries(input.series, labels.length);
  if (series.length === 0) {
    throw new Error('Data diagram tidak memiliki seri angka.');
  }

  const activeSeriesIndices = sanitizeActiveIndices(input.activeSeriesIndices, series.length);

  const payload: Omit<PinnedChartDocument, 'createdAt' | 'updatedAt'> & {
    createdAt: ReturnType<typeof serverTimestamp>;
    updatedAt: ReturnType<typeof serverTimestamp>;
  } = {
    id,
    title: (input.title || 'Diagram Presentasi').trim().slice(0, 140),
    subtitle: (input.subtitle || '').trim().slice(0, 220),
    chartType: input.chartType,
    palette: input.palette,
    valueFormat: input.valueFormat,
    unitLabel: (input.unitLabel || '').trim().slice(0, 30),
    categoryLabel: (input.categoryLabel || 'Kategori').trim().slice(0, 60),
    labels,
    series,
    activeSeriesIndices,
    showDataLabels: Boolean(input.showDataLabels ?? true),
    sortMode: input.sortMode || 'original',
    speakerNotes: (input.speakerNotes || '').trim().slice(0, 1500),
    sourceQuestion: (input.sourceQuestion || '').trim().slice(0, 500),
    sourceLabel: (input.sourceLabel || 'Analisa AI · NARA AI').trim().slice(0, 120),
    displayOrder: Math.max(0, Math.min(100000, Math.trunc(input.displayOrder ?? 0))),
    isShared: Boolean(input.isShared),
    divisionId: (user.divisionId || '').slice(0, 80),
    divisionName: (user.divisionName || '').slice(0, 100),
    ownerUid: user.uid,
    ownerName: (user.displayName || user.email || 'Pengguna').trim().slice(0, 120),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, COLLECTION_NAME, id), payload);
    return {
      ...payload,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `${COLLECTION_NAME}/${id}`);
  }
}

export interface UpdatePinnedChartInput {
  title?: string;
  subtitle?: string;
  chartType?: ChartType;
  palette?: ChartColorPalette;
  activeSeriesIndices?: number[];
  showDataLabels?: boolean;
  sortMode?: ChartSortMode;
  speakerNotes?: string;
  displayOrder?: number;
  isShared?: boolean;
}

export async function updatePinnedChart(
  existing: PinnedChartDocument,
  patch: UpdatePinnedChartInput
): Promise<PinnedChartDocument> {
  const nextSeriesCount = existing.series.length;
  const updatePayload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };

  if (patch.title !== undefined) {
    const trimmed = patch.title.trim().slice(0, 140);
    if (trimmed) updatePayload.title = trimmed;
  }
  if (patch.subtitle !== undefined) {
    updatePayload.subtitle = patch.subtitle.trim().slice(0, 220);
  }
  if (patch.chartType !== undefined) {
    updatePayload.chartType = patch.chartType;
  }
  if (patch.palette !== undefined) {
    updatePayload.palette = patch.palette;
  }
  if (patch.activeSeriesIndices !== undefined) {
    updatePayload.activeSeriesIndices = sanitizeActiveIndices(
      patch.activeSeriesIndices,
      nextSeriesCount
    );
  }
  if (patch.showDataLabels !== undefined) {
    updatePayload.showDataLabels = Boolean(patch.showDataLabels);
  }
  if (patch.sortMode !== undefined) {
    updatePayload.sortMode = patch.sortMode;
  }
  if (patch.speakerNotes !== undefined) {
    updatePayload.speakerNotes = patch.speakerNotes.trim().slice(0, 1500);
  }
  if (patch.displayOrder !== undefined) {
    updatePayload.displayOrder = Math.max(0, Math.min(100000, Math.trunc(patch.displayOrder)));
  }
  if (patch.isShared !== undefined) {
    updatePayload.isShared = Boolean(patch.isShared);
  }

  try {
    await updateDoc(doc(db, COLLECTION_NAME, existing.id), updatePayload);
    return {
      ...existing,
      ...updatePayload,
      updatedAt: Date.now(),
    } as PinnedChartDocument;
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `${COLLECTION_NAME}/${existing.id}`);
  }
}

export async function deletePinnedChart(chartId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, COLLECTION_NAME, chartId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `${COLLECTION_NAME}/${chartId}`);
  }
}
