import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Check,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  Grid2x2,
  Info,
  Layers,
  Loader2,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import type { DirectoryMember, UserProfile } from '../types/sop';
import {
  buildDefaultAreaNames,
  DEFAULT_FACILITY_ZONES,
  getCapacityUnitShort,
  saveWarehouseMapGlobalSettings,
  saveWarehouseMapLayout,
  WAREHOUSE_CAPACITY_UNITS,
  WAREHOUSE_SIZE_PRESETS,
  type ErpWarehouseMasterItem,
  type ErpWarehousesMasterResult,
  type WarehouseCapacityUnit,
  type WarehouseMapGlobalSettings,
  type WarehouseMapLayoutConfig,
  type WarehouseSizePreset,
} from '../lib/warehouseMapService';

interface ErpWarehouseSettingsPanelProps {
  user: UserProfile;
  directory: DirectoryMember[];
  canManage: boolean;
  masterResult: ErpWarehousesMasterResult | null;
  loadingMaster: boolean;
  resolvedLayouts: Map<string, WarehouseMapLayoutConfig>;
  savedLayoutsMap: Map<string, WarehouseMapLayoutConfig>;
  globalSettings: WarehouseMapGlobalSettings;
  hasSavedGlobalSettings: boolean;
  selectedWarehouseKey: string;
  previewMode: boolean;
  onPreviewModeChange: (next: boolean) => void;
  onSelectWarehouseKey: (key: string) => void;
  onLayoutSaved: (saved: WarehouseMapLayoutConfig) => void;
  onGlobalSettingsSaved: (saved: WarehouseMapGlobalSettings) => void;
  onRefreshMaster: () => void;
  onDownloadBridge?: () => void;
  onOpenMapForWarehouse?: (key: string) => void;
  formatNumber: (n: number) => string;
}

