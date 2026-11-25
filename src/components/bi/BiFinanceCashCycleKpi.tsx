import React, { useMemo, useState } from 'react';
import {
  BiGroupedColumnChart,
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
  formatNumberPlain,
  formatPct,
  useBiFinancePeriodData,
} from './biFinanceShared';

export type BiFinanceCashCycleMode = 'de_ratio' | 'dso' | 'dsi' | 'dpo' | 'ccc' | 'cash_to_cash';

interface BiFinanceCashCycleKpiProps {
  mode: BiFinanceCashCycleMode;
  idToken: string;
  onDownloadBridge?: () => void;
}

const MODE_META: Record<
  BiFinanceCashCycleMode,
  {
    category: string;
    chartTypeLabel: string;
    title: string;
    description: string;
    csvPrefix: string;
  }
> = {
  de_ratio: {
    category: 'Struktur Modal & Siklus Kas',
    chartTypeLabel: 'Diagram Kolom Vertikal',
    title: '13. Debt-To-Equity (D/E) Ratio',
    description:
      'Perbandingan total liabilitas (hutang) terhadap ekuitas perusahaan untuk menilai tingkat leverage dan kesehatan struktur modal per bulan.',
    csvPrefix: 'BI_Debt_To_Equity',
  },
  dso: {
    category: 'Struktur Modal & Siklus Kas',
    chartTypeLabel: 'Diagram Batang Horizontal',
    title: '14A. Days of Sales Outstanding (DSO) — Perputaran Penjualan',
    description:
      'Rata-rata jumlah hari yang dibutuhkan perusahaan untuk menagih piutang usaha menjadi kas berdasarkan saldo piutang dan pendapatan bulanan aktual.',
    csvPrefix: 'BI_DSO',
  },
  dsi: {
    category: 'Struktur Modal & Siklus Kas',
    chartTypeLabel: 'Diagram Kerucut Vertikal',
    title: '14B. Days of Sales in Inventory (DSI) — Perputaran Persediaan',
    description:
      'Rata-rata jumlah hari persediaan tersimpan sebelum terjual berdasarkan saldo persediaan dan Harga Pokok Penjualan (HPP) bulanan aktual.',
    csvPrefix: 'BI_DSI',
  },
  dpo: {
    category: 'Struktur Modal & Siklus Kas',
    chartTypeLabel: 'Diagram Kolom Vertikal',
    title: '14C. Days of Payables Outstanding (DPO) — Perputaran Hutang',
    description:
      'Rata-rata jumlah hari yang digunakan perusahaan untuk melunasi hutang usaha kepada pemasok berdasarkan saldo hutang usaha dan HPP bulanan aktual.',
    csvPrefix: 'BI_DPO',
  },
  ccc: {
    category: 'Struktur Modal & Siklus Kas',
    chartTypeLabel: 'Diagram Kolom Vertikal',
    title: '14D. Cash Conversion Cycle (CCC)',
    description:
      'Gabungan DSO, DSI, dan DPO untuk mengukur berapa hari kas perusahaan terikat dalam siklus operasional (CCC = DSO + DSI − DPO).',
    csvPrefix: 'BI_CCC',
  },
  cash_to_cash: {
    category: 'Struktur Modal & Siklus Kas',
    chartTypeLabel: 'Diagram Batang Horizontal',
    title: '15. Cash-to-Cash Cycle',
    description:
      'Siklus kas-ke-kas berbasis saldo rata-rata (Awal & Akhir Bulan) Piutang, Persediaan, dan Hutang Usaha terhadap Pendapatan dan HPP aktual.',
    csvPrefix: 'BI_Cash_To_Cash_Cycle',
  },
};

