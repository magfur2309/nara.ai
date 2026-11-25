import React, { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import {
  BiHorizontalBarChart,
  BiKpiHeaderAndFilter,
  BiKpiStateViews,
  BiVerticalSingleChart,
} from './BiFinanceChartPrimitives';
import {
  downloadCsvFile,
  formatCompactIdr,
  formatDecimal,
  formatIdr,
  formatMonthShort,
  formatNumberPlain,
  formatPct,
  useBiPurchasingPeriodData,
} from './biOperationsShared';

export type PurchasingSupplierKpiMode =
  | 'supplier_growth'
  | 'supplier_spend'
  | 'supplier_turnover'
  | 'purchase_opportunity';

interface BiPurchasingSupplierKpiProps {
  mode: PurchasingSupplierKpiMode;
  idToken: string | null;
  onDownloadBridge?: () => void;
}

const META: Record<
  PurchasingSupplierKpiMode,
  { category: string; chartTypeLabel: string; title: string; description: string }
> = {
  supplier_growth: {
    category: 'Supplier & Peluang',
    chartTypeLabel: 'Diagram Kolom Vertikal',
    title: '01. Pertumbuhan Supplier (Supplier Growth)',
    description:
      'Membandingkan jumlah supplier aktif bertransaksi bulan ini terhadap bulan sebelumnya beserta pertumbuhan nominal dan persentasenya.',
  },
  supplier_spend: {
    category: 'Supplier & Peluang',
    chartTypeLabel: 'Diagram Kolom Vertikal',
    title: '02. Pembelian per Supplier (Supplier Spend & OTD)',
    description:
      'Peringkat kontribusi Pembelian DPP, Total Terbayar, Sisa Hutang, Porsi Belanja, dan Ketepatan Kirim (OTD) per supplier.',
  },
  supplier_turnover: {
    category: 'Supplier & Peluang',
    chartTypeLabel: 'Diagram Batang Horizontal',
    title: '03. Supplier Tidak Aktif (Supplier Turnover Rate)',
    description:
      'Persentase supplier yang tidak lagi bertransaksi bulan ini dibandingkan basis supplier aktif per bulan.',
  },
  purchase_opportunity: {
    category: 'Supplier & Peluang',
    chartTypeLabel: 'Diagram Kolom Vertikal',
    title: '04. Order Pembelian (Purchase Opportunity)',
    description:
      'Rasio perbandingan jumlah Purchase Order (PO) bulan ini terhadap bulan lalu untuk mengukur tren volume pengadaan.',
  },
};

export const BiPurchasingSupplierKpi: React.FC<BiPurchasingSupplierKpiProps> = ({
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

  const [growthBasis, setGrowthBasis] = useState<'ri' | 'po'>('ri');
  const [turnoverBasis, setTurnoverBasis] = useState<'mom' | 'rolling3m'>('mom');
  const [topN, setTopN] = useState<number>(10);
  const [supplierSearch, setSupplierSearch] = useState<string>('');

  const meta = META[mode];

  // Filter out completely empty months (e.g. future months)
  const monthlyRows = useMemo(() => {
    const all = data?.monthly || [];
    return all.filter(
      (r) =>
        r.activeSuppliersRi > 0 ||
        r.prevSuppliersRi > 0 ||
        r.activeSuppliersPo > 0 ||
        r.prevSuppliersPo > 0 ||
        r.poCount > 0 ||
        r.prevPoCount > 0 ||
        r.grnTotalCount > 0 ||
        r.riTotalCount > 0 ||
        r.riDppIdr > 0
    );
  }, [data?.monthly]);

  // 01. Supplier Growth rows
  const growthRows = useMemo(() => {
    return monthlyRows.map((r) => {
      const prev =
        Number(growthBasis === 'ri' ? r.prevSuppliersRi : r.prevSuppliersPo) || 0;
      const curr =
        Number(growthBasis === 'ri' ? r.activeSuppliersRi : r.activeSuppliersPo) || 0;
      const diff = curr - prev;
      const pct = prev > 0 ? (diff / prev) * 100 : 0;
      return { month: r.month, prev, curr, diff, pct };
    });
  }, [growthBasis, monthlyRows]);

  // 02. Supplier Spend rows
  const filteredSpendRows = useMemo(() => {
    const all = data?.supplierSpend || [];
    const q = supplierSearch.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (s) =>
        s.supplierName.toLowerCase().includes(q) || s.supplierCode.toLowerCase().includes(q)
    );
  }, [data?.supplierSpend, supplierSearch]);

  const displayedSpendRows = useMemo(() => {
    if (topN <= 0) return filteredSpendRows;
    return filteredSpendRows.slice(0, topN);
  }, [filteredSpendRows, topN]);

  // 03. Supplier Turnover rows
  const turnoverRows = useMemo(() => {
    return monthlyRows.map((r) => {
      const churned =
        Number(
          turnoverBasis === 'mom' ? r.churnedSuppliersPrevMonth : r.churnedSuppliersRolling3m
        ) || 0;
      const activeRi = Number(r.activeSuppliersRi) || 0;
      const prevRi = Number(r.prevSuppliersRi) || 0;
      const activeBase = Math.max(activeRi, prevRi, churned);
      const ratePct = activeBase > 0 ? (churned / activeBase) * 100 : 0;
      return { month: r.month, churned, activeBase, ratePct };
    });
  }, [monthlyRows, turnoverBasis]);

  // 04. Purchase Opportunity rows
  const oppRows = useMemo(() => {
    return monthlyRows.map((r) => {
      const prevPo = Number(r.prevPoCount) || 0;
      const currPo = Number(r.poCount) || 0;
      const ratio = prevPo > 0 ? currPo / prevPo : 0;
      return {
        month: r.month,
        prevPo,
        currPo,
        ratio,
      };
    });
  }, [monthlyRows]);

  const hasRecords =
    mode === 'supplier_spend'
      ? (data?.supplierSpend?.length || 0) > 0
      : monthlyRows.length > 0;

  const noticeMessage = useMemo(() => {
    const parts: string[] = [];
    if (data?.cutoffDate) {
      parts.push(`Cut-off transaksi aktif MyERP Plus dimulai sejak ${data.cutoffDate}.`);
    }
    if (mode === 'supplier_turnover' && data?.masterSuppliers) {
      parts.push(
        `Master supplier: ${formatNumberPlain(data.masterSuppliers.active)} aktif · ${formatNumberPlain(data.masterSuppliers.inactive)} non-aktif.`
      );
    }
    return parts.length > 0 ? parts.join(' ') : null;
  }, [data?.cutoffDate, data?.masterSuppliers, mode]);

  const handleExportCsv = () => {
    const suffix = `${selectedYear}_${String(effectiveStart).padStart(2, '0')}-${String(effectiveEnd).padStart(2, '0')}`;
    if (mode === 'supplier_growth') {
      downloadCsvFile(
        `bi_purchasing_01_supplier_growth_${suffix}.csv`,
        ['Bulan', 'Jml Supplier Bulan Lalu', 'Jml Supplier Bulan Ini', 'Pertumbuhan', 'Pertumbuhan (%)'],
        growthRows.map((r) => [formatMonthShort(r.month), r.prev, r.curr, r.diff, r.pct.toFixed(2)])
      );
    } else if (mode === 'supplier_spend') {
      downloadCsvFile(
        `bi_purchasing_02_supplier_spend_${suffix}.csv`,
        ['Kode Supplier', 'Nama Supplier', 'Jml Faktur', 'Pembelian DPP (IDR)', 'Terbayar (IDR)', 'Sisa Hutang (IDR)', 'Porsi (%)', 'OTD (%)'],
        displayedSpendRows.map((s) => [
          s.supplierCode,
          s.supplierName,
          s.invoiceCount,
          Math.round(s.dppIdr),
          Math.round(s.paidIdr),
          Math.round(s.payableIdr),
          s.sharePct.toFixed(2),
          s.otdPct !== null ? s.otdPct.toFixed(2) : '-',
        ])
      );
    } else if (mode === 'supplier_turnover') {
      downloadCsvFile(
        `bi_purchasing_03_supplier_turnover_${suffix}.csv`,
        ['Bulan', 'Jml Supplier Tidak Berlanjut', 'Basis Supplier Aktif', 'Supplier Turnover Rate (%)'],
        turnoverRows.map((r) => [formatMonthShort(r.month), r.churned, r.activeBase, r.ratePct.toFixed(2)])
      );
    } else {
      downloadCsvFile(
        `bi_purchasing_04_purchase_opportunity_${suffix}.csv`,
        ['Bulan', 'Jml PO Bulan Lalu', 'Jml PO Bulan Ini', 'Purchase Opportunity (x)'],
        oppRows.map((r) => [formatMonthShort(r.month), r.prevPo, r.currPo, r.ratio.toFixed(2)])
      );
    }
  };

  const extraControls = (
    <>
      {mode === 'supplier_growth' && (
        <div className="space-y-1 ml-auto">
          <span className="block text-[11px] font-medium text-[var(--text-muted)]">
            Basis Supplier Aktif
          </span>
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
            <button
              type="button"
              onClick={() => setGrowthBasis('ri')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md cursor-pointer whitespace-nowrap ${
                growthBasis === 'ri'
                  ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              Faktur Pembelian (RI)
            </button>
            <button
              type="button"
              onClick={() => setGrowthBasis('po')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md cursor-pointer whitespace-nowrap ${
                growthBasis === 'po'
                  ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              Purchase Order (PO)
            </button>
          </div>
        </div>
      )}

      {mode === 'supplier_spend' && (
        <div className="flex flex-wrap items-end gap-2 ml-auto">
          <div className="space-y-1">
            <span className="block text-[11px] font-medium text-[var(--text-muted)]">
              Cari Supplier
            </span>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={supplierSearch}
                onChange={(e) => setSupplierSearch(e.target.value)}
                placeholder="Nama / kode..."
                className="pl-8 pr-3 py-1.5 w-44 text-xs rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>
          </div>
          <div className="space-y-1">
            <span className="block text-[11px] font-medium text-[var(--text-muted)]">
              Tampilkan
            </span>
            <select
              value={topN}
              onChange={(e) => setTopN(Number(e.target.value))}
              className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] cursor-pointer"
            >
              <option value={10}>Top 10 Supplier</option>
              <option value={20}>Top 20 Supplier</option>
              <option value={50}>Top 50 Supplier</option>
              <option value={0}>Semua Supplier</option>
            </select>
          </div>
        </div>
      )}

      {mode === 'supplier_turnover' && (
        <div className="space-y-1 ml-auto">
          <span className="block text-[11px] font-medium text-[var(--text-muted)]">
            Definisi Churn Transaksi
          </span>
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
            <button
              type="button"
              onClick={() => setTurnoverBasis('mom')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md cursor-pointer whitespace-nowrap ${
                turnoverBasis === 'mom'
                  ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              Bulan Sebelumnya (M-1)
            </button>
            <button
              type="button"
              onClick={() => setTurnoverBasis('rolling3m')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md cursor-pointer whitespace-nowrap ${
                turnoverBasis === 'rolling3m'
                  ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              Jendela 3 Bulan
            </button>
          </div>
        </div>
      )}
    </>
  );

  // Summary computations
  const growthLast = growthRows[growthRows.length - 1];
  const growthAvgPct =
    growthRows.length > 0 ? growthRows.reduce((s, r) => s + r.pct, 0) / growthRows.length : 0;

  const spendTotals = useMemo(() => {
    const dpp = displayedSpendRows.reduce((s, r) => s + r.dppIdr, 0);
    const paid = displayedSpendRows.reduce((s, r) => s + r.paidIdr, 0);
    const payable = displayedSpendRows.reduce((s, r) => s + r.payableIdr, 0);
    const invoices = displayedSpendRows.reduce((s, r) => s + r.invoiceCount, 0);
    return { dpp, paid, payable, invoices };
  }, [displayedSpendRows]);

  const turnoverAvgRate =
    turnoverRows.length > 0
      ? turnoverRows.reduce((s, r) => s + r.ratePct, 0) / turnoverRows.length
      : 0;
  const turnoverTotalChurned = turnoverRows.reduce((s, r) => s + r.churned, 0);
  const turnoverLast = turnoverRows[turnoverRows.length - 1];

  const oppTotalPo = oppRows.reduce((s, r) => s + r.currPo, 0);
  const oppValid = oppRows.filter((r) => r.prevPo > 0);
  const oppAvgRatio =
    oppValid.length > 0 ? oppValid.reduce((s, r) => s + r.ratio, 0) / oppValid.length : 0;
  const oppLast = oppRows[oppRows.length - 1];

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
        onRetry={() => void fetchData({ refresh: true })}
        onResetPeriod={resetToActivePeriod}
        onDownloadBridge={onDownloadBridge}
      />

      {!errorMsg && data && hasRecords && (
        <div
          className={`space-y-5 transition-opacity duration-150 ${loading ? 'opacity-65' : 'opacity-100'}`}
        >
          {/* 01. Pertumbuhan Supplier */}
          {mode === 'supplier_growth' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Supplier Bulan Lalu</span>
                  <p className="font-mono text-xl font-bold text-[var(--text)] tabular-nums">
                    {formatNumberPlain(growthLast?.prev ?? 0)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Basis perbandingan terakhir
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Supplier Bulan Ini</span>
                  <p className="font-mono text-xl font-bold text-[var(--text)] tabular-nums">
                    {formatNumberPlain(growthLast?.curr ?? 0)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    {growthLast ? formatMonthShort(growthLast.month) : '-'}
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Pertumbuhan Bersih</span>
                  <p
                    className={`font-mono text-xl font-bold tabular-nums ${
                      (growthLast?.diff ?? 0) >= 0 ? 'text-[var(--accent)]' : 'text-red-500'
                    }`}
                  >
                    {(growthLast?.diff ?? 0) > 0 ? '+' : ''}
                    {formatNumberPlain(growthLast?.diff ?? 0)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Supplier bulan terakhir
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Rata-rata Pertumbuhan</span>
                  <p
                    className={`font-mono text-xl font-bold tabular-nums ${
                      growthAvgPct >= 0 ? 'text-[var(--accent)]' : 'text-red-500'
                    }`}
                  >
                    {formatPct(growthAvgPct, true)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Bulan terakhir: {formatPct(growthLast?.pct ?? 0, true)}
                  </span>
                </div>
              </div>

              <BiVerticalSingleChart
                title="Pertumbuhan Supplier (%)"
                subtitle="Persentase pertumbuhan jumlah supplier aktif antarbulan (MoM)."
                legendLabel="Pertumbuhan (%)"
                data={growthRows.map((r) => ({
                  key: r.month,
                  label: formatMonthShort(r.month),
                  value: r.pct,
                  valueLabel: formatPct(r.pct, true),
                  hoverSummary: `Lalu: ${formatNumberPlain(r.prev)} · Ini: ${formatNumberPlain(r.curr)} (${r.diff >= 0 ? '+' : ''}${formatNumberPlain(r.diff)})`,
                }))}
                formatAxisTick={(v) => `${formatDecimal(v, 0)}%`}
                shape="column"
              />

              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[var(--border)]">
                  <h4 className="font-display text-sm font-bold text-[var(--text)]">
                    Tabel Pertumbuhan Supplier Bulanan
                  </h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                        <th className="text-left font-semibold px-4 py-2.5">Bulan</th>
                        <th className="text-right font-semibold px-4 py-2.5">Jml Supplier Bulan Lalu</th>
                        <th className="text-right font-semibold px-4 py-2.5">Jml Supplier Bulan Ini</th>
                        <th className="text-right font-semibold px-4 py-2.5">Pertumbuhan</th>
                        <th className="text-right font-semibold px-4 py-2.5">Pertumbuhan (%)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {growthRows.map((r) => (
                        <tr key={r.month} className="hover:bg-[var(--bg)]/60">
                          <td className="px-4 py-2.5 font-medium text-[var(--text)]">
                            {formatMonthShort(r.month)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                            {formatNumberPlain(r.prev)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                            {formatNumberPlain(r.curr)}
                          </td>
                          <td
                            className={`px-4 py-2.5 text-right font-mono tabular-nums font-medium ${
                              r.diff >= 0 ? 'text-[var(--accent)]' : 'text-red-500'
                            }`}
                          >
                            {r.diff > 0 ? '+' : ''}
                            {formatNumberPlain(r.diff)}
                          </td>
                          <td
                            className={`px-4 py-2.5 text-right font-mono tabular-nums font-bold ${
                              r.pct >= 0 ? 'text-[var(--accent)]' : 'text-red-500'
                            }`}
                          >
                            {formatPct(r.pct, true)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* 02. Pembelian per Supplier */}
          {mode === 'supplier_spend' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Total Pembelian (DPP)</span>
                  <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate">
                    {formatIdr(spendTotals.dpp)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    {displayedSpendRows.length} supplier · {formatNumberPlain(spendTotals.invoices)} faktur
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Total Terbayar</span>
                  <p className="font-mono text-lg font-bold text-[var(--accent)] tabular-nums truncate">
                    {formatIdr(spendTotals.paid)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Pembayaran + uang muka faktur (RI)
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Sisa Hutang (AP)</span>
                  <p className="font-mono text-lg font-bold text-amber-600 dark:text-amber-400 tabular-nums truncate">
                    {formatIdr(spendTotals.payable)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Belum terbayar pada periode
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Top 1 Supplier &amp; Porsi</span>
                  <p className="font-mono text-xl font-bold text-[var(--accent)] tabular-nums">
                    {displayedSpendRows[0] ? formatPct(displayedSpendRows[0].sharePct) : '0,00%'}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block truncate" title={displayedSpendRows[0]?.supplierName}>
                    {displayedSpendRows[0]?.supplierName || '-'}
                  </span>
                </div>
              </div>

              <BiVerticalSingleChart
                title={`Nilai Pembelian per Supplier (Top ${Math.min(12, displayedSpendRows.length)})`}
                subtitle="Peringkat supplier berdasarkan total nilai pembelian DPP IDR pada periode."
                legendLabel="Pembelian DPP (IDR)"
                data={displayedSpendRows.slice(0, 12).map((s) => ({
                  key: String(s.supplierId),
                  label:
                    s.supplierName.length > 14
                      ? `${s.supplierName.slice(0, 13)}…`
                      : s.supplierName,
                  value: s.dppIdr,
                  valueLabel: formatCompactIdr(s.dppIdr),
                  hoverSummary: `${s.supplierName} · DPP: ${formatIdr(s.dppIdr)} · Porsi: ${formatPct(s.sharePct)}${s.otdPct !== null ? ` · OTD: ${formatPct(s.otdPct)}` : ''}`,
                }))}
                formatAxisTick={(v) => formatCompactIdr(v)}
                shape="column"
              />

              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[var(--border)] flex items-center justify-between gap-2">
                  <h4 className="font-display text-sm font-bold text-[var(--text)]">
                    Tabel Pembelian &amp; Performa per Supplier ({displayedSpendRows.length} dari {filteredSpendRows.length})
                  </h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                        <th className="text-left font-semibold px-4 py-2.5 w-10">#</th>
                        <th className="text-left font-semibold px-4 py-2.5">Nama Supplier</th>
                        <th className="text-right font-semibold px-4 py-2.5">Faktur</th>
                        <th className="text-right font-semibold px-4 py-2.5">Pembelian DPP</th>
                        <th className="text-right font-semibold px-4 py-2.5">Terbayar</th>
                        <th className="text-right font-semibold px-4 py-2.5">Sisa Hutang</th>
                        <th className="text-right font-semibold px-4 py-2.5">Porsi (%)</th>
                        <th className="text-right font-semibold px-4 py-2.5">OTD (%)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {displayedSpendRows.map((s, idx) => (
                        <tr key={s.supplierId} className="hover:bg-[var(--bg)]/60">
                          <td className="px-4 py-2.5 font-mono text-[var(--text-muted)]">
                            {idx + 1}
                          </td>
                          <td className="px-4 py-2.5 font-medium text-[var(--text)]">
                            <div>{s.supplierName}</div>
                            <div className="text-[11px] font-mono text-[var(--text-muted)]">
                              {s.supplierCode}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text-muted)]">
                            {formatNumberPlain(s.invoiceCount)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums font-bold text-[var(--text)]">
                            {formatIdr(s.dppIdr)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--accent)]">
                            {formatIdr(s.paidIdr)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums text-amber-600 dark:text-amber-400">
                            {formatIdr(s.payableIdr)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                            {formatPct(s.sharePct)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums font-semibold text-[var(--accent)]">
                            {s.otdPct !== null ? formatPct(s.otdPct) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-[var(--bg)] border-t border-[var(--border)] font-bold">
                        <td colSpan={3} className="px-4 py-2.5 text-[var(--text)]">
                          Total ({displayedSpendRows.length} Supplier)
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                          {formatIdr(spendTotals.dpp)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--accent)]">
                          {formatIdr(spendTotals.paid)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-amber-600 dark:text-amber-400">
                          {formatIdr(spendTotals.payable)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                          —
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                          —
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* 03. Supplier Turnover Rate */}
          {mode === 'supplier_turnover' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Rata-rata Turnover Rate</span>
                  <p className="font-mono text-xl font-bold text-[var(--accent)] tabular-nums">
                    {formatPct(turnoverAvgRate)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Proporsi supplier tidak berulang
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Total Tidak Berlanjut</span>
                  <p className="font-mono text-xl font-bold text-[var(--text)] tabular-nums">
                    {formatNumberPlain(turnoverTotalChurned)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Akumulasi {turnoverRows.length} bulan
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Turnover Bulan Terakhir</span>
                  <p className="font-mono text-xl font-bold text-[var(--text)] tabular-nums">
                    {formatPct(turnoverLast?.ratePct ?? 0)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    {turnoverLast
                      ? `${formatNumberPlain(turnoverLast.churned)} dari ${formatNumberPlain(turnoverLast.activeBase)} aktif`
                      : '-'}
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Master Non-Aktif (ERP)</span>
                  <p className="font-mono text-xl font-bold text-[var(--text)] tabular-nums">
                    {formatNumberPlain(data.masterSuppliers?.inactive ?? 0)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Dari {formatNumberPlain(data.masterSuppliers?.total ?? 0)} supplier terdaftar
                  </span>
                </div>
              </div>

              <BiHorizontalBarChart
                title="Supplier Turnover Rate (%)"
                subtitle="(Jml Supplier Tidak Berlanjut ÷ Basis Supplier Aktif) × 100%."
                legendLabel="Supplier Turnover Rate (%)"
                data={turnoverRows.map((r) => ({
                  key: r.month,
                  label: formatMonthShort(r.month),
                  value: r.ratePct,
                  valueLabel: formatPct(r.ratePct),
                  hoverSummary: `Tidak berlanjut: ${formatNumberPlain(r.churned)} · Aktif: ${formatNumberPlain(r.activeBase)}`,
                }))}
                formatAxisTick={(v) => `${formatDecimal(v, 0)}%`}
              />

              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[var(--border)]">
                  <h4 className="font-display text-sm font-bold text-[var(--text)]">
                    Tabel Supplier Turnover Rate Bulanan
                  </h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                        <th className="text-left font-semibold px-4 py-2.5">Bulan</th>
                        <th className="text-right font-semibold px-4 py-2.5">Jml Supplier Tidak Berlanjut</th>
                        <th className="text-right font-semibold px-4 py-2.5">Basis Supplier Aktif</th>
                        <th className="text-right font-semibold px-4 py-2.5">Supplier Turnover Rate (%)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {turnoverRows.map((r) => (
                        <tr key={r.month} className="hover:bg-[var(--bg)]/60">
                          <td className="px-4 py-2.5 font-medium text-[var(--text)]">
                            {formatMonthShort(r.month)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                            {formatNumberPlain(r.churned)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                            {formatNumberPlain(r.activeBase)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums font-bold text-[var(--accent)]">
                            {formatPct(r.ratePct)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* 04. Order Pembelian (Purchase Opportunity) */}
          {mode === 'purchase_opportunity' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Total PO Periode</span>
                  <p className="font-mono text-xl font-bold text-[var(--text)] tabular-nums">
                    {formatNumberPlain(oppTotalPo)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    {oppRows.length} bulan aktif (non-void)
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Jml PO Bulan Lalu</span>
                  <p className="font-mono text-xl font-bold text-[var(--text)] tabular-nums">
                    {formatNumberPlain(oppLast?.prevPo ?? 0)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Basis perbandingan terakhir
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Jml PO Bulan Ini</span>
                  <p className="font-mono text-xl font-bold text-[var(--text)] tabular-nums">
                    {formatNumberPlain(oppLast?.currPo ?? 0)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    {oppLast ? formatMonthShort(oppLast.month) : '-'}
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Rata-rata Purchase Opportunity</span>
                  <p className="font-mono text-xl font-bold text-[var(--accent)] tabular-nums">
                    {formatDecimal(oppAvgRatio, 2)}x
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Bulan terakhir: {formatDecimal(oppLast?.ratio ?? 0, 2)}x
                  </span>
                </div>
              </div>

              <BiVerticalSingleChart
                title="Purchase Opportunity"
                subtitle="Rasio Jml PO Bulan Ini ÷ Jml PO Bulan Lalu (nilai > 1,00 menunjukkan peningkatan order pembelian)."
                legendLabel="Purchase Opportunity"
                data={oppRows.map((r) => ({
                  key: r.month,
                  label: formatMonthShort(r.month),
                  value: r.ratio,
                  valueLabel: `${formatDecimal(r.ratio, 2)}x`,
                  hoverSummary: `PO Bulan Lalu: ${formatNumberPlain(r.prevPo)} · PO Bulan Ini: ${formatNumberPlain(r.currPo)}`,
                }))}
                formatAxisTick={(v) => formatDecimal(v, 2)}
                shape="column"
              />

              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[var(--border)]">
                  <h4 className="font-display text-sm font-bold text-[var(--text)]">
                    Tabel Order Pembelian (Purchase Opportunity)
                  </h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                        <th className="text-left font-semibold px-4 py-2.5">Bulan</th>
                        <th className="text-right font-semibold px-4 py-2.5">Jml PO Bulan Lalu</th>
                        <th className="text-right font-semibold px-4 py-2.5">Jml PO Bulan Ini</th>
                        <th className="text-right font-semibold px-4 py-2.5">Purchase Opportunity</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {oppRows.map((r) => (
                        <tr key={r.month} className="hover:bg-[var(--bg)]/60">
                          <td className="px-4 py-2.5 font-medium text-[var(--text)]">
                            {formatMonthShort(r.month)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                            {formatNumberPlain(r.prevPo)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                            {formatNumberPlain(r.currPo)}
                          </td>
                          <td
                            className={`px-4 py-2.5 text-right font-mono tabular-nums font-bold ${
                              r.ratio >= 1 ? 'text-[var(--accent)]' : 'text-amber-600 dark:text-amber-400'
                            }`}
                          >
                            {formatDecimal(r.ratio, 2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
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
