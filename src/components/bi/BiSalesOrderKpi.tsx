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
  useBiSalesPeriodData,
} from './biSalesShared';

export type SalesOrderKpiMode =
  | 'so_realization'
  | 'so_unfulfilled'
  | 'sales_close_index'
  | 'consumer_price_index';

interface BiSalesOrderKpiProps {
  mode: SalesOrderKpiMode;
  idToken: string | null;
  onDownloadBridge?: () => void;
}

const META: Record<
  SalesOrderKpiMode,
  { category: string; chartTypeLabel: string; title: string; description: string }
> = {
  so_realization: {
    category: 'Realisasi Order & Harga',
    chartTypeLabel: 'Diagram Kolom Ganda',
    title: '06. Realisasi Order Penjualan',
    description:
      'Persentase realisasi Sales Order (SO) berdasarkan jumlah barang yang terealisasi maupun nilai rupiah yang terealisasi per bulan.',
  },
  so_unfulfilled: {
    category: 'Realisasi Order & Harga',
    chartTypeLabel: 'Diagram Kolom Ganda',
    title: '06B. Order Penjualan Tidak Terpenuhi',
    description:
      'Persentase sisa Sales Order (SO) yang belum terpenuhi baik dari sisi jumlah barang maupun nilai rupiah per bulan.',
  },
  sales_close_index: {
    category: 'Realisasi Order & Harga',
    chartTypeLabel: 'Diagram Kolom Ganda',
    title: '07. Order Penjualan Complete (Sales Close Index)',
    description:
      'Persentase Sales Order (SO) berstatus Complete terhadap total SO baik berdasarkan jumlah dokumen maupun nilai transaksi.',
  },
  consumer_price_index: {
    category: 'Realisasi Order & Harga',
    chartTypeLabel: 'Diagram Kerucut Vertikal',
    title: '08. Perubahan Harga (Consumer Price Index)',
    description:
      'Indeks perubahan harga jual akhir barang dari bulan lalu ke bulan ini lengkap dengan rincian variasi Rp dan % per barang.',
  },
};

const REALIZATION_SOURCE_LABELS: Record<string, string> = {
  m5_do_detail: 'Relasi aktual Sales Order vs Delivery Order (non-void)',
  m5_si_detail: 'Relasi aktual Sales Order vs Faktur Penjualan (non-void)',
  m5_so_detail: 'Data realisasi item Sales Order',
  m5_so_status: 'Status dokumen Sales Order',
};

