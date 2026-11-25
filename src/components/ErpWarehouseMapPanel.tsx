import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Building2,
  CheckCircle2,
  DoorOpen,
  LayoutGrid,
  List,
  Loader2,
  MapPin,
  Maximize2,
  Minimize2,
  Monitor,
  Package,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Truck,
  X,
} from 'lucide-react';
import { fetchApiJson } from '../lib/apiClient';
import { getFreshIdToken } from '../lib/firebase';
import type { DirectoryMember, UserProfile } from '../types/sop';
import {
  buildDefaultWarehouseLayout,
  buildWarehouseFloorplan,
  DEFAULT_WAREHOUSE_MAP_GLOBAL_SETTINGS,
  fetchErpWarehousesMaster,
  fetchWarehouseMapGlobalSettings,
  fetchWarehouseMapLayouts,
  getCapacityUnitShort,
  type ErpWarehouseMasterItem,
  type ErpWarehousesMasterResult,
  type ErpWarehouseStockItemLite,
  type WarehouseMapGlobalSettings,
  type WarehouseMapLayoutConfig,
  type WarehouseRackCell,
  type WarehouseRackStatus,
} from '../lib/warehouseMapService';
import { ErpWarehouseSettingsPanel } from './ErpWarehouseSettingsPanel';

export type WarehouseSubView = 'map' | 'racks' | 'stats' | 'settings';

interface ErpWarehouseMapPanelProps {
  idToken: string;
  user: UserProfile;
  directory: DirectoryMember[];
  initialSubView?: WarehouseSubView;
  onSubViewChange?: (view: WarehouseSubView) => void;
  onDownloadBridge?: () => void;
  onJumpToStockTable?: (warehouseName: string, searchQuery?: string) => void;
  onVisibilityConfigChange?: (
    hiddenWarehouseNames: Set<string>,
    syncToStockTable: boolean
  ) => void;
  formatNumber: (n: number) => string;
}

const STATUS_META: Record<
  WarehouseRackStatus,
  {
    label: string;
    shortLabel: string;
    fillClass: string;
    barClass: string;
    borderClass: string;
    textClass: string;
    strokeHex: string;
  }
> = {
  normal: {
    label: 'Aman (Normal)',
    shortLabel: 'Aman',
    fillClass: 'bg-emerald-500/85 dark:bg-emerald-500/80',
    barClass: 'bg-emerald-500',
    borderClass: 'border-emerald-500/50',
    textClass: 'text-emerald-700 dark:text-emerald-400',
    strokeHex: '#10B981',
  },
  warning: {
    label: 'Hampir Penuh',
    shortLabel: 'Hampir Penuh',
    fillClass: 'bg-amber-400/90 dark:bg-amber-400/85',
    barClass: 'bg-amber-400',
    borderClass: 'border-amber-500/60',
    textClass: 'text-amber-700 dark:text-amber-300',
    strokeHex: '#F59E0B',
  },
  critical: {
    label: 'Penuh / Perlu Perhatian',
    shortLabel: 'Penuh',
    fillClass: 'bg-red-500/90 dark:bg-red-500/85',
    barClass: 'bg-red-500',
    borderClass: 'border-red-500/65',
    textClass: 'text-red-700 dark:text-red-400',
    strokeHex: '#EF4444',
  },
  empty: {
    label: 'Kosong',
    shortLabel: 'Kosong',
    fillClass: 'bg-neutral-300/70 dark:bg-neutral-700/70',
    barClass: 'bg-neutral-400 dark:bg-neutral-600',
    borderClass: 'border-[var(--border)]',
    textClass: 'text-[var(--text-muted)]',
    strokeHex: '#9CA3AF',
  },
};