export function ErpWarehouseSettingsPanel({
  user,
  directory,
  canManage,
  masterResult,
  loadingMaster,
  resolvedLayouts,
  savedLayoutsMap,
  globalSettings,
  hasSavedGlobalSettings,
  selectedWarehouseKey,
  previewMode,
  onPreviewModeChange,
  onSelectWarehouseKey,
  onLayoutSaved,
  onGlobalSettingsSaved,
  onRefreshMaster,
  onDownloadBridge,
  onOpenMapForWarehouse,
  formatNumber,
}: ErpWarehouseSettingsPanelProps) {
  const [settingsSubTab, setSettingsSubTab] = useState<'warehouses' | 'layout'>('warehouses');
  const [whSearch, setWhSearch] = useState('');
  const [whFilter, setWhFilter] = useState<'all' | 'visible' | 'hidden' | 'intransit'>('all');
  const [togglingKey, setTogglingKey] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);

  // Layout form state for the currently selected warehouse
  const warehouses = masterResult?.warehouses || [];
  const activeWarehouse: ErpWarehouseMasterItem | null = useMemo(() => {
    if (warehouses.length === 0) return null;
    return (
      warehouses.find((w) => (w.code || w.name) === selectedWarehouseKey) ||
      warehouses.find((w) => resolvedLayouts.get(w.code || w.name)?.isVisible) ||
      warehouses[0]
    );
  }, [warehouses, selectedWarehouseKey, resolvedLayouts]);

  const activeWhKey = activeWarehouse ? activeWarehouse.code || activeWarehouse.name : '';
  const activeLayout = activeWhKey ? resolvedLayouts.get(activeWhKey) || null : null;

  const [displayName, setDisplayName] = useState('');
  const [preset, setPreset] = useState<WarehouseSizePreset>('medium');
  const [areaCount, setAreaCount] = useState(4);
  const [racksPerArea, setRacksPerArea] = useState(12);
  const [aisleColumns, setAisleColumns] = useState(3);
  const [defaultRackCapacity, setDefaultRackCapacity] = useState(1000);
  const [capacityUnit, setCapacityUnit] = useState<WarehouseCapacityUnit>('pcs');
  const [areaNames, setAreaNames] = useState<string[]>(buildDefaultAreaNames(4));
  const [facilityZones, setFacilityZones] = useState<string[]>([...DEFAULT_FACILITY_ZONES]);

  // Global threshold & sync form state
  const [greenMaxPct, setGreenMaxPct] = useState(globalSettings.greenMaxPct);
  const [yellowMaxPct, setYellowMaxPct] = useState(globalSettings.yellowMaxPct);
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState(globalSettings.autoRefreshSeconds);
  const [showOvercapacityBadge, setShowOvercapacityBadge] = useState(
    globalSettings.showOvercapacityBadge
  );
  const [syncVisibilityToStockTable, setSyncVisibilityToStockTable] = useState(
    globalSettings.syncVisibilityToStockTable
  );

  const [savingLayout, setSavingLayout] = useState(false);
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sync layout form whenever selected warehouse or saved layout changes
  useEffect(() => {
    if (!activeLayout) return;
    setDisplayName(activeLayout.displayName || activeLayout.warehouseName);
    setPreset(activeLayout.preset);
    setAreaCount(activeLayout.areaCount);
    setRacksPerArea(activeLayout.racksPerArea);
    setAisleColumns(activeLayout.aisleColumns);
    setDefaultRackCapacity(activeLayout.defaultRackCapacity);
    setCapacityUnit(activeLayout.capacityUnit);
    setAreaNames(buildDefaultAreaNames(activeLayout.areaCount, activeLayout.areaNames));
    setFacilityZones(
      Array.isArray(activeLayout.facilityZones)
        ? activeLayout.facilityZones
        : [...DEFAULT_FACILITY_ZONES]
    );
  }, [activeWhKey, activeLayout]);

  useEffect(() => {
    setGreenMaxPct(globalSettings.greenMaxPct);
    setYellowMaxPct(globalSettings.yellowMaxPct);
    setAutoRefreshSeconds(globalSettings.autoRefreshSeconds);
    setShowOvercapacityBadge(globalSettings.showOvercapacityBadge);
    setSyncVisibilityToStockTable(globalSettings.syncVisibilityToStockTable);
  }, [globalSettings]);

  const handleSelectPreset = (nextPreset: Exclude<WarehouseSizePreset, 'custom'>) => {
    const cfg = WAREHOUSE_SIZE_PRESETS[nextPreset];
    setPreset(nextPreset);
    setAreaCount(cfg.areaCount);
    setRacksPerArea(cfg.racksPerArea);
    setAisleColumns(cfg.aisleColumns);
    setAreaNames((prev) => buildDefaultAreaNames(cfg.areaCount, prev));
  };

  const handleAreaCountChange = (val: number) => {
    const clamped = Math.max(1, Math.min(12, Math.round(val || 1)));
    setAreaCount(clamped);
    setPreset('custom');
    setAreaNames((prev) => buildDefaultAreaNames(clamped, prev));
  };

  const handleToggleFacilityZone = (zone: string) => {
    setFacilityZones((prev) =>
      prev.includes(zone) ? prev.filter((z) => z !== zone) : [...prev, zone]
    );
  };

  const handleToggleWarehouseVisibility = async (wh: ErpWarehouseMasterItem) => {
    if (!canManage || togglingKey || batchBusy) return;
    const key = wh.code || wh.name;
    const current = resolvedLayouts.get(key);
    if (!current) return;

    setTogglingKey(key);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const nextVisible = !current.isVisible;
      const saved = await saveWarehouseMapLayout({
        layout: {
          ...current,
          isVisible: nextVisible,
        },
        existing: savedLayoutsMap.get(current.id) || null,
        actor: user,
        directory,
        auditAction: nextVisible ? 'Tampilkan Gudang di Peta' : 'Sembunyikan Gudang di Peta',
      });
      onLayoutSaved(saved);
      setStatusMsg(
        `Gudang "${saved.displayName || saved.warehouseName}" ${
          nextVisible ? 'ditampilkan di Peta Gudang' : 'disembunyikan dari Peta Gudang'
        }.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal mengubah status tampil gudang.');
    } finally {
      setTogglingKey(null);
    }
  };

  const handleBatchVisibility = async (mode: 'show_physical' | 'hide_intransit') => {
    if (!canManage || batchBusy || togglingKey) return;
    setBatchBusy(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      let changedCount = 0;
      for (const wh of warehouses) {
        const key = wh.code || wh.name;
        const current = resolvedLayouts.get(key);
        if (!current) continue;
        const targetVisible =
          mode === 'show_physical'
            ? !wh.isIntransit && wh.isActive
            : wh.isIntransit
              ? false
              : current.isVisible;
        if (current.isVisible === targetVisible) continue;
        const saved = await saveWarehouseMapLayout({
          layout: {
            ...current,
            isVisible: targetVisible,
          },
          existing: savedLayoutsMap.get(current.id) || null,
          actor: user,
          directory,
          auditAction: 'Pengaturan Massal Visibilitas Gudang',
        });
        onLayoutSaved(saved);
        changedCount += 1;
      }
      setStatusMsg(
        changedCount > 0
          ? `${changedCount} pengaturan visibilitas gudang berhasil diperbarui.`
          : 'Seluruh gudang sudah sesuai dengan pilihan tersebut.'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal memperbarui visibilitas massal.');
    } finally {
      setBatchBusy(false);
    }
  };

  const handleSaveLayoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage || !activeLayout || savingLayout) return;
    setSavingLayout(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const saved = await saveWarehouseMapLayout({
        layout: {
          ...activeLayout,
          displayName: displayName.trim() || activeLayout.warehouseName,
          preset,
          areaCount,
          racksPerArea,
          aisleColumns,
          defaultRackCapacity,
          capacityUnit,
          areaNames: buildDefaultAreaNames(areaCount, areaNames),
          facilityZones,
        },
        existing: savedLayoutsMap.get(activeLayout.id) || null,
        actor: user,
        directory,
      });
      onLayoutSaved(saved);
      setStatusMsg(
        `Layout & kapasitas gudang "${saved.displayName || saved.warehouseName}" berhasil disimpan (${saved.areaCount} Area · ${saved.areaCount * saved.racksPerArea} Rak).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menyimpan layout gudang.');
    } finally {
      setSavingLayout(false);
    }
  };

  const handleSaveGlobalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage || savingGlobal) return;
    const safeGreen = Math.max(1, Math.min(98, Math.round(greenMaxPct)));
    const safeYellow = Math.max(1, Math.min(100, Math.round(yellowMaxPct)));
    if (safeYellow <= safeGreen) {
      setErrorMsg('Batas Maks Kuning (%) harus lebih besar dari Batas Maks Hijau (%).');
      return;
    }
    setSavingGlobal(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const saved = await saveWarehouseMapGlobalSettings({
        greenMaxPct: safeGreen,
        yellowMaxPct: safeYellow,
        autoRefreshSeconds,
        showOvercapacityBadge,
        syncVisibilityToStockTable,
        existing: hasSavedGlobalSettings ? globalSettings : null,
        actor: user,
        directory,
      });
      onGlobalSettingsSaved(saved);
      setStatusMsg(
        `Threshold kapasitas disimpan (Hijau 0–${saved.greenMaxPct}% · Kuning ${saved.greenMaxPct + 1}–${saved.yellowMaxPct}% · Merah >${saved.yellowMaxPct}%).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menyimpan threshold kapasitas.');
    } finally {
      setSavingGlobal(false);
    }
  };

  const warehouseStats = useMemo(() => {
    let visibleCount = 0;
    let hiddenCount = 0;
    let intransitCount = 0;
    for (const wh of warehouses) {
      const key = wh.code || wh.name;
      const cfg = resolvedLayouts.get(key);
      if (wh.isIntransit) intransitCount += 1;
      if (cfg?.isVisible) visibleCount += 1;
      else hiddenCount += 1;
    }
    return {
      total: warehouses.length,
      visibleCount,
      hiddenCount,
      intransitCount,
    };
  }, [warehouses, resolvedLayouts]);

  const filteredWarehouses = useMemo(() => {
    const q = whSearch.trim().toLowerCase();
    return warehouses.filter((wh) => {
      const key = wh.code || wh.name;
      const cfg = resolvedLayouts.get(key);
      if (whFilter === 'visible' && !cfg?.isVisible) return false;
      if (whFilter === 'hidden' && cfg?.isVisible) return false;
      if (whFilter === 'intransit' && !wh.isIntransit) return false;
      if (q) {
        const hay = `${wh.code} ${wh.name} ${cfg?.displayName || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [warehouses, resolvedLayouts, whSearch, whFilter]);

  const totalRacksPreview = areaCount * racksPerArea;
  const totalCapacityPreview = totalRacksPreview * Math.max(1, defaultRackCapacity || 0);
  const unitShort = getCapacityUnitShort(capacityUnit);
  const safeGreenBar = Math.max(1, Math.min(98, greenMaxPct || 69));
  const safeYellowBar = Math.max(safeGreenBar + 1, Math.min(100, yellowMaxPct || 90));

  return (
    <div className="space-y-4">
      {/* Sub-navigation between Master Warehouse Visibility & Layout/Threshold Settings */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg">
          <button
            type="button"
            onClick={() => setSettingsSubTab('warehouses')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              settingsSubTab === 'warehouses'
                ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Daftar &amp; Visibilitas Gudang ERP ({formatNumber(warehouseStats.total)})</span>
          </button>
          <button
            type="button"
            onClick={() => setSettingsSubTab('layout')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              settingsSubTab === 'layout'
                ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Layout, Kapasitas &amp; Threshold</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          {!canManage && (
            <span className="text-xs text-[var(--text-muted)]">
              Mode baca saja (hanya Admin Divisi / Super Admin yang dapat menyimpan)
            </span>
          )}
          <button
            type="button"
            onClick={onRefreshMaster}
            disabled={loadingMaster}
            className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium text-[var(--text)] bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--accent)] rounded-lg transition-colors whitespace-nowrap cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingMaster ? 'animate-spin' : ''}`} />
            <span>Sinkron Master ERP</span>
          </button>
        </div>
      </div>

      {/* Feedback banners */}
      {statusMsg && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-2.5 text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2.5 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}
      {masterResult?.warning && (
        <div className="bg-[var(--surface)] border border-[var(--warning)]/40 rounded-xl px-4 py-3 text-xs text-[var(--text)] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-2 min-w-0">
            <Info className="w-4 h-4 text-[var(--warning)] shrink-0 mt-0.5" />
            <span className="text-[var(--text-muted)]">{masterResult.warning}</span>
          </div>
          {onDownloadBridge && (
            <button
              type="button"
              onClick={onDownloadBridge}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Unduh Bridge v11</span>
            </button>
          )}
        </div>
      )}

      {settingsSubTab === 'warehouses' ? (
        <div className="space-y-4">
          {/* 4-column Master Warehouse KPI */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
              <p className="text-xs font-medium text-[var(--text-muted)]">Total Gudang di Sistem ERP</p>
              <p className="mt-1 font-mono tabular-nums text-2xl font-bold text-[var(--text)]">
                {formatNumber(warehouseStats.total)}
              </p>
              <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                Sumber: {masterResult?.sourceMode === 'bridge_fallback_stock' ? 'Ringkasan Stok ERP' : 'Master Gudang ERP'}
              </p>
            </div>
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
              <p className="text-xs font-medium text-[var(--text-muted)]">Ditampilkan di Peta</p>
              <p className="mt-1 font-mono tabular-nums text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                {formatNumber(warehouseStats.visibleCount)}
              </p>
              <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">Aktif pada pilihan Peta Gudang</p>
            </div>
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
              <p className="text-xs font-medium text-[var(--text-muted)]">Disembunyikan</p>
              <p className="mt-1 font-mono tabular-nums text-2xl font-bold text-[var(--text)]">
                {formatNumber(warehouseStats.hiddenCount)}
              </p>
              <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">Tidak tampil di Peta Gudang</p>
            </div>
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
              <p className="text-xs font-medium text-[var(--text-muted)]">Gudang Virtual / Intransit</p>
              <p className="mt-1 font-mono tabular-nums text-2xl font-bold text-amber-600 dark:text-amber-400">
                {formatNumber(warehouseStats.intransitCount)}
              </p>
              <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">Default disembunyikan dari peta fisik</p>
            </div>
          </div>

          {/* Filter & batch actions */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="p-4 border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[240px]">
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                  <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={whSearch}
                    onChange={(e) => setWhSearch(e.target.value)}
                    placeholder="Cari kode atau nama gudang ERP..."
                    className="w-full h-9 pl-9 pr-3 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>
                <div className="inline-flex items-center gap-1 p-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg">
                  {(
                    [
                      { id: 'all', label: 'Semua' },
                      { id: 'visible', label: 'Ditampilkan' },
                      { id: 'hidden', label: 'Disembunyikan' },
                      { id: 'intransit', label: 'Intransit' },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setWhFilter(f.id)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                        whFilter === f.id
                          ? 'bg-[var(--surface)] text-[var(--text)] shadow-xs border border-[var(--border)]'
                          : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {canManage && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={batchBusy || loadingMaster}
                    onClick={() => handleBatchVisibility('show_physical')}
                    className="h-8 px-3 text-xs font-medium text-[var(--text)] bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--accent)] rounded-lg transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
                  >
                    Tampilkan Semua Gudang Fisik
                  </button>
                  <button
                    type="button"
                    disabled={batchBusy || loadingMaster}
                    onClick={() => handleBatchVisibility('hide_intransit')}
                    className="h-8 px-3 text-xs font-medium text-[var(--text)] bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--accent)] rounded-lg transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50"
                  >
                    Sembunyikan Intransit
                  </button>
                </div>
              )}
            </div>

            {/* Table of ALL ERP warehouses */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--bg)] text-[11px] font-semibold text-[var(--text-muted)]">
                    <th className="py-2.5 px-4">Kode ERP</th>
                    <th className="py-2.5 px-4">Nama Gudang</th>
                    <th className="py-2.5 px-4">Tipe &amp; Status ERP</th>
                    <th className="py-2.5 px-4 text-right">SKU Aktif</th>
                    <th className="py-2.5 px-4 text-right">Total Qty ERP</th>
                    <th className="py-2.5 px-4">Konfigurasi Denah</th>
                    <th className="py-2.5 px-4 text-center">Tampil di Peta</th>
                    <th className="py-2.5 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)] text-xs">
                  {loadingMaster && warehouses.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-[var(--text-muted)]">
                        <Loader2 className="w-4 h-4 animate-spin inline-block mr-2" />
                        Memuat seluruh daftar gudang dari ERP...
                      </td>
                    </tr>
                  ) : filteredWarehouses.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-10 text-center text-[var(--text-muted)]">
                        Tidak ada gudang yang cocok dengan filter pencarian.
                      </td>
                    </tr>
                  ) : (
                    filteredWarehouses.map((wh) => {
                      const key = wh.code || wh.name;
                      const cfg = resolvedLayouts.get(key);
                      const isVisible = Boolean(cfg?.isVisible);
                      const isBusy = togglingKey === key || batchBusy;
                      const totalRacks = cfg ? cfg.areaCount * cfg.racksPerArea : 0;
                      const unitLabel = cfg ? getCapacityUnitShort(cfg.capacityUnit) : 'pcs';

                      return (
                        <tr
                          key={key}
                          className="hover:bg-[var(--bg)]/60 transition-colors"
                        >
                          <td className="py-3 px-4 font-mono text-xs font-semibold text-[var(--text)] whitespace-nowrap">
                            {wh.code}
                          </td>
                          <td className="py-3 px-4">
                            <p className="font-semibold text-[var(--text)]">
                              {cfg?.displayName || wh.name}
                            </p>
                            {cfg?.displayName && cfg.displayName !== wh.name && (
                              <p className="text-[11px] text-[var(--text-muted)]">
                                Master ERP: {wh.name}
                              </p>
                            )}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap text-[var(--text-muted)]">
                            <span className={wh.isIntransit ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-[var(--text)]'}>
                              {wh.isIntransit ? 'Virtual / Intransit' : 'Gudang Fisik'}
                            </span>
                            <span className="mx-1.5" aria-hidden="true">·</span>
                            <span>{wh.isActive ? 'Aktif' : 'Nonaktif'}</span>
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-[var(--text)]">
                            {formatNumber(wh.skuCount)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-[var(--text)]">
                            {formatNumber(wh.totalQty)}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap text-[var(--text-muted)] font-mono tabular-nums text-[11px]">
                            {cfg ? (
                              <span>
                                {cfg.areaCount} Area · {totalRacks} Rak · {formatNumber(cfg.defaultRackCapacity)} {unitLabel}/rak
                              </span>
                            ) : (
                              <span>Default</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <button
                              type="button"
                              disabled={!canManage || isBusy}
                              onClick={() => handleToggleWarehouseVisibility(wh)}
                              className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-semibold border transition-colors whitespace-nowrap cursor-pointer disabled:opacity-50 ${
                                isVisible
                                  ? 'bg-emerald-500/12 border-emerald-500/35 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20'
                                  : 'bg-[var(--bg)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]'
                              }`}
                              title={isVisible ? 'Klik untuk menyembunyikan gudang' : 'Klik untuk menampilkan gudang'}
                            >
                              {isBusy ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : isVisible ? (
                                <Eye className="w-3.5 h-3.5" />
                              ) : (
                                <EyeOff className="w-3.5 h-3.5" />
                              )}
                              <span>{isVisible ? 'Ditampilkan' : 'Disembunyikan'}</span>
                            </button>
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  onSelectWarehouseKey(key);
                                  setSettingsSubTab('layout');
                                }}
                                className="h-7 px-2.5 text-xs font-medium text-[var(--text)] bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--accent)] rounded-md transition-colors cursor-pointer"
                              >
                                Atur Layout
                              </button>
                              {isVisible && onOpenMapForWarehouse && (
                                <button
                                  type="button"
                                  onClick={() => onOpenMapForWarehouse(key)}
                                  className="h-7 px-2.5 text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] rounded-md transition-colors cursor-pointer"
                                >
                                  Buka Peta
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
          </div>
        </div>
      ) : (
        /* Tab 2: 2-Column Pengaturan Kapasitas & Layout Gudang + Threshold Kapasitas */
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] gap-4 items-start">
          {/* LEFT CARD: Pengaturan Kapasitas & Layout Gudang */}
          <form
            onSubmit={handleSaveLayoutSubmit}
            className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-[var(--accent-soft)] border border-[var(--accent)]/30 flex items-center justify-center shrink-0">
                  <Layers className="w-4 h-4 text-[var(--accent-text)]" />
                </div>
                <div>
                  <h3 className="font-display text-sm font-bold text-[var(--text)]">
                    Pengaturan Kapasitas &amp; Layout Gudang
                  </h3>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    Sesuaikan jumlah area, jumlah rak per area, kolom lorong, dan kapasitas sesuai kondisi lapangan tiap gudang ERP.
                  </p>
                </div>
              </div>
            </div>

            {/* Target Warehouse Picker + Alias */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-xs font-semibold text-[var(--text)] mb-1.5">
                  Pilih Gudang ERP
                </label>
                <select
                  value={activeWhKey}
                  onChange={(e) => onSelectWarehouseKey(e.target.value)}
                  className="w-full h-9 px-3 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                >
                  {warehouses.map((w) => {
                    const k = w.code || w.name;
                    const vis = resolvedLayouts.get(k)?.isVisible;
                    return (
                      <option key={k} value={k}>
                        {w.name} ({w.code}) {vis ? '— Ditampilkan' : '— Disembunyikan'}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--text)] mb-1.5">
                  Nama Tampilan di Peta
                </label>
                <input
                  type="text"
                  maxLength={160}
                  disabled={!canManage}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Contoh: Gudang Utama Bahan Baku"
                  className="w-full h-9 px-3 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-60"
                />
              </div>
            </div>

            {/* Preset Cepat Ukuran Gudang */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-[var(--text)]">Preset Cepat Ukuran Gudang</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {(['small', 'medium', 'large'] as const).map((pKey) => {
                  const p = WAREHOUSE_SIZE_PRESETS[pKey];
                  const isActive = preset === pKey;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={!canManage}
                      onClick={() => handleSelectPreset(pKey)}
                      className={`text-left rounded-xl border px-3.5 py-3 transition-colors cursor-pointer disabled:opacity-60 ${
                        isActive
                          ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                          : 'border-[var(--border)] bg-[var(--bg)] hover:border-[var(--text-muted)]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-[var(--text)]">{p.label}</span>
                        {isActive && <Check className="w-3.5 h-3.5 text-[var(--accent-text)] shrink-0" />}
                      </div>
                      <p className="mt-1 text-[11px] font-mono tabular-nums text-[var(--text-muted)]">
                        {p.subtitle}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Grid Structure Inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[var(--text)] mb-1.5">
                  Jumlah Area (1–12)
                </label>
                <input
                  type="number"
                  min={1}
                  max={12}
                  disabled={!canManage}
                  value={areaCount}
                  onChange={(e) => handleAreaCountChange(Number(e.target.value))}
                  className="w-full h-9 px-3 text-xs font-mono tabular-nums bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-60"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--text)] mb-1.5">
                  Jumlah Rak per Area (1–40)
                </label>
                <input
                  type="number"
                  min={1}
                  max={40}
                  disabled={!canManage}
                  value={racksPerArea}
                  onChange={(e) => {
                    setRacksPerArea(Math.max(1, Math.min(40, Math.round(Number(e.target.value) || 1))));
                    setPreset('custom');
                  }}
                  className="w-full h-9 px-3 text-xs font-mono tabular-nums bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-60"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--text)] mb-1.5">
                  Kolom Lorong / Area (1–6)
                </label>
                <input
                  type="number"
                  min={1}
                  max={6}
                  disabled={!canManage}
                  value={aisleColumns}
                  onChange={(e) => {
                    setAisleColumns(Math.max(1, Math.min(6, Math.round(Number(e.target.value) || 1))));
                    setPreset('custom');
                  }}
                  className="w-full h-9 px-3 text-xs font-mono tabular-nums bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-60"
                />
              </div>
            </div>

            {/* Capacity Inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[var(--text)] mb-1.5">
                  Kapasitas Maks per Rak
                </label>
                <input
                  type="number"
                  min={1}
                  max={100000000}
                  disabled={!canManage}
                  value={defaultRackCapacity}
                  onChange={(e) =>
                    setDefaultRackCapacity(
                      Math.max(1, Math.min(100000000, Math.round(Number(e.target.value) || 1)))
                    )
                  }
                  className="w-full h-9 px-3 text-xs font-mono tabular-nums bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-60"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--text)] mb-1.5">
                  Satuan Kapasitas Rak
                </label>
                <select
                  disabled={!canManage}
                  value={capacityUnit}
                  onChange={(e) => setCapacityUnit(e.target.value as WarehouseCapacityUnit)}
                  className="w-full h-9 px-3 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-60"
                >
                  {WAREHOUSE_CAPACITY_UNITS.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Dynamic Area Naming */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-[var(--text)]">Penamaan Area di Peta Gudang</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {areaNames.map((name, idx) => (
                  <input
                    key={idx}
                    type="text"
                    maxLength={48}
                    disabled={!canManage}
                    value={name}
                    onChange={(e) => {
                      const next = [...areaNames];
                      next[idx] = e.target.value;
                      setAreaNames(next);
                    }}
                    placeholder={`Area ${String.fromCharCode(65 + idx)}`}
                    className="h-8 px-2.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-60"
                  />
                ))}
              </div>
            </div>

            {/* Facility Zones on Floorplan */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-[var(--text)]">Zona Fasilitas pada Denah Lapangan</p>
              <div className="flex flex-wrap items-center gap-2">
                {DEFAULT_FACILITY_ZONES.map((zone) => {
                  const checked = facilityZones.includes(zone);
                  return (
                    <label
                      key={zone}
                      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                        checked
                          ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)] font-medium'
                          : 'border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        disabled={!canManage}
                        checked={checked}
                        onChange={() => handleToggleFacilityZone(zone)}
                        className="accent-[var(--accent)]"
                      />
                      <span>{zone}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Preview Occupancy Checkbox (client-side preview only, never alters ERP data) */}
            <label className="flex items-start gap-2.5 text-xs text-[var(--text)] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={previewMode}
                onChange={(e) => onPreviewModeChange(e.target.checked)}
                className="mt-0.5 accent-[var(--accent)]"
              />
              <span>
                <span className="font-medium">Aktifkan mode pratinjau okupansi proporsional (Hijau / Kuning / Merah)</span>
                <span className="block text-[11px] text-[var(--text-muted)] mt-0.5">
                  Hanya untuk melihat simulasi warna layout di layar Anda — tidak menyimpan atau mengubah angka stok asli MyERP.
                </span>
              </span>
            </label>

            {/* Live Calculation Summary Box */}
            <div className="grid grid-cols-3 gap-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl p-3.5">
              <div>
                <p className="text-[11px] text-[var(--text-muted)]">Jumlah Area</p>
                <p className="mt-0.5 font-mono tabular-nums text-base font-bold text-[var(--text)]">
                  {formatNumber(areaCount)} Area
                </p>
              </div>
              <div>
                <p className="text-[11px] text-[var(--text-muted)]">Total Rak Gudang</p>
                <p className="mt-0.5 font-mono tabular-nums text-base font-bold text-[var(--accent-text)]">
                  {formatNumber(totalRacksPreview)} Rak
                </p>
              </div>
              <div>
                <p className="text-[11px] text-[var(--text-muted)]">Kapasitas Total</p>
                <p className="mt-0.5 font-mono tabular-nums text-base font-bold text-[var(--text)]">
                  {formatNumber(totalCapacityPreview)} {unitShort}
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <button
                type="submit"
                disabled={!canManage || !activeLayout || savingLayout}
                className="inline-flex items-center gap-2 h-9 px-4 text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              >
                {savingLayout ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                <span>Terapkan Layout &amp; Kapasitas Gudang</span>
              </button>

              {activeWhKey && onOpenMapForWarehouse && (
                <button
                  type="button"
                  onClick={() => onOpenMapForWarehouse(activeWhKey)}
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium text-[var(--text)] bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--accent)] rounded-lg transition-colors cursor-pointer"
                >
                  <Grid2x2 className="w-3.5 h-3.5" />
                  <span>Lihat di Peta Gudang</span>
                </button>
              )}
            </div>
          </form>

          {/* RIGHT CARD: Threshold Kapasitas & Sinkronisasi ERP */}
          <form
            onSubmit={handleSaveGlobalSubmit}
            className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-5"
          >
            <div className="flex items-start gap-2.5">
              <SlidersHorizontal className="w-4 h-4 text-[var(--accent-text)] shrink-0 mt-0.5" />
              <div>
                <h3 className="font-display text-sm font-bold text-[var(--text)]">
                  Threshold Kapasitas &amp; Sinkronisasi ERP
                </h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Atur batas persentase warna indikator kapasitas rak dan interval pembaruan data stok ERP.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[var(--text)] mb-1.5">
                  Batas Maks Hijau (%)
                </label>
                <input
                  type="number"
                  min={1}
                  max={98}
                  disabled={!canManage}
                  value={greenMaxPct}
                  onChange={(e) => setGreenMaxPct(Number(e.target.value))}
                  className="w-full h-9 px-3 text-xs font-mono tabular-nums bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-60"
                />
                <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                  0% – {safeGreenBar}% berstatus Aman (Hijau).
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[var(--text)] mb-1.5">
                  Batas Maks Kuning (%)
                </label>
                <input
                  type="number"
                  min={2}
                  max={100}
                  disabled={!canManage}
                  value={yellowMaxPct}
                  onChange={(e) => setYellowMaxPct(Number(e.target.value))}
                  className="w-full h-9 px-3 text-xs font-mono tabular-nums bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-60"
                />
                <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                  Di atas {safeYellowBar}% otomatis berstatus Merah.
                </p>
              </div>
            </div>

            {/* Live Visual Threshold Scale Bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-[var(--text-muted)]">
                <span>0%</span>
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                  Aman ≤{safeGreenBar}%
                </span>
                <span className="text-amber-600 dark:text-amber-400 font-semibold">
                  Hampir Penuh ≤{safeYellowBar}%
                </span>
                <span className="text-red-600 dark:text-red-400 font-semibold">
                  Penuh &gt;{safeYellowBar}%
                </span>
              </div>
              <div className="h-2.5 w-full rounded-full overflow-hidden flex bg-[var(--bg)] border border-[var(--border)]">
                <div
                  className="bg-emerald-500 h-full transition-all"
                  style={{ width: `${safeGreenBar}%` }}
                />
                <div
                  className="bg-amber-400 h-full transition-all"
                  style={{ width: `${Math.max(1, safeYellowBar - safeGreenBar)}%` }}
                />
                <div
                  className="bg-red-500 h-full transition-all"
                  style={{ width: `${Math.max(1, 100 - safeYellowBar)}%` }}
                />
              </div>
            </div>

            {/* Auto-Refresh Interval (ERP Native) */}
            <div>
              <label className="block text-xs font-semibold text-[var(--text)] mb-1.5">
                Interval Auto-Refresh Stok ERP (detik)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={3600}
                  step={30}
                  disabled={!canManage}
                  value={autoRefreshSeconds}
                  onChange={(e) =>
                    setAutoRefreshSeconds(Math.max(0, Math.min(3600, Math.round(Number(e.target.value) || 0))))
                  }
                  className="w-28 h-9 px-3 text-xs font-mono tabular-nums bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text)] focus:outline-none focus:border-[var(--accent)] disabled:opacity-60"
                />
                <div className="flex flex-wrap items-center gap-1">
                  {[
                    { label: 'Manual', val: 0 },
                    { label: '60d', val: 60 },
                    { label: '180d', val: 180 },
                    { label: '300d', val: 300 },
                  ].map((opt) => (
                    <button
                      key={opt.val}
                      type="button"
                      disabled={!canManage}
                      onClick={() => setAutoRefreshSeconds(opt.val)}
                      className={`h-8 px-2.5 text-[11px] font-medium rounded-md border transition-colors cursor-pointer disabled:opacity-50 ${
                        autoRefreshSeconds === opt.val
                          ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)] font-semibold'
                          : 'border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)] hover:text-[var(--text)]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                Berguna saat Peta Gudang ditampilkan terus-menerus pada monitor/TV ruang gudang (mode Full Screen).
              </p>
            </div>

            {/* Behavior Checkboxes */}
            <div className="space-y-2.5 pt-1 border-t border-[var(--border)]">
              <label className="flex items-start gap-2.5 text-xs text-[var(--text)] cursor-pointer select-none">
                <input
                  type="checkbox"
                  disabled={!canManage}
                  checked={showOvercapacityBadge}
                  onChange={(e) => setShowOvercapacityBadge(e.target.checked)}
                  className="mt-0.5 accent-[var(--accent)]"
                />
                <span>
                  Tampilkan penanda <strong>Overcapacity (&gt;100%)</strong> saat jumlah stok ERP melebihi kapasitas maksimum rak
                </span>
              </label>
              <label className="flex items-start gap-2.5 text-xs text-[var(--text)] cursor-pointer select-none">
                <input
                  type="checkbox"
                  disabled={!canManage}
                  checked={syncVisibilityToStockTable}
                  onChange={(e) => setSyncVisibilityToStockTable(e.target.checked)}
                  className="mt-0.5 accent-[var(--accent)]"
                />
                <span>
                  Terapkan filter gudang yang disembunyikan ke pilihan gudang pada tab <strong>Daftar Stok</strong> (tidak memengaruhi Laporan Keuangan &amp; Tanya AI)
                </span>
              </label>
            </div>

            <button
              type="submit"
              disabled={!canManage || savingGlobal}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 h-9 px-4 text-xs font-semibold bg-[#0D0D0D] text-white hover:bg-[#222226] dark:bg-[var(--accent)] dark:text-[var(--on-accent)] dark:hover:bg-[var(--accent-hover)] rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              {savingGlobal ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span>Simpan Threshold &amp; Sinkronisasi</span>
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
