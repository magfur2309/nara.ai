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
  useBiSalesPeriodData,
} from './biSalesShared';

export type SalesCustomerKpiMode =
  | 'customer_growth'
  | 'customer_profitability'
  | 'customer_turnover'
  | 'sales_opportunity';

interface BiSalesCustomerKpiProps {
  mode: SalesCustomerKpiMode;
  idToken: string | null;
  onDownloadBridge?: () => void;
}

const META: Record<
  SalesCustomerKpiMode,
  { category: string; chartTypeLabel: string; title: string; description: string }
> = {
  customer_growth: {
    category: 'Pelanggan & Peluang',
    chartTypeLabel: 'Diagram Kolom Vertikal',
    title: '01. Pertumbuhan Customer (Customer Growth)',
    description:
      'Membandingkan jumlah pelanggan aktif bertransaksi bulan ini terhadap bulan sebelumnya beserta pertumbuhan nominal dan persentasenya.',
  },
  customer_profitability: {
    category: 'Pelanggan & Peluang',
    chartTypeLabel: 'Diagram Kolom Vertikal',
    title: '02. Customer Menguntungkan (Customer Profitability)',
    description:
      'Analisis kontribusi Penjualan, Harga Pokok Penjualan (HPP), dan Laba Rugi per pelanggan yang diurutkan dari kontribusi laba tertinggi.',
  },
  customer_turnover: {
    category: 'Pelanggan & Peluang',
    chartTypeLabel: 'Diagram Batang Horizontal',
    title: '03. Customer Mengundurkan Diri (Customer Turnover Rate)',
    description:
      'Persentase pelanggan yang berhenti bertransaksi dibandingkan jumlah pelanggan aktif per bulan.',
  },
  sales_opportunity: {
    category: 'Pelanggan & Peluang',
    chartTypeLabel: 'Diagram Kolom Vertikal',
    title: '04. Order Penjualan (Sales Opportunity)',
    description:
      'Rasio perbandingan jumlah Sales Order (SO) bulan ini terhadap bulan lalu untuk mengukur momentum peluang penjualan.',
  },
};

const HPP_SOURCE_LABELS: Record<string, string> = {
  m5_si_detail: 'HPP aktual per baris Faktur Penjualan',
  m2_transaction_journal: 'HPP aktual Jurnal Buku Besar COGS per pelanggan',
  m1_item: 'Estimasi HPP master barang × qty terjual',
  unavailable: 'Data HPP belum terisi pada sistem ERP (HPP = 0)',
};

