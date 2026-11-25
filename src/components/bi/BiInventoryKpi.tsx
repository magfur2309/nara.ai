import React, { useMemo, useState } from 'react';
import { Info, Search } from 'lucide-react';
import {
  BiGroupedColumnChart,
  BiHorizontalBarChart,
  BiKpiHeaderAndFilter,
  BiKpiStateViews,
  BiLineChart,
  BiVerticalSingleChart,
  type GroupedMetricDef,
  type HorizontalBarDatum,
} from './BiFinanceChartPrimitives';
import {
  downloadCsvFile,
  formatCompactIdr,
  formatDecimal,
  formatIdr,
  formatMonthFull,
  formatMonthShort,
  formatNumberPlain,
  formatPct,
  useBiInventoryPeriodData,
} from './biOperationsShared';

export type BiInventoryKpiMode =
  | 'warehouse_valuation'
  | 'abc_pareto'
  | 'stockout_risk'
  | 'turnover_dio'
  | 'velocity_dead_stock'
  | 'movement_intransit';

interface BiInventoryKpiProps {
  mode: BiInventoryKpiMode;
  idToken: string | null;
  onDownloadBridge?: () => void;
}

const META_BY_MODE: Record<
  BiInventoryKpiMode,
  {
    category: string;
    chartTypeLabel: string;
    title: string;
    description: string;
  }
> = {
  warehouse_valuation: {
    category: 'Valuasi & Struktur Stok',
    chartTypeLabel: 'Diagram Batang Horizontal & Rekap Gudang',
    title: '01. Valuasi & Sebaran Stok per Gudang Fisik',
    description:
      'Menampilkan jumlah SKU aktif, total kuantitas, dan estimasi nilai persediaan di seluruh gudang fisik (mengecualikan Gudang Intransit) beserta rekonsiliasi saldo Persediaan GL.',
  },
  abc_pareto: {
    category: 'Valuasi & Struktur Stok',
    chartTypeLabel: 'Analisis Pareto ABC (80/15/5)',
    title: '02. Analisis ABC Valuasi Persediaan (Pareto)',
    description:
      'Mengelompokkan barang fisik aktif menjadi Kelas A (~80% nilai persediaan), Kelas B (~15%), dan Kelas C (~5%) untuk prioritas pengendalian stok dan stock opname.',
  },
  stockout_risk: {
    category: 'Kesehatan & Ketersediaan Stok',
    chartTypeLabel: 'Diagram Kolom & Prioritas Restock',
    title: '03. Risiko Stockout, Stok Kosong & Menipis',
    description:
      'Mendeteksi SKU aktif yang stok fisiknya kosong (≤ 0) atau menipis (di bawah minimum stok / estimasi kecukupan ≤ 14 hari), diurutkan berdasarkan volume permintaan aktual.',
  },
  turnover_dio: {
    category: 'Kesehatan & Ketersediaan Stok',
    chartTypeLabel: 'Diagram Garis & Kolom Bulanan',
    title: '04. Perputaran Persediaan & Days of Inventory (ITR & DIO)',
    description:
      'Mengukur seberapa cepat persediaan berputar menjadi penjualan (Inventory Turnover Ratio tahunan) dan rata-rata lama barang tersimpan di gudang (DIO dalam hari) dari data GL HPP & Persediaan.',
  },
  velocity_dead_stock: {
    category: 'Pergerakan & Efisiensi Modal',
    chartTypeLabel: 'Klasifikasi Fast/Slow/Dead Stock',
    title: '05. Fast-Moving vs Slow-Moving & Dead Stock',
    description:
      'Mengidentifikasi modal kerja yang tertahan pada barang bergerak lambat (Slow-Moving) dan tidak bergerak sama sekali (Dead Stock) berdasarkan histori pengeluaran DO/SI aktual.',
  },
  movement_intransit: {
    category: 'Pergerakan & Efisiensi Modal',
    chartTypeLabel: 'Diagram Kolom Berkelompok & Intransit',
    title: '06. Arus Masuk vs Keluar Barang & Monitoring Intransit',
    description:
      'Membandingkan volume barang masuk (GRN) vs barang keluar (DO/SI) bulanan, disertai pemantauan terpisah Gudang Intransit (barang sudah dikirim via DO namun belum diterbitkan faktur SI).',
  },
};

