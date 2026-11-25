import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import {
  BiHorizontalBarChart,
  BiKpiHeaderAndFilter,
  BiKpiStateViews,
  BiLineChart,
  BiVerticalSingleChart,
} from './BiFinanceChartPrimitives';
import {
  downloadCsvFile,
  formatDecimal,
  formatMonthFull,
  formatMonthShort,
  formatNumberPlain,
  formatPct,
  useBiSalesPeriodData,
} from './biSalesShared';

export type SalesDeliveryReturnKpiMode =
  | 'delivery_on_time'
  | 'sales_return'
  | 'order_mismatch'
  | 'delivery_lead_time';

interface BiSalesDeliveryReturnKpiProps {
  mode: SalesDeliveryReturnKpiMode;
  idToken: string | null;
  onDownloadBridge?: () => void;
}

const META: Record<
  SalesDeliveryReturnKpiMode,
  { category: string; chartTypeLabel: string; title: string; description: string }
> = {
  delivery_on_time: {
    category: 'Pengiriman & Retur',
    chartTypeLabel: 'Diagram Garis (Line Chart)',
    title: '09. Delivery On Time',
    description:
      'Persentase faktur/pengiriman tepat waktu sesuai target tanggal kirim Sales Order (SO) per bulan.',
  },
  sales_return: {
    category: 'Pengiriman & Retur',
    chartTypeLabel: 'Diagram Batang Horizontal',
    title: '10. Retur Penjualan (Sales Return)',
    description:
      'Persentase retur penjualan terhadap total penjualan bulanan lengkap dengan rincian per barang pada bulan terpilih.',
  },
  order_mismatch: {
    category: 'Pengiriman & Retur',
    chartTypeLabel: 'Diagram Batang Horizontal',
    title: '10B. Barang Tidak Sesuai Pesanan',
    description:
      'Persentase barang tidak sesuai pesanan terhadap total pengiriman bulanan beserta rincian per barang.',
  },
  delivery_lead_time: {
    category: 'Pengiriman & Retur',
    chartTypeLabel: 'Matriks Lead Time 0–14 Hari',
    title: '11. Pengiriman Barang (Delivery Order)',
    description:
      'Distribusi waktu tunggu pengiriman (0 Hari hingga 14 Hari dan >14 Hari) dari tanggal Sales Order ke tanggal Delivery Order per barang.',
  },
};

const LEAD_TIME_LABELS = [
  '0 Hari',
  '1 Hari',
  '2 Hari',
  '3 Hari',
  '4 Hari',
  '5 Hari',
  '6 Hari',
  '7 Hari',
  '8 Hari',
  '9 Hari',
  '10 Hari',
  '11 Hari',
  '12 Hari',
  '13 Hari',
  '14 Hari',
  '>14 Hari',
];

