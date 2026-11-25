import React, { useMemo, useState } from 'react';
import { Database, Link2, Search } from 'lucide-react';
import {
  BiGroupedColumnChart,
  BiHorizontalBarChart,
  BiKpiHeaderAndFilter,
  BiKpiStateViews,
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
  useBiProductionPeriodData,
  type WoSoLinkMethod,
} from './biOperationsShared';

export type BiProductionKpiMode =
  | 'wo_vs_so'
  | 'wo_realization'
  | 'wo_unfulfilled'
  | 'wo_complete_ratio'
  | 'production_cost';

interface BiProductionKpiProps {
  mode: BiProductionKpiMode;
  idToken: string | null;
  onDownloadBridge?: () => void;
}

const META_BY_MODE: Record<
  BiProductionKpiMode,
  {
    category: string;
    chartTypeLabel: string;
    title: string;
    description: string;
  }
> = {
  wo_vs_so: {
    category: 'Perbandingan WO & SO',
    chartTypeLabel: 'Diagram Perbandingan Multi-Bentuk',
    title: '01. Perbandingan Work Order (WO) vs Sales Order (SO)',
    description:
      'Membandingkan jumlah Work Order (WO) terhadap Sales Order (SO) per bulan, termasuk berapa total WO yang sudah terhubung/menjadi SO, rasio keterkaitan, dan rincian tautan dokumen.',
  },
  wo_realization: {
    category: 'Realisasi & Penyelesaian WO',
    chartTypeLabel: 'Diagram Perbandingan Multi-Bentuk',
    title: '02. Perbandingan Target WO vs Output Aktual',
    description:
      'Perbandingan kuantitas rencana/target Work Order terhadap realisasi output produksi aktual per bulan.',
  },
  wo_unfulfilled: {
    category: 'Realisasi & Penyelesaian WO',
    chartTypeLabel: 'Diagram Perbandingan Multi-Bentuk',
    title: '03. Perbandingan WO Tidak Terpenuhi (Backlog)',
    description:
      'Perbandingan sisa kuantitas Work Order yang belum terealisasi terhadap target produksi beserta daftar backlog WO terbuka.',
  },
  wo_complete_ratio: {
    category: 'Realisasi & Penyelesaian WO',
    chartTypeLabel: 'Diagram Perbandingan Multi-Bentuk',
    title: '04. Perbandingan WO Complete vs Total WO',
    description:
      'Perbandingan jumlah Work Order berstatus Complete, In Progress (WIP), dan Open terhadap total WO per bulan.',
  },
  production_cost: {
    category: 'Biaya Produksi GL',
    chartTypeLabel: 'Diagram Perbandingan Multi-Bentuk',
    title: '05. Perbandingan Biaya Produksi (GL & HPP)',
    description:
      'Perbandingan komponen biaya produksi aktual dari Buku Besar (Bahan Baku, Tenaga Kerja, Overhead Pabrik, dan Biaya Lainnya) beserta biaya per unit output.',
  },
};

const WO_SO_LINK_LABELS: Record<WoSoLinkMethod, string> = {
  wo_header_idso: 'Relasi langsung ID Sales Order pada dokumen Work Order',
  wo_header_noso: 'Relasi langsung nomor Sales Order pada dokumen Work Order',
  wo_detail_idso: 'Relasi ID Sales Order pada rincian Work Order',
  so_header_idwo: 'Relasi ID Work Order pada dokumen Sales Order',
  so_detail_idwo: 'Relasi ID Work Order pada rincian Sales Order',
  unlinked_no_fk_column: 'Perbandingan agregat total dokumen Work Order terhadap Sales Order',
  no_wo_table: 'Data transaksi Work Order belum tersedia pada periode ini',
};

