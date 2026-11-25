import React, { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import {
  BiKpiHeaderAndFilter,
  BiKpiStateViews,
  BiVerticalSingleChart,
} from './BiFinanceChartPrimitives';
import {
  downloadCsvFile,
  formatDecimal,
  formatIdr,
  formatMonthFull,
  formatMonthShort,
  formatNumberPlain,
  formatPct,
  useBiPurchasingPeriodData,
} from './biOperationsShared';

export type PurchasingOrderKpiMode =
  | 'po_realization'
  | 'po_unfulfilled'
  | 'purchase_close_index'
  | 'purchase_price_index';

interface BiPurchasingOrderKpiProps {
  mode: PurchasingOrderKpiMode;
  idToken: string | null;
  onDownloadBridge?: () => void;
}

const META: Record<
  PurchasingOrderKpiMode,
  { category: string; chartTypeLabel: string; title: string; description: string }
> = {
  po_realization: {
    category: 'Realisasi Order & Harga',
    chartTypeLabel: 'Diagram Kolom Ganda',
    title: '06. Realisasi Order Pembelian (PO)',
    description:
      'Persentase realisasi Purchase Order (PO) berdasarkan jumlah barang yang sudah diterima maupun nilai rupiah yang terealisasi per bulan.',
  },
  po_unfulfilled: {
    category: 'Realisasi Order & Harga',
    chartTypeLabel: 'Diagram Kolom Ganda',
    title: '06B. Order Pembelian Tidak Terpenuhi',
    description:
      'Persentase sisa Purchase Order (PO) yang belum terpenuhi baik dari sisi jumlah barang maupun nilai rupiah per bulan.',
  },
  purchase_close_index: {
    category: 'Realisasi Order & Harga',
    chartTypeLabel: 'Diagram Kolom Ganda',
    title: '07. Order Pembelian Complete (Purchase Close Index)',
    description:
      'Persentase Purchase Order (PO) berstatus Complete terhadap total PO baik berdasarkan jumlah dokumen maupun nilai transaksi.',
  },
  purchase_price_index: {
    category: 'Realisasi Order & Harga',
    chartTypeLabel: 'Diagram Kerucut Vertikal',
    title: '08. Perubahan Harga Beli (Purchase Price Index)',
    description:
      'Indeks perubahan harga beli akhir barang dari bulan lalu ke bulan ini lengkap dengan rincian variasi Rp dan % per barang.',
  },
};

const REALIZATION_SOURCE_LABELS: Record<string, string> = {
  m4_grn_detail: 'Relasi aktual Purchase Order vs Penerimaan Barang (non-void)',
  m4_ri_detail: 'Relasi aktual Purchase Order vs Faktur Pembelian (non-void)',
  m4_po_detail: 'Data realisasi item Purchase Order',
  m4_po_status: 'Status dokumen Purchase Order',
  unavailable: 'Data relasi realisasi PO belum tersedia',
};

export const BiPurchasingOrderKpi: React.FC<BiPurchasingOrderKpiProps> = ({
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
  } = useBiPurchasingPeriodData(idToken);

  const [closeBasis, setCloseBasis] = useState<'complete_only' | 'complete_or_close'>('complete_only');
  const [selectedPpiMonth, setSelectedPpiMonth] = useState<string>('');
  const [ppiSearch, setPpiSearch] = useState<string>('');

  const meta = META[mode];

  const monthlyRows = useMemo(() => {
    const all = data?.monthly || [];
    return all.filter(
      (r) =>
        r.poCount > 0 ||
        r.poItemQty > 0 ||
        r.poOrderValue > 0 ||
        r.poTotalValue > 0 ||
        r.ppiItemCount > 0 ||
        r.riDppIdr > 0
    );
  }, [data?.monthly]);

  // Auto-select latest month with PPI data
  useEffect(() => {
    if (mode !== 'purchase_price_index') return;
    if (monthlyRows.length === 0) return;
    const stillValid = monthlyRows.some((r) => r.month === selectedPpiMonth);
    if (!stillValid) {
      const withData = [...monthlyRows].reverse().find((r) => r.ppiItemCount > 0);
      setSelectedPpiMonth(withData?.month || monthlyRows[monthlyRows.length - 1].month);
    }
  }, [mode, monthlyRows, selectedPpiMonth]);

  // 06 & 06B computed rows
  const orderRealRows = useMemo(() => {
    return monthlyRows.map((r) => {
      const poItemQty = Number(r.poItemQty) || 0;
      const poRealizedQty = Number(r.poRealizedQty) || 0;
      const poOrderValue = Number(r.poOrderValue) || 0;
      const poRealizedValue = Number(r.poRealizedValue) || 0;
      const unfulfilledQty = Math.max(0, poItemQty - poRealizedQty);
      const unfulfilledVal = Math.max(0, poOrderValue - poRealizedValue);
      const realQtyPct = poItemQty > 0 ? (poRealizedQty / poItemQty) * 100 : 0;
      const realValPct = poOrderValue > 0 ? (poRealizedValue / poOrderValue) * 100 : 0;
      const unfulQtyPct = poItemQty > 0 ? (unfulfilledQty / poItemQty) * 100 : 0;
      const unfulValPct = poOrderValue > 0 ? (unfulfilledVal / poOrderValue) * 100 : 0;
      return {
        month: r.month,
        poQty: poItemQty,
        realQty: poRealizedQty,
        realQtyPct,
        unfulfilledQty,
        unfulQtyPct,
        poVal: poOrderValue,
        realVal: poRealizedValue,
        realValPct,
        unfulfilledVal,
        unfulValPct,
      };
    });
  }, [monthlyRows]);

  // 07 Purchase Close Index rows
  const closeRows = useMemo(() => {
    return monthlyRows.map((r) => {
      const poCount = Number(r.poCount) || 0;
      const poTotalValue = Number(r.poTotalValue) || 0;
      const compCount =
        Number(closeBasis === 'complete_only' ? r.poCompleteCount : r.poCompleteOrCloseCount) || 0;
      const compVal =
        Number(closeBasis === 'complete_only' ? r.poCompleteValue : r.poCompleteOrCloseValue) || 0;
      const countPct = poCount > 0 ? (compCount / poCount) * 100 : 0;
      const valPct = poTotalValue > 0 ? (compVal / poTotalValue) * 100 : 0;
      return {
        month: r.month,
        compCount,
        totalCount: poCount,
        countPct,
        compVal,
        totalVal: poTotalValue,
        valPct,
      };
    });
  }, [closeBasis, monthlyRows]);

  // 08 PPI detail rows
  const ppiDetailItems = useMemo(() => {
    const raw = (selectedPpiMonth && data?.ppiDetailsByMonth?.[selectedPpiMonth]) || [];
    const q = ppiSearch.trim().toLowerCase();
    if (!q) return raw;
    return raw.filter(
      (i) => i.itemCode.toLowerCase().includes(q) || i.itemName.toLowerCase().includes(q)
    );
  }, [data?.ppiDetailsByMonth, ppiSearch, selectedPpiMonth]);

  const ppiDetailTotals = useMemo(() => {
    const sumPrev = ppiDetailItems.reduce((s, r) => s + r.prevPrice, 0);
    const sumCurr = ppiDetailItems.reduce((s, r) => s + r.currPrice, 0);
    const diff = sumCurr - sumPrev;
    const pct = sumPrev > 0 ? (diff / sumPrev) * 100 : 0;
    return { sumPrev, sumCurr, diff, pct };
  }, [ppiDetailItems]);

  const totals06 = useMemo(() => {
    const poQty = orderRealRows.reduce((s, r) => s + r.poQty, 0);
    const realQty = orderRealRows.reduce((s, r) => s + r.realQty, 0);
    const unfulQty = orderRealRows.reduce((s, r) => s + r.unfulfilledQty, 0);
    const poVal = orderRealRows.reduce((s, r) => s + r.poVal, 0);
    const realVal = orderRealRows.reduce((s, r) => s + r.realVal, 0);
    const unfulVal = orderRealRows.reduce((s, r) => s + r.unfulfilledVal, 0);
    return {
      poQty,
      realQty,
      unfulQty,
      realQtyPct: poQty > 0 ? (realQty / poQty) * 100 : 0,
      unfulQtyPct: poQty > 0 ? (unfulQty / poQty) * 100 : 0,
      poVal,
      realVal,
      unfulVal,
      realValPct: poVal > 0 ? (realVal / poVal) * 100 : 0,
      unfulValPct: poVal > 0 ? (unfulVal / poVal) * 100 : 0,
    };
  }, [orderRealRows]);

  const totals07 = useMemo(() => {
    const compCount = closeRows.reduce((s, r) => s + r.compCount, 0);
    const totalCount = closeRows.reduce((s, r) => s + r.totalCount, 0);
    const compVal = closeRows.reduce((s, r) => s + r.compVal, 0);
    const totalVal = closeRows.reduce((s, r) => s + r.totalVal, 0);
    return {
      compCount,
      totalCount,
      countPct: totalCount > 0 ? (compCount / totalCount) * 100 : 0,
      compVal,
      totalVal,
      valPct: totalVal > 0 ? (compVal / totalVal) * 100 : 0,
    };
  }, [closeRows]);

  const noticeMessage = useMemo(() => {
    const parts: string[] = [];
    if (data?.cutoffDate) {
      parts.push(`Cut-off transaksi aktif MyERP Plus dimulai sejak ${data.cutoffDate}.`);
    }
    if ((mode === 'po_realization' || mode === 'po_unfulfilled') && data?.diagnostics?.realizationSource) {
      parts.push(
        `Basis realisasi: ${REALIZATION_SOURCE_LABELS[data.diagnostics.realizationSource] || data.diagnostics.realizationSource}.`
      );
    }
    if (mode === 'purchase_price_index') {
      parts.push(
        'Klik baris bulan pada tabel ringkasan di kiri untuk melihat rincian variasi harga beli per barang pada panel Detail.'
      );
    }
    return parts.length > 0 ? parts.join(' ') : null;
  }, [data?.cutoffDate, data?.diagnostics?.realizationSource, mode]);

  const handleExportCsv = () => {
    const suffix = `${selectedYear}_${String(effectiveStart).padStart(2, '0')}-${String(effectiveEnd).padStart(2, '0')}`;
    if (mode === 'po_realization') {
      downloadCsvFile(
        `bi_purchasing_06_realisasi_po_${suffix}.csv`,
        ['Bulan', 'Jml Barang PO', 'Jml Barang Realisasi PO', 'Barang Realisasi PO (%)', 'Nilai PO', 'Nilai Realisasi PO', 'Nilai Realisasi PO (%)'],
        orderRealRows.map((r) => [
          formatMonthShort(r.month),
          r.poQty,
          r.realQty,
          r.realQtyPct.toFixed(2),
          Math.round(r.poVal),
          Math.round(r.realVal),
          r.realValPct.toFixed(2),
        ])
      );
    } else if (mode === 'po_unfulfilled') {
      downloadCsvFile(
        `bi_purchasing_06B_po_tidak_terpenuhi_${suffix}.csv`,
        ['Bulan', 'Jml Barang PO', 'Jml Barang Tidak Terpenuhi', 'Barang Tidak Terpenuhi (%)', 'Nilai PO', 'Nilai Tidak Terpenuhi', 'Tidak Terpenuhi (%)'],
        orderRealRows.map((r) => [
          formatMonthShort(r.month),
          r.poQty,
          r.unfulfilledQty,
          r.unfulQtyPct.toFixed(2),
          Math.round(r.poVal),
          Math.round(r.unfulfilledVal),
          r.unfulValPct.toFixed(2),
        ])
      );
    } else if (mode === 'purchase_close_index') {
      downloadCsvFile(
        `bi_purchasing_07_purchase_close_index_${suffix}.csv`,
        ['Bulan', 'Jml PO Complete', 'Jml PO', 'Purchase Close Index Qty (%)', 'Nilai PO Complete', 'Nilai PO', 'Purchase Close Index Nilai (%)'],
        closeRows.map((r) => [
          formatMonthShort(r.month),
          r.compCount,
          r.totalCount,
          r.countPct.toFixed(2),
          Math.round(r.compVal),
          Math.round(r.totalVal),
          r.valPct.toFixed(2),
        ])
      );
    } else {
      downloadCsvFile(
        `bi_purchasing_08_ppi_${selectedPpiMonth || suffix}.csv`,
        ['Kode Barang', 'Nama Barang', 'Harga Beli Bulan Lalu', 'Harga Beli Bulan Ini', 'Variasi Rp', 'Variasi %'],
        ppiDetailItems.map((i) => [
          i.itemCode,
          i.itemName,
          Math.round(i.prevPrice),
          Math.round(i.currPrice),
          Math.round(i.varianceIdr),
          i.variancePct.toFixed(2),
        ])
      );
    }
  };

  const extraControls = (
    <>
      {mode === 'purchase_close_index' && (
        <div className="space-y-1 ml-auto">
          <span className="block text-[11px] font-medium text-[var(--text-muted)]">
            Status Complete PO
          </span>
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
            <button
              type="button"
              onClick={() => setCloseBasis('complete_only')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md cursor-pointer whitespace-nowrap ${
                closeBasis === 'complete_only'
                  ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              Complete (Status 4)
            </button>
            <button
              type="button"
              onClick={() => setCloseBasis('complete_or_close')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md cursor-pointer whitespace-nowrap ${
                closeBasis === 'complete_or_close'
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

  return (
    <div className="space-y-5">
      <BiKpiHeaderAndFilter
        idPrefix={`purchasing-${mode}`}
        moduleLabel="Purchasing"
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
        canExport={monthlyRows.length > 0}
        extraControls={extraControls}
        noticeText={noticeMessage}
      />

      <BiKpiStateViews
        loading={loading}
        hasData={Boolean(data)}
        errorMsg={errorMsg}
        isEmpty={monthlyRows.length === 0}
        selectedYear={selectedYear}
        startMonth={startMonth}
        endMonth={endMonth}
        minDateActive={data?.coverage?.minDateActive}
        maxDateActive={data?.coverage?.maxDateActive}
        onRetry={() => void fetchData({ refresh: true })}
        onResetPeriod={resetToActivePeriod}
        onDownloadBridge={onDownloadBridge}
      />

      {!errorMsg && data && monthlyRows.length > 0 && (
        <div
          className={`space-y-5 transition-opacity duration-150 ${loading ? 'opacity-65' : 'opacity-100'}`}
        >
          {/* 06. Realisasi Order Pembelian */}
          {mode === 'po_realization' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Total Barang PO</span>
                  <p className="font-mono text-xl font-bold text-[var(--text)] tabular-nums">
                    {formatNumberPlain(totals06.poQty)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Terealisasi: {formatNumberPlain(totals06.realQty)} unit
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Barang Realisasi PO</span>
                  <p className="font-mono text-xl font-bold text-[var(--accent)] tabular-nums">
                    {formatPct(totals06.realQtyPct)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Jml Barang Realisasi ÷ Jml Barang PO
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Total Nilai PO</span>
                  <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate">
                    {formatIdr(totals06.poVal)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block truncate">
                    Realisasi: {formatIdr(totals06.realVal)}
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Nilai Realisasi PO</span>
                  <p className="font-mono text-xl font-bold text-[var(--accent)] tabular-nums">
                    {formatPct(totals06.realValPct)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Nilai Realisasi ÷ Nilai PO
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                <div className="min-w-0 space-y-4">
                  <BiVerticalSingleChart
                    title="Barang Realisasi PO (%)"
                    subtitle="Perbandingan jumlah barang diterima terhadap jumlah barang PO."
                    legendLabel="Barang Realisasi PO (%)"
                    data={orderRealRows.map((r) => ({
                      key: r.month,
                      label: formatMonthShort(r.month),
                      value: r.realQtyPct,
                      valueLabel: formatPct(r.realQtyPct),
                      hoverSummary: `Realisasi: ${formatNumberPlain(r.realQty)} / ${formatNumberPlain(r.poQty)} unit`,
                    }))}
                    formatAxisTick={(v) => `${formatDecimal(v, 0)}%`}
                    shape="column"
                  />
                  <div className="bg-[var(--surface)] overflow-x-auto border border-[var(--border)] rounded-xl">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                          <th className="text-left font-semibold px-3 py-2.5">Bulan</th>
                          <th className="text-right font-semibold px-3 py-2.5">Jml Barang PO</th>
                          <th className="text-right font-semibold px-3 py-2.5">Jml Realisasi</th>
                          <th className="text-right font-semibold px-3 py-2.5">Realisasi (%)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {orderRealRows.map((r) => (
                          <tr key={r.month}>
                            <td className="px-3 py-2 font-medium text-[var(--text)]">
                              {formatMonthShort(r.month)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--text)]">
                              {formatNumberPlain(r.poQty)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--text)]">
                              {formatNumberPlain(r.realQty)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums font-bold text-[var(--accent)]">
                              {formatPct(r.realQtyPct)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="min-w-0 space-y-4">
                  <BiVerticalSingleChart
                    title="Nilai Realisasi PO (%)"
                    subtitle="Perbandingan nilai rupiah terealisasi terhadap total nilai PO."
                    legendLabel="Nilai Realisasi PO (%)"
                    data={orderRealRows.map((r) => ({
                      key: r.month,
                      label: formatMonthShort(r.month),
                      value: r.realValPct,
                      valueLabel: formatPct(r.realValPct),
                      hoverSummary: `Realisasi: ${formatIdr(r.realVal)} / ${formatIdr(r.poVal)}`,
                    }))}
                    formatAxisTick={(v) => `${formatDecimal(v, 0)}%`}
                    shape="column"
                  />
                  <div className="bg-[var(--surface)] overflow-x-auto border border-[var(--border)] rounded-xl">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                          <th className="text-left font-semibold px-3 py-2.5">Bulan</th>
                          <th className="text-right font-semibold px-3 py-2.5">Nilai PO</th>
                          <th className="text-right font-semibold px-3 py-2.5">Nilai Realisasi</th>
                          <th className="text-right font-semibold px-3 py-2.5">Realisasi (%)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {orderRealRows.map((r) => (
                          <tr key={r.month}>
                            <td className="px-3 py-2 font-medium text-[var(--text)]">
                              {formatMonthShort(r.month)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--text)]">
                              {formatIdr(r.poVal)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--text)]">
                              {formatIdr(r.realVal)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums font-bold text-[var(--accent)]">
                              {formatPct(r.realValPct)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* 06B. Order Pembelian Tidak Terpenuhi */}
          {mode === 'po_unfulfilled' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Barang Tidak Terpenuhi</span>
                  <p className="font-mono text-xl font-bold text-[var(--text)] tabular-nums">
                    {formatNumberPlain(totals06.unfulQty)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Dari {formatNumberPlain(totals06.poQty)} unit PO
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">% Barang Tidak Terpenuhi</span>
                  <p className="font-mono text-xl font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                    {formatPct(totals06.unfulQtyPct)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    (PO − Realisasi) ÷ Total Barang PO
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Nilai Tidak Terpenuhi</span>
                  <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate">
                    {formatIdr(totals06.unfulVal)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block truncate">
                    Dari {formatIdr(totals06.poVal)}
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">% Nilai Tidak Terpenuhi</span>
                  <p className="font-mono text-xl font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                    {formatPct(totals06.unfulValPct)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    (Nilai PO − Realisasi) ÷ Nilai PO
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                <div className="min-w-0 space-y-4">
                  <BiVerticalSingleChart
                    title="Barang Tidak Terpenuhi (%)"
                    subtitle="Persentase jumlah barang PO yang belum diterima di gudang."
                    legendLabel="Barang Tidak Terpenuhi (%)"
                    data={orderRealRows.map((r) => ({
                      key: r.month,
                      label: formatMonthShort(r.month),
                      value: r.unfulQtyPct,
                      valueLabel: formatPct(r.unfulQtyPct),
                      hoverSummary: `Tidak terpenuhi: ${formatNumberPlain(r.unfulfilledQty)} / ${formatNumberPlain(r.poQty)} unit`,
                    }))}
                    formatAxisTick={(v) => `${formatDecimal(v, 0)}%`}
                    shape="column"
                  />
                  <div className="bg-[var(--surface)] overflow-x-auto border border-[var(--border)] rounded-xl">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                          <th className="text-left font-semibold px-3 py-2.5">Bulan</th>
                          <th className="text-right font-semibold px-3 py-2.5">Jml Barang PO</th>
                          <th className="text-right font-semibold px-3 py-2.5">Tidak Terpenuhi</th>
                          <th className="text-right font-semibold px-3 py-2.5">Tidak Terpenuhi (%)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {orderRealRows.map((r) => (
                          <tr key={r.month}>
                            <td className="px-3 py-2 font-medium text-[var(--text)]">
                              {formatMonthShort(r.month)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--text)]">
                              {formatNumberPlain(r.poQty)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--text)]">
                              {formatNumberPlain(r.unfulfilledQty)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums font-bold text-amber-600 dark:text-amber-400">
                              {formatPct(r.unfulQtyPct)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="min-w-0 space-y-4">
                  <BiVerticalSingleChart
                    title="Nilai Tidak Terpenuhi (%)"
                    subtitle="Persentase nilai rupiah PO yang belum terealisasi penerimaan."
                    legendLabel="Nilai Tidak Terpenuhi (%)"
                    data={orderRealRows.map((r) => ({
                      key: r.month,
                      label: formatMonthShort(r.month),
                      value: r.unfulValPct,
                      valueLabel: formatPct(r.unfulValPct),
                      hoverSummary: `Tidak terpenuhi: ${formatIdr(r.unfulfilledVal)} / ${formatIdr(r.poVal)}`,
                    }))}
                    formatAxisTick={(v) => `${formatDecimal(v, 0)}%`}
                    shape="column"
                  />
                  <div className="bg-[var(--surface)] overflow-x-auto border border-[var(--border)] rounded-xl">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                          <th className="text-left font-semibold px-3 py-2.5">Bulan</th>
                          <th className="text-right font-semibold px-3 py-2.5">Nilai PO</th>
                          <th className="text-right font-semibold px-3 py-2.5">Nilai Tdk Terpenuhi</th>
                          <th className="text-right font-semibold px-3 py-2.5">Tidak Terpenuhi (%)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {orderRealRows.map((r) => (
                          <tr key={r.month}>
                            <td className="px-3 py-2 font-medium text-[var(--text)]">
                              {formatMonthShort(r.month)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--text)]">
                              {formatIdr(r.poVal)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--text)]">
                              {formatIdr(r.unfulfilledVal)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums font-bold text-amber-600 dark:text-amber-400">
                              {formatPct(r.unfulValPct)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* 07. Purchase Close Index */}
          {mode === 'purchase_close_index' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">PO Status Complete</span>
                  <p className="font-mono text-xl font-bold text-[var(--text)] tabular-nums">
                    {formatNumberPlain(totals07.compCount)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Dari {formatNumberPlain(totals07.totalCount)} total PO
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Purchase Close Index (Qty)</span>
                  <p className="font-mono text-xl font-bold text-[var(--accent)] tabular-nums">
                    {formatPct(totals07.countPct)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Jml PO Complete ÷ Total PO
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Nilai PO Complete</span>
                  <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate">
                    {formatIdr(totals07.compVal)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block truncate">
                    Dari {formatIdr(totals07.totalVal)}
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Purchase Close Index (Nilai)</span>
                  <p className="font-mono text-xl font-bold text-[var(--accent)] tabular-nums">
                    {formatPct(totals07.valPct)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Nilai PO Complete ÷ Total Nilai PO
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                <div className="min-w-0 space-y-4">
                  <BiVerticalSingleChart
                    title="Purchase Close Index — Jumlah PO (%)"
                    subtitle="Persentase dokumen PO berstatus Complete per bulan."
                    legendLabel="Purchase Close Index (%)"
                    data={closeRows.map((r) => ({
                      key: r.month,
                      label: formatMonthShort(r.month),
                      value: r.countPct,
                      valueLabel: formatPct(r.countPct),
                      hoverSummary: `Complete: ${formatNumberPlain(r.compCount)} / ${formatNumberPlain(r.totalCount)} PO`,
                    }))}
                    formatAxisTick={(v) => `${formatDecimal(v, 0)}%`}
                    shape="column"
                  />
                  <div className="bg-[var(--surface)] overflow-x-auto border border-[var(--border)] rounded-xl">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                          <th className="text-left font-semibold px-3 py-2.5">Bulan</th>
                          <th className="text-right font-semibold px-3 py-2.5">Jml PO Complete</th>
                          <th className="text-right font-semibold px-3 py-2.5">Jml PO</th>
                          <th className="text-right font-semibold px-3 py-2.5">Close Index (%)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {closeRows.map((r) => (
                          <tr key={r.month}>
                            <td className="px-3 py-2 font-medium text-[var(--text)]">
                              {formatMonthShort(r.month)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--text)]">
                              {formatNumberPlain(r.compCount)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--text)]">
                              {formatNumberPlain(r.totalCount)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums font-bold text-[var(--accent)]">
                              {formatPct(r.countPct)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="min-w-0 space-y-4">
                  <BiVerticalSingleChart
                    title="Purchase Close Index — Nilai PO (%)"
                    subtitle="Persentase nilai rupiah PO berstatus Complete per bulan."
                    legendLabel="Purchase Close Index (%)"
                    data={closeRows.map((r) => ({
                      key: r.month,
                      label: formatMonthShort(r.month),
                      value: r.valPct,
                      valueLabel: formatPct(r.valPct),
                      hoverSummary: `Complete: ${formatIdr(r.compVal)} / ${formatIdr(r.totalVal)}`,
                    }))}
                    formatAxisTick={(v) => `${formatDecimal(v, 0)}%`}
                    shape="column"
                  />
                  <div className="bg-[var(--surface)] overflow-x-auto border border-[var(--border)] rounded-xl">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                          <th className="text-left font-semibold px-3 py-2.5">Bulan</th>
                          <th className="text-right font-semibold px-3 py-2.5">Nilai PO Complete</th>
                          <th className="text-right font-semibold px-3 py-2.5">Nilai PO</th>
                          <th className="text-right font-semibold px-3 py-2.5">Close Index (%)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {closeRows.map((r) => (
                          <tr key={r.month}>
                            <td className="px-3 py-2 font-medium text-[var(--text)]">
                              {formatMonthShort(r.month)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--text)]">
                              {formatIdr(r.compVal)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--text)]">
                              {formatIdr(r.totalVal)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums font-bold text-[var(--accent)]">
                              {formatPct(r.valPct)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* 08. Purchase Price Index (PPI) */}
          {mode === 'purchase_price_index' && (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
              <div className="xl:col-span-5 min-w-0 space-y-5">
                <BiVerticalSingleChart
                  title="Purchase Price Index (%)"
                  subtitle="Perubahan agregat harga beli akhir barang bulan ini vs bulan lalu."
                  legendLabel="Purchase Price Index (%)"
                  data={monthlyRows.map((r) => ({
                    key: r.month,
                    label: formatMonthShort(r.month),
                    value: r.ppiPct,
                    valueLabel: formatPct(r.ppiPct, true),
                    hoverSummary: `${r.ppiItemCount} barang terbanding · Lalu: ${formatIdr(r.ppiPrevTotalPrice)} → Ini: ${formatIdr(r.ppiCurrTotalPrice)}`,
                  }))}
                  formatAxisTick={(v) => `${formatDecimal(v, 1)}%`}
                  shape="cone"
                />

                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-[var(--border)]">
                    <h4 className="font-display text-sm font-bold text-[var(--text)]">
                      Ringkasan PPI Bulanan (Pilih Bulan)
                    </h4>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                          <th className="text-left font-semibold px-4 py-2.5">Bulan</th>
                          <th className="text-right font-semibold px-4 py-2.5">Barang</th>
                          <th className="text-right font-semibold px-4 py-2.5">Purchase Price Index</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {monthlyRows.map((r) => {
                          const active = r.month === selectedPpiMonth;
                          return (
                            <tr
                              key={r.month}
                              onClick={() => setSelectedPpiMonth(r.month)}
                              className={`cursor-pointer transition-colors ${
                                active
                                  ? 'bg-[var(--accent)]/12 font-semibold'
                                  : 'hover:bg-[var(--bg)]/60'
                              }`}
                            >
                              <td className="px-4 py-2.5 text-[var(--text)] flex items-center gap-2">
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${
                                    active ? 'bg-[var(--accent)]' : 'bg-transparent'
                                  }`}
                                />
                                <span>{formatMonthShort(r.month)}</span>
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text-muted)]">
                                {formatNumberPlain(r.ppiItemCount)}
                              </td>
                              <td
                                className={`px-4 py-2.5 text-right font-mono tabular-nums font-bold ${
                                  r.ppiPct <= 0 ? 'text-[var(--accent)]' : 'text-amber-600 dark:text-amber-400'
                                }`}
                              >
                                {formatPct(r.ppiPct, true)}
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
                      Detail {selectedPpiMonth ? formatMonthFull(selectedPpiMonth) : '-'}
                    </h4>
                    <p className="text-xs text-[var(--text-muted)]">
                      Perbandingan harga beli akhir bulan lalu vs bulan ini ({ppiDetailItems.length} barang).
                    </p>
                  </div>
                  <div className="relative shrink-0">
                    <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={ppiSearch}
                      onChange={(e) => setPpiSearch(e.target.value)}
                      placeholder="Cari kode / barang..."
                      className="pl-8 pr-3 py-1.5 w-full sm:w-48 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                    />
                  </div>
                </div>

                {ppiDetailItems.length === 0 ? (
                  <div className="p-8 text-center text-xs text-[var(--text-muted)]">
                    Tidak ada barang yang memiliki riwayat harga beli pembanding pada bulan{' '}
                    {selectedPpiMonth ? formatMonthFull(selectedPpiMonth) : 'terpilih'}.
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-[540px]">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 z-10">
                        <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                          <th className="text-left font-semibold px-3 py-2.5">Kode Barang</th>
                          <th className="text-left font-semibold px-3 py-2.5">Nama Barang</th>
                          <th className="text-right font-semibold px-3 py-2.5">Harga Bulan Lalu</th>
                          <th className="text-right font-semibold px-3 py-2.5">Harga Bulan Ini</th>
                          <th className="text-right font-semibold px-3 py-2.5">Variasi Rp</th>
                          <th className="text-right font-semibold px-3 py-2.5">Variasi %</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {ppiDetailItems.map((item) => (
                          <tr key={item.itemId} className="hover:bg-[var(--bg)]/60">
                            <td className="px-3 py-2 font-mono text-[11px] text-[var(--text-muted)]">
                              {item.itemCode}
                            </td>
                            <td className="px-3 py-2 font-medium text-[var(--text)]">
                              {item.itemName}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--text)]">
                              {formatIdr(item.prevPrice)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--text)]">
                              {formatIdr(item.currPrice)}
                            </td>
                            <td
                              className={`px-3 py-2 text-right font-mono tabular-nums font-medium ${
                                item.varianceIdr <= 0 ? 'text-[var(--accent)]' : 'text-red-500'
                              }`}
                            >
                              {item.varianceIdr > 0 ? '+' : ''}
                              {formatIdr(item.varianceIdr)}
                            </td>
                            <td
                              className={`px-3 py-2 text-right font-mono tabular-nums font-bold ${
                                item.variancePct <= 0 ? 'text-[var(--accent)]' : 'text-red-500'
                              }`}
                            >
                              {formatPct(item.variancePct, true)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="sticky bottom-0">
                        <tr className="bg-[var(--bg)] border-t border-[var(--border)] font-bold">
                          <td colSpan={2} className="px-3 py-2.5 text-[var(--text)]">
                            Total ({ppiDetailItems.length} Barang)
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                            {formatIdr(ppiDetailTotals.sumPrev)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                            {formatIdr(ppiDetailTotals.sumCurr)}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-right font-mono tabular-nums ${
                              ppiDetailTotals.diff <= 0 ? 'text-[var(--accent)]' : 'text-red-500'
                            }`}
                          >
                            {ppiDetailTotals.diff > 0 ? '+' : ''}
                            {formatIdr(ppiDetailTotals.diff)}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-right font-mono tabular-nums ${
                              ppiDetailTotals.pct <= 0 ? 'text-[var(--accent)]' : 'text-red-500'
                            }`}
                          >
                            {formatPct(ppiDetailTotals.pct, true)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