export const BiSalesDeliveryReturnKpi: React.FC<BiSalesDeliveryReturnKpiProps> = ({
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
    monthlyRows,
    loading,
    refreshing,
    errorMsg,
    cutoffWarning,
    fetchSalesBiData,
    handleResetActivePeriod,
  } = useBiSalesPeriodData(idToken);

  const [dotDocType, setDotDocType] = useState<'iv' | 'do'>('iv');
  const [dotScope, setDotScope] = useState<'all' | 'linked_only'>('all');
  const [returnBasis, setReturnBasis] = useState<'item_qty' | 'doc_count'>('item_qty');
  const [mismatchBasis, setMismatchBasis] = useState<'return_vs_do' | 'do_so_variance'>('return_vs_do');
  const [selectedDetailMonth, setSelectedDetailMonth] = useState<string>('');
  const [itemSearch, setItemSearch] = useState<string>('');
  const [ltLimit, setLtLimit] = useState<number>(30);

  const meta = META[mode];

  useEffect(() => {
    if (mode !== 'sales_return' && mode !== 'order_mismatch') return;
    if (monthlyRows.length === 0) return;
    const stillValid = monthlyRows.some((r) => r.month === selectedDetailMonth);
    if (!stillValid) {
      setSelectedDetailMonth(monthlyRows[monthlyRows.length - 1].month);
    }
  }, [mode, monthlyRows, selectedDetailMonth]);

  // 09. Delivery On Time rows
  const dotRows = useMemo(() => {
    return monthlyRows.map((r) => {
      let onTime = 0;
      let total = 0;
      if (dotDocType === 'iv') {
        onTime = dotScope === 'all' ? r.ivOnTimeCount : r.ivLinkedOnTimeCount;
        total = dotScope === 'all' ? r.ivTotalCount : r.ivLinkedCount;
      } else {
        onTime = dotScope === 'all' ? r.doOnTimeCount : r.doLinkedOnTimeCount;
        total = dotScope === 'all' ? r.doTotalCount : r.doLinkedCount;
      }
      const pct = total > 0 ? (onTime / total) * 100 : 0;
      return { month: r.month, onTime, total, late: Math.max(0, total - onTime), pct };
    });
  }, [dotDocType, dotScope, monthlyRows]);

  const dotTotals = useMemo(() => {
    const onTime = dotRows.reduce((s, r) => s + r.onTime, 0);
    const total = dotRows.reduce((s, r) => s + r.total, 0);
    const late = Math.max(0, total - onTime);
    const pct = total > 0 ? (onTime / total) * 100 : 0;
    return { onTime, total, late, pct };
  }, [dotRows]);

  // 10. Retur Penjualan rows
  const returnRows = useMemo(() => {
    return monthlyRows.map((r) => {
      const ret = returnBasis === 'item_qty' ? r.returnItemQty : r.returnDocCount;
      const denom = returnBasis === 'item_qty' ? r.soldItemQty : r.ivTotalCount;
      const pct = denom > 0 ? (ret / denom) * 100 : 0;
      return { month: r.month, ret, denom, pct };
    });
  }, [monthlyRows, returnBasis]);

  const returnDetailItems = useMemo(() => {
    const raw = (selectedDetailMonth && data?.returnDetailsByMonth?.[selectedDetailMonth]) || [];
    const q = itemSearch.trim().toLowerCase();
    const filtered = q
      ? raw.filter(
          (i) =>
            i.itemCode.toLowerCase().includes(q) || i.itemName.toLowerCase().includes(q)
        )
      : raw;
    return filtered;
  }, [data?.returnDetailsByMonth, itemSearch, selectedDetailMonth]);

  const returnDetailTotals = useMemo(() => {
    const ret = returnDetailItems.reduce((s, i) => s + i.returnQty, 0);
    const sold = returnDetailItems.reduce((s, i) => s + i.soldQty, 0);
    return { ret, sold, pct: sold > 0 ? (ret / sold) * 100 : 0 };
  }, [returnDetailItems]);

  // 10B. Barang Tidak Sesuai Pesanan rows
  const mismatchRows = useMemo(() => {
    return monthlyRows.map((r) => {
      const mis =
        mismatchBasis === 'return_vs_do' ? r.mismatchFromReturnQty : r.mismatchFromVarianceQty;
      const deliv = r.deliveredItemQty;
      const pct = deliv > 0 ? (mis / deliv) * 100 : 0;
      return { month: r.month, mis, deliv, pct };
    });
  }, [mismatchBasis, monthlyRows]);

  const mismatchDetailItems = useMemo(() => {
    const raw = (selectedDetailMonth && data?.mismatchDetailsByMonth?.[selectedDetailMonth]) || [];
    const q = itemSearch.trim().toLowerCase();
    const mapped = raw.map((i) => ({
      itemId: i.itemId,
      itemCode: i.itemCode,
      itemName: i.itemName,
      mismatchQty:
        mismatchBasis === 'return_vs_do' ? i.mismatchReturnQty : i.mismatchVarianceQty,
      deliveredQty: i.deliveredQty,
      mismatchPct:
        mismatchBasis === 'return_vs_do' ? i.mismatchReturnPct : i.mismatchVariancePct,
    }));
    const sorted = mapped.sort(
      (a, b) => b.mismatchQty - a.mismatchQty || b.deliveredQty - a.deliveredQty
    );
    if (!q) return sorted;
    return sorted.filter(
      (i) =>
        i.itemCode.toLowerCase().includes(q) || i.itemName.toLowerCase().includes(q)
    );
  }, [data?.mismatchDetailsByMonth, itemSearch, mismatchBasis, selectedDetailMonth]);

  const mismatchDetailTotals = useMemo(() => {
    const mis = mismatchDetailItems.reduce((s, i) => s + i.mismatchQty, 0);
    const deliv = mismatchDetailItems.reduce((s, i) => s + i.deliveredQty, 0);
    return { mis, deliv, pct: deliv > 0 ? (mis / deliv) * 100 : 0 };
  }, [mismatchDetailItems]);

  // 11. Delivery Lead Time Matrix
  const filteredLeadTimeRows = useMemo(() => {
    const all = data?.deliveryLeadTime || [];
    const q = itemSearch.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (i) =>
        i.itemCode.toLowerCase().includes(q) || i.itemName.toLowerCase().includes(q)
    );
  }, [data?.deliveryLeadTime, itemSearch]);

  const displayedLeadTimeRows = useMemo(() => {
    if (ltLimit <= 0) return filteredLeadTimeRows;
    return filteredLeadTimeRows.slice(0, ltLimit);
  }, [filteredLeadTimeRows, ltLimit]);

  const leadTimeSummary = useMemo(() => {
    const bucketTotals = new Array<number>(16).fill(0);
    let totalDeliveries = 0;
    let weightedDays = 0;
    for (const r of filteredLeadTimeRows) {
      for (let i = 0; i < 16; i++) {
        bucketTotals[i] += r.buckets[i] || 0;
      }
      totalDeliveries += r.totalDeliveries;
      weightedDays += r.avgLeadDays * r.totalDeliveries;
    }
    const fastDeliveries = bucketTotals[0] + bucketTotals[1] + bucketTotals[2];
    const maxCell = Math.max(
      1,
      ...displayedLeadTimeRows.flatMap((r) => r.buckets)
    );
    return {
      bucketTotals,
      totalDeliveries,
      avgDays: totalDeliveries > 0 ? weightedDays / totalDeliveries : 0,
      fastPct: totalDeliveries > 0 ? (fastDeliveries / totalDeliveries) * 100 : 0,
      maxCell,
    };
  }, [displayedLeadTimeRows, filteredLeadTimeRows]);

  const hasRecords =
    mode === 'delivery_lead_time'
      ? (data?.deliveryLeadTime?.length || 0) > 0
      : monthlyRows.length > 0;

  const noticeMessage = useMemo(() => {
    const parts: string[] = [];
    if (cutoffWarning) {
      parts.push(`Periode transaksi aktif MyERP Plus dimulai sejak ${cutoffWarning}.`);
    }
    if (mode === 'delivery_on_time' && data?.diagnostics?.dotSource) {
      const label =
        data.diagnostics.dotSource === 'so_sotglkirim'
          ? 'Target tanggal kirim Sales Order'
          : data.diagnostics.dotSource === 'so_sotgl'
            ? 'Tanggal Sales Order'
            : 'Tanggal dokumen pengiriman';
      parts.push(`Patokan tepat waktu: ${label}.`);
    }
    if (mode === 'sales_return' || mode === 'order_mismatch') {
      parts.push(
        'Klik baris bulan pada tabel ringkasan di kiri untuk melihat rincian per barang pada panel Detail.'
      );
    }
    return parts.length > 0 ? parts.join(' ') : null;
  }, [cutoffWarning, data?.diagnostics?.dotSource, mode]);

  const handleExportCsv = () => {
    const suffix = `${selectedYear}_${String(effectiveStart).padStart(2, '0')}-${String(effectiveEnd).padStart(2, '0')}`;
    if (mode === 'delivery_on_time') {
      const lbl = dotDocType === 'iv' ? 'IV' : 'DO';
      downloadCsvFile(
        `bi_sales_09_delivery_on_time_${suffix}.csv`,
        ['Bulan', `Jml ${lbl} Tepat Waktu`, `Jml ${lbl}`, 'Delivery On Time (%)'],
        dotRows.map((r) => [formatMonthShort(r.month), r.onTime, r.total, r.pct.toFixed(2)])
      );
    } else if (mode === 'sales_return') {
      downloadCsvFile(
        `bi_sales_10_retur_penjualan_${selectedDetailMonth || suffix}.csv`,
        ['Kode Barang', 'Nama Barang', 'Jml Retur', 'Jml Jual', 'Retur Penjualan (%)'],
        returnDetailItems.map((i) => [
          i.itemCode,
          i.itemName,
          i.returnQty,
          i.soldQty,
          i.returnPct.toFixed(2),
        ])
      );
    } else if (mode === 'order_mismatch') {
      downloadCsvFile(
        `bi_sales_10B_tidak_sesuai_pesanan_${selectedDetailMonth || suffix}.csv`,
        ['Kode Barang', 'Nama Barang', 'Jml Tidak Sesuai Pesanan', 'Jml Pengiriman', 'Tidak Sesuai Pesanan (%)'],
        mismatchDetailItems.map((i) => [
          i.itemCode,
          i.itemName,
          i.mismatchQty,
          i.deliveredQty,
          i.mismatchPct.toFixed(2),
        ])
      );
    } else {
      downloadCsvFile(
        `bi_sales_11_pengiriman_do_leadtime_${suffix}.csv`,
        ['Kode Barang', 'Nama Barang', ...LEAD_TIME_LABELS, 'Total Kirim', 'Rata-rata (Hari)'],
        displayedLeadTimeRows.map((r) => [
          r.itemCode,
          r.itemName,
          ...r.buckets,
          r.totalDeliveries,
          r.avgLeadDays.toFixed(2),
        ])
      );
    }
  };

  const extraControls = (
    <>
      {mode === 'delivery_on_time' && (
        <div className="flex flex-wrap items-end gap-2 ml-auto">
          <div className="space-y-1">
            <span className="block text-[11px] font-medium text-[var(--text-muted)]">
              Dokumen Evaluasi
            </span>
            <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
              <button
                type="button"
                onClick={() => setDotDocType('iv')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md cursor-pointer whitespace-nowrap ${
                  dotDocType === 'iv'
                    ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                Faktur Penjualan (IV)
              </button>
              <button
                type="button"
                onClick={() => setDotDocType('do')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md cursor-pointer whitespace-nowrap ${
                  dotDocType === 'do'
                    ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                Surat Jalan (DO)
              </button>
            </div>
          </div>
          <div className="space-y-1">
            <span className="block text-[11px] font-medium text-[var(--text-muted)]">
              Cakupan
            </span>
            <select
              value={dotScope}
              onChange={(e) => setDotScope(e.target.value as 'all' | 'linked_only')}
              className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] cursor-pointer"
            >
              <option value="all">Semua Dokumen</option>
              <option value="linked_only">Hanya Terhubung SO</option>
            </select>
          </div>
        </div>
      )}

      {mode === 'sales_return' && (
        <div className="space-y-1 ml-auto">
          <span className="block text-[11px] font-medium text-[var(--text-muted)]">
            Basis Ringkasan Bulanan
          </span>
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
            <button
              type="button"
              onClick={() => setReturnBasis('item_qty')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md cursor-pointer whitespace-nowrap ${
                returnBasis === 'item_qty'
                  ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              Qty Unit Barang (Sinkron Detail)
            </button>
            <button
              type="button"
              onClick={() => setReturnBasis('doc_count')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md cursor-pointer whitespace-nowrap ${
                returnBasis === 'doc_count'
                  ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              Jumlah Dokumen (SR ÷ IV)
            </button>
          </div>
        </div>
      )}

      {mode === 'order_mismatch' && (
        <div className="space-y-1 ml-auto">
          <span className="block text-[11px] font-medium text-[var(--text-muted)]">
            Basis Ketidaksesuaian
          </span>
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
            <button
              type="button"
              onClick={() => setMismatchBasis('return_vs_do')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md cursor-pointer whitespace-nowrap ${
                mismatchBasis === 'return_vs_do'
                  ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              Retur atas Pengiriman (SR ÷ DO)
            </button>
            <button
              type="button"
              onClick={() => setMismatchBasis('do_so_variance')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md cursor-pointer whitespace-nowrap ${
                mismatchBasis === 'do_so_variance'
                  ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              Selisih Qty DO vs SO
            </button>
          </div>
        </div>
      )}

      {mode === 'delivery_lead_time' && (
        <div className="flex flex-wrap items-end gap-2 ml-auto">
          <div className="space-y-1">
            <span className="block text-[11px] font-medium text-[var(--text-muted)]">
              Cari Barang
            </span>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                placeholder="Kode / nama barang..."
                className="pl-8 pr-3 py-1.5 w-44 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>
          </div>
          <div className="space-y-1">
            <span className="block text-[11px] font-medium text-[var(--text-muted)]">
              Tampilkan
            </span>
            <select
              value={ltLimit}
              onChange={(e) => setLtLimit(Number(e.target.value))}
              className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] cursor-pointer"
            >
              <option value={15}>Top 15 Barang</option>
              <option value={30}>Top 30 Barang</option>
              <option value={100}>Top 100 Barang</option>
              <option value={0}>Semua Barang</option>
            </select>
          </div>
        </div>
      )}
    </>
  );

  return (
    <div className="space-y-5">
      <BiKpiHeaderAndFilter
        idPrefix={`sales-${mode}`}
        moduleLabel="Sales"
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
        onApplyPreset={(f, t) => {
          setStartMonth(f);
          setEndMonth(t);
        }}
        onRefresh={() => void fetchSalesBiData({ refresh: true })}
        onExportCsv={handleExportCsv}
        loading={loading}
        refreshing={refreshing}
        canExport={hasRecords}
        extraControls={extraControls}
        noticeText={noticeMessage}
      />

      <BiKpiStateViews
        loading={loading}
        hasData={Boolean(data)}
        errorMsg={errorMsg}
        isEmpty={!hasRecords}
        selectedYear={selectedYear}
        startMonth={startMonth}
        endMonth={endMonth}
        minDateActive={data?.coverage?.minDateActive}
        maxDateActive={data?.coverage?.maxDateActive}
        onRetry={() => void fetchSalesBiData({ refresh: true })}
        onResetPeriod={handleResetActivePeriod}
        onDownloadBridge={onDownloadBridge}
      />

      {!errorMsg && data && hasRecords && (
        <div
          className={`space-y-5 transition-opacity duration-150 ${loading ? 'opacity-65' : 'opacity-100'}`}
        >
          {/* 09. Delivery On Time */}
          {mode === 'delivery_on_time' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">
                    Total {dotDocType === 'iv' ? 'Faktur (IV)' : 'Surat Jalan (DO)'}
                  </span>
                  <p className="font-mono text-xl font-bold text-[var(--text)] tabular-nums">
                    {formatNumberPlain(dotTotals.total)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    {dotRows.length} bulan terpantau
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Tepat Waktu</span>
                  <p className="font-mono text-xl font-bold text-[var(--accent)] tabular-nums">
                    {formatNumberPlain(dotTotals.onTime)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Sesuai / sebelum target kirim
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Terlambat</span>
                  <p className="font-mono text-xl font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                    {formatNumberPlain(dotTotals.late)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Melewati target kirim SO
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Delivery On Time</span>
                  <p className="font-mono text-xl font-bold text-[var(--accent)] tabular-nums">
                    {formatPct(dotTotals.pct)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    (Tepat Waktu ÷ Total) × 100%
                  </span>
                </div>
              </div>

              <BiLineChart
                title="Delivery On Time (%)"
                subtitle="Tren persentase ketepatan waktu pengiriman bulanan."
                legendLabel="Delivery On Time (%)"
                data={dotRows.map((r) => ({
                  key: r.month,
                  label: formatMonthShort(r.month),
                  value: r.pct,
                  valueLabel: formatPct(r.pct),
                  hoverSummary: `Tepat waktu: ${formatNumberPlain(r.onTime)} / ${formatNumberPlain(r.total)} (Terlambat: ${formatNumberPlain(r.late)})`,
                }))}
                formatAxisTick={(v) => `${formatDecimal(v, 0)}%`}
              />

              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[var(--border)]">
                  <h4 className="font-display text-sm font-bold text-[var(--text)]">
                    Tabel Delivery On Time Bulanan
                  </h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                        <th className="text-left font-semibold px-4 py-2.5">Bulan</th>
                        <th className="text-right font-semibold px-4 py-2.5">
                          Jml {dotDocType === 'iv' ? 'IV' : 'DO'} Tepat Waktu
                        </th>
                        <th className="text-right font-semibold px-4 py-2.5">
                          Jml {dotDocType === 'iv' ? 'IV' : 'DO'}
                        </th>
                        <th className="text-right font-semibold px-4 py-2.5">Delivery On Time (%)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {dotRows.map((r) => (
                        <tr key={r.month} className="hover:bg-[var(--bg)]/60">
                          <td className="px-4 py-2.5 font-medium text-[var(--text)]">
                            {formatMonthShort(r.month)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                            {formatNumberPlain(r.onTime)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                            {formatNumberPlain(r.total)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums font-bold text-[var(--accent)]">
                            {formatPct(r.pct)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* 10. Retur Penjualan */}
          {mode === 'sales_return' && (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
              <div className="xl:col-span-5 min-w-0 space-y-5">
                <BiHorizontalBarChart
                  title="Retur Penjualan (%)"
                  subtitle={`(Jml Retur ÷ Jml ${returnBasis === 'item_qty' ? 'Jual Unit' : 'IV'}) × 100%.`}
                  legendLabel="Retur Penjualan (%)"
                  data={returnRows.map((r) => ({
                    key: r.month,
                    label: formatMonthShort(r.month),
                    value: r.pct,
                    valueLabel: formatPct(r.pct),
                    hoverSummary: `Retur: ${formatNumberPlain(r.ret)} · Penjualan: ${formatNumberPlain(r.denom)}`,
                  }))}
                  formatAxisTick={(v) => `${formatDecimal(v, 1)}%`}
                />

                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-[var(--border)]">
                    <h4 className="font-display text-sm font-bold text-[var(--text)]">
                      Ringkasan Retur Bulanan (Pilih Bulan)
                    </h4>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                          <th className="text-left font-semibold px-3 py-2.5">Bulan</th>
                          <th className="text-right font-semibold px-3 py-2.5">Jml Retur</th>
                          <th className="text-right font-semibold px-3 py-2.5">
                            {returnBasis === 'item_qty' ? 'Jml Jual' : 'Jml IV'}
                          </th>
                          <th className="text-right font-semibold px-3 py-2.5">Retur (%)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {returnRows.map((r) => {
                          const active = r.month === selectedDetailMonth;
                          return (
                            <tr
                              key={r.month}
                              onClick={() => setSelectedDetailMonth(r.month)}
                              className={`cursor-pointer transition-colors ${
                                active ? 'bg-[var(--accent)]/12 font-semibold' : 'hover:bg-[var(--bg)]/60'
                              }`}
                            >
                              <td className="px-3 py-2.5 text-[var(--text)]">
                                {formatMonthShort(r.month)}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                                {formatNumberPlain(r.ret)}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                                {formatNumberPlain(r.denom)}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono tabular-nums font-bold text-[var(--accent)]">
                                {formatPct(r.pct)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="xl:col-span-7 min-w-0 bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden flex flex-col">
                <div className="px-5 py-3.5 border-b border-[var(--border)] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h4 className="font-display text-sm font-bold text-[var(--text)] leading-snug">
                      Detail {selectedDetailMonth ? formatMonthFull(selectedDetailMonth) : '-'}
                    </h4>
                    <p className="text-xs text-[var(--text-muted)]">
                      Rincian Retur Penjualan per barang ({returnDetailItems.length} barang).
                    </p>
                  </div>
                  <div className="relative shrink-0">
                    <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={itemSearch}
                      onChange={(e) => setItemSearch(e.target.value)}
                      placeholder="Cari kode / barang..."
                      className="pl-8 pr-3 py-1.5 w-full sm:w-48 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                    />
                  </div>
                </div>
                <div className="overflow-x-auto max-h-[540px]">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                        <th className="text-left font-semibold px-3 py-2.5">Barang</th>
                        <th className="text-right font-semibold px-3 py-2.5">Jml Retur</th>
                        <th className="text-right font-semibold px-3 py-2.5">Jml Jual</th>
                        <th className="text-right font-semibold px-3 py-2.5">Retur Penjualan (%)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {returnDetailItems.map((item) => (
                        <tr key={item.itemId} className="hover:bg-[var(--bg)]/60">
                          <td className="px-3 py-2">
                            <div className="font-medium text-[var(--text)]">{item.itemName}</div>
                            <div className="text-[11px] font-mono text-[var(--text-muted)]">
                              {item.itemCode}
                            </div>
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-mono tabular-nums ${
                              item.returnQty > 0 ? 'text-red-500 font-semibold' : 'text-[var(--text-muted)]'
                            }`}
                          >
                            {formatNumberPlain(item.returnQty)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--text)]">
                            {formatNumberPlain(item.soldQty)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums font-bold text-[var(--accent)]">
                            {formatPct(item.returnPct)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="sticky bottom-0">
                      <tr className="bg-[var(--bg)] border-t border-[var(--border)] font-bold">
                        <td className="px-3 py-2.5 text-[var(--text)]">
                          Total ({returnDetailItems.length} Barang)
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                          {formatNumberPlain(returnDetailTotals.ret)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                          {formatNumberPlain(returnDetailTotals.sold)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--accent)]">
                          {formatPct(returnDetailTotals.pct)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 10B. Barang Tidak Sesuai Pesanan */}
          {mode === 'order_mismatch' && (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
              <div className="xl:col-span-5 min-w-0 space-y-5">
                <BiHorizontalBarChart
                  title="Barang Tidak Sesuai Pesanan (%)"
                  subtitle="(Jml Tidak Sesuai Pesanan ÷ Jml Pengiriman) × 100%."
                  legendLabel="Tidak Sesuai Pesanan (%)"
                  data={mismatchRows.map((r) => ({
                    key: r.month,
                    label: formatMonthShort(r.month),
                    value: r.pct,
                    valueLabel: formatPct(r.pct),
                    hoverSummary: `Tidak sesuai: ${formatNumberPlain(r.mis)} · Pengiriman: ${formatNumberPlain(r.deliv)}`,
                  }))}
                  formatAxisTick={(v) => `${formatDecimal(v, 1)}%`}
                />

                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-[var(--border)]">
                    <h4 className="font-display text-sm font-bold text-[var(--text)]">
                      Ringkasan Bulanan (Pilih Bulan)
                    </h4>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                          <th className="text-left font-semibold px-3 py-2.5">Bulan</th>
                          <th className="text-right font-semibold px-3 py-2.5">Tdk Sesuai</th>
                          <th className="text-right font-semibold px-3 py-2.5">Jml Pengiriman</th>
                          <th className="text-right font-semibold px-3 py-2.5">Persentase</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {mismatchRows.map((r) => {
                          const active = r.month === selectedDetailMonth;
                          return (
                            <tr
                              key={r.month}
                              onClick={() => setSelectedDetailMonth(r.month)}
                              className={`cursor-pointer transition-colors ${
                                active ? 'bg-[var(--accent)]/12 font-semibold' : 'hover:bg-[var(--bg)]/60'
                              }`}
                            >
                              <td className="px-3 py-2.5 text-[var(--text)]">
                                {formatMonthShort(r.month)}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                                {formatNumberPlain(r.mis)}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                                {formatNumberPlain(r.deliv)}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono tabular-nums font-bold text-[var(--accent)]">
                                {formatPct(r.pct)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="xl:col-span-7 min-w-0 bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden flex flex-col">
                <div className="px-5 py-3.5 border-b border-[var(--border)] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h4 className="font-display text-sm font-bold text-[var(--text)] leading-snug">
                      Detail {selectedDetailMonth ? formatMonthFull(selectedDetailMonth) : '-'}
                    </h4>
                    <p className="text-xs text-[var(--text-muted)]">
                      Rincian ketidaksesuaian pengiriman per barang ({mismatchDetailItems.length} barang).
                    </p>
                  </div>
                  <div className="relative shrink-0">
                    <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={itemSearch}
                      onChange={(e) => setItemSearch(e.target.value)}
                      placeholder="Cari kode / barang..."
                      className="pl-8 pr-3 py-1.5 w-full sm:w-48 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                    />
                  </div>
                </div>
                <div className="overflow-x-auto max-h-[540px]">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                        <th className="text-left font-semibold px-3 py-2.5">Barang</th>
                        <th className="text-right font-semibold px-3 py-2.5">Jml Tdk Sesuai</th>
                        <th className="text-right font-semibold px-3 py-2.5">Jml Pengiriman</th>
                        <th className="text-right font-semibold px-3 py-2.5">Tdk Sesuai (%)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {mismatchDetailItems.map((item) => (
                        <tr key={item.itemId} className="hover:bg-[var(--bg)]/60">
                          <td className="px-3 py-2">
                            <div className="font-medium text-[var(--text)]">{item.itemName}</div>
                            <div className="text-[11px] font-mono text-[var(--text-muted)]">
                              {item.itemCode}
                            </div>
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-mono tabular-nums ${
                              item.mismatchQty > 0 ? 'text-amber-600 dark:text-amber-400 font-semibold' : 'text-[var(--text-muted)]'
                            }`}
                          >
                            {formatNumberPlain(item.mismatchQty)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--text)]">
                            {formatNumberPlain(item.deliveredQty)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums font-bold text-[var(--accent)]">
                            {formatPct(item.mismatchPct)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="sticky bottom-0">
                      <tr className="bg-[var(--bg)] border-t border-[var(--border)] font-bold">
                        <td className="px-3 py-2.5 text-[var(--text)]">
                          Total ({mismatchDetailItems.length} Barang)
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                          {formatNumberPlain(mismatchDetailTotals.mis)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                          {formatNumberPlain(mismatchDetailTotals.deliv)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--accent)]">
                          {formatPct(mismatchDetailTotals.pct)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 11. Pengiriman Barang (Delivery Order) 0..14 Hari Matrix */}
          {mode === 'delivery_lead_time' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Jumlah Jenis Barang</span>
                  <p className="font-mono text-xl font-bold text-[var(--text)] tabular-nums">
                    {formatNumberPlain(filteredLeadTimeRows.length)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Menampilkan {displayedLeadTimeRows.length} barang
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Total Pengiriman (DO)</span>
                  <p className="font-mono text-xl font-bold text-[var(--text)] tabular-nums">
                    {formatNumberPlain(leadTimeSummary.totalDeliveries)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Baris barang terkirim
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Rata-rata Lead Time</span>
                  <p className="font-mono text-xl font-bold text-[var(--accent)] tabular-nums">
                    {formatDecimal(leadTimeSummary.avgDays, 1)} Hari
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Tanggal SO → Pengiriman DO
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Pengiriman Cepat (≤ 2 Hari)</span>
                  <p className="font-mono text-xl font-bold text-[var(--accent)] tabular-nums">
                    {formatPct(leadTimeSummary.fastPct)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Bucket 0, 1, dan 2 Hari
                  </span>
                </div>
              </div>

              <BiVerticalSingleChart
                title="Distribusi Waktu Pengiriman DO (0 Hari – 14+ Hari)"
                subtitle="Total frekuensi pengiriman Delivery Order pada masing-masing durasi hari."
                legendLabel="Jumlah Pengiriman (DO)"
                data={LEAD_TIME_LABELS.map((lbl, idx) => ({
                  key: lbl,
                  label: idx === 15 ? '>14h' : `${idx}h`,
                  value: leadTimeSummary.bucketTotals[idx] || 0,
                  valueLabel: `${formatNumberPlain(leadTimeSummary.bucketTotals[idx] || 0)}`,
                  hoverSummary: `${lbl}: ${formatNumberPlain(leadTimeSummary.bucketTotals[idx] || 0)} pengiriman`,
                }))}
                formatAxisTick={(v) => formatNumberPlain(v)}
                shape="column"
              />

              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[var(--border)]">
                  <h4 className="font-display text-sm font-bold text-[var(--text)]">
                    Matriks Pengiriman Barang (0 Hari s.d. 14 Hari)
                  </h4>
                </div>
                <div className="overflow-x-auto max-h-[540px]">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 z-20">
                      <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                        <th className="sticky left-0 z-30 bg-[var(--bg)] text-left font-semibold px-3 py-2.5 min-w-[200px] border-r border-[var(--border)]">
                          Nama Barang
                        </th>
                        {LEAD_TIME_LABELS.map((lbl) => (
                          <th
                            key={lbl}
                            className="text-right font-semibold px-2 py-2.5 whitespace-nowrap min-w-[54px]"
                          >
                            {lbl}
                          </th>
                        ))}
                        <th className="text-right font-semibold px-3 py-2.5 whitespace-nowrap border-l border-[var(--border)]">
                          Total
                        </th>
                        <th className="text-right font-semibold px-3 py-2.5 whitespace-nowrap">
                          Rata2 (Hr)
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {displayedLeadTimeRows.map((row) => (
                        <tr key={row.itemId} className="hover:bg-[var(--bg)]/60">
                          <td className="sticky left-0 z-10 bg-[var(--surface)] px-3 py-2 border-r border-[var(--border)]">
                            <div className="font-medium text-[var(--text)] truncate max-w-[220px]" title={row.itemName}>
                              {row.itemName}
                            </div>
                            <div className="text-[10px] font-mono text-[var(--text-muted)]">
                              {row.itemCode}
                            </div>
                          </td>
                          {row.buckets.map((val, bIdx) => {
                            const ratio = val > 0 ? val / leadTimeSummary.maxCell : 0;
                            const heatClass =
                              val === 0
                                ? 'text-[var(--text-muted)]/45'
                                : ratio >= 0.7
                                  ? 'font-semibold text-[var(--text)] bg-[var(--accent)]/35'
                                  : ratio >= 0.35
                                    ? 'font-semibold text-[var(--text)] bg-[var(--accent)]/22'
                                    : 'font-semibold text-[var(--text)] bg-[var(--accent)]/12';
                            return (
                              <td
                                key={bIdx}
                                className={`px-2 py-2 text-right font-mono tabular-nums ${heatClass}`}
                              >
                                {formatNumberPlain(val)}
                              </td>
                            );
                          })}
                          <td className="px-3 py-2 text-right font-mono tabular-nums font-bold text-[var(--text)] border-l border-[var(--border)]">
                            {formatNumberPlain(row.totalDeliveries)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums font-semibold text-[var(--accent)]">
                            {formatDecimal(row.avgLeadDays, 1)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="sticky bottom-0 z-20">
                      <tr className="bg-[var(--bg)] border-t border-[var(--border)] font-bold">
                        <td className="sticky left-0 z-30 bg-[var(--bg)] px-3 py-2.5 text-[var(--text)] border-r border-[var(--border)]">
                          Total ({filteredLeadTimeRows.length} Barang)
                        </td>
                        {leadTimeSummary.bucketTotals.map((t, idx) => (
                          <td key={idx} className="px-2 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                            {formatNumberPlain(t)}
                          </td>
                        ))}
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--accent)] border-l border-[var(--border)]">
                          {formatNumberPlain(leadTimeSummary.totalDeliveries)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--accent)]">
                          {formatDecimal(leadTimeSummary.avgDays, 1)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
