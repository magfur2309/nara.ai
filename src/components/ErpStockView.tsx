import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Database,
  Download,
  FileCode2,
  FolderKanban,
  Info,
  Landmark,
  Loader2,
  MapPin,
  MessageSquareText,
  Package,
  PieChart,
  RefreshCw,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  Table2,
  Terminal,
  TrendingUp,
  Truck,
  X,
} from 'lucide-react';
import { fetchApiJson } from '../lib/apiClient';
import { getFreshIdToken } from '../lib/firebase';
import { useI18n } from '../lib/i18n';
import { LOCAL_BRIDGE_SCRIPT } from '../lib/erpBridgeTemplate';
import {
  fetchWarehouseMapGlobalSettings,
  fetchWarehouseMapLayouts,
} from '../lib/warehouseMapService';
import type { DirectoryMember, UserProfile } from '../types/sop';
import type {
  PendingNavigationTarget,
  PendingTransactionsSummaryResponse,
} from '../config/pendingTransactionRules';
import { ErpSalesPanel } from './ErpSalesPanel';
import { ErpPurchasingPanel } from './ErpPurchasingPanel';
import { ErpFinancePanel } from './ErpFinancePanel';
import { ErpAssetsPanel } from './ErpAssetsPanel';
import { ErpBusinessIntelligencePanel } from './ErpBusinessIntelligencePanel';
import { ErpWarehouseMapPanel, type WarehouseSubView } from './ErpWarehouseMapPanel';
import { PendingCountBadge } from './PendingTransactionWidgets';
import { TablePaginationBar, useTablePagination } from './TablePaginationBar';
import { hasMenuPermission, type RolePermissionMatrix } from '../config/menuRegistry';
import type { CreatePinnedChartInput } from '../lib/pinnedChartService';
import type { PinnedChartDocument } from '../types/sop';
import { AccessDeniedView } from './AccessDeniedView';

export type ErpModuleTab = 'stock' | 'purchasing' | 'sales' | 'bi' | 'finance' | 'assets';

const ERP_TAB_MENU_ID: Record<ErpModuleTab, string> = {
  stock: 'erp_inventory',
  purchasing: 'erp_purchasing',
  sales: 'erp_sales',
  bi: 'erp_bi',
  finance: 'erp_finance',
  assets: 'erp_assets',
};

interface ErpStockItem {
  code: string;
  name: string;
  warehouse: string;
  qty: number;
  unit: string;
  category: string;
}

interface ErpWarehouseSummary {
  warehouse: string;
  skuCount: number;
  totalQty: number;
  zeroStockCount: number;
}

interface ErpStockCategorySummary {
  category: string;
  skuCount: number;
  totalQty: number;
  zeroStockCount: number;
}

interface ErpColumnMapping {
  viewName: string;
  codeCol: string | null;
  nameCol: string | null;
  warehouseCol: string | null;
  qtyCol: string | null;
  unitCol: string | null;
  categoryCol: string | null;
  allColumns: string[];
}

interface ErpConnectionStatus {
  configured: boolean;
  connected: boolean;
  mode?: 'bridge' | 'direct';
  stockMode?: 'myerpplus' | 'custom';
  salesSupported?: boolean;
  purchasingSupported?: boolean;
  assetsSupported?: boolean;
  viewName: string;
  hostPreview: string;
  port: number;
  database: string;
  sslEnabled: boolean;
  latencyMs?: number;
  totalRows?: number;
  warehouses?: string[];
  availableTables?: string[];
  detectedColumns?: ErpColumnMapping;
  error?: string;
}

interface ErpIntransitSummary {
  skuCount: number;
  totalQty: number;
  zeroStockCount: number;
  warehouses: string[];
}

interface ErpStockQueryResult {
  items: ErpStockItem[];
  warehouses: ErpWarehouseSummary[];
  categories?: ErpStockCategorySummary[];
  selectedCategory?: string;
  activeOnly?: boolean;
  inventoryOnly?: boolean;
  intransitExcluded?: boolean;
  intransitBridgeNative?: boolean;
  intransitOnly?: boolean;
  intransitSummary?: ErpIntransitSummary;
  qtySort?: 'asc' | 'desc' | '';
  totalRows: number;
  totalActiveRows?: number;
  viewName: string;
  detectedColumns: ErpColumnMapping;
  fetchedAt: string;
}

interface ErpStockViewProps {
  idToken: string;
  user: UserProfile;
  directory: DirectoryMember[];
  activeModuleExternal?: ErpModuleTab;
  onActiveModuleChange?: (mod: ErpModuleTab) => void;
  onAskAiQuestion: (question: string) => void;
  pendingSummary?: PendingTransactionsSummaryResponse | null;
  pendingNavTarget?: PendingNavigationTarget | null;
  onClearPendingNav?: () => void;
  rbacPermissions?: RolePermissionMatrix | null;
  pinnedCharts?: PinnedChartDocument[];
  onPinChart?: (payload: CreatePinnedChartInput) => Promise<void>;
  onOpenDashboard?: () => void;
}

const MYSQL_SETUP_SQL = `-- 1) Buat SQL View khusus read-only (sesuaikan nama tabel & kolom ERP Anda)
CREATE OR REPLACE VIEW vw_ai_stok_barang AS
SELECT
  kode_barang,
  nama_barang,
  nama_gudang AS gudang,
  qty_stok AS qty,
  satuan,
  kategori
FROM tabel_stok_erp_anda;

-- 2) Buat user MySQL khusus READ-ONLY (hanya boleh SELECT ke View di atas)
CREATE USER 'ai_stok_ro'@'localhost' IDENTIFIED BY 'GANTI_PASSWORD_KUAT_ANDA';
GRANT SELECT ON nama_database_erp.vw_ai_stok_barang TO 'ai_stok_ro'@'localhost';
FLUSH PRIVILEGES;`;

const DIRECT_ENV_LIST = [
  { key: 'ERP_MYSQL_HOST', desc: 'Alamat host / IP publik server MySQL ERP' },
  { key: 'ERP_MYSQL_PORT', desc: 'Port MySQL (default: 3306)' },
  { key: 'ERP_MYSQL_DATABASE', desc: 'Nama database MySQL ERP' },
  { key: 'ERP_MYSQL_USER', desc: 'Username khusus read-only' },
  { key: 'ERP_MYSQL_PASSWORD', desc: 'Password user read-only' },
  { key: 'ERP_MYSQL_SSL', desc: 'true jika server mewajibkan SSL/TLS, selain itu false' },
  { key: 'ERP_MYSQL_STOCK_VIEW', desc: 'Nama SQL View atau tabel stok (default: vw_ai_stok_barang)' },
];