function OccupancyDonutGauge({
  pct,
  status,
}: {
  pct: number;
  status: WarehouseRackStatus;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const r = 38;
  const c = 2 * Math.PI * r;
  const offset = c - (clamped / 100) * c;
  const strokeColor = STATUS_META[status].strokeHex;

  return (
    <div className="relative w-24 h-24 shrink-0 flex items-center justify-center">
      <svg className="w-24 h-24 -rotate-90" viewBox="0 0 96 96" aria-hidden="true">
        <circle
          cx="48"
          cy="48"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="9"
          className="text-[var(--border)]"
        />
        <circle
          cx="48"
          cy="48"
          r={r}
          fill="none"
          stroke={strokeColor}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 250ms ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="font-mono tabular-nums text-lg font-bold text-[var(--text)] leading-none">
          {pct}%
        </span>
        <span className="text-[10px] text-[var(--text-muted)] mt-0.5">Terisi</span>
      </div>
    </div>
  );
}

export function ErpWarehouseMapPanel({
  idToken,
  user,
  directory,
  initialSubView = 'map',
  onSubViewChange,
  onDownloadBridge,
  onJumpToStockTable,
  onVisibilityConfigChange,
  formatNumber,
}: ErpWarehouseMapPanelProps) {
  const canManage = user.role === 'Super Admin' || user.role === 'Admin Divisi';

  const [subView, setSubView] = useState<WarehouseSubView>(initialSubView);
  const [masterResult, setMasterResult] = useState<ErpWarehousesMasterResult | null>(null);
  const [loadingMaster, setLoadingMaster] = useState(true);
  const [masterError, setMasterError] = useState<string | null>(null);

  const [savedLayouts, setSavedLayouts] = useState<WarehouseMapLayoutConfig[]>([]);
  const [globalSettings, setGlobalSettings] = useState<WarehouseMapGlobalSettings>({
    ...DEFAULT_WAREHOUSE_MAP_GLOBAL_SETTINGS,
    updatedByUid: '',
    updatedByName: '',
  });
  const [hasSavedGlobalSettings, setHasSavedGlobalSettings] = useState(false);

  const [selectedWarehouseKey, setSelectedWarehouseKey] = useState('');
  const [selectedAreaFilter, setSelectedAreaFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | WarehouseRackStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRackCode, setSelectedRackCode] = useState<string>('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);

  const [warehouseItems, setWarehouseItems] = useState<ErpWarehouseStockItemLite[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  useEffect(() => {
    setSubView(initialSubView);
  }, [initialSubView]);

  useEffect(() => {
    onSubViewChange?.(subView);
  }, [subView, onSubViewChange]);

  // Escape key exits fullscreen cleanly
  useEffect(() => {
    if (!isFullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isFullscreen]);

  const loadMasterAndConfigs = useCallback(
    async (bypassErpCache = false) => {
      setLoadingMaster(true);
      setMasterError(null);
      try {
        const [master, layouts, gSettings] = await Promise.all([
          fetchErpWarehousesMaster(idToken, bypassErpCache),
          fetchWarehouseMapLayouts().catch(() => [] as WarehouseMapLayoutConfig[]),
          fetchWarehouseMapGlobalSettings().catch(() => null),
        ]);
        setMasterResult(master);
        setSavedLayouts(layouts);
        if (gSettings) {
          setGlobalSettings(gSettings);
          setHasSavedGlobalSettings(true);
        }
      } catch (err) {
        setMasterError(
          err instanceof Error ? err.message : 'Gagal memuat daftar gudang & konfigurasi peta.'
        );
      } finally {
        setLoadingMaster(false);
      }
    },
    [idToken]
  );

  useEffect(() => {
    void loadMasterAndConfigs(false);
  }, [loadMasterAndConfigs]);

  const savedLayoutsById = useMemo(() => {
    const map = new Map<string, WarehouseMapLayoutConfig>();
    for (const l of savedLayouts) map.set(l.id, l);
    return map;
  }, [savedLayouts]);

  // Merge ERP master warehouses with persisted Firestore configs (keyed by warehouse code/name)
  const resolvedLayoutsMap = useMemo(() => {
    const map = new Map<string, WarehouseMapLayoutConfig>();
    const list = masterResult?.warehouses || [];
    const byCode = new Map<string, WarehouseMapLayoutConfig>();
    const byName = new Map<string, WarehouseMapLayoutConfig>();
    for (const l of savedLayouts) {
      if (l.warehouseCode) byCode.set(l.warehouseCode.toLowerCase(), l);
      if (l.warehouseName) byName.set(l.warehouseName.toLowerCase(), l);
    }
    list.forEach((wh, idx) => {
      const key = wh.code || wh.name;
      const existing =
        byCode.get((wh.code || '').toLowerCase()) ||
        byName.get((wh.name || '').toLowerCase()) ||
        null;
      map.set(key, existing ? { ...existing, isIntransit: wh.isIntransit } : buildDefaultWarehouseLayout(wh, idx));
    });
    return map;
  }, [masterResult, savedLayouts]);

  const visibleWarehouses = useMemo(() => {
    const list = masterResult?.warehouses || [];
    return list
      .filter((wh) => resolvedLayoutsMap.get(wh.code || wh.name)?.isVisible)
      .sort((a, b) => {
        const ca = resolvedLayoutsMap.get(a.code || a.name);
        const cb = resolvedLayoutsMap.get(b.code || b.name);
        return (ca?.sortOrder ?? 0) - (cb?.sortOrder ?? 0) || a.name.localeCompare(b.name, 'id');
      });
  }, [masterResult, resolvedLayoutsMap]);

  // Propagate hidden warehouses to parent ErpStockView if configured
  useEffect(() => {
    if (!onVisibilityConfigChange || !masterResult) return;
    const hiddenNames = new Set<string>();
    for (const wh of masterResult.warehouses) {
      const cfg = resolvedLayoutsMap.get(wh.code || wh.name);
      if (!cfg?.isVisible) {
        hiddenNames.add(wh.name.toLowerCase());
        if (wh.code) hiddenNames.add(wh.code.toLowerCase());
      }
    }
    onVisibilityConfigChange(hiddenNames, globalSettings.syncVisibilityToStockTable);
  }, [masterResult, resolvedLayoutsMap, globalSettings.syncVisibilityToStockTable, onVisibilityConfigChange]);

  // Ensure a valid warehouse is selected for Map / Racks / Stats
  const activeWarehouse: ErpWarehouseMasterItem | null = useMemo(() => {
    const pool = subView === 'settings' ? masterResult?.warehouses || [] : visibleWarehouses;
    if (pool.length === 0) return null;
    return pool.find((w) => (w.code || w.name) === selectedWarehouseKey) || pool[0];
  }, [subView, masterResult, visibleWarehouses, selectedWarehouseKey]);

  const activeWhKey = activeWarehouse ? activeWarehouse.code || activeWarehouse.name : '';
  const activeLayout = activeWhKey ? resolvedLayoutsMap.get(activeWhKey) || null : null;

  useEffect(() => {
    if (activeWhKey && activeWhKey !== selectedWarehouseKey && subView !== 'settings') {
      setSelectedWarehouseKey(activeWhKey);
    }
  }, [activeWhKey, selectedWarehouseKey, subView]);

  // Fetch real ERP stock items for the selected warehouse so clicking racks shows real SKU breakdown
  const loadSelectedWarehouseItems = useCallback(
    async (wh: ErpWarehouseMasterItem | null, bypassCache = false) => {
      if (!wh) {
        setWarehouseItems([]);
        return;
      }
      setLoadingItems(true);
      try {
        const token = await getFreshIdToken(idToken);
        const qs = new URLSearchParams();
        qs.set('warehouse', wh.name);
        if (wh.isIntransit) qs.set('intransitOnly', '1');
        qs.set('limit', '1000');
        if (bypassCache) qs.set('refresh', '1');
        const res = await fetchApiJson<{ items?: ErpWarehouseStockItemLite[] }>(
          `/api/erp/stock?${qs.toString()}`,
          {
            cache: 'no-store',
            headers: { Authorization: `Bearer ${token}` },
          },
          'Gagal memuat rincian item gudang.'
        );
        setWarehouseItems(Array.isArray(res.items) ? res.items : []);
      } catch {
        setWarehouseItems([]);
      } finally {
        setLoadingItems(false);
      }
    },
    [idToken]
  );

  useEffect(() => {
    if (subView === 'settings') return;
    void loadSelectedWarehouseItems(activeWarehouse, false);
  }, [activeWarehouse, subView, loadSelectedWarehouseItems]);

  // Auto-refresh interval timer when configured (> 0 seconds)
  useEffect(() => {
    const sec = globalSettings.autoRefreshSeconds;
    if (!sec || sec < 15 || subView === 'settings') return;
    const timer = window.setInterval(() => {
      void loadMasterAndConfigs(true);
      void loadSelectedWarehouseItems(activeWarehouse, true);
    }, sec * 1000);
    return () => window.clearInterval(timer);
  }, [globalSettings.autoRefreshSeconds, subView, loadMasterAndConfigs, loadSelectedWarehouseItems, activeWarehouse]);

  const floorplan = useMemo(() => {
    if (!activeLayout) return null;
    return buildWarehouseFloorplan({
      layout: activeLayout,
      settings: globalSettings,
      warehouseItems,
      erpMaster: activeWarehouse,
      previewMode,
    });
  }, [activeLayout, globalSettings, warehouseItems, activeWarehouse, previewMode]);

  // Keep selected rack valid
  const selectedRack: WarehouseRackCell | null = useMemo(() => {
    if (!floorplan || floorplan.allRacks.length === 0) return null;
    return (
      floorplan.allRacks.find((r) => r.rackCode === selectedRackCode) ||
      floorplan.allRacks.find((r) => r.status === 'critical') ||
      floorplan.allRacks.find((r) => r.status === 'warning') ||
      floorplan.allRacks[0]
    );
  }, [floorplan, selectedRackCode]);

  const visibleAreas = useMemo(() => {
    if (!floorplan) return [];
    if (selectedAreaFilter === 'all') return floorplan.areas;
    return floorplan.areas.filter((a) => String(a.areaIndex) === selectedAreaFilter);
  }, [floorplan, selectedAreaFilter]);

  const normalizedSearch = searchQuery.trim().toLowerCase();

  const matchesRackFilter = useCallback(
    (rack: WarehouseRackCell): boolean => {
      if (statusFilter !== 'all' && rack.status !== statusFilter) return false;
      if (normalizedSearch) {
        const hitCode = rack.rackCode.toLowerCase().includes(normalizedSearch);
        const hitArea = rack.areaName.toLowerCase().includes(normalizedSearch);
        const hitItem = rack.items.some(
          (it) =>
            it.code.toLowerCase().includes(normalizedSearch) ||
            it.name.toLowerCase().includes(normalizedSearch)
        );
        if (!hitCode && !hitArea && !hitItem) return false;
      }
      return true;
    },
    [statusFilter, normalizedSearch]
  );

  const filteredRacksList = useMemo(() => {
    if (!floorplan) return [];
    return floorplan.allRacks.filter((rack) => {
      if (selectedAreaFilter !== 'all' && String(rack.areaIndex) !== selectedAreaFilter) return false;
      return matchesRackFilter(rack);
    });
  }, [floorplan, selectedAreaFilter, matchesRackFilter]);

  const handleLayoutSaved = (saved: WarehouseMapLayoutConfig) => {
    setSavedLayouts((prev) => {
      const idx = prev.findIndex((p) => p.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [...prev, saved];
    });
  };

  const handleGlobalSettingsSaved = (saved: WarehouseMapGlobalSettings) => {
    setGlobalSettings(saved);
    setHasSavedGlobalSettings(true);
  };

  const handleManualRefresh = () => {
    void loadMasterAndConfigs(true);
    if (activeWarehouse) {
      void loadSelectedWarehouseItems(activeWarehouse, true);
    }
  };

  const unitShort = activeLayout ? getCapacityUnitShort(activeLayout.capacityUnit) : 'pcs';
  const facilitySet = new Set(activeLayout?.facilityZones || []);
  const showLeftFacilities =
    facilitySet.has('Ruang Admin') ||
    facilitySet.has('Loading Dock') ||
    facilitySet.has('Area Receiving');

  const containerClasses = isFullscreen
    ? 'fixed inset-0 z-50 bg-[var(--bg)] overflow-y-auto p-4 sm:p-6 space-y-4'
    : 'space-y-4';

  return (
    <div className={containerClasses}>
      {/* Top Toolbar */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3 sm:p-3.5 flex flex-wrap items-center justify-between gap-3">
        {/* Mode Switcher */}
        <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg">
          {(
            [
              { id: 'map', label: 'Peta Gudang', icon: <MapPin className="w-3.5 h-3.5" /> },
              { id: 'racks', label: 'Daftar Rak', icon: <List className="w-3.5 h-3.5" /> },
              { id: 'stats', label: 'Statistik', icon: <BarChart3 className="w-3.5 h-3.5" /> },
              {
                id: 'settings',
                label: 'Pengaturan Gudang',
                icon: <SlidersHorizontal className="w-3.5 h-3.5" />,
              },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setSubView(tab.id);
                if (tab.id === 'settings' && isFullscreen) setIsFullscreen(false);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                subView === tab.id
                  ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Right Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {subView !== 'settings' && visibleWarehouses.length > 0 && (
            <>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-[var(--text-muted)] hidden sm:inline">Gudang:</span>
                <select
                  value={activeWhKey}
                  onChange={(e) => {
                    setSelectedWarehouseKey(e.target.value);
                    setSelectedAreaFilter('all');
                    setSelectedRackCode('');
                  }}
                  className="h-8 px-2.5 text-xs font-medium bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text)] focus:outline-none focus:border-[var(--accent)] max-w-[210px]"
                >
                  {visibleWarehouses.map((w) => {
                    const k = w.code || w.name;
                    const cfg = resolvedLayoutsMap.get(k);
                    return (
                      <option key={k} value={k}>
                        {cfg?.displayName || w.name}
                      </option>
                    );
                  })}
                </select>
              </div>

              {floorplan && (
                <select
                  value={selectedAreaFilter}
                  onChange={(e) => setSelectedAreaFilter(e.target.value)}
                  className="h-8 px-2.5 text-xs font-medium bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                >
                  <option value="all">Semua Area ({floorplan.areas.length})</option>
                  {floorplan.areas.map((a) => (
                    <option key={a.areaIndex} value={String(a.areaIndex)}>
                      {a.areaName} ({a.racks.length} Rak)
                    </option>
                  ))}
                </select>
              )}

              <button
                type="button"
                onClick={() => setIsFullscreen((v) => !v)}
                className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium text-[var(--text)] bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--accent)] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
              >
                {isFullscreen ? (
                  <>
                    <Minimize2 className="w-3.5 h-3.5" />
                    <span>Keluar Layar Penuh</span>
                  </>
                ) : (
                  <>
                    <Maximize2 className="w-3.5 h-3.5" />
                    <span>Full Screen</span>
                  </>
                )}
              </button>
            </>
          )}

          <button
            type="button"
            disabled={loadingMaster || loadingItems}
            onClick={handleManualRefresh}
            className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold bg-[#0D0D0D] text-white hover:bg-[#222226] dark:bg-[var(--surface-2)] dark:text-[var(--text)] dark:border dark:border-[var(--border)] dark:hover:border-[var(--accent)] rounded-lg transition-colors whitespace-nowrap cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingMaster || loadingItems ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {masterError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{masterError}</span>
        </div>
      )}

      {/* Preview Mode Banner */}
      {previewMode && subView !== 'settings' && (
        <div className="bg-amber-500/10 border border-amber-500/35 rounded-xl px-4 py-2.5 text-xs text-[var(--text)] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>
              <strong>Mode Pratinjau Layout aktif</strong> — warna okupansi di bawah adalah simulasi proporsional (Hijau/Kuning/Merah), bukan angka stok asli MyERP.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setPreviewMode(false)}
            className="h-7 px-2.5 text-xs font-semibold bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--accent)] rounded-md transition-colors cursor-pointer"
          >
            Kembali ke Data Live ERP
          </button>
        </div>
      )}

      {/* SETTINGS SUB-VIEW */}
      {subView === 'settings' ? (
        <ErpWarehouseSettingsPanel
          user={user}
          directory={directory}
          canManage={canManage}
          masterResult={masterResult}
          loadingMaster={loadingMaster}
          resolvedLayouts={resolvedLayoutsMap}
          savedLayoutsMap={savedLayoutsById}
          globalSettings={globalSettings}
          hasSavedGlobalSettings={hasSavedGlobalSettings}
          selectedWarehouseKey={selectedWarehouseKey || activeWhKey}
          previewMode={previewMode}
          onPreviewModeChange={setPreviewMode}
          onSelectWarehouseKey={setSelectedWarehouseKey}
          onLayoutSaved={handleLayoutSaved}
          onGlobalSettingsSaved={handleGlobalSettingsSaved}
          onRefreshMaster={() => void loadMasterAndConfigs(true)}
          onDownloadBridge={onDownloadBridge}
          onOpenMapForWarehouse={(key) => {
            setSelectedWarehouseKey(key);
            setSelectedAreaFilter('all');
            setSelectedRackCode('');
            setSubView('map');
          }}
          formatNumber={formatNumber}
        />
      ) : loadingMaster && !masterResult ? (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl py-16 text-center text-xs text-[var(--text-muted)]">
          <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-[var(--accent-text)]" />
          Memuat master gudang dan peta kapasitas dari ERP...
        </div>
      ) : visibleWarehouses.length === 0 ? (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl py-14 px-6 text-center space-y-3">
          <Building2 className="w-8 h-8 text-[var(--text-muted)] mx-auto" />
          <div>
            <h3 className="font-display text-sm font-bold text-[var(--text)]">
              Belum Ada Gudang yang Ditampilkan di Peta
            </h3>
            <p className="text-xs text-[var(--text-muted)] mt-1 max-w-md mx-auto">
              Seluruh gudang ERP sedang disembunyikan atau belum tersedia. Buka menu Pengaturan Gudang untuk memilih gudang mana saja yang ingin ditampilkan.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSubView('settings')}
            className="inline-flex items-center gap-1.5 h-9 px-4 text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] rounded-lg transition-colors cursor-pointer"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Buka Pengaturan Gudang</span>
          </button>
        </div>
      ) : subView === 'map' && floorplan && activeLayout && activeWarehouse ? (
        /* MAP SUB-VIEW */
        <div className="space-y-4">
          {/* Main 2-Column Split: Floorplan Canvas + Rack Detail */}
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-4 items-stretch">
            {/* LEFT: Interactive Floorplan Canvas */}
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex flex-col justify-between gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[var(--border)]">
                <div>
                  <h3 className="font-display text-sm font-bold text-[var(--text)]">
                    {activeLayout.displayName || activeWarehouse.name}
                  </h3>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    Kode ERP: <span className="font-mono">{activeWarehouse.code}</span>
                    <span className="mx-1.5" aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {floorplan.areas.length} Area · {formatNumber(floorplan.totalRacks)} Rak
                    </span>
                    <span className="mx-1.5" aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      Okupansi {floorplan.overallPct}% ({formatNumber(floorplan.totalUsed)} / {formatNumber(floorplan.totalCapacity)} {unitShort})
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                  {loadingItems && (
                    <span className="inline-flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Memuat stok...
                    </span>
                  )}
                  {globalSettings.autoRefreshSeconds > 0 && (
                    <span className="font-mono tabular-nums">
                      Auto-refresh {globalSettings.autoRefreshSeconds}d
                    </span>
                  )}
                </div>
              </div>

              {/* Architectural Floorplan Blueprint Viewport */}
              <div
                className="relative rounded-xl border border-[var(--border)] bg-[var(--bg)] overflow-x-auto"
                style={{
                  backgroundImage:
                    'linear-gradient(to right, rgba(128,128,128,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(128,128,128,0.08) 1px, transparent 1px)',
                  backgroundSize: '24px 24px',
                }}
              >
                <div className="min-w-[680px] p-4 flex flex-col gap-4">
                  <div className="flex items-stretch gap-4">
                    {/* Optional Left Facility Zones */}
                    {showLeftFacilities && (
                      <div className="w-36 shrink-0 flex flex-col gap-2.5">
                        {facilitySet.has('Ruang Admin') && (
                          <div className="flex-1 min-h-[92px] rounded-lg border border-[var(--border)] bg-[var(--surface)]/95 p-3 flex flex-col items-center justify-center text-center gap-1.5">
                            <Monitor className="w-5 h-5 text-[var(--text-muted)]" />
                            <span className="text-[11px] font-semibold text-[var(--text)]">
                              Ruang Admin
                            </span>
                          </div>
                        )}
                        {facilitySet.has('Loading Dock') && (
                          <div className="flex-1 min-h-[92px] rounded-lg border border-[var(--border)] bg-[var(--surface)]/95 p-3 flex flex-col items-center justify-center text-center gap-1.5">
                            <Truck className="w-5 h-5 text-[var(--accent-text)]" />
                            <span className="text-[11px] font-semibold text-[var(--text)]">
                              Loading Dock
                            </span>
                          </div>
                        )}
                        {facilitySet.has('Area Receiving') && (
                          <div className="flex-1 min-h-[92px] rounded-lg border border-[var(--border)] bg-[var(--surface)]/95 p-3 flex flex-col items-center justify-center text-center gap-1.5">
                            <Package className="w-5 h-5 text-[var(--text-muted)]" />
                            <span className="text-[11px] font-semibold text-[var(--text)]">
                              Area Receiving
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Main Rack Areas Grid */}
                    <div
                      className="flex-1 grid gap-3.5"
                      style={{
                        gridTemplateColumns: `repeat(${Math.max(1, visibleAreas.length)}, minmax(150px, 1fr))`,
                      }}
                    >
                      {visibleAreas.map((area) => (
                        <div
                          key={area.areaIndex}
                          className="rounded-xl border border-[var(--border)] bg-[var(--surface)]/85 p-3 flex flex-col gap-2.5"
                        >
                          {/* Area Header */}
                          <div className="rounded-lg bg-[#053345] dark:bg-[#0D2E38] text-white px-2.5 py-1.5 flex items-center justify-between gap-2">
                            <span className="text-xs font-bold truncate" title={area.areaName}>
                              {area.areaName}
                            </span>
                            <span className="text-[11px] font-mono tabular-nums text-[#5EEAD4] shrink-0">
                              {area.occupancyPct}%
                            </span>
                          </div>

                          {/* Rack Slots Grid */}
                          <div
                            className="grid gap-1.5"
                            style={{
                              gridTemplateColumns: `repeat(${Math.min(
                                activeLayout.aisleColumns,
                                Math.max(1, area.racks.length)
                              )}, minmax(0, 1fr))`,
                            }}
                          >
                            {area.racks.map((rack) => {
                              const meta = STATUS_META[rack.status];
                              const isSelected = selectedRack?.rackCode === rack.rackCode;
                              const isMatched = matchesRackFilter(rack);
                              const dimmed =
                                (statusFilter !== 'all' || Boolean(normalizedSearch)) && !isMatched;

                              return (
                                <button
                                  key={rack.rackCode}
                                  type="button"
                                  onClick={() => setSelectedRackCode(rack.rackCode)}
                                  title={`${rack.rackCode} (${rack.areaName}) — ${rack.occupancyPct}% (${formatNumber(rack.usedQty)} / ${formatNumber(rack.capacity)} ${unitShort})`}
                                  className={`group relative h-14 rounded-md border overflow-hidden flex flex-col justify-between p-1 text-left transition-transform cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                                    isSelected
                                      ? 'border-[var(--accent)] ring-2 ring-[var(--accent)] scale-[1.03] z-10 bg-[var(--surface)]'
                                      : `${meta.borderClass} bg-[var(--bg)] hover:scale-[1.02]`
                                  } ${dimmed ? 'opacity-25' : 'opacity-100'}`}
                                >
                                  {/* Bottom-up capacity fill bar */}
                                  <div
                                    className={`absolute inset-x-0 bottom-0 ${meta.fillClass} transition-all`}
                                    style={{ height: `${Math.max(rack.usedQty > 0 ? 14 : 0, rack.displayPct)}%` }}
                                  />
                                  <span className="relative z-10 text-[10px] font-mono font-bold leading-none text-[var(--text)] bg-[var(--surface)]/85 px-1 py-0.5 rounded w-fit">
                                    {rack.rackCode}
                                  </span>
                                  <span className="relative z-10 text-[10px] font-mono tabular-nums font-bold leading-none text-[var(--text)] bg-[var(--surface)]/85 px-1 py-0.5 rounded self-end">
                                    {rack.occupancyPct}%
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Bottom Main Entrance Marker */}
                  {facilitySet.has('Pintu Utama') && (
                    <div className="flex justify-center pt-1">
                      <div className="inline-flex items-center gap-2 px-6 py-2 rounded-lg border-2 border-dashed border-[var(--accent)] bg-[var(--surface)] text-xs font-bold text-[var(--text)]">
                        <DoorOpen className="w-4 h-4 text-[var(--accent-text)]" />
                        <span>Pintu Utama / Akses Keluar Masuk</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* RIGHT: Detail Rak Panel */}
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 sm:p-5 flex flex-col justify-between gap-4">
              {selectedRack ? (
                <>
                  <div className="space-y-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-medium text-[var(--text-muted)]">Detail Rak Terpilih</p>
                        <h3 className="font-display text-2xl font-bold text-[var(--text)] font-mono mt-0.5">
                          {selectedRack.rackCode}
                        </h3>
                        <p className="text-xs text-[var(--text-muted)]">
                          {selectedRack.areaName} · Baris {selectedRack.rowNumber}, Kolom {selectedRack.colNumber}
                        </p>
                      </div>
                      <div
                        className={`inline-flex items-center gap-1 text-xs font-semibold ${STATUS_META[selectedRack.status].textClass}`}
                      >
                        {selectedRack.status === 'critical' || selectedRack.status === 'warning' ? (
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        ) : (
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        )}
                        <span>{STATUS_META[selectedRack.status].shortLabel}</span>
                      </div>
                    </div>

                    {/* Donut Gauge + Capacity Readout */}
                    <div className="flex items-center gap-4 py-3 border-y border-[var(--border)]">
                      <OccupancyDonutGauge
                        pct={selectedRack.occupancyPct}
                        status={selectedRack.status}
                      />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <p className="text-xs font-medium text-[var(--text-muted)]">Kapasitas Rak</p>
                        <p className="font-mono tabular-nums text-sm font-bold text-[var(--text)]">
                          {formatNumber(selectedRack.usedQty)} / {formatNumber(selectedRack.capacity)} {unitShort}
                        </p>
                        <div className="h-2 w-full rounded-full bg-[var(--bg)] border border-[var(--border)] overflow-hidden">
                          <div
                            className={`h-full ${STATUS_META[selectedRack.status].barClass}`}
                            style={{ width: `${selectedRack.displayPct}%` }}
                          />
                        </div>
                        {globalSettings.showOvercapacityBadge && selectedRack.isOvercapacity && (
                          <p className="text-[11px] font-semibold text-red-600 dark:text-red-400">
                            Melebihi kapasitas maks (+{formatNumber(selectedRack.usedQty - selectedRack.capacity)} {unitShort})
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Metadata Rows */}
                    <div className="space-y-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[var(--text-muted)]">Gudang</span>
                        <span className="font-semibold text-[var(--text)] truncate max-w-[180px]">
                          {activeLayout.displayName || activeWarehouse.name}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[var(--text-muted)]">Jenis Barang (SKU)</span>
                        <span className="font-mono tabular-nums font-semibold text-[var(--text)]">
                          {formatNumber(selectedRack.skuCount)} Jenis
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[var(--text-muted)]">Sumber Data</span>
                        <span className="font-medium text-[var(--text)]">
                          {floorplan.isPreviewMode ? 'Simulasi Pratinjau' : 'Stok Live MyERP'}
                        </span>
                      </div>
                    </div>

                    {/* Items in Rack */}
                    <div className="space-y-2 pt-2 border-t border-[var(--border)]">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-[var(--text)]">
                          Daftar Barang di Slot Ini
                        </p>
                        {onJumpToStockTable && (
                          <button
                            type="button"
                            onClick={() => onJumpToStockTable(activeWarehouse.name)}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--accent-text)] hover:underline cursor-pointer"
                          >
                            <span>Lihat Semua Stok</span>
                            <ArrowUpRight className="w-3 h-3" />
                          </button>
                        )}
                      </div>

                      {selectedRack.items.length > 0 ? (
                        <div className="max-h-48 overflow-y-auto divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg bg-[var(--bg)]">
                          {selectedRack.items.slice(0, 12).map((it, idx) => (
                            <div
                              key={`${it.code}-${idx}`}
                              className="px-2.5 py-2 flex items-center justify-between gap-2 text-[11px]"
                            >
                              <div className="min-w-0">
                                <p className="font-mono font-semibold text-[var(--text)] truncate">
                                  {it.code}
                                </p>
                                <p className="text-[var(--text-muted)] truncate" title={it.name}>
                                  {it.name}
                                </p>
                              </div>
                              <span className="font-mono tabular-nums font-bold text-[var(--text)] shrink-0">
                                {formatNumber(it.qty)} {it.unit || unitShort}
                              </span>
                            </div>
                          ))}
                          {selectedRack.items.length > 12 && (
                            <p className="px-2.5 py-1.5 text-[11px] text-[var(--text-muted)] text-center">
                              +{formatNumber(selectedRack.items.length - 12)} barang lainnya
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="text-[11px] text-[var(--text-muted)] bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2.5">
                          {floorplan.isPreviewMode
                            ? 'Sedang dalam mode pratinjau layout.'
                            : 'Belum ada item stok aktif yang teralokasi pada slot rak ini.'}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Footer CTA */}
                  <div className="pt-2 border-t border-[var(--border)] flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsFullscreen(false);
                        setSubView('settings');
                      }}
                      className="w-full inline-flex items-center justify-center gap-1.5 h-9 px-3 text-xs font-semibold text-[var(--text)] bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--accent)] rounded-lg transition-colors cursor-pointer"
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                      <span>Atur Layout &amp; Kapasitas</span>
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-xs text-[var(--text-muted)]">Pilih salah satu rak pada peta untuk melihat detailnya.</p>
              )}
            </div>
          </div>

          {/* Bottom 3-Column Strip: Legend & Status Filter · Search & Filter · Quick Switch Visible Warehouses */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* 1. Keterangan Warna & Ringkasan Status */}
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-display text-xs font-bold text-[var(--text)]">Keterangan Warna</h4>
                {statusFilter !== 'all' && (
                  <button
                    type="button"
                    onClick={() => setStatusFilter('all')}
                    className="text-[11px] font-semibold text-[var(--accent-text)] hover:underline cursor-pointer"
                  >
                    Tampilkan Semua
                  </button>
                )}
              </div>
              <div className="space-y-2 text-xs">
                {(
                  [
                    {
                      status: 'normal' as const,
                      title: `Aman (1–${globalSettings.greenMaxPct}%)`,
                      count: floorplan.normalCount,
                    },
                    {
                      status: 'warning' as const,
                      title: `Hampir Penuh (${globalSettings.greenMaxPct + 1}–${globalSettings.yellowMaxPct}%)`,
                      count: floorplan.warningCount,
                    },
                    {
                      status: 'critical' as const,
                      title: `Penuh / Perhatian (>${globalSettings.yellowMaxPct}%)`,
                      count: floorplan.criticalCount,
                    },
                    {
                      status: 'empty' as const,
                      title: 'Kosong (0%)',
                      count: floorplan.emptyCount,
                    },
                  ]
                ).map((item) => {
                  const active = statusFilter === item.status;
                  return (
                    <button
                      key={item.status}
                      type="button"
                      onClick={() => setStatusFilter(active ? 'all' : item.status)}
                      className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border transition-colors cursor-pointer ${
                        active
                          ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                          : 'border-transparent hover:bg-[var(--bg)]'
                      }`}
                    >
                      <span className="flex items-center gap-2.5 text-[var(--text)]">
                        <span className={`w-5 h-2.5 rounded-sm ${STATUS_META[item.status].barClass} shrink-0`} />
                        <span>{item.title}</span>
                      </span>
                      <span className="font-mono tabular-nums font-bold text-[var(--text)]">
                        {formatNumber(item.count)} rak
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Filter & Pencarian */}
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-display text-xs font-bold text-[var(--text)]">Filter &amp; Pencarian</h4>
                {(searchQuery || statusFilter !== 'all' || selectedAreaFilter !== 'all') && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setStatusFilter('all');
                      setSelectedAreaFilter('all');
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--accent-text)] hover:underline cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                    <span>Reset</span>
                  </button>
                )}
              </div>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari kode rak (mis. B-12) atau barang..."
                  className="w-full h-9 pl-9 pr-3 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as 'all' | WarehouseRackStatus)}
                  className="h-9 px-2.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                >
                  <option value="all">Semua Status</option>
                  <option value="normal">Aman (Hijau)</option>
                  <option value="warning">Hampir Penuh (Kuning)</option>
                  <option value="critical">Penuh (Merah)</option>
                  <option value="empty">Kosong</option>
                </select>
                <select
                  value={selectedAreaFilter}
                  onChange={(e) => setSelectedAreaFilter(e.target.value)}
                  className="h-9 px-2.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                >
                  <option value="all">Semua Area</option>
                  {floorplan.areas.map((a) => (
                    <option key={a.areaIndex} value={String(a.areaIndex)}>
                      {a.areaName}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-[11px] text-[var(--text-muted)] font-mono tabular-nums">
                Cocok: <strong className="text-[var(--text)]">{formatNumber(filteredRacksList.length)}</strong> dari{' '}
                {formatNumber(floorplan.totalRacks)} rak
              </p>
            </div>

            {/* 3. Gudang Aktif Ditampilkan */}
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-display text-xs font-bold text-[var(--text)]">
                  Gudang Ditampilkan ({formatNumber(visibleWarehouses.length)})
                </h4>
                <button
                  type="button"
                  onClick={() => {
                    setIsFullscreen(false);
                    setSubView('settings');
                  }}
                  className="text-[11px] font-semibold text-[var(--accent-text)] hover:underline cursor-pointer"
                >
                  Kelola Gudang
                </button>
              </div>
              <div className="max-h-36 overflow-y-auto divide-y divide-[var(--border)]">
                {visibleWarehouses.map((w) => {
                  const k = w.code || w.name;
                  const cfg = resolvedLayoutsMap.get(k);
                  const isCurrent = k === activeWhKey;
                  const totalCap = cfg ? cfg.areaCount * cfg.racksPerArea * cfg.defaultRackCapacity : 0;
                  const estPct = totalCap > 0 ? Math.round((w.totalQty / totalCap) * 100) : 0;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => {
                        setSelectedWarehouseKey(k);
                        setSelectedAreaFilter('all');
                        setSelectedRackCode('');
                      }}
                      className={`w-full py-2 px-2 flex items-center justify-between gap-2 text-left text-xs transition-colors rounded-md cursor-pointer ${
                        isCurrent ? 'bg-[var(--accent-soft)] font-semibold' : 'hover:bg-[var(--bg)]'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-[var(--text)] truncate">{cfg?.displayName || w.name}</p>
                        <p className="text-[11px] text-[var(--text-muted)] font-mono tabular-nums">
                          {formatNumber(w.skuCount)} SKU · Qty {formatNumber(w.totalQty)}
                        </p>
                      </div>
                      <span className="font-mono tabular-nums text-xs font-bold text-[var(--text)] shrink-0">
                        {estPct}%
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : subView === 'racks' && floorplan && activeLayout && activeWarehouse ? (
        /* DAFTAR RAK SUB-VIEW */
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
          <div className="p-4 border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-sm font-bold text-[var(--text)]">
                Daftar Rak — {activeLayout.displayName || activeWarehouse.name}
              </h3>
              <p className="text-xs text-[var(--text-muted)] mt-0.5 font-mono tabular-nums">
                Menampilkan {formatNumber(filteredRacksList.length)} dari {formatNumber(floorplan.totalRacks)} rak
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari kode rak / barang..."
                  className="h-8 pl-8 pr-3 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'all' | WarehouseRackStatus)}
                className="h-8 px-2.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
              >
                <option value="all">Semua Status</option>
                <option value="normal">Aman (Hijau)</option>
                <option value="warning">Hampir Penuh (Kuning)</option>
                <option value="critical">Penuh (Merah)</option>
                <option value="empty">Kosong</option>
              </select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--bg)] text-[11px] font-semibold text-[var(--text-muted)]">
                  <th className="py-2.5 px-4">Kode Rak</th>
                  <th className="py-2.5 px-4">Area</th>
                  <th className="py-2.5 px-4">Posisi</th>
                  <th className="py-2.5 px-4 text-right">Terisi ({unitShort})</th>
                  <th className="py-2.5 px-4 text-right">Kapasitas ({unitShort})</th>
                  <th className="py-2.5 px-4 text-right">Okupansi</th>
                  <th className="py-2.5 px-4 text-right">SKU</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)] text-xs">
                {filteredRacksList.map((rack) => (
                  <tr key={rack.rackCode} className="hover:bg-[var(--bg)]/60">
                    <td className="py-2.5 px-4 font-mono font-bold text-[var(--text)]">
                      {rack.rackCode}
                    </td>
                    <td className="py-2.5 px-4 text-[var(--text)]">{rack.areaName}</td>
                    <td className="py-2.5 px-4 text-[var(--text-muted)] font-mono tabular-nums">
                      Baris {rack.rowNumber} · Kolom {rack.colNumber}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-[var(--text)]">
                      {formatNumber(rack.usedQty)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-[var(--text-muted)]">
                      {formatNumber(rack.capacity)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-[var(--text)]">
                      {rack.occupancyPct}%
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-[var(--text)]">
                      {formatNumber(rack.skuCount)}
                    </td>
                    <td className={`py-2.5 px-4 font-semibold ${STATUS_META[rack.status].textClass}`}>
                      {STATUS_META[rack.status].shortLabel}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedRackCode(rack.rackCode);
                          setSubView('map');
                        }}
                        className="inline-flex items-center gap-1 h-7 px-2.5 text-xs font-medium text-[var(--text)] bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--accent)] rounded-md cursor-pointer"
                      >
                        <LayoutGrid className="w-3 h-3" />
                        <span>Lihat di Peta</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : subView === 'stats' && floorplan && activeLayout && activeWarehouse ? (
        /* STATISTIK SUB-VIEW */
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
              <p className="text-xs text-[var(--text-muted)]">Utilisasi Keseluruhan</p>
              <p className="mt-1 font-mono tabular-nums text-2xl font-bold text-[var(--text)]">
                {floorplan.overallPct}%
              </p>
              <p className="mt-0.5 text-[11px] font-mono tabular-nums text-[var(--text-muted)]">
                {formatNumber(floorplan.totalUsed)} / {formatNumber(floorplan.totalCapacity)} {unitShort}
              </p>
            </div>
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
              <p className="text-xs text-[var(--text-muted)]">Rak Aman (Hijau)</p>
              <p className="mt-1 font-mono tabular-nums text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                {formatNumber(floorplan.normalCount)}
              </p>
              <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                1–{globalSettings.greenMaxPct}% terisi
              </p>
            </div>
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
              <p className="text-xs text-[var(--text-muted)]">Hampir Penuh (Kuning)</p>
              <p className="mt-1 font-mono tabular-nums text-2xl font-bold text-amber-600 dark:text-amber-400">
                {formatNumber(floorplan.warningCount)}
              </p>
              <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                {globalSettings.greenMaxPct + 1}–{globalSettings.yellowMaxPct}% terisi
              </p>
            </div>
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
              <p className="text-xs text-[var(--text-muted)]">Penuh / Perhatian (Merah)</p>
              <p className="mt-1 font-mono tabular-nums text-2xl font-bold text-red-600 dark:text-red-400">
                {formatNumber(floorplan.criticalCount)}
              </p>
              <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                &gt;{globalSettings.yellowMaxPct}% kapasitas
              </p>
            </div>
          </div>

          {/* Per-Area Breakdown */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-3.5">
            <h3 className="font-display text-sm font-bold text-[var(--text)]">
              Distribusi Kapasitas per Area — {activeLayout.displayName || activeWarehouse.name}
            </h3>
            <div className="space-y-3">
              {floorplan.areas.map((a) => {
                const status =
                  a.totalUsed <= 0
                    ? 'empty'
                    : a.occupancyPct <= globalSettings.greenMaxPct
                      ? 'normal'
                      : a.occupancyPct <= globalSettings.yellowMaxPct
                        ? 'warning'
                        : 'critical';
                return (
                  <div key={a.areaIndex} className="space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-[var(--text)]">{a.areaName}</span>
                        <span className="text-[var(--text-muted)] font-mono tabular-nums text-[11px]">
                          {a.racks.length} rak · Hijau {a.normalCount} · Kuning {a.warningCount} · Merah {a.criticalCount}
                        </span>
                      </div>
                      <span className="font-mono tabular-nums font-bold text-[var(--text)]">
                        {a.occupancyPct}% ({formatNumber(a.totalUsed)} / {formatNumber(a.totalCapacity)} {unitShort})
                      </span>
                    </div>
                    <div className="h-2.5 w-full rounded-full bg-[var(--bg)] border border-[var(--border)] overflow-hidden">
                      <div
                        className={`h-full ${STATUS_META[status].barClass}`}
                        style={{ width: `${Math.min(100, a.occupancyPct)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
