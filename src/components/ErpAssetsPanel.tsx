import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarPlus,
  Car,
  CheckCircle2,
  Database,
  Download,
  Info,
  Layers,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Search,
} from 'lucide-react';
import { fetchApiJson } from '../lib/apiClient';
import { getFreshIdToken } from '../lib/firebase';
import type { AssetCategory, AssetMaintenanceSchedule } from '../types/sop';
import { TablePaginationBar, useTablePagination } from './TablePaginationBar';
import { useI18n } from '../lib/i18n';

export interface ErpAssetItem {
  id: number;
  assetCode: string;
  name: string;
  categoryCode: string;
  categoryName: string;
  mappedCategory: AssetCategory;
  branch: string;
  location: string;
  division: string;
  subDivision: string;
  costCenter: string;
  serialOrPlate: string;
  notes: string;
  purchaseDate: string;
  useDate: string;
  retireDate: string;
  quantity: number;
  unit: string;
  currency: string;
  acquisitionCost: number;
  residualValue: number;
  monthlyDepreciation: number;
  accumulatedDepreciation: number;
  netBookValue: number;
  usefulLifeRaw: number;
  usefulLifeMonths: number;
  usefulLifeYears: number;
  usefulLifeUnit: 'years' | 'months';
  depreciatedMonths: number;
  remainingLifeMonths: number;
  depreciationMethod: string;
  coaAsset: string;
  coaAssetName: string;
  coaAccumDep: string;
  coaDepExpense: string;
  isDisposed: boolean;
  isClosed: boolean;
  isFullyDepreciated: boolean;
  isIntangible: boolean;
  statusCode: number;
  statusLabel: string;
}

export interface ErpAssetCategorySummary {
  categoryCode: string;
  categoryName: string;
  mappedCategory: AssetCategory;
  assetCount: number;
  totalQty: number;
  acquisitionCost: number;
  accumulatedDepreciation: number;
  netBookValue: number;
  monthlyDepreciation: number;
}

export interface ErpAssetKpi {
  totalAssets: number;
  totalQty: number;
  disposedCount: number;
  fullyDepreciatedCount: number;
  expiringWithin12MonthsCount: number;
  vehicleCount: number;
  totalAcquisitionCost: number;
  totalAccumulatedDepreciation: number;
  totalNetBookValue: number;
  totalMonthlyDepreciation: number;
}

export interface ErpAssetsQueryResult {
  sourceTable: string;
  kpi: ErpAssetKpi;
  byCategory: ErpAssetCategorySummary[];
  items: ErpAssetItem[];
  totalMatched: number;
  fetchedAt: string;
}

interface ErpAssetsPanelProps {
  idToken: string;
  schedules?: AssetMaintenanceSchedule[];
  canWrite?: boolean;
  onCreateScheduleForErpAsset?: (asset: ErpAssetItem) => void;
  onAskAiQuestion: (question: string) => void;
  onDownloadBridge?: () => void;
  initialData?: ErpAssetsQueryResult | null;
  onDataLoaded?: (data: ErpAssetsQueryResult | null) => void;
  compactHeader?: boolean;
}

type AssetStatusFilter = 'all' | 'active_dep' | 'expiring_12m' | 'fully_dep' | 'vehicles';

function formatRp(amount: number): string {
  const n = Number(amount) || 0;
  const sign = n < 0 ? '-' : '';
  return `${sign}Rp ${Math.round(Math.abs(n)).toLocaleString('id-ID')}`;
}