export const BiProductionKpi: React.FC<BiProductionKpiProps> = ({
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
  } = useBiProductionPeriodData(idToken);

  const [woSoRatioMetric, setWoSoRatioMetric] = useState<'wo_to_so' | 'so_covered' | 'wo_div_so'>('wo_to_so');
  const [linkFilter, setLinkFilter] = useState<'all' | 'linked' | 'unlinked'>('all');
  const [linkSearch, setLinkSearch] = useState<string>('');
  const [completeBasis, setCompleteBasis] = useState<'complete_only' | 'complete_or_close'>('complete_or_close');

  const meta = META_BY_MODE[mode];

  const activeMonths = useMemo(() => {
    if (!data) return [];
    return data.monthly.filter((m) => {
      if (mode === 'wo_vs_so') return m.woCount > 0 || m.soCount > 0;
      if (mode === 'production_cost') return m.glTotalProdCost !== 0 || m.actualOutputQty > 0;
      if (mode === 'wo_realization' || mode === 'wo_unfulfilled')
        return m.plannedQty > 0 || m.actualOutputQty > 0 || m.woCount > 0 || m.outputDocCount > 0;
      return m.woCount > 0;
    });
  }, [data, mode]);

  const monthHeaders = useMemo(
    () =>
      activeMonths.map((m) => ({
        key: m.month,
        label: formatMonthShort(m.month),
        labelFull: formatMonthFull(m.month),
      })),
    [activeMonths]
  );

  const totals = useMemo(() => {
    const soCount = activeMonths.reduce((s, m) => s + (Number(m.soCount) || 0), 0);
    const soItemQty = activeMonths.reduce((s, m) => s + (Number(m.soItemQty) || 0), 0);
    const soTotalValue = activeMonths.reduce((s, m) => s + (Number(m.soTotalValue) || 0), 0);
    const woCount = activeMonths.reduce((s, m) => s + (Number(m.woCount) || 0), 0);
    const woLinkedToSo = activeMonths.reduce((s, m) => s + (Number(m.woLinkedToSoCount) || 0), 0);
    const soLinkedToWo = activeMonths.reduce((s, m) => s + (Number(m.soLinkedToWoCount) || 0), 0);
    const woUnlinked = activeMonths.reduce((s, m) => s + (Number(m.woUnlinkedCount) || 0), 0);
    const soWithoutWo = activeMonths.reduce((s, m) => s + (Number(m.soWithoutWoCount) || 0), 0);
    const plannedQty = activeMonths.reduce((s, m) => s + (Number(m.plannedQty) || 0), 0);
    const actualOutputQty = activeMonths.reduce((s, m) => s + (Number(m.actualOutputQty) || 0), 0);
    const unfulfilledQty = Math.max(0, plannedQty - actualOutputQty);
    const woCompleteOnly = activeMonths.reduce((s, m) => s + (Number(m.woCompleteOnlyCount) || 0), 0);
    const woComplete = activeMonths.reduce((s, m) => s + (Number(m.woCompleteCount) || 0), 0);
    const woInProgress = activeMonths.reduce((s, m) => s + (Number(m.woInProgressCount) || 0), 0);
    const woOpen = activeMonths.reduce((s, m) => s + (Number(m.woOpenCount) || 0), 0);
    const glMat = activeMonths.reduce((s, m) => s + (Number(m.glMaterialCost) || 0), 0);
    const glLab = activeMonths.reduce((s, m) => s + (Number(m.glLaborCost) || 0), 0);
    const glOvh = activeMonths.reduce((s, m) => s + (Number(m.glOverheadCost) || 0), 0);
    const glOther = activeMonths.reduce((s, m) => s + (Number(m.glOtherProdCost) || 0), 0);
    const glTotal = activeMonths.reduce((s, m) => s + (Number(m.glTotalProdCost) || 0), 0);
    return {
      soCount,
      soItemQty,
      soTotalValue,
      woCount,
      woLinkedToSo,
      soLinkedToWo,
      woUnlinked,
      soWithoutWo,
      woToSoPct: woCount > 0 ? (woLinkedToSo / woCount) * 100 : 0,
      soCoveredPct: soCount > 0 ? (soLinkedToWo / soCount) * 100 : 0,
      woVsSoRatioPct: soCount > 0 ? (woCount / soCount) * 100 : 0,
      plannedQty,
      actualOutputQty,
      unfulfilledQty,
      achievementPct: plannedQty > 0 ? (actualOutputQty / plannedQty) * 100 : 0,
      unfulfilledPct: plannedQty > 0 ? (unfulfilledQty / plannedQty) * 100 : 0,
      woCompleteOnly,
      woComplete,
      woInProgress,
      woOpen,
      glMat,
      glLab,
      glOvh,
      glOther,
      glTotal,
    };
  }, [activeMonths]);

  const filteredWoSoLinks = useMemo(() => {
    const raw = data?.woSoLinks || [];
    const q = linkSearch.trim().toLowerCase();
    return raw.filter((row) => {
      if (linkFilter === 'linked' && !row.isLinkedToSo) return false;
      if (linkFilter === 'unlinked' && row.isLinkedToSo) return false;
      if (!q) return true;
      return (
        row.woDocNo.toLowerCase().includes(q) ||
        row.soDocNo.toLowerCase().includes(q) ||
        row.customerName.toLowerCase().includes(q)
      );
    });
  }, [data?.woSoLinks, linkFilter, linkSearch]);

  const handleExportCsv = () => {
    if (!data || activeMonths.length === 0) return;
    const tag = `${selectedYear}_${String(effectiveStart).padStart(2, '0')}-${String(effectiveEnd).padStart(2, '0')}`;
    if (mode === 'wo_vs_so') {
      downloadCsvFile(
        `bi_production_01_wo_vs_so_${tag}.csv`,
        ['Bulan', 'Total WO', 'WO Terhubung SO', 'WO Tanpa SO', 'Total SO', 'SO Memiliki WO', '% WO -> SO', 'Rasio WO/SO (%)'],
        activeMonths.map((m) => [
          formatMonthFull(m.month),
          m.woCount,
          m.woLinkedToSoCount,
          m.woUnlinkedCount,
          m.soCount,
          m.soLinkedToWoCount,
          m.woToSoPct !== null ? m.woToSoPct.toFixed(2) : '-',
          m.woVsSoRatioPct !== null ? m.woVsSoRatioPct.toFixed(2) : '-',
        ])
      );
      return;
    }
    if (mode === 'wo_realization') {
      downloadCsvFile(
        `bi_production_02_target_vs_output_${tag}.csv`,
        ['Bulan', 'Jumlah WO', 'Target Qty', 'Output Aktual', 'Pencapaian (%)'],
        activeMonths.map((m) => [
          formatMonthFull(m.month),
          m.woCount,
          m.plannedQty,
          m.actualOutputQty,
          m.achievementPct !== null ? m.achievementPct.toFixed(2) : '-',
        ])
      );
      return;
    }
    if (mode === 'wo_unfulfilled') {
      downloadCsvFile(
        `bi_production_03_wo_tidak_terpenuhi_${tag}.csv`,
        ['Bulan', 'Target Qty', 'Output Aktual', 'Belum Terpenuhi', 'Tidak Terpenuhi (%)'],
        activeMonths.map((m) => {
          const unful = Math.max(0, m.plannedQty - m.actualOutputQty);
          const pct = m.plannedQty > 0 ? (unful / m.plannedQty) * 100 : 0;
          return [formatMonthFull(m.month), m.plannedQty, m.actualOutputQty, unful, pct.toFixed(2)];
        })
      );
      return;
    }
    if (mode === 'wo_complete_ratio') {
      downloadCsvFile(
        `bi_production_04_wo_complete_${tag}.csv`,
        ['Bulan', 'Total WO', 'WO Complete', 'In Progress (WIP)', 'Open', 'Completion Rate (%)'],
        activeMonths.map((m) => {
          const comp = completeBasis === 'complete_only' ? m.woCompleteOnlyCount : m.woCompleteCount;
          const pct = m.woCount > 0 ? (comp / m.woCount) * 100 : 0;
          return [formatMonthFull(m.month), m.woCount, comp, m.woInProgressCount, m.woOpenCount, pct.toFixed(2)];
        })
      );
      return;
    }
    downloadCsvFile(
      `bi_production_05_biaya_produksi_${tag}.csv`,
      ['Bulan', 'Bahan Baku (GL)', 'Tenaga Kerja (GL)', 'Overhead Pabrik (GL)', 'Biaya Lainnya (GL)', 'Total Biaya Produksi', 'Output Qty', 'Biaya/Unit'],
      activeMonths.map((m) => [
        formatMonthFull(m.month),
        Math.round(m.glMaterialCost),
        Math.round(m.glLaborCost),
        Math.round(m.glOverheadCost),
        Math.round(m.glOtherProdCost),
        Math.round(m.glTotalProdCost),
        m.actualOutputQty,
        m.unitCostIdr !== null ? Math.round(m.unitCostIdr) : '-',
      ])
    );
  };

  // Transparent m6_* schema discovery panel
  const renderSchemaDiscoveryPanel = (compact?: boolean) => {
    if (!data) return null;
    return (
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4">
        <div className="flex items-start gap-3">
          <Database className="w-5 h-5 text-[var(--accent)] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="font-display text-sm font-bold text-[var(--text)]">
              {compact
                ? 'Status Data Work Order & Relasi Sales Order'
                : 'Belum Ada Transaksi Produksi pada Periode Terpilih'}
            </h4>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed">
              Sistem membaca langsung data Work Order dan Sales Order ERP secara real-time tanpa angka simulasi.{' '}
              {WO_SO_LINK_LABELS[data.diagnostics?.woSoLinkMethod || 'no_wo_table'] ||
                WO_SO_LINK_LABELS.no_wo_table}.
              {!compact && data.diagnostics.hasGlProductionCosts
                ? ' Data perbandingan biaya produksi aktual dari Buku Besar (GL) tetap tersedia pada KPI 05.'
                : ''}
            </p>
          </div>
        </div>

        {data.discoveredTables.length > 0 && (
          <div className="overflow-x-auto border border-[var(--border)] rounded-lg">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-[var(--bg)] text-[var(--text-muted)] border-b border-[var(--border)]">
                  <th className="text-left px-3.5 py-2 font-semibold">Sumber Data Produksi</th>
                  <th className="text-left px-3 py-2 font-semibold">Kategori</th>
                  <th className="text-left px-3 py-2 font-semibold">Periode</th>
                  <th className="text-right px-3.5 py-2 font-semibold">Total Dokumen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {data.discoveredTables.map((t) => (
                  <tr key={t.tableName}>
                    <td className="px-3.5 py-2 font-mono text-[var(--text)]">{t.tableName}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">{t.role}</td>
                    <td className="px-3 py-2 font-mono text-[var(--text-muted)]">
                      {t.dateColumn || '—'}
                    </td>
                    <td className="px-3.5 py-2 text-right font-mono tabular-nums text-[var(--text)]">
                      {formatNumberPlain(t.rowCount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  const extraControls = (
    <>
      {mode === 'wo_vs_so' && (
        <div className="space-y-1 ml-auto">
          <span className="block text-[11px] font-medium text-[var(--text-muted)]">
            Metrik Rasio Grafik Kedua
          </span>
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
            <button
              type="button"
              onClick={() => setWoSoRatioMetric('wo_to_so')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md cursor-pointer whitespace-nowrap ${
                woSoRatioMetric === 'wo_to_so'
                  ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              % WO → SO
            </button>
            <button
              type="button"
              onClick={() => setWoSoRatioMetric('so_covered')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md cursor-pointer whitespace-nowrap ${
                woSoRatioMetric === 'so_covered'
                  ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              % SO Memiliki WO
            </button>
            <button
              type="button"
              onClick={() => setWoSoRatioMetric('wo_div_so')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md cursor-pointer whitespace-nowrap ${
                woSoRatioMetric === 'wo_div_so'
                  ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              Rasio WO ÷ SO (%)
            </button>
          </div>
        </div>
      )}

      {mode === 'wo_complete_ratio' && (
        <div className="space-y-1 ml-auto">
          <span className="block text-[11px] font-medium text-[var(--text-muted)]">
            Status Complete WO
          </span>
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
            <button
              type="button"
              onClick={() => setCompleteBasis('complete_only')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md cursor-pointer whitespace-nowrap ${
                completeBasis === 'complete_only'
                  ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              Complete (Status 4)
            </button>
            <button
              type="button"
              onClick={() => setCompleteBasis('complete_or_close')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md cursor-pointer whitespace-nowrap ${
                completeBasis === 'complete_or_close'
                  ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              Complete &amp; Close (4 / 7)
            </button>
          </div>
        </div>
      )}
    </>
  );

  const isEmpty = Boolean(
    data && activeMonths.length === 0 && (mode === 'production_cost' || mode === 'wo_vs_so')
  );
  const needsM6Notice = Boolean(
    data && activeMonths.length === 0 && mode !== 'production_cost' && mode !== 'wo_vs_so'
  );

  const noticeMessage = useMemo(() => {
    if (!data) return null;
    if (mode === 'wo_vs_so') {
      const linkMethod = data.diagnostics?.woSoLinkMethod || 'no_wo_table';
      return `${WO_SO_LINK_LABELS[linkMethod] || WO_SO_LINK_LABELS.no_wo_table}.`;
    }
    return `Data produksi aktual ERP disinkronkan secara real-time untuk periode terpilih.`;
  }, [data, mode]);

  return (
    <div className="space-y-5">
      <BiKpiHeaderAndFilter
        idPrefix={`prod-${mode}`}
        moduleLabel="Production"
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
        canExport={Boolean(data && activeMonths.length > 0)}
        extraControls={extraControls}
        noticeText={noticeMessage}
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
        errorTitle="Data Production ERP Belum Dapat Dimuat"
        emptyTitle={
          mode === 'wo_vs_so'
            ? 'Tidak Ada Dokumen WO Maupun SO pada Periode Ini'
            : 'Tidak Ada Biaya Produksi pada Periode Ini'
        }
        emptyDescription={
          mode === 'wo_vs_so'
            ? 'Tidak ditemukan dokumen Work Order maupun Sales Order pada rentang bulan yang dipilih.'
            : 'Tidak ditemukan jurnal biaya produksi (HPP / Bahan Baku / Tenaga Kerja / Overhead) pada rentang periode yang dipilih.'
        }
      />

      {data && !errorMsg && needsM6Notice && renderSchemaDiscoveryPanel(false)}

      {data && !errorMsg && activeMonths.length > 0 && (
        <div
          className={`space-y-5 transition-opacity duration-150 ${loading ? 'opacity-65' : 'opacity-100'}`}
        >
          {/* ==================== KPI 01: PERBANDINGAN WO vs SO ==================== */}
          {mode === 'wo_vs_so' && (() => {
            const compMetrics: GroupedMetricDef[] = [
              {
                key: 'woTotal',
                label: 'Total WO',
                color: '#0F766E',
                valuesByMonth: Object.fromEntries(activeMonths.map((m) => [m.month, m.woCount])),
              },
              {
                key: 'woLinked',
                label: 'WO Terhubung SO',
                color: '#0284C7',
                valuesByMonth: Object.fromEntries(
                  activeMonths.map((m) => [m.month, m.woLinkedToSoCount])
                ),
              },
              {
                key: 'soTotal',
                label: 'Total SO',
                color: '#D97706',
                valuesByMonth: Object.fromEntries(activeMonths.map((m) => [m.month, m.soCount])),
              },
              {
                key: 'soCovered',
                label: 'SO Memiliki WO',
                color: '#7C3AED',
                valuesByMonth: Object.fromEntries(
                  activeMonths.map((m) => [m.month, m.soLinkedToWoCount])
                ),
              },
            ];

            const ratioSeries: HorizontalBarDatum[] = activeMonths.map((m) => {
              const val =
                woSoRatioMetric === 'wo_to_so'
                  ? m.woToSoPct ?? 0
                  : woSoRatioMetric === 'so_covered'
                    ? m.soCoveredByWoPct ?? 0
                    : m.woVsSoRatioPct ?? 0;
              return {
                key: m.month,
                label: formatMonthShort(m.month),
                value: val,
                valueLabel: formatPct(val),
                hoverSummary: `WO: ${formatNumberPlain(m.woCount)} (Terkait SO: ${formatNumberPlain(m.woLinkedToSoCount)}) · SO: ${formatNumberPlain(m.soCount)} (Ada WO: ${formatNumberPlain(m.soLinkedToWoCount)})`,
              };
            });

            const ratioTitle =
              woSoRatioMetric === 'wo_to_so'
                ? 'Persentase WO yang Terhubung ke SO (%)'
                : woSoRatioMetric === 'so_covered'
                  ? 'Persentase SO yang Memiliki WO (%)'
                  : 'Rasio Total WO terhadap Total SO (%)';

            return (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <span className="text-xs text-[var(--text-muted)]">Total Work Order (WO)</span>
                    <p className="font-mono text-xl font-bold text-[var(--text)] tabular-nums">
                      {formatNumberPlain(totals.woCount)}
                    </p>
                    <span className="text-[11px] text-[var(--text-muted)] block">
                      {totals.woCount > 0 ? 'Dokumen Work Order aktif' : 'Belum ada transaksi Work Order'}
                    </span>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <span className="text-xs text-[var(--text-muted)]">WO Sudah Menjadi / Terkait SO</span>
                    <p className="font-mono text-xl font-bold text-[var(--accent)] tabular-nums">
                      {formatNumberPlain(totals.woLinkedToSo)}
                    </p>
                    <span className="text-[11px] text-[var(--text-muted)] block tabular-nums">
                      {formatPct(totals.woToSoPct)} dari total WO · Tanpa SO: {formatNumberPlain(totals.woUnlinked)}
                    </span>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <span className="text-xs text-[var(--text-muted)]">Total Sales Order (SO)</span>
                    <p className="font-mono text-xl font-bold text-[var(--text)] tabular-nums">
                      {formatNumberPlain(totals.soCount)}
                    </p>
                    <span className="text-[11px] text-[var(--text-muted)] block truncate">
                      Nilai SO: {formatCompactIdr(totals.soTotalValue)}
                    </span>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <span className="text-xs text-[var(--text-muted)]">SO Memiliki WO &amp; Rasio</span>
                    <p className="font-mono text-xl font-bold text-[var(--accent)] tabular-nums">
                      {formatNumberPlain(totals.soLinkedToWo)}{' '}
                      <span className="text-sm font-semibold text-[var(--text-muted)]">
                        ({formatPct(totals.soCoveredPct)})
                      </span>
                    </p>
                    <span className="text-[11px] text-[var(--text-muted)] block tabular-nums">
                      Rasio Total WO ÷ SO: {formatPct(totals.woVsSoRatioPct)}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                  <BiGroupedColumnChart
                    title="Perbandingan Volume WO vs SO per Bulan"
                    subtitle="Bandingkan jumlah dokumen Total WO, WO Terhubung SO, Total SO, dan SO Memiliki WO."
                    months={monthHeaders}
                    metrics={compMetrics}
                    formatAxisTick={(v) => formatNumberPlain(Math.round(v))}
                    formatExactValue={(v) => `${formatNumberPlain(Math.round(v))} dok`}
                  />
                  <BiVerticalSingleChart
                    title={ratioTitle}
                    subtitle="Pilih bentuk diagram (Balok, Kerucut, Silinder, Horizontal, Garis, Area) sesuai kebutuhan."
                    legendLabel={ratioTitle}
                    data={ratioSeries}
                    formatAxisTick={(v) => `${formatDecimal(v, 0)}%`}
                    shape="column"
                  />
                </div>

                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-[var(--border)]">
                    <h4 className="font-display text-sm font-bold text-[var(--text)]">
                      Tabel Perbandingan Work Order (WO) vs Sales Order (SO) Bulanan
                    </h4>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                          <th className="text-left font-semibold px-4 py-2.5">Bulan</th>
                          <th className="text-right font-semibold px-3 py-2.5">Total WO</th>
                          <th className="text-right font-semibold px-3 py-2.5">WO Terhubung SO</th>
                          <th className="text-right font-semibold px-3 py-2.5">WO Tanpa SO</th>
                          <th className="text-right font-semibold px-3 py-2.5">Total SO</th>
                          <th className="text-right font-semibold px-3 py-2.5">SO Memiliki WO</th>
                          <th className="text-right font-semibold px-3 py-2.5">% WO → SO</th>
                          <th className="text-right font-semibold px-4 py-2.5">Rasio WO/SO</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {activeMonths.map((m) => (
                          <tr key={m.month} className="hover:bg-[var(--bg)]/60">
                            <td className="px-4 py-2.5 font-medium text-[var(--text)]">
                              {formatMonthShort(m.month)}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                              {formatNumberPlain(m.woCount)}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono tabular-nums font-semibold text-[var(--accent)]">
                              {formatNumberPlain(m.woLinkedToSoCount)}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text-muted)]">
                              {formatNumberPlain(m.woUnlinkedCount)}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                              {formatNumberPlain(m.soCount)}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                              {formatNumberPlain(m.soLinkedToWoCount)}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono tabular-nums font-bold text-[var(--accent)]">
                              {m.woToSoPct !== null ? formatPct(m.woToSoPct) : '—'}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                              {m.woVsSoRatioPct !== null ? formatPct(m.woVsSoRatioPct) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="bg-[var(--bg)] border-t border-[var(--border)] font-bold">
                          <td className="px-4 py-2.5 text-[var(--text)]">Total Periode</td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                            {formatNumberPlain(totals.woCount)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--accent)]">
                            {formatNumberPlain(totals.woLinkedToSo)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text-muted)]">
                            {formatNumberPlain(totals.woUnlinked)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                            {formatNumberPlain(totals.soCount)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                            {formatNumberPlain(totals.soLinkedToWo)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--accent)]">
                            {totals.woCount > 0 ? formatPct(totals.woToSoPct) : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                            {totals.soCount > 0 ? formatPct(totals.woVsSoRatioPct) : '—'}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                {(data.woSoLinks || []).length > 0 ? (
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-[var(--border)] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Link2 className="w-4 h-4 text-[var(--accent)] shrink-0" />
                        <h4 className="font-display text-sm font-bold text-[var(--text)]">
                          Daftar Tautan Dokumen WO ↔ SO ({filteredWoSoLinks.length})
                        </h4>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
                          {(['all', 'linked', 'unlinked'] as const).map((f) => (
                            <button
                              key={f}
                              type="button"
                              onClick={() => setLinkFilter(f)}
                              className={`px-2 py-1 text-[11px] font-medium rounded-md cursor-pointer ${
                                linkFilter === f
                                  ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                              }`}
                            >
                              {f === 'all' ? 'Semua' : f === 'linked' ? 'Terkait SO' : 'Tanpa SO'}
                            </button>
                          ))}
                        </div>
                        <div className="relative">
                          <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                          <input
                            type="text"
                            value={linkSearch}
                            onChange={(e) => setLinkSearch(e.target.value)}
                            placeholder="Cari No. WO / SO / customer..."
                            className="pl-8 pr-3 py-1.5 w-48 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="overflow-x-auto max-h-[420px]">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 z-10">
                          <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                            <th className="text-left font-semibold px-4 py-2.5">No. WO</th>
                            <th className="text-left font-semibold px-3 py-2.5">Tgl WO</th>
                            <th className="text-left font-semibold px-3 py-2.5">Status WO</th>
                            <th className="text-right font-semibold px-3 py-2.5">Qty WO</th>
                            <th className="text-left font-semibold px-3 py-2.5">No. SO Terkait</th>
                            <th className="text-left font-semibold px-3 py-2.5">Pelanggan</th>
                            <th className="text-right font-semibold px-4 py-2.5">Nilai SO</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                          {filteredWoSoLinks.map((row, idx) => (
                            <tr key={`${row.woDocNo}-${idx}`} className="hover:bg-[var(--bg)]/60">
                              <td className="px-4 py-2 font-mono font-medium text-[var(--text)]">
                                {row.woDocNo}
                              </td>
                              <td className="px-3 py-2 font-mono text-[var(--text-muted)]">
                                {row.woDate || '—'}
                              </td>
                              <td className="px-3 py-2 text-[var(--text-muted)]">
                                {row.woStatusLabel}
                              </td>
                              <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--text)]">
                                {formatNumberPlain(row.woQty)}
                              </td>
                              <td className="px-3 py-2 font-mono font-semibold">
                                {row.isLinkedToSo ? (
                                  <span className="text-[var(--accent)]">{row.soDocNo}</span>
                                ) : (
                                  <span className="text-[var(--text-muted)]">Belum terkait SO</span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-[var(--text)]">
                                {row.customerName || '—'}
                              </td>
                              <td className="px-4 py-2 text-right font-mono tabular-nums text-[var(--text)]">
                                {row.soTotalValue > 0 ? formatIdr(row.soTotalValue) : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  renderSchemaDiscoveryPanel(true)
                )}
              </>
            );
          })()}

          {/* ==================== KPI 02: TARGET WO vs OUTPUT AKTUAL ==================== */}
          {mode === 'wo_realization' && (() => {
            const metrics: GroupedMetricDef[] = [
              {
                key: 'planned',
                label: 'Target WO (Qty)',
                color: '#0284C7',
                valuesByMonth: Object.fromEntries(activeMonths.map((m) => [m.month, m.plannedQty])),
              },
              {
                key: 'actual',
                label: 'Output Aktual (Qty)',
                color: '#0F766E',
                valuesByMonth: Object.fromEntries(
                  activeMonths.map((m) => [m.month, m.actualOutputQty])
                ),
              },
            ];

            return (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <span className="text-xs text-[var(--text-muted)]">Pencapaian Target WO</span>
                    <p className="font-mono text-xl font-bold tabular-nums text-[var(--accent)]">
                      {formatPct(totals.achievementPct)}
                    </p>
                    <span className="text-[11px] text-[var(--text-muted)] block">
                      Output Aktual ÷ Target WO
                    </span>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <span className="text-xs text-[var(--text-muted)]">Total Target WO</span>
                    <p className="font-mono text-xl font-bold tabular-nums text-[var(--text)]">
                      {formatNumberPlain(totals.plannedQty)}
                    </p>
                    <span className="text-[11px] text-[var(--text-muted)] block">
                      Tabel: {data.diagnostics.workOrderTable || '—'}
                    </span>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <span className="text-xs text-[var(--text-muted)]">Total Output Aktual</span>
                    <p className="font-mono text-xl font-bold tabular-nums text-[var(--accent)]">
                      {formatNumberPlain(totals.actualOutputQty)}
                    </p>
                    <span className="text-[11px] text-[var(--text-muted)] block">
                      Tabel: {data.diagnostics.outputTable || data.diagnostics.workOrderTable || '—'}
                    </span>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <span className="text-xs text-[var(--text-muted)]">Total Dokumen WO</span>
                    <p className="font-mono text-xl font-bold tabular-nums text-[var(--text)]">
                      {formatNumberPlain(totals.woCount)}
                    </p>
                    <span className="text-[11px] text-[var(--text-muted)] block">
                      Dokumen aktif non-void
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                  <BiGroupedColumnChart
                    title="Target WO vs Output Aktual per Bulan"
                    subtitle="Perbandingan volume rencana produksi dengan realisasi output."
                    months={monthHeaders}
                    metrics={metrics}
                    formatAxisTick={(v) => formatNumberPlain(Math.round(v))}
                    formatExactValue={(v) => `${formatNumberPlain(Math.round(v))} unit`}
                  />
                  <BiVerticalSingleChart
                    title="Persentase Pencapaian Output (%)"
                    subtitle="Rasio Output Aktual terhadap Target WO setiap bulan."
                    legendLabel="Pencapaian (%)"
                    data={activeMonths.map((m) => ({
                      key: m.month,
                      label: formatMonthShort(m.month),
                      value: m.achievementPct ?? 0,
                      valueLabel: formatPct(m.achievementPct ?? 0),
                      hoverSummary: `Output: ${formatNumberPlain(m.actualOutputQty)} / Target: ${formatNumberPlain(m.plannedQty)} unit`,
                    }))}
                    formatAxisTick={(v) => `${formatDecimal(v, 0)}%`}
                    shape="column"
                  />
                </div>

                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-[var(--border)]">
                    <h4 className="font-display text-sm font-bold text-[var(--text)]">
                      Tabel Perbandingan Target WO vs Output Aktual Bulanan
                    </h4>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                          <th className="text-left font-semibold px-4 py-2.5">Bulan</th>
                          <th className="text-right font-semibold px-3 py-2.5">Jml WO</th>
                          <th className="text-right font-semibold px-3 py-2.5">Target Qty</th>
                          <th className="text-right font-semibold px-3 py-2.5">Output Aktual</th>
                          <th className="text-right font-semibold px-4 py-2.5">Pencapaian (%)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {activeMonths.map((m) => (
                          <tr key={m.month} className="hover:bg-[var(--bg)]/60">
                            <td className="px-4 py-2.5 font-medium text-[var(--text)]">
                              {formatMonthShort(m.month)}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                              {formatNumberPlain(m.woCount)}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                              {formatNumberPlain(m.plannedQty)}
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                              {formatNumberPlain(m.actualOutputQty)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono tabular-nums font-bold text-[var(--accent)]">
                              {m.achievementPct !== null ? formatPct(m.achievementPct) : '—'}
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

          {/* ==================== KPI 03: WO TIDAK TERPENUHI / BACKLOG ==================== */}
          {mode === 'wo_unfulfilled' && (() => {
            const metrics: GroupedMetricDef[] = [
              {
                key: 'planned',
                label: 'Target WO (Qty)',
                color: '#0284C7',
                valuesByMonth: Object.fromEntries(activeMonths.map((m) => [m.month, m.plannedQty])),
              },
              {
                key: 'unfulfilled',
                label: 'Belum Terpenuhi (Qty)',
                color: '#D97706',
                valuesByMonth: Object.fromEntries(
                  activeMonths.map((m) => [m.month, Math.max(0, m.plannedQty - m.actualOutputQty)])
                ),
              },
            ];

            return (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <span className="text-xs text-[var(--text-muted)]">Qty Belum Terpenuhi</span>
                    <p className="font-mono text-xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
                      {formatNumberPlain(totals.unfulfilledQty)}
                    </p>
                    <span className="text-[11px] text-[var(--text-muted)] block">
                      Dari {formatNumberPlain(totals.plannedQty)} target unit
                    </span>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <span className="text-xs text-[var(--text-muted)]">% Belum Terpenuhi</span>
                    <p className="font-mono text-xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
                      {formatPct(totals.unfulfilledPct)}
                    </p>
                    <span className="text-[11px] text-[var(--text-muted)] block">
                      (Target − Output) ÷ Target
                    </span>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <span className="text-xs text-[var(--text-muted)]">Backlog WO Terbuka</span>
                    <p className="font-mono text-xl font-bold tabular-nums text-[var(--text)]">
                      {formatNumberPlain(data.openWorkOrders.length)}
                    </p>
                    <span className="text-[11px] text-[var(--text-muted)] block">
                      Dokumen belum Complete/Close
                    </span>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <span className="text-xs text-[var(--text-muted)]">WO Sedang Berjalan (WIP)</span>
                    <p className="font-mono text-xl font-bold tabular-nums text-[var(--accent)]">
                      {formatNumberPlain(totals.woInProgress)}
                    </p>
                    <span className="text-[11px] text-[var(--text-muted)] block">
                      Open/Draft: {formatNumberPlain(totals.woOpen)}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                  <BiGroupedColumnChart
                    title="Target WO vs Sisa Belum Terpenuhi per Bulan"
                    subtitle="Perbandingan volume rencana produksi terhadap sisa yang belum selesai."
                    months={monthHeaders}
                    metrics={metrics}
                    formatAxisTick={(v) => formatNumberPlain(Math.round(v))}
                    formatExactValue={(v) => `${formatNumberPlain(Math.round(v))} unit`}
                  />
                  <BiHorizontalBarChart
                    title="Persentase WO Belum Terpenuhi (%)"
                    subtitle="Rasio sisa kuantitas belum terpenuhi terhadap target bulanan."
                    legendLabel="Belum Terpenuhi (%)"
                    data={activeMonths.map((m) => {
                      const unful = Math.max(0, m.plannedQty - m.actualOutputQty);
                      const pct = m.plannedQty > 0 ? (unful / m.plannedQty) * 100 : 0;
                      return {
                        key: m.month,
                        label: formatMonthShort(m.month),
                        value: pct,
                        valueLabel: formatPct(pct),
                        hoverSummary: `Belum terpenuhi: ${formatNumberPlain(unful)} / ${formatNumberPlain(m.plannedQty)} unit`,
                      };
                    })}
                    formatAxisTick={(v) => `${formatDecimal(v, 0)}%`}
                  />
                </div>

                {data.openWorkOrders.length > 0 && (
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-[var(--border)]">
                      <h4 className="font-display text-sm font-bold text-[var(--text)]">
                        Daftar Backlog Work Order / SPK Terbuka ({data.openWorkOrders.length})
                      </h4>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-[var(--bg)] text-[var(--text-muted)] border-b border-[var(--border)]">
                            <th className="text-left px-4 py-2.5 font-semibold">No. Dokumen</th>
                            <th className="text-left px-3 py-2.5 font-semibold">Tanggal</th>
                            <th className="text-left px-3 py-2.5 font-semibold">Produk</th>
                            <th className="text-right px-3 py-2.5 font-semibold">Target</th>
                            <th className="text-right px-3 py-2.5 font-semibold">Realisasi</th>
                            <th className="text-left px-3 py-2.5 font-semibold">Status</th>
                            <th className="text-right px-4 py-2.5 font-semibold">Umur</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                          {data.openWorkOrders.map((wo, idx) => (
                            <tr key={`${wo.docNo}-${idx}`} className="hover:bg-[var(--bg)]/60">
                              <td className="px-4 py-2.5 font-mono font-medium text-[var(--text)]">
                                {wo.docNo}
                              </td>
                              <td className="px-3 py-2.5 font-mono text-[var(--text-muted)]">
                                {wo.date}
                              </td>
                              <td className="px-3 py-2.5 text-[var(--text)]">{wo.itemName}</td>
                              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                                {formatNumberPlain(wo.plannedQty)}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--accent)]">
                                {formatNumberPlain(wo.actualQty)}
                              </td>
                              <td className="px-3 py-2.5 text-[var(--text-muted)]">
                                {wo.statusLabel}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono tabular-nums text-amber-600 dark:text-amber-400">
                                {wo.ageDays} hr
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

          {/* ==================== KPI 04: WO COMPLETE vs TOTAL WO ==================== */}
          {mode === 'wo_complete_ratio' && (() => {
            const totalComp =
              completeBasis === 'complete_only' ? totals.woCompleteOnly : totals.woComplete;
            const compRate = totals.woCount > 0 ? (totalComp / totals.woCount) * 100 : 0;

            const statusMetrics: GroupedMetricDef[] = [
              {
                key: 'complete',
                label: completeBasis === 'complete_only' ? 'WO Complete (4)' : 'WO Complete/Close',
                color: '#0F766E',
                valuesByMonth: Object.fromEntries(
                  activeMonths.map((m) => [
                    m.month,
                    completeBasis === 'complete_only' ? m.woCompleteOnlyCount : m.woCompleteCount,
                  ])
                ),
              },
              {
                key: 'wip',
                label: 'In Progress (WIP)',
                color: '#0284C7',
                valuesByMonth: Object.fromEntries(
                  activeMonths.map((m) => [m.month, m.woInProgressCount])
                ),
              },
              {
                key: 'open',
                label: 'Open / Draft',
                color: '#D97706',
                valuesByMonth: Object.fromEntries(
                  activeMonths.map((m) => [m.month, m.woOpenCount])
                ),
              },
            ];

            return (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <span className="text-xs text-[var(--text-muted)]">Rasio WO Complete</span>
                    <p className="font-mono text-xl font-bold tabular-nums text-[var(--accent)]">
                      {formatPct(compRate)}
                    </p>
                    <span className="text-[11px] text-[var(--text-muted)] block tabular-nums">
                      {formatNumberPlain(totalComp)} dari {formatNumberPlain(totals.woCount)} WO
                    </span>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <span className="text-xs text-[var(--text-muted)]">WO Complete</span>
                    <p className="font-mono text-xl font-bold tabular-nums text-[var(--text)]">
                      {formatNumberPlain(totalComp)}
                    </p>
                    <span className="text-[11px] text-[var(--text-muted)] block">
                      {completeBasis === 'complete_only' ? 'Status 4 saja' : 'Status 4 & 7'}
                    </span>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <span className="text-xs text-[var(--text-muted)]">Sedang Berjalan (WIP)</span>
                    <p className="font-mono text-xl font-bold tabular-nums text-sky-600 dark:text-sky-400">
                      {formatNumberPlain(totals.woInProgress)}
                    </p>
                    <span className="text-[11px] text-[var(--text-muted)] block">Status In Progress</span>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <span className="text-xs text-[var(--text-muted)]">Belum Dijalankan (Open)</span>
                    <p className="font-mono text-xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
                      {formatNumberPlain(totals.woOpen)}
                    </p>
                    <span className="text-[11px] text-[var(--text-muted)] block">Draft / Approved</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                  <BiGroupedColumnChart
                    title="Perbandingan Status WO per Bulan"
                    subtitle="Jumlah WO Complete vs In Progress (WIP) vs Open/Draft."
                    months={monthHeaders}
                    metrics={statusMetrics}
                    formatAxisTick={(v) => formatNumberPlain(Math.round(v))}
                    formatExactValue={(v) => `${formatNumberPlain(Math.round(v))} WO`}
                  />
                  <BiVerticalSingleChart
                    title="Persentase Penyelesaian WO per Bulan (%)"
                    subtitle="Rasio dokumen WO Complete terhadap total WO setiap bulan."
                    legendLabel="WO Complete (%)"
                    data={activeMonths.map((m) => {
                      const comp =
                        completeBasis === 'complete_only'
                          ? m.woCompleteOnlyCount
                          : m.woCompleteCount;
                      const pct = m.woCount > 0 ? (comp / m.woCount) * 100 : 0;
                      return {
                        key: m.month,
                        label: formatMonthShort(m.month),
                        value: pct,
                        valueLabel: formatPct(pct),
                        hoverSummary: `Complete: ${comp} / ${m.woCount} WO · WIP: ${m.woInProgressCount} · Open: ${m.woOpenCount}`,
                      };
                    })}
                    formatAxisTick={(v) => `${formatDecimal(v, 0)}%`}
                    shape="column"
                  />
                </div>

                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-[var(--border)]">
                    <h4 className="font-display text-sm font-bold text-[var(--text)]">
                      Tabel Perbandingan Status WO Bulanan
                    </h4>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                          <th className="text-left font-semibold px-4 py-2.5">Bulan</th>
                          <th className="text-right font-semibold px-3 py-2.5">Total WO</th>
                          <th className="text-right font-semibold px-3 py-2.5">WO Complete</th>
                          <th className="text-right font-semibold px-3 py-2.5">WIP</th>
                          <th className="text-right font-semibold px-3 py-2.5">Open</th>
                          <th className="text-right font-semibold px-4 py-2.5">Completion (%)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {activeMonths.map((m) => {
                          const comp =
                            completeBasis === 'complete_only'
                              ? m.woCompleteOnlyCount
                              : m.woCompleteCount;
                          const pct = m.woCount > 0 ? (comp / m.woCount) * 100 : 0;
                          return (
                            <tr key={m.month} className="hover:bg-[var(--bg)]/60">
                              <td className="px-4 py-2.5 font-medium text-[var(--text)]">
                                {formatMonthShort(m.month)}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                                {formatNumberPlain(m.woCount)}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--accent)] font-semibold">
                                {formatNumberPlain(comp)}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                                {formatNumberPlain(m.woInProgressCount)}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text-muted)]">
                                {formatNumberPlain(m.woOpenCount)}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono tabular-nums font-bold text-[var(--accent)]">
                                {formatPct(pct)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            );
          })()}

          {/* ==================== KPI 05: PERBANDINGAN BIAYA PRODUKSI (GL & HPP) ==================== */}
          {mode === 'production_cost' && (() => {
            const avgUnitCost =
              totals.actualOutputQty > 0 ? totals.glTotal / totals.actualOutputQty : null;

            const metrics: GroupedMetricDef[] = [
              {
                key: 'mat',
                label: 'Bahan Baku',
                color: '#0F766E',
                valuesByMonth: Object.fromEntries(
                  activeMonths.map((m) => [m.month, m.glMaterialCost])
                ),
              },
              {
                key: 'lab',
                label: 'Tenaga Kerja',
                color: '#0284C7',
                valuesByMonth: Object.fromEntries(
                  activeMonths.map((m) => [m.month, m.glLaborCost])
                ),
              },
              {
                key: 'ovh',
                label: 'Overhead Pabrik',
                color: '#D97706',
                valuesByMonth: Object.fromEntries(
                  activeMonths.map((m) => [m.month, m.glOverheadCost])
                ),
              },
              {
                key: 'other',
                label: 'Biaya Produksi Lain',
                color: '#64748B',
                valuesByMonth: Object.fromEntries(
                  activeMonths.map((m) => [m.month, m.glOtherProdCost])
                ),
              },
            ];

            const groupBars: HorizontalBarDatum[] = [
              {
                key: 'mat',
                label: 'Bahan Baku',
                value: totals.glMat,
                valueLabel: formatCompactIdr(totals.glMat),
                hoverSummary: `Bahan Baku: ${formatIdr(totals.glMat)} (${totals.glTotal > 0 ? ((totals.glMat / totals.glTotal) * 100).toFixed(1) : '0.0'}%)`,
              },
              {
                key: 'lab',
                label: 'Tenaga Kerja',
                value: totals.glLab,
                valueLabel: formatCompactIdr(totals.glLab),
                hoverSummary: `Tenaga Kerja: ${formatIdr(totals.glLab)} (${totals.glTotal > 0 ? ((totals.glLab / totals.glTotal) * 100).toFixed(1) : '0.0'}%)`,
              },
              {
                key: 'ovh',
                label: 'Overhead Pabrik',
                value: totals.glOvh,
                valueLabel: formatCompactIdr(totals.glOvh),
                hoverSummary: `Overhead Pabrik: ${formatIdr(totals.glOvh)} (${totals.glTotal > 0 ? ((totals.glOvh / totals.glTotal) * 100).toFixed(1) : '0.0'}%)`,
              },
              {
                key: 'oth',
                label: 'Produksi Lain',
                value: totals.glOther,
                valueLabel: formatCompactIdr(totals.glOther),
                hoverSummary: `Biaya Produksi Lainnya: ${formatIdr(totals.glOther)}`,
              },
            ];

            return (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <span className="text-xs text-[var(--text-muted)]">Total Biaya Produksi / HPP (GL)</span>
                    <p className="font-mono text-xl font-bold tabular-nums text-[var(--accent)]">
                      {formatCompactIdr(totals.glTotal)}
                    </p>
                    <span className="text-[11px] font-mono tabular-nums text-[var(--text-muted)] block truncate">
                      {formatIdr(totals.glTotal)}
                    </span>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <span className="text-xs text-[var(--text-muted)]">Komponen Bahan Baku</span>
                    <p className="font-mono text-xl font-bold tabular-nums text-[var(--text)]">
                      {formatCompactIdr(totals.glMat)}
                    </p>
                    <span className="text-[11px] text-[var(--text-muted)] block tabular-nums">
                      Porsi {totals.glTotal > 0 ? formatPct((totals.glMat / totals.glTotal) * 100) : '0,00%'}
                    </span>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <span className="text-xs text-[var(--text-muted)]">Tenaga Kerja &amp; Overhead</span>
                    <p className="font-mono text-xl font-bold tabular-nums text-[var(--text)]">
                      {formatCompactIdr(totals.glLab + totals.glOvh)}
                    </p>
                    <span className="text-[11px] text-[var(--text-muted)] block tabular-nums">
                      TKL: {formatCompactIdr(totals.glLab)} · OVH: {formatCompactIdr(totals.glOvh)}
                    </span>
                  </div>
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                    <span className="text-xs text-[var(--text-muted)]">Biaya Produksi / Unit</span>
                    <p className="font-mono text-xl font-bold tabular-nums text-[var(--text)]">
                      {avgUnitCost !== null ? formatCompactIdr(avgUnitCost) : '—'}
                    </p>
                    <span className="text-[11px] text-[var(--text-muted)] block">
                      {avgUnitCost !== null
                        ? `Output: ${formatNumberPlain(totals.actualOutputQty)} unit`
                        : 'Aktif otomatis saat output produksi tercatat'}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                  <BiGroupedColumnChart
                    title="Perbandingan Komponen Biaya Produksi Bulanan (GL)"
                    subtitle="Sumber: Buku Besar ERP (akun HPP, Produksi & Overhead)"
                    months={monthHeaders}
                    metrics={metrics}
                    formatAxisTick={formatCompactIdr}
                    formatExactValue={formatIdr}
                  />
                  <BiHorizontalBarChart
                    title="Proporsi Struktur Biaya Produksi Periode"
                    subtitle="Distribusi total biaya manufaktur & HPP menurut kelompok biaya"
                    legendLabel="Biaya Produksi (Rp)"
                    data={[...groupBars].reverse()}
                    formatAxisTick={formatCompactIdr}
                  />
                </div>

                {data.glProductionAccounts.length > 0 && (
                  <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-[var(--border)]">
                      <h4 className="font-display text-sm font-bold text-[var(--text)]">
                        Rincian Akun Biaya Produksi &amp; HPP ({data.glProductionAccounts.length} Akun GL)
                      </h4>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-[var(--bg)] text-[var(--text-muted)] border-b border-[var(--border)]">
                            <th className="text-left px-4 py-2.5 font-semibold">No. Akun</th>
                            <th className="text-left px-3 py-2.5 font-semibold">Nama Akun</th>
                            <th className="text-left px-3 py-2.5 font-semibold">Kelompok Biaya</th>
                            <th className="text-right px-3 py-2.5 font-semibold">Jml Jurnal</th>
                            <th className="text-right px-4 py-2.5 font-semibold">Total Biaya (Rp)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                          {data.glProductionAccounts.map((acc) => (
                            <tr key={acc.accountNo} className="hover:bg-[var(--bg)]/60">
                              <td className="px-4 py-2.5 font-mono text-[var(--text-muted)]">
                                {acc.accountNo}
                              </td>
                              <td className="px-3 py-2.5 font-medium text-[var(--text)]">
                                {acc.accountName}
                              </td>
                              <td className="px-3 py-2.5 text-[var(--text-muted)]">
                                {acc.costGroup}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text-muted)]">
                                {formatNumberPlain(acc.entryCount)}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono font-semibold tabular-nums text-[var(--text)]">
                                {formatIdr(acc.amountIdr)}
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
        </div>
      )}
    </div>
  );
};