function escapeCsv(val: string | number): string {
  const s = String(val ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadStockCsv(items: ErpStockItem[], categoryLabel?: string): void {
  const headers = ['Kode Barang', 'Nama Barang', 'Gudang', 'Qty', 'Satuan', 'Kategori'];
  const lines = [
    headers.join(','),
    ...items.map((it) =>
      [it.code, it.name, it.warehouse, it.qty, it.unit, it.category].map(escapeCsv).join(',')
    ),
  ];
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const slug = categoryLabel
    ? `-${categoryLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`
    : '';
  a.href = url;
  a.download = `stok-gudang-erp${slug}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadBridgeScript(): void {
  const blob = new Blob([LOCAL_BRIDGE_SCRIPT], { type: 'text/javascript;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'erp-mysql-bridge.mjs';
  a.click();
  URL.revokeObjectURL(url);
}

export function ErpStockView({
  idToken,
  user,
  directory,
  activeModuleExternal,
  onActiveModuleChange,
  onAskAiQuestion,
  pendingSummary,
  pendingNavTarget,
  onClearPendingNav,
  rbacPermissions,
  pinnedCharts = [],
  onPinChart,
  onOpenDashboard,
}: ErpStockViewProps) {
  const { t, formatNumber } = useI18n();
  const [status, setStatus] = useState<ErpConnectionStatus | null>(null);
  const [stockData, setStockData] = useState<ErpStockQueryResult | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [loadingStock, setLoadingStock] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [setupMode, setSetupMode] = useState<'bridge' | 'direct'>('bridge');
  const [internalModule, setInternalModule] = useState<ErpModuleTab>(
    activeModuleExternal || 'bi'
  );
  const activeModule = activeModuleExternal ?? internalModule;
  const setActiveModule = (mod: ErpModuleTab) => {
    setInternalModule(mod);
    onActiveModuleChange?.(mod);
  };

  const [stockViewMode, setStockViewMode] = useState<'table' | 'map' | 'settings'>('table');
  const [hiddenWarehousesFromMap, setHiddenWarehousesFromMap] = useState<Set<string>>(
    () => new Set()
  );
  const [syncHiddenWarehousesToTable, setSyncHiddenWarehousesToTable] = useState(false);

  const [selectedCategory, setSelectedCategory] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState('');
  const [onlyLowStock, setOnlyLowStock] = useState(false);
  const [qtySort, setQtySort] = useState<'' | 'desc' | 'asc'>('');
  const [tableFilter, setTableFilter] = useState('');
  const [copiedKey, setCopiedKey] = useState<'bridge' | 'sql' | null>(null);
  const [showIntransitDetail, setShowIntransitDetail] = useState(false);
  const [intransitItems, setIntransitItems] = useState<ErpStockItem[]>([]);
  const [loadingIntransit, setLoadingIntransit] = useState(false);
  const [intransitError, setIntransitError] = useState<string | null>(null);

  const fetchStock = useCallback(
    async (opts?: {
      q?: string;
      warehouse?: string;
      category?: string;
      low?: boolean;
      summaryOnly?: boolean;
      qtySort?: '' | 'desc' | 'asc';
      refresh?: boolean;
    }) => {
      setLoadingStock(true);
      setErrorMsg(null);
      try {
        const token = await getFreshIdToken(idToken);
        const params = new URLSearchParams();
        if (opts?.q) params.set('q', opts.q);
        if (opts?.warehouse) params.set('warehouse', opts.warehouse);
        if (opts?.category) params.set('category', opts.category);
        if (opts?.low) params.set('low', '1');
        if (opts?.summaryOnly && !opts?.category && !opts?.q) params.set('summaryOnly', '1');
        if (opts?.qtySort) params.set('qtySort', opts.qtySort);
        if (opts?.refresh) params.set('refresh', '1');
        params.set('limit', '500');

        const data = await fetchApiJson<ErpStockQueryResult>(
          `/api/erp/stock?${params.toString()}`,
          {
            cache: 'no-store',
            headers: { Authorization: `Bearer ${token}` },
          },
          'Gagal memuat data stok gudang dari MySQL ERP.'
        );
        setStockData(data);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Gagal memuat data stok gudang.');
      } finally {
        setLoadingStock(false);
      }
    },
    [idToken]
  );

  const checkStatus = useCallback(
    async (alsoRefreshCache = false) => {
      setLoadingStatus(true);
      setErrorMsg(null);
      try {
        const token = await getFreshIdToken(idToken);
        if (alsoRefreshCache) {
          await fetch('/api/erp/refresh', {
            method: 'POST',
            cache: 'no-store',
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => {});
        }
        const data = await fetchApiJson<ErpConnectionStatus>(
          '/api/erp/status',
          {
            cache: 'no-store',
            headers: { Authorization: `Bearer ${token}` },
          },
          'Gagal memeriksa koneksi MySQL ERP.'
        );
        setStatus(data);
        if (data.connected) {
          await fetchStock({
            q: appliedSearch,
            warehouse: warehouseFilter,
            category: selectedCategory,
            low: onlyLowStock,
            summaryOnly: !selectedCategory && !appliedSearch,
            qtySort,
            refresh: alsoRefreshCache,
          });
        } else {
          setStockData(null);
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Gagal memeriksa koneksi MySQL ERP.');
      } finally {
        setLoadingStatus(false);
      }
    },
    [appliedSearch, fetchStock, idToken, onlyLowStock, qtySort, selectedCategory, warehouseFilter]
  );

  useEffect(() => {
    void checkStatus(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idToken]);

  // Preload warehouse visibility preferences so optional sync to Daftar Stok works immediately
  useEffect(() => {
    let active = true;
    Promise.all([
      fetchWarehouseMapGlobalSettings().catch(() => null),
      fetchWarehouseMapLayouts().catch(() => []),
    ])
      .then(([gSettings, layouts]) => {
        if (!active) return;
        const hidden = new Set<string>();
        layouts.forEach((l) => {
          if (l.isVisible === false) {
            hidden.add(l.warehouseName.trim().toLowerCase());
          }
        });
        setHiddenWarehousesFromMap(hidden);
        setSyncHiddenWarehousesToTable(Boolean(gSettings?.syncVisibilityToStockTable));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const handleVisibilityConfigChange = useCallback(
    (hiddenNames: Set<string>, syncToTable: boolean) => {
      setHiddenWarehousesFromMap(hiddenNames);
      setSyncHiddenWarehousesToTable(syncToTable);
    },
    []
  );

  const handleMapSubViewChange = useCallback((view: WarehouseSubView) => {
    setStockViewMode((prev) => {
      if (prev === 'table') return prev;
      return view === 'settings' ? 'settings' : 'map';
    });
  }, []);

  const handleJumpFromMapToStockTable = useCallback(
    (warehouseName: string, searchQuery?: string) => {
      const nextQ = (searchQuery || '').trim();
      setStockViewMode('table');
      setSelectedCategory('');
      setSearchInput(nextQ);
      setAppliedSearch(nextQ);
      setWarehouseFilter(warehouseName);
      setOnlyLowStock(false);
      if (status?.connected) {
        void fetchStock({
          q: nextQ,
          warehouse: warehouseName,
          category: '',
          low: false,
          summaryOnly: false,
          qtySort,
        });
      }
    },
    [fetchStock, qtySort, status?.connected]
  );

  const handleCategorySelect = (nextCategory: string) => {
    const resolved = nextCategory === selectedCategory ? '' : nextCategory;
    setSelectedCategory(resolved);
    setWarehouseFilter('');
    if (status?.connected) {
      void fetchStock({
        q: appliedSearch,
        warehouse: '',
        category: resolved,
        low: onlyLowStock,
        summaryOnly: !resolved && !appliedSearch,
        qtySort,
      });
    }
  };

  const handleApplyFilter = (e?: React.FormEvent) => {
    e?.preventDefault();
    const nextSearch = searchInput.trim();
    setAppliedSearch(nextSearch);
    if (status?.connected) {
      void fetchStock({
        q: nextSearch,
        warehouse: warehouseFilter,
        category: selectedCategory,
        low: onlyLowStock,
        summaryOnly: !selectedCategory && !nextSearch,
        qtySort,
      });
    }
  };

  const handleWarehouseChange = (nextWh: string) => {
    setWarehouseFilter(nextWh);
    if (status?.connected && (selectedCategory || appliedSearch || nextWh)) {
      void fetchStock({
        q: appliedSearch,
        warehouse: nextWh,
        category: selectedCategory,
        low: onlyLowStock,
        summaryOnly: !selectedCategory && !appliedSearch && !nextWh,
        qtySort,
      });
    }
  };

  const handleLowStockToggle = (checked: boolean) => {
    setOnlyLowStock(checked);
    if (status?.connected && (selectedCategory || appliedSearch)) {
      void fetchStock({
        q: appliedSearch,
        warehouse: warehouseFilter,
        category: selectedCategory,
        low: checked,
        qtySort,
      });
    }
  };

  const handleQtySortChange = (nextSort: '' | 'desc' | 'asc') => {
    const resolved: '' | 'desc' | 'asc' = nextSort === qtySort ? '' : nextSort;
    setQtySort(resolved);
    if (status?.connected && (selectedCategory || appliedSearch)) {
      void fetchStock({
        q: appliedSearch,
        warehouse: warehouseFilter,
        category: selectedCategory,
        low: onlyLowStock,
        qtySort: resolved,
      });
    }
  };

  const handleClearSearch = () => {
    setSearchInput('');
    setAppliedSearch('');
    if (status?.connected) {
      void fetchStock({
        q: '',
        warehouse: warehouseFilter,
        category: selectedCategory,
        low: onlyLowStock,
        summaryOnly: !selectedCategory,
        qtySort,
      });
    }
  };

  const handleCopyText = async (key: 'bridge' | 'sql', content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // Ignore clipboard restriction
    }
  };

  const fetchIntransitDetail = useCallback(
    async (opts?: { category?: string; q?: string; refresh?: boolean }) => {
      setLoadingIntransit(true);
      setIntransitError(null);
      try {
        const token = await getFreshIdToken(idToken);
        const params = new URLSearchParams();
        params.set('intransitOnly', '1');
        if (opts?.category) params.set('category', opts.category);
        if (opts?.q) params.set('q', opts.q);
        if (opts?.refresh) params.set('refresh', '1');
        params.set('limit', '500');
        const res = await fetchApiJson<ErpStockQueryResult>(
          `/api/erp/stock?${params.toString()}`,
          {
            cache: 'no-store',
            headers: { Authorization: `Bearer ${token}` },
          },
          'Gagal memuat rincian Gudang Intransit.'
        );
        setIntransitItems(res.items || []);
      } catch (err) {
        setIntransitError(
          err instanceof Error ? err.message : 'Gagal memuat rincian Gudang Intransit.'
        );
      } finally {
        setLoadingIntransit(false);
      }
    },
    [idToken]
  );

  useEffect(() => {
    if (showIntransitDetail && status?.connected) {
      void fetchIntransitDetail({ category: selectedCategory, q: appliedSearch });
    }
  }, [appliedSearch, fetchIntransitDetail, selectedCategory, showIntransitDetail, status?.connected]);

  const categories = useMemo(() => stockData?.categories || [], [stockData]);

  const physicalWarehouses = useMemo(
    () =>
      (stockData?.warehouses || []).filter(
        (w) =>
          !/\bin[\s_-]*transit\b/i.test(w.warehouse) &&
          !w.warehouse.toLowerCase().replace(/[\s_-]+/g, '').includes('intransit')
      ),
    [stockData]
  );

  const sortedItems = useMemo(() => {
    const list = (stockData?.items || []).filter(
      (it) =>
        !/\bin[\s_-]*transit\b/i.test(it.warehouse) &&
        !it.warehouse.toLowerCase().replace(/[\s_-]+/g, '').includes('intransit')
    );
    if (!qtySort) return list;
    return [...list].sort((a, b) =>
      qtySort === 'desc'
        ? Number(b.qty || 0) - Number(a.qty || 0)
        : Number(a.qty || 0) - Number(b.qty || 0)
    );
  }, [qtySort, stockData]);

  const stockPaging = useTablePagination(sortedItems, {
    defaultPageSize: 25,
    storageKey: 'erp_stock_physical',
  });

  const intransitPaging = useTablePagination(intransitItems, {
    defaultPageSize: 20,
    storageKey: 'erp_stock_intransit',
  });

  const totalQtyScoped = useMemo(
    () => physicalWarehouses.reduce((sum, w) => sum + (Number(w.totalQty) || 0), 0),
    [physicalWarehouses]
  );

  const totalZeroStockScoped = useMemo(
    () => physicalWarehouses.reduce((sum, w) => sum + (Number(w.zeroStockCount) || 0), 0),
    [physicalWarehouses]
  );

  const visiblePhysicalWarehouses = useMemo(() => {
    if (!syncHiddenWarehousesToTable || hiddenWarehousesFromMap.size === 0) {
      return physicalWarehouses;
    }
    return physicalWarehouses.filter(
      (w) =>
        w.warehouse === warehouseFilter ||
        !hiddenWarehousesFromMap.has(w.warehouse.trim().toLowerCase())
    );
  }, [hiddenWarehousesFromMap, physicalWarehouses, syncHiddenWarehousesToTable, warehouseFilter]);

  const intransitSummary = stockData?.intransitSummary;

  const isDetailVisible = Boolean(selectedCategory || appliedSearch || warehouseFilter);

  const allModuleTabs: { id: ErpModuleTab; label: string; icon: React.ReactNode }[] = [
    { id: 'bi', label: t('menu.erpBi'), icon: <PieChart className="w-3.5 h-3.5" /> },
    { id: 'finance', label: t('menu.erpFinance'), icon: <Landmark className="w-3.5 h-3.5" /> },
    { id: 'purchasing', label: t('menu.erpPurchasing'), icon: <ShoppingCart className="w-3.5 h-3.5" /> },
    { id: 'sales', label: t('menu.erpSales'), icon: <TrendingUp className="w-3.5 h-3.5" /> },
    { id: 'stock', label: t('menu.erpStock'), icon: <Package className="w-3.5 h-3.5" /> },
    { id: 'assets', label: t('menu.erpAssets'), icon: <Building2 className="w-3.5 h-3.5" /> },
  ];

  const moduleTabs = rbacPermissions
    ? allModuleTabs.filter((tab) =>
        hasMenuPermission(rbacPermissions, ERP_TAB_MENU_ID[tab.id], 'view')
      )
    : allModuleTabs;

  const isActiveModuleAllowed =
    !rbacPermissions || hasMenuPermission(rbacPermissions, ERP_TAB_MENU_ID[activeModule], 'view');

  if (rbacPermissions && moduleTabs.length === 0) {
    return <AccessDeniedView menuLabel="ERP Live" />;
  }

  return (
    <div className="max-w-[1400px] mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-bold text-[var(--text)]">
            {t('erp.title')}
          </h1>
          <div className="w-10 h-[3px] rounded-full bg-[var(--accent)]" aria-hidden="true" />
          <p className="text-xs sm:text-sm text-[var(--text-muted)] pt-0.5 max-w-3xl">
            {t('erp.subtitle')}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={downloadBridgeScript}
            className="inline-flex items-center gap-1.5 h-10 px-3.5 text-xs font-medium text-[var(--text)] bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--text-muted)] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{t('erp.downloadBridge')}</span>
          </button>
          {activeModule === 'stock' && stockViewMode === 'table' && isDetailVisible && sortedItems.length > 0 && (
            <button
              type="button"
              onClick={() => downloadStockCsv(sortedItems, selectedCategory || undefined)}
              className="inline-flex items-center gap-1.5 h-10 px-3.5 text-xs font-medium text-[var(--text)] bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--text-muted)] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{t('common.exportCsv')}</span>
            </button>
          )}
          <button
            type="button"
            disabled={loadingStatus || loadingStock}
            onClick={() => void checkStatus(true)}
            className="inline-flex items-center gap-1.5 h-10 px-4 text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {loadingStatus || loadingStock ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            <span>{t('erp.testConnection')}</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="bg-[var(--danger)]/10 border border-[var(--danger)]/35 rounded-xl px-4 py-3 text-xs text-[var(--danger)] flex items-center justify-between gap-3">
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="font-semibold hover:underline cursor-pointer shrink-0"
          >
            {t('common.close')}
          </button>
        </div>
      )}

      {loadingStatus && !status ? (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-10 flex items-center justify-center gap-2.5 text-sm text-[var(--text-muted)]">
          <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />
          <span>{t('erp.checkingConnection')}</span>
        </div>
      ) : status?.connected && stockData ? (
        <>
          {/* Connection Verified Strip + Module Switcher */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[var(--text-muted)]">
              <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--success)]">
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {status.mode === 'bridge' ? t('erp.connectedBridge') : t('erp.connectedDirect')}
                </span>
              </span>
              <span className="font-mono">
                DB: <strong className="text-[var(--text)]">{status.database}</strong> ({status.hostPreview})
              </span>
              {typeof status.latencyMs === 'number' && (
                <span className="font-mono tabular-nums">{formatNumber(status.latencyMs)} ms</span>
              )}
            </div>

            <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg">
              {moduleTabs.map((tab) => {
                const modPendingCount =
                  tab.id === 'sales'
                    ? pendingSummary?.byModule?.sales?.count || 0
                    : tab.id === 'purchasing'
                      ? pendingSummary?.byModule?.purchasing?.count || 0
                      : 0;
                const modUrgency =
                  tab.id === 'sales'
                    ? pendingSummary?.byModule?.sales?.highestUrgency || null
                    : tab.id === 'purchasing'
                      ? pendingSummary?.byModule?.purchasing?.highestUrgency || null
                      : null;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveModule(tab.id)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      activeModule === tab.id
                        ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
                    }`}
                  >
                    {tab.icon}
                    <span>{tab.label}</span>
                    {modPendingCount > 0 && (
                      <PendingCountBadge count={modPendingCount} urgency={modUrgency} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {!isActiveModuleAllowed ? (
            <AccessDeniedView
              menuLabel={allModuleTabs.find((m) => m.id === activeModule)?.label || 'Modul ERP'}
              onGoHome={() => {
                if (moduleTabs[0]) setActiveModule(moduleTabs[0].id);
              }}
            />
          ) : activeModule === 'assets' ? (
            <ErpAssetsPanel
              idToken={idToken}
              onAskAiQuestion={onAskAiQuestion}
              onDownloadBridge={downloadBridgeScript}
            />
          ) : activeModule === 'finance' ? (
            <ErpFinancePanel
              idToken={idToken}
              onAskAiQuestion={onAskAiQuestion}
              onDownloadBridge={downloadBridgeScript}
            />
          ) : activeModule === 'purchasing' ? (
            <ErpPurchasingPanel
              idToken={idToken}
              onAskAiQuestion={onAskAiQuestion}
              onDownloadBridge={downloadBridgeScript}
              pendingSummary={pendingSummary}
              pendingNavTarget={pendingNavTarget}
              onClearPendingNav={onClearPendingNav}
            />
          ) : activeModule === 'bi' ? (
            <ErpBusinessIntelligencePanel
              idToken={idToken}
              onDownloadBridge={downloadBridgeScript}
              rbacPermissions={rbacPermissions}
              pinnedCharts={pinnedCharts}
              onPinChart={onPinChart}
              onOpenDashboard={onOpenDashboard}
            />
          ) : activeModule === 'sales' ? (
            <ErpSalesPanel
              idToken={idToken}
              onAskAiQuestion={onAskAiQuestion}
              onDownloadBridge={downloadBridgeScript}
              pendingSummary={pendingSummary}
              pendingNavTarget={pendingNavTarget}
              onClearPendingNav={onClearPendingNav}
            />
          ) : (
            <>
              {/* Stock Mode Switcher: Daftar Stok | Mode Peta Gudang | Pengaturan Gudang */}
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
                <div
                  className="inline-flex flex-wrap items-center gap-1 p-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg"
                  role="tablist"
                  aria-label="Mode Tampilan Stok Gudang"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={stockViewMode === 'table'}
                    onClick={() => setStockViewMode('table')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      stockViewMode === 'table'
                        ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
                    }`}
                  >
                    <Table2 className="w-3.5 h-3.5" />
                    <span>Daftar Stok</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={stockViewMode === 'map'}
                    onClick={() => setStockViewMode('map')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      stockViewMode === 'map'
                        ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
                    }`}
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    <span>Mode Peta Gudang</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={stockViewMode === 'settings'}
                    onClick={() => setStockViewMode('settings')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                      stockViewMode === 'settings'
                        ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
                    }`}
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    <span>Pengaturan Gudang</span>
                  </button>
                </div>

                <p className="text-[11px] text-[var(--text-muted)]">
                  {stockViewMode === 'table'
                    ? 'Tampilan tabel stok aktif per kategori & gudang (read-only ERP).'
                    : stockViewMode === 'map'
                      ? 'Visualisasi denah rak & okupansi kapasitas seluruh gudang ERP yang diaktifkan.'
                      : 'Kelola visibilitas seluruh gudang ERP, struktur area/rak, kapasitas maks, dan threshold warna.'}
                </p>
              </div>

              {stockViewMode === 'map' || stockViewMode === 'settings' ? (
                <ErpWarehouseMapPanel
                  idToken={idToken}
                  user={user}
                  directory={directory}
                  initialSubView={stockViewMode === 'settings' ? 'settings' : 'map'}
                  onSubViewChange={handleMapSubViewChange}
                  onDownloadBridge={downloadBridgeScript}
                  onJumpToStockTable={handleJumpFromMapToStockTable}
                  onVisibilityConfigChange={handleVisibilityConfigChange}
                  formatNumber={formatNumber}
                />
              ) : (
                <>
              {/* Bridge v9 Upgrade Notice if old bridge is still running */}
              {status.mode === 'bridge' &&
                (stockData.activeOnly !== true ||
                  stockData.inventoryOnly !== true ||
                  stockData.intransitBridgeNative === false) && (
                  <div className="bg-[var(--warning)]/12 border border-[var(--warning)]/35 rounded-xl px-4 py-3 text-xs text-[var(--text)] flex flex-wrap items-center justify-between gap-3">
                    <span>{t('erp.bridgeUpgradeNotice')}</span>
                    <button
                      type="button"
                      onClick={downloadBridgeScript}
                      className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>{t('erp.downloadBridge')}</span>
                    </button>
                  </div>
                )}

              {/* Clear 2-View Distinction Banner: Physical/Available Stock vs Accounting Inventory Value */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="bg-[var(--surface)] border border-[var(--accent)]/40 rounded-xl px-4 py-3 flex items-start gap-2.5 text-xs">
                  <Package className="w-4 h-4 text-[var(--accent-text)] shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--text)]">
                      {t('erp.stockViewDistinctionTitle')}
                    </p>
                    <p className="text-[var(--text-muted)] mt-0.5 leading-relaxed">
                      {t('erp.stockViewDistinctionDesc')}
                    </p>
                  </div>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-3 flex items-start justify-between gap-3 text-xs">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <Landmark className="w-4 h-4 text-[var(--text-muted)] shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--text)]">
                        {t('erp.valuationDistinctionTitle')}
                      </p>
                      <p className="text-[var(--text-muted)] mt-0.5 leading-relaxed">
                        {t('erp.valuationDistinctionDesc')}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveModule('finance')}
                    className="h-8 px-2.5 rounded-lg text-[11px] font-semibold bg-[var(--surface-2)] text-[var(--text)] border border-[var(--border)] hover:border-[var(--accent)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {t('erp.openValuationLink')}
                  </button>
                </div>
              </div>

              {/* Category-First Selector (Active Inventory Items Only: baktif = 1 & bjenis = 'P') */}
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 sm:p-5 space-y-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-start gap-2.5">
                    <FolderKanban className="w-4 h-4 text-[var(--accent-text)] shrink-0 mt-0.5" />
                    <div>
                      <h2 className="font-display text-sm font-semibold text-[var(--text)]">
                        {t('erp.categoryPickerTitle')}
                      </h2>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        {t('erp.categoryPickerSub')}
                      </p>
                    </div>
                  </div>
                  {selectedCategory && (
                    <button
                      type="button"
                      onClick={() => handleCategorySelect('')}
                      className="inline-flex items-center gap-1 h-8 px-3 text-xs font-medium text-[var(--text)] bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--text-muted)] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>{t('erp.closeCategory')}</span>
                    </button>
                  )}
                </div>

                {categories.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
                    {categories.map((cat) => {
                      const isSelected = selectedCategory === cat.category;
                      return (
                        <button
                          key={cat.category}
                          type="button"
                          onClick={() => handleCategorySelect(cat.category)}
                          className={`text-left rounded-xl border px-3.5 py-3 transition-colors cursor-pointer ${
                            isSelected
                              ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                              : 'border-[var(--border)] bg-[var(--bg)] hover:border-[var(--text-muted)]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span
                              className="text-xs font-semibold truncate text-[var(--text)]"
                              title={cat.category}
                            >
                              {cat.category}
                            </span>
                            {isSelected && (
                              <span className="text-[11px] font-semibold text-[var(--accent-text)] shrink-0">
                                {t('common.active')}
                              </span>
                            )}
                          </div>
                          <div className="mt-1.5 flex items-baseline justify-between gap-2 font-mono tabular-nums">
                            <span className="text-sm font-bold text-[var(--text)]">
                              {formatNumber(cat.skuCount)}
                            </span>
                            <span className="text-[11px] text-[var(--text-muted)] truncate">
                              Qty {formatNumber(cat.totalQty)}
                            </span>
                          </div>
                          <div className="mt-0.5 text-[11px] text-[var(--text-muted)] flex items-center justify-between gap-1">
                            <span>{t('erp.activeRowsLabel')}</span>
                            {cat.zeroStockCount > 0 && (
                              <span className="text-[var(--danger)] font-mono tabular-nums">
                                {formatNumber(cat.zeroStockCount)} {t('erp.zeroLabel')}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-[var(--text-muted)] py-2">{t('erp.noCategories')}</p>
                )}
              </div>

              {/* 4-Column KPI Summary */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
                  <p className="text-xs font-medium text-[var(--text-muted)]">
                    {selectedCategory
                      ? t('erp.kpiActiveRowsScoped', { category: selectedCategory })
                      : t('erp.kpiActiveRows')}
                  </p>
                  <p className="mt-1 font-mono tabular-nums text-2xl font-bold text-[var(--text)]">
                    {formatNumber(stockData.totalRows)}
                  </p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    {isDetailVisible
                      ? t('erp.kpiShowingFiltered', { count: formatNumber(stockData.items.length) })
                      : t('erp.kpiSpreadCategories', { count: formatNumber(categories.length) })}
                  </p>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
                  <p className="text-xs font-medium text-[var(--text-muted)]">
                    {selectedCategory
                      ? t('erp.kpiTotalQtyScoped', { category: selectedCategory })
                      : t('erp.kpiTotalQty')}
                  </p>
                  <p className="mt-1 font-mono tabular-nums text-2xl font-bold text-[var(--text)]">
                    {formatNumber(totalQtyScoped)}
                  </p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    {selectedCategory
                      ? t('erp.kpiScopedWarehouse', { category: selectedCategory })
                      : t('erp.kpiSelectCategoryHint')}
                  </p>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
                  <p className="text-xs font-medium text-[var(--text-muted)]">
                    {t('erp.kpiWarehouses')}
                  </p>
                  <p className="mt-1 font-mono tabular-nums text-2xl font-bold text-[var(--text)]">
                    {formatNumber(physicalWarehouses.length)}
                  </p>
                  <p className="mt-1 text-xs text-[var(--text-muted)] truncate">
                    {physicalWarehouses.map((w) => w.warehouse).slice(0, 3).join(', ') || '-'}
                  </p>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
                  <p className="text-xs font-medium text-[var(--text-muted)]">
                    {selectedCategory
                      ? t('erp.kpiZeroStockScoped', { category: selectedCategory })
                      : t('erp.kpiZeroStock')}
                  </p>
                  <p
                    className={`mt-1 font-mono tabular-nums text-2xl font-bold ${
                      totalZeroStockScoped > 0 ? 'text-[var(--danger)]' : 'text-[var(--success)]'
                    }`}
                  >
                    {formatNumber(totalZeroStockScoped)}
                  </p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{t('erp.kpiActiveOnlyHint')}</p>
                </div>
              </div>

              {/* Direct Tanya AI Quick Prompts */}
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  <MessageSquareText className="w-4 h-4 text-[var(--accent-text)] shrink-0" />
                  <span>{t('erp.askAiBanner')}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {[
                    'Ringkas stok barang aktif per kategori (RM, WIP, FG) di gudang saat ini',
                    selectedCategory
                      ? `Tampilkan daftar stok aktif kategori ${selectedCategory} yang menipis atau kosong`
                      : 'Daftar barang aktif yang stoknya kosong atau menipis di gudang',
                    selectedCategory
                      ? `Ringkas total stok kategori ${selectedCategory} per gudang saat ini`
                      : 'Ringkas total stok barang aktif per gudang dari ERP saat ini',
                  ].map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => onAskAiQuestion(prompt)}
                      className="px-3 py-1.5 text-xs font-medium text-[var(--text)] bg-[var(--surface-2)] hover:border-[var(--accent)] border border-[var(--border)] rounded-lg transition-colors cursor-pointer"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Filter & Search Bar + Scoped Stock Table */}
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                <form
                  onSubmit={handleApplyFilter}
                  className="p-4 border-b border-[var(--border)] flex flex-col md:flex-row items-stretch md:items-center gap-3"
                >
                  <div className="relative flex-1 min-w-0">
                    <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      placeholder={
                        selectedCategory
                          ? t('erp.searchPlaceholderScoped', { category: selectedCategory })
                          : t('erp.searchPlaceholder')
                      }
                      className="w-full h-10 pl-10 pr-8 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/25"
                    />
                    {(searchInput || appliedSearch) && (
                      <button
                        type="button"
                        onClick={handleClearSearch}
                        aria-label={t('common.clearSearch')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <select
                    value={warehouseFilter}
                    onChange={(e) => handleWarehouseChange(e.target.value)}
                    aria-label={t('erp.allWarehouses')}
                    className="h-10 px-3 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                  >
                    <option value="">{t('erp.allWarehouses')}</option>
                    {visiblePhysicalWarehouses.map((w) => (
                      <option key={w.warehouse} value={w.warehouse}>
                        {w.warehouse} ({formatNumber(w.skuCount)})
                      </option>
                    ))}
                  </select>

                  <label className="inline-flex items-center gap-2 text-xs text-[var(--text)] px-2 whitespace-nowrap cursor-pointer">
                    <input
                      type="checkbox"
                      checked={onlyLowStock}
                      disabled={!isDetailVisible}
                      onChange={(e) => handleLowStockToggle(e.target.checked)}
                      className="rounded border-[var(--border)] accent-[var(--accent)] disabled:opacity-50"
                    />
                    <span>{t('erp.lowStockOnly')}</span>
                  </label>

                  <button
                    type="submit"
                    disabled={loadingStock}
                    className="h-10 px-4 text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {t('erp.searchStock')}
                  </button>
                </form>

                {!isDetailVisible ? (
                  <div className="px-6 py-12 text-center space-y-2">
                    <FolderKanban className="w-8 h-8 text-[var(--text-muted)] mx-auto" />
                    <p className="text-sm font-semibold text-[var(--text)]">
                      {t('erp.selectCategoryEmptyTitle')}
                    </p>
                    <p className="text-xs text-[var(--text-muted)] max-w-lg mx-auto leading-relaxed">
                      {t('erp.selectCategoryEmptyDesc')}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="px-4 py-2.5 bg-[var(--surface-2)]/70 border-b border-[var(--border)] flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--text-muted)]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{t('erp.activeInventoryLabel')}</span>
                        {selectedCategory && (
                          <span>
                            · {t('erp.categoryLabel')}:{' '}
                            <strong className="text-[var(--text)]">{selectedCategory}</strong>
                          </span>
                        )}
                        {appliedSearch && (
                          <span>
                            · {t('erp.searchLabel')}:{' '}
                            <strong className="text-[var(--text)]">&ldquo;{appliedSearch}&rdquo;</strong>
                          </span>
                        )}
                        {warehouseFilter && (
                          <span className="inline-flex items-center gap-1">
                            · Gudang:{' '}
                            <strong className="text-[var(--text)]">{warehouseFilter}</strong>
                            <button
                              type="button"
                              onClick={() => handleWarehouseChange('')}
                              aria-label="Hapus filter gudang"
                              className="text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <div className="inline-flex items-center gap-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg p-0.5">
                          <span className="px-2 text-[11px] font-medium text-[var(--text-muted)] whitespace-nowrap">
                            {t('erp.sortQty')}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleQtySortChange('desc')}
                            aria-pressed={qtySort === 'desc'}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                              qtySort === 'desc'
                                ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                                : 'text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
                            }`}
                            title={t('erp.sortDescTitle')}
                          >
                            <ArrowDownWideNarrow className="w-3.5 h-3.5" />
                            <span>{t('erp.sortDesc')}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleQtySortChange('asc')}
                            aria-pressed={qtySort === 'asc'}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                              qtySort === 'asc'
                                ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                                : 'text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]'
                            }`}
                            title={t('erp.sortAscTitle')}
                          >
                            <ArrowUpNarrowWide className="w-3.5 h-3.5" />
                            <span>{t('erp.sortAsc')}</span>
                          </button>
                        </div>
                        <span className="font-mono tabular-nums whitespace-nowrap">
                          {formatNumber(sortedItems.length)} {t('common.rows')}
                        </span>
                      </div>
                    </div>

                    {/* Stock Data Table */}
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left border-collapse">
                        <thead>
                          <tr className="bg-[var(--surface-2)] border-b border-[var(--border)] text-[var(--text-muted)]">
                            <th className="px-4 py-2.5 font-semibold whitespace-nowrap">
                              {t('erp.colCode')}
                            </th>
                            <th className="px-4 py-2.5 font-semibold">{t('erp.colName')}</th>
                            <th className="px-4 py-2.5 font-semibold whitespace-nowrap">
                              {t('erp.colWarehouse')}
                            </th>
                            <th className="px-4 py-2.5 font-semibold text-right whitespace-nowrap">
                              <div className="inline-flex items-center justify-end gap-1.5">
                                <span>{t('erp.colQty')}</span>
                                <span className="inline-flex items-center gap-0.5">
                                  <button
                                    type="button"
                                    onClick={() => handleQtySortChange('desc')}
                                    aria-label={t('erp.sortDescTitle')}
                                    aria-pressed={qtySort === 'desc'}
                                    title={t('erp.sortDescTitle')}
                                    className={`p-1 rounded transition-colors cursor-pointer ${
                                      qtySort === 'desc'
                                        ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                                        : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
                                    }`}
                                  >
                                    <ArrowDownWideNarrow className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleQtySortChange('asc')}
                                    aria-label={t('erp.sortAscTitle')}
                                    aria-pressed={qtySort === 'asc'}
                                    title={t('erp.sortAscTitle')}
                                    className={`p-1 rounded transition-colors cursor-pointer ${
                                      qtySort === 'asc'
                                        ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                                        : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]'
                                    }`}
                                  >
                                    <ArrowUpNarrowWide className="w-3.5 h-3.5" />
                                  </button>
                                </span>
                              </div>
                            </th>
                            <th className="px-4 py-2.5 font-semibold whitespace-nowrap">
                              {t('erp.colUnit')}
                            </th>
                            <th className="px-4 py-2.5 font-semibold whitespace-nowrap">
                              {t('erp.colCategory')}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]/70 tabular-nums">
                          {loadingStock ? (
                            <tr>
                              <td colSpan={6} className="px-4 py-10 text-center text-[var(--text-muted)]">
                                <span className="inline-flex items-center gap-2">
                                  <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />
                                  {t('erp.loadingStock')}
                                </span>
                              </td>
                            </tr>
                          ) : sortedItems.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="px-4 py-10 text-center text-[var(--text-muted)]">
                                {t('erp.emptyStock')}
                              </td>
                            </tr>
                          ) : (
                            stockPaging.paginatedItems.map((item, idx) => (
                              <tr
                                key={`${item.code}-${item.warehouse}-${idx}`}
                                className="hover:bg-[var(--surface-2)]/60 transition-colors"
                              >
                                <td className="px-4 py-2.5 font-mono font-medium text-[var(--text)] whitespace-nowrap">
                                  {item.code}
                                </td>
                                <td className="px-4 py-2.5 text-[var(--text)]">{item.name}</td>
                                <td className="px-4 py-2.5 text-[var(--text-muted)] whitespace-nowrap">
                                  {item.warehouse}
                                </td>
                                <td
                                  className={`px-4 py-2.5 text-right font-mono font-semibold whitespace-nowrap ${
                                    item.qty <= 0
                                      ? 'text-[var(--danger)]'
                                      : item.qty <= 10
                                        ? 'text-[var(--warning)]'
                                        : 'text-[var(--text)]'
                                  }`}
                                >
                                  {formatNumber(item.qty)}
                                </td>
                                <td className="px-4 py-2.5 text-[var(--text-muted)] whitespace-nowrap">
                                  {item.unit}
                                </td>
                                <td className="px-4 py-2.5 text-[var(--text-muted)] whitespace-nowrap">
                                  {item.category || '-'}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                    {!loadingStock && sortedItems.length > 0 && (
                      <TablePaginationBar {...stockPaging.paginationProps} />
                    )}
                  </>
                )}
              </div>

              {/* Separate Informational Panel: Gudang Intransit (NEVER summed into available stock) */}
              <div className="bg-[var(--surface)] border border-dashed border-[var(--border)] rounded-xl overflow-hidden">
                <div className="px-4 py-3.5 flex flex-wrap items-center justify-between gap-3 bg-[var(--surface-2)]/50">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <Truck className="w-4 h-4 text-[var(--warning)] shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-display text-xs font-semibold text-[var(--text)]">
                          {t('erp.intransitPanelTitle')}
                        </h3>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-[var(--surface)] text-[var(--text-muted)] border border-[var(--border)]">
                          <Info className="w-3 h-3 shrink-0" />
                          <span>{t('erp.intransitInfoBadge')}</span>
                        </span>
                      </div>
                      <p className="text-[11px] text-[var(--text-muted)] mt-1 leading-relaxed">
                        {t('erp.intransitPanelDesc')}
                      </p>
                      {intransitSummary && intransitSummary.skuCount > 0 && (
                        <p className="text-[11px] font-mono tabular-nums text-[var(--text)] mt-1">
                          {t('erp.intransitSummaryLine', {
                            skuCount: formatNumber(intransitSummary.skuCount),
                            totalQty: formatNumber(intransitSummary.totalQty),
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowIntransitDetail((prev) => !prev)}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] hover:border-[var(--accent)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {showIntransitDetail ? (
                      <>
                        <ChevronUp className="w-3.5 h-3.5" />
                        <span>{t('erp.intransitHideDetail')}</span>
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-3.5 h-3.5" />
                        <span>{t('erp.intransitShowDetail')}</span>
                      </>
                    )}
                  </button>
                </div>

                {showIntransitDetail && (
                  <div className="border-t border-[var(--border)]">
                    {intransitError && (
                      <div className="px-4 py-2.5 text-xs text-[var(--danger)] bg-[var(--danger)]/10">
                        {intransitError}
                      </div>
                    )}
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left border-collapse">
                        <thead>
                          <tr className="bg-[var(--surface-2)]/70 border-b border-[var(--border)] text-[var(--text-muted)]">
                            <th className="px-4 py-2 font-semibold whitespace-nowrap">
                              {t('erp.colCode')}
                            </th>
                            <th className="px-4 py-2 font-semibold">{t('erp.colName')}</th>
                            <th className="px-4 py-2 font-semibold whitespace-nowrap">
                              {t('erp.intransitColStatus')}
                            </th>
                            <th className="px-4 py-2 font-semibold text-right whitespace-nowrap">
                              {t('erp.intransitColQty')}
                            </th>
                            <th className="px-4 py-2 font-semibold whitespace-nowrap">
                              {t('erp.colUnit')}
                            </th>
                            <th className="px-4 py-2 font-semibold whitespace-nowrap">
                              {t('erp.colCategory')}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]/70 tabular-nums">
                          {loadingIntransit ? (
                            <tr>
                              <td colSpan={6} className="px-4 py-8 text-center text-[var(--text-muted)]">
                                <span className="inline-flex items-center gap-2">
                                  <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />
                                  {t('erp.intransitLoading')}
                                </span>
                              </td>
                            </tr>
                          ) : intransitItems.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="px-4 py-8 text-center text-[var(--text-muted)]">
                                {t('erp.intransitEmpty')}
                              </td>
                            </tr>
                          ) : (
                            intransitPaging.paginatedItems.map((item, idx) => (
                              <tr
                                key={`it-${item.code}-${item.warehouse}-${idx}`}
                                className="hover:bg-[var(--surface-2)]/40 transition-colors"
                              >
                                <td className="px-4 py-2 font-mono font-medium text-[var(--text)] whitespace-nowrap">
                                  {item.code}
                                </td>
                                <td className="px-4 py-2 text-[var(--text)]">{item.name}</td>
                                <td className="px-4 py-2 whitespace-nowrap">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-[var(--warning)]/12 text-[var(--warning)] border border-[var(--warning)]/25">
                                    <Truck className="w-3 h-3 shrink-0" />
                                    <span>{t('erp.intransitStatusLabel')}</span>
                                  </span>
                                </td>
                                <td className="px-4 py-2 text-right font-mono font-semibold text-[var(--text-muted)] whitespace-nowrap">
                                  {formatNumber(item.qty)}
                                </td>
                                <td className="px-4 py-2 text-[var(--text-muted)] whitespace-nowrap">
                                  {item.unit}
                                </td>
                                <td className="px-4 py-2 text-[var(--text-muted)] whitespace-nowrap">
                                  {item.category || '-'}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                    {!loadingIntransit && intransitItems.length > 0 && (
                      <TablePaginationBar {...intransitPaging.paginationProps} compact />
                    )}
                  </div>
                )}
              </div>
                </>
              )}
            </>
          )}
        </>
      ) : (
        /* Setup & Diagnostic Panel (No credential input forms in browser UI) */
        <div className="space-y-4">
          <div
            className={`rounded-xl border px-4 py-3.5 text-xs flex items-start gap-3 ${
              status?.configured
                ? 'bg-[var(--danger)]/10 border-[var(--danger)]/35 text-[var(--text)]'
                : 'bg-[var(--warning)]/12 border-[var(--warning)]/35 text-[var(--text)]'
            }`}
          >
            <AlertTriangle
              className={`w-4 h-4 shrink-0 mt-0.5 ${
                status?.configured ? 'text-[var(--danger)]' : 'text-[var(--warning)]'
              }`}
            />
            <div className="space-y-1.5 min-w-0 flex-1">
              <p className="font-semibold">
                {status?.configured
                  ? t('erp.notConnected', {
                      mode: status.mode === 'bridge' ? 'HTTP Bridge' : 'MySQL TCP',
                      host: status.hostPreview,
                    })
                  : t('erp.notConfigured')}
              </p>
              <p className="leading-relaxed text-[var(--text-muted)]">
                {status?.error ||
                  'Demi keamanan, kredensial database tidak dimasukkan lewat browser. Gunakan jalur gratis HTTP Bridge (.\\ngrok http 3099) di bawah ini agar port 3306 MySQL tetap tertutup rapat di PC lokal Anda.'}
              </p>
              {status?.availableTables && status.availableTables.length > 0 && (
                <div className="pt-2 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">
                      DB <code>{status.database}</code> ({formatNumber(status.availableTables.length)}):
                    </p>
                    {status.availableTables.length > 15 && (
                      <input
                        type="text"
                        value={tableFilter}
                        onChange={(e) => setTableFilter(e.target.value)}
                        placeholder={t('common.search')}
                        className="px-2.5 py-1 text-[11px] bg-[var(--surface)] border border-[var(--border)] rounded text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] w-64 max-w-full"
                      />
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5 font-mono text-[11px] max-h-48 overflow-y-auto pr-1">
                    {status.availableTables
                      .filter((tbl) =>
                        !tableFilter.trim()
                          ? true
                          : tbl.toLowerCase().includes(tableFilter.trim().toLowerCase())
                      )
                      .map((tbl) => {
                        const isLikelyStock =
                          /(stok|stock|gudang|barang|item|warehouse|inv|loc|mutasi|persediaan)/i.test(
                            tbl
                          );
                        return (
                          <code
                            key={tbl}
                            className={`px-2 py-0.5 rounded border ${
                              isLikelyStock
                                ? 'bg-[var(--success)]/12 border-[var(--success)]/40 text-[var(--success)] font-semibold'
                                : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text)]'
                            }`}
                          >
                            {tbl}
                          </code>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Setup Mode Switcher */}
          <div className="inline-flex flex-wrap items-center gap-1 p-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg">
            <button
              type="button"
              onClick={() => setSetupMode('bridge')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                setupMode === 'bridge'
                  ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              {t('erp.setupModeBridge')}
            </button>
            <button
              type="button"
              onClick={() => setSetupMode('direct')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                setupMode === 'direct'
                  ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              {t('erp.setupModeDirect')}
            </button>
          </div>

          {setupMode === 'bridge' ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Step 1: Download/Run Local Bridge */}
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FileCode2 className="w-4 h-4 text-[var(--accent-text)]" />
                    <h2 className="font-display text-sm font-semibold text-[var(--text)]">
                      {t('erp.setupBridgeStep1')}
                    </h2>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={downloadBridgeScript}
                      className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>erp-mysql-bridge.mjs</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCopyText('bridge', LOCAL_BRIDGE_SCRIPT)}
                      className="inline-flex items-center gap-1.5 h-8 px-2.5 text-xs font-medium text-[var(--text)] bg-[var(--surface-2)] border border-[var(--border)] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {copiedKey === 'bridge' ? (
                        <Check className="w-3.5 h-3.5 text-[var(--success)]" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedKey === 'bridge' ? t('common.copied') : t('common.copy')}</span>
                    </button>
                  </div>
                </div>
                <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                  Read-only <code>SELECT</code> → <code>127.0.0.1:3306</code> · Bridge endpoint{' '}
                  <code>127.0.0.1:3099</code>.
                </p>
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-[var(--text)] flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5 text-[var(--accent-text)]" />
                    <span>PowerShell:</span>
                  </p>
                  <pre className="p-3 rounded-lg bg-[#131316] text-[#F4F4F5] border border-[var(--border)] text-[11px] font-mono overflow-x-auto leading-relaxed">{`npm init -y
npm install mysql2
# Edit CONFIG di erp-mysql-bridge.mjs (database, user, password, bridgeToken)
node erp-mysql-bridge.mjs`}</pre>
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-[var(--text)]">
                    ngrok (<code>C:\ngrok</code>):
                  </p>
                  <pre className="p-3 rounded-lg bg-[#131316] text-[#F4F4F5] border border-[var(--border)] text-[11px] font-mono overflow-x-auto">{`.\\ngrok http 3099`}</pre>
                </div>
              </div>

              {/* Step 2: Set 2 Secrets */}
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-[var(--accent-text)]" />
                  <h2 className="font-display text-sm font-semibold text-[var(--text)]">
                    {t('erp.setupBridgeStep2')}
                  </h2>
                </div>
                <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg">
                  <div className="px-3.5 py-2.5 space-y-0.5">
                    <code className="text-xs font-mono font-semibold text-[var(--text)]">
                      ERP_BRIDGE_URL
                    </code>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      <code>https://...ngrok-free.dev</code> (<code>.\ngrok http 3099</code>)
                    </p>
                  </div>
                  <div className="px-3.5 py-2.5 space-y-0.5">
                    <code className="text-xs font-mono font-semibold text-[var(--text)]">
                      ERP_BRIDGE_TOKEN
                    </code>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      Match <code>bridgeToken</code> in <code>erp-mysql-bridge.mjs</code>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Direct TCP Step 1 */}
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-[var(--accent-text)]" />
                    <h2 className="font-display text-sm font-semibold text-[var(--text)]">
                      {t('erp.setupDirectStep1')}
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCopyText('sql', MYSQL_SETUP_SQL)}
                    className="inline-flex items-center gap-1.5 h-8 px-2.5 text-xs font-medium text-[var(--text)] bg-[var(--surface-2)] border border-[var(--border)] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {copiedKey === 'sql' ? (
                      <Check className="w-3.5 h-3.5 text-[var(--success)]" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copiedKey === 'sql' ? t('common.copied') : t('erp.copySql')}</span>
                  </button>
                </div>
                <pre className="p-3.5 rounded-lg bg-[#131316] text-[#F4F4F5] border border-[var(--border)] text-[11px] font-mono overflow-x-auto leading-relaxed">
                  {MYSQL_SETUP_SQL}
                </pre>
              </div>

              {/* Direct TCP Step 2 */}
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-[var(--accent-text)]" />
                  <h2 className="font-display text-sm font-semibold text-[var(--text)]">
                    {t('erp.setupDirectStep2')}
                  </h2>
                </div>
                <div className="divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg">
                  {DIRECT_ENV_LIST.map((item) => (
                    <div
                      key={item.key}
                      className="px-3 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1"
                    >
                      <code className="text-[11px] font-mono font-semibold text-[var(--text)]">
                        {item.key}
                      </code>
                      <span className="text-[11px] text-[var(--text-muted)] sm:text-right">
                        {item.desc}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