export const BiSalesOrderKpi: React.FC<BiSalesOrderKpiProps> = ({
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

  const [closeBasis, setCloseBasis] = useState<'complete_only' | 'complete_or_close'>('complete_only');
  const [selectedCpiMonth, setSelectedCpiMonth] = useState<string>('');
  const [cpiSearch, setCpiSearch] = useState<string>('');

  const meta = META[mode];

  // Auto-select latest month with CPI data
  useEffect(() => {
    if (mode !== 'consumer_price_index') return;
    if (monthlyRows.length === 0) return;
    const stillValid = monthlyRows.some((r) => r.month === selectedCpiMonth);
    if (!stillValid) {
      const withData = [...monthlyRows].reverse().find((r) => r.cpiItemCount > 0);
      setSelectedCpiMonth(withData?.month || monthlyRows[monthlyRows.length - 1].month);
    }
  }, [mode, monthlyRows, selectedCpiMonth]);

  // 06 & 06B computed rows
  const orderRealRows = useMemo(() => {
    return monthlyRows.map((r) => {
      const unfulfilledQty = Math.max(0, r.soItemQty - r.realizedItemQty);
      const unfulfilledVal = Math.max(0, r.soTotalValue - r.realizedTotalValue);
      const realQtyPct = r.soItemQty > 0 ? (r.realizedItemQty / r.soItemQty) * 100 : 0;
      const realValPct = r.soTotalValue > 0 ? (r.realizedTotalValue / r.soTotalValue) * 100 : 0;
      const unfulQtyPct = r.soItemQty > 0 ? (unfulfilledQty / r.soItemQty) * 100 : 0;
      const unfulValPct = r.soTotalValue > 0 ? (unfulfilledVal / r.soTotalValue) * 100 : 0;
      return {
        month: r.month,
        soQty: r.soItemQty,
        realQty: r.realizedItemQty,
        realQtyPct,
        unfulfilledQty,
        unfulQtyPct,
        soVal: r.soTotalValue,
        realVal: r.realizedTotalValue,
        realValPct,
        unfulfilledVal,
        unfulValPct,
      };
    });
  }, [monthlyRows]);

  // 07 Sales Close Index rows
  const closeRows = useMemo(() => {
    return monthlyRows.map((r) => {
      const compCount =
        closeBasis === 'complete_only' ? r.soCompleteCount : r.soCompleteOrCloseCount;
      const compVal =
        closeBasis === 'complete_only' ? r.soCompleteValue : r.soCompleteOrCloseValue;
      const countPct = r.soCount > 0 ? (compCount / r.soCount) * 100 : 0;
      const valPct = r.soTotalValue > 0 ? (compVal / r.soTotalValue) * 100 : 0;
      return {
        month: r.month,
        compCount,
        totalCount: r.soCount,
        countPct,
        compVal,
        totalVal: r.soTotalValue,
        valPct,
      };
    });
  }, [closeBasis, monthlyRows]);

  // 08 CPI detail rows
  const cpiDetailItems = useMemo(() => {
    const raw = (selectedCpiMonth && data?.cpiDetailsByMonth?.[selectedCpiMonth]) || [];
    const q = cpiSearch.trim().toLowerCase();
    if (!q) return raw;
    return raw.filter(
      (i) =>
        i.itemCode.toLowerCase().includes(q) || i.itemName.toLowerCase().includes(q)
    );
  }, [cpiSearch, data?.cpiDetailsByMonth, selectedCpiMonth]);

  const cpiDetailTotals = useMemo(() => {
    const sumPrev = cpiDetailItems.reduce((s, r) => s + r.prevPrice, 0);
    const sumCurr = cpiDetailItems.reduce((s, r) => s + r.currPrice, 0);
    const diff = sumCurr - sumPrev;
    const pct = sumPrev > 0 ? (diff / sumPrev) * 100 : 0;
    return { sumPrev, sumCurr, diff, pct };
  }, [cpiDetailItems]);

  const totals06 = useMemo(() => {
    const soQty = orderRealRows.reduce((s, r) => s + r.soQty, 0);
    const realQty = orderRealRows.reduce((s, r) => s + r.realQty, 0);
    const unfulQty = orderRealRows.reduce((s, r) => s + r.unfulfilledQty, 0);
    const soVal = orderRealRows.reduce((s, r) => s + r.soVal, 0);
    const realVal = orderRealRows.reduce((s, r) => s + r.realVal, 0);
    const unfulVal = orderRealRows.reduce((s, r) => s + r.unfulfilledVal, 0);
    return {
      soQty,
      realQty,
      unfulQty,
      realQtyPct: soQty > 0 ? (realQty / soQty) * 100 : 0,
      unfulQtyPct: soQty > 0 ? (unfulQty / soQty) * 100 : 0,
      soVal,
      realVal,
      unfulVal,
      realValPct: soVal > 0 ? (realVal / soVal) * 100 : 0,
      unfulValPct: soVal > 0 ? (unfulVal / soVal) * 100 : 0,
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
    if (cutoffWarning) {
      parts.push(`Periode transaksi aktif MyERP Plus dimulai sejak ${cutoffWarning}.`);
    }
    if ((mode === 'so_realization' || mode === 'so_unfulfilled') && data?.diagnostics?.realizationSource) {
      parts.push(
        `Basis realisasi: ${REALIZATION_SOURCE_LABELS[data.diagnostics.realizationSource] || data.diagnostics.realizationSource}.`
      );
    }
    if (mode === 'consumer_price_index') {
      parts.push(
        'Klik baris bulan pada tabel ringkasan di kiri untuk melihat rincian variasi harga per barang pada panel Detail.'
      );
    }
    return parts.length > 0 ? parts.join(' ') : null;
  }, [cutoffWarning, data?.diagnostics?.realizationSource, mode]);

  const handleExportCsv = () => {
    const suffix = `${selectedYear}_${String(effectiveStart).padStart(2, '0')}-${String(effectiveEnd).padStart(2, '0')}`;
    if (mode === 'so_realization') {
      downloadCsvFile(
        `bi_sales_06_realisasi_so_${suffix}.csv`,
        ['Bulan', 'Jml Barang SO', 'Jml Barang Realisasi SO', 'Barang Realisasi SO (%)', 'Nilai SO', 'Nilai Realisasi SO', 'Nilai Realisasi SO (%)'],
        orderRealRows.map((r) => [
          formatMonthShort(r.month),
          r.soQty,
          r.realQty,
          r.realQtyPct.toFixed(2),
          Math.round(r.soVal),
          Math.round(r.realVal),
          r.realValPct.toFixed(2),
        ])
      );
    } else if (mode === 'so_unfulfilled') {
      downloadCsvFile(
        `bi_sales_06B_so_tidak_terpenuhi_${suffix}.csv`,
        ['Bulan', 'Jml Barang SO', 'Jml Barang Tidak Terpenuhi', 'Barang Tidak Terpenuhi (%)', 'Nilai SO', 'Nilai Tidak Terpenuhi', 'Tidak Terpenuhi (%)'],
        orderRealRows.map((r) => [
          formatMonthShort(r.month),
          r.soQty,
          r.unfulfilledQty,
          r.unfulQtyPct.toFixed(2),
          Math.round(r.soVal),
          Math.round(r.unfulfilledVal),
          r.unfulValPct.toFixed(2),
        ])
      );
    } else if (mode === 'sales_close_index') {
      downloadCsvFile(
        `bi_sales_07_sales_close_index_${suffix}.csv`,
        ['Bulan', 'Jml SO Complete', 'Jml SO', 'Sales Close Index Qty (%)', 'Nilai SO Complete', 'Nilai SO', 'Sales Close Index Nilai (%)'],
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
        `bi_sales_08_cpi_${selectedCpiMonth || suffix}.csv`,
        ['Kode Barang', 'Nama Barang', 'Harga Akhir Bulan Lalu', 'Harga Akhir Bulan Ini', 'Variasi Rp', 'Variasi %'],
        cpiDetailItems.map((i) => [
          i.itemCode,
          i.itemName,
          Math.round(i.prevPrice),
          Math.round(i.currPrice),
          Math.round(i.varianceRp),
          i.variancePct.toFixed(2),
        ])
      );
    }
  };

  const extraControls = (
    <>
      {mode === 'sales_close_index' && (
        <div className="space-y-1 ml-auto">
          <span className="block text-[11px] font-medium text-[var(--text-muted)]">
            Status Complete SO
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
        onRetry={() => void fetchSalesBiData({ refresh: true })}
        onResetPeriod={handleResetActivePeriod}
        onDownloadBridge={onDownloadBridge}
      />

      {!errorMsg && data && monthlyRows.length > 0 && (
        <div
          className={`space-y-5 transition-opacity duration-150 ${loading ? 'opacity-65' : 'opacity-100'}`}
        >
          {/* 06. Realisasi Order Penjualan */}
          {mode === 'so_realization' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Total Barang SO</span>
                  <p className="font-mono text-xl font-bold text-[var(--text)] tabular-nums">
                    {formatNumberPlain(totals06.soQty)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Terealisasi: {formatNumberPlain(totals06.realQty)} unit
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Barang Realisasi SO</span>
                  <p className="font-mono text-xl font-bold text-[var(--accent)] tabular-nums">
                    {formatPct(totals06.realQtyPct)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Jml Barang Realisasi ÷ Jml Barang SO
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Total Nilai SO</span>
                  <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate">
                    {formatIdr(totals06.soVal)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block truncate">
                    Realisasi: {formatIdr(totals06.realVal)}
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Nilai Realisasi SO</span>
                  <p className="font-mono text-xl font-bold text-[var(--accent)] tabular-nums">
                    {formatPct(totals06.realValPct)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Nilai Realisasi ÷ Nilai SO
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                {/* Left: Qty Realization */}
                <div className="min-w-0 space-y-4">
                  <BiVerticalSingleChart
                    title="Barang Realisasi SO (%)"
                    subtitle="Perbandingan jumlah barang terealisasi terhadap jumlah barang SO."
                    legendLabel="Barang Realisasi SO (%)"
                    data={orderRealRows.map((r) => ({
                      key: r.month,
                      label: formatMonthShort(r.month),
                      value: r.realQtyPct,
                      valueLabel: formatPct(r.realQtyPct),
                      hoverSummary: `Realisasi: ${formatNumberPlain(r.realQty)} / ${formatNumberPlain(r.soQty)} unit`,
                    }))}
                    formatAxisTick={(v) => `${formatDecimal(v, 0)}%`}
                    shape="column"
                  />
                  <div className="bg-[var(--surface)] overflow-x-auto border border-[var(--border)] rounded-xl">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                          <th className="text-left font-semibold px-3 py-2.5">Bulan</th>
                          <th className="text-right font-semibold px-3 py-2.5">Jml Barang SO</th>
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
                              {formatNumberPlain(r.soQty)}
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

                {/* Right: Value Realization */}
                <div className="min-w-0 space-y-4">
                  <BiVerticalSingleChart
                    title="Nilai Realisasi SO (%)"
                    subtitle="Perbandingan nilai rupiah terealisasi terhadap total nilai SO."
                    legendLabel="Nilai Realisasi SO (%)"
                    data={orderRealRows.map((r) => ({
                      key: r.month,
                      label: formatMonthShort(r.month),
                      value: r.realValPct,
                      valueLabel: formatPct(r.realValPct),
                      hoverSummary: `Realisasi: ${formatIdr(r.realVal)} / ${formatIdr(r.soVal)}`,
                    }))}
                    formatAxisTick={(v) => `${formatDecimal(v, 0)}%`}
                    shape="column"
                  />
                  <div className="bg-[var(--surface)] overflow-x-auto border border-[var(--border)] rounded-xl">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                          <th className="text-left font-semibold px-3 py-2.5">Bulan</th>
                          <th className="text-right font-semibold px-3 py-2.5">Nilai SO</th>
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
                              {formatIdr(r.soVal)}
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

          {/* 06B. Order Penjualan Tidak Terpenuhi */}
          {mode === 'so_unfulfilled' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Barang Tidak Terpenuhi</span>
                  <p className="font-mono text-xl font-bold text-[var(--text)] tabular-nums">
                    {formatNumberPlain(totals06.unfulQty)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Dari {formatNumberPlain(totals06.soQty)} unit SO
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">% Barang Tidak Terpenuhi</span>
                  <p className="font-mono text-xl font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                    {formatPct(totals06.unfulQtyPct)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    (SO − Realisasi) ÷ Total Barang SO
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Nilai Tidak Terpenuhi</span>
                  <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate">
                    {formatIdr(totals06.unfulVal)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block truncate">
                    Dari {formatIdr(totals06.soVal)}
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">% Nilai Tidak Terpenuhi</span>
                  <p className="font-mono text-xl font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                    {formatPct(totals06.unfulValPct)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    (Nilai SO − Realisasi) ÷ Nilai SO
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                <div className="min-w-0 space-y-4">
                  <BiVerticalSingleChart
                    title="Barang Tidak Terpenuhi (%)"
                    subtitle="Persentase jumlah barang SO yang belum terealisasi pengiriman."
                    legendLabel="Barang Tidak Terpenuhi (%)"
                    data={orderRealRows.map((r) => ({
                      key: r.month,
                      label: formatMonthShort(r.month),
                      value: r.unfulQtyPct,
                      valueLabel: formatPct(r.unfulQtyPct),
                      hoverSummary: `Tidak terpenuhi: ${formatNumberPlain(r.unfulfilledQty)} / ${formatNumberPlain(r.soQty)} unit`,
                    }))}
                    formatAxisTick={(v) => `${formatDecimal(v, 0)}%`}
                    shape="column"
                  />
                  <div className="bg-[var(--surface)] overflow-x-auto border border-[var(--border)] rounded-xl">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                          <th className="text-left font-semibold px-3 py-2.5">Bulan</th>
                          <th className="text-right font-semibold px-3 py-2.5">Jml Barang SO</th>
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
                              {formatNumberPlain(r.soQty)}
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
                    subtitle="Persentase nilai rupiah SO yang belum terealisasi."
                    legendLabel="Nilai Tidak Terpenuhi (%)"
                    data={orderRealRows.map((r) => ({
                      key: r.month,
                      label: formatMonthShort(r.month),
                      value: r.unfulValPct,
                      valueLabel: formatPct(r.unfulValPct),
                      hoverSummary: `Tidak terpenuhi: ${formatIdr(r.unfulfilledVal)} / ${formatIdr(r.soVal)}`,
                    }))}
                    formatAxisTick={(v) => `${formatDecimal(v, 0)}%`}
                    shape="column"
                  />
                  <div className="bg-[var(--surface)] overflow-x-auto border border-[var(--border)] rounded-xl">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                          <th className="text-left font-semibold px-3 py-2.5">Bulan</th>
                          <th className="text-right font-semibold px-3 py-2.5">Nilai SO</th>
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
                              {formatIdr(r.soVal)}
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

          {/* 07. Sales Close Index */}
          {mode === 'sales_close_index' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">SO Status Complete</span>
                  <p className="font-mono text-xl font-bold text-[var(--text)] tabular-nums">
                    {formatNumberPlain(totals07.compCount)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Dari {formatNumberPlain(totals07.totalCount)} total SO
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Sales Close Index (Qty)</span>
                  <p className="font-mono text-xl font-bold text-[var(--accent)] tabular-nums">
                    {formatPct(totals07.countPct)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Jml SO Complete ÷ Total SO
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Nilai SO Complete</span>
                  <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate">
                    {formatIdr(totals07.compVal)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block truncate">
                    Dari {formatIdr(totals07.totalVal)}
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Sales Close Index (Nilai)</span>
                  <p className="font-mono text-xl font-bold text-[var(--accent)] tabular-nums">
                    {formatPct(totals07.valPct)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Nilai SO Complete ÷ Total Nilai SO
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                <div className="min-w-0 space-y-4">
                  <BiVerticalSingleChart
                    title="Sales Close Index — Jumlah SO (%)"
                    subtitle="Persentase dokumen SO berstatus Complete per bulan."
                    legendLabel="Sales Close Index (%)"
                    data={closeRows.map((r) => ({
                      key: r.month,
                      label: formatMonthShort(r.month),
                      value: r.countPct,
                      valueLabel: formatPct(r.countPct),
                      hoverSummary: `Complete: ${formatNumberPlain(r.compCount)} / ${formatNumberPlain(r.totalCount)} SO`,
                    }))}
                    formatAxisTick={(v) => `${formatDecimal(v, 0)}%`}
                    shape="column"
                  />
                  <div className="bg-[var(--surface)] overflow-x-auto border border-[var(--border)] rounded-xl">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                          <th className="text-left font-semibold px-3 py-2.5">Bulan</th>
                          <th className="text-right font-semibold px-3 py-2.5">Jml SO Complete</th>
                          <th className="text-right font-semibold px-3 py-2.5">Jml SO</th>
                          <th className="text-right font-semibold px-3 py-2.5">Sales Close Index</th>
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
                    title="Sales Close Index — Nilai SO (%)"
                    subtitle="Persentase nilai rupiah SO berstatus Complete per bulan."
                    legendLabel="Sales Close Index (%)"
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
                          <th className="text-right font-semibold px-3 py-2.5">Nilai SO Complete</th>
                          <th className="text-right font-semibold px-3 py-2.5">Nilai SO</th>
                          <th className="text-right font-semibold px-3 py-2.5">Sales Close Index</th>
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

          {/* 08. Consumer Price Index (CPI) */}
          {mode === 'consumer_price_index' && (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
              {/* Left: Monthly CPI Table + Cone Chart */}
              <div className="xl:col-span-5 min-w-0 space-y-5">
                <BiVerticalSingleChart
                  title="Consumer Price Index (%)"
                  subtitle="Perubahan agregat harga jual akhir barang bulan ini vs bulan lalu."
                  legendLabel="Consumer Price Index (%)"
                  data={monthlyRows.map((r) => ({
                    key: r.month,
                    label: formatMonthShort(r.month),
                    value: r.cpiPct,
                    valueLabel: formatPct(r.cpiPct, true),
                    hoverSummary: `${r.cpiItemCount} barang terbanding · Lalu: ${formatIdr(r.cpiPrevBasketPrice)} → Ini: ${formatIdr(r.cpiCurrBasketPrice)}`,
                  }))}
                  formatAxisTick={(v) => `${formatDecimal(v, 1)}%`}
                  shape="cone"
                />

                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-[var(--border)]">
                    <h4 className="font-display text-sm font-bold text-[var(--text)]">
                      Ringkasan CPI Bulanan (Pilih Bulan)
                    </h4>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                          <th className="text-left font-semibold px-4 py-2.5">Bulan</th>
                          <th className="text-right font-semibold px-4 py-2.5">Barang</th>
                          <th className="text-right font-semibold px-4 py-2.5">Consumer Price Index</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {monthlyRows.map((r) => {
                          const active = r.month === selectedCpiMonth;
                          return (
                            <tr
                              key={r.month}
                              onClick={() => setSelectedCpiMonth(r.month)}
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
                                {formatNumberPlain(r.cpiItemCount)}
                              </td>
                              <td
                                className={`px-4 py-2.5 text-right font-mono tabular-nums font-bold ${
                                  r.cpiPct >= 0 ? 'text-[var(--accent)]' : 'text-red-500'
                                }`}
                              >
                                {formatPct(r.cpiPct, true)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Right: Detail Per Barang */}
              <div className="xl:col-span-7 min-w-0 bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden flex flex-col">
                <div className="px-5 py-3.5 border-b border-[var(--border)] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h4 className="font-display text-sm font-bold text-[var(--text)] leading-snug">
                      Detail {selectedCpiMonth ? formatMonthFull(selectedCpiMonth) : '-'}
                    </h4>
                    <p className="text-xs text-[var(--text-muted)]">
                      Perbandingan harga akhir bulan lalu vs bulan ini ({cpiDetailItems.length} barang).
                    </p>
                  </div>
                  <div className="relative shrink-0">
                    <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={cpiSearch}
                      onChange={(e) => setCpiSearch(e.target.value)}
                      placeholder="Cari kode / barang..."
                      className="pl-8 pr-3 py-1.5 w-full sm:w-48 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
                    />
                  </div>
                </div>

                {cpiDetailItems.length === 0 ? (
                  <div className="p-8 text-center text-xs text-[var(--text-muted)]">
                    Tidak ada barang yang memiliki riwayat harga pembanding pada bulan{' '}
                    {selectedCpiMonth ? formatMonthFull(selectedCpiMonth) : 'terpilih'}.
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
                        {cpiDetailItems.map((item) => (
                          <tr key={item.itemId} className="hover:bg-[var(--bg)]/60">
                            <td className="px-3 py-2 font-mono text-[var(--text-muted)] whitespace-nowrap">
                              {item.itemCode}
                            </td>
                            <td className="px-3 py-2 font-medium text-[var(--text)]">
                              {item.itemName}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--text)] whitespace-nowrap">
                              {formatIdr(item.prevPrice)}
                            </td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--text)] whitespace-nowrap">
                              {formatIdr(item.currPrice)}
                            </td>
                            <td
                              className={`px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap ${
                                item.varianceRp >= 0 ? 'text-[var(--accent)]' : 'text-red-500'
                              }`}
                            >
                              {item.varianceRp > 0 ? '+' : ''}
                              {formatIdr(item.varianceRp)}
                            </td>
                            <td
                              className={`px-3 py-2 text-right font-mono tabular-nums font-bold whitespace-nowrap ${
                                item.variancePct >= 0 ? 'text-[var(--accent)]' : 'text-red-500'
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
                            Total Basket ({cpiDetailItems.length} Barang)
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                            {formatIdr(cpiDetailTotals.sumPrev)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                            {formatIdr(cpiDetailTotals.sumCurr)}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-right font-mono tabular-nums ${
                              cpiDetailTotals.diff >= 0 ? 'text-[var(--accent)]' : 'text-red-500'
                            }`}
                          >
                            {cpiDetailTotals.diff > 0 ? '+' : ''}
                            {formatIdr(cpiDetailTotals.diff)}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-right font-mono tabular-nums ${
                              cpiDetailTotals.pct >= 0 ? 'text-[var(--accent)]' : 'text-red-500'
                            }`}
                          >
                            {formatPct(cpiDetailTotals.pct, true)}
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