export const BiInventoryKpi: React.FC<BiInventoryKpiProps> = ({
  mode,
  idToken,
  onDownloadBridge,
}) => {
  const {
    selectedYear,
    setSelectedYear,
    startMonth,
    setStartMonth,
    endMonth,
    setEndMonth,
    effectiveStart,
    effectiveEnd,
    availableYears,
    data,
    loading,
    refreshing,
    errorMsg,
    fetchData,
    applyPreset,
    resetToActivePeriod,
  } = useBiInventoryPeriodData(idToken);

  const [itemSearch, setItemSearch] = useState('');
  const [abcFilter, setAbcFilter] = useState<'ALL' | 'A' | 'B' | 'C'>('ALL');
  const [healthFilter, setHealthFilter] = useState<'ALL' | 'out_of_stock' | 'low_stock'>('ALL');
  const [velocityFilter, setVelocityFilter] = useState<'ALL' | 'dead' | 'slow'>('ALL');

  const meta = META_BY_MODE[mode];

  const activeMonths = useMemo(() => {
    if (!data) return [];
    return data.monthly.filter((m) => {
      if (mode === 'turnover_dio') return m.glInventoryEnding > 0 || m.glCogs > 0;
      return m.grnInQty > 0 || m.doOutQty > 0 || m.siOutQty > 0;
    });
  }, [data, mode]);

  const filteredAbcItems = useMemo(() => {
    if (!data) return [];
    const q = itemSearch.trim().toLowerCase();
    return data.abcTopItems.filter((it) => {
      if (abcFilter !== 'ALL' && it.abcClass !== abcFilter) return false;
      if (!q) return true;
      return (
        it.code.toLowerCase().includes(q) ||
        it.name.toLowerCase().includes(q) ||
        it.category.toLowerCase().includes(q)
      );
    });
  }, [abcFilter, data, itemSearch]);

  const filteredCriticalItems = useMemo(() => {
    if (!data) return [];
    const q = itemSearch.trim().toLowerCase();
    return data.criticalStockItems.filter((it) => {
      if (healthFilter !== 'ALL' && it.healthStatus !== healthFilter) return false;
      if (!q) return true;
      return (
        it.code.toLowerCase().includes(q) ||
        it.name.toLowerCase().includes(q) ||
        it.category.toLowerCase().includes(q)
      );
    });
  }, [data, healthFilter, itemSearch]);

  const filteredSlowDeadItems = useMemo(() => {
    if (!data) return [];
    const q = itemSearch.trim().toLowerCase();
    return data.slowDeadItems.filter((it) => {
      if (velocityFilter !== 'ALL' && it.velocityClass !== velocityFilter) return false;
      if (!q) return true;
      return (
        it.code.toLowerCase().includes(q) ||
        it.name.toLowerCase().includes(q) ||
        it.category.toLowerCase().includes(q)
      );
    });
  }, [data, itemSearch, velocityFilter]);

  const isEmpty = useMemo(() => {
    if (!data) return false;
    if (mode === 'turnover_dio') return activeMonths.length === 0;
    if (mode === 'movement_intransit')
      return activeMonths.length === 0 && data.intransit.skuCount === 0;
    return data.summary.totalActivePhysicalSkus === 0;
  }, [activeMonths.length, data, mode]);

  const handleExportCsv = () => {
    if (!data) return;
    const tag = `${selectedYear}_${String(effectiveStart).padStart(2, '0')}-${String(effectiveEnd).padStart(2, '0')}`;
    if (mode === 'warehouse_valuation') {
      downloadCsvFile(
        `bi_inventory_01_warehouse_${tag}.csv`,
        ['Gudang Fisik', 'Jml SKU', 'SKU Ada Stok', 'SKU Kosong', 'Total Qty', 'Estimasi Nilai (Rp)', 'Porsi Nilai (%)'],
        data.warehouses.map((w) => [
          w.warehouseName,
          w.skuCount,
          w.inStockSkuCount,
          w.zeroStockCount,
          w.totalQty,
          Math.round(w.stockValueIdr),
          w.valueSharePct.toFixed(2),
        ])
      );
      return;
    }
    if (mode === 'abc_pareto') {
      downloadCsvFile(
        `bi_inventory_02_abc_${tag}.csv`,
        ['Kelas ABC', 'Kode', 'Nama Barang', 'Kategori', 'Qty Fisik', 'Satuan', 'HPP/Unit (Rp)', 'Nilai Stok (Rp)', 'Kumulatif (%)'],
        filteredAbcItems.map((it) => [
          it.abcClass,
          it.code,
          it.name,
          it.category,
          it.physicalQty,
          it.unit,
          Math.round(it.unitCost),
          Math.round(it.stockValueIdr),
          it.cumulativeValuePct.toFixed(2),
        ])
      );
      return;
    }
    if (mode === 'stockout_risk') {
      downloadCsvFile(
        `bi_inventory_03_stockout_${tag}.csv`,
        ['Status', 'Kode', 'Nama Barang', 'Kategori', 'Stok Fisik', 'Min Stok', 'Keluar Periode', 'Masuk Periode'],
        filteredCriticalItems.map((it) => [
          it.healthStatus === 'out_of_stock' ? 'Stok Kosong' : 'Stok Menipis',
          it.code,
          it.name,
          it.category,
          it.physicalQty,
          it.minStock ?? '-',
          it.outflowQty,
          it.inflowQty,
        ])
      );
      return;
    }
    if (mode === 'turnover_dio') {
      downloadCsvFile(
        `bi_inventory_04_itr_dio_${tag}.csv`,
        ['Bulan', 'Saldo Persediaan GL (Rp)', 'HPP Bulanan (Rp)', 'ITR Tahunan (x)', 'DIO (Hari)'],
        activeMonths.map((m) => [
          formatMonthFull(m.month),
          Math.round(m.glInventoryEnding),
          Math.round(m.glCogs),
          m.itrAnnualized !== null ? m.itrAnnualized.toFixed(2) : '-',
          m.dioDays !== null ? m.dioDays.toFixed(1) : '-',
        ])
      );
      return;
    }
    if (mode === 'velocity_dead_stock') {
      downloadCsvFile(
        `bi_inventory_05_slow_dead_${tag}.csv`,
        ['Klasifikasi', 'Kode', 'Nama Barang', 'Kategori', 'Stok Fisik', 'Nilai Tertahan (Rp)', 'Qty Keluar', 'Terakhir Keluar'],
        filteredSlowDeadItems.map((it) => [
          it.velocityClass === 'dead' ? 'Dead Stock' : 'Slow-Moving',
          it.code,
          it.name,
          it.category,
          it.physicalQty,
          Math.round(it.stockValueIdr),
          it.outflowQty,
          it.lastOutDate || 'Belum ada keluar di periode',
        ])
      );
      return;
    }
    downloadCsvFile(
      `bi_inventory_06_movement_${tag}.csv`,
      ['Bulan', 'Masuk GRN (Qty)', 'Keluar DO (Qty)', 'Keluar SI (Qty)', 'Selisih Bersih (Qty)'],
      activeMonths.map((m) => [
        formatMonthFull(m.month),
        m.grnInQty,
        m.doOutQty,
        m.siOutQty,
        m.netQtyMovement,
      ])
    );
  };

  const monthHeaders = useMemo(
    () =>
      activeMonths.map((m) => ({
        key: m.month,
        label: formatMonthShort(m.month),
        labelFull: formatMonthFull(m.month),
      })),
    [activeMonths]
  );

  return (
    <div className="space-y-5">
      <BiKpiHeaderAndFilter
        idPrefix={`inv-${mode}`}
        moduleLabel="Inventory"
        category={meta.category}
        chartTypeLabel={meta.chartTypeLabel}
        title={meta.title}
        description={meta.description}
        selectedYear={selectedYear}
        availableYears={availableYears}
        onYearChange={setSelectedYear}
        startMonth={startMonth}
        endMonth={endMonth}
        onStartMonthChange={setStartMonth}
        onEndMonthChange={setEndMonth}
        onApplyPreset={applyPreset}
        onRefresh={() => void fetchData({ refresh: true })}
        onExportCsv={handleExportCsv}
        loading={loading}
        refreshing={refreshing}
        canExport={Boolean(data && !isEmpty)}
        noticeText={
          data
            ? `Aturan Fisik Aktif: Gudang Intransit dikecualikan dari seluruh stok fisik (${formatNumberPlain(data.intransit.skuCount)} SKU / ${formatNumberPlain(data.intransit.totalQty)} qty dipantau terpisah). Sumber HPP: ${data.diagnostics.costSource}.`
            : null
        }
      />

      <BiKpiStateViews
        loading={loading}
        hasData={Boolean(data)}
        errorMsg={errorMsg}
        isEmpty={isEmpty}
        selectedYear={selectedYear}
        startMonth={startMonth}
        endMonth={endMonth}
        onRetry={() => void fetchData({ refresh: true })}
        onResetPeriod={resetToActivePeriod}
        onDownloadBridge={onDownloadBridge}
        errorTitle="Data Inventory ERP Belum Dapat Dimuat"
        emptyTitle="Tidak Ada Data Persediaan pada Periode Ini"
        emptyDescription="Tidak ditemukan data stok atau mutasi persediaan pada rentang periode yang dipilih."
      />

      {data && !isEmpty && !errorMsg && (
        <>
          {/* ==================== KPI 01: WAREHOUSE VALUATION ==================== */}
          {mode === 'warehouse_valuation' && (() => {
            const whBars: HorizontalBarDatum[] = data.warehouses.slice(0, 12).map((w) => ({
              key: w.warehouseName,
              label:
                w.warehouseName.length > 22
                  ? `${w.warehouseName.slice(0, 21)}…`
                  : w.warehouseName,
              value: w.stockValueIdr > 0 ? w.stockValueIdr : w.totalQty,
              valueLabel:
                w.stockValueIdr > 0
                  ? `${formatCompactIdr(w.stockValueIdr)} (${w.valueSharePct.toFixed(1)}%)`
                  : `${formatNumberPlain(w.totalQty)} unit`,
              hoverSummary: `${w.warehouseName} · ${w.skuCount} SKU (${w.zeroStockCount} kosong) · ${formatNumberPlain(w.totalQty)} unit · ${formatIdr(w.stockValueIdr)}`,
            }));

            return (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <p className="text-xs text-[var(--text-muted)]">Estimasi Valuasi Stok Fisik</p>
                    <p className="font-mono text-xl font-bold tabular-nums text-[var(--accent)]">
                      {formatCompactIdr(data.summary.totalPhysicalValueIdr)}
                    </p>
                    <p className="text-[11px] font-mono tabular-nums text-[var(--text-muted)]">
                      {formatIdr(data.summary.totalPhysicalValueIdr)}
                    </p>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <p className="text-xs text-[var(--text-muted)]">Saldo Persediaan GL (COA Tipe 3)</p>
                    <p className="font-mono text-xl font-bold tabular-nums text-[var(--text)]">
                      {formatCompactIdr(data.summary.glInventoryBalanceIdr)}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      Selisih Fisik vs GL: {formatCompactIdr(data.summary.valuationVarianceVsGlIdr)}
                    </p>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <p className="text-xs text-[var(--text-muted)]">Total Kuantitas Fisik</p>
                    <p className="font-mono text-xl font-bold tabular-nums text-[var(--text)]">
                      {formatNumberPlain(data.summary.totalPhysicalQty)}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)] tabular-nums">
                      {formatNumberPlain(data.summary.totalActivePhysicalSkus)} SKU aktif di {data.warehouses.length} gudang fisik
                    </p>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <p className="text-xs text-[var(--text-muted)]">Gudang Intransit (Terpisah)</p>
                    <p className="font-mono text-xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
                      {formatNumberPlain(data.intransit.totalQty)} unit
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      {formatNumberPlain(data.intransit.skuCount)} SKU · Est. {formatCompactIdr(data.intransit.estimatedValueIdr)}
                    </p>
                  </div>
                </div>

                {whBars.length > 0 && (
                  <BiHorizontalBarChart
                    title="Sebaran Valuasi Persediaan per Gudang Fisik"
                    subtitle="Hanya mencakup gudang fisik (Gudang Intransit tidak digabung ke stok fisik)"
                    legendLabel={
                      data.summary.totalPhysicalValueIdr > 0
                        ? 'Nilai Persediaan (Rp)'
                        : 'Total Kuantitas'
                    }
                    data={[...whBars].reverse()}
                    formatAxisTick={
                      data.summary.totalPhysicalValueIdr > 0
                        ? formatCompactIdr
                        : (v) => formatNumberPlain(Math.round(v))
                    }
                  />
                )}

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-[var(--border)]">
                      <h4 className="font-display text-sm font-bold text-[var(--text)]">
                        Rincian per Gudang Fisik ({data.warehouses.length})
                      </h4>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-[var(--bg)] text-[var(--text-muted)] border-b border-[var(--border)]">
                            <th className="text-left px-4 py-2.5 font-semibold">Gudang</th>
                            <th className="text-right px-3 py-2.5 font-semibold">SKU</th>
                            <th className="text-right px-3 py-2.5 font-semibold">Kosong</th>
                            <th className="text-right px-3 py-2.5 font-semibold">Qty Fisik</th>
                            <th className="text-right px-4 py-2.5 font-semibold">Valuasi (Rp)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                          {data.warehouses.map((w) => (
                            <tr key={w.warehouseName} className="hover:bg-[var(--bg)]/60">
                              <td className="px-4 py-2.5 font-medium text-[var(--text)]">
                                {w.warehouseName}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text-muted)]">
                                {formatNumberPlain(w.skuCount)}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-rose-600 dark:text-rose-400">
                                {formatNumberPlain(w.zeroStockCount)}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                                {formatNumberPlain(w.totalQty)}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-[var(--accent)]">
                                {formatIdr(w.stockValueIdr)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-[var(--border)]">
                      <h4 className="font-display text-sm font-bold text-[var(--text)]">
                        Valuasi per Kategori Barang (Top {Math.min(15, data.categories.length)})
                      </h4>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-[var(--bg)] text-[var(--text-muted)] border-b border-[var(--border)]">
                            <th className="text-left px-4 py-2.5 font-semibold">Kategori</th>
                            <th className="text-right px-3 py-2.5 font-semibold">SKU</th>
                            <th className="text-right px-3 py-2.5 font-semibold">Qty Fisik</th>
                            <th className="text-right px-4 py-2.5 font-semibold">Valuasi (Rp)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                          {data.categories.slice(0, 15).map((c) => (
                            <tr key={c.category} className="hover:bg-[var(--bg)]/60">
                              <td className="px-4 py-2.5 font-medium text-[var(--text)]">
                                {c.category}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text-muted)]">
                                {formatNumberPlain(c.skuCount)}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                                {formatNumberPlain(c.totalQty)}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-[var(--text)]">
                                {formatIdr(c.stockValueIdr)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </>
            );
          })()}

          {/* ==================== KPI 02: ABC PARETO ==================== */}
          {mode === 'abc_pareto' && (() => {
            const abcBars: HorizontalBarDatum[] = data.abcSummary.map((a) => ({
              key: a.abcClass,
              label: `Kelas ${a.abcClass}`,
              value: a.stockValueIdr,
              valueLabel: `${a.valueSharePct.toFixed(1)}% (${formatNumberPlain(a.skuCount)} SKU)`,
              hoverSummary: `Kelas ${a.abcClass}: ${a.skuCount} SKU (${a.skuSharePct.toFixed(1)}% SKU) · Nilai ${formatIdr(a.stockValueIdr)} (${a.valueSharePct.toFixed(1)}%)`,
            }));

            return (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {data.abcSummary.map((a) => (
                    <div
                      key={a.abcClass}
                      className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-[var(--text)]">
                          Kelas {a.abcClass}{' '}
                          {a.abcClass === 'A'
                            ? '(Prioritas Kritis ~80%)'
                            : a.abcClass === 'B'
                              ? '(Menengah ~15%)'
                              : '(Volume Luas ~5%)'}
                        </p>
                        <span className="font-mono text-xs font-bold text-[var(--accent)] tabular-nums">
                          {formatPct(a.valueSharePct)}
                        </span>
                      </div>
                      <p className="font-mono text-xl font-bold tabular-nums text-[var(--text)]">
                        {formatCompactIdr(a.stockValueIdr)}
                      </p>
                      <p className="text-[11px] text-[var(--text-muted)] tabular-nums">
                        {formatNumberPlain(a.skuCount)} SKU ({formatPct(a.skuSharePct)} dari SKU bernilai) ·{' '}
                        {formatNumberPlain(a.totalQty)} unit
                      </p>
                    </div>
                  ))}
                </div>

                <BiVerticalSingleChart
                  title="Distribusi Valuasi Persediaan Berdasarkan Kelas Pareto ABC"
                  subtitle="Fokus pengawasan ketat & cycle count harian pada SKU Kelas A"
                  legendLabel="Nilai Persediaan (Rp)"
                  data={abcBars}
                  formatAxisTick={formatCompactIdr}
                />

                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-[var(--border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <h4 className="font-display text-sm font-bold text-[var(--text)]">
                      Daftar SKU Analisis ABC ({filteredAbcItems.length})
                    </h4>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="text"
                          value={itemSearch}
                          onChange={(e) => setItemSearch(e.target.value)}
                          placeholder="Cari kode / nama barang..."
                          className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)] w-52"
                        />
                      </div>
                      <select
                        aria-label="Filter kelas ABC"
                        value={abcFilter}
                        onChange={(e) => setAbcFilter(e.target.value as 'ALL' | 'A' | 'B' | 'C')}
                        className="px-2.5 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
                      >
                        <option value="ALL">Semua Kelas</option>
                        <option value="A">Kelas A</option>
                        <option value="B">Kelas B</option>
                        <option value="C">Kelas C</option>
                      </select>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-[var(--bg)] text-[var(--text-muted)] border-b border-[var(--border)]">
                          <th className="text-left px-4 py-2.5 font-semibold">Kelas</th>
                          <th className="text-left px-3 py-2.5 font-semibold">Barang</th>
                          <th className="text-left px-3 py-2.5 font-semibold">Kategori</th>
                          <th className="text-right px-3 py-2.5 font-semibold">Qty Fisik</th>
                          <th className="text-right px-3 py-2.5 font-semibold">HPP / Unit</th>
                          <th className="text-right px-3 py-2.5 font-semibold">Nilai Stok</th>
                          <th className="text-right px-4 py-2.5 font-semibold">Kumulatif</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {filteredAbcItems.slice(0, 60).map((it) => (
                          <tr key={it.itemId} className="hover:bg-[var(--bg)]/60">
                            <td className="px-4 py-2.5 font-mono font-bold text-[var(--accent)]">
                              {it.abcClass}
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="font-medium text-[var(--text)]">{it.name}</div>
                              <div className="text-[11px] font-mono text-[var(--text-muted)]">
                                {it.code}
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-[var(--text-muted)]">{it.category}</td>
                            <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                              {formatNumberPlain(it.physicalQty)} {it.unit}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text-muted)]">
                              {formatIdr(it.unitCost)}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-[var(--text)]">
                              {formatIdr(it.stockValueIdr)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text-muted)]">
                              {formatPct(it.cumulativeValuePct)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            );
          })()}

          {/* ==================== KPI 03: STOCKOUT & LOW STOCK ==================== */}
          {mode === 'stockout_risk' && (() => {
            const healthBars: HorizontalBarDatum[] = [
              {
                key: 'healthy',
                label: 'Stok Aman',
                value: Math.max(
                  0,
                  data.summary.totalActivePhysicalSkus -
                    data.summary.outOfStockSkus -
                    data.summary.lowStockSkus -
                    data.summary.overStockSkus
                ),
                valueLabel: `${formatNumberPlain(
                  Math.max(
                    0,
                    data.summary.totalActivePhysicalSkus -
                      data.summary.outOfStockSkus -
                      data.summary.lowStockSkus -
                      data.summary.overStockSkus
                  )
                )} SKU`,
                hoverSummary: 'SKU aktif dengan ketersediaan stok aman',
              },
              {
                key: 'low',
                label: 'Menipis',
                value: data.summary.lowStockSkus,
                valueLabel: `${formatNumberPlain(data.summary.lowStockSkus)} SKU`,
                hoverSummary: 'SKU di bawah batas minimum / kecukupan ≤ 14 hari',
              },
              {
                key: 'oos',
                label: 'Stok Kosong',
                value: data.summary.outOfStockSkus,
                valueLabel: `${formatNumberPlain(data.summary.outOfStockSkus)} SKU`,
                hoverSummary: 'SKU aktif dengan stok fisik ≤ 0',
              },
              {
                key: 'over',
                label: 'Overstock',
                value: data.summary.overStockSkus,
                valueLabel: `${formatNumberPlain(data.summary.overStockSkus)} SKU`,
                hoverSummary: 'SKU melebihi batas maksimum stok master',
              },
            ];

            return (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <p className="text-xs text-[var(--text-muted)]">Rasio Stockout (Kosong)</p>
                    <p
                      className={`font-mono text-xl font-bold tabular-nums ${
                        data.summary.stockoutRatePct > 15
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-[var(--accent)]'
                      }`}
                    >
                      {formatPct(data.summary.stockoutRatePct)}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)] tabular-nums">
                      {formatNumberPlain(data.summary.outOfStockSkus)} dari{' '}
                      {formatNumberPlain(data.summary.totalActivePhysicalSkus)} SKU aktif
                    </p>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <p className="text-xs text-[var(--text-muted)]">SKU Stok Menipis</p>
                    <p className="font-mono text-xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
                      {formatNumberPlain(data.summary.lowStockSkus)}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      Acuan: {data.diagnostics.minStockSource ? `Kolom ${data.diagnostics.minStockSource}` : 'Kecukupan ≤ 14 hari permintaan'}
                    </p>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <p className="text-xs text-[var(--text-muted)]">SKU Tersedia (In-Stock)</p>
                    <p className="font-mono text-xl font-bold tabular-nums text-[var(--accent)]">
                      {formatNumberPlain(data.summary.inStockSkus)}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)] tabular-nums">
                      {formatPct(100 - data.summary.stockoutRatePct)} tingkat ketersediaan fisik
                    </p>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <p className="text-xs text-[var(--text-muted)]">Prioritas Restock Kritis</p>
                    <p className="font-mono text-xl font-bold tabular-nums text-rose-600 dark:text-rose-400">
                      {formatNumberPlain(
                        data.criticalStockItems.filter((x) => x.outflowQty > 0).length
                      )}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      SKU kosong/menipis yang memiliki permintaan aktif
                    </p>
                  </div>
                </div>

                <BiVerticalSingleChart
                  title="Profil Kesehatan Ketersediaan Stok Fisik"
                  subtitle="Sebaran jumlah SKU aktif berdasarkan status ketersediaan di gudang fisik"
                  legendLabel="Jumlah SKU"
                  data={healthBars}
                  formatAxisTick={(v) => formatNumberPlain(Math.round(v))}
                />

                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-[var(--border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <h4 className="font-display text-sm font-bold text-[var(--text)]">
                      Daftar Prioritas Restock — Diurutkan Berdasarkan Permintaan Tertinggi ({filteredCriticalItems.length})
                    </h4>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="text"
                          value={itemSearch}
                          onChange={(e) => setItemSearch(e.target.value)}
                          placeholder="Cari kode / nama barang..."
                          className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)] w-52"
                        />
                      </div>
                      <select
                        aria-label="Filter status stok kritis"
                        value={healthFilter}
                        onChange={(e) =>
                          setHealthFilter(e.target.value as 'ALL' | 'out_of_stock' | 'low_stock')
                        }
                        className="px-2.5 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
                      >
                        <option value="ALL">Semua Kritis</option>
                        <option value="out_of_stock">Stok Kosong</option>
                        <option value="low_stock">Stok Menipis</option>
                      </select>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-[var(--bg)] text-[var(--text-muted)] border-b border-[var(--border)]">
                          <th className="text-left px-4 py-2.5 font-semibold">Status</th>
                          <th className="text-left px-3 py-2.5 font-semibold">Barang</th>
                          <th className="text-left px-3 py-2.5 font-semibold">Kategori</th>
                          <th className="text-right px-3 py-2.5 font-semibold">Stok Fisik</th>
                          <th className="text-right px-3 py-2.5 font-semibold">Min Stok</th>
                          <th className="text-right px-3 py-2.5 font-semibold">Keluar Periode</th>
                          <th className="text-right px-4 py-2.5 font-semibold">Masuk Periode</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {filteredCriticalItems.slice(0, 60).map((it) => (
                          <tr key={it.itemId} className="hover:bg-[var(--bg)]/60">
                            <td className="px-4 py-2.5 font-semibold">
                              <span
                                className={
                                  it.healthStatus === 'out_of_stock'
                                    ? 'text-rose-600 dark:text-rose-400'
                                    : 'text-amber-600 dark:text-amber-400'
                                }
                              >
                                {it.healthStatus === 'out_of_stock' ? 'Kosong' : 'Menipis'}
                              </span>
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="font-medium text-[var(--text)]">{it.name}</div>
                              <div className="text-[11px] font-mono text-[var(--text-muted)]">
                                {it.code}
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-[var(--text-muted)]">{it.category}</td>
                            <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-[var(--text)]">
                              {formatNumberPlain(it.physicalQty)} {it.unit}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text-muted)]">
                              {it.minStock !== null ? formatNumberPlain(it.minStock) : '—'}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-[var(--accent)]">
                              {formatNumberPlain(it.outflowQty)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text-muted)]">
                              {formatNumberPlain(it.inflowQty)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            );
          })()}

          {/* ==================== KPI 04: ITR & DIO ==================== */}
          {mode === 'turnover_dio' && (() => {
            const validItr = activeMonths.filter((m) => m.itrAnnualized !== null);
            const avgItr =
              validItr.length > 0
                ? validItr.reduce((s, m) => s + (m.itrAnnualized || 0), 0) / validItr.length
                : 0;
            const validDio = activeMonths.filter((m) => m.dioDays !== null);
            const avgDio =
              validDio.length > 0
                ? validDio.reduce((s, m) => s + (m.dioDays || 0), 0) / validDio.length
                : 0;
            const totalCogs = activeMonths.reduce((s, m) => s + m.glCogs, 0);
            const latestInv = activeMonths[activeMonths.length - 1]?.glInventoryEnding || 0;

            const dioSeries: HorizontalBarDatum[] = activeMonths.map((m) => ({
              key: m.month,
              label: formatMonthShort(m.month),
              value: m.dioDays ?? 0,
              valueLabel: m.dioDays !== null ? `${m.dioDays.toFixed(1)} hr` : '0 hr',
              hoverSummary: `DIO: ${m.dioDays !== null ? m.dioDays.toFixed(1) : '0'} hari · Persediaan GL: ${formatIdr(m.glInventoryEnding)} · HPP: ${formatIdr(m.glCogs)}`,
            }));

            const itrSeries: HorizontalBarDatum[] = activeMonths.map((m) => ({
              key: m.month,
              label: formatMonthShort(m.month),
              value: m.itrAnnualized ?? 0,
              valueLabel: m.itrAnnualized !== null ? `${m.itrAnnualized.toFixed(1)}x` : '0x',
              hoverSummary: `ITR Tahunan: ${m.itrAnnualized !== null ? m.itrAnnualized.toFixed(2) : '0'}x · HPP: ${formatIdr(m.glCogs)}`,
            }));

            return (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <p className="text-xs text-[var(--text-muted)]">Rata-rata Perputaran (ITR)</p>
                    <p className="font-mono text-xl font-bold tabular-nums text-[var(--accent)]">
                      {formatDecimal(avgItr, 2)}x / thn
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      Semakin tinggi semakin efisien modal
                    </p>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <p className="text-xs text-[var(--text-muted)]">Rata-rata Hari Simpan (DIO)</p>
                    <p className="font-mono text-xl font-bold tabular-nums text-[var(--text)]">
                      {formatDecimal(avgDio, 1)} Hari
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      (Persediaan GL ÷ HPP) × Hari Kalender
                    </p>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <p className="text-xs text-[var(--text-muted)]">Total HPP Periode (GL)</p>
                    <p className="font-mono text-xl font-bold tabular-nums text-[var(--text)]">
                      {formatCompactIdr(totalCogs)}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)]">COA Tipe 12 (HPP)</p>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <p className="text-xs text-[var(--text-muted)]">Saldo Akhir Persediaan GL</p>
                    <p className="font-mono text-xl font-bold tabular-nums text-[var(--text)]">
                      {formatCompactIdr(latestInv)}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)]">COA Tipe 3 (Persediaan)</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                  <BiLineChart
                    title="Tren Days of Inventory Outstanding (DIO — Hari)"
                    subtitle="Rata-rata durasi penyimpanan persediaan sebelum terjual per bulan"
                    legendLabel="DIO (Hari)"
                    data={dioSeries}
                    formatAxisTick={(v) => `${v.toFixed(0)} hr`}
                  />
                  <BiVerticalSingleChart
                    title="Inventory Turnover Ratio Tahunan (ITR — Kali/Tahun)"
                    subtitle="Frekuensi perputaran persediaan yang disetahunkan per bulan"
                    legendLabel="ITR (x/thn)"
                    data={itrSeries}
                    formatAxisTick={(v) => `${v.toFixed(1)}x`}
                  />
                </div>
              </>
            );
          })()}

          {/* ==================== KPI 05: FAST / SLOW / DEAD STOCK ==================== */}
          {mode === 'velocity_dead_stock' && (() => {
            const deadBucket = data.velocitySummary.find((v) => v.velocityClass === 'dead');
            const slowBucket = data.velocitySummary.find((v) => v.velocityClass === 'slow');
            const fastBucket = data.velocitySummary.find((v) => v.velocityClass === 'fast');
            const tiedCapital = (deadBucket?.stockValueIdr || 0) + (slowBucket?.stockValueIdr || 0);

            const velBars: HorizontalBarDatum[] = data.velocitySummary.map((v) => ({
              key: v.velocityClass,
              label: v.label,
              value: v.stockValueIdr > 0 ? v.stockValueIdr : v.skuCount,
              valueLabel:
                v.stockValueIdr > 0
                  ? `${formatCompactIdr(v.stockValueIdr)} (${v.valueSharePct.toFixed(1)}%)`
                  : `${formatNumberPlain(v.skuCount)} SKU`,
              hoverSummary: `${v.label}: ${v.skuCount} SKU berstok · ${formatNumberPlain(v.totalQty)} unit · ${formatIdr(v.stockValueIdr)}`,
            }));

            return (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <p className="text-xs text-[var(--text-muted)]">Modal Tertahan (Slow + Dead)</p>
                    <p className="font-mono text-xl font-bold tabular-nums text-rose-600 dark:text-rose-400">
                      {formatCompactIdr(tiedCapital)}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)] tabular-nums">
                      {formatPct((deadBucket?.valueSharePct || 0) + (slowBucket?.valueSharePct || 0))} dari nilai stok fisik
                    </p>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <p className="text-xs text-[var(--text-muted)]">Dead Stock (Tanpa Keluar)</p>
                    <p className="font-mono text-xl font-bold tabular-nums text-rose-600 dark:text-rose-400">
                      {formatNumberPlain(deadBucket?.skuCount || 0)} SKU
                    </p>
                    <p className="text-[11px] font-mono tabular-nums text-[var(--text-muted)]">
                      Nilai: {formatCompactIdr(deadBucket?.stockValueIdr || 0)}
                    </p>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <p className="text-xs text-[var(--text-muted)]">Slow-Moving</p>
                    <p className="font-mono text-xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
                      {formatNumberPlain(slowBucket?.skuCount || 0)} SKU
                    </p>
                    <p className="text-[11px] font-mono tabular-nums text-[var(--text-muted)]">
                      Nilai: {formatCompactIdr(slowBucket?.stockValueIdr || 0)}
                    </p>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <p className="text-xs text-[var(--text-muted)]">Fast-Moving</p>
                    <p className="font-mono text-xl font-bold tabular-nums text-[var(--accent)]">
                      {formatNumberPlain(fastBucket?.skuCount || 0)} SKU
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      Sumber keluar: {data.diagnostics.outflowSource}
                    </p>
                  </div>
                </div>

                <BiHorizontalBarChart
                  title="Valuasi Stok Berdasarkan Kecepatan Pergerakan (Velocity)"
                  subtitle="Mengukur proporsi modal persediaan pada Fast, Medium, Slow, dan Dead Stock"
                  legendLabel={
                    data.summary.totalPhysicalValueIdr > 0 ? 'Nilai Persediaan' : 'Jumlah SKU'
                  }
                  data={[...velBars].reverse()}
                  formatAxisTick={
                    data.summary.totalPhysicalValueIdr > 0
                      ? formatCompactIdr
                      : (v) => formatNumberPlain(Math.round(v))
                  }
                />

                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-[var(--border)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <h4 className="font-display text-sm font-bold text-[var(--text)]">
                      Daftar Slow-Moving & Dead Stock — Prioritas Likuidasi ({filteredSlowDeadItems.length})
                    </h4>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="text"
                          value={itemSearch}
                          onChange={(e) => setItemSearch(e.target.value)}
                          placeholder="Cari kode / nama barang..."
                          className="pl-8 pr-3 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)] w-52"
                        />
                      </div>
                      <select
                        aria-label="Filter klasifikasi pergerakan"
                        value={velocityFilter}
                        onChange={(e) => setVelocityFilter(e.target.value as 'ALL' | 'dead' | 'slow')}
                        className="px-2.5 py-1.5 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)] cursor-pointer"
                      >
                        <option value="ALL">Dead & Slow</option>
                        <option value="dead">Dead Stock Saja</option>
                        <option value="slow">Slow-Moving Saja</option>
                      </select>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-[var(--bg)] text-[var(--text-muted)] border-b border-[var(--border)]">
                          <th className="text-left px-4 py-2.5 font-semibold">Kategori Gerak</th>
                          <th className="text-left px-3 py-2.5 font-semibold">Barang</th>
                          <th className="text-right px-3 py-2.5 font-semibold">Stok Fisik</th>
                          <th className="text-right px-3 py-2.5 font-semibold">Nilai Tertahan</th>
                          <th className="text-right px-3 py-2.5 font-semibold">Qty Keluar</th>
                          <th className="text-right px-4 py-2.5 font-semibold">Terakhir Keluar</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {filteredSlowDeadItems.slice(0, 60).map((it) => (
                          <tr key={it.itemId} className="hover:bg-[var(--bg)]/60">
                            <td className="px-4 py-2.5 font-semibold">
                              <span
                                className={
                                  it.velocityClass === 'dead'
                                    ? 'text-rose-600 dark:text-rose-400'
                                    : 'text-amber-600 dark:text-amber-400'
                                }
                              >
                                {it.velocityClass === 'dead' ? 'Dead Stock' : 'Slow-Moving'}
                              </span>
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="font-medium text-[var(--text)]">{it.name}</div>
                              <div className="text-[11px] font-mono text-[var(--text-muted)]">
                                {it.code} · {it.category}
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                              {formatNumberPlain(it.physicalQty)} {it.unit}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-[var(--text)]">
                              {formatIdr(it.stockValueIdr)}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text-muted)]">
                              {formatNumberPlain(it.outflowQty)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text-muted)]">
                              {it.lastOutDate || 'Nihil di periode'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            );
          })()}

          {/* ==================== KPI 06: INFLOW VS OUTFLOW & INTRANSIT ==================== */}
          {mode === 'movement_intransit' && (() => {
            const netPeriodQty =
              data.summary.totalPeriodInflowQty - data.summary.totalPeriodOutflowQty;
            const metrics: GroupedMetricDef[] = [
              {
                key: 'inflow',
                label: 'Barang Masuk (GRN)',
                color: '#0F766E',
                valuesByMonth: Object.fromEntries(activeMonths.map((m) => [m.month, m.grnInQty])),
              },
              {
                key: 'outflow',
                label: 'Barang Keluar (DO/SI)',
                color: '#D97706',
                valuesByMonth: Object.fromEntries(
                  activeMonths.map((m) => [m.month, m.doOutQty > 0 ? m.doOutQty : m.siOutQty])
                ),
              },
            ];

            return (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <p className="text-xs text-[var(--text-muted)]">Total Masuk (GRN/RI)</p>
                    <p className="font-mono text-xl font-bold tabular-nums text-[var(--accent)]">
                      {formatNumberPlain(data.summary.totalPeriodInflowQty)}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      Sumber: {data.diagnostics.inflowSource}
                    </p>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <p className="text-xs text-[var(--text-muted)]">Total Keluar (DO/SI)</p>
                    <p className="font-mono text-xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
                      {formatNumberPlain(data.summary.totalPeriodOutflowQty)}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      Sumber: {data.diagnostics.outflowSource}
                    </p>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <p className="text-xs text-[var(--text-muted)]">Mutasi Bersih Periode</p>
                    <p className="font-mono text-xl font-bold tabular-nums text-[var(--text)]">
                      {netPeriodQty >= 0 ? '+' : ''}
                      {formatNumberPlain(netPeriodQty)}
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      {netPeriodQty >= 0 ? 'Akumulasi stok bersih' : 'Penurunan stok bersih'}
                    </p>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <p className="text-xs text-[var(--text-muted)]">Stok di Gudang Intransit</p>
                    <p className="font-mono text-xl font-bold tabular-nums text-sky-600 dark:text-sky-400">
                      {formatNumberPlain(data.intransit.totalQty)} unit
                    </p>
                    <p className="text-[11px] text-[var(--text-muted)]">
                      {formatNumberPlain(data.intransit.skuCount)} SKU · Est. {formatCompactIdr(data.intransit.estimatedValueIdr)}
                    </p>
                  </div>
                </div>

                {activeMonths.length > 0 && (
                  <BiGroupedColumnChart
                    title="Arus Masuk vs Keluar Barang Bulanan (Kuantitas)"
                    subtitle="Perbandingan volume penerimaan barang (GRN) dengan pengiriman/penjualan (DO/SI)"
                    months={monthHeaders}
                    metrics={metrics}
                    formatAxisTick={(v) => formatNumberPlain(Math.round(v))}
                    formatExactValue={(v) => `${formatNumberPlain(Math.round(v))} unit`}
                  />
                )}

                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 flex items-start gap-3">
                  <Info className="w-4 h-4 text-[var(--accent)] shrink-0 mt-0.5" />
                  <div className="text-xs text-[var(--text-muted)] leading-relaxed">
                    <strong className="text-[var(--text)]">Pemantauan Gudang Intransit (Virtual):</strong>{' '}
                    Barang di Gudang Intransit adalah barang yang telah dikirim fisik via Delivery Order (DO)
                    namun belum diterbitkan faktur penjualan (Sales Invoice / SI). Stok ini{' '}
                    <strong className="text-[var(--text)]">tidak pernah dijumlahkan ke stok fisik gudang</strong>{' '}
                    dan perlu dipantau agar segera difakturkan tepat waktu.
                  </div>
                </div>

                {data.intransit.topItems.length > 0 && (
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-[var(--border)]">
                      <h4 className="font-display text-sm font-bold text-[var(--text)]">
                        Rincian Barang Sedang di Gudang Intransit (Top {data.intransit.topItems.length})
                      </h4>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-[var(--bg)] text-[var(--text-muted)] border-b border-[var(--border)]">
                            <th className="text-left px-4 py-2.5 font-semibold">Kode</th>
                            <th className="text-left px-3 py-2.5 font-semibold">Nama Barang</th>
                            <th className="text-left px-3 py-2.5 font-semibold">Gudang Virtual</th>
                            <th className="text-right px-3 py-2.5 font-semibold">Qty Intransit</th>
                            <th className="text-right px-4 py-2.5 font-semibold">Estimasi Nilai</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                          {data.intransit.topItems.map((it) => (
                            <tr key={`${it.itemId}-${it.warehouse}`} className="hover:bg-[var(--bg)]/60">
                              <td className="px-4 py-2.5 font-mono text-[var(--text-muted)]">
                                {it.code}
                              </td>
                              <td className="px-3 py-2.5 font-medium text-[var(--text)]">
                                {it.name}
                              </td>
                              <td className="px-3 py-2.5 text-[var(--text-muted)]">
                                {it.warehouse}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono font-semibold tabular-nums text-[var(--text)]">
                                {formatNumberPlain(it.qty)} {it.unit}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--accent)]">
                                {formatIdr(it.estimatedValueIdr)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </>
      )}
    </div>
  );
};