function formatDateId(dateStr: string): string {
  if (!dateStr) return '-';
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatDurationMonths(months: number): string {
  const m = Math.max(0, Math.round(Number(months) || 0));
  if (m === 0) return '0 bln';
  const yrs = Math.floor(m / 12);
  const rem = m % 12;
  if (yrs === 0) return `${rem} bln`;
  if (rem === 0) return `${yrs} thn (${m} bln)`;
  return `${yrs} thn ${rem} bln`;
}

function escapeCsv(val: string | number): string {
  const s = String(val ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadErpAssetsCsv(
  items: ErpAssetItem[],
  schedulesByAssetKey: Map<string, AssetMaintenanceSchedule[]>
): void {
  const headers = [
    'Kode Aset',
    'Nama Aset',
    'Kategori ERP',
    'Kelompok Operasional',
    'No. Seri / Plat',
    'Lokasi',
    'Divisi',
    'Tgl Perolehan',
    'Tgl Pakai',
    'Qty',
    'Satuan',
    'Umur Ekonomis (Bln)',
    'Sudah Disusutkan (Bln)',
    'Sisa Umur Ekonomis (Bln)',
    'Nilai Perolehan (Rp)',
    'Akumulasi Penyusutan (Rp)',
    'Sisa Nilai Buku (Rp)',
    'Beban Penyusutan / Bln (Rp)',
    'Metode Penyusutan',
    'Status Aset',
    'Jadwal Oli / STNK / Maintenance',
  ];

  const lines = [
    headers.join(','),
    ...items.map((a) => {
      const linked =
        schedulesByAssetKey.get(`erp_m7_${a.id}`) ||
        schedulesByAssetKey.get(`code:${a.assetCode.trim().toUpperCase()}`) ||
        [];
      const scheduleSummary =
        linked.length > 0
          ? linked.map((s) => `${s.maintenanceType} (${s.dueDate})`).join('; ')
          : '';
      return [
        a.assetCode,
        a.name,
        a.categoryName,
        a.mappedCategory,
        a.serialOrPlate,
        a.location,
        a.division,
        a.purchaseDate,
        a.useDate,
        a.quantity,
        a.unit,
        a.usefulLifeMonths,
        a.depreciatedMonths,
        a.remainingLifeMonths,
        Math.round(a.acquisitionCost),
        Math.round(a.accumulatedDepreciation),
        Math.round(a.netBookValue),
        Math.round(a.monthlyDepreciation),
        a.depreciationMethod,
        a.isDisposed ? 'Disposed' : a.isFullyDepreciated ? 'Habis Disusutkan' : a.statusLabel,
        scheduleSummary,
      ]
        .map(escapeCsv)
        .join(',');
    }),
  ];

  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `aset-tetap-erp-m7-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function ErpAssetsPanel({
  idToken,
  schedules = [],
  canWrite = false,
  onCreateScheduleForErpAsset,
  onAskAiQuestion,
  onDownloadBridge,
  initialData = null,
  onDataLoaded,
  compactHeader = false,
}: ErpAssetsPanelProps) {
  const { t } = useI18n();
  const [data, setData] = useState<ErpAssetsQueryResult | null>(initialData);
  const [loading, setLoading] = useState(!initialData);
  const [warmupNote, setWarmupNote] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [needsBridgeUpgrade, setNeedsBridgeUpgrade] = useState(false);

  const [searchInput, setSearchInput] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<AssetStatusFilter>('all');
  const [includeDisposed, setIncludeDisposed] = useState(false);
  const [showCategoryBreakdown, setShowCategoryBreakdown] = useState(false);

  const fetchAssets = useCallback(
    async (opts?: { includeDisposed?: boolean; refresh?: boolean }) => {
      setLoading(true);
      setWarmupNote(null);
      setErrorMsg(null);
      setNeedsBridgeUpgrade(false);
      try {
        const token = await getFreshIdToken(idToken);
        const params = new URLSearchParams();
        params.set('limit', '500');
        if (opts?.includeDisposed) params.set('includeDisposed', '1');
        if (opts?.refresh) params.set('refresh', '1');

        const result = await fetchApiJson<ErpAssetsQueryResult>(
          `/api/erp/assets?${params.toString()}`,
          {
            cache: 'no-store',
            headers: { Authorization: `Bearer ${token}` },
          },
          'Gagal memuat data aset tetap dari MySQL ERP.',
          {
            onWarmup: (msg) => setWarmupNote(msg),
          }
        );
        setData(result);
        onDataLoaded?.(result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Gagal memuat data aset tetap ERP.';
        if (/404|bridge v4|belum mendukung modul aset|endpoint.*tidak ditemukan|m7_asset_v|definer|invoker/i.test(msg)) {
          setNeedsBridgeUpgrade(true);
        }
        setErrorMsg(msg);
      } finally {
        setLoading(false);
        setWarmupNote(null);
      }
    },
    [idToken, onDataLoaded]
  );

  useEffect(() => {
    if (initialData) {
      setData(initialData);
      setLoading(false);
      return;
    }
    void fetchAssets({ includeDisposed: false, refresh: false });
  }, [fetchAssets, initialData]);

  // Index manual maintenance schedules by ERP asset ID (`erp_m7_<aid>`) and by assetCode
  const schedulesByAssetKey = useMemo(() => {
    const map = new Map<string, AssetMaintenanceSchedule[]>();
    for (const s of schedules) {
      if (s.status === 'Dibatalkan') continue;
      const byId = map.get(s.assetId) || [];
      byId.push(s);
      map.set(s.assetId, byId);

      const codeKey = `code:${(s.assetCode || '').trim().toUpperCase()}`;
      if (codeKey !== 'code:') {
        const byCode = map.get(codeKey) || [];
        if (!byCode.some((x) => x.id === s.id)) {
          byCode.push(s);
          map.set(codeKey, byCode);
        }
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.dueAtMs || 0) - (b.dueAtMs || 0));
    }
    return map;
  }, [schedules]);

  const filteredItems = useMemo(() => {
    const items = data?.items || [];
    const q = searchInput.trim().toLowerCase();
    return items.filter((a) => {
      if (categoryFilter) {
        const matchCat =
          a.categoryName === categoryFilter ||
          a.categoryCode === categoryFilter ||
          a.mappedCategory === categoryFilter;
        if (!matchCat) return false;
      }
      if (statusFilter === 'active_dep') {
        if (a.isFullyDepreciated || a.usefulLifeMonths <= 0 || a.netBookValue <= 0) return false;
      } else if (statusFilter === 'expiring_12m') {
        if (a.usefulLifeMonths <= 0 || a.remainingLifeMonths <= 0 || a.remainingLifeMonths > 12) {
          return false;
        }
      } else if (statusFilter === 'fully_dep') {
        if (!a.isFullyDepreciated) return false;
      } else if (statusFilter === 'vehicles') {
        if (a.mappedCategory !== 'Kendaraan') return false;
      }

      if (!q) return true;
      const hay = [
        a.assetCode,
        a.name,
        a.categoryName,
        a.categoryCode,
        a.mappedCategory,
        a.serialOrPlate,
        a.location,
        a.division,
        a.subDivision,
        a.branch,
        a.coaAsset,
        a.coaAssetName,
        a.notes,
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [data?.items, searchInput, categoryFilter, statusFilter]);

  const filteredTotals = useMemo(() => {
    return filteredItems.reduce(
      (acc, a) => {
        acc.qty += a.quantity;
        acc.cost += a.acquisitionCost;
        acc.accum += a.accumulatedDepreciation;
        acc.nbv += a.netBookValue;
        acc.monthly += a.monthlyDepreciation;
        return acc;
      },
      { qty: 0, cost: 0, accum: 0, nbv: 0, monthly: 0 }
    );
  }, [filteredItems]);

  const assetsPaging = useTablePagination(filteredItems, {
    defaultPageSize: 20,
    storageKey: 'erp_assets_list',
  });

  const handleToggleDisposed = (checked: boolean) => {
    setIncludeDisposed(checked);
    void fetchAssets({ includeDisposed: checked, refresh: true });
  };

  if (loading && !data) {
    return (
      <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl p-10 flex flex-col items-center justify-center gap-2 text-center">
        <div className="flex items-center gap-2.5 text-sm text-slate-600 dark:text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-text)] dark:text-[var(--accent)]" />
          <span>
            {warmupNote || t('erpPanels.assets.loading')}
          </span>
        </div>
        {warmupNote && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Data akan dimuat otomatis begitu server selesai menyala (biasanya 5–20 detik).
          </p>
        )}
      </div>
    );
  }

  if (errorMsg && !data) {
    const isServerWarmupError =
      /starting\s+server|proses\s+booting|memulai\s+ulang|mengembalikan\s+html/i.test(errorMsg);
    const showBridgeDownload = Boolean(onDownloadBridge && !isServerWarmupError);

    return (
      <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl p-6 space-y-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1.5 text-xs">
            <p className="font-semibold text-sm text-slate-900 dark:text-slate-100">
              {isServerWarmupError
                ? 'Server Aplikasi Sedang Memulai Ulang'
                : needsBridgeUpgrade
                  ? 'Bridge Lokal Perlu Diperbarui ke Versi Terbaru untuk Modul Aset Tetap'
                  : 'Belum Dapat Memuat Data Aset Tetap dari ERP'}
            </p>
            <p className="text-slate-600 dark:text-slate-400 leading-relaxed">{errorMsg}</p>
            {needsBridgeUpgrade && (
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                Unduh file <code>erp-mysql-bridge.mjs</code> versi terbaru (v5), salin kembali konfigurasi database &amp; token Anda, lalu jalankan ulang <code>node erp-mysql-bridge.mjs</code>.
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void fetchAssets({ includeDisposed, refresh: true })}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
              showBridgeDownload && needsBridgeUpgrade
                ? 'text-slate-700 dark:text-slate-200 bg-[var(--surface-3)] dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700'
                : 'bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)]'
            }`}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Coba Muat Ulang</span>
          </button>
          {showBridgeDownload && onDownloadBridge && (
            <button
              type="button"
              onClick={onDownloadBridge}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                needsBridgeUpgrade
                  ? 'bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)]'
                  : 'text-slate-700 dark:text-slate-200 bg-[var(--surface-3)] dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <Download className="w-3.5 h-3.5" />
              <span>Unduh Bridge v5 (.mjs)</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { kpi } = data;
  const accumPct =
    kpi.totalAcquisitionCost > 0
      ? Math.min(100, Math.round((kpi.totalAccumulatedDepreciation / kpi.totalAcquisitionCost) * 100))
      : 0;
  const nbvPct =
    kpi.totalAcquisitionCost > 0
      ? Math.max(0, Math.round((kpi.totalNetBookValue / kpi.totalAcquisitionCost) * 100))
      : 0;

  return (
    <div className="space-y-4">
      {/* Live Source & Blank Schedule Policy Banner */}
      <div className="bg-[var(--accent-soft)] dark:bg-[var(--accent-soft)] border border-[var(--accent)]/40 dark:border-[var(--accent)]/40 rounded-xl px-4 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
        <div className="flex items-start gap-2.5 text-sky-950 dark:text-sky-100">
          <Info className="w-4 h-4 text-[var(--accent-text)] dark:text-[var(--accent)] shrink-0 mt-0.5" />
          <div className="space-y-0.5 leading-relaxed">
            <p>
              <strong>{t('erpPanels.assets.liveSyncTitle')}</strong> · Data aset tetap, umur ekonomis, dan sisa nilai buku ditarik secara read-only langsung dari database perusahaan.
            </p>
            <p className="text-[var(--accent-text)] dark:text-[var(--accent)]">
              Jadwal operasional seperti <strong>batas waktu ganti oli, pajak STNK, uji KIR, &amp; servis kendaraan sengaja dikosongkan</strong> sampai Anda mengisinya manual lewat tombol <strong>+ Atur Jadwal</strong>.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => downloadErpAssetsCsv(filteredItems, schedulesByAssetKey)}
            disabled={filteredItems.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-[var(--surface)] dark:bg-slate-900 border border-[var(--border)] dark:border-slate-800 rounded-lg hover:bg-[var(--surface-2)] dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Ekspor CSV</span>
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void fetchAssets({ includeDisposed, refresh: true })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] disabled:opacity-60 rounded-lg whitespace-nowrap cursor-pointer"
          >
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            <span>Segarkan ERP</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="bg-[var(--danger-soft)] dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/70 rounded-lg px-4 py-2.5 text-xs text-rose-900 dark:text-rose-200 flex items-center justify-between gap-3">
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="font-medium hover:underline cursor-pointer shrink-0"
          >
            Tutup
          </button>
        </div>
      )}

      {/* 4-Column KPI Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Total Aset Tetap ERP
          </p>
          <p className="mt-1 font-mono tabular-nums text-2xl font-bold text-slate-900 dark:text-slate-100">
            {kpi.totalAssets.toLocaleString('id-ID')}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {kpi.totalQty.toLocaleString('id-ID')} unit · {kpi.vehicleCount} kendaraan
          </p>
        </div>

        <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Total Nilai Perolehan
          </p>
          <p className="mt-1 font-mono tabular-nums text-xl font-bold text-slate-900 dark:text-slate-100 truncate">
            {formatRp(kpi.totalAcquisitionCost)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {data.byCategory.length} kategori aset tetap
          </p>
        </div>

        <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Akumulasi Penyusutan
          </p>
          <p className="mt-1 font-mono tabular-nums text-xl font-bold text-amber-700 dark:text-amber-400 truncate">
            {formatRp(kpi.totalAccumulatedDepreciation)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {accumPct}% terdepresiasi · {formatRp(kpi.totalMonthlyDepreciation)}/bln
          </p>
        </div>

        <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Total Sisa Nilai Buku (NBV)
          </p>
          <p className="mt-1 font-mono tabular-nums text-xl font-bold text-emerald-700 dark:text-emerald-400 truncate">
            {formatRp(kpi.totalNetBookValue)}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {nbvPct}% tersisa · {kpi.expiringWithin12MonthsCount} aset ≤ 12 bln
          </p>
        </div>
      </div>

      {/* Quick Ask AI Strip (shown in ERP Live or when not compact) */}
      {!compactHeader && (
        <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl px-4 py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 shrink-0">
            <MessageSquareText className="w-4 h-4 text-[var(--accent-text)] dark:text-[var(--accent)] shrink-0" />
            <span>{t('erpPanels.assets.askAiLabel')}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[
              'Ringkas total nilai perolehan, akumulasi penyusutan, dan sisa nilai buku aset tetap per kategori',
              'Tampilkan daftar kendaraan perusahaan di ERP lengkap dengan umur ekonomis dan sisa nilai bukunya',
              'Aset tetap mana saja yang sisa umur ekonomisnya kurang dari 12 bulan atau sudah habis disusutkan?',
            ].map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => onAskAiQuestion(prompt)}
                className="text-left px-3 py-1.5 text-xs font-medium text-[var(--accent-text)] dark:text-[var(--accent)] bg-[var(--accent-soft)] dark:bg-[var(--accent-soft)] hover:bg-[var(--accent-soft)] dark:hover:bg-[var(--accent-soft)] border border-[var(--accent)]/40 dark:border-[var(--accent)]/40 rounded-lg transition-colors cursor-pointer"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Collapsible Category Breakdown Summary */}
      {data.byCategory.length > 0 && (
        <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl overflow-hidden">
          <button
            type="button"
            onClick={() => setShowCategoryBreakdown((v) => !v)}
            className="w-full px-4 py-3 flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-[var(--surface-2)] dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
          >
            <span className="inline-flex items-center gap-2">
              <Layers className="w-4 h-4 text-[var(--accent-text)] dark:text-[var(--accent)]" />
              <span>Ringkasan Sisa Nilai Buku per Kategori ERP ({data.byCategory.length} Kategori)</span>
            </span>
            <span className="text-[var(--accent-text)] dark:text-[var(--accent)] font-medium">
              {showCategoryBreakdown ? 'Sembunyikan' : 'Tampilkan Rincian'}
            </span>
          </button>

          {showCategoryBreakdown && (
            <div className="border-t border-[var(--border)] dark:border-slate-800 overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-[var(--surface-2)] dark:bg-slate-950/60 border-b border-[var(--border)] dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-2">Kategori Aset</th>
                    <th className="px-4 py-2 text-right whitespace-nowrap">Jumlah</th>
                    <th className="px-4 py-2 text-right whitespace-nowrap">Nilai Perolehan</th>
                    <th className="px-4 py-2 text-right whitespace-nowrap">Akum. Penyusutan</th>
                    <th className="px-4 py-2 text-right whitespace-nowrap">Sisa Nilai Buku</th>
                    <th className="px-4 py-2 text-right whitespace-nowrap">Susut / Bln</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 tabular-nums">
                  {data.byCategory.map((c) => {
                    const active = categoryFilter === c.categoryName;
                    return (
                      <tr
                        key={`${c.categoryCode}-${c.categoryName}`}
                        onClick={() =>
                          setCategoryFilter((prev) =>
                            prev === c.categoryName ? '' : c.categoryName
                          )
                        }
                        className={`cursor-pointer transition-colors ${
                          active
                            ? 'bg-[var(--accent-soft)] dark:bg-[var(--accent-soft)]'
                            : 'hover:bg-[var(--surface-2)] dark:hover:bg-slate-800/40'
                        }`}
                      >
                        <td className="px-4 py-2 font-medium text-slate-900 dark:text-slate-100">
                          {c.categoryName}
                          <span className="ml-2 text-[11px] font-normal text-slate-500 dark:text-slate-400">
                            ({c.mappedCategory})
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {c.assetCount} ({c.totalQty} unit)
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {formatRp(c.acquisitionCost)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-amber-700 dark:text-amber-400 whitespace-nowrap">
                          {formatRp(c.accumulatedDepreciation)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                          {formatRp(c.netBookValue)}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {formatRp(c.monthlyDepreciation)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Filter Bar + Main Assets Table */}
      <div className="bg-[var(--surface)] dark:bg-slate-900/70 border border-[var(--border)] dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-[var(--border)] dark:border-slate-800 flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="relative flex-1 min-w-0">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Cari kode aset, nama aset, plat nomor/seri, lokasi, divisi, atau COA..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-[var(--text-subtle)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/25"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              aria-label="Filter kategori aset ERP"
              className="px-3 py-2 text-xs bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200"
            >
              <option value="">Semua Kategori ERP ({data.items.length})</option>
              {data.byCategory.map((c) => (
                <option key={`${c.categoryCode}-${c.categoryName}`} value={c.categoryName}>
                  {c.categoryName} ({c.assetCount})
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as AssetStatusFilter)}
              aria-label="Filter status penyusutan aset"
              className="px-3 py-2 text-xs bg-[var(--input-bg)] dark:bg-slate-950 border border-[var(--border-strong)] dark:border-slate-800 rounded-lg text-slate-800 dark:text-slate-200"
            >
              <option value="all">Semua Status Umur</option>
              <option value="active_dep">Masih Disusutkan</option>
              <option value="expiring_12m">
                Sisa Umur ≤ 12 Bulan ({kpi.expiringWithin12MonthsCount})
              </option>
              <option value="fully_dep">
                Habis Disusutkan ({kpi.fullyDepreciatedCount})
              </option>
              <option value="vehicles">Khusus Kendaraan ({kpi.vehicleCount})</option>
            </select>

            <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 px-1.5 whitespace-nowrap cursor-pointer">
              <input
                type="checkbox"
                checked={includeDisposed}
                onChange={(e) => handleToggleDisposed(e.target.checked)}
                className="rounded border-[var(--border-strong)] dark:border-slate-700 text-[var(--accent-text)] focus:ring-[var(--accent)]/25"
              />
              <span>Tampilkan Disposed</span>
            </label>
          </div>
        </div>

        {/* Result Summary Bar */}
        <div className="px-4 py-2 bg-[var(--surface-2)]/70 dark:bg-slate-950/40 border-b border-[var(--border)] dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-400 font-mono tabular-nums">
          <span>
            Menampilkan <strong className="text-slate-900 dark:text-slate-100">{filteredItems.length}</strong> aset ({filteredTotals.qty.toLocaleString('id-ID')} unit)
          </span>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>
              Perolehan: <strong className="text-slate-900 dark:text-slate-100">{formatRp(filteredTotals.cost)}</strong>
            </span>
            <span>
              Akum. Susut: <strong className="text-amber-700 dark:text-amber-400">{formatRp(filteredTotals.accum)}</strong>
            </span>
            <span>
              Sisa Nilai Buku: <strong className="text-emerald-700 dark:text-emerald-400">{formatRp(filteredTotals.nbv)}</strong>
            </span>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="bg-[var(--surface-2)] dark:bg-slate-900 border-b border-[var(--border)] dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                <th className="px-4 py-2.5 whitespace-nowrap">Kode &amp; Nama Aset</th>
                <th className="px-4 py-2.5 whitespace-nowrap">Kategori &amp; Perolehan</th>
                <th className="px-4 py-2.5 whitespace-nowrap">Umur Ekonomis</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">Nilai Perolehan &amp; Susut</th>
                <th className="px-4 py-2.5 text-right whitespace-nowrap">Sisa Nilai Buku</th>
                <th className="px-4 py-2.5 whitespace-nowrap">Jadwal Oli / STNK / Servis</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {filteredItems.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-10 text-center text-slate-500 dark:text-slate-400"
                  >
                    Tidak ada data aset tetap yang cocok dengan filter pencarian Anda.
                  </td>
                </tr>
              ) : (
                assetsPaging.paginatedItems.map((a) => {
                  const progressPct =
                    a.usefulLifeMonths > 0
                      ? Math.min(100, Math.round((a.depreciatedMonths / a.usefulLifeMonths) * 100))
                      : 0;
                  const linkedSchedules =
                    schedulesByAssetKey.get(`erp_m7_${a.id}`) ||
                    schedulesByAssetKey.get(`code:${a.assetCode.trim().toUpperCase()}`) ||
                    [];
                  const isVehicle = a.mappedCategory === 'Kendaraan';

                  return (
                    <tr
                      key={a.id}
                      className="hover:bg-[var(--surface-2)] dark:hover:bg-slate-800/40 transition-colors align-top"
                    >
                      {/* 1. Kode & Nama Aset */}
                      <td className="px-4 py-3 min-w-[230px]">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-mono text-[11px] font-semibold text-[var(--accent-text)] dark:text-[var(--accent)]">
                            {a.assetCode}
                          </span>
                          {isVehicle && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-600 dark:text-slate-300 bg-[var(--surface-3)] dark:bg-slate-800 px-1.5 py-0.5 rounded">
                              <Car className="w-3 h-3" />
                              Kendaraan
                            </span>
                          )}
                          {a.isDisposed && (
                            <span className="text-[10px] font-semibold text-[var(--danger)] dark:text-rose-400 bg-[var(--danger-soft)] dark:bg-rose-950/50 px-1.5 py-0.5 rounded">
                              Disposed
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100">
                          {a.name}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          {[
                            a.serialOrPlate ? `No. ${a.serialOrPlate}` : '',
                            a.location,
                            a.division,
                            a.branch,
                          ]
                            .filter(Boolean)
                            .join(' · ') || '-'}
                        </div>
                        {a.coaAsset && (
                          <div className="mt-0.5 text-[10px] font-mono text-slate-400 dark:text-slate-500">
                            COA {a.coaAsset}
                            {a.coaAssetName ? ` · ${a.coaAssetName}` : ''}
                          </div>
                        )}
                      </td>

                      {/* 2. Kategori & Tanggal Beli */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-medium text-slate-800 dark:text-slate-200">
                          {a.categoryName}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                          Beli: {formatDateId(a.purchaseDate || a.useDate)}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                          Qty: {a.quantity.toLocaleString('id-ID')} {a.unit}
                          {a.depreciationMethod ? ` · ${a.depreciationMethod}` : ''}
                        </div>
                      </td>

                      {/* 3. Umur Ekonomis */}
                      <td className="px-4 py-3 min-w-[175px]">
                        {a.usefulLifeMonths > 0 ? (
                          <div className="space-y-1">
                            <div className="flex items-baseline justify-between gap-2 text-[11px]">
                              <span className="font-semibold text-slate-900 dark:text-slate-100 font-mono tabular-nums">
                                {formatDurationMonths(a.usefulLifeMonths)}
                              </span>
                              <span className="text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                                {a.depreciatedMonths}/{a.usefulLifeMonths} bln
                              </span>
                            </div>
                            <div className="h-1.5 w-full bg-[var(--surface-3)] dark:bg-slate-800 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  a.isFullyDepreciated
                                    ? 'bg-slate-400 dark:bg-slate-500'
                                    : a.remainingLifeMonths <= 12
                                      ? 'bg-amber-500'
                                      : 'bg-[var(--accent)]'
                                }`}
                                style={{ width: `${progressPct}%` }}
                              />
                            </div>
                            <div
                              className={`text-[11px] font-medium font-mono tabular-nums ${
                                a.isFullyDepreciated
                                  ? 'text-slate-500 dark:text-slate-400'
                                  : a.remainingLifeMonths <= 12
                                    ? 'text-amber-700 dark:text-amber-400'
                                    : 'text-emerald-700 dark:text-emerald-400'
                              }`}
                            >
                              {a.isFullyDepreciated
                                ? 'Umur ekonomis habis'
                                : `Sisa ${formatDurationMonths(a.remainingLifeMonths)}`}
                            </div>
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            <div>Tidak disusutkan</div>
                            <div className="text-[10px] text-slate-400 dark:text-slate-500">
                              (Tanah / non-depresiasi)
                            </div>
                          </div>
                        )}
                      </td>

                      {/* 4. Nilai Perolehan & Akumulasi Penyusutan */}
                      <td className="px-4 py-3 text-right whitespace-nowrap font-mono tabular-nums">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {formatRp(a.acquisitionCost)}
                        </div>
                        <div className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-400">
                          Akum: {formatRp(a.accumulatedDepreciation)}
                        </div>
                        {a.monthlyDepreciation > 0 && (
                          <div className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                            Susut/bln: {formatRp(a.monthlyDepreciation)}
                          </div>
                        )}
                      </td>

                      {/* 5. Sisa Nilai Buku (Net Book Value) */}
                      <td className="px-4 py-3 text-right whitespace-nowrap font-mono tabular-nums">
                        <div
                          className={`text-sm font-bold ${
                            a.netBookValue > 0
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-slate-400 dark:text-slate-500'
                          }`}
                        >
                          {formatRp(a.netBookValue)}
                        </div>
                        {a.residualValue > 0 && (
                          <div className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                            Residu: {formatRp(a.residualValue)}
                          </div>
                        )}
                      </td>

                      {/* 6. Jadwal Operasional (Ganti Oli / STNK / Servis) — Kosong secara default */}
                      <td className="px-4 py-3 min-w-[180px]">
                        {linkedSchedules.length > 0 ? (
                          <div className="space-y-1">
                            {linkedSchedules.slice(0, 2).map((sch) => (
                              <div
                                key={sch.id}
                                className="text-[11px] text-slate-700 dark:text-slate-300 flex items-center gap-1.5"
                              >
                                <CheckCircle2 className="w-3 h-3 text-[var(--accent-text)] dark:text-[var(--accent)] shrink-0" />
                                <span className="truncate">
                                  <strong>{sch.maintenanceType}</strong> ·{' '}
                                  <span className="font-mono tabular-nums">
                                    {formatDateId(sch.dueDate)}
                                  </span>
                                </span>
                              </div>
                            ))}
                            {linkedSchedules.length > 2 && (
                              <div className="text-[10px] text-slate-500 dark:text-slate-400">
                                +{linkedSchedules.length - 2} jadwal lainnya
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-400 dark:text-slate-500">
                            <div>Kosong (belum diatur)</div>
                            {isVehicle && (
                              <div className="text-[10px] text-slate-400 dark:text-slate-500">
                                Ganti oli / STNK belum diisi
                              </div>
                            )}
                          </div>
                        )}

                        {canWrite && onCreateScheduleForErpAsset && !a.isDisposed && (
                          <button
                            type="button"
                            onClick={() => onCreateScheduleForErpAsset(a)}
                            className="mt-1.5 inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-[var(--accent-text)] dark:text-[var(--accent)] bg-[var(--accent-soft)] dark:bg-[var(--accent-soft)] hover:bg-[var(--accent-soft)] dark:hover:bg-[var(--accent-soft)] border border-[var(--accent)]/40 dark:border-[var(--accent)]/40 rounded-md transition-colors cursor-pointer"
                          >
                            <CalendarPlus className="w-3 h-3" />
                            <span>Atur Jadwal</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <TablePaginationBar {...assetsPaging.paginationProps} />

        {/* Footer timestamp */}
        <div className="px-4 py-2.5 border-t border-[var(--border)] dark:border-slate-800 bg-[var(--surface-2)]/50 dark:bg-slate-950/40 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>{t('erpPanels.assets.sourceFooter')}</span>
          </span>
          <span className="font-mono tabular-nums">
            Diperbarui: {new Date(data.fetchedAt).toLocaleTimeString('id-ID')}
          </span>
        </div>
      </div>
    </div>
  );
}