export const BiFinanceCashCycleKpi: React.FC<BiFinanceCashCycleKpiProps> = ({
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
    effectiveStartMonth,
    effectiveEndMonth,
    availableYears,
    data,
    monthlyRows,
    hasMonthlyBalanceSheet,
    loading,
    refreshing,
    errorMsg,
    cutoffWarning,
    fetchFinanceData,
    handleResetActivePeriod,
  } = useBiFinancePeriodData(idToken);

  const meta = MODE_META[mode];

  // Mode 13 controls
  const [includeCurrentProfitInEquity, setIncludeCurrentProfitInEquity] = useState<boolean>(true);
  const [deChartView, setDeChartView] = useState<'nominal_comparison' | 'ratio_x'>(
    'nominal_comparison'
  );

  // Compute all exact cycle & leverage metrics per month using exact calendar daysInMonth
  const computedRows = useMemo(() => {
    return monthlyRows.map((row) => {
      const days = row.daysInMonth;
      const equityVal = includeCurrentProfitInEquity
        ? row.equityEnd + row.cumulativeNetIncome
        : row.equityEnd;
      const hutangTotal = row.totalLiabilitiesEnd;
      const selisihHutangEkuitas = hutangTotal - equityVal;
      const deRatioX = Math.abs(equityVal) >= 1 ? hutangTotal / equityVal : 0;
      const deRatioPct = deRatioX * 100;

      // 14A: DSO = (Piutang Akhir / Pendapatan) * daysInMonth
      const dso = row.revenueOperating > 0 ? (row.arEnd / row.revenueOperating) * days : 0;
      // 14B: DSI = (Persediaan Akhir / HPP) * daysInMonth
      const dsi = row.cogs > 0 ? (row.inventoryEnd / row.cogs) * days : 0;
      // 14C: DPO = (Hutang Usaha Akhir / HPP) * daysInMonth
      const dpo = row.cogs > 0 ? (row.apEnd / row.cogs) * days : 0;
      // 14D: CCC = DSO + DSI - DPO
      const ccc = dso + dsi - dpo;

      // 15: Cash-to-Cash Cycle (using opening & closing averages per month)
      const avgPiutang = (row.arStart + row.arEnd) / 2;
      const avgPersediaan = (row.inventoryStart + row.inventoryEnd) / 2;
      const avgHutang = (row.apStart + row.apEnd) / 2;
      // X = (Avg Persediaan / HPP) * days; Y = (Avg Piutang / Pendapatan) * days; Z = (Avg Hutang / HPP) * days
      const xDays = row.cogs > 0 ? (avgPersediaan / row.cogs) * days : 0;
      const yDays = row.revenueOperating > 0 ? (avgPiutang / row.revenueOperating) * days : 0;
      const zDays = row.cogs > 0 ? (avgHutang / row.cogs) * days : 0;
      const cashToCashDays = xDays + yDays - zDays;

      return {
        row,
        days,
        hutangTotal,
        equityVal,
        selisihHutangEkuitas,
        deRatioX,
        deRatioPct,
        dso,
        dsi,
        dpo,
        ccc,
        avgPiutang,
        avgPersediaan,
        avgHutang,
        xDays,
        yDays,
        zDays,
        cashToCashDays,
      };
    });
  }, [includeCurrentProfitInEquity, monthlyRows]);

  const summary = useMemo(() => {
    const n = computedRows.length;
    const last = n > 0 ? computedRows[n - 1] : null;
    const avgDso = n > 0 ? computedRows.reduce((s, r) => s + r.dso, 0) / n : 0;
    const avgDsi = n > 0 ? computedRows.reduce((s, r) => s + r.dsi, 0) / n : 0;
    const avgDpo = n > 0 ? computedRows.reduce((s, r) => s + r.dpo, 0) / n : 0;
    const avgCcc = n > 0 ? computedRows.reduce((s, r) => s + r.ccc, 0) / n : 0;
    const avgC2c = n > 0 ? computedRows.reduce((s, r) => s + r.cashToCashDays, 0) / n : 0;
    const avgDeX = n > 0 ? computedRows.reduce((s, r) => s + r.deRatioX, 0) / n : 0;
    return { last, avgDso, avgDsi, avgDpo, avgCcc, avgC2c, avgDeX };
  }, [computedRows]);

  const needsBsNotice = !hasMonthlyBalanceSheet && Boolean(data);
  const noticeMessage = useMemo(() => {
    const parts: string[] = [];
    if (cutoffWarning) {
      parts.push(`Periode jurnal aktif MyERP Plus dimulai sejak ${cutoffWarning}.`);
    }
    if (needsBsNotice) {
      parts.push(
        'Bridge ERP lokal Anda belum mengirim snapshot Neraca bulanan (monthlyBalanceSheet). Unduh ulang Bridge ERP terbaru agar saldo Awal/Akhir Piutang, Persediaan, Hutang, dan Ekuitas per bulan terhitung otomatis.'
      );
    }
    return parts.length > 0 ? parts.join(' ') : null;
  }, [cutoffWarning, needsBsNotice]);

  const handleExportCsv = () => {
    if (computedRows.length === 0) return;
    const suffix = `${selectedYear}_${String(effectiveStartMonth).padStart(2, '0')}-${String(effectiveEndMonth).padStart(2, '0')}`;

    if (mode === 'de_ratio') {
      downloadCsvFile(`${meta.csvPrefix}_${suffix}.csv`, [
        ['Bulan', 'Total Hutang (Liabilitas)', 'Ekuitas', 'Selisih (Hutang - Ekuitas)', 'D/E Ratio (x)', 'D/E Ratio (%)'],
        ...computedRows.map((r) => [
          r.row.labelShort,
          Math.round(r.hutangTotal),
          Math.round(r.equityVal),
          Math.round(r.selisihHutangEkuitas),
          r.deRatioX.toFixed(2),
          r.deRatioPct.toFixed(2),
        ]),
      ]);
      return;
    }

    if (mode === 'dso') {
      downloadCsvFile(`${meta.csvPrefix}_${suffix}.csv`, [
        ['Bulan', 'Hari Bulan', 'Piutang Akhir', 'Pendapatan', 'DSO (Hari)'],
        ...computedRows.map((r) => [
          r.row.labelShort,
          r.days,
          Math.round(r.row.arEnd),
          Math.round(r.row.revenueOperating),
          r.dso.toFixed(2),
        ]),
      ]);
      return;
    }

    if (mode === 'dsi') {
      downloadCsvFile(`${meta.csvPrefix}_${suffix}.csv`, [
        ['Bulan', 'Hari Bulan', 'Persediaan Akhir', 'Harga Pokok Penjualan', 'DSI (Hari)'],
        ...computedRows.map((r) => [
          r.row.labelShort,
          r.days,
          Math.round(r.row.inventoryEnd),
          Math.round(r.row.cogs),
          r.dsi.toFixed(2),
        ]),
      ]);
      return;
    }

    if (mode === 'dpo') {
      downloadCsvFile(`${meta.csvPrefix}_${suffix}.csv`, [
        ['Bulan', 'Hari Bulan', 'Hutang Usaha Akhir', 'Harga Pokok Penjualan', 'DPO (Hari)'],
        ...computedRows.map((r) => [
          r.row.labelShort,
          r.days,
          Math.round(r.row.apEnd),
          Math.round(r.row.cogs),
          r.dpo.toFixed(2),
        ]),
      ]);
      return;
    }

    if (mode === 'ccc') {
      downloadCsvFile(`${meta.csvPrefix}_${suffix}.csv`, [
        ['Bulan', 'DSO (Hari)', 'DSI (Hari)', 'DPO (Hari)', 'CCC (Hari)'],
        ...computedRows.map((r) => [
          r.row.labelShort,
          r.dso.toFixed(2),
          r.dsi.toFixed(2),
          r.dpo.toFixed(2),
          r.ccc.toFixed(2),
        ]),
      ]);
      return;
    }

    downloadCsvFile(`${meta.csvPrefix}_${suffix}.csv`, [
      [
        'Bulan',
        'Awal Piutang',
        'Akhir Piutang',
        'Awal Persediaan',
        'Akhir Persediaan',
        'Awal Hutang',
        'Akhir Hutang',
        'Avg Piutang',
        'Avg Persediaan',
        'Avg Hutang',
        'Pendapatan',
        'HPP',
        'X (DSI Avg)',
        'Y (DSO Avg)',
        'Z (DPO Avg)',
        'Cash-to-Cash Cycle (Hari)',
      ],
      ...computedRows.map((r) => [
        r.row.labelShort,
        Math.round(r.row.arStart),
        Math.round(r.row.arEnd),
        Math.round(r.row.inventoryStart),
        Math.round(r.row.inventoryEnd),
        Math.round(r.row.apStart),
        Math.round(r.row.apEnd),
        Math.round(r.avgPiutang),
        Math.round(r.avgPersediaan),
        Math.round(r.avgHutang),
        Math.round(r.row.revenueOperating),
        Math.round(r.row.cogs),
        r.xDays.toFixed(2),
        r.yDays.toFixed(2),
        r.zDays.toFixed(2),
        r.cashToCashDays.toFixed(2),
      ]),
    ]);
  };

  return (
    <div className="space-y-5">
      <BiKpiHeaderAndFilter
        idPrefix={mode}
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
        onRefresh={() => void fetchFinanceData({ refresh: true })}
        onExportCsv={handleExportCsv}
        loading={loading}
        refreshing={refreshing}
        canExport={computedRows.length > 0}
        extraControls={
          mode === 'de_ratio' ? (
            <div className="space-y-1 ml-auto">
              <span className="block text-[11px] font-medium text-[var(--text-muted)]">
                Basis Ekuitas
              </span>
              <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setIncludeCurrentProfitInEquity(true)}
                  className={`px-2 py-1 text-[11px] font-medium rounded-md cursor-pointer whitespace-nowrap ${
                    includeCurrentProfitInEquity
                      ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                  }`}
                >
                  Ekuitas + Laba Berjalan
                </button>
                <button
                  type="button"
                  onClick={() => setIncludeCurrentProfitInEquity(false)}
                  className={`px-2 py-1 text-[11px] font-medium rounded-md cursor-pointer whitespace-nowrap ${
                    !includeCurrentProfitInEquity
                      ? 'bg-[var(--accent)] text-[var(--on-accent)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                  }`}
                >
                  COA Ekuitas (10)
                </button>
              </div>
            </div>
          ) : undefined
        }
        noticeText={noticeMessage}
        noticeActionLabel={needsBsNotice && onDownloadBridge ? 'Unduh Bridge Terbaru →' : undefined}
        onNoticeAction={needsBsNotice ? onDownloadBridge : undefined}
      />

      <BiKpiStateViews
        loading={loading}
        hasData={Boolean(data)}
        errorMsg={errorMsg}
        isEmpty={computedRows.length === 0}
        selectedYear={selectedYear}
        startMonth={startMonth}
        endMonth={endMonth}
        minDateActive={data?.coverage?.minDateActive}
        maxDateActive={data?.coverage?.maxDateActive}
        onRetry={() => void fetchFinanceData({ refresh: true })}
        onResetPeriod={handleResetActivePeriod}
        onDownloadBridge={onDownloadBridge}
      />

      {!errorMsg && data && computedRows.length > 0 && (
        <div
          className={`space-y-5 transition-opacity duration-150 ${loading ? 'opacity-65' : 'opacity-100'}`}
        >
          {/* 4-Card Summary Strip */}
          {mode === 'de_ratio' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Total Hutang Akhir</span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate">
                  {formatIdr(summary.last?.hutangTotal ?? 0)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  Liabilitas COA tipe 7, 8, 9
                </span>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Total Ekuitas Akhir</span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate">
                  {formatIdr(summary.last?.equityVal ?? 0)}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  {includeCurrentProfitInEquity ? 'COA 10 + Laba Berjalan' : 'COA Ekuitas (10)'}
                </span>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">D/E Ratio Bulan Terakhir</span>
                <p className="font-mono text-xl font-bold text-[var(--accent)] tabular-nums">
                  {formatDecimal(summary.last?.deRatioX ?? 0)}x
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  Setara {formatPct(summary.last?.deRatioPct ?? 0)}
                </span>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">Rata-rata D/E Ratio</span>
                <p className="font-mono text-xl font-bold text-[var(--text)] tabular-nums">
                  {formatDecimal(summary.avgDeX)}x
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  Total Hutang ÷ Ekuitas
                </span>
              </div>
            </div>
          )}

          {(mode === 'dso' || mode === 'dsi' || mode === 'dpo') && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">
                  {mode === 'dso' && 'Saldo Piutang Akhir'}
                  {mode === 'dsi' && 'Saldo Persediaan Akhir'}
                  {mode === 'dpo' && 'Saldo Hutang Usaha Akhir'}
                </span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate">
                  {formatIdr(
                    mode === 'dso'
                      ? (summary.last?.row.arEnd ?? 0)
                      : mode === 'dsi'
                        ? (summary.last?.row.inventoryEnd ?? 0)
                        : (summary.last?.row.apEnd ?? 0)
                  )}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  Posisi akhir {summary.last?.row.labelShort}
                </span>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">
                  {mode === 'dso' ? 'Pendapatan Bulan Terakhir' : 'HPP Bulan Terakhir'}
                </span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums truncate">
                  {formatIdr(
                    mode === 'dso'
                      ? (summary.last?.row.revenueOperating ?? 0)
                      : (summary.last?.row.cogs ?? 0)
                  )}
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  {summary.last?.days ?? 30} hari kalender
                </span>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">
                  {mode.toUpperCase()} Bulan Terakhir
                </span>
                <p className="font-mono text-xl font-bold text-[var(--accent)] tabular-nums">
                  {formatDecimal(
                    mode === 'dso'
                      ? (summary.last?.dso ?? 0)
                      : mode === 'dsi'
                        ? (summary.last?.dsi ?? 0)
                        : (summary.last?.dpo ?? 0)
                  )}{' '}
                  hari
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  Pembulatan: {Math.round(
                    mode === 'dso'
                      ? (summary.last?.dso ?? 0)
                      : mode === 'dsi'
                        ? (summary.last?.dsi ?? 0)
                        : (summary.last?.dpo ?? 0)
                  )}{' '}
                  hari
                </span>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">
                  Rata-rata {mode.toUpperCase()} Periode
                </span>
                <p className="font-mono text-xl font-bold text-[var(--text)] tabular-nums">
                  {formatDecimal(
                    mode === 'dso'
                      ? summary.avgDso
                      : mode === 'dsi'
                        ? summary.avgDsi
                        : summary.avgDpo
                  )}{' '}
                  hari
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  Rata-rata {computedRows.length} bulan
                </span>
              </div>
            </div>
          )}

          {(mode === 'ccc' || mode === 'cash_to_cash') && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">
                  {mode === 'ccc' ? 'Rata-rata DSO' : 'Rata-rata Y (DSO Avg)'}
                </span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums">
                  {formatDecimal(
                    mode === 'ccc'
                      ? summary.avgDso
                      : computedRows.reduce((s, r) => s + r.yDays, 0) / computedRows.length
                  )}{' '}
                  hari
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">Perputaran piutang</span>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">
                  {mode === 'ccc' ? 'Rata-rata DSI' : 'Rata-rata X (DSI Avg)'}
                </span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums">
                  {formatDecimal(
                    mode === 'ccc'
                      ? summary.avgDsi
                      : computedRows.reduce((s, r) => s + r.xDays, 0) / computedRows.length
                  )}{' '}
                  hari
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">Perputaran persediaan</span>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">
                  {mode === 'ccc' ? 'Rata-rata DPO' : 'Rata-rata Z (DPO Avg)'}
                </span>
                <p className="font-mono text-lg font-bold text-[var(--text)] tabular-nums">
                  {formatDecimal(
                    mode === 'ccc'
                      ? summary.avgDpo
                      : computedRows.reduce((s, r) => s + r.zDays, 0) / computedRows.length
                  )}{' '}
                  hari
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">Perputaran hutang</span>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-1">
                <span className="text-xs text-[var(--text-muted)]">
                  {mode === 'ccc' ? 'Rata-rata CCC' : 'Rata-rata Cash-to-Cash'}
                </span>
                <p className="font-mono text-xl font-bold text-[var(--accent)] tabular-nums">
                  {formatDecimal(mode === 'ccc' ? summary.avgCcc : summary.avgC2c)} hari
                </p>
                <span className="text-[11px] text-[var(--text-muted)] block">
                  Bulan terakhir:{' '}
                  {formatDecimal(
                    mode === 'ccc'
                      ? (summary.last?.ccc ?? 0)
                      : (summary.last?.cashToCashDays ?? 0)
                  )}{' '}
                  hari
                </span>
              </div>
            </div>
          )}

          {/* PRIMARY CHARTS */}
          {mode === 'de_ratio' &&
            (deChartView === 'nominal_comparison' ? (
              <BiGroupedColumnChart
                title="Grafik Debt-To-Equity (D/E) Ratio"
                subtitle="Perbandingan Hutang (Liabilitas), Ekuitas, dan Selisih per bulan"
                months={computedRows.map((r) => ({
                  key: r.row.month,
                  label: r.row.labelShort,
                  labelFull: r.row.labelFull,
                }))}
                metrics={[
                  {
                    key: 'hutang',
                    label: 'Hutang',
                    color: '#D97706',
                    valuesByMonth: Object.fromEntries(
                      computedRows.map((r) => [r.row.month, r.hutangTotal])
                    ),
                  },
                  {
                    key: 'ekuitas',
                    label: 'Ekuitas',
                    color: '#0D7678',
                    valuesByMonth: Object.fromEntries(
                      computedRows.map((r) => [r.row.month, r.equityVal])
                    ),
                  },
                  {
                    key: 'selisih',
                    label: 'Selisih (H−E)',
                    color: '#2563EB',
                    valuesByMonth: Object.fromEntries(
                      computedRows.map((r) => [r.row.month, r.selisihHutangEkuitas])
                    ),
                  },
                ]}
                formatAxisTick={formatCompactIdr}
                formatExactValue={formatIdr}
                headerExtra={
                  <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
                    <button
                      type="button"
                      onClick={() => setDeChartView('nominal_comparison')}
                      className="px-2 py-1 text-[11px] font-medium rounded-md bg-[var(--accent)] text-[var(--on-accent)] cursor-pointer whitespace-nowrap"
                    >
                      Komposisi (Template)
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeChartView('ratio_x')}
                      className="px-2 py-1 text-[11px] font-medium rounded-md text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer whitespace-nowrap"
                    >
                      Rasio D/E (x)
                    </button>
                  </div>
                }
              />
            ) : (
              <BiVerticalSingleChart
                title="Rasio Debt-To-Equity (x)"
                subtitle="Perbandingan rasio Total Hutang dibagi Ekuitas per bulan"
                legendLabel="D/E Ratio (x)"
                formatAxisTick={(v) => `${v.toFixed(1)}x`}
                headerRight={
                  <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
                    <button
                      type="button"
                      onClick={() => setDeChartView('nominal_comparison')}
                      className="px-2 py-1 text-[11px] font-medium rounded-md text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer whitespace-nowrap"
                    >
                      Komposisi (Template)
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeChartView('ratio_x')}
                      className="px-2 py-1 text-[11px] font-medium rounded-md bg-[var(--accent)] text-[var(--on-accent)] cursor-pointer whitespace-nowrap"
                    >
                      Rasio D/E (x)
                    </button>
                  </div>
                }
                data={computedRows.map((r) => ({
                  key: r.row.month,
                  label: r.row.labelShort,
                  value: r.deRatioX,
                  valueLabel: `${formatDecimal(r.deRatioX)}x`,
                  hoverSummary: `Hutang ${formatIdr(r.hutangTotal)} ÷ Ekuitas ${formatIdr(r.equityVal)} = ${formatDecimal(r.deRatioX)}x (${formatPct(r.deRatioPct)})`,
                }))}
              />
            ))}

          {mode === 'dso' && (
            <BiHorizontalBarChart
              title="DSO"
              subtitle="Days of Sales Outstanding (hari) — rata-rata lama penagihan piutang per bulan"
              legendLabel="DSO (Hari)"
              formatAxisTick={(v) => `${Math.round(v)}`}
              data={computedRows.map((r) => ({
                key: r.row.month,
                label: r.row.labelShort,
                value: r.dso,
                valueLabel: `${Math.round(r.dso)} hr`,
                hoverSummary: `(Piutang ${formatIdr(r.row.arEnd)} ÷ Pendapatan ${formatIdr(r.row.revenueOperating)}) × ${r.days} hr = ${formatDecimal(r.dso)} hari`,
              }))}
            />
          )}

          {mode === 'dsi' && (
            <BiVerticalSingleChart
              title="DSI"
              subtitle="Days of Sales in Inventory (hari) — rata-rata hari penyimpanan persediaan per bulan"
              legendLabel="DSI (Hari)"
              shape="cone"
              formatAxisTick={(v) => `${Math.round(v)}`}
              data={computedRows.map((r) => ({
                key: r.row.month,
                label: r.row.labelShort,
                value: r.dsi,
                valueLabel: `${Math.round(r.dsi)} hr`,
                hoverSummary: `(Persediaan ${formatIdr(r.row.inventoryEnd)} ÷ HPP ${formatIdr(r.row.cogs)}) × ${r.days} hr = ${formatDecimal(r.dsi)} hari`,
              }))}
            />
          )}

          {mode === 'dpo' && (
            <BiVerticalSingleChart
              title="DPO"
              subtitle="Days of Payables Outstanding (hari) — rata-rata hari pembayaran hutang usaha per bulan"
              legendLabel="DPO (Hari)"
              formatAxisTick={(v) => `${Math.round(v)}`}
              data={computedRows.map((r) => ({
                key: r.row.month,
                label: r.row.labelShort,
                value: r.dpo,
                valueLabel: `${Math.round(r.dpo)} hr`,
                hoverSummary: `(Hutang Usaha ${formatIdr(r.row.apEnd)} ÷ HPP ${formatIdr(r.row.cogs)}) × ${r.days} hr = ${formatDecimal(r.dpo)} hari`,
              }))}
            />
          )}

          {mode === 'ccc' && (
            <BiGroupedColumnChart
              title="Cash Conversion Cycle (CCC)"
              subtitle="Perbandingan DSO, DSI, DPO, dan Cash Conversion Cycle (dalam hari) per bulan"
              months={computedRows.map((r) => ({
                key: r.row.month,
                label: r.row.labelShort,
                labelFull: r.row.labelFull,
              }))}
              metrics={[
                {
                  key: 'dso',
                  label: 'DSO',
                  color: '#0D7678',
                  valuesByMonth: Object.fromEntries(computedRows.map((r) => [r.row.month, r.dso])),
                },
                {
                  key: 'dsi',
                  label: 'DSI',
                  color: '#2563EB',
                  valuesByMonth: Object.fromEntries(computedRows.map((r) => [r.row.month, r.dsi])),
                },
                {
                  key: 'dpo',
                  label: 'DPO',
                  color: '#D97706',
                  valuesByMonth: Object.fromEntries(computedRows.map((r) => [r.row.month, r.dpo])),
                },
                {
                  key: 'ccc',
                  label: 'CCC',
                  color: '#10B981',
                  valuesByMonth: Object.fromEntries(computedRows.map((r) => [r.row.month, r.ccc])),
                },
              ]}
              formatAxisTick={(v) => `${Math.round(v)}`}
              formatExactValue={(v) => `${formatDecimal(v)} hari`}
            />
          )}

          {mode === 'cash_to_cash' && (
            <BiHorizontalBarChart
              title="Cash-to-Cash Cycle"
              subtitle="Siklus kas berbasis saldo rata-rata (X + Y − Z, dalam hari)"
              legendLabel="Cash-to-Cash Cycle (Hari)"
              formatAxisTick={(v) => v.toFixed(2)}
              data={computedRows.map((r) => ({
                key: r.row.month,
                label: r.row.labelShort,
                value: r.cashToCashDays,
                valueLabel: `${formatDecimal(r.cashToCashDays)} hr`,
                hoverSummary: `X (${formatDecimal(r.xDays)}) + Y (${formatDecimal(r.yDays)}) − Z (${formatDecimal(r.zDays)}) = ${formatDecimal(r.cashToCashDays)} hari`,
              }))}
            />
          )}

          {/* STRUCTURED TABLES */}
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[var(--border)]">
              <h4 className="font-display text-sm font-bold text-[var(--text)]">
                Tabel Perhitungan {meta.title}
              </h4>
              <p className="text-[11px] text-[var(--text-muted)]">
                Sumber aktual: Buku Besar ERP (jurnal terposting, non-void)
              </p>
            </div>

            <div className="overflow-x-auto">
              {mode === 'de_ratio' && (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                      <th className="text-left font-semibold px-4 py-2.5">Bulan</th>
                      <th className="text-right font-semibold px-4 py-2.5">Hutang (Liabilitas)</th>
                      <th className="text-right font-semibold px-4 py-2.5">Ekuitas</th>
                      <th className="text-right font-semibold px-4 py-2.5">Selisih (H − E)</th>
                      <th className="text-right font-semibold px-4 py-2.5">D/E Ratio (x)</th>
                      <th className="text-right font-semibold px-4 py-2.5">D/E Ratio (%)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)] font-mono tabular-nums">
                    {computedRows.map((r) => (
                      <tr key={r.row.month} className="hover:bg-[var(--bg)]/60">
                        <td className="px-4 py-2.5 font-sans font-medium text-[var(--text)]">
                          {r.row.labelShort}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--text)]">
                          {formatNumberPlain(r.hutangTotal)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--text)]">
                          {formatNumberPlain(r.equityVal)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--text-muted)]">
                          {formatNumberPlain(r.selisihHutangEkuitas)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-[var(--accent)]">
                          {formatDecimal(r.deRatioX)}x
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--text)]">
                          {formatPct(r.deRatioPct)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {(mode === 'dso' || mode === 'dsi' || mode === 'dpo') && (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                      <th className="text-left font-semibold px-4 py-2.5">Bulan</th>
                      <th className="text-right font-semibold px-4 py-2.5">Hari</th>
                      <th className="text-right font-semibold px-4 py-2.5">
                        {mode === 'dso' ? 'Piutang' : mode === 'dsi' ? 'Persediaan' : 'Hutang'}
                      </th>
                      <th className="text-right font-semibold px-4 py-2.5">
                        {mode === 'dso' ? 'Pendapatan' : 'Harga Pokok Penjualan'}
                      </th>
                      <th className="text-right font-semibold px-4 py-2.5">
                        {mode.toUpperCase()} (Hari)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)] font-mono tabular-nums">
                    {computedRows.map((r) => {
                      const numVal =
                        mode === 'dso'
                          ? r.row.arEnd
                          : mode === 'dsi'
                            ? r.row.inventoryEnd
                            : r.row.apEnd;
                      const denVal = mode === 'dso' ? r.row.revenueOperating : r.row.cogs;
                      const resDays = mode === 'dso' ? r.dso : mode === 'dsi' ? r.dsi : r.dpo;
                      return (
                        <tr key={r.row.month} className="hover:bg-[var(--bg)]/60">
                          <td className="px-4 py-2.5 font-sans font-medium text-[var(--text)]">
                            {r.row.labelShort}
                          </td>
                          <td className="px-4 py-2.5 text-right text-[var(--text-muted)]">
                            {r.days}
                          </td>
                          <td className="px-4 py-2.5 text-right text-[var(--text)]">
                            {formatNumberPlain(numVal)}
                          </td>
                          <td className="px-4 py-2.5 text-right text-[var(--text)]">
                            {formatNumberPlain(denVal)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-semibold text-[var(--accent)]">
                            {Math.round(resDays)}{' '}
                            <span className="text-[11px] font-normal text-[var(--text-muted)]">
                              ({formatDecimal(resDays)})
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}

              {mode === 'ccc' && (
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                      <th className="text-left font-semibold px-4 py-2.5">Bulan</th>
                      <th className="text-right font-semibold px-4 py-2.5">DSO (Hari)</th>
                      <th className="text-right font-semibold px-4 py-2.5">DSI (Hari)</th>
                      <th className="text-right font-semibold px-4 py-2.5">DPO (Hari)</th>
                      <th className="text-right font-semibold px-4 py-2.5">CCC (Hari)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)] font-mono tabular-nums">
                    {computedRows.map((r) => (
                      <tr key={r.row.month} className="hover:bg-[var(--bg)]/60">
                        <td className="px-4 py-2.5 font-sans font-medium text-[var(--text)]">
                          {r.row.labelShort}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--text)]">
                          {formatDecimal(r.dso)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--text)]">
                          {formatDecimal(r.dsi)}
                        </td>
                        <td className="px-4 py-2.5 text-right text-[var(--text)]">
                          {formatDecimal(r.dpo)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-[var(--accent)]">
                          {formatDecimal(r.ccc)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {mode === 'cash_to_cash' && (
                <div className="divide-y divide-[var(--border)]">
                  {/* Sub-table 1: Saldo Awal & Akhir (persis tabel atas Excel #15) */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                          <th className="text-left font-semibold px-3.5 py-2.5 whitespace-nowrap">Bulan</th>
                          <th className="text-right font-semibold px-3.5 py-2.5 whitespace-nowrap">Awal Piutang</th>
                          <th className="text-right font-semibold px-3.5 py-2.5 whitespace-nowrap">Akhir Piutang</th>
                          <th className="text-right font-semibold px-3.5 py-2.5 whitespace-nowrap">Awal Persediaan</th>
                          <th className="text-right font-semibold px-3.5 py-2.5 whitespace-nowrap">Akhir Persediaan</th>
                          <th className="text-right font-semibold px-3.5 py-2.5 whitespace-nowrap">Awal Hutang</th>
                          <th className="text-right font-semibold px-3.5 py-2.5 whitespace-nowrap">Akhir Hutang</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)] font-mono tabular-nums">
                        {computedRows.map((r) => (
                          <tr key={`bal-${r.row.month}`} className="hover:bg-[var(--bg)]/60">
                            <td className="px-3.5 py-2 font-sans font-medium text-[var(--text)] whitespace-nowrap">
                              {r.row.labelShort}
                            </td>
                            <td className="px-3.5 py-2 text-right text-[var(--text)] whitespace-nowrap">
                              {formatNumberPlain(r.row.arStart)}
                            </td>
                            <td className="px-3.5 py-2 text-right text-[var(--text)] whitespace-nowrap">
                              {formatNumberPlain(r.row.arEnd)}
                            </td>
                            <td className="px-3.5 py-2 text-right text-[var(--text)] whitespace-nowrap">
                              {formatNumberPlain(r.row.inventoryStart)}
                            </td>
                            <td className="px-3.5 py-2 text-right text-[var(--text)] whitespace-nowrap">
                              {formatNumberPlain(r.row.inventoryEnd)}
                            </td>
                            <td className="px-3.5 py-2 text-right text-[var(--text)] whitespace-nowrap">
                              {formatNumberPlain(r.row.apStart)}
                            </td>
                            <td className="px-3.5 py-2 text-right text-[var(--text)] whitespace-nowrap">
                              {formatNumberPlain(r.row.apEnd)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Sub-table 2: Avg, Pendapatan, HPP, X, Y, Z, Cash-to-Cash Cycle (persis tabel bawah Excel #15) */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-[var(--bg)] border-b border-[var(--border)] text-[var(--text-muted)]">
                          <th className="text-left font-semibold px-3 py-2.5 whitespace-nowrap">Bulan</th>
                          <th className="text-right font-semibold px-3 py-2.5 whitespace-nowrap">Avg Piutang</th>
                          <th className="text-right font-semibold px-3 py-2.5 whitespace-nowrap">Avg Persediaan</th>
                          <th className="text-right font-semibold px-3 py-2.5 whitespace-nowrap">Avg Hutang</th>
                          <th className="text-right font-semibold px-3 py-2.5 whitespace-nowrap">Pendapatan</th>
                          <th className="text-right font-semibold px-3 py-2.5 whitespace-nowrap">HPP</th>
                          <th className="text-right font-semibold px-3 py-2.5 whitespace-nowrap">X</th>
                          <th className="text-right font-semibold px-3 py-2.5 whitespace-nowrap">Y</th>
                          <th className="text-right font-semibold px-3 py-2.5 whitespace-nowrap">Z</th>
                          <th className="text-right font-semibold px-3 py-2.5 whitespace-nowrap">Cash-to-Cash</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)] font-mono tabular-nums">
                        {computedRows.map((r) => (
                          <tr key={`c2c-${r.row.month}`} className="hover:bg-[var(--bg)]/60">
                            <td className="px-3 py-2 font-sans font-medium text-[var(--text)] whitespace-nowrap">
                              {r.row.labelShort}
                            </td>
                            <td className="px-3 py-2 text-right text-[var(--text)] whitespace-nowrap">
                              {formatNumberPlain(r.avgPiutang)}
                            </td>
                            <td className="px-3 py-2 text-right text-[var(--text)] whitespace-nowrap">
                              {formatNumberPlain(r.avgPersediaan)}
                            </td>
                            <td className="px-3 py-2 text-right text-[var(--text)] whitespace-nowrap">
                              {formatNumberPlain(r.avgHutang)}
                            </td>
                            <td className="px-3 py-2 text-right text-[var(--text)] whitespace-nowrap">
                              {formatNumberPlain(r.row.revenueOperating)}
                            </td>
                            <td className="px-3 py-2 text-right text-[var(--text)] whitespace-nowrap">
                              {formatNumberPlain(r.row.cogs)}
                            </td>
                            <td className="px-3 py-2 text-right text-[var(--text-muted)] whitespace-nowrap">
                              {formatDecimal(r.xDays)}
                            </td>
                            <td className="px-3 py-2 text-right text-[var(--text-muted)] whitespace-nowrap">
                              {formatDecimal(r.yDays)}
                            </td>
                            <td className="px-3 py-2 text-right text-[var(--text-muted)] whitespace-nowrap">
                              {formatDecimal(r.zDays)}
                            </td>
                            <td className="px-3 py-2 text-right font-semibold text-[var(--accent)] whitespace-nowrap">
                              {formatDecimal(r.cashToCashDays)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-[var(--border)] bg-[var(--bg)]/50 text-[11px] text-[var(--text-muted)] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span>
                {mode === 'de_ratio' && 'Rumus: Debt-to-Equity Ratio = Total Hutang (Liabilitas COA 7–9) ÷ Ekuitas.'}
                {mode === 'dso' && 'Rumus: DSO = (Piutang Akhir Bulan ÷ Pendapatan Bulan) × Jumlah Hari Kalender Bulan.'}
                {mode === 'dsi' && 'Rumus: DSI = (Persediaan Akhir Bulan ÷ HPP Bulan) × Jumlah Hari Kalender Bulan.'}
                {mode === 'dpo' && 'Rumus: DPO = (Hutang Usaha Akhir Bulan ÷ HPP Bulan) × Jumlah Hari Kalender Bulan.'}
                {mode === 'ccc' && 'Rumus: Cash Conversion Cycle (CCC) = DSO + DSI − DPO (dalam hari).'}
                {mode === 'cash_to_cash' &&
                  'Rumus: X = (Avg Persediaan ÷ HPP) × Hari · Y = (Avg Piutang ÷ Pendapatan) × Hari · Z = (Avg Hutang ÷ HPP) × Hari · Cash-to-Cash = X + Y − Z.'}
              </span>
              <span className="font-mono tabular-nums whitespace-nowrap">
                {mode === 'de_ratio' ? 'Nominal IDR & Rasio (x)' : 'Satuan Hari Kalender Aktual'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