export const BiSalesCustomerKpi: React.FC<BiSalesCustomerKpiProps> = ({
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

  const [growthBasis, setGrowthBasis] = useState<'si' | 'so'>('si');
  const [turnoverBasis, setTurnoverBasis] = useState<'mom' | 'rolling3m'>('mom');
  const [topN, setTopN] = useState<number>(10);
  const [custSearch, setCustSearch] = useState<string>('');

  const meta = META[mode];

  // 01. Customer Growth rows
  const growthRows = useMemo(() => {
    return monthlyRows.map((r) => {
      const prev = growthBasis === 'si' ? r.prevActiveCustomersSi : r.prevActiveCustomersSo;
      const curr = growthBasis === 'si' ? r.activeCustomersSi : r.activeCustomersSo;
      const diff = curr - prev;
      const pct = prev > 0 ? (diff / prev) * 100 : 0;
      return { month: r.month, prev, curr, diff, pct };
    });
  }, [growthBasis, monthlyRows]);

  // 02. Customer Profitability rows
  const filteredProfitRows = useMemo(() => {
    const all = data?.customerProfitability || [];
    const q = custSearch.trim().toLowerCase();
    const filtered = q
      ? all.filter(
          (c) =>
            c.customerName.toLowerCase().includes(q) ||
            c.customerCode.toLowerCase().includes(q)
        )
      : all;
    return filtered;
  }, [custSearch, data?.customerProfitability]);

  const displayedProfitRows = useMemo(() => {
    if (topN <= 0) return filteredProfitRows;
    return filteredProfitRows.slice(0, topN);
  }, [filteredProfitRows, topN]);

  // 03. Customer Turnover rows
  const turnoverRows = useMemo(() => {
    return monthlyRows.map((r) => {
      const churned =
        turnoverBasis === 'mom' ? r.churnedCustomersSi : r.churnedRollingCustomersSi;
      const activeBase =
        turnoverBasis === 'mom'
          ? Math.max(r.activeCustomersSi, r.prevActiveCustomersSi)
          : Math.max(r.rollingBaseCustomersSi, r.activeCustomersSi);
      const ratePct = activeBase > 0 ? (churned / activeBase) * 100 : 0;
      return { month: r.month, churned, activeBase, ratePct };
    });
  }, [monthlyRows, turnoverBasis]);

  // 04. Sales Opportunity rows
  const oppRows = useMemo(() => {
    return monthlyRows.map((r) => {
      const ratio = r.prevSoCount > 0 ? r.soCount / r.prevSoCount : 0;
      return {
        month: r.month,
        prevSo: r.prevSoCount,
        currSo: r.soCount,
        ratio,
      };
    });
  }, [monthlyRows]);

  const hasRecords =
    mode === 'customer_profitability'
      ? (data?.customerProfitability?.length || 0) > 0
      : monthlyRows.length > 0;

  const noticeMessage = useMemo(() => {
    const parts: string[] = [];
    if (cutoffWarning) {
      parts.push(`Periode transaksi aktif MyERP Plus dimulai sejak ${cutoffWarning}.`);
    }
    if (mode === 'customer_profitability' && data?.diagnostics?.hppSource) {
      parts.push(`Sumber HPP: ${HPP_SOURCE_LABELS[data.diagnostics.hppSource] || data.diagnostics.hppSource}.`);
    }
    if (mode === 'customer_turnover' && data?.diagnostics?.hasMasterCustomerStatus) {
      parts.push(
        `Master pelanggan: ${formatNumberPlain(data.diagnostics.masterActiveCustomers)} aktif · ${formatNumberPlain(data.diagnostics.masterInactiveCustomers)} non-aktif.`
      );
    }
    return parts.length > 0 ? parts.join(' ') : null;
  }, [cutoffWarning, data?.diagnostics, mode]);

  const handleExportCsv = () => {
    const suffix = `${selectedYear}_${String(effectiveStart).padStart(2, '0')}-${String(effectiveEnd).padStart(2, '0')}`;
    if (mode === 'customer_growth') {
      downloadCsvFile(
        `bi_sales_01_customer_growth_${suffix}.csv`,
        ['Bulan', 'Jml Pelanggan Bulan Lalu', 'Jml Pelanggan Bulan Ini', 'Pertumbuhan', 'Pertumbuhan (%)'],
        growthRows.map((r) => [formatMonthShort(r.month), r.prev, r.curr, r.diff, r.pct.toFixed(2)])
      );
    } else if (mode === 'customer_profitability') {
      downloadCsvFile(
        `bi_sales_02_customer_profitability_${suffix}.csv`,
        ['Kode Customer', 'Nama Customer', 'Jml Faktur', 'Penjualan (IDR)', 'HPP (IDR)', 'Laba Rugi (IDR)', 'Margin (%)'],
        displayedProfitRows.map((r) => [
          r.customerCode,
          r.customerName,
          r.invoiceCount,
          Math.round(r.salesAmount),
          Math.round(r.cogsAmount),
          Math.round(r.profitAmount),
          r.marginPct.toFixed(2),
        ])
      );
    } else if (mode === 'customer_turnover') {
      downloadCsvFile(
        `bi_sales_03_customer_turnover_${suffix}.csv`,
        ['Bulan', 'Jml Customer Mengundurkan Diri', 'Jml Customer Aktif', 'Customer Turnover Rate (%)'],
        turnoverRows.map((r) => [formatMonthShort(r.month), r.churned, r.activeBase, r.ratePct.toFixed(2)])
      );
    } else {
      downloadCsvFile(
        `bi_sales_04_sales_opportunity_${suffix}.csv`,
        ['Bulan', 'Jml SO Bulan Lalu', 'Jml SO Bulan Ini', 'Sales Opportunity (x)'],
        oppRows.map((r) => [formatMonthShort(r.month), r.prevSo, r.currSo, r.ratio.toFixed(2)])
      );
    }
  };

  const extraControls = (
    <>
      {mode === 'customer_growth' && (
        <div className="space-y-1 ml-auto">
          <span className="block text-[11px] font-medium text-[var(--text-muted)]">
            Basis Pelanggan Aktif
          </span>
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
            <button
              type="button"
              onClick={() => setGrowthBasis('si')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md cursor-pointer whitespace-nowrap ${
                growthBasis === 'si'
                  ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              Faktur Penjualan (SI)
            </button>
            <button
              type="button"
              onClick={() => setGrowthBasis('so')}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md cursor-pointer whitespace-nowrap ${
                growthBasis === 'so'
                  ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              Sales Order (SO)
            </button>
          </div>
        </div>
      )}

      {mode === 'customer_profitability' && (
        <div className="flex flex-wrap items-end gap-2 ml-auto">
          <div className="space-y-1">
            <span className="block text-[11px] font-medium text-[var(--text-muted)]">
              Cari Customer
            </span>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={custSearch}
                onChange={(e) => setCustSearch(e.target.value)}
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
              <option value={10}>Top 10 Customer</option>
              <option value={20}>Top 20 Customer</option>
              <option value={50}>Top 50 Customer</option>
              <option value={0}>Semua Customer</option>
            </select>
          </div>
        </div>
      )}

      {mode === 'customer_turnover' && (
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
    growthRows.length > 0
      ? growthRows.reduce((s, r) => s + r.pct, 0) / growthRows.length
      : 0;

  const profitTotals = useMemo(() => {
    const sales = displayedProfitRows.reduce((s, r) => s + r.salesAmount, 0);
    const cogs = displayedProfitRows.reduce((s, r) => s + r.cogsAmount, 0);
    const profit = displayedProfitRows.reduce((s, r) => s + r.profitAmount, 0);
    const margin = sales > 0 ? (profit / sales) * 100 : 0;
    return { sales, cogs, profit, margin };
  }, [displayedProfitRows]);

  const turnoverAvgRate =
    turnoverRows.length > 0
      ? turnoverRows.reduce((s, r) => s + r.ratePct, 0) / turnoverRows.length
      : 0;
  const turnoverTotalChurned = turnoverRows.reduce((s, r) => s + r.churned, 0);
  const turnoverLast = turnoverRows[turnoverRows.length - 1];

  const oppTotalSo = oppRows.reduce((s, r) => s + r.currSo, 0);
  const oppValid = oppRows.filter((r) => r.prevSo > 0);
  const oppAvgRatio =
    oppValid.length > 0
      ? oppValid.reduce((s, r) => s + r.ratio, 0) / oppValid.length
      : 0;
  const oppLast = oppRows[oppRows.length - 1];

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
          {/* 01. Pertumbuhan Customer */}
          {mode === 'customer_growth' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Pelanggan Bulan Lalu</span>
                  <p className="font-mono text-xl font-bold text-[var(--text)] tabular-nums">
                    {formatNumberPlain(growthLast?.prev ?? 0)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Basis perbandingan terakhir
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Pelanggan Bulan Ini</span>
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
                    Pelanggan bulan terakhir
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
                title="Pertumbuhan (%)"
                subtitle="Persentase pertumbuhan jumlah pelanggan aktif antarbulan (MoM)."
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
                    Tabel Pertumbuhan Customer Bulanan
                  </h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                        <th className="text-left font-semibold px-4 py-2.5">Bulan</th>
                        <th className="text-right font-semibold px-4 py-2.5">Jml Pelanggan Bulan Lalu</th>
                        <th className="text-right font-semibold px-4 py-2.5">Jml Pelanggan Bulan Ini</th>
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

          {/* 02. Customer Profitability */}
          {mode === 'customer_profitability' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Total Penjualan</span>
                  <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate">
                    {formatIdr(profitTotals.sales)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    {displayedProfitRows.length} customer ditampilkan
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Total HPP</span>
                  <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate">
                    {formatIdr(profitTotals.cogs)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Sumber: {data.diagnostics.hppSource}
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Total Laba Rugi</span>
                  <p
                    className={`font-mono text-lg font-bold tabular-nums truncate ${
                      profitTotals.profit >= 0 ? 'text-[var(--accent)]' : 'text-red-500'
                    }`}
                  >
                    {formatIdr(profitTotals.profit)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Penjualan − HPP
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Margin Laba Rata-rata</span>
                  <p className="font-mono text-xl font-bold text-[var(--accent)] tabular-nums">
                    {formatPct(profitTotals.margin)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Top 1: {displayedProfitRows[0]?.customerName || '-'}
                  </span>
                </div>
              </div>

              <BiVerticalSingleChart
                title={`Laba Rugi per Customer (Top ${Math.min(12, displayedProfitRows.length)})`}
                subtitle="Peringkat customer berdasarkan kontribusi Laba Rugi (Penjualan − HPP)."
                legendLabel="Laba Rugi (IDR)"
                data={displayedProfitRows.slice(0, 12).map((c) => ({
                  key: String(c.customerId),
                  label:
                    c.customerName.length > 14
                      ? `${c.customerName.slice(0, 13)}…`
                      : c.customerName,
                  value: c.profitAmount,
                  valueLabel: formatCompactIdr(c.profitAmount),
                  hoverSummary: `${c.customerName} · Penjualan: ${formatIdr(c.salesAmount)} · HPP: ${formatIdr(c.cogsAmount)} · Margin: ${formatPct(c.marginPct)}`,
                }))}
                formatAxisTick={(v) => formatCompactIdr(v)}
                shape="column"
              />

              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[var(--border)] flex items-center justify-between gap-2">
                  <h4 className="font-display text-sm font-bold text-[var(--text)]">
                    Tabel Customer Menguntungkan ({displayedProfitRows.length} dari {filteredProfitRows.length})
                  </h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                        <th className="text-left font-semibold px-4 py-2.5 w-10">#</th>
                        <th className="text-left font-semibold px-4 py-2.5">Nama Customer</th>
                        <th className="text-right font-semibold px-4 py-2.5">Faktur</th>
                        <th className="text-right font-semibold px-4 py-2.5">Penjualan</th>
                        <th className="text-right font-semibold px-4 py-2.5">HPP</th>
                        <th className="text-right font-semibold px-4 py-2.5">Laba Rugi</th>
                        <th className="text-right font-semibold px-4 py-2.5">Margin (%)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {displayedProfitRows.map((c, idx) => (
                        <tr key={c.customerId} className="hover:bg-[var(--bg)]/60">
                          <td className="px-4 py-2.5 font-mono text-[var(--text-muted)]">
                            {idx + 1}
                          </td>
                          <td className="px-4 py-2.5 font-medium text-[var(--text)]">
                            <div>{c.customerName}</div>
                            <div className="text-[11px] font-mono text-[var(--text-muted)]">
                              {c.customerCode}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text-muted)]">
                            {formatNumberPlain(c.invoiceCount)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                            {formatIdr(c.salesAmount)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                            {formatIdr(c.cogsAmount)}
                          </td>
                          <td
                            className={`px-4 py-2.5 text-right font-mono tabular-nums font-bold ${
                              c.profitAmount >= 0 ? 'text-[var(--accent)]' : 'text-red-500'
                            }`}
                          >
                            {formatIdr(c.profitAmount)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                            {formatPct(c.marginPct)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-[var(--bg)] border-t border-[var(--border)] font-bold">
                        <td colSpan={3} className="px-4 py-2.5 text-[var(--text)]">
                          Total ({displayedProfitRows.length} Customer)
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                          {formatIdr(profitTotals.sales)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                          {formatIdr(profitTotals.cogs)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--accent)]">
                          {formatIdr(profitTotals.profit)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--accent)]">
                          {formatPct(profitTotals.margin)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* 03. Customer Turnover Rate */}
          {mode === 'customer_turnover' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Rata-rata Turnover Rate</span>
                  <p className="font-mono text-xl font-bold text-[var(--accent)] tabular-nums">
                    {formatPct(turnoverAvgRate)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Semakin rendah semakin baik
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
                    {formatNumberPlain(data.diagnostics.masterInactiveCustomers)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Dari {formatNumberPlain(data.diagnostics.masterActiveCustomers + data.diagnostics.masterInactiveCustomers)} customer terdaftar
                  </span>
                </div>
              </div>

              <BiHorizontalBarChart
                title="Customer Turnover Rate"
                subtitle="(Jml Customer Mengundurkan Diri ÷ Jml Customer Aktif) × 100%."
                legendLabel="Customer Turnover Rate (%)"
                data={turnoverRows.map((r) => ({
                  key: r.month,
                  label: formatMonthShort(r.month),
                  value: r.ratePct,
                  valueLabel: formatPct(r.ratePct),
                  hoverSummary: `Mengundurkan diri: ${formatNumberPlain(r.churned)} · Aktif: ${formatNumberPlain(r.activeBase)}`,
                }))}
                formatAxisTick={(v) => `${formatDecimal(v, 0)}%`}
              />

              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[var(--border)]">
                  <h4 className="font-display text-sm font-bold text-[var(--text)]">
                    Tabel Customer Turnover Rate Bulanan
                  </h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                        <th className="text-left font-semibold px-4 py-2.5">Bulan</th>
                        <th className="text-right font-semibold px-4 py-2.5">Jml Customer Mengundurkan Diri</th>
                        <th className="text-right font-semibold px-4 py-2.5">Jml Customer Aktif</th>
                        <th className="text-right font-semibold px-4 py-2.5">Customer Turnover Rate (%)</th>
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

          {/* 04. Sales Opportunity */}
          {mode === 'sales_opportunity' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Total SO Periode</span>
                  <p className="font-mono text-xl font-bold text-[var(--text)] tabular-nums">
                    {formatNumberPlain(oppTotalSo)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    {oppRows.length} bulan aktif (non-void)
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Jml SO Bulan Lalu</span>
                  <p className="font-mono text-xl font-bold text-[var(--text)] tabular-nums">
                    {formatNumberPlain(oppLast?.prevSo ?? 0)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Basis perbandingan terakhir
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Jml SO Bulan Ini</span>
                  <p className="font-mono text-xl font-bold text-[var(--text)] tabular-nums">
                    {formatNumberPlain(oppLast?.currSo ?? 0)}
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    {oppLast ? formatMonthShort(oppLast.month) : '-'}
                  </span>
                </div>
                <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                  <span className="text-xs text-[var(--text-muted)]">Rata-rata Sales Opportunity</span>
                  <p className="font-mono text-xl font-bold text-[var(--accent)] tabular-nums">
                    {formatDecimal(oppAvgRatio, 2)}x
                  </p>
                  <span className="text-[11px] text-[var(--text-muted)] block">
                    Bulan terakhir: {formatDecimal(oppLast?.ratio ?? 0, 2)}x
                  </span>
                </div>
              </div>

              <BiVerticalSingleChart
                title="Sales Opportunity"
                subtitle="Rasio Jml SO Bulan Ini ÷ Jml SO Bulan Lalu (nilai > 1,00 menunjukkan pertumbuhan order)."
                legendLabel="Sales Opportunity"
                data={oppRows.map((r) => ({
                  key: r.month,
                  label: formatMonthShort(r.month),
                  value: r.ratio,
                  valueLabel: `${formatDecimal(r.ratio, 2)}x`,
                  hoverSummary: `SO Bulan Lalu: ${formatNumberPlain(r.prevSo)} · SO Bulan Ini: ${formatNumberPlain(r.currSo)}`,
                }))}
                formatAxisTick={(v) => formatDecimal(v, 2)}
                shape="column"
              />

              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[var(--border)]">
                  <h4 className="font-display text-sm font-bold text-[var(--text)]">
                    Tabel Order Penjualan (Sales Opportunity)
                  </h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                        <th className="text-left font-semibold px-4 py-2.5">Bulan</th>
                        <th className="text-right font-semibold px-4 py-2.5">Jml SO Bulan Lalu</th>
                        <th className="text-right font-semibold px-4 py-2.5">Jml SO Bulan Ini</th>
                        <th className="text-right font-semibold px-4 py-2.5">Sales Opportunity</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {oppRows.map((r) => (
                        <tr key={r.month} className="hover:bg-[var(--bg)]/60">
                          <td className="px-4 py-2.5 font-medium text-[var(--text)]">
                            {formatMonthShort(r.month)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                            {formatNumberPlain(r.prevSo)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums text-[var(--text)]">
                            {formatNumberPlain(r.currSo)}
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
